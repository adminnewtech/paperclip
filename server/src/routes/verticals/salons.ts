// ---------------------------------------------------------------------------
// Salons vertical REST routes
// ---------------------------------------------------------------------------

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../../middleware/validate.js";
import { assertCompanyAccess } from "../authz.js";
import { createSalonService } from "../../services/verticals/salons/index.js";
import {
  createBusinessMessagingService,
  type BusinessMessagingService,
} from "../../services/business-messaging-service.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const createServiceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  durationMinutes: z.number().int().positive().max(24 * 60),
  priceCents: z.number().int().nonnegative(),
});

const updateServiceSchema = createServiceSchema.partial();

const createStylistSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(50).optional(),
  specialties: z.array(z.string().trim().min(1)).optional(),
});

const updateStylistSchema = createStylistSchema.partial();

const createAppointmentSchema = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().trim().max(200).optional(),
  clientPhone: z.string().trim().max(50).optional(),
  stylistId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startAt: z.string().datetime(),
  notes: z.string().trim().max(2000).optional(),
  sendReminderHoursBefore: z.number().int().min(0).max(168).optional(),
});

const updateAppointmentSchema = createAppointmentSchema.partial();

const cancelAppointmentSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function salonsRoutes(
  db: Db,
  messagingService?: BusinessMessagingService,
): Router {
  const router = Router();
  const messaging = messagingService ?? createBusinessMessagingService(db);
  const salon = createSalonService(db, messaging);

  function handleError(res: import("express").Response, err: unknown): boolean {
    if (err instanceof Error) {
      const e = err as Error & { code?: string; details?: unknown };
      if (e.code === "APPOINTMENT_CONFLICT") {
        res
          .status(409)
          .json({ error: e.message, code: e.code, details: e.details });
        return true;
      }
      if (
        err.message === "Service not found" ||
        err.message === "Stylist not found" ||
        err.message === "Appointment not found"
      ) {
        res.status(404).json({ error: err.message });
        return true;
      }
    }
    return false;
  }

  // ---------------- Services ----------------
  router.get(
    "/companies/:companyId/business/salons/services",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const services = await salon.listServices(companyId);
      res.json({ services });
    },
  );

  router.post(
    "/companies/:companyId/business/salons/services",
    validate(createServiceSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof createServiceSchema>;
      const service = await salon.createService(companyId, body);
      res.status(201).json(service);
    },
  );

  router.put(
    "/companies/:companyId/business/salons/services/:id",
    validate(updateServiceSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const service = await salon.updateService(
          companyId,
          id,
          req.body as z.infer<typeof updateServiceSchema>,
        );
        res.json(service);
      } catch (err) {
        if (handleError(res, err)) return;
        throw err;
      }
    },
  );

  router.delete(
    "/companies/:companyId/business/salons/services/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      await salon.deleteService(companyId, id);
      res.status(204).end();
    },
  );

  // ---------------- Stylists ----------------
  router.get(
    "/companies/:companyId/business/salons/stylists",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const stylists = await salon.listStylists(companyId);
      res.json({ stylists });
    },
  );

  router.post(
    "/companies/:companyId/business/salons/stylists",
    validate(createStylistSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const stylist = await salon.createStylist(
        companyId,
        req.body as z.infer<typeof createStylistSchema>,
      );
      res.status(201).json(stylist);
    },
  );

  router.put(
    "/companies/:companyId/business/salons/stylists/:id",
    validate(updateStylistSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const stylist = await salon.updateStylist(
          companyId,
          id,
          req.body as z.infer<typeof updateStylistSchema>,
        );
        res.json(stylist);
      } catch (err) {
        if (handleError(res, err)) return;
        throw err;
      }
    },
  );

  router.delete(
    "/companies/:companyId/business/salons/stylists/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      await salon.deleteStylist(companyId, id);
      res.status(204).end();
    },
  );

  // ---------------- Appointments ----------------
  router.get(
    "/companies/:companyId/business/salons/appointments",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const stylistId =
        typeof req.query.stylistId === "string"
          ? req.query.stylistId
          : undefined;
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const appointments = await salon.listAppointments(companyId, {
        from,
        to,
        stylistId,
        status,
      });
      res.json({ appointments });
    },
  );

  router.post(
    "/companies/:companyId/business/salons/appointments",
    validate(createAppointmentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const appointment = await salon.createAppointment(
          companyId,
          req.body as z.infer<typeof createAppointmentSchema>,
        );
        res.status(201).json(appointment);
      } catch (err) {
        if (handleError(res, err)) return;
        throw err;
      }
    },
  );

  router.put(
    "/companies/:companyId/business/salons/appointments/:id",
    validate(updateAppointmentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const appointment = await salon.updateAppointment(
          companyId,
          id,
          req.body as z.infer<typeof updateAppointmentSchema>,
        );
        res.json(appointment);
      } catch (err) {
        if (handleError(res, err)) return;
        throw err;
      }
    },
  );

  router.post(
    "/companies/:companyId/business/salons/appointments/:id/cancel",
    validate(cancelAppointmentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const body = req.body as z.infer<typeof cancelAppointmentSchema>;
        const appointment = await salon.cancelAppointment(
          companyId,
          id,
          body.reason,
        );
        res.json(appointment);
      } catch (err) {
        if (handleError(res, err)) return;
        throw err;
      }
    },
  );

  router.post(
    "/companies/:companyId/business/salons/appointments/:id/complete",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const appointment = await salon.markCompleted(companyId, id);
        res.json(appointment);
      } catch (err) {
        if (handleError(res, err)) return;
        throw err;
      }
    },
  );

  router.post(
    "/companies/:companyId/business/salons/appointments/:id/no-show",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const appointment = await salon.markNoShow(companyId, id);
        res.json(appointment);
      } catch (err) {
        if (handleError(res, err)) return;
        throw err;
      }
    },
  );

  router.post(
    "/companies/:companyId/business/salons/appointments/:id/send-reminder",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const result = await salon.engine.sendReminder(companyId, id);
      res.json(result);
    },
  );

  // ---------------- Available slots ----------------
  router.get(
    "/companies/:companyId/business/salons/available-slots",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const stylistId =
        typeof req.query.stylistId === "string"
          ? req.query.stylistId
          : undefined;
      const durationMinutes = Number(req.query.durationMinutes);
      const from =
        typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      if (!stylistId || !from || !to || !Number.isFinite(durationMinutes)) {
        res
          .status(400)
          .json({ error: "stylistId, durationMinutes, from and to are required" });
        return;
      }
      const slots = await salon.engine.findAvailableSlots(
        companyId,
        stylistId,
        durationMinutes,
        { from, to },
      );
      res.json({ slots });
    },
  );

  // ---------------- Setup + Dashboard ----------------
  router.post(
    "/companies/:companyId/business/salons/setup-defaults",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await salon.setupDefaults(companyId);
      res.status(201).json(result);
    },
  );

  router.get(
    "/companies/:companyId/business/salons/dashboard",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const dashboard = await salon.getDashboard(companyId);
      res.json(dashboard);
    },
  );

  return router;
}
