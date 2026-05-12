// ---------------------------------------------------------------------------
// PayTabs payment provider (UAE / Saudi)
// ---------------------------------------------------------------------------
//
// PayTabs is a UAE-headquartered acquirer that processes payments across MENA.
//
// Env vars:
//   PAYTABS_PROFILE_ID    Numeric merchant profile id.
//   PAYTABS_SERVER_KEY    Server key for Authorization header.
//   PAYTABS_REGION        Optional; "ARE" | "SAU" | "EGY" | "GLOBAL".
//                         Defaults to "ARE" (UAE).
//
// Currencies: AED, SAR, OMR, JOD, EGP, USD.

import {
  buildMockCharge,
  minorToMajor,
  majorToMinor,
  type CreateChargeInput,
  type PaymentCharge,
  type PaymentProvider,
  type ParsedWebhook,
} from "./index.js";

function regionBase(): string {
  const r = (process.env.PAYTABS_REGION ?? "ARE").toUpperCase();
  switch (r) {
    case "SAU":
      return "https://secure.paytabs.sa";
    case "EGY":
      return "https://secure-egypt.paytabs.com";
    case "JOR":
      return "https://secure-jordan.paytabs.com";
    case "GLOBAL":
      return "https://secure-global.paytabs.com";
    case "ARE":
    default:
      return "https://secure.paytabs.com";
  }
}

function envOk(): boolean {
  return Boolean(process.env.PAYTABS_PROFILE_ID && process.env.PAYTABS_SERVER_KEY);
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: process.env.PAYTABS_SERVER_KEY!,
    "Content-Type": "application/json",
  };
}

interface PayTabsCreateResponse {
  tran_ref?: string;
  redirect_url?: string;
  payment_url?: string;
  cart_id?: string;
  message?: string;
}

interface PayTabsQueryResponse {
  tran_ref?: string;
  payment_result?: { response_status?: string; response_message?: string };
  cart_amount?: number | string;
  cart_currency?: string;
  customer_details?: { name?: string; email?: string; phone?: string };
  reference_id?: string;
}

function statusFromPayTabs(s?: string): PaymentCharge["status"] {
  switch ((s ?? "").toUpperCase()) {
    case "A":
    case "APPROVED":
      return "succeeded";
    case "D":
    case "DECLINED":
    case "FAILED":
      return "failed";
    case "E":
    case "EXPIRED":
      return "expired";
    case "R":
    case "REFUNDED":
      return "refunded";
    case "H":
    case "P":
    case "PENDING":
    default:
      return "pending";
  }
}

