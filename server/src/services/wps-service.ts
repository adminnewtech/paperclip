/**
 * WPS (Wages Protection System) payroll file generator.
 *
 * The WPS scheme is enforced by both Saudi Arabia (SAMA SARIE format) and
 * Kuwait (CBK SIF format) to ensure private-sector salaries are paid on
 * time and through the banking system. Employers must:
 *   1. Maintain employees with bank account / IBAN details,
 *   2. Generate a monthly WPS file containing every employee's net salary,
 *   3. Submit the file to their bank, who forwards it to the regulator.
 *
 * This service generates both formats from the same internal data model.
 *
 * Employees are stored as `businessEntities` with moduleKey="hr" and
 * entityType="employee", and we read:
 *   - `nationalId`              : string
 *   - `iban`                    : string
 *   - `bankCode`                : string (optional)
 *   - `monthlyBasicSalaryCents` : number (halalas / fils)
 *   - `monthlyHousingCents`     : number
 *   - `monthlyAllowancesCents`  : number
 *   - `wpsCurrency`             : "SAR" | "KWD"
 *
 * Each WPS generation is persisted as `businessEntities` with
 * moduleKey="wps" and entityType="run" so that history is auditable.
 *
 * Environment variables: none. (Future: direct bank API integration via
 * SAMA SARIE / CBK gateway — both require sponsor-bank credentials.)
 */

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WpsCountry = "ksa" | "kuwait";

export interface WpsPayrollEntry {
  employeeId: string;
  employeeName: string;
  nationalId: string;
  iban: string;
  bankCode?: string;
  basicSalaryCents: number;
  housingCents: number;
  otherAllowancesCents: number;
  totalSalaryCents: number;
  currency: "SAR" | "KWD";
  period: string;
}

export interface WpsValidationResult {
  employeeId: string;
  employeeName: string;
  ready: boolean;
  missingFields: string[];
}

export interface WpsFile {
  filename: string;
  content: string;
  format: "sif" | "csv";
  entries: WpsPayrollEntry[];
  totalCents: number;
  country: WpsCountry;
  period: string;
}

export interface WpsHistoryRecord {
  id: string;
  period: string;
  country: WpsCountry;
  generatedAt: string;
  entryCount: number;
  totalCents: number;
  currency: "SAR" | "KWD";
  filename: string;
}

export interface WpsService {
  generatePayrollFile(
    companyId: string,
    period: string,
    country: WpsCountry,
  ): Promise<WpsFile>;
  validateEmployeesForWps(
    companyId: string,
    country?: WpsCountry,
  ): Promise<WpsValidationResult[]>;
  listHistory(
    companyId: string,
    opts?: { limit?: number },
  ): Promise<WpsHistoryRecord[]>;
}

// ---------------------------------------------------------------------------
// IBAN validation
// ---------------------------------------------------------------------------

const IBAN_LENGTHS: Record<string, number> = { SA: 24, KW: 30 };

/**
 * Validate a numeric IBAN per ISO 13616: rearrange (country+check moves to
 * the end), convert letters to digits (A=10..Z=35), and check that the
 * resulting big integer mod 97 equals 1.
 */
export function isValidIban(iban: string): boolean {
  if (!iban) return false;
  const cleaned = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) return false;
  const country = cleaned.slice(0, 2);
  const expectedLen = IBAN_LENGTHS[country];
  if (expectedLen && cleaned.length !== expectedLen) return false;
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  let numeric = "";
  for (const ch of rearranged) {
    if (ch >= "0" && ch <= "9") numeric += ch;
    else numeric += String(ch.charCodeAt(0) - 55); // A=10
  }
  // Big-int mod 97 via stepwise reduction (avoids BigInt for portability).
  let remainder = 0;
  for (let i = 0; i < numeric.length; i++) {
    remainder = (remainder * 10 + Number(numeric.charAt(i))) % 97;
  }
  return remainder === 1;
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

const PERIOD_RE = /^\d{4}-\d{2}$/;
function isValidPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

// ---------------------------------------------------------------------------
// Employee loading
// ---------------------------------------------------------------------------

interface EmployeeRow {
  id: string;
  name?: string;
  data: EmployeeData;
}

interface EmployeeData {
  nationalId?: string;
  iban?: string;
  bankCode?: string;
  monthlyBasicSalaryCents?: number;
  monthlyHousingCents?: number;
  monthlyAllowancesCents?: number;
  wpsCurrency?: string;
}

