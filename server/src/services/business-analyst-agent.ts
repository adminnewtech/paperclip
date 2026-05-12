import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// LLM abstraction (mirrors business-ai-service.ts: lazy import + mock fallback)
// ---------------------------------------------------------------------------

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
        }): Promise<{ content: Array<{ type: string; text?: string }> }>;
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
// Public types
// ---------------------------------------------------------------------------

export type AnomalySeverity = "low" | "medium" | "high" | "critical";
export type AnomalyCategory =
  | "revenue"
  | "expense"
  | "cash"
  | "operations"
  | "customer";

export interface InsightAnomaly {
  severity: AnomalySeverity;
  category: AnomalyCategory;
  title: string;
  description: string;
  suggestedAction?: string;
  relatedEntityIds?: string[];
}

export interface InsightOpportunity {
  title: string;
  description: string;
  estimatedImpactCents?: number;
  confidence: "low" | "medium" | "high";
  relatedEntityIds?: string[];
}

export interface InsightRecommendation {
  priority: "P0" | "P1" | "P2";
  title: string;
  description: string;
  rationale: string;
  suggestedOwner?: string;
}

export interface InsightTrend {
  metric: string;
  direction: "up" | "down" | "stable";
  changePercent: number;
  period: string;
}

export interface InsightKpiSnapshot {
  revenueCents: number;
  expensesCents: number;
  netIncomeCents: number;
  pipelineValueCents: number;
  activeCustomers: number;
  grossMarginPercent: number;
}

export interface InsightReport {
  generatedAt: string;
  periodFrom: string;
  periodTo: string;
  executiveSummary: string;
  executiveSummaryAr: string;
  kpiSnapshot: InsightKpiSnapshot;
  anomalies: InsightAnomaly[];
  opportunities: InsightOpportunity[];
  recommendations: InsightRecommendation[];
  trends: InsightTrend[];
  llmEnhanced?: boolean;
}

export interface AnalyzeOptions {
  from?: Date | string;
  to?: Date | string;
  actorId?: string | null;
}

export interface StoredInsightReport {
  id: string;
  companyId: string;
  report: InsightReport;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ANALYST_MODULE_KEY = "analyst";
const ANALYST_ENTITY_TYPE = "insight_report";

function toDate(value: Date | string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? fallback : d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultPeriod(): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  const from = new Date(to.getFullYear(), to.getMonth(), 1, 0, 0, 0, 0);
  return { from, to };
}

function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs);
  return { from: prevFrom, to: prevTo };
}

function percentChange(current: number, prior: number): number {
  if (prior === 0) {
    if (current === 0) return 0;
    return 100;
  }
  return Math.round(((current - prior) / Math.abs(prior)) * 10000) / 100;
}

