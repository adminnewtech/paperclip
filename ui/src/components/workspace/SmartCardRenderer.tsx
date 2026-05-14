import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { WorkspaceMessageCard } from "@paperclipai/shared";
import { FileQuestion } from "lucide-react";
import { workspaceApi } from "@/api/workspace";
import { CardShell } from "./cards/_shared";
import { InvoiceCard } from "./cards/InvoiceCard";
import { OrderCard } from "./cards/OrderCard";
import { TicketCard } from "./cards/TicketCard";
import { ExpenseCard } from "./cards/ExpenseCard";
import { PaymentCard } from "./cards/PaymentCard";
import { DealCard } from "./cards/DealCard";
import { CustomerCard } from "./cards/CustomerCard";
import { ProductCard } from "./cards/ProductCard";

export interface SmartCardRendererProps {
  companyId: string;
  card: WorkspaceMessageCard;
  lang?: "en" | "ar";
}

function pickCard(type: string) {
  const t = type.toLowerCase();
  if (t === "invoice") return InvoiceCard;
  if (t === "order" || t === "sales_order" || t === "purchase_order") return OrderCard;
  if (t === "ticket" || t === "support_ticket") return TicketCard;
  if (t === "expense") return ExpenseCard;
  if (t === "payment") return PaymentCard;
  if (t === "deal" || t === "opportunity") return DealCard;
  if (t === "customer" || t === "contact") return CustomerCard;
  if (t === "product" || t === "item") return ProductCard;
  return null;
}

export function SmartCardRenderer({ companyId, card, lang = "en" }: SmartCardRendererProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  const execAction = useMutation({
    mutationFn: (actionKey: string) =>
      workspaceApi.cards.executeAction(companyId, card.entityType, card.entityId, actionKey),
    onMutate: (actionKey: string) => {
      setBusyAction(actionKey);
      setActionError(null);
      setActionResult(null);
    },
    onSuccess: (res) => {
      if (res.ok) {
        setActionResult(
          lang === "ar" ? "تم بنجاح" : "Done",
        );
      } else if (res.error) {
        setActionError(res.error);
      }
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
    onSettled: () => {
      setBusyAction(null);
    },
  });

  const Component = pickCard(card.entityType);

  const inner = Component ? (
    <Component
      card={card}
      lang={lang}
      busyAction={busyAction}
      onAction={(actionKey) => {
        execAction.mutate(actionKey);
      }}
    />
  ) : (
    <CardShell
      icon={<FileQuestion className="size-4" />}
      title={card.entityType}
      lang={lang}
      actions={card.actions}
      busyAction={busyAction}
      onAction={(actionKey) => {
        execAction.mutate(actionKey);
      }}
    >
      <div className="text-xs text-muted-foreground">
        {lang === "ar"
          ? "نوع البطاقة غير معروف. يتم عرض الإجراءات أدناه."
          : "Unknown card type; raw actions shown below."}
      </div>
      {card.snapshot ? (
        <pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 text-[10px]">
          {JSON.stringify(card.snapshot, null, 2)}
        </pre>
      ) : null}
    </CardShell>
  );

  return (
    <div className="space-y-1">
      {inner}
      {actionError ? (
        <div className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}
      {actionResult ? (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          {actionResult}
        </div>
      ) : null}
    </div>
  );
}
