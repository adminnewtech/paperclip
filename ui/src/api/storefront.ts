import { api } from "./client";

export interface StoreRow {
  id: string;
  companyId: string;
  name: string;
  slug: string | null;
  domain: string | null;
  theme: Record<string, unknown>;
  currency: string;
  status: string;
  seo: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionRow {
  id: string;
  companyId: string;
  name: string;
  slug: string | null;
  description: string | null;
  productIds: string[];
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelRow {
  id: string;
  companyId: string;
  name: string;
  kind: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelListingRow {
  id: string;
  companyId: string;
  channelId: string;
  productId: string | null;
  variantId: string | null;
  listed: boolean;
  priceOverrideMinor: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscountRow {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  kind: string | null;
  valueBps: number;
  valueMinor: number;
  minOrderMinor: number;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingZoneRow {
  id: string;
  companyId: string;
  name: string;
  countries: string[];
  areas: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ShippingRateRow {
  id: string;
  companyId: string;
  zoneId: string;
  name: string;
  priceMinor: number;
  minOrderFreeMinor: number | null;
  estDays: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OnlineOrderLine {
  variantId: string;
  qty: number;
  unitPriceMinor: number;
}

export interface OnlineOrderRow {
  id: string;
  companyId: string;
  number: string | null;
  customerName: string | null;
  customerEmail: string | null;
  lines: OnlineOrderLine[];
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  status: string;
  channel: string;
  shippingAddress: Record<string, unknown>;
  discountCode: string | null;
  journalEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FulfillmentRow {
  id: string;
  companyId: string;
  onlineOrderId: string;
  warehouseId: string | null;
  status: string;
  tracking: string | null;
  carrier: string | null;
  shippedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoreCreateInput {
  name: string;
  slug?: string | null;
  domain?: string | null;
  theme?: Record<string, unknown>;
  currency?: string;
  status?: string;
  seo?: Record<string, unknown>;
}

export interface StoreUpdateInput {
  name?: string;
  slug?: string | null;
  domain?: string | null;
  theme?: Record<string, unknown>;
  currency?: string;
  status?: string;
  seo?: Record<string, unknown>;
}

export interface CollectionCreateInput {
  name: string;
  slug?: string | null;
  description?: string | null;
  productIds?: string[];
  imageUrl?: string | null;
}

export interface ChannelCreateInput {
  name: string;
  kind?: "online" | "pos" | "marketplace" | "social";
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface ListingCreateInput {
  channelId: string;
  productId?: string | null;
  variantId?: string | null;
  listed?: boolean;
  priceOverrideMinor?: number | null;
}

export interface DiscountCreateInput {
  code?: string | null;
  name: string;
  kind: "percentage" | "fixed" | "free_shipping";
  valueBps?: number;
  valueMinor?: number;
  minOrderMinor?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  status?: string;
}

export interface ShippingZoneCreateInput {
  name: string;
  countries?: string[];
  areas?: string[];
}

export interface ShippingRateCreateInput {
  zoneId: string;
  name: string;
  priceMinor?: number;
  minOrderFreeMinor?: number | null;
  estDays?: string | null;
}

export const storefrontApi = {
  // Stores
  listStores: (companyId: string) =>
    api.get<{ stores: StoreRow[] }>(`/companies/${companyId}/stores`),
  createStore: (companyId: string, body: StoreCreateInput) =>
    api.post<StoreRow>(`/companies/${companyId}/stores`, body),
  updateStore: (id: string, body: StoreUpdateInput) =>
    api.put<StoreRow>(`/stores/${id}`, body),

  // Collections
  listCollections: (companyId: string) =>
    api.get<{ collections: CollectionRow[] }>(
      `/companies/${companyId}/collections`,
    ),
  createCollection: (companyId: string, body: CollectionCreateInput) =>
    api.post<CollectionRow>(`/companies/${companyId}/collections`, body),

  // Channels
  listChannels: (companyId: string) =>
    api.get<{ channels: ChannelRow[] }>(`/companies/${companyId}/channels`),
  createChannel: (companyId: string, body: ChannelCreateInput) =>
    api.post<ChannelRow>(`/companies/${companyId}/channels`, body),
  listListings: (companyId: string, channelId?: string) => {
    const params = new URLSearchParams();
    if (channelId) params.set("channelId", channelId);
    const qs = params.toString();
    return api.get<{ listings: ChannelListingRow[] }>(
      `/companies/${companyId}/channel-listings${qs ? `?${qs}` : ""}`,
    );
  },
  createListing: (companyId: string, body: ListingCreateInput) =>
    api.post<ChannelListingRow>(
      `/companies/${companyId}/channel-listings`,
      body,
    ),

  // Discounts
  listDiscounts: (companyId: string) =>
    api.get<{ discounts: DiscountRow[] }>(`/companies/${companyId}/discounts`),
  createDiscount: (companyId: string, body: DiscountCreateInput) =>
    api.post<DiscountRow>(`/companies/${companyId}/discounts`, body),

  // Shipping
  listShippingZones: (companyId: string) =>
    api.get<{ shippingZones: ShippingZoneRow[] }>(
      `/companies/${companyId}/shipping-zones`,
    ),
  createShippingZone: (companyId: string, body: ShippingZoneCreateInput) =>
    api.post<ShippingZoneRow>(`/companies/${companyId}/shipping-zones`, body),
  listShippingRates: (companyId: string, zoneId?: string) => {
    const params = new URLSearchParams();
    if (zoneId) params.set("zoneId", zoneId);
    const qs = params.toString();
    return api.get<{ shippingRates: ShippingRateRow[] }>(
      `/companies/${companyId}/shipping-rates${qs ? `?${qs}` : ""}`,
    );
  },
  createShippingRate: (companyId: string, body: ShippingRateCreateInput) =>
    api.post<ShippingRateRow>(`/companies/${companyId}/shipping-rates`, body),

  // Online orders
  listOnlineOrders: (companyId: string) =>
    api.get<{ onlineOrders: OnlineOrderRow[] }>(
      `/companies/${companyId}/online-orders`,
    ),
  fulfillOrder: (id: string, body: { warehouseId?: string } = {}) =>
    api.post<FulfillmentRow>(`/online-orders/${id}/fulfill`, body),
};
