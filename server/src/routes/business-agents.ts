/**
 * Hire-an-Agent routes.
 *
 * REST endpoints for the 5 specialized business agents:
 *   GET    /companies/:companyId/business/agents/catalog
 *   GET    /companies/:companyId/business/agents/hired
 *   POST   /companies/:companyId/business/agents/:agentSlug/hire
 *   POST   /companies/:companyId/business/agents/:agentSlug/fire
 *   POST   /companies/:companyId/business/agents/:agentSlug/pause
 *   POST   /companies/:companyId/business/agents/:agentSlug/resume
 *   POST   /companies/:companyId/business/agents/:agentSlug/run
 *   GET    /companies/:companyId/business/agents/:agentSlug
 *   PUT    /companies/:companyId/business/agents/:agentSlug
 *   GET    /companies/:companyId/business/agents/:agentSlug/runs
 *   GET    /companies/:companyId/business/agents/:agentSlug/runs/:runId
 */
import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { listBusinessAgentDefinitions } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { createBusinessAgentsService } from "../services/business-agents-service.js";

const hireSchema = z.object({
  schedule: z.string().trim().min(1).max(120).optional(),
  capabilities: z.array(z.string().trim().min(1)).optional(),
});

const updateSchema = z.object({
  schedule: z.string().trim().min(1).max(120).optional(),
  capabilities: z.array(z.string().trim().min(1)).optional(),
});

export function businessAgentsRoutes(db: Db) {
  const router = Router();
  const service = createBusinessAgentsService(db);

  // ---- Catalog ------------------------------------------------------------
  router.get("/companies/:companyId/business/agents/catalog", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({ agents: listBusinessAgentDefinitions() });
  });

  // ---- Hired list ---------------------------------------------------------
  router.get("/companies/:companyId/business/agents/hired", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const hired = await service.listHired(companyId);
    res.json({ hired });
  });

  // ---- Single hired agent -------------------------------------------------
  router.get(
    "/companies/:companyId/business/agents/:agentSlug",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      const def = service.getDefinition(agentSlug);
      if (!def) {
        res.status(404).json({ error: "Unknown agent" });
        return;
      }
      const hired = await service.getHired(companyId, agentSlug);
      res.json({ definition: def, hired });
    },
  );

  // ---- Hire ---------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/agents/:agentSlug/hire",
    validate(hireSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      if (!service.getDefinition(agentSlug)) {
        res.status(404).json({ error: "Unknown agent" });
        return;
      }
      const actor = getActorInfo(req);
      const body = (req.body ?? {}) as z.infer<typeof hireSchema>;
      try {
        const hired = await service.hire(
          companyId,
          agentSlug,
          { schedule: body.schedule, capabilities: body.capabilities },
          actor.actorId ?? null,
        );
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "business.agent_hired",
          entityType: "hired_agent",
          entityId: hired.id,
          details: { agentSlug },
        });
        res.status(201).json(hired);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to hire";
        res.status(400).json({ error: message });
      }
    },
  );

  // ---- Fire ---------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/agents/:agentSlug/fire",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      await service.fire(companyId, agentSlug);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "business.agent_fired",
        entityType: "hired_agent",
        entityId: agentSlug,
        details: { agentSlug },
      });
      res.status(204).end();
    },
  );

  // ---- Pause / Resume -----------------------------------------------------
  router.post(
    "/companies/:companyId/business/agents/:agentSlug/pause",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      try {
        const hired = await service.pause(companyId, agentSlug);
        res.json(hired);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to pause";
        res.status(404).json({ error: message });
      }
    },
  );
  router.post(
    "/companies/:companyId/business/agents/:agentSlug/resume",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      try {
        const hired = await service.resume(companyId, agentSlug);
        res.json(hired);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to resume";
        res.status(404).json({ error: message });
      }
    },
  );

  // ---- Update settings ----------------------------------------------------
  router.put(
    "/companies/:companyId/business/agents/:agentSlug",
    validate(updateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      const body = (req.body ?? {}) as z.infer<typeof updateSchema>;
      try {
        let hired = await service.getHired(companyId, agentSlug);
        if (!hired) {
          res.status(404).json({ error: "Agent not hired" });
          return;
        }
        if (body.schedule) {
          hired = await service.updateSchedule(companyId, agentSlug, body.schedule);
        }
        if (body.capabilities) {
          hired = await service.updateCapabilities(
            companyId,
            agentSlug,
            body.capabilities,
          );
        }
        res.json(hired);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update";
        res.status(400).json({ error: message });
      }
    },
  );

  // ---- Run now ------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/agents/:agentSlug/run",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      try {
        const result = await service.runNow(companyId, agentSlug);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "business.agent_run",
          entityType: "agent_run",
          entityId: result.id ?? agentSlug,
          details: {
            agentSlug,
            status: result.status,
            actionsCount: result.actions.length,
          },
        });
        res.status(201).json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to run";
        res.status(400).json({ error: message });
      }
    },
  );

  // ---- Run history --------------------------------------------------------
  router.get(
    "/companies/:companyId/business/agents/:agentSlug/runs",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      const limitRaw = Number(req.query.limit ?? 50);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const runs = await service.listRuns(companyId, agentSlug, { limit });
      res.json({ runs });
    },
  );

  router.get(
    "/companies/:companyId/business/agents/:agentSlug/runs/:runId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      const runId = req.params.runId as string;
      assertCompanyAccess(req, companyId);
      const run = await service.getRun(companyId, agentSlug, runId);
      if (!run) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(run);
    },
  );

  return router;
}
