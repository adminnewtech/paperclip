import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WorkspaceChannel,
  WorkspaceMember,
  WorkspaceMessage,
} from "@paperclipai/shared";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { workspaceApi, workspaceQueryKeys } from "@/api/workspace";
import { MessageBubble } from "./MessageBubble";

export interface ThreadPanelProps {
  companyId: string;
  channel: WorkspaceChannel;
  rootMessage: WorkspaceMessage;
  membersById: Map<string, WorkspaceMember>;
  currentMemberId: string | null;
  lang?: "en" | "ar";
  onClose: () => void;
}

export function ThreadPanel({
  companyId,
  channel,
  rootMessage,
  membersById,
  currentMemberId,
  lang = "en",
  onClose,
}: ThreadPanelProps) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();

  const repliesQuery = useQuery({
    queryKey: workspaceQueryKeys.messages(companyId, channel.id, rootMessage.id),
    queryFn: () =>
      workspaceApi.messages.list(companyId, channel.id, {
        threadRootId: rootMessage.id,
        limit: 200,
      }),
    enabled: !!rootMessage.id,
  });

  const replies = useMemo<WorkspaceMessage[]>(() => {
    const all = repliesQuery.data?.messages ?? [];
    return [...all]
      .filter((m) => m.threadRootId === rootMessage.id)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
  }, [repliesQuery.data?.messages, rootMessage.id]);

  const sendReply = useMutation({
    mutationFn: (body: string) =>
      workspaceApi.messages.send(companyId, channel.id, {
        kind: "text",
        body,
        threadRootId: rootMessage.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.messages(companyId, channel.id, rootMessage.id),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.messages(companyId, channel.id),
      });
      setDraft("");
    },
  });

  useEffect(() => {
    setDraft("");
  }, [rootMessage.id]);

  const reactMutation = useMutation({
    mutationFn: async (vars: { messageId: string; emoji: string; reacted: boolean }) => {
      if (vars.reacted) {
        await workspaceApi.messages.removeReaction(companyId, vars.messageId, vars.emoji);
      } else {
        await workspaceApi.messages.react(companyId, vars.messageId, vars.emoji);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.messages(companyId, channel.id, rootMessage.id),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.messages(companyId, channel.id),
      });
    },
  });

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div>
          <div className="text-sm font-semibold">
            {lang === "ar" ? "موضوع" : "Thread"}
          </div>
          <div className="text-xs text-muted-foreground">
            #{channel.slug}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-border">
          <MessageBubble
            companyId={companyId}
            message={rootMessage}
            author={membersById.get(rootMessage.authorId) ?? null}
            showHeader
            currentMemberId={currentMemberId}
            lang={lang}
            onReact={(emoji, reacted) =>
              reactMutation.mutate({ messageId: rootMessage.id, emoji, reacted })
            }
          />
        </div>
        {repliesQuery.isLoading ? (
          <div className="p-4 text-xs text-muted-foreground">
            {lang === "ar" ? "جارٍ التحميل…" : "Loading…"}
          </div>
        ) : null}
        {replies.length > 0 ? (
          <div className="px-2 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            {replies.length}{" "}
            {lang === "ar"
              ? replies.length === 1
                ? "رد"
                : "ردود"
              : replies.length === 1
                ? "reply"
                : "replies"}
          </div>
        ) : null}
        {replies.map((reply) => (
          <MessageBubble
            key={reply.id}
            companyId={companyId}
            message={reply}
            author={membersById.get(reply.authorId) ?? null}
            showHeader
            currentMemberId={currentMemberId}
            lang={lang}
            onReact={(emoji, reacted) =>
              reactMutation.mutate({ messageId: reply.id, emoji, reacted })
            }
          />
        ))}
      </div>
      <div className="border-t border-border p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={lang === "ar" ? "اكتب ردًا…" : "Reply…"}
          className="min-h-16 w-full resize-none rounded-md border border-input bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
              e.preventDefault();
              sendReply.mutate(draft.trim());
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            onClick={() => sendReply.mutate(draft.trim())}
            disabled={!draft.trim() || sendReply.isPending}
          >
            {lang === "ar" ? "إرسال" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
