/**
 * In-memory pub/sub bus for business module events.
 *
 * Connected SSE clients subscribe per-company. Mutation routes inside the
 * business module call `streamService.emit(...)` after each successful write
 * so the UI can invalidate cached queries and reflect changes in real time.
 *
 * NOTE: The existing business.ts route handlers do NOT emit events yet —
 * this service only provides the infrastructure. Future PRs should call
 * `streamService.emit({ kind: "entity.created", ... })` from every entity
 * mutation in business.ts and business-reports.ts.
 */

import { EventEmitter } from "node:events";

export interface BusinessEntityRow {
  id: string;
  companyId: string;
  moduleKey: string;
  entityType: string;
  parentId: string | null;
  code: string | null;
  name: string | null;
  status: string;
  ownerUserId: string | null;
  amountCents: number | null;
  currency: string | null;
  data: Record<string, unknown>;
  tags: string[];
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type BusinessStreamEvent =
  | {
      kind: "entity.created";
      companyId: string;
      moduleKey: string;
      entityType: string;
      entity: BusinessEntityRow;
    }
  | {
      kind: "entity.updated";
      companyId: string;
      moduleKey: string;
      entityType: string;
      entity: BusinessEntityRow;
    }
  | {
      kind: "entity.deleted";
      companyId: string;
      moduleKey: string;
      entityType: string;
      entityId: string;
    }
  | {
      kind: "summary.changed";
      companyId: string;
    };

export type BusinessStreamListener = (event: BusinessStreamEvent) => void;

export interface BusinessStreamService {
  subscribe(companyId: string, cb: BusinessStreamListener): () => void;
  emit(event: BusinessStreamEvent): void;
  subscriberCount(companyId: string): number;
}

export function createBusinessStreamService(): BusinessStreamService {
  const emitter = new EventEmitter();
  // Each company may have many concurrent SSE clients.
  emitter.setMaxListeners(0);

  return {
    subscribe(companyId: string, cb: BusinessStreamListener) {
      const channel = `company:${companyId}`;
      const listener = (event: BusinessStreamEvent) => {
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
    emit(event: BusinessStreamEvent) {
      const channel = `company:${event.companyId}`;
      emitter.emit(channel, event);
    },
    subscriberCount(companyId: string) {
      return emitter.listenerCount(`company:${companyId}`);
    },
  };
}
