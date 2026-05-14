// ---------------------------------------------------------------------------
// WhatsApp Business Cloud API client
// ---------------------------------------------------------------------------
//
// Production-ready client for Meta's WhatsApp Business Cloud API. Covers:
//   - Sending text, template, image, document, and interactive messages
//   - Uploading and downloading media
//   - Listing / creating / deleting message templates
//   - Reading and updating the business profile
//   - Verifying and parsing webhook events with HMAC signature validation
//
// All HTTP calls use native fetch (Node 18+) and surface clear errors. The
// service NEVER throws on missing env vars — `isConfigured()` returns false
// and methods return deterministic mock responses (with `[whatsapp] mock:`
// console logs) so the rest of the system stays usable in dev.
//
// Expected env vars:
//
//   WHATSAPP_BUSINESS_API_TOKEN     Long-lived system user access token
//   WHATSAPP_PHONE_NUMBER_ID        Phone-number ID from the WABA dashboard
//   WHATSAPP_BUSINESS_ACCOUNT_ID    WABA ID (optional; required for templates)
//   WHATSAPP_WEBHOOK_VERIFY_TOKEN   Token configured in Meta webhook setup
//   WHATSAPP_APP_SECRET             App secret for x-hub-signature-256 verify
//   WHATSAPP_GRAPH_API_VERSION      Optional; defaults to "v20.0"
//
// Reference docs:
//   https://developers.facebook.com/docs/whatsapp/cloud-api
//   https://developers.facebook.com/docs/graph-api/webhooks
//

import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsappCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string;
  graphApiVersion?: string;
  webhookVerifyToken?: string;
  appSecret?: string;
}

export type WhatsappMessageType =
  | "text"
  | "image"
  | "document"
  | "audio"
  | "video"
  | "location"
  | "contacts"
  | "button"
  | "interactive"
  | "reaction"
  | "template"
  | "sticker"
  | "unknown";

export type WhatsappMessageDirection = "inbound" | "outbound";

export type WhatsappMessageStatus = "sent" | "delivered" | "read" | "failed";

export interface WhatsappMessage {
  id: string;
  from: string;
  to: string;
  type: WhatsappMessageType;
  direction: WhatsappMessageDirection;
  content: Record<string, unknown>;
  timestamp: string;
  status?: WhatsappMessageStatus;
  errorCode?: number;
  errorMessage?: string;
}

export interface WhatsappTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO";
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][] };
  buttons?: Array<{
    type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
    text: string;
    url?: string;
    phone_number?: string;
  }>;
}

export interface WhatsappTemplate {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  components: WhatsappTemplateComponent[];
  status?: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED";
  id?: string;
  rejectedReason?: string;
}

export interface WhatsappBusinessProfile {
  name: string;
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  profilePicture?: string;
  vertical?: string;
}

