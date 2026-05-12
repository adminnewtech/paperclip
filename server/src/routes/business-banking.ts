// ---------------------------------------------------------------------------
// Business banking routes
// ---------------------------------------------------------------------------
//
// All endpoints are company-scoped (assertCompanyAccess). The OAuth callback
// is also company-scoped — agents/users hit it from inside the app after
// the bank redirects them back via the configured redirect URL. State
// validation is the connector's responsibility.

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import {
  createBankingService,
  type BankConnectorName,
} from "../services/banking/index.js";
import { createReconciliationEngine } from "../services/banking/reconciliation-engine.js";

const connectorNameSchema = z.enum([
  "cbk_kuwait",
  "sama_saudi",
  "uae_oba",
  "plaid",
  "mock",
]);

const connectSchema = z.object({
  connector: connectorNameSchema,
  redirectUrl: z.string().url().max(2048),
  scopes: z.array(z.string()).optional(),
});

const matchSchema = z.object({
  entityId: z.string().uuid(),
  entityType: z.enum(["invoice", "expense", "payment"]),
});

const ignoreSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const autoReconcileSchema = z.object({
  threshold: z.number().min(0).max(1).optional(),
});

export function businessBankingRoutes(db: Db) {
  const router = Router();
  const reconciler = createReconciliationEngine(db);
  const service = createBankingService(db, reconciler);

  // ----- Connectors -----
  router.get(
    "/companies/:companyId/business/banking/connectors",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const connectors = service.listAvailableConnectors();
      res.json({ connectors });
    },
  );

  // ----- Connect (initiate consent) -----
  router.post(
    "/companies/:companyId/business/banking/connect",
    validate(connectSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof connectSchema>;
      const connector = service.getConnector(body.connector as BankConnectorName);
      const { consentId, authUrl } = await connector.initiateConsent({
        companyId,
        redirectUrl: body.redirectUrl,
        scopes: body.scopes,
      });

      // Persist a pending consent row immediately so the OAuth callback can
      // look it up by externalConsentId.
      await service.recordConsent(companyId, {
        id: consentId,
        connectorName: body.connector as BankConnectorName,
        externalConsentId: consentId,
        status: "pending",
        scopes: body.scopes ?? [],
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
        accounts: [],
      });

      // The "mock" connector skips OAuth entirely — finalize the consent
      // and pre-load the accounts so the demo flow works in one click.
      if (body.connector === "mock") {
        const consent = await connector.completeConsent(consentId);
        await service.recordConsent(companyId, consent);
        const accounts = await connector.listAccounts(consentId);
        for (const a of accounts) {
          await service.recordAccount(companyId, a, "mock", consentId);
          // Seed initial transactions for the demo.
          const txns = await connector.fetchTransactions(consentId, a.externalAccountId, {
            limit: 60,
          });
          await service.recordTransactions(
            companyId,
            txns.map((t) => ({ ...t, accountId: a.externalAccountId })),
          );
        }
        res.json({ consentId, authUrl, autoCompleted: true });
        return;
      }

      res.json({ consentId, authUrl, autoCompleted: false });
    },
  );

  // ----- OAuth callback -----
  router.get(
    "/companies/:companyId/business/banking/oauth-callback",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const code = typeof req.query.code === "string" ? req.query.code : undefined;
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const consentIdFromQuery =
        typeof req.query.consent === "string"
          ? req.query.consent
          : typeof req.query.consent_id === "string"
            ? req.query.consent_id
            : undefined;
      // state format used by our initiateConsent helpers: "<companyId>:<consentId>".
      const consentId =
        consentIdFromQuery ?? (state.split(":")[1] ?? state) ?? "";
      if (!consentId) {
        res.status(400).json({ error: "Missing consent id" });
        return;
      }
      const existing = await service.getConsent(companyId, consentId);
      if (!existing) {
        res.status(404).json({ error: "Unknown consent" });
        return;
      }
      const connector = service.getConnector(existing.consent.connectorName);
      try {
        const consent = await connector.completeConsent(consentId, code);
        await service.recordConsent(companyId, consent);
        const accounts = await connector.listAccounts(consentId);
        for (const a of accounts) {
          await service.recordAccount(
            companyId,
            a,
            existing.consent.connectorName,
            consentId,
          );
        }
        res.json({ consent, accounts });
      } catch (err) {
        res.status(502).json({
          error: "OAuth completion failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // ----- Accounts -----
  router.get(
    "/companies/:companyId/business/banking/accounts",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const accounts = await service.listAccounts(companyId);
      res.json({ accounts });
    },
  );

  router.post(
    "/companies/:companyId/business/banking/accounts/:id/sync",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      try {
        const result = await service.syncAccount(companyId, id);
        res.json(result);
      } catch (err) {
        res.status(502).json({
          error: "Sync failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // ----- Transactions -----
  router.get(
    "/companies/:companyId/business/banking/transactions",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const txns = await service.listTransactions(companyId, {
        accountId:
          typeof req.query.accountId === "string" ? req.query.accountId : undefined,
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        reconciliationStatus:
          typeof req.query.reconciliationStatus === "string"
            ? req.query.reconciliationStatus
            : undefined,
        limit:
          typeof req.query.limit === "string"
            ? Math.max(1, Number(req.query.limit) || 200)
            : undefined,
      });
      res.json({ transactions: txns });
    },
  );

  router.get(
    "/companies/:companyId/business/banking/transactions/:id/match-suggestions",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const found = await service.getTransaction(companyId, id);
      if (!found) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const suggestions = await reconciler.suggestMatches(companyId, found.txn, {
        limit: 8,
      });
      res.json({ suggestions });
    },
  );

  router.post(
    "/companies/:companyId/business/banking/transactions/:id/match",
    validate(matchSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof matchSchema>;
      await reconciler.applyMatch(
        companyId,
        id,
        body.entityId,
        body.entityType,
        false,
      );
      res.json({ ok: true });
    },
  );

  router.post(
    "/companies/:companyId/business/banking/transactions/:id/unmatch",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      await reconciler.unmatch(companyId, id);
      res.json({ ok: true });
    },
  );

  router.post(
    "/companies/:companyId/business/banking/transactions/:id/ignore",
    validate(ignoreSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof ignoreSchema>;
      await reconciler.ignoreTxn(companyId, id, body.reason);
      res.json({ ok: true });
    },
  );

  router.post(
    "/companies/:companyId/business/banking/auto-reconcile",
    validate(autoReconcileSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof autoReconcileSchema>;
      const result = await reconciler.autoReconcileAll(companyId, body.threshold);
      res.json(result);
    },
  );

  return router;
}
