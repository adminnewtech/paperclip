import { pgTable, uuid, text, timestamp, bigint, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { businessEntities } from "./business_entities.js";

/**
 * Files attached to a business entity (invoice, deal, contact, etc.).
 *
 * Files are stored on local disk under a directory rooted at
 * `/data/business-attachments/<companyId>/<entityId>/<uuid>-<filename>`.
 * The `storage_path` column records the absolute path on disk so the
 * download endpoint can stream the file back.
 */
export const businessAttachments = pgTable(
  "business_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => businessEntities.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storagePath: text("storage_path").notNull(),
    uploadedByUserId: text("uploaded_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entityIdx: index("business_attachments_entity_idx").on(table.entityId),
    companyIdx: index("business_attachments_company_idx").on(
      table.companyId,
      table.createdAt,
    ),
  }),
);
