// ---------------------------------------------------------------------------
// Business Health Subscore Definitions
//
// Each subscore is a pure function that maps domain data to a 0-100 score with
// an English/Arabic description. Subscores are weighted and aggregated by the
// main health service to produce the overall (0-100) Business Health Score.
//
// All scorers are deterministic and tolerate sparse/missing data — when there
// is not enough signal, the scorer returns a "fair" baseline (e.g. 50) and
// describes the lack of data, rather than throwing.
// ---------------------------------------------------------------------------

export type SubScoreStatus =
  | "excellent"
  | "good"
  | "fair"
  | "concerning"
  | "critical";

export type SubScoreCategory =
  | "financial"
  | "operational"
  | "customer"
  | "growth"
  | "team";

export interface SubScore {
  key: string;
  name: string;
  nameAr: string;
  category: SubScoreCategory;
  score: number; // 0-100
  weight: number; // contribution to overall (sum of weights ≈ 1)
  status: SubScoreStatus;
  value?: number;
  unit?: string;
  description: string;
  descriptionAr: string;
  benchmark?: { good: number; warning: number; critical: number };
}

export interface ScorerInvoice {
  id: string;
  status: string;
  amountCents: number;
  createdAt: Date;
  dueDate?: Date | null;
  customerKey: string;
}

export interface ScorerExpense {
  id: string;
  category: string;
  vendor: string;
  amountCents: number;
  createdAt: Date;
}

export interface ScorerContact {
  id: string;
  name: string | null;
  createdAt: Date;
}

export interface ScorerDeal {
  id: string;
  status: string;
  amountCents: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date | null;
}

export interface ScorerTicket {
  id: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  firstResponseAt?: Date | null;
  slaMinutes?: number | null;
}

export interface ScorerEmployee {
  id: string;
  monthlySalaryCents: number;
}

export interface ScorerInput {
  invoices: ScorerInvoice[];
  expenses: ScorerExpense[];
  contacts: ScorerContact[];
  deals: ScorerDeal[];
  tickets: ScorerTicket[];
  employees: ScorerEmployee[];
  // Optional aggregated facts
  bankBalanceCents?: number;
  monthlyRevenueTargetCents?: number;
  period: { from: string; to: string };
  // Prior period totals — used for growth scoring
  priorRevenueCents?: number;
  priorExpenseCents?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function statusForScore(score: number): SubScoreStatus {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  if (score >= 30) return "concerning";
  return "critical";
}

/** Linear interpolation between two control points: at v=good → 100, at v=critical → 0 */
function linearScore(value: number, good: number, critical: number): number {
  if (good === critical) return 50;
  const ascending = good > critical;
  if (ascending) {
    if (value >= good) return 100;
    if (value <= critical) return 0;
    return ((value - critical) / (good - critical)) * 100;
  } else {
    // good < critical, smaller is better
    if (value <= good) return 100;
    if (value >= critical) return 0;
    return ((critical - value) / (critical - good)) * 100;
  }
}

function round(n: number, digits = 1): number {
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

function monthsBetween(a: Date, b: Date): number {
  return daysBetween(a, b) / 30;
}

// ---------------------------------------------------------------------------
// Individual scorers
// ---------------------------------------------------------------------------

function scoreCashRunway(input: ScorerInput): SubScore {
  const cash = input.bankBalanceCents ?? 0;
  const monthlyBurn = input.expenses.reduce((s, e) => s + e.amountCents, 0);
  const months = monthlyBurn > 0 ? cash / monthlyBurn : cash > 0 ? 24 : 0;
  const score = clamp(linearScore(months, 12, 2));
  return {
    key: "cash_runway",
    name: "Cash Runway",
    nameAr: "احتياطي السيولة",
    category: "financial",
    weight: 0.15,
    score: round(score),
    status: statusForScore(score),
    value: round(months, 1),
    unit: "months",
    description:
      cash <= 0 && monthlyBurn === 0
        ? "No cash balance or expense data available."
        : `Current cash covers approximately ${round(months, 1)} months of expenses.`,
    descriptionAr:
      cash <= 0 && monthlyBurn === 0
        ? "لا توجد بيانات للنقد أو المصروفات."
        : `النقد الحالي يغطي حوالي ${round(months, 1)} شهر من المصروفات.`,
    benchmark: { good: 12, warning: 6, critical: 2 },
  };
}

function scoreRevenueGrowth(input: ScorerInput): SubScore {
  const revenue = input.invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amountCents, 0);
  const prior = input.priorRevenueCents ?? 0;
  const growth = prior > 0 ? ((revenue - prior) / prior) * 100 : 0;
  const score = clamp(linearScore(growth, 20, -10));
  return {
    key: "revenue_growth",
    name: "Revenue Growth",
    nameAr: "نمو الإيرادات",
    category: "growth",
    weight: 0.12,
    score: round(score),
    status: statusForScore(score),
    value: round(growth, 1),
    unit: "%",
    description:
      prior === 0
        ? `Revenue this period: ${fmtMoney(revenue)} (no prior comparison).`
        : `Revenue is ${growth >= 0 ? "up" : "down"} ${round(Math.abs(growth), 1)}% vs prior period.`,
    descriptionAr:
      prior === 0
        ? `إيرادات الفترة: ${fmtMoney(revenue)} (لا توجد مقارنة سابقة).`
        : `الإيرادات ${growth >= 0 ? "ارتفعت" : "انخفضت"} بنسبة ${round(Math.abs(growth), 1)}% مقارنة بالفترة السابقة.`,
    benchmark: { good: 20, warning: 5, critical: -10 },
  };
}

function scoreGrossMargin(input: ScorerInput): SubScore {
  const revenue = input.invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amountCents, 0);
  const cogs = input.expenses
    .filter((e) => /cogs|cost of (goods|sales)|inventory/i.test(e.category))
    .reduce((s, e) => s + e.amountCents, 0);
  const effectiveCogs = cogs > 0 ? cogs : revenue * 0.5;
  const margin = revenue > 0 ? ((revenue - effectiveCogs) / revenue) * 100 : 0;
  const score = clamp(linearScore(margin, 50, 10));
  return {
    key: "gross_margin",
    name: "Gross Margin",
    nameAr: "هامش الربح الإجمالي",
    category: "financial",
    weight: 0.12,
    score: round(score),
    status: statusForScore(score),
    value: round(margin, 1),
    unit: "%",
    description:
      revenue === 0
        ? "No revenue recorded in the period."
        : `Gross margin is ${round(margin, 1)}% of revenue.`,
    descriptionAr:
      revenue === 0
        ? "لا توجد إيرادات مسجلة في الفترة."
        : `هامش الربح الإجمالي ${round(margin, 1)}% من الإيرادات.`,
    benchmark: { good: 50, warning: 25, critical: 10 },
  };
}

