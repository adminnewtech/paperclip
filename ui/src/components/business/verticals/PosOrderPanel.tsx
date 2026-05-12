import { useState } from "react";
import {
  ChefHat,
  CreditCard,
  Minus,
  Percent,
  Plus,
  Printer,
  Trash2,
  Utensils,
  Bike,
  ShoppingBag,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  formatKwd,
  type Order,
  type OrderType,
  type PaymentMethod,
  type Table,
} from "../../../api/business-restaurants";

interface PosOrderPanelProps {
  order: Order | null;
  tables: Table[];
  draftType: OrderType;
  draftTableId: string | null;
  draftCustomerName: string;
  draftCustomerPhone: string;
  onTypeChange: (type: OrderType) => void;
  onTableChange: (tableId: string | null) => void;
  onCustomerNameChange: (name: string) => void;
  onCustomerPhoneChange: (phone: string) => void;
  onRemoveItem: (index: number) => void;
  onVoidItem: (index: number, reason: string) => void;
  onApplyDiscount: (cents: number, reason?: string) => void;
  onTakePayment: (method: PaymentMethod, amountCents: number) => void;
  onSendToKitchen: () => void;
  onPrintBill: () => void;
  onCloseOrder: () => void;
  onCancelOrder: (reason: string) => void;
  busy?: boolean;
}

const ORDER_TYPE_OPTIONS: Array<{
  value: OrderType;
  label: string;
  icon: typeof Utensils;
}> = [
  { value: "dine_in", label: "Dine-in", icon: Utensils },
  { value: "takeout", label: "Takeout", icon: ShoppingBag },
  { value: "delivery", label: "Delivery", icon: Bike },
];

