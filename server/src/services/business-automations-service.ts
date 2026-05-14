/**
 * Business Automations Service
 *
 * Executes scheduled and event-driven automation rules stored as
 * businessEntities rows with moduleKey="automation" and entityType="rule".
 *
 * Schedule formats supported (in addition to standard 5-field cron):
 *   - "daily"        → "0 9 * * *"   (9am daily)
 *   - "hourly"       → "0 * * * *"
 *   - "weekly"       → "0 8 * * 1"   (Monday 8am)
 *   - "monthly"      → "0 0 1 * *"   (1st of month, midnight)
 *   - "every:Nm"     → every N minutes
 *   - standard cron  → e.g. "0 0 1 * *"
 *
 * Each rule mutates a `data` object on the businessEntities row that holds the
 * full {@link AutomationRule} payload plus an execution history log.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  parseCron,
  nextCronTick,
  type ParsedCron,
} from "./cron.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutomationActionKind =
  | "create_invoice"
  | "send_reminder"
  | "generate_report"
  | "create_ticket"
  | "tag_entity"
  | "ai_action";

export type AutomationTriggerKind = "schedule" | "event";

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    kind: AutomationTriggerKind;
    schedule?: { cron: string; timezone?: string };
    event?: { type: string; conditions?: Record<string, unknown> };
  };
  action: {
    kind: AutomationActionKind;
    params: Record<string, unknown>;
  };
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  errorCount: number;
  history?: AutomationHistoryEntry[];
}

export interface AutomationHistoryEntry {
  at: string;
  ok: boolean;
  message: string;
  trigger: "schedule" | "manual" | "event";
  durationMs?: number;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  trigger: AutomationRule["trigger"];
  action: AutomationRule["action"];
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    key: "recurring_monthly_invoice",
    name: "Recurring Monthly Invoice",
    description:
      "Clones a template invoice on the first of every month with a new code and dates.",
    trigger: { kind: "schedule", schedule: { cron: "0 0 1 * *" } },
    action: {
      kind: "create_invoice",
      params: { templateInvoiceId: null, customerId: null, amountCents: 0 },
    },
  },
  {
    key: "overdue_invoice_reminder",
    name: "Overdue Invoice Reminder",
    description:
      "Daily scan for invoices that are sent and >7 days past due. Tags them and opens a follow-up ticket.",
    trigger: { kind: "schedule", schedule: { cron: "0 9 * * *" } },
    action: {
      kind: "send_reminder",
      params: { daysPastDue: 7, status: "sent", createTicket: true },
    },
  },
  {
    key: "weekly_pnl_email",
    name: "Weekly P&L Email",
    description:
      "Every Monday at 8am, generates the P&L report and posts an inbox notification.",
    trigger: { kind: "schedule", schedule: { cron: "0 8 * * 1" } },
    action: { kind: "generate_report", params: { reportType: "pnl" } },
  },
  {
    key: "low_stock_alert",
    name: "Low Stock Alert",
    description:
      "Daily scan of inventory products; if stockLevel < reorderPoint, creates a procurement ticket.",
    trigger: { kind: "schedule", schedule: { cron: "0 7 * * *" } },
    action: {
      kind: "create_ticket",
      params: { module: "helpdesk", category: "procurement" },
    },
  },
  {
    key: "sla_breach_detection",
    name: "SLA Breach Detection",
    description:
      "Hourly check for urgent tickets older than 24 hours. Tags them and creates a tracking issue.",
    trigger: { kind: "schedule", schedule: { cron: "0 * * * *" } },
    action: {
      kind: "tag_entity",
      params: {
        moduleKey: "helpdesk",
        entityType: "ticket",
        ageHours: 24,
        priority: "urgent",
        tag: "sla_breach",
      },
    },
  },
  {
    key: "pipeline_stale_deal_nudge",
    name: "Pipeline Stale Deal Nudge",
    description:
      "Daily scan for deals stuck in the same stage for 14+ days. Logs a nudge activity.",
    trigger: { kind: "schedule", schedule: { cron: "0 8 * * *" } },
    action: {
      kind: "ai_action",
      params: { kind: "stale_deal_nudge", staleDays: 14 },
    },
  },
  {
    key: "birthday_wishes",
    name: "Birthday Wishes",
    description:
      "Daily scan of contacts; for any whose birthday matches today, drafts a marketing campaign entry.",
    trigger: { kind: "schedule", schedule: { cron: "0 8 * * *" } },
    action: {
      kind: "ai_action",
      params: { kind: "birthday_wishes" },
    },
  },
  {
    key: "monthly_payroll_run",
    name: "Monthly Payroll Run",
    description:
      "On the last day of each month, creates a payroll expense with breakdown by employee.",
    trigger: { kind: "schedule", schedule: { cron: "0 23 28-31 * *" } },
    action: {
      kind: "ai_action",
      params: { kind: "monthly_payroll" },
    },
  },
];

// ---------------------------------------------------------------------------
// Schedule parsing — supports shorthand expressions + standard cron
// ---------------------------------------------------------------------------

/**
 * Convert a shorthand schedule string into something we can compute next-run
 * from. Returns either a ParsedCron or a numeric minute interval.
 */