function scoreArAging(input: ScorerInput): SubScore {
  const now = new Date(input.period.to);
  const outstanding = input.invoices.filter(
    (i) => i.status === "sent" || i.status === "overdue",
  );
  const total = outstanding.reduce((s, i) => s + i.amountCents, 0);
  const over60 = outstanding
    .filter((i) => {
      const due = i.dueDate ?? i.createdAt;
      return daysBetween(due, now) > 60;
    })
    .reduce((s, i) => s + i.amountCents, 0);
  const pct = total > 0 ? (over60 / total) * 100 : 0;
  // smaller is better
  const score = clamp(linearScore(pct, 5, 30));
  return {
    key: "ar_aging",
    name: "AR Aging",
    nameAr: "تقادم المستحقات",
    category: "financial",
    weight: 0.08,
    score: round(score),
    status: statusForScore(score),
    value: round(pct, 1),
    unit: "%",
    description:
      total === 0
        ? "No outstanding receivables — clean books."
        : `${round(pct, 1)}% of AR (${fmtMoney(over60)}) is more than 60 days old.`,
    descriptionAr:
      total === 0
        ? "لا توجد مستحقات معلقة — سجلات نظيفة."
        : `${round(pct, 1)}% من المستحقات (${fmtMoney(over60)}) متأخرة أكثر من 60 يوماً.`,
    benchmark: { good: 5, warning: 15, critical: 30 },
  };
}

