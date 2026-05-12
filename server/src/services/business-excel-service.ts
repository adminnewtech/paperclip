/**
 * CSV / "Excel-friendly" export generation for business module data.
 *
 * We emit plain RFC 4180 CSV with a UTF-8 BOM prefix so Excel renders Arabic
 * (and other non-ASCII) characters correctly without the user needing to set
 * an import encoding. A real XLSX writer is intentionally avoided — it would
 * pull in a heavy dependency, and every spreadsheet program (Excel, Numbers,
 * Sheets, LibreOffice) opens CSV natively.
 */

/** UTF-8 BOM. Required so Excel auto-detects UTF-8 on Windows. */
export const UTF8_BOM = "﻿";

/** Cell values we accept directly. Anything else is coerced via String(). */
export type CsvCell = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  /** Header label as it will appear in the first row. */
  header: string;
  /** Extractor — returns the raw cell value. */
  value: (row: T) => CsvCell;
}

/**
 * Escape a single field per RFC 4180:
 *   - If the field contains a comma, quote, CR, LF, or leading/trailing
 *     whitespace, wrap it in double quotes.
 *   - Inside a quoted field, any embedded double quote is doubled.
 *   - null/undefined → empty string.
 */
export function escapeCsvField(value: CsvCell): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : String(value);
  const needsQuoting =
    s.includes(",") ||
    s.includes('"') ||
    s.includes("\n") ||
    s.includes("\r") ||
    /^\s|\s$/.test(s);
  if (!needsQuoting) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Render rows to a CSV string (with UTF-8 BOM prefix). Suitable for sending
 * straight to the browser as a download.
 */
export function rowsToCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsvField(c.header)).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvField(c.value(row))).join(","));
  }
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Format a cents amount as a decimal string (no currency symbol, no thousands
 * separator) — this is the safest form for spreadsheet consumers, who can
 * apply their own formatting on top.
 */
export function formatCentsForCsv(cents: number | null | undefined): string {
  if (cents == null) return "";
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${negative ? "-" : ""}${whole}.${frac < 10 ? `0${frac}` : frac}`;
}

/**
 * Format an ISO timestamp (or Date) as `YYYY-MM-DD`. Used for date columns
 * where time-of-day adds noise.
 */
export function formatDateForCsv(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Suggest a sensible Content-Disposition filename for a download. Strips
 * problematic characters and appends `.csv`.
 */
export function csvFilename(base: string): string {
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
  return `${safe || "export"}.csv`;
}
