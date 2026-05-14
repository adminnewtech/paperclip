import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "./EmojiPicker";

export interface ReactionsBarProps {
  reactions?: Record<string, string[]>;
  currentMemberId: string | null;
  lang?: "en" | "ar";
  onToggle: (emoji: string, currentlyReacted: boolean) => void;
  className?: string;
}

export function ReactionsBar({
  reactions,
  currentMemberId,
  lang = "en",
  onToggle,
  className,
}: ReactionsBarProps) {
  const entries = Object.entries(reactions ?? {}).filter(
    ([, members]) => members.length > 0,
  );

  if (entries.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {entries.map(([emoji, memberIds]) => {
        const reacted = !!currentMemberId && memberIds.includes(currentMemberId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji, reacted)}
            className={cn(
              "flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
              reacted
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-accent",
            )}
            title={`${memberIds.length} ${lang === "ar" ? "تفاعل" : memberIds.length === 1 ? "reaction" : "reactions"}`}
          >
            <span>{emoji}</span>
            <span className="font-medium">{memberIds.length}</span>
          </button>
        );
      })}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:bg-accent"
            title={lang === "ar" ? "أضف تفاعل" : "Add reaction"}
          >
            <SmilePlus className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <EmojiPicker
            lang={lang}
            onPick={(emoji) => {
              const memberIds = reactions?.[emoji] ?? [];
              const reacted = !!currentMemberId && memberIds.includes(currentMemberId);
              onToggle(emoji, reacted);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