function scoreCustomerConcentration(input: ScorerInput): SubScore {
  const byCustomer = new Map<string, number>();
  for (const inv of input.invoices) {
    if (inv.status !== "paid" || !inv.customerKey || inv.customerKey === "Unknown")
      continue;
    byCustomer.set(
      inv.customerKey,
      (byCustomer.get(inv.customerKey) ?? 0) + inv.amountCents,
    );
  }
  const total = [...byCustomer.values()].reduce((s, v) => s + v, 0);
  const topCustomerRevenue = [...byCustomer.values()].reduce(
    (m, v) => Math.max(m, v),
    0,
  );
  const pct = total > 0 ? (topCustomerRevenue / total) * 100 : 0;
  // smaller is better
  const score = clamp(linearScore(pct, 15, 50));
  return {
    key: "customer_concentration",
    name: "Customer Concentration",
    nameAr: "تركز العملاء",
    category: "customer",
    weight: 0.07,
    score: round(score),
    status: statusForScore(score),
    value: round(pct, 1),
    unit: "%",
    description:
      total === 0
        ? "No customer revenue data."
        : `Largest customer accounts for ${round(pct, 1)}% of revenue.`,
    descriptionAr:
      total === 0
        ? "لا توجد بيانات إيرادات للعملاء."
        : `أكبر عميل يمثل ${round(pct, 1)}% من الإيرادات.`,
    benchmark: { good: 15, warning: 30, critical: 50 },
  };
}

function scoreDealVelocity(input: ScorerInput): SubScore {
  const closed = input.deals.filter((d) => d.status === "won" && d.closedAt);
  let avg = 0;
  if (closed.length > 0) {
    const total = closed.reduce(
      (s, d) => s + daysBetween(d.createdAt, d.closedAt as Date),
      0,
    );
    avg = total / closed.length;
  } else {
    // fallback: use updatedAt - createdAt for open won deals
    const wins = input.deals.filter((d) => d.status === "won");
    if (wins.length > 0) {
      avg =
        wins.reduce((s, d) => s + daysBetween(d.createdAt, d.updatedAt), 0) /
        wins.length;
    } else {
      avg = 60; // neutral fallback
    }
  }
  const score = clamp(linearScore(avg, 30, 90));
  return {
    key: "deal_velocity",
    name: "Deal Velocity",
    nameAr: "سرعة إغلاق الصفقات",
    category: "growth",
    weight: 0.06,
    score: round(score),
    status: statusForScore(score),
    value: round(avg, 1),
    unit: "days",
    description: `Average days to close a deal: ${round(avg, 1)}.`,
    descriptionAr: `متوسط أيام إغلاق الصفقة: ${round(avg, 1)}.`,
    benchmark: { good: 30, warning: 60, critical: 90 },
  };
}

function scoreTicketResponseTime(input: ScorerInput): SubScore {
  const responded = input.tickets.filter((t) => t.firstResponseAt);
  let avgHours = 0;
  if (responded.length > 0) {
    const total = responded.reduce(
      (s, t) =>
        s + (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 3600000,
      0,
    );
    avgHours = total / responded.length;
  } else if (input.tickets.length === 0) {
    avgHours = 4; // neutral fallback when no helpdesk data
  } else {
    // No first-response timestamps — estimate from resolution time / 4
    const resolved = input.tickets.filter((t) => t.resolvedAt);
    if (resolved.length > 0) {
      const total = resolved.reduce(
        (s, t) =>
          s + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3600000,
        0,
      );
      avgHours = total / resolved.length / 4;
    } else {
      avgHours = 12;
    }
  }
  // smaller is better
  const score = clamp(linearScore(avgHours, 2, 24));
  return {
    key: "ticket_response_time",
    name: "Ticket Response Time",
    nameAr: "زمن الاستجابة للتذاكر",
    category: "customer",
    weight: 0.05,
    score: round(score),
    status: statusForScore(score),
    value: round(avgHours, 1),
    unit: "hours",
    description:
      input.tickets.length === 0
        ? "No support tickets in the period."
        : `Average first response: ${round(avgHours, 1)} hours.`,
    descriptionAr:
      input.tickets.length === 0
        ? "لا توجد تذاكر دعم في الفترة."
        : `متوسط أول استجابة: ${round(avgHours, 1)} ساعة.`,
    benchmark: { good: 2, warning: 8, critical: 24 },
  };
}

function scoreTicketResolutionRate(input: ScorerInput): SubScore {
  if (input.tickets.length === 0) {
    return {
      key: "ticket_resolution_rate",
      name: "Ticket Resolution Rate",
      nameAr: "نسبة حل التذاكر",
      category: "customer",
      weight: 0.05,
      score: 80,
      status: "good",
      value: 0,
      unit: "%",
      description: "No tickets in period — using neutral baseline.",
      descriptionAr: "لا توجد تذاكر — تم استخدام معدل افتراضي.",
      benchmark: { good: 95, warning: 80, critical: 70 },
    };
  }
  const resolved = input.tickets.filter(
    (t) => t.status === "resolved" || t.status === "closed" || t.resolvedAt,
  ).length;
  const pct = (resolved / input.tickets.length) * 100;
  const score = clamp(linearScore(pct, 95, 70));
  return {
    key: "ticket_resolution_rate",
    name: "Ticket Resolution Rate",
    nameAr: "نسبة حل التذاكر",
    category: "customer",
    weight: 0.05,
    score: round(score),
    status: statusForScore(score),
    value: round(pct, 1),
    unit: "%",
    description: `${resolved} of ${input.tickets.length} tickets resolved (${round(pct, 1)}%).`,
    descriptionAr: `تم حل ${resolved} من أصل ${input.tickets.length} تذكرة (${round(pct, 1)}%).`,
    benchmark: { good: 95, warning: 80, critical: 70 },
  };
}

function scoreInventoryTurnover(input: ScorerInput): SubScore {
  // Proxy: ratio of revenue to (employee count * 5000) — when no real inventory data
  const revenue = input.invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amountCents, 0);
  const periodMonths = Math.max(
    1,
    monthsBetween(new Date(input.period.from), new Date(input.period.to)),
  );
  const annualRevenue = (revenue / periodMonths) * 12;
  // Use a soft proxy: assume inventory ~= 15% of annual revenue → turnover = revenue / inventory
  const proxyInventory = Math.max(annualRevenue * 0.15, 100_000);
  const turnover = annualRevenue / proxyInventory;
  const score = clamp(linearScore(turnover, 12, 3));
  return {
    key: "inventory_turnover",
    name: "Inventory Turnover",
    nameAr: "دوران المخزون",
    category: "operational",
    weight: 0.05,
    score: round(score),
    status: statusForScore(score),
    value: round(turnover, 1),
    unit: "x/year",
    description: `Estimated ${round(turnover, 1)}× annual inventory turns (proxy).`,
    descriptionAr: `تقدير ${round(turnover, 1)}× دوران مخزون سنوي (تقريبي).`,
    benchmark: { good: 12, warning: 6, critical: 3 },
  };
}

