import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosLeaveRequest = pgTable(
  "bos_leave_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),
    kind: text("kind"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    days: integer("days").notNull().default(1),
    status: text("status").default("pending"),
    reason: text("reason"),
    approverUserId: text("approver_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_leave_request_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_leave_request_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
