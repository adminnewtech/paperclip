import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities, businessModules } from "@paperclipai/db";
import {
  GCC_CURRENCIES,
  GCC_COUNTRIES,
  DEFAULT_COUNTRY,
  type GccCurrency,
  type GccCountryCode,
  isGccCountryCode,
  isGccCurrency,
} from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// LLM abstraction (mirrors business-ai-service.ts)
// ---------------------------------------------------------------------------

interface LLMClient {
  complete(input: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string>;
}

let cachedClient: LLMClient | null | undefined;

async function getLLMClient(): Promise<LLMClient | null> {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    cachedClient = null;
    return null;
  }
  try {
    const pkg = "@anthropic-ai/sdk";
    const mod = (await (
      Function("p", "return import(p)") as (p: string) => Promise<unknown>
    )(pkg).catch(() => null)) as
      | { default?: new (opts: { apiKey: string }) => unknown }
      | null;
    if (!mod || !mod.default) {
      cachedClient = null;
      return null;
    }
    const AnthropicCtor = mod.default;
    const instance = new AnthropicCtor({ apiKey }) as {
      messages: {
        create(args: {
          model: string;
          max_tokens: number;
          temperature?: number;
          system?: string;
          messages: Array<{ role: "user"; content: string }>;
        }): Promise<{
          content: Array<{ type: string; text?: string }>;
        }>;
      };
    };
    cachedClient = {
      async complete({ system, user, maxTokens = 4096, temperature = 0.5 }) {
        const response = await instance.messages.create({
          model: "claude-3-5-sonnet-latest",
          max_tokens: maxTokens,
          temperature,
          system,
          messages: [{ role: "user", content: user }],
        });
        const parts = response.content
          .map((p) => (p.type === "text" && p.text ? p.text : ""))
          .filter(Boolean);
        return parts.join("\n").trim();
      },
    };
    return cachedClient;
  } catch {
    cachedClient = null;
    return null;
  }
}

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number },
): Promise<{ text: string; mock: false } | { text: null; mock: true }> {
  const client = await getLLMClient();
  if (!client) return { text: null, mock: true };
  try {
    const text = await client.complete({
      system: systemPrompt,
      user: userPrompt,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
    });
    return { text, mock: false };
  } catch {
    return { text: null, mock: true };
  }
}

function tryParseJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  try {
    return JSON.parse(raw.trim()) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    theme: "minimal" | "classic" | "modern" | "luxury" | "bold";
    currency: GccCurrency;
    countryCode: string;
    aboutContent: string;
    aboutContentAr: string;
  };
  products: Array<{
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
  }>;
  categories: Array<{ name: string; nameAr: string; slug: string }>;
  discounts: Array<{
    code: string;
    type: "percentage" | "fixed";
    value: number;
    description: string;
    descriptionAr: string;
    usageLimit?: number;
    expiresInDays?: number;
  }>;
  campaigns: Array<{
    name: string;
    nameAr: string;
    channel: "email" | "sms" | "social" | "ads";
    description: string;
    budgetCents: number;
  }>;
  shippingZones: Array<{
    name: string;
    countries: string[];
    flatRateCents: number;
    freeShippingMinCents?: number;
  }>;
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

export interface StorefrontBuilderService {
  generatePlan(input: StorefrontBuilderInput): Promise<StorefrontPlan>;
  applyPlan(
    companyId: string,
    plan: StorefrontPlan,
    userId: string | null,
  ): Promise<ApplyPlanResult>;
  generateAndApply(
    companyId: string,
    input: StorefrontBuilderInput,
    userId: string | null,
  ): Promise<{ plan: StorefrontPlan; result: ApplyPlanResult }>;
}

// ---------------------------------------------------------------------------
// Industry detection
// ---------------------------------------------------------------------------

type IndustryKey =
  | "perfume"
  | "clothing"
  | "electronics"
  | "restaurant"
  | "beauty"
  | "jewelry"
  | "cosmetics"
  | "default";

function detectIndustry(text: string, hint?: string): IndustryKey {
  const t = `${hint ?? ""} ${text}`.toLowerCase();
  // Arabic and English keyword matching
  if (
    /(عود|عطر|بخور|مسك|دهن|عنبر|perfume|oud|cologne|fragrance|incense|musk)/.test(
      t,
    )
  ) {
    return "perfume";
  }
  if (
    /(ملابس|فاشن|أزياء|قميص|عباية|ثوب|فستان|clothing|fashion|apparel|dress|shirt|abaya|kaftan)/.test(
      t,
    )
  ) {
    return "clothing";
  }
  if (
    /(إلكترون|تقني|هاتف|لابتوب|كمبيوتر|electronic|phone|laptop|computer|gadget|device|tech)/.test(
      t,
    )
  ) {
    return "electronics";
  }
  if (
    /(مطعم|كافيه|قهوة|طعام|أكل|restaurant|cafe|coffee|food|meal|dining|kitchen)/.test(
      t,
    )
  ) {
    return "restaurant";
  }
  if (/(تجميل|spa|سبا|بشرة|عناية|beauty|skincare|wellness|massage)/.test(t)) {
    return "beauty";
  }
  if (/(مجوهرات|ذهب|فضة|jewelry|jewellery|gold|silver|diamond|gemstone)/.test(t)) {
    return "jewelry";
  }
  if (/(مكياج|ميك\s*أب|makeup|cosmetic|lipstick|mascara|foundation)/.test(t)) {
    return "cosmetics";
  }
  return "default";
}

// ---------------------------------------------------------------------------
// Industry templates (deterministic fallback)
// ---------------------------------------------------------------------------

interface IndustryTemplate {
  storefront: Omit<StorefrontPlan["storefront"], "currency" | "countryCode">;
  products: StorefrontPlan["products"];
  categories: StorefrontPlan["categories"];
  discounts: StorefrontPlan["discounts"];
  campaigns: StorefrontPlan["campaigns"];
  paymentMethods: string[];
}

