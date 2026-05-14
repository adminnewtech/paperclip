import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ChefHat,
  Clock,
  CreditCard,
  Layout,
  Sparkles,
  TrendingUp,
  Users,
  Utensils,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import {
  formatKwd,
  restaurantsApi,
} from "../../api/business-restaurants";

function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h12}${ampm}`;
}

export function RestaurantDashboardPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Restaurant" },
    ]);
  }, [setBreadcrumbs]);

  const menuQuery = useQuery({
    queryKey: ["restaurants", companyId, "menu"],
    queryFn: () => restaurantsApi.listMenu(companyId),
    enabled: !!companyId,
  });

  const dashboardQuery = useQuery({
    queryKey: ["restaurants", companyId, "dashboard"],
    queryFn: () => restaurantsApi.getDashboard(companyId),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  const setupMutation = useMutation({
    mutationFn: () => restaurantsApi.setupDefaults(companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["restaurants", companyId],
      });
    },
  });

  if (!selectedCompany) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a company first.
      </div>
    );
  }
  if (menuQuery.isLoading || dashboardQuery.isLoading) {
    return <PageSkeleton />;
  }

  const menu = menuQuery.data?.items ?? [];
  const dashboard = dashboardQuery.data;
  const needsSetup = menu.length === 0;
  const peakBest = dashboard?.peakHours.reduce(
    (best, cur) => (cur.orderCount > (best?.orderCount ?? 0) ? cur : best),
    null as null | { hour: number; orderCount: number },
  );

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Restaurant</h1>
          <p className="text-sm text-muted-foreground">
            Sales, tables, kitchen and menu in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/business/restaurant/pos">
            <Button>
              <CreditCard className="mr-2 h-4 w-4" />
              Open POS
            </Button>
          </Link>
          <Link to="/business/restaurant/kitchen">
            <Button variant="outline">
              <ChefHat className="mr-2 h-4 w-4" />
              Kitchen
            </Button>
          </Link>
          <Link to="/business/restaurant/tables">
            <Button variant="outline">
              <Layout className="mr-2 h-4 w-4" />
              Tables
            </Button>
          </Link>
          <Link to="/business/restaurant/menu">
            <Button variant="outline">
              <BookOpen className="mr-2 h-4 w-4" />
              Menu
            </Button>
          </Link>
        </div>
      </header>

      {needsSetup ? (
        <Card>
          <CardContent className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-medium">Welcome to your restaurant</h2>
              <p className="text-sm text-muted-foreground">
                Load a 27-item Kuwaiti menu (mains, sides, drinks, desserts)
                and a starter table layout — you can edit everything later.
              </p>
            </div>
            <Button
              onClick={() => setupMutation.mutate()}
              disabled={setupMutation.isPending}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {setupMutation.isPending ? "Setting up…" : "Set up defaults"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Today's revenue"
          value={formatKwd(dashboard?.todayRevenueCents ?? 0)}
        />
        <KpiCard
          icon={<Utensils className="h-5 w-5" />}
          label="Orders today"
          value={String(dashboard?.todayOrders ?? 0)}
          sub={`${dashboard?.openOrders ?? 0} open`}
        />
        <KpiCard
          icon={<CreditCard className="h-5 w-5" />}
          label="Avg. ticket"
          value={formatKwd(dashboard?.averageOrderValueCents ?? 0)}
        />
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          label="Tables"
          value={`${dashboard?.tablesOccupied ?? 0} / ${dashboard?.tablesTotal ?? 0}`}
          sub="occupied"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top items today</CardTitle>
          </CardHeader>
          <CardContent>
            {!dashboard || dashboard.topItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No paid orders yet today.
              </p>
            ) : (
              <ul className="space-y-2">
                {dashboard.topItems.map((it) => (
                  <li
                    key={it.itemName}
                    className="flex items-center justify-between gap-3 rounded-md border p-2"
                  >
                    <div>
                      <div className="text-sm font-medium">{it.itemName}</div>
                      <div className="text-xs text-muted-foreground">
                        {it.quantity} sold
                      </div>
                    </div>
                    <div className="font-semibold tabular-nums">
                      {formatKwd(it.revenueCents)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Peak hours today</CardTitle>
          </CardHeader>
          <CardContent>
            {!dashboard || dashboard.peakHours.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing to chart yet.
              </p>
            ) : (
              <div className="space-y-2">
                {peakBest ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Busiest hour:{" "}
                    <span className="font-semibold">
                      {formatHour(peakBest.hour)}
                    </span>{" "}
                    ({peakBest.orderCount} orders)
                  </div>
                ) : null}
                <div className="flex h-32 items-end gap-1">
                  {Array.from({ length: 24 }).map((_, h) => {
                    const bucket = dashboard.peakHours.find(
                      (p) => p.hour === h,
                    );
                    const count = bucket?.orderCount ?? 0;
                    const maxCount =
                      Math.max(
                        ...dashboard.peakHours.map((p) => p.orderCount),
                        1,
                      ) || 1;
                    const heightPct = (count / maxCount) * 100;
                    return (
                      <div
                        key={h}
                        title={`${formatHour(h)}: ${count}`}
                        className="flex flex-1 flex-col items-center justify-end"
                      >
                        <div
                          className="w-full rounded-t bg-primary/80"
                          style={{ height: `${heightPct}%` }}
                        />
                        {h % 6 === 0 ? (
                          <span className="mt-1 text-[9px] text-muted-foreground">
                            {formatHour(h)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function KpiCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="rounded-full bg-primary/10 p-3 text-primary">
          {props.icon}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {props.label}
          </div>
          <div className="text-2xl font-bold tabular-nums">{props.value}</div>
          {props.sub ? (
            <div className="text-xs text-muted-foreground">{props.sub}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
