import { api } from "./client";

export interface BusinessSearchResultRow {
  id: string;
  moduleKey: string;
  entityType: string;
  name: string | null;
  code: string | null;
  amountCents: number | null;
  currency: string | null;
  status: string;
  snippet: string | null;
  url: string;
  updatedAt: string | null;
}

export interface BusinessSearchResponse {
  results: BusinessSearchResultRow[];
  total: number;
}

export interface BusinessSearchParams {
  q: string;
  module?: string;
  limit?: number;
}

export const businessSearchApi = {
  search: (companyId: string, params: BusinessSearchParams): Promise<BusinessSearchResponse> => {
    const search = new URLSearchParams();
    search.set("q", params.q);
    if (params.module) search.set("module", params.module);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    const qs = search.toString();
    return api.get<BusinessSearchResponse>(
      `/companies/${companyId}/business/search${qs ? `?${qs}` : ""}`,
    );
  },
};
