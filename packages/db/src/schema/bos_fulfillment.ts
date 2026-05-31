import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosFulfillment = pgTable(
  "bos_fulfillment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    onlineOrderId: uuid("online_order_id").notNull(),
    warehouseId: uuid("warehouse_id"),
    status: text("status").default("pending"),
    tracking: text("tracking"),
    carrier: text("carrier"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_fulfillment_company_idx").on(table.companyId),
    orderIdx: index("bos_fulfillment_order_idx").on(table.onlineOrderId),
  }),
);
