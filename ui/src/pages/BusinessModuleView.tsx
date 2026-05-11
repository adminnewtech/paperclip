import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "@/lib/router";
import {
  Briefcase,
  Plus,
  Search,
  MoreHorizontal,
  Trash2,
  Edit2,
  ArrowLeft,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import type {
  BusinessModuleSpec,
  BusinessEntitySpec,
  BusinessEntityFieldSpec,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(cents: number, currency = "SAR"): string {
  return (cents / 100).toLocaleString("en-SA", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getStatusTone(
  entity: BusinessEntitySpec,
  status: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  return entity.statusValues?.find((s) => s.value === status)?.tone ?? "neutral";
}

function StatusBadge({ entity, status }: { entity: BusinessEntitySpec; status: string }) {
  const spec = entity.statusValues?.find((s) => s.value === status);
  const tone = spec?.tone;
  const cls =
    tone === "success"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
      : tone === "danger"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
        : tone === "warning"
          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
          : tone === "info"
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
            : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {spec?.label ?? status}
    </span>
  );
}

function PriorityDot({ priority }: { priority?: string }) {
  const cls =
    priority === "urgent"
      ? "bg-red-500"
      : priority === "high"
        ? "bg-orange-500"
        : priority === "normal"
          ? "bg-blue-400"
          : "bg-muted-foreground/40";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} title={priority} />;
}

// ---------------------------------------------------------------------------
// Deal Kanban
// ---------------------------------------------------------------------------

const DEAL_STAGES = [
  { value: "prospecting", label: "Prospecting" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

function DealKanban({
  companyId,
  entity,
  onCreateDeal,
}: {
  companyId: string;
  entity: BusinessEntitySpec;
  onCreateDeal: () => void;
}) {
  const queryClient = useQueryClient();
  const dealsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "crm", "deal"),
    queryFn: () => businessApi.listEntities(companyId, "crm", "deal"),
  });
  const deals = dealsQuery.data?.entities ?? [];

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      businessApi.updateStatus(companyId, "crm", "deal", id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "crm", "deal"),
      });
    },
  });

  const byStage = useMemo(() => {
    const map = new Map<string, BusinessEntityRow[]>();
    for (const s of DEAL_STAGES) map.set(s.value, []);
    for (const d of deals) {
      const stage = map.get(d.status) ?? map.get("prospecting")!;
      stage.push(d);
    }
    return map;
  }, [deals]);

  if (dealsQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{deals.length} deal{deals.length !== 1 ? "s" : ""}</p>
        <Button size="sm" onClick={onCreateDeal}>
          <Plus className="h-4 w-4 mr-1.5" /> New deal
        </Button>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {DEAL_STAGES.map((stage) => {
            const stageDeal = byStage.get(stage.value) ?? [];
            const totalCents = stageDeal.reduce((a, d) => a + (d.amountCents ?? 0), 0);
            return (
              <div key={stage.value} className="w-56 flex-shrink-0">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {stage.label}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {stageDeal.length}
                  </Badge>
                </div>
                {totalCents > 0 && (
                  <p className="text-[10px] text-muted-foreground px-1 mb-2">
                    {formatAmount(totalCents)}
                  </p>
                )}
                <div className="space-y-2">
                  {stageDeal.map((deal) => (
                    <Card key={deal.id} className="cursor-default hover:shadow-sm transition-shadow">
                      <CardContent className="p-3">
                        <div className="font-medium text-sm truncate">
                          {deal.name ?? deal.code ?? "—"}
                        </div>
                        {deal.amountCents != null && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {formatAmount(deal.amountCents, deal.currency ?? "SAR")}
                          </div>
                        )}
                        <div className="flex items-center gap-1 mt-2">
                          {DEAL_STAGES.filter(
                            (s) => s.value !== stage.value && s.value !== "won" && s.value !== "lost",
                          )
                            .slice(0, 2)
                            .map((s) => (
                              <button
                                key={s.value}
                                className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border hover:bg-muted transition-colors"
                                onClick={() => moveMutation.mutate({ id: deal.id, status: s.value })}
                              >
                                → {s.label}
                              </button>
                            ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {stageDeal.length === 0 && (
                    <div className="text-center py-4 text-xs text-muted-foreground/60 border border-dashed rounded-lg">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice Line Items Component
// ---------------------------------------------------------------------------

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
}

function LineItemsEditor({
  items,
  onChange,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
}) {
  function updateItem(index: number, field: keyof LineItem, value: string | number) {
    const next = items.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item, [field]: value };
      updated.total = updated.quantity * updated.unitPrice * (1 + updated.taxRate / 100);
      return updated;
    });
    onChange(next);
  }

  function addItem() {
    onChange([...items, { description: "", quantity: 1, unitPrice: 0, taxRate: 15, total: 0 }]);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const grandTotal = items.reduce((a, i) => a + i.total, 0);

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-1">
        <span>Description</span>
        <span className="w-16 text-right">Qty</span>
        <span className="w-24 text-right">Unit price</span>
        <span className="w-16 text-right">Tax %</span>
        <span className="w-6" />
      </div>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
          <Input
            placeholder="Description"
            value={item.description}
            onChange={(e) => updateItem(i, "description", e.target.value)}
            className="h-8 text-sm"
          />
          <Input
            type="number"
            min={0}
            value={item.quantity}
            onChange={(e) => updateItem(i, "quantity", Number(e.target.value))}
            className="h-8 text-sm w-16 text-right"
          />
          <Input
            type="number"
            min={0}
            value={item.unitPrice}
            onChange={(e) => updateItem(i, "unitPrice", Number(e.target.value))}
            className="h-8 text-sm w-24 text-right"
          />
          <Input
            type="number"
            min={0}
            max={100}
            value={item.taxRate}
            onChange={(e) => updateItem(i, "taxRate", Number(e.target.value))}
            className="h-8 text-sm w-16 text-right"
          />
          <button
            type="button"
            onClick={() => removeItem(i)}
            className="text-muted-foreground hover:text-destructive p-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={addItem}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add item
        </Button>
        {items.length > 0 && (
          <span className="text-sm font-semibold">
            Total: {grandTotal.toLocaleString("en-SA", { style: "currency", currency: "SAR" })}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart of Accounts view
// ---------------------------------------------------------------------------

function ChartOfAccounts({ companyId }: { companyId: string }) {
  const accountsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "finance", "account"),
    queryFn: () => businessApi.listEntities(companyId, "finance", "account"),
  });
  const accounts = accountsQuery.data?.entities ?? [];

  const byType = useMemo(() => {
    const map: Record<string, BusinessEntityRow[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };
    for (const acc of accounts) {
      const type = (acc.data as Record<string, string>).type ?? acc.status;
      (map[type] ?? map["expense"]!).push(acc);
    }
    return map;
  }, [accounts]);

  const typeLabels: Record<string, string> = {
    asset: "Assets",
    liability: "Liabilities",
    equity: "Equity",
    revenue: "Revenue",
    expense: "Expenses",
  };

  if (accountsQuery.isLoading) return <PageSkeleton variant="list" />;

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        message="No chart of accounts yet. Run the setup wizard to auto-seed accounts for your industry."
      />
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(byType).map(([type, accs]) => {
        if (accs.length === 0) return null;
        return (
          <div key={type}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {typeLabels[type]}
            </h3>
            <div className="border rounded-lg divide-y overflow-hidden">
              {accs
                .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))
                .map((acc) => (
                  <div key={acc.id} className="flex items-center gap-3 px-4 py-2.5 bg-card hover:bg-muted/30">
                    <span className="font-mono text-xs text-muted-foreground w-14 shrink-0">
                      {acc.code}
                    </span>
                    <span className="text-sm flex-1">{acc.name}</span>
                  </div>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic Entity List
// ---------------------------------------------------------------------------

function EntityList({
  companyId,
  moduleKey,
  entity,
  q,
  onQChange,
  onDelete,
  onCreate,
}: {
  companyId: string;
  moduleKey: string;
  entity: BusinessEntitySpec;
  q: string;
  onQChange: (v: string) => void;
  onDelete?: (id: string) => void;
  onCreate?: () => void;
}) {
  const listQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, moduleKey, entity.key, q),
    queryFn: () =>
      businessApi.listEntities(companyId, moduleKey, entity.key, {
        q: q || undefined,
      }),
  });

  const rows = listQuery.data?.entities ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder={`Search ${entity.pluralLabel.toLowerCase()}…`}
            className="pl-8"
            value={q}
            onChange={(e) => onQChange(e.target.value)}
          />
        </div>
        {onCreate && (
          <Button size="sm" onClick={onCreate}>
            <Plus className="h-4 w-4 mr-1.5" />
            New {entity.label.toLowerCase()}
          </Button>
        )}
      </div>

      {listQuery.isLoading && <PageSkeleton variant="list" />}

      {!listQuery.isLoading && rows.length === 0 && (
        <EmptyState icon={Briefcase} message={`No ${entity.pluralLabel.toLowerCase()} yet.`} />
      )}

      {rows.length > 0 && (
        <div className="border rounded-lg divide-y overflow-hidden">
          {rows.map((row) => (
            <EntityRow
              key={row.id}
              row={row}
              entity={entity}
              onDelete={onDelete ? () => onDelete(row.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EntityRow({
  row,
  entity,
  onDelete,
}: {
  row: BusinessEntityRow;
  entity: BusinessEntitySpec;
  onDelete?: () => void;
}) {
  const displayName = row.name ?? row.code ?? row.id.slice(0, 8);
  const subFields = entity.fields
    .filter((f) => f.key !== "name" && f.key !== "code")
    .slice(0, 3)
    .map((f) => {
      const val = (row.data as Record<string, unknown>)[f.key];
      if (val === undefined || val === null || val === "") return null;
      if (typeof val === "object") return null;
      return `${f.label}: ${String(val)}`;
    })
    .filter(Boolean);

  const priority = (row.data as Record<string, unknown>)["priority"] as string | undefined;

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 group">
      {priority && <PriorityDot priority={priority} />}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{displayName}</div>
        {subFields.length > 0 && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {subFields.join(" · ")}
          </div>
        )}
        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
          {formatDate(row.updatedAt)}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {row.amountCents != null && row.amountCents > 0 && (
          <span className="text-sm font-mono font-medium">
            {formatAmount(row.amountCents, row.currency ?? "SAR")}
          </span>
        )}
        <StatusBadge entity={entity} status={row.status} />
        {onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 group-hover:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit Entity Dialog
// ---------------------------------------------------------------------------

function CreateEntityDialog({
  open,
  onOpenChange,
  companyId,
  moduleKey,
  entity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  moduleKey: string;
  entity: BusinessEntitySpec;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const hasLineItems =
    (moduleKey === "sales" && (entity.key === "invoice" || entity.key === "quote")) ||
    false;

  const createMutation = useMutation({
    mutationFn: (body: Partial<BusinessEntityRow> & { entityType: string }) =>
      businessApi.createEntity(companyId, moduleKey, entity.key, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business", "entities", companyId, moduleKey, entity.key],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.summary(companyId),
      });
      onOpenChange(false);
      setValues({});
      setLineItems([]);
    },
  });

  function submit() {
    const data: Record<string, unknown> = {};
    let name: string | null = null;
    let code: string | null = null;
    let amountCents: number | null = null;

    for (const field of entity.fields) {
      const raw = values[field.key];
      if (raw === undefined || raw === "") continue;
      if (field.type === "number") data[field.key] = Number(raw);
      else if (field.type === "currency") {
        const num = Number(raw);
        if (!isNaN(num)) {
          amountCents = Math.round(num * 100);
          data[field.key] = num;
        }
      } else {
        data[field.key] = raw;
      }
      if (field.key === "name") name = raw;
      if (field.key === "code") code = raw;
    }

    if (hasLineItems && lineItems.length > 0) {
      data["lineItems"] = lineItems;
      const total = lineItems.reduce((a, i) => a + i.total, 0);
      amountCents = Math.round(total * 100);
    }

    if (entity.primaryField === "name" && !name) {
      name = values[entity.fields[0]?.key ?? ""] ?? null;
    }

    createMutation.mutate({
      entityType: entity.key,
      name,
      code: code || undefined,
      amountCents,
      data,
      status: entity.statusValues?.[0]?.value ?? "active",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New {entity.label.toLowerCase()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {entity.fields
            .filter((f) => !(hasLineItems && (f.key === "amount" || f.key === "lineItems")))
            .map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={values[field.key] ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
              />
            ))}

          {hasLineItems && (
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs font-medium">Line items</Label>
              <LineItemsEditor items={lineItems} onChange={setLineItems} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
        {createMutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(createMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: BusinessEntityFieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === "json") return null;
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {field.type === "textarea" ? (
        <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "select" ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type={
            field.type === "number" || field.type === "currency"
              ? "number"
              : field.type === "date"
                ? "date"
                : field.type === "email"
                  ? "email"
                  : "text"
          }
          placeholder={field.hint}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.hint && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module-specific tab overrides
// ---------------------------------------------------------------------------

function CRMView({
  companyId,
  moduleSpec,
  onCreate,
  activeEntity,
  setActiveEntity,
  q,
  setQ,
  onDelete,
}: {
  companyId: string;
  moduleSpec: BusinessModuleSpec;
  onCreate: (entityKey: string) => void;
  activeEntity: string;
  setActiveEntity: (v: string) => void;
  q: string;
  setQ: (v: string) => void;
  onDelete: (moduleKey: string, entityType: string, id: string) => void;
}) {
  const tabs = ["contact", "lead", "deal"];
  const entities = moduleSpec.entities.filter((e) => tabs.includes(e.key));

  return (
    <Tabs value={activeEntity} onValueChange={setActiveEntity}>
      <TabsList>
        {entities.map((e) => (
          <TabsTrigger key={e.key} value={e.key}>
            {e.pluralLabel}
          </TabsTrigger>
        ))}
        <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
      </TabsList>

      {entities.map((entity) => (
        <TabsContent key={entity.key} value={entity.key} className="mt-4">
          <EntityList
            companyId={companyId}
            moduleKey="crm"
            entity={entity}
            q={q}
            onQChange={setQ}
            onDelete={(id) => onDelete("crm", entity.key, id)}
            onCreate={() => onCreate(entity.key)}
          />
        </TabsContent>
      ))}

      <TabsContent value="pipeline" className="mt-4">
        <DealKanban
          companyId={companyId}
          entity={moduleSpec.entities.find((e) => e.key === "deal")!}
          onCreateDeal={() => onCreate("deal")}
        />
      </TabsContent>
    </Tabs>
  );
}

function SalesView({
  companyId,
  moduleSpec,
  onCreate,
  activeEntity,
  setActiveEntity,
  q,
  setQ,
  onDelete,
}: {
  companyId: string;
  moduleSpec: BusinessModuleSpec;
  onCreate: (entityKey: string) => void;
  activeEntity: string;
  setActiveEntity: (v: string) => void;
  q: string;
  setQ: (v: string) => void;
  onDelete: (moduleKey: string, entityType: string, id: string) => void;
}) {
  const invoicesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "sales", "invoice"),
    queryFn: () => businessApi.listEntities(companyId, "sales", "invoice"),
  });
  const invoices = invoicesQuery.data?.entities ?? [];

  const paidTotal = invoices
    .filter((i) => i.status === "paid")
    .reduce((a, i) => a + (i.amountCents ?? 0), 0);
  const outstandingTotal = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((a, i) => a + (i.amountCents ?? 0), 0);

  const entities = moduleSpec.entities;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      {invoices.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Total invoices</p>
              <p className="text-lg font-bold">{invoices.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="text-lg font-bold text-emerald-600">{formatAmount(paidTotal)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className={`text-lg font-bold ${outstandingTotal > 0 ? "text-amber-600" : ""}`}>
                {formatAmount(outstandingTotal)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={activeEntity} onValueChange={setActiveEntity}>
        <TabsList>
          {entities.map((e) => (
            <TabsTrigger key={e.key} value={e.key}>
              {e.pluralLabel}
            </TabsTrigger>
          ))}
        </TabsList>
        {entities.map((entity) => (
          <TabsContent key={entity.key} value={entity.key} className="mt-4">
            <EntityList
              companyId={companyId}
              moduleKey="sales"
              entity={entity}
              q={q}
              onQChange={setQ}
              onDelete={(id) => onDelete("sales", entity.key, id)}
              onCreate={() => onCreate(entity.key)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function FinanceView({
  companyId,
  moduleSpec,
  onCreate,
  activeEntity,
  setActiveEntity,
  q,
  setQ,
  onDelete,
}: {
  companyId: string;
  moduleSpec: BusinessModuleSpec;
  onCreate: (entityKey: string) => void;
  activeEntity: string;
  setActiveEntity: (v: string) => void;
  q: string;
  setQ: (v: string) => void;
  onDelete: (moduleKey: string, entityType: string, id: string) => void;
}) {
  const entities = moduleSpec.entities;

  return (
    <Tabs value={activeEntity} onValueChange={setActiveEntity}>
      <TabsList>
        <TabsTrigger value="accounts">Chart of Accounts</TabsTrigger>
        {entities
          .filter((e) => e.key !== "account")
          .map((e) => (
            <TabsTrigger key={e.key} value={e.key}>
              {e.pluralLabel}
            </TabsTrigger>
          ))}
      </TabsList>

      <TabsContent value="accounts" className="mt-4">
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => onCreate("account")}>
              <Plus className="h-4 w-4 mr-1.5" /> New account
            </Button>
          </div>
          <ChartOfAccounts companyId={companyId} />
        </div>
      </TabsContent>

      {entities
        .filter((e) => e.key !== "account")
        .map((entity) => (
          <TabsContent key={entity.key} value={entity.key} className="mt-4">
            <EntityList
              companyId={companyId}
              moduleKey="finance"
              entity={entity}
              q={q}
              onQChange={setQ}
              onDelete={(id) => onDelete("finance", entity.key, id)}
              onCreate={() => onCreate(entity.key)}
            />
          </TabsContent>
        ))}
    </Tabs>
  );
}

function InventoryView({
  companyId,
  moduleSpec,
  onCreate,
  activeEntity,
  setActiveEntity,
  q,
  setQ,
  onDelete,
}: {
  companyId: string;
  moduleSpec: BusinessModuleSpec;
  onCreate: (entityKey: string) => void;
  activeEntity: string;
  setActiveEntity: (v: string) => void;
  q: string;
  setQ: (v: string) => void;
  onDelete: (moduleKey: string, entityType: string, id: string) => void;
}) {
  const productsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "inventory", "product"),
    queryFn: () => businessApi.listEntities(companyId, "inventory", "product"),
  });
  const products = productsQuery.data?.entities ?? [];

  return (
    <Tabs value={activeEntity} onValueChange={setActiveEntity}>
      <TabsList>
        {moduleSpec.entities.map((e) => (
          <TabsTrigger key={e.key} value={e.key}>
            {e.pluralLabel}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="product" className="mt-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search products…"
                className="pl-8"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={() => onCreate("product")}>
              <Plus className="h-4 w-4 mr-1.5" /> New product
            </Button>
          </div>

          {productsQuery.isLoading && <PageSkeleton variant="list" />}

          {!productsQuery.isLoading && products.length === 0 && (
            <EmptyState icon={Briefcase} message="No products yet." />
          )}

          {products.length > 0 && (
            <div className="border rounded-lg divide-y overflow-hidden">
              {products.map((p) => {
                const d = p.data as Record<string, unknown>;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-4 px-4 py-3 bg-card hover:bg-muted/30 group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.sku ? `SKU: ${d.sku}` : ""}
                        {d.unit ? ` · ${d.unit}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      {d.price != null && (
                        <div className="text-sm font-mono font-medium">
                          {Number(d.price).toLocaleString("en-SA", {
                            style: "currency",
                            currency: "SAR",
                          })}
                        </div>
                      )}
                      {d.cost != null && (
                        <div className="text-xs text-muted-foreground">
                          Cost:{" "}
                          {Number(d.cost).toLocaleString("en-SA", {
                            style: "currency",
                            currency: "SAR",
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </TabsContent>

      {moduleSpec.entities
        .filter((e) => e.key !== "product")
        .map((entity) => (
          <TabsContent key={entity.key} value={entity.key} className="mt-4">
            <EntityList
              companyId={companyId}
              moduleKey="inventory"
              entity={entity}
              q={q}
              onQChange={setQ}
              onDelete={(id) => onDelete("inventory", entity.key, id)}
              onCreate={() => onCreate(entity.key)}
            />
          </TabsContent>
        ))}
    </Tabs>
  );
}

function HelpdeskView({
  companyId,
  moduleSpec,
  onCreate,
  activeEntity,
  setActiveEntity,
  q,
  setQ,
  onDelete,
}: {
  companyId: string;
  moduleSpec: BusinessModuleSpec;
  onCreate: (entityKey: string) => void;
  activeEntity: string;
  setActiveEntity: (v: string) => void;
  q: string;
  setQ: (v: string) => void;
  onDelete: (moduleKey: string, entityType: string, id: string) => void;
}) {
  const ticketsQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "helpdesk", "ticket"),
    queryFn: () => businessApi.listEntities(companyId, "helpdesk", "ticket"),
  });
  const tickets = ticketsQuery.data?.entities ?? [];

  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter((t) => t.status === "in_progress").length;
  const resolvedCount = tickets.filter((t) => t.status === "resolved").length;

  const entity = moduleSpec.entities.find((e) => e.key === "ticket")!;

  return (
    <div className="space-y-4">
      {tickets.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3 flex items-center gap-3">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-xs text-muted-foreground">Open</p>
                <p className="text-lg font-bold">{openCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 flex items-center gap-3">
              <Clock className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-xs text-muted-foreground">In progress</p>
                <p className="text-lg font-bold">{inProgressCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <div>
                <p className="text-xs text-muted-foreground">Resolved</p>
                <p className="text-lg font-bold">{resolvedCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <EntityList
        companyId={companyId}
        moduleKey="helpdesk"
        entity={entity}
        q={q}
        onQChange={setQ}
        onDelete={(id) => onDelete("helpdesk", "ticket", id)}
        onCreate={() => onCreate("ticket")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function BusinessModuleView() {
  const { moduleKey: rawModuleKey } = useParams<{ moduleKey: string }>();
  const moduleKey = rawModuleKey ?? "";
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [activeEntity, setActiveEntity] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createEntityKey, setCreateEntityKey] = useState<string>("");

  const catalogQuery = useQuery({
    queryKey: queryKeys.business.catalog,
    queryFn: () => businessApi.catalog(),
  });

  const moduleSpec: BusinessModuleSpec | undefined = useMemo(
    () => catalogQuery.data?.modules.find((m) => m.key === moduleKey),
    [catalogQuery.data, moduleKey],
  );

  useEffect(() => {
    if (moduleSpec) {
      setBreadcrumbs([
        { label: "Business", href: "/business" },
        { label: moduleSpec.label },
      ]);
    } else {
      setBreadcrumbs([{ label: "Business", href: "/business" }]);
    }
  }, [moduleSpec, setBreadcrumbs]);

  useEffect(() => {
    if (moduleSpec && !activeEntity) {
      if (moduleKey === "finance") {
        setActiveEntity("accounts");
      } else {
        setActiveEntity(moduleSpec.entities[0]?.key ?? "");
      }
    }
  }, [moduleSpec, activeEntity, moduleKey]);

  const deleteMutation = useMutation({
    mutationFn: ({
      mk,
      entityType,
      id,
    }: {
      mk: string;
      entityType: string;
      id: string;
    }) => businessApi.deleteEntity(companyId!, mk, entityType, id),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: ["business", "entities", companyId, vars.mk, vars.entityType],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.summary(companyId!),
      });
    },
  });

  const companyId = selectedCompanyId;

  if (!companyId) {
    return <EmptyState icon={Briefcase} message="Select a workspace first." />;
  }

  if (catalogQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (!moduleSpec) {
    return (
      <EmptyState icon={Briefcase} message={`Unknown module: ${moduleKey}`} />
    );
  }

  function handleCreate(entityKey: string) {
    setCreateEntityKey(entityKey);
    setCreateOpen(true);
  }

  function handleDelete(mk: string, entityType: string, id: string) {
    deleteMutation.mutate({ mk, entityType, id });
  }

  const currentCreateEntity =
    moduleSpec.entities.find((e) => e.key === createEntityKey) ??
    moduleSpec.entities[0];

  const moduleViewProps = {
    companyId,
    moduleSpec,
    onCreate: handleCreate,
    activeEntity,
    setActiveEntity,
    q,
    setQ,
    onDelete: handleDelete,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{moduleSpec.label}</h1>
          <p className="text-sm text-muted-foreground">{moduleSpec.description}</p>
        </div>
      </div>

      {moduleKey === "crm" ? (
        <CRMView {...moduleViewProps} />
      ) : moduleKey === "sales" ? (
        <SalesView {...moduleViewProps} />
      ) : moduleKey === "finance" ? (
        <FinanceView {...moduleViewProps} />
      ) : moduleKey === "inventory" ? (
        <InventoryView {...moduleViewProps} />
      ) : moduleKey === "helpdesk" ? (
        <HelpdeskView {...moduleViewProps} />
      ) : (
        // Generic fallback (HR, Marketing, Ecommerce)
        <GenericModuleView {...moduleViewProps} />
      )}

      {currentCreateEntity && (
        <CreateEntityDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          companyId={companyId}
          moduleKey={moduleSpec.key}
          entity={currentCreateEntity}
        />
      )}
    </div>
  );
}

function GenericModuleView({
  companyId,
  moduleSpec,
  onCreate,
  activeEntity,
  setActiveEntity,
  q,
  setQ,
  onDelete,
}: {
  companyId: string;
  moduleSpec: BusinessModuleSpec;
  onCreate: (entityKey: string) => void;
  activeEntity: string;
  setActiveEntity: (v: string) => void;
  q: string;
  setQ: (v: string) => void;
  onDelete: (moduleKey: string, entityType: string, id: string) => void;
}) {
  const entities = moduleSpec.entities;

  if (entities.length === 1) {
    const entity = entities[0]!;
    return (
      <EntityList
        companyId={companyId}
        moduleKey={moduleSpec.key}
        entity={entity}
        q={q}
        onQChange={setQ}
        onDelete={(id) => onDelete(moduleSpec.key, entity.key, id)}
        onCreate={() => onCreate(entity.key)}
      />
    );
  }

  return (
    <Tabs value={activeEntity} onValueChange={setActiveEntity}>
      <TabsList>
        {entities.map((e) => (
          <TabsTrigger key={e.key} value={e.key}>
            {e.pluralLabel}
          </TabsTrigger>
        ))}
      </TabsList>
      {entities.map((entity) => (
        <TabsContent key={entity.key} value={entity.key} className="mt-4">
          <EntityList
            companyId={companyId}
            moduleKey={moduleSpec.key}
            entity={entity}
            q={q}
            onQChange={setQ}
            onDelete={(id) => onDelete(moduleSpec.key, entity.key, id)}
            onCreate={() => onCreate(entity.key)}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
