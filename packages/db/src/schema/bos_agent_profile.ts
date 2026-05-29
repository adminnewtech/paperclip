import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosAgentProfile = pgTable(
  "bos_agent_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),
    jobDescription: text("job_description"),
    autonomy: text("autonomy").notNull().default("supervised"),
    supervisorEmployeeId: uuid("supervisor_employee_id"),
    kpis: jsonb("kpis").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_agent_profile_company_idx").on(table.companyId),
    agentIdx: index("bos_agent_profile_agent_idx").on(table.agentId),
  }),
);
