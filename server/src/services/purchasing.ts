import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosStock,
  bosStockMove,
  bosPoLine,
  bosPurchaseOrder,
  bosGoodsReceipt,
  bosVendorBill,
} from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReceiptLine {
  variantId: string;
  qty: number;
}

export interface ReceiveGoodsParams {
  companyId: string;
  poId: string;
  warehouseId?: string | null;
  lines: ReceiptLine[];
}

export interface MatchVendorBillParams {
  companyId: string;
  poId: string;
  billAmountMinor: number;
  number?: string | null;
  vendorId?: string | null;
  currency?: string | null;
}

export interface ThreeWayMatchResult {
  matched: boolean;
  variance: number;
}

// ---------------------------------------------------------------------------
// Pure helper — 3-way match (PO total vs received value vs bill amount).
// ---------------------------------------------------------------------------

/**
 * Three-way match for accounts payable. Compares the purchase-order total, the
 * value of goods actually received, and the vendor bill amount. The bill is
 * considered matched when all three figures agree within `tolerancePct` of the
 * PO total. The reported `variance` is the largest absolute pairwise gap
 * (in minor units) between the three values, so any leg out of tolerance is
 * surfaced. All math is integer-safe in minor units.
 */
export function threeWayMatch(
  poTotal: number,
  receivedValue: number,
  billAmount: number,
  tolerancePct: number,
): ThreeWayMatchResult {
  const variance = Math.max(
    Math.abs(poTotal - receivedValue),
    Math.abs(poTotal - billAmount),
    Math.abs(receivedValue - billAmount),
  );
  // Tolerance is measured against the PO total (the contracted amount). When
  // the PO total is zero we require an exact match.
  const allowed = Math.abs((poTotal * tolerancePct) / 100);
  const matched = variance <= allowed;
  return { matched, variance };
}

const DEFAULT_TOLERANCE_PCT = 2;

// ---------------------------------------------------------------------------
// Receive goods — atomic stock increment + receipt + PO line/status update.
// ---------------------------------------------------------------------------

type PurchaseOrderRow = typeof bosPurchaseOrder.$inferSelect;
type GoodsReceiptRow = typeof bosGoodsReceipt.$inferSelect;

export interface ReceiveGoodsResult {
  receipt: GoodsReceiptRow;
  order: PurchaseOrderRow;
}

/**
 * Receive goods against a purchase order. The whole operation runs in a single
 * DB transaction: per-line stock is incremented (upsert, matching the commerce
 * pattern), a stock-move row is logged with reason 'purchase', a goods-receipt
 * record is written, each PO line's received_qty is bumped, and the PO status
 * advances to 'received'. Either everything commits or everything rolls back.
 */
