import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosFinPayment = pgTable(
  "bos_fin_payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    invoiceId: uuid("invoice_id"),
    billId: uuid("bill_id"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    method: text("method"),
    paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow(),
    journalEntryId: uuid("journal_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_fin_payment_company_idx").on(table.companyId),
    invoiceIdx: index("bos_fin_payment_invoice_idx").on(table.invoiceId),
    billIdx: index("bos_fin_payment_bill_idx").on(table.billId),
  }),
);
