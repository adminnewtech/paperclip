import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Play,
  Trash2,
  Pencil,
  MoreVertical,
  Sparkles,
  Mail,
  MessageSquare,
  Clock,
  GitBranch,
  Tag,
  Ticket,
  Square,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { MESSAGE_TEMPLATES } from "@paperclipai/shared";
import {
  marketingAutomationApi,
  type CreateFlowBody,
  type FlowAudience,
  type FlowStep,
  type FlowTrigger,
  type MarketingFlow,
  type MarketingFlowTemplate,
} from "../api/marketing-automation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function triggerLabel(trigger: FlowTrigger): string {
  switch (trigger.kind) {
    case "schedule":
      return `Schedule (${trigger.cron})`;
    case "entity_created":
      return `Created ${trigger.moduleKey}/${trigger.entityType}`;
    case "entity_status_changed":
      return `${trigger.moduleKey}/${trigger.entityType} → ${trigger.toStatus}`;
    case "tag_added":
      return `Tag added: ${trigger.tag}`;
    case "manual":
      return "Manual";
    default:
      return "—";
  }
}

function audienceLabel(audience: FlowAudience): string {
  switch (audience.source) {
    case "all_contacts":
      return "All contacts";
    case "tag":
      return `Tagged: ${audience.tag ?? "—"}`;
    case "segment":
      return `Segment: ${audience.segment ?? "—"}`;
    case "filter":
      return audience.filter
        ? `${audience.filter.field} ${audience.filter.op} ${String(audience.filter.value)}`
        : "Filter";
    default:
      return "—";
  }
}

function stepIcon(step: FlowStep) {
  switch (step.kind) {
    case "send_message":
      return step.channel === "whatsapp" ? (
        <MessageSquare className="h-4 w-4" />
      ) : (
        <Mail className="h-4 w-4" />
      );
    case "wait":
    case "wait_until":
      return <Clock className="h-4 w-4" />;
    case "branch":
      return <GitBranch className="h-4 w-4" />;
    case "tag_contact":
      return <Tag className="h-4 w-4" />;
    case "create_ticket":
      return <Ticket className="h-4 w-4" />;
    case "stop":
      return <Square className="h-4 w-4" />;
    default:
      return <ChevronRight className="h-4 w-4" />;
  }
}

function stepSummary(step: FlowStep): string {
  switch (step.kind) {
    case "send_message":
      return `Send ${step.channel.toUpperCase()} · ${step.templateKey}`;
    case "wait":
      return `Wait ${step.durationHours}h`;
    case "wait_until":
      return `Wait until ${step.hourLocal}:${String(step.minuteLocal ?? 0).padStart(2, "0")}`;
    case "branch":
      return `If ${step.condition.field} ${step.condition.op} ${String(step.condition.value)}`;
    case "tag_contact":
      return `Tag contact: ${step.tag}`;
    case "create_ticket":
      return `Create ticket: ${step.subject}`;
    case "stop":
      return "Stop";
    default:
      return "Unknown";
  }
}

