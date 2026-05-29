import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { bosAgentProfile } from "./bos_agent_profile.js";

export const bosAgentPolicy = pgTable(
  "bos_agent_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentProfileId: uuid("agent_profile_id")
      .notNull()
      .references(() => bosAgentProfile.id, { onDelete: "cascade" }),
    actionKey: text("action_key").notNull(),
    rule: text("rule").notNull().default("approve"),
    threshold: jsonb("threshold").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_agent_policy_company_idx").on(table.companyId),
    agentProfileIdx: index("bos_agent_policy_agent_profile_idx").on(
      table.agentProfileId,
    ),
    companyActionIdx: index("bos_agent_policy_company_action_idx").on(
      table.companyId,
      table.actionKey,
    ),
  }),
);
