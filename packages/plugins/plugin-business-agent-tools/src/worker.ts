import {
  definePlugin,
  runWorker,
  type PluginContext,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";
import { DEFAULT_SERVER_URL, PLUGIN_ID, TOOL_NAMES } from "./constants.js";
import { evaluatePolicy, type PolicyConfig, type ProposedAction } from "./policy.js";

type PluginConfig = {
  serverUrl?: string;
  requireApprovalForFinance?: boolean;
  moneyApprovalThresholdMinor?: number;
  requireApprovalForDeletes?: boolean;
};

async function getConfig(ctx: PluginContext): Promise<PluginConfig> {
  const cfg = (await ctx.config.get()) as PluginConfig | null;
  return {
    serverUrl: cfg?.serverUrl ?? DEFAULT_SERVER_URL,
    requireApprovalForFinance: cfg?.requireApprovalForFinance ?? true,
    moneyApprovalThresholdMinor: cfg?.moneyApprovalThresholdMinor ?? 0,
    requireApprovalForDeletes: cfg?.requireApprovalForDeletes ?? true,
  };
}

/**
 * Run the risk-tiered policy gate. If the action requires approval, create an
 * approval issue (human-in-the-loop) and return a result telling the agent it
 * is parked. Returns null when the action is allowed to proceed.
 */
async function runPolicyGate(
  ctx: PluginContext,
  runCtx: ToolRunContext,
  action: ProposedAction & { entityType: string; name?: string; currency?: string | null },
  config: PolicyConfig,
): Promise<ToolResult | null> {
  const decision = evaluatePolicy(action, config);
  if (decision.rule === "allow") return null;

  if (decision.rule === "deny") {
    ctx.logger.info("policy gate: DENIED", { actionKey: decision.actionKey, tier: decision.tier });
    return { error: `Action denied by policy (${decision.actionKey}, ${decision.tier}): ${decision.reason}` };
  }

  // rule === "approve" → park as an approval issue
  try {
    const approvalIssue = await ctx.issues.create({
      companyId: runCtx.companyId,
      projectId: runCtx.projectId,
      title: `[Approval Required · ${decision.tier}] ${action.operation} ${action.entityType} in ${action.moduleKey}${action.name ? `: ${action.name}` : ""}`,
      description: [
        `An agent (run: ${runCtx.runId}) requested a **${decision.actionKey}** action that requires human approval.`,
        ``,
        `**Risk tier:** ${decision.tier}`,
        `**Reason:** ${decision.reason}`,
        `**Module:** ${action.moduleKey}`,
        `**Entity Type:** ${action.entityType}`,
        action.name ? `**Name:** ${action.name}` : null,
        action.amountMinor != null
          ? `**Amount:** ${action.amountMinor} minor units (${action.currency ?? "unknown currency"})`
          : null,
        ``,
        `Review and approve or reject before the agent proceeds.`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    ctx.logger.info("policy gate: approval issue created", {
      issueId: approvalIssue.id,
      actionKey: decision.actionKey,
      tier: decision.tier,
    });
    return {
      content: `${decision.actionKey} action (${decision.tier} risk) requires approval. Created approval issue: ${approvalIssue.title} (ID: ${approvalIssue.id})`,
      data: { approvalIssueId: approvalIssue.id, requiresApproval: true, tier: decision.tier },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to create approval issue: ${message}` };
  }
}

async function businessFetch(
  ctx: PluginContext,
  companyId: string,
  path: string,
  options?: RequestInit,
): Promise<unknown> {
  const config = await getConfig(ctx);
  const url = `${config.serverUrl}/api/companies/${companyId}/business${path}`;
  const res = await ctx.http.fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...((options?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Business API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Tool handler: business.query
// ---------------------------------------------------------------------------

async function handleBusinessQuery(
  ctx: PluginContext,
  params: unknown,
  runCtx: ToolRunContext,
): Promise<ToolResult> {
  const p = params as {
    moduleKey?: string;
    entityType?: string;
    status?: string;
    search?: string;
    limit?: number;
  };

  if (!p.moduleKey || !p.entityType) {
    return { error: "moduleKey and entityType are required" };
  }

  const qsParts: string[] = [];
  if (p.status) qsParts.push(`status=${encodeURIComponent(p.status)}`);
  if (p.search) qsParts.push(`search=${encodeURIComponent(p.search)}`);
  if (p.limit != null) qsParts.push(`limit=${encodeURIComponent(String(p.limit))}`);
  const qs = qsParts.length > 0 ? `?${qsParts.join("&")}` : "";

  try {
    const result = (await businessFetch(
      ctx,
      runCtx.companyId,
      `/${p.moduleKey}/${p.entityType}${qs}`,
    )) as { entities?: unknown[] };

    const records = Array.isArray(result?.entities) ? result.entities : [];
    ctx.logger.info("business.query succeeded", {
      moduleKey: p.moduleKey,
      entityType: p.entityType,
      count: records.length,
    });

    return {
      content: `Found ${records.length} records in ${p.moduleKey}/${p.entityType}`,
      data: records,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Tool handler: business.get
// ---------------------------------------------------------------------------

async function handleBusinessGet(
  ctx: PluginContext,
  params: unknown,
  runCtx: ToolRunContext,
): Promise<ToolResult> {
  const p = params as {
    moduleKey?: string;
    entityType?: string;
    id?: string;
    code?: string;
  };

  if (!p.moduleKey || !p.entityType) {
    return { error: "moduleKey and entityType are required" };
  }
  if (!p.id && !p.code) {
    return { error: "Either id or code must be provided" };
  }

  const qs = p.id
    ? `?id=${encodeURIComponent(p.id)}`
    : `?code=${encodeURIComponent(p.code!)}`;

  try {
    const result = await businessFetch(
      ctx,
      runCtx.companyId,
      `/${p.moduleKey}/${p.entityType}${qs}`,
    );

    if (!result) {
      return { error: "Entity not found" };
    }

    ctx.logger.info("business.get succeeded", {
      moduleKey: p.moduleKey,
      entityType: p.entityType,
    });

    return {
      content: `Retrieved ${p.entityType} from ${p.moduleKey}`,
      data: result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Tool handler: business.create
// ---------------------------------------------------------------------------

async function handleBusinessCreate(
  ctx: PluginContext,
  params: unknown,
  runCtx: ToolRunContext,
): Promise<ToolResult> {
  const p = params as {
    moduleKey?: string;
    entityType?: string;
    name?: string;
    status?: string;
    amountCents?: number;
    currency?: string;
    data?: Record<string, unknown>;
    tags?: string[];
  };

  if (!p.moduleKey || !p.entityType) {
    return { error: "moduleKey and entityType are required" };
  }
  if (!p.name) {
    return { error: "name is required" };
  }

  const config = await getConfig(ctx);

  // Risk-tiered policy gate (money/delete/legal → human approval)
  const gate = await runPolicyGate(
    ctx,
    runCtx,
    {
      moduleKey: p.moduleKey,
      operation: "create",
      amountMinor: p.amountCents ?? null,
      entityType: p.entityType,
      name: p.name,
      currency: p.currency ?? null,
    },
    config,
  );
  if (gate) return gate;

  const body: Record<string, unknown> = { name: p.name };
  if (p.status != null) body.status = p.status;
  if (p.amountCents != null) body.amountCents = p.amountCents;
  if (p.currency != null) body.currency = p.currency;
  if (p.data != null) body.data = p.data;
  if (p.tags != null) body.tags = p.tags;

  try {
    const created = await businessFetch(
      ctx,
      runCtx.companyId,
      `/${p.moduleKey}/${p.entityType}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    ctx.logger.info("business.create succeeded", {
      moduleKey: p.moduleKey,
      entityType: p.entityType,
    });

    return {
      content: `Created ${p.entityType} in ${p.moduleKey}`,
      data: created,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Tool handler: business.update
// ---------------------------------------------------------------------------

async function handleBusinessUpdate(
  ctx: PluginContext,
  params: unknown,
  runCtx: ToolRunContext,
): Promise<ToolResult> {
  const p = params as {
    moduleKey?: string;
    entityType?: string;
    id?: string;
    name?: string;
    status?: string;
    amountCents?: number;
    currency?: string;
    data?: Record<string, unknown>;
    tags?: string[];
  };

  if (!p.moduleKey || !p.entityType) {
    return { error: "moduleKey and entityType are required" };
  }
  if (!p.id) {
    return { error: "id is required for update" };
  }

  const config = await getConfig(ctx);

  // Risk-tiered policy gate (money/delete/legal → human approval)
  const gate = await runPolicyGate(
    ctx,
    runCtx,
    {
      moduleKey: p.moduleKey,
      operation: "update",
      amountMinor: p.amountCents ?? null,
      entityType: p.entityType,
      name: p.name,
      currency: p.currency ?? null,
    },
    config,
  );
  if (gate) return gate;

  const body: Record<string, unknown> = {};
  if (p.name != null) body.name = p.name;
  if (p.status != null) body.status = p.status;
  if (p.amountCents != null) body.amountCents = p.amountCents;
  if (p.currency != null) body.currency = p.currency;
  if (p.data != null) body.data = p.data;
  if (p.tags != null) body.tags = p.tags;

  try {
    const updated = await businessFetch(
      ctx,
      runCtx.companyId,
      `/${p.moduleKey}/${p.entityType}/${p.id}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );

    ctx.logger.info("business.update succeeded", {
      moduleKey: p.moduleKey,
      entityType: p.entityType,
      id: p.id,
    });

    return {
      content: `Updated ${p.entityType} ${p.id} in ${p.moduleKey}`,
      data: updated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Tool handler: business.summary
// ---------------------------------------------------------------------------

async function handleBusinessSummary(
  ctx: PluginContext,
  _params: unknown,
  runCtx: ToolRunContext,
): Promise<ToolResult> {
  try {
    const result = (await businessFetch(
      ctx,
      runCtx.companyId,
      "/summary",
    )) as Record<string, unknown>;

    ctx.logger.info("business.summary succeeded");

    // Format the summary as a markdown bullet list
    const lines: string[] = ["**Business Summary**", ""];
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === "number" || typeof value === "string") {
        lines.push(`- **${key}**: ${value}`);
      } else if (typeof value === "object" && value !== null) {
        lines.push(`- **${key}**: ${JSON.stringify(value)}`);
      }
    }

    return {
      content: lines.join("\n"),
      data: result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    // Subscribe to events
    ctx.events.on("issue.created", async (event) => {
      ctx.logger.info("event observed", { eventId: event.eventId, eventType: event.eventType });
    });

    // Register tool: business.query
    ctx.tools.register(
      TOOL_NAMES.businessQuery,
      {
        displayName: "Business Query",
        description:
          "List entities from a Business Management module.",
        parametersSchema: {
          type: "object",
          properties: {
            moduleKey: {
              type: "string",
              enum: [
                "crm",
                "sales",
                "inventory",
                "finance",
                "purchasing",
                "hr",
                "projects",
                "support",
              ],
            },
            entityType: { type: "string" },
            status: { type: "string" },
            search: { type: "string" },
            limit: { type: "number" },
          },
          required: ["moduleKey", "entityType"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        return handleBusinessQuery(ctx, params, runCtx);
      },
    );

    // Register tool: business.get
    ctx.tools.register(
      TOOL_NAMES.businessGet,
      {
        displayName: "Business Get",
        description: "Retrieve a single entity from a Business Management module by ID or code.",
        parametersSchema: {
          type: "object",
          properties: {
            moduleKey: {
              type: "string",
              enum: [
                "crm",
                "sales",
                "inventory",
                "finance",
                "purchasing",
                "hr",
                "projects",
                "support",
              ],
            },
            entityType: { type: "string" },
            id: { type: "string" },
            code: { type: "string" },
          },
          required: ["moduleKey", "entityType"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        return handleBusinessGet(ctx, params, runCtx);
      },
    );

    // Register tool: business.create
    ctx.tools.register(
      TOOL_NAMES.businessCreate,
      {
        displayName: "Business Create",
        description:
          "Create a new entity in a Business Management module. Finance and sales writes may require approval.",
        parametersSchema: {
          type: "object",
          properties: {
            moduleKey: {
              type: "string",
              enum: [
                "crm",
                "sales",
                "inventory",
                "finance",
                "purchasing",
                "hr",
                "projects",
                "support",
              ],
            },
            entityType: { type: "string" },
            name: { type: "string" },
            status: { type: "string" },
            amountCents: { type: "number" },
            currency: { type: "string" },
            data: { type: "object" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["moduleKey", "entityType", "name"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        return handleBusinessCreate(ctx, params, runCtx);
      },
    );

    // Register tool: business.update
    ctx.tools.register(
      TOOL_NAMES.businessUpdate,
      {
        displayName: "Business Update",
        description:
          "Update an existing entity in a Business Management module. Finance and sales writes may require approval.",
        parametersSchema: {
          type: "object",
          properties: {
            moduleKey: {
              type: "string",
              enum: [
                "crm",
                "sales",
                "inventory",
                "finance",
                "purchasing",
                "hr",
                "projects",
                "support",
              ],
            },
            entityType: { type: "string" },
            id: { type: "string" },
            name: { type: "string" },
            status: { type: "string" },
            amountCents: { type: "number" },
            currency: { type: "string" },
            data: { type: "object" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["moduleKey", "entityType", "id"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        return handleBusinessUpdate(ctx, params, runCtx);
      },
    );

    // Register tool: business.summary
    ctx.tools.register(
      TOOL_NAMES.businessSummary,
      {
        displayName: "Business Summary",
        description:
          "Return aggregate entity counts per Business Management module for the current company.",
        parametersSchema: {
          type: "object",
          properties: {},
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        return handleBusinessSummary(ctx, params, runCtx);
      },
    );

    ctx.logger.info(`${PLUGIN_ID}: 5 tools registered`);
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
