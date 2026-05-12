import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  AUTOMATION_TEMPLATES,
  createBusinessAutomationsService,
  executeRule,
  computeNextRun,
  parseSchedule,
  type AutomationRule,
} from "../services/business-automations-service.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const triggerSchema = z.object({
  kind: z.enum(["schedule", "event"]),
  schedule: z
    .object({
      cron: z.string().trim().min(1),
      timezone: z.string().trim().optional(),
    })
    .optional(),
  event: z
    .object({
      type: z.string().trim().min(1),
      conditions: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

const actionSchema = z.object({
  kind: z.enum([
    "create_invoice",
    "send_reminder",
    "generate_report",
    "create_ticket",
    "tag_entity",
    "ai_action",
  ]),
  params: z.record(z.string(), z.unknown()).default({}),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean().optional().default(true),
  trigger: triggerSchema,
  action: actionSchema,
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  trigger: triggerSchema.optional(),
  action: actionSchema.optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRulePayload(row: typeof businessEntities.$inferSelect): AutomationRule {
  const data = (row.data ?? {}) as Partial<AutomationRule>;
  return {
    id: row.id,
    name: data.name ?? row.name ?? "Untitled automation",
    enabled: data.enabled ?? true,
    trigger: data.trigger ?? { kind: "schedule", schedule: { cron: "daily" } },
    action: data.action ?? { kind: "ai_action", params: {} },
    lastRunAt: data.lastRunAt,
    nextRunAt: data.nextRunAt,
    runCount: data.runCount ?? 0,
    errorCount: data.errorCount ?? 0,
    history: data.history ?? [],
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function businessAutomationsRoutes(db: Db) {
  // Start the per-minute scheduler when the routes are wired.
  createBusinessAutomationsService(db);

  const router = Router();

  // Templates: static catalogue
  router.get("/business/automations/templates", async (_req, res) => {
    res.json({ templates: AUTOMATION_TEMPLATES });
  });

  // List rules for a company
  router.get("/companies/:companyId/business/automations", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "automation"),
          eq(businessEntities.entityType, "rule"),
        ),
      )
      .orderBy(desc(businessEntities.updatedAt));
    res.json({ rules: rows.map(toRulePayload) });
  });

  // Create a rule
  router.post(
    "/companies/:companyId/business/automations",
    validate(createSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof createSchema>;
      const actor = getActorInfo(req);
      const now = new Date();

      // Validate schedule if present
      let nextRunIso: string | undefined;
      if (body.trigger.kind === "schedule") {
        if (!body.trigger.schedule) {
          res.status(400).json({ error: "schedule.cron required for schedule trigger" });
          return;
        }
        try {
          parseSchedule(body.trigger.schedule.cron);
          const next = computeNextRun(body.trigger.schedule.cron, now);
          if (next) nextRunIso = next.toISOString();
        } catch (err) {
          res.status(400).json({
            error: "Invalid schedule",
            details: err instanceof Error ? err.message : String(err),
          });
          return;
        }
      }

      const rule: AutomationRule = {
        id: "", // will be replaced after insert
        name: body.name,
        enabled: body.enabled ?? true,
        trigger: body.trigger,
        action: body.action,
        runCount: 0,
        errorCount: 0,
        nextRunAt: nextRunIso,
        history: [],
      };

      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: "automation",
          entityType: "rule",
          name: body.name,
          status: body.enabled === false ? "inactive" : "active",
          data: rule,
          tags: ["automation"],
          createdByUserId: actor.actorId ?? null,
          updatedByUserId: actor.actorId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) {
        res.status(500).json({ error: "Failed to create rule" });
        return;
      }
      // Persist final id back into data
      const finalRule: AutomationRule = { ...rule, id: row.id };
      await db
        .update(businessEntities)
        .set({ data: finalRule })
        .where(eq(businessEntities.id, row.id));
      res.status(201).json(finalRule);
    },
  );

  // Patch a rule
  router.patch(
    "/companies/:companyId/business/automations/:id",
    validate(updateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof updateSchema>;

      const [existing] = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.id, id),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "automation"),
            eq(businessEntities.entityType, "rule"),
          ),
        );
      if (!existing) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const current = toRulePayload(existing);
      const merged: AutomationRule = {
        ...current,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.trigger !== undefined ? { trigger: body.trigger } : {}),
        ...(body.action !== undefined ? { action: body.action } : {}),
      };

      // Recompute nextRunAt if schedule changed
      if (merged.trigger.kind === "schedule" && merged.trigger.schedule) {
        try {
          parseSchedule(merged.trigger.schedule.cron);
          const next = computeNextRun(merged.trigger.schedule.cron);
          merged.nextRunAt = next ? next.toISOString() : merged.nextRunAt;
        } catch (err) {
          res.status(400).json({
            error: "Invalid schedule",
            details: err instanceof Error ? err.message : String(err),
          });
          return;
        }
      }

      const now = new Date();
      await db
        .update(businessEntities)
        .set({
          name: merged.name,
          status: merged.enabled ? "active" : "inactive",
          data: merged,
          updatedAt: now,
        })
        .where(eq(businessEntities.id, id));
      res.json(merged);
    },
  );

  // Delete a rule
  router.delete(
    "/companies/:companyId/business/automations/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const result = await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.id, id),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "automation"),
            eq(businessEntities.entityType, "rule"),
          ),
        )
        .returning();
      if (result.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    },
  );

  // Manual run / test trigger
  router.post(
    "/companies/:companyId/business/automations/:id/run",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const [existing] = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.id, id),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "automation"),
            eq(businessEntities.entityType, "rule"),
          ),
        );
      if (!existing) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const result = await executeRule(db, id, "manual");
      res.json(result);
    },
  );

  // History
  router.get(
    "/companies/:companyId/business/automations/:id/history",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const [row] = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.id, id),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "automation"),
            eq(businessEntities.entityType, "rule"),
          ),
        );
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const data = (row.data ?? {}) as Partial<AutomationRule>;
      res.json({ history: (data.history ?? []).slice(0, 20) });
    },
  );

  return router;
}
