// ---------------------------------------------------------------------------
// Marketing Automation REST routes
// ---------------------------------------------------------------------------

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  MARKETING_FLOW_TEMPLATES,
  getMarketingFlowTemplate,
  type MarketingFlow,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { createMarketingAutomationService } from "../services/marketing-automation-service.js";
import { createBusinessMessagingService } from "../services/business-messaging-service.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const triggerSchema = z.union([
  z.object({
    kind: z.literal("schedule"),
    cron: z.string().trim().min(1),
    tz: z.string().trim().optional(),
  }),
  z.object({
    kind: z.literal("entity_created"),
    moduleKey: z.string().trim().min(1),
    entityType: z.string().trim().min(1),
    conditions: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("entity_status_changed"),
    moduleKey: z.string().trim().min(1),
    entityType: z.string().trim().min(1),
    toStatus: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("tag_added"),
    tag: z.string().trim().min(1),
  }),
  z.object({ kind: z.literal("manual") }),
]);

const audienceSchema = z.object({
  source: z.enum(["all_contacts", "tag", "segment", "filter"]),
  tag: z.string().trim().optional(),
  segment: z.string().trim().optional(),
  filter: z
    .object({
      field: z.string().trim().min(1),
      op: z.enum(["eq", "neq", "gt", "lt", "contains"]),
      value: z.unknown(),
    })
    .optional(),
});

// Steps may be deeply nested via `branch`; use lazy recursion.
const stepSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal("send_message"),
      channel: z.enum(["whatsapp", "sms", "email"]),
      templateKey: z.string().trim().min(1),
      lang: z.enum(["ar", "en"]).optional(),
    }),
    z.object({
      kind: z.literal("wait"),
      durationHours: z.number().min(0).max(24 * 365),
    }),
    z.object({
      kind: z.literal("wait_until"),
      hourLocal: z.number().int().min(0).max(23),
      minuteLocal: z.number().int().min(0).max(59).optional(),
    }),
    z.object({
      kind: z.literal("branch"),
      condition: z.object({
        field: z.string().trim().min(1),
        op: z.string().trim().min(1),
        value: z.unknown(),
      }),
      then: z.array(stepSchema),
      else: z.array(stepSchema),
    }),
    z.object({
      kind: z.literal("tag_contact"),
      tag: z.string().trim().min(1),
    }),
    z.object({
      kind: z.literal("create_ticket"),
      subject: z.string().trim().min(1),
      priority: z.string().trim().optional(),
    }),
    z.object({ kind: z.literal("stop") }),
  ]),
);

const createFlowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  enabled: z.boolean().optional().default(true),
  trigger: triggerSchema,
  audience: audienceSchema,
  steps: z.array(stepSchema),
});

const updateFlowSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  nameAr: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  enabled: z.boolean().optional(),
  trigger: triggerSchema.optional(),
  audience: audienceSchema.optional(),
  steps: z.array(stepSchema).optional(),
});

const manualTriggerSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(1000),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function marketingAutomationRoutes(db: Db) {
  const messagingService = createBusinessMessagingService(db);
  const service = createMarketingAutomationService(db, messagingService);
  const router = Router();

  // Templates catalogue (static; no company in path so platform-wide).
  router.get(
    "/business/marketing/flows/templates",
    async (_req, res) => {
      res.json({ templates: MARKETING_FLOW_TEMPLATES });
    },
  );

  // Same templates list also exposed under a company path for symmetry.
  router.get(
    "/companies/:companyId/business/marketing/flows/templates",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.json({ templates: MARKETING_FLOW_TEMPLATES });
    },
  );

  // List flows
  router.get(
    "/companies/:companyId/business/marketing/flows",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const flows = await service.listFlows(companyId);
      res.json({ flows });
    },
  );

  // Create flow
  router.post(
    "/companies/:companyId/business/marketing/flows",
    validate(createFlowSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof createFlowSchema>;
      const flow = await service.createFlow(companyId, {
        name: body.name,
        nameAr: body.nameAr,
        description: body.description,
        enabled: body.enabled ?? true,
        trigger: body.trigger,
        audience: body.audience as MarketingFlow["audience"],
        steps: body.steps as MarketingFlow["steps"],
      });
      res.status(201).json(flow);
    },
  );

  // Get one
  router.get(
    "/companies/:companyId/business/marketing/flows/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const flow = await service.getFlow(companyId, id);
      if (!flow) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(flow);
    },
  );

  // Update
  router.patch(
    "/companies/:companyId/business/marketing/flows/:id",
    validate(updateFlowSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof updateFlowSchema>;
      try {
        const updated = await service.updateFlow(
          companyId,
          id,
          body as Partial<MarketingFlow>,
        );
        res.json(updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "Flow not found") {
          res.status(404).json({ error: message });
          return;
        }
        res.status(400).json({ error: message });
      }
    },
  );

  // Delete
  router.delete(
    "/companies/:companyId/business/marketing/flows/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const flow = await service.getFlow(companyId, id);
      if (!flow) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await service.deleteFlow(companyId, id);
      res.status(204).end();
    },
  );

  // Enable
  router.post(
    "/companies/:companyId/business/marketing/flows/:id/enable",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        await service.enableFlow(companyId, id);
        const flow = await service.getFlow(companyId, id);
        res.json(flow);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(404).json({ error: message });
      }
    },
  );

  // Disable
  router.post(
    "/companies/:companyId/business/marketing/flows/:id/disable",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        await service.disableFlow(companyId, id);
        const flow = await service.getFlow(companyId, id);
        res.json(flow);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(404).json({ error: message });
      }
    },
  );

  // Manual trigger
  router.post(
    "/companies/:companyId/business/marketing/flows/:id/trigger",
    validate(manualTriggerSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof manualTriggerSchema>;
      const flow = await service.getFlow(companyId, id);
      if (!flow) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const result = await service.triggerManualFlow(
        companyId,
        id,
        body.contactIds,
      );
      res.json(result);
    },
  );

  // Enrollments
  router.get(
    "/companies/:companyId/business/marketing/flows/:id/enrollments",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const limit =
        typeof req.query.limit === "string"
          ? Math.max(1, Number(req.query.limit) || 200)
          : 200;
      const enrollments = await service.listEnrollments(companyId, id, {
        status,
        limit,
      });
      res.json({ enrollments });
    },
  );

  // Analytics
  router.get(
    "/companies/:companyId/business/marketing/flows/:id/analytics",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const flow = await service.getFlow(companyId, id);
      if (!flow) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const stats = await service.getFlowAnalytics(companyId, id);
      res.json({ stats });
    },
  );

  // Clone from template
  router.post(
    "/companies/:companyId/business/marketing/flows/from-template/:templateKey",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const templateKey = req.params.templateKey as string;
      assertCompanyAccess(req, companyId);
      const template = getMarketingFlowTemplate(templateKey);
      if (!template) {
        res.status(404).json({ error: "Unknown template" });
        return;
      }
      const flow = await service.createFlow(companyId, {
        ...template.defaultFlow,
        enabled: false,
      });
      res.status(201).json(flow);
    },
  );

  return router;
}
