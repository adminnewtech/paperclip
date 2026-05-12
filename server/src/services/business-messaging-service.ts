// ---------------------------------------------------------------------------
// Business messaging service (WhatsApp Business API + SMS)
// ---------------------------------------------------------------------------
//
// Sends messages via WhatsApp Business Cloud API and/or SMS providers, and
// persists every send as a business entity (`moduleKey: "messaging"`,
// `entityType: "message"`) so the UI can render a sent-log.
//
// Provider integration is intentionally lazy and gated behind environment
// variables. When the relevant env var is unset (or a provider call throws),
// the service falls back to a deterministic mock that simply logs to the
// console — so this code is always safe to run in dev without any external
// credentials.
//
// Expected env vars:
//
//   WHATSAPP_BUSINESS_API_TOKEN   Bearer token for Meta Graph API.
//                                 Required to actually send WhatsApp.
//   WHATSAPP_PHONE_NUMBER_ID      The phone-number ID from your WhatsApp
//                                 Business account. Required for WhatsApp.
//   WHATSAPP_GRAPH_API_VERSION    Optional; defaults to "v20.0".
//
//   SMS_PROVIDER                  One of: "twilio" | "aws-sns" | "unifonic" |
//                                 "msegat" | "mock". Defaults to "mock" when
//                                 unset.
//
//   TWILIO_ACCOUNT_SID            Twilio credentials (when SMS_PROVIDER=twilio)
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER
//
//   AWS_SNS_REGION                AWS SNS (when SMS_PROVIDER=aws-sns)
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//
//   UNIFONIC_APP_SID              Unifonic (when SMS_PROVIDER=unifonic)
//   UNIFONIC_SENDER_ID
//
//   MSEGAT_API_KEY                msegat (when SMS_PROVIDER=msegat)
//   MSEGAT_USERNAME
//   MSEGAT_USER_SENDER
//
// Each persisted message stores:
//   { channel, toPhone, body, templateKey, variables, providerMessageId,
//     providerResponse, status, error }
// inside `businessEntities.data`.

import { and, desc, eq, ilike } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  MESSAGE_TEMPLATES,
  renderMessageTemplate,
  type MessageTemplate,
} from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageChannel = "whatsapp" | "sms";

export interface SendMessageRequest {
  channel: MessageChannel;
  /** E.164 format, e.g., "+965XXXXXXXX" */
  toPhone: string;
  body: string;
  /** Used for tracking and analytics; not required to send. */
  templateKey?: string;
  variables?: Record<string, string>;
  /** Optional link to another businessEntity (e.g. invoice, ticket). */
  relatedEntityId?: string;
}

export interface SendMessageResult {
  ok: boolean;
  messageId?: string;
  providerResponse?: unknown;
  error?: string;
  mock?: boolean;
}

export type SmsProvider =
  | "twilio"
  | "aws-sns"
  | "unifonic"
  | "msegat"
  | "mock";

export interface MessageRecord {
  id: string;
  companyId: string;
  code: string | null;
  status: string;
  channel: MessageChannel;
  toPhone: string;
  body: string;
  templateKey: string | null;
  variables: Record<string, string> | null;
  relatedEntityId: string | null;
  providerMessageId: string | null;
  providerResponse: unknown;
  error: string | null;
  mock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessMessagingService {
  send(companyId: string, req: SendMessageRequest): Promise<SendMessageResult>;
  sendTemplate(
    companyId: string,
    templateKey: string,
    opts: {
      channel: MessageChannel;
      toPhone: string;
      variables: Record<string, string>;
      relatedEntityId?: string;
      lang?: "ar" | "en";
    },
  ): Promise<SendMessageResult>;
  listMessages(
    companyId: string,
    opts?: { limit?: number; relatedEntityId?: string },
  ): Promise<MessageRecord[]>;
  getMessage(companyId: string, id: string): Promise<MessageRecord | null>;
  getProviderStatus(): {
    whatsapp: { configured: boolean; details: string };
    sms: { provider: SmsProvider; configured: boolean; details: string };
  };
}

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

function getSmsProvider(): SmsProvider {
  const raw = (process.env.SMS_PROVIDER ?? "").toLowerCase().trim();
  if (
    raw === "twilio" ||
    raw === "aws-sns" ||
    raw === "unifonic" ||
    raw === "msegat" ||
    raw === "mock"
  ) {
    return raw;
  }
  return "mock";
}

function whatsappConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_BUSINESS_API_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID,
  );
}

