import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  Lightbulb,
  Loader2,
  Minus,
  Play,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  businessAnalystApi,
  type AnomalySeverity,
  type InsightAnomaly,
  type InsightOpportunity,
  type InsightRecommendation,
  type InsightReport,
  type InsightReportSummary,
  type InsightTrend,
  type StoredInsightReport,
} from "../api/business-analyst";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const severityColor: Record<AnomalySeverity, string> = {
  critical: "bg-red-100 text-red-900 border-red-300",
  high: "bg-orange-100 text-orange-900 border-orange-300",
  medium: "bg-yellow-100 text-yellow-900 border-yellow-300",
  low: "bg-blue-100 text-blue-900 border-blue-300",
};

const severityRank: Record<AnomalySeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const priorityColor: Record<string, string> = {
  P0: "bg-red-100 text-red-900 border-red-300",
  P1: "bg-yellow-100 text-yellow-900 border-yellow-300",
  P2: "bg-blue-100 text-blue-900 border-blue-300",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessAnalystPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [weeklyScheduleOn, setWeeklyScheduleOn] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Analyst" },
    ]);
  }, [setBreadcrumbs]);

  // Latest report (used when no specific report is selected)
  const latestQuery = useQuery({
    queryKey: ["business", "analyst", "latest", selectedCompanyId],
    queryFn: () => businessAnalystApi.latest(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    retry: false,
  });

  const listQuery = useQuery({
    queryKey: ["business", "analyst", "reports", selectedCompanyId],
    queryFn: () =>
      businessAnalystApi.list(selectedCompanyId!, { limit: 50, offset: 0 }),
    enabled: !!selectedCompanyId,
  });

  const reportQuery = useQuery({
    queryKey: ["business", "analyst", "report", selectedCompanyId, selectedReportId],
    queryFn: () =>
      businessAnalystApi.get(selectedCompanyId!, selectedReportId!),
    enabled: !!selectedCompanyId && !!selectedReportId,
  });

  const runMut = useMutation({
    mutationFn: () => businessAnalystApi.run(selectedCompanyId!),
    onSuccess: (data) => {
      setSelectedReportId(data.id);
      void queryClient.invalidateQueries({
        queryKey: ["business", "analyst", "latest", selectedCompanyId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["business", "analyst", "reports", selectedCompanyId],
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => businessAnalystApi.remove(selectedCompanyId!, id),
    onSuccess: (_, id) => {
      if (selectedReportId === id) setSelectedReportId(null);
      void queryClient.invalidateQueries({
        queryKey: ["business", "analyst", "latest", selectedCompanyId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["business", "analyst", "reports", selectedCompanyId],
      });
    },
  });

  const currentStored: StoredInsightReport | undefined = selectedReportId
    ? reportQuery.data
    : (latestQuery.data ?? undefined);

  const report = currentStored?.report;
  const reports: InsightReportSummary[] = listQuery.data?.reports ?? [];

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Brain className="h-6 w-6 text-violet-600" />
            Business Analyst Agent
          </h1>
          <p className="text-sm text-muted-foreground">
            Periodic AI-driven analysis of company-wide business data, with
            executive insights, anomalies, and recommendations.
          </p>
          {report && (
            <p className="mt-2 text-xs text-muted-foreground">
              Latest report:{" "}
              <span className="font-mono">
                {formatDateTime(report.generatedAt)}
              </span>{" "}
              · Period {formatDate(report.periodFrom)} →{" "}
              {formatDate(report.periodTo)}
              {report.llmEnhanced ? (
                <Badge variant="secondary" className="ml-2">
                  <Sparkles className="mr-1 h-3 w-3" /> LLM-enhanced
                </Badge>
              ) : null}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <ToggleSwitch
              checked={weeklyScheduleOn}
              onCheckedChange={setWeeklyScheduleOn}
              aria-label="Schedule weekly run"
            />
            <span>
              {weeklyScheduleOn
                ? "Weekly run (Mondays) — informational"
                : "Schedule weekly run"}
            </span>
          </div>
          <Button
            onClick={() => runMut.mutate()}
            disabled={!selectedCompanyId || runMut.isPending}
          >
            {runMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run Analysis
          </Button>
        </div>
      </div>

      {runMut.isError && (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <AlertCircle className="h-4 w-4" />
          Failed to run analysis. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          {report ? (
            <ReportView report={report} />
          ) : latestQuery.isLoading ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Loading…
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-3 p-8 text-center">
                <Brain className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No insight reports yet. Click "Run Analysis" to generate the
                  first report.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-2">
          <h3 className="text-sm font-semibold">History</h3>
          <ScrollArea className="h-[600px] rounded-md border">
            <div className="space-y-1 p-2">
              {reports.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  No prior reports.
                </p>
              ) : (
                reports.map((r) => (
                  <ReportHistoryItem
                    key={r.id}
                    report={r}
                    isActive={
                      currentStored?.id === r.id ||
                      (!selectedReportId && reports[0]?.id === r.id)
                    }
                    onSelect={() => setSelectedReportId(r.id)}
                    onDelete={() => deleteMut.mutate(r.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReportHistoryItem(props: {
  report: InsightReportSummary;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { report, isActive, onSelect, onDelete } = props;
  return (
    <div
      className={`group flex items-start justify-between gap-2 rounded-md border p-2 text-xs hover:bg-muted/50 ${
        isActive ? "border-violet-400 bg-violet-50" : ""
      }`}
    >
      <button
        type="button"
        className="flex-1 text-left"
        onClick={onSelect}
      >
        <div className="font-medium">
          {formatDate(report.periodFrom)} → {formatDate(report.periodTo)}
        </div>
        <div className="text-muted-foreground">
          {formatDateTime(report.generatedAt)}
        </div>
        <div className="mt-1 flex gap-2">
          <span className="text-orange-700">
            {report.anomalyCount} anomalies
          </span>
          <span className="text-green-700">
            {report.opportunityCount} ops
          </span>
        </div>
      </button>
      <button
        type="button"
        className="rounded p-1 opacity-0 hover:bg-red-100 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
      >
        <Trash2 className="h-3 w-3 text-red-600" />
      </button>
    </div>
  );
}

function ReportView({ report }: { report: InsightReport }) {
  return (
    <Tabs defaultValue="summary" className="w-full">
      <TabsList>
        <TabsTrigger value="summary">Executive Summary</TabsTrigger>
        <TabsTrigger value="kpis">KPI Snapshot</TabsTrigger>
        <TabsTrigger value="anomalies">
          Anomalies ({report.anomalies.length})
        </TabsTrigger>
        <TabsTrigger value="opportunities">
          Opportunities ({report.opportunities.length})
        </TabsTrigger>
        <TabsTrigger value="recommendations">
          Recommendations ({report.recommendations.length})
        </TabsTrigger>
        <TabsTrigger value="trends">Trends</TabsTrigger>
      </TabsList>

      <TabsContent value="summary" className="pt-4">
        <ExecutiveSummary report={report} />
      </TabsContent>
      <TabsContent value="kpis" className="pt-4">
        <KpiGrid report={report} />
      </TabsContent>
      <TabsContent value="anomalies" className="pt-4">
        <AnomaliesList anomalies={report.anomalies} />
      </TabsContent>
      <TabsContent value="opportunities" className="pt-4">
        <OpportunitiesList opportunities={report.opportunities} />
      </TabsContent>
      <TabsContent value="recommendations" className="pt-4">
        <RecommendationsList recommendations={report.recommendations} />
      </TabsContent>
      <TabsContent value="trends" className="pt-4">
        <TrendsView trends={report.trends} />
      </TabsContent>
    </Tabs>
  );
}

function ExecutiveSummary({ report }: { report: InsightReport }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">English</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 whitespace-pre-line text-sm leading-relaxed">
            {report.executiveSummary}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">العربية</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            dir="rtl"
            className="space-y-3 whitespace-pre-line text-sm leading-relaxed"
          >
            {report.executiveSummaryAr}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiGrid({ report }: { report: InsightReport }) {
  const k = report.kpiSnapshot;
  const cards: Array<{ label: string; value: string; sub?: string }> = [
    {
      label: "Revenue",
      value: formatCents(k.revenueCents),
      sub: "this period",
    },
    {
      label: "Expenses",
      value: formatCents(k.expensesCents),
      sub: "this period",
    },
    {
      label: "Net Income",
      value: formatCents(k.netIncomeCents),
      sub: `${k.grossMarginPercent}% gross margin`,
    },
    {
      label: "Pipeline",
      value: formatCents(k.pipelineValueCents),
      sub: "open deals",
    },
    {
      label: "Active Customers",
      value: k.activeCustomers.toLocaleString(),
      sub: "invoiced this period",
    },
    {
      label: "Gross Margin",
      value: `${k.grossMarginPercent}%`,
      sub: "net / revenue",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {c.label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{c.value}</div>
            {c.sub && (
              <div className="text-xs text-muted-foreground">{c.sub}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AnomaliesList({ anomalies }: { anomalies: InsightAnomaly[] }) {
  const grouped = useMemo(() => {
    const byKey: Partial<Record<AnomalySeverity, InsightAnomaly[]>> = {};
    for (const a of anomalies) {
      (byKey[a.severity] ??= []).push(a);
    }
    return byKey;
  }, [anomalies]);

  if (anomalies.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No anomalies detected this period.
        </CardContent>
      </Card>
    );
  }

  const order: AnomalySeverity[] = ["critical", "high", "medium", "low"];

  return (
    <div className="space-y-4">
      {order.map((sev) => {
        const items = grouped[sev] ?? [];
        if (items.length === 0) return null;
        return (
          <div key={sev}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {sev} ({items.length})
            </h3>
            <div className="space-y-2">
              {items.map((a, idx) => (
                <AnomalyCard key={`${sev}-${idx}`} anomaly={a} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnomalyCard({ anomaly }: { anomaly: InsightAnomaly }) {
  return (
    <div className={`rounded-md border p-3 ${severityColor[anomaly.severity]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <div>
            <div className="font-semibold">{anomaly.title}</div>
            <div className="text-sm">{anomaly.description}</div>
            {anomaly.suggestedAction && (
              <div className="mt-1 text-xs italic">
                Suggested: {anomaly.suggestedAction}
              </div>
            )}
          </div>
        </div>
        <Badge variant="outline" className="capitalize">
          {anomaly.category}
        </Badge>
      </div>
    </div>
  );
}

function OpportunitiesList({
  opportunities,
}: {
  opportunities: InsightOpportunity[];
}) {
  if (opportunities.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No specific opportunities identified for this period.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {opportunities.map((o, idx) => (
        <Card key={idx}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <Lightbulb className="mt-0.5 h-4 w-4 text-yellow-600" />
              <Badge variant="outline" className="capitalize">
                {o.confidence} confidence
              </Badge>
            </div>
            <div className="mt-1 font-semibold">{o.title}</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {o.description}
            </p>
            {o.estimatedImpactCents != null && (
              <div className="mt-2 text-sm font-medium text-green-700">
                Estimated impact: {formatCents(o.estimatedImpactCents)}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RecommendationsList({
  recommendations,
}: {
  recommendations: InsightRecommendation[];
}) {
  if (recommendations.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No specific recommendations.
        </CardContent>
      </Card>
    );
  }
  return (
    <ol className="space-y-3">
      {recommendations.map((r, idx) => (
        <li
          key={idx}
          className="rounded-md border bg-card p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={priorityColor[r.priority] ?? ""}
              >
                {r.priority}
              </Badge>
              <span className="font-semibold">{r.title}</span>
            </div>
            {r.suggestedOwner && (
              <Badge variant="secondary">{r.suggestedOwner}</Badge>
            )}
          </div>
          <p className="mt-2 text-sm">{r.description}</p>
          <p className="mt-1 text-xs italic text-muted-foreground">
            Rationale: {r.rationale}
          </p>
        </li>
      ))}
    </ol>
  );
}

function TrendsView({ trends }: { trends: InsightTrend[] }) {
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const t of trends) {
      m = Math.max(m, Math.abs(t.changePercent));
    }
    return Math.max(m, 1);
  }, [trends]);

  if (trends.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No trend data available.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {trends.map((t, idx) => (
        <TrendCard key={idx} trend={t} maxAbs={maxAbs} />
      ))}
    </div>
  );
}

function TrendCard({ trend, maxAbs }: { trend: InsightTrend; maxAbs: number }) {
  const Icon =
    trend.direction === "up"
      ? ArrowUpRight
      : trend.direction === "down"
        ? ArrowDownRight
        : Minus;
  const color =
    trend.direction === "up"
      ? "text-green-700"
      : trend.direction === "down"
        ? "text-red-700"
        : "text-muted-foreground";

  const widthPct = Math.min(
    100,
    Math.round((Math.abs(trend.changePercent) / maxAbs) * 100),
  );

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            {trend.metric}
          </div>
          <div className={`flex items-center gap-1 text-sm font-semibold ${color}`}>
            <Icon className="h-4 w-4" />
            {trend.changePercent > 0 ? "+" : ""}
            {trend.changePercent}%
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded bg-muted">
          <div
            className={`h-full ${trend.direction === "down" ? "bg-red-500" : trend.direction === "up" ? "bg-green-500" : "bg-muted-foreground"}`}
            style={{ width: `${widthPct}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{trend.period}</div>
      </CardContent>
    </Card>
  );
}

// Keep the Activity import used so eslint/tsc doesn't strip it for future use
void Activity;
