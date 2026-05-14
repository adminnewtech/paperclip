// ---------------------------------------------------------------------------
// Hermes API client
// ---------------------------------------------------------------------------
//
// HTTP client for the external Hermes agent framework. Production calls go
// out via `fetch` with a bearer token. When env vars are missing, the
// service falls back to a deterministic mock that returns realistic agents
// and simulates task execution by posting back to the configured webhook
// after a short delay — useful for local development and end-to-end tests.
//
// Expected env vars:
//
//   HERMES_API_URL          Base URL of the Hermes service (e.g. https://hermes.example.com)
//   HERMES_API_KEY          Bearer token for authenticated requests
//   HERMES_WEBHOOK_SECRET   HMAC-SHA256 secret used to validate incoming webhooks
//   HERMES_ORG_ID           Optional organization scope hint passed on every request
//
// All inbound webhook validation is performed in the route layer; this
// module merely exposes `validateWebhookSignature` so the receiver code can
// share a single canonical implementation.
//

import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

import type {
  HermesAgentInfo,
  HermesTaskRequest,
  HermesTaskResponse,
  HermesWebhookEvent,
} from "@paperclipai/shared";

import { logger } from "../../middleware/logger.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface HermesClientConfig {
  baseUrl: string;
  apiKey?: string;
  webhookSecret?: string;
  organizationId?: string;
}

export interface HermesClient {
  isConfigured(): boolean;
  config(): { baseUrl: string; orgId?: string; configured: boolean };

  /** Discovery */
  listAgents(): Promise<HermesAgentInfo[]>;
  getAgent(agentId: string): Promise<HermesAgentInfo | null>;

  /** Tasks */
  delegateTask(req: HermesTaskRequest): Promise<{ taskId: string; status: string }>;
  getTask(taskId: string): Promise<HermesTaskResponse | null>;
  cancelTask(taskId: string): Promise<void>;

  /** Webhook signature validation */
  validateWebhookSignature(
    headers: Record<string, string>,
    body: Buffer | string,
  ): boolean;
}

// ---------------------------------------------------------------------------
// Mock agent fixtures
// ---------------------------------------------------------------------------

const MOCK_AGENTS: HermesAgentInfo[] = [
  {
    id: "hermes-code-001",
    name: "Hermes-Code",
    nameAr: "هرمس-كود",
    avatar: "💻",
    description:
      "Senior engineering agent skilled in code generation, refactoring, and review.",
    capabilities: ["code_generation", "code_review"],
    modelTier: "opus",
    status: "active",
  },
  {
    id: "hermes-analyst-001",
    name: "Hermes-Analyst",
    nameAr: "هرمس-المحلل",
    avatar: "📊",
    description:
      "Data analyst that turns spreadsheets and database extracts into actionable insights.",
    capabilities: ["data_analysis", "research"],
    modelTier: "sonnet",
    status: "active",
  },
  {
    id: "hermes-writer-001",
    name: "Hermes-Writer",
    nameAr: "هرمس-الكاتب",
    avatar: "✍️",
    description:
      "Bilingual writing agent for marketing copy, internal docs, and translation.",
    capabilities: ["writing", "translation"],
    modelTier: "sonnet",
    status: "idle",
  },
];

// ---------------------------------------------------------------------------
// Mock task simulation
// ---------------------------------------------------------------------------

interface MockTaskState {
  request: HermesTaskRequest;
  response: HermesTaskResponse;
  createdAt: number;
  completedAt: number;
}

const mockTasks = new Map<string, MockTaskState>();

