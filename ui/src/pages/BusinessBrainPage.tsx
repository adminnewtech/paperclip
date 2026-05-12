import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Brain,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  History,
  Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { businessApi, type BusinessEntityRow } from "../api/business";
import {
  businessAiApi,
  type AiChurnRiskItem,
  type AiNextActionResult,
} from "../api/business-ai";

interface InsightLogEntry {
  id: string;
  at: string;
  title: string;
  detail: string;
  kind: "ask" | "deal" | "churn";
}

const ACTIVE_DEAL_STATUSES = new Set([
  "prospecting",
  "qualified",
  "proposal",
  "negotiation",
]);

export function BusinessBrainPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Brain" },
    ]);
  }, [setBreadcrumbs]);

  const [question, setQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askMock, setAskMock] = useState(false);

  const [churnLoading, setChurnLoading] = useState(false);
  const [churnError, setChurnError] = useState<string | null>(null);
  const [churnItems, setChurnItems] = useState<AiChurnRiskItem[] | null>(null);
  const [churnMock, setChurnMock] = useState(false);

  const [dealSuggestions, setDealSuggestions] = useState<
    Array<{ deal: BusinessEntityRow; result: AiNextActionResult }>
  >([]);
  const [dealLoading, setDealLoading] = useState(false);
  const [dealError, setDealError] = useState<string | null>(null);

  const [log, setLog] = useState<InsightLogEntry[]>([]);

  function pushLog(entry: Omit<InsightLogEntry, "id" | "at">) {
    setLog((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          at: new Date().toLocaleTimeString(),
          ...entry,
        },
        ...prev,
      ].slice(0, 20),
    );
  }

  const dealsQuery = useQuery({
    queryKey: ["business-brain", "deals", selectedCompanyId],
    queryFn: () =>
      businessApi.listEntities(selectedCompanyId!, "crm", "deal", { limit: 100 }),
    enabled: !!selectedCompanyId,
  });

  const activeDeals = useMemo(() => {
    const rows = dealsQuery.data?.entities ?? [];
    return rows.filter((d) => ACTIVE_DEAL_STATUSES.has(d.status)).slice(0, 5);
  }, [dealsQuery.data]);

  async function runChurn() {
    if (!selectedCompanyId) return;
    setChurnLoading(true);
    setChurnError(null);
    try {
      const result = await businessAiApi.churnRisk(selectedCompanyId);
      setChurnItems(result.items);
      setChurnMock(result.mock === true);
      pushLog({
        kind: "churn",
        title: "Scanned churn risk",
        detail: `${result.items.length} at-risk customer(s) identified`,
      });
    } catch (err) {
      setChurnError(
        err instanceof Error ? err.message : "Failed to compute churn risk",
      );
    } finally {
      setChurnLoading(false);
    }
  }

  async function runDealSuggestions() {
    if (!selectedCompanyId) return;
    setDealLoading(true);
    setDealError(null);
    try {
      const out: Array<{ deal: BusinessEntityRow; result: AiNextActionResult }> =
        [];
      for (const deal of activeDeals) {
        const result = await businessAiApi.suggestNextAction(
          selectedCompanyId,
          deal.id,
        );
        out.push({ deal, result });
      }
      setDealSuggestions(out);
      pushLog({
        kind: "deal",
        title: "Generated next-action suggestions",
        detail: `${out.length} active deal(s)`,
      });
    } catch (err) {
      setDealError(
        err instanceof Error ? err.message : "Failed to load suggestions",
      );
    } finally {
      setDealLoading(false);
    }
  }

  async function ask() {
    if (!selectedCompanyId) return;
    const q = question.trim();
    if (q.length === 0) return;
    setAskLoading(true);
    setAskAnswer(null);
    try {
      // The free-form ask box piggy-backs on the report-narrative endpoint:
      // we wrap the question as a "report" so the LLM (or its mock) returns
      // structured prose. This keeps us within the documented API surface.
      const result = await businessAiApi.generateReportNarrative(
        selectedCompanyId,
        {
          reportType: "pnl",
          reportData: { question: q },
        },
      );
      setAskAnswer(result.narrative);
      setAskMock(result.mock === true);
      pushLog({
        kind: "ask",
        title: "Asked Business Brain",
        detail: q.slice(0, 80),
      });
    } catch (err) {
      setAskAnswer(
        err instanceof Error
          ? `Error: ${err.message}`
          : "Failed to reach Business Brain",
      );
    } finally {
      setAskLoading(false);
    }
  }

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Brain}
        message="Select a workspace to use the Business Brain."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 text-primary p-2">
          <Brain className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Business Brain</h1>
          <p className="text-sm text-muted-foreground">
            AI-powered insights, suggestions, and answers across your business.
          </p>
        </div>
      </div>

      {/* Ask box */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Ask Business Brain
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder='e.g. "Which customers should I focus on this month?" or "Summarize my Q1 finances"'
            rows={3}
          />
          <div className="flex justify-end">
            <Button onClick={ask} disabled={askLoading || question.trim().length === 0}>
              <Send className="h-4 w-4 mr-1" />
              {askLoading ? "Thinking..." : "Ask"}
            </Button>
          </div>
          {askAnswer ? (
            <div className="rounded-md border border-border p-3 text-sm whitespace-pre-wrap leading-relaxed">
              {askMock ? (
                <Badge variant="outline" className="mb-2 text-xs">
                  demo
                </Badge>
              ) : null}
              {askAnswer}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* At-risk customers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              At-risk customers
              {churnMock ? (
                <Badge variant="outline" className="text-xs">demo</Badge>
              ) : null}
            </CardTitle>
            <Button size="sm" variant="outline" onClick={runChurn} disabled={churnLoading}>
              {churnLoading ? "Scanning..." : "Scan now"}
            </Button>
          </CardHeader>
          <CardContent>
            {churnError ? (
              <div className="text-sm text-destructive">{churnError}</div>
            ) : null}
            {!churnItems && !churnLoading && !churnError ? (
              <div className="text-sm text-muted-foreground">
                Run a scan to surface customers showing signs of churn.
              </div>
            ) : null}
            {churnItems && churnItems.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No at-risk customers detected.
              </div>
            ) : null}
            {churnItems && churnItems.length > 0 ? (
              <ul className="space-y-2">
                {churnItems.map((item) => (
                  <li
                    key={item.contactId}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm">
                        {item.contactName ?? "Unnamed contact"}
                      </div>
                      <Badge
                        variant={item.score >= 70 ? "destructive" : "secondary"}
                      >
                        {item.score}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {item.reasoning}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        {/* Suggested actions today */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              Suggested actions today
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={runDealSuggestions}
              disabled={dealLoading || activeDeals.length === 0}
            >
              {dealLoading ? "Working..." : "Generate"}
            </Button>
          </CardHeader>
          <CardContent>
            {dealError ? (
              <div className="text-sm text-destructive">{dealError}</div>
            ) : null}
            {activeDeals.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No active deals in the pipeline yet.
              </div>
            ) : null}
            {activeDeals.length > 0 && dealSuggestions.length === 0 && !dealLoading ? (
              <div className="text-sm text-muted-foreground">
                Click "Generate" to ask the Brain what to do next on your{" "}
                {activeDeals.length} active deal(s).
              </div>
            ) : null}
            {dealSuggestions.length > 0 ? (
              <ul className="space-y-3">
                {dealSuggestions.map(({ deal, result }) => (
                  <li
                    key={deal.id}
                    className="rounded-md border border-border p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm">
                        {deal.name ?? deal.code ?? deal.id}
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {deal.status}
                      </Badge>
                    </div>
                    <div className="text-sm">{result.suggestion}</div>
                    <div className="text-xs text-muted-foreground">
                      {result.reasoning}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Recent AI insights log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Recent AI insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Insights you request will appear here.
            </div>
          ) : (
            <ul className="space-y-2">
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 text-sm border-b border-border last:border-b-0 pb-2 last:pb-0"
                >
                  <Badge variant="outline" className="text-xs mt-0.5">
                    {entry.kind}
                  </Badge>
                  <div className="flex-1">
                    <div className="font-medium">{entry.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.detail}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {entry.at}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
