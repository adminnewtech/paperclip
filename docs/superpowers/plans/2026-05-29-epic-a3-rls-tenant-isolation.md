# EPIC-A3 — RLS Tenant Isolation (staged, apply after env reset)

> **Status: DESIGNED & READY — NOT YET APPLIED.** RLS with `FORCE` breaks the
> whole app instantly if the app-side `SET LOCAL app.tenant_id` wiring isn't in
> place first (every query returns 0 rows). It must land in this exact order,
> tested, on a clean environment. Do NOT add the migration to the journal until
> Step 2 (app-side wiring) is merged and the isolation test is green.

**Goal:** Make cross-tenant data leakage structurally impossible — even if an AI
agent runs a query with no `WHERE company_id`, PostgreSQL RLS denies the rows.

## Why staged
- Paperclip's server connects to embedded/managed Postgres as the table **owner/superuser**, which **bypasses RLS** unless `FORCE ROW LEVEL SECURITY` is set.
- With `FORCE` enabled but no `app.tenant_id` set on the session, **every** company-scoped query returns zero rows → total outage.
- Therefore the app-side session wiring (Step 2) MUST be merged and verified before the migration (Step 3) is journaled and applied.

## Step 1 — Roles (one-time, infra)
Create a dedicated app role that is NOT a superuser and does NOT own the tables:
```sql
CREATE ROLE paperclip_app LOGIN PASSWORD '<from-secret>';
GRANT USAGE ON SCHEMA public TO paperclip_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO paperclip_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO paperclip_app;
-- Agents get an even more restricted role (read-mostly, never BYPASSRLS):
CREATE ROLE paperclip_agent LOGIN PASSWORD '<from-secret>';
GRANT USAGE ON SCHEMA public TO paperclip_agent;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO paperclip_agent;
```
Point `DATABASE_URL` at `paperclip_app` (NOT the owner). Migrations still run as the owner.

## Step 2 — App-side session wiring (MERGE FIRST, the hard part)
Wrap every company-scoped request/transaction so the tenant is set before any query:
```ts
// server/src/db/with-tenant.ts
export async function withTenant<T>(db: Db, companyId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${companyId}, true)`); // local to tx
    return fn();
  });
}
```
- Wire it in the company-scoped route middleware (where `:companyId` / `:cid` is resolved) so the handler's DB calls run inside `withTenant`.
- Use **PgBouncer transaction mode** (or the existing pool) — `set_config(..., true)` is transaction-local, so it's safe per request.
- Verify the app still works end-to-end with the wiring but BEFORE enabling RLS (no behavior change yet).

## Step 3 — The migration (journal as 0095 ONLY after Step 2 is green)
`packages/db/src/migrations/0095_rls_tenant_isolation.sql`:
```sql
-- For each company-scoped table (business_entities, business_modules,
-- bos_department, bos_team, bos_employee, bos_agent_profile, bos_agent_policy,
-- and core tables: companies' children — agents, issues, projects, goals,
-- approvals, routines, activity_log, etc.):

ALTER TABLE business_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_entities FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON business_entities
  USING (company_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.tenant_id', true)::uuid);

-- repeat for every company-scoped table.
-- current_setting(..., true) returns NULL when unset → USING is false → 0 rows
-- (fail-closed). Admin/migration paths run as owner with RLS bypass, or set
-- app.tenant_id explicitly.
```
Generate this programmatically from the schema's list of tables that have a
`company_id` column to avoid missing any.

## Step 4 — Tests (`tenant-isolation.spec`)
```ts
it("tenant A cannot read tenant B rows even with no company_id filter", async () => {
  await withTenant(db, companyA, () => insert(entity)); // belongs to A
  const asB = await withTenant(db, companyB, () =>
    db.select().from(businessEntities)); // deliberately unfiltered
  expect(asB).toHaveLength(0); // RLS denies A's rows to B's session
});
it("unset tenant returns zero rows (fail-closed)", async () => {
  const noTenant = await db.select().from(businessEntities);
  expect(noTenant).toHaveLength(0);
});
```

## Step 5 — Agent role hardening
Agents (the `claude-local` adapter / plugin worker DB access) connect as
`paperclip_agent` and call `withTenant` with their run's `companyId`. They can
never `BYPASSRLS`, so a malformed agent query physically cannot cross tenants.

## Rollback
`ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;` per table. Keep app-level
`company_id` filtering as defense-in-depth so disabling RLS never opens a leak.

## Apply checklist (run on a CLEAN environment)
- [ ] Reset dev env (close stale node processes / reboot) — current instance has exhausted pg connections from many restarts
- [ ] Step 1 roles created; `DATABASE_URL` → `paperclip_app`
- [ ] Step 2 `withTenant` wiring merged + app verified working (no RLS yet)
- [ ] Step 4 isolation test written and RED (no RLS → leak exists)
- [ ] Step 3 migration journaled as 0095 + applied
- [ ] Step 4 test now GREEN
- [ ] Smoke test the full UI (companies, business, connectors) under `paperclip_app`
