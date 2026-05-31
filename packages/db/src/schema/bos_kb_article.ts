import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosKbArticle = pgTable(
  "bos_kb_article",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title"),
    slug: text("slug"),
    body: text("body"),
    category: text("category"),
    published: boolean("published").notNull().default(false),
    views: integer("views").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_kb_article_company_idx").on(table.companyId),
  }),
);
