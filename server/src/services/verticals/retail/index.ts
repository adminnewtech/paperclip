/**
 * Retail vertical service.
 *
 * Encapsulates all the persistent operations for a retail store running on
 * Paperclip: locations, products with per-location stock, POS sales,
 * loyalty members, inventory transfers, and end-of-day reports.
 *
 * Persistence model
 * -----------------
 * We piggy-back on the generic `business_entities` JSONB table. All retail
 * entities share `moduleKey = "retail"` and are discriminated by `entityType`:
 *   - "location"           → store branch
 *   - "product"            → SKU with per-location stock map
 *   - "sale"               → POS sale (draft or completed)
 *   - "loyalty_member"     → customer enrolled in the loyalty program
 *   - "inventory_transfer" → stock transfer between locations
 *
 * Why one table? It lets the Retail vertical reuse the existing audit log,
 * search index, RBAC, and import/export pipelines that already operate on
 * `business_entities`. The trade-off is that we duplicate some validation
 * at the route boundary; we keep the service layer strict to compensate.
 */

import { and, desc, eq, ilike, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  calculateCheckout,
  validateBarcode,
  type CheckoutCalculation,
  type RetailSaleItem,
  type RetailSaleItemInput,
} from "./pos-checkout.js";
import {
  LOYALTY_TIERS,
  applyEarn,
  applyRedeem,
  calculatePointsEarned,
  calculatePointsValue,
  checkSufficientPoints,
  computeTier,
  type LoyaltyMember,
  type LoyaltyTier,
} from "./loyalty-engine.js";
import {
  createMultiLocationService,
  InsufficientStockError,
  type MultiLocationService,
} from "./multi-location.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetailLocation {
  id: string;
  code: string;
  name: string;
  nameAr?: string;
  address: string;
  phone?: string;
  isMain: boolean;
  posTerminals: number;
}

export interface RetailProduct {
  id: string;
  code: string;
  barcode?: string;
  name: string;
  nameAr?: string;
  category: string;
  brand?: string;
  unitPriceCents: number;
  costCents?: number;
  taxRatePercent: number;
  imageUrl?: string;
  description?: string;
  stockByLocation: Record<string, number>;
  reorderPoint?: number;
  isActive: boolean;
}

export type PaymentMethod = "cash" | "card" | "knet" | "loyalty" | "store_credit";

export interface RetailSalePayment {
  method: PaymentMethod;
  amountCents: number;
}

export type RetailSaleStatus =
  | "draft"
  | "completed"
  | "refunded"
  | "partially_refunded"
  | "void";

export interface RetailSale {
  id: string;
  code: string;
  locationId: string;
  cashierId?: string;
  cashierName?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  loyaltyMemberId?: string;
  items: RetailSaleItem[];
  subtotalCents: number;
  discountCents: number;
  loyaltyPointsRedeemedCents: number;
  taxCents: number;
  totalCents: number;
  payments: RetailSalePayment[];
  changeCents: number;
  status: RetailSaleStatus;
  loyaltyPointsEarned: number;
  refundedFromSaleId?: string;
  notes?: string;
  createdAt: string;
}

export interface InventoryTransfer {
  id: string;
  code: string;
  fromLocationId: string;
  toLocationId: string;
  items: Array<{ productId: string; quantity: number }>;
  status: "draft" | "in_transit" | "received" | "cancelled";
  shippedAt?: string;
  receivedAt?: string;
}

export interface EndOfDayReport {
  date: string;
  locationId: string;
  cashOpenCents: number;
  totalSalesCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  knetSalesCents: number;
  refundsCents: number;
  expectedCashCents: number;
  actualCashCents?: number;
  varianceCents?: number;
  salesCount: number;
  topProducts: Array<{ name: string; quantity: number }>;
}

