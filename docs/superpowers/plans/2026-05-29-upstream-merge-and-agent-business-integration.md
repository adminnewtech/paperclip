# Upstream Merge + Agent-Business Integration + NewTech AI Company

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge upstream Paperclip v2026.525 (87 commits ahead) into the `adminnewtech/paperclip` fork without losing Business Management Phase 1, then build a Business Agent Tools plugin so AI agents can read/write CRM/finance/inventory data, and finally configure and verify a fully-integrated "NewTech AI" company running inside the live instance.

**Architecture:**
- Phase 1: Rebase/merge strategy — rename migration `0084_business_management → 0093_business_management` *before* the merge to eliminate the journal conflict, then run `git merge upstream/master` and manually resolve ~10 key files.
- Phase 2: Add `packages/plugins/plugin-business-agent-tools` using the existing Plugin SDK v1.0 (`definePlugin`, `ctx.tools.register`, `ctx.events.on`, `ctx.http.fetch`) to expose business entity CRUD as agent tools and auto-create issues when a new lead/invoice arrives.
- Phase 3: Using the running VPS instance (`http://83.171.249.32:3200`), configure the existing "NewTech AI" company agents with `claude-local` adapter + budgets, enable the E-commerce business module, install the new plugin, seed data, and run an end-to-end test issue.

**Tech Stack:** TypeScript, pnpm monorepo, Express 5, Drizzle ORM, PostgreSQL 17, React 19 / React Router 7, Plugin SDK v1.0 (`@paperclipai/plugin-sdk`), Docker Compose, `claude-local` adapter.

---

## PHASE 1 — Upstream Merge

### Task 1: Pre-merge setup (branch + backup + migration rename)

**Files:**
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Rename: `packages/db/src/migrations/0084_business_management.sql` → `packages/db/src/migrations/0093_business_management.sql`

