import { api } from "./client";

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

export interface CreateSalonServiceInput {
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

export interface ConflictDetails {
  hasConflict: boolean;
  conflictingAppointments: Array<{
    id: string;
    stylistId: string;
    startAt: string;
    endAt: string;
    status: string;
  }>;
  suggestedAlternatives?: Array<{ startAt: string; reason: string }>;
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

function basePath(companyId: string): string {
  return `/companies/${companyId}/business/salons`;
}

export const salonsApi = {
  // services
  listServices: (companyId: string) =>
    api.get<{ services: SalonServiceEntity[] }>(`${basePath(companyId)}/services`),
  createService: (companyId: string, body: CreateSalonServiceInput) =>
    api.post<SalonServiceEntity>(`${basePath(companyId)}/services`, body),
  updateService: (
    companyId: string,
    id: string,
    body: Partial<CreateSalonServiceInput>,
  ) => api.put<SalonServiceEntity>(`${basePath(companyId)}/services/${id}`, body),
  deleteService: (companyId: string, id: string) =>
    api.delete<void>(`${basePath(companyId)}/services/${id}`),

  // stylists
  listStylists: (companyId: string) =>
    api.get<{ stylists: Stylist[] }>(`${basePath(companyId)}/stylists`),
  createStylist: (companyId: string, body: CreateStylistInput) =>
    api.post<Stylist>(`${basePath(companyId)}/stylists`, body),
  updateStylist: (
    companyId: string,
    id: string,
    body: Partial<CreateStylistInput>,
  ) => api.put<Stylist>(`${basePath(companyId)}/stylists/${id}`, body),
  deleteStylist: (companyId: string, id: string) =>
    api.delete<void>(`${basePath(companyId)}/stylists/${id}`),

  // appointments
  listAppointments: (
    companyId: string,
    opts?: { from?: string; to?: string; stylistId?: string; status?: string },
  ) => {
    const params = new URLSearchParams();
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    if (opts?.stylistId) params.set("stylistId", opts.stylistId);
    if (opts?.status) params.set("status", opts.status);
    const qs = params.toString();
    return api.get<{ appointments: Appointment[] }>(
      `${basePath(companyId)}/appointments${qs ? `?${qs}` : ""}`,
    );
  },
  createAppointment: (companyId: string, body: CreateAppointmentInput) =>
    api.post<Appointment>(`${basePath(companyId)}/appointments`, body),
  updateAppointment: (
    companyId: string,
    id: string,
    body: Partial<CreateAppointmentInput>,
  ) => api.put<Appointment>(`${basePath(companyId)}/appointments/${id}`, body),
  cancelAppointment: (companyId: string, id: string, reason?: string) =>
    api.post<Appointment>(`${basePath(companyId)}/appointments/${id}/cancel`, {
      reason,
    }),
  completeAppointment: (companyId: string, id: string) =>
    api.post<Appointment>(`${basePath(companyId)}/appointments/${id}/complete`, {}),
  noShowAppointment: (companyId: string, id: string) =>
    api.post<Appointment>(`${basePath(companyId)}/appointments/${id}/no-show`, {}),
  sendReminder: (companyId: string, id: string) =>
    api.post<{ sent: boolean; channel?: string }>(
      `${basePath(companyId)}/appointments/${id}/send-reminder`,
      {},
    ),

  // slots
  availableSlots: (
    companyId: string,
    params: {
      stylistId: string;
      durationMinutes: number;
      from: string;
      to: string;
    },
  ) => {
    const qs = new URLSearchParams({
      stylistId: params.stylistId,
      durationMinutes: String(params.durationMinutes),
      from: params.from,
      to: params.to,
    });
    return api.get<{ slots: Array<{ startAt: string; endAt: string }> }>(
      `${basePath(companyId)}/available-slots?${qs.toString()}`,
    );
  },

  // setup + dashboard
  setupDefaults: (companyId: string) =>
    api.post<{ servicesCreated: number; stylistsCreated: number }>(
      `${basePath(companyId)}/setup-defaults`,
      {},
    ),
  dashboard: (companyId: string) =>
    api.get<SalonDashboard>(`${basePath(companyId)}/dashboard`),
};
