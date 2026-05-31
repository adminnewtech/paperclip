import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  computeSlaDue,
  canTransitionTicket,
  ticketStatusFlow,
  resolveTicket,
} from "./helpdesk.js";

// ---------------------------------------------------------------------------
// In-memory transactional fake DB (mirrors finance-posting.test.ts).
// ---------------------------------------------------------------------------
interface Row extends Record<string, unknown> {
  id: string;
}

class FakeStore {
  tickets: Row[] = [];

  tableFor(name: string): Row[] {
    switch (name) {
      case "bos_ticket":
        return this.tickets;
      default:
        throw new Error(`Unknown table ${name}`);
    }
  }

  snapshot() {
    return { tickets: this.tickets.map((r) => ({ ...r })) };
  }

  restore(snap: ReturnType<FakeStore["snapshot"]>) {
    this.tickets = snap.tickets.map((r) => ({ ...r }));
  }
}

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `00000000-0000-0000-0000-${String(idCounter).padStart(12, "0")}`;
}

function extractIdParam(condition: unknown): string | null {
  const chunks = (condition as { queryChunks?: unknown[] })?.queryChunks ?? [];
  for (const chunk of chunks) {
    if (
      chunk != null &&
      typeof chunk === "object" &&
      "value" in (chunk as Record<string, unknown>) &&
      typeof (chunk as { value?: unknown }).value === "string"
    ) {
      return (chunk as { value: string }).value;
    }
  }
  return null;
}

function makeFakeDb(store: FakeStore): Db {
  function makeTx() {
    return {
      select(_columns?: unknown) {
        let tableRows: Row[] = [];
        const builder = {
          from(table: Parameters<typeof getTableName>[0]) {
            tableRows = store.tableFor(getTableName(table));
            return builder;
          },
          where(condition: unknown) {
            const id = extractIdParam(condition);
            const result = id
              ? tableRows.filter((r) => r.id === id)
              : [...tableRows];
            return Promise.resolve(result);
          },
        };
        return builder;
      },
      update(table: Parameters<typeof getTableName>[0]) {
        const rows = store.tableFor(getTableName(table));
        return {
          set(patch: Record<string, unknown>) {
            return {
              where(condition: unknown) {
                const id = extractIdParam(condition);
                const updated: Row[] = [];
                for (const row of rows) {
                  if (id && row.id !== id) continue;
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

describe("helpdesk", () => {
  // ----------------------- computeSlaDue -----------------------
  it("computes SLA due from policy resolution window", () => {
    const created = new Date("2026-06-01T00:00:00Z");
    const due = computeSlaDue(created, { resolutionMins: 120 });
    expect(due.getTime()).toBe(created.getTime() + 120 * 60 * 1000);
  });

  it("falls back to a 24h SLA window when policy omits resolution mins", () => {
    const created = new Date("2026-06-01T00:00:00Z");
    const due = computeSlaDue(created, null);
    expect(due.getTime()).toBe(created.getTime() + 1440 * 60 * 1000);
  });

  // ----------------------- transitions -----------------------
  it("allows valid ticket transitions and rejects invalid ones", () => {
    expect(canTransitionTicket("open", "resolved")).toBe(true);
    expect(canTransitionTicket("resolved", "open")).toBe(true);
    expect(canTransitionTicket("closed", "resolved")).toBe(false);
    expect(ticketStatusFlow.open).toContain("pending");
  });

  // ----------------------- resolveTicket (tx) -----------------------
  it("resolveTicket sets status resolved and stamps resolved_at", async () => {
    const store = new FakeStore();
    const ticketId = newId();
    store.tickets.push({
      id: ticketId,
      companyId: COMPANY,
      status: "open",
      resolvedAt: null,
    });
    const db = makeFakeDb(store);

    const updated = await resolveTicket(db, { companyId: COMPANY, ticketId });

    expect(updated.status).toBe("resolved");
    expect(updated.resolvedAt).toBeTruthy();
  });

  it("resolveTicket rejects a ticket from another company", async () => {
    const store = new FakeStore();
    const ticketId = newId();
    store.tickets.push({
      id: ticketId,
      companyId: "other-company",
      status: "open",
      resolvedAt: null,
    });
    const db = makeFakeDb(store);

    await expect(
      resolveTicket(db, { companyId: COMPANY, ticketId }),
    ).rejects.toThrow("Ticket not found");
  });

  it("resolveTicket rejects resolving a closed ticket", async () => {
    const store = new FakeStore();
    const ticketId = newId();
    store.tickets.push({
      id: ticketId,
      companyId: COMPANY,
      status: "closed",
      resolvedAt: null,
    });
    const db = makeFakeDb(store);

    await expect(
      resolveTicket(db, { companyId: COMPANY, ticketId }),
    ).rejects.toThrow("Cannot resolve");
  });
});
