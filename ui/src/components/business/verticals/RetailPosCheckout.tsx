import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  DollarSign,
  Gift,
  Percent,
  Trash2,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  businessRetailApi,
  formatFils,
  type RetailPaymentMethod,
  type RetailSale,
} from "@/api/business-retail";

/**
 * The cashier-facing checkout panel.
 *
 * Renders the sale's items, totals, customer/loyalty section and the big
 * "PAY" button. All mutations call the retail API which is the canonical
 * source of totals — the UI is intentionally dumb to prevent drift.
 *
 * Layout: vertical, designed for the left column of the POS page.
 */
export interface RetailPosCheckoutProps {
  companyId: string;
  sale: RetailSale;
  onCompleted: (sale: RetailSale) => void;
}

const PAYMENT_METHODS: Array<{ key: RetailPaymentMethod; label: string; icon: typeof DollarSign }> = [
  { key: "cash", label: "Cash", icon: DollarSign },
  { key: "card", label: "Card", icon: CreditCard },
  { key: "knet", label: "KNET", icon: CreditCard },
];

export function RetailPosCheckout({
  companyId,
  sale,
  onCompleted,
}: RetailPosCheckoutProps) {
  const qc = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [tendered, setTendered] = useState("");
  const [method, setMethod] = useState<RetailPaymentMethod>("cash");
  const [loyaltyPhone, setLoyaltyPhone] = useState("");
  const [redeemPoints, setRedeemPoints] = useState("");
  const [discountValue, setDiscountValue] = useState("");
  const [discountType, setDiscountType] = useState<"amount" | "percent">("percent");

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["retail", companyId, "sale", sale.id] });

  const removeItem = useMutation({
    mutationFn: (index: number) =>
      businessRetailApi.removeItem(companyId, sale.id, index),
    onSuccess: invalidate,
  });

  const attachLoyalty = useMutation({
    mutationFn: () =>
      businessRetailApi.attachLoyalty(companyId, sale.id, loyaltyPhone.trim()),
    onSuccess: () => {
      setLoyaltyPhone("");
      void invalidate();
    },
  });

  const redeem = useMutation({
    mutationFn: () =>
      businessRetailApi.redeemPoints(companyId, sale.id, Number(redeemPoints) || 0),
    onSuccess: () => {
      setRedeemPoints("");
      void invalidate();
    },
  });

  const applyDiscount = useMutation({
    mutationFn: () =>
      businessRetailApi.applyDiscount(companyId, sale.id, {
        type: discountType,
        value: Number(discountValue) || 0,
      }),
    onSuccess: () => {
      setDiscountValue("");
      void invalidate();
    },
  });

  const pay = useMutation({
    mutationFn: async () => {
      const amount = Math.max(0, Math.round(Number(tendered) * 1000));
      // Take payment then complete.
      await businessRetailApi.takePayment(companyId, sale.id, {
        method,
        amountCents: amount > 0 ? amount : sale.totalCents,
      });
      const { sale: completed } = await businessRetailApi.completeSale(
        companyId,
        sale.id,
      );
      return completed;
    },
    onSuccess: (completed) => {
      setPayOpen(false);
      setTendered("");
      onCompleted(completed);
      void invalidate();
    },
  });

  const change = (() => {
    const t = Math.round(Number(tendered) * 1000);
    return Math.max(0, t - sale.totalCents);
  })();

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current sale
          </div>
          <div className="text-lg font-semibold">{sale.code}</div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {new Date(sale.createdAt).toLocaleTimeString()}
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-3">
        {sale.items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Scan a product to start the sale
          </div>
        ) : (
          <ul className="space-y-1.5">
            {sale.items.map((it, i) => (
              <li
                key={`${it.productId}-${i}`}
                className="flex items-center gap-2 border border-border bg-background p-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{it.productName}</div>
                  <div className="text-xs text-muted-foreground">
                    {it.quantity} × {formatFils(it.unitPriceCents)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">
                    {formatFils(it.lineTotalCents)}
                  </div>
                  {it.lineTaxCents > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      incl. {formatFils(it.lineTaxCents)} VAT
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeItem.mutate(i)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Loyalty / customer section */}
      <div className="space-y-2 border-t border-border p-3">
        {sale.loyaltyMemberId ? (
          <div className="flex items-center gap-2 bg-emerald-50 p-2 text-sm dark:bg-emerald-950/40">
            <Gift className="h-4 w-4 text-emerald-600" />
            <span className="flex-1">
              {sale.customerName ?? "Loyalty member"} · {sale.customerPhone}
            </span>
          </div>
        ) : (
          <div className="flex gap-1">
            <input
              type="tel"
              placeholder="Loyalty phone"
              value={loyaltyPhone}
              onChange={(e) => setLoyaltyPhone(e.target.value)}
              className="flex-1 h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => attachLoyalty.mutate()}
              disabled={attachLoyalty.isPending || loyaltyPhone.length < 4}
            >
              <User className="mr-1 h-4 w-4" />
              Attach
            </Button>
          </div>
        )}

        {sale.loyaltyMemberId && (
          <div className="flex gap-1">
            <input
              type="number"
              min={0}
              placeholder="Redeem points"
              value={redeemPoints}
              onChange={(e) => setRedeemPoints(e.target.value)}
              className="flex-1 h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => redeem.mutate()}
              disabled={redeem.isPending || !redeemPoints}
            >
              <Gift className="mr-1 h-4 w-4" />
              Redeem
            </Button>
          </div>
        )}

        <div className="flex gap-1">
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as "amount" | "percent")}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
          >
            <option value="percent">%</option>
            <option value="amount">KWD</option>
          </select>
          <input
            type="number"
            min={0}
            step="0.001"
            placeholder="Discount"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            className="flex-1 h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => applyDiscount.mutate()}
            disabled={applyDiscount.isPending}
          >
            <Percent className="mr-1 h-4 w-4" />
            Apply
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="space-y-1 border-t border-border p-3 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span>{formatFils(sale.subtotalCents)}</span>
        </div>
        {sale.discountCents > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Discount</span>
            <span>−{formatFils(sale.discountCents)}</span>
          </div>
        )}
        {sale.loyaltyPointsRedeemedCents > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Loyalty</span>
            <span>−{formatFils(sale.loyaltyPointsRedeemedCents)}</span>
          </div>
        )}
        <div className="flex justify-between text-muted-foreground">
          <span>VAT</span>
          <span>{formatFils(sale.taxCents)}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2 text-2xl font-bold">
          <span>TOTAL</span>
          <span>{formatFils(sale.totalCents)}</span>
        </div>
      </div>

      <div className="border-t border-border p-3">
        <Button
          size="lg"
          className="h-16 w-full text-xl font-bold"
          disabled={sale.items.length === 0 || sale.status !== "draft"}
          onClick={() => setPayOpen(true)}
        >
          PAY
        </Button>
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-3xl font-bold">{formatFils(sale.totalCents)}</div>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMethod(m.key)}
                    className={`flex h-16 flex-col items-center justify-center gap-1 border ${
                      method === m.key
                        ? "border-primary bg-primary/10"
                        : "border-border"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs">{m.label}</span>
                  </button>
                );
              })}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                Tendered (KWD)
              </label>
              <input
                type="number"
                min={0}
                step="0.001"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                className="mt-1 h-14 w-full rounded-md border border-input bg-transparent px-3 text-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                autoFocus
              />
              <div className="mt-1 text-sm text-muted-foreground">
                Change: <span className="font-semibold">{formatFils(change)}</span>
              </div>
            </div>
            {pay.isError && (
              <div className="bg-destructive/10 p-2 text-xs text-destructive">
                {(pay.error as Error)?.message ?? "Payment failed"}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPayOpen(false)}
              disabled={pay.isPending}
            >
              <X className="mr-1 h-4 w-4" />
              Cancel
            </Button>
            <Button onClick={() => pay.mutate()} disabled={pay.isPending}>
              Complete sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
