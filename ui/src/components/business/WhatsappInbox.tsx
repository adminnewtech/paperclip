import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Send,
  Search,
  Inbox,
  CheckCheck,
  Check,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "../EmptyState";
import {
  businessWhatsappApi,
  type WhatsappConversation,
  type WhatsappThreadMessage,
} from "../../api/business-whatsapp";

interface WhatsappInboxProps {
  companyId: string;
}

function initialFor(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

function formatTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fromUnixOrIso(value: string): string {
  if (!value) return "";
  if (/^\d+$/.test(value)) {
    return new Date(Number(value) * 1000).toISOString();
  }
  return value;
}

function extractText(m: WhatsappThreadMessage): string {
  if (m.type === "text") {
    const t = m.content?.text as { body?: unknown } | undefined;
    if (t && typeof t.body === "string") return t.body;
  }
  if (m.type === "button") {
    const b = m.content?.button as { text?: unknown } | undefined;
    if (b && typeof b.text === "string") return b.text;
  }
  if (m.type === "interactive") {
    const i = m.content?.interactive as Record<string, unknown> | undefined;
    const lr =
      (i?.list_reply as Record<string, unknown> | undefined) ??
      (i?.button_reply as Record<string, unknown> | undefined);
    if (lr && typeof lr.title === "string") return lr.title as string;
  }
  return `[${m.type}]`;
}

function DeliveryIcon({ status }: { status?: string }) {
  if (status === "read") {
    return <CheckCheck className="h-3 w-3 text-blue-500" aria-label="read" />;
  }
  if (status === "delivered") {
    return (
      <CheckCheck className="h-3 w-3 text-muted-foreground" aria-label="delivered" />
    );
  }
  if (status === "failed") {
    return (
      <AlertCircle className="h-3 w-3 text-red-500" aria-label="failed" />
    );
  }
  return <Check className="h-3 w-3 text-muted-foreground" aria-label="sent" />;
}

function ConversationListItem({
  conversation,
  selected,
  onClick,
}: {
  conversation: WhatsappConversation;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b last:border-b-0 ${
        selected
          ? "bg-accent"
          : "hover:bg-muted/60 focus-visible:bg-muted/60"
      }`}
    >
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="text-xs">
          {initialFor(conversation.contactName || conversation.phone)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">
            {conversation.contactName || conversation.phone}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {timeAgo(conversation.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">
            {conversation.lastMessage || conversation.phone}
          </span>
          {conversation.unreadCount > 0 && (
            <Badge
              variant="default"
              className="text-[10px] px-1.5 py-0 h-4 min-w-4 shrink-0 bg-emerald-500 hover:bg-emerald-500"
            >
              {conversation.unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ message }: { message: WhatsappThreadMessage }) {
  const outbound = message.direction === "outbound";
  const text = extractText(message);
  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
          outbound
            ? "bg-emerald-600 text-white rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        }`}
      >
        <div>{text}</div>
        <div
          className={`flex items-center gap-1 mt-1 text-[10px] ${
            outbound ? "text-emerald-100" : "text-muted-foreground"
          } justify-end`}
        >
          <span>{formatTime(fromUnixOrIso(message.timestamp))}</span>
          {outbound && <DeliveryIcon status={message.status} />}
        </div>
      </div>
    </div>
  );
}

export function WhatsappInbox({ companyId }: WhatsappInboxProps) {
  const queryClient = useQueryClient();
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const threadScrollRef = useRef<HTMLDivElement | null>(null);

  const conversationsQuery = useQuery({
    queryKey: ["whatsapp-conversations", companyId],
    queryFn: () => businessWhatsappApi.listConversations(companyId),
    enabled: !!companyId,
    refetchInterval: 15_000,
  });

  const conversations = conversationsQuery.data?.conversations ?? [];

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.contactName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q),
    );
  }, [conversations, search]);

  // Default-select first conversation when list loads
  useEffect(() => {
    if (!selectedContactId && filteredConversations[0]?.contactId) {
      setSelectedContactId(filteredConversations[0].contactId);
    }
  }, [filteredConversations, selectedContactId]);

  const threadQuery = useQuery({
    queryKey: ["whatsapp-thread", companyId, selectedContactId],
    queryFn: () =>
      businessWhatsappApi.getThread(companyId, selectedContactId!, 200),
    enabled: !!companyId && !!selectedContactId,
    refetchInterval: 10_000,
  });

  const messages = threadQuery.data?.messages ?? [];

  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedContactId]);

  const markReadMutation = useMutation({
    mutationFn: (contactId: string) =>
      businessWhatsappApi.markAsRead(companyId, contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp-conversations", companyId],
      });
    },
  });

  useEffect(() => {
    if (!selectedContactId) return;
    const conv = conversations.find((c) => c.contactId === selectedContactId);
    if (conv && conv.unreadCount > 0) {
      markReadMutation.mutate(selectedContactId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContactId, conversations.length]);

  const replyMutation = useMutation({
    mutationFn: ({
      contactId,
      text,
    }: {
      contactId: string;
      text: string;
    }) => businessWhatsappApi.reply(companyId, contactId, text),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({
        queryKey: ["whatsapp-thread", companyId, selectedContactId],
      });
      queryClient.invalidateQueries({
        queryKey: ["whatsapp-conversations", companyId],
      });
    },
  });

  const selectedConv = conversations.find(
    (c) => c.contactId === selectedContactId,
  );

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !selectedContactId) return;
    replyMutation.mutate({ contactId: selectedContactId, text });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-0 border rounded-lg overflow-hidden h-[600px]">
      {/* Conversations list */}
      <div className="border-r flex flex-col bg-card">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {conversationsQuery.isLoading ? (
            <div className="p-4 text-xs text-muted-foreground">Loading…</div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Inbox}
                message="No conversations yet."
              />
            </div>
          ) : (
            <div>
              {filteredConversations.map((conv) => (
                <ConversationListItem
                  key={conv.id}
                  conversation={conv}
                  selected={selectedContactId === conv.contactId}
                  onClick={() =>
                    conv.contactId && setSelectedContactId(conv.contactId)
                  }
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Thread */}
      <div className="flex flex-col bg-background min-w-0">
        {!selectedContactId || !selectedConv ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={MessageSquare}
              message="Select a conversation to view the thread."
            />
          </div>
        ) : (
          <>
            <div className="border-b px-4 py-2.5 flex items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="text-xs">
                  {initialFor(selectedConv.contactName || selectedConv.phone)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {selectedConv.contactName || selectedConv.phone}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {selectedConv.phone}
                </div>
              </div>
            </div>
            <div
              ref={threadScrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-2"
            >
              {threadQuery.isLoading ? (
                <div className="text-xs text-muted-foreground">Loading…</div>
              ) : messages.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center mt-8">
                  No messages yet.
                </div>
              ) : (
                messages.map((m) => <MessageBubble key={m.id} message={m} />)
              )}
            </div>
            <form
              onSubmit={handleSend}
              className="border-t px-3 py-2 flex items-center gap-2"
            >
              <Input
                placeholder="Type a reply…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={replyMutation.isPending}
                className="flex-1"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!draft.trim() || replyMutation.isPending}
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                Send
              </Button>
            </form>
            {replyMutation.error && (
              <div className="px-3 pb-2 text-xs text-red-600">
                {(replyMutation.error as Error).message}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
