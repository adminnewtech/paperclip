// ---------------------------------------------------------------------------
// Restaurants vertical service
// ---------------------------------------------------------------------------
//
// Implements the menu / table / POS order workflow for restaurants & cafes.
// Persists everything to the generic `business_entities` table under module
// key "restaurants" so the existing audit / RBAC / stream pipeline picks it
// up for free. Type contracts live in this file (not the DB schema), so we
// can iterate quickly while staying compatible with the entity registry.
//
// Money is ALWAYS handled in integer minor units (fils/cents). Never floats.
// Tax + service charge defaults come from the company's country (GCC VAT
// table). Order codes are sequential per calendar day to make daily Z reports
// match what gets printed at the till.

import { and, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  DEFAULT_COUNTRY,
  GCC_COUNTRIES,
  type GccCountryCode,
} from "@paperclipai/shared";
import {
  applyDefaultMenu,
  applyDefaultTables,
} from "./restaurant-defaults.js";
import {
  calculateOrder,
  buildKitchenTicket,
  computeSplitBills,
} from "./pos-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const RESTAURANT_MODULE_KEY = "restaurants" as const;

export type MenuItemStation = "kitchen" | "bar" | "grill" | "cold";

export interface ModifierOption {
  name: string;
  nameAr: string;
  priceCents: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  nameAr: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
}

export interface MenuItem {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  category: string;
  priceCents: number;
  costCents?: number;
  description?: string;
  descriptionAr?: string;
  imageUrl?: string;
  modifiers: ModifierGroup[];
  isAvailable: boolean;
  preparationTimeMinutes: number;
  taxable: boolean;
  station?: MenuItemStation;
}

export interface CreateMenuItemInput {
  code?: string;
  name: string;
  nameAr?: string;
  category: string;
  priceCents: number;
  costCents?: number;
  description?: string;
  descriptionAr?: string;
  imageUrl?: string;
  modifiers?: ModifierGroup[];
  isAvailable?: boolean;
  preparationTimeMinutes?: number;
  taxable?: boolean;
  station?: MenuItemStation;
}

export type TableArea = "main" | "outdoor" | "vip" | "bar";
export type TableStatus =
  | "available"
  | "occupied"
  | "reserved"
  | "cleaning";

export interface Table {
  id: string;
  code: string;
  name: string;
  capacity: number;
  area: TableArea;
  status: TableStatus;
  currentOrderId?: string;
  position?: { x: number; y: number };
}

export interface CreateTableInput {
  code?: string;
  name: string;
  capacity: number;
  area?: TableArea;
  status?: TableStatus;
  position?: { x: number; y: number };
}

export type OrderType = "dine_in" | "takeout" | "delivery";
export type OrderStatus =
  | "open"
  | "sent_to_kitchen"
  | "preparing"
  | "ready"
  | "served"
  | "paid"
  | "cancelled";
export type DeliveryProvider = "talabat" | "deliveroo" | "jahez" | "own";
export type PaymentMethod = "cash" | "card" | "knet" | "online";
export type PaymentStatus = "unpaid" | "partial" | "paid";
export type OrderItemStatus =
  | "ordered"
  | "preparing"
  | "ready"
  | "served";

export interface OrderItemModifier {
  name: string;
  priceCents: number;
}

export interface OrderItem {
  itemId: string;
  itemName: string;
  itemNameAr?: string;
  quantity: number;
  unitPriceCents: number;
  modifiers: OrderItemModifier[];
  lineTotalCents: number;
  status: OrderItemStatus;
  station?: string;
  notes?: string;
  voided?: boolean;
  voidReason?: string;
}

export interface OrderPayment {
  method: PaymentMethod;
  amountCents: number;
  at: string;
}

