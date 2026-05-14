// ---------------------------------------------------------------------------
// CBK Kuwait Open Banking connector
// ---------------------------------------------------------------------------
//
// The Central Bank of Kuwait (CBK) Open Banking Framework follows the
// OAuth 2.0 + FAPI pattern shared by most GCC regulators: a "Trusted Service
// Provider" (TSP) registers with the bank, obtains a clientId/clientSecret,
// and walks each customer through a consent-redirect flow:
//
//   1. POST /consent           — TSP creates a consent intent
//   2. Redirect customer to    — bank-hosted consent page
//      <bank>/authorize?...
//   3. Bank redirects back     — with `code` (auth code) to TSP redirect URI
//   4. POST /token             — TSP exchanges code for access_token
//   5. GET  /accounts          — list accounts in scope
//   6. GET  /accounts/:id/transactions
//
// Required env (real mode):
//   CBK_OBA_CLIENT_ID
//   CBK_OBA_CLIENT_SECRET
//   CBK_OBA_REDIRECT_URI
//   CBK_OBA_BASE_URL   — defaults to the sandbox URL below
//
// If any of CLIENT_ID / CLIENT_SECRET is missing this falls back to the mock
// connector so dev/demo flows continue to work end-to-end.

import { createMockConnector } from "./mock-connector.js";
import {
  mockId,
  type BankAccountInfo,
  type BankConnector,
  type BankConsent,
  type BankTransaction,
  type FetchTransactionsOptions,
  type InitiateConsentInput,
} from "./index.js";

const DEFAULT_CBK_BASE = "https://api.openbanking.cbk.gov.kw/v1";
const DEFAULT_SCOPES = ["accounts", "balances", "transactions"];

interface RawAccount {
  accountId?: string;
  id?: string;
  bankCode?: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  iban?: string;
  type?: string;
  currency?: string;
  balance?: { amount?: string | number; currency?: string };
  availableBalance?: { amount?: string | number };
  asOfDate?: string;
}

interface RawTxn {
  transactionId?: string;
  id?: string;
  bookingDate?: string;
  valueDate?: string;
  amount?: { amount?: string | number; currency?: string };
  creditDebitIndicator?: "credit" | "debit" | string;
  status?: string;
  description?: string;
  remittanceInformation?: string;
  merchant?: { name?: string; category?: string };
  reference?: string;
}

function envOk(): boolean {
  return Boolean(
    process.env.CBK_OBA_CLIENT_ID && process.env.CBK_OBA_CLIENT_SECRET,
  );
}

function baseUrl(): string {
  return process.env.CBK_OBA_BASE_URL ?? DEFAULT_CBK_BASE;
}

function redirectUri(fallback: string): string {
  return process.env.CBK_OBA_REDIRECT_URI ?? fallback;
}

// In-memory map of consentId → access token. Real deployments persist this
// via BankingService.recordConsent (encrypted), so this cache only serves
// the in-process flow between authorize-callback and the first listAccounts.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`CBK POST ${url} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`CBK GET ${url} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

function mapAccount(raw: RawAccount): BankAccountInfo {
  const balanceAmt =
    typeof raw.balance?.amount === "number"
      ? raw.balance.amount
      : Number(raw.balance?.amount ?? 0);
  const availAmt =
    raw.availableBalance?.amount !== undefined
      ? typeof raw.availableBalance.amount === "number"
        ? raw.availableBalance.amount
        : Number(raw.availableBalance.amount)
      : undefined;
  const currency = raw.balance?.currency ?? raw.currency ?? "KWD";
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 1000 : 100;
  return {
    id: raw.accountId ?? raw.id ?? mockId("cbk_acc"),
    externalAccountId: raw.accountId ?? raw.id ?? mockId("cbk_acc"),
    bankName: raw.bankName ?? "Kuwaiti Bank",
    bankCode: raw.bankCode ?? "KW",
    accountName: raw.accountName ?? "Account",
    accountNumber: (raw.accountNumber ?? "").slice(-4),
    iban: raw.iban,
    type: (raw.type as BankAccountInfo["type"]) ?? "checking",
    currency,
    balanceCents: Math.round(balanceAmt * decimals),
    availableBalanceCents:
      availAmt !== undefined ? Math.round(availAmt * decimals) : undefined,
    asOfDate: raw.asOfDate ?? new Date().toISOString(),
  };
}

function mapTxn(raw: RawTxn, accountId: string): BankTransaction {
  const amt =
    typeof raw.amount?.amount === "number"
      ? raw.amount.amount
      : Number(raw.amount?.amount ?? 0);
  const currency = raw.amount?.currency ?? "KWD";
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 1000 : 100;
  const sign =
    raw.creditDebitIndicator === "credit"
      ? 1
      : raw.creditDebitIndicator === "debit"
        ? -1
        : amt < 0
          ? 1
          : -1;
  const cents = Math.round(Math.abs(amt) * decimals) * sign;
  const externalTxnId = raw.transactionId ?? raw.id ?? mockId("cbk_txn");
  return {
    id: externalTxnId,
    externalTxnId,
    accountId,
    date: raw.bookingDate ?? raw.valueDate ?? new Date().toISOString(),
    amountCents: cents,
    currency,
    type: sign > 0 ? "credit" : "debit",
    description: raw.description ?? raw.remittanceInformation ?? "",
    merchantName: raw.merchant?.name,
    category: raw.merchant?.category,
    reference: raw.reference,
    status: raw.status === "pending" ? "pending" : "posted",
    reconciliationStatus: "unreconciled",
  };
}

