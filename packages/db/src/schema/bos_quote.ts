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

export const bosQuote = pgTable(
  "bos_quote",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number"),
    dealId: uuid("deal_id"),
    customerName: text("customer_name"),
    lines: jsonb("lines").notNull().default([]),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    // draft | sent | accepted | rejected | expired
    status: text("status").default("draft"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_quote_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_quote_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    dealIdx: index("bos_quote_deal_idx").on(table.dealId),
  }),
);