export async function receiveGoods(
  db: Db,
  params: ReceiveGoodsParams,
): Promise<ReceiveGoodsResult> {
  const { companyId, poId, lines } = params;

  if (lines.length === 0) {
    throw new Error("Receipt requires at least one line item");
  }

  return db.transaction(async (tx) => {
    // 1. Load the PO (scoped to company) and resolve the target warehouse.
    const [order] = await tx
      .select()
      .from(bosPurchaseOrder)
      .where(
        and(
          eq(bosPurchaseOrder.id, poId),
          eq(bosPurchaseOrder.companyId, companyId),
        ),
      );
    if (!order) {
      throw new Error("Purchase order not found");
    }
    const warehouseId = params.warehouseId ?? order.warehouseId;
    if (!warehouseId) {
      throw new Error("A warehouse is required to receive goods");
    }

    // 2. Increment stock per line (upsert) + log a stock move.
    for (const line of lines) {
      if (line.qty <= 0) {
        throw new Error(`Invalid quantity for variant ${line.variantId}`);
      }
      await tx
        .insert(bosStock)
        .values({
          companyId,
          variantId: line.variantId,
          warehouseId,
          qty: line.qty,
        })
        .onConflictDoUpdate({
          target: [bosStock.variantId, bosStock.warehouseId],
          set: {
            qty: sql`${bosStock.qty} + ${line.qty}`,
            updatedAt: sql`now()`,
          },
        });

      await tx.insert(bosStockMove).values({
        companyId,
        variantId: line.variantId,
        warehouseId,
        delta: line.qty,
        reason: "purchase",
        ref: poId,
      });
    }

    // 3. Persist the goods receipt.
    const [receipt] = await tx
      .insert(bosGoodsReceipt)
      .values({
        companyId,
        poId,
        warehouseId,
        lines,
      })
      .returning();
    if (!receipt) {
      throw new Error("Failed to create goods receipt");
    }

    // 4. Bump received_qty on each matching PO line.
    for (const line of lines) {
      await tx
        .update(bosPoLine)
        .set({
          receivedQty: sql`${bosPoLine.receivedQty} + ${line.qty}`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(bosPoLine.poId, poId),
            eq(bosPoLine.companyId, companyId),
            eq(bosPoLine.variantId, line.variantId),
          ),
        );
    }

    // 5. Advance PO status to 'received'.
    const [updatedOrder] = await tx
      .update(bosPurchaseOrder)
      .set({ status: "received", updatedAt: sql`now()` })
      .where(
        and(
          eq(bosPurchaseOrder.id, poId),
          eq(bosPurchaseOrder.companyId, companyId),
        ),
      )
      .returning();

    return { receipt, order: updatedOrder ?? order };
  });
}

// ---------------------------------------------------------------------------
// Match vendor bill — 3-way match against PO + received goods.
// ---------------------------------------------------------------------------

type VendorBillRow = typeof bosVendorBill.$inferSelect;

export interface MatchVendorBillResult extends ThreeWayMatchResult {
  bill: VendorBillRow;
}

/**
 * Record a vendor bill and run a three-way match against the purchase order.
 * The received value is computed from PO lines (received_qty * unit_price). The
 * bill is flagged `matched` when the PO total, received value and bill amount
 * agree within tolerance; otherwise the variance is recorded for review and the
 * PO is moved to 'billed' regardless so the workflow can proceed.
 */
export async function matchVendorBill(
  db: Db,
  params: MatchVendorBillParams,
): Promise<MatchVendorBillResult> {
  const { companyId, poId, billAmountMinor } = params;

  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(bosPurchaseOrder)
      .where(
        and(
          eq(bosPurchaseOrder.id, poId),
          eq(bosPurchaseOrder.companyId, companyId),
        ),
      );
    if (!order) {
      throw new Error("Purchase order not found");
    }

    const poLines = await tx
      .select()
      .from(bosPoLine)
      .where(
        and(eq(bosPoLine.poId, poId), eq(bosPoLine.companyId, companyId)),
      );

    const receivedValue = poLines.reduce(
      (sum, line) => sum + line.receivedQty * line.unitPriceMinor,
      0,
    );

    const { matched, variance } = threeWayMatch(
      order.totalMinor,
      receivedValue,
      billAmountMinor,
      DEFAULT_TOLERANCE_PCT,
    );

    const [bill] = await tx
      .insert(bosVendorBill)
      .values({
        companyId,
        poId,
        vendorId: params.vendorId ?? order.vendorId,
        number: params.number ?? null,
        amountMinor: billAmountMinor,
        currency: params.currency ?? order.currency,
        status: matched ? "matched" : "variance",
        matched,
      })
      .returning();
    if (!bill) {
      throw new Error("Failed to create vendor bill");
    }

    await tx
      .update(bosPurchaseOrder)
      .set({ status: "billed", updatedAt: sql`now()` })
      .where(
        and(
          eq(bosPurchaseOrder.id, poId),
          eq(bosPurchaseOrder.companyId, companyId),
        ),
      );

    return { matched, variance, bill };
  });
}
