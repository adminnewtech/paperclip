/**
 * AI Members service.
 *
 * Phase 11-B integration: makes the 5 hired business agents
 * (Sara/Khaled/Layla/Omar/Mariam) appear as real workspace members.
 *
 * P11-A (the workspace core) owns the canonical implementations of
 * channel/member/message storage. To avoid hard coupling while the two
 * phases are developed in parallel, this service depends on the
 * `AgentMemberRegistrar` and `MessagePoster` interfaces below — the
 * wiring in app.ts will pass real adapters at runtime via the
 * `__setRegistrar` / `__setPoster` hooks.
 *
 * Until P11-A is wired, every method becomes a safe fire-and-forget
 * (logged and skipped).
 */

import type { Db } from "@paperclipai/db";
import {
  BUSINESS_AGENTS,
  getBusinessAgentDefinition,
  type BusinessAgentDefinition,
} from "@paperclipai/shared";
import { logger } from "../../middleware/logger.js";

// ---------------------------------------------------------------------------
// Public interfaces (TODO: replace with imports from P11-A once stable)
// ---------------------------------------------------------------------------

export interface AgentMemberInfo {
  displayName: string;
  displayNameAr: string;
  avatar: string;
  title: string;
  titleAr: string;
}

export interface AgentMemberRegistrar {
  /** Register an agent as a workspace member (idempotent). */
  registerAgent(
    companyId: string,
    agentSlug: string,
    info: AgentMemberInfo,
  ): Promise<void>;
  /** Add the agent member to a channel by slug (idempotent). */
  addMemberToChannelBySlug(
    companyId: string,
    channelSlug: string,
    agentSlug: string,
  ): Promise<void>;
  /** Update presence/status. */
  updateStatus(
    companyId: string,
    agentSlug: string,
    status: AgentPresenceStatus,
    message?: string,
  ): Promise<void>;
}

export type AgentPresenceStatus =
  | "online"
  | "busy"
  | "idle"
  | "offline"
  | "needs_attention";

export interface MessagePoster {
  /**
   * Post a system event to a channel by slug. Returns the new message id,
   * or `null` if posting was skipped/failed.
   */
  postSystemEvent(
    companyId: string,
    channelSlug: string,
    body: string,
    opts?: {
      kind?: string;
      bodyAr?: string;
      card?: unknown;
      importance?: string;
    },
  ): Promise<{ id: string } | null>;

  /**
   * Post a message AS an agent. The implementation in P11-A is expected to
   * resolve the agent slug to a member id and forge a message authored by
   * that member.
   */
  postAsAgent(
    companyId: string,
    agentSlug: string,
    channelSlug: string,
    body: string,
    opts?: {
      bodyAr?: string;
      card?: unknown;
      threadRootId?: string;
    },
  ): Promise<{ id: string } | null>;
}

export interface AiMembersService {
  /**
   * Register all 5 business agents as workspace members (idempotent).
   * Pass a real registrar to actually do the writes; otherwise the call
   * is a no-op.
   */
  registerAllAgents(
    companyId: string,
    registrar?: AgentMemberRegistrar,
  ): Promise<void>;

  setAgentBusy(
    companyId: string,
    agentSlug: string,
    statusMessage?: string,
  ): Promise<void>;
  setAgentIdle(companyId: string, agentSlug: string): Promise<void>;
  setAgentNeedsAttention(
    companyId: string,
    agentSlug: string,
    reason: string,
  ): Promise<void>;

  postAsAgent(
    companyId: string,
    agentSlug: string,
    channelSlug: string,
    body: string,
    opts?: {
      bodyAr?: string;
      card?: unknown;
      threadRootId?: string;
    },
  ): Promise<{ id: string } | null>;

  /** Return the agent-to-channels assignment used by registerAllAgents. */
  getAgentChannelAssignments(): Record<string, string[]>;

  /** Late-binding wiring hooks (called from app.ts once P11-A is up). */
  __setRegistrar(registrar: AgentMemberRegistrar | null): void;
  __setPoster(poster: MessagePoster | null): void;
}

// ---------------------------------------------------------------------------
// Default per-agent channel memberships
// ---------------------------------------------------------------------------

const AGENT_CHANNEL_ASSIGNMENTS: Record<string, string[]> = {
  accountant: ["general", "finance", "ai-team"],
  sales: ["general", "sales", "ai-team"],
  customer_service: ["general", "support", "ai-team"],
  inventory: ["general", "operations", "ai-team"],
  marketing: ["general", "sales", "ai-team"],
};