function trendDirection(change: number): "up" | "down" | "stable" {
  if (change > 2) return "up";
  if (change < -2) return "down";
  return "stable";
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

interface PeriodSnapshot {
  invoices: Array<{
    id: string;
    status: string;
    amountCents: number;
    createdAt: Date;
    customerKey: string;
  }>;
  expenses: Array<{
    id: string;
    category: string;
    vendor: string;
    amountCents: number;
    createdAt: Date;
  }>;
  deals: Array<{
    id: string;
    status: string;
    amountCents: number;
    updatedAt: Date;
    name: string | null;
  }>;
  tickets: Array<{
    id: string;
    status: string;
    createdAt: Date;
    resolvedAt: Date | null;
  }>;
  employees: Array<{ id: string; monthlySalaryCents: number }>;
  products: Array<{
    id: string;
    name: string | null;
    stockLevel: number;
    reorderPoint: number;
    sales30d: number;
    marginPercent: number;
  }>;
  customers: Array<{ id: string; name: string | null }>;
}

async function gatherPeriodSnapshot(
  db: Db,
  companyId: string,
  from: Date,
  to: Date,
): Promise<PeriodSnapshot> {
  const inRange = and(
    eq(businessEntities.companyId, companyId),
    gte(businessEntities.createdAt, from),
    lte(businessEntities.createdAt, to),
  );

  const [invoicesRows, expensesRows, dealsRows, ticketsRows] = await Promise.all([
    db
      .select()
      .from(businessEntities)
      .where(
        and(
          inRange,
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
        ),
      ),
    db
      .select()
      .from(businessEntities)
      .where(
        and(
          inRange,
          eq(businessEntities.moduleKey, "finance"),
          eq(businessEntities.entityType, "expense"),
        ),
      ),
    db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "deal"),
        ),
      ),
    db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "helpdesk"),
          eq(businessEntities.entityType, "ticket"),
        ),
      ),
  ]);

  const [employeeRows, productRows, customerRows] = await Promise.all([
    db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "hr"),
          eq(businessEntities.entityType, "employee"),
        ),
      ),
    db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "inventory"),
          eq(businessEntities.entityType, "product"),
        ),
      ),
    db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "customer"),
        ),
      ),
  ]);

  const invoices = invoicesRows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const customerKey =
      typeof data.customer === "string"
        ? data.customer
        : typeof data.customerId === "string"
          ? data.customerId
          : "Unknown";
    return {
      id: r.id,
      status: r.status,
      amountCents: r.amountCents ?? 0,
      createdAt: r.createdAt,
      customerKey,
    };
  });

  const expenses = expensesRows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      category: typeof data.category === "string" ? data.category : "Uncategorized",
      vendor:
        typeof data.vendor === "string"
          ? data.vendor
          : typeof data.merchant === "string"
            ? data.merchant
            : "",
      amountCents: r.amountCents ?? 0,
      createdAt: r.createdAt,
    };
  });

  const deals = dealsRows.map((r) => ({
    id: r.id,
    status: r.status,
    amountCents: r.amountCents ?? 0,
    updatedAt: r.updatedAt,
    name: r.name,
  }));

  const tickets = ticketsRows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const resolvedAtRaw = data.resolvedAt;
    const resolvedAt =
      typeof resolvedAtRaw === "string" ? new Date(resolvedAtRaw) : null;
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: resolvedAt && !isNaN(resolvedAt.getTime()) ? resolvedAt : null,
    };
  });

  const employees = employeeRows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const salary =
      typeof data.monthlySalaryCents === "number"
        ? data.monthlySalaryCents
        : r.amountCents ?? 0;
    return { id: r.id, monthlySalaryCents: salary };
  });

  const products = productRows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      name: r.name,
      stockLevel:
        typeof data.stockLevel === "number"
          ? data.stockLevel
          : typeof data.stock === "number"
            ? data.stock
            : 0,
      reorderPoint:
        typeof data.reorderPoint === "number" ? data.reorderPoint : 10,
      sales30d:
        typeof data.sales30d === "number" ? data.sales30d : 0,
      marginPercent:
        typeof data.marginPercent === "number" ? data.marginPercent : 0,
    };
  });

  const customers = customerRows.map((r) => ({ id: r.id, name: r.name }));

  return {
    invoices,
    expenses,
    deals,
    tickets,
    employees,
    products,
    customers,
  };
}

// ---------------------------------------------------------------------------
// KPI calculation
// ---------------------------------------------------------------------------

function computeKpis(snap: PeriodSnapshot): InsightKpiSnapshot {
  const revenueCents = snap.invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amountCents, 0);
  const expensesCents = snap.expenses.reduce((s, e) => s + e.amountCents, 0);
  const netIncomeCents = revenueCents - expensesCents;
  const pipelineValueCents = snap.deals
    .filter((d) =>
      ["prospecting", "qualified", "proposal", "negotiation"].includes(d.status),
    )
    .reduce((s, d) => s + d.amountCents, 0);

  const activeCustomerKeys = new Set<string>();
  for (const inv of snap.invoices) {
    if (inv.customerKey && inv.customerKey !== "Unknown") {
      activeCustomerKeys.add(inv.customerKey);
    }
  }

  const grossMarginPercent =
    revenueCents > 0
      ? Math.round((netIncomeCents / revenueCents) * 10000) / 100
      : 0;

  return {
    revenueCents,
    expensesCents,
    netIncomeCents,
    pipelineValueCents,
    activeCustomers: activeCustomerKeys.size,
    grossMarginPercent,
  };
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

