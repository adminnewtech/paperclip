/**
 * Business accounting REST API.
 *
 * Endpoints are all company-scoped and use the standard assertCompanyAccess
 * authorization helper. The handlers are thin wrappers around the
 * accounting services in `services/accounting/`.
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  createChartOfAccountsService,
  type AccountSeed,
} from "../services/accounting/chart-of-accounts.js";
import { createJournalService } from "../services/accounting/journal-service.js";
import { createLedgerService } from "../services/accounting/ledger-service.js";
import { createFinancialStatementsService } from "../services/accounting/financial-statements.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const accountTypeSchema = z.enum([
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);
const accountSubtypeSchema = z.enum([
  "cash",
  "bank",
  "accounts_receivable",
  "inventory",
  "fixed_asset",
  "other_current_asset",
  "other_asset",
  "accounts_payable",
  "credit_card",
  "loan",
  "other_current_liability",
  "long_term_liability",
  "common_stock",
  "retained_earnings",
  "drawing",
  "operating_revenue",
  "other_revenue",
  "cogs",
  "operating_expense",
  "payroll_expense",
  "tax_expense",
  "other_expense",
]);

const createAccountSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(500),
  nameAr: z.string().trim().max(500).optional().default(""),
  type: accountTypeSchema,
  subtype: accountSubtypeSchema,
  parentCode: z.string().trim().max(64).optional().nullable(),
  description: z.string().trim().max(2000).optional(),
  currency: z.string().trim().length(3).optional(),
});

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  nameAr: z.string().trim().max(500).optional(),
  type: accountTypeSchema.optional(),
  subtype: accountSubtypeSchema.optional(),
  parentCode: z.string().trim().max(64).optional().nullable(),
  description: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
});

const lineSchema = z.object({
  accountCode: z.string().trim().min(1),
  debitCents: z.number().int().min(0).default(0),
  creditCents: z.number().int().min(0).default(0),
  description: z.string().trim().max(500).optional(),
  contactId: z.string().trim().max(255).optional(),
  productId: z.string().trim().max(255).optional(),
  costCenter: z.string().trim().max(255).optional(),
});

const createJournalSchema = z.object({
  date: z.string().trim().min(8),
  description: z.string().trim().min(1).max(500),
  descriptionAr: z.string().trim().max(500).optional(),
  referenceType: z
    .enum([
      "invoice",
      "expense",
      "payment",
      "manual",
      "adjustment",
      "opening_balance",
      "closing",
    ])
    .optional(),
  referenceId: z.string().trim().max(255).optional(),
  lines: z.array(lineSchema).min(2),
  notes: z.string().trim().max(5000).optional(),
});

const closePeriodSchema = z.object({
  periodEnd: z.string().trim().min(8),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function businessAccountingRoutes(db: Db) {
  const router = Router();
  const coa = createChartOfAccountsService(db);
  const journal = createJournalService(db);
  const ledger = createLedgerService(db, { coa, journal });
  const statements = createFinancialStatementsService(db, { coa, ledger });

  // ---------- Chart of Accounts ----------
  router.get("/companies/:companyId/business/accounting/accounts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accounts = await coa.listAccounts(companyId);
    res.json({ accounts });
  });

  router.post(
    "/companies/:companyId/business/accounting/accounts",
    validate(createAccountSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof createAccountSchema>;
      try {
        const existing = await coa.getAccount(companyId, body.code);
        if (existing) {
          res.status(409).json({ error: "An account with this code already exists." });
          return;
        }
        const seed: AccountSeed = {
          code: body.code,
          name: body.name,
          nameAr: body.nameAr ?? "",
          type: body.type,
          subtype: body.subtype,
          parentCode: body.parentCode ?? undefined,
          description: body.description,
        };
        const account = await coa.createAccount(companyId, {
          ...seed,
          currency: body.currency,
          actorId: actor.actorId ?? null,
        });
        res.status(201).json(account);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  router.put(
    "/companies/:companyId/business/accounting/accounts/:code",
    validate(updateAccountSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const code = req.params.code as string;
      const actor = getActorInfo(req);
      try {
        const updated = await coa.updateAccount(companyId, code, {
          ...(req.body as Partial<z.infer<typeof updateAccountSchema>>),
          actorId: actor.actorId ?? null,
        });
        if (!updated) {
          res.status(404).json({ error: "Account not found" });
          return;
        }
        res.json(updated);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  router.delete(
    "/companies/:companyId/business/accounting/accounts/:code",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const code = req.params.code as string;
      try {
        const ok = await coa.deleteAccount(companyId, code);
        if (!ok) {
          res.status(404).json({ error: "Account not found" });
          return;
        }
        res.status(204).end();
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/accounting/accounts/seed-defaults",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = (req.body ?? {}) as { currency?: string };
      const result = await coa.seedDefaults(
        companyId,
        body.currency ?? "KWD",
        actor.actorId ?? null,
      );
      const accounts = await coa.listAccounts(companyId);
      res.status(201).json({ ...result, accounts });
    },
  );

  // ---------- Journal ----------
  router.get("/companies/:companyId/business/accounting/journal", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const referenceType =
      typeof req.query.referenceType === "string" ? req.query.referenceType : undefined;
    const referenceId =
      typeof req.query.referenceId === "string" ? req.query.referenceId : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit) || 500, 5000) : 500;
    const entries = await journal.listEntries(companyId, {
      from,
      to,
      status: status as never,
      referenceType: referenceType as never,
      referenceId,
      limit,
    });
    res.json({ entries });
  });

  router.post(
    "/companies/:companyId/business/accounting/journal",
    validate(createJournalSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof createJournalSchema>;
      try {
        const entry = await journal.createEntry(companyId, {
          ...body,
          createdBy: actor.actorId ?? undefined,
        });
        res.status(201).json(entry);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  router.get(
    "/companies/:companyId/business/accounting/journal/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const entry = await journal.getEntry(companyId, req.params.id as string);
      if (!entry) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(entry);
    },
  );

  router.post(
    "/companies/:companyId/business/accounting/journal/:id/post",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      try {
        const entry = await journal.postEntry(
          companyId,
          req.params.id as string,
          actor.actorId ?? undefined,
        );
        res.json(entry);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/accounting/journal/:id/void",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const reason =
        typeof req.body?.reason === "string" ? (req.body.reason as string) : undefined;
      try {
        const entry = await journal.voidEntry(
          companyId,
          req.params.id as string,
          reason,
        );
        res.json(entry);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/accounting/journal/:id/reverse",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const reason =
        typeof req.body?.reason === "string" ? (req.body.reason as string) : undefined;
      try {
        const entry = await journal.reverseEntry(
          companyId,
          req.params.id as string,
          reason,
          actor.actorId ?? undefined,
        );
        res.json(entry);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  // ---------- Ledger ----------
  router.get(
    "/companies/:companyId/business/accounting/ledger/:accountCode",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const code = req.params.accountCode as string;
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const [account, lines] = await Promise.all([
        coa.getAccount(companyId, code),
        ledger.getAccountLedger(companyId, code, { from, to }),
      ]);
      if (!account) {
        res.status(404).json({ error: "Account not found" });
        return;
      }
      res.json({ account, lines });
    },
  );

  router.get(
    "/companies/:companyId/business/accounting/trial-balance",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const asOf =
        typeof req.query.asOf === "string"
          ? req.query.asOf
          : new Date().toISOString().slice(0, 10);
      const rows = await ledger.getTrialBalance(companyId, asOf);
      const totals = rows.reduce(
        (s, r) => {
          s.debit += r.debitCents;
          s.credit += r.creditCents;
          return s;
        },
        { debit: 0, credit: 0 },
      );
      res.json({
        asOf,
        rows,
        totalDebitCents: totals.debit,
        totalCreditCents: totals.credit,
        balanced: totals.debit === totals.credit,
      });
    },
  );

  // ---------- Financial statements ----------
  router.get(
    "/companies/:companyId/business/accounting/income-statement",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { from, to } = parsePeriod(req.query);
      const stmt = await statements.incomeStatement(companyId, from, to);
      res.json(stmt);
    },
  );

  router.get(
    "/companies/:companyId/business/accounting/balance-sheet",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const asOf =
        typeof req.query.asOf === "string"
          ? req.query.asOf
          : new Date().toISOString().slice(0, 10);
      const stmt = await statements.balanceSheet(companyId, asOf);
      res.json(stmt);
    },
  );

  router.get(
    "/companies/:companyId/business/accounting/cash-flow",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { from, to } = parsePeriod(req.query);
      const stmt = await statements.cashFlowStatement(companyId, from, to);
      res.json(stmt);
    },
  );

  // ---------- Period closing ----------
  router.post(
    "/companies/:companyId/business/accounting/close-period",
    validate(closePeriodSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof closePeriodSchema>;
      try {
        const result = await ledger.closeAccountingPeriod(
          companyId,
          body.periodEnd,
          actor.actorId ?? undefined,
        );
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePeriod(query: unknown): { from: string; to: string } {
  const q = (query ?? {}) as { from?: string; to?: string };
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: typeof q.from === "string" && q.from ? q.from : monthStart.toISOString().slice(0, 10),
    to: typeof q.to === "string" && q.to ? q.to : monthEnd.toISOString().slice(0, 10),
  };
}