const PERFUME_TEMPLATE: IndustryTemplate = {
  storefront: {
    name: "Royal Oud House",
    nameAr: "بيت العود الملكي",
    tagline: "The scent of heritage",
    taglineAr: "عبق الأصالة",
    description:
      "Premium oud, perfumes and bakhoor crafted from the finest oils.",
    descriptionAr:
      "عود فاخر، عطور وبخور مصنوعة من أجود الزيوت الطبيعية.",
    suggestedDomain: "royal-oud-house.com",
    brandColors: { primary: "#3B2418", secondary: "#C9A961", accent: "#8B6F47" },
    theme: "luxury",
    aboutContent:
      "Royal Oud House brings together centuries of perfumery tradition with modern luxury. Every bottle is a story of heritage, hand-blended from the finest oud, rose, and amber.",
    aboutContentAr:
      "يجمع بيت العود الملكي بين قرون من تقاليد العطور والفخامة الحديثة. كل قارورة هي قصة من التراث، مخلوطة يدوياً من أجود أنواع العود والورد والعنبر.",
  },
  categories: [
    { name: "Oud Oils", nameAr: "زيوت العود", slug: "oud-oils" },
    { name: "Perfumes", nameAr: "العطور", slug: "perfumes" },
    { name: "Bakhoor & Incense", nameAr: "البخور", slug: "bakhoor" },
  ],
  products: [
    {
      name: "Royal Cambodi Oud Oil 6ml",
      nameAr: "زيت العود الكمبودي الملكي ٦ مل",
      description:
        "Aged Cambodian oud oil with notes of sweet wood and honey.",
      descriptionAr: "زيت عود كمبودي معتق بنفحات الخشب الحلو والعسل.",
      sku: "OUD-CAM-006",
      priceCents: 45000,
      costCents: 18000,
      category: "oud-oils",
      tags: ["premium", "oud", "oil"],
      initialStock: 25,
    },
    {
      name: "Hindi Oud Oil 3ml",
      nameAr: "زيت العود الهندي ٣ مل",
      description: "Rich Hindi oud with bold animalic depth.",
      descriptionAr: "عود هندي غني بعمق حيواني جريء.",
      sku: "OUD-HIN-003",
      priceCents: 28000,
      costCents: 11000,
      category: "oud-oils",
      tags: ["oud", "oil", "intense"],
      initialStock: 30,
    },
    {
      name: "Mukhallat Royal 100ml",
      nameAr: "مخلط ملكي ١٠٠ مل",
      description: "Signature blend of rose, oud and saffron.",
      descriptionAr: "خلطة مميزة من الورد والعود والزعفران.",
      sku: "PRF-MUK-100",
      priceCents: 18000,
      costCents: 6000,
      category: "perfumes",
      tags: ["perfume", "mukhallat", "signature"],
      initialStock: 60,
    },
    {
      name: "Amber Nights EDP 75ml",
      nameAr: "ليالي العنبر ٧٥ مل",
      description: "Warm amber, vanilla and musk.",
      descriptionAr: "عنبر دافئ وفانيليا ومسك.",
      sku: "PRF-AMB-075",
      priceCents: 22000,
      costCents: 7500,
      category: "perfumes",
      tags: ["perfume", "amber", "edp"],
      initialStock: 50,
    },
    {
      name: "Rose Damask EDP 50ml",
      nameAr: "ورد دمشقي ٥٠ مل",
      description: "Pure Damascus rose, bright and feminine.",
      descriptionAr: "ورد دمشقي نقي، منعش وأنثوي.",
      sku: "PRF-ROS-050",
      priceCents: 16000,
      costCents: 5500,
      category: "perfumes",
      tags: ["perfume", "rose", "floral"],
      initialStock: 45,
    },
    {
      name: "Bakhoor Maamoul Premium 50g",
      nameAr: "بخور معمول فاخر ٥٠ جم",
      description: "Hand-rolled bakhoor with oud and rose.",
      descriptionAr: "بخور معمول يدوياً بالعود والورد.",
      sku: "BKR-MAM-050",
      priceCents: 8500,
      costCents: 3000,
      category: "bakhoor",
      tags: ["bakhoor", "incense", "home"],
      initialStock: 100,
    },
    {
      name: "Bakhoor Al-Faris 80g",
      nameAr: "بخور الفارس ٨٠ جم",
      description: "Bold woody bakhoor for special occasions.",
      descriptionAr: "بخور خشبي جريء للمناسبات الخاصة.",
      sku: "BKR-FAR-080",
      priceCents: 12000,
      costCents: 4200,
      category: "bakhoor",
      tags: ["bakhoor", "woody"],
      initialStock: 80,
    },
    {
      name: "Dehn Al-Oud Sultani 3ml",
      nameAr: "دهن العود السلطاني ٣ مل",
      description: "Pure royal dehn al-oud, super-concentrated.",
      descriptionAr: "دهن عود سلطاني نقي مركز جداً.",
      sku: "OUD-SUL-003",
      priceCents: 65000,
      costCents: 25000,
      category: "oud-oils",
      tags: ["premium", "oud", "luxury"],
      initialStock: 15,
    },
    {
      name: "Oud Burner Brass Classic",
      nameAr: "مبخرة نحاسية كلاسيكية",
      description: "Traditional brass incense burner.",
      descriptionAr: "مبخرة نحاسية تقليدية.",
      sku: "ACC-BUR-001",
      priceCents: 9500,
      costCents: 3500,
      category: "bakhoor",
      tags: ["accessory", "burner"],
      initialStock: 40,
    },
    {
      name: "Gift Set: Mukhallat + Bakhoor",
      nameAr: "هدية: مخلط + بخور",
      description: "Curated gift set with mukhallat and premium bakhoor.",
      descriptionAr: "مجموعة هدايا منسقة بالمخلط والبخور الفاخر.",
      sku: "GFT-SET-001",
      priceCents: 24000,
      costCents: 9000,
      category: "perfumes",
      tags: ["gift", "set", "premium"],
      initialStock: 35,
    },
  ],
  discounts: [
    {
      code: "FOUNDERS20",
      type: "percentage",
      value: 20,
      description: "20% off for our first 100 customers",
      descriptionAr: "خصم ٢٠٪ لأول ١٠٠ عميل من المؤسسين",
      usageLimit: 100,
      expiresInDays: 60,
    },
    {
      code: "WELCOME10",
      type: "percentage",
      value: 10,
      description: "10% off your first order",
      descriptionAr: "خصم ١٠٪ على أول طلب",
      expiresInDays: 365,
    },
    {
      code: "RAMADAN25",
      type: "percentage",
      value: 25,
      description: "Ramadan special — 25% off",
      descriptionAr: "عرض رمضان — خصم ٢٥٪",
      expiresInDays: 30,
    },
  ],
  campaigns: [
    {
      name: "Launch Announcement",
      nameAr: "إعلان الإطلاق",
      channel: "social",
      description: "Instagram + Snapchat launch with founder story.",
      budgetCents: 50000,
    },
    {
      name: "Founders Email Blast",
      nameAr: "حملة بريدية للمؤسسين",
      channel: "email",
      description: "Email subscribers about the founders discount.",
      budgetCents: 0,
    },
    {
      name: "WhatsApp Catalog Push",
      nameAr: "حملة كتالوج واتساب",
      channel: "sms",
      description: "Send WhatsApp broadcast with new catalog.",
      budgetCents: 15000,
    },
  ],
  paymentMethods: ["knet", "myfatoorah", "card", "apple_pay", "cod"],
};

