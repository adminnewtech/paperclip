import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  RefreshCw,
  Send,
  Settings,
  XCircle,
  ListChecks,
  Copy,
  Link as LinkIcon,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  businessHermesApi,
  type HermesTask,
  type RegisteredHermesAgent,
} from "../api/business-hermes";
import type { HermesAgentInfo } from "@paperclipai/shared";

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "—";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusPill({ value }: { value: string }) {
  const map: Record<string, string> = {
    completed:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    in_progress:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    pending: "bg-muted text-muted-foreground",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    cancelled: "bg-muted text-muted-foreground",
    active:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    idle: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    busy: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    offline: "bg-muted text-muted-foreground",
  };
  const cls = map[value] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

interface AgentCardProps {
  info: HermesAgentInfo;
  isRegistered: boolean;
  onRegister?: () => void;
  onUnregister?: () => void;
  loading?: boolean;
}

function AgentCard({
  info,
  isRegistered,
  onRegister,
  onUnregister,
  loading,
}: AgentCardProps) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="text-2xl leading-none">{info.avatar ?? "🤖"}</div>
            <div>
              <p className="text-sm font-semibold leading-tight">{info.name}</p>
              {info.nameAr && (
                <p
                  className="text-xs text-muted-foreground leading-tight"
                  dir="rtl"
                >
                  {info.nameAr}
                </p>
              )}
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                {info.id}
              </p>
            </div>
          </div>
          <StatusPill value={info.status} />
        </div>
        {info.description && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {info.description}
          </p>
        )}
        {info.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {info.capabilities.map((cap) => (
              <Badge
                key={cap}
                variant="outline"
                className="text-[10px] font-mono"
              >
                {cap}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          {info.modelTier && (
            <span className="text-[10px] text-muted-foreground">
              {info.modelTier}
            </span>
          )}
          {isRegistered ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onUnregister}
              disabled={loading}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Unregister
            </Button>
          ) : (
            <Button size="sm" onClick={onRegister} disabled={loading}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Register
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface DelegateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registered: RegisteredHermesAgent[];
  onSubmit: (input: {
    hermesAgentId: string;
    prompt: string;
    callbackChannel?: string;
  }) => void;
  pending: boolean;
}

function DelegateDialog({
  open,
  onOpenChange,
  registered,
  onSubmit,
  pending,
}: DelegateDialogProps) {
  const [agentId, setAgentId] = useState(registered[0]?.hermesAgentId ?? "");
  const [prompt, setPrompt] = useState("");
  const [channel, setChannel] = useState("ai-team");

  useEffect(() => {
    if (open && !agentId && registered[0]) {
      setAgentId(registered[0].hermesAgentId);
    }
  }, [open, agentId, registered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delegate to Hermes agent</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label htmlFor="hermes-agent">Agent</Label>
            <select
              id="hermes-agent"
              className="w-full rounded border bg-background px-2 py-1 text-sm"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              {registered.map((r) => (
                <option key={r.id} value={r.hermesAgentId}>
                  {r.info.name} ({r.hermesAgentId})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hermes-prompt">Prompt</Label>
            <textarea
              id="hermes-prompt"
              className="w-full rounded border bg-background px-2 py-1 text-sm min-h-[120px]"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the task you want the Hermes agent to perform…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hermes-channel">Callback channel</Label>
            <Input
              id="hermes-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="e.g. ai-team"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!agentId || !prompt.trim() || pending}
            onClick={() =>
              onSubmit({
                hermesAgentId: agentId,
                prompt: prompt.trim(),
                callbackChannel: channel.trim() || undefined,
              })
            }
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Delegate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BusinessHermesPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("status");
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Hermes" },
    ]);
  }, [setBreadcrumbs]);

  const statusQuery = useQuery({
    queryKey: ["hermes-status", selectedCompanyId],
    queryFn: () => businessHermesApi.getStatus(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentsQuery = useQuery({
    queryKey: ["hermes-agents", selectedCompanyId],
    queryFn: () => businessHermesApi.listAgents(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const tasksQuery = useQuery({
    queryKey: ["hermes-tasks", selectedCompanyId],
    queryFn: () =>
      businessHermesApi.listTasks(selectedCompanyId!, { limit: 100 }),
    enabled: !!selectedCompanyId,
    refetchInterval: 5_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => businessHermesApi.sync(selectedCompanyId!),
    onSuccess: () => {
      setLastSyncAt(new Date().toISOString());
      qc.invalidateQueries({ queryKey: ["hermes-agents", selectedCompanyId] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: (hermesAgentId: string) =>
      businessHermesApi.registerAgent(selectedCompanyId!, hermesAgentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hermes-agents", selectedCompanyId] });
    },
  });

  const unregisterMutation = useMutation({
    mutationFn: (registeredAgentId: string) =>
      businessHermesApi.unregisterAgent(selectedCompanyId!, registeredAgentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hermes-agents", selectedCompanyId] });
    },
  });

  const delegateMutation = useMutation({
    mutationFn: (body: {
      hermesAgentId: string;
      prompt: string;
      callbackChannel?: string;
    }) => businessHermesApi.delegateTask(selectedCompanyId!, body),
    onSuccess: () => {
      setDelegateOpen(false);
      qc.invalidateQueries({ queryKey: ["hermes-tasks", selectedCompanyId] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (taskId: string) =>
      businessHermesApi.cancelTask(selectedCompanyId!, taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hermes-tasks", selectedCompanyId] });
    },
  });

  const available = agentsQuery.data?.available ?? [];
  const registered = agentsQuery.data?.registered ?? [];
  const tasks = tasksQuery.data?.tasks ?? [];
  const status = statusQuery.data;

  const registeredIds = useMemo(
    () => new Set(registered.map((r) => r.hermesAgentId)),
    [registered],
  );

  const webhookUrl = useMemo(() => {
    if (typeof window === "undefined") return "/api/public/webhooks/hermes";
    return `${window.location.origin}/api/public/webhooks/hermes`;
  }, []);

  function copyText(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={Bot} message="Select a workspace first." />;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Hermes Agents Bridge
          </h1>
          <p className="text-sm text-muted-foreground">
            Connect external Hermes agents into this workspace and delegate
            tasks bidirectionally.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Sync
          </Button>
          <Button
            size="sm"
            onClick={() => setDelegateOpen(true)}
            disabled={registered.length === 0}
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Delegate task
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="status">
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            Status
          </TabsTrigger>
          <TabsTrigger value="agents">
            <Bot className="h-3.5 w-3.5 mr-1.5" />
            Agents
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <ListChecks className="h-3.5 w-3.5 mr-1.5" />
            Tasks
          </TabsTrigger>
          <TabsTrigger value="configuration">
            <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
            Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="mt-4">
          {statusQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : !status ? (
            <EmptyState icon={AlertTriangle} message="Unable to load status." />
          ) : (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Connection</span>
                  {status.configured ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                      Live
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Mock</Badge>
                  )}
                </div>
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Base URL
                    </dt>
                    <dd className="font-mono text-xs break-all">
                      {status.baseUrl || "(unset)"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Organization
                    </dt>
                    <dd className="font-mono text-xs">
                      {status.organizationId ?? "(none)"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Available agents
                    </dt>
                    <dd className="text-xs">{available.length}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Registered agents
                    </dt>
                    <dd className="text-xs">{registered.length}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Last sync
                    </dt>
                    <dd className="text-xs">{timeAgo(lastSyncAt ?? undefined)}</dd>
                  </div>
                </dl>
                {!status.configured && (
                  <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2">
                    Running in <span className="font-mono">mock</span> mode.
                    Set <span className="font-mono">HERMES_API_URL</span>,
                    {" "}
                    <span className="font-mono">HERMES_API_KEY</span> and{" "}
                    <span className="font-mono">HERMES_WEBHOOK_SECRET</span>
                    {" "}
                    to connect to a real Hermes deployment.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="agents" className="mt-4 space-y-6">
          {agentsQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : (
            <>
              <section className="space-y-3">
                <h2 className="text-sm font-semibold">
                  Available agents ({available.length})
                </h2>
                {available.length === 0 ? (
                  <EmptyState icon={Bot} message="No agents reported by Hermes." />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {available.map((info) => (
                      <AgentCard
                        key={info.id}
                        info={info}
                        isRegistered={registeredIds.has(info.id)}
                        onRegister={() => registerMutation.mutate(info.id)}
                        loading={registerMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold">
                  Registered agents ({registered.length})
                </h2>
                {registered.length === 0 ? (
                  <EmptyState
                    icon={Bot}
                    message="No Hermes agents registered yet."
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {registered.map((r) => (
                      <AgentCard
                        key={r.id}
                        info={r.info}
                        isRegistered={true}
                        onUnregister={() => unregisterMutation.mutate(r.id)}
                        loading={unregisterMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          {tasksQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              message="No Hermes tasks delegated yet."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Agent</th>
                      <th className="text-left p-3 font-medium">Prompt</th>
                      <th className="text-left p-3 font-medium">Result</th>
                      <th className="text-left p-3 font-medium">Created</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task: HermesTask) => (
                      <tr key={task.id} className="border-b last:border-0">
                        <td className="p-3 align-top">
                          <StatusPill value={task.status} />
                        </td>
                        <td className="p-3 align-top font-mono text-xs">
                          {task.hermesAgentId}
                        </td>
                        <td className="p-3 align-top text-xs max-w-[24ch]">
                          <span className="line-clamp-3">{task.prompt}</span>
                        </td>
                        <td className="p-3 align-top text-xs max-w-[36ch]">
                          {task.output ? (
                            <span className="line-clamp-3">{task.output}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3 align-top text-xs text-muted-foreground">
                          {timeAgo(task.createdAt)}
                        </td>
                        <td className="p-3 align-top text-right">
                          {task.status === "pending" ||
                          task.status === "in_progress" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => cancelMutation.mutate(task.id)}
                              disabled={cancelMutation.isPending}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="configuration" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4 text-sm">
              <div>
                <p className="font-medium">Environment variables</p>
                <ul className="mt-1 space-y-1 text-xs font-mono text-muted-foreground">
                  <li>HERMES_API_URL</li>
                  <li>HERMES_API_KEY</li>
                  <li>HERMES_WEBHOOK_SECRET</li>
                  <li>HERMES_ORG_ID</li>
                </ul>
              </div>
              <div>
                <p className="font-medium">Webhook receiver URL</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="text-xs bg-muted/40 rounded px-2 py-1 break-all flex-1">
                    {webhookUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyText(webhookUrl)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Configure your Hermes deployment to POST events to this URL.
                  Requests are HMAC-SHA256 validated with the{" "}
                  <span className="font-mono">HERMES_WEBHOOK_SECRET</span>.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DelegateDialog
        open={delegateOpen}
        onOpenChange={setDelegateOpen}
        registered={registered}
        onSubmit={(body) => delegateMutation.mutate(body)}
        pending={delegateMutation.isPending}
      />
    </div>
  );
}

export default BusinessHermesPage;
