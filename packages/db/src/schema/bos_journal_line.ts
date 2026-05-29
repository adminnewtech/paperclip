import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { bosJournalEntry } from "./bos_journal_entry.js";

export const bosJournalLine = pgTable(
  "bos_journal_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => bosJournalEntry.id, { onDelete: "cascade" }),
    accountCode: text("account_code").notNull(),
    debitMinor: bigint("debit_minor", { mode: "number" }).notNull().default(0),
    creditMinor: bigint("credit_minor", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_journal_line_company_idx").on(table.companyId),
    entryIdx: index("bos_journal_line_entry_idx").on(table.entryId),
  }),
);
