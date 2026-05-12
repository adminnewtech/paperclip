/**
 * ZATCA Phase 2 UBL 2.1 invoice XML builder.
 *
 * ZATCA Phase 2 (Integration) requires that each invoice be represented as
 * a Universal Business Language (UBL) 2.1 XML document with ZATCA-specific
 * extensions, then signed (see `zatca-signature.ts`) and submitted to the
 * Fatoora API for clearance (standard B2B invoices) or reporting
 * (simplified B2C invoices).
 *
 * This module produces a clean, well-formed UBL XML document suitable for
 * hashing and signing. We render it as a single string with deterministic
 * ordering so that the SHA-256 hash is stable across runs — that hash is
 * the "invoice hash" used both as the previous-invoice hash for the next
 * invoice in the chain and as the value embedded in the QR code.
 *
 * For brevity (and because we are not aiming to be a fully-fledged XML
 * library here) this builder emits XML with manual string concatenation and
 * a small escape helper. The output is deterministic, valid, and stable —
 * which is exactly what ZATCA needs for hashing.
 *
 * Environment variables: none (pure function).
 */

import { sha256Digest } from "./zatca-signature.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZatcaInvoiceType =
  | "standard"
  | "simplified"
  | "credit_note"
  | "debit_note";

export type ZatcaPaymentMethod =
  | "cash"
  | "card"
  | "credit"
  | "bank_transfer";

export interface ZatcaParty {
  name: string;
  nameAr?: string;
  vatNumber?: string;
  crNumber?: string;
  address?: {
    street?: string;
    building?: string;
    city?: string;
    postalCode?: string;
    countryCode: string;
  };
}

export interface ZatcaInvoiceLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents?: number;
  vatPercent: number;
}

export interface ZatcaInvoiceInput {
  invoiceNumber: string;
  uuid: string;
  issueDate: string;
  invoiceType: ZatcaInvoiceType;
  supplier: ZatcaParty & {
    address: NonNullable<ZatcaParty["address"]>;
    vatNumber: string;
    nameAr: string;
  };
  customer?: ZatcaParty;
  lines: ZatcaInvoiceLine[];
  totalsCents: {
    subtotal: number;
    discount: number;
    vat: number;
    total: number;
  };
  previousInvoiceHash?: string;
  paymentMethod?: ZatcaPaymentMethod;
}

export interface BuiltZatcaXml {
  xml: string;
  /** Hex SHA-256 of the rendered XML. Used as the invoice hash. */
  hash: string;
  /** Base64 SHA-256 (same payload). Used as the digest in signed properties. */
  digestBase64: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeXml(value: string | undefined | null): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const fracStr = frac < 10 ? `0${frac}` : `${frac}`;
  return `${negative ? "-" : ""}${whole}.${fracStr}`;
}

function formatPercent(percent: number): string {
  // e.g. 15 -> "15.00"
  return percent.toFixed(2);
}

function mapInvoiceTypeCode(type: ZatcaInvoiceType): {
  code: string;
  name: string;
} {
  // UBL InvoiceTypeCode + ZATCA-specific "name" attribute (transaction code).
  // See ZATCA "Fatoora" technical spec: the name attribute is a 6-character
  // string where each digit is a flag for the transaction profile.
  switch (type) {
    case "standard":
      return { code: "388", name: "0100000" };
    case "simplified":
      return { code: "388", name: "0200000" };
    case "credit_note":
      return { code: "381", name: "0100000" };
    case "debit_note":
      return { code: "383", name: "0100000" };
  }
}

