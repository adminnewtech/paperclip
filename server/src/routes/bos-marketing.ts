import { Router } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bosCampaign,
  bosAudience,
  bosEmailTemplate,
  bosJourney,
} from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { sendCampaign } from "../services/bos-marketing.js";

// ---------------------------------------------------------------------------
// Validation schemas.
// ---------------------------------------------------------------------------
const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  channel: z
    .enum(["email", "sms", "whatsapp", "social"])
    .optional()
    .default("email"),
  status: z
    .enum(["draft", "scheduled", "sending", "sent", "paused"])
    .optional()
    .default("draft"),
  audienceId: z.string().uuid().optional().nullable(),
  templateId: z.string().uuid().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  budgetMinor: z.number().int().nonnegative().optional().default(0),
});

const audienceCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5000).optional().nullable(),
  filter: z.record(z.unknown()).optional().default({}),
  memberCount: z.number().int().nonnegative().optional().default(0),
});

const emailTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  subject: z.string().trim().max(1000).optional().nullable(),
  body: z.string().max(100000).optional().nullable(),
  kind: z.string().trim().max(100).optional().default("campaign"),
});

const journeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  trigger: z.string().trim().max(500).optional().nullable(),
  nodes: z.array(z.unknown()).optional().default([]),
  enabled: z.boolean().optional().default(false),
  version: z.number().int().positive().optional().default(1),
});

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

export function marketingRoutes(db: Db) {
  const router = Router();

  // ---------------------- Campaigns ----------------------
  router.get("/companies/:companyId/marketing/campaigns", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosCampaign)
      .where(eq(bosCampaign.companyId, companyId))
      .orderBy(desc(bosCampaign.createdAt));
    res.json({ campaigns: rows });
  });

  router.post(
    "/companies/:companyId/marketing/campaigns",
    validate(campaignCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof campaignCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosCampaign)
        .values({
          companyId,
          name: body.name,
          channel: body.channel,
          status: body.status,
          audienceId: body.audienceId ?? null,
          templateId: body.templateId ?? null,
          scheduledAt: toDate(body.scheduledAt),
          budgetMinor: body.budgetMinor,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "marketing.campaign_created",
          entityType: "bos_campaign",
          entityId: row.id,
          details: { name: row.name, channel: row.channel },
        });
      }

      res.status(201).json(row);
    },
  );

  router.post(
    "/companies/:companyId/marketing/campaigns/:id/send",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;
      const actor = getActorInfo(req);

      let campaign;
      try {
        campaign = await sendCampaign(db, { companyId, campaignId: id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Send failed";
        if (message === "Campaign not found") {
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
        action: "marketing.campaign_sent",
        entityType: "bos_campaign",
        entityId: campaign.id,
        details: { sentCount: campaign.sentCount },
      });

      res.json(campaign);
    },
  );

  // ---------------------- Audiences ----------------------
  router.get("/companies/:companyId/marketing/audiences", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosAudience)
      .where(eq(bosAudience.companyId, companyId))
      .orderBy(desc(bosAudience.createdAt));
    res.json({ audiences: rows });
  });

  router.post(
    "/companies/:companyId/marketing/audiences",
    validate(audienceCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof audienceCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosAudience)
        .values({
          companyId,
          name: body.name,
          description: body.description ?? null,
          filter: body.filter,
          memberCount: body.memberCount,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "marketing.audience_created",
          entityType: "bos_audience",
          entityId: row.id,
          details: { name: row.name, memberCount: row.memberCount },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Email templates ----------------------
  router.get(
    "/companies/:companyId/marketing/email-templates",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db
        .select()
        .from(bosEmailTemplate)
        .where(eq(bosEmailTemplate.companyId, companyId))
        .orderBy(desc(bosEmailTemplate.createdAt));
      res.json({ emailTemplates: rows });
    },
  );

  router.post(
    "/companies/:companyId/marketing/email-templates",
    validate(emailTemplateCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof emailTemplateCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosEmailTemplate)
        .values({
          companyId,
          name: body.name,
          subject: body.subject ?? null,
          body: body.body ?? null,
          kind: body.kind,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "marketing.email_template_created",
          entityType: "bos_email_template",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  // ---------------------- Journeys ----------------------
  router.get("/companies/:companyId/marketing/journeys", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select()
      .from(bosJourney)
      .where(eq(bosJourney.companyId, companyId))
      .orderBy(desc(bosJourney.createdAt));
    res.json({ journeys: rows });
  });

  router.post(
    "/companies/:companyId/marketing/journeys",
    validate(journeyCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof journeyCreateSchema>;
      const actor = getActorInfo(req);

      const [row] = await db
        .insert(bosJourney)
        .values({
          companyId,
          name: body.name,
          trigger: body.trigger ?? null,
          nodes: body.nodes,
          enabled: body.enabled,
          version: body.version,
        })
        .returning();

      if (row) {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "marketing.journey_created",
          entityType: "bos_journey",
          entityId: row.id,
          details: { name: row.name },
        });
      }

      res.status(201).json(row);
    },
  );

  return router;
}
