import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { createBusinessSimulationService } from "../services/simulation/index.js";

const scenarioKeys = [
  "price_change",
  "marketing_spend",
  "hire_employees",
  "new_product_launch",
  "discount_strategy",
  "expansion_to_region",
  "cost_reduction",
  "supplier_change",
  "open_new_branch",
  "custom",
] as const;

const runSchema = z.object({
  scenarioKey: z.enum(scenarioKeys),
  parameters: z.record(z.string(), z.unknown()).default({}),
  horizonMonths: z.number().int().min(1).max(36).default(12),
  startDate: z.string().optional(),
});

export function businessSimulationRoutes(db: Db) {
  const router = Router();
  const service = createBusinessSimulationService(db);

  router.get(
    "/companies/:companyId/business/simulation/templates",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.json({ templates: service.getScenarioTemplates() });
    },
  );

  router.post(
    "/companies/:companyId/business/simulation/run",
    validate(runSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof runSchema>;
      try {
        const result = await service.simulate(companyId, {
          scenarioKey: body.scenarioKey,
          parameters: body.parameters,
          horizonMonths: body.horizonMonths,
          startDate: body.startDate,
        });
        res.status(201).json(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to run simulation";
        res.status(500).json({ error: message });
      }
    },
  );

  router.get(
    "/companies/:companyId/business/simulation/results",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const limitRaw = Number(req.query.limit ?? 50);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const results = await service.listResults(companyId, { limit });
      res.json({ results });
    },
  );

  router.get(
    "/companies/:companyId/business/simulation/results/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const result = await service.getResult(companyId, id);
      if (!result) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(result);
    },
  );

  router.delete(
    "/companies/:companyId/business/simulation/results/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      await service.deleteResult(companyId, id);
      res.status(204).end();
    },
  );

  return router;
}
