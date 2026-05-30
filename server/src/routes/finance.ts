import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosInvoice,
  bosBill,
  bosFinPayment,
  bosBankAccount,
  bosBankTransaction,
  bosJournalEntry,
  bosJournalLine,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import {
  postInvoice,
  postBill,
  recordPayment,
  computeStatements,
  arAgingBuckets,
  type StatementJournalLine,
  type AgingRow,
} from "../services/finance-posting.js";

// ---------------------------------------------------------------------------
// Validation schemas.
// ---------------------------------------------------------------------------
const lineSchema = z.object({
  description: z.string().trim().max(1000).optional().default(""),
  qty: z.number().nonnegative().optional().default(1),
  unitPriceMinor: z.number().int().optional().default(0),
});

const invoiceCreateSchema = z.object({
  number: z.string().trim().max(100).optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().trim().max(500).optional().nullable(),
  issueDate: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  subtotalMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative().optional().default(0),
  totalMinor: z.number().int().nonnegative().optional(),
  currency: z.string().trim().length(3).optional().default("KWD"),
  lines: z.array(lineSchema).optional().default([]),
});

const billCreateSchema = z.object({
  number: z.string().trim().max(100).optional().nullable(),
  vendorId: z.string().uuid().optional().nullable(),
  vendorName: z.string().trim().max(500).optional().nullable(),
  issueDate: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  subtotalMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative().optional().default(0),
  totalMinor: z.number().int().nonnegative().optional(),
  currency: z.string().trim().length(3).optional().default("KWD"),
  lines: z.array(lineSchema).optional().default([]),
});

const paySchema = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.string().trim().length(3).optional(),
  method: z.string().trim().max(100).optional(),
});

const bankAccountCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  accountNumber: z.string().trim().max(100).optional().nullable(),
  currency: z.string().trim().length(3).optional().default("KWD"),
  balanceMinor: z.number().int().optional().default(0),
  ledgerAccountCode: z.string().trim().max(50).optional().nullable(),
});

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

