import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { businessRetailApi, formatFils } from "../../api/business-retail";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RetailEndOfDayPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  const [date, setDate] = useState(todayIso());
  const [locationId, setLocationId] = useState("");
  const [actualCash, setActualCash] = useState("");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Retail", href: "/business/retail" },
      { label: "End of day" },
    ]);
  }, [setBreadcrumbs]);

  const locationsQuery = useQuery({
    queryKey: ["retail", companyId, "locations"],
    queryFn: () => businessRetailApi.listLocations(companyId),
    enabled: !!companyId,
  });

  useEffect(() => {
    if (!locationId) {
      const list = locationsQuery.data?.locations ?? [];
      const main = list.find((l) => l.isMain) ?? list[0];
      if (main) setLocationId(main.id);
    }
  }, [locationsQuery.data, locationId]);

  const reportQuery = useQuery({
    queryKey: ["retail", companyId, "eod", locationId, date],
    queryFn: () => businessRetailApi.getEndOfDay(companyId, locationId, date),
    enabled: !!companyId && !!locationId && !!date,
  });

  const close = useMutation({
    mutationFn: () =>
      businessRetailApi.closeEndOfDay(companyId, {
        locationId,
        date,
        actualCashCents: Math.round(Number(actualCash) * 1000),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["retail", companyId, "eod", locationId, date],
      });
      setActualCash("");
    },
  });

  if (!selectedCompany) return <PageSkeleton variant="detail" />;
  const report = reportQuery.data?.report;
  const variance =
    report && actualCash
      ? Math.round(Number(actualCash) * 1000) - report.expectedCashCents
      : undefined;

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">End of day</h1>
        <p className="text-sm text-muted-foreground">
          Z-report style cash reconciliation per location.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs uppercase text-muted-foreground">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs uppercase text-muted-foreground">
            Location
          </label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {(locationsQuery.data?.locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {reportQuery.isLoading || !report ? (
        <PageSkeleton variant="dashboard" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">
                  Total sales
                </div>
                <div className="mt-1 text-2xl font-bold">
                  {formatFils(report.totalSalesCents)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {report.salesCount} transactions
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Cash</div>
                <div className="mt-1 text-2xl font-bold">
                  {formatFils(report.cashSalesCents)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Card</div>
                <div className="mt-1 text-2xl font-bold">
                  {formatFils(report.cardSalesCents)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">KNET</div>
                <div className="mt-1 text-2xl font-bold">
                  {formatFils(report.knetSalesCents)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">
                  Refunds
                </div>
                <div className="mt-1 text-2xl font-bold">
                  −{formatFils(report.refundsCents)}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-4 w-4" />
                Cash reconciliation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 lg:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Expected cash in drawer
                  </div>
                  <div className="mt-1 text-2xl font-bold">
                    {formatFils(report.expectedCashCents)}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">
                    Actual cash counted (KWD)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    value={actualCash}
                    onChange={(e) => setActualCash(e.target.value)}
                    className="mt-1 h-12 w-full rounded-md border border-input bg-transparent px-3 text-xl outline-none"
                  />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Variance</div>
                  <div
                    className={`mt-1 text-2xl font-bold ${
                      variance === undefined
                        ? ""
                        : variance < 0
                          ? "text-destructive"
                          : variance > 0
                            ? "text-amber-500"
                            : "text-emerald-500"
                    }`}
                  >
                    {variance === undefined ? "—" : formatFils(variance)}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={() => close.mutate()}
                  disabled={!actualCash || close.isPending}
                >
                  <Lock className="mr-1 h-4 w-4" />
                  Close day
                </Button>
              </div>
              {close.isSuccess && (
                <div className="mt-3 flex items-center gap-1 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Day closed and report archived.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top products today</CardTitle>
            </CardHeader>
            <CardContent>
              {report.topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sales for this day yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {report.topProducts.map((p, i) => (
                    <li key={i} className="flex justify-between text-sm">
                      <span>{p.name}</span>
                      <span className="font-mono">{p.quantity} units</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
