import { api } from "./client";

export type BusinessAgentSlug =
  | "accountant"
  | "sales"
  | "customer_service"
  | "inventory"
  | "marketing";

export type BusinessAgentSchedule = "daily" | "weekly" | "hourly" | "on_event";
export type BusinessAgentCapabilityTrigger =
  | "scheduled"
  | "on_create"
  | "on_demand";

export interface BusinessAgentCapability {
  key: string;
  label: string;
  labelAr: string;
  description: string;
  trigger: BusinessAgentCapabilityTrigger;
}

export interface BusinessAgentDefinition {
  slug: BusinessAgentSlug;
  name: string;
  nameAr: string;
  personaName: string;
  personaNameAr: string;
  title: string;
  titleAr: string;
  emoji: string;
  color: string;
  description: string;
  descriptionAr: string;
  responsibilities: string[];
  responsibilitiesAr: string[];
  modulesAccessed: string[];
  defaultSchedule: BusinessAgentSchedule;
  defaultRunTime: string;
  capabilities: BusinessAgentCapability[];
  monthlyCostCents: number;
}

export type AgentRunStatus = "success" | "partial" | "failed";

export interface HiredAgent {
  id: string;
  companyId: string;
  agentSlug: string;
  status: "active" | "paused";
  hiredAt: string;
  pausedAt?: string;
  schedule: string;
  enabledCapabilities: string[];
  lastRunAt?: string;
  lastRunStatus?: AgentRunStatus;
  runCount: number;
  actionsCount: number;
}

export interface AgentRunAction {
  capability: string;
  summary: string;
  summaryAr?: string;
  entityRefs?: string[];
  severity: "info" | "action" | "warning";
}

export interface AgentRunResult {
  id?: string;
  startedAt: string;
  finishedAt: string;
  status: AgentRunStatus;
  actions: AgentRunAction[];
  errors?: string[];
}

export const businessAgentsApi = {
  catalog: (companyId: string) =>
    api.get<{ agents: BusinessAgentDefinition[] }>(
      `/companies/${companyId}/business/agents/catalog`,
    ),

  listHired: (companyId: string) =>
    api.get<{ hired: HiredAgent[] }>(
      `/companies/${companyId}/business/agents/hired`,
    ),

  get: (companyId: string, agentSlug: string) =>
    api.get<{ definition: BusinessAgentDefinition; hired: HiredAgent | null }>(
      `/companies/${companyId}/business/agents/${agentSlug}`,
    ),

  hire: (
    companyId: string,
    agentSlug: string,
    body?: { schedule?: string; capabilities?: string[] },
  ) =>
    api.post<HiredAgent>(
      `/companies/${companyId}/business/agents/${agentSlug}/hire`,
      body ?? {},
    ),

  fire: (companyId: string, agentSlug: string) =>
    api.post<void>(
      `/companies/${companyId}/business/agents/${agentSlug}/fire`,
      {},
    ),

  pause: (companyId: string, agentSlug: string) =>
    api.post<HiredAgent>(
      `/companies/${companyId}/business/agents/${agentSlug}/pause`,
      {},
    ),

  resume: (companyId: string, agentSlug: string) =>
    api.post<HiredAgent>(
      `/companies/${companyId}/business/agents/${agentSlug}/resume`,
      {},
    ),

  update: (
    companyId: string,
    agentSlug: string,
    body: { schedule?: string; capabilities?: string[] },
  ) =>
    api.put<HiredAgent>(
      `/companies/${companyId}/business/agents/${agentSlug}`,
      body,
    ),

  runNow: (companyId: string, agentSlug: string) =>
    api.post<AgentRunResult>(
      `/companies/${companyId}/business/agents/${agentSlug}/run`,
      {},
    ),

  listRuns: (companyId: string, agentSlug: string, limit?: number) => {
    const qs = limit ? `?limit=${limit}` : "";
    return api.get<{ runs: AgentRunResult[] }>(
      `/companies/${companyId}/business/agents/${agentSlug}/runs${qs}`,
    );
  },

  getRun: (companyId: string, agentSlug: string, runId: string) =>
    api.get<AgentRunResult>(
      `/companies/${companyId}/business/agents/${agentSlug}/runs/${runId}`,
    ),
};
