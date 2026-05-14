/**
 * REST + SSE routes for the Workspace Core (Phase 11 foundation).
 *
 * Endpoints are all under `assertCompanyAccess` so no surface allows cross-
 * tenant access. The streaming endpoint follows the same shape as
 * `business-stream` — long-lived `text/event-stream` with a 15s heartbeat
 * frame so HTTP intermediaries do not idle out the connection.
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  type ChannelKind,
  type MessageKind,
  type WorkspaceMemberStatus,
  type WorkspaceStreamEvent,
  type WorkspaceMessageAttachment,
  type WorkspaceMessageCard,
  type WorkspaceMessageMention,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import type { WorkspaceService } from "../services/workspace/index.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const channelKindSchema = z.enum(["public", "private", "dm", "system"]);

const createChannelSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/i, "Slug must be alphanumeric, dash, or underscore"),
  name: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1_000).optional(),
  kind: channelKindSchema,
  defaultMembers: z.boolean().optional(),
});

const patchChannelSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  nameAr: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1_000).optional(),
  topicPin: z.string().trim().max(1_000).optional(),
});

const addMemberSchema = z.object({
  memberId: z.string().trim().min(1).max(200),
});

const createDmSchema = z.object({
  otherMemberId: z.string().trim().min(1).max(200),
});

const messageKindSchema = z.enum([
  "text",
  "system",
  "event",
  "card",
  "command_result",
  "ai_response",
]);

const attachmentSchema = z.object({
  url: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  size: z.number().int().nonnegative().optional(),
});

const cardActionSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  labelAr: z.string().trim().optional(),
  danger: z.boolean().optional(),
});

const cardSchema = z.object({
  entityType: z.string().trim().min(1),
  entityId: z.string().trim().min(1),
  actions: z.array(cardActionSchema).optional(),
  snapshot: z.record(z.string(), z.unknown()).optional(),
});

const mentionSchema = z.object({
  type: z.enum(["user", "agent", "channel"]),
  id: z.string().trim().min(1),
});

const sendMessageSchema = z.object({
  threadRootId: z.string().uuid().optional(),
  kind: messageKindSchema.optional(),
  body: z.string().min(1).max(40_000),
  bodyAr: z.string().max(40_000).optional(),
  attachments: z.array(attachmentSchema).optional(),
  card: cardSchema.optional(),
  mentions: z.array(mentionSchema).optional(),
  authorDisplayName: z.string().trim().max(200).optional(),
  authorAvatar: z.string().trim().max(500).optional(),
});

const editMessageSchema = z.object({
  body: z.string().min(1).max(40_000),
});

const reactionSchema = z.object({
  emoji: z.string().trim().min(1).max(32),
});

const memberStatusSchema = z.object({
  status: z.enum(["online", "away", "busy", "offline", "working"]),
  message: z.string().trim().max(500).optional(),
});

const markReadSchema = z.object({
  lastReadMessageId: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick a sensible authorId for the caller. Humans use their `userId`; agent
 * calls bear an `agent:<slug>` composite. Falls back to `"system"` only when
 * the request comes from a server-side runner (rare).
 */
function callerMemberId(req: Parameters<typeof getActorInfo>[0]): string {
  const actor = req.actor;
  if (actor.type === "agent" && actor.agentId) {
    return `agent:${actor.agentId}`;
  }
  if (actor.type === "board" && actor.userId) {
    return actor.userId;
  }
  return "system";
}

