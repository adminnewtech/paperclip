import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  SUBSCORE_DEFINITIONS,
  computeAllSubscores,
  type ScorerInput,
  type ScorerInvoice,
  type ScorerExpense,
  type ScorerDeal,
  type ScorerTicket,
  type ScorerContact,
  type ScorerEmployee,
  type SubScore,
  type SubScoreStatus,
} from "./scorers.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HealthGrade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
export type HealthStatus =
  | "excellent"
  | "good"
  | "fair"
  | "concerning"
  | "critical";
export type HealthTrend = "rising" | "stable" | "falling";

export interface HealthIssue {
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  description: string;
  descriptionAr: string;
  suggestedAction?: string;
  relatedEntityIds?: string[];
}

export interface HealthWin {
  category: string;
  description: string;
  descriptionAr: string;
  impactScore: number;
}

export interface BusinessHealthScore {
  overall: number;
  grade: HealthGrade;
  status: HealthStatus;
  computedAt: string;
  periodFrom: string;
  periodTo: string;
  trend: HealthTrend;
  trendChangePoints: number;
  subscores: SubScore[];
  topIssues: HealthIssue[];
  topWins: HealthWin[];
  recommendations: string[];
}

export interface BusinessHealthService {
  computeScore(
    companyId: string,
    opts?: { now?: Date; actorId?: string | null },
  ): Promise<BusinessHealthScore>;
  getLatest(companyId: string): Promise<BusinessHealthScore | null>;
  getHistory(
    companyId: string,
    opts?: { from?: string; to?: string; limit?: number },
  ): Promise<BusinessHealthScore[]>;
  comparePeriods(
    companyId: string,
    period1: [string, string],
    period2: [string, string],
  ): Promise<{
    p1: BusinessHealthScore;
    p2: BusinessHealthScore;
    diff: { overall: number; perSubscore: Record<string, number> };
  }>;
  computeAndStore(
    companyId: string,
    opts?: { now?: Date; actorId?: string | null },
  ): Promise<BusinessHealthScore>;
  getSubscoreDefinitions(): Array<{
    key: string;
    name: string;
    nameAr: string;
    category: string;
    weight: number;
  }>;
}

