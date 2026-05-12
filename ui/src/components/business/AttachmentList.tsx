import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Trash2, Upload, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { queryKeys } from "@/lib/queryKeys";
import { api, ApiError } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";

export interface BusinessAttachment {
  id: string;
  companyId: string;
  entityId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedByUserId: string | null;
  createdAt: string;
}

interface AttachmentListProps {
  entityId: string;
  /** Override the active company. Defaults to the value from CompanyContext. */
  companyId?: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(input: string): string {
  try {
    return new Date(input).toLocaleString();
  } catch {
    return input;
  }
}

async function uploadAttachment(
  companyId: string,
  entityId: string,
  file: File,
): Promise<BusinessAttachment> {
  const form = new FormData();
  form.append("file", file);
  return api.postForm<BusinessAttachment>(
    `/companies/${companyId}/business/entities/${entityId}/attachments`,
    form,
  );
}

export function AttachmentList({ entityId, companyId: companyIdProp }: AttachmentListProps) {
  const { selectedCompany } = useCompany();
  const companyId = companyIdProp ?? selectedCompany?.id ?? "";
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const listQuery = useQuery({
    enabled: companyId.length > 0 && entityId.length > 0,
    queryKey: queryKeys.business.attachments(entityId),
    queryFn: () =>
      api.get<{ attachments: BusinessAttachment[] }>(
        `/companies/${companyId}/business/entities/${entityId}/attachments`,
      ),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAttachment(companyId, entityId, file),
    onSuccess: () => {
      setUploadError(null);
      queryClient.invalidateQueries({
        queryKey: queryKeys.business.attachments(entityId),
      });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed";
      setUploadError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      api.delete<void>(
        `/companies/${companyId}/business/attachments/${attachmentId}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.business.attachments(entityId),
      });
    },
  });

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      const list = Array.from(files);
      for (const file of list) {
        uploadMutation.mutate(file);
      }
    },
    [uploadMutation],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer?.files ?? null);
    },
    [handleFiles],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const attachments = listQuery.data?.attachments ?? [];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <span>Attachments</span>
            <span className="text-xs text-muted-foreground">
              ({attachments.length})
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending || !companyId}
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span className="ml-2">Upload</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              // Reset so the same file can be picked twice in a row.
              e.target.value = "";
            }}
          />
        </div>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={[
            "rounded-md border border-dashed p-4 text-center text-sm transition-colors",
            isDragging
              ? "border-primary bg-primary/5 text-primary"
              : "border-muted-foreground/30 text-muted-foreground",
          ].join(" ")}
        >
          Drop files here or click <span className="font-medium">Upload</span>
        </div>

        {uploadError ? (
          <div className="text-xs text-red-600 dark:text-red-400">
            {uploadError}
          </div>
        ) : null}

        {listQuery.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading attachments…</div>
        ) : attachments.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No files attached yet.
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {attachments.map((att) => (
              <li
                key={att.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {att.filename}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(att.sizeBytes)} ·{" "}
                    {att.uploadedByUserId ?? "system"} · {formatDate(att.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <a
                    href={`/api/companies/${companyId}/business/attachments/${att.id}/download`}
                    className="inline-flex h-8 items-center justify-center rounded-md px-2 text-muted-foreground hover:bg-muted"
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(att.id)}
                    disabled={deleteMutation.isPending}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default AttachmentList;
