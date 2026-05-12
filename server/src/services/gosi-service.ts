/**
 * GOSI (Saudi General Organization for Social Insurance) service.
 *
 * Calculates monthly GOSI contributions for an employer's workforce and
 * generates the monthly contribution file accepted by GOSI's SAMA-compatible
 * upload format.
 *
 * Employees are stored as `businessEntities` with moduleKey="hr" and
 * entityType="employee". The relevant fields we read from `data`:
 *   - `nationality`            : "saudi" | "non_saudi" (string)
 *   - `monthlyBasicSalaryCents`: number (halalas)
 *   - `monthlyHousingCents`    : number (halalas)
 *   - `nationalId`             : string (10-digit Saudi national ID)
 *   - `iban`                   : string (SA IBAN)
 *   - `gosiRegistrationStatus` : "registered" | "pending" | "not_required"
 *
 * Outputs are stored back into `businessEntities` with moduleKey="gosi" so
 * that prior months are auditable.
 *
 * Environment variables: none. (Future: ZATCA-style GOSI API integration —
 * GOSI exposes a "Mudad" API for payroll, gated behind production keys.)
 */

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  clampGosiContributoryWageCents,
  getGosiRates,
  type GosiNationality,
} from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GosiContribution {
  employeeId: string;
  employeeName?: string;
  nationalId?: string;
  employeeNationality: GosiNationality;
  monthlyBasicSalaryCents: number;
  monthlyHousingCents: number;
  contributoryWageCents: number;
  employeeContributionPercent: number;
  employerContributionPercent: number;
  employeeContributionCents: number;
  employerContributionCents: number;
  totalContributionCents: number;
  period: string;
}

export interface GosiMonthlyReport {
  period: string;
  employees: GosiContribution[];
  totalEmployerCents: number;
  totalEmployeeCents: number;
  grandTotalCents: number;
  saudiCount: number;
  nonSaudiCount: number;
}

export interface GosiCalculationInput {
  employeeId: string;
  employeeName?: string;
  nationalId?: string;
  nationality: GosiNationality;
  basicSalaryCents: number;
  housingCents: number;
  period: string;
}

export interface GosiFile {
  filename: string;
  content: string;
  format: "csv" | "txt";
}

