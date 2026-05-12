import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { salonsApi, type Appointment, type CreateAppointmentInput } from "../../api/business-salons";
import { AppointmentCalendar } from "../../components/business/verticals/AppointmentCalendar";
import { AppointmentDialog } from "../../components/business/verticals/AppointmentDialog";

type ViewMode = "day" | "week";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function formatDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function SalonAppointmentsPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  const [view, setView] = useState<ViewMode>("day");
  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [stylistFilter, setStylistFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [prefillStylistId, setPrefillStylistId] = useState<string | undefined>();
  const [prefillStartAt, setPrefillStartAt] = useState<Date | undefined>();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Salon", href: "/business/salon" },
      { label: "Appointments" },
    ]);
  }, [setBreadcrumbs]);

  const from = useMemo(() => startOfDay(date), [date]);
  const to = useMemo(
    () => addDays(from, view === "day" ? 1 : 7),
    [from, view],
  );

  const stylistsQuery = useQuery({
    queryKey: ["salons", companyId, "stylists"],
    queryFn: () => salonsApi.listStylists(companyId),
    enabled: !!companyId,
  });

  const servicesQuery = useQuery({
    queryKey: ["salons", companyId, "services"],
    queryFn: () => salonsApi.listServices(companyId),
    enabled: !!companyId,
  });

  const appointmentsQuery = useQuery({
    queryKey: ["salons", companyId, "appointments", from.toISOString(), to.toISOString()],
    queryFn: () =>
      salonsApi.listAppointments(companyId, {
        from: from.toISOString(),
        to: to.toISOString(),
      }),
    enabled: !!companyId,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["salons", companyId] });
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateAppointmentInput) =>
      salonsApi.createAppointment(companyId, input),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: (params: { id: string; input: Partial<CreateAppointmentInput> }) =>
      salonsApi.updateAppointment(companyId, params.id, params.input),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => salonsApi.cancelAppointment(companyId, id),
    onSuccess: invalidate,
  });
  const completeMutation = useMutation({
    mutationFn: (id: string) => salonsApi.completeAppointment(companyId, id),
    onSuccess: invalidate,
  });
  const noShowMutation = useMutation({
    mutationFn: (id: string) => salonsApi.noShowAppointment(companyId, id),
    onSuccess: invalidate,
  });
  const reminderMutation = useMutation({
    mutationFn: (id: string) => salonsApi.sendReminder(companyId, id),
    onSuccess: invalidate,
  });

  if (!selectedCompany) {
    return <div className="p-6 text-sm text-muted-foreground">Select a company first.</div>;
  }
  if (stylistsQuery.isLoading || servicesQuery.isLoading) {
    return <PageSkeleton />;
  }

  const stylists = stylistsQuery.data?.stylists ?? [];
  const services = servicesQuery.data?.services ?? [];
  const appointments = appointmentsQuery.data?.appointments ?? [];

  const visibleStylists =
    stylistFilter === "all"
      ? stylists
      : stylists.filter((s) => s.id === stylistFilter);

  function openNew(stylistId?: string, startAt?: Date) {
    setEditing(null);
    setPrefillStylistId(stylistId);
    setPrefillStartAt(startAt);
    setDialogOpen(true);
  }

  function openEdit(a: Appointment) {
    setEditing(a);
    setPrefillStylistId(undefined);
    setPrefillStartAt(undefined);
    setDialogOpen(true);
  }

  async function handleSubmit(input: CreateAppointmentInput) {
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, input });
    } else {
      await createMutation.mutateAsync(input);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Appointments</h1>
          <p className="text-sm text-muted-foreground">
            Day and week schedule. Click any empty slot to book.
          </p>
        </div>
        <Button onClick={() => openNew()}>
          <Plus className="mr-2 h-4 w-4" /> New appointment
        </Button>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDate(addDays(date, view === "day" ? -1 : -7))}
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={formatDateInput(date)}
              onChange={(e) => setDate(startOfDay(new Date(e.target.value)))}
              className="w-40"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDate(addDays(date, view === "day" ? 1 : 7))}
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDate(startOfDay(new Date()))}
            >
              Today
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Select value={stylistFilter} onValueChange={setStylistFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stylists</SelectItem>
                {stylists.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {view === "day" ? (
        <AppointmentCalendar
          date={date}
          stylists={visibleStylists}
          appointments={appointments}
          onSlotClick={(stylistId, startAt) => openNew(stylistId, startAt)}
          onAppointmentClick={openEdit}
        />
      ) : (
        <div className="space-y-4">
          {Array.from({ length: 7 }, (_, i) => addDays(date, i)).map((d) => (
            <div key={d.toISOString()}>
              <div className="mb-1 text-sm font-medium">
                {d.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </div>
              <AppointmentCalendar
                date={d}
                stylists={visibleStylists}
                appointments={appointments}
                onSlotClick={(stylistId, startAt) => openNew(stylistId, startAt)}
                onAppointmentClick={openEdit}
              />
            </div>
          ))}
        </div>
      )}

      <AppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        stylists={stylists}
        services={services}
        initialStylistId={prefillStylistId}
        initialStartAt={prefillStartAt}
        appointment={editing}
        onSubmit={handleSubmit}
        onCancel={async (id) => {
          await cancelMutation.mutateAsync(id);
          setDialogOpen(false);
        }}
        onComplete={async (id) => {
          await completeMutation.mutateAsync(id);
          setDialogOpen(false);
        }}
        onNoShow={async (id) => {
          await noShowMutation.mutateAsync(id);
          setDialogOpen(false);
        }}
        onSendReminder={async (id) => {
          await reminderMutation.mutateAsync(id);
        }}
      />
    </div>
  );
}
