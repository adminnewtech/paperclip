import { Router } from "express";
import { assertCompanyAccess } from "./authz.js";
import type { BusinessAuditService } from "../services/business-audit-service.js";
import type { BusinessRbacService } from "../services/business-rbac-service.js";
import { requireAuditViewer } from "../middleware/business-rbac-guard.js";

export function businessAuditRoutes(
  auditService: BusinessAuditService,
  rbacService: BusinessRbacService,
) {
  const router = Router();
  const viewerGuard = requireAuditViewer(rbacService);

  router.get(
    "/companies/:companyId/business/audit/logs",
    viewerGuard,
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await auditService.listLogs(companyId, {
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        actorUserId:
          typeof req.query.actorUserId === "string"
            ? req.query.actorUserId
            : undefined,
        action:
          typeof req.query.action === "string" ? req.query.action : undefined,
        targetType:
          typeof req.query.targetType === "string"
            ? req.query.targetType
            : undefined,
        targetId:
          typeof req.query.targetId === "string"
            ? req.query.targetId
            : undefined,
        moduleKey:
          typeof req.query.moduleKey === "string"
            ? req.query.moduleKey
            : undefined,
        limit:
          typeof req.query.limit === "string"
            ? Number.parseInt(req.query.limit, 10) || undefined
            : undefined,
        cursor:
          typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      });
      res.json(result);
    },
  );

  router.get(
    "/companies/:companyId/business/audit/entity/:entityId/history",
    viewerGuard,
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const entityId = req.params.entityId as string;
      assertCompanyAccess(req, companyId);
      const entries = await auditService.getEntityHistory(companyId, entityId);
      res.json({ entries });
    },
  );

  router.get(
    "/companies/:companyId/business/audit/export",
    viewerGuard,
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const from =
        typeof req.query.from === "string"
          ? req.query.from
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const to =
        typeof req.query.to === "string"
          ? req.query.to
          : new Date().toISOString();
      const csv = await auditService.exportLogs(companyId, { from, to });
      const filename = `audit-${companyId}-${from.slice(0, 10)}-${to.slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.status(200).send(csv);
    },
  );

  return router;
}
