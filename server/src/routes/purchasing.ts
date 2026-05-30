import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosVendor,
  bosPurchaseOrder,
  bosPoLine,
  bosGoodsReceipt,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { receiveGoods, matchVendorBill } from "../services/purchasing.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const vendorCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  email: z.string().trim().max(500).optional().nullable(),
  phone: z.string().trim().max(100).optional().nullable(),
  taxId: z.string().trim().max(100).optional().nullable(),
  paymentTerms: z.string().trim().max(200).optional().nullable(),
  status: z.string().trim().max(50).optional(),
});

const poLineSchema = z.object({
  variantId: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  qty: z.number().int().positive(),
  unitPriceMinor: z.number().int().nonnegative(),
});

const poCreateSchema = z.object({
  vendorId: z.string().uuid().optional().nullable(),
  warehouseId: z.string().uuid().optional().nullable(),
  number: z.string().trim().max(100).optional().nullable(),
  currency: z.string().trim().length(3).optional().default("KWD"),
  taxRatePct: z.number().min(0).max(100).optional().default(0),
  lines: z.array(poLineSchema).min(1),
});

const receiveSchema = z.object({
  warehouseId: z.string().uuid().optional().nullable(),
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
});

const billSchema = z.object({
  billAmountMinor: z.number().int().nonnegative(),
  number: z.string().trim().max(100).optional().nullable(),
  currency: z.string().trim().length(3).optional().nullable(),
});

function computePoTotals(
  lines: Array<{ qty: number; unitPriceMinor: number }>,
  taxRatePct: number,
) {
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.qty * line.unitPriceMinor,
    0,
  );
  const taxMinor = Math.round((subtotalMinor * taxRatePct) / 100);
  const totalMinor = subtotalMinor + taxMinor;
  return { subtotalMinor, taxMinor, totalMinor };
}

export function purchasingRoutes(db: Db) {
  const router = Router();

  // ---------- Vendors ----------
  router.get("/companies/:companyId/purchasing/vendors", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosVendor)
      .where(eq(bosVendor.companyId, companyId))
      .orderBy(desc(bosVendor.createdAt));
    res.json({ vendors: rows });
  });

  router.post(
    "/companies/:companyId/purchasing/vendors",
    validate(vendorCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof vendorCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosVendor)
        .values({
          companyId,
          name: body.name,
          email: body.email ?? null,
          phone: body.phone ?? null,
          taxId: body.taxId ?? null,
          paymentTerms: body.paymentTerms ?? null,
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
          action: "purchasing.vendor_created",
          entityType: "bos_vendor",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------- Purchase orders ----------
  router.get("/companies/:companyId/purchasing/orders", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosPurchaseOrder)
      .where(eq(bosPurchaseOrder.companyId, companyId))
      .orderBy(desc(bosPurchaseOrder.createdAt));
    res.json({ orders: rows });
  });

  router.get(
    "/companies/:companyId/purchasing/orders/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const poId = req.params.id as string;
      assertCompanyAccess(req, companyId);

      const [order] = await db
        .select()
        .from(bosPurchaseOrder)
        .where(
          and(
            eq(bosPurchaseOrder.id, poId),
            eq(bosPurchaseOrder.companyId, companyId),
          ),
        );
      if (!order) {
        res.status(404).json({ error: "Purchase order not found" });
        return;
      }

      const lines = await db
        .select()
        .from(bosPoLine)
        .where(
          and(eq(bosPoLine.poId, poId), eq(bosPoLine.companyId, companyId)),
        );

      const receipts = await db
        .select()
        .from(bosGoodsReceipt)
        .where(
          and(
            eq(bosGoodsReceipt.poId, poId),
            eq(bosGoodsReceipt.companyId, companyId),
          ),
        )
        .orderBy(desc(bosGoodsReceipt.receivedAt));

      res.json({ order, lines, receipts });
    },
  );

  router.post(
    "/companies/:companyId/purchasing/orders",
    validate(poCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof poCreateSchema>;
      const actor = getActorInfo(req);

      const totals = computePoTotals(body.lines, body.taxRatePct);

      const result = await db.transaction(async (tx) => {
        const [order] = await tx
          .insert(bosPurchaseOrder)
          .values({
            companyId,
            number: body.number ?? null,
            vendorId: body.vendorId ?? null,
            warehouseId: body.warehouseId ?? null,
            status: "draft",
            subtotalMinor: totals.subtotalMinor,
            taxMinor: totals.taxMinor,
            totalMinor: totals.totalMinor,
            currency: body.currency,
          })
          .returning();
        if (!order) {
          throw new Error("Failed to create purchase order");
        }

        const lines = await tx
          .insert(bosPoLine)
          .values(
            body.lines.map((line) => ({
              companyId,
              poId: order.id,
              variantId: line.variantId ?? null,
              description: line.description ?? null,
              qty: line.qty,
              unitPriceMinor: line.unitPriceMinor,
            })),
          )
          .returning();

        return { order, lines };
      });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "purchasing.po_created",
        entityType: "bos_purchase_order",
        entityId: result.order.id,
        details: {
          totalMinor: result.order.totalMinor,
          currency: result.order.currency,
          lineCount: result.lines.length,
        },
      });

      res.status(201).json(result);
    },
  );

  router.post(
    "/companies/:companyId/purchasing/orders/:id/send",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const poId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      const [order] = await db
        .update(bosPurchaseOrder)
        .set({ status: "sent" })
        .where(
          and(
            eq(bosPurchaseOrder.id, poId),
            eq(bosPurchaseOrder.companyId, companyId),
          ),
        )
        .returning();
      if (!order) {
        res.status(404).json({ error: "Purchase order not found" });
        return;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "purchasing.po_sent",
        entityType: "bos_purchase_order",
        entityId: order.id,
      });

      res.json(order);
    },
  );

  router.post(
    "/companies/:companyId/purchasing/orders/:id/receive",
    validate(receiveSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const poId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof receiveSchema>;
      const actor = getActorInfo(req);

      let result;
      try {
        result = await receiveGoods(db, {
          companyId,
          poId,
          warehouseId: body.warehouseId ?? null,
          lines: body.lines,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Receiving failed";
        if (message === "Purchase order not found") {
          res.status(404).json({ error: message });
          return;
        }
        if (message === "A warehouse is required to receive goods") {
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
        action: "purchasing.po_received",
        entityType: "bos_purchase_order",
        entityId: poId,
        details: { receiptId: result.receipt.id, lineCount: body.lines.length },
      });

      res.status(201).json(result);
    },
  );

  router.post(
    "/companies/:companyId/purchasing/orders/:id/bill",
    validate(billSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const poId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof billSchema>;
      const actor = getActorInfo(req);

      let result;
      try {
        result = await matchVendorBill(db, {
          companyId,
          poId,
          billAmountMinor: body.billAmountMinor,
          number: body.number ?? null,
          currency: body.currency ?? null,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Billing failed";
        if (message === "Purchase order not found") {
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
        action: "purchasing.po_billed",
        entityType: "bos_vendor_bill",
        entityId: result.bill.id,
        details: { matched: result.matched, variance: result.variance },
      });

      res.status(201).json(result);
    },
  );

  return router;
}
