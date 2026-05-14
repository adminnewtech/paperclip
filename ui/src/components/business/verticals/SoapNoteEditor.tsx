import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

interface SoapNoteEditorProps {
  value: SoapNote;
  onChange: (next: SoapNote) => void;
  onAutoSave?: (next: SoapNote) => void;
  /** Debounce delay (ms) for `onAutoSave`. Defaults to 1500ms. */
  autoSaveDelayMs?: number;
  disabled?: boolean;
}

export function SoapNoteEditor({
  value,
  onChange,
  onAutoSave,
  autoSaveDelayMs = 1500,
  disabled,
}: SoapNoteEditorProps) {
  const [local, setLocal] = useState<SoapNote>(value);
  const saveTimer = useRef<number | null>(null);
  const onAutoSaveRef = useRef(onAutoSave);
  onAutoSaveRef.current = onAutoSave;

  useEffect(() => {
    setLocal(value);
  }, [value.subjective, value.objective, value.assessment, value.plan]);

  function update(field: keyof SoapNote, val: string) {
    const next = { ...local, [field]: val };
    setLocal(next);
    onChange(next);
    if (onAutoSaveRef.current) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const fn = onAutoSaveRef.current;
      saveTimer.current = window.setTimeout(() => {
        fn(next);
      }, autoSaveDelayMs);
    }
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className="space-y-4">
      <Field
        id="soap-s"
        label="S — Subjective"
        hint="Patient-reported symptoms, history of present illness."
        value={local.subjective}
        onChange={(v) => update("subjective", v)}
        disabled={disabled}
      />
      <Field
        id="soap-o"
        label="O — Objective"
        hint="Observable findings: vitals, exam, lab results."
        value={local.objective}
        onChange={(v) => update("objective", v)}
        disabled={disabled}
      />
      <Field
        id="soap-a"
        label="A — Assessment"
        hint="Diagnosis (use the ICD-10 picker below for codes)."
        value={local.assessment}
        onChange={(v) => update("assessment", v)}
        disabled={disabled}
      />
      <Field
        id="soap-p"
        label="P — Plan"
        hint="Treatment plan, prescriptions, follow-up."
        value={local.plan}
        onChange={(v) => update("plan", v)}
        disabled={disabled}
      />
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

function Field({ id, label, hint, value, onChange, disabled }: FieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        disabled={disabled}
        className="font-mono text-sm"
      />
    </div>
  );
}
