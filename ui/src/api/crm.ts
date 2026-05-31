import { api } from "./client";

export interface PipelineRow {
  id: string;
  companyId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStageRow {
  id: string;
  companyId: string;
  pipelineId: string;
  name: string;
  sort: number;
  winProbability: number;
  isWon: boolean;
  isLost: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeadRow {
  id: string;
  companyId: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string | null;
  score: number;
  ownerUserId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DealRow {
  id: string;
  companyId: string;
  name: string;
  pipelineId: string | null;
  stageId: string | null;
  amountMinor: number;
  currency: string | null;
  contactId: string | null;
  customerName: string | null;
  status: string | null;
  expectedClose: string | null;
  score: number;
  ownerUserId: string | null;
  lostReason: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRow {
  id: string;
  companyId: string;
  kind: string | null;
  subject: string | null;
  body: string | null;
  relatedType: string | null;
  relatedId: string | null;
  dueAt: string | null;
  done: boolean;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteLine {
  description: string;
  qty: number;
  unitPriceMinor: number;
}

export interface QuoteRow {
  id: string;
  companyId: string;
  number: string | null;
  dealId: string | null;
  customerName: string | null;
  lines: QuoteLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string | null;
  status: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineCreateInput {
  name: string;
  isDefault?: boolean;
}

export interface StageCreateInput {
  pipelineId: string;
  name: string;
  sort?: number;
  winProbability?: number;
  isWon?: boolean;
  isLost?: boolean;
}

export interface LeadCreateInput {
  name: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status?: string | null;
  ownerUserId?: string | null;
}

export interface DealCreateInput {
  name: string;
  pipelineId?: string | null;
  stageId?: string | null;
  amountMinor?: number;
  currency?: string;
  customerName?: string | null;
  contactId?: string | null;
  expectedClose?: string | null;
  ownerUserId?: string | null;
}

export interface ActivityCreateInput {
  kind?: string | null;
  subject?: string | null;
  body?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  dueAt?: string | null;
  done?: boolean;
  ownerUserId?: string | null;
}

export interface QuoteCreateInput {
  number?: string | null;
  dealId?: string | null;
  customerName?: string | null;
  currency?: string;
  taxRatePct?: number;
  validUntil?: string | null;
  lines?: QuoteLine[];
}

export interface ConvertLeadResult {
  lead: LeadRow;
  deal: DealRow;
}

export const crmApi = {
  // Pipelines
  listPipelines: (companyId: string) =>
    api.get<{ pipelines: PipelineRow[] }>(
      `/companies/${companyId}/crm/pipelines`,
    ),
  createPipeline: (companyId: string, body: PipelineCreateInput) =>
    api.post<PipelineRow>(`/companies/${companyId}/crm/pipelines`, body),

  // Pipeline stages
  listStages: (companyId: string, pipelineId?: string) => {
    const params = new URLSearchParams();
    if (pipelineId) params.set("pipelineId", pipelineId);
    const qs = params.toString();
    return api.get<{ stages: PipelineStageRow[] }>(
      `/companies/${companyId}/crm/pipeline-stages${qs ? `?${qs}` : ""}`,
    );
  },
  createStage: (companyId: string, body: StageCreateInput) =>
    api.post<PipelineStageRow>(
      `/companies/${companyId}/crm/pipeline-stages`,
      body,
    ),

  // Leads
  listLeads: (companyId: string) =>
    api.get<{ leads: LeadRow[] }>(`/companies/${companyId}/crm/leads`),
  createLead: (companyId: string, body: LeadCreateInput) =>
    api.post<LeadRow>(`/companies/${companyId}/crm/leads`, body),
  scoreLead: (companyId: string, id: string) =>
    api.post<LeadRow>(`/companies/${companyId}/crm/leads/${id}/score`, {}),
  convertLead: (companyId: string, id: string, body: { pipelineId: string }) =>
    api.post<ConvertLeadResult>(
      `/companies/${companyId}/crm/leads/${id}/convert`,
      body,
    ),

  // Deals
  listDeals: (companyId: string, pipelineId?: string) => {
    const params = new URLSearchParams();
    if (pipelineId) params.set("pipelineId", pipelineId);
    const qs = params.toString();
    return api.get<{ deals: DealRow[] }>(
      `/companies/${companyId}/crm/deals${qs ? `?${qs}` : ""}`,
    );
  },
  createDeal: (companyId: string, body: DealCreateInput) =>
    api.post<DealRow>(`/companies/${companyId}/crm/deals`, body),
  moveDeal: (companyId: string, id: string, body: { stageId: string }) =>
    api.post<DealRow>(`/companies/${companyId}/crm/deals/${id}/move`, body),

  // Activities
  listActivities: (
    companyId: string,
    filters?: { relatedType?: string; relatedId?: string },
  ) => {
    const params = new URLSearchParams();
    if (filters?.relatedType) params.set("relatedType", filters.relatedType);
    if (filters?.relatedId) params.set("relatedId", filters.relatedId);
    const qs = params.toString();
    return api.get<{ activities: ActivityRow[] }>(
      `/companies/${companyId}/crm/activities${qs ? `?${qs}` : ""}`,
    );
  },
  createActivity: (companyId: string, body: ActivityCreateInput) =>
    api.post<ActivityRow>(`/companies/${companyId}/crm/activities`, body),

  // Quotes
  listQuotes: (companyId: string) =>
    api.get<{ quotes: QuoteRow[] }>(`/companies/${companyId}/crm/quotes`),
  createQuote: (companyId: string, body: QuoteCreateInput) =>
    api.post<QuoteRow>(`/companies/${companyId}/crm/quotes`, body),
  acceptQuote: (companyId: string, id: string) =>
    api.post<QuoteRow>(`/companies/${companyId}/crm/quotes/${id}/accept`, {}),
};
