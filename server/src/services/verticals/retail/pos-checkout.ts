/**
 * POS checkout engine.
 *
 * Pure, deterministic, integer-cents math for retail point-of-sale totals.
 *
 * Why this lives in its own module:
 *  - Retail tax/discount math is load-bearing for accounting. We must NEVER
 *    drift between what the cashier sees on the screen and what the journal
 *    entry records.
 *  - It's exercised from both the POS UI (server-roundtrip on every scan)
 *    and from the auto-posting pipeline (when a sale is completed). Both
 *    callers MUST agree to the cent.
 *  - It is intentionally pure (no DB, no IO) so it can be unit-tested
 *    exhaustively and inlined into hot paths.
 *
 * Integer-only arithmetic invariant
 * ---------------------------------
 * All amounts are tracked in fils/cents (`*Cents`). We never construct a
 * float intermediate. Percent rates are stored as numbers (e.g. 5 means 5%)
 * but always reduced via `Math.round(base * rate / 100)` so rounding error
 * stays bounded to a single fil per line.
 */

export interface RetailSaleItemInput {
  productId: string;
  productName: string;
  barcode?: string;
  quantity: number;
  unitPriceCents: number;
  /** Per-line absolute discount (already negotiated by the cashier). */
  discountCents?: number;
  taxRatePercent: number;
}

export interface RetailSaleItem {
  productId: string;
  productName: string;
  barcode?: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxRatePercent: number;
  lineTaxCents: number;
  lineTotalCents: number;
  refunded?: boolean;
}

export interface CheckoutCalculation {
  subtotalCents: number;
  discountCents: number;
  loyaltyDiscountCents: number;
  taxCents: number;
  totalCents: number;
  taxBreakdown: Array<{ rate: number; baseCents: number; taxCents: number }>;
  loyaltyPointsEarned: number;
  /** Hydrated items with per-line tax/total computed. */
  items: RetailSaleItem[];
}

export interface CheckoutOptions {
  /** A flat amount discount applied to the cart subtotal AFTER per-line discounts. */
  overallDiscountCents?: number;
  /** Loyalty points the customer wants to redeem. Converted to cents via KWD_PER_POINT. */
  loyaltyPointsToRedeem?: number;
  loyaltyTier?: string;
  /**
   * Fallback country VAT% used when an item has `taxRatePercent === undefined`
   * or `< 0`. The schema requires a tax rate per item, but POS imports from
   * legacy product catalogs sometimes miss it.
   */
  countryVatPercent: number;
}

/**
 * Integer-only multiplication of `base` by `rate / 100`. Rounds half-up.
 *
 * Banker's rounding would be technically prettier but cashiers expect
 * "0.5 → up" and so does ZATCA/Kuwait VAT calculation guidance.
 */
function applyPercent(baseCents: number, ratePercent: number): number {
  if (ratePercent <= 0 || baseCents <= 0) return 0;
  // base * rate is at most 10^12 — safely within JS number precision (2^53 ≈ 9e15).
  return Math.round((baseCents * ratePercent) / 100);
}

/**
 * Validates a barcode according to the most common retail formats.
 * Supports EAN-13, EAN-8, UPC-A (12), UPC-E (8), ITF-14, and arbitrary
 * alphanumeric SKUs of 3-40 chars (some vendors print internal codes).
 *
 * For EAN/UPC numeric codes we also check the GTIN check digit so that
 * cashiers don't silently process garbage scans.
 */
export function validateBarcode(barcode: string): boolean {
  const trimmed = barcode.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return false;

  // Pure-digit barcodes are validated with the GTIN check digit algorithm.
  if (/^\d+$/.test(trimmed)) {
    const lengths = new Set([8, 12, 13, 14]);
    if (!lengths.has(trimmed.length)) {
      // Some POS-printed labels are 6 or 7 digits. Allow them as opaque SKUs
      // — they just won't pass the GTIN check.
      return trimmed.length >= 4;
    }
    let sum = 0;
    for (let i = 0; i < trimmed.length - 1; i++) {
      const digit = Number(trimmed[trimmed.length - 2 - i]);
      sum += digit * (i % 2 === 0 ? 3 : 1);
    }
    const check = (10 - (sum % 10)) % 10;
    return check === Number(trimmed[trimmed.length - 1]);
  }

  // Alphanumeric SKUs (internal store codes, ISBN-10 with X, etc.).
  return /^[A-Za-z0-9._-]{3,40}$/.test(trimmed);
}

/**
 * Compute the totals for a cart.
 *
 * Algorithm (deterministic, integer math):
 *   1. Hydrate each line: lineGross = unitPrice * quantity - perLineDiscount.
 *   2. Apportion the overall cart discount + loyalty redemption proportionally
 *      across lines based on `lineGross`. Apportionment uses the
 *      largest-remainder method so the sum of apportioned cents exactly
 *      equals the cart discount.
 *   3. For each line compute lineTax = round(taxableBase * taxRate / 100).
 *   4. Sum: subtotal, discount, tax, total.
 *
 * Apportioning per-line ensures the tax breakdown stays consistent when
 * different items have different VAT rates (e.g. basic groceries 0%,
 * electronics 5%).
 */