export interface WhatsappWebhookStatus {
  id: string;
  status: WhatsappMessageStatus;
  recipient_id: string;
  timestamp: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface WhatsappWebhookEvent {
  type: "message" | "status" | "template_status" | "unknown";
  messages?: WhatsappMessage[];
  statuses?: WhatsappWebhookStatus[];
  template?: { name: string; status: string; reason?: string };
  phoneNumberId?: string;
  rawValue?: unknown;
}

export interface WhatsappCloudService {
  isConfigured(): boolean;
  getConfigSummary(): {
    configured: boolean;
    hasToken: boolean;
    hasPhoneNumberId: boolean;
    hasBusinessAccountId: boolean;
    hasWebhookVerifyToken: boolean;
    hasAppSecret: boolean;
    graphApiVersion: string;
  };
  sendText(to: string, text: string): Promise<WhatsappMessage>;
  sendTemplate(
    to: string,
    templateName: string,
    language: string,
    components?: WhatsappTemplateComponent[],
  ): Promise<WhatsappMessage>;
  sendImage(
    to: string,
    imageUrl: string,
    caption?: string,
  ): Promise<WhatsappMessage>;
  sendDocument(
    to: string,
    documentUrl: string,
    filename?: string,
    caption?: string,
  ): Promise<WhatsappMessage>;
  sendInteractive(to: string, payload: unknown): Promise<WhatsappMessage>;
  markMessageRead(messageId: string): Promise<void>;
  uploadMedia(file: Buffer, mimeType: string): Promise<{ id: string }>;
  getMediaUrl(mediaId: string): Promise<string>;
  downloadMedia(mediaUrl: string): Promise<Buffer>;
  listTemplates(): Promise<WhatsappTemplate[]>;
  createTemplate(
    template: Omit<WhatsappTemplate, "status" | "id">,
  ): Promise<WhatsappTemplate>;
  deleteTemplate(name: string): Promise<void>;
  getBusinessProfile(): Promise<WhatsappBusinessProfile>;
  updateBusinessProfile(updates: Record<string, unknown>): Promise<void>;
  verifyWebhookSubscription(
    mode: string | undefined,
    verifyToken: string | undefined,
    challenge: string | undefined,
  ): string | null;
  validateWebhookSignature(rawBody: string | Buffer, signature: string | undefined): boolean;
  parseWebhookEvent(body: unknown): WhatsappWebhookEvent;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logMock(action: string, payload: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[whatsapp] mock: ${action}`, payload);
}

function logWarn(message: string, payload?: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(`[whatsapp] ${message}`, payload ?? "");
}

function normalizePhone(phone: string): string {
  // Meta expects E.164 *without* the leading "+" in the to field.
  return phone.replace(/^\+/, "").replace(/[^0-9]/g, "");
}

function nowIsoSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function classifyMessageType(t: string | undefined): WhatsappMessageType {
  switch (t) {
    case "text":
    case "image":
    case "document":
    case "audio":
    case "video":
    case "location":
    case "contacts":
    case "button":
    case "interactive":
    case "reaction":
    case "template":
    case "sticker":
      return t;
    default:
      return "unknown";
  }
}

function classifyStatus(s: string | undefined): WhatsappMessageStatus | undefined {
  if (s === "sent" || s === "delivered" || s === "read" || s === "failed") {
    return s;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Mock service — returned when env vars are not present
// ---------------------------------------------------------------------------

function createMockService(reason: string): WhatsappCloudService {
  function mockMessage(
    to: string,
    type: WhatsappMessageType,
    content: Record<string, unknown>,
  ): WhatsappMessage {
    const id = `mock_wa_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
    return {
      id,
      from: "mock",
      to,
      type,
      direction: "outbound",
      content,
      timestamp: nowIsoSeconds(),
      status: "sent",
    };
  }

