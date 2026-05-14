import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  businessAgentMemoryApi,
  type AgentSkillStats,
} from "../../api/business-agent-memory";

interface Props {
  companyId: string;
  agentSlug: string;
  /** Number of days for the trend line chart. Default 30. */
  days?: number;
}

function accuracyColor(acc: number): string {
  if (acc >= 0.75) return "text-emerald-700";
  if (acc >= 0.5) return "text-amber-700";
  return "text-red-700";
}

function accuracyBg(acc: number): string {
  if (acc >= 0.75) return "bg-emerald-500";
  if (acc >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}

function TrendArrow({
  trend,
}: {
  trend: "rising" | "stable" | "falling";
}) {
  if (trend === "rising")
    return <ArrowUp className="h-4 w-4 text-emerald-600" aria-label="rising" />;
  if (trend === "falling")
    return <ArrowDown className="h-4 w-4 text-red-600" aria-label="falling" />;
  return <ArrowRight className="h-4 w-4 text-muted-foreground" aria-label="stable" />;
}

function MiniLineChart({
  points,
}: {
  points: Array<{ date: string; accuracy: number; actionCount: number }>;
}) {
  // CSS-only sparkline-style chart inside an SVG (no chart lib).
  const width = 480;
  const height = 100;
  const padX = 8;
  const padY = 8;
  if (points.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
        No data yet.
      </div>
    );
  }
  const stepX = (width - padX * 2) / Math.max(1, points.length - 1);
  const toY = (acc: number) => height - padY - acc * (height - padY * 2);
  const path = points
    .map((p, i) => {
      const x = padX + i * stepX;
      const y = toY(p.accuracy);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      preserveAspectRatio="none"
    >
      {/* baseline at 50% */}
      <line
        x1={padX}
        y1={toY(0.5)}
        x2={width - padX}
        y2={toY(0.5)}
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeDasharray="3 3"
      />
      <path
        d={path}
        fill="none"
        stroke="hsl(217 91% 60%)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle
          key={`${p.date}-${i}`}
          cx={padX + i * stepX}
          cy={toY(p.accuracy)}
          r={2}
          fill="hsl(217 91% 60%)"
          opacity={p.actionCount === 0 ? 0.2 : 1}
        />
      ))}
    </svg>
  );
}

function SkillBar({ stat }: { stat: AgentSkillStats }) {
  const pct = Math.round(stat.accuracy * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {stat.capability}
          </span>
          <TrendArrow trend={stat.trend} />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={accuracyColor(stat.accuracy)}>{pct}%</span>
          <span className="text-muted-foreground">
            {stat.actionsCount} actions
          </span>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${accuracyBg(stat.accuracy)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function AgentLearningStats({ companyId, agentSlug, days = 30 }: Props) {
  const statsQuery = useQuery({
    queryKey: ["business", "agent-memory", "stats", companyId, agentSlug],
    queryFn: () => businessAgentMemoryApi.getStats(companyId, agentSlug),
    enabled: !!companyId && !!agentSlug,
  });
  const tsQuery = useQuery({
    queryKey: ["business", "agent-memory", "timeseries", companyId, agentSlug, days],
    queryFn: () => businessAgentMemoryApi.getTimeseries(companyId, agentSlug, days),
    enabled: !!companyId && !!agentSlug,
  });

  const overall = statsQuery.data?.overallAccuracy ?? 0.5;
  const overallPct = Math.round(overall * 100);
  const mom = statsQuery.data?.monthOverMonth;
  const deltaPct = mom ? Math.round(mom.delta * 100) : 0;
  const trend: "rising" | "stable" | "falling" = useMemo(() => {
    if (!mom || mom.delta === 0) return "stable";
    if (mom.delta > 0.05) return "rising";
    if (mom.delta < -0.05) return "falling";
    return "stable";
  }, [mom]);

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        {/* Header row */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              Accuracy (last 30 days)
            </p>
            <div className="mt-1 flex items-baseline gap-3">
              <p className={`text-4xl font-semibold ${accuracyColor(overall)}`}>
                {overallPct}%
              </p>
              <div className="flex items-center gap-1 text-sm">
                <TrendArrow trend={trend} />
                <span className="text-muted-foreground">
                  {deltaPct > 0 ? "+" : ""}
                  {deltaPct}pt vs last month
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {statsQuery.data?.totalActions ?? 0} total actions recorded
            </p>
          </div>
          {statsQuery.isLoading && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Time series */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Daily accuracy ({days}d)
          </p>
          <MiniLineChart points={tsQuery.data?.series ?? []} />
        </div>

        {/* Per-skill bars */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Per-skill performance
          </p>
          {statsQuery.data && statsQuery.data.bySkill.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No skill data yet — run the agent and provide feedback to start
              building memory.
            </p>
          )}
          <div className="space-y-3">
            {statsQuery.data?.bySkill.map((stat) => (
              <SkillBar key={stat.capability} stat={stat} />
            ))}
          </div>
        </div>

        {/* Month over month detail */}
        {mom?.currentMonth && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
            <Badge variant="outline">
              This month: {Math.round(mom.currentMonth.accuracy * 100)}% (
              {mom.currentMonth.actionCount})
            </Badge>
            {mom.previousMonth && (
              <Badge variant="outline">
                Last month: {Math.round(mom.previousMonth.accuracy * 100)}% (
                {mom.previousMonth.actionCount})
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
