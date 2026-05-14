import type { WorkspaceMessageCard } from "@paperclipai/shared";
import { Package } from "lucide-react";
import { CardShell, type CardActionHandler } from "./_shared";

export interface ProductCardProps {
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

export function ProductCard({ card, lang = "en", onAction, busyAction }: ProductCardProps) {
  const s = card.snapshot ?? {};
  const name = (s.name as string | undefined) ?? "—";
  const sku = (s.sku as string | undefined) ?? null;
  const price = fmtCents(s.priceCents, s.currency);
  const stock = s.stock as number | undefined;

  return (
    <CardShell
      icon={<Package className="size-4" />}
      title={lang === "ar" ? "منتج" : "Product"}
      lang={lang}
      actions={card.actions}
      busyAction={busyAction}
      onAction={onAction}
    >
      <div className="space-y-2 text-xs">
        <div>
          <div className="font-medium">{name}</div>
          {sku ? <div className="font-mono text-[11px] text-muted-foreground">{sku}</div> : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-muted-foreground">
              {lang === "ar" ? "السعر" : "Price"}
            </div>
            <div className="font-semibold">{price}</div>
          </div>
          {typeof stock === "number" ? (
            <div>
              <div className="text-muted-foreground">
                {lang === "ar" ? "المخزون" : "Stock"}
              </div>
              <div>{stock}</div>
            </div>
          ) : null}
        </div>
      </div>
    </CardShell>
  );
}
