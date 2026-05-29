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

export const bosPosSession = pgTable(
  "bos_pos_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id"),
    cashierEmployeeId: uuid("cashier_employee_id"),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    openingFloatMinor: bigint("opening_float_minor", { mode: "number" }).default(0),
    status: text("status").default("open"),
    totals: jsonb("totals").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_pos_session_company_idx").on(table.companyId),
  }),
);
