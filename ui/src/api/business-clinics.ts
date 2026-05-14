import { api } from "./client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BloodType =
  | "A+"
  | "A-"
  | "B+"
  | "B-"
  | "AB+"
  | "AB-"
  | "O+"
  | "O-"
  | "unknown";

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

export interface InsuranceInfo {
  provider: string;
  policyNumber: string;
  expiresAt?: string;
  coveragePercent?: number;
}

export interface Patient {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  firstNameAr?: string;
  lastNameAr?: string;
  fullName: string;
  dateOfBirth: string;
  gender: "male" | "female" | "other";
  nationality?: string;
  civilId?: string;
  passport?: string;
  phone: string;
  email?: string;
  address?: string;
  emergencyContact?: EmergencyContact;
  bloodType?: BloodType;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  familyHistory: string[];
  insurance?: InsuranceInfo;
  firstVisitAt?: string;
  lastVisitAt?: string;
  totalVisits: number;
  notes?: string;
  flagged?: boolean;
}

export type ClinicAppointmentType =
  | "consultation"
  | "follow_up"
  | "procedure"
  | "vaccination"
  | "test";

export type ClinicAppointmentStatus =
  | "scheduled"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export interface ClinicAppointment {
  id: string;
  code: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  startAt: string;
  durationMinutes: number;
  type: ClinicAppointmentType;
  status: ClinicAppointmentStatus;
  chiefComplaint?: string;
  visitId?: string;
  reminderSentAt?: string;
}

export interface Vitals {
  bloodPressure?: string;
  heartRate?: number;
  temperatureCelsius?: number;
  respiratoryRate?: number;
  weightKg?: number;
  heightCm?: number;
  bmi?: number;
  oxygenSaturation?: number;
}

export interface Prescription {
  drug: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  quantity?: string;
  instructions?: string;
  refillsAllowed?: number;
}

export type LabOrderStatus = "ordered" | "in_progress" | "completed" | "cancelled";

export interface LabOrder {
  testCode: string;
  testName: string;
  status: LabOrderStatus;
  orderedAt: string;
  resultedAt?: string;
  result?: string;
  abnormal?: boolean;
}

export type VisitStatus = "draft" | "completed" | "signed";

export interface Visit {
  id: string;
  code: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  date: string;
  type: ClinicAppointmentType;
  subjective: string;
  objective: string;
  vitals?: Vitals;
  assessment: string;
  diagnosisCodes?: string[];
  plan: string;
  prescriptions: Prescription[];
  labOrders: LabOrder[];
  attachments?: Array<{ id: string; type: string; filename: string }>;
  status: VisitStatus;
  signedAt?: string;
  signedBy?: string;
  followUpInDays?: number;
  totalChargeCents: number;
  insuranceCoveredCents: number;
  patientPayCents: number;
}

export interface WorkingHourSlot {
  day: string;
  from: string;
  to: string;
}

export interface Doctor {
  id: string;
  code: string;
  name: string;
  nameAr?: string;
  specialty: string;
  licenseNumber: string;
  phone?: string;
  email?: string;
  workingHours: WorkingHourSlot[];
  consultationFeeCents: number;
}

export interface ClinicDashboard {
  patientsTotal: number;
  appointmentsToday: number;
  appointmentsThisWeek: number;
  visitsThisMonth: number;
  revenueThisMonth: number;
  topDoctors: Array<{ doctorId: string; name: string; visits: number }>;
  recentPatients: Patient[];
  unsignedVisits: number;
}

