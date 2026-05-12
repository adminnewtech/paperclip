// ---------------------------------------------------------------------------
// Appointment Engine
// ---------------------------------------------------------------------------
//
// Centralises:
//   - conflict detection (no double-booking of a stylist)
//   - available-slot search
//   - due-reminder scheduling (setInterval, unref'd)
//
// This engine is deliberately storage-agnostic: it accepts a Db and reads
// appointments via the generic `businessEntities` table, so it can be reused
// by other verticals (e.g. clinics, fitness classes) that have a "schedulable
// resource + time slot" shape.

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { logger } from "../../../middleware/logger.js";
import type { BusinessMessagingService } from "../../business-messaging-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppointmentLike {
  id: string;
  stylistId: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingAppointments: AppointmentLike[];
  suggestedAlternatives?: Array<{ startAt: string; reason: string }>;
}

export interface FindSlotsOpts {
  from: string;
  to: string;
  preferredHourStart?: number;
  preferredHourEnd?: number;
  /** Minimum slot resolution in minutes; default 15. */
  slotStepMinutes?: number;
}

export interface AppointmentEngine {
  checkConflict(
    companyId: string,
    stylistId: string,
    startAt: string,
    durationMinutes: number,
    excludeAppointmentId?: string,
  ): Promise<ConflictCheckResult>;
  findAvailableSlots(
    companyId: string,
    stylistId: string,
    serviceDurationMinutes: number,
    opts: FindSlotsOpts,
  ): Promise<Array<{ startAt: string; endAt: string }>>;
  sendReminder(
    companyId: string,
    appointmentId: string,
  ): Promise<{ sent: boolean; channel?: string }>;
  processDueReminders(): Promise<{ sent: number; failed: number }>;
  /** Stop the background reminder scheduler (if started). */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseISO(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ISO datetime: ${s}`);
  }
  return d;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  // Two intervals overlap iff aStart < bEnd && bStart < aEnd.
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

// Active appointment statuses that should block conflict checks. Cancelled
// and no-show appointments do not block the slot.
const ACTIVE_STATUSES = new Set([
  "scheduled",
  "confirmed",
  "in_progress",
]);

interface AppointmentRow {
  id: string;
  companyId: string;
  status: string | null;
  data: Record<string, unknown> | null;
}

function readAppointment(row: AppointmentRow): AppointmentLike | null {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const stylistId =
    typeof data.stylistId === "string" ? data.stylistId : undefined;
  const startAt = typeof data.startAt === "string" ? data.startAt : undefined;
  const endAt = typeof data.endAt === "string" ? data.endAt : undefined;
  if (!stylistId || !startAt || !endAt) return null;
  return {
    id: row.id,
    stylistId,
    startAt,
    endAt,
    status: row.status ?? "scheduled",
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAppointmentEngine(
  db: Db,
  messagingService: BusinessMessagingService,
): AppointmentEngine {
  // Load all active appointments for a stylist that overlap a query window.
  // Drizzle does not strongly type the `data` JSONB column for arbitrary
  // queries, so we pull a wider slice and filter in memory.
  async function loadStylistAppointments(
    companyId: string,
    stylistId: string,
    from: Date,
    to: Date,
  ): Promise<AppointmentLike[]> {
    const rows = (await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "appointment"),
          sql`(data->>'stylistId') = ${stylistId}`,
        ),
      )) as unknown as AppointmentRow[];

    const out: AppointmentLike[] = [];
    for (const row of rows) {
      const appt = readAppointment(row);
      if (!appt) continue;
      if (!ACTIVE_STATUSES.has(appt.status)) continue;
      const aStart = parseISO(appt.startAt);
      const aEnd = parseISO(appt.endAt);
      if (overlaps(aStart, aEnd, from, to)) out.push(appt);
    }
    return out;
  }

  async function checkConflict(
    companyId: string,
    stylistId: string,
    startAt: string,
    durationMinutes: number,
    excludeAppointmentId?: string,
  ): Promise<ConflictCheckResult> {
    const start = parseISO(startAt);
    const end = addMinutes(start, durationMinutes);

    // Pull a slightly wider window (+/- 6h) so we can also suggest alternates.
    const windowStart = addMinutes(start, -6 * 60);
    const windowEnd = addMinutes(end, 6 * 60);
    const candidates = await loadStylistAppointments(
      companyId,
      stylistId,
      windowStart,
      windowEnd,
    );

    const conflicts = candidates.filter((c) => {
      if (excludeAppointmentId && c.id === excludeAppointmentId) return false;
      return overlaps(start, end, parseISO(c.startAt), parseISO(c.endAt));
    });

    if (conflicts.length === 0) {
      return { hasConflict: false, conflictingAppointments: [] };
    }

    // Suggest alternates: same day +/- 1h, then next day same time.
    const suggestions: Array<{ startAt: string; reason: string }> = [];
    const offsets: Array<{ minutes: number; reason: string }> = [
      { minutes: 60, reason: "1 hour later, same day" },
      { minutes: -60, reason: "1 hour earlier, same day" },
      { minutes: 2 * 60, reason: "2 hours later, same day" },
      { minutes: 24 * 60, reason: "Same time tomorrow" },
    ];
    for (const o of offsets) {
      const alt = addMinutes(start, o.minutes);
      const altEnd = addMinutes(alt, durationMinutes);
      const blocked = candidates.some((c) => {
        if (excludeAppointmentId && c.id === excludeAppointmentId) return false;
        return overlaps(alt, altEnd, parseISO(c.startAt), parseISO(c.endAt));
      });
      if (!blocked) {
        suggestions.push({ startAt: alt.toISOString(), reason: o.reason });
      }
      if (suggestions.length >= 3) break;
    }

    return {
      hasConflict: true,
      conflictingAppointments: conflicts,
      suggestedAlternatives: suggestions,
    };
  }

  async function findAvailableSlots(
    companyId: string,
    stylistId: string,
    serviceDurationMinutes: number,
    opts: FindSlotsOpts,
  ): Promise<Array<{ startAt: string; endAt: string }>> {
    const from = parseISO(opts.from);
    const to = parseISO(opts.to);
    if (to.getTime() <= from.getTime()) return [];

    const step = opts.slotStepMinutes ?? 15;
    const existing = await loadStylistAppointments(
      companyId,
      stylistId,
      from,
      to,
    );

    const hourStart = opts.preferredHourStart ?? 9;
    const hourEnd = opts.preferredHourEnd ?? 21;
    const out: Array<{ startAt: string; endAt: string }> = [];

    for (
      let t = from.getTime();
      t + serviceDurationMinutes * 60_000 <= to.getTime();
      t += step * 60_000
    ) {
      const slotStart = new Date(t);
      const slotEnd = addMinutes(slotStart, serviceDurationMinutes);
      const hour = slotStart.getUTCHours();
      if (hour < hourStart || hour >= hourEnd) continue;

      const blocked = existing.some((c) =>
        overlaps(slotStart, slotEnd, parseISO(c.startAt), parseISO(c.endAt)),
      );
      if (!blocked) {
        out.push({
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
        });
      }
      if (out.length >= 100) break; // cap
    }
    return out;
  }

  async function sendReminder(
    companyId: string,
    appointmentId: string,
  ): Promise<{ sent: boolean; channel?: string }> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, appointmentId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "appointment"),
        ),
      );
    if (!row) return { sent: false };
    const data = (row.data ?? {}) as Record<string, unknown>;
    const phone =
      typeof data.clientPhone === "string" && data.clientPhone.length > 0
        ? data.clientPhone
        : null;
    if (!phone) return { sent: false };
    const channel: "whatsapp" | "sms" = "whatsapp";
    const clientName =
      typeof data.clientName === "string" ? data.clientName : "Customer";
    const serviceName =
      typeof data.serviceName === "string" ? data.serviceName : "your appointment";
    const startAt =
      typeof data.startAt === "string" ? data.startAt : new Date().toISOString();
    const when = new Date(startAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const body = `Hi ${clientName}, this is a reminder for your ${serviceName} appointment on ${when}. Reply CANCEL to cancel.`;
    const result = await messagingService.send(companyId, {
      channel,
      toPhone: phone,
      body,
      templateKey: "appointment_reminder",
      relatedEntityId: appointmentId,
    });
    if (!result.ok) return { sent: false, channel };

    // Mark reminderSentAt
    const now = new Date();
    await db
      .update(businessEntities)
      .set({
        data: { ...data, reminderSentAt: now.toISOString() },
        updatedAt: now,
      })
      .where(eq(businessEntities.id, appointmentId));

    return { sent: true, channel };
  }

  async function processDueReminders(): Promise<{ sent: number; failed: number }> {
    const now = new Date();
    const lookahead = addMinutes(now, 48 * 60); // next 48h
    const rows = (await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "appointment"),
        ),
      )) as unknown as Array<{
      id: string;
      companyId: string;
      status: string | null;
      data: Record<string, unknown> | null;
    }>;

    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      if (typeof data.reminderSentAt === "string") continue;
      if (!ACTIVE_STATUSES.has(row.status ?? "")) continue;
      const startAt =
        typeof data.startAt === "string" ? new Date(data.startAt) : null;
      if (!startAt || Number.isNaN(startAt.getTime())) continue;
      if (startAt.getTime() < now.getTime()) continue;
      if (startAt.getTime() > lookahead.getTime()) continue;
      const hoursBefore =
        typeof data.sendReminderHoursBefore === "number"
          ? data.sendReminderHoursBefore
          : 24;
      const dueAt = new Date(startAt.getTime() - hoursBefore * 60 * 60_000);
      if (dueAt.getTime() > now.getTime()) continue;
      try {
        const r = await sendReminder(row.companyId, row.id);
        if (r.sent) sent++;
        else failed++;
      } catch (err) {
        logger.warn(
          { err, appointmentId: row.id },
          "appointment reminder failed",
        );
        failed++;
      }
    }
    return { sent, failed };
  }

  // Background scheduler (every 60s, unref'd so it never blocks shutdown).
  const intervalMs = 60_000;
  let timer: NodeJS.Timeout | null = setInterval(() => {
    processDueReminders().catch((err) => {
      logger.warn({ err }, "appointment reminder scheduler tick failed");
    });
  }, intervalMs);
  timer.unref();

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    checkConflict,
    findAvailableSlots,
    sendReminder,
    processDueReminders,
    stop,
  };
}
