import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkspaceMember, WorkspaceMessage } from "@paperclipai/shared";
import { workspaceApi, workspaceQueryKeys, type ListMessagesResponse } from "@/api/workspace";
import { MessageGroup } from "./MessageGroup";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;

export interface MessageTimelineProps {
  companyId: string;
  channelId: string;
  membersById: Map<string, WorkspaceMember>;
  currentMemberId: string | null;
  lang?: "en" | "ar";
  onReply?: (message: WorkspaceMessage) => void;
  onOpenThread?: (message: WorkspaceMessage) => void;
}

function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatDateSeparator(iso: string, lang: "en" | "ar"): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(iso, now.toISOString())) {
    return lang === "ar" ? "اليوم" : "Today";
  }
  if (sameDay(iso, yesterday.toISOString())) {
    return lang === "ar" ? "أمس" : "Yesterday";
  }
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface TimelineSegment {
  kind: "date" | "group";
  key: string;
  date?: string;
  messages?: WorkspaceMessage[];
}

function buildSegments(messages: WorkspaceMessage[]): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  let currentGroup: WorkspaceMessage[] = [];
  let lastDateKey: string | null = null;

  const flush = () => {
    if (currentGroup.length > 0) {
      out.push({
        kind: "group",
        key: `g-${currentGroup[0].id}`,
        messages: currentGroup,
      });
      currentGroup = [];
    }
  };

  for (const msg of messages) {
    const dateKey = msg.createdAt.slice(0, 10);
    if (dateKey !== lastDateKey) {
      flush();
      out.push({
        kind: "date",
        key: `d-${dateKey}`,
        date: msg.createdAt,
      });
      lastDateKey = dateKey;
    }
    const last = currentGroup[currentGroup.length - 1];
    if (
      last &&
      last.authorId === msg.authorId &&
      Math.abs(
        new Date(msg.createdAt).getTime() - new Date(last.createdAt).getTime(),
      ) < GROUP_WINDOW_MS &&
      !msg.threadRootId
    ) {
      currentGroup.push(msg);
    } else {
      flush();
      currentGroup.push(msg);
    }
  }
  flush();
  return out;
}