function expenseCategoryTotals(
  expenses: PeriodSnapshot["expenses"],
): Map<string, { total: number; ids: string[] }> {
  const map = new Map<string, { total: number; ids: string[] }>();
  for (const e of expenses) {
    const bucket = map.get(e.category) ?? { total: 0, ids: [] };
    bucket.total += e.amountCents;
    bucket.ids.push(e.id);
    map.set(e.category, bucket);
  }
  return map;
}

function detectAnomalies(
  current: PeriodSnapshot,
  prior: PeriodSnapshot,
  currentKpis: InsightKpiSnapshot,
  priorKpis: InsightKpiSnapshot,
): InsightAnomaly[] {
  const anomalies: InsightAnomaly[] = [];

  // 1. Expense category spike > 50% vs prior period
  const currentCats = expenseCategoryTotals(current.expenses);
  const priorCats = expenseCategoryTotals(prior.expenses);
  for (const [category, info] of currentCats.entries()) {
    const priorInfo = priorCats.get(category);
    const priorTotal = priorInfo?.total ?? 0;
    if (priorTotal === 0 && info.total > 100_000) {
      anomalies.push({
        severity: "medium",
        category: "expense",
        title: `New expense category: ${category}`,
        description: `Spending of ${(info.total / 100).toLocaleString()} appeared in "${category}" with no prior baseline.`,
        suggestedAction: "Review for legitimacy and tag the category.",
        relatedEntityIds: info.ids.slice(0, 5),
      });
      continue;
    }
    if (priorTotal > 0) {
      const change = (info.total - priorTotal) / priorTotal;
      if (change > 0.5) {
        const sev: AnomalySeverity =
          change > 2 ? "critical" : change > 1 ? "high" : "medium";
        anomalies.push({
          severity: sev,
          category: "expense",
          title: `Expense spike: ${category}`,
          description: `${category} expenses rose ${Math.round(change * 100)}% (${(priorTotal / 100).toLocaleString()} → ${(info.total / 100).toLocaleString()}).`,
          suggestedAction: `Investigate top vendors driving ${category} growth.`,
          relatedEntityIds: info.ids.slice(0, 5),
        });
      }
    }
  }

  // 2. Outstanding > 30% of monthly revenue
  const outstandingCents = current.invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((s, i) => s + i.amountCents, 0);
  if (
    currentKpis.revenueCents > 0 &&
    outstandingCents > currentKpis.revenueCents * 0.3
  ) {
    const ratio = outstandingCents / Math.max(1, currentKpis.revenueCents);
    anomalies.push({
      severity: ratio > 0.6 ? "high" : "medium",
      category: "cash",
      title: "Cash flow risk: high accounts receivable",
      description: `Outstanding invoices total ${(outstandingCents / 100).toLocaleString()} — ${Math.round(ratio * 100)}% of period revenue.`,
      suggestedAction: "Trigger payment reminders for overdue invoices.",
      relatedEntityIds: current.invoices
        .filter((i) => i.status === "overdue")
        .map((i) => i.id)
        .slice(0, 5),
    });
  }

  // 3. Customer dormancy (no invoices in 90 days)
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const lastInvoiceByCustomer = new Map<string, number>();
  for (const inv of current.invoices) {
    const t = inv.createdAt.getTime();
    const prev = lastInvoiceByCustomer.get(inv.customerKey) ?? 0;
    if (t > prev) lastInvoiceByCustomer.set(inv.customerKey, t);
  }
  for (const [customer, ts] of lastInvoiceByCustomer.entries()) {
    if (ts < ninetyDaysAgo && customer !== "Unknown") {
      anomalies.push({
        severity: "low",
        category: "customer",
        title: `Customer dormant: ${customer}`,
        description: `No invoices issued to ${customer} in over 90 days.`,
        suggestedAction: "Reach out to re-engage the relationship.",
      });
    }
  }

  // 4. Helpdesk SLA / resolution time deterioration
  const currentResolutionDays = avgResolutionDays(current.tickets);
  const priorResolutionDays = avgResolutionDays(prior.tickets);
  if (
    currentResolutionDays !== null &&
    priorResolutionDays !== null &&
    priorResolutionDays > 0 &&
    currentResolutionDays > priorResolutionDays * 1.25
  ) {
    anomalies.push({
      severity: currentResolutionDays > priorResolutionDays * 2 ? "high" : "medium",
      category: "operations",
      title: "Service quality declining",
      description: `Average ticket resolution time rose from ${priorResolutionDays.toFixed(1)}d to ${currentResolutionDays.toFixed(1)}d.`,
      suggestedAction: "Review helpdesk staffing and triage.",
    });
  }

  // 5. Win-rate dropped
  const currentWinRate = winRate(current.deals);
  const priorWinRate = winRate(prior.deals);
  if (
    priorWinRate !== null &&
    currentWinRate !== null &&
    currentWinRate < priorWinRate - 0.1
  ) {
    anomalies.push({
      severity: currentWinRate < priorWinRate - 0.25 ? "high" : "medium",
      category: "revenue",
      title: "Sales conversion declining",
      description: `Deal win rate fell from ${Math.round(priorWinRate * 100)}% to ${Math.round(currentWinRate * 100)}%.`,
      suggestedAction: "Review lost-deal reasons and qualify earlier.",
    });
  }

  // 6. Possible duplicate expenses
  const dupKey = new Map<string, string[]>();
  for (const e of current.expenses) {
    if (!e.vendor) continue;
    const key = `${e.vendor}|${e.amountCents}`;
    const list = dupKey.get(key) ?? [];
    list.push(e.id);
    dupKey.set(key, list);
  }
  for (const [key, ids] of dupKey.entries()) {
    if (ids.length >= 2) {
      const [vendor, amount] = key.split("|");
      anomalies.push({
        severity: "low",
        category: "expense",
        title: "Possible duplicate expense",
        description: `${ids.length} expenses for ${vendor} at ${(Number(amount) / 100).toLocaleString()} within the period.`,
        suggestedAction: "Verify these are not double-entries.",
        relatedEntityIds: ids.slice(0, 5),
      });
    }
  }

  // 7. Net income dropped sharply
  if (
    priorKpis.netIncomeCents > 0 &&
    currentKpis.netIncomeCents < priorKpis.netIncomeCents * 0.5
  ) {
    anomalies.push({
      severity: currentKpis.netIncomeCents < 0 ? "critical" : "high",
      category: "revenue",
      title: "Net income decline",
      description: `Net income fell from ${(priorKpis.netIncomeCents / 100).toLocaleString()} to ${(currentKpis.netIncomeCents / 100).toLocaleString()}.`,
      suggestedAction: "Audit revenue mix and discretionary spend.",
    });
  }

  return anomalies;
}

