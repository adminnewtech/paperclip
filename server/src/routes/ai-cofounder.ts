import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  createAiCofounderService,
  type AiCofounderService,
} from "../services/ai-cofounder/index.js";
import { getWhatsappCloudService } from "../services/whatsapp-cloud-service.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const langSchema = z.enum(["ar", "en"]);

const messageSchema = z.object({
  text: z.string().trim().min(1).max(8000),
  userPhone: z.string().trim().optional(),
  lang: langSchema.optional(),
});

const registerOwnerSchema = z.object({
  userPhone: z.string().trim().min(4).max(40),
  userUserId: z.string().trim().optional(),
  lang: langSchema.optional(),
  dailyBriefEnabled: z.boolean().optional(),
  weeklyReportEnabled: z.boolean().optional(),
  briefTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});

const updateOwnerSchema = z.object({
  lang: langSchema.optional(),
  dailyBriefEnabled: z.boolean().optional(),
  weeklyReportEnabled: z.boolean().optional(),
  briefTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export interface AiCofounderRoutesDeps {
  service?: AiCofounderService;
}

export function aiCofounderRoutes(
  db: Db,
  deps: AiCofounderRoutesDeps = {},
): { router: Router; service: AiCofounderService } {
  const service =
    deps.service ??
    createAiCofounderService(db, {
      whatsappService: getWhatsappCloudService(),
    });
  const router = Router();

  // -------------------------------------------------------------------------
  // POST /companies/:companyId/business/cofounder/message
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/cofounder/message",
    validate(messageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof messageSchema>;
      const actor = getActorInfo(req);
      // For web chat, default phone to user id-derived key. For WhatsApp, the
      // adapter will pass userPhone explicitly.
      const phone =
        body.userPhone ?? (actor.actorId ? `web-${actor.actorId}` : "web-anon");
      const result = await service.handleMessage(companyId, phone, body.text, {
        userUserId: actor.actorId ?? undefined,
        lang: body.lang,
      });
      res.json(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/cofounder/sessions
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/cofounder/sessions",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const sessions = await service.listSessions(companyId);
      res.json({
        sessions: sessions.map((s) => ({
          id: s.id,
          userPhone: s.userPhone,
          userUserId: s.userUserId,
          language: s.language,
          messageCount: s.messages.length,
          lastActivityAt: s.lastActivityAt,
          pendingConfirmation: s.pendingConfirmation,
        })),
      });
    },
  );

  router.get(
    "/companies/:companyId/business/cofounder/sessions/:userPhone",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const phone = decodeURIComponent(req.params.userPhone as string);
      const session = await service.getSession(companyId, phone);
      if (!session) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(session);
    },
  );

  router.delete(
    "/companies/:companyId/business/cofounder/sessions/:userPhone",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const phone = decodeURIComponent(req.params.userPhone as string);
      await service.clearSession(companyId, phone);
      res.status(204).end();
    },
  );

  // -------------------------------------------------------------------------
  // Owner phones
  // -------------------------------------------------------------------------

  router.get(
    "/companies/:companyId/business/cofounder/owner-phones",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const list = await service.listOwnerPhones(companyId);
      res.json({ items: list });
    },
  );

  router.post(
    "/companies/:companyId/business/cofounder/owner-phones",
    validate(registerOwnerSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof registerOwnerSchema>;
      await service.registerOwnerPhone(companyId, body.userPhone, {
        userUserId: body.userUserId,
        lang: body.lang,
        dailyBriefEnabled: body.dailyBriefEnabled,
        weeklyReportEnabled: body.weeklyReportEnabled,
        briefTime: body.briefTime,
      });
      const list = await service.listOwnerPhones(companyId);
      res.status(201).json({ items: list });
    },
  );

  router.patch(
    "/companies/:companyId/business/cofounder/owner-phones/:phone",
    validate(updateOwnerSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const phone = decodeURIComponent(req.params.phone as string);
      const body = req.body as z.infer<typeof updateOwnerSchema>;
      await service.updateOwnerPhoneState(companyId, phone, body);
      const list = await service.listOwnerPhones(companyId);
      res.json({ items: list });
    },
  );

  router.delete(
    "/companies/:companyId/business/cofounder/owner-phones/:phone",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const phone = decodeURIComponent(req.params.phone as string);
      await service.unregisterOwnerPhone(companyId, phone);
      res.status(204).end();
    },
  );

  // -------------------------------------------------------------------------
  // Proactive triggers (manual / test)
  // -------------------------------------------------------------------------

  router.post(
    "/companies/:companyId/business/cofounder/trigger-daily-brief/:userPhone",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const phone = decodeURIComponent(req.params.userPhone as string);
      const result = await service.sendDailyBrief(companyId, phone);
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/business/cofounder/trigger-weekly-report/:userPhone",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const phone = decodeURIComponent(req.params.userPhone as string);
      const result = await service.sendWeeklyReport(companyId, phone);
      res.json(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool catalog (for UI display)
  // -------------------------------------------------------------------------

  router.get(
    "/companies/:companyId/business/cofounder/tools",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.json({ tools: service.listTools() });
    },
  );

  return { router, service };
}
