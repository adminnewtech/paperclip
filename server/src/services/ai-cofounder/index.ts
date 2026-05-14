// ---------------------------------------------------------------------------
// AI Co-Founder service
// ---------------------------------------------------------------------------
//
// The Co-Founder is a persistent conversational layer over the company's
// data. The same session can be driven from web chat or from WhatsApp —
// messages are routed by (companyId, userPhone) key. Sessions are stored
// as businessEntities with moduleKey "cofounder", entityType "session"
// so they show up in normal access-controlled queries.
//
// LLM use is optional. If ANTHROPIC_API_KEY is unset we fall back to the
// existing NLP service plus a small set of canned responses, so the UI
// continues to work in dev.
//

import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities, businessModules } from "@paperclipai/db";
import { buildCofounderPrompt } from "./cofounder-prompt.js";
import {
  COFOUNDER_TOOLS,
  findTool,
  publicToolList,
  type ToolContext,
  type ToolSpec,
} from "./tools-registry.js";
import {
  cleanForPrompt,
  detectLanguage,
  isAffirmation,
  isNegation,
  trimContext,
  type MemoryMessage,
} from "./conversation-memory.js";
import type { WhatsappCloudService } from "../whatsapp-cloud-service.js";
import { createBusinessNlpService } from "../business-nlp-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CofounderMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolResult?: { id: string; result: unknown };
  timestamp: string;
}

export interface CofounderPendingConfirmation {
  action: string;
  parameters: Record<string, unknown>;
  expiresAt: string;
}

export interface CofounderSession {
  id: string;
  companyId: string;
  userPhone: string;
  userUserId?: string;
  language: "ar" | "en";
  messages: CofounderMessage[];
  lastActivityAt: string;
  pendingConfirmation?: CofounderPendingConfirmation;
}

export interface CofounderActionTaken {
  name: string;
  summary: string;
  result?: unknown;
}

export interface CofounderResponse {
  reply: string;
  actionsTaken: CofounderActionTaken[];
  attachments?: Array<{
    type: "image" | "document";
    url: string;
    caption?: string;
  }>;
  needsConfirmation?: {
    action: string;
    parameters: Record<string, unknown>;
    question: string;
  };
  language: "ar" | "en";
  sessionId: string;
}

export interface OwnerPhoneRecord {
  userPhone: string;
  userUserId?: string;
  lang: "ar" | "en";
  dailyBriefEnabled: boolean;
  weeklyReportEnabled: boolean;
  briefTime: string; // "HH:MM" 24h, owner's local time (Kuwait UTC+3)
  lastDailyBriefSentAt?: string;
  lastWeeklyReportSentAt?: string;
}

