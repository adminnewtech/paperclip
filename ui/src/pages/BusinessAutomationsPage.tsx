import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  MoreVertical,
  History,
  Pencil,
  Trash2,
  Sparkles,
  AlertCircle,
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
import {
  businessAutomationsApi,
  type AutomationRule,
  type AutomationTemplate,
  type AutomationActionKind,
  type AutomationTriggerKind,
  type CreateRuleBody,
  type AutomationHistoryEntry,
} from "../api/business-automations";

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const ACTION_KINDS: { value: AutomationActionKind; label: string }[] = [
  { value: "create_invoice", label: "Create Invoice" },
  { value: "send_reminder", label: "Send Reminder" },
  { value: "generate_report", label: "Generate Report" },
  { value: "create_ticket", label: "Create Ticket" },
  { value: "tag_entity", label: "Tag Entity" },
  { value: "ai_action", label: "AI Action" },
];

const SCHEDULE_PRESETS: { value: string; label: string }[] = [
  { value: "0 9 * * *", label: "Daily at 9:00am" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 8 * * 1", label: "Mondays at 8:00am" },
  { value: "0 0 1 * *", label: "Monthly on the 1st" },
  { value: "0 23 28-31 * *", label: "Last days of month at 11pm" },
];

function formatSchedule(rule: AutomationRule): string {
  if (rule.trigger.kind === "event") {
    return `Event: ${rule.trigger.event?.type ?? "—"}`;
  }
  const cron = rule.trigger.schedule?.cron ?? "";
  const preset = SCHEDULE_PRESETS.find((p) => p.value === cron);
  if (preset) return preset.label;
  switch (cron.toLowerCase()) {
    case "daily":
      return "Daily at 9:00am";
    case "weekly":
      return "Weekly on Monday";
    case "monthly":
      return "Monthly on the 1st";
    case "hourly":
      return "Every hour";
    default:
      return cron.startsWith("every:") ? `Every ${cron.slice(6)}` : `cron: ${cron}`;
  }
}

function formatAction(rule: AutomationRule): string {
  const found = ACTION_KINDS.find((a) => a.value === rule.action.kind);
  return found?.label ?? rule.action.kind;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function BusinessAutomationsPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [creating, setCreating] = useState<Partial<CreateRuleBody> | null>(null);
  const [historyOpen, setHistoryOpen] = useState<AutomationRule | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Automations" },
    ]);
  }, [setBreadcrumbs]);

  const rulesQuery = useQuery({
    queryKey: ["business", "automations", selectedCompanyId],
    queryFn: () => businessAutomationsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });

  const templatesQuery = useQuery({
    queryKey: ["business", "automations", "templates"],
    queryFn: () => businessAutomationsApi.templates(),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["business", "automations", selectedCompanyId],
    });

  const createMut = useMutation({
    mutationFn: (body: CreateRuleBody) =>
      businessAutomationsApi.create(selectedCompanyId!, body),
    onSuccess: () => {
      void invalidate();
      setCreating(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; body: Parameters<typeof businessAutomationsApi.update>[2] }) =>
      businessAutomationsApi.update(selectedCompanyId!, vars.id, vars.body),
    onSuccess: () => {
      void invalidate();
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      businessAutomationsApi.remove(selectedCompanyId!, id),
    onSuccess: () => void invalidate(),
  });

  const runMut = useMutation({
    mutationFn: (id: string) =>
      businessAutomationsApi.run(selectedCompanyId!, id),
    onSuccess: () => void invalidate(),
  });

  const rules = rulesQuery.data?.rules ?? [];
  const activeRules = useMemo(() => rules.filter((r) => r.enabled), [rules]);
  const inactiveRules = useMemo(() => rules.filter((r) => !r.enabled), [rules]);
  const templates = templatesQuery.data?.templates ?? [];

  function handleUseTemplate(t: AutomationTemplate) {
    setCreating({
      name: t.name,
      enabled: true,
      trigger: t.trigger,
      action: t.action,
    });
  }

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Business Automations</h1>
          <p className="text-sm text-muted-foreground">
            Schedule recurring jobs and trigger reactions to business events.
          </p>
        </div>
        <Button onClick={() => setCreating({ name: "", enabled: true })}>
          <Plus className="mr-2 h-4 w-4" /> New Automation
        </Button>
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList>
          <TabsTrigger value="active">
            Active ({activeRules.length})
          </TabsTrigger>
          <TabsTrigger value="inactive">
            Inactive ({inactiveRules.length})
          </TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-3 pt-4">
          {activeRules.length === 0 ? (
            <EmptyRules onCreate={() => setCreating({ name: "", enabled: true })} />
          ) : (
            activeRules.map((r) => (
              <RuleCard
                key={r.id}
                rule={r}
                onRun={() => runMut.mutate(r.id)}
                onEdit={() => setEditing(r)}
                onDelete={() => deleteMut.mutate(r.id)}
                onToggle={() =>
                  updateMut.mutate({ id: r.id, body: { enabled: !r.enabled } })
                }
                onHistory={() => setHistoryOpen(r)}
                running={runMut.isPending && runMut.variables === r.id}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="inactive" className="space-y-3 pt-4">
          {inactiveRules.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No inactive automations.
            </p>
          ) : (
            inactiveRules.map((r) => (
              <RuleCard
                key={r.id}
                rule={r}
                onRun={() => runMut.mutate(r.id)}
                onEdit={() => setEditing(r)}
                onDelete={() => deleteMut.mutate(r.id)}
                onToggle={() =>
                  updateMut.mutate({ id: r.id, body: { enabled: !r.enabled } })
                }
                onHistory={() => setHistoryOpen(r)}
                running={runMut.isPending && runMut.variables === r.id}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="templates" className="grid gap-3 pt-4 md:grid-cols-2">
          {templates.map((t) => (
            <TemplateCard key={t.key} template={t} onUse={() => handleUseTemplate(t)} />
          ))}
        </TabsContent>
      </Tabs>

      {/* Create / Edit dialog */}
      {(creating || editing) && (
        <RuleEditorDialog
          initial={editing ?? (creating as Partial<CreateRuleBody>)}
          isEdit={!!editing}
          submitting={createMut.isPending || updateMut.isPending}
          onClose={() => {
            setCreating(null);
            setEditing(null);
          }}
          onSubmit={(body) => {
            if (editing) {
              updateMut.mutate({ id: editing.id, body });
            } else {
              createMut.mutate(body as CreateRuleBody);
            }
          }}
        />
      )}

      {/* History dialog */}
      {historyOpen && (
        <HistoryDialog
          rule={historyOpen}
          companyId={selectedCompanyId!}
          onClose={() => setHistoryOpen(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule card
// ---------------------------------------------------------------------------

interface RuleCardProps {
  rule: AutomationRule;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onHistory: () => void;
  running: boolean;
}

function RuleCard({
  rule,
  onRun,
  onEdit,
  onDelete,
  onToggle,
  onHistory,
  running,
}: RuleCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-4">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{rule.name}</h3>
            {!rule.enabled && (
              <Badge variant="secondary" className="text-xs">
                Disabled
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatSchedule(rule)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {formatAction(rule)}
            </span>
            <span>Last: {formatDate(rule.lastRunAt)}</span>
            <span>Next: {formatDate(rule.nextRunAt)}</span>
          </div>
          <div className="flex gap-4 text-xs">
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              {rule.runCount} runs
            </span>
            {rule.errorCount > 0 && (
              <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                <XCircle className="h-3 w-3" />
                {rule.errorCount} errors
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={running}
            onClick={onRun}
          >
            <Play className="mr-1 h-3 w-3" />
            {running ? "Running…" : "Run now"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onHistory}>
                <History className="mr-2 h-4 w-4" /> History
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggle}>
                {rule.enabled ? "Disable" : "Enable"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

function TemplateCard({
  template,
  onUse,
}: {
  template: AutomationTemplate;
  onUse: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{template.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{template.description}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">
            {template.trigger.kind === "schedule"
              ? template.trigger.schedule?.cron
              : template.trigger.event?.type}
          </Badge>
          <Badge variant="outline">{template.action.kind}</Badge>
        </div>
        <Button size="sm" onClick={onUse}>
          Use this template
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyRules({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No active automations yet. Start from a template or create your own.
        </p>
        <Button onClick={onCreate} variant="outline" size="sm">
          <Plus className="mr-2 h-4 w-4" /> New Automation
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Editor dialog
// ---------------------------------------------------------------------------

interface EditorProps {
  initial: Partial<CreateRuleBody> | AutomationRule;
  isEdit: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (body: CreateRuleBody) => void;
}

function RuleEditorDialog({
  initial,
  isEdit,
  submitting,
  onClose,
  onSubmit,
}: EditorProps) {
  const [name, setName] = useState(initial.name ?? "");
  const [enabled, setEnabled] = useState(initial.enabled ?? true);
  const [triggerKind, setTriggerKind] = useState<AutomationTriggerKind>(
    initial.trigger?.kind ?? "schedule",
  );
  const [cron, setCron] = useState(
    initial.trigger?.schedule?.cron ?? "0 9 * * *",
  );
  const [eventType, setEventType] = useState(
    initial.trigger?.event?.type ?? "invoice.overdue.7days",
  );
  const [actionKind, setActionKind] = useState<AutomationActionKind>(
    initial.action?.kind ?? "ai_action",
  );
  const [paramsText, setParamsText] = useState(
    JSON.stringify(initial.action?.params ?? {}, null, 2),
  );
  const [paramsError, setParamsError] = useState<string | null>(null);

  function handleSubmit() {
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(paramsText || "{}");
    } catch (err) {
      setParamsError(err instanceof Error ? err.message : String(err));
      return;
    }
    setParamsError(null);
    const trigger =
      triggerKind === "schedule"
        ? { kind: "schedule" as const, schedule: { cron } }
        : { kind: "event" as const, event: { type: eventType } };
    onSubmit({
      name,
      enabled,
      trigger,
      action: { kind: actionKind, params },
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Automation" : "New Automation"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekly P&L Email"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <Label htmlFor="enabled">Enabled</Label>
          </div>

          <div className="space-y-2 rounded border p-3">
            <Label>Trigger</Label>
            <Select
              value={triggerKind}
              onValueChange={(v) => setTriggerKind(v as AutomationTriggerKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="schedule">Schedule</SelectItem>
                <SelectItem value="event">Event</SelectItem>
              </SelectContent>
            </Select>
            {triggerKind === "schedule" ? (
              <div className="space-y-2">
                <Select value={cron} onValueChange={setCron}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 0 1 * * (cron) or daily/weekly/monthly/every:5m"
                />
              </div>
            ) : (
              <Input
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder="e.g. invoice.overdue.7days"
              />
            )}
          </div>

          <div className="space-y-2 rounded border p-3">
            <Label>Action</Label>
            <Select
              value={actionKind}
              onValueChange={(v) => setActionKind(v as AutomationActionKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_KINDS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label className="text-xs text-muted-foreground">Params (JSON)</Label>
            <Textarea
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
            {paramsError && (
              <p className="text-xs text-red-600">{paramsError}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// History dialog
// ---------------------------------------------------------------------------

function HistoryDialog({
  rule,
  companyId,
  onClose,
}: {
  rule: AutomationRule;
  companyId: string;
  onClose: () => void;
}) {
  const historyQuery = useQuery({
    queryKey: ["business", "automations", "history", companyId, rule.id],
    queryFn: () => businessAutomationsApi.history(companyId, rule.id),
  });

  const history: AutomationHistoryEntry[] = historyQuery.data?.history ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule.name} — Run history</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-auto">
          {historyQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No runs yet.
            </p>
          ) : (
            history.map((h, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded border p-3 text-sm"
              >
                {h.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                )}
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{formatDate(h.at)}</span>
                    <Badge variant="outline" className="text-xs">
                      {h.trigger}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{h.message}</p>
                  {h.durationMs !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      Duration: {h.durationMs}ms
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BusinessAutomationsPage;