function scoreEmployeeProductivity(input: ScorerInput): SubScore {
  const employeeCount = Math.max(1, input.employees.length);
  const revenue = input.invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amountCents, 0);
  const periodMonths = Math.max(
    1,
    monthsBetween(new Date(input.period.from), new Date(input.period.to)),
  );
  const annualRevPerEmp = ((revenue / periodMonths) * 12) / employeeCount;
  // benchmark: 200,000 (in major currency units, i.e. 20,000,000 cents) is "good"
  const value = annualRevPerEmp / 100; // major units
  const score = clamp(linearScore(value, 200_000, 50_000));
  return {
    key: "employee_productivity",
    name: "Employee Productivity",
    nameAr: "إنتاجية الموظفين",
    category: "team",
    weight: 0.06,
    score: round(score),
    status: statusForScore(score),
    value: round(value, 0),
    unit: "rev/employee/yr",
    description: `Approx ${fmtMoney(annualRevPerEmp)} annual revenue per employee (${employeeCount} staff).`,
    descriptionAr: `حوالي ${fmtMoney(annualRevPerEmp)} إيراد سنوي لكل موظف (${employeeCount} موظف).`,
    benchmark: { good: 200_000, warning: 100_000, critical: 50_000 },
  };
}

function scorePipelineCoverage(input: ScorerInput): SubScore {
  const pipeline = input.deals
    .filter((d) =>
      ["prospecting", "qualified", "proposal", "negotiation"].includes(d.status),
    )
    .reduce((s, d) => s + d.amountCents, 0);
  const target = input.monthlyRevenueTargetCents ?? 0;
  let coverage = 0;
  if (target > 0) {
    coverage = pipeline / target;
  } else {
    // fallback: compare to last-period revenue per month
    const revenue = input.invoices
      .filter((i) => i.status === "paid")
      .reduce((s, i) => s + i.amountCents, 0);
    const periodMonths = Math.max(
      1,
      monthsBetween(new Date(input.period.from), new Date(input.period.to)),
    );
    const monthlyRev = revenue / periodMonths;
    coverage = monthlyRev > 0 ? pipeline / monthlyRev : 0;
  }
  const score = clamp(linearScore(coverage, 3, 1));
  return {
    key: "pipeline_coverage",
    name: "Pipeline Coverage",
    nameAr: "تغطية صفقات البيع",
    category: "growth",
    weight: 0.07,
    score: round(score),
    status: statusForScore(score),
    value: round(coverage, 2),
    unit: "x target",
    description: `Open pipeline covers ${round(coverage, 2)}× monthly revenue baseline.`,
    descriptionAr: `الصفقات المفتوحة تغطي ${round(coverage, 2)}× من الإيرادات الشهرية.`,
    benchmark: { good: 3, warning: 2, critical: 1 },
  };
}

