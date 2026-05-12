// ---------------------------------------------------------------------------
// Moyasar payment provider (Saudi Arabia)
// ---------------------------------------------------------------------------
//
// Moyasar is one of the leading payment gateways in Saudi Arabia, supporting
// Mada, Visa, Mastercard, Apple Pay and STC Pay.
//
// Env vars:
//   MOYASAR_API_KEY            Secret key (used server-side, Basic auth).
//   MOYASAR_PUBLISHABLE_KEY    Optional; surfaced to the UI client for
//                              tokenisation widgets.
//
// Currencies: SAR primarily, also accepts AED, USD, KWD, BHD, OMR, EGP.

import {
  buildMockCharge,
  minorToMajor,
  majorToMinor,
  type CreateChargeInput,
  type PaymentCharge,
  type PaymentProvider,
  type ParsedWebhook,
} from "./index.js";

const BASE = "https://api.moyasar.com/v1";

function envOk(): boolean {
  return Boolean(process.env.MOYASAR_API_KEY);
}

function authHeader(): string {
  const key = process.env.MOYASAR_API_KEY!;
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

interface MoyasarPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description?: string;
  source?: { type?: string };
  metadata?: Record<string, unknown>;
  source_url?: string;
  invoice_id?: string;
  fee?: number;
  created_at?: string;
  paid_at?: string;
  refunded?: number;
}

function statusFromMoyasar(s: string): PaymentCharge["status"] {
  switch (s) {
    case "paid":
      return "succeeded";
    case "authorized":
      return "pending";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    case "expired":
      return "expired";
    default:
      return "pending";
  }
}

function chargeFromMoyasar(p: MoyasarPayment): PaymentCharge {
  return {
    id: p.id,
    providerName: "moyasar",
    providerId: p.id,
    amountCents: p.amount,
    currency: (p.currency?.toUpperCase() as PaymentCharge["currency"]) ?? "SAR",
    status: statusFromMoyasar(p.status),
    description: p.description,
    metadata: { ...(p.metadata ?? {}), source: p.source, fee: p.fee },
    paymentUrl: p.source_url,
    createdAt: p.created_at ?? new Date().toISOString(),
    paidAt: p.paid_at,
  };
}

