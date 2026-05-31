import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosEmployee,
  bosAttendance,
  bosLeaveRequest,
  bosLeavePolicy,
  bosPayrollRun,
  bosPayslip,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { approveLeave, computePayslip, leaveDays, processPayroll } from "../services/hr.js";

// ---------------------------------------------------------------------------
// Validation schemas.
// ---------------------------------------------------------------------------
const attendanceCreateSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().datetime().optional().nullable(),
  checkIn: z.string().datetime().optional().nullable(),
  checkOut: z.string().datetime().optional().nullable(),
  hours: z.number().int().nonnegative().optional().default(0),
  status: z
    .enum(["present", "absent", "leave", "holiday"])
    .optional()
    .default("present"),
});

const leaveRequestCreateSchema = z.object({
  employeeId: z.string().uuid(),
  kind: z.enum(["annual", "sick", "unpaid", "other"]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  days: z.number().int().positive().optional(),
  reason: z.string().trim().max(2000).optional().nullable(),
});

const leavePolicyCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  kind: z.enum(["annual", "sick", "unpaid", "other"]),
  daysPerYear: z.number().int().nonnegative().optional().default(30),
});

const payslipInputSchema = z.object({
  employeeId: z.string().uuid().optional().nullable(),
  employeeName: z.string().trim().max(500).optional().nullable(),
  grossMinor: z.number().int().nonnegative(),
  deductionsMinor: z.number().int().nonnegative().optional().default(0),
  currency: z.string().trim().length(3).optional().default("KWD"),
  components: z.record(z.unknown()).optional().default({}),
});

const payrollRunCreateSchema = z.object({
  period: z.string().trim().min(1).max(100),
  currency: z.string().trim().length(3).optional().default("KWD"),
  payslips: z.array(payslipInputSchema).optional().default([]),
});

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

