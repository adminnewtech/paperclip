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

export const bosInvoice = pgTable(
  "bos_invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number"),
    customerId: uuid("customer_id"),
    customerName: text("customer_name"),
    issueDate: timestamp("issue_date", { withTimezone: true }).defaultNow(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    paidMinor: bigint("paid_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    status: text("status").default("draft"),
    lines: jsonb("lines").notNull().default([]),
    journalEntryId: uuid("journal_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_invoice_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_invoice_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
