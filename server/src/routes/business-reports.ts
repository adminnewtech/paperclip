import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql, inArray, isNull, not } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities, businessModules } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentMonthRange(): { startDate: Date; endDate: Date } {
  const now = new Date();
  return {
    startDate: new Date(now.getFullYear(), now.getMonth(), 1),
    endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

function parseDateRange(
  from: unknown,
  to: unknown,
): { startDate: Date; endDate: Date } {
  const { startDate: defaultStart, endDate: defaultEnd } = currentMonthRange();
  const startDate =
    typeof from === "string" && from.length > 0 ? new Date(from) : defaultStart;
  const endDate =
    typeof to === "string" && to.length > 0 ? new Date(to) : defaultEnd;
  return { startDate, endDate };
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Bulk-create schema
// ---------------------------------------------------------------------------

const bulkCreateSchema = z.object({
  moduleKey: z.string().trim().min(1),
  entityType: z.string().trim().min(1),
  entities: z
    .array(
      z.object({
        name: z.string().trim().max(500).optional().nullable(),
        code: z.string().trim().max(255).optional().nullable(),
        status: z.string().trim().min(1).max(100).optional(),
        parentId: z.string().uuid().optional().nullable(),
        ownerUserId: z.string().trim().max(255).optional().nullable(),
        amountCents: z.number().int().optional().nullable(),
        currency: z.string().trim().length(3).optional().nullable(),
        data: z.record(z.string(), z.unknown()).optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(500),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function businessReportsRoutes(db: Db) {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/reports/pnl
  // -------------------------------------------------------------------------
  router.get("/companies/:companyId/business/reports/pnl", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const { startDate, endDate } = parseDateRange(req.query.from, req.query.to);

    // Revenue part 1: paid invoices in range
    const invoiceRevenueRows = await db
      .select({
        entityType: businessEntities.entityType,
        status: businessEntities.status,
        count: sql<number>`count(*)::int`,
        totalCents: sql<number>`coalesce(sum(amount_cents),0)::bigint`,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
          eq(businessEntities.status, "paid"),
          gte(businessEntities.createdAt, startDate),
          lte(businessEntities.createdAt, endDate),
        ),
      )
      .groupBy(businessEntities.entityType, businessEntities.status);

    // Revenue part 2: finance/account entries of type 'revenue'
    const accountRevenueRows = await db
      .select({
        totalCents: sql<number>`coalesce(sum(amount_cents),0)::bigint`,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "finance"),
          eq(businessEntities.entityType, "account"),
          sql`data->>'type' = 'revenue'`,
          not(isNull(businessEntities.amountCents)),
        ),
      );

    const invoiceRevenueCents = invoiceRevenueRows.reduce(
      (sum, r) => sum + Number(r.totalCents),
      0,
    );
    const accountRevenueCents = Number(accountRevenueRows[0]?.totalCents ?? 0);
    const totalRevenueCents = invoiceRevenueCents + accountRevenueCents;

    const revenueBreakdown = invoiceRevenueRows.map((r) => ({
      entityType: r.entityType,
      status: r.status,
      count: r.count,
      totalCents: Number(r.totalCents),
    }));

    // Expenses: grouped by data->>'category'
    const expenseRows = await db
      .select({
        category: sql<string>`coalesce(data->>'category','Uncategorized')`,
        count: sql<number>`count(*)::int`,
        totalCents: sql<number>`coalesce(sum(amount_cents),0)::bigint`,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "finance"),
          eq(businessEntities.entityType, "expense"),
          gte(businessEntities.createdAt, startDate),
          lte(businessEntities.createdAt, endDate),
        ),
      )
      .groupBy(sql`data->>'category'`);

    const totalExpensesCents = expenseRows.reduce(
      (sum, r) => sum + Number(r.totalCents),
      0,
    );

    const expenseBreakdown = expenseRows.map((r) => ({
      category: r.category,
      count: r.count,
      totalCents: Number(r.totalCents),
    }));

    const netIncomeCents = totalRevenueCents - totalExpensesCents;
    const grossMarginPercent =
      totalRevenueCents > 0
        ? Math.round(((netIncomeCents / totalRevenueCents) * 100) * 100) / 100
        : 0;

    res.json({
      period: { from: toISODate(startDate), to: toISODate(endDate) },
      revenue: {
        totalCents: totalRevenueCents,
        breakdown: revenueBreakdown,
      },
      expenses: {
        totalCents: totalExpensesCents,
        breakdown: expenseBreakdown,
      },
      netIncomeCents,
      grossMarginPercent,
    });
  });

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/reports/balance-sheet
  // -------------------------------------------------------------------------
  router.get("/companies/:companyId/business/reports/balance-sheet", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const accountRows = await db
      .select({
        id: businessEntities.id,
        name: businessEntities.name,
        code: businessEntities.code,
        amountCents: businessEntities.amountCents,
        data: businessEntities.data,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "finance"),
          eq(businessEntities.entityType, "account"),
        ),
      )
      .orderBy(businessEntities.code);

    interface AccountRow {
      id: string;
      name: string | null;
      code: string | null;
      amountCents: number | null;
      type: string;
    }

    const assets: AccountRow[] = [];
    const liabilities: AccountRow[] = [];
    const equityAccounts: AccountRow[] = [];

    for (const row of accountRows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      const type = typeof data.type === "string" ? data.type : "asset";
      const entry: AccountRow = {
        id: row.id,
        name: row.name,
        code: row.code,
        amountCents: row.amountCents ?? 0,
        type,
      };
      if (type === "asset") {
        assets.push(entry);
      } else if (type === "liability") {
        liabilities.push(entry);
      } else if (type === "equity") {
        equityAccounts.push(entry);
      }
    }

    const assetsTotalCents = assets.reduce((sum, a) => sum + (a.amountCents ?? 0), 0);
    const liabilitiesTotalCents = liabilities.reduce(
      (sum, a) => sum + (a.amountCents ?? 0),
      0,
    );
    // Equity derived from balance sheet equation: assets - liabilities
    const derivedEquityCents = assetsTotalCents - liabilitiesTotalCents;
    const equityAccountTotal = equityAccounts.reduce(
      (sum, a) => sum + (a.amountCents ?? 0),
      0,
    );
    const equityTotalCents =
      equityAccounts.length > 0 ? equityAccountTotal : derivedEquityCents;

    const isBalanced =
      equityAccounts.length > 0
        ? assetsTotalCents === liabilitiesTotalCents + equityTotalCents
        : true; // derived equity always balances

    res.json({
      asOf: toISODate(new Date()),
      assets: { totalCents: assetsTotalCents, accounts: assets },
      liabilities: { totalCents: liabilitiesTotalCents, accounts: liabilities },
      equity: {
        totalCents: equityTotalCents,
        accounts:
          equityAccounts.length > 0
            ? equityAccounts
            : [{ id: "derived", name: "Net Equity (derived)", code: null, amountCents: derivedEquityCents, type: "equity" }],
      },
      isBalanced,
    });
  });

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/reports/cash-flow
  // -------------------------------------------------------------------------
  router.get("/companies/:companyId/business/reports/cash-flow", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const { startDate, endDate } = parseDateRange(req.query.from, req.query.to);

    // Inflows: paid invoices in period
    const inflowRows = await db
      .select({
        id: businessEntities.id,
        name: businessEntities.name,
        code: businessEntities.code,
        amountCents: businessEntities.amountCents,
        createdAt: businessEntities.createdAt,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
          eq(businessEntities.status, "paid"),
          gte(businessEntities.createdAt, startDate),
          lte(businessEntities.createdAt, endDate),
        ),
      )
      .orderBy(desc(businessEntities.createdAt));

    // Outflows: expenses in period
    const outflowRows = await db
      .select({
        id: businessEntities.id,
        name: businessEntities.name,
        code: businessEntities.code,
        amountCents: businessEntities.amountCents,
        createdAt: businessEntities.createdAt,
        data: businessEntities.data,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "finance"),
          eq(businessEntities.entityType, "expense"),
          gte(businessEntities.createdAt, startDate),
          lte(businessEntities.createdAt, endDate),
        ),
      )
      .orderBy(desc(businessEntities.createdAt));

    const inflowItems = inflowRows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      amountCents: r.amountCents ?? 0,
      date: r.createdAt,
    }));

    const outflowItems = outflowRows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      amountCents: r.amountCents ?? 0,
      date: r.createdAt,
      category: ((r.data ?? {}) as Record<string, unknown>)["category"] ?? null,
    }));

    const inflowTotalCents = inflowItems.reduce((sum, i) => sum + i.amountCents, 0);
    const outflowTotalCents = outflowItems.reduce((sum, i) => sum + i.amountCents, 0);
    const operatingNetCents = inflowTotalCents - outflowTotalCents;

    res.json({
      period: { from: toISODate(startDate), to: toISODate(endDate) },
      operating: {
        inflows: { totalCents: inflowTotalCents, items: inflowItems },
        outflows: { totalCents: outflowTotalCents, items: outflowItems },
        netCents: operatingNetCents,
      },
      netChangeCents: operatingNetCents,
    });
  });

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/reports/summary
  // -------------------------------------------------------------------------
  router.get("/companies/:companyId/business/reports/summary", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    // Run all aggregate queries in parallel
    const [
      revenueRows,
      expenseRows,
      outstandingRows,
      pipelineRows,
      dealRows,
      invoiceAvgRows,
      countRows,
      topCustomerRows,
      recentRows,
    ] = await Promise.all([
      // Total revenue: paid invoices (all time)
      db
        .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "sales"),
            eq(businessEntities.entityType, "invoice"),
            eq(businessEntities.status, "paid"),
          ),
        ),

      // Total expenses (all time)
      db
        .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "finance"),
            eq(businessEntities.entityType, "expense"),
          ),
        ),

      // Outstanding invoices (sent + overdue)
      db
        .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "sales"),
            eq(businessEntities.entityType, "invoice"),
            inArray(businessEntities.status, ["sent", "overdue"]),
          ),
        ),

      // Pipeline: open deals
      db
        .select({ total: sql<number>`coalesce(sum(amount_cents),0)::bigint` })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "crm"),
            eq(businessEntities.entityType, "deal"),
            inArray(businessEntities.status, [
              "prospecting",
              "qualified",
              "proposal",
              "negotiation",
            ]),
          ),
        ),

      // Won vs lost deals for conversion rate
      db
        .select({
          status: businessEntities.status,
          count: sql<number>`count(*)::int`,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "crm"),
            eq(businessEntities.entityType, "deal"),
            inArray(businessEntities.status, ["won", "lost"]),
          ),
        )
        .groupBy(businessEntities.status),

      // Average invoice value (paid invoices)
      db
        .select({ avg: sql<number>`coalesce(avg(amount_cents),0)::bigint` })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "sales"),
            eq(businessEntities.entityType, "invoice"),
            eq(businessEntities.status, "paid"),
          ),
        ),

      // Module/entity counts
      db
        .select({
          moduleKey: businessEntities.moduleKey,
          entityType: businessEntities.entityType,
          count: sql<number>`count(*)::int`,
        })
        .from(businessEntities)
        .where(eq(businessEntities.companyId, companyId))
        .groupBy(businessEntities.moduleKey, businessEntities.entityType),

      // Top customers by invoice revenue (group by data->>'customer' or data->>'customerId')
      db
        .select({
          customer: sql<string>`coalesce(data->>'customer', data->>'customerId', 'Unknown')`,
          totalCents: sql<number>`coalesce(sum(amount_cents),0)::bigint`,
          invoiceCount: sql<number>`count(*)::int`,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "sales"),
            eq(businessEntities.entityType, "invoice"),
          ),
        )
        .groupBy(sql`coalesce(data->>'customer', data->>'customerId', 'Unknown')`)
        .orderBy(sql`coalesce(sum(amount_cents),0) desc`)
        .limit(10),

      // Recent activity (last 20 entities updated)
      db
        .select({
          id: businessEntities.id,
          moduleKey: businessEntities.moduleKey,
          entityType: businessEntities.entityType,
          name: businessEntities.name,
          code: businessEntities.code,
          status: businessEntities.status,
          updatedAt: businessEntities.updatedAt,
        })
        .from(businessEntities)
        .where(eq(businessEntities.companyId, companyId))
        .orderBy(desc(businessEntities.updatedAt))
        .limit(20),
    ]);

    // Deal conversion rate
    const wonDeals = dealRows.find((r) => r.status === "won")?.count ?? 0;
    const lostDeals = dealRows.find((r) => r.status === "lost")?.count ?? 0;
    const totalClosedDeals = wonDeals + lostDeals;
    const dealConversionRate =
      totalClosedDeals > 0
        ? Math.round((wonDeals / totalClosedDeals) * 10000) / 100
        : 0;

    // Build module activity map
    const countMap: Record<string, Record<string, number>> = {};
    for (const row of countRows) {
      countMap[row.moduleKey] ??= {};
      countMap[row.moduleKey]![row.entityType] = row.count;
    }

    const moduleActivity = {
      crm: {
        contacts: countMap["crm"]?.["contact"] ?? 0,
        leads: countMap["crm"]?.["lead"] ?? 0,
        deals: countMap["crm"]?.["deal"] ?? 0,
      },
      sales: {
        invoices: countMap["sales"]?.["invoice"] ?? 0,
        quotes: countMap["sales"]?.["quote"] ?? 0,
        customers: countMap["sales"]?.["customer"] ?? 0,
      },
      finance: {
        accounts: countMap["finance"]?.["account"] ?? 0,
        expenses: countMap["finance"]?.["expense"] ?? 0,
        journal_entries: countMap["finance"]?.["journal_entry"] ?? 0,
      },
      hr: {
        employees: countMap["hr"]?.["employee"] ?? 0,
        leave_requests: countMap["hr"]?.["leave_request"] ?? 0,
      },
      inventory: {
        products: countMap["inventory"]?.["product"] ?? 0,
        stock_movements: countMap["inventory"]?.["stock_movement"] ?? 0,
      },
      helpdesk: {
        tickets: countMap["helpdesk"]?.["ticket"] ?? 0,
      },
    };

    const topCustomers = topCustomerRows.map((r) => ({
      name: r.customer,
      totalCents: Number(r.totalCents),
      invoiceCount: r.invoiceCount,
    }));

    res.json({
      totalRevenueCents: Number(revenueRows[0]?.total ?? 0),
      totalExpensesCents: Number(expenseRows[0]?.total ?? 0),
      totalOutstandingCents: Number(outstandingRows[0]?.total ?? 0),
      totalPipelineCents: Number(pipelineRows[0]?.total ?? 0),
      dealConversionRate,
      avgInvoiceValueCents: Number(invoiceAvgRows[0]?.avg ?? 0),
      moduleActivity,
      topCustomers,
      recentActivity: recentRows,
    });
  });

  // -------------------------------------------------------------------------
  // POST /companies/:companyId/business/bulk-create
  // -------------------------------------------------------------------------
  router.post("/companies/:companyId/business/bulk-create", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = bulkCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const { moduleKey, entityType, entities } = parsed.data;
    const now = new Date();

    const values = entities.map((e) => ({
      companyId,
      moduleKey,
      entityType,
      parentId: e.parentId ?? null,
      code: e.code ?? null,
      name: e.name ?? null,
      status: e.status ?? "active",
      ownerUserId: e.ownerUserId ?? null,
      amountCents: e.amountCents ?? null,
      currency: e.currency ?? null,
      data: e.data ?? {},
      tags: e.tags ?? [],
      createdByUserId: null,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now,
    }));

    const created = await db.insert(businessEntities).values(values).returning();

    res.status(201).json({ created: created.length, entities: created });
  });

  return router;
}