function avgResolutionDays(
  tickets: PeriodSnapshot["tickets"],
): number | null {
  const resolved = tickets.filter((t) => t.resolvedAt !== null);
  if (resolved.length === 0) return null;
  const totalMs = resolved.reduce(
    (sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()),
    0,
  );
  return totalMs / resolved.length / (1000 * 60 * 60 * 24);
}

function winRate(deals: PeriodSnapshot["deals"]): number | null {
  const won = deals.filter((d) => d.status === "won").length;
  const lost = deals.filter((d) => d.status === "lost").length;
  const total = won + lost;
  if (total === 0) return null;
  return won / total;
}

// ---------------------------------------------------------------------------
// Opportunity identification
// ---------------------------------------------------------------------------

function identifyOpportunities(
  snap: PeriodSnapshot,
  kpis: InsightKpiSnapshot,
): InsightOpportunity[] {
  const opportunities: InsightOpportunity[] = [];

  // 1. Revenue concentration / cross-sell among top customers
  const byCustomer = new Map<string, number>();
  for (const inv of snap.invoices) {
    if (inv.status !== "paid") continue;
    byCustomer.set(
      inv.customerKey,
      (byCustomer.get(inv.customerKey) ?? 0) + inv.amountCents,
    );
  }
  const top = [...byCustomer.entries()]
    .filter(([k]) => k !== "Unknown")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const topTotal = top.reduce((s, [, v]) => s + v, 0);
  if (top.length > 0 && kpis.revenueCents > 0) {
    const share = topTotal / kpis.revenueCents;
    opportunities.push({
      title: `Cross-sell to top ${top.length} customers`,
      description: `Top ${top.length} customers account for ${Math.round(share * 100)}% of revenue (${(topTotal / 100).toLocaleString()}). A targeted upsell campaign could materially lift revenue.`,
      estimatedImpactCents: Math.round(topTotal * 0.15),
      confidence: share > 0.5 ? "high" : "medium",
    });
  }

  // 2. Stale deals in Proposal/Negotiation > 14 days
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const staleDeals = snap.deals.filter(
    (d) =>
      ["proposal", "negotiation"].includes(d.status) &&
      d.updatedAt.getTime() < fourteenDaysAgo,
  );
  if (staleDeals.length > 0) {
    const value = staleDeals.reduce((s, d) => s + d.amountCents, 0);
    opportunities.push({
      title: `Push ${staleDeals.length} stale deals to close`,
      description: `${staleDeals.length} deals in Proposal/Negotiation have not been touched in 14+ days, representing ${(value / 100).toLocaleString()} of pipeline.`,
      estimatedImpactCents: Math.round(value * 0.3),
      confidence: "medium",
      relatedEntityIds: staleDeals.map((d) => d.id).slice(0, 10),
    });
  }

  // 3. Low-stock products with high sales velocity
  const lowStock = snap.products.filter(
    (p) => p.stockLevel <= p.reorderPoint && p.sales30d > 0,
  );
  if (lowStock.length > 0) {
    opportunities.push({
      title: `Reorder ${lowStock.length} fast-moving products`,
      description: `${lowStock.length} products are at or below reorder point with active demand — risk of stockout.`,
      confidence: "high",
      relatedEntityIds: lowStock.map((p) => p.id).slice(0, 10),
    });
  }

  // 4. High-margin / under-promoted products
  const highMargin = snap.products
    .filter((p) => p.marginPercent >= 40 && p.sales30d < 5)
    .slice(0, 5);
  if (highMargin.length > 0) {
    opportunities.push({
      title: `Promote ${highMargin.length} high-margin products`,
      description: `These products have margins ≥40% but low sales velocity. Featured marketing could lift profit.`,
      confidence: "medium",
      relatedEntityIds: highMargin.map((p) => p.id),
    });
  }

  return opportunities;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function buildRecommendations(
  anomalies: InsightAnomaly[],
  opportunities: InsightOpportunity[],
): InsightRecommendation[] {
  const recs: InsightRecommendation[] = [];

  const severityRank: Record<AnomalySeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  const sortedAnoms = [...anomalies].sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity],
  );

  for (const a of sortedAnoms) {
    const priority: InsightRecommendation["priority"] =
      a.severity === "critical"
        ? "P0"
        : a.severity === "high"
          ? "P0"
          : a.severity === "medium"
            ? "P1"
            : "P2";
    recs.push({
      priority,
      title: a.suggestedAction ?? `Address: ${a.title}`,
      description: a.description,
      rationale: `Detected anomaly (${a.severity}, ${a.category}).`,
      suggestedOwner:
        a.category === "cash" || a.category === "revenue"
          ? "Finance"
          : a.category === "customer"
            ? "Sales"
            : a.category === "operations"
              ? "Operations"
              : undefined,
    });
    if (recs.length >= 5) break;
  }

  if (recs.length < 5) {
    const oppsSorted = [...opportunities].sort(
      (a, b) => (b.estimatedImpactCents ?? 0) - (a.estimatedImpactCents ?? 0),
    );
    for (const o of oppsSorted) {
      recs.push({
        priority:
          (o.estimatedImpactCents ?? 0) > 1_000_000
            ? "P1"
            : "P2",
        title: o.title,
        description: o.description,
        rationale: `Identified opportunity (${o.confidence} confidence).`,
        suggestedOwner: "Sales",
      });
      if (recs.length >= 5) break;
    }
  }

  return recs.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

