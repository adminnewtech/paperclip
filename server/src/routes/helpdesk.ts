import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosTicket,
  bosTicketComment,
  bosSlaPolicy,
  bosKbArticle,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { computeSlaDue, resolveTicket } from "../services/helpdesk.js";

// ---------------------------------------------------------------------------
// Validation schemas.
// ---------------------------------------------------------------------------
const ticketCreateSchema = z.object({
  number: z.string().trim().max(100).optional().nullable(),
  subject: z.string().trim().max(1000).optional().nullable(),
  body: z.string().trim().max(20000).optional().nullable(),
  customerName: z.string().trim().max(500).optional().nullable(),
  customerEmail: z.string().trim().max(500).optional().nullable(),
  channel: z
    .enum(["email", "chat", "phone", "whatsapp", "web"])
    .optional()
    .default("email"),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium"),
  slaPolicyId: z.string().uuid().optional().nullable(),
  assigneeUserId: z.string().trim().max(255).optional().nullable(),
});

const commentCreateSchema = z.object({
  author: z.string().trim().max(255).optional().nullable(),
  body: z.string().trim().min(1).max(20000),
  internal: z.boolean().optional().default(false),
});

const slaPolicyCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  firstResponseMins: z.number().int().positive().optional().default(60),
  resolutionMins: z.number().int().positive().optional().default(1440),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium"),
});

const kbArticleCreateSchema = z.object({
  title: z.string().trim().min(1).max(1000),
  slug: z.string().trim().max(500).optional().nullable(),
  body: z.string().trim().max(100000).optional().nullable(),
  category: z.string().trim().max(255).optional().nullable(),
  published: z.boolean().optional().default(false),
});

export function helpdeskRoutes(db: Db) {
  const router = Router();

  // ---------------------- Tickets ----------------------
  router.get("/companies/:companyId/helpdesk/tickets", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosTicket)
      .where(eq(bosTicket.companyId, companyId))
      .orderBy(desc(bosTicket.createdAt));
    res.json({ tickets: rows });
  });

  router.post(
    "/companies/:companyId/helpdesk/tickets",
    validate(ticketCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof ticketCreateSchema>;
      const actor = getActorInfo(req);

      let slaDueAt: Date | null = null;
      if (body.slaPolicyId) {
        const [policy] = await db
          .select()
          .from(bosSlaPolicy)
          .where(
            and(
              eq(bosSlaPolicy.id, body.slaPolicyId),
              eq(bosSlaPolicy.companyId, companyId),
            ),
          );
        if (policy) {
          slaDueAt = computeSlaDue(new Date(), policy);
        }
      }

      const [row] = await db
        .insert(bosTicket)
        .values({
          companyId,
          number: body.number ?? null,
          subject: body.subject ?? null,
          body: body.body ?? null,
          customerName: body.customerName ?? null,
          customerEmail: body.customerEmail ?? null,
          channel: body.channel,
          priority: body.priority,
          status: "open",
          slaPolicyId: body.slaPolicyId ?? null,
          assigneeUserId: body.assigneeUserId ?? null,
          slaDueAt,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "helpdesk.ticket_created",
          entityType: "bos_ticket",
          entityId: row.id,
          details: { priority: row.priority, channel: row.channel },
        });
      }

      res.status(201).json(row);
    },
  );

  router.post(
    "/companies/:companyId/helpdesk/tickets/:id/comments",
    validate(commentCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const ticketId = req.params.id as string;
      const body = req.body as z.infer<typeof commentCreateSchema>;
      const actor = getActorInfo(req);

      const [ticket] = await db
        .select()
        .from(bosTicket)
        .where(and(eq(bosTicket.id, ticketId), eq(bosTicket.companyId, companyId)));
      if (!ticket) {
        res.status(404).json({ error: "Ticket not found" });
        return;
      }

      const [row] = await db
        .insert(bosTicketComment)
        .values({
          companyId,
          ticketId,
          author: body.author ?? null,
          body: body.body,
          internal: body.internal,
        })
        .returning();

      // Stamp first response time when a public reply arrives.
      if (!body.internal && !ticket.firstResponseAt) {
        await db
          .update(bosTicket)
          .set({ firstResponseAt: new Date(), updatedAt: new Date() })
          .where(eq(bosTicket.id, ticketId));
      }

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "helpdesk.ticket_comment_added",
          entityType: "bos_ticket",
          entityId: ticketId,
          details: { internal: row.internal },
        });
      }

      res.status(201).json(row);
    },
  );

  router.get(
    "/companies/:companyId/helpdesk/tickets/:id/comments",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const ticketId = req.params.id as string;
      const rows = await db
        .select()
        .from(bosTicketComment)
        .where(
          and(
            eq(bosTicketComment.ticketId, ticketId),
            eq(bosTicketComment.companyId, companyId),
          ),
        )
        .orderBy(desc(bosTicketComment.createdAt));
      res.json({ comments: rows });
    },
  );

  router.post(
    "/companies/:companyId/helpdesk/tickets/:id/resolve",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const ticketId = req.params.id as string;
      const actor = getActorInfo(req);

      let ticket;
      try {
        ticket = await resolveTicket(db, { companyId, ticketId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Resolve failed";
        if (message === "Ticket not found") {
          res.status(404).json({ error: message });
          return;
        }
        if (message.startsWith("Cannot resolve")) {
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
        action: "helpdesk.ticket_resolved",
        entityType: "bos_ticket",
        entityId: ticket.id,
        details: { resolvedAt: ticket.resolvedAt },
      });

      res.json(ticket);
    },
  );

  // ---------------------- SLA policies ----------------------
  router.get("/companies/:companyId/helpdesk/sla-policies", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosSlaPolicy)
      .where(eq(bosSlaPolicy.companyId, companyId))
      .orderBy(desc(bosSlaPolicy.createdAt));
    res.json({ slaPolicies: rows });
  });

  router.post(
    "/companies/:companyId/helpdesk/sla-policies",
    validate(slaPolicyCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof slaPolicyCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosSlaPolicy)
        .values({
          companyId,
          name: body.name,
          firstResponseMins: body.firstResponseMins,
          resolutionMins: body.resolutionMins,
          priority: body.priority,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "helpdesk.sla_policy_created",
          entityType: "bos_sla_policy",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Knowledge base ----------------------
  router.get("/companies/:companyId/helpdesk/kb-articles", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosKbArticle)
      .where(eq(bosKbArticle.companyId, companyId))
      .orderBy(desc(bosKbArticle.createdAt));
    res.json({ kbArticles: rows });
  });

  router.post(
    "/companies/:companyId/helpdesk/kb-articles",
    validate(kbArticleCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof kbArticleCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosKbArticle)
        .values({
          companyId,
          title: body.title,
          slug: body.slug ?? null,
          body: body.body ?? null,
          category: body.category ?? null,
          published: body.published,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "helpdesk.kb_article_created",
          entityType: "bos_kb_article",
          entityId: row.id,
          details: { title: row.title, published: row.published },
        });
      }

      res.status(201).json(row);
    },
  );

  return router;
}
