// ---------------------------------------------------------------------------
// Payments service: pluggable GCC payment gateway integration
// ---------------------------------------------------------------------------
//
// Defines the `PaymentProvider` interface, the registry that resolves provider
// instances by name, and the `PaymentService` that persists charges into
// `businessEntities` (moduleKey="payments", entityType="charge"). Every
// concrete provider lives in its own file in this directory and falls back to
// a deterministic mock when its environment variables are missing — so this
// code is safe to run in dev without external credentials.
//
// Supported providers (Kuwait-first):
//   - knet         Kuwait — KNET PG / Tranportal (KWD only)
//   - myfatoorah   Kuwait/SA/UAE — MyFatoorah hosted checkout
//   - moyasar      Saudi — Moyasar
//   - tap          Saudi/Kuwait/UAE — Tap Payments
//   - paytabs      UAE/Saudi — PayTabs
//   - stripe       International fallback (USD)
//   - mock         Always-on stub for tests
//
// Persistence shape (businessEntities row):
//   moduleKey: "payments"
//   entityType: "charge"
//   code: provider charge id
//   amountCents / currency: from the charge
//   data: { providerName, ...PaymentCharge fields }
//   parentId: relatedInvoiceId (when provided)

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type { GccCurrency } from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  currency: GccCurrency | "USD";
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

export interface CreateChargeInput {
  amountCents: number;
  currency: GccCurrency | "USD";
  description?: string;
  customer?: { name?: string; email?: string; phone?: string };
  returnUrl?: string;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedWebhook {
  eventType: string;
  charge?: PaymentCharge;
  signatureValid: boolean;
}

export interface PaymentProvider {
  name: PaymentProviderName;
  isConfigured(): boolean;
  supportedCurrencies(): Array<GccCurrency | "USD">;
  createCharge(input: CreateChargeInput): Promise<PaymentCharge>;
  getCharge(providerId: string): Promise<PaymentCharge>;
  refundCharge(providerId: string, amountCents?: number): Promise<PaymentCharge>;
  parseWebhook(headers: Record<string, string>, body: unknown): ParsedWebhook;
}

export interface ProviderDescriptor {
  name: PaymentProviderName;
  configured: boolean;
  currencies: string[];
}

export interface ListChargesOptions {
  limit?: number;
  status?: string;
  provider?: string;
}

export interface PaymentService {
  getProvider(name: PaymentProviderName): PaymentProvider;
  listAvailableProviders(): ProviderDescriptor[];
  recordCharge(
    companyId: string,
    charge: PaymentCharge,
    options?: { relatedInvoiceId?: string },
  ): Promise<void>;
  updateChargeStatus(
    companyId: string,
    providerId: string,
    charge: PaymentCharge,
  ): Promise<void>;
  listCharges(
    companyId: string,
    opts?: ListChargesOptions,
  ): Promise<PaymentCharge[]>;
  getCharge(
    companyId: string,
    id: string,
  ): Promise<{ charge: PaymentCharge; entityId: string; relatedInvoiceId: string | null } | null>;
}

// ---------------------------------------------------------------------------
// Shared helpers used by every provider
// ---------------------------------------------------------------------------

/** Generate a mock provider-id for unconfigured providers. */
export function mockProviderId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_mock_${Date.now()}_${rand}`;
}

/** Build a mock charge that simulates a hosted-checkout redirect. */
export function buildMockCharge(
  name: PaymentProviderName,
  input: CreateChargeInput,
): PaymentCharge {
  const providerId = mockProviderId(name);
  return {
    id: providerId,
    providerName: name,
    providerId,
    amountCents: input.amountCents,
    currency: input.currency,
    status: "pending",
    customerName: input.customer?.name,
    customerEmail: input.customer?.email,
    customerPhone: input.customer?.phone,
    description: input.description,
    metadata: { ...(input.metadata ?? {}), mock: true },
    paymentUrl: `https://mock-payment.example/charge/${providerId}`,
    createdAt: new Date().toISOString(),
  };
}

/** Convert minor units to the major-unit string Tap/Moyasar/Stripe expect. */
export function minorToMajor(
  amountCents: number,
  currency: GccCurrency | "USD",
): string {
  const decimals = currency === "KWD" || currency === "BHD" || currency === "OMR" ? 3 : 2;
  return (amountCents / Math.pow(10, decimals)).toFixed(decimals);
}

