// ---------------------------------------------------------------------------
// Marketing Automation Service
// ---------------------------------------------------------------------------
//
// Implements a directed-step flow engine for marketing campaigns. Each flow
// is stored as a `businessEntities` row with moduleKey="marketing",
// entityType="flow". When a contact is enrolled into a flow, an enrollment
// row (moduleKey="marketing", entityType="enrollment", parentId=flow.id) is
// created, and a per-minute scheduler advances each enrollment through the
// flow's steps.
//
// Step execution dispatches to `BusinessMessagingService.sendTemplate` for
// `send_message` steps. When the messaging service is unavailable or throws,
// the failure is logged and recorded on the enrollment history — it does not
// kill the worker.
//
// Trigger handling:
//   - schedule: the scheduler ticks each minute and auto-enrolls the
//     audience.
//   - entity_created / entity_status_changed / tag_added: invoke
//     `notifyEntityEvent` from upstream code (e.g. business.ts mutations)
//     to enroll matching contacts. We don't wire those calls into the rest
//     of the codebase yet to keep this PR self-contained.
//   - manual: `triggerManualFlow` enrolls explicit contact ids.

import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  MARKETING_FLOW_TEMPLATES,
  getMarketingFlowTemplate,
  type FlowAudience,
  type FlowEnrollment,
  type FlowStep,
  type FlowTrigger,
  type MarketingFlow,
} from "@paperclipai/shared";
import {
  computeNextRun,
  parseSchedule,
} from "./business-automations-service.js";
import type { BusinessMessagingService } from "./business-messaging-service.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProcessResult {
  processed: number;
  errors: string[];
}

export interface MarketingAutomationService {
  listFlows(companyId: string): Promise<MarketingFlow[]>;
  getFlow(companyId: string, flowId: string): Promise<MarketingFlow | null>;
  createFlow(
    companyId: string,
    flow: Omit<MarketingFlow, "id" | "stats">,
  ): Promise<MarketingFlow>;
  updateFlow(
    companyId: string,
    flowId: string,
    updates: Partial<MarketingFlow>,
  ): Promise<MarketingFlow>;
  deleteFlow(companyId: string, flowId: string): Promise<void>;
  enableFlow(companyId: string, flowId: string): Promise<void>;
  disableFlow(companyId: string, flowId: string): Promise<void>;

  enrollContact(
    companyId: string,
    flowId: string,
    contactId: string,
  ): Promise<FlowEnrollment>;
  listEnrollments(
    companyId: string,
    flowId: string,
    opts?: { status?: string; limit?: number },
  ): Promise<FlowEnrollment[]>;

  processDueEnrollments(): Promise<ProcessResult>;
  triggerManualFlow(
    companyId: string,
    flowId: string,
    contactIds: string[],
  ): Promise<{ enrolledCount: number }>;

