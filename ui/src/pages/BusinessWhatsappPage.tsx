import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle,
  Inbox,
  FileText,
  User,
  Settings,
  CheckCircle2,
  XCircle,
  Copy,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { WhatsappInbox } from "../components/business/WhatsappInbox";
import { WhatsappTemplateManager } from "../components/business/WhatsappTemplateManager";
import {
  businessWhatsappApi,
  type WhatsappBusinessProfile,
} from "../api/business-whatsapp";

function StatusRow({
  label,
  ok,
  hint,
}: {
  label: string;
  ok: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      {ok ? (
        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Set
        </Badge>
      ) : (
        <Badge className="bg-muted text-muted-foreground hover:bg-muted">
          <XCircle className="h-3 w-3 mr-1" />
          Missing
        </Badge>
      )}
    </div>
  );
}

function SettingsTab({ companyId }: { companyId: string }) {
  const configQuery = useQuery({
    queryKey: ["whatsapp-config", companyId],
    queryFn: () => businessWhatsappApi.getConfig(companyId),
    enabled: !!companyId,
  });

  const c = configQuery.data;
  const [copied, setCopied] = useState(false);

  function copyWebhook() {
    if (!c?.webhookUrl) return;
    navigator.clipboard.writeText(c.webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-1">
          <h3 className="text-sm font-semibold mb-2">Environment</h3>
          {!c ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : (
            <>
              <StatusRow
                label="WHATSAPP_BUSINESS_API_TOKEN"
                ok={c.hasToken}
                hint="Long-lived system user access token (Bearer)"
              />
              <StatusRow
                label="WHATSAPP_PHONE_NUMBER_ID"
                ok={c.hasPhoneNumberId}
                hint="Phone-number ID from WABA dashboard"
              />
              <StatusRow
                label="WHATSAPP_BUSINESS_ACCOUNT_ID"
                ok={c.hasBusinessAccountId}
                hint="Required for template management"
              />
              <StatusRow
                label="WHATSAPP_WEBHOOK_VERIFY_TOKEN"
                ok={c.hasWebhookVerifyToken}
                hint="Shared secret matched against hub.verify_token"
              />
              <StatusRow
                label="WHATSAPP_APP_SECRET"
                ok={c.hasAppSecret}
                hint="Used to verify x-hub-signature-256 on inbound events"
              />
              <StatusRow
                label="Graph API version"
                ok
                hint={c.graphApiVersion}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <h3 className="text-sm font-semibold">Webhook URL</h3>
          <p className="text-xs text-muted-foreground">
            Configure this URL in the Meta App Dashboard → WhatsApp →
            Configuration → Webhook. Use any string for the Verify Token, then
            set the same value as <code className="font-mono">WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Input
              readOnly
              value={c?.webhookUrl ?? ""}
              className="font-mono text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={copyWebhook}
              disabled={!c?.webhookUrl}
            >
              <Copy className="h-3.5 w-3.5 mr-1" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <a
            href="https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
          >
            <ExternalLink className="h-3 w-3" />
            Meta webhook docs
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-1">
          <h3 className="text-sm font-semibold mb-2">Subscribe to events</h3>
          <p className="text-xs text-muted-foreground">
            In the App Dashboard subscribe to at least these webhook fields:
          </p>
          <ul className="text-xs text-muted-foreground list-disc ml-5 mt-1 space-y-0.5">
            <li>
              <code className="font-mono">messages</code> — inbound messages &
              delivery statuses
            </li>
            <li>
              <code className="font-mono">message_template_status_update</code>{" "}
              — template approvals
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileTab({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["whatsapp-profile", companyId],
    queryFn: () => businessWhatsappApi.getProfile(companyId),
    enabled: !!companyId,
  });

  const [edits, setEdits] = useState<Partial<WhatsappBusinessProfile>>({});
  const profile = profileQuery.data?.profile;
  const current: Partial<WhatsappBusinessProfile> = { ...profile, ...edits };

  const updateMutation = useMutation({
    mutationFn: (body: Partial<WhatsappBusinessProfile>) =>
      businessWhatsappApi.updateProfile(companyId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp-profile", companyId],
      });
      setEdits({});
    },
  });

  function setField<K extends keyof WhatsappBusinessProfile>(
    key: K,
    value: WhatsappBusinessProfile[K],
  ) {
    setEdits((e) => ({ ...e, [key]: value }));
  }

  if (profileQuery.isLoading) {
    return <div className="text-xs text-muted-foreground">Loading…</div>;
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">Business profile</h3>
        <p className="text-xs text-muted-foreground">
          Visible to customers in WhatsApp. Changes are written to Meta.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="wa-about" className="text-xs">
              About (max 139)
            </Label>
            <Input
              id="wa-about"
              value={current.about ?? ""}
              onChange={(e) => setField("about", e.target.value)}
              maxLength={139}
            />
          </div>
          <div>
            <Label htmlFor="wa-email" className="text-xs">
              Email
            </Label>
            <Input
              id="wa-email"
              type="email"
              value={current.email ?? ""}
              onChange={(e) => setField("email", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="wa-address" className="text-xs">
              Address
            </Label>
            <Input
              id="wa-address"
              value={current.address ?? ""}
              onChange={(e) => setField("address", e.target.value)}
              maxLength={256}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="wa-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="wa-description"
              rows={3}
              value={current.description ?? ""}
              onChange={(e) => setField("description", e.target.value)}
              maxLength={512}
            />
          </div>
          <div>
            <Label htmlFor="wa-vertical" className="text-xs">
              Industry vertical
            </Label>
            <Input
              id="wa-vertical"
              value={current.vertical ?? ""}
              onChange={(e) => setField("vertical", e.target.value)}
              placeholder="RETAIL, RESTAURANT, …"
            />
          </div>
          <div>
            <Label htmlFor="wa-websites" className="text-xs">
              Websites (comma-separated, max 2)
            </Label>
            <Input
              id="wa-websites"
              value={(current.websites ?? []).join(", ")}
              onChange={(e) =>
                setField(
                  "websites",
                  e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                    .slice(0, 2),
                )
              }
            />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            disabled={
              Object.keys(edits).length === 0 || updateMutation.isPending
            }
            onClick={() => updateMutation.mutate(edits)}
          >
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
        {updateMutation.error && (
          <div className="text-xs text-red-600">
            {(updateMutation.error as Error).message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BusinessWhatsappPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState("inbox");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "WhatsApp" },
    ]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return <EmptyState icon={MessageCircle} message="Select a workspace first." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-emerald-600" />
          <h1 className="text-2xl font-semibold">WhatsApp Business</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Inbox, templates, business profile, and configuration for the
          WhatsApp Cloud API.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inbox">
            <Inbox className="h-4 w-4 mr-1.5" />
            Inbox
          </TabsTrigger>
          <TabsTrigger value="templates">
            <FileText className="h-4 w-4 mr-1.5" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="profile">
            <User className="h-4 w-4 mr-1.5" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-1.5" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          <WhatsappInbox companyId={selectedCompanyId} />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <WhatsappTemplateManager companyId={selectedCompanyId} />
        </TabsContent>
        <TabsContent value="profile" className="mt-4">
          <ProfileTab companyId={selectedCompanyId} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab companyId={selectedCompanyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
