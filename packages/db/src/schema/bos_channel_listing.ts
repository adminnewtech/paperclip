import {
  pgTable,
  uuid,
  bigint,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosChannelListing = pgTable(
  "bos_channel_listing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    productId: uuid("product_id"),
    variantId: uuid("variant_id"),
    listed: boolean("listed").notNull().default(true),
    priceOverrideMinor: bigint("price_override_minor", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_channel_listing_company_idx").on(table.companyId),
    channelIdx: index("bos_channel_listing_channel_idx").on(table.channelId),
  }),
);
