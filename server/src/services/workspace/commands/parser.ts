/**
 * Slash command parser.
 *
 * Turns raw text such as `/invoice create @ahmad 500 KWD --note="late fee"`
 * into a structured {@link ParsedSlashCommand}. The parser is deliberately
 * permissive — it never throws, returning `null` only when the input doesn't
 * look like a slash command at all.
 *
 * Recognised syntax:
 *   - `/<name>` — command name (alphanumeric + underscore + hyphen)
 *   - Positional args separated by whitespace
 *   - Quoted strings preserved: `"hello world"` and `'hello world'`
 *   - Named args: `--key=value` or `--flag` (boolean → "true")
 *   - Mentions stay as-is (`@ahmad`)
 *   - Backslash-prefix `\/foo` is treated as literal text (return null)
 *
 * Numbers and currencies are NOT decoded here — handlers receive raw strings
 * and decode them via the helpers in `./builtins.ts`.
 */
import type { ParsedSlashCommand } from "@paperclipai/shared";

export type { ParsedSlashCommand };

const COMMAND_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/;

/**
 * Parse a slash command. Returns `null` if the input is empty, doesn't start
 * with `/`, is escaped (`\/`), or has an invalid command name.
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Escape: `\/foo` is literal text, not a command.
  if (trimmed.startsWith("\\/")) return null;
  if (!trimmed.startsWith("/")) return null;

  const withoutSlash = trimmed.slice(1);
  if (withoutSlash.length === 0) return null;

  // Split into command name + remainder
  let nameEnd = 0;
  while (nameEnd < withoutSlash.length && /\S/.test(withoutSlash[nameEnd]!)) {
    nameEnd++;
  }
  const name = withoutSlash.slice(0, nameEnd);
  const rawArgs = withoutSlash.slice(nameEnd).trim();

  if (!COMMAND_NAME_RE.test(name)) return null;

  const tokens = tokenize(rawArgs);
  const positional: string[] = [];
  const named: Record<string, string> = {};

  for (const tok of tokens) {
    if (tok.startsWith("--")) {
      const body = tok.slice(2);
      if (body.length === 0) {
        // bare "--" treated as positional
        positional.push(tok);
        continue;
      }
      const eq = body.indexOf("=");
      if (eq === -1) {
        named[body] = "true";
      } else {
        const key = body.slice(0, eq);
        const value = body.slice(eq + 1);
        if (key.length > 0) named[key] = stripQuotes(value);
      }
    } else {
      positional.push(stripQuotes(tok));
    }
  }

  return {
    name: name.toLowerCase(),
    raw: trimmed,
    rawArgs,
    positional,
    named,
  };
}

/**
 * Tokenise a string respecting single + double quotes. Quoted regions may
 * contain whitespace; the surrounding quotes are stripped by {@link stripQuotes}.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  let quoteChar: '"' | "'" | null = null;
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (quoteChar) {
      if (ch === "\\" && i + 1 < input.length) {
        // escape next char inside quote
        buf += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === quoteChar) {
        quoteChar = null;
        i++;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = "";
      }
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.length > 0) tokens.push(buf);
  return tokens;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Number / currency helpers (used by handlers)
// ---------------------------------------------------------------------------

const SUPPORTED_CURRENCIES = new Set(["KWD", "SAR", "AED", "USD"]);

export interface ParsedAmount {
  amount: number;
  currency: string | null;
}

/**
 * Parse strings like "500", "500.50", "500KWD", "500 KWD" into an amount
 * + currency. Returns null on failure.
 */
export function parseAmount(input: string | undefined | null, fallbackCurrency: string | null = null): ParsedAmount | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (s.length === 0) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]{3})?$/);
  if (!m) return null;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount)) return null;
  const currency = (m[2] ?? fallbackCurrency ?? "").toUpperCase() || null;
  if (currency && !SUPPORTED_CURRENCIES.has(currency)) {
    // Unknown currency — still accept the amount but flag currency=null
    return { amount, currency: null };
  }
  return { amount, currency };
}

/** Returns true if the supplied string is a recognised currency code. */
export function isCurrencyCode(input: string | undefined | null): boolean {
  if (!input) return false;
  return SUPPORTED_CURRENCIES.has(input.toUpperCase());
}

/** Normalise a currency code to upper-case if known; else null. */
export function normaliseCurrency(input: string | undefined | null): string | null {
  if (!input) return null;
  const up = input.toUpperCase();
  return SUPPORTED_CURRENCIES.has(up) ? up : null;
}

/** True if a token looks like a mention (e.g. "@ahmad"). */
export function isMention(token: string | undefined | null): boolean {
  if (!token) return false;
  return /^@[\w.-]+$/.test(token);
}

/** Strip a leading "@" if present. */
export function stripMention(token: string): string {
  return token.startsWith("@") ? token.slice(1) : token;
}