export interface RetailDashboard {
  salesToday: { count: number; totalCents: number };
  salesThisMonth: { count: number; totalCents: number };
  topProducts: Array<{ name: string; quantity: number; revenueCents: number }>;
  lowStock: Array<{ productId: string; name: string; totalStock: number; reorderPoint: number }>;
  loyaltyMembers: { total: number; byTier: Record<LoyaltyTier, number> };
  locationCount: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface RetailService {
  // Locations
  listLocations(companyId: string): Promise<RetailLocation[]>;
  createLocation(companyId: string, input: Omit<RetailLocation, "id" | "code">): Promise<RetailLocation>;
  updateLocation(companyId: string, id: string, patch: Partial<RetailLocation>): Promise<RetailLocation>;
  deleteLocation(companyId: string, id: string): Promise<void>;

  // Products
  listProducts(
    companyId: string,
    opts?: { locationId?: string; q?: string; lowStockOnly?: boolean },
  ): Promise<RetailProduct[]>;
  getProductByBarcode(companyId: string, barcode: string): Promise<RetailProduct | null>;
  createProduct(companyId: string, input: Omit<RetailProduct, "id" | "code">): Promise<RetailProduct>;
  updateProduct(companyId: string, id: string, patch: Partial<RetailProduct>): Promise<RetailProduct>;
  setStock(
    companyId: string,
    productId: string,
    locationId: string,
    quantity: number,
    reason?: string,
  ): Promise<RetailProduct>;

  // Sales
  startSale(companyId: string, locationId: string, cashierId?: string): Promise<RetailSale>;
  addItemToSale(
    companyId: string,
    saleId: string,
    item: { barcode?: string; productId?: string; quantity: number },
  ): Promise<RetailSale>;
  removeItemFromSale(companyId: string, saleId: string, itemIndex: number): Promise<RetailSale>;
  applyDiscount(
    companyId: string,
    saleId: string,
    opts: { type: "amount" | "percent"; value: number; reason?: string },
  ): Promise<RetailSale>;
  attachCustomer(companyId: string, saleId: string, customerId: string): Promise<RetailSale>;
  attachLoyaltyMember(companyId: string, saleId: string, phone: string): Promise<RetailSale>;
  redeemLoyaltyPoints(companyId: string, saleId: string, points: number): Promise<RetailSale>;
  takePayment(
    companyId: string,
    saleId: string,
    payment: { method: PaymentMethod; amountCents: number },
  ): Promise<RetailSale>;
  completeSale(companyId: string, saleId: string): Promise<RetailSale>;
  voidSale(companyId: string, saleId: string, reason: string): Promise<RetailSale>;
  refundSale(
    companyId: string,
    saleId: string,
    opts: { items?: number[]; reason: string },
  ): Promise<RetailSale>;
  listSales(
    companyId: string,
    opts?: { locationId?: string; date?: string; status?: RetailSaleStatus; limit?: number },
  ): Promise<RetailSale[]>;
  getSale(companyId: string, saleId: string): Promise<RetailSale | null>;

  // Loyalty
  listLoyaltyMembers(
    companyId: string,
    opts?: { q?: string; tier?: string },
  ): Promise<LoyaltyMember[]>;
  enrollLoyaltyMember(
    companyId: string,
    input: { customerId: string; customerName: string; phone: string; email?: string; birthMonth?: number },
  ): Promise<LoyaltyMember>;
  adjustPoints(
    companyId: string,
    memberId: string,
    points: number,
    reason: string,
  ): Promise<LoyaltyMember>;
  getLoyaltyMember(companyId: string, id: string): Promise<LoyaltyMember | null>;

  // Multi-location inventory
  createTransfer(
    companyId: string,
    input: {
      fromLocationId: string;
      toLocationId: string;
      items: Array<{ productId: string; quantity: number }>;
    },
  ): Promise<InventoryTransfer>;
  shipTransfer(companyId: string, id: string): Promise<InventoryTransfer>;
  receiveTransfer(companyId: string, id: string): Promise<InventoryTransfer>;
  listTransfers(companyId: string): Promise<InventoryTransfer[]>;

  // End of day
  getEndOfDayReport(companyId: string, locationId: string, date: string): Promise<EndOfDayReport>;
  closeEndOfDay(
    companyId: string,
    locationId: string,
    date: string,
    actualCashCents: number,
  ): Promise<EndOfDayReport>;

  // Setup
  setupDefaults(companyId: string): Promise<void>;

  // Dashboard
  getDashboard(companyId: string, opts?: { locationId?: string }): Promise<RetailDashboard>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const MODULE_KEY = "retail";
const COUNTRY_VAT_PERCENT_DEFAULT = 5;

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function padNum(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Generate the next sequential code for a given retail entity type.
 * Examples:
 *   LOC-001, LOC-002, ...
 *   SAL-YYYYMMDD-00001
 *   LM-000001
 *   TRF-001
 *   PROD-0001
 */
async function nextRetailCode(
  db: Db,
  companyId: string,
  entityType: string,
  prefix: string,
  options?: { width?: number; dateStamp?: string },
): Promise<string> {
  const width = options?.width ?? 3;
  const datePart = options?.dateStamp ? `-${options.dateStamp}` : "";
  const pattern = `${prefix}${datePart}-%`;
  const [last] = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, MODULE_KEY),
        eq(businessEntities.entityType, entityType),
        ilike(businessEntities.code, pattern),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);
  let num = 1;
  if (last?.code) {
    const tail = last.code.split("-").pop() ?? "0";
    const parsed = parseInt(tail, 10);
    if (!Number.isNaN(parsed)) num = parsed + 1;
  }
  return `${prefix}${datePart}-${padNum(num, width)}`;
}

// ---- Row → domain mappers --------------------------------------------------

type Row = typeof businessEntities.$inferSelect;

function rowToLocation(row: Row): RetailLocation {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? "",
    nameAr: typeof data.nameAr === "string" ? data.nameAr : undefined,
    address: typeof data.address === "string" ? data.address : "",
    phone: typeof data.phone === "string" ? data.phone : undefined,
    isMain: data.isMain === true,
    posTerminals: typeof data.posTerminals === "number" ? data.posTerminals : 1,
  };
}

function rowToProduct(row: Row): RetailProduct {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const stockByLocation: Record<string, number> = {};
  if (data.stockByLocation && typeof data.stockByLocation === "object") {
    for (const [k, v] of Object.entries(data.stockByLocation as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) stockByLocation[k] = Math.trunc(v);
    }
  }
  return {
    id: row.id,
    code: row.code ?? "",
    barcode: typeof data.barcode === "string" ? data.barcode : undefined,
    name: row.name ?? "",
    nameAr: typeof data.nameAr === "string" ? data.nameAr : undefined,
    category: typeof data.category === "string" ? data.category : "general",
    brand: typeof data.brand === "string" ? data.brand : undefined,
    unitPriceCents:
      typeof data.unitPriceCents === "number"
        ? data.unitPriceCents
        : row.amountCents ?? 0,
    costCents: typeof data.costCents === "number" ? data.costCents : undefined,
    taxRatePercent:
      typeof data.taxRatePercent === "number"
        ? data.taxRatePercent
        : COUNTRY_VAT_PERCENT_DEFAULT,
    imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,
    description: typeof data.description === "string" ? data.description : undefined,
    stockByLocation,
    reorderPoint:
      typeof data.reorderPoint === "number" ? data.reorderPoint : undefined,
    isActive: row.status !== "inactive",
  };
}