function scoreExpenseRatio(input: ScorerInput): SubScore {
  const revenue = input.invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amountCents, 0);
  const expenses = input.expenses.reduce((s, e) => s + e.amountCents, 0);
  let ratio = 0;
  if (revenue > 0) {
    ratio = (expenses / revenue) * 100;
  } else if (expenses > 0) {
    ratio = 200;
  }
  // smaller is better
  const score = clamp(linearScore(ratio, 60, 100));
  return {
    key: "expense_ratio",
    name: "Expense Ratio",
    nameAr: "نسبة المصروفات",
    category: "financial",
    weight: 0.12,
    score: round(score),
    status: statusForScore(score),
    value: round(ratio, 1),
    unit: "% of revenue",
    description:
      revenue === 0
        ? "No revenue recorded — cannot calculate ratio."
        : `Operating expenses are ${round(ratio, 1)}% of revenue.`,
    descriptionAr:
      revenue === 0
        ? "لا توجد إيرادات مسجلة — لا يمكن حساب النسبة."
        : `المصروفات التشغيلية ${round(ratio, 1)}% من الإيرادات.`,
    benchmark: { good: 60, warning: 80, critical: 100 },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface SubScoreDefinition {
  key: string;
  name: string;
  nameAr: string;
  category: SubScoreCategory;
  weight: number;
  compute: (input: ScorerInput) => SubScore;
}

export const SUBSCORE_DEFINITIONS: SubScoreDefinition[] = [
  {
    key: "cash_runway",
    name: "Cash Runway",
    nameAr: "احتياطي السيولة",
    category: "financial",
    weight: 0.15,
    compute: scoreCashRunway,
  },
  {
    key: "revenue_growth",
    name: "Revenue Growth",
    nameAr: "نمو الإيرادات",
    category: "growth",
    weight: 0.12,
    compute: scoreRevenueGrowth,
  },
  {
    key: "gross_margin",
    name: "Gross Margin",
    nameAr: "هامش الربح الإجمالي",
    category: "financial",
    weight: 0.12,
    compute: scoreGrossMargin,
  },
  {
    key: "ar_aging",
    name: "AR Aging",
    nameAr: "تقادم المستحقات",
    category: "financial",
    weight: 0.08,
    compute: scoreArAging,
  },
  {
    key: "customer_concentration",
    name: "Customer Concentration",
    nameAr: "تركز العملاء",
    category: "customer",
    weight: 0.07,
    compute: scoreCustomerConcentration,
  },
  {
    key: "deal_velocity",
    name: "Deal Velocity",
    nameAr: "سرعة إغلاق الصفقات",
    category: "growth",
    weight: 0.06,
    compute: scoreDealVelocity,
  },
  {
    key: "ticket_response_time",
    name: "Ticket Response Time",
    nameAr: "زمن الاستجابة للتذاكر",
    category: "customer",
    weight: 0.05,
    compute: scoreTicketResponseTime,
  },
  {
    key: "ticket_resolution_rate",
    name: "Ticket Resolution Rate",
    nameAr: "نسبة حل التذاكر",
    category: "customer",
    weight: 0.05,
    compute: scoreTicketResolutionRate,
  },
  {
    key: "inventory_turnover",
    name: "Inventory Turnover",
    nameAr: "دوران المخزون",
    category: "operational",
    weight: 0.05,
    compute: scoreInventoryTurnover,
  },
  {
    key: "employee_productivity",
    name: "Employee Productivity",
    nameAr: "إنتاجية الموظفين",
    category: "team",
    weight: 0.06,
    compute: scoreEmployeeProductivity,
  },
  {
    key: "pipeline_coverage",
    name: "Pipeline Coverage",
    nameAr: "تغطية صفقات البيع",
    category: "growth",
    weight: 0.07,
    compute: scorePipelineCoverage,
  },
  {
    key: "expense_ratio",
    name: "Expense Ratio",
    nameAr: "نسبة المصروفات",
    category: "financial",
    weight: 0.12,
    compute: scoreExpenseRatio,
  },
];

export function computeAllSubscores(input: ScorerInput): SubScore[] {
  return SUBSCORE_DEFINITIONS.map((d) => {
    const sub = d.compute(input);
    return { ...sub, weight: d.weight, category: d.category };
  });
}
