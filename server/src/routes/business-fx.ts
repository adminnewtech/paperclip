import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  GCC_CURRENCY_CODES,
  isGccCurrency,
  type GccCurrency,
} from "@paperclipai/shared";
import { assertCompanyAccess } from "./authz.js";
import { createFxRatesService } from "../services/fx-rates-service.js";

const updateRateSchema = z.object({
  rate: z.number().finite().positive(),
});

function parseCurrencyParam(value: unknown): GccCurrency | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return isGccCurrency(upper) ? upper : null;
}

export function businessFxRoutes(db: Db) {
  const router = Router();
  const service = createFxRatesService(db);

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/fx-rates
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/fx-rates",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const baseRaw = req.query.base;
      let base: GccCurrency | undefined;
      if (typeof baseRaw === "string" && baseRaw.length > 0) {
        const parsed = parseCurrencyParam(baseRaw);
        if (!parsed) {
          res.status(400).json({
            error: "Invalid base currency",
            allowed: GCC_CURRENCY_CODES,
          });
          return;
        }
        base = parsed;
      }

      const rates = await service.getAllRates(companyId, base);
      res.json({ rates });
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/fx-rates/:from/:to
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/fx-rates/:from/:to",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const from = parseCurrencyParam(req.params.from);
      const to = parseCurrencyParam(req.params.to);
      if (!from || !to) {
        res.status(400).json({
          error: "Invalid currency code",
          allowed: GCC_CURRENCY_CODES,
        });
        return;
      }

      const rate = await service.getRate(companyId, from, to);
      res.json(rate);
    },
  );

  // -------------------------------------------------------------------------
  // POST /companies/:companyId/business/fx-rates/refresh
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/fx-rates/refresh",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      await service.refreshRates(companyId);
      const rates = await service.getAllRates(companyId);
      res.json({ refreshed: true, rates });
    },
  );

  // -------------------------------------------------------------------------
  // PUT /companies/:companyId/business/fx-rates/:from/:to
  // -------------------------------------------------------------------------
  router.put(
    "/companies/:companyId/business/fx-rates/:from/:to",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const from = parseCurrencyParam(req.params.from);
      const to = parseCurrencyParam(req.params.to);
      if (!from || !to) {
        res.status(400).json({
          error: "Invalid currency code",
          allowed: GCC_CURRENCY_CODES,
        });
        return;
      }
      if (from === to) {
        res.status(400).json({ error: "from and to must differ" });
        return;
      }

      const parsed = updateRateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid request body",
          issues: parsed.error.issues,
        });
        return;
      }

      const updated = await service.setRate(
        companyId,
        from,
        to,
        parsed.data.rate,
        "manual",
      );
      res.json(updated);
    },
  );

  return router;
}
