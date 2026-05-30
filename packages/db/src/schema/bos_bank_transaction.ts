import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosBankTransaction = pgTable(
  "bos_bank_transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id"),
    date: timestamp("date", { withTimezone: true }).defaultNow(),
    description: text("description"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull().default(0),
    reconciled: boolean("reconciled").notNull().default(false),
    matchedPaymentId: uuid("matched_payment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_bank_transaction_company_idx").on(table.companyId),
    bankAccountIdx: index("bos_bank_transaction_bank_account_idx").on(
      table.bankAccountId,
    ),
  }),
);
