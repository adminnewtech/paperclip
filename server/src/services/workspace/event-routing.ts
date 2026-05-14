/**
 * Event routing configuration.
 *
 * Per-company config that decides:
 *   - which channel each event key is broadcast to (defaults inherited
 *     from BUSINESS_EVENT_CATALOG),
 *   - whether each event is disabled,
 *   - the global minimum importance threshold,
 *   - quiet hours during which no broadcasts happen.
 *
 * Stored as a businessEntities row with
 *   moduleKey   = "workspace"
 *   entityType  = "event_routing"
 *   code        = "default"
 * so the rest of the workspace plumbing (audit, scoping, RBAC) applies for
 * free.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  type BusinessEventImportance,
} from "@paperclipai/shared";

export const EVENT_ROUTING_MODULE_KEY = "workspace";
export const EVENT_ROUTING_ENTITY_TYPE = "event_routing";
export const EVENT_ROUTING_CODE = "default";

export interface EventRoutingOverride {
  channelSlug?: string;
  disabled?: boolean;
  importance?: BusinessEventImportance;
}

export interface QuietHoursConfig {
  startHour: number; // 0..23
  endHour: number; // 0..23 (exclusive)
  timezone: string; // IANA name, e.g. "Asia/Riyadh"
}

export interface EventRoutingConfig {
  routing: Record<string, EventRoutingOverride>;
  minImportance: BusinessEventImportance;
  quietHours?: QuietHoursConfig;
}

export const DEFAULT_EVENT_ROUTING_CONFIG: EventRoutingConfig = {
  routing: {},
  minImportance: "info",
};

export interface EventRoutingStore {
  get(companyId: string): Promise<EventRoutingConfig>;
  set(
    companyId: string,
    patch: Partial<EventRoutingConfig>,
  ): Promise<EventRoutingConfig>;
}

function sanitizeConfig(raw: unknown): EventRoutingConfig {
  const obj = (raw ?? {}) as Partial<EventRoutingConfig>;
  const routing: Record<string, EventRoutingOverride> = {};
  if (obj.routing && typeof obj.routing === "object") {
    for (const [key, override] of Object.entries(obj.routing)) {
      if (!override || typeof override !== "object") continue;
      const ov = override as EventRoutingOverride;
      routing[key] = {
        channelSlug:
          typeof ov.channelSlug === "string" ? ov.channelSlug : undefined,
        disabled: typeof ov.disabled === "boolean" ? ov.disabled : undefined,
        importance:
          ov.importance === "info" ||
          ov.importance === "notable" ||
          ov.importance === "important" ||
          ov.importance === "critical"
            ? ov.importance
            : undefined,
      };
    }
  }
  const minImportance: BusinessEventImportance =
    obj.minImportance === "notable" ||
    obj.minImportance === "important" ||
    obj.minImportance === "critical"
      ? obj.minImportance
      : "info";
  let quietHours: QuietHoursConfig | undefined;
  if (obj.quietHours && typeof obj.quietHours === "object") {
    const qh = obj.quietHours as Partial<QuietHoursConfig>;
    if (
      typeof qh.startHour === "number" &&
      typeof qh.endHour === "number" &&
      typeof qh.timezone === "string" &&
      qh.startHour >= 0 &&
      qh.startHour <= 23 &&
      qh.endHour >= 0 &&
      qh.endHour <= 23
    ) {
      quietHours = {
        startHour: Math.floor(qh.startHour),
        endHour: Math.floor(qh.endHour),
        timezone: qh.timezone,
      };
    }
  }
  return { routing, minImportance, quietHours };
}

export function createEventRoutingStore(db: Db): EventRoutingStore {
  async function fetchRow(companyId: string) {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, EVENT_ROUTING_MODULE_KEY),
          eq(businessEntities.entityType, EVENT_ROUTING_ENTITY_TYPE),
          eq(businessEntities.code, EVENT_ROUTING_CODE),
        ),
      );
    return row ?? null;
  }

  return {
    async get(companyId: string): Promise<EventRoutingConfig> {
      const row = await fetchRow(companyId);
      if (!row) return { ...DEFAULT_EVENT_ROUTING_CONFIG };
      return sanitizeConfig(row.data ?? {});
    },
    async set(
      companyId: string,
      patch: Partial<EventRoutingConfig>,
    ): Promise<EventRoutingConfig> {
      const existing = await fetchRow(companyId);
      const current = existing ? sanitizeConfig(existing.data ?? {}) : { ...DEFAULT_EVENT_ROUTING_CONFIG };
      const merged: EventRoutingConfig = sanitizeConfig({
        routing: { ...current.routing, ...(patch.routing ?? {}) },
        minImportance: patch.minImportance ?? current.minImportance,
        quietHours:
          patch.quietHours === null
            ? undefined
            : (patch.quietHours ?? current.quietHours),
      });

      if (existing) {
        await db
          .update(businessEntities)
          .set({
            data: merged as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          })
          .where(eq(businessEntities.id, existing.id));
      } else {
        await db.insert(businessEntities).values({
          companyId,
          moduleKey: EVENT_ROUTING_MODULE_KEY,
          entityType: EVENT_ROUTING_ENTITY_TYPE,
          code: EVENT_ROUTING_CODE,
          name: "Workspace event routing",
          status: "active",
          data: merged as unknown as Record<string, unknown>,
          tags: ["workspace", "event_routing"],
        });
      }
      return merged;
    },
  };
}

/**
 * Returns true if the given JS Date falls inside the configured quiet hours.
 * Falls back to false if the timezone is unrecognised.
 */
export function isInsideQuietHours(
  now: Date,
  quietHours: QuietHoursConfig | undefined,
): boolean {
  if (!quietHours) return false;
  const { startHour, endHour, timezone } = quietHours;
  if (startHour === endHour) return false;

  let hour: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    });
    const parts = fmt.formatToParts(now);
    const h = parts.find((p) => p.type === "hour")?.value ?? "0";
    hour = Number.parseInt(h, 10);
    if (!Number.isFinite(hour)) return false;
  } catch {
    return false;
  }

  if (startHour < endHour) {
    // Same-day window: e.g. 22 → 6 would be cross-midnight, but here it's
    // 9 → 17 (work hours, no quiet)
    return hour >= startHour && hour < endHour;
  }
  // Cross-midnight window: e.g. 22 → 6
  return hour >= startHour || hour < endHour;
}
