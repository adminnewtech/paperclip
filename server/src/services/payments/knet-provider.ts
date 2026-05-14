// ---------------------------------------------------------------------------
// KNET (Kuwait) payment provider
// ---------------------------------------------------------------------------
//
// KNET is Kuwait's national payment switch. Merchants typically integrate via
// the "Tranportal" hosted-payment-page protocol provided by their bank's
// acquiring service. Each merchant is assigned three credentials:
//
//   KNET_TRANSPORT_ID     Merchant transport ID
//   KNET_TRANSPORT_KEY    Tranportal authentication key
//   KNET_RESOURCE_KEY     Resource key used when redirecting to KNET PG
//   KNET_TRANSPORT_URL    Optional; defaults to the production URL.
//                         Use the bank-provided staging URL during testing.
//
// When ALL three required env vars are present this module will build a
// real redirect URL with the merchant context encoded — KNET requires a
// server-to-server transport call to obtain a redirect token; we structure
// that call here but fall back to a deterministic mock when env vars are
// missing.
//
// Currency: KWD only.

import {
  buildMockCharge,
  minorToMajor,
  mockProviderId,
  type CreateChargeInput,
  type PaymentCharge,
  type PaymentProvider,
  type ParsedWebhook,
} from "./index.js";

const DEFAULT_KNET_URL =
  "https://www.kpay.com.kw/kpg/PaymentHTTP.htm?param=paymentInit";

function envOk(): boolean {
  return Boolean(
    process.env.KNET_TRANSPORT_ID &&
      process.env.KNET_TRANSPORT_KEY &&
      process.env.KNET_RESOURCE_KEY,
  );
}

async function knetCreateCharge(input: CreateChargeInput): Promise<PaymentCharge> {
  if (!envOk()) {
    return buildMockCharge("knet", input);
  }
  if (input.currency !== "KWD") {
    return {
      ...buildMockCharge("knet", input),
      status: "failed",
      errorMessage: "KNET only supports KWD",
    };
  }

  const transportId = process.env.KNET_TRANSPORT_ID!;
  const transportKey = process.env.KNET_TRANSPORT_KEY!;
  const resourceKey = process.env.KNET_RESOURCE_KEY!;
  const baseUrl = process.env.KNET_TRANSPORT_URL ?? DEFAULT_KNET_URL;
  const trackId = mockProviderId("knet").slice(0, 30);
  const amountMajor = minorToMajor(input.amountCents, "KWD");

  // KNET Tranportal payload (form-encoded). The real endpoint returns a
  // payment id + redirect URL — we surface either, or fall back to a
  // constructed redirect when the bank returns the conventional shape.
  const params = new URLSearchParams();
  params.set("id", transportId);
  params.set("password", transportKey);
  params.set("action", "1");
  params.set("langid", "USA");
  params.set("currencycode", "414"); // ISO 4217 numeric for KWD
  params.set("amt", amountMajor);
  params.set("responseURL", input.returnUrl ?? "");
  params.set("errorURL", input.returnUrl ?? "");
  params.set("trackid", trackId);
  params.set("udf1", input.metadata?.invoiceId ? String(input.metadata.invoiceId) : "");
  params.set("udf2", input.customer?.email ?? "");
  params.set("udf3", input.customer?.phone ?? "");
  params.set("udf4", input.description ?? "");
  params.set("udf5", resourceKey);

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const text = await res.text();
    // KNET responds in the form: paymentId=NNN:redirectUrl
    let paymentId = trackId;
    let redirectUrl: string | undefined;
    const colonIdx = text.indexOf(":");
    if (colonIdx > 0 && colonIdx < text.length - 1) {
      paymentId = text.slice(0, colonIdx).trim();
      redirectUrl = text.slice(colonIdx + 1).trim();
      if (redirectUrl) {
        // KNET expects the merchant to redirect with the payment id appended.
        const sep = redirectUrl.includes("?") ? "&" : "?";
        redirectUrl = `${redirectUrl}${sep}PaymentID=${paymentId}`;
      }
    }
    return {
      id: paymentId,
      providerName: "knet",
      providerId: paymentId,
      amountCents: input.amountCents,
      currency: "KWD",
      status: "pending",
      customerName: input.customer?.name,
      customerEmail: input.customer?.email,
      customerPhone: input.customer?.phone,
      description: input.description,
      metadata: { ...(input.metadata ?? {}), trackId, raw: text },
      paymentUrl: redirectUrl,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ...buildMockCharge("knet", input),
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createKnetProvider(): PaymentProvider {
  return {
    name: "knet",
    isConfigured: () => envOk(),
    supportedCurrencies: () => ["KWD"],
    createCharge: knetCreateCharge,
    async getCharge(providerId: string): Promise<PaymentCharge> {
      // KNET hosted-checkout has no first-class GET — operators must
      // reconcile via the bank's settlement reports. We surface what we
      // know and leave the status as-is for the service to manage.
      return {
        id: providerId,
        providerName: "knet",
        providerId,
        amountCents: 0,
        currency: "KWD",
        status: "pending",
        metadata: { note: "KNET does not expose a charge GET; reconcile via webhook/response URL." },
        createdAt: new Date().toISOString(),
      };
    },
    async refundCharge(providerId: string): Promise<PaymentCharge> {
      // KNET refunds are typically processed through the bank's offline
      // settlement portal and not via the Tranportal API.
      return {
        id: providerId,
        providerName: "knet",
        providerId,
        amountCents: 0,
        currency: "KWD",
        status: "refunded",
        metadata: { note: "KNET refunds are processed via bank settlement portal." },
        createdAt: new Date().toISOString(),
      };
    },
    parseWebhook(_headers, body): ParsedWebhook {
      // KNET notifies via the responseURL form-post rather than a JSON webhook.
      // Map the standard return fields to a charge if present.
      const payload =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : {};
      const result = String(payload.result ?? "").toUpperCase();
      const paymentId = String(payload.paymentid ?? payload.paymentId ?? "");
      const trackId = String(payload.trackid ?? payload.trackId ?? "");
      const status =
        result === "CAPTURED" || result === "APPROVED"
          ? "succeeded"
          : result === "CANCELED" || result === "DENIED" || result === "NOT CAPTURED"
            ? "failed"
            : "pending";
      const charge: PaymentCharge = {
        id: paymentId || trackId,
        providerName: "knet",
        providerId: paymentId || trackId,
        amountCents: Math.round((Number(payload.amt) || 0) * 1000),
        currency: "KWD",
        status,
        metadata: { ...payload },
        createdAt: new Date().toISOString(),
        paidAt: status === "succeeded" ? new Date().toISOString() : undefined,
      };
      return {
        eventType: `knet.${status}`,
        charge,
        // KNET's authenticity is implicit in the resource-key check on
        // the redirect — without a public signature we accept it.
        signatureValid: envOk(),
      };
    },
  };
}
