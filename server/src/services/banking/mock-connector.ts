// ---------------------------------------------------------------------------
// Mock bank connector
// ---------------------------------------------------------------------------
//
// The mock connector is always "configured" — it is the default fallback for
// dev/demo environments where real OBA credentials are unavailable. It
// generates plausible-looking Kuwaiti / GCC bank data so the UI can be
// exercised end-to-end (consent → accounts → transactions → reconciliation).
//
// Generation is seeded by the consent id so repeated calls for the same
// consent return a stable account list and a stable, growing-over-time
// transaction set.

import {
  mockId,
  type BankAccountInfo,
  type BankConnector,
  type BankConsent,
  type BankTransaction,
  type FetchTransactionsOptions,
  type InitiateConsentInput,
} from "./index.js";

// ---------------------------------------------------------------------------
// Realistic GCC merchants
// ---------------------------------------------------------------------------

interface MerchantSeed {
  name: string;
  category: string;
  /** Min/max in minor units (KWD fils — 1000 fils = 1 KWD). */
  range: [number, number];
}

const KUWAITI_MERCHANTS: MerchantSeed[] = [
  { name: "Sultan Center", category: "groceries", range: [5_000, 35_000] },
  { name: "Carrefour Avenues", category: "groceries", range: [8_000, 60_000] },
  { name: "Lulu Hypermarket", category: "groceries", range: [4_000, 40_000] },
  { name: "Co-op Salwa", category: "groceries", range: [3_000, 22_000] },
  { name: "Mubarakiya Souq", category: "groceries", range: [2_000, 15_000] },
  { name: "KFC Salmiya", category: "food", range: [2_500, 9_000] },
  { name: "Slider Station", category: "food", range: [3_000, 12_000] },
  { name: "Burger Boutique", category: "food", range: [3_500, 11_000] },
  { name: "Maki Sushi", category: "food", range: [8_000, 35_000] },
  { name: "Caribou Coffee", category: "food", range: [1_200, 4_500] },
  { name: "%Arabica Kuwait", category: "food", range: [1_500, 6_000] },
  { name: "Talabat", category: "food", range: [3_000, 18_000] },
  { name: "Deliveroo Kuwait", category: "food", range: [3_500, 16_000] },
  { name: "Zain Telecom", category: "telecom", range: [10_000, 35_000] },
  { name: "Ooredoo Kuwait", category: "telecom", range: [10_000, 40_000] },
  { name: "stc Kuwait", category: "telecom", range: [8_000, 25_000] },
  { name: "MEW Electricity Bill", category: "utilities", range: [15_000, 80_000] },
  { name: "KNPC Fuel", category: "fuel", range: [3_500, 18_000] },
  { name: "Q8 Petrol Station", category: "fuel", range: [3_000, 16_000] },
  { name: "Salam International", category: "shopping", range: [10_000, 250_000] },
  { name: "Eureka Electronics", category: "shopping", range: [15_000, 350_000] },
  { name: "Xcite Alghanim", category: "shopping", range: [12_000, 400_000] },
  { name: "IKEA Kuwait", category: "shopping", range: [8_000, 200_000] },
  { name: "Centrepoint Avenues", category: "shopping", range: [5_000, 80_000] },
  { name: "Splash Salmiya", category: "shopping", range: [4_000, 30_000] },
  { name: "Boutiqaat", category: "shopping", range: [6_000, 60_000] },
  { name: "Bayt Lothan Pharmacy", category: "health", range: [2_000, 25_000] },
  { name: "Royale Hayat Hospital", category: "health", range: [20_000, 500_000] },
  { name: "Dar Al Shifa", category: "health", range: [15_000, 250_000] },
  { name: "Uber Kuwait", category: "transport", range: [1_500, 9_000] },
  { name: "Careem Kuwait", category: "transport", range: [1_500, 9_000] },
  { name: "Kuwait Airways", category: "travel", range: [80_000, 600_000] },
  { name: "Jazeera Airways", category: "travel", range: [40_000, 350_000] },
  { name: "Netflix Subscription", category: "subscriptions", range: [3_700, 3_700] },
  { name: "Spotify Family", category: "subscriptions", range: [4_500, 4_500] },
  { name: "AWS Cloud Services", category: "software", range: [10_000, 250_000] },
  { name: "Google Workspace", category: "software", range: [4_000, 50_000] },
  { name: "Microsoft 365", category: "software", range: [3_000, 40_000] },
];

