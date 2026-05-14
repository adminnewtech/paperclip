/**
 * CSV / Excel import for the business module.
 *
 * Lifecycle:
 *   1. `preview` parses the raw CSV/Excel text, applies the field mapping
 *      (auto-detecting one when not supplied), validates each row, and
 *      reports duplicates without writing anything to the database.
 *   2. `commit` re-runs the same pipeline and inserts the resulting rows
 *      into `business_entities`, leveraging the same insert shape as the
 *      live CRUD route so audit logging and downstream stream events fire.
 *
 * Notes on parsing:
 *   - We ship an inline RFC-4180 CSV parser that handles quoted fields,
 *     escaped quotes ("" inside a quoted cell), embedded newlines, and
 *     CRLF or LF line endings. No npm dependency.
 *   - Excel parsing is attempted via a dynamic `import("xlsx")`; if that
 *     package is not installed the service returns a structured error
 *     telling the caller to export to CSV first. We never crash.
 *
 * Limits:
 *   - 10 MB max raw payload, enforced by the caller (Express body size
 *     limit) — but we also defensively bail out beyond `MAX_RAW_BYTES`.
 *   - 10,000 rows max per import.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  getImportTemplate,
  suggestMapping,
  type ImportFieldMapping,
  type ImportSource,
  type ImportTargetType,
  type ImportTransform,
} from "@paperclipai/shared";
import { logActivity } from "./activity-log.js";

export const MAX_IMPORT_ROWS = 10_000;
export const MAX_RAW_BYTES = 10 * 1024 * 1024;

export type { ImportFieldMapping, ImportSource, ImportTargetType, ImportTransform };

export interface ImportOptions {
  skipFirstRow?: boolean;
  deduplicateBy?: string;
  maxRows?: number;
}

export interface ImportPreviewInput {
  source: ImportSource;
  targetType: ImportTargetType;
  rawData: string;
  fileFormat: "csv" | "excel";
  fieldMapping?: ImportFieldMapping[];
  options?: ImportOptions;
}

export interface PreviewRow {
  rowIndex: number;
  sourceData: Record<string, string>;
  mappedData: Record<string, unknown>;
  issues: string[];
  isDuplicate: boolean;
}

export interface ImportPreviewResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicates: number;
  preview: PreviewRow[];
  suggestedMapping: ImportFieldMapping[];
}

export interface ImportCommitInput extends ImportPreviewInput {
  skipDuplicates: boolean;
  skipInvalid: boolean;
}

export interface ImportCommitResult {
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  errors: Array<{ rowIndex: number; error: string }>;
  createdEntityIds: string[];
}

export interface BusinessImportService {
  preview(companyId: string, input: ImportPreviewInput): Promise<ImportPreviewResult>;
  commit(
    companyId: string,
    input: ImportCommitInput,
    actorUserId?: string,
  ): Promise<ImportCommitResult>;
  getTemplate(source: ImportSource, targetType: ImportTargetType): ImportFieldMapping[];
}

// ---------------------------------------------------------------------------
// Target type -> (moduleKey, entityType) routing
// ---------------------------------------------------------------------------

interface TargetSpec {
  moduleKey: string;
  entityType: string;
  defaultStatus: string;
}

const TARGET_SPECS: Record<ImportTargetType, TargetSpec> = {
  contact: { moduleKey: "crm", entityType: "contact", defaultStatus: "active" },
  lead: { moduleKey: "crm", entityType: "lead", defaultStatus: "new" },
  deal: { moduleKey: "crm", entityType: "deal", defaultStatus: "prospecting" },
  invoice: { moduleKey: "sales", entityType: "invoice", defaultStatus: "draft" },
  expense: { moduleKey: "finance", entityType: "expense", defaultStatus: "recorded" },
  product: { moduleKey: "inventory", entityType: "product", defaultStatus: "active" },
  employee: { moduleKey: "hr", entityType: "employee", defaultStatus: "active" },
  ticket: { moduleKey: "helpdesk", entityType: "ticket", defaultStatus: "open" },
  campaign: { moduleKey: "marketing", entityType: "campaign", defaultStatus: "draft" },
};

export function getTargetSpec(targetType: ImportTargetType): TargetSpec {
  return TARGET_SPECS[targetType];
}

// ---------------------------------------------------------------------------
// CSV parsing (inline, RFC-4180-ish, no dependency)
// ---------------------------------------------------------------------------

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  if (!input) return rows;

  // Strip an optional UTF-8 BOM.
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const len = text.length;
  let i = 0;
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  while (i < len) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === "\r") {
      // Treat \r or \r\n as end-of-row.
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      if (i < len && text[i] === "\n") i += 1;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  // Final field if any non-empty content lingers.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Trim a single trailing empty row (common when CSV ends with a newline).
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0] === "") rows.pop();
    else break;
  }

  return rows;
}

interface MinimalXlsx {
  read(data: Buffer, opts: { type: "buffer" }): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json(
      sheet: unknown,
      opts: { header: 1; raw?: boolean; defval?: string },
    ): unknown[][];
  };
}

async function parseExcel(rawData: string): Promise<string[][]> {
  // We expect `rawData` to be a base64-encoded XLSX payload when the client
  // chose `fileFormat: "excel"`. The dynamic import keeps `xlsx` an
  // optional dependency: if it isn't installed we throw a friendly error.
  let xlsx: MinimalXlsx;
  try {
    // The dynamic import target is computed at runtime, so the bundler will
    // not eagerly resolve it and TypeScript can't statically type-check it.
    const moduleName = "xlsx";
    xlsx = (await import(/* @vite-ignore */ moduleName)) as unknown as MinimalXlsx;
  } catch {
    throw new Error(
      "Excel support is not installed on this server. Please export the file to CSV and re-upload.",
    );
  }
  const buffer = Buffer.from(rawData, "base64");
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : []));
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

