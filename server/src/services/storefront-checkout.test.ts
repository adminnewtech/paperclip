import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  onlineCheckout,
  applyDiscount,
  calcShipping,
  computeOrderTotals,
  buildOrderJournalLines,
  isOrderJournalBalanced,
  STOREFRONT_LEDGER_CODES,
} from "./storefront-checkout.js";

// ---------------------------------------------------------------------------
// In-memory transactional fake DB. Mirrors pos-checkout.test.ts: the atomic
// SQL path (conditional UPDATE ... WHERE qty >= n RETURNING qty) is emulated
// deterministically so the atomicity contract — no oversell, full rollback on
// failure, balanced books — is unit-testable without a live DB.
// ---------------------------------------------------------------------------

interface StockRow {
  variantId: string;
  warehouseId: string;
  qty: number;
}

class FakeStore {
  stock: StockRow[] = [];
  orders: Array<Record<string, unknown>> = [];
  stockMoves: Array<Record<string, unknown>> = [];
  journalEntries: Array<Record<string, unknown>> = [];
  journalLines: Array<Record<string, unknown>> = [];
  discounts: Array<Record<string, unknown>> = [];
  shippingRates: Array<Record<string, unknown>> = [];

  snapshot() {
    return {
      stock: this.stock.map((s) => ({ ...s })),
      orders: [...this.orders],
      stockMoves: [...this.stockMoves],
      journalEntries: [...this.journalEntries],
      journalLines: [...this.journalLines],
      discounts: this.discounts.map((d) => ({ ...d })),
      shippingRates: this.shippingRates.map((r) => ({ ...r })),
    };
  }

  restore(snap: ReturnType<FakeStore["snapshot"]>) {
    this.stock = snap.stock.map((s) => ({ ...s }));
    this.orders = [...snap.orders];
    this.stockMoves = [...snap.stockMoves];
    this.journalEntries = [...snap.journalEntries];
    this.journalLines = [...snap.journalLines];
    this.discounts = snap.discounts.map((d) => ({ ...d }));
    this.shippingRates = snap.shippingRates.map((r) => ({ ...r }));
  }
}

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `00000000-0000-0000-0000-${String(idCounter).padStart(12, "0")}`;
}

function makeFakeDb(store: FakeStore): Db {
  function makeTx() {
    const tx: Record<string, unknown> = {
      // Emulates: UPDATE bos_stock SET qty = qty - n WHERE ... AND qty >= n RETURNING qty
      async execute(query: { queryChunks?: unknown[] }) {
        const params = (query.queryChunks ?? []).filter((chunk) => {
          const isStringChunk =
            chunk != null &&
            typeof chunk === "object" &&
            Array.isArray((chunk as { value?: unknown }).value);
          return !isStringChunk;
        });
        const qty = Number(params[0]);
        const variantId = String(params[1]);
        const warehouseId = String(params[2]);
        const row = store.stock.find(
          (s) => s.variantId === variantId && s.warehouseId === warehouseId,
        );
        if (!row || row.qty < qty) {
          return [] as unknown as { rows?: unknown[] };
        }
        row.qty -= qty;
        return [{ qty: row.qty }] as unknown as { rows?: unknown[] };
      },
      insert(table: Parameters<typeof getTableName>[0] | undefined) {
        // When the @paperclipai/db barrel has not yet re-exported a Wave-3
        // table, the imported binding resolves to `undefined` at runtime. Fall
        // back to the well-known table name so the atomicity contract stays
        // testable before/after the shared index.ts wiring lands.
        const name = table ? getTableName(table) : "bos_online_order";
        return {
          values(
            vals: Record<string, unknown> | Array<Record<string, unknown>>,
          ) {
            const arr = Array.isArray(vals) ? vals : [vals];
            const inserted = arr.map((v) => ({ id: newId(), ...v }));
            if (name === "bos_stock_move") store.stockMoves.push(...inserted);
            else if (name === "bos_online_order") store.orders.push(...inserted);
            else if (name === "bos_journal_entry")
              store.journalEntries.push(...inserted);
            else if (name === "bos_journal_line")
              store.journalLines.push(...inserted);
            return {
              returning: async () => inserted,
              then: (resolve: (v: unknown) => unknown) => resolve(inserted),
            };
          },
        };
      },
      select() {
        return {
          from(table: Parameters<typeof getTableName>[0] | undefined) {
            const name = table ? getTableName(table) : "";
            const source =
              name === "bos_discount"
                ? store.discounts
                : name === "bos_shipping_rate"
                  ? store.shippingRates
                  : [];
            return {
              where() {
                return {
                  limit: async () => source.slice(0, 1),
                  then: (resolve: (v: unknown) => unknown) =>
                    resolve([...source]),
                };
              },
            };
          },
        };
      },
      update(table: Parameters<typeof getTableName>[0] | undefined) {
        const name = table ? getTableName(table) : "bos_discount";
        return {
          set(patch: Record<string, unknown>) {
            return {
              where() {
                if (name === "bos_discount" && store.discounts[0]) {
                  store.discounts[0] = { ...store.discounts[0], ...patch };
                }
                return {
                  returning: async () => store.discounts.slice(0, 1),
                  then: (resolve: (v: unknown) => unknown) => resolve(undefined),
                };
              },
            };
          },
        };
      },
    };
    return tx;
  }

  return {
    async transaction(fn: (tx: unknown) => Promise<unknown>) {
      const snap = store.snapshot();
      try {
        return await fn(makeTx());
      } catch (error) {
        store.restore(snap);
        throw error;
      }
    },
  } as unknown as Db;
}

