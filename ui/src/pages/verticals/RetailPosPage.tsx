import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calculator,
  ChevronLeft,
  PackageOpen,
  Printer,
  ShoppingCart,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import { BarcodeScanner } from "../../components/business/verticals/BarcodeScanner";
import { ReceiptPreview } from "../../components/business/verticals/ReceiptPreview";
import { RetailPosCheckout } from "../../components/business/verticals/RetailPosCheckout";
import {
  businessRetailApi,
  formatFils,
  type RetailLocation,
  type RetailProduct,
  type RetailSale,
} from "../../api/business-retail";

/**
 * Full-screen-style cashier POS page.
 *
 * Layout (left-to-right):
 *   - LEFT  (380px): sale items + customer + totals + PAY (RetailPosCheckout)
 *   - CENTER (flex-1): barcode scanner + product search + quick category grid
 *   - RIGHT  (280px): recent items + utility buttons (New / Refund / EOD)
 *
 * Touch-friendly: 60px+ tap targets, high contrast on the PAY button, low
 * round-trip latency by relying on `react-query` invalidation.
 */
export function RetailPosPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<RetailSale | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Retail", href: "/business/retail" },
      { label: "POS" },
    ]);
  }, [setBreadcrumbs]);

  const locationsQuery = useQuery({
    queryKey: ["retail", companyId, "locations"],
    queryFn: () => businessRetailApi.listLocations(companyId),
    enabled: !!companyId,
  });

  // Auto-select the first/main location once loaded.
  useEffect(() => {
    if (selectedLocation) return;
    const list = locationsQuery.data?.locations ?? [];
    const main = list.find((l) => l.isMain) ?? list[0];
    if (main) setSelectedLocation(main.id);
  }, [locationsQuery.data, selectedLocation]);

  const productsQuery = useQuery({
    queryKey: ["retail", companyId, "products", search],
    queryFn: () => businessRetailApi.listProducts(companyId, { q: search }),
    enabled: !!companyId,
  });

  const saleQuery = useQuery({
    queryKey: ["retail", companyId, "sale", activeSaleId],
    queryFn: () => businessRetailApi.getSale(companyId, activeSaleId!),
    enabled: !!companyId && !!activeSaleId,
    refetchInterval: false,
  });

  const startSale = useMutation({
    mutationFn: () =>
      businessRetailApi.startSale(companyId, {
        locationId: selectedLocation!,
      }),
    onSuccess: (res) => {
      setActiveSaleId(res.sale.id);
      void qc.invalidateQueries({
        queryKey: ["retail", companyId, "sale", res.sale.id],
      });
    },
  });

  const addItem = useMutation({
    mutationFn: (body: { barcode?: string; productId?: string }) =>
      businessRetailApi.addItem(companyId, activeSaleId!, {
        ...body,
        quantity: 1,
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["retail", companyId, "sale", activeSaleId],
      }),
    onError: (err: Error) => setScanError(err.message),
  });

  const onScan = async (barcode: string) => {
    setScanError(null);
    if (!activeSaleId) {
      try {
        const { sale: created } = await businessRetailApi.startSale(companyId, {
          locationId: selectedLocation!,
        });
        setActiveSaleId(created.id);
        addItem.mutate({ barcode });
      } catch (err) {
        setScanError((err as Error).message);
      }
      return;
    }
    addItem.mutate({ barcode });
  };

  if (!selectedCompany) return <PageSkeleton variant="detail" />;
  if (locationsQuery.isLoading) return <PageSkeleton variant="detail" />;

  const locations = locationsQuery.data?.locations ?? [];
  if (locations.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={ShoppingCart}
          message="Set up a store location first."
          action="Go to Retail dashboard"
          onAction={() => {
            window.location.href = "/business/retail";
          }}
        />
      </div>
    );
  }

  const sale = saleQuery.data?.sale ?? null;
  const products = productsQuery.data?.products ?? [];
  const currentLocation: RetailLocation | undefined = locations.find(
    (l) => l.id === selectedLocation,
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/business/retail">
              <ChevronLeft className="mr-1 h-4 w-4" />
              Exit POS
            </Link>
          </Button>
          <select
            value={selectedLocation ?? ""}
            onChange={(e) => {
              setSelectedLocation(e.target.value);
              setActiveSaleId(null);
            }}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {sale && <span className="text-xs text-muted-foreground">Sale {sale.code}</span>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActiveSaleId(null);
              setScanError(null);
            }}
          >
            <Undo2 className="mr-1 h-4 w-4" />
            New sale
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: checkout */}
        <aside className="w-[380px] shrink-0 border-r border-border">
          {sale ? (
            <RetailPosCheckout
              companyId={companyId}
              sale={sale}
              onCompleted={(completed) => {
                setCompletedSale(completed);
                setActiveSaleId(null);
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <ShoppingCart className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-sm text-muted-foreground">
                Scan a product or click "New sale" to begin.
              </div>
              <Button
                onClick={() => startSale.mutate()}
                disabled={startSale.isPending}
              >
                Start sale
              </Button>
            </div>
          )}
        </aside>

        {/* CENTER: scanner + search + grid */}
        <main className="flex flex-1 flex-col overflow-hidden p-4">
          <BarcodeScanner onScan={onScan} disabled={!selectedLocation} />
          {scanError && (
            <div className="mt-2 bg-destructive/10 p-2 text-sm text-destructive">
              {scanError}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product by name or SKU…"
              className="h-10 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none"
            />
          </div>

          <div className="mt-3 flex-1 overflow-y-auto">
            {productsQuery.isLoading ? (
              <PageSkeleton variant="list" />
            ) : products.length === 0 ? (
              <EmptyState
                icon={PackageOpen}
                message="No products match this search. Add products from inventory."
              />
            ) : (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                {products.slice(0, 60).map((p) => (
                  <ProductTile
                    key={p.id}
                    product={p}
                    onSelect={() => {
                      if (!activeSaleId) {
                        startSale.mutate(undefined, {
                          onSuccess: (res) => {
                            setActiveSaleId(res.sale.id);
                            addItem.mutate({ productId: p.id });
                          },
                        });
                      } else {
                        addItem.mutate({ productId: p.id });
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* RIGHT: utilities */}
        <aside className="w-[260px] shrink-0 border-l border-border bg-muted/30 p-3">
          <div className="space-y-2">
            <Button variant="outline" className="h-14 w-full justify-start" asChild>
              <Link to="/business/retail/inventory">
                <PackageOpen className="mr-2 h-5 w-5" />
                Inventory
              </Link>
            </Button>
            <Button variant="outline" className="h-14 w-full justify-start" asChild>
              <Link to="/business/retail/end-of-day">
                <Calculator className="mr-2 h-5 w-5" />
                End of day
              </Link>
            </Button>
            <Button variant="outline" className="h-14 w-full justify-start" asChild>
              <Link to="/business/retail/loyalty">
                <Printer className="mr-2 h-5 w-5" />
                Loyalty
              </Link>
            </Button>
          </div>

          <div className="mt-6">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Recent at {currentLocation?.name ?? "this store"}
            </div>
            <RecentSales companyId={companyId} locationId={selectedLocation ?? undefined} />
          </div>
        </aside>
      </div>

      {/* Receipt dialog */}
      <Dialog open={!!completedSale} onOpenChange={(o) => !o && setCompletedSale(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sale completed</DialogTitle>
          </DialogHeader>
          {completedSale && (
            <ReceiptPreview
              sale={completedSale}
              location={currentLocation}
              companyName={selectedCompany.name}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductTile({
  product,
  onSelect,
}: {
  product: RetailProduct;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex h-24 flex-col items-start justify-between border border-border bg-card p-3 text-left transition hover:bg-accent"
    >
      <span className="line-clamp-2 text-sm font-medium leading-tight">
        {product.name}
      </span>
      <span className="text-sm font-bold">
        {formatFils(product.unitPriceCents)}
      </span>
    </button>
  );
}

function RecentSales({ companyId, locationId }: { companyId: string; locationId?: string }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const recentSales = useQuery({
    queryKey: ["retail", companyId, "sales", "recent", locationId ?? "", today],
    queryFn: () =>
      businessRetailApi.listSales(companyId, {
        locationId,
        date: today,
        limit: 8,
      }),
    enabled: !!companyId,
    refetchInterval: 15000,
  });
  const sales = recentSales.data?.sales ?? [];
  if (sales.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">No sales yet today.</p>
    );
  }
  return (
    <ul className="mt-2 space-y-1">
      {sales.map((s) => (
        <li
          key={s.id}
          className="flex items-center justify-between border border-border bg-card p-2 text-xs"
        >
          <span className="font-medium">{s.code}</span>
          <span>{formatFils(s.totalCents)}</span>
        </li>
      ))}
    </ul>
  );
}
