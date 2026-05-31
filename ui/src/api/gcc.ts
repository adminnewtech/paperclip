import { api } from "./client";

export interface TaxRegistrationRow {
  id: string;
  companyId: string;
  country: string | null;
  vatNumber: string | null;
  registered: boolean;
  vatRateBps: number;
  scheme: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EInvoiceRow {
  id: string;
  companyId: string;
  invoiceId: string | null;
  uuidValue: string | null;
  invoiceHash: string | null;
  previousHash: string | null;
  qrCode: string | null;
  signedXml: string | null;
  invoiceKind: string | null;
  zatcaStatus: string | null;
  submittedAt: string | null;
  clearedAt: string | null;
  errorCode: string | null;
  totalMinor: number;
  vatMinor: number;
  currency: string | null;
  seq: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentGatewayRow {
  id: string;
  companyId: string;
  provider: string | null;
  enabled: boolean;
  mode: string | null;
  config: Record<string, unknown>;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VatReturnResult {
  country: string;
  outputVatMinor: number;
  inputVatMinor: number;
  netVatDueMinor: number;
}

export interface TaxRegistrationInput {
  country: string;
  vatNumber?: string | null;
  registered?: boolean;
  vatRateBps?: number;
  scheme?: string;
}

export interface GatewayInput {
  provider: string;
  enabled?: boolean;
  mode?: string;
  config?: Record<string, unknown>;
  displayName?: string | null;
}

export const gccApi = {
  // Tax registration
  getTaxRegistration: (companyId: string, country?: string) => {
    const qs = country ? `?country=${encodeURIComponent(country)}` : "";
    return api.get<{ registration: TaxRegistrationRow | null }>(
      `/companies/${companyId}/gcc/tax-registration${qs}`,
    );
  },
  upsertTaxRegistration: (companyId: string, body: TaxRegistrationInput) =>
    api.post<TaxRegistrationRow>(
      `/companies/${companyId}/gcc/tax-registration`,
      body,
    ),

  // E-invoicing
  listEInvoices: (companyId: string) =>
    api.get<{ einvoices: EInvoiceRow[] }>(
      `/companies/${companyId}/gcc/einvoices`,
    ),
  issueEInvoice: (
    companyId: string,
    body: { invoiceId: string; mode?: string },
  ) =>
    api.post<EInvoiceRow>(
      `/companies/${companyId}/gcc/einvoices/issue`,
      body,
    ),

  // VAT return
  vatReturn: (companyId: string, country: string) =>
    api.get<VatReturnResult>(
      `/companies/${companyId}/gcc/vat-return?country=${encodeURIComponent(country)}`,
    ),

  // Payment gateways
  listGateways: (companyId: string) =>
    api.get<{ gateways: PaymentGatewayRow[] }>(
      `/companies/${companyId}/gcc/payment-gateways`,
    ),
  upsertGateway: (companyId: string, body: GatewayInput) =>
    api.post<PaymentGatewayRow>(
      `/companies/${companyId}/gcc/payment-gateways`,
      body,
    ),
  paymentOptions: (companyId: string, country: string) =>
    api.get<{ country: string; providers: string[] }>(
      `/companies/${companyId}/gcc/payment-options?country=${encodeURIComponent(country)}`,
    ),
};
