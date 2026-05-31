import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosTask = pgTable(
  "bos_task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    title: text("title"),
    description: text("description"),
    status: text("status").default("todo"), // todo|in_progress|done|blocked
    priority: text("priority").default("medium"),
    assigneeUserId: text("assignee_user_id"),
    dependsOnId: uuid("depends_on_id"),
    estimateHours: integer("estimate_hours").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_task_company_idx").on(table.companyId),
    projectIdx: index("bos_task_project_idx").on(table.projectId),
    companyStatusIdx: index("bos_task_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
