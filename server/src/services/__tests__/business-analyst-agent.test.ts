/**
 * Unit/integration tests for the business analyst agent.
 *
 * The analyst's heuristics (KPIs, anomalies, opportunities) are not exported
 * directly; instead we exercise them end-to-end via `analyzeCompany()`,
 * seeding the businessEntities table with controlled fixtures. This keeps
 * the tests anchored to the publicly observable contract.
 *
 * Tests are gated on embedded-postgres support so they degrade gracefully
 * to `it.skip` in sandboxed environments. The end-to-end fixture is
 * intentionally small (a handful of invoices + expenses) to keep the
 * cold-start cost reasonable.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  businessEntities,
  companies,
  createDb,
  type Db,
} from "@paperclipai/db";
import {
  getTestDbSupport,
  setupTestDb,
  type TestDbHandle,
} from "../../__tests__/setup.js";
import {
  analyzeCompany,
  ANALYST_CONSTANTS,
} from "../business-analyst-agent.js";

const support = await getTestDbSupport();
const dbDescribe = support.supported ? describe : describe.skip;

async function makeCompany(db: Db): Promise<string> {
  const [row] = await db
    .insert(companies)
    .values({
      name: `Analyst Co ${randomUUID()}`,
      issuePrefix: `AN${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  return row!.id;
}

async function seedInvoice(
  db: Db,
  companyId: string,
  opts: {
    amountCents: number;
    status: "paid" | "sent" | "overdue" | "draft";
    customer?: string;
    daysAgo?: number;
  },
): Promise<void> {
  const now = new Date();
  const created = new Date(
    now.getTime() - (opts.daysAgo ?? 1) * 24 * 60 * 60 * 1000,
  );
  await db.insert(businessEntities).values({
    companyId,
    moduleKey: "sales",
    entityType: "invoice",
    status: opts.status,
    name: `Invoice ${randomUUID().slice(0, 6)}`,
    amountCents: opts.amountCents,
    data: { customer: opts.customer ?? "Customer A" } as Record<string, unknown>,
    tags: [],
    createdAt: created,
    updatedAt: created,
  });
}

async function seedExpense(
  db: Db,
  companyId: string,
  opts: { amountCents: number; category: string; vendor?: string; daysAgo?: number },
): Promise<void> {
  const now = new Date();
  const created = new Date(
    now.getTime() - (opts.daysAgo ?? 1) * 24 * 60 * 60 * 1000,
  );
  await db.insert(businessEntities).values({
    companyId,
    moduleKey: "finance",
    entityType: "expense",
    status: "approved",
    name: `Expense ${randomUUID().slice(0, 6)}`,
    amountCents: opts.amountCents,
    data: {
      category: opts.category,
      vendor: opts.vendor ?? "Vendor X",
    } as Record<string, unknown>,
    tags: [],
    createdAt: created,
    updatedAt: created,
  });
}

dbDescribe("business-analyst-agent: analyzeCompany", () => {
  let handle: TestDbHandle | null = null;
  let db!: Db;

  beforeAll(async () => {
    handle = await setupTestDb("paperclip-analyst-");
    db = handle.db;
  }, 60_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  afterEach(async () => {
    await db.delete(businessEntities);
    await db.delete(companies);
  });

  it("exposes module/entity constants", () => {
    expect(ANALYST_CONSTANTS.moduleKey).toBe("analyst");
    expect(ANALYST_CONSTANTS.entityType).toBe("insight_report");
  });

  it("returns a zero-snapshot insight for a company with no data", async () => {
    const companyId = await makeCompany(db);
    const report = await analyzeCompany(db, companyId);
    expect(report.report.kpiSnapshot.revenueCents).toBe(0);
    expect(report.report.kpiSnapshot.expensesCents).toBe(0);
    expect(report.report.kpiSnapshot.netIncomeCents).toBe(0);
    expect(Array.isArray(report.report.anomalies)).toBe(true);
  });

  it("computes revenue from paid invoices only", async () => {
    const companyId = await makeCompany(db);
    await seedInvoice(db, companyId, {
      amountCents: 100_000,
      status: "paid",
    });
    await seedInvoice(db, companyId, {
      amountCents: 999_000,
      status: "draft",
    });
    const report = await analyzeCompany(db, companyId);
    expect(report.report.kpiSnapshot.revenueCents).toBe(100_000);
  });

  it("flags accounts-receivable risk when outstanding > 30% of revenue", async () => {
    const companyId = await makeCompany(db);
    // Revenue: 100 KWD; outstanding: 100 KWD (100%) → should trip the heuristic.
    await seedInvoice(db, companyId, {
      amountCents: 10_000,
      status: "paid",
      customer: "A",
    });
    await seedInvoice(db, companyId, {
      amountCents: 10_000,
      status: "overdue",
      customer: "B",
    });
    const report = await analyzeCompany(db, companyId);
    const arAnomaly = report.report.anomalies.find(
      (a) => a.category === "cash",
    );
    expect(arAnomaly).toBeDefined();
  });

  it("flags an expense spike when current >> previous period", async () => {
    const companyId = await makeCompany(db);
    // Period default = current month. To trip the heuristic we need an
    // expense in the current period AND a smaller one in the prior period.
    // We seed two with explicit dates within the analyzer's default window.
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthBoundary = new Date(thisMonth.getTime() - 1);

    // Current period: 1_000_000 in Marketing
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "finance",
      entityType: "expense",
      status: "approved",
      name: "current marketing",
      amountCents: 1_000_000,
      data: { category: "Marketing", vendor: "AdCo" } as Record<string, unknown>,
      tags: [],
      createdAt: new Date(thisMonth.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: new Date(thisMonth.getTime() + 24 * 60 * 60 * 1000),
    });
    // Prior period: 100_000 in Marketing (10x growth)
    const priorDate = new Date(lastMonthBoundary.getTime() - 24 * 60 * 60 * 1000);
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "finance",
      entityType: "expense",
      status: "approved",
      name: "prior marketing",
      amountCents: 100_000,
      data: { category: "Marketing", vendor: "AdCo" } as Record<string, unknown>,
      tags: [],
      createdAt: priorDate,
      updatedAt: priorDate,
    });

    const report = await analyzeCompany(db, companyId);
    const spike = report.report.anomalies.find((a) =>
      /spike|Marketing/i.test(a.title),
    );
    expect(spike).toBeDefined();
  });

  it("identifies cross-sell opportunity for top customers", async () => {
    const companyId = await makeCompany(db);
    // Seed 3 customers with paid invoices.
    for (let i = 0; i < 3; i++) {
      await seedInvoice(db, companyId, {
        amountCents: 50_000,
        status: "paid",
        customer: `Customer-${i}`,
      });
    }
    const report = await analyzeCompany(db, companyId);
    const opp = report.report.opportunities.find((o) =>
      /Cross-sell|top/i.test(o.title),
    );
    expect(opp).toBeDefined();
  });

  it("computes gross margin as (revenue - expenses) / revenue × 100", async () => {
    const companyId = await makeCompany(db);
    await seedInvoice(db, companyId, { amountCents: 100_000, status: "paid" });
    await seedExpense(db, companyId, {
      amountCents: 25_000,
      category: "Software",
    });
    const report = await analyzeCompany(db, companyId);
    const kpi = report.report.kpiSnapshot;
    expect(kpi.revenueCents).toBe(100_000);
    expect(kpi.expensesCents).toBe(25_000);
    expect(kpi.netIncomeCents).toBe(75_000);
    expect(kpi.grossMarginPercent).toBeCloseTo(75, 1);
  });

  it("persists the report so it can be retrieved later", async () => {
    const companyId = await makeCompany(db);
    const report = await analyzeCompany(db, companyId);
    const stored = await db.select().from(businessEntities);
    const insightRow = stored.find(
      (r) =>
        r.moduleKey === ANALYST_CONSTANTS.moduleKey &&
        r.entityType === ANALYST_CONSTANTS.entityType,
    );
    expect(insightRow).toBeDefined();
    expect(report.id).toBeTruthy();
  });
});
