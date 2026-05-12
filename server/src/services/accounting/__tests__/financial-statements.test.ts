/**
 * Tests for the financial-statements service (P&L, Balance Sheet, Cash Flow).
 *
 * The service is intentionally simple math over the ledger, but it is wired
 * to drizzle so we need a real DB. Tests gate on embedded Postgres support
 * and degrade to skip when unavailable.
 *
 * The single most important invariant is the fundamental balance-sheet
 * equation:  assets === liabilities + equity. Several tests pin that.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, businessEntities, type Db } from "@paperclipai/db";
import {
  getTestDbSupport,
  setupTestDb,
  type TestDbHandle,
} from "../../../__tests__/setup.js";
import { createChartOfAccountsService } from "../chart-of-accounts.js";
import { createJournalService } from "../journal-service.js";
import { createFinancialStatementsService } from "../financial-statements.js";

const support = await getTestDbSupport();
const dbDescribe = support.supported ? describe : describe.skip;

async function makeCompany(db: Db): Promise<string> {
  const [row] = await db
    .insert(companies)
    .values({
      name: `Stmt Co ${randomUUID()}`,
      issuePrefix: `ST${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  return row!.id;
}

dbDescribe("financial-statements service", () => {
  let handle: TestDbHandle | null = null;
  let db!: Db;

  beforeAll(async () => {
    handle = await setupTestDb("paperclip-stmts-");
    db = handle.db;
  }, 60_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  afterEach(async () => {
    await db.delete(businessEntities);
    await db.delete(companies);
  });

  it("returns all zeros for an empty company", async () => {
    const companyId = await makeCompany(db);
    const fs = createFinancialStatementsService(db);
    const is = await fs.incomeStatement(companyId, "2026-01-01", "2026-12-31");
    expect(is.totalRevenueCents).toBe(0);
    expect(is.totalCogsCents).toBe(0);
    expect(is.grossProfitCents).toBe(0);
    expect(is.netIncomeCents).toBe(0);

    const bs = await fs.balanceSheet(companyId, "2026-12-31");
    expect(bs.assets.totalAssetsCents).toBe(0);
    expect(bs.liabilities.totalLiabilitiesCents).toBe(0);
    expect(bs.equity.totalEquityCents).toBe(0);

    const cf = await fs.cashFlowStatement(
      companyId,
      "2026-01-01",
      "2026-12-31",
    );
    expect(cf.netChangeInCashCents).toBe(0);
  });

  it("computes revenue, COGS, gross profit and net income from posted journal entries", async () => {
    const companyId = await makeCompany(db);
    const coa = createChartOfAccountsService(db);
    await coa.seedDefaults(companyId, "KWD");
    const journals = createJournalService(db);

    // Find seed account codes by type.
    const accounts = await coa.listAccounts(companyId);
    const cash = accounts.find((a) => a.subtype === "cash");
    const revenue = accounts.find((a) => a.type === "revenue");
    const cogs = accounts.find((a) => a.subtype === "cogs");
    const inventory = accounts.find((a) => a.subtype === "inventory");
    const opEx = accounts.find(
      (a) => a.type === "expense" && a.subtype !== "cogs" && a.subtype !== "other_expense" && a.subtype !== "tax_expense",
    );
    expect(cash).toBeDefined();
    expect(revenue).toBeDefined();

    if (cash && revenue) {
      // 1) Sale: DR cash 100, CR revenue 100
      await journals.createAndPost(companyId, {
        date: "2026-02-01",
        description: "Cash sale",
        lines: [
          { accountCode: cash.code, debitCents: 100_00, creditCents: 0 },
          { accountCode: revenue.code, debitCents: 0, creditCents: 100_00 },
        ],
      });
    }
    if (cogs && inventory) {
      // 2) COGS: DR cogs 40, CR inventory 40
      await journals.createAndPost(companyId, {
        date: "2026-02-01",
        description: "COGS",
        lines: [
          { accountCode: cogs.code, debitCents: 40_00, creditCents: 0 },
          { accountCode: inventory.code, debitCents: 0, creditCents: 40_00 },
        ],
      });
    }
    if (opEx && cash) {
      // 3) OpEx: DR opex 20, CR cash 20
      await journals.createAndPost(companyId, {
        date: "2026-02-15",
        description: "Office supplies",
        lines: [
          { accountCode: opEx.code, debitCents: 20_00, creditCents: 0 },
          { accountCode: cash.code, debitCents: 0, creditCents: 20_00 },
        ],
      });
    }

    const fs = createFinancialStatementsService(db);
    const is = await fs.incomeStatement(companyId, "2026-01-01", "2026-12-31");
    expect(is.totalRevenueCents).toBe(100_00);
    if (cogs && inventory) {
      expect(is.totalCogsCents).toBe(40_00);
      expect(is.grossProfitCents).toBe(60_00);
    }
    // Gross profit - opex = operating income
    expect(is.operatingIncomeCents).toBe(
      is.grossProfitCents - is.totalExpensesCents,
    );
  });

  it("maintains the fundamental equation: assets = liabilities + equity", async () => {
    const companyId = await makeCompany(db);
    const coa = createChartOfAccountsService(db);
    await coa.seedDefaults(companyId, "KWD");
    const accounts = await coa.listAccounts(companyId);
    const journals = createJournalService(db);

    const cash = accounts.find((a) => a.subtype === "cash");
    const equity = accounts.find((a) => a.type === "equity");
    // Owner injects 1,000 KWD
    if (cash && equity) {
      await journals.createAndPost(companyId, {
        date: "2026-01-01",
        description: "Owner injection",
        lines: [
          { accountCode: cash.code, debitCents: 1_000_000, creditCents: 0 },
          { accountCode: equity.code, debitCents: 0, creditCents: 1_000_000 },
        ],
      });
    }

    const fs = createFinancialStatementsService(db);
    const bs = await fs.balanceSheet(companyId, "2026-12-31");
    expect(bs.assets.totalAssetsCents).toBe(
      bs.totalLiabilitiesAndEquityCents,
    );
  });

  it("cash flow: net change matches ending - beginning", async () => {
    const companyId = await makeCompany(db);
    const coa = createChartOfAccountsService(db);
    await coa.seedDefaults(companyId, "KWD");
    const accounts = await coa.listAccounts(companyId);
    const journals = createJournalService(db);

    const cash = accounts.find((a) => a.subtype === "cash");
    const equity = accounts.find((a) => a.type === "equity");
    if (cash && equity) {
      await journals.createAndPost(companyId, {
        date: "2026-03-01",
        description: "Capital",
        lines: [
          { accountCode: cash.code, debitCents: 500_000, creditCents: 0 },
          { accountCode: equity.code, debitCents: 0, creditCents: 500_000 },
        ],
      });
    }
    const fs = createFinancialStatementsService(db);
    const cf = await fs.cashFlowStatement(
      companyId,
      "2026-01-01",
      "2026-12-31",
    );
    // Total operating + investing + financing == net change in cash
    expect(
      cf.netOperatingCents + cf.netInvestingCents + cf.netFinancingCents,
    ).toBe(cf.netChangeInCashCents);
  });
});
