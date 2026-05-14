/**
 * Test DB setup + tear-down helpers for the business module test harness.
 *
 * Strategy:
 *   - We rely on `embedded-postgres` (already a runtime dep) so tests can run
 *     against a real Postgres with the production schema, just like the
 *     other server-side service tests in this repo.
 *   - `setupTestDb()` boots a fresh database per call. Use it sparingly:
 *     start-up is ~5-15s on first run.
 *   - For multi-test files prefer the `beforeAll` / `afterAll` pattern used
 *     by `access-service.test.ts` to amortise the start-up cost across an
 *     entire `describe` block.
 *
 * If embedded postgres is unavailable in the current environment (for
 * example sandboxed CI without write access to a free TCP port) every
 * helper still resolves — `getTestDbSupport()` returns `{ supported: false,
 * reason: "..."}` so callers can `it.skip()` cleanly rather than crashing.
 */

import {
  createDb,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type Db,
  type EmbeddedPostgresTestSupport,
} from "@paperclipai/db";

export type TestDb = Db;

export interface TestDbHandle {
  db: TestDb;
  cleanup(): Promise<void>;
}

let cachedSupport: EmbeddedPostgresTestSupport | null = null;

export async function getTestDbSupport(): Promise<EmbeddedPostgresTestSupport> {
  if (!cachedSupport) {
    cachedSupport = await getEmbeddedPostgresTestSupport();
  }
  return cachedSupport;
}

export async function setupTestDb(prefix = "paperclip-test-"): Promise<TestDbHandle> {
  const support = await getTestDbSupport();
  if (!support.supported) {
    throw new Error(
      `Embedded postgres is not supported in this environment: ${support.reason ?? "unknown"}`,
    );
  }
  const tempDb = await startEmbeddedPostgresTestDatabase(prefix);
  const db = createDb(tempDb.connectionString);
  return {
    db,
    cleanup: async () => {
      await tempDb.cleanup();
    },
  };
}

export async function teardownTestDb(handle: TestDbHandle): Promise<void> {
  await handle.cleanup();
}

export async function withTestDb<T>(
  fn: (db: TestDb) => Promise<T>,
  opts?: { prefix?: string },
): Promise<T> {
  const handle = await setupTestDb(opts?.prefix ?? "paperclip-test-");
  try {
    return await fn(handle.db);
  } finally {
    await teardownTestDb(handle);
  }
}
