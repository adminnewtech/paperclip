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

export const bosCampaign = pgTable(
  "bos_campaign",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: text("channel").default("email"), // email|sms|whatsapp|social
    status: text("status").default("draft"), // draft|scheduled|sending|sent|paused
    audienceId: uuid("audience_id"),
    templateId: uuid("template_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentCount: integer("sent_count").notNull().default(0),
    openCount: integer("open_count").notNull().default(0),
    clickCount: integer("click_count").notNull().default(0),
    budgetMinor: bigint("budget_minor", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_campaign_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_campaign_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
