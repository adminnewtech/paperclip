import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  FileCheck,
  Receipt,
  CreditCard,
  Plus,
} from "lucide-react";
import {
  currencyFractionDigits,
  minorToMajor,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { gccApi, type PaymentGatewayRow } from "../api/gcc";
import { financeApi, type InvoiceRow } from "../api/finance";

const COUNTRIES = [
  { code: "SA", label: "Saudi Arabia (KSA) — 15%" },
  { code: "AE", label: "United Arab Emirates — 5%" },
  { code: "KW", label: "Kuwait — 0%" },
] as const;

const GATEWAYS = [
  { provider: "knet", label: "KNET" },
  { provider: "mada", label: "mada" },
  { provider: "tabby", label: "Tabby (BNPL)" },
  { provider: "tamara", label: "Tamara (BNPL)" },
  { provider: "myfatoorah", label: "MyFatoorah" },
  { provider: "applepay", label: "Apple Pay" },
] as const;

const TABS = [
  { key: "tax", label: "Tax Registration", icon: FileCheck },
  { key: "einvoicing", label: "E-Invoicing", icon: Receipt },
  { key: "vat", label: "VAT Return", icon: ShieldCheck },
  { key: "gateways", label: "Payment Gateways", icon: CreditCard },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function formatMinor(amountMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return `${minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

export function Compliance() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<TabKey>("tax");

  useEffect(() => {
    setBreadcrumbs([{ label: "Compliance" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={ShieldCheck}
        message="Select a workspace to manage GCC compliance."
      />
    );
  }

  return (
    <div className="space-y-6" dir="auto">
      <div>
        <h1 className="text-2xl font-semibold">GCC Compliance</h1>
        <p className="text-sm text-muted-foreground">
          ZATCA e-invoicing, VAT, and local payment rails for KSA, UAE, and
          Kuwait.
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

      {tab === "tax" && <TaxTab companyId={selectedCompanyId} />}
      {tab === "einvoicing" && <EInvoicingTab companyId={selectedCompanyId} />}
      {tab === "vat" && <VatTab companyId={selectedCompanyId} />}
      {tab === "gateways" && <GatewaysTab companyId={selectedCompanyId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tax registration tab
// ---------------------------------------------------------------------------
function TaxTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [country, setCountry] = useState<string>("SA");
  const [vatNumber, setVatNumber] = useState("");
  const [registered, setRegistered] = useState(false);

  const regQuery = useQuery({
    queryKey: ["gcc", "tax-registration", companyId, country],
    queryFn: () => gccApi.getTaxRegistration(companyId, country),
    enabled: !!companyId,
  });

  useEffect(() => {
    const reg = regQuery.data?.registration;
    setVatNumber(reg?.vatNumber ?? "");
    setRegistered(reg?.registered ?? false);
  }, [regQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      gccApi.upsertTaxRegistration(companyId, {
        country,
        vatNumber: vatNumber.trim() || undefined,
        registered,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["gcc", "tax-registration", companyId],
      });
      pushToast({ title: "Tax registration saved", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to save",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (regQuery.isLoading) return <PageSkeleton variant="list" />;
  if (regQuery.isError) {
    return (
      <EmptyState
        icon={FileCheck}
        message={
          (regQuery.error as Error)?.message ??
          "Failed to load tax registration."
        }
      />
    );
  }

  const reg = regQuery.data?.registration;
  const rateBps =
    reg?.vatRateBps ??
    (country === "SA" ? 1500 : country === "AE" ? 500 : 0);

  return (
    <Card>
      <CardContent className="p-4 space-y-4 max-w-lg">
        <div className="space-y-1.5">
          <Label htmlFor="country">Country</Label>
          <select
            id="country"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vat-number">VAT number</Label>
          <Input
            id="vat-number"
            value={vatNumber}
            onChange={(e) => setVatNumber(e.target.value)}
            placeholder="3XXXXXXXXXXXXX3"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="registered"
            type="checkbox"
            checked={registered}
            onChange={(e) => setRegistered(e.target.checked)}
          />
          <Label htmlFor="registered">VAT registered</Label>
        </div>
        <div className="text-sm text-muted-foreground">
          VAT rate: {(rateBps / 100).toFixed(2)}%
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save registration"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// E-invoicing tab
// ---------------------------------------------------------------------------
function statusVariant(
  status: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "cleared":
      return "default";
    case "reported":
      return "secondary";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

function EInvoicingTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const einvoicesQuery = useQuery({
    queryKey: ["gcc", "einvoices", companyId],
    queryFn: () => gccApi.listEInvoices(companyId),
    enabled: !!companyId,
  });

  if (einvoicesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (einvoicesQuery.isError) {
    return (
      <EmptyState
        icon={Receipt}
        message={
          (einvoicesQuery.error as Error)?.message ??
          "Failed to load e-invoices."
        }
      />
    );
  }

  const einvoices = einvoicesQuery.data?.einvoices ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          Issue e-invoice
        </Button>
      </div>

      {einvoices.length === 0 ? (
        <EmptyState icon={Receipt} message="No e-invoices issued yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Seq</th>
                  <th className="text-start font-medium px-4 py-2">UUID</th>
                  <th className="text-start font-medium px-4 py-2">Kind</th>
                  <th className="text-end font-medium px-4 py-2">Total</th>
                  <th className="text-end font-medium px-4 py-2">VAT</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {einvoices.map((ei) => (
                  <tr
                    key={ei.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2 font-mono">{ei.seq}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {ei.uuidValue ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {ei.invoiceKind ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(ei.totalMinor, ei.currency ?? "SAR")}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-muted-foreground">
                      {formatMinor(ei.vatMinor, ei.currency ?? "SAR")}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={statusVariant(ei.zatcaStatus)}>
                        {ei.zatcaStatus ?? "draft"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <IssueEInvoiceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        onIssued={() =>
          queryClient.invalidateQueries({
            queryKey: ["gcc", "einvoices", companyId],
          })
        }
        pushToast={pushToast}
      />
    </div>
  );
}

interface IssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onIssued: () => void;
  pushToast: ReturnType<typeof useToast>["pushToast"];
}

function IssueEInvoiceDialog({
  open,
  onOpenChange,
  companyId,
  onIssued,
  pushToast,
}: IssueDialogProps) {
  const [invoiceId, setInvoiceId] = useState("");
  const [issued, setIssued] = useState<{
    uuid: string | null;
    qr: string | null;
    status: string | null;
  } | null>(null);

  const invoicesQuery = useQuery({
    queryKey: ["finance", "invoices", companyId],
    queryFn: () => financeApi.listInvoices(companyId),
    enabled: !!companyId && open,
  });

  const issue = useMutation({
    mutationFn: () => gccApi.issueEInvoice(companyId, { invoiceId }),
    onSuccess: (row) => {
      onIssued();
      setIssued({
        uuid: row.uuidValue,
        qr: row.qrCode,
        status: row.zatcaStatus,
      });
      pushToast({ title: "E-invoice issued", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to issue e-invoice",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const invoices: InvoiceRow[] = invoicesQuery.data?.invoices ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setInvoiceId("");
          setIssued(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue e-invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="invoice">Invoice</Label>
            <select
              id="invoice"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
            >
              <option value="">Select an invoice…</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.number ?? inv.id} — {inv.customerName ?? "—"}
                </option>
              ))}
            </select>
          </div>

          {issued && (
            <div className="rounded-md border border-border p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={statusVariant(issued.status)}>
                  {issued.status ?? "—"}
                </Badge>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground">UUID</span>
                <div className="font-mono text-xs break-all">
                  {issued.uuid ?? "—"}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground">QR (base64 TLV)</span>
                <div className="font-mono text-xs break-all">
                  {issued.qr ?? "—"}
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() => issue.mutate()}
            disabled={!invoiceId || issue.isPending}
          >
            {issue.isPending ? "Issuing…" : "Issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// VAT return tab
// ---------------------------------------------------------------------------
function VatTab({ companyId }: { companyId: string }) {
  const [country, setCountry] = useState<string>("SA");

  const vatQuery = useQuery({
    queryKey: ["gcc", "vat-return", companyId, country],
    queryFn: () => gccApi.vatReturn(companyId, country),
    enabled: !!companyId,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 max-w-xs">
        <Label htmlFor="vat-country">Country</Label>
        <select
          id="vat-country"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {vatQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : vatQuery.isError ? (
        <EmptyState
          icon={ShieldCheck}
          message={
            (vatQuery.error as Error)?.message ?? "Failed to load VAT return."
          }
        />
      ) : (
        vatQuery.data && (
          <Card>
            <CardContent className="p-4 space-y-2 max-w-md">
              <h2 className="font-semibold">VAT Return ({country})</h2>
              <div className="flex justify-between text-sm">
                <span>Output VAT (sales)</span>
                <span className="font-mono">
                  {formatMinor(vatQuery.data.outputVatMinor, country === "SA" ? "SAR" : country === "AE" ? "AED" : "KWD")}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Input VAT (purchases)</span>
                <span className="font-mono">
                  {formatMinor(vatQuery.data.inputVatMinor, country === "SA" ? "SAR" : country === "AE" ? "AED" : "KWD")}
                </span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between text-sm font-semibold">
                <span>Net VAT due</span>
                <span className="font-mono">
                  {formatMinor(vatQuery.data.netVatDueMinor, country === "SA" ? "SAR" : country === "AE" ? "AED" : "KWD")}
                </span>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment gateways tab
// ---------------------------------------------------------------------------
function GatewaysTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const gatewaysQuery = useQuery({
    queryKey: ["gcc", "payment-gateways", companyId],
    queryFn: () => gccApi.listGateways(companyId),
    enabled: !!companyId,
  });

  const upsert = useMutation({
    mutationFn: (body: {
      provider: string;
      enabled: boolean;
      mode: string;
    }) => gccApi.upsertGateway(companyId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["gcc", "payment-gateways", companyId],
      });
      pushToast({ title: "Gateway updated", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to update gateway",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (gatewaysQuery.isLoading) return <PageSkeleton variant="list" />;
  if (gatewaysQuery.isError) {
    return (
      <EmptyState
        icon={CreditCard}
        message={
          (gatewaysQuery.error as Error)?.message ??
          "Failed to load payment gateways."
        }
      />
    );
  }

  const rows: PaymentGatewayRow[] = gatewaysQuery.data?.gateways ?? [];
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {GATEWAYS.map((g) => {
        const existing = byProvider.get(g.provider);
        const enabled = existing?.enabled ?? false;
        const mode = existing?.mode ?? "sandbox";
        return (
          <Card key={g.provider}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">{g.label}</div>
                <Badge variant={enabled ? "default" : "outline"}>
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={enabled ? "outline" : "default"}
                  disabled={upsert.isPending}
                  onClick={() =>
                    upsert.mutate({
                      provider: g.provider,
                      enabled: !enabled,
                      mode,
                    })
                  }
                >
                  {enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={upsert.isPending}
                  onClick={() =>
                    upsert.mutate({
                      provider: g.provider,
                      enabled,
                      mode: mode === "sandbox" ? "live" : "sandbox",
                    })
                  }
                >
                  {mode === "sandbox" ? "Sandbox" : "Live"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