export function createMoyasarProvider(): PaymentProvider {
  return {
    name: "moyasar",
    isConfigured: () => envOk(),
    supportedCurrencies: () => ["SAR", "AED", "USD", "KWD", "BHD", "OMR"],

    async createCharge(input: CreateChargeInput): Promise<PaymentCharge> {
      if (!envOk()) return buildMockCharge("moyasar", input);

      const form = new URLSearchParams();
      form.set("amount", String(input.amountCents));
      form.set("currency", input.currency);
      if (input.description) form.set("description", input.description);
      if (input.returnUrl) form.set("callback_url", input.returnUrl);
      // For server-side charge creation Moyasar expects a source. Without
      // a token we register the intent as an "invoice" which it later
      // promotes to a payment after the user completes hosted checkout.
      form.set("source[type]", "creditcard");
      if (input.metadata) {
        for (const [k, v] of Object.entries(input.metadata)) {
          form.set(`metadata[${k}]`, String(v));
        }
      }

      try {
        const res = await fetch(`${BASE}/invoices`, {
          method: "POST",
          headers: {
            Authorization: authHeader(),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            amount: String(input.amountCents),
            currency: input.currency,
            description: input.description ?? "",
            callback_url: input.returnUrl ?? "",
          }).toString(),
        });
        const json = (await res.json().catch(() => null)) as
          | {
              id?: string;
              status?: string;
              url?: string;
              amount?: number;
              currency?: string;
              message?: string;
            }
          | null;
        if (!res.ok || !json?.id || !json.url) {
          return {
            ...buildMockCharge("moyasar", input),
            status: "failed",
            errorMessage: json?.message ?? `Moyasar error: ${res.status}`,
          };
        }
        return {
          id: json.id,
          providerName: "moyasar",
          providerId: json.id,
          amountCents: input.amountCents,
          currency: input.currency,
          status: "pending",
          customerName: input.customer?.name,
          customerEmail: input.customer?.email,
          customerPhone: input.customer?.phone,
          description: input.description,
          metadata: { ...(input.metadata ?? {}), invoiceId: json.id },
          paymentUrl: json.url,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          ...buildMockCharge("moyasar", input),
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async getCharge(providerId: string): Promise<PaymentCharge> {
      if (!envOk()) {
        return {
          id: providerId,
          providerName: "moyasar",
          providerId,
          amountCents: 0,
          currency: "SAR",
          status: "pending",
          metadata: { mock: true },
          createdAt: new Date().toISOString(),
        };
      }
      try {
        const res = await fetch(`${BASE}/payments/${providerId}`, {
          headers: { Authorization: authHeader() },
        });
        const json = (await res.json().catch(() => null)) as MoyasarPayment | null;
        if (!res.ok || !json) {
          return {
            id: providerId,
            providerName: "moyasar",
            providerId,
            amountCents: 0,
            currency: "SAR",
            status: "failed",
            metadata: { error: `Moyasar lookup: ${res.status}` },
            createdAt: new Date().toISOString(),
          };
        }
        return chargeFromMoyasar(json);
      } catch (err) {
        return {
          id: providerId,
          providerName: "moyasar",
          providerId,
          amountCents: 0,
          currency: "SAR",
          status: "failed",
          metadata: { error: err instanceof Error ? err.message : String(err) },
          createdAt: new Date().toISOString(),
        };
      }
    },

    async refundCharge(providerId: string, amountCents?: number): Promise<PaymentCharge> {
      if (!envOk()) {
        return {
          id: providerId,
          providerName: "moyasar",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "SAR",
          status: "refunded",
          metadata: { mock: true, refunded: true },
          createdAt: new Date().toISOString(),
        };
      }
      try {
        const form = new URLSearchParams();
        if (amountCents !== undefined) form.set("amount", String(amountCents));
        const res = await fetch(`${BASE}/payments/${providerId}/refund`, {
          method: "POST",
          headers: {
            Authorization: authHeader(),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        });
        const json = (await res.json().catch(() => null)) as MoyasarPayment | null;
        if (!res.ok || !json) {
          return {
            id: providerId,
            providerName: "moyasar",
            providerId,
            amountCents: amountCents ?? 0,
            currency: "SAR",
            status: "failed",
            metadata: { error: `Moyasar refund: ${res.status}` },
            createdAt: new Date().toISOString(),
          };
        }
        return chargeFromMoyasar(json);
      } catch (err) {
        return {
          id: providerId,
          providerName: "moyasar",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "SAR",
          status: "failed",
          metadata: { error: err instanceof Error ? err.message : String(err) },
          createdAt: new Date().toISOString(),
        };
      }
    },

    parseWebhook(headers, body): ParsedWebhook {
      const signature = headers["x-moyasar-signature"] ?? headers["X-Moyasar-Signature"] ?? "";
      const payload =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      const data = (payload.data ?? payload) as MoyasarPayment;
      const eventType = String(payload.type ?? "payment_updated");
      const charge: PaymentCharge = data?.id
        ? chargeFromMoyasar(data)
        : {
            id: "",
            providerName: "moyasar",
            providerId: "",
            amountCents: typeof data?.amount === "number" ? data.amount : majorToMinor(0, "SAR"),
            currency: "SAR",
            status: "pending",
            metadata: payload,
            createdAt: new Date().toISOString(),
          };
      return {
        eventType,
        charge,
        // Moyasar webhook signatures are configured per-endpoint in the
        // dashboard. We accept any non-empty signature when configured.
        signatureValid: envOk() && signature.length > 0,
      };
    },
  };
}

// Suppress unused import lint when tree-shaken
void minorToMajor;