const CLOTHING_TEMPLATE: IndustryTemplate = {
  storefront: {
    name: "Aseel Fashion",
    nameAr: "أصيل فاشن",
    tagline: "Modern modesty, timeless style",
    taglineAr: "أناقة معاصرة، طراز خالد",
    description:
      "Modern abayas, kaftans and modest wear for the contemporary woman.",
    descriptionAr: "عبايات وقفاطين وملابس محتشمة للمرأة العصرية.",
    suggestedDomain: "aseel-fashion.com",
    brandColors: { primary: "#1F2937", secondary: "#D4AF37", accent: "#F3E8DD" },
    theme: "modern",
    aboutContent:
      "Aseel Fashion designs modest wear that doesn't compromise on style. From classic black abayas to vibrant kaftans, every piece is made to make you feel powerful and beautiful.",
    aboutContentAr:
      "تصمم أصيل فاشن ملابس محتشمة دون تنازل عن الأناقة. من العبايات السوداء الكلاسيكية إلى القفاطين المفعمة بالألوان، كل قطعة تجعلك تشعرين بالقوة والجمال.",
  },
  categories: [
    { name: "Abayas", nameAr: "عبايات", slug: "abayas" },
    { name: "Kaftans", nameAr: "قفاطين", slug: "kaftans" },
    { name: "Accessories", nameAr: "إكسسوارات", slug: "accessories" },
  ],
  products: [
    {
      name: "Classic Black Abaya",
      nameAr: "عباية سوداء كلاسيكية",
      description: "Flowing black abaya in premium crepe.",
      descriptionAr: "عباية سوداء فضفاضة من الكريب الفاخر.",
      sku: "ABY-BLK-001",
      priceCents: 12500,
      costCents: 4500,
      category: "abayas",
      tags: ["abaya", "black", "classic"],
      initialStock: 50,
    },
    {
      name: "Embroidered Open Abaya",
      nameAr: "عباية مفتوحة مطرزة",
      description: "Open abaya with gold thread embroidery.",
      descriptionAr: "عباية مفتوحة بتطريز ذهبي.",
      sku: "ABY-EMB-002",
      priceCents: 18900,
      costCents: 7000,
      category: "abayas",
      tags: ["abaya", "embroidered", "luxury"],
      initialStock: 30,
    },
    {
      name: "Pearl Sleeve Abaya",
      nameAr: "عباية أكمام لؤلؤ",
      description: "Elegant abaya with pearl-detailed sleeves.",
      descriptionAr: "عباية أنيقة بتفاصيل اللؤلؤ على الأكمام.",
      sku: "ABY-PRL-003",
      priceCents: 22500,
      costCents: 9000,
      category: "abayas",
      tags: ["abaya", "pearl", "elegant"],
      initialStock: 25,
    },
    {
      name: "Moroccan Royal Kaftan",
      nameAr: "قفطان مغربي ملكي",
      description: "Vibrant Moroccan kaftan with hand embroidery.",
      descriptionAr: "قفطان مغربي زاهي بتطريز يدوي.",
      sku: "KFT-MAR-001",
      priceCents: 28000,
      costCents: 11000,
      category: "kaftans",
      tags: ["kaftan", "moroccan", "evening"],
      initialStock: 20,
    },
    {
      name: "Emerald Silk Kaftan",
      nameAr: "قفطان حرير زمردي",
      description: "Pure silk kaftan in emerald green.",
      descriptionAr: "قفطان حرير نقي بلون الزمرد.",
      sku: "KFT-EMR-002",
      priceCents: 24000,
      costCents: 9500,
      category: "kaftans",
      tags: ["kaftan", "silk", "premium"],
      initialStock: 18,
    },
    {
      name: "Everyday Linen Kaftan",
      nameAr: "قفطان كتاني يومي",
      description: "Breathable linen kaftan for daily wear.",
      descriptionAr: "قفطان كتاني خفيف للارتداء اليومي.",
      sku: "KFT-LIN-003",
      priceCents: 9500,
      costCents: 3500,
      category: "kaftans",
      tags: ["kaftan", "linen", "casual"],
      initialStock: 60,
    },
    {
      name: "Chiffon Hijab Set",
      nameAr: "طقم حجاب شيفون",
      description: "Set of 3 premium chiffon hijabs.",
      descriptionAr: "طقم من ٣ حجابات شيفون فاخرة.",
      sku: "HJB-CHF-001",
      priceCents: 6500,
      costCents: 2200,
      category: "accessories",
      tags: ["hijab", "chiffon", "set"],
      initialStock: 100,
    },
    {
      name: "Pearl Hijab Pins",
      nameAr: "دبابيس حجاب لؤلؤ",
      description: "Decorative pearl hijab pins, pack of 6.",
      descriptionAr: "دبابيس حجاب باللؤلؤ، عبوة ٦ قطع.",
      sku: "ACC-PIN-001",
      priceCents: 1500,
      costCents: 400,
      category: "accessories",
      tags: ["accessory", "pin"],
      initialStock: 200,
    },
    {
      name: "Belted Maxi Abaya",
      nameAr: "عباية ماكسي بحزام",
      description: "Modern belted abaya with structured silhouette.",
      descriptionAr: "عباية ماكسي عصرية بحزام وقصة أنيقة.",
      sku: "ABY-BLT-004",
      priceCents: 15000,
      costCents: 5500,
      category: "abayas",
      tags: ["abaya", "modern"],
      initialStock: 35,
    },
  ],
  discounts: [
    {
      code: "FOUNDERS25",
      type: "percentage",
      value: 25,
      description: "Founders 25% off",
      descriptionAr: "خصم المؤسسين ٢٥٪",
      usageLimit: 150,
      expiresInDays: 90,
    },
    {
      code: "WELCOME",
      type: "fixed",
      value: 5000,
      description: "5 KWD off your first order",
      descriptionAr: "خصم ٥ دك على أول طلب",
      expiresInDays: 365,
    },
    {
      code: "EID30",
      type: "percentage",
      value: 30,
      description: "Eid 30% off",
      descriptionAr: "خصم العيد ٣٠٪",
      expiresInDays: 21,
    },
  ],
  campaigns: [
    {
      name: "Instagram Lookbook",
      nameAr: "كتاب الإطلالات إنستغرام",
      channel: "social",
      description: "Seasonal lookbook campaign on Instagram.",
      budgetCents: 75000,
    },
    {
      name: "Email — New Collection",
      nameAr: "بريد — المجموعة الجديدة",
      channel: "email",
      description: "Newsletter announcing the new collection.",
      budgetCents: 0,
    },
    {
      name: "TikTok Influencer Drop",
      nameAr: "حملة المؤثرين تيكتوك",
      channel: "ads",
      description: "Partner with 3 local influencers on TikTok.",
      budgetCents: 100000,
    },
  ],
  paymentMethods: ["knet", "myfatoorah", "card", "apple_pay", "tabby", "cod"],
};

