import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import {
  dashboardData,
  runReport,
  listDashboards,
  saveDashboard,
  listReports,
  saveReport,
  listSavedQueries,
  saveSavedQuery,
  type ReportKind,
} from "../services/bi.js";
import type { RevenueBucket } from "../services/analytics.js";

const REPORT_KINDS: ReportKind[] = [
  "revenue",
  "sales",
  "inventory",
  "crm",
  "finance",
  "custom",
];

export function analyticsRoutes(db: Db) {
  const router = Router();

  // Default BI dashboard payload (KPIs + trend + breakdowns).
  router.get(
    "/companies/:companyId/analytics/dashboard",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await dashboardData(db, { companyId });
      res.json(result);
    },
  );

  // Run a single report by kind (revenue|sales|inventory|crm|finance|custom).
  router.get(
    "/companies/:companyId/analytics/report",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const kindParam = String(req.query.kind ?? "finance") as ReportKind;
      const kind = REPORT_KINDS.includes(kindParam) ? kindParam : "finance";
      const bucket: RevenueBucket =
        req.query.bucket === "day" ? "day" : "month";
      const result = await runReport(db, { companyId, kind, bucket });
      res.json(result);
    },
  );

  // Saved dashboards.
  router.get(
    "/companies/:companyId/analytics/dashboards",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const dashboards = await listDashboards(db, { companyId });
      res.json({ dashboards });
    },
  );

  router.post(
    "/companies/:companyId/analytics/dashboards",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body ?? {};
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const dashboard = await saveDashboard(db, {
        companyId,
        id: typeof body.id === "string" ? body.id : undefined,
        name: body.name.trim(),
        layout: body.layout,
        isDefault: body.isDefault === true,
      });
      res.status(body.id ? 200 : 201).json({ dashboard });
    },
  );

  // Saved reports.
  router.get(
    "/companies/:companyId/analytics/reports",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const reports = await listReports(db, { companyId });
      res.json({ reports });
    },
  );

  router.post(
    "/companies/:companyId/analytics/reports",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body ?? {};
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const report = await saveReport(db, {
        companyId,
        id: typeof body.id === "string" ? body.id : undefined,
        name: body.name.trim(),
        kind: typeof body.kind === "string" ? body.kind : undefined,
        config: body.config,
        schedule: typeof body.schedule === "string" ? body.schedule : null,
      });
      res.status(body.id ? 200 : 201).json({ report });
    },
  );

  // Saved queries.
  router.get(
    "/companies/:companyId/analytics/saved-queries",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const savedQueries = await listSavedQueries(db, { companyId });
      res.json({ savedQueries });
    },
  );

  router.post(
    "/companies/:companyId/analytics/saved-queries",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body ?? {};
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      if (typeof body.entity !== "string" || body.entity.trim().length === 0) {
        res.status(400).json({ error: "entity is required" });
        return;
      }
      const savedQuery = await saveSavedQuery(db, {
        companyId,
        id: typeof body.id === "string" ? body.id : undefined,
        name: body.name.trim(),
        entity: body.entity.trim(),
        filters: body.filters,
        columns: body.columns,
      });
      res.status(body.id ? 200 : 201).json({ savedQuery });
    },
  );

  return router;
}
