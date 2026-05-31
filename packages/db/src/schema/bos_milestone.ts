import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosMilestone = pgTable(
  "bos_milestone",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    name: text("name").notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    completed: boolean("completed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_milestone_company_idx").on(table.companyId),
    projectIdx: index("bos_milestone_project_idx").on(table.projectId),
  }),
);
