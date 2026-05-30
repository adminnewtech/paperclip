import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosInvoice,
  bosBill,
  bosFinPayment,
  bosJournalEntry,
  bosJournalLine,
} from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Ledger account codes used by the finance posting journal entries.
// These mirror the codes used by the POS checkout flow (pos-checkout.ts) so
// that the chart of accounts stays consistent across modules.
// ---------------------------------------------------------------------------
export const FINANCE_LEDGER_CODES = {
  cash: "1000", // Asset: Cash / Bank
  accountsReceivable: "1100", // Asset: Accounts Receivable
  accountsPayable: "2000", // Liability: Accounts Payable
  vatPayable: "2100", // Liability: VAT payable
  vatReceivable: "1300", // Asset: VAT receivable (input tax on bills)
  revenue: "4000", // Revenue: Sales
  expense: "5000", // Expense: Cost / purchases
} as const;

export interface JournalLineDraft {
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
}

export interface JournalLineRecord {
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no DB).
// ---------------------------------------------------------------------------

/** True when total debits equal total credits across the journal lines. */
export function isJournalBalanced(lines: JournalLineDraft[]): boolean {
  const debit = lines.reduce((sum, l) => sum + l.debitMinor, 0);
  const credit = lines.reduce((sum, l) => sum + l.creditMinor, 0);
  return debit === credit;
}

/**
 * Build balanced journal lines for posting a sales invoice:
 *   Dr Accounts Receivable (total) / Cr Revenue (subtotal) / Cr VAT Payable (tax)
 * The VAT line is omitted when tax is zero.
 */
export function buildInvoiceJournalLines(totals: {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}): JournalLineDraft[] {
  const lines: JournalLineDraft[] = [
    {
      accountCode: FINANCE_LEDGER_CODES.accountsReceivable,
      debitMinor: totals.totalMinor,
      creditMinor: 0,
    },
    {
      accountCode: FINANCE_LEDGER_CODES.revenue,
      debitMinor: 0,
      creditMinor: totals.subtotalMinor,
    },
  ];
  if (totals.taxMinor > 0) {
    lines.push({
      accountCode: FINANCE_LEDGER_CODES.vatPayable,
      debitMinor: 0,
      creditMinor: totals.taxMinor,
    });
  }
  return lines;
}

/**
 * Build balanced journal lines for posting a purchase bill (AP):
 *   Dr Expense (subtotal) / Dr VAT Receivable (tax) / Cr Accounts Payable (total)
 */
export function buildBillJournalLines(totals: {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}): JournalLineDraft[] {
  const lines: JournalLineDraft[] = [
    {
      accountCode: FINANCE_LEDGER_CODES.expense,
      debitMinor: totals.subtotalMinor,
      creditMinor: 0,
    },
  ];
  if (totals.taxMinor > 0) {
    lines.push({
      accountCode: FINANCE_LEDGER_CODES.vatReceivable,
      debitMinor: totals.taxMinor,
      creditMinor: 0,
    });
  }
  lines.push({
    accountCode: FINANCE_LEDGER_CODES.accountsPayable,
    debitMinor: 0,
    creditMinor: totals.totalMinor,
  });
  return lines;
}

/**
 * Build balanced journal lines for a payment.
 *   received (customer pays invoice): Dr Cash / Cr Accounts Receivable
 *   paid (we pay a bill):             Dr Accounts Payable / Cr Cash
 */
export function buildPaymentJournalLines(
  kind: "received" | "paid",
  amountMinor: number,
): JournalLineDraft[] {
  if (kind === "received") {
    return [
      { accountCode: FINANCE_LEDGER_CODES.cash, debitMinor: amountMinor, creditMinor: 0 },
      {
        accountCode: FINANCE_LEDGER_CODES.accountsReceivable,
        debitMinor: 0,
        creditMinor: amountMinor,
      },
    ];
  }
  return [
    {
      accountCode: FINANCE_LEDGER_CODES.accountsPayable,
      debitMinor: amountMinor,
      creditMinor: 0,
    },
    { accountCode: FINANCE_LEDGER_CODES.cash, debitMinor: 0, creditMinor: amountMinor },
  ];
}

// ---------------------------------------------------------------------------
// AR / AP aging buckets (pure).
// ---------------------------------------------------------------------------

export interface AgingRow {
  dueDate: string | Date | null;
  totalMinor: number;
  paidMinor: number;
}

export interface AgingBuckets {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  totalOutstanding: number;
}

/**
 * Compute outstanding-balance aging buckets from invoice/bill rows. An entry's
 * outstanding amount is total - paid. Bucketing is by days overdue relative to
 * `asOf` (default: now). Not-yet-due (and not-overdue) balances are "current".
 */