const WAREHOUSE = "11111111-1111-1111-1111-111111111111";
const VARIANT = "22222222-2222-2222-2222-222222222222";
const COMPANY = "33333333-3333-3333-3333-333333333333";

describe("storefront-checkout", () => {
  describe("applyDiscount", () => {
    it("applies 10% off 100000 → 10000", () => {
      expect(
        applyDiscount(100_000, {
          kind: "percentage",
          valueBps: 1000,
          valueMinor: 0,
          minOrderMinor: 0,
        }),
      ).toBe(10_000);
    });

    it("applies fixed 5000 → 5000", () => {
      expect(
        applyDiscount(100_000, {
          kind: "fixed",
          valueBps: 0,
          valueMinor: 5_000,
          minOrderMinor: 0,
        }),
      ).toBe(5_000);
    });

    it("returns 0 when minimum order not met", () => {
      expect(
        applyDiscount(40_000, {
          kind: "fixed",
          valueBps: 0,
          valueMinor: 5_000,
          minOrderMinor: 50_000,
        }),
      ).toBe(0);
    });

    it("returns 0 for free_shipping kind (no line discount)", () => {
      expect(
        applyDiscount(100_000, {
          kind: "free_shipping",
          valueBps: 0,
          valueMinor: 0,
          minOrderMinor: 0,
        }),
      ).toBe(0);
    });
  });

  describe("calcShipping", () => {
    it("is free above the free-shipping threshold", () => {
      expect(
        calcShipping(100_000, { priceMinor: 2_000, minOrderFreeMinor: 50_000 }),
      ).toBe(0);
    });

    it("charges the flat rate below the threshold", () => {
      expect(
        calcShipping(40_000, { priceMinor: 2_000, minOrderFreeMinor: 50_000 }),
      ).toBe(2_000);
    });

    it("charges the flat rate when no threshold is set", () => {
      expect(
        calcShipping(40_000, { priceMinor: 2_000, minOrderFreeMinor: null }),
      ).toBe(2_000);
    });
  });

  describe("computeOrderTotals", () => {
    it("computes subtotal - discount + shipping + tax correctly", () => {
      const totals = computeOrderTotals({
        lines: [{ variantId: VARIANT, qty: 2, unitPriceMinor: 50_000 }],
        discount: {
          kind: "percentage",
          valueBps: 1000,
          valueMinor: 0,
          minOrderMinor: 0,
        },
        shippingRate: { priceMinor: 2_000, minOrderFreeMinor: null },
        taxRatePct: 5,
      });
      // subtotal 100000, discount 10000, taxable 90000, tax 4500, shipping 2000
      expect(totals.subtotal).toBe(100_000);
      expect(totals.discount).toBe(10_000);
      expect(totals.shipping).toBe(2_000);
      expect(totals.tax).toBe(4_500);
      expect(totals.total).toBe(96_500);
    });

    it("builds a balanced journal from totals", () => {
      const totals = computeOrderTotals({
        lines: [{ variantId: VARIANT, qty: 2, unitPriceMinor: 50_000 }],
        discount: {
          kind: "percentage",
          valueBps: 1000,
          valueMinor: 0,
          minOrderMinor: 0,
        },
        shippingRate: { priceMinor: 2_000, minOrderFreeMinor: null },
        taxRatePct: 5,
      });
      const lines = buildOrderJournalLines(totals);
      expect(isOrderJournalBalanced(lines)).toBe(true);
      expect(
        lines.find((l) => l.accountCode === STOREFRONT_LEDGER_CODES.cash)
          ?.debitMinor,
      ).toBe(96_500);
    });
  });

  describe("onlineCheckout", () => {
    it("decrements stock, creates the order, and writes a balanced journal", async () => {
      const store = new FakeStore();
      store.stock.push({ variantId: VARIANT, warehouseId: WAREHOUSE, qty: 5 });
      const db = makeFakeDb(store);

      const order = await onlineCheckout(db, {
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        lines: [{ variantId: VARIANT, qty: 2, unitPriceMinor: 50_000 }],
        taxRatePct: 5,
        currency: "KWD",
      });

      expect(store.stock[0]!.qty).toBe(3);
      expect(order.subtotalMinor).toBe(100_000);
      expect(order.taxMinor).toBe(5_000);
      expect(order.totalMinor).toBe(105_000);
      expect(store.orders).toHaveLength(1);
      expect(store.stockMoves).toHaveLength(1);
      expect(store.stockMoves[0]!.delta).toBe(-2);

      const debit = store.journalLines.reduce(
        (sum, l) => sum + (l.debitMinor as number),
        0,
      );
      const credit = store.journalLines.reduce(
        (sum, l) => sum + (l.creditMinor as number),
        0,
      );
      expect(debit).toBe(credit);
      expect(debit).toBe(105_000);
    });

    it("throws on oversell and rolls back (no order, no moves, no journal)", async () => {
      const store = new FakeStore();
      store.stock.push({ variantId: VARIANT, warehouseId: WAREHOUSE, qty: 1 });
      const db = makeFakeDb(store);

      await expect(
        onlineCheckout(db, {
          companyId: COMPANY,
          warehouseId: WAREHOUSE,
          lines: [{ variantId: VARIANT, qty: 5, unitPriceMinor: 50_000 }],
          taxRatePct: 5,
          currency: "KWD",
        }),
      ).rejects.toThrow("Insufficient stock");

      expect(store.stock[0]!.qty).toBe(1);
      expect(store.orders).toHaveLength(0);
      expect(store.stockMoves).toHaveLength(0);
      expect(store.journalEntries).toHaveLength(0);
      expect(store.journalLines).toHaveLength(0);
    });
  });
});
