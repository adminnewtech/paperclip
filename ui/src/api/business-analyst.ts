import { api } from "./client";

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

export interface StoredInsightReport {
  id: string;
  companyId: string;
  report: InsightReport;
  createdAt: string;
  updatedAt: string;
}

export interface InsightReportSummary {
  id: string;
  generatedAt: string;
  periodFrom: string;
  periodTo: string;
  kpiSnapshot: InsightKpiSnapshot;
  anomalyCount: number;
  opportunityCount: number;
}

export interface ListInsightReportsResponse {
  reports: InsightReportSummary[];
  total: number;
}

export const businessAnalystApi = {
  run: (companyId: string, body?: { from?: string; to?: string }) =>
    api.post<StoredInsightReport>(
      `/companies/${companyId}/business/analyst/run`,
      body ?? {},
    ),

  list: (companyId: string, opts?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return api.get<ListInsightReportsResponse>(
      `/companies/${companyId}/business/analyst/reports${qs ? `?${qs}` : ""}`,
    );
  },

  latest: (companyId: string) =>
    api.get<StoredInsightReport>(
      `/companies/${companyId}/business/analyst/latest`,
    ),

  get: (companyId: string, reportId: string) =>
    api.get<StoredInsightReport>(
      `/companies/${companyId}/business/analyst/reports/${reportId}`,
    ),

  remove: (companyId: string, reportId: string) =>
    api.delete<void>(
      `/companies/${companyId}/business/analyst/reports/${reportId}`,
    ),
};
