import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileCheck2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Eye,
  Settings,
  BarChart3,
  ListChecks,
} from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  zatcaApi,
  type ZatcaSubmission,
  type ZatcaSubmissionStatus,
} from "../api/business-compliance";

const STATUS_META: Record<
  ZatcaSubmissionStatus,
  { cls: string; icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  cleared: {
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    icon: CheckCircle2,
    label: "Cleared",
  },
  reported: {
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    icon: CheckCircle2,
    label: "Reported",
  },
  rejected: {
    cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    icon: XCircle,
    label: "Rejected",
  },
  warning: {
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    icon: AlertTriangle,
    label: "Warning",
  },
};

function StatusBadge({ status }: { status: ZatcaSubmissionStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function SubmissionDetailDialog({
  open,
  submission,
  onOpenChange,
}: {
  open: boolean;
  submission: ZatcaSubmission | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Submission details</DialogTitle>
        </DialogHeader>
        {!submission ? (
          <p className="text-sm text-muted-foreground">No submission selected.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground truncate">
                {submission.uuid}
              </span>
              <div className="flex items-center gap-1.5">
                {submission.mock && (
                  <Badge variant="secondary" className="text-[10px]">
                    mock
                  </Badge>
                )}
                <StatusBadge status={submission.status} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 py-2 border-y">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  ZATCA invoice no.
                </p>
                <p className="font-mono text-xs">
                  {submission.zatcaInvoiceNumber ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Cleared at
                </p>
                <p className="text-xs">
                  {submission.clearanceTimestamp
                    ? new Date(submission.clearanceTimestamp).toLocaleString()
                    : "—"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Invoice hash
                </p>
                <p className="font-mono text-[10px] break-all">{submission.hash}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Signature
                </p>
                <p className="font-mono text-[10px] break-all line-clamp-2">
                  {submission.signature}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  QR code (TLV base64)
                </p>
                <p className="font-mono text-[10px] break-all line-clamp-2">
                  {submission.qrCode}
                </p>
              </div>
            </div>
            {submission.errors && submission.errors.length > 0 && (
              <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 p-2">
                <p className="text-xs font-semibold mb-1 text-red-700 dark:text-red-300">
                  Errors
                </p>
                <ul className="text-xs space-y-0.5 text-red-700 dark:text-red-300">
                  {submission.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-[10px]">{e.code}</span>{" "}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {submission.warnings && submission.warnings.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-2">
                <p className="text-xs font-semibold mb-1 text-amber-700 dark:text-amber-300">
                  Warnings
                </p>
                <ul className="text-xs space-y-0.5 text-amber-700 dark:text-amber-300">
                  {submission.warnings.map((w, i) => (
                    <li key={i}>
                      <span className="font-mono text-[10px]">{w.code}</span>{" "}
                      {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Signed XML (base64)
              </p>
              <pre className="rounded border bg-muted/30 p-2 text-[10px] font-mono overflow-auto max-h-48 break-all whitespace-pre-wrap">
                {submission.signedXmlBase64}
              </pre>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BusinessZatcaPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState("submissions");
  const [selected, setSelected] = useState<ZatcaSubmission | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Compliance", href: "/business/compliance" },
      { label: "ZATCA Phase 2" },
    ]);
  }, [setBreadcrumbs]);

  const configQuery = useQuery({
    queryKey: ["zatca-config", selectedCompanyId],
    queryFn: () => zatcaApi.configStatus(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const submissionsQuery = useQuery({
    queryKey: ["zatca-submissions", selectedCompanyId],
    queryFn: () => zatcaApi.listSubmissions(selectedCompanyId!, 200),
    enabled: !!selectedCompanyId,
  });

  const submissions = submissionsQuery.data?.submissions ?? [];

  const stats = useMemo(() => {
    const total = submissions.length;
    const cleared = submissions.filter((s) => s.status === "cleared").length;
    const reported = submissions.filter((s) => s.status === "reported").length;
    const rejected = submissions.filter((s) => s.status === "rejected").length;
    return { total, cleared, reported, rejected };
  }, [submissions]);

  if (!selectedCompanyId) {
    return <EmptyState icon={FileCheck2} message="Select a workspace first." />;
  }

  const cfg = configQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business/compliance">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold">ZATCA Phase 2</h1>
          <p className="text-sm text-muted-foreground">
            Saudi e-invoicing integration · clearance &amp; reporting
          </p>
        </div>
        <div className="text-right">
          {cfg && (
            <Badge
              className={
                cfg.mode === "production"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                  : cfg.mode === "sandbox"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
              }
            >
              {cfg.mode}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold tabular-nums">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Cleared</p>
            <p className="text-lg font-bold tabular-nums text-emerald-600">
              {stats.cleared}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Reported</p>
            <p className="text-lg font-bold tabular-nums text-blue-600">
              {stats.reported}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Rejected</p>
            <p
              className={`text-lg font-bold tabular-nums ${stats.rejected > 0 ? "text-red-600" : ""}`}
            >
              {stats.rejected}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="submissions">
            <ListChecks className="h-4 w-4 mr-1.5" />
            Submissions
          </TabsTrigger>
          <TabsTrigger value="statistics">
            <BarChart3 className="h-4 w-4 mr-1.5" />
            Statistics
          </TabsTrigger>
          <TabsTrigger value="configuration">
            <Settings className="h-4 w-4 mr-1.5" />
            Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="submissions" className="mt-4">
          {submissionsQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : submissions.length === 0 ? (
            <EmptyState
              icon={FileCheck2}
              message="No submissions yet. Submit an invoice from the Sales module to begin."
            />
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left p-2">UUID</th>
                      <th className="text-left p-2">ZATCA #</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Cleared</th>
                      <th className="text-right p-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s) => (
                      <tr key={s.uuid} className="border-t">
                        <td className="p-2 font-mono text-[11px] max-w-[200px] truncate">
                          {s.uuid}
                        </td>
                        <td className="p-2 font-mono text-xs">
                          {s.zatcaInvoiceNumber ?? "—"}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            {s.mock && (
                              <Badge variant="secondary" className="text-[10px]">
                                mock
                              </Badge>
                            )}
                            <StatusBadge status={s.status} />
                          </div>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {s.clearanceTimestamp ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(s.clearanceTimestamp).toLocaleString()}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelected(s)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Details
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="statistics" className="mt-4 space-y-3">
          <Card>
            <CardContent className="p-4 space-y-2 text-sm">
              <h3 className="font-semibold">Status breakdown</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                {(Object.keys(STATUS_META) as ZatcaSubmissionStatus[]).map((k) => {
                  const count = submissions.filter((s) => s.status === k).length;
                  return (
                    <div key={k} className="rounded border p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {STATUS_META[k].label}
                      </p>
                      <p className="text-xl font-bold tabular-nums">{count}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="configuration" className="mt-4 space-y-3">
          <Card>
            <CardContent className="p-4 space-y-3 text-sm">
              <h3 className="font-semibold">Environment configuration</h3>
              <p className="text-muted-foreground text-xs">
                ZATCA Phase 2 reads its credentials from environment variables.
                Restart the server after changing them.
              </p>
              <div className="rounded border bg-muted/30 p-3 font-mono text-xs space-y-1">
                <p>
                  ZATCA_CERTIFICATE ={" "}
                  {cfg?.privateKeyConfigured ? "[present]" : "[not set]"}
                </p>
                <p>
                  ZATCA_PRIVATE_KEY ={" "}
                  {cfg?.privateKeyConfigured ? "[present]" : "[not set]"}
                </p>
                <p>ZATCA_API_URL = {cfg?.baseUrl || "[not set]"}</p>
                <p>ZATCA_VAT_NUMBER = {cfg?.organizationId || "[not set]"}</p>
              </div>
              <p className="text-muted-foreground text-xs">
                Sandbox URL:{" "}
                <code className="text-[10px]">
                  https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal
                </code>
              </p>
              <p className="text-muted-foreground text-xs">
                Production URL:{" "}
                <code className="text-[10px]">
                  https://gw-fatoora.zatca.gov.sa/e-invoicing/core
                </code>
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <SubmissionDetailDialog
        open={!!selected}
        submission={selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      />
    </div>
  );
}
