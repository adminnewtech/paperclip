import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  SCENARIO_TEMPLATES,
  getScenarioTemplate,
  type SimulationScenarioKey,
  type SimulationScenarioTemplate,
} from "./scenarios.js";

export type { SimulationScenarioKey, SimulationScenarioTemplate };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SimulationInput {
  scenarioKey: SimulationScenarioKey;
  parameters: Record<string, unknown>;
  horizonMonths: number;
  startDate?: string;
}

export interface MonthlyProjection {
  month: string; // YYYY-MM
  revenue: number;
  expenses: number;
  profit: number;
  cashBalance: number;
  customerCount: number;
  employeeCount: number;
  custom?: Record<string, unknown>;
}

export interface ProjectionSummary {
  totalRevenue: number;
  totalExpenses: number;
  totalProfit: number;
  endingCashBalance: number;
  averageMonthlyGrowth: number;
}

export interface SimulationInsight {
  type: "positive" | "negative" | "neutral";
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  metricImpact?: {
    metric: string;
    before: number;
    after: number;
    deltaPercent: number;
  };
}

export interface SimulationResult {
  id: string;
  companyId: string;
  scenarioKey: SimulationScenarioKey;
  parameters: Record<string, unknown>;
  horizonMonths: number;
  startDate: string;
  baseline: { projections: MonthlyProjection[]; summary: ProjectionSummary };
  scenario: { projections: MonthlyProjection[]; summary: ProjectionSummary };
  delta: ProjectionSummary;
  insights: SimulationInsight[];
  confidence: "low" | "medium" | "high";
  computedAt: string;
}

export interface BusinessSimulationService {
  simulate(companyId: string, input: SimulationInput): Promise<SimulationResult>;
  listResults(
    companyId: string,
    opts?: { limit?: number },
  ): Promise<SimulationResult[]>;
  getResult(companyId: string, id: string): Promise<SimulationResult | null>;
  deleteResult(companyId: string, id: string): Promise<void>;
  getScenarioTemplates(): SimulationScenarioTemplate[];
}

const SIMULATION_MODULE_KEY = "simulation";
const SIMULATION_ENTITY_TYPE = "result";

// ---------------------------------------------------------------------------
// Baseline computation
// ---------------------------------------------------------------------------

interface HistoricalSnapshot {
  monthlyRevenue: number[];
  monthlyExpenses: number[];
  monthlyCustomers: number[];
  employeeCount: number;
  startingCashCents: number;
}

function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addMonths(d: Date, n: number): Date {
  const next = new Date(d);
  next.setUTCMonth(next.getUTCMonth() + n);
  return next;
}

