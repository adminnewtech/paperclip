// ---------------------------------------------------------------------------
// Clinics & Medical vertical service
// ---------------------------------------------------------------------------
//
// This service implements the "clinics" industry vertical declared in
// `packages/shared/src/industry-verticals.ts`. It stores all clinic entities
// (patients, doctors, appointments, visits) in the generic
// `business_entities` table using `moduleKey: "clinics"`. Each entity type has
// its own `entityType` discriminator and code prefix.
//
// Storage layout:
//   - Patient      → moduleKey="clinics", entityType="patient",      code=PAT-YYYY-NNNNN
//   - Doctor       → moduleKey="clinics", entityType="doctor",       code=DOC-NNN
//   - Appointment  → moduleKey="clinics", entityType="appointment",  code=CAP-YYYY-NNNN
//   - Visit        → moduleKey="clinics", entityType="visit",        code=VIS-YYYY-NNNNN, parentId=patientId
//
// Privacy:
//   - TODO(security): Patient demographics & medical history are PHI.
//     In production they should be encrypted at rest (field-level encryption
//     for civilId/passport/medical data). The current implementation stores
//     them as plain JSONB. Audit trail is leveraged via business-audit-service.
//   - TODO(rbac): Only doctors / authorized staff should see medical detail.
//     Today we only enforce company-level access via `assertCompanyAccess`.

import { and, desc, eq, ilike, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  DEFAULT_SPECIALTIES,
  DEFAULT_ICD10_CODES,
  DEFAULT_LAB_TESTS,
  DEFAULT_DRUG_LIST,
  DEFAULT_DOCTORS,
} from "./clinic-defaults.js";

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

export type LabOrderStatus =
  | "ordered"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface LabOrder {
  testCode: string;
  testName: string;
  status: LabOrderStatus;
  orderedAt: string;
  resultedAt?: string;
  result?: string;
  abnormal?: boolean;
}

export interface VisitAttachment {
  id: string;
  type: string;
  filename: string;
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
  attachments?: VisitAttachment[];
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

export interface CreateAppointmentInput {
  patientId: string;
  doctorId: string;
  startAt: string;
  durationMinutes: number;
  type: ClinicAppointmentType;
  chiefComplaint?: string;
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

export interface ClinicService {
  // Patients
  listPatients(companyId: string, opts?: { q?: string; limit?: number }): Promise<Patient[]>;
  getPatient(companyId: string, id: string): Promise<Patient | null>;
  createPatient(
    companyId: string,
    actorId: string | null,
    input: Omit<
      Patient,
      "id" | "code" | "fullName" | "totalVisits" | "firstVisitAt" | "lastVisitAt"
    >,
  ): Promise<Patient>;
  updatePatient(
    companyId: string,
    actorId: string | null,
    id: string,
    updates: Partial<Patient>,
  ): Promise<Patient>;
  deletePatient(companyId: string, id: string): Promise<void>;

  // Doctors
  listDoctors(companyId: string): Promise<Doctor[]>;
  getDoctor(companyId: string, id: string): Promise<Doctor | null>;
  createDoctor(
    companyId: string,
    actorId: string | null,
    input: Omit<Doctor, "id" | "code">,
  ): Promise<Doctor>;
  updateDoctor(
    companyId: string,
    actorId: string | null,
    id: string,
    input: Partial<Doctor>,
  ): Promise<Doctor>;
  deleteDoctor(companyId: string, id: string): Promise<void>;

  // Appointments
  listAppointments(
    companyId: string,
    opts?: { from?: string; to?: string; doctorId?: string; status?: string },
  ): Promise<ClinicAppointment[]>;
  getAppointment(companyId: string, id: string): Promise<ClinicAppointment | null>;
  createAppointment(
    companyId: string,
    actorId: string | null,
    input: CreateAppointmentInput,
  ): Promise<ClinicAppointment>;
  checkInAppointment(
    companyId: string,
    actorId: string | null,
    id: string,
  ): Promise<ClinicAppointment>;
  startVisit(
    companyId: string,
    actorId: string | null,
    appointmentId: string,
  ): Promise<Visit>;
  cancelAppointment(
    companyId: string,
    actorId: string | null,
    id: string,
    reason?: string,
  ): Promise<ClinicAppointment>;

