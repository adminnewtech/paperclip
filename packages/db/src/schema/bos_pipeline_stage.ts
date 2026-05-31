import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bosPipelineStage = pgTable(
  "bos_pipeline_stage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id").notNull(),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    winProbability: integer("win_probability").notNull().default(0),
    isWon: boolean("is_won").notNull().default(false),
    isLost: boolean("is_lost").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_pipeline_stage_company_idx").on(table.companyId),
    pipelineIdx: index("bos_pipeline_stage_pipeline_idx").on(table.pipelineId),
  }),
);
