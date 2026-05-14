// ---------------------------------------------------------------------------
// Salon vertical service
// ---------------------------------------------------------------------------
//
// All salon-vertical entities (services, stylists, appointments) live inside
// the generic `businessEntities` table under `moduleKey: "salons"`, so they
// inherit the same audit / search / RBAC infrastructure as every other module.
//
// The service centralises:
//   - CRUD for services, stylists, appointments
//   - auto-numbering (SVC, STY, APT)
//   - status transitions (cancel/complete/no-show)
//   - dashboard aggregates
//   - setup-defaults (seed catalog + sample stylists)
//
// Conflict detection is delegated to AppointmentEngine.

import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type { BusinessMessagingService } from "../../business-messaging-service.js";
import {
  createAppointmentEngine,
  type AppointmentEngine,
} from "./appointment-engine.js";
import {
  DEFAULT_SALON_SERVICES,
  DEFAULT_SALON_STYLISTS,
} from "./salon-defaults.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export interface SalonServiceEntity {
  id: string;
  code: string | null;
  name: string;
  nameAr?: string;
  category: string;
  durationMinutes: number;
  priceCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceInput {
  name: string;
  nameAr?: string;
  category?: string;
  durationMinutes: number;
  priceCents: number;
}

export interface Stylist {
  id: string;
  code: string | null;
  name: string;
  email?: string;
  phone?: string;
  specialties: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateStylistInput {
  name: string;
  email?: string;
  phone?: string;
  specialties?: string[];
}

export interface Appointment {
  id: string;
  code: string;
  clientId?: string;
  clientName: string;
  clientPhone?: string;
  stylistId: string;
  stylistName: string;
  serviceId: string;
  serviceName: string;
  serviceDurationMinutes: number;
  servicePriceCents: number;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  notes?: string;
  reminderSentAt?: string;
  sendReminderHoursBefore: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppointmentInput {
  clientId?: string;
  clientName?: string;
  clientPhone?: string;
  stylistId: string;
  serviceId: string;
  startAt: string;
  notes?: string;
  sendReminderHoursBefore?: number;
}

export interface SalonDashboard {
  todayAppointments: Appointment[];
  upcomingWeek: Appointment[];
  noShowRate30d: number;
  topServices: Array<{
    serviceId: string;
    serviceName: string;
    bookings: number;
    revenueCents: number;
  }>;
  topStylists: Array<{
    stylistId: string;
    stylistName: string;
    bookings: number;
    revenueCents: number;
  }>;
  revenueThisMonth: number;
  appointmentsThisMonth: number;
  unconfirmedCount: number;
}

export interface ListAppointmentsOpts {
  from?: string;
  to?: string;
  stylistId?: string;
  status?: string;
}

export interface SalonService {
  // services
  listServices(companyId: string): Promise<SalonServiceEntity[]>;
  getService(
    companyId: string,
    id: string,
  ): Promise<SalonServiceEntity | null>;
  createService(
    companyId: string,
    input: CreateServiceInput,
  ): Promise<SalonServiceEntity>;
  updateService(
    companyId: string,
    id: string,
    input: Partial<CreateServiceInput>,
  ): Promise<SalonServiceEntity>;
  deleteService(companyId: string, id: string): Promise<void>;

  // stylists
  listStylists(companyId: string): Promise<Stylist[]>;
  getStylist(companyId: string, id: string): Promise<Stylist | null>;
  createStylist(companyId: string, input: CreateStylistInput): Promise<Stylist>;
  updateStylist(
    companyId: string,
    id: string,
    input: Partial<CreateStylistInput>,
  ): Promise<Stylist>;
  deleteStylist(companyId: string, id: string): Promise<void>;

  // appointments
  listAppointments(
    companyId: string,
    opts?: ListAppointmentsOpts,
  ): Promise<Appointment[]>;
  getAppointment(
    companyId: string,
    id: string,
  ): Promise<Appointment | null>;
  createAppointment(
    companyId: string,
    input: CreateAppointmentInput,
  ): Promise<Appointment>;
  updateAppointment(
    companyId: string,
    id: string,
    input: Partial<CreateAppointmentInput>,
  ): Promise<Appointment>;
  cancelAppointment(
    companyId: string,
    id: string,
    reason?: string,
  ): Promise<Appointment>;
  markCompleted(companyId: string, id: string): Promise<Appointment>;
  markNoShow(companyId: string, id: string): Promise<Appointment>;

