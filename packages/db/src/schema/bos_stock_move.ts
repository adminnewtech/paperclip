import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosStockMove = pgTable(
  "bos_stock_move",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    ref: text("ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_stock_move_company_idx").on(table.companyId),
    variantIdx: index("bos_stock_move_variant_idx").on(table.variantId),
  }),
);