export function createPayTabsProvider(): PaymentProvider {
  return {
    name: "paytabs",
    isConfigured: () => envOk(),
    supportedCurrencies: () => ["AED", "SAR", "OMR", "USD"],

    async createCharge(input: CreateChargeInput): Promise<PaymentCharge> {
      if (!envOk()) return buildMockCharge("paytabs", input);
      const payload = {
        profile_id: Number(process.env.PAYTABS_PROFILE_ID!),
        tran_type: "sale",
        tran_class: "ecom",
        cart_id:
          (input.metadata?.invoiceId as string | undefined) ??
          `cart-${Date.now()}`,
        cart_description: input.description ?? "Order",
        cart_currency: input.currency,
        cart_amount: Number(minorToMajor(input.amountCents, input.currency)),
        callback: input.webhookUrl ?? "",
        return: input.returnUrl ?? "",
        customer_details: {
          name: input.customer?.name ?? "Customer",
          email: input.customer?.email ?? "noreply@example.com",
          phone: input.customer?.phone ?? "",
        },
      };
      try {
        const res = await fetch(`${regionBase()}/payment/request`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(payload),
        });
        const json = (await res.json().catch(() => null)) as PayTabsCreateResponse | null;
        if (!res.ok || !json?.tran_ref) {
          return {
            ...buildMockCharge("paytabs", input),
            status: "failed",
            errorMessage: json?.message ?? `PayTabs error: ${res.status}`,
          };
        }
        return {
          id: json.tran_ref,
          providerName: "paytabs",
          providerId: json.tran_ref,
          amountCents: input.amountCents,
          currency: input.currency,
          status: "pending",
          customerName: input.customer?.name,
          customerEmail: input.customer?.email,
          customerPhone: input.customer?.phone,
          description: input.description,
          metadata: { ...(input.metadata ?? {}), cartId: payload.cart_id },
          paymentUrl: json.redirect_url ?? json.payment_url,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          ...buildMockCharge("paytabs", input),
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async getCharge(providerId: string): Promise<PaymentCharge> {
      if (!envOk()) {
        return {
          id: providerId,
          providerName: "paytabs",
          providerId,
          amountCents: 0,
          currency: "AED",
          status: "pending",
          metadata: { mock: true },
          createdAt: new Date().toISOString(),
        };
      }
      try {
        const res = await fetch(`${regionBase()}/payment/query`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            profile_id: Number(process.env.PAYTABS_PROFILE_ID!),
            tran_ref: providerId,
          }),
        });
        const json = (await res.json().catch(() => null)) as PayTabsQueryResponse | null;
        if (!res.ok || !json) {
          return {
            id: providerId,
            providerName: "paytabs",
            providerId,
            amountCents: 0,
            currency: "AED",
            status: "failed",
            metadata: { error: `PayTabs query: ${res.status}` },
            createdAt: new Date().toISOString(),
          };
        }
        const currency = (json.cart_currency?.toUpperCase() as "AED") ?? "AED";
        const amount = typeof json.cart_amount === "string"
          ? Number(json.cart_amount)
          : (json.cart_amount ?? 0);
        return {
          id: providerId,
          providerName: "paytabs",
          providerId,
          amountCents: majorToMinor(amount, currency),
          currency,
          status: statusFromPayTabs(json.payment_result?.response_status),
          customerName: json.customer_details?.name,
          customerEmail: json.customer_details?.email,
          customerPhone: json.customer_details?.phone,
          metadata: { ...json },
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          id: providerId,
          providerName: "paytabs",
          providerId,
          amountCents: 0,
          currency: "AED",
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
          providerName: "paytabs",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "AED",
          status: "refunded",
          metadata: { mock: true, refunded: true },
          createdAt: new Date().toISOString(),
        };
      }
      try {
        const res = await fetch(`${regionBase()}/payment/request`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            profile_id: Number(process.env.PAYTABS_PROFILE_ID!),
            tran_type: "refund",
            tran_class: "ecom",
            cart_id: `refund-${Date.now()}`,
            cart_description: "Merchant refund",
            cart_currency: "AED",
            cart_amount: amountCents !== undefined ? Number(minorToMajor(amountCents, "AED")) : 0,
            tran_ref: providerId,
          }),
        });
        const json = (await res.json().catch(() => null)) as PayTabsCreateResponse | null;
        return {
          id: providerId,
          providerName: "paytabs",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "AED",
          status: res.ok && json?.tran_ref ? "refunded" : "failed",
          metadata: { refundResponse: json },
          errorMessage: json?.message,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          id: providerId,
          providerName: "paytabs",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "AED",
          status: "failed",
          metadata: { error: err instanceof Error ? err.message : String(err) },
          createdAt: new Date().toISOString(),
        };
      }
    },

    parseWebhook(headers, body): ParsedWebhook {
      const signature = headers["signature"] ?? headers["Signature"] ?? "";
      const payload =
        typeof body === "object" && body !== null
          ? (body as PayTabsQueryResponse & Record<string, unknown>)
          : {};
      const currency = (payload.cart_currency?.toUpperCase() as "AED") ?? "AED";
      const amount = typeof payload.cart_amount === "string"
        ? Number(payload.cart_amount)
        : (payload.cart_amount ?? 0);
      const status = statusFromPayTabs(payload.payment_result?.response_status);
      const charge: PaymentCharge = {
        id: String(payload.tran_ref ?? ""),
        providerName: "paytabs",
        providerId: String(payload.tran_ref ?? ""),
        amountCents: majorToMinor(amount, currency),
        currency,
        status,
        metadata: payload as Record<string, unknown>,
        createdAt: new Date().toISOString(),
        paidAt: status === "succeeded" ? new Date().toISOString() : undefined,
      };
      return {
        eventType: `paytabs.${status}`,
        charge,
        signatureValid: envOk() && signature.length > 0,
      };
    },
  };
}