  return {
    isConfigured() {
      return false;
    },
    getConfigSummary() {
      return {
        configured: false,
        hasToken: !!process.env.WHATSAPP_BUSINESS_API_TOKEN,
        hasPhoneNumberId: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
        hasBusinessAccountId: !!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        hasWebhookVerifyToken: !!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
        hasAppSecret: !!process.env.WHATSAPP_APP_SECRET,
        graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0",
      };
    },
    async sendText(to, text) {
      logMock("sendText", { reason, to, text });
      return mockMessage(to, "text", { body: text });
    },
    async sendTemplate(to, templateName, language, components) {
      logMock("sendTemplate", { reason, to, templateName, language, components });
      return mockMessage(to, "template", { templateName, language, components });
    },
    async sendImage(to, imageUrl, caption) {
      logMock("sendImage", { reason, to, imageUrl, caption });
      return mockMessage(to, "image", { link: imageUrl, caption });
    },
    async sendDocument(to, documentUrl, filename, caption) {
      logMock("sendDocument", { reason, to, documentUrl, filename, caption });
      return mockMessage(to, "document", { link: documentUrl, filename, caption });
    },
    async sendInteractive(to, payload) {
      logMock("sendInteractive", { reason, to, payload });
      return mockMessage(to, "interactive", asObject(payload));
    },
    async markMessageRead(messageId) {
      logMock("markMessageRead", { reason, messageId });
    },
    async uploadMedia(_file, mimeType) {
      logMock("uploadMedia", { reason, mimeType });
      return { id: `mock_media_${Date.now()}` };
    },
    async getMediaUrl(mediaId) {
      logMock("getMediaUrl", { reason, mediaId });
      return `https://mock.whatsapp.local/media/${mediaId}`;
    },
    async downloadMedia(mediaUrl) {
      logMock("downloadMedia", { reason, mediaUrl });
      return Buffer.from("mock-media-bytes");
    },
    async listTemplates() {
      logMock("listTemplates", { reason });
      return [];
    },
    async createTemplate(template) {
      logMock("createTemplate", { reason, template });
      return { ...template, status: "PENDING" as const };
    },
    async deleteTemplate(name) {
      logMock("deleteTemplate", { reason, name });
    },
    async getBusinessProfile() {
      logMock("getBusinessProfile", { reason });
      return { name: "Mock Business" };
    },
    async updateBusinessProfile(updates) {
      logMock("updateBusinessProfile", { reason, updates });
    },
    verifyWebhookSubscription(mode, verifyToken, challenge) {
      // In mock mode allow any verify token, as long as the shape is right.
      if (mode === "subscribe" && challenge && verifyToken) {
        return challenge;
      }
      return null;
    },
    validateWebhookSignature() {
      // Cannot verify without app secret. We allow events through but log.
      logWarn("validateWebhookSignature called in mock mode — accepting", null);
      return true;
    },
    parseWebhookEvent(body) {
      return parseWebhookEventBody(body);
    },
  };
}

// ---------------------------------------------------------------------------
// Real service factory
// ---------------------------------------------------------------------------

export function createWhatsappCloudService(
  config: WhatsappCloudConfig,
): WhatsappCloudService {
  const version = config.graphApiVersion ?? "v20.0";
  const base = `https://graph.facebook.com/${version}`;
  const phoneNumberId = config.phoneNumberId;
  const accessToken = config.accessToken;
  const businessAccountId = config.businessAccountId;
  const verifyToken = config.webhookVerifyToken;
  const appSecret = config.appSecret;

  async function graphFetch<T>(
    path: string,
    init?: RequestInit & { rawBody?: Buffer },
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const headers = new Headers(init?.headers ?? undefined);
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
    if (init?.body && !headers.has("Content-Type") && !init.rawBody) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(url, { ...init, headers });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!res.ok) {
      const errObj =
        (asObject(json).error as Record<string, unknown> | undefined) ?? {};
      const msg =
        asString(errObj.message) ??
        (typeof json === "string" ? json : `HTTP ${res.status}`);
      const err = new Error(`[whatsapp] ${msg}`);
      (err as Error & { details?: unknown; status?: number }).details = json;
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return json as T;
  }

  async function sendMessageEnvelope(
    to: string,
    body: Record<string, unknown>,
  ): Promise<WhatsappMessage> {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(to),
      ...body,
    };
    const json = await graphFetch<{
      messages?: Array<{ id?: string }>;
      contacts?: Array<{ wa_id?: string }>;
    }>(`/${phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const id = json?.messages?.[0]?.id ?? "";
    return {
      id,
      from: phoneNumberId,
      to: normalizePhone(to),
      type: (body.type as WhatsappMessageType | undefined) ?? "text",
      direction: "outbound",
      content: body,
      timestamp: nowIsoSeconds(),
      status: "sent",
    };
  }

  return {
    isConfigured() {
      return true;
    },
    getConfigSummary() {
      return {
        configured: true,
        hasToken: true,
        hasPhoneNumberId: true,
        hasBusinessAccountId: !!businessAccountId,
        hasWebhookVerifyToken: !!verifyToken,
        hasAppSecret: !!appSecret,
        graphApiVersion: version,
      };
    },

    async sendText(to, text) {
      return sendMessageEnvelope(to, {
        type: "text",
        text: { preview_url: false, body: text },
      });
    },

    async sendTemplate(to, templateName, language, components) {
      return sendMessageEnvelope(to, {
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          ...(components && components.length > 0 ? { components } : {}),
        },
      });
    },

    async sendImage(to, imageUrl, caption) {
      return sendMessageEnvelope(to, {
        type: "image",
        image: { link: imageUrl, ...(caption ? { caption } : {}) },
      });
    },

    async sendDocument(to, documentUrl, filename, caption) {
      return sendMessageEnvelope(to, {
        type: "document",
        document: {
          link: documentUrl,
          ...(filename ? { filename } : {}),
          ...(caption ? { caption } : {}),
        },
      });
    },

    async sendInteractive(to, payload) {
      return sendMessageEnvelope(to, {
        type: "interactive",
        interactive: payload,
      });
    },

    async markMessageRead(messageId) {
      await graphFetch<unknown>(`/${phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }),
      });
    },

    async uploadMedia(file, mimeType) {
      // Meta media upload uses multipart/form-data.
      const form = new FormData();
      const blob = new Blob([new Uint8Array(file)], { type: mimeType });
      form.set("messaging_product", "whatsapp");
      form.set("type", mimeType);
      form.set("file", blob, "upload");
      const res = await fetch(`${base}/${phoneNumberId}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const json = (await res.json().catch(() => null)) as
        | { id?: string; error?: { message?: string } }
        | null;
      if (!res.ok || !json?.id) {
        throw new Error(
          `[whatsapp] uploadMedia failed: ${json?.error?.message ?? res.status}`,
        );
      }
      return { id: json.id };
    },

    async getMediaUrl(mediaId) {
      const json = await graphFetch<{ url?: string }>(`/${mediaId}`);
      if (!json.url) {
        throw new Error("[whatsapp] getMediaUrl: no url in response");
      }
      return json.url;
    },

    async downloadMedia(mediaUrl) {
      const res = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`[whatsapp] downloadMedia failed: HTTP ${res.status}`);
      }
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    },

    async listTemplates() {
      if (!businessAccountId) {
        logWarn("listTemplates: WHATSAPP_BUSINESS_ACCOUNT_ID not set");
        return [];
      }
      const json = await graphFetch<{
        data?: Array<{
          id?: string;
          name?: string;
          language?: string;
          category?: string;
          status?: string;
          rejected_reason?: string;
          components?: WhatsappTemplateComponent[];
        }>;
      }>(`/${businessAccountId}/message_templates?limit=200`);
      return (json.data ?? []).map((t) => ({
        id: t.id,
        name: t.name ?? "",
        language: t.language ?? "en",
        category: (t.category as WhatsappTemplate["category"]) ?? "UTILITY",
        components: t.components ?? [],
        status: t.status as WhatsappTemplate["status"] | undefined,
        rejectedReason: t.rejected_reason,
      }));
    },

    async createTemplate(template) {
      if (!businessAccountId) {
        throw new Error(
          "[whatsapp] createTemplate requires WHATSAPP_BUSINESS_ACCOUNT_ID",
        );
      }
      const json = await graphFetch<{
        id?: string;
        status?: string;
        category?: string;
      }>(`/${businessAccountId}/message_templates`, {
        method: "POST",
        body: JSON.stringify({
          name: template.name,
          language: template.language,
          category: template.category,
          components: template.components,
        }),
      });
      return {
        ...template,
        id: json.id,
        status: (json.status as WhatsappTemplate["status"]) ?? "PENDING",
      };
    },

    async deleteTemplate(name) {
      if (!businessAccountId) {
        throw new Error(
          "[whatsapp] deleteTemplate requires WHATSAPP_BUSINESS_ACCOUNT_ID",
        );
      }
      await graphFetch<unknown>(
        `/${businessAccountId}/message_templates?name=${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
    },

    async getBusinessProfile() {
      const fields =
        "about,address,description,email,profile_picture_url,websites,vertical";
      const json = await graphFetch<{
        data?: Array<{
          about?: string;
          address?: string;
          description?: string;
          email?: string;
          profile_picture_url?: string;
          websites?: string[];
          vertical?: string;
        }>;
      }>(`/${phoneNumberId}/whatsapp_business_profile?fields=${fields}`);
      const profile = json.data?.[0] ?? {};
      return {
        name: phoneNumberId,
        about: profile.about,
        address: profile.address,
        description: profile.description,
        email: profile.email,
        profilePicture: profile.profile_picture_url,
        websites: profile.websites,
        vertical: profile.vertical,
      };
    },

    async updateBusinessProfile(updates) {
      await graphFetch<unknown>(`/${phoneNumberId}/whatsapp_business_profile`, {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          ...updates,
        }),
      });
    },

    verifyWebhookSubscription(mode, providedVerifyToken, challenge) {
      if (mode !== "subscribe") return null;
      if (!verifyToken) {
        logWarn(
          "verifyWebhookSubscription: WHATSAPP_WEBHOOK_VERIFY_TOKEN not set; rejecting",
        );
        return null;
      }
      if (providedVerifyToken !== verifyToken) {
        return null;
      }
      return challenge ?? null;
    },

    validateWebhookSignature(rawBody, signature) {
      if (!appSecret) {
        logWarn(
          "validateWebhookSignature: WHATSAPP_APP_SECRET not set; accepting",
        );
        return true;
      }
      if (!signature) return false;
      // Signature format: "sha256=<hex>"
      const expected = crypto
        .createHmac("sha256", appSecret)
        .update(rawBody)
        .digest("hex");
      const provided = signature.startsWith("sha256=")
        ? signature.slice("sha256=".length)
        : signature;
      try {
        const a = Buffer.from(expected, "hex");
        const b = Buffer.from(provided, "hex");
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
      } catch {
        return false;
      }
    },

    parseWebhookEvent(body) {
      return parseWebhookEventBody(body);
    },
  };
}

