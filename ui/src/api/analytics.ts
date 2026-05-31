import { api } from "./client";

export type RevenueBucket = "day" | "month";
export type SalesModule = "pos" | "online" | "manual";
export type ReportKind =
  | "revenue"
  | "sales"
  | "inventory"
  | "crm"
  | "finance"
  | "custom";

export interface KpiRollup {
  revenueMinor: number;
  avgOrderValueMinor: number;
  openDealsValueMinor: number;
  lowStockCount: number;
  openTickets: number;
  grossMarginPct?: number;
}

export interface RevenueTrendPoint {
  period: string;
  revenueMinor: number;
}

export interface SalesByModuleRow {
  module: SalesModule;
  count: number;
  totalMinor: number;
}

export interface TopProductRow {
  variantId: string | null;
  name: string;
  qty: number;
  revenueMinor: number;
}

export interface TopCustomerRow {
  customer: string;
  totalMinor: number;
  orders: number;
}

export interface InventoryValuation {
  totalUnits: number;
  totalCostMinor: number;
  totalRetailMinor: number;
}

export interface DashboardData {
  kpis: KpiRollup;
  revenueTrend: RevenueTrendPoint[];
  salesByModule: SalesByModuleRow[];
  topProducts: TopProductRow[];
  topCustomers: TopCustomerRow[];
  inventoryValuation: InventoryValuation;
  generatedAt: string;
}

export interface ReportResult {
  kind: ReportKind;
  bucket: RevenueBucket;
  data: unknown;
}

export interface DashboardRow {
  id: string;
  companyId: string;
  name: string;
  layout: unknown;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportRow {
  id: string;
  companyId: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  schedule: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedQueryRow {
  id: string;
  companyId: string;
  name: string;
  entity: string;
  filters: Record<string, unknown>;
  columns: unknown;
  createdAt: string;
  updatedAt: string;
}

export const analyticsApi = {
  dashboard: (companyId: string) =>
    api.get<DashboardData>(`/companies/${companyId}/analytics/dashboard`),
  report: (companyId: string, kind: ReportKind, bucket: RevenueBucket = "month") =>
    api.get<ReportResult>(
      `/companies/${companyId}/analytics/report?kind=${encodeURIComponent(
        kind,
      )}&bucket=${encodeURIComponent(bucket)}`,
    ),
  listDashboards: (companyId: string) =>
    api.get<{ dashboards: DashboardRow[] }>(
      `/companies/${companyId}/analytics/dashboards`,
    ),
  saveDashboard: (
    companyId: string,
    body: { id?: string; name: string; layout?: unknown; isDefault?: boolean },
  ) =>
    api.post<{ dashboard: DashboardRow }>(
      `/companies/${companyId}/analytics/dashboards`,
      body,
    ),
  listReports: (companyId: string) =>
    api.get<{ reports: ReportRow[] }>(
      `/companies/${companyId}/analytics/reports`,
    ),
  saveReport: (
    companyId: string,
    body: {
      id?: string;
      name: string;
      kind?: string;
      config?: unknown;
      schedule?: string | null;
    },
  ) =>
    api.post<{ report: ReportRow }>(
      `/companies/${companyId}/analytics/reports`,
      body,
    ),
  listSavedQueries: (companyId: string) =>
    api.get<{ savedQueries: SavedQueryRow[] }>(
      `/companies/${companyId}/analytics/saved-queries`,
    ),
  saveSavedQuery: (
    companyId: string,
    body: {
      id?: string;
      name: string;
      entity: string;
      filters?: unknown;
      columns?: unknown;
    },
  ) =>
    api.post<{ savedQuery: SavedQueryRow }>(
      `/companies/${companyId}/analytics/saved-queries`,
      body,
    ),
};
