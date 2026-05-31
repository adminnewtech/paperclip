import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosBriefing = pgTable(
  "bos_briefing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    period: text("period"),
    summary: text("summary"),
    metrics: jsonb("metrics").notNull().default({}),
    alerts: jsonb("alerts").notNull().default([]),
    insights: jsonb("insights").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_briefing_company_idx").on(table.companyId),
    companyGeneratedIdx: index("bos_briefing_company_generated_idx").on(
      table.companyId,
      table.generatedAt,
    ),
  }),
);
