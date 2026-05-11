import type {
  BusinessModuleSpec,
  IndustryPreset,
} from "@paperclipai/shared";
import { api } from "./client";

export interface BusinessModuleRow {
  id: string;
  companyId: string;
  moduleKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
  industryPreset: string | null;
  activatedByUserId: string | null;
  activatedAt: string;
  createdAt: string;
  updatedAt: string;
}

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

export interface BusinessCatalogResponse {
  modules: BusinessModuleSpec[];
  industries: IndustryPreset[];
}

export interface BusinessSummaryResponse {
  counts: Array<{ moduleKey: string; entityType: string; count: number }>;
}

export const businessApi = {
  catalog: () => api.get<BusinessCatalogResponse>("/business/catalog"),

  listModules: (companyId: string) =>
    api.get<{ modules: BusinessModuleRow[] }>(
      `/companies/${companyId}/business/modules`,
    ),

  setup: (
    companyId: string,
    body: { industryPreset: string; additionalModules?: string[] },
  ) =>
    api.post<{ modules: BusinessModuleRow[]; preset: IndustryPreset }>(
      `/companies/${companyId}/business/setup`,
      body,
    ),

  toggleModule: (
    companyId: string,
    moduleKey: string,
    body: { enabled?: boolean; config?: Record<string, unknown> },
  ) =>
    api.put<BusinessModuleRow>(
      `/companies/${companyId}/business/modules/${moduleKey}`,
      body,
    ),

  summary: (companyId: string) =>
    api.get<BusinessSummaryResponse>(`/companies/${companyId}/business/summary`),

  listEntities: (
    companyId: string,
    moduleKey: string,
    entityType: string,
    query?: { q?: string; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (query?.q) params.set("q", query.q);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return api.get<{ entities: BusinessEntityRow[] }>(
      `/companies/${companyId}/business/${moduleKey}/${entityType}${qs ? `?${qs}` : ""}`,
    );
  },

  createEntity: (
    companyId: string,
    moduleKey: string,
    entityType: string,
    body: Partial<BusinessEntityRow> & { entityType: string },
  ) =>
    api.post<BusinessEntityRow>(
      `/companies/${companyId}/business/${moduleKey}/${entityType}`,
      body,
    ),

  updateEntity: (
    companyId: string,
    moduleKey: string,
    entityType: string,
    id: string,
    body: Partial<BusinessEntityRow>,
  ) =>
    api.put<BusinessEntityRow>(
      `/companies/${companyId}/business/${moduleKey}/${entityType}/${id}`,
      body,
    ),

  deleteEntity: (
    companyId: string,
    moduleKey: string,
    entityType: string,
    id: string,
  ) =>
    api.delete<void>(
      `/companies/${companyId}/business/${moduleKey}/${entityType}/${id}`,
    ),
};
