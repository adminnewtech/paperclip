/**
 * Event Bridge service.
 *
 * Translates business events into workspace channel messages.
 *
 * Two main flows:
 *   1. Direct `publishEvent` — caller hands us a `BusinessEvent` and we
 *      look up the catalog entry, render the bilingual template, resolve
 *      the destination channel, and forward to a `MessagePoster`.
 *   2. `bindToBusinessStream` — subscribes to the in-memory business
 *      stream service and auto-publishes for known entity types
 *      (invoice → invoice_created, online_order → order_placed, etc.).
 *
 * All publishing is fire-and-forget. Errors are logged, never thrown back
 * to the producer.
 *
 * Routing config + event stats are stored as businessEntities rows under
 * moduleKey "workspace" (see event-routing.ts).
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  compareBusinessEventImportance,
  getBusinessEventDefinition,
  renderBusinessEventTemplate,
  type BusinessEventDefinition,
  type BusinessEventImportance,
} from "@paperclipai/shared";
import { logger } from "../../middleware/logger.js";
import type { MessagePoster } from "./ai-members-service.js";
import {
  createEventRoutingStore,
  isInsideQuietHours,
  type EventRoutingConfig,
  type EventRoutingStore,
} from "./event-routing.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BusinessEvent {
  key: string;
  companyId: string;
  variables: Record<string, string | number>;
  entityId?: string;
  entityType?: string;
  triggeredBy?: {
    type: "user" | "agent" | "system" | "external";
    id: string;
  };
}

export interface PublishEventResult {
  messageId?: string;
  skipped?: boolean;
  reason?: string;
}

export interface EventStats {
  totalEvents: number;
  byCategory: Record<string, number>;
  topEvents: Array<{ key: string; count: number }>;
}

export interface MinimalBusinessStreamLike {
  subscribe(
    companyId: string,
    cb: (event: unknown) => void,
  ): () => void;
}

export interface EventBridgeService {
  publishEvent(event: BusinessEvent): Promise<PublishEventResult>;
  /**
   * Subscribe to a business stream and auto-publish translated events
   * for a given company. Returns an unsubscribe function.
   */
  bindToBusinessStream(
    companyId: string,
    streamService: MinimalBusinessStreamLike,
  ): () => void;
  getRouting(companyId: string): Promise<EventRoutingConfig>;
  setRouting(
    companyId: string,
    patch: Partial<EventRoutingConfig>,
  ): Promise<EventRoutingConfig>;
  getEventStats(
    companyId: string,
    opts?: { from?: string; to?: string },
  ): Promise<EventStats>;
  /** Late-binding wiring (called once P11-A's MessagePoster is wired). */
  __setPoster(poster: MessagePoster | null): void;
}

// ---------------------------------------------------------------------------
// Persistent event log (for stats)
// ---------------------------------------------------------------------------

const EVENT_LOG_MODULE_KEY = "workspace";
const EVENT_LOG_ENTITY_TYPE = "event_log";

// ---------------------------------------------------------------------------
// Translator: business stream event → BusinessEvent
// ---------------------------------------------------------------------------

interface BusinessStreamEntityCreated {
  kind: "entity.created";
  companyId: string;
  moduleKey: string;
  entityType: string;
  entity: {
    id: string;
    code: string | null;
    name: string | null;
    amountCents: number | null;
    currency: string | null;
    data: Record<string, unknown>;
    [k: string]: unknown;
  };
}

interface BusinessStreamEntityUpdated extends Omit<BusinessStreamEntityCreated, "kind"> {
  kind: "entity.updated";
}

type KnownStreamEvent =
  | BusinessStreamEntityCreated
  | BusinessStreamEntityUpdated
  | { kind: "entity.deleted"; companyId: string; entityType: string; entityId: string }
  | { kind: "summary.changed"; companyId: string };

const ENTITY_TYPE_TO_EVENT: Record<string, string> = {
  invoice: "invoice_created",
  online_order: "order_placed",
  order: "order_placed",
  ticket: "ticket_created",
  helpdesk_ticket: "ticket_created",
  expense: "expense_added",
  payment: "payment_received",
  customer_payment: "payment_received",
  deal: "deal_created",
  contact: "contact_added",
  employee: "employee_added",
  campaign: "campaign_launched",
};

