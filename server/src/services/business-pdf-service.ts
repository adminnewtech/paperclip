/**
 * HTML invoice rendering for "print-to-PDF" delivery.
 *
 * The server doesn't carry a headless browser or PDF library, so we render a
 * fully self-contained, print-ready HTML document and rely on the user agent's
 * native "Save as PDF" / "Print" pipeline. The document is structured so that
 * the printed output and the on-screen preview look identical.
 *
 * Output is always:
 *   - bilingual (English / Arabic) where the invoice data provides Arabic
 *     fields under `data.nameAr`, `data.descriptionAr`, etc;
 *   - ZATCA-aware: includes a QR-payload block (either an inline PNG when a
 *     `qrcode` library is available, or a base64 string placeholder otherwise);
 *   - A4 sized with sensible margins;
 *   - free of remote resources (everything is inlined).
 */

import { generateZatcaQrPayload, type ZatcaCompanyData, type ZatcaInvoiceData } from "./business-zatca-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceLineItem {
  description: string;
  descriptionAr?: string | null;
  quantity: number;
  unitPriceCents: number;
  taxPercent: number;
  totalCents: number;
}

export interface InvoiceRenderData {
  /** Unique invoice identifier (used for the HTML `<title>`). */
  id: string;
  /** Human-readable invoice code (e.g. INV-2026-001). */
  code: string | null;
  /** ISO timestamp string. */
  issueTimestamp: string;
  /** Customer name (English). */
  customerName?: string | null;
  /** Customer name (Arabic). */
  customerNameAr?: string | null;
  /** Customer address (free-form). */
  customerAddress?: string | null;
  /** Line items. If empty, a single placeholder row is rendered. */
  items: InvoiceLineItem[];
  /** Pre-tax subtotal (cents). */
  subtotalCents: number;
  /** VAT amount (cents). */
  vatCents: number;
  /** Grand total including VAT (cents). */
  totalCents: number;
  /** Currency code (defaults to "SAR"). */
  currency?: string | null;
  /** Optional free-form notes printed below the totals. */
  notes?: string | null;
}