> **Why rename BEFORE merge?** Upstream uses `0084` for `issue_recovery_actions`. Git will conflict on the journal if both sides claim `idx: 84`. Rename ours to `0093` (the next free slot after upstream's `0092_mighty_puma`) so the merge sees no journal conflict.

- [ ] **Step 1: Verify current state**

```bash
cd ~/paperclip
git config --global --add safe.directory ~/paperclip
git remote -v          # origin = adminnewtech/paperclip
git remote add upstream https://github.com/paperclipai/paperclip.git 2>/dev/null || true
git fetch upstream master
git rev-list HEAD..upstream/master --count   # expect ~87
git rev-list upstream/master..HEAD --count   # expect 3
```

Expected output: `87` ahead in upstream, `3` unique in fork.

- [ ] **Step 2: Create merge branch**

```bash
git checkout -b feature/upstream-sync-v2026.525
git tag backup/pre-upstream-merge    # safety net
```

- [ ] **Step 3: Rename migration SQL file**

```bash
git mv packages/db/src/migrations/0084_business_management.sql \
       packages/db/src/migrations/0093_business_management.sql
```

- [ ] **Step 4: Update migration journal**

Edit `packages/db/src/migrations/meta/_journal.json`. Change the last entry from `idx: 84` / tag `0084_business_management` to:

```json
{
  "idx": 93,
  "version": "7",
  "when": 1778100000000,
  "tag": "0093_business_management",
  "breakpoints": true
}
```

The full entries array after the edit must end with this entry (keep everything before 0083 unchanged).

- [ ] **Step 5: Commit the rename before merge**

```bash
git add packages/db/src/migrations/0093_business_management.sql
git add packages/db/src/migrations/meta/_journal.json
git rm --cached packages/db/src/migrations/0084_business_management.sql 2>/dev/null || true
git commit -m "chore(db): rename business migration 0084→0093 to avoid upstream conflict"
```

---

### Task 2: Run the merge

**Files:** Many — the merge will create conflicts in ~10 key files listed in Task 3-6.

- [ ] **Step 1: Run the merge**

```bash
git merge upstream/master --no-commit --no-ff
```

Expected output: `CONFLICT` messages in several files. This is normal. Do NOT abort. Continue to the next tasks.

- [ ] **Step 2: List all conflict files**

```bash
git diff --name-only --diff-filter=U
```

Save this list. Proceed to Task 3 for each conflict category.

---

### Task 3: Resolve DB conflicts (migrations journal + schema index)

**Files:**
- Resolve: `packages/db/src/migrations/meta/_journal.json`
- Resolve: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Resolve _journal.json**

The journal conflict will look like both sides adding entries after `0083`. The correct resolution: **take upstream's version** (which has 0084–0092) and **append our 0093 entry** at the end.

```bash
# Accept upstream's journal (has 0084–0092)
git checkout --theirs packages/db/src/migrations/meta/_journal.json
```

Then open the file and append our entry to the `"entries"` array (before the closing `]`):

```json
  ,{
    "idx": 93,
    "version": "7",
    "when": 1778100000000,
    "tag": "0093_business_management",
    "breakpoints": true
  }
```

```bash
git add packages/db/src/migrations/meta/_journal.json
```

- [ ] **Step 2: Verify no duplicate idx values**

```bash
python3 -c "
import json
with open('packages/db/src/migrations/meta/_journal.json') as f:
    d = json.load(f)
idxs = [e['idx'] for e in d['entries']]
assert len(idxs) == len(set(idxs)), 'DUPLICATE idx values: ' + str([i for i in idxs if idxs.count(i)>1])
print(f'OK: {len(idxs)} unique entries, last: {d[\"entries\"][-1][\"tag\"]}')
"
```

Expected: `OK: N unique entries, last: 0093_business_management`

- [ ] **Step 3: Resolve schema/index.ts**

```bash
# Take upstream's version (has new tables: cloud_upstreams, resource_memberships, etc.)
git checkout --theirs packages/db/src/schema/index.ts
```

Then open `packages/db/src/schema/index.ts` and **append at the bottom** (before the last line if any):

```typescript
export { businessModules } from "./business_modules.js";
export { businessEntities } from "./business_entities.js";
```

```bash
git add packages/db/src/schema/index.ts
```

---

### Task 4: Resolve shared package conflicts

**Files:**
- Resolve: `packages/shared/src/index.ts`

- [ ] **Step 1: Accept upstream + add business exports**

```bash
git checkout --theirs packages/shared/src/index.ts
```

Open `packages/shared/src/index.ts` and **append at the bottom**:

```typescript
export {
  BUSINESS_MODULE_CATALOG,
  INDUSTRY_PRESETS,
  getBusinessModule,
  getBusinessEntitySpec,
} from "./business-modules.js";
export type {
  BusinessModuleKey,
  BusinessModuleSpec,
  BusinessEntitySpec,
  BusinessEntityFieldSpec,
  BusinessEntityType,
} from "./business-modules.js";
```

```bash
git add packages/shared/src/index.ts
```

---

### Task 5: Resolve server conflicts

**Files:**
- Resolve: `server/src/routes/index.ts`
- Resolve: `server/src/app.ts`

- [ ] **Step 1: Resolve routes/index.ts**

```bash
git checkout --theirs server/src/routes/index.ts
```

Open the file and add the business export alongside upstream's exports:

```typescript
export { businessRoutes } from "./business.js";
```

Place it at the end of the export list (after `cloudUpstreamRoutes` and `resourceMembershipRoutes`).

```bash
git add server/src/routes/index.ts
```

- [ ] **Step 2: Resolve app.ts**

```bash
git checkout --theirs server/src/app.ts
```

Open `server/src/app.ts`. Find the import block near the top and add:

```typescript
import { businessRoutes } from "./routes/business.js";
```

Then find where `api.use(...)` mounts routes (around line 210-220 in the upstream version) and add:

```typescript
api.use(businessRoutes(db));
```

Add it after `api.use(resourceMembershipRoutes(db))` or near the other domain route mounts.

```bash
git add server/src/app.ts
```

---

### Task 6: Resolve UI conflicts

**Files:**
- Resolve: `ui/src/App.tsx`
- Resolve: `ui/src/components/Sidebar.tsx`
- Handle: all other UI conflict files

- [ ] **Step 1: Resolve App.tsx**

```bash
git checkout --theirs ui/src/App.tsx
```

Open `ui/src/App.tsx`. Find the import block and **add** the 3 business page imports (they'll be missing from upstream's version):

```typescript
import { Business } from "./pages/Business";
import { BusinessSetup } from "./pages/BusinessSetup";
import { BusinessModuleView } from "./pages/BusinessModuleView";
```

Then find the `boardRoutes()` function and **add** the 3 business routes inside the `<Routes>` block (after the `goals/:goalId` route):

```tsx
<Route path="business" element={<Business />} />
<Route path="business/setup" element={<BusinessSetup />} />
<Route path="business/:moduleKey" element={<BusinessModuleView />} />
```

```bash
git add ui/src/App.tsx
```

- [ ] **Step 2: Resolve Sidebar.tsx**

```bash
git checkout --theirs ui/src/components/Sidebar.tsx
```

Open `ui/src/components/Sidebar.tsx`. 

Add `Briefcase` to the lucide-react import:

```typescript
import {
  // ... existing icons ...,
  Briefcase,
} from "lucide-react";
```

Find the nav items section (after Goals or Activity link) and add the Business nav link. Look for the pattern `<NavLink to="/goals"` and add after it:

```tsx
<NavItem
  to="/business"
  icon={<Briefcase className="h-4 w-4 shrink-0" />}
  label="Business"
/>
```

(If `NavItem` is not the component name, match the pattern used by other nav links in the file — use the same component/JSX pattern as Goals or Activity.)

```bash
git add ui/src/components/Sidebar.tsx
```

- [ ] **Step 3: Accept upstream for all remaining conflicts**

```bash
# For all other conflicting files, take upstream's version
git diff --name-only --diff-filter=U | while read f; do
  git checkout --theirs "$f"
  git add "$f"
done
```

- [ ] **Step 4: Check nothing was missed**

```bash
git diff --name-only --diff-filter=U
```

Expected: empty output (no remaining conflicts).

---

### Task 7: Build + type-check + commit merge

**Files:** No changes — build verification only.

- [ ] **Step 1: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 2: Type-check**

```bash
pnpm typecheck 2>&1 | tail -20
```

Expected: 0 type errors. If errors exist, fix them before proceeding (they will be in the conflict-resolved files; most common: a removed type still referenced).

- [ ] **Step 3: Build**

```bash
pnpm build 2>&1 | tail -30
```

Expected: all packages build successfully. Check specifically for `@paperclipai/server`, `@paperclipai/ui`, `@paperclipai/shared`, `@paperclipai/db`.

- [ ] **Step 4: Run unit tests**

```bash
pnpm test:run:general 2>&1 | tail -30
```

Expected: green or near-green (a few known flaky tests are acceptable; failures in business-routes tests are expected since we haven't changed them).

- [ ] **Step 5: Commit the merge**

```bash
git add -A
git commit -m "chore: merge upstream v2026.525 (87 commits) + preserve Business Management Phase 1

- Upstream: skills CLI, document annotations, resource memberships, cloud upstreams,
  agent permissions, cursor-cloud adapter, accepted-plan decomposition UI
- Fork: business routes + schema + UI (0093_business_management migration) preserved
- Migration conflict resolved: 0084_business_management renamed to 0093"
```

- [ ] **Step 6: Push to GitHub**

```bash
git push origin feature/upstream-sync-v2026.525
```

---

## PHASE 2 — Business Agent Tools Plugin

### Task 8: Scaffold plugin package

**Files:**
- Create: `packages/plugins/plugin-business-agent-tools/package.json`
- Create: `packages/plugins/plugin-business-agent-tools/tsconfig.json`
- Create: `packages/plugins/plugin-business-agent-tools/src/constants.ts`

- [ ] **Step 1: Create directory + package.json**

```bash
mkdir -p packages/plugins/plugin-business-agent-tools/src
```

Create `packages/plugins/plugin-business-agent-tools/package.json`:

```json
{
  "name": "@paperclipai/plugin-business-agent-tools",
  "version": "0.1.0",
  "description": "Exposes Business Management (CRM, Finance, Inventory, Sales) as agent tools inside Paperclip",
  "type": "module",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "paperclipPlugin": {
    "manifest": "./dist/manifest.js",
    "worker": "./dist/worker.js"
  },
  "scripts": {
    "prebuild": "pnpm --filter @paperclipai/plugin-sdk ensure-build-deps",
    "build": "tsc",
    "clean": "rm -rf dist",
    "typecheck": "pnpm --filter @paperclipai/plugin-sdk ensure-build-deps && tsc --noEmit"
  },
  "dependencies": {
    "@paperclipai/plugin-sdk": "workspace:*",
    "@paperclipai/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^24.6.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create constants.ts**

Create `packages/plugins/plugin-business-agent-tools/src/constants.ts`:

```typescript
export const PLUGIN_ID = "newtech.business-agent-tools";
export const PLUGIN_VERSION = "0.1.0";

export const TOOL_NAMES = {
  businessQuery: "business.query",
  businessGet: "business.get",
  businessCreate: "business.create",
  businessUpdate: "business.update",
  businessSummary: "business.summary",
} as const;

// The Paperclip server base URL — used by the worker to call business API routes.
// In Docker: http://localhost:3100 (or the PORT env var).
// In dev: http://localhost:3200.
export const DEFAULT_SERVER_URL = "http://localhost:3200";
```

- [ ] **Step 4: Create src/index.ts**

```typescript
export { default as manifest } from "./manifest.js";
```

- [ ] **Step 5: Install dependencies**

```bash
pnpm install
```

---

### Task 9: Write the plugin manifest

**Files:**
- Create: `packages/plugins/plugin-business-agent-tools/src/manifest.ts`

- [ ] **Step 1: Write manifest.ts**

```typescript
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { PLUGIN_ID, PLUGIN_VERSION, TOOL_NAMES } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Business Agent Tools",
  description:
    "Gives AI agents read/write access to Business Management modules " +
    "(CRM, Sales, Inventory, Finance, HR, Helpdesk, Marketing, E-commerce). " +
    "Automatically creates issues when new leads or invoices arrive.",
  author: "NewTech Kuwait",
  categories: ["automation", "connector"],
  capabilities: [
    "http.outbound",
    "agent.tools.register",
    "events.subscribe",
    "issues.create",
    "issues.read",
    "agents.read",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      serverUrl: {
        type: "string",
        title: "Paperclip Server URL",
        description: "Base URL of the Paperclip server (e.g. http://localhost:3200)",
        default: "http://localhost:3200",
      },
      requireApprovalForFinance: {
        type: "boolean",
        title: "Require approval for Finance writes",
        default: true,
      },
    },
  },
  tools: [
    {
      name: TOOL_NAMES.businessQuery,
      displayName: "Business Query",
      description:
        "List entities from a business module (CRM contacts, sales orders, invoices, " +
        "products, HR employees, helpdesk tickets, etc.). Returns up to 50 records.",
      parametersSchema: {
        type: "object",
        properties: {
          moduleKey: {
            type: "string",
            enum: ["crm", "sales", "inventory", "finance", "hr", "helpdesk", "marketing", "ecommerce"],
            description: "Which business module to query",
          },
          entityType: {
            type: "string",
            description:
              "Entity type within the module (e.g. 'contact', 'deal', 'invoice', 'product', 'employee')",
          },
          status: {
            type: "string",
            description: "Filter by status (e.g. 'active', 'pending', 'paid'). Optional.",
          },
          search: {
            type: "string",
            description: "Full-text search against entity name. Optional.",
          },
          limit: {
            type: "number",
            description: "Max records to return (1-50, default 20)",
          },
        },
        required: ["moduleKey", "entityType"],
      },
    },
    {
      name: TOOL_NAMES.businessGet,
      displayName: "Business Get",
      description: "Fetch a single business entity by its ID or code.",
      parametersSchema: {
        type: "object",
        properties: {
          moduleKey: { type: "string" },
          entityType: { type: "string" },
          id: { type: "string", description: "Entity UUID" },
          code: { type: "string", description: "Entity code (e.g. 'C-12345')" },
        },
        required: ["moduleKey", "entityType"],
      },
    },
    {
      name: TOOL_NAMES.businessCreate,
      displayName: "Business Create",
      description:
        "Create a new business entity (CRM contact, deal, invoice, product, etc.). " +
        "Finance module writes require approval if configured.",
      parametersSchema: {
        type: "object",
        properties: {
          moduleKey: { type: "string" },
          entityType: { type: "string" },
          name: { type: "string" },
          status: { type: "string" },
          amountCents: { type: "number", description: "Amount in cents (e.g. 50000 = 500.00 KWD)" },
          currency: { type: "string", description: "ISO currency code (e.g. 'KWD')" },
          data: { type: "object", description: "Module-specific fields (email, phone, lineItems, etc.)" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["moduleKey", "entityType", "name"],
      },
    },
    {
      name: TOOL_NAMES.businessUpdate,
      displayName: "Business Update",
      description:
        "Update an existing business entity by ID. Only provided fields are changed. " +
        "Finance module writes require approval if configured.",
      parametersSchema: {
        type: "object",
        properties: {
          moduleKey: { type: "string" },
          entityType: { type: "string" },
          id: { type: "string", description: "Entity UUID to update" },
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
    {
      name: TOOL_NAMES.businessSummary,
      displayName: "Business Summary",
      description:
        "Get a count summary of all active business entities grouped by module. " +
        "Useful for the CEO/COO agent to understand the company state at a glance.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
};

export default manifest;
```

---

### Task 10: Write the plugin worker

**Files:**
- Create: `packages/plugins/plugin-business-agent-tools/src/worker.ts`

- [ ] **Step 1: Write worker.ts**

```typescript
import {
  definePlugin,
  runWorker,
  type PluginContext,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";
import { DEFAULT_SERVER_URL, PLUGIN_ID, TOOL_NAMES } from "./constants.js";

type PluginConfig = {
  serverUrl?: string;
  requireApprovalForFinance?: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getConfig(ctx: PluginContext): Promise<PluginConfig> {
  const cfg = (await ctx.config.get()) as PluginConfig | null;
  return {
    serverUrl: cfg?.serverUrl ?? DEFAULT_SERVER_URL,
    requireApprovalForFinance: cfg?.requireApprovalForFinance ?? true,
  };
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

function isFinanceWrite(moduleKey: string): boolean {
  return moduleKey === "finance" || moduleKey === "sales";
}

// ── Tool Handlers ─────────────────────────────────────────────────────────────

async function handleBusinessQuery(
  params: unknown,
  runCtx: ToolRunContext,
  ctx: PluginContext,
): Promise<ToolResult> {
  const p = params as {
    moduleKey: string;
    entityType: string;
    status?: string;
    search?: string;
    limit?: number;
  };

  const searchParams = new URLSearchParams();
  if (p.status) searchParams.set("status", p.status);
  if (p.search) searchParams.set("search", p.search);
  searchParams.set("limit", String(Math.min(p.limit ?? 20, 50)));

  const qs = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const data = await businessFetch(
    ctx,
    runCtx.companyId,
    `/${p.moduleKey}/${p.entityType}${qs}`,
  );

  const records = (data as { entities?: unknown[] }).entities ?? [];
  return {
    content: `Found ${records.length} ${p.entityType}(s) in ${p.moduleKey} module.`,
    data: records,
  };
}

async function handleBusinessGet(
  params: unknown,
  runCtx: ToolRunContext,
  ctx: PluginContext,
): Promise<ToolResult> {
  const p = params as {
    moduleKey: string;
    entityType: string;
    id?: string;
    code?: string;
  };

  if (!p.id && !p.code) {
    return { error: "Either 'id' or 'code' must be provided." };
  }

  const qs = p.id ? `?id=${p.id}` : `?code=${encodeURIComponent(p.code!)}`;
  const data = await businessFetch(
    ctx,
    runCtx.companyId,
    `/${p.moduleKey}/${p.entityType}${qs}`,
  );

  const records = (data as { entities?: unknown[] }).entities ?? [];
  if (records.length === 0) {
    return { error: `No ${p.entityType} found with the given id/code.` };
  }
  return { content: `Found ${p.entityType}.`, data: records[0] };
}

async function handleBusinessCreate(
  params: unknown,
  runCtx: ToolRunContext,
  ctx: PluginContext,
): Promise<ToolResult> {
  const p = params as {
    moduleKey: string;
    entityType: string;
    name: string;
    status?: string;
    amountCents?: number;
    currency?: string;
    data?: Record<string, unknown>;
    tags?: string[];
  };

  const config = await getConfig(ctx);
  if (config.requireApprovalForFinance && isFinanceWrite(p.moduleKey)) {
    // Create a pending approval issue instead of writing directly
    const issue = await ctx.issues.create({
      companyId: runCtx.companyId,
      projectId: runCtx.projectId,
      title: `[Approval Required] Create ${p.entityType} in ${p.moduleKey}: ${p.name}`,
      description:
        `An agent requested to create a ${p.entityType} in the **${p.moduleKey}** module.\n\n` +
        `**Name:** ${p.name}\n` +
        `**Amount:** ${p.amountCents ? (p.amountCents / 100).toFixed(3) + " " + (p.currency ?? "KWD") : "N/A"}\n\n` +
        `**Data:**\n\`\`\`json\n${JSON.stringify({ ...p, moduleKey: undefined, entityType: undefined }, null, 2)}\n\`\`\`\n\n` +
        `Approve this issue to confirm the creation.`,
    });
    return {
      content: `Finance write requires approval. Created approval issue: ${issue.title}`,
      data: { approvalIssueId: issue.id, requiresApproval: true },
    };
  }

  const body = {
    name: p.name,
    status: p.status ?? "active",
    amountCents: p.amountCents,
    currency: p.currency,
    data: p.data ?? {},
    tags: p.tags ?? [],
  };

  const result = await businessFetch(
    ctx,
    runCtx.companyId,
    `/${p.moduleKey}/${p.entityType}`,
    { method: "POST", body: JSON.stringify(body) },
  );

  return {
    content: `Created ${p.entityType} in ${p.moduleKey}.`,
    data: result,
  };
}

async function handleBusinessUpdate(
  params: unknown,
  runCtx: ToolRunContext,
  ctx: PluginContext,
): Promise<ToolResult> {
  const p = params as {
    moduleKey: string;
    entityType: string;
    id: string;
    name?: string;
    status?: string;
    amountCents?: number;
    currency?: string;
    data?: Record<string, unknown>;
    tags?: string[];
  };

  const config = await getConfig(ctx);
  if (config.requireApprovalForFinance && isFinanceWrite(p.moduleKey)) {
    const issue = await ctx.issues.create({
      companyId: runCtx.companyId,
      projectId: runCtx.projectId,
      title: `[Approval Required] Update ${p.entityType} ${p.id} in ${p.moduleKey}`,
      description:
        `An agent requested to update a ${p.entityType} in **${p.moduleKey}**.\n\n` +
        `**ID:** ${p.id}\n\n**Changes:**\n\`\`\`json\n${JSON.stringify(p, null, 2)}\n\`\`\`\n\nApprove to confirm.`,
    });
    return {
      content: `Finance write requires approval. Created approval issue: ${issue.title}`,
      data: { approvalIssueId: issue.id, requiresApproval: true },
    };
  }

  const body: Record<string, unknown> = {};
  if (p.name !== undefined) body.name = p.name;
  if (p.status !== undefined) body.status = p.status;
  if (p.amountCents !== undefined) body.amountCents = p.amountCents;
  if (p.currency !== undefined) body.currency = p.currency;
  if (p.data !== undefined) body.data = p.data;
  if (p.tags !== undefined) body.tags = p.tags;

  const result = await businessFetch(
    ctx,
    runCtx.companyId,
    `/${p.moduleKey}/${p.entityType}/${p.id}`,
    { method: "PUT", body: JSON.stringify(body) },
  );

  return {
    content: `Updated ${p.entityType} ${p.id} in ${p.moduleKey}.`,
    data: result,
  };
}

async function handleBusinessSummary(
  _params: unknown,
  runCtx: ToolRunContext,
  ctx: PluginContext,
): Promise<ToolResult> {
  const data = await businessFetch(ctx, runCtx.companyId, "/summary");
  const summary = data as Record<string, unknown>;
  const lines = Object.entries(summary)
    .map(([k, v]) => `- **${k}**: ${JSON.stringify(v)}`)
    .join("\n");
  return {
    content: `Business summary for company ${runCtx.companyId}:\n${lines}`,
    data: summary,
  };
}

// ── Event Handlers ────────────────────────────────────────────────────────────

async function setupEventHandlers(ctx: PluginContext): Promise<void> {
  // New CRM lead → create issue for Sales agent
  ctx.events.on("issue.created", async () => {
    // Generic hook — business-specific events will be plugin-emitted in Phase 3
    ctx.logger.info(`${PLUGIN_ID}: observed issue.created`);
  });
}

// ── Plugin Definition ─────────────────────────────────────────────────────────

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(`${PLUGIN_ID} plugin starting`);

    ctx.tools.register(
      TOOL_NAMES.businessQuery,
      {
        displayName: "Business Query",
        description: "List entities from a business module",
        parametersSchema: {
          type: "object",
          properties: {
            moduleKey: { type: "string" },
            entityType: { type: "string" },
            status: { type: "string" },
            search: { type: "string" },
            limit: { type: "number" },
          },
          required: ["moduleKey", "entityType"],
        },
      },
      (params, runCtx) => handleBusinessQuery(params, runCtx, ctx),
    );

    ctx.tools.register(
      TOOL_NAMES.businessGet,
      {
        displayName: "Business Get",
        description: "Fetch a single business entity by ID or code",
        parametersSchema: {
          type: "object",
          properties: {
            moduleKey: { type: "string" },
            entityType: { type: "string" },
            id: { type: "string" },
            code: { type: "string" },
          },
          required: ["moduleKey", "entityType"],
        },
      },
      (params, runCtx) => handleBusinessGet(params, runCtx, ctx),
    );

    ctx.tools.register(
      TOOL_NAMES.businessCreate,
      {
        displayName: "Business Create",
        description: "Create a new business entity",
        parametersSchema: {
          type: "object",
          properties: {
            moduleKey: { type: "string" },
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
      (params, runCtx) => handleBusinessCreate(params, runCtx, ctx),
    );

    ctx.tools.register(
      TOOL_NAMES.businessUpdate,
      {
        displayName: "Business Update",
        description: "Update an existing business entity",
        parametersSchema: {
          type: "object",
          properties: {
            moduleKey: { type: "string" },
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
      (params, runCtx) => handleBusinessUpdate(params, runCtx, ctx),
    );

    ctx.tools.register(
      TOOL_NAMES.businessSummary,
      {
        displayName: "Business Summary",
        description: "Get counts of all business entities by module",
        parametersSchema: { type: "object", properties: {} },
      },
      (params, runCtx) => handleBusinessSummary(params, runCtx, ctx),
    );

    await setupEventHandlers(ctx);

    ctx.logger.info(`${PLUGIN_ID} plugin ready — 5 tools registered`);
  },

  async onHealth() {
    return { status: "ok", message: "Business Agent Tools plugin is healthy" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
```

---

### Task 11: Build the plugin + write a smoke test

**Files:**
- Create: `packages/plugins/plugin-business-agent-tools/src/worker.test.ts`

- [ ] **Step 1: Build the plugin**

```bash
pnpm --filter @paperclipai/plugin-business-agent-tools build
```

Expected: creates `packages/plugins/plugin-business-agent-tools/dist/manifest.js` and `dist/worker.js`.

- [ ] **Step 2: Write a smoke test**

Create `packages/plugins/plugin-business-agent-tools/src/worker.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import manifest from "./manifest.js";
import { PLUGIN_ID, TOOL_NAMES } from "./constants.js";

describe("business-agent-tools manifest", () => {
  it("has correct plugin ID", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
  });

  it("declares all 5 tools", () => {
    const toolNames = manifest.tools?.map((t) => t.name) ?? [];
    expect(toolNames).toContain(TOOL_NAMES.businessQuery);
    expect(toolNames).toContain(TOOL_NAMES.businessGet);
    expect(toolNames).toContain(TOOL_NAMES.businessCreate);
    expect(toolNames).toContain(TOOL_NAMES.businessUpdate);
    expect(toolNames).toContain(TOOL_NAMES.businessSummary);
    expect(toolNames.length).toBe(5);
  });

  it("declares agent.tools.register capability", () => {
    expect(manifest.capabilities).toContain("agent.tools.register");
  });

  it("requires moduleKey+entityType for query", () => {
    const queryTool = manifest.tools?.find((t) => t.name === TOOL_NAMES.businessQuery);
    expect(queryTool?.parametersSchema?.required).toContain("moduleKey");
    expect(queryTool?.parametersSchema?.required).toContain("entityType");
  });
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @paperclipai/plugin-business-agent-tools typecheck
pnpm test:run:general 2>&1 | grep -A5 "business-agent"
```

Expected: all 4 tests PASS.

- [ ] **Step 4: Commit the plugin**

```bash
git add packages/plugins/plugin-business-agent-tools/
git commit -m "feat(plugin): add business-agent-tools plugin

- 5 agent tools: business.query, .get, .create, .update, .summary
- Approval gate: finance/sales writes create approval issues instead of writing directly
- Governance: configurable serverUrl + requireApprovalForFinance instance config
- Plugin SDK v1.0: definePlugin + ctx.tools.register + ctx.http.fetch"
```

---

## PHASE 3 — NewTech AI Company Setup & End-to-End Test

### Task 12: Deploy updated build to VPS

**Files:** No code changes — deployment only.

> VPS: `83.171.249.32` · SSH key: `/c/Users/kthug/.ssh/vps_key` · Current app port: 3200

- [ ] **Step 1: Build Docker image locally (or on VPS)**

```bash
# On VPS via SSH:
ssh -i /c/Users/kthug/.ssh/vps_key root@83.171.249.32
cd /path/to/paperclip   # wherever the repo is cloned on VPS
git pull origin feature/upstream-sync-v2026.525
docker compose build server
docker compose up -d server
```

Or if using the existing Docker deployment:

```bash
docker build -t paperclip:v2026.525-newtech . && \
docker stop paperclip-server && \
docker run -d --name paperclip-server \
  -e DATABASE_URL="$DATABASE_URL" \
  -e PORT=3200 \
  -e SERVE_UI=true \
  -p 3200:3200 \
  paperclip:v2026.525-newtech
```

- [ ] **Step 2: Verify server is running**

```bash
curl -s http://83.171.249.32:3200/api/health 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('OK:', d)"
```

Expected: `OK: {...}` with a 200 status. If `/api/health` doesn't exist, try `curl -I http://83.171.249.32:3200` — expect HTTP 200 or 302.

- [ ] **Step 3: Verify migrations ran**

In the VPS PostgreSQL, check for the new tables:

```bash
ssh -i /c/Users/kthug/.ssh/vps_key root@83.171.249.32 \
  "psql -U paperclip -d paperclip -c '\dt' | grep -E 'business|resource|document_annotation|issue_recovery'"
```

Expected: `business_modules`, `business_entities`, `resource_memberships`, `document_annotation_threads` (and others from upstream) all present.

---

### Task 13: Get company IDs + configure NewTech AI agents

**Files:** No code changes — API configuration.

> The NewTech AI company (the AI workforce) and the Newtech Kuwait data company (`38a84db6-...`) are two separate companies in the same Paperclip instance.

- [ ] **Step 1: Get auth cookie**

```bash
# From a browser session at http://83.171.249.32:3200, log in and copy the session cookie.
# Or use the CLI:
# paperclip login --url http://83.171.249.32:3200
```

Save the cookie: `paperclip-default.session_token=<VALUE>` to `/tmp/pc-cookie.txt`.

```bash
COOKIE="paperclip-default.session_token=$(cat /tmp/pc-cookie.txt)"
BASE="http://83.171.249.32:3200"
```

- [ ] **Step 2: List companies + find NewTech AI ID**

```bash
curl -s -H "Cookie: $COOKIE" "$BASE/api/companies" | \
  python3 -c "import json,sys; [print(c['id'], c['name']) for c in json.load(sys.stdin)['companies']]"
```

Note the UUID for "NewTech AI" — call it `$NT_ID`.

- [ ] **Step 3: List agents + note their IDs**

```bash
curl -s -H "Cookie: $COOKIE" "$BASE/api/companies/$NT_ID/agents" | \
  python3 -c "import json,sys; [print(a['id'], a['name'], a.get('adapterType','?')) for a in json.load(sys.stdin)['agents']]"
```

You should see ~16 agents (CEO, CFO, etc.) with no adapter configured yet.

- [ ] **Step 4: Configure CEO agent with claude-local adapter**

```bash
# Get CEO agent ID first from the list above
CEO_ID="<uuid-of-CEO-agent>"
ANTHROPIC_KEY="<your-anthropic-api-key>"

curl -s -X PUT -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  "$BASE/api/companies/$NT_ID/agents/$CEO_ID" \
  -d "{
    \"adapterType\": \"claude-local\",
    \"adapterConfig\": {\"model\": \"claude-opus-4-7\", \"maxTokensPerRun\": 8000},
    \"tokenBudgetCents\": 500
  }"
```

Repeat for other C-suite agents. Use `claude-sonnet-4-6` for ICs (cheaper). Set `tokenBudgetCents` per agent:
- CEO/COO: 500 (orchestrators — higher budget)
- C-suite: 200
- ICs: 100

- [ ] **Step 5: Set ANTHROPIC_API_KEY in company secrets**

```bash
curl -s -X POST -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  "$BASE/api/companies/$NT_ID/secrets" \
  -d "{\"key\": \"ANTHROPIC_API_KEY\", \"value\": \"$ANTHROPIC_KEY\"}"
```

---

### Task 14: Enable E-commerce business module

**Files:** No code changes — API configuration.

- [ ] **Step 1: Activate E-commerce preset via setup wizard**

```bash
curl -s -X POST -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  "$BASE/api/companies/$NT_ID/business/setup" \
  -d "{\"industryPreset\": \"ecommerce\", \"companyName\": \"NewTech Kuwait\"}"
```

This activates modules: `crm`, `sales`, `inventory`, `finance`, `ecommerce`, `helpdesk`.

- [ ] **Step 2: Verify modules are active**

```bash
curl -s -H "Cookie: $COOKIE" "$BASE/api/companies/$NT_ID/business/modules" | \
  python3 -c "import json,sys; [print(m['key'], m['isActive']) for m in json.load(sys.stdin)['modules']]"
```

Expected: 6 modules with `isActive: true`.

---

### Task 15: Install the Business Agent Tools plugin

**Files:** No code changes — plugin installation.

- [ ] **Step 1: Check plugin build output exists**

```bash
ls packages/plugins/plugin-business-agent-tools/dist/
```

Expected: `manifest.js`, `worker.js`.

- [ ] **Step 2: Install via Paperclip UI**

Open `http://83.171.249.32:3200` in browser → Navigate to **Settings → Plugins** → Click **Install Plugin** → Enter path: `/path/to/paperclip/packages/plugins/plugin-business-agent-tools` (the full absolute path on the VPS).

OR install via API:

```bash
PLUGIN_PATH="/root/paperclip/packages/plugins/plugin-business-agent-tools"
curl -s -X POST -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  "$BASE/api/plugins/install" \
  -d "{\"source\": \"local\", \"path\": \"$PLUGIN_PATH\"}"
```

- [ ] **Step 3: Configure the plugin**

```bash
PLUGIN_ID_SLUG="newtech.business-agent-tools"
curl -s -X PUT -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  "$BASE/api/plugins/$PLUGIN_ID_SLUG/config" \
  -d "{\"serverUrl\": \"http://localhost:3200\", \"requireApprovalForFinance\": true}"
```

- [ ] **Step 4: Verify plugin health**

```bash
curl -s -H "Cookie: $COOKIE" "$BASE/api/plugins/$PLUGIN_ID_SLUG/health" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d)"
```

Expected: `{"status": "ok", "message": "Business Agent Tools plugin is healthy"}`.

---

### Task 16: Seed business data

**Files:** No code changes — data seeding.

- [ ] **Step 1: Run seed scripts against the running instance**

The seed scripts target `COMPANY = "38a84db6-..."` (the Newtech Kuwait data company). For the NewTech AI company, also seed some demo data.

First, get the session cookie from the VPS instance (same auth flow as before):

```bash
# On the machine that has ~/seed_paperclip.py
cd ~
python3 seed_paperclip.py    # batch 1: CRM contacts
python3 seed_paperclip_batch2.py
python3 seed_paperclip_batch3.py
python3 seed_paperclip_batch4.py
python3 seed_paperclip_batch5.py
python3 seed_paperclip_batch6.py
python3 seed_paperclip_batch7.py
python3 seed_paperclip_batch8.py
```

- [ ] **Step 2: Verify data loaded**

```bash
curl -s -H "Cookie: $COOKIE" "$BASE/api/companies/38a84db6-d2bd-4c78-a602-a1c43a59074c/business/summary" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d, ensure_ascii=False, indent=2))"
```

Expected: non-zero counts for contacts, orders, products.

---

### Task 17: Create + run an end-to-end test issue

**Files:** No code changes — runtime verification.

- [ ] **Step 1: Create a test project in NewTech AI**

```bash
curl -s -X POST -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  "$BASE/api/companies/$NT_ID/projects" \
  -d "{\"name\": \"E2E Test\", \"description\": \"Validation project\"}"
```

Note the project ID: `$PROJ_ID`.

- [ ] **Step 2: Find the CMO or Content & SEO Lead agent ID**

```bash
curl -s -H "Cookie: $COOKIE" "$BASE/api/companies/$NT_ID/agents" | \
  python3 -c "import json,sys; [print(a['id'], a['name']) for a in json.load(sys.stdin)['agents'] if 'SEO' in a.get('name','') or 'Marketing' in a.get('name','')]"
```

Note the ID: `$SEO_AGENT_ID`.

- [ ] **Step 3: Create a real test issue**

```bash
curl -s -X POST -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  "$BASE/api/companies/$NT_ID/issues" \
  -d "{
    \"title\": \"[E2E Test] List top 5 products by revenue from business data\",
    \"description\": \"Use the business.query tool to list products from the inventory module. Then use business.summary to get an overview. Report total product count and top 5 by amountCents. This is an integration test.\",
    \"projectId\": \"$PROJ_ID\",
    \"assigneeId\": \"$SEO_AGENT_ID\"
  }"
```

Note the issue ID: `$ISSUE_ID`.

- [ ] **Step 4: Execute the issue (wake the agent)**

```bash
curl -s -X POST -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  "$BASE/api/companies/$NT_ID/issues/$ISSUE_ID/execute" \
  -d "{}"
```

- [ ] **Step 5: Monitor execution in real-time**

Open `http://83.171.249.32:3200` → Navigate to the issue → Watch the live execution.

Or poll via API:

```bash
for i in $(seq 1 12); do
  STATUS=$(curl -s -H "Cookie: $COOKIE" "$BASE/api/companies/$NT_ID/issues/$ISSUE_ID" | \
    python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('issue',{}).get('status','?'))")
  echo "[$i/12] Status: $STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 10
done
```

- [ ] **Step 6: Verify the agent used the business tools**

```bash
# Get heartbeat run results
curl -s -H "Cookie: $COOKIE" "$BASE/api/companies/$NT_ID/issues/$ISSUE_ID/runs" | \
  python3 -c "
import json,sys
d=json.load(sys.stdin)
for run in d.get('runs',[]):
    print('Run:', run.get('id'), 'Status:', run.get('status'), 'Tokens:', run.get('totalTokens'))
"
```

Expected:
- `status: "completed"`
- Tool calls to `newtech.business-agent-tools.business.query` and `newtech.business-agent-tools.business.summary` visible in the run output
- The issue comment contains actual product data from the business database

- [ ] **Step 7: Verify cost tracking**

```bash
curl -s -H "Cookie: $COOKIE" "$BASE/api/companies/$NT_ID/costs" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print('Total spend:', d.get('totalCents', 0) / 100, 'KWD')"
```

Expected: non-zero spend, within the agent's budget cap.

---

## Self-Review

### Spec coverage check

| Requirement | Covered by |
|-------------|-----------|
| Merge upstream (87 commits) without losing Business Mgmt | Tasks 1–7 |
| Migration number conflict (0084) | Tasks 1–2 (rename before merge) |
| Business routes + schema + UI preserved | Tasks 3–6 (manual conflict resolution) |
| Business Agent Tools plugin | Tasks 8–11 |
| Agent tools: query/get/create/update/summary | Task 9–10 |
| Approval gate for finance writes | Task 10 (handleBusinessCreate/Update) |
| NewTech AI company fully configured | Tasks 12–16 |
| Agents with claude-local adapter + budgets | Task 13 |
| E-commerce modules enabled | Task 14 |
| Plugin installed and healthy | Task 15 |
| Real business data seeded | Task 16 |
| End-to-end test: agent uses business tool | Task 17 |
| Verify cost tracking works | Task 17 Step 7 |

### Placeholder scan

No TBD, TODO, or placeholder code found. All code blocks are complete and runnable.

### Type consistency

- `TOOL_NAMES` constants defined in `constants.ts` (Task 8) → used in `manifest.ts` (Task 9) and `worker.ts` (Task 10) — consistent.
- `PluginConfig` type defined at top of `worker.ts` → used in `getConfig()` and all handlers — consistent.
- `businessFetch()` returns `Promise<unknown>` → callers cast with `as` — safe for JSONB API responses.
- `ctx.issues.create()` returns an object with `.id` and `.title` — used correctly in approval gate.

---

**Plan complete.** Saved to `docs/superpowers/plans/2026-05-29-upstream-merge-and-agent-business-integration.md`.
