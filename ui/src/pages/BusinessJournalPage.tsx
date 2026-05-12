import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileText,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { Link } from "@/lib/router";
import type {
  ChartOfAccount,
  JournalEntry,
  JournalLine,
} from "@paperclipai/shared";
import { validateJournalLines } from "@paperclipai/shared";
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// New entry dialog
// ---------------------------------------------------------------------------

interface NewEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  accounts: ChartOfAccount[];
}

function NewEntryDialog({ open, onOpenChange, companyId, accounts }: NewEntryDialogProps) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<JournalLine[]>([
    { accountCode: "", debitCents: 0, creditCents: 0 },
    { accountCode: "", debitCents: 0, creditCents: 0 },
  ]);

  useEffect(() => {
    if (!open) {
      setDate(todayIso());
      setDescription("");
      setNotes("");
      setLines([
        { accountCode: "", debitCents: 0, creditCents: 0 },
        { accountCode: "", debitCents: 0, creditCents: 0 },
      ]);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      businessAccountingApi.createEntry(companyId, {
        date,
        description,
        lines,
        notes: notes || undefined,
        referenceType: "manual",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business-accounting", "journal", companyId],
      });
      onOpenChange(false);
    },
  });

  const validation = useMemo(() => validateJournalLines(lines), [lines]);

  function updateLine(i: number, patch: Partial<JournalLine>) {
    setLines((prev) => {
      const next = prev.slice();
      next[i] = { ...next[i]!, ...patch };
      return next;
    });
  }

  function addLine() {
    setLines((prev) => [...prev, { accountCode: "", debitCents: 0, creditCents: 0 }]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Journal Entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
              <Label className="text-xs">
                Description <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="Memo for this entry"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="border rounded-md overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-muted text-xs font-medium">
              <div className="col-span-5">Account</div>
              <div className="col-span-3 text-right">Debit</div>
              <div className="col-span-3 text-right">Credit</div>
              <div className="col-span-1" />
            </div>
            <div className="divide-y">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className="grid grid-cols-12 gap-2 px-2 py-2 items-center"
                >
                  <div className="col-span-5">
                    <Select
                      value={line.accountCode}
                      onValueChange={(v) => updateLine(i, { accountCode: v })}
                    >
                      <SelectTrigger className="h-8 text-xs">
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
                  </div>
                  <div className="col-span-3">
                    <Input
                      className="h-8 text-right font-mono text-xs"
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.debitCents ? (line.debitCents / 100).toString() : ""}
                      onChange={(e) =>
                        updateLine(i, {
                          debitCents: Math.round(parseFloat(e.target.value || "0") * 100),
                          creditCents: 0,
                        })
                      }
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      className="h-8 text-right font-mono text-xs"
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.creditCents ? (line.creditCents / 100).toString() : ""}
                      onChange={(e) =>
                        updateLine(i, {
                          creditCents: Math.round(parseFloat(e.target.value || "0") * 100),
                          debitCents: 0,
                        })
                      }
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={lines.length <= 2}
                      onClick={() => removeLine(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 py-2 bg-muted/50 flex items-center justify-between text-xs">
              <Button size="sm" variant="ghost" onClick={addLine}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add line
              </Button>
              <div className="flex items-center gap-4">
                <span className="font-mono">
                  Debits: {formatCurrency(validation.totalDebitsCents)}
                </span>
                <span className="font-mono">
                  Credits: {formatCurrency(validation.totalCreditsCents)}
                </span>
                <Badge variant={validation.valid ? "secondary" : "outline"}>
                  {validation.valid ? "balanced" : "unbalanced"}
                </Badge>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {!validation.valid && validation.errors.length > 0 && (
            <div className="text-xs text-destructive space-y-0.5">
              {validation.errors.map((e, i) => (
                <div key={i}>• {e}</div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!description.trim() || !validation.valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : "Create Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: JournalEntry["status"] }) {
  if (status === "posted") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">posted</Badge>
    );
  }
  if (status === "void") {
    return <Badge variant="destructive">void</Badge>;
  }
  return <Badge variant="outline">draft</Badge>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessJournalPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Accounting", href: "/business/accounting" },
      { label: "Journal" },
    ]);
  }, [setBreadcrumbs]);

  const entriesQuery = useQuery({
    queryKey: [
      "business-accounting",
      "journal",
      selectedCompanyId,
      statusFilter,
      from,
      to,
    ],
    queryFn: () =>
      businessAccountingApi.listEntries(selectedCompanyId!, {
        status: statusFilter || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    enabled: !!selectedCompanyId,
  });

  const accountsQuery = useQuery({
    queryKey: ["business-accounting", "accounts", selectedCompanyId],
    queryFn: () => businessAccountingApi.listAccounts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const postMutation = useMutation({
    mutationFn: (id: string) => businessAccountingApi.postEntry(selectedCompanyId!, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business-accounting", "journal", selectedCompanyId],
      });
    },
  });
  const voidMutation = useMutation({
    mutationFn: (id: string) => businessAccountingApi.voidEntry(selectedCompanyId!, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business-accounting", "journal", selectedCompanyId],
      });
    },
  });
  const reverseMutation = useMutation({
    mutationFn: (id: string) =>
      businessAccountingApi.reverseEntry(selectedCompanyId!, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business-accounting", "journal", selectedCompanyId],
      });
    },
  });

  if (!selectedCompanyId) return null;
  const entries = entriesQuery.data?.entries ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business/accounting">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Journal</h1>
          <p className="text-sm text-muted-foreground">
            Double-entry journal — every entry must balance.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Entry
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
        <Select
          value={statusFilter || "all"}
          onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-32 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {entriesQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={FileText}
          message="No journal entries yet. Create a manual entry, or let auto-posting create them from invoices and expenses."
          action="New Entry"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium">Date</th>
                <th className="px-3 py-2 text-left text-xs font-medium">Description</th>
                <th className="px-3 py-2 text-left text-xs font-medium">Ref</th>
                <th className="px-3 py-2 text-right text-xs font-medium">Amount</th>
                <th className="px-3 py-2 text-left text-xs font-medium">Status</th>
                <th className="px-3 py-2 text-right text-xs font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-accent/30">
                  <td className="px-3 py-1.5 font-mono text-xs">{e.entryNumber}</td>
                  <td className="px-3 py-1.5 text-xs">{e.date}</td>
                  <td className="px-3 py-1.5 text-xs">{e.description}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {e.referenceType ?? ""}
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono text-right tabular-nums">
                    {formatCurrency(e.totalDebitsCents)}
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {e.status === "draft" && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Post"
                          disabled={postMutation.isPending}
                          onClick={() => postMutation.mutate(e.id)}
                        >
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                        </Button>
                      )}
                      {e.status === "posted" && !e.reversedBy && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Reverse"
                          disabled={reverseMutation.isPending}
                          onClick={() => {
                            if (window.confirm("Reverse this entry?")) {
                              reverseMutation.mutate(e.id);
                            }
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5 text-amber-600" />
                        </Button>
                      )}
                      {e.status !== "void" && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Void"
                          disabled={voidMutation.isPending}
                          onClick={() => {
                            if (window.confirm("Void this entry?")) {
                              voidMutation.mutate(e.id);
                            }
                          }}
                        >
                          <XCircle className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewEntryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={selectedCompanyId}
        accounts={accounts}
      />
    </div>
  );
}
