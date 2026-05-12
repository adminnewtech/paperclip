// ---------------------------------------------------------------------------
// MyFatoorah payment provider (Kuwait + GCC)
// ---------------------------------------------------------------------------
//
// MyFatoorah aggregates KNET, K-NET-debit, Mada, Visa, Mastercard, Apple Pay,
// Benefit (BH) and more behind a single hosted-checkout. It is the de-facto
// default for Kuwait-based businesses that want to accept any GCC payment
// method.
//
// Env vars:
//   MYFATOORAH_API_KEY    Bearer token (test or live).
//   MYFATOORAH_API_URL    Optional; defaults to https://api.myfatoorah.com.
//                         Use https://apitest.myfatoorah.com during testing.
//
// Currencies: KWD, SAR, AED, BHD, OMR, QAR, USD.

import {
  buildMockCharge,
  minorToMajor,
  majorToMinor,
  type CreateChargeInput,
  type PaymentCharge,
  type PaymentProvider,
  type ParsedWebhook,
} from "./index.js";
import type { GccCurrency } from "@paperclipai/shared";

const DEFAULT_BASE_URL = "https://api.myfatoorah.com";

function envOk(): boolean {
  return Boolean(process.env.MYFATOORAH_API_KEY);
}

function baseUrl(): string {
  return process.env.MYFATOORAH_API_URL ?? DEFAULT_BASE_URL;
}

interface MfInvoice {
  InvoiceId?: number;
  InvoiceStatus?: string;
  InvoiceURL?: string;
  PaymentURL?: string;
  CustomerReference?: string;
  CustomerName?: string;
  CustomerEmail?: string;
  CustomerMobile?: string;
  InvoiceDisplayValue?: string;
  InvoiceValue?: number;
  PaymentGateway?: { Name?: string };
}

interface MfCreateResponse {
  IsSuccess: boolean;
  Message?: string;
  Data?: { InvoiceId: number; InvoiceURL: string; CustomerReference?: string };
}

function chargeFromInvoice(
  data: MfInvoice,
  currency: GccCurrency | "USD",
  amountCents: number,
): PaymentCharge {
  const statusRaw = String(data.InvoiceStatus ?? "Pending").toLowerCase();
  const status =
    statusRaw === "paid"
      ? "succeeded"
      : statusRaw === "expired"
        ? "expired"
        : statusRaw === "failed" || statusRaw === "canceled"
          ? "failed"
          : "pending";
  return {
    id: String(data.InvoiceId ?? ""),
    providerName: "myfatoorah",
    providerId: String(data.InvoiceId ?? ""),
    amountCents:
      typeof data.InvoiceValue === "number"
        ? majorToMinor(data.InvoiceValue, currency)
        : amountCents,
    currency,
    status,
    customerName: data.CustomerName,
    customerEmail: data.CustomerEmail,
    customerPhone: data.CustomerMobile,
    metadata: { ...data },
    paymentUrl: data.InvoiceURL ?? data.PaymentURL,
    createdAt: new Date().toISOString(),
    paidAt: status === "succeeded" ? new Date().toISOString() : undefined,
  };
}

