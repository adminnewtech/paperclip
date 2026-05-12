import { and, desc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  createDocumentIngestor,
  type DocumentIngestor,
} from "./document-ingestor.js";
import {
  createEmbeddingsService,
  type EmbeddingsService,
} from "./embeddings-service.js";
import { createVectorStore, type VectorStore } from "./vector-store.js";
import { createAutoIngestService } from "./auto-ingest.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocumentSource = "upload" | "auto_entity" | "url" | "manual";
export type DocumentType =
  | "pdf"
  | "txt"
  | "md"
  | "csv"
  | "json"
  | "html"
  | "entity";

export interface RagDocument {
  id: string;
  companyId: string;
  title: string;
  source: DocumentSource;
  type: DocumentType;
  url?: string;
  contentHash: string;
  status: "indexing" | "indexed" | "failed";
  errorMessage?: string;
  metadata: Record<string, unknown>;
  linkedEntityId?: string;
  linkedEntityType?: string;
  chunkCount: number;
  tokenCount: number;
  createdAt: string;
  indexedAt?: string;
}

export interface RagChunk {
  id: string;
  documentId: string;
  companyId: string;
  ordinal: number;
  content: string;
  contentSummary?: string;
  tokenCount: number;
  embedding?: number[];
  metadata: Record<string, unknown>;
}

export interface QueryResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface IngestDocumentInput {
  title: string;
  type: DocumentType;
  content: string | Buffer;
  source?: DocumentSource;
  url?: string;
  metadata?: Record<string, unknown>;
  linkedEntityId?: string;
  linkedEntityType?: string;
}

export interface ListDocumentsOptions {
  source?: DocumentSource;
  limit?: number;
  cursor?: string;
}

export interface QueryOptions {
  topK?: number;
  threshold?: number;
  filter?: Record<string, unknown>;
}

