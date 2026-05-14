// ---------------------------------------------------------------------------
// AI Co-Founder tools registry
// ---------------------------------------------------------------------------
//
// Each tool is a function the LLM can call. Each handler receives the
// (already-authenticated) companyId from the service — NEVER from LLM
// arguments. This is the security boundary.
//
// "Dangerous" tools require explicit user confirmation before execution.
//

import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { analyzeCompany } from "../business-analyst-agent.js";
import type { WhatsappCloudService } from "../whatsapp-cloud-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolContext {
  db: Db;
  whatsappService?: WhatsappCloudService;
}

export interface ToolSpec {
  name: string;
  category:
    | "read"
    | "write"
    | "report"
    | "messaging";
  description: string;
  descriptionAr: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  dangerous: boolean;
  handler: (
    companyId: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePeriod(
  args: Record<string, unknown>,
): { from: Date; to: Date; label: string } {
  const now = new Date();
  const period = typeof args.period === "string" ? args.period : "this_month";
  if (period === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to: now, label: "today" };
  }
  if (period === "yesterday") {
    const to = new Date(now);
    to.setHours(0, 0, 0, 0);
    const from = new Date(to.getTime() - 24 * 3600 * 1000);
    return { from, to, label: "yesterday" };
  }
  if (period === "last_7_days") {
    const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    return { from, to: now, label: "last_7_days" };
  }
  if (period === "last_30_days") {
    const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    return { from, to: now, label: "last_30_days" };
  }
  if (period === "this_year") {
    const from = new Date(now.getFullYear(), 0, 1);
    return { from, to: now, label: "this_year" };
  }
  if (period === "last_month") {
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { from, to, label: "last_month" };
  }
  // default: this_month
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from, to: now, label: "this_month" };
}

function getCents(row: { amountCents: number | null }): number {
  return typeof row.amountCents === "number" ? row.amountCents : 0;
}

function getDataField(
  row: { data: unknown },
  key: string,
): unknown {
  const d = (row.data ?? {}) as Record<string, unknown>;
  return d[key];
}

function normalizePhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.replace(/[^+0-9]/g, "");
  if (trimmed.length < 6) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function getFinancialSummary(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const period = parsePeriod(args);
  const invoices = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "invoice"),
        gte(businessEntities.createdAt, period.from),
        lte(businessEntities.createdAt, period.to),
      ),
    );
  const expenses = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "expense"),
        gte(businessEntities.createdAt, period.from),
        lte(businessEntities.createdAt, period.to),
      ),
    );
  const revenueCents = invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + getCents(i), 0);
  const expensesCents = expenses.reduce((s, e) => s + getCents(e), 0);
  const overdueCents = invoices
    .filter((i) => i.status === "overdue")
    .reduce((s, i) => s + getCents(i), 0);
  return {
    period: period.label,
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    revenueCents,
    expensesCents,
    netProfitCents: revenueCents - expensesCents,
    invoiceCount: invoices.length,
    expenseCount: expenses.length,
    overdueInvoiceCents: overdueCents,
  };
}

async function getPipelineStatus(
  companyId: string,
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const deals = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "deal"),
      ),
    )
    .limit(200);
  const byStage: Record<string, { count: number; valueCents: number }> = {};
  for (const d of deals) {
    const stage = d.status;
    const bucket = byStage[stage] ?? { count: 0, valueCents: 0 };
    bucket.count += 1;
    bucket.valueCents += getCents(d);
    byStage[stage] = bucket;
  }
  return {
    totalDeals: deals.length,
    totalValueCents: deals.reduce((s, d) => s + getCents(d), 0),
    byStage,
  };
}

