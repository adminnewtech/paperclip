import { api } from "./client";

export type HealthGrade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
export type HealthStatus =
  | "excellent"
  | "good"
  | "fair"
  | "concerning"
  | "critical";
export type HealthTrend = "rising" | "stable" | "falling";

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
  score: number;
  weight: number;
  status: HealthStatus;
  value?: number;
  unit?: string;
  description: string;
  descriptionAr: string;
  benchmark?: { good: number; warning: number; critical: number };
}

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

export interface SubScoreDefinition {
  key: string;
  name: string;
  nameAr: string;
  category: string;
  weight: number;
}

export const businessHealthApi = {
  compute: (companyId: string, store = true) =>
    api.post<BusinessHealthScore>(
      `/companies/${companyId}/business/health/compute`,
      { store },
    ),
  latest: (companyId: string) =>
    api.get<BusinessHealthScore>(
      `/companies/${companyId}/business/health/latest`,
    ),
  history: (
    companyId: string,
    opts?: { from?: string; to?: string; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<{ history: BusinessHealthScore[] }>(
      `/companies/${companyId}/business/health/history${qs ? `?${qs}` : ""}`,
    );
  },
  subscoreDefinitions: (companyId: string) =>
    api.get<{ definitions: SubScoreDefinition[] }>(
      `/companies/${companyId}/business/health/subscores`,
    ),
  compare: (
    companyId: string,
    period1: [string, string],
    period2: [string, string],
  ) =>
    api.post<{
      p1: BusinessHealthScore;
      p2: BusinessHealthScore;
      diff: { overall: number; perSubscore: Record<string, number> };
    }>(`/companies/${companyId}/business/health/compare`, { period1, period2 }),
};
