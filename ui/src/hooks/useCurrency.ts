import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_CURRENCY,
  convertCurrency,
  formatCurrency,
  getDecimals,
  type GccCurrency,
} from "@paperclipai/shared";
import { businessFxApi, type FxRate } from "@/api/business-fx";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "@/context/CompanyContext";

export interface UseCurrencyResult {
  defaultCurrency: GccCurrency;
  formatAmount: (cents: number, currency?: GccCurrency) => string;
  getRate: (from: GccCurrency, to: GccCurrency) => number | null;
  convertCents: (
    cents: number,
    from: GccCurrency,
    to: GccCurrency,
  ) => number;
  isLoading: boolean;
}

/**
 * Convert a minor-unit (cents/fils) amount to its major-unit equivalent
 * using the currency's decimal precision.
 */
function centsToMajor(cents: number, currency: GccCurrency): number {
  return cents / Math.pow(10, getDecimals(currency));
}

export function useCurrency(): UseCurrencyResult {
  const { selectedCompany, selectedCompanyId } = useCompany();

  // The Company type doesn't yet carry a defaultCurrency; we look at an
  // optional `settings.defaultCurrency` if/when it exists, otherwise KWD.
  const defaultCurrency: GccCurrency = useMemo(() => {
    const candidate = (
      selectedCompany as unknown as {
        settings?: { defaultCurrency?: string };
        defaultCurrency?: string;
      } | null
    );
    const raw =
      candidate?.settings?.defaultCurrency ?? candidate?.defaultCurrency;
    if (typeof raw === "string") {
      const upper = raw.toUpperCase() as GccCurrency;
      if (
        upper === "KWD" ||
        upper === "SAR" ||
        upper === "AED" ||
        upper === "QAR" ||
        upper === "BHD" ||
        upper === "OMR"
      ) {
        return upper;
      }
    }
    return DEFAULT_CURRENCY;
  }, [selectedCompany]);

  const ratesQuery = useQuery({
    queryKey: selectedCompanyId
      ? [...queryKeys.business.fxRates, selectedCompanyId]
      : [...queryKeys.business.fxRates, "__no-company__"],
    queryFn: () => businessFxApi.listRates(selectedCompanyId as string),
    enabled: Boolean(selectedCompanyId),
    staleTime: 5 * 60 * 1000,
  });

  const rateMap = useMemo(() => {
    const map = new Map<string, FxRate>();
    for (const r of ratesQuery.data?.rates ?? []) {
      map.set(`${r.base}-${r.quote}`, r);
    }
    return map;
  }, [ratesQuery.data]);

  const getRate = useCallback(
    (from: GccCurrency, to: GccCurrency): number | null => {
      if (from === to) return 1;
      const found = rateMap.get(`${from}-${to}`);
      return found ? found.rate : null;
    },
    [rateMap],
  );

  const convertCents = useCallback(
    (cents: number, from: GccCurrency, to: GccCurrency): number => {
      if (from === to) return Math.round(cents);
      const rate = getRate(from, to);
      if (rate == null) return 0;
      return convertCurrency(cents, from, to, rate);
    },
    [getRate],
  );

  const formatAmount = useCallback(
    (cents: number, currency?: GccCurrency): string => {
      const cur = currency ?? defaultCurrency;
      return formatCurrency(centsToMajor(cents, cur), cur);
    },
    [defaultCurrency],
  );

  return {
    defaultCurrency,
    formatAmount,
    getRate,
    convertCents,
    isLoading: ratesQuery.isLoading,
  };
}
