import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  TrendingUp,
  Banknote,
  PackageX,
  FileWarning,
  LifeBuoy,
  Wallet,
  AlertTriangle,
  Clock,
  UserMinus,
  type LucideIcon,
} from "lucide-react";
import { currencyFractionDigits, minorToMajor } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  commandCenterApi,
  type BriefingMetrics,
  type InsightRow,
  type InsightKind,
  type InsightSeverity,
} from "../api/commandCenter";

const DEFAULT_CURRENCY = "KWD";

function formatMinor(amountMinor: number, currency = DEFAULT_CURRENCY): string {
  const digits = currencyFractionDigits(currency);
  return `${minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

const KIND_ICONS: Record<InsightKind, LucideIcon> = {
  reorder: PackageX,
  cashflow: Wallet,
  deal_forecast: TrendingUp,
  churn_risk: UserMinus,
  sla_breach: Clock,
  overdue_invoice: FileWarning,
};

function severityVariant(
  severity: InsightSeverity,
): "destructive" | "secondary" | "outline" {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "secondary";
  return "outline";
}

export function CommandCenter() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Command Center" }]);
  }, [setBreadcrumbs]);

  const companyId = selectedCompanyId ?? "";

  const briefingQuery = useQuery({
    queryKey: ["command-center", "briefing", companyId],
    queryFn: () => commandCenterApi.latestBriefing(companyId),
    enabled: !!companyId,
  });

  const insightsQuery = useQuery({
    queryKey: ["command-center", "insights", companyId],
    queryFn: () => commandCenterApi.listInsights(companyId),
    enabled: !!companyId,
  });

  const metricsQuery = useQuery({
    queryKey: ["command-center", "metrics", companyId],
    queryFn: () => commandCenterApi.metrics(companyId),
    enabled: !!companyId,
  });

  const generateMutation = useMutation({
    mutationFn: () => commandCenterApi.generateBriefing(companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["command-center", "briefing", companyId],
      });
      queryClient.invalidateQueries({
        queryKey: ["command-center", "insights", companyId],
      });
      queryClient.invalidateQueries({
        queryKey: ["command-center", "metrics", companyId],
      });
      pushToast({ title: "Briefing generated", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to generate briefing",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Sparkles}
        message="Select a workspace to open the Command Center."
      />
    );
  }

  // Prefer live metrics; fall back to the persisted briefing snapshot.
  const metrics: BriefingMetrics | undefined =
    metricsQuery.data?.metrics ?? briefingQuery.data?.briefing?.metrics;
  const briefing = briefingQuery.data?.briefing ?? null;
  const summary =
    briefing?.summary ?? metricsQuery.data?.summary ?? null;
  const insights = insightsQuery.data?.insights ?? [];

  const loading =
    briefingQuery.isLoading ||
    insightsQuery.isLoading ||
    metricsQuery.isLoading;

  return (
    <div className="space-y-6" dir="auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Command Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Cross-module daily briefing and predictive insights across CRM,
            Inventory, Finance, Sales, and Helpdesk.
          </p>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
        >
          <Sparkles className="me-1.5 h-4 w-4" />
          {generateMutation.isPending ? "Generating…" : "Generate briefing"}
        </Button>
      </div>

      {loading ? (
        <PageSkeleton variant="list" />
      ) : (
        <>
          {/* KPI stat cards */}
          {metrics && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard
                icon={Banknote}
                label="Revenue"
                value={formatMinor(metrics.revenueMinor)}
              />
              <StatCard
                icon={TrendingUp}
                label="Open deals"
                value={String(metrics.openDeals)}
                sub={`${formatMinor(metrics.weightedPipelineMinor)} weighted`}
              />
              <StatCard
                icon={Wallet}
                label="Cash net"
                value={formatMinor(metrics.cashNetMinor)}
              />
              <StatCard
                icon={PackageX}
                label="Low stock"
                value={String(metrics.lowStockCount)}
              />
              <StatCard
                icon={FileWarning}
                label="Overdue invoices"
                value={String(metrics.overdueCount)}
              />
              <StatCard
                icon={LifeBuoy}
                label="Open tickets"
                value={String(metrics.openTickets)}
              />
            </div>
          )}

          {/* Daily briefing */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <h2 className="font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Daily Briefing
              </h2>
              {summary ? (
                <p className="text-sm leading-relaxed">{summary}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No briefing yet. Click “Generate briefing” to compute the
                  latest snapshot.
                </p>
              )}
              {briefing?.generatedAt && (
                <p className="text-xs text-muted-foreground">
                  Generated{" "}
                  {new Date(briefing.generatedAt).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Insights & alerts */}
          <div className="space-y-2">
            <h2 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Insights &amp; Alerts
            </h2>
            {insightsQuery.isError ? (
              <EmptyState
                icon={AlertTriangle}
                message={
                  (insightsQuery.error as Error)?.message ??
                  "Failed to load insights."
                }
              />
            ) : insights.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                message="No insights yet. Generate a briefing to surface alerts."
              />
            ) : (
              <div className="space-y-2">
                {insights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="text-lg font-semibold font-mono mt-1">{value}</div>
        {sub && (
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {sub}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InsightCard({ insight }: { insight: InsightRow }) {
  const Icon = KIND_ICONS[insight.kind] ?? Sparkles;
  const data = insight.data ?? {};

  let extra: string | null = null;
  if (insight.kind === "reorder" && typeof data.suggestedQty === "number") {
    extra = `Suggested order: ${data.suggestedQty}`;
  } else if (
    insight.kind === "churn_risk" &&
    typeof data.customerName === "string"
  ) {
    extra = `Customer: ${data.customerName}`;
  } else if (
    insight.kind === "overdue_invoice" &&
    typeof data.outstandingMinor === "number"
  ) {
    const currency =
      typeof data.currency === "string" ? data.currency : DEFAULT_CURRENCY;
    extra = `Outstanding: ${formatMinor(data.outstandingMinor, currency)}`;
  }

  return (
    <Card>
      <CardContent className="p-3 flex items-start gap-3">
        <div className="mt-0.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{insight.title}</span>
            <Badge variant={severityVariant(insight.severity)}>
              {insight.severity}
            </Badge>
          </div>
          {insight.detail && (
            <p className="text-sm text-muted-foreground">{insight.detail}</p>
          )}
          {extra && (
            <p className="text-xs font-medium text-foreground">{extra}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
