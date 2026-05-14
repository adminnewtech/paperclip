import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  Lightbulb,
  Loader2,
  Minus,
  Play,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  businessHealthApi,
  type BusinessHealthScore,
  type HealthStatus,
  type SubScore,
  type SubScoreCategory,
} from "../api/business-health";
import { HealthScoreGauge } from "../components/business/HealthScoreGauge";

const categoryLabel: Record<SubScoreCategory, string> = {
  financial: "Financial",
  operational: "Operational",
  customer: "Customer",
  growth: "Growth",
  team: "Team",
};

const statusColor: Record<HealthStatus, string> = {
  excellent: "bg-green-100 text-green-900 border-green-300",
  good: "bg-emerald-100 text-emerald-900 border-emerald-300",
  fair: "bg-yellow-100 text-yellow-900 border-yellow-300",
  concerning: "bg-orange-100 text-orange-900 border-orange-300",
  critical: "bg-red-100 text-red-900 border-red-300",
};

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

function TrendIcon({ trend }: { trend: BusinessHealthScore["trend"] }) {
  if (trend === "rising")
    return <ArrowUpRight className="h-4 w-4 text-green-600" />;
  if (trend === "falling")
    return <ArrowDownRight className="h-4 w-4 text-red-600" />;
  return <Minus className="h-4 w-4 text-gray-500" />;
}

function HistoryChart({
  history,
  width = 280,
  height = 100,
}: {
  history: BusinessHealthScore[];
  width?: number;
  height?: number;
}) {
  if (history.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-gray-500">
        Need more history to plot a trend.
      </div>
    );
  }
  const series = [...history].reverse().map((h) => h.overall);
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const pad = 4;
  const stepX = (width - pad * 2) / (series.length - 1);
  const path = series
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (height - pad * 2) * (1 - (v - min) / range);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="none"
    >
      <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} />
    </svg>
  );
}

function SubScoreCard({ sub }: { sub: SubScore }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{sub.name}</CardTitle>
          <Badge variant="outline" className={statusColor[sub.status]}>
            {sub.score}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xs text-gray-600">{sub.description}</div>
        {sub.value !== undefined && (
          <div className="mt-1 text-xs text-gray-500">
            {sub.value} {sub.unit ?? ""}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BusinessHealthPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Health Score" },
    ]);
  }, [setBreadcrumbs]);

  const companyId = selectedCompanyId;

  const latestQuery = useQuery({
    queryKey: ["business-health-latest", companyId],
    queryFn: () =>
      companyId ? businessHealthApi.latest(companyId) : Promise.resolve(null),
    enabled: !!companyId,
    retry: false,
  });

  const historyQuery = useQuery({
    queryKey: ["business-health-history", companyId],
    queryFn: () =>
      companyId
        ? businessHealthApi.history(companyId, { limit: 30 })
        : Promise.resolve({ history: [] }),
    enabled: !!companyId,
  });

  const computeMutation = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("No company selected");
      return businessHealthApi.compute(companyId, true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-health-latest"] });
      queryClient.invalidateQueries({ queryKey: ["business-health-history"] });
    },
  });

  const score = latestQuery.data ?? computeMutation.data;
  const subscoresByCategory = useMemo(() => {
    if (!score) return {} as Record<SubScoreCategory, SubScore[]>;
    const out: Record<string, SubScore[]> = {};
    for (const s of score.subscores) {
      (out[s.category] ??= []).push(s);
    }
    return out as Record<SubScoreCategory, SubScore[]>;
  }, [score]);

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-gray-600">
            Select a company to view the Business Health Score.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Business Health Score</h1>
          <p className="text-sm text-gray-600">
            A single number (0-100) summarizing overall business health. Like a
            credit score for your business.
          </p>
        </div>
        <Button
          onClick={() => computeMutation.mutate()}
          disabled={computeMutation.isPending}
        >
          {computeMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Compute Now
        </Button>
      </div>

      {!score && !latestQuery.isLoading && (
        <Card>
          <CardContent className="p-6 text-sm text-gray-600">
            No health score has been computed yet. Click{" "}
            <strong>Compute Now</strong> to generate the first score.
          </CardContent>
        </Card>
      )}

      {score && (
        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          {/* Left: gauge + trend */}
          <div className="space-y-4">
            <Card>
              <CardContent className="flex flex-col items-center p-6">
                <HealthScoreGauge
                  score={score.overall}
                  status={score.status}
                  grade={score.grade}
                />
                <div className="mt-3 flex items-center gap-2 text-sm">
                  <TrendIcon trend={score.trend} />
                  <span className="text-gray-700">
                    {score.trend === "stable"
                      ? "Stable"
                      : `${score.trendChangePoints >= 0 ? "+" : ""}${score.trendChangePoints} pts`}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Last computed: {formatDateTime(score.computedAt)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingUp className="h-4 w-4" />
                  History (last 30 scores)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <HistoryChart history={historyQuery.data?.history ?? []} />
              </CardContent>
            </Card>
          </div>

          {/* Right: subscores + issues + wins */}
          <div className="space-y-4">
            {(Object.keys(subscoresByCategory) as SubScoreCategory[]).map(
              (cat) => (
                <div key={cat}>
                  <h2 className="mb-2 text-sm font-medium text-gray-700">
                    {categoryLabel[cat] ?? cat}
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {subscoresByCategory[cat]!.map((sub) => (
                      <SubScoreCard key={sub.key} sub={sub} />
                    ))}
                  </div>
                </div>
              ),
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ShieldAlert className="h-4 w-4 text-red-600" />
                    Top Issues
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {score.topIssues.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      No major issues detected.
                    </div>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {score.topIssues.map((iss, i) => (
                        <li
                          key={`${iss.category}-${i}`}
                          className="border-l-2 border-red-300 pl-2"
                        >
                          <div className="font-medium">{iss.description}</div>
                          {iss.suggestedAction && (
                            <div className="text-xs text-gray-600">
                              → {iss.suggestedAction}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Sparkles className="h-4 w-4 text-green-600" />
                    Top Wins
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {score.topWins.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      No standout wins yet. Push subscores above 85 to qualify.
                    </div>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {score.topWins.map((win, i) => (
                        <li
                          key={`${win.category}-${i}`}
                          className="border-l-2 border-green-300 pl-2"
                        >
                          <div className="font-medium">{win.description}</div>
                          <div className="text-xs text-gray-500">
                            Impact: {win.impactScore} pts
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                {score.recommendations.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    No actionable recommendations at this time.
                  </div>
                ) : (
                  <ol className="list-decimal space-y-1 pl-5 text-sm">
                    {score.recommendations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
