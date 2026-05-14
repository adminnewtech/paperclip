// ---------------------------------------------------------------------------
// WhatsApp admin routes
// ---------------------------------------------------------------------------
//
// Authenticated, company-scoped endpoints for:
//   - Template list / create / delete
//   - Business profile read / update
//   - Inbox conversation list / thread / reply / mark-as-read
//   - WhatsApp config + webhook URL (env status indicators)
//
// All endpoints sit under `/api` (auth-protected) and gate on
// `assertCompanyAccess`. The webhook receiver itself lives separately at
// `/api/public/webhooks/whatsapp` (see whatsapp-webhook.ts).

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  getWhatsappCloudService,
  type WhatsappTemplateComponent,
} from "../services/whatsapp-cloud-service.js";
import { createWhatsappInboxService } from "../services/whatsapp-inbox-service.js";
import type { BusinessStreamService } from "../services/business-stream-service.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const buttonSchema = z.object({
  type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
  text: z.string().min(1).max(60),
  url: z.string().url().max(2000).optional(),
  phone_number: z.string().max(32).optional(),
});

const componentSchema = z.object({
  type: z.enum(["HEADER", "BODY", "FOOTER", "BUTTONS"]),
  format: z.enum(["TEXT", "IMAGE", "DOCUMENT", "VIDEO"]).optional(),
  text: z.string().max(4096).optional(),
  example: z
    .object({
      header_text: z.array(z.string()).optional(),
      body_text: z.array(z.array(z.string())).optional(),
    })
    .optional(),
  buttons: z.array(buttonSchema).optional(),
});

const createTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits, and underscores only"),
  language: z.string().trim().min(2).max(10),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  components: z.array(componentSchema).min(1),
});

const updateProfileSchema = z.object({
  about: z.string().max(139).optional(),
  address: z.string().max(256).optional(),
  description: z.string().max(512).optional(),
  email: z.string().email().max(128).optional(),
  websites: z.array(z.string().url().max(256)).max(2).optional(),
  vertical: z.string().max(64).optional(),
});

const sendReplySchema = z.object({
  text: z.string().trim().min(1).max(4096),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function whatsappAdminRoutes(
  db: Db,
  streamService?: BusinessStreamService,
) {
  const router = Router();
  const cloud = getWhatsappCloudService();
  const inbox = createWhatsappInboxService(db, {
    streamService,
    cloudService: cloud,
  });

  // ---------- Config status ----------
  router.get(
    "/companies/:companyId/business/whatsapp/config",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const summary = cloud.getConfigSummary();
      const proto =
        (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
      const host = req.headers.host ?? "localhost";
      const webhookUrl = `${proto}://${host}/api/public/webhooks/whatsapp`;
      res.json({
        ...summary,
        webhookUrl,
      });
    },
  );

  // ---------- Templates ----------
  router.get(
    "/companies/:companyId/business/whatsapp/templates",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const templates = await cloud.listTemplates();
        res.json({ templates, configured: cloud.isConfigured() });
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Failed to list templates",
        });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/whatsapp/templates",
    validate(createTemplateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof createTemplateSchema>;
      try {
        const created = await cloud.createTemplate({
          name: body.name,
          language: body.language,
          category: body.category,
          components: body.components as WhatsappTemplateComponent[],
        });
        res.status(201).json({ template: created });
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Failed to create template",
        });
      }
    },
  );

  router.delete(
    "/companies/:companyId/business/whatsapp/templates/:name",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const name = req.params.name as string;
      assertCompanyAccess(req, companyId);
      try {
        await cloud.deleteTemplate(name);
        res.json({ ok: true });
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Failed to delete template",
        });
      }
    },
  );

  // ---------- Business profile ----------
  router.get(
    "/companies/:companyId/business/whatsapp/profile",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const profile = await cloud.getBusinessProfile();
        res.json({ profile });
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Failed to load profile",
        });
      }
    },
  );

  router.put(
    "/companies/:companyId/business/whatsapp/profile",
    validate(updateProfileSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof updateProfileSchema>;
      try {
        await cloud.updateBusinessProfile(body);
        const profile = await cloud.getBusinessProfile();
        res.json({ profile });
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Failed to update profile",
        });
      }
    },
  );

  // ---------- Inbox ----------
  router.get(
    "/companies/:companyId/business/whatsapp/conversations",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const limit =
        typeof req.query.limit === "string"
          ? Math.max(1, Math.min(500, Number(req.query.limit) || 100))
          : 100;
      const conversations = await inbox.listConversations(companyId, {
        status,
        limit,
      });
      res.json({ conversations });
    },
  );

  router.get(
    "/companies/:companyId/business/whatsapp/conversations/:contactId/messages",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const contactId = req.params.contactId as string;
      assertCompanyAccess(req, companyId);
      const limit =
        typeof req.query.limit === "string"
          ? Math.max(1, Math.min(1000, Number(req.query.limit) || 200))
          : 200;
      const before =
        typeof req.query.before === "string" ? req.query.before : undefined;
      const messages = await inbox.getThread(companyId, contactId, {
        limit,
        before,
      });
      res.json({ messages });
    },
  );

  router.post(
    "/companies/:companyId/business/whatsapp/conversations/:contactId/reply",
    validate(sendReplySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const contactId = req.params.contactId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof sendReplySchema>;
      const actor = getActorInfo(req);
      try {
        const message = await inbox.sendReply(
          companyId,
          contactId,
          body.text,
          actor.actorId,
        );
        res.json({ message });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to send reply",
        });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/whatsapp/conversations/:contactId/read",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const contactId = req.params.contactId as string;
      assertCompanyAccess(req, companyId);
      await inbox.markAsRead(companyId, contactId);
      res.json({ ok: true });
    },
  );

  return router;
}
