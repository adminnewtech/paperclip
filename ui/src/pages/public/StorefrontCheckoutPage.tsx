import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@/lib/router";
import { useSearchParams } from "react-router-dom";
import { CreditCard, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStorefront } from "./StorefrontLayout";
import { useCart } from "@/hooks/useCart";
import {
  publicStorefrontApi,
  type PublicDiscount,
  type ShippingAddress,
} from "@/api/public-storefront";
import { ApiError } from "@/api/client";

const GCC_COUNTRIES: Array<{ code: string; nameEn: string; nameAr: string }> = [
  { code: "KW", nameEn: "Kuwait", nameAr: "الكويت" },
  { code: "SA", nameEn: "Saudi Arabia", nameAr: "السعودية" },
  { code: "AE", nameEn: "UAE", nameAr: "الإمارات" },
  { code: "QA", nameEn: "Qatar", nameAr: "قطر" },
  { code: "BH", nameEn: "Bahrain", nameAr: "البحرين" },
  { code: "OM", nameEn: "Oman", nameAr: "عُمان" },
];

const PAYMENT_LABELS: Record<string, { en: string; ar: string }> = {
  knet: { en: "KNET", ar: "كي نت" },
  myfatoorah: { en: "MyFatoorah", ar: "ماي فاتورة" },
  card: { en: "Credit / Debit Card", ar: "بطاقة ائتمان أو خصم" },
  apple_pay: { en: "Apple Pay", ar: "آبل باي" },
  tabby: { en: "Tabby (Pay later)", ar: "تابي (ادفع لاحقاً)" },
  cod: { en: "Cash on Delivery", ar: "الدفع عند الاستلام" },
  cash: { en: "Cash", ar: "نقداً" },
};

interface FormState {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  block: string;
  street: string;
  avenue: string;
  building: string;
  floor: string;
  apartment: string;
  area: string;
  city: string;
  country: string;
  postalCode: string;
  paymentMethod: string;
  notes: string;
}

