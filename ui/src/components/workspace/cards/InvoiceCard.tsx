import type { WorkspaceMessageCard } from "@paperclipai/shared";
import { Receipt } from "lucide-react";
import { CardShell, type CardActionHandler } from "./_shared";

export interface InvoiceCardProps {
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
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function InvoiceCard({ card, lang = "en", onAction, busyAction }: InvoiceCardProps) {
  const s = card.snapshot ?? {};
  const number = (s.number as string | undefined) ?? card.entityId.slice(0, 8);
  const status = (s.status as string | undefined) ?? "draft";
  const total = fmtCents(s.totalCents, s.currency);
  const customer = (s.customerName as string | undefined) ?? "—";
  const dueDate = s.dueDate as string | undefined;

  return (
    <CardShell
      icon={<Receipt className="size-4" />}
      title={
        lang === "ar"
          ? `فاتورة #${number}`
          : `Invoice #${number}`
      }
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
        {dueDate ? (
          <div className="col-span-2">
            <div className="text-muted-foreground">
              {lang === "ar" ? "تاريخ الاستحقاق" : "Due"}
            </div>
            <div>{new Date(dueDate).toLocaleDateString()}</div>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}
