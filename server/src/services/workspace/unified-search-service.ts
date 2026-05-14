/**
 * Unified semantic + lexical search across the workspace.
 *
 * Aggregates results from up to four independent sources and merges them
 * into a single ranked feed:
 *
 *   - messages   workspace channel messages
 *   - entities   business entities (CRM contacts, invoices, …)
 *   - audit      business audit log entries
 *   - documents  RAG-indexed documents
 *
 * Each source's scores are normalised to the [0,1] range and then blended
 * with priority weights so that "explicit" sources (documents, entities)
 * rank higher than passive ones (messages, audit) by default.
 *
 * Any source whose backing service is unavailable is silently skipped —
 * the search still works with whatever subset is configured.
 */

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";

import { logger } from "../../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchSource =
  | "messages"
  | "entities"
  | "audit"
  | "documents"
  | "all";

const CONCRETE_SOURCES: SearchSource[] = [
  "messages",
  "entities",
  "audit",
  "documents",
];

const PRIORITY_WEIGHT: Record<SearchSource, number> = {
  documents: 1.0,
  entities: 0.9,
  messages: 0.7,
  audit: 0.55,
  all: 0,
};

export interface UnifiedSearchResult {
  id: string;
  source: SearchSource;
  title: string;
  snippet: string;
  url?: string;
  score: number;
  metadata: Record<string, unknown>;
  timestamp?: string;
}

export interface UnifiedSearchOptions {
  sources?: SearchSource[];
  limit?: number;
  topKPerSource?: number;
}

export interface UnifiedSearchResponse {
  results: UnifiedSearchResult[];
  bySource: Record<SearchSource, UnifiedSearchResult[]>;
}

export interface EntitySearchOptions {
  moduleKey?: string;
  entityType?: string;
  limit?: number;
}

export interface UnifiedSearchService {
  search(
    companyId: string,
    query: string,
    opts?: UnifiedSearchOptions,
  ): Promise<UnifiedSearchResponse>;
  searchEntities(
    companyId: string,
    query: string,
    opts?: EntitySearchOptions,
  ): Promise<UnifiedSearchResult[]>;
}

// ---------------------------------------------------------------------------
// External service adapters
// ---------------------------------------------------------------------------

