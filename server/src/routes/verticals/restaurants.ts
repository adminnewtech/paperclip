// ---------------------------------------------------------------------------
// Restaurants vertical routes
// ---------------------------------------------------------------------------
//
// Every endpoint is scoped to a company and gated by assertCompanyAccess.
// All money values are integer minor units (fils / cents).

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../../middleware/validate.js";
import { assertCompanyAccess } from "../authz.js";
import { createRestaurantService } from "../../services/verticals/restaurants/index.js";

const modifierOptionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().max(120).default(""),
  priceCents: z.number().int(),
});

const modifierGroupSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().max(120).default(""),
  required: z.boolean().default(false),
  minSelections: z.number().int().nonnegative().default(0),
  maxSelections: z.number().int().nonnegative().default(1),
  options: z.array(modifierOptionSchema).default([]),
});

const stationSchema = z.enum(["kitchen", "bar", "grill", "cold"]);

const createMenuItemSchema = z.object({
  code: z.string().trim().max(64).optional(),
  name: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().max(200).optional(),
  category: z.string().trim().min(1).max(120),
  priceCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative().optional(),
  description: z.string().trim().max(2000).optional(),
  descriptionAr: z.string().trim().max(2000).optional(),
  imageUrl: z.string().trim().max(2048).optional(),
  modifiers: z.array(modifierGroupSchema).optional(),
  isAvailable: z.boolean().optional(),
  preparationTimeMinutes: z.number().int().nonnegative().optional(),
  taxable: z.boolean().optional(),
  station: stationSchema.optional(),
});

const updateMenuItemSchema = createMenuItemSchema.partial();

const tableAreaSchema = z.enum(["main", "outdoor", "vip", "bar"]);
const tableStatusSchema = z.enum([
  "available",
  "occupied",
  "reserved",
  "cleaning",
]);

const createTableSchema = z.object({
  code: z.string().trim().max(64).optional(),
  name: z.string().trim().min(1).max(120),
  capacity: z.number().int().positive(),
  area: tableAreaSchema.optional(),
  status: tableStatusSchema.optional(),
  position: z
    .object({ x: z.number(), y: z.number() })
    .optional(),
});

const updateTableSchema = createTableSchema.partial();

const orderTypeSchema = z.enum(["dine_in", "takeout", "delivery"]);
const deliveryProviderSchema = z.enum([
  "talabat",
  "deliveroo",
  "jahez",
  "own",
]);

const orderItemInputSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  modifiers: z
    .array(z.object({ name: z.string().trim().min(1) }))
    .optional(),
  notes: z.string().trim().max(500).optional(),
});

const createOrderSchema = z.object({
  type: orderTypeSchema,
  tableId: z.string().uuid().optional(),
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(64).optional(),
  deliveryAddress: z.string().trim().max(500).optional(),
  deliveryProvider: deliveryProviderSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(orderItemInputSchema).optional(),
});

const addItemSchema = orderItemInputSchema;

const discountSchema = z.object({
  discountCents: z.number().int().nonnegative(),
  reason: z.string().trim().max(200).optional(),
});