export type ScheduleSpec =
  | { kind: "cron"; cron: ParsedCron }
  | { kind: "interval"; minutes: number };

export function parseSchedule(expression: string): ScheduleSpec {
  const trimmed = expression.trim().toLowerCase();
  if (trimmed === "hourly") return { kind: "cron", cron: parseCron("0 * * * *") };
  if (trimmed === "daily") return { kind: "cron", cron: parseCron("0 9 * * *") };
  if (trimmed === "weekly") return { kind: "cron", cron: parseCron("0 8 * * 1") };
  if (trimmed === "monthly") return { kind: "cron", cron: parseCron("0 0 1 * *") };
  if (trimmed.startsWith("every:")) {
    const rest = trimmed.slice("every:".length);
    if (rest.endsWith("m")) {
      const n = parseInt(rest.slice(0, -1), 10);
      if (!isNaN(n) && n > 0) return { kind: "interval", minutes: n };
    }
    throw new Error(`Unsupported "every:" expression: ${expression}`);
  }
  return { kind: "cron", cron: parseCron(expression) };
}

export function computeNextRun(expression: string, after: Date = new Date()): Date | null {
  const spec = parseSchedule(expression);
  if (spec.kind === "interval") {
    return new Date(after.getTime() + spec.minutes * 60_000);
  }
  return nextCronTick(spec.cron, after);
}

export function summarizeSchedule(expression: string): string {
  const trimmed = expression.trim().toLowerCase();
  if (trimmed === "hourly") return "Every hour";
  if (trimmed === "daily") return "Daily at 9:00am";
  if (trimmed === "weekly") return "Weekly on Monday at 8:00am";
  if (trimmed === "monthly") return "Monthly on the 1st";
  if (trimmed.startsWith("every:")) return `Every ${trimmed.slice(6)}`;
  // Standard cron — short, friendly hints for common patterns
  if (trimmed === "0 0 1 * *") return "Monthly on the 1st";
  if (trimmed === "0 8 * * 1") return "Mondays at 8:00am";
  if (trimmed === "0 9 * * *") return "Daily at 9:00am";
  if (trimmed === "0 7 * * *") return "Daily at 7:00am";
  if (trimmed === "0 8 * * *") return "Daily at 8:00am";
  if (trimmed === "0 * * * *") return "Every hour";
  return `cron: ${expression}`;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

const ACTION_HANDLERS: Record<
  AutomationActionKind,
  (db: Db, companyId: string, params: Record<string, unknown>) => Promise<ActionResult>
> = {
  create_invoice: handleCreateInvoice,
  send_reminder: handleSendReminder,
  generate_report: handleGenerateReport,
  create_ticket: handleCreateTicket,
  tag_entity: handleTagEntity,
  ai_action: handleAiAction,
};

async function handleCreateInvoice(
  db: Db,
  companyId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const amountCents =
    typeof params.amountCents === "number" ? params.amountCents : 0;
  const customerId =
    typeof params.customerId === "string" ? params.customerId : null;
  const templateInvoiceId =
    typeof params.templateInvoiceId === "string" ? params.templateInvoiceId : null;

  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const now = new Date();

  // If a template is referenced, copy its data
  let copiedData: Record<string, unknown> = {};
  let copiedAmount: number | null = amountCents || null;
  if (templateInvoiceId) {
    const [tpl] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, templateInvoiceId),
          eq(businessEntities.companyId, companyId),
        ),
      );
    if (tpl) {
      copiedData = { ...(tpl.data as Record<string, unknown>) };
      copiedAmount = tpl.amountCents ?? copiedAmount;
    }
  }

  const [row] = await db
    .insert(businessEntities)
    .values({
      companyId,
      moduleKey: "sales",
      entityType: "invoice",
      code: `INV-${year}-${month}-AUTO`,
      name: `Auto invoice ${year}-${month}`,
      status: "draft",
      amountCents: copiedAmount,
      currency: "SAR",
      data: {
        ...copiedData,
        autoGenerated: true,
        customerId,
        issueDate: now.toISOString().slice(0, 10),
      },
      tags: ["automation"],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return {
    ok: true,
    message: row ? `Created invoice ${row.code ?? row.id}` : "Invoice insert skipped",
  };
}

async function handleSendReminder(
  db: Db,
  companyId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const daysPastDue = typeof params.daysPastDue === "number" ? params.daysPastDue : 7;
  const status = typeof params.status === "string" ? params.status : "sent";
  const createTicket = params.createTicket !== false;

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - daysPastDue);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "sales"),
        eq(businessEntities.entityType, "invoice"),
        eq(businessEntities.status, status),
        sql`coalesce(data->>'dueDate','') < ${cutoffIso}`,
      ),
    );

  const now = new Date();
  let tickets = 0;
  for (const inv of rows) {
    // Tag invoice overdue
    const existingTags = Array.isArray(inv.tags) ? (inv.tags as string[]) : [];
    if (!existingTags.includes("overdue")) {
      await db
        .update(businessEntities)
        .set({
          tags: [...existingTags, "overdue"],
          updatedAt: now,
        })
        .where(eq(businessEntities.id, inv.id));
    }
    if (createTicket) {
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: "helpdesk",
        entityType: "ticket",
        name: `Payment follow-up: ${inv.code ?? inv.id}`,
        status: "open",
        data: {
          invoiceId: inv.id,
          invoiceCode: inv.code,
          autoGenerated: true,
          priority: "high",
        },
        tags: ["overdue", "auto"],
        createdAt: now,
        updatedAt: now,
      });
      tickets += 1;
    }
  }
  return {
    ok: true,
    message: `Tagged ${rows.length} invoice(s) overdue, opened ${tickets} ticket(s)`,
  };
}

