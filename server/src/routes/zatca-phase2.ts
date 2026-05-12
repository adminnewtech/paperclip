/**
 * REST endpoints for the ZATCA Phase 2 e-invoicing integration.
 *
 * All routes require `assertCompanyAccess`. The actual cryptographic +
 * submission work happens in `zatca-phase2-service`. The routes themselves
 * are thin glue: they validate input, resolve the invoice from the
 * businessEntities table, and translate service responses into JSON.
 *
 * Environment variables: see `zatca-phase2-service.ts`.
 */

import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import {
  createZatcaPhase2Service,
  type ZatcaInvoiceInput,
} from "../services/zatca/zatca-phase2-service.js";

const submitSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceType: z.enum(["standard", "simplified", "credit_note", "debit_note"]).optional(),
  paymentMethod: z.enum(["cash", "card", "credit", "bank_transfer"]).optional(),
});

interface InvoiceData {
  invoiceType?: string;
  paymentMethod?: string;
  uuid?: string;
  supplier?: {
    name?: string;
    nameAr?: string;
    vatNumber?: string;
    crNumber?: string;
    address?: {
      street?: string;
      building?: string;
      city?: string;
      postalCode?: string;
      countryCode?: string;
    };
  };
  customer?: {
    name?: string;
    nameAr?: string;
    vatNumber?: string;
    address?: {
      street?: string;
      building?: string;
      city?: string;
      postalCode?: string;
      countryCode?: string;
    };
  };
  lines?: Array<{
    name?: string;
    quantity?: number;
    unitPriceCents?: number;
    discountCents?: number;
    vatPercent?: number;
  }>;
  taxableCents?: number;
  vatCents?: number;
  discountCents?: number;
  previousInvoiceHash?: string;
}

async function loadInvoice(
  db: Db,
  companyId: string,
  invoiceId: string,
): Promise<{
  invoiceNumber: string;
  amountCents: number;
  data: InvoiceData;
  createdAt: Date;
} | null> {
  const rows = await db
    .select({
      code: businessEntities.code,
      amountCents: businessEntities.amountCents,
      data: businessEntities.data,
      createdAt: businessEntities.createdAt,
    })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.id, invoiceId),
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "sales"),
        eq(businessEntities.entityType, "invoice"),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    invoiceNumber: row.code ?? invoiceId,
    amountCents: row.amountCents ?? 0,
    data: (row.data ?? {}) as InvoiceData,
    createdAt: row.createdAt,
  };
}

function invoiceRecordToZatcaInput(params: {
  invoiceNumber: string;
  amountCents: number;
  data: InvoiceData;
  createdAt: Date;
  override?: { invoiceType?: ZatcaInvoiceInput["invoiceType"]; paymentMethod?: ZatcaInvoiceInput["paymentMethod"] };
  uuid: string;
}): ZatcaInvoiceInput {
  const data = params.data;
  const sup = data.supplier ?? {};
  const supAddr = sup.address ?? {};
  const lines = (data.lines ?? []).map((ln) => ({
    name: ln.name ?? "Line item",
    quantity: typeof ln.quantity === "number" ? ln.quantity : 1,
    unitPriceCents:
      typeof ln.unitPriceCents === "number"
        ? ln.unitPriceCents
        : params.amountCents,
    discountCents: ln.discountCents,
    vatPercent: typeof ln.vatPercent === "number" ? ln.vatPercent : 15,
  }));
  if (lines.length === 0) {
    lines.push({
      name: `Invoice ${params.invoiceNumber}`,
      quantity: 1,
      unitPriceCents: Math.max(0, params.amountCents - (data.vatCents ?? 0)),
      discountCents: undefined,
      vatPercent: 15,
    });
  }
  const subtotalCents = data.taxableCents ?? lines.reduce(
    (s, l) => s + l.quantity * l.unitPriceCents - (l.discountCents ?? 0),
    0,
  );
  const vatCents =
    data.vatCents ??
    lines.reduce(
      (s, l) =>
        s +
        Math.round(
          (l.quantity * l.unitPriceCents - (l.discountCents ?? 0)) *
            (l.vatPercent / 100),
        ),
      0,
    );
  const totalCents = params.amountCents || subtotalCents + vatCents;
  const invoiceType =
    params.override?.invoiceType ??
    (data.invoiceType === "standard" ||
    data.invoiceType === "simplified" ||
    data.invoiceType === "credit_note" ||
    data.invoiceType === "debit_note"
      ? (data.invoiceType as ZatcaInvoiceInput["invoiceType"])
      : "simplified");
  const paymentMethod =
    params.override?.paymentMethod ??
    (data.paymentMethod === "cash" ||
    data.paymentMethod === "card" ||
    data.paymentMethod === "credit" ||
    data.paymentMethod === "bank_transfer"
      ? (data.paymentMethod as ZatcaInvoiceInput["paymentMethod"])
      : "cash");
  return {
    invoiceNumber: params.invoiceNumber,
    uuid: params.uuid,
    issueDate: params.createdAt.toISOString(),
    invoiceType,
    paymentMethod,
    supplier: {
      name: sup.name ?? "Supplier",
      nameAr: sup.nameAr ?? sup.name ?? "Supplier",
      vatNumber: sup.vatNumber ?? "",
      crNumber: sup.crNumber,
      address: {
        street: supAddr.street ?? "",
        building: supAddr.building ?? "",
        city: supAddr.city ?? "",
        postalCode: supAddr.postalCode ?? "",
        countryCode: supAddr.countryCode ?? "SA",
      },
    },
    customer: data.customer
      ? {
          name: data.customer.name ?? "",
          nameAr: data.customer.nameAr,
          vatNumber: data.customer.vatNumber,
          address: data.customer.address
            ? {
                street: data.customer.address.street,
                building: data.customer.address.building,
                city: data.customer.address.city,
                postalCode: data.customer.address.postalCode,
                countryCode: data.customer.address.countryCode ?? "SA",
              }
            : undefined,
        }
      : undefined,
    lines,
    totalsCents: {
      subtotal: subtotalCents,
      discount: data.discountCents ?? 0,
      vat: vatCents,
      total: totalCents,
    },
    previousInvoiceHash: data.previousInvoiceHash,
  };
}

