/**
 * Hermes agent registry.
 *
 * Tracks which Hermes agents have been registered into a given company's
 * workspace as members. Storage is in `businessEntities`:
 *
 *   moduleKey:    "hermes"
 *   entityType:   "registered_agent"
 *   code:         the upstream Hermes agent id (unique per company)
 */

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type { HermesAgentInfo } from "@paperclipai/shared";

import { logger } from "../../middleware/logger.js";
import type { HermesClient } from "./hermes-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MinimalMemberRegistrar {
  registerHermesAgent(
    companyId: string,
    hermesId: string,
    info: { displayName: string; avatar?: string; title?: string },
  ): Promise<{ id: string }>;
  removeMember(companyId: string, memberId: string): Promise<void>;
}

export interface RegisteredHermesAgent {
  id: string;
  companyId: string;
  hermesAgentId: string;
  workspaceMemberId: string;
  info: HermesAgentInfo;
  enabled: boolean;
  channels: string[];
  registeredAt: string;
}

export interface RegisterOptions {
  channels?: string[];
  memberRegistrar?: MinimalMemberRegistrar;
}

export interface SyncOptions {
  memberRegistrar?: MinimalMemberRegistrar;
}

export interface HermesRegistry {
  list(companyId: string): Promise<RegisteredHermesAgent[]>;
  register(
    companyId: string,
    agentInfo: HermesAgentInfo,
    opts?: RegisterOptions,
  ): Promise<RegisteredHermesAgent>;
  unregister(
    companyId: string,
    registeredAgentId: string,
  ): Promise<void>;
  updateInfo(
    companyId: string,
    registeredAgentId: string,
    updates: Partial<HermesAgentInfo>,
  ): Promise<RegisteredHermesAgent>;
  getByHermesId(
    companyId: string,
    hermesAgentId: string,
  ): Promise<RegisteredHermesAgent | null>;
  syncFromHermes(
    companyId: string,
    opts?: SyncOptions,
  ): Promise<{ added: number; updated: number; removed: number }>;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

interface RegisteredAgentData {
  hermesAgentId: string;
  workspaceMemberId: string;
  info: HermesAgentInfo;
  enabled: boolean;
  channels: string[];
  registeredAt: string;
}

function rowToRegistered(
  row: typeof businessEntities.$inferSelect,
): RegisteredHermesAgent {
  const data = (row.data ?? {}) as Partial<RegisteredAgentData>;
  return {
    id: row.id,
    companyId: row.companyId,
    hermesAgentId: data.hermesAgentId ?? row.code ?? "",
    workspaceMemberId: data.workspaceMemberId ?? `hermes:${row.code ?? row.id}`,
    info:
      data.info ??
      ({
        id: row.code ?? row.id,
        name: row.name ?? row.code ?? row.id,
        capabilities: [],
        status: "offline",
      } as HermesAgentInfo),
    enabled: data.enabled ?? row.status === "active",
    channels: Array.isArray(data.channels) ? data.channels : [],
    registeredAt: data.registeredAt
      ? data.registeredAt
      : row.createdAt
        ? new Date(row.createdAt).toISOString()
        : new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateHermesRegistryOpts {
  client: HermesClient;
}

export function createHermesRegistry(
  db: Db,
  opts: CreateHermesRegistryOpts,
): HermesRegistry {
  const { client } = opts;

  async function list(companyId: string): Promise<RegisteredHermesAgent[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "hermes"),
          eq(businessEntities.entityType, "registered_agent"),
        ),
      );
    return rows.map(rowToRegistered);
  }

