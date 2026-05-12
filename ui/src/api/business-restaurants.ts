import { api } from "./client";

// ---------------------------------------------------------------------------
// Restaurants vertical API client
// ---------------------------------------------------------------------------

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
export type OrderItemStatus = "ordered" | "preparing" | "ready" | "served";

export interface OrderItem {
  itemId: string;
  itemName: string;
  itemNameAr?: string;
  quantity: number;
  unitPriceCents: number;
  modifiers: Array<{ name: string; priceCents: number }>;
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

function basePath(companyId: string) {
  return `/companies/${companyId}/business/restaurants`;
}

export const restaurantsApi = {
  // Menu
  listMenu: (
    companyId: string,
    opts?: { category?: string; available?: boolean },
  ) => {
    const params = new URLSearchParams();
    if (opts?.category) params.set("category", opts.category);
    if (opts?.available !== undefined)
      params.set("available", String(opts.available));
    const qs = params.toString();
    return api.get<{ items: MenuItem[] }>(
      `${basePath(companyId)}/menu${qs ? `?${qs}` : ""}`,
    );
  },
  createMenuItem: (companyId: string, body: CreateMenuItemInput) =>
    api.post<MenuItem>(`${basePath(companyId)}/menu`, body),
  updateMenuItem: (
    companyId: string,
    id: string,
    body: Partial<CreateMenuItemInput>,
  ) => api.put<MenuItem>(`${basePath(companyId)}/menu/${id}`, body),
  deleteMenuItem: (companyId: string, id: string) =>
    api.delete<void>(`${basePath(companyId)}/menu/${id}`),
  toggleAvailability: (companyId: string, id: string, available: boolean) =>
    api.post<MenuItem>(`${basePath(companyId)}/menu/${id}/availability`, {
      available,
    }),

  // Tables
  listTables: (companyId: string) =>
    api.get<{ tables: Table[] }>(`${basePath(companyId)}/tables`),
  createTable: (companyId: string, body: CreateTableInput) =>
    api.post<Table>(`${basePath(companyId)}/tables`, body),
  updateTable: (
    companyId: string,
    id: string,
    body: Partial<CreateTableInput>,
  ) => api.put<Table>(`${basePath(companyId)}/tables/${id}`, body),
  deleteTable: (companyId: string, id: string) =>
    api.delete<void>(`${basePath(companyId)}/tables/${id}`),
  setTableStatus: (companyId: string, id: string, status: TableStatus) =>
    api.post<Table>(`${basePath(companyId)}/tables/${id}/status`, { status }),

  // Orders
  listOrders: (
    companyId: string,
    opts?: { status?: OrderStatus; type?: OrderType; date?: string },
  ) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.type) params.set("type", opts.type);
    if (opts?.date) params.set("date", opts.date);
    const qs = params.toString();
    return api.get<{ orders: Order[] }>(
      `${basePath(companyId)}/orders${qs ? `?${qs}` : ""}`,
    );
  },
  getOrder: (companyId: string, id: string) =>
    api.get<Order>(`${basePath(companyId)}/orders/${id}`),
  createOrder: (companyId: string, body: CreateOrderInput) =>
    api.post<Order>(`${basePath(companyId)}/orders`, body),
  addItem: (
    companyId: string,
    orderId: string,
    body: {
      itemId: string;
      quantity: number;
      modifiers?: Array<{ name: string }>;
      notes?: string;
    },
  ) => api.post<Order>(`${basePath(companyId)}/orders/${orderId}/items`, body),
  removeItem: (companyId: string, orderId: string, index: number) =>
    api.delete<Order>(
      `${basePath(companyId)}/orders/${orderId}/items/${index}`,
    ),
  voidItem: (
    companyId: string,
    orderId: string,
    index: number,
    reason: string,
  ) =>
    api.post<Order>(
      `${basePath(companyId)}/orders/${orderId}/items/${index}/void`,
      { reason },
    ),
  sendToKitchen: (companyId: string, orderId: string) =>
    api.post<Order>(
      `${basePath(companyId)}/orders/${orderId}/send-to-kitchen`,
      {},
    ),
  markServed: (companyId: string, orderId: string) =>
    api.post<Order>(`${basePath(companyId)}/orders/${orderId}/serve`, {}),
  applyDiscount: (
    companyId: string,
    orderId: string,
    discountCents: number,
    reason?: string,
  ) =>
    api.post<Order>(`${basePath(companyId)}/orders/${orderId}/discount`, {
      discountCents,
      reason,
    }),
  takePayment: (
    companyId: string,
    orderId: string,
    body: { method: PaymentMethod; amountCents: number },
  ) =>
    api.post<Order>(`${basePath(companyId)}/orders/${orderId}/payments`, body),
  closeOrder: (companyId: string, orderId: string) =>
    api.post<Order>(`${basePath(companyId)}/orders/${orderId}/close`, {}),
  cancelOrder: (companyId: string, orderId: string, reason: string) =>
    api.post<Order>(`${basePath(companyId)}/orders/${orderId}/cancel`, {
      reason,
    }),

  // Kitchen
  listKitchen: (
    companyId: string,
    opts?: { station?: string; status?: string },
  ) => {
    const params = new URLSearchParams();
    if (opts?.station) params.set("station", opts.station);
    if (opts?.status) params.set("status", opts.status);
    const qs = params.toString();
    return api.get<{ tickets: KitchenTicket[] }>(
      `${basePath(companyId)}/kitchen${qs ? `?${qs}` : ""}`,
    );
  },
  markItemReady: (companyId: string, orderId: string, index: number) =>
    api.post<Order>(
      `${basePath(companyId)}/orders/${orderId}/items/${index}/ready`,
      {},
    ),

  // Setup + reports
  setupDefaults: (companyId: string) =>
    api.post<{ ok: boolean }>(`${basePath(companyId)}/setup-defaults`, {}),
  getDashboard: (companyId: string) =>
    api.get<RestaurantDashboard>(`${basePath(companyId)}/dashboard`),
  getZReport: (companyId: string, date?: string) => {
    const qs = date ? `?date=${date}` : "";
    return api.get<ZReport>(`${basePath(companyId)}/z-report${qs}`);
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a fils amount as a KWD string with 3-decimal precision.
 * Use this throughout the restaurant UI so prices are consistent.
 */
export function formatKwd(cents: number): string {
  const kwd = cents / 1000;
  return `${kwd.toFixed(3)} KWD`;
}

/**
 * Group menu items by their category in stable order.
 */
export function groupByCategory(items: MenuItem[]): Array<{
  category: string;
  items: MenuItem[];
}> {
  const map = new Map<string, MenuItem[]>();
  for (const item of items) {
    const existing = map.get(item.category) ?? [];
    existing.push(item);
    map.set(item.category, existing);
  }
  return Array.from(map.entries()).map(([category, list]) => ({
    category,
    items: list,
  }));
}
