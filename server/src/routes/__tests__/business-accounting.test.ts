/**
 * Integration tests for the accounting routes:
 *   POST   /companies/:id/business/accounting/accounts/seed-defaults
 *   POST   /companies/:id/business/accounting/journal
 *   GET    /companies/:id/business/accounting/trial-balance
 *   GET    /companies/:id/business/accounting/income-statement
 *
 * Tests boot a fresh embedded Postgres per file and tear it down at the end.
 * Each test starts with a clean schema (everything dropped in `afterEach`).
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { businessEntities, companies, type Db } from "@paperclipai/db";
import {
  getTestDbSupport,
  setupTestDb,
  type TestDbHandle,
} from "../../__tests__/setup.js";
import { createTestApp } from "../../__tests__/test-app.js";

const support = await getTestDbSupport();
const dbDescribe = support.supported ? describe : describe.skip;

async function makeCompany(db: Db): Promise<string> {
  const [row] = await db
    .insert(companies)
    .values({
      name: `Acc Co ${randomUUID()}`,
      issuePrefix: `AC${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  return row!.id;
}

dbDescribe("business accounting routes (integration)", () => {
  let handle: TestDbHandle | null = null;
  let db!: Db;

  beforeAll(async () => {
    handle = await setupTestDb("paperclip-acc-routes-");
    db = handle.db;
  }, 60_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  afterEach(async () => {
    await db.delete(businessEntities);
    await db.delete(companies);
  });

  it("seed-defaults creates the default chart of accounts", async () => {
    const companyId = await makeCompany(db);
    const app = createTestApp(db, {
      actor: { userId: "u1", companyIds: [companyId] },
    });

    const res = await request(app)
      .post(
        `/api/companies/${companyId}/business/accounting/accounts/seed-defaults`,
      )
      .send({ currency: "KWD" });
    expect(res.status).toBe(201);
    expect(res.body.created).toBeGreaterThan(0);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    // The default chart has at least ~40 accounts.
    expect(res.body.accounts.length).toBeGreaterThan(20);
  });

  it("rejects an unbalanced journal entry with 400", async () => {
    const companyId = await makeCompany(db);
    const app = createTestApp(db, {
      actor: { userId: "u1", companyIds: [companyId] },
    });
    await request(app).post(
      `/api/companies/${companyId}/business/accounting/accounts/seed-defaults`,
    );
    const res = await request(app)
      .post(`/api/companies/${companyId}/business/accounting/journal`)
      .send({
        date: "2026-01-15",
        description: "bad",
        lines: [
          { accountCode: "1000", debitCents: 1000, creditCents: 0 },
          { accountCode: "4000", debitCents: 0, creditCents: 500 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/balance|Invalid/i);
  });

  it("creates a balanced journal entry and returns 201", async () => {
    const companyId = await makeCompany(db);
    const app = createTestApp(db, {
      actor: { userId: "u1", companyIds: [companyId] },
    });
    const seeded = await request(app)
      .post(
        `/api/companies/${companyId}/business/accounting/accounts/seed-defaults`,
      )
      .send({ currency: "KWD" });
    const accounts = seeded.body.accounts as Array<{
      code: string;
      type: string;
    }>;
    const debitAcc = accounts.find((a) => a.type === "asset");
    const creditAcc = accounts.find((a) => a.type === "revenue");
    expect(debitAcc).toBeDefined();
    expect(creditAcc).toBeDefined();

    const res = await request(app)
      .post(`/api/companies/${companyId}/business/accounting/journal`)
      .send({
        date: "2026-01-15",
        description: "Sale",
        lines: [
          {
            accountCode: debitAcc!.code,
            debitCents: 100_00,
            creditCents: 0,
          },
          {
            accountCode: creditAcc!.code,
            debitCents: 0,
            creditCents: 100_00,
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.totalDebitsCents).toBe(100_00);
  });

  it("trial-balance returns balanced zero state for a fresh company", async () => {
    const companyId = await makeCompany(db);
    const app = createTestApp(db, {
      actor: { userId: "u1", companyIds: [companyId] },
    });
    const res = await request(app).get(
      `/api/companies/${companyId}/business/accounting/trial-balance`,
    );
    expect(res.status).toBe(200);
    expect(res.body.totalDebitCents).toBe(0);
    expect(res.body.totalCreditCents).toBe(0);
    expect(res.body.balanced).toBe(true);
  });

  it("income-statement returns zeros for an empty period", async () => {
    const companyId = await makeCompany(db);
    const app = createTestApp(db, {
      actor: { userId: "u1", companyIds: [companyId] },
    });
    const res = await request(app).get(
      `/api/companies/${companyId}/business/accounting/income-statement?from=2026-01-01&to=2026-12-31`,
    );
    expect(res.status).toBe(200);
    expect(res.body.totalRevenueCents).toBe(0);
    expect(res.body.netIncomeCents).toBe(0);
  });

  it("denies access to another tenant's accounting endpoints", async () => {
    const companyA = await makeCompany(db);
    const companyB = await makeCompany(db);
    const appA = createTestApp(db, {
      actor: { userId: "uA", companyIds: [companyA] },
    });
    const res = await request(appA).get(
      `/api/companies/${companyB}/business/accounting/trial-balance`,
    );
    expect([403, 404]).toContain(res.status);
  });
});
