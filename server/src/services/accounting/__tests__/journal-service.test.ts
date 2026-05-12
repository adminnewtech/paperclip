/**
 * Tests for the journal-service double-entry engine.
 *
 * The service has two layers:
 *   (a) Pure validation (`validateEntry`) — exercised without a DB.
 *   (b) CRUD + post/void/reverse — requires Postgres because drizzle
 *       uses real `insert/update` queries. We gate this with the embedded
 *       Postgres support probe.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  businessEntities,
  companies,
  createDb,
  type Db,
} from "@paperclipai/db";
import { validateJournalLines, type JournalLine } from "@paperclipai/shared";
import {
  getTestDbSupport,
  setupTestDb,
  type TestDbHandle,
} from "../../../__tests__/setup.js";
import { createJournalService } from "../journal-service.js";

const support = await getTestDbSupport();
const dbDescribe = support.supported ? describe : describe.skip;

const balancedLines: JournalLine[] = [
  { accountCode: "1000", debitCents: 50_000, creditCents: 0 },
  { accountCode: "4000", debitCents: 0, creditCents: 50_000 },
];

const unbalancedLines: JournalLine[] = [
  { accountCode: "1000", debitCents: 50_000, creditCents: 0 },
  { accountCode: "4000", debitCents: 0, creditCents: 40_000 },
];

describe("journal-service: validateEntry (pure)", () => {
  it("accepts a balanced entry", () => {
    const r = validateJournalLines(balancedLines);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.totalDebitsCents).toBe(50_000);
    expect(r.totalCreditsCents).toBe(50_000);
  });

  it("rejects an unbalanced entry", () => {
    const r = validateJournalLines(unbalancedLines);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.join(" ")).toMatch(/balance/i);
  });

  it("rejects an entry with fewer than two lines", () => {
    const r = validateJournalLines([
      { accountCode: "1000", debitCents: 100, creditCents: 0 },
    ]);
    expect(r.valid).toBe(false);
  });

  it("rejects a line with both debit and credit set", () => {
    const r = validateJournalLines([
      { accountCode: "1000", debitCents: 50, creditCents: 50 },
      { accountCode: "4000", debitCents: 0, creditCents: 0 },
    ]);
    expect(r.valid).toBe(false);
  });

  it("rejects a line with neither debit nor credit", () => {
    const r = validateJournalLines([
      { accountCode: "1000", debitCents: 0, creditCents: 0 },
      { accountCode: "4000", debitCents: 0, creditCents: 0 },
    ]);
    expect(r.valid).toBe(false);
  });

  it("rejects negative amounts", () => {
    const r = validateJournalLines([
      { accountCode: "1000", debitCents: -100, creditCents: 0 },
      { accountCode: "4000", debitCents: 0, creditCents: -100 },
    ]);
    expect(r.valid).toBe(false);
  });
});

async function makeCompany(db: Db): Promise<string> {
  const [row] = await db
    .insert(companies)
    .values({
      name: `Journal Co ${randomUUID()}`,
      issuePrefix: `JR${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  return row!.id;
}

dbDescribe("journal-service: CRUD (integration)", () => {
  let handle: TestDbHandle | null = null;
  let db!: Db;

  beforeAll(async () => {
    handle = await setupTestDb("paperclip-journal-");
    db = handle.db;
  }, 60_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  afterEach(async () => {
    await db.delete(businessEntities);
    await db.delete(companies);
  });

  it("creates a draft entry, posts it, then reads it back", async () => {
    const companyId = await makeCompany(db);
    const svc = createJournalService(db);
    const created = await svc.createEntry(companyId, {
      date: "2026-01-15",
      description: "Cash sale",
      lines: balancedLines,
    });
    expect(created.status).toBe("draft");
    expect(created.totalDebitsCents).toBe(50_000);
    expect(created.totalCreditsCents).toBe(50_000);

    const posted = await svc.postEntry(companyId, created.id, "user-1");
    expect(posted.status).toBe("posted");
    expect(posted.postedBy).toBe("user-1");

    const fetched = await svc.getEntry(companyId, created.id);
    expect(fetched?.status).toBe("posted");
  });

  it("rejects creating an unbalanced entry", async () => {
    const companyId = await makeCompany(db);
    const svc = createJournalService(db);
    await expect(
      svc.createEntry(companyId, {
        date: "2026-01-15",
        description: "bad",
        lines: unbalancedLines,
      }),
    ).rejects.toThrow(/Invalid journal entry/);
  });

  it("voids an entry without changing its lines", async () => {
    const companyId = await makeCompany(db);
    const svc = createJournalService(db);
    const created = await svc.createEntry(companyId, {
      date: "2026-01-15",
      description: "to void",
      lines: balancedLines,
    });
    const voided = await svc.voidEntry(companyId, created.id, "wrong amount");
    expect(voided.status).toBe("void");
    expect(voided.lines).toHaveLength(2);
  });

  it("reversing an entry creates a new entry with inverted lines", async () => {
    const companyId = await makeCompany(db);
    const svc = createJournalService(db);
    const original = await svc.createAndPost(
      companyId,
      {
        date: "2026-01-15",
        description: "original",
        lines: balancedLines,
      },
      "user-1",
    );
    const reversal = await svc.reverseEntry(
      companyId,
      original.id,
      "correction",
      "user-1",
    );
    expect(reversal.id).not.toBe(original.id);
    expect(reversal.status).toBe("posted");
    // Verify debits/credits are flipped on each line.
    for (let i = 0; i < balancedLines.length; i++) {
      expect(reversal.lines[i]!.debitCents).toBe(balancedLines[i]!.creditCents);
      expect(reversal.lines[i]!.creditCents).toBe(balancedLines[i]!.debitCents);
    }
  });

  it("listEntries respects date-range filters", async () => {
    const companyId = await makeCompany(db);
    const svc = createJournalService(db);
    await svc.createAndPost(companyId, {
      date: "2026-01-15",
      description: "in range",
      lines: balancedLines,
    });
    await svc.createAndPost(companyId, {
      date: "2025-12-15",
      description: "out of range",
      lines: balancedLines,
    });
    const inRange = await svc.listEntries(companyId, {
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(inRange.map((e) => e.description)).toEqual(["in range"]);
  });
});
