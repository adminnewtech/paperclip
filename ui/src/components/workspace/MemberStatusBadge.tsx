import type { WorkspaceMemberStatus } from "@paperclipai/shared";
import { cn } from "@/lib/utils";

const COLOR: Record<WorkspaceMemberStatus, string> = {
  online: "bg-emerald-500",
  working: "bg-blue-500",
  busy: "bg-amber-500",
  away: "bg-zinc-400",
  offline: "bg-zinc-300 dark:bg-zinc-600",
};

const LABEL_EN: Record<WorkspaceMemberStatus, string> = {
  online: "Online",
  working: "Working",
  busy: "Busy",
  away: "Away",
  offline: "Offline",
};

const LABEL_AR: Record<WorkspaceMemberStatus, string> = {
  online: "متصل",
  working: "يعمل",
  busy: "مشغول",
  away: "بعيد",
  offline: "غير متصل",
};

export interface MemberStatusBadgeProps {
  status: WorkspaceMemberStatus | undefined;
  lang?: "en" | "ar";
  size?: "xs" | "sm" | "md";
  showLabel?: boolean;
  className?: string;
}

export function MemberStatusBadge({
  status,
  lang = "en",
  size = "sm",
  showLabel = false,
  className,
}: MemberStatusBadgeProps) {
  const resolved = status ?? "offline";
  const dotSize =
    size === "xs" ? "size-1.5" : size === "md" ? "size-3" : "size-2";
  const label = lang === "ar" ? LABEL_AR[resolved] : LABEL_EN[resolved];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
      title={label}
    >
      <span
        className={cn("rounded-full ring-2 ring-background", COLOR[resolved], dotSize)}
        aria-label={label}
      />
      {showLabel ? <span>{label}</span> : null}
    </span>
  );
}
