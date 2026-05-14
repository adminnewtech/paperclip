/**
 * Accounting engine — shared types.
 *
 * These types describe the canonical accounting domain model used by the
 * Paperclip business module:
 *  - Chart of Accounts (CoA)
 *  - Journal entries (double-entry bookkeeping)
 *  - Trial balance + financial statements (P&L, Balance Sheet, Cash Flow)
 *
 * All monetary amounts are stored as INTEGER cents to avoid floating-point
 * rounding errors. Currency defaults follow the host company's setting
 * (falling back to KWD if unset).
 */

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type AccountSubtype =
  // assets
  | "cash"
  | "bank"
  | "accounts_receivable"
  | "inventory"
  | "fixed_asset"
  | "other_current_asset"
  | "other_asset"
  // liabilities
  | "accounts_payable"
  | "credit_card"
  | "loan"
  | "other_current_liability"
  | "long_term_liability"
  // equity
  | "common_stock"
  | "retained_earnings"
  | "drawing"
  // revenue
  | "operating_revenue"
  | "other_revenue"
  // expenses
  | "cogs"
  | "operating_expense"
  | "payroll_expense"
  | "tax_expense"
  | "other_expense";

export interface ChartOfAccount {
  /** Internal entity id (uuid) — matches businessEntities.id when persisted */
  id: string;
  /** Hierarchical numeric code, e.g. "1000", "1110" */
  code: string;
  name: string;
  /** Arabic localized name */
  nameAr: string;
  type: AccountType;
  subtype: AccountSubtype;
  /** Parent account code, if this is a sub-account */
  parentCode?: string;
  description?: string;
  isActive: boolean;
  /** System accounts cannot be deleted */
  isSystem: boolean;
  /** ISO 4217 currency, e.g. "KWD" */
  currency: string;
  /**
   * Cached current balance in cents. The general ledger is the source of
   * truth — clients should recompute via the ledger service when accuracy
   * matters.
   */
  balanceCents: number;
}

// ---------------------------------------------------------------------------
// Journal entries
// ---------------------------------------------------------------------------

export type JournalEntryStatus = "draft" | "posted" | "void";

export type JournalReferenceType =
  | "invoice"
  | "expense"
  | "payment"
  | "manual"
  | "adjustment"
  | "opening_balance"
  | "closing";

export interface JournalLine {
  /** Reference to ChartOfAccount.code */
  accountCode: string;
  /** Debit amount in cents (mutually exclusive with creditCents > 0) */
  debitCents: number;
  /** Credit amount in cents (mutually exclusive with debitCents > 0) */
  creditCents: number;
  description?: string;
  /** Optional link to a customer/vendor contact */
  contactId?: string;
  /** Optional link to a product/item */
  productId?: string;
  /** Optional cost center / project tag */
  costCenter?: string;
}

export interface JournalEntry {
  id: string;
  /** Human-readable identifier, e.g. "JE-2026-000001" */
  entryNumber: string;
  /** Transaction date (ISO yyyy-mm-dd) */
  date: string;
  description: string;
  descriptionAr?: string;
  /** Origin of the entry (e.g. auto-posted from an invoice) */
  referenceType?: JournalReferenceType;
  /** Source entity id (invoice id, expense id, etc.) */
  referenceId?: string;
  status: JournalEntryStatus;
  lines: JournalLine[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  createdBy?: string;
  postedAt?: string;
  postedBy?: string;
  /** Entry id of any reversal entry created from this one */
  reversedBy?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitCents: number;
  creditCents: number;
  /** Signed balance — positive for "natural" side, negative otherwise. */
  balanceCents: number;
}

// ---------------------------------------------------------------------------
// Financial statements
// ---------------------------------------------------------------------------

export interface StatementLine {
  accountCode: string;
  name: string;
  amountCents: number;
}

export interface IncomeStatement {
  periodFrom: string;
  periodTo: string;
  revenue: StatementLine[];
  totalRevenueCents: number;
  cogs: StatementLine[];
  totalCogsCents: number;
  grossProfitCents: number;
  expenses: StatementLine[];
  totalExpensesCents: number;
  operatingIncomeCents: number;
  otherIncome: StatementLine[];
  otherExpenses: StatementLine[];
  netIncomeCents: number;
}

export interface BalanceSheet {
  asOfDate: string;
  assets: {
    currentAssets: StatementLine[];
    totalCurrentAssetsCents: number;
    fixedAssets: StatementLine[];
    totalFixedAssetsCents: number;
    otherAssets: StatementLine[];
    totalAssetsCents: number;
  };
  liabilities: {
    currentLiabilities: StatementLine[];
    totalCurrentLiabilitiesCents: number;
    longTermLiabilities: StatementLine[];
    totalLiabilitiesCents: number;
  };
  equity: {
    items: StatementLine[];
    totalEquityCents: number;
  };
  totalLiabilitiesAndEquityCents: number;
}

export interface CashFlowLine {
  description: string;
  amountCents: number;
}

export interface CashFlowStatement {
  periodFrom: string;
  periodTo: string;
  operating: CashFlowLine[];
  netOperatingCents: number;
  investing: CashFlowLine[];
  netInvestingCents: number;
  financing: CashFlowLine[];
  netFinancingCents: number;
  netChangeInCashCents: number;
  beginningCashCents: number;
  endingCashCents: number;
}

// ---------------------------------------------------------------------------
// Helpers (pure utility functions usable in client + server)
// ---------------------------------------------------------------------------

export function isDebitNormal(type: AccountType): boolean {
  return type === "asset" || type === "expense";
}

export function isCreditNormal(type: AccountType): boolean {
  return type === "liability" || type === "equity" || type === "revenue";
}

/**
 * Validate a list of journal lines. Returns ok=true only when:
 *  - there are >= 2 lines,
 *  - each line is debit-or-credit (not both, not zero),
 *  - sum of debits === sum of credits.
 */
export function validateJournalLines(lines: JournalLine[]): {
  valid: boolean;
  errors: string[];
  totalDebitsCents: number;
  totalCreditsCents: number;
} {
  const errors: string[] = [];
  if (!Array.isArray(lines) || lines.length < 2) {
    errors.push("A journal entry needs at least two lines.");
  }
  let totalDebitsCents = 0;
  let totalCreditsCents = 0;
  for (let i = 0; i < (lines?.length ?? 0); i++) {
    const line = lines[i]!;
    const d = Number(line.debitCents ?? 0);
    const c = Number(line.creditCents ?? 0);
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0) {
      errors.push(`Line ${i + 1}: debit and credit must be non-negative numbers.`);
    }
    if (d > 0 && c > 0) {
      errors.push(`Line ${i + 1}: a line cannot have both a debit and a credit.`);
    }
    if (d === 0 && c === 0) {
      errors.push(`Line ${i + 1}: a line must have either a debit or a credit.`);
    }
    if (!line.accountCode || typeof line.accountCode !== "string") {
      errors.push(`Line ${i + 1}: accountCode is required.`);
    }
    totalDebitsCents += d;
    totalCreditsCents += c;
  }
  if (totalDebitsCents !== totalCreditsCents) {
    errors.push(
      `Entry must balance: debits=${totalDebitsCents} cents, credits=${totalCreditsCents} cents.`,
    );
  }
  return {
    valid: errors.length === 0,
    errors,
    totalDebitsCents,
    totalCreditsCents,
  };
}