function computeTrends(
  current: PeriodSnapshot,
  prior: PeriodSnapshot,
  currentKpis: InsightKpiSnapshot,
  priorKpis: InsightKpiSnapshot,
): InsightTrend[] {
  const trends: InsightTrend[] = [];

  const revChange = percentChange(currentKpis.revenueCents, priorKpis.revenueCents);
  trends.push({
    metric: "Revenue",
    direction: trendDirection(revChange),
    changePercent: revChange,
    period: "vs prior period",
  });

  const expChange = percentChange(
    currentKpis.expensesCents,
    priorKpis.expensesCents,
  );
  trends.push({
    metric: "Expenses",
    direction: trendDirection(expChange),
    changePercent: expChange,
    period: "vs prior period",
  });

  const currentCustomerKeys = new Set(
    current.invoices.map((i) => i.customerKey).filter((c) => c && c !== "Unknown"),
  );
  const priorCustomerKeys = new Set(
    prior.invoices.map((i) => i.customerKey).filter((c) => c && c !== "Unknown"),
  );
  const newCustomers = [...currentCustomerKeys].filter(
    (c) => !priorCustomerKeys.has(c),
  ).length;
  const priorNewCustomerCount = priorCustomerKeys.size;
  trends.push({
    metric: "New Customers",
    direction: trendDirection(
      percentChange(newCustomers, priorNewCustomerCount),
    ),
    changePercent: percentChange(newCustomers, priorNewCustomerCount),
    period: "vs prior period",
  });

  const dealChange = percentChange(current.deals.length, prior.deals.length);
  trends.push({
    metric: "Deals",
    direction: trendDirection(dealChange),
    changePercent: dealChange,
    period: "vs prior period",
  });

  const ticketChange = percentChange(
    current.tickets.length,
    prior.tickets.length,
  );
  trends.push({
    metric: "Tickets",
    direction: trendDirection(ticketChange),
    changePercent: ticketChange,
    period: "vs prior period",
  });

  return trends;
}