const HEALTH_MODULE_KEY = "health";
const HEALTH_ENTITY_TYPE = "score";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function gradeFor(score: number): HealthGrade {
  if (score >= 95) return "A+";
  if (score >= 88) return "A";
  if (score >= 80) return "B+";
  if (score >= 72) return "B";
  if (score >= 64) return "C+";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function statusFor(score: number): HealthStatus {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  if (score >= 30) return "concerning";
  return "critical";
}

function trendFor(diff: number): HealthTrend {
  if (diff > 1) return "rising";
  if (diff < -1) return "falling";
  return "stable";
}

function severityFromScore(score: number): HealthIssue["severity"] {
  if (score < 30) return "critical";
  if (score < 45) return "high";
  if (score < 60) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

async function gatherScorerInput(
  db: Db,
  companyId: string,
  periodFrom: Date,
  periodTo: Date,
): Promise<{ input: ScorerInput; priorRevenueCents: number }> {
  const inRange = and(
    eq(businessEntities.companyId, companyId),
    gte(businessEntities.createdAt, periodFrom),
    lte(businessEntities.createdAt, periodTo),
  );

  const [
    invoicesRows,
    expensesRows,
    dealsRows,
    ticketsRows,
    employeesRows,
    contactsRows,
  ] = await Promise.all([
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
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "customer"),
        ),
      ),
  ]);

  // Prior period — same length, immediately before
  const periodLen = periodTo.getTime() - periodFrom.getTime();
  const priorFrom = new Date(periodFrom.getTime() - periodLen);
  const priorTo = new Date(periodFrom.getTime() - 1);
  const priorInvoiceRows = await db
    .select()
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "sales"),
        eq(businessEntities.entityType, "invoice"),
        gte(businessEntities.createdAt, priorFrom),
        lte(businessEntities.createdAt, priorTo),
      ),
    );
  const priorRevenueCents = priorInvoiceRows
    .filter((r) => r.status === "paid")
    .reduce((s, r) => s + (r.amountCents ?? 0), 0);

  const invoices: ScorerInvoice[] = invoicesRows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const dueRaw = data.dueDate;
    const dueDate = typeof dueRaw === "string" ? new Date(dueRaw) : null;
    return {
      id: r.id,
      status: r.status,
      amountCents: r.amountCents ?? 0,
      createdAt: r.createdAt,
      dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
      customerKey:
        typeof data.customer === "string"
          ? data.customer
          : typeof data.customerId === "string"
            ? data.customerId
            : "Unknown",
    };
  });

  const expenses: ScorerExpense[] = expensesRows.map((r) => {
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

  const deals: ScorerDeal[] = dealsRows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const closedRaw = data.closedAt;
    const closedAt = typeof closedRaw === "string" ? new Date(closedRaw) : null;
    return {
      id: r.id,
      status: r.status,
      amountCents: r.amountCents ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      closedAt: closedAt && !isNaN(closedAt.getTime()) ? closedAt : null,
    };
  });

  const tickets: ScorerTicket[] = ticketsRows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const resolvedRaw = data.resolvedAt;
    const resolvedAt =
      typeof resolvedRaw === "string" ? new Date(resolvedRaw) : null;
    const firstRespRaw = data.firstResponseAt;
    const firstResponseAt =
      typeof firstRespRaw === "string" ? new Date(firstRespRaw) : null;
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: resolvedAt && !isNaN(resolvedAt.getTime()) ? resolvedAt : null,
      firstResponseAt:
        firstResponseAt && !isNaN(firstResponseAt.getTime())
          ? firstResponseAt
          : null,
      slaMinutes:
        typeof data.slaMinutes === "number" ? data.slaMinutes : null,
    };
  });

  const employees: ScorerEmployee[] = employeesRows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      monthlySalaryCents:
        typeof data.monthlySalaryCents === "number"
          ? data.monthlySalaryCents
          : r.amountCents ?? 0,
    };
  });

  const contacts: ScorerContact[] = contactsRows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
  }));

  // Bank balance: sum of finance payment entities — use as proxy when no real bank data.
  // We approximate cash as the net of paid invoices minus expenses for the trailing period.
  const cashIn = invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amountCents, 0);
  const cashOut = expenses.reduce((s, e) => s + e.amountCents, 0);
  const bankBalanceCents = Math.max(0, cashIn - cashOut);

  const input: ScorerInput = {
    invoices,
    expenses,
    contacts,
    deals,
    tickets,
    employees,
    bankBalanceCents,
    period: { from: toISODate(periodFrom), to: toISODate(periodTo) },
    priorRevenueCents,
  };

  return { input, priorRevenueCents };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function weightedOverall(subscores: SubScore[]): number {
  const totalWeight = subscores.reduce((s, sub) => s + sub.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = subscores.reduce(
    (s, sub) => s + sub.score * sub.weight,
    0,
  );
  return Math.round((weighted / totalWeight) * 10) / 10;
}

function pickTopIssues(subscores: SubScore[]): HealthIssue[] {
  const issues = subscores
    .filter((s) => s.score < 60)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  return issues.map((s) => ({
    severity: severityFromScore(s.score),
    category: s.category,
    description: `${s.name}: ${s.description}`,
    descriptionAr: `${s.nameAr}: ${s.descriptionAr}`,
    suggestedAction: suggestionFor(s),
  }));
}

function pickTopWins(subscores: SubScore[]): HealthWin[] {
  const wins = subscores
    .filter((s) => s.score >= 85)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return wins.map((s) => ({
    category: s.category,
    description: `${s.name}: ${s.description}`,
    descriptionAr: `${s.nameAr}: ${s.descriptionAr}`,
    impactScore: Math.round(s.score * s.weight * 10) / 10,
  }));
}

function suggestionFor(sub: SubScore): string {
  switch (sub.key) {
    case "cash_runway":
      return "Tighten discretionary spend and accelerate collections to extend runway.";
    case "revenue_growth":
      return "Review pricing, sales pipeline, and top-of-funnel marketing channels.";
    case "gross_margin":
      return "Renegotiate top supplier contracts or audit product unit economics.";
    case "ar_aging":
      return "Trigger automated reminders and a dunning sequence for invoices >60 days.";
    case "customer_concentration":
      return "Invest in customer diversification — new verticals or channels.";
    case "deal_velocity":
      return "Streamline qualification and proposal stages; remove blockers.";
    case "ticket_response_time":
      return "Add a triage rotation or auto-acknowledgement to reduce first-response lag.";
    case "ticket_resolution_rate":
      return "Audit unresolved tickets and assign owners with SLA deadlines.";
    case "inventory_turnover":
      return "Liquidate slow-moving stock and tighten reorder thresholds.";
    case "employee_productivity":
      return "Audit non-productive overhead; consider automation of repetitive workflows.";
    case "pipeline_coverage":
      return "Boost top-of-funnel — campaigns, outbound, partner referrals.";
    case "expense_ratio":
      return "Run an expense audit across top 5 categories and cap discretionary growth.";
    default:
      return "Investigate the underlying drivers and set a target for the next period.";
  }
}

function buildRecommendations(
  subscores: SubScore[],
  issues: HealthIssue[],
): string[] {
  const recs: string[] = [];
  for (const issue of issues) {
    if (issue.suggestedAction) recs.push(issue.suggestedAction);
  }
  // Fill with top neutral subscores if we don't have enough
  if (recs.length < 3) {
    const neutrals = subscores
      .filter((s) => s.score >= 60 && s.score < 85)
      .sort((a, b) => a.score - b.score);
    for (const n of neutrals) {
      const tip = suggestionFor(n);
      if (!recs.includes(tip)) recs.push(tip);
      if (recs.length >= 3) break;
    }
  }
  return recs.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createBusinessHealthService(db: Db): BusinessHealthService {
  async function computeForRange(
    companyId: string,
    periodFrom: Date,
    periodTo: Date,
    priorScore: BusinessHealthScore | null,
  ): Promise<BusinessHealthScore> {
    const { input } = await gatherScorerInput(db, companyId, periodFrom, periodTo);
    const subscores = computeAllSubscores(input);
    const overall = weightedOverall(subscores);
    const trendDiff = priorScore ? overall - priorScore.overall : 0;
    const topIssues = pickTopIssues(subscores);
    const topWins = pickTopWins(subscores);
    const recommendations = buildRecommendations(subscores, topIssues);
    return {
      overall,
      grade: gradeFor(overall),
      status: statusFor(overall),
      computedAt: new Date().toISOString(),
      periodFrom: toISODate(periodFrom),
      periodTo: toISODate(periodTo),
      trend: trendFor(trendDiff),
      trendChangePoints: Math.round(trendDiff * 10) / 10,
      subscores,
      topIssues,
      topWins,
      recommendations,
    };
  }

  function defaultPeriod(now: Date): { from: Date; to: Date } {
    const to = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
    );
    const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  async function fetchLatestStored(
    companyId: string,
  ): Promise<BusinessHealthScore | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, HEALTH_MODULE_KEY),
          eq(businessEntities.entityType, HEALTH_ENTITY_TYPE),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(1);
    if (!row) return null;
    return (row.data ?? null) as BusinessHealthScore | null;
  }

  const service: BusinessHealthService = {
    async computeScore(companyId, opts) {
      const now = opts?.now ?? new Date();
      const { from, to } = defaultPeriod(now);
      const prior = await fetchLatestStored(companyId);
      return computeForRange(companyId, from, to, prior);
    },

    async getLatest(companyId) {
      return fetchLatestStored(companyId);
    },

    async getHistory(companyId, opts) {
      const limit = Math.min(Math.max(opts?.limit ?? 90, 1), 365);
      const conds = [
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, HEALTH_MODULE_KEY),
        eq(businessEntities.entityType, HEALTH_ENTITY_TYPE),
      ];
      if (opts?.from) {
        conds.push(gte(businessEntities.createdAt, new Date(opts.from)));
      }
      if (opts?.to) {
        conds.push(lte(businessEntities.createdAt, new Date(opts.to)));
      }
      const rows = await db
        .select()
        .from(businessEntities)
        .where(and(...conds))
        .orderBy(desc(businessEntities.createdAt))
        .limit(limit);
      return rows
        .map((r) => (r.data ?? null) as BusinessHealthScore | null)
        .filter((s): s is BusinessHealthScore => s !== null);
    },

    async comparePeriods(companyId, period1, period2) {
      const p1 = await computeForRange(
        companyId,
        new Date(period1[0]),
        new Date(period1[1]),
        null,
      );
      const p2 = await computeForRange(
        companyId,
        new Date(period2[0]),
        new Date(period2[1]),
        null,
      );
      const perSubscore: Record<string, number> = {};
      for (const s1 of p1.subscores) {
        const s2 = p2.subscores.find((s) => s.key === s1.key);
        if (s2) {
          perSubscore[s1.key] = Math.round((s2.score - s1.score) * 10) / 10;
        }
      }
      return {
        p1,
        p2,
        diff: {
          overall: Math.round((p2.overall - p1.overall) * 10) / 10,
          perSubscore,
        },
      };
    },

    async computeAndStore(companyId, opts) {
      const score = await service.computeScore(companyId, opts);
      const now = opts?.now ?? new Date();
      const dateCode = toISODate(now);

      // Idempotent per date — delete any existing row for this company/date.
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(now);
      dayEnd.setUTCHours(23, 59, 59, 999);
      await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, HEALTH_MODULE_KEY),
            eq(businessEntities.entityType, HEALTH_ENTITY_TYPE),
            eq(businessEntities.code, dateCode),
          ),
        );

      await db.insert(businessEntities).values({
        companyId,
        moduleKey: HEALTH_MODULE_KEY,
        entityType: HEALTH_ENTITY_TYPE,
        name: `Health Score ${dateCode}`,
        code: dateCode,
        status: "computed",
        ownerUserId: opts?.actorId ?? null,
        amountCents: Math.round(score.overall * 100),
        data: score as unknown as Record<string, unknown>,
        tags: ["health", score.status],
        createdByUserId: opts?.actorId ?? null,
        updatedByUserId: opts?.actorId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return score;
    },

    getSubscoreDefinitions() {
      return SUBSCORE_DEFINITIONS.map((d) => ({
        key: d.key,
        name: d.name,
        nameAr: d.nameAr,
        category: d.category,
        weight: d.weight,
      }));
    },
  };

  return service;
}