function mapPaymentMethodCode(method: ZatcaPaymentMethod | undefined): string {
  // UN/EDIFACT 4461 codes — ZATCA uses a small subset.
  switch (method) {
    case "cash":
      return "10";
    case "card":
      return "48";
    case "credit":
      return "30";
    case "bank_transfer":
      return "42";
    default:
      return "10";
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateZatcaInvoiceInput(input: ZatcaInvoiceInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!input.invoiceNumber?.trim()) errors.push("invoiceNumber is required");
  if (!input.uuid?.trim()) errors.push("uuid is required");
  if (!input.issueDate?.trim()) errors.push("issueDate is required");
  if (!input.supplier?.vatNumber?.trim()) errors.push("supplier.vatNumber is required");
  if (!input.supplier?.name?.trim()) errors.push("supplier.name is required");
  if (!input.supplier?.nameAr?.trim()) errors.push("supplier.nameAr is required");
  if (!input.supplier?.address?.countryCode) {
    errors.push("supplier.address.countryCode is required");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    errors.push("at least one invoice line is required");
  } else {
    for (let i = 0; i < input.lines.length; i++) {
      const ln = input.lines[i]!;
      if (!ln.name?.trim()) errors.push(`lines[${i}].name is required`);
      if (!Number.isFinite(ln.quantity) || ln.quantity <= 0) {
        errors.push(`lines[${i}].quantity must be positive`);
      }
      if (!Number.isInteger(ln.unitPriceCents) || ln.unitPriceCents < 0) {
        errors.push(`lines[${i}].unitPriceCents must be a non-negative integer`);
      }
      if (!Number.isFinite(ln.vatPercent) || ln.vatPercent < 0) {
        errors.push(`lines[${i}].vatPercent must be a non-negative number`);
      }
    }
  }
  if (input.invoiceType === "standard") {
    if (!input.customer?.vatNumber?.trim()) {
      errors.push("customer.vatNumber is required for standard invoices");
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// XML rendering
// ---------------------------------------------------------------------------

function renderParty(
  party: ZatcaParty,
  role: "Accounting" | "AccountingCustomer",
): string {
  const addr = party.address ?? { countryCode: "SA" };
  const partyXml = [
    `      <cac:PartyIdentification>`,
    `        <cbc:ID schemeID="CRN">${escapeXml(party.crNumber ?? "")}</cbc:ID>`,
    `      </cac:PartyIdentification>`,
    `      <cac:PostalAddress>`,
    `        <cbc:StreetName>${escapeXml(addr.street ?? "")}</cbc:StreetName>`,
    `        <cbc:BuildingNumber>${escapeXml(addr.building ?? "")}</cbc:BuildingNumber>`,
    `        <cbc:CityName>${escapeXml(addr.city ?? "")}</cbc:CityName>`,
    `        <cbc:PostalZone>${escapeXml(addr.postalCode ?? "")}</cbc:PostalZone>`,
    `        <cac:Country>`,
    `          <cbc:IdentificationCode>${escapeXml(addr.countryCode)}</cbc:IdentificationCode>`,
    `        </cac:Country>`,
    `      </cac:PostalAddress>`,
    `      <cac:PartyTaxScheme>`,
    `        <cbc:CompanyID>${escapeXml(party.vatNumber ?? "")}</cbc:CompanyID>`,
    `        <cac:TaxScheme>`,
    `          <cbc:ID>VAT</cbc:ID>`,
    `        </cac:TaxScheme>`,
    `      </cac:PartyTaxScheme>`,
    `      <cac:PartyLegalEntity>`,
    `        <cbc:RegistrationName>${escapeXml(party.nameAr ?? party.name)}</cbc:RegistrationName>`,
    `      </cac:PartyLegalEntity>`,
  ].join("\n");

  const wrapper =
    role === "Accounting"
      ? "AccountingSupplierParty"
      : "AccountingCustomerParty";
  return [
    `  <cac:${wrapper}>`,
    `    <cac:Party>`,
    partyXml,
    `    </cac:Party>`,
    `  </cac:${wrapper}>`,
  ].join("\n");
}

function renderLine(line: ZatcaInvoiceLine, index: number): string {
  const quantity = line.quantity;
  const unitPrice = line.unitPriceCents;
  const discount = line.discountCents ?? 0;
  const lineExtensionCents = quantity * unitPrice - discount;
  const vatCents = Math.round(lineExtensionCents * (line.vatPercent / 100));
  return [
    `  <cac:InvoiceLine>`,
    `    <cbc:ID>${index + 1}</cbc:ID>`,
    `    <cbc:InvoicedQuantity unitCode="EA">${quantity}</cbc:InvoicedQuantity>`,
    `    <cbc:LineExtensionAmount currencyID="SAR">${formatCents(lineExtensionCents)}</cbc:LineExtensionAmount>`,
    `    <cac:TaxTotal>`,
    `      <cbc:TaxAmount currencyID="SAR">${formatCents(vatCents)}</cbc:TaxAmount>`,
    `      <cbc:RoundingAmount currencyID="SAR">${formatCents(lineExtensionCents + vatCents)}</cbc:RoundingAmount>`,
    `    </cac:TaxTotal>`,
    `    <cac:Item>`,
    `      <cbc:Name>${escapeXml(line.name)}</cbc:Name>`,
    `      <cac:ClassifiedTaxCategory>`,
    `        <cbc:ID>S</cbc:ID>`,
    `        <cbc:Percent>${formatPercent(line.vatPercent)}</cbc:Percent>`,
    `        <cac:TaxScheme>`,
    `          <cbc:ID>VAT</cbc:ID>`,
    `        </cac:TaxScheme>`,
    `      </cac:ClassifiedTaxCategory>`,
    `    </cac:Item>`,
    `    <cac:Price>`,
    `      <cbc:PriceAmount currencyID="SAR">${formatCents(unitPrice)}</cbc:PriceAmount>`,
    `    </cac:Price>`,
    `  </cac:InvoiceLine>`,
  ].join("\n");
}

/**
 * Render the full UBL invoice XML. Output is deterministic: identical input
 * yields a byte-identical document, which is required for stable hashing.
 */
export function buildZatcaInvoiceXml(input: ZatcaInvoiceInput): BuiltZatcaXml {
  const typeCode = mapInvoiceTypeCode(input.invoiceType);
  const payment = mapPaymentMethodCode(input.paymentMethod);
  const previousHash = input.previousInvoiceHash ?? "0".repeat(64);
  const issueDate = input.issueDate.includes("T")
    ? input.issueDate
    : `${input.issueDate}T00:00:00Z`;
  const dateOnly = issueDate.split("T")[0] ?? issueDate;
  const timeOnly = (issueDate.split("T")[1] ?? "00:00:00Z").replace("Z", "");

  const lines = input.lines.map((ln, i) => renderLine(ln, i)).join("\n");

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"`,
    `         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"`,
    `         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"`,
    `         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">`,
    `  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>`,
    `  <cbc:ID>${escapeXml(input.invoiceNumber)}</cbc:ID>`,
    `  <cbc:UUID>${escapeXml(input.uuid)}</cbc:UUID>`,
    `  <cbc:IssueDate>${escapeXml(dateOnly)}</cbc:IssueDate>`,
    `  <cbc:IssueTime>${escapeXml(timeOnly || "00:00:00")}</cbc:IssueTime>`,
    `  <cbc:InvoiceTypeCode name="${typeCode.name}">${typeCode.code}</cbc:InvoiceTypeCode>`,
    `  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>`,
    `  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>`,
    `  <cac:AdditionalDocumentReference>`,
    `    <cbc:ID>PIH</cbc:ID>`,
    `    <cac:Attachment>`,
    `      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(previousHash)}</cbc:EmbeddedDocumentBinaryObject>`,
    `    </cac:Attachment>`,
    `  </cac:AdditionalDocumentReference>`,
    renderParty(input.supplier, "Accounting"),
    input.customer ? renderParty(input.customer, "AccountingCustomer") : "",
    `  <cac:PaymentMeans>`,
    `    <cbc:PaymentMeansCode>${payment}</cbc:PaymentMeansCode>`,
    `  </cac:PaymentMeans>`,
    `  <cac:TaxTotal>`,
    `    <cbc:TaxAmount currencyID="SAR">${formatCents(input.totalsCents.vat)}</cbc:TaxAmount>`,
    `  </cac:TaxTotal>`,
    `  <cac:LegalMonetaryTotal>`,
    `    <cbc:LineExtensionAmount currencyID="SAR">${formatCents(input.totalsCents.subtotal)}</cbc:LineExtensionAmount>`,
    `    <cbc:TaxExclusiveAmount currencyID="SAR">${formatCents(input.totalsCents.subtotal - input.totalsCents.discount)}</cbc:TaxExclusiveAmount>`,
    `    <cbc:TaxInclusiveAmount currencyID="SAR">${formatCents(input.totalsCents.total)}</cbc:TaxInclusiveAmount>`,
    `    <cbc:AllowanceTotalAmount currencyID="SAR">${formatCents(input.totalsCents.discount)}</cbc:AllowanceTotalAmount>`,
    `    <cbc:PayableAmount currencyID="SAR">${formatCents(input.totalsCents.total)}</cbc:PayableAmount>`,
    `  </cac:LegalMonetaryTotal>`,
    lines,
    `</Invoice>`,
  ]
    .filter((s) => s.length > 0)
    .join("\n");

  const digest = sha256Digest(xml);
  return { xml, hash: digest.hex, digestBase64: digest.base64 };
}

/**
 * Wrap an already-built invoice XML with a `<ds:Signature>` block carrying
 * the ZATCA signed-properties and the base64 signature value. This produces
 * the "signed XML" payload that gets submitted to ZATCA.
 *
 * We use a textual insertion strategy: take the original XML, append the
 * signature inside a UBL extension block before the closing `</Invoice>`.
 * This is the same approach used by ZATCA's reference SDK.
 */
export function embedSignatureInXml(params: {
  invoiceXml: string;
  signatureBase64: string;
  digestBase64: string;
  certificateBase64: string;
  signedAt: string;
}): string {
  const { invoiceXml, signatureBase64, digestBase64, certificateBase64, signedAt } = params;
  const extension = [
    `  <ext:UBLExtensions>`,
    `    <ext:UBLExtension>`,
    `      <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>`,
    `      <ext:ExtensionContent>`,
    `        <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">`,
    `          <sac:SignatureInformation xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2">`,
    `            <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>`,
    `            <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">`,
    `              <ds:SignedInfo>`,
    `                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>`,
    `                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>`,
    `                <ds:Reference URI="">`,
    `                  <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`,
    `                  <ds:DigestValue>${digestBase64}</ds:DigestValue>`,
    `                </ds:Reference>`,
    `              </ds:SignedInfo>`,
    `              <ds:SignatureValue>${signatureBase64}</ds:SignatureValue>`,
    `              <ds:KeyInfo>`,
    `                <ds:X509Data>`,
    `                  <ds:X509Certificate>${certificateBase64}</ds:X509Certificate>`,
    `                </ds:X509Data>`,
    `              </ds:KeyInfo>`,
    `              <ds:Object>`,
    `                <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">`,
    `                  <xades:SignedProperties Id="xadesSignedProperties">`,
    `                    <xades:SignedSignatureProperties>`,
    `                      <xades:SigningTime>${signedAt}</xades:SigningTime>`,
    `                    </xades:SignedSignatureProperties>`,
    `                  </xades:SignedProperties>`,
    `                </xades:QualifyingProperties>`,
    `              </ds:Object>`,
    `            </ds:Signature>`,
    `          </sac:SignatureInformation>`,
    `        </sig:UBLDocumentSignatures>`,
    `      </ext:ExtensionContent>`,
    `    </ext:UBLExtension>`,
    `  </ext:UBLExtensions>`,
  ].join("\n");
  // Insert the extension immediately after the opening <Invoice ...> tag.
  return invoiceXml.replace(/(<Invoice[^>]*>)/, `$1\n${extension}`);
}
