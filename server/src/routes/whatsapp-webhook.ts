// ---------------------------------------------------------------------------
// WhatsApp Business Cloud API — public webhook receiver
// ---------------------------------------------------------------------------
//
// Two endpoints, both UNAUTHENTICATED (Meta calls them with no credentials).
// Mounted BEFORE the auth-protected /api router so the actorMiddleware never
// rejects valid Meta requests.
//
//   GET  /api/public/webhooks/whatsapp   verification challenge
//   POST /api/public/webhooks/whatsapp   event delivery
//
// The POST endpoint MUST validate the `x-hub-signature-256` header, which is
// `sha256=<hex>` of an HMAC-SHA256 over the *raw* request body with the
// configured WHATSAPP_APP_SECRET as the key. Without raw bytes the hash
// cannot match, so we rely on the rawBody buffer captured by the express.json
// verify hook in app.ts.

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { getWhatsappCloudService } from "../services/whatsapp-cloud-service.js";
import { createWhatsappInboxService } from "../services/whatsapp-inbox-service.js";
import type { BusinessStreamService } from "../services/business-stream-service.js";
import { logger } from "../middleware/logger.js";

export function whatsappWebhookRoutes(
  db: Db,
  streamService?: BusinessStreamService,
) {
  const router = Router();
  const cloud = getWhatsappCloudService();
  const inbox = createWhatsappInboxService(db, {
    streamService,
    cloudService: cloud,
  });

  // GET handshake — Meta sends ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
  router.get("/webhooks/whatsapp", (req, res) => {
    const mode =
      typeof req.query["hub.mode"] === "string"
        ? (req.query["hub.mode"] as string)
        : undefined;
    const verifyToken =
      typeof req.query["hub.verify_token"] === "string"
        ? (req.query["hub.verify_token"] as string)
        : undefined;
    const challenge =
      typeof req.query["hub.challenge"] === "string"
        ? (req.query["hub.challenge"] as string)
        : undefined;
    const accepted = cloud.verifyWebhookSubscription(
      mode,
      verifyToken,
      challenge,
    );
    if (accepted === null) {
      res.status(403).send("forbidden");
      return;
    }
    res.status(200).type("text/plain").send(accepted);
  });

  // POST event delivery
  router.post("/webhooks/whatsapp", async (req, res) => {
    const signature =
      typeof req.headers["x-hub-signature-256"] === "string"
        ? (req.headers["x-hub-signature-256"] as string)
        : undefined;
    const rawBody =
      (req as unknown as { rawBody?: Buffer }).rawBody ??
      Buffer.from(JSON.stringify(req.body ?? {}));
    const valid = cloud.validateWebhookSignature(rawBody, signature);
    if (!valid) {
      logger.warn(
        { hasSignature: !!signature },
        "[whatsapp] webhook signature invalid",
      );
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const event = cloud.parseWebhookEvent(req.body);

    // Always 200 quickly so Meta does not retry — we ingest async.
    res.status(200).json({ ok: true });

    // Best-effort ingestion (do not await before responding)
    (async () => {
      try {
        if (event.type === "message" && event.messages) {
          const companyId = await inbox.resolveCompanyForPhoneNumberId(
            event.phoneNumberId,
          );
          for (const msg of event.messages) {
            await inbox.handleIncomingMessage(companyId, msg);
          }
        } else if (event.type === "status" && event.statuses) {
          for (const st of event.statuses) {
            await inbox.handleStatusUpdate(st.id, st.status, st.errorMessage);
          }
        } else if (event.type === "template_status" && event.template) {
          logger.info(
            { template: event.template },
            "[whatsapp] template status update",
          );
        }
      } catch (err) {
        logger.error({ err }, "[whatsapp] webhook ingestion failed");
      }
    })().catch(() => {});
  });

  return router;
}
