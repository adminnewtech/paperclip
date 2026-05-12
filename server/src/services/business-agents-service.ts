/**
 * Business Agents service — hire / fire / run logic for the 5 specialized
 * AI business agents defined in `@paperclipai/shared/business-agents`.
 *
 * Each "hired" agent and each "run" is stored as a businessEntities row under
 * moduleKey "agents":
 *
 *   - hired_agent : code=<agentSlug>, data=HiredAgent
 *   - agent_run   : parentId=hired_agent.id, data=AgentRunResult
 *
 * Runs are deterministic by default; LLM-powered capabilities call into
 * `createBusinessAiService` when an API key is configured, otherwise they
 * fall back to rule-based logic. Every capability is wrapped in a try/catch
 * so a failure in one does not derail the whole run.
 */

import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  BUSINESS_AGENTS,
  getBusinessAgentDefinition,
  type BusinessAgentDefinition,
  type BusinessAgentSchedule,
} from "@paperclipai/shared";
import { createBusinessAiService } from "./business-ai-service.js";
import {
  createAgentMemoryService,
  type AgentMemoryBias,
  type AgentMemoryService,
} from "./agent-memory/index.js";
import { createFeedbackTracker } from "./agent-memory/feedback-tracker.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AgentRunStatus = "success" | "partial" | "failed";

export interface HiredAgent {
  id: string;
  companyId: string;
  agentSlug: string;
  status: "active" | "paused";
  hiredAt: string;
  pausedAt?: string;
  schedule: string;
  enabledCapabilities: string[];
  lastRunAt?: string;
  lastRunStatus?: AgentRunStatus;
  runCount: number;
  actionsCount: number;
}

export interface AgentRunAction {
  capability: string;
  summary: string;
  summaryAr?: string;
  entityRefs?: string[];
  severity: "info" | "action" | "warning";
  /**
   * IDs of agent_memory rows created for this action (one per recorded
   * suggestion/output). Used by the UI to attach thumbs-up/down prompts.
   */
  memoryActionIds?: string[];
}

export interface AgentRunResult {
  id?: string;
  startedAt: string;
  finishedAt: string;
  status: AgentRunStatus;
  actions: AgentRunAction[];
  errors?: string[];
}

export interface HireOptions {
  schedule?: string;
  capabilities?: string[];
}

