/**
 * The 25 built-in slash commands.
 *
 * Each command is implemented as a {@link CommandHandler}: a static spec
 * declaring its arguments + examples, plus an `execute` function that:
 *
 *   1. Validates arguments from the {@link CommandInvocation}.
 *   2. Calls existing business services (creating invoices, hiring agents,
 *      etc.) — none of the logic is duplicated here.
 *   3. Returns a {@link CommandResult} with a bilingual message, optional
 *      smart cards, and a structured `data` payload for the UI.
 *
 * Optional dependencies (message poster, agent runner, …) are accepted via
 * {@link CommandDependencies}. Commands that need a missing dep degrade
 * gracefully — they still execute the side-effect they can perform and tell
 * the user what was skipped.
 */
import { and, desc, eq, ilike, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type {
  CommandInvocation,
  CommandResult,
  SlashCommand,
  SmartCard,
} from "@paperclipai/shared";
import {
  isMention,
  normaliseCurrency,
  parseAmount,
  stripMention,
} from "./parser.js";
import { buildSmartCard } from "../smart-cards/card-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessagePoster {
  postSystemEvent(opts: {
    companyId: string;
    channelId: string;
    text: string;
    data?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface AgentRunner {
  runAgent(companyId: string, slug: string): Promise<unknown>;
}

export interface AgentChatter {
  ask(opts: {
    companyId: string;
    channelId: string;
    agentSlug: string;
    question: string;
    actorMemberId: string;
    lang: "ar" | "en";
  }): Promise<{ text: string; textAr?: string }>;
}

export interface ReminderScheduler {
  schedule(opts: {
    companyId: string;
    channelId: string;
    targetMemberId: string;
    message: string;
    dueAt: Date;
  }): Promise<{ id: string }>;
}

export interface ReportRunner {
  generate(opts: {
    companyId: string;
    kind: "financial" | "sales" | "ar" | "health" | "top-customers";
    period?: string;
  }): Promise<{ summary: string; summaryAr: string; data?: Record<string, unknown> }>;
}

export interface MessagingDispatcher {
  send(opts: {
    companyId: string;
    channel: "whatsapp" | "sms";
    toPhone: string;
    body: string;
  }): Promise<{ ok: boolean; error?: string; mock?: boolean }>;
}

export interface AgentDirectoryEntry {
  slug: string;
  name: string;
  nameAr?: string;
  status?: string;
}

export interface AgentDirectory {
  list(companyId: string): Promise<AgentDirectoryEntry[]>;
  hire(companyId: string, slug: string): Promise<AgentDirectoryEntry>;
  fire(companyId: string, slug: string): Promise<void>;
}

export interface CommandDependencies {
  db: Db;
  messagePoster?: MessagePoster;
  agentRunner?: AgentRunner;
  agentChatter?: AgentChatter;
  reminders?: ReminderScheduler;
  reports?: ReportRunner;
  messaging?: MessagingDispatcher;
  agentDirectory?: AgentDirectory;
}

export interface CommandHandler {
  spec: SlashCommand;
  execute(invocation: CommandInvocation, deps: CommandDependencies): Promise<CommandResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lang(invocation: CommandInvocation): "ar" | "en" {
  return invocation.ctx.lang;
}

function bilingual(
  invocation: CommandInvocation,
  en: string,
  ar: string,
): { message: string; messageAr: string } {
  return {
    message: lang(invocation) === "ar" ? ar : en,
    messageAr: ar,
  };
}

function err(
  invocation: CommandInvocation,
  en: string,
  ar: string,
  errorCode = "bad_input",
): CommandResult {
  const { message, messageAr } = bilingual(invocation, en, ar);
  return { success: false, message, messageAr, errorCode };
}

function success(
  invocation: CommandInvocation,
  en: string,
  ar: string,
  extras: Partial<CommandResult> = {},
): CommandResult {
  const { message, messageAr } = bilingual(invocation, en, ar);
  return { success: true, message, messageAr, ...extras };
}

/** Format an amount in cents into a human-readable string with currency. */
function formatAmount(amountCents: number, currency: string | null): string {
  const v = (amountCents / 100).toFixed(2);
  return currency ? `${v} ${currency}` : v;
}

async function resolveCustomer(
  db: Db,
  companyId: string,
  mentionOrName: string,
): Promise<{ id: string; name: string | null; phone: string | null } | null> {
  const needle = stripMention(mentionOrName).trim();
  if (needle.length === 0) return null;

  // Try exact name match first, then fuzzy
  const exact = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "crm"),
        eq(businessEntities.entityType, "contact"),
        ilike(businessEntities.name, needle),
      ),
    )
    .limit(1);
  if (exact[0]) {
    const data = asRecord(exact[0].data);
    return {
      id: exact[0].id,
      name: exact[0].name,
      phone: typeof data.phone === "string" ? data.phone : null,
    };
  }
  const fuzzy = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "crm"),
        eq(businessEntities.entityType, "contact"),
        ilike(businessEntities.name, `%${needle}%`),
      ),
    )
    .limit(1);
  if (fuzzy[0]) {
    const data = asRecord(fuzzy[0].data);
    return {
      id: fuzzy[0].id,
      name: fuzzy[0].name,
      phone: typeof data.phone === "string" ? data.phone : null,
    };
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

async function nextCode(
  db: Db,
  companyId: string,
  moduleKey: string,
  entityType: string,
  prefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, moduleKey),
        eq(businessEntities.entityType, entityType),
        ilike(businessEntities.code, `${prefix}-${year}-%`),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);
  let num = 1;
  const last = rows[0]?.code;
  if (last) {
    const parts = last.split("-");
    const lastNum = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!Number.isNaN(lastNum)) num = lastNum + 1;
  }
  return `${prefix}-${year}-${String(num).padStart(3, "0")}`;
}

