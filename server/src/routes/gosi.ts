/**
 * REST endpoints for GOSI (Saudi social insurance) calculations + exports.
 *
 * Environment variables: none (delegated to the service layer).
 */

import { Router } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { createGosiService } from "../services/gosi-service.js";
import type { GosiNationality } from "@paperclipai/shared";

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface EmployeeData {
  nationality?: string;
  monthlyBasicSalaryCents?: number;
  monthlyHousingCents?: number;
  nationalId?: string;
}

export function gosiRoutes(db: Db) {
  const router = Router();
  const service = createGosiService(db);

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/gosi/calculate
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/gosi/calculate",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const employeeId =
        typeof req.query.employeeId === "string" ? req.query.employeeId : "";
      const period =
        typeof req.query.period === "string"
          ? req.query.period
          : currentPeriod();
      if (!employeeId) {
        res.status(400).json({ error: "employeeId is required" });
        return;
      }
      const rows = await db
        .select({
          id: businessEntities.id,
          name: businessEntities.name,
          data: businessEntities.data,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.id, employeeId),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "hr"),
            eq(businessEntities.entityType, "employee"),
          ),
        )
        .limit(1);
      if (rows.length === 0) {
        res.status(404).json({ error: "Employee not found" });
        return;
      }
      const row = rows[0]!;
      const data = (row.data ?? {}) as EmployeeData;
      const nat: GosiNationality =
        data.nationality === "saudi" ? "saudi" : "non_saudi";
      const result = service.calculateContribution({
        employeeId: row.id,
        employeeName: row.name ?? undefined,
        nationalId: data.nationalId,
        nationality: nat,
        basicSalaryCents: data.monthlyBasicSalaryCents ?? 0,
        housingCents: data.monthlyHousingCents ?? 0,
        period,
      });
      res.json(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/gosi/monthly-report
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/gosi/monthly-report",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const period =
        typeof req.query.period === "string"
          ? req.query.period
          : currentPeriod();
      try {
        const report = await service.generateMonthlyReport(companyId, period);
        res.json(report);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to build report",
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/gosi/export
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/gosi/export",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const period =
        typeof req.query.period === "string"
          ? req.query.period
          : currentPeriod();
      try {
        const file = await service.generateGosiFile(companyId, period);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${file.filename}"`,
        );
        res.send(file.content);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to build file",
        });
      }
    },
  );

  return router;
}
