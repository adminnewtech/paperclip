import { api } from "./client";

export type RagDocumentSource = "upload" | "auto_entity" | "url" | "manual";
export type RagDocumentType =
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
  source: RagDocumentSource;
  type: RagDocumentType;
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

export interface RagQueryResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface RagStats {
  documentCount: number;
  chunkCount: number;
  tokenCount: number;
  lastIndexedAt?: string;
  embeddingsProvider: string;
}

export interface RagListResponse {
  documents: RagDocument[];
  nextCursor?: string;
}

export interface RagQueryResponse {
  results: RagQueryResult[];
}

export interface RagAutoIndexResponse {
  indexed: number;
}

export interface CreateRagDocumentInput {
  title: string;
  type: RagDocumentType;
  content: string;
  contentEncoding?: "utf8" | "base64";
  source?: RagDocumentSource;
  url?: string;
  metadata?: Record<string, unknown>;
}

export const businessRagApi = {
  list: (
    companyId: string,
    opts?: { source?: RagDocumentSource; limit?: number; cursor?: string },
  ) => {
    const params = new URLSearchParams();
    if (opts?.source) params.set("source", opts.source);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.cursor) params.set("cursor", opts.cursor);
    const qs = params.toString();
    return api.get<RagListResponse>(
      `/companies/${companyId}/business/rag/documents${qs ? `?${qs}` : ""}`,
    );
  },
  get: (companyId: string, documentId: string) =>
    api.get<RagDocument>(
      `/companies/${companyId}/business/rag/documents/${documentId}`,
    ),
  create: (companyId: string, body: CreateRagDocumentInput) =>
    api.post<RagDocument>(
      `/companies/${companyId}/business/rag/documents`,
      body,
    ),
  uploadFile: (companyId: string, file: File, title?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    return api.postForm<RagDocument>(
      `/companies/${companyId}/business/rag/documents/upload`,
      form,
    );
  },
  delete: (companyId: string, documentId: string) =>
    api.delete<void>(
      `/companies/${companyId}/business/rag/documents/${documentId}`,
    ),
  reindex: (companyId: string, documentId: string) =>
    api.post<RagDocument>(
      `/companies/${companyId}/business/rag/documents/${documentId}/reindex`,
      {},
    ),
  query: (
    companyId: string,
    body: { queryText: string; topK?: number; threshold?: number },
  ) =>
    api.post<RagQueryResponse>(
      `/companies/${companyId}/business/rag/query`,
      body,
    ),
  autoIndex: (companyId: string) =>
    api.post<RagAutoIndexResponse>(
      `/companies/${companyId}/business/rag/auto-index`,
      {},
    ),
  stats: (companyId: string) =>
    api.get<RagStats>(`/companies/${companyId}/business/rag/stats`),
};
