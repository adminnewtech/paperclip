import { api } from "./client";

export interface CampaignRow {
  id: string;
  companyId: string;
  name: string;
  channel: string;
  status: string;
  audienceId: string | null;
  templateId: string | null;
  scheduledAt: string | null;
  sentCount: number;
  openCount: number;
  clickCount: number;
  budgetMinor: number;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceRow {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  filter: Record<string, unknown>;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplateRow {
  id: string;
  companyId: string;
  name: string;
  subject: string | null;
  body: string | null;
  kind: string;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyRow {
  id: string;
  companyId: string;
  name: string;
  trigger: string | null;
  nodes: unknown[];
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignCreateInput {
  name: string;
  channel?: string;
  status?: string;
  audienceId?: string | null;
  templateId?: string | null;
  scheduledAt?: string | null;
  budgetMinor?: number;
}

export interface AudienceCreateInput {
  name: string;
  description?: string | null;
  filter?: Record<string, unknown>;
  memberCount?: number;
}

export interface EmailTemplateCreateInput {
  name: string;
  subject?: string | null;
  body?: string | null;
  kind?: string;
}

export interface JourneyCreateInput {
  name: string;
  trigger?: string | null;
  nodes?: unknown[];
  enabled?: boolean;
  version?: number;
}

const BASE = (companyId: string) => `/companies/${companyId}/marketing`;

export const marketingApi = {
  // Campaigns
  listCampaigns: (companyId: string) =>
    api.get<{ campaigns: CampaignRow[] }>(`${BASE(companyId)}/campaigns`),
  createCampaign: (companyId: string, body: CampaignCreateInput) =>
    api.post<CampaignRow>(`${BASE(companyId)}/campaigns`, body),
  sendCampaign: (companyId: string, id: string) =>
    api.post<CampaignRow>(`${BASE(companyId)}/campaigns/${id}/send`, {}),

  // Audiences
  listAudiences: (companyId: string) =>
    api.get<{ audiences: AudienceRow[] }>(`${BASE(companyId)}/audiences`),
  createAudience: (companyId: string, body: AudienceCreateInput) =>
    api.post<AudienceRow>(`${BASE(companyId)}/audiences`, body),

  // Email templates
  listEmailTemplates: (companyId: string) =>
    api.get<{ emailTemplates: EmailTemplateRow[] }>(
      `${BASE(companyId)}/email-templates`,
    ),
  createEmailTemplate: (companyId: string, body: EmailTemplateCreateInput) =>
    api.post<EmailTemplateRow>(`${BASE(companyId)}/email-templates`, body),

  // Journeys
  listJourneys: (companyId: string) =>
    api.get<{ journeys: JourneyRow[] }>(`${BASE(companyId)}/journeys`),
  createJourney: (companyId: string, body: JourneyCreateInput) =>
    api.post<JourneyRow>(`${BASE(companyId)}/journeys`, body),
};