function callerAuthorType(
  req: Parameters<typeof getActorInfo>[0],
): "user" | "agent" | "system" {
  if (req.actor.type === "agent") return "agent";
  if (req.actor.type === "board") return "user";
  return "system";
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function workspaceRoutes(_db: Db, workspace: WorkspaceService) {
  const router = Router();

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------
  router.get("/companies/:companyId/workspace/channels", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const memberId =
      typeof req.query.memberId === "string" ? req.query.memberId : undefined;
    const kind =
      typeof req.query.kind === "string"
        ? (req.query.kind as ChannelKind)
        : undefined;
    const includeArchived = req.query.includeArchived === "true";
    const channels = await workspace.channels.list(companyId, {
      memberId,
      kind,
      includeArchived,
    });
    res.json({ channels });
  });

  router.post(
    "/companies/:companyId/workspace/channels",
    validate(createChannelSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof createChannelSchema>;
      const actor = getActorInfo(req);
      // Reject duplicate slugs early — channels share a per-company namespace.
      const existing = await workspace.channels.getBySlug(companyId, body.slug);
      if (existing) {
        res.status(409).json({ error: "Channel slug already exists" });
        return;
      }
      const channel = await workspace.channels.create(companyId, {
        slug: body.slug,
        name: body.name,
        nameAr: body.nameAr,
        description: body.description,
        kind: body.kind,
        defaultMembers: body.defaultMembers,
        createdBy: actor.actorId ?? undefined,
      });
      res.status(201).json(channel);
    },
  );

  router.get(
    "/companies/:companyId/workspace/channels/by-slug/:slug",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const channel = await workspace.channels.getBySlug(
        companyId,
        req.params.slug as string,
      );
      if (!channel) {
        res.status(404).json({ error: "Channel not found" });
        return;
      }
      res.json(channel);
    },
  );

  router.post(
    "/companies/:companyId/workspace/channels/seed-defaults",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const result = await workspace.seedDefaults(
        companyId,
        actor.actorId ?? undefined,
      );
      res.status(201).json(result);
    },
  );

  router.get(
    "/companies/:companyId/workspace/channels/:channelId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const channel = await workspace.channels.get(
        companyId,
        req.params.channelId as string,
      );
      if (!channel) {
        res.status(404).json({ error: "Channel not found" });
        return;
      }
      res.json(channel);
    },
  );

  router.patch(
    "/companies/:companyId/workspace/channels/:channelId",
    validate(patchChannelSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      try {
        const channel = await workspace.channels.update(
          companyId,
          req.params.channelId as string,
          req.body as z.infer<typeof patchChannelSchema>,
        );
        res.json(channel);
      } catch (err) {
        res.status(404).json({ error: (err as Error).message });
      }
    },
  );

  router.delete(
    "/companies/:companyId/workspace/channels/:channelId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await workspace.channels.archive(
        companyId,
        req.params.channelId as string,
      );
      res.status(204).end();
    },
  );

  // -------------------------------------------------------------------------
  // Memberships
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/workspace/channels/:channelId/members",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const memberIds = await workspace.channels.listMembers(
        companyId,
        req.params.channelId as string,
      );
      res.json({ memberIds });
    },
  );

  router.post(
    "/companies/:companyId/workspace/channels/:channelId/members",
    validate(addMemberSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof addMemberSchema>;
      await workspace.channels.addMember(
        companyId,
        req.params.channelId as string,
        body.memberId,
      );
      res.status(204).end();
    },
  );

  router.delete(
    "/companies/:companyId/workspace/channels/:channelId/members/:memberId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await workspace.channels.removeMember(
        companyId,
        req.params.channelId as string,
        req.params.memberId as string,
      );
      res.status(204).end();
    },
  );

  // -------------------------------------------------------------------------
  // DMs
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/workspace/dms",
    validate(createDmSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof createDmSchema>;
      const me = callerMemberId(req);
      const channel = await workspace.channels.findOrCreateDm(
        companyId,
        me,
        body.otherMemberId,
      );
      res.status(201).json(channel);
    },
  );

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/workspace/channels/:channelId/messages",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const channelId = req.params.channelId as string;
      const before =
        typeof req.query.before === "string" ? req.query.before : undefined;
      const after =
        typeof req.query.after === "string" ? req.query.after : undefined;
      const threadRootId =
        typeof req.query.threadRootId === "string"
          ? req.query.threadRootId
          : undefined;
      const limit =
        typeof req.query.limit === "string"
          ? Number.parseInt(req.query.limit, 10)
          : undefined;
      const result = await workspace.messages.list(companyId, {
        channelId,
        before,
        after,
        threadRootId,
        limit,
      });
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/workspace/channels/:channelId/messages",
    validate(sendMessageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const channelId = req.params.channelId as string;
      const body = req.body as z.infer<typeof sendMessageSchema>;
      const authorId = callerMemberId(req);
      const authorType = callerAuthorType(req);
      const message = await workspace.messages.send(companyId, {
        channelId,
        threadRootId: body.threadRootId,
        kind: body.kind ?? "text",
        authorType,
        authorId,
        authorDisplayName: body.authorDisplayName,
        authorAvatar: body.authorAvatar,
        body: body.body,
        bodyAr: body.bodyAr,
        attachments: body.attachments as
          | WorkspaceMessageAttachment[]
          | undefined,
        card: body.card as WorkspaceMessageCard | undefined,
        mentions: body.mentions as WorkspaceMessageMention[] | undefined,
      });
      res.status(201).json(message);
    },
  );

  router.get(
    "/companies/:companyId/workspace/messages/:messageId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const message = await workspace.messages.get(
        companyId,
        req.params.messageId as string,
      );
      if (!message) {
        res.status(404).json({ error: "Message not found" });
        return;
      }
      res.json(message);
    },
  );

  router.patch(
    "/companies/:companyId/workspace/messages/:messageId",
    validate(editMessageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof editMessageSchema>;
      try {
        const message = await workspace.messages.edit(
          companyId,
          req.params.messageId as string,
          body.body,
          callerMemberId(req),
        );
        res.json(message);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  router.delete(
    "/companies/:companyId/workspace/messages/:messageId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await workspace.messages.delete(
        companyId,
        req.params.messageId as string,
        callerMemberId(req),
      );
      res.status(204).end();
    },
  );

  router.post(
    "/companies/:companyId/workspace/messages/:messageId/reactions",
    validate(reactionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof reactionSchema>;
      const message = await workspace.messages.addReaction(
        companyId,
        req.params.messageId as string,
        callerMemberId(req),
        body.emoji,
      );
      res.json(message);
    },
  );

  router.delete(
    "/companies/:companyId/workspace/messages/:messageId/reactions/:emoji",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const emoji = decodeURIComponent(req.params.emoji as string);
      const message = await workspace.messages.removeReaction(
        companyId,
        req.params.messageId as string,
        callerMemberId(req),
        emoji,
      );
      res.json(message);
    },
  );

  router.get(
    "/companies/:companyId/workspace/search/messages",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const channelId =
        typeof req.query.channelId === "string"
          ? req.query.channelId
          : undefined;
      const authorId =
        typeof req.query.authorId === "string"
          ? req.query.authorId
          : undefined;
      const limit =
        typeof req.query.limit === "string"
          ? Number.parseInt(req.query.limit, 10)
          : undefined;
      const messages = await workspace.messages.search(companyId, q, {
        channelId,
        authorId,
        limit,
      });
      res.json({ messages });
    },
  );

  // -------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------
  router.get("/companies/:companyId/workspace/members", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const type =
      typeof req.query.type === "string"
        ? (req.query.type as "user" | "agent" | "hermes")
        : undefined;
    const members = await workspace.members.list(companyId, { type });
    res.json({ members });
  });

  router.get(
    "/companies/:companyId/workspace/members/:memberId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const member = await workspace.members.get(
        companyId,
        req.params.memberId as string,
      );
      if (!member) {
        res.status(404).json({ error: "Member not found" });
        return;
      }
      res.json(member);
    },
  );

  router.post(
    "/companies/:companyId/workspace/members/:memberId/status",
    validate(memberStatusSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof memberStatusSchema>;
      await workspace.members.updateStatus(
        companyId,
        req.params.memberId as string,
        body.status as WorkspaceMemberStatus,
        body.message,
      );
      res.status(204).end();
    },
  );

  // -------------------------------------------------------------------------
  // Read state
  // -------------------------------------------------------------------------
  router.get("/companies/:companyId/workspace/unread", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const counts = await workspace.readState.getUnreadCounts(
      companyId,
      callerMemberId(req),
    );
    res.json({ counts });
  });

  router.post(
    "/companies/:companyId/workspace/channels/:channelId/mark-read",
    validate(markReadSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof markReadSchema>;
      await workspace.readState.markRead(
        companyId,
        callerMemberId(req),
        req.params.channelId as string,
        body.lastReadMessageId,
      );
      res.status(204).end();
    },
  );

  router.post(
    "/companies/:companyId/workspace/mark-all-read",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await workspace.readState.markAllRead(companyId, callerMemberId(req));
      res.status(204).end();
    },
  );

  // -------------------------------------------------------------------------
  // Typing (transient — no DB)
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/workspace/channels/:channelId/typing",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      workspace.stream.emit(companyId, {
        kind: "typing",
        channelId: req.params.channelId as string,
        memberId: callerMemberId(req),
      });
      res.status(204).end();
    },
  );

  // -------------------------------------------------------------------------
  // Real-time stream
  // -------------------------------------------------------------------------
  router.get("/companies/:companyId/workspace/stream", (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    // Open the stream eagerly so the client's EventSource resolves.
    res.write(":ok\n\n");

    let closed = false;

    const writeEvent = (event: WorkspaceStreamEvent) => {
      if (closed || !res.writable) return;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    };

    const unsubscribe = workspace.stream.subscribe(companyId, writeEvent);

    const heartbeat = setInterval(() => {
      if (closed || !res.writable) return;
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      try {
        res.end();
      } catch {
        // The connection may already be torn down.
      }
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("error", cleanup);
    res.on("close", cleanup);
  });

  return router;
}
