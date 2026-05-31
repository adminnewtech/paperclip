import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosInvoice,
  bosPosOrder,
  bosOnlineOrder,
  bosDeal,
  bosStock,
  bosTicket,
  bosProduct,
  bosDashboard,
  bosReport,
  bosSavedQuery,
} from "@paperclipai/db";
import {
  revenueTrend,
  salesByModule,
  topProducts,
  topCustomers,
  kpiRollup,
  inventoryValuation,
  type RevenueBucket,
  type RevenueTrendPoint,
  type SalesByModuleRow,
  type TopProductRow,
  type TopCustomerRow,
  type KpiRollup,
  type InventoryValuation,
} from "./analytics.js";

export type ReportKind =
  | "revenue"
  | "sales"
  | "inventory"
  | "crm"
  | "finance"
  | "custom";

export interface RunReportParams {
  companyId: string;
  kind: ReportKind;
  bucket?: RevenueBucket;
  nowIso?: string;
}

export interface DashboardDataResult {
  kpis: KpiRollup;
  revenueTrend: RevenueTrendPoint[];
  salesByModule: SalesByModuleRow[];
  topProducts: TopProductRow[];
  topCustomers: TopCustomerRow[];
  inventoryValuation: InventoryValuation;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Report orchestration
// ---------------------------------------------------------------------------

/**
 * Run a single report by fetching only the tables it needs and delegating to
 * the matching pure analytics function. Returns a structured, kind-tagged
 * result so the caller can render or persist it.
 */
export async function runReport(
  db: Db,
  params: RunReportParams,
): Promise<{ kind: ReportKind; bucket: RevenueBucket; data: unknown }> {
  const { companyId } = params;
  const kind = params.kind;
  const bucket: RevenueBucket = params.bucket ?? "month";
  const nowIso = params.nowIso ?? new Date().toISOString();

  switch (kind) {
    case "revenue": {
      const invoices = await db
        .select()
        .from(bosInvoice)
        .where(eq(bosInvoice.companyId, companyId));
      return { kind, bucket, data: revenueTrend(invoices, { bucket, nowIso }) };
    }
    case "sales": {
      const [posOrders, onlineOrders, invoices] = await Promise.all([
        db.select().from(bosPosOrder).where(eq(bosPosOrder.companyId, companyId)),
        db
          .select()
          .from(bosOnlineOrder)
          .where(eq(bosOnlineOrder.companyId, companyId)),
        db.select().from(bosInvoice).where(eq(bosInvoice.companyId, companyId)),
      ]);
      return {
        kind,
        bucket,
        data: {
          byModule: salesByModule({ posOrders, onlineOrders, invoices }),
          topProducts: topProducts(posOrders, onlineOrders, 10),
        },
      };
    }
    case "inventory": {
      const [stock, products] = await Promise.all([
        db.select().from(bosStock).where(eq(bosStock.companyId, companyId)),
        db.select().from(bosProduct).where(eq(bosProduct.companyId, companyId)),
      ]);
      return { kind, bucket, data: inventoryValuation(stock, products) };
    }
    case "crm": {
      const invoices = await db
        .select()
        .from(bosInvoice)
        .where(eq(bosInvoice.companyId, companyId));
      return { kind, bucket, data: topCustomers(invoices, 10) };
    }
    case "finance":
    case "custom":
    default: {
      const [invoices, deals, stock, tickets] = await Promise.all([
        db.select().from(bosInvoice).where(eq(bosInvoice.companyId, companyId)),
        db.select().from(bosDeal).where(eq(bosDeal.companyId, companyId)),
        db.select().from(bosStock).where(eq(bosStock.companyId, companyId)),
        db.select().from(bosTicket).where(eq(bosTicket.companyId, companyId)),
      ]);
      return {
        kind,
        bucket,
        data: kpiRollup({ invoices, deals, stock, tickets }),
      };
    }
  }
}

/**
 * Assemble the default BI dashboard payload: KPI rollup + monthly revenue trend
 * + sales-by-channel + top products + top customers + inventory valuation. One
 * cross-domain fetch, then pure functions.
 */
export async function dashboardData(
  db: Db,
  params: { companyId: string; nowIso?: string },
): Promise<DashboardDataResult> {
  const { companyId } = params;
  const nowIso = params.nowIso ?? new Date().toISOString();

  const [invoices, posOrders, onlineOrders, deals, stock, tickets, products] =
    await Promise.all([
      db.select().from(bosInvoice).where(eq(bosInvoice.companyId, companyId)),
      db.select().from(bosPosOrder).where(eq(bosPosOrder.companyId, companyId)),
      db
        .select()
        .from(bosOnlineOrder)
        .where(eq(bosOnlineOrder.companyId, companyId)),
      db.select().from(bosDeal).where(eq(bosDeal.companyId, companyId)),
      db.select().from(bosStock).where(eq(bosStock.companyId, companyId)),
      db.select().from(bosTicket).where(eq(bosTicket.companyId, companyId)),
      db.select().from(bosProduct).where(eq(bosProduct.companyId, companyId)),
    ]);

  return {
    kpis: kpiRollup({ invoices, deals, stock, tickets }),
    revenueTrend: revenueTrend(invoices, { bucket: "month", nowIso }),
    salesByModule: salesByModule({ posOrders, onlineOrders, invoices }),
    topProducts: topProducts(posOrders, onlineOrders, 5),
    topCustomers: topCustomers(invoices, 5),
    inventoryValuation: inventoryValuation(stock, products),
    generatedAt: nowIso,
  };
}

// ---------------------------------------------------------------------------
// CRUD: dashboards
// ---------------------------------------------------------------------------
export async function listDashboards(
  db: Db,
  params: { companyId: string },
): Promise<Array<typeof bosDashboard.$inferSelect>> {
  return db
    .select()
    .from(bosDashboard)
    .where(eq(bosDashboard.companyId, params.companyId))
    .orderBy(desc(bosDashboard.createdAt));
}

export async function saveDashboard(
  db: Db,
  params: {
    companyId: string;
    id?: string;
    name: string;
    layout?: unknown;
    isDefault?: boolean;
  },
): Promise<typeof bosDashboard.$inferSelect> {
  const layout = params.layout ?? [];
  const isDefault = params.isDefault ?? false;

  if (params.id) {
    const [row] = await db
      .update(bosDashboard)
      .set({ name: params.name, layout, isDefault, updatedAt: new Date() })
      .where(
        and(
          eq(bosDashboard.id, params.id),
          eq(bosDashboard.companyId, params.companyId),
        ),
      )
      .returning();
    if (!row) throw new Error("Dashboard not found");
    return row;
  }

  const [row] = await db
    .insert(bosDashboard)
    .values({
      companyId: params.companyId,
      name: params.name,
      layout,
      isDefault,
    })
    .returning();
  if (!row) throw new Error("Failed to create dashboard");
  return row;
}

// ---------------------------------------------------------------------------
// CRUD: reports
// ---------------------------------------------------------------------------
export async function listReports(
  db: Db,
  params: { companyId: string },
): Promise<Array<typeof bosReport.$inferSelect>> {
  return db
    .select()
    .from(bosReport)
    .where(eq(bosReport.companyId, params.companyId))
    .orderBy(desc(bosReport.createdAt));
}

export async function saveReport(
  db: Db,
  params: {
    companyId: string;
    id?: string;
    name: string;
    kind?: string;
    config?: unknown;
    schedule?: string | null;
  },
): Promise<typeof bosReport.$inferSelect> {
  const kind = params.kind ?? "custom";
  const config = params.config ?? {};
  const schedule = params.schedule ?? null;

  if (params.id) {
    const [row] = await db
      .update(bosReport)
      .set({ name: params.name, kind, config, schedule, updatedAt: new Date() })
      .where(
        and(
          eq(bosReport.id, params.id),
          eq(bosReport.companyId, params.companyId),
        ),
      )
      .returning();
    if (!row) throw new Error("Report not found");
    return row;
  }

  const [row] = await db
    .insert(bosReport)
    .values({ companyId: params.companyId, name: params.name, kind, config, schedule })
    .returning();
  if (!row) throw new Error("Failed to create report");
  return row;
}

// ---------------------------------------------------------------------------
// CRUD: saved queries
// ---------------------------------------------------------------------------
export async function listSavedQueries(
  db: Db,
  params: { companyId: string },
): Promise<Array<typeof bosSavedQuery.$inferSelect>> {
  return db
    .select()
    .from(bosSavedQuery)
    .where(eq(bosSavedQuery.companyId, params.companyId))
    .orderBy(desc(bosSavedQuery.createdAt));
}

export async function saveSavedQuery(
  db: Db,
  params: {
    companyId: string;
    id?: string;
    name: string;
    entity: string;
    filters?: unknown;
    columns?: unknown;
  },
): Promise<typeof bosSavedQuery.$inferSelect> {
  const filters = params.filters ?? {};
  const columns = params.columns ?? [];

  if (params.id) {
    const [row] = await db
      .update(bosSavedQuery)
      .set({
        name: params.name,
        entity: params.entity,
        filters,
        columns,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bosSavedQuery.id, params.id),
          eq(bosSavedQuery.companyId, params.companyId),
        ),
      )
      .returning();
    if (!row) throw new Error("Saved query not found");
    return row;
  }

  const [row] = await db
    .insert(bosSavedQuery)
    .values({
      companyId: params.companyId,
      name: params.name,
      entity: params.entity,
      filters,
      columns,
    })
    .returning();
  if (!row) throw new Error("Failed to create saved query");
  return row;
}