const ELECTRONICS_TEMPLATE: IndustryTemplate = {
  storefront: {
    name: "TechHub Gulf",
    nameAr: "تك هاب الخليج",
    tagline: "Latest tech, fastest delivery",
    taglineAr: "أحدث التقنيات، أسرع توصيل",
    description: "Phones, laptops and smart devices with warranty.",
    descriptionAr: "هواتف ولابتوبات وأجهزة ذكية مع ضمان.",
    suggestedDomain: "techhub-gulf.com",
    brandColors: { primary: "#0F172A", secondary: "#3B82F6", accent: "#10B981" },
    theme: "modern",
    aboutContent:
      "TechHub Gulf is your trusted source for genuine tech products. Every device comes with a regional warranty and same-day delivery in major cities.",
    aboutContentAr:
      "تك هاب الخليج هو مصدرك الموثوق للأجهزة التقنية الأصلية. كل جهاز يأتي مع ضمان إقليمي وتوصيل في نفس اليوم.",
  },
  categories: [
    { name: "Smartphones", nameAr: "الهواتف الذكية", slug: "phones" },
    { name: "Laptops & Tablets", nameAr: "لابتوب وأجهزة لوحية", slug: "laptops" },
    { name: "Accessories", nameAr: "الإكسسوارات", slug: "accessories" },
  ],
  products: [
    {
      name: "Smartphone Pro 256GB",
      nameAr: "هاتف ذكي برو ٢٥٦ جيجا",
      description: "Flagship smartphone with 256GB storage.",
      descriptionAr: "هاتف فلاجشيب بسعة ٢٥٦ جيجا.",
      sku: "PHN-PRO-256",
      priceCents: 30000,
      costCents: 24000,
      category: "phones",
      tags: ["phone", "flagship"],
      initialStock: 30,
    },
    {
      name: "Smartphone Lite 128GB",
      nameAr: "هاتف لايت ١٢٨ جيجا",
      description: "Affordable smartphone with great battery.",
      descriptionAr: "هاتف اقتصادي ببطارية ممتازة.",
      sku: "PHN-LIT-128",
      priceCents: 12000,
      costCents: 9000,
      category: "phones",
      tags: ["phone", "budget"],
      initialStock: 60,
    },
    {
      name: "Laptop Ultrabook 14\"",
      nameAr: "لابتوب ألترابوك ١٤ بوصة",
      description: "Lightweight 14-inch laptop, 16GB RAM.",
      descriptionAr: "لابتوب خفيف ١٤ بوصة، ١٦ جيجا رام.",
      sku: "LPT-ULT-014",
      priceCents: 45000,
      costCents: 36000,
      category: "laptops",
      tags: ["laptop", "ultrabook"],
      initialStock: 20,
    },
    {
      name: "Tablet 11\" Wi-Fi",
      nameAr: "تابلت ١١ بوصة واي فاي",
      description: "11-inch tablet for work and play.",
      descriptionAr: "تابلت ١١ بوصة للعمل والترفيه.",
      sku: "TAB-WIF-011",
      priceCents: 22000,
      costCents: 17500,
      category: "laptops",
      tags: ["tablet"],
      initialStock: 25,
    },
    {
      name: "Wireless Earbuds Pro",
      nameAr: "سماعات لاسلكية برو",
      description: "Active noise cancelling earbuds.",
      descriptionAr: "سماعات لاسلكية بإلغاء الضوضاء.",
      sku: "AUD-EAR-PRO",
      priceCents: 5500,
      costCents: 3200,
      category: "accessories",
      tags: ["audio", "earbuds"],
      initialStock: 80,
    },
    {
      name: "Fast Charger 65W",
      nameAr: "شاحن سريع ٦٥ واط",
      description: "USB-C fast charger, 65W output.",
      descriptionAr: "شاحن USB-C سريع ٦٥ واط.",
      sku: "CHG-USB-065",
      priceCents: 1800,
      costCents: 800,
      category: "accessories",
      tags: ["charger"],
      initialStock: 150,
    },
    {
      name: "Smart Watch 2024",
      nameAr: "ساعة ذكية ٢٠٢٤",
      description: "Health tracking smart watch.",
      descriptionAr: "ساعة ذكية لتتبع الصحة.",
      sku: "WCH-SMR-024",
      priceCents: 9500,
      costCents: 6500,
      category: "accessories",
      tags: ["wearable"],
      initialStock: 40,
    },
    {
      name: "Premium USB-C Cable 2m",
      nameAr: "كيبل USB-C فاخر ٢ متر",
      description: "Braided 2m USB-C cable.",
      descriptionAr: "كيبل USB-C مجدول ٢ متر.",
      sku: "CBL-USB-002",
      priceCents: 800,
      costCents: 250,
      category: "accessories",
      tags: ["cable"],
      initialStock: 200,
    },
    {
      name: "Bluetooth Speaker Portable",
      nameAr: "سبيكر بلوتوث محمول",
      description: "Waterproof Bluetooth speaker.",
      descriptionAr: "سماعة بلوتوث مقاومة للماء.",
      sku: "AUD-SPK-001",
      priceCents: 4500,
      costCents: 2400,
      category: "accessories",
      tags: ["audio", "speaker"],
      initialStock: 50,
    },
  ],
  discounts: [
    {
      code: "FOUNDERS15",
      type: "percentage",
      value: 15,
      description: "Founders 15% off first 200 customers",
      descriptionAr: "خصم المؤسسين ١٥٪ لأول ٢٠٠ عميل",
      usageLimit: 200,
      expiresInDays: 60,
    },
    {
      code: "BUNDLE10",
      type: "percentage",
      value: 10,
      description: "10% off when buying 2+ items",
      descriptionAr: "خصم ١٠٪ عند شراء قطعتين أو أكثر",
      expiresInDays: 365,
    },
  ],
  campaigns: [
    {
      name: "Google Ads — Phones",
      nameAr: "إعلانات قوقل — الهواتف",
      channel: "ads",
      description: "Search ads for top-selling phone models.",
      budgetCents: 200000,
    },
    {
      name: "Email — Weekly Deals",
      nameAr: "بريد — عروض الأسبوع",
      channel: "email",
      description: "Weekly deals digest.",
      budgetCents: 0,
    },
    {
      name: "Instagram Reels — Unboxing",
      nameAr: "ريلز إنستغرام — فتح الصناديق",
      channel: "social",
      description: "Unboxing reels for new arrivals.",
      budgetCents: 50000,
    },
  ],
  paymentMethods: ["knet", "myfatoorah", "card", "apple_pay", "tabby", "cod"],
};

