import type { WorkspaceMember, WorkspaceMessage } from "@paperclipai/shared";
import { MessageBubble } from "./MessageBubble";

export interface MessageGroupProps {
  companyId: string;
  messages: WorkspaceMessage[];
  membersById: Map<string, WorkspaceMember>;
  currentMemberId: string | null;
  lang?: "en" | "ar";
  threadCountByRoot: Map<string, number>;
  onReact: (messageId: string, emoji: string, reacted: boolean) => void;
  onReply?: (message: WorkspaceMessage) => void;
  onEdit?: (messageId: string, body: string) => Promise<void> | void;
  onDelete?: (messageId: string) => void;
  onOpenThread?: (message: WorkspaceMessage) => void;
}

/**
 * Render a group of messages by the same author within a short window.
 * Only the first message shows the avatar + name; subsequent ones omit
 * the header for visual density.
 */
export function MessageGroup({
  companyId,
  messages,
  membersById,
  currentMemberId,
  lang,
  threadCountByRoot,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onOpenThread,
}: MessageGroupProps) {
  return (
    <div>
      {messages.map((message, index) => {
        const author = membersById.get(message.authorId) ?? null;
        return (
          <MessageBubble
            key={message.id}
            companyId={companyId}
            message={message}
            author={author}
            showHeader={index === 0}
            currentMemberId={currentMemberId}
            lang={lang}
            threadReplyCount={threadCountByRoot.get(message.id) ?? 0}
            onReact={(emoji, reacted) => onReact(message.id, emoji, reacted)}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
            onOpenThread={onOpenThread}
          />
        );
      })}
    </div>
  );
}
