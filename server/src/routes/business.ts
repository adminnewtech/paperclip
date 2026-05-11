import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessModules, businessEntities } from "@paperclipai/db";
import {
  BUSINESS_MODULES,
  INDUSTRY_PRESETS,
  getBusinessModule,
  getBusinessEntitySpec,
  getIndustryPreset,
  type IndustryPreset,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Auto-numbering helper
// ---------------------------------------------------------------------------

async function nextCode(
  db: Db,
  companyId: string,
  moduleKey: string,
  entityType: string,
  prefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, moduleKey),
        eq(businessEntities.entityType, entityType),
        ilike(businessEntities.code, `${prefix}-${year}-%`),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);

  let num = 1;
  const last = rows[0]?.code;
  if (last) {
    const parts = last.split("-");
    const lastNum = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!isNaN(lastNum)) num = lastNum + 1;
  }
  return `${prefix}-${year}-${String(num).padStart(3, "0")}`;
}

// Prefix map: [moduleKey, entityType] → prefix
const CODE_PREFIXES: Record<string, Record<string, string>> = {
  sales: { invoice: "INV", quote: "QUO", payment: "PAY" },
  finance: { journal_entry: "JRN", expense: "EXP" },
  inventory: { stock_movement: "STK" },
  helpdesk: { ticket: "TKT" },
  ecommerce: { online_order: "ORD", discount: "DISC" },
  hr: { leave_request: "LVE" },
};

// ---------------------------------------------------------------------------
// Chart of accounts seeding
// ---------------------------------------------------------------------------

interface AccountSeed {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  level: number;
}

const COA_SETS: Record<string, AccountSeed[]> = {
  minimal: [
    { code: "1000", name: "Cash", type: "asset", level: 1 },
    { code: "1100", name: "Accounts Receivable", type: "asset", level: 1 },
    { code: "2000", name: "Accounts Payable", type: "liability", level: 1 },
    { code: "3000", name: "Owner's Equity", type: "equity", level: 1 },
    { code: "4000", name: "Revenue", type: "revenue", level: 1 },
    { code: "5000", name: "General Expenses", type: "expense", level: 1 },
  ],
  retail: [
    { code: "1000", name: "Cash & Bank", type: "asset", level: 1 },
    { code: "1100", name: "Accounts Receivable", type: "asset", level: 1 },
    { code: "1200", name: "Inventory", type: "asset", level: 1 },
    { code: "1500", name: "Fixed Assets", type: "asset", level: 1 },
    { code: "2000", name: "Accounts Payable", type: "liability", level: 1 },
    { code: "2100", name: "VAT / Tax Payable", type: "liability", level: 1 },
    { code: "3000", name: "Owner's Equity", type: "equity", level: 1 },
    { code: "3100", name: "Retained Earnings", type: "equity", level: 1 },
    { code: "4000", name: "Sales Revenue", type: "revenue", level: 1 },
    { code: "4100", name: "Other Income", type: "revenue", level: 1 },
    { code: "5000", name: "Cost of Goods Sold", type: "expense", level: 1 },
    { code: "6000", name: "Rent & Utilities", type: "expense", level: 1 },
    { code: "6100", name: "Salaries & Wages", type: "expense", level: 1 },
    { code: "6200", name: "Marketing & Advertising", type: "expense", level: 1 },
    { code: "6300", name: "Other Expenses", type: "expense", level: 1 },
  ],
  services: [
    { code: "1000", name: "Cash & Bank", type: "asset", level: 1 },
    { code: "1100", name: "Accounts Receivable", type: "asset", level: 1 },
    { code: "1200", name: "Prepaid Expenses", type: "asset", level: 1 },
    { code: "2000", name: "Accounts Payable", type: "liability", level: 1 },
    { code: "2100", name: "VAT / Tax Payable", type: "liability", level: 1 },
    { code: "2200", name: "Accrued Liabilities", type: "liability", level: 1 },
    { code: "3000", name: "Owner's Equity", type: "equity", level: 1 },
    { code: "3100", name: "Retained Earnings", type: "equity", level: 1 },
    { code: "4000", name: "Service Revenue", type: "revenue", level: 1 },
    { code: "4100", name: "Project Revenue", type: "revenue", level: 1 },
    { code: "4200", name: "Retainer Revenue", type: "revenue", level: 1 },
    { code: "5000", name: "Salaries & Wages", type: "expense", level: 1 },
    { code: "5100", name: "Rent & Utilities", type: "expense", level: 1 },
    { code: "5200", name: "Technology & Software", type: "expense", level: 1 },
    { code: "5300", name: "Marketing", type: "expense", level: 1 },
    { code: "5400", name: "Travel & Entertainment", type: "expense", level: 1 },
    { code: "5500", name: "Other Expenses", type: "expense", level: 1 },
  ],
  manufacturing: [
    { code: "1000", name: "Cash & Bank", type: "asset", level: 1 },
    { code: "1100", name: "Accounts Receivable", type: "asset", level: 1 },
    { code: "1200", name: "Raw Materials", type: "asset", level: 1 },
    { code: "1300", name: "Work in Progress", type: "asset", level: 1 },
    { code: "1400", name: "Finished Goods", type: "asset", level: 1 },
    { code: "1500", name: "Plant & Equipment", type: "asset", level: 1 },
    { code: "2000", name: "Accounts Payable", type: "liability", level: 1 },
    { code: "2100", name: "Bank Loans", type: "liability", level: 1 },
    { code: "2200", name: "VAT / Tax Payable", type: "liability", level: 1 },
    { code: "3000", name: "Owner's Equity", type: "equity", level: 1 },
    { code: "3100", name: "Retained Earnings", type: "equity", level: 1 },
    { code: "4000", name: "Sales Revenue", type: "revenue", level: 1 },
    { code: "5000", name: "Raw Materials Cost", type: "expense", level: 1 },
    { code: "5100", name: "Direct Labor", type: "expense", level: 1 },
    { code: "5200", name: "Manufacturing Overhead", type: "expense", level: 1 },
    { code: "6000", name: "Admin & General", type: "expense", level: 1 },
    { code: "6100", name: "Marketing & Sales", type: "expense", level: 1 },
  ],
  restaurant: [
    { code: "1000", name: "Cash & POS", type: "asset", level: 1 },
    { code: "1100", name: "Accounts Receivable", type: "asset", level: 1 },
    { code: "1200", name: "Food & Beverage Inventory", type: "asset", level: 1 },
    { code: "1500", name: "Kitchen Equipment", type: "asset", level: 1 },
    { code: "2000", name: "Accounts Payable", type: "liability", level: 1 },
    { code: "2100", name: "VAT / Tax Payable", type: "liability", level: 1 },
    { code: "3000", name: "Owner's Equity", type: "equity", level: 1 },
    { code: "4000", name: "Food Sales", type: "revenue", level: 1 },
    { code: "4100", name: "Beverage Sales", type: "revenue", level: 1 },
    { code: "4200", name: "Delivery Sales", type: "revenue", level: 1 },
    { code: "5000", name: "Food & Beverage Cost", type: "expense", level: 1 },
    { code: "6000", name: "Staff Salaries", type: "expense", level: 1 },
    { code: "6100", name: "Rent", type: "expense", level: 1 },
    { code: "6200", name: "Utilities", type: "expense", level: 1 },
    { code: "6300", name: "Supplies & Packaging", type: "expense", level: 1 },
  ],
};

