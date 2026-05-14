/**
 * Agent Response service.
 *
 * Handles @mentions of the 5 business agents in workspace channels.
 *
 * For each handled mention:
 *   1. Detect the message language (very lightweight Arabic/English split).
 *   2. Generate a response in the matching language using the Claude SDK
 *      (lazy import, gated by ANTHROPIC_API_KEY).
 *   3. Fall back to a deterministic mock response based on the agent's
 *      persona + keyword-based intent detection when the LLM is offline.
 *   4. Post the response via the AiMembersService (which forwards to the
 *      workspace MessagePoster).
 *   5. Briefly mark the agent as "busy" while drafting, then back to idle.
 *
 * The handler does NOT need to be called from P11-A directly — that wiring
 * is owned by P11-D / follow-up work. We expose it as a REST endpoint so
 * the UI and tests can drive it explicitly.
 */

import type { Db } from "@paperclipai/db";
import {
  getBusinessAgentDefinition,
  type BusinessAgentDefinition,
} from "@paperclipai/shared";
import { logger } from "../../middleware/logger.js";
import type { AiMembersService } from "./ai-members-service.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IncomingMention {
  /** ID of the message that contained the @mention. */
  id: string;
  channelId: string;
  channelSlug: string;
  body: string;
  bodyAr?: string;
  authorId: string;
  mentionedAgentSlug: string;
  threadRootId?: string;
}

export interface HandleMentionResult {
  replyMessageId?: string;
  skipped?: boolean;
  reason?: string;
}

export interface AgentResponseService {
  handleMention(
    companyId: string,
    message: IncomingMention,
  ): Promise<HandleMentionResult>;
  /**
   * Process a queue of pending mentions for a company. The current
   * implementation returns 0 because the persistent mention queue lives
   * in P11-A; once available, swap this for a real loop.
   */
  processPendingMentions(
    companyId: string,
  ): Promise<{ processed: number }>;
}

// ---------------------------------------------------------------------------
// Lazy LLM client (mirrors business-ai-service.ts)
// ---------------------------------------------------------------------------

