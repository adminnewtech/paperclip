import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosSlaPolicy = pgTable(
  "bos_sla_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name"),
    firstResponseMins: integer("first_response_mins").notNull().default(60),
    resolutionMins: integer("resolution_mins").notNull().default(1440),
    priority: text("priority").default("medium"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_sla_policy_company_idx").on(table.companyId),
  }),
);
