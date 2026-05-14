import { useState } from "react";
import { cn } from "@/lib/utils";

const COMMON_EMOJIS: string[] = [
  "👍",
  "❤️",
  "🎉",
  "🚀",
  "👀",
  "✅",
  "🔥",
  "💯",
  "🙏",
  "😂",
  "😮",
  "😢",
  "🤔",
  "👏",
  "💡",
  "⭐",
  "📌",
  "🟢",
  "🔴",
  "🟡",
  "📈",
  "📉",
  "💰",
  "🧾",
];

export interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  lang?: "en" | "ar";
  className?: string;
}

export function EmojiPicker({ onPick, lang = "en", className }: EmojiPickerProps) {
  const [filter, setFilter] = useState("");
  const items = filter
    ? COMMON_EMOJIS.filter((e) => e.includes(filter))
    : COMMON_EMOJIS;

  return (
    <div className={cn("w-64 space-y-2 p-2", className)}>
      <input
        autoFocus
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={lang === "ar" ? "ابحث عن رمز…" : "Search emoji…"}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="grid grid-cols-8 gap-1">
        {items.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            className="flex size-7 items-center justify-center rounded text-base hover:bg-accent"
          >
            {emoji}
          </button>
        ))}
        {items.length === 0 ? (
          <div className="col-span-8 py-2 text-center text-xs text-muted-foreground">
            {lang === "ar" ? "لا توجد نتائج" : "No matches"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
