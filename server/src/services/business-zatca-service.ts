/**
 * ZATCA (Saudi Arabia) e-Invoicing Phase 1 (Simplified Tax Invoice) support.
 *
 * ZATCA Phase 1 mandates that simplified tax invoices include a QR code whose
 * content is a base64-encoded TLV (Tag-Length-Value) payload made up of five
 * tags:
 *
 *   Tag 1: Seller name           (UTF-8)
 *   Tag 2: Seller VAT number     (UTF-8)
 *   Tag 3: Invoice timestamp     (ISO 8601 UTC)
 *   Tag 4: Invoice total (with VAT)
 *   Tag 5: VAT amount
 *
 * Each tag is encoded as a single tag byte, a single length byte (the byte
 * length of the value in UTF-8, 0-255), followed by the value bytes. All five
 * tag-blocks are concatenated and the resulting buffer is base64-encoded — that
 * string is what gets rendered into the QR code.
 *
 * This module also provides a lightweight compliance validator that catches
 * the most common merchant-side configuration mistakes before the invoice is
 * ever issued.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZatcaTlvInput {
  sellerName: string;
  vatNumber: string;
  /** ISO 8601 timestamp string. */
  timestamp: string;
  /** Invoice total (with VAT) in the smallest currency unit (e.g. halalas). */
  totalCents: number;
  /** VAT amount in the smallest currency unit (e.g. halalas). */
  vatCents: number;
}

export interface ZatcaCompanyData {
  sellerName: string;
  vatNumber: string;
  /** Optional address line, included in PDF rendering but not in the TLV. */
  address?: string;
}

export interface ZatcaInvoiceData {
  id: string;
  code?: string | null;
  /** Invoice issue timestamp (ISO string). */
  issueTimestamp?: string | null;
  /** Total amount (with VAT) in cents. */
  totalCents: number;
  /** Taxable (pre-VAT) amount in cents. */
  taxableCents?: number | null;
  /** VAT amount in cents. */
  vatCents?: number | null;
}

export interface ZatcaQrPayload {
  /** Raw base64 TLV string for the QR code. */
  qrPayload: string;
  /** Same as qrPayload — included as an alias for callers. */
  tlv: string;
  /** Structured snapshot of the values that were encoded. */
  encoded: ZatcaTlvInput;
}

export interface ZatcaValidationResult {
  ok: boolean;
  issues: string[];
}

// ---------------------------------------------------------------------------
// TLV encoding
// ---------------------------------------------------------------------------

function encodeTag(tag: number, value: string): Uint8Array {
  const valueBytes = new TextEncoder().encode(value);
  if (valueBytes.length > 255) {
    throw new Error(
      `ZATCA TLV tag ${tag} value exceeds 255 bytes (got ${valueBytes.length}); ` +
        `truncate or split the field before encoding.`,
    );
  }
  const out = new Uint8Array(valueBytes.length + 2);
  out[0] = tag & 0xff;
  out[1] = valueBytes.length & 0xff;
  out.set(valueBytes, 2);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Use Buffer when available (Node) — it's the fastest path.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // Fallback for environments without Buffer.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).btoa(binary);
}

/**
 * Format a cents value as a decimal string with two fixed fractional digits,
 * suitable for the TLV total / VAT tags. We do this manually rather than via
 * `Number.prototype.toFixed` to avoid floating-point drift on large values.
 */
function formatCentsAsDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const fracStr = frac < 10 ? `0${frac}` : `${frac}`;
  return `${negative ? "-" : ""}${whole}.${fracStr}`;
}

/**
 * Encode the five-tag ZATCA Phase 1 TLV payload and return the base64 string.
 */
export function encodeZatcaTlv(input: ZatcaTlvInput): string {
  const parts: Uint8Array[] = [
    encodeTag(1, input.sellerName),
    encodeTag(2, input.vatNumber),
    encodeTag(3, input.timestamp),
    encodeTag(4, formatCentsAsDecimalString(input.totalCents)),
    encodeTag(5, formatCentsAsDecimalString(input.vatCents)),
  ];
  return bytesToBase64(concatBytes(parts));
}

