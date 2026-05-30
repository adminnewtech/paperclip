import { api } from "./client";

export interface VendorRow {
  id: string;
  companyId: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  paymentTerms: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderRow {
  id: string;
  companyId: string;
  number: string | null;
  vendorId: string | null;
  warehouseId: string | null;
  status: string;
  orderDate: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PoLineRow {
  id: string;
  companyId: string;
  poId: string;
  variantId: string | null;
  description: string | null;
  qty: number;
  unitPriceMinor: number;
  receivedQty: number;
}

export interface GoodsReceiptRow {
  id: string;
  companyId: string;
  poId: string;
  warehouseId: string | null;
  receivedAt: string | null;
  lines: Array<{ variantId: string; qty: number }>;
}

export interface VendorBillRow {
  id: string;
  companyId: string;
  poId: string | null;
  vendorId: string | null;
  number: string | null;
  amountMinor: number;
  currency: string | null;
  status: string | null;
  matched: boolean;
}

export interface PoLineInput {
  variantId?: string | null;
  description?: string | null;
  qty: number;
  unitPriceMinor: number;
}

export interface CreatePoInput {
  vendorId?: string | null;
  warehouseId?: string | null;
  number?: string | null;
  currency: string;
  taxRatePct: number;
  lines: PoLineInput[];
}

export interface ReceiveInput {
  warehouseId?: string | null;
  lines: Array<{ variantId: string; qty: number }>;
}

export interface BillInput {
  billAmountMinor: number;
  number?: string | null;
  currency?: string | null;
}

export interface ReceiveResult {
  receipt: GoodsReceiptRow;
  order: PurchaseOrderRow;
}

export interface BillResult {
  matched: boolean;
  variance: number;
  bill: VendorBillRow;
}

export interface PurchaseOrderDetail {
  order: PurchaseOrderRow;
  lines: PoLineRow[];
  receipts: GoodsReceiptRow[];
}

export const purchasingApi = {
  listVendors: (companyId: string) =>
    api.get<{ vendors: VendorRow[] }>(
      `/companies/${companyId}/purchasing/vendors`,
    ),

  createVendor: (
    companyId: string,
    body: {
      name: string;
      email?: string | null;
      phone?: string | null;
      taxId?: string | null;
      paymentTerms?: string | null;
    },
  ) =>
    api.post<VendorRow>(`/companies/${companyId}/purchasing/vendors`, body),

  listOrders: (companyId: string) =>
    api.get<{ orders: PurchaseOrderRow[] }>(
      `/companies/${companyId}/purchasing/orders`,
    ),

  getOrder: (companyId: string, poId: string) =>
    api.get<PurchaseOrderDetail>(
      `/companies/${companyId}/purchasing/orders/${poId}`,
    ),

  createOrder: (companyId: string, body: CreatePoInput) =>
    api.post<{ order: PurchaseOrderRow; lines: PoLineRow[] }>(
      `/companies/${companyId}/purchasing/orders`,
      body,
    ),

  sendOrder: (companyId: string, poId: string) =>
    api.post<PurchaseOrderRow>(
      `/companies/${companyId}/purchasing/orders/${poId}/send`,
      {},
    ),

  receiveOrder: (companyId: string, poId: string, body: ReceiveInput) =>
    api.post<ReceiveResult>(
      `/companies/${companyId}/purchasing/orders/${poId}/receive`,
      body,
    ),

  billOrder: (companyId: string, poId: string, body: BillInput) =>
    api.post<BillResult>(
      `/companies/${companyId}/purchasing/orders/${poId}/bill`,
      body,
    ),
};
