/**
 * Loyalty program engine for the Retail vertical.
 *
 * Centralises:
 *  - Tier definitions (Bronze / Silver / Gold / Platinum).
 *  - Lifetime-earned thresholds for tier promotion.
 *  - Earn/redeem conversion (points ↔ fils).
 *  - Tier auto-promotion logic so the service layer can keep it in one place
 *    instead of scattering the rules across the service.
 *
 * Pure functions only — no DB / IO. The service layer is responsible for
 * persisting changes.
 */

export interface LoyaltyMember {
  id: string;
  code: string;
  customerId: string;
  customerName: string;
  phone: string;
  email?: string;
  tier: LoyaltyTier;
  pointsBalance: number;
  pointsLifetimeEarned: number;
  pointsLifetimeRedeemed: number;
  birthMonth?: number;
  enrolledAt: string;
  lastActivityAt?: string;
}

export type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";

export interface LoyaltyTierSpec {
  minLifetimePoints: number;
  multiplier: number;
  label: string;
  labelAr: string;
}

export const LOYALTY_TIERS: Record<LoyaltyTier, LoyaltyTierSpec> = {
  bronze: { minLifetimePoints: 0, multiplier: 1.0, label: "Bronze", labelAr: "برونزي" },
  silver: { minLifetimePoints: 500, multiplier: 1.2, label: "Silver", labelAr: "فضي" },
  gold: { minLifetimePoints: 2000, multiplier: 1.5, label: "Gold", labelAr: "ذهبي" },
  platinum: { minLifetimePoints: 5000, multiplier: 2.0, label: "Platinum", labelAr: "بلاتيني" },
};

/** Customer earns 10 points per 1 KWD spent (before tier multiplier). */
export const POINTS_PER_KWD = 10;

/** 100 points = 1 KWD when redeemed. So 1 point = 10 fils (0.010 KWD). */
export const KWD_PER_POINT = 100;

/** Convenience: fils equivalent of 1 redeemed point. */
export const FILS_PER_REDEEMED_POINT = 1000 / KWD_PER_POINT; // = 10

/**
 * Compute how many points a sale of `amountCents` earns for the given tier.
 *
 * The amount is the total **after** discounts and tax — loyalty earn rate
 * applies to the value the customer actually paid. Cents → KWD is integer
 * division (1000 fils per KWD), then multiplied by POINTS_PER_KWD and the
 * tier multiplier. We `floor` the result so customers never get rounded-up
 * "phantom" points.
 */
export function calculatePointsEarned(amountCents: number, tier: LoyaltyTier | string): number {
  if (amountCents <= 0) return 0;
  const spec = LOYALTY_TIERS[(tier as LoyaltyTier) in LOYALTY_TIERS ? (tier as LoyaltyTier) : "bronze"];
  // amountCents is in fils → divide by 1000 to get KWD.
  return Math.floor((amountCents * POINTS_PER_KWD * spec.multiplier) / 1000);
}

/**
 * Convert `points` to a redeemable fils amount. 100 points = 1 KWD = 1000 fils.
 * So 1 point = 10 fils.
 */
export function calculatePointsValue(points: number): number {
  if (points <= 0) return 0;
  return Math.floor(points * FILS_PER_REDEEMED_POINT);
}

/**
 * Determine which tier a member belongs to given their lifetime-earned points.
 * Returns the highest tier whose threshold they have crossed.
 */
export function computeTier(lifetimeEarned: number): LoyaltyTier {
  // Walk from highest to lowest so the first match wins.
  const order: LoyaltyTier[] = ["platinum", "gold", "silver", "bronze"];
  for (const t of order) {
    if (lifetimeEarned >= LOYALTY_TIERS[t].minLifetimePoints) return t;
  }
  return "bronze";
}

/**
 * Whether `member` can spend `requiredPoints` from their current balance.
 */
export function checkSufficientPoints(
  member: Pick<LoyaltyMember, "pointsBalance">,
  requiredPoints: number,
): boolean {
  if (requiredPoints <= 0) return true;
  return member.pointsBalance >= Math.floor(requiredPoints);
}

/**
 * Apply an "earn" event to a member object (pure: returns new state).
 * Auto-promotes the tier if the new lifetime-earned crosses a threshold.
 */
export function applyEarn(member: LoyaltyMember, points: number): LoyaltyMember {
  const earned = Math.max(0, Math.floor(points));
  const lifetime = member.pointsLifetimeEarned + earned;
  return {
    ...member,
    pointsBalance: member.pointsBalance + earned,
    pointsLifetimeEarned: lifetime,
    tier: computeTier(lifetime),
    lastActivityAt: new Date().toISOString(),
  };
}

/**
 * Apply a "redeem" event. Throws if the balance is insufficient — the caller
 * (service) is expected to have validated with `checkSufficientPoints` first.
 */
export function applyRedeem(member: LoyaltyMember, points: number): LoyaltyMember {
  const redeemed = Math.max(0, Math.floor(points));
  if (member.pointsBalance < redeemed) {
    throw new Error(
      `Loyalty member ${member.code} has insufficient points (balance=${member.pointsBalance}, requested=${redeemed})`,
    );
  }
  return {
    ...member,
    pointsBalance: member.pointsBalance - redeemed,
    pointsLifetimeRedeemed: member.pointsLifetimeRedeemed + redeemed,
    lastActivityAt: new Date().toISOString(),
  };
}

/**
 * Object-style facade matching the spec in the build prompt.
 */
export interface LoyaltyEngine {
  calculatePointsEarned(amountCents: number, tier: string): number;
  calculatePointsValue(points: number): number;
  computeTier(lifetimeEarned: number): LoyaltyTier;
  checkSufficientPoints(member: LoyaltyMember, requiredPoints: number): boolean;
  applyEarn(member: LoyaltyMember, points: number): LoyaltyMember;
  applyRedeem(member: LoyaltyMember, points: number): LoyaltyMember;
}

export const loyaltyEngine: LoyaltyEngine = {
  calculatePointsEarned,
  calculatePointsValue,
  computeTier,
  checkSufficientPoints,
  applyEarn,
  applyRedeem,
};
