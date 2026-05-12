import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { businessAgentsApi } from "../api/business-agents";
import {
  businessAgentMemoryApi,
  type AgentAction,
  type AgentMemoryBias,
} from "../api/business-agent-memory";
import { AgentLearningStats } from "../components/business/AgentLearningStats";
import { AgentFeedbackPrompt } from "../components/business/AgentFeedbackPrompt";

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function biasIcon(rule: AgentMemoryBias["rule"]) {
  if (rule === "suppress")
    return <ShieldAlert className="h-4 w-4 text-red-600" />;
  if (rule === "boost")
    return <ShieldCheck className="h-4 w-4 text-emerald-600" />;
  return <Sparkles className="h-4 w-4 text-muted-foreground" />;
}

function biasBadgeVariant(
  rule: AgentMemoryBias["rule"],
): "default" | "secondary" | "outline" {
  if (rule === "suppress") return "default";
  if (rule === "boost") return "secondary";
  return "outline";
}

export function BusinessAgentMemoryPage() {
  const { agentSlug } = useParams<{ agentSlug: string }>();
  const slug = agentSlug ?? "";
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [filterCapability, setFilterCapability] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["business", "agents", "detail", selectedCompanyId, slug],
    queryFn: () => businessAgentsApi.get(selectedCompanyId!, slug),
    enabled: !!selectedCompanyId && !!slug,
  });

  const actionsQuery = useQuery({
    queryKey: [
      "business",
      "agent-memory",
      "actions",
      selectedCompanyId,
      slug,
      filterCapability,
    ],
    queryFn: () =>
      businessAgentMemoryApi.listActions(selectedCompanyId!, {
        agentSlug: slug,
        capability: filterCapability ?? undefined,
        limit: 200,
      }),
    enabled: !!selectedCompanyId && !!slug,
  });

  const biasesQuery = useQuery({
    queryKey: ["business", "agent-memory", "biases", selectedCompanyId, slug],
    queryFn: () => businessAgentMemoryApi.getBiases(selectedCompanyId!, slug),
    enabled: !!selectedCompanyId && !!slug,
  });

  const inferMut = useMutation({
    mutationFn: () => businessAgentMemoryApi.inferOutcomes(selectedCompanyId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business", "agent-memory"],
      });
    },
  });

  const definition = detailQuery.data?.definition;

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Agents", href: "/business/agents/hire" },
      {
        label: definition?.personaName ?? slug,
        href: `/business/agents/${slug}`,
      },
      { label: "Memory" },
    ]);
  }, [setBreadcrumbs, definition, slug]);

  const capabilities = useMemo(
    () => definition?.capabilities ?? [],
    [definition],
  );
  const actions: AgentAction[] = actionsQuery.data?.actions ?? [];
  const biases: AgentMemoryBias[] = biasesQuery.data?.biases ?? [];

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading agent memory...
      </div>
    );
  }
  if (!definition) {
    return (
      <div className="container mx-auto max-w-2xl p-6">
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm">Unknown agent.</p>
            <Button
              variant="outline"
              onClick={() => navigate("/business/agents/hire")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/business/agents/${slug}`)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to agent
          </Button>
          <div>
            <h1 className="text-xl font-semibold">
              {definition.personaName}{" "}
              <span className="text-muted-foreground">— Memory</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Performance, feedback history, and learned biases
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => inferMut.mutate()}
          disabled={inferMut.isPending}
        >
          {inferMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Infer outcomes
        </Button>
      </div>

      {inferMut.data && (
        <p className="text-xs text-muted-foreground">
          Inferred {inferMut.data.inferredCount} outcome(s).
        </p>
      )}

      <Tabs defaultValue="performance">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="biases">Biases</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* PERFORMANCE */}
        <TabsContent value="performance" className="space-y-4">
          {selectedCompanyId && (
            <AgentLearningStats
              companyId={selectedCompanyId}
              agentSlug={slug}
            />
          )}
        </TabsContent>

        {/* ACTIONS */}
        <TabsContent value="actions" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={filterCapability === null ? "default" : "outline"}
              onClick={() => setFilterCapability(null)}
            >
              All
            </Button>
            {capabilities.map((cap) => (
              <Button
                key={cap.key}
                size="sm"
                variant={filterCapability === cap.key ? "default" : "outline"}
                onClick={() => setFilterCapability(cap.key)}
              >
                {cap.label}
              </Button>
            ))}
          </div>
          {actionsQuery.isLoading && (
            <div className="flex items-center justify-center p-6 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
            </div>
          )}
          {!actionsQuery.isLoading && actions.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No actions recorded yet. Run the agent to generate suggestions.
              </CardContent>
            </Card>
          )}
          <div className="space-y-2">
            {actions.map((a) => (
              <Card key={a.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="font-mono">
                          {a.capability}
                        </Badge>
                        <span className="text-muted-foreground">
                          {formatDateTime(a.takenAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{a.description}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {a.feedback?.rating ? (
                        <Badge
                          variant={
                            a.feedback.rating === "thumbs_up"
                              ? "secondary"
                              : "default"
                          }
                        >
                          {a.feedback.rating === "thumbs_up" ? "👍" : "👎"}{" "}
                          {a.feedback.rating}
                        </Badge>
                      ) : null}
                      {a.outcome ? (
                        <Badge variant="outline">{a.outcome.resolution}</Badge>
                      ) : null}
                    </div>
                  </div>
                  {!a.feedback?.rating && (
                    <AgentFeedbackPrompt actionId={a.id} compact />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* BIASES */}
        <TabsContent value="biases" className="space-y-3">
          {biasesQuery.isLoading && (
            <div className="flex items-center justify-center p-6 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
            </div>
          )}
          {!biasesQuery.isLoading && biases.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No biases derived yet. Build up feedback history to start
                shaping future runs.
              </CardContent>
            </Card>
          )}
          <div className="space-y-2">
            {biases.map((b) => (
              <Card key={b.capability}>
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="mt-0.5">{biasIcon(b.rule)}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={biasBadgeVariant(b.rule)}>{b.rule}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">
                        {b.capability}
                      </span>
                      {b.strength > 0 && (
                        <span className="text-xs text-muted-foreground">
                          strength {Math.round(b.strength * 100)}%
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm">{b.reason}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Derived from {b.derivedFromActionCount} action(s)
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* SETTINGS */}
        <TabsContent value="settings" className="space-y-3">
          <Card>
            <CardContent className="space-y-3 p-5 text-sm">
              <p className="font-medium">Skill enable / disable</p>
              <p className="text-xs text-muted-foreground">
                Toggle individual skills from the agent's Capabilities tab. A
                suppressed bias here will cause the agent to skip the skill
                automatically; toggling the capability off disables it entirely.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/business/agents/${slug}`)}
              >
                Open capabilities
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-5 text-sm">
              <p className="font-medium">Auto-infer outcomes</p>
              <p className="text-xs text-muted-foreground">
                Periodically checks target entities (invoices, deals, tickets)
                to infer whether the agent's action ultimately succeeded,
                failed, or was ignored. Safe to re-run.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => inferMut.mutate()}
                disabled={inferMut.isPending}
              >
                {inferMut.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Run inference now
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