/** Linear regression slope (cents/month) and intercept on the supplied series. */
function linregress(values: number[]): { slope: number; intercept: number } {
  if (values.length === 0) return { slope: 0, intercept: 0 };
  if (values.length === 1) return { slope: 0, intercept: values[0]! };
  const n = values.length;
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += values[i]!;
    sxy += i * values[i]!;
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function projectSeries(
  history: number[],
  horizonMonths: number,
  minimum = 0,
): number[] {
  const { slope, intercept } = linregress(history);
  const startIndex = history.length;
  const out: number[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    const v = intercept + slope * (startIndex + i);
    out.push(Math.max(minimum, Math.round(v)));
  }
  return out;
}

async function gatherHistorical(
  db: Db,
  companyId: string,
  monthsBack: number,
): Promise<HistoricalSnapshot> {
  const now = new Date();
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - monthsBack);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  // Invoices, expenses across the window
  const [invoiceRows, expenseRows, customerRows, employeeRows] =
    await Promise.all([
      db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "sales"),
            eq(businessEntities.entityType, "invoice"),
          ),
        ),
      db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
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
            eq(businessEntities.moduleKey, "sales"),
            eq(businessEntities.entityType, "customer"),
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
    ]);

  const months: string[] = [];
  for (let i = 0; i < monthsBack; i++) {
    months.push(monthKey(addMonths(start, i)));
  }

  function bucketize(
    rows: Array<{ createdAt: Date; amountCents: number | null; status: string }>,
    paidOnly = false,
  ): number[] {
    const buckets = new Map<string, number>();
    for (const r of rows) {
      if (paidOnly && r.status !== "paid") continue;
      const key = monthKey(r.createdAt);
      buckets.set(key, (buckets.get(key) ?? 0) + (r.amountCents ?? 0));
    }
    return months.map((m) => buckets.get(m) ?? 0);
  }

  const monthlyRevenue = bucketize(invoiceRows, true);
  const monthlyExpenses = bucketize(expenseRows, false);

  // Active customers per month — approximate by customers created up to month end
  const customers = customerRows.map((r) => r.createdAt);
  const monthlyCustomers = months.map((m) => {
    const [y, mm] = m.split("-").map((s) => Number(s));
    const endOfMonth = new Date(Date.UTC(y!, mm!, 0, 23, 59, 59));
    return customers.filter((d) => d <= endOfMonth).length;
  });

  const startingCashCents = Math.max(
    0,
    monthlyRevenue.reduce((s, v) => s + v, 0) -
      monthlyExpenses.reduce((s, v) => s + v, 0),
  );

  return {
    monthlyRevenue,
    monthlyExpenses,
    monthlyCustomers,
    employeeCount: employeeRows.length,
    startingCashCents,
  };
}