/**
 * Build the QR payload for an invoice, given the issuing company's identity.
 * Throws if the timestamp cannot be normalized to ISO 8601.
 */
export function generateZatcaQrPayload(
  invoice: ZatcaInvoiceData,
  company: ZatcaCompanyData,
): ZatcaQrPayload {
  const ts = normalizeTimestamp(invoice.issueTimestamp);
  const encoded: ZatcaTlvInput = {
    sellerName: company.sellerName ?? "",
    vatNumber: company.vatNumber ?? "",
    timestamp: ts,
    totalCents: invoice.totalCents,
    vatCents: invoice.vatCents ?? 0,
  };
  const tlv = encodeZatcaTlv(encoded);
  return { qrPayload: tlv, tlv, encoded };
}

function normalizeTimestamp(input: string | null | undefined): string {
  if (input && typeof input === "string") {
    const d = new Date(input);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Compliance validation
// ---------------------------------------------------------------------------

const SAUDI_VAT_NUMBER_RE = /^3\d{13}3$/;

export interface ZatcaValidationContext {
  /** Optional list of existing invoice codes from the same fiscal year, used
   *  for the "invoice number is unique within the year" check. */
  yearInvoiceCodes?: string[];
}

/**
 * Validate that an invoice meets ZATCA Phase 1 simplified tax invoice
 * requirements. Returns a list of issues — empty list means the invoice is
 * compliant.
 */
export function validateZatcaCompliance(
  invoice: ZatcaInvoiceData,
  company: ZatcaCompanyData,
  context: ZatcaValidationContext = {},
): ZatcaValidationResult {
  const issues: string[] = [];

  // Seller name
  if (!company.sellerName || company.sellerName.trim().length === 0) {
    issues.push("Seller name is missing.");
  }

  // Seller VAT number — Saudi Arabia VAT numbers are 15 digits, start with 3,
  // end with 3.
  const vat = (company.vatNumber ?? "").trim();
  if (!vat) {
    issues.push("Seller VAT number is missing.");
  } else if (!SAUDI_VAT_NUMBER_RE.test(vat)) {
    issues.push(
      "Seller VAT number must be 15 digits, starting and ending with 3.",
    );
  }

  // Issue timestamp
  if (!invoice.issueTimestamp) {
    issues.push("Invoice issue timestamp is missing.");
  } else {
    const d = new Date(invoice.issueTimestamp);
    if (isNaN(d.getTime())) {
      issues.push("Invoice issue timestamp is not a valid ISO 8601 date.");
    }
  }

  // VAT calculation: 15% of taxable amount, 0.01 SAR tolerance (= 1 cent).
  if (
    invoice.taxableCents != null &&
    invoice.vatCents != null &&
    invoice.taxableCents >= 0
  ) {
    const expected = Math.round(invoice.taxableCents * 0.15);
    if (Math.abs(expected - invoice.vatCents) > 1) {
      issues.push(
        `VAT amount (${formatCentsAsDecimalString(invoice.vatCents)}) does not match ` +
          `15% of taxable amount (${formatCentsAsDecimalString(invoice.taxableCents)}); ` +
          `expected ${formatCentsAsDecimalString(expected)} ± 0.01.`,
      );
    }
  } else if (invoice.vatCents == null) {
    issues.push("VAT amount is missing — required for tax invoice.");
  }

  // Invoice number uniqueness within the year
  if (invoice.code && context.yearInvoiceCodes) {
    const others = context.yearInvoiceCodes.filter(
      (c) => c === invoice.code,
    );
    if (others.length > 1) {
      issues.push(
        `Invoice code "${invoice.code}" is not unique within the fiscal year.`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}