export function createCbkKuwaitConnector(): BankConnector {
  if (!envOk()) {
    // eslint-disable-next-line no-console
    console.log(
      "[banking-cbk] mock: CBK_OBA_CLIENT_ID / SECRET not set — falling back to mock",
    );
    const mock = createMockConnector();
    return {
      ...mock,
      name: "cbk_kuwait",
      supportedCountries: () => ["KW"],
    };
  }

  async function initiateConsent(
    opts: InitiateConsentInput,
  ): Promise<{ consentId: string; authUrl: string }> {
    const clientId = process.env.CBK_OBA_CLIENT_ID!;
    const clientSecret = process.env.CBK_OBA_CLIENT_SECRET!;
    const scopes = (opts.scopes ?? DEFAULT_SCOPES).join(" ");
    // Step 1: POST /consent — TSP creates a consent intent
    const intent = await postJson<{ consentId: string }>(
      `${baseUrl()}/consent`,
      {
        scopes: opts.scopes ?? DEFAULT_SCOPES,
        permissions: ["read"],
        expirationSeconds: 90 * 86400,
      },
      {
        "X-Client-Id": clientId,
        "X-Client-Secret": clientSecret,
      },
    );
    const consentId = intent.consentId ?? mockId("cbk_consent");
    const state = `${opts.companyId}:${consentId}`;
    const authUrl = `${baseUrl()}/authorize?response_type=code&client_id=${encodeURIComponent(
      clientId,
    )}&redirect_uri=${encodeURIComponent(
      redirectUri(opts.redirectUrl),
    )}&consent_id=${encodeURIComponent(consentId)}&scope=${encodeURIComponent(
      scopes,
    )}&state=${encodeURIComponent(state)}`;
    return { consentId, authUrl };
  }

  async function completeConsent(
    consentId: string,
    authCode?: string,
  ): Promise<BankConsent> {
    if (!authCode) {
      throw new Error("CBK completeConsent requires the OAuth authorization code");
    }
    const tokenRes = await postJson<{
      access_token: string;
      expires_in?: number;
      scope?: string;
    }>(`${baseUrl()}/token`, {
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: process.env.CBK_OBA_REDIRECT_URI,
      client_id: process.env.CBK_OBA_CLIENT_ID,
      client_secret: process.env.CBK_OBA_CLIENT_SECRET,
    });
    tokenCache.set(consentId, {
      token: tokenRes.access_token,
      expiresAt: Date.now() + (tokenRes.expires_in ?? 3600) * 1000,
    });
    const scopes = tokenRes.scope?.split(" ") ?? DEFAULT_SCOPES;
    return {
      id: consentId,
      connectorName: "cbk_kuwait",
      externalConsentId: consentId,
      status: "active",
      scopes,
      expiresAt: new Date(
        Date.now() + (tokenRes.expires_in ?? 90 * 86400) * 1000,
      ).toISOString(),
      accounts: [],
    };
  }

  async function getToken(consentId: string): Promise<string> {
    const cached = tokenCache.get(consentId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    throw new Error(
      `No CBK access token cached for consent ${consentId}. Re-run completeConsent or pass the stored token.`,
    );
  }

  async function listAccounts(consentId: string): Promise<BankAccountInfo[]> {
    const token = await getToken(consentId);
    const res = await getJson<{ accounts?: RawAccount[] }>(
      `${baseUrl()}/accounts`,
      token,
    );
    return (res.accounts ?? []).map(mapAccount);
  }

  async function fetchTransactions(
    consentId: string,
    accountId: string,
    opts?: FetchTransactionsOptions,
  ): Promise<BankTransaction[]> {
    const token = await getToken(consentId);
    const params = new URLSearchParams();
    if (opts?.from) params.set("fromBookingDate", opts.from);
    if (opts?.to) params.set("toBookingDate", opts.to);
    if (opts?.limit) params.set("pageSize", String(opts.limit));
    const qs = params.toString();
    const res = await getJson<{ transactions?: RawTxn[] }>(
      `${baseUrl()}/accounts/${encodeURIComponent(accountId)}/transactions${qs ? `?${qs}` : ""}`,
      token,
    );
    return (res.transactions ?? []).map((t) => mapTxn(t, accountId));
  }

  async function revokeConsent(consentId: string): Promise<void> {
    try {
      const token = await getToken(consentId);
      await fetch(`${baseUrl()}/consent/${encodeURIComponent(consentId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* best-effort */
    }
    tokenCache.delete(consentId);
  }

  return {
    name: "cbk_kuwait",
    isConfigured: () => envOk(),
    supportedCountries: () => ["KW"],
    initiateConsent,
    completeConsent,
    listAccounts,
    fetchTransactions,
    revokeConsent,
  };
}
