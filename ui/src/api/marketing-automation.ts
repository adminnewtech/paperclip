import { api } from "./client";

// ---------------------------------------------------------------------------
// Types — mirror server-side `MarketingFlow` shape
// ---------------------------------------------------------------------------

export type FlowTrigger =
  | { kind: "schedule"; cron: string; tz?: string }
  | {
      kind: "entity_created";
      moduleKey: string;
      entityType: string;
      conditions?: Record<string, unknown>;
    }
  | {
      kind: "entity_status_changed";
      moduleKey: string;
      entityType: string;
      toStatus: string;
    }
  | { kind: "tag_added"; tag: string }
  | { kind: "manual" };

export interface FlowAudience {
  source: "all_contacts" | "tag" | "segment" | "filter";
  tag?: string;
  segment?: string;
  filter?: {
    field: string;
    op: "eq" | "neq" | "gt" | "lt" | "contains";
    value: unknown;
  };
}

export type FlowStep =
  | {
      kind: "send_message";
      channel: "whatsapp" | "sms" | "email";
      templateKey: string;
      lang?: "ar" | "en";
    }
  | { kind: "wait"; durationHours: number }
  | { kind: "wait_until"; hourLocal: number; minuteLocal?: number }
  | {
      kind: "branch";
      condition: { field: string; op: string; value: unknown };
      then: FlowStep[];
      else: FlowStep[];
    }
  | { kind: "tag_contact"; tag: string }
  | { kind: "create_ticket"; subject: string; priority?: string }
  | { kind: "stop" };

export interface MarketingFlowStats {
  enrolledCount: number;
  completedCount: number;
  messagesSentCount: number;
  deliveredCount: number;
  failedCount: number;
  revenueAttributedCents?: number;
}

export interface MarketingFlow {
  id: string;
  name: string;
  nameAr?: string;
  description?: string;
  enabled: boolean;
  trigger: FlowTrigger;
  audience: FlowAudience;
  steps: FlowStep[];
  stats: MarketingFlowStats;
}

export interface FlowEnrollment {
  id: string;
  flowId: string;
  contactId: string;
  contactPhone?: string;
  contactEmail?: string;
  enrolledAt: string;
  currentStepIndex: number;
  nextRunAt?: string;
  status: "active" | "completed" | "paused" | "failed";
  history: Array<{
    stepIndex: number;
    ranAt: string;
    result: string;
    error?: string;
  }>;
}

export interface MarketingFlowTemplate {
  key: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  category: "welcome" | "retention" | "winback" | "promotion" | "transactional";
  defaultFlow: Omit<MarketingFlow, "id" | "stats" | "enabled">;
}

export interface CreateFlowBody {
  name: string;
  nameAr?: string;
  description?: string;
  enabled?: boolean;
  trigger: FlowTrigger;
  audience: FlowAudience;
  steps: FlowStep[];
}

export type UpdateFlowBody = Partial<CreateFlowBody>;

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const marketingAutomationApi = {
  templates: () =>
    api.get<{ templates: MarketingFlowTemplate[] }>(
      `/business/marketing/flows/templates`,
    ),

  list: (companyId: string) =>
    api.get<{ flows: MarketingFlow[] }>(
      `/companies/${companyId}/business/marketing/flows`,
    ),

  get: (companyId: string, id: string) =>
    api.get<MarketingFlow>(
      `/companies/${companyId}/business/marketing/flows/${id}`,
    ),

  create: (companyId: string, body: CreateFlowBody) =>
    api.post<MarketingFlow>(
      `/companies/${companyId}/business/marketing/flows`,
      body,
    ),

  update: (companyId: string, id: string, body: UpdateFlowBody) =>
    api.patch<MarketingFlow>(
      `/companies/${companyId}/business/marketing/flows/${id}`,
      body,
    ),

  remove: (companyId: string, id: string) =>
    api.delete<void>(`/companies/${companyId}/business/marketing/flows/${id}`),

  enable: (companyId: string, id: string) =>
    api.post<MarketingFlow>(
      `/companies/${companyId}/business/marketing/flows/${id}/enable`,
      {},
    ),

  disable: (companyId: string, id: string) =>
    api.post<MarketingFlow>(
      `/companies/${companyId}/business/marketing/flows/${id}/disable`,
      {},
    ),

  trigger: (companyId: string, id: string, contactIds: string[]) =>
    api.post<{ enrolledCount: number }>(
      `/companies/${companyId}/business/marketing/flows/${id}/trigger`,
      { contactIds },
    ),

  enrollments: (companyId: string, id: string, status?: string) =>
    api.get<{ enrollments: FlowEnrollment[] }>(
      `/companies/${companyId}/business/marketing/flows/${id}/enrollments${
        status ? `?status=${encodeURIComponent(status)}` : ""
      }`,
    ),

  analytics: (companyId: string, id: string) =>
    api.get<{ stats: MarketingFlowStats }>(
      `/companies/${companyId}/business/marketing/flows/${id}/analytics`,
    ),

  fromTemplate: (companyId: string, templateKey: string) =>
    api.post<MarketingFlow>(
      `/companies/${companyId}/business/marketing/flows/from-template/${templateKey}`,
      {},
    ),
};