  // Visits / SOAP
  getVisit(companyId: string, id: string): Promise<Visit | null>;
  listVisitsForPatient(companyId: string, patientId: string): Promise<Visit[]>;
  updateVisit(
    companyId: string,
    actorId: string | null,
    id: string,
    updates: Partial<Visit>,
  ): Promise<Visit>;
  signVisit(
    companyId: string,
    actorId: string | null,
    id: string,
    signerName: string,
  ): Promise<Visit>;

  // Prescriptions
  addPrescription(
    companyId: string,
    actorId: string | null,
    visitId: string,
    prescription: Prescription,
  ): Promise<Visit>;
  removePrescription(
    companyId: string,
    actorId: string | null,
    visitId: string,
    index: number,
  ): Promise<Visit>;

  // Lab orders
  addLabOrder(
    companyId: string,
    actorId: string | null,
    visitId: string,
    lab: Omit<LabOrder, "status" | "orderedAt">,
  ): Promise<Visit>;
  updateLabResult(
    companyId: string,
    actorId: string | null,
    visitId: string,
    labIndex: number,
    result: { result: string; abnormal?: boolean },
  ): Promise<Visit>;

  // Setup + Dashboard
  setupDefaults(companyId: string, actorId: string | null): Promise<void>;
  getDashboard(companyId: string): Promise<ClinicDashboard>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODULE_KEY = "clinics";

function fullNameOf(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

function computeBmi(heightCm?: number, weightKg?: number): number | undefined {
  if (!heightCm || !weightKg) return undefined;
  const h = heightCm / 100;
  if (h <= 0) return undefined;
  return Math.round((weightKg / (h * h)) * 10) / 10;
}

async function nextNumericCode(
  db: Db,
  companyId: string,
  entityType: string,
  prefix: string,
  pad: number,
  yearScoped: boolean,
): Promise<string> {
  const year = new Date().getFullYear();
  const likePattern = yearScoped ? `${prefix}-${year}-%` : `${prefix}-%`;
  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, MODULE_KEY),
        eq(businessEntities.entityType, entityType),
        ilike(businessEntities.code, likePattern),
      ),
    )
    .orderBy(desc(businessEntities.code))
    .limit(1);

  let num = 1;
  const last = rows[0]?.code;
  if (last) {
    const parts = last.split("-");
    const lastNum = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!isNaN(lastNum)) num = lastNum + 1;
  }
  return yearScoped
    ? `${prefix}-${year}-${String(num).padStart(pad, "0")}`
    : `${prefix}-${String(num).padStart(pad, "0")}`;
}

type EntityRow = typeof businessEntities.$inferSelect;

interface PatientStored {
  firstName: string;
  lastName: string;
  firstNameAr?: string;
  lastNameAr?: string;
  dateOfBirth: string;
  gender: Patient["gender"];
  nationality?: string;
  civilId?: string;
  passport?: string;
  phone: string;
  email?: string;
  address?: string;
  emergencyContact?: EmergencyContact;
  bloodType?: BloodType;
  allergies?: string[];
  chronicConditions?: string[];
  currentMedications?: string[];
  familyHistory?: string[];
  insurance?: InsuranceInfo;
  firstVisitAt?: string;
  lastVisitAt?: string;
  totalVisits?: number;
  notes?: string;
  flagged?: boolean;
}

function patientFromRow(row: EntityRow): Patient {
  const data = (row.data ?? {}) as PatientStored;
  const firstName = data.firstName ?? row.name?.split(" ")[0] ?? "";
  const lastName = data.lastName ?? row.name?.split(" ").slice(1).join(" ") ?? "";
  return {
    id: row.id,
    code: row.code ?? "",
    firstName,
    lastName,
    firstNameAr: data.firstNameAr,
    lastNameAr: data.lastNameAr,
    fullName: fullNameOf({ firstName, lastName }),
    dateOfBirth: data.dateOfBirth ?? "",
    gender: data.gender ?? "other",
    nationality: data.nationality,
    civilId: data.civilId,
    passport: data.passport,
    phone: data.phone ?? "",
    email: data.email,
    address: data.address,
    emergencyContact: data.emergencyContact,
    bloodType: data.bloodType,
    allergies: data.allergies ?? [],
    chronicConditions: data.chronicConditions ?? [],
    currentMedications: data.currentMedications ?? [],
    familyHistory: data.familyHistory ?? [],
    insurance: data.insurance,
    firstVisitAt: data.firstVisitAt,
    lastVisitAt: data.lastVisitAt,
    totalVisits: data.totalVisits ?? 0,
    notes: data.notes,
    flagged: data.flagged,
  };
}

