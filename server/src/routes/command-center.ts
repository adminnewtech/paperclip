import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import {
  generateBriefing,
  getLatestBriefing,
  listInsights,
  commandCenterMetrics,
} from "../services/command-center.js";

export function commandCenterRoutes(db: Db) {
  const router = Router();

  // Generate (and persist) a fresh briefing across all modules.
  router.post(
    "/companies/:companyId/command-center/briefing/generate",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      const result = await generateBriefing(db, { companyId });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "command_center.briefing_generated",
        entityType: "bos_briefing",
        entityId: result.briefing.id,
        details: {
          insightCount: result.insights.length,
          metrics: result.briefing.metrics,
        },
      });

      res.status(201).json(result);
    },
  );

  // Latest persisted briefing.
  router.get(
    "/companies/:companyId/command-center/briefing",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const briefing = await getLatestBriefing(db, { companyId });
      res.json({ briefing });
    },
  );

  // All insights for the company.
  router.get(
    "/companies/:companyId/command-center/insights",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const insights = await listInsights(db, { companyId });
      res.json({ insights });
    },
  );

  // Live metrics + insights (computed on the fly, not persisted).
  router.get(
    "/companies/:companyId/command-center/metrics",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await commandCenterMetrics(db, { companyId });
      res.json(result);
    },
  );

  return router;
}
