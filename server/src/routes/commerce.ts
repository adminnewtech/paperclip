import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosWarehouse,
  bosStock,
  bosProductVariant,
  bosProduct,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { posCheckout } from "../services/pos-checkout.js";

const checkoutLineSchema = z.object({
  variantId: z.string().uuid(),
  qty: z.number().int().positive(),
  unitPriceMinor: z.number().int().nonnegative(),
});

const checkoutSchema = z.object({
  warehouseId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  lines: z.array(checkoutLineSchema).min(1),
  paymentMethod: z.string().trim().min(1).max(100),
  customerName: z.string().trim().max(500).optional(),
  currency: z.string().trim().length(3).optional().default("KWD"),
  taxRatePct: z.number().min(0).max(100).optional().default(0),
});

const warehouseCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  location: z.string().trim().max(500).optional().nullable(),
  isDefault: z.boolean().optional(),
});

export function commerceRoutes(db: Db) {
  const router = Router();

  // ---------- Warehouses ----------
  router.get("/companies/:companyId/warehouses", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosWarehouse)
      .where(eq(bosWarehouse.companyId, companyId))
      .orderBy(desc(bosWarehouse.createdAt));
    res.json({ warehouses: rows });
  });

  router.post(
    "/companies/:companyId/warehouses",
    validate(warehouseCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof warehouseCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosWarehouse)
        .values({
          companyId,
          name: body.name,
          location: body.location ?? null,
          isDefault: body.isDefault ?? false,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "commerce.warehouse_created",
          entityType: "bos_warehouse",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Stock ----------
  router.get("/companies/:companyId/stock", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const warehouseId =
      typeof req.query.warehouseId === "string" ? req.query.warehouseId : null;

    const conditions = [eq(bosStock.companyId, companyId)];
    if (warehouseId) {
      conditions.push(eq(bosStock.warehouseId, warehouseId));
    }

    const rows = await db
      .select({
        id: bosStock.id,
        variantId: bosStock.variantId,
        warehouseId: bosStock.warehouseId,
        qty: bosStock.qty,
        reserved: bosStock.reserved,
        reorderPoint: bosStock.reorderPoint,
        variantSku: bosProductVariant.sku,
        variantBarcode: bosProductVariant.barcode,
        productId: bosProduct.id,
        productName: bosProduct.name,
      })
      .from(bosStock)
      .leftJoin(bosProductVariant, eq(bosProductVariant.id, bosStock.variantId))
      .leftJoin(bosProduct, eq(bosProduct.id, bosProductVariant.productId))
      .where(and(...conditions));
    res.json({ stock: rows });
  });

  // ---------- POS checkout ----------
  router.post(
    "/companies/:companyId/pos/checkout",
    validate(checkoutSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof checkoutSchema>;
      const actor = getActorInfo(req);

      let order;
      try {
        order = await posCheckout(db, {
          companyId,
          warehouseId: body.warehouseId,
          sessionId: body.sessionId,
          lines: body.lines,
          paymentMethod: body.paymentMethod,
          customerName: body.customerName,
          currency: body.currency,
          taxRatePct: body.taxRatePct,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Checkout failed";
        if (message.startsWith("Insufficient stock")) {
          res.status(409).json({ error: message });
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
        action: "commerce.pos_checkout",
        entityType: "bos_pos_order",
        entityId: order.id,
        details: {
          totalMinor: order.totalMinor,
          currency: order.currency,
          lineCount: body.lines.length,
        },
      });

      res.status(201).json(order);
    },
  );

  return router;
}
