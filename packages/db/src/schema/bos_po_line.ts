import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosPoLine = pgTable(
  "bos_po_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    poId: uuid("po_id").notNull(),
    variantId: uuid("variant_id"),
    description: text("description"),
    qty: integer("qty").notNull().default(0),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull().default(0),
    receivedQty: integer("received_qty").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_po_line_company_idx").on(table.companyId),
    poIdx: index("bos_po_line_po_idx").on(table.poId),
  }),
);
