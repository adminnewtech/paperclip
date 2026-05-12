import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ImportFieldMapping,
  ImportTargetType,
  ImportTransform,
} from "@paperclipai/shared";

/**
 * Table-based field mapper. Each row corresponds to a source column from
 * the uploaded file; the user chooses what entity field it should populate
 * and (optionally) which transform to run on the value before storing.
 */

interface TargetFieldOption {
  value: string;
  label: string;
}

const TRANSFORMS: Array<{ value: ImportTransform | ""; label: string }> = [
  { value: "", label: "(none)" },
  { value: "trim", label: "Trim whitespace" },
  { value: "lowercase", label: "Lowercase" },
  { value: "uppercase", label: "Uppercase" },
  { value: "number", label: "Parse as number" },
  { value: "currency_cents", label: "Currency → cents" },
  { value: "date_iso", label: "Parse as date (ISO)" },
  { value: "phone_e164", label: "Phone → E.164" },
  { value: "tag_split", label: "Split into tag list" },
];

const COMMON_FIELDS: TargetFieldOption[] = [
  { value: "name", label: "name" },
  { value: "code", label: "code" },
  { value: "status", label: "status" },
  { value: "ownerUserId", label: "ownerUserId" },
  { value: "amountCents", label: "amountCents" },
  { value: "currency", label: "currency" },
  { value: "tags", label: "tags" },
];

const TYPE_FIELDS: Record<ImportTargetType, TargetFieldOption[]> = {
  contact: [
    { value: "data.email", label: "data.email" },
    { value: "data.phone", label: "data.phone" },
    { value: "data.mobile", label: "data.mobile" },
    { value: "data.company", label: "data.company" },
    { value: "data.address", label: "data.address" },
  ],
  lead: [
    { value: "data.email", label: "data.email" },
    { value: "data.phone", label: "data.phone" },
    { value: "data.company", label: "data.company" },
    { value: "data.source", label: "data.source" },
    { value: "data.industry", label: "data.industry" },
  ],
  deal: [
    { value: "data.closeDate", label: "data.closeDate" },
    { value: "data.probability", label: "data.probability" },
    { value: "data.accountName", label: "data.accountName" },
  ],
  invoice: [
    { value: "data.issueTimestamp", label: "data.issueTimestamp" },
    { value: "data.dueDate", label: "data.dueDate" },
    { value: "data.balanceCents", label: "data.balanceCents" },
    { value: "data.notes", label: "data.notes" },
    { value: "data.customerName", label: "data.customerName" },
  ],
  expense: [
    { value: "data.vendor", label: "data.vendor" },
    { value: "data.category", label: "data.category" },
    { value: "data.date", label: "data.date" },
    { value: "data.description", label: "data.description" },
  ],
  product: [
    { value: "data.description", label: "data.description" },
    { value: "data.stock", label: "data.stock" },
    { value: "data.category", label: "data.category" },
  ],
  employee: [
    { value: "data.email", label: "data.email" },
    { value: "data.phone", label: "data.phone" },
    { value: "data.title", label: "data.title" },
    { value: "data.department", label: "data.department" },
  ],
  ticket: [
    { value: "data.priority", label: "data.priority" },
    { value: "data.description", label: "data.description" },
    { value: "data.contactName", label: "data.contactName" },
  ],
  campaign: [
    { value: "data.channel", label: "data.channel" },
    { value: "data.startDate", label: "data.startDate" },
    { value: "data.endDate", label: "data.endDate" },
  ],
};

interface CsvFieldMapperProps {
  headers: readonly string[];
  sampleRow: Record<string, string> | null;
  targetType: ImportTargetType;
  mapping: ImportFieldMapping[];
  onChange: (mapping: ImportFieldMapping[]) => void;
  onReset: () => void;
}

export function CsvFieldMapper({
  headers,
  sampleRow,
  targetType,
  mapping,
  onChange,
  onReset,
}: CsvFieldMapperProps) {
  const fieldOptions = useMemo<TargetFieldOption[]>(() => {
    const opts = [...COMMON_FIELDS, ...(TYPE_FIELDS[targetType] ?? [])];
    // Allow custom data.* fields already present in the mapping but not in
    // the default list to remain selectable.
    for (const m of mapping) {
      if (!opts.some((o) => o.value === m.targetField)) {
        opts.push({ value: m.targetField, label: m.targetField });
      }
    }
    return opts;
  }, [targetType, mapping]);

  const mappingByColumn = useMemo(() => {
    const m = new Map<string, ImportFieldMapping>();
    for (const row of mapping) m.set(row.sourceColumn, row);
    return m;
  }, [mapping]);

  const updateRow = (sourceColumn: string, patch: Partial<ImportFieldMapping>) => {
    const existing = mappingByColumn.get(sourceColumn);
    const next = mapping.filter((m) => m.sourceColumn !== sourceColumn);
    if (existing) {
      const merged = { ...existing, ...patch };
      if (merged.targetField) next.push(merged);
    } else if (patch.targetField) {
      next.push({
        sourceColumn,
        targetField: patch.targetField,
        transform: patch.transform,
      });
    }
    onChange(next);
  };

  const clearRow = (sourceColumn: string) => {
    onChange(mapping.filter((m) => m.sourceColumn !== sourceColumn));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Each row maps a column from your file to an entity field. Auto-detected
          mappings are highlighted; you can override any of them.
        </p>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset to defaults
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Source column</th>
              <th className="px-3 py-2 font-medium">Sample</th>
              <th className="px-3 py-2 font-medium">Target field</th>
              <th className="px-3 py-2 font-medium">Transform</th>
              <th className="px-3 py-2 font-medium">Default</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header) => {
              const row = mappingByColumn.get(header);
              const sampleValue = sampleRow?.[header] ?? "";
              return (
                <tr key={header} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{header}</td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">
                    {sampleValue}
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={row?.targetField ?? ""}
                      onValueChange={(v) =>
                        v ? updateRow(header, { targetField: v }) : clearRow(header)
                      }
                    >
                      <SelectTrigger className="h-8 min-w-[180px]">
                        <SelectValue placeholder="(skip)" />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={row?.transform ?? ""}
                      onValueChange={(v) =>
                        updateRow(header, {
                          transform: v ? (v as ImportTransform) : undefined,
                        })
                      }
                      disabled={!row}
                    >
                      <SelectTrigger className="h-8 min-w-[160px]">
                        <SelectValue placeholder="(none)" />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSFORMS.map((t) => (
                          <SelectItem key={t.value || "none"} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      className="h-8"
                      value={
                        row?.defaultValue !== undefined
                          ? String(row.defaultValue)
                          : ""
                      }
                      onChange={(e) =>
                        updateRow(header, {
                          defaultValue: e.target.value || undefined,
                        })
                      }
                      disabled={!row}
                      placeholder="(none)"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {row && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => clearRow(header)}
                      >
                        Clear
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
