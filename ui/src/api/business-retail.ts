/**
 * Retail vertical API client.
 *
 * Mirrors the REST endpoints exposed by `server/src/routes/verticals/retail.ts`.
 * All amounts are integer cents (fils). The server is the source of truth for
 * totals — the UI should never recompute them.
 */

import { api } from "./client";

// ---------- Types ----------

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

export interface RetailSaleItem {
  productId: string;
  productName: string;
  barcode?: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxRatePercent: number;
  lineTaxCents: number;
  lineTotalCents: number;
  refunded?: boolean;
}

export type RetailPaymentMethod = "cash" | "card" | "knet" | "loyalty" | "store_credit";

export interface RetailSalePayment {
  method: RetailPaymentMethod;
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

export type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";

export interface LoyaltyMember {
  id: string;
  code: string;
  customerId: string;
  customerName: string;
  phone: string;
  email?: string;
  tier: LoyaltyTier;
  pointsBalance: number;
  pointsLifetimeEarned: number;
  pointsLifetimeRedeemed: number;
  birthMonth?: number;
  enrolledAt: string;
  lastActivityAt?: string;
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
  lowStock: Array<{
    productId: string;
    name: string;
    totalStock: number;
    reorderPoint: number;
  }>;
  loyaltyMembers: { total: number; byTier: Record<LoyaltyTier, number> };
  locationCount: number;
}

// ---------- Helpers ----------

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const base = (companyId: string) => `/companies/${companyId}/business/retail`;

// ---------- Client ----------

export const businessRetailApi = {
  // Locations
  listLocations: (companyId: string) =>
    api.get<{ locations: RetailLocation[] }>(`${base(companyId)}/locations`),
  createLocation: (companyId: string, body: Omit<RetailLocation, "id" | "code">) =>
    api.post<{ location: RetailLocation }>(`${base(companyId)}/locations`, body),
  updateLocation: (
    companyId: string,
    id: string,
    body: Partial<RetailLocation>,
  ) => api.patch<{ location: RetailLocation }>(`${base(companyId)}/locations/${id}`, body),
  deleteLocation: (companyId: string, id: string) =>
    api.delete<void>(`${base(companyId)}/locations/${id}`),

  // Products
  listProducts: (
    companyId: string,
    opts?: { q?: string; locationId?: string; lowStockOnly?: boolean },
  ) =>
    api.get<{ products: RetailProduct[] }>(
      `${base(companyId)}/products${qs({
        q: opts?.q,
        locationId: opts?.locationId,
        lowStockOnly: opts?.lowStockOnly,
      })}`,
    ),
  getProductByBarcode: (companyId: string, barcode: string) =>
    api.get<{ product: RetailProduct }>(
      `${base(companyId)}/products/barcode/${encodeURIComponent(barcode)}`,
    ),
  createProduct: (companyId: string, body: Omit<RetailProduct, "id" | "code">) =>
    api.post<{ product: RetailProduct }>(`${base(companyId)}/products`, body),
  updateProduct: (
    companyId: string,
    id: string,
    body: Partial<RetailProduct>,
  ) => api.patch<{ product: RetailProduct }>(`${base(companyId)}/products/${id}`, body),
  setStock: (
    companyId: string,
    productId: string,
    body: { locationId: string; quantity: number; reason?: string },
  ) =>
    api.post<{ product: RetailProduct }>(
      `${base(companyId)}/products/${productId}/stock`,
      body,
    ),

  // Sales
  listSales: (
    companyId: string,
    opts?: {
      locationId?: string;
      date?: string;
      status?: RetailSaleStatus;
      limit?: number;
    },
  ) =>
    api.get<{ sales: RetailSale[] }>(
      `${base(companyId)}/sales${qs({
        locationId: opts?.locationId,
        date: opts?.date,
        status: opts?.status,
        limit: opts?.limit,
      })}`,
    ),
  startSale: (companyId: string, body: { locationId: string; cashierId?: string }) =>
    api.post<{ sale: RetailSale }>(`${base(companyId)}/sales`, body),
  getSale: (companyId: string, id: string) =>
    api.get<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}`),
  addItem: (
    companyId: string,
    id: string,
    body: { barcode?: string; productId?: string; quantity: number },
  ) => api.post<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/items`, body),
  removeItem: (companyId: string, id: string, index: number) =>
    api.delete<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/items/${index}`),
  applyDiscount: (
    companyId: string,
    id: string,
    body: { type: "amount" | "percent"; value: number; reason?: string },
  ) => api.post<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/discount`, body),
  attachCustomer: (companyId: string, id: string, customerId: string) =>
    api.post<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/customer`, {
      customerId,
    }),
  attachLoyalty: (companyId: string, id: string, phone: string) =>
    api.post<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/loyalty`, { phone }),
  redeemPoints: (companyId: string, id: string, points: number) =>
    api.post<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/redeem`, { points }),
  takePayment: (
    companyId: string,
    id: string,
    body: { method: RetailPaymentMethod; amountCents: number },
  ) => api.post<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/payment`, body),
  completeSale: (companyId: string, id: string) =>
    api.post<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/complete`, {}),
  voidSale: (companyId: string, id: string, reason: string) =>
    api.post<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/void`, { reason }),
  refundSale: (
    companyId: string,
    id: string,
    body: { items?: number[]; reason: string },
  ) => api.post<{ sale: RetailSale }>(`${base(companyId)}/sales/${id}/refund`, body),

  // Loyalty
  listMembers: (companyId: string, opts?: { q?: string; tier?: string }) =>
    api.get<{ members: LoyaltyMember[] }>(
      `${base(companyId)}/loyalty/members${qs({ q: opts?.q, tier: opts?.tier })}`,
    ),
  enrollMember: (
    companyId: string,
    body: {
      customerId: string;
      customerName: string;
      phone: string;
      email?: string;
      birthMonth?: number;
    },
  ) =>
    api.post<{ member: LoyaltyMember }>(`${base(companyId)}/loyalty/members`, body),
  getMember: (companyId: string, id: string) =>
    api.get<{ member: LoyaltyMember }>(`${base(companyId)}/loyalty/members/${id}`),
  adjustPoints: (
    companyId: string,
    id: string,
    body: { points: number; reason: string },
  ) =>
    api.post<{ member: LoyaltyMember }>(
      `${base(companyId)}/loyalty/members/${id}/adjust`,
      body,
    ),

  // Transfers
  listTransfers: (companyId: string) =>
    api.get<{ transfers: InventoryTransfer[] }>(`${base(companyId)}/transfers`),
  createTransfer: (
    companyId: string,
    body: {
      fromLocationId: string;
      toLocationId: string;
      items: Array<{ productId: string; quantity: number }>;
    },
  ) => api.post<{ transfer: InventoryTransfer }>(`${base(companyId)}/transfers`, body),
  shipTransfer: (companyId: string, id: string) =>
    api.post<{ transfer: InventoryTransfer }>(`${base(companyId)}/transfers/${id}/ship`, {}),
  receiveTransfer: (companyId: string, id: string) =>
    api.post<{ transfer: InventoryTransfer }>(
      `${base(companyId)}/transfers/${id}/receive`,
      {},
    ),

  // End of day
  getEndOfDay: (companyId: string, locationId: string, date: string) =>
    api.get<{ report: EndOfDayReport }>(
      `${base(companyId)}/end-of-day${qs({ locationId, date })}`,
    ),
  closeEndOfDay: (
    companyId: string,
    body: { locationId: string; date: string; actualCashCents: number },
  ) => api.post<{ report: EndOfDayReport }>(`${base(companyId)}/end-of-day/close`, body),

  // Dashboard + setup
  getDashboard: (companyId: string, opts?: { locationId?: string }) =>
    api.get<{ dashboard: RetailDashboard }>(
      `${base(companyId)}/dashboard${qs({ locationId: opts?.locationId })}`,
    ),
  setupDefaults: (companyId: string) =>
    api.post<{ ok: true }>(`${base(companyId)}/setup`, {}),
};

// ---------- Formatting helpers ----------

export function formatFils(amountCents: number, currency = "KWD"): string {
  // Kuwaiti dinar has 3 decimal places (fils). KWD 1.000 = 1000 fils.
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 3 : 2;
  return `${(amountCents / Math.pow(10, decimals)).toFixed(decimals)} ${currency}`;
}

export const LOYALTY_TIER_COLORS: Record<LoyaltyTier, string> = {
  bronze:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  silver:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-700/40 dark:text-zinc-200",
  gold:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  platinum:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};
