import { api } from "./client";

export interface BulkUpdateInput {
  entityIds: string[];
  updates: {
    status?: string;
    tags?: string[];
    addTags?: string[];
    removeTags?: string[];
    ownerUserId?: string;
    customDataMerge?: Record<string, unknown>;
  };
}

export interface BulkDeleteInput {
  entityIds: string[];
}

export interface BulkExportInput {
  entityIds: string[];
}

export interface BulkOperationResult {
  totalCount: number;
  successCount: number;
  failedCount: number;
  errors: Array<{ entityId: string; error: string }>;
}

export const businessBulkApi = {
  update: (
    companyId: string,
    moduleKey: string,
    entityType: string,
    body: BulkUpdateInput,
  ) =>
    api.post<BulkOperationResult>(
      `/companies/${companyId}/business/modules/${moduleKey}/${entityType}/bulk-update`,
      body,
    ),

  delete: (
    companyId: string,
    moduleKey: string,
    entityType: string,
    body: BulkDeleteInput,
  ) =>
    api.post<BulkOperationResult>(
      `/companies/${companyId}/business/modules/${moduleKey}/${entityType}/bulk-delete`,
      body,
    ),

  /**
   * Returns a downloadable CSV blob. Caller is expected to convert it into a
   * downloadable file via a hidden anchor.
   */
  exportCsv: async (
    companyId: string,
    moduleKey: string,
    entityType: string,
    body: BulkExportInput,
  ): Promise<Blob> => {
    const res = await fetch(
      `/api/companies/${companyId}/business/modules/${moduleKey}/${entityType}/bulk-export`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`Bulk export failed: ${res.status}`);
    }
    return res.blob();
  },
};
