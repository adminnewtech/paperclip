import {
  pgTable,
  uuid,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosStock = pgTable(
  "bos_stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    qty: integer("qty").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    reorderPoint: integer("reorder_point").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_stock_company_idx").on(table.companyId),
    warehouseIdx: index("bos_stock_warehouse_idx").on(table.warehouseId),
    variantWarehouseUnique: unique("bos_stock_variant_warehouse_unique").on(
      table.variantId,
      table.warehouseId,
    ),
  }),
);
