import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCcw,
  AlertTriangle,
  Settings,
  Webhook,
  ListChecks,
  Eye,
  ExternalLink,
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
  DialogFooter,
} from "@/components/ui/dialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  businessPaymentsApi,
  type PaymentCharge,
  type PaymentChargeStatus,
  type PaymentProviderName,
  type ProviderDescriptor,
} from "../api/business-payments";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(amountCents: number, currency: string): string {
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 3 : 2;
  return `${(amountCents / Math.pow(10, decimals)).toFixed(decimals)} ${currency}`;
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const PROVIDER_LABELS: Record<PaymentProviderName, string> = {
  knet: "KNET",
  myfatoorah: "MyFatoorah",
  moyasar: "Moyasar",
  tap: "Tap",
  paytabs: "PayTabs",
  stripe: "Stripe",
  mock: "Mock",
};

const PROVIDER_EMOJI: Record<PaymentProviderName, string> = {
  knet: "🇰🇼",
  myfatoorah: "💳",
  moyasar: "🇸🇦",
  tap: "🌍",
  paytabs: "🇦🇪",
  stripe: "🌐",
  mock: "🧪",
};

const PROVIDER_ENV_DOCS: Record<PaymentProviderName, string[]> = {
  knet: ["KNET_TRANSPORT_ID=…", "KNET_TRANSPORT_KEY=…", "KNET_RESOURCE_KEY=…", "KNET_TRANSPORT_URL=… (optional)"],
  myfatoorah: ["MYFATOORAH_API_KEY=…", "MYFATOORAH_API_URL=… (optional)"],
  moyasar: ["MOYASAR_API_KEY=…", "MOYASAR_PUBLISHABLE_KEY=… (optional)"],
  tap: ["TAP_SECRET_KEY=…", "TAP_PUBLISHABLE_KEY=… (optional)"],
  paytabs: ["PAYTABS_PROFILE_ID=…", "PAYTABS_SERVER_KEY=…", "PAYTABS_REGION=ARE | SAU | …"],
  stripe: ["STRIPE_SECRET_KEY=…", "STRIPE_WEBHOOK_SECRET=… (optional)"],
  mock: ["(no configuration required)"],
};

function StatusBadge({ status }: { status: PaymentChargeStatus | string }) {
  const map: Record<string, { cls: string; icon: ReactElement; label: string }> = {
    succeeded: {
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Paid",
    },
    pending: {
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
      icon: <Clock className="h-3 w-3" />,
      label: "Pending",
    },
    failed: {
      cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
      icon: <XCircle className="h-3 w-3" />,
      label: "Failed",
    },
    refunded: {
      cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
      icon: <RefreshCcw className="h-3 w-3" />,
      label: "Refunded",
    },
    expired: {
      cls: "bg-muted text-muted-foreground",
      icon: <Clock className="h-3 w-3" />,
      label: "Expired",
    },
  };
  const e = map[status] ?? map.pending!;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${e.cls}`}
    >
      {e.icon}
      {e.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Charge detail dialog
// ---------------------------------------------------------------------------

interface ChargeDetailDialogProps {
  open: boolean;
  charge: PaymentCharge | null;
  companyId: string;
  onOpenChange: (open: boolean) => void;
}

function ChargeDetailDialog({
  open,
  charge,
  companyId,
  onOpenChange,
}: ChargeDetailDialogProps) {
  const queryClient = useQueryClient();
  const refundMutation = useMutation({
    mutationFn: async () => {
      if (!charge) throw new Error("No charge");
      return businessPaymentsApi.refundCharge(companyId, charge.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-payments-charges", companyId] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Charge details</DialogTitle>
        </DialogHeader>
        {!charge ? (
          <p className="text-sm text-muted-foreground">No charge selected.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">
                {charge.providerId}
              </span>
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px]">
                  {PROVIDER_EMOJI[charge.providerName]} {PROVIDER_LABELS[charge.providerName]}
                </Badge>
                <StatusBadge status={charge.status} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 py-2 border-y">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Amount
                </p>
                <p className="font-mono text-sm tabular-nums">
                  {formatAmount(charge.amountCents, charge.currency)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Created
                </p>
                <p className="text-xs">{formatDate(charge.createdAt)}</p>
              </div>
              {charge.customerName && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Customer
                  </p>
                  <p className="text-xs">{charge.customerName}</p>
                </div>
              )}
              {charge.customerEmail && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Email
                  </p>
                  <p className="text-xs font-mono truncate">{charge.customerEmail}</p>
                </div>
              )}
              {charge.paidAt && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Paid at
                  </p>
                  <p className="text-xs">{formatDate(charge.paidAt)}</p>
                </div>
              )}
            </div>
            {charge.description && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Description
                </p>
                <p className="text-sm">{charge.description}</p>
              </div>
            )}
            {charge.paymentUrl && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Payment URL
                </p>
                <a
                  href={charge.paymentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open hosted checkout
                </a>
              </div>
            )}
            {charge.errorMessage && (
              <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 p-2 text-xs text-red-700 dark:text-red-300">
                {charge.errorMessage}
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Metadata
              </p>
              <pre className="rounded border bg-muted/30 p-2 text-[10px] font-mono overflow-auto max-h-48">
                {JSON.stringify(charge.metadata, null, 2)}
              </pre>
            </div>
          </div>
        )}
        <DialogFooter>
          {charge && charge.status === "succeeded" && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => refundMutation.mutate()}
              disabled={refundMutation.isPending}
            >
              <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
              {refundMutation.isPending ? "Refunding…" : "Refund"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Provider config dialog
// ---------------------------------------------------------------------------

interface ProviderConfigDialogProps {
  open: boolean;
  provider: PaymentProviderName | null;
  onOpenChange: (open: boolean) => void;
}

function ProviderConfigDialog({
  open,
  provider,
  onOpenChange,
}: ProviderConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {provider ? `Configure ${PROVIDER_LABELS[provider]}` : "Configure"}
          </DialogTitle>
        </DialogHeader>
        {provider && (
          <div className="space-y-3 text-sm">
            <p className="text-sm text-muted-foreground">
              Set these environment variables on the server. Changes require a
              restart to take effect.
            </p>
            <div className="rounded border bg-muted/30 p-3 text-xs font-mono space-y-0.5">
              {PROVIDER_ENV_DOCS[provider].map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessPaymentsPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState("transactions");
  const [selectedCharge, setSelectedCharge] = useState<PaymentCharge | null>(null);
  const [configProvider, setConfigProvider] = useState<PaymentProviderName | null>(null);
  const [defaultProvider, setDefaultProvider] = useState<Record<string, PaymentProviderName>>({
    KWD: "knet",
    SAR: "moyasar",
    AED: "paytabs",
    USD: "stripe",
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Payments" },
    ]);
  }, [setBreadcrumbs]);

  const providersQuery = useQuery({
    queryKey: ["business-payments-providers", selectedCompanyId],
    queryFn: () => businessPaymentsApi.listProviders(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const chargesQuery = useQuery({
    queryKey: ["business-payments-charges", selectedCompanyId],
    queryFn: () =>
      businessPaymentsApi.listCharges(selectedCompanyId!, { limit: 200 }),
    enabled: !!selectedCompanyId,
  });

  const providers = providersQuery.data?.providers ?? [];
  const charges = chargesQuery.data?.charges ?? [];

  const stats = useMemo(() => {
    const total = charges.length;
    const succeeded = charges.filter((c) => c.status === "succeeded").length;
    const failed = charges.filter((c) => c.status === "failed").length;
    const pending = charges.filter((c) => c.status === "pending").length;
    return { total, succeeded, failed, pending };
  }, [charges]);

  // Pseudo-webhooks-feed: derive recent webhook-ish entries from charges
  // that have provider metadata (proxy for "received an update").
  const webhookEvents = useMemo(
    () =>
      charges
        .filter((c) => Object.keys(c.metadata ?? {}).length > 0)
        .slice(0, 50)
        .map((c) => ({
          id: c.id,
          provider: c.providerName,
          eventType: `${c.providerName}.${c.status}`,
          createdAt: c.createdAt,
          chargeId: c.providerId,
        })),
    [charges],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={CreditCard} message="Select a workspace first." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Payments</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            GCC payment gateways: KNET, MyFatoorah, Moyasar, Tap, PayTabs, Stripe
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <ListChecks className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Total charges</p>
              <p className="text-lg font-bold tabular-nums">{stats.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Succeeded</p>
              <p className="text-lg font-bold tabular-nums text-emerald-600">
                {stats.succeeded}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <Clock className="h-4 w-4 text-amber-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-lg font-bold tabular-nums">{stats.pending}</p>
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
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="transactions">
            <ListChecks className="h-4 w-4 mr-1.5" />
            Transactions
          </TabsTrigger>
          <TabsTrigger value="providers">
            <CreditCard className="h-4 w-4 mr-1.5" />
            Providers
          </TabsTrigger>
          <TabsTrigger value="webhooks">
            <Webhook className="h-4 w-4 mr-1.5" />
            Webhooks
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-1.5" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="mt-4">
          {chargesQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : charges.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              message="No charges yet."
            />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[100px_120px_120px_1fr_120px_100px_60px] items-center gap-3 px-4 py-2 bg-muted/50 border-b text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Provider</span>
                <span>Amount</span>
                <span>Status</span>
                <span>Customer</span>
                <span>Created</span>
                <span>Code</span>
                <span />
              </div>
              <div className="divide-y">
                {charges.map((c) => (
                  <div
                    key={c.id}
                    className="grid grid-cols-[100px_120px_120px_1fr_120px_100px_60px] items-center gap-3 px-4 py-2 bg-card hover:bg-muted/30 text-sm cursor-pointer"
                    onClick={() => setSelectedCharge(c)}
                  >
                    <span className="text-xs inline-flex items-center gap-1">
                      <span aria-hidden>{PROVIDER_EMOJI[c.providerName]}</span>
                      {PROVIDER_LABELS[c.providerName]}
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      {formatAmount(c.amountCents, c.currency)}
                    </span>
                    <StatusBadge status={c.status} />
                    <span className="text-xs truncate">
                      {c.customerName ?? c.customerEmail ?? c.description ?? "—"}
                    </span>
                    <span
                      className="text-xs text-muted-foreground"
                      title={formatDate(c.createdAt)}
                    >
                      {timeAgo(c.createdAt)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground truncate">
                      {c.providerId.slice(0, 12)}
                    </span>
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="providers" className="mt-4">
          {providersQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {providers.map((p) => (
                <ProviderCard
                  key={p.name}
                  provider={p}
                  onConfigure={() => setConfigProvider(p.name)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="webhooks" className="mt-4">
          {webhookEvents.length === 0 ? (
            <EmptyState
              icon={Webhook}
              message="No webhook events yet."
            />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[120px_1fr_180px_140px] items-center gap-3 px-4 py-2 bg-muted/50 border-b text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Provider</span>
                <span>Event type</span>
                <span>Charge ID</span>
                <span>Received</span>
              </div>
              <div className="divide-y">
                {webhookEvents.map((e) => (
                  <div
                    key={e.id}
                    className="grid grid-cols-[120px_1fr_180px_140px] items-center gap-3 px-4 py-2 bg-card text-sm"
                  >
                    <span className="text-xs">
                      {PROVIDER_EMOJI[e.provider]} {PROVIDER_LABELS[e.provider]}
                    </span>
                    <code className="text-xs">{e.eventType}</code>
                    <span className="font-mono text-[11px] truncate">
                      {e.chargeId}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(e.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">Default provider per currency</p>
              <p className="text-xs text-muted-foreground">
                Kuwait-first: KWD defaults to KNET + MyFatoorah suggestions. Pick
                a primary provider for each currency. Customers see all configured
                methods.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(["KWD", "SAR", "AED", "USD"] as const).map((cur) => {
                  const eligible = providers.filter(
                    (p) => p.configured && p.currencies.includes(cur),
                  );
                  const value = defaultProvider[cur] ?? eligible[0]?.name ?? "mock";
                  return (
                    <div key={cur} className="flex items-center justify-between gap-2 rounded border p-3">
                      <div>
                        <p className="text-sm font-semibold">{cur}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {eligible.length} configured
                        </p>
                      </div>
                      <select
                        className="rounded border bg-background px-2 py-1 text-xs"
                        value={value}
                        onChange={(e) =>
                          setDefaultProvider((prev) => ({
                            ...prev,
                            [cur]: e.target.value as PaymentProviderName,
                          }))
                        }
                      >
                        {eligible.length === 0 ? (
                          <option value="mock">No providers configured</option>
                        ) : (
                          eligible.map((p) => (
                            <option key={p.name} value={p.name}>
                              {PROVIDER_LABELS[p.name]}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-semibold">Kuwait-first defaults</p>
              </div>
              <p className="text-xs text-muted-foreground">
                When no provider is explicitly configured for a KWD invoice, the
                customer-facing picker will suggest{" "}
                <strong>KNET</strong> first, then <strong>MyFatoorah</strong>.
                These are the standard rails for Kuwait merchants.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ChargeDetailDialog
        open={selectedCharge !== null}
        charge={selectedCharge}
        companyId={selectedCompanyId}
        onOpenChange={(open) => {
          if (!open) setSelectedCharge(null);
        }}
      />
      <ProviderConfigDialog
        open={configProvider !== null}
        provider={configProvider}
        onOpenChange={(open) => {
          if (!open) setConfigProvider(null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider card
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  onConfigure,
}: {
  provider: ProviderDescriptor;
  onConfigure: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>
              {PROVIDER_EMOJI[provider.name]}
            </span>
            <div>
              <p className="text-sm font-semibold">
                {PROVIDER_LABELS[provider.name]}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {provider.currencies.join(" · ")}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              provider.configured
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
            }`}
          >
            {provider.configured ? "Configured" : "Mocked"}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onConfigure}
        >
          <Settings className="h-3.5 w-3.5 mr-1.5" />
          Configure
        </Button>
      </CardContent>
    </Card>
  );
}
