import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosActivity = pgTable(
  "bos_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // call | email | meeting | note | task
    kind: text("kind"),
    subject: text("subject"),
    body: text("body"),
    // lead | deal | contact
    relatedType: text("related_type"),
    relatedId: uuid("related_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    done: boolean("done").notNull().default(false),
    ownerUserId: text("owner_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_activity_company_idx").on(table.companyId),
    relatedIdx: index("bos_activity_related_idx").on(
      table.relatedType,
      table.relatedId,
    ),
  }),
);
