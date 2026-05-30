import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag,
  Plus,
  Trash2,
  Truck,
  Send,
  ReceiptText,
  Building2,
} from "lucide-react";
import {
  minorToMajor,
  majorToMinor,
  currencyFractionDigits,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useToast } from "../context/ToastContext";
import {
  purchasingApi,
  type PurchaseOrderRow,
  type VendorRow,
  type PoLineInput,
} from "../api/purchasing";
import { commerceApi, type WarehouseRow } from "../api/commerce";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

const DEFAULT_CURRENCY = "KWD";

const purchasingKeys = {
  vendors: (companyId: string) =>
    ["purchasing", "vendors", companyId] as const,
  orders: (companyId: string) => ["purchasing", "orders", companyId] as const,
  order: (companyId: string, poId: string) =>
    ["purchasing", "order", companyId, poId] as const,
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  received: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  billed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  closed: "bg-muted text-muted-foreground",
};

function formatMoney(amountMinor: number, currency: string): string {
  return minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: currencyFractionDigits(currency),
    maximumFractionDigits: currencyFractionDigits(currency),
  });
}

interface DraftLine {
  variantId: string;
  description: string;
  qty: string;
  unitPrice: string;
}

function emptyLine(): DraftLine {
  return { variantId: "", description: "", qty: "1", unitPrice: "0" };
}

export function Purchasing() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Purchasing" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={ShoppingBag}
        message="Select a workspace to manage purchasing."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Purchasing</h1>
        <p className="text-sm text-muted-foreground">
          Manage vendors, raise purchase orders, receive stock, and run a
          three-way match before paying bills.
        </p>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          <OrdersTab companyId={selectedCompanyId} />
        </TabsContent>
        <TabsContent value="vendors">
          <VendorsTab companyId={selectedCompanyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders tab
// ---------------------------------------------------------------------------

function OrdersTab({ companyId }: { companyId: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: purchasingKeys.orders(companyId),
    queryFn: () => purchasingApi.listOrders(companyId),
  });

  if (ordersQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (ordersQuery.isError) {
    return (
      <EmptyState
        icon={ShoppingBag}
        message={
          (ordersQuery.error as Error)?.message ??
          "Failed to load purchase orders. Try again."
        }
      />
    );
  }

  const orders = ordersQuery.data?.orders ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New purchase order
        </Button>
      </div>

      {orders.length === 0 ? (
        <EmptyState icon={ShoppingBag} message="No purchase orders yet." />
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <OrderRow
              key={order.id}
              companyId={companyId}
              order={order}
              expanded={expandedId === order.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === order.id ? null : order.id))
              }
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreatePoDialog
          companyId={companyId}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
    </div>
  );
}

