import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosStorePage = pgTable(
  "bos_store_page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    title: text("title").notNull(),
    slug: text("slug"),
    body: text("body"),
    published: boolean("published").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_store_page_company_idx").on(table.companyId),
    storeIdx: index("bos_store_page_store_idx").on(table.storeId),
  }),
);
