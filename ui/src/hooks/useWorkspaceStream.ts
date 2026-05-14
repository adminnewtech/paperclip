/**
 * Subscribe to the workspace SSE event stream.
 *
 * Handles reconnect-with-exponential-backoff on transient disconnects:
 * 1s → 2s → 4s → 8s (max). EventSource itself also auto-reconnects, but we
 * additionally tear down + recreate on `onerror` to guarantee a fresh handle.
 */
import { useEffect, useRef } from "react";
import type { WorkspaceStreamEvent } from "@paperclipai/shared";

const MAX_BACKOFF_MS = 8000;

export function useWorkspaceStream(
  companyId: string | null | undefined,
  onEvent: (event: WorkspaceStreamEvent) => void,
): void {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    let currentSource: EventSource | null = null;
    let backoff = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const url = `/api/companies/${companyId}/workspace/stream`;
      const source = new EventSource(url, { withCredentials: true });
      currentSource = source;

      source.onopen = () => {
        backoff = 1000;
      };

      source.onmessage = (e: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(e.data) as WorkspaceStreamEvent;
          callbackRef.current(parsed);
        } catch {
          // Ignore malformed payloads.
        }
      };

      source.onerror = () => {
        // Some browsers will auto-retry; we force a fresh handle to make
        // recovery deterministic in dev/test environments.
        try {
          source.close();
        } catch {
          // ignore
        }
        if (cancelled) return;
        retryTimer = setTimeout(() => {
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          connect();
        }, backoff);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (currentSource) {
        try {
          currentSource.close();
        } catch {
          // ignore
        }
      }
    };
  }, [companyId]);
}
