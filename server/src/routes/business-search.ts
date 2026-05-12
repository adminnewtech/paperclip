import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { getBusinessModule } from "@paperclipai/shared";
import { assertCompanyAccess } from "./authz.js";

/**
 * Business search route.
 *
 * Searches the {@link businessEntities} table for entities belonging to the
 * given company. Supports optional `module` filtering. Matches are produced
 * via a trigram similarity prefilter (using the `business_entities_name_search_idx`
 * GIN index on `name` with `gin_trgm_ops`) plus an ILIKE pattern fallback on
 * both `name` and `code` so abbreviations and codes (e.g. `INV-2026-001`)
 * resolve quickly.
 */

const BUSINESS_SEARCH_MAX_QUERY_LENGTH = 200;
const BUSINESS_SEARCH_DEFAULT_LIMIT = 20;
const BUSINESS_SEARCH_MAX_LIMIT = 50;
const SNIPPET_MAX_CHARS = 240;
// Trigram similarity threshold for the GIN index prefilter. Lower = more
// recall but more noise. 0.2 is a sensible default for short business names
// without surfacing wildly unrelated entries.
const TRIGRAM_SIMILARITY_THRESHOLD = 0.2;

const businessSearchQuerySchema = z.object({
  q: z
    .preprocess(
      (value) => (Array.isArray(value) ? value[0] : value),
      z.string().optional().default(""),
    )
    .transform((value) => value.slice(0, BUSINESS_SEARCH_MAX_QUERY_LENGTH).trim()),
  module: z
    .preprocess(
      (value) => (Array.isArray(value) ? value[0] : value),
      z.string().optional().default(""),
    )
    .transform((value) => value.trim()),
  limit: z
    .preprocess(
      (value) => {
        const raw = Array.isArray(value) ? value[0] : value;
        if (typeof raw === "number") return raw;
        if (typeof raw === "string" && raw.trim().length > 0) {
          return Number.parseInt(raw, 10);
        }
        return Number.NaN;
      },
      z.number(),
    )
    .transform((value) => {
      if (!Number.isFinite(value)) return BUSINESS_SEARCH_DEFAULT_LIMIT;
      return Math.min(BUSINESS_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(value)));
    }),
});

export interface BusinessSearchResult {
  id: string;
  moduleKey: string;
  entityType: string;
  name: string | null;
  code: string | null;
  amountCents: number | null;
  currency: string | null;
  status: string;
  snippet: string | null;
  url: string;
  updatedAt: string | null;
}

export interface BusinessSearchResponse {
  results: BusinessSearchResult[];
  total: number;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildSnippet(row: {
  name: string | null;
  code: string | null;
  data: unknown;
}): string | null {
  // Prefer a `description` or `notes` field from the JSONB payload, falling
  // back to the name/code combination so the UI always has something to show.
  const data = row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null;
  const description = (() => {
    if (!data) return null;
    for (const key of ["description", "notes", "summary", "subject"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
    return null;
  })();
  if (description) {
    return description.length > SNIPPET_MAX_CHARS
      ? `${description.slice(0, SNIPPET_MAX_CHARS - 1)}…`
      : description;
  }
  if (row.name && row.code && row.name !== row.code) return `${row.code} · ${row.name}`;
  return row.name ?? row.code ?? null;
}

function buildUrl(moduleKey: string, entityType: string, id: string): string {
  return `/business/${encodeURIComponent(moduleKey)}/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function businessSearchRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/business/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = businessSearchQuerySchema.parse(req.query);
    const query = parsed.q;
    const moduleKey = parsed.module || null;
    const limit = parsed.limit;

    if (moduleKey && !getBusinessModule(moduleKey)) {
      res.status(400).json({ error: "Unknown business module" });
      return;
    }

    if (query.length === 0) {
      const response: BusinessSearchResponse = { results: [], total: 0 };
      res.json(response);
      return;
    }

    const escaped = escapeLikePattern(query.toLowerCase());
    const containsPattern = `%${escaped}%`;

    const conditions: SQL[] = [eq(businessEntities.companyId, companyId)];
    if (moduleKey) {
      conditions.push(eq(businessEntities.moduleKey, moduleKey));
    }

    // Combined match: trigram similarity on `name` (uses GIN index) OR ILIKE
    // on either `name`/`code`. The trigram operator `%` is exposed by pg_trgm
    // and the index `business_entities_name_search_idx` covers it.
    const trigramMatch = sql<boolean>`(${businessEntities.name} %% ${query})`;
    const nameIlikeMatch = ilike(businessEntities.name, containsPattern);
    const codeIlikeMatch = ilike(businessEntities.code, containsPattern);
    const matchCondition = or(trigramMatch, nameIlikeMatch, codeIlikeMatch);
    if (matchCondition) conditions.push(matchCondition);

    // Score: exact code/name > prefix > contains > trigram. We compute it in
    // SQL so the database can drive ORDER BY without an extra round-trip.
    const score = sql<number>`
      (
        CASE WHEN lower(coalesce(${businessEntities.code}, '')) = ${query.toLowerCase()} THEN 1000 ELSE 0 END
        + CASE WHEN lower(coalesce(${businessEntities.name}, '')) = ${query.toLowerCase()} THEN 800 ELSE 0 END
        + CASE WHEN lower(coalesce(${businessEntities.code}, '')) LIKE ${escaped + "%"} ESCAPE '\\' THEN 400 ELSE 0 END
        + CASE WHEN lower(coalesce(${businessEntities.name}, '')) LIKE ${escaped + "%"} ESCAPE '\\' THEN 350 ELSE 0 END
        + CASE WHEN lower(coalesce(${businessEntities.code}, '')) LIKE ${containsPattern} ESCAPE '\\' THEN 150 ELSE 0 END
        + CASE WHEN lower(coalesce(${businessEntities.name}, '')) LIKE ${containsPattern} ESCAPE '\\' THEN 120 ELSE 0 END
        + CASE WHEN ${businessEntities.name} %% ${query} THEN (similarity(coalesce(${businessEntities.name}, ''), ${query}) * 100)::int ELSE 0 END
      )::double precision
    `;

    // Apply trigram similarity threshold for this query (pg_trgm session GUC).
    // We use set_limit so the `%` operator above only matches the strongest
    // trigram candidates and we don't drown in noise.
    await db.execute(sql`SELECT set_limit(${TRIGRAM_SIMILARITY_THRESHOLD})`);

    const rows = await db
      .select({
        id: businessEntities.id,
        moduleKey: businessEntities.moduleKey,
        entityType: businessEntities.entityType,
        name: businessEntities.name,
        code: businessEntities.code,
        amountCents: businessEntities.amountCents,
        currency: businessEntities.currency,
        status: businessEntities.status,
        data: businessEntities.data,
        updatedAt: businessEntities.updatedAt,
        score,
      })
      .from(businessEntities)
      .where(and(...conditions))
      .orderBy(desc(score), desc(businessEntities.updatedAt))
      .limit(limit);

    const totalRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(businessEntities)
      .where(and(...conditions));
    const total = Number(totalRow[0]?.count ?? 0);

    const results: BusinessSearchResult[] = rows.map((row) => ({
      id: row.id,
      moduleKey: row.moduleKey,
      entityType: row.entityType,
      name: row.name,
      code: row.code,
      amountCents: row.amountCents ?? null,
      currency: row.currency,
      status: row.status,
      snippet: buildSnippet(row),
      url: buildUrl(row.moduleKey, row.entityType, row.id),
      updatedAt: isoOrNull(row.updatedAt),
    }));

    const response: BusinessSearchResponse = { results, total };
    res.json(response);
  });

  return router;
}
