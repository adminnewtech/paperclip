import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Loader2,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  businessAgentsApi,
  type BusinessAgentDefinition,
  type HiredAgent,
} from "../api/business-agents";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(cents: number, lang: "en" | "ar"): string {
  const value = (cents / 100).toLocaleString();
  return lang === "ar" ? `${value} ر.س / شهر` : `${value} SAR / month`;
}

function scheduleLabel(
  def: BusinessAgentDefinition,
  lang: "en" | "ar",
): string {
  if (lang === "ar") {
    switch (def.defaultSchedule) {
      case "hourly":
        return "كل ساعة";
      case "weekly":
        return `أسبوعياً، صباح الاثنين`;
      case "daily":
        return `يومياً الساعة ${def.defaultRunTime}`;
      default:
        return "حسب الحدث";
    }
  }
  switch (def.defaultSchedule) {
    case "hourly":
      return "Every hour";
    case "weekly":
      return "Weekly, Monday morning";
    case "daily":
      return `Daily at ${def.defaultRunTime}`;
    default:
      return "On event";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessAgentsHirePage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [lang, setLang] = useState<"en" | "ar">("en");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Hire an Agent" },
    ]);
  }, [setBreadcrumbs]);

  const catalogQuery = useQuery({
    queryKey: ["business", "agents", "catalog", selectedCompanyId],
    queryFn: () => businessAgentsApi.catalog(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const hiredQuery = useQuery({
    queryKey: ["business", "agents", "hired", selectedCompanyId],
    queryFn: () => businessAgentsApi.listHired(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const hireMut = useMutation({
    mutationFn: (slug: string) =>
      businessAgentsApi.hire(selectedCompanyId!, slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business", "agents", "hired", selectedCompanyId],
      });
    },
  });

  const catalog: BusinessAgentDefinition[] = catalogQuery.data?.agents ?? [];
  const hired: HiredAgent[] = hiredQuery.data?.hired ?? [];

  const hiredBySlug = useMemo(() => {
    const m = new Map<string, HiredAgent>();
    for (const h of hired) m.set(h.agentSlug, h);
    return m;
  }, [hired]);

  const totalActions = hired.reduce((s, h) => s + (h.actionsCount ?? 0), 0);
  const isRtl = lang === "ar";

  return (
    <div
      className="container mx-auto max-w-7xl space-y-6 p-6"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Bot className="h-6 w-6 text-violet-600" />
            {isRtl ? "وظّف وكيلاً ذكياً" : "Hire an AI Agent"}
            <Badge variant="secondary" className="ml-2">
              <Sparkles className="mr-1 h-3 w-3" />
              {isRtl ? "جديد" : "New"}
            </Badge>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isRtl
              ? "وظّف وكلاء ذكاء اصطناعي متخصصين لإدارة أعمالك تلقائياً — كل وكيل يعمل بجدول مستقل، ويتخذ إجراءات، ويُبقيك على اطلاع."
              : "Bring on specialized AI agents that manage parts of your business on autopilot. Each one runs on a schedule, takes real actions, and keeps you in the loop."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={lang === "en" ? "default" : "ghost"}
            size="sm"
            onClick={() => setLang("en")}
          >
            EN
          </Button>
          <Button
            variant={lang === "ar" ? "default" : "ghost"}
            size="sm"
            onClick={() => setLang("ar")}
          >
            عربي
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {isRtl ? "وكلاء معينون" : "Agents Hired"}
              </p>
              <p className="mt-1 text-3xl font-semibold">{hired.length}</p>
            </div>
            <UserPlus className="h-8 w-8 text-violet-500/70" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {isRtl ? "إجمالي الإجراءات" : "Total Actions"}
              </p>
              <p className="mt-1 text-3xl font-semibold">{totalActions}</p>
            </div>
            <Sparkles className="h-8 w-8 text-yellow-500/70" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {isRtl ? "وكلاء متاحون" : "Available Roles"}
              </p>
              <p className="mt-1 text-3xl font-semibold">{catalog.length}</p>
            </div>
            <Bot className="h-8 w-8 text-emerald-500/70" />
          </CardContent>
        </Card>
      </div>

      {/* Loading */}
      {(catalogQuery.isLoading || hiredQuery.isLoading) && (
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {isRtl ? "تحميل..." : "Loading..."}
        </div>
      )}

      {/* Agent cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {catalog.map((def) => {
          const isHired = hiredBySlug.has(def.slug);
          const hiredEntry = hiredBySlug.get(def.slug);
          return (
            <Card
              key={def.slug}
              className="group relative overflow-hidden border-muted/60 transition-shadow hover:shadow-lg"
            >
              {/* Accent strip */}
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: def.color }}
              />
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl shadow-sm"
                    style={{
                      backgroundColor: `${def.color}22`,
                      border: `2px solid ${def.color}55`,
                    }}
                    aria-hidden
                  >
                    <span>{def.emoji}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-lg font-semibold">
                        {isRtl ? def.personaNameAr : def.personaName}
                      </p>
                      {isHired && (
                        <Badge
                          variant={
                            hiredEntry?.status === "active"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {hiredEntry?.status === "active"
                            ? isRtl
                              ? "نشط"
                              : "Active"
                            : isRtl
                              ? "موقوف"
                              : "Paused"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {isRtl ? def.titleAr : def.title}
                    </p>
                  </div>
                </div>

                <p className="text-sm">
                  {isRtl ? def.descriptionAr : def.description}
                </p>

                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {isRtl ? "المهام" : "Responsibilities"}
                  </p>
                  <ul className="space-y-1 text-sm">
                    {(isRtl ? def.responsibilitiesAr : def.responsibilities)
                      .slice(0, 4)
                      .map((r, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            style={{ color: def.color }}
                          />
                          <span className="text-muted-foreground">{r}</span>
                        </li>
                      ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{scheduleLabel(def, lang)}</Badge>
                  {def.modulesAccessed.map((m) => (
                    <Badge key={m} variant="outline">
                      {m}
                    </Badge>
                  ))}
                </div>

                <div className="flex items-end justify-between pt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {isRtl ? "السعر المقترح" : "Suggested price"}
                    </p>
                    <p className="text-lg font-semibold">
                      {formatPrice(def.monthlyCostCents, lang)}
                    </p>
                  </div>
                  {isHired ? (
                    <Button asChild variant="outline">
                      <Link to={`/business/agents/${def.slug}`}>
                        {isRtl ? "عرض" : "View"}
                        <ArrowRight
                          className={
                            isRtl
                              ? "mr-2 h-4 w-4 rotate-180"
                              : "ml-2 h-4 w-4"
                          }
                        />
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      onClick={() => hireMut.mutate(def.slug)}
                      disabled={
                        hireMut.isPending && hireMut.variables === def.slug
                      }
                      style={{ backgroundColor: def.color }}
                      className="text-white hover:opacity-90"
                    >
                      {hireMut.isPending && hireMut.variables === def.slug ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="mr-2 h-4 w-4" />
                      )}
                      {isRtl ? "وظّف الآن" : "Hire Now"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {hireMut.isError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {(hireMut.error as Error).message}
        </div>
      )}
    </div>
  );
}
