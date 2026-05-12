import { describe, expect, it } from "vitest";
import {
  convertCurrency,
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  formatCurrency,
  GCC_COUNTRIES,
  GCC_COUNTRY_CODES,
  GCC_CURRENCIES,
  GCC_CURRENCY_CODES,
  getDecimals,
  isGccCountryCode,
  isGccCurrency,
  parseCurrency,
} from "../gcc-locale.js";

describe("gcc-locale: registry completeness", () => {
  it("registers all 6 GCC currencies", () => {
    expect(GCC_CURRENCY_CODES).toHaveLength(6);
    for (const code of GCC_CURRENCY_CODES) {
      expect(GCC_CURRENCIES[code]).toBeDefined();
      expect(GCC_CURRENCIES[code].code).toBe(code);
      expect(GCC_CURRENCIES[code].decimals).toBeGreaterThanOrEqual(2);
      expect(GCC_CURRENCIES[code].decimals).toBeLessThanOrEqual(3);
    }
  });

  it("registers all 6 GCC countries with a known currency and a VAT rate", () => {
    expect(GCC_COUNTRY_CODES).toHaveLength(6);
    for (const code of GCC_COUNTRY_CODES) {
      const info = GCC_COUNTRIES[code];
      expect(info).toBeDefined();
      expect(info.code).toBe(code);
      expect(GCC_CURRENCIES[info.currency]).toBeDefined();
      expect(typeof info.vatRate).toBe("number");
      expect(info.vatRate).toBeGreaterThanOrEqual(0);
      expect(info.phoneCountryCode.startsWith("+")).toBe(true);
    }
  });

  it("Kuwait is the default country/currency", () => {
    expect(DEFAULT_COUNTRY).toBe("KW");
    expect(DEFAULT_CURRENCY).toBe("KWD");
    expect(GCC_COUNTRIES.KW.currency).toBe("KWD");
  });

  it("KWD/BHD/OMR use 3 decimal places, SAR/AED/QAR use 2", () => {
    expect(getDecimals("KWD")).toBe(3);
    expect(getDecimals("BHD")).toBe(3);
    expect(getDecimals("OMR")).toBe(3);
    expect(getDecimals("SAR")).toBe(2);
    expect(getDecimals("AED")).toBe(2);
    expect(getDecimals("QAR")).toBe(2);
  });

  it("Kuwait has no VAT but other countries do", () => {
    expect(GCC_COUNTRIES.KW.vatRate).toBe(0);
    expect(GCC_COUNTRIES.SA.vatRate).toBeGreaterThan(0);
    expect(GCC_COUNTRIES.AE.vatRate).toBeGreaterThan(0);
  });
});

describe("gcc-locale: isGccCurrency / isGccCountryCode", () => {
  it("type-guards valid codes", () => {
    expect(isGccCurrency("KWD")).toBe(true);
    expect(isGccCurrency("SAR")).toBe(true);
    expect(isGccCurrency("USD")).toBe(false);
    expect(isGccCurrency(42)).toBe(false);
    expect(isGccCurrency(null)).toBe(false);
  });

  it("type-guards valid country codes", () => {
    expect(isGccCountryCode("KW")).toBe(true);
    expect(isGccCountryCode("US")).toBe(false);
    expect(isGccCountryCode(undefined)).toBe(false);
  });
});

describe("gcc-locale: formatCurrency", () => {
  it("KWD always renders with 3 decimal places", () => {
    const out = formatCurrency(1.5, "KWD", "en-US");
    expect(out).toMatch(/1\.500/);
  });

  it("SAR renders with 2 decimal places", () => {
    const out = formatCurrency(1.5, "SAR", "en-US");
    expect(out).toMatch(/1\.50/);
  });

  it("does not throw on weird locales (falls back to symbol)", () => {
    expect(() => formatCurrency(10, "OMR", "zz-ZZ")).not.toThrow();
  });
});

describe("gcc-locale: parseCurrency", () => {
  it("parses plain decimal strings", () => {
    expect(parseCurrency("1234.56", "SAR")).toBeCloseTo(1234.56, 2);
    expect(parseCurrency("1.500", "KWD")).toBeCloseTo(1.5, 3);
  });

  it("strips currency symbols and grouping characters", () => {
    expect(parseCurrency("$1,234.56", "SAR")).toBeCloseTo(1234.56, 2);
    expect(parseCurrency("د.ك 2.250", "KWD")).toBeCloseTo(2.25, 3);
  });

  it("translates Arabic-Indic digits to western digits", () => {
    expect(parseCurrency("٥٠٠٠", "SAR")).toBe(5000);
    expect(parseCurrency("١٢٣٤.٥٦", "SAR")).toBeCloseTo(1234.56, 2);
  });

  it("returns NaN when the value cannot be parsed", () => {
    expect(Number.isNaN(parseCurrency("not a number", "SAR"))).toBe(true);
    expect(Number.isNaN(parseCurrency("", "SAR"))).toBe(true);
  });

  it("returns NaN on non-string inputs", () => {
    expect(
      Number.isNaN(parseCurrency(undefined as unknown as string, "SAR")),
    ).toBe(true);
  });

  it("rounds to the currency precision", () => {
    // KWD = 3 decimals; 1.23456 should round to 1.235
    expect(parseCurrency("1.23456", "KWD")).toBeCloseTo(1.235, 3);
    // SAR = 2 decimals; 1.239 should round to 1.24
    expect(parseCurrency("1.239", "SAR")).toBeCloseTo(1.24, 2);
  });
});

describe("gcc-locale: convertCurrency", () => {
  it("returns the amount unchanged when from===to", () => {
    expect(convertCurrency(1000, "SAR", "SAR", 1)).toBe(1000);
    expect(convertCurrency(1500, "KWD", "KWD", 7.6)).toBe(1500);
  });

  it("converts KWD → SAR at a fixed rate, respecting different decimals", () => {
    // 1.000 KWD (=1000 fils) at 12.20 SAR per KWD → 12.20 SAR = 1220 halalas.
    const out = convertCurrency(1000, "KWD", "SAR", 12.2);
    expect(out).toBe(1220);
  });

  it("converts SAR → KWD at a fixed rate", () => {
    // 100 SAR (=10000 halalas) at 0.082 KWD per SAR → 8.2 KWD = 8200 fils.
    const out = convertCurrency(10000, "SAR", "KWD", 0.082);
    expect(out).toBe(8200);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(convertCurrency(Number.NaN, "SAR", "KWD", 1)).toBe(0);
    expect(convertCurrency(100, "SAR", "KWD", Number.POSITIVE_INFINITY)).toBe(0);
  });
});
