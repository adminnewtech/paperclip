// ---------------------------------------------------------------------------
// Clinics vertical REST routes
// ---------------------------------------------------------------------------
//
// All endpoints are scoped to a company and protected by `assertCompanyAccess`.
// Patient data is PHI: every mutation logs an activity (audit trail) and
// (TODO) should run through field-level encryption in production.

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "../authz.js";
import { logActivity } from "../../services/index.js";
import {
  createClinicService,
  DEFAULT_ICD10_CODES,
  DEFAULT_LAB_TESTS,
  DEFAULT_SPECIALTIES,
  DEFAULT_DRUG_LIST,
} from "../../services/verticals/clinics/index.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const emergencyContactSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  relationship: z.string().trim().min(1),
});

const insuranceSchema = z.object({
  provider: z.string().trim().min(1),
  policyNumber: z.string().trim().min(1),
  expiresAt: z.string().optional(),
  coveragePercent: z.number().min(0).max(100).optional(),
});

const bloodTypeSchema = z.enum([
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
  "unknown",
]);

const patientCreateSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  firstNameAr: z.string().trim().optional(),
  lastNameAr: z.string().trim().optional(),
  dateOfBirth: z.string().min(1),
  gender: z.enum(["male", "female", "other"]),
  nationality: z.string().trim().optional(),
  civilId: z.string().trim().optional(),
  passport: z.string().trim().optional(),
  phone: z.string().trim().min(1),
  email: z.string().email().optional(),
  address: z.string().trim().optional(),
  emergencyContact: emergencyContactSchema.optional(),
  bloodType: bloodTypeSchema.optional(),
  allergies: z.array(z.string()).default([]),
  chronicConditions: z.array(z.string()).default([]),
  currentMedications: z.array(z.string()).default([]),
  familyHistory: z.array(z.string()).default([]),
  insurance: insuranceSchema.optional(),
  notes: z.string().optional(),
  flagged: z.boolean().optional(),
});

const patientUpdateSchema = patientCreateSchema.partial();

const workingHourSchema = z.object({
  day: z.string().trim().min(1),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
});

const doctorCreateSchema = z.object({
  name: z.string().trim().min(1),
  nameAr: z.string().trim().optional(),
  specialty: z.string().trim().min(1),
  licenseNumber: z.string().trim().min(1),
  phone: z.string().trim().optional(),
  email: z.string().email().optional(),
  workingHours: z.array(workingHourSchema).default([]),
  consultationFeeCents: z.number().int().min(0).default(0),
});

const doctorUpdateSchema = doctorCreateSchema.partial();

const appointmentCreateSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  startAt: z.string().min(1),
  durationMinutes: z.number().int().min(5).max(720),
  type: z.enum(["consultation", "follow_up", "procedure", "vaccination", "test"]),
  chiefComplaint: z.string().optional(),
});

const cancelAppointmentSchema = z.object({
  reason: z.string().optional(),
});

const vitalsSchema = z.object({
  bloodPressure: z.string().optional(),
  heartRate: z.number().optional(),
  temperatureCelsius: z.number().optional(),
  respiratoryRate: z.number().optional(),
  weightKg: z.number().optional(),
  heightCm: z.number().optional(),
  bmi: z.number().optional(),
  oxygenSaturation: z.number().optional(),
});

const visitUpdateSchema = z.object({
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.string().optional(),
  diagnosisCodes: z.array(z.string()).optional(),
  vitals: vitalsSchema.optional(),
  status: z.enum(["draft", "completed", "signed"]).optional(),
  followUpInDays: z.number().int().min(0).optional(),
  totalChargeCents: z.number().int().min(0).optional(),
  insuranceCoveredCents: z.number().int().min(0).optional(),
  patientPayCents: z.number().int().min(0).optional(),
});

const signVisitSchema = z.object({
  signerName: z.string().trim().min(1),
});

const prescriptionSchema = z.object({
  drug: z.string().trim().min(1),
  dosage: z.string().trim().min(1),
  frequency: z.string().trim().min(1),
  durationDays: z.number().int().min(1),
  quantity: z.string().optional(),
  instructions: z.string().optional(),
  refillsAllowed: z.number().int().min(0).optional(),
});

const labOrderInputSchema = z.object({
  testCode: z.string().trim().min(1),
  testName: z.string().trim().min(1),
});

