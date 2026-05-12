// ---------------------------------------------------------------------------
// Plaid bank connector (international / dev)
// ---------------------------------------------------------------------------
//
// Plaid uses a Link-token flow rather than a pure OAuth redirect:
//   1. POST /link/token/create        — server creates a short-lived link_token
//   2. Customer launches Plaid Link   — client SDK with the link_token
//   3. Client exchanges public_token  — POST /item/public_token/exchange → access_token
//   4. GET /accounts/get              — accounts associated with the item
//   5. POST /transactions/sync        — paginated transaction sync
//
// We model the "link_token" as our `consentId` and the public_token-exchange
// as `completeConsent` to keep one common interface across regions.
//
// Required env (real mode):
//   PLAID_CLIENT_ID
//   PLAID_SECRET
//   PLAID_ENV   — "sandbox" | "development" | "production" (default: "sandbox")

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

function envOk(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function baseUrl(): string {
  const env = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  switch (env) {
    case "production":
      return "https://production.plaid.com";
    case "development":
      return "https://development.plaid.com";
    default:
      return "https://sandbox.plaid.com";
  }
}

const tokenCache = new Map<string, string>(); // consentId → access_token

interface PlaidAccount {
  account_id: string;
  name?: string;
  official_name?: string;
  mask?: string;
  type?: string;
  subtype?: string;
  balances?: {
    available?: number | null;
    current?: number | null;
    iso_currency_code?: string | null;
  };
}

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number; // positive = money out, negative = money in (per Plaid)
  iso_currency_code?: string | null;
  date: string;
  name?: string;
  merchant_name?: string;
  category?: string[];
  pending?: boolean;
  payment_meta?: { reference_number?: string };
}

async function plaidPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  if (!res.ok) {
    throw new Error(`Plaid ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

function plaidTypeToBank(type?: string, subtype?: string): BankAccountInfo["type"] {
  if (type === "credit" || subtype === "credit card") return "credit_card";
  if (type === "loan") return "loan";
  if (subtype === "savings") return "savings";
  return "checking";
}

function mapAccount(raw: PlaidAccount): BankAccountInfo {
  const currency = raw.balances?.iso_currency_code ?? "USD";
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 1000 : 100;
  const balance =
    raw.balances?.available ?? raw.balances?.current ?? 0;
  return {
    id: raw.account_id,
    externalAccountId: raw.account_id,
    bankName: "Plaid Linked Bank",
    bankCode: "PLAID",
    accountName: raw.official_name ?? raw.name ?? "Account",
    accountNumber: raw.mask ?? "",
    type: plaidTypeToBank(raw.type, raw.subtype),
    currency,
    balanceCents: Math.round(balance * decimals),
    availableBalanceCents:
      raw.balances?.available != null
        ? Math.round(raw.balances.available * decimals)
        : undefined,
    asOfDate: new Date().toISOString(),
  };
}

function mapTxn(raw: PlaidTransaction): BankTransaction {
  const currency = raw.iso_currency_code ?? "USD";
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 1000 : 100;
  // Plaid uses positive=outflow; we use positive=inflow. Invert.
  const cents = Math.round(-raw.amount * decimals);
  return {
    id: raw.transaction_id,
    externalTxnId: raw.transaction_id,
    accountId: raw.account_id,
    date: raw.date,
    amountCents: cents,
    currency,
    type: cents >= 0 ? "credit" : "debit",
    description: raw.name ?? "",
    merchantName: raw.merchant_name,
    category: raw.category?.join(" / "),
    reference: raw.payment_meta?.reference_number,
    status: raw.pending ? "pending" : "posted",
    reconciliationStatus: "unreconciled",
  };
}

export function createPlaidConnector(): BankConnector {
  if (!envOk()) {
    // eslint-disable-next-line no-console
    console.log("[banking-plaid] mock: PLAID_CLIENT_ID/SECRET not set — falling back to mock");
    const mock = createMockConnector();
    return {
      ...mock,
      name: "plaid",
      supportedCountries: () => ["US", "CA", "GB", "FR", "DE"],
    };
  }

  async function initiateConsent(
    opts: InitiateConsentInput,
  ): Promise<{ consentId: string; authUrl: string }> {
    // /link/token/create returns a link_token; the client SDK opens Plaid
    // Link UI with this token. We surface a "launch URL" that the UI uses
    // to invoke the SDK or — for testing — a sandbox auto-link page.
    const res = await plaidPost<{ link_token: string }>(
      "/link/token/create",
      {
        user: { client_user_id: opts.companyId },
        client_name: "Paperclip",
        products: ["transactions"],
        country_codes: ["US", "CA", "GB"],
        language: "en",
        redirect_uri: opts.redirectUrl,
      },
    );
    const consentId = `plaid_${res.link_token.slice(-12)}`;
    // For real Plaid Link we return the link_token so the UI can launch
    // Plaid.create({ token: link_token }). For backward-compat we also
    // surface it as a fragment on the redirect URL.
    const authUrl = `${opts.redirectUrl}#plaid_link_token=${encodeURIComponent(res.link_token)}`;
    return { consentId, authUrl };
  }

  async function completeConsent(
    consentId: string,
    publicToken?: string,
  ): Promise<BankConsent> {
    if (!publicToken) {
      throw new Error("Plaid completeConsent requires the public_token from Plaid Link");
    }
    const res = await plaidPost<{ access_token: string; item_id: string }>(
      "/item/public_token/exchange",
      { public_token: publicToken },
    );
    tokenCache.set(consentId, res.access_token);
    return {
      id: consentId,
      connectorName: "plaid",
      externalConsentId: consentId,
      status: "active",
      scopes: ["accounts", "transactions"],
      expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(),
      accounts: [],
    };
  }

  function getToken(consentId: string): string {
    const t = tokenCache.get(consentId);
    if (!t) throw new Error(`No Plaid access_token cached for ${consentId}`);
    return t;
  }

  async function listAccounts(consentId: string): Promise<BankAccountInfo[]> {
    const access_token = getToken(consentId);
    const res = await plaidPost<{ accounts: PlaidAccount[] }>(
      "/accounts/get",
      { access_token },
    );
    return res.accounts.map(mapAccount);
  }

  async function fetchTransactions(
    consentId: string,
    accountId: string,
    opts?: FetchTransactionsOptions,
  ): Promise<BankTransaction[]> {
    const access_token = getToken(consentId);
    const to = opts?.to ?? new Date().toISOString().slice(0, 10);
    const from =
      opts?.from ??
      new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
    const res = await plaidPost<{ transactions: PlaidTransaction[] }>(
      "/transactions/get",
      {
        access_token,
        start_date: from.slice(0, 10),
        end_date: to.slice(0, 10),
        options: {
          account_ids: [accountId],
          count: Math.min(opts?.limit ?? 100, 500),
        },
      },
    );
    return res.transactions.map(mapTxn);
  }

  async function revokeConsent(consentId: string): Promise<void> {
    const access_token = tokenCache.get(consentId);
    if (access_token) {
      try {
        await plaidPost("/item/remove", { access_token });
      } catch {
        /* best-effort */
      }
    }
    tokenCache.delete(consentId);
  }

  // Mark unused on purpose to silence "unused" lints in some configs.
  void mockId;

  return {
    name: "plaid",
    isConfigured: () => envOk(),
    supportedCountries: () => ["US", "CA", "GB", "FR", "DE"],
    initiateConsent,
    completeConsent,
    listAccounts,
    fetchTransactions,
    revokeConsent,
  };
}
