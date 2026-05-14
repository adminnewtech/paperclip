/**
 * Hermes webhook event handler.
 *
 * Translates raw {@link HermesWebhookEvent}s coming from the Hermes service
 * (or the local mock) into workspace mutations:
 *
 *   - `agent_status`   → update registered agent's cached info.status
 *   - `task_response`  → mark task complete, post output back to callback channel
 *   - `agent_message`  → post a workspace message authored by the Hermes agent
 *   - `agent_action`   → audit-log a recognised action; emit a system event
 *
 * Signature validation is performed in the route layer, before this handler
 * runs, so the handler can trust the payload shape.
 */

import type {
  HermesAgentInfo,
  HermesAgentActionPayload,
  HermesAgentMessagePayload,
  HermesTaskResponse,
  HermesWebhookEvent,
} from "@paperclipai/shared";
import {
  isHermesAgentInfo,
  isHermesAgentActionPayload,
  isHermesAgentMessagePayload,
  isHermesTaskResponse,
} from "@paperclipai/shared";

import { logger } from "../../middleware/logger.js";
import type { HermesRegistry } from "./hermes-registry.js";
import type {
  HermesTaskStore,
  HermesTaskRecord,
} from "./hermes-task-store.js";

// ---------------------------------------------------------------------------
// Minimal adapters — kept loose so the handler isn't tightly coupled to the
// workspace messages service.
// ---------------------------------------------------------------------------

export interface MinimalMessagePoster {
  postSystemEvent(
    companyId: string,
    channelSlug: string,
    body: string,
    opts?: {
      kind?: string;
      bodyAr?: string;
      card?: unknown;
      threadRootId?: string;
    },
  ): Promise<unknown>;
}

export interface HandleWebhookOpts {
  /** Optional company hint when the webhook payload lacks one. */
  companyId?: string;
  messagePoster?: MinimalMessagePoster;
}

export interface HandleWebhookResult {
  accepted: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createHermesWebhookHandler(deps: {
  registry: HermesRegistry;
  taskStore: HermesTaskStore;
}) {
  const { registry, taskStore } = deps;

  async function handle(
    payload: HermesWebhookEvent,
    opts: HandleWebhookOpts = {},
  ): Promise<HandleWebhookResult> {
    if (!payload || typeof payload !== "object") {
      return { accepted: false, reason: "invalid payload" };
    }
    switch (payload.eventType) {
      case "agent_status":
        return handleAgentStatus(payload, opts);
      case "task_response":
        return handleTaskResponse(payload, opts);
      case "agent_message":
        return handleAgentMessage(payload, opts);
      case "agent_action":
        return handleAgentAction(payload, opts);
      default:
        logger.warn(
          { eventType: (payload as { eventType?: unknown }).eventType },
          "[hermes] unknown webhook event type",
        );
        return { accepted: false, reason: "unknown event type" };
    }
  }

  async function handleAgentStatus(
    payload: HermesWebhookEvent,
    opts: HandleWebhookOpts,
  ): Promise<HandleWebhookResult> {
    const data = payload.data;
    if (!isHermesAgentInfo(data)) {
      return { accepted: false, reason: "invalid agent_status payload" };
    }
    const info = data as HermesAgentInfo;
    const companyId = opts.companyId;
    if (!companyId) {
      // We accept but cannot persist; status updates are best-effort
      logger.debug(
        { agentId: info.id, status: info.status },
        "[hermes] agent_status received without companyId; skipping persistence",
      );
      return { accepted: true };
    }
    const registered = await registry.getByHermesId(companyId, info.id);
    if (registered) {
      await registry.updateInfo(companyId, registered.id, info);
    }
    return { accepted: true };
  }

  async function handleTaskResponse(
    payload: HermesWebhookEvent,
    opts: HandleWebhookOpts,
  ): Promise<HandleWebhookResult> {
    const data = payload.data;
    if (!isHermesTaskResponse(data)) {
      return { accepted: false, reason: "invalid task_response payload" };
    }
    const response = data as HermesTaskResponse;
    const task = await taskStore.findByTaskId(response.taskId, opts.companyId);
    if (!task) {
      logger.warn(
        { taskId: response.taskId },
        "[hermes] task_response for unknown task id",
      );
      return { accepted: false, reason: "task not found" };
    }
    await taskStore.applyResponse(task.companyId, task.id, response);

    // Post the output to the callback channel, if one was configured.
    if (
      response.status === "completed" &&
      task.callbackChannel &&
      opts.messagePoster &&
      response.output
    ) {
      try {
        await opts.messagePoster.postSystemEvent(
          task.companyId,
          task.callbackChannel,
          response.output,
          {
            kind: "hermes_task_result",
            bodyAr: response.outputAr,
            threadRootId: task.callbackThreadRootId,
          },
        );
      } catch (err) {
        logger.warn(
          { err, taskId: task.id },
          "[hermes] failed to post task result to channel",
        );
      }
    }
    return { accepted: true };
  }

  async function handleAgentMessage(
    payload: HermesWebhookEvent,
    opts: HandleWebhookOpts,
  ): Promise<HandleWebhookResult> {
    const data = payload.data;
    if (!isHermesAgentMessagePayload(data)) {
      return { accepted: false, reason: "invalid agent_message payload" };
    }
    const msg = data as HermesAgentMessagePayload;
    if (!opts.messagePoster) {
      return { accepted: true, reason: "no message poster configured" };
    }
    if (!opts.companyId) {
      return { accepted: false, reason: "companyId required for agent_message" };
    }
    try {
      await opts.messagePoster.postSystemEvent(
        opts.companyId,
        msg.channelSlug,
        msg.body,
        {
          kind: "hermes_message",
          bodyAr: msg.bodyAr,
        },
      );
    } catch (err) {
      logger.warn(
        { err, channelSlug: msg.channelSlug },
        "[hermes] failed to post agent_message",
      );
      return { accepted: false, reason: "post failed" };
    }
    return { accepted: true };
  }

  async function handleAgentAction(
    payload: HermesWebhookEvent,
    opts: HandleWebhookOpts,
  ): Promise<HandleWebhookResult> {
    const data = payload.data;
    if (!isHermesAgentActionPayload(data)) {
      return { accepted: false, reason: "invalid agent_action payload" };
    }
    const act = data as HermesAgentActionPayload;
    // For now we just log unknown actions; future plumbing can route known
    // ones into business mutations (e.g. "create_invoice" → invoice service).
    logger.info(
      { agentId: act.agentId, action: act.action },
      "[hermes] agent_action received",
    );
    return { accepted: true };
  }

  return { handle };
}

// Re-export for convenience.
export type { HermesTaskRecord };
