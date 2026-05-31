// ---------------------------------------------------------------------------
// VAT engine (pure, unit-testable, no DB).
//
// GCC VAT rates differ by country:
//   - KSA (SA): 15%  → 1500 bps
//   - UAE (AE):  5%  →  500 bps
//   - Kuwait (KW): no VAT (0%) → 0 bps
// Amounts are integer minor units; rates are expressed in basis points (bps)
// where 10_000 bps = 100%.
// ---------------------------------------------------------------------------

const BPS_DENOMINATOR = 10_000;

export type GccCountry = "SA" | "AE" | "KW" | string;

/** VAT rate in basis points for a GCC country. Unknown countries → 0. */
export function vatRateBps(country: GccCountry | null | undefined): number {
  switch ((country ?? "").toUpperCase()) {
    case "SA":
      return 1500;
    case "AE":
      return 500;
    case "KW":
      return 0;
    default:
      return 0;
  }
}

export interface VatComputation {
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
}

/**
 * Compute VAT for an amount. When `inclusive` is true the provided `netMinor` is
 * treated as a VAT-inclusive gross figure and the net + tax are extracted from
 * it; otherwise VAT is added on top of the net. All integer-safe in minor units.
 */
export function computeVat(params: {
  netMinor: number;
  country: GccCountry | null | undefined;
  inclusive?: boolean;
}): VatComputation {
  const rateBps = vatRateBps(params.country);
  const amount = Math.max(0, Math.round(params.netMinor));

  if (rateBps === 0) {
    return { netMinor: amount, vatMinor: 0, grossMinor: amount };
  }

  if (params.inclusive) {
    // amount is gross; back out the net and VAT.
    const grossMinor = amount;
    const netMinor = Math.round(
      (grossMinor * BPS_DENOMINATOR) / (BPS_DENOMINATOR + rateBps),
    );
    const vatMinor = grossMinor - netMinor;
    return { netMinor, vatMinor, grossMinor };
  }

  // amount is net; add VAT on top.
  const netMinor = amount;
  const vatMinor = Math.round((netMinor * rateBps) / BPS_DENOMINATOR);
  const grossMinor = netMinor + vatMinor;
  return { netMinor, vatMinor, grossMinor };
}

export interface VatDocument {
  /** Net (pre-tax) amount in minor units. */
  netMinor: number;
  /** Optional explicit VAT amount in minor units; computed when omitted. */
  vatMinor?: number;
  /** Whether netMinor is VAT-inclusive (gross). Defaults to false. */
  inclusive?: boolean;
}

export interface VatReturn {
  outputVatMinor: number;
  inputVatMinor: number;
  netVatDueMinor: number;
}

/**
 * Compute a VAT return period summary:
 *   output VAT = VAT collected on sales invoices
 *   input VAT  = VAT paid on purchase bills (recoverable)
 *   net VAT due = output - input (positive = owed to the authority)
 * Each document either carries an explicit vatMinor or has it derived from its
 * net amount and the country rate.
 */
export function vatReturn(
  invoices: VatDocument[],
  bills: VatDocument[],
  country: GccCountry | null | undefined,
): VatReturn {
  const sumVat = (docs: VatDocument[]): number =>
    docs.reduce((sum, doc) => {
      if (typeof doc.vatMinor === "number") {
        return sum + Math.max(0, Math.round(doc.vatMinor));
      }
      const { vatMinor } = computeVat({
        netMinor: doc.netMinor,
        country,
        inclusive: doc.inclusive,
      });
      return sum + vatMinor;
    }, 0);

  const outputVatMinor = sumVat(invoices);
  const inputVatMinor = sumVat(bills);
  return {
    outputVatMinor,
    inputVatMinor,
    netVatDueMinor: outputVatMinor - inputVatMinor,
  };
}
