import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  WorkspaceChannel,
  WorkspaceMember,
  WorkspaceMessage,
  WorkspaceMessageMention,
} from "@paperclipai/shared";
import { Send, Smile, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { workspaceApi, workspaceQueryKeys } from "@/api/workspace";
import { cn } from "@/lib/utils";
import { CommandAutocompletePopover } from "./CommandAutocompletePopover";
import { MentionAutocompletePopover } from "./MentionAutocompletePopover";
import { EmojiPicker } from "./EmojiPicker";

export interface MessageComposerProps {
  companyId: string;
  channel: WorkspaceChannel;
  members: WorkspaceMember[];
  currentMember: WorkspaceMember | null;
  replyTo?: WorkspaceMessage | null;
  onClearReply?: () => void;
  lang?: "en" | "ar";
}

type ActiveTrigger =
  | { kind: "command"; start: number; prefix: string }
  | { kind: "mention"; start: number; prefix: string }
  | { kind: "emoji"; start: number; prefix: string }
  | null;

function detectTrigger(value: string, caret: number): ActiveTrigger {
  // Look backwards from caret for a trigger character.
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (!ch || /\s/.test(ch)) return null;
    if (ch === "/" && (i === 0 || /\s/.test(value[i - 1] ?? ""))) {
      return { kind: "command", start: i, prefix: value.slice(i + 1, caret) };
    }
    if (ch === "@" && (i === 0 || /\s/.test(value[i - 1] ?? ""))) {
      return { kind: "mention", start: i, prefix: value.slice(i + 1, caret) };
    }
    if (ch === ":" && (i === 0 || /\s/.test(value[i - 1] ?? ""))) {
      return { kind: "emoji", start: i, prefix: value.slice(i + 1, caret) };
    }
    i--;
  }
  return null;
}

export function MessageComposer({
  companyId,
  channel,
  members,
  currentMember,
  replyTo,
  onClearReply,
  lang = "en",
}: MessageComposerProps) {
  const [value, setValue] = useState("");
  const [trigger, setTrigger] = useState<ActiveTrigger>(null);
  const [selectionIdx, setSelectionIdx] = useState(0);
  const [selectionTotal, setSelectionTotal] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

  // Auto-resize textarea up to 8 rows.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 8 * 24;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value]);

  const sendMutation = useMutation({
    mutationFn: (body: {
      text: string;
      mentions: WorkspaceMessageMention[];
      threadRootId?: string;
    }) =>
      workspaceApi.messages.send(companyId, channel.id, {
        kind: "text",
        body: body.text,
        mentions: body.mentions,
        threadRootId: body.threadRootId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.messages(companyId, channel.id),
      });
      if (replyTo) {
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.messages(companyId, channel.id, replyTo.id),
        });
      }
      setValue("");
      onClearReply?.();
    },
  });

  const executeCommand = useMutation({
    mutationFn: (input: string) =>
      workspaceApi.commands.execute(companyId, {
        input,
        channelId: channel.id,
        lang,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.messages(companyId, channel.id),
      });
      setValue("");
    },
  });

  const extractMentions = (text: string): WorkspaceMessageMention[] => {
    const out: WorkspaceMessageMention[] = [];
    for (const m of members) {
      const handle = `@${m.displayName.replace(/\s+/g, "")}`;
      if (text.includes(handle)) {
        out.push({ type: m.type === "agent" ? "agent" : "user", id: m.id });
      }
    }
    return out;
  };

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      executeCommand.mutate(text);
      return;
    }
    sendMutation.mutate({
      text,
      mentions: extractMentions(text),
      threadRootId: replyTo?.id,
    });
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    setValue(nextValue);
    const caret = e.target.selectionStart ?? nextValue.length;
    setTrigger(detectTrigger(nextValue, caret));
  };

  const insertAtTrigger = (
    triggerStart: number,
    insertion: string,
    after: string = " ",
  ) => {
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, triggerStart);
    const tail = value.slice(caret);
    const newValue = `${before}${insertion}${after}${tail}`;
    setValue(newValue);
    setTrigger(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = before.length + insertion.length + after.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (trigger && (trigger.kind === "command" || trigger.kind === "mention")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectionIdx((i) => Math.min(i + 1, Math.max(0, selectionTotal - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectionIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape" && replyTo) {
      onClearReply?.();
    }
  };

  const channelLabel = useMemo(() => {
    if (channel.kind === "dm") {
      return lang === "ar" ? "أرسل رسالة" : "Send a message";
    }
    return lang === "ar" ? `أرسل إلى #${channel.slug}` : `Message #${channel.slug}`;
  }, [channel, lang]);

  return (
    <div className="border-t border-border bg-background">
      {replyTo ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5 text-xs">
          <span className="font-medium">
            {lang === "ar" ? "رد على" : "Replying to"}
          </span>
          <span className="truncate text-muted-foreground">
            {replyTo.authorDisplayName}: {replyTo.body.slice(0, 80)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClearReply}
            className="ms-auto"
          >
            <X />
          </Button>
        </div>
      ) : null}

      <div className="relative px-4 py-3">
        <div
          className={cn(
            "rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring",
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={channelLabel}
            rows={1}
            className="block w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            disabled={sendMutation.isPending || executeCommand.isPending}
          />
          <div className="flex items-center justify-between gap-1 border-t border-border/50 px-2 py-1">
            <div className="flex items-center gap-0.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={lang === "ar" ? "إضافة رمز" : "Insert emoji"}
                  >
                    <Smile />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <EmojiPicker
                    lang={lang}
                    onPick={(emoji) => {
                      const el = textareaRef.current;
                      if (!el) return;
                      const caret = el.selectionStart ?? value.length;
                      const next = `${value.slice(0, caret)}${emoji}${value.slice(caret)}`;
                      setValue(next);
                      requestAnimationFrame(() => {
                        el.focus();
                        const pos = caret + emoji.length;
                        el.setSelectionRange(pos, pos);
                      });
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button
              type="button"
              size="xs"
              onClick={submit}
              disabled={!value.trim() || sendMutation.isPending}
            >
              <Send className="size-3" />
              {lang === "ar" ? "إرسال" : "Send"}
            </Button>
          </div>
        </div>

        {trigger?.kind === "command" ? (
          <CommandAutocompletePopover
            companyId={companyId}
            open
            prefix={trigger.prefix}
            selectedIndex={selectionIdx}
            onSelectionChange={(idx, total) => {
              setSelectionIdx(idx);
              setSelectionTotal(total);
            }}
            onPick={(name) => insertAtTrigger(trigger.start, `/${name}`)}
            lang={lang}
          />
        ) : null}

        {trigger?.kind === "mention" ? (
          <MentionAutocompletePopover
            open
            members={members.filter((m) => m.id !== currentMember?.id)}
            prefix={trigger.prefix}
            selectedIndex={selectionIdx}
            onSelectionChange={(idx, total) => {
              setSelectionIdx(idx);
              setSelectionTotal(total);
            }}
            onPick={(m) =>
              insertAtTrigger(
                trigger.start,
                `@${m.displayName.replace(/\s+/g, "")}`,
              )
            }
            lang={lang}
          />
        ) : null}
      </div>
    </div>
  );
}
