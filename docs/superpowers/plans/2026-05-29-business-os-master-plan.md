# Paperclip Business OS — Master Plan (النظام اللي ما يُقهر)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This is the strategic master plan. Each Epic links to a detailed task-plan to be written before execution.

**Goal:** Turn the `adminnewtech/paperclip` fork into a complete, multi-tenant, AI-native Business Operating System for GCC SMBs (Newtech Kuwait first) — CRM, Customer 360, omnichannel commerce (online + POS), inventory, accounting, field operations, and an AI-employee workforce — where data leakage is structurally impossible, money never moves without human approval, and oversell can't happen.

**Strategic decision:** **Extend Paperclip, don't rebuild.** The Business OS design handoff and our codegraph analysis agree: reuse `agents`, `issues`, `approvals`, `routines`, `budget_policies`, `activity_log`, `secrets`, `plugins`. Add only business-domain tables.

---

## 0. Current State (الخط الحالي)

✅ **Done (this fork, branch `feature/upstream-sync-v2026.525`):**
- Merged upstream v2026.525 (87 commits)
- Business Management Phase 1: `business_modules` + `business_entities` (JSONB) + 8-module catalog + 7 industry presets + CRUD API (`server/src/routes/business.ts`) + 3 UI pages
- `plugin-business-agent-tools`: 5 agent tools + approval-gate scaffold for finance writes
- NewTech AI company: 16 agents (CEO→C-suite→ICs), 6 modules active, seeded data
- CodeGraph indexed (1,339 files), `.mcp.json` + `CLAUDE.md` wired

**Reconciliation with the spec naming:**
| Spec name | Our name | Decision |
|-----------|----------|----------|
| `record` | `business_entities` | Keep ours as the generic store for the 15 departments' records (CRM/support/tasks/etc.) |
| `department` | `business_modules` | Keep ours; add `gated` + `name_i18n` columns |
| dedicated commerce/accounting/field tables | — | **ADD as spec specifies** (high-integrity, transactional — NOT JSONB) |

The schema's own comment already says "promote high-traffic entity types to dedicated tables." Commerce/accounting/dispatch are exactly those: they need FKs, constraints, and atomic transactions. CRM/support/marketing stay generic JSONB.

---

## 1. The 5 "Unbeatable" Pillars (القرارات المعمارية — من البحث)

These are the differentiators. Build them into the foundation **before** scaling features.

