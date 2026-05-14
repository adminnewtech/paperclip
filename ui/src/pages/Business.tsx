import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import type { BusinessModuleSpec } from "@paperclipai/shared";
import {
  Briefcase,
  ArrowRight,
  Sparkles,
  Users,
  Receipt,
  Package,
  Calculator,
  IdCard,
  LifeBuoy,
  Megaphone,
  ShoppingBag,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

const ICON_MAP: Record<string, LucideIcon> = {
  crm: Users,
  sales: Receipt,
  inventory: Package,
  finance: Calculator,
  hr: IdCard,
  helpdesk: LifeBuoy,
  marketing: Megaphone,
  ecommerce: ShoppingBag,
};

export function Business() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Business" }]);
  }, [setBreadcrumbs]);

  const catalogQuery = useQuery({
    queryKey: queryKeys.business.catalog,
    queryFn: () => businessApi.catalog(),
  });

  const modulesQuery = useQuery({
    queryKey: queryKeys.business.modules(selectedCompanyId!),
    queryFn: () => businessApi.listModules(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const summaryQuery = useQuery({
    queryKey: queryKeys.business.summary(selectedCompanyId!),
    queryFn: () => businessApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const enabledKeys = useMemo(() => {
    const rows = modulesQuery.data?.modules ?? [];
    return new Set(rows.filter((r) => r.enabled).map((r) => r.moduleKey));
  }, [modulesQuery.data]);

  const countsByModule = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of summaryQuery.data?.counts ?? []) {
      map.set(row.moduleKey, (map.get(row.moduleKey) ?? 0) + row.count);
    }
    return map;
  }, [summaryQuery.data]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Briefcase}
        message="Select a workspace to manage your business."
      />
    );
  }

  if (catalogQuery.isLoading || modulesQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const isFreshWorkspace = enabledKeys.size === 0;

  if (isFreshWorkspace) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Set up your business
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paperclip can run your whole business — CRM, sales, invoicing,
              inventory, accounting, HR, helpdesk, marketing and e-commerce —
              from this same dashboard. Pick your industry and we'll turn on
              the right modules and seed your chart of accounts automatically.
            </p>
            <div className="flex items-center gap-3">
              <Button asChild>
                <Link to="/business/setup">
                  Run setup wizard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground">
                Takes 30 seconds · fully reversible
              </p>
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Available modules
          </h2>
          <ModuleGrid
            modules={catalogQuery.data?.modules ?? []}
            enabledKeys={enabledKeys}
            counts={countsByModule}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Business</h1>
          <p className="text-sm text-muted-foreground">
            {enabledKeys.size} module{enabledKeys.size === 1 ? "" : "s"} active in this workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" asChild>
            <Link to="/business/dashboard">
              <LayoutDashboard className="h-4 w-4 mr-1.5" />
              Dashboard
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/business/setup">Manage modules</Link>
          </Button>
        </div>
      </div>
      <ModuleGrid
        modules={catalogQuery.data?.modules ?? []}
        enabledKeys={enabledKeys}
        counts={countsByModule}
      />
    </div>
  );
}

function ModuleGrid({
  modules,
  enabledKeys,
  counts,
}: {
  modules: BusinessModuleSpec[];
  enabledKeys: Set<string>;
  counts: Map<string, number>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {(modules ?? []).map((mod) => {
        const Icon = ICON_MAP[mod.key] ?? Briefcase;
        const enabled = enabledKeys.has(mod.key);
        const count = counts.get(mod.key) ?? 0;
        return (
          <Link key={mod.key} to={enabled ? `/business/${mod.key}` : "/business/setup"}>
            <Card className={`transition-shadow hover:shadow-md ${enabled ? "" : "opacity-55"}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`rounded-lg p-2 ${enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{mod.label}</span>
                      <span className="text-xs text-muted-foreground">/</span>
                      <span className="text-xs text-muted-foreground">{mod.arabicLabel}</span>
                      {!enabled && (
                        <Badge variant="outline" className="text-[10px]">
                          Off
                        </Badge>
                      )}
                      {enabled && count > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {count}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {mod.description}
                    </p>
                    {mod.replaces.length > 0 && (
                      <p className="text-[11px] text-muted-foreground/60 mt-1">
                        Replaces: {mod.replaces.join(", ")}
                      </p>
                    )}
                  </div>
                  {enabled && (
                    <ArrowRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
