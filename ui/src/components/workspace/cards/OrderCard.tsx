import type { WorkspaceMessageCard } from "@paperclipai/shared";
import { ShoppingCart } from "lucide-react";
import { CardShell, type CardActionHandler } from "./_shared";

export interface OrderCardProps {
  card: WorkspaceMessageCard;
  lang?: "en" | "ar";
  onAction?: CardActionHandler;
  busyAction?: string | null;
}

function fmtCents(cents: unknown, currency: unknown): string {
  if (typeof cents !== "number") return "—";
  const cur = typeof currency === "string" ? currency : "USD";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: cur,
  }).format(cents / 100);
}

export function OrderCard({ card, lang = "en", onAction, busyAction }: OrderCardProps) {
  const s = card.snapshot ?? {};
  const number = (s.number as string | undefined) ?? card.entityId.slice(0, 8);
  const status = (s.status as string | undefined) ?? "pending";
  const total = fmtCents(s.totalCents, s.currency);
  const customer = (s.customerName as string | undefined) ?? "—";
  const itemCount = (s.itemCount as number | undefined) ?? 0;

  return (
    <CardShell
      icon={<ShoppingCart className="size-4" />}
      title={lang === "ar" ? `طلب #${number}` : `Order #${number}`}
      badge={status}
      lang={lang}
      actions={card.actions}
      busyAction={busyAction}
      onAction={onAction}
    >
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">
            {lang === "ar" ? "العميل" : "Customer"}
          </div>
          <div className="font-medium">{customer}</div>
        </div>
        <div>
          <div className="text-muted-foreground">
            {lang === "ar" ? "الإجمالي" : "Total"}
          </div>
          <div className="font-semibold">{total}</div>
        </div>
        <div>
          <div className="text-muted-foreground">
            {lang === "ar" ? "العناصر" : "Items"}
          </div>
          <div>{itemCount}</div>
        </div>
      </div>
    </CardShell>
  );
}
