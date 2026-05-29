import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
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

const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  sku: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(500).optional().nullable(),
  priceMinor: z.number().int().nonnegative(),
  costMinor: z.number().int().nonnegative().optional().nullable(),
  currency: z.string().trim().length(3).optional().default("KWD"),
  warehouseId: z.string().uuid().optional(),
  initialQty: z.number().int().nonnegative().optional().default(0),
  reorderPoint: z.number().int().nonnegative().optional().default(0),
});

const stockUpsertSchema = z.object({
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  qty: z.number().int().nonnegative(),
  reorderPoint: z.number().int().nonnegative().optional(),
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

  // ---------- Products ----------
  router.get("/companies/:companyId/products", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    // List products joined with their (default) variant + stock summary so the
    // POS product grid can show variantId + available qty.
    const rows = await db
      .select({
        id: bosProduct.id,
        name: bosProduct.name,
        sku: bosProduct.sku,
        category: bosProduct.category,
        priceMinor: bosProduct.priceMinor,
        costMinor: bosProduct.costMinor,
        currency: bosProduct.currency,
        status: bosProduct.status,
        createdAt: bosProduct.createdAt,
        updatedAt: bosProduct.updatedAt,
        variantId: bosProductVariant.id,
        qty: bosStock.qty,
      })
      .from(bosProduct)
      .leftJoin(
        bosProductVariant,
        eq(bosProductVariant.productId, bosProduct.id),
      )
      .leftJoin(bosStock, eq(bosStock.variantId, bosProductVariant.id))
      .where(eq(bosProduct.companyId, companyId))
      .orderBy(desc(bosProduct.createdAt));

    res.json({ products: rows });
  });

  router.post(
    "/companies/:companyId/products",
    validate(productCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof productCreateSchema>;
      const actor = getActorInfo(req);

      const result = await db.transaction(async (tx) => {
        const [product] = await tx
          .insert(bosProduct)
          .values({
            companyId,
            name: body.name,
            sku: body.sku ?? null,
            category: body.category ?? null,
            priceMinor: body.priceMinor,
            costMinor: body.costMinor ?? null,
            currency: body.currency,
            status: "active",
          })
          .returning();
        if (!product) {
          throw new Error("Failed to create product");
        }

        const [variant] = await tx
          .insert(bosProductVariant)
          .values({
            companyId,
            productId: product.id,
            sku: product.sku,
            attrs: {},
            priceDeltaMinor: 0,
          })
          .returning();
        if (!variant) {
          throw new Error("Failed to create product variant");
        }

        let stock: typeof bosStock.$inferSelect | null = null;
        if (body.warehouseId) {
          const [stockRow] = await tx
            .insert(bosStock)
            .values({
              companyId,
              variantId: variant.id,
              warehouseId: body.warehouseId,
              qty: body.initialQty,
              reorderPoint: body.reorderPoint,
            })
            .returning();
          stock = stockRow ?? null;
        }

        return { product, variant, stock };
      });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "commerce.product_created",
        entityType: "bos_product",
        entityId: result.product.id,
        details: {
          name: result.product.name,
          variantId: result.variant.id,
        },
      });

      res.status(201).json(result);
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

  router.post(
    "/companies/:companyId/stock",
    validate(stockUpsertSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof stockUpsertSchema>;
      const actor = getActorInfo(req);

      const updateSet: Record<string, unknown> = {
        qty: sql`excluded.qty`,
        updatedAt: sql`now()`,
      };
      if (body.reorderPoint !== undefined) {
        updateSet.reorderPoint = sql`excluded.reorder_point`;
      }

      const [row] = await db
        .insert(bosStock)
        .values({
          companyId,
          variantId: body.variantId,
          warehouseId: body.warehouseId,
          qty: body.qty,
          reorderPoint: body.reorderPoint ?? 0,
        })
        .onConflictDoUpdate({
          target: [bosStock.variantId, bosStock.warehouseId],
          set: updateSet,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "commerce.stock_upserted",
          entityType: "bos_stock",
          entityId: row.id,
          details: {
            variantId: row.variantId,
            warehouseId: row.warehouseId,
            qty: row.qty,
          },
        });
      }

      res.status(200).json(row);
    },
  );

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
