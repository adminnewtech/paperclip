import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  businessAgentsApi,
  type AgentRunAction,
  type AgentRunResult,
  type AgentRunStatus,
  type BusinessAgentDefinition,
  type HiredAgent,
} from "../api/business-agents";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const statusColor: Record<AgentRunStatus, string> = {
  success: "bg-emerald-100 text-emerald-900 border-emerald-300",
  partial: "bg-yellow-100 text-yellow-900 border-yellow-300",
  failed: "bg-red-100 text-red-900 border-red-300",
};

const severityColor: Record<AgentRunAction["severity"], string> = {
  info: "text-muted-foreground",
  action: "text-emerald-700",
  warning: "text-orange-700",
};

function scheduleLabel(s: string): string {
  switch (s) {
    case "hourly":
      return "Every hour";
    case "daily":
      return "Daily at 9:00am";
    case "weekly":
      return "Weekly, Monday 8am";
    case "monthly":
      return "Monthly on the 1st";
  }
  // Parse a cron: "0 H * * *"
  const m = /^0\s+(\d+)\s+\*\s+\*\s+\*$/.exec(s);
  if (m) return `Daily at ${m[1]?.padStart(2, "0")}:00`;
  return s;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessAgentDetailPage() {
  const { agentSlug } = useParams<{ agentSlug: string }>();
  const slug = agentSlug ?? "";
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [lang, setLang] = useState<"en" | "ar">("en");
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<string | null>(null);

  // Queries
  const detailQuery = useQuery({
    queryKey: ["business", "agents", "detail", selectedCompanyId, slug],
    queryFn: () => businessAgentsApi.get(selectedCompanyId!, slug),
    enabled: !!selectedCompanyId && !!slug,
  });

  const runsQuery = useQuery({
    queryKey: ["business", "agents", "runs", selectedCompanyId, slug],
    queryFn: () => businessAgentsApi.listRuns(selectedCompanyId!, slug, 50),
    enabled: !!selectedCompanyId && !!slug,
  });

  const definition: BusinessAgentDefinition | undefined =
    detailQuery.data?.definition;
  const hired: HiredAgent | null = detailQuery.data?.hired ?? null;

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Agents", href: "/business/agents/hire" },
      { label: definition?.personaName ?? slug },
    ]);
  }, [setBreadcrumbs, definition, slug]);

  useEffect(() => {
    if (hired && scheduleDraft === null) setScheduleDraft(hired.schedule);
  }, [hired, scheduleDraft]);

  // Mutations
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["business", "agents", "detail", selectedCompanyId, slug],
    });
    void queryClient.invalidateQueries({
      queryKey: ["business", "agents", "runs", selectedCompanyId, slug],
    });
    void queryClient.invalidateQueries({
      queryKey: ["business", "agents", "hired", selectedCompanyId],
    });
  };

  const pauseMut = useMutation({
    mutationFn: () => businessAgentsApi.pause(selectedCompanyId!, slug),
    onSuccess: invalidate,
  });
  const resumeMut = useMutation({
    mutationFn: () => businessAgentsApi.resume(selectedCompanyId!, slug),
    onSuccess: invalidate,
  });
  const fireMut = useMutation({
    mutationFn: () => businessAgentsApi.fire(selectedCompanyId!, slug),
    onSuccess: () => {
      invalidate();
      navigate("/business/agents/hire");
    },
  });
  const runMut = useMutation({
    mutationFn: () => businessAgentsApi.runNow(selectedCompanyId!, slug),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: (body: { schedule?: string; capabilities?: string[] }) =>
      businessAgentsApi.update(selectedCompanyId!, slug, body),
    onSuccess: invalidate,
  });

  const isRtl = lang === "ar";
  const enabledCaps = useMemo(() => {
    return new Set(hired?.enabledCapabilities ?? []);
  }, [hired]);

  function toggleCapability(key: string) {
    if (!hired || !definition) return;
    const next = new Set(enabledCaps);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateMut.mutate({ capabilities: Array.from(next) });
  }

  // ---------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------
  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading agent...
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
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to catalog
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hired) {
    return (
      <div className="container mx-auto max-w-2xl p-6">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full text-2xl"
                style={{
                  backgroundColor: `${definition.color}22`,
                  border: `2px solid ${definition.color}55`,
                }}
              >
                {definition.emoji}
              </div>
              <div>
                <p className="text-lg font-semibold">
                  {definition.personaName} — {definition.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  Not yet hired.
                </p>
              </div>
            </div>
            <Button
              onClick={() =>
                businessAgentsApi.hire(selectedCompanyId!, slug).then(() => {
                  invalidate();
                })
              }
              style={{ backgroundColor: definition.color }}
              className="text-white"
            >
              Hire {definition.personaName}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/business/agents/hire")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to catalog
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const runs: AgentRunResult[] = runsQuery.data?.runs ?? [];
  const isActive = hired.status === "active";

  return (
    <div
      className="container mx-auto max-w-6xl space-y-6 p-6"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-3xl shadow-sm"
            style={{
              backgroundColor: `${definition.color}22`,
              border: `2px solid ${definition.color}55`,
            }}
          >
            {definition.emoji}
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              {isRtl ? definition.personaNameAr : definition.personaName}
              <Badge variant={isActive ? "default" : "secondary"}>
                {isActive
                  ? isRtl
                    ? "نشط"
                    : "Active"
                  : isRtl
                    ? "موقوف"
                    : "Paused"}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              {isRtl ? definition.titleAr : definition.title}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {scheduleLabel(hired.schedule)}
              </Badge>
              <span>·</span>
              <span>
                {isRtl ? "تشغيلات" : "Runs"}: {hired.runCount}
              </span>
              <span>·</span>
              <span>
                {isRtl ? "إجراءات" : "Actions"}: {hired.actionsCount}
              </span>
              {hired.lastRunAt && (
                <>
                  <span>·</span>
                  <span>
                    {isRtl ? "آخر تشغيل" : "Last run"}:{" "}
                    {formatDateTime(hired.lastRunAt)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={lang === "en" ? "default" : "ghost"}
            size="sm"
            onClick={() => setLang("en")}
          >
            EN
          </Button>
          <Button
            variant={lang === "ar" ? "default" : "ghost"}
            size="sm"
            onClick={() => setLang("ar")}
          >
            عربي
          </Button>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          style={{ backgroundColor: definition.color }}
          className="text-white hover:opacity-90"
        >
          {runMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {isRtl ? "شغّل الآن" : "Run Now"}
        </Button>
        {isActive ? (
          <Button
            variant="outline"
            onClick={() => pauseMut.mutate()}
            disabled={pauseMut.isPending}
          >
            <Pause className="mr-2 h-4 w-4" />
            {isRtl ? "إيقاف مؤقت" : "Pause"}
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => resumeMut.mutate()}
            disabled={resumeMut.isPending}
          >
            <Play className="mr-2 h-4 w-4" />
            {isRtl ? "استئناف" : "Resume"}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => navigate(`/business/agents/${slug}/memory`)}
        >
          <Brain className="mr-2 h-4 w-4" />
          {isRtl ? "الذاكرة" : "Memory"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (
              window.confirm(
                isRtl
                  ? `هل أنت متأكد من فصل ${definition.personaNameAr}؟`
                  : `Fire ${definition.personaName}? This deletes all run history.`,
              )
            ) {
              fireMut.mutate();
            }
          }}
          disabled={fireMut.isPending}
        >
          <UserMinus className="mr-2 h-4 w-4" />
          {isRtl ? "فصل" : "Fire"}
        </Button>
      </div>

      {runMut.data && (
        <Card
          className={`border ${statusColor[runMut.data.status]} ${
            statusColor[runMut.data.status]
          }`}
        >
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">
                <Sparkles className="mr-1 inline h-4 w-4" />
                {isRtl ? "آخر تشغيل اكتمل" : "Last run completed"} —{" "}
                {runMut.data.status.toUpperCase()}
              </p>
              <span className="text-xs">
                {runMut.data.actions.length}{" "}
                {isRtl ? "إجراء" : "actions"}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            {isRtl ? "نظرة عامة" : "Overview"}
          </TabsTrigger>
          <TabsTrigger value="capabilities">
            {isRtl ? "القدرات" : "Capabilities"}
          </TabsTrigger>
          <TabsTrigger value="activity">
            {isRtl ? "السجل" : "Activity Log"}
          </TabsTrigger>
          <TabsTrigger value="settings">
            {isRtl ? "الإعدادات" : "Settings"}
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {isRtl ? "حول الوكيل" : "About"}
                </p>
                <p className="mt-2 text-sm">
                  {isRtl ? definition.descriptionAr : definition.description}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {isRtl ? "المهام" : "Responsibilities"}
                </p>
                <ul className="mt-2 space-y-2 text-sm">
                  {(isRtl
                    ? definition.responsibilitiesAr
                    : definition.responsibilities
                  ).map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0"
                        style={{ color: definition.color }}
                      />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {isRtl ? "الجدول الزمني" : "Schedule"}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {scheduleLabel(hired.schedule)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {isRtl ? "الوحدات" : "Modules"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {definition.modulesAccessed.map((m) => (
                      <Badge key={m} variant="outline">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {isRtl ? "السعر" : "Monthly cost"}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {(definition.monthlyCostCents / 100).toLocaleString()} SAR
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CAPABILITIES */}
        <TabsContent value="capabilities" className="space-y-3">
          {definition.capabilities.map((cap) => {
            const enabled = enabledCaps.has(cap.key);
            return (
              <Card key={cap.key}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="flex-1">
                    <p className="font-medium">
                      {isRtl ? cap.labelAr : cap.label}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {cap.description}
                    </p>
                    <div className="mt-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{cap.trigger}</Badge>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={enabled}
                    onCheckedChange={() => toggleCapability(cap.key)}
                    aria-label={`Toggle ${cap.label}`}
                  />
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ACTIVITY LOG */}
        <TabsContent value="activity" className="space-y-3">
          {runsQuery.isLoading && (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isRtl ? "تحميل..." : "Loading..."}
            </div>
          )}
          {!runsQuery.isLoading && runs.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                {isRtl
                  ? "لا توجد تشغيلات بعد. شغّل الوكيل الآن."
                  : "No runs yet. Click 'Run Now' to get started."}
              </CardContent>
            </Card>
          )}
          {runs.map((run) => {
            const expanded = openRunId === run.id;
            return (
              <Card key={run.id ?? run.finishedAt}>
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenRunId(expanded ? null : (run.id ?? null))
                    }
                    className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-3">
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <Badge className={statusColor[run.status]}>
                        {run.status}
                      </Badge>
                      <span className="text-sm">
                        {formatDateTime(run.finishedAt)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {run.actions.length}{" "}
                      {isRtl ? "إجراء" : "actions"}
                      {run.errors && run.errors.length > 0 && (
                        <span className="ml-2 text-red-600">
                          · {run.errors.length} errors
                        </span>
                      )}
                    </div>
                  </button>
                  {expanded && (
                    <div className="space-y-2 border-t bg-muted/20 p-4">
                      {run.actions.map((a, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-3 rounded border bg-background p-3"
                        >
                          {a.severity === "warning" ? (
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                          ) : a.severity === "action" ? (
                            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          ) : (
                            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="flex-1">
                            <p className="text-xs font-mono text-muted-foreground">
                              {a.capability}
                            </p>
                            <p className={`text-sm ${severityColor[a.severity]}`}>
                              {isRtl && a.summaryAr ? a.summaryAr : a.summary}
                            </p>
                            {a.entityRefs && a.entityRefs.length > 0 && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {a.entityRefs.length}{" "}
                                {isRtl ? "كائنات مرتبطة" : "related entities"}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                      {run.errors && run.errors.length > 0 && (
                        <div className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900">
                          <p className="mb-1 font-medium">Errors:</p>
                          <ul className="list-inside list-disc space-y-1">
                            {run.errors.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* SETTINGS */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <Label htmlFor="schedule">
                  {isRtl ? "الجدول الزمني (cron أو اختصار)" : "Schedule (cron or shorthand)"}
                </Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    id="schedule"
                    value={scheduleDraft ?? hired.schedule}
                    onChange={(e) => setScheduleDraft(e.target.value)}
                    placeholder="daily / hourly / weekly / 0 9 * * *"
                  />
                  <Button
                    onClick={() =>
                      updateMut.mutate({
                        schedule: (scheduleDraft ?? hired.schedule).trim(),
                      })
                    }
                    disabled={updateMut.isPending}
                  >
                    {updateMut.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    {isRtl ? "حفظ" : "Save"}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isRtl
                    ? "أمثلة: daily, hourly, weekly, 0 9 * * * (يومياً الساعة 9)"
                    : "Examples: daily, hourly, weekly, 0 9 * * * (daily 9am)"}
                </p>
              </div>
              <div className="border-t pt-4">
                <p className="text-sm font-medium">
                  {isRtl ? "منطقة الخطر" : "Danger zone"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isRtl
                    ? "فصل الوكيل سيمحو سجل التشغيلات."
                    : "Firing the agent permanently deletes its run history."}
                </p>
                <Button
                  variant="outline"
                  className="mt-3 border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => {
                    if (
                      window.confirm(
                        isRtl
                          ? `هل أنت متأكد من فصل ${definition.personaNameAr}؟`
                          : `Fire ${definition.personaName}? This deletes all run history.`,
                      )
                    ) {
                      fireMut.mutate();
                    }
                  }}
                  disabled={fireMut.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {isRtl ? "فصل الوكيل" : "Fire agent"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
