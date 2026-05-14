import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Megaphone,
  Mail,
  MessageSquare,
  Share2,
  Target,
  Users,
  BarChart3,
  Plus,
  Trash2,
  ArrowLeft,
  DollarSign,
  TrendingUp,
  Activity,
  Send,
  Sparkles,
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CampaignChannel = "email" | "sms" | "social" | "ads";
type CampaignStatus = "draft" | "active" | "paused" | "completed";

interface CampaignData {
  channel?: CampaignChannel;
  reach?: number;
  description?: string;
}

interface AudienceData {
  contactCount?: number;
  segment?: string;
}

interface EmailSequenceStep {
  subject: string;
  dayOffset: number;
  body?: string;
}

interface EmailSequenceData {
  steps?: EmailSequenceStep[];
  description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSar(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("en-SA", {
    style: "currency",
    currency: "SAR",
  });
}

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

function getCampaignData(c: BusinessEntityRow): CampaignData {
  return c.data as CampaignData;
}
function getAudienceData(a: BusinessEntityRow): AudienceData {
  return a.data as AudienceData;
}
function getSequenceData(s: BusinessEntityRow): EmailSequenceData {
  return s.data as EmailSequenceData;
}

// ---------------------------------------------------------------------------
// Channel + Status badges
// ---------------------------------------------------------------------------

const CHANNEL_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  email: {
    label: "Email",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    icon: <Mail className="h-3 w-3" />,
  },
  sms: {
    label: "SMS",
    color:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    icon: <MessageSquare className="h-3 w-3" />,
  },
  social: {
    label: "Social",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
    icon: <Share2 className="h-3 w-3" />,
  },
  ads: {
    label: "Ads",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    icon: <Target className="h-3 w-3" />,
  },
};

