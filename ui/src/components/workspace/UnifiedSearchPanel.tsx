import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  MessageSquare,
  Database,
  ShieldCheck,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { useNavigate } from "@/lib/router";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

import {
  workspaceSearchApi,
  type SearchSource,
  type UnifiedSearchResult,
} from "../../api/workspace-search";

const FILTERS: Array<{ key: SearchSource; label: string }> = [
  { key: "all", label: "All" },
  { key: "messages", label: "Messages" },
  { key: "entities", label: "Entities" },
  { key: "documents", label: "Documents" },
  { key: "audit", label: "Audit" },
];

function sourceIcon(source: SearchSource) {
  switch (source) {
    case "messages":
      return MessageSquare;
    case "entities":
      return Database;
    case "documents":
      return FileText;
    case "audit":
      return ShieldCheck;
    default:
      return SearchIcon;
  }
}

interface UnifiedSearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null | undefined;
}

export function UnifiedSearchPanel({
  open,
  onOpenChange,
  companyId,
}: UnifiedSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<SearchSource>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      // Reset on open
      setQuery("");
      setDebouncedQuery("");
      setFilter("all");
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: [
      "workspace-unified-search",
      companyId,
      debouncedQuery,
      filter,
    ],
    queryFn: () =>
      workspaceSearchApi.unified(companyId!, debouncedQuery, {
        sources: filter === "all" ? undefined : [filter],
        limit: 30,
      }),
    enabled: !!companyId && debouncedQuery.length > 0,
  });

  const data = searchQuery.data;

  const grouped = useMemo(() => {
    if (!data) return [] as Array<{ source: SearchSource; items: UnifiedSearchResult[] }>;
    const order: SearchSource[] = ["documents", "entities", "messages", "audit"];
    return order
      .map((source) => ({
        source,
        items: data.bySource[source] ?? [],
      }))
      .filter((g) => g.items.length > 0);
  }, [data]);

  function handleSelect(result: UnifiedSearchResult) {
    onOpenChange(false);
    if (result.url) {
      navigate(result.url);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <SearchIcon className="h-4 w-4" />
            Search workspace
          </DialogTitle>
        </DialogHeader>
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <SearchIcon className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages, entities, documents, audit…"
              className="pl-8 pr-8"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                  filter === f.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {!debouncedQuery ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Type to search across the workspace.
            </div>
          ) : searchQuery.isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Searching…
            </div>
          ) : grouped.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No results.
            </div>
          ) : (
            <div className="divide-y">
              {grouped.map((group) => {
                const Icon = sourceIcon(group.source);
                return (
                  <section key={group.source} className="py-2">
                    <div className="px-4 py-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <Icon className="h-3 w-3" />
                      {group.source}
                      <span className="ml-1">({group.items.length})</span>
                    </div>
                    <ul>
                      {group.items.map((result) => (
                        <li key={`${result.source}-${result.id}`}>
                          <button
                            type="button"
                            onClick={() => handleSelect(result)}
                            className="w-full text-left px-4 py-2 hover:bg-muted/60 focus:bg-muted/60 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">
                                  {result.title}
                                </p>
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {result.snippet}
                                </p>
                              </div>
                              <Badge variant="outline" className="text-[10px]">
                                {Math.round(result.score * 100)}%
                              </Badge>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default UnifiedSearchPanel;