async function handleGenerateReport(
  db: Db,
  companyId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const reportType =
    typeof params.reportType === "string" ? params.reportType : "pnl";
  const now = new Date();

  // Compute a quick summary aggregation directly, then persist it as an
  // entity so the rest of the system can pick it up as an inbox notification.
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const revenueRows = await db
    .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "sales"),
        eq(businessEntities.entityType, "invoice"),
        eq(businessEntities.status, "paid"),
        sql`created_at >= ${startOfMonth.toISOString()}`,
        sql`created_at <= ${endOfMonth.toISOString()}`,
      ),
    );
  const expenseRows = await db
    .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "finance"),
        eq(businessEntities.entityType, "expense"),
        sql`created_at >= ${startOfMonth.toISOString()}`,
        sql`created_at <= ${endOfMonth.toISOString()}`,
      ),
    );

  const revenue = Number(revenueRows[0]?.total ?? 0);
  const expenses = Number(expenseRows[0]?.total ?? 0);

  await db.insert(businessEntities).values({
    companyId,
    moduleKey: "automation",
    entityType: "notification",
    name: `${reportType.toUpperCase()} Report (${now.toISOString().slice(0, 10)})`,
    status: "unread",
    data: {
      reportType,
      revenueCents: revenue,
      expensesCents: expenses,
      netIncomeCents: revenue - expenses,
      generatedAt: now.toISOString(),
    },
    tags: ["automation", "report"],
    createdAt: now,
    updatedAt: now,
  });
  return {
    ok: true,
    message: `Generated ${reportType.toUpperCase()} report: revenue ${revenue}, expenses ${expenses}`,
  };
}

async function handleCreateTicket(
  db: Db,
  companyId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const category =
    typeof params.category === "string" ? params.category : "procurement";

  // For low-stock procurement: scan inventory products
  const products = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "inventory"),
        eq(businessEntities.entityType, "product"),
      ),
    );

  const now = new Date();
  let created = 0;
  for (const p of products) {
    const data = (p.data ?? {}) as Record<string, unknown>;
    const stockLevel = typeof data.stockLevel === "number" ? data.stockLevel : null;
    const reorderPoint =
      typeof data.reorderPoint === "number" ? data.reorderPoint : null;
    if (stockLevel === null || reorderPoint === null) continue;
    if (stockLevel >= reorderPoint) continue;
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "helpdesk",
      entityType: "ticket",
      name: `Reorder needed: ${p.name ?? p.code ?? p.id}`,
      status: "open",
      data: {
        productId: p.id,
        productName: p.name,
        stockLevel,
        reorderPoint,
        category,
        autoGenerated: true,
      },
      tags: ["procurement", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    created += 1;
  }
  return {
    ok: true,
    message: `Opened ${created} procurement ticket(s) for low stock`,
  };
}