export function majorToMinor(
  amountMajor: number | string,
  currency: GccCurrency | "USD",
): number {
  const decimals = currency === "KWD" || currency === "BHD" || currency === "OMR" ? 3 : 2;
  const n = typeof amountMajor === "string" ? Number.parseFloat(amountMajor) : amountMajor;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * Math.pow(10, decimals));
}

// ---------------------------------------------------------------------------
// Provider registry (lazy)
// ---------------------------------------------------------------------------

import { createKnetProvider } from "./knet-provider.js";
import { createMyFatoorahProvider } from "./myfatoorah-provider.js";
import { createMoyasarProvider } from "./moyasar-provider.js";
import { createTapProvider } from "./tap-provider.js";
import { createPayTabsProvider } from "./paytabs-provider.js";
import { createStripeProvider } from "./stripe-provider.js";

function createMockProvider(): PaymentProvider {
  return {
    name: "mock",
    isConfigured: () => true,
    supportedCurrencies: () => ["KWD", "SAR", "AED", "QAR", "BHD", "OMR", "USD"],
    async createCharge(input) {
      return buildMockCharge("mock", input);
    },
    async getCharge(providerId) {
      return {
        id: providerId,
        providerName: "mock",
        providerId,
        amountCents: 0,
        currency: "KWD",
        status: "succeeded",
        metadata: { mock: true },
        createdAt: new Date().toISOString(),
        paidAt: new Date().toISOString(),
      };
    },
    async refundCharge(providerId) {
      return {
        id: providerId,
        providerName: "mock",
        providerId,
        amountCents: 0,
        currency: "KWD",
        status: "refunded",
        metadata: { mock: true, refunded: true },
        createdAt: new Date().toISOString(),
      };
    },
    parseWebhook() {
      return { eventType: "mock.event", signatureValid: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Row → PaymentCharge mapping
// ---------------------------------------------------------------------------

function rowToCharge(row: typeof businessEntities.$inferSelect): PaymentCharge {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const providerName = (data.providerName as PaymentProviderName) ?? "mock";
  return {
    id: row.id,
    providerName,
    providerId: typeof data.providerId === "string" ? data.providerId : row.code ?? row.id,
    amountCents: row.amountCents ?? (typeof data.amountCents === "number" ? data.amountCents : 0),
    currency: (row.currency ?? (data.currency as string) ?? "KWD") as GccCurrency | "USD",
    status: ((data.status as string) ?? row.status ?? "pending") as PaymentChargeStatus,
    customerName: typeof data.customerName === "string" ? data.customerName : undefined,
    customerEmail: typeof data.customerEmail === "string" ? data.customerEmail : undefined,
    customerPhone: typeof data.customerPhone === "string" ? data.customerPhone : undefined,
    description: typeof data.description === "string" ? data.description : undefined,
    metadata:
      data.metadata && typeof data.metadata === "object"
        ? (data.metadata as Record<string, unknown>)
        : {},
    paymentUrl: typeof data.paymentUrl === "string" ? data.paymentUrl : undefined,
    receiptUrl: typeof data.receiptUrl === "string" ? data.receiptUrl : undefined,
    errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : undefined,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    paidAt: typeof data.paidAt === "string" ? data.paidAt : undefined,
  };
}

function chargeToData(charge: PaymentCharge): Record<string, unknown> {
  return {
    providerName: charge.providerName,
    providerId: charge.providerId,
    amountCents: charge.amountCents,
    currency: charge.currency,
    status: charge.status,
    customerName: charge.customerName ?? null,
    customerEmail: charge.customerEmail ?? null,
    customerPhone: charge.customerPhone ?? null,
    description: charge.description ?? null,
    metadata: charge.metadata ?? {},
    paymentUrl: charge.paymentUrl ?? null,
    receiptUrl: charge.receiptUrl ?? null,
    errorMessage: charge.errorMessage ?? null,
    paidAt: charge.paidAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createPaymentService(db: Db): PaymentService {
  const providerCache = new Map<PaymentProviderName, PaymentProvider>();

  function getProvider(name: PaymentProviderName): PaymentProvider {
    let p = providerCache.get(name);
    if (p) return p;
    switch (name) {
      case "knet":
        p = createKnetProvider();
        break;
      case "myfatoorah":
        p = createMyFatoorahProvider();
        break;
      case "moyasar":
        p = createMoyasarProvider();
        break;
      case "tap":
        p = createTapProvider();
        break;
      case "paytabs":
        p = createPayTabsProvider();
        break;
      case "stripe":
        p = createStripeProvider();
        break;
      case "mock":
      default:
        p = createMockProvider();
        break;
    }
    providerCache.set(name, p);
    return p;
  }

  function listAvailableProviders(): ProviderDescriptor[] {
    const names: PaymentProviderName[] = [
      "knet",
      "myfatoorah",
      "moyasar",
      "tap",
      "paytabs",
      "stripe",
      "mock",
    ];
    return names.map((n) => {
      const p = getProvider(n);
      return {
        name: n,
        configured: p.isConfigured(),
        currencies: p.supportedCurrencies(),
      };
    });
  }

  async function recordCharge(
    companyId: string,
    charge: PaymentCharge,
    options?: { relatedInvoiceId?: string },
  ): Promise<void> {
    const now = new Date();
    await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "payments",
        entityType: "charge",
        code: charge.providerId,
        name: charge.description ?? `${charge.providerName.toUpperCase()} charge`,
        status: charge.status,
        parentId: options?.relatedInvoiceId ?? null,
        amountCents: charge.amountCents,
        currency: charge.currency,
        data: chargeToData(charge),
        tags: [charge.providerName],
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // If a related invoice was provided and the charge is already succeeded
    // (rare for hosted checkout, common for tokenised charges), update it.
    if (options?.relatedInvoiceId && charge.status === "succeeded") {
      await db
        .update(businessEntities)
        .set({ status: "paid", updatedAt: now })
        .where(
          and(
            eq(businessEntities.id, options.relatedInvoiceId),
            eq(businessEntities.companyId, companyId),
          ),
        );
    }
  }

  async function updateChargeStatus(
    companyId: string,
    providerId: string,
    charge: PaymentCharge,
  ): Promise<void> {
    const now = new Date();
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "payments"),
          eq(businessEntities.entityType, "charge"),
          eq(businessEntities.code, providerId),
        ),
      )
      .limit(1);
    if (!row) return;
    const existing = (row.data ?? {}) as Record<string, unknown>;
    await db
      .update(businessEntities)
      .set({
        status: charge.status,
        amountCents: charge.amountCents,
        currency: charge.currency,
        data: { ...existing, ...chargeToData(charge) },
        updatedAt: now,
      })
      .where(eq(businessEntities.id, row.id));

    // Cascade to invoice if linked.
    if (row.parentId && charge.status === "succeeded") {
      await db
        .update(businessEntities)
        .set({ status: "paid", updatedAt: now })
        .where(
          and(
            eq(businessEntities.id, row.parentId),
            eq(businessEntities.companyId, companyId),
          ),
        );
    }
  }

  async function listCharges(
    companyId: string,
    opts?: ListChargesOptions,
  ): Promise<PaymentCharge[]> {
    const limit = Math.min(opts?.limit ?? 200, 1000);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "payments"),
          eq(businessEntities.entityType, "charge"),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit);

    let charges = rows.map(rowToCharge);
    if (opts?.status) {
      charges = charges.filter((c) => c.status === opts.status);
    }
    if (opts?.provider) {
      charges = charges.filter((c) => c.providerName === opts.provider);
    }
    return charges;
  }

  async function getCharge(
    companyId: string,
    id: string,
  ): Promise<{ charge: PaymentCharge; entityId: string; relatedInvoiceId: string | null } | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "payments"),
          eq(businessEntities.entityType, "charge"),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      charge: rowToCharge(row),
      entityId: row.id,
      relatedInvoiceId: row.parentId,
    };
  }

  return {
    getProvider,
    listAvailableProviders,
    recordCharge,
    updateChargeStatus,
    listCharges,
    getCharge,
  };
}

// ---------------------------------------------------------------------------
// Country-default suggestions (Kuwait-first)
// ---------------------------------------------------------------------------

export function suggestProvidersForCurrency(
  currency: GccCurrency | "USD",
): PaymentProviderName[] {
  switch (currency) {
    case "KWD":
      return ["knet", "myfatoorah", "tap"];
    case "SAR":
      return ["moyasar", "tap", "paytabs", "myfatoorah"];
    case "AED":
      return ["paytabs", "tap", "myfatoorah"];
    case "USD":
      return ["stripe", "tap"];
    case "BHD":
    case "OMR":
    case "QAR":
      return ["tap", "myfatoorah"];
    default:
      return ["myfatoorah"];
  }
}
