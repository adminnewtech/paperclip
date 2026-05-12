import { api } from "./client";

export type AutomationActionKind =
  | "create_invoice"
  | "send_reminder"
  | "generate_report"
  | "create_ticket"
  | "tag_entity"
  | "ai_action";

export type AutomationTriggerKind = "schedule" | "event";

export interface AutomationTrigger {
  kind: AutomationTriggerKind;
  schedule?: { cron: string; timezone?: string };
  event?: { type: string; conditions?: Record<string, unknown> };
}

export interface AutomationAction {
  kind: AutomationActionKind;
  params: Record<string, unknown>;
}

export interface AutomationHistoryEntry {
  at: string;
  ok: boolean;
  message: string;
  trigger: "schedule" | "manual" | "event";
  durationMs?: number;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  errorCount: number;
  history?: AutomationHistoryEntry[];
}

export interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
}

export interface CreateRuleBody {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
}

export interface UpdateRuleBody {
  name?: string;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  action?: AutomationAction;
}

export interface RunResult {
  ok: boolean;
  message: string;
}

export const businessAutomationsApi = {
  templates: () =>
    api.get<{ templates: AutomationTemplate[] }>(
      "/business/automations/templates",
    ),

  list: (companyId: string) =>
    api.get<{ rules: AutomationRule[] }>(
      `/companies/${companyId}/business/automations`,
    ),

  create: (companyId: string, body: CreateRuleBody) =>
    api.post<AutomationRule>(
      `/companies/${companyId}/business/automations`,
      body,
    ),

  update: (companyId: string, id: string, body: UpdateRuleBody) =>
    api.patch<AutomationRule>(
      `/companies/${companyId}/business/automations/${id}`,
      body,
    ),

  remove: (companyId: string, id: string) =>
    api.delete<void>(`/companies/${companyId}/business/automations/${id}`),

  run: (companyId: string, id: string) =>
    api.post<RunResult>(
      `/companies/${companyId}/business/automations/${id}/run`,
      {},
    ),

  history: (companyId: string, id: string) =>
    api.get<{ history: AutomationHistoryEntry[] }>(
      `/companies/${companyId}/business/automations/${id}/history`,
    ),
};
