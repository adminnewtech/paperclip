import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  TrendingUp,
} from "lucide-react";
import type {
  MonthlyProjection,
  SimulationInsight,
  SimulationResult,
} from "../../api/business-simulation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  result: SimulationResult;
}

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function signed(n: number): string {
  const v = Math.round(n / 100).toLocaleString();
  return n >= 0 ? `+${v}` : v;
}

function MiniLineChart({
  baseline,
  scenario,
  field,
  color,
  height = 120,
}: {
  baseline: MonthlyProjection[];
  scenario: MonthlyProjection[];
  field: "revenue" | "expenses" | "profit" | "cashBalance";
  color: string;
  height?: number;
}) {
  const all = [...baseline, ...scenario].map((p) => p[field]);
  if (all.length === 0) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const width = 280;
  const pad = 4;

  function path(arr: MonthlyProjection[]): string {
    if (arr.length === 0) return "";
    const stepX = arr.length > 1 ? (width - pad * 2) / (arr.length - 1) : 0;
    return arr
      .map((p, i) => {
        const x = pad + i * stepX;
        const y =
          pad + (height - pad * 2) * (1 - (p[field] - min) / range);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="none"
    >
      <path d={path(baseline)} fill="none" stroke="#9ca3af" strokeWidth={2} />
      <path d={path(scenario)} fill="none" stroke={color} strokeWidth={2.5} />
    </svg>
  );
}

function insightIcon(type: SimulationInsight["type"]) {
  if (type === "positive")
    return <ArrowUpRight className="h-4 w-4 text-green-600" />;
  if (type === "negative")
    return <ArrowDownRight className="h-4 w-4 text-red-600" />;
  return <Minus className="h-4 w-4 text-gray-600" />;
}

const confidenceColor: Record<SimulationResult["confidence"], string> = {
  high: "bg-green-100 text-green-900 border-green-300",
  medium: "bg-yellow-100 text-yellow-900 border-yellow-300",
  low: "bg-red-100 text-red-900 border-red-300",
};

export function SimulationResults({ result }: Props) {
  const { baseline, scenario, delta, insights, confidence } = result;
  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-500">
              Revenue Δ
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl font-semibold ${delta.totalRevenue >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {signed(delta.totalRevenue)}
            </div>
            <div className="text-xs text-gray-500">
              vs baseline {fmtMoney(baseline.summary.totalRevenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-500">
              Profit Δ
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl font-semibold ${delta.totalProfit >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {signed(delta.totalProfit)}
            </div>
            <div className="text-xs text-gray-500">
              vs baseline {fmtMoney(baseline.summary.totalProfit)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-500">
              Ending Cash
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl font-semibold ${scenario.summary.endingCashBalance >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {fmtMoney(scenario.summary.endingCashBalance)}
            </div>
            <div className="text-xs text-gray-500">
              Δ {signed(delta.endingCashBalance)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-500">
              Confidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className={confidenceColor[confidence]}>
              {confidence.toUpperCase()}
            </Badge>
            <div className="mt-1 text-xs text-gray-500">
              Avg growth {scenario.summary.averageMonthlyGrowth}% / mo
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Side-by-side line charts */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniLineChart
              baseline={baseline.projections}
              scenario={scenario.projections}
              field="revenue"
              color="#16a34a"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniLineChart
              baseline={baseline.projections}
              scenario={scenario.projections}
              field="profit"
              color="#2563eb"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cash Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniLineChart
              baseline={baseline.projections}
              scenario={scenario.projections}
              field="cashBalance"
              color="#9333ea"
            />
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4" />
            Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {insights.length === 0 && (
              <div className="text-sm text-gray-500">No insights available.</div>
            )}
            {insights.map((ins, i) => (
              <div
                key={`${ins.title}-${i}`}
                className="flex items-start gap-2 border-l-2 border-gray-200 pl-3"
              >
                <div className="mt-0.5">{insightIcon(ins.type)}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{ins.title}</div>
                  <div className="text-xs text-gray-600">{ins.description}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
