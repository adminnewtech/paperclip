import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatFils,
  type RetailLocation,
  type RetailSale,
} from "@/api/business-retail";

/**
 * Receipt preview component.
 *
 * Renders a printable HTML receipt sized for an 80mm thermal printer.
 * The DOM uses `@media print` styles so it prints cleanly even on plain
 * A4 if no thermal driver is attached.
 *
 * The HTML width is set to 80mm in print mode and a fixed 320px in screen
 * mode (≈ 80mm at 96dpi). All amounts come from the sale object — the UI
 * does not recompute totals.
 */

export interface ReceiptPreviewProps {
  sale: RetailSale;
  location?: RetailLocation | null;
  companyName?: string;
  /** Optional logo URL. */
  logoUrl?: string;
  /** Show a print button toolbar above the receipt. */
  showPrintButton?: boolean;
}

function methodLabel(m: RetailSale["payments"][number]["method"]): string {
  switch (m) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "knet":
      return "KNET";
    case "loyalty":
      return "Loyalty";
    case "store_credit":
      return "Store credit";
  }
}

export function ReceiptPreview({
  sale,
  location,
  companyName,
  logoUrl,
  showPrintButton = true,
}: ReceiptPreviewProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      {showPrintButton && (
        <div className="flex w-full items-center justify-end print:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="mr-2 h-4 w-4" />
            Print receipt
          </Button>
        </div>
      )}

      <div
        className="receipt-print w-[320px] bg-white p-3 font-mono text-[11px] leading-tight text-black shadow-sm"
        style={{ maxWidth: "80mm" }}
      >
        {/* Header */}
        <div className="text-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" className="mx-auto mb-2 h-10 w-auto" />
          ) : null}
          <div className="text-sm font-bold uppercase tracking-wide">
            {companyName ?? "Retail store"}
          </div>
          {location?.name && (
            <div className="text-[10px]">{location.name}</div>
          )}
          {location?.address && (
            <div className="text-[10px] opacity-70">{location.address}</div>
          )}
          {location?.phone && (
            <div className="text-[10px] opacity-70">Tel: {location.phone}</div>
          )}
        </div>

        <hr className="my-2 border-t border-dashed border-black/40" />

        {/* Sale meta */}
        <div className="flex justify-between">
          <span>Receipt #</span>
          <span className="font-semibold">{sale.code}</span>
        </div>
        <div className="flex justify-between">
          <span>Date</span>
          <span>{new Date(sale.createdAt).toLocaleString()}</span>
        </div>
        {sale.cashierName && (
          <div className="flex justify-between">
            <span>Cashier</span>
            <span>{sale.cashierName}</span>
          </div>
        )}
        {sale.customerName && (
          <div className="flex justify-between">
            <span>Customer</span>
            <span>{sale.customerName}</span>
          </div>
        )}

        <hr className="my-2 border-t border-dashed border-black/40" />

        {/* Items */}
        <div>
          {sale.items.map((it, i) => (
            <div key={`${it.productId}-${i}`} className="mb-1">
              <div className="flex justify-between">
                <span className="flex-1 truncate pr-2">{it.productName}</span>
                <span>{formatFils(it.lineTotalCents)}</span>
              </div>
              <div className="flex justify-between text-[10px] opacity-70">
                <span>
                  {it.quantity} × {formatFils(it.unitPriceCents)}
                  {it.refunded ? "  · REFUNDED" : ""}
                </span>
                {it.discountCents > 0 && (
                  <span>−{formatFils(it.discountCents)}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <hr className="my-2 border-t border-dashed border-black/40" />

        {/* Totals */}
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatFils(sale.subtotalCents)}</span>
        </div>
        {sale.discountCents > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span>−{formatFils(sale.discountCents)}</span>
          </div>
        )}
        {sale.loyaltyPointsRedeemedCents > 0 && (
          <div className="flex justify-between">
            <span>Loyalty redeemed</span>
            <span>−{formatFils(sale.loyaltyPointsRedeemedCents)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>VAT</span>
          <span>{formatFils(sale.taxCents)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-black/50 pt-1 text-[13px] font-bold">
          <span>TOTAL</span>
          <span>{formatFils(sale.totalCents)}</span>
        </div>

        <hr className="my-2 border-t border-dashed border-black/40" />

        {/* Payments */}
        {sale.payments.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span>{methodLabel(p.method)}</span>
            <span>{formatFils(p.amountCents)}</span>
          </div>
        ))}
        {sale.changeCents > 0 && (
          <div className="flex justify-between font-semibold">
            <span>Change</span>
            <span>{formatFils(sale.changeCents)}</span>
          </div>
        )}

        {sale.loyaltyPointsEarned > 0 && (
          <>
            <hr className="my-2 border-t border-dashed border-black/40" />
            <div className="text-center">
              You earned {sale.loyaltyPointsEarned} loyalty points!
            </div>
          </>
        )}

        <hr className="my-2 border-t border-dashed border-black/40" />

        <div className="text-center text-[10px]">
          <div>Thank you for shopping with us!</div>
          <div dir="rtl">شكراً لتسوقكم معنا</div>
        </div>
      </div>

      <style>{`
        @media print {
          @page {
            size: 80mm auto;
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
          }
          body * {
            visibility: hidden;
          }
          .receipt-print, .receipt-print * {
            visibility: visible;
          }
          .receipt-print {
            position: absolute;
            left: 0;
            top: 0;
            width: 80mm !important;
            max-width: 80mm !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}
