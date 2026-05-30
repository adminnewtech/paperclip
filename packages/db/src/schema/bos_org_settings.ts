import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosOrgSettings = pgTable(
  "bos_org_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    legalName: text("legal_name"),
    logoUrl: text("logo_url"),
    address: text("address"),
    taxId: text("tax_id"),
    crNumber: text("cr_number"),
    defaultCurrency: text("default_currency").default("KWD"),
    fiscalYearStartMonth: integer("fiscal_year_start_month").default(1),
    locale: text("locale").default("ar"),
    rtl: boolean("rtl").default(true),
    branding: jsonb("branding").default({}),
    config: jsonb("config").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_org_settings_company_idx").on(table.companyId),
    companyUnique: unique("bos_org_settings_company_unique").on(table.companyId),
  }),
);