export function hrRoutes(db: Db) {
  const router = Router();

  // ---------------------- Employees (read) ----------------------
  router.get("/companies/:companyId/hr/employees", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosEmployee)
      .where(eq(bosEmployee.companyId, companyId))
      .orderBy(desc(bosEmployee.createdAt));
    res.json({ employees: rows });
  });

  // ---------------------- Attendance ----------------------
  router.get("/companies/:companyId/hr/attendance", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const employeeId =
      typeof req.query.employeeId === "string" ? req.query.employeeId : null;

    const conditions = [eq(bosAttendance.companyId, companyId)];
    if (employeeId) {
      conditions.push(eq(bosAttendance.employeeId, employeeId));
    }

    const rows = await db
      .select()
      .from(bosAttendance)
      .where(and(...conditions))
      .orderBy(desc(bosAttendance.date));
    res.json({ attendance: rows });
  });

  router.post(
    "/companies/:companyId/hr/attendance",
    validate(attendanceCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof attendanceCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosAttendance)
        .values({
          companyId,
          employeeId: body.employeeId,
          date: toDate(body.date) ?? new Date(),
          checkIn: toDate(body.checkIn),
          checkOut: toDate(body.checkOut),
          hours: body.hours,
          status: body.status,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "hr.attendance_recorded",
          entityType: "bos_attendance",
          entityId: row.id,
          details: { employeeId: row.employeeId, status: row.status },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Leave requests ----------------------
  router.get("/companies/:companyId/hr/leave-requests", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosLeaveRequest)
      .where(eq(bosLeaveRequest.companyId, companyId))
      .orderBy(desc(bosLeaveRequest.createdAt));
    res.json({ leaveRequests: rows });
  });

  router.post(
    "/companies/:companyId/hr/leave-requests",
    validate(leaveRequestCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof leaveRequestCreateSchema>;
      const actor = getActorInfo(req);

      const days = body.days ?? leaveDays(body.startDate, body.endDate);

      const [row] = await db
        .insert(bosLeaveRequest)
        .values({
          companyId,
          employeeId: body.employeeId,
          kind: body.kind,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          days,
          status: "pending",
          reason: body.reason ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "hr.leave_requested",
          entityType: "bos_leave_request",
          entityId: row.id,
          details: { kind: row.kind, days: row.days },
        });
      }

      res.status(201).json(row);
    },
  );

  router.post(
    "/companies/:companyId/hr/leave-requests/:id/approve",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const leaveId = req.params.id as string;
      const actor = getActorInfo(req);

      let leave;
      try {
        leave = await approveLeave(db, {
          companyId,
          leaveId,
          approverUserId: actor.actorId ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Approve failed";
        if (message === "Leave request not found") {
          res.status(404).json({ error: message });
          return;
        }
        if (message === "Leave request is already approved") {
          res.status(409).json({ error: message });
          return;
        }
        throw error;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "hr.leave_approved",
        entityType: "bos_leave_request",
        entityId: leave.id,
        details: { days: leave.days },
      });

      res.json(leave);
    },
  );

  // ---------------------- Leave policies ----------------------
  router.get("/companies/:companyId/hr/leave-policies", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosLeavePolicy)
      .where(eq(bosLeavePolicy.companyId, companyId))
      .orderBy(desc(bosLeavePolicy.createdAt));
    res.json({ leavePolicies: rows });
  });

  router.post(
    "/companies/:companyId/hr/leave-policies",
    validate(leavePolicyCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof leavePolicyCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosLeavePolicy)
        .values({
          companyId,
          name: body.name,
          kind: body.kind,
          daysPerYear: body.daysPerYear,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "hr.leave_policy_created",
          entityType: "bos_leave_policy",
          entityId: row.id,
          details: { name: row.name, kind: row.kind },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Payroll runs ----------------------
  router.get("/companies/:companyId/hr/payroll-runs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosPayrollRun)
      .where(eq(bosPayrollRun.companyId, companyId))
      .orderBy(desc(bosPayrollRun.createdAt));
    res.json({ payrollRuns: rows });
  });

  router.post(
    "/companies/:companyId/hr/payroll-runs",
    validate(payrollRunCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof payrollRunCreateSchema>;
      const actor = getActorInfo(req);

      const [run] = await db
        .insert(bosPayrollRun)
        .values({
          companyId,
          period: body.period,
          status: "draft",
          currency: body.currency,
        })
        .returning();

      if (!run) {
        res.status(500).json({ error: "Failed to create payroll run" });
        return;
      }

      if (body.payslips.length > 0) {
        await db.insert(bosPayslip).values(
          body.payslips.map((p) => {
            const netMinor = computePayslip(p.grossMinor, p.deductionsMinor);
            return {
              companyId,
              payrollRunId: run.id,
              employeeId: p.employeeId ?? null,
              employeeName: p.employeeName ?? null,
              grossMinor: p.grossMinor,
              deductionsMinor: p.deductionsMinor,
              netMinor,
              currency: p.currency,
              components: p.components,
            };
          }),
        );
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "hr.payroll_run_created",
        entityType: "bos_payroll_run",
        entityId: run.id,
        details: { period: run.period, payslips: body.payslips.length },
      });

      res.status(201).json(run);
    },
  );

  router.post(
    "/companies/:companyId/hr/payroll-runs/:id/process",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const runId = req.params.id as string;
      const actor = getActorInfo(req);

      let run;
      try {
        run = await processPayroll(db, { companyId, runId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Process failed";
        if (message === "Payroll run not found") {
          res.status(404).json({ error: message });
          return;
        }
        if (message === "Payroll run is already processed") {
          res.status(409).json({ error: message });
          return;
        }
        throw error;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "hr.payroll_run_processed",
        entityType: "bos_payroll_run",
        entityId: run.id,
        details: { netMinor: run.netMinor },
      });

      res.json(run);
    },
  );

  // ---------------------- Payslips ----------------------
  router.get("/companies/:companyId/hr/payslips", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const payrollRunId =
      typeof req.query.payrollRunId === "string" ? req.query.payrollRunId : null;

    const conditions = [eq(bosPayslip.companyId, companyId)];
    if (payrollRunId) {
      conditions.push(eq(bosPayslip.payrollRunId, payrollRunId));
    }

    const rows = await db
      .select()
      .from(bosPayslip)
      .where(and(...conditions))
      .orderBy(desc(bosPayslip.createdAt));
    res.json({ payslips: rows });
  });

  return router;
}