async function getOutstandingInvoices(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const limit = Math.min(
    typeof args.limit === "number" ? args.limit : 50,
    200,
  );
  const rows = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "invoice"),
        inArray(businessEntities.status, ["sent", "unpaid", "overdue"]),
      ),
    )
    .orderBy(desc(businessEntities.createdAt))
    .limit(limit);
  const now = Date.now();
  const items = rows.map((r) => {
    const createdMs = r.createdAt ? new Date(r.createdAt).getTime() : now;
    const ageDays = Math.max(0, Math.floor((now - createdMs) / 86_400_000));
    return {
      id: r.id,
      code: r.code,
      customerName: r.name,
      amountCents: getCents(r),
      status: r.status,
      ageDays,
      customerId: getDataField(r, "customerId") ?? getDataField(r, "contactId"),
    };
  });
  return {
    totalCents: items.reduce((s, i) => s + i.amountCents, 0),
    count: items.length,
    items,
  };
}

async function getTopCustomers(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const period = parsePeriod(args);
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 10, 50);
  const invoices = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "invoice"),
        eq(businessEntities.status, "paid"),
        gte(businessEntities.createdAt, period.from),
        lte(businessEntities.createdAt, period.to),
      ),
    );
  const byCustomer = new Map<string, { name: string | null; cents: number; count: number }>();
  for (const inv of invoices) {
    const key =
      (typeof getDataField(inv, "customerId") === "string"
        ? (getDataField(inv, "customerId") as string)
        : null) ||
      (typeof getDataField(inv, "contactId") === "string"
        ? (getDataField(inv, "contactId") as string)
        : null) ||
      inv.parentId ||
      inv.name ||
      "(unknown)";
    const existing = byCustomer.get(key) ?? {
      name: inv.name,
      cents: 0,
      count: 0,
    };
    existing.cents += getCents(inv);
    existing.count += 1;
    byCustomer.set(key, existing);
  }
  const sorted = Array.from(byCustomer.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, limit);
  return { period: period.label, items: sorted };
}

async function getTopProducts(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 10, 50);
  const products = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "product"),
      ),
    )
    .limit(500);
  const items = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      sales30d:
        typeof getDataField(p, "sales30d") === "number"
          ? (getDataField(p, "sales30d") as number)
          : 0,
      stockLevel:
        typeof getDataField(p, "stockLevel") === "number"
          ? (getDataField(p, "stockLevel") as number)
          : 0,
      priceCents: getCents(p),
    }))
    .sort((a, b) => b.sales30d - a.sales30d)
    .slice(0, limit);
  return { items };
}

async function getTeamStatus(
  companyId: string,
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const employees = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "employee"),
      ),
    )
    .limit(500);
  const active = employees.filter((e) => e.status !== "terminated");
  const totalSalaryCents = active.reduce((s, e) => {
    const salary = getDataField(e, "monthlySalaryCents");
    return s + (typeof salary === "number" ? salary : getCents(e));
  }, 0);
  return {
    totalEmployees: employees.length,
    activeEmployees: active.length,
    monthlyPayrollCents: totalSalaryCents,
  };
}

async function getInventoryAlerts(
  companyId: string,
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const products = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "product"),
      ),
    )
    .limit(1000);
  const lowStock = products
    .map((p) => {
      const stock = getDataField(p, "stockLevel");
      const reorder = getDataField(p, "reorderPoint");
      const stockN = typeof stock === "number" ? stock : 0;
      const reorderN = typeof reorder === "number" ? reorder : 0;
      return { id: p.id, name: p.name, stock: stockN, reorderPoint: reorderN };
    })
    .filter((p) => p.stock <= p.reorderPoint && p.reorderPoint > 0)
    .slice(0, 50);
  return { lowStockCount: lowStock.length, items: lowStock };
}

async function getHelpdeskStatus(
  companyId: string,
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const tickets = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "ticket"),
      ),
    )
    .limit(500);
  const open = tickets.filter(
    (t) => t.status !== "closed" && t.status !== "resolved",
  );
  const now = Date.now();
  const slaBreaches = open.filter((t) => {
    const created = t.createdAt ? new Date(t.createdAt).getTime() : now;
    const ageH = (now - created) / 3_600_000;
    const priority = getDataField(t, "priority");
    if (priority === "urgent") return ageH > 4;
    if (priority === "high") return ageH > 24;
    return ageH > 72;
  });
  return {
    openTickets: open.length,
    slaBreaches: slaBreaches.length,
    items: open.slice(0, 20).map((t) => ({
      id: t.id,
      code: t.code,
      subject: t.name,
      status: t.status,
      priority: getDataField(t, "priority") ?? "normal",
    })),
  };
}

