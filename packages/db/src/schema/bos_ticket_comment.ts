import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosTicketComment = pgTable(
  "bos_ticket_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull(),
    author: text("author"),
    body: text("body"),
    internal: boolean("internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_ticket_comment_company_idx").on(table.companyId),
    ticketIdx: index("bos_ticket_comment_ticket_idx").on(table.ticketId),
  }),
);
