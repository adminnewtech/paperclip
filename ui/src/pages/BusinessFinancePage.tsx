import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calculator,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BookOpen,
  Receipt,
  FileText,
  ArrowLeft,
  ChevronRight,
  Search,
  AlertCircle,
} from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(cents: number, currency = "SAR"): string {
  return (cents / 100).toLocaleString("en-SA", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Account type config
// ---------------------------------------------------------------------------

const ACCOUNT_TYPES = [
  { value: "asset", label: "Assets", color: "text-blue-600 dark:text-blue-400", headerBg: "bg-blue-50 dark:bg-blue-950/30" },
  { value: "liability", label: "Liabilities", color: "text-amber-600 dark:text-amber-400", headerBg: "bg-amber-50 dark:bg-amber-950/30" },
  { value: "equity", label: "Equity", color: "text-purple-600 dark:text-purple-400", headerBg: "bg-purple-50 dark:bg-purple-950/30" },
  { value: "revenue", label: "Revenue", color: "text-emerald-600 dark:text-emerald-400", headerBg: "bg-emerald-50 dark:bg-emerald-950/30" },
  { value: "expense", label: "Expenses", color: "text-red-600 dark:text-red-400", headerBg: "bg-red-50 dark:bg-red-950/30" },
] as const;

type AccountType = (typeof ACCOUNT_TYPES)[number]["value"];

// ---------------------------------------------------------------------------
// Chart of Accounts
// ---------------------------------------------------------------------------

interface CreateAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

function CreateAccountDialog({ open, onOpenChange, companyId }: CreateAccountDialogProps) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("asset");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      businessApi.createEntity(companyId, "finance", "account", {
        entityType: "account",
        code: code || null,
        name,
        status: "active",
        data: { type, description },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "finance", "account"),
      });
      onOpenChange(false);
      setCode("");
      setName("");
      setType("asset");
      setDescription("");
    },
  });

  function handleSubmit() {
    if (!name.trim()) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Account</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Account Code</Label>
              <Input
                placeholder="e.g. 1001"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Account Type <span className="text-destructive">*</span>
              </Label>
              <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Account Name <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="e.g. Cash and Cash Equivalents"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              rows={2}
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create Account"}
          </Button>
        </DialogFooter>
        {mutation.error && (
          <p className="text-sm text-destructive mt-1">
            {(mutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChartOfAccountsTab({ companyId }: { companyId: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "finance", "account"),
    queryFn: () => businessApi.listEntities(companyId, "finance", "account"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessApi.deleteEntity(companyId, "finance", "account", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "finance", "account"),
      });
    },
  });

  const accounts = accountsQuery.data?.entities ?? [];

  const byType = useMemo(() => {
    const map: Record<AccountType, BusinessEntityRow[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };
    for (const acc of accounts) {
      const type = ((acc.data as Record<string, unknown>).type as AccountType) ?? "asset";
      const bucket = map[type] ?? map["asset"];
      if (q) {
        const lower = q.toLowerCase();
        if (
          !(acc.name ?? "").toLowerCase().includes(lower) &&
          !(acc.code ?? "").toLowerCase().includes(lower)
        ) {
          continue;
        }
      }
      bucket.push(acc);
    }
    return map;
  }, [accounts, q]);

  const totalsByType = useMemo(() => {
    const totals: Record<AccountType, number> = {
      asset: 0,
      liability: 0,
      equity: 0,
      revenue: 0,
      expense: 0,
    };
    for (const acc of accounts) {
      const type = ((acc.data as Record<string, unknown>).type as AccountType) ?? "asset";
      totals[type] = (totals[type] ?? 0) + (acc.amountCents ?? 0);
    }
    return totals;
  }, [accounts]);

  if (accountsQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search accounts…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          message="No accounts yet. Add accounts to build your chart of accounts."
          action="New Account"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="space-y-4">
          {ACCOUNT_TYPES.map(({ value: type, label, color, headerBg }) => {
            const accs = (byType[type] ?? []).sort((a, b) =>
              (a.code ?? "").localeCompare(b.code ?? ""),
            );
            if (accs.length === 0) return null;
            return (
              <div key={type} className="border rounded-lg overflow-hidden">
                <div
                  className={`flex items-center justify-between px-4 py-2.5 ${headerBg}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold uppercase tracking-wider ${color}`}>
                      {label}
                    </span>
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {accs.length}
                    </Badge>
                  </div>
                  {totalsByType[type] > 0 && (
                    <span className={`text-xs font-mono font-semibold ${color}`}>
                      {formatCurrency(totalsByType[type])}
                    </span>
                  )}
                </div>
                <div className="divide-y">
                  {accs.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex items-center gap-3 px-4 py-2.5 bg-card hover:bg-muted/30 group"
                    >
                      <span className="font-mono text-xs text-muted-foreground w-14 shrink-0 tabular-nums">
                        {acc.code ?? "—"}
                      </span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{acc.name}</span>
                        {!!(acc.data as Record<string, unknown>).description && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {String((acc.data as Record<string, unknown>).description)}
                          </p>
                        )}
                      </div>
                      {acc.amountCents != null && acc.amountCents > 0 && (
                        <span className="text-sm font-mono tabular-nums">
                          {formatCurrency(acc.amountCents, acc.currency ?? "SAR")}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(acc.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 transition-opacity"
                        title="Delete account"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateAccountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// P&L Statement
// ---------------------------------------------------------------------------

function ProfitAndLossTab({ companyId }: { companyId: string }) {
  const accountsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "finance", "account"),
    queryFn: () => businessApi.listEntities(companyId, "finance", "account"),
  });

  const expensesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "finance", "expense"),
    queryFn: () => businessApi.listEntities(companyId, "finance", "expense"),
  });

  const salesInvoicesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "sales", "invoice"),
    queryFn: () => businessApi.listEntities(companyId, "sales", "invoice"),
    retry: false,
  });

  const financialSummaryQuery = useQuery({
    queryKey: queryKeys.business.financialSummary(companyId),
    queryFn: () => businessApi.financialSummary(companyId),
  });

  const isLoading =
    accountsQuery.isLoading || expensesQuery.isLoading || financialSummaryQuery.isLoading;

  const pl = useMemo(() => {
    const accounts = accountsQuery.data?.entities ?? [];
    const expenses = expensesQuery.data?.entities ?? [];
    const invoices = salesInvoicesQuery.data?.entities ?? [];

    // Revenue accounts
    const revenueAccounts = accounts.filter(
      (a) => (a.data as Record<string, unknown>).type === "revenue",
    );
    const revenueFromAccounts = revenueAccounts.reduce(
      (sum, a) => sum + (a.amountCents ?? 0),
      0,
    );

    // Revenue from paid invoices (sales module)
    const revenueFromInvoices = invoices
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + (i.amountCents ?? 0), 0);

    const totalRevenue = revenueFromAccounts + revenueFromInvoices;

    // Expense accounts
    const expenseAccounts = accounts.filter(
      (a) => (a.data as Record<string, unknown>).type === "expense",
    );
    const expensesFromAccounts = expenseAccounts.reduce(
      (sum, a) => sum + (a.amountCents ?? 0),
      0,
    );

    // Expenses from expense entities
    const expensesFromEntities = expenses.reduce(
      (sum, e) => sum + (e.amountCents ?? 0),
      0,
    );

    const totalExpenses = expensesFromAccounts + expensesFromEntities;
    const netIncome = totalRevenue - totalExpenses;

    return {
      revenueAccounts,
      revenueFromAccounts,
      revenueFromInvoices,
      totalRevenue,
      expenseAccounts,
      expensesFromAccounts,
      expensesFromEntities,
      totalExpenses,
      netIncome,
    };
  }, [accountsQuery.data, expensesQuery.data, salesInvoicesQuery.data]);

  if (isLoading) return <PageSkeleton variant="list" />;

  const netIncomePositive = pl.netIncome >= 0;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header KPI Strip */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <p className="text-xs text-muted-foreground">Total Revenue</p>
            </div>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {formatCurrency(pl.totalRevenue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <p className="text-xs text-muted-foreground">Total Expenses</p>
            </div>
            <p className="text-xl font-bold text-red-600 dark:text-red-400 tabular-nums">
              {formatCurrency(pl.totalExpenses)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className={`h-4 w-4 ${netIncomePositive ? "text-emerald-500" : "text-red-500"}`} />
              <p className="text-xs text-muted-foreground">Net Income</p>
            </div>
            <p
              className={`text-xl font-bold tabular-nums ${
                netIncomePositive
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {formatCurrency(pl.netIncome)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* P&L Statement */}
      <div className="border rounded-lg overflow-hidden">
        {/* Revenue Section */}
        <div className="bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Revenue
          </span>
        </div>

        {pl.revenueFromInvoices > 0 && (
          <div className="flex items-center justify-between px-6 py-2.5 bg-card border-b">
            <span className="text-sm text-muted-foreground">Sales Invoices (Paid)</span>
            <span className="text-sm font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrency(pl.revenueFromInvoices)}
            </span>
          </div>
        )}

        {pl.revenueAccounts.map((acc) => (
          <div
            key={acc.id}
            className="flex items-center justify-between px-6 py-2.5 bg-card border-b hover:bg-muted/30"
          >
            <div className="flex items-center gap-2">
              {acc.code && (
                <span className="font-mono text-xs text-muted-foreground w-12">{acc.code}</span>
              )}
              <span className="text-sm">{acc.name}</span>
            </div>
            <span className="text-sm font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrency(acc.amountCents ?? 0, acc.currency ?? "SAR")}
            </span>
          </div>
        ))}

        {pl.revenueAccounts.length === 0 && pl.revenueFromInvoices === 0 && (
          <div className="px-6 py-3 text-sm text-muted-foreground/60 bg-card border-b italic">
            No revenue recorded
          </div>
        )}

        {/* Revenue Subtotal */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-50/60 dark:bg-emerald-950/20 border-b">
          <span className="text-sm font-semibold">Total Revenue</span>
          <span className="text-sm font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatCurrency(pl.totalRevenue)}
          </span>
        </div>

        {/* Expenses Section */}
        <div className="bg-red-50 dark:bg-red-950/30 px-4 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-400">
            Expenses
          </span>
        </div>

        {pl.expenseAccounts.map((acc) => (
          <div
            key={acc.id}
            className="flex items-center justify-between px-6 py-2.5 bg-card border-b hover:bg-muted/30"
          >
            <div className="flex items-center gap-2">
              {acc.code && (
                <span className="font-mono text-xs text-muted-foreground w-12">{acc.code}</span>
              )}
              <span className="text-sm">{acc.name}</span>
            </div>
            <span className="text-sm font-mono tabular-nums text-red-600 dark:text-red-400">
              {formatCurrency(acc.amountCents ?? 0, acc.currency ?? "SAR")}
            </span>
          </div>
        ))}

        {pl.expensesFromEntities > 0 && (
          <div className="flex items-center justify-between px-6 py-2.5 bg-card border-b">
            <span className="text-sm text-muted-foreground">Recorded Expenses</span>
            <span className="text-sm font-mono tabular-nums text-red-600 dark:text-red-400">
              {formatCurrency(pl.expensesFromEntities)}
            </span>
          </div>
        )}

        {pl.expenseAccounts.length === 0 && pl.expensesFromEntities === 0 && (
          <div className="px-6 py-3 text-sm text-muted-foreground/60 bg-card border-b italic">
            No expenses recorded
          </div>
        )}

        {/* Expenses Subtotal */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-red-50/60 dark:bg-red-950/20 border-b">
          <span className="text-sm font-semibold">Total Expenses</span>
          <span className="text-sm font-bold font-mono tabular-nums text-red-600 dark:text-red-400">
            ({formatCurrency(pl.totalExpenses)})
          </span>
        </div>

        {/* Net Income */}
        <div
          className={`flex items-center justify-between px-4 py-3.5 ${
            netIncomePositive
              ? "bg-emerald-100 dark:bg-emerald-900/30"
              : "bg-red-100 dark:bg-red-900/30"
          }`}
        >
          <span className="font-bold text-sm">Net Income</span>
          <span
            className={`font-bold text-base font-mono tabular-nums ${
              netIncomePositive
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-red-700 dark:text-red-400"
            }`}
          >
            {netIncomePositive ? "" : "("}
            {formatCurrency(Math.abs(pl.netIncome))}
            {netIncomePositive ? "" : ")"}
          </span>
        </div>
      </div>

      {!netIncomePositive && pl.netIncome !== 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400">
            Expenses exceed revenue by {formatCurrency(Math.abs(pl.netIncome))}. Review your expense accounts.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expenses Tab
// ---------------------------------------------------------------------------

const EXPENSE_CATEGORIES = [
  "Office & Supplies",
  "Travel & Transportation",
  "Software & Technology",
  "Marketing & Advertising",
  "Salaries & Benefits",
  "Utilities",
  "Rent & Facilities",
  "Professional Services",
  "Equipment",
  "Other",
];

interface CreateExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

function CreateExpenseDialog({ open, onOpenChange, companyId }: CreateExpenseDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [incurredAt, setIncurredAt] = useState(todayIso());
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const amountCents = Math.round(parseFloat(amount || "0") * 100);
      return businessApi.createEntity(companyId, "finance", "expense", {
        entityType: "expense",
        name: name || vendor || "Expense",
        amountCents,
        currency: "SAR",
        status: "recorded",
        data: {
          vendor,
          category,
          incurredAt,
          notes,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "finance", "expense"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
      onOpenChange(false);
      setName("");
      setVendor("");
      setCategory("");
      setAmount("");
      setIncurredAt(todayIso());
      setNotes("");
    },
  });

  function handleSubmit() {
    if (!amount || isNaN(parseFloat(amount))) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Expense</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Description / Name</Label>
            <Input
              placeholder="e.g. Office supplies purchase"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Vendor</Label>
              <Input
                placeholder="e.g. Staples"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Amount (SAR) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={incurredAt}
                onChange={(e) => setIncurredAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={2}
              placeholder="Optional notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!amount || isNaN(parseFloat(amount)) || mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Record Expense"}
          </Button>
        </DialogFooter>
        {mutation.error && (
          <p className="text-sm text-destructive mt-1">
            {(mutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExpensesTab({ companyId }: { companyId: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const queryClient = useQueryClient();

  const expensesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "finance", "expense", q),
    queryFn: () => businessApi.listEntities(companyId, "finance", "expense", { q: q || undefined }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessApi.deleteEntity(companyId, "finance", "expense", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "finance", "expense"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
    },
  });

  const expenses = expensesQuery.data?.entities ?? [];

  const totalCents = useMemo(
    () => expenses.reduce((sum, e) => sum + (e.amountCents ?? 0), 0),
    [expenses],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const exp of expenses) {
      const cat = String((exp.data as Record<string, unknown>).category ?? "Other");
      map.set(cat, (map.get(cat) ?? 0) + (exp.amountCents ?? 0));
    }
    return map;
  }, [expenses]);

  if (expensesQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search expenses…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Expense
        </Button>
      </div>

      {/* Summary strip */}
      {expenses.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Total Expenses</p>
              <p className="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">
                {formatCurrency(totalCents)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">No. of Records</p>
              <p className="text-lg font-bold tabular-nums">{expenses.length}</p>
            </CardContent>
          </Card>
          <Card className="hidden sm:block">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Avg per Record</p>
              <p className="text-lg font-bold tabular-nums">
                {expenses.length > 0 ? formatCurrency(Math.round(totalCents / expenses.length)) : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Category breakdown */}
      {byCategory.size > 1 && (
        <div className="flex flex-wrap gap-2">
          {Array.from(byCategory.entries())
            .sort(([, a], [, b]) => b - a)
            .map(([cat, cents]) => (
              <div
                key={cat}
                className="flex items-center gap-1.5 text-xs bg-muted rounded-full px-3 py-1"
              >
                <span className="text-muted-foreground">{cat}:</span>
                <span className="font-semibold tabular-nums">{formatCurrency(cents)}</span>
              </div>
            ))}
        </div>
      )}

      {expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          message="No expenses recorded yet. Track your business expenses here."
          action="New Expense"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2 bg-muted/50 border-b">
            <span className="text-xs font-medium text-muted-foreground">Description</span>
            <span className="text-xs font-medium text-muted-foreground w-28">Category</span>
            <span className="text-xs font-medium text-muted-foreground w-24">Vendor</span>
            <span className="text-xs font-medium text-muted-foreground w-20 text-right">Date</span>
            <span className="text-xs font-medium text-muted-foreground w-24 text-right">Amount</span>
          </div>
          <div className="divide-y">
            {expenses.map((exp) => {
              const d = exp.data as Record<string, unknown>;
              return (
                <div
                  key={exp.id}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-3 bg-card hover:bg-muted/30 group"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium truncate block">
                      {exp.name ?? "Expense"}
                    </span>
                    {!!d.notes && (
                      <span className="text-xs text-muted-foreground truncate block">
                        {String(d.notes)}
                      </span>
                    )}
                  </div>
                  <div className="w-28 shrink-0">
                    {d.category ? (
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {String(d.category)}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground w-24 truncate">
                    {d.vendor ? String(d.vendor) : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground w-20 text-right tabular-nums">
                    {formatDate(d.incurredAt as string | undefined)}
                  </span>
                  <div className="flex items-center gap-2 w-24 justify-end">
                    <span className="text-sm font-mono font-semibold tabular-nums text-red-600 dark:text-red-400">
                      {formatCurrency(exp.amountCents ?? 0, exp.currency ?? "SAR")}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(exp.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 transition-opacity shrink-0"
                      title="Delete expense"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Footer total */}
          <div className="flex items-center justify-end gap-3 px-4 py-2.5 bg-muted/50 border-t">
            <span className="text-xs font-semibold text-muted-foreground">Total</span>
            <span className="text-sm font-bold font-mono tabular-nums text-red-600 dark:text-red-400">
              {formatCurrency(totalCents)}
            </span>
          </div>
        </div>
      )}

      <CreateExpenseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journal Entries Tab
// ---------------------------------------------------------------------------

interface JournalLine {
  accountCode: string;
  accountName: string;
  description: string;
  debit: string;
  credit: string;
}

const EMPTY_LINE: JournalLine = {
  accountCode: "",
  accountName: "",
  description: "",
  debit: "",
  credit: "",
};

interface CreateJournalEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  accounts: BusinessEntityRow[];
}

function CreateJournalEntryDialog({
  open,
  onOpenChange,
  companyId,
  accounts,
}: CreateJournalEntryDialogProps) {
  const queryClient = useQueryClient();
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(todayIso());
  const [lines, setLines] = useState<JournalLine[]>([
    { ...EMPTY_LINE },
    { ...EMPTY_LINE },
  ]);

  const totalDebits = lines.reduce(
    (sum, l) => sum + (parseFloat(l.debit || "0") || 0),
    0,
  );
  const totalCredits = lines.reduce(
    (sum, l) => sum + (parseFloat(l.credit || "0") || 0),
    0,
  );
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.001;
  const hasLines = lines.some((l) => l.accountName && (parseFloat(l.debit) || parseFloat(l.credit)));

  function updateLine(index: number, field: keyof JournalLine, value: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(index: number) {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAccountSelect(index: number, accountCode: string) {
    const acc = accounts.find((a) => a.code === accountCode);
    setLines((prev) =>
      prev.map((l, i) =>
        i === index
          ? { ...l, accountCode, accountName: acc?.name ?? l.accountName }
          : l,
      ),
    );
  }

  const mutation = useMutation({
    mutationFn: () => {
      const validLines = lines.filter(
        (l) => l.accountName && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0),
      );
      const amountCents = Math.round(totalDebits * 100);
      return businessApi.createEntity(companyId, "finance", "journal_entry", {
        entityType: "journal_entry",
        name: memo || `Journal Entry – ${date}`,
        amountCents,
        currency: "SAR",
        status: "posted",
        data: {
          date,
          memo,
          lines: validLines.map((l) => ({
            accountCode: l.accountCode,
            accountName: l.accountName,
            description: l.description,
            debit: parseFloat(l.debit || "0"),
            credit: parseFloat(l.credit || "0"),
          })),
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "finance", "journal_entry"),
      });
      onOpenChange(false);
      setMemo("");
      setDate(todayIso());
      setLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
    },
  });

  function handleSubmit() {
    if (!isBalanced || !hasLines) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Journal Entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Memo / Description</Label>
              <Input
                placeholder="e.g. Monthly payroll"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          {/* Line items header */}
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Account Code</span>
              <span>Account Name</span>
              <span>Description</span>
              <span className="w-24 text-right">Debit</span>
              <span className="w-24 text-right">Credit</span>
              <span className="w-6" />
            </div>

            {lines.map((line, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] gap-2 items-center"
              >
                {/* Account Code – select from existing or type */}
                <div className="relative">
                  {accounts.length > 0 ? (
                    <Select
                      value={line.accountCode}
                      onValueChange={(v) => handleAccountSelect(i, v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Code…" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts
                          .filter((a) => a.code)
                          .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))
                          .map((a) => (
                            <SelectItem key={a.id} value={a.code!}>
                              {a.code} — {a.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="h-8 text-xs"
                      placeholder="Code"
                      value={line.accountCode}
                      onChange={(e) => updateLine(i, "accountCode", e.target.value)}
                    />
                  )}
                </div>

                <Input
                  className="h-8 text-xs"
                  placeholder="Account name"
                  value={line.accountName}
                  onChange={(e) => updateLine(i, "accountName", e.target.value)}
                />

                <Input
                  className="h-8 text-xs"
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => updateLine(i, "description", e.target.value)}
                />

                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="h-8 text-xs w-24 text-right tabular-nums"
                  placeholder="0.00"
                  value={line.debit}
                  onChange={(e) => updateLine(i, "debit", e.target.value)}
                />

                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="h-8 text-xs w-24 text-right tabular-nums"
                  placeholder="0.00"
                  value={line.credit}
                  onChange={(e) => updateLine(i, "credit", e.target.value)}
                />

                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  disabled={lines.length <= 2}
                  className="text-muted-foreground hover:text-destructive p-1 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Remove line"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <Button type="button" variant="ghost" size="sm" onClick={addLine}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Line
            </Button>

            {/* Totals row */}
            <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] gap-2 items-center border-t pt-2 mt-1">
              <div className="col-span-3 text-xs font-semibold text-right text-muted-foreground">
                Totals
              </div>
              <div
                className={`w-24 text-right font-mono text-xs font-bold tabular-nums ${
                  isBalanced ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {totalDebits.toFixed(2)}
              </div>
              <div
                className={`w-24 text-right font-mono text-xs font-bold tabular-nums ${
                  isBalanced ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {totalCredits.toFixed(2)}
              </div>
              <div className="w-6" />
            </div>

            {/* Balance indicator */}
            {hasLines && (
              <div
                className={`text-xs px-3 py-1.5 rounded-md ${
                  isBalanced
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                }`}
              >
                {isBalanced
                  ? "Entry is balanced. Debits equal credits."
                  : `Out of balance by ${Math.abs(totalDebits - totalCredits).toFixed(2)} SAR. Debits must equal credits.`}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isBalanced || !hasLines || mutation.isPending}
          >
            {mutation.isPending ? "Posting…" : "Post Journal Entry"}
          </Button>
        </DialogFooter>
        {mutation.error && (
          <p className="text-sm text-destructive mt-1">
            {(mutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface JournalLine_Stored {
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

function JournalEntriesTab({ companyId }: { companyId: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const journalEntriesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "finance", "journal_entry"),
    queryFn: () => businessApi.listEntities(companyId, "finance", "journal_entry"),
  });

  const accountsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "finance", "account"),
    queryFn: () => businessApi.listEntities(companyId, "finance", "account"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      businessApi.deleteEntity(companyId, "finance", "journal_entry", id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "finance", "journal_entry"),
      });
    },
  });

  const entries = journalEntriesQuery.data?.entities ?? [];
  const accounts = accountsQuery.data?.entities ?? [];

  const totalPosted = useMemo(
    () => entries.reduce((sum, e) => sum + (e.amountCents ?? 0), 0),
    [entries],
  );

  if (journalEntriesQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {entries.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {entries.length} entr{entries.length !== 1 ? "ies" : "y"} ·{" "}
              <span className="font-mono tabular-nums">{formatCurrency(totalPosted)}</span> total
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Journal Entry
        </Button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={FileText}
          message="No journal entries yet. Post your first journal entry to record accounting transactions."
          action="New Journal Entry"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="border rounded-lg overflow-hidden divide-y">
          {entries
            .slice()
            .sort((a, b) => {
              const da = (a.data as Record<string, unknown>).date as string | undefined;
              const db = (b.data as Record<string, unknown>).date as string | undefined;
              if (da && db) return db.localeCompare(da);
              return b.createdAt.localeCompare(a.createdAt);
            })
            .map((entry) => {
              const d = entry.data as Record<string, unknown>;
              const entryLines: JournalLine_Stored[] = Array.isArray(d.lines)
                ? (d.lines as JournalLine_Stored[])
                : [];
              const isExpanded = expandedId === entry.id;
              const totalDebits = entryLines.reduce((s, l) => s + (l.debit ?? 0), 0);
              const totalCredits = entryLines.reduce((s, l) => s + (l.credit ?? 0), 0);

              return (
                <div key={entry.id} className="bg-card group">
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 text-left transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {entry.name ?? "Journal Entry"}
                        </span>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] shrink-0 ${
                            entry.status === "posted"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                              : ""
                          }`}
                        >
                          {entry.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                        <span>
                          {formatDate(d.date as string | undefined ?? entry.createdAt)}
                        </span>
                        {!!d.memo && (
                          <>
                            <span>·</span>
                            <span className="truncate">{String(d.memo)}</span>
                          </>
                        )}
                        {entryLines.length > 0 && (
                          <>
                            <span>·</span>
                            <span>{entryLines.length} lines</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-mono font-semibold tabular-nums">
                        {formatCurrency(entry.amountCents ?? 0)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate(entry.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 transition-opacity"
                        title="Delete journal entry"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </button>

                  {/* Expanded lines */}
                  {isExpanded && entryLines.length > 0 && (
                    <div className="border-t bg-muted/20">
                      <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-2 px-8 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b">
                        <span className="w-14">Code</span>
                        <span>Account</span>
                        <span>Description</span>
                        <span className="w-24 text-right">Debit</span>
                        <span className="w-24 text-right">Credit</span>
                      </div>
                      {entryLines.map((line, li) => (
                        <div
                          key={li}
                          className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-2 px-8 py-2 items-center border-b last:border-b-0 hover:bg-muted/30"
                        >
                          <span className="w-14 font-mono text-xs text-muted-foreground tabular-nums">
                            {line.accountCode || "—"}
                          </span>
                          <span className="text-xs">{line.accountName}</span>
                          <span className="text-xs text-muted-foreground">
                            {line.description || "—"}
                          </span>
                          <span className="w-24 text-right font-mono text-xs tabular-nums">
                            {line.debit > 0 ? formatCurrency(Math.round(line.debit * 100)) : "—"}
                          </span>
                          <span className="w-24 text-right font-mono text-xs tabular-nums">
                            {line.credit > 0 ? formatCurrency(Math.round(line.credit * 100)) : "—"}
                          </span>
                        </div>
                      ))}
                      {/* Totals footer */}
                      <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-2 px-8 py-2 items-center bg-muted/40 border-t">
                        <span className="w-14" />
                        <span className="text-xs font-semibold col-span-2">Totals</span>
                        <span className="w-24 text-right font-mono text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(Math.round(totalDebits * 100))}
                        </span>
                        <span className="w-24 text-right font-mono text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(Math.round(totalCredits * 100))}
                        </span>
                      </div>
                    </div>
                  )}

                  {isExpanded && entryLines.length === 0 && (
                    <div className="px-8 py-3 text-xs text-muted-foreground/60 italic border-t bg-muted/20">
                      No line items recorded.
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      <CreateJournalEntryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
        accounts={accounts}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function BusinessFinancePage() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState("accounts");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Finance" },
    ]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Calculator}
        message="Select a workspace first to access Finance."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Finance</h1>
          <p className="text-sm text-muted-foreground">
            {selectedCompany?.name
              ? `${selectedCompany.name} · `
              : ""}
            Accounts, P&L, Expenses, and Journal Entries
          </p>
        </div>
      </div>

      {/* Main tabbed content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="accounts">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            Chart of Accounts
          </TabsTrigger>
          <TabsTrigger value="pnl">
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
            P&amp;L Statement
          </TabsTrigger>
          <TabsTrigger value="expenses">
            <Receipt className="h-3.5 w-3.5 mr-1.5" />
            Expenses
          </TabsTrigger>
          <TabsTrigger value="journal">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Journal Entries
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-4">
          <ChartOfAccountsTab companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="pnl" className="mt-4">
          <ProfitAndLossTab companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <ExpensesTab companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="journal" className="mt-4">
          <JournalEntriesTab companyId={selectedCompanyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
