import { ApiError } from "./client";

// The public-storefront endpoints live OUTSIDE the auth-protected /api router
// (under /api/public/...), so we use a tailored fetch helper rather than the
// shared `api` client to avoid sending credentials and to give clearer errors.

const BASE = "/api/public";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  const body = init?.body;
  if (!(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, {
    headers,
    // Public endpoints — do not send cookies. Customers are anonymous.
    credentials: "omit",
    ...init,
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new ApiError(
      (errorBody as { error?: string } | null)?.error ?? `Request failed: ${res.status}`,
      res.status,
      errorBody,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types — mirror server DTOs
// ---------------------------------------------------------------------------

export interface PublicCategory {
  id: string;
  name: string;
  nameAr: string | null;
  slug: string;
}

export interface PublicProduct {
  id: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  priceCents: number;
  currency: string | null;
  category: string | null;
  sku: string | null;
  imageUrl: string | null;
  images: string[];
  inStock: boolean;
  stockLevel: "high" | "low" | "out";
  slug: string;
}

export interface PublicStorefront {
  id: string;
  slug: string;
  name: string;
  nameAr: string | null;
  tagline: string | null;
  taglineAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  brandColors: { primary: string; secondary: string; accent: string };
  theme: string;
  currency: string;
  countryCode: string;
  aboutContent: string | null;
  aboutContentAr: string | null;
  paymentMethods: string[];
  shippingZones: Array<{
    name: string;
    countries: string[];
    flatRateCents: number;
    freeShippingMinCents?: number;
  }>;
  categories: PublicCategory[];
}

export interface PublicDiscount {
  code: string;
  type: "percentage" | "fixed";
  value: number;
  description: string | null;
  descriptionAr: string | null;
  computedDiscountCents?: number;
}

export interface PublicOrderLine {
  productId: string;
  productName: string;
  productNameAr: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface ShippingAddress {
  line1?: string;
  line2?: string;
  block?: string;
  street?: string;
  avenue?: string;
  building?: string;
  floor?: string;
  apartment?: string;
  city?: string;
  area?: string;
  country: string;
  postalCode?: string;
}

export interface PublicOrderSummary {
  id: string;
  code: string;
  status: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: ShippingAddress;
  items: PublicOrderLine[];
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  vatCents: number;
  totalCents: number;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  discountCode: string | null;
  createdAt: string;
}

export interface PlaceOrderInput {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: ShippingAddress;
  items: Array<{ productId: string; qty: number }>;
  discountCode?: string | null;
  paymentMethod: string;
  notes?: string;
  lang?: "ar" | "en";
}

export interface CustomerOrderSummary {
  id: string;
  code: string;
  createdAt: string;
  totalCents: number;
  currency: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const publicStorefrontApi = {
  getStorefront: (slug: string) =>
    request<{ storefront: PublicStorefront }>(`/storefronts/${encodeURIComponent(slug)}`),

  listCategories: (slug: string) =>
    request<{ categories: PublicCategory[] }>(
      `/storefronts/${encodeURIComponent(slug)}/categories`,
    ),

  listProducts: (
    slug: string,
    opts: {
      q?: string;
      category?: string;
      sort?: "newest" | "price_asc" | "price_desc" | "name";
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    if (opts.category) params.set("category", opts.category);
    if (opts.sort) params.set("sort", opts.sort);
    if (typeof opts.limit === "number") params.set("limit", String(opts.limit));
    if (typeof opts.offset === "number") params.set("offset", String(opts.offset));
    const qs = params.toString();
    return request<{
      storefront: PublicStorefront;
      products: PublicProduct[];
      total: number;
    }>(`/storefronts/${encodeURIComponent(slug)}/products${qs ? `?${qs}` : ""}`);
  },

  getProduct: (slug: string, productSlug: string) =>
    request<{
      storefront: PublicStorefront;
      product: PublicProduct;
      related: PublicProduct[];
    }>(
      `/storefronts/${encodeURIComponent(slug)}/products/${encodeURIComponent(productSlug)}`,
    ),

  checkDiscount: (slug: string, code: string, subtotalCents: number) =>
    request<{ discount: PublicDiscount }>(
      `/storefronts/${encodeURIComponent(slug)}/check-discount`,
      {
        method: "POST",
        body: JSON.stringify({ code, subtotalCents }),
      },
    ),

  placeOrder: (slug: string, input: PlaceOrderInput) =>
    request<{ order: PublicOrderSummary; orderToken: string }>(
      `/storefronts/${encodeURIComponent(slug)}/orders`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),

  getOrder: (slug: string, orderId: string, token: string) =>
    request<{ order: PublicOrderSummary }>(
      `/storefronts/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`,
    ),

  lookupCustomer: (slug: string, input: { email?: string; phone?: string }) =>
    request<{ orders: CustomerOrderSummary[] }>(
      `/storefronts/${encodeURIComponent(slug)}/customer/lookup`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
};
