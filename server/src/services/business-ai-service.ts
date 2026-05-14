import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// LLM abstraction
// ---------------------------------------------------------------------------
//
// The Anthropic SDK is not a hard dependency of this package. We resolve a
// client lazily via dynamic import, so this file typechecks even when the SDK
// is not installed. If neither the SDK nor an API key is available, every
// LLM-backed method returns a deterministic mock response so the UI keeps
// working in dev. Each mock response is tagged with `{ mock: true }`.

interface LLMClient {
  complete(input: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string>;
}

let cachedClient: LLMClient | null | undefined;

async function getLLMClient(): Promise<LLMClient | null> {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    cachedClient = null;
    return null;
  }
  try {
    // Dynamic import keeps this file typechecking when the SDK is absent.
    // The package name is hidden behind a variable so TS does not try to
    // resolve type declarations at build time.
    const pkg = "@anthropic-ai/sdk";
    const mod = (await (
      Function("p", "return import(p)") as (p: string) => Promise<unknown>
    )(pkg).catch(() => null)) as
      | { default?: new (opts: { apiKey: string }) => unknown }
      | null;
    if (!mod || !mod.default) {
      cachedClient = null;
      return null;
    }
    const AnthropicCtor = mod.default;
    const instance = new AnthropicCtor({ apiKey }) as {
      messages: {
        create(args: {
          model: string;
          max_tokens: number;
          temperature?: number;
          system?: string;
          messages: Array<{ role: "user"; content: string }>;
        }): Promise<{
          content: Array<{ type: string; text?: string }>;
        }>;
      };
    };
    cachedClient = {
      async complete({ system, user, maxTokens = 1024, temperature = 0.2 }) {
        const response = await instance.messages.create({
          model: "claude-3-5-sonnet-latest",
          max_tokens: maxTokens,
          temperature,
          system,
          messages: [{ role: "user", content: user }],
        });
        const parts = response.content
          .map((p) => (p.type === "text" && p.text ? p.text : ""))
          .filter(Boolean);
        return parts.join("\n").trim();
      },
    };
    return cachedClient;
  } catch {
    cachedClient = null;
    return null;
  }
}

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number },
): Promise<{ text: string; mock: false } | { text: null; mock: true }> {
  const client = await getLLMClient();
  if (!client) return { text: null, mock: true };
  try {
    const text = await client.complete({
      system: systemPrompt,
      user: userPrompt,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
    });
    return { text, mock: false };
  } catch {
    return { text: null, mock: true };
  }
}