export function StorefrontCheckoutPage() {
  const { storefront, slug, lang, isRtl, formatPrice, t } = useStorefront();
  const cart = useCart(slug);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialDiscountCode = searchParams.get("code") ?? "";

  const [form, setForm] = useState<FormState>({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    block: "",
    street: "",
    avenue: "",
    building: "",
    floor: "",
    apartment: "",
    area: "",
    city: "",
    country: storefront.countryCode || "KW",
    postalCode: "",
    paymentMethod: storefront.paymentMethods[0] ?? "card",
    notes: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [discount, setDiscount] = useState<PublicDiscount | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Redirect to cart if empty (after mount so we don't flash a 404 during navigation)
  useEffect(() => {
    if (cart.items.length === 0) {
      navigate(`/shop/${slug}/cart`, { replace: true });
    }
  }, [cart.items.length, navigate, slug]);

  // Validate discount once on mount
  useEffect(() => {
    if (initialDiscountCode && cart.totalCents > 0) {
      publicStorefrontApi
        .checkDiscount(slug, initialDiscountCode, cart.totalCents)
        .then((r) => setDiscount(r.discount))
        .catch(() => setDiscount(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDiscountCode, slug]);

  const subtotalCents = cart.totalCents;
  const discountCents = discount?.computedDiscountCents ?? 0;
  const shippingZone =
    storefront.shippingZones.find((z) => z.countries.includes(form.country)) ??
    storefront.shippingZones[0];
  const shippingCents = shippingZone
    ? shippingZone.freeShippingMinCents && subtotalCents - discountCents >= shippingZone.freeShippingMinCents
      ? 0
      : shippingZone.flatRateCents
    : 0;
  const vatRate =
    form.country === "SA" || form.country === "BH"
      ? 15
      : form.country === "AE" || form.country === "OM"
        ? 5
        : 0;
  const vatCents = Math.round(
    (Math.max(0, subtotalCents - discountCents) * vatRate) / 100,
  );
  const totalCents = Math.max(0, subtotalCents - discountCents) + shippingCents + vatCents;

  const availablePaymentMethods = useMemo(
    () => (storefront.paymentMethods.length > 0 ? storefront.paymentMethods : ["card", "cod"]),
    [storefront.paymentMethods],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (form.customerName.trim().length < 2) {
      next.customerName = t("Please enter your name", "الرجاء إدخال الاسم");
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.customerEmail.trim())) {
      next.customerEmail = t("Valid email required", "الرجاء إدخال بريد إلكتروني صالح");
    }
    if (form.customerPhone.trim().length < 6) {
      next.customerPhone = t("Phone number required", "رقم الهاتف مطلوب");
    }
    if (form.country === "KW") {
      if (!form.block.trim()) next.block = t("Required", "مطلوب");
      if (!form.street.trim()) next.street = t("Required", "مطلوب");
      if (!form.building.trim()) next.building = t("Required", "مطلوب");
    } else if (form.area.trim().length === 0 && form.street.trim().length === 0) {
      next.area = t("Please provide an address", "الرجاء إدخال العنوان");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function placeOrder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);

    const shippingAddress: ShippingAddress = {
      country: form.country,
      block: form.block || undefined,
      street: form.street || undefined,
      avenue: form.avenue || undefined,
      building: form.building || undefined,
      floor: form.floor || undefined,
      apartment: form.apartment || undefined,
      area: form.area || undefined,
      city: form.city || undefined,
      postalCode: form.postalCode || undefined,
    };

    try {
      const result = await publicStorefrontApi.placeOrder(slug, {
        customerName: form.customerName.trim(),
        customerEmail: form.customerEmail.trim().toLowerCase(),
        customerPhone: form.customerPhone.trim(),
        shippingAddress,
        items: cart.items.map((i) => ({ productId: i.productId, qty: i.quantity })),
        discountCode: discount?.code ?? null,
        paymentMethod: form.paymentMethod,
        notes: form.notes.trim() || undefined,
        lang,
      });
      cart.clear();
      navigate(
        `/shop/${slug}/order/${result.order.id}?token=${encodeURIComponent(result.orderToken)}`,
        { replace: true },
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : t("Failed to place order. Please try again.", "تعذر إتمام الطلب. حاول مرة أخرى.");
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (cart.items.length === 0) {
    // useEffect already redirects; render nothing meanwhile.
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl md:text-3xl font-semibold mb-6">
        {t("Checkout", "إتمام الطلب")}
      </h1>

      <form onSubmit={placeOrder} className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Customer info */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold mb-4">
              {t("Contact Information", "معلومات التواصل")}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("Full Name", "الاسم الكامل")}
                error={errors.customerName}
                required
              >
                <Input
                  value={form.customerName}
                  onChange={(e) => update("customerName", e.target.value)}
                  autoComplete="name"
                />
              </Field>
              <Field
                label={t("Email", "البريد الإلكتروني")}
                error={errors.customerEmail}
                required
              >
                <Input
                  type="email"
                  value={form.customerEmail}
                  onChange={(e) => update("customerEmail", e.target.value)}
                  autoComplete="email"
                  dir="ltr"
                />
              </Field>
              <Field
                label={t("Phone", "الهاتف")}
                error={errors.customerPhone}
                required
              >
                <Input
                  type="tel"
                  value={form.customerPhone}
                  onChange={(e) => update("customerPhone", e.target.value)}
                  autoComplete="tel"
                  dir="ltr"
                />
              </Field>
            </div>
          </section>

          {/* Shipping address */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold mb-4">
              {t("Shipping Address", "عنوان الشحن")}
            </h2>

            <div className="mb-4">
              <Label className="mb-1 block text-xs uppercase tracking-wide text-slate-600">
                {t("Country", "الدولة")}
              </Label>
              <Select value={form.country} onValueChange={(v) => update("country", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GCC_COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {isRtl ? c.nameAr : c.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.country === "KW" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("Area", "المنطقة")}>
                  <Input
                    value={form.area}
                    onChange={(e) => update("area", e.target.value)}
                  />
                </Field>
                <Field label={t("Block", "قطعة")} error={errors.block} required>
                  <Input
                    value={form.block}
                    onChange={(e) => update("block", e.target.value)}
                  />
                </Field>
                <Field label={t("Street", "شارع")} error={errors.street} required>
                  <Input
                    value={form.street}
                    onChange={(e) => update("street", e.target.value)}
                  />
                </Field>
                <Field label={t("Avenue", "جادة")}>
                  <Input
                    value={form.avenue}
                    onChange={(e) => update("avenue", e.target.value)}
                  />
                </Field>
                <Field label={t("Building", "مبنى")} error={errors.building} required>
                  <Input
                    value={form.building}
                    onChange={(e) => update("building", e.target.value)}
                  />
                </Field>
                <Field label={t("Floor", "الدور")}>
                  <Input
                    value={form.floor}
                    onChange={(e) => update("floor", e.target.value)}
                  />
                </Field>
                <Field label={t("Apartment", "شقة")}>
                  <Input
                    value={form.apartment}
                    onChange={(e) => update("apartment", e.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("City", "المدينة")}>
                  <Input
                    value={form.city}
                    onChange={(e) => update("city", e.target.value)}
                  />
                </Field>
                <Field label={t("Area / District", "المنطقة / الحي")} error={errors.area}>
                  <Input
                    value={form.area}
                    onChange={(e) => update("area", e.target.value)}
                  />
                </Field>
                <Field label={t("Street", "الشارع")}>
                  <Input
                    value={form.street}
                    onChange={(e) => update("street", e.target.value)}
                  />
                </Field>
                <Field label={t("Building", "المبنى")}>
                  <Input
                    value={form.building}
                    onChange={(e) => update("building", e.target.value)}
                  />
                </Field>
                <Field label={t("Postal Code", "الرمز البريدي")}>
                  <Input
                    value={form.postalCode}
                    onChange={(e) => update("postalCode", e.target.value)}
                  />
                </Field>
              </div>
            )}
          </section>

          {/* Payment */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <CreditCard className="size-4" />
              {t("Payment Method", "طريقة الدفع")}
            </h2>
            <div className="grid gap-2">
              {availablePaymentMethods.map((method) => {
                const labels = PAYMENT_LABELS[method] ?? {
                  en: method,
                  ar: method,
                };
                const active = form.paymentMethod === method;
                return (
                  <label
                    key={method}
                    className="flex items-center gap-3 rounded-md border border-slate-200 px-4 py-3 cursor-pointer transition-colors"
                    style={
                      active
                        ? {
                            borderColor: storefront.brandColors.primary,
                            backgroundColor: storefront.brandColors.accent,
                          }
                        : undefined
                    }
                  >
                    <input
                      type="radio"
                      name="payment_method"
                      value={method}
                      checked={active}
                      onChange={() => update("paymentMethod", method)}
                      className="accent-current"
                      style={{ accentColor: storefront.brandColors.primary }}
                    />
                    <span className="text-sm font-medium">
                      {isRtl ? labels.ar : labels.en}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          {/* Notes */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <Label className="mb-2 block text-xs uppercase tracking-wide text-slate-600">
              {t("Order Notes (optional)", "ملاحظات على الطلب (اختياري)")}
            </Label>
            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-0"
              style={{
                ["--tw-ring-color" as never]: storefront.brandColors.primary,
              }}
              placeholder={t("Delivery instructions, gift message…", "تعليمات التوصيل، رسالة هدية…")}
            />
          </section>
        </div>

        {/* Summary */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5 lg:sticky lg:top-24">
            <h2 className="font-semibold mb-4">{t("Order Summary", "ملخص الطلب")}</h2>

            <div className="space-y-2.5 mb-4 max-h-[260px] overflow-y-auto">
              {cart.items.map((item) => {
                const name =
                  isRtl && item.productNameAr ? item.productNameAr : item.productName;
                return (
                  <div key={item.productId} className="flex justify-between gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="line-clamp-1">{name}</div>
                      <div className="text-xs text-slate-500">
                        × {item.quantity}
                      </div>
                    </div>
                    <div className="font-medium whitespace-nowrap">
                      {formatPrice(item.unitPriceCents * item.quantity)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">{t("Subtotal", "المجموع")}</span>
                <span>{formatPrice(subtotalCents)}</span>
              </div>
              {discount ? (
                <div
                  className="flex justify-between"
                  style={{ color: storefront.brandColors.primary }}
                >
                  <span>
                    {t("Discount", "الخصم")} ({discount.code})
                  </span>
                  <span>−{formatPrice(discountCents)}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-slate-600">{t("Shipping", "الشحن")}</span>
                <span>
                  {shippingCents === 0 ? t("Free", "مجاني") : formatPrice(shippingCents)}
                </span>
              </div>
              {vatRate > 0 ? (
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    {t(`VAT (${vatRate}%)`, `ضريبة القيمة المضافة (${vatRate}٪)`)}
                  </span>
                  <span>{formatPrice(vatCents)}</span>
                </div>
              ) : null}
              <div className="border-t border-slate-100 pt-2 mt-1 flex justify-between text-base">
                <span className="font-semibold">{t("Total", "الإجمالي")}</span>
                <span
                  className="font-bold"
                  style={{ color: storefront.brandColors.primary }}
                >
                  {formatPrice(totalCents)}
                </span>
              </div>
            </div>

            {submitError ? (
              <div className="mt-4 rounded-md bg-red-50 text-red-700 text-sm px-3 py-2">
                {submitError}
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              disabled={submitting}
              className="w-full mt-4"
              style={{ backgroundColor: storefront.brandColors.primary, color: "white" }}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Lock className="size-4" />
              )}
              {t("Place Order", "تأكيد الطلب")}
            </Button>
            <p className="mt-3 text-[11px] text-slate-500 text-center">
              {t(
                "By placing your order you agree to our terms.",
                "بإتمام الطلب فإنك توافق على الشروط.",
              )}
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1 block text-xs uppercase tracking-wide text-slate-600">
        {label}
        {required ? <span className="text-red-500 ms-0.5">*</span> : null}
      </Label>
      {children}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </div>
  );
}
