// ---------------------------------------------------------------------------
// SAMA Saudi Open Banking connector
// ---------------------------------------------------------------------------
//
// The Saudi Arabian Monetary Authority (SAMA) Open Banking Framework also
// follows OAuth 2.0 + FAPI. Endpoint paths differ but the dance is the same
// as CBK Kuwait. See cbk-kuwait-connector.ts for the rationale behind the
// mock fallback.
//
// Required env (real mode):
//   SAMA_OBA_CLIENT_ID
//   SAMA_OBA_CLIENT_SECRET
//   SAMA_OBA_REDIRECT_URI
//   SAMA_OBA_BASE_URL  — defaults to the sandbox URL below

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

const DEFAULT_SAMA_BASE = "https://api.openbanking.sa/aisp/v1";
const DEFAULT_SCOPES = ["accounts", "balances", "transactions"];

function envOk(): boolean {
  return Boolean(
    process.env.SAMA_OBA_CLIENT_ID && process.env.SAMA_OBA_CLIENT_SECRET,
  );
}

function baseUrl(): string {
  return process.env.SAMA_OBA_BASE_URL ?? DEFAULT_SAMA_BASE;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

interface RawAccount {
  AccountId?: string;
  accountId?: string;
  Nickname?: string;
  AccountSubType?: string;
  Currency?: string;
  Account?: { Identification?: string; SchemeName?: string }[];
  Balance?: Array<{
    Amount?: { Amount?: string; Currency?: string };
    Type?: string;
  }>;
  ServicerName?: string;
}

interface RawTxn {
  TransactionId?: string;
  BookingDateTime?: string;
  ValueDateTime?: string;
  Amount?: { Amount?: string; Currency?: string };
  CreditDebitIndicator?: "Credit" | "Debit";
  Status?: "Booked" | "Pending" | string;
  TransactionInformation?: string;
  MerchantDetails?: { MerchantName?: string; MerchantCategoryCode?: string };
  TransactionReference?: string;
}

async function postForm<T>(
  url: string,
  form: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<T> {
  const body = new URLSearchParams(form).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });
  if (!res.ok) throw new Error(`SAMA POST ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`SAMA GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

function mapAccount(raw: RawAccount): BankAccountInfo {
  const balanceObj = raw.Balance?.find((b) => b.Type === "Available") ?? raw.Balance?.[0];
  const balanceAmt = Number(balanceObj?.Amount?.Amount ?? 0);
  const currency = balanceObj?.Amount?.Currency ?? raw.Currency ?? "SAR";
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 1000 : 100;
  const accountId = raw.AccountId ?? raw.accountId ?? mockId("sama_acc");
  const identification = raw.Account?.[0]?.Identification ?? "";
  return {
    id: accountId,
    externalAccountId: accountId,
    bankName: raw.ServicerName ?? "Saudi Bank",
    bankCode: "SA",
    accountName: raw.Nickname ?? "Account",
    accountNumber: identification.slice(-4),
    iban: raw.Account?.find((a) => a.SchemeName === "IBAN")?.Identification,
    type:
      raw.AccountSubType === "Savings"
        ? "savings"
        : raw.AccountSubType === "CreditCard"
          ? "credit_card"
          : "checking",
    currency,
    balanceCents: Math.round(balanceAmt * decimals),
    asOfDate: new Date().toISOString(),
  };
}

function mapTxn(raw: RawTxn, accountId: string): BankTransaction {
  const amt = Number(raw.Amount?.Amount ?? 0);
  const currency = raw.Amount?.Currency ?? "SAR";
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 1000 : 100;
  const sign = raw.CreditDebitIndicator === "Credit" ? 1 : -1;
  const cents = Math.round(Math.abs(amt) * decimals) * sign;
  const externalTxnId = raw.TransactionId ?? mockId("sama_txn");
  return {
    id: externalTxnId,
    externalTxnId,
    accountId,
    date: raw.BookingDateTime ?? raw.ValueDateTime ?? new Date().toISOString(),
    amountCents: cents,
    currency,
    type: sign > 0 ? "credit" : "debit",
    description: raw.TransactionInformation ?? "",
    merchantName: raw.MerchantDetails?.MerchantName,
    category: raw.MerchantDetails?.MerchantCategoryCode,
    reference: raw.TransactionReference,
    status: raw.Status === "Pending" ? "pending" : "posted",
    reconciliationStatus: "unreconciled",
  };
}

export function createSamaSaudiConnector(): BankConnector {
  if (!envOk()) {
    // eslint-disable-next-line no-console
    console.log(
      "[banking-sama] mock: SAMA_OBA_CLIENT_ID / SECRET not set — falling back to mock",
    );
    const mock = createMockConnector();
    return {
      ...mock,
      name: "sama_saudi",
      supportedCountries: () => ["SA"],
    };
  }

  async function initiateConsent(
    opts: InitiateConsentInput,
  ): Promise<{ consentId: string; authUrl: string }> {
    const clientId = process.env.SAMA_OBA_CLIENT_ID!;
    const scopes = (opts.scopes ?? DEFAULT_SCOPES).join(" ");
    // SAMA AISP: POST /account-access-consents
    const tokenRes = await postForm<{ access_token: string }>(
      `${baseUrl()}/token`,
      {
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: process.env.SAMA_OBA_CLIENT_SECRET!,
        scope: "accounts",
      },
    );
    const consentRes = await fetch(`${baseUrl()}/account-access-consents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenRes.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Data: {
          Permissions: [
            "ReadAccountsBasic",
            "ReadAccountsDetail",
            "ReadBalances",
            "ReadTransactionsBasic",
            "ReadTransactionsDetail",
          ],
          ExpirationDateTime: new Date(
            Date.now() + 90 * 86400_000,
          ).toISOString(),
        },
        Risk: {},
      }),
    });
    if (!consentRes.ok) {
      throw new Error(`SAMA consent creation failed: ${consentRes.status}`);
    }
    const consentBody = (await consentRes.json()) as {
      Data?: { ConsentId?: string };
    };
    const consentId = consentBody.Data?.ConsentId ?? mockId("sama_consent");
    const state = `${opts.companyId}:${consentId}`;
    const authUrl = `${baseUrl()}/authorize?response_type=code+id_token&client_id=${encodeURIComponent(
      clientId,
    )}&redirect_uri=${encodeURIComponent(
      process.env.SAMA_OBA_REDIRECT_URI ?? opts.redirectUrl,
    )}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(
      state,
    )}&request=${encodeURIComponent(consentId)}`;
    return { consentId, authUrl };
  }

  async function completeConsent(
    consentId: string,
    authCode?: string,
  ): Promise<BankConsent> {
    if (!authCode) throw new Error("SAMA completeConsent requires auth code");
    const tokenRes = await postForm<{
      access_token: string;
      expires_in?: number;
      scope?: string;
    }>(`${baseUrl()}/token`, {
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: process.env.SAMA_OBA_REDIRECT_URI ?? "",
      client_id: process.env.SAMA_OBA_CLIENT_ID!,
      client_secret: process.env.SAMA_OBA_CLIENT_SECRET!,
    });
    tokenCache.set(consentId, {
      token: tokenRes.access_token,
      expiresAt: Date.now() + (tokenRes.expires_in ?? 3600) * 1000,
    });
    return {
      id: consentId,
      connectorName: "sama_saudi",
      externalConsentId: consentId,
      status: "active",
      scopes: tokenRes.scope?.split(" ") ?? DEFAULT_SCOPES,
      expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString(),
      accounts: [],
    };
  }

  async function getToken(consentId: string): Promise<string> {
    const cached = tokenCache.get(consentId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    throw new Error(`No SAMA token cached for consent ${consentId}`);
  }

  async function listAccounts(consentId: string): Promise<BankAccountInfo[]> {
    const token = await getToken(consentId);
    const res = await getJson<{ Data?: { Account?: RawAccount[] } }>(
      `${baseUrl()}/accounts`,
      token,
    );
    return (res.Data?.Account ?? []).map(mapAccount);
  }

  async function fetchTransactions(
    consentId: string,
    accountId: string,
    opts?: FetchTransactionsOptions,
  ): Promise<BankTransaction[]> {
    const token = await getToken(consentId);
    const params = new URLSearchParams();
    if (opts?.from) params.set("fromBookingDateTime", opts.from);
    if (opts?.to) params.set("toBookingDateTime", opts.to);
    const qs = params.toString();
    const res = await getJson<{ Data?: { Transaction?: RawTxn[] } }>(
      `${baseUrl()}/accounts/${encodeURIComponent(accountId)}/transactions${qs ? `?${qs}` : ""}`,
      token,
    );
    const txns = (res.Data?.Transaction ?? []).map((t) => mapTxn(t, accountId));
    if (opts?.limit) return txns.slice(0, opts.limit);
    return txns;
  }

  async function revokeConsent(consentId: string): Promise<void> {
    try {
      const token = await getToken(consentId);
      await fetch(
        `${baseUrl()}/account-access-consents/${encodeURIComponent(consentId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
    } catch {
      /* best-effort */
    }
    tokenCache.delete(consentId);
  }

  return {
    name: "sama_saudi",
    isConfigured: () => envOk(),
    supportedCountries: () => ["SA"],
    initiateConsent,
    completeConsent,
    listAccounts,
    fetchTransactions,
    revokeConsent,
  };
}
