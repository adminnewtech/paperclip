// ---------------------------------------------------------------------------
// Banking service: pluggable Open Banking connector registry
// ---------------------------------------------------------------------------
//
// Defines the `BankConnector` interface, the registry that resolves connector
// instances by name, and the `BankingService` that persists consents,
// accounts and transactions into `businessEntities` (moduleKey="banking").
//
// Every concrete connector lives in its own file in this directory and falls
// back to a deterministic mock when its environment variables are missing —
// so the entire flow can be exercised end-to-end in dev without external
// credentials.
//
// Supported connectors (Kuwait-first):
//   - cbk_kuwait   Kuwait — CBK Open Banking Framework
//   - sama_saudi   Saudi — SAMA Open Banking Framework
//   - uae_oba      UAE — Open Banking (placeholder mock)
//   - plaid        International (dev/testing)
//   - mock         Always-on stub with realistic Kuwaiti merchant names
//
// Persistence shapes (businessEntities rows):
//   moduleKey: "banking"
//   entityType: "consent"     code: consentId       data: { connectorName, scopes, expiresAt, encryptedToken, ... }
//   entityType: "account"     code: externalAcctId  data: { iban, type, balanceCents, ... }   parentId: consent row id
//   entityType: "transaction" code: externalTxnId   data: { ... }                              parentId: account row id

import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  accountNumber: string; // last 4 displayed
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
  amountCents: number; // negative = debit, positive = credit
  currency: string;
  type: BankTransactionType;
  description: string;
  merchantName?: string;
  category?: string;
  reference?: string;
  status: BankTransactionStatus;
  matchedEntityId?: string;
  matchedEntityType?: string; // "invoice" | "expense" | "payment"
  reconciliationStatus: ReconciliationStatus;
}

export interface BankConsent {
  id: string;
  connectorName: BankConnectorName;
  externalConsentId: string;
  status: "pending" | "active" | "expired" | "revoked";
  scopes: string[];
  expiresAt: string;
  accounts: string[]; // external account IDs in scope
}

export interface InitiateConsentInput {
  companyId: string;
  redirectUrl: string;
  scopes?: string[];
}

export interface FetchTransactionsOptions {
  from?: string;
  to?: string;
  limit?: number;
}

export interface BankConnector {
  name: BankConnectorName;
  isConfigured(): boolean;
  supportedCountries(): string[];
  initiateConsent(
    opts: InitiateConsentInput,
  ): Promise<{ consentId: string; authUrl: string }>;
  completeConsent(consentId: string, authCode?: string): Promise<BankConsent>;
  listAccounts(consentId: string): Promise<BankAccountInfo[]>;
  fetchTransactions(
    consentId: string,
    accountId: string,
    opts?: FetchTransactionsOptions,
  ): Promise<BankTransaction[]>;
  revokeConsent(consentId: string): Promise<void>;
}

export interface ConnectorDescriptor {
  name: BankConnectorName;
  configured: boolean;
  countries: string[];
}

export interface ListTransactionsOptions {
  accountId?: string;
  from?: string;
  to?: string;
  reconciliationStatus?: string;
  limit?: number;
}

// Forward declaration; defined in reconciliation-engine.ts.
export interface ReconciliationEngineLike {
  suggestMatches(companyId: string, txn: BankTransaction): Promise<unknown>;
  autoReconcileAll(
    companyId: string,
    threshold?: number,
  ): Promise<{ matched: number; suggestions: number }>;
}

