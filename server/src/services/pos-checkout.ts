import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bosStockMove, bosPosOrder, bosJournalEntry, bosJournalLine } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Ledger account codes used by the POS checkout journal entry.
// ---------------------------------------------------------------------------
export const POS_LEDGER_CODES = {
  cash: "1000", // Asset: Cash / Cash on hand
  revenue: "4000", // Revenue: Sales
  vatPayable: "2100", // Liability: VAT payable
} as const;

export interface PosCheckoutLine {
  variantId: string;
  qty: number;
  unitPriceMinor: number;
}

export interface PosCheckoutParams {
  companyId: string;
  warehouseId: string;
  sessionId?: string;
  lines: PosCheckoutLine[];
  paymentMethod: string;
  customerName?: string;
  currency: string;
  taxRatePct: number;
}

export interface PosCheckoutTotals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
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
 * Compute order totals from line items in minor units. Tax is rounded to the
 * nearest minor unit. All math is integer-safe in minor units.
 */
export function computeTotals(
  lines: PosCheckoutLine[],
  taxRatePct: number,
): PosCheckoutTotals {
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.qty * line.unitPriceMinor,
    0,
  );
  const taxMinor = Math.round((subtotalMinor * taxRatePct) / 100);
  const totalMinor = subtotalMinor + taxMinor;
  return { subtotalMinor, taxMinor, totalMinor };
}

/**
 * Build a balanced set of journal lines for a cash sale:
 *   Dr Cash (total) / Cr Revenue (subtotal) / Cr VAT Payable (tax)
 * The VAT line is omitted when tax is zero. Always returns at least 2 lines.
 */
export function buildJournalLines(totals: PosCheckoutTotals): JournalLineDraft[] {
  const lines: JournalLineDraft[] = [
    { accountCode: POS_LEDGER_CODES.cash, debitMinor: totals.totalMinor, creditMinor: 0 },
    {
      accountCode: POS_LEDGER_CODES.revenue,
      debitMinor: 0,
      creditMinor: totals.subtotalMinor,
    },
  ];
  if (totals.taxMinor > 0) {
    lines.push({
      accountCode: POS_LEDGER_CODES.vatPayable,
      debitMinor: 0,
      creditMinor: totals.taxMinor,
    });
  }
  return lines;
}

/** True when total debits equal total credits across the journal lines. */
export function isJournalBalanced(lines: JournalLineDraft[]): boolean {
  const debit = lines.reduce((sum, l) => sum + l.debitMinor, 0);
  const credit = lines.reduce((sum, l) => sum + l.creditMinor, 0);
  return debit === credit;
}

// ---------------------------------------------------------------------------
// Retry helper for serialization / deadlock failures.
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
// Atomic POS checkout.
// ---------------------------------------------------------------------------

type PosOrderRow = typeof bosPosOrder.$inferSelect;

/**
 * Execute an atomic point-of-sale checkout. The entire operation runs in a
 * single DB transaction so that stock decrement, stock-move logging, order
 * creation and the balanced double-entry journal either all commit or all roll
 * back. Stock is decremented with an atomic conditional UPDATE, preventing
 * overselling under concurrency. Serialization / deadlock failures are retried.
 */
export async function posCheckout(
  db: Db,
  params: PosCheckoutParams,
): Promise<PosOrderRow> {
  const {
    companyId,
    warehouseId,
    sessionId,
    lines,
    paymentMethod,
    customerName,
    currency,
    taxRatePct,
  } = params;

  if (lines.length === 0) {
    throw new Error("Checkout requires at least one line item");
  }

  const totals = computeTotals(lines, taxRatePct);
  const journalLines = buildJournalLines(totals);
  if (!isJournalBalanced(journalLines)) {
    // Defensive: should never happen given the construction above.
    throw new Error("Journal entry is not balanced (debit != credit)");
  }

  return withRetry(() =>
    db.transaction(async (tx) => {
      // 1. Atomic conditional stock decrement per line (prevents oversell).
      for (const line of lines) {
        if (line.qty <= 0) {
          throw new Error(`Invalid quantity for variant ${line.variantId}`);
        }
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
          ref: sessionId ?? null,
        });
      }

      // 3 + 4. Persist the POS order.
      const [order] = await tx
        .insert(bosPosOrder)
        .values({
          companyId,
          sessionId: sessionId ?? null,
          warehouseId,
          lines,
          subtotalMinor: totals.subtotalMinor,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
          currency,
          paymentMethod,
          customerName: customerName ?? null,
          status: "paid",
        })
        .returning();
      if (!order) {
        throw new Error("Failed to create POS order");
      }

      // 5. Balanced double-entry journal.
      const [entry] = await tx
        .insert(bosJournalEntry)
        .values({
          companyId,
          memo: `POS sale ${order.id}`,
          sourceRef: order.id,
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

      // 6. Return the created order.
      return order;
    }),
  );
}
