// ---------------------------------------------------------------------------
// Command Center — pure, deterministic insight functions.
//
// Every function here takes plain arrays / primitives (NO database access) so
// they are fully unit-testable and side-effect free. The orchestration layer
// (command-center.ts) is responsible for fetching rows and persisting results.
//
// Determinism note: any function whose output depends on "now" takes an
// explicit `nowIso` parameter instead of calling Date.now(), so tests are
// stable and the same inputs always produce the same outputs. This also keeps
// the door open for an AI narrator to prose-ify the structured output later.
// ---------------------------------------------------------------------------

export type InsightSeverity = "info" | "warning" | "critical";
export type InsightKind =
  | "reorder"
  | "cashflow"
  | "deal_forecast"
  | "churn_risk"
  | "sla_breach"
  | "overdue_invoice";

export interface Insight {
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
  data: Record<string, unknown>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CHURN_DAYS = 90;

function toTime(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// Reorder suggestions
// ---------------------------------------------------------------------------
export interface StockRow {
  variantId?: string | null;
  warehouseId?: string | null;
  qty: number;
  reorderPoint?: number | null;
}

/**
 * Flag stock rows at or below their reorder point. Suggested order quantity is
 * `reorderPoint * 2 - qty` (clamped to at least 1). A row that is fully depleted
 * or negative (qty <= 0) is `critical`; otherwise `warning`.
 */
export function reorderSuggestions(stockRows: StockRow[]): Insight[] {
  const insights: Insight[] = [];
  for (const row of stockRows) {
    const reorderPoint = row.reorderPoint ?? 0;
    if (reorderPoint <= 0) continue;
    if (row.qty > reorderPoint) continue;

    const suggestedQty = Math.max(1, reorderPoint * 2 - row.qty);
    const severity: InsightSeverity = row.qty <= 0 ? "critical" : "warning";
    insights.push({
      kind: "reorder",
      severity,
      title:
        severity === "critical"
          ? "Out of stock — reorder now"
          : "Low stock — reorder soon",
      detail: `On hand ${row.qty} at/below reorder point ${reorderPoint}. Suggested order: ${suggestedQty}.`,
      data: {
        variantId: row.variantId ?? null,
        warehouseId: row.warehouseId ?? null,
        qty: row.qty,
        reorderPoint,
        suggestedQty,
      },
    });
  }
  return insights;
}

// ---------------------------------------------------------------------------
// Cash position
// ---------------------------------------------------------------------------
export interface CashInvoiceRow {
  totalMinor: number;
  paidMinor: number;
  status?: string | null;
  dueDate?: string | Date | null;
}

export interface CashBillRow {
  totalMinor: number;
  paidMinor: number;
  status?: string | null;
}

export interface CashPosition {
  totalReceivableMinor: number;
  totalPayableMinor: number;
  netMinor: number;
  overdueReceivableMinor: number;
}

/**
 * Compute the deterministic cash position from invoices (AR) and bills (AP).
 * Outstanding = total - paid (clamped to >= 0). "Overdue receivable" is the
 * outstanding portion of unpaid invoices whose due date is strictly before
 * `nowIso` (default: now).
 */
export function cashPosition(
  args: { invoices: CashInvoiceRow[]; bills: CashBillRow[] },
  nowIso?: string,
): CashPosition {
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  let totalReceivableMinor = 0;
  let totalPayableMinor = 0;
  let overdueReceivableMinor = 0;

  for (const inv of args.invoices) {
    const outstanding = Math.max(0, inv.totalMinor - inv.paidMinor);
    if (outstanding <= 0) continue;
    totalReceivableMinor += outstanding;
    const due = toTime(inv.dueDate);
    if (due !== null && due < now) {
      overdueReceivableMinor += outstanding;
    }
  }

  for (const bill of args.bills) {
    const outstanding = Math.max(0, bill.totalMinor - bill.paidMinor);
    if (outstanding <= 0) continue;
    totalPayableMinor += outstanding;
  }

  return {
    totalReceivableMinor,
    totalPayableMinor,
    netMinor: totalReceivableMinor - totalPayableMinor,
    overdueReceivableMinor,
  };
}

// ---------------------------------------------------------------------------
// Deal forecast (weighted pipeline)
// ---------------------------------------------------------------------------
export interface ForecastDealRow {
  id?: string | null;
  name?: string | null;
  amountMinor: number;
  stageId?: string | null;
  status?: string | null;
}

export interface ForecastStageRow {
  id: string;
  name?: string | null;
  winProbability: number;
}

export interface DealForecast {
  weightedMinor: number;
  openCount: number;
  byStage: Array<{
    stageId: string;
    stageName: string;
    weightedMinor: number;
    count: number;
  }>;
}

/**
 * Weighted pipeline = Σ(deal.amountMinor * stage.winProbability / 100) over
 * open deals (status "open" or unset). Deals whose stage is unknown contribute
 * 0% probability. Rounds the weighted contribution to whole minor units.
 */
export function dealForecast(
  deals: ForecastDealRow[],
  stages: ForecastStageRow[],
): DealForecast {
  const stageById = new Map(stages.map((s) => [s.id, s]));
  let weightedMinor = 0;
  let openCount = 0;
  const byStageMap = new Map<
    string,
    { stageId: string; stageName: string; weightedMinor: number; count: number }
  >();

  for (const deal of deals) {
    const status = deal.status ?? "open";
    if (status !== "open") continue;
    openCount += 1;

    const stage = deal.stageId ? stageById.get(deal.stageId) : undefined;
    const prob = stage ? stage.winProbability : 0;
    const weighted = Math.round((deal.amountMinor * prob) / 100);
    weightedMinor += weighted;

    const stageKey = deal.stageId ?? "unstaged";
    const stageName = stage?.name ?? "Unstaged";
    const bucket = byStageMap.get(stageKey) ?? {
      stageId: stageKey,
      stageName,
      weightedMinor: 0,
      count: 0,
    };
    bucket.weightedMinor += weighted;
    bucket.count += 1;
    byStageMap.set(stageKey, bucket);
  }

  return {
    weightedMinor,
    openCount,
    byStage: Array.from(byStageMap.values()),
  };
}

// ---------------------------------------------------------------------------
// Churn risk
// ---------------------------------------------------------------------------
export interface ChurnCustomerRow {
  id?: string | null;
  name?: string | null;
}

export interface ChurnInvoiceRow {
  customerId?: string | null;
  customerName?: string | null;
  issueDate?: string | Date | null;
  createdAt?: string | Date | null;
}

/**
 * Flag customers with no invoice in the last `CHURN_DAYS` (90) days relative to
 * `nowIso`. A customer is matched to invoices by id (preferred) or name. A
 * customer with NO invoices at all is also flagged (never transacted recently).
 */
export function churnRisk(
  customers: ChurnCustomerRow[],
  invoices: ChurnInvoiceRow[],
  nowIso: string,
): Insight[] {
  const now = new Date(nowIso).getTime();
  const cutoff = now - CHURN_DAYS * MS_PER_DAY;

  // Latest invoice time per customer key (id and name both indexed).
  const latestByKey = new Map<string, number>();
  for (const inv of invoices) {
    const t = toTime(inv.issueDate) ?? toTime(inv.createdAt);
    if (t === null) continue;
    for (const key of [inv.customerId, inv.customerName]) {
      if (!key) continue;
      const prev = latestByKey.get(key);
      if (prev === undefined || t > prev) latestByKey.set(key, t);
    }
  }

  const insights: Insight[] = [];
  for (const customer of customers) {
    const keys = [customer.id, customer.name].filter(
      (k): k is string => !!k,
    );
    let latest: number | null = null;
    for (const key of keys) {
      const t = latestByKey.get(key);
      if (t !== undefined && (latest === null || t > latest)) latest = t;
    }

    if (latest === null || latest < cutoff) {
      const daysSince =
        latest === null
          ? null
          : Math.floor((now - latest) / MS_PER_DAY);
      insights.push({
        kind: "churn_risk",
        severity: "warning",
        title: "Customer at churn risk",
        detail:
          latest === null
            ? `${customer.name ?? "Customer"} has no recent invoices.`
            : `${customer.name ?? "Customer"} has no invoice in ${daysSince} days.`,
        data: {
          customerId: customer.id ?? null,
          customerName: customer.name ?? null,
          lastInvoiceAt: latest === null ? null : new Date(latest).toISOString(),
          daysSinceLastInvoice: daysSince,
        },
      });
    }
  }
  return insights;
}

// ---------------------------------------------------------------------------
// Overdue invoices
// ---------------------------------------------------------------------------
export interface OverdueInvoiceRow {
  id?: string | null;
  number?: string | null;
  customerName?: string | null;
  totalMinor: number;
  paidMinor: number;
  status?: string | null;
  dueDate?: string | Date | null;
  currency?: string | null;
}

/**
 * Flag unpaid invoices (outstanding > 0, status not "paid"/"void") whose due
 * date is strictly before `nowIso`. Severity escalates to `critical` once the
 * invoice is more than 30 days overdue.
 */
export function overdueInvoices(
  invoices: OverdueInvoiceRow[],
  nowIso: string,
): Insight[] {
  const now = new Date(nowIso).getTime();
  const insights: Insight[] = [];

  for (const inv of invoices) {
    const status = inv.status ?? "";
    if (status === "paid" || status === "void") continue;
    const outstanding = Math.max(0, inv.totalMinor - inv.paidMinor);
    if (outstanding <= 0) continue;
    const due = toTime(inv.dueDate);
    if (due === null || due >= now) continue;

    const daysOverdue = Math.floor((now - due) / MS_PER_DAY);
    const severity: InsightSeverity = daysOverdue > 30 ? "critical" : "warning";
    insights.push({
      kind: "overdue_invoice",
      severity,
      title: "Overdue invoice",
      detail: `Invoice ${inv.number ?? inv.id ?? ""} for ${
        inv.customerName ?? "customer"
      } is ${daysOverdue} days overdue (${outstanding} ${inv.currency ?? "KWD"} minor outstanding).`,
      data: {
        invoiceId: inv.id ?? null,
        number: inv.number ?? null,
        customerName: inv.customerName ?? null,
        outstandingMinor: outstanding,
        currency: inv.currency ?? "KWD",
        daysOverdue,
      },
    });
  }
  return insights;
}

// ---------------------------------------------------------------------------
// SLA breaches
// ---------------------------------------------------------------------------
export interface SlaTicketRow {
  id?: string | null;
  number?: string | null;
  subject?: string | null;
  status?: string | null;
  slaDueAt?: string | Date | null;
}

/**
 * Flag open tickets (status not "closed"/"resolved") whose `slaDueAt` is
 * strictly before `nowIso`. Severity escalates to `critical` past 24h overdue.
 */
export function slaBreaches(
  tickets: SlaTicketRow[],
  nowIso: string,
): Insight[] {
  const now = new Date(nowIso).getTime();
  const insights: Insight[] = [];

  for (const ticket of tickets) {
    const status = ticket.status ?? "";
    if (status === "closed" || status === "resolved") continue;
    const due = toTime(ticket.slaDueAt);
    if (due === null || due >= now) continue;

    const hoursOverdue = Math.floor((now - due) / (60 * 60 * 1000));
    const severity: InsightSeverity = hoursOverdue > 24 ? "critical" : "warning";
    insights.push({
      kind: "sla_breach",
      severity,
      title: "SLA breached",
      detail: `Ticket ${ticket.number ?? ticket.id ?? ""} (${
        ticket.subject ?? "no subject"
      }) is ${hoursOverdue}h past its SLA.`,
      data: {
        ticketId: ticket.id ?? null,
        number: ticket.number ?? null,
        subject: ticket.subject ?? null,
        hoursOverdue,
      },
    });
  }
  return insights;
}

// ---------------------------------------------------------------------------
// Briefing assembly
// ---------------------------------------------------------------------------
export interface BriefingMetrics {
  revenueMinor: number;
  openDeals: number;
  weightedPipelineMinor: number;
  lowStockCount: number;
  overdueCount: number;
  openTickets: number;
  cashNetMinor: number;
}

export interface Briefing {
  summary: string;
  metrics: BriefingMetrics;
  alerts: Insight[];
  insights: Insight[];
}

/** KWD has 3 decimal places; format minor units to a major-unit string. */
function minorToMajorStr(minor: number, fractionDigits = 3): string {
  const major = minor / 10 ** fractionDigits;
  return major.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Build a deterministic, natural-language-ish briefing. The summary string
 * embeds the key numbers so it reads as prose but is fully reproducible; an AI
 * narrator can later replace `summary` with a richer rendering of the same
 * `metrics` + `insights`. Alerts are the subset of insights with warning or
 * critical severity.
 */
export function buildBriefing(args: {
  company?: { name?: string | null; currency?: string | null } | null;
  metrics: BriefingMetrics;
  insights: Insight[];
}): Briefing {
  const { metrics, insights } = args;
  const currency = args.company?.currency ?? "KWD";
  const companyName = args.company?.name ?? "Your business";

  const alerts = insights.filter(
    (i) => i.severity === "warning" || i.severity === "critical",
  );
  const criticalCount = insights.filter((i) => i.severity === "critical").length;

  const parts: string[] = [];
  parts.push(
    `${metrics.openDeals} open deals worth ${minorToMajorStr(
      metrics.weightedPipelineMinor,
    )} ${currency} (weighted)`,
  );
  parts.push(`${metrics.lowStockCount} low-stock items`);
  parts.push(`${metrics.overdueCount} overdue invoices`);
  parts.push(`${metrics.openTickets} open tickets`);
  parts.push(
    `cash net ${minorToMajorStr(metrics.cashNetMinor)} ${currency}`,
  );
  parts.push(
    `revenue ${minorToMajorStr(metrics.revenueMinor)} ${currency}`,
  );

  let summary = `${companyName}: ${parts.join(", ")}.`;
  if (criticalCount > 0) {
    summary += ` ${criticalCount} critical alert${
      criticalCount === 1 ? "" : "s"
    } need attention.`;
  } else if (alerts.length > 0) {
    summary += ` ${alerts.length} item${
      alerts.length === 1 ? "" : "s"
    } to review.`;
  } else {
    summary += " No alerts — all clear.";
  }

  return { summary, metrics, alerts, insights };
}