export interface Order {
  id: string;
  code: string;
  type: OrderType;
  status: OrderStatus;
  tableId?: string;
  tableName?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryProvider?: DeliveryProvider;
  items: OrderItem[];
  subtotalCents: number;
  discountCents: number;
  discountReason?: string;
  serviceChargeCents: number;
  serviceChargePercent: number;
  vatCents: number;
  vatRatePercent: number;
  totalCents: number;
  paymentStatus: PaymentStatus;
  payments: OrderPayment[];
  notes?: string;
  createdAt: string;
  sentToKitchenAt?: string;
  servedAt?: string;
  paidAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export interface CreateOrderInput {
  type: OrderType;
  tableId?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryProvider?: DeliveryProvider;
  notes?: string;
  items?: Array<{
    itemId: string;
    quantity: number;
    modifiers?: Array<{ name: string }>;
    notes?: string;
  }>;
}

export interface KitchenTicket {
  orderId: string;
  orderCode: string;
  tableName?: string;
  station: string;
  items: Array<{
    name: string;
    quantity: number;
    modifiers: string[];
    notes?: string;
    itemIndex: number;
    status: OrderItemStatus;
  }>;
  createdAt: string;
  ageSeconds: number;
  status: "new" | "preparing" | "ready";
}

export interface RestaurantDashboard {
  todayRevenueCents: number;
  todayOrders: number;
  todayCovers: number;
  averageOrderValueCents: number;
  openOrders: number;
  tablesOccupied: number;
  tablesTotal: number;
  peakHours: Array<{ hour: number; orderCount: number }>;
  topItems: Array<{ itemName: string; quantity: number; revenueCents: number }>;
}

export interface ZReport {
  date: string;
  totalOrders: number;
  totalRevenueCents: number;
  totalVatCents: number;
  totalServiceChargeCents: number;
  totalDiscountCents: number;
  byPaymentMethod: Record<string, number>;
  byOrderType: Record<string, number>;
  byCategory: Array<{
    category: string;
    revenueCents: number;
    itemCount: number;
  }>;
  topItems: Array<{
    itemName: string;
    quantity: number;
    revenueCents: number;
  }>;
}

export interface RestaurantService {
  // Menu
  listMenuItems(
    companyId: string,
    opts?: { category?: string; available?: boolean },
  ): Promise<MenuItem[]>;
  getMenuItem(companyId: string, id: string): Promise<MenuItem | null>;
  createMenuItem(
    companyId: string,
    input: CreateMenuItemInput,
  ): Promise<MenuItem>;
  updateMenuItem(
    companyId: string,
    id: string,
    input: Partial<CreateMenuItemInput>,
  ): Promise<MenuItem>;
  deleteMenuItem(companyId: string, id: string): Promise<void>;
  toggleAvailability(
    companyId: string,
    id: string,
    available: boolean,
  ): Promise<MenuItem>;

  // Tables
  listTables(companyId: string): Promise<Table[]>;
  getTable(companyId: string, id: string): Promise<Table | null>;
  createTable(
    companyId: string,
    input: CreateTableInput,
  ): Promise<Table>;
  updateTable(
    companyId: string,
    id: string,
    input: Partial<CreateTableInput>,
  ): Promise<Table>;
  deleteTable(companyId: string, id: string): Promise<void>;
  setTableStatus(
    companyId: string,
    id: string,
    status: TableStatus,
  ): Promise<Table>;

  // Orders
  listOrders(
    companyId: string,
    opts?: { status?: OrderStatus; type?: OrderType; date?: string },
  ): Promise<Order[]>;
  createOrder(
    companyId: string,
    input: CreateOrderInput,
  ): Promise<Order>;
  getOrder(companyId: string, id: string): Promise<Order | null>;
  addItemToOrder(
    companyId: string,
    orderId: string,
    item: {
      itemId: string;
      quantity: number;
      modifiers?: Array<{ name: string }>;
      notes?: string;
    },
  ): Promise<Order>;
  removeItemFromOrder(
    companyId: string,
    orderId: string,
    itemIndex: number,
  ): Promise<Order>;
  voidItem(
    companyId: string,
    orderId: string,
    itemIndex: number,
    reason: string,
  ): Promise<Order>;
  sendToKitchen(companyId: string, orderId: string): Promise<Order>;
  markServed(companyId: string, orderId: string): Promise<Order>;
  applyDiscount(
    companyId: string,
    orderId: string,
    discountCents: number,
    reason?: string,
  ): Promise<Order>;
  takePayment(
    companyId: string,
    orderId: string,
    payment: { method: PaymentMethod; amountCents: number },
  ): Promise<Order>;
  closeOrder(companyId: string, orderId: string): Promise<Order>;
  cancelOrder(
    companyId: string,
    orderId: string,
    reason: string,
  ): Promise<Order>;

  // Kitchen
  listKitchenTickets(
    companyId: string,
    opts?: { station?: string; status?: string },
  ): Promise<KitchenTicket[]>;
  markItemReady(
    companyId: string,
    orderId: string,
    itemIndex: number,
  ): Promise<Order>;

