import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosEmployee = pgTable(
  "bos_employee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    agentId: uuid("agent_id"),
    kind: text("kind").notNull().default("human"),
    departmentId: uuid("department_id"),
    title: text("title"),
    managerId: uuid("manager_id"),
    workingHours: jsonb("working_hours").notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_employee_company_idx").on(table.companyId),
    departmentIdx: index("bos_employee_department_idx").on(table.departmentId),
    agentIdx: index("bos_employee_agent_idx").on(table.agentId),
  }),
);
