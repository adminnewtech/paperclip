import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys";

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
  createdAt: string;
  updatedAt: string;
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

/**
 * Subscribe to the per-company business event stream. The callback receives a
 * decoded {@link BusinessStreamEvent} for every message the server emits.
 *
 * The EventSource is opened with `credentials: "include"` semantics (the
 * browser sends auth cookies by default) and is torn down on unmount or
 * companyId change.
 */
export function useBusinessStream(
  companyId: string | null | undefined,
  onEvent: (event: BusinessStreamEvent) => void,
): void {
  // Stash the latest callback in a ref so changing it across renders does not
  // tear down the underlying EventSource.
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!companyId) return;

    const eventSource = new EventSource(
      `/api/companies/${companyId}/business/stream`,
      { withCredentials: true },
    );

    eventSource.onmessage = (e: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(e.data) as BusinessStreamEvent;
        callbackRef.current(parsed);
      } catch {
        // Ignore malformed payloads — server should never produce them, but
        // we do not want to crash the consumer.
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects on transient errors. Nothing to do here
      // beyond letting the browser retry; we close explicitly on cleanup.
    };

    return () => {
      eventSource.close();
    };
  }, [companyId]);
}

/**
 * Convenience variant: subscribes to the business event stream and
 * automatically invalidates the relevant React Query keys whenever the server
 * reports a change. Drop this into any company-scoped page (for example
 * `BusinessDashboard`) so the UI stays in sync without bespoke wiring.
 */
export function useBusinessStreamInvalidation(
  companyId: string | null | undefined,
): void {
  const queryClient = useQueryClient();

  useBusinessStream(companyId, (event) => {
    if (!companyId) return;

    switch (event.kind) {
      case "entity.created":
      case "entity.updated": {
        queryClient.invalidateQueries({
          queryKey: queryKeys.business.entities(
            event.companyId,
            event.moduleKey,
            event.entityType,
          ),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.business.entity(
            event.companyId,
            event.moduleKey,
            event.entityType,
            event.entity.id,
          ),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.business.summary(event.companyId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.business.financialSummary(event.companyId),
        });
        break;
      }
      case "entity.deleted": {
        queryClient.invalidateQueries({
          queryKey: queryKeys.business.entities(
            event.companyId,
            event.moduleKey,
            event.entityType,
          ),
        });
        queryClient.removeQueries({
          queryKey: queryKeys.business.entity(
            event.companyId,
            event.moduleKey,
            event.entityType,
            event.entityId,
          ),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.business.summary(event.companyId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.business.financialSummary(event.companyId),
        });
        break;
      }
      case "summary.changed": {
        queryClient.invalidateQueries({
          queryKey: queryKeys.business.summary(event.companyId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.business.financialSummary(event.companyId),
        });
        break;
      }
    }
  });
}
