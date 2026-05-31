// ---------------------------------------------------------------------------
// ZATCA (Saudi e-invoicing, Phase 2) adapter — STUBBED, offline-safe.
//
// This module models the ZATCA clearance/reporting flow deterministically with
// NO network calls and NO real cryptography. Production ZATCA requires a CSID
// (Cryptographic Stamp Identifier) issued by the Fatoora portal and ECDSA
// signing of the invoice XML — that lives behind a real TaxAuthorityAdapter
// implementation that conforms to the same interface. The stub here generates a
// deterministic UUID, a simple invoice hash, a base64 TLV QR payload, and chains
// the previous-invoice-hash (PIH) so the rest of the system can be built and
// tested without secrets or connectivity.
//
// Determinism: NO Math.random / Date.now. Callers pass a `nowIso` timestamp and
// the invoice number + seq seed the UUID/hash.
// ---------------------------------------------------------------------------

export interface EInvoiceInput {
  /** Human invoice number (e.g. "INV-1001"). */
  number: string | null;
  /** Sequence position in the company's invoice chain (0-based). */
  seq: number;
  /** Total (gross) amount in minor units. */
  totalMinor: number;
  /** VAT amount in minor units. */
  vatMinor: number;
  /** ISO currency code (e.g. "SAR"). */
  currency: string;
  /** Seller legal name. */
  sellerName?: string | null;
  /** Seller VAT registration number. */
  vatNumber?: string | null;
  /** "standard_b2b" | "simplified_b2c". Defaults to standard. */
  kind?: string | null;
}

export interface TaxAuthorityResult {
  status: "cleared" | "reported" | "rejected";
  uuid: string;
  hash: string;
  qr: string;
}

/**
 * The contract a real ZATCA (or any tax authority) integration must satisfy.
 * `clearInvoice` is the synchronous B2B clearance path; `reportInvoice` is the
 * B2C reporting path. The stub below implements both deterministically.
 */
export interface TaxAuthorityAdapter {
  clearInvoice(inv: EInvoiceInput, ctx: AdapterContext): TaxAuthorityResult;
  reportInvoice(inv: EInvoiceInput, ctx: AdapterContext): TaxAuthorityResult;
}

export interface AdapterContext {
  /** Previous invoice hash (PIH chain). Null/empty for the first invoice. */
  previousHash: string | null;
  /** Deterministic timestamp (ISO 8601) used in the QR payload. */
  nowIso: string;
  /** sandbox | live — the stub only ever operates in sandbox. */
  mode?: string;
}

// ---------------------------------------------------------------------------
// Deterministic primitives (pure).
// ---------------------------------------------------------------------------

