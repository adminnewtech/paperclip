/**
 * Auto-posting service.
 *
 * Listens to business events (invoice created, expense recorded, payment
 * received, etc.) and creates journal entries automatically. This is what
 * turns the business module from a CRUD app into a real accounting system.
 *
 * IMPORTANT: every auto-posting hook is wrapped in try/catch by the caller.
 * Posting failures must NOT block the underlying business operation
 * (creating an invoice should succeed even if the journal is misconfigured).
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type { JournalEntry, JournalLine } from "@paperclipai/shared";
import { createJournalService, type JournalService } from "./journal-service.js";
import {
  createChartOfAccountsService,
  type ChartOfAccountsService,
} from "./chart-of-accounts.js";

// ---------------------------------------------------------------------------
// Default account-code mapping
// ---------------------------------------------------------------------------

/** Map an expense category string → expense account code. */
const EXPENSE_CATEGORY_MAP: Record<string, string> = {
  rent: "6200",
  utilities: "6300",
  utility: "6300",
  "office-supplies": "6400",
  "office supplies": "6400",
  supplies: "6400",
  marketing: "6500",
  advertising: "6500",
  "marketing & advertising": "6500",
  insurance: "6600",
  professional: "6700",
  "professional fees": "6700",
  legal: "6700",
  travel: "6800",
  "travel & entertainment": "6800",
  entertainment: "6800",
  bank: "6900",
  "bank charges": "6900",
  depreciation: "6950",
  interest: "7100",
  tax: "7200",
  payroll: "6100",
  salary: "6100",
  salaries: "6100",
  "salaries & wages": "6100",
};

const DEFAULTS = {
  accountsReceivable: "1130",
  accountsPayable: "2110",
  cash: "1110",
  bank: "1120",
  salesRevenue: "4100",
  serviceRevenue: "4200",
  otherRevenue: "4900",
  vatPayable: "2130",
  cogs: "5100",
  inventory: "1140",
  fallbackExpense: "7000",
  payrollLiability: "2140",
  payrollExpense: "6100",
  ownerCapital: "3100",
};

