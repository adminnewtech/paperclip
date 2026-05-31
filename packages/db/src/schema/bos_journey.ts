import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosJourney = pgTable(
  "bos_journey",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trigger: text("trigger"),
    nodes: jsonb("nodes").notNull().default([]),
    enabled: boolean("enabled").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_journey_company_idx").on(table.companyId),
  }),
);
