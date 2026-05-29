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
import { bosProduct } from "./bos_product.js";

export const bosProductVariant = pgTable(
  "bos_product_variant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => bosProduct.id, { onDelete: "cascade" }),
    sku: text("sku"),
    attrs: jsonb("attrs").default({}),
    priceDeltaMinor: bigint("price_delta_minor", { mode: "number" }).default(0),
    barcode: text("barcode"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_product_variant_company_idx").on(table.companyId),
    productIdx: index("bos_product_variant_product_idx").on(table.productId),
  }),
);