function emptyFlowBody(): CreateFlowBody {
  return {
    name: "New Flow",
    enabled: false,
    trigger: { kind: "manual" },
    audience: { source: "all_contacts" },
    steps: [
      {
        kind: "send_message",
        channel: "whatsapp",
        templateKey: MESSAGE_TEMPLATES[0]?.key ?? "welcome_customer",
        lang: "en",
      },
      { kind: "stop" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessMarketingFlowsPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"flows" | "templates" | "analytics" | "manual">(
    "flows",
  );
  const [editing, setEditing] = useState<MarketingFlow | null>(null);
  const [creating, setCreating] = useState<CreateFlowBody | null>(null);
  const [manualFor, setManualFor] = useState<MarketingFlow | null>(null);
  const [manualContactIds, setManualContactIds] = useState("");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Marketing", href: "/business/marketing" },
      { label: "Flows" },
    ]);
  }, [setBreadcrumbs]);

  const flowsQuery = useQuery({
    queryKey: ["marketing", "flows", selectedCompanyId],
    queryFn: () => marketingAutomationApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });

  const templatesQuery = useQuery({
    queryKey: ["marketing", "flows", "templates"],
    queryFn: () => marketingAutomationApi.templates(),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["marketing", "flows", selectedCompanyId],
    });

  const createMut = useMutation({
    mutationFn: (body: CreateFlowBody) =>
      marketingAutomationApi.create(selectedCompanyId!, body),
    onSuccess: () => {
      void invalidate();
      setCreating(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; body: Partial<CreateFlowBody> }) =>
      marketingAutomationApi.update(selectedCompanyId!, vars.id, vars.body),
    onSuccess: () => {
      void invalidate();
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      marketingAutomationApi.remove(selectedCompanyId!, id),
    onSuccess: () => void invalidate(),
  });

  const toggleMut = useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) =>
      vars.enabled
        ? marketingAutomationApi.enable(selectedCompanyId!, vars.id)
        : marketingAutomationApi.disable(selectedCompanyId!, vars.id),
    onSuccess: () => void invalidate(),
  });

  const fromTemplateMut = useMutation({
    mutationFn: (key: string) =>
      marketingAutomationApi.fromTemplate(selectedCompanyId!, key),
    onSuccess: () => {
      void invalidate();
      setTab("flows");
    },
  });

  const triggerMut = useMutation({
    mutationFn: (vars: { id: string; ids: string[] }) =>
      marketingAutomationApi.trigger(selectedCompanyId!, vars.id, vars.ids),
    onSuccess: () => {
      void invalidate();
      setManualFor(null);
      setManualContactIds("");
    },
  });

  const flows = flowsQuery.data?.flows ?? [];
  const templates = templatesQuery.data?.templates ?? [];

  const globalStats = useMemo(() => {
    const totals = flows.reduce(
      (acc, f) => ({
        enrolledCount: acc.enrolledCount + f.stats.enrolledCount,
        completedCount: acc.completedCount + f.stats.completedCount,
        messagesSentCount: acc.messagesSentCount + f.stats.messagesSentCount,
        deliveredCount: acc.deliveredCount + f.stats.deliveredCount,
        failedCount: acc.failedCount + f.stats.failedCount,
      }),
      {
        enrolledCount: 0,
        completedCount: 0,
        messagesSentCount: 0,
        deliveredCount: 0,
        failedCount: 0,
      },
    );
    const successRate =
      totals.messagesSentCount > 0
        ? (totals.deliveredCount / totals.messagesSentCount) * 100
        : 0;
    const top = [...flows].sort(
      (a, b) => b.stats.enrolledCount - a.stats.enrolledCount,
    )[0];
    return { ...totals, successRate, top };
  }, [flows]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Marketing Flows</h1>
          <p className="text-sm text-muted-foreground">
            Automate WhatsApp and SMS campaigns based on triggers, conditions,
            and schedules.
          </p>
        </div>
        <Button onClick={() => setCreating(emptyFlowBody())}>
          <Plus className="mr-2 h-4 w-4" /> New Flow
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="flows">Active Flows</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="manual">Manual Trigger</TabsTrigger>
        </TabsList>

        {/* Flows */}
        <TabsContent value="flows" className="space-y-4">
          {flowsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : flows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <Sparkles className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <h3 className="text-base font-medium">No flows yet</h3>
                  <p className="text-sm text-muted-foreground">
                    Create a flow from scratch or pick a template.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => setCreating(emptyFlowBody())}>
                    <Plus className="mr-2 h-4 w-4" /> New Flow
                  </Button>
                  <Button variant="outline" onClick={() => setTab("templates")}>
                    Browse Templates
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {flows.map((flow) => (
                <Card key={flow.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">
                        {flow.name}
                      </CardTitle>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge variant="outline">
                          {triggerLabel(flow.trigger)}
                        </Badge>
                        <Badge variant="secondary">
                          {audienceLabel(flow.audience)}
                        </Badge>
                        <Badge variant={flow.enabled ? "default" : "outline"}>
                          {flow.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(flow)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            toggleMut.mutate({
                              id: flow.id,
                              enabled: !flow.enabled,
                            })
                          }
                        >
                          {flow.enabled ? "Disable" : "Enable"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setManualFor(flow)}>
                          <Play className="mr-2 h-4 w-4" /> Run Now
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            if (confirm(`Delete flow "${flow.name}"?`)) {
                              deleteMut.mutate(flow.id);
                            }
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {flow.description ? (
                      <p className="text-sm text-muted-foreground">
                        {flow.description}
                      </p>
                    ) : null}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md border p-2">
                        <div className="text-lg font-semibold">
                          {flow.stats.enrolledCount}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Enrolled
                        </div>
                      </div>
                      <div className="rounded-md border p-2">
                        <div className="text-lg font-semibold">
                          {flow.stats.messagesSentCount}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Sent
                        </div>
                      </div>
                      <div className="rounded-md border p-2">
                        <div className="text-lg font-semibold">
                          {flow.stats.completedCount}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Done
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {flow.steps.length} step
                      {flow.steps.length === 1 ? "" : "s"}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {templates.map((t) => (
              <TemplateCard
                key={t.key}
                template={t}
                onUse={() => fromTemplateMut.mutate(t.key)}
                loading={fromTemplateMut.isPending}
              />
            ))}
          </div>
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Total enrolled" value={globalStats.enrolledCount} />
            <StatCard label="Messages sent" value={globalStats.messagesSentCount} />
            <StatCard
              label="Success rate"
              value={`${globalStats.successRate.toFixed(1)}%`}
            />
            <StatCard label="Completed" value={globalStats.completedCount} />
          </div>
          {globalStats.top ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top performing flow</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-lg font-semibold">
                  {globalStats.top.name}
                </div>
                <div className="text-sm text-muted-foreground">
                  {globalStats.top.stats.enrolledCount} enrollments ·{" "}
                  {globalStats.top.stats.messagesSentCount} messages sent
                </div>
              </CardContent>
            </Card>
          ) : null}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Per-flow breakdown</h3>
            {flows.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div className="font-medium">{f.name}</div>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{f.stats.enrolledCount} enrolled</span>
                  <span>{f.stats.messagesSentCount} sent</span>
                  <span>{f.stats.completedCount} done</span>
                  <span>{f.stats.failedCount} failed</span>
                </div>
              </div>
            ))}
            {flows.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No flows yet — analytics will appear once you create one.
              </div>
            ) : null}
          </div>
        </TabsContent>

        {/* Manual */}
        <TabsContent value="manual" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manually enroll contacts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pick a flow and paste a comma-separated list of contact IDs to
                enroll them immediately.
              </p>
              <div className="space-y-2">
                <Label>Flow</Label>
                <Select
                  value={manualFor?.id ?? ""}
                  onValueChange={(id) => {
                    const found = flows.find((f) => f.id === id) ?? null;
                    setManualFor(found);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a flow" />
                  </SelectTrigger>
                  <SelectContent>
                    {flows.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Contact IDs (comma-separated)</Label>
                <Textarea
                  rows={4}
                  value={manualContactIds}
                  onChange={(e) => setManualContactIds(e.target.value)}
                  placeholder="uuid-1, uuid-2, ..."
                />
              </div>
              <Button
                disabled={!manualFor || !manualContactIds.trim() || triggerMut.isPending}
                onClick={() => {
                  if (!manualFor) return;
                  const ids = manualContactIds
                    .split(/[\s,]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (ids.length === 0) return;
                  triggerMut.mutate({ id: manualFor.id, ids });
                }}
              >
                <Play className="mr-2 h-4 w-4" /> Enroll & Run Now
              </Button>
              {triggerMut.data ? (
                <div className="text-sm text-muted-foreground">
                  Enrolled {triggerMut.data.enrolledCount} contact(s).
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create/Edit dialog */}
      <FlowEditorDialog
        open={creating !== null || editing !== null}
        initial={creating ?? (editing ? toCreateBody(editing) : null)}
        title={editing ? "Edit flow" : "New flow"}
        submitLabel={editing ? "Save" : "Create"}
        onClose={() => {
          setCreating(null);
          setEditing(null);
        }}
        onSubmit={(body) => {
          if (editing) {
            updateMut.mutate({ id: editing.id, body });
          } else {
            createMut.mutate(body);
          }
        }}
      />

      {/* Manual trigger from row */}
      <Dialog
        open={manualFor !== null && tab !== "manual"}
        onOpenChange={(open) => {
          if (!open) setManualFor(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Run "{manualFor?.name}" now</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Contact IDs (comma-separated)</Label>
            <Textarea
              rows={4}
              value={manualContactIds}
              onChange={(e) => setManualContactIds(e.target.value)}
              placeholder="uuid-1, uuid-2, ..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!manualFor) return;
                const ids = manualContactIds
                  .split(/[\s,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (ids.length === 0) return;
                triggerMut.mutate({ id: manualFor.id, ids });
              }}
            >
              Enroll & Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toCreateBody(flow: MarketingFlow): CreateFlowBody {
  return {
    name: flow.name,
    nameAr: flow.nameAr,
    description: flow.description,
    enabled: flow.enabled,
    trigger: flow.trigger,
    audience: flow.audience,
    steps: flow.steps,
  };
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function TemplateCard({
  template,
  onUse,
  loading,
}: {
  template: MarketingFlowTemplate;
  onUse: () => void;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{template.name}</CardTitle>
          <Badge variant="outline">{template.category}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{template.description}</p>
        <div className="text-xs text-muted-foreground">
          {template.defaultFlow.steps.length} step(s) ·{" "}
          {triggerLabel(template.defaultFlow.trigger)}
        </div>
        <Button size="sm" onClick={onUse} disabled={loading}>
          Use this template
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Flow editor dialog
// ---------------------------------------------------------------------------

function FlowEditorDialog({
  open,
  initial,
  title,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: CreateFlowBody | null;
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (body: CreateFlowBody) => void;
}) {
  const [body, setBody] = useState<CreateFlowBody>(
    initial ?? emptyFlowBody(),
  );
  const [editorTab, setEditorTab] = useState<
    "details" | "trigger" | "audience" | "steps"
  >("details");

  useEffect(() => {
    if (initial) setBody(initial);
  }, [initial]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Tabs
          value={editorTab}
          onValueChange={(v) => setEditorTab(v as typeof editorTab)}
        >
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="trigger">Trigger</TabsTrigger>
            <TabsTrigger value="audience">Audience</TabsTrigger>
            <TabsTrigger value="steps">Steps</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={body.name}
                onChange={(e) => setBody({ ...body, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={body.description ?? ""}
                onChange={(e) =>
                  setBody({ ...body, description: e.target.value })
                }
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={body.enabled ?? false}
                onChange={(e) =>
                  setBody({ ...body, enabled: e.target.checked })
                }
                id="enabled"
              />
              <Label htmlFor="enabled">Enabled</Label>
            </div>
          </TabsContent>
          <TabsContent value="trigger" className="space-y-4 pt-4">
            <TriggerEditor
              trigger={body.trigger}
              onChange={(t) => setBody({ ...body, trigger: t })}
            />
          </TabsContent>
          <TabsContent value="audience" className="space-y-4 pt-4">
            <AudienceEditor
              audience={body.audience}
              onChange={(a) => setBody({ ...body, audience: a })}
            />
          </TabsContent>
          <TabsContent value="steps" className="space-y-4 pt-4">
            <StepsEditor
              steps={body.steps}
              onChange={(s) => setBody({ ...body, steps: s })}
            />
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(body)}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TriggerEditor({
  trigger,
  onChange,
}: {
  trigger: FlowTrigger;
  onChange: (t: FlowTrigger) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Trigger kind</Label>
        <Select
          value={trigger.kind}
          onValueChange={(kind) => {
            switch (kind) {
              case "schedule":
                onChange({ kind: "schedule", cron: "0 9 * * *" });
                break;
              case "entity_created":
                onChange({
                  kind: "entity_created",
                  moduleKey: "crm",
                  entityType: "contact",
                });
                break;
              case "entity_status_changed":
                onChange({
                  kind: "entity_status_changed",
                  moduleKey: "sales",
                  entityType: "invoice",
                  toStatus: "sent",
                });
                break;
              case "tag_added":
                onChange({ kind: "tag_added", tag: "" });
                break;
              case "manual":
                onChange({ kind: "manual" });
                break;
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="schedule">Schedule</SelectItem>
            <SelectItem value="entity_created">Entity created</SelectItem>
            <SelectItem value="entity_status_changed">
              Entity status changed
            </SelectItem>
            <SelectItem value="tag_added">Tag added</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {trigger.kind === "schedule" ? (
        <div className="space-y-2">
          <Label>Cron expression</Label>
          <Input
            value={trigger.cron}
            onChange={(e) => onChange({ ...trigger, cron: e.target.value })}
            placeholder="0 9 * * *"
          />
        </div>
      ) : null}
      {trigger.kind === "entity_created" ||
      trigger.kind === "entity_status_changed" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label>Module key</Label>
            <Input
              value={trigger.moduleKey}
              onChange={(e) =>
                onChange({ ...trigger, moduleKey: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Entity type</Label>
            <Input
              value={trigger.entityType}
              onChange={(e) =>
                onChange({ ...trigger, entityType: e.target.value })
              }
            />
          </div>
          {trigger.kind === "entity_status_changed" ? (
            <div className="space-y-2 col-span-2">
              <Label>Target status</Label>
              <Input
                value={trigger.toStatus}
                onChange={(e) =>
                  onChange({ ...trigger, toStatus: e.target.value })
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {trigger.kind === "tag_added" ? (
        <div className="space-y-2">
          <Label>Tag</Label>
          <Input
            value={trigger.tag}
            onChange={(e) => onChange({ ...trigger, tag: e.target.value })}
          />
        </div>
      ) : null}
    </div>
  );
}

function AudienceEditor({
  audience,
  onChange,
}: {
  audience: FlowAudience;
  onChange: (a: FlowAudience) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Source</Label>
        <Select
          value={audience.source}
          onValueChange={(source) =>
            onChange({ source: source as FlowAudience["source"] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all_contacts">All contacts</SelectItem>
            <SelectItem value="tag">By tag</SelectItem>
            <SelectItem value="segment">By segment</SelectItem>
            <SelectItem value="filter">By filter</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {audience.source === "tag" ? (
        <div className="space-y-2">
          <Label>Tag</Label>
          <Input
            value={audience.tag ?? ""}
            onChange={(e) => onChange({ ...audience, tag: e.target.value })}
          />
        </div>
      ) : null}
      {audience.source === "segment" ? (
        <div className="space-y-2">
          <Label>Segment key</Label>
          <Input
            value={audience.segment ?? ""}
            onChange={(e) =>
              onChange({ ...audience, segment: e.target.value })
            }
          />
        </div>
      ) : null}
      {audience.source === "filter" ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-2">
            <Label>Field</Label>
            <Input
              value={audience.filter?.field ?? ""}
              onChange={(e) =>
                onChange({
                  ...audience,
                  filter: {
                    field: e.target.value,
                    op: audience.filter?.op ?? "eq",
                    value: audience.filter?.value ?? "",
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Op</Label>
            <Select
              value={audience.filter?.op ?? "eq"}
              onValueChange={(op) =>
                onChange({
                  ...audience,
                  filter: {
                    field: audience.filter?.field ?? "",
                    op: op as "eq" | "neq" | "gt" | "lt" | "contains",
                    value: audience.filter?.value ?? "",
                  },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eq">eq</SelectItem>
                <SelectItem value="neq">neq</SelectItem>
                <SelectItem value="gt">gt</SelectItem>
                <SelectItem value="lt">lt</SelectItem>
                <SelectItem value="contains">contains</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Value</Label>
            <Input
              value={String(audience.filter?.value ?? "")}
              onChange={(e) =>
                onChange({
                  ...audience,
                  filter: {
                    field: audience.filter?.field ?? "",
                    op: audience.filter?.op ?? "eq",
                    value: e.target.value,
                  },
                })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepsEditor({
  steps,
  onChange,
}: {
  steps: FlowStep[];
  onChange: (s: FlowStep[]) => void;
}) {
  function update(idx: number, step: FlowStep) {
    onChange(steps.map((s, i) => (i === idx ? step : s)));
  }
  function remove(idx: number) {
    onChange(steps.filter((_, i) => i !== idx));
  }
  function append(step: FlowStep) {
    onChange([...steps, step]);
  }

  return (
    <div className="space-y-3">
      {steps.map((step, idx) => (
        <div
          key={idx}
          className="space-y-2 rounded-md border p-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              {stepIcon(step)}
              <span>Step {idx + 1}: {step.kind}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => remove(idx)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <StepConfig
            step={step}
            onChange={(s) => update(idx, s)}
          />
          {idx < steps.length - 1 ? (
            <div className="flex justify-center pt-2 text-muted-foreground">
              <ChevronRight className="h-4 w-4 rotate-90" />
            </div>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            append({
              kind: "send_message",
              channel: "whatsapp",
              templateKey:
                MESSAGE_TEMPLATES[0]?.key ?? "welcome_customer",
              lang: "en",
            })
          }
        >
          + Send message
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => append({ kind: "wait", durationHours: 24 })}
        >
          + Wait
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            append({ kind: "wait_until", hourLocal: 10, minuteLocal: 0 })
          }
        >
          + Wait until
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => append({ kind: "tag_contact", tag: "" })}
        >
          + Tag contact
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            append({
              kind: "create_ticket",
              subject: "",
              priority: "normal",
            })
          }
        >
          + Create ticket
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => append({ kind: "stop" })}
        >
          + Stop
        </Button>
      </div>
    </div>
  );
}

function StepConfig({
  step,
  onChange,
}: {
  step: FlowStep;
  onChange: (s: FlowStep) => void;
}) {
  if (step.kind === "send_message") {
    return (
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Channel</Label>
          <Select
            value={step.channel}
            onValueChange={(c) =>
              onChange({ ...step, channel: c as "whatsapp" | "sms" | "email" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 col-span-2">
          <Label className="text-xs">Template</Label>
          <Select
            value={step.templateKey}
            onValueChange={(k) => onChange({ ...step, templateKey: k })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MESSAGE_TEMPLATES.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Language</Label>
          <Select
            value={step.lang ?? "en"}
            onValueChange={(l) => onChange({ ...step, lang: l as "ar" | "en" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ar">Arabic</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }
  if (step.kind === "wait") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">Duration (hours)</Label>
        <Input
          type="number"
          value={step.durationHours}
          onChange={(e) =>
            onChange({ ...step, durationHours: Number(e.target.value) })
          }
        />
      </div>
    );
  }
  if (step.kind === "wait_until") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Hour</Label>
          <Input
            type="number"
            min={0}
            max={23}
            value={step.hourLocal}
            onChange={(e) =>
              onChange({ ...step, hourLocal: Number(e.target.value) })
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Minute</Label>
          <Input
            type="number"
            min={0}
            max={59}
            value={step.minuteLocal ?? 0}
            onChange={(e) =>
              onChange({ ...step, minuteLocal: Number(e.target.value) })
            }
          />
        </div>
      </div>
    );
  }
  if (step.kind === "tag_contact") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">Tag</Label>
        <Input
          value={step.tag}
          onChange={(e) => onChange({ ...step, tag: e.target.value })}
        />
      </div>
    );
  }
  if (step.kind === "create_ticket") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Subject</Label>
          <Input
            value={step.subject}
            onChange={(e) => onChange({ ...step, subject: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Priority</Label>
          <Input
            value={step.priority ?? "normal"}
            onChange={(e) => onChange({ ...step, priority: e.target.value })}
          />
        </div>
      </div>
    );
  }
  if (step.kind === "branch") {
    return (
      <div className="space-y-2 text-xs text-muted-foreground">
        Branch step: edit nested then/else steps via JSON or via raw API.
        Currently {stepSummary(step)}.
      </div>
    );
  }
  return (
    <div className="text-xs text-muted-foreground">{stepSummary(step)}</div>
  );
}
