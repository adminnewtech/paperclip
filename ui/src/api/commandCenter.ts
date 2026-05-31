import { api } from "./client";

export type InsightSeverity = "info" | "warning" | "critical";
export type InsightKind =
  | "reorder"
  | "cashflow"
  | "deal_forecast"
  | "churn_risk"
  | "sla_breach"
  | "overdue_invoice";

export interface BriefingMetrics {
  revenueMinor: number;
  openDeals: number;
  weightedPipelineMinor: number;
  lowStockCount: number;
  overdueCount: number;
  openTickets: number;
  cashNetMinor: number;
}

export interface Insight {
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
  data: Record<string, unknown>;
}

export interface InsightRow {
  id: string;
  companyId: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string | null;
  detail: string | null;
  data: Record<string, unknown>;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BriefingRow {
  id: string;
  companyId: string;
  generatedAt: string;
  period: string | null;
  summary: string | null;
  metrics: BriefingMetrics;
  alerts: Insight[];
  insights: Insight[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerateBriefingResult {
  briefing: BriefingRow;
  insights: InsightRow[];
}

export interface CommandCenterMetrics {
  metrics: BriefingMetrics;
  insights: Insight[];
  summary: string;
}

export const commandCenterApi = {
  generateBriefing: (companyId: string) =>
    api.post<GenerateBriefingResult>(
      `/companies/${companyId}/command-center/briefing/generate`,
      {},
    ),
  latestBriefing: (companyId: string) =>
    api.get<{ briefing: BriefingRow | null }>(
      `/companies/${companyId}/command-center/briefing`,
    ),
  listInsights: (companyId: string) =>
    api.get<{ insights: InsightRow[] }>(
      `/companies/${companyId}/command-center/insights`,
    ),
  metrics: (companyId: string) =>
    api.get<CommandCenterMetrics>(
      `/companies/${companyId}/command-center/metrics`,
    ),
};
