import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  Sparkles,
  Stethoscope,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import {
  clinicQueryKeys,
  clinicsApi,
  formatKwd,
} from "../../api/business-clinics";

export function ClinicDashboardPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Clinic" },
    ]);
  }, [setBreadcrumbs]);

  const dashboardQuery = useQuery({
    queryKey: clinicQueryKeys.dashboard(companyId),
    queryFn: () => clinicsApi.dashboard(companyId),
    enabled: !!companyId,
  });

  const doctorsQuery = useQuery({
    queryKey: clinicQueryKeys.doctors(companyId),
    queryFn: () => clinicsApi.listDoctors(companyId),
    enabled: !!companyId,
  });

  const setupMutation = useMutation({
    mutationFn: () => clinicsApi.setup(companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clinics"] });
    },
  });

  if (!selectedCompany) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a company first.
      </div>
    );
  }
  if (dashboardQuery.isLoading || doctorsQuery.isLoading) {
    return <PageSkeleton />;
  }

  const dashboard = dashboardQuery.data;
  const doctors = doctorsQuery.data?.doctors ?? [];
  const needsSetup = doctors.length === 0;

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Stethoscope className="h-6 w-6 text-emerald-500" />
            Clinic dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Patients, appointments, prescriptions and lab results.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/business/clinic/patients">
            <Button variant="outline" size="sm">
              <Users className="mr-2 h-4 w-4" />
              Patients
            </Button>
          </Link>
          <Link to="/business/clinic/appointments">
            <Button variant="outline" size="sm">
              <Calendar className="mr-2 h-4 w-4" />
              Appointments
            </Button>
          </Link>
        </div>
      </header>

      {needsSetup ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-6">
            <div>
              <h2 className="text-lg font-medium">Welcome to your clinic</h2>
              <p className="text-sm text-muted-foreground">
                Set up sample doctors, specialties, ICD-10 codes and common lab
                tests with one click.
              </p>
            </div>
            <Button
              onClick={() => setupMutation.mutate()}
              disabled={setupMutation.isPending}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {setupMutation.isPending ? "Setting up…" : "Setup defaults"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Patients total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {dashboard?.patientsTotal ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">In your records</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Appointments today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {dashboard?.appointmentsToday ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {dashboard?.appointmentsThisWeek ?? 0} this week
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Visits this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {dashboard?.visitsThisMonth ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">
              SOAP notes created
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Revenue this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatKwd(dashboard?.revenueThisMonth ?? 0)}
            </div>
            <div className="text-xs text-muted-foreground">Signed visits</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Unsigned visits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-semibold tabular-nums ${(dashboard?.unsignedVisits ?? 0) > 0 ? "text-amber-600" : ""}`}
            >
              {dashboard?.unsignedVisits ?? 0}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              {(dashboard?.unsignedVisits ?? 0) > 0 ? (
                <>
                  <AlertCircle className="h-3 w-3 text-amber-500" /> Needs review
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" /> All clear
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Top doctors this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard && dashboard.topDoctors.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1">Doctor</th>
                    <th className="py-1 text-right">Visits</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.topDoctors.map((d) => (
                    <tr key={d.doctorId} className="border-t">
                      <td className="py-1">{d.name}</td>
                      <td className="py-1 text-right tabular-nums">{d.visits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                icon={Activity}
                message="No signed visits this month."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4" /> Recent patients
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard && dashboard.recentPatients.length > 0 ? (
              <ul className="divide-y">
                {dashboard.recentPatients.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <Link
                      to={`/business/clinic/patients/${p.id}`}
                      className="flex-1"
                    >
                      <div className="font-medium hover:underline">
                        {p.fullName}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {p.code}
                      </div>
                    </Link>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">
                        {p.totalVisits} visit{p.totalVisits !== 1 ? "s" : ""}
                      </div>
                      {p.lastVisitAt ? (
                        <div className="text-[10px] text-muted-foreground">
                          Last: {new Date(p.lastVisitAt).toLocaleDateString()}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={ClipboardList}
                message="No patients yet. Add your first patient to begin."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