function tryParseJson<T>(text: string): T | null {
  // Strip code fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  try {
    return JSON.parse(raw.trim()) as T;
  } catch {
    // Find first { ... } object
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const EXPENSE_CATEGORIES = [
  "Salaries",
  "Rent",
  "Marketing",
  "Software",
  "Travel",
  "Utilities",
  "Supplies",
  "Professional Services",
  "Insurance",
  "Taxes",
  "Other",
] as const;
type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface NextActionResult {
  suggestion: string;
  reasoning: string;
  suggestedActions: Array<{
    label: string;
    type: "email" | "call" | "meeting" | "task";
  }>;
  mock?: boolean;
}

export interface DraftInvoiceResult {
  customerName?: string;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
  mock?: boolean;
}

export interface ChurnRiskItem {
  contactId: string;
  contactName: string | null;
  score: number; // 0-100
  reasoning: string;
}

export interface ChurnRiskResult {
  items: ChurnRiskItem[];
  mock?: boolean;
}

export interface ClassifyTicketResult {
  category: "billing" | "technical" | "feature_request" | "complaint" | "other";
  priority: "low" | "normal" | "high" | "urgent";
  suggested_response: string;
  mock?: boolean;
}

export interface ReportNarrativeResult {
  narrative: string;
  mock?: boolean;
}

export interface CustomerSummaryResult {
  summary: string;
  mock?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createBusinessAiService(db: Db) {
  async function getEntity(companyId: string, entityId: string) {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, entityId),
          eq(businessEntities.companyId, companyId),
        ),
      );
    return row ?? null;
  }

  async function updateEntityData(
    companyId: string,
    entityId: string,
    patch: Record<string, unknown>,
  ) {
    const existing = await getEntity(companyId, entityId);
    if (!existing) return null;
    const existingData = (existing.data ?? {}) as Record<string, unknown>;
    const merged = { ...existingData, ...patch };
    const [row] = await db
      .update(businessEntities)
      .set({ data: merged, updatedAt: new Date() })
      .where(
        and(
          eq(businessEntities.id, entityId),
          eq(businessEntities.companyId, companyId),
        ),
      )
      .returning();
    return row ?? null;
  }

  // -------------------------------------------------------------------------
  // 1. Categorize expense
  // -------------------------------------------------------------------------
  async function categorizeExpense(companyId: string, entityId: string) {
    const entity = await getEntity(companyId, entityId);
    if (!entity) return { error: "not_found" as const };
    if (entity.moduleKey !== "finance" || entity.entityType !== "expense") {
      return { error: "wrong_entity_type" as const };
    }
    const description =
      entity.name ?? (entity.data as { description?: string })?.description ?? "";
    const merchant = (entity.data as { merchant?: string })?.merchant ?? "";
    const amount =
      entity.amountCents != null ? `${entity.amountCents / 100}` : "unknown";

    const system =
      "You are a financial categorization assistant. Categorize the expense into exactly one of these categories: " +
      EXPENSE_CATEGORIES.join(", ") +
      ". Respond with JSON: { \"category\": \"<one of the categories>\" }. Do not include any other commentary.";
    const user = `Expense:\nName/description: ${description}\nMerchant: ${merchant}\nAmount: ${amount} ${entity.currency ?? ""}\n\nReturn JSON.`;

    const result = await callLLM(system, user, { maxTokens: 100 });

    let category: ExpenseCategory = "Other";
    let mock = false;
    if (result.mock) {
      mock = true;
      category = mockCategorizeExpense(description, merchant);
    } else {
      const parsed = tryParseJson<{ category?: string }>(result.text);
      const candidate = parsed?.category?.trim();
      if (candidate && (EXPENSE_CATEGORIES as readonly string[]).includes(candidate)) {
        category = candidate as ExpenseCategory;
      } else {
        category = "Other";
      }
    }

    const updated = await updateEntityData(companyId, entityId, { category });
    return { entity: updated, category, mock };
  }

  function mockCategorizeExpense(desc: string, merchant: string): ExpenseCategory {
    const t = `${desc} ${merchant}`.toLowerCase();
    if (/(salary|wage|payroll)/.test(t)) return "Salaries";
    if (/(rent|lease)/.test(t)) return "Rent";
    if (/(ad|ads|marketing|google|facebook|meta|campaign)/.test(t))
      return "Marketing";
    if (/(software|saas|github|figma|notion|aws|cloud|subscription)/.test(t))
      return "Software";
    if (/(flight|hotel|uber|taxi|travel)/.test(t)) return "Travel";
    if (/(electric|water|utility|internet)/.test(t)) return "Utilities";
    if (/(supplies|office|stationery)/.test(t)) return "Supplies";
    if (/(consult|legal|accountant|professional)/.test(t))
      return "Professional Services";
    if (/(insurance)/.test(t)) return "Insurance";
    if (/(tax|vat|zakat)/.test(t)) return "Taxes";
    return "Other";
  }

  // -------------------------------------------------------------------------
  // 2. Suggest next action
  // -------------------------------------------------------------------------
  async function suggestNextAction(
    companyId: string,
    entityId: string,
  ): Promise<NextActionResult | { error: "not_found" }> {
    const entity = await getEntity(companyId, entityId);
    if (!entity) return { error: "not_found" };

    const data = (entity.data ?? {}) as Record<string, unknown>;
    const stage = entity.status;
    const lastContact = data.lastContactAt ?? data.lastTouchedAt ?? "unknown";
    const notes = typeof data.notes === "string" ? data.notes : "";
    const amount =
      entity.amountCents != null ? `${entity.amountCents / 100}` : "unknown";

    const system =
      "You are a sales/CRM coach helping a business owner advance a deal. " +
      "Given the deal details, suggest the single most impactful next action. " +
      "Respond with JSON: { \"suggestion\": string, \"reasoning\": string, " +
      "\"suggestedActions\": [{ \"label\": string, \"type\": \"email\"|\"call\"|\"meeting\"|\"task\" }] }. " +
      "Provide 2-4 suggestedActions.";
    const user = `Deal: ${entity.name ?? entity.code ?? entityId}\nStage: ${stage}\nAmount: ${amount} ${entity.currency ?? ""}\nLast contact: ${String(lastContact)}\nNotes: ${notes}\n\nReturn JSON only.`;

    const result = await callLLM(system, user, { maxTokens: 600 });
    if (result.mock) {
      return mockNextAction(entity.name ?? "this deal", stage);
    }
    const parsed = tryParseJson<NextActionResult>(result.text);
    if (!parsed || !Array.isArray(parsed.suggestedActions)) {
      return mockNextAction(entity.name ?? "this deal", stage);
    }
    return parsed;
  }

  function mockNextAction(name: string, stage: string): NextActionResult {
    return {
      suggestion: `Follow up with ${name} to advance from "${stage}".`,
      reasoning:
        "Most deals stall without a clear next step. A timely follow-up keeps momentum and surfaces blockers early.",
      suggestedActions: [
        { label: `Email ${name} a recap`, type: "email" },
        { label: "Schedule a 15-min discovery call", type: "call" },
        { label: "Propose a demo meeting next week", type: "meeting" },
        { label: "Draft tailored proposal", type: "task" },
      ],
      mock: true,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Draft invoice from text
  // -------------------------------------------------------------------------
  async function draftInvoiceFromText(
    companyId: string,
    text: string,
    customerId?: string,
  ): Promise<DraftInvoiceResult> {
    let customerName: string | undefined;
    if (customerId) {
      const c = await getEntity(companyId, customerId);
      customerName = c?.name ?? undefined;
    }

    const system =
      "You are an invoice parsing assistant. Extract line items from the user's free-form text. " +
      "Respond with JSON: { \"customerName\"?: string, \"items\": [{ \"description\": string, \"quantity\": number, \"unitPrice\": number }] }. " +
      "Numbers must be plain numbers (no currency symbols).";
    const user = `Text: ${text}\nKnown customer: ${customerName ?? "(none)"}\n\nReturn JSON only.`;

    const result = await callLLM(system, user, { maxTokens: 800 });
    if (result.mock) {
      return mockDraftInvoice(text, customerName);
    }
    const parsed = tryParseJson<DraftInvoiceResult>(result.text);
    if (
      !parsed ||
      !Array.isArray(parsed.items) ||
      parsed.items.length === 0
    ) {
      return mockDraftInvoice(text, customerName);
    }
    return {
      customerName: parsed.customerName ?? customerName,
      items: parsed.items.map((i) => ({
        description: String(i.description ?? ""),
        quantity: Number(i.quantity ?? 1) || 1,
        unitPrice: Number(i.unitPrice ?? 0) || 0,
      })),
    };
  }

  function mockDraftInvoice(text: string, customerName?: string): DraftInvoiceResult {
    // Very simple extraction: look for "<n> <unit> at <price>" or "<price> SAR/month for <n>".
    const items: DraftInvoiceResult["items"] = [];
    const re1 = /(\d+(?:\.\d+)?)\s*(?:days?|hours?|units?|items?)?\s*at\s*(\d+(?:\.\d+)?)/gi;
    let m: RegExpExecArray | null;
    while ((m = re1.exec(text)) !== null) {
      items.push({
        description: text.slice(0, 60).trim(),
        quantity: Number(m[1]),
        unitPrice: Number(m[2]),
      });
    }
    if (items.length === 0) {
      items.push({ description: text.slice(0, 120).trim() || "Service", quantity: 1, unitPrice: 0 });
    }
    return { customerName, items, mock: true };
  }

  // -------------------------------------------------------------------------
  // 4. Summarize customer
  // -------------------------------------------------------------------------
  async function summarizeCustomer(
    companyId: string,
    contactId: string,
  ): Promise<CustomerSummaryResult | { error: "not_found" }> {
    const contact = await getEntity(companyId, contactId);
    if (!contact) return { error: "not_found" };

    // Find related entities — heuristic: entities whose data.contactId or
    // parentId matches the contact id.
    const related = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          sql`(${businessEntities.parentId} = ${contactId} OR data->>'contactId' = ${contactId} OR data->>'customerId' = ${contactId})`,
        ),
      )
      .orderBy(desc(businessEntities.updatedAt))
      .limit(50);

    const deals = related.filter((r) => r.entityType === "deal");
    const invoices = related.filter((r) => r.entityType === "invoice");
    const tickets = related.filter((r) => r.entityType === "ticket");

    const facts = {
      name: contact.name,
      status: contact.status,
      deals: deals.map((d) => ({
        name: d.name,
        stage: d.status,
        amountCents: d.amountCents,
      })),
      invoices: invoices.map((i) => ({
        code: i.code,
        status: i.status,
        amountCents: i.amountCents,
        createdAt: i.createdAt,
      })),
      tickets: tickets.map((t) => ({
        code: t.code,
        status: t.status,
        subject: t.name,
      })),
    };

    const system =
      "You are an account manager assistant. Given a customer's full record, write a 2-paragraph summary: " +
      "(1) relationship history and current status; (2) opportunities and risks. Plain text, no headings.";
    const user = `Customer record:\n${JSON.stringify(facts, null, 2)}`;

    const result = await callLLM(system, user, { maxTokens: 600 });
    if (result.mock) {
      return {
        summary: mockCustomerSummary(facts),
        mock: true,
      };
    }
    return { summary: result.text };
  }

  function mockCustomerSummary(facts: {
    name: string | null;
    deals: Array<{ name: string | null; stage: string; amountCents: number | null }>;
    invoices: Array<{ status: string; amountCents: number | null }>;
    tickets: Array<{ status: string }>;
  }): string {
    const openDeals = facts.deals.length;
    const totalInvoiced = facts.invoices.reduce(
      (s, i) => s + (i.amountCents ?? 0),
      0,
    );
    const openTickets = facts.tickets.filter(
      (t) => t.status !== "closed" && t.status !== "resolved",
    ).length;
    return (
      `${facts.name ?? "This customer"} has ${openDeals} deal(s) in the pipeline and a total of ${(totalInvoiced / 100).toLocaleString()} in invoiced revenue. ` +
      `${openTickets > 0 ? `There are ${openTickets} open support ticket(s) that need attention.` : "Support engagement is currently quiet."}\n\n` +
      `Opportunities: expand the account with adjacent offerings and ensure outstanding invoices are paid on time. ` +
      `Watch for stalled deals and unresolved tickets which could erode trust if left unattended.`
    );
  }

  // -------------------------------------------------------------------------
  // 5. Churn risk
  // -------------------------------------------------------------------------
  async function churnRisk(companyId: string): Promise<ChurnRiskResult> {
    const contacts = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "contact"),
        ),
      )
      .limit(500);

    if (contacts.length === 0) {
      return { items: [], mock: true };
    }

    const contactIds = contacts.map((c) => c.id);

    const related = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          inArray(businessEntities.entityType, ["deal", "invoice", "ticket"]),
        ),
      )
      .limit(5000);

    const byContact = new Map<
      string,
      {
        contact: (typeof contacts)[number];
        lastInvoiceAt: number | null;
        outstandingCents: number;
        openTickets: number;
        activeDeals: number;
      }
    >();
    for (const c of contacts) {
      byContact.set(c.id, {
        contact: c,
        lastInvoiceAt: null,
        outstandingCents: 0,
        openTickets: 0,
        activeDeals: 0,
      });
    }

    for (const r of related) {
      const data = (r.data ?? {}) as { contactId?: string; customerId?: string };
      const linked =
        (typeof data.contactId === "string" && data.contactId) ||
        (typeof data.customerId === "string" && data.customerId) ||
        r.parentId ||
        null;
      if (!linked || !byContact.has(linked)) continue;
      const bucket = byContact.get(linked)!;
      if (r.entityType === "invoice") {
        const createdMs = r.createdAt ? new Date(r.createdAt).getTime() : null;
        if (createdMs !== null) {
          bucket.lastInvoiceAt =
            bucket.lastInvoiceAt === null
              ? createdMs
              : Math.max(bucket.lastInvoiceAt, createdMs);
        }
        if (
          r.status === "sent" ||
          r.status === "overdue" ||
          r.status === "unpaid"
        ) {
          bucket.outstandingCents += r.amountCents ?? 0;
        }
      } else if (r.entityType === "ticket") {
        if (r.status !== "closed" && r.status !== "resolved") {
          bucket.openTickets += 1;
        }
      } else if (r.entityType === "deal") {
        if (
          ["prospecting", "qualified", "proposal", "negotiation"].includes(
            r.status,
          )
        ) {
          bucket.activeDeals += 1;
        }
      }
    }

    const now = Date.now();
    const scored: ChurnRiskItem[] = [];
    for (const bucket of byContact.values()) {
      let score = 0;
      const reasons: string[] = [];

      if (bucket.lastInvoiceAt === null) {
        score += 25;
        reasons.push("no invoices on record");
      } else {
        const days = (now - bucket.lastInvoiceAt) / (1000 * 60 * 60 * 24);
        if (days > 180) {
          score += 35;
          reasons.push(`no invoice in ${Math.round(days)} days`);
        } else if (days > 90) {
          score += 20;
          reasons.push(`last invoice ${Math.round(days)} days ago`);
        }
      }
      if (bucket.outstandingCents > 0) {
        score += Math.min(30, Math.round(bucket.outstandingCents / 10_000));
        reasons.push(
          `outstanding balance ${(bucket.outstandingCents / 100).toLocaleString()}`,
        );
      }
      if (bucket.openTickets > 0) {
        score += Math.min(25, bucket.openTickets * 10);
        reasons.push(`${bucket.openTickets} open ticket(s)`);
      }
      if (bucket.activeDeals === 0) {
        score += 10;
        reasons.push("no active deals");
      }

      if (score <= 0) continue;
      scored.push({
        contactId: bucket.contact.id,
        contactName: bucket.contact.name,
        score: Math.min(100, score),
        reasoning: reasons.join("; "),
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 10);

    // Optional LLM enrichment: ask for a one-line reasoning rewrite.
    // We keep the deterministic score and reasoning if no LLM is available.
    const llm = await getLLMClient();
    if (!llm || top.length === 0) {
      return { items: top, mock: !llm };
    }

    try {
      const system =
        "You are a customer-success analyst. Rewrite each customer's churn-risk reasoning into one concise sentence. " +
        "Respond with JSON: { \"items\": [{ \"contactId\": string, \"reasoning\": string }] }.";
      const user = JSON.stringify(
        top.map((i) => ({ contactId: i.contactId, raw: i.reasoning })),
      );
      const text = await llm.complete({ system, user, maxTokens: 800 });
      const parsed = tryParseJson<{
        items?: Array<{ contactId: string; reasoning: string }>;
      }>(text);
      if (parsed?.items) {
        const map = new Map(parsed.items.map((i) => [i.contactId, i.reasoning]));
        for (const item of top) {
          const r = map.get(item.contactId);
          if (r) item.reasoning = r;
        }
      }
    } catch {
      // ignore, keep deterministic reasoning
    }

    return { items: top };
  }

  // -------------------------------------------------------------------------
  // 6. Generate report narrative
  // -------------------------------------------------------------------------
  async function generateReportNarrative(
    reportType: "pnl" | "cash-flow" | "balance-sheet",
    reportData: unknown,
    lang: "en" | "ar" = "en",
  ): Promise<ReportNarrativeResult> {
    const system =
      lang === "ar"
        ? `أنت محلل مالي تنفيذي. اكتب ملخصاً تنفيذياً من ٣ فقرات للتقرير المالي بلغة عربية واضحة وبسيطة. ركز على الاتجاهات والمخاطر والفرص. لا تستخدم عناوين.`
        : "You are a CFO assistant. Write a 3-paragraph executive summary of the financial report in plain English. Focus on trends, risks, and opportunities. No headings.";
    const user = `Report type: ${reportType}\nData:\n${JSON.stringify(reportData, null, 2)}`;
    const result = await callLLM(system, user, { maxTokens: 900 });
    if (result.mock) {
      return {
        narrative: mockReportNarrative(reportType, lang),
        mock: true,
      };
    }
    return { narrative: result.text };
  }

  function mockReportNarrative(
    reportType: string,
    lang: "en" | "ar",
  ): string {
    if (lang === "ar") {
      return (
        `يقدم تقرير ${reportType} لمحة عن الأداء المالي للفترة الحالية. تشير الأرقام إلى أن النشاط التشغيلي مستقر بشكل عام، مع وجود فرص لتحسين الكفاءة.\n\n` +
        `من المهم متابعة المؤشرات الرئيسية مثل الإيرادات والمصروفات بشكل دوري لرصد أي انحرافات مبكراً.\n\n` +
        `التوصيات: مراجعة بنود المصروفات الكبرى وتعزيز التحصيل من العملاء لتحسين السيولة.`
      );
    }
    return (
      `The ${reportType} report shows the financial picture for the current period. Overall, operating activity appears stable, with several opportunities to improve efficiency.\n\n` +
      `Key indicators such as revenue mix and expense categories warrant regular review so that deviations are caught early.\n\n` +
      `Recommendations: revisit the largest expense lines and tighten collections to improve cash flow.`
    );
  }

  // -------------------------------------------------------------------------
  // 7. Classify ticket
  // -------------------------------------------------------------------------
  async function classifyTicket(
    companyId: string,
    ticketId: string,
  ): Promise<ClassifyTicketResult | { error: "not_found" | "wrong_entity_type" }> {
    const ticket = await getEntity(companyId, ticketId);
    if (!ticket) return { error: "not_found" };
    if (ticket.moduleKey !== "helpdesk" || ticket.entityType !== "ticket") {
      return { error: "wrong_entity_type" };
    }

    const data = (ticket.data ?? {}) as Record<string, unknown>;
    const subject = ticket.name ?? "";
    const body = typeof data.body === "string" ? data.body : "";

    const system =
      "You are a customer support triage agent. Classify the support ticket. " +
      "Respond with JSON: { \"category\": \"billing\"|\"technical\"|\"feature_request\"|\"complaint\"|\"other\", " +
      "\"priority\": \"low\"|\"normal\"|\"high\"|\"urgent\", \"suggested_response\": string }. " +
      "The suggested_response should be a polite, professional draft reply (2-4 sentences).";
    const user = `Subject: ${subject}\nBody: ${body}`;

    const result = await callLLM(system, user, { maxTokens: 600 });
    let classification: ClassifyTicketResult;
    if (result.mock) {
      classification = mockClassifyTicket(subject, body);
    } else {
      const parsed = tryParseJson<ClassifyTicketResult>(result.text);
      classification = parsed
        ? {
            category: normalizeCategory(parsed.category),
            priority: normalizePriority(parsed.priority),
            suggested_response: parsed.suggested_response ?? "",
          }
        : mockClassifyTicket(subject, body);
    }

    await updateEntityData(companyId, ticketId, {
      category: classification.category,
      priority: classification.priority,
      suggested_response: classification.suggested_response,
      classifiedAt: new Date().toISOString(),
    });

    return { ...classification, mock: result.mock };
  }

  function normalizeCategory(v: unknown): ClassifyTicketResult["category"] {
    if (
      v === "billing" ||
      v === "technical" ||
      v === "feature_request" ||
      v === "complaint" ||
      v === "other"
    ) {
      return v;
    }
    return "other";
  }

  function normalizePriority(v: unknown): ClassifyTicketResult["priority"] {
    if (v === "low" || v === "normal" || v === "high" || v === "urgent") return v;
    return "normal";
  }

  function mockClassifyTicket(subject: string, body: string): ClassifyTicketResult {
    const t = `${subject} ${body}`.toLowerCase();
    let category: ClassifyTicketResult["category"] = "other";
    if (/(invoice|charge|refund|billing|payment)/.test(t)) category = "billing";
    else if (/(bug|error|crash|broken|not working)/.test(t)) category = "technical";
    else if (/(feature|request|wish|would be nice)/.test(t))
      category = "feature_request";
    else if (/(angry|disappointed|complaint|terrible|unhappy)/.test(t))
      category = "complaint";

    let priority: ClassifyTicketResult["priority"] = "normal";
    if (/(urgent|asap|immediately|down|critical)/.test(t)) priority = "urgent";
    else if (/(important|soon|high)/.test(t)) priority = "high";
    else if (/(whenever|low|not urgent)/.test(t)) priority = "low";

    return {
      category,
      priority,
      suggested_response:
        `Hi, thanks for reaching out. We've received your message regarding "${subject}" and our team is looking into it. ` +
        `We'll get back to you with an update shortly. If anything else comes up in the meantime, feel free to reply to this thread.`,
    };
  }

  return {
    categorizeExpense,
    suggestNextAction,
    draftInvoiceFromText,
    summarizeCustomer,
    churnRisk,
    generateReportNarrative,
    classifyTicket,
  };
}

export type BusinessAiService = ReturnType<typeof createBusinessAiService>;
