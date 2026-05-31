import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Send, Users, Mail, GitBranch } from "lucide-react";
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
import { marketingApi, type CampaignRow } from "../api/marketing";

const TABS = [
  { key: "campaigns", label: "Campaigns", icon: Send },
  { key: "audiences", label: "Audiences", icon: Users },
  { key: "templates", label: "Email Templates", icon: Mail },
  { key: "journeys", label: "Journeys", icon: GitBranch },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Click-through rate as a percentage of clicks over sent. */
function ctr(campaign: CampaignRow): number {
  if (campaign.sentCount <= 0) return 0;
  return Math.round((campaign.clickCount / campaign.sentCount) * 100);
}

export function Marketing() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<TabKey>("campaigns");

  useEffect(() => {
    setBreadcrumbs([{ label: "Marketing" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Megaphone}
        message="Select a workspace to manage marketing."
      />
    );
  }

  return (
    <div className="space-y-6" dir="auto">
      <div>
        <h1 className="text-2xl font-semibold">Marketing</h1>
        <p className="text-sm text-muted-foreground">
          Manage campaigns, audiences, email templates, and journeys.
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

      {tab === "campaigns" && <CampaignsTab companyId={selectedCompanyId} />}
      {tab === "audiences" && <AudiencesTab companyId={selectedCompanyId} />}
      {tab === "templates" && <TemplatesTab companyId={selectedCompanyId} />}
      {tab === "journeys" && <JourneysTab companyId={selectedCompanyId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaigns tab
// ---------------------------------------------------------------------------
function CampaignsTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("email");

  const campaignsQuery = useQuery({
    queryKey: ["marketing", "campaigns", companyId],
    queryFn: () => marketingApi.listCampaigns(companyId),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["marketing", "campaigns", companyId],
    });

  const createMutation = useMutation({
    mutationFn: () =>
      marketingApi.createCampaign(companyId, {
        name: name.trim(),
        channel,
      }),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setName("");
      setChannel("email");
      pushToast({ title: "Campaign created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create campaign",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => marketingApi.sendCampaign(companyId, id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Campaign sent", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to send campaign",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (campaignsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (campaignsQuery.isError) {
    return (
      <EmptyState
        icon={Send}
        message={
          (campaignsQuery.error as Error)?.message ??
          "Failed to load campaigns."
        }
      />
    );
  }

  const campaigns = campaignsQuery.data?.campaigns ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Send className="me-1.5 h-4 w-4" />
          New campaign
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState icon={Send} message="No campaigns yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Name</th>
                  <th className="text-start font-medium px-4 py-2">Channel</th>
                  <th className="text-end font-medium px-4 py-2">Sent</th>
                  <th className="text-end font-medium px-4 py-2">CTR</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                  <th className="text-end font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium">{c.name}</td>
                    <td className="px-4 py-2 capitalize">{c.channel}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {c.sentCount}
                    </td>
                    <td className="px-4 py-2 text-end font-mono">{ctr(c)}%</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-2 text-end whitespace-nowrap">
                      {c.status !== "sent" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={sendMutation.isPending}
                          onClick={() => sendMutation.mutate(c.id)}
                        >
                          Send
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
            <DialogTitle>New campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-name">Name</Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Spring sale"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-channel">Channel</Label>
              <select
                id="campaign-channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="social">Social</option>
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
              disabled={!name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audiences tab
// ---------------------------------------------------------------------------
function AudiencesTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [memberCount, setMemberCount] = useState("0");

  const audiencesQuery = useQuery({
    queryKey: ["marketing", "audiences", companyId],
    queryFn: () => marketingApi.listAudiences(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      marketingApi.createAudience(companyId, {
        name: name.trim(),
        memberCount: Number(memberCount) || 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["marketing", "audiences", companyId],
      });
      setDialogOpen(false);
      setName("");
      setMemberCount("0");
      pushToast({ title: "Audience created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create audience",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (audiencesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (audiencesQuery.isError) {
    return (
      <EmptyState
        icon={Users}
        message={
          (audiencesQuery.error as Error)?.message ??
          "Failed to load audiences."
        }
      />
    );
  }

  const audiences = audiencesQuery.data?.audiences ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Users className="me-1.5 h-4 w-4" />
          New audience
        </Button>
      </div>

      {audiences.length === 0 ? (
        <EmptyState icon={Users} message="No audiences yet." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {audiences.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-4">
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {a.description ?? "—"}
                </div>
                <div className="text-lg font-semibold mt-2 font-mono">
                  {a.memberCount.toLocaleString()} members
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New audience</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="audience-name">Name</Label>
              <Input
                id="audience-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audience-members">Member count</Label>
              <Input
                id="audience-members"
                type="number"
                min={0}
                value={memberCount}
                onChange={(e) => setMemberCount(e.target.value)}
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
              {createMutation.isPending ? "Creating…" : "Create audience"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Email templates tab
// ---------------------------------------------------------------------------
function TemplatesTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");

  const templatesQuery = useQuery({
    queryKey: ["marketing", "email-templates", companyId],
    queryFn: () => marketingApi.listEmailTemplates(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      marketingApi.createEmailTemplate(companyId, {
        name: name.trim(),
        subject: subject.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["marketing", "email-templates", companyId],
      });
      setDialogOpen(false);
      setName("");
      setSubject("");
      pushToast({ title: "Template created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create template",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (templatesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (templatesQuery.isError) {
    return (
      <EmptyState
        icon={Mail}
        message={
          (templatesQuery.error as Error)?.message ??
          "Failed to load templates."
        }
      />
    );
  }

  const templates = templatesQuery.data?.emailTemplates ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Mail className="me-1.5 h-4 w-4" />
          New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState icon={Mail} message="No email templates yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Name</th>
                  <th className="text-start font-medium px-4 py-2">Subject</th>
                  <th className="text-start font-medium px-4 py-2">Kind</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium">{t.name}</td>
                    <td className="px-4 py-2">{t.subject ?? "—"}</td>
                    <td className="px-4 py-2 capitalize">{t.kind}</td>
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
            <DialogTitle>New email template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-subject">Subject</Label>
              <Input
                id="template-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
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
              {createMutation.isPending ? "Creating…" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journeys tab
// ---------------------------------------------------------------------------
function JourneysTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");

  const journeysQuery = useQuery({
    queryKey: ["marketing", "journeys", companyId],
    queryFn: () => marketingApi.listJourneys(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      marketingApi.createJourney(companyId, {
        name: name.trim(),
        trigger: trigger.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["marketing", "journeys", companyId],
      });
      setDialogOpen(false);
      setName("");
      setTrigger("");
      pushToast({ title: "Journey created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create journey",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (journeysQuery.isLoading) return <PageSkeleton variant="list" />;
  if (journeysQuery.isError) {
    return (
      <EmptyState
        icon={GitBranch}
        message={
          (journeysQuery.error as Error)?.message ?? "Failed to load journeys."
        }
      />
    );
  }

  const journeys = journeysQuery.data?.journeys ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <GitBranch className="me-1.5 h-4 w-4" />
          New journey
        </Button>
      </div>

      {journeys.length === 0 ? (
        <EmptyState icon={GitBranch} message="No journeys yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Name</th>
                  <th className="text-start font-medium px-4 py-2">Trigger</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {journeys.map((j) => (
                  <tr key={j.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium">{j.name}</td>
                    <td className="px-4 py-2">{j.trigger ?? "—"}</td>
                    <td className="px-4 py-2">
                      {j.enabled ? (
                        <span className="text-emerald-500 text-xs">Enabled</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          Disabled
                        </span>
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
            <DialogTitle>New journey</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="journey-name">Name</Label>
              <Input
                id="journey-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="journey-trigger">Trigger</Label>
              <Input
                id="journey-trigger"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                placeholder="signup, purchase, …"
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
              {createMutation.isPending ? "Creating…" : "Create journey"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "sent"
      ? "text-emerald-500"
      : status === "paused"
        ? "text-red-500"
        : status === "scheduled" || status === "sending"
          ? "text-sky-500"
          : "text-amber-500";
  return <span className={`text-xs capitalize ${tone}`}>{status}</span>;
}
