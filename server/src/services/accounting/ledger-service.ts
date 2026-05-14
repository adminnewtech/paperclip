/**
 * General Ledger service.
 *
 * Aggregates posted journal entries into per-account running balances,
 * trial balance reports, and period-closing entries.
 *
 * The general ledger is *derived* state — we recompute it from the underlying
 * journal entries on demand. The `amountCents` cached on the account row is
 * a hint only and is not load-bearing.
 */

import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  isDebitNormal,
  type AccountType,
  type JournalEntry,
  type JournalLine,
  type TrialBalanceRow,
} from "@paperclipai/shared";
import {
  createChartOfAccountsService,
  type ChartOfAccountsService,
} from "./chart-of-accounts.js";
import { createJournalService, type JournalService } from "./journal-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LedgerEntry {
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

export interface ClosePeriodResult {
  closingEntries: JournalEntry[];
  netIncomeCents: number;
}

export interface LedgerService {
  getAccountBalance(
    companyId: string,
    accountCode: string,
    asOf?: string,
  ): Promise<number>;
  getAccountLedger(
    companyId: string,
    accountCode: string,
    opts?: { from?: string; to?: string },
  ): Promise<LedgerEntry[]>;
  getTrialBalance(companyId: string, asOf: string): Promise<TrialBalanceRow[]>;
  /**
   * Generate closing entries that zero out all revenue/expense (P&L) accounts
   * and roll the net income into retained earnings. Closing entries are
   * created and immediately posted.
   */
  closeAccountingPeriod(
    companyId: string,
    periodEnd: string,
    actorId?: string,
  ): Promise<ClosePeriodResult>;
  /**
   * Fetch every posted journal line in [from, to] flattened to (date, code,
   * debit, credit) tuples. Used by the financial statements builder.
   */
  getPostedLines(
    companyId: string,
    opts?: { from?: string; to?: string },
  ): Promise<
    Array<{
      entryId: string;
      entryNumber: string;
      date: string;
      accountCode: string;
      debitCents: number;
      creditCents: number;
      description?: string;
      referenceType?: string;
      referenceId?: string;
    }>
  >;
}

