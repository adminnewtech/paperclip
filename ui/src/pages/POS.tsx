import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Plus, Minus, X, Package } from "lucide-react";
import { minorToMajor, currencyFractionDigits } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "../api/client";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import {
  commerceApi,
  type PosCheckoutLineInput,
  type WarehouseRow,
} from "../api/commerce";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

const INVENTORY_MODULE = "inventory";
const PRODUCT_ENTITY = "product";
const DEFAULT_CURRENCY = "KWD";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card (mada)" },
  { value: "charge", label: "Charge" },
] as const;

interface CartLine {
  variantId: string;
  name: string;
  unitPriceMinor: number;
  qty: number;
}

function readVariantId(product: BusinessEntityRow): string {
  const data = (product.data ?? {}) as Record<string, unknown>;
  const variantId = data.variantId;
  if (typeof variantId === "string" && variantId.length > 0) return variantId;
  return product.id;
}

function formatMoney(amountMinor: number, currency: string): string {
  return minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: currencyFractionDigits(currency),
    maximumFractionDigits: currencyFractionDigits(currency),
  });
}

export function POS() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [customerName, setCustomerName] = useState("");
  const [taxRatePct, setTaxRatePct] = useState("0");

  useEffect(() => {
    setBreadcrumbs([{ label: "Point of Sale" }]);
  }, [setBreadcrumbs]);

  const productsQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      INVENTORY_MODULE,
      PRODUCT_ENTITY,
      "",
    ),
    queryFn: () =>
      businessApi.listEntities(
        selectedCompanyId!,
        INVENTORY_MODULE,
        PRODUCT_ENTITY,
      ),
    enabled: !!selectedCompanyId,
  });

  const warehousesQuery = useQuery({
    queryKey: queryKeys.commerce.warehouses(selectedCompanyId!),
    queryFn: () => commerceApi.listWarehouses(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const warehouses = warehousesQuery.data?.warehouses ?? [];

  // Default the warehouse selection once warehouses load.
  useEffect(() => {
    if (warehouseId || warehouses.length === 0) return;
    const fallback =
      warehouses.find((w: WarehouseRow) => w.isDefault) ?? warehouses[0];
    if (fallback) setWarehouseId(fallback.id);
  }, [warehouseId, warehouses]);

  const products = productsQuery.data?.entities ?? [];

  const currency = useMemo(() => {
    const withCurrency = products.find((p) => p.currency);
    return withCurrency?.currency ?? DEFAULT_CURRENCY;
  }, [products]);

  const taxRate = useMemo(() => {
    const parsed = Number(taxRatePct);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(parsed, 100);
  }, [taxRatePct]);

  const subtotalMinor = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitPriceMinor * line.qty, 0),
    [cart],
  );
  const taxMinor = useMemo(
    () => Math.round((subtotalMinor * taxRate) / 100),
    [subtotalMinor, taxRate],
  );
  const totalMinor = subtotalMinor + taxMinor;

  function addToCart(product: BusinessEntityRow) {
    const variantId = readVariantId(product);
    const unitPriceMinor = product.amountCents ?? 0;
    const name = product.name ?? "Unnamed product";
    setCart((prev) => {
      const existing = prev.find((line) => line.variantId === variantId);
      if (existing) {
        return prev.map((line) =>
          line.variantId === variantId
            ? { ...line, qty: line.qty + 1 }
            : line,
        );
      }
      return [...prev, { variantId, name, unitPriceMinor, qty: 1 }];
    });
  }

  function changeQty(variantId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((line) =>
          line.variantId === variantId
            ? { ...line, qty: line.qty + delta }
            : line,
        )
        .filter((line) => line.qty > 0),
    );
  }

  function removeLine(variantId: string) {
    setCart((prev) => prev.filter((line) => line.variantId !== variantId));
  }

  const checkout = useMutation({
    mutationFn: () => {
      const lines: PosCheckoutLineInput[] = cart.map((line) => ({
        variantId: line.variantId,
        qty: line.qty,
        unitPriceMinor: line.unitPriceMinor,
      }));
      return commerceApi.posCheckout(selectedCompanyId!, {
        warehouseId,
        lines,
        paymentMethod,
        customerName: customerName.trim() || undefined,
        currency,
        taxRatePct: taxRate,
      });
    },
    onSuccess: (order) => {
      pushToast({
        title: "Sale completed",
        body: `Order ${order.id.slice(0, 8)} · ${formatMoney(
          order.totalMinor,
          order.currency,
        )}`,
        tone: "success",
      });
      setCart([]);
      setCustomerName("");
      queryClient.invalidateQueries({
        queryKey: queryKeys.commerce.stock(selectedCompanyId!, warehouseId),
      });
    },
    onError: (error) => {
      const isConflict = error instanceof ApiError && error.status === 409;
      pushToast({
        title: isConflict ? "Insufficient stock" : "Checkout failed",
        body:
          (error as Error)?.message ??
          "Could not complete the sale. Try again.",
        tone: "error",
      });
    },
  });

  function handleCheckout() {
    if (!selectedCompanyId || cart.length === 0 || !warehouseId) return;
    checkout.mutate();
  }

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={ShoppingCart}
        message="Select a workspace to use the point of sale."
      />
    );
  }

  if (productsQuery.isLoading || warehousesQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (productsQuery.isError) {
    return (
      <EmptyState
        icon={ShoppingCart}
        message={
          (productsQuery.error as Error)?.message ??
          "Failed to load products. Try again."
        }
      />
    );
  }

  const canCheckout = cart.length > 0 && !!warehouseId && !checkout.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Point of Sale</h1>
          <p className="text-sm text-muted-foreground">
            Ring up sales against a warehouse. Checkout writes to this
            workspace only.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Product grid */}
        <div className="lg:col-span-2">
          {products.length === 0 ? (
            <EmptyState icon={Package} message="No products yet." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addToCart(product)}
                  className="text-start"
                >
                  <Card className="hover:ring-2 hover:ring-primary transition-shadow h-full">
                    <CardContent className="p-3 flex flex-col gap-2 h-full">
                      <div className="bg-muted/50 rounded-md p-2 self-start">
                        <Package className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="font-medium text-sm line-clamp-2">
                        {product.name ?? "Unnamed product"}
                      </div>
                      <div className="mt-auto text-sm font-mono">
                        {formatMoney(product.amountCents ?? 0, currency)}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <div>
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pos-warehouse">Warehouse</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger id="pos-warehouse" className="w-full">
                    <SelectValue placeholder="Select a warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {warehouses.length === 0 && (
                  <p className="text-xs text-amber-500">
                    No warehouses yet — create one before checking out.
                  </p>
                )}
              </div>

              <div className="border-t border-border pt-3">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground">
                    <ShoppingCart className="h-6 w-6 mb-2" />
                    Cart is empty
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {cart.map((line) => (
                      <li
                        key={line.variantId}
                        className="flex items-center gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {line.name}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {formatMoney(line.unitPriceMinor, currency)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="outline"
                            size="icon-xs"
                            onClick={() => changeQty(line.variantId, -1)}
                            aria-label="Decrease quantity"
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-6 text-center text-sm font-mono">
                            {line.qty}
                          </span>
                          <Button
                            variant="outline"
                            size="icon-xs"
                            onClick={() => changeQty(line.variantId, 1)}
                            aria-label="Increase quantity"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="w-20 text-end text-sm font-mono shrink-0">
                          {formatMoney(line.unitPriceMinor * line.qty, currency)}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeLine(line.variantId)}
                          aria-label="Remove line"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="border-t border-border pt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-mono">
                    {formatMoney(subtotalMinor, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span>VAT</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={taxRatePct}
                      onChange={(e) => setTaxRatePct(e.target.value)}
                      className="h-7 w-16 text-xs"
                      aria-label="Tax rate percent"
                    />
                    <span>%</span>
                  </div>
                  <span className="font-mono">
                    {formatMoney(taxMinor, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
                  <span>Total</span>
                  <span className="font-mono">
                    {formatMoney(totalMinor, currency)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pos-payment">Payment method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="pos-payment" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method.value} value={method.value}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pos-customer">Customer name</Label>
                <Input
                  id="pos-customer"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Optional"
                />
              </div>

              <Button
                className="w-full"
                disabled={!canCheckout}
                onClick={handleCheckout}
              >
                {checkout.isPending ? "Processing…" : "Complete Sale"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
