/**
 * GCC (Gulf Cooperation Council) currency, country, and locale constants.
 *
 * Kuwait-first: defaults select KWD/KW. Other GCC nations follow.
 *
 * Currency precision is critical: KWD, BHD, OMR use 3 decimal places
 * (1 KWD = 1000 fils). SAR, AED, QAR use 2 decimal places.
 */

export type GccCurrency = "KWD" | "SAR" | "AED" | "QAR" | "BHD" | "OMR";

export type GccCountryCode = "KW" | "SA" | "AE" | "QA" | "BH" | "OM";

export interface GccCurrencyInfo {
  code: GccCurrency;
  /** English name */
  name: string;
  /** Arabic name */
  nameAr: string;
  /** Currency symbol (Arabic glyph) */
  symbol: string;
  /** Decimal places used for the minor unit. KWD/BHD/OMR = 3, others = 2. */
  decimals: number;
  /** Default BCP-47 locale tag */
  defaultLocale: string;
}

export interface GccCountryInfo {
  code: GccCountryCode;
  name: string;
  nameAr: string;
  currency: GccCurrency;
  /** Standard VAT rate (percent). Kuwait currently has no VAT. */
  vatRate: number;
  vatRateLabel: string;
  /** Address fields, ordered for the country's typical postal layout. */
  addressFields: string[];
  /** International dialing prefix (e.g. "+965") */
  phoneCountryCode: string;
  /** Flag emoji */
  flag: string;
}

export const GCC_CURRENCIES: Record<GccCurrency, GccCurrencyInfo> = {
  KWD: {
    code: "KWD",
    name: "Kuwaiti Dinar",
    nameAr: "دينار كويتي",
    symbol: "د.ك",
    decimals: 3,
    defaultLocale: "ar-KW",
  },
  SAR: {
    code: "SAR",
    name: "Saudi Riyal",
    nameAr: "ريال سعودي",
    symbol: "ر.س",
    decimals: 2,
    defaultLocale: "ar-SA",
  },
  AED: {
    code: "AED",
    name: "UAE Dirham",
    nameAr: "درهم إماراتي",
    symbol: "د.إ",
    decimals: 2,
    defaultLocale: "ar-AE",
  },
  QAR: {
    code: "QAR",
    name: "Qatari Riyal",
    nameAr: "ريال قطري",
    symbol: "ر.ق",
    decimals: 2,
    defaultLocale: "ar-QA",
  },
  BHD: {
    code: "BHD",
    name: "Bahraini Dinar",
    nameAr: "دينار بحريني",
    symbol: "د.ب",
    decimals: 3,
    defaultLocale: "ar-BH",
  },
  OMR: {
    code: "OMR",
    name: "Omani Rial",
    nameAr: "ريال عماني",
    symbol: "ر.ع",
    decimals: 3,
    defaultLocale: "ar-OM",
  },
};

export const GCC_COUNTRIES: Record<GccCountryCode, GccCountryInfo> = {
  KW: {
    code: "KW",
    name: "Kuwait",
    nameAr: "الكويت",
    currency: "KWD",
    vatRate: 0,
    vatRateLabel: "No VAT",
    addressFields: [
      "block",
      "street",
      "avenue",
      "building",
      "floor",
      "apartment",
    ],
    phoneCountryCode: "+965",
    flag: "\u{1F1F0}\u{1F1FC}",
  },
  SA: {
    code: "SA",
    name: "Saudi Arabia",
    nameAr: "المملكة العربية السعودية",
    currency: "SAR",
    vatRate: 15,
    vatRateLabel: "15% VAT",
    addressFields: [
      "buildingNumber",
      "street",
      "district",
      "city",
      "postalCode",
      "additionalNumber",
    ],
    phoneCountryCode: "+966",
    flag: "\u{1F1F8}\u{1F1E6}",
  },
  AE: {
    code: "AE",
    name: "United Arab Emirates",
    nameAr: "الإمارات العربية المتحدة",
    currency: "AED",
    vatRate: 5,
    vatRateLabel: "5% VAT",
    addressFields: ["building", "street", "area", "city", "poBox"],
    phoneCountryCode: "+971",
    flag: "\u{1F1E6}\u{1F1EA}",
  },
  QA: {
    code: "QA",
    name: "Qatar",
    nameAr: "قطر",
    currency: "QAR",
    vatRate: 5,
    vatRateLabel: "5% VAT",
    addressFields: ["building", "street", "zone", "city", "poBox"],
    phoneCountryCode: "+974",
    flag: "\u{1F1F6}\u{1F1E6}",
  },
  BH: {
    code: "BH",
    name: "Bahrain",
    nameAr: "البحرين",
    currency: "BHD",
    vatRate: 10,
    vatRateLabel: "10% VAT",
    addressFields: ["building", "road", "block", "area", "city"],
    phoneCountryCode: "+973",
    flag: "\u{1F1E7}\u{1F1ED}",
  },
  OM: {
    code: "OM",
    name: "Oman",
    nameAr: "عُمان",
    currency: "OMR",
    vatRate: 5,
    vatRateLabel: "5% VAT",
    addressFields: ["way", "building", "area", "city", "postalCode"],
    phoneCountryCode: "+968",
    flag: "\u{1F1F4}\u{1F1F2}",
  },
};

