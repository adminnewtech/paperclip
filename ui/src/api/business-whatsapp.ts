import { api } from "./client";

export type WhatsappTemplateStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED";

export interface WhatsappTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO";
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][] };
  buttons?: Array<{
    type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
    text: string;
    url?: string;
    phone_number?: string;
  }>;
}

export interface WhatsappTemplate {
  id?: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  components: WhatsappTemplateComponent[];
  status?: WhatsappTemplateStatus;
  rejectedReason?: string;
}

export interface WhatsappBusinessProfile {
  name: string;
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  profilePicture?: string;
  vertical?: string;
}

export interface WhatsappConfigStatus {
  configured: boolean;
  hasToken: boolean;
  hasPhoneNumberId: boolean;
  hasBusinessAccountId: boolean;
  hasWebhookVerifyToken: boolean;
  hasAppSecret: boolean;
  graphApiVersion: string;
  webhookUrl: string;
}

export interface WhatsappConversation {
  id: string;
  contactId: string | null;
  contactName: string;
  phone: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  status: string;
}

export interface WhatsappThreadMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  direction: "inbound" | "outbound";
  content: Record<string, unknown>;
  timestamp: string;
  status?: "sent" | "delivered" | "read" | "failed";
  errorMessage?: string;
}

export const businessWhatsappApi = {
  getConfig: (companyId: string) =>
    api.get<WhatsappConfigStatus>(
      `/companies/${companyId}/business/whatsapp/config`,
    ),

  listTemplates: (companyId: string) =>
    api.get<{ templates: WhatsappTemplate[]; configured: boolean }>(
      `/companies/${companyId}/business/whatsapp/templates`,
    ),

  createTemplate: (
    companyId: string,
    body: Omit<WhatsappTemplate, "status" | "id" | "rejectedReason">,
  ) =>
    api.post<{ template: WhatsappTemplate }>(
      `/companies/${companyId}/business/whatsapp/templates`,
      body,
    ),

  deleteTemplate: (companyId: string, name: string) =>
    api.delete<{ ok: true }>(
      `/companies/${companyId}/business/whatsapp/templates/${encodeURIComponent(name)}`,
    ),

  getProfile: (companyId: string) =>
    api.get<{ profile: WhatsappBusinessProfile }>(
      `/companies/${companyId}/business/whatsapp/profile`,
    ),

  updateProfile: (companyId: string, body: Partial<WhatsappBusinessProfile>) =>
    api.put<{ profile: WhatsappBusinessProfile }>(
      `/companies/${companyId}/business/whatsapp/profile`,
      body,
    ),

  listConversations: (
    companyId: string,
    opts?: { status?: string; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<{ conversations: WhatsappConversation[] }>(
      `/companies/${companyId}/business/whatsapp/conversations${qs ? `?${qs}` : ""}`,
    );
  },

  getThread: (companyId: string, contactId: string, limit?: number) => {
    const qs = limit ? `?limit=${limit}` : "";
    return api.get<{ messages: WhatsappThreadMessage[] }>(
      `/companies/${companyId}/business/whatsapp/conversations/${contactId}/messages${qs}`,
    );
  },

  reply: (companyId: string, contactId: string, text: string) =>
    api.post<{ message: WhatsappThreadMessage }>(
      `/companies/${companyId}/business/whatsapp/conversations/${contactId}/reply`,
      { text },
    ),

  markAsRead: (companyId: string, contactId: string) =>
    api.post<{ ok: true }>(
      `/companies/${companyId}/business/whatsapp/conversations/${contactId}/read`,
      {},
    ),
};
