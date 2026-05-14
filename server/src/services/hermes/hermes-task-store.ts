/**
 * Hermes task persistence layer.
 *
 * Tasks are stored as `businessEntities` rows:
 *
 *   moduleKey:   "hermes"
 *   entityType:  "task"
 *   code:        Hermes-issued taskId (unique per company)
 *   data:        full {@link HermesTaskRecord} payload
 */

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type { HermesTaskResponse } from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HermesTaskRecordStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface HermesTaskRecord {
  id: string;
  companyId: string;
  hermesAgentId: string;
  prompt: string;
  promptAr?: string;
  callbackChannel?: string;
  callbackThreadRootId?: string;
  status: HermesTaskRecordStatus;
  output?: string;
  outputAr?: string;
  createdAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskInput {
  hermesAgentId: string;
  prompt: string;
  promptAr?: string;
  callbackChannel?: string;
  callbackThreadRootId?: string;
  metadata?: Record<string, unknown>;
}

export interface ListTasksOptions {
  agentId?: string;
  status?: HermesTaskRecordStatus | string;
  limit?: number;
}

export interface HermesTaskStore {
  create(companyId: string, input: CreateTaskInput): Promise<HermesTaskRecord>;
  list(companyId: string, opts?: ListTasksOptions): Promise<HermesTaskRecord[]>;
  get(companyId: string, taskId: string): Promise<HermesTaskRecord | null>;
  /**
   * Find a task by its upstream Hermes taskId. Optionally scoped to a
   * specific company — when omitted the first matching row is returned.
   */
  findByTaskId(
    taskId: string,
    companyId?: string,
  ): Promise<HermesTaskRecord | null>;
  updateStatus(
    companyId: string,
    taskId: string,
    status: HermesTaskRecordStatus,
  ): Promise<HermesTaskRecord | null>;
  applyResponse(
    companyId: string,
    taskId: string,
    response: HermesTaskResponse,
  ): Promise<HermesTaskRecord | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToTask(
  row: typeof businessEntities.$inferSelect,
): HermesTaskRecord {
  const data = (row.data ?? {}) as Partial<HermesTaskRecord>;
  return {
    id: row.id,
    companyId: row.companyId,
    hermesAgentId: data.hermesAgentId ?? "",
    prompt: data.prompt ?? "",
    promptAr: data.promptAr,
    callbackChannel: data.callbackChannel,
    callbackThreadRootId: data.callbackThreadRootId,
    status:
      (row.status as HermesTaskRecordStatus) ?? data.status ?? "pending",
    output: data.output,
    outputAr: data.outputAr,
    createdAt: row.createdAt
      ? new Date(row.createdAt).toISOString()
      : data.createdAt ?? new Date().toISOString(),
    completedAt: data.completedAt,
    metadata: data.metadata,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHermesTaskStore(db: Db): HermesTaskStore {
  async function create(
    companyId: string,
    input: CreateTaskInput,
  ): Promise<HermesTaskRecord> {
    const id = randomUUID();
    const now = new Date();
    const data: HermesTaskRecord = {
      id,
      companyId,
      hermesAgentId: input.hermesAgentId,
      prompt: input.prompt,
      promptAr: input.promptAr,
      callbackChannel: input.callbackChannel,
      callbackThreadRootId: input.callbackThreadRootId,
      status: "pending",
      createdAt: now.toISOString(),
      metadata: input.metadata,
    };
    const [row] = await db
      .insert(businessEntities)
      .values({
        id,
        companyId,
        moduleKey: "hermes",
        entityType: "task",
        code: id,
        name: input.prompt.slice(0, 200),
        status: "pending",
        data,
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rowToTask(row);
  }

  async function list(
    companyId: string,
    opts: ListTasksOptions = {},
  ): Promise<HermesTaskRecord[]> {
    const conditions = [
      eq(businessEntities.companyId, companyId),
      eq(businessEntities.moduleKey, "hermes"),
      eq(businessEntities.entityType, "task"),
    ];
    if (opts.status) {
      conditions.push(eq(businessEntities.status, opts.status));
    }
    const rows = await db
      .select()
      .from(businessEntities)
      .where(and(...conditions))
      .orderBy(desc(businessEntities.createdAt))
      .limit(opts.limit ?? 100);
    const tasks = rows.map(rowToTask);
    if (opts.agentId) {
      return tasks.filter((t) => t.hermesAgentId === opts.agentId);
    }
    return tasks;
  }

  async function get(
    companyId: string,
    taskId: string,
  ): Promise<HermesTaskRecord | null> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, taskId),
          eq(businessEntities.moduleKey, "hermes"),
          eq(businessEntities.entityType, "task"),
        ),
      )
      .limit(1);
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async function findByTaskId(
    taskId: string,
    companyId?: string,
  ): Promise<HermesTaskRecord | null> {
    // Tasks use `id === code`; query both forms to be safe.
    const conditions = [
      eq(businessEntities.moduleKey, "hermes"),
      eq(businessEntities.entityType, "task"),
      eq(businessEntities.id, taskId),
    ];
    if (companyId) {
      conditions.push(eq(businessEntities.companyId, companyId));
    }
    const rows = await db
      .select()
      .from(businessEntities)
      .where(and(...conditions))
      .limit(1);
    if (rows[0]) return rowToTask(rows[0]);

    const codeConditions = [
      eq(businessEntities.moduleKey, "hermes"),
      eq(businessEntities.entityType, "task"),
      eq(businessEntities.code, taskId),
    ];
    if (companyId) {
      codeConditions.push(eq(businessEntities.companyId, companyId));
    }
    const codeRows = await db
      .select()
      .from(businessEntities)
      .where(and(...codeConditions))
      .limit(1);
    return codeRows[0] ? rowToTask(codeRows[0]) : null;
  }

  async function updateStatus(
    companyId: string,
    taskId: string,
    status: HermesTaskRecordStatus,
  ): Promise<HermesTaskRecord | null> {
    const current = await get(companyId, taskId);
    if (!current) return null;
    const nextData: HermesTaskRecord = { ...current, status };
    const [row] = await db
      .update(businessEntities)
      .set({
        status,
        data: nextData,
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, current.id))
      .returning();
    return rowToTask(row);
  }

  async function applyResponse(
    companyId: string,
    taskId: string,
    response: HermesTaskResponse,
  ): Promise<HermesTaskRecord | null> {
    const current = await get(companyId, taskId);
    if (!current) return null;
    const nextStatus: HermesTaskRecordStatus =
      response.status === "completed"
        ? "completed"
        : response.status === "failed"
          ? "failed"
          : response.status === "in_progress"
            ? "in_progress"
            : current.status;
    const nextData: HermesTaskRecord = {
      ...current,
      status: nextStatus,
      output: response.output ?? current.output,
      outputAr: response.outputAr ?? current.outputAr,
      completedAt:
        response.completedAt ??
        (nextStatus === "completed" ? new Date().toISOString() : current.completedAt),
      metadata: { ...(current.metadata ?? {}), ...(response.metadata ?? {}) },
    };
    const [row] = await db
      .update(businessEntities)
      .set({
        status: nextStatus,
        data: nextData,
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, current.id))
      .returning();
    return rowToTask(row);
  }

  return { create, list, get, findByTaskId, updateStatus, applyResponse };
}
