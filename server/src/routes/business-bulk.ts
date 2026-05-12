/**
 * HTTP endpoints for bulk-updating, bulk-deleting, and bulk-exporting business
 * entities. All routes require `assertCompanyAccess` on `:companyId`.
 *
 * Limits: at most 1000 IDs per request. Errors are collected per-entity so
 * one bad row does not abort the operation.
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  createBusinessBulkService,
  MAX_BULK_ITEMS,
} from "../services/business-bulk-service.js";
import { csvFilename } from "../services/business-excel-service.js";

const bulkUpdateSchema = z.object({
  entityIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_ITEMS),
  updates: z
    .object({
      status: z.string().trim().min(1).max(100).optional(),
      tags: z.array(z.string()).optional(),
      addTags: z.array(z.string()).optional(),
      removeTags: z.array(z.string()).optional(),
      ownerUserId: z.string().trim().max(255).optional(),
      customDataMerge: z.record(z.string(), z.unknown()).optional(),
    })
    .refine(
      (u) =>
        u.status !== undefined ||
        u.tags !== undefined ||
        u.addTags !== undefined ||
        u.removeTags !== undefined ||
        u.ownerUserId !== undefined ||
        u.customDataMerge !== undefined,
      { message: "At least one update field is required" },
    ),
});

const bulkDeleteSchema = z.object({
  entityIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_ITEMS),
});

const bulkExportSchema = z.object({
  entityIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_ITEMS),
});

export function businessBulkRoutes(db: Db) {
  const router = Router();
  const bulkService = createBusinessBulkService(db);

  router.post(
    "/companies/:companyId/business/modules/:moduleKey/:entityType/bulk-update",
    validate(bulkUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const moduleKey = req.params.moduleKey as string;
      const entityType = req.params.entityType as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof bulkUpdateSchema>;
      const result = await bulkService.bulkUpdate(
        companyId,
        moduleKey,
        entityType,
        body,
        actor.actorId ?? undefined,
      );
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/business/modules/:moduleKey/:entityType/bulk-delete",
    validate(bulkDeleteSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const moduleKey = req.params.moduleKey as string;
      const entityType = req.params.entityType as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof bulkDeleteSchema>;
      const result = await bulkService.bulkDelete(
        companyId,
        moduleKey,
        entityType,
        body,
        actor.actorId ?? undefined,
      );
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/business/modules/:moduleKey/:entityType/bulk-export",
    validate(bulkExportSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const moduleKey = req.params.moduleKey as string;
      const entityType = req.params.entityType as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof bulkExportSchema>;
      const result = await bulkService.bulkExport(
        companyId,
        moduleKey,
        entityType,
        body.entityIds,
      );
      res
        .status(200)
        .set("Content-Type", "text/csv; charset=utf-8")
        .set(
          "Content-Disposition",
          `attachment; filename="${csvFilename(`${moduleKey}-${entityType}-bulk`)}"`,
        )
        .send(result.csv);
    },
  );

  return router;
}
