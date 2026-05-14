/**
 * Workspace API client — Phase 11.
 *
 * Wraps the REST surface exposed by `/api/companies/:companyId/workspace/*`.
 * All calls return strongly-typed shapes from `@paperclipai/shared`.
 *
 * The companion {@link useWorkspaceStream} hook subscribes to the SSE stream
 * for real-time updates.
 */
import type {
  ChannelKind,
  WorkspaceChannel,
  WorkspaceMember,
  WorkspaceMemberStatus,
  WorkspaceMessage,
  WorkspaceMessageCard,
  WorkspaceMessageMention,
} from "@paperclipai/shared";
import { api } from "./client";

export interface ListChannelsResponse {
  channels: WorkspaceChannel[];
}

export interface ChannelResponse {
  channel: WorkspaceChannel;
}

export interface ListMessagesResponse {
  messages: WorkspaceMessage[];
  hasMore?: boolean;
}

export interface MessageResponse {
  message: WorkspaceMessage;
}

export interface ListMembersResponse {
  members: WorkspaceMember[];
}

export interface MemberResponse {
  member: WorkspaceMember;
}

export interface UnreadCountsResponse {
  /** channelId → unread count for the requesting member. */
  counts: Record<string, number>;
  total: number;
}

export interface SendMessageBody {
  kind?: "text" | "card" | "command_result" | "event" | "system" | "ai_response";
  authorType?: "user" | "agent" | "hermes" | "system";
  authorId?: string;
  body: string;
  bodyAr?: string;
  threadRootId?: string;
  mentions?: WorkspaceMessageMention[];
  card?: WorkspaceMessageCard;
}

export interface CommandAutocompleteHit {
  name: string;
  description?: string;
  descriptionAr?: string;
  category?: string;
}

export interface CommandAutocompleteResponse {
  results: CommandAutocompleteHit[];
}

export interface CommandExecuteResponse {
  ok: boolean;
  message?: WorkspaceMessage;
  /** Human-readable result text (may be displayed as a system message). */
  output?: string;
  error?: string;
}

export interface SearchMessagesResponse {
  results: Array<{ message: WorkspaceMessage; channel?: WorkspaceChannel }>;
}

export interface RenderCardResponse {
  card: WorkspaceMessageCard;
}