// ---------------------------------------------------------------------------
// Executive summary (LLM or template fallback)
// ---------------------------------------------------------------------------

interface SummaryPair {
  en: string;
  ar: string;
  llmEnhanced: boolean;
}

function templateExecutiveSummaryEn(
  kpis: InsightKpiSnapshot,
  anomalies: InsightAnomaly[],
  opportunities: InsightOpportunity[],
  trends: InsightTrend[],
  periodFrom: string,
  periodTo: string,
): string {
  const revTrend = trends.find((t) => t.metric === "Revenue");
  const expTrend = trends.find((t) => t.metric === "Expenses");
  const critCount = anomalies.filter(
    (a) => a.severity === "critical" || a.severity === "high",
  ).length;

  const p1 = `Between ${periodFrom} and ${periodTo}, the business recorded ${(kpis.revenueCents / 100).toLocaleString()} in revenue and ${(kpis.expensesCents / 100).toLocaleString()} in expenses, producing net income of ${(kpis.netIncomeCents / 100).toLocaleString()} (gross margin ${kpis.grossMarginPercent}%). Active customer count was ${kpis.activeCustomers} and the open pipeline stood at ${(kpis.pipelineValueCents / 100).toLocaleString()}.`;

  const p2 = `Revenue is ${revTrend?.direction ?? "stable"} (${revTrend?.changePercent ?? 0}%) and expenses are ${expTrend?.direction ?? "stable"} (${expTrend?.changePercent ?? 0}%) compared to the prior period. ${critCount > 0 ? `${critCount} high/critical anomaly(ies) were detected and require attention.` : "No high-severity anomalies were detected."} ${opportunities.length > 0 ? `${opportunities.length} growth opportunity(ies) were identified.` : ""}`.trim();

  const topRec = anomalies[0]?.suggestedAction ?? opportunities[0]?.title;
  const p3 = topRec
    ? `The most impactful next step is to ${topRec.toLowerCase()}. Review the recommendations tab for the prioritized action list.`
    : `Continue monitoring key metrics. Review the recommendations tab for any additional actions.`;

  return `${p1}\n\n${p2}\n\n${p3}`;
}

