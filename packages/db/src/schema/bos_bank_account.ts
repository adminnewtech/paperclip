import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosBankAccount = pgTable(
  "bos_bank_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    accountNumber: text("account_number"),
    currency: text("currency").default("KWD"),
    balanceMinor: bigint("balance_minor", { mode: "number" }).notNull().default(0),
    ledgerAccountCode: text("ledger_account_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_bank_account_company_idx").on(table.companyId),
  }),
);
