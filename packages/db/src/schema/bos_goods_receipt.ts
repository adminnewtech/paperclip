import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosGoodsReceipt = pgTable(
  "bos_goods_receipt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    poId: uuid("po_id").notNull(),
    warehouseId: uuid("warehouse_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow(),
    lines: jsonb("lines").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_goods_receipt_company_idx").on(table.companyId),
    poIdx: index("bos_goods_receipt_po_idx").on(table.poId),
  }),
);
