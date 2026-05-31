import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosQuoteLine = pgTable(
  "bos_quote_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").notNull(),
    description: text("description"),
    qty: integer("qty").notNull().default(1),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull().default(0),
    lineTotalMinor: bigint("line_total_minor", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_quote_line_company_idx").on(table.companyId),
    quoteIdx: index("bos_quote_line_quote_idx").on(table.quoteId),
  }),
);