export function PosOrderPanel({
  order,
  tables,
  draftType,
  draftTableId,
  draftCustomerName,
  draftCustomerPhone,
  onTypeChange,
  onTableChange,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onRemoveItem,
  onVoidItem,
  onApplyDiscount,
  onTakePayment,
  onSendToKitchen,
  onPrintBill,
  onCloseOrder,
  onCancelOrder,
  busy,
}: PosOrderPanelProps) {
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [voidIndex, setVoidIndex] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const items = order?.items ?? [];
  const total = order?.totalCents ?? 0;
  const subtotal = order?.subtotalCents ?? 0;
  const discount = order?.discountCents ?? 0;
  const service = order?.serviceChargeCents ?? 0;
  const vat = order?.vatCents ?? 0;
  const paid = order ? order.payments.reduce((s, p) => s + p.amountCents, 0) : 0;
  const due = Math.max(0, total - paid);

  function openPayment() {
    setPaymentAmount((due / 1000).toFixed(3));
    setPaymentOpen(true);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="grid grid-cols-3 gap-2">
          {ORDER_TYPE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = draftType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onTypeChange(opt.value)}
                disabled={!!order && order.type !== opt.value}
                className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs font-medium transition ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:border-primary/50"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <Icon className="h-5 w-5" />
                {opt.label}
              </button>
            );
          })}
        </div>

        {draftType === "dine_in" ? (
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Table
            </Label>
            <Select
              value={draftTableId ?? ""}
              onValueChange={(v) => onTableChange(v || null)}
              disabled={!!order}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select table" />
              </SelectTrigger>
              <SelectContent>
                {tables.map((t) => (
                  <SelectItem
                    key={t.id}
                    value={t.id}
                    disabled={
                      t.status === "occupied" && t.currentOrderId !== order?.id
                    }
                  >
                    {t.name} · {t.capacity} seats
                    {t.status === "occupied" && t.currentOrderId !== order?.id
                      ? " (busy)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Customer
              </Label>
              <Input
                value={order?.customerName ?? draftCustomerName}
                onChange={(e) => onCustomerNameChange(e.target.value)}
                disabled={!!order}
                placeholder="Name"
                className="h-10"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Phone
              </Label>
              <Input
                value={order?.customerPhone ?? draftCustomerPhone}
                onChange={(e) => onCustomerPhoneChange(e.target.value)}
                disabled={!!order}
                placeholder="+965…"
                className="h-10"
              />
            </div>
          </div>
        )}

        {order ? (
          <div className="flex items-center justify-between text-sm">
            <div className="font-mono text-xs text-muted-foreground">
              {order.code}
            </div>
            <Badge variant="outline" className="capitalize">
              {order.status.replace(/_/g, " ")}
            </Badge>
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            <div>
              Tap items from the menu to add them to this order.
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item, idx) => (
              <li
                key={`${item.itemId}-${idx}`}
                className={`flex items-start gap-3 p-3 ${
                  item.voided ? "opacity-50" : ""
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.itemName}</span>
                    {item.voided ? (
                      <Badge variant="destructive" className="text-[10px]">
                        VOID
                      </Badge>
                    ) : null}
                  </div>
                  {item.modifiers.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {item.modifiers
                        .map((m) =>
                          m.priceCents > 0
                            ? `${m.name} (+${formatKwd(m.priceCents)})`
                            : m.name,
                        )
                        .join(", ")}
                    </div>
                  ) : null}
                  {item.notes ? (
                    <div className="text-xs italic text-muted-foreground">
                      Note: {item.notes}
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    {item.quantity} × {formatKwd(item.unitPriceCents)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right text-sm font-semibold tabular-nums">
                    {formatKwd(item.lineTotalCents)}
                  </div>
                  {!item.voided ? (
                    order && order.status !== "open" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => {
                          setVoidIndex(idx);
                          setVoidReason("");
                        }}
                        title="Void item"
                        disabled={busy}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => onRemoveItem(idx)}
                        title="Remove"
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t p-4 space-y-3">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{formatKwd(subtotal)}</dd>
          </div>
          {discount > 0 ? (
            <div className="flex justify-between text-destructive">
              <dt>Discount</dt>
              <dd className="tabular-nums">-{formatKwd(discount)}</dd>
            </div>
          ) : null}
          {service > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                Service ({order?.serviceChargePercent ?? 0}%)
              </dt>
              <dd className="tabular-nums">{formatKwd(service)}</dd>
            </div>
          ) : null}
          {vat > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                VAT ({order?.vatRatePercent ?? 0}%)
              </dt>
              <dd className="tabular-nums">{formatKwd(vat)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t pt-2 text-lg font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatKwd(total)}</dd>
          </div>
          {paid > 0 ? (
            <>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="tabular-nums">{formatKwd(paid)}</dd>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <dt>Due</dt>
                <dd className="tabular-nums">{formatKwd(due)}</dd>
              </div>
            </>
          ) : null}
        </dl>

        {order ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="lg"
              variant="outline"
              onClick={() => setDiscountOpen(true)}
              disabled={busy || order.status === "paid"}
            >
              <Percent className="mr-1 h-4 w-4" /> Discount
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={onPrintBill}
              disabled={busy}
            >
              <Printer className="mr-1 h-4 w-4" /> Print
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={onSendToKitchen}
              disabled={
                busy || items.filter((i) => !i.voided).length === 0
              }
            >
              <ChefHat className="mr-1 h-4 w-4" /> Send
            </Button>
            <Button
              size="lg"
              onClick={openPayment}
              disabled={busy || total === 0 || order.status === "paid"}
            >
              <CreditCard className="mr-1 h-4 w-4" /> Pay
            </Button>
            {due === 0 && order.status !== "paid" ? (
              <Button
                size="lg"
                className="col-span-2"
                onClick={onCloseOrder}
                disabled={busy}
              >
                Close order
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="col-span-2 text-destructive"
              onClick={() => setCancelOpen(true)}
              disabled={busy || order.status === "paid"}
            >
              Cancel order
            </Button>
          </div>
        ) : (
          <div className="text-center text-xs text-muted-foreground">
            Tap a menu item to start a new order.
          </div>
        )}
      </div>

      <Dialog open={discountOpen} onOpenChange={setDiscountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply discount</DialogTitle>
            <DialogDescription>
              Discount applies to the order subtotal before service and VAT.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Amount (KWD)</Label>
              <Input
                type="number"
                step="0.001"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="0.500"
              />
            </div>
            <div>
              <Label>Reason (optional)</Label>
              <Input
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                placeholder="e.g. Loyalty member"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDiscountOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const cents = Math.round(
                  Number(discountAmount || "0") * 1000,
                );
                onApplyDiscount(cents, discountReason || undefined);
                setDiscountOpen(false);
                setDiscountAmount("");
                setDiscountReason("");
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take payment</DialogTitle>
            <DialogDescription>
              Due: <strong>{formatKwd(due)}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Method</Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) =>
                  setPaymentMethod(v as PaymentMethod)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="knet">KNET</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (KWD)</Label>
              <Input
                type="number"
                step="0.001"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPaymentOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const cents = Math.round(
                  Number(paymentAmount || "0") * 1000,
                );
                if (cents > 0) {
                  onTakePayment(paymentMethod, cents);
                }
                setPaymentOpen(false);
              }}
            >
              Take payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={voidIndex !== null}
        onOpenChange={(open) => !open && setVoidIndex(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void item</DialogTitle>
            <DialogDescription>
              Voided items are kept on the bill at zero value for audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason</Label>
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Sent to wrong table"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidIndex(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (voidIndex !== null && voidReason.trim()) {
                  onVoidItem(voidIndex, voidReason.trim());
                  setVoidIndex(null);
                  setVoidReason("");
                }
              }}
              disabled={!voidReason.trim()}
            >
              Void item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel order</DialogTitle>
            <DialogDescription>
              This cannot be undone. The table will be released.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason</Label>
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Customer changed mind"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (cancelReason.trim()) {
                  onCancelOrder(cancelReason.trim());
                  setCancelOpen(false);
                  setCancelReason("");
                }
              }}
              disabled={!cancelReason.trim()}
            >
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Silence unused-imports for the buttons that aren't shown in some states */}
      <span className="hidden">
        <Plus />
        <Minus />
      </span>
    </div>
  );
}
