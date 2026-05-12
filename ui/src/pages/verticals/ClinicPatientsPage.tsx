import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Stethoscope, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import { PatientCard } from "../../components/business/verticals/PatientCard";
import {
  ageFromDob,
  clinicQueryKeys,
  clinicsApi,
  type Patient,
} from "../../api/business-clinics";

type GenderFilter = "all" | "male" | "female" | "other";
type AgeFilter = "all" | "child" | "adult" | "senior";

export function ClinicPatientsPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<GenderFilter>("all");
  const [ageBand, setAgeBand] = useState<AgeFilter>("all");
  const [hasChronic, setHasChronic] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Clinic", href: "/business/clinic" },
      { label: "Patients" },
    ]);
  }, [setBreadcrumbs]);

  const patientsQuery = useQuery({
    queryKey: clinicQueryKeys.patients(companyId, q),
    queryFn: () => clinicsApi.listPatients(companyId, q || undefined),
    enabled: !!companyId,
  });

  const filtered = useMemo<Patient[]>(() => {
    const all = patientsQuery.data?.patients ?? [];
    return all.filter((p) => {
      if (gender !== "all" && p.gender !== gender) return false;
      if (ageBand !== "all") {
        const age = ageFromDob(p.dateOfBirth);
        if (age == null) return false;
        if (ageBand === "child" && age >= 18) return false;
        if (ageBand === "adult" && (age < 18 || age >= 60)) return false;
        if (ageBand === "senior" && age < 60) return false;
      }
      if (hasChronic && p.chronicConditions.length === 0) return false;
      return true;
    });
  }, [patientsQuery.data, gender, ageBand, hasChronic]);

  if (!selectedCompany) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a company first.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6 text-emerald-500" />
            Patients
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse, search and manage your patient records.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New patient
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name…"
            className="pl-8"
          />
        </div>
        <FilterChip
          label="All"
          active={gender === "all"}
          onClick={() => setGender("all")}
        />
        <FilterChip
          label="Male"
          active={gender === "male"}
          onClick={() => setGender("male")}
        />
        <FilterChip
          label="Female"
          active={gender === "female"}
          onClick={() => setGender("female")}
        />
        <div className="h-5 w-px bg-border mx-1" />
        <FilterChip
          label="Any age"
          active={ageBand === "all"}
          onClick={() => setAgeBand("all")}
        />
        <FilterChip
          label="Children"
          active={ageBand === "child"}
          onClick={() => setAgeBand("child")}
        />
        <FilterChip
          label="Adults"
          active={ageBand === "adult"}
          onClick={() => setAgeBand("adult")}
        />
        <FilterChip
          label="Seniors"
          active={ageBand === "senior"}
          onClick={() => setAgeBand("senior")}
        />
        <div className="h-5 w-px bg-border mx-1" />
        <FilterChip
          label="Chronic conditions"
          active={hasChronic}
          onClick={() => setHasChronic(!hasChronic)}
        />
      </div>

      {patientsQuery.isLoading ? (
        <PageSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          message={
            (patientsQuery.data?.patients ?? []).length === 0
              ? "No patients yet. Add your first patient to begin."
              : "No patients match the current filters."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((patient) => (
            <PatientCard
              key={patient.id}
              patient={patient}
              href={`/business/clinic/patients/${patient.id}`}
            />
          ))}
        </div>
      )}

      <CreatePatientDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void queryClient.invalidateQueries({
            queryKey: clinicQueryKeys.patients(companyId),
          });
        }}
        companyId={companyId}
      />
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Badge
      variant={active ? "default" : "outline"}
      className="cursor-pointer select-none"
      onClick={onClick}
    >
      {label}
    </Badge>
  );
}

function CreatePatientDialog({
  open,
  onOpenChange,
  onCreated,
  companyId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  companyId: string;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other">("other");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [civilId, setCivilId] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      clinicsApi.createPatient(companyId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: dob,
        gender,
        phone: phone.trim(),
        email: email.trim() || undefined,
        civilId: civilId.trim() || undefined,
        allergies: [],
        chronicConditions: [],
        currentMedications: [],
        familyHistory: [],
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setFirstName("");
      setLastName("");
      setDob("");
      setGender("other");
      setPhone("");
      setEmail("");
      setCivilId("");
    },
  });

  function submit() {
    if (!firstName.trim() || !lastName.trim() || !dob || !phone.trim()) return;
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New patient</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="p-first">First name</Label>
              <Input
                id="p-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-last">Last name</Label>
              <Input
                id="p-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="p-dob">Date of birth</Label>
              <Input
                id="p-dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-gender">Gender</Label>
              <Select
                value={gender}
                onValueChange={(v) => setGender(v as "male" | "female" | "other")}
              >
                <SelectTrigger id="p-gender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-phone">Phone</Label>
            <Input
              id="p-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+96599999999"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-email">Email (optional)</Label>
            <Input
              id="p-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-civil">Civil ID / National ID (optional)</Label>
            <Input
              id="p-civil"
              value={civilId}
              onChange={(e) => setCivilId(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create patient"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
