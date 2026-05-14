// ---------------------------------------------------------------------------
// BusinessBankingPage (/business/banking)
// ---------------------------------------------------------------------------
//
// Tabs:
//   1. Accounts        — cards per linked account
//   2. Transactions    — filterable list
//   3. Reconciliation  — side-by-side reconciler (powered by TransactionReconciler)
//   4. Settings        — connector list with configuration status

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Building2,
  CheckCircle2,
  CircleSlash,
  CreditCard,
  Landmark,
  Link2,
  Loader2,
  PiggyBank,
  RefreshCcw,
  Settings,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { BankConnectDialog } from "../components/business/BankConnectDialog";
import { TransactionReconciler } from "../components/business/TransactionReconciler";
import {
  businessBankingApi,
  type BankAccountInfo,
  type BankAccountType,
  type BankConnectorName,
  type BankTransaction,
  type ReconciliationStatus,
} from "../api/business-banking";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const ACCOUNT_ICON: Record<BankAccountType, ReactElement> = {
  checking: <Wallet className="h-4 w-4" />,
  savings: <PiggyBank className="h-4 w-4" />,
  credit_card: <CreditCard className="h-4 w-4" />,
  loan: <Banknote className="h-4 w-4" />,
};

const CONNECTOR_LABEL: Record<BankConnectorName, string> = {
  cbk_kuwait: "CBK Kuwait",
  sama_saudi: "SAMA Saudi",
  uae_oba: "UAE OBA",
  plaid: "Plaid",
  mock: "Mock",
};

const CONNECTOR_ENV: Record<BankConnectorName, string[]> = {
  cbk_kuwait: [
    "CBK_OBA_CLIENT_ID",
    "CBK_OBA_CLIENT_SECRET",
    "CBK_OBA_REDIRECT_URI",
    "CBK_OBA_BASE_URL (optional)",
  ],
  sama_saudi: [
    "SAMA_OBA_CLIENT_ID",
    "SAMA_OBA_CLIENT_SECRET",
    "SAMA_OBA_REDIRECT_URI",
    "SAMA_OBA_BASE_URL (optional)",
  ],
  uae_oba: ["(spec pending — defaults to mock)"],
  plaid: ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV"],
  mock: ["(no configuration required)"],
};

const RECON_LABEL: Record<ReconciliationStatus, string> = {
  unreconciled: "Unreconciled",
  auto_matched: "Auto-matched",
  manual_matched: "Matched",
  ignored: "Ignored",
};

