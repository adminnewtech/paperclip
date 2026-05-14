import type { Db } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// LLM abstraction (mirrors business-ai-service.ts)
// ---------------------------------------------------------------------------
//
// The Anthropic SDK is not a hard dependency of this package. We resolve a
// client lazily via dynamic import, so this file typechecks even when the SDK
// is not installed. If neither the SDK nor an API key is available, every
// LLM-backed method returns a deterministic mock response so the UI keeps
// working in dev.

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
      async complete({ system, user, maxTokens = 1024, temperature = 0.1 }) {
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
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  try {
    return JSON.parse(raw.trim()) as T;
  } catch {
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

export type NlpIntent =
  | "create_invoice"
  | "create_expense"
  | "create_contact"
  | "create_deal"
  | "create_ticket"
  | "find_entity"
  | "show_report"
  | "unknown";

export interface NlpCommandResult {
  intent: NlpIntent;
  entities: Record<string, unknown>;
  confidence: number;
  suggestedUrl?: string;
  preview?: string;
  mock?: boolean;
}

export interface ReceiptExtraction {
  vendor?: string;
  date?: string;
  totalAmount?: number;
  currency?: string;
  vatAmount?: number;
  items?: Array<{ name: string; amount: number }>;
  category?: string;
  confidence: number;
  mock?: boolean;
}

export interface BusinessNlpService {
  parseCommand(text: string, lang?: "ar" | "en"): Promise<NlpCommandResult>;
  extractReceipt(rawText: string): Promise<ReceiptExtraction>;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const PARSE_COMMAND_SYSTEM = [
  "You are an NLP parser for a business management app. The user issues short commands in Arabic or English.",
  "Classify the command into exactly one of these intents:",
  "- create_invoice: making/issuing an invoice",
  "- create_expense: recording an expense or purchase",
  "- create_contact: adding a customer/lead/contact/supplier",
  "- create_deal: opening a sales opportunity/deal/pipeline entry",
  "- create_ticket: opening a support ticket/complaint",
  "- find_entity: searching for a record (contact, invoice, deal, etc.)",
  "- show_report: viewing a report (pnl, revenue, expenses, cash-flow, balance-sheet)",
  "- unknown: anything else",
  "",
  "Extract relevant entities (parameters) as a flat object. Examples:",
  '- "أنشئ فاتورة لعلي بـ 5000 ريال" → { customerName: "علي", amount: 5000, currency: "SAR" }',
  '- "create invoice for Ali 5000 SAR" → { customerName: "Ali", amount: 5000, currency: "SAR" }',
  '- "صرفت 200 ريال على البنزين" → { amount: 200, currency: "SAR", description: "بنزين", category: "Travel" }',
  '- "add contact Sara phone 0501234567" → { name: "Sara", phone: "0501234567" }',
  '- "show me last month revenue" → { reportType: "pnl", period: "last_month" }',
  "",
  "Respond with ONLY JSON in this exact shape:",
  '{ "intent": "<intent>", "entities": { ... }, "confidence": 0.0-1.0, "preview": "<one-sentence human-readable interpretation>" }',
].join("\n");

const EXTRACT_RECEIPT_SYSTEM = [
  "You are a receipt parser. The user provides OCR text from a receipt or invoice (Arabic or English).",
  "Extract structured fields. Numbers must be plain numbers (no currency symbols).",
  "Date should be ISO 8601 (YYYY-MM-DD) when possible.",
  "Category should be one of: Salaries, Rent, Marketing, Software, Travel, Utilities, Supplies, Professional Services, Insurance, Taxes, Other.",
  "",
  "Respond with ONLY JSON:",
  '{ "vendor"?: string, "date"?: string, "totalAmount"?: number, "currency"?: string, "vatAmount"?: number, "items"?: [{ "name": string, "amount": number }], "category"?: string, "confidence": 0.0-1.0 }',
].join("\n");

// ---------------------------------------------------------------------------
// Intent → suggested URL
// ---------------------------------------------------------------------------

function suggestedUrlFor(
  intent: NlpIntent,
  entities: Record<string, unknown>,
): string | undefined {
  switch (intent) {
    case "create_invoice":
      return "/business/sales?action=new-invoice";
    case "create_expense":
      return "/business/finance?action=new-expense";
    case "create_contact":
      return "/business/crm?action=new-contact";
    case "create_deal":
      return "/business/crm?action=new-deal";
    case "create_ticket":
      return "/business/helpdesk?action=new-ticket";
    case "find_entity": {
      const q =
        typeof entities.query === "string"
          ? entities.query
          : typeof entities.name === "string"
            ? entities.name
            : "";
      return q ? `/business/search?q=${encodeURIComponent(q)}` : "/business/search";
    }
    case "show_report": {
      const type =
        typeof entities.reportType === "string" ? entities.reportType : "pnl";
      return `/business/reports/${type}`;
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Mock fallback (regex-based intent detection)
// ---------------------------------------------------------------------------

function mockParseCommand(text: string, lang: "ar" | "en"): NlpCommandResult {
  const t = text.toLowerCase().trim();

  // Amount extraction (works for both ar/en when digits are western)
  const amountMatch = t.match(
    /(\d{1,3}(?:[,.\s]\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(sar|ريال|kwd|aed|درهم|دينار|usd|دولار|eur|يورو)?/i,
  );
  let amount: number | undefined;
  let currency: string | undefined;
  if (amountMatch) {
    amount = Number(amountMatch[1]!.replace(/[,\s]/g, ""));
    const cur = (amountMatch[2] ?? "").toLowerCase();
    if (cur === "sar" || cur === "ريال") currency = "SAR";
    else if (cur === "kwd" || cur === "دينار") currency = "KWD";
    else if (cur === "aed" || cur === "درهم") currency = "AED";
    else if (cur === "usd" || cur === "دولار") currency = "USD";
    else if (cur === "eur" || cur === "يورو") currency = "EUR";
  }

  const entities: Record<string, unknown> = {};
  if (amount !== undefined && !Number.isNaN(amount)) entities.amount = amount;
  if (currency) entities.currency = currency;

  let intent: NlpIntent = "unknown";
  let preview = "";

  const isArabic = /[؀-ۿ]/.test(text);

  if (/فاتورة|invoice|bill\b/i.test(t)) {
    intent = "create_invoice";
    // try to extract a customer name after "ل" or "for"
    const forMatch =
      text.match(/(?:لـ|ل\s|إلى\s+|لـ\s*)(\S+)/) ||
      text.match(/for\s+([A-Za-z؀-ۿ][\w؀-ۿ]*)/i);
    if (forMatch) entities.customerName = forMatch[1];
    preview = isArabic
      ? `إنشاء فاتورة${entities.customerName ? ` لـ ${entities.customerName}` : ""}${amount ? ` بـ ${amount} ${currency ?? ""}` : ""}`
      : `Create invoice${entities.customerName ? ` for ${entities.customerName}` : ""}${amount ? ` for ${amount} ${currency ?? ""}` : ""}`;
  } else if (/مصروف|expense|spent|صرفت|paid for|اشتريت/i.test(t)) {
    intent = "create_expense";
    if (/بنزين|fuel|gas/i.test(t)) entities.category = "Travel";
    else if (/مطعم|food|restaurant|طعام/i.test(t)) entities.category = "Other";
    else if (/إيجار|rent/i.test(t)) entities.category = "Rent";
    preview = isArabic
      ? `تسجيل مصروف${amount ? ` بقيمة ${amount} ${currency ?? ""}` : ""}`
      : `Record expense${amount ? ` of ${amount} ${currency ?? ""}` : ""}`;
  } else if (/(جهة اتصال|عميل|contact|customer|lead|add\s+\w+\s+phone)/i.test(t)) {
    intent = "create_contact";
    const nameMatch =
      text.match(/(?:contact|customer|lead|عميل|جهة اتصال)\s+([A-Za-z؀-ۿ][\w؀-ۿ]*)/i);
    if (nameMatch) entities.name = nameMatch[1];
    const phoneMatch = text.match(/(\+?\d[\d\s-]{6,})/);
    if (phoneMatch) entities.phone = phoneMatch[1]!.trim();
    preview = isArabic ? "إضافة جهة اتصال" : "Add new contact";
  } else if (/صفقة|deal|opportunity|فرصة/i.test(t)) {
    intent = "create_deal";
    preview = isArabic ? "إنشاء صفقة جديدة" : "Create new deal";
  } else if (/تذكرة|ticket|support|دعم|complaint|شكوى/i.test(t)) {
    intent = "create_ticket";
    preview = isArabic ? "فتح تذكرة دعم" : "Open support ticket";
  } else if (/(?:find|search|ابحث|بحث|أين|where is)/i.test(t)) {
    intent = "find_entity";
    entities.query = text;
    preview = isArabic ? "بحث" : "Search";
  } else if (/(?:report|تقرير|revenue|pnl|profit|cash[\s-]?flow|balance)/i.test(t)) {
    intent = "show_report";
    if (/cash[\s-]?flow|تدفق/i.test(t)) entities.reportType = "cash-flow";
    else if (/balance|ميزانية/i.test(t)) entities.reportType = "balance-sheet";
    else entities.reportType = "pnl";
    preview = isArabic ? "عرض التقرير المالي" : "Show financial report";
  } else {
    preview = isArabic ? "أمر غير مفهوم" : "Unknown command";
  }

  return {
    intent,
    entities,
    confidence: intent === "unknown" ? 0.2 : 0.55,
    suggestedUrl: suggestedUrlFor(intent, entities),
    preview,
    mock: true,
  };
}

function mockExtractReceipt(rawText: string): ReceiptExtraction {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Vendor: first non-empty line that isn't purely numeric/symbols.
  const vendor = lines.find(
    (l) => l.length > 2 && /[A-Za-z؀-ۿ]/.test(l),
  );

  // Date
  let date: string | undefined;
  const dateMatch = rawText.match(
    /(\d{4}[-/](\d{1,2})[-/](\d{1,2}))|((\d{1,2})[-/](\d{1,2})[-/](\d{2,4}))/,
  );
  if (dateMatch) {
    const raw = dateMatch[0];
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed.toISOString().slice(0, 10);
    } else {
      date = raw;
    }
  }

  // Total: prefer a line containing "total", else max number
  let totalAmount: number | undefined;
  const totalLine = lines.find((l) =>
    /(total|المجموع|الإجمالي|الاجمالي|grand total)/i.test(l),
  );
  if (totalLine) {
    const num = totalLine.match(/(\d+(?:[.,]\d+)?)/);
    if (num) totalAmount = Number(num[1]!.replace(",", "."));
  }
  if (totalAmount === undefined) {
    const nums = Array.from(rawText.matchAll(/(\d+(?:[.,]\d+)?)/g))
      .map((m) => Number(m[1]!.replace(",", ".")))
      .filter((n) => !Number.isNaN(n));
    if (nums.length > 0) totalAmount = Math.max(...nums);
  }

  // VAT
  let vatAmount: number | undefined;
  const vatLine = lines.find((l) => /(vat|ضريبة|tax)/i.test(l));
  if (vatLine) {
    const num = vatLine.match(/(\d+(?:[.,]\d+)?)/);
    if (num) vatAmount = Number(num[1]!.replace(",", "."));
  }

  // Currency
  let currency: string | undefined;
  if (/sar|ريال/i.test(rawText)) currency = "SAR";
  else if (/kwd|دينار/i.test(rawText)) currency = "KWD";
  else if (/aed|درهم/i.test(rawText)) currency = "AED";
  else if (/usd|\$/i.test(rawText)) currency = "USD";

  // Category guess
  let category: string | undefined;
  const t = rawText.toLowerCase();
  if (/restaurant|cafe|مطعم|كافيه|food/i.test(t)) category = "Other";
  else if (/fuel|gas|petrol|بنزين|محطة/i.test(t)) category = "Travel";
  else if (/uber|taxi|أوبر|تاكسي|flight|طيران|hotel|فندق/i.test(t))
    category = "Travel";
  else if (/office|stationery|قرطاسية/i.test(t)) category = "Supplies";

  return {
    vendor: vendor && vendor.length < 60 ? vendor : undefined,
    date,
    totalAmount,
    currency,
    vatAmount,
    category,
    confidence: totalAmount !== undefined ? 0.55 : 0.3,
    mock: true,
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createBusinessNlpService(_db: Db): BusinessNlpService {
  async function parseCommand(
    text: string,
    lang: "ar" | "en" = "ar",
  ): Promise<NlpCommandResult> {
    if (!text || text.trim().length === 0) {
      return {
        intent: "unknown",
        entities: {},
        confidence: 0,
        preview: "",
        mock: true,
      };
    }

    const user = `Command: ${text}\nUser language: ${lang}\n\nReturn JSON only.`;
    const result = await callLLM(PARSE_COMMAND_SYSTEM, user, {
      maxTokens: 400,
    });
    if (result.mock) {
      return mockParseCommand(text, lang);
    }
    const parsed = tryParseJson<{
      intent?: string;
      entities?: Record<string, unknown>;
      confidence?: number;
      preview?: string;
    }>(result.text);
    if (!parsed || !parsed.intent) {
      return mockParseCommand(text, lang);
    }
    const intent = normalizeIntent(parsed.intent);
    const entities =
      parsed.entities && typeof parsed.entities === "object"
        ? parsed.entities
        : {};
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.7;
    return {
      intent,
      entities,
      confidence,
      preview: typeof parsed.preview === "string" ? parsed.preview : "",
      suggestedUrl: suggestedUrlFor(intent, entities),
    };
  }

  async function extractReceipt(rawText: string): Promise<ReceiptExtraction> {
    if (!rawText || rawText.trim().length === 0) {
      return { confidence: 0, mock: true };
    }
    const user = `Receipt OCR text:\n${rawText}\n\nReturn JSON only.`;
    const result = await callLLM(EXTRACT_RECEIPT_SYSTEM, user, {
      maxTokens: 600,
    });
    if (result.mock) {
      return mockExtractReceipt(rawText);
    }
    const parsed = tryParseJson<ReceiptExtraction>(result.text);
    if (!parsed) {
      return mockExtractReceipt(rawText);
    }
    return {
      vendor: typeof parsed.vendor === "string" ? parsed.vendor : undefined,
      date: typeof parsed.date === "string" ? parsed.date : undefined,
      totalAmount:
        typeof parsed.totalAmount === "number" ? parsed.totalAmount : undefined,
      currency: typeof parsed.currency === "string" ? parsed.currency : undefined,
      vatAmount:
        typeof parsed.vatAmount === "number" ? parsed.vatAmount : undefined,
      items: Array.isArray(parsed.items)
        ? parsed.items
            .filter(
              (it): it is { name: string; amount: number } =>
                !!it &&
                typeof (it as { name?: unknown }).name === "string" &&
                typeof (it as { amount?: unknown }).amount === "number",
            )
            .map((it) => ({ name: it.name, amount: it.amount }))
        : undefined,
      category:
        typeof parsed.category === "string" ? parsed.category : undefined,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.6,
    };
  }

  return { parseCommand, extractReceipt };
}

function normalizeIntent(v: string): NlpIntent {
  const s = v.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (
    s === "create_invoice" ||
    s === "create_expense" ||
    s === "create_contact" ||
    s === "create_deal" ||
    s === "create_ticket" ||
    s === "find_entity" ||
    s === "show_report"
  ) {
    return s;
  }
  return "unknown";
}
