import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosPurchaseOrder = pgTable(
  "bos_purchase_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number"),
    vendorId: uuid("vendor_id"),
    warehouseId: uuid("warehouse_id"),
    status: text("status").default("draft"),
    orderDate: timestamp("order_date", { withTimezone: true }).defaultNow(),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_purchase_order_company_idx").on(table.companyId),
    vendorIdx: index("bos_purchase_order_vendor_idx").on(table.vendorId),
  }),
);