async function runAnalystReport(
  companyId: string,
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  try {
    const stored = await analyzeCompany(ctx.db, companyId, {});
    return {
      reportId: stored.id,
      periodFrom: stored.report.periodFrom,
      periodTo: stored.report.periodTo,
      kpis: stored.report.kpiSnapshot,
      anomalies: stored.report.anomalies.slice(0, 5),
      opportunities: stored.report.opportunities.slice(0, 5),
      summary: stored.report.executiveSummary,
      summaryAr: stored.report.executiveSummaryAr,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to run analyst",
    };
  }
}

async function getCashPosition(
  companyId: string,
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const accounts = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        inArray(businessEntities.entityType, ["bank_account", "account"]),
      ),
    )
    .limit(100);
  const totalCents = accounts.reduce((s, a) => {
    const bal = getDataField(a, "balanceCents");
    return s + (typeof bal === "number" ? bal : getCents(a));
  }, 0);
  return {
    accountCount: accounts.length,
    totalBalanceCents: totalCents,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      balanceCents:
        typeof getDataField(a, "balanceCents") === "number"
          ? (getDataField(a, "balanceCents") as number)
          : getCents(a),
      currency: a.currency,
    })),
  };
}

async function searchEntities(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { items: [] };
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, 100);
  const term = `%${query}%`;
  const rows = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        or(
          ilike(businessEntities.name, term),
          ilike(businessEntities.code, term),
        )!,
      ),
    )
    .limit(limit);
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      moduleKey: r.moduleKey,
      entityType: r.entityType,
      status: r.status,
      amountCents: r.amountCents,
    })),
  };
}

async function getBusinessHealthScore(
  companyId: string,
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  // A simple composite: revenue trend + cash + AR aging + open tickets.
  const period = parsePeriod({ period: "this_month" });
  const priorPeriod = parsePeriod({ period: "last_month" });
  const [thisInvoices, lastInvoices, openTickets] = await Promise.all([
    ctx.db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.entityType, "invoice"),
          gte(businessEntities.createdAt, period.from),
          lte(businessEntities.createdAt, period.to),
        ),
      ),
    ctx.db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.entityType, "invoice"),
          gte(businessEntities.createdAt, priorPeriod.from),
          lte(businessEntities.createdAt, priorPeriod.to),
        ),
      ),
    ctx.db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.entityType, "ticket"),
        ),
      ),
  ]);
  const thisRev = thisInvoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + getCents(i), 0);
  const lastRev = lastInvoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + getCents(i), 0);
  const overdueCents = thisInvoices
    .filter((i) => i.status === "overdue")
    .reduce((s, i) => s + getCents(i), 0);
  const openTicketCount = openTickets.filter(
    (t) => t.status !== "closed" && t.status !== "resolved",
  ).length;

  let score = 50;
  if (thisRev > lastRev) score += 20;
  else if (thisRev < lastRev * 0.8) score -= 20;
  if (overdueCents < thisRev * 0.05) score += 15;
  else if (overdueCents > thisRev * 0.2) score -= 15;
  if (openTicketCount < 5) score += 10;
  else if (openTicketCount > 30) score -= 15;
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    grade:
      score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F",
    components: {
      revenueDeltaPercent:
        lastRev > 0 ? Math.round(((thisRev - lastRev) / lastRev) * 1000) / 10 : 0,
      overdueRatio:
        thisRev > 0 ? Math.round((overdueCents / thisRev) * 1000) / 10 : 0,
      openTicketCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

async function sendInvoiceReminder(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  // If invoiceIds provided, send reminders only to those. Otherwise to all
  // overdue invoices.
  const invoiceIds =
    Array.isArray(args.invoiceIds) && args.invoiceIds.length > 0
      ? (args.invoiceIds as unknown[]).filter(
          (i): i is string => typeof i === "string",
        )
      : null;
  const rows = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      invoiceIds
        ? and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.entityType, "invoice"),
            inArray(businessEntities.id, invoiceIds),
          )
        : and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.entityType, "invoice"),
            eq(businessEntities.status, "overdue"),
          ),
    )
    .limit(100);

  const wa = ctx.whatsappService;
  let sent = 0;
  const errors: string[] = [];
  for (const inv of rows) {
    const phone =
      normalizePhone(getDataField(inv, "customerPhone")) ??
      normalizePhone(getDataField(inv, "phone"));
    if (!phone) {
      errors.push(`Invoice ${inv.code ?? inv.id}: no customer phone`);
      continue;
    }
    const body =
      `Reminder: invoice ${inv.code ?? ""} for ` +
      `${((inv.amountCents ?? 0) / 100).toLocaleString()} ${inv.currency ?? ""} ` +
      `is overdue. Please settle at your earliest convenience.`;
    try {
      if (wa && wa.isConfigured()) {
        await wa.sendText(phone, body);
      }
      sent += 1;
    } catch (err) {
      errors.push(
        `Invoice ${inv.code ?? inv.id}: ${err instanceof Error ? err.message : "send failed"}`,
      );
    }
  }
  return { sentCount: sent, attempted: rows.length, errors };
}

