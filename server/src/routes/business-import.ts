/**
 * HTTP endpoints for the CSV/Excel import wizard.
 *
 *   POST /companies/:companyId/business/import/preview
 *   POST /companies/:companyId/business/import/commit
 *   GET  /companies/:companyId/business/import/templates
 *   GET  /companies/:companyId/business/import/templates/:source/:targetType
 *
 * All routes require `assertCompanyAccess`. The preview endpoint is
 * read-only; commit is the only one that touches `business_entities`.
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  IMPORT_SOURCES,
  IMPORT_TARGET_TYPES,
  IMPORT_TEMPLATES,
  isImportSource,
  isImportTargetType,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  createBusinessImportService,
  MAX_IMPORT_ROWS,
  MAX_RAW_BYTES,
} from "../services/business-import-service.js";

const transformEnum = z.enum([
  "number",
  "currency_cents",
  "date_iso",
  "trim",
  "lowercase",
  "uppercase",
  "phone_e164",
  "tag_split",
]);

const fieldMappingSchema = z.object({
  sourceColumn: z.string(),
  targetField: z.string().min(1),
  transform: transformEnum.optional(),
  defaultValue: z.unknown().optional(),
});

const importOptionsSchema = z.object({
  skipFirstRow: z.boolean().optional(),
  deduplicateBy: z.string().optional(),
  maxRows: z.number().int().positive().max(MAX_IMPORT_ROWS).optional(),
});

const sourceSchema = z.enum(IMPORT_SOURCES as readonly [string, ...string[]]);
const targetTypeSchema = z.enum(IMPORT_TARGET_TYPES as readonly [string, ...string[]]);

const previewSchema = z.object({
  source: sourceSchema,
  targetType: targetTypeSchema,
  rawData: z.string().max(MAX_RAW_BYTES, "Input data exceeds the 10MB limit"),
  fileFormat: z.enum(["csv", "excel"]),
  fieldMapping: z.array(fieldMappingSchema).optional(),
  options: importOptionsSchema.optional(),
});

const commitSchema = previewSchema.extend({
  skipDuplicates: z.boolean().default(true),
  skipInvalid: z.boolean().default(false),
});

export function businessImportRoutes(db: Db) {
  const router = Router();
  const service = createBusinessImportService(db);

  router.post(
    "/companies/:companyId/business/import/preview",
    validate(previewSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof previewSchema>;
      try {
        const result = await service.preview(companyId, {
          source: body.source as never,
          targetType: body.targetType as never,
          rawData: body.rawData,
          fileFormat: body.fileFormat,
          fieldMapping: body.fieldMapping,
          options: body.options,
        });
        res.json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to parse import",
        });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/import/commit",
    validate(commitSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof commitSchema>;
      try {
        const result = await service.commit(
          companyId,
          {
            source: body.source as never,
            targetType: body.targetType as never,
            rawData: body.rawData,
            fileFormat: body.fileFormat,
            fieldMapping: body.fieldMapping,
            options: body.options,
            skipDuplicates: body.skipDuplicates,
            skipInvalid: body.skipInvalid,
          },
          actor.actorId ?? undefined,
        );
        res.status(201).json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to commit import",
        });
      }
    },
  );

  router.get(
    "/companies/:companyId/business/import/templates",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const templates = Object.entries(IMPORT_TEMPLATES).map(([key, mapping]) => {
        const idx = key.lastIndexOf("_");
        const source = key.slice(0, idx);
        const targetType = key.slice(idx + 1);
        return { source, targetType, mapping };
      });
      res.json({
        sources: IMPORT_SOURCES,
        targetTypes: IMPORT_TARGET_TYPES,
        templates,
      });
    },
  );

  router.get(
    "/companies/:companyId/business/import/templates/:source/:targetType",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const source = req.params.source as string;
      const targetType = req.params.targetType as string;
      if (!isImportSource(source) || !isImportTargetType(targetType)) {
        res.status(404).json({ error: "Unknown source or target type" });
        return;
      }
      res.json({
        source,
        targetType,
        mapping: service.getTemplate(source, targetType),
      });
    },
  );

  return router;
}