const INCOMING_PAYERS: MerchantSeed[] = [
  { name: "Alghanim Industries WPS", category: "payroll", range: [400_000, 1_500_000] },
  { name: "Kuwait Finance House Transfer", category: "transfer", range: [50_000, 800_000] },
  { name: "NBK Wire Inbound", category: "transfer", range: [25_000, 500_000] },
  { name: "Customer Invoice Payment", category: "ar_payment", range: [15_000, 350_000] },
  { name: "MyFatoorah Settlement", category: "ar_payment", range: [8_000, 200_000] },
  { name: "KNET Settlement", category: "ar_payment", range: [10_000, 250_000] },
  { name: "Tap Payments Payout", category: "ar_payment", range: [8_000, 180_000] },
];

const KUWAITI_BANKS = [
  { code: "NBK", name: "National Bank of Kuwait" },
  { code: "KFH", name: "Kuwait Finance House" },
  { code: "BBK", name: "Burgan Bank" },
  { code: "GBK", name: "Gulf Bank" },
  { code: "ABK", name: "Al Ahli Bank of Kuwait" },
  { code: "BKK", name: "Boubyan Bank" },
];

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) so the same consent yields the same data
// ---------------------------------------------------------------------------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randomInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export function createMockConnector(): BankConnector {
  // In-memory store keyed by consent id. Persisting accounts/transactions to
  // the DB is handled by the BankingService — this map just keeps the data
  // stable per connector lifetime so re-fetching works.
  const consentStore = new Map<string, BankConsent>();

  async function initiateConsent(
    opts: InitiateConsentInput,
  ): Promise<{ consentId: string; authUrl: string }> {
    const consentId = mockId("mock_consent");
    const authUrl = `${opts.redirectUrl}?consent=${consentId}&mock=1`;
    return { consentId, authUrl };
  }

  async function completeConsent(
    consentId: string,
    _authCode?: string,
  ): Promise<BankConsent> {
    const rng = mulberry32(hashString(consentId));
    const accountIds = [
      `mock_acc_${consentId.slice(-6)}_chk`,
      `mock_acc_${consentId.slice(-6)}_sav`,
    ];
    // Add a credit card ~50% of the time.
    if (rng() > 0.5) accountIds.push(`mock_acc_${consentId.slice(-6)}_cc`);
    const consent: BankConsent = {
      id: consentId,
      connectorName: "mock",
      externalConsentId: consentId,
      status: "active",
      scopes: ["accounts", "transactions", "balances"],
      expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString(),
      accounts: accountIds,
    };
    consentStore.set(consentId, consent);
    // eslint-disable-next-line no-console
    console.log("[banking-mock] mock: consent completed", { consentId });
    return consent;
  }

  async function listAccounts(consentId: string): Promise<BankAccountInfo[]> {
    let consent = consentStore.get(consentId);
    if (!consent) {
      consent = await completeConsent(consentId);
    }
    const rng = mulberry32(hashString(consentId));
    const bank = pick(rng, KUWAITI_BANKS);
    return consent.accounts.map((extId, idx) => {
      const isCheck = extId.endsWith("_chk");
      const isSav = extId.endsWith("_sav");
      const isCc = extId.endsWith("_cc");
      const type: BankAccountInfo["type"] = isCheck
        ? "checking"
        : isSav
          ? "savings"
          : isCc
            ? "credit_card"
            : "checking";
      const balance =
        isCheck
          ? randomInt(rng, 1_000_000, 8_500_000) // 1k - 8.5k KWD
          : isSav
            ? randomInt(rng, 5_000_000, 35_000_000)
            : -randomInt(rng, 100_000, 1_200_000); // credit card outstanding
      return {
        id: extId,
        externalAccountId: extId,
        bankName: bank.name,
        bankCode: bank.code,
        accountName: isCheck
          ? "Business Current Account"
          : isSav
            ? "Business Savings"
            : "Corporate Credit Card",
        accountNumber: String(randomInt(rng, 1000, 9999)).padStart(4, "0"),
        iban: `KW${randomInt(rng, 10, 99)}${bank.code}${String(randomInt(rng, 100000, 999999))}${String(idx).padStart(3, "0")}`,
        type,
        currency: "KWD",
        balanceCents: balance,
        availableBalanceCents: isCc
          ? Math.max(0, 2_000_000 + balance) // credit limit 2k KWD - outstanding
          : balance,
        asOfDate: new Date().toISOString(),
      };
    });
  }

  async function fetchTransactions(
    consentId: string,
    accountId: string,
    opts?: FetchTransactionsOptions,
  ): Promise<BankTransaction[]> {
    const seed = hashString(`${consentId}|${accountId}`);
    const rng = mulberry32(seed);
    const limit = Math.min(opts?.limit ?? 50, 200);

    const txns: BankTransaction[] = [];
    const now = Date.now();
    const daySpan = 90;
    const targetCount = Math.min(limit, randomInt(rng, 35, 60));

    for (let i = 0; i < targetCount; i++) {
      const daysAgo = randomInt(rng, 0, daySpan);
      const txnDate = new Date(now - daysAgo * 86400_000 - randomInt(rng, 0, 86400) * 1000);
      const isIncome = rng() < 0.18; // ~18% of txns are inbound
      const seedItem = isIncome
        ? pick(rng, INCOMING_PAYERS)
        : pick(rng, KUWAITI_MERCHANTS);
      const rawAmount = randomInt(rng, seedItem.range[0], seedItem.range[1]);
      const amount = isIncome ? rawAmount : -rawAmount;
      const externalTxnId = `mock_txn_${seed.toString(16)}_${i.toString().padStart(4, "0")}`;
      txns.push({
        id: externalTxnId,
        externalTxnId,
        accountId,
        date: txnDate.toISOString(),
        amountCents: amount,
        currency: "KWD",
        type: isIncome ? "credit" : "debit",
        description: seedItem.name,
        merchantName: seedItem.name,
        category: seedItem.category,
        reference:
          isIncome && rng() > 0.5
            ? `INV-${new Date().getFullYear()}-${String(randomInt(rng, 1, 200)).padStart(3, "0")}`
            : undefined,
        status: daysAgo === 0 && rng() > 0.7 ? "pending" : "posted",
        reconciliationStatus: "unreconciled",
      });
    }

    // Newest first
    txns.sort((a, b) => b.date.localeCompare(a.date));
    // Date range filter
    const from = opts?.from ? new Date(opts.from).getTime() : -Infinity;
    const to = opts?.to ? new Date(opts.to).getTime() : Infinity;
    return txns.filter((t) => {
      const ts = new Date(t.date).getTime();
      return ts >= from && ts <= to;
    });
  }

  async function revokeConsent(consentId: string): Promise<void> {
    consentStore.delete(consentId);
    // eslint-disable-next-line no-console
    console.log("[banking-mock] mock: consent revoked", { consentId });
  }

  return {
    name: "mock",
    isConfigured: () => true,
    supportedCountries: () => ["KW", "SA", "AE", "BH", "QA", "OM"],
    initiateConsent,
    completeConsent,
    listAccounts,
    fetchTransactions,
    revokeConsent,
  };
}