function simulateMockResponse(
  req: HermesTaskRequest,
  agent: HermesAgentInfo | undefined,
): HermesTaskResponse {
  const agentName = agent?.name ?? req.agentId;
  const preview = req.prompt.slice(0, 160);
  return {
    taskId: req.taskId,
    agentId: req.agentId,
    status: "completed",
    output: `[${agentName} mock] Completed task: ${preview}${preview.length === 160 ? "…" : ""}`,
    outputAr: req.promptAr
      ? `[${agent?.nameAr ?? agentName} محاكاة] اكتملت المهمة`
      : undefined,
    metadata: { mock: true, ...(req.metadata ?? {}) },
    completedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function readEnvConfig(): HermesClientConfig {
  const baseUrl = process.env.HERMES_API_URL?.trim() ?? "";
  const apiKey = process.env.HERMES_API_KEY?.trim();
  const webhookSecret = process.env.HERMES_WEBHOOK_SECRET?.trim();
  const organizationId = process.env.HERMES_ORG_ID?.trim();
  return {
    baseUrl,
    apiKey: apiKey || undefined,
    webhookSecret: webhookSecret || undefined,
    organizationId: organizationId || undefined,
  };
}

export function createHermesClient(
  overrides: Partial<HermesClientConfig> = {},
): HermesClient {
  const env = readEnvConfig();
  const cfg: HermesClientConfig = {
    baseUrl: overrides.baseUrl ?? env.baseUrl,
    apiKey: overrides.apiKey ?? env.apiKey,
    webhookSecret: overrides.webhookSecret ?? env.webhookSecret,
    organizationId: overrides.organizationId ?? env.organizationId,
  };

  const isReal = Boolean(cfg.baseUrl && cfg.apiKey);

  // Optional callback hook so tests can replace `setTimeout`-driven simulations.
  // Real path: live HTTP requests.

  function authHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (cfg.apiKey) h["authorization"] = `Bearer ${cfg.apiKey}`;
    if (cfg.organizationId) h["x-hermes-org"] = cfg.organizationId;
    return h;
  }

  async function httpJson<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${cfg.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Hermes ${method} ${path} failed (${res.status}): ${text || res.statusText}`,
      );
    }
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }

  function validateWebhookSignature(
    headers: Record<string, string>,
    body: Buffer | string,
  ): boolean {
    if (!cfg.webhookSecret) {
      logger.warn(
        "[hermes] validateWebhookSignature: HERMES_WEBHOOK_SECRET not set; accepting",
      );
      return true;
    }
    const sig =
      headers["x-hermes-signature"] ??
      headers["X-Hermes-Signature"] ??
      headers["x-signature"];
    if (!sig) return false;
    const expected = crypto
      .createHmac("sha256", cfg.webhookSecret)
      .update(body)
      .digest("hex");
    const provided = sig.startsWith("sha256=")
      ? sig.slice("sha256=".length)
      : sig;
    try {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(provided, "hex");
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  if (isReal) {
    return {
      isConfigured() {
        return true;
      },
      config() {
        return {
          baseUrl: cfg.baseUrl,
          orgId: cfg.organizationId,
          configured: true,
        };
      },
      async listAgents() {
        const data = await httpJson<{ agents: HermesAgentInfo[] }>(
          "GET",
          "/agents",
        );
        return Array.isArray(data?.agents) ? data.agents : [];
      },
      async getAgent(agentId: string) {
        try {
          return await httpJson<HermesAgentInfo>(
            "GET",
            `/agents/${encodeURIComponent(agentId)}`,
          );
        } catch (err) {
          logger.warn({ err, agentId }, "[hermes] getAgent failed");
          return null;
        }
      },
      async delegateTask(req: HermesTaskRequest) {
        return httpJson<{ taskId: string; status: string }>(
          "POST",
          "/tasks",
          req,
        );
      },
      async getTask(taskId: string) {
        try {
          return await httpJson<HermesTaskResponse>(
            "GET",
            `/tasks/${encodeURIComponent(taskId)}`,
          );
        } catch (err) {
          logger.warn({ err, taskId }, "[hermes] getTask failed");
          return null;
        }
      },
      async cancelTask(taskId: string) {
        await httpJson<void>(
          "POST",
          `/tasks/${encodeURIComponent(taskId)}/cancel`,
        );
      },
      validateWebhookSignature,
    };
  }

  // -------------------------------------------------------------------------
  // Mock client
  // -------------------------------------------------------------------------

  function emitMockCallback(taskId: string) {
    const state = mockTasks.get(taskId);
    if (!state) return;
    const callbackUrl = state.request.callbackUrl;
    if (!callbackUrl) return;
    const event: HermesWebhookEvent = {
      eventType: "task_response",
      timestamp: new Date().toISOString(),
      data: state.response,
    };
    // Fire-and-forget; in tests `callbackUrl` is typically empty so this
    // never runs. We log and swallow errors so dev never crashes.
    fetch(callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    }).catch((err) => {
      logger.warn({ err, taskId }, "[hermes mock] callback delivery failed");
    });
  }

  return {
    isConfigured() {
      return false;
    },
    config() {
      return {
        baseUrl: cfg.baseUrl || "(mock)",
        orgId: cfg.organizationId,
        configured: false,
      };
    },
    async listAgents() {
      return MOCK_AGENTS.map((a) => ({ ...a }));
    },
    async getAgent(agentId: string) {
      const found = MOCK_AGENTS.find((a) => a.id === agentId);
      return found ? { ...found } : null;
    },
    async delegateTask(req: HermesTaskRequest) {
      const agent = MOCK_AGENTS.find((a) => a.id === req.agentId);
      const taskId = req.taskId || `mock-task-${randomUUID()}`;
      const response = simulateMockResponse({ ...req, taskId }, agent);
      const state: MockTaskState = {
        request: { ...req, taskId },
        response,
        createdAt: Date.now(),
        completedAt: Date.now() + 2000,
      };
      mockTasks.set(taskId, state);
      const delayMs = 2000 + Math.floor(Math.random() * 3000);
      setTimeout(() => emitMockCallback(taskId), delayMs).unref?.();
      logger.info(
        { taskId, agentId: req.agentId, delayMs },
        "[hermes mock] task accepted",
      );
      return { taskId, status: "in_progress" };
    },
    async getTask(taskId: string) {
      const state = mockTasks.get(taskId);
      return state ? { ...state.response } : null;
    },
    async cancelTask(taskId: string) {
      mockTasks.delete(taskId);
    },
    validateWebhookSignature,
  };
}
