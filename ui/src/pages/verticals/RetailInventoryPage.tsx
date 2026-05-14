import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Plus,
  PackageOpen,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import {
  businessRetailApi,
  formatFils,
  type RetailProduct,
} from "../../api/business-retail";

export function RetailInventoryPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  const [search, setSearch] = useState("");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Retail", href: "/business/retail" },
      { label: "Inventory" },
    ]);
  }, [setBreadcrumbs]);

  const locationsQuery = useQuery({
    queryKey: ["retail", companyId, "locations"],
    queryFn: () => businessRetailApi.listLocations(companyId),
    enabled: !!companyId,
  });

  const productsQuery = useQuery({
    queryKey: ["retail", companyId, "products", search, showLowStockOnly],
    queryFn: () =>
      businessRetailApi.listProducts(companyId, {
        q: search,
        lowStockOnly: showLowStockOnly,
      }),
    enabled: !!companyId,
  });

  const transfers = useQuery({
    queryKey: ["retail", companyId, "transfers"],
    queryFn: () => businessRetailApi.listTransfers(companyId),
    enabled: !!companyId,
  });

  if (!selectedCompany) return <PageSkeleton variant="list" />;

  const locations = locationsQuery.data?.locations ?? [];
  const products = productsQuery.data?.products ?? [];
  const filteredProducts = useMemo(() => {
    if (filterLocation === "all") return products;
    return products.filter((p) => (p.stockByLocation[filterLocation] ?? 0) > 0);
  }, [products, filterLocation]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Per-location stock, reorder points, and transfers across stores.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTransferOpen(true)}>
            <ArrowRight className="mr-1 h-4 w-4" />
            Transfer stock
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New product
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-72 rounded-md border border-input bg-transparent pl-8 pr-3 text-sm outline-none"
          />
        </div>
        <select
          value={filterLocation}
          onChange={(e) => setFilterLocation(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="all">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showLowStockOnly}
            onChange={(e) => setShowLowStockOnly(e.target.checked)}
          />
          Low stock only
        </label>
      </div>

      {/* Product table */}
      {productsQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          message="No products. Add one to start tracking inventory."
          action="Add product"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    {locations.map((l) => (
                      <th key={l.id} className="px-3 py-2 text-right">
                        {l.name}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Reorder</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredProducts.map((p) => {
                    const total = Object.values(p.stockByLocation).reduce(
                      (s, n) => s + n,
                      0,
                    );
                    const isLow =
                      p.reorderPoint !== undefined && total <= p.reorderPoint;
                    return (
                      <tr key={p.id} className={isLow ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{p.name}</div>
                          {p.brand && (
                            <div className="text-xs text-muted-foreground">
                              {p.brand}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {p.barcode ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatFils(p.unitPriceCents)}
                        </td>
                        {locations.map((l) => (
                          <td key={l.id} className="px-3 py-2 text-right">
                            <StockCell
                              companyId={companyId}
                              productId={p.id}
                              locationId={l.id}
                              quantity={p.stockByLocation[l.id] ?? 0}
                              onAfter={() =>
                                qc.invalidateQueries({
                                  queryKey: ["retail", companyId, "products"],
                                })
                              }
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-semibold">
                          {total}
                        </td>
                        <td className="px-3 py-2 text-right text-xs">
                          {p.reorderPoint ?? "—"}
                          {isLow && (
                            <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-500" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transfers history */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Inventory transfers</h2>
          {transfers.data?.transfers && transfers.data.transfers.length > 0 ? (
            <ul className="divide-y divide-border">
              {transfers.data.transfers.map((t) => {
                const from = locations.find((l) => l.id === t.fromLocationId);
                const to = locations.find((l) => l.id === t.toLocationId);
                return (
                  <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono">{t.code}</span>
                    <span className="text-muted-foreground">
                      {from?.name ?? t.fromLocationId} →{" "}
                      {to?.name ?? t.toLocationId} ({t.items.length} items)
                    </span>
                    <TransferActions
                      companyId={companyId}
                      id={t.id}
                      status={t.status}
                      onAfter={() => {
                        void qc.invalidateQueries({
                          queryKey: ["retail", companyId, "transfers"],
                        });
                        void qc.invalidateQueries({
                          queryKey: ["retail", companyId, "products"],
                        });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No transfers yet.</p>
          )}
        </CardContent>
      </Card>

      <TransferDialog
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        companyId={companyId}
        locations={locations}
        products={products}
        onSuccess={() => {
          void qc.invalidateQueries({
            queryKey: ["retail", companyId, "transfers"],
          });
        }}
      />
      <CreateProductDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        companyId={companyId}
        onSuccess={() => {
          void qc.invalidateQueries({
            queryKey: ["retail", companyId, "products"],
          });
        }}
      />
    </div>
  );
}

function StockCell({
  companyId,
  productId,
  locationId,
  quantity,
  onAfter,
}: {
  companyId: string;
  productId: string;
  locationId: string;
  quantity: number;
  onAfter: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(quantity));
  const setStock = useMutation({
    mutationFn: () =>
      businessRetailApi.setStock(companyId, productId, {
        locationId,
        quantity: Math.max(0, Math.trunc(Number(value) || 0)),
      }),
    onSuccess: () => {
      setEditing(false);
      onAfter();
    },
  });
  if (editing) {
    return (
      <span className="inline-flex gap-1">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 w-16 rounded-md border border-input bg-transparent px-1 text-right text-xs"
        />
        <button
          type="button"
          onClick={() => setStock.mutate()}
          className="text-xs text-primary"
        >
          OK
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setEditing(true);
        setValue(String(quantity));
      }}
      className="hover:underline"
    >
      {quantity}
    </button>
  );
}

function TransferActions({
  companyId,
  id,
  status,
  onAfter,
}: {
  companyId: string;
  id: string;
  status: string;
  onAfter: () => void;
}) {
  const ship = useMutation({
    mutationFn: () => businessRetailApi.shipTransfer(companyId, id),
    onSuccess: onAfter,
  });
  const receive = useMutation({
    mutationFn: () => businessRetailApi.receiveTransfer(companyId, id),
    onSuccess: onAfter,
  });
  if (status === "draft") {
    return (
      <Button size="sm" variant="outline" onClick={() => ship.mutate()}>
        Ship
      </Button>
    );
  }
  if (status === "in_transit") {
    return (
      <Button size="sm" variant="outline" onClick={() => receive.mutate()}>
        Receive
      </Button>
    );
  }
  return <span className="text-xs text-muted-foreground">{status}</span>;
}

function TransferDialog({
  open,
  onClose,
  companyId,
  locations,
  products,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  locations: Array<{ id: string; name: string }>;
  products: RetailProduct[];
  onSuccess: () => void;
}) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");

  const create = useMutation({
    mutationFn: () =>
      businessRetailApi.createTransfer(companyId, {
        fromLocationId: fromId,
        toLocationId: toId,
        items: [{ productId, quantity: Math.max(1, Math.trunc(Number(qty) || 1)) }],
      }),
    onSuccess: () => {
      onSuccess();
      onClose();
      setProductId("");
      setQty("1");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer stock</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="">From location…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="">To location…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
          {create.isError && (
            <div className="bg-destructive/10 p-2 text-xs text-destructive">
              {(create.error as Error)?.message}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!fromId || !toId || !productId || fromId === toId}
          >
            Create transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateProductDialog({
  open,
  onClose,
  companyId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [reorder, setReorder] = useState("");

  const create = useMutation({
    mutationFn: () =>
      businessRetailApi.createProduct(companyId, {
        name,
        barcode: barcode || undefined,
        category: "general",
        unitPriceCents: Math.round(Number(price) * 1000),
        taxRatePercent: 5,
        stockByLocation: {},
        reorderPoint: reorder ? Number(reorder) : undefined,
        isActive: true,
      }),
    onSuccess: () => {
      onSuccess();
      onClose();
      setName("");
      setBarcode("");
      setPrice("");
      setReorder("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Product name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
          <input
            type="text"
            placeholder="Barcode (optional)"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm font-mono"
          />
          <input
            type="number"
            placeholder="Unit price (KWD)"
            step="0.001"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
          <input
            type="number"
            placeholder="Reorder point (optional)"
            min={0}
            value={reorder}
            onChange={(e) => setReorder(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!name || !price || create.isPending}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
