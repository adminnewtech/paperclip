import type { WorkspaceMessageCard } from "@paperclipai/shared";
import { Banknote } from "lucide-react";
import { CardShell, type CardActionHandler } from "./_shared";

export interface PaymentCardProps {
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

export function PaymentCard({ card, lang = "en", onAction, busyAction }: PaymentCardProps) {
  const s = card.snapshot ?? {};
  const amount = fmtCents(s.amountCents, s.currency);
  const method = (s.method as string | undefined) ?? "—";
  const status = (s.status as string | undefined) ?? "pending";
  const reference = (s.reference as string | undefined) ?? null;

  return (
    <CardShell
      icon={<Banknote className="size-4" />}
      title={lang === "ar" ? "دفعة" : "Payment"}
      badge={status}
      lang={lang}
      actions={card.actions}
      busyAction={busyAction}
      onAction={onAction}
    >
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">
            {lang === "ar" ? "المبلغ" : "Amount"}
          </div>
          <div className="font-semibold">{amount}</div>
        </div>
        <div>
          <div className="text-muted-foreground">
            {lang === "ar" ? "الطريقة" : "Method"}
          </div>
          <div>{method}</div>
        </div>
        {reference ? (
          <div className="col-span-2">
            <div className="text-muted-foreground">
              {lang === "ar" ? "المرجع" : "Reference"}
            </div>
            <div className="font-mono text-[11px]">{reference}</div>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}
