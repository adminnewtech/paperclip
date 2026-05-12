import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { CsvFieldMapper } from "../components/business/CsvFieldMapper";
import { ImportPreviewTable } from "../components/business/ImportPreviewTable";
import {
  businessImportApi,
  type ImportCommitResult,
  type ImportFieldMapping,
  type ImportPreviewResult,
  type ImportSource,
  type ImportTargetType,
} from "../api/business-import";
import {
  IMPORT_TARGET_TYPES,
  suggestMapping,
} from "@paperclipai/shared";

type Step = 1 | 2 | 3 | 4;

interface SourceCard {
  value: ImportSource;
  label: string;
  description: string;
  icon: typeof FileText;
}

const SOURCES: SourceCard[] = [
  {
    value: "quickbooks",
    label: "QuickBooks",
    description: "CSV export from QuickBooks Online or Desktop.",
    icon: FileSpreadsheet,
  },
  {
    value: "zoho",
    label: "Zoho",
    description: "CSV export from Zoho CRM / Books / Desk.",
    icon: FileSpreadsheet,
  },
  {
    value: "wave",
    label: "Wave",
    description: "CSV export from Wave Accounting.",
    icon: FileSpreadsheet,
  },
  {
    value: "csv_generic",
    label: "Generic CSV",
    description: "Any CSV with sensible column headers.",
    icon: FileText,
  },
  {
    value: "excel_generic",
    label: "Excel (.xlsx)",
    description: "An Excel workbook with the first sheet to import.",
    icon: FileSpreadsheet,
  },
];

const TARGET_LABELS: Record<ImportTargetType, string> = {
  contact: "Contacts",
  lead: "Leads",
  deal: "Deals",
  invoice: "Invoices",
  expense: "Expenses",
  product: "Products",
  employee: "Employees",
  ticket: "Tickets",
  campaign: "Campaigns",
};

const STEPS: Array<{ index: Step; label: string }> = [
  { index: 1, label: "Source" },
  { index: 2, label: "Upload" },
  { index: 3, label: "Map fields" },
  { index: 4, label: "Review & Import" },
];