export function zatcaPhase2Routes(db: Db) {
  const router = Router();
  const service = createZatcaPhase2Service(db);

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/zatca/config-status
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/zatca/config-status",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.json(service.describeConfig());
    },
  );

  // -------------------------------------------------------------------------
  // POST /companies/:companyId/business/zatca/submit
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/zatca/submit",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Invalid request body", issues: parsed.error.issues });
        return;
      }
      const invoice = await loadInvoice(db, companyId, parsed.data.invoiceId);
      if (!invoice) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }
      const input = invoiceRecordToZatcaInput({
        invoiceNumber: invoice.invoiceNumber,
        amountCents: invoice.amountCents,
        data: invoice.data,
        createdAt: invoice.createdAt,
        override: {
          invoiceType: parsed.data.invoiceType,
          paymentMethod: parsed.data.paymentMethod,
        },
        uuid: invoice.data.uuid ?? parsed.data.invoiceId,
      });
      const result = await service.submitInvoice(companyId, input);
      res.json(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/zatca/submissions
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/zatca/submissions",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const limitRaw = req.query.limit;
      const limit =
        typeof limitRaw === "string" ? parseInt(limitRaw, 10) : undefined;
      const submissions = await service.listSubmissions(companyId, { limit });
      res.json({ submissions });
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/zatca/submissions/:uuid
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/zatca/submissions/:uuid",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const uuid = req.params.uuid as string;
      const submission = await service.getStatus(companyId, uuid);
      if (!submission) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      res.json(submission);
    },
  );

  // -------------------------------------------------------------------------
  // POST /companies/:companyId/business/zatca/submissions/:uuid/resubmit
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/zatca/submissions/:uuid/resubmit",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const uuid = req.params.uuid as string;
      const existing = await service.getStatus(companyId, uuid);
      if (!existing) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      // Resubmitting requires the original invoice — look it up by name
      // (invoice number) stored on the submission row.
      const rows = await db
        .select({
          id: businessEntities.id,
          code: businessEntities.code,
          amountCents: businessEntities.amountCents,
          data: businessEntities.data,
          createdAt: businessEntities.createdAt,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "sales"),
            eq(businessEntities.entityType, "invoice"),
          ),
        );
      const invoice = rows.find((r) => {
        const data = (r.data ?? {}) as InvoiceData;
        return data.uuid === uuid;
      });
      if (!invoice) {
        res.status(404).json({ error: "Original invoice not found for resubmit" });
        return;
      }
      const input = invoiceRecordToZatcaInput({
        invoiceNumber: invoice.code ?? uuid,
        amountCents: invoice.amountCents ?? 0,
        data: (invoice.data ?? {}) as InvoiceData,
        createdAt: invoice.createdAt,
        uuid,
      });
      const result = await service.submitInvoice(companyId, input);
      res.json(result);
    },
  );

  return router;
}
