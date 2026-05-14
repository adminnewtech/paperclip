import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Warehouse,
  ArrowUpDown,
  AlertTriangle,
  Plus,
  Search,
  ArrowUp,
  ArrowDown,
  BarChart3,
  Trash2,
  Edit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOW_STOCK_THRESHOLD = 10;
const MOVEMENT_KIND_LABELS: Record<string, string> = {
  in: "Stock In",
  out: "Stock Out",
  transfer: "Transfer",
  adjustment: "Adjustment",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number, currency = "SAR"): string {
  return value.toLocaleString("en-SA", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function computeStockLevels(
  products: BusinessEntityRow[],
  movements: BusinessEntityRow[],
): Map<string, number> {
  const levels = new Map<string, number>();
  for (const product of products) {
    levels.set(product.id, 0);
  }
  for (const movement of movements) {
    const productId = movement.data.productId as string;
    const qty = Number(movement.data.quantity ?? 0);
    const kind = movement.data.kind as string;
    const current = levels.get(productId) ?? 0;
    if (kind === "in") levels.set(productId, current + qty);
    else if (kind === "out") levels.set(productId, current - qty);
    else if (kind === "adjustment") levels.set(productId, qty);
  }
  return levels;
}

function isThisMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// ---------------------------------------------------------------------------
// Stock level bar
// ---------------------------------------------------------------------------

function StockBar({ level }: { level: number }) {
  const capped = Math.min(Math.max(level, 0), 100);
  const pct = Math.round((capped / 100) * 100);
  const color =
    level < 5
      ? "bg-red-500"
      : level < 20
        ? "bg-amber-400"
        : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.max(pct, level > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="text-xs font-mono tabular-nums w-6 text-right">{level}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Stock Dialog (Stock In / Stock Out)
// ---------------------------------------------------------------------------

interface QuickStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: BusinessEntityRow;
  kind: "in" | "out";
  companyId: string;
  warehouses: BusinessEntityRow[];
}

function QuickStockDialog({
  open,
  onOpenChange,
  product,
  kind,
  companyId,
  warehouses,
}: QuickStockDialogProps) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "inventory", "stock_movement", {
        entityType: "stock_movement",
        data: {
          productId: product.id,
          warehouseId: warehouseId || undefined,
          kind,
          quantity: Number(quantity),
          reason: reason || undefined,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "inventory", "stock_movement"),
      });
      onOpenChange(false);
      setQuantity("");
      setWarehouseId("");
      setReason("");
    },
  });

  function handleSubmit() {
    if (!quantity || Number(quantity) <= 0) return;
    mutation.mutate();
  }

  const title = kind === "in" ? "Stock In" : "Stock Out";
  const icon = kind === "in" ? ArrowUp : ArrowDown;
  const Icon = icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${kind === "in" ? "text-emerald-600" : "text-red-500"}`} />
            {title}: {product.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Quantity *</Label>
            <Input
              type="number"
              min={1}
              placeholder="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </div>
          {warehouses.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Warehouse</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name ?? w.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Reason</Label>
            <Input
              placeholder="e.g. Purchase order, sale…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || !quantity || Number(quantity) <= 0}
            className={
              kind === "in"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"
            }
          >
            {mutation.isPending ? "Saving…" : title}
          </Button>
        </DialogFooter>
        {mutation.error && (
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Product Card
// ---------------------------------------------------------------------------

interface ProductCardProps {
  product: BusinessEntityRow;
  stockLevel: number;
  onStockIn: () => void;
  onStockOut: () => void;
}

function ProductCard({ product, stockLevel, onStockIn, onStockOut }: ProductCardProps) {
  const d = product.data as Record<string, unknown>;
  const price = product.amountCents != null ? product.amountCents / 100 : null;
  const cost = d.cost != null ? Number(d.cost) : null;
  const sku = d.sku as string | undefined;
  const unit = d.unit as string | undefined;
  const isLow = stockLevel < LOW_STOCK_THRESHOLD;
  const isVeryLow = stockLevel < 5;

  const stockBarColor =
    isVeryLow ? "text-red-600" : isLow ? "text-amber-600" : "text-emerald-600";

  return (
    <Card className="flex flex-col">
      <CardContent className="p-4 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex items-start gap-2">
          <div className="bg-muted rounded-md p-1.5 shrink-0 mt-0.5">
            <Package className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-tight truncate">{product.name}</div>
            {sku && (
              <div className="text-xs text-muted-foreground mt-0.5">SKU: {sku}</div>
            )}
            {unit && (
              <div className="text-xs text-muted-foreground">Unit: {unit}</div>
            )}
          </div>
          {isLow && (
            <Badge
              variant="destructive"
              className="text-[10px] px-1.5 py-0 h-5 shrink-0"
            >
              LOW
            </Badge>
          )}
          {product.status === "inactive" && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 shrink-0">
              Inactive
            </Badge>
          )}
        </div>

        {/* Pricing */}
        <div className="flex items-center gap-3 text-xs">
          {price != null && (
            <span className="font-medium">
              {formatCurrency(price)} <span className="text-muted-foreground font-normal">price</span>
            </span>
          )}
          {cost != null && (
            <span className="text-muted-foreground">
              Cost: {formatCurrency(cost)}
            </span>
          )}
        </div>

        {/* Stock level */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Stock</span>
            <span className={`text-xs font-semibold tabular-nums ${stockBarColor}`}>
              {stockLevel} units
            </span>
          </div>
          <StockBar level={stockLevel} />
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-auto pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
            onClick={onStockIn}
          >
            <ArrowUp className="h-3 w-3 mr-1" />
            Stock In
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
            onClick={onStockOut}
            disabled={stockLevel <= 0}
          >
            <ArrowDown className="h-3 w-3 mr-1" />
            Stock Out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create Product Dialog
// ---------------------------------------------------------------------------

function CreateProductDialog({
  open,
  onOpenChange,
  companyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [unit, setUnit] = useState("piece");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [trackInventory, setTrackInventory] = useState("yes");

  const mutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "inventory", "product", {
        entityType: "product",
        name,
        status: "active",
        amountCents: price ? Math.round(Number(price) * 100) : null,
        data: {
          sku: sku || undefined,
          barcode: barcode || undefined,
          unit,
          cost: cost ? Number(cost) : undefined,
          trackInventory,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "inventory", "product"),
      });
      onOpenChange(false);
      setName("");
      setSku("");
      setBarcode("");
      setUnit("piece");
      setPrice("");
      setCost("");
      setTrackInventory("yes");
    },
  });

  function handleSubmit() {
    if (!name.trim()) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Product</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="Product name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">SKU</Label>
              <Input
                placeholder="ABC-123"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Barcode</Label>
              <Input
                placeholder="123456789"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Unit</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="piece">Piece</SelectItem>
                <SelectItem value="kg">Kilogram (kg)</SelectItem>
                <SelectItem value="liter">Liter</SelectItem>
                <SelectItem value="meter">Meter</SelectItem>
                <SelectItem value="hour">Hour</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Selling Price (SAR)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cost (SAR)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Track Inventory</Label>
            <Select value={trackInventory} onValueChange={setTrackInventory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? "Creating…" : "Create Product"}
          </Button>
        </DialogFooter>
        {mutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(mutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Stock Movement Form Dialog
// ---------------------------------------------------------------------------

function AddMovementDialog({
  open,
  onOpenChange,
  companyId,
  products,
  warehouses,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  products: BusinessEntityRow[];
  warehouses: BusinessEntityRow[];
}) {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [kind, setKind] = useState<"in" | "out" | "transfer" | "adjustment">("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "inventory", "stock_movement", {
        entityType: "stock_movement",
        data: {
          productId,
          warehouseId: warehouseId || undefined,
          kind,
          quantity: Number(quantity),
          reason: reason || undefined,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "inventory", "stock_movement"),
      });
      onOpenChange(false);
      setProductId("");
      setWarehouseId("");
      setKind("in");
      setQuantity("");
      setReason("");
    },
  });

  function handleSubmit() {
    if (!productId || !quantity || Number(quantity) <= 0) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Stock Movement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              Product <span className="text-destructive">*</span>
            </Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Select product…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name ?? p.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse…" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name ?? w.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as typeof kind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">Stock In</SelectItem>
                  <SelectItem value="out">Stock Out</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Quantity <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={kind === "adjustment" ? 0 : 1}
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reason</Label>
            <Input
              placeholder="Reason for movement…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {kind === "adjustment" && (
            <p className="text-[11px] text-muted-foreground bg-muted px-3 py-2 rounded-md">
              Adjustment sets an absolute stock level for the product.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || !productId || !quantity || Number(quantity) < 0}
          >
            {mutation.isPending ? "Saving…" : "Record Movement"}
          </Button>
        </DialogFooter>
        {mutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(mutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Warehouse Dialog (Add / Edit)
// ---------------------------------------------------------------------------

function WarehouseDialog({
  open,
  onOpenChange,
  companyId,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  existing?: BusinessEntityRow;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(existing?.name ?? "");
  const [address, setAddress] = useState((existing?.data.address as string) ?? "");

  // Reset when dialog opens with different data
  useEffect(() => {
    setName(existing?.name ?? "");
    setAddress((existing?.data.address as string) ?? "");
  }, [existing, open]);

  const createMutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "inventory", "warehouse", {
        entityType: "warehouse",
        name,
        data: { address: address || undefined },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "inventory", "warehouse"),
      });
      onOpenChange(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      businessApi.updateEntity(companyId, "inventory", "warehouse", existing!.id, {
        name,
        data: { ...existing!.data, address: address || undefined },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "inventory", "warehouse"),
      });
      onOpenChange(false);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;

  function handleSubmit() {
    if (!name.trim()) return;
    if (existing) updateMutation.mutate();
    else createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Warehouse" : "New Warehouse"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="Main Warehouse"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Address</Label>
            <Input
              placeholder="Street, City"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? "Saving…" : existing ? "Save Changes" : "Create Warehouse"}
          </Button>
        </DialogFooter>
        {error && (
          <p className="text-sm text-destructive mt-2">
            {(error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Products Tab
// ---------------------------------------------------------------------------

function ProductsTab({
  companyId,
  products,
  movements,
  warehouses,
  isLoading,
}: {
  companyId: string;
  products: BusinessEntityRow[];
  movements: BusinessEntityRow[];
  warehouses: BusinessEntityRow[];
  isLoading: boolean;
}) {
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [quickStock, setQuickStock] = useState<{
    product: BusinessEntityRow;
    kind: "in" | "out";
  } | null>(null);

  const stockLevels = useMemo(
    () => computeStockLevels(products, movements),
    [products, movements],
  );

  const filtered = useMemo(() => {
    if (!q.trim()) return products;
    const lower = q.toLowerCase();
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(lower) ||
        (p.data.sku as string | undefined)?.toLowerCase().includes(lower),
    );
  }, [products, q]);

  if (isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search products…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Product
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          message={
            q ? `No products matching "${q}".` : "No products yet. Add your first product."
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              stockLevel={stockLevels.get(product.id) ?? 0}
              onStockIn={() => setQuickStock({ product, kind: "in" })}
              onStockOut={() => setQuickStock({ product, kind: "out" })}
            />
          ))}
        </div>
      )}

      <CreateProductDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
      />

      {quickStock && (
        <QuickStockDialog
          open
          onOpenChange={(open) => !open && setQuickStock(null)}
          product={quickStock.product}
          kind={quickStock.kind}
          companyId={companyId}
          warehouses={warehouses}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock Movements Tab
// ---------------------------------------------------------------------------

function MovementsTab({
  companyId,
  products,
  movements,
  warehouses,
  isLoading,
}: {
  companyId: string;
  products: BusinessEntityRow[];
  movements: BusinessEntityRow[];
  warehouses: BusinessEntityRow[];
  isLoading: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);

  const productMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(p.id, p.name ?? p.id);
    return m;
  }, [products]);

  const warehouseMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouses) m.set(w.id, w.name ?? w.id);
    return m;
  }, [warehouses]);

  const sorted = useMemo(
    () => [...movements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [movements],
  );

  if (isLoading) return <PageSkeleton variant="list" />;

  const kindStyle: Record<string, string> = {
    in: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    out: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    transfer: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    adjustment: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {sorted.length} movement{sorted.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Record Movement
        </Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={ArrowUpDown}
          message="No stock movements yet. Record your first movement."
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Product</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Type</th>
                <th className="text-right px-4 py-2.5 font-medium text-xs text-muted-foreground">Qty</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Warehouse</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Reason</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((movement) => {
                const kind = movement.data.kind as string;
                const productId = movement.data.productId as string | undefined;
                const whId = movement.data.warehouseId as string | undefined;
                const qty = Number(movement.data.quantity ?? 0);
                const reason = movement.data.reason as string | undefined;

                return (
                  <tr key={movement.id} className="bg-card hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      {productId ? (productMap.get(productId) ?? productId) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          kindStyle[kind] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {MOVEMENT_KIND_LABELS[kind] ?? kind}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {kind === "out" ? (
                        <span className="text-red-600">-{qty}</span>
                      ) : (
                        <span className={kind === "in" ? "text-emerald-600" : ""}>
                          {qty}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {whId ? (warehouseMap.get(whId) ?? whId) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                      {reason ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(movement.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddMovementDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        companyId={companyId}
        products={products}
        warehouses={warehouses}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Warehouses Tab
// ---------------------------------------------------------------------------

function WarehousesTab({
  companyId,
  warehouses,
  isLoading,
}: {
  companyId: string;
  warehouses: BusinessEntityRow[];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BusinessEntityRow | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      businessApi.deleteEntity(companyId, "inventory", "warehouse", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "inventory", "warehouse"),
      });
    },
  });

  if (isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {warehouses.length} warehouse{warehouses.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Warehouse
        </Button>
      </div>

      {warehouses.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          message="No warehouses yet. Add your first warehouse."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {warehouses.map((w) => {
            const address = w.data.address as string | undefined;
            return (
              <Card key={w.id}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-muted rounded-md p-2 shrink-0">
                      <Warehouse className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{w.name ?? "Unnamed"}</div>
                      {address && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {address}
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground/60 mt-1">
                        Added {formatDate(w.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-7 text-xs"
                      onClick={() => setEditTarget(w)}
                    >
                      <Edit2 className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-7 text-xs text-destructive hover:bg-destructive/10 hover:border-destructive/50"
                      onClick={() => deleteMutation.mutate(w.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <WarehouseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        companyId={companyId}
      />

      {editTarget && (
        <WarehouseDialog
          open
          onOpenChange={(open) => !open && setEditTarget(null)}
          companyId={companyId}
          existing={editTarget}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Low Stock Alerts Tab
// ---------------------------------------------------------------------------

function LowStockTab({
  companyId,
  products,
  stockLevels,
  warehouses,
}: {
  companyId: string;
  products: BusinessEntityRow[];
  stockLevels: Map<string, number>;
  warehouses: BusinessEntityRow[];
}) {
  const [restockTarget, setRestockTarget] = useState<BusinessEntityRow | null>(null);

  const lowStockProducts = useMemo(
    () =>
      products
        .filter((p) => (stockLevels.get(p.id) ?? 0) < LOW_STOCK_THRESHOLD)
        .sort((a, b) => (stockLevels.get(a.id) ?? 0) - (stockLevels.get(b.id) ?? 0)),
    [products, stockLevels],
  );

  if (lowStockProducts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="bg-emerald-100 dark:bg-emerald-900/20 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
          <Package className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <p className="font-medium text-foreground">All stock levels look good!</p>
        <p className="text-sm mt-1">
          No products are below the threshold of {LOW_STOCK_THRESHOLD} units.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
        <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            {lowStockProducts.length} product{lowStockProducts.length !== 1 ? "s" : ""} below
            threshold
          </p>
          <p className="text-xs text-red-600/80 dark:text-red-400/70">
            Products with stock level below {LOW_STOCK_THRESHOLD} units need restocking.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {lowStockProducts.map((product) => {
          const level = stockLevels.get(product.id) ?? 0;
          const isCritical = level < 5;
          return (
            <Card
              key={product.id}
              className={`border ${
                isCritical
                  ? "border-red-200 dark:border-red-800"
                  : "border-amber-200 dark:border-amber-800"
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`rounded-md p-2 shrink-0 ${
                      isCritical
                        ? "bg-red-100 dark:bg-red-900/30"
                        : "bg-amber-100 dark:bg-amber-900/30"
                    }`}
                  >
                    <AlertTriangle
                      className={`h-4 w-4 ${
                        isCritical
                          ? "text-red-600 dark:text-red-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{product.name}</div>
                    {typeof product.data.sku === "string" && product.data.sku && (
                      <div className="text-xs text-muted-foreground">
                        SKU: {product.data.sku}
                      </div>
                    )}
                    <div className="mt-1.5">
                      <StockBar level={level} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`text-lg font-bold tabular-nums ${
                        isCritical ? "text-red-600" : "text-amber-600"
                      }`}
                    >
                      {level}
                    </div>
                    <div className="text-[10px] text-muted-foreground">units left</div>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => setRestockTarget(product)}
                  >
                    <ArrowUp className="h-3 w-3 mr-1" />
                    Restock
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {restockTarget && (
        <QuickStockDialog
          open
          onOpenChange={(open) => !open && setRestockTarget(null)}
          product={restockTarget}
          kind="in"
          companyId={companyId}
          warehouses={warehouses}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Bar
// ---------------------------------------------------------------------------

function StatsBar({
  products,
  stockLevels,
  movements,
}: {
  products: BusinessEntityRow[];
  stockLevels: Map<string, number>;
  movements: BusinessEntityRow[];
}) {
  const totalStockValue = useMemo(() => {
    let total = 0;
    for (const p of products) {
      const level = stockLevels.get(p.id) ?? 0;
      const priceCents = p.amountCents ?? 0;
      total += (priceCents / 100) * level;
    }
    return total;
  }, [products, stockLevels]);

  const movementsThisMonth = useMemo(
    () => movements.filter((m) => isThisMonth(m.createdAt)).length,
    [movements],
  );

  const lowStockCount = useMemo(
    () => products.filter((p) => (stockLevels.get(p.id) ?? 0) < LOW_STOCK_THRESHOLD).length,
    [products, stockLevels],
  );

  const stats = [
    {
      label: "Total Products",
      value: String(products.length),
      icon: Package,
      tone: "default" as const,
    },
    {
      label: "Total Stock Value",
      value: formatCurrency(totalStockValue),
      icon: BarChart3,
      tone: "success" as const,
    },
    {
      label: "Movements This Month",
      value: String(movementsThisMonth),
      icon: ArrowUpDown,
      tone: "default" as const,
    },
    {
      label: "Low Stock",
      value: String(lowStockCount),
      icon: AlertTriangle,
      tone: lowStockCount > 0 ? ("danger" as const) : ("default" as const),
    },
  ];

  const iconBg = (tone: string) =>
    tone === "success"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : tone === "danger"
        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        : "bg-muted text-muted-foreground";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {stat.label}
                  </p>
                  <p className="text-xl font-bold mt-1 tabular-nums">{stat.value}</p>
                </div>
                <div className={`p-2 rounded-lg shrink-0 ${iconBg(stat.tone)}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              {stat.label === "Low Stock" && lowStockCount > 0 && (
                <Badge variant="destructive" className="text-[10px] mt-2">
                  Needs attention
                </Badge>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function BusinessInventoryPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState("products");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Inventory" },
    ]);
  }, [setBreadcrumbs]);

  const productsQuery = useQuery({
    queryKey: queryKeys.business.entities(selectedCompanyId!, "inventory", "product"),
    queryFn: () => businessApi.listEntities(selectedCompanyId!, "inventory", "product"),
    enabled: !!selectedCompanyId,
  });

  const movementsQuery = useQuery({
    queryKey: queryKeys.business.entities(selectedCompanyId!, "inventory", "stock_movement"),
    queryFn: () => businessApi.listEntities(selectedCompanyId!, "inventory", "stock_movement"),
    enabled: !!selectedCompanyId,
  });

  const warehousesQuery = useQuery({
    queryKey: queryKeys.business.entities(selectedCompanyId!, "inventory", "warehouse"),
    queryFn: () => businessApi.listEntities(selectedCompanyId!, "inventory", "warehouse"),
    enabled: !!selectedCompanyId,
  });

  const products = productsQuery.data?.entities ?? [];
  const movements = movementsQuery.data?.entities ?? [];
  const warehouses = warehousesQuery.data?.entities ?? [];

  const stockLevels = useMemo(
    () => computeStockLevels(products, movements),
    [products, movements],
  );

  const lowStockCount = useMemo(
    () => products.filter((p) => (stockLevels.get(p.id) ?? 0) < LOW_STOCK_THRESHOLD).length,
    [products, stockLevels],
  );

  const isLoading =
    productsQuery.isLoading || movementsQuery.isLoading || warehousesQuery.isLoading;

  if (!selectedCompanyId) {
    return <EmptyState icon={Package} message="Select a workspace first." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const companyId = selectedCompanyId;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Package className="h-6 w-6" />
            Inventory
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage products, stock levels, and warehouses
          </p>
        </div>
        {lowStockCount > 0 && (
          <button
            className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
            onClick={() => setActiveTab("alerts")}
          >
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium text-red-700 dark:text-red-400">
              {lowStockCount} low stock alert{lowStockCount !== 1 ? "s" : ""}
            </span>
          </button>
        )}
      </div>

      {/* Quick stats */}
      <StatsBar products={products} stockLevels={stockLevels} movements={movements} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="products" className="flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5" />
            Products
            {products.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 ml-1">
                {products.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="movements" className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5" />
            Stock Movements
            {movements.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 ml-1">
                {movements.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="warehouses" className="flex items-center gap-1.5">
            <Warehouse className="h-3.5 w-3.5" />
            Warehouses
            {warehouses.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 ml-1">
                {warehouses.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="alerts" className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Low Stock
            {lowStockCount > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 ml-1">
                {lowStockCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <ProductsTab
            companyId={companyId}
            products={products}
            movements={movements}
            warehouses={warehouses}
            isLoading={productsQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <MovementsTab
            companyId={companyId}
            products={products}
            movements={movements}
            warehouses={warehouses}
            isLoading={movementsQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="warehouses" className="mt-4">
          <WarehousesTab
            companyId={companyId}
            warehouses={warehouses}
            isLoading={warehousesQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <LowStockTab
            companyId={companyId}
            products={products}
            stockLevels={stockLevels}
            warehouses={warehouses}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
