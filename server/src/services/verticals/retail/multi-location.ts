/**
 * Multi-location inventory helper for the Retail vertical.
 *
 * Why a dedicated service:
 *  - Retail stores often run multiple physical locations sharing the same
 *    SKU catalog but each holding their own stock. We model this by keeping
 *    `stockByLocation` on the product entity (Record<locationId, qty>).
 *  - Decrements during checkout MUST be atomic per-location to avoid
 *    double-selling the last unit when two cashiers scan the same SKU
 *    simultaneously. We achieve atomicity via a row-level optimistic lock:
 *    SELECT ... FOR UPDATE inside a transaction, then UPDATE the JSONB
 *    `stockByLocation` field.
 *  - Transfers between locations atomically decrement source and increment
 *    destination in a single transaction.
 *
 * NOTE on persistence: we use the generic `businessEntities` JSONB row for
 * retail products. Atomicity is achieved by serialising the write inside
 * a single db.transaction() block; the `FOR UPDATE` clause is supported by
 * Drizzle's `for: "update"` option on Postgres.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";

export interface StockAdjustmentReason {
  reason?: string;
  /** Optional ref to the sale/refund/transfer that caused this adjustment. */
  refId?: string;
  refType?: "sale" | "refund" | "transfer" | "manual" | "import";
}

export interface MultiLocationService {
  getStockAtLocation(companyId: string, productId: string, locationId: string): Promise<number>;
  getStockAcrossLocations(companyId: string, productId: string): Promise<Record<string, number>>;
  decrementStock(
    companyId: string,
    productId: string,
    locationId: string,
    quantity: number,
    opts?: StockAdjustmentReason,
  ): Promise<void>;
  incrementStock(
    companyId: string,
    productId: string,
    locationId: string,
    quantity: number,
    opts?: StockAdjustmentReason,
  ): Promise<void>;
  transferStock(
    companyId: string,
    productId: string,
    fromLocationId: string,
    toLocationId: string,
    quantity: number,
  ): Promise<void>;
}

interface ProductData {
  stockByLocation?: Record<string, number>;
}

export class InsufficientStockError extends Error {
  constructor(
    public productId: string,
    public locationId: string,
    public requested: number,
    public available: number,
  ) {
    super(
      `Insufficient stock for product ${productId} at location ${locationId}: requested ${requested}, available ${available}`,
    );
    this.name = "InsufficientStockError";
  }
}

function readStockMap(data: unknown): Record<string, number> {
  if (!data || typeof data !== "object") return {};
  const obj = (data as ProductData).stockByLocation;
  if (!obj || typeof obj !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.trunc(v);
  }
  return out;
}

export function createMultiLocationService(db: Db): MultiLocationService {
  /**
   * Locate a product row by id while enforcing module/type so callers can't
   * accidentally mutate a non-retail entity through this service.
   */
  async function loadProduct(
    companyId: string,
    productId: string,
    tx: Db = db,
  ) {
    const [row] = await tx
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, productId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "retail"),
          eq(businessEntities.entityType, "product"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function getStockAtLocation(
    companyId: string,
    productId: string,
    locationId: string,
  ): Promise<number> {
    const row = await loadProduct(companyId, productId);
    if (!row) return 0;
    const map = readStockMap(row.data);
    return map[locationId] ?? 0;
  }

  async function getStockAcrossLocations(
    companyId: string,
    productId: string,
  ): Promise<Record<string, number>> {
    const row = await loadProduct(companyId, productId);
    if (!row) return {};
    return readStockMap(row.data);
  }

  /**
   * Atomically mutate a product's stockByLocation map under a single
   * transaction. The mutator receives the current map and returns the
   * new map; we then write the merged `data` jsonb back.
   *
   * Multiple concurrent callers will serialise on the row (Postgres
   * row lock via `FOR UPDATE`).
   */
  async function mutateStockAtomic(
    companyId: string,
    productId: string,
    mutator: (current: Record<string, number>) => Record<string, number>,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // Row-level lock via SELECT ... FOR UPDATE.
      const rows = await tx.execute(
        sql`
          SELECT id, data FROM business_entities
          WHERE id = ${productId}
            AND company_id = ${companyId}
            AND module_key = 'retail'
            AND entity_type = 'product'
          FOR UPDATE
        `,
      );
      const row = (rows as unknown as { rows?: Array<{ id: string; data: unknown }> })
        .rows?.[0] ?? ((rows as unknown as Array<{ id: string; data: unknown }>)[0] as
          | { id: string; data: unknown }
          | undefined);
      if (!row) {
        throw new Error(`Product ${productId} not found for company ${companyId}`);
      }
      const currentData = (row.data ?? {}) as Record<string, unknown>;
      const currentMap = readStockMap(currentData);
      const nextMap = mutator({ ...currentMap });
      const nextData = { ...currentData, stockByLocation: nextMap };
      await tx
        .update(businessEntities)
        .set({ data: nextData, updatedAt: new Date() })
        .where(eq(businessEntities.id, productId));
    });
  }

  async function decrementStock(
    companyId: string,
    productId: string,
    locationId: string,
    quantity: number,
    _opts?: StockAdjustmentReason,
  ): Promise<void> {
    if (quantity <= 0) return;
    await mutateStockAtomic(companyId, productId, (map) => {
      const have = map[locationId] ?? 0;
      if (have < quantity) {
        throw new InsufficientStockError(productId, locationId, quantity, have);
      }
      map[locationId] = have - quantity;
      return map;
    });
  }

  async function incrementStock(
    companyId: string,
    productId: string,
    locationId: string,
    quantity: number,
    _opts?: StockAdjustmentReason,
  ): Promise<void> {
    if (quantity <= 0) return;
    await mutateStockAtomic(companyId, productId, (map) => {
      map[locationId] = (map[locationId] ?? 0) + quantity;
      return map;
    });
  }

  async function transferStock(
    companyId: string,
    productId: string,
    fromLocationId: string,
    toLocationId: string,
    quantity: number,
  ): Promise<void> {
    if (quantity <= 0) return;
    if (fromLocationId === toLocationId) return;
    await mutateStockAtomic(companyId, productId, (map) => {
      const have = map[fromLocationId] ?? 0;
      if (have < quantity) {
        throw new InsufficientStockError(productId, fromLocationId, quantity, have);
      }
      map[fromLocationId] = have - quantity;
      map[toLocationId] = (map[toLocationId] ?? 0) + quantity;
      return map;
    });
  }

  return {
    getStockAtLocation,
    getStockAcrossLocations,
    decrementStock,
    incrementStock,
    transferStock,
  };
}
