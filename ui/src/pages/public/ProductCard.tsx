import { Link } from "@/lib/router";
import { ImageIcon, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicProduct } from "@/api/public-storefront";
import { useStorefront } from "./StorefrontLayout";
import { useCart } from "@/hooks/useCart";

interface ProductCardProps {
  product: PublicProduct;
  compact?: boolean;
}

export function ProductCard({ product, compact = false }: ProductCardProps) {
  const { slug, storefront, isRtl, formatPrice, t } = useStorefront();
  const cart = useCart(slug);

  const displayName = isRtl && product.nameAr ? product.nameAr : product.name;
  const href = `/shop/${slug}/product/${encodeURIComponent(product.slug)}`;

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    cart.addItem({
      productId: product.id,
      productName: product.name,
      productNameAr: product.nameAr ?? undefined,
      unitPriceCents: product.priceCents,
      quantity: 1,
      imageUrl: product.imageUrl ?? undefined,
      currency: product.currency ?? storefront.currency,
    });
  }

  return (
    <Link
      to={href}
      className="group flex flex-col rounded-lg border border-slate-200 bg-white overflow-hidden hover:shadow-md transition-shadow"
    >
      <div
        className="relative aspect-square overflow-hidden"
        style={{ backgroundColor: storefront.brandColors.accent }}
      >
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={displayName}
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            <ImageIcon className="size-10" />
          </div>
        )}
        {!product.inStock ? (
          <div className="absolute top-2 start-2 rounded-md bg-slate-900/80 px-2 py-0.5 text-[10px] font-semibold text-white">
            {t("Out of stock", "نفذ المخزون")}
          </div>
        ) : product.stockLevel === "low" ? (
          <div className="absolute top-2 start-2 rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">
            {t("Low stock", "كمية محدودة")}
          </div>
        ) : null}
      </div>
      <div className="flex-1 flex flex-col p-3">
        <h3 className="font-medium text-sm line-clamp-2 mb-1">{displayName}</h3>
        {!compact && product.category ? (
          <div className="text-[11px] text-slate-500 mb-2 uppercase tracking-wide">
            {product.category}
          </div>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div
            className="font-semibold text-base"
            style={{ color: storefront.brandColors.primary }}
          >
            {formatPrice(product.priceCents)}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!product.inStock}
            onClick={handleAdd}
            className="border-slate-300"
            aria-label={t("Add to cart", "أضف للسلة")}
          >
            <ShoppingBag className="size-3.5" />
            <span className="hidden sm:inline">{t("Add", "أضف")}</span>
          </Button>
        </div>
      </div>
    </Link>
  );
}