function asAmount(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

function pickString(
  data: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

export function translateStreamEventToBusinessEvent(
  event: unknown,
): BusinessEvent | null {
  if (!event || typeof event !== "object") return null;
  const ev = event as KnownStreamEvent;
  if (ev.kind !== "entity.created") return null;
  const entityType = ev.entityType;
  const key = ENTITY_TYPE_TO_EVENT[entityType];
  if (!key) return null;
  const entity = ev.entity;
  const data = entity.data ?? {};

  const variables: Record<string, string | number> = {
    amount: asAmount(entity.amountCents),
    currency: entity.currency ?? "",
  };

  switch (key) {
    case "invoice_created":
      variables.invoiceCode = entity.code ?? entity.id;
      variables.customerName = pickString(
        data,
        "customerName",
        "customer_name",
        "contactName",
      );
      break;
    case "order_placed":
      variables.orderCode = entity.code ?? entity.id;
      variables.customerName = pickString(
        data,
        "customerName",
        "customer_name",
      );
      break;
    case "ticket_created":
      variables.ticketCode = entity.code ?? entity.id;
      variables.customerName = pickString(
        data,
        "customerName",
        "customer_name",
        "reporterName",
      );
      variables.subject = pickString(data, "subject", "title") || entity.name || "";
      break;
    case "expense_added":
      variables.vendorName = pickString(data, "vendorName", "vendor_name") || entity.name || "";
      variables.category = pickString(data, "category", "categoryName") || "uncategorized";
      break;
    case "payment_received":
      variables.customerName = pickString(
        data,
        "customerName",
        "customer_name",
      );
      variables.method = pickString(data, "method", "paymentMethod") || "unknown";
      break;
    case "deal_created":
      variables.dealName = entity.name || entity.code || entity.id;
      variables.customerName = pickString(
        data,
        "customerName",
        "customer_name",
      );
      break;
    case "contact_added":
      variables.contactName = entity.name || entity.code || entity.id;
      variables.contactEmail = pickString(data, "email", "contactEmail");
      variables.addedBy = pickString(data, "createdBy", "addedBy") || "system";
      break;
    case "employee_added":
      variables.employeeName = entity.name || entity.code || entity.id;
      variables.role = pickString(data, "role", "title") || "team member";
      break;
    case "campaign_launched":
      variables.campaignName = entity.name || entity.code || entity.id;
      variables.audienceSize = pickString(data, "audienceSize") || "0";
      break;
    default:
      break;
  }

  return {
    key,
    companyId: ev.companyId,
    variables,
    entityId: entity.id,
    entityType,
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export interface CreateEventBridgeServiceOpts {
  poster?: MessagePoster | null;
  routingStore?: EventRoutingStore;
  now?: () => Date;
}

export function createEventBridgeService(
  db: Db,
  opts: CreateEventBridgeServiceOpts = {},
): EventBridgeService {
  const state: { poster: MessagePoster | null } = {
    poster: opts.poster ?? null,
  };
  const routingStore = opts.routingStore ?? createEventRoutingStore(db);
  const now = opts.now ?? (() => new Date());

  function resolveRouting(
    def: BusinessEventDefinition,
    config: EventRoutingConfig,
  ): {
    channelSlug: string;
    disabled: boolean;
    importance: BusinessEventImportance;
  } {
    const override = config.routing[def.key] ?? {};
    return {
      channelSlug: override.channelSlug ?? def.defaultChannelSlug,
      disabled: override.disabled === true,
      importance: override.importance ?? def.importance,
    };
  }

  async function recordEventLog(
    companyId: string,
    event: BusinessEvent,
    def: BusinessEventDefinition,
    outcome: { messageId?: string; skipped?: boolean; reason?: string },
  ): Promise<void> {
    try {
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: EVENT_LOG_MODULE_KEY,
        entityType: EVENT_LOG_ENTITY_TYPE,
        code: event.key,
        name: def.category,
        status: outcome.skipped ? "skipped" : "published",
        data: {
          eventKey: event.key,
          category: def.category,
          variables: event.variables,
          entityId: event.entityId,
          entityType: event.entityType,
          triggeredBy: event.triggeredBy,
          messageId: outcome.messageId,
          reason: outcome.reason,
        } as Record<string, unknown>,
        tags: ["workspace_event", def.category, event.key],
      });
    } catch (err) {
      logger.warn(
        { err, companyId, eventKey: event.key },
        "event-bridge: failed to write event log row",
      );
    }
  }

  async function publishEvent(
    event: BusinessEvent,
  ): Promise<PublishEventResult> {
    const def = getBusinessEventDefinition(event.key);
    if (!def) {
      const reason = `Unknown event key: ${event.key}`;
      logger.debug({ companyId: event.companyId, eventKey: event.key }, reason);
      return { skipped: true, reason };
    }

    let config: EventRoutingConfig;
    try {
      config = await routingStore.get(event.companyId);
    } catch (err) {
      logger.warn(
        { err, companyId: event.companyId },
        "event-bridge: routing fetch failed, using defaults",
      );
      config = { routing: {}, minImportance: "info" };
    }

    const routing = resolveRouting(def, config);
    if (routing.disabled) {
      const reason = "Event disabled by routing config";
      await recordEventLog(event.companyId, event, def, { skipped: true, reason });
      return { skipped: true, reason };
    }

    if (
      compareBusinessEventImportance(
        routing.importance,
        config.minImportance,
      ) < 0
    ) {
      const reason = `Below minImportance (${routing.importance} < ${config.minImportance})`;
      await recordEventLog(event.companyId, event, def, { skipped: true, reason });
      return { skipped: true, reason };
    }

    if (isInsideQuietHours(now(), config.quietHours)) {
      const reason = "Inside quiet hours";
      await recordEventLog(event.companyId, event, def, { skipped: true, reason });
      return { skipped: true, reason };
    }

    const body = renderBusinessEventTemplate(def.template.en, event.variables);
    const bodyAr = renderBusinessEventTemplate(def.template.ar, event.variables);

    const poster = state.poster;
    if (!poster) {
      const reason = "No MessagePoster wired (P11-A not active)";
      logger.debug(
        { companyId: event.companyId, eventKey: event.key },
        `event-bridge: ${reason}`,
      );
      await recordEventLog(event.companyId, event, def, { skipped: true, reason });
      return { skipped: true, reason };
    }

    try {
      const result = await poster.postSystemEvent(
        event.companyId,
        routing.channelSlug,
        body,
        {
          kind: "event",
          bodyAr,
          importance: routing.importance,
          card: def.cardType
            ? {
                type: def.cardType,
                entityId: event.entityId,
                entityType: event.entityType,
                variables: event.variables,
              }
            : undefined,
        },
      );
      const outcome: PublishEventResult = result
        ? { messageId: result.id }
        : { skipped: true, reason: "Poster returned null" };
      await recordEventLog(event.companyId, event, def, outcome);
      return outcome;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown post error";
      logger.warn(
        { err, companyId: event.companyId, eventKey: event.key },
        "event-bridge: postSystemEvent failed",
      );
      await recordEventLog(event.companyId, event, def, { skipped: true, reason });
      return { skipped: true, reason };
    }
  }

  function bindToBusinessStream(
    companyId: string,
    streamService: MinimalBusinessStreamLike,
  ): () => void {
    return streamService.subscribe(companyId, (raw) => {
      const translated = translateStreamEventToBusinessEvent(raw);
      if (!translated) return;
      // Producers may emit events without a companyId on the inner payload;
      // make sure we always preserve the bound company.
      const event: BusinessEvent = { ...translated, companyId };
      publishEvent(event).catch((err) => {
        logger.warn(
          { err, companyId, eventKey: event.key },
          "event-bridge: publishEvent threw (should not happen)",
        );
      });
    });
  }

  async function getRouting(companyId: string): Promise<EventRoutingConfig> {
    return routingStore.get(companyId);
  }

  async function setRouting(
    companyId: string,
    patch: Partial<EventRoutingConfig>,
  ): Promise<EventRoutingConfig> {
    return routingStore.set(companyId, patch);
  }

  async function getEventStats(
    companyId: string,
    rangeOpts: { from?: string; to?: string } = {},
  ): Promise<EventStats> {
    const filters = [
      eq(businessEntities.companyId, companyId),
      eq(businessEntities.moduleKey, EVENT_LOG_MODULE_KEY),
      eq(businessEntities.entityType, EVENT_LOG_ENTITY_TYPE),
    ];
    if (rangeOpts.from) {
      const fromDate = new Date(rangeOpts.from);
      if (!Number.isNaN(fromDate.getTime())) {
        filters.push(gte(businessEntities.createdAt, fromDate));
      }
    }
    if (rangeOpts.to) {
      const toDate = new Date(rangeOpts.to);
      if (!Number.isNaN(toDate.getTime())) {
        filters.push(lte(businessEntities.createdAt, toDate));
      }
    }

    let rows: Array<{
      code: string | null;
      name: string | null;
      count: number;
    }>;
    try {
      rows = await db
        .select({
          code: businessEntities.code,
          name: businessEntities.name,
          count: sql<number>`count(*)::int`,
        })
        .from(businessEntities)
        .where(and(...filters))
        .groupBy(businessEntities.code, businessEntities.name);
    } catch (err) {
      logger.warn(
        { err, companyId },
        "event-bridge: failed to compute stats",
      );
      return { totalEvents: 0, byCategory: {}, topEvents: [] };
    }

    let totalEvents = 0;
    const byCategory: Record<string, number> = {};
    const byKey = new Map<string, number>();
    for (const row of rows) {
      const count = Number(row.count) || 0;
      totalEvents += count;
      const cat = row.name ?? "uncategorized";
      byCategory[cat] = (byCategory[cat] ?? 0) + count;
      const key = row.code ?? "(unknown)";
      byKey.set(key, (byKey.get(key) ?? 0) + count);
    }
    const topEvents = Array.from(byKey.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return { totalEvents, byCategory, topEvents };
  }

  return {
    publishEvent,
    bindToBusinessStream,
    getRouting,
    setRouting,
    getEventStats,
    __setPoster(p) {
      state.poster = p;
    },
  };
}
