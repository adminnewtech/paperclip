import { api } from "./client";

export type BankConnectorName =
  | "cbk_kuwait"
  | "sama_saudi"
  | "uae_oba"
  | "plaid"
  | "mock";

export type BankAccountType = "checking" | "savings" | "credit_card" | "loan";

export type BankTransactionType = "debit" | "credit" | "fee" | "transfer";

export type BankTransactionStatus = "posted" | "pending";

export type ReconciliationStatus =
  | "unreconciled"
  | "auto_matched"
  | "manual_matched"
  | "ignored";

export interface BankAccountInfo {
  id: string;
  externalAccountId: string;
  bankName: string;
  bankCode: string;
  accountName: string;
  accountNumber: string;
  iban?: string;
  type: BankAccountType;
  currency: string;
  balanceCents: number;
  availableBalanceCents?: number;
  asOfDate: string;
}

export interface BankTransaction {
  id: string;
  externalTxnId: string;
  accountId: string;
  date: string;
  amountCents: number;
  currency: string;
  type: BankTransactionType;
  description: string;
  merchantName?: string;
  category?: string;
  reference?: string;
  status: BankTransactionStatus;
  matchedEntityId?: string;
  matchedEntityType?: string;
  reconciliationStatus: ReconciliationStatus;
}

export interface ConnectorDescriptor {
  name: BankConnectorName;
  configured: boolean;
  countries: string[];
}

export interface MatchSuggestion {
  txnId: string;
  candidateEntityId: string;
  candidateEntityType: "invoice" | "expense" | "payment";
  candidateAmount: number;
  candidateDate: string;
  candidateDescription: string;
  matchScore: number;
  matchReasons: string[];
}

export interface ConnectResponse {
  consentId: string;
  authUrl: string;
  autoCompleted: boolean;
}

export const businessBankingApi = {
  listConnectors: (companyId: string) =>
    api.get<{ connectors: ConnectorDescriptor[] }>(
      `/companies/${companyId}/business/banking/connectors`,
    ),

  connect: (
    companyId: string,
    body: {
      connector: BankConnectorName;
      redirectUrl: string;
      scopes?: string[];
    },
  ) =>
    api.post<ConnectResponse>(
      `/companies/${companyId}/business/banking/connect`,
      body,
    ),

  listAccounts: (companyId: string) =>
    api.get<{ accounts: BankAccountInfo[] }>(
      `/companies/${companyId}/business/banking/accounts`,
    ),

  syncAccount: (companyId: string, accountId: string) =>
    api.post<{ newTxns: number }>(
      `/companies/${companyId}/business/banking/accounts/${accountId}/sync`,
      {},
    ),

  listTransactions: (
    companyId: string,
    opts?: {
      accountId?: string;
      from?: string;
      to?: string;
      reconciliationStatus?: string;
      limit?: number;
    },
  ) => {
    const params = new URLSearchParams();
    if (opts?.accountId) params.set("accountId", opts.accountId);
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    if (opts?.reconciliationStatus)
      params.set("reconciliationStatus", opts.reconciliationStatus);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<{ transactions: BankTransaction[] }>(
      `/companies/${companyId}/business/banking/transactions${qs ? `?${qs}` : ""}`,
    );
  },

  matchSuggestions: (companyId: string, txnId: string) =>
    api.get<{ suggestions: MatchSuggestion[] }>(
      `/companies/${companyId}/business/banking/transactions/${txnId}/match-suggestions`,
    ),

  match: (
    companyId: string,
    txnId: string,
    body: { entityId: string; entityType: "invoice" | "expense" | "payment" },
  ) =>
    api.post<{ ok: true }>(
      `/companies/${companyId}/business/banking/transactions/${txnId}/match`,
      body,
    ),

  unmatch: (companyId: string, txnId: string) =>
    api.post<{ ok: true }>(
      `/companies/${companyId}/business/banking/transactions/${txnId}/unmatch`,
      {},
    ),

  ignore: (companyId: string, txnId: string, reason?: string) =>
    api.post<{ ok: true }>(
      `/companies/${companyId}/business/banking/transactions/${txnId}/ignore`,
      reason ? { reason } : {},
    ),

  autoReconcile: (companyId: string, threshold?: number) =>
    api.post<{ matched: number; suggestions: number }>(
      `/companies/${companyId}/business/banking/auto-reconcile`,
      threshold !== undefined ? { threshold } : {},
    ),
};