async function loadEmployees(db: Db, companyId: string): Promise<EmployeeRow[]> {
  const rows = await db
    .select({
      id: businessEntities.id,
      name: businessEntities.name,
      data: businessEntities.data,
    })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "hr"),
        eq(businessEntities.entityType, "employee"),
        eq(businessEntities.status, "active"),
      ),
    )
    .orderBy(desc(businessEntities.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? undefined,
    data: (r.data ?? {}) as EmployeeData,
  }));
}

function toEntry(
  emp: EmployeeRow,
  period: string,
  country: WpsCountry,
): WpsPayrollEntry | { error: string; employeeId: string } {
  const data = emp.data;
  const currency: "SAR" | "KWD" = country === "ksa" ? "SAR" : "KWD";
  const basic = Number(data.monthlyBasicSalaryCents ?? 0);
  const housing = Number(data.monthlyHousingCents ?? 0);
  const other = Number(data.monthlyAllowancesCents ?? 0);
  if (basic <= 0) {
    return { error: "missing_basic_salary", employeeId: emp.id };
  }
  if (!data.iban || !isValidIban(data.iban)) {
    return { error: "invalid_or_missing_iban", employeeId: emp.id };
  }
  if (!data.nationalId) {
    return { error: "missing_national_id", employeeId: emp.id };
  }
  return {
    employeeId: emp.id,
    employeeName: emp.name ?? emp.id,
    nationalId: data.nationalId,
    iban: data.iban.replace(/\s+/g, "").toUpperCase(),
    bankCode: data.bankCode,
    basicSalaryCents: basic,
    housingCents: housing,
    otherAllowancesCents: other,
    totalSalaryCents: basic + housing + other,
    currency,
    period,
  };
}

// ---------------------------------------------------------------------------
// SARIE (KSA) format
// ---------------------------------------------------------------------------