export function createLedgerService(
  db: Db,
  opts?: { coa?: ChartOfAccountsService; journal?: JournalService },
): LedgerService {
  const coa = opts?.coa ?? createChartOfAccountsService(db);
  const journal = opts?.journal ?? createJournalService(db);

  async function listPostedEntries(
    companyId: string,
    range?: { from?: string; to?: string },
  ): Promise<JournalEntry[]> {
    return journal.listEntries(companyId, {
      status: "posted",
      from: range?.from,
      to: range?.to,
      limit: 50_000,
    });
  }

  const service: LedgerService = {
    async getAccountBalance(companyId, accountCode, asOf) {
      const entries = await listPostedEntries(companyId, { to: asOf });
      const account = await coa.getAccount(companyId, accountCode);
      const type: AccountType = account?.type ?? "asset";
      let net = 0;
      for (const e of entries) {
        for (const l of e.lines) {
          if (l.accountCode !== accountCode) continue;
          net += l.debitCents - l.creditCents;
        }
      }
      // Return *signed* balance on the natural side.
      return isDebitNormal(type) ? net : -net;
    },

    async getAccountLedger(companyId, accountCode, opts) {
      const account = await coa.getAccount(companyId, accountCode);
      const type: AccountType = account?.type ?? "asset";
      const entries = await listPostedEntries(companyId, opts);
      // Sort entries ascending by date for running balance accumulation.
      const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
      const out: LedgerEntry[] = [];
      let running = 0;
      for (const e of sorted) {
        for (const l of e.lines) {
          if (l.accountCode !== accountCode) continue;
          const delta = l.debitCents - l.creditCents;
          running += delta;
          out.push({
            entryId: e.id,
            entryNumber: e.entryNumber,
            date: e.date,
            description: l.description ?? e.description,
            debitCents: l.debitCents,
            creditCents: l.creditCents,
            runningBalanceCents: isDebitNormal(type) ? running : -running,
            referenceType: e.referenceType,
            referenceId: e.referenceId,
          });
        }
      }
      return out;
    },

    async getTrialBalance(companyId, asOf) {
      const accounts = await coa.listAccounts(companyId);
      const entries = await listPostedEntries(companyId, { to: asOf });
      const sums = new Map<string, { debit: number; credit: number }>();
      for (const e of entries) {
        for (const l of e.lines) {
          const s = sums.get(l.accountCode) ?? { debit: 0, credit: 0 };
          s.debit += l.debitCents;
          s.credit += l.creditCents;
          sums.set(l.accountCode, s);
        }
      }
      return accounts.map((a) => {
        const s = sums.get(a.code) ?? { debit: 0, credit: 0 };
        const net = s.debit - s.credit;
        return {
          accountCode: a.code,
          accountName: a.name,
          accountType: a.type,
          debitCents: s.debit,
          creditCents: s.credit,
          balanceCents: isDebitNormal(a.type) ? net : -net,
        } satisfies TrialBalanceRow;
      });
    },

    async closeAccountingPeriod(companyId, periodEnd, actorId) {
      const accounts = await coa.listAccounts(companyId);
      const tb = await this.getTrialBalance(companyId, periodEnd);
      const tbMap = new Map(tb.map((r) => [r.accountCode, r]));

      // Identify the retained-earnings account (subtype-based).
      const retainedEarnings =
        accounts.find((a) => a.subtype === "retained_earnings") ??
        accounts.find((a) => a.code === "3200");
      if (!retainedEarnings) {
        throw new Error(
          "Cannot close period: no retained earnings account (subtype 'retained_earnings' or code 3200) found.",
        );
      }

      const closingLines: JournalLine[] = [];
      let netIncomeCents = 0;

      for (const a of accounts) {
        if (a.type !== "revenue" && a.type !== "expense") continue;
        const row = tbMap.get(a.code);
        if (!row) continue;
        const net = row.debitCents - row.creditCents;
        if (net === 0) continue;
        // Closing a revenue account (credit-normal): debit by its balance.
        // Closing an expense account (debit-normal): credit by its balance.
        if (a.type === "revenue") {
          // Natural balance lives on credit side. To zero it, debit the
          // remaining credit balance.
          const close = -net; // amount we need to debit (positive if revenue had credit balance)
          if (close > 0) {
            closingLines.push({
              accountCode: a.code,
              debitCents: close,
              creditCents: 0,
              description: `Close ${a.name} to retained earnings`,
            });
            netIncomeCents += close;
          } else if (close < 0) {
            closingLines.push({
              accountCode: a.code,
              debitCents: 0,
              creditCents: -close,
              description: `Close ${a.name} to retained earnings`,
            });
            netIncomeCents += close;
          }
        } else {
          // expense — credit by its debit balance
          const close = net;
          if (close > 0) {
            closingLines.push({
              accountCode: a.code,
              debitCents: 0,
              creditCents: close,
              description: `Close ${a.name} to retained earnings`,
            });
            netIncomeCents -= close;
          } else if (close < 0) {
            closingLines.push({
              accountCode: a.code,
              debitCents: -close,
              creditCents: 0,
              description: `Close ${a.name} to retained earnings`,
            });
            netIncomeCents -= close;
          }
        }
      }

      if (closingLines.length === 0) {
        return { closingEntries: [], netIncomeCents: 0 };
      }

      // Balancing line: net income → retained earnings.
      if (netIncomeCents > 0) {
        closingLines.push({
          accountCode: retainedEarnings.code,
          debitCents: 0,
          creditCents: netIncomeCents,
          description: "Net income to retained earnings",
        });
      } else if (netIncomeCents < 0) {
        closingLines.push({
          accountCode: retainedEarnings.code,
          debitCents: -netIncomeCents,
          creditCents: 0,
          description: "Net loss to retained earnings",
        });
      }

      const entry = await journal.createAndPost(
        companyId,
        {
          date: periodEnd,
          description: `Period close — ${periodEnd}`,
          referenceType: "closing",
          lines: closingLines,
          createdBy: actorId,
        },
        actorId,
      );
      return { closingEntries: [entry], netIncomeCents };
    },

    async getPostedLines(companyId, opts) {
      const entries = await listPostedEntries(companyId, opts);
      const out: Array<{
        entryId: string;
        entryNumber: string;
        date: string;
        accountCode: string;
        debitCents: number;
        creditCents: number;
        description?: string;
        referenceType?: string;
        referenceId?: string;
      }> = [];
      for (const e of entries) {
        for (const l of e.lines) {
          out.push({
            entryId: e.id,
            entryNumber: e.entryNumber,
            date: e.date,
            accountCode: l.accountCode,
            debitCents: l.debitCents,
            creditCents: l.creditCents,
            description: l.description ?? e.description,
            referenceType: e.referenceType,
            referenceId: e.referenceId,
          });
        }
      }
      return out;
    },
  };

  // Touch unused symbols imported for SQL building.
  void and;
  void asc;
  void eq;
  void gte;
  void lte;
  void sql;
  void businessEntities;
  return service;
}