export const DEFAULT_COUNTRY: GccCountryCode = "KW";
export const DEFAULT_CURRENCY: GccCurrency = "KWD";

export const GCC_CURRENCY_CODES: readonly GccCurrency[] = [
  "KWD",
  "SAR",
  "AED",
  "QAR",
  "BHD",
  "OMR",
] as const;

export const GCC_COUNTRY_CODES: readonly GccCountryCode[] = [
  "KW",
  "SA",
  "AE",
  "QA",
  "BH",
  "OM",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getDecimals(currency: GccCurrency): number {
  return GCC_CURRENCIES[currency].decimals;
}

export function isGccCurrency(value: unknown): value is GccCurrency {
  return typeof value === "string" && value in GCC_CURRENCIES;
}

export function isGccCountryCode(value: unknown): value is GccCountryCode {
  return typeof value === "string" && value in GCC_COUNTRIES;
}

/**
 * Format a major-unit amount using Intl with currency-appropriate decimals.
 * `amount` is in major units (e.g. 1.5 KWD), not the minor unit (1500 fils).
 */
export function formatCurrency(
  amount: number,
  currency: GccCurrency,
  locale?: string,
): string {
  const info = GCC_CURRENCIES[currency];
  const useLocale = locale ?? info.defaultLocale;
  try {
    return new Intl.NumberFormat(useLocale, {
      style: "currency",
      currency,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(amount);
  } catch {
    // Fallback if the runtime can't resolve the locale.
    return `${info.symbol} ${amount.toFixed(info.decimals)}`;
  }
}

/**
 * Parse a currency-formatted string back to a major-unit number.
 * Strips currency symbols, grouping characters, and Arabic-Indic digits.
 * Returns NaN on failure.
 */
export function parseCurrency(value: string, currency: GccCurrency): number {
  if (typeof value !== "string") return NaN;
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const easternArabicDigits = "۰۱۲۳۴۵۶۷۸۹";
  let normalized = "";
  for (const ch of value) {
    const ai = arabicDigits.indexOf(ch);
    if (ai >= 0) {
      normalized += String(ai);
      continue;
    }
    const ei = easternArabicDigits.indexOf(ch);
    if (ei >= 0) {
      normalized += String(ei);
      continue;
    }
    normalized += ch;
  }
  // Strip everything except digits, decimal separator, and minus
  // Replace Arabic decimal separator "٫" already handled (Western "."); also accept ","
  const cleaned = normalized
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, ".")
    // Collapse multiple decimal separators: keep only the last one as decimal.
    .replace(/\.(?=.*\.)/g, "");
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return NaN;
  // Round to the currency's precision
  const decimals = getDecimals(currency);
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

/**
 * Convert an amount in minor units (cents / fils) from one currency to
 * another using the provided exchange rate (units of `to` per 1 unit of `from`).
 *
 * The math accounts for differing decimal precisions between currencies.
 */
export function convertCurrency(
  amountCents: number,
  from: GccCurrency,
  to: GccCurrency,
  rate: number,
): number {
  if (!Number.isFinite(amountCents) || !Number.isFinite(rate)) return 0;
  if (from === to) return Math.round(amountCents);
  const fromDecimals = getDecimals(from);
  const toDecimals = getDecimals(to);
  const fromMajor = amountCents / Math.pow(10, fromDecimals);
  const toMajor = fromMajor * rate;
  return Math.round(toMajor * Math.pow(10, toDecimals));
}
