import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { publicStorefrontApi } from "@/api/public-storefront";
import { useStorefront } from "./StorefrontLayout";
import { ProductCard } from "./ProductCard";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

type SortKey = "newest" | "price_asc" | "price_desc" | "name";

export function StorefrontProductsPage() {
  const { storefront, slug, isRtl, t } = useStorefront();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "";
  const sort = (searchParams.get("sort") as SortKey | null) ?? "newest";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const offset = (page - 1) * PAGE_SIZE;

  const [searchInput, setSearchInput] = useState(q);

  const productsQuery = useQuery({
    queryKey: ["public-storefront", slug, "products", { q, category, sort, page }],
    queryFn: () =>
      publicStorefrontApi.listProducts(slug, {
        q: q || undefined,
        category: category || undefined,
        sort,
        limit: PAGE_SIZE,
        offset,
      }),
    staleTime: 15_000,
  });

  const total = productsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value === null || value.length === 0) next.delete(key);
    else next.set(key, value);
    // Reset to page 1 when filters change
    if (key !== "page") next.delete("page");
    setSearchParams(next);
  }

  function submitSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setParam("q", searchInput.trim() || null);
  }

  const activeCategory = useMemo(
    () => storefront.categories.find((c) => c.slug === category),
    [storefront.categories, category],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold">
          {activeCategory
            ? (isRtl && activeCategory.nameAr ? activeCategory.nameAr : activeCategory.name)
            : t("All Products", "كل المنتجات")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {total === 0
            ? t("No products found.", "لم يتم العثور على منتجات.")
            : t(`${total} products`, `${total} منتج`)}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Filters sidebar */}
        <aside className="space-y-6">
          <form onSubmit={submitSearch} className="space-y-2">
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t("Search", "بحث")}
            </label>
            <div className="relative">
              <Search className="absolute top-1/2 -translate-y-1/2 size-4 text-slate-400 start-3" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("Search…", "ابحث…")}
                className="ps-9"
              />
            </div>
          </form>

          <div>
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide mb-2 block">
              {t("Categories", "الأقسام")}
            </label>
            <div className="flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap">
              <button
                type="button"
                onClick={() => setParam("category", null)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm text-start transition-colors",
                  category === ""
                    ? "text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700",
                )}
                style={
                  category === ""
                    ? { backgroundColor: storefront.brandColors.primary }
                    : undefined
                }
              >
                {t("All", "الكل")}
              </button>
              {storefront.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setParam("category", c.slug)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm text-start transition-colors",
                    category === c.slug
                      ? "text-white"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700",
                  )}
                  style={
                    category === c.slug
                      ? { backgroundColor: storefront.brandColors.primary }
                      : undefined
                  }
                >
                  {isRtl && c.nameAr ? c.nameAr : c.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide mb-2 block">
              {t("Sort by", "ترتيب حسب")}
            </label>
            <Select value={sort} onValueChange={(v) => setParam("sort", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t("Newest", "الأحدث")}</SelectItem>
                <SelectItem value="price_asc">
                  {t("Price: Low to High", "السعر: الأرخص أولاً")}
                </SelectItem>
                <SelectItem value="price_desc">
                  {t("Price: High to Low", "السعر: الأغلى أولاً")}
                </SelectItem>
                <SelectItem value="name">{t("Name", "الاسم")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </aside>

        {/* Product grid */}
        <div>
          {productsQuery.isLoading ? (
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[3/4] rounded-lg bg-slate-100 animate-pulse"
                />
              ))}
            </div>
          ) : productsQuery.data && productsQuery.data.products.length > 0 ? (
            <>
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                {productsQuery.data.products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>

              {totalPages > 1 ? (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setParam("page", String(page - 1))}
                  >
                    {isRtl ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                    {t("Previous", "السابق")}
                  </Button>
                  <div className="text-sm px-3 text-slate-600">
                    {t(`Page ${page} of ${totalPages}`, `صفحة ${page} من ${totalPages}`)}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setParam("page", String(page + 1))}
                  >
                    {t("Next", "التالي")}
                    {isRtl ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 p-16 text-center">
              <p className="text-slate-500 mb-4">
                {t("No products match your filters.", "لا توجد منتجات مطابقة لبحثك.")}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchInput("");
                  setSearchParams(new URLSearchParams());
                }}
              >
                {t("Clear filters", "مسح الفلاتر")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
