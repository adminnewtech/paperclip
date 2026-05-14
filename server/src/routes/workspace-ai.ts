/**
 * Workspace AI routes (Phase 11-B).
 *
 * REST endpoints for:
 *   - Reading the static business event catalog.
 *   - Reading / updating per-company event routing config.
 *   - Reading per-company event stats.
 *   - Re-registering all 5 agents as workspace members.
 *   - Manually updating an agent's presence/status.
 *   - Manually triggering an agent response to a stored message.
 *   - Posting a message AS an agent (admin / debugging).
 *   - Test-publishing a synthetic event (debugging).
 *
 * All endpoints are gated by `assertCompanyAccess`.
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  BUSINESS_EVENT_CATALOG,
  getBusinessAgentDefinition,
  listBusinessEventDefinitions,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import {
  createAiMembersService,
  type AiMembersService,
} from "../services/workspace/ai-members-service.js";
import {
  createEventBridgeService,
  type EventBridgeService,
} from "../services/workspace/event-bridge-service.js";
import {
  createAgentResponseService,
  type AgentResponseService,
} from "../services/workspace/agent-response-service.js";

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const importanceSchema = z.enum(["info", "notable", "important", "critical"]);

const updateRoutingSchema = z
  .object({
    routing: z
      .record(
        z.string(),
        z.object({
          channelSlug: z.string().min(1).optional(),
          disabled: z.boolean().optional(),
          importance: importanceSchema.optional(),
        }),
      )
      .optional(),
    minImportance: importanceSchema.optional(),
    quietHours: z
      .object({
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(0).max(23),
        timezone: z.string().min(1),
      })
      .nullable()
      .optional(),
  })
  .strict();

const statusSchema = z
  .object({
    status: z.enum(["online", "busy", "idle", "offline", "needs_attention"]),
    message: z.string().max(280).optional(),
  })
  .strict();

const respondSchema = z
  .object({
    messageId: z.string().min(1),
    channelId: z.string().min(1),
    channelSlug: z.string().min(1),
    body: z.string().min(1),
    bodyAr: z.string().optional(),
    authorId: z.string().min(1),
    threadRootId: z.string().optional(),
  })
  .strict();

const postAsAgentSchema = z
  .object({
    channelSlug: z.string().min(1),
    body: z.string().min(1),
    bodyAr: z.string().optional(),
    threadRootId: z.string().optional(),
  })
  .strict();

const testEventSchema = z
  .object({
    eventKey: z.string().min(1),
    variables: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
    entityId: z.string().optional(),
    entityType: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export interface WorkspaceAiRouteDeps {
  aiMembersService?: AiMembersService;
  eventBridgeService?: EventBridgeService;
  agentResponseService?: AgentResponseService;
}

export function workspaceAiRoutes(db: Db, deps: WorkspaceAiRouteDeps = {}) {
  const router = Router();
  const aiMembers = deps.aiMembersService ?? createAiMembersService(db);
  const eventBridge =
    deps.eventBridgeService ?? createEventBridgeService(db);
  const agentResponse =
    deps.agentResponseService ?? createAgentResponseService(db, aiMembers);

  // -------------------------------------------------------------------------
  // Catalog (no companyId — but still gated by an auth check on a passthrough
  // companyId so the same route shape is used)
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/workspace/ai/event-catalog",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.json({ events: listBusinessEventDefinitions() });
    },
  );

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/workspace/ai/routing",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const config = await eventBridge.getRouting(companyId);
      res.json({ config });
    },
  );

  router.put(
    "/companies/:companyId/workspace/ai/routing",
    validate(updateRoutingSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof updateRoutingSchema>;
      const patch: Parameters<EventBridgeService["setRouting"]>[1] = {};
      if (body.routing !== undefined) patch.routing = body.routing;
      if (body.minImportance !== undefined) patch.minImportance = body.minImportance;
      if (body.quietHours !== undefined) {
        patch.quietHours = body.quietHours ?? undefined;
      }
      const config = await eventBridge.setRouting(companyId, patch);
      res.json({ config });
    },
  );

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/workspace/ai/event-stats",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const stats = await eventBridge.getEventStats(companyId, { from, to });
      res.json(stats);
    },
  );

  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/workspace/ai/agents/register",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await aiMembers.registerAllAgents(companyId);
      res.status(202).json({
        registered: true,
        assignments: aiMembers.getAgentChannelAssignments(),
      });
    },
  );

  router.post(
    "/companies/:companyId/workspace/ai/agents/:slug/status",
    validate(statusSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const slug = req.params.slug as string;
      assertCompanyAccess(req, companyId);
      if (!getBusinessAgentDefinition(slug)) {
        res.status(404).json({ error: "Unknown agent" });
        return;
      }
      const body = req.body as z.infer<typeof statusSchema>;
      switch (body.status) {
        case "busy":
          await aiMembers.setAgentBusy(companyId, slug, body.message);
          break;
        case "needs_attention":
          await aiMembers.setAgentNeedsAttention(
            companyId,
            slug,
            body.message ?? "needs attention",
          );
          break;
        case "idle":
        case "online":
        case "offline":
          // The wireable service only exposes setAgentIdle directly; map
          // online/offline through the same code path until P11-A exposes
          // a richer presence API.
          await aiMembers.setAgentIdle(companyId, slug);
          break;
      }
      res.status(204).end();
    },
  );

  router.post(
    "/companies/:companyId/workspace/ai/agents/:slug/respond",
    validate(respondSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const slug = req.params.slug as string;
      assertCompanyAccess(req, companyId);
      if (!getBusinessAgentDefinition(slug)) {
        res.status(404).json({ error: "Unknown agent" });
        return;
      }
      const body = req.body as z.infer<typeof respondSchema>;
      const result = await agentResponse.handleMention(companyId, {
        id: body.messageId,
        channelId: body.channelId,
        channelSlug: body.channelSlug,
        body: body.body,
        bodyAr: body.bodyAr,
        authorId: body.authorId,
        mentionedAgentSlug: slug,
        threadRootId: body.threadRootId,
      });
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/workspace/ai/agents/:slug/post",
    validate(postAsAgentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const slug = req.params.slug as string;
      assertCompanyAccess(req, companyId);
      if (!getBusinessAgentDefinition(slug)) {
        res.status(404).json({ error: "Unknown agent" });
        return;
      }
      const body = req.body as z.infer<typeof postAsAgentSchema>;
      const result = await aiMembers.postAsAgent(
        companyId,
        slug,
        body.channelSlug,
        body.body,
        {
          bodyAr: body.bodyAr,
          threadRootId: body.threadRootId,
        },
      );
      if (!result) {
        res.json({ posted: false, reason: "No poster wired or post failed" });
        return;
      }
      res.status(201).json({ posted: true, messageId: result.id });
    },
  );

  // -------------------------------------------------------------------------
  // Debug: synthesize a business event
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/workspace/ai/test-event",
    validate(testEventSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof testEventSchema>;
      // Confirm it exists so we can return a clear 404 instead of a silent
      // skip from the bridge.
      const exists = BUSINESS_EVENT_CATALOG.some((e) => e.key === body.eventKey);
      if (!exists) {
        res.status(404).json({ error: "Unknown event key" });
        return;
      }
      const result = await eventBridge.publishEvent({
        key: body.eventKey,
        companyId,
        variables: body.variables,
        entityId: body.entityId,
        entityType: body.entityType,
        triggeredBy: { type: "user", id: "test-event" },
      });
      res.json(result);
    },
  );

  return router;
}
