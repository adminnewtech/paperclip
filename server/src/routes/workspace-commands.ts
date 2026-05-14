/**
 * Workspace slash-command + smart-card REST endpoints.
 *
 * All routes are scoped to a company via {@link assertCompanyAccess}. The
 * shape mirrors how the workspace UI consumes them:
 *
 *   - Commands
 *     - GET    /companies/:companyId/workspace/commands
 *     - GET    /companies/:companyId/workspace/commands/autocomplete?prefix=
 *     - POST   /companies/:companyId/workspace/commands/execute   { input, channelId, lang? }
 *     - POST   /companies/:companyId/workspace/commands/dry-run   { input }
 *
 *   - Smart cards
 *     - GET    /companies/:companyId/workspace/cards/:cardType/:entityId
 *     - GET    /companies/:companyId/workspace/cards/:cardType/:entityId/actions
 *     - POST   /companies/:companyId/workspace/cards/:cardType/:entityId/actions/:actionKey
 */
import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import type { SmartCardType } from "@paperclipai/shared";
import { SMART_CARD_TYPES, isValidActionKey } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  createCommandsService,
  type CommandDependencies,
} from "../services/workspace/commands/index.js";
import { createSmartCardsService } from "../services/workspace/smart-cards/index.js";

const executeSchema = z.object({
  input: z.string().min(1).max(2000),
  channelId: z.string().trim().min(1).max(255),
  lang: z.enum(["ar", "en"]).optional(),
});

const dryRunSchema = z.object({
  input: z.string().min(1).max(2000),
});

const actionSchema = z.object({
  args: z.record(z.string(), z.unknown()).optional(),
  confirmed: z.boolean().optional(),
});

function isSmartCardType(value: string): value is SmartCardType {
  return (SMART_CARD_TYPES as readonly string[]).includes(value);
}

/**
 * Build the routes. Optional service hooks may be passed when those services
 * are wired up elsewhere (P11-A message poster, P11-B agent chatter, etc.).
 * Pass nothing and the commands will still work in degraded mode.
 */
export function workspaceCommandsRoutes(
  db: Db,
  hooks: Omit<CommandDependencies, "db"> = {},
) {
  const router = Router();
  const commands = createCommandsService({ db, ...hooks });
  const cards = createSmartCardsService(db);

  // ---- Commands ----------------------------------------------------------
  router.get(
    "/companies/:companyId/workspace/commands",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const lang = typeof req.query.lang === "string" && (req.query.lang === "ar" || req.query.lang === "en")
        ? req.query.lang
        : undefined;
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      res.json({ commands: commands.list({ lang, category }) });
    },
  );

  router.get(
    "/companies/:companyId/workspace/commands/autocomplete",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
      const lang = typeof req.query.lang === "string" && (req.query.lang === "ar" || req.query.lang === "en")
        ? req.query.lang
        : undefined;
      res.json({ suggestions: commands.autocomplete(prefix, { lang }) });
    },
  );

  router.post(
    "/companies/:companyId/workspace/commands/execute",
    validate(executeSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof executeSchema>;
      const actor = getActorInfo(req);
      const result = await commands.execute(body.input, {
        companyId,
        channelId: body.channelId,
        actorMemberId: actor.actorId ?? "unknown",
        lang: body.lang ?? "en",
      });
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/workspace/commands/dry-run",
    validate(dryRunSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof dryRunSchema>;
      const parsed = commands.parse(body.input);
      if (!parsed) {
        res.status(400).json({ error: "Not a valid slash command", parsed: null });
        return;
      }
      const spec = commands.get(parsed.name);
      res.json({ parsed, command: spec });
    },
  );

  // ---- Smart cards -------------------------------------------------------
  router.get(
    "/companies/:companyId/workspace/cards/:cardType/:entityId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const cardType = req.params.cardType as string;
      const entityId = req.params.entityId as string;
      assertCompanyAccess(req, companyId);
      if (!isSmartCardType(cardType)) {
        res.status(400).json({ error: "Unknown card type" });
        return;
      }
      const card = await cards.renderCard(companyId, cardType, entityId);
      if (!card) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(card);
    },
  );

  router.get(
    "/companies/:companyId/workspace/cards/:cardType/:entityId/actions",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const cardType = req.params.cardType as string;
      const entityId = req.params.entityId as string;
      assertCompanyAccess(req, companyId);
      if (!isSmartCardType(cardType)) {
        res.status(400).json({ error: "Unknown card type" });
        return;
      }
      const actions = await cards.getAvailableActions(companyId, cardType, entityId);
      res.json({ actions });
    },
  );

  router.post(
    "/companies/:companyId/workspace/cards/:cardType/:entityId/actions/:actionKey",
    validate(actionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const cardType = req.params.cardType as string;
      const entityId = req.params.entityId as string;
      const actionKey = req.params.actionKey as string;
      assertCompanyAccess(req, companyId);
      if (!isSmartCardType(cardType)) {
        res.status(400).json({ error: "Unknown card type" });
        return;
      }
      if (!isValidActionKey(cardType, actionKey)) {
        res.status(400).json({ error: "Unknown action" });
        return;
      }
      const body = (req.body ?? {}) as z.infer<typeof actionSchema>;

      // Honour confirmation flag: if the action's spec marks
      // requiresConfirmation and the caller hasn't yet confirmed, return
      // needsConfirmation=true without executing.
      const availableActions = await cards.getAvailableActions(companyId, cardType, entityId);
      const action = availableActions.find((a) => a.key === actionKey);
      if (action?.requiresConfirmation && !body.confirmed) {
        res.json({
          success: false,
          needsConfirmation: true,
          message: `Confirmation required for "${action.label}".`,
          messageAr: `هذا الإجراء يحتاج تأكيداً: "${action.labelAr}".`,
        });
        return;
      }

      const actor = getActorInfo(req);
      const result = await cards.executeAction(
        companyId,
        cardType,
        entityId,
        actionKey,
        { actorMemberId: actor.actorId ?? "unknown" },
        body.args ?? {},
      );
      res.json(result);
    },
  );

  return router;
}
