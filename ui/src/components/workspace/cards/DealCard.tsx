import type { WorkspaceMessageCard } from "@paperclipai/shared";
import { TrendingUp } from "lucide-react";
import { CardShell, type CardActionHandler } from "./_shared";

export interface DealCardProps {
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

export function DealCard({ card, lang = "en", onAction, busyAction }: DealCardProps) {
  const s = card.snapshot ?? {};
  const name = (s.name as string | undefined) ?? "—";
  const value = fmtCents(s.valueCents, s.currency);
  const stage = (s.stage as string | undefined) ?? "prospect";
  const customer = (s.customerName as string | undefined) ?? null;

  return (
    <CardShell
      icon={<TrendingUp className="size-4" />}
      title={lang === "ar" ? "صفقة" : "Deal"}
      badge={stage}
      lang={lang}
      actions={card.actions}
      busyAction={busyAction}
      onAction={onAction}
    >
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="col-span-2">
          <div className="text-muted-foreground">
            {lang === "ar" ? "الاسم" : "Name"}
          </div>
          <div className="font-medium">{name}</div>
        </div>
        <div>
          <div className="text-muted-foreground">
            {lang === "ar" ? "القيمة" : "Value"}
          </div>
          <div className="font-semibold">{value}</div>
        </div>
        {customer ? (
          <div>
            <div className="text-muted-foreground">
              {lang === "ar" ? "العميل" : "Customer"}
            </div>
            <div>{customer}</div>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}
