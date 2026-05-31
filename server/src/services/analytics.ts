// ---------------------------------------------------------------------------
// Analytics / BI — pure, deterministic aggregation functions.
//
// Every function here takes plain arrays / primitives (NO database access) so
// they are fully unit-testable and side-effect free. The orchestration layer
// (bi.ts) is responsible for fetching rows from the database.
//
// Determinism note: any function whose output depends on "now" takes an
// explicit `nowIso` parameter instead of calling Date.now(), so tests are
// stable and the same inputs always produce the same outputs.
// ---------------------------------------------------------------------------

export type RevenueBucket = "day" | "month";

function toTime(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** Period key for a timestamp at the requested bucket granularity (UTC). */
function periodKey(value: string | Date | null | undefined, bucket: RevenueBucket): string | null {
  const t = toTime(value);
  if (t === null) return null;
  const d = new Date(t);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (bucket === "month") return `${year}-${month}`;
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Revenue trend
// ---------------------------------------------------------------------------
export interface RevenueInvoiceRow {
  status?: string | null;
  paidMinor?: number | null;
  totalMinor?: number | null;
  issueDate?: string | Date | null;
  createdAt?: string | Date | null;
}

export interface RevenueTrendPoint {
  period: string;
  revenueMinor: number;
}

/**
 * Group paid invoices by issue-date bucket and sum revenue (paidMinor, falling
 * back to totalMinor). Only invoices with status "paid" are counted. Buckets
 * are returned sorted ascending by period. `nowIso` is accepted for signature
 * consistency / future windowing but does not affect the deterministic output.
 */
export function revenueTrend(
  invoices: RevenueInvoiceRow[],
  opts: { bucket: RevenueBucket; nowIso: string },
): RevenueTrendPoint[] {
  void opts.nowIso;
  const byPeriod = new Map<string, number>();
  for (const inv of invoices) {
    if ((inv.status ?? "") !== "paid") continue;
    const key = periodKey(inv.issueDate ?? inv.createdAt, opts.bucket);
    if (key === null) continue;
    const amount = Number(inv.paidMinor ?? inv.totalMinor ?? 0);
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + amount);
  }
  return Array.from(byPeriod.entries())
    .map(([period, revenueMinor]) => ({ period, revenueMinor }))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Sales by module / channel
// ---------------------------------------------------------------------------
export type SalesModule = "pos" | "online" | "manual";

export interface SalesOrderRow {
  totalMinor?: number | null;
}

export interface SalesByModuleRow {
  module: SalesModule;
  count: number;
  totalMinor: number;
}

/**
 * Aggregate order counts and revenue across the three sales channels: POS
 * orders, online (storefront) orders, and manual invoices. Always returns all
 * three modules (zero-filled) in a stable order.
 */
export function salesByModule(args: {
  posOrders: SalesOrderRow[];
  onlineOrders: SalesOrderRow[];
  invoices: SalesOrderRow[];
}): SalesByModuleRow[] {
  const tally = (rows: SalesOrderRow[]): { count: number; totalMinor: number } => ({
    count: rows.length,
    totalMinor: rows.reduce((sum, r) => sum + Number(r.totalMinor ?? 0), 0),
  });
  return [
    { module: "pos", ...tally(args.posOrders) },
    { module: "online", ...tally(args.onlineOrders) },
    { module: "manual", ...tally(args.invoices) },
  ];
}

// ---------------------------------------------------------------------------
// Top products
// ---------------------------------------------------------------------------
export interface OrderLineRow {
  variantId?: string | null;
  productName?: string | null;
  name?: string | null;
  qty?: number | null;
  unitPriceMinor?: number | null;
}

export interface OrderWithLinesRow {
  lines?: unknown;
}

export interface TopProductRow {
  variantId: string | null;
  name: string;
  qty: number;
  revenueMinor: number;
}

function readLines(order: OrderWithLinesRow): OrderLineRow[] {
  return Array.isArray(order.lines) ? (order.lines as OrderLineRow[]) : [];
}

/**
 * Aggregate line items across POS + online orders, ranked by revenue desc
 * (qty * unitPriceMinor). Products are keyed by variantId when present, else by
 * name. Returns at most `limit` rows.
 */
export function topProducts(
  posOrders: OrderWithLinesRow[],
  onlineOrders: OrderWithLinesRow[],
  limit = 5,
): TopProductRow[] {
  const byKey = new Map<string, TopProductRow>();
  for (const order of [...posOrders, ...onlineOrders]) {
    for (const line of readLines(order)) {
      const variantId = line.variantId ?? null;
      const name = line.productName ?? line.name ?? variantId ?? "Unknown";
      const key = variantId ?? `name:${name}`;
      const qty = Number(line.qty ?? 0);
      const revenue = Math.round(qty * Number(line.unitPriceMinor ?? 0));
      const bucket = byKey.get(key) ?? {
        variantId,
        name,
        qty: 0,
        revenueMinor: 0,
      };
      bucket.qty += qty;
      bucket.revenueMinor += revenue;
      byKey.set(key, bucket);
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.revenueMinor - a.revenueMinor)
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// Top customers
// ---------------------------------------------------------------------------
export interface CustomerInvoiceRow {
  customerId?: string | null;
  customerName?: string | null;
  status?: string | null;
  paidMinor?: number | null;
  totalMinor?: number | null;
}

export interface TopCustomerRow {
  customer: string;
  totalMinor: number;
  orders: number;
}

/**
 * Aggregate paid invoices by customer (name preferred, id fallback) into total
 * revenue and order count, ranked by total desc. Returns at most `limit` rows.
 */
export function topCustomers(
  invoices: CustomerInvoiceRow[],
  limit = 5,
): TopCustomerRow[] {
  const byCustomer = new Map<string, TopCustomerRow>();
  for (const inv of invoices) {
    if ((inv.status ?? "") !== "paid") continue;
    const customer = inv.customerName ?? inv.customerId ?? "Unknown";
    const amount = Number(inv.paidMinor ?? inv.totalMinor ?? 0);
    const bucket = byCustomer.get(customer) ?? {
      customer,
      totalMinor: 0,
      orders: 0,
    };
    bucket.totalMinor += amount;
    bucket.orders += 1;
    byCustomer.set(customer, bucket);
  }
  return Array.from(byCustomer.values())
    .sort((a, b) => b.totalMinor - a.totalMinor)
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// KPI rollup
// ---------------------------------------------------------------------------
export interface KpiInvoiceRow {
  status?: string | null;
  paidMinor?: number | null;
  totalMinor?: number | null;
}

export interface KpiDealRow {
  status?: string | null;
  amountMinor?: number | null;
}

export interface KpiStockRow {
  qty?: number | null;
  reorderPoint?: number | null;
}

export interface KpiTicketRow {
  status?: string | null;
}

export interface KpiRollup {
  revenueMinor: number;
  avgOrderValueMinor: number;
  openDealsValueMinor: number;
  lowStockCount: number;
  openTickets: number;
  grossMarginPct?: number;
}

/**
 * Cross-domain KPI snapshot. Revenue = sum of paid invoices. Average order
 * value = revenue / number of paid invoices (0 when none). Open deals value =
 * sum of amountMinor over deals with status "open". Low stock = stock rows at
 * or below a positive reorder point. Open tickets = tickets not closed/resolved.
 */
export function kpiRollup(args: {
  invoices: KpiInvoiceRow[];
  deals: KpiDealRow[];
  stock: KpiStockRow[];
  tickets: KpiTicketRow[];
}): KpiRollup {
  const paid = args.invoices.filter((inv) => (inv.status ?? "") === "paid");
  const revenueMinor = paid.reduce(
    (sum, inv) => sum + Number(inv.paidMinor ?? inv.totalMinor ?? 0),
    0,
  );
  const avgOrderValueMinor =
    paid.length > 0 ? Math.round(revenueMinor / paid.length) : 0;

  const openDealsValueMinor = args.deals
    .filter((d) => (d.status ?? "open") === "open")
    .reduce((sum, d) => sum + Number(d.amountMinor ?? 0), 0);

  const lowStockCount = args.stock.filter((s) => {
    const reorderPoint = Number(s.reorderPoint ?? 0);
    return reorderPoint > 0 && Number(s.qty ?? 0) <= reorderPoint;
  }).length;

  const openTickets = args.tickets.filter(
    (t) => t.status !== "closed" && t.status !== "resolved",
  ).length;

  return {
    revenueMinor,
    avgOrderValueMinor,
    openDealsValueMinor,
    lowStockCount,
    openTickets,
  };
}

// ---------------------------------------------------------------------------
// Inventory valuation
// ---------------------------------------------------------------------------
export interface ValuationStockRow {
  variantId?: string | null;
  qty?: number | null;
}

export interface ValuationProductRow {
  id?: string | null;
  costMinor?: number | null;
  priceMinor?: number | null;
}

export interface InventoryValuation {
  totalUnits: number;
  totalCostMinor: number;
  totalRetailMinor: number;
}

/**
 * Value on-hand stock at cost and retail. Stock rows are matched to products by
 * variantId === product.id (variants share the product id space here); unmatched
 * stock contributes units but zero value. Negative quantities are ignored.
 */
export function inventoryValuation(
  stock: ValuationStockRow[],
  products: ValuationProductRow[],
): InventoryValuation {
  const productById = new Map<string, ValuationProductRow>();
  for (const p of products) {
    if (p.id) productById.set(p.id, p);
  }

  let totalUnits = 0;
  let totalCostMinor = 0;
  let totalRetailMinor = 0;

  for (const row of stock) {
    const qty = Number(row.qty ?? 0);
    if (qty <= 0) continue;
    totalUnits += qty;
    const product = row.variantId ? productById.get(row.variantId) : undefined;
    if (!product) continue;
    totalCostMinor += qty * Number(product.costMinor ?? 0);
    totalRetailMinor += qty * Number(product.priceMinor ?? 0);
  }

  return { totalUnits, totalCostMinor, totalRetailMinor };
}
