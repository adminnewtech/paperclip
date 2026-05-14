/**
 * Slash commands service.
 *
 * Public surface:
 *   - `list()` — enumerate registered commands (optionally filtered by lang or category).
 *   - `get(name)` — fetch a single command spec by name or alias.
 *   - `parse(input)` — parse a raw `/cmd arg1 …` string.
 *   - `execute(input, ctx)` — parse + dispatch to the handler.
 *   - `registerCommand(handler)` — add a custom command at runtime.
 *   - `autocomplete(prefix)` — suggest commands as the user types `/`.
 *
 * Built-in commands live in `./builtins.ts`. Optional dependencies
 * ({@link CommandDependencies}) are forwarded to handlers so each one can
 * gracefully degrade when a service (message poster, agent runner, …) is
 * not configured.
 */
import type {
  CommandInvocation,
  CommandInvocationContext,
  CommandResult,
  ParsedSlashCommand,
  SlashCommand,
} from "@paperclipai/shared";
import { parseSlashCommand } from "./parser.js";
import {
  BUILTIN_COMMANDS,
  type CommandDependencies,
  type CommandHandler,
} from "./builtins.js";

export type {
  CommandHandler,
  CommandDependencies,
  MessagePoster,
  AgentRunner,
  AgentChatter,
  AgentDirectory,
  AgentDirectoryEntry,
  ReminderScheduler,
  ReportRunner,
  MessagingDispatcher,
} from "./builtins.js";

export interface CommandsService {
  list(opts?: { lang?: "ar" | "en"; category?: string }): SlashCommand[];
  get(name: string): SlashCommand | null;
  parse(input: string): ParsedSlashCommand | null;
  execute(input: string, ctx: CommandInvocationContext): Promise<CommandResult>;
  registerCommand(handler: CommandHandler): void;
  autocomplete(prefix: string, opts?: { lang?: "ar" | "en" }): Array<{ name: string; description: string }>;
}

function findHandler(handlers: CommandHandler[], name: string): CommandHandler | null {
  const lower = name.toLowerCase();
  return (
    handlers.find((h) => h.spec.name === lower || h.spec.aliases?.includes(lower)) ?? null
  );
}

export function createCommandsService(deps: CommandDependencies): CommandsService {
  const handlers: CommandHandler[] = [...BUILTIN_COMMANDS];

  function list(opts?: { lang?: "ar" | "en"; category?: string }): SlashCommand[] {
    let result = handlers.map((h) => h.spec);
    if (opts?.category) {
      result = result.filter((c) => c.category === opts.category);
    }
    // lang only affects what's shown; the SlashCommand carries both
    // description fields. We sort alphabetically for stable UI rendering.
    return result.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  function get(name: string): SlashCommand | null {
    return findHandler(handlers, name)?.spec ?? null;
  }

  function parse(input: string): ParsedSlashCommand | null {
    return parseSlashCommand(input);
  }

  async function execute(
    input: string,
    ctx: CommandInvocationContext,
  ): Promise<CommandResult> {
    const parsed = parseSlashCommand(input);
    if (!parsed) {
      return {
        success: false,
        message: "Not a valid slash command.",
        messageAr: "ليس أمراً صالحاً.",
        errorCode: "parse_error",
      };
    }
    const handler = findHandler(handlers, parsed.name);
    if (!handler) {
      return {
        success: false,
        message: `Unknown command: /${parsed.name}`,
        messageAr: `أمر غير معروف: /${parsed.name}`,
        errorCode: "unknown_command",
      };
    }
    const invocation: CommandInvocation = {
      name: parsed.name,
      raw: parsed.raw,
      args: {
        positional: parsed.positional,
        named: parsed.named,
        ...parsed.named,
      },
      ctx,
    };
    try {
      return await handler.execute(invocation, deps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Command failed: ${msg}`,
        messageAr: `فشل الأمر: ${msg}`,
        errorCode: "exception",
      };
    }
  }

  function registerCommand(handler: CommandHandler): void {
    // Override duplicates so plugins can replace builtins if they need to.
    const idx = handlers.findIndex((h) => h.spec.name === handler.spec.name);
    if (idx >= 0) handlers[idx] = handler;
    else handlers.push(handler);
  }

  function autocomplete(
    prefix: string,
    opts?: { lang?: "ar" | "en" },
  ): Array<{ name: string; description: string }> {
    const trimmed = (prefix ?? "").trim().toLowerCase();
    const pfx = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    const matches = handlers.filter((h) => {
      if (h.spec.name.startsWith(pfx)) return true;
      return h.spec.aliases?.some((a) => a.startsWith(pfx)) ?? false;
    });
    return matches
      .slice()
      .sort((a, b) => a.spec.name.localeCompare(b.spec.name))
      .map((h) => ({
        name: h.spec.name,
        description: opts?.lang === "ar" ? h.spec.descriptionAr : h.spec.description,
      }));
  }

  return { list, get, parse, execute, registerCommand, autocomplete };
}

export { parseSlashCommand };
