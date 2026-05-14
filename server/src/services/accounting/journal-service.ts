/**
 * Journal service — double-entry bookkeeping engine.
 *
 * A journal entry is a balanced collection of debit and credit lines.
 * It is stored as a businessEntities row with:
 *  - moduleKey: "accounting"
 *  - entityType: "journal_entry"
 *  - code: human-readable entry number (e.g. "JE-2026-000001")
 *  - data.lines: the array of debit/credit lines
 *  - data.*: descriptions, references, posting metadata
 *
 * The service enforces the cardinal invariant of double-entry bookkeeping:
 *  every entry MUST have totalDebits === totalCredits.
 */

import { and, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  validateJournalLines,
  type JournalEntry,
  type JournalEntryStatus,
  type JournalLine,
  type JournalReferenceType,
} from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface JournalDataPayload {
  description?: string;
  descriptionAr?: string;
  referenceType?: JournalReferenceType;
  referenceId?: string;
  lines?: JournalLine[];
  totalDebitsCents?: number;
  totalCreditsCents?: number;
  postedAt?: string;
  postedBy?: string;
  reversedBy?: string;
  notes?: string;
  createdBy?: string;
  date?: string;
}

function rowToEntry(row: {
  id: string;
  code: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  data: unknown;
}): JournalEntry {
  const data = (row.data ?? {}) as JournalDataPayload;
  const lines = (data.lines ?? []).map((l) => ({
    accountCode: l.accountCode,
    debitCents: Number(l.debitCents ?? 0),
    creditCents: Number(l.creditCents ?? 0),
    description: l.description,
    contactId: l.contactId,
    productId: l.productId,
    costCenter: l.costCenter,
  }));
  const totalDebitsCents = lines.reduce((s, l) => s + l.debitCents, 0);
  const totalCreditsCents = lines.reduce((s, l) => s + l.creditCents, 0);
  return {
    id: row.id,
    entryNumber: row.code ?? "",
    date: data.date ?? row.createdAt.toISOString().slice(0, 10),
    description: data.description ?? "",
    descriptionAr: data.descriptionAr,
    referenceType: data.referenceType,
    referenceId: data.referenceId,
    status: (row.status as JournalEntryStatus) ?? "draft",
    lines,
    totalDebitsCents,
    totalCreditsCents,
    createdBy: data.createdBy,
    postedAt: data.postedAt,
    postedBy: data.postedBy,
    reversedBy: data.reversedBy,
    notes: data.notes,
  };
}

// ---------------------------------------------------------------------------
// Entry number generator
// ---------------------------------------------------------------------------

