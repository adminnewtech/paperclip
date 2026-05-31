import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosPayrollRun = pgTable(
  "bos_payroll_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    period: text("period"),
    status: text("status").default("draft"),
    grossMinor: bigint("gross_minor", { mode: "number" }).notNull().default(0),
    deductionsMinor: bigint("deductions_minor", { mode: "number" }).notNull().default(0),
    netMinor: bigint("net_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_payroll_run_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_payroll_run_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
