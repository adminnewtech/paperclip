import { api } from "./client";

export type SimulationScenarioKey =
  | "price_change"
  | "marketing_spend"
  | "hire_employees"
  | "new_product_launch"
  | "discount_strategy"
  | "expansion_to_region"
  | "cost_reduction"
  | "supplier_change"
  | "open_new_branch"
  | "custom";

export interface ScenarioParameterSpec {
  key: string;
  type: "number" | "percent" | "string" | "boolean";
  label: string;
  labelAr: string;
  default?: unknown;
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
  descriptionAr?: string;
}

export interface SimulationScenarioTemplate {
  key: SimulationScenarioKey;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  emoji: string;
  parametersSchema: ScenarioParameterSpec[];
  exampleQuestion: string;
  exampleQuestionAr: string;
  defaultInsights: Array<{
    type: "positive" | "negative" | "neutral";
    title: string;
    titleAr: string;
    description: string;
    descriptionAr: string;
  }>;
}

export interface MonthlyProjection {
  month: string;
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

export interface SimulationRunInput {
  scenarioKey: SimulationScenarioKey;
  parameters: Record<string, unknown>;
  horizonMonths: number;
  startDate?: string;
}

export const businessSimulationApi = {
  templates: (companyId: string) =>
    api.get<{ templates: SimulationScenarioTemplate[] }>(
      `/companies/${companyId}/business/simulation/templates`,
    ),
  run: (companyId: string, input: SimulationRunInput) =>
    api.post<SimulationResult>(
      `/companies/${companyId}/business/simulation/run`,
      input,
    ),
  list: (companyId: string, opts?: { limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<{ results: SimulationResult[] }>(
      `/companies/${companyId}/business/simulation/results${qs ? `?${qs}` : ""}`,
    );
  },
  get: (companyId: string, id: string) =>
    api.get<SimulationResult>(
      `/companies/${companyId}/business/simulation/results/${id}`,
    ),
  remove: (companyId: string, id: string) =>
    api.delete<void>(
      `/companies/${companyId}/business/simulation/results/${id}`,
    ),
};
