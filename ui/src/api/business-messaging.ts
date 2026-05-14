import { api } from "./client";
import type { MessageTemplate } from "@paperclipai/shared";

export type MessageChannel = "whatsapp" | "sms";

export interface SendMessageRequest {
  channel: MessageChannel;
  toPhone: string;
  body: string;
  templateKey?: string;
  variables?: Record<string, string>;
  relatedEntityId?: string;
}

export interface SendTemplateRequest {
  templateKey: string;
  channel: MessageChannel;
  toPhone: string;
  variables: Record<string, string>;
  relatedEntityId?: string;
  lang?: "ar" | "en";
}

export interface SendMessageResult {
  ok: boolean;
  messageId?: string;
  providerResponse?: unknown;
  error?: string;
  mock?: boolean;
}

export interface MessageRecord {
  id: string;
  companyId: string;
  code: string | null;
  status: string;
  channel: MessageChannel;
  toPhone: string;
  body: string;
  templateKey: string | null;
  variables: Record<string, string> | null;
  relatedEntityId: string | null;
  providerMessageId: string | null;
  providerResponse: unknown;
  error: string | null;
  mock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessagingProviderStatus {
  whatsapp: { configured: boolean; details: string };
  sms: {
    provider: "twilio" | "aws-sns" | "unifonic" | "msegat" | "mock";
    configured: boolean;
    details: string;
  };
}

export interface ListTemplatesResponse {
  templates: MessageTemplate[];
  providerStatus: MessagingProviderStatus;
}

export const businessMessagingApi = {
  listTemplates: (companyId: string) =>
    api.get<ListTemplatesResponse>(
      `/companies/${companyId}/business/messaging/templates`,
    ),

  send: (companyId: string, body: SendMessageRequest) =>
    api.post<SendMessageResult>(
      `/companies/${companyId}/business/messaging/send`,
      body,
    ),

  sendTemplate: (companyId: string, body: SendTemplateRequest) =>
    api.post<SendMessageResult>(
      `/companies/${companyId}/business/messaging/send-template`,
      body,
    ),

  listMessages: (
    companyId: string,
    opts?: { limit?: number; relatedEntityId?: string },
  ) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.relatedEntityId)
      params.set("relatedEntityId", opts.relatedEntityId);
    const qs = params.toString();
    return api.get<{ messages: MessageRecord[] }>(
      `/companies/${companyId}/business/messaging/messages${qs ? `?${qs}` : ""}`,
    );
  },

  getMessage: (companyId: string, id: string) =>
    api.get<MessageRecord>(
      `/companies/${companyId}/business/messaging/messages/${id}`,
    ),
};
