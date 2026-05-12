import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Calendar,
  Clock,
  Loader2,
  Phone,
  PlayCircle,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { CofounderChatWindow } from "../components/business/CofounderChatWindow";
import {
  aiCofounderApi,
  type CofounderTool,
  type OwnerPhone,
} from "../api/ai-cofounder";

export function BusinessAiCofounderPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"chat" | "owners" | "activity" | "tools" | "settings">("chat");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "AI Co-Founder" },
    ]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <div className="container mx-auto max-w-5xl p-6">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Select a company to continue.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <div className="rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 p-1.5">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            AI Co-Founder
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run your entire business by chatting on WhatsApp or here.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="chat" className="gap-1">
            <Bot className="h-4 w-4" /> Chat
          </TabsTrigger>
          <TabsTrigger value="owners" className="gap-1">
            <Phone className="h-4 w-4" /> Owners
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1">
            <Activity className="h-4 w-4" /> Activity
          </TabsTrigger>
          <TabsTrigger value="tools" className="gap-1">
            <Wrench className="h-4 w-4" /> Tools
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1">
            <Settings className="h-4 w-4" /> Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-4">
          <CofounderChatWindow companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="owners" className="mt-4">
          <OwnersTab companyId={selectedCompanyId} queryClient={queryClient} />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTab companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <ToolsTab companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <SettingsTab companyId={selectedCompanyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Owners tab
// ---------------------------------------------------------------------------

interface OwnersTabProps {
  companyId: string;
  queryClient: ReturnType<typeof useQueryClient>;
}

function OwnersTab({ companyId, queryClient }: OwnersTabProps) {
  const [phone, setPhone] = useState("");
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [briefTime, setBriefTime] = useState("09:00");

  const ownersQuery = useQuery({
    queryKey: ["cofounder", "owners", companyId],
    queryFn: () => aiCofounderApi.listOwnerPhones(companyId),
  });

  const registerMut = useMutation({
    mutationFn: () =>
      aiCofounderApi.registerOwnerPhone(companyId, {
        userPhone: phone,
        lang,
        briefTime,
        dailyBriefEnabled: true,
        weeklyReportEnabled: true,
      }),
    onSuccess: () => {
      setPhone("");
      void queryClient.invalidateQueries({
        queryKey: ["cofounder", "owners", companyId],
      });
    },
  });

  const updateMut = useMutation({
    mutationFn: (p: {
      userPhone: string;
      lang?: "ar" | "en";
      dailyBriefEnabled?: boolean;
      weeklyReportEnabled?: boolean;
      briefTime?: string;
    }) =>
      aiCofounderApi.updateOwnerPhone(companyId, p.userPhone, {
        lang: p.lang,
        dailyBriefEnabled: p.dailyBriefEnabled,
        weeklyReportEnabled: p.weeklyReportEnabled,
        briefTime: p.briefTime,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["cofounder", "owners", companyId],
      }),
  });

  const removeMut = useMutation({
    mutationFn: (p: string) =>
      aiCofounderApi.unregisterOwnerPhone(companyId, p),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["cofounder", "owners", companyId],
      }),
  });

  const triggerDailyMut = useMutation({
    mutationFn: (p: string) => aiCofounderApi.triggerDailyBrief(companyId, p),
  });
  const triggerWeeklyMut = useMutation({
    mutationFn: (p: string) => aiCofounderApi.triggerWeeklyReport(companyId, p),
  });

  const owners: OwnerPhone[] = ownersQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" /> Register owner phone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              placeholder="+96599XXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={lang}
              onChange={(e) => setLang(e.target.value as "ar" | "en")}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
            <Input
              type="time"
              value={briefTime}
              onChange={(e) => setBriefTime(e.target.value)}
            />
            <Button
              onClick={() => registerMut.mutate()}
              disabled={!phone || registerMut.isPending}
            >
              {registerMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Register"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Once registered, messages from this WhatsApp number will be routed
            to the Co-Founder instead of the customer inbox.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registered phones</CardTitle>
        </CardHeader>
        <CardContent>
          {owners.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No owner phones registered yet.
            </div>
          ) : (
            <div className="space-y-2">
              {owners.map((o) => (
                <div
                  key={o.userPhone}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-emerald-100 p-1.5">
                      <Phone className="h-3.5 w-3.5 text-emerald-700" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{o.userPhone}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.lang === "ar" ? "العربية" : "English"} • brief @{" "}
                        {o.briefTime}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1 text-xs">
                      <ToggleSwitch
                        checked={o.dailyBriefEnabled}
                        onCheckedChange={(v) =>
                          updateMut.mutate({
                            userPhone: o.userPhone,
                            dailyBriefEnabled: v,
                          })
                        }
                      />
                      Daily
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <ToggleSwitch
                        checked={o.weeklyReportEnabled}
                        onCheckedChange={(v) =>
                          updateMut.mutate({
                            userPhone: o.userPhone,
                            weeklyReportEnabled: v,
                          })
                        }
                      />
                      Weekly
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => triggerDailyMut.mutate(o.userPhone)}
                      disabled={triggerDailyMut.isPending}
                    >
                      <PlayCircle className="mr-1 h-3 w-3" /> Daily
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => triggerWeeklyMut.mutate(o.userPhone)}
                      disabled={triggerWeeklyMut.isPending}
                    >
                      <PlayCircle className="mr-1 h-3 w-3" /> Weekly
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeMut.mutate(o.userPhone)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------

function ActivityTab({ companyId }: { companyId: string }) {
  const sessionsQuery = useQuery({
    queryKey: ["cofounder", "sessions", companyId],
    queryFn: () => aiCofounderApi.listSessions(companyId),
  });
  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Conversation sessions ({sessions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No conversations yet.
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div>
                  <div className="text-sm font-medium">{s.userPhone}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.messageCount} messages • {s.language === "ar" ? "AR" : "EN"} •{" "}
                    {new Date(s.lastActivityAt).toLocaleString()}
                  </div>
                </div>
                {s.pendingConfirmation && (
                  <Badge variant="outline" className="text-amber-700">
                    Pending: {s.pendingConfirmation.action}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tools tab
// ---------------------------------------------------------------------------

function ToolsTab({ companyId }: { companyId: string }) {
  const toolsQuery = useQuery({
    queryKey: ["cofounder", "tools", companyId],
    queryFn: () => aiCofounderApi.listTools(companyId),
  });
  const tools = toolsQuery.data?.tools ?? [];

  const grouped = useMemo(() => {
    const out: Record<string, CofounderTool[]> = {};
    for (const t of tools) {
      const cat = t.category;
      out[cat] = out[cat] ?? [];
      out[cat].push(t);
    }
    return out;
  }, [tools]);

  const labels: Record<string, string> = {
    read: "Read",
    write: "Write",
    report: "Reports",
    messaging: "Messaging",
  };
  const icons: Record<string, ReactNode> = {
    read: <Activity className="h-4 w-4" />,
    write: <Zap className="h-4 w-4" />,
    report: <Calendar className="h-4 w-4" />,
    messaging: <Phone className="h-4 w-4" />,
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Object.entries(grouped).map(([cat, list]) => (
        <Card key={cat}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {icons[cat]} {labels[cat] ?? cat} ({list.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-64">
              <div className="space-y-2">
                {list.map((t) => (
                  <div key={t.name} className="rounded border p-2">
                    <div className="flex items-center justify-between">
                      <code className="text-xs font-medium">{t.name}</code>
                      {t.dangerous && (
                        <Badge variant="outline" className="text-red-600">
                          DANGEROUS
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t.description}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function SettingsTab({ companyId: _companyId }: { companyId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Co-Founder settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">Timezone</div>
            <div className="text-xs text-muted-foreground">
              Daily briefs use Kuwait time (UTC+3). Weekly reports run on
              Mondays at the configured brief time.
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">LLM</div>
            <div className="text-xs text-muted-foreground">
              When <code>ANTHROPIC_API_KEY</code> is set, the Co-Founder uses
              Claude. Otherwise it falls back to the NLP service with canned
              responses.
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">WhatsApp routing</div>
            <div className="text-xs text-muted-foreground">
              Owner phones registered on the Owners tab are routed to the
              Co-Founder. Customer messages go to the helpdesk inbox.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
