import type { WorkspaceChannel, WorkspaceMember } from "@paperclipai/shared";
import { Hash, Lock, Megaphone, MessageCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "./MemberAvatar";

export interface ChannelHeaderProps {
  channel: WorkspaceChannel | null;
  members: WorkspaceMember[];
  dmPeer?: WorkspaceMember | null;
  lang?: "en" | "ar";
  onToggleMembers?: () => void;
  membersPanelOpen?: boolean;
}

function Icon({ channel }: { channel: WorkspaceChannel }) {
  const c = "size-4 text-muted-foreground";
  if (channel.kind === "private") return <Lock className={c} />;
  if (channel.kind === "system") return <Megaphone className={c} />;
  if (channel.kind === "dm") return <MessageCircle className={c} />;
  return <Hash className={c} />;
}

export function ChannelHeader({
  channel,
  members,
  dmPeer,
  lang = "en",
  onToggleMembers,
  membersPanelOpen,
}: ChannelHeaderProps) {
  if (!channel) {
    return (
      <div className="flex h-12 items-center border-b border-border px-4 text-sm text-muted-foreground">
        {lang === "ar" ? "اختر قناة" : "Select a channel"}
      </div>
    );
  }

  const isDm = channel.kind === "dm";
  const title = isDm && dmPeer
    ? dmPeer.displayName
    : lang === "ar" && channel.nameAr
      ? channel.nameAr
      : channel.name || channel.slug;
  const subtitle = isDm && dmPeer
    ? dmPeer.title
    : channel.description || channel.topicPin;

  return (
    <div className="flex h-12 items-center justify-between gap-2 border-b border-border bg-background px-4">
      <div className="flex min-w-0 items-center gap-2">
        {isDm && dmPeer ? (
          <MemberAvatar member={dmPeer} size="sm" />
        ) : (
          <Icon channel={channel} />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {!isDm ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                · {members.length}{" "}
                {lang === "ar" ? "عضو" : members.length === 1 ? "member" : "members"}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!isDm ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleMembers}
            className={cn(membersPanelOpen && "bg-accent")}
            title={lang === "ar" ? "الأعضاء" : "Members"}
          >
            <Users />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
