import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bosTask, bosTimesheet } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no DB).
// ---------------------------------------------------------------------------

export interface TaskProgressRow {
  status: string | null;
}

/**
 * Project completion as a whole-number percentage (0–100): the share of tasks
 * whose status is "done". Empty task lists yield 0.
 */
export function projectProgress(tasks: TaskProgressRow[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => t.status === "done").length;
  return Math.round((done / tasks.length) * 100);
}

export interface BillableTimesheetRow {
  billable?: boolean | null;
  hours?: number | null;
  rateMinor?: number | null;
}

/**
 * Sum the billable amount (in minor units) across timesheet entries:
 * Σ hours × rateMinor for entries flagged billable. Non-billable entries are
 * ignored.
 */
export function billableAmount(timesheets: BillableTimesheetRow[]): number {
  return timesheets.reduce((sum, t) => {
    if (!t.billable) return sum;
    const hours = t.hours ?? 0;
    const rate = t.rateMinor ?? 0;
    return sum + hours * rate;
  }, 0);
}

// ---------------------------------------------------------------------------
// DB operations.
// ---------------------------------------------------------------------------

type TaskRow = typeof bosTask.$inferSelect;

export interface CompleteTaskParams {
  companyId: string;
  taskId: string;
}

/** Mark a task done (company-scoped). Throws when the task is not found. */
export async function completeTask(
  db: Db,
  params: CompleteTaskParams,
): Promise<TaskRow> {
  const { companyId, taskId } = params;
  const [updated] = await db
    .update(bosTask)
    .set({ status: "done", updatedAt: new Date() })
    .where(and(eq(bosTask.id, taskId), eq(bosTask.companyId, companyId)))
    .returning();
  if (!updated) {
    throw new Error("Task not found");
  }
  return updated;
}

export interface BillProjectParams {
  companyId: string;
  projectId: string;
}

export interface BillProjectResult {
  projectId: string;
  billableMinor: number;
  entryCount: number;
}

/**
 * Compute the invoice-ready billable total for a project from its billable
 * timesheet entries. This only computes and returns — it does NOT post to
 * finance or create an invoice (that crossing is intentionally left to the
 * caller).
 */
export async function billProject(
  db: Db,
  params: BillProjectParams,
): Promise<BillProjectResult> {
  const { companyId, projectId } = params;
  const rows = await db
    .select({
      billable: bosTimesheet.billable,
      hours: bosTimesheet.hours,
      rateMinor: bosTimesheet.rateMinor,
    })
    .from(bosTimesheet)
    .where(
      and(
        eq(bosTimesheet.companyId, companyId),
        eq(bosTimesheet.projectId, projectId),
      ),
    );

  const billableRows = rows.filter((r) => r.billable);
  return {
    projectId,
    billableMinor: billableAmount(rows),
    entryCount: billableRows.length,
  };
}
