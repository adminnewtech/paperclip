// ---------------------------------------------------------------------------
// WhatsApp inbox service
// ---------------------------------------------------------------------------
//
// Routes inbound WhatsApp messages into the businessEntities table so they
// surface in the UI inbox, auto-create contacts, and (heuristically) spin up
// helpdesk tickets for likely complaints.
//
// Storage layout (all under `moduleKey: "messaging"`):
//
//   entityType: "conversation"
//     code        = `WA-<digits-only-phone>`
//     parentId    = contact entity id (if linked)
//     name        = contact name or phone
//     status      = "open" | "closed"
//     data        = { phone, lastMessage, lastMessageAt, unreadCount,
//                     channel: "whatsapp", phoneNumberId }
//
//   entityType: "incoming_message"
//     code        = WhatsApp message id (idempotent — onConflictDoNothing)
//     parentId    = conversation entity id
//     status      = "received" | "read"
//     data        = { from, to, type, content, timestamp, direction,
//                     conversationId, contactId?, providerMessageId,
//                     ticketId? }
//
//   entityType: "outgoing_message"
//     parentId    = conversation entity id
//     data        = { ...same shape, direction: "outbound", agentUserId }
//
// Multi-tenant phone routing: a company opts in by storing its
// WhatsApp phone number id in `businessModules.config.whatsappPhoneNumberId`
// for `moduleKey: "messaging"`. If no company matches, we fall back to the
// first company that has the messaging module enabled. TODO: tighten this.

import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities, businessModules } from "@paperclipai/db";
import type {
  WhatsappCloudService,
  WhatsappMessage,
} from "./whatsapp-cloud-service.js";
import { getWhatsappCloudService } from "./whatsapp-cloud-service.js";
import type { BusinessStreamService } from "./business-stream-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsappInboxConversation {
  id: string;
  contactId: string | null;
  contactName: string;
  phone: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  status: string;
}

export interface WhatsappInboxIngestResult {
  messageId: string;
  ticketId?: string;
  contactId?: string;
  conversationId: string;
  companyId: string | null;
}