// ---------------------------------------------------------------------------
// Webhook event parsing (shared by mock + real services)
// ---------------------------------------------------------------------------

function parseWebhookEventBody(body: unknown): WhatsappWebhookEvent {
  const root = asObject(body);
  if (root.object !== "whatsapp_business_account") {
    return { type: "unknown", rawValue: body };
  }
  const entries = asArray(root.entry);
  const messages: WhatsappMessage[] = [];
  const statuses: WhatsappWebhookStatus[] = [];
  let template: WhatsappWebhookEvent["template"] | undefined;
  let phoneNumberId: string | undefined;

  for (const entry of entries) {
    const changes = asArray(asObject(entry).changes);
    for (const change of changes) {
      const ch = asObject(change);
      const field = asString(ch.field);
      const value = asObject(ch.value);
      const metadata = asObject(value.metadata);
      phoneNumberId = asString(metadata.phone_number_id) ?? phoneNumberId;

      if (field === "messages") {
        const businessPhone = asString(metadata.display_phone_number) ?? "";
        const incomingMessages = asArray(value.messages);
        for (const m of incomingMessages) {
          const msg = asObject(m);
          const id = asString(msg.id) ?? "";
          const from = asString(msg.from) ?? "";
          const ts = asString(msg.timestamp) ?? nowIsoSeconds();
          const type = classifyMessageType(asString(msg.type));
          const content: Record<string, unknown> = {};
          // Per type, copy relevant block
          for (const key of [
            "text",
            "image",
            "document",
            "audio",
            "video",
            "location",
            "contacts",
            "button",
            "interactive",
            "reaction",
            "sticker",
            "context",
          ]) {
            if (msg[key] !== undefined) content[key] = msg[key];
          }
          messages.push({
            id,
            from,
            to: businessPhone || phoneNumberId || "",
            type,
            direction: "inbound",
            content,
            timestamp: ts,
          });
        }
        const incomingStatuses = asArray(value.statuses);
        for (const s of incomingStatuses) {
          const st = asObject(s);
          const errArr = asArray(st.errors);
          const firstErr = asObject(errArr[0]);
          statuses.push({
            id: asString(st.id) ?? "",
            status: classifyStatus(asString(st.status)) ?? "sent",
            recipient_id: asString(st.recipient_id) ?? "",
            timestamp: asString(st.timestamp) ?? nowIsoSeconds(),
            errorCode:
              typeof firstErr.code === "number"
                ? (firstErr.code as number)
                : undefined,
            errorMessage:
              asString(firstErr.title) ??
              asString(firstErr.message) ??
              undefined,
          });
        }
      } else if (
        field === "message_template_status_update" ||
        field === "template_category_update"
      ) {
        template = {
          name: asString(value.message_template_name) ?? "",
          status:
            asString(value.event) ??
            asString(value.message_template_status) ??
            "",
          reason: asString(value.reason) ?? undefined,
        };
      }
    }
  }

  if (template) {
    return {
      type: "template_status",
      template,
      phoneNumberId,
      rawValue: body,
    };
  }
  if (messages.length > 0 || statuses.length > 0) {
    return {
      type: messages.length > 0 ? "message" : "status",
      messages: messages.length > 0 ? messages : undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      phoneNumberId,
      rawValue: body,
    };
  }
  return { type: "unknown", phoneNumberId, rawValue: body };
}

