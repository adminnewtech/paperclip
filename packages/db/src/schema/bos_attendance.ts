import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosAttendance = pgTable(
  "bos_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),
    date: timestamp("date", { withTimezone: true }),
    checkIn: timestamp("check_in", { withTimezone: true }),
    checkOut: timestamp("check_out", { withTimezone: true }),
    hours: integer("hours").notNull().default(0),
    status: text("status").default("present"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_attendance_company_idx").on(table.companyId),
    employeeIdx: index("bos_attendance_employee_idx").on(table.employeeId),
  }),
);
