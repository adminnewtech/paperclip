import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  posCheckout,
  computeTotals,
  buildJournalLines,
  isJournalBalanced,
  POS_LEDGER_CODES,
} from "./pos-checkout.js";

// ---------------------------------------------------------------------------
// In-memory transactional fake DB.
//
// The atomic SQL path (conditional UPDATE ... WHERE qty >= n RETURNING qty)
// is integration-tested against real Postgres. Here we emulate its exact
// semantics deterministically so the atomicity contract — no oversell, full
// rollback on failure, balanced books — is unit-testable without a live DB.
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

  snapshot() {
    return {
      stock: this.stock.map((s) => ({ ...s })),
      orders: [...this.orders],
      stockMoves: [...this.stockMoves],
      journalEntries: [...this.journalEntries],
      journalLines: [...this.journalLines],
    };
  }

  restore(snap: ReturnType<FakeStore["snapshot"]>) {
    this.stock = snap.stock.map((s) => ({ ...s }));
    this.orders = [...snap.orders];
    this.stockMoves = [...snap.stockMoves];
    this.journalEntries = [...snap.journalEntries];
    this.journalLines = [...snap.journalLines];
  }
}

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `00000000-0000-0000-0000-${String(idCounter).padStart(12, "0")}`;
}

function makeFakeDb(store: FakeStore): Db {
  function makeTx() {
    return {
      // Emulates: UPDATE bos_stock SET qty = qty - n WHERE ... AND qty >= n RETURNING qty
      async execute(query: { queryChunks?: unknown[] }) {
        // Drizzle's sql template interleaves StringChunk objects (static SQL
        // text, identified by an array `value`) with the interpolated params
        // (raw primitives). Extract the interpolated params in order.
        const params = (query.queryChunks ?? []).filter((chunk) => {
          const isStringChunk =
            chunk != null &&
            typeof chunk === "object" &&
            Array.isArray((chunk as { value?: unknown }).value);
          return !isStringChunk;
        });
        // params order in the UPDATE: qty (decrement), variantId, warehouseId, qty (guard)
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
      insert(table: Parameters<typeof getTableName>[0]) {
        const name = getTableName(table);
        return {
          values(vals: Record<string, unknown> | Array<Record<string, unknown>>) {
            const arr = Array.isArray(vals) ? vals : [vals];
            const inserted = arr.map((v) => ({ id: newId(), ...v }));
            if (name === "bos_stock_move") store.stockMoves.push(...inserted);
            else if (name === "bos_pos_order") store.orders.push(...inserted);
            else if (name === "bos_journal_entry") store.journalEntries.push(...inserted);
            else if (name === "bos_journal_line") store.journalLines.push(...inserted);
            return {
              returning: async () => inserted,
              then: (resolve: (v: unknown) => unknown) => resolve(inserted),
            };
          },
        };
      },
    };
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

describe("pos-atomic", () => {
  it("computes totals and a balanced journal (pure helpers)", () => {
    const totals = computeTotals(
      [{ variantId: VARIANT, qty: 3, unitPriceMinor: 1000 }],
      5,
    );
    expect(totals).toEqual({ subtotalMinor: 3000, taxMinor: 150, totalMinor: 3150 });

    const lines = buildJournalLines(totals);
    expect(isJournalBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === POS_LEDGER_CODES.cash)?.debitMinor).toBe(3150);
    expect(lines.find((l) => l.accountCode === POS_LEDGER_CODES.revenue)?.creditMinor).toBe(3000);
    expect(lines.find((l) => l.accountCode === POS_LEDGER_CODES.vatPayable)?.creditMinor).toBe(150);
  });

  it("succeeds for qty=3 of 5: stock drops to 2, totals correct, journal balanced", async () => {
    const store = new FakeStore();
    store.stock.push({ variantId: VARIANT, warehouseId: WAREHOUSE, qty: 5 });
    const db = makeFakeDb(store);

    const order = await posCheckout(db, {
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      lines: [{ variantId: VARIANT, qty: 3, unitPriceMinor: 1000 }],
      paymentMethod: "cash",
      currency: "KWD",
      taxRatePct: 5,
    });

    expect(store.stock[0]!.qty).toBe(2);
    expect(order.subtotalMinor).toBe(3000);
    expect(order.taxMinor).toBe(150);
    expect(order.totalMinor).toBe(3150);
    expect(store.orders).toHaveLength(1);
    expect(store.stockMoves).toHaveLength(1);
    expect(store.stockMoves[0]!.delta).toBe(-3);

    const debit = store.journalLines.reduce(
      (sum, l) => sum + (l.debitMinor as number),
      0,
    );
    const credit = store.journalLines.reduce(
      (sum, l) => sum + (l.creditMinor as number),
      0,
    );
    expect(debit).toBe(credit);
    expect(debit).toBe(3150);
  });

  it("throws on insufficient stock and rolls back (no oversell, no order)", async () => {
    const store = new FakeStore();
    store.stock.push({ variantId: VARIANT, warehouseId: WAREHOUSE, qty: 2 });
    const db = makeFakeDb(store);

    await expect(
      posCheckout(db, {
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        lines: [{ variantId: VARIANT, qty: 5, unitPriceMinor: 1000 }],
        paymentMethod: "cash",
        currency: "KWD",
        taxRatePct: 5,
      }),
    ).rejects.toThrow("Insufficient stock");

    // Rolled back: stock untouched, no order, no moves, no journal.
    expect(store.stock[0]!.qty).toBe(2);
    expect(store.orders).toHaveLength(0);
    expect(store.stockMoves).toHaveLength(0);
    expect(store.journalEntries).toHaveLength(0);
    expect(store.journalLines).toHaveLength(0);
  });
});
