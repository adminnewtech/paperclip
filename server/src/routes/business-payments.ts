// ---------------------------------------------------------------------------
// Business payments routes
// ---------------------------------------------------------------------------
//
// All endpoints other than the webhook receiver require company access.
// The webhook receiver is public — provider signature checks gate it.

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { GCC_CURRENCY_CODES } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import {
  createPaymentService,
  suggestProvidersForCurrency,
  type PaymentProviderName,
} from "../services/payments/index.js";

const providerNameSchema = z.enum([
  "knet",
  "myfatoorah",
  "moyasar",
  "tap",
  "paytabs",
  "stripe",
  "mock",
]);

const CURRENCY_VALUES: [string, ...string[]] = [
  "KWD",
  "SAR",
  "AED",
  "QAR",
  "BHD",
  "OMR",
  "USD",
];
// Reference the imported codes to keep the import meaningful even though
// the enum literal above is what we actually use.
void GCC_CURRENCY_CODES;
const currencySchema = z.enum(CURRENCY_VALUES);

const createChargeSchema = z.object({
  provider: providerNameSchema,
  amountCents: z.number().int().positive(),
  currency: currencySchema,
  description: z.string().trim().max(500).optional(),
  customer: z
    .object({
      name: z.string().trim().max(200).optional(),
      email: z.string().trim().email().max(200).optional(),
      phone: z.string().trim().max(32).optional(),
    })
    .optional(),
  returnUrl: z.string().url().max(2048).optional(),
  webhookUrl: z.string().url().max(2048).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  relatedInvoiceId: z.string().uuid().optional(),
});

const refundSchema = z.object({
  amountCents: z.number().int().positive().optional(),
});