async function handleTagEntity(
  db: Db,
  companyId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const moduleKey =
    typeof params.moduleKey === "string" ? params.moduleKey : "helpdesk";
  const entityType =
    typeof params.entityType === "string" ? params.entityType : "ticket";
  const ageHours = typeof params.ageHours === "number" ? params.ageHours : 24;
  const priority =
    typeof params.priority === "string" ? params.priority : "urgent";
  const tag = typeof params.tag === "string" ? params.tag : "sla_breach";

  const cutoff = new Date(Date.now() - ageHours * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, moduleKey),
        eq(businessEntities.entityType, entityType),
        eq(businessEntities.status, "open"),
        sql`created_at <= ${cutoff.toISOString()}`,
        sql`coalesce(data->>'priority','') = ${priority}`,
      ),
    );

  const now = new Date();
  let touched = 0;
  for (const r of rows) {
    const existingTags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
    if (existingTags.includes(tag)) continue;
    await db
      .update(businessEntities)
      .set({ tags: [...existingTags, tag], updatedAt: now })
      .where(eq(businessEntities.id, r.id));
    // Create an issue-like tracking entity in the automation module
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "automation",
      entityType: "issue",
      name: `SLA breach: ${r.name ?? r.code ?? r.id}`,
      status: "open",
      data: {
        sourceEntityId: r.id,
        sourceModule: moduleKey,
        sourceType: entityType,
        breach: tag,
      },
      tags: ["sla_breach", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    touched += 1;
  }
  return {
    ok: true,
    message: `Tagged ${touched} ${entityType}(s) as ${tag}`,
  };
}

async function handleAiAction(
  db: Db,
  companyId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const kind = typeof params.kind === "string" ? params.kind : "generic";
  const now = new Date();

  if (kind === "stale_deal_nudge") {
    const staleDays =
      typeof params.staleDays === "number" ? params.staleDays : 14;
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
    const deals = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "deal"),
          sql`updated_at <= ${cutoff.toISOString()}`,
        ),
      );
    let nudged = 0;
    for (const d of deals) {
      const status = d.status;
      if (["won", "lost"].includes(status)) continue;
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: "automation",
        entityType: "activity_log",
        name: `Stale deal nudge: ${d.name ?? d.code ?? d.id}`,
        status: "info",
        data: {
          dealId: d.id,
          stage: status,
          suggestion: "Follow up — no activity in 14+ days",
        },
        tags: ["nudge", "auto"],
        createdAt: now,
        updatedAt: now,
      });
      nudged += 1;
    }
    return { ok: true, message: `Logged ${nudged} stale-deal nudge(s)` };
  }

  if (kind === "birthday_wishes") {
    const today = now.toISOString().slice(5, 10); // MM-DD
    const contacts = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "contact"),
          sql`substring(coalesce(data->>'birthday',''), 6, 5) = ${today}`,
        ),
      );
    if (contacts.length === 0) {
      return { ok: true, message: "No birthdays today" };
    }
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "marketing",
      entityType: "campaign",
      name: `Birthday wishes (${now.toISOString().slice(0, 10)})`,
      status: "draft",
      data: {
        kind: "birthday",
        contactIds: contacts.map((c) => c.id),
        autoGenerated: true,
      },
      tags: ["birthday", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    return {
      ok: true,
      message: `Drafted birthday campaign for ${contacts.length} contact(s)`,
    };
  }

  if (kind === "monthly_payroll") {
    // Run on the last day of the month
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(now.getUTCDate() + 1);
    const isLastDay = tomorrow.getUTCMonth() !== now.getUTCMonth();
    if (!isLastDay) {
      return { ok: true, message: "Not the last day of the month — skipped" };
    }
    const employees = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "hr"),
          eq(businessEntities.entityType, "employee"),
        ),
      );
    const breakdown: Array<{ employeeId: string; name: string | null; salaryCents: number }> = [];
    let total = 0;
    for (const e of employees) {
      const data = (e.data ?? {}) as Record<string, unknown>;
      const salary = typeof data.salaryCents === "number" ? data.salaryCents : 0;
      breakdown.push({ employeeId: e.id, name: e.name, salaryCents: salary });
      total += salary;
    }
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "finance",
      entityType: "expense",
      code: `PAY-${now.toISOString().slice(0, 7)}`,
      name: `Payroll ${now.toISOString().slice(0, 7)}`,
      status: "pending",
      amountCents: total,
      currency: "SAR",
      data: {
        category: "Payroll",
        breakdown,
        autoGenerated: true,
      },
      tags: ["payroll", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    return {
      ok: true,
      message: `Created payroll expense ${total} across ${breakdown.length} employee(s)`,
    };
  }

  return { ok: true, message: `ai_action(${kind}) executed (no-op)` };
}

