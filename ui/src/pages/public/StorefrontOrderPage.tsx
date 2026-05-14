import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { Link } from "@/lib/router";
import {
  CheckCircle2,
  Package,
  Truck,
  CreditCard,
  Mail,
  Phone,
  MapPin,
  Loader2,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicStorefrontApi } from "@/api/public-storefront";
import { useStorefront } from "./StorefrontLayout";

const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  pending: { en: "Pending", ar: "قيد الانتظار" },
  confirmed: { en: "Confirmed", ar: "تم التأكيد" },
  processing: { en: "Processing", ar: "قيد التحضير" },
  shipped: { en: "Shipped", ar: "تم الشحن" },
  delivered: { en: "Delivered", ar: "تم التسليم" },
  cancelled: { en: "Cancelled", ar: "ملغي" },
};

const PAYMENT_STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  unpaid: { en: "Unpaid", ar: "غير مدفوع" },
  paid: { en: "Paid", ar: "مدفوع" },
  refunded: { en: "Refunded", ar: "تم الاسترداد" },
  failed: { en: "Failed", ar: "فشل" },
};

const FULFILLMENT_STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  unfulfilled: { en: "Not yet shipped", ar: "لم يتم الشحن" },
  fulfilled: { en: "Shipped", ar: "تم الشحن" },
  partial: { en: "Partially shipped", ar: "شُحن جزئياً" },
  delivered: { en: "Delivered", ar: "تم التسليم" },
};

