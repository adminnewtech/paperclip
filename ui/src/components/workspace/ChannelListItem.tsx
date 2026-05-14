import type { WorkspaceChannel, WorkspaceMember } from "@paperclipai/shared";
import { Hash, Lock, Megaphone, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "./MemberAvatar";
import { MemberStatusBadge } from "./MemberStatusBadge";

export interface ChannelListItemProps {
  channel: WorkspaceChannel;
  active: boolean;
  unreadCount?: number;
  dmPeer?: WorkspaceMember | null;
  lang?: "en" | "ar";
  onSelect: (channel: WorkspaceChannel) => void;
}

function channelLabel(channel: WorkspaceChannel, lang: "en" | "ar"): string {
  if (lang === "ar" && channel.nameAr) return channel.nameAr;
  return channel.name || channel.slug;
}

function ChannelIcon({
  channel,
  className,
}: {
  channel: WorkspaceChannel;
  className?: string;
}) {
  const c = cn("size-4 shrink-0 text-muted-foreground", className);
  if (channel.kind === "private") return <Lock className={c} />;
  if (channel.kind === "system") return <Megaphone className={c} />;
  if (channel.kind === "dm") return <MessageCircle className={c} />;
  return <Hash className={c} />;
}

export function ChannelListItem({
  channel,
  active,
  unreadCount,
  dmPeer,
  lang = "en",
  onSelect,
}: ChannelListItemProps) {
  const unread = unreadCount ?? 0;
  const hasUnread = unread > 0;
  const isDm = channel.kind === "dm";
  const label = isDm && dmPeer ? dmPeer.displayName : channelLabel(channel, lang);

  return (
    <button
      type="button"
      onClick={() => onSelect(channel)}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        hasUnread && !active && "font-semibold text-foreground",
      )}
    >
      {isDm && dmPeer ? (
        <div className="relative">
          <MemberAvatar member={dmPeer} size="xs" />
          <MemberStatusBadge
            status={dmPeer.status}
            size="xs"
            className="absolute -bottom-0.5 -end-0.5 inline-block rounded-full bg-background p-px"
          />
        </div>
      ) : (
        <ChannelIcon channel={channel} />
      )}
      <span className="flex-1 truncate">{label}</span>
      {hasUnread ? (
        <span
          className={cn(
            "ms-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold",
            active ? "bg-background text-foreground" : "bg-primary text-primary-foreground",
          )}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </button>
  );
}
