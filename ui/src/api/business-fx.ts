import type { GccCurrency } from "@paperclipai/shared";
import { api } from "./client";

export type FxRateSource = "manual" | "cbk" | "sama" | "mock";

export interface FxRate {
  base: GccCurrency;
  quote: GccCurrency;
  rate: number;
  fetchedAt: string;
  source: FxRateSource;
}

export interface FxRatesResponse {
  rates: FxRate[];
}

export interface FxRatesRefreshResponse {
  refreshed: boolean;
  rates: FxRate[];
}

export const businessFxApi = {
  listRates: (companyId: string, base?: GccCurrency) => {
    const qs = base ? `?base=${encodeURIComponent(base)}` : "";
    return api.get<FxRatesResponse>(
      `/companies/${companyId}/business/fx-rates${qs}`,
    );
  },

  getRate: (companyId: string, from: GccCurrency, to: GccCurrency) =>
    api.get<FxRate>(
      `/companies/${companyId}/business/fx-rates/${from}/${to}`,
    ),

  refreshRates: (companyId: string) =>
    api.post<FxRatesRefreshResponse>(
      `/companies/${companyId}/business/fx-rates/refresh`,
      {},
    ),

  updateRate: (
    companyId: string,
    from: GccCurrency,
    to: GccCurrency,
    rate: number,
  ) =>
    api.put<FxRate>(
      `/companies/${companyId}/business/fx-rates/${from}/${to}`,
      { rate },
    ),
};
