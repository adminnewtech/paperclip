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

export const bosVendorBill = pgTable(
  "bos_vendor_bill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    poId: uuid("po_id"),
    vendorId: uuid("vendor_id"),
    number: text("number"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    status: text("status").default("pending"),
    matched: boolean("matched").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_vendor_bill_company_idx").on(table.companyId),
    poIdx: index("bos_vendor_bill_po_idx").on(table.poId),
  }),
);