function ChannelBadge({ channel }: { channel: string }) {
  const cfg = CHANNEL_CONFIG[channel] ?? CHANNEL_CONFIG["email"]!;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: {
    label: "Draft",
    color: "bg-muted text-muted-foreground",
  },
  active: {
    label: "Active",
    color:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  },
  paused: {
    label: "Paused",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["draft"]!;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Campaign Card
// ---------------------------------------------------------------------------

function CampaignCard({
  campaign,
  onClick,
}: {
  campaign: BusinessEntityRow;
  onClick: () => void;
}) {
  const data = getCampaignData(campaign);
  const channel = data.channel ?? "email";
  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug line-clamp-2 flex-1">
            {campaign.name ?? "Untitled campaign"}
          </p>
          <StatusBadge status={campaign.status} />
        </div>
        <ChannelBadge channel={channel} />
        <div className="grid grid-cols-2 gap-2 pt-1 border-t">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Budget
            </p>
            <p className="text-sm font-medium tabular-nums">
              {formatSar(campaign.amountCents)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Reach
            </p>
            <p className="text-sm font-medium tabular-nums">
              {(data.reach ?? 0).toLocaleString()}
            </p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          {timeAgo(campaign.createdAt)}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create/Edit Campaign Dialog
// ---------------------------------------------------------------------------

function CampaignDialog({
  open,
  onOpenChange,
  companyId,
  campaign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  campaign?: BusinessEntityRow | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!campaign;

  const [name, setName] = useState("");
  const [channel, setChannel] = useState<CampaignChannel>("email");
  const [budget, setBudget] = useState("");
  const [status, setStatus] = useState<CampaignStatus>("draft");
  const [reach, setReach] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      if (campaign) {
        const d = getCampaignData(campaign);
        setName(campaign.name ?? "");
        setChannel(d.channel ?? "email");
        setBudget(
          campaign.amountCents != null
            ? String(campaign.amountCents / 100)
            : "",
        );
        setStatus((campaign.status as CampaignStatus) ?? "draft");
        setReach(d.reach != null ? String(d.reach) : "");
        setDescription(d.description ?? "");
      } else {
        setName("");
        setChannel("email");
        setBudget("");
        setStatus("draft");
        setReach("");
        setDescription("");
      }
    }
  }, [open, campaign]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const amountCents = budget ? Math.round(parseFloat(budget) * 100) : null;
      const data: Record<string, unknown> = {
        channel,
        reach: reach ? Number(reach) : 0,
        description,
      };
      const body: Partial<BusinessEntityRow> & { entityType: string } = {
        entityType: "campaign",
        name,
        status,
        amountCents,
        currency: "SAR",
        data,
      };
      if (isEdit && campaign) {
        return businessApi.updateEntity(
          companyId,
          "marketing",
          "campaign",
          campaign.id,
          body,
        );
      }
      return businessApi.createEntity(companyId, "marketing", "campaign", body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "marketing", "campaign"),
      });
      onOpenChange(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      businessApi.deleteEntity(companyId, "marketing", "campaign", campaign!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "marketing", "campaign"),
      });
      onOpenChange(false);
    },
  });

  function handleSubmit() {
    if (!name.trim()) return;
    saveMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Campaign" : "New Campaign"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="c-name" className="text-xs">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="c-name"
              placeholder="e.g. Summer launch"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Channel</Label>
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as CampaignChannel)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="social">Social</SelectItem>
                  <SelectItem value="ads">Ads</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as CampaignStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-budget" className="text-xs">
                Budget (SAR)
              </Label>
              <Input
                id="c-budget"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-reach" className="text-xs">
                Reach
              </Label>
              <Input
                id="c-reach"
                type="number"
                placeholder="0"
                value={reach}
                onChange={(e) => setReach(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-desc" className="text-xs">
              Description
            </Label>
            <Textarea
              id="c-desc"
              rows={3}
              placeholder="Optional notes…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="flex flex-row items-center justify-between sm:justify-between">
          {isEdit ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!name.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
        {saveMutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(saveMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Audience Dialog
// ---------------------------------------------------------------------------

function AudienceDialog({
  open,
  onOpenChange,
  companyId,
  audience,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  audience?: BusinessEntityRow | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!audience;
  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [contactCount, setContactCount] = useState("");

  useEffect(() => {
    if (open) {
      if (audience) {
        const d = getAudienceData(audience);
        setName(audience.name ?? "");
        setSegment(d.segment ?? "");
        setContactCount(d.contactCount != null ? String(d.contactCount) : "");
      } else {
        setName("");
        setSegment("");
        setContactCount("");
      }
    }
  }, [open, audience]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {
        segment,
        contactCount: contactCount ? Number(contactCount) : 0,
      };
      const body: Partial<BusinessEntityRow> & { entityType: string } = {
        entityType: "audience",
        name,
        status: "active",
        data,
      };
      if (isEdit && audience) {
        return businessApi.updateEntity(
          companyId,
          "marketing",
          "audience",
          audience.id,
          body,
        );
      }
      return businessApi.createEntity(companyId, "marketing", "audience", body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "marketing", "audience"),
      });
      onOpenChange(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      businessApi.deleteEntity(companyId, "marketing", "audience", audience!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "marketing", "audience"),
      });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Audience" : "New Audience"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="a-name" className="text-xs">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="a-name"
              placeholder="e.g. VIP customers"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-count" className="text-xs">
              Contact count
            </Label>
            <Input
              id="a-count"
              type="number"
              placeholder="0"
              value={contactCount}
              onChange={(e) => setContactCount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-segment" className="text-xs">
              Segment criteria
            </Label>
            <Textarea
              id="a-segment"
              rows={4}
              placeholder="Describe who belongs to this segment…"
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="flex flex-row items-center justify-between sm:justify-between">
          {isEdit ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!name.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
        {saveMutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(saveMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sequence Dialog
// ---------------------------------------------------------------------------

function SequenceDialog({
  open,
  onOpenChange,
  companyId,
  sequence,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  sequence?: BusinessEntityRow | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!sequence;
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<EmailSequenceStep[]>([
    { subject: "", dayOffset: 0 },
  ]);

  useEffect(() => {
    if (open) {
      if (sequence) {
        const d = getSequenceData(sequence);
        setName(sequence.name ?? "");
        setSteps(
          d.steps && d.steps.length > 0
            ? d.steps
            : [{ subject: "", dayOffset: 0 }],
        );
      } else {
        setName("");
        setSteps([{ subject: "", dayOffset: 0 }]);
      }
    }
  }, [open, sequence]);

  function updateStep(index: number, patch: Partial<EmailSequenceStep>) {
    setSteps((curr) =>
      curr.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  }

  function removeStep(index: number) {
    setSteps((curr) => curr.filter((_, i) => i !== index));
  }

  function addStep() {
    setSteps((curr) => [
      ...curr,
      {
        subject: "",
        dayOffset:
          curr.length > 0 ? (curr[curr.length - 1]?.dayOffset ?? 0) + 1 : 0,
      },
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {
        steps: steps.filter((s) => s.subject.trim()),
      };
      const body: Partial<BusinessEntityRow> & { entityType: string } = {
        entityType: "email_sequence",
        name,
        status: "active",
        data,
      };
      if (isEdit && sequence) {
        return businessApi.updateEntity(
          companyId,
          "marketing",
          "email_sequence",
          sequence.id,
          body,
        );
      }
      return businessApi.createEntity(
        companyId,
        "marketing",
        "email_sequence",
        body,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(
          companyId,
          "marketing",
          "email_sequence",
        ),
      });
      onOpenChange(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      businessApi.deleteEntity(
        companyId,
        "marketing",
        "email_sequence",
        sequence!.id,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(
          companyId,
          "marketing",
          "email_sequence",
        ),
      });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Email Sequence" : "New Email Sequence"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="s-name" className="text-xs">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="s-name"
              placeholder="e.g. Welcome series"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Steps</Label>
              <Button variant="outline" size="sm" onClick={addStep}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add step
              </Button>
            </div>
            <div className="space-y-2">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[80px_1fr_36px] gap-2 items-center"
                >
                  <Input
                    type="number"
                    placeholder="Day"
                    value={String(step.dayOffset)}
                    onChange={(e) =>
                      updateStep(idx, { dayOffset: Number(e.target.value) })
                    }
                  />
                  <Input
                    placeholder="Subject line"
                    value={step.subject}
                    onChange={(e) =>
                      updateStep(idx, { subject: e.target.value })
                    }
                  />
                  <button
                    className="p-2 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                    onClick={() => removeStep(idx)}
                    disabled={steps.length === 1}
                    title="Remove step"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="flex flex-row items-center justify-between sm:justify-between">
          {isEdit ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!name.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
        {saveMutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(saveMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Performance Tab
// ---------------------------------------------------------------------------

function PerformanceTab({ campaigns }: { campaigns: BusinessEntityRow[] }) {
  const total = campaigns.length;
  const activeCount = campaigns.filter((c) => c.status === "active").length;
  const totalBudget = campaigns.reduce(
    (sum, c) => sum + (c.amountCents ?? 0),
    0,
  );
  const totalReach = campaigns.reduce(
    (sum, c) => sum + (getCampaignData(c).reach ?? 0),
    0,
  );

  const byChannel = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of campaigns) {
      const ch = getCampaignData(c).channel ?? "email";
      map.set(ch, (map.get(ch) ?? 0) + 1);
    }
    return map;
  }, [campaigns]);

  const maxChannelCount = Math.max(1, ...Array.from(byChannel.values()));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <Megaphone className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Total campaigns</p>
              <p className="text-lg font-bold tabular-nums">{total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <Activity className="h-4 w-4 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-lg font-bold tabular-nums text-emerald-600">
                {activeCount}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <DollarSign className="h-4 w-4 text-amber-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Total budget</p>
              <p className="text-lg font-bold tabular-nums">
                {formatSar(totalBudget)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Total reach</p>
              <p className="text-lg font-bold tabular-nums">
                {totalReach.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Campaigns by channel</h3>
          </div>
          {total === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No campaigns yet.
            </p>
          ) : (
            <div className="space-y-3">
              {(["email", "sms", "social", "ads"] as const).map((ch) => {
                const count = byChannel.get(ch) ?? 0;
                const pct = (count / maxChannelCount) * 100;
                return (
                  <div key={ch} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <ChannelBadge channel={ch} />
                      <span className="tabular-nums font-medium">{count}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sequence detail panel
// ---------------------------------------------------------------------------

function SequenceDetail({
  sequence,
  onBack,
  onEdit,
}: {
  sequence: BusinessEntityRow;
  onBack: () => void;
  onEdit: () => void;
}) {
  const data = getSequenceData(sequence);
  const steps = data.steps ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back
        </Button>
        <h2 className="text-lg font-semibold">
          {sequence.name ?? "Untitled sequence"}
        </h2>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {steps.length} step{steps.length === 1 ? "" : "s"} · Updated{" "}
        {timeAgo(sequence.updatedAt)}
      </p>
      {steps.length === 0 ? (
        <EmptyState icon={Send} message="No steps in this sequence yet." />
      ) : (
        <div className="space-y-2">
          {steps.map((step, idx) => (
            <Card key={idx}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-shrink-0 w-16">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Day
                  </p>
                  <p className="text-xl font-bold tabular-nums">
                    {step.dayOffset}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {step.subject || "(no subject)"}
                  </p>
                </div>
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function BusinessMarketingPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  const [activeTab, setActiveTab] = useState("campaigns");
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] =
    useState<BusinessEntityRow | null>(null);
  const [audienceDialogOpen, setAudienceDialogOpen] = useState(false);
  const [editingAudience, setEditingAudience] =
    useState<BusinessEntityRow | null>(null);
  const [sequenceDialogOpen, setSequenceDialogOpen] = useState(false);
  const [editingSequence, setEditingSequence] =
    useState<BusinessEntityRow | null>(null);
  const [selectedSequence, setSelectedSequence] =
    useState<BusinessEntityRow | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Marketing" },
    ]);
  }, [setBreadcrumbs]);

  const campaignsQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      "marketing",
      "campaign",
    ),
    queryFn: () =>
      businessApi.listEntities(selectedCompanyId!, "marketing", "campaign"),
    enabled: !!selectedCompanyId,
  });

  const audiencesQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      "marketing",
      "audience",
    ),
    queryFn: () =>
      businessApi.listEntities(selectedCompanyId!, "marketing", "audience"),
    enabled: !!selectedCompanyId,
  });

  const sequencesQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      "marketing",
      "email_sequence",
    ),
    queryFn: () =>
      businessApi.listEntities(
        selectedCompanyId!,
        "marketing",
        "email_sequence",
      ),
    enabled: !!selectedCompanyId,
  });

  const companyId = selectedCompanyId;

  if (!companyId) {
    return <EmptyState icon={Megaphone} message="Select a workspace first." />;
  }

  if (
    campaignsQuery.isLoading ||
    audiencesQuery.isLoading ||
    sequencesQuery.isLoading
  ) {
    return <PageSkeleton variant="list" />;
  }

  const campaigns = campaignsQuery.data?.entities ?? [];
  const audiences = audiencesQuery.data?.entities ?? [];
  const sequences = sequencesQuery.data?.entities ?? [];

  if (selectedSequence && activeTab === "sequences") {
    const fresh =
      sequences.find((s) => s.id === selectedSequence.id) ?? selectedSequence;
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Marketing</h1>
        </div>
        <SequenceDetail
          sequence={fresh}
          onBack={() => setSelectedSequence(null)}
          onEdit={() => {
            setEditingSequence(fresh);
            setSequenceDialogOpen(true);
          }}
        />
        <SequenceDialog
          open={sequenceDialogOpen}
          onOpenChange={(o) => {
            setSequenceDialogOpen(o);
            if (!o) setEditingSequence(null);
          }}
          companyId={companyId}
          sequence={editingSequence}
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
            <Megaphone className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Marketing</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Run campaigns, manage audiences, and automate outreach
          </p>
        </div>
        {activeTab === "campaigns" && (
          <Button
            size="sm"
            onClick={() => {
              setEditingCampaign(null);
              setCampaignDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Campaign
          </Button>
        )}
        {activeTab === "audiences" && (
          <Button
            size="sm"
            onClick={() => {
              setEditingAudience(null);
              setAudienceDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Audience
          </Button>
        )}
        {activeTab === "sequences" && (
          <Button
            size="sm"
            onClick={() => {
              setEditingSequence(null);
              setSequenceDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Sequence
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="campaigns">
            <Megaphone className="h-4 w-4 mr-1.5" />
            Campaigns
          </TabsTrigger>
          <TabsTrigger value="audiences">
            <Users className="h-4 w-4 mr-1.5" />
            Audiences
          </TabsTrigger>
          <TabsTrigger value="sequences">
            <Send className="h-4 w-4 mr-1.5" />
            Email Sequences
          </TabsTrigger>
          <TabsTrigger value="performance">
            <BarChart3 className="h-4 w-4 mr-1.5" />
            Performance
          </TabsTrigger>
        </TabsList>

        {/* Campaigns */}
        <TabsContent value="campaigns" className="mt-4">
          {campaigns.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              message="No campaigns yet. Create your first campaign to start engaging customers."
              action="New Campaign"
              onAction={() => {
                setEditingCampaign(null);
                setCampaignDialogOpen(true);
              }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {campaigns.map((c) => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  onClick={() => {
                    setEditingCampaign(c);
                    setCampaignDialogOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Audiences */}
        <TabsContent value="audiences" className="mt-4">
          {audiences.length === 0 ? (
            <EmptyState
              icon={Users}
              message="No audiences defined yet."
              action="New Audience"
              onAction={() => {
                setEditingAudience(null);
                setAudienceDialogOpen(true);
              }}
            />
          ) : (
            <div className="border rounded-lg divide-y overflow-hidden">
              {audiences.map((a) => {
                const d = getAudienceData(a);
                return (
                  <button
                    key={a.id}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 text-left transition-colors"
                    onClick={() => {
                      setEditingAudience(a);
                      setAudienceDialogOpen(true);
                    }}
                  >
                    <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {a.name ?? "Untitled audience"}
                      </p>
                      {d.segment && (
                        <p className="text-xs text-muted-foreground truncate">
                          {d.segment}
                        </p>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {(d.contactCount ?? 0).toLocaleString()} contacts
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Sequences */}
        <TabsContent value="sequences" className="mt-4">
          {sequences.length === 0 ? (
            <EmptyState
              icon={Send}
              message="No email sequences yet. Build automated drip campaigns to nurture leads."
              action="New Sequence"
              onAction={() => {
                setEditingSequence(null);
                setSequenceDialogOpen(true);
              }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sequences.map((s) => {
                const d = getSequenceData(s);
                const stepCount = d.steps?.length ?? 0;
                return (
                  <Card
                    key={s.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setSelectedSequence(s)}
                  >
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {s.name ?? "Untitled sequence"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {stepCount} step{stepCount === 1 ? "" : "s"} ·{" "}
                          {timeAgo(s.updatedAt)}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Performance */}
        <TabsContent value="performance" className="mt-4">
          <PerformanceTab campaigns={campaigns} />
        </TabsContent>
      </Tabs>

      <CampaignDialog
        open={campaignDialogOpen}
        onOpenChange={(o) => {
          setCampaignDialogOpen(o);
          if (!o) setEditingCampaign(null);
        }}
        companyId={companyId}
        campaign={editingCampaign}
      />
      <AudienceDialog
        open={audienceDialogOpen}
        onOpenChange={(o) => {
          setAudienceDialogOpen(o);
          if (!o) setEditingAudience(null);
        }}
        companyId={companyId}
        audience={editingAudience}
      />
      <SequenceDialog
        open={sequenceDialogOpen}
        onOpenChange={(o) => {
          setSequenceDialogOpen(o);
          if (!o) setEditingSequence(null);
        }}
        companyId={companyId}
        sequence={editingSequence}
      />
    </div>
  );
}
