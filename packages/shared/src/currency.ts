/**
 * Currency minor-unit helpers.
 *
 * Business entities store monetary values as integers in the currency's
 * smallest unit (`amountCents`). Most currencies use 2 decimal places
 * (100 minor units), but GCC currencies (KWD, BHD, OMR) and TND use 3
 * (1000 minor units), and a few use 0 (JPY, KRW). Using a fixed /100
 * divisor mis-displays GCC amounts by 10×.
 */

/** Currencies with 3 decimal places (1000 minor units per major unit). */
const THREE_DECIMAL = new Set(["KWD", "BHD", "OMR", "TND", "IQD", "JOD", "LYD"]);

/** Currencies with 0 decimal places (1 minor unit per major unit). */
const ZERO_DECIMAL = new Set([
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "ISK",
  "UGX",
  "XAF",
  "XOF",
  "PYG",
  "RWF",
]);

/** Number of minor units per major unit for a currency code. Defaults to 100. */
export function currencyMinorUnits(currency: string | null | undefined): number {
  if (!currency) return 100;
  const code = currency.toUpperCase();
  if (THREE_DECIMAL.has(code)) return 1000;
  if (ZERO_DECIMAL.has(code)) return 1;
  return 100;
}

/** Number of fraction digits to display for a currency code. */
export function currencyFractionDigits(currency: string | null | undefined): number {
  const units = currencyMinorUnits(currency);
  return units === 1000 ? 3 : units === 1 ? 0 : 2;
}

/** Convert an integer minor-unit amount to a major-unit number (e.g. 69900 KWD fils → 69.9). */
export function minorToMajor(
  amountMinor: number,
  currency: string | null | undefined,
): number {
  return amountMinor / currencyMinorUnits(currency);
}

/** Convert a major-unit number to an integer minor-unit amount (e.g. 69.9 KWD → 69900). */
export function majorToMinor(
  amountMajor: number,
  currency: string | null | undefined,
): number {
  return Math.round(amountMajor * currencyMinorUnits(currency));
}
