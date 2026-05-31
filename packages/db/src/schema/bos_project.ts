import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosProject = pgTable(
  "bos_project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").default("active"), // active|on_hold|completed|cancelled
    customerName: text("customer_name"),
    budgetMinor: bigint("budget_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    startDate: timestamp("start_date", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    ownerUserId: text("owner_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_project_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_project_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
