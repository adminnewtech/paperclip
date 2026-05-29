import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosProduct = pgTable(
  "bos_product",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    category: text("category"),
    priceMinor: bigint("price_minor", { mode: "number" }),
    costMinor: bigint("cost_minor", { mode: "number" }),
    currency: text("currency").default("KWD"),
    status: text("status").default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_product_company_idx").on(table.companyId),
    companySkuIdx: index("bos_product_company_sku_idx").on(
      table.companyId,
      table.sku,
    ),
  }),
);
