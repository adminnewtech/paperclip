import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Layers } from "lucide-react";
import { Link } from "@/lib/router";
import type { ChartOfAccount } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { businessAccountingApi } from "../api/business-accounting";

function formatCurrency(cents: number, currency = "KWD"): string {
  try {
    return (cents / 100).toLocaleString(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function BusinessLedgerPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [accountCode, setAccountCode] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Accounting", href: "/business/accounting" },
      { label: "General Ledger" },
    ]);
  }, [setBreadcrumbs]);

  const accountsQuery = useQuery({
    queryKey: ["business-accounting", "accounts", selectedCompanyId],
    queryFn: () => businessAccountingApi.listAccounts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const accounts: ChartOfAccount[] = accountsQuery.data?.accounts ?? [];
  // Default to first account once accounts arrive.
  useEffect(() => {
    if (!accountCode && accounts.length > 0) {
      setAccountCode(accounts[0]!.code);
    }
  }, [accounts, accountCode]);

  const ledgerQuery = useQuery({
    queryKey: [
      "business-accounting",
      "ledger",
      selectedCompanyId,
      accountCode,
      from,
      to,
    ],
    queryFn: () =>
      businessAccountingApi.getLedger(selectedCompanyId!, accountCode, {
        from: from || undefined,
        to: to || undefined,
      }),
    enabled: !!selectedCompanyId && !!accountCode,
  });

  if (!selectedCompanyId) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business/accounting">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">General Ledger</h1>
          <p className="text-sm text-muted-foreground">
            Account-by-account transaction history.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={accountCode} onValueChange={setAccountCode}>
          <SelectTrigger className="w-72 h-9">
            <SelectValue placeholder="Select account…" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.code} value={a.code}>
                <span className="font-mono mr-2">{a.code}</span>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          className="w-auto"
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={to}
          className="w-auto"
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {!accountCode ? (
        <EmptyState
          icon={Layers}
          message="Choose an account to view its ledger entries."
        />
      ) : ledgerQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : (ledgerQuery.data?.lines.length ?? 0) === 0 ? (
        <EmptyState
          icon={Layers}
          message="No posted transactions for this account in the selected range."
        />
      ) : (
        <div className="border rounded-md overflow-hidden">
          <div className="px-4 py-3 bg-muted border-b flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                {ledgerQuery.data?.account.code} —{" "}
                {ledgerQuery.data?.account.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {ledgerQuery.data?.account.type} ·{" "}
                {ledgerQuery.data?.account.subtype}
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Current balance</div>
              <div className="text-lg font-mono font-semibold">
                {formatCurrency(
                  ledgerQuery.data?.lines.at(-1)?.runningBalanceCents ?? 0,
                  ledgerQuery.data?.account.currency,
                )}
              </div>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium">Date</th>
                <th className="px-3 py-2 text-left text-xs font-medium">Entry</th>
                <th className="px-3 py-2 text-left text-xs font-medium">Description</th>
                <th className="px-3 py-2 text-right text-xs font-medium">Debit</th>
                <th className="px-3 py-2 text-right text-xs font-medium">Credit</th>
                <th className="px-3 py-2 text-right text-xs font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ledgerQuery.data?.lines.map((line, i) => (
                <tr key={`${line.entryId}-${i}`} className="hover:bg-accent/30">
                  <td className="px-3 py-1.5 text-xs">{line.date}</td>
                  <td className="px-3 py-1.5 text-xs font-mono">{line.entryNumber}</td>
                  <td className="px-3 py-1.5 text-xs">{line.description}</td>
                  <td className="px-3 py-1.5 text-xs font-mono text-right tabular-nums">
                    {line.debitCents
                      ? formatCurrency(
                          line.debitCents,
                          ledgerQuery.data?.account.currency,
                        )
                      : ""}
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono text-right tabular-nums">
                    {line.creditCents
                      ? formatCurrency(
                          line.creditCents,
                          ledgerQuery.data?.account.currency,
                        )
                      : ""}
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono text-right tabular-nums font-semibold">
                    {formatCurrency(
                      line.runningBalanceCents,
                      ledgerQuery.data?.account.currency,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
