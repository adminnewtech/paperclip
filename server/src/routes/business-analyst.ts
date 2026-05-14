import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  analyzeCompany,
  listInsightReports,
  getInsightReport,
  getLatestInsightReport,
  deleteInsightReport,
} from "../services/business-analyst-agent.js";

const runSchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export function businessAnalystRoutes(db: Db) {
  const router = Router();

  // -------------------------------------------------------------------------
  // POST /companies/:companyId/business/analyst/run
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/analyst/run",
    validate(runSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = (req.body ?? {}) as z.infer<typeof runSchema>;
      const actor = getActorInfo(req);
      try {
        const stored = await analyzeCompany(db, companyId, {
          from: body.from,
          to: body.to,
          actorId: actor.actorId ?? null,
        });
        res.status(201).json(stored);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to run analysis";
        res.status(500).json({ error: message });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/analyst/reports
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/analyst/reports",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const limitRaw = Number(req.query.limit ?? 50);
      const offsetRaw = Number(req.query.offset ?? 0);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;
      const result = await listInsightReports(db, companyId, { limit, offset });
      res.json(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/analyst/latest
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/analyst/latest",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const latest = await getLatestInsightReport(db, companyId);
      if (!latest) {
        res.status(404).json({ error: "No reports yet" });
        return;
      }
      res.json(latest);
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/analyst/reports/:reportId
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/analyst/reports/:reportId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const reportId = req.params.reportId as string;
      assertCompanyAccess(req, companyId);
      const report = await getInsightReport(db, companyId, reportId);
      if (!report) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(report);
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /companies/:companyId/business/analyst/reports/:reportId
  // -------------------------------------------------------------------------
  router.delete(
    "/companies/:companyId/business/analyst/reports/:reportId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const reportId = req.params.reportId as string;
      assertCompanyAccess(req, companyId);
      const ok = await deleteInsightReport(db, companyId, reportId);
      if (!ok) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    },
  );

  return router;
}
