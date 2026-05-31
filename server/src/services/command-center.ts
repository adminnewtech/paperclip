import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosStock,
  bosInvoice,
  bosBill,
  bosDeal,
  bosPipelineStage,
  bosTicket,
  bosBriefing,
  bosInsight,
} from "@paperclipai/db";
import {
  reorderSuggestions,
  cashPosition,
  dealForecast,
  churnRisk,
  overdueInvoices,
  slaBreaches,
  buildBriefing,
  type Insight,
  type BriefingMetrics,
  type ChurnCustomerRow,
} from "./insights.js";

export interface CommandCenterParams {
  companyId: string;
}

export interface CommandCenterMetricsResult {
  metrics: BriefingMetrics;
  insights: Insight[];
  summary: string;
}

export interface GenerateBriefingResult {
  briefing: typeof bosBriefing.$inferSelect;
  insights: Array<typeof bosInsight.$inferSelect>;
}

// The kinds we manage as "unresolved system insights" — cleared and re-inserted
// on each generation so the board always reflects the latest snapshot.
const MANAGED_KINDS = [
  "reorder",
  "deal_forecast",
  "churn_risk",
  "overdue_invoice",
  "sla_breach",
  "cashflow",
] as const;

/**
 * Aggregate cross-module data for a company and run the pure insight functions.
 * Returns the computed metrics + insights + deterministic summary WITHOUT
 * persisting anything (used by both the live metrics endpoint and the
 * generate-and-store flow).
 */
async function computeCommandCenter(
  db: Db,
  params: CommandCenterParams,
  nowIso: string,
): Promise<CommandCenterMetricsResult> {
  const { companyId } = params;

  const [stockRows, invoiceRows, billRows, dealRows, stageRows, ticketRows] =
    await Promise.all([
      db
        .select()
        .from(bosStock)
        .where(eq(bosStock.companyId, companyId)),
      db
        .select()
        .from(bosInvoice)
        .where(eq(bosInvoice.companyId, companyId)),
      db.select().from(bosBill).where(eq(bosBill.companyId, companyId)),
      db.select().from(bosDeal).where(eq(bosDeal.companyId, companyId)),
      db
        .select()
        .from(bosPipelineStage)
        .where(eq(bosPipelineStage.companyId, companyId)),
      db.select().from(bosTicket).where(eq(bosTicket.companyId, companyId)),
    ]);

  // Derive a distinct customer list from invoices (id preferred, name fallback)
  // so churn detection works without depending on a separate CRM contact table.
  const customerMap = new Map<string, ChurnCustomerRow>();
  for (const inv of invoiceRows) {
    const key = inv.customerId ?? inv.customerName;
    if (!key) continue;
    if (!customerMap.has(key)) {
      customerMap.set(key, {
        id: inv.customerId ?? null,
        name: inv.customerName ?? null,
      });
    }
  }
  const customers = Array.from(customerMap.values());

  // Run pure insight functions.
  const reorder = reorderSuggestions(stockRows);
  const overdue = overdueInvoices(invoiceRows, nowIso);
  const sla = slaBreaches(ticketRows, nowIso);
  const churn = churnRisk(customers, invoiceRows, nowIso);
  const forecast = dealForecast(dealRows, stageRows);
  const cash = cashPosition(
    { invoices: invoiceRows, bills: billRows },
    nowIso,
  );

  const insights: Insight[] = [...reorder, ...overdue, ...sla, ...churn];

  // Metrics aggregation.
  const revenueMinor = invoiceRows
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + inv.paidMinor, 0);
  const openTickets = ticketRows.filter(
    (t) => t.status !== "closed" && t.status !== "resolved",
  ).length;

  const metrics: BriefingMetrics = {
    revenueMinor,
    openDeals: forecast.openCount,
    weightedPipelineMinor: forecast.weightedMinor,
    lowStockCount: reorder.length,
    overdueCount: overdue.length,
    openTickets,
    cashNetMinor: cash.netMinor,
  };

  const briefing = buildBriefing({ metrics, insights });

  return { metrics, insights, summary: briefing.summary };
}

/**
 * Compute the live command-center metrics + insights WITHOUT persisting.
 */
export async function commandCenterMetrics(
  db: Db,
  params: CommandCenterParams,
): Promise<CommandCenterMetricsResult> {
  return computeCommandCenter(db, params, new Date().toISOString());
}

/**
 * Generate a briefing: aggregate cross-module data, run the pure insight
 * functions, then persist a `bos_briefing` row and the `bos_insight` rows.
 * Prior unresolved managed insights are cleared first so the board reflects the
 * latest snapshot. All writes happen in a single transaction.
 */
export async function generateBriefing(
  db: Db,
  params: CommandCenterParams,
): Promise<GenerateBriefingResult> {
  const { companyId } = params;
  const nowIso = new Date().toISOString();

  const { metrics, insights, summary } = await computeCommandCenter(
    db,
    params,
    nowIso,
  );

  const alerts = insights.filter(
    (i) => i.severity === "warning" || i.severity === "critical",
  );

  return db.transaction(async (tx) => {
    // Clear prior unresolved managed insights so the snapshot is fresh.
    for (const kind of MANAGED_KINDS) {
      await tx
        .delete(bosInsight)
        .where(
          and(
            eq(bosInsight.companyId, companyId),
            eq(bosInsight.kind, kind),
            eq(bosInsight.resolved, false),
          ),
        );
    }

    const [briefing] = await tx
      .insert(bosBriefing)
      .values({
        companyId,
        period: "daily",
        summary,
        metrics,
        alerts,
        insights,
      })
      .returning();
    if (!briefing) {
      throw new Error("Failed to create briefing");
    }

    let insertedInsights: Array<typeof bosInsight.$inferSelect> = [];
    if (insights.length > 0) {
      insertedInsights = await tx
        .insert(bosInsight)
        .values(
          insights.map((i) => ({
            companyId,
            kind: i.kind,
            severity: i.severity,
            title: i.title,
            detail: i.detail,
            data: i.data,
            resolved: false,
          })),
        )
        .returning();
    }

    return { briefing, insights: insertedInsights };
  });
}

/**
 * Return the most recent briefing for a company, or null if none generated yet.
 */
export async function getLatestBriefing(
  db: Db,
  params: CommandCenterParams,
): Promise<typeof bosBriefing.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(bosBriefing)
    .where(eq(bosBriefing.companyId, params.companyId))
    .orderBy(desc(bosBriefing.generatedAt))
    .limit(1);
  return row ?? null;
}

/**
 * List a company's insights, newest first.
 */
export async function listInsights(
  db: Db,
  params: CommandCenterParams,
): Promise<Array<typeof bosInsight.$inferSelect>> {
  return db
    .select()
    .from(bosInsight)
    .where(eq(bosInsight.companyId, params.companyId))
    .orderBy(desc(bosInsight.createdAt));
}
