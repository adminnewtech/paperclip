import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Gift,
  ScanLine,
  ShoppingBag,
  TrendingUp,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import { businessRetailApi, formatFils } from "../../api/business-retail";

export function RetailDashboardPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Retail" },
    ]);
  }, [setBreadcrumbs]);

  const dashboardQuery = useQuery({
    queryKey: ["retail", companyId, "dashboard"],
    queryFn: () => businessRetailApi.getDashboard(companyId),
    enabled: !!companyId,
  });

  const locationsQuery = useQuery({
    queryKey: ["retail", companyId, "locations"],
    queryFn: () => businessRetailApi.listLocations(companyId),
    enabled: !!companyId,
  });

  const setupMutation = useMutation({
    mutationFn: () => businessRetailApi.setupDefaults(companyId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["retail", companyId] });
    },
  });

  if (!selectedCompany) return <PageSkeleton variant="dashboard" />;
  if (dashboardQuery.isLoading || locationsQuery.isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const dashboard = dashboardQuery.data?.dashboard;
  const locations = locationsQuery.data?.locations ?? [];

  if (!dashboard || locations.length === 0) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Retail</h1>
        <EmptyState
          icon={ShoppingBag}
          message="Set up your first store location to start using the retail vertical."
          action="Create default store"
          onAction={() => setupMutation.mutate()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Retail dashboard</h1>
          <p className="text-sm text-muted-foreground">
            POS, inventory, loyalty and end-of-day across {locations.length}{" "}
            location{locations.length === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/business/retail/pos">
              <ScanLine className="mr-2 h-4 w-4" />
              Open POS
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">
              Sales today
            </div>
            <div className="mt-1 text-2xl font-bold">
              {formatFils(dashboard.salesToday.totalCents)}
            </div>
            <div className="text-xs text-muted-foreground">
              {dashboard.salesToday.count} transactions
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">
              Sales this month
            </div>
            <div className="mt-1 text-2xl font-bold">
              {formatFils(dashboard.salesThisMonth.totalCents)}
            </div>
            <div className="text-xs text-muted-foreground">
              {dashboard.salesThisMonth.count} transactions
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">
              Loyalty members
            </div>
            <div className="mt-1 text-2xl font-bold">
              {dashboard.loyaltyMembers.total}
            </div>
            <div className="text-xs text-muted-foreground">
              {dashboard.loyaltyMembers.byTier.gold +
                dashboard.loyaltyMembers.byTier.platinum}{" "}
              gold/platinum
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">
              Low-stock SKUs
            </div>
            <div className="mt-1 text-2xl font-bold">
              {dashboard.lowStock.length}
            </div>
            <div className="text-xs text-muted-foreground">
              across all locations
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link
          to="/business/retail/pos"
          className="group flex items-center justify-between border border-border bg-card p-4 hover:bg-accent"
        >
          <div className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            <span className="font-medium">POS terminal</span>
          </div>
          <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100" />
        </Link>
        <Link
          to="/business/retail/inventory"
          className="group flex items-center justify-between border border-border bg-card p-4 hover:bg-accent"
        >
          <div className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            <span className="font-medium">Inventory</span>
          </div>
          <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100" />
        </Link>
        <Link
          to="/business/retail/loyalty"
          className="group flex items-center justify-between border border-border bg-card p-4 hover:bg-accent"
        >
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            <span className="font-medium">Loyalty</span>
          </div>
          <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100" />
        </Link>
        <Link
          to="/business/retail/end-of-day"
          className="group flex items-center justify-between border border-border bg-card p-4 hover:bg-accent"
        >
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            <span className="font-medium">End of day</span>
          </div>
          <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100" />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top products */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Top products this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sales yet this month.
              </p>
            ) : (
              <ul className="space-y-2">
                {dashboard.topProducts.map((p) => (
                  <li key={p.name} className="flex items-center justify-between">
                    <span className="truncate">{p.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {p.quantity} × · {formatFils(p.revenueCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Low stock */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Low stock
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                All SKUs above their reorder point.
              </p>
            ) : (
              <ul className="space-y-2">
                {dashboard.lowStock.map((row) => (
                  <li key={row.productId} className="flex items-center justify-between">
                    <span className="truncate">{row.name}</span>
                    <span className="text-sm">
                      {row.totalStock} / {row.reorderPoint}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Locations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Store locations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {locations.map((loc) => (
              <li key={loc.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-medium">
                    {loc.name}
                    {loc.isMain && (
                      <span className="ml-2 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">
                        Main
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {loc.address || "No address"} · {loc.posTerminals} POS terminal
                    {loc.posTerminals === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{loc.code}</div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
