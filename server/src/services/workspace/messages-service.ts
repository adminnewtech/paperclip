/**
 * Workspace messages + thread replies + reactions + mention parsing.
 *
 * Messages live in `business_entities`:
 *   moduleKey:   "workspace"
 *   entityType:  "message"
 *   parentId:    channelId (top-level) OR thread root message ID (replies)
 *
 * `parentId` doubles as the channel reference at the table level — this lets
 * the existing index `business_entities_parent_idx` answer "list messages in
 * channel X". For thread replies we also store the channel ID inside
 * `data.channelId` so the row never loses its channel.
 */

import { and, asc, desc, eq, ilike, isNull, lt, gt, or, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  WORKSPACE_ENTITY_TYPES,
  WORKSPACE_MODULE_KEY,
  type MessageKind,
  type WorkspaceMessage,
  type WorkspaceMessageMention,
  type WorkspaceMessageCard,
  type WorkspaceMessageAttachment,
} from "@paperclipai/shared";
import type { ChannelsService } from "./channels-service.js";
import type { MembersService } from "./members-service.js";
import type { WorkspaceStreamService } from "./workspace-stream.js";

export interface ListMessagesOpts {
  channelId: string;
  before?: string;
  after?: string;
  /** `null` = top-level only; a specific message id = its thread replies. */
  threadRootId?: string | null;
  limit?: number;
  includeDeleted?: boolean;
}

export interface SendMessageInput {
  channelId: string;
  threadRootId?: string;
  kind: MessageKind;
  authorType: WorkspaceMessage["authorType"];
  authorId: string;
  authorDisplayName?: string;
  authorAvatar?: string;
  body: string;
  bodyAr?: string;
  attachments?: WorkspaceMessageAttachment[];
  card?: WorkspaceMessageCard;
  mentions?: WorkspaceMessageMention[];
}

export interface MessagesService {
  list(
    companyId: string,
    opts: ListMessagesOpts,
  ): Promise<{ messages: WorkspaceMessage[]; nextCursor?: string }>;
  get(
    companyId: string,
    messageId: string,
  ): Promise<WorkspaceMessage | null>;
  send(companyId: string, input: SendMessageInput): Promise<WorkspaceMessage>;
  edit(
    companyId: string,
    messageId: string,
    newBody: string,
    editorId: string,
  ): Promise<WorkspaceMessage>;
  delete(
    companyId: string,
    messageId: string,
    deleterId: string,
  ): Promise<void>;
  addReaction(
    companyId: string,
    messageId: string,
    memberId: string,
    emoji: string,
  ): Promise<WorkspaceMessage>;
  removeReaction(
    companyId: string,
    messageId: string,
    memberId: string,
    emoji: string,
  ): Promise<WorkspaceMessage>;
  search(
    companyId: string,
    query: string,
    opts?: { channelId?: string; authorId?: string; limit?: number },
  ): Promise<WorkspaceMessage[]>;
  postSystemEvent(
    companyId: string,
    channelSlug: string,
    body: string,
    opts?: { kind?: MessageKind; card?: WorkspaceMessage["card"] },
  ): Promise<WorkspaceMessage | null>;
}

interface MessageData {
  channelId: string;
  threadRootId?: string;
  kind: MessageKind;
  authorType: WorkspaceMessage["authorType"];
  authorId: string;
  authorDisplayName?: string;
  authorAvatar?: string;
  body: string;
  bodyAr?: string;
  attachments?: WorkspaceMessageAttachment[];
  card?: WorkspaceMessageCard;
  mentions?: WorkspaceMessageMention[];
  reactions?: Record<string, string[]>;
  editedAt?: string;
  deletedAt?: string;
}

interface MessageRow {
  id: string;
  companyId: string;
  parentId: string | null;
  data: unknown;
  createdAt: Date | string;
}