function smsConfigured(provider: SmsProvider): boolean {
  switch (provider) {
    case "twilio":
      return Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
          process.env.TWILIO_AUTH_TOKEN &&
          process.env.TWILIO_FROM_NUMBER,
      );
    case "aws-sns":
      return Boolean(
        process.env.AWS_SNS_REGION &&
          process.env.AWS_ACCESS_KEY_ID &&
          process.env.AWS_SECRET_ACCESS_KEY,
      );
    case "unifonic":
      return Boolean(
        process.env.UNIFONIC_APP_SID && process.env.UNIFONIC_SENDER_ID,
      );
    case "msegat":
      return Boolean(
        process.env.MSEGAT_API_KEY &&
          process.env.MSEGAT_USERNAME &&
          process.env.MSEGAT_USER_SENDER,
      );
    case "mock":
      return false;
  }
}

async function sendWhatsApp(
  toPhone: string,
  body: string,
): Promise<SendMessageResult> {
  if (!whatsappConfigured()) {
    // eslint-disable-next-line no-console
    console.log("[messaging] would send (WhatsApp, mock):", { toPhone, body });
    return { ok: true, mock: true, messageId: `mock_wa_${Date.now()}` };
  }

  const token = process.env.WHATSAPP_BUSINESS_API_TOKEN!;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const version = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body },
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; error?: { message?: string } }
      | null;
    if (!res.ok) {
      const errorMsg =
        json?.error?.message ?? `WhatsApp send failed: ${res.status}`;
      return { ok: false, error: errorMsg, providerResponse: json };
    }
    const messageId = json?.messages?.[0]?.id;
    return { ok: true, messageId, providerResponse: json };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function sendSms(
  toPhone: string,
  body: string,
): Promise<SendMessageResult> {
  const provider = getSmsProvider();
  if (provider === "mock" || !smsConfigured(provider)) {
    // eslint-disable-next-line no-console
    console.log("[messaging] would send (SMS, mock):", {
      provider,
      toPhone,
      body,
    });
    return { ok: true, mock: true, messageId: `mock_sms_${Date.now()}` };
  }

  try {
    if (provider === "twilio") {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const token = process.env.TWILIO_AUTH_TOKEN!;
      const from = process.env.TWILIO_FROM_NUMBER!;
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const form = new URLSearchParams();
      form.set("To", toPhone);
      form.set("From", from);
      form.set("Body", body);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      const json = (await res.json().catch(() => null)) as
        | { sid?: string; message?: string }
        | null;
      if (!res.ok) {
        return {
          ok: false,
          error: json?.message ?? `Twilio send failed: ${res.status}`,
          providerResponse: json,
        };
      }
      return { ok: true, messageId: json?.sid, providerResponse: json };
    }

    if (provider === "unifonic") {
      const appSid = process.env.UNIFONIC_APP_SID!;
      const senderId = process.env.UNIFONIC_SENDER_ID!;
      const url = "https://api.unifonic.com/rest/SMS/messages";
      const form = new URLSearchParams();
      form.set("AppSid", appSid);
      form.set("SenderID", senderId);
      form.set("Recipient", toPhone.replace(/^\+/, ""));
      form.set("Body", body);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { MessageID?: string }; message?: string }
        | null;
      if (!res.ok || json?.success === false) {
        return {
          ok: false,
          error: json?.message ?? `Unifonic send failed: ${res.status}`,
          providerResponse: json,
        };
      }
      return {
        ok: true,
        messageId: json?.data?.MessageID,
        providerResponse: json,
      };
    }

    if (provider === "msegat") {
      const apiKey = process.env.MSEGAT_API_KEY!;
      const username = process.env.MSEGAT_USERNAME!;
      const userSender = process.env.MSEGAT_USER_SENDER!;
      const url = "https://www.msegat.com/gw/sendsms.php";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: username,
          numbers: toPhone.replace(/^\+/, ""),
          userSender,
          apiKey,
          msg: body,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { code?: string | number; id?: string; message?: string }
        | null;
      const codeOk =
        json && (json.code === 1 || json.code === "1" || json.code === "M0000");
      if (!res.ok || !codeOk) {
        return {
          ok: false,
          error: json?.message ?? `msegat send failed: ${res.status}`,
          providerResponse: json,
        };
      }
      return { ok: true, messageId: json?.id, providerResponse: json };
    }

    if (provider === "aws-sns") {
      // AWS SNS Publish via signed REST request is non-trivial without the
      // SDK; surface a clear "not implemented" so operators add the SDK.
      return {
        ok: false,
        error:
          "AWS SNS provider requires the @aws-sdk/client-sns package. Install it and integrate, or use a different provider.",
      };
    }

    return { ok: false, error: `Unknown SMS provider: ${provider}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Code generator
// ---------------------------------------------------------------------------

async function nextMessageCode(db: Db, companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "messaging"),
        eq(businessEntities.entityType, "message"),
        ilike(businessEntities.code, `MSG-${year}-%`),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);
  let num = 1;
  const last = rows[0]?.code;
  if (last) {
    const parts = last.split("-");
    const lastNum = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!Number.isNaN(lastNum)) num = lastNum + 1;
  }
  return `MSG-${year}-${String(num).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Row → MessageRecord mapping
// ---------------------------------------------------------------------------

function rowToRecord(
  row: typeof businessEntities.$inferSelect,
): MessageRecord {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const channel =
    data.channel === "whatsapp" || data.channel === "sms"
      ? (data.channel as MessageChannel)
      : "sms";
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    status: row.status,
    channel,
    toPhone: typeof data.toPhone === "string" ? data.toPhone : "",
    body: typeof data.body === "string" ? data.body : "",
    templateKey:
      typeof data.templateKey === "string" ? data.templateKey : null,
    variables:
      data.variables && typeof data.variables === "object"
        ? (data.variables as Record<string, string>)
        : null,
    relatedEntityId:
      typeof data.relatedEntityId === "string" ? data.relatedEntityId : null,
    providerMessageId:
      typeof data.providerMessageId === "string"
        ? data.providerMessageId
        : null,
    providerResponse: data.providerResponse ?? null,
    error: typeof data.error === "string" ? data.error : null,
    mock: data.mock === true,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : String(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createBusinessMessagingService(
  db: Db,
): BusinessMessagingService {
  async function send(
    companyId: string,
    req: SendMessageRequest,
  ): Promise<SendMessageResult> {
    const result =
      req.channel === "whatsapp"
        ? await sendWhatsApp(req.toPhone, req.body)
        : await sendSms(req.toPhone, req.body);

    // Persist the send attempt regardless of success.
    const now = new Date();
    const code = await nextMessageCode(db, companyId);
    await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "messaging",
        entityType: "message",
        code,
        name: `${req.channel.toUpperCase()} → ${req.toPhone}`,
        status: result.ok ? "sent" : "failed",
        data: {
          channel: req.channel,
          toPhone: req.toPhone,
          body: req.body,
          templateKey: req.templateKey ?? null,
          variables: req.variables ?? null,
          relatedEntityId: req.relatedEntityId ?? null,
          providerMessageId: result.messageId ?? null,
          providerResponse: result.providerResponse ?? null,
          error: result.error ?? null,
          mock: result.mock === true,
        },
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    return result;
  }

  async function sendTemplate(
    companyId: string,
    templateKey: string,
    opts: {
      channel: MessageChannel;
      toPhone: string;
      variables: Record<string, string>;
      relatedEntityId?: string;
      lang?: "ar" | "en";
    },
  ): Promise<SendMessageResult> {
    const template: MessageTemplate | undefined = MESSAGE_TEMPLATES.find(
      (t) => t.key === templateKey,
    );
    if (!template) {
      return { ok: false, error: `Unknown template: ${templateKey}` };
    }
    const lang = opts.lang ?? "en";
    const rawBody = lang === "ar" ? template.bodyAr : template.bodyEn;
    const body = renderMessageTemplate(rawBody, opts.variables);
    return send(companyId, {
      channel: opts.channel,
      toPhone: opts.toPhone,
      body,
      templateKey,
      variables: opts.variables,
      relatedEntityId: opts.relatedEntityId,
    });
  }

  async function listMessages(
    companyId: string,
    opts?: { limit?: number; relatedEntityId?: string },
  ): Promise<MessageRecord[]> {
    const limit = Math.min(opts?.limit ?? 200, 1000);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "messaging"),
          eq(businessEntities.entityType, "message"),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit);

    let records = rows.map(rowToRecord);
    if (opts?.relatedEntityId) {
      records = records.filter(
        (r) => r.relatedEntityId === opts.relatedEntityId,
      );
    }
    return records;
  }

  async function getMessage(
    companyId: string,
    id: string,
  ): Promise<MessageRecord | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "messaging"),
          eq(businessEntities.entityType, "message"),
        ),
      );
    return row ? rowToRecord(row) : null;
  }

  function getProviderStatus() {
    const provider = getSmsProvider();
    return {
      whatsapp: {
        configured: whatsappConfigured(),
        details: whatsappConfigured()
          ? "WhatsApp Business API token + phone number ID detected."
          : "Set WHATSAPP_BUSINESS_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID to enable real sends. Currently mocked.",
      },
      sms: {
        provider,
        configured: smsConfigured(provider),
        details: smsConfigured(provider)
          ? `SMS provider "${provider}" is configured.`
          : provider === "mock"
            ? "SMS_PROVIDER unset; using mock sender."
            : `SMS_PROVIDER="${provider}" is missing required env vars. Currently mocked.`,
      },
    };
  }

  return { send, sendTemplate, listMessages, getMessage, getProviderStatus };
}
