import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Clock,
  Scissors,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import { salonsApi } from "../../api/business-salons";

function formatPrice(cents: number): string {
  return `${(cents / 1000).toFixed(3)} KWD`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SalonDashboardPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Salon" },
    ]);
  }, [setBreadcrumbs]);

  const servicesQuery = useQuery({
    queryKey: ["salons", companyId, "services"],
    queryFn: () => salonsApi.listServices(companyId),
    enabled: !!companyId,
  });

  const dashboardQuery = useQuery({
    queryKey: ["salons", companyId, "dashboard"],
    queryFn: () => salonsApi.dashboard(companyId),
    enabled: !!companyId,
  });

  const setupMutation = useMutation({
    mutationFn: () => salonsApi.setupDefaults(companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["salons", companyId] });
    },
  });

  if (!selectedCompany) {
    return <div className="p-6 text-sm text-muted-foreground">Select a company first.</div>;
  }
  if (servicesQuery.isLoading || dashboardQuery.isLoading) {
    return <PageSkeleton />;
  }

  const services = servicesQuery.data?.services ?? [];
  const dashboard = dashboardQuery.data;
  const needsSetup = services.length === 0;

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Salon dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Today’s schedule, no-show rate, and your top services.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/business/salon/appointments">
            <Button variant="outline" size="sm">
              <Calendar className="mr-2 h-4 w-4" />
              Appointments
            </Button>
          </Link>
          <Link to="/business/salon/services">
            <Button variant="outline" size="sm">
              <Scissors className="mr-2 h-4 w-4" />
              Services
            </Button>
          </Link>
          <Link to="/business/salon/staff">
            <Button variant="outline" size="sm">
              <Users className="mr-2 h-4 w-4" />
              Staff
            </Button>
          </Link>
        </div>
      </header>

      {needsSetup ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-6">
            <div>
              <h2 className="text-lg font-medium">Welcome to your salon</h2>
              <p className="text-sm text-muted-foreground">
                Set up 15 standard services (haircut, manicure, facials,…) and a couple of sample stylists with one click.
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Appointments today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {dashboard?.todayAppointments.length ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {dashboard?.unconfirmedCount ?? 0} unconfirmed this week
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              This month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {dashboard?.appointmentsThisMonth ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">
              Bookings booked
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              No-show rate (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {dashboard
                ? `${(dashboard.noShowRate30d * 100).toFixed(1)}%`
                : "0%"}
            </div>
            <div className="text-xs text-muted-foreground">
              Across resolved appointments
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
            <div className="text-2xl font-semibold">
              {formatPrice(dashboard?.revenueThisMonth ?? 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              Completed appointments
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Today’s schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard && dashboard.todayAppointments.length > 0 ? (
            <ul className="divide-y">
              {dashboard.todayAppointments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div>
                    <div className="font-medium">{a.clientName}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.serviceName} · {a.stylistName}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm">
                      {formatTime(a.startAt)} — {formatTime(a.endAt)}
                    </div>
                    <div className="text-[10px] uppercase text-muted-foreground">
                      {a.status.replace("_", " ")}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Calendar}
              message="No appointments today. Enjoy the quiet!"
            />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Top services this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard && dashboard.topServices.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1">Service</th>
                    <th className="py-1 text-right">Bookings</th>
                    <th className="py-1 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.topServices.map((s) => (
                    <tr key={s.serviceId} className="border-t">
                      <td className="py-1">{s.serviceName}</td>
                      <td className="py-1 text-right">{s.bookings}</td>
                      <td className="py-1 text-right">{formatPrice(s.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-muted-foreground">
                No bookings yet.
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Top stylists
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard && dashboard.topStylists.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1">Stylist</th>
                    <th className="py-1 text-right">Bookings</th>
                    <th className="py-1 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.topStylists.map((s) => (
                    <tr key={s.stylistId} className="border-t">
                      <td className="py-1">{s.stylistName}</td>
                      <td className="py-1 text-right">{s.bookings}</td>
                      <td className="py-1 text-right">{formatPrice(s.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-muted-foreground">
                No bookings yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
