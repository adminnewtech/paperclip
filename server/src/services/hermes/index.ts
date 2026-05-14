/**
 * Hermes Bridge service — top-level facade.
 *
 * Wires together:
 *
 *   - {@link HermesClient}       HTTP/mock client for the Hermes API
 *   - {@link HermesRegistry}     per-company registered agent storage
 *   - {@link HermesTaskStore}    per-company task persistence
 *   - webhook handler            inbound events from the Hermes side
 *
 * The service is consumed by `routes/hermes.ts` and re-exported as the
 * default bridge implementation. A bound-stream listener can be installed
 * to forward `business-stream-service` events to Hermes for context.
 */

import type { Db } from "@paperclipai/db";
import type { HermesTaskRequest, HermesWebhookEvent } from "@paperclipai/shared";

import { logger } from "../../middleware/logger.js";
import {
  createHermesClient,
  type HermesClient,
} from "./hermes-client.js";
import {
  createHermesRegistry,
  type HermesRegistry,
  type MinimalMemberRegistrar,
} from "./hermes-registry.js";
import {
  createHermesTaskStore,
  type HermesTaskRecord,
  type HermesTaskStore,
  type ListTasksOptions,
} from "./hermes-task-store.js";
import {
  createHermesWebhookHandler,
  type MinimalMessagePoster,
} from "./hermes-webhook-handler.js";

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type {
  HermesClient,
  HermesRegistry,
  HermesTaskRecord,
  HermesTaskStore,
  MinimalMemberRegistrar,
  MinimalMessagePoster,
};

export type HermesTask = HermesTaskRecord;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface DelegateTaskOpts {
  prompt: string;
  promptAr?: string;
  context?: Record<string, unknown>;
  callbackChannel?: string;
  callbackThreadRootId?: string;
}

export interface HandleWebhookOpts {
  companyId?: string;
  messagePoster?: MinimalMessagePoster;
}

export interface HermesBridgeService {
  client: HermesClient;
  registry: HermesRegistry;
  tasks: HermesTaskStore;

  delegateToHermes(
    companyId: string,
    hermesAgentId: string,
    opts: DelegateTaskOpts,
  ): Promise<{ taskId: string }>;

  listTasks(
    companyId: string,
    opts?: ListTasksOptions,
  ): Promise<HermesTaskRecord[]>;

  getTask(
    companyId: string,
    taskId: string,
  ): Promise<HermesTaskRecord | null>;

  handleWebhook(
    payload: HermesWebhookEvent,
    opts?: HandleWebhookOpts,
  ): Promise<{ accepted: boolean; reason?: string }>;

  /**
   * Subscribe to a business stream and forward selected events to Hermes
   * for context. Returns a disposer.
   */
  bindToBusinessStream(streamService: {
    subscribe: (cb: (e: unknown) => void) => () => void;
  }): () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateHermesBridgeOpts {
  client?: HermesClient;
}

export function createHermesBridgeService(
  db: Db,
  opts: CreateHermesBridgeOpts = {},
): HermesBridgeService {
  const client = opts.client ?? createHermesClient();
  const registry = createHermesRegistry(db, { client });
  const tasks = createHermesTaskStore(db);
  const webhook = createHermesWebhookHandler({ registry, taskStore: tasks });

  async function delegateToHermes(
    companyId: string,
    hermesAgentId: string,
    delegateOpts: DelegateTaskOpts,
  ): Promise<{ taskId: string }> {
    const record = await tasks.create(companyId, {
      hermesAgentId,
      prompt: delegateOpts.prompt,
      promptAr: delegateOpts.promptAr,
      callbackChannel: delegateOpts.callbackChannel,
      callbackThreadRootId: delegateOpts.callbackThreadRootId,
      metadata: delegateOpts.context
        ? { context: delegateOpts.context }
        : undefined,
    });

    const req: HermesTaskRequest = {
      taskId: record.id,
      agentId: hermesAgentId,
      prompt: delegateOpts.prompt,
      promptAr: delegateOpts.promptAr,
      context: delegateOpts.context,
      metadata: { companyId, paperclipTaskId: record.id },
    };

    try {
      await client.delegateTask(req);
      await tasks.updateStatus(companyId, record.id, "in_progress");
    } catch (err) {
      logger.warn(
        { err, companyId, hermesAgentId },
        "[hermes] delegateTask failed",
      );
      await tasks.updateStatus(companyId, record.id, "failed");
      throw err;
    }
    return { taskId: record.id };
  }

  async function listTasks(
    companyId: string,
    listOpts: ListTasksOptions = {},
  ): Promise<HermesTaskRecord[]> {
    return tasks.list(companyId, listOpts);
  }

  async function getTask(
    companyId: string,
    taskId: string,
  ): Promise<HermesTaskRecord | null> {
    return tasks.get(companyId, taskId);
  }

  async function handleWebhook(
    payload: HermesWebhookEvent,
    handleOpts: HandleWebhookOpts = {},
  ): Promise<{ accepted: boolean; reason?: string }> {
    return webhook.handle(payload, handleOpts);
  }

  function bindToBusinessStream(streamService: {
    subscribe: (cb: (e: unknown) => void) => () => void;
  }): () => void {
    // For now we simply log forwarded events — when Hermes adds a context
    // ingest endpoint, replace the body of the callback with an HTTP push.
    const dispose = streamService.subscribe((event: unknown) => {
      logger.debug(
        { event },
        "[hermes] business stream event observed (forward stub)",
      );
    });
    return dispose;
  }

  return {
    client,
    registry,
    tasks,
    delegateToHermes,
    listTasks,
    getTask,
    handleWebhook,
    bindToBusinessStream,
  };
}
