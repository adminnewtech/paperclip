import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  postInvoice,
  recordPayment,
  buildInvoiceJournalLines,
  buildBillJournalLines,
  buildPaymentJournalLines,
  isJournalBalanced,
  computeStatements,
  arAgingBuckets,
  FINANCE_LEDGER_CODES,
  type StatementJournalLine,
} from "./finance-posting.js";

// ---------------------------------------------------------------------------
// In-memory transactional fake DB.
//
// Emulates the subset of the drizzle query builder used by finance-posting:
// select().from().where(), insert().values().returning(), and
// update().set().where().returning(). Rollback restores a snapshot, matching
// the contract exercised in pos-checkout.test.ts.
// ---------------------------------------------------------------------------

interface Row extends Record<string, unknown> {
  id: string;
}

class FakeStore {
  invoices: Row[] = [];
  bills: Row[] = [];
  payments: Row[] = [];
  journalEntries: Row[] = [];
  journalLines: Row[] = [];

  tableFor(name: string): Row[] {
    switch (name) {
      case "bos_invoice":
        return this.invoices;
      case "bos_bill":
        return this.bills;
      case "bos_fin_payment":
        return this.payments;
      case "bos_journal_entry":
        return this.journalEntries;
      case "bos_journal_line":
        return this.journalLines;
      default:
        throw new Error(`Unknown table ${name}`);
    }
  }

  snapshot() {
    return {
      invoices: this.invoices.map((r) => ({ ...r })),
      bills: this.bills.map((r) => ({ ...r })),
      payments: this.payments.map((r) => ({ ...r })),
      journalEntries: this.journalEntries.map((r) => ({ ...r })),
      journalLines: this.journalLines.map((r) => ({ ...r })),
    };
  }

  restore(snap: ReturnType<FakeStore["snapshot"]>) {
    this.invoices = snap.invoices.map((r) => ({ ...r }));
    this.bills = snap.bills.map((r) => ({ ...r }));
    this.payments = snap.payments.map((r) => ({ ...r }));
    this.journalEntries = snap.journalEntries.map((r) => ({ ...r }));
    this.journalLines = snap.journalLines.map((r) => ({ ...r }));
  }
}

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `00000000-0000-0000-0000-${String(idCounter).padStart(12, "0")}`;
}

// A where(eq(col, val)) call in drizzle returns an SQL object whose queryChunks
// interleave the column reference and the bound value. For the fake we only
// ever filter by `id`, so we extract the first primitive param as the id.
function extractIdParam(condition: unknown): string | null {
  const chunks = (condition as { queryChunks?: unknown[] })?.queryChunks ?? [];
  for (const chunk of chunks) {
    if (
      chunk != null &&
      typeof chunk === "object" &&
      "value" in (chunk as Record<string, unknown>) &&
      typeof (chunk as { value?: unknown }).value === "string"
    ) {
      return (chunk as { value: string }).value;
    }
  }
  return null;
}

