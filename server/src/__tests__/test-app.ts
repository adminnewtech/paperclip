/**
 * Builds a minimal Express app for integration tests.
 *
 * The full `createApp()` in src/app.ts wires up dozens of routers (better-auth,
 * the vite dev server, the plugin worker manager, …). For business-module
 * tests we don't need any of that — we only want the business / accounting /
 * public-storefront routers mounted, behind an actor middleware that we can
 * fully control from the test.
 *
 * `createTestApp` therefore:
 *   1. Creates a bare `express()` instance with JSON parsing.
 *   2. Optionally injects a stub `actor` so handlers see a "logged-in" user
 *      without going through better-auth.
 *   3. Mounts the requested routers (defaults to: business, accounting,
 *      public-storefront).
 *   4. Attaches the standard error handler so handlers' thrown errors
 *      surface as JSON.
 */

import express, { type Express, type RequestHandler, type Router } from "express";
import type { Db } from "@paperclipai/db";
import { errorHandler } from "../middleware/index.js";
import { businessRoutes } from "../routes/business.js";
import { businessAccountingRoutes } from "../routes/business-accounting.js";
import { publicStorefrontRoutes } from "../routes/public-storefront.js";
import { createBusinessStreamService } from "../services/business-stream-service.js";
import { createBusinessAuditService } from "../services/business-audit-service.js";
import { createAutoPostingService } from "../services/accounting/auto-posting-service.js";

export interface TestActor {
  type?: "board" | "agent";
  userId: string;
  companyIds: string[];
  source?:
    | "local_implicit"
    | "session"
    | "board_key"
    | "agent_key"
    | "agent_jwt"
    | "cloud_tenant"
    | "none";
  isInstanceAdmin?: boolean;
  memberships?: Array<{
    companyId: string;
    membershipRole?: string | null;
    status?: string;
  }>;
}

export interface CreateTestAppOptions {
  /** Stub actor (defaults to a board user with companyIds=["company-1"]). */
  actor?: TestActor;
  /** If true, the test app skips actor injection entirely. */
  bypassAuth?: boolean;
  /** When true, mounts the public storefront API at /api/public. Default true. */
  mountPublic?: boolean;
  /** When true, mounts the company-scoped business routes. Default true. */
  mountBusiness?: boolean;
  /** When true, mounts the accounting routes. Default true. */
  mountAccounting?: boolean;
  /** Extra routers to mount under /api after the defaults. */
  extraRouters?: Array<{ path?: string; router: Router }>;
}

function defaultActor(actor: TestActor | undefined): TestActor {
  const companyIds = actor?.companyIds ?? ["company-1"];
  return {
    type: actor?.type ?? "board",
    source: actor?.source ?? "session",
    isInstanceAdmin: actor?.isInstanceAdmin ?? false,
    userId: actor?.userId ?? "test-user-1",
    companyIds,
    memberships:
      actor?.memberships ??
      companyIds.map((id) => ({
        companyId: id,
        membershipRole: "admin",
        status: "active",
      })),
  };
}

function actorMiddlewareStub(actor: TestActor): RequestHandler {
  return (req, _res, next) => {
    const cloned = {
      ...actor,
      companyIds: [...actor.companyIds],
      memberships: actor.memberships ? actor.memberships.map((m) => ({ ...m })) : undefined,
    };
    (req as unknown as { actor: typeof cloned }).actor = cloned;
    next();
  };
}

export function createTestApp(db: Db, options: CreateTestAppOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const actor = defaultActor(options.actor);
  if (!options.bypassAuth) {
    app.use(actorMiddlewareStub(actor));
  }

  const mountPublic = options.mountPublic ?? true;
  const mountBusiness = options.mountBusiness ?? true;
  const mountAccounting = options.mountAccounting ?? true;

  if (mountPublic) {
    app.use("/api/public", publicStorefrontRoutes(db));
  }

  if (mountBusiness) {
    const stream = createBusinessStreamService();
    const audit = createBusinessAuditService(db);
    const autoPosting = createAutoPostingService(db);
    app.use("/api", businessRoutes(db, stream, audit, autoPosting));
  }

  if (mountAccounting) {
    app.use("/api", businessAccountingRoutes(db));
  }

  if (options.extraRouters) {
    for (const entry of options.extraRouters) {
      app.use(entry.path ?? "/api", entry.router);
    }
  }

  app.use(errorHandler);
  return app;
}
