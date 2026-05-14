import type {
  ImportFieldMapping,
  ImportSource,
  ImportTargetType,
} from "@paperclipai/shared";
import { api } from "./client";

export type {
  ImportFieldMapping,
  ImportSource,
  ImportTargetType,
  ImportTransform,
} from "@paperclipai/shared";

export interface ImportOptions {
  skipFirstRow?: boolean;
  deduplicateBy?: string;
  maxRows?: number;
}

export interface ImportPreviewInput {
  source: ImportSource;
  targetType: ImportTargetType;
  rawData: string;
  fileFormat: "csv" | "excel";
  fieldMapping?: ImportFieldMapping[];
  options?: ImportOptions;
}

export interface PreviewRow {
  rowIndex: number;
  sourceData: Record<string, string>;
  mappedData: Record<string, unknown>;
  issues: string[];
  isDuplicate: boolean;
}

export interface ImportPreviewResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicates: number;
  preview: PreviewRow[];
  suggestedMapping: ImportFieldMapping[];
}

export interface ImportCommitInput extends ImportPreviewInput {
  skipDuplicates: boolean;
  skipInvalid: boolean;
}

export interface ImportCommitResult {
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  errors: Array<{ rowIndex: number; error: string }>;
  createdEntityIds: string[];
}

export interface TemplateListResponse {
  sources: readonly ImportSource[];
  targetTypes: readonly ImportTargetType[];
  templates: Array<{ source: string; targetType: string; mapping: ImportFieldMapping[] }>;
}

export const businessImportApi = {
  preview: (companyId: string, body: ImportPreviewInput) =>
    api.post<ImportPreviewResult>(
      `/companies/${companyId}/business/import/preview`,
      body,
    ),

  commit: (companyId: string, body: ImportCommitInput) =>
    api.post<ImportCommitResult>(
      `/companies/${companyId}/business/import/commit`,
      body,
    ),

  listTemplates: (companyId: string) =>
    api.get<TemplateListResponse>(
      `/companies/${companyId}/business/import/templates`,
    ),

  getTemplate: (
    companyId: string,
    source: ImportSource,
    targetType: ImportTargetType,
  ) =>
    api.get<{ source: ImportSource; targetType: ImportTargetType; mapping: ImportFieldMapping[] }>(
      `/companies/${companyId}/business/import/templates/${source}/${targetType}`,
    ),
};
