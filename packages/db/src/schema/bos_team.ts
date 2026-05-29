import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { bosDepartment } from "./bos_department.js";

export const bosTeam = pgTable(
  "bos_team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => bosDepartment.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    leadUserId: text("lead_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_team_company_idx").on(table.companyId),
    departmentIdx: index("bos_team_department_idx").on(table.departmentId),
  }),
);
