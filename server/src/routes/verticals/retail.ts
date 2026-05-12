/**
 * REST endpoints for the Retail vertical.
 *
 * Every route is scoped by `:companyId` and gated by `assertCompanyAccess`.
 * The business logic lives in `services/verticals/retail`; this file is a
 * thin validation + dispatch shell.
 *
 * Endpoint groups:
 *   /companies/:companyId/business/retail/locations            CRUD
 *   /companies/:companyId/business/retail/products             CRUD + barcode lookup + stock
 *   /companies/:companyId/business/retail/sales                POS lifecycle
 *   /companies/:companyId/business/retail/loyalty/members      CRUD + points adjust
 *   /companies/:companyId/business/retail/transfers            create / ship / receive
 *   /companies/:companyId/business/retail/end-of-day           report + close
 *   /companies/:companyId/business/retail/dashboard            consolidated KPIs
 *   /companies/:companyId/business/retail/setup                seed defaults
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../../middleware/validate.js";
import { assertCompanyAccess } from "../authz.js";
import {
  createRetailService,
  type PaymentMethod,
} from "../../services/verticals/retail/index.js";

const stockMapSchema = z.record(z.string(), z.number().int().nonnegative());

const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(255),
  nameAr: z.string().trim().max(255).optional(),
  address: z.string().trim().max(1000).default(""),
  phone: z.string().trim().max(64).optional(),
  isMain: z.boolean().default(false),
  posTerminals: z.number().int().min(1).max(50).default(1),
});

const updateLocationSchema = createLocationSchema.partial();

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(500),
  nameAr: z.string().trim().max(500).optional(),
  barcode: z.string().trim().max(40).optional(),
  category: z.string().trim().max(100).default("general"),
  brand: z.string().trim().max(100).optional(),
  unitPriceCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative().optional(),
  taxRatePercent: z.number().min(0).max(100).default(5),
  imageUrl: z.string().url().max(2048).optional(),
  description: z.string().trim().max(2000).optional(),
  stockByLocation: stockMapSchema.default({}),
  reorderPoint: z.number().int().nonnegative().optional(),
  isActive: z.boolean().default(true),
});

const updateProductSchema = createProductSchema.partial();

const setStockSchema = z.object({
  locationId: z.string().uuid(),
  quantity: z.number().int().nonnegative(),
  reason: z.string().trim().max(255).optional(),
});

const startSaleSchema = z.object({
  locationId: z.string().uuid(),
  cashierId: z.string().trim().max(255).optional(),
});

const addItemSchema = z
  .object({
    barcode: z.string().trim().max(40).optional(),
    productId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(1000).default(1),
  })
  .refine((v) => v.barcode || v.productId, "barcode or productId required");

const discountSchema = z.object({
  type: z.enum(["amount", "percent"]),
  value: z.number().nonnegative(),
  reason: z.string().trim().max(255).optional(),
});

const paymentSchema = z.object({
  method: z.enum(["cash", "card", "knet", "loyalty", "store_credit"]),
  amountCents: z.number().int().nonnegative(),
});

const refundSchema = z.object({
  items: z.array(z.number().int().nonnegative()).optional(),
  reason: z.string().trim().min(1).max(500),
});

const enrollSchema = z.object({
  customerId: z.string().min(1),
  customerName: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(4).max(32),
  email: z.string().trim().email().optional(),
  birthMonth: z.number().int().min(1).max(12).optional(),
});

const adjustPointsSchema = z.object({
  points: z.number().int(),
  reason: z.string().trim().min(1).max(500),
});

const createTransferSchema = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1),
});

const closeEodSchema = z.object({
  locationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  actualCashCents: z.number().int().nonnegative(),
});

function asError(err: unknown): { status: number; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(message)) return { status: 404, message };
  if (/insufficient/i.test(message)) return { status: 409, message };
  return { status: 400, message };
}

export function retailRoutes(db: Db) {
  const router = Router();
  const service = createRetailService(db);

  // ----- Locations -----
  router.get("/companies/:companyId/business/retail/locations", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const locations = await service.listLocations(companyId);
    res.json({ locations });
  });

  router.post(
    "/companies/:companyId/business/retail/locations",
    validate(createLocationSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const location = await service.createLocation(
          companyId,
          req.body as z.infer<typeof createLocationSchema>,
        );
        res.status(201).json({ location });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.patch(
    "/companies/:companyId/business/retail/locations/:id",
    validate(updateLocationSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const location = await service.updateLocation(companyId, id, req.body);
        res.json({ location });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.delete(
    "/companies/:companyId/business/retail/locations/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      await service.deleteLocation(companyId, id);
      res.status(204).end();
    },
  );

  // ----- Products -----
  router.get("/companies/:companyId/business/retail/products", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const locationId =
      typeof req.query.locationId === "string" ? req.query.locationId : undefined;
    const lowStockOnly = req.query.lowStockOnly === "true";
    const products = await service.listProducts(companyId, {
      q,
      locationId,
      lowStockOnly,
    });
    res.json({ products });
  });

  router.get(
    "/companies/:companyId/business/retail/products/barcode/:barcode",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const barcode = req.params.barcode as string;
      assertCompanyAccess(req, companyId);
      const product = await service.getProductByBarcode(companyId, barcode);
      if (!product) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ product });
    },
  );

  router.post(
    "/companies/:companyId/business/retail/products",
    validate(createProductSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const product = await service.createProduct(
          companyId,
          req.body as z.infer<typeof createProductSchema>,
        );
        res.status(201).json({ product });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.patch(
    "/companies/:companyId/business/retail/products/:id",
    validate(updateProductSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const product = await service.updateProduct(companyId, id, req.body);
        res.json({ product });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/products/:id/stock",
    validate(setStockSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const body = req.body as z.infer<typeof setStockSchema>;
        const product = await service.setStock(
          companyId,
          id,
          body.locationId,
          body.quantity,
          body.reason,
        );
        res.json({ product });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  // ----- Sales -----
  router.get("/companies/:companyId/business/retail/sales", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const locationId =
      typeof req.query.locationId === "string" ? req.query.locationId : undefined;
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const status =
      typeof req.query.status === "string" ? (req.query.status as never) : undefined;
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) || 200 : 200;
    const sales = await service.listSales(companyId, { locationId, date, status, limit });
    res.json({ sales });
  });

  router.post(
    "/companies/:companyId/business/retail/sales",
    validate(startSaleSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof startSaleSchema>;
      const sale = await service.startSale(companyId, body.locationId, body.cashierId);
      res.status(201).json({ sale });
    },
  );

  router.get("/companies/:companyId/business/retail/sales/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const sale = await service.getSale(companyId, id);
    if (!sale) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ sale });
  });

  router.post(
    "/companies/:companyId/business/retail/sales/:id/items",
    validate(addItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const sale = await service.addItemToSale(
          companyId,
          id,
          req.body as z.infer<typeof addItemSchema>,
        );
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.delete(
    "/companies/:companyId/business/retail/sales/:id/items/:index",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      const index = Number(req.params.index);
      assertCompanyAccess(req, companyId);
      try {
        const sale = await service.removeItemFromSale(companyId, id, index);
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/sales/:id/discount",
    validate(discountSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const sale = await service.applyDiscount(
          companyId,
          id,
          req.body as z.infer<typeof discountSchema>,
        );
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/sales/:id/customer",
    validate(z.object({ customerId: z.string().min(1) })),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const sale = await service.attachCustomer(
          companyId,
          id,
          (req.body as { customerId: string }).customerId,
        );
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/sales/:id/loyalty",
    validate(z.object({ phone: z.string().min(4).max(32) })),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const sale = await service.attachLoyaltyMember(
          companyId,
          id,
          (req.body as { phone: string }).phone,
        );
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/sales/:id/redeem",
    validate(z.object({ points: z.number().int().min(0) })),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const sale = await service.redeemLoyaltyPoints(
          companyId,
          id,
          (req.body as { points: number }).points,
        );
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/sales/:id/payment",
    validate(paymentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const body = req.body as z.infer<typeof paymentSchema>;
        const sale = await service.takePayment(companyId, id, {
          method: body.method as PaymentMethod,
          amountCents: body.amountCents,
        });
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/sales/:id/complete",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const sale = await service.completeSale(companyId, id);
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/sales/:id/void",
    validate(z.object({ reason: z.string().min(1).max(500) })),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const sale = await service.voidSale(
          companyId,
          id,
          (req.body as { reason: string }).reason,
        );
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/sales/:id/refund",
    validate(refundSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const sale = await service.refundSale(
          companyId,
          id,
          req.body as z.infer<typeof refundSchema>,
        );
        res.json({ sale });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  // ----- Loyalty -----
  router.get(
    "/companies/:companyId/business/retail/loyalty/members",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const q = typeof req.query.q === "string" ? req.query.q : undefined;
      const tier = typeof req.query.tier === "string" ? req.query.tier : undefined;
      const members = await service.listLoyaltyMembers(companyId, { q, tier });
      res.json({ members });
    },
  );

  router.post(
    "/companies/:companyId/business/retail/loyalty/members",
    validate(enrollSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const member = await service.enrollLoyaltyMember(
          companyId,
          req.body as z.infer<typeof enrollSchema>,
        );
        res.status(201).json({ member });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.get(
    "/companies/:companyId/business/retail/loyalty/members/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const member = await service.getLoyaltyMember(companyId, id);
      if (!member) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ member });
    },
  );

  router.post(
    "/companies/:companyId/business/retail/loyalty/members/:id/adjust",
    validate(adjustPointsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const body = req.body as z.infer<typeof adjustPointsSchema>;
        const member = await service.adjustPoints(
          companyId,
          id,
          body.points,
          body.reason,
        );
        res.json({ member });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  // ----- Transfers -----
  router.get("/companies/:companyId/business/retail/transfers", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const transfers = await service.listTransfers(companyId);
    res.json({ transfers });
  });

  router.post(
    "/companies/:companyId/business/retail/transfers",
    validate(createTransferSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const transfer = await service.createTransfer(
          companyId,
          req.body as z.infer<typeof createTransferSchema>,
        );
        res.status(201).json({ transfer });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/transfers/:id/ship",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const transfer = await service.shipTransfer(companyId, id);
        res.json({ transfer });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/retail/transfers/:id/receive",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const transfer = await service.receiveTransfer(companyId, id);
        res.json({ transfer });
      } catch (err) {
        const e = asError(err);
        res.status(e.status).json({ error: e.message });
      }
    },
  );

  // ----- End of day -----
  router.get(
    "/companies/:companyId/business/retail/end-of-day",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const locationId =
        typeof req.query.locationId === "string" ? req.query.locationId : "";
      const date = typeof req.query.date === "string" ? req.query.date : "";
      if (!locationId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "locationId and date (YYYY-MM-DD) are required" });
        return;
      }
      const report = await service.getEndOfDayReport(companyId, locationId, date);
      res.json({ report });
    },
  );

  router.post(
    "/companies/:companyId/business/retail/end-of-day/close",
    validate(closeEodSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof closeEodSchema>;
      const report = await service.closeEndOfDay(
        companyId,
        body.locationId,
        body.date,
        body.actualCashCents,
      );
      res.json({ report });
    },
  );

  // ----- Dashboard + setup -----
  router.get(
    "/companies/:companyId/business/retail/dashboard",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const locationId =
        typeof req.query.locationId === "string" ? req.query.locationId : undefined;
      const dashboard = await service.getDashboard(companyId, { locationId });
      res.json({ dashboard });
    },
  );

  router.post("/companies/:companyId/business/retail/setup", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await service.setupDefaults(companyId);
    res.json({ ok: true });
  });

  return router;
}