const RESTAURANT_TEMPLATE: IndustryTemplate = {
  storefront: {
    name: "Bayt Al-Mathaq",
    nameAr: "بيت المذاق",
    tagline: "Authentic flavors, delivered hot",
    taglineAr: "نكهات أصيلة تصل ساخنة",
    description: "Traditional and modern Arabic cuisine with online ordering.",
    descriptionAr: "مأكولات عربية تقليدية وحديثة مع طلب أونلاين.",
    suggestedDomain: "bayt-mathaq.com",
    brandColors: { primary: "#7C2D12", secondary: "#F59E0B", accent: "#FEF3C7" },
    theme: "classic",
    aboutContent:
      "Bayt Al-Mathaq brings family recipes to your table. From slow-cooked machboos to fresh-baked manakeesh, every dish is prepared the way grandma did.",
    aboutContentAr:
      "يقدم بيت المذاق وصفات العائلة على مائدتك. من المجبوس البطيء الطهي إلى المناقيش الطازجة، كل طبق محضر كما كانت تحضره الجدة.",
  },
  categories: [
    { name: "Main Dishes", nameAr: "أطباق رئيسية", slug: "mains" },
    { name: "Appetizers & Sides", nameAr: "مقبلات", slug: "appetizers" },
    { name: "Desserts & Drinks", nameAr: "حلويات ومشروبات", slug: "desserts" },
  ],
  products: [
    {
      name: "Lamb Machboos",
      nameAr: "مجبوس لحم",
      description: "Traditional Kuwaiti lamb machboos for 4.",
      descriptionAr: "مجبوس لحم كويتي تقليدي لـ ٤ أشخاص.",
      sku: "MAIN-MAC-LMB",
      priceCents: 8500,
      costCents: 3000,
      category: "mains",
      tags: ["lamb", "rice", "traditional"],
      initialStock: 50,
    },
    {
      name: "Chicken Machboos",
      nameAr: "مجبوس دجاج",
      description: "Kuwaiti chicken machboos for 4.",
      descriptionAr: "مجبوس دجاج كويتي لـ ٤ أشخاص.",
      sku: "MAIN-MAC-CHK",
      priceCents: 6500,
      costCents: 2200,
      category: "mains",
      tags: ["chicken", "rice"],
      initialStock: 60,
    },
    {
      name: "Mixed Grill Platter",
      nameAr: "مشاوي مشكلة",
      description: "Kebab, shish tawook, kofta with rice and salad.",
      descriptionAr: "كباب وشيش طاووق وكفتة مع أرز وسلطة.",
      sku: "MAIN-GRL-MIX",
      priceCents: 12000,
      costCents: 4500,
      category: "mains",
      tags: ["grill", "kebab"],
      initialStock: 40,
    },
    {
      name: "Manakeesh Zaatar",
      nameAr: "مناقيش زعتر",
      description: "Fresh-baked zaatar manakeesh.",
      descriptionAr: "مناقيش زعتر مخبوزة طازجة.",
      sku: "APP-MAN-ZTR",
      priceCents: 1200,
      costCents: 400,
      category: "appetizers",
      tags: ["bread", "breakfast"],
      initialStock: 100,
    },
    {
      name: "Hummus & Mutabbal Combo",
      nameAr: "حمص ومتبل",
      description: "Hummus and mutabbal with pita.",
      descriptionAr: "حمص ومتبل مع خبز.",
      sku: "APP-DIP-001",
      priceCents: 2200,
      costCents: 700,
      category: "appetizers",
      tags: ["dip", "vegetarian"],
      initialStock: 80,
    },
    {
      name: "Fattoush Salad",
      nameAr: "سلطة فتوش",
      description: "Classic Levantine fattoush salad.",
      descriptionAr: "سلطة فتوش شامية كلاسيكية.",
      sku: "APP-SAL-FAT",
      priceCents: 1800,
      costCents: 600,
      category: "appetizers",
      tags: ["salad", "vegetarian"],
      initialStock: 70,
    },
    {
      name: "Umm Ali Dessert",
      nameAr: "أم علي",
      description: "Warm umm ali with pistachios.",
      descriptionAr: "أم علي دافئة بالفستق.",
      sku: "DSR-UMM-001",
      priceCents: 2500,
      costCents: 800,
      category: "desserts",
      tags: ["dessert", "warm"],
      initialStock: 50,
    },
    {
      name: "Kunafa Nabulsiyya",
      nameAr: "كنافة نابلسية",
      description: "Cheese kunafa with rosewater syrup.",
      descriptionAr: "كنافة بالجبن وشيرة ماء الورد.",
      sku: "DSR-KUN-NAB",
      priceCents: 2800,
      costCents: 900,
      category: "desserts",
      tags: ["dessert", "cheese"],
      initialStock: 45,
    },
    {
      name: "Karak Chai 500ml",
      nameAr: "شاي كرك ٥٠٠ مل",
      description: "Traditional karak tea, served hot.",
      descriptionAr: "شاي كرك تقليدي ساخن.",
      sku: "BEV-KAR-500",
      priceCents: 800,
      costCents: 200,
      category: "desserts",
      tags: ["beverage", "hot"],
      initialStock: 200,
    },
  ],
  discounts: [
    {
      code: "FOUNDERS",
      type: "percentage",
      value: 20,
      description: "20% off — opening month special",
      descriptionAr: "خصم ٢٠٪ — عرض شهر الافتتاح",
      usageLimit: 500,
      expiresInDays: 30,
    },
    {
      code: "FAMILY",
      type: "fixed",
      value: 2000,
      description: "2 KWD off orders above 15 KWD",
      descriptionAr: "خصم ٢ دك على الطلبات فوق ١٥ دك",
      expiresInDays: 90,
    },
    {
      code: "RAMADAN",
      type: "percentage",
      value: 15,
      description: "Ramadan iftar 15% off",
      descriptionAr: "خصم إفطار رمضان ١٥٪",
      expiresInDays: 30,
    },
  ],
  campaigns: [
    {
      name: "Talabat & Deliveroo Promo",
      nameAr: "عرض طلبات وديليفرو",
      channel: "ads",
      description: "Promo placement on delivery apps.",
      budgetCents: 80000,
    },
    {
      name: "Instagram Food Reels",
      nameAr: "ريلز طعام إنستغرام",
      channel: "social",
      description: "Sizzling food reels showing chef preparing dishes.",
      budgetCents: 40000,
    },
    {
      name: "WhatsApp Menu Broadcast",
      nameAr: "بث القائمة عبر واتساب",
      channel: "sms",
      description: "Weekly menu broadcast to subscribers.",
      budgetCents: 5000,
    },
  ],
  paymentMethods: ["knet", "myfatoorah", "card", "cash", "cod"],
};

