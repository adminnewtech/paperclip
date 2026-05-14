import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { createBusinessAiService } from "../services/business-ai-service.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const entityIdSchema = z.object({
  entityId: z.string().uuid(),
});

const draftInvoiceSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  customerId: z.string().uuid().optional(),
});

const contactIdSchema = z.object({
  contactId: z.string().uuid(),
});

const ticketIdSchema = z.object({
  ticketId: z.string().uuid(),
});

const churnRiskSchema = z.object({}).passthrough();

const reportNarrativeSchema = z.object({
  reportType: z.enum(["pnl", "cash-flow", "balance-sheet"]),
  reportData: z.record(z.string(), z.unknown()),
  lang: z.enum(["en", "ar"]).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function businessAiRoutes(db: Db) {
  const router = Router();
  const ai = createBusinessAiService(db);

  // 1. Categorize expense
  router.post(
    "/companies/:companyId/business/ai/categorize-expense",
    validate(entityIdSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { entityId } = req.body as z.infer<typeof entityIdSchema>;
      const result = await ai.categorizeExpense(companyId, entityId);
      if ("error" in result) {
        const status = result.error === "not_found" ? 404 : 400;
        res.status(status).json({ error: result.error });
        return;
      }
      res.json(result);
    },
  );

  // 2. Suggest next action
  router.post(
    "/companies/:companyId/business/ai/suggest-next-action",
    validate(entityIdSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { entityId } = req.body as z.infer<typeof entityIdSchema>;
      const result = await ai.suggestNextAction(companyId, entityId);
      if ("error" in result) {
        res.status(404).json({ error: result.error });
        return;
      }
      res.json(result);
    },
  );

  // 3. Draft invoice from text
  router.post(
    "/companies/:companyId/business/ai/draft-invoice-from-text",
    validate(draftInvoiceSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { text, customerId } = req.body as z.infer<typeof draftInvoiceSchema>;
      const result = await ai.draftInvoiceFromText(companyId, text, customerId);
      res.json(result);
    },
  );

  // 4. Summarize customer
  router.post(
    "/companies/:companyId/business/ai/summarize-customer",
    validate(contactIdSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { contactId } = req.body as z.infer<typeof contactIdSchema>;
      const result = await ai.summarizeCustomer(companyId, contactId);
      if ("error" in result) {
        res.status(404).json({ error: result.error });
        return;
      }
      res.json(result);
    },
  );

  // 5. Churn risk
  router.post(
    "/companies/:companyId/business/ai/churn-risk",
    validate(churnRiskSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await ai.churnRisk(companyId);
      res.json(result);
    },
  );

  // 6. Report narrative
  router.post(
    "/companies/:companyId/business/ai/generate-report-narrative",
    validate(reportNarrativeSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { reportType, reportData, lang } = req.body as z.infer<
        typeof reportNarrativeSchema
      >;
      const result = await ai.generateReportNarrative(
        reportType,
        reportData,
        lang ?? "en",
      );
      res.json(result);
    },
  );

  // 7. Classify ticket
  router.post(
    "/companies/:companyId/business/ai/classify-ticket",
    validate(ticketIdSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { ticketId } = req.body as z.infer<typeof ticketIdSchema>;
      const result = await ai.classifyTicket(companyId, ticketId);
      if ("error" in result) {
        const status = result.error === "not_found" ? 404 : 400;
        res.status(status).json({ error: result.error });
        return;
      }
      res.json(result);
    },
  );

  return router;
}
