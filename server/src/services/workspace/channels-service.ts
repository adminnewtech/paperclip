/**
 * Channel CRUD + membership for the Workspace module.
 *
 * Channels are stored in `business_entities` with
 *   moduleKey:   "workspace"
 *   entityType:  "channel"
 *   code:        the channel slug (unique per company per kind)
 *
 * The full {@link WorkspaceChannel} shape lives in `data` — counters are
 * cached there and re-computed lazily on read.
 */

import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  WORKSPACE_ENTITY_TYPES,
  WORKSPACE_MODULE_KEY,
  computeDmKey,
  type ChannelKind,
  type WorkspaceChannel,
} from "@paperclipai/shared";
import type { WorkspaceStreamService } from "./workspace-stream.js";

interface ChannelData {
  slug: string;
  name: string;
  nameAr?: string;
  description?: string;
  kind: ChannelKind;
  dmKey?: string;
  archived: boolean;
  defaultMembers: boolean;
  topicPin?: string;
  memberIds: string[];
  messageCount: number;
  lastMessageAt?: string;
}

export interface ListChannelsOpts {
  memberId?: string;
  kind?: ChannelKind;
  includeArchived?: boolean;
}

export interface CreateChannelInput {
  slug: string;
  name: string;
  nameAr?: string;
  kind: ChannelKind;
  description?: string;
  createdBy?: string;
  defaultMembers?: boolean;
  /** Optional initial members. */
  memberIds?: string[];
  /** Optional `dmKey` for `kind: "dm"`. Computed by `findOrCreateDm`. */
  dmKey?: string;
}

export interface ChannelsService {
  list(companyId: string, opts?: ListChannelsOpts): Promise<WorkspaceChannel[]>;
  get(companyId: string, channelId: string): Promise<WorkspaceChannel | null>;
  getBySlug(
    companyId: string,
    slug: string,
  ): Promise<WorkspaceChannel | null>;
  create(
    companyId: string,
    input: CreateChannelInput,
  ): Promise<WorkspaceChannel>;
  update(
    companyId: string,
    channelId: string,
    patch: Partial<
      Pick<WorkspaceChannel, "name" | "nameAr" | "description" | "topicPin">
    >,
  ): Promise<WorkspaceChannel>;
  archive(companyId: string, channelId: string): Promise<void>;

  listMembers(companyId: string, channelId: string): Promise<string[]>;
  addMember(
    companyId: string,
    channelId: string,
    memberId: string,
  ): Promise<void>;
  removeMember(
    companyId: string,
    channelId: string,
    memberId: string,
  ): Promise<void>;

  findOrCreateDm(
    companyId: string,
    memberA: string,
    memberB: string,
  ): Promise<WorkspaceChannel>;

  /** Increment cached message count + lastMessageAt; emitted by messages-service. */
  bumpMessageCounter(
    companyId: string,
    channelId: string,
    at: string,
  ): Promise<void>;
}

interface EntityRow {
  id: string;
  companyId: string;
  code: string | null;
  name: string | null;
  status: string;
  data: unknown;
  createdAt: Date | string;
  createdByUserId: string | null;
}

function rowToChannel(row: EntityRow): WorkspaceChannel | null {
  const data = (row.data ?? {}) as Partial<ChannelData>;
  if (!data.kind) return null;
  const memberIds = Array.isArray(data.memberIds) ? data.memberIds : [];
  return {
    id: row.id,
    companyId: row.companyId,
    slug: data.slug ?? row.code ?? row.id,
    name: data.name ?? row.name ?? "",
    nameAr: data.nameAr,
    description: data.description,
    kind: data.kind,
    dmKey: data.dmKey,
    archived: data.archived ?? row.status === "archived",
    defaultMembers: data.defaultMembers ?? false,
    topicPin: data.topicPin,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    createdBy: row.createdByUserId ?? undefined,
    memberCount: memberIds.length,
    messageCount: data.messageCount ?? 0,
    lastMessageAt: data.lastMessageAt,
  };
}

const CHANNEL_COLUMNS = {
  id: businessEntities.id,
  companyId: businessEntities.companyId,
  code: businessEntities.code,
  name: businessEntities.name,
  status: businessEntities.status,
  data: businessEntities.data,
  createdAt: businessEntities.createdAt,
  createdByUserId: businessEntities.createdByUserId,
} as const;