interface DoctorStored {
  nameAr?: string;
  specialty: string;
  licenseNumber: string;
  phone?: string;
  email?: string;
  workingHours?: WorkingHourSlot[];
  consultationFeeCents?: number;
}

function doctorFromRow(row: EntityRow): Doctor {
  const data = (row.data ?? {}) as DoctorStored;
  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? "",
    nameAr: data.nameAr,
    specialty: data.specialty ?? "General Medicine",
    licenseNumber: data.licenseNumber ?? "",
    phone: data.phone,
    email: data.email,
    workingHours: data.workingHours ?? [],
    consultationFeeCents: data.consultationFeeCents ?? row.amountCents ?? 0,
  };
}

interface AppointmentStored {
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  startAt: string;
  durationMinutes: number;
  type: ClinicAppointmentType;
  chiefComplaint?: string;
  visitId?: string;
  reminderSentAt?: string;
}

function appointmentFromRow(row: EntityRow): ClinicAppointment {
  const data = (row.data ?? {}) as AppointmentStored;
  return {
    id: row.id,
    code: row.code ?? "",
    patientId: data.patientId,
    patientName: data.patientName,
    doctorId: data.doctorId,
    doctorName: data.doctorName,
    specialty: data.specialty,
    startAt: data.startAt,
    durationMinutes: data.durationMinutes,
    type: data.type,
    status: (row.status as ClinicAppointmentStatus) ?? "scheduled",
    chiefComplaint: data.chiefComplaint,
    visitId: data.visitId,
    reminderSentAt: data.reminderSentAt,
  };
}

interface VisitStored {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  date: string;
  type: ClinicAppointmentType;
  subjective?: string;
  objective?: string;
  vitals?: Vitals;
  assessment?: string;
  diagnosisCodes?: string[];
  plan?: string;
  prescriptions?: Prescription[];
  labOrders?: LabOrder[];
  attachments?: VisitAttachment[];
  signedAt?: string;
  signedBy?: string;
  followUpInDays?: number;
  totalChargeCents?: number;
  insuranceCoveredCents?: number;
  patientPayCents?: number;
}