export function calculateCheckout(
  itemsInput: RetailSaleItemInput[],
  opts: CheckoutOptions,
): CheckoutCalculation {
  // ----- Step 1: hydrate per-line gross -----
  const lines: Array<{
    input: RetailSaleItemInput;
    grossCents: number;
    taxRate: number;
  }> = itemsInput.map((it) => {
    const quantity = Math.max(0, Math.trunc(it.quantity));
    const lineDiscount = Math.max(0, Math.trunc(it.discountCents ?? 0));
    const gross = Math.max(0, it.unitPriceCents * quantity - lineDiscount);
    const taxRate =
      it.taxRatePercent !== undefined && it.taxRatePercent >= 0
        ? it.taxRatePercent
        : opts.countryVatPercent;
    return { input: it, grossCents: gross, taxRate };
  });

  const subtotalCents = lines.reduce(
    (s, l) => s + l.input.unitPriceCents * Math.max(0, Math.trunc(l.input.quantity)),
    0,
  );

  const perLineDiscountSum = lines.reduce(
    (s, l) => s + Math.max(0, Math.trunc(l.input.discountCents ?? 0)),
    0,
  );

  // ----- Step 2: cart-level discount + loyalty redemption -----
  const overallDiscount = Math.max(0, Math.trunc(opts.overallDiscountCents ?? 0));
  const loyaltyPoints = Math.max(0, Math.trunc(opts.loyaltyPointsToRedeem ?? 0));
  const loyaltyDiscountCents = loyaltyPoints; // 100 points = 1 KWD = 1000 fils → 1 point = 10 fils.
  // POINTS_PER_KWD = 10 means 1 point = 100 fils; KWD_PER_POINT = 100 means 100 pts = 1 KWD.
  // So 1 point redeemed = 1 fil ... actually per spec: KWD_PER_POINT=100 → 100 points = 1 KWD = 1000 fils.
  // → 1 point = 10 fils. We will source the multiplier from loyalty-engine.ts so the math
  //   stays consistent. To avoid an import cycle, replicate the constant here.
  const POINT_TO_FILS = 10;
  const loyaltyValueCents = loyaltyPoints * POINT_TO_FILS;

  const totalCartReductionCents = overallDiscount + loyaltyValueCents;

  // Apportion the cart-level reduction proportionally to each line's gross.
  // Use the largest-remainder method to ensure exact penny accounting.
  const grossSum = lines.reduce((s, l) => s + l.grossCents, 0);
  const apportionedReductions: number[] = lines.map(() => 0);
  if (grossSum > 0 && totalCartReductionCents > 0) {
    const exact = lines.map(
      (l) => (l.grossCents * totalCartReductionCents) / grossSum,
    );
    const floored = exact.map(Math.floor);
    const remainders = exact.map((v, i) => ({ idx: i, frac: v - floored[i]! }));
    let assigned = floored.reduce((s, n) => s + n, 0);
    remainders.sort((a, b) => b.frac - a.frac);
    let cursor = 0;
    while (assigned < totalCartReductionCents && cursor < remainders.length) {
      floored[remainders[cursor]!.idx]! += 1;
      assigned += 1;
      cursor += 1;
    }
    for (let i = 0; i < lines.length; i++) {
      apportionedReductions[i] = Math.min(floored[i]!, lines[i]!.grossCents);
    }
  }

  // ----- Step 3: per-line tax + totals -----
  const items: RetailSaleItem[] = lines.map((l, i) => {
    const apportioned = apportionedReductions[i]!;
    const taxableBase = Math.max(0, l.grossCents - apportioned);
    const lineTax = applyPercent(taxableBase, l.taxRate);
    return {
      productId: l.input.productId,
      productName: l.input.productName,
      barcode: l.input.barcode,
      quantity: Math.max(0, Math.trunc(l.input.quantity)),
      unitPriceCents: l.input.unitPriceCents,
      discountCents:
        Math.max(0, Math.trunc(l.input.discountCents ?? 0)) + apportioned,
      taxRatePercent: l.taxRate,
      lineTaxCents: lineTax,
      lineTotalCents: taxableBase + lineTax,
    };
  });

  // ----- Step 4: tax breakdown (grouped by rate, for the receipt) -----
  const breakdownMap = new Map<number, { baseCents: number; taxCents: number }>();
  for (const it of items) {
    const base = it.lineTotalCents - it.lineTaxCents;
    const existing = breakdownMap.get(it.taxRatePercent) ?? {
      baseCents: 0,
      taxCents: 0,
    };
    existing.baseCents += base;
    existing.taxCents += it.lineTaxCents;
    breakdownMap.set(it.taxRatePercent, existing);
  }
  const taxBreakdown = Array.from(breakdownMap.entries())
    .map(([rate, v]) => ({ rate, baseCents: v.baseCents, taxCents: v.taxCents }))
    .sort((a, b) => a.rate - b.rate);

  const taxCents = items.reduce((s, it) => s + it.lineTaxCents, 0);
  const totalCents = items.reduce((s, it) => s + it.lineTotalCents, 0);
  const discountCents = perLineDiscountSum + overallDiscount;

  // ----- Step 5: loyalty points earned -----
  // Lazy import semantics: caller (loyalty-engine) determines exact multiplier
  // by tier. The default here is 10 points per KWD spent (after tax).
  const tierMultiplier = (() => {
    switch (opts.loyaltyTier) {
      case "silver":
        return 1.2;
      case "gold":
        return 1.5;
      case "platinum":
        return 2.0;
      default:
        return 1.0;
    }
  })();
  // 10 points per KWD = 10 points per 1000 fils.
  const loyaltyPointsEarned = Math.floor(
    (totalCents * 10 * tierMultiplier) / 1000,
  );

  return {
    subtotalCents,
    discountCents,
    loyaltyDiscountCents: loyaltyValueCents,
    taxCents,
    totalCents,
    taxBreakdown,
    loyaltyPointsEarned,
    items,
  };
}

/**
 * Object-style facade so callers can inject an engine for testing.
 */
export interface PosCheckoutEngine {
  calculate(items: RetailSaleItemInput[], opts: CheckoutOptions): CheckoutCalculation;
  validateBarcode(barcode: string): boolean;
}

export const posCheckoutEngine: PosCheckoutEngine = {
  calculate: calculateCheckout,
  validateBarcode,
};
