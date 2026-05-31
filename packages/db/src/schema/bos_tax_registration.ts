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

/**
 * Per-company tax registration for a GCC country (KSA / UAE / Kuwait). Holds the
 * VAT number, whether the company is registered, the applicable VAT rate in
 * basis points, and the scheme. One row per (company, country).
 */
export const bosTaxRegistration = pgTable(
  "bos_tax_registration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    country: text("country"), // SA | AE | KW
    vatNumber: text("vat_number"),
    registered: boolean("registered").notNull().default(false),
    vatRateBps: integer("vat_rate_bps").notNull().default(0),
    scheme: text("scheme").default("standard"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_tax_registration_company_idx").on(table.companyId),
    companyCountryIdx: index("bos_tax_registration_company_country_idx").on(
      table.companyId,
      table.country,
    ),
  }),
);
