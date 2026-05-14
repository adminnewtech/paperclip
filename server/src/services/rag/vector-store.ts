import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type { EmbeddingsService } from "./embeddings-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpsertChunkInput {
  id: string;
  companyId: string;
  documentId: string;
  embedding: number[];
  content: string;
  metadata?: Record<string, unknown>;
  ordinal: number;
  tokenCount?: number;
}

export interface VectorSearchOptions {
  topK?: number;
  threshold?: number;
  filter?: Record<string, unknown>;
}

export interface VectorSearchHit {
  id: string;
  documentId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  upsert(chunks: UpsertChunkInput[]): Promise<void>;
  search(
    companyId: string,
    queryEmbedding: number[],
    opts?: VectorSearchOptions,
  ): Promise<VectorSearchHit[]>;
  delete(documentId: string): Promise<void>;
  count(companyId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// In-memory cosine similarity vector store
// ---------------------------------------------------------------------------
//
// TODO(scale): For >10k chunks per company this becomes too slow. Migrate to
// pgvector with an HNSW or IVFFlat index. The migration should:
//   1. Add a `business_chunks` table with `embedding vector(<dim>)`.
//   2. Replace the in-memory similarity loop with a SQL `<->` order-by query.
//   3. Keep this interface stable so callers don't change.
// For now (Phase 1 of the RAG feature) we load all chunks for the company and
// score in JS — fine for the typical small-business knowledge base (<5k chunks).

interface ChunkDataPayload {
  content: string;
  embedding: number[];
  ordinal: number;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export function createVectorStore(
  db: Db,
  embeddings: EmbeddingsService,
): VectorStore {
  async function upsert(chunks: UpsertChunkInput[]): Promise<void> {
    if (chunks.length === 0) return;
    const now = new Date();
    const rows = chunks.map((c) => ({
      id: c.id,
      companyId: c.companyId,
      moduleKey: "rag",
      entityType: "chunk",
      parentId: c.documentId,
      status: "active",
      data: {
        content: c.content,
        embedding: c.embedding,
        ordinal: c.ordinal,
        tokenCount: c.tokenCount ?? 0,
        metadata: c.metadata ?? {},
      } satisfies ChunkDataPayload,
      tags: [],
      createdAt: now,
      updatedAt: now,
    }));

    // Batch insert (Postgres handles up to ~32k params per statement; we chunk).
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      await db.insert(businessEntities).values(slice);
    }
  }

  function matchesFilter(
    metadata: Record<string, unknown>,
    filter: Record<string, unknown>,
  ): boolean {
    for (const [key, expected] of Object.entries(filter)) {
      if (metadata[key] !== expected) return false;
    }
    return true;
  }

  async function search(
    companyId: string,
    queryEmbedding: number[],
    opts?: VectorSearchOptions,
  ): Promise<VectorSearchHit[]> {
    const topK = opts?.topK ?? 5;
    const threshold = opts?.threshold ?? 0;
    const filter = opts?.filter;

    // Limit to 10k chunks for in-memory scoring; for more, migrate to pgvector.
    const rows = await db
      .select({
        id: businessEntities.id,
        parentId: businessEntities.parentId,
        data: businessEntities.data,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "rag"),
          eq(businessEntities.entityType, "chunk"),
        ),
      )
      .limit(10000);

    const scored: VectorSearchHit[] = [];
    for (const r of rows) {
      const data = (r.data ?? {}) as ChunkDataPayload;
      if (!Array.isArray(data.embedding) || data.embedding.length === 0) continue;
      const meta = data.metadata ?? {};
      if (filter && !matchesFilter(meta, filter)) continue;
      const score = embeddings.cosineSimilarity(queryEmbedding, data.embedding);
      if (score < threshold) continue;
      scored.push({
        id: r.id,
        documentId: r.parentId ?? "",
        content: data.content ?? "",
        score,
        metadata: meta,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async function deleteByDocument(documentId: string): Promise<void> {
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.moduleKey, "rag"),
          eq(businessEntities.entityType, "chunk"),
          eq(businessEntities.parentId, documentId),
        ),
      );
  }

  async function count(companyId: string): Promise<number> {
    const rows = await db
      .select({ id: businessEntities.id })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "rag"),
          eq(businessEntities.entityType, "chunk"),
        ),
      );
    return rows.length;
  }

  return {
    upsert,
    search,
    delete: deleteByDocument,
    count,
  };
}
