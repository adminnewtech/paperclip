/**
 * Agent Memory service — track which AI suggestions/actions an agent has taken
 * for a company, capture feedback (thumbs up/down) and inferred outcomes,
 * compute per-skill stats, and derive biases that can shape future runs.
 *
 * Storage model (all in businessEntities under moduleKey "agent_memory"):
 *
 *   - action          : code=<uuid>, data=AgentAction (incl. feedback/outcome)
 *
 * Feedback and outcome are mutations to the same entity (we update `data`
 * in-place). Action rows are append-only at the entity level; the JSON
 * payload may evolve. Stats and biases are computed on the fly with a single
 * scan + in-memory aggregation; results can be safely cached short-term by
 * callers.
 *
 * All operations are company-scoped.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ActionOutcomeResolution =
  | "succeeded"
  | "failed"
  | "ignored"
  | "reversed"
  | "unknown";

export interface ActionFeedback {
  rating: "thumbs_up" | "thumbs_down" | null;
  comment?: string;
  givenBy?: string;
  givenAt: string;
}

export interface ActionOutcome {
  resolution: ActionOutcomeResolution;
  measuredAt: string;
  metrics?: Record<string, number>;
  notes?: string;
}

export interface AgentAction {
  id: string;
  companyId: string;
  agentSlug: string;
  capability: string;
  runId: string;
  takenAt: string;
  description: string;
  descriptionAr?: string;
  targetEntityId?: string;
  targetEntityType?: string;
  parameters: Record<string, unknown>;
  predictedOutcome?: string;

  feedback?: ActionFeedback;
  outcome?: ActionOutcome;
}

export interface AgentSkillStats {
  agentSlug: string;
  capability: string;
  actionsCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  succeededCount: number;
  failedCount: number;
  ignoredCount: number;
  accuracy: number; // 0-1
  trend: "rising" | "stable" | "falling";
  lastActionAt?: string;
}

export interface AgentMemoryBias {
  agentSlug: string;
  capability: string;
  rule: "boost" | "suppress" | "neutral";
  strength: number; // 0-1
  reason: string;
  derivedFromActionCount: number;
}

export interface ListActionsOpts {
  agentSlug?: string;
  capability?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AgentMemoryService {
  recordAction(
    action: Omit<AgentAction, "id" | "takenAt"> & { takenAt?: string },
  ): Promise<AgentAction>;
  listActions(companyId: string, opts?: ListActionsOpts): Promise<AgentAction[]>;
  getAction(companyId: string, actionId: string): Promise<AgentAction | null>;

  giveFeedback(
    companyId: string,
    actionId: string,
    feedback: ActionFeedback,
  ): Promise<AgentAction>;
  setOutcome(
    companyId: string,
    actionId: string,
    outcome: ActionOutcome,
  ): Promise<AgentAction>;

  getSkillStats(
    companyId: string,
    agentSlug: string,
    opts?: { lookbackDays?: number },
  ): Promise<AgentSkillStats[]>;
  getAgentStats(
    companyId: string,
    agentSlug: string,
    opts?: { lookbackDays?: number },
  ): Promise<{
    overallAccuracy: number;
    totalActions: number;
    bySkill: AgentSkillStats[];
    monthlyAccuracy: Array<{ month: string; accuracy: number; actionCount: number }>;
  }>;
  getBiases(companyId: string, agentSlug: string): Promise<AgentMemoryBias[]>;
  inferOutcomes(companyId: string): Promise<{ inferredCount: number }>;

  rankAgentsByAccuracy(
    companyId: string,
  ): Promise<Array<{ agentSlug: string; accuracy: number; actionCount: number }>>;
  accuracyTimeSeries(
    companyId: string,
    agentSlug: string,
    days: number,
  ): Promise<Array<{ date: string; accuracy: number; actionCount: number }>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AGENT_MEMORY_MODULE_KEY = "agent_memory";
export const AGENT_MEMORY_ACTION_TYPE = "action";

/** Default accuracy when there is no data — uncertain, not 0%. */
export const DEFAULT_ACCURACY = 0.5;

/** Lookback for "recent" computations in days. */
export const DEFAULT_LOOKBACK_DAYS = 30;

