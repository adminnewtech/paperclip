import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import {
  TrendingUp,
  FileCheck,
  Target,
  Users,
  LifeBuoy,
  Receipt,
  Package,
  Calculator,
  IdCard,
  Megaphone,
  ShoppingBag,
  Briefcase,
  ArrowRight,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessFinancialSummary } from "../api/business";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBusinessStreamInvalidation } from "../hooks/useBusinessStream";
import { SmartInputBar } from "../components/business/SmartInputBar";

const MODULE_ICONS: Record<string, LucideIcon> = {
  crm: Users,
  sales: Receipt,
  inventory: Package,
  finance: Calculator,
  hr: IdCard,
  helpdesk: LifeBuoy,
  marketing: Megaphone,
  ecommerce: ShoppingBag,
};

const MODULE_LABELS: Record<string, string> = {
  crm: "CRM",
  sales: "Sales",
  inventory: "Inventory",
  finance: "Finance",
  hr: "HR",
  helpdesk: "Helpdesk",
  marketing: "Marketing",
  ecommerce: "E-commerce",
};

function formatCurrency(cents: number, currency = "SAR"): string {
  return (cents / 100).toLocaleString("en-SA", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

interface KpiCardProps {
  title: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger";
  href?: string;
}

function KpiCard({ title, value, sub, icon: Icon, tone = "default", href }: KpiCardProps) {
  const iconBg =
    tone === "success"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : tone === "warning"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        : tone === "danger"
          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          : "bg-muted text-muted-foreground";

  const inner = (
    <CardContent className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-lg ${iconBg}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </CardContent>
  );

  if (href) {
    return (
      <Link to={href}>
        <Card className="hover:shadow-md transition-shadow cursor-pointer">{inner}</Card>
      </Link>
    );
  }
  return <Card>{inner}</Card>;
}

export function BusinessDashboard() {
  const { selectedCompanyId } = useCompany();
  useBusinessStreamInvalidation(selectedCompanyId);
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Business", href: "/business" }, { label: "Dashboard" }]);
  }, [setBreadcrumbs]);

  const modulesQuery = useQuery({
    queryKey: queryKeys.business.modules(selectedCompanyId!),
    queryFn: () => businessApi.listModules(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const financialQuery = useQuery({
    queryKey: queryKeys.business.financialSummary(selectedCompanyId!),
    queryFn: () => businessApi.financialSummary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 60_000,
  });

  const enabledModules = useMemo(
    () => (modulesQuery.data?.modules ?? []).filter((m) => m.enabled),
    [modulesQuery.data],
  );

  const fin: BusinessFinancialSummary = financialQuery.data ?? {
    revenueThisMonthCents: 0,
    outstandingCents: 0,
    pipelineCents: 0,
    expensesThisMonthCents: 0,
    counts: {},
  };

  if (modulesQuery.isLoading || financialQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const totalEntities = Object.values(fin.counts).reduce(
    (a, b) => a + Object.values(b).reduce((x, y) => x + y, 0),
    0,
  );

  const crmEnabled = enabledModules.some((m) => m.moduleKey === "crm");
  const salesEnabled = enabledModules.some((m) => m.moduleKey === "sales");
  const financeEnabled = enabledModules.some((m) => m.moduleKey === "finance");
  const helpdeskEnabled = enabledModules.some((m) => m.moduleKey === "helpdesk");
  const hrEnabled = enabledModules.some((m) => m.moduleKey === "hr");
  const inventoryEnabled = enabledModules.some((m) => m.moduleKey === "inventory");

  const contactCount = fin.counts["crm"]?.["contact"] ?? 0;
  const leadCount = fin.counts["crm"]?.["lead"] ?? 0;
  const dealCount = (fin.counts["crm"]?.["deal"] ?? 0);
  const invoiceCount = fin.counts["sales"]?.["invoice"] ?? 0;
  const ticketCount = fin.counts["helpdesk"]?.["ticket"] ?? 0;
  const employeeCount = fin.counts["hr"]?.["employee"] ?? 0;
  const productCount = fin.counts["inventory"]?.["product"] ?? 0;

  return (
    <div className="space-y-6">
      <SmartInputBar />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Business Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {enabledModules.length} module{enabledModules.length !== 1 ? "s" : ""} active ·{" "}
            {totalEntities.toLocaleString()} total records
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/business/brain">
              <Sparkles className="ml-1.5 h-3.5 w-3.5" />
              Business Brain
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/business/automations">
              <Zap className="ml-1.5 h-3.5 w-3.5" />
              Automations
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/business/analytics">
              Analytics
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/business">
              All modules
            </Link>
          </Button>
        </div>
      </div>

      {/* Financial KPIs */}
      {(salesEnabled || financeEnabled) && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Financial
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {salesEnabled && (
              <KpiCard
                title="Revenue This Month"
                value={formatCurrency(fin.revenueThisMonthCents)}
                sub="Paid invoices"
                icon={TrendingUp}
                tone="success"
                href="/business/sales"
              />
            )}
            {salesEnabled && (
              <KpiCard
                title="Outstanding"
                value={formatCurrency(fin.outstandingCents)}
                sub="Sent & overdue invoices"
                icon={FileCheck}
                tone={fin.outstandingCents > 0 ? "warning" : "default"}
                href="/business/sales"
              />
            )}
            {crmEnabled && (
              <KpiCard
                title="Pipeline Value"
                value={formatCurrency(fin.pipelineCents)}
                sub={`${dealCount} active deal${dealCount !== 1 ? "s" : ""}`}
                icon={Target}
                tone="default"
                href="/business/crm"
              />
            )}
            {financeEnabled && (
              <KpiCard
                title="Expenses This Month"
                value={formatCurrency(fin.expensesThisMonthCents)}
                sub="Finance module"
                icon={Calculator}
                tone={fin.expensesThisMonthCents > 0 ? "warning" : "default"}
                href="/business/finance"
              />
            )}
          </div>
        </div>
      )}

      {/* Operations KPIs */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Operations
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {crmEnabled && (
            <KpiCard
              title="Contacts"
              value={String(contactCount + leadCount)}
              sub={`${contactCount} contacts · ${leadCount} leads`}
              icon={Users}
              href="/business/crm"
            />
          )}
          {salesEnabled && (
            <KpiCard
              title="Invoices"
              value={String(invoiceCount)}
              sub="All time"
              icon={Receipt}
              href="/business/sales"
            />
          )}
          {inventoryEnabled && (
            <KpiCard
              title="Products"
              value={String(productCount)}
              sub="In catalog"
              icon={Package}
              href="/business/inventory"
            />
          )}
          {helpdeskEnabled && (
            <KpiCard
              title="Open Tickets"
              value={String(ticketCount)}
              sub="Support queue"
              icon={LifeBuoy}
              tone={ticketCount > 10 ? "danger" : ticketCount > 0 ? "warning" : "default"}
              href="/business/helpdesk"
            />
          )}
          {hrEnabled && (
            <KpiCard
              title="Employees"
              value={String(employeeCount)}
              sub="Active staff"
              icon={IdCard}
              href="/business/hr"
            />
          )}
        </div>
      </div>

      {/* Module shortcuts */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Modules
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {enabledModules.map((mod) => {
            const Icon = MODULE_ICONS[mod.moduleKey] ?? Briefcase;
            const label = MODULE_LABELS[mod.moduleKey] ?? mod.moduleKey;
            const counts = fin.counts[mod.moduleKey] ?? {};
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            return (
              <Link key={mod.moduleKey} to={`/business/${mod.moduleKey}`}>
                <Card className="hover:shadow-sm transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-muted rounded-md p-1.5">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{label}</span>
                          {total > 0 && (
                            <Badge variant="secondary" className="text-[10px] px-1.5">
                              {total}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
