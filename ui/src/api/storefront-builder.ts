import { api } from "./client";

export type StorefrontTheme =
  | "minimal"
  | "classic"
  | "modern"
  | "luxury"
  | "bold";

export type StorefrontCurrency =
  | "KWD"
  | "SAR"
  | "AED"
  | "QAR"
  | "BHD"
  | "OMR";

export interface StorefrontPlanProduct {
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  sku: string;
  priceCents: number;
  costCents: number;
  category: string;
  tags: string[];
  initialStock: number;
}

export interface StorefrontPlanCategory {
  name: string;
  nameAr: string;
  slug: string;
}

export interface StorefrontPlanDiscount {
  code: string;
  type: "percentage" | "fixed";
  value: number;
  description: string;
  descriptionAr: string;
  usageLimit?: number;
  expiresInDays?: number;
}

export interface StorefrontPlanCampaign {
  name: string;
  nameAr: string;
  channel: "email" | "sms" | "social" | "ads";
  description: string;
  budgetCents: number;
}

export interface StorefrontPlanShippingZone {
  name: string;
  countries: string[];
  flatRateCents: number;
  freeShippingMinCents?: number;
}

export interface StorefrontPlan {
  storefront: {
    name: string;
    nameAr: string;
    tagline: string;
    taglineAr: string;
    description: string;
    descriptionAr: string;
    suggestedDomain: string;
    brandColors: { primary: string; secondary: string; accent: string };
    theme: StorefrontTheme;
    currency: StorefrontCurrency;
    countryCode: string;
    aboutContent: string;
    aboutContentAr: string;
  };
  products: StorefrontPlanProduct[];
  categories: StorefrontPlanCategory[];
  discounts: StorefrontPlanDiscount[];
  campaigns: StorefrontPlanCampaign[];
  shippingZones: StorefrontPlanShippingZone[];
  paymentMethods: string[];
  mock?: boolean;
  industry?: string;
}

export interface StorefrontBuilderInput {
  description: string;
  industry?: string;
  targetCountry?: string;
  budget?: "lean" | "standard" | "premium";
  lang?: "ar" | "en";
}

export interface ApplyPlanResult {
  storefrontId: string;
  productIds: string[];
  categoryIds: string[];
  discountIds: string[];
  campaignIds: string[];
}

export const storefrontBuilderApi = {
  generate: (companyId: string, input: StorefrontBuilderInput) =>
    api.post<{ plan: StorefrontPlan }>(
      `/companies/${companyId}/business/storefront-builder/generate`,
      input,
    ),

  apply: (companyId: string, plan: StorefrontPlan) =>
    api.post<{ result: ApplyPlanResult }>(
      `/companies/${companyId}/business/storefront-builder/apply`,
      { plan },
    ),

  generateAndApply: (companyId: string, input: StorefrontBuilderInput) =>
    api.post<{ plan: StorefrontPlan; result: ApplyPlanResult }>(
      `/companies/${companyId}/business/storefront-builder/generate-and-apply`,
      input,
    ),
};
