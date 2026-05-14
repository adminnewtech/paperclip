import { api } from "./client";

export type PaymentProviderName =
  | "knet"
  | "myfatoorah"
  | "moyasar"
  | "tap"
  | "paytabs"
  | "stripe"
  | "mock";

export type PaymentChargeStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "refunded"
  | "expired";

export interface PaymentCharge {
  id: string;
  providerName: PaymentProviderName;
  providerId: string;
  amountCents: number;
  currency: string;
  status: PaymentChargeStatus;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  description?: string;
  metadata: Record<string, unknown>;
  paymentUrl?: string;
  receiptUrl?: string;
  errorMessage?: string;
  createdAt: string;
  paidAt?: string;
}

export interface ProviderDescriptor {
  name: PaymentProviderName;
  configured: boolean;
  currencies: string[];
}

export interface ListProvidersResponse {
  providers: ProviderDescriptor[];
  suggested: PaymentProviderName[];
  defaultCountry: string;
  defaultCurrency: string;
}

export interface CreateChargeRequest {
  provider: PaymentProviderName;
  amountCents: number;
  currency: string;
  description?: string;
  customer?: { name?: string; email?: string; phone?: string };
  returnUrl?: string;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
  relatedInvoiceId?: string;
}

export interface CreateChargeResponse {
  charge: PaymentCharge;
  paymentUrl?: string;
}

export const businessPaymentsApi = {
  listProviders: (companyId: string, currency?: string) => {
    const qs = currency ? `?currency=${encodeURIComponent(currency)}` : "";
    return api.get<ListProvidersResponse>(
      `/companies/${companyId}/business/payments/providers${qs}`,
    );
  },

  createCharge: (companyId: string, body: CreateChargeRequest) =>
    api.post<CreateChargeResponse>(
      `/companies/${companyId}/business/payments/charges`,
      body,
    ),

  listCharges: (
    companyId: string,
    opts?: { limit?: number; status?: string; provider?: string },
  ) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.status) params.set("status", opts.status);
    if (opts?.provider) params.set("provider", opts.provider);
    const qs = params.toString();
    return api.get<{ charges: PaymentCharge[] }>(
      `/companies/${companyId}/business/payments/charges${qs ? `?${qs}` : ""}`,
    );
  },

  getCharge: (companyId: string, id: string) =>
    api.get<{ charge: PaymentCharge; relatedInvoiceId: string | null }>(
      `/companies/${companyId}/business/payments/charges/${id}`,
    ),

  refundCharge: (companyId: string, id: string, amountCents?: number) =>
    api.post<{ charge: PaymentCharge }>(
      `/companies/${companyId}/business/payments/charges/${id}/refund`,
      amountCents !== undefined ? { amountCents } : {},
    ),
};
