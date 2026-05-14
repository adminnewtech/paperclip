/**
 * Per-member unread tracking.
 *
 * Each row in `business_entities` represents one (channelId, memberId) pair:
 *   moduleKey:   "workspace"
 *   entityType:  "read_state"
 *   code:        `${channelId}::${memberId}`
 *
 * Unread counts are computed at read-time by counting messages newer than the
 * stored `lastReadMessageId`'s `createdAt`. This keeps writes cheap (only on
 * `markRead`) and avoids the consistency landmines of maintaining a per-user
 * counter under contention.
 */

import { and, count, eq, gt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  WORKSPACE_ENTITY_TYPES,
  WORKSPACE_MODULE_KEY,
} from "@paperclipai/shared";
import type { ChannelsService } from "./channels-service.js";

export interface ReadStateService {
  getUnreadCounts(
    companyId: string,
    memberId: string,
  ): Promise<Record<string, number>>;
  markRead(
    companyId: string,
    memberId: string,
    channelId: string,
    lastReadMessageId: string,
  ): Promise<void>;
  markAllRead(companyId: string, memberId: string): Promise<void>;
}

interface ReadStateData {
  channelId: string;
  memberId: string;
  lastReadMessageId?: string;
  lastReadAt: string;
}

function readStateCode(channelId: string, memberId: string): string {
  return `${channelId}::${memberId}`;
}

export function createReadStateService(
  db: Db,
  channels: ChannelsService,
): ReadStateService {
  return {
    async getUnreadCounts(companyId, memberId) {
      // Fetch all read-state rows for the member; build a map of
      // channelId -> lastReadAt timestamp.
      const stateRows = await db
        .select({
          data: businessEntities.data,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
            eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.readState),
          ),
        );
      const lastReadByChannel = new Map<string, Date>();
      for (const row of stateRows) {
        const data = (row.data ?? {}) as Partial<ReadStateData>;
        if (data.memberId !== memberId || !data.channelId) continue;
        if (data.lastReadAt) {
          lastReadByChannel.set(data.channelId, new Date(data.lastReadAt));
        }
      }

      // List channels the member can see — public/system + private with
      // membership. Count messages newer than `lastReadAt` per channel.
      const visible = await channels.list(companyId, { memberId });
      const result: Record<string, number> = {};
      for (const ch of visible) {
        const since = lastReadByChannel.get(ch.id);
        if (!since) {
          // No read state yet — every message is unread.
          const [row] = await db
            .select({ value: count() })
            .from(businessEntities)
            .where(
              and(
                eq(businessEntities.companyId, companyId),
                eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
                eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.message),
                eq(businessEntities.parentId, ch.id),
              ),
            );
          result[ch.id] = Number(row?.value ?? 0);
          continue;
        }
        const [row] = await db
          .select({ value: count() })
          .from(businessEntities)
          .where(
            and(
              eq(businessEntities.companyId, companyId),
              eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
              eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.message),
              eq(businessEntities.parentId, ch.id),
              gt(businessEntities.createdAt, since),
            ),
          );
        result[ch.id] = Number(row?.value ?? 0);
      }
      return result;
    },

    async markRead(companyId, memberId, channelId, lastReadMessageId) {
      const now = new Date();
      const code = readStateCode(channelId, memberId);
      const data: ReadStateData = {
        channelId,
        memberId,
        lastReadMessageId,
        lastReadAt: now.toISOString(),
      };
      const [existing] = await db
        .select({ id: businessEntities.id })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
            eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.readState),
            eq(businessEntities.code, code),
          ),
        );
      if (existing) {
        await db
          .update(businessEntities)
          .set({ data, updatedAt: now })
          .where(eq(businessEntities.id, existing.id));
        return;
      }
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: WORKSPACE_MODULE_KEY,
        entityType: WORKSPACE_ENTITY_TYPES.readState,
        code,
        status: "active",
        data,
        tags: [],
        createdAt: now,
        updatedAt: now,
      });
    },

    async markAllRead(companyId, memberId) {
      const now = new Date();
      const visible = await channels.list(companyId, { memberId });
      for (const ch of visible) {
        const code = readStateCode(ch.id, memberId);
        const data: ReadStateData = {
          channelId: ch.id,
          memberId,
          lastReadAt: now.toISOString(),
        };
        const [existing] = await db
          .select({ id: businessEntities.id })
          .from(businessEntities)
          .where(
            and(
              eq(businessEntities.companyId, companyId),
              eq(businessEntities.moduleKey, WORKSPACE_MODULE_KEY),
              eq(businessEntities.entityType, WORKSPACE_ENTITY_TYPES.readState),
              eq(businessEntities.code, code),
            ),
          );
        if (existing) {
          await db
            .update(businessEntities)
            .set({ data, updatedAt: now })
            .where(eq(businessEntities.id, existing.id));
        } else {
          await db.insert(businessEntities).values({
            companyId,
            moduleKey: WORKSPACE_MODULE_KEY,
            entityType: WORKSPACE_ENTITY_TYPES.readState,
            code,
            status: "active",
            data,
            tags: [],
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    },
  };
}
