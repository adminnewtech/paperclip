import { api } from "./client";
import type { HermesAgentInfo } from "@paperclipai/shared";

export interface RegisteredHermesAgent {
  id: string;
  companyId: string;
  hermesAgentId: string;
  workspaceMemberId: string;
  info: HermesAgentInfo;
  enabled: boolean;
  channels: string[];
  registeredAt: string;
}

export interface HermesStatus {
  configured: boolean;
  baseUrl: string;
  organizationId: string | null;
  mock: boolean;
}

export interface HermesAgentsResponse {
  available: HermesAgentInfo[];
  registered: RegisteredHermesAgent[];
}

export type HermesTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface HermesTask {
  id: string;
  companyId: string;
  hermesAgentId: string;
  prompt: string;
  promptAr?: string;
  callbackChannel?: string;
  callbackThreadRootId?: string;
  status: HermesTaskStatus;
  output?: string;
  outputAr?: string;
  createdAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface DelegateTaskRequest {
  hermesAgentId: string;
  prompt: string;
  promptAr?: string;
  context?: Record<string, unknown>;
  callbackChannel?: string;
  callbackThreadRootId?: string;
}

export const businessHermesApi = {
  getStatus: (companyId: string) =>
    api.get<HermesStatus>(
      `/companies/${companyId}/business/hermes/status`,
    ),

  listAgents: (companyId: string) =>
    api.get<HermesAgentsResponse>(
      `/companies/${companyId}/business/hermes/agents`,
    ),

  sync: (companyId: string) =>
    api.post<{ ok: boolean; added: number; updated: number; removed: number }>(
      `/companies/${companyId}/business/hermes/sync`,
      {},
    ),

  registerAgent: (
    companyId: string,
    hermesAgentId: string,
    body: { channels?: string[] } = {},
  ) =>
    api.post<{ ok: boolean; registered: RegisteredHermesAgent }>(
      `/companies/${companyId}/business/hermes/agents/${hermesAgentId}/register`,
      body,
    ),

  unregisterAgent: (companyId: string, registeredAgentId: string) =>
    api.delete<{ ok: boolean }>(
      `/companies/${companyId}/business/hermes/agents/${registeredAgentId}`,
    ),

  delegateTask: (companyId: string, body: DelegateTaskRequest) =>
    api.post<{ ok: boolean; taskId: string }>(
      `/companies/${companyId}/business/hermes/tasks`,
      body,
    ),

  listTasks: (
    companyId: string,
    opts?: { status?: HermesTaskStatus; agentId?: string; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.agentId) params.set("agentId", opts.agentId);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<{ tasks: HermesTask[] }>(
      `/companies/${companyId}/business/hermes/tasks${qs ? `?${qs}` : ""}`,
    );
  },

  getTask: (companyId: string, taskId: string) =>
    api.get<{ task: HermesTask }>(
      `/companies/${companyId}/business/hermes/tasks/${taskId}`,
    ),

  cancelTask: (companyId: string, taskId: string) =>
    api.post<{ ok: boolean }>(
      `/companies/${companyId}/business/hermes/tasks/${taskId}/cancel`,
      {},
    ),
};