  // setup + dashboard
  setupDefaults(companyId: string): Promise<{
    servicesCreated: number;
    stylistsCreated: number;
  }>;
  getDashboard(companyId: string): Promise<SalonDashboard>;

  // exposes engine for routes
  readonly engine: AppointmentEngine;

  /** Stop background reminder scheduler. */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  companyId: string;
  moduleKey: string;
  entityType: string;
  code: string | null;
  name: string | null;
  status: string | null;
  amountCents: number | null;
  currency: string | null;
  data: Record<string, unknown> | null;
  tags: string[] | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function isoDate(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

function readService(row: Row): SalonServiceEntity {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    code: row.code,
    name: row.name ?? (typeof data.name === "string" ? data.name : ""),
    nameAr: typeof data.nameAr === "string" ? data.nameAr : undefined,
    category: typeof data.category === "string" ? data.category : "General",
    durationMinutes:
      typeof data.durationMinutes === "number" ? data.durationMinutes : 30,
    priceCents: row.amountCents ?? 0,
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  };
}

function readStylist(row: Row): Stylist {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    code: row.code,
    name: row.name ?? (typeof data.name === "string" ? data.name : ""),
    email: typeof data.email === "string" ? data.email : undefined,
    phone: typeof data.phone === "string" ? data.phone : undefined,
    specialties: Array.isArray(data.specialties)
      ? (data.specialties as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  };
}

function readAppointment(row: Row): Appointment {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const startAt =
    typeof data.startAt === "string" ? data.startAt : new Date().toISOString();
  const endAt =
    typeof data.endAt === "string" ? data.endAt : new Date().toISOString();
  const status = (row.status ?? "scheduled") as AppointmentStatus;
  return {
    id: row.id,
    code: row.code ?? "",
    clientId: typeof data.clientId === "string" ? data.clientId : undefined,
    clientName:
      typeof data.clientName === "string" ? data.clientName : "Unknown",
    clientPhone:
      typeof data.clientPhone === "string" ? data.clientPhone : undefined,
    stylistId: typeof data.stylistId === "string" ? data.stylistId : "",
    stylistName:
      typeof data.stylistName === "string" ? data.stylistName : "",
    serviceId: typeof data.serviceId === "string" ? data.serviceId : "",
    serviceName:
      typeof data.serviceName === "string" ? data.serviceName : "",
    serviceDurationMinutes:
      typeof data.serviceDurationMinutes === "number"
        ? data.serviceDurationMinutes
        : 30,
    servicePriceCents:
      typeof data.servicePriceCents === "number"
        ? data.servicePriceCents
        : row.amountCents ?? 0,
    startAt,
    endAt,
    status,
    notes: typeof data.notes === "string" ? data.notes : undefined,
    reminderSentAt:
      typeof data.reminderSentAt === "string"
        ? data.reminderSentAt
        : undefined,
    sendReminderHoursBefore:
      typeof data.sendReminderHoursBefore === "number"
        ? data.sendReminderHoursBefore
        : 24,
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  };
}

async function nextSequentialCode(
  db: Db,
  companyId: string,
  entityType: string,
  prefix: string,
  withYear: boolean,
): Promise<string> {
  if (withYear) {
    const year = new Date().getFullYear();
    const rows = await db
      .select({ code: businessEntities.code })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, entityType),
          ilike(businessEntities.code, `${prefix}-${year}-%`),
        ),
      )
      .orderBy(desc(businessEntities.code))
      .limit(1);
    let num = 1;
    const last = rows[0]?.code;
    if (last) {
      const parts = last.split("-");
      const n = parseInt(parts[parts.length - 1] ?? "0", 10);
      if (!Number.isNaN(n)) num = n + 1;
    }
    return `${prefix}-${year}-${String(num).padStart(4, "0")}`;
  }

  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "salons"),
        eq(businessEntities.entityType, entityType),
        ilike(businessEntities.code, `${prefix}-%`),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);
  let num = 1;
  const last = rows[0]?.code;
  if (last) {
    const parts = last.split("-");
    const n = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!Number.isNaN(n)) num = n + 1;
  }
  return `${prefix}-${String(num).padStart(3, "0")}`;
}