  // Setup + reports
  setupDefaults(companyId: string): Promise<void>;
  getDashboard(companyId: string): Promise<RestaurantDashboard>;
  getZReport(companyId: string, date: string): Promise<ZReport>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

async function getCountryDefaults(
  _db: Db,
  _companyId: string,
): Promise<{ vatRatePercent: number; serviceChargePercent: number }> {
  // Defaults: Kuwait (0% VAT, 10% service charge).
  // A future migration may persist a country code on `companies` — until
  // then we use the Kuwait-first defaults from GCC_COUNTRIES.
  const countryCode: GccCountryCode = DEFAULT_COUNTRY;
  const info = GCC_COUNTRIES[countryCode];
  return {
    vatRatePercent: info.vatRate,
    serviceChargePercent: 10,
  };
}

function deserializeMenuItem(row: {
  id: string;
  code: string | null;
  name: string | null;
  status: string;
  data: unknown;
}): MenuItem {
  const data = (row.data ?? {}) as Partial<MenuItem> & {
    name?: string;
    nameAr?: string;
  };
  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? data.name ?? "",
    nameAr: data.nameAr ?? "",
    category: data.category ?? "General",
    priceCents: Number(data.priceCents ?? 0),
    costCents: data.costCents,
    description: data.description,
    descriptionAr: data.descriptionAr,
    imageUrl: data.imageUrl,
    modifiers: Array.isArray(data.modifiers) ? data.modifiers : [],
    isAvailable: row.status === "available",
    preparationTimeMinutes: Number(data.preparationTimeMinutes ?? 10),
    taxable: data.taxable !== false,
    station: data.station,
  };
}

function deserializeTable(row: {
  id: string;
  code: string | null;
  name: string | null;
  status: string;
  data: unknown;
}): Table {
  const data = (row.data ?? {}) as Partial<Table>;
  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? "",
    capacity: Number(data.capacity ?? 2),
    area: (data.area ?? "main") as TableArea,
    status: (row.status as TableStatus) ?? "available",
    currentOrderId: data.currentOrderId,
    position: data.position,
  };
}

function deserializeOrder(row: {
  id: string;
  code: string | null;
  status: string;
  data: unknown;
  createdAt: Date;
}): Order {
  const data = (row.data ?? {}) as Partial<Order>;
  return {
    id: row.id,
    code: row.code ?? "",
    type: (data.type ?? "dine_in") as OrderType,
    status: (row.status as OrderStatus) ?? "open",
    tableId: data.tableId,
    tableName: data.tableName,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    deliveryAddress: data.deliveryAddress,
    deliveryProvider: data.deliveryProvider,
    items: Array.isArray(data.items) ? data.items : [],
    subtotalCents: Number(data.subtotalCents ?? 0),
    discountCents: Number(data.discountCents ?? 0),
    discountReason: data.discountReason,
    serviceChargeCents: Number(data.serviceChargeCents ?? 0),
    serviceChargePercent: Number(data.serviceChargePercent ?? 0),
    vatCents: Number(data.vatCents ?? 0),
    vatRatePercent: Number(data.vatRatePercent ?? 0),
    totalCents: Number(data.totalCents ?? 0),
    paymentStatus: (data.paymentStatus ?? "unpaid") as PaymentStatus,
    payments: Array.isArray(data.payments) ? data.payments : [],
    notes: data.notes,
    createdAt: row.createdAt.toISOString(),
    sentToKitchenAt: data.sentToKitchenAt,
    servedAt: data.servedAt,
    paidAt: data.paidAt,
    cancelledAt: data.cancelledAt,
    cancelReason: data.cancelReason,
  };
}

async function nextOrderCode(db: Db, companyId: string): Promise<string> {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const prefix = `ORD-${y}${m}${d}`;

  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
        eq(businessEntities.entityType, "order"),
        ilike(businessEntities.code, `${prefix}-%`),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);

  let n = 1;
  const last = rows[0]?.code;
  if (last) {
    const parts = last.split("-");
    const tail = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!Number.isNaN(tail)) n = tail + 1;
  }
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

async function nextMenuItemCode(
  db: Db,
  companyId: string,
): Promise<string> {
  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
        eq(businessEntities.entityType, "menu_item"),
        ilike(businessEntities.code, "MENU-%"),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);
  let n = 1;
  const last = rows[0]?.code;
  if (last) {
    const parts = last.split("-");
    const tail = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!Number.isNaN(tail)) n = tail + 1;
  }
  return `MENU-${String(n).padStart(4, "0")}`;
}

