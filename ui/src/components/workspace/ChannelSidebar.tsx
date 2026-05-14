import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceChannel, WorkspaceMember } from "@paperclipai/shared";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi, workspaceQueryKeys } from "@/api/workspace";
import { ChannelGroup } from "./ChannelGroup";
import { ChannelListItem } from "./ChannelListItem";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { StartDmDialog } from "./StartDmDialog";

export interface ChannelSidebarProps {
  companyId: string;
  members: WorkspaceMember[];
  currentMemberId: string | null;
  activeChannelId: string | null;
  unread: Record<string, number>;
  lang?: "en" | "ar";
  onSelect: (channel: WorkspaceChannel) => void;
}

function dmPeer(
  channel: WorkspaceChannel,
  members: WorkspaceMember[],
  currentMemberId: string | null,
): WorkspaceMember | null {
  if (!channel.dmKey || !currentMemberId) return null;
  const ids = channel.dmKey.split("_");
  const other = ids.find((id) => id !== currentMemberId) ?? ids[0];
  return members.find((m) => m.id === other) ?? null;
}

export function ChannelSidebar({
  companyId,
  members,
  currentMemberId,
  activeChannelId,
  unread,
  lang = "en",
  onSelect,
}: ChannelSidebarProps) {
  const [filter, setFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);

  const channelsQuery = useQuery({
    queryKey: workspaceQueryKeys.channels(companyId),
    queryFn: () => workspaceApi.channels.list(companyId),
    enabled: !!companyId,
  });

  const grouped = useMemo(() => {
    const all = channelsQuery.data?.channels ?? [];
    const q = filter.trim().toLowerCase();
    const match = (c: WorkspaceChannel) => {
      if (!q) return true;
      return [c.name, c.nameAr, c.slug, c.description]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    };

    const publicChannels = all.filter(
      (c) => c.kind === "public" && !c.archived && match(c),
    );
    const privateChannels = all.filter(
      (c) => c.kind === "private" && !c.archived && match(c),
    );
    const systemChannels = all.filter(
      (c) => c.kind === "system" && !c.archived && match(c),
    );
    const dmChannels = all.filter((c) => {
      if (c.kind !== "dm" || c.archived) return false;
      if (!q) return true;
      const peer = dmPeer(c, members, currentMemberId);
      if (peer && match({ ...c, name: peer.displayName })) return true;
      return match(c);
    });
    const aiDms = dmChannels.filter((c) => {
      const peer = dmPeer(c, members, currentMemberId);
      return peer?.type === "agent";
    });
    const humanDms = dmChannels.filter((c) => {
      const peer = dmPeer(c, members, currentMemberId);
      return !peer || peer.type !== "agent";
    });

    return { publicChannels, privateChannels, systemChannels, humanDms, aiDms };
  }, [channelsQuery.data, members, currentMemberId, filter]);

  const renderChannelItem = (channel: WorkspaceChannel) => (
    <ChannelListItem
      key={channel.id}
      channel={channel}
      active={channel.id === activeChannelId}
      unreadCount={unread[channel.id] ?? channel.unreadCount}
      dmPeer={
        channel.kind === "dm" ? dmPeer(channel, members, currentMemberId) : null
      }
      lang={lang}
      onSelect={onSelect}
    />
  );

  return (
    <div className="flex h-full flex-col bg-muted/30">
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={
              lang === "ar" ? "تصفية القنوات…" : "Filter channels…"
            }
            className="h-8 ps-7 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-2">
        {channelsQuery.isLoading ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            {lang === "ar" ? "جارٍ التحميل…" : "Loading channels…"}
          </div>
        ) : null}

        <ChannelGroup
          title={lang === "ar" ? "القنوات" : "Channels"}
          count={grouped.publicChannels.length}
          action={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setCreateOpen(true)}
              title={lang === "ar" ? "قناة جديدة" : "New channel"}
            >
              <Plus />
            </Button>
          }
        >
          {grouped.publicChannels.map(renderChannelItem)}
          {grouped.publicChannels.length === 0 && !channelsQuery.isLoading ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {lang === "ar" ? "لا توجد قنوات" : "No channels yet"}
            </div>
          ) : null}
        </ChannelGroup>

        {grouped.privateChannels.length > 0 ? (
          <ChannelGroup
            title={lang === "ar" ? "خاصة" : "Private"}
            count={grouped.privateChannels.length}
            defaultOpen
          >
            {grouped.privateChannels.map(renderChannelItem)}
          </ChannelGroup>
        ) : null}

        {grouped.systemChannels.length > 0 ? (
          <ChannelGroup
            title={lang === "ar" ? "تنبيهات النظام" : "System"}
            count={grouped.systemChannels.length}
            defaultOpen={false}
          >
            {grouped.systemChannels.map(renderChannelItem)}
          </ChannelGroup>
        ) : null}

        <ChannelGroup
          title={lang === "ar" ? "محادثات مباشرة" : "Direct messages"}
          count={grouped.humanDms.length}
          action={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setDmOpen(true)}
              title={lang === "ar" ? "محادثة جديدة" : "New DM"}
            >
              <Plus />
            </Button>
          }
        >
          {grouped.humanDms.map(renderChannelItem)}
          {grouped.humanDms.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {lang === "ar"
                ? "لا توجد محادثات بعد"
                : "Start a conversation"}
            </div>
          ) : null}
        </ChannelGroup>

        {grouped.aiDms.length > 0 ? (
          <ChannelGroup
            title={lang === "ar" ? "وكلاء الذكاء" : "AI agents"}
            count={grouped.aiDms.length}
          >
            {grouped.aiDms.map(renderChannelItem)}
          </ChannelGroup>
        ) : null}
      </div>

      <CreateChannelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
        lang={lang}
        onCreated={(c) => onSelect(c)}
      />
      <StartDmDialog
        open={dmOpen}
        onOpenChange={setDmOpen}
        companyId={companyId}
        lang={lang}
        onCreated={(c) => onSelect(c)}
      />
    </div>
  );
}