const BEAUTY_TEMPLATE: IndustryTemplate = {
  storefront: {
    name: "Lumiere Spa & Beauty",
    nameAr: "لوميير سبا وتجميل",
    tagline: "Glow from within",
    taglineAr: "إشراقة من الداخل",
    description: "Premium skincare, spa treatments and wellness products.",
    descriptionAr: "منتجات عناية فاخرة وعلاجات سبا وعافية.",
    suggestedDomain: "lumiere-spa.com",
    brandColors: { primary: "#831843", secondary: "#F9A8D4", accent: "#FDF2F8" },
    theme: "luxury",
    aboutContent:
      "Lumiere blends clinical skincare science with the tranquility of a luxury spa. We use clean, dermatologist-tested formulas suited for GCC skin.",
    aboutContentAr:
      "تجمع لوميير بين علم العناية بالبشرة وهدوء السبا الفاخر. نستخدم تركيبات نظيفة مختبرة من قبل أطباء الجلدية مناسبة لبشرة الخليج.",
  },
  categories: [
    { name: "Skincare", nameAr: "العناية بالبشرة", slug: "skincare" },
    { name: "Body & Bath", nameAr: "الجسم والاستحمام", slug: "body" },
    { name: "Spa Treatments", nameAr: "علاجات سبا", slug: "spa" },
  ],
  products: [
    {
      name: "Vitamin C Brightening Serum 30ml",
      nameAr: "سيروم فيتامين سي ٣٠ مل",
      description: "20% vitamin C serum for radiant skin.",
      descriptionAr: "سيروم فيتامين سي ٢٠٪ لبشرة مشرقة.",
      sku: "SKN-VC-030",
      priceCents: 9500,
      costCents: 3500,
      category: "skincare",
      tags: ["serum", "brightening"],
      initialStock: 60,
    },
    {
      name: "Hyaluronic Acid Hydrator 50ml",
      nameAr: "مرطب حمض الهيالورونيك ٥٠ مل",
      description: "Deep hydration for thirsty skin.",
      descriptionAr: "ترطيب عميق للبشرة الجافة.",
      sku: "SKN-HA-050",
      priceCents: 7800,
      costCents: 2800,
      category: "skincare",
      tags: ["hydrating"],
      initialStock: 70,
    },
    {
      name: "Retinol Night Cream 50ml",
      nameAr: "كريم ريتينول ليلي ٥٠ مل",
      description: "Anti-aging night cream with retinol.",
      descriptionAr: "كريم ليلي مضاد للشيخوخة بالريتينول.",
      sku: "SKN-RET-050",
      priceCents: 12500,
      costCents: 4500,
      category: "skincare",
      tags: ["anti-aging", "night"],
      initialStock: 40,
    },
    {
      name: "SPF 50 Daily Sunscreen 50ml",
      nameAr: "واقي شمس يومي SPF 50 ٥٠ مل",
      description: "Mineral SPF 50 sunscreen for daily use.",
      descriptionAr: "واقي شمس معدني SPF 50 للاستخدام اليومي.",
      sku: "SKN-SPF-050",
      priceCents: 6500,
      costCents: 2400,
      category: "skincare",
      tags: ["spf", "daily"],
      initialStock: 100,
    },
    {
      name: "Rose Body Oil 100ml",
      nameAr: "زيت ورد للجسم ١٠٠ مل",
      description: "Nourishing body oil with rose extract.",
      descriptionAr: "زيت مغذٍ للجسم بخلاصة الورد.",
      sku: "BDY-OIL-100",
      priceCents: 5800,
      costCents: 2000,
      category: "body",
      tags: ["body", "oil"],
      initialStock: 75,
    },
    {
      name: "Dead Sea Salt Scrub 250g",
      nameAr: "مقشر ملح البحر الميت ٢٥٠ جم",
      description: "Exfoliating Dead Sea salt scrub.",
      descriptionAr: "مقشر مقشّر بملح البحر الميت.",
      sku: "BDY-SCR-250",
      priceCents: 4500,
      costCents: 1500,
      category: "body",
      tags: ["scrub", "body"],
      initialStock: 80,
    },
    {
      name: "Aromatherapy Bath Set",
      nameAr: "طقم استحمام أروماثيرابي",
      description: "Bath salts and bubble bath gift set.",
      descriptionAr: "طقم هدية أملاح وفقاعات استحمام.",
      sku: "BDY-SET-001",
      priceCents: 7500,
      costCents: 2800,
      category: "body",
      tags: ["gift", "bath"],
      initialStock: 35,
    },
    {
      name: "60-Min Signature Facial",
      nameAr: "فيشل مميز ٦٠ دقيقة",
      description: "Signature deep-cleanse facial, 60 minutes.",
      descriptionAr: "فيشل تنظيف عميق مميز ٦٠ دقيقة.",
      sku: "SPA-FAC-060",
      priceCents: 25000,
      costCents: 8000,
      category: "spa",
      tags: ["service", "facial"],
      initialStock: 50,
    },
    {
      name: "90-Min Hot Stone Massage",
      nameAr: "مساج بالحجارة الساخنة ٩٠ دقيقة",
      description: "Relaxing hot stone full-body massage.",
      descriptionAr: "مساج كامل للجسم بالحجارة الساخنة.",
      sku: "SPA-MAS-090",
      priceCents: 35000,
      costCents: 11000,
      category: "spa",
      tags: ["service", "massage"],
      initialStock: 50,
    },
  ],
  discounts: [
    {
      code: "FOUNDERS30",
      type: "percentage",
      value: 30,
      description: "Founders 30% off first treatment",
      descriptionAr: "خصم ٣٠٪ على أول علاج للمؤسسين",
      usageLimit: 100,
      expiresInDays: 60,
    },
    {
      code: "FIRSTGLOW",
      type: "fixed",
      value: 3000,
      description: "3 KWD off your first order",
      descriptionAr: "خصم ٣ دك على أول طلب",
      expiresInDays: 365,
    },
    {
      code: "SELFCARE",
      type: "percentage",
      value: 15,
      description: "Self-care Sunday — 15% off",
      descriptionAr: "أحد العناية الذاتية — خصم ١٥٪",
      expiresInDays: 90,
    },
  ],
  campaigns: [
    {
      name: "Instagram Skincare Routines",
      nameAr: "روتين العناية إنستغرام",
      channel: "social",
      description: "Daily skincare routine posts and reels.",
      budgetCents: 60000,
    },
    {
      name: "Email — Treatment Calendar",
      nameAr: "بريد — جدول العلاجات",
      channel: "email",
      description: "Weekly availability and tips email.",
      budgetCents: 0,
    },
    {
      name: "Google Maps Boost",
      nameAr: "تعزيز خرائط قوقل",
      channel: "ads",
      description: "Local search ads for spa visits.",
      budgetCents: 40000,
    },
  ],
  paymentMethods: ["knet", "myfatoorah", "card", "apple_pay"],
};

const DEFAULT_TEMPLATE: IndustryTemplate = {
  storefront: {
    name: "My Shop",
    nameAr: "متجري",
    tagline: "Quality products, friendly service",
    taglineAr: "منتجات عالية الجودة وخدمة ودية",
    description: "An online store for everyday quality goods.",
    descriptionAr: "متجر إلكتروني للسلع اليومية عالية الجودة.",
    suggestedDomain: "my-shop.com",
    brandColors: { primary: "#0F766E", secondary: "#FB923C", accent: "#F8FAFC" },
    theme: "minimal",
    aboutContent:
      "We bring carefully curated products to your doorstep with friendly service and fast delivery.",
    aboutContentAr:
      "نوصل لك منتجات منتقاة بعناية مع خدمة ودية وتوصيل سريع.",
  },
  categories: [
    { name: "Featured", nameAr: "مميز", slug: "featured" },
    { name: "Best Sellers", nameAr: "الأكثر مبيعاً", slug: "best-sellers" },
    { name: "New Arrivals", nameAr: "وصل حديثاً", slug: "new" },
  ],
  products: Array.from({ length: 8 }).map((_, i) => ({
    name: `Quality Product ${i + 1}`,
    nameAr: `منتج عالي الجودة ${i + 1}`,
    description: `Carefully selected product #${i + 1}.`,
    descriptionAr: `منتج منتقى بعناية رقم ${i + 1}.`,
    sku: `PRD-${String(i + 1).padStart(3, "0")}`,
    priceCents: 2500 + i * 1500,
    costCents: 1000 + i * 500,
    category: i % 3 === 0 ? "featured" : i % 3 === 1 ? "best-sellers" : "new",
    tags: ["general"],
    initialStock: 50,
  })),
  discounts: [
    {
      code: "FOUNDERS",
      type: "percentage",
      value: 20,
      description: "Founders 20% off",
      descriptionAr: "خصم المؤسسين ٢٠٪",
      usageLimit: 100,
      expiresInDays: 60,
    },
    {
      code: "WELCOME",
      type: "percentage",
      value: 10,
      description: "10% off your first order",
      descriptionAr: "خصم ١٠٪ على أول طلب",
      expiresInDays: 365,
    },
  ],
  campaigns: [
    {
      name: "Launch Social Push",
      nameAr: "حملة الإطلاق",
      channel: "social",
      description: "Initial social media launch.",
      budgetCents: 30000,
    },
    {
      name: "Welcome Email",
      nameAr: "بريد ترحيبي",
      channel: "email",
      description: "Welcome series for new subscribers.",
      budgetCents: 0,
    },
  ],
  paymentMethods: ["knet", "myfatoorah", "card", "cod"],
};