async function nextTableCode(db: Db, companyId: string): Promise<string> {
  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
        eq(businessEntities.entityType, "table"),
        ilike(businessEntities.code, "TBL-%"),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);
  let n = 1;
  const last = rows[0]?.code;
  if (last) {
    const parts = last.split("-");
    const tail = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!Number.isNaN(tail)) n = tail + 1;
  }
  return `TBL-${String(n).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

export function createRestaurantService(db: Db): RestaurantService {
  async function fetchMenuItemRow(companyId: string, id: string) {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
          eq(businessEntities.entityType, "menu_item"),
          eq(businessEntities.id, id),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function fetchTableRow(companyId: string, id: string) {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
          eq(businessEntities.entityType, "table"),
          eq(businessEntities.id, id),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function fetchOrderRow(companyId: string, id: string) {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
          eq(businessEntities.entityType, "order"),
          eq(businessEntities.id, id),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function recalcOrder(
    companyId: string,
    order: Order,
  ): Promise<Order> {
    const { vatRatePercent, serviceChargePercent } = {
      vatRatePercent: order.vatRatePercent,
      serviceChargePercent: order.serviceChargePercent,
    };
    const calc = calculateOrder(order.items, {
      discountCents: order.discountCents,
      serviceChargePercent,
      vatRatePercent,
    });
    const paidSoFar = order.payments.reduce(
      (sum, p) => sum + Number(p.amountCents ?? 0),
      0,
    );
    let paymentStatus: PaymentStatus = "unpaid";
    if (paidSoFar >= calc.totalCents && calc.totalCents > 0) {
      paymentStatus = "paid";
    } else if (paidSoFar > 0) {
      paymentStatus = "partial";
    }
    const next: Order = {
      ...order,
      subtotalCents: calc.subtotalCents,
      serviceChargeCents: calc.serviceChargeCents,
      vatCents: calc.vatCents,
      totalCents: calc.totalCents,
      paymentStatus,
    };
    await db
      .update(businessEntities)
      .set({
        data: next as unknown as Record<string, unknown>,
        amountCents: next.totalCents,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, order.id),
        ),
      );
    return next;
  }

  async function persistOrder(
    companyId: string,
    order: Order,
    statusOverride?: OrderStatus,
  ): Promise<Order> {
    const newStatus = statusOverride ?? order.status;
    const next = { ...order, status: newStatus };
    await db
      .update(businessEntities)
      .set({
        status: newStatus,
        data: next as unknown as Record<string, unknown>,
        amountCents: next.totalCents,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, order.id),
        ),
      );
    return next;
  }

  const service: RestaurantService = {
    // -------------------- Menu --------------------
    async listMenuItems(companyId, opts) {
      const conditions = [
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
        eq(businessEntities.entityType, "menu_item"),
      ];
      if (opts?.available !== undefined) {
        conditions.push(
          eq(
            businessEntities.status,
            opts.available ? "available" : "unavailable",
          ),
        );
      }
      const rows = await db
        .select()
        .from(businessEntities)
        .where(and(...conditions));
      let items = rows.map(deserializeMenuItem);
      if (opts?.category) {
        items = items.filter((m) => m.category === opts.category);
      }
      items.sort((a, b) => {
        if (a.category !== b.category)
          return a.category.localeCompare(b.category);
        return a.name.localeCompare(b.name);
      });
      return items;
    },

    async getMenuItem(companyId, id) {
      const row = await fetchMenuItemRow(companyId, id);
      return row ? deserializeMenuItem(row) : null;
    },

    async createMenuItem(companyId, input) {
      const code = input.code ?? (await nextMenuItemCode(db, companyId));
      const isAvailable = input.isAvailable !== false;
      const itemData: Omit<MenuItem, "id"> = {
        code,
        name: input.name,
        nameAr: input.nameAr ?? "",
        category: input.category,
        priceCents: Math.max(0, Math.round(input.priceCents)),
        costCents: input.costCents,
        description: input.description,
        descriptionAr: input.descriptionAr,
        imageUrl: input.imageUrl,
        modifiers: input.modifiers ?? [],
        isAvailable,
        preparationTimeMinutes: input.preparationTimeMinutes ?? 10,
        taxable: input.taxable !== false,
        station: input.station,
      };
      const now = new Date();
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: RESTAURANT_MODULE_KEY,
          entityType: "menu_item",
          code,
          name: input.name,
          status: isAvailable ? "available" : "unavailable",
          amountCents: itemData.priceCents,
          currency: null,
          data: itemData as unknown as Record<string, unknown>,
          tags: [input.category],
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("failed to create menu item");
      return deserializeMenuItem(row);
    },

    async updateMenuItem(companyId, id, input) {
      const existing = await fetchMenuItemRow(companyId, id);
      if (!existing) throw new Error("menu item not found");
      const current = deserializeMenuItem(existing);
      const merged: MenuItem = {
        ...current,
        ...input,
        priceCents:
          input.priceCents !== undefined
            ? Math.max(0, Math.round(input.priceCents))
            : current.priceCents,
        modifiers: input.modifiers ?? current.modifiers,
        isAvailable:
          input.isAvailable !== undefined
            ? input.isAvailable
            : current.isAvailable,
      };
      const [row] = await db
        .update(businessEntities)
        .set({
          name: merged.name,
          code: merged.code,
          status: merged.isAvailable ? "available" : "unavailable",
          amountCents: merged.priceCents,
          data: merged as unknown as Record<string, unknown>,
          tags: [merged.category],
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.id, id),
          ),
        )
        .returning();
      if (!row) throw new Error("failed to update menu item");
      return deserializeMenuItem(row);
    },

    async deleteMenuItem(companyId, id) {
      await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.id, id),
          ),
        );
    },

    async toggleAvailability(companyId, id, available) {
      return service.updateMenuItem(companyId, id, { isAvailable: available });
    },

    // -------------------- Tables --------------------
    async listTables(companyId) {
      const rows = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
            eq(businessEntities.entityType, "table"),
          ),
        );
      const tables = rows.map(deserializeTable);
      tables.sort((a, b) => a.code.localeCompare(b.code));
      return tables;
    },

    async getTable(companyId, id) {
      const row = await fetchTableRow(companyId, id);
      return row ? deserializeTable(row) : null;
    },

    async createTable(companyId, input) {
      const code = input.code ?? (await nextTableCode(db, companyId));
      const status: TableStatus = input.status ?? "available";
      const tableData: Omit<Table, "id"> = {
        code,
        name: input.name,
        capacity: Math.max(1, Math.round(input.capacity)),
        area: input.area ?? "main",
        status,
        position: input.position,
      };
      const now = new Date();
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: RESTAURANT_MODULE_KEY,
          entityType: "table",
          code,
          name: input.name,
          status,
          data: tableData as unknown as Record<string, unknown>,
          tags: [tableData.area],
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("failed to create table");
      return deserializeTable(row);
    },

    async updateTable(companyId, id, input) {
      const existing = await fetchTableRow(companyId, id);
      if (!existing) throw new Error("table not found");
      const current = deserializeTable(existing);
      const merged: Table = {
        ...current,
        ...input,
        capacity:
          input.capacity !== undefined
            ? Math.max(1, Math.round(input.capacity))
            : current.capacity,
      };
      const [row] = await db
        .update(businessEntities)
        .set({
          name: merged.name,
          code: merged.code,
          status: merged.status,
          data: merged as unknown as Record<string, unknown>,
          tags: [merged.area],
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.id, id),
          ),
        )
        .returning();
      if (!row) throw new Error("failed to update table");
      return deserializeTable(row);
    },

    async deleteTable(companyId, id) {
      await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.id, id),
          ),
        );
    },

    async setTableStatus(companyId, id, status) {
      return service.updateTable(companyId, id, { status });
    },

    // -------------------- Orders --------------------
    async listOrders(companyId, opts) {
      const conditions = [
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
        eq(businessEntities.entityType, "order"),
      ];
      if (opts?.status) {
        conditions.push(eq(businessEntities.status, opts.status));
      }
      if (opts?.date) {
        const start = new Date(`${opts.date}T00:00:00.000Z`);
        const end = new Date(`${opts.date}T23:59:59.999Z`);
        conditions.push(gte(businessEntities.createdAt, start));
        conditions.push(lte(businessEntities.createdAt, end));
      }
      const rows = await db
        .select()
        .from(businessEntities)
        .where(and(...conditions))
        .orderBy(desc(businessEntities.createdAt));
      let orders = rows.map(deserializeOrder);
      if (opts?.type) orders = orders.filter((o) => o.type === opts.type);
      return orders;
    },

    async getOrder(companyId, id) {
      const row = await fetchOrderRow(companyId, id);
      return row ? deserializeOrder(row) : null;
    },

    async createOrder(companyId, input) {
      const defaults = await getCountryDefaults(db, companyId);
      const code = await nextOrderCode(db, companyId);

      let tableName: string | undefined;
      if (input.tableId) {
        const table = await service.getTable(companyId, input.tableId);
        if (table) tableName = table.name;
      }

      // Resolve initial items, if any
      const items: OrderItem[] = [];
      if (input.items && input.items.length > 0) {
        for (const it of input.items) {
          const menuItem = await service.getMenuItem(companyId, it.itemId);
          if (!menuItem) continue;
          const modifiers: OrderItemModifier[] = (it.modifiers ?? [])
            .map((m) => {
              for (const group of menuItem.modifiers) {
                const opt = group.options.find((o) => o.name === m.name);
                if (opt)
                  return { name: opt.name, priceCents: opt.priceCents };
              }
              return null;
            })
            .filter((m): m is OrderItemModifier => m !== null);
          const modCents = modifiers.reduce(
            (s, m) => s + m.priceCents,
            0,
          );
          const qty = Math.max(1, Math.round(it.quantity));
          items.push({
            itemId: menuItem.id,
            itemName: menuItem.name,
            itemNameAr: menuItem.nameAr,
            quantity: qty,
            unitPriceCents: menuItem.priceCents,
            modifiers,
            lineTotalCents: (menuItem.priceCents + modCents) * qty,
            status: "ordered",
            station: menuItem.station,
            notes: it.notes,
          });
        }
      }

      const order: Omit<Order, "id"> = {
        code,
        type: input.type,
        status: "open",
        tableId: input.tableId,
        tableName,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        deliveryAddress: input.deliveryAddress,
        deliveryProvider: input.deliveryProvider,
        items,
        subtotalCents: 0,
        discountCents: 0,
        serviceChargeCents: 0,
        serviceChargePercent:
          input.type === "delivery" ? 0 : defaults.serviceChargePercent,
        vatCents: 0,
        vatRatePercent: defaults.vatRatePercent,
        totalCents: 0,
        paymentStatus: "unpaid",
        payments: [],
        notes: input.notes,
        createdAt: isoNow(),
      };
      const calc = calculateOrder(order.items, {
        discountCents: 0,
        serviceChargePercent: order.serviceChargePercent,
        vatRatePercent: order.vatRatePercent,
      });
      const orderWithTotals = {
        ...order,
        subtotalCents: calc.subtotalCents,
        serviceChargeCents: calc.serviceChargeCents,
        vatCents: calc.vatCents,
        totalCents: calc.totalCents,
      };
      const now = new Date();
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: RESTAURANT_MODULE_KEY,
          entityType: "order",
          code,
          name: tableName ?? input.customerName ?? code,
          status: "open",
          amountCents: orderWithTotals.totalCents,
          currency: null,
          data: orderWithTotals as unknown as Record<string, unknown>,
          tags: [input.type],
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("failed to create order");

      // Occupy the table
      if (input.tableId) {
        try {
          await service.updateTable(companyId, input.tableId, {
            status: "occupied",
          });
          await db
            .update(businessEntities)
            .set({
              data: sql`jsonb_set(data, '{currentOrderId}', to_jsonb(${row.id}::text), true)`,
            })
            .where(
              and(
                eq(businessEntities.companyId, companyId),
                eq(businessEntities.id, input.tableId),
              ),
            );
        } catch {
          // non-fatal
        }
      }
      return deserializeOrder(row);
    },

    async addItemToOrder(companyId, orderId, item) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      if (
        existing.status === "paid" ||
        existing.status === "cancelled"
      ) {
        throw new Error("cannot modify a closed order");
      }
      const menuItem = await service.getMenuItem(companyId, item.itemId);
      if (!menuItem) throw new Error("menu item not found");
      const qty = Math.max(1, Math.round(item.quantity));
      const modifiers: OrderItemModifier[] = (item.modifiers ?? [])
        .map((m) => {
          for (const group of menuItem.modifiers) {
            const opt = group.options.find((o) => o.name === m.name);
            if (opt) return { name: opt.name, priceCents: opt.priceCents };
          }
          return null;
        })
        .filter((m): m is OrderItemModifier => m !== null);
      const modCents = modifiers.reduce((s, m) => s + m.priceCents, 0);
      const newItem: OrderItem = {
        itemId: menuItem.id,
        itemName: menuItem.name,
        itemNameAr: menuItem.nameAr,
        quantity: qty,
        unitPriceCents: menuItem.priceCents,
        modifiers,
        lineTotalCents: (menuItem.priceCents + modCents) * qty,
        status: "ordered",
        station: menuItem.station,
        notes: item.notes,
      };
      const next: Order = { ...existing, items: [...existing.items, newItem] };
      return recalcOrder(companyId, next);
    },

    async removeItemFromOrder(companyId, orderId, itemIndex) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      if (itemIndex < 0 || itemIndex >= existing.items.length) {
        throw new Error("invalid item index");
      }
      const items = existing.items.slice();
      items.splice(itemIndex, 1);
      const next: Order = { ...existing, items };
      return recalcOrder(companyId, next);
    },

    async voidItem(companyId, orderId, itemIndex, reason) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      if (itemIndex < 0 || itemIndex >= existing.items.length) {
        throw new Error("invalid item index");
      }
      const items = existing.items.slice();
      const target = items[itemIndex];
      if (!target) throw new Error("invalid item index");
      items[itemIndex] = {
        ...target,
        voided: true,
        voidReason: reason,
        lineTotalCents: 0,
      };
      const next: Order = { ...existing, items };
      return recalcOrder(companyId, next);
    },

    async sendToKitchen(companyId, orderId) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      const items = existing.items.map((item) => ({
        ...item,
        status:
          item.status === "ordered"
            ? ("preparing" as OrderItemStatus)
            : item.status,
      }));
      const next: Order = {
        ...existing,
        items,
        sentToKitchenAt: isoNow(),
        status: "sent_to_kitchen",
      };
      return persistOrder(companyId, next, "sent_to_kitchen");
    },

    async markServed(companyId, orderId) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      const items = existing.items.map((item) => ({
        ...item,
        status: item.voided ? item.status : ("served" as OrderItemStatus),
      }));
      const next: Order = {
        ...existing,
        items,
        servedAt: isoNow(),
        status: "served",
      };
      return persistOrder(companyId, next, "served");
    },

    async applyDiscount(companyId, orderId, discountCents, reason) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      const safeDiscount = Math.max(0, Math.round(discountCents));
      const next: Order = {
        ...existing,
        discountCents: safeDiscount,
        discountReason: reason,
      };
      return recalcOrder(companyId, next);
    },

    async takePayment(companyId, orderId, payment) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      const amount = Math.max(0, Math.round(payment.amountCents));
      const nextPayments = [
        ...existing.payments,
        {
          method: payment.method,
          amountCents: amount,
          at: isoNow(),
        },
      ];
      const next: Order = { ...existing, payments: nextPayments };
      return recalcOrder(companyId, next);
    },

    async closeOrder(companyId, orderId) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      const next: Order = {
        ...existing,
        status: "paid",
        paymentStatus: "paid",
        paidAt: isoNow(),
      };
      const saved = await persistOrder(companyId, next, "paid");
      // Free the table
      if (existing.tableId) {
        try {
          await service.updateTable(companyId, existing.tableId, {
            status: "available",
          });
          await db
            .update(businessEntities)
            .set({
              data: sql`data - 'currentOrderId'`,
            })
            .where(
              and(
                eq(businessEntities.companyId, companyId),
                eq(businessEntities.id, existing.tableId),
              ),
            );
        } catch {
          // non-fatal
        }
      }
      return saved;
    },

    async cancelOrder(companyId, orderId, reason) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      const next: Order = {
        ...existing,
        status: "cancelled",
        cancelledAt: isoNow(),
        cancelReason: reason,
      };
      const saved = await persistOrder(companyId, next, "cancelled");
      if (existing.tableId) {
        try {
          await service.updateTable(companyId, existing.tableId, {
            status: "available",
          });
        } catch {
          // non-fatal
        }
      }
      return saved;
    },

    // -------------------- Kitchen --------------------
    async listKitchenTickets(companyId, opts) {
      const rows = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, RESTAURANT_MODULE_KEY),
            eq(businessEntities.entityType, "order"),
            inArray(businessEntities.status, [
              "sent_to_kitchen",
              "preparing",
              "ready",
            ]),
          ),
        )
        .orderBy(desc(businessEntities.createdAt));
      const orders = rows.map(deserializeOrder);
      const tickets: KitchenTicket[] = [];
      for (const order of orders) {
        const ticket = buildKitchenTicket(order);
        if (!ticket) continue;
        if (opts?.station && ticket.station !== opts.station) continue;
        if (opts?.status && ticket.status !== opts.status) continue;
        tickets.push(ticket);
      }
      return tickets;
    },

    async markItemReady(companyId, orderId, itemIndex) {
      const existing = await service.getOrder(companyId, orderId);
      if (!existing) throw new Error("order not found");
      if (itemIndex < 0 || itemIndex >= existing.items.length) {
        throw new Error("invalid item index");
      }
      const items = existing.items.slice();
      const target = items[itemIndex];
      if (!target) throw new Error("invalid item index");
      items[itemIndex] = { ...target, status: "ready" };
      const allReady = items.every(
        (i) => i.voided || i.status === "ready" || i.status === "served",
      );
      const status: OrderStatus = allReady ? "ready" : "preparing";
      const next: Order = { ...existing, items };
      return persistOrder(companyId, next, status);
    },

    // -------------------- Setup + reports --------------------
    async setupDefaults(companyId) {
      const existingItems = await service.listMenuItems(companyId);
      if (existingItems.length === 0) {
        await applyDefaultMenu(db, companyId);
      }
      const existingTables = await service.listTables(companyId);
      if (existingTables.length === 0) {
        await applyDefaultTables(db, companyId);
      }
    },

    async getDashboard(companyId) {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10);
      const todayOrders = await service.listOrders(companyId, {
        date: dateStr,
      });
      const tables = await service.listTables(companyId);

      let revenue = 0;
      let covers = 0;
      const peakBuckets: Record<number, number> = {};
      const itemAgg: Record<
        string,
        { name: string; quantity: number; revenueCents: number }
      > = {};
      let paidCount = 0;
      for (const order of todayOrders) {
        if (order.status === "paid") {
          revenue += order.totalCents;
          paidCount += 1;
          covers += Math.max(1, order.items.length);
          const hour = new Date(order.createdAt).getHours();
          peakBuckets[hour] = (peakBuckets[hour] ?? 0) + 1;
          for (const item of order.items) {
            if (item.voided) continue;
            const key = item.itemId || item.itemName;
            const agg = itemAgg[key] ?? {
              name: item.itemName,
              quantity: 0,
              revenueCents: 0,
            };
            agg.quantity += item.quantity;
            agg.revenueCents += item.lineTotalCents;
            itemAgg[key] = agg;
          }
        }
      }

      const peakHours = Object.entries(peakBuckets)
        .map(([h, c]) => ({ hour: Number(h), orderCount: c }))
        .sort((a, b) => a.hour - b.hour);

      const topItems = Object.values(itemAgg)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5)
        .map((i) => ({
          itemName: i.name,
          quantity: i.quantity,
          revenueCents: i.revenueCents,
        }));

      const tablesOccupied = tables.filter(
        (t) => t.status === "occupied",
      ).length;
      const openOrders = todayOrders.filter(
        (o) =>
          o.status !== "paid" &&
          o.status !== "cancelled",
      ).length;

      return {
        todayRevenueCents: revenue,
        todayOrders: todayOrders.length,
        todayCovers: covers,
        averageOrderValueCents:
          paidCount > 0 ? Math.round(revenue / paidCount) : 0,
        openOrders,
        tablesOccupied,
        tablesTotal: tables.length,
        peakHours,
        topItems,
      };
    },

    async getZReport(companyId, date) {
      const orders = await service.listOrders(companyId, { date });
      let totalRevenue = 0;
      let totalVat = 0;
      let totalService = 0;
      let totalDiscount = 0;
      const byMethod: Record<string, number> = {};
      const byType: Record<string, number> = {};
      const byCategory: Record<
        string,
        { revenueCents: number; itemCount: number }
      > = {};
      const itemAgg: Record<
        string,
        { name: string; quantity: number; revenueCents: number }
      > = {};
      let paidCount = 0;
      for (const order of orders) {
        if (order.status !== "paid") continue;
        paidCount += 1;
        totalRevenue += order.totalCents;
        totalVat += order.vatCents;
        totalService += order.serviceChargeCents;
        totalDiscount += order.discountCents;
        byType[order.type] = (byType[order.type] ?? 0) + order.totalCents;
        for (const payment of order.payments) {
          byMethod[payment.method] =
            (byMethod[payment.method] ?? 0) + payment.amountCents;
        }
        for (const item of order.items) {
          if (item.voided) continue;
          const itemRow = await service
            .getMenuItem(companyId, item.itemId)
            .catch(() => null);
          const cat = itemRow?.category ?? "Uncategorized";
          const cur = byCategory[cat] ?? { revenueCents: 0, itemCount: 0 };
          cur.revenueCents += item.lineTotalCents;
          cur.itemCount += item.quantity;
          byCategory[cat] = cur;
          const key = item.itemId || item.itemName;
          const agg = itemAgg[key] ?? {
            name: item.itemName,
            quantity: 0,
            revenueCents: 0,
          };
          agg.quantity += item.quantity;
          agg.revenueCents += item.lineTotalCents;
          itemAgg[key] = agg;
        }
      }
      return {
        date,
        totalOrders: paidCount,
        totalRevenueCents: totalRevenue,
        totalVatCents: totalVat,
        totalServiceChargeCents: totalService,
        totalDiscountCents: totalDiscount,
        byPaymentMethod: byMethod,
        byOrderType: byType,
        byCategory: Object.entries(byCategory).map(([category, v]) => ({
          category,
          revenueCents: v.revenueCents,
          itemCount: v.itemCount,
        })),
        topItems: Object.values(itemAgg)
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 10)
          .map((i) => ({
            itemName: i.name,
            quantity: i.quantity,
            revenueCents: i.revenueCents,
          })),
      };
    },
  };

  return service;
}

// Re-export helpers used by the routes layer
export { calculateOrder, buildKitchenTicket, computeSplitBills };
