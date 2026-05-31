import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosDiscount = pgTable(
  "bos_discount",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code"),
    name: text("name").notNull(),
    kind: text("kind"),
    valueBps: integer("value_bps").notNull().default(0),
    valueMinor: bigint("value_minor", { mode: "number" }).notNull().default(0),
    minOrderMinor: bigint("min_order_minor", { mode: "number" }).notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").notNull().default(0),
    status: text("status").default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_discount_company_idx").on(table.companyId),
    companyCodeIdx: index("bos_discount_company_code_idx").on(
      table.companyId,
      table.code,
    ),
  }),
);
