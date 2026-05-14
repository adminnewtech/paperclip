import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Sparkles, ShoppingBag, Truck, ShieldCheck } from "lucide-react";
import { publicStorefrontApi, type PublicProduct } from "@/api/public-storefront";
import { Button } from "@/components/ui/button";
import { useStorefront } from "./StorefrontLayout";
import { ProductCard } from "./ProductCard";

export function StorefrontHomePage() {
  const { storefront, slug, lang, isRtl, t } = useStorefront();

  const featuredQuery = useQuery({
    queryKey: ["public-storefront", slug, "products", "featured"],
    queryFn: () => publicStorefrontApi.listProducts(slug, { limit: 8, sort: "newest" }),
    staleTime: 30_000,
  });

  const heroName = isRtl && storefront.nameAr ? storefront.nameAr : storefront.name;
  const heroTagline =
    isRtl && storefront.taglineAr ? storefront.taglineAr : storefront.tagline;
  const description =
    isRtl && storefront.descriptionAr ? storefront.descriptionAr : storefront.description;
  const aboutContent =
    isRtl && storefront.aboutContentAr
      ? storefront.aboutContentAr
      : storefront.aboutContent;

  const products: PublicProduct[] = featuredQuery.data?.products ?? [];

  return (
    <div className="space-y-12 pb-12">
      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${storefront.brandColors.primary} 0%, ${storefront.brandColors.secondary} 100%)`,
        }}
      >
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-32 -end-32 size-96 rounded-full bg-white" />
          <div className="absolute -bottom-32 -start-32 size-96 rounded-full bg-white" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-16 md:py-24 text-white">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur mb-4">
              <Sparkles className="size-3.5" />
              <span>{t("New arrivals every week", "وصل حديثاً كل أسبوع")}</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-tight">{heroName}</h1>
            {heroTagline ? (
              <p className="text-xl md:text-2xl mb-6 opacity-90">{heroTagline}</p>
            ) : null}
            {description ? (
              <p className="text-base md:text-lg opacity-80 mb-8 max-w-xl">{description}</p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="border-0"
                style={{ backgroundColor: "white", color: storefront.brandColors.primary }}
              >
                <Link to={`/shop/${slug}/products`}>
                  {t("Shop Now", "تسوق الآن")}
                </Link>
              </Button>
              {storefront.categories.length > 0 ? (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white text-white hover:bg-white/10 hover:text-white"
                >
                  <Link
                    to={`/shop/${slug}/products?category=${encodeURIComponent(
                      storefront.categories[0]!.slug,
                    )}`}
                  >
                    {t("Browse Categories", "تصفح الأقسام")}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto max-w-7xl px-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: <Truck className="size-5" />,
              title: t("Fast Delivery", "توصيل سريع"),
              desc: t("Same-day in major cities", "في نفس اليوم لمعظم المدن"),
            },
            {
              icon: <ShieldCheck className="size-5" />,
              title: t("Secure Payments", "دفع آمن"),
              desc: t("KNET, cards & wallets", "كي نت وبطاقات ومحافظ"),
            },
            {
              icon: <ShoppingBag className="size-5" />,
              title: t("Easy Returns", "إرجاع سهل"),
              desc: t("14-day satisfaction guarantee", "ضمان رضا ١٤ يوم"),
            },
          ].map((v, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-slate-200 p-4"
            >
              <div
                className="flex-shrink-0 size-10 rounded-md flex items-center justify-center text-white"
                style={{ backgroundColor: storefront.brandColors.primary }}
              >
                {v.icon}
              </div>
              <div>
                <div className="font-semibold text-sm">{v.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{v.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Category grid */}
      {storefront.categories.length > 0 ? (
        <section className="mx-auto max-w-7xl px-4">
          <div className="flex items-end justify-between mb-4">
            <h2 className="text-2xl font-semibold">
              {t("Shop by Category", "تسوق حسب القسم")}
            </h2>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {storefront.categories.map((c, i) => {
              const palette = [
                storefront.brandColors.primary,
                storefront.brandColors.secondary,
              ];
              const bg = palette[i % palette.length]!;
              return (
                <Link
                  key={c.id}
                  to={`/shop/${slug}/products?category=${encodeURIComponent(c.slug)}`}
                  className="group relative aspect-square overflow-hidden rounded-lg transition-shadow hover:shadow-lg"
                  style={{ backgroundColor: bg }}
                >
                  <div className="absolute inset-0 flex items-end justify-start p-4 text-white">
                    <span className="font-semibold text-sm md:text-base">
                      {isRtl && c.nameAr ? c.nameAr : c.name}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Featured products */}
      <section className="mx-auto max-w-7xl px-4">
        <div className="flex items-end justify-between mb-4">
          <h2 className="text-2xl font-semibold">
            {t("Featured Products", "منتجات مميزة")}
          </h2>
          <Link
            to={`/shop/${slug}/products`}
            className="text-sm hover:underline"
            style={{ color: storefront.brandColors.primary }}
          >
            {t("View all →", "عرض الكل ←")}
          </Link>
        </div>
        {featuredQuery.isLoading ? (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/4] rounded-lg bg-slate-100 animate-pulse"
              />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-12 text-center text-sm text-slate-500">
            {t("No products yet — check back soon!", "لا توجد منتجات بعد — تابعنا قريباً!")}
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* About */}
      {aboutContent ? (
        <section className="mx-auto max-w-3xl px-4">
          <div
            className="rounded-2xl p-8 md:p-12 text-center"
            style={{ backgroundColor: storefront.brandColors.accent }}
          >
            <h2
              className="text-2xl font-semibold mb-4"
              style={{ color: storefront.brandColors.primary }}
            >
              {t("Our Story", "قصتنا")}
            </h2>
            <p
              className="text-base leading-relaxed text-slate-700"
              lang={lang}
            >
              {aboutContent}
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