function OrderRow({
  companyId,
  order,
  expanded,
  onToggle,
}: {
  companyId: string;
  order: PurchaseOrderRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const currency = order.currency ?? DEFAULT_CURRENCY;
  const tone = STATUS_TONE[order.status] ?? STATUS_TONE.draft;

  const detailQuery = useQuery({
    queryKey: purchasingKeys.order(companyId, order.id),
    queryFn: () => purchasingApi.getOrder(companyId, order.id),
    enabled: expanded,
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: purchasingKeys.orders(companyId),
    });
    queryClient.invalidateQueries({
      queryKey: purchasingKeys.order(companyId, order.id),
    });
  }

  const send = useMutation({
    mutationFn: () => purchasingApi.sendOrder(companyId, order.id),
    onSuccess: () => {
      pushToast({ title: "Purchase order sent", tone: "success" });
      invalidate();
    },
    onError: (error) =>
      pushToast({
        title: "Failed to send",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  const receive = useMutation({
    mutationFn: () => {
      const lines = (detailQuery.data?.lines ?? [])
        .filter((line) => line.variantId)
        .map((line) => ({
          variantId: line.variantId as string,
          qty: Math.max(line.qty - line.receivedQty, 0),
        }))
        .filter((line) => line.qty > 0);
      return purchasingApi.receiveOrder(companyId, order.id, { lines });
    },
    onSuccess: () => {
      pushToast({
        title: "Goods received — stock updated",
        tone: "success",
      });
      invalidate();
    },
    onError: (error) =>
      pushToast({
        title: "Failed to receive",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  const bill = useMutation({
    mutationFn: () =>
      purchasingApi.billOrder(companyId, order.id, {
        billAmountMinor: order.totalMinor,
      }),
    onSuccess: (result) => {
      pushToast({
        title: result.matched
          ? "Bill matched (3-way)"
          : "Bill variance flagged",
        body: result.matched
          ? "PO, receipt and bill agree within tolerance."
          : `Variance of ${formatMoney(result.variance, currency)} detected.`,
        tone: result.matched ? "success" : "error",
      });
      invalidate();
    },
    onError: (error) =>
      pushToast({
        title: "Failed to bill",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  const canReceive =
    expanded &&
    (detailQuery.data?.lines ?? []).some(
      (line) => line.variantId && line.qty - line.receivedQty > 0,
    );

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex-1 min-w-0 text-start"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">
                {order.number ?? `PO-${order.id.slice(0, 8)}`}
              </span>
              <Badge className={tone} variant="secondary">
                {order.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground font-mono mt-0.5">
              {formatMoney(order.totalMinor, currency)}
            </div>
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            {order.status === "draft" && (
              <Button
                size="sm"
                variant="outline"
                disabled={send.isPending}
                onClick={() => send.mutate()}
              >
                <Send className="me-1.5 h-3.5 w-3.5" />
                Send
              </Button>
            )}
            {order.status === "sent" && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canReceive || receive.isPending}
                onClick={() => receive.mutate()}
                title={
                  expanded
                    ? undefined
                    : "Expand the order to receive its lines"
                }
              >
                <Truck className="me-1.5 h-3.5 w-3.5" />
                Receive
              </Button>
            )}
            {order.status === "received" && (
              <Button
                size="sm"
                variant="outline"
                disabled={bill.isPending}
                onClick={() => bill.mutate()}
              >
                <ReceiptText className="me-1.5 h-3.5 w-3.5" />
                Bill
              </Button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border pt-3">
            {detailQuery.isLoading ? (
              <PageSkeleton variant="list" />
            ) : detailQuery.isError ? (
              <p className="text-sm text-destructive">
                {(detailQuery.error as Error)?.message ??
                  "Failed to load order details."}
              </p>
            ) : (
              <OrderDetail
                lines={detailQuery.data?.lines ?? []}
                receiptCount={detailQuery.data?.receipts.length ?? 0}
                currency={currency}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OrderDetail({
  lines,
  receiptCount,
  currency,
}: {
  lines: Array<{
    id: string;
    description: string | null;
    variantId: string | null;
    qty: number;
    unitPriceMinor: number;
    receivedQty: number;
  }>;
  receiptCount: number;
  currency: string;
}) {
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="text-start font-medium py-1.5">Item</th>
            <th className="text-end font-medium py-1.5">Qty</th>
            <th className="text-end font-medium py-1.5">Received</th>
            <th className="text-end font-medium py-1.5">Unit</th>
            <th className="text-end font-medium py-1.5">Line</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-border last:border-0">
              <td className="py-1.5">
                <div className="truncate">
                  {line.description ??
                    (line.variantId
                      ? line.variantId.slice(0, 8)
                      : "Item")}
                </div>
              </td>
              <td className="py-1.5 text-end font-mono">{line.qty}</td>
              <td className="py-1.5 text-end font-mono text-muted-foreground">
                {line.receivedQty}
              </td>
              <td className="py-1.5 text-end font-mono">
                {formatMoney(line.unitPriceMinor, currency)}
              </td>
              <td className="py-1.5 text-end font-mono">
                {formatMoney(line.unitPriceMinor * line.qty, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        {receiptCount === 0
          ? "No goods receipts yet."
          : `${receiptCount} goods receipt${receiptCount === 1 ? "" : "s"} recorded.`}
      </p>
    </div>
  );
}

function CreatePoDialog({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [vendorId, setVendorId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  const vendorsQuery = useQuery({
    queryKey: purchasingKeys.vendors(companyId),
    queryFn: () => purchasingApi.listVendors(companyId),
  });
  const warehousesQuery = useQuery({
    queryKey: ["commerce", "warehouses", companyId],
    queryFn: () => commerceApi.listWarehouses(companyId),
  });

  const vendors = vendorsQuery.data?.vendors ?? [];
  const warehouses = warehousesQuery.data?.warehouses ?? [];

  const subtotalMinor = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const qty = Number(line.qty) || 0;
        const price = majorToMinor(Number(line.unitPrice) || 0, currency);
        return sum + qty * price;
      }, 0),
    [lines, currency],
  );

  const create = useMutation({
    mutationFn: () => {
      const payloadLines: PoLineInput[] = lines
        .filter((line) => Number(line.qty) > 0)
        .map((line) => ({
          variantId: line.variantId.trim() || null,
          description: line.description.trim() || null,
          qty: Number(line.qty),
          unitPriceMinor: majorToMinor(Number(line.unitPrice) || 0, currency),
        }));
      return purchasingApi.createOrder(companyId, {
        vendorId: vendorId || null,
        warehouseId: warehouseId || null,
        currency,
        taxRatePct: 0,
        lines: payloadLines,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: purchasingKeys.orders(companyId),
      });
      pushToast({ title: "Purchase order created", tone: "success" });
      onOpenChange(false);
    },
    onError: (error) =>
      pushToast({
        title: "Failed to create purchase order",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  const hasValidLine = lines.some(
    (line) => Number(line.qty) > 0 && Number(line.unitPrice) >= 0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v: VendorRow) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Warehouse</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w: WarehouseRow) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-currency">Currency</Label>
              <Input
                id="po-currency"
                value={currency}
                onChange={(e) =>
                  setCurrency(e.target.value.toUpperCase().slice(0, 3))
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Lines</Label>
            {lines.map((line, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Input
                    placeholder="Description"
                    value={line.description}
                    onChange={(e) =>
                      updateLine(index, { description: e.target.value })
                    }
                  />
                  <Input
                    placeholder="Variant ID (optional)"
                    value={line.variantId}
                    onChange={(e) =>
                      updateLine(index, { variantId: e.target.value })
                    }
                    className="text-xs font-mono"
                  />
                </div>
                <div className="w-16 space-y-1">
                  <Label className="text-xs">Qty</Label>
                  <Input
                    type="number"
                    min={1}
                    value={line.qty}
                    onChange={(e) => updateLine(index, { qty: e.target.value })}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">Unit price</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.001"
                    value={line.unitPrice}
                    onChange={(e) =>
                      updateLine(index, { unitPrice: e.target.value })
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((prev) => prev.filter((_, i) => i !== index))
                  }
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              <Plus className="me-1.5 h-4 w-4" />
              Add line
            </Button>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-semibold">
            <span>Total</span>
            <span className="font-mono">
              {formatMoney(subtotalMinor, currency)}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!hasValidLine || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Vendors tab
// ---------------------------------------------------------------------------

function VendorsTab({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");

  const vendorsQuery = useQuery({
    queryKey: purchasingKeys.vendors(companyId),
    queryFn: () => purchasingApi.listVendors(companyId),
  });

  const createVendor = useMutation({
    mutationFn: () =>
      purchasingApi.createVendor(companyId, {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        paymentTerms: paymentTerms.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: purchasingKeys.vendors(companyId),
      });
      pushToast({ title: "Vendor created", tone: "success" });
      setDialogOpen(false);
      setName("");
      setEmail("");
      setPhone("");
      setPaymentTerms("");
    },
    onError: (error) =>
      pushToast({
        title: "Failed to create vendor",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  if (vendorsQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (vendorsQuery.isError) {
    return (
      <EmptyState
        icon={Building2}
        message={
          (vendorsQuery.error as Error)?.message ??
          "Failed to load vendors. Try again."
        }
      />
    );
  }

  const vendors = vendorsQuery.data?.vendors ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New vendor
        </Button>
      </div>

      {vendors.length === 0 ? (
        <EmptyState icon={Building2} message="No vendors yet." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {vendors.map((vendor) => (
            <Card key={vendor.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div
                    className="bg-muted/50 p-2 rounded-md"
                    aria-hidden="true"
                  >
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{vendor.name}</div>
                    <div className="text-xs text-muted-foreground truncate mt-1">
                      {vendor.email ?? vendor.phone ?? "—"}
                    </div>
                    {vendor.paymentTerms && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Terms: {vendor.paymentTerms}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-name">Name</Label>
              <Input
                id="vendor-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Supplies"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-email">Email</Label>
              <Input
                id="vendor-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="billing@vendor.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-phone">Phone</Label>
              <Input
                id="vendor-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-terms">Payment terms</Label>
              <Input
                id="vendor-terms"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="Net 30"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createVendor.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createVendor.mutate()}
              disabled={!name.trim() || createVendor.isPending}
            >
              {createVendor.isPending ? "Creating…" : "Create vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
