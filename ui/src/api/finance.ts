import { api } from "./client";

export interface InvoiceLine {
  description: string;
  qty: number;
  unitPriceMinor: number;
}

export interface InvoiceRow {
  id: string;
  companyId: string;
  number: string | null;
  customerId: string | null;
  customerName: string | null;
  issueDate: string | null;
  dueDate: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  currency: string;
  status: string;
  lines: InvoiceLine[];
  journalEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillRow {
  id: string;
  companyId: string;
  number: string | null;
  vendorId: string | null;
  vendorName: string | null;
  issueDate: string | null;
  dueDate: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  currency: string;
  status: string;
  lines: InvoiceLine[];
  journalEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankAccountRow {
  id: string;
  companyId: string;
  name: string;
  accountNumber: string | null;
  currency: string;
  balanceMinor: number;
  ledgerAccountCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankTransactionRow {
  id: string;
  companyId: string;
  bankAccountId: string | null;
  date: string | null;
  description: string | null;
  amountMinor: number;
  reconciled: boolean;
  matchedPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Statements {
  pnl: {
    revenueMinor: number;
    expenseMinor: number;
    netIncomeMinor: number;
  };
  balanceSheet: {
    assetsMinor: number;
    liabilitiesMinor: number;
    equityMinor: number;
  };
}

export interface AgingBuckets {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  totalOutstanding: number;
}

export interface InvoiceCreateInput {
  number?: string | null;
  customerName?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  subtotalMinor: number;
  taxMinor?: number;
  totalMinor?: number;
  currency: string;
  lines?: InvoiceLine[];
}

export interface BillCreateInput {
  number?: string | null;
  vendorName?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  subtotalMinor: number;
  taxMinor?: number;
  totalMinor?: number;
  currency: string;
  lines?: InvoiceLine[];
}

export interface BankAccountCreateInput {
  name: string;
  accountNumber?: string | null;
  currency: string;
  balanceMinor?: number;
  ledgerAccountCode?: string | null;
}

export const financeApi = {
  // Invoices (AR)
  listInvoices: (companyId: string) =>
    api.get<{ invoices: InvoiceRow[] }>(
      `/companies/${companyId}/finance/invoices`,
    ),
  createInvoice: (companyId: string, body: InvoiceCreateInput) =>
    api.post<InvoiceRow>(`/companies/${companyId}/finance/invoices`, body),
  postInvoice: (companyId: string, id: string) =>
    api.post<InvoiceRow>(
      `/companies/${companyId}/finance/invoices/${id}/post`,
      {},
    ),
  payInvoice: (
    companyId: string,
    id: string,
    body: { amountMinor: number; method?: string },
  ) =>
    api.post<{ invoice: InvoiceRow }>(
      `/companies/${companyId}/finance/invoices/${id}/pay`,
      body,
    ),

  // Bills (AP)
  listBills: (companyId: string) =>
    api.get<{ bills: BillRow[] }>(`/companies/${companyId}/finance/bills`),
  createBill: (companyId: string, body: BillCreateInput) =>
    api.post<BillRow>(`/companies/${companyId}/finance/bills`, body),
  postBill: (companyId: string, id: string) =>
    api.post<BillRow>(`/companies/${companyId}/finance/bills/${id}/post`, {}),
  payBill: (
    companyId: string,
    id: string,
    body: { amountMinor: number; method?: string },
  ) =>
    api.post<{ bill: BillRow }>(
      `/companies/${companyId}/finance/bills/${id}/pay`,
      body,
    ),

  // Banking
  listBankAccounts: (companyId: string) =>
    api.get<{ bankAccounts: BankAccountRow[] }>(
      `/companies/${companyId}/finance/bank-accounts`,
    ),
  createBankAccount: (companyId: string, body: BankAccountCreateInput) =>
    api.post<BankAccountRow>(
      `/companies/${companyId}/finance/bank-accounts`,
      body,
    ),
  listBankTransactions: (companyId: string, bankAccountId?: string) => {
    const params = new URLSearchParams();
    if (bankAccountId) params.set("bankAccountId", bankAccountId);
    const qs = params.toString();
    return api.get<{ bankTransactions: BankTransactionRow[] }>(
      `/companies/${companyId}/finance/bank-transactions${qs ? `?${qs}` : ""}`,
    );
  },
  reconcileBankTransaction: (
    companyId: string,
    id: string,
    body: { matchedPaymentId?: string } = {},
  ) =>
    api.post<BankTransactionRow>(
      `/companies/${companyId}/finance/bank-transactions/${id}/reconcile`,
      body,
    ),

  // Statements + aging
  statements: (companyId: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return api.get<Statements>(
      `/companies/${companyId}/finance/statements${qs ? `?${qs}` : ""}`,
    );
  },
  aging: (companyId: string, kind: "ar" | "ap") =>
    api.get<{ kind: string; buckets: AgingBuckets }>(
      `/companies/${companyId}/finance/aging?kind=${kind}`,
    ),
};