function rowToMessage(row: MessageRow): WorkspaceMessage | null {
  const data = (row.data ?? {}) as Partial<MessageData>;
  if (!data.channelId || !data.kind || !data.authorType || !data.authorId) {
    return null;
  }
  return {
    id: row.id,
    companyId: row.companyId,
    channelId: data.channelId,
    threadRootId: data.threadRootId,
    kind: data.kind,
    authorType: data.authorType,
    authorId: data.authorId,
    authorDisplayName: data.authorDisplayName,
    authorAvatar: data.authorAvatar,
    body: data.body ?? "",
    bodyAr: data.bodyAr,
    attachments: data.attachments,
    card: data.card,
    mentions: data.mentions,
    reactions: data.reactions,
    editedAt: data.editedAt,
    deletedAt: data.deletedAt,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}

const MESSAGE_LIMIT_DEFAULT = 50;
const MESSAGE_LIMIT_MAX = 200;

// ---------------------------------------------------------------------------
// Mention parsing
// ---------------------------------------------------------------------------

/**
 * Tokens recognised inside message bodies:
 *
 *   @channel               → channel mention (whole channel)
 *   @here                  → channel mention with `here` semantics
 *   @<displayName>         → member mention; resolved by MembersService
 *   @<agentSlug>           → agent mention (sara, khaled, layla, omar, mariam)
 *   @<arabic-name>         → resolved via persona aliases on MembersService
 *
 * Hash routing for IDs like `@user:abc123` is also accepted so internal
 * automation can produce stable references.
 */
const MENTION_REGEX = /@([\p{L}\p{N}_:.\-]+)/gu;

async function parseMentions(
  members: MembersService,
  companyId: string,
  body: string,
): Promise<WorkspaceMessageMention[]> {
  const out: WorkspaceMessageMention[] = [];
  const seen = new Set<string>();
  // The flag is `g`, so `.exec` walks through every match without recursion.
  for (const match of body.matchAll(MENTION_REGEX)) {
    const raw = match[1];
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (lower === "channel" || lower === "here") {
      const key = `channel:${lower}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: "channel", id: lower });
      continue;
    }
    const member = await members.resolveMention(companyId, raw);
    if (!member) continue;
    const memberType: "user" | "agent" =
      member.type === "agent" ? "agent" : "user";
    const key = `${memberType}:${member.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: memberType, id: member.id });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

export function createMessagesService(
  db: Db,
  stream: WorkspaceStreamService,
  channels: ChannelsService,
  members: MembersService,
): MessagesService {
  function whereScoped(): SQL[] {
    return [
      eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
      eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.message),
    ];
  }

  async function loadById(
    companyId: string,
    messageId: string,
  ): Promise<{ row: MessageRow; data: MessageData } | null> {
    const [row] = await db
      .select({
        id: businessEntities.id,
        companyId: businessEntities.companyId,
        parentId: businessEntities.parentId,
        data: businessEntities.data,
        createdAt: businessEntities.createdAt,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, messageId),
          eq(businessEntities.companyId, companyId),
          ...whereScoped(),
        ),
      );
    if (!row) return null;
    return { row, data: (row.data ?? {}) as MessageData };
  }

  async function persist(
    companyId: string,
    messageId: string,
    data: MessageData,
  ): Promise<WorkspaceMessage | null> {
    const [row] = await db
      .update(businessEntities)
      .set({ data, updatedAt: new Date() })
      .where(
        and(
          eq(businessEntities.id, messageId),
          eq(businessEntities.companyId, companyId),
          ...whereScoped(),
        ),
      )
      .returning({
        id: businessEntities.id,
        companyId: businessEntities.companyId,
        parentId: businessEntities.parentId,
        data: businessEntities.data,
        createdAt: businessEntities.createdAt,
      });
    return row ? rowToMessage(row) : null;
  }

  return {
    async list(companyId, opts) {
      const limit = Math.min(
        Math.max(opts.limit ?? MESSAGE_LIMIT_DEFAULT, 1),
        MESSAGE_LIMIT_MAX,
      );
      // For top-level messages the row's `parentId` is the channel ID.
      // For thread replies, `parentId` is the thread root message ID.
      const parentTarget = opts.threadRootId ?? opts.channelId;
      const conds: SQL[] = [
        eq(businessEntities.companyId, companyId),
        ...whereScoped(),
        eq(businessEntities.parentId, parentTarget),
      ];
      // Cursor paging by id (UUIDs are random, so we use `createdAt` ordering
      // and require the caller to pass the previous batch's last message id).
      if (opts.before) {
        const beforeRow = await loadById(companyId, opts.before);
        if (beforeRow) {
          conds.push(
            lt(
              businessEntities.createdAt,
              beforeRow.row.createdAt instanceof Date
                ? beforeRow.row.createdAt
                : new Date(beforeRow.row.createdAt),
            ),
          );
        }
      }
      if (opts.after) {
        const afterRow = await loadById(companyId, opts.after);
        if (afterRow) {
          conds.push(
            gt(
              businessEntities.createdAt,
              afterRow.row.createdAt instanceof Date
                ? afterRow.row.createdAt
                : new Date(afterRow.row.createdAt),
            ),
          );
        }
      }

      const rows = await db
        .select({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          parentId: businessEntities.parentId,
          data: businessEntities.data,
          createdAt: businessEntities.createdAt,
        })
        .from(businessEntities)
        .where(and(...conds))
        .orderBy(desc(businessEntities.createdAt))
        .limit(limit + 1);

      const sliced = rows.slice(0, limit);
      const messages = sliced
        .map((row) => rowToMessage(row))
        .filter((m): m is WorkspaceMessage => m !== null)
        .filter((m) => (opts.includeDeleted ? true : !m.deletedAt))
        // Return ascending so the UI can append-to-end naturally.
        .reverse();

      const nextCursor =
        rows.length > limit ? sliced[sliced.length - 1]?.id : undefined;

      return { messages, nextCursor };
    },

    async get(companyId, messageId) {
      const loaded = await loadById(companyId, messageId);
      if (!loaded) return null;
      return rowToMessage(loaded.row);
    },

    async send(companyId, input) {
      const channel = await channels.get(companyId, input.channelId);
      if (!channel) throw new Error("Channel not found");

      const mentions =
        input.mentions ??
        (await parseMentions(members, companyId, input.body));

      const id = randomUUID();
      const now = new Date();
      const data: MessageData = {
        channelId: input.channelId,
        threadRootId: input.threadRootId,
        kind: input.kind,
        authorType: input.authorType,
        authorId: input.authorId,
        authorDisplayName: input.authorDisplayName,
        authorAvatar: input.authorAvatar,
        body: input.body,
        bodyAr: input.bodyAr,
        attachments: input.attachments,
        card: input.card,
        mentions,
      };

      const parentId = input.threadRootId ?? input.channelId;
      const [row] = await db
        .insert(businessEntities)
        .values({
          id,
          companyId,
          moduleKey: WORKSPACE_MODULE_KEY,
          entityType: WORKSPACE_ENTITY_TYPES.message,
          parentId,
          // Use a short code so messages remain easy to spot in raw queries.
          code: id.slice(0, 8),
          name: null,
          status: "active",
          data,
          tags: [],
          createdByUserId: input.authorType === "user" ? input.authorId : null,
          updatedByUserId: input.authorType === "user" ? input.authorId : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          parentId: businessEntities.parentId,
          data: businessEntities.data,
          createdAt: businessEntities.createdAt,
        });

      const message = rowToMessage(row!);
      if (!message) throw new Error("Failed to materialize new message");

      // Bump cached counters on the channel for top-level posts only.
      if (!input.threadRootId) {
        await channels
          .bumpMessageCounter(companyId, input.channelId, message.createdAt)
          .catch(() => {
            // Counter bookkeeping must never block message delivery.
          });
      }

      stream.emit(companyId, {
        kind: "message.created",
        channelId: input.channelId,
        message,
      });
      return message;
    },

    async edit(companyId, messageId, newBody, editorId) {
      const loaded = await loadById(companyId, messageId);
      if (!loaded) throw new Error("Message not found");
      if (loaded.data.authorId !== editorId) {
        throw new Error("Only the author may edit a message");
      }
      const nextData: MessageData = {
        ...loaded.data,
        body: newBody,
        mentions: await parseMentions(members, companyId, newBody),
        editedAt: new Date().toISOString(),
      };
      const message = await persist(companyId, messageId, nextData);
      if (!message) throw new Error("Message edit failed");
      stream.emit(companyId, {
        kind: "message.updated",
        channelId: message.channelId,
        message,
      });
      return message;
    },

    async delete(companyId, messageId, deleterId) {
      const loaded = await loadById(companyId, messageId);
      if (!loaded) return;
      // Soft-delete: keep the row, mark `deletedAt` so threads stay linked.
      const nextData: MessageData = {
        ...loaded.data,
        deletedAt: new Date().toISOString(),
        body: "",
      };
      const message = await persist(companyId, messageId, nextData);
      if (message) {
        stream.emit(companyId, {
          kind: "message.deleted",
          channelId: message.channelId,
          messageId,
        });
      }
      // Note: `deleterId` is currently not persisted in the message row; the
      // companion audit log captures who removed it. Argument kept for API
      // parity and forward compatibility.
      void deleterId;
    },

    async addReaction(companyId, messageId, memberId, emoji) {
      const loaded = await loadById(companyId, messageId);
      if (!loaded) throw new Error("Message not found");
      const reactions = { ...(loaded.data.reactions ?? {}) };
      const list = reactions[emoji] ? [...reactions[emoji]] : [];
      if (!list.includes(memberId)) list.push(memberId);
      reactions[emoji] = list;
      const message = await persist(companyId, messageId, {
        ...loaded.data,
        reactions,
      });
      if (!message) throw new Error("Reaction persistence failed");
      stream.emit(companyId, {
        kind: "reaction.added",
        channelId: message.channelId,
        messageId,
        emoji,
        memberId,
      });
      return message;
    },

    async removeReaction(companyId, messageId, memberId, emoji) {
      const loaded = await loadById(companyId, messageId);
      if (!loaded) throw new Error("Message not found");
      const reactions = { ...(loaded.data.reactions ?? {}) };
      const current = reactions[emoji] ?? [];
      const next = current.filter((id) => id !== memberId);
      if (next.length === 0) delete reactions[emoji];
      else reactions[emoji] = next;
      const message = await persist(companyId, messageId, {
        ...loaded.data,
        reactions,
      });
      if (!message) throw new Error("Reaction persistence failed");
      stream.emit(companyId, {
        kind: "reaction.removed",
        channelId: message.channelId,
        messageId,
        emoji,
        memberId,
      });
      return message;
    },

    async search(companyId, query, opts) {
      const limit = Math.min(Math.max(opts?.limit ?? 25, 1), 200);
      const trimmed = query.trim();
      if (!trimmed) return [];
      const conds: SQL[] = [
        eq(businessEntities.companyId, companyId),
        ...whereScoped(),
        // jsonb body match — case-insensitive substring.
        ilike(businessEntities.data as never, `%${trimmed}%`),
      ];
      if (opts?.channelId) {
        conds.push(eq(businessEntities.parentId, opts.channelId));
      }
      const rows = await db
        .select({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          parentId: businessEntities.parentId,
          data: businessEntities.data,
          createdAt: businessEntities.createdAt,
        })
        .from(businessEntities)
        .where(and(...conds))
        .orderBy(desc(businessEntities.createdAt))
        .limit(limit);
      const messages = rows
        .map((row) => rowToMessage(row))
        .filter((m): m is WorkspaceMessage => m !== null)
        .filter((m) => !m.deletedAt);
      if (opts?.authorId) {
        return messages.filter((m) => m.authorId === opts.authorId);
      }
      return messages;
    },

    async postSystemEvent(companyId, channelSlug, body, opts) {
      const channel = await channels.getBySlug(companyId, channelSlug);
      if (!channel) return null;
      return this.send(companyId, {
        channelId: channel.id,
        kind: opts?.kind ?? "event",
        authorType: "system",
        authorId: "system",
        authorDisplayName: "Paperclip",
        authorAvatar: "🤖",
        body,
        card: opts?.card,
      });
    },
  };
}

// Drizzle re-exports kept here to make tests less noisy.
export const _unused = { isNull, or, asc };