// ---------------------------------------------------------------------------
// Env-based factory
// ---------------------------------------------------------------------------

let cachedService: WhatsappCloudService | null = null;
let cachedEnvSignature: string | null = null;

function envSignature(): string {
  return [
    process.env.WHATSAPP_BUSINESS_API_TOKEN ?? "",
    process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "",
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "",
    process.env.WHATSAPP_APP_SECRET ?? "",
    process.env.WHATSAPP_GRAPH_API_VERSION ?? "",
  ].join("|");
}

export function getWhatsappCloudService(): WhatsappCloudService {
  const sig = envSignature();
  if (cachedService && cachedEnvSignature === sig) {
    return cachedService;
  }
  const accessToken = process.env.WHATSAPP_BUSINESS_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    cachedService = createMockService("missing WHATSAPP_BUSINESS_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID");
  } else {
    cachedService = createWhatsappCloudService({
      accessToken,
      phoneNumberId,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION,
      webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      appSecret: process.env.WHATSAPP_APP_SECRET,
    });
  }
  cachedEnvSignature = sig;
  return cachedService;
}

/**
 * Returns null if WhatsApp env vars are not configured. Useful for callers
 * that want to opt in to the mock-fallback at a higher level (e.g. the
 * existing business-messaging-service which already has its own mock path).
 */
export function getWhatsappCloudServiceFromEnv(): WhatsappCloudService | null {
  const svc = getWhatsappCloudService();
  return svc.isConfigured() ? svc : null;
}

/** Test/internal seam — drop any memoized instance. */
export function __resetWhatsappCloudServiceCache(): void {
  cachedService = null;
  cachedEnvSignature = null;
}
