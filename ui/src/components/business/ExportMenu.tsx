import { useMemo } from "react";
import { DownloadIcon, FileTextIcon, PrinterIcon, QrCodeIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/**
 * Generic export menu.
 *
 *   <ExportMenu
 *     label="Export"
 *     exports={[
 *       { label: "Invoices CSV", href: "/api/.../exports/invoices.csv" },
 *       { label: "Customers CSV", href: "/api/.../exports/customers.csv" },
 *     ]}
 *   />
 *
 * A few convenience static factories (`ExportMenu.Invoice`, etc.) wrap the
 * generic component for the most common entity-level export bundles.
 */

export interface ExportMenuItem {
  label: string;
  href: string;
  /** Optional Lucide icon component. */
  icon?: React.ComponentType<{ className?: string }>;
  /** When true (default) the link opens in a new tab so the current page
   *  isn't navigated away from. */
  newTab?: boolean;
  /** When true the link is rendered with `download` so the browser saves the
   *  response instead of trying to render it. */
  download?: boolean | string;
}

export interface ExportMenuProps {
  exports: ExportMenuItem[];
  label?: string;
  /** Optional heading rendered at the top of the dropdown. */
  title?: string;
}

function ExportMenuRoot({ exports, label = "Export", title }: ExportMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <DownloadIcon className="size-4" aria-hidden />
          <span>{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {title ? (
          <>
            <DropdownMenuLabel>{title}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {exports.map((item, idx) => {
          const Icon = item.icon ?? FileTextIcon;
          const newTab = item.newTab ?? true;
          return (
            <DropdownMenuItem key={`${item.label}-${idx}`} asChild>
              <a
                href={item.href}
                target={newTab ? "_blank" : undefined}
                rel={newTab ? "noopener noreferrer" : undefined}
                download={item.download === true ? "" : item.download || undefined}
              >
                <Icon className="size-4" aria-hidden />
                <span>{item.label}</span>
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Convenience: per-invoice export bundle
// ---------------------------------------------------------------------------

export interface InvoiceExportMenuProps {
  companyId: string;
  invoiceId: string;
  label?: string;
}

function InvoiceExportMenu({ companyId, invoiceId, label }: InvoiceExportMenuProps) {
  const base = `/api/companies/${encodeURIComponent(companyId)}/business`;
  const exports = useMemo<ExportMenuItem[]>(
    () => [
      {
        label: "Print PDF",
        href: `${base}/invoices/${encodeURIComponent(invoiceId)}/pdf`,
        icon: PrinterIcon,
        newTab: true,
      },
      {
        label: "Download CSV",
        href: `${base}/exports/invoices.csv`,
        icon: FileTextIcon,
        download: true,
      },
      {
        label: "View ZATCA QR",
        href: `${base}/invoices/${encodeURIComponent(invoiceId)}/zatca`,
        icon: QrCodeIcon,
        newTab: true,
      },
    ],
    [base, invoiceId],
  );
  return <ExportMenuRoot exports={exports} label={label ?? "Export"} title="Invoice" />;
}

// ---------------------------------------------------------------------------
// Convenience: company-wide export bundle
// ---------------------------------------------------------------------------

export interface CompanyExportMenuProps {
  companyId: string;
  label?: string;
}

function CompanyExportMenu({ companyId, label }: CompanyExportMenuProps) {
  const base = `/api/companies/${encodeURIComponent(companyId)}/business/exports`;
  const exports = useMemo<ExportMenuItem[]>(
    () => [
      { label: "Invoices CSV", href: `${base}/invoices.csv`, download: true },
      { label: "Customers CSV", href: `${base}/customers.csv`, download: true },
      { label: "Products CSV", href: `${base}/products.csv`, download: true },
      { label: "Expenses CSV", href: `${base}/expenses.csv`, download: true },
      { label: "P&L CSV", href: `${base}/pnl.csv`, download: true },
    ],
    [base],
  );
  return <ExportMenuRoot exports={exports} label={label ?? "Export"} title="Exports" />;
}

// ---------------------------------------------------------------------------
// Convenience: client-side ZATCA compliance badge
// ---------------------------------------------------------------------------

const SAUDI_VAT_NUMBER_RE = /^3\d{13}3$/;

export interface ZatcaBadgeInput {
  /** Invoice issue timestamp (ISO string) — required by ZATCA. */
  issueTimestamp?: string | null;
  /** Pre-tax amount in cents. */
  subtotalCents?: number | null;
  /** VAT amount in cents. */
  vatCents?: number | null;
  /** Total amount including VAT in cents. */
  totalCents?: number | null;
}

export interface ZatcaBadgeCompany {
  name?: string | null;
  vatNumber?: string | null;
}

export interface ZatcaBadgeProps {
  invoice: ZatcaBadgeInput;
  company?: ZatcaBadgeCompany;
  className?: string;
}

/**
 * Lightweight client-side ZATCA validation badge. Does not call the server —
 * it inspects the data that is already in scope on the page and shows a green
 * check or a red cross. Use it as a quick "is this invoice issuable?" cue
 * next to invoice cards and list rows.
 */
export function ZatcaBadge({ invoice, company, className }: ZatcaBadgeProps) {
  const issues: string[] = [];
  if (!company?.name || company.name.trim().length === 0) {
    issues.push("Missing seller name");
  }
  const vat = (company?.vatNumber ?? "").trim();
  if (!vat) {
    issues.push("Missing VAT number");
  } else if (!SAUDI_VAT_NUMBER_RE.test(vat)) {
    issues.push("VAT number must be 15 digits starting and ending with 3");
  }
  if (!invoice.issueTimestamp) {
    issues.push("Missing issue date");
  }
  if (invoice.vatCents == null) {
    issues.push("Missing VAT amount");
  } else if (invoice.subtotalCents != null && invoice.subtotalCents >= 0) {
    const expected = Math.round(invoice.subtotalCents * 0.15);
    if (Math.abs(expected - invoice.vatCents) > 1) {
      issues.push("VAT amount is not 15% of subtotal");
    }
  }

  const ok = issues.length === 0;
  const title = ok ? "ZATCA compliant" : `ZATCA issues:\n- ${issues.join("\n- ")}`;
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium " +
        (ok
          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
          : "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200") +
        (className ? ` ${className}` : "")
      }
      title={title}
      aria-label={title}
    >
      <span aria-hidden>{ok ? "✓" : "✗"}</span>
      <span>ZATCA</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Exported namespace
// ---------------------------------------------------------------------------

type ExportMenuComponent = typeof ExportMenuRoot & {
  Invoice: typeof InvoiceExportMenu;
  Company: typeof CompanyExportMenu;
};

export const ExportMenu: ExportMenuComponent = Object.assign(ExportMenuRoot, {
  Invoice: InvoiceExportMenu,
  Company: CompanyExportMenu,
});

export default ExportMenu;