const RECON_COLOR: Record<ReconciliationStatus, string> = {
  unreconciled: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  auto_matched:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  manual_matched: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  ignored: "bg-muted text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessBankingPage(): ReactElement {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState("accounts");
  const [connectOpen, setConnectOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | ReconciliationStatus>(
    "all",
  );
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Banking" },
    ]);
  }, [setBreadcrumbs]);

  const accountsQuery = useQuery({
    queryKey: ["business-banking-accounts", selectedCompanyId],
    queryFn: () => businessBankingApi.listAccounts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const txnsQuery = useQuery({
    queryKey: [
      "business-banking-transactions",
      selectedCompanyId,
      { status: statusFilter },
    ],
    queryFn: () =>
      businessBankingApi.listTransactions(selectedCompanyId!, {
        reconciliationStatus:
          statusFilter === "all" ? undefined : statusFilter,
        limit: 500,
      }),
    enabled: !!selectedCompanyId,
  });

  const connectorsQuery = useQuery({
    queryKey: ["business-banking-connectors", selectedCompanyId],
    queryFn: () => businessBankingApi.listConnectors(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const txns = txnsQuery.data?.transactions ?? [];
  const connectors = connectorsQuery.data?.connectors ?? [];

  const totals = useMemo(() => {
    let cashCents = 0;
    let currency = "KWD";
    for (const a of accounts) {
      if (a.type === "checking" || a.type === "savings") {
        cashCents += a.balanceCents;
      }
      currency = a.currency;
    }
    return { cashCents, currency };
  }, [accounts]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Landmark} message="Select a workspace first." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Landmark className="h-5 w-5" />
            Banking
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Open Banking — auto-import bank transactions and reconcile them
            with invoices, expenses, and payments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 ? (
            <div className="hidden text-right md:block">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Cash position
              </p>
              <p className="font-mono text-sm font-semibold tabular-nums">
                {formatAmount(totals.cashCents, totals.currency)}
              </p>
            </div>
          ) : null}
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
            Connect bank
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-3">
          {accountsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : accounts.length === 0 ? (
            <EmptyState
              icon={Building2}
              message="No bank accounts linked yet. Connect a bank to start auto-importing transactions."
              action="Connect bank"
              onAction={() => setConnectOpen(true)}
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {accounts.map((a) => (
                <AccountCard
                  key={a.id}
                  account={a}
                  companyId={selectedCompanyId}
                  onSync={() =>
                    queryClient.invalidateQueries({
                      queryKey: [
                        "business-banking-transactions",
                        selectedCompanyId,
                      ],
                    })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="transactions" className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "unreconciled", "auto_matched", "manual_matched", "ignored"] as const).map(
              (s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "all" ? "All" : RECON_LABEL[s]}
                </Button>
              ),
            )}
            <div className="flex-1" />
            <span className="text-[11px] text-muted-foreground">
              {txns.length} transaction{txns.length === 1 ? "" : "s"}
            </span>
          </div>

          {txnsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : txns.length === 0 ? (
            <EmptyState
              icon={CircleSlash}
              message="No transactions found for this filter."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((t) => (
                      <TxnRow key={t.id} txn={t} />
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="reconciliation" className="mt-3">
          <TransactionReconciler companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="settings" className="mt-3">
          <div className="grid gap-3 md:grid-cols-2">
            {connectors.map((c) => (
              <Card key={c.name}>
                <CardContent className="space-y-2 p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {CONNECTOR_LABEL[c.name]}
                    </p>
                    {c.configured ? (
                      <Badge variant="secondary" className="text-[10px]">
                        <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-600" />
                        configured
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        mock fallback
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Countries: {c.countries.join(", ")}
                  </p>
                  <div className="rounded bg-muted/40 p-2">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Env vars
                    </p>
                    <ul className="space-y-0.5 font-mono text-[10px]">
                      {CONNECTOR_ENV[c.name].map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs">
            <Settings className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Token storage</p>
              <p className="mt-0.5 text-muted-foreground">
                Access tokens are stored base64-encoded in the consent record
                today. A KMS-backed AES-GCM rewrite is planned before
                production. Never expose this storage to untrusted parties.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <BankConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        companyId={selectedCompanyId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AccountCard
// ---------------------------------------------------------------------------

function AccountCard({
  account,
  companyId,
  onSync,
}: {
  account: BankAccountInfo;
  companyId: string;
  onSync: () => void;
}): ReactElement {
  const syncMutation = useMutation({
    mutationFn: () => businessBankingApi.syncAccount(companyId, account.id),
    onSuccess: () => onSync(),
  });

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {ACCOUNT_ICON[account.type]}
              {account.bankName}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {account.accountName} · ••{account.accountNumber}
            </p>
            {account.iban ? (
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {account.iban}
              </p>
            ) : null}
          </div>
          <Badge variant="outline" className="text-[10px] uppercase">
            {account.type.replace("_", " ")}
          </Badge>
        </div>
        <div className="flex items-end justify-between border-t pt-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Balance
            </p>
            <p
              className={`font-mono text-base font-semibold tabular-nums ${
                account.balanceCents < 0 ? "text-red-600" : "text-foreground"
              }`}
            >
              {formatAmount(account.balanceCents, account.currency)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              as of {formatDate(account.asOfDate)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCcw className="mr-1 h-3 w-3" />
            )}
            Sync
          </Button>
        </div>
        {syncMutation.data ? (
          <p className="text-[10px] text-emerald-600">
            <Sparkles className="mr-0.5 inline h-3 w-3" />+{syncMutation.data.newTxns} new
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// TxnRow
// ---------------------------------------------------------------------------

function TxnRow({ txn }: { txn: BankTransaction }): ReactElement {
  const status: ReconciliationStatus = txn.reconciliationStatus;
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2 text-[11px] text-muted-foreground">
        {formatDate(txn.date)}
      </td>
      <td className="px-3 py-2">
        <p className="font-medium">{txn.description}</p>
        {txn.merchantName && txn.merchantName !== txn.description ? (
          <p className="text-[10px] text-muted-foreground">
            {txn.merchantName}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2">
        {txn.category ? (
          <Badge variant="outline" className="text-[10px]">
            {txn.category}
          </Badge>
        ) : null}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono tabular-nums ${
          txn.amountCents >= 0 ? "text-emerald-700" : "text-red-600"
        }`}
      >
        {formatAmount(txn.amountCents, txn.currency)}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${RECON_COLOR[status]}`}
        >
          {RECON_LABEL[status]}
        </span>
      </td>
    </tr>
  );
}
