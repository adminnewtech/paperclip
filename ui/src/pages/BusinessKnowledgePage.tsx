import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Database,
  RefreshCw,
  Trash2,
  Sparkles,
  Settings,
  Search,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { DocumentUploader } from "../components/business/DocumentUploader";
import { KnowledgeChunkSearch } from "../components/business/KnowledgeChunkSearch";
import {
  businessRagApi,
  type RagDocument,
} from "../api/business-rag";

const SOURCE_LABEL: Record<RagDocument["source"], string> = {
  upload: "Upload",
  auto_entity: "Auto-indexed",
  url: "URL",
  manual: "Manual",
};

const TYPE_LABEL: Record<RagDocument["type"], string> = {
  pdf: "PDF",
  txt: "TXT",
  md: "Markdown",
  csv: "CSV",
  json: "JSON",
  html: "HTML",
  entity: "Entity",
};

export function BusinessKnowledgePage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Knowledge" },
    ]);
  }, [setBreadcrumbs]);

  const documentsQuery = useQuery({
    queryKey: ["business-rag", "documents", selectedCompanyId],
    queryFn: () => businessRagApi.list(selectedCompanyId!, { limit: 200 }),
    enabled: !!selectedCompanyId,
  });

  const statsQuery = useQuery({
    queryKey: ["business-rag", "stats", selectedCompanyId],
    queryFn: () => businessRagApi.stats(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const [autoIndexLoading, setAutoIndexLoading] = useState(false);
  const [autoIndexResult, setAutoIndexResult] = useState<number | null>(null);
  const [autoIndexError, setAutoIndexError] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  function refreshAll() {
    void queryClient.invalidateQueries({
      queryKey: ["business-rag", "documents", selectedCompanyId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["business-rag", "stats", selectedCompanyId],
    });
  }

  async function deleteDoc(id: string) {
    if (!selectedCompanyId) return;
    setBusyDocId(id);
    try {
      await businessRagApi.delete(selectedCompanyId, id);
      refreshAll();
    } finally {
      setBusyDocId(null);
    }
  }

  async function reindexDoc(id: string) {
    if (!selectedCompanyId) return;
    setBusyDocId(id);
    try {
      await businessRagApi.reindex(selectedCompanyId, id);
      refreshAll();
    } finally {
      setBusyDocId(null);
    }
  }

  async function runAutoIndex() {
    if (!selectedCompanyId) return;
    setAutoIndexLoading(true);
    setAutoIndexError(null);
    setAutoIndexResult(null);
    try {
      const res = await businessRagApi.autoIndex(selectedCompanyId);
      setAutoIndexResult(res.indexed);
      refreshAll();
    } catch (err) {
      setAutoIndexError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoIndexLoading(false);
    }
  }

  if (!selectedCompanyId) {
    return (
      <div className="p-6">
        <EmptyState
          icon={BookOpen}
          message="Select a company to manage its knowledge base"
        />
      </div>
    );
  }

  const documents = documentsQuery.data?.documents ?? [];
  const stats = statsQuery.data;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="size-6" />
            Knowledge Base
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload SOPs, manuals, FAQs, and product docs. AI agents query these
            chunks to ground their answers in your company's reality.
          </p>
        </div>
        {stats && (
          <div className="flex gap-2 text-xs">
            <Badge variant="outline">
              <Database className="size-3 mr-1" />
              {stats.documentCount} docs
            </Badge>
            <Badge variant="outline">{stats.chunkCount} chunks</Badge>
            <Badge variant="outline">
              {stats.tokenCount.toLocaleString()} tokens
            </Badge>
            <Badge variant="secondary">
              Provider: {stats.embeddingsProvider}
            </Badge>
          </div>
        )}
      </header>

      <Tabs defaultValue="documents" className="w-full">
        <TabsList>
          <TabsTrigger value="documents">
            <FileText className="size-4 mr-1" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="search">
            <Search className="size-4 mr-1" />
            Test Query
          </TabsTrigger>
          <TabsTrigger value="auto-index">
            <Sparkles className="size-4 mr-1" />
            Auto-Index
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="size-4 mr-1" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentUploader
                companyId={selectedCompanyId}
                onUploaded={refreshAll}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Indexed Documents ({documents.length})
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                onClick={refreshAll}
                disabled={documentsQuery.isFetching}
              >
                <RefreshCw
                  className={`size-4 ${documentsQuery.isFetching ? "animate-spin" : ""}`}
                />
              </Button>
            </CardHeader>
            <CardContent>
              {documentsQuery.isLoading ? (
                <div className="py-6 flex items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Loading…
                </div>
              ) : documents.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  message="No documents indexed yet. Upload files or run auto-index."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                        <th className="py-2 px-3 font-medium">Title</th>
                        <th className="py-2 px-3 font-medium">Type</th>
                        <th className="py-2 px-3 font-medium">Source</th>
                        <th className="py-2 px-3 font-medium">Chunks</th>
                        <th className="py-2 px-3 font-medium">Status</th>
                        <th className="py-2 px-3 font-medium text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((d) => (
                        <tr
                          key={d.id}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-2 px-3 max-w-[300px]">
                            <div className="truncate font-medium">
                              {d.title}
                            </div>
                            {d.errorMessage && (
                              <div className="text-xs text-destructive truncate">
                                {d.errorMessage}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant="outline">
                              {TYPE_LABEL[d.type]}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {SOURCE_LABEL[d.source]}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {d.chunkCount}
                          </td>
                          <td className="py-2 px-3">
                            {d.status === "indexed" && (
                              <Badge variant="secondary">
                                <CheckCircle2 className="size-3 mr-1" />
                                Indexed
                              </Badge>
                            )}
                            {d.status === "indexing" && (
                              <Badge variant="secondary">
                                <Loader2 className="size-3 mr-1 animate-spin" />
                                Indexing
                              </Badge>
                            )}
                            {d.status === "failed" && (
                              <Badge variant="destructive">
                                <AlertCircle className="size-3 mr-1" />
                                Failed
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right space-x-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyDocId === d.id}
                              onClick={() => reindexDoc(d.id)}
                              title="Reindex"
                            >
                              <RefreshCw className="size-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyDocId === d.id}
                              onClick={() => deleteDoc(d.id)}
                              title="Delete"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Test Query</CardTitle>
            </CardHeader>
            <CardContent>
              <KnowledgeChunkSearch companyId={selectedCompanyId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="auto-index">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auto-Index Business Entities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Walks your products, contacts, resolved tickets, FAQs, and
                policies. Each entity is formatted as a readable document and
                added to the knowledge base. Idempotent: re-running only
                re-indexes entities whose content has changed.
              </p>
              <Button
                onClick={runAutoIndex}
                disabled={autoIndexLoading}
              >
                {autoIndexLoading ? (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="size-4 mr-1" />
                )}
                Run Auto-Index
              </Button>
              {autoIndexResult !== null && (
                <div className="text-sm">
                  <Badge variant="secondary">
                    <CheckCircle2 className="size-3 mr-1" />
                    Indexed {autoIndexResult} entities
                  </Badge>
                </div>
              )}
              {autoIndexError && (
                <div className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" />
                  {autoIndexError}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Embeddings Provider</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">Active:</span>
                <Badge variant="secondary">
                  {stats?.embeddingsProvider ?? "(loading)"}
                </Badge>
              </div>
              <div className="space-y-1 text-muted-foreground">
                <p>
                  The server picks the first available provider in this order:
                </p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li>
                    <code>OPENAI_API_KEY</code> — uses{" "}
                    <code>text-embedding-3-small</code> (1536 dim)
                  </li>
                  <li>
                    <code>VOYAGE_API_KEY</code> — uses <code>voyage-2</code>
                  </li>
                  <li>
                    Fallback: deterministic mock embeddings (768 dim) — fully
                    functional but does not capture true semantics
                  </li>
                </ul>
                <p>
                  Set the env var on the server to upgrade. No restart-time
                  config changes are required beyond that.
                </p>
              </div>
              {stats?.lastIndexedAt && (
                <div className="text-muted-foreground">
                  Last index activity:{" "}
                  {new Date(stats.lastIndexedAt).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
