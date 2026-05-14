/**
 * Hermes Bridge HTTP routes.
 *
 * Authenticated routes (mounted under `/api`) handle agent discovery,
 * registration, task delegation, and inspection. The webhook receiver is
 * exposed separately under `/api/public/webhooks/hermes` and is gated by
 * HMAC signature validation rather than the standard company auth.
 */

import { Router } from "express";
import { z } from "zod";

import type { Db } from "@paperclipai/db";
import type {
  HermesWebhookEvent,
  HermesAgentInfo,
} from "@paperclipai/shared";

import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import { assertCompanyAccess } from "./authz.js";
import {
  createHermesBridgeService,
  type HermesBridgeService,
  type MinimalMemberRegistrar,
  type MinimalMessagePoster,
} from "../services/hermes/index.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  channels: z.array(z.string().trim().min(1)).optional(),
});

const delegateTaskSchema = z.object({
  hermesAgentId: z.string().trim().min(1),
  prompt: z.string().trim().min(1).max(10_000),
  promptAr: z.string().trim().max(10_000).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  callbackChannel: z.string().trim().min(1).optional(),
  callbackThreadRootId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------

export interface HermesRoutesOpts {
  service?: HermesBridgeService;
  memberRegistrar?: MinimalMemberRegistrar;
  messagePoster?: MinimalMessagePoster;
}

export function hermesRoutes(db: Db, opts: HermesRoutesOpts = {}): Router {
  const router = Router();
  const service = opts.service ?? createHermesBridgeService(db);

  // Status / configuration
  router.get(
    "/companies/:companyId/business/hermes/status",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const cfg = service.client.config();
      res.json({
        configured: cfg.configured,
        baseUrl: cfg.baseUrl,
        organizationId: cfg.orgId ?? null,
        mock: !cfg.configured,
      });
    },
  );

  // List both available (from Hermes) and registered agents.
  router.get(
    "/companies/:companyId/business/hermes/agents",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      let available: HermesAgentInfo[] = [];
      try {
        available = await service.client.listAgents();
      } catch (err) {
        logger.warn({ err }, "[hermes] listAgents failed");
      }
      const registered = await service.registry.list(companyId);
      res.json({ available, registered });
    },
  );

  // Sync agents from Hermes
  router.post(
    "/companies/:companyId/business/hermes/sync",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await service.registry.syncFromHermes(companyId, {
        memberRegistrar: opts.memberRegistrar,
      });
      res.json({ ok: true, ...result });
    },
  );

  // Register a Hermes agent into the company workspace
  router.post(
    "/companies/:companyId/business/hermes/agents/:hermesAgentId/register",
    validate(registerSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const hermesAgentId = req.params.hermesAgentId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof registerSchema>;
      const info = await service.client.getAgent(hermesAgentId);
      if (!info) {
        res.status(404).json({ error: "Hermes agent not found" });
        return;
      }
      const registered = await service.registry.register(companyId, info, {
        channels: body.channels,
        memberRegistrar: opts.memberRegistrar,
      });
      res.json({ ok: true, registered });
    },
  );

  // Unregister
  router.delete(
    "/companies/:companyId/business/hermes/agents/:registeredAgentId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const registeredAgentId = req.params.registeredAgentId as string;
      assertCompanyAccess(req, companyId);
      await service.registry.unregister(companyId, registeredAgentId);
      res.json({ ok: true });
    },
  );

  // Task delegation
  router.post(
    "/companies/:companyId/business/hermes/tasks",
    validate(delegateTaskSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof delegateTaskSchema>;
      try {
        const result = await service.delegateToHermes(
          companyId,
          body.hermesAgentId,
          {
            prompt: body.prompt,
            promptAr: body.promptAr,
            context: body.context,
            callbackChannel: body.callbackChannel,
            callbackThreadRootId: body.callbackThreadRootId,
          },
        );
        res.status(201).json({ ok: true, ...result });
      } catch (err) {
        logger.warn({ err }, "[hermes] delegate task failed");
        res
          .status(502)
          .json({ ok: false, error: (err as Error).message ?? "delegate failed" });
      }
    },
  );

  router.get("/companies/:companyId/business/hermes/tasks", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;
    const agentId =
      typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    const limit =
      typeof req.query.limit === "string"
        ? Number.parseInt(req.query.limit, 10)
        : undefined;
    const tasks = await service.listTasks(companyId, {
      status,
      agentId,
      limit: limit && Number.isFinite(limit) ? Math.min(limit, 500) : undefined,
    });
    res.json({ tasks });
  });

  router.get(
    "/companies/:companyId/business/hermes/tasks/:taskId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const taskId = req.params.taskId as string;
      assertCompanyAccess(req, companyId);
      const task = await service.getTask(companyId, taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      res.json({ task });
    },
  );

  router.post(
    "/companies/:companyId/business/hermes/tasks/:taskId/cancel",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const taskId = req.params.taskId as string;
      assertCompanyAccess(req, companyId);
      const existing = await service.getTask(companyId, taskId);
      if (!existing) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      try {
        await service.client.cancelTask(taskId);
      } catch (err) {
        logger.warn({ err, taskId }, "[hermes] cancel upstream failed");
      }
      await service.tasks.updateStatus(companyId, taskId, "cancelled");
      res.json({ ok: true });
    },
  );

  return router;
}

// ---------------------------------------------------------------------------
// Public webhook receiver — mounted under /api/public/webhooks/hermes
// ---------------------------------------------------------------------------

export function hermesWebhookRoutes(
  db: Db,
  opts: HermesRoutesOpts = {},
): Router {
  const router = Router();
  const service = opts.service ?? createHermesBridgeService(db);

  router.post("/", async (req, res) => {
    const rawBodyCandidate = (req as unknown as { rawBody?: unknown })
      .rawBody;
    const rawBody: string | Buffer =
      typeof rawBodyCandidate === "string" || Buffer.isBuffer(rawBodyCandidate)
        ? (rawBodyCandidate as string | Buffer)
        : JSON.stringify(req.body ?? {});
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers[k.toLowerCase()] = v;
      else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(",");
    }
    const ok = service.client.validateWebhookSignature(headers, rawBody);
    if (!ok) {
      logger.warn(
        { headers: { sig: headers["x-hermes-signature"] } },
        "[hermes] webhook signature invalid",
      );
      res.status(401).json({ error: "invalid signature" });
      return;
    }
    const payload = req.body as HermesWebhookEvent;
    // The Hermes header is the authoritative companyId hint; the payload
    // metadata may also carry it.
    const companyId =
      typeof headers["x-hermes-company-id"] === "string"
        ? headers["x-hermes-company-id"]
        : extractCompanyIdFromPayload(payload);
    // Respond fast — the webhook callback chain expects sub-second ACKs.
    res.status(202).json({ ok: true });
    service
      .handleWebhook(payload, {
        companyId: companyId ?? undefined,
        messagePoster: opts.messagePoster,
      })
      .catch((err) => {
        logger.warn({ err }, "[hermes] webhook async handler failed");
      });
  });

  return router;
}

function extractCompanyIdFromPayload(
  payload: HermesWebhookEvent | undefined,
): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const data = payload.data as unknown;
  if (data && typeof data === "object") {
    const meta = (data as { metadata?: Record<string, unknown> }).metadata;
    if (meta && typeof meta === "object") {
      const cid = meta["companyId"];
      if (typeof cid === "string") return cid;
    }
  }
  return undefined;
}