const paymentSchema = z.object({
  method: z.enum(["cash", "card", "knet", "online"]),
  amountCents: z.number().int().positive(),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

const voidItemSchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

export function restaurantsRoutes(db: Db) {
  const router = Router();
  const service = createRestaurantService(db);

  // ---------------- Menu ----------------
  router.get(
    "/companies/:companyId/business/restaurants/menu",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const category =
        typeof req.query.category === "string" ? req.query.category : undefined;
      const availableParam = req.query.available;
      const available =
        availableParam === "true"
          ? true
          : availableParam === "false"
            ? false
            : undefined;
      const items = await service.listMenuItems(companyId, {
        category,
        available,
      });
      res.json({ items });
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/menu",
    validate(createMenuItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const item = await service.createMenuItem(
        companyId,
        req.body as z.infer<typeof createMenuItemSchema>,
      );
      res.status(201).json(item);
    },
  );

  router.get(
    "/companies/:companyId/business/restaurants/menu/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const item = await service.getMenuItem(
        companyId,
        req.params.id as string,
      );
      if (!item) {
        res.status(404).json({ error: "Menu item not found" });
        return;
      }
      res.json(item);
    },
  );

  router.put(
    "/companies/:companyId/business/restaurants/menu/:id",
    validate(updateMenuItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const item = await service.updateMenuItem(
        companyId,
        req.params.id as string,
        req.body as z.infer<typeof updateMenuItemSchema>,
      );
      res.json(item);
    },
  );

  router.delete(
    "/companies/:companyId/business/restaurants/menu/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await service.deleteMenuItem(companyId, req.params.id as string);
      res.status(204).end();
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/menu/:id/availability",
    validate(z.object({ available: z.boolean() })),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const item = await service.toggleAvailability(
        companyId,
        req.params.id as string,
        Boolean((req.body as { available: boolean }).available),
      );
      res.json(item);
    },
  );

  // ---------------- Tables ----------------
  router.get(
    "/companies/:companyId/business/restaurants/tables",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const tables = await service.listTables(companyId);
      res.json({ tables });
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/tables",
    validate(createTableSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const table = await service.createTable(
        companyId,
        req.body as z.infer<typeof createTableSchema>,
      );
      res.status(201).json(table);
    },
  );

  router.put(
    "/companies/:companyId/business/restaurants/tables/:id",
    validate(updateTableSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const table = await service.updateTable(
        companyId,
        req.params.id as string,
        req.body as z.infer<typeof updateTableSchema>,
      );
      res.json(table);
    },
  );

  router.delete(
    "/companies/:companyId/business/restaurants/tables/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await service.deleteTable(companyId, req.params.id as string);
      res.status(204).end();
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/tables/:id/status",
    validate(z.object({ status: tableStatusSchema })),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const table = await service.setTableStatus(
        companyId,
        req.params.id as string,
        (req.body as { status: z.infer<typeof tableStatusSchema> }).status,
      );
      res.json(table);
    },
  );

  // ---------------- Orders ----------------
  router.get(
    "/companies/:companyId/business/restaurants/orders",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const type =
        typeof req.query.type === "string" ? req.query.type : undefined;
      const date =
        typeof req.query.date === "string" ? req.query.date : undefined;
      const orders = await service.listOrders(companyId, {
        status: status as never,
        type: type as never,
        date,
      });
      res.json({ orders });
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders",
    validate(createOrderSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const order = await service.createOrder(
        companyId,
        req.body as z.infer<typeof createOrderSchema>,
      );
      res.status(201).json(order);
    },
  );

  router.get(
    "/companies/:companyId/business/restaurants/orders/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const order = await service.getOrder(
        companyId,
        req.params.id as string,
      );
      if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      res.json(order);
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders/:id/items",
    validate(addItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const order = await service.addItemToOrder(
        companyId,
        req.params.id as string,
        req.body as z.infer<typeof addItemSchema>,
      );
      res.json(order);
    },
  );

  router.delete(
    "/companies/:companyId/business/restaurants/orders/:id/items/:index",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const idx = parseInt(req.params.index as string, 10);
      const order = await service.removeItemFromOrder(
        companyId,
        req.params.id as string,
        idx,
      );
      res.json(order);
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders/:id/items/:index/void",
    validate(voidItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const idx = parseInt(req.params.index as string, 10);
      const order = await service.voidItem(
        companyId,
        req.params.id as string,
        idx,
        (req.body as { reason: string }).reason,
      );
      res.json(order);
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders/:id/send-to-kitchen",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const order = await service.sendToKitchen(
        companyId,
        req.params.id as string,
      );
      res.json(order);
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders/:id/serve",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const order = await service.markServed(
        companyId,
        req.params.id as string,
      );
      res.json(order);
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders/:id/discount",
    validate(discountSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof discountSchema>;
      const order = await service.applyDiscount(
        companyId,
        req.params.id as string,
        body.discountCents,
        body.reason,
      );
      res.json(order);
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders/:id/payments",
    validate(paymentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const order = await service.takePayment(
        companyId,
        req.params.id as string,
        req.body as z.infer<typeof paymentSchema>,
      );
      res.json(order);
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders/:id/close",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const order = await service.closeOrder(
        companyId,
        req.params.id as string,
      );
      res.json(order);
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders/:id/cancel",
    validate(cancelSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const order = await service.cancelOrder(
        companyId,
        req.params.id as string,
        (req.body as { reason: string }).reason,
      );
      res.json(order);
    },
  );

  // ---------------- Kitchen ----------------
  router.get(
    "/companies/:companyId/business/restaurants/kitchen",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const station =
        typeof req.query.station === "string" ? req.query.station : undefined;
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const tickets = await service.listKitchenTickets(companyId, {
        station,
        status,
      });
      res.json({ tickets });
    },
  );

  router.post(
    "/companies/:companyId/business/restaurants/orders/:id/items/:index/ready",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const idx = parseInt(req.params.index as string, 10);
      const order = await service.markItemReady(
        companyId,
        req.params.id as string,
        idx,
      );
      res.json(order);
    },
  );

  // ---------------- Setup + reports ----------------
  router.post(
    "/companies/:companyId/business/restaurants/setup-defaults",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await service.setupDefaults(companyId);
      res.json({ ok: true });
    },
  );

  router.get(
    "/companies/:companyId/business/restaurants/dashboard",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const dashboard = await service.getDashboard(companyId);
      res.json(dashboard);
    },
  );

  router.get(
    "/companies/:companyId/business/restaurants/z-report",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const date =
        typeof req.query.date === "string"
          ? req.query.date
          : new Date().toISOString().slice(0, 10);
      const report = await service.getZReport(companyId, date);
      res.json(report);
    },
  );

  return router;
}
