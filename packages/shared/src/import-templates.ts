/**
 * Import templates: field-mapping presets for migrating CSV/Excel exports from
 * common third-party systems (QuickBooks, Zoho Books, Wave, etc.) into the
 * Paperclip business-entities model.
 *
 * Each template is a list of `ImportFieldMapping` rows describing how a
 * source column maps to a target entity field plus an optional transform
 * (parse currency, normalize phone, split tags, etc.).
 *
 * The template registry is keyed by `${source}_${targetType}`. Not every
 * combination has a meaningful default — for those we fall back to the
 * generic CSV template at lookup time.
 *
 * Auto-detection: `detectTemplate` examines a list of CSV column headers
 * (case-insensitively) and tries to pick the best-matching source. This is
 * used by the import wizard when the user hasn't manually selected a source.
 */

export type ImportSource =
  | "quickbooks"
  | "zoho"
  | "wave"
  | "csv_generic"
  | "excel_generic";

export type ImportTargetType =
  | "contact"
  | "lead"
  | "deal"
  | "invoice"
  | "expense"
  | "product"
  | "employee"
  | "ticket"
  | "campaign";

export type ImportTransform =
  | "number"
  | "currency_cents"
  | "date_iso"
  | "trim"
  | "lowercase"
  | "uppercase"
  | "phone_e164"
  | "tag_split";

export interface ImportFieldMapping {
  sourceColumn: string;
  targetField: string;
  transform?: ImportTransform;
  defaultValue?: unknown;
}

export const IMPORT_SOURCES: readonly ImportSource[] = [
  "quickbooks",
  "zoho",
  "wave",
  "csv_generic",
  "excel_generic",
] as const;

export const IMPORT_TARGET_TYPES: readonly ImportTargetType[] = [
  "contact",
  "lead",
  "deal",
  "invoice",
  "expense",
  "product",
  "employee",
  "ticket",
  "campaign",
] as const;

export function isImportSource(value: unknown): value is ImportSource {
  return typeof value === "string" && (IMPORT_SOURCES as readonly string[]).includes(value);
}

export function isImportTargetType(value: unknown): value is ImportTargetType {
  return typeof value === "string" && (IMPORT_TARGET_TYPES as readonly string[]).includes(value);
}

/**
 * Maps `(source, targetType)` to a default mapping. We deliberately use
 * lowercase target field names like `name`, `code`, `status`, `amountCents`,
 * `currency`, `ownerUserId`, and `data.<key>` for JSONB-stored fields.
 */
