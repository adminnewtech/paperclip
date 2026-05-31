import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosStockMove,
  bosOnlineOrder,
  bosDiscount,
  bosShippingRate,
  bosFulfillment,
  bosJournalEntry,
  bosJournalLine,
} from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Ledger account codes used by the online-order checkout journal entry.
// Mirrors POS_LEDGER_CODES in pos-checkout.ts.
// ---------------------------------------------------------------------------
export const STOREFRONT_LEDGER_CODES = {
  cash: "1000", // Asset: Cash / Cash on hand
  revenue: "4000", // Revenue: Sales
  vatPayable: "2100", // Liability: VAT payable
} as const;

const BPS_DENOMINATOR = 10_000; // 100% expressed in basis points

export interface OnlineCheckoutLine {
  variantId: string;
  qty: number;
  unitPriceMinor: number;
}

/** Subset of bos_discount needed to compute a discount amount. */
export interface DiscountInput {
  kind: string | null;
  valueBps: number;
  valueMinor: number;
  minOrderMinor: number;
}

/** Subset of bos_shipping_rate needed to compute shipping. */
export interface ShippingRateInput {
  priceMinor: number;
  minOrderFreeMinor: number | null;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
}

export interface JournalLineDraft {
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no DB).
// ---------------------------------------------------------------------------

/**
 * Compute the discount amount in minor units for a given subtotal. Returns 0
 * when the subtotal does not meet the discount's minimum order amount, or when
 * the discount is free shipping (handled separately in shipping). Percentage
 * discounts use basis points (valueBps), fixed discounts use valueMinor. The
 * result is clamped so it never exceeds the subtotal.
 */
export function applyDiscount(
  subtotalMinor: number,
  discount: DiscountInput | null | undefined,
): number {
  if (!discount) return 0;
  if (subtotalMinor < discount.minOrderMinor) return 0;

  let discountMinor = 0;
  if (discount.kind === "percentage") {
    discountMinor = Math.round((subtotalMinor * discount.valueBps) / BPS_DENOMINATOR);
  } else if (discount.kind === "fixed") {
    discountMinor = discount.valueMinor;
  } else {
    // free_shipping or unknown: no line discount.
    discountMinor = 0;
  }

  if (discountMinor < 0) return 0;
  return Math.min(discountMinor, subtotalMinor);
}

/**
 * Compute the shipping amount in minor units. Shipping is free when the
 * subtotal meets or exceeds the rate's free-shipping threshold; otherwise the
 * flat rate price applies. With no rate, shipping is 0.
 */
export function calcShipping(
  subtotalMinor: number,
  rate: ShippingRateInput | null | undefined,
): number {
  if (!rate) return 0;
  if (
    rate.minOrderFreeMinor != null &&
    rate.minOrderFreeMinor > 0 &&
    subtotalMinor >= rate.minOrderFreeMinor
  ) {
    return 0;
  }
  return Math.max(0, rate.priceMinor);
}

/**
 * Compute full order totals: subtotal from lines, discount, shipping, then tax
 * on the discounted subtotal, then total. All integer-safe in minor units.
 * Tax is applied to (subtotal - discount), not to shipping.
 */
export function computeOrderTotals(input: {
  lines: OnlineCheckoutLine[];
  discount?: DiscountInput | null;
  shippingRate?: ShippingRateInput | null;
  taxRatePct: number;
}): OrderTotals {
  const subtotal = input.lines.reduce(
    (sum, line) => sum + line.qty * line.unitPriceMinor,
    0,
  );
  const discount = applyDiscount(subtotal, input.discount);
  const shipping = calcShipping(subtotal, input.shippingRate);
  const taxableBase = Math.max(0, subtotal - discount);
  const tax = Math.round((taxableBase * input.taxRatePct) / 100);
  const total = subtotal - discount + shipping + tax;
  return { subtotal, discount, shipping, tax, total };
}

/**
 * Build a balanced set of journal lines for an online sale:
 *   Dr Cash (total) / Cr Revenue (subtotal - discount + shipping) / Cr VAT (tax)
 * The VAT line is omitted when tax is zero. Revenue captures net goods plus
 * shipping income so that debits always equal credits.
 */
