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

/**
 * E-invoice records (ZATCA-style). One row per cleared/reported invoice with a
 * deterministic UUID, an invoice hash and the previous-invoice-hash (PIH) chain,
 * the base64 TLV QR payload, and the signed XML envelope. ZATCA crypto is
 * stubbed (offline-safe) — a real adapter populates the same columns.
 */
export const bosEinvoice = pgTable(
  "bos_einvoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id"),
    uuidValue: text("uuid_value"), // the e-invoice UUID
    invoiceHash: text("invoice_hash"), // PIH base for this invoice
    previousHash: text("previous_hash"), // PIH chain link
    qrCode: text("qr_code"), // base64 TLV
    signedXml: text("signed_xml"),
    invoiceKind: text("invoice_kind").default("standard"), // standard_b2b | simplified_b2c
    zatcaStatus: text("zatca_status").default("draft"), // draft | cleared | reported | rejected
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    errorCode: text("error_code"),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    vatMinor: bigint("vat_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").default("SAR"),
    seq: integer("seq").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bos_einvoice_company_idx").on(table.companyId),
    companyStatusIdx: index("bos_einvoice_company_status_idx").on(
      table.companyId,
      table.zatcaStatus,
    ),
    companySeqIdx: index("bos_einvoice_company_seq_idx").on(
      table.companyId,
      table.seq,
    ),
  }),
);