export interface CompanyHeaderData {
  name: string;
  nameAr?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface RenderInvoiceHtmlOptions {
  invoice: InvoiceRenderData;
  company: CompanyHeaderData;
  /** Pre-rendered QR image as a data URL (optional — caller may pass one if
   *  they have a QR library available at runtime). When omitted, the document
   *  shows the raw TLV string in place of the QR. */
  qrImageDataUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(cents: number, currency: string): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = abs % 100;
  return `${negative ? "-" : ""}${whole}.${frac < 10 ? `0${frac}` : frac} ${currency}`;
}

function fmtDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

/** Escape user-supplied text for safe inclusion in HTML. */
function esc(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Render a print-ready, self-contained invoice HTML document. The caller is
 * expected to send this with `Content-Type: text/html` — the browser handles
 * conversion to PDF via the user-triggered print dialog.
 */
export function renderInvoiceHtml(opts: RenderInvoiceHtmlOptions): string {
  const { invoice, company, qrImageDataUrl } = opts;
  const currency = invoice.currency ?? "SAR";

  // Build the ZATCA TLV — even if the renderer can't draw a QR, we want the
  // payload embedded as a comment so inspectors can validate compliance.
  const zatcaCompany: ZatcaCompanyData = {
    sellerName: company.name,
    vatNumber: company.vatNumber ?? "",
    address: company.address ?? undefined,
  };
  const zatcaInvoice: ZatcaInvoiceData = {
    id: invoice.id,
    code: invoice.code,
    issueTimestamp: invoice.issueTimestamp,
    totalCents: invoice.totalCents,
    vatCents: invoice.vatCents,
    taxableCents: invoice.subtotalCents,
  };
  const qr = generateZatcaQrPayload(zatcaInvoice, zatcaCompany);

  const items = invoice.items.length > 0
    ? invoice.items
    : ([
        {
          description: "(No line items)",
          quantity: 0,
          unitPriceCents: 0,
          taxPercent: 0,
          totalCents: 0,
        },
      ] as InvoiceLineItem[]);

  const rowsHtml = items
    .map((item) => {
      const descAr = item.descriptionAr
        ? `<div class="ar" dir="rtl">${esc(item.descriptionAr)}</div>`
        : "";
      return `
        <tr>
          <td>
            <div>${esc(item.description)}</div>
            ${descAr}
          </td>
          <td class="num">${esc(item.quantity)}</td>
          <td class="num">${fmt(item.unitPriceCents, currency)}</td>
          <td class="num">${esc(item.taxPercent)}%</td>
          <td class="num">${fmt(item.totalCents, currency)}</td>
        </tr>`;
    })
    .join("");

  const qrBlock = qrImageDataUrl
    ? `<img class="qr" src="${esc(qrImageDataUrl)}" alt="ZATCA QR" />`
    : `<div class="qr qr-placeholder">
         <div class="qr-label">ZATCA QR (TLV)</div>
         <div class="qr-tlv">${esc(qr.tlv)}</div>
       </div>`;

  const title = `Invoice ${invoice.code ?? invoice.id}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  @page { size: A4; margin: 1.5cm; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, Arial, "Helvetica Neue", sans-serif;
    color: #111;
    background: #f7f7f7;
    font-size: 12px;
    line-height: 1.45;
  }
  .page {
    max-width: 21cm;
    margin: 1.5cm auto;
    background: #fff;
    padding: 1.5cm;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.5cm;
    border-bottom: 2px solid #111;
    padding-bottom: 0.6cm;
  }
  .company h1 { font-size: 18px; margin: 0 0 4px; }
  .company .ar { font-size: 16px; }
  .company .muted { color: #555; margin-top: 4px; }
  .ar { font-family: Tahoma, "Geeza Pro", "Arabic UI Text", sans-serif; }
  .titles {
    text-align: right;
  }
  .titles .en { font-size: 20px; font-weight: 700; }
  .titles .ar { font-size: 18px; font-weight: 700; }
  .qr {
    width: 120px;
    height: 120px;
    display: block;
    margin-top: 8px;
    margin-left: auto;
    object-fit: contain;
  }
  .qr-placeholder {
    width: 120px;
    height: 120px;
    border: 1px dashed #999;
    padding: 6px;
    font-size: 8px;
    word-break: break-all;
    overflow: hidden;
  }
  .qr-placeholder .qr-label { font-weight: 700; margin-bottom: 4px; }
  .meta {
    display: flex;
    justify-content: space-between;
    margin: 0.6cm 0;
    gap: 1cm;
  }
  .meta .block { flex: 1; }
  .meta .label { color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta .value { font-size: 13px; font-weight: 600; margin-top: 2px; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0.4cm;
  }
  table.items th, table.items td {
    border-bottom: 1px solid #ddd;
    padding: 8px 6px;
    vertical-align: top;
    text-align: left;
  }
  table.items th {
    background: #fafafa;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #555;
  }
  table.items td.num, table.items th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals {
    margin-top: 0.4cm;
    margin-left: auto;
    width: 40%;
  }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .row.grand {
    border-top: 2px solid #111;
    margin-top: 6px;
    padding-top: 8px;
    font-weight: 700;
    font-size: 14px;
  }
  .notes { margin-top: 0.8cm; padding-top: 0.4cm; border-top: 1px solid #eee; color: #444; }
  .footer {
    margin-top: 0.8cm;
    color: #888;
    font-size: 10px;
    border-top: 1px solid #eee;
    padding-top: 0.4cm;
  }
  .print-toolbar {
    position: sticky;
    top: 0;
    background: #111;
    color: #fff;
    padding: 8px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  }
  .print-toolbar button {
    background: #fff;
    color: #111;
    border: 0;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
  }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .no-print, .print-toolbar { display: none !important; }
  }
</style>
</head>
<body>
<div class="print-toolbar no-print">
  <span>Use your browser's "Print" dialog and select "Save as PDF" to export this invoice.</span>
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<div class="page">
  <div class="header">
    <div class="company">
      <h1>${esc(company.name)}</h1>
      ${company.nameAr ? `<div class="ar" dir="rtl">${esc(company.nameAr)}</div>` : ""}
      ${company.vatNumber ? `<div class="muted">VAT / الرقم الضريبي: ${esc(company.vatNumber)}</div>` : ""}
      ${company.address ? `<div class="muted">${esc(company.address)}</div>` : ""}
      ${company.email ? `<div class="muted">${esc(company.email)}</div>` : ""}
      ${company.phone ? `<div class="muted">${esc(company.phone)}</div>` : ""}
    </div>
    <div class="titles">
      <div class="en">Tax Invoice</div>
      <div class="ar" dir="rtl">فاتورة ضريبية</div>
      ${qrBlock}
    </div>
  </div>

  <div class="meta">
    <div class="block">
      <div class="label">Invoice # / رقم الفاتورة</div>
      <div class="value">${esc(invoice.code ?? invoice.id)}</div>
    </div>
    <div class="block">
      <div class="label">Issue Date / تاريخ الإصدار</div>
      <div class="value">${esc(fmtDate(invoice.issueTimestamp))}</div>
    </div>
    <div class="block">
      <div class="label">Bill To / فاتورة إلى</div>
      <div class="value">${esc(invoice.customerName ?? "—")}</div>
      ${invoice.customerNameAr ? `<div class="ar" dir="rtl">${esc(invoice.customerNameAr)}</div>` : ""}
      ${invoice.customerAddress ? `<div class="muted">${esc(invoice.customerAddress)}</div>` : ""}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Description / الوصف</th>
        <th class="num">Qty / الكمية</th>
        <th class="num">Unit / السعر</th>
        <th class="num">Tax / الضريبة</th>
        <th class="num">Total / الإجمالي</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal / المجموع الفرعي</span><span>${fmt(invoice.subtotalCents, currency)}</span></div>
    <div class="row"><span>VAT 15% / ضريبة القيمة المضافة</span><span>${fmt(invoice.vatCents, currency)}</span></div>
    <div class="row grand"><span>Total / الإجمالي</span><span>${fmt(invoice.totalCents, currency)}</span></div>
  </div>

  ${invoice.notes ? `<div class="notes">${esc(invoice.notes)}</div>` : ""}

  <div class="footer">
    Generated by Paperclip · ZATCA Phase 1 simplified tax invoice.
  </div>
</div>
<!-- ZATCA TLV (base64): ${qr.tlv} -->
</body>
</html>`;
}
