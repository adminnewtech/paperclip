// ---------------------------------------------------------------------------
// Tap Payments provider (Saudi / Kuwait / UAE)
// ---------------------------------------------------------------------------
//
// Tap (tap.company) is a regional payment gateway popular across GCC,
// supporting KNET, Mada, Benefit, Visa, Mastercard, Apple Pay, Google Pay.
//
// Env vars:
//   TAP_SECRET_KEY         Server-side secret key (starts with sk_test_ / sk_live_).
//   TAP_PUBLISHABLE_KEY    Optional; surfaced to client widgets.
//
// Currencies: SAR, KWD, AED, BHD, OMR, QAR, USD.

import {
  buildMockCharge,
  minorToMajor,
  majorToMinor,
  type CreateChargeInput,
  type PaymentCharge,
  type PaymentProvider,
  type ParsedWebhook,
} from "./index.js";

const BASE = "https://api.tap.company/v2";

function envOk(): boolean {
  return Boolean(process.env.TAP_SECRET_KEY);
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.TAP_SECRET_KEY!}`,
    "Content-Type": "application/json",
  };
}

interface TapCharge {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description?: string;
  customer?: { first_name?: string; email?: string; phone?: { number?: string } };
  transaction?: { url?: string; expiry?: { period?: number; type?: string } };
  receipt?: { id?: string };
  metadata?: Record<string, unknown>;
  reference?: { order?: string };
}

function statusFromTap(s: string): PaymentCharge["status"] {
  switch (s.toUpperCase()) {
    case "CAPTURED":
    case "SUCCEEDED":
    case "AUTHORIZED":
      return "succeeded";
    case "INITIATED":
    case "IN_PROGRESS":
      return "pending";
    case "FAILED":
    case "DECLINED":
    case "ABANDONED":
    case "CANCELLED":
      return "failed";
    case "REFUNDED":
      return "refunded";
    case "EXPIRED":
    case "TIMEDOUT":
      return "expired";
    default:
      return "pending";
  }
}

function chargeFromTap(t: TapCharge): PaymentCharge {
  return {
    id: t.id,
    providerName: "tap",
    providerId: t.id,
    amountCents: majorToMinor(t.amount, (t.currency?.toUpperCase() as "KWD") ?? "KWD"),
    currency: (t.currency?.toUpperCase() as PaymentCharge["currency"]) ?? "KWD",
    status: statusFromTap(t.status ?? ""),
    customerName: t.customer?.first_name,
    customerEmail: t.customer?.email,
    customerPhone: t.customer?.phone?.number,
    description: t.description,
    metadata: { ...(t.metadata ?? {}), receipt: t.receipt },
    paymentUrl: t.transaction?.url,
    createdAt: new Date().toISOString(),
  };
}

export function createTapProvider(): PaymentProvider {
  return {
    name: "tap",
    isConfigured: () => envOk(),
    supportedCurrencies: () => ["SAR", "KWD", "AED", "BHD", "OMR", "QAR", "USD"],

    async createCharge(input: CreateChargeInput): Promise<PaymentCharge> {
      if (!envOk()) return buildMockCharge("tap", input);
      const payload = {
        amount: Number(minorToMajor(input.amountCents, input.currency)),
        currency: input.currency,
        description: input.description ?? "",
        statement_descriptor: "Paperclip",
        reference: {
          transaction: input.metadata?.transactionId
            ? String(input.metadata.transactionId)
            : undefined,
          order: input.metadata?.invoiceId
            ? String(input.metadata.invoiceId)
            : undefined,
        },
        receipt: { email: true, sms: true },
        customer: {
          first_name: input.customer?.name ?? "Customer",
          email: input.customer?.email,
          phone: input.customer?.phone
            ? {
                country_code: input.customer.phone.startsWith("+") ? input.customer.phone.slice(1, 4) : "965",
                number: input.customer.phone.replace(/^\+/, "").replace(/^\d{3}/, ""),
              }
            : undefined,
        },
        source: { id: "src_all" },
        post: input.webhookUrl ? { url: input.webhookUrl } : undefined,
        redirect: input.returnUrl ? { url: input.returnUrl } : undefined,
        metadata: input.metadata ?? {},
      };
      try {
        const res = await fetch(`${BASE}/charges`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(payload),
        });
        const json = (await res.json().catch(() => null)) as
          | (TapCharge & { errors?: Array<{ description?: string }> })
          | null;
        if (!res.ok || !json?.id) {
          return {
            ...buildMockCharge("tap", input),
            status: "failed",
            errorMessage:
              json?.errors?.[0]?.description ?? `Tap error: ${res.status}`,
          };
        }
        return chargeFromTap(json);
      } catch (err) {
        return {
          ...buildMockCharge("tap", input),
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async getCharge(providerId: string): Promise<PaymentCharge> {
      if (!envOk()) {
        return {
          id: providerId,
          providerName: "tap",
          providerId,
          amountCents: 0,
          currency: "KWD",
          status: "pending",
          metadata: { mock: true },
          createdAt: new Date().toISOString(),
        };
      }
      try {
        const res = await fetch(`${BASE}/charges/${providerId}`, {
          headers: authHeaders(),
        });
        const json = (await res.json().catch(() => null)) as TapCharge | null;
        if (!res.ok || !json) {
          return {
            id: providerId,
            providerName: "tap",
            providerId,
            amountCents: 0,
            currency: "KWD",
            status: "failed",
            metadata: { error: `Tap lookup: ${res.status}` },
            createdAt: new Date().toISOString(),
          };
        }
        return chargeFromTap(json);
      } catch (err) {
        return {
          id: providerId,
          providerName: "tap",
          providerId,
          amountCents: 0,
          currency: "KWD",
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
          providerName: "tap",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "KWD",
          status: "refunded",
          metadata: { mock: true, refunded: true },
          createdAt: new Date().toISOString(),
        };
      }
      try {
        const body = {
          charge_id: providerId,
          amount: amountCents !== undefined ? Number(minorToMajor(amountCents, "KWD")) : undefined,
          currency: "KWD",
          reason: "requested_by_customer",
        };
        const res = await fetch(`${BASE}/refunds`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as TapCharge | null;
        if (!res.ok || !json) {
          return {
            id: providerId,
            providerName: "tap",
            providerId,
            amountCents: amountCents ?? 0,
            currency: "KWD",
            status: "failed",
            metadata: { error: `Tap refund: ${res.status}` },
            createdAt: new Date().toISOString(),
          };
        }
        return { ...chargeFromTap(json), status: "refunded" };
      } catch (err) {
        return {
          id: providerId,
          providerName: "tap",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "KWD",
          status: "failed",
          metadata: { error: err instanceof Error ? err.message : String(err) },
          createdAt: new Date().toISOString(),
        };
      }
    },

    parseWebhook(headers, body): ParsedWebhook {
      const signature = headers["hashstring"] ?? headers["HashString"] ?? "";
      const payload: TapCharge =
        typeof body === "object" && body !== null
          ? (body as TapCharge)
          : ({} as TapCharge);
      const charge = payload.id
        ? chargeFromTap(payload)
        : {
            id: "",
            providerName: "tap" as const,
            providerId: "",
            amountCents: 0,
            currency: "KWD" as const,
            status: "pending" as const,
            metadata: { ...(payload as unknown as Record<string, unknown>) },
            createdAt: new Date().toISOString(),
          };
      return {
        eventType: `tap.${(payload.status ?? "event").toString().toLowerCase()}`,
        charge,
        signatureValid: envOk() && signature.length > 0,
      };
    },
  };
}
