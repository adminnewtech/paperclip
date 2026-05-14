import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import type {
  BusinessStreamEvent,
  BusinessStreamService,
} from "../services/business-stream-service.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

export function businessStreamRoutes(_db: Db, streamService: BusinessStreamService) {
  const router = Router();

  router.get("/companies/:companyId/business/stream", (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    // Open the stream so the client's EventSource resolves immediately.
    res.write(":ok\n\n");

    let closed = false;

    const writeEvent = (event: BusinessStreamEvent) => {
      if (closed || !res.writable) return;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    };

    const unsubscribe = streamService.subscribe(companyId, writeEvent);

    const heartbeat = setInterval(() => {
      if (closed || !res.writable) return;
      try {
        // Comment frames keep proxies (nginx, etc.) from closing the
        // connection and are ignored by EventSource.
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
