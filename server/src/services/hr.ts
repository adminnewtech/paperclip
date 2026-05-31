import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bosLeaveRequest, bosPayrollRun, bosPayslip } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no DB).
// ---------------------------------------------------------------------------

/** Net pay (minor units) = gross - deductions, floored at zero. */
export function computePayslip(grossMinor: number, deductionsMinor: number): number {
  return Math.max(0, grossMinor - deductionsMinor);
}

/**
 * Inclusive count of calendar days between start and end (both ends counted).
 * A single-day leave (start === end) is 1 day. Returns at least 1.
 */
export function leaveDays(
  start: Date | string,
  end: Date | string,
): number {
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const startUtc = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const endUtc = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  );
  const diff = Math.floor((endUtc - startUtc) / MS_PER_DAY) + 1;
  return diff < 1 ? 1 : diff;
}

/** Sum payslip totals into payroll-run aggregate figures. */
export interface PayslipTotals {
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
}

export function sumPayslips(
  payslips: Array<{ grossMinor: number; deductionsMinor: number; netMinor: number }>,
): PayslipTotals {
  return payslips.reduce<PayslipTotals>(
    (acc, p) => ({
      grossMinor: acc.grossMinor + p.grossMinor,
      deductionsMinor: acc.deductionsMinor + p.deductionsMinor,
      netMinor: acc.netMinor + p.netMinor,
    }),
    { grossMinor: 0, deductionsMinor: 0, netMinor: 0 },
  );
}

// ---------------------------------------------------------------------------
// DB operations.
// ---------------------------------------------------------------------------

type LeaveRequestRow = typeof bosLeaveRequest.$inferSelect;
type PayrollRunRow = typeof bosPayrollRun.$inferSelect;

export interface ApproveLeaveParams {
  companyId: string;
  leaveId: string;
  approverUserId?: string | null;
}

/**
 * Approve a leave request: flip status pending -> approved. Atomic load +
 * assertion + update. (Balance accounting is left as a future enhancement;
 * here we simply mark the request approved.)
 */
export async function approveLeave(
  db: Db,
  params: ApproveLeaveParams,
): Promise<LeaveRequestRow> {
  const { companyId, leaveId, approverUserId } = params;

  return db.transaction(async (tx) => {
    const [leave] = await tx
      .select()
      .from(bosLeaveRequest)
      .where(eq(bosLeaveRequest.id, leaveId));
    if (!leave || leave.companyId !== companyId) {
      throw new Error("Leave request not found");
    }
    if (leave.status === "approved") {
      throw new Error("Leave request is already approved");
    }

    const [updated] = await tx
      .update(bosLeaveRequest)
      .set({
        status: "approved",
        approverUserId: approverUserId ?? leave.approverUserId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(bosLeaveRequest.id, leave.id))
      .returning();
    if (!updated) {
      throw new Error("Failed to approve leave request");
    }
    return updated;
  });
}

export interface ProcessPayrollParams {
  companyId: string;
  runId: string;
}

/**
 * Process a payroll run. In a single transaction: load the run, sum its
 * payslips, write the aggregate gross/deductions/net totals back onto the run,
 * and flip status draft -> processed. Asserts gross - deductions === net so the
 * money figures stay internally consistent.
 */
export async function processPayroll(
  db: Db,
  params: ProcessPayrollParams,
): Promise<PayrollRunRow> {
  const { companyId, runId } = params;

  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(bosPayrollRun)
      .where(eq(bosPayrollRun.id, runId));
    if (!run || run.companyId !== companyId) {
      throw new Error("Payroll run not found");
    }
    if (run.status === "processed" || run.status === "paid") {
      throw new Error("Payroll run is already processed");
    }

    const slips = await tx
      .select()
      .from(bosPayslip)
      .where(
        and(
          eq(bosPayslip.payrollRunId, runId),
          eq(bosPayslip.companyId, companyId),
        ),
      );

    const totals = sumPayslips(
      slips.map((s) => ({
        grossMinor: s.grossMinor,
        deductionsMinor: s.deductionsMinor,
        netMinor: s.netMinor,
      })),
    );

    if (totals.grossMinor - totals.deductionsMinor !== totals.netMinor) {
      throw new Error("Payroll totals are inconsistent (gross - deductions != net)");
    }

    const [updated] = await tx
      .update(bosPayrollRun)
      .set({
        grossMinor: totals.grossMinor,
        deductionsMinor: totals.deductionsMinor,
        netMinor: totals.netMinor,
        status: "processed",
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bosPayrollRun.id, run.id))
      .returning();
    if (!updated) {
      throw new Error("Failed to process payroll run");
    }
    return updated;
  });
}
