import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Public DTOs — fields safe to expose to anonymous customers. We deliberately
// avoid leaking costCents, ownerUserId, internal tags, createdByUserId, etc.
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
  /** Hint for UI; we do not expose the raw count. */
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
  /** Server-computed in fils/cents */
  computedDiscountCents?: number;
}

export interface PublicOrderItemInput {
  productId: string;
  qty: number;
}

export interface PublicOrderInput {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: {
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
  };
  items: PublicOrderItemInput[];
  discountCode?: string | null;
  paymentMethod: string;
  notes?: string;
  lang?: "ar" | "en";
}

export interface PublicOrderLine {
  productId: string;
  productName: string;
  productNameAr: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface PublicOrderSummary {
  id: string;
  code: string;
  status: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: PublicOrderInput["shippingAddress"];
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

// ---------------------------------------------------------------------------
// Storefront record (internal — contains companyId etc., used inside service)
// ---------------------------------------------------------------------------

interface StorefrontRow {
  id: string;
  companyId: string;
  name: string | null;
  status: string;
  currency: string | null;
  data: Record<string, unknown>;
}

interface ProductRow {
  id: string;
  name: string | null;
  code: string | null;
  status: string;
  amountCents: number | null;
  currency: string | null;
  data: Record<string, unknown>;
  tags: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function productSlug(row: ProductRow): string {
  const fromSku = asString(row.code);
  if (fromSku) return fromSku.toLowerCase();
  const fromData = asString((row.data as Record<string, unknown>)?.sku);
  if (fromData) return fromData.toLowerCase();
  return slugify(row.name ?? row.id);
}

function brandColorsFrom(data: Record<string, unknown>): {
  primary: string;
  secondary: string;
  accent: string;
} {
  const raw = data.brandColors as Record<string, unknown> | undefined;
  return {
    primary: asString(raw?.primary) ?? "#111827",
    secondary: asString(raw?.secondary) ?? "#6B7280",
    accent: asString(raw?.accent) ?? "#F3F4F6",
  };
}

function toPublicStorefront(
  row: StorefrontRow,
  categories: PublicCategory[],
  slug: string,
): PublicStorefront {
  const data = row.data ?? {};
  const shippingZones = Array.isArray((data as { shippingZones?: unknown }).shippingZones)
    ? ((data as { shippingZones: PublicStorefront["shippingZones"] }).shippingZones)
    : [];
  return {
    id: row.id,
    slug,
    name: row.name ?? asString((data as { name?: unknown }).name) ?? "Store",
    nameAr: asString((data as { nameAr?: unknown }).nameAr),
    tagline: asString((data as { tagline?: unknown }).tagline),
    taglineAr: asString((data as { taglineAr?: unknown }).taglineAr),
    description: asString((data as { description?: unknown }).description),
    descriptionAr: asString((data as { descriptionAr?: unknown }).descriptionAr),
    brandColors: brandColorsFrom(data),
    theme: asString((data as { theme?: unknown }).theme) ?? "minimal",
    currency: row.currency ?? "USD",
    countryCode: asString((data as { countryCode?: unknown }).countryCode) ?? "KW",
    aboutContent: asString((data as { aboutContent?: unknown }).aboutContent),
    aboutContentAr: asString((data as { aboutContentAr?: unknown }).aboutContentAr),
    paymentMethods: asStringArray((data as { paymentMethods?: unknown }).paymentMethods),
    shippingZones,
    categories,
  };
}

function publicTags(tags: unknown): string[] {
  const all = asStringArray(tags);
  // Hide tags that smell internal
  return all.filter(
    (t) =>
      !t.startsWith("internal") &&
      !t.startsWith("private") &&
      !t.startsWith("hidden"),
  );
}

function inStockFor(row: ProductRow): { inStock: boolean; level: PublicProduct["stockLevel"] } {
  const data = row.data ?? {};
  const trackInventory = asString((data as { trackInventory?: unknown }).trackInventory);
  const backorderable = (data as { backorderable?: unknown }).backorderable === true;
  const initial = asNumber((data as { initialStock?: unknown }).initialStock);
  const current = asNumber((data as { stockLevel?: unknown }).stockLevel) ?? initial;
  if (row.status !== "active") return { inStock: false, level: "out" };
  if (trackInventory && trackInventory !== "yes") return { inStock: true, level: "high" };
  if (backorderable) return { inStock: true, level: "low" };
  if (current === null) return { inStock: true, level: "high" };
  if (current <= 0) return { inStock: false, level: "out" };
  if (current < 5) return { inStock: true, level: "low" };
  return { inStock: true, level: "high" };
}

function toPublicProduct(row: ProductRow): PublicProduct {
  const data = row.data ?? {};
  const stock = inStockFor(row);
  const images = Array.isArray((data as { images?: unknown }).images)
    ? asStringArray((data as { images: unknown }).images)
    : [];
  const imageUrl = asString((data as { imageUrl?: unknown }).imageUrl) ?? images[0] ?? null;
  return {
    id: row.id,
    name: row.name ?? "Product",
    nameAr: asString((data as { nameAr?: unknown }).nameAr),
    description: asString((data as { description?: unknown }).description),
    descriptionAr: asString((data as { descriptionAr?: unknown }).descriptionAr),
    priceCents: asNumber((data as { priceCents?: unknown }).priceCents) ?? row.amountCents ?? 0,
    currency: row.currency,
    category: asString((data as { category?: unknown }).category),
    sku: row.code,
    imageUrl,
    images,
    inStock: stock.inStock,
    stockLevel: stock.level,
    slug: productSlug(row),
  };
}

function publicCategoryFrom(row: {
  id: string;
  name: string | null;
  code: string | null;
  data: Record<string, unknown>;
}): PublicCategory {
  const data = row.data ?? {};
  return {
    id: row.id,
    name: row.name ?? "Category",
    nameAr: asString((data as { nameAr?: unknown }).nameAr),
    slug: row.code ?? slugify(row.name ?? row.id),
  };
}

function computeDiscountCents(
  discount: { type: string; value: number },
  subtotalCents: number,
): number {
  if (discount.type === "percentage") {
    return Math.min(
      subtotalCents,
      Math.max(0, Math.round((subtotalCents * discount.value) / 100)),
    );
  }
  // "fixed" is interpreted as minor units (cents/fils)
  return Math.min(subtotalCents, Math.max(0, Math.round(discount.value)));
}

function generateOrderToken(): string {
  return randomBytes(24).toString("base64url");
}

function generateOrderCode(): string {
  const year = new Date().getFullYear();
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `ORD-${year}-${rand}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface StorefrontPublicService {
  getStorefrontBySlug(slug: string): Promise<{
    storefront: PublicStorefront;
    internal: StorefrontRow;
  } | null>;
  listProducts(input: {
    slug: string;
    q?: string;
    category?: string;
    sort?: "newest" | "price_asc" | "price_desc" | "name";
    limit?: number;
    offset?: number;
  }): Promise<{
    storefront: PublicStorefront;
    products: PublicProduct[];
    total: number;
  } | null>;
  getProduct(slug: string, productSlug: string): Promise<{
    storefront: PublicStorefront;
    product: PublicProduct;
    related: PublicProduct[];
  } | null>;
  listCategories(slug: string): Promise<PublicCategory[] | null>;
  checkDiscount(input: {
    slug: string;
    code: string;
    subtotalCents: number;
  }): Promise<PublicDiscount | null>;
  placeOrder(slug: string, input: PublicOrderInput): Promise<{
    order: PublicOrderSummary;
    orderToken: string;
  } | null>;
  getOrder(slug: string, orderId: string, token: string): Promise<PublicOrderSummary | null>;
  lookupCustomer(slug: string, input: { email?: string; phone?: string }): Promise<{
    orders: Array<{
      id: string;
      code: string;
      createdAt: string;
      totalCents: number;
      currency: string;
      status: string;
      paymentStatus: string;
      fulfillmentStatus: string;
    }>;
  } | null>;
}

export function createStorefrontPublicService(db: Db): StorefrontPublicService {
  async function loadStorefrontRow(slug: string): Promise<StorefrontRow | null> {
    if (!slug || slug.length === 0) return null;
    const normalized = slug.toLowerCase();
    // We look up by data.slug (set by builder) OR by code OR by slugified name.
    const rows = await db
      .select({
        id: businessEntities.id,
        companyId: businessEntities.companyId,
        name: businessEntities.name,
        status: businessEntities.status,
        currency: businessEntities.currency,
        data: businessEntities.data,
        code: businessEntities.code,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.moduleKey, "ecommerce"),
          eq(businessEntities.entityType, "storefront"),
          or(
            sql`lower(${businessEntities.code}) = ${normalized}`,
            sql`lower(${businessEntities.data}->>'slug') = ${normalized}`,
          ),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.status !== "active") return null;
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      status: row.status,
      currency: row.currency,
      data: (row.data as Record<string, unknown>) ?? {},
    };
  }

  async function loadCategories(storefrontId: string, companyId: string): Promise<PublicCategory[]> {
    const rows = await db
      .select({
        id: businessEntities.id,
        name: businessEntities.name,
        code: businessEntities.code,
        data: businessEntities.data,
        status: businessEntities.status,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, "ecommerce"),
          eq(businessEntities.entityType, "category"),
          eq(businessEntities.parentId, storefrontId),
        ),
      )
      .orderBy(asc(businessEntities.name));
    return rows
      .filter((r) => r.status === "active")
      .map((r) => publicCategoryFrom({
        id: r.id,
        name: r.name,
        code: r.code,
        data: (r.data as Record<string, unknown>) ?? {},
      }));
  }

  async function getStorefrontBySlug(slug: string): ReturnType<StorefrontPublicService["getStorefrontBySlug"]> {
    const row = await loadStorefrontRow(slug);
    if (!row) return null;
    const categories = await loadCategories(row.id, row.companyId);
    return {
      storefront: toPublicStorefront(row, categories, slug.toLowerCase()),
      internal: row,
    };
  }

  async function listProducts(input: Parameters<StorefrontPublicService["listProducts"]>[0]) {
    const sf = await getStorefrontBySlug(input.slug);
    if (!sf) return null;

    const conditions = [
      eq(businessEntities.companyId, sf.internal.companyId),
      eq(businessEntities.moduleKey, "inventory"),
      eq(businessEntities.entityType, "product"),
      eq(businessEntities.parentId, sf.internal.id),
      eq(businessEntities.status, "active"),
    ];
    if (input.q && input.q.length > 0) {
      conditions.push(ilike(businessEntities.name, `%${input.q.trim()}%`));
    }
    if (input.category && input.category.length > 0) {
      conditions.push(sql`${businessEntities.data}->>'category' = ${input.category}`);
    }

    const orderClause =
      input.sort === "price_asc"
        ? asc(businessEntities.amountCents)
        : input.sort === "price_desc"
          ? desc(businessEntities.amountCents)
          : input.sort === "name"
            ? asc(businessEntities.name)
            : desc(businessEntities.updatedAt);

    const limit = Math.min(Math.max(input.limit ?? 24, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);

    const [productRows, countRows] = await Promise.all([
      db
        .select({
          id: businessEntities.id,
          name: businessEntities.name,
          code: businessEntities.code,
          status: businessEntities.status,
          amountCents: businessEntities.amountCents,
          currency: businessEntities.currency,
          data: businessEntities.data,
          tags: businessEntities.tags,
        })
        .from(businessEntities)
        .where(and(...conditions))
        .orderBy(orderClause)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(businessEntities)
        .where(and(...conditions)),
    ]);

    const products = productRows
      .map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        status: row.status,
        amountCents: row.amountCents,
        currency: row.currency ?? sf.internal.currency,
        data: (row.data as Record<string, unknown>) ?? {},
        tags: row.tags,
      }))
      .filter((row) => publicTags(row.tags).every((t) => t !== "draft"))
      .map(toPublicProduct);

    return {
      storefront: sf.storefront,
      products,
      total: Number(countRows[0]?.count ?? 0),
    };
  }

  async function getProduct(slug: string, productSlugInput: string) {
    const sf = await getStorefrontBySlug(slug);
    if (!sf) return null;
    const target = productSlugInput.toLowerCase();
    const rows = await db
      .select({
        id: businessEntities.id,
        name: businessEntities.name,
        code: businessEntities.code,
        status: businessEntities.status,
        amountCents: businessEntities.amountCents,
        currency: businessEntities.currency,
        data: businessEntities.data,
        tags: businessEntities.tags,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, sf.internal.companyId),
          eq(businessEntities.moduleKey, "inventory"),
          eq(businessEntities.entityType, "product"),
          eq(businessEntities.parentId, sf.internal.id),
          eq(businessEntities.status, "active"),
          or(
            sql`lower(${businessEntities.code}) = ${target}`,
            sql`lower(${businessEntities.id}::text) = ${target}`,
          ),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const product = toPublicProduct({
      id: row.id,
      name: row.name,
      code: row.code,
      status: row.status,
      amountCents: row.amountCents,
      currency: row.currency ?? sf.internal.currency,
      data: (row.data as Record<string, unknown>) ?? {},
      tags: row.tags,
    });

    let related: PublicProduct[] = [];
    if (product.category) {
      const relatedRows = await db
        .select({
          id: businessEntities.id,
          name: businessEntities.name,
          code: businessEntities.code,
          status: businessEntities.status,
          amountCents: businessEntities.amountCents,
          currency: businessEntities.currency,
          data: businessEntities.data,
          tags: businessEntities.tags,
        })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, sf.internal.companyId),
            eq(businessEntities.moduleKey, "inventory"),
            eq(businessEntities.entityType, "product"),
            eq(businessEntities.parentId, sf.internal.id),
            eq(businessEntities.status, "active"),
            sql`${businessEntities.data}->>'category' = ${product.category}`,
            sql`${businessEntities.id} <> ${product.id}`,
          ),
        )
        .limit(4);
      related = relatedRows.map((r) =>
        toPublicProduct({
          id: r.id,
          name: r.name,
          code: r.code,
          status: r.status,
          amountCents: r.amountCents,
          currency: r.currency ?? sf.internal.currency,
          data: (r.data as Record<string, unknown>) ?? {},
          tags: r.tags,
        }),
      );
    }
    return { storefront: sf.storefront, product, related };
  }

  async function listCategories(slug: string): Promise<PublicCategory[] | null> {
    const sf = await getStorefrontBySlug(slug);
    if (!sf) return null;
    return sf.storefront.categories;
  }

  async function checkDiscount(input: {
    slug: string;
    code: string;
    subtotalCents: number;
  }): Promise<PublicDiscount | null> {
    const sf = await getStorefrontBySlug(input.slug);
    if (!sf) return null;
    const codeNormalized = input.code.trim().toUpperCase();
    if (codeNormalized.length === 0) return null;
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, sf.internal.companyId),
          eq(businessEntities.moduleKey, "ecommerce"),
          eq(businessEntities.entityType, "discount"),
          eq(businessEntities.parentId, sf.internal.id),
          eq(businessEntities.status, "active"),
          sql`upper(${businessEntities.code}) = ${codeNormalized}`,
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const data = (row.data as Record<string, unknown>) ?? {};
    const validUntil = asString(data.validUntil);
    if (validUntil) {
      const expiry = new Date(validUntil);
      if (Number.isFinite(expiry.getTime()) && expiry.getTime() < Date.now()) {
        return null;
      }
    }
    const kind = asString(data.kind);
    const type: "percentage" | "fixed" = kind === "fixed" ? "fixed" : "percentage";
    const value = asNumber(data.value) ?? 0;
    const discountCents = computeDiscountCents({ type, value }, input.subtotalCents);
    return {
      code: row.code ?? codeNormalized,
      type,
      value,
      description: asString(data.description),
      descriptionAr: asString(data.descriptionAr),
      computedDiscountCents: discountCents,
    };
  }

  function computeShippingCents(
    storefront: PublicStorefront,
    countryCode: string,
    subtotalCents: number,
  ): number {
    const zones = storefront.shippingZones ?? [];
    for (const zone of zones) {
      if (zone.countries.includes(countryCode)) {
        if (zone.freeShippingMinCents && subtotalCents >= zone.freeShippingMinCents) {
          return 0;
        }
        return zone.flatRateCents;
      }
    }
    // Default fallback
    return zones[0]?.flatRateCents ?? 0;
  }

  async function placeOrder(
    slug: string,
    input: PublicOrderInput,
  ): Promise<{ order: PublicOrderSummary; orderToken: string } | null> {
    const sf = await getStorefrontBySlug(slug);
    if (!sf) return null;
    if (input.items.length === 0) return null;

    // Re-fetch products to get authoritative prices server-side (NEVER trust client prices)
    const productIds = Array.from(new Set(input.items.map((i) => i.productId)));
    const productRows = await db
      .select({
        id: businessEntities.id,
        name: businessEntities.name,
        code: businessEntities.code,
        status: businessEntities.status,
        amountCents: businessEntities.amountCents,
        currency: businessEntities.currency,
        data: businessEntities.data,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, sf.internal.companyId),
          eq(businessEntities.moduleKey, "inventory"),
          eq(businessEntities.entityType, "product"),
          eq(businessEntities.parentId, sf.internal.id),
          eq(businessEntities.status, "active"),
          inArray(businessEntities.id, productIds),
        ),
      );
    if (productRows.length === 0) return null;

    const productMap = new Map(productRows.map((r) => [r.id, r]));
    const lines: PublicOrderLine[] = [];
    let subtotalCents = 0;
    for (const item of input.items) {
      const row = productMap.get(item.productId);
      if (!row) continue;
      const data = (row.data as Record<string, unknown>) ?? {};
      const unitPriceCents = asNumber((data as { priceCents?: unknown }).priceCents) ?? row.amountCents ?? 0;
      const qty = Math.max(1, Math.min(Math.round(item.qty), 999));
      const lineTotal = unitPriceCents * qty;
      subtotalCents += lineTotal;
      lines.push({
        productId: row.id,
        productName: row.name ?? "Product",
        productNameAr: asString((data as { nameAr?: unknown }).nameAr),
        quantity: qty,
        unitPriceCents,
        lineTotalCents: lineTotal,
      });
    }
    if (lines.length === 0) return null;

    let discountCents = 0;
    let discountCode: string | null = null;
    if (input.discountCode && input.discountCode.trim().length > 0) {
      const checked = await checkDiscount({
        slug,
        code: input.discountCode.trim(),
        subtotalCents,
      });
      if (checked) {
        discountCents = checked.computedDiscountCents ?? 0;
        discountCode = checked.code;
      }
    }

    const countryCode = input.shippingAddress.country || sf.storefront.countryCode;
    const shippingCents = computeShippingCents(sf.storefront, countryCode, subtotalCents);
    // VAT placeholder — kept at 0 for KW (no VAT). Tweak per country if needed.
    const vatRate = countryCode === "SA" || countryCode === "BH" ? 15 : countryCode === "AE" || countryCode === "OM" ? 5 : 0;
    const taxableBase = Math.max(0, subtotalCents - discountCents);
    const vatCents = Math.round((taxableBase * vatRate) / 100);
    const totalCents = Math.max(0, taxableBase + shippingCents + vatCents);

    const code = generateOrderCode();
    const orderToken = generateOrderToken();
    const now = new Date();
    const currency = sf.storefront.currency;

    const [row] = await db
      .insert(businessEntities)
      .values({
        companyId: sf.internal.companyId,
        moduleKey: "ecommerce",
        entityType: "online_order",
        parentId: sf.internal.id,
        code,
        name: `${input.customerName} — ${code}`,
        status: "pending",
        amountCents: totalCents,
        currency,
        data: {
          customerName: input.customerName,
          customerEmail: input.customerEmail.toLowerCase().trim(),
          customerPhone: input.customerPhone.trim(),
          shippingAddress: input.shippingAddress,
          items: lines,
          discountCode,
          discountCents,
          subtotalCents,
          shippingCents,
          vatCents,
          totalCents,
          paymentMethod: input.paymentMethod,
          paymentStatus: "unpaid",
          fulfillmentStatus: "unfulfilled",
          notes: input.notes ?? null,
          orderToken,
          lang: input.lang ?? "ar",
          source: "storefront_public",
        },
        tags: ["storefront"],
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) return null;

    return {
      order: {
        id: row.id,
        code,
        status: row.status,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        shippingAddress: input.shippingAddress,
        items: lines,
        subtotalCents,
        shippingCents,
        discountCents,
        vatCents,
        totalCents,
        currency,
        paymentMethod: input.paymentMethod,
        paymentStatus: "unpaid",
        fulfillmentStatus: "unfulfilled",
        discountCode,
        createdAt: row.createdAt.toISOString(),
      },
      orderToken,
    };
  }

  async function getOrder(
    slug: string,
    orderId: string,
    token: string,
  ): Promise<PublicOrderSummary | null> {
    if (!token || token.length < 8) return null;
    const sf = await getStorefrontBySlug(slug);
    if (!sf) return null;
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, orderId),
          eq(businessEntities.companyId, sf.internal.companyId),
          eq(businessEntities.moduleKey, "ecommerce"),
          eq(businessEntities.entityType, "online_order"),
          eq(businessEntities.parentId, sf.internal.id),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const data = (row.data as Record<string, unknown>) ?? {};
    const storedToken = asString((data as { orderToken?: unknown }).orderToken);
    if (!storedToken || storedToken !== token) return null;

    const items = Array.isArray((data as { items?: unknown }).items)
      ? ((data as { items: PublicOrderLine[] }).items)
      : [];

    return {
      id: row.id,
      code: row.code ?? "",
      status: row.status,
      customerName: asString((data as { customerName?: unknown }).customerName) ?? "",
      customerEmail: asString((data as { customerEmail?: unknown }).customerEmail) ?? "",
      customerPhone: asString((data as { customerPhone?: unknown }).customerPhone) ?? "",
      shippingAddress:
        ((data as { shippingAddress?: unknown }).shippingAddress as PublicOrderSummary["shippingAddress"]) ?? {
          country: sf.storefront.countryCode,
        },
      items,
      subtotalCents: asNumber((data as { subtotalCents?: unknown }).subtotalCents) ?? 0,
      shippingCents: asNumber((data as { shippingCents?: unknown }).shippingCents) ?? 0,
      discountCents: asNumber((data as { discountCents?: unknown }).discountCents) ?? 0,
      vatCents: asNumber((data as { vatCents?: unknown }).vatCents) ?? 0,
      totalCents: row.amountCents ?? asNumber((data as { totalCents?: unknown }).totalCents) ?? 0,
      currency: row.currency ?? sf.storefront.currency,
      paymentMethod: asString((data as { paymentMethod?: unknown }).paymentMethod) ?? "",
      paymentStatus: asString((data as { paymentStatus?: unknown }).paymentStatus) ?? "unpaid",
      fulfillmentStatus: asString((data as { fulfillmentStatus?: unknown }).fulfillmentStatus) ?? "unfulfilled",
      discountCode: asString((data as { discountCode?: unknown }).discountCode),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async function lookupCustomer(
    slug: string,
    input: { email?: string; phone?: string },
  ): Promise<{
    orders: Array<{
      id: string;
      code: string;
      createdAt: string;
      totalCents: number;
      currency: string;
      status: string;
      paymentStatus: string;
      fulfillmentStatus: string;
    }>;
  } | null> {
    const sf = await getStorefrontBySlug(slug);
    if (!sf) return null;
    const email = input.email?.toLowerCase().trim();
    const phone = input.phone?.trim();
    if (!email && !phone) return { orders: [] };

    const conditions = [
      eq(businessEntities.companyId, sf.internal.companyId),
      eq(businessEntities.moduleKey, "ecommerce"),
      eq(businessEntities.entityType, "online_order"),
      eq(businessEntities.parentId, sf.internal.id),
    ];
    const matchers = [];
    if (email) matchers.push(sql`lower(${businessEntities.data}->>'customerEmail') = ${email}`);
    if (phone) matchers.push(sql`${businessEntities.data}->>'customerPhone' = ${phone}`);
    if (matchers.length === 0) return { orders: [] };

    const rows = await db
      .select()
      .from(businessEntities)
      .where(and(...conditions, or(...matchers)))
      .orderBy(desc(businessEntities.createdAt))
      .limit(50);

    return {
      orders: rows.map((row) => {
        const data = (row.data as Record<string, unknown>) ?? {};
        return {
          id: row.id,
          code: row.code ?? "",
          createdAt: row.createdAt.toISOString(),
          totalCents: row.amountCents ?? 0,
          currency: row.currency ?? sf.storefront.currency,
          status: row.status,
          paymentStatus: asString((data as { paymentStatus?: unknown }).paymentStatus) ?? "unpaid",
          fulfillmentStatus: asString((data as { fulfillmentStatus?: unknown }).fulfillmentStatus) ?? "unfulfilled",
        };
      }),
    };
  }

  return {
    getStorefrontBySlug,
    listProducts,
    getProduct,
    listCategories,
    checkDiscount,
    placeOrder,
    getOrder,
    lookupCustomer,
  };
}
