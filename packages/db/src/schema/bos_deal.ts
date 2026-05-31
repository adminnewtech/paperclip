import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosDeal = pgTable(
  "bos_deal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pipelineId: uuid("pipeline_id"),
    stageId: uuid("stage_id"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("KWD"),
    contactId: uuid("contact_id"),
    customerName: text("customer_name"),
    // open | won | lost
    status: text("status").default("open"),
    expectedClose: timestamp("expected_close", { withTimezone: true }),
    score: integer("score").notNull().default(0),
    ownerUserId: text("owner_user_id"),
    lostReason: text("lost_reason"),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_deal_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_deal_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    pipelineIdx: index("bos_deal_pipeline_idx").on(table.pipelineId),
    stageIdx: index("bos_deal_stage_idx").on(table.stageId),
  }),
);
