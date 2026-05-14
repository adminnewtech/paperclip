import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  AlertTriangle,
  Download,
  ListChecks,
  History,
} from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  wpsApi,
  type WpsCountry,
  type WpsGenerateResponse,
} from "../api/business-compliance";

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function periodOptions(count = 12): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function formatMoney(cents: number, currency: "SAR" | "KWD"): string {
  const decimals = currency === "KWD" ? 3 : 2;
  return `${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${currency}`;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BusinessWpsPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [country, setCountry] = useState<WpsCountry>("ksa");
  const [activeTab, setActiveTab] = useState<string>("generate");
  const [lastResult, setLastResult] = useState<WpsGenerateResponse | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Compliance", href: "/business/compliance" },
      { label: "WPS" },
    ]);
  }, [setBreadcrumbs]);

  const validationQuery = useQuery({
    queryKey: ["wps-validate", selectedCompanyId, country],
    queryFn: () => wpsApi.validateEmployees(selectedCompanyId!, country),
    enabled: !!selectedCompanyId,
  });
  const historyQuery = useQuery({
    queryKey: ["wps-history", selectedCompanyId],
    queryFn: () => wpsApi.history(selectedCompanyId!, 50),
    enabled: !!selectedCompanyId,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("No company");
      return wpsApi.generate(selectedCompanyId, { period, country });
    },
    onSuccess: (data) => {
      setLastResult(data);
      historyQuery.refetch();
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Banknote} message="Select a workspace first." />;
  }

  const employees = validationQuery.data?.employees ?? [];
  const ready = employees.filter((e) => e.ready).length;
  const notReady = employees.length - ready;
  const history = historyQuery.data?.history ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business/compliance">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold">WPS Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Wages Protection System file generation · SARIE (KSA) / CBK (Kuwait)
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Country
            </p>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value as WpsCountry)}
              className="rounded border bg-background px-2 py-1.5 text-sm"
            >
              <option value="ksa">Saudi Arabia (SAR · SARIE)</option>
              <option value="kuwait">Kuwait (KWD · CBK)</option>
            </select>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Period
            </p>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded border bg-background px-2 py-1.5 text-sm"
            >
              {periodOptions().map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1" />
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || ready === 0}
          >
            <Download className="h-4 w-4 mr-1.5" />
            {generateMutation.isPending ? "Generating…" : "Generate WPS file"}
          </Button>
        </CardContent>
      </Card>

      {lastResult && (
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{lastResult.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {lastResult.entries.length} employees ·{" "}
                  {formatMoney(
                    lastResult.totalCents,
                    lastResult.country === "ksa" ? "SAR" : "KWD",
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadFile(
                    lastResult.filename,
                    lastResult.content,
                    lastResult.format === "csv" ? "text/csv" : "text/plain",
                  )
                }
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Download
              </Button>
            </div>
            <pre className="rounded border bg-muted/30 p-2 text-[10px] font-mono overflow-auto max-h-60">
              {lastResult.content}
            </pre>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="generate">
            <ListChecks className="h-4 w-4 mr-1.5" />
            Employees ({ready}/{employees.length} ready)
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-4 w-4 mr-1.5" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="mt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-3 flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Ready</p>
                  <p className="text-lg font-bold tabular-nums text-emerald-600">
                    {ready}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Missing fields</p>
                  <p
                    className={`text-lg font-bold tabular-nums ${notReady > 0 ? "text-amber-600" : ""}`}
                  >
                    {notReady}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 flex items-center gap-3">
                <Banknote className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Total active</p>
                  <p className="text-lg font-bold tabular-nums">
                    {employees.length}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {validationQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left p-2">Employee</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Missing fields</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="p-6 text-center text-sm text-muted-foreground"
                        >
                          No active employees. Add employees in HR first.
                        </td>
                      </tr>
                    ) : (
                      employees.map((e) => (
                        <tr key={e.employeeId} className="border-t">
                          <td className="p-2">{e.employeeName}</td>
                          <td className="p-2">
                            {e.ready ? (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                                Ready
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                                Not ready
                              </Badge>
                            )}
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">
                            {e.missingFields.length > 0
                              ? e.missingFields.join(", ")
                              : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {historyQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : history.length === 0 ? (
            <EmptyState
              icon={History}
              message="No WPS files generated yet for this workspace."
            />
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left p-2">Filename</th>
                      <th className="text-left p-2">Country</th>
                      <th className="text-left p-2">Period</th>
                      <th className="text-right p-2">Employees</th>
                      <th className="text-right p-2">Total</th>
                      <th className="text-left p-2">Generated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t">
                        <td className="p-2 font-mono text-xs">{h.filename}</td>
                        <td className="p-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {h.country.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="p-2">{h.period}</td>
                        <td className="p-2 text-right tabular-nums">
                          {h.entryCount}
                        </td>
                        <td className="p-2 text-right font-mono tabular-nums">
                          {formatMoney(h.totalCents, h.currency)}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {new Date(h.generatedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
