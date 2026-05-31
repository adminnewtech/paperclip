import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosShippingRate = pgTable(
  "bos_shipping_rate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    zoneId: uuid("zone_id").notNull(),
    name: text("name").notNull(),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull().default(0),
    minOrderFreeMinor: bigint("min_order_free_minor", { mode: "number" }),
    estDays: text("est_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_shipping_rate_company_idx").on(table.companyId),
    zoneIdx: index("bos_shipping_rate_zone_idx").on(table.zoneId),
  }),
);
