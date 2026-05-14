import { api } from "./client";

export type SearchSource =
  | "messages"
  | "entities"
  | "audit"
  | "documents"
  | "all";

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

export interface UnifiedSearchResponse {
  results: UnifiedSearchResult[];
  bySource: Record<SearchSource, UnifiedSearchResult[]>;
}

export const workspaceSearchApi = {
  unified: (
    companyId: string,
    q: string,
    opts?: {
      sources?: SearchSource[];
      limit?: number;
      topK?: number;
    },
  ) => {
    const params = new URLSearchParams();
    params.set("q", q);
    if (opts?.sources && opts.sources.length > 0) {
      params.set("sources", opts.sources.join(","));
    }
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.topK) params.set("topK", String(opts.topK));
    return api.get<UnifiedSearchResponse>(
      `/companies/${companyId}/workspace/search/unified?${params.toString()}`,
    );
  },

  entities: (
    companyId: string,
    q: string,
    opts?: { moduleKey?: string; entityType?: string; limit?: number },
  ) => {
    const params = new URLSearchParams();
    params.set("q", q);
    if (opts?.moduleKey) params.set("moduleKey", opts.moduleKey);
    if (opts?.entityType) params.set("entityType", opts.entityType);
    if (opts?.limit) params.set("limit", String(opts.limit));
    return api.get<{ results: UnifiedSearchResult[] }>(
      `/companies/${companyId}/workspace/search/entities?${params.toString()}`,
    );
  },
};