export function arAgingBuckets(rows: AgingRow[], asOf: Date = new Date()): AgingBuckets {
  const buckets: AgingBuckets = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90plus: 0,
    totalOutstanding: 0,
  };
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  for (const row of rows) {
    const outstanding = row.totalMinor - row.paidMinor;
    if (outstanding <= 0) continue;
    buckets.totalOutstanding += outstanding;

    if (!row.dueDate) {
      buckets.current += outstanding;
      continue;
    }
    const due = row.dueDate instanceof Date ? row.dueDate : new Date(row.dueDate);
    const daysOverdue = Math.floor((asOf.getTime() - due.getTime()) / MS_PER_DAY);

    if (daysOverdue <= 0) buckets.current += outstanding;
    else if (daysOverdue <= 30) buckets.days1to30 += outstanding;
    else if (daysOverdue <= 60) buckets.days31to60 += outstanding;
    else if (daysOverdue <= 90) buckets.days61to90 += outstanding;
    else buckets.days90plus += outstanding;
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Financial statements (pure): P&L + Balance Sheet from journal lines.
// ---------------------------------------------------------------------------

export interface StatementJournalLine {
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
}

export interface ProfitAndLoss {
  revenueMinor: number;
  expenseMinor: number;
  netIncomeMinor: number;
}

export interface BalanceSheet {
  assetsMinor: number;
  liabilitiesMinor: number;
  equityMinor: number;
}

export interface Statements {
  pnl: ProfitAndLoss;
  balanceSheet: BalanceSheet;
}

/** First digit of an account code maps to its statement classification. */
function accountClass(
  code: string,
): "asset" | "liability" | "equity" | "revenue" | "expense" {
  const first = code.trim().charAt(0);
  switch (first) {
    case "1":
      return "asset";
    case "2":
      return "liability";
    case "3":
      return "equity";
    case "4":
      return "revenue";
    default:
      return "expense"; // 5xxx and any other
  }
}

/**
 * Compute P&L and balance sheet figures from a flat list of journal lines.
 * Normal balances: assets & expenses are debit-positive; liabilities, equity &
 * revenue are credit-positive. Net income flows into equity so the sheet
 * balances (assets = liabilities + equity + retained net income).
 */
export function computeStatements(
  journalLines: StatementJournalLine[],
): Statements {
  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  let revenue = 0;
  let expense = 0;

  for (const line of journalLines) {
    const net = line.debitMinor - line.creditMinor; // debit-positive
    switch (accountClass(line.accountCode)) {
      case "asset":
        assets += net;
        break;
      case "liability":
        liabilities += -net; // credit-positive
        break;
      case "equity":
        equity += -net; // credit-positive
        break;
      case "revenue":
        revenue += -net; // credit-positive
        break;
      case "expense":
        expense += net; // debit-positive
        break;
    }
  }

  const netIncome = revenue - expense;

  return {
    pnl: {
      revenueMinor: revenue,
      expenseMinor: expense,
      netIncomeMinor: netIncome,
    },
    balanceSheet: {
      assetsMinor: assets,
      liabilitiesMinor: liabilities,
      // Net income accrues to equity so the accounting equation holds.
      equityMinor: equity + netIncome,
    },
  };
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
// Post an invoice: create a balanced journal entry and link it to the invoice.
// ---------------------------------------------------------------------------

type InvoiceRow = typeof bosInvoice.$inferSelect;
type BillRow = typeof bosBill.$inferSelect;
type PaymentRow = typeof bosFinPayment.$inferSelect;

export interface PostInvoiceParams {
  companyId: string;
  invoiceId: string;
}

/**
 * Post a sales invoice. In a single transaction: load the invoice, build a
 * balanced double-entry journal (Dr AR / Cr Revenue / Cr VAT), persist it, link
 * it back to the invoice and flip status draft -> sent. Asserts debit==credit.
 */
export async function postInvoice(
  db: Db,
  params: PostInvoiceParams,
): Promise<InvoiceRow> {
  const { companyId, invoiceId } = params;

  return withRetry(() =>
    db.transaction(async (tx) => {
      const [invoice] = await tx
        .select()
        .from(bosInvoice)
        .where(eq(bosInvoice.id, invoiceId));
      if (!invoice || invoice.companyId !== companyId) {
        throw new Error("Invoice not found");
      }
      if (invoice.journalEntryId) {
        throw new Error("Invoice is already posted");
      }

      const totals = {
        subtotalMinor: invoice.subtotalMinor,
        taxMinor: invoice.taxMinor,
        totalMinor: invoice.totalMinor,
      };
      const journalLines = buildInvoiceJournalLines(totals);
      if (!isJournalBalanced(journalLines)) {
        throw new Error("Journal entry is not balanced (debit != credit)");
      }

      const [entry] = await tx
        .insert(bosJournalEntry)
        .values({
          companyId,
          memo: `Invoice ${invoice.number ?? invoice.id}`,
          sourceRef: invoice.id,
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

      const [updated] = await tx
        .update(bosInvoice)
        .set({
          journalEntryId: entry.id,
          status: invoice.status === "draft" ? "sent" : invoice.status,
          updatedAt: new Date(),
        })
        .where(eq(bosInvoice.id, invoice.id))
        .returning();
      if (!updated) {
        throw new Error("Failed to update invoice");
      }
      return updated;
    }),
  );
}

export interface PostBillParams {
  companyId: string;
  billId: string;
}

/**
 * Post a purchase bill (AP). Mirrors postInvoice with the AP journal shape
 * (Dr Expense / Dr VAT Receivable / Cr Accounts Payable).
 */
export async function postBill(db: Db, params: PostBillParams): Promise<BillRow> {
  const { companyId, billId } = params;

  return withRetry(() =>
    db.transaction(async (tx) => {
      const [bill] = await tx.select().from(bosBill).where(eq(bosBill.id, billId));
      if (!bill || bill.companyId !== companyId) {
        throw new Error("Bill not found");
      }
      if (bill.journalEntryId) {
        throw new Error("Bill is already posted");
      }

      const journalLines = buildBillJournalLines({
        subtotalMinor: bill.subtotalMinor,
        taxMinor: bill.taxMinor,
        totalMinor: bill.totalMinor,
      });
      if (!isJournalBalanced(journalLines)) {
        throw new Error("Journal entry is not balanced (debit != credit)");
      }

      const [entry] = await tx
        .insert(bosJournalEntry)
        .values({
          companyId,
          memo: `Bill ${bill.number ?? bill.id}`,
          sourceRef: bill.id,
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

      const [updated] = await tx
        .update(bosBill)
        .set({
          journalEntryId: entry.id,
          status: bill.status === "draft" ? "sent" : bill.status,
          updatedAt: new Date(),
        })
        .where(eq(bosBill.id, bill.id))
        .returning();
      if (!updated) {
        throw new Error("Failed to update bill");
      }
      return updated;
    }),
  );
}

export interface RecordPaymentParams {
  companyId: string;
  invoiceId?: string;
  billId?: string;
  amountMinor: number;
  currency?: string;
  method?: string;
}

export interface RecordPaymentResult {
  payment: PaymentRow;
  invoice: InvoiceRow | null;
  bill: BillRow | null;
}

/**
 * Record a payment against an invoice (money received) or a bill (money paid).
 * In a single transaction: create a balanced cash journal, persist the payment
 * row, and increment the target's paid_minor — flipping status to "paid" once
 * fully settled. Asserts debit==credit.
 */
export async function recordPayment(
  db: Db,
  params: RecordPaymentParams,
): Promise<RecordPaymentResult> {
  const { companyId, invoiceId, billId, amountMinor, currency, method } = params;

  if (!invoiceId && !billId) {
    throw new Error("Payment requires an invoiceId or billId");
  }
  if (invoiceId && billId) {
    throw new Error("Payment must target either an invoice or a bill, not both");
  }
  if (amountMinor <= 0) {
    throw new Error("Payment amount must be positive");
  }

  const kind: "received" | "paid" = invoiceId ? "received" : "paid";
  const journalLines = buildPaymentJournalLines(kind, amountMinor);
  if (!isJournalBalanced(journalLines)) {
    throw new Error("Journal entry is not balanced (debit != credit)");
  }

  return withRetry(() =>
    db.transaction(async (tx) => {
      let invoice: InvoiceRow | null = null;
      let bill: BillRow | null = null;
      let sourceRef: string;

      if (invoiceId) {
        const [row] = await tx
          .select()
          .from(bosInvoice)
          .where(eq(bosInvoice.id, invoiceId));
        if (!row || row.companyId !== companyId) {
          throw new Error("Invoice not found");
        }
        invoice = row;
        sourceRef = row.id;
      } else {
        const [row] = await tx.select().from(bosBill).where(eq(bosBill.id, billId!));
        if (!row || row.companyId !== companyId) {
          throw new Error("Bill not found");
        }
        bill = row;
        sourceRef = row.id;
      }

      const [entry] = await tx
        .insert(bosJournalEntry)
        .values({
          companyId,
          memo: `Payment ${kind} ${sourceRef}`,
          sourceRef,
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

      const [payment] = await tx
        .insert(bosFinPayment)
        .values({
          companyId,
          kind,
          invoiceId: invoiceId ?? null,
          billId: billId ?? null,
          amountMinor,
          currency: currency ?? (invoice?.currency ?? bill?.currency ?? "KWD"),
          method: method ?? null,
          journalEntryId: entry.id,
        })
        .returning();
      if (!payment) {
        throw new Error("Failed to create payment");
      }

      if (invoice) {
        const newPaid = invoice.paidMinor + amountMinor;
        const fullyPaid = newPaid >= invoice.totalMinor;
        const [updated] = await tx
          .update(bosInvoice)
          .set({
            paidMinor: newPaid,
            status: fullyPaid ? "paid" : invoice.status,
            updatedAt: new Date(),
          })
          .where(eq(bosInvoice.id, invoice.id))
          .returning();
        invoice = updated ?? invoice;
      } else if (bill) {
        const newPaid = bill.paidMinor + amountMinor;
        const fullyPaid = newPaid >= bill.totalMinor;
        const [updated] = await tx
          .update(bosBill)
          .set({
            paidMinor: newPaid,
            status: fullyPaid ? "paid" : bill.status,
            updatedAt: new Date(),
          })
          .where(eq(bosBill.id, bill.id))
          .returning();
        bill = updated ?? bill;
      }

      return { payment, invoice, bill };
    }),
  );
}
