/**
 * Business audit log service.
 *
 * Entries are stored as `businessEntities` rows with the synthetic
 * `moduleKey="audit"` / `entityType="log"` partition. Inserts are
 * append-only; the routes never expose update or delete.
 *
 * The `log()` method is fire-and-forget: it returns a promise but is
 * intentionally awaited only by tests. Mutation routes call `.catch()`
 * on the returned promise so a failed audit insert never breaks the
 * primary write.
 */

import { and, desc, eq, gte, lte, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "view"
  | "export"
  | "login"
  | "logout"
  | "permission_change"
  | "role_change";

export type AuditActorType = "user" | "agent" | "system" | "api";

export interface AuditDiff {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changedFields?: string[];
}

export interface AuditEntry {
  id: string;
  companyId: string;
  timestamp: string;
  actorUserId?: string;
  actorAgentId?: string;
  actorType: AuditActorType;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  targetCode?: string;
  moduleKey?: string;
  entityType?: string;
  ipAddress?: string;
  userAgent?: string;
  diff?: AuditDiff;
  metadata?: Record<string, unknown>;
}

export type AuditLogInput = Omit<AuditEntry, "id" | "timestamp">;

export interface ListLogsOptions {
  from?: string;
  to?: string;
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  moduleKey?: string;
  limit?: number;
  cursor?: string;
}

export interface BusinessAuditService {
  log(entry: AuditLogInput): Promise<void>;
  listLogs(
    companyId: string,
    opts?: ListLogsOptions,
  ): Promise<{ entries: AuditEntry[]; nextCursor?: string }>;
  getEntityHistory(companyId: string, entityId: string): Promise<AuditEntry[]>;
  exportLogs(
    companyId: string,
    opts: { from: string; to: string },
  ): Promise<string>;
}

const AUDIT_MODULE_KEY = "audit";
const AUDIT_ENTITY_TYPE = "log";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const EXPORT_HARD_LIMIT = 50_000;

interface AuditRow {
  id: string;
  companyId: string;
  createdAt: Date | string;
  data: Record<string, unknown>;
  ownerUserId: string | null;
  status: string;
  code: string | null;
  name: string | null;
}

function rowToEntry(row: AuditRow): AuditEntry {
  const data = (row.data ?? {}) as Partial<AuditEntry> & {
    timestamp?: string;
  };
  const ts =
    typeof row.createdAt === "string"
      ? row.createdAt
      : row.createdAt.toISOString();
  return {
    id: row.id,
    companyId: row.companyId,
    timestamp: data.timestamp ?? ts,
    actorUserId: data.actorUserId,
    actorAgentId: data.actorAgentId,
    actorType: (data.actorType as AuditActorType) ?? "system",
    action: (data.action as AuditAction) ?? "view",
    targetType: data.targetType ?? "businessEntity",
    targetId: data.targetId,
    targetCode: data.targetCode,
    moduleKey: data.moduleKey,
    entityType: data.entityType,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    diff: data.diff,
    metadata: data.metadata,
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function createBusinessAuditService(db: Db): BusinessAuditService {
  async function insertLog(entry: AuditLogInput): Promise<void> {
    const now = new Date();
    const payload = {
      timestamp: now.toISOString(),
      actorUserId: entry.actorUserId,
      actorAgentId: entry.actorAgentId,
      actorType: entry.actorType,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetCode: entry.targetCode,
      moduleKey: entry.moduleKey,
      entityType: entry.entityType,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      diff: entry.diff,
      metadata: entry.metadata,
    };

    await db.insert(businessEntities).values({
      companyId: entry.companyId,
      moduleKey: AUDIT_MODULE_KEY,
      entityType: AUDIT_ENTITY_TYPE,
      // We stash the target-entity id on `parentId` so entity-history queries
      // can be a fast indexed lookup instead of jsonb scans. parentId is a uuid
      // column so we only set it when the target id is a valid uuid.
      parentId: isUuid(entry.targetId) ? (entry.targetId ?? null) : null,
      code: entry.action,
      name: entry.targetCode ?? entry.targetId ?? null,
      status: entry.actorType,
      ownerUserId: entry.actorUserId ?? entry.actorAgentId ?? null,
      data: payload as Record<string, unknown>,
      tags: [entry.action, entry.moduleKey ?? "", entry.targetType].filter(
        (t) => t.length > 0,
      ),
      createdByUserId: entry.actorUserId ?? entry.actorAgentId ?? null,
      updatedByUserId: entry.actorUserId ?? entry.actorAgentId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    async log(entry) {
      // Fire-and-forget: schedule on the next tick so a slow insert can never
      // delay the primary HTTP response. Errors are swallowed and logged so
      // mutation paths cannot crash because of an audit failure.
      setImmediate(() => {
        insertLog(entry).catch((err) => {
          logger.warn(
            {
              err,
              companyId: entry.companyId,
              action: entry.action,
              targetType: entry.targetType,
            },
            "business audit log insert failed (swallowed)",
          );
        });
      });
    },

    async listLogs(companyId, opts) {
      const limit = Math.min(
        Math.max(opts?.limit ?? DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      );
      const conditions = [
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, AUDIT_MODULE_KEY),
        eq(businessEntities.entityType, AUDIT_ENTITY_TYPE),
      ];
      if (opts?.from) conditions.push(gte(businessEntities.createdAt, new Date(opts.from)));
      if (opts?.to) conditions.push(lte(businessEntities.createdAt, new Date(opts.to)));
      if (opts?.cursor) {
        conditions.push(lt(businessEntities.createdAt, new Date(opts.cursor)));
      }
      if (opts?.action) {
        conditions.push(eq(businessEntities.code, opts.action));
      }
      if (opts?.targetId && isUuid(opts.targetId)) {
        conditions.push(eq(businessEntities.parentId, opts.targetId));
      }
      if (opts?.actorUserId) {
        conditions.push(eq(businessEntities.ownerUserId, opts.actorUserId));
      }
      if (opts?.moduleKey) {
        conditions.push(
          sql`${businessEntities.data}->>'moduleKey' = ${opts.moduleKey}`,
        );
      }
      if (opts?.targetType) {
        conditions.push(
          sql`${businessEntities.data}->>'targetType' = ${opts.targetType}`,
        );
      }

      const rows = await db
        .select({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          createdAt: businessEntities.createdAt,
          data: businessEntities.data,
          ownerUserId: businessEntities.ownerUserId,
          status: businessEntities.status,
          code: businessEntities.code,
          name: businessEntities.name,
        })
        .from(businessEntities)
        .where(and(...conditions))
        .orderBy(desc(businessEntities.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const entries = sliced.map((r) =>
        rowToEntry({
          ...r,
          data: (r.data ?? {}) as Record<string, unknown>,
        }),
      );
      const nextCursor = hasMore
        ? typeof sliced[sliced.length - 1]!.createdAt === "string"
          ? (sliced[sliced.length - 1]!.createdAt as string)
          : (sliced[sliced.length - 1]!.createdAt as Date).toISOString()
        : undefined;
      return { entries, nextCursor };
    },

    async getEntityHistory(companyId, entityId) {
      if (!isUuid(entityId)) return [];
      const rows = await db
        .select({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          createdAt: businessEntities.createdAt,
          data: businessEntities.data,
          ownerUserId: businessEntities.ownerUserId,
          status: businessEntities.status,
          code: businessEntities.code,
          name: businessEntities.name,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, AUDIT_MODULE_KEY),
            eq(businessEntities.entityType, AUDIT_ENTITY_TYPE),
            eq(businessEntities.parentId, entityId),
          ),
        )
        .orderBy(desc(businessEntities.createdAt))
        .limit(500);
      return rows.map((r) =>
        rowToEntry({
          ...r,
          data: (r.data ?? {}) as Record<string, unknown>,
        }),
      );
    },

    async exportLogs(companyId, opts) {
      const rows = await db
        .select({
          id: businessEntities.id,
          companyId: businessEntities.companyId,
          createdAt: businessEntities.createdAt,
          data: businessEntities.data,
          ownerUserId: businessEntities.ownerUserId,
          status: businessEntities.status,
          code: businessEntities.code,
          name: businessEntities.name,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, AUDIT_MODULE_KEY),
            eq(businessEntities.entityType, AUDIT_ENTITY_TYPE),
            gte(businessEntities.createdAt, new Date(opts.from)),
            lte(businessEntities.createdAt, new Date(opts.to)),
          ),
        )
        .orderBy(desc(businessEntities.createdAt))
        .limit(EXPORT_HARD_LIMIT);

      const header = [
        "timestamp",
        "id",
        "actorType",
        "actorUserId",
        "actorAgentId",
        "action",
        "targetType",
        "targetId",
        "targetCode",
        "moduleKey",
        "entityType",
        "ipAddress",
        "userAgent",
        "changedFields",
      ].join(",");

      const lines = [header];
      for (const row of rows) {
        const entry = rowToEntry({
          ...row,
          data: (row.data ?? {}) as Record<string, unknown>,
        });
        lines.push(
          [
            entry.timestamp,
            entry.id,
            entry.actorType,
            entry.actorUserId ?? "",
            entry.actorAgentId ?? "",
            entry.action,
            entry.targetType,
            entry.targetId ?? "",
            entry.targetCode ?? "",
            entry.moduleKey ?? "",
            entry.entityType ?? "",
            entry.ipAddress ?? "",
            entry.userAgent ?? "",
            (entry.diff?.changedFields ?? []).join("|"),
          ]
            .map(csvCell)
            .join(","),
        );
      }
      return lines.join("\n");
    },
  };
}

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Compute a diff between two entity snapshots. Returns the changed field keys
 * (top-level on the entity row plus nested differences inside `data`).
 */
export function computeEntityDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): AuditDiff {
  const changedFields: string[] = [];
  if (!before && !after) return { changedFields };
  const a = before ?? {};
  const b = after ?? {};

  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === "updatedAt" || key === "createdAt") continue;
    if (!shallowEqual(a[key], b[key])) {
      changedFields.push(key);
    }
  }
  return { before: a, after: b, changedFields };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