export interface BusinessAgentsService {
  listHired(companyId: string): Promise<HiredAgent[]>;
  getHired(companyId: string, agentSlug: string): Promise<HiredAgent | null>;
  hire(
    companyId: string,
    agentSlug: string,
    opts?: HireOptions,
    userId?: string | null,
  ): Promise<HiredAgent>;
  fire(companyId: string, agentSlug: string): Promise<void>;
  pause(companyId: string, agentSlug: string): Promise<HiredAgent>;
  resume(companyId: string, agentSlug: string): Promise<HiredAgent>;
  updateCapabilities(
    companyId: string,
    agentSlug: string,
    capabilities: string[],
  ): Promise<HiredAgent>;
  updateSchedule(
    companyId: string,
    agentSlug: string,
    schedule: string,
  ): Promise<HiredAgent>;
  runNow(companyId: string, agentSlug: string): Promise<AgentRunResult>;
  listRuns(
    companyId: string,
    agentSlug: string,
    opts?: { limit?: number },
  ): Promise<AgentRunResult[]>;
  getRun(
    companyId: string,
    agentSlug: string,
    runId: string,
  ): Promise<AgentRunResult | null>;
  getDefinition(agentSlug: string): BusinessAgentDefinition | undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENTS_MODULE_KEY = "agents";
const HIRED_AGENT_TYPE = "hired_agent";
const AGENT_RUN_TYPE = "agent_run";

function scheduleForAgent(def: BusinessAgentDefinition): string {
  // Map default schedule + run-time to a shorthand or cron expression.
  switch (def.defaultSchedule) {
    case "hourly":
      return "hourly";
    case "weekly":
      return "weekly";
    case "daily": {
      const [hourStr] = def.defaultRunTime.split(":");
      const hour = Number(hourStr ?? "9");
      if (!Number.isFinite(hour)) return "daily";
      return `0 ${hour} * * *`;
    }
    case "on_event":
      return "on_event";
  }
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createBusinessAgentsService(db: Db): BusinessAgentsService {
  const aiService = createBusinessAiService(db);
  const memoryService: AgentMemoryService = createAgentMemoryService(db);
  const feedbackTracker = createFeedbackTracker(memoryService);

  /**
   * Best-effort: record one memory row per emitted run action so the UI can
   * later prompt for thumbs-up / thumbs-down feedback. Failures are swallowed
   * to avoid breaking the agent run.
   */
  async function recordActionsToMemory(
    companyId: string,
    agentSlug: string,
    runId: string,
    actions: AgentRunAction[],
  ): Promise<void> {
    for (const a of actions) {
      try {
        const targets = a.entityRefs && a.entityRefs.length > 0 ? a.entityRefs : [undefined];
        const ids: string[] = [];
        for (const targetId of targets) {
          const recorded = await feedbackTracker.record(companyId, {
            companyId,
            agentSlug,
            capability: a.capability,
            runId,
            description: a.summary,
            descriptionAr: a.summaryAr,
            targetEntityId: targetId,
            parameters: {
              severity: a.severity,
              entityRefCount: a.entityRefs?.length ?? 0,
            },
          });
          if (recorded) ids.push(recorded.id);
        }
        if (ids.length > 0) a.memoryActionIds = ids;
      } catch {
        // best-effort
      }
    }
  }

  /**
   * Best-effort: fetch current biases and return the set of capabilities that
   * should be suppressed for this run.
   */
  async function getSuppressedCapabilities(
    companyId: string,
    agentSlug: string,
  ): Promise<Set<string>> {
    try {
      const biases: AgentMemoryBias[] = await memoryService.getBiases(
        companyId,
        agentSlug,
      );
      const suppressed = new Set<string>();
      for (const b of biases) {
        if (b.rule === "suppress") suppressed.add(b.capability);
      }
      return suppressed;
    } catch {
      return new Set<string>();
    }
  }

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  async function fetchHiredRow(companyId: string, agentSlug: string) {
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, AGENTS_MODULE_KEY),
          eq(businessEntities.entityType, HIRED_AGENT_TYPE),
          eq(businessEntities.code, agentSlug),
        ),
      );
    return row ?? null;
  }

  function rowToHiredAgent(row: NonNullable<Awaited<ReturnType<typeof fetchHiredRow>>>): HiredAgent {
    const data = (row.data ?? {}) as Partial<HiredAgent>;
    return {
      id: row.id,
      companyId: row.companyId,
      agentSlug: row.code ?? data.agentSlug ?? "",
      status: (data.status ?? "active") as "active" | "paused",
      hiredAt: data.hiredAt ?? row.createdAt.toISOString(),
      pausedAt: data.pausedAt,
      schedule: data.schedule ?? "daily",
      enabledCapabilities: Array.isArray(data.enabledCapabilities)
        ? data.enabledCapabilities!
        : [],
      lastRunAt: data.lastRunAt,
      lastRunStatus: data.lastRunStatus,
      runCount: data.runCount ?? 0,
      actionsCount: data.actionsCount ?? 0,
    };
  }

  async function listHired(companyId: string): Promise<HiredAgent[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, AGENTS_MODULE_KEY),
          eq(businessEntities.entityType, HIRED_AGENT_TYPE),
        ),
      )
      .orderBy(desc(businessEntities.createdAt));
    return rows.map((r) => rowToHiredAgent(r));
  }

  async function getHired(
    companyId: string,
    agentSlug: string,
  ): Promise<HiredAgent | null> {
    const row = await fetchHiredRow(companyId, agentSlug);
    return row ? rowToHiredAgent(row) : null;
  }

  async function hire(
    companyId: string,
    agentSlug: string,
    opts: HireOptions = {},
    userId?: string | null,
  ): Promise<HiredAgent> {
    const def = getBusinessAgentDefinition(agentSlug);
    if (!def) {
      throw new Error(`Unknown agent: ${agentSlug}`);
    }

    const existing = await fetchHiredRow(companyId, agentSlug);
    if (existing) {
      return rowToHiredAgent(existing);
    }

    const schedule = opts.schedule ?? scheduleForAgent(def);
    const enabledCapabilities =
      opts.capabilities && opts.capabilities.length > 0
        ? opts.capabilities
        : def.capabilities.map((c) => c.key);

    const now = new Date();
    const payload: HiredAgent = {
      id: "",
      companyId,
      agentSlug,
      status: "active",
      hiredAt: now.toISOString(),
      schedule,
      enabledCapabilities,
      runCount: 0,
      actionsCount: 0,
    };

    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: AGENTS_MODULE_KEY,
        entityType: HIRED_AGENT_TYPE,
        code: agentSlug,
        name: `${def.personaName} — ${def.title}`,
        status: "active",
        ownerUserId: userId ?? null,
        data: payload as unknown as Record<string, unknown>,
        tags: ["agent", def.slug],
        createdByUserId: userId ?? null,
        updatedByUserId: userId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) throw new Error("Failed to persist hired agent");
    const hired = rowToHiredAgent(row);
    // Backfill the id in the stored data for convenience.
    await db
      .update(businessEntities)
      .set({
        data: { ...payload, id: row.id } as unknown as Record<string, unknown>,
      })
      .where(eq(businessEntities.id, row.id));
    hired.id = row.id;
    return hired;
  }

  async function fire(companyId: string, agentSlug: string): Promise<void> {
    const row = await fetchHiredRow(companyId, agentSlug);
    if (!row) return;
    // Also delete all run rows referencing this agent.
    await db
      .delete(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, AGENTS_MODULE_KEY),
          eq(businessEntities.entityType, AGENT_RUN_TYPE),
          eq(businessEntities.parentId, row.id),
        ),
      );
    await db
      .delete(businessEntities)
      .where(eq(businessEntities.id, row.id));
  }

  async function patchHired(
    companyId: string,
    agentSlug: string,
    patch: Partial<HiredAgent>,
  ): Promise<HiredAgent> {
    const row = await fetchHiredRow(companyId, agentSlug);
    if (!row) {
      throw new Error(`Agent not hired: ${agentSlug}`);
    }
    const existing = rowToHiredAgent(row);
    const merged: HiredAgent = { ...existing, ...patch };
    const now = new Date();
    const [updated] = await db
      .update(businessEntities)
      .set({
        data: merged as unknown as Record<string, unknown>,
        status: merged.status,
        updatedAt: now,
      })
      .where(eq(businessEntities.id, row.id))
      .returning();
    if (!updated) throw new Error("Failed to update hired agent");
    return rowToHiredAgent(updated);
  }

  async function pause(companyId: string, agentSlug: string): Promise<HiredAgent> {
    return patchHired(companyId, agentSlug, {
      status: "paused",
      pausedAt: new Date().toISOString(),
    });
  }

  async function resume(companyId: string, agentSlug: string): Promise<HiredAgent> {
    return patchHired(companyId, agentSlug, {
      status: "active",
      pausedAt: undefined,
    });
  }

  async function updateCapabilities(
    companyId: string,
    agentSlug: string,
    capabilities: string[],
  ): Promise<HiredAgent> {
    return patchHired(companyId, agentSlug, {
      enabledCapabilities: capabilities,
    });
  }

  async function updateSchedule(
    companyId: string,
    agentSlug: string,
    schedule: string,
  ): Promise<HiredAgent> {
    return patchHired(companyId, agentSlug, { schedule });
  }

  // -------------------------------------------------------------------------
  // Capability executors
  // -------------------------------------------------------------------------

  type CapabilityRunner = (
    companyId: string,
    capabilityKey: string,
  ) => Promise<AgentRunAction[]>;

  // Accountant ----------------------------------------------------------------

  async function runCategorizeUncategorizedExpenses(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "finance"),
          eq(businessEntities.entityType, "expense"),
          or(
            sql`coalesce(data->>'category','') = ''`,
            sql`data->>'category' = 'Uncategorized'`,
          ),
        ),
      )
      .limit(50);

    if (rows.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "All expenses already categorized.",
          summaryAr: "جميع المصروفات مصنفة بالفعل.",
          severity: "info",
        },
      ];
    }

    const handled: string[] = [];
    let aiCount = 0;
    let ruleCount = 0;
    for (const row of rows) {
      const result = await aiService.categorizeExpense(companyId, row.id);
      if ("category" in result) {
        handled.push(row.id);
        if (result.mock) ruleCount += 1;
        else aiCount += 1;
      }
    }

    const summary =
      aiCount > 0
        ? `Categorized ${handled.length} expense(s) (${aiCount} via AI, ${ruleCount} via rules).`
        : `Categorized ${handled.length} expense(s) using rule-based heuristics.`;
    return [
      {
        capability: capabilityKey,
        summary,
        summaryAr: `تم تصنيف ${handled.length} مصروف.`,
        severity: handled.length > 0 ? "action" : "info",
        entityRefs: handled.slice(0, 20),
      },
    ];
  }

  async function runDetectDuplicateExpenses(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "finance"),
          eq(businessEntities.entityType, "expense"),
          gte(businessEntities.createdAt, ninetyDaysAgo),
        ),
      );

    const groups = new Map<string, string[]>();
    for (const r of rows) {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const vendor =
        typeof data.vendor === "string"
          ? data.vendor
          : typeof data.merchant === "string"
            ? data.merchant
            : "";
      if (!vendor) continue;
      const amount = r.amountCents ?? 0;
      const key = `${vendor}|${amount}`;
      const list = groups.get(key) ?? [];
      list.push(r.id);
      groups.set(key, list);
    }

    const dupIds: string[] = [];
    for (const ids of groups.values()) {
      if (ids.length >= 2) dupIds.push(...ids);
    }

    if (dupIds.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No duplicate expenses detected.",
          summaryAr: "لم يتم اكتشاف مصروفات مكررة.",
          severity: "info",
        },
      ];
    }

    // Tag the offending expenses for human review.
    const now = new Date();
    for (const id of dupIds) {
      const [row] = await db
        .select()
        .from(businessEntities)
        .where(eq(businessEntities.id, id));
      if (!row) continue;
      const existingTags = Array.isArray(row.tags) ? (row.tags as string[]) : [];
      if (existingTags.includes("possible_duplicate")) continue;
      await db
        .update(businessEntities)
        .set({
          tags: [...existingTags, "possible_duplicate"],
          updatedAt: now,
        })
        .where(eq(businessEntities.id, id));
    }

    return [
      {
        capability: capabilityKey,
        summary: `Flagged ${dupIds.length} expense(s) as possible duplicates.`,
        summaryAr: `تم وضع علامة على ${dupIds.length} مصروف كمكررات محتملة.`,
        severity: "warning",
        entityRefs: dupIds.slice(0, 20),
      },
    ];
  }

  async function runFlagExpenseAnomalies(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "finance"),
          eq(businessEntities.entityType, "expense"),
          gte(businessEntities.createdAt, ninetyDaysAgo),
        ),
      );

    const byCategory = new Map<string, number[]>();
    for (const r of rows) {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const category =
        typeof data.category === "string" ? data.category : "Uncategorized";
      const list = byCategory.get(category) ?? [];
      list.push(r.amountCents ?? 0);
      byCategory.set(category, list);
    }

    const averages = new Map<string, number>();
    for (const [cat, amounts] of byCategory.entries()) {
      const avg = amounts.reduce((s, a) => s + a, 0) / Math.max(1, amounts.length);
      averages.set(cat, avg);
    }

    const flagged: string[] = [];
    const now = new Date();
    for (const r of rows) {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const category =
        typeof data.category === "string" ? data.category : "Uncategorized";
      const avg = averages.get(category) ?? 0;
      const amount = r.amountCents ?? 0;
      if (avg > 0 && amount > avg * 2) {
        const existingTags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
        if (!existingTags.includes("anomaly")) {
          await db
            .update(businessEntities)
            .set({
              tags: [...existingTags, "anomaly"],
              updatedAt: now,
            })
            .where(eq(businessEntities.id, r.id));
        }
        flagged.push(r.id);
      }
    }

    if (flagged.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No expense anomalies detected.",
          summaryAr: "لم يتم رصد مصروفات شاذة.",
          severity: "info",
        },
      ];
    }
    return [
      {
        capability: capabilityKey,
        summary: `Flagged ${flagged.length} expense(s) as anomalies (>2x category average).`,
        summaryAr: `تم رصد ${flagged.length} مصروف شاذ.`,
        severity: "warning",
        entityRefs: flagged.slice(0, 20),
      },
    ];
  }

  async function runPrepareVatSummary(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [invoices, expenses] = await Promise.all([
      db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "sales"),
            eq(businessEntities.entityType, "invoice"),
            gte(businessEntities.createdAt, startOfMonth),
          ),
        ),
      db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "finance"),
            eq(businessEntities.entityType, "expense"),
            gte(businessEntities.createdAt, startOfMonth),
          ),
        ),
    ]);

    const VAT_RATE = 0.15;
    const outputVat = invoices.reduce(
      (s, i) => s + Math.round((i.amountCents ?? 0) * VAT_RATE),
      0,
    );
    const inputVat = expenses.reduce(
      (s, e) => s + Math.round((e.amountCents ?? 0) * VAT_RATE),
      0,
    );
    const netVat = outputVat - inputVat;

    await db.insert(businessEntities).values({
      companyId,
      moduleKey: AGENTS_MODULE_KEY,
      entityType: "vat_summary",
      name: `VAT summary ${now.toISOString().slice(0, 7)}`,
      status: "draft",
      amountCents: netVat,
      currency: "SAR",
      data: {
        period: now.toISOString().slice(0, 7),
        outputVatCents: outputVat,
        inputVatCents: inputVat,
        netVatCents: netVat,
        invoiceCount: invoices.length,
        expenseCount: expenses.length,
      },
      tags: ["vat", "auto"],
      createdAt: now,
      updatedAt: now,
    });

    return [
      {
        capability: capabilityKey,
        summary: `Prepared VAT summary for ${now.toISOString().slice(0, 7)}: net ${(netVat / 100).toLocaleString()}.`,
        summaryAr: `تم إعداد ملخص ضريبة القيمة المضافة لشهر ${now.toISOString().slice(0, 7)}.`,
        severity: "action",
      },
    ];
  }

  async function runReconcileInvoicePayments(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const invoices = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
          eq(businessEntities.status, "sent"),
        ),
      );

    if (invoices.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No sent invoices to reconcile.",
          summaryAr: "لا توجد فواتير مرسلة للمطابقة.",
          severity: "info",
        },
      ];
    }

    const payments = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "payment"),
        ),
      );

    const paidIds: string[] = [];
    const now = new Date();
    for (const inv of invoices) {
      const matchingPayment = payments.find((p) => {
        const data = (p.data ?? {}) as Record<string, unknown>;
        const ref = typeof data.invoiceId === "string" ? data.invoiceId : null;
        return ref === inv.id && (p.amountCents ?? 0) >= (inv.amountCents ?? 0);
      });
      if (matchingPayment) {
        await db
          .update(businessEntities)
          .set({ status: "paid", updatedAt: now })
          .where(eq(businessEntities.id, inv.id));
        paidIds.push(inv.id);
      }
    }

    return [
      {
        capability: capabilityKey,
        summary:
          paidIds.length > 0
            ? `Reconciled ${paidIds.length} invoice(s) as paid.`
            : "No new invoice/payment matches found.",
        summaryAr:
          paidIds.length > 0
            ? `تمت مطابقة ${paidIds.length} فاتورة كمدفوعة.`
            : "لم يتم العثور على تطابقات جديدة.",
        severity: paidIds.length > 0 ? "action" : "info",
        entityRefs: paidIds.slice(0, 20),
      },
    ];
  }

  // Sales ---------------------------------------------------------------------

  async function runFollowUpStaleDeals(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const deals = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "deal"),
          lte(businessEntities.updatedAt, cutoff),
        ),
      );

    const stale = deals.filter(
      (d) => !["won", "lost"].includes(d.status),
    );
    if (stale.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No stale deals — pipeline is moving.",
          summaryAr: "لا توجد صفقات راكدة — المبيعات تتحرك.",
          severity: "info",
        },
      ];
    }

    const now = new Date();
    for (const d of stale) {
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: AGENTS_MODULE_KEY,
        entityType: "agent_activity",
        name: `Follow-up needed: ${d.name ?? d.code ?? d.id}`,
        status: "info",
        data: {
          dealId: d.id,
          stage: d.status,
          suggestion: "Follow up — no activity in 14+ days",
        },
        tags: ["follow_up", "auto"],
        createdAt: now,
        updatedAt: now,
      });
    }

    return [
      {
        capability: capabilityKey,
        summary: `Logged ${stale.length} follow-up reminder(s) for stale deals.`,
        summaryAr: `تم تسجيل ${stale.length} تذكير متابعة للصفقات الراكدة.`,
        severity: "action",
        entityRefs: stale.map((d) => d.id).slice(0, 20),
      },
    ];
  }

  async function runNurtureColdLeads(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const contacts = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "contact"),
          lte(businessEntities.updatedAt, cutoff),
        ),
      );

    if (contacts.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No cold leads found.",
          summaryAr: "لا يوجد عملاء محتملون غير نشطين.",
          severity: "info",
        },
      ];
    }

    const now = new Date();
    for (const c of contacts.slice(0, 25)) {
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: AGENTS_MODULE_KEY,
        entityType: "agent_activity",
        name: `Touch base: ${c.name ?? c.code ?? c.id}`,
        status: "info",
        data: {
          contactId: c.id,
          suggestion: "Send a check-in message or share a recent update",
        },
        tags: ["nurture", "auto"],
        createdAt: now,
        updatedAt: now,
      });
    }
    return [
      {
        capability: capabilityKey,
        summary: `Drafted ${Math.min(contacts.length, 25)} nurture touchpoint(s).`,
        summaryAr: `تم اقتراح ${Math.min(contacts.length, 25)} تواصل لإعادة التفعيل.`,
        severity: "action",
        entityRefs: contacts.slice(0, 20).map((c) => c.id),
      },
    ];
  }

  async function runSuggestNextActionPerDeal(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const deals = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "deal"),
        ),
      )
      .limit(25);

    const active = deals.filter(
      (d) => !["won", "lost"].includes(d.status),
    );
    if (active.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No active deals to advise on.",
          summaryAr: "لا توجد صفقات نشطة للنصح بشأنها.",
          severity: "info",
        },
      ];
    }
    let processed = 0;
    for (const d of active) {
      const result = await aiService.suggestNextAction(companyId, d.id);
      if ("error" in result) continue;
      processed += 1;
    }
    return [
      {
        capability: capabilityKey,
        summary: `Generated next-action suggestions for ${processed} deal(s).`,
        summaryAr: `تم اقتراح الخطوة التالية لـ ${processed} صفقة.`,
        severity: "action",
        entityRefs: active.map((d) => d.id).slice(0, 20),
      },
    ];
  }

  async function runPrioritizePipeline(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const deals = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "deal"),
        ),
      );

    const stageProb: Record<string, number> = {
      prospecting: 0.1,
      qualified: 0.25,
      proposal: 0.5,
      negotiation: 0.75,
      won: 1,
      lost: 0,
    };
    const ranked = deals
      .filter((d) => !["won", "lost"].includes(d.status))
      .map((d) => ({
        id: d.id,
        score: (stageProb[d.status] ?? 0.1) * (d.amountCents ?? 0),
      }))
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "Pipeline is empty.",
          summaryAr: "خط المبيعات فارغ.",
          severity: "info",
        },
      ];
    }

    // Tag top 5 as "priority"
    const now = new Date();
    const topIds = ranked.slice(0, 5).map((r) => r.id);
    for (const id of topIds) {
      const [row] = await db
        .select()
        .from(businessEntities)
        .where(eq(businessEntities.id, id));
      if (!row) continue;
      const tags = Array.isArray(row.tags) ? (row.tags as string[]) : [];
      const cleaned = tags.filter((t) => t !== "priority").concat("priority");
      await db
        .update(businessEntities)
        .set({ tags: cleaned, updatedAt: now })
        .where(eq(businessEntities.id, id));
    }
    return [
      {
        capability: capabilityKey,
        summary: `Tagged top ${topIds.length} highest-value deal(s) as priority.`,
        summaryAr: `تم وضع علامة على أعلى ${topIds.length} صفقات قيمة كأولوية.`,
        severity: "action",
        entityRefs: topIds,
      },
    ];
  }

  async function runDraftProposalEmail(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const deals = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "crm"),
          eq(businessEntities.entityType, "deal"),
          eq(businessEntities.status, "proposal"),
        ),
      );

    if (deals.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No deals in the Proposal stage.",
          summaryAr: "لا توجد صفقات في مرحلة العرض.",
          severity: "info",
        },
      ];
    }

    const now = new Date();
    let drafted = 0;
    for (const d of deals.slice(0, 10)) {
      const data = (d.data ?? {}) as Record<string, unknown>;
      if (typeof data.proposalEmail === "string" && data.proposalEmail.length > 0) {
        continue;
      }
      const body =
        `Hi,\n\nThanks for the conversations so far on ${d.name ?? "this opportunity"}. ` +
        `As discussed, here is a recap of the proposed scope and pricing for your review.\n\n` +
        `Estimated value: ${(d.amountCents ?? 0) / 100} ${d.currency ?? "SAR"}.\n\n` +
        `Happy to jump on a quick call to walk through it. When works for you next week?\n\nBest,`;
      await db
        .update(businessEntities)
        .set({
          data: { ...data, proposalEmail: body, proposalDraftedAt: now.toISOString() },
          updatedAt: now,
        })
        .where(eq(businessEntities.id, d.id));
      drafted += 1;
    }

    return [
      {
        capability: capabilityKey,
        summary: `Drafted proposal email for ${drafted} deal(s).`,
        summaryAr: `تم صياغة رسالة عرض لـ ${drafted} صفقة.`,
        severity: "action",
        entityRefs: deals.slice(0, 10).map((d) => d.id),
      },
    ];
  }

  // Customer service ----------------------------------------------------------

  async function runClassifyNewTickets(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const tickets = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "helpdesk"),
          eq(businessEntities.entityType, "ticket"),
          or(
            sql`coalesce(data->>'category','') = ''`,
            sql`(data->>'classifiedAt') IS NULL`,
          ),
        ),
      )
      .limit(25);

    if (tickets.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No unclassified tickets.",
          summaryAr: "لا توجد تذاكر غير مصنفة.",
          severity: "info",
        },
      ];
    }

    let processed = 0;
    for (const t of tickets) {
      const result = await aiService.classifyTicket(companyId, t.id);
      if ("error" in result) continue;
      processed += 1;
    }
    return [
      {
        capability: capabilityKey,
        summary: `Classified ${processed} ticket(s).`,
        summaryAr: `تم تصنيف ${processed} تذكرة.`,
        severity: "action",
        entityRefs: tickets.map((t) => t.id).slice(0, 20),
      },
    ];
  }

  async function runAutoRespondSimpleTickets(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const tickets = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "helpdesk"),
          eq(businessEntities.entityType, "ticket"),
          eq(businessEntities.status, "open"),
        ),
      )
      .limit(50);

    const FAQ_PATTERNS = [
      { re: /(password|reset|forgot)/i, reply: "You can reset your password from the login screen by clicking 'Forgot password'." },
      { re: /(hours|open|when)/i, reply: "Our support hours are Sunday–Thursday, 9am–5pm KSA." },
      { re: /(price|pricing|cost|how much)/i, reply: "You can find current pricing on our pricing page; happy to walk through what fits your team." },
      { re: /(refund|cancel)/i, reply: "We're sorry to hear that — refunds are processed within 5 business days; reply with your order number and we'll take care of it." },
    ];

    const now = new Date();
    const replied: string[] = [];
    for (const t of tickets) {
      const subject = t.name ?? "";
      const data = (t.data ?? {}) as Record<string, unknown>;
      const body = typeof data.body === "string" ? data.body : "";
      const text = `${subject} ${body}`;
      const match = FAQ_PATTERNS.find((p) => p.re.test(text));
      if (!match) continue;
      if (typeof data.auto_response === "string") continue;
      await db
        .update(businessEntities)
        .set({
          data: {
            ...data,
            auto_response: match.reply,
            auto_responded_at: now.toISOString(),
          },
          updatedAt: now,
        })
        .where(eq(businessEntities.id, t.id));
      replied.push(t.id);
    }
    return [
      {
        capability: capabilityKey,
        summary:
          replied.length > 0
            ? `Drafted auto-responses for ${replied.length} FAQ-style ticket(s).`
            : "No FAQ-style tickets to auto-respond to.",
        summaryAr:
          replied.length > 0
            ? `تم صياغة ردود تلقائية لـ ${replied.length} تذكرة.`
            : "لا توجد تذاكر متكررة للرد التلقائي عليها.",
        severity: replied.length > 0 ? "action" : "info",
        entityRefs: replied.slice(0, 20),
      },
    ];
  }

  async function runEscalateSlaBreaches(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const tickets = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "helpdesk"),
          eq(businessEntities.entityType, "ticket"),
          eq(businessEntities.status, "open"),
          lte(businessEntities.createdAt, cutoff),
        ),
      );

    const urgent = tickets.filter((t) => {
      const data = (t.data ?? {}) as Record<string, unknown>;
      return data.priority === "urgent";
    });
    if (urgent.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No SLA breaches detected.",
          summaryAr: "لا توجد انتهاكات لمستوى الخدمة.",
          severity: "info",
        },
      ];
    }

    const now = new Date();
    for (const t of urgent) {
      const tags = Array.isArray(t.tags) ? (t.tags as string[]) : [];
      if (tags.includes("sla_breach")) continue;
      await db
        .update(businessEntities)
        .set({
          tags: [...tags, "sla_breach"],
          updatedAt: now,
        })
        .where(eq(businessEntities.id, t.id));
    }
    return [
      {
        capability: capabilityKey,
        summary: `Flagged ${urgent.length} urgent ticket(s) as SLA breaches.`,
        summaryAr: `تم تصعيد ${urgent.length} تذكرة عاجلة كانتهاك لمستوى الخدمة.`,
        severity: "warning",
        entityRefs: urgent.map((t) => t.id).slice(0, 20),
      },
    ];
  }

  async function runFlagNegativeSentiment(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const tickets = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "helpdesk"),
          eq(businessEntities.entityType, "ticket"),
        ),
      )
      .limit(200);

    const negativePatterns =
      /(angry|terrible|awful|disappointed|never|hate|worst|unhappy|frustrated|ridiculous)/i;
    const now = new Date();
    const flagged: string[] = [];
    for (const t of tickets) {
      const subject = t.name ?? "";
      const data = (t.data ?? {}) as Record<string, unknown>;
      const body = typeof data.body === "string" ? data.body : "";
      if (!negativePatterns.test(`${subject} ${body}`)) continue;
      const tags = Array.isArray(t.tags) ? (t.tags as string[]) : [];
      if (tags.includes("negative_sentiment")) continue;
      await db
        .update(businessEntities)
        .set({ tags: [...tags, "negative_sentiment"], updatedAt: now })
        .where(eq(businessEntities.id, t.id));
      flagged.push(t.id);
    }
    return [
      {
        capability: capabilityKey,
        summary:
          flagged.length > 0
            ? `Flagged ${flagged.length} ticket(s) with negative sentiment.`
            : "No negative-sentiment tickets detected.",
        summaryAr:
          flagged.length > 0
            ? `تم رصد ${flagged.length} تذكرة ذات نبرة سلبية.`
            : "لم يتم رصد تذاكر بنبرة سلبية.",
        severity: flagged.length > 0 ? "warning" : "info",
        entityRefs: flagged.slice(0, 20),
      },
    ];
  }

  async function runUpdateKnowledgeBase(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const resolved = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "helpdesk"),
          eq(businessEntities.entityType, "ticket"),
          gte(businessEntities.updatedAt, cutoff),
        ),
      );

    const candidates = resolved.filter(
      (t) => t.status === "resolved" || t.status === "closed",
    );
    if (candidates.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No resolved tickets to draw KB articles from.",
          summaryAr: "لا توجد تذاكر محلولة لاستخراج مقالات منها.",
          severity: "info",
        },
      ];
    }
    const now = new Date();
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: AGENTS_MODULE_KEY,
      entityType: "kb_suggestion",
      name: `KB article suggestions (${now.toISOString().slice(0, 10)})`,
      status: "draft",
      data: {
        ticketIds: candidates.map((t) => t.id).slice(0, 25),
        ticketSubjects: candidates.map((t) => t.name).slice(0, 25),
      },
      tags: ["kb", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    return [
      {
        capability: capabilityKey,
        summary: `Suggested ${Math.min(candidates.length, 25)} KB article(s) from recently resolved tickets.`,
        summaryAr: `تم اقتراح ${Math.min(candidates.length, 25)} مقالة قاعدة معرفة من التذاكر المحلولة مؤخراً.`,
        severity: "action",
      },
    ];
  }

  // Inventory -----------------------------------------------------------------

  async function fetchProducts(companyId: string) {
    return db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "inventory"),
          eq(businessEntities.entityType, "product"),
        ),
      );
  }

  async function runDetectLowStock(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const products = await fetchProducts(companyId);
    const low: string[] = [];
    for (const p of products) {
      const data = (p.data ?? {}) as Record<string, unknown>;
      const stock = typeof data.stockLevel === "number" ? data.stockLevel : null;
      const reorder =
        typeof data.reorderPoint === "number" ? data.reorderPoint : null;
      if (stock === null || reorder === null) continue;
      if (stock <= reorder) low.push(p.id);
    }
    return [
      {
        capability: capabilityKey,
        summary:
          low.length > 0
            ? `Detected ${low.length} product(s) at or below reorder point.`
            : "All product stock levels look healthy.",
        summaryAr:
          low.length > 0
            ? `تم اكتشاف ${low.length} منتج عند أو تحت نقطة إعادة الطلب.`
            : "جميع مستويات المخزون جيدة.",
        severity: low.length > 0 ? "warning" : "info",
        entityRefs: low.slice(0, 20),
      },
    ];
  }

  async function runPredictReorderDates(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const products = await fetchProducts(companyId);
    const now = new Date();
    let predicted = 0;
    for (const p of products) {
      const data = (p.data ?? {}) as Record<string, unknown>;
      const stock = typeof data.stockLevel === "number" ? data.stockLevel : 0;
      const sales30d = typeof data.sales30d === "number" ? data.sales30d : 0;
      if (sales30d <= 0) continue;
      const dailyVelocity = sales30d / 30;
      const daysLeft = Math.max(0, Math.floor(stock / Math.max(dailyVelocity, 0.01)));
      const eta = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000);
      await db
        .update(businessEntities)
        .set({
          data: { ...data, predictedStockoutDate: eta.toISOString().slice(0, 10) },
          updatedAt: now,
        })
        .where(eq(businessEntities.id, p.id));
      predicted += 1;
    }
    return [
      {
        capability: capabilityKey,
        summary:
          predicted > 0
            ? `Predicted reorder dates for ${predicted} product(s).`
            : "No products with sales velocity to predict from.",
        summaryAr:
          predicted > 0
            ? `تم التنبؤ بمواعيد إعادة الطلب لـ ${predicted} منتج.`
            : "لا توجد منتجات بحركة مبيعات كافية للتنبؤ.",
        severity: predicted > 0 ? "action" : "info",
      },
    ];
  }

  async function runSuggestPurchaseOrders(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const products = await fetchProducts(companyId);
    const lowProducts = products.filter((p) => {
      const data = (p.data ?? {}) as Record<string, unknown>;
      const stock = typeof data.stockLevel === "number" ? data.stockLevel : null;
      const reorder =
        typeof data.reorderPoint === "number" ? data.reorderPoint : null;
      return stock !== null && reorder !== null && stock <= reorder;
    });
    if (lowProducts.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No purchase orders needed right now.",
          summaryAr: "لا حاجة لأوامر شراء حالياً.",
          severity: "info",
        },
      ];
    }
    const now = new Date();
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: AGENTS_MODULE_KEY,
      entityType: "po_suggestion",
      name: `Suggested PO (${now.toISOString().slice(0, 10)})`,
      status: "draft",
      data: {
        items: lowProducts.map((p) => {
          const data = (p.data ?? {}) as Record<string, unknown>;
          const reorder =
            typeof data.reorderPoint === "number" ? data.reorderPoint : 10;
          return {
            productId: p.id,
            productName: p.name,
            quantity: Math.max(reorder * 2, 10),
          };
        }),
      },
      tags: ["po", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    return [
      {
        capability: capabilityKey,
        summary: `Drafted purchase order suggestion covering ${lowProducts.length} product(s).`,
        summaryAr: `تم اقتراح أمر شراء يغطي ${lowProducts.length} منتج.`,
        severity: "action",
        entityRefs: lowProducts.map((p) => p.id).slice(0, 20),
      },
    ];
  }

  async function runIdentifyDeadStock(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const products = await fetchProducts(companyId);
    const now = new Date();
    const dead: string[] = [];
    for (const p of products) {
      const data = (p.data ?? {}) as Record<string, unknown>;
      const sales30d = typeof data.sales30d === "number" ? data.sales30d : 0;
      const sales90d = typeof data.sales90d === "number" ? data.sales90d : sales30d;
      if (sales90d === 0) {
        const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
        if (!tags.includes("dead_stock")) {
          await db
            .update(businessEntities)
            .set({ tags: [...tags, "dead_stock"], updatedAt: now })
            .where(eq(businessEntities.id, p.id));
        }
        dead.push(p.id);
      }
    }
    return [
      {
        capability: capabilityKey,
        summary:
          dead.length > 0
            ? `Identified ${dead.length} dead-stock product(s).`
            : "No dead-stock products identified.",
        summaryAr:
          dead.length > 0
            ? `تم تحديد ${dead.length} منتج راكد.`
            : "لا توجد منتجات راكدة.",
        severity: dead.length > 0 ? "warning" : "info",
        entityRefs: dead.slice(0, 20),
      },
    ];
  }

  async function runOptimizePricing(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const products = await fetchProducts(companyId);
    if (products.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No products to analyze.",
          summaryAr: "لا توجد منتجات للتحليل.",
          severity: "info",
        },
      ];
    }
    const suggestions: Array<{ productId: string; action: string; reason: string }> = [];
    for (const p of products) {
      const data = (p.data ?? {}) as Record<string, unknown>;
      const margin =
        typeof data.marginPercent === "number" ? data.marginPercent : 0;
      const sales30d =
        typeof data.sales30d === "number" ? data.sales30d : 0;
      if (margin < 20 && sales30d > 10) {
        suggestions.push({
          productId: p.id,
          action: "raise_price",
          reason: "Low margin + high velocity",
        });
      } else if (margin > 40 && sales30d < 3) {
        suggestions.push({
          productId: p.id,
          action: "discount",
          reason: "High margin + slow velocity",
        });
      }
    }
    if (suggestions.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "Current pricing looks balanced.",
          summaryAr: "التسعير الحالي متوازن.",
          severity: "info",
        },
      ];
    }
    const now = new Date();
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: AGENTS_MODULE_KEY,
      entityType: "pricing_suggestion",
      name: `Pricing suggestions (${now.toISOString().slice(0, 10)})`,
      status: "draft",
      data: { suggestions },
      tags: ["pricing", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    return [
      {
        capability: capabilityKey,
        summary: `Drafted ${suggestions.length} pricing suggestion(s).`,
        summaryAr: `تم اقتراح ${suggestions.length} تعديل سعر.`,
        severity: "action",
        entityRefs: suggestions.map((s) => s.productId).slice(0, 20),
      },
    ];
  }

  // Marketing -----------------------------------------------------------------

  async function runGenerateCampaignDrafts(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const now = new Date();
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "marketing",
      entityType: "campaign",
      name: `Weekly campaign — ${now.toISOString().slice(0, 10)}`,
      status: "draft",
      data: {
        autoGenerated: true,
        plannedFor: now.toISOString().slice(0, 10),
        outline:
          "Highlight a customer success story, share a product update, end with a CTA to book a demo.",
      },
      tags: ["weekly", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    return [
      {
        capability: capabilityKey,
        summary: "Drafted this week's marketing campaign.",
        summaryAr: "تم إعداد حملة هذا الأسبوع.",
        severity: "action",
      },
    ];
  }

  async function runSegmentAudiences(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const invoices = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
          eq(businessEntities.status, "paid"),
        ),
      );

    const byCustomer = new Map<string, number>();
    for (const inv of invoices) {
      const data = (inv.data ?? {}) as Record<string, unknown>;
      const customer =
        typeof data.customerId === "string"
          ? data.customerId
          : typeof data.customer === "string"
            ? data.customer
            : "";
      if (!customer) continue;
      byCustomer.set(
        customer,
        (byCustomer.get(customer) ?? 0) + (inv.amountCents ?? 0),
      );
    }

    const segments: Record<string, string[]> = {
      vip: [],
      active: [],
      cold: [],
    };
    const values = [...byCustomer.entries()];
    values.sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < values.length; i += 1) {
      const [customer] = values[i]!;
      if (i < Math.ceil(values.length * 0.1)) segments.vip!.push(customer);
      else if (i < Math.ceil(values.length * 0.6)) segments.active!.push(customer);
      else segments.cold!.push(customer);
    }
    const now = new Date();
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "marketing",
      entityType: "segment",
      name: `Auto-segments ${now.toISOString().slice(0, 10)}`,
      status: "ready",
      data: { segments },
      tags: ["segment", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    return [
      {
        capability: capabilityKey,
        summary: `Built audience segments: VIP ${segments.vip!.length}, Active ${segments.active!.length}, Cold ${segments.cold!.length}.`,
        summaryAr: `تم إنشاء شرائح الجمهور.`,
        severity: "action",
      },
    ];
  }

  async function runAnalyzeCampaignPerformance(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const campaigns = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "marketing"),
          eq(businessEntities.entityType, "campaign"),
          gte(businessEntities.createdAt, cutoff),
        ),
      );

    if (campaigns.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No campaigns ran in the past week.",
          summaryAr: "لم تتم أي حملات خلال الأسبوع الماضي.",
          severity: "info",
        },
      ];
    }
    return [
      {
        capability: capabilityKey,
        summary: `Reviewed ${campaigns.length} campaign(s) from the past week.`,
        summaryAr: `تمت مراجعة ${campaigns.length} حملة من الأسبوع الماضي.`,
        severity: "info",
        entityRefs: campaigns.map((c) => c.id).slice(0, 20),
      },
    ];
  }

  async function runSuggestContentCalendar(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const now = new Date();
    const plan = Array.from({ length: 7 }).map((_, i) => {
      const day = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const themes = [
        "Customer story",
        "Product tip",
        "Industry insight",
        "Behind the scenes",
        "Feature spotlight",
        "Team highlight",
        "Weekend recap",
      ];
      return { date: day.toISOString().slice(0, 10), theme: themes[i] };
    });
    await db.insert(businessEntities).values({
      companyId,
      moduleKey: "marketing",
      entityType: "content_calendar",
      name: `Content calendar — week of ${now.toISOString().slice(0, 10)}`,
      status: "draft",
      data: { plan },
      tags: ["calendar", "auto"],
      createdAt: now,
      updatedAt: now,
    });
    return [
      {
        capability: capabilityKey,
        summary: "Drafted a 7-day content calendar.",
        summaryAr: "تم إعداد تقويم محتوى لمدة 7 أيام.",
        severity: "action",
      },
    ];
  }

  async function runPersonalizeOutreach(
    companyId: string,
    capabilityKey: string,
  ): Promise<AgentRunAction[]> {
    const invoices = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "sales"),
          eq(businessEntities.entityType, "invoice"),
          eq(businessEntities.status, "paid"),
        ),
      );
    const byCustomer = new Map<string, number>();
    for (const inv of invoices) {
      const data = (inv.data ?? {}) as Record<string, unknown>;
      const cust =
        typeof data.customerId === "string"
          ? data.customerId
          : typeof data.customer === "string"
            ? data.customer
            : "";
      if (!cust) continue;
      byCustomer.set(cust, (byCustomer.get(cust) ?? 0) + (inv.amountCents ?? 0));
    }
    const top = [...byCustomer.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (top.length === 0) {
      return [
        {
          capability: capabilityKey,
          summary: "No top customers to personalize outreach for yet.",
          summaryAr: "لا يوجد عملاء كبار لتخصيص الرسائل لهم بعد.",
          severity: "info",
        },
      ];
    }
    const now = new Date();
    for (const [customer, value] of top) {
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: AGENTS_MODULE_KEY,
        entityType: "outreach_draft",
        name: `Outreach: ${customer}`,
        status: "draft",
        data: {
          customer,
          message:
            `Hi ${customer}, thanks for being one of our top customers — we appreciate the partnership. ` +
            `If there's anything we can do to make your experience even better, just reply. We're here.`,
          ltvCents: value,
        },
        tags: ["outreach", "auto"],
        createdAt: now,
        updatedAt: now,
      });
    }
    return [
      {
        capability: capabilityKey,
        summary: `Drafted personalized outreach for ${top.length} top customer(s).`,
        summaryAr: `تم تخصيص رسائل لـ ${top.length} من العملاء الكبار.`,
        severity: "action",
      },
    ];
  }

  // Capability registry -------------------------------------------------------

  const CAPABILITY_REGISTRY: Record<string, CapabilityRunner> = {
    categorize_uncategorized_expenses: runCategorizeUncategorizedExpenses,
    detect_duplicate_expenses: runDetectDuplicateExpenses,
    flag_expense_anomalies: runFlagExpenseAnomalies,
    prepare_vat_summary: runPrepareVatSummary,
    reconcile_invoice_payments: runReconcileInvoicePayments,
    follow_up_stale_deals: runFollowUpStaleDeals,
    nurture_cold_leads: runNurtureColdLeads,
    suggest_next_action: runSuggestNextActionPerDeal,
    prioritize_pipeline: runPrioritizePipeline,
    draft_proposal_email: runDraftProposalEmail,
    classify_new_tickets: runClassifyNewTickets,
    auto_respond_simple_tickets: runAutoRespondSimpleTickets,
    escalate_sla_breaches: runEscalateSlaBreaches,
    flag_negative_sentiment: runFlagNegativeSentiment,
    update_knowledge_base: runUpdateKnowledgeBase,
    detect_low_stock: runDetectLowStock,
    predict_reorder_dates: runPredictReorderDates,
    suggest_purchase_orders: runSuggestPurchaseOrders,
    identify_dead_stock: runIdentifyDeadStock,
    optimize_pricing: runOptimizePricing,
    generate_campaign_drafts: runGenerateCampaignDrafts,
    segment_audiences: runSegmentAudiences,
    analyze_campaign_performance: runAnalyzeCampaignPerformance,
    suggest_content_calendar: runSuggestContentCalendar,
    personalize_outreach: runPersonalizeOutreach,
  };

  // -------------------------------------------------------------------------
  // Run
  // -------------------------------------------------------------------------

  async function runNow(
    companyId: string,
    agentSlug: string,
  ): Promise<AgentRunResult> {
    const def = getBusinessAgentDefinition(agentSlug);
    if (!def) throw new Error(`Unknown agent: ${agentSlug}`);
    const hiredRow = await fetchHiredRow(companyId, agentSlug);
    if (!hiredRow) throw new Error(`Agent not hired: ${agentSlug}`);
    const hired = rowToHiredAgent(hiredRow);

    const startedAt = new Date();
    const actions: AgentRunAction[] = [];
    const errors: string[] = [];

    const capsToRun =
      hired.enabledCapabilities.length > 0
        ? hired.enabledCapabilities
        : def.capabilities.map((c) => c.key);

    // Memory-driven biases: skip capabilities that historically perform poorly.
    const suppressed = await getSuppressedCapabilities(companyId, agentSlug);

    const runIdPlaceholder = `${agentSlug}-${startedAt.toISOString()}`;
    for (const capKey of capsToRun) {
      const runner = CAPABILITY_REGISTRY[capKey];
      if (!runner) {
        errors.push(`Unknown capability: ${capKey}`);
        continue;
      }
      if (suppressed.has(capKey)) {
        actions.push({
          capability: capKey,
          summary: `Skipped — recent performance for this skill was below threshold.`,
          summaryAr: `تم التخطي — أداء هذه المهارة مؤخراً كان دون المستوى.`,
          severity: "info",
        });
        continue;
      }
      try {
        const out = await runner(companyId, capKey);
        // Best-effort: record each emitted action in agent memory so the UI
        // can later prompt for feedback on the suggestion.
        await recordActionsToMemory(companyId, agentSlug, runIdPlaceholder, out);
        actions.push(...out);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${capKey}: ${msg}`);
      }
    }
    const finishedAt = new Date();
    const status: AgentRunStatus =
      errors.length === 0
        ? "success"
        : actions.length === 0
          ? "failed"
          : "partial";

    const runResult: AgentRunResult = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      actions,
      errors: errors.length > 0 ? errors : undefined,
    };

    // Persist run row
    const [runRow] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: AGENTS_MODULE_KEY,
        entityType: AGENT_RUN_TYPE,
        parentId: hiredRow.id,
        name: `${def.personaName} run @ ${finishedAt.toISOString()}`,
        status,
        data: runResult as unknown as Record<string, unknown>,
        tags: ["agent_run", agentSlug],
        createdAt: finishedAt,
        updatedAt: finishedAt,
      })
      .returning();
    if (runRow) runResult.id = runRow.id;

    // Update hired agent counters
    const actionCount = actions.filter(
      (a) => a.severity === "action" || a.severity === "warning",
    ).length;
    await patchHired(companyId, agentSlug, {
      lastRunAt: finishedAt.toISOString(),
      lastRunStatus: status,
      runCount: hired.runCount + 1,
      actionsCount: hired.actionsCount + actionCount,
    });

    return runResult;
  }

  async function listRuns(
    companyId: string,
    agentSlug: string,
    opts: { limit?: number } = {},
  ): Promise<AgentRunResult[]> {
    const hiredRow = await fetchHiredRow(companyId, agentSlug);
    if (!hiredRow) return [];
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, AGENTS_MODULE_KEY),
          eq(businessEntities.entityType, AGENT_RUN_TYPE),
          eq(businessEntities.parentId, hiredRow.id),
        ),
      )
      .orderBy(desc(businessEntities.createdAt))
      .limit(limit);
    return rows.map((r) => {
      const data = (r.data ?? {}) as AgentRunResult;
      return { ...data, id: r.id };
    });
  }

  async function getRun(
    companyId: string,
    agentSlug: string,
    runId: string,
  ): Promise<AgentRunResult | null> {
    const hiredRow = await fetchHiredRow(companyId, agentSlug);
    if (!hiredRow) return null;
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, runId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, AGENTS_MODULE_KEY),
          eq(businessEntities.entityType, AGENT_RUN_TYPE),
          eq(businessEntities.parentId, hiredRow.id),
        ),
      );
    if (!row) return null;
    const data = (row.data ?? {}) as AgentRunResult;
    return { ...data, id: row.id };
  }

  function getDefinition(agentSlug: string): BusinessAgentDefinition | undefined {
    return getBusinessAgentDefinition(agentSlug);
  }

  return {
    listHired,
    getHired,
    hire,
    fire,
    pause,
    resume,
    updateCapabilities,
    updateSchedule,
    runNow,
    listRuns,
    getRun,
    getDefinition,
  };
}

export const BUSINESS_AGENTS_CONSTANTS = {
  moduleKey: AGENTS_MODULE_KEY,
  hiredAgentType: HIRED_AGENT_TYPE,
  agentRunType: AGENT_RUN_TYPE,
  catalog: BUSINESS_AGENTS,
};

// Re-export schedule type for downstream consumers.
export type { BusinessAgentSchedule };
