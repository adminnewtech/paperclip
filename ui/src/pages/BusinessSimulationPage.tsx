import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  businessSimulationApi,
  type ScenarioParameterSpec,
  type SimulationResult,
  type SimulationScenarioKey,
  type SimulationScenarioTemplate,
} from "../api/business-simulation";
import { SimulationResults } from "../components/business/SimulationResults";

function defaultParams(
  template: SimulationScenarioTemplate,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of template.parametersSchema) {
    if (p.default !== undefined) out[p.key] = p.default;
  }
  return out;
}

function ParameterField({
  spec,
  value,
  onChange,
}: {
  spec: ScenarioParameterSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (spec.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {spec.label}
      </label>
    );
  }
  if (spec.type === "string") {
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">
          {spec.label}
        </label>
        <Input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">
        {spec.label}
        {spec.unit && <span className="ml-1 text-gray-500">({spec.unit})</span>}
      </label>
      <Input
        type="number"
        value={value === undefined || value === null ? "" : String(value)}
        min={spec.min}
        max={spec.max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

const scenarioColor = "bg-blue-50 border-blue-200";
const scenarioColorSelected = "bg-blue-100 border-blue-500 ring-2 ring-blue-300";

function detectScenarioFromText(
  text: string,
  templates: SimulationScenarioTemplate[],
): SimulationScenarioKey | null {
  const t = text.toLowerCase();
  if (/price|raise|lower price|increase price/.test(t)) return "price_change";
  if (/marketing|ads|spend/.test(t)) return "marketing_spend";
  if (/hire|employee|staff|headcount/.test(t)) return "hire_employees";
  if (/launch|new product/.test(t)) return "new_product_launch";
  if (/discount|sale|promo/.test(t)) return "discount_strategy";
  if (/expand|expansion|country|region|new market/.test(t))
    return "expansion_to_region";
  if (/cut cost|reduce cost|cost reduction|savings/.test(t))
    return "cost_reduction";
  if (/supplier|vendor/.test(t)) return "supplier_change";
  if (/branch|new store|location/.test(t)) return "open_new_branch";
  if (templates.length > 0) return "custom";
  return null;
}

export function BusinessSimulationPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Simulation" },
    ]);
  }, [setBreadcrumbs]);

  const companyId = selectedCompanyId;

  const templatesQuery = useQuery({
    queryKey: ["simulation-templates", companyId],
    queryFn: () =>
      companyId
        ? businessSimulationApi.templates(companyId)
        : Promise.resolve({ templates: [] }),
    enabled: !!companyId,
  });

  const historyQuery = useQuery({
    queryKey: ["simulation-history", companyId],
    queryFn: () =>
      companyId
        ? businessSimulationApi.list(companyId, { limit: 20 })
        : Promise.resolve({ results: [] }),
    enabled: !!companyId,
  });

  const templates = templatesQuery.data?.templates ?? [];

  const [selectedKey, setSelectedKey] =
    useState<SimulationScenarioKey>("price_change");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [horizonMonths, setHorizonMonths] = useState(12);
  const [customQuestion, setCustomQuestion] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.key === selectedKey),
    [templates, selectedKey],
  );

  useEffect(() => {
    if (selectedTemplate) {
      setParams(defaultParams(selectedTemplate));
    }
  }, [selectedTemplate]);

  const runMutation = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("No company selected");
      return businessSimulationApi.run(companyId, {
        scenarioKey: selectedKey,
        parameters: params,
        horizonMonths,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["simulation-history"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => {
      if (!companyId) throw new Error("No company selected");
      return businessSimulationApi.remove(companyId, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["simulation-history"] });
    },
  });

  function handleCustomQuestion() {
    const detected = detectScenarioFromText(customQuestion, templates);
    if (detected) {
      setSelectedKey(detected);
    }
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-gray-600">
            Select a company to run business simulations.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Live Business Simulation</h1>
        <p className="text-sm text-gray-600">
          Run "what-if" scenarios against your real business data.
        </p>
      </div>

      {/* Custom question */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            Ask a question
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            value={customQuestion}
            placeholder='e.g. "What if I raise prices by 10%?"'
            onChange={(e) => setCustomQuestion(e.target.value)}
          />
          <Button variant="outline" onClick={handleCustomQuestion}>
            Map to Scenario
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-[360px_1fr]">
        {/* Scenario picker + params */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pick a Scenario</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSelectedKey(t.key)}
                    className={`flex flex-col items-start gap-1 rounded-md border p-2 text-left text-xs transition ${
                      t.key === selectedKey ? scenarioColorSelected : scenarioColor
                    }`}
                  >
                    <span className="text-lg leading-none">{t.emoji}</span>
                    <span className="font-medium">{t.name}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {selectedTemplate && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {selectedTemplate.emoji} {selectedTemplate.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-gray-600">
                  {selectedTemplate.description}
                </p>
                {selectedTemplate.parametersSchema.map((p) => (
                  <ParameterField
                    key={p.key}
                    spec={p}
                    value={params[p.key]}
                    onChange={(v) =>
                      setParams((cur) => ({ ...cur, [p.key]: v }))
                    }
                  />
                ))}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-700">
                    Horizon (months)
                  </label>
                  <Input
                    type="number"
                    value={horizonMonths}
                    min={1}
                    max={36}
                    onChange={(e) =>
                      setHorizonMonths(
                        Math.max(1, Math.min(36, Number(e.target.value))),
                      )
                    }
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => runMutation.mutate()}
                  disabled={runMutation.isPending}
                >
                  {runMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Run Simulation
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: results */}
        <div>
          {!result ? (
            <Card>
              <CardContent className="p-6 text-sm text-gray-600">
                Pick a scenario and click <strong>Run Simulation</strong> to
                project the impact on revenue, profit, and cash.
              </CardContent>
            </Card>
          ) : (
            <SimulationResults result={result} />
          )}
        </div>
      </div>

      {/* History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent Simulations</CardTitle>
        </CardHeader>
        <CardContent>
          {(historyQuery.data?.results ?? []).length === 0 ? (
            <div className="text-sm text-gray-500">
              No simulations have been run yet.
            </div>
          ) : (
            <div className="space-y-1">
              {(historyQuery.data?.results ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => setResult(r)}
                    className="flex-1 text-left"
                  >
                    <span className="font-medium">{r.scenarioKey}</span>{" "}
                    <span className="text-gray-500">
                      • {new Date(r.computedAt).toLocaleString()}
                    </span>
                  </button>
                  <Badge
                    variant="outline"
                    className={
                      r.delta.totalProfit >= 0
                        ? "border-green-300 bg-green-50 text-green-800"
                        : "border-red-300 bg-red-50 text-red-800"
                    }
                  >
                    Δ Profit{" "}
                    {(r.delta.totalProfit / 100).toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(r.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
