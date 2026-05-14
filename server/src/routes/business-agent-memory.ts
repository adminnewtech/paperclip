/**
 * Agent memory routes — feedback, outcomes, stats, biases, leaderboard.
 *
 *   GET    /companies/:companyId/business/agent-memory/actions
 *   GET    /companies/:companyId/business/agent-memory/actions/:id
 *   POST   /companies/:companyId/business/agent-memory/actions/:id/feedback
 *   POST   /companies/:companyId/business/agent-memory/actions/:id/outcome
 *   GET    /companies/:companyId/business/agent-memory/stats/:agentSlug
 *   GET    /companies/:companyId/business/agent-memory/stats/:agentSlug/timeseries
 *   GET    /companies/:companyId/business/agent-memory/biases/:agentSlug
 *   POST   /companies/:companyId/business/agent-memory/infer-outcomes
 *   GET    /companies/:companyId/business/agent-memory/rank
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { createAgentMemoryService } from "../services/agent-memory/index.js";
import { createSkillEvaluator } from "../services/agent-memory/skill-evaluator.js";

const feedbackSchema = z.object({
  rating: z.union([z.literal("thumbs_up"), z.literal("thumbs_down"), z.null()]),
  comment: z.string().trim().max(2000).optional(),
});

const outcomeSchema = z.object({
  resolution: z.union([
    z.literal("succeeded"),
    z.literal("failed"),
    z.literal("ignored"),
    z.literal("reversed"),
    z.literal("unknown"),
  ]),
  metrics: z.record(z.string(), z.number()).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export function businessAgentMemoryRoutes(db: Db) {
  const router = Router();
  const memory = createAgentMemoryService(db);
  const evaluator = createSkillEvaluator(memory);

  // ---- List actions -------------------------------------------------------
  router.get(
    "/companies/:companyId/business/agent-memory/actions",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const agentSlug =
        typeof req.query.agentSlug === "string" ? req.query.agentSlug : undefined;
      const capability =
        typeof req.query.capability === "string" ? req.query.capability : undefined;
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const limitRaw = Number(req.query.limit ?? 200);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 200;
      const actions = await memory.listActions(companyId, {
        agentSlug,
        capability,
        from,
        to,
        limit,
      });
      res.json({ actions });
    },
  );

  // ---- Get one action -----------------------------------------------------
  router.get(
    "/companies/:companyId/business/agent-memory/actions/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const actionId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const action = await memory.getAction(companyId, actionId);
      if (!action) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(action);
    },
  );

  // ---- Feedback -----------------------------------------------------------
  router.post(
    "/companies/:companyId/business/agent-memory/actions/:id/feedback",
    validate(feedbackSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const actionId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof feedbackSchema>;
      const actor = getActorInfo(req);
      try {
        const updated = await memory.giveFeedback(companyId, actionId, {
          rating: body.rating,
          comment: body.comment,
          givenBy: actor.actorId ?? undefined,
          givenAt: new Date().toISOString(),
        });
        res.json(updated);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        res.status(404).json({ error: msg });
      }
    },
  );

  // ---- Outcome ------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/agent-memory/actions/:id/outcome",
    validate(outcomeSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const actionId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof outcomeSchema>;
      try {
        const updated = await memory.setOutcome(companyId, actionId, {
          resolution: body.resolution,
          metrics: body.metrics,
          notes: body.notes,
          measuredAt: new Date().toISOString(),
        });
        res.json(updated);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        res.status(404).json({ error: msg });
      }
    },
  );

  // ---- Stats --------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/agent-memory/stats/:agentSlug",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      const lookbackRaw = Number(req.query.lookbackDays ?? 180);
      const lookbackDays = Number.isFinite(lookbackRaw) ? lookbackRaw : 180;
      const stats = await memory.getAgentStats(companyId, agentSlug, { lookbackDays });
      const mom = await evaluator.compareMonthOverMonth(companyId, agentSlug);
      res.json({ ...stats, monthOverMonth: mom });
    },
  );

  // ---- Timeseries ---------------------------------------------------------
  router.get(
    "/companies/:companyId/business/agent-memory/stats/:agentSlug/timeseries",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      const daysRaw = Number(req.query.days ?? 30);
      const days = Number.isFinite(daysRaw) ? daysRaw : 30;
      const series = await memory.accuracyTimeSeries(companyId, agentSlug, days);
      res.json({ series });
    },
  );

  // ---- Biases -------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/agent-memory/biases/:agentSlug",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const agentSlug = req.params.agentSlug as string;
      assertCompanyAccess(req, companyId);
      const biases = await memory.getBiases(companyId, agentSlug);
      res.json({ biases });
    },
  );

  // ---- Infer outcomes -----------------------------------------------------
  router.post(
    "/companies/:companyId/business/agent-memory/infer-outcomes",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const result = await memory.inferOutcomes(companyId);
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        res.status(500).json({ error: msg });
      }
    },
  );

  // ---- Leaderboard --------------------------------------------------------
  router.get(
    "/companies/:companyId/business/agent-memory/rank",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rank = await memory.rankAgentsByAccuracy(companyId);
      res.json({ rank });
    },
  );

  return router;
}