  /**
   * Notify the service that an entity event occurred. Enrolls audience
   * contacts on matching flows. Not currently wired into business.ts — call
   * this from future integrations as needed.
   */
  notifyEntityEvent(
    companyId: string,
    event: {
      kind: "entity_created" | "entity_status_changed" | "tag_added";
      moduleKey?: string;
      entityType?: string;
      toStatus?: string;
      tag?: string;
      contactId?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<{ enrolledCount: number }>;

  getFlowAnalytics(
    companyId: string,
    flowId: string,
  ): Promise<MarketingFlow["stats"]>;

  /** Stop the background scheduler (used in tests). */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_STATS: MarketingFlow["stats"] = {
  enrolledCount: 0,
  completedCount: 0,
  messagesSentCount: 0,
  deliveredCount: 0,
  failedCount: 0,
  revenueAttributedCents: 0,
};

function rowToFlow(row: typeof businessEntities.$inferSelect): MarketingFlow {
  const data = (row.data ?? {}) as Partial<MarketingFlow>;
  return {
    id: row.id,
    name: data.name ?? row.name ?? "Untitled flow",
    nameAr: data.nameAr,
    description: data.description,
    enabled: data.enabled ?? row.status === "active",
    trigger: data.trigger ?? { kind: "manual" },
    audience: data.audience ?? { source: "all_contacts" },
    steps: Array.isArray(data.steps) ? (data.steps as FlowStep[]) : [],
    stats: { ...EMPTY_STATS, ...(data.stats ?? {}) },
  };
}

function rowToEnrollment(
  row: typeof businessEntities.$inferSelect,
): FlowEnrollment {
  const data = (row.data ?? {}) as Partial<FlowEnrollment>;
  return {
    id: row.id,
    flowId: data.flowId ?? row.parentId ?? "",
    contactId: data.contactId ?? "",
    contactPhone: data.contactPhone,
    contactEmail: data.contactEmail,
    enrolledAt:
      data.enrolledAt ??
      (row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt)),
    currentStepIndex: data.currentStepIndex ?? 0,
    nextRunAt: data.nextRunAt,
    status:
      (data.status as FlowEnrollment["status"]) ??
      (row.status as FlowEnrollment["status"]) ??
      "active",
    history: Array.isArray(data.history) ? data.history : [],
  };
}

function evaluateBranch(
  field: string,
  op: string,
  value: unknown,
  context: Record<string, unknown>,
): boolean {
  const actual = context[field];
  switch (op) {
    case "eq":
      return actual === value;
    case "neq":
      return actual !== value;
    case "gt":
      return typeof actual === "number" &&
        typeof value === "number" &&
        actual > value;
    case "lt":
      return typeof actual === "number" &&
        typeof value === "number" &&
        actual < value;
    case "contains":
      return typeof actual === "string" &&
        typeof value === "string" &&
        actual.includes(value);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createMarketingAutomationService(
  db: Db,
  messagingService?: BusinessMessagingService,
  opts: { intervalMs?: number; autoStart?: boolean } = {},
): MarketingAutomationService {
  const intervalMs = opts.intervalMs ?? 60_000;
  let stopped = false;

  // -------------------------------------------------------------------------
  // Storage helpers
  // -------------------------------------------------------------------------

  async function loadFlowRow(companyId: string, flowId: string) {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, flowId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "marketing"),
          eq(businessEntities.entityType, "flow"),
        ),
      );
    return row ?? null;
  }

  async function persistFlow(
    flowRowId: string,
    payload: MarketingFlow,
  ): Promise<void> {
    await db
      .update(businessEntities)
      .set({
        name: payload.name,
        status: payload.enabled ? "active" : "inactive",
        data: payload,
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, flowRowId));
  }

  async function loadAudienceContactIds(
    companyId: string,
    audience: FlowAudience,
  ): Promise<string[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "contact"),
        ),
      );
    let filtered = rows;
    if (audience.source === "tag" && audience.tag) {
      const wanted = audience.tag;
      filtered = filtered.filter((r) => {
        const tags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
        return tags.includes(wanted);
      });
    } else if (audience.source === "filter" && audience.filter) {
      const f = audience.filter;
      filtered = filtered.filter((r) => {
        const data = (r.data ?? {}) as Record<string, unknown>;
        return evaluateBranch(f.field, f.op, f.value, {
          ...data,
          status: r.status,
          name: r.name,
        });
      });
    }
    return filtered.map((r) => r.id);
  }

  // -------------------------------------------------------------------------
  // Flow management
  // -------------------------------------------------------------------------

  async function listFlows(companyId: string): Promise<MarketingFlow[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "marketing"),
          eq(businessEntities.entityType, "flow"),
        ),
      )
      .orderBy(desc(businessEntities.updatedAt));
    return rows.map(rowToFlow);
  }

  async function getFlow(
    companyId: string,
    flowId: string,
  ): Promise<MarketingFlow | null> {
    const row = await loadFlowRow(companyId, flowId);
    return row ? rowToFlow(row) : null;
  }

  async function createFlow(
    companyId: string,
    flow: Omit<MarketingFlow, "id" | "stats">,
  ): Promise<MarketingFlow> {
    const now = new Date();
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "marketing",
        entityType: "flow",
        name: flow.name,
        status: flow.enabled ? "active" : "inactive",
        data: {
          ...flow,
          stats: { ...EMPTY_STATS },
        },
        tags: ["marketing", "flow"],
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to create flow");
    const finalFlow: MarketingFlow = {
      id: row.id,
      ...flow,
      stats: { ...EMPTY_STATS },
    };
    // Persist id back into the data column too so reads are self-describing.
    await persistFlow(row.id, finalFlow);
    return finalFlow;
  }

  async function updateFlow(
    companyId: string,
    flowId: string,
    updates: Partial<MarketingFlow>,
  ): Promise<MarketingFlow> {
    const row = await loadFlowRow(companyId, flowId);
    if (!row) throw new Error("Flow not found");
    const current = rowToFlow(row);
    const merged: MarketingFlow = {
      ...current,
      ...updates,
      id: current.id,
      stats: { ...current.stats, ...(updates.stats ?? {}) },
    };
    if (merged.trigger.kind === "schedule") {
      try {
        parseSchedule(merged.trigger.cron);
      } catch (err) {
        throw new Error(
          `Invalid schedule: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await persistFlow(row.id, merged);
    return merged;
  }

  async function deleteFlow(
    companyId: string,
    flowId: string,
  ): Promise<void> {
    // Delete enrollments first
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "marketing"),
          eq(businessEntities.entityType, "enrollment"),
          eq(businessEntities.parentId, flowId),
        ),
      );
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.id, flowId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "marketing"),
          eq(businessEntities.entityType, "flow"),
        ),
      );
  }

  async function enableFlow(
    companyId: string,
    flowId: string,
  ): Promise<void> {
    await updateFlow(companyId, flowId, { enabled: true });
  }
  async function disableFlow(
    companyId: string,
    flowId: string,
  ): Promise<void> {
    await updateFlow(companyId, flowId, { enabled: false });
  }

  // -------------------------------------------------------------------------
  // Enrollment
  // -------------------------------------------------------------------------

  async function loadContact(
    companyId: string,
    contactId: string,
  ): Promise<typeof businessEntities.$inferSelect | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, contactId),
          eq(businessEntities.companyId, companyId),
        ),
      );
    return row ?? null;
  }

  async function enrollContact(
    companyId: string,
    flowId: string,
    contactId: string,
  ): Promise<FlowEnrollment> {
    const flow = await getFlow(companyId, flowId);
    if (!flow) throw new Error("Flow not found");
    const contact = await loadContact(companyId, contactId);
    const data = (contact?.data ?? {}) as Record<string, unknown>;
    const phone =
      typeof data.phone === "string"
        ? data.phone
        : typeof data.mobile === "string"
          ? (data.mobile as string)
          : undefined;
    const email = typeof data.email === "string" ? data.email : undefined;
    const now = new Date();
    const enrollment: FlowEnrollment = {
      id: "",
      flowId,
      contactId,
      contactPhone: phone,
      contactEmail: email,
      enrolledAt: now.toISOString(),
      currentStepIndex: 0,
      nextRunAt: now.toISOString(),
      status: "active",
      history: [],
    };
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "marketing",
        entityType: "enrollment",
        parentId: flowId,
        status: "active",
        data: enrollment,
        tags: ["marketing", "enrollment"],
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to enroll contact");
    enrollment.id = row.id;
    await db
      .update(businessEntities)
      .set({ data: enrollment })
      .where(eq(businessEntities.id, row.id));
    // Bump stats
    await bumpFlowStats(flowId, { enrolledCount: 1 });
    return enrollment;
  }

  async function listEnrollments(
    companyId: string,
    flowId: string,
    opts?: { status?: string; limit?: number },
  ): Promise<FlowEnrollment[]> {
    const limit = Math.min(opts?.limit ?? 200, 1000);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "marketing"),
          eq(businessEntities.entityType, "enrollment"),
          eq(businessEntities.parentId, flowId),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit);
    let enrollments = rows.map(rowToEnrollment);
    if (opts?.status) {
      enrollments = enrollments.filter((e) => e.status === opts.status);
    }
    return enrollments;
  }

  async function bumpFlowStats(
    flowId: string,
    delta: Partial<MarketingFlow["stats"]>,
  ): Promise<void> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(eq(businessEntities.id, flowId));
    if (!row) return;
    const current = rowToFlow(row);
    const next: MarketingFlow["stats"] = {
      enrolledCount:
        current.stats.enrolledCount + (delta.enrolledCount ?? 0),
      completedCount:
        current.stats.completedCount + (delta.completedCount ?? 0),
      messagesSentCount:
        current.stats.messagesSentCount + (delta.messagesSentCount ?? 0),
      deliveredCount:
        current.stats.deliveredCount + (delta.deliveredCount ?? 0),
      failedCount: current.stats.failedCount + (delta.failedCount ?? 0),
      revenueAttributedCents:
        (current.stats.revenueAttributedCents ?? 0) +
        (delta.revenueAttributedCents ?? 0),
    };
    const updated: MarketingFlow = { ...current, stats: next };
    await db
      .update(businessEntities)
      .set({ data: updated, updatedAt: new Date() })
      .where(eq(businessEntities.id, flowId));
  }

  // -------------------------------------------------------------------------
  // Step execution
  // -------------------------------------------------------------------------

  async function executeStep(
    companyId: string,
    flow: MarketingFlow,
    enrollment: FlowEnrollment,
    step: FlowStep,
  ): Promise<{
    result: string;
    error?: string;
    nextRunAt?: string;
    advance?: number; // additional indices to consume (for branch)
    insertedSteps?: FlowStep[];
    statsDelta?: Partial<MarketingFlow["stats"]>;
    complete?: boolean;
  }> {
    if (step.kind === "send_message") {
      if (!messagingService) {
        return {
          result: "skipped",
          error: "Messaging service unavailable",
          statsDelta: { failedCount: 1 },
        };
      }
      const phone = enrollment.contactPhone;
      if (!phone) {
        return {
          result: "skipped",
          error: "Contact has no phone",
          statsDelta: { failedCount: 1 },
        };
      }
      try {
        const result = await messagingService.sendTemplate(
          companyId,
          step.templateKey,
          {
            channel: step.channel === "email" ? "sms" : step.channel,
            toPhone: phone,
            variables: {
              contactName: enrollment.contactId,
            },
            relatedEntityId: enrollment.contactId,
            lang: step.lang,
          },
        );
        if (result.ok) {
          return {
            result: "sent",
            statsDelta: {
              messagesSentCount: 1,
              deliveredCount: 1,
            },
          };
        }
        // eslint-disable-next-line no-console
        console.warn(
          "[marketing] send_message failed",
          step.templateKey,
          result.error,
        );
        return {
          result: "failed",
          error: result.error,
          statsDelta: { failedCount: 1 },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn("[marketing] send_message threw", message);
        return {
          result: "failed",
          error: message,
          statsDelta: { failedCount: 1 },
        };
      }
    }

    if (step.kind === "wait") {
      const nextRunAt = new Date(
        Date.now() + step.durationHours * 3600 * 1000,
      ).toISOString();
      return { result: `waited ${step.durationHours}h`, nextRunAt };
    }

    if (step.kind === "wait_until") {
      const now = new Date();
      const target = new Date(now);
      target.setHours(
        step.hourLocal,
        step.minuteLocal ?? 0,
        0,
        0,
      );
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      return {
        result: `wait_until ${step.hourLocal}:${step.minuteLocal ?? 0}`,
        nextRunAt: target.toISOString(),
      };
    }

    if (step.kind === "branch") {
      const contact = await loadContact(companyId, enrollment.contactId);
      const data = (contact?.data ?? {}) as Record<string, unknown>;
      const context = {
        ...data,
        status: contact?.status,
        name: contact?.name,
      };
      const passed = evaluateBranch(
        step.condition.field,
        step.condition.op,
        step.condition.value,
        context,
      );
      const inserted = passed ? step.then : step.else;
      return {
        result: passed ? "branch:then" : "branch:else",
        insertedSteps: inserted,
      };
    }

    if (step.kind === "tag_contact") {
      const contact = await loadContact(companyId, enrollment.contactId);
      if (contact) {
        const existing = Array.isArray(contact.tags)
          ? (contact.tags as string[])
          : [];
        if (!existing.includes(step.tag)) {
          await db
            .update(businessEntities)
            .set({
              tags: [...existing, step.tag],
              updatedAt: new Date(),
            })
            .where(eq(businessEntities.id, contact.id));
        }
      }
      return { result: `tagged:${step.tag}` };
    }

    if (step.kind === "create_ticket") {
      const now = new Date();
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: "helpdesk",
        entityType: "ticket",
        name: step.subject,
        status: "open",
        data: {
          subject: step.subject,
          priority: step.priority ?? "normal",
          source: "marketing_flow",
          flowId: flow.id,
          enrollmentId: enrollment.id,
          contactId: enrollment.contactId,
        },
        tags: ["marketing", "auto"],
        createdAt: now,
        updatedAt: now,
      });
      return { result: "ticket_created" };
    }

    if (step.kind === "stop") {
      return { result: "stopped", complete: true };
    }

    return { result: "unknown_step", error: "Unknown step kind" };
  }

  // -------------------------------------------------------------------------
  // Engine — process due enrollments
  // -------------------------------------------------------------------------

  async function processOneEnrollment(
    enrollmentRow: typeof businessEntities.$inferSelect,
  ): Promise<void> {
    const enrollment = rowToEnrollment(enrollmentRow);
    if (enrollment.status !== "active") return;
    const flowRow = await loadFlowRow(
      enrollmentRow.companyId,
      enrollment.flowId,
    );
    if (!flowRow) {
      // Orphaned enrollment; mark failed
      await db
        .update(businessEntities)
        .set({
          status: "failed",
          data: { ...enrollment, status: "failed" },
          updatedAt: new Date(),
        })
        .where(eq(businessEntities.id, enrollment.id));
      return;
    }
    const flow = rowToFlow(flowRow);
    if (!flow.enabled) {
      await db
        .update(businessEntities)
        .set({
          status: "paused",
          data: { ...enrollment, status: "paused" },
          updatedAt: new Date(),
        })
        .where(eq(businessEntities.id, enrollment.id));
      return;
    }

    // Steps can be "extended" mid-execution by branch: we keep a mutable
    // copy on the enrollment under `data.runtimeSteps`. Use it if present,
    // otherwise fall back to the flow's steps.
    const runtimeData = (enrollmentRow.data ?? {}) as Record<string, unknown>;
    const runtimeSteps =
      Array.isArray(runtimeData.runtimeSteps) &&
      (runtimeData.runtimeSteps as FlowStep[]).length > 0
        ? (runtimeData.runtimeSteps as FlowStep[])
        : flow.steps;

    if (enrollment.currentStepIndex >= runtimeSteps.length) {
      await markComplete(enrollment, flow.id);
      return;
    }

    const step = runtimeSteps[enrollment.currentStepIndex];
    if (!step) {
      await markComplete(enrollment, flow.id);
      return;
    }

    let outcome;
    try {
      outcome = await executeStep(
        enrollmentRow.companyId,
        flow,
        enrollment,
        step,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn("[marketing] step threw", message);
      outcome = { result: "error", error: message };
    }

    const now = new Date();
    const history = [
      ...enrollment.history,
      {
        stepIndex: enrollment.currentStepIndex,
        ranAt: now.toISOString(),
        result: outcome.result,
        ...(outcome.error ? { error: outcome.error } : {}),
      },
    ].slice(-200);

    // Compute next runtime steps
    let nextRuntimeSteps = runtimeSteps;
    let nextIndex = enrollment.currentStepIndex + 1;
    if (outcome.insertedSteps && outcome.insertedSteps.length > 0) {
      // Insert branch's inserted steps right after the current step
      nextRuntimeSteps = [
        ...runtimeSteps.slice(0, enrollment.currentStepIndex + 1),
        ...outcome.insertedSteps,
        ...runtimeSteps.slice(enrollment.currentStepIndex + 1),
      ];
    }

    const isLast = nextIndex >= nextRuntimeSteps.length;
    const complete = outcome.complete === true || isLast;
    const newStatus: FlowEnrollment["status"] = complete
      ? "completed"
      : "active";

    const nextRunAt = complete
      ? undefined
      : outcome.nextRunAt ?? now.toISOString();

    const updatedEnrollment: FlowEnrollment = {
      ...enrollment,
      currentStepIndex: nextIndex,
      nextRunAt,
      status: newStatus,
      history,
    };

    await db
      .update(businessEntities)
      .set({
        status: newStatus,
        data: { ...updatedEnrollment, runtimeSteps: nextRuntimeSteps },
        updatedAt: now,
      })
      .where(eq(businessEntities.id, enrollment.id));

    if (outcome.statsDelta) {
      await bumpFlowStats(flow.id, outcome.statsDelta);
    }
    if (complete) {
      await bumpFlowStats(flow.id, { completedCount: 1 });
    }
  }

  async function markComplete(
    enrollment: FlowEnrollment,
    flowId: string,
  ): Promise<void> {
    await db
      .update(businessEntities)
      .set({
        status: "completed",
        data: { ...enrollment, status: "completed", nextRunAt: undefined },
        updatedAt: new Date(),
      })
      .where(eq(businessEntities.id, enrollment.id));
    await bumpFlowStats(flowId, { completedCount: 1 });
  }

  async function processDueEnrollments(): Promise<ProcessResult> {
    const errors: string[] = [];
    let processed = 0;
    try {
      const nowIso = new Date().toISOString();
      // Find active enrollments whose nextRunAt has elapsed.
      const rows = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.moduleKey, "marketing"),
            eq(businessEntities.entityType, "enrollment"),
            eq(businessEntities.status, "active"),
            sql`coalesce(data->>'nextRunAt','1970-01-01') <= ${nowIso}`,
          ),
        )
        .limit(500);
      for (const row of rows) {
        try {
          await processOneEnrollment(row);
          processed += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`enrollment ${row.id}: ${message}`);
          // eslint-disable-next-line no-console
          console.warn(
            "[marketing] failed to process enrollment",
            row.id,
            message,
          );
        }
      }

      // Also tick scheduled flows: if cron next-run is past, auto-enroll
      await tickScheduledFlows();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`scheduler: ${message}`);
      // eslint-disable-next-line no-console
      console.warn("[marketing] scheduler tick failed", message);
    }
    return { processed, errors };
  }

  async function tickScheduledFlows(): Promise<void> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.moduleKey, "marketing"),
          eq(businessEntities.entityType, "flow"),
          eq(businessEntities.status, "active"),
        ),
      );
    const now = new Date();
    for (const row of rows) {
      const flow = rowToFlow(row);
      if (flow.trigger.kind !== "schedule") continue;
      const data = (row.data ?? {}) as Record<string, unknown>;
      const lastFiredAt =
        typeof data.lastFiredAt === "string"
          ? new Date(data.lastFiredAt)
          : null;
      let nextDue: Date | null = null;
      try {
        nextDue = computeNextRun(
          flow.trigger.cron,
          lastFiredAt ?? new Date(0),
        );
      } catch {
        nextDue = null;
      }
      if (!nextDue || nextDue.getTime() > now.getTime()) continue;

      try {
        const contactIds = await loadAudienceContactIds(
          row.companyId,
          flow.audience,
        );
        for (const id of contactIds) {
          await enrollContact(row.companyId, flow.id, id);
        }
        await db
          .update(businessEntities)
          .set({
            data: { ...flow, stats: flow.stats, lastFiredAt: now.toISOString() },
            updatedAt: now,
          })
          .where(eq(businessEntities.id, flow.id));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn("[marketing] scheduled flow enrollment failed", message);
      }
    }
  }

  async function triggerManualFlow(
    companyId: string,
    flowId: string,
    contactIds: string[],
  ): Promise<{ enrolledCount: number }> {
    let enrolledCount = 0;
    for (const id of contactIds) {
      try {
        await enrollContact(companyId, flowId, id);
        enrolledCount += 1;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[marketing] manual enroll failed for contact",
          id,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return { enrolledCount };
  }

  async function notifyEntityEvent(
    companyId: string,
    event: {
      kind: "entity_created" | "entity_status_changed" | "tag_added";
      moduleKey?: string;
      entityType?: string;
      toStatus?: string;
      tag?: string;
      contactId?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<{ enrolledCount: number }> {
    // Find enabled flows in this company whose trigger matches
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "marketing"),
          eq(businessEntities.entityType, "flow"),
          eq(businessEntities.status, "active"),
        ),
      );
    let enrolledCount = 0;
    for (const row of rows) {
      const flow = rowToFlow(row);
      const trig = flow.trigger;
      const matches = (() => {
        if (event.kind === "entity_created" && trig.kind === "entity_created") {
          return (
            trig.moduleKey === event.moduleKey &&
            trig.entityType === event.entityType
          );
        }
        if (
          event.kind === "entity_status_changed" &&
          trig.kind === "entity_status_changed"
        ) {
          return (
            trig.moduleKey === event.moduleKey &&
            trig.entityType === event.entityType &&
            trig.toStatus === event.toStatus
          );
        }
        if (event.kind === "tag_added" && trig.kind === "tag_added") {
          return trig.tag === event.tag;
        }
        return false;
      })();
      if (!matches) continue;
      if (!event.contactId) continue;
      try {
        await enrollContact(companyId, flow.id, event.contactId);
        enrolledCount += 1;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[marketing] notifyEntityEvent enrollment failed",
          err instanceof Error ? err.message : err,
        );
      }
    }
    return { enrolledCount };
  }

  async function getFlowAnalytics(
    companyId: string,
    flowId: string,
  ): Promise<MarketingFlow["stats"]> {
    const flow = await getFlow(companyId, flowId);
    return flow ? flow.stats : { ...EMPTY_STATS };
  }

  // -------------------------------------------------------------------------
  // Background scheduler
  // -------------------------------------------------------------------------

  const timer =
    opts.autoStart === false
      ? null
      : setInterval(() => {
          if (stopped) return;
          void processDueEnrollments().catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(
              "[marketing] scheduler tick error",
              err instanceof Error ? err.message : err,
            );
          });
        }, intervalMs);
  timer?.unref?.();

  return {
    listFlows,
    getFlow,
    createFlow,
    updateFlow,
    deleteFlow,
    enableFlow,
    disableFlow,
    enrollContact,
    listEnrollments,
    processDueEnrollments,
    triggerManualFlow,
    notifyEntityEvent,
    getFlowAnalytics,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

// Re-export the template catalogue for convenience.
export { MARKETING_FLOW_TEMPLATES, getMarketingFlowTemplate };
