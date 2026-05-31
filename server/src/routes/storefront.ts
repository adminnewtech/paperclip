import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosStore,
  bosCollection,
  bosChannel,
  bosChannelListing,
  bosDiscount,
  bosShippingZone,
  bosShippingRate,
  bosOnlineOrder,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { onlineCheckout, fulfillOrder } from "../services/storefront-checkout.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const storeCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  slug: z.string().trim().max(500).optional().nullable(),
  domain: z.string().trim().max(500).optional().nullable(),
  theme: z.record(z.unknown()).optional(),
  currency: z.string().trim().length(3).optional().default("KWD"),
  status: z.string().trim().max(50).optional(),
  seo: z.record(z.unknown()).optional(),
});

const storeUpdateSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  slug: z.string().trim().max(500).optional().nullable(),
  domain: z.string().trim().max(500).optional().nullable(),
  theme: z.record(z.unknown()).optional(),
  currency: z.string().trim().length(3).optional(),
  status: z.string().trim().max(50).optional(),
  seo: z.record(z.unknown()).optional(),
});

const collectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  slug: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  productIds: z.array(z.string().uuid()).optional(),
  imageUrl: z.string().trim().max(2000).optional().nullable(),
});

const channelCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  kind: z.enum(["online", "pos", "marketplace", "social"]).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

const listingCreateSchema = z.object({
  channelId: z.string().uuid(),
  productId: z.string().uuid().optional().nullable(),
  variantId: z.string().uuid().optional().nullable(),
  listed: z.boolean().optional(),
  priceOverrideMinor: z.number().int().nonnegative().optional().nullable(),
});

const discountCreateSchema = z.object({
  code: z.string().trim().max(100).optional().nullable(),
  name: z.string().trim().min(1).max(500),
  kind: z.enum(["percentage", "fixed", "free_shipping"]),
  valueBps: z.number().int().nonnegative().optional().default(0),
  valueMinor: z.number().int().nonnegative().optional().default(0),
  minOrderMinor: z.number().int().nonnegative().optional().default(0),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  usageLimit: z.number().int().positive().optional().nullable(),
  status: z.string().trim().max(50).optional(),
});

const shippingZoneCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  countries: z.array(z.string().trim().max(100)).optional(),
  areas: z.array(z.string().trim().max(200)).optional(),
});

const shippingRateCreateSchema = z.object({
  zoneId: z.string().uuid(),
  name: z.string().trim().min(1).max(500),
  priceMinor: z.number().int().nonnegative().optional().default(0),
  minOrderFreeMinor: z.number().int().nonnegative().optional().nullable(),
  estDays: z.string().trim().max(100).optional().nullable(),
});

const checkoutLineSchema = z.object({
  variantId: z.string().uuid(),
  qty: z.number().int().positive(),
  unitPriceMinor: z.number().int().nonnegative(),
});

const checkoutSchema = z.object({
  warehouseId: z.string().uuid(),
  lines: z.array(checkoutLineSchema).min(1),
  discountCode: z.string().trim().max(100).optional(),
  shippingRateId: z.string().uuid().optional(),
  customerName: z.string().trim().max(500).optional(),
  customerEmail: z.string().trim().max(500).optional(),
  taxRatePct: z.number().min(0).max(100).optional().default(0),
  currency: z.string().trim().length(3).optional().default("KWD"),
});

const fulfillSchema = z.object({
  warehouseId: z.string().uuid().optional(),
});

