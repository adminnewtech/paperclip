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

export const bosOnlineOrder = pgTable(
  "bos_online_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number"),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    lines: jsonb("lines").notNull().default([]),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    shippingMinor: bigint("shipping_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    status: text("status").default("pending"),
    channel: text("channel").default("online"),
    shippingAddress: jsonb("shipping_address").notNull().default({}),
    discountCode: text("discount_code"),
    journalEntryId: uuid("journal_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_online_order_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_online_order_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