export interface ExecuteCardActionResponse {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

const base = (companyId: string) => `/companies/${companyId}/workspace`;

export const workspaceApi = {
  channels: {
    list: (companyId: string) =>
      api.get<ListChannelsResponse>(`${base(companyId)}/channels`),
    create: (
      companyId: string,
      body: {
        slug: string;
        name: string;
        nameAr?: string;
        description?: string;
        kind?: ChannelKind;
      },
    ) =>
      api.post<ChannelResponse>(`${base(companyId)}/channels`, body),
    getBySlug: (companyId: string, slug: string) =>
      api.get<ChannelResponse>(
        `${base(companyId)}/channels/by-slug/${encodeURIComponent(slug)}`,
      ),
    seedDefaults: (companyId: string) =>
      api.post<ListChannelsResponse>(
        `${base(companyId)}/channels/seed-defaults`,
        {},
      ),
    members: (companyId: string, channelId: string) =>
      api.get<ListMembersResponse>(
        `${base(companyId)}/channels/${channelId}/members`,
      ),
  },
  dms: {
    findOrCreate: (companyId: string, otherMemberId: string) =>
      api.post<ChannelResponse>(`${base(companyId)}/dms`, { otherMemberId }),
  },
  messages: {
    list: (
      companyId: string,
      channelId: string,
      opts: { before?: string; threadRootId?: string; limit?: number } = {},
    ) => {
      const q = new URLSearchParams();
      if (opts.before) q.set("before", opts.before);
      if (opts.threadRootId) q.set("threadRootId", opts.threadRootId);
      if (opts.limit !== undefined) q.set("limit", String(opts.limit));
      const qs = q.toString();
      return api.get<ListMessagesResponse>(
        `${base(companyId)}/channels/${channelId}/messages${qs ? `?${qs}` : ""}`,
      );
    },
    send: (companyId: string, channelId: string, body: SendMessageBody) =>
      api.post<MessageResponse>(
        `${base(companyId)}/channels/${channelId}/messages`,
        body,
      ),
    edit: (companyId: string, messageId: string, body: string) =>
      api.patch<MessageResponse>(
        `${base(companyId)}/messages/${messageId}`,
        { body },
      ),
    remove: (companyId: string, messageId: string) =>
      api.delete<{ ok: true }>(`${base(companyId)}/messages/${messageId}`),
    react: (companyId: string, messageId: string, emoji: string) =>
      api.post<{ ok: true }>(
        `${base(companyId)}/messages/${messageId}/reactions`,
        { emoji },
      ),
    removeReaction: (
      companyId: string,
      messageId: string,
      emoji: string,
    ) =>
      api.delete<{ ok: true }>(
        `${base(companyId)}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      ),
    search: (companyId: string, q: string) =>
      api.get<SearchMessagesResponse>(
        `${base(companyId)}/search/messages?q=${encodeURIComponent(q)}`,
      ),
  },
  members: {
    list: (companyId: string) =>
      api.get<ListMembersResponse>(`${base(companyId)}/members`),
    get: (companyId: string, memberId: string) =>
      api.get<MemberResponse>(
        `${base(companyId)}/members/${encodeURIComponent(memberId)}`,
      ),
    updateStatus: (
      companyId: string,
      body: { status: WorkspaceMemberStatus; statusMessage?: string },
    ) =>
      api.post<{ ok: true }>(`${base(companyId)}/members/status`, body),
  },
  unread: {
    list: (companyId: string) =>
      api.get<UnreadCountsResponse>(`${base(companyId)}/unread`),
    markRead: (
      companyId: string,
      channelId: string,
      lastReadMessageId: string,
    ) =>
      api.post<{ ok: true }>(
        `${base(companyId)}/channels/${channelId}/mark-read`,
        { lastReadMessageId },
      ),
  },
  commands: {
    autocomplete: (companyId: string, prefix: string) =>
      api.get<CommandAutocompleteResponse>(
        `${base(companyId)}/commands/autocomplete?prefix=${encodeURIComponent(prefix)}`,
      ),
    execute: (
      companyId: string,
      body: { input: string; channelId: string; lang?: "en" | "ar" },
    ) =>
      api.post<CommandExecuteResponse>(
        `${base(companyId)}/commands/execute`,
        body,
      ),
  },
  cards: {
    render: (companyId: string, cardType: string, entityId: string) =>
      api.get<RenderCardResponse>(
        `${base(companyId)}/cards/${encodeURIComponent(cardType)}/${encodeURIComponent(entityId)}`,
      ),
    executeAction: (
      companyId: string,
      cardType: string,
      entityId: string,
      actionKey: string,
      body: Record<string, unknown> = {},
    ) =>
      api.post<ExecuteCardActionResponse>(
        `${base(companyId)}/cards/${encodeURIComponent(cardType)}/${encodeURIComponent(entityId)}/actions/${encodeURIComponent(actionKey)}`,
        body,
      ),
  },
};

export const workspaceQueryKeys = {
  channels: (companyId: string) => ["workspace", companyId, "channels"] as const,
  channelMembers: (companyId: string, channelId: string) =>
    ["workspace", companyId, "channels", channelId, "members"] as const,
  messages: (companyId: string, channelId: string, threadRootId?: string) =>
    [
      "workspace",
      companyId,
      "channels",
      channelId,
      "messages",
      threadRootId ?? "__root__",
    ] as const,
  members: (companyId: string) => ["workspace", companyId, "members"] as const,
  member: (companyId: string, memberId: string) =>
    ["workspace", companyId, "members", memberId] as const,
  unread: (companyId: string) => ["workspace", companyId, "unread"] as const,
  card: (companyId: string, cardType: string, entityId: string) =>
    ["workspace", companyId, "cards", cardType, entityId] as const,
  search: (companyId: string, q: string) =>
    ["workspace", companyId, "search", q] as const,
};
