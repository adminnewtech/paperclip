import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, FileText, Receipt, Plus, BarChart3, Clock } from "lucide-react";
import {
  currencyFractionDigits,
  minorToMajor,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  financeApi,
  type BankAccountRow,
  type InvoiceLine,
  type InvoiceRow,
  type BillRow,
} from "../api/finance";

const DEFAULT_CURRENCY = "KWD";
const TABS = [
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "bills", label: "Bills", icon: Receipt },
  { key: "banking", label: "Banking", icon: Banknote },
  { key: "statements", label: "Statements", icon: BarChart3 },
  { key: "aging", label: "Aging", icon: Clock },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function formatMinor(amountMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return `${minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

export function Finance() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<TabKey>("invoices");

  useEffect(() => {
    setBreadcrumbs([{ label: "Finance" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Banknote}
        message="Select a workspace to manage finance."
      />
    );
  }

  return (
    <div className="space-y-6" dir="auto">
      <div>
        <h1 className="text-2xl font-semibold">Finance</h1>
        <p className="text-sm text-muted-foreground">
          Manage receivables, payables, banking, and financial statements.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                active
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "invoices" && <InvoicesTab companyId={selectedCompanyId} />}
      {tab === "bills" && <BillsTab companyId={selectedCompanyId} />}
      {tab === "banking" && <BankingTab companyId={selectedCompanyId} />}
      {tab === "statements" && <StatementsTab companyId={selectedCompanyId} />}
      {tab === "aging" && <AgingTab companyId={selectedCompanyId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoices tab
// ---------------------------------------------------------------------------
function InvoicesTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const invoicesQuery = useQuery({
    queryKey: ["finance", "invoices", companyId],
    queryFn: () => financeApi.listInvoices(companyId),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["finance", "invoices", companyId],
    });

  const postMutation = useMutation({
    mutationFn: (id: string) => financeApi.postInvoice(companyId, id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Invoice posted", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to post invoice",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, amountMinor }: { id: string; amountMinor: number }) =>
      financeApi.payInvoice(companyId, id, { amountMinor }),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Payment recorded", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to record payment",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (invoicesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (invoicesQuery.isError) {
    return (
      <EmptyState
        icon={FileText}
        message={
          (invoicesQuery.error as Error)?.message ?? "Failed to load invoices."
        }
      />
    );
  }

  const invoices = invoicesQuery.data?.invoices ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New invoice
        </Button>
      </div>

      {invoices.length === 0 ? (
        <EmptyState icon={FileText} message="No invoices yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Number</th>
                  <th className="text-start font-medium px-4 py-2">Customer</th>
                  <th className="text-end font-medium px-4 py-2">Total</th>
                  <th className="text-end font-medium px-4 py-2">Paid</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                  <th className="text-end font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono">{inv.number ?? "—"}</td>
                    <td className="px-4 py-2">{inv.customerName ?? "—"}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(inv.totalMinor, inv.currency)}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-muted-foreground">
                      {formatMinor(inv.paidMinor, inv.currency)}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-2 text-end space-x-2 whitespace-nowrap">
                      {!inv.journalEntryId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={postMutation.isPending}
                          onClick={() => postMutation.mutate(inv.id)}
                        >
                          Post
                        </Button>
                      )}
                      {inv.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={payMutation.isPending}
                          onClick={() =>
                            payMutation.mutate({
                              id: inv.id,
                              amountMinor: inv.totalMinor - inv.paidMinor,
                            })
                          }
                        >
                          Pay
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <DocumentDialog
        kind="invoice"
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        onCreated={invalidate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bills tab
// ---------------------------------------------------------------------------
function BillsTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const billsQuery = useQuery({
    queryKey: ["finance", "bills", companyId],
    queryFn: () => financeApi.listBills(companyId),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["finance", "bills", companyId] });

  const postMutation = useMutation({
    mutationFn: (id: string) => financeApi.postBill(companyId, id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Bill posted", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to post bill",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, amountMinor }: { id: string; amountMinor: number }) =>
      financeApi.payBill(companyId, id, { amountMinor }),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Payment recorded", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to record payment",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (billsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (billsQuery.isError) {
    return (
      <EmptyState
        icon={Receipt}
        message={(billsQuery.error as Error)?.message ?? "Failed to load bills."}
      />
    );
  }

  const bills = billsQuery.data?.bills ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New bill
        </Button>
      </div>

      {bills.length === 0 ? (
        <EmptyState icon={Receipt} message="No bills yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Number</th>
                  <th className="text-start font-medium px-4 py-2">Vendor</th>
                  <th className="text-end font-medium px-4 py-2">Total</th>
                  <th className="text-end font-medium px-4 py-2">Paid</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                  <th className="text-end font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={bill.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono">{bill.number ?? "—"}</td>
                    <td className="px-4 py-2">{bill.vendorName ?? "—"}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(bill.totalMinor, bill.currency)}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-muted-foreground">
                      {formatMinor(bill.paidMinor, bill.currency)}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={bill.status} />
                    </td>
                    <td className="px-4 py-2 text-end space-x-2 whitespace-nowrap">
                      {!bill.journalEntryId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={postMutation.isPending}
                          onClick={() => postMutation.mutate(bill.id)}
                        >
                          Post
                        </Button>
                      )}
                      {bill.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={payMutation.isPending}
                          onClick={() =>
                            payMutation.mutate({
                              id: bill.id,
                              amountMinor: bill.totalMinor - bill.paidMinor,
                            })
                          }
                        >
                          Pay
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <DocumentDialog
        kind="bill"
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        onCreated={invalidate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banking tab
// ---------------------------------------------------------------------------
function BankingTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["finance", "bank-accounts", companyId],
    queryFn: () => financeApi.listBankAccounts(companyId),
    enabled: !!companyId,
  });

  const txQuery = useQuery({
    queryKey: ["finance", "bank-transactions", companyId],
    queryFn: () => financeApi.listBankTransactions(companyId),
    enabled: !!companyId,
  });

  const createAccount = useMutation({
    mutationFn: () =>
      financeApi.createBankAccount(companyId, {
        name: name.trim(),
        accountNumber: accountNumber.trim() || undefined,
        currency: DEFAULT_CURRENCY,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["finance", "bank-accounts", companyId],
      });
      setDialogOpen(false);
      setName("");
      setAccountNumber("");
      pushToast({ title: "Bank account created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create bank account",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const reconcile = useMutation({
    mutationFn: (id: string) =>
      financeApi.reconcileBankTransaction(companyId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["finance", "bank-transactions", companyId],
      });
      pushToast({ title: "Transaction reconciled", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to reconcile",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (accountsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (accountsQuery.isError) {
    return (
      <EmptyState
        icon={Banknote}
        message={
          (accountsQuery.error as Error)?.message ??
          "Failed to load bank accounts."
        }
      />
    );
  }

  const accounts = accountsQuery.data?.bankAccounts ?? [];
  const transactions = txQuery.data?.bankTransactions ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New bank account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState icon={Banknote} message="No bank accounts yet." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {accounts.map((acct: BankAccountRow) => (
            <Card key={acct.id}>
              <CardContent className="p-4">
                <div className="font-medium">{acct.name}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  {acct.accountNumber ?? "—"}
                </div>
                <div className="text-lg font-semibold mt-2 font-mono">
                  {formatMinor(acct.balanceMinor, acct.currency)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium mb-2">Transactions</h2>
        {transactions.length === 0 ? (
          <EmptyState icon={Banknote} message="No bank transactions." />
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-start font-medium px-4 py-2">Date</th>
                    <th className="text-start font-medium px-4 py-2">
                      Description
                    </th>
                    <th className="text-end font-medium px-4 py-2">Amount</th>
                    <th className="text-end font-medium px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-2">
                        {tx.date ? new Date(tx.date).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-2">{tx.description ?? "—"}</td>
                      <td className="px-4 py-2 text-end font-mono">
                        {formatMinor(tx.amountMinor, DEFAULT_CURRENCY)}
                      </td>
                      <td className="px-4 py-2 text-end">
                        {tx.reconciled ? (
                          <span className="text-emerald-500 text-xs">
                            Reconciled
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={reconcile.isPending}
                            onClick={() => reconcile.mutate(tx.id)}
                          >
                            Reconcile
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New bank account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="bank-name">Name</Label>
              <Input
                id="bank-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Main operating account"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-number">Account number</Label>
              <Input
                id="bank-number"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="KW..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createAccount.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createAccount.mutate()}
              disabled={!name.trim() || createAccount.isPending}
            >
              {createAccount.isPending ? "Creating…" : "Create account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statements tab
// ---------------------------------------------------------------------------
function StatementsTab({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const statementsQuery = useQuery({
    queryKey: ["finance", "statements", companyId, from, to],
    queryFn: () =>
      financeApi.statements(
        companyId,
        from ? new Date(from).toISOString() : undefined,
        to ? new Date(to).toISOString() : undefined,
      ),
    enabled: !!companyId,
  });

  if (statementsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (statementsQuery.isError) {
    return (
      <EmptyState
        icon={BarChart3}
        message={
          (statementsQuery.error as Error)?.message ??
          "Failed to load statements."
        }
      />
    );
  }

  const data = statementsQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4 space-y-2">
              <h2 className="font-semibold">Profit &amp; Loss</h2>
              <StatementRow
                label="Revenue"
                amountMinor={data.pnl.revenueMinor}
              />
              <StatementRow
                label="Expenses"
                amountMinor={data.pnl.expenseMinor}
              />
              <div className="border-t border-border pt-2">
                <StatementRow
                  label="Net income"
                  amountMinor={data.pnl.netIncomeMinor}
                  bold
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-2">
              <h2 className="font-semibold">Balance Sheet</h2>
              <StatementRow
                label="Assets"
                amountMinor={data.balanceSheet.assetsMinor}
              />
              <StatementRow
                label="Liabilities"
                amountMinor={data.balanceSheet.liabilitiesMinor}
              />
              <StatementRow
                label="Equity"
                amountMinor={data.balanceSheet.equityMinor}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatementRow({
  label,
  amountMinor,
  bold,
}: {
  label: string;
  amountMinor: number;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex justify-between text-sm ${bold ? "font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className="font-mono">{formatMinor(amountMinor, DEFAULT_CURRENCY)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aging tab
// ---------------------------------------------------------------------------
function AgingTab({ companyId }: { companyId: string }) {
  const [kind, setKind] = useState<"ar" | "ap">("ar");

  const agingQuery = useQuery({
    queryKey: ["finance", "aging", companyId, kind],
    queryFn: () => financeApi.aging(companyId, kind),
    enabled: !!companyId,
  });

  const buckets = agingQuery.data?.buckets;
  const rows = useMemo(
    () =>
      buckets
        ? [
            { label: "Current", value: buckets.current },
            { label: "1–30 days", value: buckets.days1to30 },
            { label: "31–60 days", value: buckets.days31to60 },
            { label: "61–90 days", value: buckets.days61to90 },
            { label: "90+ days", value: buckets.days90plus },
          ]
        : [],
    [buckets],
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={kind === "ar" ? "default" : "outline"}
          onClick={() => setKind("ar")}
        >
          Receivable (AR)
        </Button>
        <Button
          size="sm"
          variant={kind === "ap" ? "default" : "outline"}
          onClick={() => setKind("ap")}
        >
          Payable (AP)
        </Button>
      </div>

      {agingQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : agingQuery.isError ? (
        <EmptyState
          icon={Clock}
          message={
            (agingQuery.error as Error)?.message ?? "Failed to load aging."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Bucket</th>
                  <th className="text-end font-medium px-4 py-2">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.label}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">{row.label}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(row.value, DEFAULT_CURRENCY)}
                    </td>
                  </tr>
                ))}
                {buckets && (
                  <tr className="font-semibold">
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(buckets.totalOutstanding, DEFAULT_CURRENCY)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared: status badge + create dialog (invoice/bill)
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "paid"
      ? "text-emerald-500"
      : status === "overdue"
        ? "text-red-500"
        : status === "void"
          ? "text-muted-foreground"
          : "text-amber-500";
  return <span className={`text-xs capitalize ${tone}`}>{status}</span>;
}

interface DocumentDialogProps {
  kind: "invoice" | "bill";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onCreated: () => void;
}

function DocumentDialog({
  kind,
  open,
  onOpenChange,
  companyId,
  onCreated,
}: DocumentDialogProps) {
  const { pushToast } = useToast();
  const [party, setParty] = useState("");
  const [number, setNumber] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [taxRatePct, setTaxRatePct] = useState("0");
  const [lines, setLines] = useState<InvoiceLine[]>([
    { description: "", qty: 1, unitPriceMinor: 0 },
  ]);

  const fractionDigits = currencyFractionDigits(DEFAULT_CURRENCY);
  const minorPerMajor = Math.round(10 ** fractionDigits);

  const subtotalMinor = lines.reduce(
    (sum, l) => sum + Math.round(l.qty * l.unitPriceMinor),
    0,
  );
  const taxMinor = Math.round((subtotalMinor * (Number(taxRatePct) || 0)) / 100);
  const totalMinor = subtotalMinor + taxMinor;

  function reset() {
    setParty("");
    setNumber("");
    setDueDate("");
    setTaxRatePct("0");
    setLines([{ description: "", qty: 1, unitPriceMinor: 0 }]);
  }

  const createMutation = useMutation<InvoiceRow | BillRow, Error, void>({
    mutationFn: async () => {
      const common = {
        number: number.trim() || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        subtotalMinor,
        taxMinor,
        totalMinor,
        currency: DEFAULT_CURRENCY,
        lines,
      };
      if (kind === "invoice") {
        return financeApi.createInvoice(companyId, {
          ...common,
          customerName: party.trim() || undefined,
        });
      }
      return financeApi.createBill(companyId, {
        ...common,
        vendorName: party.trim() || undefined,
      });
    },
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      reset();
      pushToast({
        title: kind === "invoice" ? "Invoice created" : "Bill created",
        tone: "success",
      });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  function updateLine(idx: number, patch: Partial<InvoiceLine>) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            New {kind === "invoice" ? "invoice" : "bill"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="party">
                {kind === "invoice" ? "Customer" : "Vendor"}
              </Label>
              <Input
                id="party"
                value={party}
                onChange={(e) => setParty(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="number">Number</Label>
              <Input
                id="number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due">Due date</Label>
              <Input
                id="due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    { description: "", qty: 1, unitPriceMinor: 0 },
                  ])
                }
              >
                <Plus className="me-1 h-3 w-3" />
                Add line
              </Button>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-6"
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={0}
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) =>
                    updateLine(idx, { qty: Number(e.target.value) || 0 })
                  }
                />
                <Input
                  className="col-span-4"
                  type="number"
                  min={0}
                  step={1 / minorPerMajor}
                  placeholder={`Unit price (${DEFAULT_CURRENCY})`}
                  value={
                    line.unitPriceMinor
                      ? line.unitPriceMinor / minorPerMajor
                      : ""
                  }
                  onChange={(e) =>
                    updateLine(idx, {
                      unitPriceMinor: Math.round(
                        (Number(e.target.value) || 0) * minorPerMajor,
                      ),
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="tax">Tax rate %</Label>
              <Input
                id="tax"
                type="number"
                min={0}
                max={100}
                value={taxRatePct}
                onChange={(e) => setTaxRatePct(e.target.value)}
              />
            </div>
            <div className="text-sm space-y-1 text-end">
              <div className="text-muted-foreground">
                Subtotal: {formatMinor(subtotalMinor, DEFAULT_CURRENCY)}
              </div>
              <div className="text-muted-foreground">
                Tax: {formatMinor(taxMinor, DEFAULT_CURRENCY)}
              </div>
              <div className="font-semibold">
                Total: {formatMinor(totalMinor, DEFAULT_CURRENCY)}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={subtotalMinor <= 0 || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
