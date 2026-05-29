import {
  pgTable,
  uuid,
  text,
  bigint,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosPosOrder = pgTable(
  "bos_pos_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id"),
    warehouseId: uuid("warehouse_id"),
    lines: jsonb("lines").notNull().default([]),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    paymentMethod: text("payment_method"),
    customerName: text("customer_name"),
    status: text("status").default("paid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_pos_order_company_idx").on(table.companyId),
    sessionIdx: index("bos_pos_order_session_idx").on(table.sessionId),
  }),
);