async function seedChartOfAccounts(
  db: Db,
  companyId: string,
  preset: IndustryPreset,
  actorId: string | null,
) {
  const coaKey = preset.seeds?.chartOfAccounts ?? "minimal";
  const accounts = COA_SETS[coaKey] ?? COA_SETS.minimal!;
  const now = new Date();
  for (const acc of accounts) {
    await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "finance",
        entityType: "account",
        code: acc.code,
        name: acc.name,
        status: acc.type,
        data: { type: acc.type, level: acc.level },
        tags: [],
        createdByUserId: actorId,
        updatedByUserId: actorId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

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

      // Seed chart of accounts if finance is in the module set
      if (moduleKeys.includes("finance")) {
        await seedChartOfAccounts(db, companyId, preset, actor.actorId ?? null);
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

  // ---------- Financial summary ----------
  router.get("/companies/:companyId/business/financial-summary", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Revenue this month: paid invoices
    const revenueRows = await db
      .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
          eq(businessEntities.status, "paid"),
          gte(businessEntities.createdAt, startOfMonth),
          lte(businessEntities.createdAt, endOfMonth),
        ),
      );

    // Outstanding (sent + overdue invoices)
    const outstandingRows = await db
      .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
          inArray(businessEntities.status, ["sent", "overdue"]),
        ),
      );

    // Pipeline value (open deals)
    const pipelineRows = await db
      .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "deal"),
          inArray(businessEntities.status, ["prospecting", "qualified", "proposal", "negotiation"]),
        ),
      );

    // Expenses this month
    const expensesRows = await db
      .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "finance"),
          eq(businessEntities.entityType, "expense"),
          gte(businessEntities.createdAt, startOfMonth),
          lte(businessEntities.createdAt, endOfMonth),
        ),
      );

    // Entity counts
    const countRows = await db
      .select({
        moduleKey: businessEntities.moduleKey,
        entityType: businessEntities.entityType,
        count: sql<number>`count(*)::int`,
      })
      .from(businessEntities)
      .where(eq(businessEntities.companyId, companyId))
      .groupBy(businessEntities.moduleKey, businessEntities.entityType);

    const counts: Record<string, Record<string, number>> = {};
    for (const row of countRows) {
      counts[row.moduleKey] ??= {};
      counts[row.moduleKey]![row.entityType] = row.count;
    }

    res.json({
      revenueThisMonthCents: Number(revenueRows[0]?.total ?? 0),
      outstandingCents: Number(outstandingRows[0]?.total ?? 0),
      pipelineCents: Number(pipelineRows[0]?.total ?? 0),
      expensesThisMonthCents: Number(expensesRows[0]?.total ?? 0),
      counts,
    });
  });

  // ---------- Entities ----------
  router.get("/companies/:companyId/business/:moduleKey/:entityType", async (req, res) => {
    const companyId = req.params.companyId as string;
    const moduleKey = req.params.moduleKey as string;
    const entityType = req.params.entityType as string;

    // Guard: these are not entity endpoints
    if (entityType === "modules" || entityType === "summary" || entityType === "financial-summary") {
      res.status(404).json({ error: "Not found" });
      return;
    }

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

  router.get("/companies/:companyId/business/:moduleKey/:entityType/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const moduleKey = req.params.moduleKey as string;
    const entityType = req.params.entityType as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, moduleKey),
          eq(businessEntities.entityType, entityType),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
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

      // Auto-generate code if not provided and entity uses code as primary field
      let code = body.code ?? null;
      if (!code && spec.primaryField === "code") {
        const prefix = CODE_PREFIXES[moduleKey]?.[entityType];
        if (prefix) {
          code = await nextCode(db, companyId, moduleKey, entityType, prefix);
        }
      }

      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey,
          entityType,
          parentId: body.parentId ?? null,
          code,
          name: body.name ?? null,
          status: body.status ?? spec.statusValues?.[0]?.value ?? "active",
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
          details: { moduleKey, entityType, name: row.name ?? row.code ?? null },
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
