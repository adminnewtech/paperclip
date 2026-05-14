/**
 * Feedback tracker — thin helpers around the memory service for recording
 * feedback and outcomes. Kept as a small, focused module so call sites in the
 * routes / agent runtime don't depend on the full memory service surface.
 *
 * All operations are non-throwing by design (return null on failure) so they
 * can be safely sprinkled into existing code paths without breaking them.
 */

import type { ActionFeedback, ActionOutcome, AgentAction, AgentMemoryService } from "./index.js";

export interface FeedbackTracker {
  record(
    companyId: string,
    action: Omit<AgentAction, "id" | "takenAt">,
  ): Promise<AgentAction | null>;
  thumbsUp(
    companyId: string,
    actionId: string,
    userId?: string,
    comment?: string,
  ): Promise<AgentAction | null>;
  thumbsDown(
    companyId: string,
    actionId: string,
    userId?: string,
    comment?: string,
  ): Promise<AgentAction | null>;
  clearFeedback(companyId: string, actionId: string): Promise<AgentAction | null>;
  markSucceeded(
    companyId: string,
    actionId: string,
    metrics?: Record<string, number>,
    notes?: string,
  ): Promise<AgentAction | null>;
  markFailed(
    companyId: string,
    actionId: string,
    notes?: string,
  ): Promise<AgentAction | null>;
  markIgnored(companyId: string, actionId: string): Promise<AgentAction | null>;
}

export function createFeedbackTracker(memory: AgentMemoryService): FeedbackTracker {
  async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  function buildFeedback(
    rating: "thumbs_up" | "thumbs_down" | null,
    userId?: string,
    comment?: string,
  ): ActionFeedback {
    return {
      rating,
      comment,
      givenBy: userId,
      givenAt: new Date().toISOString(),
    };
  }

  function buildOutcome(
    resolution: ActionOutcome["resolution"],
    metrics?: Record<string, number>,
    notes?: string,
  ): ActionOutcome {
    return {
      resolution,
      measuredAt: new Date().toISOString(),
      metrics,
      notes,
    };
  }

  return {
    record: (companyId, action) =>
      safe(() => memory.recordAction({ ...action, companyId })),
    thumbsUp: (companyId, actionId, userId, comment) =>
      safe(() =>
        memory.giveFeedback(companyId, actionId, buildFeedback("thumbs_up", userId, comment)),
      ),
    thumbsDown: (companyId, actionId, userId, comment) =>
      safe(() =>
        memory.giveFeedback(companyId, actionId, buildFeedback("thumbs_down", userId, comment)),
      ),
    clearFeedback: (companyId, actionId) =>
      safe(() =>
        memory.giveFeedback(companyId, actionId, buildFeedback(null)),
      ),
    markSucceeded: (companyId, actionId, metrics, notes) =>
      safe(() =>
        memory.setOutcome(companyId, actionId, buildOutcome("succeeded", metrics, notes)),
      ),
    markFailed: (companyId, actionId, notes) =>
      safe(() =>
        memory.setOutcome(companyId, actionId, buildOutcome("failed", undefined, notes)),
      ),
    markIgnored: (companyId, actionId) =>
      safe(() =>
        memory.setOutcome(companyId, actionId, buildOutcome("ignored")),
      ),
  };
}
