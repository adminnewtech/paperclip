import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { Briefcase, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

export function BusinessSetup() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [extraModules, setExtraModules] = useState<Set<string>>(new Set());

  useEffect(() => {
    setBreadcrumbs([{ label: "Business", href: "/business" }, { label: "Setup" }]);
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

  const setupMutation = useMutation({
    mutationFn: (input: { industryPreset: string; additionalModules: string[] }) =>
      businessApi.setup(selectedCompanyId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.modules(selectedCompanyId!),
      });
      navigate("/business");
    },
  });

  const presets = catalogQuery.data?.industries ?? [];
  const modules = catalogQuery.data?.modules ?? [];

  const presetModules = useMemo(() => {
    if (!selectedIndustry) return new Set<string>();
    const preset = presets.find((p) => p.key === selectedIndustry);
    return new Set(preset?.modules ?? []);
  }, [selectedIndustry, presets]);

  const finalModules = useMemo(() => {
    return new Set([...presetModules, ...extraModules]);
  }, [presetModules, extraModules]);

  if (!selectedCompanyId) {
    return (
      <EmptyState icon={Briefcase} message="Select a workspace to run setup." />
    );
  }

  if (catalogQuery.isLoading || modulesQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const alreadyEnabled = new Set(
    (modulesQuery.data?.modules ?? [])
      .filter((m) => m.enabled)
      .map((m) => m.moduleKey),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Business setup wizard
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Pick what your business does. We'll enable the modules you need and
            seed sensible defaults (chart of accounts, sales pipeline, product
            categories) so you can start working immediately.
          </p>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-medium mb-3">1. What does your business do?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {presets.map((preset) => {
            const isSelected = selectedIndustry === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => setSelectedIndustry(preset.key)}
                className="text-left"
              >
                <Card
                  className={
                    isSelected
                      ? "border-primary ring-1 ring-primary"
                      : "hover:border-primary/40"
                  }
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{preset.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {preset.arabicLabel}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 text-primary mt-0.5" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {preset.description}
                    </p>
                    {preset.modules.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {preset.modules.map((m) => (
                          <Badge key={m} variant="secondary" className="text-[10px]">
                            {m}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      </div>

      {selectedIndustry && (
        <div>
          <h2 className="text-sm font-medium mb-3">
            2. Modules to enable (you can change later)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {modules.map((mod) => {
              const inPreset = presetModules.has(mod.key);
              const isExtra = extraModules.has(mod.key);
              const willEnable = inPreset || isExtra;
              const wasEnabled = alreadyEnabled.has(mod.key);
              return (
                <label
                  key={mod.key}
                  className="flex items-start gap-3 p-3 border cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox
                    checked={willEnable}
                    disabled={inPreset}
                    onCheckedChange={(checked) => {
                      setExtraModules((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(mod.key);
                        else next.delete(mod.key);
                        return next;
                      });
                    }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{mod.label}</span>
                      {inPreset && (
                        <Badge variant="secondary" className="text-[10px]">
                          Recommended
                        </Badge>
                      )}
                      {wasEnabled && (
                        <Badge variant="outline" className="text-[10px]">
                          Already enabled
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {mod.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-4">
        <div className="text-sm text-muted-foreground">
          {selectedIndustry
            ? `${finalModules.size} module${finalModules.size === 1 ? "" : "s"} will be activated.`
            : "Pick an industry to continue."}
        </div>
        <Button
          disabled={!selectedIndustry || setupMutation.isPending}
          onClick={() => {
            if (!selectedIndustry) return;
            const additional = Array.from(extraModules).filter(
              (k) => !presetModules.has(k),
            );
            setupMutation.mutate({
              industryPreset: selectedIndustry,
              additionalModules: additional,
            });
          }}
        >
          {setupMutation.isPending ? "Activating…" : "Activate modules"}
        </Button>
      </div>
      {setupMutation.error && (
        <p className="text-sm text-destructive">
          {(setupMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