function makeFakeDb(store: FakeStore): Db {
  function makeTx() {
    return {
      select(_columns?: unknown) {
        let tableRows: Row[] = [];
        const builder = {
          from(table: Parameters<typeof getTableName>[0]) {
            tableRows = store.tableFor(getTableName(table));
            return builder;
          },
          where(condition: unknown) {
            const id = extractIdParam(condition);
            const result = id
              ? tableRows.filter((r) => r.id === id)
              : [...tableRows];
            return Promise.resolve(result);
          },
        };
        return builder;
      },
      insert(table: Parameters<typeof getTableName>[0]) {
        const name = getTableName(table);
        return {
          values(
            vals:
              | Record<string, unknown>
              | Array<Record<string, unknown>>,
          ) {
            const arr = Array.isArray(vals) ? vals : [vals];
            const inserted = arr.map((v) => ({
              ...v,
              id: (v.id as string | undefined) ?? newId(),
            })) as Row[];
            store.tableFor(name).push(...inserted);
            return {
              returning: async () => inserted,
              then: (resolve: (v: unknown) => unknown) => resolve(inserted),
            };
          },
        };
      },
      update(table: Parameters<typeof getTableName>[0]) {
        const rows = store.tableFor(getTableName(table));
        return {
          set(patch: Record<string, unknown>) {
            return {
              where(condition: unknown) {
                const id = extractIdParam(condition);
                const updated: Row[] = [];
                for (const row of rows) {
                  if (id && row.id !== id) continue;
                  Object.assign(row, patch);
                  updated.push(row);
                }
                return {
                  returning: async () => updated,
                };
              },
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

const COMPANY = "33333333-3333-3333-3333-333333333333";

describe("finance-posting", () => {
  // ----------------------- Pure journal builders -----------------------
  it("builds a balanced invoice journal (Dr AR / Cr Revenue / Cr VAT)", () => {
    const lines = buildInvoiceJournalLines({
      subtotalMinor: 100000,
      taxMinor: 5000,
      totalMinor: 105000,
    });
    expect(isJournalBalanced(lines)).toBe(true);
    expect(
      lines.find((l) => l.accountCode === FINANCE_LEDGER_CODES.accountsReceivable)
        ?.debitMinor,
    ).toBe(105000);
    expect(
      lines.find((l) => l.accountCode === FINANCE_LEDGER_CODES.revenue)?.creditMinor,
    ).toBe(100000);
    expect(
      lines.find((l) => l.accountCode === FINANCE_LEDGER_CODES.vatPayable)
        ?.creditMinor,
    ).toBe(5000);
  });

  it("builds a balanced bill journal (Dr Expense / Dr VAT / Cr AP)", () => {
    const lines = buildBillJournalLines({
      subtotalMinor: 80000,
      taxMinor: 4000,
      totalMinor: 84000,
    });
    expect(isJournalBalanced(lines)).toBe(true);
    expect(
      lines.find((l) => l.accountCode === FINANCE_LEDGER_CODES.accountsPayable)
        ?.creditMinor,
    ).toBe(84000);
  });

  it("builds balanced payment journals for received and paid", () => {
    const received = buildPaymentJournalLines("received", 50000);
    expect(isJournalBalanced(received)).toBe(true);
    expect(
      received.find((l) => l.accountCode === FINANCE_LEDGER_CODES.cash)?.debitMinor,
    ).toBe(50000);

    const paid = buildPaymentJournalLines("paid", 30000);
    expect(isJournalBalanced(paid)).toBe(true);
    expect(
      paid.find((l) => l.accountCode === FINANCE_LEDGER_CODES.cash)?.creditMinor,
    ).toBe(30000);
  });

  // ----------------------- postInvoice (tx) -----------------------
  it("postInvoice creates a balanced journal and links + flips status", async () => {
    const store = new FakeStore();
    const invoiceId = newId();
    store.invoices.push({
      id: invoiceId,
      companyId: COMPANY,
      number: "INV-1",
      subtotalMinor: 100000,
      taxMinor: 5000,
      totalMinor: 105000,
      paidMinor: 0,
      currency: "KWD",
      status: "draft",
      journalEntryId: null,
    });
    const db = makeFakeDb(store);

    const updated = await postInvoice(db, { companyId: COMPANY, invoiceId });

    expect(updated.status).toBe("sent");
    expect(updated.journalEntryId).toBeTruthy();
    expect(store.journalEntries).toHaveLength(1);

    const debit = store.journalLines.reduce(
      (sum, l) => sum + (l.debitMinor as number),
      0,
    );
    const credit = store.journalLines.reduce(
      (sum, l) => sum + (l.creditMinor as number),
      0,
    );
    expect(debit).toBe(credit);
    expect(debit).toBe(105000);
  });

  it("postInvoice rejects an already-posted invoice (no extra journal)", async () => {
    const store = new FakeStore();
    const invoiceId = newId();
    store.invoices.push({
      id: invoiceId,
      companyId: COMPANY,
      subtotalMinor: 100000,
      taxMinor: 0,
      totalMinor: 100000,
      paidMinor: 0,
      currency: "KWD",
      status: "sent",
      journalEntryId: "already",
    });
    const db = makeFakeDb(store);

    await expect(
      postInvoice(db, { companyId: COMPANY, invoiceId }),
    ).rejects.toThrow("already posted");
    expect(store.journalEntries).toHaveLength(0);
  });

  // ----------------------- recordPayment (tx) -----------------------
  it("recordPayment on full amount marks invoice paid + balanced cash journal", async () => {
    const store = new FakeStore();
    const invoiceId = newId();
    store.invoices.push({
      id: invoiceId,
      companyId: COMPANY,
      subtotalMinor: 100000,
      taxMinor: 0,
      totalMinor: 100000,
      paidMinor: 0,
      currency: "KWD",
      status: "sent",
      journalEntryId: "je",
    });
    const db = makeFakeDb(store);

    const result = await recordPayment(db, {
      companyId: COMPANY,
      invoiceId,
      amountMinor: 100000,
    });

    expect(result.invoice?.status).toBe("paid");
    expect(result.invoice?.paidMinor).toBe(100000);
    expect(store.payments).toHaveLength(1);

    const debit = store.journalLines.reduce(
      (sum, l) => sum + (l.debitMinor as number),
      0,
    );
    const credit = store.journalLines.reduce(
      (sum, l) => sum + (l.creditMinor as number),
      0,
    );
    expect(debit).toBe(credit);
  });

  it("recordPayment partial keeps invoice open", async () => {
    const store = new FakeStore();
    const invoiceId = newId();
    store.invoices.push({
      id: invoiceId,
      companyId: COMPANY,
      subtotalMinor: 100000,
      taxMinor: 0,
      totalMinor: 100000,
      paidMinor: 0,
      currency: "KWD",
      status: "sent",
      journalEntryId: "je",
    });
    const db = makeFakeDb(store);

    const result = await recordPayment(db, {
      companyId: COMPANY,
      invoiceId,
      amountMinor: 40000,
    });

    expect(result.invoice?.paidMinor).toBe(40000);
    expect(result.invoice?.status).toBe("sent");
  });

  // ----------------------- computeStatements -----------------------
  it("computes P&L and a balanced balance sheet from sample lines", () => {
    // Sale: Dr AR 105000 / Cr Revenue 100000 / Cr VAT 5000
    // Payment received: Dr Cash 105000 / Cr AR 105000
    const lines: StatementJournalLine[] = [
      { accountCode: "1100", debitMinor: 105000, creditMinor: 0 },
      { accountCode: "4000", debitMinor: 0, creditMinor: 100000 },
      { accountCode: "2100", debitMinor: 0, creditMinor: 5000 },
      { accountCode: "1000", debitMinor: 105000, creditMinor: 0 },
      { accountCode: "1100", debitMinor: 0, creditMinor: 105000 },
      // An expense paid in cash: Dr Expense 20000 / Cr Cash 20000
      { accountCode: "5000", debitMinor: 20000, creditMinor: 0 },
      { accountCode: "1000", debitMinor: 0, creditMinor: 20000 },
    ];

    const { pnl, balanceSheet } = computeStatements(lines);

    expect(pnl.revenueMinor).toBe(100000);
    expect(pnl.expenseMinor).toBe(20000);
    expect(pnl.netIncomeMinor).toBe(80000);

    // Assets: cash 85000 + AR 0 = 85000. Liabilities: VAT 5000.
    expect(balanceSheet.assetsMinor).toBe(85000);
    expect(balanceSheet.liabilitiesMinor).toBe(5000);
    // Balance sheet must balance: assets = liabilities + equity.
    expect(balanceSheet.assetsMinor).toBe(
      balanceSheet.liabilitiesMinor + balanceSheet.equityMinor,
    );
  });

  // ----------------------- arAgingBuckets -----------------------
  it("buckets outstanding balances by days overdue", () => {
    const asOf = new Date("2026-06-01T00:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    const buckets = arAgingBuckets(
      [
        // not due yet -> current
        { dueDate: new Date(asOf.getTime() + 10 * day), totalMinor: 1000, paidMinor: 0 },
        // 15 days overdue -> 1-30
        { dueDate: new Date(asOf.getTime() - 15 * day), totalMinor: 2000, paidMinor: 0 },
        // 45 days overdue -> 31-60
        { dueDate: new Date(asOf.getTime() - 45 * day), totalMinor: 3000, paidMinor: 1000 },
        // 100 days overdue -> 90+
        { dueDate: new Date(asOf.getTime() - 100 * day), totalMinor: 4000, paidMinor: 0 },
        // fully paid -> excluded
        { dueDate: new Date(asOf.getTime() - 5 * day), totalMinor: 5000, paidMinor: 5000 },
      ],
      asOf,
    );

    expect(buckets.current).toBe(1000);
    expect(buckets.days1to30).toBe(2000);
    expect(buckets.days31to60).toBe(2000); // 3000 - 1000 paid
    expect(buckets.days90plus).toBe(4000);
    expect(buckets.totalOutstanding).toBe(1000 + 2000 + 2000 + 4000);
  });
});
