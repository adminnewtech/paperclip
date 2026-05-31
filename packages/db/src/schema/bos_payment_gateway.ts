import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * Per-company local payment rail configuration (KNET, mada, Tabby, Tamara,
 * MyFatoorah, Apple Pay). Sandbox-only by default — config is opaque JSON. No
 * real provider calls are made; this is a configuration record.
 */
export const bosPaymentGateway = pgTable(
  "bos_payment_gateway",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider"), // knet | mada | tabby | tamara | myfatoorah | applepay
    enabled: boolean("enabled").notNull().default(false),
    mode: text("mode").default("sandbox"), // sandbox | live
    config: jsonb("config").notNull().default({}),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_payment_gateway_company_idx").on(table.companyId),
    companyProviderIdx: index("bos_payment_gateway_company_provider_idx").on(
      table.companyId,
      table.provider,
    ),
  }),
);
