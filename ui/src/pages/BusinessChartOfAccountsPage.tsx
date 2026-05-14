import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Plus,
  Search,
  Trash2,
  Sparkles,
  Pencil,
} from "lucide-react";
import { Link } from "@/lib/router";
import type { ChartOfAccount } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const TYPES: Array<{
  value: ChartOfAccount["type"];
  label: string;
  color: string;
  headerBg: string;
}> = [
  { value: "asset", label: "Assets", color: "text-blue-600 dark:text-blue-400", headerBg: "bg-blue-50 dark:bg-blue-950/30" },
  { value: "liability", label: "Liabilities", color: "text-amber-600 dark:text-amber-400", headerBg: "bg-amber-50 dark:bg-amber-950/30" },
  { value: "equity", label: "Equity", color: "text-purple-600 dark:text-purple-400", headerBg: "bg-purple-50 dark:bg-purple-950/30" },
  { value: "revenue", label: "Revenue", color: "text-emerald-600 dark:text-emerald-400", headerBg: "bg-emerald-50 dark:bg-emerald-950/30" },
  { value: "expense", label: "Expenses", color: "text-red-600 dark:text-red-400", headerBg: "bg-red-50 dark:bg-red-950/30" },
];

const SUBTYPES: ChartOfAccount["subtype"][] = [
  "cash", "bank", "accounts_receivable", "inventory", "fixed_asset",
  "other_current_asset", "other_asset", "accounts_payable", "credit_card",
  "loan", "other_current_liability", "long_term_liability", "common_stock",
  "retained_earnings", "drawing", "operating_revenue", "other_revenue",
  "cogs", "operating_expense", "payroll_expense", "tax_expense",
  "other_expense",
];

// ---------------------------------------------------------------------------
// Account dialog
// ---------------------------------------------------------------------------

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  account?: ChartOfAccount;
}

