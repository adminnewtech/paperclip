/**
 * GOSI (Saudi General Organization for Social Insurance) contribution rates.
 *
 * These rates govern the monthly social-insurance contributions that Saudi
 * private-sector employers must remit to GOSI on behalf of their employees.
 * They differ for Saudi and non-Saudi (expat) employees.
 *
 * References:
 *   - https://www.gosi.gov.sa
 *   - SAMA / Ministry of Human Resources guidance
 *
 * IMPORTANT: All percentages are expressed as decimal fractions (e.g. 0.09
 * means 9%). Salary inputs are in **halalas** (1 SAR = 100 halalas) for
 * consistency with the rest of the codebase, which always stores money in
 * the smallest currency unit.
 *
 * Rate breakdown (2026):
 *
 *   Saudi employees:
 *     Employee contribution           9%   (5% old-age + 4% unemployment "SANED")
 *     Employer contribution           9%   (old-age)
 *     Employer SANED                  2%   (unemployment, employer share)
 *     Employer occupational hazards   2%
 *     ----------------------------------
 *     Effective employer total       13%   (legacy headline: 11% old-age + 2% hazards)
 *
 *   Non-Saudi employees:
 *     Employee contribution           0%
 *     Employer contribution           2%   (occupational hazards only)
 *
 *   Salary base:
 *     Floor    1,500 SAR  ( 150,000 halalas)
 *     Ceiling 45,000 SAR  (4,500,000 halalas)
 *
 * Notes:
 *   - The "contributory wage" subject to GOSI is the sum of the employee's
 *     basic salary + housing allowance, capped at the ceiling and floored at
 *     the floor.
 *   - Some employers also include transportation in the contributory wage —
 *     we keep it strictly to basic + housing here (the conservative default).
 *   - "SANED" is the Saudi unemployment-insurance scheme; only Saudi nationals
 *     are eligible, hence the 0% for non-Saudis.
 */

export type GosiNationality = "saudi" | "non_saudi";

export interface GosiRates {
  /** Employee share, as a decimal fraction (e.g. 0.09 = 9%). */
  employeePercent: number;
  /** Employer share, as a decimal fraction. */
  employerPercent: number;
}

export const GOSI_RATES_SAUDI: GosiRates = {
  // 5% old-age + 4% SANED (unemployment, employee share)
  employeePercent: 0.09,
  // 9% old-age + 2% SANED (employer) + 2% occupational hazards = 13%
  employerPercent: 0.13,
};

export const GOSI_RATES_NON_SAUDI: GosiRates = {
  employeePercent: 0,
  // 2% occupational hazards only
  employerPercent: 0.02,
};

/** Monthly contributory wage floor in halalas (1,500 SAR). */
export const GOSI_SALARY_FLOOR_CENTS = 1_500 * 100;
/** Monthly contributory wage ceiling in halalas (45,000 SAR). */
export const GOSI_SALARY_CEILING_CENTS = 45_000 * 100;

export function getGosiRates(nationality: GosiNationality): GosiRates {
  return nationality === "saudi" ? GOSI_RATES_SAUDI : GOSI_RATES_NON_SAUDI;
}

/**
 * Clamp a contributory wage (basic + housing, in halalas) to the GOSI
 * floor/ceiling. Values below the floor are raised; values above the ceiling
 * are capped.
 */
export function clampGosiContributoryWageCents(cents: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return GOSI_SALARY_FLOOR_CENTS;
  if (cents < GOSI_SALARY_FLOOR_CENTS) return GOSI_SALARY_FLOOR_CENTS;
  if (cents > GOSI_SALARY_CEILING_CENTS) return GOSI_SALARY_CEILING_CENTS;
  return Math.round(cents);
}