  async function getByHermesId(
    companyId: string,
    hermesAgentId: string,
  ): Promise<RegisteredHermesAgent | null> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "hermes"),
          eq(businessEntities.entityType, "registered_agent"),
          eq(businessEntities.code, hermesAgentId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToRegistered(row) : null;
  }

  async function register(
    companyId: string,
    agentInfo: HermesAgentInfo,
    registerOpts: RegisterOptions = {},
  ): Promise<RegisteredHermesAgent> {
    const existing = await getByHermesId(companyId, agentInfo.id);
    if (existing) {
      // Update info and (optionally) channels.
      const next: RegisteredAgentData = {
        hermesAgentId: agentInfo.id,
        workspaceMemberId: existing.workspaceMemberId,
        info: agentInfo,
        enabled: true,
        channels:
          registerOpts.channels && registerOpts.channels.length > 0
            ? registerOpts.channels
            : existing.channels,
        registeredAt: existing.registeredAt,
      };
      const [row] = await db
        .update(businessEntities)
        .set({
          name: agentInfo.name,
          status: "active",
          data: next,
          updatedAt: new Date(),
        })
        .where(eq(businessEntities.id, existing.id))
        .returning();
      return rowToRegistered(row);
    }

    let workspaceMemberId = `hermes:${agentInfo.id}`;
    if (registerOpts.memberRegistrar) {
      try {
        const member = await registerOpts.memberRegistrar.registerHermesAgent(
          companyId,
          agentInfo.id,
          {
            displayName: agentInfo.name,
            avatar: agentInfo.avatar,
            title: agentInfo.description,
          },
        );
        workspaceMemberId = member.id;
      } catch (err) {
        logger.warn(
          { err, companyId, agentId: agentInfo.id },
          "[hermes] memberRegistrar.registerHermesAgent failed",
        );
      }
    }

    const data: RegisteredAgentData = {
      hermesAgentId: agentInfo.id,
      workspaceMemberId,
      info: agentInfo,
      enabled: true,
      channels: registerOpts.channels ?? [],
      registeredAt: new Date().toISOString(),
    };

    const now = new Date();
    const [row] = await db
      .insert(businessEntities)
      .values({
        id: randomUUID(),
        companyId,
        moduleKey: "hermes",
        entityType: "registered_agent",
        code: agentInfo.id,
        name: agentInfo.name,
        status: "active",
        data,
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return rowToRegistered(row);
  }

  async function unregister(
    companyId: string,
    registeredAgentId: string,
  ): Promise<void> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, registeredAgentId),
          eq(businessEntities.moduleKey, "hermes"),
          eq(businessEntities.entityType, "registered_agent"),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return;
    await db.delete(businessEntities).where(eq(businessEntities.id, row.id));
  }

  async function updateInfo(
    companyId: string,
    registeredAgentId: string,
    updates: Partial<HermesAgentInfo>,
  ): Promise<RegisteredHermesAgent> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, registeredAgentId),
          eq(businessEntities.moduleKey, "hermes"),
          eq(businessEntities.entityType, "registered_agent"),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new Error(`Hermes registered agent not found: ${registeredAgentId}`);
    }
    const current = rowToRegistered(row);
    const nextInfo: HermesAgentInfo = { ...current.info, ...updates };
    const data: RegisteredAgentData = {
      hermesAgentId: current.hermesAgentId,
      workspaceMemberId: current.workspaceMemberId,
      info: nextInfo,
      enabled: current.enabled,
      channels: current.channels,
      registeredAt: current.registeredAt,
    };
    const [updated] = await db
      .update(businessEntities)
      .set({
        name: nextInfo.name,
        data,
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, row.id))
      .returning();
    return rowToRegistered(updated);
  }

  async function syncFromHermes(
    companyId: string,
    syncOpts: SyncOptions = {},
  ): Promise<{ added: number; updated: number; removed: number }> {
    let remote: HermesAgentInfo[] = [];
    try {
      remote = await client.listAgents();
    } catch (err) {
      logger.warn({ err, companyId }, "[hermes] syncFromHermes: listAgents failed");
      return { added: 0, updated: 0, removed: 0 };
    }
    const existing = await list(companyId);
    const existingById = new Map(existing.map((r) => [r.hermesAgentId, r]));
    let added = 0;
    let updated = 0;

    for (const info of remote) {
      const prev = existingById.get(info.id);
      if (prev) {
        await updateInfo(companyId, prev.id, info);
        updated += 1;
      } else {
        await register(companyId, info, {
          memberRegistrar: syncOpts.memberRegistrar,
        });
        added += 1;
      }
    }
    // We do NOT auto-remove members that disappear from upstream; admins
    // should explicitly unregister to avoid losing channel memberships.
    return { added, updated, removed: 0 };
  }

  return {
    list,
    register,
    unregister,
    updateInfo,
    getByHermesId,
    syncFromHermes,
  };
}
