// ---------------------------------------------------------------------------
// Conversation memory utilities for the AI Co-Founder
// ---------------------------------------------------------------------------
//
// Keeps the last N turns and summarizes older context when sessions grow.
// Detects language from the message text to switch persona on the fly.
//

export interface MemoryMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function detectLanguage(text: string): "ar" | "en" {
  if (!text) return "en";
  // If any character is in the Arabic Unicode block, treat as Arabic.
  return ARABIC_RE.test(text) ? "ar" : "en";
}

/**
 * Trim the conversation to roughly `maxTokens` worth of context, keeping the
 * most recent turns. We approximate tokens at ~4 characters per token, which
 * is good enough for context-window planning.
 */
export function trimContext(
  messages: MemoryMessage[],
  maxTokens: number,
): MemoryMessage[] {
  if (messages.length === 0) return [];
  const charBudget = maxTokens * 4;
  const out: MemoryMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    const cost = m.content.length + 20; // role + envelope overhead
    if (used + cost > charBudget && out.length > 2) break;
    out.push(m);
    used += cost;
  }
  return out.reverse();
}

/**
 * Pure-string summary of older context. Used when a session is older than
 * the cutoff — we preserve "what we talked about" without flooding the
 * model with full history.
 */
export function summarizeOldContext(messages: MemoryMessage[]): string {
  if (messages.length === 0) return "";
  // Take the first user message + the last assistant action mention.
  const firstUser = messages.find((m) => m.role === "user");
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const lines: string[] = [];
  if (firstUser) {
    lines.push(`Earlier topic: ${firstUser.content.slice(0, 200)}`);
  }
  if (lastAssistant) {
    lines.push(`Last assistant reply: ${lastAssistant.content.slice(0, 200)}`);
  }
  lines.push(`(${messages.length} prior turns omitted)`);
  return lines.join("\n");
}

/**
 * Tidy a message before showing it to the LLM. Strips tool_calls fences so
 * the model doesn't see its own prior emissions as raw JSON.
 */
export function cleanForPrompt(content: string): string {
  return content.replace(/```tool_calls[\s\S]*?```/g, "").trim();
}

/**
 * Detect short affirmation / negation tokens used for confirmation prompts.
 */
export function isAffirmation(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return (
    t === "نعم" ||
    t === "ايوه" ||
    t === "ايوا" ||
    t === "اكي" ||
    t === "اوكي" ||
    t === "اوك" ||
    t === "yes" ||
    t === "y" ||
    t === "ok" ||
    t === "okay" ||
    t === "sure" ||
    t === "confirm" ||
    t === "do it" ||
    t === "go ahead" ||
    t === "نفّذ" ||
    t === "نفذ"
  );
}

export function isNegation(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return (
    t === "لا" ||
    t === "لاء" ||
    t === "الغاء" ||
    t === "إلغاء" ||
    t === "no" ||
    t === "n" ||
    t === "cancel" ||
    t === "stop" ||
    t === "abort" ||
    t === "nevermind"
  );
}
