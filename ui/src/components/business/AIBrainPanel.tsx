import { useState } from "react";
import { Brain, Mail, Phone, Calendar, ListChecks, RefreshCw, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  businessAiApi,
  type AiNextActionResult,
  type AiCategorizeExpenseResult,
  type AiCustomerSummaryResult,
  type AiClassifyTicketResult,
  type AiSuggestedAction,
} from "../../api/business-ai";

export interface AIBrainPanelProps {
  companyId: string;
  entityId: string;
  entityType: string;
  moduleKey: string;
  onUpdated?: () => void;
}

type AssistKind = "next-action" | "categorize" | "summarize" | "classify" | "none";

function inferKind(moduleKey: string, entityType: string): AssistKind {
  if (moduleKey === "crm" && (entityType === "deal" || entityType === "lead")) {
    return "next-action";
  }
  if (moduleKey === "finance" && entityType === "expense") return "categorize";
  if (moduleKey === "crm" && entityType === "contact") return "summarize";
  if (moduleKey === "helpdesk" && entityType === "ticket") return "classify";
  if (moduleKey === "sales" && entityType === "invoice") return "summarize";
  return "none";
}

function actionIcon(type: AiSuggestedAction["type"]) {
  if (type === "email") return Mail;
  if (type === "call") return Phone;
  if (type === "meeting") return Calendar;
  return ListChecks;
}

type AnyResult =
  | { kind: "next-action"; data: AiNextActionResult }
  | { kind: "categorize"; data: AiCategorizeExpenseResult }
  | { kind: "summarize"; data: AiCustomerSummaryResult }
  | { kind: "classify"; data: AiClassifyTicketResult };

export function AIBrainPanel({
  companyId,
  entityId,
  entityType,
  moduleKey,
  onUpdated,
}: AIBrainPanelProps) {
  const kind = inferKind(moduleKey, entityType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnyResult | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      if (kind === "next-action") {
        const data = await businessAiApi.suggestNextAction(companyId, entityId);
        setResult({ kind, data });
      } else if (kind === "categorize") {
        const data = await businessAiApi.categorizeExpense(companyId, entityId);
        setResult({ kind, data });
        onUpdated?.();
      } else if (kind === "summarize") {
        const data = await businessAiApi.summarizeCustomer(companyId, entityId);
        setResult({ kind, data });
      } else if (kind === "classify") {
        const data = await businessAiApi.classifyTicket(companyId, entityId);
        setResult({ kind, data });
        onUpdated?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch insights");
    } finally {
      setLoading(false);
    }
  }

  if (kind === "none") return null;

  const title =
    kind === "next-action"
      ? "Suggested next action"
      : kind === "categorize"
        ? "Suggested category"
        : kind === "summarize"
          ? "Customer summary"
          : "Ticket triage";

  const isMock = result && "mock" in result.data && result.data.mock === true;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4 text-primary" />
          {title}
          {isMock ? (
            <Badge variant="outline" className="text-xs">
              demo
            </Badge>
          ) : null}
        </CardTitle>
        <Button size="sm" variant="outline" onClick={run} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="ml-1">Refresh insights</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : null}

        {!result && !loading && !error ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Click "Refresh insights" to ask the Business Brain.
          </div>
        ) : null}

        {loading ? (
          <div className="text-sm text-muted-foreground">Thinking...</div>
        ) : null}

        {result?.kind === "next-action" ? (
          <div className="space-y-3">
            <div>
              <div className="font-medium text-sm">{result.data.suggestion}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {result.data.reasoning}
              </div>
            </div>
            <div className="space-y-1">
              {result.data.suggestedActions.map((a, i) => {
                const Icon = actionIcon(a.type);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-sm rounded-md border border-border px-2 py-1.5"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{a.label}</span>
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {a.type}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {result?.kind === "categorize" ? (
          <div className="space-y-2">
            <div className="text-sm">
              Categorized as{" "}
              <Badge variant="secondary">{result.data.category}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Updated entity data with this category.
            </div>
          </div>
        ) : null}

        {result?.kind === "summarize" ? (
          <div className="text-sm whitespace-pre-wrap leading-relaxed">
            {result.data.summary}
          </div>
        ) : null}

        {result?.kind === "classify" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">{result.data.category}</Badge>
              <Badge variant="outline">{result.data.priority}</Badge>
            </div>
            <div className="rounded-md border border-border p-3 text-sm whitespace-pre-wrap">
              {result.data.suggested_response}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
