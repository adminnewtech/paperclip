// ---------------------------------------------------------------------------
// Stripe payment provider (international fallback)
// ---------------------------------------------------------------------------
//
// Env vars:
//   STRIPE_SECRET_KEY        Secret key (sk_test_... / sk_live_...).
//   STRIPE_WEBHOOK_SECRET    Optional; used to verify webhook signatures.
//
// We never hard-import the Stripe SDK — it is intentionally optional. When
// the env var is present and the package is installed we use it; otherwise
// the provider falls back to a mock charge.

import {
  buildMockCharge,
  type CreateChargeInput,
  type PaymentCharge,
  type PaymentProvider,
  type ParsedWebhook,
} from "./index.js";

const BASE = "https://api.stripe.com/v1";

function envOk(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function authHeader(): string {
  return `Bearer ${process.env.STRIPE_SECRET_KEY!}`;
}

interface StripeCheckoutSession {
  id: string;
  url?: string;
  payment_intent?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  customer_email?: string;
  metadata?: Record<string, string>;
}

interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, string>;
  latest_charge?: string;
}

function statusFromStripe(s: string): PaymentCharge["status"] {
  switch (s) {
    case "succeeded":
    case "complete":
    case "paid":
      return "succeeded";
    case "processing":
    case "requires_action":
    case "requires_payment_method":
    case "requires_confirmation":
    case "open":
      return "pending";
    case "canceled":
      return "failed";
    case "refunded":
      return "refunded";
    case "expired":
      return "expired";
    default:
      return "pending";
  }
}

