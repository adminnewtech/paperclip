// ---------------------------------------------------------------------------
// TransactionReconciler
// ---------------------------------------------------------------------------
//
// Side-by-side reconciliation view:
//   - Left column: scrollable list of unreconciled bank transactions
//   - Center: details for the selected transaction
//   - Right: ranked match suggestions with score / reasons / Match button
//
// Below the panels: Ignore button + a placeholder for a manual-match search
// (deferred to a separate task; the API path exists via the standard
// /business/banking/transactions/:id/match endpoint).

import { useEffect, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Check,
  EyeOff,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  businessBankingApi,
  type BankTransaction,
  type MatchSuggestion,
} from "../../api/business-banking";

function formatAmount(amountCents: number, currency: string): string {
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 3 : 2;
  return `${(amountCents / Math.pow(10, decimals)).toFixed(decimals)} ${currency}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface TransactionReconcilerProps {
  companyId: string;
}

export function TransactionReconciler({
  companyId,
}: TransactionReconcilerProps): ReactElement {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");

  const txnsQuery = useQuery({
    queryKey: [
      "business-banking-transactions",
      companyId,
      { reconciliationStatus: "unreconciled" },
    ],
    queryFn: () =>
      businessBankingApi.listTransactions(companyId, {
        reconciliationStatus: "unreconciled",
        limit: 200,
      }),
  });

  const unreconciled = txnsQuery.data?.transactions ?? [];

  // Auto-select the first txn when none is selected.
  useEffect(() => {
    if (!selectedId && unreconciled.length > 0) {
      setSelectedId(unreconciled[0]!.id);
    }
  }, [selectedId, unreconciled]);

  const selectedTxn = unreconciled.find((t) => t.id === selectedId) ?? null;

  const suggestionsQuery = useQuery({
    queryKey: ["business-banking-match-suggestions", companyId, selectedId],
    queryFn: () =>
      selectedId
        ? businessBankingApi.matchSuggestions(companyId, selectedId)
        : Promise.resolve({ suggestions: [] as MatchSuggestion[] }),
    enabled: !!selectedId,
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ["business-banking-transactions", companyId],
    });
    queryClient.invalidateQueries({
      queryKey: ["business-banking-match-suggestions", companyId, selectedId],
    });
  }

  const matchMutation = useMutation({
    mutationFn: async (s: MatchSuggestion) => {
      if (!selectedId) return;
      await businessBankingApi.match(companyId, selectedId, {
        entityId: s.candidateEntityId,
        entityType: s.candidateEntityType,
      });
    },
    onSuccess: () => {
      // Move to next unreconciled txn.
      const idx = unreconciled.findIndex((t) => t.id === selectedId);
      const next = unreconciled[idx + 1] ?? unreconciled[idx - 1] ?? null;
      setSelectedId(next?.id ?? null);
      invalidate();
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) return;
      await businessBankingApi.ignore(
        companyId,
        selectedId,
        ignoreReason || undefined,
      );
    },
    onSuccess: () => {
      setIgnoreReason("");
      const idx = unreconciled.findIndex((t) => t.id === selectedId);
      const next = unreconciled[idx + 1] ?? unreconciled[idx - 1] ?? null;
      setSelectedId(next?.id ?? null);
      invalidate();
    },
  });

  const autoMutation = useMutation({
    mutationFn: () => businessBankingApi.autoReconcile(companyId),
    onSuccess: () => invalidate(),
  });

  if (txnsQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading transactions…
      </div>
    );
  }

  if (unreconciled.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
        <Sparkles className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
        <p>All bank transactions have been reconciled.</p>
        <p className="mt-1 text-xs">
          Sync your accounts to import new transactions.
        </p>
      </div>
    );
  }

  return (
    <div className="grid h-[640px] gap-3 lg:grid-cols-[260px_1fr_360px]">
      {/* Left: unreconciled list */}
      <div className="flex flex-col rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-xs font-medium">
            Unreconciled · {unreconciled.length}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => autoMutation.mutate()}
            disabled={autoMutation.isPending}
          >
            {autoMutation.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3 w-3" />
            )}
            Auto-reconcile
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {unreconciled.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={`flex w-full items-start gap-2 border-b px-3 py-2 text-left text-xs transition-colors ${
                selectedId === t.id ? "bg-muted/60" : "hover:bg-muted/30"
              }`}
            >
              {t.amountCents >= 0 ? (
                <ArrowDownCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <ArrowUpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.description}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {formatDate(t.date)}
                </p>
              </div>
              <span
                className={`font-mono tabular-nums ${
                  t.amountCents >= 0 ? "text-emerald-700" : "text-red-600"
                }`}
              >
                {formatAmount(t.amountCents, t.currency)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Center: selected txn */}
      <div className="flex flex-col rounded-md border bg-card">
        <div className="border-b px-3 py-2 text-xs font-medium">
          Transaction detail
        </div>
        {selectedTxn ? (
          <SelectedTxnPanel txn={selectedTxn} />
        ) : (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Select a transaction.
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-auto space-y-2 border-t bg-muted/30 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Manual options
          </p>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Ignore reason (optional)"
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              className="h-7 text-xs"
              disabled={!selectedTxn}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => ignoreMutation.mutate()}
              disabled={!selectedTxn || ignoreMutation.isPending}
            >
              <EyeOff className="mr-1 h-3 w-3" />
              Ignore
            </Button>
          </div>
        </div>
      </div>

      {/* Right: suggestions */}
      <div className="flex flex-col rounded-md border bg-card">
        <div className="border-b px-3 py-2 text-xs font-medium">
          Suggested matches
        </div>
        <div className="flex-1 overflow-y-auto">
          {suggestionsQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Scoring candidates…
            </div>
          ) : suggestionsQuery.data?.suggestions.length ? (
            <ul className="divide-y">
              {suggestionsQuery.data.suggestions.map((s) => (
                <SuggestionCard
                  key={s.candidateEntityId}
                  suggestion={s}
                  txnCurrency={selectedTxn?.currency ?? "KWD"}
                  onMatch={() => matchMutation.mutate(s)}
                  disabled={matchMutation.isPending}
                />
              ))}
            </ul>
          ) : (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No good candidates found. Try Ignore, or open the entity manually.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectedTxnPanel({ txn }: { txn: BankTransaction }): ReactElement {
  return (
    <div className="space-y-3 p-4 text-xs">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Description
        </p>
        <p className="text-sm font-medium">{txn.description}</p>
        {txn.merchantName ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {txn.merchantName}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Amount
          </p>
          <p
            className={`font-mono text-sm tabular-nums ${
              txn.amountCents >= 0 ? "text-emerald-700" : "text-red-600"
            }`}
          >
            {formatAmount(txn.amountCents, txn.currency)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Date
          </p>
          <p>{formatDate(txn.date)}</p>
        </div>
        {txn.reference ? (
          <div className="col-span-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Reference
            </p>
            <p className="font-mono text-[11px]">{txn.reference}</p>
          </div>
        ) : null}
        {txn.category ? (
          <div className="col-span-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Category
            </p>
            <Badge variant="secondary" className="text-[10px]">
              {txn.category}
            </Badge>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  txnCurrency,
  onMatch,
  disabled,
}: {
  suggestion: MatchSuggestion;
  txnCurrency: string;
  onMatch: () => void;
  disabled: boolean;
}): ReactElement {
  const pct = Math.round(suggestion.matchScore * 100);
  const scoreColor =
    suggestion.matchScore >= 0.95
      ? "text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30"
      : suggestion.matchScore >= 0.8
        ? "text-amber-700 bg-amber-100 dark:bg-amber-900/30"
        : "text-muted-foreground bg-muted";
  return (
    <li className="space-y-1.5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">
            {suggestion.candidateDescription || "(no description)"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {suggestion.candidateEntityType} · {formatDate(suggestion.candidateDate)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${scoreColor}`}
        >
          {pct}%
        </span>
      </div>
      <p className="font-mono text-[11px] tabular-nums">
        {formatAmount(suggestion.candidateAmount, txnCurrency)}
      </p>
      <div className="flex flex-wrap gap-1">
        {suggestion.matchReasons.map((r) => (
          <Badge key={r} variant="outline" className="text-[9px]">
            {r}
          </Badge>
        ))}
      </div>
      <Button
        size="sm"
        className="mt-1 h-6 w-full text-[11px]"
        onClick={onMatch}
        disabled={disabled}
      >
        <Check className="mr-1 h-3 w-3" />
        Match
      </Button>
    </li>
  );
}
