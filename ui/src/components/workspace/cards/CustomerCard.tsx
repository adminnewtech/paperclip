import type { WorkspaceMessageCard } from "@paperclipai/shared";
import { User } from "lucide-react";
import { CardShell, type CardActionHandler } from "./_shared";

export interface CustomerCardProps {
  card: WorkspaceMessageCard;
  lang?: "en" | "ar";
  onAction?: CardActionHandler;
  busyAction?: string | null;
}

export function CustomerCard({ card, lang = "en", onAction, busyAction }: CustomerCardProps) {
  const s = card.snapshot ?? {};
  const name = (s.name as string | undefined) ?? "—";
  const email = (s.email as string | undefined) ?? null;
  const phone = (s.phone as string | undefined) ?? null;
  const company = (s.company as string | undefined) ?? null;

  return (
    <CardShell
      icon={<User className="size-4" />}
      title={lang === "ar" ? "عميل" : "Customer"}
      lang={lang}
      actions={card.actions}
      busyAction={busyAction}
      onAction={onAction}
    >
      <div className="space-y-1 text-xs">
        <div className="font-medium">{name}</div>
        {company ? <div className="text-muted-foreground">{company}</div> : null}
        {email ? (
          <div>
            <span className="text-muted-foreground">
              {lang === "ar" ? "البريد: " : "Email: "}
            </span>
            <span>{email}</span>
          </div>
        ) : null}
        {phone ? (
          <div>
            <span className="text-muted-foreground">
              {lang === "ar" ? "الهاتف: " : "Phone: "}
            </span>
            <span>{phone}</span>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}
