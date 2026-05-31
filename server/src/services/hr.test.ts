import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  computePayslip,
  leaveDays,
  sumPayslips,
  approveLeave,
  processPayroll,
} from "./hr.js";

// ---------------------------------------------------------------------------
// In-memory transactional fake DB (mirrors finance-posting.test.ts).
// ---------------------------------------------------------------------------
interface Row extends Record<string, unknown> {
  id: string;
}

class FakeStore {
  leaveRequests: Row[] = [];
  payrollRuns: Row[] = [];
  payslips: Row[] = [];

  tableFor(name: string): Row[] {
    switch (name) {
      case "bos_leave_request":
        return this.leaveRequests;
      case "bos_payroll_run":
        return this.payrollRuns;
      case "bos_payslip":
        return this.payslips;
      default:
        throw new Error(`Unknown table ${name}`);
    }
  }

  snapshot() {
    return {
      leaveRequests: this.leaveRequests.map((r) => ({ ...r })),
      payrollRuns: this.payrollRuns.map((r) => ({ ...r })),
      payslips: this.payslips.map((r) => ({ ...r })),
    };
  }

  restore(snap: ReturnType<FakeStore["snapshot"]>) {
    this.leaveRequests = snap.leaveRequests.map((r) => ({ ...r }));
    this.payrollRuns = snap.payrollRuns.map((r) => ({ ...r }));
    this.payslips = snap.payslips.map((r) => ({ ...r }));
  }
}

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `00000000-0000-0000-0000-${String(idCounter).padStart(12, "0")}`;
}

// Filter helper: extract the first string param bound in a where() condition.
// For payslip queries we filter by payrollRunId, so we match on the run id when
// the row's id doesn't match (the fake only ever needs the run-scoped lookup).
function extractStringParams(condition: unknown): string[] {
  const chunks = (condition as { queryChunks?: unknown[] })?.queryChunks ?? [];
  const out: string[] = [];
  const visit = (node: unknown) => {
    if (node == null || typeof node !== "object") return;
    if (
      "value" in (node as Record<string, unknown>) &&
      typeof (node as { value?: unknown }).value === "string"
    ) {
      out.push((node as { value: string }).value);
    }
    const inner = (node as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(inner)) inner.forEach(visit);
  };
  chunks.forEach(visit);
  return out;
}

function makeFakeDb(store: FakeStore): Db {
  function makeTx() {
    return {
      select(_columns?: unknown) {
        let table = "";
        const builder = {
          from(t: Parameters<typeof getTableName>[0]) {
            table = getTableName(t);
            return builder;
          },
          where(condition: unknown) {
            const rows = store.tableFor(table);
            const params = extractStringParams(condition);
            if (params.length === 0) return Promise.resolve([...rows]);
            // Match rows whose id OR payrollRunId is among the bound params.
            const result = rows.filter(
              (r) =>
                params.includes(r.id as string) ||
                (r.payrollRunId != null &&
                  params.includes(r.payrollRunId as string)),
            );
            return Promise.resolve(result);
          },
        };
        return builder;
      },
      update(t: Parameters<typeof getTableName>[0]) {
        const rows = store.tableFor(getTableName(t));
        return {
          set(patch: Record<string, unknown>) {
            return {
              where(condition: unknown) {
                const params = extractStringParams(condition);
                const updated: Row[] = [];
                for (const row of rows) {
                  if (params.length && !params.includes(row.id as string)) continue;
                  Object.assign(row, patch);
                  updated.push(row);
                }
                return { returning: async () => updated };
              },
            };
          },
        };
      },
    };
  }

  return {
    async transaction(fn: (tx: unknown) => Promise<unknown>) {
      const snap = store.snapshot();
      try {
        return await fn(makeTx());
      } catch (error) {
        store.restore(snap);
        throw error;
      }
    },
  } as unknown as Db;
}

const COMPANY = "33333333-3333-3333-3333-333333333333";

describe("hr", () => {
  // ----------------------- computePayslip -----------------------
  it("computes net pay as gross minus deductions", () => {
    expect(computePayslip(500000, 75000)).toBe(425000);
  });

  it("floors net pay at zero when deductions exceed gross", () => {
    expect(computePayslip(100000, 150000)).toBe(0);
  });

  // ----------------------- leaveDays -----------------------
  it("counts inclusive leave days", () => {
    expect(leaveDays("2026-06-01", "2026-06-01")).toBe(1);
    expect(leaveDays("2026-06-01", "2026-06-05")).toBe(5);
  });

  // ----------------------- sumPayslips -----------------------
  it("sums payslip totals", () => {
    const totals = sumPayslips([
      { grossMinor: 500000, deductionsMinor: 75000, netMinor: 425000 },
      { grossMinor: 300000, deductionsMinor: 25000, netMinor: 275000 },
    ]);
    expect(totals.grossMinor).toBe(800000);
    expect(totals.deductionsMinor).toBe(100000);
    expect(totals.netMinor).toBe(700000);
  });

  // ----------------------- approveLeave (tx) -----------------------
  it("approveLeave flips pending to approved", async () => {
    const store = new FakeStore();
    const leaveId = newId();
    store.leaveRequests.push({
      id: leaveId,
      companyId: COMPANY,
      status: "pending",
      days: 3,
      approverUserId: null,
    });
    const db = makeFakeDb(store);

    const updated = await approveLeave(db, {
      companyId: COMPANY,
      leaveId,
      approverUserId: "user-1",
    });

    expect(updated.status).toBe("approved");
    expect(updated.approverUserId).toBe("user-1");
  });

  it("approveLeave rejects an already-approved request", async () => {
    const store = new FakeStore();
    const leaveId = newId();
    store.leaveRequests.push({
      id: leaveId,
      companyId: COMPANY,
      status: "approved",
      days: 3,
    });
    const db = makeFakeDb(store);

    await expect(
      approveLeave(db, { companyId: COMPANY, leaveId }),
    ).rejects.toThrow("already approved");
  });

  // ----------------------- processPayroll (tx) -----------------------
  it("processPayroll sums payslips into run totals and flips status", async () => {
    const store = new FakeStore();
    const runId = newId();
    store.payrollRuns.push({
      id: runId,
      companyId: COMPANY,
      status: "draft",
      grossMinor: 0,
      deductionsMinor: 0,
      netMinor: 0,
    });
    store.payslips.push(
      {
        id: newId(),
        companyId: COMPANY,
        payrollRunId: runId,
        grossMinor: 500000,
        deductionsMinor: 75000,
        netMinor: 425000,
      },
      {
        id: newId(),
        companyId: COMPANY,
        payrollRunId: runId,
        grossMinor: 300000,
        deductionsMinor: 25000,
        netMinor: 275000,
      },
    );
    const db = makeFakeDb(store);

    const run = await processPayroll(db, { companyId: COMPANY, runId });

    expect(run.status).toBe("processed");
    expect(run.grossMinor).toBe(800000);
    expect(run.deductionsMinor).toBe(100000);
    expect(run.netMinor).toBe(700000);
    expect((run.grossMinor as number) - (run.deductionsMinor as number)).toBe(
      run.netMinor,
    );
  });

  it("processPayroll rejects an already-processed run", async () => {
    const store = new FakeStore();
    const runId = newId();
    store.payrollRuns.push({
      id: runId,
      companyId: COMPANY,
      status: "processed",
      grossMinor: 0,
      deductionsMinor: 0,
      netMinor: 0,
    });
    const db = makeFakeDb(store);

    await expect(
      processPayroll(db, { companyId: COMPANY, runId }),
    ).rejects.toThrow("already processed");
  });
});
