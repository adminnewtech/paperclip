import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosDepartment = pgTable(
  "bos_department",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name"),
    nameI18n: jsonb("name_i18n").notNull().default({}),
    icon: text("icon"),
    color: text("color"),
    enabled: boolean("enabled").notNull().default(true),
    gated: boolean("gated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_department_company_idx").on(table.companyId),
    companyKeyIdx: index("bos_department_company_key_idx").on(
      table.companyId,
      table.key,
    ),
  }),
);
