import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UserPlus,
  TrendingUp,
  Target,
  Phone,
  Mail,
  Search,
  Plus,
  MoreHorizontal,
  ChevronRight,
  Trash2,
  Edit2,
  Star,
  Clock,
  Building,
  DollarSign,
  Calendar,
  ArrowRight,
  LayoutGrid,
  List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AIBrainPanel } from "@/components/business/AIBrainPanel";
import { AttachmentList } from "@/components/business/AttachmentList";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString("en-SA", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function avatarColor(name: string): string {
  const colors = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-green-500",
    "bg-orange-500",
    "bg-pink-500",
    "bg-teal-500",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % colors.length;
  return colors[Math.abs(hash) % colors.length]!;
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Deal stages
// ---------------------------------------------------------------------------

const DEAL_STAGES = [
  { value: "prospecting", label: "Prospecting", color: "text-blue-600" },
  { value: "qualified", label: "Qualified", color: "text-indigo-600" },
  { value: "proposal", label: "Proposal", color: "text-violet-600" },
  { value: "negotiation", label: "Negotiation", color: "text-amber-600" },
  { value: "won", label: "Won", color: "text-emerald-600" },
  { value: "lost", label: "Lost", color: "text-red-500" },
] as const;

type DealStageValue = (typeof DEAL_STAGES)[number]["value"];

function nextStage(current: DealStageValue): DealStageValue | null {
  const active = ["prospecting", "qualified", "proposal", "negotiation"] as const;
  const idx = active.indexOf(current as (typeof active)[number]);
  if (idx === -1 || idx === active.length - 1) return null;
  return active[idx + 1] ?? null;
}

// ---------------------------------------------------------------------------
// Lead source options
// ---------------------------------------------------------------------------

const LEAD_SOURCES = [
  { value: "website", label: "Website" },
  { value: "referral", label: "Referral" },
  { value: "ads", label: "Ads" },
  { value: "event", label: "Event" },
  { value: "other", label: "Other" },
];

const LEAD_STATUSES = [
  { value: "new", label: "New", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  {
    value: "qualified",
    label: "Qualified",
    cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400",
  },
  {
    value: "unqualified",
    label: "Unqualified",
    cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  },
  {
    value: "converted",
    label: "Converted",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  },
];

function LeadStatusBadge({ status }: { status: string }) {
  const spec = LEAD_STATUSES.find((s) => s.value === status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${spec?.cls ?? "bg-muted text-muted-foreground"}`}
    >
      {spec?.label ?? status}
    </span>
  );
}

function DealStageBadge({ status }: { status: string }) {
  const stage = DEAL_STAGES.find((s) => s.value === status);
  const cls =
    status === "won"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
      : status === "lost"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {stage?.label ?? status}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const label = LEAD_SOURCES.find((s) => s.value === source)?.label ?? source;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Activity types
// ---------------------------------------------------------------------------

type ActivityType = "call" | "email" | "meeting" | "note";

interface ActivityEntry {
  id: string;
  type: ActivityType;
  title: string;
  notes: string;
  date: string;
  dealId?: string;
  contactId?: string;
}

const ACTIVITY_ICONS: Record<ActivityType, React.ReactNode> = {
  call: <Phone className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  meeting: <Calendar className="h-3.5 w-3.5" />,
  note: <Edit2 className="h-3.5 w-3.5" />,
};

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  call: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  email: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
  meeting: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  note: "bg-muted text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Contacts Tab
// ---------------------------------------------------------------------------

function ContactsTab({ companyId }: { companyId: string }) {
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const contactsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "crm", "contact", q),
    queryFn: () => businessApi.listEntities(companyId, "crm", "contact", { q: q || undefined }),
  });

  const contacts = contactsQuery.data?.entities ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search contacts…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New contact
        </Button>
      </div>

      {contactsQuery.isLoading && <PageSkeleton variant="list" />}

      {!contactsQuery.isLoading && contacts.length === 0 && (
        <EmptyState
          icon={Users}
          message="No contacts yet. Add your first contact to get started."
          action="New contact"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {contacts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {contacts.map((contact) => (
            <ContactCard key={contact.id} contact={contact} companyId={companyId} />
          ))}
        </div>
      )}

      <CreateContactDialog open={createOpen} onOpenChange={setCreateOpen} companyId={companyId} />
    </div>
  );
}

function ContactCard({ contact, companyId }: { contact: BusinessEntityRow; companyId: string }) {
  const queryClient = useQueryClient();
  const d = contact.data as Record<string, string>;
  const name = contact.name ?? "Unknown";
  const colorCls = avatarColor(name);
  const init = initials(name);

  const deleteMutation = useMutation({
    mutationFn: () => businessApi.deleteEntity(companyId, "crm", "contact", contact.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "contact"),
      });
    },
  });

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`flex-shrink-0 w-10 h-10 rounded-full ${colorCls} flex items-center justify-center text-white font-semibold text-sm`}
            >
              {init}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{name}</div>
              {(d.title || d.company) && (
                <div className="text-xs text-muted-foreground truncate">
                  {[d.title, d.company].filter(Boolean).join(" at ")}
                </div>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => deleteMutation.mutate()}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-3 space-y-1.5">
          {d.email && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <a
                href={`mailto:${d.email}`}
                className="truncate hover:text-foreground transition-colors"
              >
                {d.email}
              </a>
            </div>
          )}
          {d.phone && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <a
                href={`tel:${d.phone}`}
                className="truncate hover:text-foreground transition-colors"
              >
                {d.phone}
              </a>
            </div>
          )}
          {d.company && !d.title && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Building className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{d.company}</span>
            </div>
          )}
        </div>

        {d.notes && (
          <p className="mt-2 text-xs text-muted-foreground/70 line-clamp-2 border-t pt-2 mt-2">
            {d.notes}
          </p>
        )}

        <div className="flex gap-2 mt-3">
          {d.email && (
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" asChild>
              <a href={`mailto:${d.email}`}>
                <Mail className="h-3 w-3 mr-1" />
                Email
              </a>
            </Button>
          )}
          {d.phone && (
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" asChild>
              <a href={`tel:${d.phone}`}>
                <Phone className="h-3 w-3 mr-1" />
                Call
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateContactDialog({
  open,
  onOpenChange,
  companyId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    title: "",
    notes: "",
  });

  const createMutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "crm", "contact", {
        entityType: "contact",
        name: form.name,
        status: "active",
        data: {
          email: form.email,
          phone: form.phone,
          company: form.company,
          title: form.title,
          notes: form.notes,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "contact"),
      });
      onOpenChange(false);
      setForm({ name: "", email: "", phone: "", company: "", title: "", notes: "" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Full Name *</Label>
            <Input
              placeholder="Jane Smith"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              placeholder="jane@company.com"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone</Label>
            <Input
              placeholder="+966 50 123 4567"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Company</Label>
              <Input
                placeholder="Acme Corp"
                value={form.company}
                onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input
                placeholder="CEO"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={3}
              placeholder="Additional notes…"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>
        </div>
        {createMutation.error && (
          <p className="text-sm text-destructive mt-1">
            {(createMutation.error as Error).message}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Saving…" : "Create Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Leads Tab
// ---------------------------------------------------------------------------

function LeadsTab({
  companyId,
  onLeadConverted,
}: {
  companyId: string;
  onLeadConverted: (leadName: string) => void;
}) {
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const leadsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "crm", "lead", q),
    queryFn: () => businessApi.listEntities(companyId, "crm", "lead", { q: q || undefined }),
  });

  const leads = leadsQuery.data?.entities ?? [];

  const convertMutation = useMutation({
    mutationFn: (lead: BusinessEntityRow) =>
      businessApi.updateStatus(companyId, "crm", "lead", lead.id, "converted"),
    onSuccess: (_data, lead) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "lead"),
      });
      onLeadConverted(lead.name ?? "Lead");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessApi.deleteEntity(companyId, "crm", "lead", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "lead"),
      });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search leads…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New lead
        </Button>
      </div>

      {leadsQuery.isLoading && <PageSkeleton variant="list" />}

      {!leadsQuery.isLoading && leads.length === 0 && (
        <EmptyState
          icon={UserPlus}
          message="No leads yet. Start capturing leads to build your pipeline."
          action="New lead"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {leads.length > 0 && (
        <div className="border rounded-lg divide-y overflow-hidden">
          {leads.map((lead) => {
            const d = lead.data as Record<string, string>;
            return (
              <div
                key={lead.id}
                className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {d.source && <SourceBadge source={d.source} />}
                    <span className="font-medium text-sm">{lead.name ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                    {d.email && (
                      <a href={`mailto:${d.email}`} className="flex items-center gap-1 hover:text-foreground">
                        <Mail className="h-3 w-3" />
                        {d.email}
                      </a>
                    )}
                    {d.phone && (
                      <a href={`tel:${d.phone}`} className="flex items-center gap-1 hover:text-foreground">
                        <Phone className="h-3 w-3" />
                        {d.phone}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <LeadStatusBadge status={lead.status} />
                  {lead.status !== "converted" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={convertMutation.isPending}
                      onClick={() => convertMutation.mutate(lead)}
                    >
                      <ArrowRight className="h-3 w-3 mr-1" />
                      Convert to deal
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => deleteMutation.mutate(lead.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} companyId={companyId} />
    </div>
  );
}

function CreateLeadDialog({
  open,
  onOpenChange,
  companyId,
  prefillName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  prefillName?: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", source: "website", email: "", phone: "" });

  useEffect(() => {
    if (open && prefillName) {
      setForm((p) => ({ ...p, name: prefillName }));
    }
  }, [open, prefillName]);

  const createMutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "crm", "lead", {
        entityType: "lead",
        name: form.name,
        status: "new",
        data: { source: form.source, email: form.email, phone: form.phone },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "lead"),
      });
      onOpenChange(false);
      setForm({ name: "", source: "website", email: "", phone: "" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Lead Name *</Label>
            <Input
              placeholder="Company or person name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Source</Label>
            <Select value={form.source} onValueChange={(v) => setForm((p) => ({ ...p, source: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              placeholder="lead@company.com"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone</Label>
            <Input
              placeholder="+966 50 123 4567"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            />
          </div>
        </div>
        {createMutation.error && (
          <p className="text-sm text-destructive mt-1">
            {(createMutation.error as Error).message}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Saving…" : "Create Lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pipeline / Deals Tab
// ---------------------------------------------------------------------------

type ViewMode = "kanban" | "list";

function PipelineTab({ companyId }: { companyId: string }) {
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<BusinessEntityRow | null>(null);

  const dealsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "crm", "deal"),
    queryFn: () => businessApi.listEntities(companyId, "crm", "deal"),
  });

  const deals = dealsQuery.data?.entities ?? [];

  const byStage = useMemo(() => {
    const map = new Map<string, BusinessEntityRow[]>();
    for (const s of DEAL_STAGES) map.set(s.value, []);
    for (const d of deals) {
      const arr = map.get(d.status);
      if (arr) arr.push(d);
      else map.get("prospecting")!.push(d);
    }
    return map;
  }, [deals]);

  const totalPipelineCents = useMemo(
    () =>
      deals
        .filter((d) => !["won", "lost"].includes(d.status))
        .reduce((a, d) => a + (d.amountCents ?? 0), 0),
    [deals],
  );

  const wonCents = useMemo(
    () =>
      deals.filter((d) => d.status === "won").reduce((a, d) => a + (d.amountCents ?? 0), 0),
    [deals],
  );

  const totalDealsInPipeline = deals.filter((d) => !["won", "lost"].includes(d.status)).length;
  const totalWon = deals.filter((d) => d.status === "won").length;
  const conversionRate =
    deals.length > 0 ? Math.round((totalWon / deals.length) * 100) : 0;

  if (dealsQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      {/* Pipeline summary bar */}
      <div className="flex items-center flex-wrap gap-4 p-3 rounded-lg bg-muted/40 border text-sm">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground text-xs">Total Pipeline:</span>
          <span className="font-semibold">{formatCurrency(totalPipelineCents)}</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-emerald-500" />
          <span className="text-muted-foreground text-xs">Won:</span>
          <span className="font-semibold text-emerald-600">{formatCurrency(wonCents)}</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground text-xs">Conversion rate:</span>
          <span className="font-semibold">{conversionRate}%</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant={viewMode === "kanban" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode("kanban")}
            title="Kanban view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode("list")}
            title="List view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New deal
          </Button>
        </div>
      </div>

      {deals.length === 0 && (
        <EmptyState
          icon={Target}
          message="No deals yet. Create your first deal to start tracking your pipeline."
          action="New deal"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {deals.length > 0 && viewMode === "kanban" && (
        <DealKanban
          byStage={byStage}
          companyId={companyId}
          onDealClick={setSelectedDeal}
        />
      )}

      {deals.length > 0 && viewMode === "list" && (
        <DealList
          deals={deals}
          companyId={companyId}
          onDealClick={setSelectedDeal}
        />
      )}

      <CreateDealDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
      />

      {selectedDeal && (
        <DealDetailDialog
          deal={selectedDeal}
          companyId={companyId}
          onClose={() => setSelectedDeal(null)}
          onUpdated={(updated) => setSelectedDeal(updated)}
        />
      )}
    </div>
  );
}

function DealKanban({
  byStage,
  companyId,
  onDealClick,
}: {
  byStage: Map<string, BusinessEntityRow[]>;
  companyId: string;
  onDealClick: (deal: BusinessEntityRow) => void;
}) {
  const queryClient = useQueryClient();

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      businessApi.updateStatus(companyId, "crm", "deal", id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "deal"),
      });
    },
  });

  return (
    <div className="overflow-x-auto pb-3">
      <div className="flex gap-3 min-w-max">
        {DEAL_STAGES.map((stage) => {
          const stageDeals = byStage.get(stage.value) ?? [];
          const totalCents = stageDeals.reduce((a, d) => a + (d.amountCents ?? 0), 0);
          const isWon = stage.value === "won";
          const isLost = stage.value === "lost";

          return (
            <div key={stage.value} className="w-60 flex-shrink-0">
              {/* Column header */}
              <div
                className={`flex items-center justify-between mb-2 px-1 pb-2 border-b ${isWon ? "border-emerald-300 dark:border-emerald-800" : isLost ? "border-red-300 dark:border-red-800" : "border-border"}`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${isWon ? "text-emerald-600" : isLost ? "text-red-500" : "text-muted-foreground"}`}
                  >
                    {stage.label}
                    {isWon && " ✓"}
                    {isLost && " ✗"}
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1.5">
                    {stageDeals.length}
                  </Badge>
                </div>
              </div>

              {/* Column total */}
              {totalCents > 0 && (
                <p className="text-[10px] text-muted-foreground px-1 mb-2 font-medium">
                  {formatCurrency(totalCents)}
                </p>
              )}

              {/* Deal cards */}
              <div className="space-y-2">
                {stageDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    stage={stage.value as DealStageValue}
                    onMove={(toStage) => moveMutation.mutate({ id: deal.id, status: toStage })}
                    onClick={() => onDealClick(deal)}
                  />
                ))}
                {stageDeals.length === 0 && (
                  <div className="text-center py-6 text-xs text-muted-foreground/50 border border-dashed rounded-lg">
                    Empty
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

function DealCard({
  deal,
  stage,
  onMove,
  onClick,
}: {
  deal: BusinessEntityRow;
  stage: DealStageValue;
  onMove: (to: DealStageValue) => void;
  onClick: () => void;
}) {
  const isWon = stage === "won";
  const isLost = stage === "lost";
  const next = nextStage(stage);
  const d = deal.data as Record<string, string>;

  return (
    <Card
      className={`cursor-pointer hover:shadow-sm transition-shadow ${isWon ? "border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-950/20" : isLost ? "opacity-70" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-1">
          <div className="font-semibold text-sm truncate flex-1">{deal.name ?? "—"}</div>
          {isWon && (
            <span className="text-[10px] font-medium text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 rounded-full px-1.5 py-0.5 shrink-0">
              Won ✓
            </span>
          )}
          {isLost && (
            <span className="text-[10px] font-medium text-red-500 bg-red-100 dark:bg-red-900/40 rounded-full px-1.5 py-0.5 shrink-0">
              Lost ✗
            </span>
          )}
        </div>

        {deal.amountCents != null && deal.amountCents > 0 && (
          <div className={`text-sm font-semibold mt-1 ${isWon ? "text-emerald-600" : "text-green-600"}`}>
            {formatCurrency(deal.amountCents)}
          </div>
        )}

        {d.closeDate && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
            <Calendar className="h-3 w-3" />
            {formatDate(d.closeDate)}
          </div>
        )}

        {!isWon && !isLost && (
          <div className="flex items-center gap-1 mt-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {next && (
              <button
                className="text-[10px] text-blue-600 hover:text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors font-medium"
                onClick={() => onMove(next)}
              >
                → {DEAL_STAGES.find((s) => s.value === next)?.label}
              </button>
            )}
            <button
              className="text-[10px] text-emerald-600 hover:text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors font-medium"
              onClick={() => onMove("won")}
            >
              Won ✓
            </button>
            <button
              className="text-[10px] text-red-500 hover:text-red-600 px-1.5 py-0.5 rounded border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors font-medium"
              onClick={() => onMove("lost")}
            >
              Lost ✗
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DealList({
  deals,
  companyId,
  onDealClick,
}: {
  deals: BusinessEntityRow[];
  companyId: string;
  onDealClick: (deal: BusinessEntityRow) => void;
}) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () =>
      q
        ? deals.filter(
            (d) =>
              d.name?.toLowerCase().includes(q.toLowerCase()) ||
              d.status.toLowerCase().includes(q.toLowerCase()),
          )
        : deals,
    [deals, q],
  );

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      businessApi.updateStatus(companyId, "crm", "deal", id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "deal"),
      });
    },
  });

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input
          placeholder="Search deals…"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="border rounded-lg divide-y overflow-hidden">
        {filtered.map((deal) => {
          const d = deal.data as Record<string, string>;
          return (
            <div
              key={deal.id}
              className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 cursor-pointer group"
              onClick={() => onDealClick(deal)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{deal.name ?? "—"}</span>
                  <DealStageBadge status={deal.status} />
                </div>
                {d.closeDate && (
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Close: {formatDate(d.closeDate)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {deal.amountCents != null && deal.amountCents > 0 && (
                  <span className="text-sm font-semibold text-green-600 font-mono">
                    {formatCurrency(deal.amountCents)}
                  </span>
                )}
                <Select
                  value={deal.status}
                  onValueChange={(v) => {
                    moveMutation.mutate({ id: deal.id, status: v });
                  }}
                >
                  <SelectTrigger
                    className="h-7 text-xs w-32"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEAL_STAGES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">No deals match your search.</div>
        )}
      </div>
    </div>
  );
}

function CreateDealDialog({
  open,
  onOpenChange,
  companyId,
  prefillName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  prefillName?: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    amountSAR: "",
    closeDate: "",
    stage: "prospecting",
    contactId: "",
  });

  useEffect(() => {
    if (open && prefillName) {
      setForm((p) => ({ ...p, name: prefillName }));
    }
  }, [open, prefillName]);

  const contactsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "crm", "contact"),
    queryFn: () => businessApi.listEntities(companyId, "crm", "contact"),
    enabled: open,
  });
  const contacts = contactsQuery.data?.entities ?? [];

  const createMutation = useMutation({
    mutationFn: () => {
      const amountCents = form.amountSAR
        ? Math.round(parseFloat(form.amountSAR) * 100)
        : null;
      return businessApi.createEntity(companyId, "crm", "deal", {
        entityType: "deal",
        name: form.name,
        status: form.stage,
        amountCents,
        data: {
          contactId: form.contactId || undefined,
          closeDate: form.closeDate || undefined,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "deal"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
      onOpenChange(false);
      setForm({ name: "", amountSAR: "", closeDate: "", stage: "prospecting", contactId: "" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Deal Name *</Label>
            <Input
              placeholder="e.g. Enterprise Software License"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Amount (SAR)</Label>
              <Input
                type="number"
                min={0}
                placeholder="50000"
                value={form.amountSAR}
                onChange={(e) => setForm((p) => ({ ...p, amountSAR: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Expected Close Date</Label>
              <Input
                type="date"
                value={form.closeDate}
                onChange={(e) => setForm((p) => ({ ...p, closeDate: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Stage</Label>
            <Select value={form.stage} onValueChange={(v) => setForm((p) => ({ ...p, stage: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {contacts.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Contact (optional)</Label>
              <Select
                value={form.contactId}
                onValueChange={(v) => setForm((p) => ({ ...p, contactId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Link a contact…" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {createMutation.error && (
          <p className="text-sm text-destructive mt-1">
            {(createMutation.error as Error).message}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Saving…" : "Create Deal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Deal Detail Dialog
// ---------------------------------------------------------------------------

function DealDetailDialog({
  deal,
  companyId,
  onClose,
  onUpdated,
}: {
  deal: BusinessEntityRow;
  companyId: string;
  onClose: () => void;
  onUpdated: (updated: BusinessEntityRow) => void;
}) {
  const queryClient = useQueryClient();
  const d = deal.data as Record<string, string>;

  const [editName, setEditName] = useState(deal.name ?? "");
  const [editStage, setEditStage] = useState(deal.status);
  const [editAmount, setEditAmount] = useState(
    deal.amountCents != null ? String(deal.amountCents / 100) : "",
  );
  const [editCloseDate, setEditCloseDate] = useState(d.closeDate ?? "");
  const [editNotes, setEditNotes] = useState((deal.data as Record<string, string>).notes ?? "");
  const [dirty, setDirty] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType>("call");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityNotes, setActivityNotes] = useState("");
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [addActivityOpen, setAddActivityOpen] = useState(false);

  const contactsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "crm", "contact"),
    queryFn: () => businessApi.listEntities(companyId, "crm", "contact"),
  });
  const contacts = contactsQuery.data?.entities ?? [];
  const linkedContact = contacts.find((c) => c.id === d.contactId);

  const updateMutation = useMutation({
    mutationFn: () => {
      const amountCents = editAmount ? Math.round(parseFloat(editAmount) * 100) : null;
      return businessApi.updateEntity(companyId, "crm", "deal", deal.id, {
        name: editName,
        status: editStage,
        amountCents,
        data: {
          ...deal.data,
          closeDate: editCloseDate || undefined,
          notes: editNotes || undefined,
        },
      });
    },
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "deal"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
      onUpdated(updated);
      setDirty(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => businessApi.deleteEntity(companyId, "crm", "deal", deal.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "deal"),
      });
      onClose();
    },
  });

  function handleFieldChange<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setDirty(true);
  }

  function addActivity() {
    if (!activityTitle.trim()) return;
    const entry: ActivityEntry = {
      id: Math.random().toString(36).slice(2),
      type: activityType,
      title: activityTitle,
      notes: activityNotes,
      date: new Date().toISOString(),
      dealId: deal.id,
    };
    setActivities((prev) => [entry, ...prev]);
    setActivityTitle("");
    setActivityNotes("");
    setAddActivityOpen(false);
  }

  const stageHistory = useMemo(() => {
    const all = DEAL_STAGES.map((s) => s.value);
    const currentIdx = all.indexOf(deal.status as DealStageValue);
    return DEAL_STAGES.slice(0, currentIdx + 1).map((s) => ({
      ...s,
      reached: true,
    }));
  }, [deal.status]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 pr-6">
            <Input
              className="font-semibold text-base border-0 shadow-none p-0 h-auto focus-visible:ring-0 bg-transparent"
              value={editName}
              onChange={(e) => handleFieldChange(setEditName, e.target.value)}
            />
            <DealStageBadge status={editStage} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Stage history timeline */}
          <div className="flex items-center gap-1 flex-wrap">
            {stageHistory.map((s, i) => (
              <div key={s.value} className="flex items-center gap-1">
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    s.value === deal.status
                      ? s.value === "won"
                        ? "bg-emerald-100 text-emerald-700"
                        : s.value === "lost"
                          ? "bg-red-100 text-red-600"
                          : "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.label}
                </span>
                {i < stageHistory.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>

          <Separator />

          {/* Deal fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> Amount (SAR)
              </Label>
              <Input
                type="number"
                min={0}
                placeholder="0"
                value={editAmount}
                onChange={(e) => handleFieldChange(setEditAmount, e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Expected Close Date
              </Label>
              <Input
                type="date"
                value={editCloseDate}
                onChange={(e) => handleFieldChange(setEditCloseDate, e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Stage</Label>
            <Select
              value={editStage}
              onValueChange={(v) => handleFieldChange(setEditStage, v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Linked contact */}
          {linkedContact && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border">
              <div
                className={`w-9 h-9 rounded-full ${avatarColor(linkedContact.name ?? "")} flex items-center justify-center text-white text-xs font-semibold`}
              >
                {initials(linkedContact.name ?? "?")}
              </div>
              <div>
                <div className="text-sm font-medium">{linkedContact.name}</div>
                {(linkedContact.data as Record<string, string>).email && (
                  <div className="text-xs text-muted-foreground">
                    {(linkedContact.data as Record<string, string>).email}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea
              rows={3}
              placeholder="Deal notes…"
              value={editNotes}
              onChange={(e) => handleFieldChange(setEditNotes, e.target.value)}
            />
          </div>

          {/* Save button */}
          {dirty && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}

          <Separator />

          {/* Activity log */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Clock className="h-4 w-4" /> Activity Log
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setAddActivityOpen(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Log activity
              </Button>
            </div>

            {addActivityOpen && (
              <div className="mb-3 p-3 border rounded-lg space-y-2 bg-muted/30">
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={activityType}
                    onValueChange={(v) => setActivityType(v as ActivityType)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="call">Call</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="meeting">Meeting</SelectItem>
                      <SelectItem value="note">Note</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Title / summary"
                    className="h-8 text-xs"
                    value={activityTitle}
                    onChange={(e) => setActivityTitle(e.target.value)}
                  />
                </div>
                <Textarea
                  rows={2}
                  placeholder="Additional notes…"
                  className="text-xs"
                  value={activityNotes}
                  onChange={(e) => setActivityNotes(e.target.value)}
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setAddActivityOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={addActivity}
                    disabled={!activityTitle.trim()}
                  >
                    Log
                  </Button>
                </div>
              </div>
            )}

            {activities.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No activities logged yet.
              </p>
            )}

            <div className="space-y-2">
              {activities.map((act) => (
                <div key={act.id} className="flex items-start gap-3 p-2.5 rounded-lg border bg-card">
                  <div
                    className={`p-1.5 rounded-md ${ACTIVITY_COLORS[act.type]} flex-shrink-0 mt-0.5`}
                  >
                    {ACTIVITY_ICONS[act.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{act.title}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(act.date)}
                      </span>
                    </div>
                    {act.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5">{act.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {deal.id && (
            <div className="space-y-4 mt-6">
              <AIBrainPanel
                companyId={companyId}
                moduleKey="crm"
                entityType="deal"
                entityId={deal.id}
              />
              <AttachmentList entityId={deal.id} companyId={companyId} />
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => {
              if (confirm("Delete this deal?")) deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Delete deal
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Activities Tab
// ---------------------------------------------------------------------------

function ActivitiesTab({ companyId }: { companyId: string }) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [type, setType] = useState<ActivityType>("call");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterType, setFilterType] = useState<ActivityType | "all">("all");

  const dealsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "crm", "deal"),
    queryFn: () => businessApi.listEntities(companyId, "crm", "deal"),
  });

  const contactsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "crm", "contact"),
    queryFn: () => businessApi.listEntities(companyId, "crm", "contact"),
  });

  const [dealId, setDealId] = useState("");
  const [contactId, setContactId] = useState("");

  const deals = dealsQuery.data?.entities ?? [];
  const contacts = contactsQuery.data?.entities ?? [];

  function logActivity() {
    if (!title.trim()) return;
    const entry: ActivityEntry = {
      id: Math.random().toString(36).slice(2),
      type,
      title,
      notes,
      date: new Date().toISOString(),
      dealId: dealId || undefined,
      contactId: contactId || undefined,
    };
    setActivities((prev) => [entry, ...prev]);
    setTitle("");
    setNotes("");
    setDealId("");
    setContactId("");
    setCreateOpen(false);
  }

  const filtered =
    filterType === "all" ? activities : activities.filter((a) => a.type === filterType);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", "call", "email", "meeting", "note"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                filterType === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Log activity
        </Button>
      </div>

      {createOpen && (
        <div className="p-4 border rounded-lg space-y-3 bg-muted/20">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ActivityType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Title *</Label>
              <Input
                placeholder="Activity summary"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          {deals.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Related deal (optional)</Label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select deal…" />
                </SelectTrigger>
                <SelectContent>
                  {deals.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {contacts.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Related contact (optional)</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select contact…" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={3}
              placeholder="Details about this activity…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={logActivity} disabled={!title.trim()}>
              Log activity
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <EmptyState
          icon={Clock}
          message={
            filterType === "all"
              ? "No activities logged yet. Log calls, emails, and meetings to track engagement."
              : `No ${filterType} activities logged yet.`
          }
          action="Log activity"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((act) => {
            const relatedDeal = deals.find((d) => d.id === act.dealId);
            const relatedContact = contacts.find((c) => c.id === act.contactId);
            return (
              <div
                key={act.id}
                className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
              >
                <div
                  className={`p-2 rounded-lg ${ACTIVITY_COLORS[act.type]} flex-shrink-0 mt-0.5`}
                >
                  {ACTIVITY_ICONS[act.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm">{act.title}</div>
                      {act.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {act.notes}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDate(act.date)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${ACTIVITY_COLORS[act.type]}`}
                    >
                      {ACTIVITY_ICONS[act.type]}
                      {act.type.charAt(0).toUpperCase() + act.type.slice(1)}
                    </span>
                    {relatedDeal && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 bg-muted px-2 py-0.5 rounded-full">
                        <Target className="h-3 w-3" />
                        {relatedDeal.name}
                      </span>
                    )}
                    {relatedContact && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 bg-muted px-2 py-0.5 rounded-full">
                        <Users className="h-3 w-3" />
                        {relatedContact.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function BusinessCRMPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState("contacts");
  const [convertedLeadName, setConvertedLeadName] = useState<string | null>(null);
  const [createDealOpen, setCreateDealOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Business", href: "/business" }, { label: "CRM" }]);
  }, [setBreadcrumbs]);

  const dealsQuery = useQuery({
    queryKey: queryKeys.business.entities(selectedCompanyId!, "crm", "deal"),
    queryFn: () => businessApi.listEntities(selectedCompanyId!, "crm", "deal"),
    enabled: !!selectedCompanyId,
  });

  const contactsQuery = useQuery({
    queryKey: queryKeys.business.entities(selectedCompanyId!, "crm", "contact"),
    queryFn: () => businessApi.listEntities(selectedCompanyId!, "crm", "contact"),
    enabled: !!selectedCompanyId,
  });

  const leadsQuery = useQuery({
    queryKey: queryKeys.business.entities(selectedCompanyId!, "crm", "lead"),
    queryFn: () => businessApi.listEntities(selectedCompanyId!, "crm", "lead"),
    enabled: !!selectedCompanyId,
  });

  const deals = dealsQuery.data?.entities ?? [];
  const contacts = contactsQuery.data?.entities ?? [];
  const leads = leadsQuery.data?.entities ?? [];

  const openLeads = leads.filter((l) => l.status !== "converted").length;

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a workspace to view CRM." />;
  }

  function handleLeadConverted(leadName: string) {
    setConvertedLeadName(leadName);
    setCreateDealOpen(true);
    setActiveTab("pipeline");
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6 text-muted-foreground" />
            CRM
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Contacts, leads and deals pipeline
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Quick stats */}
          <div className="hidden sm:flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-4 w-4" />
              <span className="font-medium text-foreground">{contacts.length}</span>
              <span>contacts</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <UserPlus className="h-4 w-4" />
              <span className="font-medium text-foreground">{openLeads}</span>
              <span>leads</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Target className="h-4 w-4" />
              <span className="font-medium text-foreground">{deals.filter((d) => !["won", "lost"].includes(d.status)).length}</span>
              <span>active deals</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="contacts" className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            Contacts
            {contacts.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 ml-0.5">
                {contacts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="leads" className="flex items-center gap-1.5">
            <UserPlus className="h-4 w-4" />
            Leads
            {openLeads > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 ml-0.5">
                {openLeads}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="flex items-center gap-1.5">
            <Target className="h-4 w-4" />
            Pipeline
            {deals.filter((d) => !["won", "lost"].includes(d.status)).length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 ml-0.5">
                {deals.filter((d) => !["won", "lost"].includes(d.status)).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="activities" className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            Activities
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="mt-4">
          <ContactsTab companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="leads" className="mt-4">
          <LeadsTab companyId={selectedCompanyId} onLeadConverted={handleLeadConverted} />
        </TabsContent>

        <TabsContent value="pipeline" className="mt-4">
          <PipelineTab companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="activities" className="mt-4">
          <ActivitiesTab companyId={selectedCompanyId} />
        </TabsContent>
      </Tabs>

      {/* Create deal dialog triggered by lead conversion */}
      {createDealOpen && (
        <CreateDealDialog
          open={createDealOpen}
          onOpenChange={(v) => {
            setCreateDealOpen(v);
            if (!v) setConvertedLeadName(null);
          }}
          companyId={selectedCompanyId}
          prefillName={convertedLeadName ?? undefined}
        />
      )}
    </div>
  );
}