function rowToSale(row: Row): RetailSale {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    code: row.code ?? "",
    locationId: typeof data.locationId === "string" ? data.locationId : "",
    cashierId: typeof data.cashierId === "string" ? data.cashierId : undefined,
    cashierName: typeof data.cashierName === "string" ? data.cashierName : undefined,
    customerId: typeof data.customerId === "string" ? data.customerId : undefined,
    customerName: typeof data.customerName === "string" ? data.customerName : undefined,
    customerPhone: typeof data.customerPhone === "string" ? data.customerPhone : undefined,
    loyaltyMemberId:
      typeof data.loyaltyMemberId === "string" ? data.loyaltyMemberId : undefined,
    items: Array.isArray(data.items) ? (data.items as RetailSaleItem[]) : [],
    subtotalCents: typeof data.subtotalCents === "number" ? data.subtotalCents : 0,
    discountCents: typeof data.discountCents === "number" ? data.discountCents : 0,
    loyaltyPointsRedeemedCents:
      typeof data.loyaltyPointsRedeemedCents === "number"
        ? data.loyaltyPointsRedeemedCents
        : 0,
    taxCents: typeof data.taxCents === "number" ? data.taxCents : 0,
    totalCents: typeof data.totalCents === "number" ? data.totalCents : row.amountCents ?? 0,
    payments: Array.isArray(data.payments)
      ? (data.payments as RetailSalePayment[])
      : [],
    changeCents: typeof data.changeCents === "number" ? data.changeCents : 0,
    status: (row.status as RetailSaleStatus) ?? "draft",
    loyaltyPointsEarned:
      typeof data.loyaltyPointsEarned === "number" ? data.loyaltyPointsEarned : 0,
    refundedFromSaleId:
      typeof data.refundedFromSaleId === "string" ? data.refundedFromSaleId : undefined,
    notes: typeof data.notes === "string" ? data.notes : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToLoyaltyMember(row: Row): LoyaltyMember {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    code: row.code ?? "",
    customerId: typeof data.customerId === "string" ? data.customerId : "",
    customerName: row.name ?? "",
    phone: typeof data.phone === "string" ? data.phone : "",
    email: typeof data.email === "string" ? data.email : undefined,
    tier: ((typeof data.tier === "string" ? data.tier : "bronze") as LoyaltyTier),
    pointsBalance:
      typeof data.pointsBalance === "number" ? data.pointsBalance : 0,
    pointsLifetimeEarned:
      typeof data.pointsLifetimeEarned === "number" ? data.pointsLifetimeEarned : 0,
    pointsLifetimeRedeemed:
      typeof data.pointsLifetimeRedeemed === "number" ? data.pointsLifetimeRedeemed : 0,
    birthMonth:
      typeof data.birthMonth === "number" ? data.birthMonth : undefined,
    enrolledAt: row.createdAt.toISOString(),
    lastActivityAt:
      typeof data.lastActivityAt === "string" ? data.lastActivityAt : undefined,
  };
}

function rowToTransfer(row: Row): InventoryTransfer {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    code: row.code ?? "",
    fromLocationId: typeof data.fromLocationId === "string" ? data.fromLocationId : "",
    toLocationId: typeof data.toLocationId === "string" ? data.toLocationId : "",
    items: Array.isArray(data.items)
      ? (data.items as Array<{ productId: string; quantity: number }>)
      : [],
    status: (row.status as InventoryTransfer["status"]) ?? "draft",
    shippedAt:
      typeof data.shippedAt === "string" ? data.shippedAt : undefined,
    receivedAt:
      typeof data.receivedAt === "string" ? data.receivedAt : undefined,
  };
}

// ---------------------------------------------------------------------------