function buildSarieFile(
  entries: WpsPayrollEntry[],
  period: string,
  companyId: string,
): string {
  // SARIE is a pipe-delimited record format:
  //   Header:  H|<companyId>|<period>|<count>|<totalAmount>|<currency>
  //   Detail:  D|<seq>|<nationalId>|<iban>|<bankCode>|<basicSar>|<housingSar>|<otherSar>|<totalSar>
  //   Footer:  F|<count>|<totalAmount>
  const total = entries.reduce((s, e) => s + e.totalSalaryCents, 0);
  const lines: string[] = [];
  lines.push(
    [
      "H",
      companyId,
      period,
      String(entries.length),
      sar(total),
      "SAR",
    ].join("|"),
  );
  entries.forEach((e, i) => {
    lines.push(
      [
        "D",
        String(i + 1),
        e.nationalId,
        e.iban,
        e.bankCode ?? "",
        sar(e.basicSalaryCents),
        sar(e.housingCents),
        sar(e.otherAllowancesCents),
        sar(e.totalSalaryCents),
      ].join("|"),
    );
  });
  lines.push(["F", String(entries.length), sar(total)].join("|"));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CBK (Kuwait) format
// ---------------------------------------------------------------------------

function buildCbkFile(entries: WpsPayrollEntry[], period: string): string {
  // CBK accepts CSV with civil ID + IBAN + amount + currency.
  const header = [
    "Civil ID",
    "Employee Name",
    "IBAN",
    "Bank Code",
    "Basic Salary (KWD)",
    "Housing (KWD)",
    "Other Allowances (KWD)",
    "Net Salary (KWD)",
    "Currency",
    "Period",
  ].join(",");
  const total = entries.reduce((s, e) => s + e.totalSalaryCents, 0);
  const lines = entries.map((e) =>
    [
      csv(e.nationalId),
      csv(e.employeeName),
      csv(e.iban),
      csv(e.bankCode ?? ""),
      kwd(e.basicSalaryCents),
      kwd(e.housingCents),
      kwd(e.otherAllowancesCents),
      kwd(e.totalSalaryCents),
      e.currency,
      e.period,
    ].join(","),
  );
  const footer = `\nTotal,${entries.length},,,,,,${kwd(total)},KWD,${period}`;
  return [header, ...lines].join("\n") + footer;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const WPS_MODULE_KEY = "wps";
const WPS_ENTITY_TYPE = "run";

interface StoredWpsRun {
  country: WpsCountry;
  period: string;
  entryCount: number;
  totalCents: number;
  currency: "SAR" | "KWD";
  filename: string;
  generatedAt: string;
}

async function persistRun(
  db: Db,
  companyId: string,
  file: WpsFile,
): Promise<void> {
  const now = new Date();
  const payload: StoredWpsRun = {
    country: file.country,
    period: file.period,
    entryCount: file.entries.length,
    totalCents: file.totalCents,
    currency: file.country === "ksa" ? "SAR" : "KWD",
    filename: file.filename,
    generatedAt: now.toISOString(),
  };
  await db.insert(businessEntities).values({
    companyId,
    moduleKey: WPS_MODULE_KEY,
    entityType: WPS_ENTITY_TYPE,
    code: `${file.country}-${file.period}-${now.getTime()}`,
    name: file.filename,
    status: "generated",
    amountCents: file.totalCents,
    currency: payload.currency,
    data: payload as unknown as Record<string, unknown>,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWpsService(db: Db): WpsService {
  async function validateEmployeesForWps(
    companyId: string,
    country?: WpsCountry,
  ): Promise<WpsValidationResult[]> {
    const employees = await loadEmployees(db, companyId);
    const expectedCountry = country === "kuwait" ? "KW" : "SA";
    return employees.map((emp) => {
      const missing: string[] = [];
      const data = emp.data;
      if (!data.nationalId) missing.push("nationalId");
      if (!data.iban) {
        missing.push("iban");
      } else if (!isValidIban(data.iban)) {
        missing.push("iban_invalid_checksum");
      } else if (country && !data.iban.replace(/\s+/g, "").toUpperCase().startsWith(expectedCountry)) {
        missing.push(`iban_wrong_country_expected_${expectedCountry}`);
      }
      if (!data.monthlyBasicSalaryCents || data.monthlyBasicSalaryCents <= 0) {
        missing.push("monthlyBasicSalaryCents");
      }
      return {
        employeeId: emp.id,
        employeeName: emp.name ?? emp.id,
        ready: missing.length === 0,
        missingFields: missing,
      };
    });
  }

  async function generatePayrollFile(
    companyId: string,
    period: string,
    country: WpsCountry,
  ): Promise<WpsFile> {
    if (!isValidPeriod(period)) {
      throw new Error(`Invalid WPS period "${period}" (expected YYYY-MM)`);
    }
    const employees = await loadEmployees(db, companyId);
    const entries: WpsPayrollEntry[] = [];
    for (const emp of employees) {
      const result = toEntry(emp, period, country);
      if ("error" in result) continue; // skip invalid employees silently
      entries.push(result);
    }
    const total = entries.reduce((s, e) => s + e.totalSalaryCents, 0);
    const content =
      country === "ksa"
        ? buildSarieFile(entries, period, companyId)
        : buildCbkFile(entries, period);
    const format: "sif" | "csv" = country === "ksa" ? "sif" : "csv";
    const filename = `wps-${country}-${period}.${format === "sif" ? "sif" : "csv"}`;
    const file: WpsFile = {
      filename,
      content,
      format,
      entries,
      totalCents: total,
      country,
      period,
    };
    await persistRun(db, companyId, file);
    return file;
  }

  async function listHistory(
    companyId: string,
    opts?: { limit?: number },
  ): Promise<WpsHistoryRecord[]> {
    const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
    const rows = await db
      .select({
        id: businessEntities.id,
        data: businessEntities.data,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, WPS_MODULE_KEY),
          eq(businessEntities.entityType, WPS_ENTITY_TYPE),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit);
    const out: WpsHistoryRecord[] = [];
    for (const row of rows) {
      const data = (row.data ?? {}) as StoredWpsRun;
      out.push({
        id: row.id,
        period: data.period,
        country: data.country,
        generatedAt: data.generatedAt,
        entryCount: data.entryCount,
        totalCents: data.totalCents,
        currency: data.currency,
        filename: data.filename,
      });
    }
    return out;
  }

  return { generatePayrollFile, validateEmployeesForWps, listHistory };
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function csv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function sar(cents: number): string {
  return (cents / 100).toFixed(2);
}

function kwd(cents: number): string {
  // KWD has 3 decimal places — file stores halalas in same field as SAR
  // halalas, treating "cents" as a 2-decimal unit per the API contract.
  return (cents / 100).toFixed(3);
}