interface RagQueryHit {
  chunkId?: string;
  documentId?: string;
  documentTitle?: string;
  content?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface RagAdapter {
  query: (companyId: string, q: string) => Promise<RagQueryHit[] | unknown>;
}

interface MessageHit {
  id: string;
  body?: string;
  bodyAr?: string;
  channelId?: string;
  authorDisplayName?: string;
  createdAt?: string;
}

export interface MessagesAdapter {
  search: (
    companyId: string,
    q: string,
    opts?: { limit?: number },
  ) => Promise<MessageHit[] | unknown>;
}

export interface CreateUnifiedSearchOpts {
  ragService?: RagAdapter;
  messagesService?: MessagesAdapter;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildSnippet(body: string, max = 240): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function normaliseScores(rs: UnifiedSearchResult[]): UnifiedSearchResult[] {
  if (rs.length === 0) return rs;
  const max = rs.reduce((acc, r) => (r.score > acc ? r.score : acc), 0);
  if (max <= 0) return rs.map((r) => ({ ...r, score: 0 }));
  return rs.map((r) => ({ ...r, score: r.score / max }));
}

function applyWeight(
  rs: UnifiedSearchResult[],
  source: SearchSource,
): UnifiedSearchResult[] {
  const w = PRIORITY_WEIGHT[source] ?? 0.5;
  return rs.map((r) => ({ ...r, score: r.score * w }));
}

// ---------------------------------------------------------------------------
// Source-specific runners
// ---------------------------------------------------------------------------

async function searchEntitiesImpl(
  db: Db,
  companyId: string,
  q: string,
  opts: { moduleKey?: string; entityType?: string; limit?: number } = {},
): Promise<UnifiedSearchResult[]> {
  if (!q.trim()) return [];
  const limit = Math.min(opts.limit ?? 25, 100);
  const pattern = `%${escapeLikePattern(q.trim())}%`;
  const conditions = [eq(businessEntities.companyId, companyId)];
  if (opts.moduleKey) {
    conditions.push(eq(businessEntities.moduleKey, opts.moduleKey));
  }
  if (opts.entityType) {
    conditions.push(eq(businessEntities.entityType, opts.entityType));
  }
  const matchClause = or(
    ilike(businessEntities.name, pattern),
    ilike(businessEntities.code, pattern),
    sql`${businessEntities.data}::text ILIKE ${pattern}`,
  );
  if (matchClause) conditions.push(matchClause);

  const rows = await db
    .select({
      id: businessEntities.id,
      moduleKey: businessEntities.moduleKey,
      entityType: businessEntities.entityType,
      name: businessEntities.name,
      code: businessEntities.code,
      status: businessEntities.status,
      data: businessEntities.data,
      updatedAt: businessEntities.updatedAt,
    })
    .from(businessEntities)
    .where(and(...conditions))
    .orderBy(desc(businessEntities.updatedAt))
    .limit(limit);

  return rows.map((row, idx) => ({
    id: row.id,
    source: "entities" as const,
    title: row.name ?? row.code ?? row.id,
    snippet: buildEntitySnippet(row),
    url: `/business/entities/${row.id}`,
    // Earlier rows are more recent → slightly higher base score
    score: 1 - idx / Math.max(rows.length, 1) / 2,
    metadata: {
      moduleKey: row.moduleKey,
      entityType: row.entityType,
      code: row.code,
      status: row.status,
    },
    timestamp: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
  }));
}

function buildEntitySnippet(row: {
  name: string | null;
  code: string | null;
  data: unknown;
}): string {
  const data =
    row.data && typeof row.data === "object"
      ? (row.data as Record<string, unknown>)
      : null;
  if (data) {
    for (const key of ["description", "notes", "summary", "subject", "body"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return buildSnippet(value);
      }
    }
  }
  return [row.code, row.name].filter(Boolean).join(" · ") || "(no preview)";
}

async function searchAuditImpl(
  db: Db,
  companyId: string,
  q: string,
  limit: number,
): Promise<UnifiedSearchResult[]> {
  if (!q.trim()) return [];
  const pattern = `%${escapeLikePattern(q.trim())}%`;
  const rows = await db
    .select({
      id: businessEntities.id,
      data: businessEntities.data,
      name: businessEntities.name,
      updatedAt: businessEntities.updatedAt,
    })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "audit"),
        eq(businessEntities.entityType, "log"),
        or(
          ilike(businessEntities.name, pattern),
          sql`${businessEntities.data}::text ILIKE ${pattern}`,
        )!,
      ),
    )
    .orderBy(desc(businessEntities.updatedAt))
    .limit(limit);

  return rows.map((row, idx) => {
    const data =
      row.data && typeof row.data === "object"
        ? (row.data as Record<string, unknown>)
        : {};
    const action = typeof data.action === "string" ? data.action : "event";
    const target = typeof data.targetType === "string" ? data.targetType : "";
    return {
      id: row.id,
      source: "audit" as const,
      title: `${action}${target ? ` · ${target}` : ""}`,
      snippet: buildSnippet(JSON.stringify(data)),
      url: `/business/audit/${row.id}`,
      score: 1 - idx / Math.max(rows.length, 1) / 2,
      metadata: data,
      timestamp: row.updatedAt
        ? new Date(row.updatedAt).toISOString()
        : undefined,
    };
  });
}

