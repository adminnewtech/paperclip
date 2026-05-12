/**
 * HTTP endpoints for invoice PDF rendering, ZATCA compliance, and CSV exports.
 *
 * All routes require `assertCompanyAccess(req, companyId)` — they're mounted
 * onto the same /api router as the rest of the business module routes. We
 * piggy-back on the JSONB-backed `business_entities` table for all data and
 * read company identity from the `companies` table plus an optional
 * `business_modules.config.companyData` block.
 */

import { Router } from "express";
import { and, eq, gte, ilike, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities, businessModules, companies } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import {
  renderInvoiceHtml,
  type CompanyHeaderData,
  type InvoiceLineItem,
  type InvoiceRenderData,
} from "../services/business-pdf-service.js";
import {
  generateZatcaQrPayload,
  validateZatcaCompliance,
  type ZatcaCompanyData,
  type ZatcaInvoiceData,
} from "../services/business-zatca-service.js";
import {
  csvFilename,
  formatCentsForCsv,
  formatDateForCsv,
  rowsToCsv,
  type CsvColumn,
} from "../services/business-excel-service.js";

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

interface InvoiceEntityRow {
  id: string;
  code: string | null;
  name: string | null;
  status: string;
  amountCents: number | null;
  currency: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface LoadedInvoice {
  row: InvoiceEntityRow;
  invoiceData: InvoiceRenderData;
  zatcaInvoice: ZatcaInvoiceData;
}

interface LoadedCompany {
  header: CompanyHeaderData;
  zatca: ZatcaCompanyData;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function loadCompanyHeader(db: Db, companyId: string): Promise<LoadedCompany> {
  const [companyRow] = await db
    .select({
      name: companies.name,
      description: companies.description,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  // Allow operators to enrich the header (Arabic name, VAT number, address,
  // contact info) via the `sales` module's config blob under a `companyData`
  // key. This avoids a schema migration while still giving every company a
  // first-class way to populate the invoice header.
  const [salesModule] = await db
    .select({ config: businessModules.config })
    .from(businessModules)
    .where(
      and(
        eq(businessModules.companyId, companyId),
        eq(businessModules.moduleKey, "sales"),
      ),
    )
    .limit(1);

  const config = asRecord(salesModule?.config);
  const cd = asRecord(config["companyData"]);

  const header: CompanyHeaderData = {
    name: asString(cd["name"]) ?? companyRow?.name ?? "Company",
    nameAr: asString(cd["nameAr"]),
    vatNumber: asString(cd["vatNumber"]),
    address: asString(cd["address"]) ?? companyRow?.description ?? null,
    email: asString(cd["email"]),
    phone: asString(cd["phone"]),
  };

  const zatca: ZatcaCompanyData = {
    sellerName: header.name,
    vatNumber: header.vatNumber ?? "",
    address: header.address ?? undefined,
  };

  return { header, zatca };
}

async function loadInvoice(
  db: Db,
  companyId: string,
  invoiceId: string,
): Promise<LoadedInvoice | null> {
  const [row] = await db
    .select({
      id: businessEntities.id,
      code: businessEntities.code,
      name: businessEntities.name,
      status: businessEntities.status,
      amountCents: businessEntities.amountCents,
      currency: businessEntities.currency,
      data: businessEntities.data,
      createdAt: businessEntities.createdAt,
      updatedAt: businessEntities.updatedAt,
    })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "sales"),
        eq(businessEntities.entityType, "invoice"),
        eq(businessEntities.id, invoiceId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const data = asRecord(row.data);
  const totalCents = row.amountCents ?? asNumber(data["totalCents"]) ?? 0;
  // If subtotal/VAT are explicit in the payload, prefer them; otherwise derive
  // a VAT-15% split from the total so the rendered invoice is still sensible.
  const explicitVat = asNumber(data["vatCents"]);
  const explicitSubtotal = asNumber(data["subtotalCents"]) ?? asNumber(data["taxableCents"]);
  let subtotalCents: number;
  let vatCents: number;
  if (explicitSubtotal != null && explicitVat != null) {
    subtotalCents = explicitSubtotal;
    vatCents = explicitVat;
  } else if (explicitSubtotal != null) {
    subtotalCents = explicitSubtotal;
    vatCents = Math.round(subtotalCents * 0.15);
  } else if (explicitVat != null) {
    vatCents = explicitVat;
    subtotalCents = totalCents - vatCents;
  } else {
    // Derive: total = subtotal * 1.15 → subtotal = total / 1.15.
    subtotalCents = Math.round(totalCents / 1.15);
    vatCents = totalCents - subtotalCents;
  }

  const itemsRaw = Array.isArray(data["items"]) ? (data["items"] as unknown[]) : [];
  const items: InvoiceLineItem[] = itemsRaw.map((it) => {
    const r = asRecord(it);
    const qty = asNumber(r["quantity"]) ?? 1;
    const unit = asNumber(r["unitPriceCents"]) ?? 0;
    const tax = asNumber(r["taxPercent"]) ?? 15;
    const total = asNumber(r["totalCents"]) ?? Math.round(qty * unit * (1 + tax / 100));
    return {
      description: asString(r["description"]) ?? "Item",
      descriptionAr: asString(r["descriptionAr"]),
      quantity: qty,
      unitPriceCents: unit,
      taxPercent: tax,
      totalCents: total,
    };
  });

  const issueTimestamp =
    asString(data["issueTimestamp"]) ?? row.createdAt.toISOString();

  const invoiceData: InvoiceRenderData = {
    id: row.id,
    code: row.code,
    issueTimestamp,
    customerName: asString(data["customerName"]) ?? row.name,
    customerNameAr: asString(data["customerNameAr"]),
    customerAddress: asString(data["customerAddress"]),
    items,
    subtotalCents,
    vatCents,
    totalCents,
    currency: row.currency ?? asString(data["currency"]) ?? "SAR",
    notes: asString(data["notes"]),
  };

  const zatcaInvoice: ZatcaInvoiceData = {
    id: row.id,
    code: row.code,
    issueTimestamp,
    totalCents,
    taxableCents: subtotalCents,
    vatCents,
  };

  return {
    row: {
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      amountCents: row.amountCents,
      currency: row.currency,
      data,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    invoiceData,
    zatcaInvoice,
  };
}

async function loadYearInvoiceCodes(
  db: Db,
  companyId: string,
  isoTimestamp: string,
): Promise<string[]> {
  const year = new Date(isoTimestamp).getUTCFullYear();
  if (!Number.isFinite(year)) return [];
  const rows = await db
    .select({ code: businessEntities.code })
    .from(businessEntities)
    .where(
      and(
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "sales"),
        eq(businessEntities.entityType, "invoice"),
        ilike(businessEntities.code, `%-${year}-%`),
      ),
    );
  return rows.map((r) => r.code).filter((c): c is string => typeof c === "string");
}

// ---------------------------------------------------------------------------
// CSV column definitions
// ---------------------------------------------------------------------------

interface BusinessRow {
  id: string;
  moduleKey: string;
  entityType: string;
  code: string | null;
  name: string | null;
  status: string;
  ownerUserId: string | null;
  amountCents: number | null;
  currency: string | null;
  data: unknown;
  tags: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceColumns: CsvColumn<BusinessRow>[] = [
  { header: "Invoice #", value: (r) => r.code ?? "" },
  { header: "Name", value: (r) => r.name ?? "" },
  { header: "Status", value: (r) => r.status },
  { header: "Customer", value: (r) => (asRecord(r.data)["customerName"] as string | undefined) ?? "" },
  { header: "Issue Date", value: (r) => formatDateForCsv((asRecord(r.data)["issueTimestamp"] as string | undefined) ?? r.createdAt) },
  { header: "Subtotal", value: (r) => formatCentsForCsv(asNumber(asRecord(r.data)["subtotalCents"])) },
  { header: "VAT", value: (r) => formatCentsForCsv(asNumber(asRecord(r.data)["vatCents"])) },
  { header: "Total", value: (r) => formatCentsForCsv(r.amountCents) },
  { header: "Currency", value: (r) => r.currency ?? "" },
];

const customerColumns: CsvColumn<BusinessRow>[] = [
  { header: "Customer Code", value: (r) => r.code ?? "" },
  { header: "Name", value: (r) => r.name ?? "" },
  { header: "Status", value: (r) => r.status },
  { header: "Email", value: (r) => (asRecord(r.data)["email"] as string | undefined) ?? "" },
  { header: "Phone", value: (r) => (asRecord(r.data)["phone"] as string | undefined) ?? "" },
  { header: "Company", value: (r) => (asRecord(r.data)["company"] as string | undefined) ?? "" },
  { header: "Owner", value: (r) => r.ownerUserId ?? "" },
  { header: "Created", value: (r) => formatDateForCsv(r.createdAt) },
];

const productColumns: CsvColumn<BusinessRow>[] = [
  { header: "SKU", value: (r) => r.code ?? "" },
  { header: "Name", value: (r) => r.name ?? "" },
  { header: "Status", value: (r) => r.status },
  { header: "Price", value: (r) => formatCentsForCsv(r.amountCents) },
  { header: "Currency", value: (r) => r.currency ?? "" },
  { header: "Category", value: (r) => (asRecord(r.data)["category"] as string | undefined) ?? "" },
  { header: "Stock", value: (r) => String(asNumber(asRecord(r.data)["stock"]) ?? "") },
];

const expenseColumns: CsvColumn<BusinessRow>[] = [
  { header: "Expense #", value: (r) => r.code ?? "" },
  { header: "Description", value: (r) => r.name ?? "" },
  { header: "Status", value: (r) => r.status },
  { header: "Category", value: (r) => (asRecord(r.data)["category"] as string | undefined) ?? "Uncategorized" },
  { header: "Vendor", value: (r) => (asRecord(r.data)["vendor"] as string | undefined) ?? "" },
  { header: "Date", value: (r) => formatDateForCsv(r.createdAt) },
  { header: "Amount", value: (r) => formatCentsForCsv(r.amountCents) },
  { header: "Currency", value: (r) => r.currency ?? "" },
];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function businessExportsRoutes(db: Db) {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/invoices/:invoiceId/pdf
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/invoices/:invoiceId/pdf",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const invoiceId = req.params.invoiceId as string;
      assertCompanyAccess(req, companyId);

      const [loaded, companyInfo] = await Promise.all([
        loadInvoice(db, companyId, invoiceId),
        loadCompanyHeader(db, companyId),
      ]);
      if (!loaded) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      const html = renderInvoiceHtml({
        invoice: loaded.invoiceData,
        company: companyInfo.header,
        qrImageDataUrl: null,
      });

      res
        .status(200)
        .set("Content-Type", "text/html; charset=utf-8")
        .set(
          "Content-Disposition",
          `inline; filename="${csvFilename(`invoice-${loaded.invoiceData.code ?? loaded.invoiceData.id}`).replace(/\.csv$/, ".html")}"`,
        )
        .send(html);
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/invoices/:invoiceId/zatca
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/invoices/:invoiceId/zatca",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const invoiceId = req.params.invoiceId as string;
      assertCompanyAccess(req, companyId);

      const [loaded, companyInfo] = await Promise.all([
        loadInvoice(db, companyId, invoiceId),
        loadCompanyHeader(db, companyId),
      ]);
      if (!loaded) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      const qr = generateZatcaQrPayload(loaded.zatcaInvoice, companyInfo.zatca);
      const yearCodes = await loadYearInvoiceCodes(
        db,
        companyId,
        loaded.zatcaInvoice.issueTimestamp ?? new Date().toISOString(),
      );
      const compliance = validateZatcaCompliance(
        loaded.zatcaInvoice,
        companyInfo.zatca,
        { yearInvoiceCodes: yearCodes },
      );

      res.json({
        qrPayload: qr.qrPayload,
        tlv: qr.tlv,
        encoded: qr.encoded,
        compliance,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /companies/:companyId/business/invoices/:invoiceId/validate-zatca
  // -------------------------------------------------------------------------
  router.post(
    "/companies/:companyId/business/invoices/:invoiceId/validate-zatca",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const invoiceId = req.params.invoiceId as string;
      assertCompanyAccess(req, companyId);

      const [loaded, companyInfo] = await Promise.all([
        loadInvoice(db, companyId, invoiceId),
        loadCompanyHeader(db, companyId),
      ]);
      if (!loaded) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      const yearCodes = await loadYearInvoiceCodes(
        db,
        companyId,
        loaded.zatcaInvoice.issueTimestamp ?? new Date().toISOString(),
      );
      const result = validateZatcaCompliance(
        loaded.zatcaInvoice,
        companyInfo.zatca,
        { yearInvoiceCodes: yearCodes },
      );

      res.json(result);
    },
  );

  // -------------------------------------------------------------------------
  // CSV export helper
  // -------------------------------------------------------------------------
  function sendCsv(
    res: Parameters<Parameters<typeof router.get>[1]>[1],
    filename: string,
    content: string,
  ): void {
    res
      .status(200)
      .set("Content-Type", "text/csv; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${csvFilename(filename)}"`)
      .send(content);
  }

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/exports/invoices.csv
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/exports/invoices.csv",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
      const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
      const status = typeof req.query.status === "string" ? req.query.status : null;

      const where = [
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "sales"),
        eq(businessEntities.entityType, "invoice"),
      ];
      if (from && !isNaN(from.getTime())) where.push(gte(businessEntities.createdAt, from));
      if (to && !isNaN(to.getTime())) where.push(lte(businessEntities.createdAt, to));
      if (status) where.push(eq(businessEntities.status, status));

      const rows = await db
        .select()
        .from(businessEntities)
        .where(and(...where))
        .orderBy(businessEntities.createdAt);

      sendCsv(res, "invoices", rowsToCsv(rows as BusinessRow[], invoiceColumns));
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/exports/customers.csv
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/exports/customers.csv",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const rows = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            sql`(
              (${businessEntities.moduleKey} = 'crm' AND ${businessEntities.entityType} = 'contact')
              OR (${businessEntities.moduleKey} = 'sales' AND ${businessEntities.entityType} = 'customer')
            )`,
          ),
        )
        .orderBy(businessEntities.name);

      sendCsv(res, "customers", rowsToCsv(rows as BusinessRow[], customerColumns));
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/exports/products.csv
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/exports/products.csv",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const rows = await db
        .select()
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, "inventory"),
            eq(businessEntities.entityType, "product"),
          ),
        )
        .orderBy(businessEntities.name);

      sendCsv(res, "products", rowsToCsv(rows as BusinessRow[], productColumns));
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/exports/expenses.csv
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/exports/expenses.csv",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
      const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

      const where = [
        eq(businessEntities.companyId, companyId),
        eq(businessEntities.moduleKey, "finance"),
        eq(businessEntities.entityType, "expense"),
      ];
      if (from && !isNaN(from.getTime())) where.push(gte(businessEntities.createdAt, from));
      if (to && !isNaN(to.getTime())) where.push(lte(businessEntities.createdAt, to));

      const rows = await db
        .select()
        .from(businessEntities)
        .where(and(...where))
        .orderBy(businessEntities.createdAt);

      sendCsv(res, "expenses", rowsToCsv(rows as BusinessRow[], expenseColumns));
    },
  );

  // -------------------------------------------------------------------------
  // GET /companies/:companyId/business/exports/pnl.csv
  // -------------------------------------------------------------------------
  router.get(
    "/companies/:companyId/business/exports/pnl.csv",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
      const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

      const dateFilter = [
        eq(businessEntities.companyId, companyId),
      ];
      if (from && !isNaN(from.getTime())) dateFilter.push(gte(businessEntities.createdAt, from));
      if (to && !isNaN(to.getTime())) dateFilter.push(lte(businessEntities.createdAt, to));

      // Revenue: paid invoices
      const revenueRows = await db
        .select({
          totalCents: sql<number>`coalesce(sum(amount_cents),0)::bigint`,
        })
        .from(businessEntities)
        .where(
          and(
            ...dateFilter,
            eq(businessEntities.moduleKey, "sales"),
            eq(businessEntities.entityType, "invoice"),
            eq(businessEntities.status, "paid"),
          ),
        );

      // Expenses grouped by category
      const expenseRows = await db
        .select({
          category: sql<string>`coalesce(data->>'category','Uncategorized')`,
          totalCents: sql<number>`coalesce(sum(amount_cents),0)::bigint`,
        })
        .from(businessEntities)
        .where(
          and(
            ...dateFilter,
            eq(businessEntities.moduleKey, "finance"),
            eq(businessEntities.entityType, "expense"),
          ),
        )
        .groupBy(sql`coalesce(data->>'category','Uncategorized')`);

      const revenueCents = Number(revenueRows[0]?.totalCents ?? 0);
      const expensesCents = expenseRows.reduce(
        (sum, r) => sum + Number(r.totalCents),
        0,
      );
      const netCents = revenueCents - expensesCents;

      interface PnlRow {
        section: string;
        label: string;
        amountCents: number | null;
      }
      const rows: PnlRow[] = [
        { section: "Revenue", label: "Paid Invoices", amountCents: revenueCents },
        { section: "Revenue", label: "Total Revenue", amountCents: revenueCents },
      ];
      for (const e of expenseRows) {
        rows.push({
          section: "Expenses",
          label: e.category,
          amountCents: Number(e.totalCents),
        });
      }
      rows.push({ section: "Expenses", label: "Total Expenses", amountCents: expensesCents });
      rows.push({ section: "Net", label: "Net Income", amountCents: netCents });

      const pnlColumns: CsvColumn<PnlRow>[] = [
        { header: "Section", value: (r) => r.section },
        { header: "Label", value: (r) => r.label },
        { header: "Amount", value: (r) => formatCentsForCsv(r.amountCents) },
      ];

      sendCsv(res, "pnl", rowsToCsv(rows, pnlColumns));
    },
  );

  return router;
}
