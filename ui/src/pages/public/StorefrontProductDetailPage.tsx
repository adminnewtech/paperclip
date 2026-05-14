import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Link, useNavigate } from "@/lib/router";
import {
  Minus,
  Plus,
  ShoppingBag,
  ImageIcon,
  ChevronLeft,
  CheckCircle2,
  PackageCheck,
} from "lucide-react";
import { publicStorefrontApi } from "@/api/public-storefront";
import { Button } from "@/components/ui/button";
import { useStorefront } from "./StorefrontLayout";
import { ProductCard } from "./ProductCard";
import { useCart } from "@/hooks/useCart";

export function StorefrontProductDetailPage() {
  const { storefront, slug, isRtl, formatPrice, t } = useStorefront();
  const { productSlug } = useParams<{ productSlug: string }>();
  const cart = useCart(slug);
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);
  const [addedNotice, setAddedNotice] = useState(false);

  const query = useQuery({
    queryKey: ["public-storefront", slug, "product", productSlug ?? ""],
    queryFn: () => publicStorefrontApi.getProduct(slug, productSlug ?? ""),
    enabled: Boolean(productSlug),
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="aspect-square bg-slate-100 rounded-lg animate-pulse" />
          <div className="space-y-4">
            <div className="h-8 bg-slate-100 rounded animate-pulse w-3/4" />
            <div className="h-4 bg-slate-100 rounded animate-pulse w-1/2" />
            <div className="h-24 bg-slate-100 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold mb-2">
          {t("Product not found", "المنتج غير موجود")}
        </h1>
        <p className="text-slate-500 mb-6">
          {t(
            "We couldn't find that product. It may be out of stock or removed.",
            "تعذر العثور على هذا المنتج. قد يكون نفذ من المخزون أو تم إزالته.",
          )}
        </p>
        <Button asChild>
          <Link to={`/shop/${slug}/products`}>
            {t("Browse all products", "تصفح جميع المنتجات")}
          </Link>
        </Button>
      </div>
    );
  }

  const product = query.data.product;
  const related = query.data.related ?? [];
  const displayName = isRtl && product.nameAr ? product.nameAr : product.name;
  const displayDescription =
    isRtl && product.descriptionAr ? product.descriptionAr : product.description;

  function addToCart() {
    cart.addItem({
      productId: product.id,
      productName: product.name,
      productNameAr: product.nameAr ?? undefined,
      unitPriceCents: product.priceCents,
      quantity,
      imageUrl: product.imageUrl ?? undefined,
      currency: product.currency ?? storefront.currency,
    });
    setAddedNotice(true);
    window.setTimeout(() => setAddedNotice(false), 2500);
  }

  function buyNow() {
    cart.addItem({
      productId: product.id,
      productName: product.name,
      productNameAr: product.nameAr ?? undefined,
      unitPriceCents: product.priceCents,
      quantity,
      imageUrl: product.imageUrl ?? undefined,
      currency: product.currency ?? storefront.currency,
    });
    navigate(`/shop/${slug}/checkout`);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="text-sm mb-4">
        <Link to={`/shop/${slug}/products`} className="text-slate-500 hover:underline inline-flex items-center gap-1">
          {isRtl ? null : <ChevronLeft className="size-4" />}
          {t("Back to products", "العودة للمنتجات")}
          {isRtl ? <ChevronLeft className="size-4 rotate-180" /> : null}
        </Link>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Image */}
        <div
          className="relative aspect-square overflow-hidden rounded-lg"
          style={{ backgroundColor: storefront.brandColors.accent }}
        >
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={displayName}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-slate-300">
              <ImageIcon className="size-24" />
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="flex flex-col">
          {product.category ? (
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              {product.category}
            </div>
          ) : null}
          <h1 className="text-3xl font-semibold mb-3">{displayName}</h1>
          <div
            className="text-3xl font-bold mb-4"
            style={{ color: storefront.brandColors.primary }}
          >
            {formatPrice(product.priceCents)}
          </div>

          {/* Stock indicator */}
          <div className="mb-6">
            {!product.inStock ? (
              <div className="inline-flex items-center gap-1.5 text-sm text-slate-600 bg-slate-100 px-3 py-1.5 rounded-md">
                {t("Out of stock", "نفذ المخزون")}
              </div>
            ) : product.stockLevel === "low" ? (
              <div className="inline-flex items-center gap-1.5 text-sm text-amber-700 bg-amber-50 px-3 py-1.5 rounded-md">
                <PackageCheck className="size-4" />
                {t("Only a few left", "كمية محدودة متاحة")}
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded-md">
                <CheckCircle2 className="size-4" />
                {t("In stock", "متوفر")}
              </div>
            )}
          </div>

          {displayDescription ? (
            <p className="text-slate-700 leading-relaxed mb-6 whitespace-pre-wrap">
              {displayDescription}
            </p>
          ) : null}

          {/* Quantity + add */}
          {product.inStock ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium">
                  {t("Quantity", "الكمية")}
                </label>
                <div className="inline-flex items-center border border-slate-200 rounded-md">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="size-9 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50"
                    disabled={quantity <= 1}
                    aria-label="Decrease"
                  >
                    <Minus className="size-4" />
                  </button>
                  <div className="size-9 flex items-center justify-center font-medium text-sm border-x border-slate-200">
                    {quantity}
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                    className="size-9 flex items-center justify-center hover:bg-slate-50"
                    aria-label="Increase"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  size="lg"
                  onClick={addToCart}
                  style={{ backgroundColor: storefront.brandColors.primary, color: "white" }}
                  className="flex-1 min-w-[160px]"
                >
                  <ShoppingBag className="size-4" />
                  {t("Add to Cart", "أضف للسلة")}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={buyNow}
                  className="flex-1 min-w-[160px] border-slate-300"
                >
                  {t("Buy Now", "اشتري الآن")}
                </Button>
              </div>
              {addedNotice ? (
                <div className="rounded-md bg-green-50 text-green-800 px-3 py-2 text-sm inline-flex items-center gap-2">
                  <CheckCircle2 className="size-4" />
                  {t("Added to cart!", "أضيف للسلة!")}
                </div>
              ) : null}
            </div>
          ) : (
            <Button size="lg" disabled className="w-fit">
              {t("Out of stock", "نفذ المخزون")}
            </Button>
          )}
        </div>
      </div>

      {/* Related products */}
      {related.length > 0 ? (
        <section className="mt-16">
          <h2 className="text-xl font-semibold mb-4">
            {t("You may also like", "قد يعجبك أيضاً")}
          </h2>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} compact />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
