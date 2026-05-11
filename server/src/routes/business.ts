import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessModules, businessEntities } from "@paperclipai/db";
import {
  BUSINESS_MODULES,
  INDUSTRY_PRESETS,
  getBusinessModule,
  getBusinessEntitySpec,
  getIndustryPreset,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";

const moduleKeySchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => getBusinessModule(v) !== undefined, "Unknown business module");

const setupSchema = z.object({
  industryPreset: z.string().trim().min(1),
  additionalModules: z.array(moduleKeySchema).optional().default([]),
});

const toggleModuleSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const entityUpsertSchema = z.object({
  entityType: z.string().trim().min(1),
  parentId: z.string().uuid().optional().nullable(),
  code: z.string().trim().max(255).optional().nullable(),
  name: z.string().trim().max(500).optional().nullable(),
  status: z.string().trim().min(1).max(100).optional(),
  ownerUserId: z.string().trim().max(255).optional().nullable(),
  amountCents: z.number().int().optional().nullable(),
  currency: z.string().trim().length(3).optional().nullable(),
  data: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

export function businessRoutes(db: Db) {
  const router = Router();

  // ---------- Catalog (static; no DB) ----------
  router.get("/business/catalog", async (_req, res) => {
    res.json({
      modules: BUSINESS_MODULES,
      industries: INDUSTRY_PRESETS,
    });
  });

  // ---------- Module registry per company ----------
  router.get("/companies/:companyId/business/modules", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(businessModules)
      .where(eq(businessModules.companyId, companyId));
    res.json({ modules: rows });
  });

  router.post(
    "/companies/:companyId/business/setup",
    validate(setupSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { industryPreset, additionalModules } = req.body as z.infer<typeof setupSchema>;
      const preset = getIndustryPreset(industryPreset);
      if (!preset) {
        res.status(400).json({ error: "Unknown industry preset" });
        return;
      }
      const moduleKeys = Array.from(new Set([...preset.modules, ...additionalModules]));
      const actor = getActorInfo(req);

      const now = new Date();
      for (const moduleKey of moduleKeys) {
        await db
          .insert(businessModules)
          .values({
            companyId,
            moduleKey,
            enabled: true,
            industryPreset: preset.key,
            activatedByUserId: actor.actorId ?? null,
            config: {},
            activatedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [businessModules.companyId, businessModules.moduleKey],
            set: {
              enabled: true,
              industryPreset: preset.key,
              updatedAt: now,
            },
          });
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "business.setup",
        entityType: "company",
        entityId: companyId,
        details: { industryPreset: preset.key, moduleKeys },
      });

      const rows = await db
        .select()
        .from(businessModules)
        .where(eq(businessModules.companyId, companyId));
      res.status(201).json({ modules: rows, preset });
    },
  );

  router.put(
    "/companies/:companyId/business/modules/:moduleKey",
    validate(toggleModuleSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const moduleKey = req.params.moduleKey as string;
      assertCompanyAccess(req, companyId);
      if (!getBusinessModule(moduleKey)) {
        res.status(400).json({ error: "Unknown business module" });
        return;
      }
      const actor = getActorInfo(req);
      const now = new Date();
      const enabled = req.body.enabled ?? true;
      const config = req.body.config ?? {};

      const [row] = await db
        .insert(businessModules)
        .values({
          companyId,
          moduleKey,
          enabled,
          config,
          activatedByUserId: actor.actorId ?? null,
          activatedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [businessModules.companyId, businessModules.moduleKey],
          set: { enabled, config, updatedAt: now },
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: enabled ? "business.module_enabled" : "business.module_disabled",
          entityType: "business_module",
          entityId: row.id,
          details: { moduleKey },
        });
      }

      res.json(row);
    },
  );

  // ---------- Entities ----------
  router.get("/companies/:companyId/business/:moduleKey/:entityType", async (req, res) => {
    const companyId = req.params.companyId as string;
    const moduleKey = req.params.moduleKey as string;
    const entityType = req.params.entityType as string;
    assertCompanyAccess(req, companyId);
    if (!getBusinessEntitySpec(moduleKey, entityType)) {
      res.status(404).json({ error: "Unknown entity type" });
      return;
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limit = Math.min(Number(req.query.limit ?? 200) || 200, 1000);

    const conditions = [
      eq(businessEntities.companyId, companyId),
      eq(businessEntities.moduleKey, moduleKey),
      eq(businessEntities.entityType, entityType),
    ];
    if (q.length > 0) {
      conditions.push(ilike(businessEntities.name, `%${q}%`));
    }

    const rows = await db
      .select()
      .from(businessEntities)
      .where(and(...conditions))
      .orderBy(desc(businessEntities.updatedAt))
      .limit(limit);
    res.json({ entities: rows });
  });

  router.post(
    "/companies/:companyId/business/:moduleKey/:entityType",
    validate(entityUpsertSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const moduleKey = req.params.moduleKey as string;
      const entityType = req.params.entityType as string;
      assertCompanyAccess(req, companyId);
      const spec = getBusinessEntitySpec(moduleKey, entityType);
      if (!spec) {
        res.status(404).json({ error: "Unknown entity type" });
        return;
      }
      if ((req.body as z.infer<typeof entityUpsertSchema>).entityType !== entityType) {
        res.status(400).json({ error: "Body entityType must match URL" });
        return;
      }
      const actor = getActorInfo(req);
      const now = new Date();
      const body = req.body as z.infer<typeof entityUpsertSchema>;

      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey,
          entityType,
          parentId: body.parentId ?? null,
          code: body.code ?? null,
          name: body.name ?? null,
          status: body.status ?? "active",
          ownerUserId: body.ownerUserId ?? actor.actorId ?? null,
          amountCents: body.amountCents ?? null,
          currency: body.currency ?? null,
          data: body.data ?? {},
          tags: body.tags ?? [],
          createdByUserId: actor.actorId ?? null,
          updatedByUserId: actor.actorId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "business.entity_created",
          entityType: "business_entity",
          entityId: row.id,
          details: { moduleKey, entityType, name: row.name ?? null },
        });
      }

      res.status(201).json(row);
    },
  );

  router.put(
    "/companies/:companyId/business/:moduleKey/:entityType/:id",
    validate(entityUpsertSchema.partial({ entityType: true })),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const moduleKey = req.params.moduleKey as string;
      const entityType = req.params.entityType as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      if (!getBusinessEntitySpec(moduleKey, entityType)) {
        res.status(404).json({ error: "Unknown entity type" });
        return;
      }
      const actor = getActorInfo(req);
      const now = new Date();
      const body = req.body as Partial<z.infer<typeof entityUpsertSchema>>;

      const [row] = await db
        .update(businessEntities)
        .set({
          ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
          ...(body.amountCents !== undefined ? { amountCents: body.amountCents } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.data !== undefined ? { data: body.data } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
          updatedByUserId: actor.actorId ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(businessEntities.id, id),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, moduleKey),
            eq(businessEntities.entityType, entityType),
          ),
        )
        .returning();
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(row);
    },
  );

  router.delete(
    "/companies/:companyId/business/:moduleKey/:entityType/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const moduleKey = req.params.moduleKey as string;
      const entityType = req.params.entityType as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const result = await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.id, id),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, moduleKey),
            eq(businessEntities.entityType, entityType),
          ),
        )
        .returning();
      if (result.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    },
  );

  // ---------- Counts (for hub cards) ----------
  router.get("/companies/:companyId/business/summary", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select({
        moduleKey: businessEntities.moduleKey,
        entityType: businessEntities.entityType,
        count: sql<number>`count(*)::int`,
      })
      .from(businessEntities)
      .where(eq(businessEntities.companyId, companyId))
      .groupBy(businessEntities.moduleKey, businessEntities.entityType);
    res.json({ counts: rows });
  });

  return router;
}