export function StorefrontOrderPage() {
  const { storefront, slug, isRtl, formatPrice, t } = useStorefront();
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const query = useQuery({
    queryKey: ["public-storefront", slug, "order", orderId, token],
    queryFn: () => publicStorefrontApi.getOrder(slug, orderId ?? "", token),
    enabled: Boolean(orderId && token),
    retry: false,
  });

  if (!orderId || !token) {
    return (
      <NotFoundOrTokenless
        message={t(
          "An order tracking link is required to view this page.",
          "يلزم رابط تتبع لعرض هذه الصفحة.",
        )}
      />
    );
  }

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-slate-400 mb-4" />
        <p className="text-slate-500">{t("Loading order…", "جاري تحميل الطلب…")}</p>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <NotFoundOrTokenless
        message={t(
          "We couldn't find that order, or the tracking link is invalid.",
          "تعذر العثور على الطلب أو أن الرابط غير صالح.",
        )}
      />
    );
  }

  const order = query.data.order;
  const statusLabel = STATUS_LABELS[order.status] ?? { en: order.status, ar: order.status };
  const paymentLabel = PAYMENT_STATUS_LABELS[order.paymentStatus] ?? {
    en: order.paymentStatus,
    ar: order.paymentStatus,
  };
  const fulfillmentLabel = FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus] ?? {
    en: order.fulfillmentStatus,
    ar: order.fulfillmentStatus,
  };

  const addressParts = [
    order.shippingAddress.block && `${t("Block", "قطعة")} ${order.shippingAddress.block}`,
    order.shippingAddress.street && `${t("St.", "ش")} ${order.shippingAddress.street}`,
    order.shippingAddress.avenue && `${t("Ave.", "جادة")} ${order.shippingAddress.avenue}`,
    order.shippingAddress.building && `${t("Bldg.", "مبنى")} ${order.shippingAddress.building}`,
    order.shippingAddress.floor && `${t("Fl.", "دور")} ${order.shippingAddress.floor}`,
    order.shippingAddress.apartment && `${t("Apt.", "شقة")} ${order.shippingAddress.apartment}`,
    order.shippingAddress.area,
    order.shippingAddress.city,
    order.shippingAddress.country,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      {/* Confirmation hero */}
      <div
        className="rounded-2xl p-8 text-center"
        style={{ backgroundColor: storefront.brandColors.accent }}
      >
        <div
          className="mx-auto mb-4 size-14 rounded-full flex items-center justify-center text-white"
          style={{ backgroundColor: storefront.brandColors.primary }}
        >
          <CheckCircle2 className="size-7" />
        </div>
        <h1
          className="text-2xl font-bold mb-1"
          style={{ color: storefront.brandColors.primary }}
        >
          {t("Thank you for your order!", "شكراً لطلبك!")}
        </h1>
        <p className="text-slate-600 text-sm">
          {t(
            `We've received your order. A confirmation has been sent to ${order.customerEmail}.`,
            `تم استلام طلبك. تم إرسال تأكيد إلى ${order.customerEmail}.`,
          )}
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-semibold">
          <span className="text-slate-500">{t("Order", "طلب")}</span>
          <span style={{ color: storefront.brandColors.primary }}>{order.code}</span>
        </div>
      </div>

      {/* Status pills */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusCard
          icon={<Clock className="size-4" />}
          label={t("Order Status", "حالة الطلب")}
          value={isRtl ? statusLabel.ar : statusLabel.en}
          accent={storefront.brandColors.primary}
        />
        <StatusCard
          icon={<CreditCard className="size-4" />}
          label={t("Payment", "الدفع")}
          value={isRtl ? paymentLabel.ar : paymentLabel.en}
          accent={order.paymentStatus === "paid" ? "#16a34a" : "#f59e0b"}
        />
        <StatusCard
          icon={<Truck className="size-4" />}
          label={t("Shipping", "الشحن")}
          value={isRtl ? fulfillmentLabel.ar : fulfillmentLabel.en}
          accent={
            order.fulfillmentStatus === "fulfilled" || order.fulfillmentStatus === "delivered"
              ? "#16a34a"
              : "#64748b"
          }
        />
      </div>

      {/* Pay now CTA if unpaid */}
      {order.paymentStatus === "unpaid" && order.paymentMethod !== "cod" && order.paymentMethod !== "cash" ? (
        <div
          className="rounded-lg p-4 flex items-center justify-between gap-3"
          style={{
            borderInlineStart: `4px solid ${storefront.brandColors.primary}`,
            backgroundColor: storefront.brandColors.accent,
          }}
        >
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">
              {t("Complete your payment", "أكمل دفع الطلب")}
            </div>
            <div className="text-xs text-slate-600">
              {t(
                "Your order will be processed once payment is received.",
                "سيتم تجهيز طلبك بمجرد استلام الدفع.",
              )}
            </div>
          </div>
          <Button
            disabled
            style={{ backgroundColor: storefront.brandColors.primary, color: "white" }}
          >
            {t("Pay Now", "ادفع الآن")}
          </Button>
        </div>
      ) : null}

      {/* Items */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Package className="size-4" />
          {t("Order Items", "بنود الطلب")}
        </h2>
        <div className="space-y-2">
          {order.items.map((line) => {
            const name = isRtl && line.productNameAr ? line.productNameAr : line.productName;
            return (
              <div key={line.productId} className="flex items-start justify-between gap-4 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium line-clamp-2">{name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {formatPrice(line.unitPriceCents)} × {line.quantity}
                  </div>
                </div>
                <div className="font-medium whitespace-nowrap">
                  {formatPrice(line.lineTotalCents)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3 space-y-1.5 text-sm">
          <Row label={t("Subtotal", "المجموع")} value={formatPrice(order.subtotalCents)} />
          {order.discountCode ? (
            <Row
              label={`${t("Discount", "الخصم")} (${order.discountCode})`}
              value={`−${formatPrice(order.discountCents)}`}
              tone="primary"
              accent={storefront.brandColors.primary}
            />
          ) : null}
          <Row
            label={t("Shipping", "الشحن")}
            value={order.shippingCents === 0 ? t("Free", "مجاني") : formatPrice(order.shippingCents)}
          />
          {order.vatCents > 0 ? (
            <Row label={t("VAT", "الضريبة")} value={formatPrice(order.vatCents)} />
          ) : null}
          <div className="border-t border-slate-100 pt-2 mt-1 flex justify-between text-base">
            <span className="font-semibold">{t("Total", "الإجمالي")}</span>
            <span
              className="font-bold"
              style={{ color: storefront.brandColors.primary }}
            >
              {formatPrice(order.totalCents)}
            </span>
          </div>
        </div>
      </section>

      {/* Customer + shipping */}
      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2 text-sm">
          <h3 className="font-semibold mb-1">{t("Customer", "العميل")}</h3>
          <div className="flex items-center gap-2 text-slate-700">
            {order.customerName}
          </div>
          <div className="flex items-center gap-2 text-slate-600">
            <Mail className="size-3.5" />
            <span dir="ltr">{order.customerEmail}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-600">
            <Phone className="size-3.5" />
            <span dir="ltr">{order.customerPhone}</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2 text-sm">
          <h3 className="font-semibold mb-1 flex items-center gap-2">
            <MapPin className="size-3.5" />
            {t("Shipping Address", "عنوان الشحن")}
          </h3>
          <div className="text-slate-700">{addressParts.join(", ") || "—"}</div>
        </div>
      </section>

      <div className="flex flex-wrap gap-3 justify-center pt-4">
        <Button asChild variant="outline">
          <Link to={`/shop/${slug}/products`}>{t("Continue Shopping", "متابعة التسوق")}</Link>
        </Button>
        <Button
          asChild
          style={{ backgroundColor: storefront.brandColors.primary, color: "white" }}
        >
          <Link to={`/shop/${slug}/account`}>
            {t("View My Orders", "عرض طلباتي")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 mb-1">
        {icon}
        {label}
      </div>
      <div className="font-semibold text-sm" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  accent,
}: {
  label: string;
  value: string;
  tone?: "primary";
  accent?: string;
}) {
  return (
    <div
      className="flex justify-between"
      style={tone === "primary" && accent ? { color: accent } : undefined}
    >
      <span className="text-slate-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function NotFoundOrTokenless({ message }: { message: string }) {
  const { slug, t } = useStorefront();
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold mb-2">
        {t("Order not found", "الطلب غير موجود")}
      </h1>
      <p className="text-slate-500 mb-6 text-sm">{message}</p>
      <Button asChild>
        <Link to={`/shop/${slug}`}>{t("Back to Store", "العودة للمتجر")}</Link>
      </Button>
    </div>
  );
}
