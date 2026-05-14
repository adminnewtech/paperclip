import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { MESSAGE_TEMPLATES } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import {
  createBusinessMessagingService,
  type MessageChannel,
} from "../services/business-messaging-service.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const channelSchema = z.enum(["whatsapp", "sms"]);

const phoneSchema = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .regex(/^\+?[0-9 \-()]+$/, "Phone must be in E.164-ish format (digits, +, -)");

const sendMessageSchema = z.object({
  channel: channelSchema,
  toPhone: phoneSchema,
  body: z.string().trim().min(1).max(4096),
  templateKey: z.string().trim().min(1).max(100).optional(),
  variables: z.record(z.string(), z.string()).optional(),
  relatedEntityId: z.string().uuid().optional(),
});

const sendTemplateSchema = z.object({
  templateKey: z.string().trim().min(1).max(100),
  channel: channelSchema,
  toPhone: phoneSchema,
  variables: z.record(z.string(), z.string()).default({}),
  relatedEntityId: z.string().uuid().optional(),
  lang: z.enum(["ar", "en"]).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function businessMessagingRoutes(db: Db) {
  const router = Router();
  const service = createBusinessMessagingService(db);

  // GET /companies/:companyId/business/messaging/templates
  router.get(
    "/companies/:companyId/business/messaging/templates",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.json({
        templates: MESSAGE_TEMPLATES,
        providerStatus: service.getProviderStatus(),
      });
    },
  );

  // POST /companies/:companyId/business/messaging/send
  router.post(
    "/companies/:companyId/business/messaging/send",
    validate(sendMessageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof sendMessageSchema>;
      const result = await service.send(companyId, {
        channel: body.channel as MessageChannel,
        toPhone: body.toPhone,
        body: body.body,
        templateKey: body.templateKey,
        variables: body.variables,
        relatedEntityId: body.relatedEntityId,
      });
      res.status(result.ok ? 200 : 502).json(result);
    },
  );

  // POST /companies/:companyId/business/messaging/send-template
  router.post(
    "/companies/:companyId/business/messaging/send-template",
    validate(sendTemplateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof sendTemplateSchema>;
      const result = await service.sendTemplate(companyId, body.templateKey, {
        channel: body.channel as MessageChannel,
        toPhone: body.toPhone,
        variables: body.variables,
        relatedEntityId: body.relatedEntityId,
        lang: body.lang,
      });
      res.status(result.ok ? 200 : 502).json(result);
    },
  );

  // GET /companies/:companyId/business/messaging/messages
  router.get(
    "/companies/:companyId/business/messaging/messages",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const limitRaw = req.query.limit;
      const limit =
        typeof limitRaw === "string" ? Math.max(1, Number(limitRaw) || 200) : 200;
      const relatedEntityId =
        typeof req.query.relatedEntityId === "string"
          ? req.query.relatedEntityId
          : undefined;
      const messages = await service.listMessages(companyId, {
        limit,
        relatedEntityId,
      });
      res.json({ messages });
    },
  );

  // GET /companies/:companyId/business/messaging/messages/:id
  router.get(
    "/companies/:companyId/business/messaging/messages/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const message = await service.getMessage(companyId, id);
      if (!message) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(message);
    },
  );

  return router;
}