export interface AiCofounderService {
  handleMessage(
    companyId: string,
    userPhone: string,
    text: string,
    opts?: { userUserId?: string; lang?: "ar" | "en" },
  ): Promise<CofounderResponse>;
  getSession(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderSession | null>;
  clearSession(companyId: string, userPhone: string): Promise<void>;
  listSessions(companyId: string): Promise<CofounderSession[]>;
  sendDailyBrief(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderResponse>;
  sendWeeklyReport(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderResponse>;
  registerOwnerPhone(
    companyId: string,
    userPhone: string,
    opts: {
      userUserId?: string;
      lang?: "ar" | "en";
      dailyBriefEnabled?: boolean;
      weeklyReportEnabled?: boolean;
      briefTime?: string;
    },
  ): Promise<void>;
  unregisterOwnerPhone(
    companyId: string,
    userPhone: string,
  ): Promise<void>;
  listOwnerPhones(companyId: string): Promise<OwnerPhoneRecord[]>;
  isOwnerPhone(companyId: string, userPhone: string): Promise<boolean>;
  listAllOwnerPhones(): Promise<
    Array<{ companyId: string } & OwnerPhoneRecord>
  >;
  updateOwnerPhoneState(
    companyId: string,
    userPhone: string,
    patch: Partial<OwnerPhoneRecord>,
  ): Promise<void>;
  listTools(): ReturnType<typeof publicToolList>;
  /**
   * Look up the company whose registered owner-phones include this number,
   * for inbox routing. Returns null if not an owner phone for any company.
   */
  resolveCompanyForOwnerPhone(userPhone: string): Promise<string | null>;
}

const COFOUNDER_MODULE_KEY = "cofounder";
const SESSION_ENTITY_TYPE = "session";
const SESSION_HISTORY_LIMIT = 20;
const SESSION_CONTEXT_TOKEN_BUDGET = 6000;
const PENDING_CONFIRMATION_TTL_MS = 30 * 60 * 1000;
const KUWAIT_TZ_OFFSET_HOURS = 3;

// ---------------------------------------------------------------------------
// Lazy LLM client (mirrors business-ai-service pattern)
// ---------------------------------------------------------------------------

interface LLMClient {
  complete(input: {
    system: string;
    user: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string>;
}

let cachedClient: LLMClient | null | undefined;

async function getLLMClient(): Promise<LLMClient | null> {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    cachedClient = null;
    return null;
  }
  try {
    const pkg = "@anthropic-ai/sdk";
    const mod = (await (
      Function("p", "return import(p)") as (p: string) => Promise<unknown>
    )(pkg).catch(() => null)) as
      | { default?: new (opts: { apiKey: string }) => unknown }
      | null;
    if (!mod || !mod.default) {
      cachedClient = null;
      return null;
    }
    const AnthropicCtor = mod.default;
    const instance = new AnthropicCtor({ apiKey }) as {
      messages: {
        create(args: {
          model: string;
          max_tokens: number;
          temperature?: number;
          system?: string;
          messages: Array<{ role: "user" | "assistant"; content: string }>;
        }): Promise<{
          content: Array<{ type: string; text?: string }>;
        }>;
      };
    };
    cachedClient = {
      async complete({ system, user, history, maxTokens = 1500, temperature = 0.3 }) {
        const messages = [
          ...history,
          { role: "user" as const, content: user },
        ];
        const response = await instance.messages.create({
          model: "claude-3-5-sonnet-latest",
          max_tokens: maxTokens,
          temperature,
          system,
          messages,
        });
        const parts = response.content
          .map((p) => (p.type === "text" && p.text ? p.text : ""))
          .filter(Boolean);
        return parts.join("\n").trim();
      },
    };
    return cachedClient;
  } catch {
    cachedClient = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tool-call parsing
// ---------------------------------------------------------------------------

interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface ParsedLLMResponse {
  text: string;
  toolCalls: ParsedToolCall[];
}

function parseLLMResponse(raw: string): ParsedLLMResponse {
  const toolCalls: ParsedToolCall[] = [];
  const fenceRe = /```tool_calls\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    const inner = m[1] ?? "";
    try {
      const parsed = JSON.parse(inner) as {
        tool_calls?: Array<{
          name?: unknown;
          arguments?: unknown;
        }>;
      };
      if (Array.isArray(parsed.tool_calls)) {
        for (const tc of parsed.tool_calls) {
          if (typeof tc.name === "string") {
            const args =
              tc.arguments && typeof tc.arguments === "object"
                ? (tc.arguments as Record<string, unknown>)
                : {};
            toolCalls.push({ name: tc.name, arguments: args });
          }
        }
      }
    } catch {
      // ignore malformed blocks
    }
  }
  const text = raw.replace(fenceRe, "").trim();
  return { text, toolCalls };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createAiCofounderService(
  db: Db,
  opts: {
    whatsappService?: WhatsappCloudService;
  } = {},
): AiCofounderService {
  const whatsappService = opts.whatsappService;
  const nlpService = createBusinessNlpService(db);
  const toolCtx: ToolContext = { db, whatsappService };

  // -------------------------------------------------------------------------
  // Session storage helpers
  // -------------------------------------------------------------------------

  function sessionCode(userPhone: string): string {
    return `COF-${userPhone.replace(/\D/g, "")}`;
  }

  async function loadSessionRow(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderSession | null> {
    const code = sessionCode(userPhone);
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, COFOUNDER_MODULE_KEY),
          eq(businessEntities.entityType, SESSION_ENTITY_TYPE),
          eq(businessEntities.code, code),
        ),
      )
      .limit(1);
    if (!row) return null;
    const data = (row.data ?? {}) as Record<string, unknown>;
    const messages = Array.isArray(data.messages)
      ? (data.messages as CofounderMessage[])
      : [];
    return {
      id: row.id,
      companyId,
      userPhone,
      userUserId:
        typeof data.userUserId === "string"
          ? (data.userUserId as string)
          : undefined,
      language:
        data.language === "ar" || data.language === "en"
          ? (data.language as "ar" | "en")
          : "en",
      messages,
      lastActivityAt:
        typeof data.lastActivityAt === "string"
          ? (data.lastActivityAt as string)
          : (row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : new Date().toISOString()),
      pendingConfirmation:
        data.pendingConfirmation && typeof data.pendingConfirmation === "object"
          ? (data.pendingConfirmation as CofounderPendingConfirmation)
          : undefined,
    };
  }

  async function saveSession(session: CofounderSession): Promise<string> {
    const code = sessionCode(session.userPhone);
    const now = new Date();
    const data: Record<string, unknown> = {
      userPhone: session.userPhone,
      userUserId: session.userUserId,
      language: session.language,
      messages: session.messages.slice(-SESSION_HISTORY_LIMIT * 4),
      lastActivityAt: now.toISOString(),
      pendingConfirmation: session.pendingConfirmation ?? null,
    };
    if (session.id && session.id !== "new") {
      await db
        .update(businessEntities)
        .set({
          data,
          status: "active",
          updatedAt: now,
        })
        .where(eq(businessEntities.id, session.id));
      return session.id;
    }
    const existing = await loadSessionRow(session.companyId, session.userPhone);
    if (existing) {
      await db
        .update(businessEntities)
        .set({ data, status: "active", updatedAt: now })
        .where(eq(businessEntities.id, existing.id));
      return existing.id;
    }
    const [inserted] = await db
      .insert(businessEntities)
      .values({
        companyId: session.companyId,
        moduleKey: COFOUNDER_MODULE_KEY,
        entityType: SESSION_ENTITY_TYPE,
        code,
        name: `Co-Founder session ${session.userPhone}`,
        status: "active",
        data,
        tags: ["cofounder", "session"],
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: businessEntities.id });
    return inserted!.id;
  }

  // -------------------------------------------------------------------------
  // Owner phone registry — stored on the cofounder module config blob
  // -------------------------------------------------------------------------

  async function loadOwnerPhones(
    companyId: string,
  ): Promise<OwnerPhoneRecord[]> {
    const [row] = await db
      .select()
      .from(businessModules)
      .where(
        and(
          eq(businessModules.companyId, companyId),
          eq(businessModules.moduleKey, COFOUNDER_MODULE_KEY),
        ),
      )
      .limit(1);
    if (!row) return [];
    const cfg = (row.config ?? {}) as Record<string, unknown>;
    const arr = cfg.ownerWhatsappPhones;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((rec): OwnerPhoneRecord => ({
        userPhone:
          typeof rec.userPhone === "string" ? (rec.userPhone as string) : "",
        userUserId:
          typeof rec.userUserId === "string"
            ? (rec.userUserId as string)
            : undefined,
        lang: rec.lang === "ar" ? ("ar" as const) : ("en" as const),
        dailyBriefEnabled: rec.dailyBriefEnabled !== false,
        weeklyReportEnabled: rec.weeklyReportEnabled !== false,
        briefTime:
          typeof rec.briefTime === "string"
            ? (rec.briefTime as string)
            : "09:00",
        lastDailyBriefSentAt:
          typeof rec.lastDailyBriefSentAt === "string"
            ? (rec.lastDailyBriefSentAt as string)
            : undefined,
        lastWeeklyReportSentAt:
          typeof rec.lastWeeklyReportSentAt === "string"
            ? (rec.lastWeeklyReportSentAt as string)
            : undefined,
      }))
      .filter((r) => r.userPhone.length > 0);
  }

  async function saveOwnerPhones(
    companyId: string,
    list: OwnerPhoneRecord[],
  ): Promise<void> {
    const now = new Date();
    const [existing] = await db
      .select()
      .from(businessModules)
      .where(
        and(
          eq(businessModules.companyId, companyId),
          eq(businessModules.moduleKey, COFOUNDER_MODULE_KEY),
        ),
      )
      .limit(1);
    if (existing) {
      const cfg = (existing.config ?? {}) as Record<string, unknown>;
      const newCfg = { ...cfg, ownerWhatsappPhones: list };
      await db
        .update(businessModules)
        .set({ config: newCfg, updatedAt: now })
        .where(eq(businessModules.id, existing.id));
    } else {
      await db.insert(businessModules).values({
        companyId,
        moduleKey: COFOUNDER_MODULE_KEY,
        enabled: true,
        config: { ownerWhatsappPhones: list },
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async function registerOwnerPhone(
    companyId: string,
    userPhone: string,
    opts: {
      userUserId?: string;
      lang?: "ar" | "en";
      dailyBriefEnabled?: boolean;
      weeklyReportEnabled?: boolean;
      briefTime?: string;
    },
  ): Promise<void> {
    const list = await loadOwnerPhones(companyId);
    const idx = list.findIndex((r) => r.userPhone === userPhone);
    const merged: OwnerPhoneRecord = {
      userPhone,
      userUserId: opts.userUserId ?? list[idx]?.userUserId,
      lang: opts.lang ?? list[idx]?.lang ?? "en",
      dailyBriefEnabled:
        opts.dailyBriefEnabled ?? list[idx]?.dailyBriefEnabled ?? true,
      weeklyReportEnabled:
        opts.weeklyReportEnabled ?? list[idx]?.weeklyReportEnabled ?? true,
      briefTime: opts.briefTime ?? list[idx]?.briefTime ?? "09:00",
      lastDailyBriefSentAt: list[idx]?.lastDailyBriefSentAt,
      lastWeeklyReportSentAt: list[idx]?.lastWeeklyReportSentAt,
    };
    if (idx >= 0) list[idx] = merged;
    else list.push(merged);
    await saveOwnerPhones(companyId, list);
  }

  async function unregisterOwnerPhone(
    companyId: string,
    userPhone: string,
  ): Promise<void> {
    const list = await loadOwnerPhones(companyId);
    const filtered = list.filter((r) => r.userPhone !== userPhone);
    await saveOwnerPhones(companyId, filtered);
  }

  async function updateOwnerPhoneState(
    companyId: string,
    userPhone: string,
    patch: Partial<OwnerPhoneRecord>,
  ): Promise<void> {
    const list = await loadOwnerPhones(companyId);
    const idx = list.findIndex((r) => r.userPhone === userPhone);
    if (idx < 0) return;
    list[idx] = { ...list[idx]!, ...patch, userPhone };
    await saveOwnerPhones(companyId, list);
  }

  async function isOwnerPhone(
    companyId: string,
    userPhone: string,
  ): Promise<boolean> {
    const list = await loadOwnerPhones(companyId);
    return list.some((r) => r.userPhone === userPhone);
  }

  async function listAllOwnerPhones(): Promise<
    Array<{ companyId: string } & OwnerPhoneRecord>
  > {
    const rows = await db
      .select()
      .from(businessModules)
      .where(eq(businessModules.moduleKey, COFOUNDER_MODULE_KEY));
    const out: Array<{ companyId: string } & OwnerPhoneRecord> = [];
    for (const row of rows) {
      const cfg = (row.config ?? {}) as Record<string, unknown>;
      const arr = cfg.ownerWhatsappPhones;
      if (!Array.isArray(arr)) continue;
      for (const rec of arr) {
        if (!rec || typeof rec !== "object") continue;
        const r = rec as Record<string, unknown>;
        const phone = typeof r.userPhone === "string" ? (r.userPhone as string) : "";
        if (!phone) continue;
        out.push({
          companyId: row.companyId,
          userPhone: phone,
          userUserId:
            typeof r.userUserId === "string"
              ? (r.userUserId as string)
              : undefined,
          lang: r.lang === "ar" ? "ar" : "en",
          dailyBriefEnabled: r.dailyBriefEnabled !== false,
          weeklyReportEnabled: r.weeklyReportEnabled !== false,
          briefTime:
            typeof r.briefTime === "string"
              ? (r.briefTime as string)
              : "09:00",
          lastDailyBriefSentAt:
            typeof r.lastDailyBriefSentAt === "string"
              ? (r.lastDailyBriefSentAt as string)
              : undefined,
          lastWeeklyReportSentAt:
            typeof r.lastWeeklyReportSentAt === "string"
              ? (r.lastWeeklyReportSentAt as string)
              : undefined,
        });
      }
    }
    return out;
  }

  async function resolveCompanyForOwnerPhone(
    userPhone: string,
  ): Promise<string | null> {
    const all = await listAllOwnerPhones();
    const stripped = userPhone.replace(/\D/g, "");
    const match = all.find(
      (r) => r.userPhone === userPhone || r.userPhone.replace(/\D/g, "") === stripped,
    );
    return match?.companyId ?? null;
  }

  async function getCompanyName(companyId: string): Promise<string | undefined> {
    try {
      const row = await db.execute(
        sql`select name from companies where id = ${companyId} limit 1`,
      );
      const rows = (row as unknown as { rows?: Array<{ name?: string }> }).rows;
      if (rows && rows[0]?.name) return rows[0].name;
    } catch {
      // companies table may not be accessible from this layer — best effort.
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Core message handler
  // -------------------------------------------------------------------------

  async function handleMessage(
    companyId: string,
    userPhone: string,
    text: string,
    opts: { userUserId?: string; lang?: "ar" | "en" } = {},
  ): Promise<CofounderResponse> {
    const session =
      (await loadSessionRow(companyId, userPhone)) ?? {
        id: "new",
        companyId,
        userPhone,
        userUserId: opts.userUserId,
        language: opts.lang ?? detectLanguage(text),
        messages: [],
        lastActivityAt: new Date().toISOString(),
      };
    // language can drift turn-by-turn; respect explicit opts.lang else detect
    if (opts.lang) session.language = opts.lang;
    else if (text.trim().length > 0) {
      session.language = detectLanguage(text);
    }
    if (opts.userUserId && !session.userUserId) {
      session.userUserId = opts.userUserId;
    }

    // Handle pending confirmation responses first.
    if (session.pendingConfirmation) {
      const expired =
        Date.parse(session.pendingConfirmation.expiresAt) < Date.now();
      if (expired) {
        session.pendingConfirmation = undefined;
      } else if (isAffirmation(text)) {
        const pending = session.pendingConfirmation;
        session.pendingConfirmation = undefined;
        session.messages.push({
          role: "user",
          content: text,
          timestamp: new Date().toISOString(),
        });
        const result = await executeTool(
          companyId,
          pending.action,
          pending.parameters,
        );
        const summary =
          summarizeToolResult(pending.action, result, session.language) +
          (session.language === "ar" ? "\n✅ تم التنفيذ." : "\n✅ Done.");
        session.messages.push({
          role: "assistant",
          content: summary,
          timestamp: new Date().toISOString(),
          toolCalls: [
            {
              id: `tc_${Date.now()}`,
              name: pending.action,
              arguments: pending.parameters,
            },
          ],
          toolResult: { id: pending.action, result },
        });
        const sessionId = await saveSession(session);
        return {
          reply: summary,
          actionsTaken: [
            {
              name: pending.action,
              summary: shortSummary(pending.action, session.language),
              result,
            },
          ],
          language: session.language,
          sessionId,
        };
      } else if (isNegation(text)) {
        session.pendingConfirmation = undefined;
        session.messages.push({
          role: "user",
          content: text,
          timestamp: new Date().toISOString(),
        });
        const reply =
          session.language === "ar"
            ? "تمام، تم الإلغاء."
            : "Got it — cancelled.";
        session.messages.push({
          role: "assistant",
          content: reply,
          timestamp: new Date().toISOString(),
        });
        const sessionId = await saveSession(session);
        return {
          reply,
          actionsTaken: [],
          language: session.language,
          sessionId,
        };
      }
      // otherwise fall through and treat as a new request
    }

    session.messages.push({
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    });

    const llm = await getLLMClient();
    if (!llm) {
      // Fallback: NLP intent + canned response
      const fallback = await handleWithNlp(companyId, text, session.language);
      session.messages.push({
        role: "assistant",
        content: fallback.reply,
        timestamp: new Date().toISOString(),
      });
      const sessionId = await saveSession(session);
      return { ...fallback, sessionId };
    }

    const companyName = await getCompanyName(companyId);
    const systemPrompt = buildCofounderPrompt({
      lang: session.language,
      companyName,
      ownerName: undefined,
      tools: COFOUNDER_TOOLS,
    });

    const history = trimContext(
      session.messages.slice(0, -1).map((m) => ({
        role: m.role === "tool" ? "assistant" : m.role,
        content: cleanForPrompt(m.content),
        timestamp: m.timestamp,
      })) as MemoryMessage[],
      SESSION_CONTEXT_TOKEN_BUDGET,
    ).map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    let llmRaw: string;
    try {
      llmRaw = await llm.complete({
        system: systemPrompt,
        user: text,
        history,
        maxTokens: 1500,
        temperature: 0.3,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "LLM error";
      const reply =
        session.language === "ar"
          ? `حدث خطأ مؤقت في المساعد: ${errMsg}`
          : `Temporary assistant error: ${errMsg}`;
      session.messages.push({
        role: "assistant",
        content: reply,
        timestamp: new Date().toISOString(),
      });
      const sessionId = await saveSession(session);
      return { reply, actionsTaken: [], language: session.language, sessionId };
    }

    const parsed = parseLLMResponse(llmRaw);
    const actionsTaken: CofounderActionTaken[] = [];
    let needsConfirmation: CofounderResponse["needsConfirmation"];

    const toolMessages: CofounderMessage[] = [];
    for (const tc of parsed.toolCalls) {
      const spec = findTool(tc.name);
      if (!spec) {
        toolMessages.push({
          role: "tool",
          content: `Unknown tool: ${tc.name}`,
          timestamp: new Date().toISOString(),
          toolResult: { id: tc.name, result: { error: "unknown_tool" } },
        });
        continue;
      }
      if (spec.dangerous) {
        // Pause and request confirmation. Only the first dangerous call is
        // queued; we ignore further ones in the same turn.
        if (!needsConfirmation) {
          needsConfirmation = {
            action: spec.name,
            parameters: tc.arguments,
            question: confirmationQuestion(spec, tc.arguments, session.language),
          };
          session.pendingConfirmation = {
            action: spec.name,
            parameters: tc.arguments,
            expiresAt: new Date(
              Date.now() + PENDING_CONFIRMATION_TTL_MS,
            ).toISOString(),
          };
        }
        continue;
      }
      const result = await executeTool(companyId, tc.name, tc.arguments);
      actionsTaken.push({
        name: spec.name,
        summary: shortSummary(spec.name, session.language),
        result,
      });
      toolMessages.push({
        role: "tool",
        content: JSON.stringify({ tool: tc.name, result }).slice(0, 4000),
        timestamp: new Date().toISOString(),
        toolResult: { id: tc.name, result },
      });
    }

    let finalReply = parsed.text;
    // If we ran tools and the LLM didn't include final text, ask for a recap.
    if (
      toolMessages.length > 0 &&
      (!finalReply || finalReply.length < 8)
    ) {
      try {
        const recap = await llm.complete({
          system: systemPrompt,
          user:
            (session.language === "ar"
              ? "هذه نتائج الأدوات. لخصها للمستخدم بشكل واضح ومختصر:\n"
              : "Here are the tool results. Summarize them clearly and concisely for the user:\n") +
            toolMessages.map((t) => t.content).join("\n"),
          history,
          maxTokens: 800,
          temperature: 0.3,
        });
        finalReply = parseLLMResponse(recap).text || recap;
      } catch {
        finalReply = formatToolResultsFallback(toolMessages, session.language);
      }
    }
    if (!finalReply || finalReply.length === 0) {
      finalReply = needsConfirmation
        ? needsConfirmation.question
        : session.language === "ar"
          ? "تمام."
          : "Done.";
    } else if (needsConfirmation) {
      finalReply = `${finalReply}\n\n${needsConfirmation.question}`;
    }

    for (const tm of toolMessages) session.messages.push(tm);
    session.messages.push({
      role: "assistant",
      content: finalReply,
      timestamp: new Date().toISOString(),
      toolCalls:
        parsed.toolCalls.length > 0
          ? parsed.toolCalls.map((tc) => ({
              id: `tc_${Date.now()}_${tc.name}`,
              name: tc.name,
              arguments: tc.arguments,
            }))
          : undefined,
    });

    const sessionId = await saveSession(session);
    return {
      reply: finalReply,
      actionsTaken,
      needsConfirmation,
      language: session.language,
      sessionId,
    };
  }

  async function executeTool(
    companyId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const spec = findTool(name);
    if (!spec) return { error: "unknown_tool" };
    try {
      return await spec.handler(companyId, args, toolCtx);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "tool_failed",
      };
    }
  }

  // -------------------------------------------------------------------------
  // NLP fallback path
  // -------------------------------------------------------------------------

  async function handleWithNlp(
    companyId: string,
    text: string,
    lang: "ar" | "en",
  ): Promise<CofounderResponse> {
    const parsed = await nlpService.parseCommand(text, lang);
    // Map a small set of intents to read-only tools so the user gets data.
    if (parsed.intent === "show_report") {
      const summary = await executeTool(companyId, "get_financial_summary", {});
      return {
        reply: formatFinancialSummary(summary, lang),
        actionsTaken: [
          {
            name: "get_financial_summary",
            summary: shortSummary("get_financial_summary", lang),
            result: summary,
          },
        ],
        language: lang,
        sessionId: "",
      };
    }
    if (parsed.intent === "find_entity") {
      const q =
        typeof (parsed.entities as Record<string, unknown>).query === "string"
          ? ((parsed.entities as Record<string, unknown>).query as string)
          : text;
      const res = await executeTool(companyId, "search_entities", { query: q });
      return {
        reply:
          lang === "ar"
            ? `وجدت ${(res as { items?: unknown[] }).items?.length ?? 0} نتيجة.`
            : `Found ${(res as { items?: unknown[] }).items?.length ?? 0} matches.`,
        actionsTaken: [
          {
            name: "search_entities",
            summary: shortSummary("search_entities", lang),
            result: res,
          },
        ],
        language: lang,
        sessionId: "",
      };
    }
    // Default canned response
    const reply =
      lang === "ar"
        ? "تم استلام الرسالة. الذكاء الاصطناعي غير مفعّل حالياً، لذا لا أستطيع الرد بحرية. جرّب أوامر مثل: «التقرير المالي»، «الفواتير المتأخرة»، «حالة المخزون»."
        : "Got your message. The AI is not configured right now, so I can't reply freely. Try: 'financial summary', 'overdue invoices', 'inventory alerts'.";
    return {
      reply,
      actionsTaken: [],
      language: lang,
      sessionId: "",
    };
  }

  // -------------------------------------------------------------------------
  // Proactive briefs
  // -------------------------------------------------------------------------

  async function sendDailyBrief(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderResponse> {
    const owner = (await loadOwnerPhones(companyId)).find(
      (o) => o.userPhone === userPhone,
    );
    const lang = owner?.lang ?? "en";
    const summary = (await executeTool(companyId, "get_financial_summary", {
      period: "yesterday",
    })) as Record<string, unknown>;
    const overdue = (await executeTool(
      companyId,
      "get_outstanding_invoices",
      { limit: 5 },
    )) as { count?: number; totalCents?: number };
    const inventory = (await executeTool(
      companyId,
      "get_inventory_alerts",
      {},
    )) as { lowStockCount?: number };
    const helpdesk = (await executeTool(companyId, "get_helpdesk_status", {})) as {
      openTickets?: number;
      slaBreaches?: number;
    };
    const ownerName = owner?.userUserId ? "" : "";
    const greeting =
      lang === "ar"
        ? `☀️ صباح الخير${ownerName ? "، " + ownerName : ""}`
        : `☀️ Good morning${ownerName ? ", " + ownerName : ""}`;
    const rev = ((summary.revenueCents as number) ?? 0) / 100;
    const exp = ((summary.expensesCents as number) ?? 0) / 100;
    const lines: string[] = [greeting];
    if (lang === "ar") {
      lines.push("📊 *ملخص أمس:*");
      lines.push(`💰 الإيرادات: ${rev.toLocaleString()}`);
      lines.push(`💸 المصاريف: ${exp.toLocaleString()}`);
      if ((overdue.count ?? 0) > 0) {
        lines.push(
          `⚠️ ${overdue.count} فواتير متأخرة بقيمة ${((overdue.totalCents ?? 0) / 100).toLocaleString()}`,
        );
      }
      if ((inventory.lowStockCount ?? 0) > 0) {
        lines.push(`📦 ${inventory.lowStockCount} منتج تحت الحد الأدنى`);
      }
      if ((helpdesk.slaBreaches ?? 0) > 0) {
        lines.push(`🎫 ${helpdesk.slaBreaches} تذكرة خارج SLA`);
      }
      lines.push("");
      lines.push("ماذا تريد أن نعمله اليوم؟");
    } else {
      lines.push("📊 *Yesterday's summary:*");
      lines.push(`💰 Revenue: ${rev.toLocaleString()}`);
      lines.push(`💸 Expenses: ${exp.toLocaleString()}`);
      if ((overdue.count ?? 0) > 0) {
        lines.push(
          `⚠️ ${overdue.count} overdue invoices totaling ${((overdue.totalCents ?? 0) / 100).toLocaleString()}`,
        );
      }
      if ((inventory.lowStockCount ?? 0) > 0) {
        lines.push(`📦 ${inventory.lowStockCount} products below reorder`);
      }
      if ((helpdesk.slaBreaches ?? 0) > 0) {
        lines.push(`🎫 ${helpdesk.slaBreaches} tickets past SLA`);
      }
      lines.push("");
      lines.push("What would you like to tackle today?");
    }
    const reply = lines.join("\n");

    // Best-effort WhatsApp push
    if (whatsappService && whatsappService.isConfigured()) {
      try {
        await whatsappService.sendText(userPhone, reply);
      } catch {
        // ignore — the response is still returned for inspection
      }
    }
    // Mark as sent in owner state
    await updateOwnerPhoneState(companyId, userPhone, {
      lastDailyBriefSentAt: new Date().toISOString(),
    });
    return {
      reply,
      actionsTaken: [
        { name: "get_financial_summary", summary: "summary", result: summary },
      ],
      language: lang,
      sessionId: "",
    };
  }

  async function sendWeeklyReport(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderResponse> {
    const owner = (await loadOwnerPhones(companyId)).find(
      (o) => o.userPhone === userPhone,
    );
    const lang = owner?.lang ?? "en";
    const analyst = (await executeTool(companyId, "run_analyst_report", {})) as {
      kpis?: { revenueCents?: number; expensesCents?: number; netIncomeCents?: number };
      summary?: string;
      summaryAr?: string;
      anomalies?: Array<{ title?: string; severity?: string }>;
      opportunities?: Array<{ title?: string }>;
    };
    const kpis = analyst.kpis ?? {};
    const lines: string[] = [];
    if (lang === "ar") {
      lines.push("📈 *تقرير الأسبوع*");
      lines.push(
        `💰 الإيرادات: ${(((kpis.revenueCents ?? 0) as number) / 100).toLocaleString()}`,
      );
      lines.push(
        `💸 المصاريف: ${(((kpis.expensesCents ?? 0) as number) / 100).toLocaleString()}`,
      );
      lines.push(
        `📊 صافي الربح: ${(((kpis.netIncomeCents ?? 0) as number) / 100).toLocaleString()}`,
      );
      if (analyst.anomalies && analyst.anomalies.length > 0) {
        lines.push("");
        lines.push("⚠️ تنبيهات:");
        for (const a of analyst.anomalies.slice(0, 3)) {
          lines.push(`• ${a.title}`);
        }
      }
      if (analyst.opportunities && analyst.opportunities.length > 0) {
        lines.push("");
        lines.push("💡 فرص:");
        for (const o of analyst.opportunities.slice(0, 3)) {
          lines.push(`• ${o.title}`);
        }
      }
      if (analyst.summaryAr) {
        lines.push("");
        lines.push(analyst.summaryAr);
      }
    } else {
      lines.push("📈 *Weekly report*");
      lines.push(
        `💰 Revenue: ${(((kpis.revenueCents ?? 0) as number) / 100).toLocaleString()}`,
      );
      lines.push(
        `💸 Expenses: ${(((kpis.expensesCents ?? 0) as number) / 100).toLocaleString()}`,
      );
      lines.push(
        `📊 Net: ${(((kpis.netIncomeCents ?? 0) as number) / 100).toLocaleString()}`,
      );
      if (analyst.anomalies && analyst.anomalies.length > 0) {
        lines.push("");
        lines.push("⚠️ Alerts:");
        for (const a of analyst.anomalies.slice(0, 3)) {
          lines.push(`• ${a.title}`);
        }
      }
      if (analyst.opportunities && analyst.opportunities.length > 0) {
        lines.push("");
        lines.push("💡 Opportunities:");
        for (const o of analyst.opportunities.slice(0, 3)) {
          lines.push(`• ${o.title}`);
        }
      }
      if (analyst.summary) {
        lines.push("");
        lines.push(analyst.summary);
      }
    }
    const reply = lines.join("\n");
    if (whatsappService && whatsappService.isConfigured()) {
      try {
        await whatsappService.sendText(userPhone, reply);
      } catch {
        // ignore
      }
    }
    await updateOwnerPhoneState(companyId, userPhone, {
      lastWeeklyReportSentAt: new Date().toISOString(),
    });
    return {
      reply,
      actionsTaken: [
        { name: "run_analyst_report", summary: "weekly analyst", result: analyst },
      ],
      language: lang,
      sessionId: "",
    };
  }

  // -------------------------------------------------------------------------
  // Public list/clear
  // -------------------------------------------------------------------------

  async function getSession(
    companyId: string,
    userPhone: string,
  ): Promise<CofounderSession | null> {
    return loadSessionRow(companyId, userPhone);
  }

  async function clearSession(
    companyId: string,
    userPhone: string,
  ): Promise<void> {
    const code = sessionCode(userPhone);
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, COFOUNDER_MODULE_KEY),
          eq(businessEntities.entityType, SESSION_ENTITY_TYPE),
          eq(businessEntities.code, code),
        ),
      );
  }

  async function listSessions(
    companyId: string,
  ): Promise<CofounderSession[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, COFOUNDER_MODULE_KEY),
          eq(businessEntities.entityType, SESSION_ENTITY_TYPE),
        ),
      )
      .orderBy(desc(businessEntities.updatedAt))
      .limit(200);
    return rows.map((row) => {
      const data = (row.data ?? {}) as Record<string, unknown>;
      const messages = Array.isArray(data.messages)
        ? (data.messages as CofounderMessage[])
        : [];
      return {
        id: row.id,
        companyId,
        userPhone:
          typeof data.userPhone === "string" ? (data.userPhone as string) : "",
        userUserId:
          typeof data.userUserId === "string"
            ? (data.userUserId as string)
            : undefined,
        language:
          data.language === "ar" || data.language === "en"
            ? (data.language as "ar" | "en")
            : "en",
        messages,
        lastActivityAt:
          typeof data.lastActivityAt === "string"
            ? (data.lastActivityAt as string)
            : row.updatedAt instanceof Date
              ? row.updatedAt.toISOString()
              : new Date().toISOString(),
        pendingConfirmation:
          data.pendingConfirmation && typeof data.pendingConfirmation === "object"
            ? (data.pendingConfirmation as CofounderPendingConfirmation)
            : undefined,
      };
    });
  }

  return {
    handleMessage,
    getSession,
    clearSession,
    listSessions,
    sendDailyBrief,
    sendWeeklyReport,
    registerOwnerPhone,
    unregisterOwnerPhone,
    listOwnerPhones: loadOwnerPhones,
    updateOwnerPhoneState,
    isOwnerPhone,
    listAllOwnerPhones,
    listTools: publicToolList,
    resolveCompanyForOwnerPhone,
  };
}

export type AiCofounderServiceType = AiCofounderService;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function shortSummary(toolName: string, lang: "ar" | "en"): string {
  const map: Record<string, { ar: string; en: string }> = {
    get_financial_summary: {
      ar: "ملخص مالي",
      en: "Financial summary",
    },
    get_pipeline_status: { ar: "حالة المبيعات", en: "Pipeline status" },
    get_outstanding_invoices: {
      ar: "الفواتير المستحقة",
      en: "Outstanding invoices",
    },
    get_top_customers: { ar: "أفضل العملاء", en: "Top customers" },
    get_top_products: { ar: "أفضل المنتجات", en: "Top products" },
    get_team_status: { ar: "حالة الفريق", en: "Team status" },
    get_inventory_alerts: { ar: "تنبيهات المخزون", en: "Inventory alerts" },
    get_helpdesk_status: { ar: "حالة الدعم", en: "Helpdesk status" },
    run_analyst_report: { ar: "تقرير المحلل", en: "Analyst report" },
    get_cash_position: { ar: "وضع النقد", en: "Cash position" },
    search_entities: { ar: "بحث", en: "Search" },
    get_business_health_score: { ar: "صحة الأعمال", en: "Business health" },
    send_invoice_reminder: { ar: "تذكير فواتير", en: "Invoice reminders" },
    create_invoice: { ar: "إنشاء فاتورة", en: "Create invoice" },
    mark_invoice_paid: { ar: "تعليم فاتورة", en: "Mark invoice paid" },
    create_expense: { ar: "إضافة مصروف", en: "Create expense" },
    assign_ticket_to_agent: { ar: "إسناد تذكرة", en: "Assign ticket" },
    schedule_follow_up_task: { ar: "متابعة", en: "Schedule follow-up" },
    create_marketing_campaign: {
      ar: "حملة تسويق",
      en: "Marketing campaign",
    },
    send_whatsapp_to_customer: {
      ar: "إرسال WhatsApp",
      en: "Send WhatsApp",
    },
    generate_pdf_report: { ar: "تقرير PDF", en: "PDF report" },
    export_data_csv: { ar: "تصدير CSV", en: "CSV export" },
  };
  return map[toolName]?.[lang] ?? toolName;
}

function confirmationQuestion(
  spec: ToolSpec,
  args: Record<string, unknown>,
  lang: "ar" | "en",
): string {
  const argStr = JSON.stringify(args);
  if (lang === "ar") {
    return `سأقوم بـ «${spec.descriptionAr}» بهذه المعطيات: ${argStr}. هل أتابع؟ (نعم/لا)`;
  }
  return `I'm about to "${spec.description}" with: ${argStr}. Proceed? (yes/no)`;
}

function summarizeToolResult(
  toolName: string,
  result: unknown,
  lang: "ar" | "en",
): string {
  const label = shortSummary(toolName, lang);
  if (toolName === "get_financial_summary") {
    return formatFinancialSummary(result, lang);
  }
  if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
    const err = (result as Record<string, unknown>).error;
    return lang === "ar" ? `❌ ${label}: ${err}` : `❌ ${label}: ${err}`;
  }
  return `${label}: ${JSON.stringify(result).slice(0, 500)}`;
}

function formatFinancialSummary(result: unknown, lang: "ar" | "en"): string {
  const r = (result as Record<string, unknown>) ?? {};
  const rev = ((r.revenueCents as number) ?? 0) / 100;
  const exp = ((r.expensesCents as number) ?? 0) / 100;
  const net = ((r.netProfitCents as number) ?? 0) / 100;
  const over = ((r.overdueInvoiceCents as number) ?? 0) / 100;
  if (lang === "ar") {
    const lines = [
      "📊 *ملخص مالي*",
      `💰 الإيرادات: ${rev.toLocaleString()}`,
      `💸 المصاريف: ${exp.toLocaleString()}`,
      `📈 صافي الربح: ${net.toLocaleString()}`,
    ];
    if (over > 0) lines.push(`⚠️ متأخر: ${over.toLocaleString()}`);
    return lines.join("\n");
  }
  const lines = [
    "📊 *Financial summary*",
    `💰 Revenue: ${rev.toLocaleString()}`,
    `💸 Expenses: ${exp.toLocaleString()}`,
    `📈 Net profit: ${net.toLocaleString()}`,
  ];
  if (over > 0) lines.push(`⚠️ Overdue: ${over.toLocaleString()}`);
  return lines.join("\n");
}

function formatToolResultsFallback(
  toolMessages: CofounderMessage[],
  lang: "ar" | "en",
): string {
  const lines: string[] = [];
  for (const t of toolMessages) {
    try {
      const parsed = JSON.parse(t.content) as {
        tool?: string;
        result?: unknown;
      };
      if (parsed.tool) {
        lines.push(
          `${shortSummary(parsed.tool, lang)}: ${JSON.stringify(parsed.result).slice(0, 200)}`,
        );
      }
    } catch {
      // ignore
    }
  }
  return lines.length > 0
    ? lines.join("\n")
    : lang === "ar"
      ? "تم تنفيذ المطلوب."
      : "Done.";
}

// ---------------------------------------------------------------------------
// Time helpers for proactive engine
// ---------------------------------------------------------------------------

export function kuwaitHourMinuteNow(now: Date = new Date()): {
  hour: number;
  minute: number;
  weekday: number;
  iso: string;
} {
  const utcMs = now.getTime() + KUWAIT_TZ_OFFSET_HOURS * 3600 * 1000;
  const k = new Date(utcMs);
  return {
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
    weekday: k.getUTCDay(),
    iso: k.toISOString(),
  };
}

export function isSameKuwaitDay(a: string | undefined, now: Date): boolean {
  if (!a) return false;
  const aDate = new Date(a);
  const aK = new Date(aDate.getTime() + KUWAIT_TZ_OFFSET_HOURS * 3600 * 1000);
  const nK = new Date(now.getTime() + KUWAIT_TZ_OFFSET_HOURS * 3600 * 1000);
  return (
    aK.getUTCFullYear() === nK.getUTCFullYear() &&
    aK.getUTCMonth() === nK.getUTCMonth() &&
    aK.getUTCDate() === nK.getUTCDate()
  );
}