export interface WhatsappInboxService {
  resolveCompanyForPhoneNumberId(phoneNumberId: string | undefined): Promise<string | null>;
  handleIncomingMessage(
    companyId: string | null,
    msg: WhatsappMessage,
  ): Promise<WhatsappInboxIngestResult>;
  handleStatusUpdate(
    providerMessageId: string,
    status: string,
    errorMessage?: string,
  ): Promise<void>;
  listConversations(
    companyId: string,
    opts?: { status?: string; limit?: number },
  ): Promise<WhatsappInboxConversation[]>;
  getThread(
    companyId: string,
    contactId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<WhatsappMessage[]>;
  sendReply(
    companyId: string,
    contactId: string,
    text: string,
    agentUserId?: string,
  ): Promise<WhatsappMessage>;
  markAsRead(companyId: string, contactId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Ticket trigger heuristics
// ---------------------------------------------------------------------------

const TICKET_TRIGGER_KEYWORDS = [
  // Arabic
  "شكوى",
  "مشكلة",
  "خلل",
  "عطل",
  "مساعدة",
  // English
  "help",
  "issue",
  "problem",
  "complaint",
  "broken",
  "refund",
  "not working",
];

function shouldTriggerTicket(text: string | undefined | null): boolean {
  if (!text) return false;
  const haystack = text.toLowerCase();
  return TICKET_TRIGGER_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
}

function extractTextBody(msg: WhatsappMessage): string {
  if (msg.type === "text") {
    const t = msg.content.text;
    if (t && typeof t === "object" && "body" in t) {
      const body = (t as { body?: unknown }).body;
      if (typeof body === "string") return body;
    }
  }
  if (msg.type === "button") {
    const b = msg.content.button;
    if (b && typeof b === "object" && "text" in b) {
      const tx = (b as { text?: unknown }).text;
      if (typeof tx === "string") return tx;
    }
  }
  if (msg.type === "interactive") {
    const i = msg.content.interactive;
    if (i && typeof i === "object") {
      const rec = i as Record<string, unknown>;
      const lr =
        (rec.list_reply as Record<string, unknown> | undefined) ??
        (rec.button_reply as Record<string, unknown> | undefined);
      if (lr && typeof lr.title === "string") return lr.title;
    }
  }
  return `[${msg.type}]`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWhatsappInboxService(
  db: Db,
  opts: {
    streamService?: BusinessStreamService;
    cloudService?: WhatsappCloudService;
  } = {},
): WhatsappInboxService {
  const streamService = opts.streamService;
  const cloud = opts.cloudService ?? getWhatsappCloudService();

  async function resolveCompanyForPhoneNumberId(
    phoneNumberId: string | undefined,
  ): Promise<string | null> {
    // Try config match first
    if (phoneNumberId) {
      const rows = await db
        .select({
          companyId: businessModules.companyId,
          config: businessModules.config,
        })
        .from(businessModules)
        .where(eq(businessModules.moduleKey, "messaging"));
      for (const row of rows) {
        const cfg = (row.config ?? {}) as Record<string, unknown>;
        if (cfg.whatsappPhoneNumberId === phoneNumberId) {
          return row.companyId;
        }
      }
    }
    // Fallback: first company with messaging enabled (single-tenant happy path)
    const first = await db
      .select({ companyId: businessModules.companyId })
      .from(businessModules)
      .where(
        and(
          eq(businessModules.moduleKey, "messaging"),
          eq(businessModules.enabled, true),
        ),
      )
      .limit(1);
    return first[0]?.companyId ?? null;
  }

  async function findOrCreateContact(
    companyId: string,
    phone: string,
  ): Promise<{ id: string; name: string }> {
    // Try existing CRM contact by phone (data.phone field).
    const existing = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "contact"),
          sql`${businessEntities.data}->>'phone' = ${phone}`,
        ),
      )
      .limit(1);
    const found = existing[0];
    if (found) {
      return { id: found.id, name: found.name ?? phone };
    }
    const now = new Date();
    const inserted = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "crm",
        entityType: "contact",
        name: phone,
        status: "active",
        data: { phone, source: "whatsapp" },
        tags: ["whatsapp"],
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: businessEntities.id, name: businessEntities.name });
    const row = inserted[0]!;
    return { id: row.id, name: row.name ?? phone };
  }

  async function findOrCreateConversation(
    companyId: string,
    phone: string,
    contactId: string,
    contactName: string,
    phoneNumberId: string | undefined,
  ): Promise<{ id: string; isNew: boolean }> {
    const code = `WA-${phone.replace(/\D/g, "")}`;
    const existing = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "messaging"),
          eq(businessEntities.entityType, "conversation"),
          eq(businessEntities.code, code),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return { id: existing[0].id, isNew: false };
    }
    const now = new Date();
    const inserted = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "messaging",
        entityType: "conversation",
        parentId: contactId,
        code,
        name: contactName,
        status: "open",
        data: {
          phone,
          channel: "whatsapp",
          phoneNumberId: phoneNumberId ?? null,
          lastMessage: "",
          lastMessageAt: now.toISOString(),
          unreadCount: 0,
        },
        tags: ["whatsapp"],
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: businessEntities.id });
    return { id: inserted[0]!.id, isNew: true };
  }

  async function updateConversationActivity(
    companyId: string,
    conversationId: string,
    summary: string,
    direction: "inbound" | "outbound",
  ): Promise<void> {
    const now = new Date();
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, conversationId),
          eq(businessEntities.companyId, companyId),
        ),
      )
      .limit(1);
    const conv = rows[0];
    if (!conv) return;
    const data = (conv.data ?? {}) as Record<string, unknown>;
    const prevUnread =
      typeof data.unreadCount === "number" ? (data.unreadCount as number) : 0;
    const newData: Record<string, unknown> = {
      ...data,
      lastMessage: summary.slice(0, 500),
      lastMessageAt: now.toISOString(),
      unreadCount: direction === "inbound" ? prevUnread + 1 : prevUnread,
    };
    await db
      .update(businessEntities)
      .set({ data: newData, updatedAt: now })
      .where(eq(businessEntities.id, conversationId));
  }

  async function createHelpdeskTicketFromMessage(
    companyId: string,
    contactId: string,
    summary: string,
  ): Promise<string | undefined> {
    try {
      const now = new Date();
      const inserted = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: "helpdesk",
          entityType: "ticket",
          parentId: contactId,
          name: summary.slice(0, 120),
          status: "open",
          data: {
            description: summary,
            source: "whatsapp",
            priority: "normal",
          },
          tags: ["whatsapp", "auto-created"],
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: businessEntities.id });
      const ticketId = inserted[0]?.id;
      if (ticketId && streamService) {
        const row = await db
          .select()
          .from(businessEntities)
          .where(eq(businessEntities.id, ticketId))
          .limit(1);
        const entity = row[0];
        if (entity) {
          streamService.emit({
            kind: "entity.created",
            companyId,
            moduleKey: "helpdesk",
            entityType: "ticket",
            entity: {
              ...entity,
              data: (entity.data ?? {}) as Record<string, unknown>,
              tags: (entity.tags ?? []) as string[],
            },
          });
        }
      }
      return ticketId;
    } catch {
      return undefined;
    }
  }

  async function handleIncomingMessage(
    explicitCompanyId: string | null,
    msg: WhatsappMessage,
  ): Promise<WhatsappInboxIngestResult> {
    const companyId =
      explicitCompanyId ??
      (await resolveCompanyForPhoneNumberId(msg.to ? undefined : undefined));
    if (!companyId) {
      // No company configured — still log to console so operators see traffic.
      // eslint-disable-next-line no-console
      console.warn(
        "[whatsapp-inbox] no company resolved for inbound message",
        { from: msg.from, to: msg.to },
      );
      return {
        messageId: msg.id,
        conversationId: "",
        companyId: null,
      };
    }
    const phone = msg.from;
    const contact = await findOrCreateContact(companyId, phone);
    const conv = await findOrCreateConversation(
      companyId,
      phone,
      contact.id,
      contact.name,
      msg.to,
    );
    const summary = extractTextBody(msg);

    const now = new Date();
    const inserted = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "messaging",
        entityType: "incoming_message",
        parentId: conv.id,
        code: msg.id,
        name: summary.slice(0, 200),
        status: "received",
        data: {
          channel: "whatsapp",
          direction: "inbound",
          from: msg.from,
          to: msg.to,
          type: msg.type,
          content: msg.content,
          timestamp: msg.timestamp,
          contactId: contact.id,
          conversationId: conv.id,
          providerMessageId: msg.id,
        },
        tags: ["whatsapp"],
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: businessEntities.id });

    const messageRowId = inserted[0]?.id ?? msg.id;

    let ticketId: string | undefined;
    if (conv.isNew && shouldTriggerTicket(summary)) {
      ticketId = await createHelpdeskTicketFromMessage(
        companyId,
        contact.id,
        summary,
      );
      if (ticketId) {
        await db
          .update(businessEntities)
          .set({
            data: sql`jsonb_set(${businessEntities.data}, '{ticketId}', ${JSON.stringify(
              ticketId,
            )}::jsonb)`,
          })
          .where(eq(businessEntities.id, messageRowId));
      }
    }

    await updateConversationActivity(companyId, conv.id, summary, "inbound");

    if (streamService) {
      streamService.emit({
        kind: "summary.changed",
        companyId,
      });
    }

    return {
      messageId: messageRowId,
      ticketId,
      contactId: contact.id,
      conversationId: conv.id,
      companyId,
    };
  }

  async function handleStatusUpdate(
    providerMessageId: string,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    // We mirror status onto outgoing_message rows whose code equals the
    // providerMessageId. Webhook fires across all companies, so we search
    // without companyId.
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.moduleKey, "messaging"),
          eq(businessEntities.code, providerMessageId),
        ),
      )
      .limit(5);
    for (const row of rows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      const newData: Record<string, unknown> = {
        ...data,
        deliveryStatus: status,
        ...(errorMessage ? { deliveryError: errorMessage } : {}),
      };
      const newStatus =
        status === "failed"
          ? "failed"
          : status === "read"
            ? "read"
            : status === "delivered"
              ? "delivered"
              : row.status;
      await db
        .update(businessEntities)
        .set({ data: newData, status: newStatus, updatedAt: new Date() })
        .where(eq(businessEntities.id, row.id));
      if (streamService) {
        streamService.emit({
          kind: "summary.changed",
          companyId: row.companyId,
        });
      }
    }
  }

  async function listConversations(
    companyId: string,
    opts?: { status?: string; limit?: number },
  ): Promise<WhatsappInboxConversation[]> {
    const limit = Math.min(opts?.limit ?? 100, 500);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "messaging"),
          eq(businessEntities.entityType, "conversation"),
          opts?.status ? eq(businessEntities.status, opts.status) : sql`true`,
        ),
      )
      .orderBy(desc(businessEntities.updatedAt))
      .limit(limit);
    return rows.map((row) => {
      const data = (row.data ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        contactId: row.parentId ?? null,
        contactName: row.name ?? "",
        phone: typeof data.phone === "string" ? data.phone : "",
        lastMessage:
          typeof data.lastMessage === "string" ? data.lastMessage : "",
        lastMessageAt:
          typeof data.lastMessageAt === "string"
            ? data.lastMessageAt
            : row.updatedAt instanceof Date
              ? row.updatedAt.toISOString()
              : String(row.updatedAt),
        unreadCount:
          typeof data.unreadCount === "number" ? data.unreadCount : 0,
        status: row.status,
      };
    });
  }

  async function getConversationByContact(
    companyId: string,
    contactId: string,
  ): Promise<string | null> {
    const rows = await db
      .select({ id: businessEntities.id })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "messaging"),
          eq(businessEntities.entityType, "conversation"),
          eq(businessEntities.parentId, contactId),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async function getThread(
    companyId: string,
    contactId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<WhatsappMessage[]> {
    const conversationId = await getConversationByContact(companyId, contactId);
    if (!conversationId) return [];
    const limit = Math.min(opts?.limit ?? 200, 1000);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "messaging"),
          eq(businessEntities.parentId, conversationId),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit);

    const filtered = rows.filter(
      (r) =>
        r.entityType === "incoming_message" ||
        r.entityType === "outgoing_message",
    );
    return filtered.reverse().map((row) => {
      const data = (row.data ?? {}) as Record<string, unknown>;
      const direction =
        row.entityType === "incoming_message" ? "inbound" : "outbound";
      return {
        id: typeof data.providerMessageId === "string"
          ? (data.providerMessageId as string)
          : row.id,
        from: typeof data.from === "string" ? data.from : "",
        to: typeof data.to === "string" ? data.to : "",
        type:
          typeof data.type === "string"
            ? (data.type as WhatsappMessage["type"])
            : "text",
        direction,
        content: (data.content ?? {}) as Record<string, unknown>,
        timestamp:
          typeof data.timestamp === "string"
            ? data.timestamp
            : row.createdAt instanceof Date
              ? String(Math.floor(row.createdAt.getTime() / 1000))
              : String(row.createdAt),
        status:
          typeof data.deliveryStatus === "string"
            ? (data.deliveryStatus as WhatsappMessage["status"])
            : undefined,
        errorMessage:
          typeof data.deliveryError === "string"
            ? (data.deliveryError as string)
            : undefined,
      };
    });
  }

  async function sendReply(
    companyId: string,
    contactId: string,
    text: string,
    agentUserId?: string,
  ): Promise<WhatsappMessage> {
    // Locate the contact phone
    const contactRows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, contactId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "contact"),
        ),
      )
      .limit(1);
    const contact = contactRows[0];
    if (!contact) {
      throw new Error("Contact not found");
    }
    const data = (contact.data ?? {}) as Record<string, unknown>;
    const phone = typeof data.phone === "string" ? data.phone : null;
    if (!phone) {
      throw new Error("Contact has no phone");
    }
    const conversationId = await getConversationByContact(companyId, contactId);
    if (!conversationId) {
      // Create a fresh conversation so the reply has a thread to live in.
      await findOrCreateConversation(
        companyId,
        phone,
        contactId,
        contact.name ?? phone,
        undefined,
      );
    }
    const finalConvId =
      conversationId ?? (await getConversationByContact(companyId, contactId));

    const sent = await cloud.sendText(phone, text);
    const now = new Date();
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "messaging",
      entityType: "outgoing_message",
      parentId: finalConvId,
      code: sent.id,
      name: text.slice(0, 200),
      status: "sent",
      data: {
        channel: "whatsapp",
        direction: "outbound",
        from: sent.from,
        to: sent.to,
        type: "text",
        content: { text: { body: text } },
        timestamp: sent.timestamp,
        contactId,
        conversationId: finalConvId,
        providerMessageId: sent.id,
        agentUserId: agentUserId ?? null,
      },
      tags: ["whatsapp"],
      createdAt: now,
      updatedAt: now,
    });

    if (finalConvId) {
      await updateConversationActivity(
        companyId,
        finalConvId,
        text,
        "outbound",
      );
    }

    if (streamService) {
      streamService.emit({ kind: "summary.changed", companyId });
    }
    return sent;
  }

  async function markAsRead(
    companyId: string,
    contactId: string,
  ): Promise<void> {
    const conversationId = await getConversationByContact(companyId, contactId);
    if (!conversationId) return;
    const rows = await db
      .select()
      .from(businessEntities)
      .where(eq(businessEntities.id, conversationId))
      .limit(1);
    const conv = rows[0];
    if (!conv) return;
    const data = (conv.data ?? {}) as Record<string, unknown>;
    const newData: Record<string, unknown> = { ...data, unreadCount: 0 };
    await db
      .update(businessEntities)
      .set({ data: newData, updatedAt: new Date() })
      .where(eq(businessEntities.id, conversationId));

    // Best-effort: mark unread inbound messages as read in WhatsApp Cloud
    const inboundRows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.parentId, conversationId),
          eq(businessEntities.entityType, "incoming_message"),
          eq(businessEntities.status, "received"),
        ),
      )
      .limit(50);
    for (const row of inboundRows) {
      const rowData = (row.data ?? {}) as Record<string, unknown>;
      const providerId =
        typeof rowData.providerMessageId === "string"
          ? (rowData.providerMessageId as string)
          : null;
      if (providerId && cloud.isConfigured()) {
        try {
          await cloud.markMessageRead(providerId);
        } catch {
          // Non-fatal — read receipts are best-effort.
        }
      }
      await db
        .update(businessEntities)
        .set({ status: "read", updatedAt: new Date() })
        .where(eq(businessEntities.id, row.id));
    }

    if (streamService) {
      streamService.emit({ kind: "summary.changed", companyId });
    }
  }

  return {
    resolveCompanyForPhoneNumberId,
    handleIncomingMessage,
    handleStatusUpdate,
    listConversations,
    getThread,
    sendReply,
    markAsRead,
  };
}