function applyTransform(value: string, transform: ImportTransform | undefined): unknown {
  const raw = value ?? "";
  switch (transform) {
    case "trim":
      return raw.trim();
    case "lowercase":
      return raw.trim().toLowerCase();
    case "uppercase":
      return raw.trim().toUpperCase();
    case "number": {
      const trimmed = raw.trim();
      if (trimmed === "") return null;
      const n = Number(trimmed.replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "currency_cents": {
      const trimmed = raw.replace(/[^0-9.\-]/g, "").trim();
      if (trimmed === "" || trimmed === "-") return null;
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      return Math.round(n * 100);
    }
    case "date_iso": {
      const trimmed = raw.trim();
      if (trimmed === "") return null;
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? trimmed : d.toISOString();
    }
    case "phone_e164": {
      const digits = raw.replace(/[^\d+]/g, "").trim();
      if (digits === "") return null;
      return digits.startsWith("+") ? digits : `+${digits}`;
    }
    case "tag_split":
      return raw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    default:
      return raw;
  }
}

// ---------------------------------------------------------------------------
// Mapping pipeline
// ---------------------------------------------------------------------------

function setMapped(out: Record<string, unknown>, targetField: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string" && value === "") return;
  if (Array.isArray(value) && value.length === 0) return;
  if (targetField.startsWith("data.")) {
    const key = targetField.slice("data.".length);
    const data = (out["data"] as Record<string, unknown> | undefined) ?? {};
    data[key] = value;
    out["data"] = data;
  } else {
    out[targetField] = value;
  }
}

function applyMapping(
  sourceRow: Record<string, string>,
  mapping: readonly ImportFieldMapping[],
): { mapped: Record<string, unknown>; issues: string[] } {
  const mapped: Record<string, unknown> = {};
  const issues: string[] = [];
  for (const m of mapping) {
    const raw = sourceRow[m.sourceColumn];
    if (raw === undefined && m.defaultValue !== undefined) {
      setMapped(mapped, m.targetField, m.defaultValue);
      continue;
    }
    if (raw === undefined) continue;
    const transformed = applyTransform(raw, m.transform);
    if (
      (transformed === null || transformed === "") &&
      m.defaultValue !== undefined
    ) {
      setMapped(mapped, m.targetField, m.defaultValue);
    } else {
      setMapped(mapped, m.targetField, transformed);
    }
  }
  return { mapped, issues };
}

function validateMapped(
  mapped: Record<string, unknown>,
  targetType: ImportTargetType,
): string[] {
  const issues: string[] = [];
  const name = mapped["name"];
  const code = mapped["code"];
  if (
    (typeof name !== "string" || name.length === 0) &&
    (typeof code !== "string" || code.length === 0)
  ) {
    issues.push("Row must have at least a name or code");
  }
  const amount = mapped["amountCents"];
  if (amount !== undefined && amount !== null && typeof amount !== "number") {
    issues.push("amountCents is not a valid number");
  }
  const currency = mapped["currency"];
  if (currency !== undefined && currency !== null) {
    if (typeof currency !== "string" || currency.length !== 3) {
      issues.push("currency must be a 3-letter code");
    }
  }
  // Per-type sanity checks: invoices / deals should have positive amounts.
  if ((targetType === "invoice" || targetType === "deal") && typeof amount === "number" && amount < 0) {
    issues.push("amount cannot be negative");
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Parse helper shared between preview and commit
// ---------------------------------------------------------------------------

async function buildParsedRows(
  input: ImportPreviewInput,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  if (input.rawData.length > MAX_RAW_BYTES) {
    throw new Error("Input data exceeds the 10MB limit");
  }

  const matrix =
    input.fileFormat === "excel"
      ? await parseExcel(input.rawData)
      : parseCsv(input.rawData);
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = (matrix[0] ?? []).map((h) => String(h ?? "").trim());
  const dataStart = input.options?.skipFirstRow === false ? 0 : 1;
  const maxRows = Math.min(input.options?.maxRows ?? MAX_IMPORT_ROWS, MAX_IMPORT_ROWS);
  const rows: Record<string, string>[] = [];
  for (let i = dataStart; i < matrix.length && rows.length < maxRows; i++) {
    const cells = matrix[i] ?? [];
    if (cells.every((c) => c == null || String(c).trim() === "")) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c] ?? `col_${c}`] = String(cells[c] ?? "");
    }
    rows.push(obj);
  }
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

async function loadExistingValues(
  db: Db,
  companyId: string,
  targetType: ImportTargetType,
  field: string,
): Promise<Set<string>> {
  const spec = TARGET_SPECS[targetType];
  const rows = await db
    .select({
      name: businessEntities.name,
      code: businessEntities.code,
      data: businessEntities.data,
    })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, spec.moduleKey),
        eq(businessEntities.entityType, spec.entityType),
      ),
    );
  const set = new Set<string>();
  for (const row of rows) {
    let value: unknown;
    if (field === "name") value = row.name;
    else if (field === "code") value = row.code;
    else if (field.startsWith("data.")) {
      const key = field.slice("data.".length);
      const data = row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {};
      value = data[key];
    } else {
      value = (row as Record<string, unknown>)[field];
    }
    if (typeof value === "string" && value.length > 0) set.add(value.toLowerCase());
  }
  return set;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createBusinessImportService(db: Db): BusinessImportService {
  function resolveMapping(
    input: ImportPreviewInput,
    headers: string[],
  ): ImportFieldMapping[] {
    if (input.fieldMapping && input.fieldMapping.length > 0) return input.fieldMapping;
    const suggested = suggestMapping(headers, input.source, input.targetType);
    if (suggested.length > 0) return suggested;
    return getImportTemplate(input.source, input.targetType);
  }

  async function preview(
    companyId: string,
    input: ImportPreviewInput,
  ): Promise<ImportPreviewResult> {
    const { headers, rows } = await buildParsedRows(input);
    const mapping = resolveMapping(input, headers);
    const suggestedMapping = suggestMapping(headers, input.source, input.targetType);

    // Pre-load existing values for duplicate detection if requested.
    const dedupField = input.options?.deduplicateBy;
    const existing = dedupField
      ? await loadExistingValues(db, companyId, input.targetType, dedupField)
      : new Set<string>();
    const seenInBatch = new Set<string>();

    const preview: PreviewRow[] = [];
    let validRows = 0;
    let invalidRows = 0;
    let duplicates = 0;
    const PREVIEW_CAP = 20;

    for (let i = 0; i < rows.length; i++) {
      const source = rows[i]!;
      const { mapped, issues } = applyMapping(source, mapping);
      issues.push(...validateMapped(mapped, input.targetType));

      let isDuplicate = false;
      if (dedupField) {
        let dedupValue: unknown;
        if (dedupField.startsWith("data.")) {
          const key = dedupField.slice("data.".length);
          dedupValue = (mapped["data"] as Record<string, unknown> | undefined)?.[key];
        } else {
          dedupValue = mapped[dedupField];
        }
        if (typeof dedupValue === "string" && dedupValue.length > 0) {
          const lc = dedupValue.toLowerCase();
          if (existing.has(lc) || seenInBatch.has(lc)) isDuplicate = true;
          seenInBatch.add(lc);
        }
      }

      if (issues.length === 0) validRows += 1;
      else invalidRows += 1;
      if (isDuplicate) duplicates += 1;

      if (preview.length < PREVIEW_CAP) {
        preview.push({
          rowIndex: i,
          sourceData: source,
          mappedData: mapped,
          issues,
          isDuplicate,
        });
      }
    }

    return {
      totalRows: rows.length,
      validRows,
      invalidRows,
      duplicates,
      preview,
      suggestedMapping,
    };
  }

  async function commit(
    companyId: string,
    input: ImportCommitInput,
    actorUserId?: string,
  ): Promise<ImportCommitResult> {
    const { headers, rows } = await buildParsedRows(input);
    const mapping = resolveMapping(input, headers);

    const dedupField = input.options?.deduplicateBy;
    const existing = dedupField
      ? await loadExistingValues(db, companyId, input.targetType, dedupField)
      : new Set<string>();
    const seenInBatch = new Set<string>();

    const spec = TARGET_SPECS[input.targetType];
    const result: ImportCommitResult = {
      createdCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
      createdEntityIds: [],
    };
    const now = new Date();

    for (let i = 0; i < rows.length; i++) {
      const source = rows[i]!;
      const { mapped } = applyMapping(source, mapping);
      const issues = validateMapped(mapped, input.targetType);

      let isDuplicate = false;
      if (dedupField) {
        let dedupValue: unknown;
        if (dedupField.startsWith("data.")) {
          const key = dedupField.slice("data.".length);
          dedupValue = (mapped["data"] as Record<string, unknown> | undefined)?.[key];
        } else {
          dedupValue = mapped[dedupField];
        }
        if (typeof dedupValue === "string" && dedupValue.length > 0) {
          const lc = dedupValue.toLowerCase();
          if (existing.has(lc) || seenInBatch.has(lc)) isDuplicate = true;
          seenInBatch.add(lc);
        }
      }

      if (issues.length > 0) {
        if (input.skipInvalid) {
          result.skippedCount += 1;
          continue;
        }
        result.failedCount += 1;
        result.errors.push({ rowIndex: i, error: issues.join("; ") });
        continue;
      }
      if (isDuplicate) {
        if (input.skipDuplicates) {
          result.skippedCount += 1;
          continue;
        }
      }

      try {
        const data = (mapped["data"] as Record<string, unknown> | undefined) ?? {};
        const tagsRaw = mapped["tags"];
        const tags = Array.isArray(tagsRaw) ? (tagsRaw as string[]) : [];
        const [row] = await db
          .insert(businessEntities)
          .values({
            companyId,
            moduleKey: spec.moduleKey,
            entityType: spec.entityType,
            parentId: null,
            code: (mapped["code"] as string | undefined) ?? null,
            name: (mapped["name"] as string | undefined) ?? null,
            status: (mapped["status"] as string | undefined) ?? spec.defaultStatus,
            ownerUserId: (mapped["ownerUserId"] as string | undefined) ?? actorUserId ?? null,
            amountCents: (mapped["amountCents"] as number | undefined) ?? null,
            currency: (mapped["currency"] as string | undefined) ?? null,
            data,
            tags,
            createdByUserId: actorUserId ?? null,
            updatedByUserId: actorUserId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: businessEntities.id });
        if (row) {
          result.createdCount += 1;
          result.createdEntityIds.push(row.id);
        }
      } catch (err) {
        result.failedCount += 1;
        result.errors.push({
          rowIndex: i,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (result.createdCount > 0) {
      await logActivity(db, {
        companyId,
        actorType: actorUserId ? "user" : "system",
        actorId: actorUserId ?? "system",
        agentId: null,
        runId: null,
        action: "business.entities_imported",
        entityType: "business_entity",
        entityId: companyId,
        details: {
          source: input.source,
          targetType: input.targetType,
          moduleKey: spec.moduleKey,
          entityType: spec.entityType,
          totalRows: rows.length,
          createdCount: result.createdCount,
          skippedCount: result.skippedCount,
          failedCount: result.failedCount,
        },
      }).catch(() => {});
    }

    return result;
  }

  function getTemplate(
    source: ImportSource,
    targetType: ImportTargetType,
  ): ImportFieldMapping[] {
    return getImportTemplate(source, targetType);
  }

  return { preview, commit, getTemplate };
}