export function MessageTimeline({
  companyId,
  channelId,
  membersById,
  currentMemberId,
  lang = "en",
  onReply,
  onOpenThread,
}: MessageTimelineProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const messagesQuery = useQuery({
    queryKey: workspaceQueryKeys.messages(companyId, channelId),
    queryFn: () =>
      workspaceApi.messages.list(companyId, channelId, { limit: PAGE_SIZE }),
    enabled: !!companyId && !!channelId,
  });

  const messages = useMemo<WorkspaceMessage[]>(() => {
    const all = messagesQuery.data?.messages ?? [];
    // Filter to root messages (no threadRootId) so threads are collapsed by default.
    const sorted = [...all].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return sorted;
  }, [messagesQuery.data?.messages]);

  const rootMessages = useMemo(
    () => messages.filter((m) => !m.threadRootId),
    [messages],
  );

  const threadCountByRoot = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of messages) {
      if (m.threadRootId) {
        map.set(m.threadRootId, (map.get(m.threadRootId) ?? 0) + 1);
      }
    }
    return map;
  }, [messages]);

  // Detect if user is near bottom to decide auto-scroll behaviour.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAutoScroll(dist < 100);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  // Auto-scroll to bottom on new messages if near bottom.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [rootMessages.length, autoScroll]);

  // When channel changes, jump straight to bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
    setHasMore(true);
  }, [channelId]);

  const reactMutation = useMutation({
    mutationFn: async (vars: { messageId: string; emoji: string; reacted: boolean }) => {
      if (vars.reacted) {
        await workspaceApi.messages.removeReaction(companyId, vars.messageId, vars.emoji);
      } else {
        await workspaceApi.messages.react(companyId, vars.messageId, vars.emoji);
      }
    },
    onMutate: async ({ messageId, emoji, reacted }) => {
      if (!currentMemberId) return;
      const key = workspaceQueryKeys.messages(companyId, channelId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ListMessagesResponse>(key);
      queryClient.setQueryData<ListMessagesResponse>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          messages: old.messages.map((m) => {
            if (m.id !== messageId) return m;
            const reactions = { ...(m.reactions ?? {}) };
            const list = new Set(reactions[emoji] ?? []);
            if (reacted) list.delete(currentMemberId);
            else list.add(currentMemberId);
            if (list.size === 0) delete reactions[emoji];
            else reactions[emoji] = Array.from(list);
            return { ...m, reactions };
          }),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          workspaceQueryKeys.messages(companyId, channelId),
          ctx.previous,
        );
      }
    },
  });

  const editMutation = useMutation({
    mutationFn: (vars: { messageId: string; body: string }) =>
      workspaceApi.messages.edit(companyId, vars.messageId, vars.body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.messages(companyId, channelId),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (messageId: string) =>
      workspaceApi.messages.remove(companyId, messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.messages(companyId, channelId),
      });
    },
  });

  const loadOlder = async () => {
    if (loadingMore || rootMessages.length === 0 || !hasMore) return;
    setLoadingMore(true);
    const oldest = messages[0];
    try {
      const page = await workspaceApi.messages.list(companyId, channelId, {
        before: oldest.createdAt,
        limit: PAGE_SIZE,
      });
      const key = workspaceQueryKeys.messages(companyId, channelId);
      queryClient.setQueryData<ListMessagesResponse>(key, (old) => {
        if (!old) return { messages: page.messages, hasMore: page.hasMore };
        const seen = new Set(old.messages.map((m) => m.id));
        const merged = [
          ...page.messages.filter((m) => !seen.has(m.id)),
          ...old.messages,
        ];
        return { ...old, messages: merged };
      });
      if (!page.messages || page.messages.length < PAGE_SIZE) {
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  // Infinite scroll up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      if (el.scrollTop < 40 && hasMore && !loadingMore) {
        const prevHeight = el.scrollHeight;
        loadOlder().then(() => {
          requestAnimationFrame(() => {
            if (!scrollRef.current) return;
            const diff = scrollRef.current.scrollHeight - prevHeight;
            scrollRef.current.scrollTop = diff;
          });
        });
      }
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, channelId]);

  if (messagesQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {lang === "ar" ? "جارٍ تحميل الرسائل…" : "Loading messages…"}
      </div>
    );
  }

  if (rootMessages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <div className="text-4xl">💬</div>
        <div>
          {lang === "ar"
            ? "لا توجد رسائل — كن أول من يكتب!"
            : "No messages yet — be the first to say hi!"}
        </div>
      </div>
    );
  }

  const segments = buildSegments(rootMessages);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
      {loadingMore ? (
        <div className="py-2 text-center text-xs text-muted-foreground">
          {lang === "ar" ? "جارٍ تحميل المزيد…" : "Loading more…"}
        </div>
      ) : null}
      {segments.map((seg) => {
        if (seg.kind === "date" && seg.date) {
          return (
            <div
              key={seg.key}
              className="my-3 flex items-center gap-3 px-4 text-xs text-muted-foreground"
            >
              <div className="h-px flex-1 bg-border" />
              <span className="rounded-full border border-border bg-background px-2 py-0.5">
                {formatDateSeparator(seg.date, lang)}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          );
        }
        if (seg.kind === "group" && seg.messages) {
          return (
            <MessageGroup
              key={seg.key}
              companyId={companyId}
              messages={seg.messages}
              membersById={membersById}
              currentMemberId={currentMemberId}
              lang={lang}
              threadCountByRoot={threadCountByRoot}
              onReact={(messageId, emoji, reacted) =>
                reactMutation.mutate({ messageId, emoji, reacted })
              }
              onReply={onReply}
              onEdit={(messageId, body) =>
                editMutation.mutateAsync({ messageId, body }).then(() => undefined)
              }
              onDelete={(messageId) => deleteMutation.mutate(messageId)}
              onOpenThread={onOpenThread}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
