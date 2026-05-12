import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  FileCheck2,
  Landmark,
  Banknote,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { zatcaApi, wpsApi, type ZatcaConfigStatus } from "../api/business-compliance";

function modeBadge(mode: ZatcaConfigStatus["mode"]) {
  switch (mode) {
    case "production":
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
          Production
        </Badge>
      );
    case "sandbox":
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
          Sandbox
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          Not configured
        </Badge>
      );
  }
}

interface ComplianceCardProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  region: string;
  description: string;
  status: React.ReactNode;
  nextStep?: string;
}

function ComplianceCard({
  to,
  icon: Icon,
  title,
  region,
  description,
  status,
  nextStep,
}: ComplianceCardProps) {
  return (
    <Link
      to={to}
      className="block group rounded-lg border bg-card hover:bg-accent/40 transition-colors"
    >
      <div className="p-4 flex items-start gap-3">
        <div className="shrink-0 rounded-md p-2 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {region}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
            {description}
          </p>
          <div className="mt-2 flex items-center gap-2 text-[11px]">{status}</div>
          {nextStep && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{nextStep}</span>
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

export function BusinessCompliancePage() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Compliance" },
    ]);
  }, [setBreadcrumbs]);

  const zatcaConfigQuery = useQuery({
    queryKey: ["zatca-config", selectedCompanyId],
    queryFn: () => zatcaApi.configStatus(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const wpsHistoryQuery = useQuery({
    queryKey: ["wps-history", selectedCompanyId],
    queryFn: () => wpsApi.history(selectedCompanyId!, 1),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={ShieldCheck}
        message="Select a workspace first to view compliance."
      />
    );
  }

  const zatcaMode = zatcaConfigQuery.data?.mode ?? "mock";
  const wpsRuns = wpsHistoryQuery.data?.history.length ?? 0;
  const latestWps = wpsHistoryQuery.data?.history[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Compliance</h1>
          <p className="text-sm text-muted-foreground">
            {selectedCompany?.name ? `${selectedCompany.name} · ` : ""}
            Regulatory reporting for KSA and Kuwait
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex items-start gap-3 text-sm">
          <ShieldCheck className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-muted-foreground">
            These modules cover the mandatory regulatory filings for Saudi
            Arabia and Kuwait: e-invoicing (ZATCA Phase 2), social insurance
            (GOSI), and the Wages Protection System (WPS / SARIE / CBK). When
            production credentials are not configured each module runs in a
            safe deterministic mock mode for development.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ComplianceCard
          to="/business/compliance/zatca"
          icon={FileCheck2}
          title="ZATCA Phase 2"
          region="Saudi Arabia · e-Invoicing"
          description="Sign each invoice cryptographically and submit to the Fatoora API for clearance or reporting."
          status={modeBadge(zatcaMode)}
          nextStep={
            zatcaMode === "mock"
              ? "Set ZATCA_CERTIFICATE, ZATCA_PRIVATE_KEY and ZATCA_API_URL to go live."
              : undefined
          }
        />
        <ComplianceCard
          to="/business/compliance/gosi"
          icon={Landmark}
          title="GOSI"
          region="Saudi Arabia · Social Insurance"
          description="Calculate monthly old-age, SANED and occupational-hazards contributions for Saudi and non-Saudi employees."
          status={
            <Badge variant="secondary" className="text-muted-foreground">
              Calculator ready
            </Badge>
          }
        />
        <ComplianceCard
          to="/business/compliance/wps"
          icon={Banknote}
          title="WPS Payroll"
          region="KSA · Kuwait · Wages Protection"
          description="Generate SARIE (SAR) or CBK (KWD) payroll files and validate employee bank details."
          status={
            wpsRuns > 0 ? (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                {wpsRuns} run{wpsRuns === 1 ? "" : "s"}
                {latestWps ? ` · last ${latestWps.period}` : ""}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-muted-foreground">
                No runs yet
              </Badge>
            )
          }
        />
      </div>
    </div>
  );
}
