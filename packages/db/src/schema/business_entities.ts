import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  bigint,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * A flexible, JSONB-backed table that backs all Business Management entities
 * in Phase 1 (CRM contacts/deals, sales orders, invoices, products, employees,
 * tickets, campaigns, accounts, journal entries, etc.). Later phases will
 * promote high-traffic entity types to dedicated tables while keeping the same
 * route shape and UI.
 *
 * - `moduleKey`  : "crm" | "sales" | "inventory" | "finance" | ...
 * - `entityType` : "contact" | "deal" | "invoice" | "product" | ...
 * - `data`       : type-specific payload validated at the route boundary.
 */
export const businessEntities = pgTable(
  "business_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    entityType: text("entity_type").notNull(),
    parentId: uuid("parent_id"),
    code: text("code"),
    name: text("name"),
    status: text("status").notNull().default("active"),
    ownerUserId: text("owner_user_id"),
    amountCents: bigint("amount_cents", { mode: "number" }),
    currency: text("currency"),
    data: jsonb("data").notNull().default({}),
    tags: jsonb("tags").notNull().default([]),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyModuleTypeIdx: index("business_entities_company_module_type_idx").on(
      table.companyId,
      table.moduleKey,
      table.entityType,
    ),
    companyUpdatedIdx: index("business_entities_company_updated_idx").on(
      table.companyId,
      table.updatedAt,
    ),
    parentIdx: index("business_entities_parent_idx").on(table.parentId),
    nameSearchIdx: index("business_entities_name_search_idx").using(
      "gin",
      table.name.op("gin_trgm_ops"),
    ),
  }),
);
