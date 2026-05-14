import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WorkspaceChannel,
  WorkspaceMember,
  WorkspaceMessage,
} from "@paperclipai/shared";
import { Languages, Menu, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/context/CompanyContext";
import {
  workspaceApi,
  workspaceQueryKeys,
  type ListMessagesResponse,
} from "@/api/workspace";
import { useWorkspaceStream } from "@/hooks/useWorkspaceStream";
import { ChannelSidebar } from "@/components/workspace/ChannelSidebar";
import { ChannelHeader } from "@/components/workspace/ChannelHeader";
import { MessageTimeline } from "@/components/workspace/MessageTimeline";
import { MessageComposer } from "@/components/workspace/MessageComposer";
import { ThreadPanel } from "@/components/workspace/ThreadPanel";
import { MembersPanel } from "@/components/workspace/MembersPanel";
import { NotificationBell } from "@/components/workspace/NotificationBell";
import { WorkspaceSearchDialog } from "@/components/workspace/WorkspaceSearchDialog";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";

export function WorkspacePage() {
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id ?? "";
  const queryClient = useQueryClient();

  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [threadRoot, setThreadRoot] = useState<WorkspaceMessage | null>(null);
  const [replyTo, setReplyTo] = useState<WorkspaceMessage | null>(null);
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersPanelOpen, setMembersPanelOpen] = useState(true);
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);

  const channelsQuery = useQuery({
    queryKey: workspaceQueryKeys.channels(companyId),
    queryFn: () => workspaceApi.channels.list(companyId),
    enabled: !!companyId,
  });

  const membersQuery = useQuery({
    queryKey: workspaceQueryKeys.members(companyId),
    queryFn: () => workspaceApi.members.list(companyId),
    enabled: !!companyId,
  });

  const unreadQuery = useQuery({
    queryKey: workspaceQueryKeys.unread(companyId),
    queryFn: () => workspaceApi.unread.list(companyId),
    enabled: !!companyId,
  });

  const channels = channelsQuery.data?.channels ?? [];
  const members = membersQuery.data?.members ?? [];
  const unreadCounts = unreadQuery.data?.counts ?? {};
  const unreadTotal = unreadQuery.data?.total ?? 0;

  const membersById = useMemo(() => {
    const map = new Map<string, WorkspaceMember>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const channelMembersQuery = useQuery({
    queryKey: activeChannelId
      ? workspaceQueryKeys.channelMembers(companyId, activeChannelId)
      : ["workspace", companyId, "channel-members", "__none__"],
    queryFn: () =>
      activeChannelId
        ? workspaceApi.channels.members(companyId, activeChannelId)
        : Promise.resolve({ members: [] }),
    enabled: !!companyId && !!activeChannelId,
  });

  const channelMembers = channelMembersQuery.data?.members ?? [];

  // Auto-select first channel when channels load.
  useEffect(() => {
    if (activeChannelId) return;
    const first =
      channels.find((c) => c.kind === "public" && c.slug === "general") ??
      channels.find((c) => c.kind === "public") ??
      channels[0];
    if (first) setActiveChannelId(first.id);
  }, [channels, activeChannelId]);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const currentMember = useMemo(() => {
    // Best-effort: try to match by `me` flag or by displayName "me".
    // The server may also expose this via a dedicated endpoint; we just
    // pick the first non-agent member if no obvious signal is present.
    return null as WorkspaceMember | null;
  }, []);

  const currentMemberId: string | null = currentMember
    ? (currentMember as WorkspaceMember).id
    : null;

  const dmPeer = useMemo(() => {
    if (!activeChannel || activeChannel.kind !== "dm" || !activeChannel.dmKey) {
      return null;
    }
    const ids = activeChannel.dmKey.split("_");
    const other = ids.find((id) => id !== currentMemberId) ?? ids[0];
    return membersById.get(other) ?? null;
  }, [activeChannel, currentMemberId, membersById]);

  // Real-time stream.
  useWorkspaceStream(companyId || null, (event) => {
    switch (event.kind) {
      case "message.created":
      case "message.updated": {
        const root = event.message.threadRootId;
        const key = workspaceQueryKeys.messages(
          companyId,
          event.channelId,
          root,
        );
        queryClient.setQueryData<ListMessagesResponse>(key, (old) => {
          if (!old) return { messages: [event.message] };
          const idx = old.messages.findIndex((m) => m.id === event.message.id);
          if (idx === -1) {
            return { ...old, messages: [...old.messages, event.message] };
          }
          const merged = [...old.messages];
          merged[idx] = event.message;
          return { ...old, messages: merged };
        });
        // Also update the root channel list so root sees thread reply counts update.
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.messages(companyId, event.channelId),
        });
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.unread(companyId),
        });
        break;
      }
      case "message.deleted": {
        const updateOne = (old: ListMessagesResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            messages: old.messages.map((m) =>
              m.id === event.messageId
                ? { ...m, deletedAt: new Date().toISOString() }
                : m,
            ),
          };
        };
        queryClient.setQueryData<ListMessagesResponse>(
          workspaceQueryKeys.messages(companyId, event.channelId),
          updateOne,
        );
        break;
      }
      case "reaction.added":
      case "reaction.removed": {
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.messages(companyId, event.channelId),
        });
        break;
      }
      case "channel.created":
      case "channel.updated": {
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.channels(companyId),
        });
        break;
      }
      case "member.status_changed": {
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.members(companyId),
        });
        break;
      }
      case "typing": {
        // Typing indicators not surfaced in this surface yet.
        break;
      }
    }
  });

  // Mark channel as read when it changes.
  useEffect(() => {
    if (!activeChannel || !companyId) return;
    const messages = queryClient.getQueryData<ListMessagesResponse>(
      workspaceQueryKeys.messages(companyId, activeChannel.id),
    );
    const last = messages?.messages?.[messages.messages.length - 1];
    if (!last) return;
    workspaceApi.unread
      .markRead(companyId, activeChannel.id, last.id)
      .then(() => {
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.unread(companyId),
        });
      })
      .catch(() => {
        /* ignore */
      });
  }, [activeChannel?.id, companyId, queryClient]);

  // Cmd+K opens search.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!selectedCompany) {
    return (
      <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">
        {lang === "ar"
          ? "اختر شركة لفتح مساحة العمل."
          : "Select a company to open the workspace."}
      </div>
    );
  }

  const dir = lang === "ar" ? "rtl" : "ltr";

  const header = (
    <div
      className="flex h-12 items-center justify-between gap-2 border-b border-border bg-background px-3"
      dir={dir}
    >
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={() => setMobileLeftOpen(true)}
        >
          <Menu />
        </Button>
        <span className="text-sm font-semibold">
          {lang === "ar" ? "مساحة العمل" : "Workspace"}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setSearchOpen(true)}
          title={lang === "ar" ? "بحث" : "Search (⌘K)"}
        >
          <Search />
        </Button>
        <NotificationBell
          total={unreadTotal}
          lang={lang}
          onClick={() => setSearchOpen(true)}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setLang((l) => (l === "ar" ? "en" : "ar"))}
          title={lang === "ar" ? "English" : "العربية"}
        >
          <Languages />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={() => setMobileRightOpen(true)}
        >
          <Users />
        </Button>
      </div>
    </div>
  );

  const sidebar = (
    <ChannelSidebar
      companyId={companyId}
      members={members}
      currentMemberId={currentMemberId}
      activeChannelId={activeChannelId}
      unread={unreadCounts}
      lang={lang}
      onSelect={(c) => {
        setActiveChannelId(c.id);
        setMobileLeftOpen(false);
        setThreadRoot(null);
        setReplyTo(null);
      }}
    />
  );

  const main = (
    <>
      <ChannelHeader
        channel={activeChannel}
        members={channelMembers}
        dmPeer={dmPeer}
        lang={lang}
        membersPanelOpen={membersPanelOpen}
        onToggleMembers={() => setMembersPanelOpen((v) => !v)}
      />
      {activeChannel ? (
        <>
          <MessageTimeline
            companyId={companyId}
            channelId={activeChannel.id}
            membersById={membersById}
            currentMemberId={currentMemberId}
            lang={lang}
            onReply={(m) => setReplyTo(m)}
            onOpenThread={(m) => setThreadRoot(m)}
          />
          <MessageComposer
            companyId={companyId}
            channel={activeChannel}
            members={members}
            currentMember={currentMember}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            lang={lang}
          />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {channelsQuery.isLoading
            ? lang === "ar"
              ? "جارٍ التحميل…"
              : "Loading…"
            : lang === "ar"
              ? "اختر قناة للبدء"
              : "Select a channel to begin"}
        </div>
      )}
    </>
  );

  const right = activeChannel && threadRoot ? (
    <ThreadPanel
      companyId={companyId}
      channel={activeChannel}
      rootMessage={threadRoot}
      membersById={membersById}
      currentMemberId={currentMemberId}
      lang={lang}
      onClose={() => setThreadRoot(null)}
    />
  ) : (
    <MembersPanel members={channelMembers} lang={lang} />
  );

  return (
    <>
      <WorkspaceLayout
        header={header}
        sidebar={sidebar}
        main={main}
        right={right}
        rightOpen={membersPanelOpen || !!threadRoot}
        dir={dir}
        mobileLeftOpen={mobileLeftOpen}
        onMobileLeftOpenChange={setMobileLeftOpen}
        mobileRightOpen={mobileRightOpen}
        onMobileRightOpenChange={setMobileRightOpen}
      />
      <WorkspaceSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        companyId={companyId}
        channels={channels}
        members={members}
        lang={lang}
        onPickChannel={(c) => setActiveChannelId(c.id)}
      />
    </>
  );
}