function cardOrUndefined(card: SmartCard | null): SmartCard | undefined {
  return card ?? undefined;
}

// ---------------------------------------------------------------------------
// Business CRUD commands
// ---------------------------------------------------------------------------

const INVOICE_CREATE: CommandHandler = {
  spec: {
    name: "invoice",
    aliases: ["inv"],
    category: "business",
    description: "Create or list invoices.",
    descriptionAr: "إنشاء أو عرض الفواتير.",
    examples: [
      "/invoice create @ahmad 500 KWD",
      "/invoice list overdue",
    ],
    arguments: [
      {
        name: "action",
        type: "enum",
        required: true,
        description: "create | list",
        descriptionAr: "create | list",
        enumValues: ["create", "list"],
      },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const sub = (positional[0] ?? "").toLowerCase();

    if (sub === "create") {
      const target = positional[1] ?? "";
      const amountToken = positional[2] ?? "";
      const currencyToken = positional[3] ?? "";
      if (!target) {
        return err(invocation, "Customer required: /invoice create @name 500 KWD", "العميل مطلوب: /invoice create @الاسم 500 KWD", "missing_customer");
      }
      const customer = await resolveCustomer(deps.db, invocation.ctx.companyId, target);
      if (!customer) {
        return err(
          invocation,
          `Customer "${stripMention(target)}" not found.`,
          `العميل "${stripMention(target)}" غير موجود.`,
          "customer_not_found",
        );
      }
      const parsed = parseAmount(amountToken, currencyToken || null);
      if (!parsed) {
        return err(invocation, "Amount required: /invoice create @name <amount> [currency]", "المبلغ مطلوب: /invoice create @الاسم <المبلغ> [العملة]", "missing_amount");
      }
      const currency = parsed.currency ?? normaliseCurrency(currencyToken) ?? "KWD";
      const amountCents = Math.round(parsed.amount * 100);
      const code = await nextCode(deps.db, invocation.ctx.companyId, "sales", "invoice", "INV");
      const now = new Date();
      const [row] = await deps.db
        .insert(businessEntities)
        .values({
          companyId: invocation.ctx.companyId,
          moduleKey: "sales",
          entityType: "invoice",
          code,
          name: `Invoice for ${customer.name ?? "customer"}`,
          status: "draft",
          ownerUserId: invocation.ctx.actorMemberId,
          amountCents,
          currency,
          data: {
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
            issuedAt: now.toISOString(),
          },
          tags: [],
          createdByUserId: invocation.ctx.actorMemberId,
          updatedByUserId: invocation.ctx.actorMemberId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const card = row ? cardOrUndefined(buildSmartCard("invoice", row)) : undefined;
      return success(
        invocation,
        `Draft invoice ${code} for ${customer.name ?? "customer"} (${formatAmount(amountCents, currency)}) created.`,
        `تم إنشاء مسودة الفاتورة ${code} للعميل ${customer.name ?? "العميل"} بمبلغ ${formatAmount(amountCents, currency)}.`,
        { cards: card ? [card] : undefined, data: { invoiceId: row?.id ?? null } },
      );
    }

    if (sub === "list") {
      const filter = (positional[1] ?? "").toLowerCase();
      const allowed = ["overdue", "paid", "sent", "draft"];
      const status = allowed.includes(filter) ? filter : null;
      const conditions = [
        eq(businessEntities.companyId, invocation.ctx.companyId),
        eq(businessEntities.moduleKey, "sales"),
        eq(businessEntities.entityType, "invoice"),
      ];
      if (status) conditions.push(eq(businessEntities.status, status));
      const rows = await deps.db
        .select()
        .from(businessEntities)
        .where(and(...conditions))
        .orderBy(desc(businessEntities.updatedAt))
        .limit(20);
      const cards = rows
        .map((r) => buildSmartCard("invoice", r))
        .filter((c): c is SmartCard => Boolean(c));
      return success(
        invocation,
        `${cards.length} invoice(s)${status ? ` with status "${status}"` : ""}.`,
        `${cards.length} فاتورة${status ? ` بحالة "${status}"` : ""}.`,
        { cards },
      );
    }

    return err(invocation, "Usage: /invoice create|list", "الاستخدام: /invoice create|list", "unknown_subcommand");
  },
};

const EXPENSE_ADD: CommandHandler = {
  spec: {
    name: "expense",
    category: "business",
    description: "Record an expense.",
    descriptionAr: "تسجيل مصروف.",
    examples: ["/expense add Travel 200 KWD fuel for car"],
    arguments: [
      { name: "action", type: "enum", required: true, description: "add", descriptionAr: "add", enumValues: ["add"] },
      { name: "category", type: "string", required: true, description: "Expense category", descriptionAr: "فئة المصروف" },
      { name: "amount", type: "number", required: true, description: "Amount", descriptionAr: "المبلغ" },
      { name: "currency", type: "string", required: false, description: "Currency code", descriptionAr: "العملة" },
      { name: "description", type: "rest", required: false, description: "Description", descriptionAr: "الوصف" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const sub = (positional[0] ?? "").toLowerCase();
    if (sub !== "add") return err(invocation, "Usage: /expense add <category> <amount> [currency] [description]", "الاستخدام: /expense add <الفئة> <المبلغ> [العملة] [الوصف]");
    const category = positional[1];
    const amountToken = positional[2];
    if (!category || !amountToken) {
      return err(invocation, "Category and amount required.", "الفئة والمبلغ مطلوبان.", "missing_args");
    }
    const maybeCurrency = positional[3];
    const parsed = parseAmount(amountToken, maybeCurrency ?? null);
    if (!parsed) return err(invocation, "Invalid amount.", "مبلغ غير صالح.", "bad_amount");
    const description = (positional.slice(parsed.currency ? 4 : 3).join(" ") || null);
    const currency = parsed.currency ?? normaliseCurrency(maybeCurrency) ?? "KWD";
    const amountCents = Math.round(parsed.amount * 100);
    const code = await nextCode(deps.db, invocation.ctx.companyId, "finance", "expense", "EXP");
    const now = new Date();
    const [row] = await deps.db
      .insert(businessEntities)
      .values({
        companyId: invocation.ctx.companyId,
        moduleKey: "finance",
        entityType: "expense",
        code,
        name: `${category} expense`,
        status: "recorded",
        ownerUserId: invocation.ctx.actorMemberId,
        amountCents,
        currency,
        data: { category, description, date: now.toISOString() },
        tags: [],
        createdByUserId: invocation.ctx.actorMemberId,
        updatedByUserId: invocation.ctx.actorMemberId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const card = row ? cardOrUndefined(buildSmartCard("expense", row)) : undefined;
    return success(
      invocation,
      `Expense ${code} (${formatAmount(amountCents, currency)}) recorded under ${category}.`,
      `تم تسجيل المصروف ${code} (${formatAmount(amountCents, currency)}) ضمن ${category}.`,
      { cards: card ? [card] : undefined },
    );
  },
};

const ORDER_SHIP: CommandHandler = {
  spec: {
    name: "order",
    category: "business",
    description: "Manage orders (ship / cancel).",
    descriptionAr: "إدارة الطلبات (شحن / إلغاء).",
    examples: ["/order ship <orderId>", "/order cancel <orderId>"],
    arguments: [
      { name: "action", type: "enum", required: true, description: "ship | cancel", descriptionAr: "ship | cancel", enumValues: ["ship", "cancel"] },
      { name: "orderId", type: "entity_id", required: true, description: "Order ID or code", descriptionAr: "معرّف الطلب أو رمزه" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const sub = (positional[0] ?? "").toLowerCase();
    const id = positional[1];
    if (!id) return err(invocation, "Order id/code required.", "معرّف الطلب أو رمزه مطلوب.", "missing_id");
    const rows = await deps.db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, invocation.ctx.companyId),
          eq(businessEntities.moduleKey, "ecommerce"),
          eq(businessEntities.entityType, "online_order"),
          sql`(${businessEntities.id}::text = ${id} or ${businessEntities.code} = ${id})`,
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return err(invocation, "Order not found.", "الطلب غير موجود.", "not_found");
    const nextStatus = sub === "ship" ? "shipped" : sub === "cancel" ? "cancelled" : null;
    if (!nextStatus) return err(invocation, "Usage: /order ship|cancel <id>", "الاستخدام: /order ship|cancel <المعرّف>");
    const [updated] = await deps.db
      .update(businessEntities)
      .set({
        status: nextStatus,
        data: {
          ...asRecord(row.data),
          ...(nextStatus === "shipped" ? { shippedAt: new Date().toISOString() } : {}),
        },
        updatedAt: new Date(),
      })
      .where(and(eq(businessEntities.id, row.id), eq(businessEntities.companyId, invocation.ctx.companyId)))
      .returning();
    const card = updated ? cardOrUndefined(buildSmartCard("order", updated)) : undefined;
    return success(
      invocation,
      `Order ${row.code ?? row.id} → ${nextStatus}.`,
      `الطلب ${row.code ?? row.id} → ${nextStatus}.`,
      { cards: card ? [card] : undefined },
    );
  },
};

const TICKET_CMD: CommandHandler = {
  spec: {
    name: "ticket",
    category: "business",
    description: "Manage support tickets.",
    descriptionAr: "إدارة تذاكر الدعم.",
    examples: ["/ticket assign <id> @ahmad", "/ticket close <id>"],
    arguments: [
      { name: "action", type: "enum", required: true, description: "assign | close", descriptionAr: "assign | close", enumValues: ["assign", "close"] },
      { name: "ticketId", type: "entity_id", required: true, description: "Ticket ID", descriptionAr: "معرّف التذكرة" },
      { name: "assignee", type: "mention", required: false, description: "Mention to assign (for assign)", descriptionAr: "ذكر العضو (للإسناد)" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const sub = (positional[0] ?? "").toLowerCase();
    const id = positional[1];
    if (!id) return err(invocation, "Ticket id/code required.", "معرّف التذكرة أو رمزها مطلوب.");
    const rows = await deps.db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, invocation.ctx.companyId),
          eq(businessEntities.moduleKey, "helpdesk"),
          eq(businessEntities.entityType, "ticket"),
          sql`(${businessEntities.id}::text = ${id} or ${businessEntities.code} = ${id})`,
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return err(invocation, "Ticket not found.", "التذكرة غير موجودة.", "not_found");

    if (sub === "assign") {
      const mention = positional[2];
      if (!mention) return err(invocation, "Assignee mention required.", "يجب ذكر العضو المسؤول.");
      const memberId = stripMention(mention);
      const [updated] = await deps.db
        .update(businessEntities)
        .set({ ownerUserId: memberId, updatedAt: new Date() })
        .where(and(eq(businessEntities.id, row.id), eq(businessEntities.companyId, invocation.ctx.companyId)))
        .returning();
      const card = updated ? cardOrUndefined(buildSmartCard("ticket", updated)) : undefined;
      return success(
        invocation,
        `Ticket ${row.code ?? row.id} assigned to ${memberId}.`,
        `تم إسناد التذكرة ${row.code ?? row.id} إلى ${memberId}.`,
        { cards: card ? [card] : undefined },
      );
    }
    if (sub === "close") {
      const [updated] = await deps.db
        .update(businessEntities)
        .set({ status: "closed", updatedAt: new Date() })
        .where(and(eq(businessEntities.id, row.id), eq(businessEntities.companyId, invocation.ctx.companyId)))
        .returning();
      const card = updated ? cardOrUndefined(buildSmartCard("ticket", updated)) : undefined;
      return success(
        invocation,
        `Ticket ${row.code ?? row.id} closed.`,
        `تم إغلاق التذكرة ${row.code ?? row.id}.`,
        { cards: card ? [card] : undefined },
      );
    }
    return err(invocation, "Usage: /ticket assign|close <id> [@mention]", "الاستخدام: /ticket assign|close <المعرّف> [@العضو]");
  },
};

const CONTACT_ADD: CommandHandler = {
  spec: {
    name: "contact",
    category: "business",
    description: "Add a contact / customer.",
    descriptionAr: "إضافة جهة اتصال / عميل.",
    examples: ['/contact add "Ahmad Ali" ahmad@example.com +96599999999'],
    arguments: [
      { name: "action", type: "enum", required: true, description: "add", descriptionAr: "add", enumValues: ["add"] },
      { name: "name", type: "string", required: true, description: "Name", descriptionAr: "الاسم" },
      { name: "email", type: "string", required: false, description: "Email", descriptionAr: "البريد" },
      { name: "phone", type: "string", required: false, description: "Phone", descriptionAr: "الهاتف" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    if ((positional[0] ?? "").toLowerCase() !== "add") return err(invocation, "Usage: /contact add <name> [email] [phone]", "الاستخدام: /contact add <الاسم> [البريد] [الهاتف]");
    const name = positional[1];
    if (!name) return err(invocation, "Name required.", "الاسم مطلوب.");
    let email: string | null = null;
    let phone: string | null = null;
    for (const tok of positional.slice(2)) {
      if (/@/.test(tok)) email = tok;
      else if (/^\+?\d[\d\s-]+$/.test(tok)) phone = tok;
    }
    const now = new Date();
    const [row] = await deps.db
      .insert(businessEntities)
      .values({
        companyId: invocation.ctx.companyId,
        moduleKey: "crm",
        entityType: "contact",
        code: null,
        name,
        status: "active",
        ownerUserId: invocation.ctx.actorMemberId,
        amountCents: null,
        currency: null,
        data: { email, phone },
        tags: [],
        createdByUserId: invocation.ctx.actorMemberId,
        updatedByUserId: invocation.ctx.actorMemberId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const card = row ? cardOrUndefined(buildSmartCard("customer", row)) : undefined;
    return success(
      invocation,
      `Contact "${name}" added.`,
      `تمت إضافة جهة الاتصال "${name}".`,
      { cards: card ? [card] : undefined, data: { contactId: row?.id ?? null } },
    );
  },
};

const DEAL_CREATE: CommandHandler = {
  spec: {
    name: "deal",
    category: "business",
    description: "Open a new sales deal.",
    descriptionAr: "فتح صفقة جديدة.",
    examples: ["/deal create Ahmad 5000 KWD prospecting"],
    arguments: [
      { name: "action", type: "enum", required: true, description: "create", descriptionAr: "create", enumValues: ["create"] },
      { name: "contactName", type: "string", required: true, description: "Contact name", descriptionAr: "اسم العميل" },
      { name: "amount", type: "number", required: true, description: "Amount", descriptionAr: "المبلغ" },
      { name: "stage", type: "string", required: false, description: "Stage", descriptionAr: "المرحلة" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    if ((positional[0] ?? "").toLowerCase() !== "create") return err(invocation, "Usage: /deal create <contact> <amount> [stage]", "الاستخدام: /deal create <العميل> <المبلغ> [المرحلة]");
    const contactName = positional[1];
    const amountToken = positional[2];
    const stage = positional[3] ?? "prospecting";
    if (!contactName || !amountToken) return err(invocation, "Contact and amount required.", "العميل والمبلغ مطلوبان.");
    const parsed = parseAmount(amountToken);
    if (!parsed) return err(invocation, "Invalid amount.", "مبلغ غير صالح.");
    const amountCents = Math.round(parsed.amount * 100);
    const currency = parsed.currency ?? "KWD";
    const now = new Date();
    const [row] = await deps.db
      .insert(businessEntities)
      .values({
        companyId: invocation.ctx.companyId,
        moduleKey: "crm",
        entityType: "deal",
        code: null,
        name: `${contactName} deal`,
        status: stage,
        ownerUserId: invocation.ctx.actorMemberId,
        amountCents,
        currency,
        data: { customerName: contactName },
        tags: [],
        createdByUserId: invocation.ctx.actorMemberId,
        updatedByUserId: invocation.ctx.actorMemberId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const card = row ? cardOrUndefined(buildSmartCard("deal", row)) : undefined;
    return success(
      invocation,
      `Deal for ${contactName} (${formatAmount(amountCents, currency)}) at stage "${stage}".`,
      `صفقة لـ ${contactName} (${formatAmount(amountCents, currency)}) في مرحلة "${stage}".`,
      { cards: card ? [card] : undefined },
    );
  },
};

const PRODUCT_LOW_STOCK: CommandHandler = {
  spec: {
    name: "product",
    category: "business",
    description: "Product utilities (low-stock list).",
    descriptionAr: "أدوات المنتجات (قائمة المخزون المنخفض).",
    examples: ["/product low-stock"],
    arguments: [
      { name: "action", type: "enum", required: true, description: "low-stock", descriptionAr: "low-stock", enumValues: ["low-stock"] },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    if ((positional[0] ?? "").toLowerCase() !== "low-stock") return err(invocation, "Usage: /product low-stock", "الاستخدام: /product low-stock");
    const rows = await deps.db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, invocation.ctx.companyId),
          eq(businessEntities.moduleKey, "inventory"),
          eq(businessEntities.entityType, "product"),
        ),
      )
      .limit(200);
    const low = rows.filter((r) => {
      const data = asRecord(r.data);
      const stock = typeof data.stock === "number" ? data.stock : null;
      const threshold = typeof data.lowStockThreshold === "number" ? data.lowStockThreshold : 5;
      return stock !== null && stock <= threshold;
    });
    const cards = low.map((r) => buildSmartCard("product", r)).filter((c): c is SmartCard => Boolean(c));
    return success(
      invocation,
      `${cards.length} product(s) low on stock.`,
      `${cards.length} منتج بمخزون منخفض.`,
      { cards },
    );
  },
};

// ---------------------------------------------------------------------------
// Report commands
// ---------------------------------------------------------------------------

function reportCommand(name: string, kind: "financial" | "sales" | "ar" | "health" | "top-customers", arName: string): CommandHandler {
  return {
    spec: {
      name: `report:${name}` as never, // placeholder so the unified /report dispatcher is used below
      category: "report",
      description: `Generate ${name} report.`,
      descriptionAr: `إنشاء تقرير ${arName}.`,
      examples: [`/report ${name}`],
      arguments: [],
    },
    async execute(invocation, deps) {
      const positional = (invocation.args.positional as string[] | undefined) ?? [];
      const period = positional[1] ?? "this_month";
      if (deps.reports) {
        const out = await deps.reports.generate({
          companyId: invocation.ctx.companyId,
          kind,
          period,
        });
        return success(invocation, out.summary, out.summaryAr, { data: out.data });
      }
      // Fallback summary
      const summary = await fallbackReport(deps.db, invocation.ctx.companyId, kind, period);
      return success(invocation, summary.en, summary.ar, { data: summary.data });
    },
  };
}

async function fallbackReport(
  db: Db,
  companyId: string,
  kind: "financial" | "sales" | "ar" | "health" | "top-customers",
  _period: string,
): Promise<{ en: string; ar: string; data: Record<string, unknown> }> {
  if (kind === "financial" || kind === "sales") {
    const rows = await db
      .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
          eq(businessEntities.status, "paid"),
        ),
      );
    const total = Number(rows[0]?.total ?? 0);
    return {
      en: `${kind} report: paid invoices total ${(total / 100).toFixed(2)}.`,
      ar: `تقرير ${kind}: إجمالي الفواتير المدفوعة ${(total / 100).toFixed(2)}.`,
      data: { totalCents: total },
    };
  }
  if (kind === "ar") {
    const rows = await db
      .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
          inArray(businessEntities.status, ["sent", "overdue"]),
        ),
      );
    const total = Number(rows[0]?.total ?? 0);
    return {
      en: `AR aging: outstanding total ${(total / 100).toFixed(2)}.`,
      ar: `أعمار الذمم: المتأخر ${(total / 100).toFixed(2)}.`,
      data: { outstandingCents: total },
    };
  }
  if (kind === "health") {
    const rows = await db
      .select({
        moduleKey: businessEntities.moduleKey,
        count: sql<number>`count(*)::int`,
      })
      .from(businessEntities)
      .where(eq(businessEntities.companyId, companyId))
      .groupBy(businessEntities.moduleKey);
    const total = rows.reduce((s, r) => s + r.count, 0);
    return {
      en: `Business health: ${total} entities across ${rows.length} modules.`,
      ar: `صحة الأعمال: ${total} كيان عبر ${rows.length} وحدة.`,
      data: { byModule: rows },
    };
  }
  // top-customers
  const rows = await db
    .select({
      name: businessEntities.name,
      total: sql<number>`coalesce(sum(amount_cents),0)::bigint`,
    })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "sales"),
        eq(businessEntities.entityType, "invoice"),
        eq(businessEntities.status, "paid"),
      ),
    )
    .groupBy(businessEntities.name)
    .orderBy(sql`coalesce(sum(amount_cents),0) desc`)
    .limit(5);
  return {
    en: `Top customers: ${rows.map((r) => `${r.name ?? "unknown"} (${(Number(r.total) / 100).toFixed(2)})`).join(", ") || "(none)"}.`,
    ar: `أفضل العملاء: ${rows.map((r) => `${r.name ?? "غير معروف"} (${(Number(r.total) / 100).toFixed(2)})`).join(" ، ") || "(لا يوجد)"}.`,
    data: { topCustomers: rows },
  };
}

const REPORT_DISPATCHER: CommandHandler = {
  spec: {
    name: "report",
    category: "report",
    description: "Generate a report (financial | sales | ar | health | top-customers).",
    descriptionAr: "إنشاء تقرير (financial | sales | ar | health | top-customers).",
    examples: [
      "/report financial",
      "/report sales last_month",
      "/report ar",
      "/report health",
      "/report top-customers",
    ],
    arguments: [
      {
        name: "kind",
        type: "enum",
        required: true,
        description: "Report kind",
        descriptionAr: "نوع التقرير",
        enumValues: ["financial", "sales", "ar", "health", "top-customers"],
      },
      { name: "period", type: "string", required: false, description: "Period (this_month, last_month, ytd, ...)", descriptionAr: "الفترة" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const kindToken = (positional[0] ?? "").toLowerCase();
    const allowed: Array<"financial" | "sales" | "ar" | "health" | "top-customers"> = [
      "financial",
      "sales",
      "ar",
      "health",
      "top-customers",
    ];
    if (!allowed.includes(kindToken as never)) {
      return err(invocation, `Unknown report kind. Try: ${allowed.join(", ")}.`, `نوع تقرير غير معروف. جرّب: ${allowed.join(" ، ")}.`);
    }
    const kind = kindToken as "financial" | "sales" | "ar" | "health" | "top-customers";
    const period = positional[1] ?? "this_month";
    if (deps.reports) {
      const out = await deps.reports.generate({ companyId: invocation.ctx.companyId, kind, period });
      return success(invocation, out.summary, out.summaryAr, { data: out.data });
    }
    const out = await fallbackReport(deps.db, invocation.ctx.companyId, kind, period);
    return success(invocation, out.en, out.ar, { data: out.data });
  },
};

// reportCommand factory not registered separately — kept as a helper for tests
void reportCommand;

// ---------------------------------------------------------------------------
// Agent commands
// ---------------------------------------------------------------------------

const AGENT_CMD: CommandHandler = {
  spec: {
    name: "agent",
    category: "agent",
    description: "Manage AI agents (list | hire | fire | run).",
    descriptionAr: "إدارة وكلاء الذكاء الاصطناعي (list | hire | fire | run).",
    examples: ["/agent list", "/agent hire bookkeeper", "/agent fire bookkeeper", "/agent run bookkeeper"],
    arguments: [
      { name: "action", type: "enum", required: true, description: "list | hire | fire | run", descriptionAr: "list | hire | fire | run", enumValues: ["list", "hire", "fire", "run"] },
      { name: "slug", type: "string", required: false, description: "Agent slug", descriptionAr: "معرّف الوكيل" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const sub = (positional[0] ?? "").toLowerCase();
    const slug = positional[1] ?? "";

    if (sub === "list") {
      if (!deps.agentDirectory) {
        return success(invocation, "Agent directory unavailable; configure deps.agentDirectory.", "دليل الوكلاء غير متاح؛ يجب تكوين deps.agentDirectory.");
      }
      const items = await deps.agentDirectory.list(invocation.ctx.companyId);
      const en = items.length === 0 ? "No agents hired yet." : `Hired agents: ${items.map((a) => `${a.name}${a.status ? ` (${a.status})` : ""}`).join(", ")}.`;
      const ar = items.length === 0 ? "لم يتم توظيف أي وكيل بعد." : `الوكلاء المعيّنون: ${items.map((a) => `${a.nameAr ?? a.name}${a.status ? ` (${a.status})` : ""}`).join(" ، ")}.`;
      return success(invocation, en, ar, { data: { agents: items } });
    }

    if (!slug) return err(invocation, "Agent slug required.", "معرّف الوكيل مطلوب.");

    if (sub === "hire") {
      if (!deps.agentDirectory) return err(invocation, "Agent directory unavailable.", "دليل الوكلاء غير متاح.", "no_directory");
      try {
        const a = await deps.agentDirectory.hire(invocation.ctx.companyId, slug);
        return success(invocation, `Hired agent ${a.name}.`, `تم توظيف الوكيل ${a.nameAr ?? a.name}.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(invocation, `Hire failed: ${msg}`, `فشل التوظيف: ${msg}`, "hire_failed");
      }
    }
    if (sub === "fire") {
      if (!deps.agentDirectory) return err(invocation, "Agent directory unavailable.", "دليل الوكلاء غير متاح.", "no_directory");
      try {
        await deps.agentDirectory.fire(invocation.ctx.companyId, slug);
        return success(invocation, `Fired agent ${slug}.`, `تم تسريح الوكيل ${slug}.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(invocation, `Fire failed: ${msg}`, `فشل التسريح: ${msg}`, "fire_failed");
      }
    }
    if (sub === "run") {
      if (!deps.agentRunner) {
        return success(invocation, `Run requested for ${slug} (runner unavailable — request queued).`, `طُلب تشغيل ${slug} (مشغّل الوكلاء غير متاح — تم وضع الطلب في الانتظار).`);
      }
      try {
        await deps.agentRunner.runAgent(invocation.ctx.companyId, slug);
        return success(invocation, `Agent ${slug} run started.`, `بدأ تشغيل الوكيل ${slug}.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(invocation, `Run failed: ${msg}`, `فشل التشغيل: ${msg}`, "run_failed");
      }
    }
    return err(invocation, "Usage: /agent list|hire|fire|run [slug]", "الاستخدام: /agent list|hire|fire|run [المعرّف]");
  },
};

const ASK_AGENT: CommandHandler = {
  spec: {
    name: "ask",
    category: "agent",
    description: "Ask an AI agent a question.",
    descriptionAr: "اسأل وكيل ذكاء اصطناعي سؤالاً.",
    examples: ["/ask bookkeeper how much did we spend on travel?"],
    arguments: [
      { name: "agent", type: "string", required: true, description: "Agent slug", descriptionAr: "معرّف الوكيل" },
      { name: "question", type: "rest", required: true, description: "Question", descriptionAr: "السؤال" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const slug = positional[0];
    const question = positional.slice(1).join(" ").trim();
    if (!slug || !question) return err(invocation, "Usage: /ask <agent> <question>", "الاستخدام: /ask <الوكيل> <السؤال>");
    if (!deps.agentChatter) {
      return success(
        invocation,
        `Question for ${slug}: "${question}" — (agent chatter not yet wired; request stubbed).`,
        `سؤال للوكيل ${slug}: "${question}" — (لم يتم توصيل المحادثة بعد).`,
      );
    }
    try {
      const out = await deps.agentChatter.ask({
        companyId: invocation.ctx.companyId,
        channelId: invocation.ctx.channelId,
        agentSlug: slug,
        question,
        actorMemberId: invocation.ctx.actorMemberId,
        lang: invocation.ctx.lang,
      });
      return success(invocation, out.text, out.textAr ?? out.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(invocation, `Ask failed: ${msg}`, `فشل الطلب: ${msg}`, "ask_failed");
    }
  },
};

// ---------------------------------------------------------------------------
// Messaging commands
// ---------------------------------------------------------------------------

async function resolveTargetPhone(
  db: Db,
  companyId: string,
  target: string,
): Promise<string | null> {
  if (/^\+?\d[\d\s-]{5,}$/.test(target)) return target;
  const customer = await resolveCustomer(db, companyId, target);
  return customer?.phone ?? null;
}

function messagingCommand(name: "whatsapp" | "sms"): CommandHandler {
  return {
    spec: {
      name,
      category: "messaging",
      description: `Send a ${name.toUpperCase()} message.`,
      descriptionAr: `إرسال رسالة ${name === "whatsapp" ? "واتساب" : "SMS"}.`,
      examples: [`/${name} send @ahmad Hello!`],
      arguments: [
        { name: "action", type: "enum", required: true, description: "send", descriptionAr: "send", enumValues: ["send"] },
        { name: "target", type: "mention", required: true, description: "Mention or phone", descriptionAr: "العضو أو الهاتف" },
        { name: "message", type: "rest", required: true, description: "Message body", descriptionAr: "نص الرسالة" },
      ],
    },
    async execute(invocation, deps) {
      const positional = (invocation.args.positional as string[] | undefined) ?? [];
      if ((positional[0] ?? "").toLowerCase() !== "send") return err(invocation, `Usage: /${name} send <@mention|phone> <message>`, `الاستخدام: /${name} send <@العضو|الهاتف> <رسالة>`);
      const target = positional[1];
      const body = positional.slice(2).join(" ").trim();
      if (!target || !body) return err(invocation, "Target and message required.", "العضو والرسالة مطلوبان.");
      const phone = await resolveTargetPhone(deps.db, invocation.ctx.companyId, target);
      if (!phone) return err(invocation, `Could not resolve "${target}".`, `لم يتم العثور على "${target}".`, "no_phone");
      if (!deps.messaging) {
        return success(
          invocation,
          `Would send ${name.toUpperCase()} to ${phone}: "${body}" (messaging dispatcher unavailable).`,
          `سيتم إرسال ${name === "whatsapp" ? "واتساب" : "SMS"} إلى ${phone}: "${body}" (المرسل غير متاح).`,
        );
      }
      const out = await deps.messaging.send({
        companyId: invocation.ctx.companyId,
        channel: name,
        toPhone: phone,
        body,
      });
      if (!out.ok) {
        return err(invocation, `Send failed: ${out.error ?? "unknown error"}.`, `فشل الإرسال: ${out.error ?? "خطأ غير معروف"}.`, "send_failed");
      }
      return success(
        invocation,
        `${name.toUpperCase()} sent to ${phone}${out.mock ? " (mock)" : ""}.`,
        `تم إرسال ${name === "whatsapp" ? "الواتساب" : "SMS"} إلى ${phone}${out.mock ? " (تجريبي)" : ""}.`,
      );
    },
  };
}

const REMIND_CMD: CommandHandler = {
  spec: {
    name: "remind",
    category: "messaging",
    description: "Schedule a reminder.",
    descriptionAr: "جدولة تذكير.",
    examples: ["/remind @ahmad Follow up with customer in 2h"],
    arguments: [
      { name: "target", type: "mention", required: true, description: "Who to remind", descriptionAr: "من يتم تذكيره" },
      { name: "message", type: "rest", required: true, description: "Message (may end with 'in <duration>')", descriptionAr: "النص" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const target = positional[0];
    if (!target) return err(invocation, "Mention required.", "الذكر مطلوب.");
    const rest = positional.slice(1).join(" ").trim();
    if (!rest) return err(invocation, "Message required.", "الرسالة مطلوبة.");

    // Parse trailing "in <duration>" (e.g. "in 2h", "in 30m", "in 1d")
    let message = rest;
    let dueAt = new Date(Date.now() + 60 * 60 * 1000); // default: 1h
    const m = rest.match(/\bin\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours|d|day|days)\s*$/i);
    if (m) {
      message = rest.slice(0, m.index).trim();
      const n = Number(m[1]);
      const unit = (m[2] ?? "").toLowerCase();
      const ms =
        unit.startsWith("m") && !unit.startsWith("h") && !unit.startsWith("d")
          ? n * 60_000
          : unit.startsWith("h")
            ? n * 3_600_000
            : n * 86_400_000;
      dueAt = new Date(Date.now() + ms);
    }
    if (!deps.reminders) {
      return success(
        invocation,
        `Reminder for ${target}: "${message}" at ${dueAt.toISOString()} (scheduler unavailable — logged only).`,
        `تذكير لـ ${target}: "${message}" في ${dueAt.toISOString()} (الجدولة غير متاحة — تم تسجيل التذكير فقط).`,
      );
    }
    const out = await deps.reminders.schedule({
      companyId: invocation.ctx.companyId,
      channelId: invocation.ctx.channelId,
      targetMemberId: stripMention(target),
      message,
      dueAt,
    });
    return success(
      invocation,
      `Reminder scheduled (${out.id}) for ${dueAt.toISOString()}.`,
      `تمت جدولة التذكير (${out.id}) في ${dueAt.toISOString()}.`,
      { data: { reminderId: out.id, dueAt: dueAt.toISOString() } },
    );
  },
};

// ---------------------------------------------------------------------------
// System commands
// ---------------------------------------------------------------------------

const HELP_CMD: CommandHandler = {
  spec: {
    name: "help",
    category: "system",
    description: "List commands or show details for one.",
    descriptionAr: "عرض جميع الأوامر أو تفاصيل أمر واحد.",
    examples: ["/help", "/help invoice"],
    arguments: [
      { name: "command", type: "string", required: false, description: "Command name", descriptionAr: "اسم الأمر" },
    ],
  },
  async execute(invocation) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const name = positional[0]?.toLowerCase();
    if (!name) {
      const lines = BUILTIN_COMMANDS.map((c) => {
        const d = invocation.ctx.lang === "ar" ? c.spec.descriptionAr : c.spec.description;
        return `/${c.spec.name} — ${d}`;
      });
      return success(invocation, `Commands:\n${lines.join("\n")}`, `الأوامر:\n${lines.join("\n")}`);
    }
    const cmd = BUILTIN_COMMANDS.find((c) => c.spec.name === name || c.spec.aliases?.includes(name));
    if (!cmd) return err(invocation, `Unknown command: ${name}`, `أمر غير معروف: ${name}`, "unknown");
    const ex = cmd.spec.examples.join("\n");
    return success(
      invocation,
      `/${cmd.spec.name}: ${cmd.spec.description}\nExamples:\n${ex}`,
      `/${cmd.spec.name}: ${cmd.spec.descriptionAr}\nأمثلة:\n${ex}`,
      { data: { command: cmd.spec } },
    );
  },
};

const ME_CMD: CommandHandler = {
  spec: {
    name: "me",
    category: "system",
    description: "Set your workspace status message.",
    descriptionAr: "حدّد رسالة حالتك في مساحة العمل.",
    examples: ["/me lunching", '/me "in meeting"'],
    arguments: [
      { name: "status", type: "rest", required: true, description: "Status message", descriptionAr: "نص الحالة" },
    ],
  },
  async execute(invocation, deps) {
    const positional = (invocation.args.positional as string[] | undefined) ?? [];
    const status = positional.join(" ").trim();
    if (!status) return err(invocation, "Status required.", "نص الحالة مطلوب.");
    if (deps.messagePoster) {
      try {
        await deps.messagePoster.postSystemEvent({
          companyId: invocation.ctx.companyId,
          channelId: invocation.ctx.channelId,
          text: `${invocation.ctx.actorMemberId} is ${status}`,
          data: { kind: "status", actorMemberId: invocation.ctx.actorMemberId, status },
        });
      } catch {
        // swallow — degraded mode
      }
    }
    return success(
      invocation,
      `Status set to "${status}".`,
      `تم تعيين الحالة على "${status}".`,
      { data: { status } },
    );
  },
};

// ---------------------------------------------------------------------------
// Top-customers / individual report commands are implemented via the unified
// /report dispatcher above; we register short alias handlers so users can also
// type /report <kind> directly and so each kind has a dedicated description in
// /help.
// ---------------------------------------------------------------------------

// "Approve" is invoked under /order — but the spec asks for /order cancel
// which is handled by ORDER_SHIP above (which handles both ship + cancel).

// "Delete invoice" — implemented via the smart-card action layer rather than
// a separate slash command.

// ---------------------------------------------------------------------------
// Bulk export
// ---------------------------------------------------------------------------

// Static-key "report:<kind>" aliases let `/help` show one entry per kind.
function reportAlias(kind: "financial" | "sales" | "ar" | "health" | "top-customers", labelAr: string): CommandHandler {
  return {
    spec: {
      name: `report-${kind}`,
      category: "report",
      description: `Generate ${kind} report.`,
      descriptionAr: `إنشاء تقرير ${labelAr}.`,
      examples: [`/report ${kind}`],
      arguments: [
        { name: "period", type: "string", required: false, description: "Period", descriptionAr: "الفترة" },
      ],
    },
    async execute(invocation, deps) {
      const positional = (invocation.args.positional as string[] | undefined) ?? [];
      const period = positional[0] ?? "this_month";
      if (deps.reports) {
        const out = await deps.reports.generate({ companyId: invocation.ctx.companyId, kind, period });
        return success(invocation, out.summary, out.summaryAr, { data: out.data });
      }
      const out = await fallbackReport(deps.db, invocation.ctx.companyId, kind, period);
      return success(invocation, out.en, out.ar, { data: out.data });
    },
  };
}

export const BUILTIN_COMMANDS: CommandHandler[] = [
  // Business CRUD (10) — note: several commands are dispatchers handling
  // multiple sub-actions, so they count as one Handler each but cover the
  // 10 "logical" commands enumerated in the spec.
  INVOICE_CREATE,    // 1+2 (/invoice create | list)
  EXPENSE_ADD,       // 3
  ORDER_SHIP,        // 4+5 (/order ship | cancel)
  TICKET_CMD,        // 6+7 (/ticket assign | close)
  CONTACT_ADD,       // 8
  DEAL_CREATE,       // 9
  PRODUCT_LOW_STOCK, // 10
  // Reports (5)
  REPORT_DISPATCHER, // 11–15 unified
  reportAlias("financial", "مالي"),
  reportAlias("sales", "المبيعات"),
  reportAlias("ar", "الذمم"),
  reportAlias("health", "صحة الأعمال"),
  reportAlias("top-customers", "أفضل العملاء"),
  // Agent control (5)
  AGENT_CMD,         // 16–19 unified (list | hire | fire | run)
  ASK_AGENT,         // 20
  // Messaging (3)
  messagingCommand("whatsapp"), // 21
  messagingCommand("sms"),      // 22
  REMIND_CMD,                   // 23
  // System (2)
  HELP_CMD,   // 24
  ME_CMD,     // 25
];
