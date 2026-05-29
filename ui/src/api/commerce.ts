import { api } from "./client";

export interface WarehouseRow {
  id: string;
  companyId: string;
  name: string;
  location: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockRow {
  id: string;
  variantId: string;
  warehouseId: string;
  qty: number;
  reserved: number;
  reorderPoint: number | null;
  variantSku: string | null;
  variantBarcode: string | null;
  productId: string | null;
  productName: string | null;
}

export interface PosCheckoutLineInput {
  variantId: string;
  qty: number;
  unitPriceMinor: number;
}

export interface PosCheckoutInput {
  warehouseId: string;
  lines: PosCheckoutLineInput[];
  paymentMethod: string;
  customerName?: string;
  currency: string;
  taxRatePct: number;
}

export interface PosOrderRow {
  id: string;
  companyId: string;
  sessionId: string | null;
  warehouseId: string;
  lines: PosCheckoutLineInput[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  paymentMethod: string;
  customerName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const commerceApi = {
  listWarehouses: (companyId: string) =>
    api.get<{ warehouses: WarehouseRow[] }>(
      `/companies/${companyId}/warehouses`,
    ),

  createWarehouse: (
    companyId: string,
    body: { name: string; location?: string | null },
  ) => api.post<WarehouseRow>(`/companies/${companyId}/warehouses`, body),

  listStock: (companyId: string, warehouseId?: string) => {
    const params = new URLSearchParams();
    if (warehouseId) params.set("warehouseId", warehouseId);
    const qs = params.toString();
    return api.get<{ stock: StockRow[] }>(
      `/companies/${companyId}/stock${qs ? `?${qs}` : ""}`,
    );
  },

  posCheckout: (companyId: string, body: PosCheckoutInput) =>
    api.post<PosOrderRow>(`/companies/${companyId}/pos/checkout`, body),
};
