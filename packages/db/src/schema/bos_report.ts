import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosReport = pgTable(
  "bos_report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // revenue | sales | inventory | crm | finance | custom
    kind: text("kind").notNull().default("custom"),
    config: jsonb("config").notNull().default({}),
    schedule: text("schedule"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_report_company_idx").on(table.companyId),
    companyKindIdx: index("bos_report_company_kind_idx").on(
      table.companyId,
      table.kind,
    ),
  }),
);
