/**
 * Financial Statements service.
 *
 * Builds GAAP-style reports from the General Ledger:
 *   - Income Statement (P&L)
 *   - Balance Sheet
 *   - Cash Flow Statement (indirect method)
 *
 * All reports handle empty companies gracefully (no journal entries → all
 * zeros). They never throw on missing accounts — instead they surface
 * empty sections in the response.
 */

import type { Db } from "@paperclipai/db";
import {
  isDebitNormal,
  type BalanceSheet,
  type CashFlowStatement,
  type ChartOfAccount,
  type IncomeStatement,
  type StatementLine,
} from "@paperclipai/shared";
import {
  createChartOfAccountsService,
  type ChartOfAccountsService,
} from "./chart-of-accounts.js";
import { createLedgerService, type LedgerService } from "./ledger-service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AccountAggregates {
  byCode: Map<string, number>; // signed balance per account
  byCodeDebit: Map<string, number>;
  byCodeCredit: Map<string, number>;
}

async function buildAggregates(
  ledger: LedgerService,
  companyId: string,
  range: { from?: string; to?: string },
): Promise<AccountAggregates> {
  const lines = await ledger.getPostedLines(companyId, range);
  const byCode = new Map<string, number>();
  const byCodeDebit = new Map<string, number>();
  const byCodeCredit = new Map<string, number>();
  for (const l of lines) {
    byCode.set(l.accountCode, (byCode.get(l.accountCode) ?? 0) + l.debitCents - l.creditCents);
    byCodeDebit.set(l.accountCode, (byCodeDebit.get(l.accountCode) ?? 0) + l.debitCents);
    byCodeCredit.set(l.accountCode, (byCodeCredit.get(l.accountCode) ?? 0) + l.creditCents);
  }
  return { byCode, byCodeDebit, byCodeCredit };
}

function signedBalance(
  account: ChartOfAccount,
  netDebitMinusCredit: number,
): number {
  return isDebitNormal(account.type) ? netDebitMinusCredit : -netDebitMinusCredit;
}

