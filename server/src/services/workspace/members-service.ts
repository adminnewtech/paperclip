/**
 * Workspace member registry — humans, AI agents, and Hermes bridge accounts.
 *
 * Members are cached in `business_entities`:
 *   moduleKey:   "workspace"
 *   entityType:  "member"
 *   code:        the composite member id (userId | agent:slug | hermes:id)
 *
 * The registry is mostly a denormalised projection: humans come from the
 * `companyMembers` table, agents from {@link BUSINESS_AGENTS} in shared, etc.
 * Storing it under `business_entities` lets us mention-resolve by name and
 * keep cheap status updates in one place without joining four tables.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  BUSINESS_AGENTS,
  WORKSPACE_ENTITY_TYPES,
  WORKSPACE_MODULE_KEY,
  type WorkspaceMember,
  type WorkspaceMemberStatus,
  type MemberType,
} from "@paperclipai/shared";
import type { WorkspaceStreamService } from "./workspace-stream.js";

export interface MembersService {
  list(
    companyId: string,
    opts?: { type?: MemberType },
  ): Promise<WorkspaceMember[]>;
  get(companyId: string, memberId: string): Promise<WorkspaceMember | null>;
  registerUser(
    companyId: string,
    userId: string,
    info: {
      displayName: string;
      displayNameAr?: string;
      avatar?: string;
      title?: string;
    },
  ): Promise<WorkspaceMember>;
  registerAgent(
    companyId: string,
    agentSlug: string,
    info: {
      displayName: string;
      displayNameAr: string;
      avatar: string;
      title: string;
      titleAr: string;
    },
  ): Promise<WorkspaceMember>;
  registerHermesAgent(
    companyId: string,
    hermesId: string,
    info: { displayName: string; avatar?: string; title?: string },
  ): Promise<WorkspaceMember>;
  unregister(companyId: string, memberId: string): Promise<void>;
  updateStatus(
    companyId: string,
    memberId: string,
    status: WorkspaceMemberStatus,
    message?: string,
  ): Promise<void>;
  setLastSeen(companyId: string, memberId: string): Promise<void>;
  resolveMention(
    companyId: string,
    mentionText: string,
  ): Promise<WorkspaceMember | null>;
}

interface MemberData {
  type: MemberType;
  displayName: string;
  displayNameAr?: string;
  avatar?: string;
  title?: string;
  titleAr?: string;
  status: WorkspaceMemberStatus;
  statusMessage?: string;
  agentSlug?: string;
  channelMemberships?: string[];
  lastSeenAt?: string;
  /** Lowercased alias list (English + Arabic) used by mention resolution. */
  aliases?: string[];
}

interface MemberRow {
  id: string;
  companyId: string;
  code: string | null;
  name: string | null;
  data: unknown;
}

function rowToMember(row: MemberRow): WorkspaceMember | null {
  const data = (row.data ?? {}) as Partial<MemberData>;
  if (!data.type) return null;
  return {
    id: row.code ?? row.id,
    companyId: row.companyId,
    type: data.type,
    displayName: data.displayName ?? row.name ?? row.code ?? "",
    displayNameAr: data.displayNameAr,
    avatar: data.avatar,
    title: data.title,
    status: data.status ?? "offline",
    statusMessage: data.statusMessage,
    agentSlug: data.agentSlug,
    channelMemberships: data.channelMemberships,
    lastSeenAt: data.lastSeenAt,
  };
}

function buildAgentAliases(agentSlug: string): string[] {
  const def = BUSINESS_AGENTS.find((a) => a.slug === agentSlug);
  if (!def) return [agentSlug.toLowerCase()];
  return Array.from(
    new Set(
      [
        agentSlug,
        def.slug,
        def.personaName,
        def.personaNameAr,
        def.name,
        def.nameAr,
        `agent:${def.slug}`,
      ]
        .map((s) => s?.trim())
        .filter((s): s is string => Boolean(s && s.length > 0))
        .map((s) => s.toLowerCase()),
    ),
  );
}

