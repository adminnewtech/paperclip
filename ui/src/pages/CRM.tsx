import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Contact,
  Handshake,
  KanbanSquare,
  Users,
  Activity as ActivityIcon,
  FileText,
  Plus,
} from "lucide-react";
import { currencyFractionDigits, minorToMajor } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  crmApi,
  type DealRow,
  type LeadRow,
  type PipelineRow,
  type PipelineStageRow,
  type QuoteLine,
} from "../api/crm";

const DEFAULT_CURRENCY = "KWD";

const TABS = [
  { key: "pipeline", label: "Pipeline", icon: KanbanSquare },
  { key: "leads", label: "Leads", icon: Users },
  { key: "deals", label: "Deals", icon: Handshake },
  { key: "activities", label: "Activities", icon: ActivityIcon },
  { key: "quotes", label: "Quotes", icon: FileText },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function formatMinor(amountMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return `${minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

export function CRM() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<TabKey>("pipeline");

  useEffect(() => {
    setBreadcrumbs([{ label: "CRM" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState icon={Contact} message="Select a workspace to manage CRM." />
    );
  }

  return (
    <div className="space-y-6" dir="auto">
      <div>
        <h1 className="text-2xl font-semibold">CRM</h1>
        <p className="text-sm text-muted-foreground">
          Manage pipelines, leads, deals, activities, and quotes.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                active
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "pipeline" && <PipelineTab companyId={selectedCompanyId} />}
      {tab === "leads" && <LeadsTab companyId={selectedCompanyId} />}
      {tab === "deals" && <DealsTab companyId={selectedCompanyId} />}
      {tab === "activities" && <ActivitiesTab companyId={selectedCompanyId} />}
      {tab === "quotes" && <QuotesTab companyId={selectedCompanyId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline tab — kanban of stages with deal cards
// ---------------------------------------------------------------------------
function PipelineTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const pipelinesQuery = useQuery({
    queryKey: ["crm", "pipelines", companyId],
    queryFn: () => crmApi.listPipelines(companyId),
    enabled: !!companyId,
  });

  const pipelines = pipelinesQuery.data?.pipelines ?? [];
  const defaultPipeline: PipelineRow | undefined =
    pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const pipelineId = defaultPipeline?.id;

  const stagesQuery = useQuery({
    queryKey: ["crm", "stages", companyId, pipelineId],
    queryFn: () => crmApi.listStages(companyId, pipelineId),
    enabled: !!companyId && !!pipelineId,
  });

  const dealsQuery = useQuery({
    queryKey: ["crm", "deals", companyId, pipelineId],
    queryFn: () => crmApi.listDeals(companyId, pipelineId),
    enabled: !!companyId && !!pipelineId,
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      crmApi.moveDeal(companyId, id, { stageId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["crm", "deals", companyId, pipelineId],
      });
      pushToast({ title: "Deal moved", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to move deal",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (pipelinesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (pipelinesQuery.isError) {
    return (
      <EmptyState
        icon={KanbanSquare}
        message={
          (pipelinesQuery.error as Error)?.message ??
          "Failed to load pipelines."
        }
      />
    );
  }

  if (!defaultPipeline) {
    return <EmptyState icon={KanbanSquare} message="No pipelines yet." />;
  }

  if (stagesQuery.isLoading || dealsQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }
  if (stagesQuery.isError || dealsQuery.isError) {
    return (
      <EmptyState
        icon={KanbanSquare}
        message={
          ((stagesQuery.error ?? dealsQuery.error) as Error)?.message ??
          "Failed to load pipeline."
        }
      />
    );
  }

  const stages = [...(stagesQuery.data?.stages ?? [])].sort(
    (a, b) => a.sort - b.sort,
  );
  const deals = dealsQuery.data?.deals ?? [];

  if (stages.length === 0) {
    return (
      <EmptyState
        icon={KanbanSquare}
        message={`Pipeline "${defaultPipeline.name}" has no stages yet.`}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        Pipeline: <span className="font-medium">{defaultPipeline.name}</span>
      </div>
      <div className="grid gap-3 grid-flow-col auto-cols-[minmax(15rem,1fr)] overflow-x-auto pb-2">
        {stages.map((stage) => {
          const stageDeals = deals.filter((d) => d.stageId === stage.id);
          return (
            <div key={stage.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{stage.name}</span>
                <Badge variant="secondary">{stageDeals.length}</Badge>
              </div>
              <div className="space-y-2">
                {stageDeals.length === 0 ? (
                  <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3 text-center">
                    No deals
                  </div>
                ) : (
                  stageDeals.map((deal) => (
                    <Card key={deal.id}>
                      <CardContent className="p-3 space-y-2">
                        <div className="text-sm font-medium">{deal.name}</div>
                        <div className="text-xs font-mono text-muted-foreground">
                          {formatMinor(
                            deal.amountMinor,
                            deal.currency ?? DEFAULT_CURRENCY,
                          )}
                        </div>
                        <select
                          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                          value={deal.stageId ?? ""}
                          disabled={moveMutation.isPending}
                          onChange={(e) =>
                            moveMutation.mutate({
                              id: deal.id,
                              stageId: e.target.value,
                            })
                          }
                        >
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leads tab
// ---------------------------------------------------------------------------
function LeadsTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");

  const leadsQuery = useQuery({
    queryKey: ["crm", "leads", companyId],
    queryFn: () => crmApi.listLeads(companyId),
    enabled: !!companyId,
  });

  const pipelinesQuery = useQuery({
    queryKey: ["crm", "pipelines", companyId],
    queryFn: () => crmApi.listPipelines(companyId),
    enabled: !!companyId,
  });

  const invalidateLeads = () =>
    queryClient.invalidateQueries({ queryKey: ["crm", "leads", companyId] });

  function resetForm() {
    setName("");
    setCompanyName("");
    setEmail("");
    setPhone("");
    setSource("");
  }

  const createMutation = useMutation({
    mutationFn: () =>
      crmApi.createLead(companyId, {
        name: name.trim(),
        companyName: companyName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        source: source.trim() || undefined,
      }),
    onSuccess: () => {
      invalidateLeads();
      setDialogOpen(false);
      resetForm();
      pushToast({ title: "Lead created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create lead",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const scoreMutation = useMutation({
    mutationFn: (id: string) => crmApi.scoreLead(companyId, id),
    onSuccess: () => {
      invalidateLeads();
      pushToast({ title: "Lead re-scored", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to score lead",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const convertMutation = useMutation({
    mutationFn: ({ id, pipelineId }: { id: string; pipelineId: string }) =>
      crmApi.convertLead(companyId, id, { pipelineId }),
    onSuccess: () => {
      invalidateLeads();
      queryClient.invalidateQueries({ queryKey: ["crm", "deals", companyId] });
      pushToast({ title: "Lead converted to deal", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to convert lead",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (leadsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (leadsQuery.isError) {
    return (
      <EmptyState
        icon={Users}
        message={(leadsQuery.error as Error)?.message ?? "Failed to load leads."}
      />
    );
  }

  const leads = leadsQuery.data?.leads ?? [];
  const pipelines = pipelinesQuery.data?.pipelines ?? [];
  const defaultPipelineId = (
    pipelines.find((p) => p.isDefault) ?? pipelines[0]
  )?.id;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New lead
        </Button>
      </div>

      {leads.length === 0 ? (
        <EmptyState icon={Users} message="No leads yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Name</th>
                  <th className="text-start font-medium px-4 py-2">Company</th>
                  <th className="text-start font-medium px-4 py-2">Source</th>
                  <th className="text-end font-medium px-4 py-2">Score</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                  <th className="text-end font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead: LeadRow) => (
                  <tr
                    key={lead.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">{lead.name}</td>
                    <td className="px-4 py-2">{lead.companyName ?? "—"}</td>
                    <td className="px-4 py-2">{lead.source ?? "—"}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {lead.score}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary" className="capitalize">
                        {lead.status ?? "new"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-end space-x-2 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={scoreMutation.isPending}
                        onClick={() => scoreMutation.mutate(lead.id)}
                      >
                        Score
                      </Button>
                      {lead.status !== "converted" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            convertMutation.isPending || !defaultPipelineId
                          }
                          onClick={() =>
                            defaultPipelineId &&
                            convertMutation.mutate({
                              id: lead.id,
                              pipelineId: defaultPipelineId,
                            })
                          }
                        >
                          Convert
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="lead-name">Name</Label>
              <Input
                id="lead-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-company">Company</Label>
              <Input
                id="lead-company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lead-email">Email</Label>
                <Input
                  id="lead-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-phone">Phone</Label>
                <Input
                  id="lead-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-source">Source</Label>
              <Input
                id="lead-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="referral, website, ad…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deals tab
// ---------------------------------------------------------------------------
function DealsTab({ companyId }: { companyId: string }) {
  const dealsQuery = useQuery({
    queryKey: ["crm", "deals", companyId],
    queryFn: () => crmApi.listDeals(companyId),
    enabled: !!companyId,
  });

  if (dealsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (dealsQuery.isError) {
    return (
      <EmptyState
        icon={Handshake}
        message={(dealsQuery.error as Error)?.message ?? "Failed to load deals."}
      />
    );
  }

  const deals = dealsQuery.data?.deals ?? [];

  if (deals.length === 0) {
    return <EmptyState icon={Handshake} message="No deals yet." />;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-start font-medium px-4 py-2">Name</th>
              <th className="text-start font-medium px-4 py-2">Customer</th>
              <th className="text-end font-medium px-4 py-2">Amount</th>
              <th className="text-end font-medium px-4 py-2">Score</th>
              <th className="text-start font-medium px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal: DealRow) => (
              <tr key={deal.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{deal.name}</td>
                <td className="px-4 py-2">{deal.customerName ?? "—"}</td>
                <td className="px-4 py-2 text-end font-mono">
                  {formatMinor(
                    deal.amountMinor,
                    deal.currency ?? DEFAULT_CURRENCY,
                  )}
                </td>
                <td className="px-4 py-2 text-end font-mono">{deal.score}</td>
                <td className="px-4 py-2">
                  <Badge variant="secondary" className="capitalize">
                    {deal.status ?? "open"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Activities tab — timeline + create
// ---------------------------------------------------------------------------
function ActivitiesTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [kind, setKind] = useState("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const activitiesQuery = useQuery({
    queryKey: ["crm", "activities", companyId],
    queryFn: () => crmApi.listActivities(companyId),
    enabled: !!companyId,
  });

  function resetForm() {
    setKind("note");
    setSubject("");
    setBody("");
  }

  const createMutation = useMutation({
    mutationFn: () =>
      crmApi.createActivity(companyId, {
        kind: kind.trim() || undefined,
        subject: subject.trim() || undefined,
        body: body.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["crm", "activities", companyId],
      });
      setDialogOpen(false);
      resetForm();
      pushToast({ title: "Activity logged", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to log activity",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (activitiesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (activitiesQuery.isError) {
    return (
      <EmptyState
        icon={ActivityIcon}
        message={
          (activitiesQuery.error as Error)?.message ??
          "Failed to load activities."
        }
      />
    );
  }

  const activities = activitiesQuery.data?.activities ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          Log activity
        </Button>
      </div>

      {activities.length === 0 ? (
        <EmptyState icon={ActivityIcon} message="No activities yet." />
      ) : (
        <div className="space-y-2">
          {activities.map((act) => (
            <Card key={act.id}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <Badge variant="secondary" className="capitalize mt-0.5">
                    {act.kind ?? "note"}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {act.subject ?? "(no subject)"}
                    </div>
                    {act.body && (
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {act.body}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(act.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log activity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="act-kind">Kind</Label>
              <select
                id="act-kind"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="meeting">Meeting</option>
                <option value="note">Note</option>
                <option value="task">Task</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-subject">Subject</Label>
              <Input
                id="act-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-body">Notes</Label>
              <Input
                id="act-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quotes tab — table + create dialog with line items + accept
// ---------------------------------------------------------------------------
function QuotesTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const quotesQuery = useQuery({
    queryKey: ["crm", "quotes", companyId],
    queryFn: () => crmApi.listQuotes(companyId),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["crm", "quotes", companyId] });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => crmApi.acceptQuote(companyId, id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Quote accepted", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to accept quote",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (quotesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (quotesQuery.isError) {
    return (
      <EmptyState
        icon={FileText}
        message={
          (quotesQuery.error as Error)?.message ?? "Failed to load quotes."
        }
      />
    );
  }

  const quotes = quotesQuery.data?.quotes ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New quote
        </Button>
      </div>

      {quotes.length === 0 ? (
        <EmptyState icon={FileText} message="No quotes yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Number</th>
                  <th className="text-start font-medium px-4 py-2">Customer</th>
                  <th className="text-end font-medium px-4 py-2">Total</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                  <th className="text-end font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2 font-mono">
                      {quote.number ?? "—"}
                    </td>
                    <td className="px-4 py-2">{quote.customerName ?? "—"}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(
                        quote.totalMinor,
                        quote.currency ?? DEFAULT_CURRENCY,
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary" className="capitalize">
                        {quote.status ?? "draft"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-end whitespace-nowrap">
                      {quote.status !== "accepted" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acceptMutation.isPending}
                          onClick={() => acceptMutation.mutate(quote.id)}
                        >
                          Accept
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <QuoteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        onCreated={invalidate}
      />
    </div>
  );
}

interface QuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onCreated: () => void;
}

function QuoteDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: QuoteDialogProps) {
  const { pushToast } = useToast();
  const [customerName, setCustomerName] = useState("");
  const [number, setNumber] = useState("");
  const [taxRatePct, setTaxRatePct] = useState("0");
  const [lines, setLines] = useState<QuoteLine[]>([
    { description: "", qty: 1, unitPriceMinor: 0 },
  ]);

  const fractionDigits = currencyFractionDigits(DEFAULT_CURRENCY);
  const minorPerMajor = Math.round(10 ** fractionDigits);

  const subtotalMinor = useMemo(
    () =>
      lines.reduce((sum, l) => sum + Math.round(l.qty * l.unitPriceMinor), 0),
    [lines],
  );
  const taxMinor = Math.round((subtotalMinor * (Number(taxRatePct) || 0)) / 100);
  const totalMinor = subtotalMinor + taxMinor;

  function reset() {
    setCustomerName("");
    setNumber("");
    setTaxRatePct("0");
    setLines([{ description: "", qty: 1, unitPriceMinor: 0 }]);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      crmApi.createQuote(companyId, {
        number: number.trim() || undefined,
        customerName: customerName.trim() || undefined,
        currency: DEFAULT_CURRENCY,
        taxRatePct: Number(taxRatePct) || 0,
        lines,
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      reset();
      pushToast({ title: "Quote created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create quote",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  function updateLine(idx: number, patch: Partial<QuoteLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New quote</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="quote-customer">Customer</Label>
              <Input
                id="quote-customer"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-number">Number</Label>
              <Input
                id="quote-number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    { description: "", qty: 1, unitPriceMinor: 0 },
                  ])
                }
              >
                <Plus className="me-1 h-3 w-3" />
                Add line
              </Button>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-6"
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) =>
                    updateLine(idx, { description: e.target.value })
                  }
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={0}
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) =>
                    updateLine(idx, { qty: Number(e.target.value) || 0 })
                  }
                />
                <Input
                  className="col-span-4"
                  type="number"
                  min={0}
                  step={1 / minorPerMajor}
                  placeholder={`Unit price (${DEFAULT_CURRENCY})`}
                  value={
                    line.unitPriceMinor ? line.unitPriceMinor / minorPerMajor : ""
                  }
                  onChange={(e) =>
                    updateLine(idx, {
                      unitPriceMinor: Math.round(
                        (Number(e.target.value) || 0) * minorPerMajor,
                      ),
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="quote-tax">Tax rate %</Label>
              <Input
                id="quote-tax"
                type="number"
                min={0}
                max={100}
                value={taxRatePct}
                onChange={(e) => setTaxRatePct(e.target.value)}
              />
            </div>
            <div className="text-sm space-y-1 text-end">
              <div className="text-muted-foreground">
                Subtotal: {formatMinor(subtotalMinor, DEFAULT_CURRENCY)}
              </div>
              <div className="text-muted-foreground">
                Tax: {formatMinor(taxMinor, DEFAULT_CURRENCY)}
              </div>
              <div className="font-semibold">
                Total: {formatMinor(totalMinor, DEFAULT_CURRENCY)}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={subtotalMinor <= 0 || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