async function nextEntryNumber(db: Db, companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `JE-${year}-`;
  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "accounting"),
        eq(businessEntities.entityType, "journal_entry"),
        ilike(businessEntities.code, `${prefix}%`),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);
  let num = 1;
  const last = rows[0]?.code;
  if (last) {
    const parts = last.split("-");
    const lastNum = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!isNaN(lastNum)) num = lastNum + 1;
  }
  return `${prefix}${String(num).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface CreateJournalEntryInput {
  date: string;
  description: string;
  descriptionAr?: string;
  referenceType?: JournalReferenceType;
  referenceId?: string;
  lines: JournalLine[];
  createdBy?: string;
  notes?: string;
}

export interface ListJournalEntriesOptions {
  from?: string;
  to?: string;
  status?: JournalEntryStatus;
  referenceType?: JournalReferenceType;
  referenceId?: string;
  limit?: number;
}

export interface JournalService {
  createEntry(companyId: string, input: CreateJournalEntryInput): Promise<JournalEntry>;
  postEntry(companyId: string, entryId: string, postedBy?: string): Promise<JournalEntry>;
  voidEntry(companyId: string, entryId: string, reason?: string): Promise<JournalEntry>;
  reverseEntry(
    companyId: string,
    entryId: string,
    reason?: string,
    actorId?: string,
  ): Promise<JournalEntry>;
  listEntries(
    companyId: string,
    opts?: ListJournalEntriesOptions,
  ): Promise<JournalEntry[]>;
  getEntry(companyId: string, entryId: string): Promise<JournalEntry | null>;
  validateEntry(entry: Pick<JournalEntry, "lines">): { valid: boolean; errors: string[] };
  /**
   * Create AND immediately post an entry — used by auto-posting from
   * invoices/expenses where the source document is itself the trigger.
   */
  createAndPost(
    companyId: string,
    input: CreateJournalEntryInput,
    postedBy?: string,
  ): Promise<JournalEntry>;
}

export function createJournalService(db: Db): JournalService {
  const service: JournalService = {
    validateEntry(entry) {
      const r = validateJournalLines(entry.lines);
      return { valid: r.valid, errors: r.errors };
    },

    async createEntry(companyId, input) {
      const check = validateJournalLines(input.lines);
      if (!check.valid) {
        throw new Error(`Invalid journal entry: ${check.errors.join("; ")}`);
      }
      const entryNumber = await nextEntryNumber(db, companyId);
      const now = new Date();
      const data: JournalDataPayload = {
        date: input.date,
        description: input.description,
        descriptionAr: input.descriptionAr,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        lines: input.lines,
        totalDebitsCents: check.totalDebitsCents,
        totalCreditsCents: check.totalCreditsCents,
        createdBy: input.createdBy,
        notes: input.notes,
      };
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: "accounting",
          entityType: "journal_entry",
          code: entryNumber,
          name: input.description.slice(0, 480),
          status: "draft",
          amountCents: check.totalDebitsCents,
          currency: null,
          data: data as Record<string, unknown>,
          tags: input.referenceType ? [input.referenceType] : [],
          createdByUserId: input.createdBy ?? null,
          updatedByUserId: input.createdBy ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("Failed to create journal entry");
      return rowToEntry(row);
    },

    async postEntry(companyId, entryId, postedBy) {
      const entry = await this.getEntry(companyId, entryId);
      if (!entry) throw new Error("Journal entry not found");
      if (entry.status === "posted") return entry;
      if (entry.status === "void") {
        throw new Error("Cannot post a voided entry.");
      }
      const check = validateJournalLines(entry.lines);
      if (!check.valid) {
        throw new Error(`Cannot post unbalanced entry: ${check.errors.join("; ")}`);
      }
      const now = new Date();
      const data: JournalDataPayload = {
        date: entry.date,
        description: entry.description,
        descriptionAr: entry.descriptionAr,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        lines: entry.lines,
        totalDebitsCents: entry.totalDebitsCents,
        totalCreditsCents: entry.totalCreditsCents,
        createdBy: entry.createdBy,
        notes: entry.notes,
        postedAt: now.toISOString(),
        postedBy,
        reversedBy: entry.reversedBy,
      };
      const [row] = await db
        .update(businessEntities)
        .set({
          status: "posted",
          data: data as Record<string, unknown>,
          updatedAt: now,
          updatedByUserId: postedBy ?? null,
        })
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.id, entryId),
            eq(businessEntities.moduleKey, "accounting"),
            eq(businessEntities.entityType, "journal_entry"),
          ),
        )
        .returning();
      if (!row) throw new Error("Failed to post journal entry");
      return rowToEntry(row);
    },

    async voidEntry(companyId, entryId, reason) {
      const entry = await this.getEntry(companyId, entryId);
      if (!entry) throw new Error("Journal entry not found");
      const now = new Date();
      const data: JournalDataPayload = {
        date: entry.date,
        description: entry.description,
        descriptionAr: entry.descriptionAr,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        lines: entry.lines,
        totalDebitsCents: entry.totalDebitsCents,
        totalCreditsCents: entry.totalCreditsCents,
        createdBy: entry.createdBy,
        postedAt: entry.postedAt,
        postedBy: entry.postedBy,
        reversedBy: entry.reversedBy,
        notes: reason ? `${entry.notes ?? ""}\nVoided: ${reason}`.trim() : entry.notes,
      };
      const [row] = await db
        .update(businessEntities)
        .set({
          status: "void",
          data: data as Record<string, unknown>,
          updatedAt: now,
        })
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.id, entryId),
          ),
        )
        .returning();
      if (!row) throw new Error("Failed to void journal entry");
      return rowToEntry(row);
    },

    async reverseEntry(companyId, entryId, reason, actorId) {
      const entry = await this.getEntry(companyId, entryId);
      if (!entry) throw new Error("Journal entry not found");
      if (entry.status === "void") {
        throw new Error("Cannot reverse a voided entry.");
      }
      // Build inverted lines.
      const reversedLines: JournalLine[] = entry.lines.map((l) => ({
        accountCode: l.accountCode,
        debitCents: l.creditCents,
        creditCents: l.debitCents,
        description: l.description,
        contactId: l.contactId,
        productId: l.productId,
        costCenter: l.costCenter,
      }));
      const reversal = await this.createEntry(companyId, {
        date: new Date().toISOString().slice(0, 10),
        description: `Reversal of ${entry.entryNumber}${reason ? ` — ${reason}` : ""}`,
        descriptionAr: entry.descriptionAr,
        referenceType: "adjustment",
        referenceId: entry.id,
        lines: reversedLines,
        createdBy: actorId,
        notes: reason,
      });
      const posted = await this.postEntry(companyId, reversal.id, actorId);
      // Link original to reversal.
      const now = new Date();
      const data: JournalDataPayload = {
        date: entry.date,
        description: entry.description,
        descriptionAr: entry.descriptionAr,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        lines: entry.lines,
        totalDebitsCents: entry.totalDebitsCents,
        totalCreditsCents: entry.totalCreditsCents,
        createdBy: entry.createdBy,
        postedAt: entry.postedAt,
        postedBy: entry.postedBy,
        reversedBy: posted.id,
        notes: entry.notes,
      };
      await db
        .update(businessEntities)
        .set({ data: data as Record<string, unknown>, updatedAt: now })
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.id, entryId),
          ),
        );
      return posted;
    },

    async listEntries(companyId, opts) {
      const conditions = [
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "accounting"),
        eq(businessEntities.entityType, "journal_entry"),
      ];
      if (opts?.status) {
        conditions.push(eq(businessEntities.status, opts.status));
      }
      if (opts?.from) {
        conditions.push(gte(businessEntities.createdAt, new Date(opts.from)));
      }
      if (opts?.to) {
        conditions.push(lte(businessEntities.createdAt, new Date(opts.to)));
      }
      if (opts?.referenceType) {
        conditions.push(sql`data->>'referenceType' = ${opts.referenceType}`);
      }
      if (opts?.referenceId) {
        conditions.push(sql`data->>'referenceId' = ${opts.referenceId}`);
      }
      const rows = await db
        .select()
        .from(businessEntities)
        .where(and(...conditions))
        .orderBy(desc(businessEntities.createdAt))
        .limit(Math.min(opts?.limit ?? 500, 5000));
      return rows.map(rowToEntry);
    },

    async getEntry(companyId, entryId) {
      const [row] = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.id, entryId),
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "accounting"),
            eq(businessEntities.entityType, "journal_entry"),
          ),
        )
        .limit(1);
      return row ? rowToEntry(row) : null;
    },

    async createAndPost(companyId, input, postedBy) {
      const created = await this.createEntry(companyId, input);
      return this.postEntry(companyId, created.id, postedBy);
    },
  };

  // Touch unused imports referenced by SQL builder (avoid TS pruning).
  void inArray;
  return service;
}