export function financeRoutes(db: Db) {
  const router = Router();

  // ---------------------- Invoices (AR) ----------------------
  router.get("/companies/:companyId/finance/invoices", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosInvoice)
      .where(eq(bosInvoice.companyId, companyId))
      .orderBy(desc(bosInvoice.createdAt));
    res.json({ invoices: rows });
  });

  router.post(
    "/companies/:companyId/finance/invoices",
    validate(invoiceCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof invoiceCreateSchema>;
      const actor = getActorInfo(req);

      const totalMinor = body.totalMinor ?? body.subtotalMinor + body.taxMinor;

      const [row] = await db
        .insert(bosInvoice)
        .values({
          companyId,
          number: body.number ?? null,
          customerId: body.customerId ?? null,
          customerName: body.customerName ?? null,
          issueDate: toDate(body.issueDate) ?? new Date(),
          dueDate: toDate(body.dueDate),
          subtotalMinor: body.subtotalMinor,
          taxMinor: body.taxMinor,
          totalMinor,
          currency: body.currency,
          status: "draft",
          lines: body.lines,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "finance.invoice_created",
          entityType: "bos_invoice",
          entityId: row.id,
          details: { totalMinor: row.totalMinor, currency: row.currency },
        });
      }

      res.status(201).json(row);
    },
  );

  router.post(
    "/companies/:companyId/finance/invoices/:id/post",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;
      const actor = getActorInfo(req);

      let invoice;
      try {
        invoice = await postInvoice(db, { companyId, invoiceId: id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Post failed";
        if (message === "Invoice not found") {
          res.status(404).json({ error: message });
          return;
        }
        if (message === "Invoice is already posted") {
          res.status(409).json({ error: message });
          return;
        }
        throw error;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "finance.invoice_posted",
        entityType: "bos_invoice",
        entityId: invoice.id,
        details: { journalEntryId: invoice.journalEntryId },
      });

      res.json(invoice);
    },
  );

  router.post(
    "/companies/:companyId/finance/invoices/:id/pay",
    validate(paySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;
      const body = req.body as z.infer<typeof paySchema>;
      const actor = getActorInfo(req);

      let result;
      try {
        result = await recordPayment(db, {
          companyId,
          invoiceId: id,
          amountMinor: body.amountMinor,
          currency: body.currency,
          method: body.method,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Payment failed";
        if (message === "Invoice not found") {
          res.status(404).json({ error: message });
          return;
        }
        throw error;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "finance.invoice_payment",
        entityType: "bos_invoice",
        entityId: id,
        details: { amountMinor: body.amountMinor },
      });

      res.status(201).json(result);
    },
  );

  // ---------------------- Bills (AP) ----------------------
  router.get("/companies/:companyId/finance/bills", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosBill)
      .where(eq(bosBill.companyId, companyId))
      .orderBy(desc(bosBill.createdAt));
    res.json({ bills: rows });
  });

  router.post(
    "/companies/:companyId/finance/bills",
    validate(billCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof billCreateSchema>;
      const actor = getActorInfo(req);

      const totalMinor = body.totalMinor ?? body.subtotalMinor + body.taxMinor;

      const [row] = await db
        .insert(bosBill)
        .values({
          companyId,
          number: body.number ?? null,
          vendorId: body.vendorId ?? null,
          vendorName: body.vendorName ?? null,
          issueDate: toDate(body.issueDate) ?? new Date(),
          dueDate: toDate(body.dueDate),
          subtotalMinor: body.subtotalMinor,
          taxMinor: body.taxMinor,
          totalMinor,
          currency: body.currency,
          status: "draft",
          lines: body.lines,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "finance.bill_created",
          entityType: "bos_bill",
          entityId: row.id,
          details: { totalMinor: row.totalMinor, currency: row.currency },
        });
      }

      res.status(201).json(row);
    },
  );

  router.post("/companies/:companyId/finance/bills/:id/post", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const id = req.params.id as string;
    const actor = getActorInfo(req);

    let bill;
    try {
      bill = await postBill(db, { companyId, billId: id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Post failed";
      if (message === "Bill not found") {
        res.status(404).json({ error: message });
        return;
      }
      if (message === "Bill is already posted") {
        res.status(409).json({ error: message });
        return;
      }
      throw error;
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "finance.bill_posted",
      entityType: "bos_bill",
      entityId: bill.id,
      details: { journalEntryId: bill.journalEntryId },
    });

    res.json(bill);
  });

  router.post(
    "/companies/:companyId/finance/bills/:id/pay",
    validate(paySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;
      const body = req.body as z.infer<typeof paySchema>;
      const actor = getActorInfo(req);

      let result;
      try {
        result = await recordPayment(db, {
          companyId,
          billId: id,
          amountMinor: body.amountMinor,
          currency: body.currency,
          method: body.method,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Payment failed";
        if (message === "Bill not found") {
          res.status(404).json({ error: message });
          return;
        }
        throw error;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "finance.bill_payment",
        entityType: "bos_bill",
        entityId: id,
        details: { amountMinor: body.amountMinor },
      });

      res.status(201).json(result);
    },
  );

  // ---------------------- Banking ----------------------
  router.get("/companies/:companyId/finance/bank-accounts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosBankAccount)
      .where(eq(bosBankAccount.companyId, companyId))
      .orderBy(desc(bosBankAccount.createdAt));
    res.json({ bankAccounts: rows });
  });

  router.post(
    "/companies/:companyId/finance/bank-accounts",
    validate(bankAccountCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof bankAccountCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosBankAccount)
        .values({
          companyId,
          name: body.name,
          accountNumber: body.accountNumber ?? null,
          currency: body.currency,
          balanceMinor: body.balanceMinor,
          ledgerAccountCode: body.ledgerAccountCode ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "finance.bank_account_created",
          entityType: "bos_bank_account",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  router.get("/companies/:companyId/finance/bank-transactions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const bankAccountId =
      typeof req.query.bankAccountId === "string" ? req.query.bankAccountId : null;

    const conditions = [eq(bosBankTransaction.companyId, companyId)];
    if (bankAccountId) {
      conditions.push(eq(bosBankTransaction.bankAccountId, bankAccountId));
    }

    const rows = await db
      .select()
      .from(bosBankTransaction)
      .where(and(...conditions))
      .orderBy(desc(bosBankTransaction.date));
    res.json({ bankTransactions: rows });
  });

  router.post(
    "/companies/:companyId/finance/bank-transactions/:id/reconcile",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;
      const actor = getActorInfo(req);

      const matchedPaymentId =
        typeof (req.body as { matchedPaymentId?: unknown })?.matchedPaymentId ===
        "string"
          ? ((req.body as { matchedPaymentId?: string }).matchedPaymentId as string)
          : null;

      const [row] = await db
        .update(bosBankTransaction)
        .set({
          reconciled: true,
          matchedPaymentId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(bosBankTransaction.id, id),
            eq(bosBankTransaction.companyId, companyId),
          ),
        )
        .returning();

      if (!row) {
        res.status(404).json({ error: "Bank transaction not found" });
        return;
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "finance.bank_transaction_reconciled",
        entityType: "bos_bank_transaction",
        entityId: row.id,
        details: { matchedPaymentId },
      });

      res.json(row);
    },
  );

  // ---------------------- Statements (P&L + Balance Sheet) ----------------------
  router.get("/companies/:companyId/finance/statements", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

    const conditions = [eq(bosJournalEntry.companyId, companyId)];
    if (from && !Number.isNaN(from.getTime())) {
      conditions.push(gte(bosJournalEntry.entryDate, from));
    }
    if (to && !Number.isNaN(to.getTime())) {
      conditions.push(lte(bosJournalEntry.entryDate, to));
    }

    const rows = await db
      .select({
        accountCode: bosJournalLine.accountCode,
        debitMinor: bosJournalLine.debitMinor,
        creditMinor: bosJournalLine.creditMinor,
      })
      .from(bosJournalLine)
      .innerJoin(
        bosJournalEntry,
        eq(bosJournalLine.entryId, bosJournalEntry.id),
      )
      .where(and(...conditions));

    const statements = computeStatements(rows as StatementJournalLine[]);
    res.json(statements);
  });

  // ---------------------- AR / AP aging ----------------------
  router.get("/companies/:companyId/finance/aging", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const kind = req.query.kind === "ap" ? "ap" : "ar";

    let rows: AgingRow[];
    if (kind === "ar") {
      const invoices = await db
        .select({
          dueDate: bosInvoice.dueDate,
          totalMinor: bosInvoice.totalMinor,
          paidMinor: bosInvoice.paidMinor,
        })
        .from(bosInvoice)
        .where(eq(bosInvoice.companyId, companyId));
      rows = invoices;
    } else {
      const bills = await db
        .select({
          dueDate: bosBill.dueDate,
          totalMinor: bosBill.totalMinor,
          paidMinor: bosBill.paidMinor,
        })
        .from(bosBill)
        .where(eq(bosBill.companyId, companyId));
      rows = bills;
    }

    const buckets = arAgingBuckets(rows);
    res.json({ kind, buckets });
  });

  return router;
}
