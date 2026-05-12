import { api } from "./client";

export interface CofounderToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface CofounderMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: CofounderToolCall[];
  toolResult?: { id: string; result: unknown };
  timestamp: string;
}

export interface CofounderPendingConfirmation {
  action: string;
  parameters: Record<string, unknown>;
  expiresAt: string;
}

export interface CofounderSession {
  id: string;
  companyId: string;
  userPhone: string;
  userUserId?: string;
  language: "ar" | "en";
  messages: CofounderMessage[];
  lastActivityAt: string;
  pendingConfirmation?: CofounderPendingConfirmation;
}

export interface CofounderSessionSummary {
  id: string;
  userPhone: string;
  userUserId?: string;
  language: "ar" | "en";
  messageCount: number;
  lastActivityAt: string;
  pendingConfirmation?: CofounderPendingConfirmation;
}

export interface CofounderActionTaken {
  name: string;
  summary: string;
  result?: unknown;
}

export interface CofounderResponse {
  reply: string;
  actionsTaken: CofounderActionTaken[];
  attachments?: Array<{
    type: "image" | "document";
    url: string;
    caption?: string;
  }>;
  needsConfirmation?: {
    action: string;
    parameters: Record<string, unknown>;
    question: string;
  };
  language: "ar" | "en";
  sessionId: string;
}

export interface OwnerPhone {
  userPhone: string;
  userUserId?: string;
  lang: "ar" | "en";
  dailyBriefEnabled: boolean;
  weeklyReportEnabled: boolean;
  briefTime: string;
  lastDailyBriefSentAt?: string;
  lastWeeklyReportSentAt?: string;
}

export interface CofounderTool {
  name: string;
  category: "read" | "write" | "report" | "messaging";
  description: string;
  descriptionAr: string;
  dangerous: boolean;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

const root = (companyId: string) =>
  `/companies/${encodeURIComponent(companyId)}/business/cofounder`;

export const aiCofounderApi = {
  sendMessage(
    companyId: string,
    input: { text: string; userPhone?: string; lang?: "ar" | "en" },
  ): Promise<CofounderResponse> {
    return api.post<CofounderResponse>(`${root(companyId)}/message`, input);
  },
  listSessions(
    companyId: string,
  ): Promise<{ sessions: CofounderSessionSummary[] }> {
    return api.get<{ sessions: CofounderSessionSummary[] }>(
      `${root(companyId)}/sessions`,
    );
  },
  getSession(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderSession> {
    return api.get<CofounderSession>(
      `${root(companyId)}/sessions/${encodeURIComponent(userPhone)}`,
    );
  },
  clearSession(companyId: string, userPhone: string): Promise<void> {
    return api.delete<void>(
      `${root(companyId)}/sessions/${encodeURIComponent(userPhone)}`,
    );
  },
  listOwnerPhones(companyId: string): Promise<{ items: OwnerPhone[] }> {
    return api.get<{ items: OwnerPhone[] }>(`${root(companyId)}/owner-phones`);
  },
  registerOwnerPhone(
    companyId: string,
    input: {
      userPhone: string;
      userUserId?: string;
      lang?: "ar" | "en";
      dailyBriefEnabled?: boolean;
      weeklyReportEnabled?: boolean;
      briefTime?: string;
    },
  ): Promise<{ items: OwnerPhone[] }> {
    return api.post<{ items: OwnerPhone[] }>(
      `${root(companyId)}/owner-phones`,
      input,
    );
  },
  updateOwnerPhone(
    companyId: string,
    userPhone: string,
    input: {
      lang?: "ar" | "en";
      dailyBriefEnabled?: boolean;
      weeklyReportEnabled?: boolean;
      briefTime?: string;
    },
  ): Promise<{ items: OwnerPhone[] }> {
    return api.patch<{ items: OwnerPhone[] }>(
      `${root(companyId)}/owner-phones/${encodeURIComponent(userPhone)}`,
      input,
    );
  },
  unregisterOwnerPhone(companyId: string, userPhone: string): Promise<void> {
    return api.delete<void>(
      `${root(companyId)}/owner-phones/${encodeURIComponent(userPhone)}`,
    );
  },
  triggerDailyBrief(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderResponse> {
    return api.post<CofounderResponse>(
      `${root(companyId)}/trigger-daily-brief/${encodeURIComponent(userPhone)}`,
      {},
    );
  },
  triggerWeeklyReport(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderResponse> {
    return api.post<CofounderResponse>(
      `${root(companyId)}/trigger-weekly-report/${encodeURIComponent(userPhone)}`,
      {},
    );
  },
  listTools(companyId: string): Promise<{ tools: CofounderTool[] }> {
    return api.get<{ tools: CofounderTool[] }>(`${root(companyId)}/tools`);
  },
};
