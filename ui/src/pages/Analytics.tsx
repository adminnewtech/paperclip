import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Banknote,
  Receipt,
  TrendingUp,
  PackageX,
  LifeBuoy,
  Store,
  Globe,
  FileText,
  Warehouse,
  Users,
  type LucideIcon,
} from "lucide-react";
import { currencyFractionDigits, minorToMajor } from "@paperclipai/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  analyticsApi,
  type DashboardData,
  type SalesModule,
} from "../api/analytics";

const DEFAULT_CURRENCY = "KWD";

function formatMinor(amountMinor: number, currency = DEFAULT_CURRENCY): string {
  const digits = currencyFractionDigits(currency);
  return `${minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

const MODULE_META: Record<SalesModule, { label: string; icon: LucideIcon }> = {
  pos: { label: "POS", icon: Store },
  online: { label: "Online", icon: Globe },
  manual: { label: "Manual / Invoices", icon: FileText },
};

export function Analytics() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Analytics" }]);
  }, [setBreadcrumbs]);

  const companyId = selectedCompanyId ?? "";

  const dashboardQuery = useQuery({
    queryKey: ["analytics", "dashboard", companyId],
    queryFn: () => analyticsApi.dashboard(companyId),
    enabled: !!companyId,
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={BarChart3}
        message="Select a workspace to open Analytics."
      />
    );
  }

  if (dashboardQuery.isLoading) {
    return (
      <div className="space-y-6" dir="auto">
        <Header />
        <PageSkeleton variant="list" />
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <div className="space-y-6" dir="auto">
        <Header />
        <EmptyState
          icon={BarChart3}
          message={
            (dashboardQuery.error as Error)?.message ??
            "Failed to load analytics."
          }
        />
      </div>
    );
  }

  const data = dashboardQuery.data as DashboardData | undefined;
  if (!data) {
    return (
      <div className="space-y-6" dir="auto">
        <Header />
        <EmptyState
          icon={BarChart3}
          message="No analytics data yet. Record some sales to populate the dashboard."
        />
      </div>
    );
  }

  const { kpis, revenueTrend, salesByModule, topProducts, topCustomers } = data;
  const valuation = data.inventoryValuation;

  return (
    <div className="space-y-6" dir="auto">
      <Header generatedAt={data.generatedAt} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          icon={Banknote}
          label="Revenue"
          value={formatMinor(kpis.revenueMinor)}
        />
        <StatCard
          icon={Receipt}
          label="Avg order value"
          value={formatMinor(kpis.avgOrderValueMinor)}
        />
        <StatCard
          icon={TrendingUp}
          label="Open deals value"
          value={formatMinor(kpis.openDealsValueMinor)}
        />
        <StatCard
          icon={PackageX}
          label="Low stock"
          value={String(kpis.lowStockCount)}
        />
        <StatCard
          icon={LifeBuoy}
          label="Open tickets"
          value={String(kpis.openTickets)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Revenue trend bars */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Revenue Trend (monthly)
            </h2>
            <RevenueBars points={revenueTrend} />
          </CardContent>
        </Card>

        {/* Sales by channel */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Store className="h-4 w-4 text-primary" />
              Sales by Channel
            </h2>
            {salesByModule.every((m) => m.count === 0) ? (
              <p className="text-sm text-muted-foreground">No sales recorded.</p>
            ) : (
              <div className="space-y-2">
                {salesByModule.map((m) => {
                  const meta = MODULE_META[m.module];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={m.module}
                      className="flex items-center justify-between gap-3 rounded-md border p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{meta.label}</span>
                        <Badge variant="outline">{m.count} orders</Badge>
                      </div>
                      <span className="text-sm font-mono">
                        {formatMinor(m.totalMinor)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top products */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Top Products
            </h2>
            {topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No product sales yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground text-start">
                    <th className="text-start font-medium pb-1">Product</th>
                    <th className="text-end font-medium pb-1">Qty</th>
                    <th className="text-end font-medium pb-1">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p) => (
                    <tr key={p.variantId ?? p.name} className="border-t">
                      <td className="py-1.5 pe-2 truncate max-w-[180px]">
                        {p.name}
                      </td>
                      <td className="py-1.5 text-end font-mono">{p.qty}</td>
                      <td className="py-1.5 text-end font-mono">
                        {formatMinor(p.revenueMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Top customers */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Top Customers
            </h2>
            {topCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No customer revenue yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-start font-medium pb-1">Customer</th>
                    <th className="text-end font-medium pb-1">Orders</th>
                    <th className="text-end font-medium pb-1">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((c) => (
                    <tr key={c.customer} className="border-t">
                      <td className="py-1.5 pe-2 truncate max-w-[180px]">
                        {c.customer}
                      </td>
                      <td className="py-1.5 text-end font-mono">{c.orders}</td>
                      <td className="py-1.5 text-end font-mono">
                        {formatMinor(c.totalMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Inventory valuation */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Warehouse className="h-4 w-4 text-primary" />
            Inventory Valuation
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ValuationCell label="On-hand units" value={String(valuation.totalUnits)} />
            <ValuationCell
              label="Cost value"
              value={formatMinor(valuation.totalCostMinor)}
            />
            <ValuationCell
              label="Retail value"
              value={formatMinor(valuation.totalRetailMinor)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Header({ generatedAt }: { generatedAt?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          Analytics
        </h1>
        <p className="text-sm text-muted-foreground">
          Cross-domain business intelligence across Sales, Finance, Inventory,
          and CRM.
        </p>
      </div>
      {generatedAt && (
        <p className="text-xs text-muted-foreground self-end">
          Updated {new Date(generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="text-lg font-semibold font-mono mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function ValuationCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold font-mono mt-1">{value}</div>
    </div>
  );
}

function RevenueBars({
  points,
}: {
  points: { period: string; revenueMinor: number }[];
}) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No revenue recorded.</p>;
  }
  const max = Math.max(...points.map((p) => p.revenueMinor), 1);
  return (
    <div className="flex items-end gap-2 h-40">
      {points.map((p) => {
        const heightPct = Math.max(2, Math.round((p.revenueMinor / max) * 100));
        return (
          <div
            key={p.period}
            className="flex flex-1 flex-col items-center justify-end gap-1 min-w-0"
            title={`${p.period}: ${formatMinor(p.revenueMinor)}`}
          >
            <span className="text-[10px] font-mono text-muted-foreground truncate w-full text-center">
              {formatMinor(p.revenueMinor)}
            </span>
            <div
              className="w-full rounded-t bg-primary/70"
              style={{ height: `${heightPct}%` }}
            />
            <span className="text-[10px] text-muted-foreground truncate w-full text-center">
              {p.period}
            </span>
          </div>
        );
      })}
    </div>
  );
}
