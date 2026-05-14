import { useMemo } from "react";
import type { WorkspaceMember } from "@paperclipai/shared";
import { MemberAvatar } from "./MemberAvatar";
import { MemberStatusBadge } from "./MemberStatusBadge";

export interface MembersPanelProps {
  members: WorkspaceMember[];
  lang?: "en" | "ar";
  onSelect?: (member: WorkspaceMember) => void;
}

const STATUS_ORDER: Record<string, number> = {
  online: 0,
  working: 1,
  busy: 2,
  away: 3,
  offline: 4,
};

export function MembersPanel({ members, lang = "en", onSelect }: MembersPanelProps) {
  const groups = useMemo(() => {
    const online: WorkspaceMember[] = [];
    const working: WorkspaceMember[] = [];
    const away: WorkspaceMember[] = [];
    const offline: WorkspaceMember[] = [];
    const sorted = [...members].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 99;
      const sb = STATUS_ORDER[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
      return a.displayName.localeCompare(b.displayName);
    });
    for (const m of sorted) {
      if (m.status === "online") online.push(m);
      else if (m.status === "working" || m.status === "busy") working.push(m);
      else if (m.status === "away") away.push(m);
      else offline.push(m);
    }
    return { online, working, away, offline };
  }, [members]);

  const renderSection = (
    title: string,
    list: WorkspaceMember[],
  ) => {
    if (list.length === 0) return null;
    return (
      <div className="space-y-0.5">
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {title} · {list.length}
        </div>
        {list.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect?.(m)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <div className="relative">
              <MemberAvatar member={m} size="sm" />
              <MemberStatusBadge
                status={m.status}
                size="xs"
                className="absolute -bottom-0.5 -end-0.5 inline-block rounded-full bg-background p-px"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate font-medium">
                  {lang === "ar" && m.displayNameAr ? m.displayNameAr : m.displayName}
                </span>
                {m.type === "agent" ? (
                  <span className="rounded bg-primary/10 px-1 text-[9px] font-medium text-primary">
                    AI
                  </span>
                ) : null}
              </div>
              {m.title ? (
                <div className="truncate text-xs text-muted-foreground">
                  {m.title}
                </div>
              ) : m.statusMessage ? (
                <div className="truncate text-xs text-muted-foreground">
                  {m.statusMessage}
                </div>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col border-s border-border bg-muted/20">
      <div className="border-b border-border px-3 py-2.5">
        <h3 className="text-sm font-semibold">
          {lang === "ar" ? "الأعضاء" : "Members"}
        </h3>
        <p className="text-xs text-muted-foreground">
          {members.length}{" "}
          {lang === "ar"
            ? "في هذه القناة"
            : members.length === 1
              ? "in this channel"
              : "in this channel"}
        </p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {members.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            {lang === "ar" ? "لا يوجد أعضاء" : "No members"}
          </div>
        ) : null}
        {renderSection(lang === "ar" ? "متصلون" : "Online", groups.online)}
        {renderSection(lang === "ar" ? "يعملون" : "Working", groups.working)}
        {renderSection(lang === "ar" ? "بعيدون" : "Away", groups.away)}
        {renderSection(lang === "ar" ? "غير متصلين" : "Offline", groups.offline)}
      </div>
    </div>
  );
}
