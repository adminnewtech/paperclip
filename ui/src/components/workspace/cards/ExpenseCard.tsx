import type { WorkspaceMessageCard } from "@paperclipai/shared";
import { Wallet } from "lucide-react";
import { CardShell, type CardActionHandler } from "./_shared";

export interface ExpenseCardProps {
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

export function ExpenseCard({ card, lang = "en", onAction, busyAction }: ExpenseCardProps) {
  const s = card.snapshot ?? {};
  const vendor = (s.vendor as string | undefined) ?? "—";
  const amount = fmtCents(s.amountCents, s.currency);
  const status = (s.status as string | undefined) ?? "pending";
  const category = (s.category as string | undefined) ?? null;

  return (
    <CardShell
      icon={<Wallet className="size-4" />}
      title={lang === "ar" ? "مصروف" : "Expense"}
      badge={status}
      lang={lang}
      actions={card.actions}
      busyAction={busyAction}
      onAction={onAction}
    >
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">
            {lang === "ar" ? "المورد" : "Vendor"}
          </div>
          <div className="font-medium">{vendor}</div>
        </div>
        <div>
          <div className="text-muted-foreground">
            {lang === "ar" ? "المبلغ" : "Amount"}
          </div>
          <div className="font-semibold">{amount}</div>
        </div>
        {category ? (
          <div className="col-span-2">
            <div className="text-muted-foreground">
              {lang === "ar" ? "التصنيف" : "Category"}
            </div>
            <div>{category}</div>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}