export function buildOrderJournalLines(totals: OrderTotals): JournalLineDraft[] {
  const revenueMinor = totals.subtotal - totals.discount + totals.shipping;
  const lines: JournalLineDraft[] = [
    {
      accountCode: STOREFRONT_LEDGER_CODES.cash,
      debitMinor: totals.total,
      creditMinor: 0,
    },
    {
      accountCode: STOREFRONT_LEDGER_CODES.revenue,
      debitMinor: 0,
      creditMinor: revenueMinor,
    },
  ];
  if (totals.tax > 0) {
    lines.push({
      accountCode: STOREFRONT_LEDGER_CODES.vatPayable,
      debitMinor: 0,
      creditMinor: totals.tax,
    });
  }
  return lines;
}

/** True when total debits equal total credits across the journal lines. */
export function isOrderJournalBalanced(lines: JournalLineDraft[]): boolean {
  const debit = lines.reduce((sum, l) => sum + l.debitMinor, 0);
  const credit = lines.reduce((sum, l) => sum + l.creditMinor, 0);
  return debit === credit;
}

// ---------------------------------------------------------------------------
// Retry helper for serialization / deadlock failures (mirrors pos-checkout).
// ---------------------------------------------------------------------------
const RETRYABLE_PG_CODES = new Set(["40001", "40P01"]);
const MAX_ATTEMPTS = 3;

function isRetryableError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE_PG_CODES.has(code);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === MAX_ATTEMPTS - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Atomic online checkout.
// ---------------------------------------------------------------------------

type OnlineOrderRow = typeof bosOnlineOrder.$inferSelect;
type FulfillmentRow = typeof bosFulfillment.$inferSelect;

export interface OnlineCheckoutParams {
  companyId: string;
  warehouseId: string;
  lines: OnlineCheckoutLine[];
  discountCode?: string;
  shippingRateId?: string;
  customerName?: string;
  customerEmail?: string;
  taxRatePct: number;
  currency: string;
}

/**
 * Execute an atomic online-store checkout. The entire operation runs in a
 * single DB transaction: stock decrement, stock-move logging, discount
 * resolution + validation, total computation, order creation, and a balanced
 * double-entry journal either all commit or all roll back. Stock is decremented
 * with an atomic conditional UPDATE, preventing overselling under concurrency.
 * Serialization / deadlock failures are retried up to 3 times.
 */