/** Simple deterministic hex hash of a string (FNV-1a 32-bit, repeated for length). */
export function simpleHash(input: string): string {
  // FNV-1a, two passes with different offsets to widen the digest to 16 hex chars.
  const fnv = (seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  const a = fnv(0x811c9dc5);
  const b = fnv(0xcbf29ce4);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * Build a deterministic UUID (v4-shaped) from the invoice number + seq. Not a
 * real random UUID — stable for a given (number, seq) so tests are repeatable.
 */
export function deterministicUuid(number: string | null, seq: number): string {
  const seed = `${number ?? "INV"}:${seq}`;
  // Expand the 16-hex digest to 32 hex chars by hashing two halves.
  const h1 = simpleHash(seed);
  const h2 = simpleHash(`${seed}:tail`);
  const hex = (h1 + h2).slice(0, 32).padEnd(32, "0");
  const variant = ((parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`, // version 4
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/** Base64-encode a UTF-8 string (Node Buffer; deterministic). */
function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/**
 * Build the ZATCA QR payload. Real ZATCA uses a binary TLV (tag-length-value)
 * structure for tags 1-5 (seller name, VAT number, timestamp, total, VAT). We
 * encode the same five fields into a TLV-shaped byte string and base64 it so the
 * shape matches without requiring the production encoder.
 */
export function buildQrCode(inv: EInvoiceInput, nowIso: string): string {
  const fields: Array<[number, string]> = [
    [1, inv.sellerName ?? ""],
    [2, inv.vatNumber ?? ""],
    [3, nowIso],
    [4, String(inv.totalMinor)],
    [5, String(inv.vatMinor)],
  ];
  let tlv = "";
  for (const [tag, value] of fields) {
    const bytes = Buffer.from(value, "utf8");
    tlv += String.fromCharCode(tag) + String.fromCharCode(bytes.length) + value;
  }
  return base64(tlv);
}

/** Canonical string of the invoice fields fed into the invoice hash. */
function canonical(inv: EInvoiceInput, previousHash: string | null): string {
  return [
    inv.number ?? "",
    String(inv.seq),
    String(inv.totalMinor),
    String(inv.vatMinor),
    inv.currency,
    previousHash ?? "0",
  ].join("|");
}

/** True when the invoice is a B2B (standard) invoice → ZATCA clearance path. */
export function isB2B(inv: EInvoiceInput): boolean {
  const kind = (inv.kind ?? "standard").toLowerCase();
  return kind === "standard" || kind === "standard_b2b";
}

/** True when the invoice is a B2C (simplified) invoice → ZATCA reporting path. */
export function isB2C(inv: EInvoiceInput): boolean {
  return !isB2B(inv);
}

// ---------------------------------------------------------------------------
// Stub adapter implementation (deterministic, offline).
// ---------------------------------------------------------------------------

function buildResult(
  inv: EInvoiceInput,
  ctx: AdapterContext,
  status: "cleared" | "reported",
): TaxAuthorityResult {
  const uuid = deterministicUuid(inv.number, inv.seq);
  const hash = simpleHash(canonical(inv, ctx.previousHash));
  const qr = buildQrCode(inv, ctx.nowIso);
  return { status, uuid, hash, qr };
}

export const zatcaAdapter: TaxAuthorityAdapter = {
  clearInvoice(inv, ctx) {
    // PRODUCTION NOTE: real B2B clearance posts the signed XML to ZATCA and
    // returns a cleared status + cryptographic stamp. Stubbed here.
    return buildResult(inv, ctx, "cleared");
  },
  reportInvoice(inv, ctx) {
    // PRODUCTION NOTE: real B2C reporting submits the signed XML asynchronously.
    return buildResult(inv, ctx, "reported");
  },
};

export interface GenerateEInvoiceParams {
  previousHash: string | null;
  seq: number;
  mode?: string;
  /** Deterministic timestamp; defaults to the epoch when not supplied. */
  nowIso?: string;
}

export interface EInvoicePayload {
  uuid: string;
  hash: string;
  previousHash: string | null;
  qr: string;
  status: "cleared" | "reported" | "rejected";
  kind: string;
  signedXml: string;
}

/**
 * Pure, deterministic e-invoice generation. B2B (standard) invoices take the
 * clearance path and become "cleared"; B2C (simplified) invoices take the
 * reporting path and become "reported". The returned hash becomes the next
 * invoice's previousHash (PIH chaining). No network, no randomness.
 */
export function generateEInvoice(
  invoice: EInvoiceInput,
  params: GenerateEInvoiceParams,
): EInvoicePayload {
  const ctx: AdapterContext = {
    previousHash: params.previousHash ?? null,
    nowIso: params.nowIso ?? new Date(0).toISOString(),
    mode: params.mode ?? "sandbox",
  };

  const b2b = isB2B(invoice);
  const result = b2b
    ? zatcaAdapter.clearInvoice(invoice, ctx)
    : zatcaAdapter.reportInvoice(invoice, ctx);

  // STUB: signed XML is a deterministic placeholder envelope. Production signs
  // the UBL 2.1 invoice XML with the CSID private key.
  const signedXml = `<Invoice uuid="${result.uuid}" pih="${ctx.previousHash ?? ""}" hash="${result.hash}"/>`;

  return {
    uuid: result.uuid,
    hash: result.hash,
    previousHash: ctx.previousHash,
    qr: result.qr,
    status: result.status,
    kind: b2b ? "standard_b2b" : "simplified_b2c",
    signedXml,
  };
}