### Pillar 1 — Tenant isolation via PostgreSQL RLS (not just app filtering)
**Decision:** Add Row-Level Security as the hard wall. Today we rely on app-level `company_id` filtering — one missing `WHERE` (or an AI-generated query) leaks all tenants.
- Every company-scoped table gets an RLS policy keyed on `SET LOCAL app.tenant_id`.
- App queries run under a **non-`BYPASSRLS` role**; **AI agents get a DB role that structurally cannot bypass RLS**.
- Keep app-level filtering too (defense in depth).
- Drizzle: write policies as manual migrations (drizzle-kit doesn't auto-gen all RLS yet); test explicitly.
- **Test:** `tenant-isolation.spec` — tenant A's session cannot read tenant B's rows, even with a deliberately unfiltered query.

### Pillar 2 — Risk-tiered AI policy gate on the existing `approvals` table
**Decision:** Every agent tool-call for `money | delete | customer-message | legal` routes through a central gate that creates an `approvals` row and parks the action — **driven by risk tier, not agent autonomy level**.
- Reuse existing `approvals` + `approval_comments` + `issue_approvals` tables.
- Append-only `agent_actions` log (INSERT-only grant; hash-chain rows like ZATCA PIH for tamper evidence). Store agent "before" + human "after".
- Dual-control on financial disbursements.
- Our `plugin-business-agent-tools` is the enforcement point — evolve its finance gate into the general policy gate.
- **Test:** `ai-permission.spec` — a gated action without approval is blocked + audited.

### Pillar 3 — Atomic commerce (oversell impossible)
**Decision:** A sale (POS or online) is ONE transaction: stock decrement + invoice + balanced journal entry, all-or-nothing.
- Stock decrement via atomic conditional UPDATE: `UPDATE stock SET qty = qty - $n WHERE variant_id=$v AND warehouse_id=$w AND qty >= $n RETURNING qty;` — zero rows = insufficient stock → abort.
- `READ COMMITTED` + a **retry wrapper (3×, jittered)** for serialization/deadlock (40001). Reserve `SELECT FOR UPDATE` only for multi-row reservation logic.
- **Test:** `pos-atomic.spec` — concurrent buys can't oversell; partial failure rolls back.

### Pillar 4 — Immutable audit on every mutation
**Decision:** Reuse `activity_log`; add append-only guarantees. Every create/update/delete/export/approval/AI-decision/permission-change is logged (actor, target, kind, risk). No UPDATE/DELETE grant on the audit table.

### Pillar 5 — RTL-first from one stylesheet
**Decision:** CSS logical properties everywhere (`padding-inline-start`, `margin-inline`, `inset-inline-*`) + i18next per-language `dir` + `<html dir>` switching. No second RTL stylesheet, no runtime flipping. Lint against physical `left/right` going forward. Port the prototype's `styles.css` tokens (dark default + light, density, accent).

---

## 2. KEY STRATEGIC CORRECTION — ZATCA is NOT a launch blocker for Kuwait

The spec emphasizes ZATCA e-invoicing heavily. **Research finding (verified 2026):**
- **Saudi Arabia:** ZATCA Fatoora is mandatory (Wave 23 deadline 31 Mar 2026, Wave 24 30 Jun 2026). B2B clearance + B2C reporting. Complex (CSID, PIH chain, signed UBL XML).
- **Kuwait:** **NO mandatory e-invoicing in 2026.** No VAT law passed. Only obligation is **Qayd XBRL financial-statement filing — mandatory 1 Jan 2027** (filing, not transactional e-invoicing).
- **UAE:** Phased, pilot Jul 2026, large taxpayers Jan 2027.

**Therefore:** For **Newtech Kuwait** (the primary tenant), e-invoicing clearance is **not required to launch**. We build accounting (P&L, journals, VAT-ready) now, and implement ZATCA as an **optional `TaxAuthorityAdapter`** that KSA tenants enable — sandbox-first, behind a per-company flag. This **de-risks and accelerates** the roadmap: ZATCA moves from "blocking Phase 9" to "parallel optional adapter." A future Kuwait Qayd adapter and UAE PINT-AE corner slot into the same `TaxAuthorityAdapter` interface.

---

## Progress (updated 2026-05-29)

- ✅ **EPIC A** — Foundation: migration `0094` org/governance tables (`bos_*`) + risk-tiered **policy gate** (`policy.ts`, 16 tests) + **read-only boundary** guard (`assertLocalTarget`). RLS **designed & staged** (`epic-a3-rls-tenant-isolation.md`) — apply after env reset + `withTenant` wiring.
- ✅ **EPIC C** — Customer 360 (`/customers`, `/customers/:name`): read-only aggregation over existing `crm/contact` + `sales/invoice`. No new tables.
- ✅ **Connectors** (`/connectors`) + currency-aware money (KWD 3-decimals).
- ⬜ Remaining: B, D, E, F, G, H, I, J, K, L. **F/G/H/J need new tables + migrations + a working server to build/verify** — blocked on a dev-env reset (postgres connection exhaustion from repeated restarts).

## 3. Re-Prioritized Roadmap (Epics)

Sequenced for fastest value to Newtech Kuwait + the unbeatable foundation first. Each Epic → its own detailed task-plan before coding.

### EPIC A — Unbeatable Foundation (Pillars 1, 2, 4) ⚠️ DO FIRST
*Why first: every later feature inherits isolation, governance, and audit. Retrofitting is 10× harder.*
- RLS migration on all company-scoped tables + `app.tenant_id` session wiring + agent non-bypass DB role
- Central policy gate (evolve `plugin-business-agent-tools`) on `approvals` + append-only `agent_actions`
- Audit middleware on all mutating business routes
- `department`/`team`/`employee`/`agent_profile`/`agent_policy` tables (spec §1)
- **Tests:** `tenant-isolation.spec`, `ai-permission.spec`, audit coverage
- **Gate:** no cross-tenant read possible; no gated action without an approval record.

### EPIC B — Department Framework + Command Center (spec Phase 2 + 1 UI)
- `pipeline`/`pipeline_stage`/`custom_field`/`custom_status` (records already exist as `business_entities`)
- `DepartmentShell` React component (tabs: Dashboard/Records/Tasks/Agents/Workflows/Approvals/Reports/Docs), data-driven by module key
- Command Center dashboard (KPIs, alerts, AI activity feed, approvals, workload)
- AI Employees grid + agent drawer (KPIs, budget bar from `budget_policies`, permissions, decision log)
- RTL shell (Pillar 5) ported from prototype

### EPIC C — Customers (Customer 360) (spec Phase 4) 💎 HIGH VALUE
*Has real data already: Zoho + Shopify customers seeded.*
- `customer` + `customer_event` tables
- 360 aggregation query: joins records + orders + einvoices + events by `customer_id`
- Customers list + 360 profile (header, stats, next-best-action, module cards, unified timeline)
- Wire the existing seeded NewTech Kuwait CRM data

### EPIC D — Sales/CRM + Support + Ops + Projects (spec Phase 3)
- Pipeline + lead/deal scoring hook; tickets + SLA
- Map each `record` → a Paperclip issue/task for agent delegation
- The AI agents (Content&SEO, Growth, Finance Analyst) act on real records via the policy gate

### EPIC E — Governance & Automation UI (spec Phase 5)
- Approval Center (AI reco + confidence + chain) — UI on existing `approvals`
- Workflow builder (visual node canvas) on `routines` + heartbeats
- **Tests:** `approval.spec`, `workflow.spec`

### EPIC F — Commerce: Inventory + Warehouses (spec Phase 6)
- `product`/`product_variant`/`warehouse`/`stock` (UNIQUE(variant,wh))/`stock_move`/`stock_transfer`/`goods_receipt` — dedicated tables
- Warehouses screen; low-stock → reorder workflow (Inventory agent + procurement approval)

### EPIC G — Commerce: POS (spec Phase 8, Pillar 3)
- `register`/`pos_session`/`pos_order`
- **Atomic checkout** (Pillar 3) + retry wrapper
- Cashier UI (product grid, cart, VAT, payments mada/cash/charge, sessions, receipts), offline-tolerant queue
- **Test:** `pos-atomic.spec`

### EPIC H — Accounting (spec Phase 9, ZATCA deferred)
- `ledger_account`/`journal_entry`/`journal_line`/`tax_rate`/`einvoice`
- Auto-posting from sales/purchases/refunds (Dr cash/AR, Cr revenue + VAT)
- Accounting screen (P&L, balance sheet, chart, journal)
- `einvoice` table built; **ZATCA clearance = optional adapter (Epic K)**, off by default for Kuwait

### EPIC I — Storefront + Channels (spec Phase 7)
- `store`/`store_theme`/`store_page`/`channel`/`channel_listing`
- Storefront builder + live preview + catalog with channel toggles
- Shopify/WooCommerce sync as **Paperclip plugins** (not core) — reuse the Shopify MCP integration

### EPIC J — Dispatch & Field Ops + Mobile App (spec Phase 9.5)
- `worker`/`work_order`/`assignment`/`job_checklist`/`job_part`/`job_photo`/`signature`/`proof_of_delivery`/`route`
- Smart-assign (role + availability + zone); atomic completion (status + parts stock_move + POD + notification-via-policy-gate)
- Dispatch console (queue, roster, live map, AI dispatcher)
- **Field app** (offline-first worker-JWT client) — tech flow + driver flow
- **Tests:** `dispatch-assign.spec`, `field-offline-sync.spec`

### EPIC K — TaxAuthorityAdapter + ZATCA (KSA, optional, parallel)
- `TaxAuthorityAdapter` interface; ZATCA adapter sandbox-first: CSID lifecycle, PIH hash chain, UUID, QR, signed UBL 2.1 XML, B2B clearance / B2C ≤24h reporting, immutable + credit/debit notes
- Per-company enable/disable; only KSA tenants turn it on
- Future: Kuwait Qayd XBRL (Jan 2027), UAE PINT-AE corner — same interface
- **Test:** `einvoice.spec`

### EPIC L — Platform, Setup Wizard, Polish (spec Phase 10)
- Setup Wizard auto-generates depts/agents/workflows/KPIs/roles/approval-rules from template
- Knowledge (RAG via `agent_memory` + pgvector), Integrations, Security & Audit, Settings
- Command palette, notifications, toasts, Tweaks (theme/lang/density/accent)
- e2e (Playwright); loading/empty/error states everywhere

---

## 4. Critical Path & Sequencing

```
EPIC A (foundation) ──┬──> B (dept framework + command center)
   RLS + policy gate  │       │
   + audit            │       ├──> C (Customer 360) ──> D (CRM/Support/Ops)
                      │       │
                      │       └──> E (governance UI)
                      │
                      └──> F (inventory) ──> G (POS, atomic) ──> H (accounting)
                                                  │                  │
                                                  └──> I (storefront) └┄┄> K (ZATCA, optional, parallel)
                                                  │
                                                  └──> J (field ops + mobile)
                                              
                                                                      L (polish) — last
```

**Hard rule:** A before everything. B before C/D/E. F before G before H. ZATCA (K) never blocks — runs parallel, optional.

**Fastest demo value for Newtech Kuwait:** A → B → C (Customer 360 over real Zoho/Shopify data) → F → G (POS). That's a working AI-run store with a unified customer view and a real register — no ZATCA needed.

---

## 5. Cross-Cutting Launch Gate (from spec, kept verbatim intent)
- [ ] No financial/deletion/customer-message/legal action without an `approvals` record
- [ ] No cross-company data access in any endpoint (RLS + isolation suite green)
- [ ] Every mutation in `activity_log` (append-only)
- [ ] Budgets enforced (existing `budget_policies`): overspend pauses agents
- [ ] RTL (ar) + LTR (en) both correct; dark/light; compact/comfortable
- [ ] No mock-only buttons; loading/empty/error states; no console errors

---

## 6. Risk Register
| Risk | Mitigation |
|------|-----------|
| Cross-tenant leakage (AI-generated queries) | **RLS + agent non-bypass role** (Pillar 1) — structural, not app-dependent |
| Agent moves money unsupervised | Risk-tiered policy gate on `approvals` (Pillar 2); dual-control on disbursement |
| POS oversell / unbalanced books | Atomic `UPDATE...WHERE qty>=n` + single tx + retry (Pillar 3) |
| ZATCA complexity blocks launch | **Decoupled** — optional adapter, off for Kuwait (§2) |
| RTL layout breakage | Logical CSS props + i18next dir, one stylesheet (Pillar 5); lint physical props |
| Breaking upstream features | Small commits; reuse not rebuild; keep existing tests green; merge upstream periodically |
| Windows dev ESM issues (seen with plugin) | Already patched (`pathToFileURL` + worker-shim); document in AGENTS.md |

---

## 7. Start Now — Recommendation
Begin **EPIC A (Unbeatable Foundation)**. It's the one thing that can't be retrofitted and it's what makes the system "لا يُقهر": after Epic A, cross-tenant leakage is impossible, no agent can move money without approval, and every action is audited. Then Customer 360 (Epic C) gives the first big visible win over real data.

First detailed task-plan to write: `2026-05-29-epic-a-unbeatable-foundation.md` (RLS migration + policy gate + audit + org tables, TDD, per the spec test names).
