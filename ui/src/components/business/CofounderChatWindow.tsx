import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Send, Sparkles, User, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  aiCofounderApi,
  type CofounderMessage,
  type CofounderResponse,
} from "../../api/ai-cofounder";
import { VoiceCommandButton } from "./VoiceCommandButton";

export interface CofounderChatWindowProps {
  companyId: string;
  userPhone?: string; // when null, uses "web-<userId>"
  lang?: "ar" | "en";
  className?: string;
}

const QUICK_PROMPTS_AR = [
  "ملخص اليوم",
  "الفواتير المتأخرة",
  "حالة المخزون",
  "تقرير الشهر",
  "أفضل العملاء",
  "وضع النقد",
];

const QUICK_PROMPTS_EN = [
  "Today's summary",
  "Overdue invoices",
  "Inventory status",
  "Monthly report",
  "Top customers",
  "Cash position",
];

interface DisplayMessage extends CofounderMessage {
  pending?: boolean;
  needsConfirmation?: CofounderResponse["needsConfirmation"];
  actionsTaken?: CofounderResponse["actionsTaken"];
}

export function CofounderChatWindow({
  companyId,
  userPhone,
  lang = "ar",
  className,
}: CofounderChatWindowProps) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [localMessages, setLocalMessages] = useState<DisplayMessage[]>([]);
  const [activeLang, setActiveLang] = useState<"ar" | "en">(lang);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Use a stable phone key for this user. The server will key the session by
  // (companyId, phone). Web users get a synthetic phone so their session is
  // independent of any registered WhatsApp owner phone.
  const phone = userPhone ?? "web-default";

  const sessionQuery = useQuery({
    queryKey: ["cofounder", "session", companyId, phone],
    queryFn: () => aiCofounderApi.getSession(companyId, phone),
    enabled: Boolean(companyId),
    retry: false,
  });

  // Merge server messages + optimistic local ones
  const serverMessages: DisplayMessage[] = useMemo(() => {
    const data = sessionQuery.data;
    if (!data) return [];
    return data.messages
      .filter((m) => m.role !== "tool")
      .map((m) => ({ ...m }));
  }, [sessionQuery.data]);

  const allMessages: DisplayMessage[] = [...serverMessages, ...localMessages];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMessages.length]);

  const sendMut = useMutation({
    mutationFn: (text: string) =>
      aiCofounderApi.sendMessage(companyId, {
        text,
        userPhone: phone,
        lang: activeLang,
      }),
    onMutate: (text) => {
      setLocalMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: text,
          timestamp: new Date().toISOString(),
        },
        {
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
          pending: true,
        },
      ]);
    },
    onSuccess: (data) => {
      setLocalMessages((prev) => {
        // Replace last pending assistant message with the real response.
        const out = prev.slice();
        for (let i = out.length - 1; i >= 0; i -= 1) {
          if (out[i]!.role === "assistant" && out[i]!.pending) {
            out[i] = {
              role: "assistant",
              content: data.reply,
              timestamp: new Date().toISOString(),
              needsConfirmation: data.needsConfirmation,
              actionsTaken: data.actionsTaken,
            };
            break;
          }
        }
        return out;
      });
      setActiveLang(data.language);
      void queryClient.invalidateQueries({
        queryKey: ["cofounder", "session", companyId, phone],
      });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to send";
      setLocalMessages((prev) => {
        const out = prev.slice();
        for (let i = out.length - 1; i >= 0; i -= 1) {
          if (out[i]!.role === "assistant" && out[i]!.pending) {
            out[i] = {
              role: "assistant",
              content: msg,
              timestamp: new Date().toISOString(),
            };
            break;
          }
        }
        return out;
      });
    },
  });

  const clearMut = useMutation({
    mutationFn: () => aiCofounderApi.clearSession(companyId, phone),
    onSuccess: () => {
      setLocalMessages([]);
      void queryClient.invalidateQueries({
        queryKey: ["cofounder", "session", companyId, phone],
      });
    },
  });

  function handleSend() {
    const text = input.trim();
    if (!text || sendMut.isPending) return;
    setInput("");
    sendMut.mutate(text);
  }

  function handleQuickPrompt(p: string) {
    setInput(p);
    setTimeout(() => sendMut.mutate(p), 0);
    setInput("");
  }

  function handleConfirm(decision: "yes" | "no") {
    const replyText =
      activeLang === "ar"
        ? decision === "yes"
          ? "نعم"
          : "لا"
        : decision === "yes"
          ? "yes"
          : "no";
    sendMut.mutate(replyText);
  }

  const quickPrompts = activeLang === "ar" ? QUICK_PROMPTS_AR : QUICK_PROMPTS_EN;
  const placeholder =
    activeLang === "ar"
      ? "اكتب رسالتك للشريك المؤسس..."
      : "Message your AI Co-Founder...";

  const lastMessage = allMessages[allMessages.length - 1];
  const pendingConfirm =
    sessionQuery.data?.pendingConfirmation ?? lastMessage?.needsConfirmation;

  return (
    <Card className={cn("flex h-full max-h-[80vh] flex-col", className)}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-violet-100 p-1.5">
            <Sparkles className="h-4 w-4 text-violet-600" />
          </div>
          <div>
            <div className="text-sm font-semibold">
              {activeLang === "ar" ? "الشريك المؤسس الذكي" : "AI Co-Founder"}
            </div>
            <div className="text-xs text-muted-foreground">
              {activeLang === "ar"
                ? "نفس المحادثة على WhatsApp"
                : "Same conversation as WhatsApp"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setActiveLang((l) => (l === "ar" ? "en" : "ar"))
            }
          >
            {activeLang === "ar" ? "EN" : "ع"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => clearMut.mutate()}
            disabled={clearMut.isPending}
            title={activeLang === "ar" ? "مسح المحادثة" : "Clear conversation"}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b px-3 py-2">
        {quickPrompts.map((p) => (
          <Button
            key={p}
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => handleQuickPrompt(p)}
            disabled={sendMut.isPending}
          >
            {p}
          </Button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div
          ref={scrollRef}
          className="space-y-3 p-4"
          dir={activeLang === "ar" ? "rtl" : "ltr"}
        >
          {allMessages.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Bot className="h-10 w-10 text-violet-500" />
              <div>
                {activeLang === "ar"
                  ? "ابدأ المحادثة. اسألني عن أرقامك، عملائك، فواتيرك..."
                  : "Start a conversation. Ask me anything about your numbers, customers, invoices..."}
              </div>
            </div>
          )}
          {allMessages.map((m, idx) => (
            <MessageBubble
              key={idx}
              message={m}
              lang={activeLang}
              onConfirm={handleConfirm}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        {pendingConfirm && !sendMut.isPending && (
          <div className="mb-2 flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => handleConfirm("yes")}
            >
              {activeLang === "ar" ? "✅ نعم، نفّذ" : "✅ Yes, do it"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleConfirm("no")}
            >
              {activeLang === "ar" ? "❌ إلغاء" : "❌ Cancel"}
            </Button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            rows={2}
            dir={activeLang === "ar" ? "rtl" : "ltr"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={sendMut.isPending}
            className="resize-none"
          />
          <div className="flex flex-col gap-1">
            <VoiceCommandButton
              lang={activeLang === "ar" ? "ar-KW" : "en-US"}
              onTranscript={(text) => {
                setInput((prev) => (prev ? prev + " " + text : text));
              }}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={sendMut.isPending || !input.trim()}
            >
              {sendMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

interface MessageBubbleProps {
  message: DisplayMessage;
  lang: "ar" | "en";
  onConfirm: (d: "yes" | "no") => void;
}

function MessageBubble({ message, lang, onConfirm: _onConfirm }: MessageBubbleProps) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100">
          <Bot className="h-4 w-4 text-violet-600" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-violet-600 text-white"
            : "bg-muted text-foreground",
        )}
      >
        {message.pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <div className="whitespace-pre-wrap">{message.content}</div>
        )}
        {message.actionsTaken && message.actionsTaken.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.actionsTaken.map((a, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {a.summary}
              </Badge>
            ))}
          </div>
        )}
        {message.needsConfirmation && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            {lang === "ar"
              ? "⚠️ يتطلب تأكيد"
              : "⚠️ Confirmation required"}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100">
          <User className="h-4 w-4 text-violet-600" />
        </div>
      )}
    </div>
  );
}
