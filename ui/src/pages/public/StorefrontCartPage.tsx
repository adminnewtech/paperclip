import { useState } from "react";
import { Link } from "@/lib/router";
import { Minus, Plus, Trash2, ShoppingBag, ImageIcon, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStorefront } from "./StorefrontLayout";
import { useCart } from "@/hooks/useCart";
import { publicStorefrontApi, type PublicDiscount } from "@/api/public-storefront";

export function StorefrontCartPage() {
  const { storefront, slug, isRtl, formatPrice, t } = useStorefront();
  const cart = useCart(slug);
  const [discountCode, setDiscountCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<PublicDiscount | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function applyDiscount() {
    if (!discountCode.trim()) return;
    setChecking(true);
    setDiscountError(null);
    try {
      const result = await publicStorefrontApi.checkDiscount(
        slug,
        discountCode.trim(),
        cart.totalCents,
      );
      setAppliedDiscount(result.discount);
    } catch {
      setAppliedDiscount(null);
      setDiscountError(t("Invalid or expired code", "رمز غير صالح أو منتهي"));
    } finally {
      setChecking(false);
    }
  }

  const subtotalCents = cart.totalCents;
  const discountCents = appliedDiscount?.computedDiscountCents ?? 0;
  // Estimate shipping using the first applicable zone
  const shippingZone =
    storefront.shippingZones.find((z) => z.countries.includes(storefront.countryCode)) ??
    storefront.shippingZones[0];
  const shippingEstimateCents = shippingZone
    ? shippingZone.freeShippingMinCents && subtotalCents - discountCents >= shippingZone.freeShippingMinCents
      ? 0
      : shippingZone.flatRateCents
    : 0;
  const totalEstimate = Math.max(0, subtotalCents - discountCents) + shippingEstimateCents;

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div
          className="mx-auto mb-6 size-20 rounded-full flex items-center justify-center"
          style={{ backgroundColor: storefront.brandColors.accent }}
        >
          <ShoppingBag
            className="size-10"
            style={{ color: storefront.brandColors.primary }}
          />
        </div>
        <h1 className="text-2xl font-semibold mb-2">
          {t("Your cart is empty", "سلتك فارغة")}
        </h1>
        <p className="text-slate-500 mb-6">
          {t(
            "Browse our products and add something you love.",
            "تصفح منتجاتنا وأضف ما يعجبك.",
          )}
        </p>
        <Button asChild size="lg" style={{ backgroundColor: storefront.brandColors.primary, color: "white" }}>
          <Link to={`/shop/${slug}/products`}>
            {t("Start Shopping", "ابدأ التسوق")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl md:text-3xl font-semibold mb-6">
        {t("Shopping Cart", "سلة التسوق")}
      </h1>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Items */}
        <div className="space-y-3">
          {cart.items.map((item) => {
            const name = isRtl && item.productNameAr ? item.productNameAr : item.productName;
            const lineTotal = item.unitPriceCents * item.quantity;
            return (
              <div
                key={item.productId}
                className="flex gap-4 p-4 rounded-lg border border-slate-200 bg-white"
              >
                <div
                  className="flex-shrink-0 size-20 sm:size-24 rounded-md overflow-hidden flex items-center justify-center"
                  style={{ backgroundColor: storefront.brandColors.accent }}
                >
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={name} className="size-full object-cover" />
                  ) : (
                    <ImageIcon className="size-6 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/shop/${slug}/product/${encodeURIComponent(item.productId)}`}
                    className="font-medium hover:underline line-clamp-2"
                  >
                    {name}
                  </Link>
                  <div className="text-sm text-slate-500 mt-1">
                    {formatPrice(item.unitPriceCents)}
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="inline-flex items-center border border-slate-200 rounded-md">
                      <button
                        type="button"
                        onClick={() => cart.updateQuantity(item.productId, item.quantity - 1)}
                        className="size-8 flex items-center justify-center hover:bg-slate-50"
                        aria-label="Decrease"
                      >
                        <Minus className="size-3" />
                      </button>
                      <div className="px-3 min-w-[2rem] text-center text-sm font-medium border-x border-slate-200">
                        {item.quantity}
                      </div>
                      <button
                        type="button"
                        onClick={() => cart.updateQuantity(item.productId, item.quantity + 1)}
                        className="size-8 flex items-center justify-center hover:bg-slate-50"
                        aria-label="Increase"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => cart.removeItem(item.productId)}
                      className="text-slate-400 hover:text-red-600 inline-flex items-center gap-1 text-xs"
                    >
                      <Trash2 className="size-3.5" />
                      <span>{t("Remove", "إزالة")}</span>
                    </button>
                  </div>
                </div>
                <div className="text-right font-semibold whitespace-nowrap">
                  {formatPrice(lineTotal)}
                </div>
              </div>
            );
          })}

          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm(t("Clear cart?", "تفريغ السلة؟"))) cart.clear();
              }}
              className="text-slate-500"
            >
              {t("Clear cart", "تفريغ السلة")}
            </Button>
          </div>
        </div>

        {/* Summary */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold mb-4">{t("Order Summary", "ملخص الطلب")}</h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">{t("Subtotal", "المجموع")}</span>
                <span className="font-medium">{formatPrice(subtotalCents)}</span>
              </div>
              {appliedDiscount ? (
                <div
                  className="flex justify-between"
                  style={{ color: storefront.brandColors.primary }}
                >
                  <span>
                    {t("Discount", "الخصم")} ({appliedDiscount.code})
                  </span>
                  <span className="font-medium">−{formatPrice(discountCents)}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-slate-600">
                  {t("Shipping (est.)", "الشحن (تقديري)")}
                </span>
                <span className="font-medium">
                  {shippingEstimateCents === 0 && shippingZone?.freeShippingMinCents && subtotalCents - discountCents >= shippingZone.freeShippingMinCents
                    ? t("Free", "مجاني")
                    : formatPrice(shippingEstimateCents)}
                </span>
              </div>
              <div className="border-t border-slate-100 pt-2 mt-2 flex justify-between">
                <span className="font-semibold">{t("Total", "الإجمالي")}</span>
                <span
                  className="font-bold text-lg"
                  style={{ color: storefront.brandColors.primary }}
                >
                  {formatPrice(totalEstimate)}
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <label className="text-xs font-medium text-slate-600 uppercase tracking-wide flex items-center gap-1">
                <Tag className="size-3" />
                {t("Discount code", "رمز الخصم")}
              </label>
              {appliedDiscount ? (
                <div
                  className="flex items-center justify-between rounded-md px-3 py-2 text-sm"
                  style={{
                    backgroundColor: storefront.brandColors.accent,
                    color: storefront.brandColors.primary,
                  }}
                >
                  <span className="font-medium">{appliedDiscount.code}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedDiscount(null);
                      setDiscountCode("");
                    }}
                    aria-label="Remove discount"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={discountCode}
                    onChange={(e) => setDiscountCode(e.target.value)}
                    placeholder={t("Enter code", "أدخل الرمز")}
                  />
                  <Button
                    variant="outline"
                    onClick={applyDiscount}
                    disabled={checking || discountCode.trim().length === 0}
                  >
                    {checking ? t("Checking…", "جارٍ التحقق…") : t("Apply", "تطبيق")}
                  </Button>
                </div>
              )}
              {discountError ? (
                <div className="text-xs text-red-600">{discountError}</div>
              ) : null}
            </div>

            <div className="mt-5 space-y-2">
              <Button
                asChild
                size="lg"
                className="w-full"
                style={{ backgroundColor: storefront.brandColors.primary, color: "white" }}
              >
                <Link
                  to={`/shop/${slug}/checkout${appliedDiscount ? `?code=${encodeURIComponent(appliedDiscount.code)}` : ""}`}
                >
                  {t("Proceed to Checkout", "متابعة للدفع")}
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link to={`/shop/${slug}/products`}>
                  {t("Continue Shopping", "متابعة التسوق")}
                </Link>
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