export function storefrontRoutes(db: Db) {
  const router = Router();

  // ---------- Stores ----------
  router.get("/companies/:companyId/stores", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosStore)
      .where(eq(bosStore.companyId, companyId))
      .orderBy(desc(bosStore.createdAt));
    res.json({ stores: rows });
  });

  router.post(
    "/companies/:companyId/stores",
    validate(storeCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof storeCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosStore)
        .values({
          companyId,
          name: body.name,
          slug: body.slug ?? null,
          domain: body.domain ?? null,
          theme: body.theme ?? {},
          currency: body.currency,
          status: body.status ?? "draft",
          seo: body.seo ?? {},
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "storefront.store_created",
          entityType: "bos_store",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  router.put(
    "/stores/:id",
    validate(storeUpdateSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const body = req.body as z.infer<typeof storeUpdateSchema>;

      const [existing] = await db
        .select({ companyId: bosStore.companyId })
        .from(bosStore)
        .where(eq(bosStore.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Store not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const actor = getActorInfo(req);

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) patch.name = body.name;
      if (body.slug !== undefined) patch.slug = body.slug;
      if (body.domain !== undefined) patch.domain = body.domain;
      if (body.theme !== undefined) patch.theme = body.theme;
      if (body.currency !== undefined) patch.currency = body.currency;
      if (body.status !== undefined) patch.status = body.status;
      if (body.seo !== undefined) patch.seo = body.seo;

      const [row] = await db
        .update(bosStore)
        .set(patch)
        .where(eq(bosStore.id, id))
        .returning();

      if (row) {
        await logActivity(db, {
          companyId: existing.companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "storefront.store_updated",
          entityType: "bos_store",
          entityId: row.id,
          details: { status: row.status },
        });
      }

      res.json(row);
    },
  );

  // ---------- Collections ----------
  router.get("/companies/:companyId/collections", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosCollection)
      .where(eq(bosCollection.companyId, companyId))
      .orderBy(desc(bosCollection.createdAt));
    res.json({ collections: rows });
  });

  router.post(
    "/companies/:companyId/collections",
    validate(collectionCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof collectionCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosCollection)
        .values({
          companyId,
          name: body.name,
          slug: body.slug ?? null,
          description: body.description ?? null,
          productIds: body.productIds ?? [],
          imageUrl: body.imageUrl ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "storefront.collection_created",
          entityType: "bos_collection",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Channels ----------
  router.get("/companies/:companyId/channels", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosChannel)
      .where(eq(bosChannel.companyId, companyId))
      .orderBy(desc(bosChannel.createdAt));
    res.json({ channels: rows });
  });

  router.post(
    "/companies/:companyId/channels",
    validate(channelCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof channelCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosChannel)
        .values({
          companyId,
          name: body.name,
          kind: body.kind ?? null,
          enabled: body.enabled ?? true,
          config: body.config ?? {},
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "storefront.channel_created",
          entityType: "bos_channel",
          entityId: row.id,
          details: { name: row.name, kind: row.kind },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Channel listings ----------
  router.get("/companies/:companyId/channel-listings", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const channelId =
      typeof req.query.channelId === "string" ? req.query.channelId : null;
    const conditions = [eq(bosChannelListing.companyId, companyId)];
    if (channelId) {
      conditions.push(eq(bosChannelListing.channelId, channelId));
    }
    const rows = await db
      .select()
      .from(bosChannelListing)
      .where(and(...conditions))
      .orderBy(desc(bosChannelListing.createdAt));
    res.json({ listings: rows });
  });

  router.post(
    "/companies/:companyId/channel-listings",
    validate(listingCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof listingCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosChannelListing)
        .values({
          companyId,
          channelId: body.channelId,
          productId: body.productId ?? null,
          variantId: body.variantId ?? null,
          listed: body.listed ?? true,
          priceOverrideMinor: body.priceOverrideMinor ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "storefront.listing_created",
          entityType: "bos_channel_listing",
          entityId: row.id,
          details: { channelId: row.channelId, productId: row.productId },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Discounts ----------
  router.get("/companies/:companyId/discounts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosDiscount)
      .where(eq(bosDiscount.companyId, companyId))
      .orderBy(desc(bosDiscount.createdAt));
    res.json({ discounts: rows });
  });

  router.post(
    "/companies/:companyId/discounts",
    validate(discountCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof discountCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosDiscount)
        .values({
          companyId,
          code: body.code ?? null,
          name: body.name,
          kind: body.kind,
          valueBps: body.valueBps,
          valueMinor: body.valueMinor,
          minOrderMinor: body.minOrderMinor,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          usageLimit: body.usageLimit ?? null,
          status: body.status ?? "active",
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "storefront.discount_created",
          entityType: "bos_discount",
          entityId: row.id,
          details: { code: row.code, kind: row.kind },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Shipping zones ----------
  router.get("/companies/:companyId/shipping-zones", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosShippingZone)
      .where(eq(bosShippingZone.companyId, companyId))
      .orderBy(desc(bosShippingZone.createdAt));
    res.json({ shippingZones: rows });
  });

  router.post(
    "/companies/:companyId/shipping-zones",
    validate(shippingZoneCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof shippingZoneCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosShippingZone)
        .values({
          companyId,
          name: body.name,
          countries: body.countries ?? [],
          areas: body.areas ?? [],
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "storefront.shipping_zone_created",
          entityType: "bos_shipping_zone",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Shipping rates ----------
  router.get("/companies/:companyId/shipping-rates", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const zoneId =
      typeof req.query.zoneId === "string" ? req.query.zoneId : null;
    const conditions = [eq(bosShippingRate.companyId, companyId)];
    if (zoneId) {
      conditions.push(eq(bosShippingRate.zoneId, zoneId));
    }
    const rows = await db
      .select()
      .from(bosShippingRate)
      .where(and(...conditions))
      .orderBy(desc(bosShippingRate.createdAt));
    res.json({ shippingRates: rows });
  });

  router.post(
    "/companies/:companyId/shipping-rates",
    validate(shippingRateCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof shippingRateCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosShippingRate)
        .values({
          companyId,
          zoneId: body.zoneId,
          name: body.name,
          priceMinor: body.priceMinor,
          minOrderFreeMinor: body.minOrderFreeMinor ?? null,
          estDays: body.estDays ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "storefront.shipping_rate_created",
          entityType: "bos_shipping_rate",
          entityId: row.id,
          details: { name: row.name, zoneId: row.zoneId },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Online orders ----------
  router.get("/companies/:companyId/online-orders", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosOnlineOrder)
      .where(eq(bosOnlineOrder.companyId, companyId))
      .orderBy(desc(bosOnlineOrder.createdAt));
    res.json({ onlineOrders: rows });
  });

  router.post(
    "/companies/:companyId/storefront/checkout",
    validate(checkoutSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof checkoutSchema>;
      const actor = getActorInfo(req);

      let order;
      try {
        order = await onlineCheckout(db, {
          companyId,
          warehouseId: body.warehouseId,
          lines: body.lines,
          discountCode: body.discountCode,
          shippingRateId: body.shippingRateId,
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          taxRatePct: body.taxRatePct,
          currency: body.currency,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Checkout failed";
        if (message.startsWith("Insufficient stock")) {
          res.status(409).json({ error: message });
          return;
        }
        if (
          message.startsWith("Discount code") ||
          message.startsWith("Shipping rate")
        ) {
          res.status(400).json({ error: message });
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
        action: "storefront.checkout",
        entityType: "bos_online_order",
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

  router.post(
    "/online-orders/:id/fulfill",
    validate(fulfillSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const body = req.body as z.infer<typeof fulfillSchema>;

      const [existing] = await db
        .select({ companyId: bosOnlineOrder.companyId })
        .from(bosOnlineOrder)
        .where(eq(bosOnlineOrder.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Online order not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const actor = getActorInfo(req);

      const fulfillment = await fulfillOrder(db, {
        companyId: existing.companyId,
        orderId: id,
        warehouseId: body.warehouseId,
      });

      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "storefront.order_fulfilled",
        entityType: "bos_fulfillment",
        entityId: fulfillment.id,
        details: { onlineOrderId: id },
      });

      res.status(201).json(fulfillment);
    },
  );

  return router;
}