export function businessPaymentsRoutes(db: Db) {
  const router = Router();
  const service = createPaymentService(db);

  // GET providers + configured status
  router.get(
    "/companies/:companyId/business/payments/providers",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const currencyParam =
        typeof req.query.currency === "string" ? req.query.currency : undefined;
      const providers = service.listAvailableProviders();
      const suggested =
        currencyParam &&
        (GCC_CURRENCY_CODES as readonly string[]).includes(currencyParam) === false &&
        currencyParam !== "USD"
          ? []
          : suggestProvidersForCurrency(
              (currencyParam as "KWD") ?? "KWD",
            );
      res.json({ providers, suggested, defaultCountry: "KW", defaultCurrency: "KWD" });
    },
  );

  // POST create charge
  router.post(
    "/companies/:companyId/business/payments/charges",
    validate(createChargeSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof createChargeSchema>;
      const provider = service.getProvider(body.provider as PaymentProviderName);
      if (!provider.supportedCurrencies().includes(body.currency as "KWD")) {
        res.status(400).json({
          error: `Provider ${body.provider} does not support ${body.currency}`,
        });
        return;
      }
      const charge = await provider.createCharge({
        amountCents: body.amountCents,
        currency: body.currency as "KWD",
        description: body.description,
        customer: body.customer,
        returnUrl: body.returnUrl,
        webhookUrl: body.webhookUrl,
        metadata: body.metadata,
      });
      await service.recordCharge(companyId, charge, {
        relatedInvoiceId: body.relatedInvoiceId,
      });
      res.status(charge.status === "failed" ? 502 : 200).json({
        charge,
        paymentUrl: charge.paymentUrl,
      });
    },
  );

  // GET list charges
  router.get(
    "/companies/:companyId/business/payments/charges",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const limit =
        typeof req.query.limit === "string"
          ? Math.max(1, Number(req.query.limit) || 200)
          : 200;
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const providerFilter =
        typeof req.query.provider === "string" ? req.query.provider : undefined;
      const charges = await service.listCharges(companyId, {
        limit,
        status,
        provider: providerFilter,
      });
      res.json({ charges });
    },
  );

  // GET single charge (refresh from provider when older than 60s and pending)
  router.get(
    "/companies/:companyId/business/payments/charges/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const found = await service.getCharge(companyId, id);
      if (!found) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      let charge = found.charge;
      const ageMs = Date.now() - new Date(charge.createdAt).getTime();
      if (charge.status === "pending" && ageMs > 60_000) {
        try {
          const provider = service.getProvider(charge.providerName);
          const latest = await provider.getCharge(charge.providerId);
          // Preserve original createdAt + customer fields
          const merged = {
            ...charge,
            status: latest.status,
            metadata: { ...charge.metadata, ...latest.metadata },
            paidAt: latest.paidAt ?? charge.paidAt,
            errorMessage: latest.errorMessage ?? charge.errorMessage,
            receiptUrl: latest.receiptUrl ?? charge.receiptUrl,
          };
          await service.updateChargeStatus(companyId, charge.providerId, merged);
          charge = merged;
        } catch {
          // best-effort refresh
        }
      }
      res.json({ charge, relatedInvoiceId: found.relatedInvoiceId });
    },
  );

  // POST refund
  router.post(
    "/companies/:companyId/business/payments/charges/:id/refund",
    validate(refundSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof refundSchema>;
      const found = await service.getCharge(companyId, id);
      if (!found) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const provider = service.getProvider(found.charge.providerName);
      const refunded = await provider.refundCharge(
        found.charge.providerId,
        body.amountCents,
      );
      const merged = {
        ...found.charge,
        status: refunded.status,
        metadata: { ...found.charge.metadata, ...refunded.metadata },
        errorMessage: refunded.errorMessage ?? found.charge.errorMessage,
      };
      await service.updateChargeStatus(companyId, found.charge.providerId, merged);
      res.json({ charge: merged });
    },
  );

  // Public webhook receiver — provider signature gate, no companyId in path.
  router.post(
    "/business/payments/webhook/:provider",
    async (req, res) => {
      const providerParam = req.params.provider as PaymentProviderName;
      const supported: PaymentProviderName[] = [
        "knet",
        "myfatoorah",
        "moyasar",
        "tap",
        "paytabs",
        "stripe",
        "mock",
      ];
      if (!supported.includes(providerParam)) {
        res.status(404).json({ error: "Unknown provider" });
        return;
      }
      const provider = service.getProvider(providerParam);
      const flatHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") flatHeaders[k] = v;
        else if (Array.isArray(v)) flatHeaders[k] = v.join(",");
      }
      const parsed = provider.parseWebhook(flatHeaders, req.body);
      if (!parsed.signatureValid) {
        // Persist nothing but log
        // eslint-disable-next-line no-console
        console.warn("[payments] webhook with invalid signature", {
          provider: providerParam,
          eventType: parsed.eventType,
        });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
      if (parsed.charge && parsed.charge.providerId) {
        // Locate the charge by providerId across all companies — webhooks
        // are not company-scoped. We use the businessEntities `code` index
        // via the service helper applied per match.
        const { businessEntities } = await import("@paperclipai/db");
        const { eq, and } = await import("drizzle-orm");
        const rows = await db
          .select({ id: businessEntities.id, companyId: businessEntities.companyId })
          .from(businessEntities)
          .where(
            and(
              eq(businessEntities.moduleKey, "payments"),
              eq(businessEntities.entityType, "charge"),
              eq(businessEntities.code, parsed.charge.providerId),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (row) {
          const existing = await service.getCharge(row.companyId, row.id);
          const merged = existing
            ? {
                ...existing.charge,
                status: parsed.charge.status,
                metadata: { ...existing.charge.metadata, ...parsed.charge.metadata },
                paidAt: parsed.charge.paidAt ?? existing.charge.paidAt,
                errorMessage:
                  parsed.charge.errorMessage ?? existing.charge.errorMessage,
              }
            : parsed.charge;
          await service.updateChargeStatus(
            row.companyId,
            parsed.charge.providerId,
            merged,
          );
        }
      }
      res.json({ ok: true, eventType: parsed.eventType });
    },
  );

  return router;
}
