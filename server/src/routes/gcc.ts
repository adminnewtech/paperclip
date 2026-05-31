import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bosInvoice, bosBill } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import {
  issueEInvoice,
  getTaxRegistration,
  upsertTaxRegistration,
  listEInvoices,
  listGateways,
  upsertGateway,
} from "../services/gcc.js";
import { vatReturn, vatRateBps } from "../services/vat.js";
import { availableGateways } from "../services/payments.js";

// ---------------------------------------------------------------------------
// Validation schemas.
// ---------------------------------------------------------------------------
const taxRegistrationSchema = z.object({
  country: z.string().trim().min(2).max(2),
  vatNumber: z.string().trim().max(50).optional().nullable(),
  registered: z.boolean().optional(),
  vatRateBps: z.number().int().nonnegative().optional(),
  scheme: z.string().trim().max(50).optional(),
});

const issueEInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  mode: z.enum(["sandbox", "live"]).optional().default("sandbox"),
});

const gatewaySchema = z.object({
  provider: z.enum(["knet", "mada", "tabby", "tamara", "myfatoorah", "applepay"]),
  enabled: z.boolean().optional(),
  mode: z.enum(["sandbox", "live"]).optional(),
  config: z.record(z.unknown()).optional(),
  displayName: z.string().trim().max(200).optional().nullable(),
});

export function gccRoutes(db: Db) {
  const router = Router();

  // ---------------------- Tax registration ----------------------
  router.get(
    "/companies/:companyId/gcc/tax-registration",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const country =
        typeof req.query.country === "string" ? req.query.country : undefined;
      const registration = await getTaxRegistration(db, { companyId, country });
      res.json({ registration });
    },
  );

  router.post(
    "/companies/:companyId/gcc/tax-registration",
    validate(taxRegistrationSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof taxRegistrationSchema>;
      const actor = getActorInfo(req);

      const registration = await upsertTaxRegistration(db, {
        companyId,
        country: body.country.toUpperCase(),
        vatNumber: body.vatNumber ?? null,
        registered: body.registered,
        // Default the VAT rate from the country when not explicitly provided.
        vatRateBps: body.vatRateBps ?? vatRateBps(body.country),
        scheme: body.scheme,
      });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "gcc.tax_registration_upserted",
        entityType: "bos_tax_registration",
        entityId: registration.id,
        details: { country: registration.country },
      });

      res.status(201).json(registration);
    },
  );

  // ---------------------- E-invoicing ----------------------
  router.get("/companies/:companyId/gcc/einvoices", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const einvoices = await listEInvoices(db, { companyId });
    res.json({ einvoices });
  });

  router.post(
    "/companies/:companyId/gcc/einvoices/issue",
    validate(issueEInvoiceSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof issueEInvoiceSchema>;
      const actor = getActorInfo(req);

      let einvoice;
      try {
        einvoice = await issueEInvoice(db, {
          companyId,
          invoiceId: body.invoiceId,
          mode: body.mode,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Issue failed";
        if (message === "Invoice not found") {
          res.status(404).json({ error: message });
          return;
        }
        throw error;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "gcc.einvoice_issued",
        entityType: "bos_einvoice",
        entityId: einvoice.id,
        details: { status: einvoice.zatcaStatus, uuid: einvoice.uuidValue },
      });

      res.status(201).json(einvoice);
    },
  );

  // ---------------------- VAT return ----------------------
  router.get("/companies/:companyId/gcc/vat-return", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const country =
      typeof req.query.country === "string" ? req.query.country : "SA";

    const invoices = await db
      .select({
        netMinor: bosInvoice.subtotalMinor,
        vatMinor: bosInvoice.taxMinor,
      })
      .from(bosInvoice)
      .where(eq(bosInvoice.companyId, companyId));

    const bills = await db
      .select({
        netMinor: bosBill.subtotalMinor,
        vatMinor: bosBill.taxMinor,
      })
      .from(bosBill)
      .where(eq(bosBill.companyId, companyId));

    const result = vatReturn(invoices, bills, country);
    res.json({ country, ...result });
  });

  // ---------------------- Payment gateways ----------------------
  router.get(
    "/companies/:companyId/gcc/payment-gateways",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const gateways = await listGateways(db, { companyId });
      res.json({ gateways });
    },
  );

  router.post(
    "/companies/:companyId/gcc/payment-gateways",
    validate(gatewaySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof gatewaySchema>;
      const actor = getActorInfo(req);

      const gateway = await upsertGateway(db, {
        companyId,
        provider: body.provider,
        enabled: body.enabled,
        mode: body.mode,
        config: body.config,
        displayName: body.displayName ?? null,
      });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "gcc.payment_gateway_upserted",
        entityType: "bos_payment_gateway",
        entityId: gateway.id,
        details: { provider: gateway.provider, enabled: gateway.enabled },
      });

      res.status(201).json(gateway);
    },
  );

  // Available payment options for a market (pure, no persistence).
  router.get(
    "/companies/:companyId/gcc/payment-options",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const country =
        typeof req.query.country === "string" ? req.query.country : "KW";
      res.json({ country, providers: availableGateways(country) });
    },
  );

  return router;
}
