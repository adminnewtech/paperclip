/**
 * REST endpoints for the Wages Protection System payroll file generator.
 *
 * Environment variables: none (delegated to the service layer).
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { createWpsService, type WpsCountry } from "../services/wps-service.js";

const generateSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "Period must be YYYY-MM"),
  country: z.enum(["ksa", "kuwait"]),
  download: z.boolean().optional(),
});

export function wpsRoutes(db: Db) {
  const router = Router();
  const service = createWpsService(db);

  // -------------------------------------------------------------------------
  // POST /companies/:companyId/business/wps/generate
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/wps/generate",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const parsed = generateSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Invalid request body", issues: parsed.error.issues });
        return;
      }
      try {
        const file = await service.generatePayrollFile(
          companyId,
          parsed.data.period,
          parsed.data.country,
        );
        if (parsed.data.download) {
          res.setHeader(
            "Content-Type",
            file.format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8",
          );
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${file.filename}"`,
          );
          res.send(file.content);
          return;
        }
        res.json({
          filename: file.filename,
          format: file.format,
          content: file.content,
          entries: file.entries,
          totalCents: file.totalCents,
          country: file.country,
          period: file.period,
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to build file",
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/wps/validate-employees
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/wps/validate-employees",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const countryRaw = req.query.country;
      const country: WpsCountry | undefined =
        countryRaw === "ksa" || countryRaw === "kuwait"
          ? (countryRaw as WpsCountry)
          : undefined;
      const results = await service.validateEmployeesForWps(companyId, country);
      res.json({ employees: results });
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/wps/history
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/wps/history",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const limitRaw = req.query.limit;
      const limit =
        typeof limitRaw === "string" ? parseInt(limitRaw, 10) : undefined;
      const history = await service.listHistory(companyId, { limit });
      res.json({ history });
    },
  );

  return router;
}
