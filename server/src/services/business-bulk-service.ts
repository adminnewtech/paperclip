/**
 * Bulk operations against `business_entities`.
 *
 * The service is intentionally tenant-scoped: every call requires a
 * `companyId`, and the underlying SQL filters on that column. The caller
 * (typically a route handler) is responsible for verifying that the
 * authenticated actor has access to that company first.
 *
 * All operations are best-effort: we process up to `MAX_BULK_ITEMS` entities
 * per call, attempt each individually, and continue on per-row failures so
 * a single bad ID does not poison the whole batch. The returned summary
 * collects per-entity errors so the UI can surface them.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { logActivity } from "./activity-log.js";
import {
  rowsToCsv,
  formatCentsForCsv,
  formatDateForCsv,
  type CsvColumn,
} from "./business-excel-service.js";

export const MAX_BULK_ITEMS = 1000;

export interface BulkUpdateInput {
  entityIds: string[];
  updates: Partial<{
    status: string;
    tags: string[];
    addTags: string[];
    removeTags: string[];
    ownerUserId: string;
    customDataMerge: Record<string, unknown>;
  }>;
}

export interface BulkDeleteInput {
  entityIds: string[];
}

export interface BulkOperationResult {
  totalCount: number;
  successCount: number;
  failedCount: number;
  errors: Array<{ entityId: string; error: string }>;
}

export interface BusinessBulkService {
  bulkUpdate(
    companyId: string,
    moduleKey: string,
    entityType: string,
    input: BulkUpdateInput,
    actorUserId?: string,
  ): Promise<BulkOperationResult>;
  bulkDelete(
    companyId: string,
    moduleKey: string,
    entityType: string,
    input: BulkDeleteInput,
    actorUserId?: string,
  ): Promise<BulkOperationResult>;
  bulkExport(
    companyId: string,
    moduleKey: string,
    entityType: string,
    entityIds: string[],
  ): Promise<{ csv: string }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function createBusinessBulkService(db: Db): BusinessBulkService {
  function trimIds(entityIds: readonly string[]): string[] {
    return Array.from(new Set(entityIds.filter((id) => typeof id === "string" && id.length > 0))).slice(
      0,
      MAX_BULK_ITEMS,
    );
  }

  async function bulkUpdate(
    companyId: string,
    moduleKey: string,
    entityType: string,
    input: BulkUpdateInput,
    actorUserId?: string,
  ): Promise<BulkOperationResult> {
    const ids = trimIds(input.entityIds);
    const result: BulkOperationResult = {
      totalCount: ids.length,
      successCount: 0,
      failedCount: 0,
      errors: [],
    };
    if (ids.length === 0) return result;

    // Pre-load existing rows so we can compute tag/data merges per row.
    const existing = await db
      .select({
        id: businessEntities.id,
        tags: businessEntities.tags,
        data: businessEntities.data,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, moduleKey),
          eq(businessEntities.entityType, entityType),
          inArray(businessEntities.id, ids),
        ),
      );
    const existingById = new Map(existing.map((r) => [r.id, r]));

    const now = new Date();
    for (const id of ids) {
      const row = existingById.get(id);
      if (!row) {
        result.failedCount += 1;
        result.errors.push({ entityId: id, error: "Not found" });
        continue;
      }
      try {
        const currentTags = asStringArray(row.tags);
        let nextTags: string[] | undefined;
        if (input.updates.tags !== undefined) {
          nextTags = Array.from(new Set(input.updates.tags));
        } else if (input.updates.addTags || input.updates.removeTags) {
          const set = new Set(currentTags);
          for (const t of input.updates.addTags ?? []) set.add(t);
          for (const t of input.updates.removeTags ?? []) set.delete(t);
          nextTags = Array.from(set);
        }

        let nextData: Record<string, unknown> | undefined;
        if (input.updates.customDataMerge && Object.keys(input.updates.customDataMerge).length > 0) {
          nextData = { ...asRecord(row.data), ...input.updates.customDataMerge };
        }

        const setClause: Record<string, unknown> = { updatedAt: now };
        if (input.updates.status !== undefined) setClause["status"] = input.updates.status;
        if (input.updates.ownerUserId !== undefined) {
          setClause["ownerUserId"] = input.updates.ownerUserId;
        }
        if (nextTags !== undefined) setClause["tags"] = nextTags;
        if (nextData !== undefined) setClause["data"] = nextData;
        if (actorUserId) setClause["updatedByUserId"] = actorUserId;

        const updated = await db
          .update(businessEntities)
          .set(setClause)
          .where(
            and(
              eq(businessEntities.id, id),
              eq(businessEntities.companyId, companyId),
              eq(businessEntities.moduleKey, moduleKey),
              eq(businessEntities.entityType, entityType),
            ),
          )
          .returning({ id: businessEntities.id });
        if (updated.length === 0) {
          result.failedCount += 1;
          result.errors.push({ entityId: id, error: "Update returned no row" });
          continue;
        }
        result.successCount += 1;
      } catch (err) {
        result.failedCount += 1;
        result.errors.push({
          entityId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (result.successCount > 0) {
      await logActivity(db, {
        companyId,
        actorType: actorUserId ? "user" : "system",
        actorId: actorUserId ?? "system",
        agentId: null,
        runId: null,
        action: "business.entities_bulk_updated",
        entityType: "business_entity",
        entityId: companyId,
        details: {
          moduleKey,
          entityType,
          totalCount: result.totalCount,
          successCount: result.successCount,
          failedCount: result.failedCount,
        },
      }).catch(() => {});
    }

    return result;
  }

  async function bulkDelete(
    companyId: string,
    moduleKey: string,
    entityType: string,
    input: BulkDeleteInput,
    actorUserId?: string,
  ): Promise<BulkOperationResult> {
    const ids = trimIds(input.entityIds);
    const result: BulkOperationResult = {
      totalCount: ids.length,
      successCount: 0,
      failedCount: 0,
      errors: [],
    };
    if (ids.length === 0) return result;

    for (const id of ids) {
      try {
        const deleted = await db
          .delete(businessEntities)
          .where(
            and(
              eq(businessEntities.id, id),
              eq(businessEntities.companyId, companyId),
              eq(businessEntities.moduleKey, moduleKey),
              eq(businessEntities.entityType, entityType),
            ),
          )
          .returning({ id: businessEntities.id });
        if (deleted.length === 0) {
          result.failedCount += 1;
          result.errors.push({ entityId: id, error: "Not found" });
          continue;
        }
        result.successCount += 1;
      } catch (err) {
        result.failedCount += 1;
        result.errors.push({
          entityId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (result.successCount > 0) {
      await logActivity(db, {
        companyId,
        actorType: actorUserId ? "user" : "system",
        actorId: actorUserId ?? "system",
        agentId: null,
        runId: null,
        action: "business.entities_bulk_deleted",
        entityType: "business_entity",
        entityId: companyId,
        details: {
          moduleKey,
          entityType,
          totalCount: result.totalCount,
          successCount: result.successCount,
          failedCount: result.failedCount,
        },
      }).catch(() => {});
    }

    return result;
  }

  async function bulkExport(
    companyId: string,
    moduleKey: string,
    entityType: string,
    entityIds: string[],
  ): Promise<{ csv: string }> {
    const ids = trimIds(entityIds);
    if (ids.length === 0) return { csv: "" };

    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, moduleKey),
          eq(businessEntities.entityType, entityType),
          inArray(businessEntities.id, ids),
        ),
      );

    interface Row {
      id: string;
      code: string | null;
      name: string | null;
      status: string;
      ownerUserId: string | null;
      amountCents: number | null;
      currency: string | null;
      data: unknown;
      tags: unknown;
      createdAt: Date;
      updatedAt: Date;
    }

    const columns: CsvColumn<Row>[] = [
      { header: "ID", value: (r) => r.id },
      { header: "Code", value: (r) => r.code ?? "" },
      { header: "Name", value: (r) => r.name ?? "" },
      { header: "Status", value: (r) => r.status },
      { header: "Owner", value: (r) => r.ownerUserId ?? "" },
      { header: "Amount", value: (r) => formatCentsForCsv(r.amountCents) },
      { header: "Currency", value: (r) => r.currency ?? "" },
      {
        header: "Tags",
        value: (r) => (Array.isArray(r.tags) ? (r.tags as string[]).join(", ") : ""),
      },
      { header: "Created", value: (r) => formatDateForCsv(r.createdAt) },
      { header: "Updated", value: (r) => formatDateForCsv(r.updatedAt) },
    ];

    return { csv: rowsToCsv(rows as Row[], columns) };
  }

  return { bulkUpdate, bulkDelete, bulkExport };
}
