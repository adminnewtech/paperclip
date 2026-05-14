/**
 * In-memory pub/sub bus for workspace events (channels, messages, members,
 * reactions, typing). Mirrors the existing `business-stream-service.ts`
 * pattern.
 *
 * SSE clients subscribe per-company; every mutation route in the workspace
 * module emits an event so connected UIs can update in real time.
 */

import { EventEmitter } from "node:events";
import type { WorkspaceStreamEvent } from "@paperclipai/shared";

export type WorkspaceStreamListener = (event: WorkspaceStreamEvent) => void;

export interface WorkspaceStreamService {
  subscribe(companyId: string, cb: WorkspaceStreamListener): () => void;
  emit(companyId: string, event: WorkspaceStreamEvent): void;
  subscriberCount(companyId: string): number;
}

export function createWorkspaceStreamService(): WorkspaceStreamService {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  return {
    subscribe(companyId, cb) {
      const channel = `workspace:${companyId}`;
      const listener = (event: WorkspaceStreamEvent) => {
        try {
          cb(event);
        } catch {
          // Subscribers must handle their own errors; swallow here so one
          // misbehaving consumer cannot block fan-out to other subscribers.
        }
      };
      emitter.on(channel, listener);
      return () => {
        emitter.off(channel, listener);
      };
    },
    emit(companyId, event) {
      emitter.emit(`workspace:${companyId}`, event);
    },
    subscriberCount(companyId) {
      return emitter.listenerCount(`workspace:${companyId}`);
    },
  };
}
