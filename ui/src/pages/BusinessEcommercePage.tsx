import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag,
  Store,
  Tag,
  Globe,
  Plus,
  Trash2,
  TrendingUp,
  DollarSign,
  Package,
  BarChart3,
  CreditCard,
  Percent,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type FulfillmentStatus =
  | "pending"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

interface StorefrontData {
  domain?: string;
  theme?: string;
  description?: string;
}

interface OrderItem {
  name?: string;
  quantity?: number;
  price?: number;
}

interface OrderData {
  customer?: string;
  items?: OrderItem[];
  shippingAddress?: string;
}

type DiscountType = "percentage" | "fixed";

interface DiscountData {
  code?: string;
  type?: DiscountType;
  value?: number;
  expiresAt?: string;
  usageCount?: number;
  usageLimit?: number;
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
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

function getStorefrontData(s: BusinessEntityRow): StorefrontData {
  return s.data as StorefrontData;
}
function getOrderData(o: BusinessEntityRow): OrderData {
  return o.data as OrderData;
}
function getDiscountData(d: BusinessEntityRow): DiscountData {
  return d.data as DiscountData;
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

const FULFILLMENT_CONFIG: Record<string, { label: string; color: string }> = {
  pending: {
    label: "Pending",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  },
  processing: {
    label: "Processing",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  },
  shipped: {
    label: "Shipped",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  },
  delivered: {
    label: "Delivered",
    color:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  },
  cancelled: {
    label: "Cancelled",
    color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  },
};

const FULFILLMENT_OPTIONS: FulfillmentStatus[] = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];

function FulfillmentBadge({ status }: { status: string }) {
  const cfg = FULFILLMENT_CONFIG[status] ?? FULFILLMENT_CONFIG["pending"]!;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Storefront Dialog
// ---------------------------------------------------------------------------

function StorefrontDialog({
  open,
  onOpenChange,
  companyId,
  storefront,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  storefront?: BusinessEntityRow | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!storefront;
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [theme, setTheme] = useState("");
  const [status, setStatus] = useState("active");
  const [currency, setCurrency] = useState("SAR");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      if (storefront) {
        const d = getStorefrontData(storefront);
        setName(storefront.name ?? "");
        setDomain(d.domain ?? "");
        setTheme(d.theme ?? "");
        setStatus(storefront.status);
        setCurrency(storefront.currency ?? "SAR");
        setDescription(d.description ?? "");
      } else {
        setName("");
        setDomain("");
        setTheme("");
        setStatus("active");
        setCurrency("SAR");
        setDescription("");
      }
    }
  }, [open, storefront]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = { domain, theme, description };
      const body = {
        entityType: "storefront",
        name,
        status,
        currency,
        data,
      };
      if (isEdit && storefront) {
        return businessApi.updateEntity(
          companyId,
          "ecommerce",
          "storefront",
          storefront.id,
          body,
        );
      }
      return businessApi.createEntity(
        companyId,
        "ecommerce",
        "storefront",
        body,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(
          companyId,
          "ecommerce",
          "storefront",
        ),
      });
      onOpenChange(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      businessApi.deleteEntity(
        companyId,
        "ecommerce",
        "storefront",
        storefront!.id,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(
          companyId,
          "ecommerce",
          "storefront",
        ),
      });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Storefront" : "New Storefront"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sf-name" className="text-xs">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sf-name"
              placeholder="e.g. Main store"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-domain" className="text-xs">
              Domain
            </Label>
            <Input
              id="sf-domain"
              placeholder="e.g. shop.example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sf-theme" className="text-xs">
                Theme
              </Label>
              <Input
                id="sf-theme"
                placeholder="e.g. Modern"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SAR">SAR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="AED">AED</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
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
// Discount Dialog
// ---------------------------------------------------------------------------

function DiscountDialog({
  open,
  onOpenChange,
  companyId,
  discount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  discount?: BusinessEntityRow | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!discount;
  const [code, setCode] = useState("");
  const [type, setType] = useState<DiscountType>("percentage");
  const [value, setValue] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (open) {
      if (discount) {
        const d = getDiscountData(discount);
        setCode(d.code ?? "");
        setType(d.type ?? "percentage");
        setValue(d.value != null ? String(d.value) : "");
        setExpiresAt(d.expiresAt ? d.expiresAt.slice(0, 10) : "");
        setUsageLimit(d.usageLimit != null ? String(d.usageLimit) : "");
        setActive(discount.status === "active");
      } else {
        setCode("");
        setType("percentage");
        setValue("");
        setExpiresAt("");
        setUsageLimit("");
        setActive(true);
      }
    }
  }, [open, discount]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {
        code: code.toUpperCase(),
        type,
        value: value ? Number(value) : 0,
        expiresAt: expiresAt || undefined,
        usageCount: discount ? (getDiscountData(discount).usageCount ?? 0) : 0,
        usageLimit: usageLimit ? Number(usageLimit) : undefined,
      };
      const body = {
        entityType: "discount_code",
        name: code.toUpperCase(),
        status: active ? "active" : "inactive",
        data,
      };
      if (isEdit && discount) {
        return businessApi.updateEntity(
          companyId,
          "ecommerce",
          "discount_code",
          discount.id,
          body,
        );
      }
      return businessApi.createEntity(
        companyId,
        "ecommerce",
        "discount_code",
        body,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(
          companyId,
          "ecommerce",
          "discount_code",
        ),
      });
      onOpenChange(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      businessApi.deleteEntity(
        companyId,
        "ecommerce",
        "discount_code",
        discount!.id,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(
          companyId,
          "ecommerce",
          "discount_code",
        ),
      });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Discount" : "New Discount Code"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-code" className="text-xs">
              Code <span className="text-destructive">*</span>
            </Label>
            <Input
              id="d-code"
              placeholder="e.g. SUMMER25"
              className="font-mono uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as DiscountType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-value" className="text-xs">
                Value
              </Label>
              <Input
                id="d-value"
                type="number"
                step="0.01"
                placeholder={type === "percentage" ? "10" : "50.00"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-expires" className="text-xs">
                Expires
              </Label>
              <Input
                id="d-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-limit" className="text-xs">
                Usage limit
              </Label>
              <Input
                id="d-limit"
                type="number"
                placeholder="Unlimited"
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span className="text-sm">Active</span>
          </label>
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
              disabled={!code.trim() || saveMutation.isPending}
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
// Analytics Tab
// ---------------------------------------------------------------------------

function AnalyticsTab({ orders }: { orders: BusinessEntityRow[] }) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const revenueThisMonth = orders
    .filter((o) => {
      const d = new Date(o.createdAt);
      return (
        d.getMonth() === currentMonth &&
        d.getFullYear() === currentYear &&
        o.status !== "cancelled"
      );
    })
    .reduce((sum, o) => sum + (o.amountCents ?? 0), 0);

  const nonCancelled = orders.filter((o) => o.status !== "cancelled");
  const totalRevenue = nonCancelled.reduce(
    (sum, o) => sum + (o.amountCents ?? 0),
    0,
  );
  const aov =
    nonCancelled.length > 0 ? totalRevenue / nonCancelled.length : 0;

  const dailyData = useMemo(() => {
    const days: { label: string; date: Date; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push({
        label: d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        date: d,
        count: 0,
      });
    }
    for (const o of orders) {
      const od = new Date(o.createdAt);
      od.setHours(0, 0, 0, 0);
      const day = days.find((d) => d.date.getTime() === od.getTime());
      if (day) day.count += 1;
    }
    return days;
  }, [orders]);

  const maxDaily = Math.max(1, ...dailyData.map((d) => d.count));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <Package className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Total orders</p>
              <p className="text-lg font-bold tabular-nums">{orders.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <DollarSign className="h-4 w-4 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Revenue this mo.</p>
              <p className="text-lg font-bold tabular-nums text-emerald-600">
                {formatSar(revenueThisMonth)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Avg. order value</p>
              <p className="text-lg font-bold tabular-nums">
                {formatSar(aov)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-purple-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Delivered</p>
              <p className="text-lg font-bold tabular-nums">
                {orders.filter((o) => o.status === "delivered").length}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Orders · last 14 days</h3>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No orders yet.
            </p>
          ) : (
            <div className="flex items-end gap-1 h-40 pt-2">
              {dailyData.map((day, i) => {
                const heightPct = (day.count / maxDaily) * 100;
                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center gap-1 group"
                    title={`${day.label}: ${day.count}`}
                  >
                    <span className="text-[10px] text-muted-foreground tabular-nums opacity-0 group-hover:opacity-100">
                      {day.count}
                    </span>
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className="w-full bg-primary/80 hover:bg-primary rounded-t transition-colors"
                        style={{
                          height: `${Math.max(heightPct, day.count > 0 ? 4 : 0)}%`,
                          minHeight: day.count > 0 ? "4px" : "0",
                        }}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground tabular-nums">
                      {day.label.split(" ")[1]}
                    </span>
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
// Orders Row
// ---------------------------------------------------------------------------

function OrderRow({
  order,
  companyId,
  onDelete,
}: {
  order: BusinessEntityRow;
  companyId: string;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const data = getOrderData(order);
  const itemCount = data.items?.length ?? 0;

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      businessApi.updateStatus(
        companyId,
        "ecommerce",
        "online_order",
        order.id,
        status,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(
          companyId,
          "ecommerce",
          "online_order",
        ),
      });
    },
  });

  return (
    <div className="grid grid-cols-[100px_1fr_60px_120px_140px_100px_36px] items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 group">
      <span className="font-mono text-[11px] text-muted-foreground truncate">
        {order.code ?? "—"}
      </span>
      <span className="text-sm truncate">{data.customer ?? "—"}</span>
      <span className="text-xs text-muted-foreground tabular-nums text-center">
        {itemCount}
      </span>
      <span className="text-sm font-medium tabular-nums">
        {formatSar(order.amountCents)}
      </span>
      <Select
        value={order.status}
        onValueChange={(v) => statusMutation.mutate(v)}
        disabled={statusMutation.isPending}
      >
        <SelectTrigger className="h-7 text-xs w-full">
          <SelectValue>
            <FulfillmentBadge status={order.status} />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {FULFILLMENT_OPTIONS.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {FULFILLMENT_CONFIG[s]!.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">
        {timeAgo(order.createdAt)}
      </span>
      <button
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all"
        onClick={onDelete}
        title="Delete order"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function BusinessEcommercePage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("storefronts");
  const [storefrontDialogOpen, setStorefrontDialogOpen] = useState(false);
  const [editingStorefront, setEditingStorefront] =
    useState<BusinessEntityRow | null>(null);
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] =
    useState<BusinessEntityRow | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "E-commerce" },
    ]);
  }, [setBreadcrumbs]);

  const storefrontsQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      "ecommerce",
      "storefront",
    ),
    queryFn: () =>
      businessApi.listEntities(selectedCompanyId!, "ecommerce", "storefront"),
    enabled: !!selectedCompanyId,
  });

  const ordersQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      "ecommerce",
      "online_order",
    ),
    queryFn: () =>
      businessApi.listEntities(selectedCompanyId!, "ecommerce", "online_order"),
    enabled: !!selectedCompanyId,
  });

  const discountsQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      "ecommerce",
      "discount_code",
    ),
    queryFn: () =>
      businessApi.listEntities(
        selectedCompanyId!,
        "ecommerce",
        "discount_code",
      ),
    enabled: !!selectedCompanyId,
  });

  const deleteOrderMutation = useMutation({
    mutationFn: (id: string) =>
      businessApi.deleteEntity(
        selectedCompanyId!,
        "ecommerce",
        "online_order",
        id,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(
          selectedCompanyId!,
          "ecommerce",
          "online_order",
        ),
      });
    },
  });

  const companyId = selectedCompanyId;

  if (!companyId) {
    return (
      <EmptyState icon={ShoppingBag} message="Select a workspace first." />
    );
  }

  if (
    storefrontsQuery.isLoading ||
    ordersQuery.isLoading ||
    discountsQuery.isLoading
  ) {
    return <PageSkeleton variant="list" />;
  }

  const storefronts = storefrontsQuery.data?.entities ?? [];
  const orders = ordersQuery.data?.entities ?? [];
  const discounts = discountsQuery.data?.entities ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">E-commerce</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage online stores, orders, and promotions
          </p>
        </div>
        {activeTab === "storefronts" && (
          <Button
            size="sm"
            onClick={() => {
              setEditingStorefront(null);
              setStorefrontDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Storefront
          </Button>
        )}
        {activeTab === "discounts" && (
          <Button
            size="sm"
            onClick={() => {
              setEditingDiscount(null);
              setDiscountDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Discount
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="storefronts">
            <Store className="h-4 w-4 mr-1.5" />
            Storefronts
          </TabsTrigger>
          <TabsTrigger value="orders">
            <Package className="h-4 w-4 mr-1.5" />
            Online Orders
          </TabsTrigger>
          <TabsTrigger value="discounts">
            <Tag className="h-4 w-4 mr-1.5" />
            Discounts
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="h-4 w-4 mr-1.5" />
            Analytics
          </TabsTrigger>
        </TabsList>

        {/* Storefronts */}
        <TabsContent value="storefronts" className="mt-4">
          {storefronts.length === 0 ? (
            <EmptyState
              icon={Store}
              message="No storefronts yet. Set up your first online store to start selling."
              action="New Storefront"
              onAction={() => {
                setEditingStorefront(null);
                setStorefrontDialogOpen(true);
              }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {storefronts.map((sf) => {
                const d = getStorefrontData(sf);
                return (
                  <Card
                    key={sf.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      setEditingStorefront(sf);
                      setStorefrontDialogOpen(true);
                    }}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            <Store className="h-5 w-5" />
                          </div>
                          <p className="text-sm font-semibold truncate">
                            {sf.name ?? "Untitled"}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">
                          {sf.status}
                        </Badge>
                      </div>
                      {d.domain && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Globe className="h-3 w-3" />
                          <span className="truncate">{d.domain}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs pt-2 border-t">
                        <span className="text-muted-foreground">
                          Theme:{" "}
                          <span className="text-foreground font-medium">
                            {d.theme || "Default"}
                          </span>
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {sf.currency ?? "SAR"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Orders */}
        <TabsContent value="orders" className="mt-4">
          {orders.length === 0 ? (
            <EmptyState icon={Package} message="No online orders yet." />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[100px_1fr_60px_120px_140px_100px_36px] items-center gap-3 px-4 py-2 bg-muted/50 border-b">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Code
                </span>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Customer
                </span>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-center">
                  Items
                </span>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Amount
                </span>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </span>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Date
                </span>
                <span />
              </div>
              <div className="divide-y">
                {orders.map((o) => (
                  <OrderRow
                    key={o.id}
                    order={o}
                    companyId={companyId}
                    onDelete={() => deleteOrderMutation.mutate(o.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Discounts */}
        <TabsContent value="discounts" className="mt-4">
          {discounts.length === 0 ? (
            <EmptyState
              icon={Tag}
              message="No discount codes yet."
              action="New Discount"
              onAction={() => {
                setEditingDiscount(null);
                setDiscountDialogOpen(true);
              }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {discounts.map((d) => {
                const data = getDiscountData(d);
                const isActive = d.status === "active";
                const isPercentage = data.type === "percentage";
                return (
                  <Card
                    key={d.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      setEditingDiscount(d);
                      setDiscountDialogOpen(true);
                    }}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-mono text-lg font-bold tracking-wide truncate">
                          {data.code ?? d.name ?? "—"}
                        </p>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            isActive
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            isPercentage
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                              : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400"
                          }`}
                        >
                          {isPercentage ? (
                            <Percent className="h-3 w-3" />
                          ) : (
                            <CreditCard className="h-3 w-3" />
                          )}
                          {isPercentage ? "Percentage" : "Fixed"}
                        </span>
                        <span className="text-lg font-bold tabular-nums">
                          {isPercentage
                            ? `${data.value ?? 0}%`
                            : formatSar((data.value ?? 0) * 100)}
                        </span>
                      </div>
                      <div className="space-y-1 pt-2 border-t">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Usage</span>
                          <span className="font-medium tabular-nums">
                            {`${data.usageCount ?? 0} / ${data.usageLimit ?? "∞"}`}
                          </span>
                        </div>
                        {data.expiresAt && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              Expires
                            </span>
                            <span className="font-medium">
                              {formatDate(data.expiresAt)}
                            </span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="mt-4">
          <AnalyticsTab orders={orders} />
        </TabsContent>
      </Tabs>

      <StorefrontDialog
        open={storefrontDialogOpen}
        onOpenChange={(o) => {
          setStorefrontDialogOpen(o);
          if (!o) setEditingStorefront(null);
        }}
        companyId={companyId}
        storefront={editingStorefront}
      />
      <DiscountDialog
        open={discountDialogOpen}
        onOpenChange={(o) => {
          setDiscountDialogOpen(o);
          if (!o) setEditingDiscount(null);
        }}
        companyId={companyId}
        discount={editingDiscount}
      />
    </div>
  );
}
