import { api } from "./client";

export type ActionOutcomeResolution =
  | "succeeded"
  | "failed"
  | "ignored"
  | "reversed"
  | "unknown";

export interface ActionFeedback {
  rating: "thumbs_up" | "thumbs_down" | null;
  comment?: string;
  givenBy?: string;
  givenAt: string;
}

export interface ActionOutcome {
  resolution: ActionOutcomeResolution;
  measuredAt: string;
  metrics?: Record<string, number>;
  notes?: string;
}

export interface AgentAction {
  id: string;
  companyId: string;
  agentSlug: string;
  capability: string;
  runId: string;
  takenAt: string;
  description: string;
  descriptionAr?: string;
  targetEntityId?: string;
  targetEntityType?: string;
  parameters: Record<string, unknown>;
  predictedOutcome?: string;
  feedback?: ActionFeedback;
  outcome?: ActionOutcome;
}

export interface AgentSkillStats {
  agentSlug: string;
  capability: string;
  actionsCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  succeededCount: number;
  failedCount: number;
  ignoredCount: number;
  accuracy: number;
  trend: "rising" | "stable" | "falling";
  lastActionAt?: string;
}

export interface AgentMemoryBias {
  agentSlug: string;
  capability: string;
  rule: "boost" | "suppress" | "neutral";
  strength: number;
  reason: string;
  derivedFromActionCount: number;
}

export interface AgentStatsResponse {
  overallAccuracy: number;
  totalActions: number;
  bySkill: AgentSkillStats[];
  monthlyAccuracy: Array<{ month: string; accuracy: number; actionCount: number }>;
  monthOverMonth: {
    currentMonth: { month: string; accuracy: number; actionCount: number } | null;
    previousMonth: { month: string; accuracy: number; actionCount: number } | null;
    delta: number;
  };
}

export interface AgentTimeseriesPoint {
  date: string;
  accuracy: number;
  actionCount: number;
}

export const businessAgentMemoryApi = {
  listActions: (
    companyId: string,
    opts?: { agentSlug?: string; capability?: string; from?: string; to?: string; limit?: number },
  ) => {
    const qs = new URLSearchParams();
    if (opts?.agentSlug) qs.set("agentSlug", opts.agentSlug);
    if (opts?.capability) qs.set("capability", opts.capability);
    if (opts?.from) qs.set("from", opts.from);
    if (opts?.to) qs.set("to", opts.to);
    if (opts?.limit) qs.set("limit", String(opts.limit));
    const suffix = qs.toString();
    return api.get<{ actions: AgentAction[] }>(
      `/companies/${companyId}/business/agent-memory/actions${suffix ? `?${suffix}` : ""}`,
    );
  },

  getAction: (companyId: string, actionId: string) =>
    api.get<AgentAction>(
      `/companies/${companyId}/business/agent-memory/actions/${actionId}`,
    ),

  giveFeedback: (
    companyId: string,
    actionId: string,
    body: { rating: "thumbs_up" | "thumbs_down" | null; comment?: string },
  ) =>
    api.post<AgentAction>(
      `/companies/${companyId}/business/agent-memory/actions/${actionId}/feedback`,
      body,
    ),

  setOutcome: (
    companyId: string,
    actionId: string,
    body: {
      resolution: ActionOutcomeResolution;
      metrics?: Record<string, number>;
      notes?: string;
    },
  ) =>
    api.post<AgentAction>(
      `/companies/${companyId}/business/agent-memory/actions/${actionId}/outcome`,
      body,
    ),

  getStats: (companyId: string, agentSlug: string, lookbackDays?: number) => {
    const qs = lookbackDays ? `?lookbackDays=${lookbackDays}` : "";
    return api.get<AgentStatsResponse>(
      `/companies/${companyId}/business/agent-memory/stats/${agentSlug}${qs}`,
    );
  },

  getTimeseries: (companyId: string, agentSlug: string, days = 30) =>
    api.get<{ series: AgentTimeseriesPoint[] }>(
      `/companies/${companyId}/business/agent-memory/stats/${agentSlug}/timeseries?days=${days}`,
    ),

  getBiases: (companyId: string, agentSlug: string) =>
    api.get<{ biases: AgentMemoryBias[] }>(
      `/companies/${companyId}/business/agent-memory/biases/${agentSlug}`,
    ),

  inferOutcomes: (companyId: string) =>
    api.post<{ inferredCount: number }>(
      `/companies/${companyId}/business/agent-memory/infer-outcomes`,
      {},
    ),

  rankAgents: (companyId: string) =>
    api.get<{ rank: Array<{ agentSlug: string; accuracy: number; actionCount: number }> }>(
      `/companies/${companyId}/business/agent-memory/rank`,
    ),
};
