// ---------------------------------------------------------------------------
// POS engine — pure functions for restaurant order math
// ---------------------------------------------------------------------------
//
// All arithmetic uses integer minor units (fils / cents). The order subtotal
// is the sum of non-voided line totals (which already include modifier add-ons
// and quantities). Discounts apply to the post-modifier subtotal. The service
// charge is computed on (subtotal - discount). VAT is computed on
// (subtotal - discount + service charge), because in the GCC, VAT is generally
// charged on the *full* customer-facing price including service charge.

import type {
  KitchenTicket,
  Order,
  OrderItem,
} from "./index.js";

export interface PosCalculation {
  subtotalCents: number;
  discountCents: number;
  serviceChargeCents: number;
  vatCents: number;
  totalCents: number;
  vatBreakdown: Array<{ rate: number; amountCents: number }>;
}

export interface CalculateOrderOpts {
  discountCents?: number;
  serviceChargePercent?: number;
  vatRatePercent?: number;
}

function sumLineCents(items: OrderItem[]): number {
  let s = 0;
  for (const item of items) {
    if (item.voided) continue;
    s += Math.max(0, Math.round(item.lineTotalCents));
  }
  return s;
}

/**
 * Compute subtotal, discount, service charge, VAT, and grand total for a
 * restaurant order. All inputs and outputs are integer minor units.
 *
 * - subtotal      = sum of non-voided line totals
 * - taxable base  = subtotal - discount + service charge
 * - service       = round(percent% of (subtotal - discount))
 * - VAT           = round(percent% of taxable base)
 * - total         = subtotal - discount + service + VAT
 */
export function calculateOrder(
  items: OrderItem[],
  opts: CalculateOrderOpts = {},
): PosCalculation {
  const subtotal = sumLineCents(items);
  const discount = Math.min(
    Math.max(0, Math.round(opts.discountCents ?? 0)),
    subtotal,
  );
  const servicePct = Math.max(0, opts.serviceChargePercent ?? 0);
  const vatPct = Math.max(0, opts.vatRatePercent ?? 0);

  const postDiscount = subtotal - discount;
  const serviceCharge = Math.round((postDiscount * servicePct) / 100);
  const taxableBase = postDiscount + serviceCharge;
  const vat = Math.round((taxableBase * vatPct) / 100);
  const total = postDiscount + serviceCharge + vat;

  return {
    subtotalCents: subtotal,
    discountCents: discount,
    serviceChargeCents: serviceCharge,
    vatCents: vat,
    totalCents: total,
    vatBreakdown:
      vatPct > 0 ? [{ rate: vatPct, amountCents: vat }] : [],
  };
}

/**
 * Build a kitchen ticket for an order. Groups items by station (defaulting to
 * "kitchen" for items without an explicit station). Returns null when there's
 * nothing to fire (no non-voided, not-yet-served items). Use ageSeconds in the
 * UI for the color-coded "elapsed time" badge.
 */
export function buildKitchenTicket(order: Order): KitchenTicket | null {
  // Use the time the order was sent to the kitchen if available, else creation
  const startedAt = order.sentToKitchenAt ?? order.createdAt;
  const started = new Date(startedAt).getTime();
  const ageSeconds = Math.max(
    0,
    Math.round((Date.now() - started) / 1000),
  );

  const pending = order.items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(
      ({ item }) =>
        !item.voided &&
        item.status !== "served",
    );
  if (pending.length === 0) return null;

  // Use the most common station among pending items as the ticket's station.
  const stationCounts: Record<string, number> = {};
  for (const { item } of pending) {
    const s = item.station ?? "kitchen";
    stationCounts[s] = (stationCounts[s] ?? 0) + 1;
  }
  let station = "kitchen";
  let maxCount = 0;
  for (const [s, c] of Object.entries(stationCounts)) {
    if (c > maxCount) {
      maxCount = c;
      station = s;
    }
  }

  const allReady = pending.every((p) => p.item.status === "ready");
  const anyPreparing = pending.some(
    (p) => p.item.status === "preparing" || p.item.status === "ready",
  );
  const status: "new" | "preparing" | "ready" = allReady
    ? "ready"
    : anyPreparing
      ? "preparing"
      : "new";

  return {
    orderId: order.id,
    orderCode: order.code,
    tableName: order.tableName,
    station,
    items: pending.map(({ item, itemIndex }) => ({
      name: item.itemName,
      quantity: item.quantity,
      modifiers: item.modifiers.map((m) => m.name),
      notes: item.notes,
      itemIndex,
      status: item.status,
    })),
    createdAt: startedAt,
    ageSeconds,
    status,
  };
}

/**
 * Split an order into multiple bills. Each split lists the indexes of the
 * items it should own. Each resulting "order" is a calculation-only object
 * (not persisted) — it shares the same VAT and service percentages, but has
 * its own subtotal/totals.
 *
 * Items not assigned to any split go to the first split (so the caller can
 * always be sure the totals reconcile).
 */
export function computeSplitBills(
  order: Order,
  splits: Array<{ items: number[]; payerName?: string }>,
): Order[] {
  if (splits.length === 0) return [order];

  const assigned = new Set<number>();
  for (const s of splits) {
    for (const i of s.items) assigned.add(i);
  }
  const unassigned: number[] = [];
  for (let i = 0; i < order.items.length; i += 1) {
    if (!assigned.has(i)) unassigned.push(i);
  }
  const splitsResolved = splits.map((s, idx) => ({
    items: idx === 0 ? [...s.items, ...unassigned] : s.items,
    payerName: s.payerName,
  }));

  // Distribute the order-level discount proportionally to subtotal.
  const totalSubtotal = sumLineCents(order.items);

  const out: Order[] = [];
  for (const s of splitsResolved) {
    const subset = s.items
      .map((i) => order.items[i])
      .filter((it): it is OrderItem => it !== undefined);
    const partSubtotal = sumLineCents(subset);
    const proportional =
      totalSubtotal > 0
        ? Math.round(
            (order.discountCents * partSubtotal) / totalSubtotal,
          )
        : 0;
    const calc = calculateOrder(subset, {
      discountCents: proportional,
      serviceChargePercent: order.serviceChargePercent,
      vatRatePercent: order.vatRatePercent,
    });
    out.push({
      ...order,
      id: `${order.id}-split-${out.length + 1}`,
      code: `${order.code}-${out.length + 1}`,
      customerName: s.payerName ?? order.customerName,
      items: subset,
      subtotalCents: calc.subtotalCents,
      discountCents: calc.discountCents,
      serviceChargeCents: calc.serviceChargeCents,
      vatCents: calc.vatCents,
      totalCents: calc.totalCents,
      payments: [],
      paymentStatus: "unpaid",
    });
  }
  return out;
}