async function searchMessagesImpl(
  messages: MessagesAdapter,
  companyId: string,
  q: string,
  limit: number,
): Promise<UnifiedSearchResult[]> {
  let hits: MessageHit[] = [];
  try {
    const raw = await messages.search(companyId, q, { limit });
    if (Array.isArray(raw)) hits = raw as MessageHit[];
  } catch (err) {
    logger.warn({ err }, "[unified-search] messages search failed");
    return [];
  }
  return hits.map((m, idx) => ({
    id: m.id,
    source: "messages" as const,
    title: m.authorDisplayName ?? "Workspace message",
    snippet: buildSnippet(m.body ?? m.bodyAr ?? ""),
    url: m.channelId ? `/workspace/${m.channelId}#${m.id}` : undefined,
    score: 1 - idx / Math.max(hits.length, 1) / 2,
    metadata: { channelId: m.channelId, authorDisplayName: m.authorDisplayName },
    timestamp: m.createdAt,
  }));
}

async function searchDocumentsImpl(
  rag: RagAdapter,
  companyId: string,
  q: string,
  limit: number,
): Promise<UnifiedSearchResult[]> {
  let hits: RagQueryHit[] = [];
  try {
    const raw = await rag.query(companyId, q);
    if (Array.isArray(raw)) hits = raw as RagQueryHit[];
  } catch (err) {
    logger.warn({ err }, "[unified-search] rag query failed");
    return [];
  }
  const top = hits.slice(0, limit);
  return top.map((h) => ({
    id: h.chunkId ?? h.documentId ?? `${Math.random()}`,
    source: "documents" as const,
    title: h.documentTitle ?? "Document",
    snippet: buildSnippet(h.content ?? ""),
    url: h.documentId ? `/business/knowledge/${h.documentId}` : undefined,
    score: typeof h.score === "number" ? h.score : 0.5,
    metadata: h.metadata ?? {},
  }));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUnifiedSearchService(
  db: Db,
  opts: CreateUnifiedSearchOpts = {},
): UnifiedSearchService {
  const rag = opts.ragService;
  const messages = opts.messagesService;

  async function search(
    companyId: string,
    query: string,
    searchOpts: UnifiedSearchOptions = {},
  ): Promise<UnifiedSearchResponse> {
    const q = query.trim();
    const requested =
      searchOpts.sources && searchOpts.sources.length > 0
        ? searchOpts.sources
        : (["all"] as SearchSource[]);
    const sources: SearchSource[] = requested.includes("all")
      ? [...CONCRETE_SOURCES]
      : requested.filter((s) => s !== "all");
    const topK = searchOpts.topKPerSource ?? 10;
    const totalLimit = searchOpts.limit ?? 30;

    const bySource: Record<SearchSource, UnifiedSearchResult[]> = {
      messages: [],
      entities: [],
      audit: [],
      documents: [],
      all: [],
    };

    if (!q) {
      return { results: [], bySource };
    }

    const tasks: Promise<unknown>[] = [];
    if (sources.includes("entities")) {
      tasks.push(
        searchEntitiesImpl(db, companyId, q, { limit: topK }).then((r) => {
          bySource.entities = applyWeight(normaliseScores(r), "entities");
        }),
      );
    }
    if (sources.includes("audit")) {
      tasks.push(
        searchAuditImpl(db, companyId, q, topK).then((r) => {
          bySource.audit = applyWeight(normaliseScores(r), "audit");
        }),
      );
    }
    if (sources.includes("messages") && messages) {
      tasks.push(
        searchMessagesImpl(messages, companyId, q, topK).then((r) => {
          bySource.messages = applyWeight(normaliseScores(r), "messages");
        }),
      );
    }
    if (sources.includes("documents") && rag) {
      tasks.push(
        searchDocumentsImpl(rag, companyId, q, topK).then((r) => {
          bySource.documents = applyWeight(normaliseScores(r), "documents");
        }),
      );
    }
    await Promise.all(tasks);

    const merged = [
      ...bySource.messages,
      ...bySource.entities,
      ...bySource.audit,
      ...bySource.documents,
    ].sort((a, b) => b.score - a.score);

    return {
      results: merged.slice(0, totalLimit),
      bySource,
    };
  }

  async function searchEntities(
    companyId: string,
    query: string,
    entityOpts: EntitySearchOptions = {},
  ): Promise<UnifiedSearchResult[]> {
    return searchEntitiesImpl(db, companyId, query, entityOpts);
  }

  return { search, searchEntities };
}
