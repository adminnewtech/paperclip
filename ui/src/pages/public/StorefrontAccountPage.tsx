import { useState } from "react";
import { Link } from "@/lib/router";
import { Mail, Phone, Search, Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  publicStorefrontApi,
  type CustomerOrderSummary,
} from "@/api/public-storefront";
import { ApiError } from "@/api/client";
import { useStorefront } from "./StorefrontLayout";

export function StorefrontAccountPage() {
  const { storefront, slug, isRtl, formatPrice, t } = useStorefront();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [orders, setOrders] = useState<CustomerOrderSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function lookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim() && !phone.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await publicStorefrontApi.lookupCustomer(slug, {
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setOrders(result.orders);
      setSearched(true);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : t("Lookup failed", "تعذر البحث");
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl md:text-3xl font-semibold mb-2">
        {t("My Orders", "طلباتي")}
      </h1>
      <p className="text-slate-500 text-sm mb-6">
        {t(
          "Enter the email or phone you used at checkout to view your orders.",
          "أدخل البريد أو الهاتف الذي استخدمته عند الدفع لعرض طلباتك.",
        )}
      </p>

      <form
        onSubmit={lookup}
        className="rounded-lg border border-slate-200 bg-white p-5 mb-6 space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1 block text-xs uppercase tracking-wide text-slate-600 flex items-center gap-1">
              <Mail className="size-3" />
              {t("Email", "البريد الإلكتروني")}
            </Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs uppercase tracking-wide text-slate-600 flex items-center gap-1">
              <Phone className="size-3" />
              {t("Phone", "الهاتف")}
            </Label>
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              placeholder="+965…"
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={loading || (!email.trim() && !phone.trim())}
          style={{ backgroundColor: storefront.brandColors.primary, color: "white" }}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          {t("Find My Orders", "ابحث عن طلباتي")}
        </Button>
        {error ? (
          <div className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
        ) : null}
      </form>

      {searched ? (
        orders && orders.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">
              {t(`${orders.length} order(s)`, `${orders.length} طلب`)}
            </h2>
            {orders.map((order) => (
              <div
                key={order.id}
                className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-4"
              >
                <div
                  className="size-10 flex items-center justify-center rounded-md text-white"
                  style={{ backgroundColor: storefront.brandColors.primary }}
                >
                  <Package className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{order.code}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(order.createdAt).toLocaleDateString(
                      isRtl ? "ar-KW" : "en-KW",
                    )}
                  </div>
                </div>
                <div className="text-sm text-slate-600">
                  <span className="me-2">{t("Status:", "الحالة:")}</span>
                  <span className="font-medium">{order.status}</span>
                </div>
                <div
                  className="font-semibold"
                  style={{ color: storefront.brandColors.primary }}
                >
                  {formatPrice(order.totalCents)}
                </div>
              </div>
            ))}
            <p className="text-xs text-slate-500 mt-2">
              {t(
                "To view full order details, use the tracking link emailed to you when you placed each order.",
                "لعرض تفاصيل الطلب، استخدم رابط التتبع المرسل إلى بريدك عند إنشاء الطلب.",
              )}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
            {t(
              "No orders found for that contact info.",
              "لم يتم العثور على طلبات لهذا الحساب.",
            )}
            <div className="mt-3">
              <Button asChild variant="outline" size="sm">
                <Link to={`/shop/${slug}/products`}>
                  {t("Start Shopping", "ابدأ التسوق")}
                </Link>
              </Button>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
