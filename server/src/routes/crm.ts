import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosPipeline,
  bosPipelineStage,
  bosLead,
  bosDeal,
  bosActivity,
  bosQuote,
  bosQuoteLine,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import {
  scoreLead,
  quoteTotals,
  quoteLineTotal,
  convertLead,
  moveDealStage,
  acceptQuote,
} from "../services/crm.js";

// ---------------------------------------------------------------------------
// Validation schemas.
// ---------------------------------------------------------------------------
const pipelineCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  isDefault: z.boolean().optional().default(false),
});

const stageCreateSchema = z.object({
  pipelineId: z.string().uuid(),
  name: z.string().trim().min(1).max(500),
  sort: z.number().int().optional().default(0),
  winProbability: z.number().int().min(0).max(100).optional().default(0),
  isWon: z.boolean().optional().default(false),
  isLost: z.boolean().optional().default(false),
});

const leadCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  companyName: z.string().trim().max(500).optional().nullable(),
  email: z.string().trim().max(500).optional().nullable(),
  phone: z.string().trim().max(100).optional().nullable(),
  source: z.string().trim().max(100).optional().nullable(),
  status: z.string().trim().max(50).optional().nullable(),
  ownerUserId: z.string().trim().max(255).optional().nullable(),
});

const convertSchema = z.object({
  pipelineId: z.string().uuid(),
});

const dealCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  pipelineId: z.string().uuid().optional().nullable(),
  stageId: z.string().uuid().optional().nullable(),
  amountMinor: z.number().int().nonnegative().optional().default(0),
  currency: z.string().trim().length(3).optional().default("KWD"),
  customerName: z.string().trim().max(500).optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
  expectedClose: z.string().datetime().optional().nullable(),
  ownerUserId: z.string().trim().max(255).optional().nullable(),
});

const moveSchema = z.object({
  stageId: z.string().uuid(),
});

const activityCreateSchema = z.object({
  kind: z.string().trim().max(50).optional().nullable(),
  subject: z.string().trim().max(500).optional().nullable(),
  body: z.string().trim().max(5000).optional().nullable(),
  relatedType: z.string().trim().max(50).optional().nullable(),
  relatedId: z.string().uuid().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  done: z.boolean().optional().default(false),
  ownerUserId: z.string().trim().max(255).optional().nullable(),
});

const quoteLineSchema = z.object({
  description: z.string().trim().max(1000).optional().default(""),
  qty: z.number().nonnegative().optional().default(1),
  unitPriceMinor: z.number().int().nonnegative().optional().default(0),
});

const quoteCreateSchema = z.object({
  number: z.string().trim().max(100).optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  customerName: z.string().trim().max(500).optional().nullable(),
  currency: z.string().trim().length(3).optional().default("KWD"),
  taxRatePct: z.number().nonnegative().optional().default(0),
  validUntil: z.string().datetime().optional().nullable(),
  lines: z.array(quoteLineSchema).optional().default([]),
});

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

