/**
 * Unified workspace search routes.
 *
 * Exposes the {@link createUnifiedSearchService} aggregator over HTTP. The
 * route layer composes the RAG service and (optionally) a workspace
 * messages adapter so the search can hit every available source.
 */

import { Router } from "express";

import type { Db } from "@paperclipai/db";

import { assertCompanyAccess } from "./authz.js";
import {
  createUnifiedSearchService,
  type MessagesAdapter,
  type RagAdapter,
  type SearchSource,
  type UnifiedSearchService,
} from "../services/workspace/unified-search-service.js";
import { createRagService } from "../services/rag/index.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WorkspaceSearchRoutesOpts {
  service?: UnifiedSearchService;
  ragService?: RagAdapter;
  messagesService?: MessagesAdapter;
}

const VALID_SOURCES = new Set<SearchSource>([
  "messages",
  "entities",
  "audit",
  "documents",
  "all",
]);

function parseSources(input: unknown): SearchSource[] {
  if (typeof input !== "string" || input.length === 0) return [];
  return input
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is SearchSource =>
      VALID_SOURCES.has(s as SearchSource),
    );
}

function parseLimit(input: unknown, fallback: number, max: number): number {
  if (typeof input === "string" && input.trim().length > 0) {
    const v = Number.parseInt(input, 10);
    if (Number.isFinite(v) && v > 0) return Math.min(v, max);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function workspaceSearchRoutes(
  db: Db,
  opts: WorkspaceSearchRoutesOpts = {},
): Router {
  const router = Router();

  const rag = opts.ragService ?? wrapRagService(db);
  const service =
    opts.service ??
    createUnifiedSearchService(db, {
      ragService: rag,
      messagesService: opts.messagesService,
    });

  router.get(
    "/companies/:companyId/workspace/search/unified",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const sources = parseSources(req.query.sources);
      const limit = parseLimit(req.query.limit, 30, 200);
      const topKPerSource = parseLimit(req.query.topK, 10, 100);
      const result = await service.search(companyId, q, {
        sources: sources.length > 0 ? sources : undefined,
        limit,
        topKPerSource,
      });
      res.json(result);
    },
  );

  router.get(
    "/companies/:companyId/workspace/search/entities",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const moduleKey =
        typeof req.query.moduleKey === "string"
          ? req.query.moduleKey
          : undefined;
      const entityType =
        typeof req.query.entityType === "string"
          ? req.query.entityType
          : undefined;
      const limit = parseLimit(req.query.limit, 25, 100);
      const results = await service.searchEntities(companyId, q, {
        moduleKey,
        entityType,
        limit,
      });
      res.json({ results });
    },
  );

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapRagService(db: Db): RagAdapter {
  const svc = createRagService(db);
  return {
    async query(companyId, q) {
      try {
        const results = await svc.query(companyId, q, { topK: 10 });
        return results.map((r) => ({
          chunkId: r.chunkId,
          documentId: r.documentId,
          documentTitle: r.documentTitle,
          content: r.content,
          score: r.score,
          metadata: r.metadata,
        }));
      } catch {
        return [];
      }
    },
  };
}
