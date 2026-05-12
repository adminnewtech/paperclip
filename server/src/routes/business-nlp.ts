import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { createBusinessNlpService } from "../services/business-nlp-service.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const parseCommandSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  lang: z.enum(["ar", "en"]).optional(),
});

const extractReceiptSchema = z.object({
  rawText: z.string().trim().min(1).max(20_000),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function businessNlpRoutes(db: Db) {
  const router = Router();
  const nlp = createBusinessNlpService(db);

  router.post(
    "/companies/:companyId/business/nlp/parse-command",
    validate(parseCommandSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { text, lang } = req.body as z.infer<typeof parseCommandSchema>;
      const result = await nlp.parseCommand(text, lang ?? "ar");
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/business/nlp/extract-receipt",
    validate(extractReceiptSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { rawText } = req.body as z.infer<typeof extractReceiptSchema>;
      const result = await nlp.extractReceipt(rawText);
      res.json(result);
    },
  );

  return router;
}
