import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Layers,
  Calculator,
  TrendingUp,
  ChevronRight,
  Lock,
} from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { businessAccountingApi } from "../api/business-accounting";

function formatCurrency(cents: number, currency = "KWD"): string {
  try {
    return (cents / 100).toLocaleString(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

interface HubCardProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  accent: string;
}

function HubCard({ to, icon: Icon, title, description, accent }: HubCardProps) {
  return (
    <Link
      to={to}
      className="block group rounded-lg border bg-card hover:bg-accent/50 transition-colors"
    >
      <div className="p-4 flex items-start gap-3">
        <div className={`shrink-0 rounded-md p-2 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{title}</h3>
            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{description}</p>
        </div>
      </div>
    </Link>
  );
}

export function BusinessAccountingPage() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Accounting" },
    ]);
  }, [setBreadcrumbs]);

  const today = todayIso();
  const monthStart = monthStartIso();

  const bsQuery = useQuery({
    queryKey: ["business-accounting", "balance-sheet", selectedCompanyId, today],
    queryFn: () => businessAccountingApi.balanceSheet(selectedCompanyId!, today),
    enabled: !!selectedCompanyId,
  });

  const isQuery = useQuery({
    queryKey: [
      "business-accounting",
      "income-statement",
      selectedCompanyId,
      monthStart,
      today,
    ],
    queryFn: () =>
      businessAccountingApi.incomeStatement(selectedCompanyId!, monthStart, today),
    enabled: !!selectedCompanyId,
  });

  const accountsQuery = useQuery({
    queryKey: ["business-accounting", "accounts", selectedCompanyId],
    queryFn: () => businessAccountingApi.listAccounts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Calculator}
        message="Select a workspace first to access Accounting."
      />
    );
  }

  const totalAssets = bsQuery.data?.assets.totalAssetsCents ?? 0;
  const totalLiabilities = bsQuery.data?.liabilities.totalLiabilitiesCents ?? 0;
  const totalEquity = bsQuery.data?.equity.totalEquityCents ?? 0;
  const netIncomeMtd = isQuery.data?.netIncomeCents ?? 0;
  const accountCount = accountsQuery.data?.accounts.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Accounting</h1>
          <p className="text-sm text-muted-foreground">
            {selectedCompany?.name ? `${selectedCompany.name} · ` : ""}
            General ledger, journals & financial statements
          </p>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Total Assets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-mono font-semibold text-blue-600 dark:text-blue-400">
              {formatCurrency(totalAssets)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Total Liabilities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-mono font-semibold text-amber-600 dark:text-amber-400">
              {formatCurrency(totalLiabilities)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Total Equity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-mono font-semibold text-purple-600 dark:text-purple-400">
              {formatCurrency(totalEquity)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Net Income (MTD)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl font-mono font-semibold ${
                netIncomeMtd >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {formatCurrency(netIncomeMtd)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hub cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <HubCard
          to="/business/accounting/coa"
          icon={BookOpen}
          title="Chart of Accounts"
          description={`${accountCount} accounts. Manage your account structure.`}
          accent="bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
        />
        <HubCard
          to="/business/accounting/journal"
          icon={FileText}
          title="Journal"
          description="All journal entries. Double-entry bookkeeping."
          accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        />
        <HubCard
          to="/business/accounting/ledger"
          icon={Layers}
          title="General Ledger"
          description="Per-account running balance and transactions."
          accent="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        />
        <HubCard
          to="/business/accounting/statements"
          icon={TrendingUp}
          title="Financial Statements"
          description="P&L, Balance Sheet, Cash Flow, Trial Balance."
          accent="bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
        />
        <ClosePeriodCard companyId={selectedCompanyId} accent="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" />
      </div>
    </div>
  );
}

interface ClosePeriodCardProps {
  companyId: string;
  accent: string;
}

function ClosePeriodCard({ accent }: ClosePeriodCardProps) {
  return (
    <Link
      to="/business/accounting/statements"
      className="block group rounded-lg border bg-card hover:bg-accent/50 transition-colors"
    >
      <div className="p-4 flex items-start gap-3">
        <div className={`shrink-0 rounded-md p-2 ${accent}`}>
          <Lock className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Close Period</h3>
            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            Roll revenue & expenses into retained earnings to close a fiscal period.
          </p>
        </div>
      </div>
    </Link>
  );
}