async function createInvoice(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const customerId =
    typeof args.customerId === "string" ? args.customerId : null;
  const customerName =
    typeof args.customerName === "string" ? args.customerName : null;
  const amountCents =
    typeof args.amountCents === "number"
      ? args.amountCents
      : typeof args.amount === "number"
        ? Math.round((args.amount as number) * 100)
        : 0;
  const description =
    typeof args.description === "string" ? args.description : "";
  const currency =
    typeof args.currency === "string" ? args.currency : "KWD";
  const now = new Date();
  const code = `INV-${Date.now().toString(36).toUpperCase()}`;
  const [row] = await ctx.db
    .insert(businessEntities)
    .values({
      companyId,
      moduleKey: "finance",
      entityType: "invoice",
      parentId: customerId,
      code,
      name: customerName ?? description,
      status: "sent",
      amountCents,
      currency,
      data: {
        description,
        customerId,
        createdBy: "cofounder",
      },
      tags: ["cofounder"],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { id: row?.id, code, amountCents };
}

async function markInvoicePaid(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const invoiceId = typeof args.invoiceId === "string" ? args.invoiceId : null;
  if (!invoiceId) return { error: "invoiceId required" };
  const [row] = await ctx.db
    .update(businessEntities)
    .set({ status: "paid", updatedAt: new Date() })
    .where(
      and(
        eq(businessEntities.id, invoiceId),
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "invoice"),
      ),
    )
    .returning();
  return { id: row?.id ?? null, status: row?.status ?? null };
}

async function createExpense(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const amountCents =
    typeof args.amountCents === "number"
      ? args.amountCents
      : typeof args.amount === "number"
        ? Math.round((args.amount as number) * 100)
        : 0;
  const description =
    typeof args.description === "string" ? args.description : "Expense";
  const category =
    typeof args.category === "string" ? args.category : "Other";
  const merchant =
    typeof args.merchant === "string" ? args.merchant : null;
  const currency =
    typeof args.currency === "string" ? args.currency : "KWD";
  const now = new Date();
  const [row] = await ctx.db
    .insert(businessEntities)
    .values({
      companyId,
      moduleKey: "finance",
      entityType: "expense",
      name: description,
      status: "recorded",
      amountCents,
      currency,
      data: { description, merchant, category, createdBy: "cofounder" },
      tags: ["cofounder"],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { id: row?.id, amountCents, category };
}

async function assignTicketToAgent(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const ticketId = typeof args.ticketId === "string" ? args.ticketId : null;
  const agentUserId =
    typeof args.agentUserId === "string" ? args.agentUserId : null;
  if (!ticketId || !agentUserId) {
    return { error: "ticketId and agentUserId required" };
  }
  const [row] = await ctx.db
    .update(businessEntities)
    .set({
      ownerUserId: agentUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(businessEntities.id, ticketId),
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, "ticket"),
      ),
    )
    .returning();
  return { id: row?.id ?? null, assignedTo: agentUserId };
}

async function scheduleFollowUpTask(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const title = typeof args.title === "string" ? args.title : "Follow up";
  const dueInDays =
    typeof args.dueInDays === "number" ? args.dueInDays : 3;
  const due = new Date(Date.now() + dueInDays * 86_400_000);
  const now = new Date();
  const [row] = await ctx.db
    .insert(businessEntities)
    .values({
      companyId,
      moduleKey: "cofounder",
      entityType: "task",
      name: title,
      status: "pending",
      data: {
        description: typeof args.description === "string" ? args.description : "",
        dueAt: due.toISOString(),
        createdBy: "cofounder",
      },
      tags: ["cofounder", "follow-up"],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { id: row?.id, dueAt: due.toISOString() };
}

async function createMarketingCampaign(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const name = typeof args.name === "string" ? args.name : "Untitled Campaign";
  const channel = typeof args.channel === "string" ? args.channel : "whatsapp";
  const message = typeof args.message === "string" ? args.message : "";
  const now = new Date();
  const [row] = await ctx.db
    .insert(businessEntities)
    .values({
      companyId,
      moduleKey: "marketing",
      entityType: "campaign",
      name,
      status: "draft",
      data: { channel, message, createdBy: "cofounder" },
      tags: ["cofounder"],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { id: row?.id, name, channel };
}

async function sendWhatsappToCustomer(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const phone =
    normalizePhone(args.phone) ?? normalizePhone(args.toPhone);
  const message = typeof args.message === "string" ? args.message : null;
  if (!phone || !message) return { error: "phone and message required" };
  if (!ctx.whatsappService || !ctx.whatsappService.isConfigured()) {
    return { error: "whatsapp not configured", phone, message };
  }
  const sent = await ctx.whatsappService.sendText(phone, message);
  // Log as outgoing_message for audit trail.
  const now = new Date();
  await ctx.db.insert(businessEntities).values({
    companyId,
    moduleKey: "messaging",
    entityType: "outgoing_message",
    code: sent.id || null,
    name: message.slice(0, 200),
    status: "sent",
    data: {
      channel: "whatsapp",
      direction: "outbound",
      to: phone,
      from: sent.from,
      type: "text",
      content: { text: { body: message } },
      providerMessageId: sent.id,
      createdBy: "cofounder",
    },
    tags: ["whatsapp", "cofounder"],
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, messageId: sent.id };
}

async function generatePdfReport(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  // For now we record the request — the PDF service is wired separately.
  const type = typeof args.reportType === "string" ? args.reportType : "pnl";
  const period = parsePeriod(args);
  const now = new Date();
  const [row] = await ctx.db
    .insert(businessEntities)
    .values({
      companyId,
      moduleKey: "cofounder",
      entityType: "report_request",
      name: `${type} report`,
      status: "queued",
      data: {
        type,
        periodFrom: period.from.toISOString(),
        periodTo: period.to.toISOString(),
        createdBy: "cofounder",
      },
      tags: ["cofounder", "report"],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return {
    id: row?.id ?? null,
    type,
    status: "queued",
    note: "PDF will be generated and made available in Reports.",
  };
}

async function exportDataCsv(
  companyId: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const entityType =
    typeof args.entityType === "string" ? args.entityType : "invoice";
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 500, 5000);
  const rows = await ctx.db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.entityType, entityType),
      ),
    )
    .limit(limit);
  const header = ["id", "code", "name", "status", "amountCents", "currency", "createdAt"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.code ?? "",
        (r.name ?? "").replace(/[",\n]/g, " "),
        r.status,
        r.amountCents ?? "",
        r.currency ?? "",
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      ].join(","),
    );
  }
  return {
    rowCount: rows.length,
    csv: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Spec definitions
// ---------------------------------------------------------------------------

export const COFOUNDER_TOOLS: ToolSpec[] = [
  {
    name: "get_financial_summary",
    category: "read",
    description: "Revenue, expenses, profit for a period.",
    descriptionAr: "الإيرادات والمصاريف والأرباح لفترة محددة.",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: [
            "today",
            "yesterday",
            "this_month",
            "last_month",
            "last_7_days",
            "last_30_days",
            "this_year",
          ],
        },
      },
      required: [],
    },
    dangerous: false,
    handler: getFinancialSummary,
  },
  {
    name: "get_pipeline_status",
    category: "read",
    description: "Active deals broken down by stage.",
    descriptionAr: "الصفقات النشطة مصنفة حسب المرحلة.",
    parameters: { type: "object", properties: {}, required: [] },
    dangerous: false,
    handler: getPipelineStatus,
  },
  {
    name: "get_outstanding_invoices",
    category: "read",
    description: "List of unpaid / overdue invoices with aging info.",
    descriptionAr: "قائمة الفواتير غير المدفوعة أو المتأخرة مع عمرها.",
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
      required: [],
    },
    dangerous: false,
    handler: getOutstandingInvoices,
  },
  {
    name: "get_top_customers",
    category: "read",
    description: "Top customers by revenue for a period.",
    descriptionAr: "أفضل العملاء حسب الإيرادات لفترة محددة.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string" },
        limit: { type: "number" },
      },
      required: [],
    },
    dangerous: false,
    handler: getTopCustomers,
  },
  {
    name: "get_top_products",
    category: "read",
    description: "Top products by sales velocity (last 30d).",
    descriptionAr: "أفضل المنتجات حسب سرعة المبيعات (آخر 30 يوم).",
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
      required: [],
    },
    dangerous: false,
    handler: getTopProducts,
  },
  {
    name: "get_team_status",
    category: "read",
    description: "Employee count and monthly payroll exposure.",
    descriptionAr: "عدد الموظفين والرواتب الشهرية.",
    parameters: { type: "object", properties: {}, required: [] },
    dangerous: false,
    handler: getTeamStatus,
  },
  {
    name: "get_inventory_alerts",
    category: "read",
    description: "Products at or below their reorder point.",
    descriptionAr: "المنتجات عند أو أسفل نقطة إعادة الطلب.",
    parameters: { type: "object", properties: {}, required: [] },
    dangerous: false,
    handler: getInventoryAlerts,
  },
  {
    name: "get_helpdesk_status",
    category: "read",
    description: "Open tickets and SLA breaches.",
    descriptionAr: "التذاكر المفتوحة وانتهاكات SLA.",
    parameters: { type: "object", properties: {}, required: [] },
    dangerous: false,
    handler: getHelpdeskStatus,
  },
  {
    name: "run_analyst_report",
    category: "report",
    description: "Run the deep business analyst — produces KPIs, anomalies, opportunities.",
    descriptionAr: "تشغيل المحلل العميق — يخرج KPIs ومخالفات وفرص.",
    parameters: { type: "object", properties: {}, required: [] },
    dangerous: false,
    handler: runAnalystReport,
  },
  {
    name: "get_cash_position",
    category: "read",
    description: "Sum of bank account / cash balances.",
    descriptionAr: "إجمالي أرصدة البنوك والنقد.",
    parameters: { type: "object", properties: {}, required: [] },
    dangerous: false,
    handler: getCashPosition,
  },
  {
    name: "search_entities",
    category: "read",
    description: "Search any record across the company by name/code.",
    descriptionAr: "البحث عن أي سجل في الشركة بالاسم أو الكود.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    dangerous: false,
    handler: searchEntities,
  },
  {
    name: "get_business_health_score",
    category: "read",
    description: "Composite health score 0-100 with components.",
    descriptionAr: "درجة الصحة المركّبة 0-100 مع مكوّناتها.",
    parameters: { type: "object", properties: {}, required: [] },
    dangerous: false,
    handler: getBusinessHealthScore,
  },
  {
    name: "send_invoice_reminder",
    category: "messaging",
    description: "Send WhatsApp reminders to customers with overdue invoices.",
    descriptionAr: "إرسال تذكيرات WhatsApp للعملاء الذين لديهم فواتير متأخرة.",
    parameters: {
      type: "object",
      properties: {
        invoiceIds: { type: "array", items: { type: "string" } },
      },
      required: [],
    },
    dangerous: true,
    handler: sendInvoiceReminder,
  },
  {
    name: "create_invoice",
    category: "write",
    description: "Create a new invoice.",
    descriptionAr: "إنشاء فاتورة جديدة.",
    parameters: {
      type: "object",
      properties: {
        customerId: { type: "string" },
        customerName: { type: "string" },
        amountCents: { type: "number" },
        amount: { type: "number" },
        currency: { type: "string" },
        description: { type: "string" },
      },
      required: [],
    },
    dangerous: true,
    handler: createInvoice,
  },
  {
    name: "mark_invoice_paid",
    category: "write",
    description: "Mark an existing invoice as paid.",
    descriptionAr: "تعليم فاتورة بأنها مدفوعة.",
    parameters: {
      type: "object",
      properties: { invoiceId: { type: "string" } },
      required: ["invoiceId"],
    },
    dangerous: true,
    handler: markInvoicePaid,
  },
  {
    name: "create_expense",
    category: "write",
    description: "Record a new expense.",
    descriptionAr: "تسجيل مصروف جديد.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number" },
        amountCents: { type: "number" },
        description: { type: "string" },
        category: { type: "string" },
        merchant: { type: "string" },
        currency: { type: "string" },
      },
      required: [],
    },
    dangerous: true,
    handler: createExpense,
  },
  {
    name: "assign_ticket_to_agent",
    category: "write",
    description: "Assign a helpdesk ticket to a team member.",
    descriptionAr: "إسناد تذكرة دعم لعضو فريق.",
    parameters: {
      type: "object",
      properties: {
        ticketId: { type: "string" },
        agentUserId: { type: "string" },
      },
      required: ["ticketId", "agentUserId"],
    },
    dangerous: true,
    handler: assignTicketToAgent,
  },
  {
    name: "schedule_follow_up_task",
    category: "write",
    description: "Create a follow-up task due in N days.",
    descriptionAr: "إنشاء مهمة متابعة مستحقة بعد N أيام.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        dueInDays: { type: "number" },
      },
      required: ["title"],
    },
    dangerous: true,
    handler: scheduleFollowUpTask,
  },
  {
    name: "create_marketing_campaign",
    category: "write",
    description: "Draft a new marketing campaign.",
    descriptionAr: "صياغة حملة تسويقية جديدة.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        channel: { type: "string" },
        message: { type: "string" },
      },
      required: ["name"],
    },
    dangerous: true,
    handler: createMarketingCampaign,
  },
  {
    name: "send_whatsapp_to_customer",
    category: "messaging",
    description: "Send a one-off WhatsApp message to a phone number.",
    descriptionAr: "إرسال رسالة WhatsApp مباشرة لرقم.",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string" },
        message: { type: "string" },
      },
      required: ["phone", "message"],
    },
    dangerous: true,
    handler: sendWhatsappToCustomer,
  },
  {
    name: "generate_pdf_report",
    category: "report",
    description: "Queue a PDF financial/operational report.",
    descriptionAr: "طلب تقرير PDF مالي أو تشغيلي.",
    parameters: {
      type: "object",
      properties: {
        reportType: { type: "string" },
        period: { type: "string" },
      },
      required: [],
    },
    dangerous: false,
    handler: generatePdfReport,
  },
  {
    name: "export_data_csv",
    category: "report",
    description: "Export rows of one entity type as CSV.",
    descriptionAr: "تصدير سجلات نوع واحد كملف CSV.",
    parameters: {
      type: "object",
      properties: {
        entityType: { type: "string" },
        limit: { type: "number" },
      },
      required: ["entityType"],
    },
    dangerous: false,
    handler: exportDataCsv,
  },
];

export function findTool(name: string): ToolSpec | undefined {
  return COFOUNDER_TOOLS.find((t) => t.name === name);
}

export function publicToolList(): Array<{
  name: string;
  category: ToolSpec["category"];
  description: string;
  descriptionAr: string;
  dangerous: boolean;
  parameters: ToolSpec["parameters"];
}> {
  return COFOUNDER_TOOLS.map((t) => ({
    name: t.name,
    category: t.category,
    description: t.description,
    descriptionAr: t.descriptionAr,
    dangerous: t.dangerous,
    parameters: t.parameters,
  }));
}
