import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosProject,
  bosTask,
  bosTimesheet,
  bosMilestone,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { completeTask } from "../services/bos-projects.js";

// ---------------------------------------------------------------------------
// Validation schemas.
// ---------------------------------------------------------------------------
const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5000).optional().nullable(),
  status: z
    .enum(["active", "on_hold", "completed", "cancelled"])
    .optional()
    .default("active"),
  customerName: z.string().trim().max(500).optional().nullable(),
  budgetMinor: z.number().int().nonnegative().optional().default(0),
  currency: z.string().trim().length(3).optional().default("KWD"),
  startDate: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  ownerUserId: z.string().trim().max(255).optional().nullable(),
});

const taskCreateSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5000).optional().nullable(),
  status: z
    .enum(["todo", "in_progress", "done", "blocked"])
    .optional()
    .default("todo"),
  priority: z.string().trim().max(50).optional().default("medium"),
  assigneeUserId: z.string().trim().max(255).optional().nullable(),
  dependsOnId: z.string().uuid().optional().nullable(),
  estimateHours: z.number().int().nonnegative().optional().default(0),
  dueAt: z.string().datetime().optional().nullable(),
  sort: z.number().int().optional().default(0),
});

const timesheetCreateSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  taskId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  date: z.string().datetime().optional().nullable(),
  hours: z.number().int().nonnegative().optional().default(0),
  billable: z.boolean().optional().default(true),
  rateMinor: z.number().int().nonnegative().optional().default(0),
  note: z.string().trim().max(2000).optional().nullable(),
});

const milestoneCreateSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(500),
  dueDate: z.string().datetime().optional().nullable(),
  completed: z.boolean().optional().default(false),
});

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

export function projectsRoutes(db: Db) {
  const router = Router();

  // ---------------------- Projects ----------------------
  // NOTE: namespaced under /projects-mgmt to avoid colliding with the core
  // upstream /companies/:companyId/projects route (projectRoutes).
  router.get("/companies/:companyId/projects-mgmt", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosProject)
      .where(eq(bosProject.companyId, companyId))
      .orderBy(desc(bosProject.createdAt));
    res.json({ projects: rows });
  });

  router.post(
    "/companies/:companyId/projects-mgmt",
    validate(projectCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof projectCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosProject)
        .values({
          companyId,
          name: body.name,
          description: body.description ?? null,
          status: body.status,
          customerName: body.customerName ?? null,
          budgetMinor: body.budgetMinor,
          currency: body.currency,
          startDate: toDate(body.startDate),
          dueDate: toDate(body.dueDate),
          ownerUserId: body.ownerUserId ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "projects.project_created",
          entityType: "bos_project",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Tasks ----------------------
  router.get("/companies/:companyId/projects-mgmt/tasks", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const projectId =
      typeof req.query.projectId === "string" ? req.query.projectId : null;

    const conditions = [eq(bosTask.companyId, companyId)];
    if (projectId) {
      conditions.push(eq(bosTask.projectId, projectId));
    }

    const rows = await db
      .select()
      .from(bosTask)
      .where(and(...conditions))
      .orderBy(asc(bosTask.sort), desc(bosTask.createdAt));
    res.json({ tasks: rows });
  });

  router.post(
    "/companies/:companyId/projects-mgmt/tasks",
    validate(taskCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof taskCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosTask)
        .values({
          companyId,
          projectId: body.projectId ?? null,
          title: body.title,
          description: body.description ?? null,
          status: body.status,
          priority: body.priority,
          assigneeUserId: body.assigneeUserId ?? null,
          dependsOnId: body.dependsOnId ?? null,
          estimateHours: body.estimateHours,
          dueAt: toDate(body.dueAt),
          sort: body.sort,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "projects.task_created",
          entityType: "bos_task",
          entityId: row.id,
          details: { title: row.title },
        });
      }

      res.status(201).json(row);
    },
  );

  router.post(
    "/companies/:companyId/projects-mgmt/tasks/:id/complete",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;
      const actor = getActorInfo(req);

      let task;
      try {
        task = await completeTask(db, { companyId, taskId: id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Complete failed";
        if (message === "Task not found") {
          res.status(404).json({ error: message });
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
        action: "projects.task_completed",
        entityType: "bos_task",
        entityId: task.id,
        details: {},
      });

      res.json(task);
    },
  );

  // ---------------------- Timesheets ----------------------
  router.get(
    "/companies/:companyId/projects-mgmt/timesheets",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const projectId =
        typeof req.query.projectId === "string" ? req.query.projectId : null;

      const conditions = [eq(bosTimesheet.companyId, companyId)];
      if (projectId) {
        conditions.push(eq(bosTimesheet.projectId, projectId));
      }

      const rows = await db
        .select()
        .from(bosTimesheet)
        .where(and(...conditions))
        .orderBy(desc(bosTimesheet.date));
      res.json({ timesheets: rows });
    },
  );

  router.post(
    "/companies/:companyId/projects-mgmt/timesheets",
    validate(timesheetCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof timesheetCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosTimesheet)
        .values({
          companyId,
          projectId: body.projectId ?? null,
          taskId: body.taskId ?? null,
          employeeId: body.employeeId ?? null,
          date: toDate(body.date) ?? new Date(),
          hours: body.hours,
          billable: body.billable,
          rateMinor: body.rateMinor,
          note: body.note ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "projects.timesheet_logged",
          entityType: "bos_timesheet",
          entityId: row.id,
          details: { hours: row.hours, billable: row.billable },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Milestones ----------------------
  router.get(
    "/companies/:companyId/projects-mgmt/milestones",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const projectId =
        typeof req.query.projectId === "string" ? req.query.projectId : null;

      const conditions = [eq(bosMilestone.companyId, companyId)];
      if (projectId) {
        conditions.push(eq(bosMilestone.projectId, projectId));
      }

      const rows = await db
        .select()
        .from(bosMilestone)
        .where(and(...conditions))
        .orderBy(asc(bosMilestone.dueDate));
      res.json({ milestones: rows });
    },
  );

  router.post(
    "/companies/:companyId/projects-mgmt/milestones",
    validate(milestoneCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof milestoneCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosMilestone)
        .values({
          companyId,
          projectId: body.projectId ?? null,
          name: body.name,
          dueDate: toDate(body.dueDate),
          completed: body.completed,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "projects.milestone_created",
          entityType: "bos_milestone",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  return router;
}
