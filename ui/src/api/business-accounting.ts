import type {
  BalanceSheet,
  CashFlowStatement,
  ChartOfAccount,
  IncomeStatement,
  JournalEntry,
  JournalLine,
  TrialBalanceRow,
} from "@paperclipai/shared";
import { api } from "./client";

export interface LedgerLineRow {
  entryId: string;
  entryNumber: string;
  date: string;
  description: string;
  debitCents: number;
  creditCents: number;
  runningBalanceCents: number;
  referenceType?: string;
  referenceId?: string;
}

export interface TrialBalanceResponse {
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
}

export interface ClosePeriodResponse {
  closingEntries: JournalEntry[];
  netIncomeCents: number;
}

export const businessAccountingApi = {
  // Chart of Accounts
  listAccounts: (companyId: string) =>
    api.get<{ accounts: ChartOfAccount[] }>(
      `/companies/${companyId}/business/accounting/accounts`,
    ),

  createAccount: (
    companyId: string,
    body: {
      code: string;
      name: string;
      nameAr?: string;
      type: ChartOfAccount["type"];
      subtype: ChartOfAccount["subtype"];
      parentCode?: string | null;
      description?: string;
      currency?: string;
    },
  ) =>
    api.post<ChartOfAccount>(
      `/companies/${companyId}/business/accounting/accounts`,
      body,
    ),

  updateAccount: (
    companyId: string,
    code: string,
    body: Partial<{
      name: string;
      nameAr: string;
      type: ChartOfAccount["type"];
      subtype: ChartOfAccount["subtype"];
      parentCode: string | null;
      description: string;
      isActive: boolean;
    }>,
  ) =>
    api.put<ChartOfAccount>(
      `/companies/${companyId}/business/accounting/accounts/${encodeURIComponent(code)}`,
      body,
    ),

  deleteAccount: (companyId: string, code: string) =>
    api.delete<void>(
      `/companies/${companyId}/business/accounting/accounts/${encodeURIComponent(code)}`,
    ),

  seedDefaults: (companyId: string, currency?: string) =>
    api.post<{ created: number; skipped: number; accounts: ChartOfAccount[] }>(
      `/companies/${companyId}/business/accounting/accounts/seed-defaults`,
      { currency },
    ),

  // Journal
  listEntries: (
    companyId: string,
    query?: {
      from?: string;
      to?: string;
      status?: string;
      referenceType?: string;
      referenceId?: string;
      limit?: number;
    },
  ) => {
    const params = new URLSearchParams();
    if (query?.from) params.set("from", query.from);
    if (query?.to) params.set("to", query.to);
    if (query?.status) params.set("status", query.status);
    if (query?.referenceType) params.set("referenceType", query.referenceType);
    if (query?.referenceId) params.set("referenceId", query.referenceId);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return api.get<{ entries: JournalEntry[] }>(
      `/companies/${companyId}/business/accounting/journal${qs ? `?${qs}` : ""}`,
    );
  },

  createEntry: (
    companyId: string,
    body: {
      date: string;
      description: string;
      descriptionAr?: string;
      referenceType?: string;
      referenceId?: string;
      lines: JournalLine[];
      notes?: string;
    },
  ) =>
    api.post<JournalEntry>(
      `/companies/${companyId}/business/accounting/journal`,
      body,
    ),

  getEntry: (companyId: string, entryId: string) =>
    api.get<JournalEntry>(
      `/companies/${companyId}/business/accounting/journal/${entryId}`,
    ),

  postEntry: (companyId: string, entryId: string) =>
    api.post<JournalEntry>(
      `/companies/${companyId}/business/accounting/journal/${entryId}/post`,
      {},
    ),

  voidEntry: (companyId: string, entryId: string, reason?: string) =>
    api.post<JournalEntry>(
      `/companies/${companyId}/business/accounting/journal/${entryId}/void`,
      { reason },
    ),

  reverseEntry: (companyId: string, entryId: string, reason?: string) =>
    api.post<JournalEntry>(
      `/companies/${companyId}/business/accounting/journal/${entryId}/reverse`,
      { reason },
    ),

  // Ledger
  getLedger: (
    companyId: string,
    accountCode: string,
    query?: { from?: string; to?: string },
  ) => {
    const params = new URLSearchParams();
    if (query?.from) params.set("from", query.from);
    if (query?.to) params.set("to", query.to);
    const qs = params.toString();
    return api.get<{ account: ChartOfAccount; lines: LedgerLineRow[] }>(
      `/companies/${companyId}/business/accounting/ledger/${encodeURIComponent(
        accountCode,
      )}${qs ? `?${qs}` : ""}`,
    );
  },

  trialBalance: (companyId: string, asOf?: string) => {
    const qs = asOf ? `?asOf=${asOf}` : "";
    return api.get<TrialBalanceResponse>(
      `/companies/${companyId}/business/accounting/trial-balance${qs}`,
    );
  },

  // Statements
  incomeStatement: (companyId: string, from: string, to: string) =>
    api.get<IncomeStatement>(
      `/companies/${companyId}/business/accounting/income-statement?from=${from}&to=${to}`,
    ),

  balanceSheet: (companyId: string, asOf: string) =>
    api.get<BalanceSheet>(
      `/companies/${companyId}/business/accounting/balance-sheet?asOf=${asOf}`,
    ),

  cashFlow: (companyId: string, from: string, to: string) =>
    api.get<CashFlowStatement>(
      `/companies/${companyId}/business/accounting/cash-flow?from=${from}&to=${to}`,
    ),

  // Period close
  closePeriod: (companyId: string, periodEnd: string) =>
    api.post<ClosePeriodResponse>(
      `/companies/${companyId}/business/accounting/close-period`,
      { periodEnd },
    ),
};