function classifyExpenseCategory(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULTS.fallbackExpense;
  const key = raw.trim().toLowerCase();
  return EXPENSE_CATEGORY_MAP[key] ?? DEFAULTS.fallbackExpense;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface AutoPostingService {
  onInvoiceCreated(companyId: string, invoiceId: string): Promise<JournalEntry | null>;
  onInvoicePaid(
    companyId: string,
    invoiceId: string,
    paymentAmountCents: number,
    paymentDate: string,
  ): Promise<JournalEntry | null>;
  onExpenseCreated(companyId: string, expenseId: string): Promise<JournalEntry | null>;
  onPaymentReceived(
    companyId: string,
    paymentId: string,
  ): Promise<JournalEntry | null>;
  onInventoryAdjustment(
    companyId: string,
    movementId: string,
  ): Promise<JournalEntry | null>;
  onPayrollRun(
    companyId: string,
    payrollId: string,
  ): Promise<JournalEntry | null>;
  /**
   * Generic dispatcher used by business.ts. Examines (moduleKey, entityType,
   * row) and delegates to the appropriate handler. Returns null when there's
   * nothing to do (e.g. for a CRM contact). Never throws.
   */
  onEntityCreated(
    companyId: string,
    moduleKey: string,
    entityType: string,
    entityId: string,
  ): Promise<JournalEntry | null>;
  onEntityUpdated(
    companyId: string,
    moduleKey: string,
    entityType: string,
    entityId: string,
    previousStatus?: string | null,
    newStatus?: string | null,
  ): Promise<JournalEntry | null>;
  onEntityDeleted(
    companyId: string,
    moduleKey: string,
    entityType: string,
    entityId: string,
  ): Promise<JournalEntry | null>;
}

export function createAutoPostingService(
  db: Db,
  opts?: { journal?: JournalService; coa?: ChartOfAccountsService },
): AutoPostingService {
  const journal = opts?.journal ?? createJournalService(db);
  const coa = opts?.coa ?? createChartOfAccountsService(db);

  async function fetchEntity(companyId: string, entityId: string) {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, entityId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function ensureAccount(companyId: string, code: string): Promise<string | null> {
    const acc = await coa.getAccount(companyId, code);
    return acc ? acc.code : null;
  }

  const service: AutoPostingService = {
    async onInvoiceCreated(companyId, invoiceId) {
      const row = await fetchEntity(companyId, invoiceId);
      if (!row) return null;
      if (row.moduleKey !== "sales" || row.entityType !== "invoice") return null;
      const amount = row.amountCents ?? 0;
      if (amount <= 0) return null;

      const data = (row.data ?? {}) as Record<string, unknown>;
      const vatCents = Number(data.vatCents ?? data.taxCents ?? 0);
      const subtotalCents = amount - vatCents;
      const revenueCode = await ensureAccount(companyId, DEFAULTS.salesRevenue);
      const arCode = await ensureAccount(companyId, DEFAULTS.accountsReceivable);
      if (!revenueCode || !arCode) return null;
      const lines: JournalLine[] = [
        { accountCode: arCode, debitCents: amount, creditCents: 0 },
        { accountCode: revenueCode, debitCents: 0, creditCents: subtotalCents },
      ];
      if (vatCents > 0) {
        const vatCode = await ensureAccount(companyId, DEFAULTS.vatPayable);
        if (vatCode) {
          lines.push({ accountCode: vatCode, debitCents: 0, creditCents: vatCents });
        } else {
          // No VAT account — bump revenue line so the entry still balances.
          lines[1] = {
            accountCode: revenueCode,
            debitCents: 0,
            creditCents: subtotalCents + vatCents,
          };
        }
      }
      return journal.createAndPost(companyId, {
        date:
          typeof data.date === "string"
            ? (data.date as string).slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        description: `Invoice ${row.code ?? row.name ?? row.id}`,
        referenceType: "invoice",
        referenceId: row.id,
        lines,
      });
    },

    async onInvoicePaid(companyId, invoiceId, paymentAmountCents, paymentDate) {
      const row = await fetchEntity(companyId, invoiceId);
      if (!row) return null;
      if (paymentAmountCents <= 0) return null;
      const cashCode = (await ensureAccount(companyId, DEFAULTS.bank))
        ?? (await ensureAccount(companyId, DEFAULTS.cash));
      const arCode = await ensureAccount(companyId, DEFAULTS.accountsReceivable);
      if (!cashCode || !arCode) return null;
      const lines: JournalLine[] = [
        { accountCode: cashCode, debitCents: paymentAmountCents, creditCents: 0 },
        { accountCode: arCode, debitCents: 0, creditCents: paymentAmountCents },
      ];
      return journal.createAndPost(companyId, {
        date: paymentDate || new Date().toISOString().slice(0, 10),
        description: `Payment received for invoice ${row.code ?? row.id}`,
        referenceType: "payment",
        referenceId: row.id,
        lines,
      });
    },

    async onExpenseCreated(companyId, expenseId) {
      const row = await fetchEntity(companyId, expenseId);
      if (!row) return null;
      if (row.moduleKey !== "finance" && row.moduleKey !== "accounting") return null;
      if (row.entityType !== "expense") return null;
      const amount = row.amountCents ?? 0;
      if (amount <= 0) return null;
      const data = (row.data ?? {}) as Record<string, unknown>;
      const expenseCode = await ensureAccount(
        companyId,
        classifyExpenseCategory(data.category),
      );
      if (!expenseCode) return null;
      const paidFrom = typeof data.paidFrom === "string" ? data.paidFrom : "bank";
      const creditCode = await (async () => {
        if (paidFrom === "cash") return ensureAccount(companyId, DEFAULTS.cash);
        if (paidFrom === "credit_card" || paidFrom === "credit-card") {
          return ensureAccount(companyId, "2120");
        }
        if (paidFrom === "accounts_payable") {
          return ensureAccount(companyId, DEFAULTS.accountsPayable);
        }
        return ensureAccount(companyId, DEFAULTS.bank);
      })();
      if (!creditCode) return null;
      const lines: JournalLine[] = [
        { accountCode: expenseCode, debitCents: amount, creditCents: 0 },
        { accountCode: creditCode, debitCents: 0, creditCents: amount },
      ];
      return journal.createAndPost(companyId, {
        date:
          typeof data.date === "string"
            ? (data.date as string).slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        description:
          (typeof data.description === "string" && data.description) ||
          row.name ||
          `Expense ${row.code ?? row.id}`,
        referenceType: "expense",
        referenceId: row.id,
        lines,
      });
    },

    async onPaymentReceived(companyId, paymentId) {
      const row = await fetchEntity(companyId, paymentId);
      if (!row) return null;
      if (row.moduleKey !== "sales" || row.entityType !== "payment") return null;
      const amount = row.amountCents ?? 0;
      if (amount <= 0) return null;
      const data = (row.data ?? {}) as Record<string, unknown>;
      const cashCode = (await ensureAccount(companyId, DEFAULTS.bank))
        ?? (await ensureAccount(companyId, DEFAULTS.cash));
      const arCode = await ensureAccount(companyId, DEFAULTS.accountsReceivable);
      if (!cashCode || !arCode) return null;
      return journal.createAndPost(companyId, {
        date:
          typeof data.date === "string"
            ? (data.date as string).slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        description: `Payment ${row.code ?? row.id}`,
        referenceType: "payment",
        referenceId: row.id,
        lines: [
          { accountCode: cashCode, debitCents: amount, creditCents: 0 },
          { accountCode: arCode, debitCents: 0, creditCents: amount },
        ],
      });
    },

    async onInventoryAdjustment(companyId, movementId) {
      const row = await fetchEntity(companyId, movementId);
      if (!row) return null;
      if (row.entityType !== "stock_movement") return null;
      const amount = row.amountCents ?? 0;
      if (amount === 0) return null;
      const inventoryCode = await ensureAccount(companyId, DEFAULTS.inventory);
      const cogsCode = await ensureAccount(companyId, DEFAULTS.cogs);
      if (!inventoryCode || !cogsCode) return null;
      const data = (row.data ?? {}) as Record<string, unknown>;
      const direction = (data.direction as string) ?? (amount > 0 ? "in" : "out");
      const abs = Math.abs(amount);
      const lines: JournalLine[] =
        direction === "in"
          ? [
              { accountCode: inventoryCode, debitCents: abs, creditCents: 0 },
              { accountCode: cogsCode, debitCents: 0, creditCents: abs },
            ]
          : [
              { accountCode: cogsCode, debitCents: abs, creditCents: 0 },
              { accountCode: inventoryCode, debitCents: 0, creditCents: abs },
            ];
      return journal.createAndPost(companyId, {
        date:
          typeof data.date === "string"
            ? (data.date as string).slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        description: row.name ?? `Inventory adjustment ${row.code ?? row.id}`,
        referenceType: "adjustment",
        referenceId: row.id,
        lines,
      });
    },

    async onPayrollRun(companyId, payrollId) {
      const row = await fetchEntity(companyId, payrollId);
      if (!row) return null;
      const amount = row.amountCents ?? 0;
      if (amount <= 0) return null;
      const expenseCode = await ensureAccount(companyId, DEFAULTS.payrollExpense);
      const liabilityCode = await ensureAccount(companyId, DEFAULTS.payrollLiability);
      if (!expenseCode || !liabilityCode) return null;
      const data = (row.data ?? {}) as Record<string, unknown>;
      return journal.createAndPost(companyId, {
        date:
          typeof data.date === "string"
            ? (data.date as string).slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        description: row.name ?? `Payroll ${row.code ?? row.id}`,
        referenceType: "manual",
        referenceId: row.id,
        lines: [
          { accountCode: expenseCode, debitCents: amount, creditCents: 0 },
          { accountCode: liabilityCode, debitCents: 0, creditCents: amount },
        ],
      });
    },

    async onEntityCreated(companyId, moduleKey, entityType, entityId) {
      try {
        if (moduleKey === "sales" && entityType === "invoice") {
          return await service.onInvoiceCreated(companyId, entityId);
        }
        if (moduleKey === "sales" && entityType === "payment") {
          return await service.onPaymentReceived(companyId, entityId);
        }
        if (
          (moduleKey === "finance" || moduleKey === "accounting") &&
          entityType === "expense"
        ) {
          return await service.onExpenseCreated(companyId, entityId);
        }
        if (moduleKey === "inventory" && entityType === "stock_movement") {
          return await service.onInventoryAdjustment(companyId, entityId);
        }
        if (moduleKey === "hr" && entityType === "payroll_run") {
          return await service.onPayrollRun(companyId, entityId);
        }
        return null;
      } catch (err) {
        // Auto-posting must never break the business operation. Caller logs.
        return null;
      }
    },

    async onEntityUpdated(
      companyId,
      moduleKey,
      entityType,
      entityId,
      previousStatus,
      newStatus,
    ) {
      try {
        // Only react to status transitions of interest. For invoices, when
        // status flips to "paid", emit a cash receipt entry.
        if (
          moduleKey === "sales" &&
          entityType === "invoice" &&
          newStatus === "paid" &&
          previousStatus !== "paid"
        ) {
          const row = await fetchEntity(companyId, entityId);
          if (!row) return null;
          const amount = row.amountCents ?? 0;
          const data = (row.data ?? {}) as Record<string, unknown>;
          return await service.onInvoicePaid(
            companyId,
            entityId,
            amount,
            typeof data.paidAt === "string"
              ? (data.paidAt as string).slice(0, 10)
              : new Date().toISOString().slice(0, 10),
          );
        }
        return null;
      } catch (err) {
        return null;
      }
    },

    async onEntityDeleted(companyId, moduleKey, entityType, entityId) {
      try {
        // Find all posted entries referencing this entity and post reversals.
        const linked = await journal.listEntries(companyId, {
          referenceId: entityId,
          limit: 100,
        });
        if (linked.length === 0) return null;
        let lastReversal: JournalEntry | null = null;
        for (const entry of linked) {
          if (entry.status !== "posted") continue;
          if (entry.reversedBy) continue;
          lastReversal = await journal.reverseEntry(
            companyId,
            entry.id,
            `Source ${moduleKey}/${entityType} deleted`,
          );
        }
        return lastReversal;
      } catch (err) {
        return null;
      }
    },
  };

  return service;
}