function buildBaseline(
  snap: HistoricalSnapshot,
  horizonMonths: number,
  startDate: Date,
): MonthlyProjection[] {
  const revSeries = projectSeries(snap.monthlyRevenue, horizonMonths, 0);
  const expSeries = projectSeries(snap.monthlyExpenses, horizonMonths, 0);
  const customerSeries = projectSeries(snap.monthlyCustomers, horizonMonths, 0);

  let cash = snap.startingCashCents;
  const out: MonthlyProjection[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    const revenue = revSeries[i] ?? 0;
    const expenses = expSeries[i] ?? 0;
    const profit = revenue - expenses;
    cash += profit;
    out.push({
      month: monthKey(addMonths(startDate, i)),
      revenue,
      expenses,
      profit,
      cashBalance: cash,
      customerCount: customerSeries[i] ?? 0,
      employeeCount: snap.employeeCount,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scenario application
// ---------------------------------------------------------------------------

function getNum(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = params[key];
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return fallback;
}

function applyScenario(
  scenarioKey: SimulationScenarioKey,
  params: Record<string, unknown>,
  baseline: MonthlyProjection[],
  startingCash: number,
): MonthlyProjection[] {
  const out: MonthlyProjection[] = [];
  let cash = startingCash;

  for (let i = 0; i < baseline.length; i++) {
    const base = baseline[i]!;
    let revenue = base.revenue;
    let expenses = base.expenses;
    let customerCount = base.customerCount;
    let employeeCount = base.employeeCount;

    switch (scenarioKey) {
      case "price_change": {
        const pricePct = getNum(params, "pricePercent", 10) / 100;
        const elasticity = getNum(params, "elasticity", -1.5);
        const volumeFactor = 1 + elasticity * pricePct;
        const priceFactor = 1 + pricePct;
        revenue = Math.round(revenue * priceFactor * Math.max(0, volumeFactor));
        customerCount = Math.round(
          customerCount * Math.max(0, volumeFactor),
        );
        break;
      }
      case "marketing_spend": {
        const spendPct = getNum(params, "spendPercent", 50) / 100;
        const cac = getNum(params, "cacCents", 50_000);
        // Marketing line is approx 10% of total expenses; lift it
        const marketingBase = expenses * 0.1;
        const extraSpend = marketingBase * spendPct;
        expenses = Math.round(expenses + extraSpend);
        const newCustomers =
          cac > 0 ? Math.round(extraSpend / cac) : 0;
        // 1-month lag — revenue uplift uses prior-month new customers
        const arpu = customerCount > 0 ? revenue / customerCount : 0;
        if (i >= 1) {
          revenue = Math.round(revenue + newCustomers * arpu);
          customerCount += newCustomers;
        }
        break;
      }
      case "hire_employees": {
        const newHires = Math.max(0, Math.round(getNum(params, "newHires", 2)));
        const salary = getNum(params, "avgMonthlySalaryCents", 1_500_000);
        const rampMonths = Math.max(
          0,
          Math.round(getNum(params, "rampMonths", 3)),
        );
        expenses = Math.round(expenses + newHires * salary);
        // Productivity lift after ramp
        const productivity = customerCount > 0 ? revenue / customerCount : 0;
        // Use revenue / employee per month
        const monthlyRevPerEmp =
          employeeCount > 0
            ? revenue / employeeCount
            : productivity > 0
              ? productivity
              : 0;
        const rampFactor = i < rampMonths ? i / Math.max(1, rampMonths) : 1;
        revenue = Math.round(revenue + newHires * monthlyRevPerEmp * rampFactor);
        employeeCount += newHires;
        break;
      }
      case "new_product_launch": {
        const monthlyRevenue = getNum(params, "monthlyRevenueCents", 5_000_000);
        const monthlyCost = getNum(params, "monthlyCostCents", 2_000_000);
        const rampMonths = Math.max(
          0,
          Math.round(getNum(params, "rampMonths", 4)),
        );
        const rampFactor = i < rampMonths ? (i + 1) / (rampMonths + 1) : 1;
        revenue = Math.round(revenue + monthlyRevenue * rampFactor);
        expenses = Math.round(expenses + monthlyCost * rampFactor);
        break;
      }
      case "discount_strategy": {
        const discountPct = getNum(params, "discountPercent", 20) / 100;
        const volumeLift = getNum(params, "volumeLift", 30) / 100;
        const priceFactor = 1 - discountPct;
        const volumeFactor = 1 + volumeLift;
        revenue = Math.round(revenue * priceFactor * volumeFactor);
        customerCount = Math.round(customerCount * volumeFactor);
        break;
      }
      case "expansion_to_region": {
        const setup = getNum(params, "setupCostCents", 20_000_000);
        const opEx = getNum(params, "monthlyOpExCents", 5_000_000);
        const ramp = Math.max(
          1,
          Math.round(getNum(params, "revenueRampMonths", 6)),
        );
        const steady = getNum(params, "steadyStateRevenuePercent", 25) / 100;
        if (i === 0) expenses = Math.round(expenses + setup);
        expenses = Math.round(expenses + opEx);
        const rampFactor = i < ramp ? (i + 1) / ramp : 1;
        revenue = Math.round(revenue * (1 + steady * rampFactor));
        break;
      }
      case "cost_reduction": {
        const reduction = getNum(params, "reductionPercent", 15) / 100;
        const revImpact = getNum(params, "revenueImpactPercent", -2) / 100;
        expenses = Math.round(expenses * (1 - reduction));
        revenue = Math.round(revenue * (1 + revImpact));
        break;
      }
      case "supplier_change": {
        const cogsChange = getNum(params, "cogsChangePercent", -10) / 100;
        const quality = getNum(params, "qualityImpactPercent", 0) / 100;
        // Assume COGS ~ 40% of expenses
        const cogs = expenses * 0.4;
        expenses = Math.round(expenses - cogs + cogs * (1 + cogsChange));
        revenue = Math.round(revenue * (1 + quality));
        break;
      }
      case "open_new_branch": {
        const setup = getNum(params, "setupCostCents", 50_000_000);
        const fixed = getNum(params, "monthlyFixedCostCents", 8_000_000);
        const branchRev = getNum(params, "monthlyRevenueCents", 15_000_000);
        const ramp = Math.max(
          1,
          Math.round(getNum(params, "rampMonths", 5)),
        );
        if (i === 0) expenses = Math.round(expenses + setup);
        expenses = Math.round(expenses + fixed);
        const rampFactor = i < ramp ? (i + 1) / ramp : 1;
        revenue = Math.round(revenue + branchRev * rampFactor);
        break;
      }
      case "custom": {
        const r = getNum(params, "revenuePercent", 0) / 100;
        const e = getNum(params, "expensePercent", 0) / 100;
        const c = getNum(params, "customerPercent", 0) / 100;
        revenue = Math.round(revenue * (1 + r));
        expenses = Math.round(expenses * (1 + e));
        customerCount = Math.round(customerCount * (1 + c));
        break;
      }
    }

    const profit = revenue - expenses;
    cash += profit;
    out.push({
      month: base.month,
      revenue,
      expenses,
      profit,
      cashBalance: cash,
      customerCount,
      employeeCount,
    });
  }
  return out;
}

function summarize(projections: MonthlyProjection[]): ProjectionSummary {
  const totalRevenue = projections.reduce((s, p) => s + p.revenue, 0);
  const totalExpenses = projections.reduce((s, p) => s + p.expenses, 0);
  const totalProfit = projections.reduce((s, p) => s + p.profit, 0);
  const endingCashBalance =
    projections.length === 0
      ? 0
      : projections[projections.length - 1]!.cashBalance;
  // Average month-over-month revenue growth
  let growthSum = 0;
  let growthCount = 0;
  for (let i = 1; i < projections.length; i++) {
    const prev = projections[i - 1]!.revenue;
    const cur = projections[i]!.revenue;
    if (prev > 0) {
      growthSum += ((cur - prev) / prev) * 100;
      growthCount++;
    }
  }
  const averageMonthlyGrowth =
    growthCount > 0
      ? Math.round((growthSum / growthCount) * 100) / 100
      : 0;
  return {
    totalRevenue,
    totalExpenses,
    totalProfit,
    endingCashBalance,
    averageMonthlyGrowth,
  };
}

function buildInsights(
  scenarioKey: SimulationScenarioKey,
  baseline: ProjectionSummary,
  scenario: ProjectionSummary,
): SimulationInsight[] {
  const template = getScenarioTemplate(scenarioKey);
  const insights: SimulationInsight[] = [];

  function pushDelta(
    metric: string,
    before: number,
    after: number,
    positiveIsGood: boolean,
  ) {
    if (before === 0 && after === 0) return;
    const deltaAbs = after - before;
    const deltaPct = before === 0 ? 100 : (deltaAbs / Math.abs(before)) * 100;
    const isGood = positiveIsGood ? deltaAbs >= 0 : deltaAbs <= 0;
    insights.push({
      type:
        Math.abs(deltaPct) < 0.5
          ? "neutral"
          : isGood
            ? "positive"
            : "negative",
      title: `${metric} ${deltaAbs >= 0 ? "+" : ""}${Math.round(deltaPct * 10) / 10}%`,
      titleAr: `${metric}: ${deltaAbs >= 0 ? "+" : ""}${Math.round(deltaPct * 10) / 10}%`,
      description: `${metric} moves from ${before.toLocaleString()} to ${after.toLocaleString()} (Δ ${deltaAbs.toLocaleString()}).`,
      descriptionAr: `${metric} يتغير من ${before.toLocaleString()} إلى ${after.toLocaleString()} (الفرق ${deltaAbs.toLocaleString()}).`,
      metricImpact: {
        metric,
        before,
        after,
        deltaPercent: Math.round(deltaPct * 10) / 10,
      },
    });
  }

  pushDelta("Total Revenue", baseline.totalRevenue, scenario.totalRevenue, true);
  pushDelta(
    "Total Expenses",
    baseline.totalExpenses,
    scenario.totalExpenses,
    false,
  );
  pushDelta("Total Profit", baseline.totalProfit, scenario.totalProfit, true);
  pushDelta(
    "Ending Cash",
    baseline.endingCashBalance,
    scenario.endingCashBalance,
    true,
  );

  // Append qualitative narrative from the template
  if (template) {
    for (const i of template.defaultInsights) insights.push({ ...i });
  }

  return insights;
}

function confidenceFor(snap: HistoricalSnapshot): "low" | "medium" | "high" {
  const months = snap.monthlyRevenue.length;
  const nonZero = snap.monthlyRevenue.filter((v) => v > 0).length;
  if (nonZero >= 6 && months >= 6) return "high";
  if (nonZero >= 3) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createBusinessSimulationService(
  db: Db,
): BusinessSimulationService {
  return {
    async simulate(companyId, input) {
      const horizonMonths = Math.min(Math.max(input.horizonMonths, 1), 36);
      const startDate = input.startDate
        ? new Date(input.startDate)
        : new Date();
      const snap = await gatherHistorical(db, companyId, 6);
      const baselineProjections = buildBaseline(snap, horizonMonths, startDate);
      const scenarioProjections = applyScenario(
        input.scenarioKey,
        input.parameters,
        baselineProjections,
        snap.startingCashCents,
      );
      const baselineSummary = summarize(baselineProjections);
      const scenarioSummary = summarize(scenarioProjections);
      const delta: ProjectionSummary = {
        totalRevenue:
          scenarioSummary.totalRevenue - baselineSummary.totalRevenue,
        totalExpenses:
          scenarioSummary.totalExpenses - baselineSummary.totalExpenses,
        totalProfit:
          scenarioSummary.totalProfit - baselineSummary.totalProfit,
        endingCashBalance:
          scenarioSummary.endingCashBalance - baselineSummary.endingCashBalance,
        averageMonthlyGrowth:
          Math.round(
            (scenarioSummary.averageMonthlyGrowth -
              baselineSummary.averageMonthlyGrowth) *
              100,
          ) / 100,
      };
      const insights = buildInsights(
        input.scenarioKey,
        baselineSummary,
        scenarioSummary,
      );
      const confidence = confidenceFor(snap);

      const result: SimulationResult = {
        id: randomUUID(),
        companyId,
        scenarioKey: input.scenarioKey,
        parameters: input.parameters,
        horizonMonths,
        startDate: startDate.toISOString(),
        baseline: {
          projections: baselineProjections,
          summary: baselineSummary,
        },
        scenario: {
          projections: scenarioProjections,
          summary: scenarioSummary,
        },
        delta,
        insights,
        confidence,
        computedAt: new Date().toISOString(),
      };

      const now = new Date();
      await db.insert(businessEntities).values({
        id: result.id,
        companyId,
        moduleKey: SIMULATION_MODULE_KEY,
        entityType: SIMULATION_ENTITY_TYPE,
        name: `Simulation: ${input.scenarioKey}`,
        status: "completed",
        amountCents: delta.totalProfit,
        data: result as unknown as Record<string, unknown>,
        tags: ["simulation", input.scenarioKey],
        createdAt: now,
        updatedAt: now,
      });

      return result;
    },

    async listResults(companyId, opts) {
      const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
      const rows = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, SIMULATION_MODULE_KEY),
            eq(businessEntities.entityType, SIMULATION_ENTITY_TYPE),
          ),
        )
        .orderBy(desc(businessEntities.createdAt))
        .limit(limit);
      return rows
        .map((r) => (r.data ?? null) as SimulationResult | null)
        .filter((r): r is SimulationResult => r !== null);
    },

    async getResult(companyId, id) {
      const [row] = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.id, id),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, SIMULATION_MODULE_KEY),
            eq(businessEntities.entityType, SIMULATION_ENTITY_TYPE),
          ),
        );
      if (!row) return null;
      return (row.data ?? null) as SimulationResult | null;
    },

    async deleteResult(companyId, id) {
      await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.id, id),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, SIMULATION_MODULE_KEY),
            eq(businessEntities.entityType, SIMULATION_ENTITY_TYPE),
          ),
        );
    },

    getScenarioTemplates() {
      return SCENARIO_TEMPLATES;
    },
  };
}