// Lightweight RFC-4180 CSV parser (mirrors the server-side parser).
// Used here purely to extract headers + sample rows for the mapper UI.
function parseCsvClient(text: string): string[][] {
  let input = text;
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (input[i + 1] === "\n") i += 1;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0] === "") rows.pop();
    else break;
  }
  return rows;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function BusinessImportPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [step, setStep] = useState<Step>(1);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [targetType, setTargetType] = useState<ImportTargetType>("contact");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawData, setRawData] = useState<string>("");
  const [fileFormat, setFileFormat] = useState<"csv" | "excel">("csv");
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ImportFieldMapping[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [deduplicateBy, setDeduplicateBy] = useState<string>("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Import" },
    ]);
  }, [setBreadcrumbs]);

  const headers = useMemo(() => {
    const first = parsedRows[0];
    return first ? first.map((h) => h.trim()) : [];
  }, [parsedRows]);

  const sampleRow = useMemo(() => {
    const dataRow = parsedRows[1];
    if (!dataRow) return null;
    const out: Record<string, string> = {};
    headers.forEach((h, i) => {
      out[h] = dataRow[i] ?? "";
    });
    return out;
  }, [parsedRows, headers]);

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!selectedCompanyId || !source) throw new Error("Missing source");
      return businessImportApi.preview(selectedCompanyId, {
        source,
        targetType,
        rawData,
        fileFormat,
        fieldMapping: mapping,
        options: deduplicateBy ? { deduplicateBy } : undefined,
      });
    },
    onSuccess: (result) => setPreviewResult(result),
  });

  const commitMutation = useMutation({
    mutationFn: () => {
      if (!selectedCompanyId || !source) throw new Error("Missing source");
      return businessImportApi.commit(selectedCompanyId, {
        source,
        targetType,
        rawData,
        fileFormat,
        fieldMapping: mapping,
        options: deduplicateBy ? { deduplicateBy } : undefined,
        skipDuplicates,
        skipInvalid,
      });
    },
    onSuccess: (result) => setCommitResult(result),
  });

  const handleFile = async (file: File) => {
    setUploadError(null);
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("File exceeds the 10MB limit.");
      return;
    }
    setFileName(file.name);
    const isExcel = /\.xlsx?$/i.test(file.name);
    if (isExcel) {
      setFileFormat("excel");
      // Read as base64 for the server to decode via xlsx.
      const buffer = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      setRawData(btoa(binary));
      setParsedRows([]);
    } else {
      setFileFormat("csv");
      const text = await file.text();
      setRawData(text);
      const parsed = parseCsvClient(text);
      setParsedRows(parsed);
    }
  };

  const resetToDefaults = () => {
    if (!source) return;
    const next = suggestMapping(headers, source, targetType);
    setMapping(next);
  };

  const handleStepChange = async (next: Step) => {
    if (next === 3 && source && mapping.length === 0 && headers.length > 0) {
      resetToDefaults();
    }
    if (next === 4) {
      await previewMutation.mutateAsync();
    }
    setStep(next);
  };

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Briefcase}
        message="Select a workspace to import data."
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Import Data</h1>
        <p className="text-sm text-muted-foreground">
          Migrate contacts, leads, invoices, and more from QuickBooks, Zoho,
          Wave, or any CSV export.
        </p>
      </header>

      <ol className="flex items-center gap-2 text-sm">
        {STEPS.map((s, idx) => (
          <li key={s.index} className="flex items-center gap-2">
            <Badge
              variant={s.index === step ? "default" : s.index < step ? "secondary" : "outline"}
            >
              {s.index}. {s.label}
            </Badge>
            {idx < STEPS.length - 1 && (
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            )}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Choose source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SOURCES.map((s) => {
                const Icon = s.icon;
                const selected = source === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSource(s.value)}
                    className={`flex items-start gap-3 rounded-md border p-4 text-left transition ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{s.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              <Label htmlFor="target-type">What are you importing?</Label>
              <Select
                value={targetType}
                onValueChange={(v) => setTargetType(v as ImportTargetType)}
              >
                <SelectTrigger id="target-type" className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_TARGET_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TARGET_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => handleStepChange(2)}
                disabled={!source}
              >
                Continue
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Upload file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 p-8 hover:bg-muted/40"
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFile(file);
              }}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm font-medium">
                Drop a file here or click to choose
              </div>
              <div className="text-xs text-muted-foreground">
                Supports .csv and .xlsx (max 10 MB)
              </div>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
            {uploadError && (
              <p className="text-sm text-destructive">{uploadError}</p>
            )}
            {fileName && (
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <div className="text-sm font-medium">{fileName}</div>
                  <div className="text-xs text-muted-foreground">
                    {parsedRows.length > 0
                      ? `${Math.max(parsedRows.length - 1, 0)} rows, ${headers.length} columns`
                      : fileFormat === "excel"
                        ? "Excel file — preview not available in browser, will parse server-side"
                        : "—"}
                  </div>
                </div>
                <Badge variant="secondary">{fileFormat.toUpperCase()}</Badge>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={() => handleStepChange(3)}
                disabled={!fileName || rawData.length === 0}
              >
                Continue
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Map fields</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fileFormat === "excel" && headers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Excel files are parsed server-side. The server will auto-detect
                a mapping during the preview step.
              </p>
            ) : (
              <CsvFieldMapper
                headers={headers}
                sampleRow={sampleRow}
                targetType={targetType}
                mapping={mapping}
                onChange={setMapping}
                onReset={resetToDefaults}
              />
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dedup">De-duplicate by (optional)</Label>
                <Select
                  value={deduplicateBy}
                  onValueChange={(v) => setDeduplicateBy(v === "_none" ? "" : v)}
                >
                  <SelectTrigger id="dedup">
                    <SelectValue placeholder="(no de-dup)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">(no de-dup)</SelectItem>
                    {mapping.map((m) => (
                      <SelectItem key={m.targetField} value={m.targetField}>
                        {m.targetField}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button onClick={() => handleStepChange(4)}>
                {previewMutation.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-1 h-4 w-4" />
                )}
                Preview
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Review and Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {previewMutation.isError && (
              <p className="text-sm text-destructive">
                {(previewMutation.error as Error).message}
              </p>
            )}
            {previewResult && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Total rows" value={previewResult.totalRows} />
                  <Stat
                    label="Valid"
                    value={previewResult.validRows}
                    tone="success"
                  />
                  <Stat
                    label="Invalid"
                    value={previewResult.invalidRows}
                    tone={previewResult.invalidRows > 0 ? "danger" : undefined}
                  />
                  <Stat
                    label="Duplicates"
                    value={previewResult.duplicates}
                    tone={previewResult.duplicates > 0 ? "warning" : undefined}
                  />
                </div>

                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={skipDuplicates}
                      onCheckedChange={(v) => setSkipDuplicates(v === true)}
                    />
                    Skip duplicates
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={skipInvalid}
                      onCheckedChange={(v) => setSkipInvalid(v === true)}
                    />
                    Skip invalid rows
                  </label>
                </div>

                <ImportPreviewTable rows={previewResult.preview} />
              </>
            )}

            {commitResult && (
              <div className="rounded-md border border-border bg-muted/40 p-4">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Import complete
                </div>
                <ul className="space-y-1 text-sm">
                  <li>{commitResult.createdCount} created</li>
                  <li>{commitResult.skippedCount} skipped</li>
                  <li>{commitResult.failedCount} failed</li>
                </ul>
                {commitResult.errors.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary>{commitResult.errors.length} errors</summary>
                    <ul className="mt-1 space-y-1">
                      {commitResult.errors.slice(0, 50).map((e, idx) => (
                        <li key={idx}>
                          Row {e.rowIndex + 1}: {e.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-3">
                  <Link to="/business" className="text-sm underline">
                    View imported data
                  </Link>
                </div>
              </div>
            )}

            <div className="flex justify-between gap-2">
              <Button
                variant="ghost"
                onClick={() => setStep(3)}
                disabled={commitMutation.isPending}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={() => commitMutation.mutate()}
                disabled={
                  commitMutation.isPending ||
                  commitResult !== null ||
                  !previewResult ||
                  previewResult.totalRows === 0
                }
              >
                {commitMutation.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                )}
                Commit Import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "danger";
}) {
  const colorClass =
    tone === "success"
      ? "text-emerald-600"
      : tone === "warning"
        ? "text-amber-600"
        : tone === "danger"
          ? "text-destructive"
          : "";
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
}