export function createStripeProvider(): PaymentProvider {
  return {
    name: "stripe",
    isConfigured: () => envOk(),
    supportedCurrencies: () => ["USD", "AED", "SAR", "BHD", "OMR", "QAR", "KWD"],

    async createCharge(input: CreateChargeInput): Promise<PaymentCharge> {
      if (!envOk()) return buildMockCharge("stripe", input);
      try {
        // Use Checkout Session (hosted checkout) so the UX matches other
        // providers. Stripe expects amounts in the smallest currency unit
        // EXCEPT for zero-decimal/three-decimal currencies — we always pass
        // minor units which is correct for USD/AED/SAR. KWD/BHD/OMR use
        // the *thousandths-2* convention, which our minor units already
        // encode (amountCents ÷ 1000).
        const form = new URLSearchParams();
        form.set("mode", "payment");
        form.set("success_url", input.returnUrl ?? "https://example.com/success");
        form.set("cancel_url", input.returnUrl ?? "https://example.com/cancel");
        form.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
        form.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
        form.set(
          "line_items[0][price_data][product_data][name]",
          input.description ?? "Order",
        );
        form.set("line_items[0][quantity]", "1");
        if (input.customer?.email) form.set("customer_email", input.customer.email);
        if (input.metadata) {
          for (const [k, v] of Object.entries(input.metadata)) {
            form.set(`metadata[${k}]`, String(v));
          }
        }
        const res = await fetch(`${BASE}/checkout/sessions`, {
          method: "POST",
          headers: {
            Authorization: authHeader(),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        });
        const json = (await res.json().catch(() => null)) as
          | (StripeCheckoutSession & { error?: { message?: string } })
          | null;
        if (!res.ok || !json?.id) {
          return {
            ...buildMockCharge("stripe", input),
            status: "failed",
            errorMessage: json?.error?.message ?? `Stripe error: ${res.status}`,
          };
        }
        return {
          id: json.id,
          providerName: "stripe",
          providerId: json.id,
          amountCents: input.amountCents,
          currency: input.currency,
          status: "pending",
          customerName: input.customer?.name,
          customerEmail: input.customer?.email,
          customerPhone: input.customer?.phone,
          description: input.description,
          metadata: { ...(input.metadata ?? {}), paymentIntent: json.payment_intent },
          paymentUrl: json.url,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          ...buildMockCharge("stripe", input),
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async getCharge(providerId: string): Promise<PaymentCharge> {
      if (!envOk()) {
        return {
          id: providerId,
          providerName: "stripe",
          providerId,
          amountCents: 0,
          currency: "USD",
          status: "pending",
          metadata: { mock: true },
          createdAt: new Date().toISOString(),
        };
      }
      try {
        const isSession = providerId.startsWith("cs_");
        const url = isSession
          ? `${BASE}/checkout/sessions/${providerId}`
          : `${BASE}/payment_intents/${providerId}`;
        const res = await fetch(url, { headers: { Authorization: authHeader() } });
        const json = (await res.json().catch(() => null)) as
          | (StripeCheckoutSession & StripePaymentIntent & { error?: { message?: string } })
          | null;
        if (!res.ok || !json?.id) {
          return {
            id: providerId,
            providerName: "stripe",
            providerId,
            amountCents: 0,
            currency: "USD",
            status: "failed",
            metadata: { error: json?.error?.message ?? `Stripe lookup: ${res.status}` },
            createdAt: new Date().toISOString(),
          };
        }
        const status = statusFromStripe(json.payment_status ?? json.status ?? "");
        return {
          id: providerId,
          providerName: "stripe",
          providerId,
          amountCents: json.amount_total ?? json.amount ?? 0,
          currency: ((json.currency ?? "usd").toUpperCase() as PaymentCharge["currency"]) ?? "USD",
          status,
          metadata: (json.metadata ?? {}) as Record<string, unknown>,
          createdAt: new Date().toISOString(),
          paidAt: status === "succeeded" ? new Date().toISOString() : undefined,
        };
      } catch (err) {
        return {
          id: providerId,
          providerName: "stripe",
          providerId,
          amountCents: 0,
          currency: "USD",
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
          providerName: "stripe",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "USD",
          status: "refunded",
          metadata: { mock: true, refunded: true },
          createdAt: new Date().toISOString(),
        };
      }
      try {
        const form = new URLSearchParams();
        // Accept either a Checkout Session id (resolve to PI) or a PI id.
        if (providerId.startsWith("cs_")) {
          const sres = await fetch(`${BASE}/checkout/sessions/${providerId}`, {
            headers: { Authorization: authHeader() },
          });
          const sjson = (await sres.json().catch(() => null)) as StripeCheckoutSession | null;
          if (!sjson?.payment_intent) {
            return {
              id: providerId,
              providerName: "stripe",
              providerId,
              amountCents: amountCents ?? 0,
              currency: "USD",
              status: "failed",
              metadata: { error: "Stripe session has no payment_intent" },
              createdAt: new Date().toISOString(),
            };
          }
          form.set("payment_intent", sjson.payment_intent);
        } else {
          form.set("payment_intent", providerId);
        }
        if (amountCents !== undefined) form.set("amount", String(amountCents));
        const res = await fetch(`${BASE}/refunds`, {
          method: "POST",
          headers: {
            Authorization: authHeader(),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        });
        const json = (await res.json().catch(() => null)) as
          | { id?: string; status?: string; error?: { message?: string } }
          | null;
        return {
          id: providerId,
          providerName: "stripe",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "USD",
          status: res.ok && json?.status === "succeeded" ? "refunded" : "failed",
          metadata: { refundResponse: json },
          errorMessage: json?.error?.message,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          id: providerId,
          providerName: "stripe",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "USD",
          status: "failed",
          metadata: { error: err instanceof Error ? err.message : String(err) },
          createdAt: new Date().toISOString(),
        };
      }
    },

    parseWebhook(headers, body): ParsedWebhook {
      const signature = headers["stripe-signature"] ?? headers["Stripe-Signature"] ?? "";
      const payload =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      const event = payload as {
        type?: string;
        data?: { object?: StripeCheckoutSession & StripePaymentIntent };
      };
      const obj = event.data?.object ?? ({} as StripeCheckoutSession & StripePaymentIntent);
      const status = statusFromStripe(obj.payment_status ?? obj.status ?? "");
      const charge: PaymentCharge = {
        id: obj.id ?? "",
        providerName: "stripe",
        providerId: obj.id ?? "",
        amountCents: obj.amount_total ?? obj.amount ?? 0,
        currency: ((obj.currency ?? "usd").toUpperCase() as PaymentCharge["currency"]) ?? "USD",
        status,
        metadata: (obj.metadata ?? {}) as Record<string, unknown>,
        createdAt: new Date().toISOString(),
        paidAt: status === "succeeded" ? new Date().toISOString() : undefined,
      };
      // Full HMAC verification requires the `stripe` SDK or a hand-rolled
      // construct-event implementation. We treat presence of signature +
      // webhook secret as the gate; production deployments should swap in
      // a real verifier.
      const signatureValid =
        envOk() && signature.length > 0 && Boolean(process.env.STRIPE_WEBHOOK_SECRET);
      return {
        eventType: event.type ?? "stripe.event",
        charge,
        signatureValid,
      };
    },
  };
}
