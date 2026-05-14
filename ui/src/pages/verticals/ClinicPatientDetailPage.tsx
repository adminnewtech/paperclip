import { useEffect, useState } from "react";
import { Link, useParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  ClipboardList,
  FileText,
  HeartPulse,
  Pill,
  ShieldCheck,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import {
  ageFromDob,
  clinicQueryKeys,
  clinicsApi,
  type Patient,
  type Visit,
} from "../../api/business-clinics";

export function ClinicPatientDetailPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const params = useParams();
  const patientId = params.id as string;
  const companyId = selectedCompany?.id ?? "";

  const detailQuery = useQuery({
    queryKey: clinicQueryKeys.patient(companyId, patientId),
    queryFn: () => clinicsApi.getPatient(companyId, patientId),
    enabled: !!companyId && !!patientId,
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Clinic", href: "/business/clinic" },
      { label: "Patients", href: "/business/clinic/patients" },
      { label: detailQuery.data?.patient.fullName ?? "Patient" },
    ]);
  }, [setBreadcrumbs, detailQuery.data?.patient.fullName]);

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Patient>) =>
      clinicsApi.updatePatient(companyId, patientId, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: clinicQueryKeys.patient(companyId, patientId),
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
  if (detailQuery.isLoading) return <PageSkeleton />;
  if (!detailQuery.data) {
    return (
      <div className="p-6">
        <EmptyState icon={UserIcon} message="Patient not found." />
      </div>
    );
  }
  const { patient, visits } = detailQuery.data;
  const age = ageFromDob(patient.dateOfBirth);

  return (
    <div className="space-y-6 p-6">
      <Link
        to="/business/clinic/patients"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to patients
      </Link>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div
                className={`h-14 w-14 rounded-full flex items-center justify-center text-white shrink-0 ${
                  patient.gender === "female"
                    ? "bg-pink-500"
                    : patient.gender === "male"
                      ? "bg-blue-500"
                      : "bg-slate-500"
                }`}
              >
                <UserIcon className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold truncate">
                    {patient.fullName}
                  </h1>
                  {patient.flagged ? (
                    <Badge variant="destructive">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Flagged
                    </Badge>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground font-mono">
                  {patient.code}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    {age != null ? `${age}y` : "—"} · {patient.gender}
                  </span>
                  {patient.bloodType && patient.bloodType !== "unknown" ? (
                    <span>Blood: {patient.bloodType}</span>
                  ) : null}
                  <span>{patient.phone}</span>
                  {patient.email ? <span>{patient.email}</span> : null}
                  {patient.nationality ? <span>{patient.nationality}</span> : null}
                </div>
                {patient.insurance ? (
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3 w-3 text-emerald-600" />
                    Insurance: {patient.insurance.provider} —{" "}
                    {patient.insurance.policyNumber}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground shrink-0">
              <div>{patient.totalVisits} visits</div>
              {patient.lastVisitAt ? (
                <div>
                  Last: {new Date(patient.lastVisitAt).toLocaleDateString()}
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="visits" className="space-y-4">
        <TabsList>
          <TabsTrigger value="visits">Visits</TabsTrigger>
          <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
          <TabsTrigger value="labs">Lab results</TabsTrigger>
          <TabsTrigger value="medical">Allergies & conditions</TabsTrigger>
        </TabsList>

        <TabsContent value="visits">
          <VisitsTimeline visits={visits} />
        </TabsContent>
        <TabsContent value="prescriptions">
          <PrescriptionsList visits={visits} />
        </TabsContent>
        <TabsContent value="labs">
          <LabResultsTable visits={visits} />
        </TabsContent>
        <TabsContent value="medical">
          <MedicalHistoryEditor
            patient={patient}
            onSave={(updates) => updateMutation.mutate(updates)}
            saving={updateMutation.isPending}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function VisitsTimeline({ visits }: { visits: Visit[] }) {
  if (visits.length === 0) {
    return <EmptyState icon={Calendar} message="No visits recorded yet." />;
  }
  return (
    <div className="space-y-3">
      {visits.map((v) => (
        <Card key={v.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {v.code}
                  </span>
                  <Badge variant={v.status === "signed" ? "default" : "outline"}>
                    {v.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.date).toLocaleString()}
                  </span>
                </div>
                {v.assessment ? (
                  <p className="mt-1 text-sm">
                    <span className="font-medium">Assessment:</span>{" "}
                    {v.assessment}
                  </p>
                ) : null}
                {v.diagnosisCodes && v.diagnosisCodes.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {v.diagnosisCodes.map((c) => (
                      <Badge key={c} variant="outline" className="font-mono text-[10px]">
                        {c}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              <Link to={`/business/clinic/visits/${v.id}`}>
                <Button variant="outline" size="sm">
                  Open
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PrescriptionsList({ visits }: { visits: Visit[] }) {
  const all = visits.flatMap((v) =>
    v.prescriptions.map((rx) => ({ ...rx, visitId: v.id, date: v.date })),
  );
  if (all.length === 0) {
    return <EmptyState icon={Pill} message="No prescriptions on file." />;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-2">Date</th>
          <th className="py-2">Drug</th>
          <th className="py-2">Dosage</th>
          <th className="py-2">Frequency</th>
          <th className="py-2 text-right">Duration</th>
        </tr>
      </thead>
      <tbody>
        {all.map((rx, i) => (
          <tr key={`${rx.visitId}-${i}`} className="border-t">
            <td className="py-2">{new Date(rx.date).toLocaleDateString()}</td>
            <td className="py-2 font-medium">{rx.drug}</td>
            <td className="py-2">{rx.dosage}</td>
            <td className="py-2">{rx.frequency}</td>
            <td className="py-2 text-right">{rx.durationDays} days</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LabResultsTable({ visits }: { visits: Visit[] }) {
  const all = visits.flatMap((v) =>
    v.labOrders.map((lab) => ({ ...lab, visitId: v.id, visitDate: v.date })),
  );
  if (all.length === 0) {
    return <EmptyState icon={ClipboardList} message="No lab results yet." />;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-2">Date</th>
          <th className="py-2">Test</th>
          <th className="py-2">Status</th>
          <th className="py-2">Result</th>
        </tr>
      </thead>
      <tbody>
        {all.map((lab, i) => (
          <tr
            key={`${lab.visitId}-${i}`}
            className={`border-t ${lab.abnormal ? "bg-red-50 dark:bg-red-950/20" : ""}`}
          >
            <td className="py-2">
              {new Date(lab.resultedAt ?? lab.orderedAt).toLocaleDateString()}
            </td>
            <td className="py-2">
              <span className="font-mono text-xs text-muted-foreground mr-2">
                {lab.testCode}
              </span>
              {lab.testName}
            </td>
            <td className="py-2">
              <Badge variant={lab.status === "completed" ? "default" : "outline"}>
                {lab.status}
              </Badge>
            </td>
            <td className="py-2">
              {lab.result ? (
                <span
                  className={lab.abnormal ? "font-medium text-red-600" : ""}
                >
                  {lab.result}
                  {lab.abnormal ? " ⚠" : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">Pending</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MedicalHistoryEditor({
  patient,
  onSave,
  saving,
}: {
  patient: Patient;
  onSave: (updates: Partial<Patient>) => void;
  saving: boolean;
}) {
  const [allergies, setAllergies] = useState<string[]>(patient.allergies);
  const [chronicConditions, setChronicConditions] = useState<string[]>(
    patient.chronicConditions,
  );
  const [currentMedications, setCurrentMedications] = useState<string[]>(
    patient.currentMedications,
  );
  const [familyHistory, setFamilyHistory] = useState<string[]>(
    patient.familyHistory,
  );

  function hasChanges(): boolean {
    return (
      JSON.stringify(allergies) !== JSON.stringify(patient.allergies) ||
      JSON.stringify(chronicConditions) !==
        JSON.stringify(patient.chronicConditions) ||
      JSON.stringify(currentMedications) !==
        JSON.stringify(patient.currentMedications) ||
      JSON.stringify(familyHistory) !== JSON.stringify(patient.familyHistory)
    );
  }

  return (
    <div className="space-y-6">
      <ListEditor
        label="Allergies"
        icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        items={allergies}
        onChange={setAllergies}
        placeholder="e.g. Penicillin"
      />
      <ListEditor
        label="Chronic conditions"
        icon={<HeartPulse className="h-4 w-4 text-rose-500" />}
        items={chronicConditions}
        onChange={setChronicConditions}
        placeholder="e.g. Hypertension"
      />
      <ListEditor
        label="Current medications"
        icon={<Pill className="h-4 w-4 text-blue-500" />}
        items={currentMedications}
        onChange={setCurrentMedications}
        placeholder="e.g. Metformin 500mg"
      />
      <ListEditor
        label="Family history"
        icon={<FileText className="h-4 w-4 text-slate-500" />}
        items={familyHistory}
        onChange={setFamilyHistory}
        placeholder="e.g. Father — Diabetes type 2"
      />
      <div className="flex justify-end">
        <Button
          disabled={!hasChanges() || saving}
          onClick={() =>
            onSave({
              allergies,
              chronicConditions,
              currentMedications,
              familyHistory,
            })
          }
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function ListEditor({
  label,
  icon,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  icon: React.ReactNode;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft("");
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-xs text-muted-foreground">None recorded.</span>
        ) : (
          items.map((item, i) => (
            <Badge key={`${item}-${i}`} variant="secondary" className="gap-1">
              {item}
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}