function visitFromRow(row: EntityRow): Visit {
  const data = (row.data ?? {}) as VisitStored;
  return {
    id: row.id,
    code: row.code ?? "",
    appointmentId: data.appointmentId,
    patientId: data.patientId ?? row.parentId ?? "",
    doctorId: data.doctorId,
    date: data.date,
    type: data.type,
    subjective: data.subjective ?? "",
    objective: data.objective ?? "",
    vitals: data.vitals,
    assessment: data.assessment ?? "",
    diagnosisCodes: data.diagnosisCodes ?? [],
    plan: data.plan ?? "",
    prescriptions: data.prescriptions ?? [],
    labOrders: data.labOrders ?? [],
    attachments: data.attachments ?? [],
    status: (row.status as VisitStatus) ?? "draft",
    signedAt: data.signedAt,
    signedBy: data.signedBy,
    followUpInDays: data.followUpInDays,
    totalChargeCents: data.totalChargeCents ?? row.amountCents ?? 0,
    insuranceCoveredCents: data.insuranceCoveredCents ?? 0,
    patientPayCents: data.patientPayCents ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createClinicService(db: Db): ClinicService {
  // -------- Patients --------

  async function listPatients(
    companyId: string,
    opts?: { q?: string; limit?: number },
  ): Promise<Patient[]> {
    const limit = Math.min(opts?.limit ?? 200, 1000);
    const conds = [
      eq(businessEntities.companyId, companyId),
      eq(businessEntities.moduleKey, MODULE_KEY),
      eq(businessEntities.entityType, "patient"),
    ];
    if (opts?.q && opts.q.trim().length > 0) {
      conds.push(ilike(businessEntities.name, `%${opts.q.trim()}%`));
    }
    const rows = await db
      .select()
      .from(businessEntities)
      .where(and(...conds))
      .orderBy(desc(businessEntities.updatedAt))
      .limit(limit);
    return rows.map(patientFromRow);
  }

  async function getPatient(companyId: string, id: string): Promise<Patient | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "patient"),
        ),
      );
    return row ? patientFromRow(row) : null;
  }

  async function createPatient(
    companyId: string,
    actorId: string | null,
    input: Omit<
      Patient,
      "id" | "code" | "fullName" | "totalVisits" | "firstVisitAt" | "lastVisitAt"
    >,
  ): Promise<Patient> {
    const code = await nextNumericCode(db, companyId, "patient", "PAT", 5, true);
    const fullName = fullNameOf(input);
    const now = new Date();
    const data: PatientStored = {
      firstName: input.firstName,
      lastName: input.lastName,
      firstNameAr: input.firstNameAr,
      lastNameAr: input.lastNameAr,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      nationality: input.nationality,
      civilId: input.civilId,
      passport: input.passport,
      phone: input.phone,
      email: input.email,
      address: input.address,
      emergencyContact: input.emergencyContact,
      bloodType: input.bloodType,
      allergies: input.allergies ?? [],
      chronicConditions: input.chronicConditions ?? [],
      currentMedications: input.currentMedications ?? [],
      familyHistory: input.familyHistory ?? [],
      insurance: input.insurance,
      notes: input.notes,
      flagged: input.flagged,
      totalVisits: 0,
    };
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: MODULE_KEY,
        entityType: "patient",
        code,
        name: fullName,
        status: input.flagged ? "flagged" : "active",
        data: data as unknown as Record<string, unknown>,
        tags: [],
        createdByUserId: actorId,
        updatedByUserId: actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert patient");
    return patientFromRow(row);
  }

  async function updatePatient(
    companyId: string,
    actorId: string | null,
    id: string,
    updates: Partial<Patient>,
  ): Promise<Patient> {
    const current = await getPatient(companyId, id);
    if (!current) throw new Error("Patient not found");
    const merged = { ...current, ...updates };
    const fullName = fullNameOf(merged);
    const data: PatientStored = {
      firstName: merged.firstName,
      lastName: merged.lastName,
      firstNameAr: merged.firstNameAr,
      lastNameAr: merged.lastNameAr,
      dateOfBirth: merged.dateOfBirth,
      gender: merged.gender,
      nationality: merged.nationality,
      civilId: merged.civilId,
      passport: merged.passport,
      phone: merged.phone,
      email: merged.email,
      address: merged.address,
      emergencyContact: merged.emergencyContact,
      bloodType: merged.bloodType,
      allergies: merged.allergies,
      chronicConditions: merged.chronicConditions,
      currentMedications: merged.currentMedications,
      familyHistory: merged.familyHistory,
      insurance: merged.insurance,
      firstVisitAt: merged.firstVisitAt,
      lastVisitAt: merged.lastVisitAt,
      totalVisits: merged.totalVisits,
      notes: merged.notes,
      flagged: merged.flagged,
    };
    const [row] = await db
      .update(businessEntities)
      .set({
        name: fullName,
        status: merged.flagged ? "flagged" : "active",
        data: data as unknown as Record<string, unknown>,
        updatedByUserId: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "patient"),
        ),
      )
      .returning();
    if (!row) throw new Error("Patient not found");
    return patientFromRow(row);
  }

  async function deletePatient(companyId: string, id: string): Promise<void> {
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "patient"),
        ),
      );
  }

  // -------- Doctors --------

  async function listDoctors(companyId: string): Promise<Doctor[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "doctor"),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(1000);
    return rows.map(doctorFromRow);
  }

  async function getDoctor(companyId: string, id: string): Promise<Doctor | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "doctor"),
        ),
      );
    return row ? doctorFromRow(row) : null;
  }

  async function createDoctor(
    companyId: string,
    actorId: string | null,
    input: Omit<Doctor, "id" | "code">,
  ): Promise<Doctor> {
    const code = await nextNumericCode(db, companyId, "doctor", "DOC", 3, false);
    const now = new Date();
    const data: DoctorStored = {
      nameAr: input.nameAr,
      specialty: input.specialty,
      licenseNumber: input.licenseNumber,
      phone: input.phone,
      email: input.email,
      workingHours: input.workingHours,
      consultationFeeCents: input.consultationFeeCents,
    };
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: MODULE_KEY,
        entityType: "doctor",
        code,
        name: input.name,
        status: "active",
        amountCents: input.consultationFeeCents,
        currency: "KWD",
        data: data as unknown as Record<string, unknown>,
        tags: [input.specialty],
        createdByUserId: actorId,
        updatedByUserId: actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert doctor");
    return doctorFromRow(row);
  }

  async function updateDoctor(
    companyId: string,
    actorId: string | null,
    id: string,
    input: Partial<Doctor>,
  ): Promise<Doctor> {
    const current = await getDoctor(companyId, id);
    if (!current) throw new Error("Doctor not found");
    const merged = { ...current, ...input };
    const data: DoctorStored = {
      nameAr: merged.nameAr,
      specialty: merged.specialty,
      licenseNumber: merged.licenseNumber,
      phone: merged.phone,
      email: merged.email,
      workingHours: merged.workingHours,
      consultationFeeCents: merged.consultationFeeCents,
    };
    const [row] = await db
      .update(businessEntities)
      .set({
        name: merged.name,
        amountCents: merged.consultationFeeCents,
        data: data as unknown as Record<string, unknown>,
        tags: [merged.specialty],
        updatedByUserId: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "doctor"),
        ),
      )
      .returning();
    if (!row) throw new Error("Doctor not found");
    return doctorFromRow(row);
  }

  async function deleteDoctor(companyId: string, id: string): Promise<void> {
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "doctor"),
        ),
      );
  }

  // -------- Appointments --------

  async function listAppointments(
    companyId: string,
    opts?: { from?: string; to?: string; doctorId?: string; status?: string },
  ): Promise<ClinicAppointment[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "appointment"),
          ...(opts?.status ? [eq(businessEntities.status, opts.status)] : []),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(1000);

    let result = rows.map(appointmentFromRow);
    if (opts?.from) {
      const from = new Date(opts.from).getTime();
      result = result.filter((a) => new Date(a.startAt).getTime() >= from);
    }
    if (opts?.to) {
      const to = new Date(opts.to).getTime();
      result = result.filter((a) => new Date(a.startAt).getTime() <= to);
    }
    if (opts?.doctorId) {
      result = result.filter((a) => a.doctorId === opts.doctorId);
    }
    // Sort by startAt ascending for calendar UX
    result.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return result;
  }

  async function getAppointment(
    companyId: string,
    id: string,
  ): Promise<ClinicAppointment | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "appointment"),
        ),
      );
    return row ? appointmentFromRow(row) : null;
  }

  async function createAppointment(
    companyId: string,
    actorId: string | null,
    input: CreateAppointmentInput,
  ): Promise<ClinicAppointment> {
    const patient = await getPatient(companyId, input.patientId);
    if (!patient) throw new Error("Patient not found");
    const doctor = await getDoctor(companyId, input.doctorId);
    if (!doctor) throw new Error("Doctor not found");

    const code = await nextNumericCode(db, companyId, "appointment", "CAP", 4, true);
    const now = new Date();
    const data: AppointmentStored = {
      patientId: patient.id,
      patientName: patient.fullName,
      doctorId: doctor.id,
      doctorName: doctor.name,
      specialty: doctor.specialty,
      startAt: input.startAt,
      durationMinutes: input.durationMinutes,
      type: input.type,
      chiefComplaint: input.chiefComplaint,
    };

    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: MODULE_KEY,
        entityType: "appointment",
        code,
        name: `${patient.fullName} — ${doctor.name}`,
        status: "scheduled",
        amountCents: doctor.consultationFeeCents,
        currency: "KWD",
        data: data as unknown as Record<string, unknown>,
        tags: [doctor.specialty, input.type],
        createdByUserId: actorId,
        updatedByUserId: actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert appointment");
    return appointmentFromRow(row);
  }

  async function checkInAppointment(
    companyId: string,
    actorId: string | null,
    id: string,
  ): Promise<ClinicAppointment> {
    const [row] = await db
      .update(businessEntities)
      .set({
        status: "checked_in",
        updatedByUserId: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "appointment"),
        ),
      )
      .returning();
    if (!row) throw new Error("Appointment not found");
    return appointmentFromRow(row);
  }

  async function startVisit(
    companyId: string,
    actorId: string | null,
    appointmentId: string,
  ): Promise<Visit> {
    const appt = await getAppointment(companyId, appointmentId);
    if (!appt) throw new Error("Appointment not found");

    // Mark appointment in_progress
    await db
      .update(businessEntities)
      .set({
        status: "in_progress",
        updatedByUserId: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, appointmentId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "appointment"),
        ),
      );

    const code = await nextNumericCode(db, companyId, "visit", "VIS", 5, true);
    const now = new Date();
    const visitData: VisitStored = {
      appointmentId,
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      date: now.toISOString(),
      type: appt.type,
      subjective: "",
      objective: "",
      assessment: "",
      plan: "",
      prescriptions: [],
      labOrders: [],
      attachments: [],
      totalChargeCents: 0,
      insuranceCoveredCents: 0,
      patientPayCents: 0,
    };
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: MODULE_KEY,
        entityType: "visit",
        parentId: appt.patientId,
        code,
        name: `Visit — ${appt.patientName}`,
        status: "draft",
        amountCents: 0,
        currency: "KWD",
        data: visitData as unknown as Record<string, unknown>,
        tags: [appt.type],
        createdByUserId: actorId,
        updatedByUserId: actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to create visit");

    // Persist visitId back on the appointment.
    const apptRow = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, appointmentId),
        ),
      );
    const apptData = (apptRow[0]?.data ?? {}) as AppointmentStored;
    await db
      .update(businessEntities)
      .set({
        data: ({ ...apptData, visitId: row.id }) as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, appointmentId),
        ),
      );

    return visitFromRow(row);
  }

  async function cancelAppointment(
    companyId: string,
    actorId: string | null,
    id: string,
    reason?: string,
  ): Promise<ClinicAppointment> {
    const existing = await getAppointment(companyId, id);
    if (!existing) throw new Error("Appointment not found");
    const apptRow = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
        ),
      );
    const data = (apptRow[0]?.data ?? {}) as AppointmentStored & { cancelReason?: string };
    if (reason) data.cancelReason = reason;
    const [row] = await db
      .update(businessEntities)
      .set({
        status: "cancelled",
        data: data as unknown as Record<string, unknown>,
        updatedByUserId: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "appointment"),
        ),
      )
      .returning();
    if (!row) throw new Error("Appointment not found");
    return appointmentFromRow(row);
  }

  // -------- Visits --------

  async function getVisit(companyId: string, id: string): Promise<Visit | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "visit"),
        ),
      );
    return row ? visitFromRow(row) : null;
  }

  async function listVisitsForPatient(
    companyId: string,
    patientId: string,
  ): Promise<Visit[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "visit"),
          eq(businessEntities.parentId, patientId),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(500);
    return rows.map(visitFromRow);
  }

  async function persistVisit(
    companyId: string,
    actorId: string | null,
    id: string,
    next: Visit,
  ): Promise<Visit> {
    if (next.vitals && (next.vitals.heightCm || next.vitals.weightKg)) {
      next.vitals.bmi = computeBmi(next.vitals.heightCm, next.vitals.weightKg);
    }
    const data: VisitStored = {
      appointmentId: next.appointmentId,
      patientId: next.patientId,
      doctorId: next.doctorId,
      date: next.date,
      type: next.type,
      subjective: next.subjective,
      objective: next.objective,
      vitals: next.vitals,
      assessment: next.assessment,
      diagnosisCodes: next.diagnosisCodes,
      plan: next.plan,
      prescriptions: next.prescriptions,
      labOrders: next.labOrders,
      attachments: next.attachments,
      signedAt: next.signedAt,
      signedBy: next.signedBy,
      followUpInDays: next.followUpInDays,
      totalChargeCents: next.totalChargeCents,
      insuranceCoveredCents: next.insuranceCoveredCents,
      patientPayCents: next.patientPayCents,
    };
    const [row] = await db
      .update(businessEntities)
      .set({
        status: next.status,
        amountCents: next.totalChargeCents,
        currency: "KWD",
        data: data as unknown as Record<string, unknown>,
        updatedByUserId: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.id, id),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "visit"),
        ),
      )
      .returning();
    if (!row) throw new Error("Visit not found");
    return visitFromRow(row);
  }

  async function updateVisit(
    companyId: string,
    actorId: string | null,
    id: string,
    updates: Partial<Visit>,
  ): Promise<Visit> {
    const current = await getVisit(companyId, id);
    if (!current) throw new Error("Visit not found");
    const merged: Visit = { ...current, ...updates };
    return persistVisit(companyId, actorId, id, merged);
  }

  async function signVisit(
    companyId: string,
    actorId: string | null,
    id: string,
    signerName: string,
  ): Promise<Visit> {
    const current = await getVisit(companyId, id);
    if (!current) throw new Error("Visit not found");
    const signed: Visit = {
      ...current,
      status: "signed",
      signedAt: new Date().toISOString(),
      signedBy: signerName,
    };
    const result = await persistVisit(companyId, actorId, id, signed);

    // Update patient stats
    if (current.patientId) {
      const patient = await getPatient(companyId, current.patientId);
      if (patient) {
        await updatePatient(companyId, actorId, current.patientId, {
          totalVisits: (patient.totalVisits ?? 0) + 1,
          firstVisitAt: patient.firstVisitAt ?? current.date,
          lastVisitAt: current.date,
        });
      }
    }

    // Mark appointment completed
    if (current.appointmentId) {
      await db
        .update(businessEntities)
        .set({
          status: "completed",
          updatedByUserId: actorId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.id, current.appointmentId),
            eq(businessEntities.moduleKey, MODULE_KEY),
            eq(businessEntities.entityType, "appointment"),
          ),
        );
    }

    return result;
  }

  // -------- Prescriptions --------

  async function addPrescription(
    companyId: string,
    actorId: string | null,
    visitId: string,
    prescription: Prescription,
  ): Promise<Visit> {
    const current = await getVisit(companyId, visitId);
    if (!current) throw new Error("Visit not found");
    const next: Visit = {
      ...current,
      prescriptions: [...current.prescriptions, prescription],
    };
    return persistVisit(companyId, actorId, visitId, next);
  }

  async function removePrescription(
    companyId: string,
    actorId: string | null,
    visitId: string,
    index: number,
  ): Promise<Visit> {
    const current = await getVisit(companyId, visitId);
    if (!current) throw new Error("Visit not found");
    const next: Visit = {
      ...current,
      prescriptions: current.prescriptions.filter((_, i) => i !== index),
    };
    return persistVisit(companyId, actorId, visitId, next);
  }

  // -------- Lab orders --------

  async function addLabOrder(
    companyId: string,
    actorId: string | null,
    visitId: string,
    lab: Omit<LabOrder, "status" | "orderedAt">,
  ): Promise<Visit> {
    const current = await getVisit(companyId, visitId);
    if (!current) throw new Error("Visit not found");
    const newLab: LabOrder = {
      ...lab,
      status: "ordered",
      orderedAt: new Date().toISOString(),
    };
    const next: Visit = {
      ...current,
      labOrders: [...current.labOrders, newLab],
    };
    return persistVisit(companyId, actorId, visitId, next);
  }

  async function updateLabResult(
    companyId: string,
    actorId: string | null,
    visitId: string,
    labIndex: number,
    result: { result: string; abnormal?: boolean },
  ): Promise<Visit> {
    const current = await getVisit(companyId, visitId);
    if (!current) throw new Error("Visit not found");
    const labs = current.labOrders.map((lab, i) => {
      if (i !== labIndex) return lab;
      return {
        ...lab,
        status: "completed" as LabOrderStatus,
        result: result.result,
        abnormal: result.abnormal ?? false,
        resultedAt: new Date().toISOString(),
      };
    });
    const next: Visit = { ...current, labOrders: labs };
    return persistVisit(companyId, actorId, visitId, next);
  }

  // -------- Setup defaults --------

  async function setupDefaults(
    companyId: string,
    actorId: string | null,
  ): Promise<void> {
    const existing = await listDoctors(companyId);
    if (existing.length > 0) return;
    for (const doc of DEFAULT_DOCTORS) {
      await createDoctor(companyId, actorId, {
        name: doc.name,
        nameAr: doc.nameAr,
        specialty: doc.specialty,
        licenseNumber: doc.licenseNumber,
        workingHours: [
          { day: "Sun", from: "09:00", to: "17:00" },
          { day: "Mon", from: "09:00", to: "17:00" },
          { day: "Tue", from: "09:00", to: "17:00" },
          { day: "Wed", from: "09:00", to: "17:00" },
          { day: "Thu", from: "09:00", to: "17:00" },
        ],
        consultationFeeCents: doc.consultationFeeCents,
      });
    }
  }

  // -------- Dashboard --------

  async function getDashboard(companyId: string): Promise<ClinicDashboard> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
    );
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    // Patients total
    const patientCountRows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "patient"),
        ),
      );
    const patientsTotal = Number(patientCountRows[0]?.c ?? 0);

    // Appointments today/this week from in-memory list (we filter on data.startAt)
    const allAppointments = await listAppointments(companyId);
    const appointmentsToday = allAppointments.filter((a) => {
      const t = new Date(a.startAt).getTime();
      return t >= startOfDay.getTime() && t <= endOfDay.getTime();
    }).length;
    const appointmentsThisWeek = allAppointments.filter((a) => {
      const t = new Date(a.startAt).getTime();
      return t >= startOfWeek.getTime() && t < endOfWeek.getTime();
    }).length;

    // Visits this month + revenue
    const visitRows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "visit"),
        ),
      );
    const visitsThisMonth = visitRows.filter((v) => {
      const t = new Date(v.createdAt).getTime();
      return t >= startOfMonth.getTime() && t <= endOfMonth.getTime();
    }).length;
    const revenueThisMonth = visitRows
      .filter((v) => {
        const t = new Date(v.createdAt).getTime();
        return (
          t >= startOfMonth.getTime() &&
          t <= endOfMonth.getTime() &&
          v.status === "signed"
        );
      })
      .reduce((sum, v) => sum + (v.amountCents ?? 0), 0);

    // Top doctors by signed visits
    const doctorCounts = new Map<string, number>();
    for (const row of visitRows) {
      if (row.status !== "signed") continue;
      const data = (row.data ?? {}) as VisitStored;
      if (!data.doctorId) continue;
      doctorCounts.set(data.doctorId, (doctorCounts.get(data.doctorId) ?? 0) + 1);
    }
    const doctors = await listDoctors(companyId);
    const topDoctors = Array.from(doctorCounts.entries())
      .map(([doctorId, visits]) => ({
        doctorId,
        name: doctors.find((d) => d.id === doctorId)?.name ?? "Unknown",
        visits,
      }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 5);

    // Recent patients
    const recentPatientRows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, MODULE_KEY),
          eq(businessEntities.entityType, "patient"),
        ),
      )
      .orderBy(desc(businessEntities.updatedAt))
      .limit(5);
    const recentPatients = recentPatientRows.map(patientFromRow);

    const unsignedVisits = visitRows.filter((v) => v.status !== "signed").length;

    return {
      patientsTotal,
      appointmentsToday,
      appointmentsThisWeek,
      visitsThisMonth,
      revenueThisMonth,
      topDoctors,
      recentPatients,
      unsignedVisits,
    };
  }

  return {
    listPatients,
    getPatient,
    createPatient,
    updatePatient,
    deletePatient,
    listDoctors,
    getDoctor,
    createDoctor,
    updateDoctor,
    deleteDoctor,
    listAppointments,
    getAppointment,
    createAppointment,
    checkInAppointment,
    startVisit,
    cancelAppointment,
    getVisit,
    listVisitsForPatient,
    updateVisit,
    signVisit,
    addPrescription,
    removePrescription,
    addLabOrder,
    updateLabResult,
    setupDefaults,
    getDashboard,
  };
}

// Re-export so route consumers can pull defaults from one place.
export {
  DEFAULT_SPECIALTIES,
  DEFAULT_ICD10_CODES,
  DEFAULT_LAB_TESTS,
  DEFAULT_DRUG_LIST,
  DEFAULT_DOCTORS,
};
