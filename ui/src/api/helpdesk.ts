import { api } from "./client";

export interface TicketRow {
  id: string;
  companyId: string;
  number: string | null;
  subject: string | null;
  body: string | null;
  customerName: string | null;
  customerEmail: string | null;
  channel: string;
  priority: string;
  status: string;
  slaPolicyId: string | null;
  assigneeUserId: string | null;
  slaDueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TicketCommentRow {
  id: string;
  companyId: string;
  ticketId: string;
  author: string | null;
  body: string | null;
  internal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlaPolicyRow {
  id: string;
  companyId: string;
  name: string | null;
  firstResponseMins: number;
  resolutionMins: number;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

export interface KbArticleRow {
  id: string;
  companyId: string;
  title: string | null;
  slug: string | null;
  body: string | null;
  category: string | null;
  published: boolean;
  views: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketCreateInput {
  number?: string | null;
  subject?: string | null;
  body?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  channel?: "email" | "chat" | "phone" | "whatsapp" | "web";
  priority?: "low" | "medium" | "high" | "urgent";
  slaPolicyId?: string | null;
  assigneeUserId?: string | null;
}

export interface CommentCreateInput {
  author?: string | null;
  body: string;
  internal?: boolean;
}

export interface SlaPolicyCreateInput {
  name: string;
  firstResponseMins?: number;
  resolutionMins?: number;
  priority?: "low" | "medium" | "high" | "urgent";
}

export interface KbArticleCreateInput {
  title: string;
  slug?: string | null;
  body?: string | null;
  category?: string | null;
  published?: boolean;
}

export const helpdeskApi = {
  // Tickets
  listTickets: (companyId: string) =>
    api.get<{ tickets: TicketRow[] }>(
      `/companies/${companyId}/helpdesk/tickets`,
    ),
  createTicket: (companyId: string, body: TicketCreateInput) =>
    api.post<TicketRow>(`/companies/${companyId}/helpdesk/tickets`, body),
  listComments: (companyId: string, ticketId: string) =>
    api.get<{ comments: TicketCommentRow[] }>(
      `/companies/${companyId}/helpdesk/tickets/${ticketId}/comments`,
    ),
  addComment: (companyId: string, ticketId: string, body: CommentCreateInput) =>
    api.post<TicketCommentRow>(
      `/companies/${companyId}/helpdesk/tickets/${ticketId}/comments`,
      body,
    ),
  resolveTicket: (companyId: string, ticketId: string) =>
    api.post<TicketRow>(
      `/companies/${companyId}/helpdesk/tickets/${ticketId}/resolve`,
      {},
    ),

  // SLA policies
  listSlaPolicies: (companyId: string) =>
    api.get<{ slaPolicies: SlaPolicyRow[] }>(
      `/companies/${companyId}/helpdesk/sla-policies`,
    ),
  createSlaPolicy: (companyId: string, body: SlaPolicyCreateInput) =>
    api.post<SlaPolicyRow>(
      `/companies/${companyId}/helpdesk/sla-policies`,
      body,
    ),

  // Knowledge base
  listKbArticles: (companyId: string) =>
    api.get<{ kbArticles: KbArticleRow[] }>(
      `/companies/${companyId}/helpdesk/kb-articles`,
    ),
  createKbArticle: (companyId: string, body: KbArticleCreateInput) =>
    api.post<KbArticleRow>(
      `/companies/${companyId}/helpdesk/kb-articles`,
      body,
    ),
};
