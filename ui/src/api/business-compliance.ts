import { api } from "./client";

// ---------------------------------------------------------------------------
// ZATCA Phase 2
// ---------------------------------------------------------------------------

export type ZatcaSubmissionStatus =
  | "cleared"
  | "reported"
  | "rejected"
  | "warning";

export interface ZatcaSubmissionMessage {
  code: string;
  message: string;
}

export interface ZatcaSubmission {
  uuid: string;
  status: ZatcaSubmissionStatus;
  zatcaInvoiceNumber?: string;
  qrCode: string;
  hash: string;
  signature: string;
  signedXmlBase64: string;
  rawResponse?: unknown;
  errors?: ZatcaSubmissionMessage[];
  warnings?: ZatcaSubmissionMessage[];
  clearanceTimestamp?: string;
  mock?: boolean;
}

export interface ZatcaConfigStatus {
  certificate: string;
  baseUrl: string;
  organizationId: string;
  enabled: boolean;
  privateKeyConfigured: boolean;
  mode: "production" | "sandbox" | "mock";
}

export interface ZatcaSubmitRequest {
  invoiceId: string;
  invoiceType?: "standard" | "simplified" | "credit_note" | "debit_note";
  paymentMethod?: "cash" | "card" | "credit" | "bank_transfer";
}

export const zatcaApi = {
  configStatus: (companyId: string) =>
    api.get<ZatcaConfigStatus>(
      `/companies/${companyId}/business/zatca/config-status`,
    ),
  submit: (companyId: string, body: ZatcaSubmitRequest) =>
    api.post<ZatcaSubmission>(
      `/companies/${companyId}/business/zatca/submit`,
      body,
    ),
  listSubmissions: (companyId: string, limit?: number) =>
    api.get<{ submissions: ZatcaSubmission[] }>(
      `/companies/${companyId}/business/zatca/submissions${
        limit ? `?limit=${limit}` : ""
      }`,
    ),
  getSubmission: (companyId: string, uuid: string) =>
    api.get<ZatcaSubmission>(
      `/companies/${companyId}/business/zatca/submissions/${uuid}`,
    ),
  resubmit: (companyId: string, uuid: string) =>
    api.post<ZatcaSubmission>(
      `/companies/${companyId}/business/zatca/submissions/${uuid}/resubmit`,
      {},
    ),
};

// ---------------------------------------------------------------------------
// GOSI
// ---------------------------------------------------------------------------

export interface GosiContribution {
  employeeId: string;
  employeeName?: string;
  nationalId?: string;
  employeeNationality: "saudi" | "non_saudi";
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

export const gosiApi = {
  calculate: (companyId: string, employeeId: string, period: string) =>
    api.get<GosiContribution>(
      `/companies/${companyId}/business/gosi/calculate?employeeId=${encodeURIComponent(
        employeeId,
      )}&period=${encodeURIComponent(period)}`,
    ),
  monthlyReport: (companyId: string, period: string) =>
    api.get<GosiMonthlyReport>(
      `/companies/${companyId}/business/gosi/monthly-report?period=${encodeURIComponent(period)}`,
    ),
  exportUrl: (companyId: string, period: string) =>
    `/api/companies/${companyId}/business/gosi/export?period=${encodeURIComponent(period)}`,
};

// ---------------------------------------------------------------------------
// WPS
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

export interface WpsGenerateResponse {
  filename: string;
  format: "sif" | "csv";
  content: string;
  entries: WpsPayrollEntry[];
  totalCents: number;
  country: WpsCountry;
  period: string;
}

export interface WpsValidationResult {
  employeeId: string;
  employeeName: string;
  ready: boolean;
  missingFields: string[];
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

export const wpsApi = {
  generate: (
    companyId: string,
    body: { period: string; country: WpsCountry; download?: boolean },
  ) =>
    api.post<WpsGenerateResponse>(
      `/companies/${companyId}/business/wps/generate`,
      body,
    ),
  validateEmployees: (companyId: string, country?: WpsCountry) =>
    api.get<{ employees: WpsValidationResult[] }>(
      `/companies/${companyId}/business/wps/validate-employees${
        country ? `?country=${country}` : ""
      }`,
    ),
  history: (companyId: string, limit?: number) =>
    api.get<{ history: WpsHistoryRecord[] }>(
      `/companies/${companyId}/business/wps/history${limit ? `?limit=${limit}` : ""}`,
    ),
};