function AccountDialog({ open, onOpenChange, companyId, account }: AccountDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = !!account;
  const [code, setCode] = useState(account?.code ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [nameAr, setNameAr] = useState(account?.nameAr ?? "");
  const [type, setType] = useState<ChartOfAccount["type"]>(account?.type ?? "asset");
  const [subtype, setSubtype] = useState<ChartOfAccount["subtype"]>(
    account?.subtype ?? "other_asset",
  );
  const [description, setDescription] = useState(account?.description ?? "");
  const [parentCode, setParentCode] = useState(account?.parentCode ?? "");

  useEffect(() => {
    if (account) {
      setCode(account.code);
      setName(account.name);
      setNameAr(account.nameAr);
      setType(account.type);
      setSubtype(account.subtype);
      setDescription(account.description ?? "");
      setParentCode(account.parentCode ?? "");
    } else if (!open) {
      setCode("");
      setName("");
      setNameAr("");
      setType("asset");
      setSubtype("other_asset");
      setDescription("");
      setParentCode("");
    }
  }, [account, open]);

  const create = useMutation({
    mutationFn: () =>
      businessAccountingApi.createAccount(companyId, {
        code,
        name,
        nameAr,
        type,
        subtype,
        parentCode: parentCode || null,
        description,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business-accounting", "accounts", companyId],
      });
      onOpenChange(false);
    },
  });

  const update = useMutation({
    mutationFn: () =>
      businessAccountingApi.updateAccount(companyId, account!.code, {
        name,
        nameAr,
        type,
        subtype,
        parentCode: parentCode || null,
        description,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business-accounting", "accounts", companyId],
      });
      onOpenChange(false);
    },
  });

  const submit = () => (isEdit ? update.mutate() : create.mutate());
  const busy = create.isPending || update.isPending;
  const error = (create.error ?? update.error) as Error | null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Account" : "New Account"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Code <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. 1110"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={isEdit}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Type <span className="text-destructive">*</span>
              </Label>
              <Select value={type} onValueChange={(v) => setType(v as ChartOfAccount["type"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
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
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="e.g. Cash on Hand"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name (Arabic)</Label>
            <Input
              dir="rtl"
              placeholder="مثال: النقد في الصندوق"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Subtype</Label>
              <Select
                value={subtype}
                onValueChange={(v) => setSubtype(v as ChartOfAccount["subtype"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBTYPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Parent Code</Label>
              <Input
                placeholder="optional"
                value={parentCode}
                onChange={(e) => setParentCode(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!code || !name || busy} onClick={submit}>
            {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessChartOfAccountsPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ChartOfAccount | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Accounting", href: "/business/accounting" },
      { label: "Chart of Accounts" },
    ]);
  }, [setBreadcrumbs]);

  const accountsQuery = useQuery({
    queryKey: ["business-accounting", "accounts", selectedCompanyId],
    queryFn: () => businessAccountingApi.listAccounts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const seedMutation = useMutation({
    mutationFn: () => businessAccountingApi.seedDefaults(selectedCompanyId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business-accounting", "accounts", selectedCompanyId],
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (code: string) =>
      businessAccountingApi.deleteAccount(selectedCompanyId!, code),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business-accounting", "accounts", selectedCompanyId],
      });
    },
  });

  const accounts: ChartOfAccount[] = accountsQuery.data?.accounts ?? [];

  const byType = useMemo(() => {
    const buckets: Record<ChartOfAccount["type"], ChartOfAccount[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };
    const lower = q.trim().toLowerCase();
    for (const acc of accounts) {
      if (lower) {
        if (
          !acc.code.toLowerCase().includes(lower) &&
          !acc.name.toLowerCase().includes(lower) &&
          !acc.nameAr.toLowerCase().includes(lower)
        ) {
          continue;
        }
      }
      buckets[acc.type].push(acc);
    }
    for (const k of Object.keys(buckets) as Array<ChartOfAccount["type"]>) {
      buckets[k].sort((a, b) => a.code.localeCompare(b.code));
    }
    return buckets;
  }, [accounts, q]);

  if (!selectedCompanyId) return null;
  if (accountsQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business/accounting">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
          <p className="text-sm text-muted-foreground">
            All accounts used by the general ledger.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search accounts…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {accounts.length === 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
          >
            <Sparkles className="h-4 w-4 mr-1.5" />
            {seedMutation.isPending ? "Seeding…" : "Seed Defaults"}
          </Button>
        )}
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          message="No accounts yet. Seed the default chart of accounts or create one manually."
          action="Seed Defaults"
          onAction={() => seedMutation.mutate()}
        />
      ) : (
        <div className="space-y-4">
          {TYPES.map(({ value: t, label, color, headerBg }) => {
            const accs = byType[t] ?? [];
            if (accs.length === 0) return null;
            return (
              <div key={t} className="border rounded-lg overflow-hidden">
                <div className={`px-4 py-2.5 ${headerBg} flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold uppercase tracking-wider ${color}`}>
                      {label}
                    </span>
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {accs.length}
                    </Badge>
                  </div>
                </div>
                <div className="divide-y">
                  {accs.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-accent/30"
                    >
                      <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">
                        {acc.code}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{acc.name}</span>
                          {acc.isSystem && (
                            <Badge variant="outline" className="text-[9px] px-1 h-4">
                              system
                            </Badge>
                          )}
                          {!acc.isActive && (
                            <Badge variant="secondary" className="text-[9px] px-1 h-4">
                              inactive
                            </Badge>
                          )}
                        </div>
                        {acc.nameAr && (
                          <span className="text-xs text-muted-foreground" dir="rtl">
                            {acc.nameAr}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {acc.subtype.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-xs tabular-nums">
                        {formatCurrency(acc.balanceCents, acc.currency)}
                      </span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setEditing(acc)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!acc.isSystem && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete account ${acc.code} — ${acc.name}?`,
                              )
                            ) {
                              deleteMutation.mutate(acc.code);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AccountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={selectedCompanyId}
      />
      <AccountDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
        companyId={selectedCompanyId}
        account={editing}
      />
    </div>
  );
}
