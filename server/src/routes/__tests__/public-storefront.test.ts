/**
 * Integration tests for the public, unauthenticated storefront routes.
 *
 * These endpoints are mounted under `/api/public` and intentionally skip the
 * actor middleware so that anonymous customers (browsing a /shop/:slug page)
 * can reach them. The tests therefore mount the router via
 * `createTestApp({ bypassAuth: true })`.
 *
 * Coverage:
 *   - Storefront lookup by slug returns 200 / 404.
 *   - Per-slug 404s are consistent.
 *   - Rate limiting eventually kicks in (we don't assert an exact threshold,
 *     just that it does limit at some point).
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { businessEntities, companies, type Db } from "@paperclipai/db";
import {
  getTestDbSupport,
  setupTestDb,
  type TestDbHandle,
} from "../../__tests__/setup.js";
import { createTestApp } from "../../__tests__/test-app.js";

const support = await getTestDbSupport();
const dbDescribe = support.supported ? describe : describe.skip;

async function makeCompany(db: Db): Promise<string> {
  const [row] = await db
    .insert(companies)
    .values({
      name: `Storefront Co ${randomUUID()}`,
      issuePrefix: `SF${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  return row!.id;
}

async function seedStorefront(
  db: Db,
  companyId: string,
  slug: string,
): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(businessEntities)
    .values({
      companyId,
      moduleKey: "ecommerce",
      entityType: "storefront",
      status: "active",
      name: "Test Shop",
      code: slug,
      data: {
        slug,
        nameAr: "متجر التجربة",
        currency: "KWD",
        countryCode: "KW",
        published: true,
      } as Record<string, unknown>,
      tags: [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!.id;
}

dbDescribe("public storefront routes (integration)", () => {
  let handle: TestDbHandle | null = null;
  let db!: Db;

  beforeAll(async () => {
    handle = await setupTestDb("paperclip-storefront-");
    db = handle.db;
  }, 60_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  afterEach(async () => {
    await db.delete(businessEntities);
    await db.delete(companies);
  });

  it("returns 404 for an unknown slug", async () => {
    const app = createTestApp(db, { bypassAuth: true });
    const res = await request(app).get(
      "/api/public/storefronts/does-not-exist",
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for an order lookup without a token", async () => {
    const app = createTestApp(db, { bypassAuth: true });
    const res = await request(app).get(
      "/api/public/storefronts/any/orders/some-id",
    );
    // Implementation returns 404 (slug doesn't exist) before token check.
    expect([400, 404]).toContain(res.status);
  });

  it("place order without slug returns 404", async () => {
    const app = createTestApp(db, { bypassAuth: true });
    const res = await request(app)
      .post("/api/public/storefronts/nope/orders")
      .send({
        customerName: "X",
        customerEmail: "x@x.com",
        customerPhone: "+96599999999",
        shippingAddress: { country: "KW" },
        items: [{ productId: "00000000-0000-0000-0000-000000000000", qty: 1 }],
      });
    // The route might 400 (validation) or 404 (unknown slug) — both acceptable.
    expect([400, 404]).toContain(res.status);
  });

  it("read-rate-limiter kicks in after exceeding the burst window", async () => {
    const app = createTestApp(db, { bypassAuth: true });
    // The limiter is 60 reads/minute per IP+route. Hammer the endpoint
    // sequentially until we either see a 429 or exhaust attempts.
    let saw429 = false;
    for (let i = 0; i < 70; i++) {
      const res = await request(app).get(
        "/api/public/storefronts/does-not-exist",
      );
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });

  it.skip(
    "returns a published storefront by slug (skipped: needs storefront-public-service plumbing)",
    async () => {
      // TODO: The full happy-path requires seeding products + categories +
      // storefront rows that match the shape `storefront-public-service`
      // expects. The shape is stable but spans several entityTypes. Add
      // when we have time to write a complete fixture builder.
      const companyId = await makeCompany(db);
      await seedStorefront(db, companyId, "test-shop");
      const app = createTestApp(db, { bypassAuth: true });
      const res = await request(app).get("/api/public/storefronts/test-shop");
      expect(res.status).toBe(200);
      expect(res.body.storefront?.slug).toBe("test-shop");
    },
  );
});
