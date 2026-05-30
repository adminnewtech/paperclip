import { Router } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosOrgSettings,
  bosRole,
  bosTaxRate,
  bosCurrencyRate,
  bosAutomationRule,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";

const orgSettingsSchema = z.object({
  legalName: z.string().trim().max(500).optional().nullable(),
  logoUrl: z.string().trim().max(2000).optional().nullable(),
  address: z.string().trim().max(2000).optional().nullable(),
  taxId: z.string().trim().max(200).optional().nullable(),
  crNumber: z.string().trim().max(200).optional().nullable(),
  defaultCurrency: z.string().trim().min(1).max(10).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  locale: z.string().trim().min(2).max(10).optional(),
  rtl: z.boolean().optional(),
  branding: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const roleCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  permissions: z.record(z.string(), z.unknown()).optional(),
  isSystem: z.boolean().optional(),
});

const roleUpdateSchema = roleCreateSchema.partial();

const taxRateCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  rateBps: z.number().int().min(0).max(100000),
  isDefault: z.boolean().optional(),
  country: z.string().trim().max(100).optional().nullable(),
});

const currencyRateCreateSchema = z.object({
  code: z.string().trim().min(1).max(10),
  rateToBase: z.number().positive(),
  asOf: z.string().datetime().optional(),
});

const automationRuleCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  triggerEvent: z.string().trim().min(1).max(200),
  conditions: z.array(z.unknown()).optional(),
  actions: z.array(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const automationRuleUpdateSchema = automationRuleCreateSchema.partial();

export function settingsRoutes(db: Db) {
  const router = Router();

  // ---------- Organization settings ----------
  router.get("/companies/:companyId/settings/org", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const [row] = await db
      .select()
      .from(bosOrgSettings)
      .where(eq(bosOrgSettings.companyId, companyId))
      .limit(1);
    res.json({ orgSettings: row ?? null });
  });

  router.put(
    "/companies/:companyId/settings/org",
    validate(orgSettingsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof orgSettingsSchema>;
      const actor = getActorInfo(req);

      const values = {
        companyId,
        legalName: body.legalName ?? null,
        logoUrl: body.logoUrl ?? null,
        address: body.address ?? null,
        taxId: body.taxId ?? null,
        crNumber: body.crNumber ?? null,
        ...(body.defaultCurrency !== undefined
          ? { defaultCurrency: body.defaultCurrency }
          : {}),
        ...(body.fiscalYearStartMonth !== undefined
          ? { fiscalYearStartMonth: body.fiscalYearStartMonth }
          : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(body.rtl !== undefined ? { rtl: body.rtl } : {}),
        ...(body.branding !== undefined ? { branding: body.branding } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
      };

      const [row] = await db
        .insert(bosOrgSettings)
        .values(values)
        .onConflictDoUpdate({
          target: bosOrgSettings.companyId,
          set: { ...values, updatedAt: new Date() },
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "settings.org_updated",
          entityType: "bos_org_settings",
          entityId: row.id,
          details: { legalName: row.legalName },
        });
      }

      res.json(row);
    },
  );

  // ---------- Roles ----------
  router.get("/companies/:companyId/settings/roles", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosRole)
      .where(eq(bosRole.companyId, companyId))
      .orderBy(desc(bosRole.createdAt));
    res.json({ roles: rows });
  });

  router.post(
    "/companies/:companyId/settings/roles",
    validate(roleCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof roleCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosRole)
        .values({
          companyId,
          name: body.name,
          description: body.description ?? null,
          permissions: body.permissions ?? {},
          isSystem: body.isSystem ?? false,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "settings.role_created",
          entityType: "bos_role",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  router.put(
    "/companies/:companyId/settings/roles/:roleId",
    validate(roleUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roleId = req.params.roleId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof roleUpdateSchema>;
      const actor = getActorInfo(req);

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) set.name = body.name;
      if (body.description !== undefined) set.description = body.description ?? null;
      if (body.permissions !== undefined) set.permissions = body.permissions;
      if (body.isSystem !== undefined) set.isSystem = body.isSystem;

      const [row] = await db
        .update(bosRole)
        .set(set)
        .where(eq(bosRole.id, roleId))
        .returning();

      if (!row || row.companyId !== companyId) {
        res.status(404).json({ error: "Role not found" });
        return;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "settings.role_updated",
        entityType: "bos_role",
        entityId: row.id,
        details: { name: row.name },
      });

      res.json(row);
    },
  );

  router.delete(
    "/companies/:companyId/settings/roles/:roleId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roleId = req.params.roleId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      const [row] = await db
        .delete(bosRole)
        .where(eq(bosRole.id, roleId))
        .returning();

      if (!row || row.companyId !== companyId) {
        res.status(404).json({ error: "Role not found" });
        return;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "settings.role_deleted",
        entityType: "bos_role",
        entityId: row.id,
        details: { name: row.name },
      });

      res.status(204).end();
    },
  );

  // ---------- Tax rates ----------
  router.get("/companies/:companyId/settings/tax-rates", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosTaxRate)
      .where(eq(bosTaxRate.companyId, companyId))
      .orderBy(desc(bosTaxRate.createdAt));
    res.json({ taxRates: rows });
  });

  router.post(
    "/companies/:companyId/settings/tax-rates",
    validate(taxRateCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof taxRateCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosTaxRate)
        .values({
          companyId,
          name: body.name,
          rateBps: body.rateBps,
          isDefault: body.isDefault ?? false,
          country: body.country ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "settings.tax_rate_created",
          entityType: "bos_tax_rate",
          entityId: row.id,
          details: { name: row.name, rateBps: row.rateBps },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Currency rates ----------
  router.get(
    "/companies/:companyId/settings/currency-rates",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db
        .select()
        .from(bosCurrencyRate)
        .where(eq(bosCurrencyRate.companyId, companyId))
        .orderBy(desc(bosCurrencyRate.asOf));
      res.json({ currencyRates: rows });
    },
  );

  router.post(
    "/companies/:companyId/settings/currency-rates",
    validate(currencyRateCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof currencyRateCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosCurrencyRate)
        .values({
          companyId,
          code: body.code,
          rateToBase: String(body.rateToBase),
          ...(body.asOf ? { asOf: new Date(body.asOf) } : {}),
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "settings.currency_rate_created",
          entityType: "bos_currency_rate",
          entityId: row.id,
          details: { code: row.code, rateToBase: row.rateToBase },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Automation rules ----------
  router.get(
    "/companies/:companyId/settings/automation-rules",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db
        .select()
        .from(bosAutomationRule)
        .where(eq(bosAutomationRule.companyId, companyId))
        .orderBy(desc(bosAutomationRule.createdAt));
      res.json({ automationRules: rows });
    },
  );

  router.post(
    "/companies/:companyId/settings/automation-rules",
    validate(automationRuleCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof automationRuleCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosAutomationRule)
        .values({
          companyId,
          name: body.name,
          triggerEvent: body.triggerEvent,
          conditions: body.conditions ?? [],
          actions: body.actions ?? [],
          enabled: body.enabled ?? true,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "settings.automation_rule_created",
          entityType: "bos_automation_rule",
          entityId: row.id,
          details: { name: row.name, triggerEvent: row.triggerEvent },
        });
      }

      res.status(201).json(row);
    },
  );

  router.put(
    "/companies/:companyId/settings/automation-rules/:ruleId",
    validate(automationRuleUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const ruleId = req.params.ruleId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof automationRuleUpdateSchema>;
      const actor = getActorInfo(req);

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) set.name = body.name;
      if (body.triggerEvent !== undefined) set.triggerEvent = body.triggerEvent;
      if (body.conditions !== undefined) set.conditions = body.conditions;
      if (body.actions !== undefined) set.actions = body.actions;
      if (body.enabled !== undefined) set.enabled = body.enabled;

      const [row] = await db
        .update(bosAutomationRule)
        .set(set)
        .where(eq(bosAutomationRule.id, ruleId))
        .returning();

      if (!row || row.companyId !== companyId) {
        res.status(404).json({ error: "Automation rule not found" });
        return;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "settings.automation_rule_updated",
        entityType: "bos_automation_rule",
        entityId: row.id,
        details: { name: row.name, enabled: row.enabled },
      });

      res.json(row);
    },
  );

  return router;
}