// ---------------------------------------------------------------------------
// Rule executor — wraps an action handler, updates counters + history
// ---------------------------------------------------------------------------

const MAX_HISTORY = 20;

export async function executeRule(
  db: Db,
  ruleId: string,
  triggerSource: "schedule" | "manual" | "event",
): Promise<ActionResult> {
  const [row] = await db
    .select()
    .from(businessEntities)
    .where(eq(businessEntities.id, ruleId));
  if (!row || row.moduleKey !== "automation" || row.entityType !== "rule") {
    return { ok: false, message: "Rule not found" };
  }
  const data = (row.data ?? {}) as Partial<AutomationRule>;
  const action = data.action;
  if (!action) {
    return { ok: false, message: "Rule has no action" };
  }
  const handler = ACTION_HANDLERS[action.kind];
  if (!handler) {
    return { ok: false, message: `Unknown action kind: ${action.kind}` };
  }

  const start = Date.now();
  let result: ActionResult;
  try {
    result = await handler(db, row.companyId, action.params ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { ok: false, message };
  }
  const duration = Date.now() - start;
  const now = new Date();

  // Update counters + history
  const history = Array.isArray(data.history) ? data.history.slice() : [];
  history.unshift({
    at: now.toISOString(),
    ok: result.ok,
    message: result.message,
    trigger: triggerSource,
    durationMs: duration,
  });
  const trimmed = history.slice(0, MAX_HISTORY);

  // Compute next run from schedule if applicable
  let nextRunIso: string | undefined = undefined;
  if (data.trigger?.kind === "schedule" && data.trigger.schedule?.cron) {
    const next = computeNextRun(data.trigger.schedule.cron, now);
    if (next) nextRunIso = next.toISOString();
  }

  const updatedData: AutomationRule = {
    id: data.id ?? row.id,
    name: data.name ?? row.name ?? "Untitled automation",
    enabled: data.enabled ?? true,
    trigger: data.trigger ?? { kind: "schedule", schedule: { cron: "daily" } },
    action,
    lastRunAt: now.toISOString(),
    nextRunAt: nextRunIso ?? data.nextRunAt,
    runCount: (data.runCount ?? 0) + 1,
    errorCount: (data.errorCount ?? 0) + (result.ok ? 0 : 1),
    history: trimmed,
  };

  await db
    .update(businessEntities)
    .set({
      data: updatedData,
      updatedAt: now,
    })
    .where(eq(businessEntities.id, ruleId));

  return result;
}

// ---------------------------------------------------------------------------
// Scheduler — runs every minute
// ---------------------------------------------------------------------------

/**
 * Scan for enabled schedule-triggered rules whose nextRunAt is past, and run
 * them. Errors per-rule are caught and recorded — they do not stop the loop.
 */
export async function runScheduledRules(db: Db, now: Date = new Date()): Promise<number> {
  const nowIso = now.toISOString();
  const rules = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.moduleKey, "automation"),
        eq(businessEntities.entityType, "rule"),
        sql`coalesce(data->>'enabled','true') = 'true'`,
        sql`coalesce(data->>'nextRunAt','1970-01-01') <= ${nowIso}`,
      ),
    );

  let executed = 0;
  for (const rule of rules) {
    const data = (rule.data ?? {}) as Partial<AutomationRule>;
    if (data.trigger?.kind !== "schedule") continue;
    try {
      await executeRule(db, rule.id, "schedule");
      executed += 1;
    } catch {
      // Per-rule failures are recorded inside executeRule; here we tolerate
      // unexpected errors from the executor itself to keep the loop alive.
    }
  }
  return executed;
}

// Re-export so callers needing the cron parser don't need a separate import.
export { lte };

export interface BusinessAutomationsService {
  stop(): void;
}

/**
 * Start the per-minute scheduler. The returned handle exposes a `stop()` for
 * tests and graceful shutdown.
 */
export function createBusinessAutomationsService(
  db: Db,
  opts: { intervalMs?: number; autoStart?: boolean } = {},
): BusinessAutomationsService {
  const intervalMs = opts.intervalMs ?? 60_000;
  const timer = opts.autoStart === false
    ? null
    : setInterval(() => {
      void runScheduledRules(db).catch(() => {
        // swallow — per-rule errors are already recorded
      });
    }, intervalMs);
  timer?.unref?.();
  return {
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
