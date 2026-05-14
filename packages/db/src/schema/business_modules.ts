import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const businessModules = pgTable(
  "business_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").notNull().default({}),
    industryPreset: text("industry_preset"),
    activatedByUserId: text("activated_by_user_id"),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyModuleUq: uniqueIndex("business_modules_company_module_uq").on(
      table.companyId,
      table.moduleKey,
    ),
    companyIdx: index("business_modules_company_idx").on(table.companyId),
  }),
);