export interface RagService {
  ingestDocument(
    companyId: string,
    input: IngestDocumentInput,
  ): Promise<RagDocument>;
  listDocuments(
    companyId: string,
    opts?: ListDocumentsOptions,
  ): Promise<{ documents: RagDocument[]; nextCursor?: string }>;
  getDocument(companyId: string, documentId: string): Promise<RagDocument | null>;
  deleteDocument(companyId: string, documentId: string): Promise<void>;
  reindexDocument(companyId: string, documentId: string): Promise<RagDocument>;
  query(
    companyId: string,
    queryText: string,
    opts?: QueryOptions,
  ): Promise<QueryResult[]>;
  queryAsContext(
    companyId: string,
    queryText: string,
    opts?: { topK?: number; maxTokens?: number },
  ): Promise<string>;
  autoIndexBusinessEntities(
    companyId: string,
  ): Promise<{ indexed: number }>;
  getStats(
    companyId: string,
  ): Promise<{
    documentCount: number;
    chunkCount: number;
    tokenCount: number;
    lastIndexedAt?: string;
    embeddingsProvider: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers — businessEntities row <-> RagDocument
// ---------------------------------------------------------------------------

interface DocumentDataPayload {
  source: DocumentSource;
  type: DocumentType;
  url?: string;
  contentHash: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  linkedEntityId?: string;
  linkedEntityType?: string;
  chunkCount?: number;
  tokenCount?: number;
  indexedAt?: string;
  // Note: full document content is NOT persisted here. Chunks are persisted
  // separately under entityType: "chunk". This lets us return list metadata
  // cheaply without leaking full content.
}

function rowToDocument(
  row: typeof businessEntities.$inferSelect,
): RagDocument {
  const data = (row.data ?? {}) as DocumentDataPayload;
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.name ?? "(untitled)",
    source: data.source ?? "manual",
    type: data.type ?? "txt",
    url: data.url,
    contentHash: data.contentHash ?? "",
    status:
      row.status === "indexed" || row.status === "indexing" || row.status === "failed"
        ? (row.status as RagDocument["status"])
        : "indexed",
    errorMessage: data.errorMessage,
    metadata: data.metadata ?? {},
    linkedEntityId: data.linkedEntityId,
    linkedEntityType: data.linkedEntityType,
    chunkCount: data.chunkCount ?? 0,
    tokenCount: data.tokenCount ?? 0,
    createdAt: row.createdAt
      ? new Date(row.createdAt).toISOString()
      : new Date().toISOString(),
    indexedAt: data.indexedAt,
  };
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createRagService(db: Db): RagService {
  const ingestor: DocumentIngestor = createDocumentIngestor();
  const embeddings: EmbeddingsService = createEmbeddingsService();
  const vectorStore: VectorStore = createVectorStore(db, embeddings);

  async function ingestDocument(
    companyId: string,
    input: IngestDocumentInput,
  ): Promise<RagDocument> {
    const contentHash = sha256(
      typeof input.content === "string" ? input.content : input.content,
    );

    // Create document row in "indexing" state.
    const documentId = randomUUID();
    const now = new Date();
    const initialData: DocumentDataPayload = {
      source: input.source ?? "upload",
      type: input.type,
      url: input.url,
      contentHash,
      metadata: input.metadata ?? {},
      linkedEntityId: input.linkedEntityId,
      linkedEntityType: input.linkedEntityType,
      chunkCount: 0,
      tokenCount: 0,
    };

    const [docRow] = await db
      .insert(businessEntities)
      .values({
        id: documentId,
        companyId,
        moduleKey: "rag",
        entityType: "document",
        name: input.title,
        status: "indexing",
        data: initialData,
        tags: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!docRow) {
      throw new Error("Failed to insert document row");
    }

    try {
      const parsed = await ingestor.parse(input.type, input.content);
      const chunkInputs = ingestor.chunk(parsed.text, {
        maxTokens: 512,
        overlap: 50,
      });

      if (chunkInputs.length === 0) {
        throw new Error("Document is empty after parsing");
      }

      // Prepend title for context per chunk.
      const titlePrefix = `[${input.title}] `;
      const texts = chunkInputs.map((c) => titlePrefix + c.content);
      const vectors = await embeddings.embedBatch(texts);

      let totalTokens = 0;
      const chunkRows = chunkInputs.map((c, i) => {
        const tokens = ingestor.estimateTokens(c.content);
        totalTokens += tokens;
        return {
          id: randomUUID(),
          companyId,
          documentId,
          ordinal: i,
          content: c.content,
          embedding: vectors[i] ?? [],
          metadata: {
            ...(c.metadata ?? {}),
            ...(parsed.metadata ?? {}),
            documentTitle: input.title,
            documentType: input.type,
          },
          tokenCount: tokens,
        };
      });

      await vectorStore.upsert(chunkRows);

      const updatedData: DocumentDataPayload = {
        ...initialData,
        metadata: { ...(input.metadata ?? {}), ...parsed.metadata },
        chunkCount: chunkRows.length,
        tokenCount: totalTokens,
        indexedAt: new Date().toISOString(),
      };

      const [updated] = await db
        .update(businessEntities)
        .set({
          status: "indexed",
          data: updatedData,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(businessEntities.id, documentId),
            eq(businessEntities.companyId, companyId),
          ),
        )
        .returning();

      return rowToDocument(updated ?? docRow);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failedData: DocumentDataPayload = {
        ...initialData,
        errorMessage: message,
      };
      const [updated] = await db
        .update(businessEntities)
        .set({
          status: "failed",
          data: failedData,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(businessEntities.id, documentId),
            eq(businessEntities.companyId, companyId),
          ),
        )
        .returning();
      return rowToDocument(updated ?? docRow);
    }
  }

  async function listDocuments(
    companyId: string,
    opts?: ListDocumentsOptions,
  ): Promise<{ documents: RagDocument[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "rag"),
          eq(businessEntities.entityType, "document"),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit + 1);

    let filtered = rows;
    if (opts?.source) {
      filtered = filtered.filter((r) => {
        const data = (r.data ?? {}) as DocumentDataPayload;
        return data.source === opts.source;
      });
    }

    const slice = filtered.slice(0, limit);
    const next = filtered.length > limit ? slice[slice.length - 1]?.id : undefined;
    return {
      documents: slice.map(rowToDocument),
      nextCursor: next ?? undefined,
    };
  }

  async function getDocument(
    companyId: string,
    documentId: string,
  ): Promise<RagDocument | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, documentId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "rag"),
          eq(businessEntities.entityType, "document"),
        ),
      );
    return row ? rowToDocument(row) : null;
  }

  async function deleteDocument(
    companyId: string,
    documentId: string,
  ): Promise<void> {
    // Delete chunks first.
    await vectorStore.delete(documentId);
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.id, documentId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "rag"),
        ),
      );
  }

  async function reindexDocument(
    companyId: string,
    documentId: string,
  ): Promise<RagDocument> {
    const doc = await getDocument(companyId, documentId);
    if (!doc) throw new Error("Document not found");
    // Re-indexing requires source content. For "manual" and "auto_entity"
    // documents we may have stored the raw text in the first chunk metadata,
    // but to keep the implementation simple, we re-read concatenated chunks
    // and re-embed them.
    const chunks = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "rag"),
          eq(businessEntities.entityType, "chunk"),
          eq(businessEntities.parentId, documentId),
        ),
      );

    if (chunks.length === 0) {
      throw new Error("No chunks found to reindex");
    }

    // Build text from chunks ordered by ordinal.
    const ordered = chunks
      .map((c) => ({
        ordinal: ((c.data ?? {}) as { ordinal?: number }).ordinal ?? 0,
        content: ((c.data ?? {}) as { content?: string }).content ?? "",
      }))
      .sort((a, b) => a.ordinal - b.ordinal);

    const text = ordered.map((c) => c.content).join("\n\n");

    // Delete existing chunks, re-ingest as new chunks for this document id.
    await vectorStore.delete(documentId);

    const newChunkInputs = ingestor.chunk(text, { maxTokens: 512, overlap: 50 });
    const titlePrefix = `[${doc.title}] `;
    const texts = newChunkInputs.map((c) => titlePrefix + c.content);
    const vectors = await embeddings.embedBatch(texts);

    let totalTokens = 0;
    const chunkRows = newChunkInputs.map((c, i) => {
      const tokens = ingestor.estimateTokens(c.content);
      totalTokens += tokens;
      return {
        id: randomUUID(),
        companyId,
        documentId,
        ordinal: i,
        content: c.content,
        embedding: vectors[i] ?? [],
        metadata: {
          ...(c.metadata ?? {}),
          documentTitle: doc.title,
          documentType: doc.type,
        },
        tokenCount: tokens,
      };
    });

    await vectorStore.upsert(chunkRows);

    const updatedData: DocumentDataPayload = {
      source: doc.source,
      type: doc.type,
      url: doc.url,
      contentHash: doc.contentHash,
      metadata: doc.metadata,
      linkedEntityId: doc.linkedEntityId,
      linkedEntityType: doc.linkedEntityType,
      chunkCount: chunkRows.length,
      tokenCount: totalTokens,
      indexedAt: new Date().toISOString(),
    };

    const [updated] = await db
      .update(businessEntities)
      .set({
        status: "indexed",
        data: updatedData,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessEntities.id, documentId),
          eq(businessEntities.companyId, companyId),
        ),
      )
      .returning();

    return rowToDocument(updated!);
  }

  async function query(
    companyId: string,
    queryText: string,
    opts?: QueryOptions,
  ): Promise<QueryResult[]> {
    const topK = opts?.topK ?? 5;
    const threshold = opts?.threshold ?? 0;
    const [queryVec] = await embeddings.embedBatch([queryText]);
    if (!queryVec) return [];

    const hits = await vectorStore.search(companyId, queryVec, {
      topK,
      threshold,
      filter: opts?.filter,
    });

    if (hits.length === 0) return [];

    // Resolve document titles.
    const docIds = Array.from(new Set(hits.map((h) => h.documentId)));
    const docRows = await db
      .select({
        id: businessEntities.id,
        name: businessEntities.name,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "rag"),
          eq(businessEntities.entityType, "document"),
          sql`${businessEntities.id} = ANY(${docIds})`,
        ),
      );

    const titleById = new Map(docRows.map((r) => [r.id, r.name ?? "(untitled)"]));

    return hits.map((h) => ({
      chunkId: h.id,
      documentId: h.documentId,
      documentTitle: titleById.get(h.documentId) ?? "(untitled)",
      content: h.content,
      score: h.score,
      metadata: h.metadata,
    }));
  }

  async function queryAsContext(
    companyId: string,
    queryText: string,
    opts?: { topK?: number; maxTokens?: number },
  ): Promise<string> {
    const topK = opts?.topK ?? 5;
    const maxTokens = opts?.maxTokens ?? 2000;
    const results = await query(companyId, queryText, { topK });
    if (results.length === 0) return "";

    const parts: string[] = [];
    let usedTokens = 0;
    for (const r of results) {
      const block = `### Source: ${r.documentTitle} (score: ${r.score.toFixed(3)})\n${r.content}\n`;
      const blockTokens = ingestor.estimateTokens(block);
      if (usedTokens + blockTokens > maxTokens) break;
      parts.push(block);
      usedTokens += blockTokens;
    }

    return parts.join("\n---\n");
  }

  async function autoIndexBusinessEntities(
    companyId: string,
  ): Promise<{ indexed: number }> {
    const auto = createAutoIngestService(db, {
      ingestDocument,
      getDocument,
      deleteDocument,
    });
    const result = await auto.runAll(companyId);
    const total =
      result.products +
      result.contacts +
      result.tickets +
      result.faqs +
      result.policies;
    return { indexed: total };
  }

  async function getStats(companyId: string): Promise<{
    documentCount: number;
    chunkCount: number;
    tokenCount: number;
    lastIndexedAt?: string;
    embeddingsProvider: string;
  }> {
    const docRows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "rag"),
          eq(businessEntities.entityType, "document"),
        ),
      );

    let chunkCount = 0;
    let tokenCount = 0;
    let lastIndexedAt: string | undefined;
    for (const r of docRows) {
      const data = (r.data ?? {}) as DocumentDataPayload;
      chunkCount += data.chunkCount ?? 0;
      tokenCount += data.tokenCount ?? 0;
      if (
        data.indexedAt &&
        (!lastIndexedAt || data.indexedAt > lastIndexedAt)
      ) {
        lastIndexedAt = data.indexedAt;
      }
    }

    return {
      documentCount: docRows.length,
      chunkCount,
      tokenCount,
      lastIndexedAt,
      embeddingsProvider: embeddings.provider(),
    };
  }

  return {
    ingestDocument,
    listDocuments,
    getDocument,
    deleteDocument,
    reindexDocument,
    query,
    queryAsContext,
    autoIndexBusinessEntities,
    getStats,
  };
}
