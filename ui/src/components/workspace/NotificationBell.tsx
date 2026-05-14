import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NotificationBellProps {
  total: number;
  lang?: "en" | "ar";
  onClick?: () => void;
}

export function NotificationBell({ total, lang = "en", onClick }: NotificationBellProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      className="relative"
      title={
        total > 0
          ? lang === "ar"
            ? `${total} غير مقروء`
            : `${total} unread`
          : lang === "ar"
            ? "لا توجد إشعارات"
            : "No new notifications"
      }
    >
      <Bell />
      {total > 0 ? (
        <span
          className={cn(
            "absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-white",
          )}
        >
          {total > 99 ? "99+" : total}
        </span>
      ) : null}
    </Button>
  );
}