// ---------------------------------------------------------------------------
// Internal helpers (pure)
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function weeksAgo(takenAtIso: string, now: Date): number {
  const t = Date.parse(takenAtIso);
  if (!Number.isFinite(t)) return 0;
  const ms = Math.max(0, now.getTime() - t);
  return ms / (1000 * 60 * 60 * 24 * 7);
}

/**
 * Time-weighted "accuracy" score: thumbs/outcome signals decay over time
 * (lambda = 0.95 per week). Returns a value in [0,1].
 *
 * Score model (per action):
 *   thumbs_up           => +1
 *   thumbs_down         => -1
 *   outcome.succeeded   => +1
 *   outcome.failed      => -1
 *   outcome.ignored     => -0.5
 *   outcome.reversed    => -1
 *
 * The accuracy is mapped from [-1,+1] to [0,1] via (avg + 1)/2.
 */
function computeWeightedAccuracy(
  actions: AgentAction[],
  now: Date,
): { accuracy: number; weight: number } {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const a of actions) {
    const w = Math.pow(0.95, weeksAgo(a.takenAt, now));
    let s: number | null = null;
    if (a.feedback?.rating === "thumbs_up") s = 1;
    else if (a.feedback?.rating === "thumbs_down") s = -1;
    if (a.outcome) {
      const o =
        a.outcome.resolution === "succeeded"
          ? 1
          : a.outcome.resolution === "failed"
            ? -1
            : a.outcome.resolution === "ignored"
              ? -0.5
              : a.outcome.resolution === "reversed"
                ? -1
                : null;
      if (o !== null) {
        s = s === null ? o : (s + o) / 2;
      }
    }
    if (s === null) continue;
    weightedSum += s * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return { accuracy: DEFAULT_ACCURACY, weight: 0 };
  const avg = weightedSum / totalWeight;
  return { accuracy: clamp01((avg + 1) / 2), weight: totalWeight };
}

