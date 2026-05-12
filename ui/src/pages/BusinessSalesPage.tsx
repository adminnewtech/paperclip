import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import {
  ArrowLeft,
  Plus,
  Search,
  Receipt,
  Users,
  CreditCard,
  FileText,
  Printer,
  Trash2,
  X,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Building2,
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
import { Separator } from "@/components/ui/separator";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ExportMenu, ZatcaBadge } from "../components/business/ExportMenu";
import { AttachmentList } from "../components/business/AttachmentList";
import { AIBrainPanel } from "../components/business/AIBrainPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
}

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";
type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(cents: number, currency = "SAR"): string {
  return (cents / 100).toLocaleString("en-SA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatAmount(amount: number, currency = "SAR"): string {
  return amount.toLocaleString("en-SA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-SA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysFromNow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function isThisMonth(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  status: string;
}

function InvoiceStatusBadge({ status }: StatusBadgeProps) {
  const cfg: Record<string, { label: string; cls: string }> = {
    draft: {
      label: "Draft",
      cls: "bg-muted text-muted-foreground",
    },
    sent: {
      label: "Sent",
      cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    },
    paid: {
      label: "Paid",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    },
    overdue: {
      label: "Overdue",
      cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    },
    void: {
      label: "Void",
      cls: "bg-muted/60 text-muted-foreground/60",
    },
  };
  const c = cfg[status] ?? cfg["draft"]!;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${c.cls}`}
    >
      {c.label}
    </span>
  );
}

function QuoteStatusBadge({ status }: StatusBadgeProps) {
  const cfg: Record<string, { label: string; cls: string }> = {
    draft: {
      label: "Draft",
      cls: "bg-muted text-muted-foreground",
    },
    sent: {
      label: "Sent",
      cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    },
    accepted: {
      label: "Accepted",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    },
    expired: {
      label: "Expired",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    },
  };
  const c = cfg[status] ?? cfg["draft"]!;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${c.cls}`}
    >
      {c.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

interface SummaryStripProps {
  invoices: BusinessEntityRow[];
}

function SummaryStrip({ invoices }: SummaryStripProps) {
  const totalInvoiced = invoices.reduce((a, i) => a + (i.amountCents ?? 0), 0);
  const paidThisMonth = invoices
    .filter(
      (i) =>
        i.status === "paid" &&
        isThisMonth((i.data as Record<string, unknown>).issueDate as string | undefined),
    )
    .reduce((a, i) => a + (i.amountCents ?? 0), 0);
  const outstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((a, i) => a + (i.amountCents ?? 0), 0);
  const overdueCount = invoices.filter((i) => i.status === "overdue").length;

  const items = [
    {
      label: "Total Invoiced",
      value: formatCurrency(totalInvoiced),
      icon: Receipt,
      tone: "default" as const,
    },
    {
      label: "Paid This Month",
      value: formatCurrency(paidThisMonth),
      icon: CheckCircle2,
      tone: "success" as const,
    },
    {
      label: "Outstanding",
      value: formatCurrency(outstanding),
      icon: Clock,
      tone: outstanding > 0 ? ("warning" as const) : ("default" as const),
    },
    {
      label: "Overdue",
      value: String(overdueCount),
      sub: overdueCount === 1 ? "invoice" : "invoices",
      icon: AlertCircle,
      tone: overdueCount > 0 ? ("danger" as const) : ("default" as const),
    },
  ];

  const iconBg = (tone: "default" | "success" | "warning" | "danger") => {
    if (tone === "success") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    if (tone === "warning") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    if (tone === "danger") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map(({ label, value, sub, icon: Icon, tone }) => (
        <Card key={label}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {label}
                </p>
                <p className="text-xl font-bold mt-1 tabular-nums">{value}</p>
                {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
              </div>
              <div className={`p-2 rounded-lg shrink-0 ${iconBg(tone)}`}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line items editor
// ---------------------------------------------------------------------------

interface LineItemsEditorProps {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
}

function LineItemsEditor({ items, onChange }: LineItemsEditorProps) {
  function updateItem(index: number, field: keyof LineItem, value: string | number) {
    const next = items.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item, [field]: typeof value === "string" ? value : Number(value) };
      const qty = field === "quantity" ? Number(value) : updated.quantity;
      const price = field === "unitPrice" ? Number(value) : updated.unitPrice;
      const tax = field === "taxRate" ? Number(value) : updated.taxRate;
      updated.total = qty * price * (1 + tax / 100);
      return updated;
    });
    onChange(next);
  }

  function addItem() {
    onChange([
      ...items,
      { description: "", quantity: 1, unitPrice: 0, taxRate: 15, total: 0 },
    ]);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const taxTotal = items.reduce(
    (a, i) => a + i.quantity * i.unitPrice * (i.taxRate / 100),
    0,
  );
  const grandTotal = subtotal + taxTotal;

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_60px_90px_70px_90px_28px] gap-2 px-1">
        <span className="text-xs font-medium text-muted-foreground">Description</span>
        <span className="text-xs font-medium text-muted-foreground text-right">Qty</span>
        <span className="text-xs font-medium text-muted-foreground text-right">Unit Price</span>
        <span className="text-xs font-medium text-muted-foreground text-right">Tax %</span>
        <span className="text-xs font-medium text-muted-foreground text-right">Total</span>
        <span />
      </div>

      {/* Rows */}
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[1fr_60px_90px_70px_90px_28px] gap-2 items-center">
          <Input
            placeholder="Description"
            value={item.description}
            onChange={(e) => updateItem(i, "description", e.target.value)}
            className="h-8 text-sm"
          />
          <Input
            type="number"
            min={0}
            value={item.quantity}
            onChange={(e) => updateItem(i, "quantity", e.target.value)}
            className="h-8 text-sm text-right"
          />
          <Input
            type="number"
            min={0}
            step={0.01}
            value={item.unitPrice}
            onChange={(e) => updateItem(i, "unitPrice", e.target.value)}
            className="h-8 text-sm text-right"
          />
          <Input
            type="number"
            min={0}
            max={100}
            value={item.taxRate}
            onChange={(e) => updateItem(i, "taxRate", e.target.value)}
            className="h-8 text-sm text-right"
          />
          <span className="text-sm font-mono text-right text-muted-foreground">
            {formatAmount(item.total)}
          </span>
          <button
            type="button"
            onClick={() => removeItem(i)}
            className="text-muted-foreground hover:text-destructive transition-colors p-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {items.length === 0 && (
        <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-lg">
          No line items yet
        </div>
      )}

      {/* Footer */}
      <div className="flex items-start justify-between pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={addItem}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add line item
        </Button>
        {items.length > 0 && (
          <div className="text-right space-y-1 text-sm">
            <div className="flex items-center justify-between gap-8 text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono">{formatAmount(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-8 text-muted-foreground">
              <span>VAT</span>
              <span className="font-mono">{formatAmount(taxTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-8 font-semibold border-t pt-1">
              <span>Total</span>
              <span className="font-mono">{formatAmount(grandTotal)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Invoice Dialog
// ---------------------------------------------------------------------------

interface CreateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  customers: BusinessEntityRow[];
  onSuccess?: () => void;
}

function CreateInvoiceDialog({
  open,
  onOpenChange,
  companyId,
  customers,
  onSuccess,
}: CreateInvoiceDialogProps) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso);
  const [dueDate, setDueDate] = useState(thirtyDaysFromNow);
  const [currency, setCurrency] = useState("SAR");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPrice: 0, taxRate: 15, total: 0 },
  ]);

  function reset() {
    setCustomerId("");
    setCustomerName("");
    setIssueDate(todayIso());
    setDueDate(thirtyDaysFromNow());
    setCurrency("SAR");
    setNotes("");
    setLineItems([{ description: "", quantity: 1, unitPrice: 0, taxRate: 15, total: 0 }]);
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const subtotal = lineItems.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
      const taxAmount = lineItems.reduce(
        (a, i) => a + i.quantity * i.unitPrice * (i.taxRate / 100),
        0,
      );
      const grandTotal = subtotal + taxAmount;
      const amountCents = Math.round(grandTotal * 100);

      const resolvedCustomerName =
        customers.find((c) => c.id === customerId)?.name ?? customerName;

      return businessApi.createEntity(companyId, "sales", "invoice", {
        entityType: "invoice",
        name: resolvedCustomerName ? `Invoice – ${resolvedCustomerName}` : "New Invoice",
        status: "draft",
        amountCents,
        currency,
        data: {
          customerId: customerId || null,
          customerName: resolvedCustomerName || null,
          issueDate,
          dueDate,
          taxAmount,
          notes,
          lineItems,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "invoice"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
      onOpenChange(false);
      reset();
      onSuccess?.();
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Invoice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Customer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Customer{" "}
                <span className="text-muted-foreground font-normal">(required)</span>
              </Label>
              {customers.length > 0 ? (
                <Select
                  value={customerId}
                  onValueChange={(v) => {
                    setCustomerId(v);
                    setCustomerName(customers.find((c) => c.id === v)?.name ?? "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual__">Enter manually…</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="Customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              )}
              {customerId === "__manual__" && (
                <Input
                  placeholder="Customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="mt-1.5"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SAR">SAR – Saudi Riyal</SelectItem>
                  <SelectItem value="USD">USD – US Dollar</SelectItem>
                  <SelectItem value="EUR">EUR – Euro</SelectItem>
                  <SelectItem value="AED">AED – UAE Dirham</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Issue Date</Label>
              <Input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-2 pt-1 border-t">
            <Label className="text-xs font-semibold">Line Items</Label>
            <LineItemsEditor items={lineItems} onChange={setLineItems} />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">Notes / Terms</Label>
            <Textarea
              rows={2}
              placeholder="Payment terms, notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create Invoice"}
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
// Create Quote Dialog
// ---------------------------------------------------------------------------

interface CreateQuoteDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  customers: BusinessEntityRow[];
}

function CreateQuoteDialog({
  open,
  onOpenChange,
  companyId,
  customers,
}: CreateQuoteDialogProps) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso);
  const [expiryDate, setExpiryDate] = useState(thirtyDaysFromNow);
  const [currency, setCurrency] = useState("SAR");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPrice: 0, taxRate: 15, total: 0 },
  ]);

  function reset() {
    setCustomerId("");
    setCustomerName("");
    setIssueDate(todayIso());
    setExpiryDate(thirtyDaysFromNow());
    setCurrency("SAR");
    setNotes("");
    setLineItems([{ description: "", quantity: 1, unitPrice: 0, taxRate: 15, total: 0 }]);
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const subtotal = lineItems.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
      const taxAmount = lineItems.reduce(
        (a, i) => a + i.quantity * i.unitPrice * (i.taxRate / 100),
        0,
      );
      const grandTotal = subtotal + taxAmount;
      const amountCents = Math.round(grandTotal * 100);

      const resolvedCustomerName =
        customers.find((c) => c.id === customerId)?.name ?? customerName;

      return businessApi.createEntity(companyId, "sales", "quote", {
        entityType: "quote",
        name: resolvedCustomerName ? `Quote – ${resolvedCustomerName}` : "New Quote",
        status: "draft",
        amountCents,
        currency,
        data: {
          customerId: customerId || null,
          customerName: resolvedCustomerName || null,
          issueDate,
          expiryDate,
          taxAmount,
          notes,
          lineItems,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "quote"),
      });
      onOpenChange(false);
      reset();
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Quote</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Customer</Label>
              {customers.length > 0 ? (
                <Select
                  value={customerId}
                  onValueChange={(v) => {
                    setCustomerId(v);
                    setCustomerName(customers.find((c) => c.id === v)?.name ?? "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual__">Enter manually…</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="Customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              )}
              {customerId === "__manual__" && (
                <Input
                  placeholder="Customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="mt-1.5"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SAR">SAR – Saudi Riyal</SelectItem>
                  <SelectItem value="USD">USD – US Dollar</SelectItem>
                  <SelectItem value="EUR">EUR – Euro</SelectItem>
                  <SelectItem value="AED">AED – UAE Dirham</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Issue Date</Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Expiry Date</Label>
              <Input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2 pt-1 border-t">
            <Label className="text-xs font-semibold">Line Items</Label>
            <LineItemsEditor items={lineItems} onChange={setLineItems} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={2}
              placeholder="Notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create Quote"}
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
// Create Customer Dialog
// ---------------------------------------------------------------------------

interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
}

function CreateCustomerDialog({ open, onOpenChange, companyId }: CreateCustomerDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [taxNumber, setTaxNumber] = useState("");

  function reset() {
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setTaxNumber("");
  }

  const createMutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "sales", "customer", {
        entityType: "customer",
        name,
        status: "active",
        data: {
          email,
          phone,
          address,
          taxNumber,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "customer"),
      });
      onOpenChange(false);
      reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Customer</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name *</Label>
            <Input
              placeholder="Customer or company name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              placeholder="billing@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Phone</Label>
            <Input
              placeholder="+966 5x xxx xxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Address</Label>
            <Textarea
              rows={2}
              placeholder="Billing address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">VAT / Tax Number</Label>
            <Input
              placeholder="Tax registration number"
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create Customer"}
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
// Record Payment Dialog
// ---------------------------------------------------------------------------

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  invoices: BusinessEntityRow[];
  preselectedInvoiceId?: string;
  onSuccess?: () => void;
}

function RecordPaymentDialog({
  open,
  onOpenChange,
  companyId,
  invoices,
  preselectedInvoiceId,
  onSuccess,
}: RecordPaymentDialogProps) {
  const queryClient = useQueryClient();
  const [invoiceId, setInvoiceId] = useState(preselectedInvoiceId ?? "");
  const [method, setMethod] = useState("bank_transfer");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso);
  const [reference, setReference] = useState("");

  // Sync preselection
  useEffect(() => {
    if (open) {
      setInvoiceId(preselectedInvoiceId ?? "");
      const inv = invoices.find((i) => i.id === preselectedInvoiceId);
      if (inv && inv.amountCents) {
        setAmount(String((inv.amountCents / 100).toFixed(2)));
      }
      setPaymentDate(todayIso());
    }
  }, [open, preselectedInvoiceId, invoices]);

  // Auto-fill amount when invoice changes
  function handleInvoiceChange(id: string) {
    setInvoiceId(id);
    const inv = invoices.find((i) => i.id === id);
    if (inv && inv.amountCents) {
      setAmount(String((inv.amountCents / 100).toFixed(2)));
    }
  }

  function reset() {
    setInvoiceId("");
    setMethod("bank_transfer");
    setAmount("");
    setPaymentDate(todayIso());
    setReference("");
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const inv = invoices.find((i) => i.id === invoiceId);
      const amountCents = Math.round(Number(amount) * 100);

      // Create payment entity
      await businessApi.createEntity(companyId, "sales", "payment", {
        entityType: "payment",
        name: inv ? `Payment – ${inv.name ?? inv.code ?? "Invoice"}` : "Payment",
        status: "completed",
        amountCents,
        currency: inv?.currency ?? "SAR",
        data: {
          invoiceId,
          invoiceCode: inv?.code,
          method,
          paymentDate,
          reference,
        },
      });

      // Update invoice status to paid
      if (invoiceId) {
        await businessApi.updateStatus(companyId, "sales", "invoice", invoiceId, "paid");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "invoice"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "payment"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
      onOpenChange(false);
      reset();
      onSuccess?.();
    },
  });

  const unpaidInvoices = invoices.filter((i) => i.status !== "paid" && i.status !== "void");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Invoice</Label>
            <Select value={invoiceId} onValueChange={handleInvoiceChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select invoice…" />
              </SelectTrigger>
              <SelectContent>
                {unpaidInvoices.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    {inv.code ?? inv.id.slice(0, 8)} –{" "}
                    {inv.name ?? "Invoice"}{" "}
                    {inv.amountCents ? `(${formatCurrency(inv.amountCents, inv.currency ?? "SAR")})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Payment Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="wallet">Digital Wallet</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Payment Date</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Reference / Note</Label>
            <Input
              placeholder="Transaction ID or note"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!invoiceId || !amount || createMutation.isPending}
          >
            {createMutation.isPending ? "Recording…" : "Record Payment"}
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
// Invoice Detail View
// ---------------------------------------------------------------------------

interface InvoiceDetailProps {
  invoice: BusinessEntityRow;
  companyId: string;
  onBack: () => void;
  onRecordPayment: (invoiceId: string) => void;
}

function InvoiceDetail({ invoice, companyId, onBack, onRecordPayment }: InvoiceDetailProps) {
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);

  const data = invoice.data as Record<string, unknown>;
  const lineItems = (data.lineItems as LineItem[] | undefined) ?? [];
  const subtotal = lineItems.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const taxTotal = lineItems.reduce(
    (a, i) => a + i.quantity * i.unitPrice * (i.taxRate / 100),
    0,
  );
  const grandTotal = subtotal + taxTotal;

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      businessApi.updateStatus(companyId, "sales", "invoice", invoice.id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "invoice"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
    },
  });

  function handlePrint() {
    window.print();
  }

  const canSend = invoice.status === "draft";
  const canPay = invoice.status === "sent" || invoice.status === "overdue";
  const canVoid = invoice.status !== "void" && invoice.status !== "paid";

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          {canSend && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => statusMutation.mutate("sent")}
              disabled={statusMutation.isPending}
            >
              Mark as Sent
            </Button>
          )}
          {canPay && (
            <Button
              size="sm"
              onClick={() => onRecordPayment(invoice.id)}
            >
              <CreditCard className="h-3.5 w-3.5 mr-1.5" />
              Record Payment
            </Button>
          )}
          {canVoid && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => statusMutation.mutate("void")}
              disabled={statusMutation.isPending}
            >
              Void
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            Print
          </Button>
          <ZatcaBadge
            invoice={{
              issueTimestamp: (data.issueDate as string | undefined) ?? null,
              subtotalCents: Math.round(subtotal * 100),
              vatCents: Math.round(taxTotal * 100),
              totalCents: invoice.amountCents ?? Math.round(grandTotal * 100),
            }}
          />
          <ExportMenu.Invoice invoiceId={invoice.id} companyId={companyId} />
        </div>
      </div>

      {/* Invoice document */}
      <div ref={printRef}>
        <Card className="overflow-hidden">
          {/* Header */}
          <div className="bg-muted/30 border-b px-8 py-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <span className="text-lg font-bold">INVOICE</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Issued by your company
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold font-mono text-foreground">
                  {invoice.code ?? invoice.id.slice(0, 12)}
                </p>
                <div className="mt-1.5">
                  <InvoiceStatusBadge status={invoice.status} />
                </div>
              </div>
            </div>

            {/* Date row */}
            <div className="mt-4 flex items-center gap-6 text-sm">
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  Issue Date
                </span>
                <p className="font-medium">{formatDate(data.issueDate as string | undefined)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  Due Date
                </span>
                <p
                  className={`font-medium ${
                    invoice.status === "overdue" ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {formatDate(data.dueDate as string | undefined)}
                </p>
              </div>
              {!!invoice.currency && (
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    Currency
                  </span>
                  <p className="font-medium">{invoice.currency}</p>
                </div>
              )}
            </div>
          </div>

          <CardContent className="p-8">
            {/* From / To */}
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  From
                </p>
                <p className="font-semibold text-sm">Your Company</p>
                <p className="text-sm text-muted-foreground">your@company.com</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Bill To
                </p>
                <p className="font-semibold text-sm">
                  {(data.customerName as string | undefined) ?? invoice.name ?? "Customer"}
                </p>
                {(data.customerEmail as string | undefined) && (
                  <p className="text-sm text-muted-foreground">{data.customerEmail as string}</p>
                )}
                {(data.customerAddress as string | undefined) && (
                  <p className="text-sm text-muted-foreground whitespace-pre-line">
                    {data.customerAddress as string}
                  </p>
                )}
              </div>
            </div>

            <Separator className="mb-6" />

            {/* Line items table */}
            {lineItems.length > 0 ? (
              <div className="mb-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-3">
                        Description
                      </th>
                      <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-3 w-14">
                        Qty
                      </th>
                      <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-3 w-28">
                        Unit Price
                      </th>
                      <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-3 w-16">
                        Tax
                      </th>
                      <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-3 w-28">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lineItems.map((item, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="py-3 pr-4">{item.description || "—"}</td>
                        <td className="py-3 text-right tabular-nums">{item.quantity}</td>
                        <td className="py-3 text-right font-mono tabular-nums">
                          {formatAmount(item.unitPrice, invoice.currency ?? "SAR")}
                        </td>
                        <td className="py-3 text-right text-muted-foreground">
                          {item.taxRate}%
                        </td>
                        <td className="py-3 text-right font-mono tabular-nums font-medium">
                          {formatAmount(item.total, invoice.currency ?? "SAR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              invoice.amountCents != null && (
                <div className="mb-6 py-4 text-sm text-muted-foreground">
                  No line items recorded.
                </div>
              )
            )}

            {/* Totals */}
            <div className="flex justify-end mb-6">
              <div className="w-72 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-mono tabular-nums">
                    {lineItems.length > 0
                      ? formatAmount(subtotal, invoice.currency ?? "SAR")
                      : invoice.amountCents != null
                        ? formatCurrency(invoice.amountCents, invoice.currency ?? "SAR")
                        : "—"}
                  </span>
                </div>
                {taxTotal > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">VAT</span>
                    <span className="font-mono tabular-nums">
                      {formatAmount(taxTotal, invoice.currency ?? "SAR")}
                    </span>
                  </div>
                )}
                {(data.taxAmount as number | undefined) != null && lineItems.length === 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="font-mono tabular-nums">
                      {formatAmount(data.taxAmount as number, invoice.currency ?? "SAR")}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="font-semibold">Total</span>
                  <span className="font-bold text-lg font-mono tabular-nums">
                    {lineItems.length > 0
                      ? formatAmount(grandTotal, invoice.currency ?? "SAR")
                      : invoice.amountCents != null
                        ? formatCurrency(invoice.amountCents, invoice.currency ?? "SAR")
                        : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment status indicator */}
            {invoice.status === "paid" && (
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3 mb-4">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Payment Received
                </span>
              </div>
            )}
            {invoice.status === "overdue" && (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 mb-4">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                <span className="text-sm font-medium text-red-700 dark:text-red-400">
                  Payment Overdue
                </span>
              </div>
            )}

            {/* Notes */}
            {(data.notes as string | undefined) && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Notes / Terms
                </p>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {data.notes as string}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 mt-6">
        <AIBrainPanel
          companyId={companyId}
          moduleKey="sales"
          entityType="invoice"
          entityId={invoice.id}
        />
        <AttachmentList entityId={invoice.id} companyId={companyId} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoices Tab
// ---------------------------------------------------------------------------

interface InvoicesTabProps {
  companyId: string;
  customers: BusinessEntityRow[];
  onViewInvoice: (invoice: BusinessEntityRow) => void;
  onRecordPayment: (invoiceId: string) => void;
}

function InvoicesTab({ companyId, customers, onViewInvoice, onRecordPayment }: InvoicesTabProps) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const invoicesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "sales", "invoice", q),
    queryFn: () => businessApi.listEntities(companyId, "sales", "invoice", { q: q || undefined }),
  });

  const invoices = invoicesQuery.data?.entities ?? [];

  const filtered = useMemo(() => {
    if (statusFilter === "all") return invoices;
    return invoices.filter((i) => i.status === statusFilter);
  }, [invoices, statusFilter]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessApi.deleteEntity(companyId, "sales", "invoice", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "invoice"),
      });
    },
  });

  if (invoicesQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      {invoices.length > 0 && <SummaryStrip invoices={invoices} />}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search invoices…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "draft", "sent", "paid", "overdue", "void"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors border ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onRecordPayment("")}>
            <CreditCard className="h-3.5 w-3.5 mr-1.5" />
            Record Payment
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Invoice
          </Button>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          message={
            invoices.length === 0
              ? "No invoices yet. Create your first invoice to get started."
              : "No invoices match your filter."
          }
          action={invoices.length === 0 ? "New Invoice" : undefined}
          onAction={invoices.length === 0 ? () => setCreateOpen(true) : undefined}
        />
      ) : (
        <div className="border rounded-lg divide-y overflow-hidden">
          {filtered.map((invoice) => {
            const d = invoice.data as Record<string, unknown>;
            return (
              <div
                key={invoice.id}
                className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 group cursor-pointer"
                onClick={() => onViewInvoice(invoice)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {invoice.code ?? invoice.id.slice(0, 8)}
                    </span>
                    <span className="font-medium text-sm truncate">
                      {(d.customerName as string | undefined) ?? invoice.name ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    {!!d.issueDate && (
                      <span>Issued {formatDate(d.issueDate as string)}</span>
                    )}
                    {!!d.dueDate && (
                      <span
                        className={
                          invoice.status === "overdue"
                            ? "text-red-500 dark:text-red-400"
                            : ""
                        }
                      >
                        Due {formatDate(d.dueDate as string)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {invoice.amountCents != null && (
                    <span className="font-mono font-medium text-sm tabular-nums">
                      {formatCurrency(invoice.amountCents, invoice.currency ?? "SAR")}
                    </span>
                  )}
                  <InvoiceStatusBadge status={invoice.status} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(invoice.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
        customers={customers}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quotes Tab
// ---------------------------------------------------------------------------

interface QuotesTabProps {
  companyId: string;
  customers: BusinessEntityRow[];
}

function QuotesTab({ companyId, customers }: QuotesTabProps) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const quotesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "sales", "quote", q),
    queryFn: () => businessApi.listEntities(companyId, "sales", "quote", { q: q || undefined }),
  });

  const quotes = quotesQuery.data?.entities ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessApi.deleteEntity(companyId, "sales", "quote", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "quote"),
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      businessApi.updateStatus(companyId, "sales", "quote", id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "quote"),
      });
    },
  });

  if (quotesQuery.isLoading) return <PageSkeleton variant="list" />;

  const totalQuoteValue = quotes
    .filter((q) => q.status !== "rejected" && q.status !== "expired")
    .reduce((a, q) => a + (q.amountCents ?? 0), 0);

  const acceptedCount = quotes.filter((q) => q.status === "accepted").length;

  return (
    <div className="space-y-4">
      {quotes.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Quotes</p>
              <p className="text-xl font-bold mt-1">{quotes.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Pipeline Value</p>
              <p className="text-xl font-bold mt-1">{formatCurrency(totalQuoteValue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Accepted</p>
              <p className="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                {acceptedCount}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search quotes…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="ml-auto">
          <Plus className="h-4 w-4 mr-1.5" />
          New Quote
        </Button>
      </div>

      {quotes.length === 0 ? (
        <EmptyState
          icon={FileText}
          message="No quotes yet. Create your first quote to start winning business."
          action="New Quote"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="border rounded-lg divide-y overflow-hidden">
          {quotes.map((quote) => {
            const d = quote.data as Record<string, unknown>;
            return (
              <div
                key={quote.id}
                className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {quote.code ?? quote.id.slice(0, 8)}
                    </span>
                    <span className="font-medium text-sm truncate">
                      {(d.customerName as string | undefined) ?? quote.name ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    {!!d.issueDate && <span>Issued {formatDate(d.issueDate as string)}</span>}
                    {!!d.expiryDate && (
                      <span
                        className={
                          quote.status === "expired" ? "text-amber-500 dark:text-amber-400" : ""
                        }
                      >
                        Expires {formatDate(d.expiryDate as string)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {quote.amountCents != null && (
                    <span className="font-mono font-medium text-sm tabular-nums">
                      {formatCurrency(quote.amountCents, quote.currency ?? "SAR")}
                    </span>
                  )}
                  <QuoteStatusBadge status={quote.status} />

                  {/* Quick actions */}
                  {quote.status === "draft" && (
                    <button
                      className="opacity-0 group-hover:opacity-100 text-xs text-blue-600 dark:text-blue-400 hover:underline transition-opacity"
                      onClick={() => statusMutation.mutate({ id: quote.id, status: "sent" })}
                    >
                      Mark Sent
                    </button>
                  )}
                  {quote.status === "sent" && (
                    <>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-xs text-emerald-600 dark:text-emerald-400 hover:underline transition-opacity"
                        onClick={() => statusMutation.mutate({ id: quote.id, status: "accepted" })}
                      >
                        Accept
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:underline transition-opacity"
                        onClick={() => statusMutation.mutate({ id: quote.id, status: "rejected" })}
                      >
                        Reject
                      </button>
                    </>
                  )}

                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                    onClick={() => deleteMutation.mutate(quote.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateQuoteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
        customers={customers}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customers Tab
// ---------------------------------------------------------------------------

interface CustomersTabProps {
  companyId: string;
  invoices: BusinessEntityRow[];
}

function CustomersTab({ companyId, invoices }: CustomersTabProps) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const customersQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "sales", "customer", q),
    queryFn: () => businessApi.listEntities(companyId, "sales", "customer", { q: q || undefined }),
  });

  const customers = customersQuery.data?.entities ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessApi.deleteEntity(companyId, "sales", "customer", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "customer"),
      });
    },
  });

  // Calculate outstanding balance per customer from invoices
  const customerBalances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const inv of invoices) {
      if (inv.status === "sent" || inv.status === "overdue") {
        const cid = (inv.data as Record<string, unknown>).customerId as string | undefined;
        if (cid) {
          map[cid] = (map[cid] ?? 0) + (inv.amountCents ?? 0);
        }
      }
    }
    return map;
  }, [invoices]);

  if (customersQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search customers…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="ml-auto">
          <Plus className="h-4 w-4 mr-1.5" />
          New Customer
        </Button>
      </div>

      {customers.length === 0 ? (
        <EmptyState
          icon={Users}
          message="No customers yet. Add your first customer to start invoicing."
          action="New Customer"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="border rounded-lg divide-y overflow-hidden">
          {customers.map((customer) => {
            const d = customer.data as Record<string, unknown>;
            const outstanding = customerBalances[customer.id] ?? 0;
            const invoiceCount = invoices.filter(
              (i) => (i.data as Record<string, unknown>).customerId === customer.id,
            ).length;

            return (
              <div
                key={customer.id}
                className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 group"
              >
                {/* Avatar */}
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {(customer.name ?? "?").charAt(0).toUpperCase()}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{customer.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                    {!!d.email && <span>{d.email as string}</span>}
                    {!!d.phone && <span>{d.phone as string}</span>}
                    {invoiceCount > 0 && (
                      <span>
                        {invoiceCount} invoice{invoiceCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {outstanding > 0 && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Outstanding</p>
                      <p className="text-sm font-mono font-medium text-amber-600 dark:text-amber-400 tabular-nums">
                        {formatCurrency(outstanding)}
                      </p>
                    </div>
                  )}
                  {!!d.taxNumber && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {d.taxNumber as string}
                    </span>
                  )}
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                    onClick={() => deleteMutation.mutate(customer.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payments Tab
// ---------------------------------------------------------------------------

interface PaymentsTabProps {
  companyId: string;
  invoices: BusinessEntityRow[];
  onRecordPayment: () => void;
}

function PaymentsTab({ companyId, invoices, onRecordPayment }: PaymentsTabProps) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");

  const paymentsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "sales", "payment", q),
    queryFn: () => businessApi.listEntities(companyId, "sales", "payment", { q: q || undefined }),
  });

  const payments = paymentsQuery.data?.entities ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessApi.deleteEntity(companyId, "sales", "payment", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "sales", "payment"),
      });
    },
  });

  const totalReceived = payments.reduce((a, p) => a + (p.amountCents ?? 0), 0);
  const thisMonthReceived = payments
    .filter((p) => {
      const d = p.data as Record<string, unknown>;
      return isThisMonth(d.paymentDate as string | undefined);
    })
    .reduce((a, p) => a + (p.amountCents ?? 0), 0);

  const methodLabels: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    card: "Card",
    wallet: "Wallet",
    cheque: "Cheque",
  };

  if (paymentsQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      {payments.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Received</p>
              <p className="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                {formatCurrency(totalReceived)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">This Month</p>
              <p className="text-xl font-bold mt-1">{formatCurrency(thisMonthReceived)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search payments…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={onRecordPayment} className="ml-auto">
          <Plus className="h-4 w-4 mr-1.5" />
          Record Payment
        </Button>
      </div>

      {payments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          message="No payments recorded yet."
          action="Record Payment"
          onAction={onRecordPayment}
        />
      ) : (
        <div className="border rounded-lg divide-y overflow-hidden">
          {payments.map((payment) => {
            const d = payment.data as Record<string, unknown>;
            return (
              <div
                key={payment.id}
                className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 group"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <CreditCard className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {payment.name ?? "Payment"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                    {!!d.paymentDate && <span>{formatDate(d.paymentDate as string)}</span>}
                    {!!d.method && (
                      <span>{methodLabels[d.method as string] ?? (d.method as string)}</span>
                    )}
                    {!!d.invoiceCode && (
                      <span className="font-mono">{d.invoiceCode as string}</span>
                    )}
                    {!!d.reference && <span>Ref: {d.reference as string}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {payment.amountCents != null && (
                    <span className="font-mono font-semibold text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{formatCurrency(payment.amountCents, payment.currency ?? "SAR")}
                    </span>
                  )}
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                    onClick={() => deleteMutation.mutate(payment.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
// Main Page
// ---------------------------------------------------------------------------

export function BusinessSalesPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  const [activeTab, setActiveTab] = useState("invoices");
  const [selectedInvoice, setSelectedInvoice] = useState<BusinessEntityRow | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentPreselectedId, setPaymentPreselectedId] = useState<string | undefined>(undefined);

  const companyId = selectedCompanyId;

  useEffect(() => {
    const crumbs: { label: string; href?: string }[] = [
      { label: "Business", href: "/business" },
      { label: "Sales", href: "/business/sales" },
    ];
    if (selectedInvoice) {
      crumbs.push({ label: selectedInvoice.code ?? "Invoice" });
    }
    setBreadcrumbs(crumbs);
  }, [setBreadcrumbs, selectedInvoice]);

  // Prefetch invoices and customers for use across tabs
  const invoicesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId!, "sales", "invoice"),
    queryFn: () => businessApi.listEntities(companyId!, "sales", "invoice"),
    enabled: !!companyId,
  });

  const customersQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId!, "sales", "customer"),
    queryFn: () => businessApi.listEntities(companyId!, "sales", "customer"),
    enabled: !!companyId,
  });

  const invoices = invoicesQuery.data?.entities ?? [];
  const customers = customersQuery.data?.entities ?? [];

  function handleViewInvoice(invoice: BusinessEntityRow) {
    setSelectedInvoice(invoice);
  }

  function handleBackFromInvoice() {
    setSelectedInvoice(null);
  }

  function handleRecordPayment(invoiceId?: string) {
    setPaymentPreselectedId(invoiceId || undefined);
    setPaymentDialogOpen(true);
  }

  if (!companyId) {
    return <EmptyState icon={Receipt} message="Select a workspace first." />;
  }

  if (invoicesQuery.isLoading && customersQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  // Invoice detail view
  if (selectedInvoice) {
    return (
      <div className="space-y-4">
        <InvoiceDetail
          invoice={selectedInvoice}
          companyId={companyId}
          onBack={handleBackFromInvoice}
          onRecordPayment={(id) => handleRecordPayment(id)}
        />

        <RecordPaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          companyId={companyId}
          invoices={invoices}
          preselectedInvoiceId={paymentPreselectedId}
          onSuccess={() => {
            // Refresh the selected invoice after payment
            setSelectedInvoice(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">Sales</h1>
          <p className="text-sm text-muted-foreground">
            Invoices, quotes, customers & payments
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="invoices" className="flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="quotes" className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Quotes
          </TabsTrigger>
          <TabsTrigger value="customers" className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Customers
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" />
            Payments
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4">
          <InvoicesTab
            companyId={companyId}
            customers={customers}
            onViewInvoice={handleViewInvoice}
            onRecordPayment={(id) => handleRecordPayment(id)}
          />
        </TabsContent>

        <TabsContent value="quotes" className="mt-4">
          <QuotesTab companyId={companyId} customers={customers} />
        </TabsContent>

        <TabsContent value="customers" className="mt-4">
          <CustomersTab companyId={companyId} invoices={invoices} />
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <PaymentsTab
            companyId={companyId}
            invoices={invoices}
            onRecordPayment={() => handleRecordPayment()}
          />
        </TabsContent>
      </Tabs>

      {/* Record Payment dialog (accessible from any tab) */}
      <RecordPaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        companyId={companyId}
        invoices={invoices}
        preselectedInvoiceId={paymentPreselectedId}
      />
    </div>
  );
}
