import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosLead = pgTable(
  "bos_lead",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    companyName: text("company_name"),
    email: text("email"),
    phone: text("phone"),
    source: text("source"),
    // new | contacted | qualified | unqualified | converted
    status: text("status").default("new"),
    score: integer("score").notNull().default(0),
    ownerUserId: text("owner_user_id"),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_lead_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_lead_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
