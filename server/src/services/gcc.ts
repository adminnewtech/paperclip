import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosInvoice,
  bosEinvoice,
  bosTaxRegistration,
  bosPaymentGateway,
} from "@paperclipai/db";
import { generateEInvoice, type EInvoiceInput } from "./zatca.js";

type EInvoiceRow = typeof bosEinvoice.$inferSelect;
type TaxRegistrationRow = typeof bosTaxRegistration.$inferSelect;
type PaymentGatewayRow = typeof bosPaymentGateway.$inferSelect;

export interface IssueEInvoiceParams {
  companyId: string;
  invoiceId: string;
  mode?: string;
}

/**
 * Issue an e-invoice for an existing bos_invoice. Fetches the invoice, looks up
 * the company's latest e-invoice for the PIH chain (max seq), generates a
 * deterministic ZATCA payload, and persists a bos_einvoice row. Offline-safe:
 * generateEInvoice performs no network calls.
 */
export async function issueEInvoice(
  db: Db,
  params: IssueEInvoiceParams,
): Promise<EInvoiceRow> {
  const { companyId, invoiceId, mode } = params;

  const [invoice] = await db
    .select()
    .from(bosInvoice)
    .where(and(eq(bosInvoice.id, invoiceId), eq(bosInvoice.companyId, companyId)));
  if (!invoice) {
    throw new Error("Invoice not found");
  }

  // Previous e-invoice (highest seq) for the PIH chain.
  const [previous] = await db
    .select()
    .from(bosEinvoice)
    .where(eq(bosEinvoice.companyId, companyId))
    .orderBy(desc(bosEinvoice.seq))
    .limit(1);

  const seq = previous ? previous.seq + 1 : 0;
  const previousHash = previous?.invoiceHash ?? null;

  const input: EInvoiceInput = {
    number: invoice.number,
    seq,
    totalMinor: invoice.totalMinor,
    vatMinor: invoice.taxMinor,
    currency: invoice.currency ?? "SAR",
    sellerName: invoice.customerName ?? null,
    kind: "standard_b2b",
  };

  const payload = generateEInvoice(input, {
    previousHash,
    seq,
    mode: mode ?? "sandbox",
    nowIso: (invoice.issueDate ?? invoice.createdAt ?? new Date(0)).toISOString(),
  });

  const now = new Date();
  const [row] = await db
    .insert(bosEinvoice)
    .values({
      companyId,
      invoiceId,
      uuidValue: payload.uuid,
      invoiceHash: payload.hash,
      previousHash: payload.previousHash,
      qrCode: payload.qr,
      signedXml: payload.signedXml,
      invoiceKind: payload.kind,
      zatcaStatus: payload.status,
      submittedAt: now,
      clearedAt: payload.status === "cleared" ? now : null,
      totalMinor: invoice.totalMinor,
      vatMinor: invoice.taxMinor,
      currency: invoice.currency ?? "SAR",
      seq,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create e-invoice");
  }
  return row;
}

export interface CompanyScopedParams {
  companyId: string;
}

/** Tax registration for a company (optionally for a specific country). */
export async function getTaxRegistration(
  db: Db,
  params: CompanyScopedParams & { country?: string },
): Promise<TaxRegistrationRow | null> {
  const conditions = [eq(bosTaxRegistration.companyId, params.companyId)];
  if (params.country) {
    conditions.push(eq(bosTaxRegistration.country, params.country));
  }
  const [row] = await db
    .select()
    .from(bosTaxRegistration)
    .where(and(...conditions))
    .orderBy(desc(bosTaxRegistration.updatedAt))
    .limit(1);
  return row ?? null;
}

export interface UpsertTaxRegistrationParams {
  companyId: string;
  country: string;
  vatNumber?: string | null;
  registered?: boolean;
  vatRateBps?: number;
  scheme?: string;
}

/** Insert or update the tax registration for a (company, country). */
export async function upsertTaxRegistration(
  db: Db,
  params: UpsertTaxRegistrationParams,
): Promise<TaxRegistrationRow> {
  const existing = await getTaxRegistration(db, {
    companyId: params.companyId,
    country: params.country,
  });

  const now = new Date();
  if (existing) {
    const [updated] = await db
      .update(bosTaxRegistration)
      .set({
        vatNumber: params.vatNumber ?? existing.vatNumber,
        registered: params.registered ?? existing.registered,
        vatRateBps: params.vatRateBps ?? existing.vatRateBps,
        scheme: params.scheme ?? existing.scheme,
        updatedAt: now,
      })
      .where(eq(bosTaxRegistration.id, existing.id))
      .returning();
    if (!updated) {
      throw new Error("Failed to update tax registration");
    }
    return updated;
  }

  const [row] = await db
    .insert(bosTaxRegistration)
    .values({
      companyId: params.companyId,
      country: params.country,
      vatNumber: params.vatNumber ?? null,
      registered: params.registered ?? false,
      vatRateBps: params.vatRateBps ?? 0,
      scheme: params.scheme ?? "standard",
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create tax registration");
  }
  return row;
}

/** List all e-invoices for a company (most recent first). */
export async function listEInvoices(
  db: Db,
  params: CompanyScopedParams,
): Promise<EInvoiceRow[]> {
  return db
    .select()
    .from(bosEinvoice)
    .where(eq(bosEinvoice.companyId, params.companyId))
    .orderBy(desc(bosEinvoice.seq));
}

/** List all configured payment gateways for a company. */
export async function listGateways(
  db: Db,
  params: CompanyScopedParams,
): Promise<PaymentGatewayRow[]> {
  return db
    .select()
    .from(bosPaymentGateway)
    .where(eq(bosPaymentGateway.companyId, params.companyId))
    .orderBy(desc(bosPaymentGateway.createdAt));
}

export interface UpsertGatewayParams {
  companyId: string;
  provider: string;
  enabled?: boolean;
  mode?: string;
  config?: unknown;
  displayName?: string | null;
}

/** Insert or update a payment gateway config for a (company, provider). */
export async function upsertGateway(
  db: Db,
  params: UpsertGatewayParams,
): Promise<PaymentGatewayRow> {
  const [existing] = await db
    .select()
    .from(bosPaymentGateway)
    .where(
      and(
        eq(bosPaymentGateway.companyId, params.companyId),
        eq(bosPaymentGateway.provider, params.provider),
      ),
    )
    .limit(1);

  const now = new Date();
  if (existing) {
    const [updated] = await db
      .update(bosPaymentGateway)
      .set({
        enabled: params.enabled ?? existing.enabled,
        mode: params.mode ?? existing.mode,
        config: (params.config ?? existing.config) as object,
        displayName: params.displayName ?? existing.displayName,
        updatedAt: now,
      })
      .where(eq(bosPaymentGateway.id, existing.id))
      .returning();
    if (!updated) {
      throw new Error("Failed to update payment gateway");
    }
    return updated;
  }

  const [row] = await db
    .insert(bosPaymentGateway)
    .values({
      companyId: params.companyId,
      provider: params.provider,
      enabled: params.enabled ?? false,
      mode: params.mode ?? "sandbox",
      config: (params.config ?? {}) as object,
      displayName: params.displayName ?? null,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create payment gateway");
  }
  return row;
}