export function createRetailService(db: Db): RetailService {
  const multiLocation: MultiLocationService = createMultiLocationService(db);

  // ----- Locations -------------------------------------------------------

  async function listLocations(companyId: string): Promise<RetailLocation[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "location"),
        ),
      )
      .orderBy(businessEntities.code);
    return rows.map(rowToLocation);
  }

  async function createLocation(
    companyId: string,
    input: Omit<RetailLocation, "id" | "code">,
  ): Promise<RetailLocation> {
    const code = await nextRetailCode(db, companyId, "location", "LOC");
    const existingMain = await listLocations(companyId);
    const isMain = existingMain.length === 0 ? true : input.isMain;
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: MODULE_KEY,
        entityType: "location",
        code,
        name: input.name,
        status: "active",
        data: {
          nameAr: input.nameAr,
          address: input.address,
          phone: input.phone,
          isMain,
          posTerminals: input.posTerminals,
        },
      })
      .returning();
    return rowToLocation(row!);
  }

  async function updateLocation(
    companyId: string,
    id: string,
    patch: Partial<RetailLocation>,
  ): Promise<RetailLocation> {
    const [existing] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "location"),
        ),
      )
      .limit(1);
    if (!existing) throw new Error(`Location ${id} not found`);
    const data = (existing.data ?? {}) as Record<string, unknown>;
    const merged = {
      ...data,
      ...(patch.nameAr !== undefined ? { nameAr: patch.nameAr } : {}),
      ...(patch.address !== undefined ? { address: patch.address } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.isMain !== undefined ? { isMain: patch.isMain } : {}),
      ...(patch.posTerminals !== undefined
        ? { posTerminals: patch.posTerminals }
        : {}),
    };
    const [row] = await db
      .update(businessEntities)
      .set({
        name: patch.name ?? existing.name,
        data: merged,
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, id))
      .returning();
    return rowToLocation(row!);
  }

  async function deleteLocation(companyId: string, id: string): Promise<void> {
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "location"),
        ),
      );
  }

  // ----- Products --------------------------------------------------------

  async function listProducts(
    companyId: string,
    opts?: { locationId?: string; q?: string; lowStockOnly?: boolean },
  ): Promise<RetailProduct[]> {
    let qb = db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "product"),
          opts?.q
            ? sql`(${businessEntities.name} ILIKE ${"%" + opts.q + "%"} OR ${businessEntities.code} ILIKE ${"%" + opts.q + "%"})`
            : sql`TRUE`,
        ),
      )
      .orderBy(businessEntities.name)
      .$dynamic();
    const rows = await qb;
    let products = rows.map(rowToProduct);
    if (opts?.locationId) {
      products = products.map((p) => ({
        ...p,
        stockByLocation: {
          [opts.locationId!]: p.stockByLocation[opts.locationId!] ?? 0,
        },
      }));
    }
    if (opts?.lowStockOnly) {
      products = products.filter((p) => {
        if (p.reorderPoint === undefined) return false;
        const total = Object.values(p.stockByLocation).reduce((s, n) => s + n, 0);
        return total <= p.reorderPoint;
      });
    }
    return products;
  }

  async function getProductByBarcode(
    companyId: string,
    barcode: string,
  ): Promise<RetailProduct | null> {
    const trimmed = barcode.trim();
    if (!trimmed) return null;
    // Match by the canonical barcode stored inside `data`. The `code` column
    // holds the human SKU (PROD-0001) so we filter on the JSONB key.
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "product"),
          sql`${businessEntities.data}->>'barcode' = ${trimmed}`,
        ),
      )
      .limit(1);
    if (!rows[0]) return null;
    return rowToProduct(rows[0]);
  }

  async function createProduct(
    companyId: string,
    input: Omit<RetailProduct, "id" | "code">,
  ): Promise<RetailProduct> {
    const code = await nextRetailCode(db, companyId, "product", "PROD", { width: 4 });
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: MODULE_KEY,
        entityType: "product",
        code,
        name: input.name,
        status: input.isActive === false ? "inactive" : "active",
        amountCents: input.unitPriceCents,
        currency: "KWD",
        data: {
          nameAr: input.nameAr,
          barcode: input.barcode,
          category: input.category,
          brand: input.brand,
          unitPriceCents: input.unitPriceCents,
          costCents: input.costCents,
          taxRatePercent: input.taxRatePercent ?? COUNTRY_VAT_PERCENT_DEFAULT,
          imageUrl: input.imageUrl,
          description: input.description,
          stockByLocation: input.stockByLocation ?? {},
          reorderPoint: input.reorderPoint,
        },
      })
      .returning();
    return rowToProduct(row!);
  }

  async function updateProduct(
    companyId: string,
    id: string,
    patch: Partial<RetailProduct>,
  ): Promise<RetailProduct> {
    const [existing] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "product"),
        ),
      )
      .limit(1);
    if (!existing) throw new Error(`Product ${id} not found`);
    const data = (existing.data ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...data };
    const keys: Array<keyof RetailProduct> = [
      "nameAr",
      "barcode",
      "category",
      "brand",
      "unitPriceCents",
      "costCents",
      "taxRatePercent",
      "imageUrl",
      "description",
      "stockByLocation",
      "reorderPoint",
    ];
    for (const k of keys) {
      if (patch[k] !== undefined) merged[k as string] = patch[k];
    }
    const [row] = await db
      .update(businessEntities)
      .set({
        name: patch.name ?? existing.name,
        status:
          patch.isActive === undefined
            ? existing.status
            : patch.isActive
              ? "active"
              : "inactive",
        amountCents:
          patch.unitPriceCents !== undefined
            ? patch.unitPriceCents
            : existing.amountCents,
        data: merged,
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, id))
      .returning();
    return rowToProduct(row!);
  }

  async function setStock(
    companyId: string,
    productId: string,
    locationId: string,
    quantity: number,
    _reason?: string,
  ): Promise<RetailProduct> {
    const [existing] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, productId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "product"),
        ),
      )
      .limit(1);
    if (!existing) throw new Error(`Product ${productId} not found`);
    const data = (existing.data ?? {}) as Record<string, unknown>;
    const currentMap =
      data.stockByLocation && typeof data.stockByLocation === "object"
        ? { ...(data.stockByLocation as Record<string, number>) }
        : {};
    currentMap[locationId] = Math.max(0, Math.trunc(quantity));
    const [row] = await db
      .update(businessEntities)
      .set({
        data: { ...data, stockByLocation: currentMap },
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, productId))
      .returning();
    return rowToProduct(row!);
  }

  // ----- Sales -----------------------------------------------------------

  async function recomputeSaleTotals(
    sale: RetailSale,
    loyaltyTier?: LoyaltyTier,
  ): Promise<RetailSale> {
    const itemsInput: RetailSaleItemInput[] = sale.items.map((it) => ({
      productId: it.productId,
      productName: it.productName,
      barcode: it.barcode,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      discountCents: 0, // per-line discounts handled separately in v1
      taxRatePercent: it.taxRatePercent,
    }));
    const points = Math.floor(sale.loyaltyPointsRedeemedCents / 10);
    const calc: CheckoutCalculation = calculateCheckout(itemsInput, {
      overallDiscountCents: sale.discountCents,
      loyaltyPointsToRedeem: points,
      loyaltyTier: loyaltyTier ?? "bronze",
      countryVatPercent: COUNTRY_VAT_PERCENT_DEFAULT,
    });
    return {
      ...sale,
      items: calc.items,
      subtotalCents: calc.subtotalCents,
      taxCents: calc.taxCents,
      totalCents: calc.totalCents,
      loyaltyPointsRedeemedCents: calc.loyaltyDiscountCents,
      loyaltyPointsEarned: calc.loyaltyPointsEarned,
    };
  }

  async function persistSale(
    companyId: string,
    sale: RetailSale,
  ): Promise<RetailSale> {
    const [row] = await db
      .update(businessEntities)
      .set({
        status: sale.status,
        amountCents: sale.totalCents,
        currency: "KWD",
        data: {
          locationId: sale.locationId,
          cashierId: sale.cashierId,
          cashierName: sale.cashierName,
          customerId: sale.customerId,
          customerName: sale.customerName,
          customerPhone: sale.customerPhone,
          loyaltyMemberId: sale.loyaltyMemberId,
          items: sale.items,
          subtotalCents: sale.subtotalCents,
          discountCents: sale.discountCents,
          loyaltyPointsRedeemedCents: sale.loyaltyPointsRedeemedCents,
          taxCents: sale.taxCents,
          totalCents: sale.totalCents,
          payments: sale.payments,
          changeCents: sale.changeCents,
          loyaltyPointsEarned: sale.loyaltyPointsEarned,
          refundedFromSaleId: sale.refundedFromSaleId,
          notes: sale.notes,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.id, sale.id),
          eq(businessEntities.companyId, companyId),
        ),
      )
      .returning();
    if (!row) throw new Error(`Sale ${sale.id} not found`);
    return rowToSale(row);
  }

  async function loadSale(companyId: string, saleId: string): Promise<RetailSale> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, saleId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "sale"),
        ),
      )
      .limit(1);
    if (!row) throw new Error(`Sale ${saleId} not found`);
    return rowToSale(row);
  }

  async function startSale(
    companyId: string,
    locationId: string,
    cashierId?: string,
  ): Promise<RetailSale> {
    const today = new Date();
    const stamp = `${today.getFullYear()}${padNum(today.getMonth() + 1, 2)}${padNum(today.getDate(), 2)}`;
    const code = await nextRetailCode(db, companyId, "sale", "SAL", {
      dateStamp: stamp,
      width: 5,
    });
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: MODULE_KEY,
        entityType: "sale",
        code,
        name: `POS sale ${code}`,
        status: "draft",
        amountCents: 0,
        currency: "KWD",
        data: {
          locationId,
          cashierId,
          items: [],
          subtotalCents: 0,
          discountCents: 0,
          loyaltyPointsRedeemedCents: 0,
          taxCents: 0,
          totalCents: 0,
          payments: [],
          changeCents: 0,
          loyaltyPointsEarned: 0,
        },
      })
      .returning();
    return rowToSale(row!);
  }

  async function addItemToSale(
    companyId: string,
    saleId: string,
    item: { barcode?: string; productId?: string; quantity: number },
  ): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    if (sale.status !== "draft") throw new Error(`Sale is ${sale.status}, cannot add items`);

    let product: RetailProduct | null = null;
    if (item.productId) {
      const [row] = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.id, item.productId),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, MODULE_KEY),
            eq(businessEntities.entityType, "product"),
          ),
        )
        .limit(1);
      if (row) product = rowToProduct(row);
    } else if (item.barcode) {
      if (!validateBarcode(item.barcode)) {
        throw new Error(`Invalid barcode format: ${item.barcode}`);
      }
      product = await getProductByBarcode(companyId, item.barcode);
    }
    if (!product) throw new Error("Product not found");

    const qty = Math.max(1, Math.trunc(item.quantity));

    // Merge with existing line for the same product to keep the cart tidy.
    const existingIndex = sale.items.findIndex((it) => it.productId === product!.id);
    if (existingIndex >= 0) {
      sale.items[existingIndex] = {
        ...sale.items[existingIndex]!,
        quantity: sale.items[existingIndex]!.quantity + qty,
      };
    } else {
      sale.items.push({
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        quantity: qty,
        unitPriceCents: product.unitPriceCents,
        discountCents: 0,
        taxRatePercent: product.taxRatePercent,
        lineTaxCents: 0,
        lineTotalCents: 0,
      });
    }

    const tier = sale.loyaltyMemberId
      ? (await getLoyaltyMember(companyId, sale.loyaltyMemberId))?.tier
      : undefined;
    const recomputed = await recomputeSaleTotals(sale, tier);
    return persistSale(companyId, recomputed);
  }

  async function removeItemFromSale(
    companyId: string,
    saleId: string,
    itemIndex: number,
  ): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    if (sale.status !== "draft") throw new Error(`Sale is ${sale.status}`);
    if (itemIndex < 0 || itemIndex >= sale.items.length) {
      throw new Error(`Invalid item index ${itemIndex}`);
    }
    sale.items.splice(itemIndex, 1);
    const tier = sale.loyaltyMemberId
      ? (await getLoyaltyMember(companyId, sale.loyaltyMemberId))?.tier
      : undefined;
    return persistSale(companyId, await recomputeSaleTotals(sale, tier));
  }

  async function applyDiscount(
    companyId: string,
    saleId: string,
    opts: { type: "amount" | "percent"; value: number; reason?: string },
  ): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    if (sale.status !== "draft") throw new Error(`Sale is ${sale.status}`);
    const grossSubtotal = sale.items.reduce(
      (s, it) => s + it.unitPriceCents * it.quantity,
      0,
    );
    const discountCents =
      opts.type === "amount"
        ? Math.max(0, Math.trunc(opts.value))
        : Math.floor((grossSubtotal * Math.max(0, opts.value)) / 100);
    sale.discountCents = Math.min(discountCents, grossSubtotal);
    if (opts.reason) sale.notes = `${sale.notes ?? ""}\nDiscount: ${opts.reason}`.trim();
    const tier = sale.loyaltyMemberId
      ? (await getLoyaltyMember(companyId, sale.loyaltyMemberId))?.tier
      : undefined;
    return persistSale(companyId, await recomputeSaleTotals(sale, tier));
  }

  async function attachCustomer(
    companyId: string,
    saleId: string,
    customerId: string,
  ): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    // Pull the contact name/phone if available.
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, customerId),
          eq(businessEntities.companyId, companyId),
        ),
      )
      .limit(1);
    sale.customerId = customerId;
    if (row) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      sale.customerName = row.name ?? sale.customerName;
      if (typeof data.phone === "string") sale.customerPhone = data.phone;
    }
    return persistSale(companyId, sale);
  }

  async function attachLoyaltyMember(
    companyId: string,
    saleId: string,
    phone: string,
  ): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "loyalty_member"),
          sql`${businessEntities.data}->>'phone' = ${phone.trim()}`,
        ),
      )
      .limit(1);
    if (!rows[0]) throw new Error(`No loyalty member with phone ${phone}`);
    const member = rowToLoyaltyMember(rows[0]);
    sale.loyaltyMemberId = member.id;
    sale.customerId = sale.customerId ?? member.customerId;
    sale.customerName = sale.customerName ?? member.customerName;
    sale.customerPhone = member.phone;
    return persistSale(companyId, await recomputeSaleTotals(sale, member.tier));
  }

  async function redeemLoyaltyPoints(
    companyId: string,
    saleId: string,
    points: number,
  ): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    if (!sale.loyaltyMemberId) throw new Error("Attach a loyalty member first");
    const member = await getLoyaltyMember(companyId, sale.loyaltyMemberId);
    if (!member) throw new Error("Loyalty member missing");
    const requested = Math.max(0, Math.trunc(points));
    if (!checkSufficientPoints(member, requested)) {
      throw new Error(
        `Member has only ${member.pointsBalance} points (requested ${requested})`,
      );
    }
    sale.loyaltyPointsRedeemedCents = calculatePointsValue(requested);
    return persistSale(companyId, await recomputeSaleTotals(sale, member.tier));
  }

  async function takePayment(
    companyId: string,
    saleId: string,
    payment: { method: PaymentMethod; amountCents: number },
  ): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    if (sale.status !== "draft") throw new Error(`Sale is ${sale.status}`);
    sale.payments = [
      ...sale.payments,
      {
        method: payment.method,
        amountCents: Math.max(0, Math.trunc(payment.amountCents)),
      },
    ];
    return persistSale(companyId, sale);
  }

  async function completeSale(companyId: string, saleId: string): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    if (sale.status !== "draft") throw new Error(`Sale is ${sale.status}`);
    if (sale.items.length === 0) throw new Error("Cannot complete an empty sale");

    const paidCents = sale.payments.reduce((s, p) => s + p.amountCents, 0);
    if (paidCents < sale.totalCents) {
      throw new Error(
        `Insufficient payment: total ${sale.totalCents} fils, paid ${paidCents} fils`,
      );
    }
    sale.changeCents = Math.max(0, paidCents - sale.totalCents);
    sale.status = "completed";

    // Decrement stock atomically per location. If any item lacks stock the
    // whole completion fails and the sale stays draft.
    for (const item of sale.items) {
      try {
        await multiLocation.decrementStock(
          companyId,
          item.productId,
          sale.locationId,
          item.quantity,
          { refType: "sale", refId: sale.id, reason: "POS sale" },
        );
      } catch (err) {
        if (err instanceof InsufficientStockError) {
          throw new Error(
            `Insufficient stock for ${item.productName} at this location`,
          );
        }
        throw err;
      }
    }

    // Loyalty: credit earned points, debit redeemed points.
    if (sale.loyaltyMemberId) {
      const member = await getLoyaltyMember(companyId, sale.loyaltyMemberId);
      if (member) {
        let next = member;
        const redeemedPoints = Math.floor(sale.loyaltyPointsRedeemedCents / 10);
        if (redeemedPoints > 0) next = applyRedeem(next, redeemedPoints);
        if (sale.loyaltyPointsEarned > 0) next = applyEarn(next, sale.loyaltyPointsEarned);
        await persistLoyaltyMember(companyId, next);
      }
    }

    return persistSale(companyId, sale);
  }

  async function voidSale(
    companyId: string,
    saleId: string,
    reason: string,
  ): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    if (sale.status === "void") return sale;
    if (sale.status === "completed" || sale.status === "partially_refunded") {
      throw new Error("Use refund for completed sales");
    }
    sale.status = "void";
    sale.notes = `${sale.notes ?? ""}\nVoided: ${reason}`.trim();
    return persistSale(companyId, sale);
  }

  async function refundSale(
    companyId: string,
    saleId: string,
    opts: { items?: number[]; reason: string },
  ): Promise<RetailSale> {
    const sale = await loadSale(companyId, saleId);
    if (sale.status !== "completed" && sale.status !== "partially_refunded") {
      throw new Error("Only completed sales can be refunded");
    }
    const indices = opts.items && opts.items.length > 0 ? opts.items : sale.items.map((_, i) => i);

    // Return stock to the location for the refunded lines.
    for (const idx of indices) {
      const item = sale.items[idx];
      if (!item || item.refunded) continue;
      try {
        await multiLocation.incrementStock(
          companyId,
          item.productId,
          sale.locationId,
          item.quantity,
          { refType: "refund", refId: sale.id, reason: opts.reason },
        );
      } catch {
        // best-effort: product may have been deleted; skip
      }
      item.refunded = true;
    }
    sale.items = [...sale.items];
    const fullyRefunded = sale.items.every((it) => it.refunded);
    sale.status = fullyRefunded ? "refunded" : "partially_refunded";
    sale.notes = `${sale.notes ?? ""}\nRefund: ${opts.reason}`.trim();
    return persistSale(companyId, sale);
  }

  async function listSales(
    companyId: string,
    opts?: {
      locationId?: string;
      date?: string;
      status?: RetailSaleStatus;
      limit?: number;
    },
  ): Promise<RetailSale[]> {
    const limit = opts?.limit ?? 200;
    const conditions = [
      eq(businessEntities.companyId, companyId),
      eq(businessEntities.moduleKey, MODULE_KEY),
      eq(businessEntities.entityType, "sale"),
    ];
    if (opts?.status) conditions.push(eq(businessEntities.status, opts.status));
    if (opts?.locationId) {
      conditions.push(sql`${businessEntities.data}->>'locationId' = ${opts.locationId}`);
    }
    if (opts?.date) {
      const day = opts.date;
      conditions.push(sql`to_char(${businessEntities.createdAt}, 'YYYY-MM-DD') = ${day}`);
    }
    const rows = await db
      .select()
      .from(businessEntities)
      .where(and(...conditions))
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit);
    return rows.map(rowToSale);
  }

  async function getSale(
    companyId: string,
    saleId: string,
  ): Promise<RetailSale | null> {
    try {
      return await loadSale(companyId, saleId);
    } catch {
      return null;
    }
  }

  // ----- Loyalty ---------------------------------------------------------

  async function listLoyaltyMembers(
    companyId: string,
    opts?: { q?: string; tier?: string },
  ): Promise<LoyaltyMember[]> {
    const conditions = [
      eq(businessEntities.companyId, companyId),
      eq(businessEntities.moduleKey, MODULE_KEY),
      eq(businessEntities.entityType, "loyalty_member"),
    ];
    if (opts?.q) {
      conditions.push(
        sql`(${businessEntities.name} ILIKE ${"%" + opts.q + "%"} OR ${businessEntities.data}->>'phone' ILIKE ${"%" + opts.q + "%"})`,
      );
    }
    if (opts?.tier) {
      conditions.push(sql`${businessEntities.data}->>'tier' = ${opts.tier}`);
    }
    const rows = await db
      .select()
      .from(businessEntities)
      .where(and(...conditions))
      .orderBy(desc(businessEntities.createdAt));
    return rows.map(rowToLoyaltyMember);
  }

  async function enrollLoyaltyMember(
    companyId: string,
    input: {
      customerId: string;
      customerName: string;
      phone: string;
      email?: string;
      birthMonth?: number;
    },
  ): Promise<LoyaltyMember> {
    // Prevent duplicate enrollment by phone.
    const existing = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "loyalty_member"),
          sql`${businessEntities.data}->>'phone' = ${input.phone.trim()}`,
        ),
      )
      .limit(1);
    if (existing[0]) return rowToLoyaltyMember(existing[0]);

    const code = await nextRetailCode(db, companyId, "loyalty_member", "LM", { width: 6 });
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: MODULE_KEY,
        entityType: "loyalty_member",
        code,
        name: input.customerName,
        status: "active",
        data: {
          customerId: input.customerId,
          phone: input.phone,
          email: input.email,
          tier: "bronze",
          pointsBalance: 0,
          pointsLifetimeEarned: 0,
          pointsLifetimeRedeemed: 0,
          birthMonth: input.birthMonth,
        },
      })
      .returning();
    return rowToLoyaltyMember(row!);
  }

  async function persistLoyaltyMember(
    companyId: string,
    member: LoyaltyMember,
  ): Promise<LoyaltyMember> {
    const [row] = await db
      .update(businessEntities)
      .set({
        name: member.customerName,
        data: {
          customerId: member.customerId,
          phone: member.phone,
          email: member.email,
          tier: member.tier,
          pointsBalance: member.pointsBalance,
          pointsLifetimeEarned: member.pointsLifetimeEarned,
          pointsLifetimeRedeemed: member.pointsLifetimeRedeemed,
          birthMonth: member.birthMonth,
          lastActivityAt: member.lastActivityAt,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.id, member.id),
          eq(businessEntities.companyId, companyId),
        ),
      )
      .returning();
    if (!row) throw new Error(`Loyalty member ${member.id} not found`);
    return rowToLoyaltyMember(row);
  }

  async function adjustPoints(
    companyId: string,
    memberId: string,
    points: number,
    _reason: string,
  ): Promise<LoyaltyMember> {
    const member = await getLoyaltyMember(companyId, memberId);
    if (!member) throw new Error(`Member ${memberId} not found`);
    const delta = Math.trunc(points);
    let next: LoyaltyMember;
    if (delta >= 0) next = applyEarn(member, delta);
    else {
      const toRedeem = Math.min(-delta, member.pointsBalance);
      next = applyRedeem(member, toRedeem);
    }
    return persistLoyaltyMember(companyId, next);
  }

  async function getLoyaltyMember(
    companyId: string,
    id: string,
  ): Promise<LoyaltyMember | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "loyalty_member"),
        ),
      )
      .limit(1);
    return row ? rowToLoyaltyMember(row) : null;
  }

  // ----- Transfers -------------------------------------------------------

  async function createTransfer(
    companyId: string,
    input: {
      fromLocationId: string;
      toLocationId: string;
      items: Array<{ productId: string; quantity: number }>;
    },
  ): Promise<InventoryTransfer> {
    if (input.fromLocationId === input.toLocationId) {
      throw new Error("Source and destination must differ");
    }
    if (input.items.length === 0) throw new Error("Transfer must include items");
    const code = await nextRetailCode(db, companyId, "inventory_transfer", "TRF");
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: MODULE_KEY,
        entityType: "inventory_transfer",
        code,
        name: `Transfer ${code}`,
        status: "draft",
        data: {
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          items: input.items.map((it) => ({
            productId: it.productId,
            quantity: Math.max(1, Math.trunc(it.quantity)),
          })),
        },
      })
      .returning();
    return rowToTransfer(row!);
  }

  async function loadTransfer(
    companyId: string,
    id: string,
  ): Promise<InventoryTransfer> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "inventory_transfer"),
        ),
      )
      .limit(1);
    if (!row) throw new Error(`Transfer ${id} not found`);
    return rowToTransfer(row);
  }

  async function persistTransfer(
    companyId: string,
    transfer: InventoryTransfer,
  ): Promise<InventoryTransfer> {
    const [row] = await db
      .update(businessEntities)
      .set({
        status: transfer.status,
        data: {
          fromLocationId: transfer.fromLocationId,
          toLocationId: transfer.toLocationId,
          items: transfer.items,
          shippedAt: transfer.shippedAt,
          receivedAt: transfer.receivedAt,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.id, transfer.id),
          eq(businessEntities.companyId, companyId),
        ),
      )
      .returning();
    if (!row) throw new Error(`Transfer ${transfer.id} not found`);
    return rowToTransfer(row);
  }

  async function shipTransfer(
    companyId: string,
    id: string,
  ): Promise<InventoryTransfer> {
    const transfer = await loadTransfer(companyId, id);
    if (transfer.status !== "draft") {
      throw new Error(`Transfer is ${transfer.status}`);
    }
    // Decrement source stock for every item atomically.
    for (const item of transfer.items) {
      await multiLocation.decrementStock(
        companyId,
        item.productId,
        transfer.fromLocationId,
        item.quantity,
        { refType: "transfer", refId: transfer.id },
      );
    }
    transfer.status = "in_transit";
    transfer.shippedAt = new Date().toISOString();
    return persistTransfer(companyId, transfer);
  }

  async function receiveTransfer(
    companyId: string,
    id: string,
  ): Promise<InventoryTransfer> {
    const transfer = await loadTransfer(companyId, id);
    if (transfer.status !== "in_transit") {
      throw new Error(`Transfer is ${transfer.status}`);
    }
    for (const item of transfer.items) {
      await multiLocation.incrementStock(
        companyId,
        item.productId,
        transfer.toLocationId,
        item.quantity,
        { refType: "transfer", refId: transfer.id },
      );
    }
    transfer.status = "received";
    transfer.receivedAt = new Date().toISOString();
    return persistTransfer(companyId, transfer);
  }

  async function listTransfers(companyId: string): Promise<InventoryTransfer[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "inventory_transfer"),
        ),
      )
      .orderBy(desc(businessEntities.createdAt));
    return rows.map(rowToTransfer);
  }

  // ----- End of day ------------------------------------------------------

  async function buildEndOfDay(
    companyId: string,
    locationId: string,
    date: string,
    actualCashCents?: number,
  ): Promise<EndOfDayReport> {
    const sales = await listSales(companyId, {
      locationId,
      date,
      limit: 1000,
    });
    const completed = sales.filter((s) => s.status === "completed" || s.status === "partially_refunded");
    const refunded = sales.filter((s) => s.status === "refunded" || s.status === "partially_refunded");

    let cash = 0;
    let card = 0;
    let knet = 0;
    let total = 0;
    const productCounts = new Map<string, number>();
    for (const s of completed) {
      total += s.totalCents;
      for (const p of s.payments) {
        if (p.method === "cash") cash += p.amountCents;
        else if (p.method === "card") card += p.amountCents;
        else if (p.method === "knet") knet += p.amountCents;
      }
      for (const item of s.items) {
        if (item.refunded) continue;
        productCounts.set(
          item.productName,
          (productCounts.get(item.productName) ?? 0) + item.quantity,
        );
      }
    }
    let refundsCents = 0;
    for (const s of refunded) {
      for (const item of s.items) {
        if (item.refunded) refundsCents += item.lineTotalCents;
      }
    }

    const topProducts = Array.from(productCounts.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    const cashOpenCents = 0;
    const expectedCashCents = cashOpenCents + cash;
    const variance =
      actualCashCents === undefined ? undefined : actualCashCents - expectedCashCents;

    return {
      date,
      locationId,
      cashOpenCents,
      totalSalesCents: total,
      cashSalesCents: cash,
      cardSalesCents: card,
      knetSalesCents: knet,
      refundsCents,
      expectedCashCents,
      actualCashCents,
      varianceCents: variance,
      salesCount: completed.length,
      topProducts,
    };
  }

  async function getEndOfDayReport(
    companyId: string,
    locationId: string,
    date: string,
  ): Promise<EndOfDayReport> {
    return buildEndOfDay(companyId, locationId, date);
  }

  async function closeEndOfDay(
    companyId: string,
    locationId: string,
    date: string,
    actualCashCents: number,
  ): Promise<EndOfDayReport> {
    const report = await buildEndOfDay(companyId, locationId, date, actualCashCents);
    // Persist as a synthetic entity so historical reports can be audited.
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: MODULE_KEY,
      entityType: "end_of_day",
      code: `EOD-${date}-${locationId.slice(0, 6)}`,
      name: `End of day ${date}`,
      status: "closed",
      amountCents: report.totalSalesCents,
      currency: "KWD",
      data: report as unknown as Record<string, unknown>,
    });
    return report;
  }

  // ----- Setup -----------------------------------------------------------

  async function setupDefaults(companyId: string): Promise<void> {
    const existing = await listLocations(companyId);
    if (existing.length === 0) {
      await createLocation(companyId, {
        name: "Main store",
        address: "",
        isMain: true,
        posTerminals: 1,
      });
    }
  }

  // ----- Dashboard -------------------------------------------------------

  async function getDashboard(
    companyId: string,
    opts?: { locationId?: string },
  ): Promise<RetailDashboard> {
    const today = isoDate();
    const monthStart = `${today.slice(0, 7)}-01`;

    const salesAll = await listSales(companyId, {
      locationId: opts?.locationId,
      limit: 500,
    });
    const salesToday = salesAll.filter(
      (s) => s.createdAt.slice(0, 10) === today && (s.status === "completed" || s.status === "partially_refunded"),
    );
    const salesMonth = salesAll.filter(
      (s) => s.createdAt.slice(0, 10) >= monthStart && (s.status === "completed" || s.status === "partially_refunded"),
    );

    const productAgg = new Map<string, { name: string; quantity: number; revenueCents: number }>();
    for (const s of salesMonth) {
      for (const it of s.items) {
        if (it.refunded) continue;
        const cur = productAgg.get(it.productId) ?? {
          name: it.productName,
          quantity: 0,
          revenueCents: 0,
        };
        cur.quantity += it.quantity;
        cur.revenueCents += it.lineTotalCents;
        productAgg.set(it.productId, cur);
      }
    }
    const topProducts = Array.from(productAgg.values())
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 5);

    const products = await listProducts(companyId);
    const lowStock = products
      .filter((p) => p.reorderPoint !== undefined)
      .map((p) => ({
        productId: p.id,
        name: p.name,
        totalStock: Object.values(p.stockByLocation).reduce((s, n) => s + n, 0),
        reorderPoint: p.reorderPoint ?? 0,
      }))
      .filter((row) => row.totalStock <= row.reorderPoint)
      .slice(0, 20);

    const members = await listLoyaltyMembers(companyId);
    const byTier: Record<LoyaltyTier, number> = {
      bronze: 0,
      silver: 0,
      gold: 0,
      platinum: 0,
    };
    for (const m of members) byTier[m.tier] += 1;

    const locations = await listLocations(companyId);

    return {
      salesToday: {
        count: salesToday.length,
        totalCents: salesToday.reduce((s, x) => s + x.totalCents, 0),
      },
      salesThisMonth: {
        count: salesMonth.length,
        totalCents: salesMonth.reduce((s, x) => s + x.totalCents, 0),
      },
      topProducts,
      lowStock,
      loyaltyMembers: { total: members.length, byTier },
      locationCount: locations.length,
    };
  }

  return {
    listLocations,
    createLocation,
    updateLocation,
    deleteLocation,
    listProducts,
    getProductByBarcode,
    createProduct,
    updateProduct,
    setStock,
    startSale,
    addItemToSale,
    removeItemFromSale,
    applyDiscount,
    attachCustomer,
    attachLoyaltyMember,
    redeemLoyaltyPoints,
    takePayment,
    completeSale,
    voidSale,
    refundSale,
    listSales,
    getSale,
    listLoyaltyMembers,
    enrollLoyaltyMember,
    adjustPoints,
    getLoyaltyMember,
    createTransfer,
    shipTransfer,
    receiveTransfer,
    listTransfers,
    getEndOfDayReport,
    closeEndOfDay,
    setupDefaults,
    getDashboard,
  };
}

export { LOYALTY_TIERS, calculatePointsEarned, calculatePointsValue, computeTier };
export type { LoyaltyMember, LoyaltyTier } from "./loyalty-engine.js";
