import { useState, type ReactElement } from "react";
import type { WorkspaceMember, WorkspaceMessage } from "@paperclipai/shared";
import { Edit2, MessageSquare, MoreHorizontal, Smile, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "./EmojiPicker";
import { MemberAvatar } from "./MemberAvatar";
import { ReactionsBar } from "./ReactionsBar";
import { SmartCardRenderer } from "./SmartCardRenderer";

export interface MessageBubbleProps {
  companyId: string;
  message: WorkspaceMessage;
  author?: WorkspaceMember | null;
  showHeader: boolean;
  currentMemberId: string | null;
  lang?: "en" | "ar";
  onReact: (emoji: string, reacted: boolean) => void;
  onReply?: (message: WorkspaceMessage) => void;
  onEdit?: (messageId: string, body: string) => Promise<void> | void;
  onDelete?: (messageId: string) => void;
  threadReplyCount?: number;
  onOpenThread?: (message: WorkspaceMessage) => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function highlightMentions(body: string, currentMemberId: string | null): string {
  // Simple visual emphasis: caller passes raw body; we don't transform here.
  // The rendering layer below applies markdown-light formatting.
  return body;
}

function renderBody(body: string): ReactElement {
  // Very minimal markdown-ish rendering: split paragraphs by newlines,
  // surface code fences and inline code. Keep it dependency-free to avoid
  // pulling a markdown parser just for this surface.
  const lines = body.split(/\n/);
  return (
    <div className="space-y-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
      {lines.map((line, i) => (
        <div key={i}>{line || " "}</div>
      ))}
    </div>
  );
}

export function MessageBubble({
  companyId,
  message,
  author,
  showHeader,
  currentMemberId,
  lang = "en",
  onReact,
  onReply,
  onEdit,
  onDelete,
  threadReplyCount = 0,
  onOpenThread,
}: MessageBubbleProps) {
  const [hovering, setHovering] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const isOwn = currentMemberId === message.authorId;
  const isDeleted = !!message.deletedAt;
  const body =
    lang === "ar" && message.bodyAr ? message.bodyAr : message.body;
  highlightMentions(body, currentMemberId);

  return (
    <div
      className={cn(
        "group relative flex gap-3 px-4 py-1 hover:bg-muted/30",
        showHeader && "mt-2",
      )}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="w-9 shrink-0 pt-1">
        {showHeader ? (
          <MemberAvatar member={author} size="md" fallback={message.authorId} />
        ) : (
          <span className="invisible text-[10px] text-muted-foreground group-hover:visible">
            {formatTime(message.createdAt)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showHeader ? (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-sm font-semibold">
              {message.authorDisplayName ?? author?.displayName ?? message.authorId}
            </span>
            {author?.type === "agent" ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                AI
              </span>
            ) : null}
            <span className="text-[11px] text-muted-foreground">
              {formatTime(message.createdAt)}
            </span>
          </div>
        ) : null}

        {isDeleted ? (
          <div className="text-sm italic text-muted-foreground">
            {lang === "ar" ? "تم حذف هذه الرسالة" : "This message was deleted"}
          </div>
        ) : editing ? (
          <div className="space-y-2">
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-16 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(message.body);
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                size="xs"
                onClick={async () => {
                  await onEdit?.(message.id, draft);
                  setEditing(false);
                }}
                disabled={!draft.trim()}
              >
                {lang === "ar" ? "حفظ" : "Save"}
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setDraft(message.body);
                }}
              >
                {lang === "ar" ? "إلغاء" : "Cancel"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {message.kind === "system" || message.kind === "event" ? (
              <div className="text-xs italic text-muted-foreground">
                {renderBody(body)}
              </div>
            ) : (
              renderBody(body)
            )}
            {message.editedAt ? (
              <span className="ms-1 text-[10px] text-muted-foreground">
                {lang === "ar" ? "(معدّلة)" : "(edited)"}
              </span>
            ) : null}
            {message.card ? (
              <div className="mt-2 max-w-md">
                <SmartCardRenderer
                  companyId={companyId}
                  card={message.card}
                  lang={lang}
                />
              </div>
            ) : null}
            <ReactionsBar
              reactions={message.reactions}
              currentMemberId={currentMemberId}
              lang={lang}
              onToggle={onReact}
              className="mt-1"
            />
            {threadReplyCount > 0 && onOpenThread ? (
              <button
                type="button"
                onClick={() => onOpenThread(message)}
                className="mt-1 inline-flex items-center gap-1 rounded-md border border-transparent bg-muted/40 px-2 py-1 text-xs font-medium text-primary hover:border-border hover:bg-muted"
              >
                <MessageSquare className="size-3" />
                {threadReplyCount}{" "}
                {lang === "ar"
                  ? threadReplyCount === 1
                    ? "رد"
                    : "ردود"
                  : threadReplyCount === 1
                    ? "reply"
                    : "replies"}
              </button>
            ) : null}
          </>
        )}
      </div>

      {hovering && !editing && !isDeleted ? (
        <div className="absolute end-4 top-0 flex translate-y-[-50%] items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-sm">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" title={lang === "ar" ? "تفاعل" : "React"}>
                <Smile />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <EmojiPicker
                lang={lang}
                onPick={(emoji) => {
                  const reacted =
                    !!currentMemberId && (message.reactions?.[emoji]?.includes(currentMemberId) ?? false);
                  onReact(emoji, reacted);
                }}
              />
            </PopoverContent>
          </Popover>
          {onReply ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onReply(message)}
              title={lang === "ar" ? "رد في موضوع" : "Reply in thread"}
            >
              <MessageSquare />
            </Button>
          ) : null}
          {isOwn && onEdit ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setDraft(message.body);
                setEditing(true);
              }}
              title={lang === "ar" ? "تعديل" : "Edit"}
            >
              <Edit2 />
            </Button>
          ) : null}
          {isOwn && onDelete ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onDelete(message.id)}
              title={lang === "ar" ? "حذف" : "Delete"}
            >
              <Trash2 />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-xs" title="More" disabled>
            <MoreHorizontal />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
