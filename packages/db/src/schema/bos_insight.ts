import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosInsight = pgTable(
  "bos_insight",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // reorder | cashflow | deal_forecast | churn_risk | sla_breach | overdue_invoice
    kind: text("kind").notNull(),
    // info | warning | critical
    severity: text("severity").default("info"),
    title: text("title"),
    detail: text("detail"),
    data: jsonb("data").notNull().default({}),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_insight_company_idx").on(table.companyId),
    companyKindIdx: index("bos_insight_company_kind_idx").on(
      table.companyId,
      table.kind,
    ),
    companyResolvedIdx: index("bos_insight_company_resolved_idx").on(
      table.companyId,
      table.resolved,
    ),
  }),
);