export function createMembersService(
  db: Db,
  stream: WorkspaceStreamService,
): MembersService {
  async function upsert(
    companyId: string,
    memberId: string,
    data: MemberData,
  ): Promise<WorkspaceMember> {
    // Try update; if no row updated, insert.
    const now = new Date();
    const [existing] = await db
      .select({
        id: businessEntities.id,
        companyId: businessEntities.companyId,
        code: businessEntities.code,
        name: businessEntities.name,
        data: businessEntities.data,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
          eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.member),
          eq(businessEntities.code, memberId),
        ),
      );
    if (existing) {
      const merged: MemberData = {
        ...((existing.data ?? {}) as MemberData),
        ...data,
      };
      const [row] = await db
        .update(businessEntities)
        .set({ name: data.displayName, data: merged, updatedAt: now })
        .where(eq(businessEntities.id, existing.id))
        .returning({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          code: businessEntities.code,
          name: businessEntities.name,
          data: businessEntities.data,
        });
      const member = row ? rowToMember(row) : null;
      if (!member) throw new Error("Member upsert failed");
      return member;
    }
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: WORKSPACE_MODULE_KEY,
        entityType: WORKSPACE_ENTITY_TYPES.member,
        code: memberId,
        name: data.displayName,
        status: "active",
        data,
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: businessEntities.id,
        companyId: businessEntities.companyId,
        code: businessEntities.code,
        name: businessEntities.name,
        data: businessEntities.data,
      });
    const member = row ? rowToMember(row) : null;
    if (!member) throw new Error("Member insert failed");
    return member;
  }

  return {
    async list(companyId, opts) {
      const rows = await db
        .select({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          code: businessEntities.code,
          name: businessEntities.name,
          data: businessEntities.data,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
            eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.member),
          ),
        );
      const members = rows
        .map((r) => rowToMember(r))
        .filter((m): m is WorkspaceMember => m !== null);
      if (opts?.type) return members.filter((m) => m.type === opts.type);
      return members;
    },

    async get(companyId, memberId) {
      const [row] = await db
        .select({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          code: businessEntities.code,
          name: businessEntities.name,
          data: businessEntities.data,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
            eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.member),
            eq(businessEntities.code, memberId),
          ),
        );
      if (!row) return null;
      return rowToMember(row);
    },

    async registerUser(companyId, userId, info) {
      const aliases = [info.displayName, info.displayNameAr, userId]
        .filter((s): s is string => Boolean(s))
        .map((s) => s.toLowerCase());
      return upsert(companyId, userId, {
        type: "user",
        displayName: info.displayName,
        displayNameAr: info.displayNameAr,
        avatar: info.avatar,
        title: info.title,
        status: "offline",
        aliases,
      });
    },

    async registerAgent(companyId, agentSlug, info) {
      const memberId = `agent:${agentSlug}`;
      const aliases = Array.from(
        new Set([
          ...buildAgentAliases(agentSlug),
          info.displayName.toLowerCase(),
          info.displayNameAr.toLowerCase(),
        ]),
      );
      return upsert(companyId, memberId, {
        type: "agent",
        displayName: info.displayName,
        displayNameAr: info.displayNameAr,
        avatar: info.avatar,
        title: info.title,
        titleAr: info.titleAr,
        status: "online",
        agentSlug,
        aliases,
      });
    },

    async registerHermesAgent(companyId, hermesId, info) {
      const memberId = `hermes:${hermesId}`;
      const aliases = [info.displayName, memberId, hermesId]
        .filter((s): s is string => Boolean(s))
        .map((s) => s.toLowerCase());
      return upsert(companyId, memberId, {
        type: "hermes",
        displayName: info.displayName,
        avatar: info.avatar,
        title: info.title,
        status: "online",
        aliases,
      });
    },

    async unregister(companyId, memberId) {
      await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
            eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.member),
            eq(businessEntities.code, memberId),
          ),
        );
    },

    async updateStatus(companyId, memberId, status, message) {
      const existing = await this.get(companyId, memberId);
      if (!existing) return;
      const data: MemberData = {
        type: existing.type,
        displayName: existing.displayName,
        displayNameAr: existing.displayNameAr,
        avatar: existing.avatar,
        title: existing.title,
        status,
        statusMessage: message,
        agentSlug: existing.agentSlug,
        channelMemberships: existing.channelMemberships,
        lastSeenAt: existing.lastSeenAt,
      };
      await db
        .update(businessEntities)
        .set({ data, updatedAt: new Date() })
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
            eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.member),
            eq(businessEntities.code, memberId),
          ),
        );
      stream.emit(companyId, {
        kind: "member.status_changed",
        memberId,
        status,
        message,
      });
    },

    async setLastSeen(companyId, memberId) {
      const existing = await this.get(companyId, memberId);
      if (!existing) return;
      const data: MemberData = {
        type: existing.type,
        displayName: existing.displayName,
        displayNameAr: existing.displayNameAr,
        avatar: existing.avatar,
        title: existing.title,
        status: existing.status,
        statusMessage: existing.statusMessage,
        agentSlug: existing.agentSlug,
        channelMemberships: existing.channelMemberships,
        lastSeenAt: new Date().toISOString(),
      };
      await db
        .update(businessEntities)
        .set({ data, updatedAt: new Date() })
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
            eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.member),
            eq(businessEntities.code, memberId),
          ),
        );
    },

    async resolveMention(companyId, mentionText) {
      const key = mentionText.trim().toLowerCase();
      if (!key) return null;
      // Direct id match first (cheap), then alias scan.
      const direct = await this.get(companyId, mentionText.trim());
      if (direct) return direct;
      // Allow `agent:slug` shorthand
      if (!key.startsWith("agent:")) {
        const agentTry = await this.get(companyId, `agent:${key}`);
        if (agentTry) return agentTry;
      }
      const rows = await db
        .select({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          code: businessEntities.code,
          name: businessEntities.name,
          data: businessEntities.data,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
            eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.member),
          ),
        );
      for (const row of rows) {
        const data = (row.data ?? {}) as Partial<MemberData>;
        const aliases = data.aliases ?? [];
        if (aliases.includes(key)) {
          const member = rowToMember(row);
          if (member) return member;
        }
      }
      return null;
    },
  };
}
