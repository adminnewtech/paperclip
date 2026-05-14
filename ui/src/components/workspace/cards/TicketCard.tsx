import type { WorkspaceMessageCard } from "@paperclipai/shared";
import { LifeBuoy } from "lucide-react";
import { CardShell, type CardActionHandler } from "./_shared";

export interface TicketCardProps {
  card: WorkspaceMessageCard;
  lang?: "en" | "ar";
  onAction?: CardActionHandler;
  busyAction?: string | null;
}

export function TicketCard({ card, lang = "en", onAction, busyAction }: TicketCardProps) {
  const s = card.snapshot ?? {};
  const subject = (s.subject as string | undefined) ?? "—";
  const priority = (s.priority as string | undefined) ?? "normal";
  const status = (s.status as string | undefined) ?? "open";
  const requester = (s.requesterName as string | undefined) ?? "—";

  return (
    <CardShell
      icon={<LifeBuoy className="size-4" />}
      title={lang === "ar" ? `تذكرة دعم` : `Support ticket`}
      badge={status}
      lang={lang}
      actions={card.actions}
      busyAction={busyAction}
      onAction={onAction}
    >
      <div className="space-y-2 text-xs">
        <div>
          <div className="text-muted-foreground">
            {lang === "ar" ? "الموضوع" : "Subject"}
          </div>
          <div className="font-medium">{subject}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-muted-foreground">
              {lang === "ar" ? "الأولوية" : "Priority"}
            </div>
            <div>{priority}</div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {lang === "ar" ? "المُبلِّغ" : "Requester"}
            </div>
            <div>{requester}</div>
          </div>
        </div>
      </div>
    </CardShell>
  );
}