export async function onlineCheckout(
  db: Db,
  params: OnlineCheckoutParams,
): Promise<OnlineOrderRow> {
  const {
    companyId,
    warehouseId,
    lines,
    discountCode,
    shippingRateId,
    customerName,
    customerEmail,
    taxRatePct,
    currency,
  } = params;

  if (lines.length === 0) {
    throw new Error("Checkout requires at least one line item");
  }
  for (const line of lines) {
    if (line.qty <= 0) {
      throw new Error(`Invalid quantity for variant ${line.variantId}`);
    }
  }

  return withRetry(() =>
    db.transaction(async (tx) => {
      // 1. Atomic conditional stock decrement per line (prevents oversell).
      for (const line of lines) {
        const res = await tx.execute(sql`
          UPDATE bos_stock
          SET qty = qty - ${line.qty}, updated_at = now()
          WHERE variant_id = ${line.variantId}
            AND warehouse_id = ${warehouseId}
            AND qty >= ${line.qty}
          RETURNING qty
        `);
        const affected =
          (res as { rows?: unknown[] }).rows?.length ??
          (res as unknown[]).length ??
          0;
        if (affected !== 1) {
          throw new Error(`Insufficient stock for variant ${line.variantId}`);
        }
      }

      // 2. Stock-move record per line (reason 'sale', negative delta).
      for (const line of lines) {
        await tx.insert(bosStockMove).values({
          companyId,
          variantId: line.variantId,
          warehouseId,
          delta: -line.qty,
          reason: "sale",
          ref: null,
        });
      }

      // 3. Resolve + validate discount (active, within dates, min order).
      let discountRow: typeof bosDiscount.$inferSelect | null = null;
      if (discountCode) {
        const [found] = await tx
          .select()
          .from(bosDiscount)
          .where(
            and(
              eq(bosDiscount.companyId, companyId),
              eq(bosDiscount.code, discountCode),
            ),
          )
          .limit(1);
        if (!found) {
          throw new Error(`Discount code not found: ${discountCode}`);
        }
        if (found.status !== "active") {
          throw new Error(`Discount code is not active: ${discountCode}`);
        }
        const now = Date.now();
        if (found.startsAt && new Date(found.startsAt).getTime() > now) {
          throw new Error(`Discount code is not yet active: ${discountCode}`);
        }
        if (found.endsAt && new Date(found.endsAt).getTime() < now) {
          throw new Error(`Discount code has expired: ${discountCode}`);
        }
        if (
          found.usageLimit != null &&
          found.usedCount >= found.usageLimit
        ) {
          throw new Error(`Discount code usage limit reached: ${discountCode}`);
        }
        discountRow = found;
      }

      // 4. Resolve shipping rate.
      let shippingRow: typeof bosShippingRate.$inferSelect | null = null;
      if (shippingRateId) {
        const [found] = await tx
          .select()
          .from(bosShippingRate)
          .where(
            and(
              eq(bosShippingRate.companyId, companyId),
              eq(bosShippingRate.id, shippingRateId),
            ),
          )
          .limit(1);
        if (!found) {
          throw new Error(`Shipping rate not found: ${shippingRateId}`);
        }
        shippingRow = found;
      }

      // 5. Compute totals.
      const totals = computeOrderTotals({
        lines,
        discount: discountRow
          ? {
              kind: discountRow.kind,
              valueBps: discountRow.valueBps,
              valueMinor: discountRow.valueMinor,
              minOrderMinor: discountRow.minOrderMinor,
            }
          : null,
        shippingRate: shippingRow
          ? {
              priceMinor: shippingRow.priceMinor,
              minOrderFreeMinor: shippingRow.minOrderFreeMinor,
            }
          : null,
        taxRatePct,
      });

      // 6. Balanced double-entry journal (assert debit == credit).
      const journalLines = buildOrderJournalLines(totals);
      if (!isOrderJournalBalanced(journalLines)) {
        throw new Error("Journal entry is not balanced (debit != credit)");
      }

      const [entry] = await tx
        .insert(bosJournalEntry)
        .values({
          companyId,
          memo: "Online sale",
        })
        .returning();
      if (!entry) {
        throw new Error("Failed to create journal entry");
      }

      await tx.insert(bosJournalLine).values(
        journalLines.map((jl) => ({
          companyId,
          entryId: entry.id,
          accountCode: jl.accountCode,
          debitMinor: jl.debitMinor,
          creditMinor: jl.creditMinor,
        })),
      );

      // 7. Insert the online order.
      const [order] = await tx
        .insert(bosOnlineOrder)
        .values({
          companyId,
          customerName: customerName ?? null,
          customerEmail: customerEmail ?? null,
          lines,
          subtotalMinor: totals.subtotal,
          discountMinor: totals.discount,
          shippingMinor: totals.shipping,
          taxMinor: totals.tax,
          totalMinor: totals.total,
          currency,
          status: "paid",
          channel: "online",
          discountCode: discountCode ?? null,
          journalEntryId: entry.id,
        })
        .returning();
      if (!order) {
        throw new Error("Failed to create online order");
      }

      // 8. Increment discount usage.
      if (discountRow) {
        await tx
          .update(bosDiscount)
          .set({
            usedCount: discountRow.usedCount + 1,
            updatedAt: sql`now()`,
          })
          .where(eq(bosDiscount.id, discountRow.id));
      }

      return order;
    }),
  );
}

// ---------------------------------------------------------------------------
// Fulfillment.
// ---------------------------------------------------------------------------

export interface FulfillOrderParams {
  companyId: string;
  orderId: string;
  warehouseId?: string;
}

/**
 * Create a fulfillment record for an online order and mark the order fulfilled.
 * Runs in a single transaction so both writes commit together.
 */
export async function fulfillOrder(
  db: Db,
  params: FulfillOrderParams,
): Promise<FulfillmentRow> {
  const { companyId, orderId, warehouseId } = params;

  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(bosOnlineOrder)
      .where(
        and(
          eq(bosOnlineOrder.companyId, companyId),
          eq(bosOnlineOrder.id, orderId),
        ),
      )
      .limit(1);
    if (!order) {
      throw new Error(`Online order not found: ${orderId}`);
    }

    const [fulfillment] = await tx
      .insert(bosFulfillment)
      .values({
        companyId,
        onlineOrderId: orderId,
        warehouseId: warehouseId ?? null,
        status: "pending",
      })
      .returning();
    if (!fulfillment) {
      throw new Error("Failed to create fulfillment");
    }

    await tx
      .update(bosOnlineOrder)
      .set({ status: "fulfilled", updatedAt: sql`now()` })
      .where(eq(bosOnlineOrder.id, orderId));

    return fulfillment;
  });
}