function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSalonService(
  db: Db,
  messagingService: BusinessMessagingService,
): SalonService {
  const engine = createAppointmentEngine(db, messagingService);

  // ---------------- Services ----------------
  async function listServices(companyId: string): Promise<SalonServiceEntity[]> {
    const rows = (await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "service"),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))) as unknown as Row[];
    return rows.map(readService);
  }

  async function getService(
    companyId: string,
    id: string,
  ): Promise<SalonServiceEntity | null> {
    const [row] = (await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "service"),
        ),
      )) as unknown as Row[];
    return row ? readService(row) : null;
  }

  async function createService(
    companyId: string,
    input: CreateServiceInput,
  ): Promise<SalonServiceEntity> {
    const code = await nextSequentialCode(db, companyId, "service", "SVC", false);
    const now = new Date();
    const [row] = (await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "salons",
        entityType: "service",
        code,
        name: input.name,
        status: "active",
        amountCents: input.priceCents,
        currency: "KWD",
        data: {
          name: input.name,
          nameAr: input.nameAr,
          category: input.category ?? "General",
          durationMinutes: input.durationMinutes,
          priceCents: input.priceCents,
        },
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as unknown as Row[];
    return readService(row!);
  }

  async function updateService(
    companyId: string,
    id: string,
    input: Partial<CreateServiceInput>,
  ): Promise<SalonServiceEntity> {
    const current = await getService(companyId, id);
    if (!current) throw new Error("Service not found");
    const now = new Date();
    const data = {
      name: input.name ?? current.name,
      nameAr: input.nameAr ?? current.nameAr,
      category: input.category ?? current.category,
      durationMinutes: input.durationMinutes ?? current.durationMinutes,
      priceCents: input.priceCents ?? current.priceCents,
    };
    const [row] = (await db
      .update(businessEntities)
      .set({
        name: data.name,
        amountCents: data.priceCents,
        data,
        updatedAt: now,
      })
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "service"),
        ),
      )
      .returning()) as unknown as Row[];
    return readService(row!);
  }

  async function deleteService(companyId: string, id: string): Promise<void> {
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "service"),
        ),
      );
  }

  // ---------------- Stylists ----------------
  async function listStylists(companyId: string): Promise<Stylist[]> {
    const rows = (await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "stylist"),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))) as unknown as Row[];
    return rows.map(readStylist);
  }

  async function getStylist(
    companyId: string,
    id: string,
  ): Promise<Stylist | null> {
    const [row] = (await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "stylist"),
        ),
      )) as unknown as Row[];
    return row ? readStylist(row) : null;
  }

  async function createStylist(
    companyId: string,
    input: CreateStylistInput,
  ): Promise<Stylist> {
    const code = await nextSequentialCode(db, companyId, "stylist", "STY", false);
    const now = new Date();
    const [row] = (await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "salons",
        entityType: "stylist",
        code,
        name: input.name,
        status: "active",
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          specialties: input.specialties ?? [],
        },
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as unknown as Row[];
    return readStylist(row!);
  }

  async function updateStylist(
    companyId: string,
    id: string,
    input: Partial<CreateStylistInput>,
  ): Promise<Stylist> {
    const current = await getStylist(companyId, id);
    if (!current) throw new Error("Stylist not found");
    const now = new Date();
    const data = {
      name: input.name ?? current.name,
      email: input.email ?? current.email,
      phone: input.phone ?? current.phone,
      specialties: input.specialties ?? current.specialties,
    };
    const [row] = (await db
      .update(businessEntities)
      .set({ name: data.name, data, updatedAt: now })
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "stylist"),
        ),
      )
      .returning()) as unknown as Row[];
    return readStylist(row!);
  }

  async function deleteStylist(companyId: string, id: string): Promise<void> {
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "stylist"),
        ),
      );
  }

  // ---------------- Appointments ----------------
  async function listAppointments(
    companyId: string,
    opts?: ListAppointmentsOpts,
  ): Promise<Appointment[]> {
    const rows = (await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "appointment"),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))) as unknown as Row[];

    let appts = rows.map(readAppointment);
    if (opts?.from) {
      const fromMs = new Date(opts.from).getTime();
      appts = appts.filter((a) => new Date(a.startAt).getTime() >= fromMs);
    }
    if (opts?.to) {
      const toMs = new Date(opts.to).getTime();
      appts = appts.filter((a) => new Date(a.startAt).getTime() <= toMs);
    }
    if (opts?.stylistId) {
      appts = appts.filter((a) => a.stylistId === opts.stylistId);
    }
    if (opts?.status) {
      appts = appts.filter((a) => a.status === opts.status);
    }
    appts.sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
    return appts;
  }

  async function getAppointment(
    companyId: string,
    id: string,
  ): Promise<Appointment | null> {
    const [row] = (await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "appointment"),
        ),
      )) as unknown as Row[];
    return row ? readAppointment(row) : null;
  }

  async function createAppointment(
    companyId: string,
    input: CreateAppointmentInput,
  ): Promise<Appointment> {
    const stylist = await getStylist(companyId, input.stylistId);
    if (!stylist) throw new Error("Stylist not found");
    const service = await getService(companyId, input.serviceId);
    if (!service) throw new Error("Service not found");

    // Conflict check
    const conflict = await engine.checkConflict(
      companyId,
      input.stylistId,
      input.startAt,
      service.durationMinutes,
    );
    if (conflict.hasConflict) {
      const err = new Error("Stylist is not available at the requested time");
      (err as Error & { code?: string; details?: unknown }).code =
        "APPOINTMENT_CONFLICT";
      (err as Error & { code?: string; details?: unknown }).details = conflict;
      throw err;
    }

    let clientName = input.clientName ?? "Walk-in client";
    let clientPhone = input.clientPhone;
    if (input.clientId) {
      const [c] = (await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.id, input.clientId),
            eq(businessEntities.companyId, companyId),
          ),
        )) as unknown as Row[];
      if (c) {
        clientName = c.name ?? clientName;
        const cData = (c.data ?? {}) as Record<string, unknown>;
        if (!clientPhone && typeof cData.phone === "string") {
          clientPhone = cData.phone;
        }
      }
    }

    const startAt = new Date(input.startAt);
    const endAt = addMinutes(startAt, service.durationMinutes);
    const code = await nextSequentialCode(
      db,
      companyId,
      "appointment",
      "APT",
      true,
    );
    const now = new Date();
    const data = {
      clientId: input.clientId,
      clientName,
      clientPhone,
      stylistId: stylist.id,
      stylistName: stylist.name,
      serviceId: service.id,
      serviceName: service.name,
      serviceDurationMinutes: service.durationMinutes,
      servicePriceCents: service.priceCents,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      notes: input.notes,
      sendReminderHoursBefore: input.sendReminderHoursBefore ?? 24,
    };
    const [row] = (await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "salons",
        entityType: "appointment",
        code,
        name: `${clientName} — ${service.name}`,
        status: "scheduled",
        amountCents: service.priceCents,
        currency: "KWD",
        data,
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as unknown as Row[];
    return readAppointment(row!);
  }

  async function updateAppointment(
    companyId: string,
    id: string,
    input: Partial<CreateAppointmentInput>,
  ): Promise<Appointment> {
    const current = await getAppointment(companyId, id);
    if (!current) throw new Error("Appointment not found");

    let serviceDurationMinutes = current.serviceDurationMinutes;
    let serviceName = current.serviceName;
    let servicePriceCents = current.servicePriceCents;
    let serviceId = current.serviceId;
    if (input.serviceId && input.serviceId !== current.serviceId) {
      const service = await getService(companyId, input.serviceId);
      if (!service) throw new Error("Service not found");
      serviceDurationMinutes = service.durationMinutes;
      serviceName = service.name;
      servicePriceCents = service.priceCents;
      serviceId = service.id;
    }

    let stylistId = current.stylistId;
    let stylistName = current.stylistName;
    if (input.stylistId && input.stylistId !== current.stylistId) {
      const stylist = await getStylist(companyId, input.stylistId);
      if (!stylist) throw new Error("Stylist not found");
      stylistId = stylist.id;
      stylistName = stylist.name;
    }

    const startAt = input.startAt
      ? new Date(input.startAt)
      : new Date(current.startAt);
    const endAt = addMinutes(startAt, serviceDurationMinutes);

    // Conflict check when stylist or time changed.
    if (input.stylistId || input.startAt || input.serviceId) {
      const conflict = await engine.checkConflict(
        companyId,
        stylistId,
        startAt.toISOString(),
        serviceDurationMinutes,
        id,
      );
      if (conflict.hasConflict) {
        const err = new Error("Stylist is not available at the requested time");
        (err as Error & { code?: string; details?: unknown }).code =
          "APPOINTMENT_CONFLICT";
        (err as Error & { code?: string; details?: unknown }).details =
          conflict;
        throw err;
      }
    }

    const now = new Date();
    const data: Record<string, unknown> = {
      clientId: input.clientId ?? current.clientId,
      clientName: input.clientName ?? current.clientName,
      clientPhone: input.clientPhone ?? current.clientPhone,
      stylistId,
      stylistName,
      serviceId,
      serviceName,
      serviceDurationMinutes,
      servicePriceCents,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      notes: input.notes ?? current.notes,
      sendReminderHoursBefore:
        input.sendReminderHoursBefore ?? current.sendReminderHoursBefore,
    };
    if (current.reminderSentAt) data.reminderSentAt = current.reminderSentAt;

    const [row] = (await db
      .update(businessEntities)
      .set({
        name: `${data.clientName as string} — ${serviceName}`,
        amountCents: servicePriceCents,
        data,
        updatedAt: now,
      })
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "appointment"),
        ),
      )
      .returning()) as unknown as Row[];
    return readAppointment(row!);
  }

  async function setAppointmentStatus(
    companyId: string,
    id: string,
    status: AppointmentStatus,
    extraData?: Record<string, unknown>,
  ): Promise<Appointment> {
    const current = await getAppointment(companyId, id);
    if (!current) throw new Error("Appointment not found");
    const now = new Date();
    const data: Record<string, unknown> = {
      ...current,
      ...extraData,
    };
    // Strip top-level fields we don't want to duplicate from the readAppointment shape.
    delete data.id;
    delete data.code;
    delete data.status;
    delete data.createdAt;
    delete data.updatedAt;

    const [row] = (await db
      .update(businessEntities)
      .set({ status, data, updatedAt: now })
      .where(
        and(
          eq(businessEntities.id, id),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "salons"),
          eq(businessEntities.entityType, "appointment"),
        ),
      )
      .returning()) as unknown as Row[];
    return readAppointment(row!);
  }

  async function cancelAppointment(
    companyId: string,
    id: string,
    reason?: string,
  ): Promise<Appointment> {
    return setAppointmentStatus(companyId, id, "cancelled", {
      cancellationReason: reason,
      cancelledAt: new Date().toISOString(),
    });
  }

  async function markCompleted(
    companyId: string,
    id: string,
  ): Promise<Appointment> {
    return setAppointmentStatus(companyId, id, "completed", {
      completedAt: new Date().toISOString(),
    });
  }

  async function markNoShow(
    companyId: string,
    id: string,
  ): Promise<Appointment> {
    return setAppointmentStatus(companyId, id, "no_show", {
      noShowAt: new Date().toISOString(),
    });
  }

  // ---------------- Setup defaults ----------------
  async function setupDefaults(
    companyId: string,
  ): Promise<{ servicesCreated: number; stylistsCreated: number }> {
    const existingServices = await listServices(companyId);
    let servicesCreated = 0;
    if (existingServices.length === 0) {
      for (const s of DEFAULT_SALON_SERVICES) {
        await createService(companyId, {
          name: s.name,
          nameAr: s.nameAr,
          category: s.category,
          durationMinutes: s.durationMinutes,
          priceCents: s.priceCents,
        });
        servicesCreated++;
      }
    }

    const existingStylists = await listStylists(companyId);
    let stylistsCreated = 0;
    if (existingStylists.length === 0) {
      for (const s of DEFAULT_SALON_STYLISTS) {
        await createStylist(companyId, {
          name: s.name,
          email: s.email,
          phone: s.phone,
          specialties: s.specialties,
        });
        stylistsCreated++;
      }
    }
    return { servicesCreated, stylistsCreated };
  }

  // ---------------- Dashboard ----------------
  async function getDashboard(companyId: string): Promise<SalonDashboard> {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60_000);
    const startOfWeekAhead = new Date(
      startOfToday.getTime() + 7 * 24 * 60 * 60_000,
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

    const allAppts = await listAppointments(companyId);

    const todayAppointments = allAppts.filter((a) => {
      const t = new Date(a.startAt).getTime();
      return t >= startOfToday.getTime() && t < startOfTomorrow.getTime();
    });

    const upcomingWeek = allAppts.filter((a) => {
      const t = new Date(a.startAt).getTime();
      return t >= now.getTime() && t < startOfWeekAhead.getTime();
    });

    // No-show rate (last 30 days, looking at completed/no_show/cancelled)
    const last30 = allAppts.filter((a) => {
      const t = new Date(a.startAt).getTime();
      return t >= thirtyDaysAgo.getTime() && t <= now.getTime();
    });
    const resolved = last30.filter((a) =>
      ["completed", "no_show", "cancelled"].includes(a.status),
    );
    const noShows = resolved.filter((a) => a.status === "no_show").length;
    const noShowRate30d = resolved.length > 0 ? noShows / resolved.length : 0;

    // Top services / stylists this month (by completed bookings)
    const monthAppts = allAppts.filter((a) => {
      const t = new Date(a.startAt).getTime();
      return t >= startOfMonth.getTime() && t <= endOfMonth.getTime();
    });
    const byService = new Map<
      string,
      { serviceName: string; bookings: number; revenueCents: number }
    >();
    const byStylist = new Map<
      string,
      { stylistName: string; bookings: number; revenueCents: number }
    >();
    let revenueThisMonth = 0;
    for (const a of monthAppts) {
      const completed = a.status === "completed";
      const s = byService.get(a.serviceId) ?? {
        serviceName: a.serviceName,
        bookings: 0,
        revenueCents: 0,
      };
      s.bookings += 1;
      if (completed) s.revenueCents += a.servicePriceCents;
      byService.set(a.serviceId, s);

      const st = byStylist.get(a.stylistId) ?? {
        stylistName: a.stylistName,
        bookings: 0,
        revenueCents: 0,
      };
      st.bookings += 1;
      if (completed) st.revenueCents += a.servicePriceCents;
      byStylist.set(a.stylistId, st);

      if (completed) revenueThisMonth += a.servicePriceCents;
    }

    const topServices = Array.from(byService.entries())
      .map(([serviceId, v]) => ({ serviceId, ...v }))
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 5);
    const topStylists = Array.from(byStylist.entries())
      .map(([stylistId, v]) => ({ stylistId, ...v }))
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 5);

    const unconfirmedCount = upcomingWeek.filter(
      (a) => a.status === "scheduled",
    ).length;

    return {
      todayAppointments,
      upcomingWeek,
      noShowRate30d,
      topServices,
      topStylists,
      revenueThisMonth,
      appointmentsThisMonth: monthAppts.length,
      unconfirmedCount,
    };
  }

  // Avoid unused-imports lint failure for `gte`, `lte`, `sql` in case they're
  // useful for future optimisations (e.g. pushing date filters into SQL). They
  // are referenced here as a future-proofing hint without affecting runtime.
  void gte;
  void lte;
  void sql;

  function stop() {
    engine.stop();
  }

  return {
    listServices,
    getService,
    createService,
    updateService,
    deleteService,

    listStylists,
    getStylist,
    createStylist,
    updateStylist,
    deleteStylist,

    listAppointments,
    getAppointment,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    markCompleted,
    markNoShow,

    setupDefaults,
    getDashboard,

    engine,
    stop,
  };
}

export type { AppointmentEngine } from "./appointment-engine.js";
