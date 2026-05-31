import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosTicket = pgTable(
  "bos_ticket",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number"),
    subject: text("subject"),
    body: text("body"),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    channel: text("channel").default("email"),
    priority: text("priority").default("medium"),
    status: text("status").default("open"),
    slaPolicyId: uuid("sla_policy_id"),
    assigneeUserId: text("assignee_user_id"),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_ticket_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_ticket_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