export const IMPORT_TEMPLATES: Record<string, ImportFieldMapping[]> = {
  // -------------------- QuickBooks --------------------
  quickbooks_contact: [
    { sourceColumn: "Customer", targetField: "name", transform: "trim" },
    { sourceColumn: "Company", targetField: "data.company", transform: "trim" },
    { sourceColumn: "Email", targetField: "data.email", transform: "lowercase" },
    { sourceColumn: "Phone", targetField: "data.phone", transform: "phone_e164" },
    { sourceColumn: "Billing Address", targetField: "data.address", transform: "trim" },
    { sourceColumn: "Status", targetField: "status", transform: "lowercase" },
  ],
  quickbooks_invoice: [
    { sourceColumn: "Customer", targetField: "name", transform: "trim" },
    { sourceColumn: "Invoice No", targetField: "code", transform: "trim" },
    { sourceColumn: "Invoice Date", targetField: "data.issueTimestamp", transform: "date_iso" },
    { sourceColumn: "Due Date", targetField: "data.dueDate", transform: "date_iso" },
    { sourceColumn: "Total", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "Balance", targetField: "data.balanceCents", transform: "currency_cents" },
    { sourceColumn: "Status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "Currency", targetField: "currency", transform: "uppercase" },
    { sourceColumn: "Memo", targetField: "data.notes", transform: "trim" },
  ],
  quickbooks_expense: [
    { sourceColumn: "Vendor", targetField: "data.vendor", transform: "trim" },
    { sourceColumn: "Account", targetField: "data.category", transform: "trim" },
    { sourceColumn: "Memo", targetField: "name", transform: "trim" },
    { sourceColumn: "Amount", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "Date", targetField: "data.date", transform: "date_iso" },
    { sourceColumn: "Currency", targetField: "currency", transform: "uppercase" },
  ],
  quickbooks_product: [
    { sourceColumn: "Item Name", targetField: "name", transform: "trim" },
    { sourceColumn: "SKU", targetField: "code", transform: "trim" },
    { sourceColumn: "Sales Price", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "Description", targetField: "data.description", transform: "trim" },
    { sourceColumn: "Quantity On Hand", targetField: "data.stock", transform: "number" },
    { sourceColumn: "Income Account", targetField: "data.category", transform: "trim" },
  ],

  // -------------------- Zoho --------------------
  zoho_contact: [
    { sourceColumn: "Contact Name", targetField: "name", transform: "trim" },
    { sourceColumn: "Company Name", targetField: "data.company", transform: "trim" },
    { sourceColumn: "Email", targetField: "data.email", transform: "lowercase" },
    { sourceColumn: "Phone", targetField: "data.phone", transform: "phone_e164" },
    { sourceColumn: "Mobile", targetField: "data.mobile", transform: "phone_e164" },
    { sourceColumn: "Billing Street", targetField: "data.address", transform: "trim" },
    { sourceColumn: "Tags", targetField: "tags", transform: "tag_split" },
  ],
  zoho_lead: [
    { sourceColumn: "Lead Name", targetField: "name", transform: "trim" },
    { sourceColumn: "Company", targetField: "data.company", transform: "trim" },
    { sourceColumn: "Email", targetField: "data.email", transform: "lowercase" },
    { sourceColumn: "Phone", targetField: "data.phone", transform: "phone_e164" },
    { sourceColumn: "Lead Source", targetField: "data.source", transform: "trim" },
    { sourceColumn: "Lead Status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "Industry", targetField: "data.industry", transform: "trim" },
  ],
  zoho_deal: [
    { sourceColumn: "Deal Name", targetField: "name", transform: "trim" },
    { sourceColumn: "Amount", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "Stage", targetField: "status", transform: "lowercase" },
    { sourceColumn: "Closing Date", targetField: "data.closeDate", transform: "date_iso" },
    { sourceColumn: "Account Name", targetField: "data.accountName", transform: "trim" },
    { sourceColumn: "Probability (%)", targetField: "data.probability", transform: "number" },
  ],
  zoho_invoice: [
    { sourceColumn: "Customer Name", targetField: "name", transform: "trim" },
    { sourceColumn: "Invoice Number", targetField: "code", transform: "trim" },
    { sourceColumn: "Invoice Date", targetField: "data.issueTimestamp", transform: "date_iso" },
    { sourceColumn: "Due Date", targetField: "data.dueDate", transform: "date_iso" },
    { sourceColumn: "Total", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "Status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "Currency Code", targetField: "currency", transform: "uppercase" },
  ],
  zoho_expense: [
    { sourceColumn: "Vendor Name", targetField: "data.vendor", transform: "trim" },
    { sourceColumn: "Expense Account", targetField: "data.category", transform: "trim" },
    { sourceColumn: "Description", targetField: "name", transform: "trim" },
    { sourceColumn: "Total", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "Date", targetField: "data.date", transform: "date_iso" },
    { sourceColumn: "Currency Code", targetField: "currency", transform: "uppercase" },
  ],
  zoho_product: [
    { sourceColumn: "Item Name", targetField: "name", transform: "trim" },
    { sourceColumn: "SKU", targetField: "code", transform: "trim" },
    { sourceColumn: "Rate", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "Description", targetField: "data.description", transform: "trim" },
    { sourceColumn: "Stock On Hand", targetField: "data.stock", transform: "number" },
  ],
  zoho_ticket: [
    { sourceColumn: "Subject", targetField: "name", transform: "trim" },
    { sourceColumn: "Ticket Id", targetField: "code", transform: "trim" },
    { sourceColumn: "Status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "Priority", targetField: "data.priority", transform: "lowercase" },
    { sourceColumn: "Contact Name", targetField: "data.contactName", transform: "trim" },
    { sourceColumn: "Description", targetField: "data.description", transform: "trim" },
  ],
  zoho_campaign: [
    { sourceColumn: "Campaign Name", targetField: "name", transform: "trim" },
    { sourceColumn: "Type", targetField: "data.channel", transform: "lowercase" },
    { sourceColumn: "Status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "Start Date", targetField: "data.startDate", transform: "date_iso" },
    { sourceColumn: "End Date", targetField: "data.endDate", transform: "date_iso" },
    { sourceColumn: "Budget Cost", targetField: "amountCents", transform: "currency_cents" },
  ],

  // -------------------- Wave --------------------
  wave_contact: [
    { sourceColumn: "Customer Name", targetField: "name", transform: "trim" },
    { sourceColumn: "Email", targetField: "data.email", transform: "lowercase" },
    { sourceColumn: "Phone", targetField: "data.phone", transform: "phone_e164" },
    { sourceColumn: "Address", targetField: "data.address", transform: "trim" },
  ],
  wave_invoice: [
    { sourceColumn: "Customer", targetField: "name", transform: "trim" },
    { sourceColumn: "Invoice Number", targetField: "code", transform: "trim" },
    { sourceColumn: "Invoice Date", targetField: "data.issueTimestamp", transform: "date_iso" },
    { sourceColumn: "Amount", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "Status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "Currency", targetField: "currency", transform: "uppercase" },
  ],
  wave_expense: [
    { sourceColumn: "Vendor", targetField: "data.vendor", transform: "trim" },
    { sourceColumn: "Category", targetField: "data.category", transform: "trim" },
    { sourceColumn: "Description", targetField: "name", transform: "trim" },
    { sourceColumn: "Amount", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "Date", targetField: "data.date", transform: "date_iso" },
  ],

  // -------------------- Generic CSV / Excel (best-effort) --------------------
  csv_generic_contact: [
    { sourceColumn: "name", targetField: "name", transform: "trim" },
    { sourceColumn: "email", targetField: "data.email", transform: "lowercase" },
    { sourceColumn: "phone", targetField: "data.phone", transform: "phone_e164" },
    { sourceColumn: "company", targetField: "data.company", transform: "trim" },
    { sourceColumn: "address", targetField: "data.address", transform: "trim" },
    { sourceColumn: "tags", targetField: "tags", transform: "tag_split" },
  ],
  csv_generic_lead: [
    { sourceColumn: "name", targetField: "name", transform: "trim" },
    { sourceColumn: "email", targetField: "data.email", transform: "lowercase" },
    { sourceColumn: "phone", targetField: "data.phone", transform: "phone_e164" },
    { sourceColumn: "company", targetField: "data.company", transform: "trim" },
    { sourceColumn: "source", targetField: "data.source", transform: "trim" },
    { sourceColumn: "status", targetField: "status", transform: "lowercase" },
  ],
  csv_generic_deal: [
    { sourceColumn: "name", targetField: "name", transform: "trim" },
    { sourceColumn: "amount", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "close_date", targetField: "data.closeDate", transform: "date_iso" },
  ],
  csv_generic_invoice: [
    { sourceColumn: "code", targetField: "code", transform: "trim" },
    { sourceColumn: "customer", targetField: "name", transform: "trim" },
    { sourceColumn: "amount", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "currency", targetField: "currency", transform: "uppercase" },
    { sourceColumn: "status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "date", targetField: "data.issueTimestamp", transform: "date_iso" },
  ],
  csv_generic_expense: [
    { sourceColumn: "description", targetField: "name", transform: "trim" },
    { sourceColumn: "vendor", targetField: "data.vendor", transform: "trim" },
    { sourceColumn: "category", targetField: "data.category", transform: "trim" },
    { sourceColumn: "amount", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "date", targetField: "data.date", transform: "date_iso" },
  ],
  csv_generic_product: [
    { sourceColumn: "sku", targetField: "code", transform: "trim" },
    { sourceColumn: "name", targetField: "name", transform: "trim" },
    { sourceColumn: "price", targetField: "amountCents", transform: "currency_cents" },
    { sourceColumn: "stock", targetField: "data.stock", transform: "number" },
    { sourceColumn: "category", targetField: "data.category", transform: "trim" },
  ],
  csv_generic_employee: [
    { sourceColumn: "name", targetField: "name", transform: "trim" },
    { sourceColumn: "email", targetField: "data.email", transform: "lowercase" },
    { sourceColumn: "phone", targetField: "data.phone", transform: "phone_e164" },
    { sourceColumn: "title", targetField: "data.title", transform: "trim" },
    { sourceColumn: "department", targetField: "data.department", transform: "trim" },
    { sourceColumn: "salary", targetField: "amountCents", transform: "currency_cents" },
  ],
  csv_generic_ticket: [
    { sourceColumn: "subject", targetField: "name", transform: "trim" },
    { sourceColumn: "status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "priority", targetField: "data.priority", transform: "lowercase" },
    { sourceColumn: "description", targetField: "data.description", transform: "trim" },
  ],
  csv_generic_campaign: [
    { sourceColumn: "name", targetField: "name", transform: "trim" },
    { sourceColumn: "channel", targetField: "data.channel", transform: "lowercase" },
    { sourceColumn: "status", targetField: "status", transform: "lowercase" },
    { sourceColumn: "budget", targetField: "amountCents", transform: "currency_cents" },
  ],
};

// Excel-generic shares the csv-generic mappings.
for (const targetType of IMPORT_TARGET_TYPES) {
  const csvKey = `csv_generic_${targetType}`;
  const xlKey = `excel_generic_${targetType}`;
  const csv = IMPORT_TEMPLATES[csvKey];
  if (csv && !IMPORT_TEMPLATES[xlKey]) {
    IMPORT_TEMPLATES[xlKey] = csv.map((m) => ({ ...m }));
  }
}

/**
 * Lookup a default mapping. Falls back to the generic CSV template when no
 * source-specific template exists for the given target type.
 */
export function getImportTemplate(
  source: ImportSource,
  targetType: ImportTargetType,
): ImportFieldMapping[] {
  const key = `${source}_${targetType}`;
  const template = IMPORT_TEMPLATES[key];
  if (template) return template.map((m) => ({ ...m }));
  const fallback = IMPORT_TEMPLATES[`csv_generic_${targetType}`];
  return fallback ? fallback.map((m) => ({ ...m })) : [];
}

/**
 * Normalize a column header for fuzzy comparison: lowercase, strip non-word
 * characters, collapse whitespace.
 */
function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Given a list of CSV column headers and a target type, score each known
 * source and return the best match. Returns null when no template covers
 * enough of the supplied headers.
 */
export function detectTemplate(
  headers: readonly string[],
  targetType: ImportTargetType,
): { source: ImportSource; matched: number } | null {
  const normalized = new Set(headers.map(normalizeHeader));
  let best: { source: ImportSource; matched: number } | null = null;
  for (const source of IMPORT_SOURCES) {
    const tpl = IMPORT_TEMPLATES[`${source}_${targetType}`];
    if (!tpl) continue;
    let matched = 0;
    for (const m of tpl) {
      if (normalized.has(normalizeHeader(m.sourceColumn))) matched += 1;
    }
    if (best == null || matched > best.matched) {
      best = { source, matched };
    }
  }
  return best && best.matched > 0 ? best : null;
}

/**
 * Build an auto-mapping for the supplied headers by walking every known
 * template and matching column-by-column (case/space insensitive). The
 * result preserves the order of `headers` so the wizard can render a
 * stable side-by-side view. Unmapped columns are omitted (the user can
 * map them manually in the wizard).
 */
export function suggestMapping(
  headers: readonly string[],
  source: ImportSource,
  targetType: ImportTargetType,
): ImportFieldMapping[] {
  const tpl = getImportTemplate(source, targetType);
  // Build a lookup of normalized template column -> mapping
  const lookup = new Map<string, ImportFieldMapping>();
  for (const m of tpl) {
    lookup.set(normalizeHeader(m.sourceColumn), m);
  }
  const out: ImportFieldMapping[] = [];
  for (const header of headers) {
    const hit = lookup.get(normalizeHeader(header));
    if (hit) {
      // Preserve the user's actual header text in sourceColumn so it lines
      // up with the parsed row keys.
      out.push({ ...hit, sourceColumn: header });
    }
  }
  return out;
}
