import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosTimesheet = pgTable(
  "bos_timesheet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    taskId: uuid("task_id"),
    employeeId: uuid("employee_id"),
    date: timestamp("date", { withTimezone: true }),
    hours: integer("hours").notNull().default(0),
    billable: boolean("billable").notNull().default(true),
    rateMinor: bigint("rate_minor", { mode: "number" }).notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_timesheet_company_idx").on(table.companyId),
    projectIdx: index("bos_timesheet_project_idx").on(table.projectId),
  }),
);