export interface ClinicCatalog {
  specialties: Array<{ name: string; nameAr: string; consultationFeeCents: number }>;
  icd10: Array<{ code: string; description: string }>;
  labTests: Array<{ testCode: string; testName: string; priceCents: number }>;
  drugs: string[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const base = (companyId: string) =>
  `/companies/${encodeURIComponent(companyId)}/business/clinics`;

export const clinicsApi = {
  catalog: () => api.get<ClinicCatalog>(`/business/clinics/catalog`),

  setup: (companyId: string) =>
    api.post<{ ok: true }>(`${base(companyId)}/setup`, {}),

  dashboard: (companyId: string) =>
    api.get<ClinicDashboard>(`${base(companyId)}/dashboard`),

  // Patients
  listPatients: (companyId: string, q?: string) =>
    api.get<{ patients: Patient[] }>(
      `${base(companyId)}/patients${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  getPatient: (companyId: string, id: string) =>
    api.get<{ patient: Patient; visits: Visit[] }>(
      `${base(companyId)}/patients/${id}`,
    ),
  createPatient: (
    companyId: string,
    body: Omit<
      Patient,
      "id" | "code" | "fullName" | "totalVisits" | "firstVisitAt" | "lastVisitAt"
    >,
  ) => api.post<Patient>(`${base(companyId)}/patients`, body),
  updatePatient: (companyId: string, id: string, body: Partial<Patient>) =>
    api.put<Patient>(`${base(companyId)}/patients/${id}`, body),
  deletePatient: (companyId: string, id: string) =>
    api.delete<void>(`${base(companyId)}/patients/${id}`),

  // Doctors
  listDoctors: (companyId: string) =>
    api.get<{ doctors: Doctor[] }>(`${base(companyId)}/doctors`),
  createDoctor: (companyId: string, body: Omit<Doctor, "id" | "code">) =>
    api.post<Doctor>(`${base(companyId)}/doctors`, body),
  updateDoctor: (companyId: string, id: string, body: Partial<Doctor>) =>
    api.put<Doctor>(`${base(companyId)}/doctors/${id}`, body),
  deleteDoctor: (companyId: string, id: string) =>
    api.delete<void>(`${base(companyId)}/doctors/${id}`),

  // Appointments
  listAppointments: (
    companyId: string,
    opts?: { from?: string; to?: string; doctorId?: string; status?: string },
  ) => {
    const params = new URLSearchParams();
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    if (opts?.doctorId) params.set("doctorId", opts.doctorId);
    if (opts?.status) params.set("status", opts.status);
    const qs = params.toString();
    return api.get<{ appointments: ClinicAppointment[] }>(
      `${base(companyId)}/appointments${qs ? `?${qs}` : ""}`,
    );
  },
  createAppointment: (
    companyId: string,
    body: {
      patientId: string;
      doctorId: string;
      startAt: string;
      durationMinutes: number;
      type: ClinicAppointmentType;
      chiefComplaint?: string;
    },
  ) => api.post<ClinicAppointment>(`${base(companyId)}/appointments`, body),
  checkIn: (companyId: string, id: string) =>
    api.post<ClinicAppointment>(`${base(companyId)}/appointments/${id}/check-in`, {}),
  startVisit: (companyId: string, id: string) =>
    api.post<Visit>(`${base(companyId)}/appointments/${id}/start-visit`, {}),
  cancelAppointment: (companyId: string, id: string, reason?: string) =>
    api.post<ClinicAppointment>(
      `${base(companyId)}/appointments/${id}/cancel`,
      reason ? { reason } : {},
    ),

  // Visits
  getVisit: (companyId: string, id: string) =>
    api.get<Visit>(`${base(companyId)}/visits/${id}`),
  updateVisit: (companyId: string, id: string, body: Partial<Visit>) =>
    api.put<Visit>(`${base(companyId)}/visits/${id}`, body),
  signVisit: (companyId: string, id: string, signerName: string) =>
    api.post<Visit>(`${base(companyId)}/visits/${id}/sign`, { signerName }),

  // Prescriptions
  addPrescription: (companyId: string, visitId: string, body: Prescription) =>
    api.post<Visit>(`${base(companyId)}/visits/${visitId}/prescriptions`, body),
  removePrescription: (companyId: string, visitId: string, index: number) =>
    api.delete<Visit>(`${base(companyId)}/visits/${visitId}/prescriptions/${index}`),

  // Lab orders
  addLabOrder: (
    companyId: string,
    visitId: string,
    body: { testCode: string; testName: string },
  ) => api.post<Visit>(`${base(companyId)}/visits/${visitId}/lab-orders`, body),
  updateLabResult: (
    companyId: string,
    visitId: string,
    index: number,
    body: { result: string; abnormal?: boolean },
  ) =>
    api.put<Visit>(
      `${base(companyId)}/visits/${visitId}/lab-orders/${index}/result`,
      body,
    ),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export function formatKwd(fils: number): string {
  return `${(fils / 1000).toFixed(3)} KWD`;
}

export const clinicQueryKeys = {
  catalog: () => ["clinics", "catalog"] as const,
  dashboard: (companyId: string) =>
    ["clinics", "dashboard", companyId] as const,
  patients: (companyId: string, q?: string) =>
    ["clinics", "patients", companyId, q ?? ""] as const,
  patient: (companyId: string, id: string) =>
    ["clinics", "patient", companyId, id] as const,
  doctors: (companyId: string) => ["clinics", "doctors", companyId] as const,
  appointments: (companyId: string, key?: string) =>
    ["clinics", "appointments", companyId, key ?? ""] as const,
  visit: (companyId: string, id: string) =>
    ["clinics", "visit", companyId, id] as const,
};