function templateExecutiveSummaryAr(
  kpis: InsightKpiSnapshot,
  anomalies: InsightAnomaly[],
  opportunities: InsightOpportunity[],
  trends: InsightTrend[],
  periodFrom: string,
  periodTo: string,
): string {
  const revTrend = trends.find((t) => t.metric === "Revenue");
  const expTrend = trends.find((t) => t.metric === "Expenses");
  const critCount = anomalies.filter(
    (a) => a.severity === "critical" || a.severity === "high",
  ).length;

  const dir = (d: "up" | "down" | "stable" | undefined) =>
    d === "up" ? "ارتفاع" : d === "down" ? "انخفاض" : "استقرار";

  const p1 = `خلال الفترة من ${periodFrom} إلى ${periodTo}، حققت الشركة إيرادات بقيمة ${(kpis.revenueCents / 100).toLocaleString()} ومصروفات بقيمة ${(kpis.expensesCents / 100).toLocaleString()}، بصافي دخل ${(kpis.netIncomeCents / 100).toLocaleString()} وهامش ربح ${kpis.grossMarginPercent}%. بلغ عدد العملاء النشطين ${kpis.activeCustomers} وقيمة صفقات خط الإنتاج المفتوحة ${(kpis.pipelineValueCents / 100).toLocaleString()}.`;

  const p2 = `الإيرادات في ${dir(revTrend?.direction)} (${revTrend?.changePercent ?? 0}%) والمصروفات في ${dir(expTrend?.direction)} (${expTrend?.changePercent ?? 0}%) مقارنة بالفترة السابقة. ${critCount > 0 ? `تم رصد ${critCount} تنبيه(ات) حرجة تستدعي المعالجة.` : "لم يتم رصد تنبيهات حرجة."} ${opportunities.length > 0 ? `تم تحديد ${opportunities.length} فرصة(فرص) للنمو.` : ""}`.trim();

  const topRec = anomalies[0]?.suggestedAction ?? opportunities[0]?.title;
  const p3 = topRec
    ? `أهم خطوة تالية هي: ${topRec}. راجع قائمة التوصيات للاطلاع على الإجراءات ذات الأولوية.`
    : `استمر في مراقبة المؤشرات الرئيسية وراجع التوصيات للاطلاع على أي إجراءات إضافية.`;

  return `${p1}\n\n${p2}\n\n${p3}`;
}