function describeAgent(def: BusinessAgentDefinition): AgentMemberInfo {
  return {
    displayName: def.personaName,
    displayNameAr: def.personaNameAr,
    avatar: def.emoji,
    title: def.title,
    titleAr: def.titleAr,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateAiMembersServiceOpts {
  registrar?: AgentMemberRegistrar | null;
  poster?: MessagePoster | null;
}

export function createAiMembersService(
  db: Db,
  opts: CreateAiMembersServiceOpts = {},
): AiMembersService {
  // db is reserved for future direct DB writes (e.g. caching presence) —
  // referenced here so the linter doesn't flag the unused parameter.
  void db;

  const state: {
    registrar: AgentMemberRegistrar | null;
    poster: MessagePoster | null;
  } = {
    registrar: opts.registrar ?? null,
    poster: opts.poster ?? null,
  };

  async function registerAllAgents(
    companyId: string,
    explicitRegistrar?: AgentMemberRegistrar,
  ): Promise<void> {
    const reg = explicitRegistrar ?? state.registrar;
    if (!reg) {
      logger.debug(
        { companyId },
        "ai-members: registerAllAgents skipped — no registrar wired (P11-A not active)",
      );
      return;
    }
    for (const def of BUSINESS_AGENTS) {
      try {
        await reg.registerAgent(companyId, def.slug, describeAgent(def));
        const channels = AGENT_CHANNEL_ASSIGNMENTS[def.slug] ?? ["general"];
        for (const slug of channels) {
          try {
            await reg.addMemberToChannelBySlug(companyId, slug, def.slug);
          } catch (err) {
            logger.warn(
              { err, companyId, agentSlug: def.slug, channelSlug: slug },
              "ai-members: failed to add agent to channel",
            );
          }
        }
      } catch (err) {
        logger.warn(
          { err, companyId, agentSlug: def.slug },
          "ai-members: failed to register agent",
        );
      }
    }
  }

  async function updateAgentStatus(
    companyId: string,
    agentSlug: string,
    status: AgentPresenceStatus,
    message?: string,
  ): Promise<void> {
    const reg = state.registrar;
    if (!reg) {
      logger.debug(
        { companyId, agentSlug, status },
        "ai-members: status update skipped — no registrar wired",
      );
      return;
    }
    if (!getBusinessAgentDefinition(agentSlug)) {
      logger.warn({ agentSlug }, "ai-members: unknown agent slug");
      return;
    }
    try {
      await reg.updateStatus(companyId, agentSlug, status, message);
    } catch (err) {
      logger.warn(
        { err, companyId, agentSlug, status },
        "ai-members: updateStatus failed",
      );
    }
  }

  return {
    registerAllAgents,
    async setAgentBusy(companyId, agentSlug, statusMessage) {
      await updateAgentStatus(companyId, agentSlug, "busy", statusMessage);
    },
    async setAgentIdle(companyId, agentSlug) {
      await updateAgentStatus(companyId, agentSlug, "idle");
    },
    async setAgentNeedsAttention(companyId, agentSlug, reason) {
      await updateAgentStatus(
        companyId,
        agentSlug,
        "needs_attention",
        reason,
      );
    },
    async postAsAgent(companyId, agentSlug, channelSlug, body, postOpts) {
      const poster = state.poster;
      if (!poster) {
        logger.debug(
          { companyId, agentSlug, channelSlug },
          "ai-members: postAsAgent skipped — no poster wired",
        );
        return null;
      }
      if (!getBusinessAgentDefinition(agentSlug)) {
        logger.warn(
          { agentSlug },
          "ai-members: cannot post — unknown agent slug",
        );
        return null;
      }
      try {
        return await poster.postAsAgent(
          companyId,
          agentSlug,
          channelSlug,
          body,
          postOpts,
        );
      } catch (err) {
        logger.warn(
          { err, companyId, agentSlug, channelSlug },
          "ai-members: postAsAgent failed",
        );
        return null;
      }
    },
    getAgentChannelAssignments() {
      return { ...AGENT_CHANNEL_ASSIGNMENTS };
    },
    __setRegistrar(reg) {
      state.registrar = reg;
    },
    __setPoster(p) {
      state.poster = p;
    },
  };
}