function isLeafAccount(account: ChartOfAccount, all: ChartOfAccount[]): boolean {
  // Leaf accounts are accounts with no children. We post into them.
  return !all.some((a) => a.parentCode === account.code);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface FinancialStatementsService {
  incomeStatement(
    companyId: string,
    from: string,
    to: string,
  ): Promise<IncomeStatement>;
  balanceSheet(companyId: string, asOf: string): Promise<BalanceSheet>;
  cashFlowStatement(
    companyId: string,
    from: string,
    to: string,
  ): Promise<CashFlowStatement>;
  comparativeIncomeStatement(
    companyId: string,
    period1: [string, string],
    period2: [string, string],
  ): Promise<{
    p1: IncomeStatement;
    p2: IncomeStatement;
    variance: Record<string, number>;
  }>;
}

export function createFinancialStatementsService(
  db: Db,
  opts?: { coa?: ChartOfAccountsService; ledger?: LedgerService },
): FinancialStatementsService {
  const coa = opts?.coa ?? createChartOfAccountsService(db);
  const ledger = opts?.ledger ?? createLedgerService(db);

  const service: FinancialStatementsService = {
    async incomeStatement(companyId, from, to) {
      const accounts = await coa.listAccounts(companyId);
      const agg = await buildAggregates(ledger, companyId, { from, to });

      const revenue: StatementLine[] = [];
      const cogs: StatementLine[] = [];
      const expenses: StatementLine[] = [];
      const otherIncome: StatementLine[] = [];
      const otherExpenses: StatementLine[] = [];

      for (const a of accounts) {
        if (!isLeafAccount(a, accounts)) continue;
        const net = agg.byCode.get(a.code) ?? 0;
        const signed = signedBalance(a, net);
        if (signed === 0) continue;
        const line: StatementLine = {
          accountCode: a.code,
          name: a.name,
          amountCents: signed,
        };
        if (a.type === "revenue") {
          if (a.subtype === "other_revenue") {
            otherIncome.push(line);
          } else {
            revenue.push(line);
          }
        } else if (a.type === "expense") {
          if (a.subtype === "cogs") {
            cogs.push(line);
          } else if (a.subtype === "other_expense" || a.subtype === "tax_expense") {
            otherExpenses.push(line);
          } else {
            expenses.push(line);
          }
        }
      }

      const totalRevenueCents = revenue.reduce((s, l) => s + l.amountCents, 0);
      const totalCogsCents = cogs.reduce((s, l) => s + l.amountCents, 0);
      const grossProfitCents = totalRevenueCents - totalCogsCents;
      const totalExpensesCents = expenses.reduce((s, l) => s + l.amountCents, 0);
      const operatingIncomeCents = grossProfitCents - totalExpensesCents;
      const totalOtherIncomeCents = otherIncome.reduce((s, l) => s + l.amountCents, 0);
      const totalOtherExpensesCents = otherExpenses.reduce((s, l) => s + l.amountCents, 0);
      const netIncomeCents =
        operatingIncomeCents + totalOtherIncomeCents - totalOtherExpensesCents;

      return {
        periodFrom: from,
        periodTo: to,
        revenue,
        totalRevenueCents,
        cogs,
        totalCogsCents,
        grossProfitCents,
        expenses,
        totalExpensesCents,
        operatingIncomeCents,
        otherIncome,
        otherExpenses,
        netIncomeCents,
      };
    },

    async balanceSheet(companyId, asOf) {
      const accounts = await coa.listAccounts(companyId);
      const agg = await buildAggregates(ledger, companyId, { to: asOf });

      const currentAssets: StatementLine[] = [];
      const fixedAssets: StatementLine[] = [];
      const otherAssets: StatementLine[] = [];
      const currentLiabilities: StatementLine[] = [];
      const longTermLiabilities: StatementLine[] = [];
      const equityItems: StatementLine[] = [];

      // Compute retained earnings to-date including any unclosed net income.
      let runningNetIncome = 0;
      for (const a of accounts) {
        if (!isLeafAccount(a, accounts)) continue;
        const net = agg.byCode.get(a.code) ?? 0;
        const signed = signedBalance(a, net);
        if (a.type === "revenue") runningNetIncome += signed;
        if (a.type === "expense") runningNetIncome -= signed;
      }

      for (const a of accounts) {
        if (!isLeafAccount(a, accounts)) continue;
        const net = agg.byCode.get(a.code) ?? 0;
        const signed = signedBalance(a, net);
        if (signed === 0 && a.type !== "equity") continue;
        const line: StatementLine = {
          accountCode: a.code,
          name: a.name,
          amountCents: signed,
        };
        if (a.type === "asset") {
          if (a.subtype === "fixed_asset") {
            fixedAssets.push(line);
          } else if (
            a.subtype === "cash" ||
            a.subtype === "bank" ||
            a.subtype === "accounts_receivable" ||
            a.subtype === "inventory" ||
            a.subtype === "other_current_asset"
          ) {
            currentAssets.push(line);
          } else {
            otherAssets.push(line);
          }
        } else if (a.type === "liability") {
          if (
            a.subtype === "long_term_liability" ||
            a.subtype === "loan"
          ) {
            longTermLiabilities.push(line);
          } else {
            currentLiabilities.push(line);
          }
        } else if (a.type === "equity") {
          if (a.subtype === "retained_earnings") {
            // Roll un-closed net income into retained earnings on the BS.
            equityItems.push({
              ...line,
              amountCents: line.amountCents + runningNetIncome,
            });
          } else {
            equityItems.push(line);
          }
        }
      }

      // If no retained-earnings account exists, surface the net income as
      // "Current Period Earnings" so the balance-sheet equation still holds.
      if (!equityItems.some((e) => /retained/i.test(e.name))) {
        if (runningNetIncome !== 0) {
          equityItems.push({
            accountCode: "—",
            name: "Current Period Earnings",
            amountCents: runningNetIncome,
          });
        }
      }

      const totalCurrentAssetsCents = currentAssets.reduce(
        (s, l) => s + l.amountCents,
        0,
      );
      const totalFixedAssetsCents = fixedAssets.reduce((s, l) => s + l.amountCents, 0);
      const totalOtherAssetsCents = otherAssets.reduce((s, l) => s + l.amountCents, 0);
      const totalAssetsCents =
        totalCurrentAssetsCents + totalFixedAssetsCents + totalOtherAssetsCents;

      const totalCurrentLiabilitiesCents = currentLiabilities.reduce(
        (s, l) => s + l.amountCents,
        0,
      );
      const totalLongTermLiabilitiesCents = longTermLiabilities.reduce(
        (s, l) => s + l.amountCents,
        0,
      );
      const totalLiabilitiesCents =
        totalCurrentLiabilitiesCents + totalLongTermLiabilitiesCents;
      const totalEquityCents = equityItems.reduce((s, l) => s + l.amountCents, 0);
      const totalLiabilitiesAndEquityCents = totalLiabilitiesCents + totalEquityCents;

      return {
        asOfDate: asOf,
        assets: {
          currentAssets,
          totalCurrentAssetsCents,
          fixedAssets,
          totalFixedAssetsCents,
          otherAssets,
          totalAssetsCents,
        },
        liabilities: {
          currentLiabilities,
          totalCurrentLiabilitiesCents,
          longTermLiabilities,
          totalLiabilitiesCents,
        },
        equity: {
          items: equityItems,
          totalEquityCents,
        },
        totalLiabilitiesAndEquityCents,
      };
    },

    async cashFlowStatement(companyId, from, to) {
      // Indirect method:
      //   Net income (operating)
      //   + non-cash expenses (depreciation)
      //   ± change in current assets / current liabilities (excluding cash)
      //   ± investing flows (fixed-asset purchases / sales)
      //   ± financing flows (loan proceeds / equity contributions / drawings)

      const accounts = await coa.listAccounts(companyId);
      const periodAgg = await buildAggregates(ledger, companyId, { from, to });
      const openingAgg = await buildAggregates(ledger, companyId, {
        to: previousDate(from),
      });
      const closingAgg = await buildAggregates(ledger, companyId, { to });

      const operating: { description: string; amountCents: number }[] = [];
      const investing: { description: string; amountCents: number }[] = [];
      const financing: { description: string; amountCents: number }[] = [];

      // Determine cash accounts (subtype cash or bank).
      const cashAccounts = accounts.filter(
        (a) => a.subtype === "cash" || a.subtype === "bank",
      );
      const cashCodes = new Set(cashAccounts.map((a) => a.code));

      function cashBalanceAt(agg: AccountAggregates): number {
        let total = 0;
        for (const code of cashCodes) {
          total += agg.byCode.get(code) ?? 0; // debit-normal: positive = cash
        }
        return total;
      }
      const beginningCashCents = cashBalanceAt(openingAgg);
      const endingCashCents = cashBalanceAt(closingAgg);

      // Net income from P&L during period.
      let netIncomeCents = 0;
      let depreciationCents = 0;
      for (const a of accounts) {
        if (!isLeafAccount(a, accounts)) continue;
        const net = periodAgg.byCode.get(a.code) ?? 0;
        const signed = signedBalance(a, net);
        if (a.type === "revenue") netIncomeCents += signed;
        if (a.type === "expense") netIncomeCents -= signed;
        if (a.type === "expense" && /depreciation/i.test(a.name)) {
          depreciationCents += signed;
        }
      }
      operating.push({ description: "Net Income", amountCents: netIncomeCents });
      if (depreciationCents !== 0) {
        operating.push({
          description: "Depreciation & Amortization (non-cash)",
          amountCents: depreciationCents,
        });
      }

      // Working capital changes (excluding cash).
      for (const a of accounts) {
        if (!isLeafAccount(a, accounts)) continue;
        if (cashCodes.has(a.code)) continue;
        const open = openingAgg.byCode.get(a.code) ?? 0;
        const close = closingAgg.byCode.get(a.code) ?? 0;
        const delta = close - open;
        if (delta === 0) continue;
        if (a.type === "asset" && a.subtype === "fixed_asset") {
          // Fixed asset movements are investing activities (e.g. purchase
          // of equipment uses cash, sale provides cash).
          investing.push({
            description: `${a.name} (investing)`,
            amountCents: -delta,
          });
        } else if (a.type === "asset") {
          // Increase in non-cash current assets uses cash → negative.
          operating.push({
            description: `Δ ${a.name}`,
            amountCents: -delta,
          });
        } else if (a.type === "liability" && a.subtype === "loan") {
          // Loan proceeds / repayments are financing activities.
          financing.push({
            description: `${a.name} (financing)`,
            amountCents: -delta,
          });
        } else if (a.type === "liability") {
          // Increase in liability is a credit → flips sign. delta is
          // debit-credit. For liabilities (credit-normal), increase =
          // negative delta.
          operating.push({
            description: `Δ ${a.name}`,
            amountCents: -delta,
          });
        } else if (a.type === "equity") {
          if (a.subtype === "drawing" || a.subtype === "common_stock") {
            financing.push({
              description: `${a.name} (financing)`,
              amountCents: -delta,
            });
          }
        }
      }

      const netOperatingCents = operating.reduce((s, l) => s + l.amountCents, 0);
      const netInvestingCents = investing.reduce((s, l) => s + l.amountCents, 0);
      const netFinancingCents = financing.reduce((s, l) => s + l.amountCents, 0);
      const netChangeInCashCents =
        netOperatingCents + netInvestingCents + netFinancingCents;

      return {
        periodFrom: from,
        periodTo: to,
        operating,
        netOperatingCents,
        investing,
        netInvestingCents,
        financing,
        netFinancingCents,
        netChangeInCashCents,
        beginningCashCents,
        endingCashCents,
      };
    },

    async comparativeIncomeStatement(companyId, period1, period2) {
      const [p1, p2] = await Promise.all([
        service.incomeStatement(companyId, period1[0], period1[1]),
        service.incomeStatement(companyId, period2[0], period2[1]),
      ]);
      const variance: Record<string, number> = {
        totalRevenueCents: p2.totalRevenueCents - p1.totalRevenueCents,
        totalCogsCents: p2.totalCogsCents - p1.totalCogsCents,
        grossProfitCents: p2.grossProfitCents - p1.grossProfitCents,
        totalExpensesCents: p2.totalExpensesCents - p1.totalExpensesCents,
        operatingIncomeCents: p2.operatingIncomeCents - p1.operatingIncomeCents,
        netIncomeCents: p2.netIncomeCents - p1.netIncomeCents,
      };
      return { p1, p2, variance };
    },
  };
  return service;
}

function previousDate(iso: string): string {
  try {
    const d = new Date(iso);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
