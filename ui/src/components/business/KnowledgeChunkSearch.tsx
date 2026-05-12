import { useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  businessRagApi,
  type RagQueryResult,
} from "../../api/business-rag";

interface KnowledgeChunkSearchProps {
  companyId: string;
}

export function KnowledgeChunkSearch({ companyId }: KnowledgeChunkSearchProps) {
  const [queryText, setQueryText] = useState("");
  const [topK, setTopK] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RagQueryResult[] | null>(null);

  async function runSearch() {
    if (!queryText.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await businessRagApi.query(companyId, {
        queryText: queryText.trim(),
        topK,
      });
      setResults(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Query text
          </label>
          <Input
            placeholder="Ask anything about your knowledge base…"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) void runSearch();
            }}
          />
        </div>
        <div className="w-32">
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Top K: {topK}
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <Button onClick={runSearch} disabled={loading || !queryText.trim()}>
          <Search className="size-4 mr-1" />
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {results && results.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No results. Try uploading documents or running auto-index first.
          </CardContent>
        </Card>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, idx) => (
            <Card key={r.chunkId}>
              <CardContent className="py-3 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline">#{idx + 1}</Badge>
                  <Badge variant="secondary">
                    <Sparkles className="size-3 mr-1" />
                    score {r.score.toFixed(3)}
                  </Badge>
                  <span className="text-muted-foreground truncate">
                    {r.documentTitle}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap break-words text-sm font-sans text-foreground">
                  {r.content}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
