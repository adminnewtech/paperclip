import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Plus,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import {
  clinicQueryKeys,
  clinicsApi,
  type ClinicAppointment,
  type ClinicAppointmentType,
  type Doctor,
} from "../../api/business-clinics";

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_VARIANT: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  scheduled: "outline",
  checked_in: "secondary",
  in_progress: "default",
  completed: "default",
  cancelled: "destructive",
  no_show: "destructive",
};

export function ClinicAppointmentsPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  const [day, setDay] = useState<Date>(new Date());
  const [doctorFilter, setDoctorFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Clinic", href: "/business/clinic" },
      { label: "Appointments" },
    ]);
  }, [setBreadcrumbs]);

  const doctorsQuery = useQuery({
    queryKey: clinicQueryKeys.doctors(companyId),
    queryFn: () => clinicsApi.listDoctors(companyId),
    enabled: !!companyId,
  });

  const dayKey = day.toDateString();
  const appointmentsQuery = useQuery({
    queryKey: clinicQueryKeys.appointments(companyId, dayKey),
    queryFn: () =>
      clinicsApi.listAppointments(companyId, {
        from: startOfDay(day).toISOString(),
        to: endOfDay(day).toISOString(),
      }),
    enabled: !!companyId,
  });

  const checkInMutation = useMutation({
    mutationFn: (id: string) => clinicsApi.checkIn(companyId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: clinicQueryKeys.appointments(companyId, dayKey),
      });
    },
  });

  const startVisitMutation = useMutation({
    mutationFn: (id: string) => clinicsApi.startVisit(companyId, id),
    onSuccess: (visit) => {
      void queryClient.invalidateQueries({
        queryKey: clinicQueryKeys.appointments(companyId, dayKey),
      });
      // Navigate to the new visit
      window.location.href = `/business/clinic/visits/${visit.id}`;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => clinicsApi.cancelAppointment(companyId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: clinicQueryKeys.appointments(companyId, dayKey),
      });
    },
  });

  if (!selectedCompany) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a company first.
      </div>
    );
  }

  const doctors = doctorsQuery.data?.doctors ?? [];
  const appointments = (appointmentsQuery.data?.appointments ?? []).filter(
    (a) => doctorFilter === "all" || a.doctorId === doctorFilter,
  );
  const visibleDoctors =
    doctorFilter === "all"
      ? doctors
      : doctors.filter((d) => d.id === doctorFilter);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Calendar className="h-6 w-6 text-emerald-500" />
            Appointments
          </h1>
          <p className="text-sm text-muted-foreground">
            Day view by doctor.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New appointment
        </Button>
      </header>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const d = new Date(day);
              d.setDate(d.getDate() - 1);
              setDay(d);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium w-44 text-center">
            {day.toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const d = new Date(day);
              d.setDate(d.getDate() + 1);
              setDay(d);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDay(new Date())}>
            Today
          </Button>
        </div>
        <div className="w-56">
          <Select value={doctorFilter} onValueChange={setDoctorFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All doctors</SelectItem>
              {doctors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} ({d.specialty})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {appointmentsQuery.isLoading || doctorsQuery.isLoading ? (
        <PageSkeleton />
      ) : visibleDoctors.length === 0 ? (
        <EmptyState
          icon={Calendar}
          message="No doctors set up. Visit the clinic dashboard to seed defaults."
        />
      ) : (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${visibleDoctors.length}, minmax(180px, 1fr))`,
          }}
        >
          {visibleDoctors.map((d) => (
            <DoctorColumn
              key={d.id}
              doctor={d}
              appointments={appointments.filter((a) => a.doctorId === d.id)}
              onCheckIn={(id) => checkInMutation.mutate(id)}
              onStartVisit={(id) => startVisitMutation.mutate(id)}
              onCancel={(id) => cancelMutation.mutate(id)}
              pending={
                checkInMutation.isPending ||
                startVisitMutation.isPending ||
                cancelMutation.isPending
              }
            />
          ))}
        </div>
      )}

      <CreateAppointmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
        doctors={doctors}
        defaultDay={day}
        onCreated={() => {
          void queryClient.invalidateQueries({
            queryKey: clinicQueryKeys.appointments(companyId, dayKey),
          });
        }}
      />
    </div>
  );
}

function DoctorColumn({
  doctor,
  appointments,
  onCheckIn,
  onStartVisit,
  onCancel,
  pending,
}: {
  doctor: Doctor;
  appointments: ClinicAppointment[];
  onCheckIn: (id: string) => void;
  onStartVisit: (id: string) => void;
  onCancel: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between border-b pb-2">
        <div>
          <div className="text-sm font-semibold">{doctor.name}</div>
          <div className="text-xs text-muted-foreground">{doctor.specialty}</div>
        </div>
        <Badge variant="outline">{appointments.length}</Badge>
      </div>
      {appointments.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No appointments
        </p>
      ) : (
        appointments.map((a) => (
          <Card key={a.id} className="border-l-2 border-l-emerald-500">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {a.code}
                </span>
                <Badge variant={STATUS_VARIANT[a.status] ?? "outline"} className="text-[10px]">
                  {a.status.replace("_", " ")}
                </Badge>
              </div>
              <Link
                to={`/business/clinic/patients/${a.patientId}`}
                className="block"
              >
                <div className="text-sm font-medium hover:underline">
                  {a.patientName}
                </div>
              </Link>
              <div className="text-xs text-muted-foreground">
                {fmtTime(a.startAt)} · {a.durationMinutes}m · {a.type.replace("_", " ")}
              </div>
              {a.chiefComplaint ? (
                <p className="text-xs text-muted-foreground italic line-clamp-2">
                  "{a.chiefComplaint}"
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1 pt-1">
                {a.status === "scheduled" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] flex-1"
                    disabled={pending}
                    onClick={() => onCheckIn(a.id)}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Check in
                  </Button>
                ) : null}
                {(a.status === "checked_in" || a.status === "scheduled") &&
                !a.visitId ? (
                  <Button
                    size="sm"
                    className="h-7 text-[10px] flex-1"
                    disabled={pending}
                    onClick={() => onStartVisit(a.id)}
                  >
                    Start visit
                  </Button>
                ) : null}
                {a.visitId ? (
                  <Link to={`/business/clinic/visits/${a.visitId}`} className="flex-1">
                    <Button size="sm" variant="outline" className="h-7 text-[10px] w-full">
                      Open visit
                    </Button>
                  </Link>
                ) : null}
                {a.status !== "cancelled" && a.status !== "completed" ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={pending}
                    onClick={() => onCancel(a.id)}
                  >
                    <XCircle className="h-3 w-3 text-muted-foreground" />
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function CreateAppointmentDialog({
  open,
  onOpenChange,
  companyId,
  doctors,
  defaultDay,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  doctors: Doctor[];
  defaultDay: Date;
  onCreated: () => void;
}) {
  const [patientQ, setPatientQ] = useState("");
  const [patientId, setPatientId] = useState<string>("");
  const [doctorId, setDoctorId] = useState<string>(doctors[0]?.id ?? "");
  const [date, setDate] = useState<string>(
    `${defaultDay.getFullYear()}-${String(defaultDay.getMonth() + 1).padStart(2, "0")}-${String(defaultDay.getDate()).padStart(2, "0")}`,
  );
  const [time, setTime] = useState<string>("09:00");
  const [duration, setDuration] = useState<number>(30);
  const [type, setType] = useState<ClinicAppointmentType>("consultation");
  const [chiefComplaint, setChiefComplaint] = useState("");

  useEffect(() => {
    if (!doctorId && doctors[0]) setDoctorId(doctors[0].id);
  }, [doctors, doctorId]);

  const patientsQuery = useQuery({
    queryKey: clinicQueryKeys.patients(companyId, patientQ),
    queryFn: () => clinicsApi.listPatients(companyId, patientQ || undefined),
    enabled: !!companyId && open,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      clinicsApi.createAppointment(companyId, {
        patientId,
        doctorId,
        startAt: new Date(`${date}T${time}:00`).toISOString(),
        durationMinutes: duration,
        type,
        chiefComplaint: chiefComplaint.trim() || undefined,
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setPatientId("");
      setChiefComplaint("");
    },
  });

  const patients = patientsQuery.data?.patients ?? [];

  const canSubmit = useMemo(
    () => !!patientId && !!doctorId && !!date && !!time && duration > 0,
    [patientId, doctorId, date, time, duration],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New appointment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="a-patient-search">Patient</Label>
            <Input
              id="a-patient-search"
              value={patientQ}
              onChange={(e) => setPatientQ(e.target.value)}
              placeholder="Search patients…"
            />
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a patient" />
              </SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName} ({p.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-doctor">Doctor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger id="a-doctor">
                <SelectValue placeholder="Select a doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} — {d.specialty}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="a-date">Date</Label>
              <Input
                id="a-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="a-time">Time</Label>
              <Input
                id="a-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="a-dur">Duration (min)</Label>
              <Input
                id="a-dur"
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) =>
                  setDuration(Math.max(5, Number(e.target.value) || 5))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="a-type">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as ClinicAppointmentType)}
              >
                <SelectTrigger id="a-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consultation">Consultation</SelectItem>
                  <SelectItem value="follow_up">Follow-up</SelectItem>
                  <SelectItem value="procedure">Procedure</SelectItem>
                  <SelectItem value="vaccination">Vaccination</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-cc">Chief complaint (optional)</Label>
            <Textarea
              id="a-cc"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              rows={2}
              placeholder="e.g. Sore throat for 3 days"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create appointment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