function channelWhere(companyId: string) {
  return and(
    eq(businessEntities.companyId, companyId),
    eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
    eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.channel),
  );
}

export function createChannelsService(
  db: Db,
  stream: WorkspaceStreamService,
): ChannelsService {
  async function persistData(
    companyId: string,
    channelId: string,
    nextData: ChannelData,
    nextStatus?: string,
    nextName?: string,
  ): Promise<WorkspaceChannel | null> {
    const now = new Date();
    const updates: Record<string, unknown> = {
      data: nextData,
      updatedAt: now,
    };
    if (nextStatus !== undefined) updates.status = nextStatus;
    if (nextName !== undefined) updates.name = nextName;
    const [row] = await db
      .update(businessEntities)
      .set(updates)
      .where(
        and(
          eq(businessEntities.id, channelId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
          eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.channel),
        ),
      )
      .returning({
        id: businessEntities.id,
        companyId: businessEntities.companyId,
        code: businessEntities.code,
        name: businessEntities.name,
        status: businessEntities.status,
        data: businessEntities.data,
        createdAt: businessEntities.createdAt,
        createdByUserId: businessEntities.createdByUserId,
      });
    if (!row) return null;
    return rowToChannel(row);
  }

  async function loadData(
    companyId: string,
    channelId: string,
  ): Promise<{ row: EntityRow; data: ChannelData } | null> {
    const [row] = await db
      .select(CHANNEL_COLUMNS)
      .from(businessEntities)
      .where(and(channelWhere(companyId), eq(businessEntities.id, channelId)));
    if (!row) return null;
    const data = (row.data ?? {}) as ChannelData;
    data.memberIds = Array.isArray(data.memberIds) ? data.memberIds : [];
    return { row, data };
  }

  return {
    async list(companyId, opts) {
      const rows = await db
        .select(CHANNEL_COLUMNS)
        .from(businessEntities)
        .where(channelWhere(companyId))
        .orderBy(asc(businessEntities.code));
      const channels = rows
        .map((row) => rowToChannel(row))
        .filter((c): c is WorkspaceChannel => c !== null);
      let filtered = channels;
      if (!opts?.includeArchived) {
        filtered = filtered.filter((c) => !c.archived);
      }
      if (opts?.kind) {
        filtered = filtered.filter((c) => c.kind === opts.kind);
      }
      if (opts?.memberId) {
        const memberId = opts.memberId;
        filtered = filtered.filter((c) => {
          if (c.kind === "public") return true;
          if (c.kind === "system") return true;
          // Private / DM channels: must include the member.
          const loaded = rows.find((r) => r.id === c.id);
          if (!loaded) return false;
          const data = (loaded.data ?? {}) as ChannelData;
          return Array.isArray(data.memberIds) && data.memberIds.includes(memberId);
        });
      }
      return filtered;
    },

    async get(companyId, channelId) {
      const loaded = await loadData(companyId, channelId);
      if (!loaded) return null;
      return rowToChannel(loaded.row);
    },

    async getBySlug(companyId, slug) {
      const [row] = await db
        .select(CHANNEL_COLUMNS)
        .from(businessEntities)
        .where(and(channelWhere(companyId), eq(businessEntities.code, slug)));
      if (!row) return null;
      return rowToChannel(row);
    },

    async create(companyId, input) {
      const now = new Date();
      const data: ChannelData = {
        slug: input.slug,
        name: input.name,
        nameAr: input.nameAr,
        description: input.description,
        kind: input.kind,
        dmKey: input.dmKey,
        archived: false,
        defaultMembers: input.defaultMembers ?? false,
        memberIds: input.memberIds ?? [],
        messageCount: 0,
      };
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: WORKSPACE_MODULE_KEY,
          entityType: WORKSPACE_ENTITY_TYPES.channel,
          code: input.slug,
          name: input.name,
          status: "active",
          data,
          tags: [],
          createdByUserId: input.createdBy ?? null,
          updatedByUserId: input.createdBy ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          code: businessEntities.code,
          name: businessEntities.name,
          status: businessEntities.status,
          data: businessEntities.data,
          createdAt: businessEntities.createdAt,
          createdByUserId: businessEntities.createdByUserId,
        });
      const channel = rowToChannel(row!);
      if (!channel) {
        throw new Error("Failed to materialize created channel");
      }
      stream.emit(companyId, { kind: "channel.created", channel });
      return channel;
    },

    async update(companyId, channelId, patch) {
      const loaded = await loadData(companyId, channelId);
      if (!loaded) throw new Error("Channel not found");
      const nextData: ChannelData = { ...loaded.data };
      if (patch.name !== undefined) nextData.name = patch.name;
      if (patch.nameAr !== undefined) nextData.nameAr = patch.nameAr;
      if (patch.description !== undefined)
        nextData.description = patch.description;
      if (patch.topicPin !== undefined) nextData.topicPin = patch.topicPin;
      const channel = await persistData(
        companyId,
        channelId,
        nextData,
        undefined,
        patch.name ?? loaded.row.name ?? undefined,
      );
      if (!channel) throw new Error("Channel update failed");
      stream.emit(companyId, { kind: "channel.updated", channel });
      return channel;
    },

    async archive(companyId, channelId) {
      const loaded = await loadData(companyId, channelId);
      if (!loaded) return;
      const nextData: ChannelData = { ...loaded.data, archived: true };
      const channel = await persistData(
        companyId,
        channelId,
        nextData,
        "archived",
      );
      if (channel) {
        stream.emit(companyId, { kind: "channel.updated", channel });
      }
    },

    async listMembers(companyId, channelId) {
      const loaded = await loadData(companyId, channelId);
      if (!loaded) return [];
      return Array.from(new Set(loaded.data.memberIds));
    },

    async addMember(companyId, channelId, memberId) {
      const loaded = await loadData(companyId, channelId);
      if (!loaded) return;
      if (loaded.data.memberIds.includes(memberId)) return;
      const nextData: ChannelData = {
        ...loaded.data,
        memberIds: [...loaded.data.memberIds, memberId],
      };
      const channel = await persistData(companyId, channelId, nextData);
      if (channel) stream.emit(companyId, { kind: "channel.updated", channel });
    },

    async removeMember(companyId, channelId, memberId) {
      const loaded = await loadData(companyId, channelId);
      if (!loaded) return;
      const next = loaded.data.memberIds.filter((id) => id !== memberId);
      if (next.length === loaded.data.memberIds.length) return;
      const nextData: ChannelData = { ...loaded.data, memberIds: next };
      const channel = await persistData(companyId, channelId, nextData);
      if (channel) stream.emit(companyId, { kind: "channel.updated", channel });
    },

    async findOrCreateDm(companyId, memberA, memberB) {
      const dmKey = computeDmKey(memberA, memberB);
      const rows = await db
        .select(CHANNEL_COLUMNS)
        .from(businessEntities)
        .where(channelWhere(companyId));
      for (const row of rows) {
        const data = (row.data ?? {}) as Partial<ChannelData>;
        if (data.kind === "dm" && data.dmKey === dmKey) {
          const channel = rowToChannel(row);
          if (channel) return channel;
        }
      }
      return this.create(companyId, {
        slug: `dm-${dmKey}`.slice(0, 200),
        name: `DM`,
        kind: "dm",
        dmKey,
        defaultMembers: false,
        memberIds: [memberA, memberB],
      });
    },

    async bumpMessageCounter(companyId, channelId, at) {
      // Use SQL to atomically bump the JSONB counters; reading and rewriting
      // would race with other concurrent posts.
      await db
        .update(businessEntities)
        .set({
          data: sql`jsonb_set(
            jsonb_set(
              ${businessEntities.data},
              '{messageCount}',
              to_jsonb(coalesce((${businessEntities.data}->>'messageCount')::int, 0) + 1)
            ),
            '{lastMessageAt}',
            to_jsonb(${at}::text)
          )`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(businessEntities.id, channelId),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
            eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.channel),
          ),
        );
    },
  };
}

// Re-exports so consumers don't need to reach into drizzle for query helpers
// in tests; intentionally minimal.
export const _internal = { count, desc };
