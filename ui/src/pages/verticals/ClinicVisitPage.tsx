import { useEffect, useState } from "react";
import { Link, useParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  Pill,
  Plus,
  Save,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import { SoapNoteEditor } from "../../components/business/verticals/SoapNoteEditor";
import { PrescriptionBuilder } from "../../components/business/verticals/PrescriptionBuilder";
import {
  clinicQueryKeys,
  clinicsApi,
  type LabOrder,
  type Prescription,
  type Visit,
  type Vitals,
} from "../../api/business-clinics";

export function ClinicVisitPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const params = useParams();
  const visitId = params.id as string;
  const companyId = selectedCompany?.id ?? "";

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Clinic", href: "/business/clinic" },
      { label: "Visit" },
    ]);
  }, [setBreadcrumbs]);

  const visitQuery = useQuery({
    queryKey: clinicQueryKeys.visit(companyId, visitId),
    queryFn: () => clinicsApi.getVisit(companyId, visitId),
    enabled: !!companyId && !!visitId,
  });

  const catalogQuery = useQuery({
    queryKey: clinicQueryKeys.catalog(),
    queryFn: () => clinicsApi.catalog(),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Visit>) =>
      clinicsApi.updateVisit(companyId, visitId, updates),
    onSuccess: (updated) => {
      queryClient.setQueryData(clinicQueryKeys.visit(companyId, visitId), updated);
    },
  });

  const addRxMutation = useMutation({
    mutationFn: (rx: Prescription) =>
      clinicsApi.addPrescription(companyId, visitId, rx),
    onSuccess: (updated) => {
      queryClient.setQueryData(clinicQueryKeys.visit(companyId, visitId), updated);
    },
  });

  const removeRxMutation = useMutation({
    mutationFn: (index: number) =>
      clinicsApi.removePrescription(companyId, visitId, index),
    onSuccess: (updated) => {
      queryClient.setQueryData(clinicQueryKeys.visit(companyId, visitId), updated);
    },
  });

  const addLabMutation = useMutation({
    mutationFn: (lab: { testCode: string; testName: string }) =>
      clinicsApi.addLabOrder(companyId, visitId, lab),
    onSuccess: (updated) => {
      queryClient.setQueryData(clinicQueryKeys.visit(companyId, visitId), updated);
    },
  });

  const labResultMutation = useMutation({
    mutationFn: (args: { index: number; result: string; abnormal?: boolean }) =>
      clinicsApi.updateLabResult(companyId, visitId, args.index, {
        result: args.result,
        abnormal: args.abnormal,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(clinicQueryKeys.visit(companyId, visitId), updated);
    },
  });

  const signMutation = useMutation({
    mutationFn: (signerName: string) =>
      clinicsApi.signVisit(companyId, visitId, signerName),
    onSuccess: (updated) => {
      queryClient.setQueryData(clinicQueryKeys.visit(companyId, visitId), updated);
    },
  });

  const [rxOpen, setRxOpen] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signOpen, setSignOpen] = useState(false);
  const [labResultDialog, setLabResultDialog] = useState<{
    index: number;
    lab: LabOrder;
  } | null>(null);
  const [icdQuery, setIcdQuery] = useState("");

  // Local SOAP state (debounced auto-save via SoapNoteEditor).
  const [soap, setSoap] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
  });
  // Local vitals
  const [vitals, setVitals] = useState<Vitals>({});
  // Local diagnosis codes
  const [diagnosisCodes, setDiagnosisCodes] = useState<string[]>([]);
  // Local billing
  const [totalCents, setTotalCents] = useState(0);
  const [insuranceCents, setInsuranceCents] = useState(0);
  const [patientCents, setPatientCents] = useState(0);

  useEffect(() => {
    if (visitQuery.data) {
      setSoap({
        subjective: visitQuery.data.subjective,
        objective: visitQuery.data.objective,
        assessment: visitQuery.data.assessment,
        plan: visitQuery.data.plan,
      });
      setVitals(visitQuery.data.vitals ?? {});
      setDiagnosisCodes(visitQuery.data.diagnosisCodes ?? []);
      setTotalCents(visitQuery.data.totalChargeCents);
      setInsuranceCents(visitQuery.data.insuranceCoveredCents);
      setPatientCents(visitQuery.data.patientPayCents);
    }
  }, [visitQuery.data?.id]);

  if (!selectedCompany) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a company first.
      </div>
    );
  }
  if (visitQuery.isLoading) return <PageSkeleton />;
  if (!visitQuery.data) {
    return (
      <div className="p-6">
        <EmptyState icon={Stethoscope} message="Visit not found." />
      </div>
    );
  }
  const visit = visitQuery.data;
  const isSigned = visit.status === "signed";
  const drugList = catalogQuery.data?.drugs ?? [];
  const icd10 = catalogQuery.data?.icd10 ?? [];
  const labTests = catalogQuery.data?.labTests ?? [];

  const icdMatches =
    icdQuery.trim().length > 0
      ? icd10
          .filter(
            (c) =>
              c.code.toLowerCase().includes(icdQuery.toLowerCase()) ||
              c.description.toLowerCase().includes(icdQuery.toLowerCase()),
          )
          .slice(0, 8)
      : [];

  function handleSaveDraft() {
    updateMutation.mutate({
      ...soap,
      vitals,
      diagnosisCodes,
      totalChargeCents: totalCents,
      insuranceCoveredCents: insuranceCents,
      patientPayCents: patientCents,
    });
  }

  function handleSignSubmit() {
    if (!signerName.trim()) return;
    // First save current edits, then sign.
    updateMutation.mutate(
      {
        ...soap,
        vitals,
        diagnosisCodes,
        totalChargeCents: totalCents,
        insuranceCoveredCents: insuranceCents,
        patientPayCents: patientCents,
      },
      {
        onSuccess: () => {
          signMutation.mutate(signerName.trim(), {
            onSuccess: () => {
              setSignOpen(false);
            },
          });
        },
      },
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Link
        to={`/business/clinic/patients/${visit.patientId}`}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to patient
      </Link>

      <Card>
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Stethoscope className="h-5 w-5 text-emerald-500" />
                Visit
              </h1>
              <span className="font-mono text-sm text-muted-foreground">
                {visit.code}
              </span>
              <Badge
                variant={isSigned ? "default" : visit.status === "completed" ? "secondary" : "outline"}
              >
                {visit.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {new Date(visit.date).toLocaleString()} · {visit.type.replace("_", " ")}
              {visit.signedBy ? ` · signed by ${visit.signedBy}` : ""}
            </div>
          </div>
          {!isSigned ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleSaveDraft}
                disabled={updateMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "Saving…" : "Save draft"}
              </Button>
              <Button onClick={() => setSignOpen(true)}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Sign & complete
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Vitals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vitals</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <VitalInput
            label="BP"
            value={vitals.bloodPressure ?? ""}
            onChange={(v) => setVitals({ ...vitals, bloodPressure: v })}
            disabled={isSigned}
            placeholder="120/80"
          />
          <VitalInput
            label="HR"
            value={vitals.heartRate?.toString() ?? ""}
            onChange={(v) => setVitals({ ...vitals, heartRate: numOrUndef(v) })}
            disabled={isSigned}
            placeholder="bpm"
          />
          <VitalInput
            label="Temp °C"
            value={vitals.temperatureCelsius?.toString() ?? ""}
            onChange={(v) =>
              setVitals({ ...vitals, temperatureCelsius: numOrUndef(v) })
            }
            disabled={isSigned}
            placeholder="36.6"
          />
          <VitalInput
            label="Resp"
            value={vitals.respiratoryRate?.toString() ?? ""}
            onChange={(v) =>
              setVitals({ ...vitals, respiratoryRate: numOrUndef(v) })
            }
            disabled={isSigned}
            placeholder="/min"
          />
          <VitalInput
            label="SpO2"
            value={vitals.oxygenSaturation?.toString() ?? ""}
            onChange={(v) =>
              setVitals({ ...vitals, oxygenSaturation: numOrUndef(v) })
            }
            disabled={isSigned}
            placeholder="%"
          />
          <VitalInput
            label="Weight kg"
            value={vitals.weightKg?.toString() ?? ""}
            onChange={(v) => {
              const w = numOrUndef(v);
              const next = { ...vitals, weightKg: w };
              if (w && next.heightCm) {
                const h = next.heightCm / 100;
                next.bmi = Math.round((w / (h * h)) * 10) / 10;
              }
              setVitals(next);
            }}
            disabled={isSigned}
            placeholder="kg"
          />
          <VitalInput
            label="Height cm"
            value={vitals.heightCm?.toString() ?? ""}
            onChange={(v) => {
              const h = numOrUndef(v);
              const next = { ...vitals, heightCm: h };
              if (h && next.weightKg) {
                const hM = h / 100;
                next.bmi = Math.round((next.weightKg / (hM * hM)) * 10) / 10;
              }
              setVitals(next);
            }}
            disabled={isSigned}
            placeholder="cm"
          />
          <VitalInput
            label="BMI"
            value={vitals.bmi?.toString() ?? ""}
            onChange={() => undefined}
            disabled
            placeholder="auto"
          />
        </CardContent>
      </Card>

      {/* SOAP note */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SOAP note</CardTitle>
        </CardHeader>
        <CardContent>
          <SoapNoteEditor
            value={soap}
            onChange={setSoap}
            onAutoSave={(next) => {
              if (!isSigned) {
                updateMutation.mutate({ ...next });
              }
            }}
            disabled={isSigned}
          />

          <div className="mt-4 space-y-2">
            <Label className="text-sm font-medium">ICD-10 diagnosis codes</Label>
            <div className="flex flex-wrap gap-1.5">
              {diagnosisCodes.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  None selected.
                </span>
              ) : (
                diagnosisCodes.map((c) => (
                  <Badge key={c} variant="secondary" className="gap-1 font-mono">
                    {c}
                    {!isSigned ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDiagnosisCodes(diagnosisCodes.filter((x) => x !== c))
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </Badge>
                ))
              )}
            </div>
            {!isSigned ? (
              <div className="space-y-1">
                <Input
                  value={icdQuery}
                  onChange={(e) => setIcdQuery(e.target.value)}
                  placeholder="Search ICD-10 code or description…"
                  className="max-w-md"
                />
                {icdMatches.length > 0 ? (
                  <div className="border rounded-md max-w-md">
                    {icdMatches.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        className="w-full text-left px-2 py-1 hover:bg-muted text-xs"
                        onClick={() => {
                          if (!diagnosisCodes.includes(c.code)) {
                            setDiagnosisCodes([...diagnosisCodes, c.code]);
                          }
                          setIcdQuery("");
                        }}
                      >
                        <span className="font-mono text-muted-foreground mr-2">
                          {c.code}
                        </span>
                        {c.description}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Prescriptions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Pill className="h-4 w-4" /> Prescriptions ({visit.prescriptions.length})
          </CardTitle>
          {!isSigned ? (
            <Button size="sm" onClick={() => setRxOpen(true)}>
              <Plus className="mr-2 h-3 w-3" />
              Add
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {visit.prescriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prescriptions added yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Drug</th>
                  <th className="py-1">Dosage</th>
                  <th className="py-1">Frequency</th>
                  <th className="py-1 text-right">Days</th>
                  <th className="py-1">Notes</th>
                  {!isSigned ? <th className="py-1" /> : null}
                </tr>
              </thead>
              <tbody>
                {visit.prescriptions.map((rx, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 font-medium">{rx.drug}</td>
                    <td className="py-1">{rx.dosage}</td>
                    <td className="py-1">{rx.frequency}</td>
                    <td className="py-1 text-right">{rx.durationDays}</td>
                    <td className="py-1 text-xs text-muted-foreground">
                      {rx.instructions ?? ""}
                    </td>
                    {!isSigned ? (
                      <td className="py-1 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeRxMutation.mutate(i)}
                          disabled={removeRxMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Lab orders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> Lab orders ({visit.labOrders.length})
          </CardTitle>
          {!isSigned ? (
            <Select
              value=""
              onValueChange={(testCode) => {
                const test = labTests.find((t) => t.testCode === testCode);
                if (!test) return;
                addLabMutation.mutate({
                  testCode: test.testCode,
                  testName: test.testName,
                });
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Order lab…" />
              </SelectTrigger>
              <SelectContent>
                {labTests.map((t) => (
                  <SelectItem key={t.testCode} value={t.testCode}>
                    {t.testCode} — {t.testName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </CardHeader>
        <CardContent>
          {visit.labOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No lab orders yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Test</th>
                  <th className="py-1">Status</th>
                  <th className="py-1">Ordered</th>
                  <th className="py-1">Result</th>
                  {!isSigned ? <th className="py-1" /> : null}
                </tr>
              </thead>
              <tbody>
                {visit.labOrders.map((lab, i) => (
                  <tr
                    key={i}
                    className={`border-t ${lab.abnormal ? "bg-red-50 dark:bg-red-950/20" : ""}`}
                  >
                    <td className="py-1">
                      <span className="font-mono text-xs text-muted-foreground mr-2">
                        {lab.testCode}
                      </span>
                      {lab.testName}
                    </td>
                    <td className="py-1">
                      <Badge variant={lab.status === "completed" ? "default" : "outline"}>
                        {lab.status}
                      </Badge>
                    </td>
                    <td className="py-1 text-xs text-muted-foreground">
                      {new Date(lab.orderedAt).toLocaleDateString()}
                    </td>
                    <td className="py-1">
                      {lab.result ? (
                        <span
                          className={lab.abnormal ? "font-medium text-red-600" : ""}
                        >
                          {lab.result}
                          {lab.abnormal ? " ⚠" : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          Pending
                        </span>
                      )}
                    </td>
                    {!isSigned ? (
                      <td className="py-1 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px]"
                          onClick={() => setLabResultDialog({ index: i, lab })}
                        >
                          {lab.result ? "Edit" : "Result"}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="b-total">Total (fils)</Label>
            <Input
              id="b-total"
              type="number"
              value={totalCents}
              onChange={(e) => setTotalCents(Number(e.target.value) || 0)}
              disabled={isSigned}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="b-ins">Insurance covered (fils)</Label>
            <Input
              id="b-ins"
              type="number"
              value={insuranceCents}
              onChange={(e) => setInsuranceCents(Number(e.target.value) || 0)}
              disabled={isSigned}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="b-pat">Patient pays (fils)</Label>
            <Input
              id="b-pat"
              type="number"
              value={patientCents}
              onChange={(e) => setPatientCents(Number(e.target.value) || 0)}
              disabled={isSigned}
            />
          </div>
        </CardContent>
      </Card>

      <PrescriptionBuilder
        open={rxOpen}
        onOpenChange={setRxOpen}
        drugList={drugList}
        pending={addRxMutation.isPending}
        onSubmit={(rx) => {
          addRxMutation.mutate(rx, {
            onSuccess: () => setRxOpen(false),
          });
        }}
      />

      {labResultDialog ? (
        <LabResultDialog
          lab={labResultDialog.lab}
          onClose={() => setLabResultDialog(null)}
          onSubmit={(result, abnormal) => {
            labResultMutation.mutate(
              { index: labResultDialog.index, result, abnormal },
              {
                onSuccess: () => setLabResultDialog(null),
              },
            );
          }}
          pending={labResultMutation.isPending}
        />
      ) : null}

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign visit</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Signing finalizes this visit. After signing, no further edits are
            allowed.
          </p>
          <div className="space-y-1">
            <Label htmlFor="sg-name">Signed by</Label>
            <Input
              id="sg-name"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Dr. Ahmed Al-Sabah"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSignOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSignSubmit}
              disabled={!signerName.trim() || signMutation.isPending}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {signMutation.isPending ? "Signing…" : "Sign & complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VitalInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase text-muted-foreground">
        {label}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="text-sm"
      />
    </div>
  );
}

function numOrUndef(v: string): number | undefined {
  const n = Number(v);
  return v.trim() === "" || Number.isNaN(n) ? undefined : n;
}

function LabResultDialog({
  lab,
  onClose,
  onSubmit,
  pending,
}: {
  lab: LabOrder;
  onClose: () => void;
  onSubmit: (result: string, abnormal?: boolean) => void;
  pending: boolean;
}) {
  const [result, setResult] = useState(lab.result ?? "");
  const [abnormal, setAbnormal] = useState(lab.abnormal ?? false);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {lab.testCode} — {lab.testName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="lr-result">Result</Label>
            <Input
              id="lr-result"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="e.g. 6.2 mmol/L"
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={abnormal}
              onChange={(e) => setAbnormal(e.target.checked)}
            />
            Flag as abnormal
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(result.trim(), abnormal)}
            disabled={!result.trim() || pending}
          >
            {pending ? "Saving…" : "Save result"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
