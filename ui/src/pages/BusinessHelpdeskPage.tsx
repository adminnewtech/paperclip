import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LifeBuoy,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronUp,
  Minus,
  ChevronDown,
  Plus,
  Search,
  BookOpen,
  ArrowLeft,
  User,
  Calendar,
  List,
  LayoutGrid,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AIBrainPanel } from "@/components/business/AIBrainPanel";
import { AttachmentList } from "@/components/business/AttachmentList";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";

interface TicketData {
  description?: string;
  customerId?: string;
  priority?: TicketPriority;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTicketData(ticket: BusinessEntityRow): TicketData {
  return ticket.data as TicketData;
}

// ---------------------------------------------------------------------------
// Priority helpers
// ---------------------------------------------------------------------------

function PriorityIcon({ priority }: { priority: string }) {
  if (priority === "urgent") return <ChevronUp className="h-4 w-4 text-red-500" />;
  if (priority === "high") return <AlertTriangle className="h-4 w-4 text-orange-500" />;
  if (priority === "normal") return <Minus className="h-4 w-4 text-blue-400" />;
  return <ChevronDown className="h-4 w-4 text-muted-foreground" />;
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls =
    priority === "urgent"
      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
      : priority === "high"
        ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
        : priority === "normal"
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
          : "bg-muted text-muted-foreground";
  const label =
    priority === "urgent"
      ? "Urgent"
      : priority === "high"
        ? "High"
        : priority === "normal"
          ? "Normal"
          : "Low";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <PriorityIcon priority={priority} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  open: {
    label: "Open",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
  },
  in_progress: {
    label: "In Progress",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  waiting: {
    label: "Waiting",
    color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  resolved: {
    label: "Resolved",
    color:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  closed: {
    label: "Closed",
    color: "bg-muted text-muted-foreground",
    icon: <XCircle className="h-3.5 w-3.5" />,
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["open"]!;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stats Strip
// ---------------------------------------------------------------------------

const BOARD_COLUMNS: { status: TicketStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In Progress" },
  { status: "waiting", label: "Waiting" },
  { status: "resolved", label: "Resolved" },
  { status: "closed", label: "Closed" },
];

interface StatsStripProps {
  tickets: BusinessEntityRow[];
}

function StatsStrip({ tickets }: StatsStripProps) {
  const open = tickets.filter((t) => t.status === "open").length;
  const inProgress = tickets.filter((t) => t.status === "in_progress").length;
  const waiting = tickets.filter((t) => t.status === "waiting").length;
  const total = tickets.length;

  // Resolved this week
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const resolvedThisWeek = tickets.filter(
    (t) => t.status === "resolved" && new Date(t.updatedAt).getTime() > oneWeekAgo,
  ).length;

  // SLA breach: tickets open > 24h
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const slaBreaches = tickets.filter(
    (t) =>
      (t.status === "open" || t.status === "in_progress") &&
      new Date(t.createdAt).getTime() < oneDayAgo,
  ).length;

  // Avg resolution time (for resolved tickets)
  const resolvedTickets = tickets.filter((t) => t.status === "resolved");
  let avgResolutionHours: number | null = null;
  if (resolvedTickets.length > 0) {
    const totalMs = resolvedTickets.reduce(
      (sum, t) => sum + (new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime()),
      0,
    );
    avgResolutionHours = Math.round(totalMs / resolvedTickets.length / 3600000);
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <LifeBuoy className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold tabular-nums">{total}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-blue-500 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Open</p>
            <p className={`text-lg font-bold tabular-nums ${open > 0 ? "text-blue-600" : ""}`}>
              {open}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <Clock className="h-4 w-4 text-amber-500 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">In Progress</p>
            <p
              className={`text-lg font-bold tabular-nums ${inProgress > 0 ? "text-amber-600" : ""}`}
            >
              {inProgress}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Resolved / wk</p>
            <p className="text-lg font-bold tabular-nums text-emerald-600">
              {resolvedThisWeek}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          {slaBreaches > 0 ? (
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          )}
          <div>
            <p className="text-xs text-muted-foreground">
              {slaBreaches > 0 ? "SLA Breaches" : avgResolutionHours != null ? "Avg Resolution" : "Waiting"}
            </p>
            <p
              className={`text-lg font-bold tabular-nums ${slaBreaches > 0 ? "text-red-600" : ""}`}
            >
              {slaBreaches > 0
                ? slaBreaches
                : avgResolutionHours != null
                  ? `${avgResolutionHours}h`
                  : waiting}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket Card (Kanban)
// ---------------------------------------------------------------------------

function TicketCard({
  ticket,
  onClick,
}: {
  ticket: BusinessEntityRow;
  onClick: () => void;
}) {
  const data = getTicketData(ticket);
  const priority = data.priority ?? "normal";

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow border-l-2"
      style={{
        borderLeftColor:
          priority === "urgent"
            ? "rgb(239 68 68)"
            : priority === "high"
              ? "rgb(249 115 22)"
              : priority === "normal"
                ? "rgb(96 165 250)"
                : "rgb(148 163 184)",
      }}
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">
            {ticket.code ?? "TKT-???"}
          </span>
          <PriorityIcon priority={priority} />
        </div>
        <p className="text-sm font-medium leading-snug line-clamp-2">
          {ticket.name ?? "Untitled ticket"}
        </p>
        {data.customerId && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span className="truncate">{data.customerId}</span>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/70">{timeAgo(ticket.createdAt)}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ticket Board (Kanban)
// ---------------------------------------------------------------------------

function TicketBoard({
  tickets,
  onSelect,
}: {
  tickets: BusinessEntityRow[];
  onSelect: (ticket: BusinessEntityRow) => void;
}) {
  const byStatus = useMemo(() => {
    const map = new Map<string, BusinessEntityRow[]>();
    for (const col of BOARD_COLUMNS) map.set(col.status, []);
    for (const t of tickets) {
      const col = map.get(t.status);
      if (col) col.push(t);
      else {
        const open = map.get("open")!;
        open.push(t);
      }
    }
    return map;
  }, [tickets]);

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max">
        {BOARD_COLUMNS.map((col) => {
          const colTickets = byStatus.get(col.status) ?? [];
          const cfg = STATUS_CONFIG[col.status]!;
          return (
            <div key={col.status} className="w-60 flex-shrink-0">
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 ${cfg.color} rounded-full px-2 py-0.5 text-[10px] font-semibold`}>
                    {cfg.icon}
                    {col.label}
                  </span>
                </div>
                <Badge variant="secondary" className="text-[10px] tabular-nums">
                  {colTickets.length}
                </Badge>
              </div>
              <div className="space-y-2 min-h-[80px]">
                {colTickets.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} onClick={() => onSelect(ticket)} />
                ))}
                {colTickets.length === 0 && (
                  <div className="text-center py-6 text-xs text-muted-foreground/50 border border-dashed rounded-lg">
                    No tickets
                  </div>
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
// Ticket List (table view)
// ---------------------------------------------------------------------------

type SortKey = "code" | "priority" | "name" | "status" | "createdAt";

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function TicketList({
  tickets,
  onSelect,
  onDelete,
}: {
  tickets: BusinessEntityRow[];
  onSelect: (ticket: BusinessEntityRow) => void;
  onDelete: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const sorted = useMemo(() => {
    const arr = [...tickets];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "code") {
        cmp = (a.code ?? "").localeCompare(b.code ?? "");
      } else if (sortKey === "priority") {
        const ap = PRIORITY_ORDER[(getTicketData(a).priority ?? "normal")] ?? 2;
        const bp = PRIORITY_ORDER[(getTicketData(b).priority ?? "normal")] ?? 2;
        cmp = ap - bp;
      } else if (sortKey === "name") {
        cmp = (a.name ?? "").localeCompare(b.name ?? "");
      } else if (sortKey === "status") {
        cmp = (a.status ?? "").localeCompare(b.status ?? "");
      } else if (sortKey === "createdAt") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [tickets, sortKey, sortAsc]);

  function SortBtn({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    return (
      <button
        className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wide hover:text-foreground transition-colors ${active ? "text-foreground" : "text-muted-foreground"}`}
        onClick={() => toggleSort(col)}
      >
        {label}
        {active && <span className="text-[10px]">{sortAsc ? "↑" : "↓"}</span>}
      </button>
    );
  }

  if (tickets.length === 0) {
    return (
      <EmptyState icon={LifeBuoy} message="No tickets yet." />
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[80px_36px_1fr_140px_100px_100px_80px] items-center gap-3 px-4 py-2 bg-muted/50 border-b">
        <SortBtn col="code" label="Code" />
        <SortBtn col="priority" label="P" />
        <SortBtn col="name" label="Subject" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer</span>
        <SortBtn col="status" label="Status" />
        <SortBtn col="createdAt" label="Created" />
        <span />
      </div>
      {/* Rows */}
      <div className="divide-y">
        {sorted.map((ticket) => {
          const data = getTicketData(ticket);
          const priority = data.priority ?? "normal";
          return (
            <div
              key={ticket.id}
              className="grid grid-cols-[80px_36px_1fr_140px_100px_100px_80px] items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 group cursor-pointer"
              onClick={() => onSelect(ticket)}
            >
              <span className="font-mono text-[11px] text-muted-foreground truncate">
                {ticket.code ?? "—"}
              </span>
              <PriorityIcon priority={priority} />
              <span className="text-sm font-medium truncate">
                {ticket.name ?? "Untitled"}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {data.customerId ?? "—"}
              </span>
              <StatusBadge status={ticket.status} />
              <span className="text-xs text-muted-foreground">{timeAgo(ticket.createdAt)}</span>
              <button
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(ticket.id);
                }}
                title="Delete ticket"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket Detail Panel
// ---------------------------------------------------------------------------

interface TicketDetailProps {
  ticket: BusinessEntityRow;
  onBack: () => void;
  companyId: string;
}

function TicketDetail({ ticket, onBack, companyId }: TicketDetailProps) {
  const queryClient = useQueryClient();
  const data = getTicketData(ticket);
  const priority = data.priority ?? "normal";

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      businessApi.updateStatus(companyId, "helpdesk", "ticket", ticket.id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "helpdesk", "ticket"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
    },
  });

  const actions: { label: string; status: TicketStatus; variant?: "default" | "outline" }[] = [];
  if (ticket.status === "open") {
    actions.push({ label: "Start Working", status: "in_progress" });
    actions.push({ label: "Mark Waiting", status: "waiting", variant: "outline" });
    actions.push({ label: "Resolve", status: "resolved", variant: "outline" });
  } else if (ticket.status === "in_progress") {
    actions.push({ label: "Mark Waiting", status: "waiting", variant: "outline" });
    actions.push({ label: "Resolve", status: "resolved" });
    actions.push({ label: "Close", status: "closed", variant: "outline" });
  } else if (ticket.status === "waiting") {
    actions.push({ label: "Reopen", status: "open", variant: "outline" });
    actions.push({ label: "Resolve", status: "resolved" });
  } else if (ticket.status === "resolved") {
    actions.push({ label: "Reopen", status: "open", variant: "outline" });
    actions.push({ label: "Close", status: "closed", variant: "outline" });
  } else if (ticket.status === "closed") {
    actions.push({ label: "Reopen", status: "open", variant: "outline" });
  }

  return (
    <div className="space-y-4">
      {/* Back + Code + Status */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back
        </Button>
        <span className="font-mono text-sm text-muted-foreground">{ticket.code ?? "TKT-???"}</span>
        <div className="ml-auto">
          <Select
            value={ticket.status}
            onValueChange={(v) => statusMutation.mutate(v)}
            disabled={statusMutation.isPending}
          >
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOARD_COLUMNS.map((col) => (
                <SelectItem key={col.status} value={col.status} className="text-xs">
                  {col.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Title */}
      <div>
        <h2 className="text-xl font-semibold">{ticket.name ?? "Untitled ticket"}</h2>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3 border-y">
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Priority
          </p>
          <PriorityBadge priority={priority} />
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </p>
          <StatusBadge status={ticket.status} />
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <User className="h-3 w-3" /> Customer
          </p>
          <p className="text-sm">{data.customerId || "—"}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Created
          </p>
          <p className="text-sm">{timeAgo(ticket.createdAt)}</p>
          <p className="text-[10px] text-muted-foreground">{formatDate(ticket.createdAt)}</p>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Description
        </p>
        {data.description ? (
          <div className="bg-muted/40 rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed">
            {data.description}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No description provided.</p>
        )}
      </div>

      {/* Updated */}
      <p className="text-xs text-muted-foreground">
        Last updated {timeAgo(ticket.updatedAt)} · {formatDate(ticket.updatedAt)}
      </p>

      {/* Actions */}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <p className="text-xs text-muted-foreground mr-1">Actions:</p>
          {actions.map((action) => (
            <Button
              key={action.status}
              variant={action.variant ?? "default"}
              size="sm"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate(action.status)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {statusMutation.error && (
        <p className="text-sm text-destructive">
          {(statusMutation.error as Error).message}
        </p>
      )}

      {ticket.id && (
        <div className="space-y-4 mt-6">
          <AIBrainPanel
            companyId={companyId}
            moduleKey="helpdesk"
            entityType="ticket"
            entityId={ticket.id}
          />
          <AttachmentList entityId={ticket.id} companyId={companyId} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Ticket Dialog
// ---------------------------------------------------------------------------

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

function CreateTicketDialog({ open, onOpenChange, companyId }: CreateTicketDialogProps) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");

  const createMutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "helpdesk", "ticket", {
        entityType: "ticket",
        name: subject,
        status: "open",
        data: {
          description,
          customerId: customerId || undefined,
          priority,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "helpdesk", "ticket"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.summary(companyId),
      });
      onOpenChange(false);
      setSubject("");
      setDescription("");
      setCustomerId("");
      setPriority("normal");
    },
  });

  function handleSubmit() {
    if (!subject.trim()) return;
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Support Ticket</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="subject" className="text-xs">
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input
              id="subject"
              placeholder="e.g. Login page not working"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="description"
              placeholder="Describe the issue in detail…"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="customerId" className="text-xs">
                Customer
              </Label>
              <Input
                id="customerId"
                placeholder="Customer name or ID"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TicketPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!subject.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create Ticket"}
          </Button>
        </DialogFooter>
        {createMutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(createMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Knowledge Base
// ---------------------------------------------------------------------------

interface ArticleData {
  category?: string;
  content?: string;
}

function getArticleData(article: BusinessEntityRow): ArticleData {
  return article.data as ArticleData;
}

interface CreateArticleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

function CreateArticleDialog({ open, onOpenChange, companyId }: CreateArticleDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "helpdesk", "article", {
        entityType: "article",
        name: title,
        status: "published",
        data: {
          category: category || undefined,
          content,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "helpdesk", "article"),
      });
      onOpenChange(false);
      setTitle("");
      setCategory("");
      setContent("");
    },
  });

  function handleSubmit() {
    if (!title.trim()) return;
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Knowledge Base Article</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="article-title" className="text-xs">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="article-title"
              placeholder="e.g. How to reset your password"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="article-category" className="text-xs">
              Category
            </Label>
            <Input
              id="article-category"
              placeholder="e.g. Account, Billing, Technical"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="article-content" className="text-xs">
              Content
            </Label>
            <Textarea
              id="article-content"
              placeholder="Write the article content here…"
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Saving…" : "Publish Article"}
          </Button>
        </DialogFooter>
        {createMutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(createMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ArticleDetail({
  article,
  onBack,
  onDelete,
}: {
  article: BusinessEntityRow;
  onBack: () => void;
  onDelete: () => void;
}) {
  const data = getArticleData(article);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Articles
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4 mr-1.5" />
            Delete
          </Button>
        </div>
      </div>
      {data.category && (
        <Badge variant="secondary" className="text-[10px]">
          {data.category}
        </Badge>
      )}
      <h2 className="text-xl font-semibold">{article.name ?? "Untitled article"}</h2>
      <p className="text-xs text-muted-foreground">
        Published {timeAgo(article.createdAt)} · {formatDate(article.createdAt)}
      </p>
      <div className="border-t pt-4">
        {data.content ? (
          <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
            {data.content}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No content yet.</p>
        )}
      </div>
    </div>
  );
}

function KnowledgeBase({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<BusinessEntityRow | null>(null);

  const articlesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "helpdesk", "article", q),
    queryFn: () =>
      businessApi.listEntities(companyId, "helpdesk", "article", { q: q || undefined }),
  });
  const articles = articlesQuery.data?.entities ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      businessApi.deleteEntity(companyId, "helpdesk", "article", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "helpdesk", "article"),
      });
      setSelectedArticle(null);
    },
  });

  if (selectedArticle) {
    return (
      <ArticleDetail
        article={selectedArticle}
        onBack={() => setSelectedArticle(null)}
        onDelete={() => deleteMutation.mutate(selectedArticle.id)}
      />
    );
  }

  // Group by category
  const byCategory = useMemo(() => {
    const map = new Map<string, BusinessEntityRow[]>();
    map.set("__uncategorized__", []);
    for (const a of articles) {
      const cat = getArticleData(a).category || "__uncategorized__";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(a);
    }
    return map;
  }, [articles]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search articles…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Article
        </Button>
      </div>

      {articlesQuery.isLoading && <PageSkeleton variant="list" />}

      {!articlesQuery.isLoading && articles.length === 0 && (
        <EmptyState
          icon={BookOpen}
          message="No knowledge base articles yet."
          action="New Article"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {articles.length > 0 && (
        <div className="space-y-5">
          {Array.from(byCategory.entries()).map(([cat, catArticles]) => {
            if (catArticles.length === 0) return null;
            return (
              <div key={cat}>
                {cat !== "__uncategorized__" && (
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {cat}
                  </h3>
                )}
                <div className="border rounded-lg divide-y overflow-hidden">
                  {catArticles.map((article) => (
                    <button
                      key={article.id}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 text-left transition-colors group"
                      onClick={() => setSelectedArticle(article)}
                    >
                      <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {article.name ?? "Untitled"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {timeAgo(article.createdAt)}
                        </p>
                      </div>
                      {getArticleData(article).category && cat === "__uncategorized__" && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {getArticleData(article).category}
                        </Badge>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateArticleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

type ViewMode = "board" | "list";

export function BusinessHelpdeskPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("tickets");
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [q, setQ] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<BusinessEntityRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Helpdesk" },
    ]);
  }, [setBreadcrumbs]);

  const ticketsQuery = useQuery({
    queryKey: queryKeys.business.entities(selectedCompanyId!, "helpdesk", "ticket", q),
    queryFn: () =>
      businessApi.listEntities(selectedCompanyId!, "helpdesk", "ticket", {
        q: q || undefined,
      }),
    enabled: !!selectedCompanyId,
  });

  const allTicketsQuery = useQuery({
    queryKey: queryKeys.business.entities(selectedCompanyId!, "helpdesk", "ticket"),
    queryFn: () => businessApi.listEntities(selectedCompanyId!, "helpdesk", "ticket"),
    enabled: !!selectedCompanyId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      businessApi.deleteEntity(selectedCompanyId!, "helpdesk", "ticket", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(selectedCompanyId!, "helpdesk", "ticket"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(selectedCompanyId!),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.summary(selectedCompanyId!),
      });
      if (selectedTicket) setSelectedTicket(null);
    },
  });

  const companyId = selectedCompanyId;

  if (!companyId) {
    return <EmptyState icon={LifeBuoy} message="Select a workspace first." />;
  }

  if (ticketsQuery.isLoading || allTicketsQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const tickets = ticketsQuery.data?.entities ?? [];
  const allTickets = allTicketsQuery.data?.entities ?? [];

  // If a ticket is selected in ticket view, show detail
  if (selectedTicket && activeTab === "tickets") {
    // Refresh selected ticket from latest data
    const freshTicket =
      allTickets.find((t) => t.id === selectedTicket.id) ?? selectedTicket;
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Helpdesk</h1>
          </div>
        </div>
        <TicketDetail
          ticket={freshTicket}
          onBack={() => setSelectedTicket(null)}
          companyId={companyId}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Helpdesk</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage support tickets and knowledge base
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Ticket
        </Button>
      </div>

      {/* Stats Strip */}
      <StatsStrip tickets={allTickets} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList>
            <TabsTrigger value="tickets">
              <LifeBuoy className="h-4 w-4 mr-1.5" />
              Tickets
            </TabsTrigger>
            <TabsTrigger value="kb">
              <BookOpen className="h-4 w-4 mr-1.5" />
              Knowledge Base
            </TabsTrigger>
          </TabsList>

          {/* Ticket-tab controls */}
          {activeTab === "tickets" && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search tickets…"
                  className="pl-8 h-9 w-56"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <div className="flex items-center border rounded-md overflow-hidden">
                <button
                  className={`p-2 transition-colors ${viewMode === "board" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setViewMode("board")}
                  title="Board view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  className={`p-2 transition-colors ${viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setViewMode("list")}
                  title="List view"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Tickets Tab */}
        <TabsContent value="tickets" className="mt-4">
          {tickets.length === 0 && !q ? (
            <EmptyState
              icon={LifeBuoy}
              message="No support tickets yet. Create your first ticket to get started."
              action="New Ticket"
              onAction={() => setCreateOpen(true)}
            />
          ) : tickets.length === 0 && q ? (
            <EmptyState
              icon={Search}
              message={`No tickets found for "${q}".`}
            />
          ) : viewMode === "board" ? (
            <TicketBoard
              tickets={tickets}
              onSelect={(t) => setSelectedTicket(t)}
            />
          ) : (
            <TicketList
              tickets={tickets}
              onSelect={(t) => setSelectedTicket(t)}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          )}
        </TabsContent>

        {/* Knowledge Base Tab */}
        <TabsContent value="kb" className="mt-4">
          <KnowledgeBase companyId={companyId} />
        </TabsContent>
      </Tabs>

      {/* Create Ticket Dialog */}
      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
      />
    </div>
  );
}
