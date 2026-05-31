import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Inbox, Timer, BookOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { helpdeskApi, type TicketRow } from "../api/helpdesk";

const TABS = [
  { key: "tickets", label: "Tickets", icon: Inbox },
  { key: "sla", label: "SLA Policies", icon: Timer },
  { key: "kb", label: "Knowledge Base", icon: BookOpen },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function Helpdesk() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<TabKey>("tickets");

  useEffect(() => {
    setBreadcrumbs([{ label: "Helpdesk" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={LifeBuoy}
        message="Select a workspace to manage helpdesk."
      />
    );
  }

  return (
    <div className="space-y-6" dir="auto">
      <div>
        <h1 className="text-2xl font-semibold">Helpdesk</h1>
        <p className="text-sm text-muted-foreground">
          Manage support tickets, SLA policies, and your knowledge base.
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

      {tab === "tickets" && <TicketsTab companyId={selectedCompanyId} />}
      {tab === "sla" && <SlaTab companyId={selectedCompanyId} />}
      {tab === "kb" && <KnowledgeBaseTab companyId={selectedCompanyId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
function PriorityBadge({ priority }: { priority: string }) {
  const tone =
    priority === "urgent"
      ? "text-red-500"
      : priority === "high"
        ? "text-orange-500"
        : priority === "low"
          ? "text-muted-foreground"
          : "text-amber-500";
  return <span className={`text-xs capitalize ${tone}`}>{priority}</span>;
}

function TicketStatusBadge({ status }: { status: string }) {
  const tone =
    status === "resolved" || status === "closed"
      ? "text-emerald-500"
      : status === "pending"
        ? "text-amber-500"
        : "text-blue-500";
  return <span className={`text-xs capitalize ${tone}`}>{status}</span>;
}

function SlaBadge({ ticket }: { ticket: TicketRow }) {
  if (!ticket.slaDueAt) return <span className="text-xs text-muted-foreground">—</span>;
  const due = new Date(ticket.slaDueAt);
  const overdue =
    due.getTime() < Date.now() &&
    ticket.status !== "resolved" &&
    ticket.status !== "closed";
  return (
    <span className={`text-xs ${overdue ? "text-red-500" : "text-muted-foreground"}`}>
      {due.toLocaleDateString()}
      {overdue ? " (overdue)" : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tickets tab
// ---------------------------------------------------------------------------
function TicketsTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">(
    "medium",
  );

  const ticketsQuery = useQuery({
    queryKey: ["helpdesk", "tickets", companyId],
    queryFn: () => helpdeskApi.listTickets(companyId),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["helpdesk", "tickets", companyId],
    });

  const createMutation = useMutation({
    mutationFn: () =>
      helpdeskApi.createTicket(companyId, {
        subject: subject.trim() || undefined,
        customerName: customerName.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        priority,
      }),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setSubject("");
      setCustomerName("");
      setCustomerEmail("");
      setPriority("medium");
      pushToast({ title: "Ticket created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create ticket",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => helpdeskApi.resolveTicket(companyId, id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Ticket resolved", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to resolve ticket",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (ticketsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (ticketsQuery.isError) {
    return (
      <EmptyState
        icon={Inbox}
        message={(ticketsQuery.error as Error)?.message ?? "Failed to load tickets."}
      />
    );
  }

  const tickets = ticketsQuery.data?.tickets ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New ticket
        </Button>
      </div>

      {tickets.length === 0 ? (
        <EmptyState icon={Inbox} message="No tickets yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Subject</th>
                  <th className="text-start font-medium px-4 py-2">Customer</th>
                  <th className="text-start font-medium px-4 py-2">Priority</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                  <th className="text-start font-medium px-4 py-2">SLA due</th>
                  <th className="text-end font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">{ticket.subject ?? "—"}</td>
                    <td className="px-4 py-2">
                      {ticket.customerName ?? ticket.customerEmail ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td className="px-4 py-2">
                      <TicketStatusBadge status={ticket.status} />
                    </td>
                    <td className="px-4 py-2">
                      <SlaBadge ticket={ticket} />
                    </td>
                    <td className="px-4 py-2 text-end whitespace-nowrap">
                      {ticket.status !== "resolved" &&
                        ticket.status !== "closed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resolveMutation.isPending}
                            onClick={() => resolveMutation.mutate(ticket.id)}
                          >
                            Resolve
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
            <DialogTitle>New ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer">Customer name</Label>
              <Input
                id="customer"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Customer email</Label>
              <Input
                id="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority">Priority</Label>
              <select
                id="priority"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={priority}
                onChange={(e) =>
                  setPriority(
                    e.target.value as "low" | "medium" | "high" | "urgent",
                  )
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
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
              disabled={!subject.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create ticket"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SLA policies tab
// ---------------------------------------------------------------------------
function SlaTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [firstResponseMins, setFirstResponseMins] = useState("60");
  const [resolutionMins, setResolutionMins] = useState("1440");

  const policiesQuery = useQuery({
    queryKey: ["helpdesk", "sla-policies", companyId],
    queryFn: () => helpdeskApi.listSlaPolicies(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      helpdeskApi.createSlaPolicy(companyId, {
        name: name.trim(),
        firstResponseMins: Number(firstResponseMins) || 60,
        resolutionMins: Number(resolutionMins) || 1440,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["helpdesk", "sla-policies", companyId],
      });
      setDialogOpen(false);
      setName("");
      setFirstResponseMins("60");
      setResolutionMins("1440");
      pushToast({ title: "SLA policy created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create SLA policy",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (policiesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (policiesQuery.isError) {
    return (
      <EmptyState
        icon={Timer}
        message={
          (policiesQuery.error as Error)?.message ?? "Failed to load SLA policies."
        }
      />
    );
  }

  const policies = policiesQuery.data?.slaPolicies ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New SLA policy
        </Button>
      </div>

      {policies.length === 0 ? (
        <EmptyState icon={Timer} message="No SLA policies yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Name</th>
                  <th className="text-start font-medium px-4 py-2">Priority</th>
                  <th className="text-end font-medium px-4 py-2">
                    First response (min)
                  </th>
                  <th className="text-end font-medium px-4 py-2">
                    Resolution (min)
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr
                    key={policy.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">{policy.name ?? "—"}</td>
                    <td className="px-4 py-2 capitalize">{policy.priority}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {policy.firstResponseMins}
                    </td>
                    <td className="px-4 py-2 text-end font-mono">
                      {policy.resolutionMins}
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
            <DialogTitle>New SLA policy</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="sla-name">Name</Label>
              <Input
                id="sla-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="first-response">First response (min)</Label>
                <Input
                  id="first-response"
                  type="number"
                  min={1}
                  value={firstResponseMins}
                  onChange={(e) => setFirstResponseMins(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="resolution">Resolution (min)</Label>
                <Input
                  id="resolution"
                  type="number"
                  min={1}
                  value={resolutionMins}
                  onChange={(e) => setResolutionMins(e.target.value)}
                />
              </div>
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
              {createMutation.isPending ? "Creating…" : "Create policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Knowledge base tab
// ---------------------------------------------------------------------------
function KnowledgeBaseTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");

  const articlesQuery = useQuery({
    queryKey: ["helpdesk", "kb-articles", companyId],
    queryFn: () => helpdeskApi.listKbArticles(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      helpdeskApi.createKbArticle(companyId, {
        title: title.trim(),
        category: category.trim() || undefined,
        body: body.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["helpdesk", "kb-articles", companyId],
      });
      setDialogOpen(false);
      setTitle("");
      setCategory("");
      setBody("");
      pushToast({ title: "Article created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create article",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (articlesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (articlesQuery.isError) {
    return (
      <EmptyState
        icon={BookOpen}
        message={
          (articlesQuery.error as Error)?.message ?? "Failed to load articles."
        }
      />
    );
  }

  const articles = articlesQuery.data?.kbArticles ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New article
        </Button>
      </div>

      {articles.length === 0 ? (
        <EmptyState icon={BookOpen} message="No knowledge base articles yet." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {articles.map((article) => (
            <Card key={article.id}>
              <CardContent className="p-4">
                <div className="font-medium">{article.title ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {article.category ?? "Uncategorized"}
                </div>
                <div className="flex items-center justify-between mt-2 text-xs">
                  <span
                    className={
                      article.published
                        ? "text-emerald-500"
                        : "text-muted-foreground"
                    }
                  >
                    {article.published ? "Published" : "Draft"}
                  </span>
                  <span className="text-muted-foreground">
                    {article.views} views
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New article</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="kb-title">Title</Label>
              <Input
                id="kb-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-category">Category</Label>
              <Input
                id="kb-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-body">Body</Label>
              <textarea
                id="kb-body"
                className="w-full min-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
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
              disabled={!title.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create article"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