export interface BankingService {
  getConnector(name: BankConnectorName): BankConnector;
  listAvailableConnectors(): ConnectorDescriptor[];
  recordConsent(
    companyId: string,
    consent: BankConsent,
    accessToken?: string,
  ): Promise<{ entityId: string }>;
  getConsent(
    companyId: string,
    externalConsentId: string,
  ): Promise<{ consent: BankConsent; entityId: string; accessToken?: string } | null>;
  recordAccount(
    companyId: string,
    account: BankAccountInfo,
    connectorName: BankConnectorName,
    consentId: string,
  ): Promise<void>;
  recordTransactions(
    companyId: string,
    txns: BankTransaction[],
  ): Promise<{ inserted: number; updated: number }>;
  listAccounts(companyId: string): Promise<BankAccountInfo[]>;
  getAccount(
    companyId: string,
    accountId: string,
  ): Promise<{ account: BankAccountInfo; entityId: string; connectorName: BankConnectorName; consentExternalId: string } | null>;
  listTransactions(
    companyId: string,
    opts?: ListTransactionsOptions,
  ): Promise<BankTransaction[]>;
  getTransaction(
    companyId: string,
    txnId: string,
  ): Promise<{ txn: BankTransaction; entityId: string } | null>;
  updateTransaction(
    companyId: string,
    txnId: string,
    patch: Partial<BankTransaction>,
  ): Promise<void>;
  syncAccount(
    companyId: string,
    accountId: string,
  ): Promise<{ newTxns: number }>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function mockId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

/**
 * Encode an access token for storage. THIS IS NOT SECURE — base64 is reversible.
 * TODO: replace with proper KMS/AES-GCM encryption before going to production.
 * The shape is preserved (object with `encryptedToken`) so swapping the
 * implementation is a single-file change.
 */
export function encryptToken(plaintext: string): string {
  return Buffer.from(plaintext, "utf8").toString("base64");
}

export function decryptToken(ciphertext: string): string {
  try {
    return Buffer.from(ciphertext, "base64").toString("utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Row → domain mapping
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asStringArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function rowToConsent(row: typeof businessEntities.$inferSelect): BankConsent {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    connectorName: (asString(data.connectorName, "mock") as BankConnectorName),
    externalConsentId: row.code ?? row.id,
    status: (asString(row.status, "pending") as BankConsent["status"]),
    scopes: asStringArr(data.scopes),
    expiresAt: asString(data.expiresAt, new Date(Date.now() + 90 * 86400_000).toISOString()),
    accounts: asStringArr(data.accounts),
  };
}

function rowToAccount(row: typeof businessEntities.$inferSelect): BankAccountInfo {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    externalAccountId: row.code ?? row.id,
    bankName: asString(data.bankName, "Unknown Bank"),
    bankCode: asString(data.bankCode, "UNK"),
    accountName: row.name ?? asString(data.accountName, "Account"),
    accountNumber: asString(data.accountNumber, "0000"),
    iban: typeof data.iban === "string" ? data.iban : undefined,
    type: (asString(data.type, "checking") as BankAccountType),
    currency: row.currency ?? asString(data.currency, "KWD"),
    balanceCents: row.amountCents ?? asNumber(data.balanceCents, 0),
    availableBalanceCents:
      typeof data.availableBalanceCents === "number"
        ? data.availableBalanceCents
        : undefined,
    asOfDate: asString(data.asOfDate, new Date().toISOString()),
  };
}

function rowToTxn(row: typeof businessEntities.$inferSelect): BankTransaction {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    externalTxnId: row.code ?? row.id,
    accountId: row.parentId ?? "",
    date: asString(data.date, row.createdAt instanceof Date ? row.createdAt.toISOString() : ""),
    amountCents: row.amountCents ?? asNumber(data.amountCents, 0),
    currency: row.currency ?? asString(data.currency, "KWD"),
    type: (asString(data.type, "debit") as BankTransactionType),
    description: row.name ?? asString(data.description, ""),
    merchantName: typeof data.merchantName === "string" ? data.merchantName : undefined,
    category: typeof data.category === "string" ? data.category : undefined,
    reference: typeof data.reference === "string" ? data.reference : undefined,
    status: (asString(data.status, "posted") as BankTransactionStatus),
    matchedEntityId:
      typeof data.matchedEntityId === "string" ? data.matchedEntityId : undefined,
    matchedEntityType:
      typeof data.matchedEntityType === "string" ? data.matchedEntityType : undefined,
    reconciliationStatus: (asString(
      row.status,
      "unreconciled",
    ) as ReconciliationStatus),
  };
}

// ---------------------------------------------------------------------------
// Connector registry (lazy)
// ---------------------------------------------------------------------------

import { createCbkKuwaitConnector } from "./cbk-kuwait-connector.js";
import { createSamaSaudiConnector } from "./sama-saudi-connector.js";
import { createPlaidConnector } from "./plaid-connector.js";
import { createMockConnector } from "./mock-connector.js";

function createUaeObaConnector(): BankConnector {
  // The UAE Central Bank's Open Banking spec is still being rolled out.
  // Until a real adapter is required, this falls through to the mock
  // connector but advertises UAE country coverage.
  const inner = createMockConnector();
  return { ...inner, name: "uae_oba", supportedCountries: () => ["AE"] };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createBankingService(
  db: Db,
  reconciler?: ReconciliationEngineLike,
): BankingService {
  const cache = new Map<BankConnectorName, BankConnector>();

  function getConnector(name: BankConnectorName): BankConnector {
    let c = cache.get(name);
    if (c) return c;
    switch (name) {
      case "cbk_kuwait":
        c = createCbkKuwaitConnector();
        break;
      case "sama_saudi":
        c = createSamaSaudiConnector();
        break;
      case "uae_oba":
        c = createUaeObaConnector();
        break;
      case "plaid":
        c = createPlaidConnector();
        break;
      case "mock":
      default:
        c = createMockConnector();
        break;
    }
    cache.set(name, c);
    return c;
  }

  function listAvailableConnectors(): ConnectorDescriptor[] {
    const names: BankConnectorName[] = [
      "cbk_kuwait",
      "sama_saudi",
      "uae_oba",
      "plaid",
      "mock",
    ];
    return names.map((n) => {
      const c = getConnector(n);
      return {
        name: n,
        configured: c.isConfigured(),
        countries: c.supportedCountries(),
      };
    });
  }

  async function recordConsent(
    companyId: string,
    consent: BankConsent,
    accessToken?: string,
  ): Promise<{ entityId: string }> {
    const now = new Date();
    const encryptedToken = accessToken ? encryptToken(accessToken) : null;
    const data: Record<string, unknown> = {
      connectorName: consent.connectorName,
      scopes: consent.scopes,
      expiresAt: consent.expiresAt,
      accounts: consent.accounts,
      encryptedToken,
      // TODO: replace base64 with KMS-managed AES-GCM ciphertext.
      tokenEncryption: encryptedToken ? "base64" : null,
    };
    // No unique index covers (companyId, moduleKey, entityType, code) on
    // businessEntities, so we emulate an upsert with a SELECT + UPDATE/INSERT.
    const [existing] = await db
      .select({ id: businessEntities.id })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "banking"),
          eq(businessEntities.entityType, "consent"),
          eq(businessEntities.code, consent.externalConsentId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(businessEntities)
        .set({ status: consent.status, data, updatedAt: now })
        .where(eq(businessEntities.id, existing.id));
      return { entityId: existing.id };
    }

    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "banking",
        entityType: "consent",
        code: consent.externalConsentId,
        name: `${consent.connectorName} consent`,
        status: consent.status,
        data,
        tags: [consent.connectorName],
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { entityId: row?.id ?? "" };
  }

  async function getConsent(
    companyId: string,
    externalConsentId: string,
  ): Promise<{ consent: BankConsent; entityId: string; accessToken?: string } | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "banking"),
          eq(businessEntities.entityType, "consent"),
          eq(businessEntities.code, externalConsentId),
        ),
      )
      .limit(1);
    if (!row) return null;
    const data = (row.data ?? {}) as Record<string, unknown>;
    const encryptedToken =
      typeof data.encryptedToken === "string" ? data.encryptedToken : null;
    return {
      consent: rowToConsent(row),
      entityId: row.id,
      accessToken: encryptedToken ? decryptToken(encryptedToken) : undefined,
    };
  }

  async function recordAccount(
    companyId: string,
    account: BankAccountInfo,
    connectorName: BankConnectorName,
    consentExternalId: string,
  ): Promise<void> {
    const now = new Date();
    // Resolve consent row id (parent pointer); if it doesn't exist yet we
    // still record the account with a null parent — the recordConsent call
    // path normally runs first.
    const [consentRow] = await db
      .select({ id: businessEntities.id })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "banking"),
          eq(businessEntities.entityType, "consent"),
          eq(businessEntities.code, consentExternalId),
        ),
      )
      .limit(1);

    const data: Record<string, unknown> = {
      connectorName,
      consentExternalId,
      bankName: account.bankName,
      bankCode: account.bankCode,
      accountName: account.accountName,
      accountNumber: account.accountNumber,
      iban: account.iban ?? null,
      type: account.type,
      currency: account.currency,
      balanceCents: account.balanceCents,
      availableBalanceCents: account.availableBalanceCents ?? null,
      asOfDate: account.asOfDate,
    };

    const [existing] = await db
      .select({ id: businessEntities.id })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "banking"),
          eq(businessEntities.entityType, "account"),
          eq(businessEntities.code, account.externalAccountId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(businessEntities)
        .set({
          name: account.accountName,
          amountCents: account.balanceCents,
          currency: account.currency,
          parentId: consentRow?.id ?? null,
          data,
          updatedAt: now,
        })
        .where(eq(businessEntities.id, existing.id));
      return;
    }

    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "banking",
      entityType: "account",
      code: account.externalAccountId,
      name: account.accountName,
      status: "active",
      parentId: consentRow?.id ?? null,
      amountCents: account.balanceCents,
      currency: account.currency,
      data,
      tags: [connectorName, account.bankCode],
      createdAt: now,
      updatedAt: now,
    });
  }

  async function recordTransactions(
    companyId: string,
    txns: BankTransaction[],
  ): Promise<{ inserted: number; updated: number }> {
    if (txns.length === 0) return { inserted: 0, updated: 0 };
    const now = new Date();
    let inserted = 0;
    let updated = 0;

    // Resolve account row id by externalAccountId for parent linkage.
    const accountCache = new Map<string, string>();
    async function resolveAccountRowId(
      externalAcctId: string,
    ): Promise<string | null> {
      const cached = accountCache.get(externalAcctId);
      if (cached !== undefined) return cached;
      const [row] = await db
        .select({ id: businessEntities.id })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "banking"),
            eq(businessEntities.entityType, "account"),
            eq(businessEntities.code, externalAcctId),
          ),
        )
        .limit(1);
      const id = row?.id ?? null;
      if (id) accountCache.set(externalAcctId, id);
      return id;
    }

    for (const t of txns) {
      const parentId = await resolveAccountRowId(t.accountId);
      const data: Record<string, unknown> = {
        date: t.date,
        amountCents: t.amountCents,
        currency: t.currency,
        type: t.type,
        description: t.description,
        merchantName: t.merchantName ?? null,
        category: t.category ?? null,
        reference: t.reference ?? null,
        status: t.status,
        matchedEntityId: t.matchedEntityId ?? null,
        matchedEntityType: t.matchedEntityType ?? null,
      };

      // No DB unique on (companyId,moduleKey,entityType,code) — emulate an
      // idempotent upsert with a SELECT, so re-running sync never duplicates.
      const [existing] = await db
        .select({ id: businessEntities.id, status: businessEntities.status })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "banking"),
            eq(businessEntities.entityType, "transaction"),
            eq(businessEntities.code, t.externalTxnId),
          ),
        )
        .limit(1);

      if (existing) {
        // Preserve reconciliation state if a user already matched/ignored it.
        const keepStatus =
          existing.status && existing.status !== "unreconciled"
            ? existing.status
            : t.reconciliationStatus;
        await db
          .update(businessEntities)
          .set({
            amountCents: t.amountCents,
            data,
            status: keepStatus,
            updatedAt: now,
          })
          .where(eq(businessEntities.id, existing.id));
        updated += 1;
      } else {
        await db.insert(businessEntities).values({
          companyId,
          moduleKey: "banking",
          entityType: "transaction",
          code: t.externalTxnId,
          name: t.description,
          status: t.reconciliationStatus,
          parentId,
          amountCents: t.amountCents,
          currency: t.currency,
          data,
          tags: [t.type],
          createdAt: new Date(t.date),
          updatedAt: now,
        });
        inserted += 1;
      }
    }
    return { inserted, updated };
  }

  async function listAccounts(companyId: string): Promise<BankAccountInfo[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "banking"),
          eq(businessEntities.entityType, "account"),
        ),
      )
      .orderBy(desc(businessEntities.updatedAt));
    return rows.map(rowToAccount);
  }

  async function getAccount(
    companyId: string,
    accountId: string,
  ): Promise<
    | {
        account: BankAccountInfo;
        entityId: string;
        connectorName: BankConnectorName;
        consentExternalId: string;
      }
    | null
  > {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, accountId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "banking"),
          eq(businessEntities.entityType, "account"),
        ),
      )
      .limit(1);
    if (!row) return null;
    const data = (row.data ?? {}) as Record<string, unknown>;
    return {
      account: rowToAccount(row),
      entityId: row.id,
      connectorName: asString(data.connectorName, "mock") as BankConnectorName,
      consentExternalId: asString(data.consentExternalId, ""),
    };
  }

  async function listTransactions(
    companyId: string,
    opts?: ListTransactionsOptions,
  ): Promise<BankTransaction[]> {
    const limit = Math.min(opts?.limit ?? 500, 2000);
    const conditions = [
      eq(businessEntities.companyId, companyId),
      eq(businessEntities.moduleKey, "banking"),
      eq(businessEntities.entityType, "transaction"),
    ];
    if (opts?.accountId) {
      conditions.push(eq(businessEntities.parentId, opts.accountId));
    }
    if (opts?.reconciliationStatus) {
      conditions.push(eq(businessEntities.status, opts.reconciliationStatus));
    }
    if (opts?.from) {
      conditions.push(gte(businessEntities.createdAt, new Date(opts.from)));
    }
    if (opts?.to) {
      conditions.push(lte(businessEntities.createdAt, new Date(opts.to)));
    }
    const rows = await db
      .select()
      .from(businessEntities)
      .where(and(...conditions))
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit);
    return rows.map(rowToTxn);
  }

  async function getTransaction(
    companyId: string,
    txnId: string,
  ): Promise<{ txn: BankTransaction; entityId: string } | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, txnId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "banking"),
          eq(businessEntities.entityType, "transaction"),
        ),
      )
      .limit(1);
    if (!row) return null;
    return { txn: rowToTxn(row), entityId: row.id };
  }

  async function updateTransaction(
    companyId: string,
    txnId: string,
    patch: Partial<BankTransaction>,
  ): Promise<void> {
    const existing = await getTransaction(companyId, txnId);
    if (!existing) return;
    const merged: BankTransaction = { ...existing.txn, ...patch };
    const data: Record<string, unknown> = {
      date: merged.date,
      amountCents: merged.amountCents,
      currency: merged.currency,
      type: merged.type,
      description: merged.description,
      merchantName: merged.merchantName ?? null,
      category: merged.category ?? null,
      reference: merged.reference ?? null,
      status: merged.status,
      matchedEntityId: merged.matchedEntityId ?? null,
      matchedEntityType: merged.matchedEntityType ?? null,
    };
    await db
      .update(businessEntities)
      .set({
        status: merged.reconciliationStatus,
        amountCents: merged.amountCents,
        data,
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, existing.entityId));
  }

  async function syncAccount(
    companyId: string,
    accountId: string,
  ): Promise<{ newTxns: number }> {
    const acct = await getAccount(companyId, accountId);
    if (!acct) return { newTxns: 0 };
    const connector = getConnector(acct.connectorName);
    const txns = await connector.fetchTransactions(
      acct.consentExternalId,
      acct.account.externalAccountId,
      { limit: 200 },
    );
    // Re-parent transactions onto the internal account id used in recordTransactions.
    const normalized: BankTransaction[] = txns.map((t) => ({
      ...t,
      accountId: acct.account.externalAccountId,
    }));
    const { inserted } = await recordTransactions(companyId, normalized);
    // If a reconciliation engine is wired, opportunistically auto-reconcile.
    if (reconciler && inserted > 0) {
      try {
        await reconciler.autoReconcileAll(companyId);
      } catch {
        /* swallow — reconciliation is best-effort */
      }
    }
    return { newTxns: inserted };
  }

  return {
    getConnector,
    listAvailableConnectors,
    recordConsent,
    getConsent,
    recordAccount,
    recordTransactions,
    listAccounts,
    getAccount,
    listTransactions,
    getTransaction,
    updateTransaction,
    syncAccount,
  };
}

// ---------------------------------------------------------------------------
// Country defaults (Kuwait-first)
// ---------------------------------------------------------------------------

export function suggestConnectorsForCountry(country: string): BankConnectorName[] {
  switch (country.toUpperCase()) {
    case "KW":
      return ["cbk_kuwait", "mock"];
    case "SA":
      return ["sama_saudi", "mock"];
    case "AE":
      return ["uae_oba", "mock"];
    default:
      return ["plaid", "mock"];
  }
}