const labResultSchema = z.object({
  result: z.string().trim().min(1),
  abnormal: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function clinicsRoutes(db: Db) {
  const router = Router();
  const service = createClinicService(db);

  function audit(
    req: Parameters<typeof getActorInfo>[0],
    companyId: string,
    action: string,
    entityType: string,
    entityId: string,
    details?: Record<string, unknown>,
  ) {
    const actor = getActorInfo(req);
    return logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action,
      entityType,
      entityId,
      details: details ?? null,
    });
  }

  // ---------- Catalog (lookups) ----------
  router.get("/business/clinics/catalog", async (_req, res) => {
    res.json({
      specialties: DEFAULT_SPECIALTIES,
      icd10: DEFAULT_ICD10_CODES,
      labTests: DEFAULT_LAB_TESTS,
      drugs: DEFAULT_DRUG_LIST,
    });
  });

  // ---------- Setup ----------
  router.post("/companies/:companyId/business/clinics/setup", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    await service.setupDefaults(companyId, actor.actorId);
    await audit(req, companyId, "clinic.setup", "clinic", companyId);
    res.json({ ok: true });
  });

  // ---------- Dashboard ----------
  router.get(
    "/companies/:companyId/business/clinics/dashboard",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const dashboard = await service.getDashboard(companyId);
      res.json(dashboard);
    },
  );

  // ---------- Patients ----------
  router.get(
    "/companies/:companyId/business/clinics/patients",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const q = typeof req.query.q === "string" ? req.query.q : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const patients = await service.listPatients(companyId, { q, limit });
      res.json({ patients });
    },
  );

  router.get(
    "/companies/:companyId/business/clinics/patients/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const patient = await service.getPatient(companyId, id);
      if (!patient) {
        res.status(404).json({ error: "Patient not found" });
        return;
      }
      const visits = await service.listVisitsForPatient(companyId, id);
      res.json({ patient, visits });
    },
  );

  router.post(
    "/companies/:companyId/business/clinics/patients",
    validate(patientCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof patientCreateSchema>;
      const patient = await service.createPatient(companyId, actor.actorId, body);
      await audit(req, companyId, "clinic.patient_created", "patient", patient.id, {
        code: patient.code,
      });
      res.status(201).json(patient);
    },
  );

  router.put(
    "/companies/:companyId/business/clinics/patients/:id",
    validate(patientUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof patientUpdateSchema>;
      try {
        const patient = await service.updatePatient(companyId, actor.actorId, id, body);
        await audit(req, companyId, "clinic.patient_updated", "patient", id);
        res.json(patient);
      } catch {
        res.status(404).json({ error: "Patient not found" });
      }
    },
  );

  router.delete(
    "/companies/:companyId/business/clinics/patients/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      await service.deletePatient(companyId, id);
      await audit(req, companyId, "clinic.patient_deleted", "patient", id);
      res.status(204).end();
    },
  );

  // ---------- Doctors ----------
  router.get(
    "/companies/:companyId/business/clinics/doctors",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const doctors = await service.listDoctors(companyId);
      res.json({ doctors });
    },
  );

  router.get(
    "/companies/:companyId/business/clinics/doctors/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const doctor = await service.getDoctor(companyId, id);
      if (!doctor) {
        res.status(404).json({ error: "Doctor not found" });
        return;
      }
      res.json(doctor);
    },
  );

  router.post(
    "/companies/:companyId/business/clinics/doctors",
    validate(doctorCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof doctorCreateSchema>;
      const doctor = await service.createDoctor(companyId, actor.actorId, body);
      await audit(req, companyId, "clinic.doctor_created", "doctor", doctor.id, {
        code: doctor.code,
      });
      res.status(201).json(doctor);
    },
  );

  router.put(
    "/companies/:companyId/business/clinics/doctors/:id",
    validate(doctorUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof doctorUpdateSchema>;
      try {
        const doctor = await service.updateDoctor(companyId, actor.actorId, id, body);
        await audit(req, companyId, "clinic.doctor_updated", "doctor", id);
        res.json(doctor);
      } catch {
        res.status(404).json({ error: "Doctor not found" });
      }
    },
  );

  router.delete(
    "/companies/:companyId/business/clinics/doctors/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      await service.deleteDoctor(companyId, id);
      await audit(req, companyId, "clinic.doctor_deleted", "doctor", id);
      res.status(204).end();
    },
  );

  // ---------- Appointments ----------
  router.get(
    "/companies/:companyId/business/clinics/appointments",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const doctorId =
        typeof req.query.doctorId === "string" ? req.query.doctorId : undefined;
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const appointments = await service.listAppointments(companyId, {
        from,
        to,
        doctorId,
        status,
      });
      res.json({ appointments });
    },
  );

  router.get(
    "/companies/:companyId/business/clinics/appointments/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const appointment = await service.getAppointment(companyId, id);
      if (!appointment) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }
      res.json(appointment);
    },
  );

  router.post(
    "/companies/:companyId/business/clinics/appointments",
    validate(appointmentCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof appointmentCreateSchema>;
      try {
        const appt = await service.createAppointment(companyId, actor.actorId, body);
        await audit(
          req,
          companyId,
          "clinic.appointment_created",
          "appointment",
          appt.id,
          { code: appt.code },
        );
        res.status(201).json(appt);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/clinics/appointments/:id/check-in",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      try {
        const appt = await service.checkInAppointment(companyId, actor.actorId, id);
        await audit(req, companyId, "clinic.appointment_checked_in", "appointment", id);
        res.json(appt);
      } catch {
        res.status(404).json({ error: "Appointment not found" });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/clinics/appointments/:id/start-visit",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      try {
        const visit = await service.startVisit(companyId, actor.actorId, id);
        await audit(req, companyId, "clinic.visit_started", "visit", visit.id, {
          appointmentId: id,
        });
        res.status(201).json(visit);
      } catch (err) {
        res.status(404).json({ error: (err as Error).message });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/clinics/appointments/:id/cancel",
    validate(cancelAppointmentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof cancelAppointmentSchema>;
      try {
        const appt = await service.cancelAppointment(
          companyId,
          actor.actorId,
          id,
          body.reason,
        );
        await audit(req, companyId, "clinic.appointment_cancelled", "appointment", id, {
          reason: body.reason,
        });
        res.json(appt);
      } catch {
        res.status(404).json({ error: "Appointment not found" });
      }
    },
  );

  // ---------- Visits ----------
  router.get(
    "/companies/:companyId/business/clinics/visits/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const visit = await service.getVisit(companyId, id);
      if (!visit) {
        res.status(404).json({ error: "Visit not found" });
        return;
      }
      res.json(visit);
    },
  );

  router.put(
    "/companies/:companyId/business/clinics/visits/:id",
    validate(visitUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof visitUpdateSchema>;
      try {
        const visit = await service.updateVisit(companyId, actor.actorId, id, body);
        await audit(req, companyId, "clinic.visit_updated", "visit", id);
        res.json(visit);
      } catch {
        res.status(404).json({ error: "Visit not found" });
      }
    },
  );

  router.post(
    "/companies/:companyId/business/clinics/visits/:id/sign",
    validate(signVisitSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof signVisitSchema>;
      try {
        const visit = await service.signVisit(
          companyId,
          actor.actorId,
          id,
          body.signerName,
        );
        await audit(req, companyId, "clinic.visit_signed", "visit", id, {
          signedBy: body.signerName,
        });
        res.json(visit);
      } catch {
        res.status(404).json({ error: "Visit not found" });
      }
    },
  );

  // ---------- Prescriptions ----------
  router.post(
    "/companies/:companyId/business/clinics/visits/:id/prescriptions",
    validate(prescriptionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof prescriptionSchema>;
      try {
        const visit = await service.addPrescription(companyId, actor.actorId, id, body);
        await audit(
          req,
          companyId,
          "clinic.prescription_added",
          "visit",
          id,
          { drug: body.drug, dosage: body.dosage },
        );
        res.json(visit);
      } catch {
        res.status(404).json({ error: "Visit not found" });
      }
    },
  );

  router.delete(
    "/companies/:companyId/business/clinics/visits/:id/prescriptions/:index",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      const index = Number(req.params.index);
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      if (!Number.isInteger(index) || index < 0) {
        res.status(400).json({ error: "Invalid index" });
        return;
      }
      try {
        const visit = await service.removePrescription(
          companyId,
          actor.actorId,
          id,
          index,
        );
        await audit(req, companyId, "clinic.prescription_removed", "visit", id, {
          index,
        });
        res.json(visit);
      } catch {
        res.status(404).json({ error: "Visit not found" });
      }
    },
  );

  // ---------- Lab orders ----------
  router.post(
    "/companies/:companyId/business/clinics/visits/:id/lab-orders",
    validate(labOrderInputSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof labOrderInputSchema>;
      try {
        const visit = await service.addLabOrder(companyId, actor.actorId, id, body);
        await audit(req, companyId, "clinic.lab_ordered", "visit", id, {
          testCode: body.testCode,
        });
        res.status(201).json(visit);
      } catch {
        res.status(404).json({ error: "Visit not found" });
      }
    },
  );

  router.put(
    "/companies/:companyId/business/clinics/visits/:id/lab-orders/:index/result",
    validate(labResultSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      const index = Number(req.params.index);
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body as z.infer<typeof labResultSchema>;
      if (!Number.isInteger(index) || index < 0) {
        res.status(400).json({ error: "Invalid index" });
        return;
      }
      try {
        const visit = await service.updateLabResult(
          companyId,
          actor.actorId,
          id,
          index,
          body,
        );
        await audit(req, companyId, "clinic.lab_resulted", "visit", id, {
          index,
          abnormal: body.abnormal ?? false,
        });
        res.json(visit);
      } catch {
        res.status(404).json({ error: "Visit not found" });
      }
    },
  );

  return router;
}