export interface GosiService {
  calculateContribution(input: GosiCalculationInput): GosiContribution;
  generateMonthlyReport(
    companyId: string,
    period: string,
  ): Promise<GosiMonthlyReport>;
  generateGosiFile(companyId: string, period: string): Promise<GosiFile>;
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

const PERIOD_RE = /^\d{4}-\d{2}$/;

function isValidPeriod(period: string): boolean {
  if (!PERIOD_RE.test(period)) return false;
  const [yStr, mStr] = period.split("-");
  const m = Number(mStr);
  const y = Number(yStr);
  if (m < 1 || m > 12) return false;
  if (y < 2000 || y > 2100) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Employee loading
// ---------------------------------------------------------------------------

interface EmployeeRow {
  id: string;
  name?: string;
  nationality: GosiNationality;
  basicSalaryCents: number;
  housingCents: number;
  nationalId?: string;
}

interface EmployeeData {
  nationality?: string;
  monthlyBasicSalaryCents?: number;
  monthlyHousingCents?: number;
  nationalId?: string;
  gosiRegistrationStatus?: string;
}

function rowToEmployee(row: {
  id: string;
  name: string | null;
  data: unknown;
}): EmployeeRow | null {
  const data = (row.data ?? {}) as EmployeeData;
  const nat = data.nationality;
  const nationality: GosiNationality =
    nat === "saudi" || nat === "non_saudi" ? nat : "non_saudi";
  const basicSalaryCents =
    typeof data.monthlyBasicSalaryCents === "number"
      ? data.monthlyBasicSalaryCents
      : 0;
  const housingCents =
    typeof data.monthlyHousingCents === "number"
      ? data.monthlyHousingCents
      : 0;
  if (basicSalaryCents <= 0) return null;
  return {
    id: row.id,
    name: row.name ?? undefined,
    nationality,
    basicSalaryCents,
    housingCents,
    nationalId:
      typeof data.nationalId === "string" ? data.nationalId : undefined,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createGosiService(db: Db): GosiService {
  function calculateContribution(input: GosiCalculationInput): GosiContribution {
    const rates = getGosiRates(input.nationality);
    const wage = clampGosiContributoryWageCents(
      input.basicSalaryCents + input.housingCents,
    );
    const employeeContributionCents = Math.round(wage * rates.employeePercent);
    const employerContributionCents = Math.round(wage * rates.employerPercent);
    return {
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      nationalId: input.nationalId,
      employeeNationality: input.nationality,
      monthlyBasicSalaryCents: input.basicSalaryCents,
      monthlyHousingCents: input.housingCents,
      contributoryWageCents: wage,
      employeeContributionPercent: rates.employeePercent * 100,
      employerContributionPercent: rates.employerPercent * 100,
      employeeContributionCents,
      employerContributionCents,
      totalContributionCents:
        employeeContributionCents + employerContributionCents,
      period: input.period,
    };
  }

  async function loadEmployees(companyId: string): Promise<EmployeeRow[]> {
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
    const out: EmployeeRow[] = [];
    for (const row of rows) {
      const emp = rowToEmployee(row);
      if (emp) out.push(emp);
    }
    return out;
  }

  async function generateMonthlyReport(
    companyId: string,
    period: string,
  ): Promise<GosiMonthlyReport> {
    if (!isValidPeriod(period)) {
      throw new Error(`Invalid GOSI period "${period}" (expected YYYY-MM)`);
    }
    const employees = await loadEmployees(companyId);
    const contributions: GosiContribution[] = [];
    let totalEmployer = 0;
    let totalEmployee = 0;
    let saudiCount = 0;
    let nonSaudiCount = 0;
    for (const emp of employees) {
      const c = calculateContribution({
        employeeId: emp.id,
        employeeName: emp.name,
        nationalId: emp.nationalId,
        nationality: emp.nationality,
        basicSalaryCents: emp.basicSalaryCents,
        housingCents: emp.housingCents,
        period,
      });
      contributions.push(c);
      totalEmployer += c.employerContributionCents;
      totalEmployee += c.employeeContributionCents;
      if (emp.nationality === "saudi") saudiCount++;
      else nonSaudiCount++;
    }
    return {
      period,
      employees: contributions,
      totalEmployerCents: totalEmployer,
      totalEmployeeCents: totalEmployee,
      grandTotalCents: totalEmployer + totalEmployee,
      saudiCount,
      nonSaudiCount,
    };
  }

  async function generateGosiFile(
    companyId: string,
    period: string,
  ): Promise<GosiFile> {
    const report = await generateMonthlyReport(companyId, period);
    // GOSI's SAMA-compatible upload is a CSV with a fixed column order:
    //   National ID, Employee Name, Nationality, Basic Salary, Housing,
    //   Contributory Wage, Employee Contribution, Employer Contribution,
    //   Period
    const header = [
      "National ID",
      "Employee Name",
      "Nationality",
      "Basic Salary (SAR)",
      "Housing (SAR)",
      "Contributory Wage (SAR)",
      "Employee Contribution (SAR)",
      "Employer Contribution (SAR)",
      "Period",
    ].join(",");
    const lines = report.employees.map((c) =>
      [
        csvField(c.nationalId ?? ""),
        csvField(c.employeeName ?? c.employeeId),
        c.employeeNationality === "saudi" ? "Saudi" : "Non-Saudi",
        formatSar(c.monthlyBasicSalaryCents),
        formatSar(c.monthlyHousingCents),
        formatSar(c.contributoryWageCents),
        formatSar(c.employeeContributionCents),
        formatSar(c.employerContributionCents),
        c.period,
      ].join(","),
    );
    const footer = [
      "",
      `Total Employees,${report.employees.length}`,
      `Saudi Employees,${report.saudiCount}`,
      `Non-Saudi Employees,${report.nonSaudiCount}`,
      `Total Employee Contributions (SAR),${formatSar(report.totalEmployeeCents)}`,
      `Total Employer Contributions (SAR),${formatSar(report.totalEmployerCents)}`,
      `Grand Total (SAR),${formatSar(report.grandTotalCents)}`,
    ].join("\n");
    const content = [header, ...lines, footer].join("\n");
    return {
      filename: `gosi-${period}.csv`,
      content,
      format: "csv",
    };
  }

  return { calculateContribution, generateMonthlyReport, generateGosiFile };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function csvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatSar(cents: number): string {
  return (cents / 100).toFixed(2);
}