interface LLMClient {
  complete(input: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string>;
}

let cachedClient: LLMClient | null | undefined;

async function getLLMClient(): Promise<LLMClient | null> {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length === 0) {
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
          messages: Array<{ role: "user"; content: string }>;
        }): Promise<{ content: Array<{ type: string; text?: string }> }>;
      };
    };
    cachedClient = {
      async complete({ system, user, maxTokens = 512, temperature = 0.3 }) {
        const response = await instance.messages.create({
          model: "claude-3-5-sonnet-latest",
          max_tokens: maxTokens,
          temperature,
          system,
          messages: [{ role: "user", content: user }],
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
// Mock response generator (used when LLM is offline)
// ---------------------------------------------------------------------------

const AR_LETTERS_RE = /[؀-ۿ]/;

export function detectLanguage(text: string): "ar" | "en" {
  return AR_LETTERS_RE.test(text) ? "ar" : "en";
}

interface MockResponse {
  bodyEn: string;
  bodyAr: string;
}

function mockResponseFor(
  def: BusinessAgentDefinition,
  body: string,
): MockResponse {
  const lower = body.toLowerCase();
  const persona = def.personaName;
  const personaAr = def.personaNameAr;

  // Lightweight intent detection — both EN keywords and AR equivalents.
  const isQuestion = /\?|؟|how|what|when|where|why|كيف|ما |متى|أين|لماذا/i.test(
    body,
  );
  const isThanks = /thank|thanks|شكر/i.test(lower);
  const isStatus = /status|update|progress|تقدم|حالة/i.test(lower);

  if (isThanks) {
    return {
      bodyEn: `You're welcome! I'm ${persona}, glad I could help. Ping me anytime.`,
      bodyAr: `العفو! أنا ${personaAr}، يسعدني المساعدة. راسلني في أي وقت.`,
    };
  }

  if (isStatus) {
    return {
      bodyEn: `${persona} here — I'll pull together the latest on ${def.modulesAccessed.join(", ")} and post a summary shortly.`,
      bodyAr: `أنا ${personaAr} — سأجهز ملخص آخر التحديثات حول ${def.modulesAccessed.join("، ")} وأنشره قريباً.`,
    };
  }

  if (isQuestion) {
    return {
      bodyEn: `${persona} on it. I'll dig into "${body.slice(0, 120)}" and reply with details.`,
      bodyAr: `${personaAr} على المهمة. سأبحث في "${body.slice(0, 120)}" وأرد بالتفاصيل.`,
    };
  }

  // Generic acknowledgement, tailored by responsibilities.
  const responsibility =
    def.responsibilities[0] ?? "your business needs";
  const responsibilityAr =
    def.responsibilitiesAr[0] ?? "احتياجات عملك";
  return {
    bodyEn: `Got it. As your ${def.title}, I'll take this into account next time I work on ${responsibility.toLowerCase()}.`,
    bodyAr: `تم. بصفتي ${def.titleAr}، سآخذ ذلك بعين الاعتبار في مهمتي القادمة المتعلقة بـ${responsibilityAr}.`,
  };
}

// ---------------------------------------------------------------------------
// LLM prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(def: BusinessAgentDefinition, lang: "ar" | "en"): string {
  if (lang === "ar") {
    return [
      `أنت ${def.personaNameAr}، ${def.titleAr} في الشركة.`,
      def.descriptionAr,
      "أنت تجيب على رسالة من زميل في قناة عمل. التزم بأسلوب موجز ومحدد.",
      "إذا كان السؤال خارج اختصاصك، اقترح زميلاً أنسب.",
    ].join("\n");
  }
  return [
    `You are ${def.personaName}, ${def.title} at the company.`,
    def.description,
    "You are replying to a teammate in a workspace channel. Be concise and specific.",
    "If the question is outside your remit, suggest a more appropriate teammate.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateAgentResponseServiceOpts {
  llmEnabled?: boolean;
}

export function createAgentResponseService(
  db: Db,
  aiMembers: AiMembersService,
  opts: CreateAgentResponseServiceOpts = {},
): AgentResponseService {
  // db is reserved for future persistence of conversation memory.
  void db;
  const llmEnabled = opts.llmEnabled ?? true;

  async function generateResponse(
    def: BusinessAgentDefinition,
    lang: "ar" | "en",
    body: string,
  ): Promise<MockResponse> {
    if (!llmEnabled) return mockResponseFor(def, body);
    const client = await getLLMClient();
    if (!client) return mockResponseFor(def, body);
    try {
      const system = buildSystemPrompt(def, lang);
      const reply = await client.complete({
        system,
        user: body,
        maxTokens: 400,
        temperature: 0.4,
      });
      const trimmed = reply.trim();
      if (trimmed.length === 0) return mockResponseFor(def, body);
      // We asked the model to reply in `lang`; we still produce the
      // alternate-language version via a heuristic mock so the workspace
      // always has both for RTL/LTR users.
      const mock = mockResponseFor(def, body);
      return lang === "ar"
        ? { bodyEn: mock.bodyEn, bodyAr: trimmed }
        : { bodyEn: trimmed, bodyAr: mock.bodyAr };
    } catch (err) {
      logger.warn(
        { err, agentSlug: def.slug },
        "agent-response: LLM call failed, falling back to mock",
      );
      return mockResponseFor(def, body);
    }
  }

  async function handleMention(
    companyId: string,
    message: IncomingMention,
  ): Promise<HandleMentionResult> {
    const def = getBusinessAgentDefinition(message.mentionedAgentSlug);
    if (!def) {
      return { skipped: true, reason: "Unknown agent slug" };
    }
    const text = message.body || message.bodyAr || "";
    if (!text.trim()) {
      return { skipped: true, reason: "Empty message body" };
    }

    const lang = detectLanguage(text);
    await aiMembers.setAgentBusy(
      companyId,
      def.slug,
      lang === "ar" ? "يصيغ ردًا..." : "Drafting a reply...",
    );

    let reply: MockResponse;
    try {
      reply = await generateResponse(def, lang, text);
    } catch (err) {
      logger.warn(
        { err, companyId, agentSlug: def.slug },
        "agent-response: generateResponse threw",
      );
      reply = mockResponseFor(def, text);
    }

    let posted: { id: string } | null = null;
    try {
      posted = await aiMembers.postAsAgent(
        companyId,
        def.slug,
        message.channelSlug,
        reply.bodyEn,
        {
          bodyAr: reply.bodyAr,
          threadRootId: message.threadRootId ?? message.id,
        },
      );
    } finally {
      await aiMembers.setAgentIdle(companyId, def.slug);
    }

    if (!posted) {
      return { skipped: true, reason: "No poster wired or post failed" };
    }
    return { replyMessageId: posted.id };
  }

  async function processPendingMentions(
    _companyId: string,
  ): Promise<{ processed: number }> {
    // The persistent mention queue lives in P11-A. When it lands, this
    // method should pull pending rows and call handleMention for each.
    return { processed: 0 };
  }

  return { handleMention, processPendingMentions };
}
