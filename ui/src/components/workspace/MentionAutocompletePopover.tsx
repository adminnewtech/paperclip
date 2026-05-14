import { useEffect, useMemo } from "react";
import type { WorkspaceMember } from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "./MemberAvatar";

export interface MentionAutocompletePopoverProps {
  open: boolean;
  members: WorkspaceMember[];
  prefix: string;
  selectedIndex: number;
  onSelectionChange: (index: number, total: number) => void;
  onPick: (member: WorkspaceMember) => void;
  lang?: "en" | "ar";
}

export function MentionAutocompletePopover({
  open,
  members,
  prefix,
  selectedIndex,
  onSelectionChange,
  onPick,
  lang = "en",
}: MentionAutocompletePopoverProps) {
  const filtered = useMemo(() => {
    const q = prefix.toLowerCase();
    if (!q) return members.slice(0, 10);
    return members
      .filter((m) =>
        [m.displayName, m.displayNameAr, m.id]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
      .slice(0, 10);
  }, [members, prefix]);

  useEffect(() => {
    onSelectionChange(0, filtered.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length, prefix]);

  if (!open || filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 z-30 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
      <div className="border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {lang === "ar" ? "إشارة إلى" : "Mention"}
      </div>
      <ul role="listbox">
        {filtered.map((m, i) => (
          <li
            key={m.id}
            role="option"
            aria-selected={i === selectedIndex}
            className={cn(
              "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
              i === selectedIndex ? "bg-accent" : "hover:bg-accent/60",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(m);
            }}
          >
            <MemberAvatar member={m} size="xs" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{m.displayName}</div>
              {m.title ? (
                <div className="truncate text-xs text-muted-foreground">
                  {m.title}
                </div>
              ) : null}
            </div>
            {m.type === "agent" ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                AI
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
