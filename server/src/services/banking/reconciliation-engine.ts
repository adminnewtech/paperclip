// ---------------------------------------------------------------------------
// Bank-transaction reconciliation engine
// ---------------------------------------------------------------------------
//
// Given an imported bank transaction, scores candidate matches against open
// invoices, expenses, and payments and produces a ranked list. Hot paths
// (suggestMatches, autoReconcileAll) are CPU-bound so the algorithm is kept
// deliberately simple and predictable:
//
//   1. Amount match (exact)                  score += 0.50
//   2. Date proximity (within 3 days)        score += 0.30 (or 0.15 within 7 days)
//   3. Description fuzzy match               score += 0.15 (vendor/customer name)
//   4. Reference match (invoice # in desc)   score += 0.50  (very strong)
//
// Score >= 0.95 → auto-match
// Score >= 0.80 → present for confirmation
//
// All "apply" operations are idempotent: re-running autoReconcileAll on the
// same data never duplicates a match — they short-circuit if the txn is
// already linked.

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type { BankTransaction, ReconciliationEngineLike } from "./index.js";

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

export interface ReconciliationEngine extends ReconciliationEngineLike {
  suggestMatches(
    companyId: string,
    txn: BankTransaction,
    opts?: { limit?: number },
  ): Promise<MatchSuggestion[]>;
  applyMatch(
    companyId: string,
    txnId: string,
    entityId: string,
    entityType: string,
    autoMatched: boolean,
  ): Promise<void>;
  unmatch(companyId: string, txnId: string): Promise<void>;
  ignoreTxn(companyId: string, txnId: string, reason?: string): Promise<void>;
  autoReconcileAll(
    companyId: string,
    threshold?: number,
  ): Promise<{ matched: number; suggestions: number }>;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86400_000;

function dayDiff(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "to",
  "of",
  "inc",
  "llc",
  "ltd",
  "co",
  "company",
  "kw",
  "kuwait",
  "payment",
  "transfer",
  "ref",
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function tokenOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}

interface CandidateRow {
  id: string;
  moduleKey: string;
  entityType: string;
  amountCents: number | null;
  currency: string | null;
  name: string | null;
  code: string | null;
  status: string;
  createdAt: Date;
  parentId: string | null;
  data: Record<string, unknown> | null;
}

/** What name should we match this candidate's description against? */
function candidateMatchText(row: CandidateRow): string {
  const data = row.data ?? {};
  const customerName =
    typeof data.customerName === "string" ? data.customerName : "";
  const vendorName = typeof data.vendorName === "string" ? data.vendorName : "";
  const merchant = typeof data.merchant === "string" ? data.merchant : "";
  return [row.name ?? "", row.code ?? "", customerName, vendorName, merchant]
    .filter(Boolean)
    .join(" ");
}

function scoreMatch(
  txn: BankTransaction,
  row: CandidateRow,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const candidateAmount = Math.abs(row.amountCents ?? 0);
  const txnAmount = Math.abs(txn.amountCents);

  // 1. Amount match
  if (candidateAmount > 0 && candidateAmount === txnAmount) {
    score += 0.5;
    reasons.push("amount_exact");
  } else if (
    candidateAmount > 0 &&
    Math.abs(candidateAmount - txnAmount) / Math.max(candidateAmount, txnAmount) <
      0.01
  ) {
    score += 0.4;
    reasons.push("amount_close");
  }

  // 2. Date proximity
  const candidateDate = row.createdAt.toISOString();
  const diffDays = dayDiff(txn.date, candidateDate);
  if (diffDays <= 3) {
    score += 0.3;
    reasons.push("date_within_3_days");
  } else if (diffDays <= 7) {
    score += 0.15;
    reasons.push("date_within_7_days");
  }

  // 3. Description fuzzy match (vendor/customer name appears in txn desc)
  const candText = candidateMatchText(row);
  const desc = `${txn.description ?? ""} ${txn.merchantName ?? ""}`;
  const overlap = tokenOverlap(desc, candText);
  if (overlap >= 0.5) {
    score += 0.15;
    reasons.push("description_match");
  } else if (overlap > 0) {
    score += 0.05;
    reasons.push("description_partial");
  }

  // 4. Reference / code match — the invoice number appears in the txn
  //    description or reference field. This is the strongest single signal.
  const code = (row.code ?? "").trim();
  if (code) {
    const codeLower = code.toLowerCase();
    const refStr = `${txn.reference ?? ""} ${txn.description ?? ""}`.toLowerCase();
    if (refStr.includes(codeLower)) {
      score += 0.5;
      reasons.push("reference_match");
    }
  }

  // Clamp into [0, 1] — strong signals can compound (amount + reference) but
  // we don't want a runaway > 1 to confuse threshold logic.
  if (score > 1) score = 1;
  return { score, reasons };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createReconciliationEngine(db: Db): ReconciliationEngine {
  /** Pull candidate sales invoices + finance expenses + payments. */
  async function fetchCandidates(
    companyId: string,
    txn: BankTransaction,
  ): Promise<{ rows: CandidateRow[]; types: Map<string, "invoice" | "expense" | "payment"> }> {
    const fromDate = new Date(new Date(txn.date).getTime() - 30 * DAY_MS);
    const toDate = new Date(new Date(txn.date).getTime() + 5 * DAY_MS);

    // For credits (incoming money) we look at unpaid invoices.
    // For debits (outgoing money) we look at expenses + payments.
    const isCredit = txn.amountCents > 0;

    const conditions = [
      eq(businessEntities.companyId, companyId),
      gte(businessEntities.createdAt, fromDate),
      lte(businessEntities.createdAt, toDate),
    ];

    if (isCredit) {
      conditions.push(eq(businessEntities.moduleKey, "sales"));
      conditions.push(
        inArray(businessEntities.entityType, ["invoice", "payment"]),
      );
      // Don't suggest fully-paid invoices.
      conditions.push(
        inArray(businessEntities.status, [
          "draft",
          "sent",
          "overdue",
          "partial",
          "pending",
          "active",
        ]),
      );
    } else {
      // For debits — match against expenses (finance) and outbound payments
      // recorded under the "payments" module.
      // We can't combine OR conditions trivially with the helpers above
      // without weaving in `or`, so we run two queries and merge.
    }

    let rows: CandidateRow[] = [];
    if (isCredit) {
      rows = (await db
        .select({
          id: businessEntities.id,
          moduleKey: businessEntities.moduleKey,
          entityType: businessEntities.entityType,
          amountCents: businessEntities.amountCents,
          currency: businessEntities.currency,
          name: businessEntities.name,
          code: businessEntities.code,
          status: businessEntities.status,
          createdAt: businessEntities.createdAt,
          parentId: businessEntities.parentId,
          data: businessEntities.data,
        })
        .from(businessEntities)
        .where(and(...conditions))
        .limit(200)) as unknown as CandidateRow[];
    } else {
      const baseConds = [
        eq(businessEntities.companyId, companyId),
        gte(businessEntities.createdAt, fromDate),
        lte(businessEntities.createdAt, toDate),
      ];
      const expenses = await db
        .select({
          id: businessEntities.id,
          moduleKey: businessEntities.moduleKey,
          entityType: businessEntities.entityType,
          amountCents: businessEntities.amountCents,
          currency: businessEntities.currency,
          name: businessEntities.name,
          code: businessEntities.code,
          status: businessEntities.status,
          createdAt: businessEntities.createdAt,
          parentId: businessEntities.parentId,
          data: businessEntities.data,
        })
        .from(businessEntities)
        .where(
          and(
            ...baseConds,
            eq(businessEntities.moduleKey, "finance"),
            eq(businessEntities.entityType, "expense"),
          ),
        )
        .limit(150);
      const payments = await db
        .select({
          id: businessEntities.id,
          moduleKey: businessEntities.moduleKey,
          entityType: businessEntities.entityType,
          amountCents: businessEntities.amountCents,
          currency: businessEntities.currency,
          name: businessEntities.name,
          code: businessEntities.code,
          status: businessEntities.status,
          createdAt: businessEntities.createdAt,
          parentId: businessEntities.parentId,
          data: businessEntities.data,
        })
        .from(businessEntities)
        .where(
          and(
            ...baseConds,
            eq(businessEntities.moduleKey, "payments"),
            eq(businessEntities.entityType, "charge"),
          ),
        )
        .limit(100);
      rows = [...expenses, ...payments] as unknown as CandidateRow[];
    }

    const types = new Map<string, "invoice" | "expense" | "payment">();
    for (const r of rows) {
      if (r.entityType === "invoice") types.set(r.id, "invoice");
      else if (r.entityType === "expense") types.set(r.id, "expense");
      else types.set(r.id, "payment");
    }
    return { rows, types };
  }

  async function suggestMatches(
    companyId: string,
    txn: BankTransaction,
    opts?: { limit?: number },
  ): Promise<MatchSuggestion[]> {
    const { rows, types } = await fetchCandidates(companyId, txn);
    const limit = opts?.limit ?? 5;
    const scored: MatchSuggestion[] = rows
      .filter((r) => {
        // Only same-currency candidates score.
        if (!r.currency || !txn.currency) return true;
        return r.currency.toUpperCase() === txn.currency.toUpperCase();
      })
      .map((r) => {
        const { score, reasons } = scoreMatch(txn, r);
        const type = types.get(r.id) ?? "invoice";
        return {
          txnId: txn.id,
          candidateEntityId: r.id,
          candidateEntityType: type,
          candidateAmount: r.amountCents ?? 0,
          candidateDate: r.createdAt.toISOString(),
          candidateDescription: r.name ?? r.code ?? "",
          matchScore: Number(score.toFixed(3)),
          matchReasons: reasons,
        };
      })
      .filter((s) => s.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);
    return scored;
  }

  async function applyMatch(
    companyId: string,
    txnId: string,
    entityId: string,
    entityType: string,
    autoMatched: boolean,
  ): Promise<void> {
    const now = new Date();
    // Fetch the bank txn row.
    const [txnRow] = await db
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
    if (!txnRow) return;

    // Idempotent: if already matched to the same entity, no-op.
    const existingData = (txnRow.data ?? {}) as Record<string, unknown>;
    if (
      existingData.matchedEntityId === entityId &&
      (txnRow.status === "auto_matched" || txnRow.status === "manual_matched")
    ) {
      return;
    }

    const newStatus = autoMatched ? "auto_matched" : "manual_matched";
    await db
      .update(businessEntities)
      .set({
        status: newStatus,
        data: {
          ...existingData,
          matchedEntityId: entityId,
          matchedEntityType: entityType,
          matchedAt: now.toISOString(),
          matchedBy: autoMatched ? "auto" : "manual",
        },
        updatedAt: now,
      })
      .where(eq(businessEntities.id, txnId));

    // Stamp the matched entity with paymentTxnId for traceability + mark paid.
    const [entityRow] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, entityId),
          eq(businessEntities.companyId, companyId),
        ),
      )
      .limit(1);
    if (entityRow) {
      const data = (entityRow.data ?? {}) as Record<string, unknown>;
      const txnAmount = Math.abs(txnRow.amountCents ?? 0);
      const entityAmount = Math.abs(entityRow.amountCents ?? 0);
      const fullyPaid = entityAmount > 0 && txnAmount >= entityAmount;
      const nextStatus =
        entityRow.moduleKey === "sales" && entityRow.entityType === "invoice"
          ? fullyPaid
            ? "paid"
            : "partial"
          : entityRow.status;
      await db
        .update(businessEntities)
        .set({
          status: nextStatus,
          data: {
            ...data,
            paymentTxnId: txnId,
            paymentTxnExternalId: txnRow.code,
            paidAt: fullyPaid ? now.toISOString() : data.paidAt ?? null,
          },
          updatedAt: now,
        })
        .where(eq(businessEntities.id, entityId));
    }
  }

  async function unmatch(companyId: string, txnId: string): Promise<void> {
    const [txnRow] = await db
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
    if (!txnRow) return;
    const data = (txnRow.data ?? {}) as Record<string, unknown>;
    const matchedEntityId =
      typeof data.matchedEntityId === "string" ? data.matchedEntityId : null;
    const now = new Date();
    await db
      .update(businessEntities)
      .set({
        status: "unreconciled",
        data: {
          ...data,
          matchedEntityId: null,
          matchedEntityType: null,
          matchedAt: null,
        },
        updatedAt: now,
      })
      .where(eq(businessEntities.id, txnId));
    if (matchedEntityId) {
      const [entityRow] = await db
        .select()
        .from(businessEntities)
        .where(eq(businessEntities.id, matchedEntityId))
        .limit(1);
      if (entityRow) {
        const ed = (entityRow.data ?? {}) as Record<string, unknown>;
        await db
          .update(businessEntities)
          .set({
            data: {
              ...ed,
              paymentTxnId: null,
              paymentTxnExternalId: null,
            },
            updatedAt: now,
          })
          .where(eq(businessEntities.id, matchedEntityId));
      }
    }
  }

  async function ignoreTxn(
    companyId: string,
    txnId: string,
    reason?: string,
  ): Promise<void> {
    const [txnRow] = await db
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
    if (!txnRow) return;
    const data = (txnRow.data ?? {}) as Record<string, unknown>;
    await db
      .update(businessEntities)
      .set({
        status: "ignored",
        data: { ...data, ignoreReason: reason ?? null, ignoredAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, txnId));
  }

  async function autoReconcileAll(
    companyId: string,
    threshold = 0.95,
  ): Promise<{ matched: number; suggestions: number }> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "banking"),
          eq(businessEntities.entityType, "transaction"),
          eq(businessEntities.status, "unreconciled"),
        ),
      )
      .limit(500);

    let matched = 0;
    let suggestions = 0;
    for (const row of rows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      // Skip transactions that already got matched between the SELECT and now.
      if (data.matchedEntityId) continue;
      const txn: BankTransaction = {
        id: row.id,
        externalTxnId: row.code ?? row.id,
        accountId: row.parentId ?? "",
        date: typeof data.date === "string" ? data.date : row.createdAt.toISOString(),
        amountCents: row.amountCents ?? 0,
        currency: row.currency ?? "KWD",
        type: ((data.type as string) ?? "debit") as BankTransaction["type"],
        description: row.name ?? "",
        merchantName: typeof data.merchantName === "string" ? data.merchantName : undefined,
        reference: typeof data.reference === "string" ? data.reference : undefined,
        status: ((data.status as string) ?? "posted") as BankTransaction["status"],
        reconciliationStatus: "unreconciled",
      };
      const top = await suggestMatches(companyId, txn, { limit: 1 });
      const best = top[0];
      if (!best) continue;
      if (best.matchScore >= threshold) {
        await applyMatch(
          companyId,
          row.id,
          best.candidateEntityId,
          best.candidateEntityType,
          true,
        );
        matched += 1;
      } else if (best.matchScore >= 0.8) {
        suggestions += 1;
      }
    }
    return { matched, suggestions };
  }

  return {
    suggestMatches,
    applyMatch,
    unmatch,
    ignoreTxn,
    autoReconcileAll,
  };
}