function rowToAction(row: typeof businessEntities.$inferSelect): AgentAction | null {
  const data = (row.data ?? {}) as Partial<AgentAction>;
  if (!data.agentSlug || !data.capability) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    agentSlug: data.agentSlug,
    capability: data.capability,
    runId: data.runId ?? "",
    takenAt: data.takenAt ?? row.createdAt.toISOString(),
    description: data.description ?? row.name ?? "",
    descriptionAr: data.descriptionAr,
    targetEntityId: data.targetEntityId,
    targetEntityType: data.targetEntityType,
    parameters: (data.parameters ?? {}) as Record<string, unknown>,
    predictedOutcome: data.predictedOutcome,
    feedback: data.feedback,
    outcome: data.outcome,
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createAgentMemoryService(db: Db): AgentMemoryService {
  async function recordAction(
    action: Omit<AgentAction, "id" | "takenAt"> & { takenAt?: string },
  ): Promise<AgentAction> {
    const id = randomUUID();
    const takenAt = action.takenAt ?? new Date().toISOString();
    const payload: AgentAction = {
      id,
      companyId: action.companyId,
      agentSlug: action.agentSlug,
      capability: action.capability,
      runId: action.runId,
      takenAt,
      description: action.description,
      descriptionAr: action.descriptionAr,
      targetEntityId: action.targetEntityId,
      targetEntityType: action.targetEntityType,
      parameters: action.parameters ?? {},
      predictedOutcome: action.predictedOutcome,
    };
    const now = new Date(takenAt);
    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId: action.companyId,
        moduleKey: AGENT_MEMORY_MODULE_KEY,
        entityType: AGENT_MEMORY_ACTION_TYPE,
        code: id,
        name: action.description.slice(0, 250),
        status: "open",
        data: payload as unknown as Record<string, unknown>,
        tags: ["agent_memory", action.agentSlug, action.capability],
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to persist agent action");
    // Backfill id with row.id (so external refs are by row uuid).
    payload.id = row.id;
    if (row.id !== id) {
      await db
        .update(businessEntities)
        .set({
          data: { ...payload } as unknown as Record<string, unknown>,
          code: row.id,
        })
        .where(eq(businessEntities.id, row.id));
    }
    return payload;
  }

  async function listActions(
    companyId: string,
    opts: ListActionsOpts = {},
  ): Promise<AgentAction[]> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
    const conditions = [
      eq(businessEntities.companyId, companyId),
      eq(businessEntities.moduleKey, AGENT_MEMORY_MODULE_KEY),
      eq(businessEntities.entityType, AGENT_MEMORY_ACTION_TYPE),
    ];
    if (opts.from) {
      conditions.push(gte(businessEntities.createdAt, new Date(opts.from)));
    }
    if (opts.to) {
      conditions.push(
        sql`${businessEntities.createdAt} <= ${new Date(opts.to)}`,
      );
    }
    if (opts.agentSlug) {
      conditions.push(sql`(data->>'agentSlug') = ${opts.agentSlug}`);
    }
    if (opts.capability) {
      conditions.push(sql`(data->>'capability') = ${opts.capability}`);
    }
    const rows = await db
      .select()
      .from(businessEntities)
      .where(and(...conditions))
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit);
    return rows
      .map((r) => rowToAction(r))
      .filter((a): a is AgentAction => a !== null);
  }

  async function getAction(
    companyId: string,
    actionId: string,
  ): Promise<AgentAction | null> {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, actionId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, AGENT_MEMORY_MODULE_KEY),
          eq(businessEntities.entityType, AGENT_MEMORY_ACTION_TYPE),
        ),
      );
    if (!row) return null;
    return rowToAction(row);
  }

  async function patchActionData(
    companyId: string,
    actionId: string,
    patch: Partial<AgentAction>,
  ): Promise<AgentAction> {
    const current = await getAction(companyId, actionId);
    if (!current) throw new Error("Action not found");
    const merged: AgentAction = { ...current, ...patch };
    const now = new Date();
    await db
      .update(businessEntities)
      .set({
        data: merged as unknown as Record<string, unknown>,
        updatedAt: now,
      })
      .where(
        and(
          eq(businessEntities.id, actionId),
          eq(businessEntities.companyId, companyId),
        ),
      );
    return merged;
  }

  async function giveFeedback(
    companyId: string,
    actionId: string,
    feedback: ActionFeedback,
  ): Promise<AgentAction> {
    return patchActionData(companyId, actionId, { feedback });
  }

  async function setOutcome(
    companyId: string,
    actionId: string,
    outcome: ActionOutcome,
  ): Promise<AgentAction> {
    return patchActionData(companyId, actionId, { outcome });
  }

  function aggregateSkillStats(
    actions: AgentAction[],
    agentSlug: string,
    now: Date,
  ): AgentSkillStats[] {
    const byCap = new Map<string, AgentAction[]>();
    for (const a of actions) {
      if (a.agentSlug !== agentSlug) continue;
      const list = byCap.get(a.capability) ?? [];
      list.push(a);
      byCap.set(a.capability, list);
    }
    const out: AgentSkillStats[] = [];
    for (const [capability, list] of byCap.entries()) {
      const recent = list.filter(
        (a) => weeksAgo(a.takenAt, now) <= DEFAULT_LOOKBACK_DAYS / 7,
      );
      const older = list.filter(
        (a) => weeksAgo(a.takenAt, now) > DEFAULT_LOOKBACK_DAYS / 7,
      );
      const recentAcc = computeWeightedAccuracy(recent, now).accuracy;
      const olderAcc = computeWeightedAccuracy(older, now).accuracy;
      const delta = recentAcc - olderAcc;
      const trend: "rising" | "stable" | "falling" =
        delta > 0.05 ? "rising" : delta < -0.05 ? "falling" : "stable";

      let thumbsUp = 0;
      let thumbsDown = 0;
      let succ = 0;
      let fail = 0;
      let ign = 0;
      let lastAt: string | undefined;
      for (const a of list) {
        if (a.feedback?.rating === "thumbs_up") thumbsUp += 1;
        else if (a.feedback?.rating === "thumbs_down") thumbsDown += 1;
        if (a.outcome?.resolution === "succeeded") succ += 1;
        else if (a.outcome?.resolution === "failed") fail += 1;
        else if (a.outcome?.resolution === "ignored") ign += 1;
        if (!lastAt || a.takenAt > lastAt) lastAt = a.takenAt;
      }

      out.push({
        agentSlug,
        capability,
        actionsCount: list.length,
        thumbsUpCount: thumbsUp,
        thumbsDownCount: thumbsDown,
        succeededCount: succ,
        failedCount: fail,
        ignoredCount: ign,
        accuracy: recentAcc,
        trend,
        lastActionAt: lastAt,
      });
    }
    return out.sort((a, b) => b.actionsCount - a.actionsCount);
  }

  async function getSkillStats(
    companyId: string,
    agentSlug: string,
    opts: { lookbackDays?: number } = {},
  ): Promise<AgentSkillStats[]> {
    const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS * 6;
    const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const actions = await listActions(companyId, {
      agentSlug,
      from: from.toISOString(),
      limit: 1000,
    });
    return aggregateSkillStats(actions, agentSlug, new Date());
  }

  async function getAgentStats(
    companyId: string,
    agentSlug: string,
    opts: { lookbackDays?: number } = {},
  ): Promise<{
    overallAccuracy: number;
    totalActions: number;
    bySkill: AgentSkillStats[];
    monthlyAccuracy: Array<{ month: string; accuracy: number; actionCount: number }>;
  }> {
    const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS * 6;
    const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const actions = await listActions(companyId, {
      agentSlug,
      from: from.toISOString(),
      limit: 1000,
    });
    const now = new Date();
    const bySkill = aggregateSkillStats(actions, agentSlug, now);
    const recent = actions.filter(
      (a) => weeksAgo(a.takenAt, now) <= DEFAULT_LOOKBACK_DAYS / 7,
    );
    const overall = computeWeightedAccuracy(recent, now).accuracy;

    // Group by YYYY-MM
    const monthBuckets = new Map<string, AgentAction[]>();
    for (const a of actions) {
      const key = a.takenAt.slice(0, 7);
      const list = monthBuckets.get(key) ?? [];
      list.push(a);
      monthBuckets.set(key, list);
    }
    const monthlyAccuracy = [...monthBuckets.entries()]
      .map(([month, list]) => ({
        month,
        accuracy: computeWeightedAccuracy(list, now).accuracy,
        actionCount: list.length,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      overallAccuracy: overall,
      totalActions: actions.length,
      bySkill,
      monthlyAccuracy,
    };
  }

  async function getBiases(
    companyId: string,
    agentSlug: string,
  ): Promise<AgentMemoryBias[]> {
    const stats = await getSkillStats(companyId, agentSlug);
    const biases: AgentMemoryBias[] = [];
    for (const s of stats) {
      // Need a reasonable sample size before we trust the signal.
      if (s.actionsCount < 5) {
        biases.push({
          agentSlug: s.agentSlug,
          capability: s.capability,
          rule: "neutral",
          strength: 0,
          reason: `Only ${s.actionsCount} action(s) recorded — not enough data yet.`,
          derivedFromActionCount: s.actionsCount,
        });
        continue;
      }
      const negativeRate =
        (s.thumbsDownCount + s.failedCount) /
        Math.max(1, s.actionsCount);
      const positiveRate =
        (s.thumbsUpCount + s.succeededCount) /
        Math.max(1, s.actionsCount);

      if (negativeRate > 0.3) {
        biases.push({
          agentSlug: s.agentSlug,
          capability: s.capability,
          rule: "suppress",
          strength: clamp01(negativeRate),
          reason: `Last ${s.actionsCount} attempts had a ${Math.round(negativeRate * 100)}% negative signal rate.`,
          derivedFromActionCount: s.actionsCount,
        });
      } else if (positiveRate > 0.8) {
        biases.push({
          agentSlug: s.agentSlug,
          capability: s.capability,
          rule: "boost",
          strength: clamp01(positiveRate),
          reason: `Last ${s.actionsCount} attempts had a ${Math.round(positiveRate * 100)}% positive signal rate.`,
          derivedFromActionCount: s.actionsCount,
        });
      } else {
        biases.push({
          agentSlug: s.agentSlug,
          capability: s.capability,
          rule: "neutral",
          strength: 0,
          reason: "Performance within normal range.",
          derivedFromActionCount: s.actionsCount,
        });
      }
    }
    return biases;
  }

  /**
   * Auto-infer outcomes for actions whose feedback/outcome is still empty.
   *
   * Heuristics (best-effort, non-blocking):
   *   - If a target invoice (sales/invoice) is now status="paid",
   *     mark the originating action succeeded.
   *   - If a target deal is "won", succeeded; "lost", failed.
   *   - If 30+ days have passed and there's still no movement on the
   *     target entity, mark ignored.
   */
  async function inferOutcomes(companyId: string): Promise<{ inferredCount: number }> {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const actions = await listActions(companyId, {
      from: since.toISOString(),
      limit: 1000,
    });
    const pending = actions.filter((a) => !a.outcome && a.targetEntityId);
    if (pending.length === 0) return { inferredCount: 0 };

    const now = new Date();
    let inferred = 0;
    for (const a of pending) {
      try {
        const [target] = await db
          .select()
          .from(businessEntities)
          .where(
            and(
              eq(businessEntities.id, a.targetEntityId!),
              eq(businessEntities.companyId, companyId),
            ),
          );
        let resolution: ActionOutcomeResolution | null = null;
        if (target) {
          const tStatus = (target.status ?? "").toLowerCase();
          if (tStatus === "paid" || tStatus === "won" || tStatus === "resolved") {
            resolution = "succeeded";
          } else if (tStatus === "lost" || tStatus === "cancelled") {
            resolution = "failed";
          } else if (tStatus === "void" || tStatus === "reversed") {
            resolution = "reversed";
          } else {
            // Has the target moved since the action?
            const updated = target.updatedAt.getTime();
            const ageDays = (now.getTime() - Date.parse(a.takenAt)) / (1000 * 60 * 60 * 24);
            if (updated <= Date.parse(a.takenAt) && ageDays >= 30) {
              resolution = "ignored";
            }
          }
        } else {
          const ageDays = (now.getTime() - Date.parse(a.takenAt)) / (1000 * 60 * 60 * 24);
          if (ageDays >= 30) resolution = "ignored";
        }
        if (resolution) {
          await setOutcome(companyId, a.id, {
            resolution,
            measuredAt: now.toISOString(),
            notes: "Auto-inferred from target entity state",
          });
          inferred += 1;
        }
      } catch {
        // best-effort: skip and continue
      }
    }
    return { inferredCount: inferred };
  }

  async function rankAgentsByAccuracy(
    companyId: string,
  ): Promise<Array<{ agentSlug: string; accuracy: number; actionCount: number }>> {
    const since = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const actions = await listActions(companyId, {
      from: since.toISOString(),
      limit: 1000,
    });
    const byAgent = new Map<string, AgentAction[]>();
    for (const a of actions) {
      const list = byAgent.get(a.agentSlug) ?? [];
      list.push(a);
      byAgent.set(a.agentSlug, list);
    }
    const now = new Date();
    const rows: Array<{ agentSlug: string; accuracy: number; actionCount: number }> = [];
    for (const [slug, list] of byAgent.entries()) {
      const { accuracy } = computeWeightedAccuracy(list, now);
      rows.push({ agentSlug: slug, accuracy, actionCount: list.length });
    }
    rows.sort((a, b) => b.accuracy - a.accuracy);
    return rows;
  }

  async function accuracyTimeSeries(
    companyId: string,
    agentSlug: string,
    days: number,
  ): Promise<Array<{ date: string; accuracy: number; actionCount: number }>> {
    const safeDays = Math.min(Math.max(days, 1), 365);
    const from = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
    const actions = await listActions(companyId, {
      agentSlug,
      from: from.toISOString(),
      limit: 1000,
    });
    const byDay = new Map<string, AgentAction[]>();
    for (const a of actions) {
      const key = a.takenAt.slice(0, 10);
      const list = byDay.get(key) ?? [];
      list.push(a);
      byDay.set(key, list);
    }
    const out: Array<{ date: string; accuracy: number; actionCount: number }> = [];
    const now = new Date();
    for (let i = safeDays - 1; i >= 0; i -= 1) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const list = byDay.get(key) ?? [];
      const { accuracy } = computeWeightedAccuracy(list, now);
      out.push({
        date: key,
        accuracy: list.length === 0 ? DEFAULT_ACCURACY : accuracy,
        actionCount: list.length,
      });
    }
    return out;
  }

  return {
    recordAction,
    listActions,
    getAction,
    giveFeedback,
    setOutcome,
    getSkillStats,
    getAgentStats,
    getBiases,
    inferOutcomes,
    rankAgentsByAccuracy,
    accuracyTimeSeries,
  };
}
