import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Landmark,
  Download,
  Users,
  Building,
  TrendingUp,
} from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { gosiApi } from "../api/business-compliance";

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatSar(cents: number): string {
  return `${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} SAR`;
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

export function BusinessGosiPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [period, setPeriod] = useState<string>(currentPeriod());

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Compliance", href: "/business/compliance" },
      { label: "GOSI" },
    ]);
  }, [setBreadcrumbs]);

  const reportQuery = useQuery({
    queryKey: ["gosi-report", selectedCompanyId, period],
    queryFn: () => gosiApi.monthlyReport(selectedCompanyId!, period),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Landmark} message="Select a workspace first." />;
  }

  const report = reportQuery.data;
  const exportUrl = gosiApi.exportUrl(selectedCompanyId, period);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business/compliance">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold">GOSI</h1>
          <p className="text-sm text-muted-foreground">
            Saudi social insurance contributions
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button asChild size="sm">
            <a href={exportUrl} download>
              <Download className="h-4 w-4 mr-1.5" />
              Generate GOSI file
            </a>
          </Button>
        </div>
      </div>

      {reportQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : !report ? (
        <EmptyState icon={Landmark} message="Could not load GOSI report." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Employees
                </div>
                <p className="text-xl font-bold tabular-nums mt-1">
                  {report.employees.length}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {report.saudiCount} Saudi · {report.nonSaudiCount} Non-Saudi
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Building className="h-3.5 w-3.5" />
                  Employer share
                </div>
                <p className="text-xl font-bold tabular-nums mt-1 text-blue-600 dark:text-blue-400">
                  {formatSar(report.totalEmployerCents)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Employee share
                </div>
                <p className="text-xl font-bold tabular-nums mt-1">
                  {formatSar(report.totalEmployeeCents)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Grand total
                </div>
                <p className="text-xl font-bold tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
                  {formatSar(report.grandTotalCents)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">Employee</th>
                    <th className="text-left p-2">National ID</th>
                    <th className="text-left p-2">Nationality</th>
                    <th className="text-right p-2">Wage</th>
                    <th className="text-right p-2">Employee %</th>
                    <th className="text-right p-2">Employer %</th>
                    <th className="text-right p-2">Employee</th>
                    <th className="text-right p-2">Employer</th>
                  </tr>
                </thead>
                <tbody>
                  {report.employees.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="p-6 text-center text-sm text-muted-foreground"
                      >
                        No active employees found. Add employees in the HR module.
                      </td>
                    </tr>
                  ) : (
                    report.employees.map((e) => (
                      <tr key={e.employeeId} className="border-t">
                        <td className="p-2">{e.employeeName ?? e.employeeId}</td>
                        <td className="p-2 font-mono text-[11px]">
                          {e.nationalId ?? "—"}
                        </td>
                        <td className="p-2">
                          <Badge
                            variant="secondary"
                            className={
                              e.employeeNationality === "saudi"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                                : ""
                            }
                          >
                            {e.employeeNationality === "saudi" ? "Saudi" : "Non-Saudi"}
                          </Badge>
                        </td>
                        <td className="p-2 text-right font-mono tabular-nums">
                          {formatSar(e.contributoryWageCents)}
                        </td>
                        <td className="p-2 text-right font-mono tabular-nums text-muted-foreground">
                          {e.employeeContributionPercent.toFixed(0)}%
                        </td>
                        <td className="p-2 text-right font-mono tabular-nums text-muted-foreground">
                          {e.employerContributionPercent.toFixed(0)}%
                        </td>
                        <td className="p-2 text-right font-mono tabular-nums">
                          {formatSar(e.employeeContributionCents)}
                        </td>
                        <td className="p-2 text-right font-mono tabular-nums text-blue-600 dark:text-blue-400">
                          {formatSar(e.employerContributionCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
              <p>
                <strong>Saudi employees:</strong> 9% employee + 13% employer (9%
                old-age + 2% SANED + 2% occupational hazards).
              </p>
              <p>
                <strong>Non-Saudi employees:</strong> 2% employer (occupational
                hazards only).
              </p>
              <p>
                <strong>Contributory wage:</strong> basic + housing, clamped to
                [1,500, 45,000] SAR/month.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
