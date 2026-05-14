import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MessageSquare,
  Send,
  Phone,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ListChecks,
  Settings,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { MessageComposer } from "../components/business/MessageComposer";
import {
  businessMessagingApi,
  type MessageRecord,
} from "../api/business-messaging";
import { type MessageTemplate } from "@paperclipai/shared";

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
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChannelBadge({ channel }: { channel: string }) {
  const cls =
    channel === "whatsapp"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <MessageSquare className="h-3 w-3" />
      {channel === "whatsapp" ? "WhatsApp" : "SMS"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "sent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium">
        <CheckCircle2 className="h-3 w-3" />
        Sent
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 px-2 py-0.5 text-[10px] font-medium">
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px] font-medium">
      {status}
    </span>
  );
}

function CategoryPill({ category }: { category: string }) {
  return (
    <Badge variant="secondary" className="text-[10px] capitalize">
      {category}
    </Badge>
  );
}

interface TemplateCardProps {
  template: MessageTemplate;
  onSend: () => void;
}

function TemplateCard({ template, onSend }: TemplateCardProps) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{template.name}</p>
            <p className="text-xs text-muted-foreground" dir="rtl">
              {template.nameAr}
            </p>
          </div>
          <CategoryPill category={template.category} />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Preview
          </p>
          <p className="text-xs leading-relaxed bg-muted/40 rounded p-2 line-clamp-3">
            {template.bodyEn}
          </p>
        </div>
        {template.variables.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {template.variables.map((v) => (
              <Badge key={v} variant="outline" className="text-[10px] font-mono">
                {v}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted-foreground">
            {template.channel === "both"
              ? "WhatsApp + SMS"
              : template.channel === "whatsapp"
                ? "WhatsApp"
                : "SMS"}
          </span>
          <Button size="sm" onClick={onSend}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface MessageDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: MessageRecord | null;
}

function MessageDetailDialog({
  open,
  onOpenChange,
  message,
}: MessageDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Message details</DialogTitle>
        </DialogHeader>
        {!message ? (
          <p className="text-sm text-muted-foreground">No message selected.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">
                {message.code ?? "—"}
              </span>
              <div className="flex items-center gap-1.5">
                <ChannelBadge channel={message.channel} />
                <StatusBadge status={message.status} />
                {message.mock && (
                  <Badge variant="secondary" className="text-[10px]">
                    mock
                  </Badge>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 py-2 border-y">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Recipient
                </p>
                <p className="font-mono text-xs">{message.toPhone}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Sent
                </p>
                <p className="text-xs">{formatDate(message.createdAt)}</p>
              </div>
              {message.templateKey && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Template
                  </p>
                  <p className="font-mono text-xs">{message.templateKey}</p>
                </div>
              )}
              {message.providerMessageId && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Provider ID
                  </p>
                  <p className="font-mono text-[10px] truncate">
                    {message.providerMessageId}
                  </p>
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Body
              </p>
              <div className="rounded border bg-muted/30 p-2 whitespace-pre-wrap text-sm leading-relaxed">
                {message.body}
              </div>
            </div>
            {message.error && (
              <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 p-2 text-xs text-red-700 dark:text-red-300">
                {message.error}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessMessagingPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState("templates");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTemplate, setComposerTemplate] = useState<string | undefined>(
    undefined,
  );
  const [selectedMessage, setSelectedMessage] = useState<MessageRecord | null>(
    null,
  );

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Messaging" },
    ]);
  }, [setBreadcrumbs]);

  const templatesQuery = useQuery({
    queryKey: ["business-messaging-templates", selectedCompanyId],
    queryFn: () => businessMessagingApi.listTemplates(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const messagesQuery = useQuery({
    queryKey: ["business-messaging-messages", selectedCompanyId],
    queryFn: () =>
      businessMessagingApi.listMessages(selectedCompanyId!, { limit: 200 }),
    enabled: !!selectedCompanyId,
  });

  const templates = templatesQuery.data?.templates ?? [];
  const providerStatus = templatesQuery.data?.providerStatus;
  const messages = messagesQuery.data?.messages ?? [];

  const stats = useMemo(() => {
    const sent = messages.filter((m) => m.status === "sent").length;
    const failed = messages.filter((m) => m.status === "failed").length;
    const mock = messages.filter((m) => m.mock).length;
    return { total: messages.length, sent, failed, mock };
  }, [messages]);

  if (!selectedCompanyId) {
    return (
      <EmptyState icon={MessageSquare} message="Select a workspace first." />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Messaging</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Send WhatsApp and SMS messages from your business templates
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setComposerTemplate(undefined);
            setComposerOpen(true);
          }}
        >
          <Send className="h-4 w-4 mr-1.5" />
          New Message
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <ListChecks className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Total sent</p>
              <p className="text-lg font-bold tabular-nums">{stats.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Delivered</p>
              <p className="text-lg font-bold tabular-nums text-emerald-600">
                {stats.sent}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <XCircle className="h-4 w-4 text-red-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Failed</p>
              <p
                className={`text-lg font-bold tabular-nums ${stats.failed > 0 ? "text-red-600" : ""}`}
              >
                {stats.failed}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Mocked</p>
              <p className="text-lg font-bold tabular-nums">{stats.mock}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="templates">
            <ListChecks className="h-4 w-4 mr-1.5" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="log">
            <MessageSquare className="h-4 w-4 mr-1.5" />
            Sent Log
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-1.5" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-4">
          {templatesQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : templates.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              message="No templates available."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map((t) => (
                <TemplateCard
                  key={t.key}
                  template={t}
                  onSend={() => {
                    setComposerTemplate(t.key);
                    setComposerOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          {messagesQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : messages.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              message="No messages sent yet."
              action="Send your first message"
              onAction={() => {
                setComposerTemplate(undefined);
                setComposerOpen(true);
              }}
            />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[80px_90px_140px_1fr_90px_110px_60px] items-center gap-3 px-4 py-2 bg-muted/50 border-b text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Code</span>
                <span>Channel</span>
                <span>Recipient</span>
                <span>Body</span>
                <span>Status</span>
                <span>Sent</span>
                <span />
              </div>
              <div className="divide-y">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className="grid grid-cols-[80px_90px_140px_1fr_90px_110px_60px] items-center gap-3 px-4 py-2 bg-card hover:bg-muted/30 text-sm"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground truncate">
                      {m.code ?? "—"}
                    </span>
                    <ChannelBadge channel={m.channel} />
                    <span className="font-mono text-xs inline-flex items-center gap-1">
                      <Phone className="h-3 w-3 text-muted-foreground" />
                      {m.toPhone}
                    </span>
                    <span className="text-xs truncate">{m.body}</span>
                    <StatusBadge status={m.status} />
                    <span
                      className="text-xs text-muted-foreground"
                      title={formatDate(m.createdAt)}
                    >
                      {timeAgo(m.createdAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedMessage(m)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">WhatsApp Business API</p>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${providerStatus?.whatsapp.configured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"}`}
                >
                  {providerStatus?.whatsapp.configured
                    ? "Configured"
                    : "Mocked"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {providerStatus?.whatsapp.details ?? "Loading…"}
              </p>
              <div className="rounded border bg-muted/30 p-3 text-xs font-mono space-y-0.5">
                <p>WHATSAPP_BUSINESS_API_TOKEN=…</p>
                <p>WHATSAPP_PHONE_NUMBER_ID=…</p>
                <p>WHATSAPP_GRAPH_API_VERSION=v20.0</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">SMS</p>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${providerStatus?.sms.configured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"}`}
                >
                  {providerStatus?.sms.configured
                    ? `Configured (${providerStatus.sms.provider})`
                    : `Mocked (${providerStatus?.sms.provider ?? "mock"})`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {providerStatus?.sms.details ?? "Loading…"}
              </p>
              <div className="rounded border bg-muted/30 p-3 text-xs font-mono space-y-0.5">
                <p>SMS_PROVIDER=twilio | aws-sns | unifonic | msegat | mock</p>
                <p># Twilio</p>
                <p>TWILIO_ACCOUNT_SID=…</p>
                <p>TWILIO_AUTH_TOKEN=…</p>
                <p>TWILIO_FROM_NUMBER=…</p>
                <p># AWS SNS</p>
                <p>AWS_SNS_REGION=…</p>
                <p>AWS_ACCESS_KEY_ID=…</p>
                <p>AWS_SECRET_ACCESS_KEY=…</p>
                <p># Unifonic</p>
                <p>UNIFONIC_APP_SID=…</p>
                <p>UNIFONIC_SENDER_ID=…</p>
                <p># msegat</p>
                <p>MSEGAT_API_KEY=…</p>
                <p>MSEGAT_USERNAME=…</p>
                <p>MSEGAT_USER_SENDER=…</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <MessageComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        defaultTemplate={composerTemplate}
      />

      <MessageDetailDialog
        open={selectedMessage !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedMessage(null);
        }}
        message={selectedMessage}
      />
    </div>
  );
}