const INDUSTRY_TEMPLATES: Record<IndustryKey, IndustryTemplate> = {
  perfume: PERFUME_TEMPLATE,
  clothing: CLOTHING_TEMPLATE,
  electronics: ELECTRONICS_TEMPLATE,
  restaurant: RESTAURANT_TEMPLATE,
  beauty: BEAUTY_TEMPLATE,
  jewelry: PERFUME_TEMPLATE, // jewelry shares the luxury template feel
  cosmetics: BEAUTY_TEMPLATE,
  default: DEFAULT_TEMPLATE,
};

// ---------------------------------------------------------------------------
// Shipping zones helper
// ---------------------------------------------------------------------------

function defaultShippingZones(country: GccCountryCode): StorefrontPlan["shippingZones"] {
  return [
    {
      name: `${GCC_COUNTRIES[country].name} (local)`,
      countries: [country],
      flatRateCents: 1500,
      freeShippingMinCents: 25000,
    },
    {
      name: "GCC (regional)",
      countries: ["KW", "SA", "AE", "QA", "BH", "OM"].filter((c) => c !== country),
      flatRateCents: 5000,
      freeShippingMinCents: 50000,
    },
  ];
}

function applyBudgetTuning(
  template: IndustryTemplate,
  budget: "lean" | "standard" | "premium",
): IndustryTemplate {
  if (budget === "standard") return template;
  const factor = budget === "lean" ? 0.65 : 1.5;
  return {
    ...template,
    products: template.products.map((p) => ({
      ...p,
      priceCents: Math.max(100, Math.round(p.priceCents * factor)),
      costCents: Math.max(50, Math.round(p.costCents * factor)),
    })),
    campaigns: template.campaigns.map((c) => ({
      ...c,
      budgetCents: Math.max(0, Math.round(c.budgetCents * factor)),
    })),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidPlan(value: unknown): value is StorefrontPlan {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<StorefrontPlan>;
  if (!v.storefront || typeof v.storefront !== "object") return false;
  const sf = v.storefront;
  if (typeof sf.name !== "string" || sf.name.length === 0) return false;
  if (typeof sf.nameAr !== "string") return false;
  if (!sf.brandColors || typeof sf.brandColors !== "object") return false;
  if (!Array.isArray(v.products) || v.products.length === 0) return false;
  if (!Array.isArray(v.categories) || v.categories.length === 0) return false;
  if (!Array.isArray(v.discounts)) return false;
  if (!Array.isArray(v.campaigns)) return false;
  if (!Array.isArray(v.shippingZones)) return false;
  if (!Array.isArray(v.paymentMethods)) return false;
  return true;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createStorefrontBuilderService(db: Db): StorefrontBuilderService {
  function buildMockPlan(input: StorefrontBuilderInput): StorefrontPlan {
    const industry = detectIndustry(input.description, input.industry);
    const country: GccCountryCode = isGccCountryCode(input.targetCountry)
      ? input.targetCountry
      : DEFAULT_COUNTRY;
    const currency = GCC_COUNTRIES[country].currency;
    const budget = input.budget ?? "standard";
    const template = applyBudgetTuning(INDUSTRY_TEMPLATES[industry], budget);

    return {
      storefront: {
        ...template.storefront,
        currency,
        countryCode: country,
      },
      products: template.products,
      categories: template.categories,
      discounts: template.discounts,
      campaigns: template.campaigns,
      shippingZones: defaultShippingZones(country),
      paymentMethods: template.paymentMethods,
      mock: true,
      industry,
    };
  }

  async function generatePlan(
    input: StorefrontBuilderInput,
  ): Promise<StorefrontPlan> {
    const country: GccCountryCode = isGccCountryCode(input.targetCountry)
      ? input.targetCountry
      : DEFAULT_COUNTRY;
    const currency = GCC_COUNTRIES[country].currency;
    const currencyInfo = GCC_CURRENCIES[currency];
    const budget = input.budget ?? "standard";
    const lang = input.lang ?? "en";

    const system = `You are an expert e-commerce strategist for GCC markets. Generate a complete storefront plan as JSON matching this exact schema:
{
  "storefront": {
    "name": string, "nameAr": string, "tagline": string, "taglineAr": string,
    "description": string, "descriptionAr": string, "suggestedDomain": string,
    "brandColors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex" },
    "theme": "minimal"|"classic"|"modern"|"luxury"|"bold",
    "currency": "${currency}", "countryCode": "${country}",
    "aboutContent": string, "aboutContentAr": string
  },
  "products": [ { "name", "nameAr", "description", "descriptionAr", "sku", "priceCents" (integer in ${currencyInfo.decimals === 3 ? "fils, 1000 per ${currency}" : "minor units, 100 per ${currency}"}), "costCents", "category" (matches a category slug), "tags": string[], "initialStock": int } ] (10-15 items),
  "categories": [ { "name", "nameAr", "slug" } ] (exactly 3),
  "discounts": [ { "code", "type": "percentage"|"fixed", "value", "description", "descriptionAr", "usageLimit"?: int, "expiresInDays"?: int } ] (2-3),
  "campaigns": [ { "name", "nameAr", "channel": "email"|"sms"|"social"|"ads", "description", "budgetCents" } ] (2-3),
  "shippingZones": [ { "name", "countries": ["KW","SA",...], "flatRateCents", "freeShippingMinCents"? } ] (1-2),
  "paymentMethods": string[] (relevant: knet, myfatoorah, card, apple_pay, tabby, cod)
}
Constraints:
- Currency is ${currency} (${currencyInfo.name}, ${currencyInfo.decimals} decimal places).
- Country code is ${country}.
- Budget tier: ${budget}. Adjust pricing accordingly (lean = budget-friendly, premium = high-end).
- ALL string fields must have both English and Arabic versions where the schema asks for both.
- SKUs must be unique uppercase identifiers like "OUD-CAM-006".
- Output ONLY valid JSON. No commentary, no markdown fences.`;

    const user = `Business description (${lang}): ${input.description}\n${input.industry ? `Industry hint: ${input.industry}\n` : ""}Target country: ${country}\nBudget: ${budget}\n\nReturn the JSON plan now.`;

    const result = await callLLM(system, user, {
      maxTokens: 6000,
      temperature: 0.6,
    });

    if (result.mock) {
      return buildMockPlan(input);
    }
    const parsed = tryParseJson<StorefrontPlan>(result.text);
    if (!parsed || !isValidPlan(parsed)) {
      return buildMockPlan(input);
    }

    // Ensure currency/country sanity
    const sf = parsed.storefront;
    if (!isGccCurrency(sf.currency)) sf.currency = currency;
    if (!isGccCountryCode(sf.countryCode)) sf.countryCode = country;
    if (!parsed.shippingZones || parsed.shippingZones.length === 0) {
      parsed.shippingZones = defaultShippingZones(country);
    }
    parsed.mock = false;
    parsed.industry = detectIndustry(input.description, input.industry);
    return parsed;
  }

  async function ensureEcommerceModule(
    companyId: string,
    userId: string | null,
  ): Promise<void> {
    const existing = await db
      .select()
      .from(businessModules)
      .where(
        and(
          eq(businessModules.companyId, companyId),
          eq(businessModules.moduleKey, "ecommerce"),
        ),
      );
    const now = new Date();
    if (existing.length === 0) {
      await db
        .insert(businessModules)
        .values({
          companyId,
          moduleKey: "ecommerce",
          enabled: true,
          activatedByUserId: userId,
          config: {},
          activatedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    } else if (!existing[0]!.enabled) {
      await db
        .update(businessModules)
        .set({ enabled: true, updatedAt: now })
        .where(
          and(
            eq(businessModules.companyId, companyId),
            eq(businessModules.moduleKey, "ecommerce"),
          ),
        );
    }

    // Also enable inventory + marketing since the plan creates products + campaigns
    for (const moduleKey of ["inventory", "marketing"] as const) {
      await db
        .insert(businessModules)
        .values({
          companyId,
          moduleKey,
          enabled: true,
          activatedByUserId: userId,
          config: {},
          activatedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }

  async function applyPlan(
    companyId: string,
    plan: StorefrontPlan,
    userId: string | null,
  ): Promise<ApplyPlanResult> {
    await ensureEcommerceModule(companyId, userId);
    const now = new Date();
    const currency = plan.storefront.currency;

    // 1. Storefront
    const [storefrontRow] = await db
      .insert(businessEntities)
      .values({
        companyId,
        moduleKey: "ecommerce",
        entityType: "storefront",
        name: plan.storefront.name,
        status: "active",
        currency,
        data: {
          nameAr: plan.storefront.nameAr,
          tagline: plan.storefront.tagline,
          taglineAr: plan.storefront.taglineAr,
          description: plan.storefront.description,
          descriptionAr: plan.storefront.descriptionAr,
          domain: plan.storefront.suggestedDomain,
          slug: slugify(plan.storefront.name),
          brandColors: plan.storefront.brandColors,
          theme: plan.storefront.theme,
          countryCode: plan.storefront.countryCode,
          aboutContent: plan.storefront.aboutContent,
          aboutContentAr: plan.storefront.aboutContentAr,
          shippingZones: plan.shippingZones,
          paymentMethods: plan.paymentMethods,
          categories: plan.categories,
          generatedAt: now.toISOString(),
        },
        tags: plan.industry ? [plan.industry] : [],
        createdByUserId: userId,
        updatedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!storefrontRow) {
      throw new Error("Failed to insert storefront");
    }

    // 2. Categories — store as inventory tag-style entities (use category slug as code)
    const categoryIds: string[] = [];
    for (const cat of plan.categories) {
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: "ecommerce",
          entityType: "category",
          code: cat.slug,
          name: cat.name,
          status: "active",
          data: { nameAr: cat.nameAr, slug: cat.slug },
          tags: [],
          parentId: storefrontRow.id,
          createdByUserId: userId,
          updatedByUserId: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (row) categoryIds.push(row.id);
    }

    // 3. Products
    const productIds: string[] = [];
    for (const product of plan.products) {
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: "inventory",
          entityType: "product",
          code: product.sku,
          name: product.name,
          status: "active",
          currency,
          amountCents: product.priceCents,
          data: {
            nameAr: product.nameAr,
            description: product.description,
            descriptionAr: product.descriptionAr,
            sku: product.sku,
            priceCents: product.priceCents,
            costCents: product.costCents,
            category: product.category,
            initialStock: product.initialStock,
            trackInventory: "yes",
            storefrontId: storefrontRow.id,
          },
          tags: product.tags,
          parentId: storefrontRow.id,
          createdByUserId: userId,
          updatedByUserId: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (row) productIds.push(row.id);
    }

    // 4. Discounts
    const discountIds: string[] = [];
    for (const discount of plan.discounts) {
      const validUntil = discount.expiresInDays
        ? new Date(now.getTime() + discount.expiresInDays * 86400000)
        : null;
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: "ecommerce",
          entityType: "discount",
          code: discount.code,
          name: discount.description,
          status: "active",
          data: {
            kind: discount.type,
            value: discount.value,
            description: discount.description,
            descriptionAr: discount.descriptionAr,
            usageLimit: discount.usageLimit ?? null,
            validFrom: now.toISOString(),
            validUntil: validUntil ? validUntil.toISOString() : null,
          },
          tags: [],
          parentId: storefrontRow.id,
          createdByUserId: userId,
          updatedByUserId: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (row) discountIds.push(row.id);
    }

    // 5. Campaigns
    const campaignIds: string[] = [];
    for (const campaign of plan.campaigns) {
      const [row] = await db
        .insert(businessEntities)
        .values({
          companyId,
          moduleKey: "marketing",
          entityType: "campaign",
          name: campaign.name,
          status: "draft",
          currency,
          amountCents: campaign.budgetCents,
          data: {
            nameAr: campaign.nameAr,
            channel: campaign.channel,
            description: campaign.description,
            budgetCents: campaign.budgetCents,
            storefrontId: storefrontRow.id,
          },
          tags: [campaign.channel],
          createdByUserId: userId,
          updatedByUserId: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (row) campaignIds.push(row.id);
    }

    return {
      storefrontId: storefrontRow.id,
      productIds,
      categoryIds,
      discountIds,
      campaignIds,
    };
  }

  async function generateAndApply(
    companyId: string,
    input: StorefrontBuilderInput,
    userId: string | null,
  ): Promise<{ plan: StorefrontPlan; result: ApplyPlanResult }> {
    const plan = await generatePlan(input);
    const result = await applyPlan(companyId, plan, userId);
    return { plan, result };
  }

  return { generatePlan, applyPlan, generateAndApply };
}