export function crmRoutes(db: Db) {
  const router = Router();

  // ---------------------- Pipelines ----------------------
  router.get("/companies/:companyId/crm/pipelines", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosPipeline)
      .where(eq(bosPipeline.companyId, companyId))
      .orderBy(desc(bosPipeline.createdAt));
    res.json({ pipelines: rows });
  });

  router.post(
    "/companies/:companyId/crm/pipelines",
    validate(pipelineCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof pipelineCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosPipeline)
        .values({
          companyId,
          name: body.name,
          isDefault: body.isDefault,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "crm.pipeline_created",
          entityType: "bos_pipeline",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Pipeline stages ----------------------
  router.get("/companies/:companyId/crm/pipeline-stages", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const pipelineId =
      typeof req.query.pipelineId === "string" ? req.query.pipelineId : null;

    const conditions = [eq(bosPipelineStage.companyId, companyId)];
    if (pipelineId) {
      conditions.push(eq(bosPipelineStage.pipelineId, pipelineId));
    }

    const rows = await db
      .select()
      .from(bosPipelineStage)
      .where(and(...conditions))
      .orderBy(bosPipelineStage.sort);
    res.json({ stages: rows });
  });

  router.post(
    "/companies/:companyId/crm/pipeline-stages",
    validate(stageCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof stageCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosPipelineStage)
        .values({
          companyId,
          pipelineId: body.pipelineId,
          name: body.name,
          sort: body.sort,
          winProbability: body.winProbability,
          isWon: body.isWon,
          isLost: body.isLost,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "crm.stage_created",
          entityType: "bos_pipeline_stage",
          entityId: row.id,
          details: { name: row.name, pipelineId: row.pipelineId },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Leads ----------------------
  router.get("/companies/:companyId/crm/leads", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosLead)
      .where(eq(bosLead.companyId, companyId))
      .orderBy(desc(bosLead.createdAt));
    res.json({ leads: rows });
  });

  router.post(
    "/companies/:companyId/crm/leads",
    validate(leadCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof leadCreateSchema>;
      const actor = getActorInfo(req);

      const score = scoreLead({
        email: body.email ?? null,
        phone: body.phone ?? null,
        companyName: body.companyName ?? null,
        source: body.source ?? null,
      });

      const [row] = await db
        .insert(bosLead)
        .values({
          companyId,
          name: body.name,
          companyName: body.companyName ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          source: body.source ?? null,
          status: body.status ?? "new",
          score,
          ownerUserId: body.ownerUserId ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "crm.lead_created",
          entityType: "bos_lead",
          entityId: row.id,
          details: { name: row.name, score: row.score },
        });
      }

      res.status(201).json(row);
    },
  );

  router.post("/companies/:companyId/crm/leads/:id/score", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const id = req.params.id as string;
    const actor = getActorInfo(req);

    const [lead] = await db
      .select()
      .from(bosLead)
      .where(and(eq(bosLead.id, id), eq(bosLead.companyId, companyId)));
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const score = scoreLead({
      email: lead.email,
      phone: lead.phone,
      companyName: lead.companyName,
      source: lead.source,
    });

    const [row] = await db
      .update(bosLead)
      .set({ score, updatedAt: new Date() })
      .where(and(eq(bosLead.id, id), eq(bosLead.companyId, companyId)))
      .returning();

    if (row) {
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "crm.lead_scored",
        entityType: "bos_lead",
        entityId: row.id,
        details: { score: row.score },
      });
    }

    res.json(row);
  });

  router.post(
    "/companies/:companyId/crm/leads/:id/convert",
    validate(convertSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;
      const body = req.body as z.infer<typeof convertSchema>;
      const actor = getActorInfo(req);

      let result;
      try {
        result = await convertLead(db, {
          companyId,
          leadId: id,
          pipelineId: body.pipelineId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Convert failed";
        if (message === "Lead not found") {
          res.status(404).json({ error: message });
          return;
        }
        if (message === "Pipeline has no stages") {
          res.status(422).json({ error: message });
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
        action: "crm.lead_converted",
        entityType: "bos_lead",
        entityId: result.lead.id,
        details: { dealId: result.deal.id },
      });

      res.status(201).json(result);
    },
  );

  // ---------------------- Deals ----------------------
  router.get("/companies/:companyId/crm/deals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const pipelineId =
      typeof req.query.pipelineId === "string" ? req.query.pipelineId : null;

    const conditions = [eq(bosDeal.companyId, companyId)];
    if (pipelineId) {
      conditions.push(eq(bosDeal.pipelineId, pipelineId));
    }

    const rows = await db
      .select()
      .from(bosDeal)
      .where(and(...conditions))
      .orderBy(desc(bosDeal.createdAt));
    res.json({ deals: rows });
  });

  router.post(
    "/companies/:companyId/crm/deals",
    validate(dealCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof dealCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosDeal)
        .values({
          companyId,
          name: body.name,
          pipelineId: body.pipelineId ?? null,
          stageId: body.stageId ?? null,
          amountMinor: body.amountMinor,
          currency: body.currency,
          customerName: body.customerName ?? null,
          contactId: body.contactId ?? null,
          status: "open",
          expectedClose: toDate(body.expectedClose),
          ownerUserId: body.ownerUserId ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "crm.deal_created",
          entityType: "bos_deal",
          entityId: row.id,
          details: { name: row.name, amountMinor: row.amountMinor },
        });
      }

      res.status(201).json(row);
    },
  );

  router.post(
    "/companies/:companyId/crm/deals/:id/move",
    validate(moveSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;
      const body = req.body as z.infer<typeof moveSchema>;
      const actor = getActorInfo(req);

      let deal;
      try {
        deal = await moveDealStage(db, {
          companyId,
          dealId: id,
          stageId: body.stageId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Move failed";
        if (message === "Deal not found" || message === "Stage not found") {
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
        action: "crm.deal_moved",
        entityType: "bos_deal",
        entityId: deal.id,
        details: { stageId: deal.stageId, status: deal.status },
      });

      res.json(deal);
    },
  );

  // ---------------------- Activities ----------------------
  router.get("/companies/:companyId/crm/activities", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const relatedType =
      typeof req.query.relatedType === "string" ? req.query.relatedType : null;
    const relatedId =
      typeof req.query.relatedId === "string" ? req.query.relatedId : null;

    const conditions = [eq(bosActivity.companyId, companyId)];
    if (relatedType) {
      conditions.push(eq(bosActivity.relatedType, relatedType));
    }
    if (relatedId) {
      conditions.push(eq(bosActivity.relatedId, relatedId));
    }

    const rows = await db
      .select()
      .from(bosActivity)
      .where(and(...conditions))
      .orderBy(desc(bosActivity.createdAt));
    res.json({ activities: rows });
  });

  router.post(
    "/companies/:companyId/crm/activities",
    validate(activityCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof activityCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosActivity)
        .values({
          companyId,
          kind: body.kind ?? null,
          subject: body.subject ?? null,
          body: body.body ?? null,
          relatedType: body.relatedType ?? null,
          relatedId: body.relatedId ?? null,
          dueAt: toDate(body.dueAt),
          done: body.done,
          ownerUserId: body.ownerUserId ?? null,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "crm.activity_created",
          entityType: "bos_activity",
          entityId: row.id,
          details: { kind: row.kind, subject: row.subject },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Quotes ----------------------
  router.get("/companies/:companyId/crm/quotes", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosQuote)
      .where(eq(bosQuote.companyId, companyId))
      .orderBy(desc(bosQuote.createdAt));
    res.json({ quotes: rows });
  });

  router.post(
    "/companies/:companyId/crm/quotes",
    validate(quoteCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof quoteCreateSchema>;
      const actor = getActorInfo(req);

      const totals = quoteTotals(body.lines, body.taxRatePct);

      const [quote] = await db
        .insert(bosQuote)
        .values({
          companyId,
          number: body.number ?? null,
          dealId: body.dealId ?? null,
          customerName: body.customerName ?? null,
          lines: body.lines,
          subtotalMinor: totals.subtotal,
          taxMinor: totals.tax,
          totalMinor: totals.total,
          currency: body.currency,
          status: "draft",
          validUntil: toDate(body.validUntil),
        })
        .returning();

      if (!quote) {
        res.status(500).json({ error: "Failed to create quote" });
        return;
      }

      if (body.lines.length > 0) {
        await db.insert(bosQuoteLine).values(
          body.lines.map((line) => ({
            companyId,
            quoteId: quote.id,
            description: line.description ?? null,
            qty: line.qty,
            unitPriceMinor: line.unitPriceMinor,
            lineTotalMinor: quoteLineTotal(line),
          })),
        );
      }

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "crm.quote_created",
        entityType: "bos_quote",
        entityId: quote.id,
        details: { totalMinor: quote.totalMinor, currency: quote.currency },
      });

      res.status(201).json(quote);
    },
  );

  router.post(
    "/companies/:companyId/crm/quotes/:id/accept",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;
      const actor = getActorInfo(req);

      let quote;
      try {
        quote = await acceptQuote(db, { companyId, quoteId: id });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Accept failed";
        if (message === "Quote not found") {
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
        action: "crm.quote_accepted",
        entityType: "bos_quote",
        entityId: quote.id,
        details: { status: quote.status },
      });

      res.json(quote);
    },
  );

  return router;
}
