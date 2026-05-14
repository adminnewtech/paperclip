import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { GCC_CURRENCY_CODES, type GccCurrency } from "@paperclipai/shared";

export type FxRateSource = "manual" | "cbk" | "sama" | "mock";

export interface FxRate {
  base: GccCurrency;
  quote: GccCurrency;
  rate: number;
  fetchedAt: string;
  source: FxRateSource;
}

export interface FxRatesService {
  getRate(
    companyId: string,
    from: GccCurrency,
    to: GccCurrency,
  ): Promise<FxRate>;
  getAllRates(companyId: string, base?: GccCurrency): Promise<FxRate[]>;
  refreshRates(companyId: string): Promise<void>;
  setRate(
    companyId: string,
    from: GccCurrency,
    to: GccCurrency,
    rate: number,
    source?: FxRateSource,
  ): Promise<FxRate>;
}

// Approximate 2026 default rates anchored on KWD.
// Used as a mock fallback until a live CBK/SAMA integration is wired up.
const KWD_DEFAULTS: Record<GccCurrency, number> = {
  KWD: 1,
  SAR: 12.2,
  AED: 11.95,
  QAR: 11.85,
  BHD: 1.23,
  OMR: 1.25,
};

// USD -> KWD reference (1 USD ≈ 0.31 KWD), kept here for documentation /
// future cross-currency tooling. Not currently exported via the API.
export const USD_TO_KWD_REFERENCE = 0.31;

const SYSTEM_MODULE_KEY = "system";
const FX_RATE_ENTITY_TYPE = "fx_rate";

function pairCode(from: GccCurrency, to: GccCurrency): string {
  return `${from}-${to}`;
}

/** Cross-rate two currencies via a common base (KWD). */
function deriveFromKwd(from: GccCurrency, to: GccCurrency): number {
  if (from === to) return 1;
  const fromPerKwd = KWD_DEFAULTS[from];
  const toPerKwd = KWD_DEFAULTS[to];
  // 1 KWD = `fromPerKwd` of `from`, so 1 `from` = 1/fromPerKwd KWD.
  // 1 KWD = `toPerKwd` of `to`. So 1 `from` = toPerKwd / fromPerKwd of `to`.
  return toPerKwd / fromPerKwd;
}

function buildDefaultRate(
  from: GccCurrency,
  to: GccCurrency,
  source: FxRateSource = "mock",
): FxRate {
  return {
    base: from,
    quote: to,
    rate: deriveFromKwd(from, to),
    fetchedAt: new Date().toISOString(),
    source,
  };
}

interface FxRateRowData {
  rate?: number;
  source?: FxRateSource;
  fetchedAt?: string;
}

function rowToFxRate(
  from: GccCurrency,
  to: GccCurrency,
  data: FxRateRowData | null | undefined,
): FxRate {
  const rate = typeof data?.rate === "number" ? data.rate : deriveFromKwd(from, to);
  const source: FxRateSource =
    data?.source === "manual" ||
    data?.source === "cbk" ||
    data?.source === "sama"
      ? data.source
      : "mock";
  const fetchedAt =
    typeof data?.fetchedAt === "string" ? data.fetchedAt : new Date().toISOString();
  return { base: from, quote: to, rate, fetchedAt, source };
}

export function createFxRatesService(db: Db): FxRatesService {
  async function loadStoredRates(
    companyId: string,
  ): Promise<Map<string, FxRate>> {
    const rows = await db
      .select({
        code: businessEntities.code,
        data: businessEntities.data,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, SYSTEM_MODULE_KEY),
          eq(businessEntities.entityType, FX_RATE_ENTITY_TYPE),
        ),
      );
    const map = new Map<string, FxRate>();
    for (const row of rows) {
      const code = row.code ?? "";
      const [from, to] = code.split("-") as [GccCurrency, GccCurrency];
      if (!from || !to) continue;
      if (!GCC_CURRENCY_CODES.includes(from) || !GCC_CURRENCY_CODES.includes(to)) {
        continue;
      }
      map.set(code, rowToFxRate(from, to, (row.data ?? {}) as FxRateRowData));
    }
    return map;
  }

  async function upsertRate(
    companyId: string,
    rate: FxRate,
  ): Promise<void> {
    const code = pairCode(rate.base, rate.quote);
    const existing = await db
      .select({ id: businessEntities.id })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, SYSTEM_MODULE_KEY),
          eq(businessEntities.entityType, FX_RATE_ENTITY_TYPE),
          eq(businessEntities.code, code),
        ),
      )
      .limit(1);

    const payload: FxRateRowData = {
      rate: rate.rate,
      source: rate.source,
      fetchedAt: rate.fetchedAt,
    };

    const now = new Date();
    if (existing.length === 0) {
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: SYSTEM_MODULE_KEY,
        entityType: FX_RATE_ENTITY_TYPE,
        code,
        name: `${rate.base} → ${rate.quote}`,
        status: "active",
        data: payload,
        tags: [],
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await db
        .update(businessEntities)
        .set({ data: payload, updatedAt: now })
        .where(eq(businessEntities.id, existing[0]!.id));
    }
  }

  async function seedDefaultsIfEmpty(companyId: string): Promise<void> {
    const stored = await loadStoredRates(companyId);
    if (stored.size > 0) return;
    for (const from of GCC_CURRENCY_CODES) {
      for (const to of GCC_CURRENCY_CODES) {
        if (from === to) continue;
        await upsertRate(companyId, buildDefaultRate(from, to, "mock"));
      }
    }
  }

  return {
    async getRate(companyId, from, to) {
      if (from === to) return buildDefaultRate(from, to, "mock");
      const stored = await loadStoredRates(companyId);
      const found = stored.get(pairCode(from, to));
      return found ?? buildDefaultRate(from, to, "mock");
    },

    async getAllRates(companyId, base) {
      const stored = await loadStoredRates(companyId);
      const out: FxRate[] = [];
      const bases = base ? [base] : GCC_CURRENCY_CODES;
      for (const from of bases) {
        for (const to of GCC_CURRENCY_CODES) {
          if (from === to) continue;
          const code = pairCode(from, to);
          out.push(stored.get(code) ?? buildDefaultRate(from, to, "mock"));
        }
      }
      return out;
    },

    async refreshRates(companyId) {
      // TODO: fetch from CBK API (https://www.cbk.gov.kw/) and SAMA for SAR.
      // For now: re-seed defaults if storage is empty so callers always get
      // a complete cross-rate matrix.
      console.log(
        `[fx-rates] refreshRates(${companyId}): TODO: fetch from CBK API; seeding mock defaults if empty`,
      );
      await seedDefaultsIfEmpty(companyId);
    },

    async setRate(companyId, from, to, rate, source = "manual") {
      const fxRate: FxRate = {
        base: from,
        quote: to,
        rate,
        fetchedAt: new Date().toISOString(),
        source,
      };
      await upsertRate(companyId, fxRate);
      return fxRate;
    },
  };
}

