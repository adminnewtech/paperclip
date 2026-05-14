import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  Download,
  Search,
  RefreshCcw,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  businessAuditApi,
  type AuditAction,
  type AuditEntry,
} from "../api/business-audit";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function actionTone(
  action: AuditAction,
): "default" | "secondary" | "outline" | "destructive" {
  if (action === "delete") return "destructive";
  if (action === "create") return "default";
  if (action === "update") return "secondary";
  return "outline";
}

const ACTION_OPTIONS: AuditAction[] = [
  "create",
  "update",
  "delete",
  "view",
  "export",
  "login",
  "logout",
  "permission_change",
  "role_change",
];

const MODULE_OPTIONS = [
  "crm",
  "sales",
  "inventory",
  "finance",
  "hr",
  "helpdesk",
  "marketing",
  "ecommerce",
  "audit",
  "rbac",
];

export function BusinessAuditLogPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("");
  const [fromFilter, setFromFilter] = useState<string>("");
  const [toFilter, setToFilter] = useState<string>("");
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Audit Log" },
    ]);
  }, [setBreadcrumbs]);

  const logsQuery = useQuery({
    queryKey: [
      "business-audit-logs",
      selectedCompanyId,
      actionFilter,
      moduleFilter,
      actorFilter,
      fromFilter,
      toFilter,
    ],
    queryFn: () =>
      businessAuditApi.listLogs(selectedCompanyId!, {
        action: actionFilter !== "all" ? actionFilter : undefined,
        moduleKey: moduleFilter !== "all" ? moduleFilter : undefined,
        actorUserId: actorFilter || undefined,
        from: fromFilter || undefined,
        to: toFilter || undefined,
        limit: 200,
      }),
    enabled: !!selectedCompanyId,
  });

  const entries = logsQuery.data?.entries ?? [];

  const stats = useMemo(() => {
    const total = entries.length;
    const creates = entries.filter((e) => e.action === "create").length;
    const updates = entries.filter((e) => e.action === "update").length;
    const deletes = entries.filter((e) => e.action === "delete").length;
    return { total, creates, updates, deletes };
  }, [entries]);

  if (!selectedCompanyId) {
    return <EmptyState icon={ShieldCheck} message="Select a workspace first." />;
  }

  function handleExport() {
    if (!selectedCompanyId) return;
    const from =
      fromFilter ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = toFilter || new Date().toISOString();
    const url = businessAuditApi.exportUrl(selectedCompanyId, from, to);
    window.open(url, "_blank");
  }

  function resetFilters() {
    setActionFilter("all");
    setModuleFilter("all");
    setActorFilter("");
    setFromFilter("");
    setToFilter("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Audit Log</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Every change to every business entity is captured here.
            Append-only and tamper-evident.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => logsQuery.refetch()}
            disabled={logsQuery.isFetching}
          >
            <RefreshCcw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total entries</p>
            <p className="text-lg font-bold tabular-nums">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Creates</p>
            <p className="text-lg font-bold tabular-nums">{stats.creates}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Updates</p>
            <p className="text-lg font-bold tabular-nums">{stats.updates}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Deletes</p>
            <p className="text-lg font-bold tabular-nums">{stats.deletes}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3 grid grid-cols-1 md:grid-cols-5 gap-2">
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Any action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any action</SelectItem>
              {ACTION_OPTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Any module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any module</SelectItem>
              {MODULE_OPTIONS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Actor user id"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
          />
          <Input
            type="datetime-local"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
            placeholder="From"
          />
          <div className="flex items-center gap-2">
            <Input
              type="datetime-local"
              value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              placeholder="To"
            />
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {logsQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Search}
          message="No audit entries match your filters yet."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Actor</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-left">Module</th>
                  <th className="px-3 py-2 text-left">Changed</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-t border-border/50 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {formatDate(entry.timestamp)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-mono text-xs">
                        {entry.actorUserId ?? entry.actorAgentId ?? "system"}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({entry.actorType})
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={actionTone(entry.action)}>
                        {entry.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-xs">
                        {entry.targetCode ?? entry.targetId ?? entry.targetType}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {entry.entityType ?? entry.targetType}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {entry.moduleKey ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                      {(entry.diff?.changedFields ?? []).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {logsQuery.isError && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          <div>
            <div className="font-medium">Could not load audit log</div>
            <div className="text-muted-foreground text-xs">
              You may not have permission to view the audit log for this
              workspace.
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={!!selectedEntry}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Audit entry</DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Timestamp" value={formatDate(selectedEntry.timestamp)} />
                <Field label="Action" value={selectedEntry.action} />
                <Field
                  label="Actor"
                  value={
                    selectedEntry.actorUserId ??
                    selectedEntry.actorAgentId ??
                    "system"
                  }
                />
                <Field label="Actor type" value={selectedEntry.actorType} />
                <Field label="Target type" value={selectedEntry.targetType} />
                <Field
                  label="Target"
                  value={selectedEntry.targetCode ?? selectedEntry.targetId ?? "—"}
                />
                <Field label="Module" value={selectedEntry.moduleKey ?? "—"} />
                <Field
                  label="Entity type"
                  value={selectedEntry.entityType ?? "—"}
                />
                <Field
                  label="IP address"
                  value={selectedEntry.ipAddress ?? "—"}
                />
                <Field
                  label="User agent"
                  value={selectedEntry.userAgent ?? "—"}
                />
              </div>
              {selectedEntry.diff?.changedFields &&
              selectedEntry.diff.changedFields.length > 0 ? (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-2">
                    Changed fields
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedEntry.diff.changedFields.map((f) => (
                      <Badge key={f} variant="outline">
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {selectedEntry.diff ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground mb-1">
                      Before
                    </div>
                    <pre className="bg-muted/40 rounded p-2 text-xs overflow-auto max-h-72">
                      {JSON.stringify(selectedEntry.diff.before ?? null, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground mb-1">
                      After
                    </div>
                    <pre className="bg-muted/40 rounded p-2 text-xs overflow-auto max-h-72">
                      {JSON.stringify(selectedEntry.diff.after ?? null, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-mono break-all">{value}</div>
    </div>
  );
}