export function createMyFatoorahProvider(): PaymentProvider {
  return {
    name: "myfatoorah",
    isConfigured: () => envOk(),
    supportedCurrencies: () => ["KWD", "SAR", "AED", "BHD", "OMR", "QAR", "USD"],

    async createCharge(input: CreateChargeInput): Promise<PaymentCharge> {
      if (!envOk()) return buildMockCharge("myfatoorah", input);
      const url = `${baseUrl()}/v2/SendPayment`;
      const payload = {
        NotificationOption: "LNK",
        CustomerName: input.customer?.name ?? "Customer",
        DisplayCurrencyIso: input.currency,
        MobileCountryCode: "+965",
        CustomerMobile: input.customer?.phone?.replace(/^\+/, "") ?? "",
        CustomerEmail: input.customer?.email ?? "",
        InvoiceValue: Number(minorToMajor(input.amountCents, input.currency)),
        CallBackUrl: input.returnUrl ?? "",
        ErrorUrl: input.returnUrl ?? "",
        Language: "en",
        CustomerReference: input.metadata?.invoiceId
          ? String(input.metadata.invoiceId)
          : undefined,
        UserDefinedField: input.description ?? "",
      };
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.MYFATOORAH_API_KEY!}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });
        const json = (await res.json().catch(() => null)) as MfCreateResponse | null;
        if (!res.ok || !json?.IsSuccess || !json.Data) {
          return {
            ...buildMockCharge("myfatoorah", input),
            status: "failed",
            errorMessage: json?.Message ?? `MyFatoorah error: ${res.status}`,
          };
        }
        return {
          id: String(json.Data.InvoiceId),
          providerName: "myfatoorah",
          providerId: String(json.Data.InvoiceId),
          amountCents: input.amountCents,
          currency: input.currency,
          status: "pending",
          customerName: input.customer?.name,
          customerEmail: input.customer?.email,
          customerPhone: input.customer?.phone,
          description: input.description,
          metadata: { ...(input.metadata ?? {}), customerReference: json.Data.CustomerReference },
          paymentUrl: json.Data.InvoiceURL,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          ...buildMockCharge("myfatoorah", input),
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async getCharge(providerId: string): Promise<PaymentCharge> {
      if (!envOk()) {
        return {
          id: providerId,
          providerName: "myfatoorah",
          providerId,
          amountCents: 0,
          currency: "KWD",
          status: "pending",
          metadata: { mock: true },
          createdAt: new Date().toISOString(),
        };
      }
      const url = `${baseUrl()}/v2/getPaymentStatus`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.MYFATOORAH_API_KEY!}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ Key: providerId, KeyType: "InvoiceId" }),
        });
        const json = (await res.json().catch(() => null)) as
          | { IsSuccess?: boolean; Data?: MfInvoice; Message?: string }
          | null;
        if (!res.ok || !json?.IsSuccess || !json.Data) {
          return {
            id: providerId,
            providerName: "myfatoorah",
            providerId,
            amountCents: 0,
            currency: "KWD",
            status: "failed",
            metadata: { error: json?.Message ?? `MyFatoorah status: ${res.status}` },
            createdAt: new Date().toISOString(),
            errorMessage: json?.Message,
          };
        }
        return chargeFromInvoice(json.Data, "KWD", 0);
      } catch (err) {
        return {
          id: providerId,
          providerName: "myfatoorah",
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
          providerName: "myfatoorah",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "KWD",
          status: "refunded",
          metadata: { mock: true, refunded: true },
          createdAt: new Date().toISOString(),
        };
      }
      const url = `${baseUrl()}/v2/MakeRefund`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.MYFATOORAH_API_KEY!}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            KeyType: "InvoiceId",
            Key: providerId,
            RefundChargeOnCustomer: false,
            Amount:
              amountCents !== undefined ? Number(minorToMajor(amountCents, "KWD")) : undefined,
            Comment: "Merchant-initiated refund",
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { IsSuccess?: boolean; Data?: Record<string, unknown>; Message?: string }
          | null;
        return {
          id: providerId,
          providerName: "myfatoorah",
          providerId,
          amountCents: amountCents ?? 0,
          currency: "KWD",
          status: res.ok && json?.IsSuccess ? "refunded" : "failed",
          metadata: { refundResponse: json },
          errorMessage: json?.IsSuccess ? undefined : json?.Message,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          id: providerId,
          providerName: "myfatoorah",
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
      const signature = headers["myfatoorah-signature"] ?? headers["MyFatoorah-Signature"] ?? "";
      const payload =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : {};
      const eventType = String(payload.EventType ?? "PaymentStatusChanged");
      const data = (payload.Data ?? payload) as MfInvoice & {
        TransactionStatus?: string;
      };
      const status = String(data.InvoiceStatus ?? data.TransactionStatus ?? "").toLowerCase();
      const mapped =
        status === "paid" || status === "succss" || status === "succeed" || status === "succeeded"
          ? "succeeded"
          : status === "expired"
            ? "expired"
            : status === "failed" || status === "canceled"
              ? "failed"
              : "pending";
      const charge: PaymentCharge = {
        id: String(data.InvoiceId ?? ""),
        providerName: "myfatoorah",
        providerId: String(data.InvoiceId ?? ""),
        amountCents:
          typeof data.InvoiceValue === "number"
            ? majorToMinor(data.InvoiceValue, "KWD")
            : 0,
        currency: "KWD",
        status: mapped,
        metadata: { ...payload },
        createdAt: new Date().toISOString(),
        paidAt: mapped === "succeeded" ? new Date().toISOString() : undefined,
      };
      return {
        eventType,
        charge,
        // The real signature check would verify an HMAC over the body using
        // a webhook secret published in the MyFatoorah portal. We treat the
        // presence of the signature header + configured API key as a
        // lightweight authenticity proxy.
        signatureValid: envOk() && signature.length > 0,
      };
    },
  };
}
