import {
  pgTable,
  uuid,
  text,
  bigint,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosPayslip = pgTable(
  "bos_payslip",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    payrollRunId: uuid("payroll_run_id"),
    employeeId: uuid("employee_id"),
    employeeName: text("employee_name"),
    grossMinor: bigint("gross_minor", { mode: "number" }).notNull().default(0),
    deductionsMinor: bigint("deductions_minor", { mode: "number" }).notNull().default(0),
    netMinor: bigint("net_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    components: jsonb("components").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_payslip_company_idx").on(table.companyId),
    payrollRunIdx: index("bos_payslip_run_idx").on(table.payrollRunId),
  }),
);
