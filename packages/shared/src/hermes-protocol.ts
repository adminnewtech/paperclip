/**
 * Hermes Agent Framework — protocol type definitions.
 *
 * Hermes is an external AI agent framework that Paperclip bridges into the
 * workspace. This file declares the wire-format types used by the bridge
 * service, HTTP client, and webhook receiver.
 *
 * The protocol is intentionally minimal so the same shapes can be used by
 * the mock implementation (in dev) and the real HTTP client (in prod).
 */

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export const HERMES_CAPABILITIES = [
  "code_generation",
  "code_review",
  "research",
  "data_analysis",
  "writing",
  "translation",
  "image_generation",
  "voice_synthesis",
] as const;

export type HermesCapability = (typeof HERMES_CAPABILITIES)[number];

// ---------------------------------------------------------------------------
// Agent info
// ---------------------------------------------------------------------------

export type HermesAgentStatus = "active" | "idle" | "busy" | "offline";

export type HermesModelTier = "haiku" | "sonnet" | "opus";

export interface HermesAgentInfo {
  /** Unique ID assigned by the Hermes service. */
  id: string;
  name: string;
  nameAr?: string;
  /** Emoji glyph or remote avatar URL. */
  avatar?: string;
  description?: string;
  /** Free-form list; commonly drawn from {@link HERMES_CAPABILITIES}. */
  capabilities: string[];
  modelTier?: HermesModelTier;
  status: HermesAgentStatus;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface HermesTaskRequest {
  taskId: string;
  agentId: string;
  prompt: string;
  promptAr?: string;
  context?: Record<string, unknown>;
  /** ISO timestamp the requester would like a response by. */
  expectsResponseBy?: string;
  /** Paperclip webhook URL where Hermes should POST replies. */
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export type HermesTaskStatus =
  | "completed"
  | "failed"
  | "in_progress"
  | "needs_input";

export interface HermesTaskAction {
  type: string;
  payload: Record<string, unknown>;
}

export interface HermesTaskResponse {
  taskId: string;
  agentId: string;
  status: HermesTaskStatus;
  output?: string;
  outputAr?: string;
  actions?: HermesTaskAction[];
  needsInput?: {
    question: string;
    questionAr?: string;
    suggestedAnswers?: string[];
  };
  metadata?: Record<string, unknown>;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

export type HermesWebhookEventType =
  | "agent_status"
  | "task_response"
  | "agent_message"
  | "agent_action";

export interface HermesAgentMessagePayload {
  agentId: string;
  channelSlug: string;
  body: string;
  bodyAr?: string;
}

export interface HermesAgentActionPayload {
  agentId: string;
  action: string;
  payload: Record<string, unknown>;
}

export type HermesWebhookEventData =
  | HermesAgentInfo
  | HermesTaskResponse
  | HermesAgentMessagePayload
  | HermesAgentActionPayload;

export interface HermesWebhookEvent {
  eventType: HermesWebhookEventType;
  timestamp: string;
  data: HermesWebhookEventData;
  signature?: string;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isHermesAgentInfo(
  value: unknown,
): value is HermesAgentInfo {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.capabilities)
  );
}

export function isHermesTaskResponse(
  value: unknown,
): value is HermesTaskResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.taskId === "string" && typeof v.agentId === "string";
}

export function isHermesAgentMessagePayload(
  value: unknown,
): value is HermesAgentMessagePayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.agentId === "string" &&
    typeof v.channelSlug === "string" &&
    typeof v.body === "string"
  );
}

export function isHermesAgentActionPayload(
  value: unknown,
): value is HermesAgentActionPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.agentId === "string" && typeof v.action === "string";
}
