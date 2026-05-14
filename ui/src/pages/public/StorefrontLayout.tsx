import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useParams } from "react-router-dom";
import { Link, useNavigate } from "@/lib/router";
import { ShoppingCart, Search, Globe, Store, Menu, X } from "lucide-react";
import { publicStorefrontApi, type PublicStorefront } from "@/api/public-storefront";
import { useCart } from "@/hooks/useCart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Context — exposes storefront + language + cart helpers to nested pages
// ---------------------------------------------------------------------------

export type StorefrontLang = "ar" | "en";

interface StorefrontContextValue {
  slug: string;
  storefront: PublicStorefront;
  lang: StorefrontLang;
  isRtl: boolean;
  setLang: (lang: StorefrontLang) => void;
  formatPrice: (cents: number | null | undefined) => string;
  t: (en: string, ar: string) => string;
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export function useStorefront(): StorefrontContextValue {
  const ctx = useContext(StorefrontContext);
  if (!ctx) {
    throw new Error("useStorefront must be used inside a StorefrontLayout");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LANG_STORAGE_KEY = "paperclip:storefront:lang";

function readSavedLang(): StorefrontLang {
  if (typeof window === "undefined") return "ar";
  const raw = window.localStorage.getItem(LANG_STORAGE_KEY);
  if (raw === "ar" || raw === "en") return raw;
  return "ar";
}

function formatCurrencyCents(cents: number, currency: string, lang: StorefrontLang): string {
  // GCC currencies are 3-decimal except where they aren't (SAR/AED/QAR are 2).
  const decimals = currency === "KWD" || currency === "BHD" || currency === "OMR" ? 3 : 2;
  const value = cents / 10 ** decimals;
  try {
    return new Intl.NumberFormat(lang === "ar" ? "ar-KW" : "en-KW", {
      style: "currency",
      currency,
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${value.toFixed(decimals)} ${currency}`;
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function StorefrontLayout() {
  const { storefrontSlug } = useParams<{ storefrontSlug: string }>();
  const slug = (storefrontSlug ?? "").toLowerCase();
  const [lang, setLangState] = useState<StorefrontLang>(() => readSavedLang());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");

  const setLang = (next: StorefrontLang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      /* noop */
    }
  };

  const query = useQuery({
    queryKey: ["public-storefront", slug],
    queryFn: () => publicStorefrontApi.getStorefront(slug),
    enabled: slug.length > 0,
    staleTime: 60_000,
  });

  const { itemCount } = useCart(slug);
  const isRtl = lang === "ar";

  // Apply RTL direction at the document level for the whole storefront layout
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const prevDir = html.getAttribute("dir");
    const prevLang = html.getAttribute("lang");
    html.setAttribute("dir", isRtl ? "rtl" : "ltr");
    html.setAttribute("lang", lang);
    return () => {
      if (prevDir) html.setAttribute("dir", prevDir);
      else html.removeAttribute("dir");
      if (prevLang) html.setAttribute("lang", prevLang);
      else html.removeAttribute("lang");
    };
  }, [isRtl, lang]);

  // Apply brand colors as CSS variables on the wrapping section
  const brandStyle = useMemo<React.CSSProperties>(() => {
    const colors = query.data?.storefront.brandColors;
    if (!colors) return {};
    return {
      // Inline custom properties — referenced by inline style for safety
      ["--sf-primary" as never]: colors.primary,
      ["--sf-secondary" as never]: colors.secondary,
      ["--sf-accent" as never]: colors.accent,
    };
  }, [query.data]);

  if (slug.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold mb-2">Storefront not found</h1>
          <p className="text-muted-foreground">No storefront slug provided.</p>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold mb-2">
            {isRtl ? "المتجر غير متاح" : "Store unavailable"}
          </h1>
          <p className="text-muted-foreground">
            {isRtl
              ? "تعذر العثور على هذا المتجر. الرجاء التحقق من الرابط."
              : "We couldn't find that storefront. Please check the link."}
          </p>
        </div>
      </div>
    );
  }

  const storefront = query.data.storefront;
  const displayName = isRtl && storefront.nameAr ? storefront.nameAr : storefront.name;
  const tagline = isRtl && storefront.taglineAr ? storefront.taglineAr : storefront.tagline;

  const ctxValue: StorefrontContextValue = {
    slug,
    storefront,
    lang,
    isRtl,
    setLang,
    formatPrice: (cents) => formatCurrencyCents(Number(cents ?? 0), storefront.currency, lang),
    t: (en, ar) => (isRtl ? ar : en),
  };

  function submitSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = searchValue.trim();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    navigate(`/shop/${slug}/products${params.toString() ? `?${params.toString()}` : ""}`);
    setMobileNavOpen(false);
  }

  return (
    <StorefrontContext.Provider value={ctxValue}>
      <div
        className="min-h-screen bg-white text-slate-900 flex flex-col"
        style={brandStyle}
        dir={isRtl ? "rtl" : "ltr"}
        lang={lang}
      >
        {/* Top promo bar */}
        <div
          className="text-center text-xs py-1.5"
          style={{ backgroundColor: storefront.brandColors.primary, color: "white" }}
        >
          {tagline ?? displayName}
        </div>

        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              className="lg:hidden p-2 -ms-2 text-slate-700"
              aria-label="Toggle menu"
            >
              {mobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>

            <Link
              to={`/shop/${slug}`}
              className="flex items-center gap-2 font-semibold text-lg"
              style={{ color: storefront.brandColors.primary }}
            >
              <Store className="size-5" />
              <span>{displayName}</span>
            </Link>

            <nav className="hidden lg:flex items-center gap-5 ms-6 text-sm">
              <Link to={`/shop/${slug}`} className="hover:opacity-70">
                {ctxValue.t("Home", "الرئيسية")}
              </Link>
              <Link to={`/shop/${slug}/products`} className="hover:opacity-70">
                {ctxValue.t("All Products", "كل المنتجات")}
              </Link>
              {storefront.categories.slice(0, 4).map((c) => (
                <Link
                  key={c.id}
                  to={`/shop/${slug}/products?category=${encodeURIComponent(c.slug)}`}
                  className="hover:opacity-70"
                >
                  {isRtl && c.nameAr ? c.nameAr : c.name}
                </Link>
              ))}
            </nav>

            <form onSubmit={submitSearch} className="hidden md:flex flex-1 max-w-md ms-auto">
              <div className="relative w-full">
                <Search className="absolute top-1/2 -translate-y-1/2 size-4 text-slate-400 start-3" />
                <Input
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder={ctxValue.t("Search products…", "ابحث عن منتج…")}
                  className="ps-9"
                />
              </div>
            </form>

            <button
              type="button"
              onClick={() => setLang(isRtl ? "en" : "ar")}
              className="hidden sm:inline-flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-slate-100"
              aria-label="Toggle language"
            >
              <Globe className="size-4" />
              <span>{isRtl ? "EN" : "ع"}</span>
            </button>

            <Link
              to={`/shop/${slug}/cart`}
              className="relative inline-flex items-center justify-center size-10 rounded hover:bg-slate-100"
              aria-label="Cart"
            >
              <ShoppingCart className="size-5" />
              {itemCount > 0 ? (
                <span
                  className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center text-white"
                  style={{ backgroundColor: storefront.brandColors.primary }}
                >
                  {itemCount > 99 ? "99+" : itemCount}
                </span>
              ) : null}
            </Link>
          </div>

          {/* Mobile menu */}
          {mobileNavOpen ? (
            <div className="lg:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-2">
              <form onSubmit={submitSearch} className="mb-3">
                <Input
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder={ctxValue.t("Search products…", "ابحث عن منتج…")}
                />
              </form>
              <Link
                to={`/shop/${slug}`}
                onClick={() => setMobileNavOpen(false)}
                className="block py-2 text-sm"
              >
                {ctxValue.t("Home", "الرئيسية")}
              </Link>
              <Link
                to={`/shop/${slug}/products`}
                onClick={() => setMobileNavOpen(false)}
                className="block py-2 text-sm"
              >
                {ctxValue.t("All Products", "كل المنتجات")}
              </Link>
              {storefront.categories.map((c) => (
                <Link
                  key={c.id}
                  to={`/shop/${slug}/products?category=${encodeURIComponent(c.slug)}`}
                  onClick={() => setMobileNavOpen(false)}
                  className="block py-2 text-sm"
                >
                  {isRtl && c.nameAr ? c.nameAr : c.name}
                </Link>
              ))}
              <Link
                to={`/shop/${slug}/account`}
                onClick={() => setMobileNavOpen(false)}
                className="block py-2 text-sm"
              >
                {ctxValue.t("My Orders", "طلباتي")}
              </Link>
              <button
                onClick={() => {
                  setLang(isRtl ? "en" : "ar");
                  setMobileNavOpen(false);
                }}
                className="block py-2 text-sm w-full text-start"
              >
                {ctxValue.t("العربية", "English")}
              </button>
            </div>
          ) : null}
        </header>

        {/* Main content */}
        <main className="flex-1">
          <Outlet />
        </main>

        {/* Footer */}
        <footer
          className="mt-12 border-t border-slate-200 py-10"
          style={{ backgroundColor: storefront.brandColors.accent }}
        >
          <div className="mx-auto max-w-7xl px-4 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div
                className="font-semibold text-lg mb-2"
                style={{ color: storefront.brandColors.primary }}
              >
                {displayName}
              </div>
              <p className="text-sm text-slate-600">
                {(isRtl ? storefront.descriptionAr : storefront.description) ?? ""}
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-sm">
                {ctxValue.t("Shop", "تسوق")}
              </h3>
              <ul className="space-y-1.5 text-sm text-slate-600">
                <li>
                  <Link to={`/shop/${slug}/products`} className="hover:underline">
                    {ctxValue.t("All Products", "كل المنتجات")}
                  </Link>
                </li>
                {storefront.categories.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/shop/${slug}/products?category=${encodeURIComponent(c.slug)}`}
                      className="hover:underline"
                    >
                      {isRtl && c.nameAr ? c.nameAr : c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-sm">
                {ctxValue.t("Customer", "خدمة العملاء")}
              </h3>
              <ul className="space-y-1.5 text-sm text-slate-600">
                <li>
                  <Link to={`/shop/${slug}/account`} className="hover:underline">
                    {ctxValue.t("My Orders", "طلباتي")}
                  </Link>
                </li>
                <li>
                  <Link to={`/shop/${slug}/cart`} className="hover:underline">
                    {ctxValue.t("Cart", "السلة")}
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-sm">
                {ctxValue.t("Language", "اللغة")}
              </h3>
              <div className="flex gap-2">
                <Button
                  variant={isRtl ? "outline" : "default"}
                  size="sm"
                  onClick={() => setLang("en")}
                  className={cn(!isRtl && "shadow-sm")}
                  style={!isRtl ? { backgroundColor: storefront.brandColors.primary, color: "white" } : undefined}
                >
                  English
                </Button>
                <Button
                  variant={isRtl ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLang("ar")}
                  style={isRtl ? { backgroundColor: storefront.brandColors.primary, color: "white" } : undefined}
                >
                  العربية
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-8 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} {displayName}.{" "}
            {ctxValue.t("All rights reserved.", "جميع الحقوق محفوظة.")}
          </div>
        </footer>
      </div>
    </StorefrontContext.Provider>
  );
}
