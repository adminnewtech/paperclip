import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { createBusinessHealthService } from "../services/health-score/index.js";

const computeSchema = z.object({
  store: z.boolean().optional(),
});

const compareSchema = z.object({
  period1: z.tuple([z.string().trim().min(1), z.string().trim().min(1)]),
  period2: z.tuple([z.string().trim().min(1), z.string().trim().min(1)]),
});

export function businessHealthRoutes(db: Db) {
  const router = Router();
  const service = createBusinessHealthService(db);

  router.post(
    "/companies/:companyId/business/health/compute",
    validate(computeSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = (req.body ?? {}) as z.infer<typeof computeSchema>;
      const actor = getActorInfo(req);
      try {
        const score =
          body.store === false
            ? await service.computeScore(companyId, {
                actorId: actor.actorId ?? null,
              })
            : await service.computeAndStore(companyId, {
                actorId: actor.actorId ?? null,
              });
        res.status(201).json(score);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to compute health score";
        res.status(500).json({ error: message });
      }
    },
  );

  router.get(
    "/companies/:companyId/business/health/latest",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const latest = await service.getLatest(companyId);
      if (!latest) {
        res.status(404).json({ error: "No health score computed yet" });
        return;
      }
      res.json(latest);
    },
  );

  router.get(
    "/companies/:companyId/business/health/history",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const limitRaw = Number(req.query.limit ?? 90);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 90;
      const history = await service.getHistory(companyId, {
        from,
        to,
        limit,
      });
      res.json({ history });
    },
  );

  router.get(
    "/companies/:companyId/business/health/subscores",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.json({ definitions: service.getSubscoreDefinitions() });
    },
  );

  router.post(
    "/companies/:companyId/business/health/compare",
    validate(compareSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof compareSchema>;
      try {
        const result = await service.comparePeriods(
          companyId,
          body.period1,
          body.period2,
        );
        res.json(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to compare periods";
        res.status(500).json({ error: message });
      }
    },
  );

  return router;
}
