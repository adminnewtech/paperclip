import { useRef, useState } from "react";
import { Upload, FileText, X, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { businessRagApi, type RagDocument } from "../../api/business-rag";

interface UploadingFile {
  id: string;
  file: File;
  status: "pending" | "uploading" | "success" | "failed";
  error?: string;
  document?: RagDocument;
}

interface DocumentUploaderProps {
  companyId: string;
  onUploaded?: (doc: RagDocument) => void;
}

const ACCEPTED_EXTENSIONS = ".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm";
const MAX_BYTES = 25 * 1024 * 1024;

export function DocumentUploader({ companyId, onUploaded }: DocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadingFile[]>([]);

  function nextId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function uploadOne(item: UploadingFile) {
    setFiles((prev) =>
      prev.map((f) => (f.id === item.id ? { ...f, status: "uploading" } : f)),
    );
    try {
      const doc = await businessRagApi.uploadFile(companyId, item.file);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id
            ? { ...f, status: "success", document: doc }
            : f,
        ),
      );
      onUploaded?.(doc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id ? { ...f, status: "failed", error: message } : f,
        ),
      );
    }
  }

  function handleNewFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    const accepted: UploadingFile[] = [];
    for (const file of incoming) {
      if (file.size > MAX_BYTES) {
        accepted.push({
          id: nextId(),
          file,
          status: "failed",
          error: `File exceeds 25MB limit`,
        });
        continue;
      }
      accepted.push({ id: nextId(), file, status: "pending" });
    }
    setFiles((prev) => [...accepted, ...prev]);
    for (const item of accepted) {
      if (item.status === "pending") {
        void uploadOne(item);
      }
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length) {
      handleNewFiles(e.dataTransfer.files);
    }
  }

  function clearOne(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        }`}
      >
        <Upload className="mb-2 size-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          Drop files here or click to upload
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, TXT, MD, CSV, JSON, HTML (max 25MB each)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleNewFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 rounded-md border border-border bg-card p-2 text-sm"
            >
              <FileText className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{f.file.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(f.file.size / 1024).toFixed(1)} KB
                </div>
              </div>
              {f.status === "pending" && (
                <Badge variant="secondary">Pending</Badge>
              )}
              {f.status === "uploading" && (
                <Badge variant="secondary">Uploading…</Badge>
              )}
              {f.status === "success" && (
                <Badge variant="secondary">
                  <CheckCircle2 className="size-3 mr-1" />
                  Indexed ({f.document?.chunkCount ?? 0} chunks)
                </Badge>
              )}
              {f.status === "failed" && (
                <Badge variant="destructive" title={f.error}>
                  <AlertCircle className="size-3 mr-1" />
                  Failed
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => clearOne(f.id)}
                title="Remove"
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
