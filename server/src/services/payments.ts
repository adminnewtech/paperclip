// ---------------------------------------------------------------------------
// Local GCC payment rails (pure, sandbox-only, no network).
//
// Models which payment providers are available per market and provides
// deterministic sandbox validation and fee estimation. NO real gateway calls
// are made — this is offline configuration/estimation logic.
// ---------------------------------------------------------------------------

export type PaymentProvider =
  | "knet"
  | "mada"
  | "tabby"
  | "tamara"
  | "myfatoorah"
  | "applepay"
  | string;

export type GccCountry = "KW" | "SA" | "AE" | string;

const GATEWAYS_BY_COUNTRY: Record<string, PaymentProvider[]> = {
  KW: ["knet", "myfatoorah", "tabby", "applepay"],
  SA: ["mada", "tabby", "tamara", "applepay"],
  AE: ["tabby", "tamara", "applepay"],
};

/** Providers available for a given country. Unknown countries → empty list. */
export function availableGateways(
  country: GccCountry | null | undefined,
): PaymentProvider[] {
  const list = GATEWAYS_BY_COUNTRY[(country ?? "").toUpperCase()];
  return list ? [...list] : [];
}

export interface PaymentValidation {
  ok: boolean;
  reason?: string;
}

// BNPL (buy-now-pay-later) providers enforce a minimum order amount.
const BNPL_PROVIDERS = new Set(["tabby", "tamara"]);
const BNPL_MIN_MINOR = 1000; // sandbox minimum (e.g. 10.00 in 2-decimal currency)

/**
 * Sandbox-only payment validation. Checks the provider is known, the amount is
 * positive, the currency is present, and BNPL minimums are met. NO network.
 */
export function validatePayment(params: {
  provider: PaymentProvider;
  amountMinor: number;
  currency: string;
}): PaymentValidation {
  const provider = (params.provider ?? "").toLowerCase();
  const known = new Set<string>([
    "knet",
    "mada",
    "tabby",
    "tamara",
    "myfatoorah",
    "applepay",
  ]);
  if (!known.has(provider)) {
    return { ok: false, reason: `Unknown payment provider: ${params.provider}` };
  }
  if (!Number.isInteger(params.amountMinor) || params.amountMinor <= 0) {
    return { ok: false, reason: "Amount must be a positive integer (minor units)" };
  }
  if (!params.currency || params.currency.trim().length === 0) {
    return { ok: false, reason: "Currency is required" };
  }
  if (BNPL_PROVIDERS.has(provider) && params.amountMinor < BNPL_MIN_MINOR) {
    return {
      ok: false,
      reason: `BNPL provider ${provider} requires at least ${BNPL_MIN_MINOR} minor units`,
    };
  }
  return { ok: true };
}

const BPS_DENOMINATOR = 10_000;

// Deterministic sandbox fee model. KNET is a flat fee; cards/wallets are a
// percentage in basis points; BNPL providers take a larger merchant cut.
const FLAT_FEE_MINOR: Record<string, number> = {
  knet: 25, // flat per-transaction fee
};
const PERCENT_FEE_BPS: Record<string, number> = {
  mada: 100, // 1.0%
  myfatoorah: 200, // 2.0%
  applepay: 250, // 2.5%
  tabby: 600, // 6.0% (BNPL)
  tamara: 600, // 6.0% (BNPL)
};

/**
 * Deterministic fee estimate in minor units for a provider + amount. Flat-fee
 * providers (KNET) return a fixed fee; percentage providers compute bps of the
 * amount. Unknown providers → 0. Sandbox estimate only — not authoritative.
 */
export function paymentFeeMinor(params: {
  provider: PaymentProvider;
  amountMinor: number;
}): number {
  const provider = (params.provider ?? "").toLowerCase();
  const amount = Math.max(0, Math.round(params.amountMinor));

  if (provider in FLAT_FEE_MINOR) {
    return FLAT_FEE_MINOR[provider] ?? 0;
  }
  const bps = PERCENT_FEE_BPS[provider];
  if (typeof bps === "number") {
    return Math.round((amount * bps) / BPS_DENOMINATOR);
  }
  return 0;
}