async function generateExecutiveSummaries(
  kpis: InsightKpiSnapshot,
  anomalies: InsightAnomaly[],
  opportunities: InsightOpportunity[],
  trends: InsightTrend[],
  periodFrom: string,
  periodTo: string,
): Promise<SummaryPair> {
  const fallback: SummaryPair = {
    en: templateExecutiveSummaryEn(
      kpis,
      anomalies,
      opportunities,
      trends,
      periodFrom,
      periodTo,
    ),
    ar: templateExecutiveSummaryAr(
      kpis,
      anomalies,
      opportunities,
      trends,
      periodFrom,
      periodTo,
    ),
    llmEnhanced: false,
  };

  const llm = await getLLMClient();
  if (!llm) return fallback;

  try {
    const system =
      "You are a CFO-grade business analyst. Given structured data, write an executive summary in two languages. " +
      'Respond with JSON: { "en": string, "ar": string }. ' +
      "Each summary must be 2-3 short paragraphs of plain text, no headings, no bullet points. " +
      "Focus on what changed, why it matters, and what to do next.";
    const payload = JSON.stringify({
      periodFrom,
      periodTo,
      kpis,
      trends,
      anomalies: anomalies.slice(0, 8),
      opportunities: opportunities.slice(0, 5),
    });
    const text = await llm.complete({
      system,
      user: payload,
      maxTokens: 1200,
    });
    const parsed = tryParseJson<{ en?: string; ar?: string }>(text);
    if (parsed && typeof parsed.en === "string" && typeof parsed.ar === "string") {
      return { en: parsed.en, ar: parsed.ar, llmEnhanced: true };
    }
  } catch {
    // fall through to template
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzeCompany(
  db: Db,
  companyId: string,
  opts: AnalyzeOptions = {},
): Promise<StoredInsightReport> {
  const { from: defaultFrom, to: defaultTo } = defaultPeriod();
  const from = toDate(opts.from, defaultFrom);
  const to = toDate(opts.to, defaultTo);
  const { from: priorFrom, to: priorTo } = previousPeriod(from, to);

  const [currentSnap, priorSnap] = await Promise.all([
    gatherPeriodSnapshot(db, companyId, from, to),
    gatherPeriodSnapshot(db, companyId, priorFrom, priorTo),
  ]);

  const kpis = computeKpis(currentSnap);
  const priorKpis = computeKpis(priorSnap);
  const anomalies = detectAnomalies(currentSnap, priorSnap, kpis, priorKpis);
  const opportunities = identifyOpportunities(currentSnap, kpis);
  const recommendations = buildRecommendations(anomalies, opportunities);
  const trends = computeTrends(currentSnap, priorSnap, kpis, priorKpis);

  const periodFrom = toISODate(from);
  const periodTo = toISODate(to);
  const summaries = await generateExecutiveSummaries(
    kpis,
    anomalies,
    opportunities,
    trends,
    periodFrom,
    periodTo,
  );

  const report: InsightReport = {
    generatedAt: new Date().toISOString(),
    periodFrom,
    periodTo,
    executiveSummary: summaries.en,
    executiveSummaryAr: summaries.ar,
    kpiSnapshot: kpis,
    anomalies,
    opportunities,
    recommendations,
    trends,
    llmEnhanced: summaries.llmEnhanced,
  };

  const now = new Date();
  const [row] = await db
    .insert(businessEntities)
    .values({
      companyId,
      moduleKey: ANALYST_MODULE_KEY,
      entityType: ANALYST_ENTITY_TYPE,
      name: `Insight Report ${periodFrom} to ${periodTo}`,
      status: "generated",
      ownerUserId: opts.actorId ?? null,
      data: report as unknown as Record<string, unknown>,
      tags: ["analyst", "insight"],
      createdByUserId: opts.actorId ?? null,
      updatedByUserId: opts.actorId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to persist insight report");
  }

  return {
    id: row.id,
    companyId,
    report,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listInsightReports(
  db: Db,
  companyId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{
  reports: Array<{
    id: string;
    generatedAt: string;
    periodFrom: string;
    periodTo: string;
    kpiSnapshot: InsightKpiSnapshot;
    anomalyCount: number;
    opportunityCount: number;
  }>;
  total: number;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const rows = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, ANALYST_MODULE_KEY),
        eq(businessEntities.entityType, ANALYST_ENTITY_TYPE),
      ),
    )
    .orderBy(desc(businessEntities.createdAt))
    .limit(limit)
    .offset(offset);

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, ANALYST_MODULE_KEY),
        eq(businessEntities.entityType, ANALYST_ENTITY_TYPE),
      ),
    );

  return {
    reports: rows.map((r) => {
      const data = (r.data ?? {}) as InsightReport;
      return {
        id: r.id,
        generatedAt: data.generatedAt ?? r.createdAt.toISOString(),
        periodFrom: data.periodFrom ?? "",
        periodTo: data.periodTo ?? "",
        kpiSnapshot:
          data.kpiSnapshot ?? {
            revenueCents: 0,
            expensesCents: 0,
            netIncomeCents: 0,
            pipelineValueCents: 0,
            activeCustomers: 0,
            grossMarginPercent: 0,
          },
        anomalyCount: data.anomalies?.length ?? 0,
        opportunityCount: data.opportunities?.length ?? 0,
      };
    }),
    total: Number(countRows[0]?.count ?? 0),
  };
}

export async function getInsightReport(
  db: Db,
  companyId: string,
  reportId: string,
): Promise<StoredInsightReport | null> {
  const [row] = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.id, reportId),
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, ANALYST_MODULE_KEY),
        eq(businessEntities.entityType, ANALYST_ENTITY_TYPE),
      ),
    );
  if (!row) return null;
  return {
    id: row.id,
    companyId,
    report: (row.data ?? {}) as InsightReport,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getLatestInsightReport(
  db: Db,
  companyId: string,
): Promise<StoredInsightReport | null> {
  const [row] = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, ANALYST_MODULE_KEY),
        eq(businessEntities.entityType, ANALYST_ENTITY_TYPE),
      ),
    )
    .orderBy(desc(businessEntities.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    companyId,
    report: (row.data ?? {}) as InsightReport,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function deleteInsightReport(
  db: Db,
  companyId: string,
  reportId: string,
): Promise<boolean> {
  const result = await db
    .delete(businessEntities)
    .where(
      and(
        eq(businessEntities.id, reportId),
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, ANALYST_MODULE_KEY),
        eq(businessEntities.entityType, ANALYST_ENTITY_TYPE),
      ),
    )
    .returning();
  return result.length > 0;
}

export const ANALYST_CONSTANTS = {
  moduleKey: ANALYST_MODULE_KEY,
  entityType: ANALYST_ENTITY_TYPE,
};
