import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sparkles,
  Store,
  Loader2,
  Wand2,
  CheckCircle2,
  Trash2,
  RefreshCcw,
  ShoppingBag,
  Package,
  Tag,
  Megaphone,
  Truck,
  CreditCard,
  Globe,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { Link, useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmptyState } from "../components/EmptyState";
import {
  storefrontBuilderApi,
  type StorefrontPlan,
  type StorefrontBuilderInput,
  type ApplyPlanResult,
} from "../api/storefront-builder";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDUSTRY_PICKS: Array<{ key: string; label: string; labelAr: string }> = [
  { key: "perfume", label: "Oud & Perfume", labelAr: "عود وعطور" },
  { key: "clothing", label: "Fashion", labelAr: "ملابس" },
  { key: "electronics", label: "Electronics", labelAr: "إلكترونيات" },
  { key: "restaurant", label: "Restaurant", labelAr: "مطعم" },
  { key: "beauty", label: "Beauty & Spa", labelAr: "تجميل" },
  { key: "other", label: "Other", labelAr: "أخرى" },
];

const GCC_COUNTRY_PICKS: Array<{
  code: string;
  label: string;
  currency: string;
}> = [
  { code: "KW", label: "Kuwait", currency: "KWD" },
  { code: "SA", label: "Saudi Arabia", currency: "SAR" },
  { code: "AE", label: "United Arab Emirates", currency: "AED" },
  { code: "QA", label: "Qatar", currency: "QAR" },
  { code: "BH", label: "Bahrain", currency: "BHD" },
  { code: "OM", label: "Oman", currency: "OMR" },
];

const CURRENCY_DECIMALS: Record<string, number> = {
  KWD: 3,
  BHD: 3,
  OMR: 3,
  SAR: 2,
  AED: 2,
  QAR: 2,
};

function formatMoney(cents: number, currency: string): string {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const major = cents / Math.pow(10, decimals);
  return `${major.toFixed(decimals)} ${currency}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Step = "describe" | "review" | "success";

export function BusinessStorefrontBuilderPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Storefront builder" },
    ]);
  }, [setBreadcrumbs]);

  const [step, setStep] = useState<Step>("describe");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState<string | null>(null);
  const [targetCountry, setTargetCountry] = useState("KW");
  const [budget, setBudget] = useState<"lean" | "standard" | "premium">(
    "standard",
  );
  const [lang, setLang] = useState<"ar" | "en">("ar");

  const [plan, setPlan] = useState<StorefrontPlan | null>(null);
  const [editedName, setEditedName] = useState("");
  const [editedTagline, setEditedTagline] = useState("");
  const [removedProductSkus, setRemovedProductSkus] = useState<Set<string>>(
    new Set(),
  );
  const [applyResult, setApplyResult] = useState<ApplyPlanResult | null>(null);

  const generateMutation = useMutation({
    mutationFn: (input: StorefrontBuilderInput) =>
      storefrontBuilderApi.generate(selectedCompanyId!, input),
    onSuccess: (data) => {
      setPlan(data.plan);
      setEditedName(data.plan.storefront.name);
      setEditedTagline(data.plan.storefront.tagline);
      setRemovedProductSkus(new Set());
      setStep("review");
    },
  });

  const applyMutation = useMutation({
    mutationFn: (finalPlan: StorefrontPlan) =>
      storefrontBuilderApi.apply(selectedCompanyId!, finalPlan),
    onSuccess: (data) => {
      setApplyResult(data.result);
      setStep("success");
    },
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Store}
        message="Select a workspace to use the storefront builder."
      />
    );
  }

  const handleGenerate = () => {
    if (description.trim().length < 3) return;
    const industryHint =
      industry && industry !== "other" ? industry : undefined;
    generateMutation.mutate({
      description: description.trim(),
      industry: industryHint,
      targetCountry,
      budget,
      lang,
    });
  };

  const handleApply = () => {
    if (!plan) return;
    const filteredProducts = plan.products.filter(
      (p) => !removedProductSkus.has(p.sku),
    );
    const finalPlan: StorefrontPlan = {
      ...plan,
      storefront: {
        ...plan.storefront,
        name: editedName || plan.storefront.name,
        tagline: editedTagline || plan.storefront.tagline,
      },
      products: filteredProducts,
    };
    applyMutation.mutate(finalPlan);
  };

  const handleStartOver = () => {
    setStep("describe");
    setPlan(null);
    setApplyResult(null);
    setRemovedProductSkus(new Set());
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <StepIndicator step={step} />

      {step === "describe" && (
        <DescribeStep
          description={description}
          onDescription={setDescription}
          industry={industry}
          onIndustry={setIndustry}
          targetCountry={targetCountry}
          onTargetCountry={setTargetCountry}
          budget={budget}
          onBudget={setBudget}
          lang={lang}
          onLang={setLang}
          onGenerate={handleGenerate}
          isLoading={generateMutation.isPending}
          error={
            generateMutation.error
              ? String(generateMutation.error)
              : null
          }
        />
      )}

      {step === "review" && plan && (
        <ReviewStep
          plan={plan}
          editedName={editedName}
          onEditedName={setEditedName}
          editedTagline={editedTagline}
          onEditedTagline={setEditedTagline}
          removedSkus={removedProductSkus}
          onToggleProduct={(sku) => {
            const next = new Set(removedProductSkus);
            if (next.has(sku)) next.delete(sku);
            else next.add(sku);
            setRemovedProductSkus(next);
          }}
          onRegenerate={handleGenerate}
          isRegenerating={generateMutation.isPending}
          onApply={handleApply}
          isApplying={applyMutation.isPending}
          applyError={
            applyMutation.error ? String(applyMutation.error) : null
          }
        />
      )}

      {step === "success" && plan && applyResult && (
        <SuccessStep
          plan={plan}
          result={applyResult}
          onStartOver={handleStartOver}
          onGoToEcommerce={() => navigate("/business/ecommerce")}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "describe", label: "Describe" },
    { key: "review", label: "Review" },
    { key: "success", label: "Launch" },
  ];
  const activeIdx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, idx) => {
        const active = idx === activeIdx;
        const done = idx < activeIdx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium ${
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-emerald-500 text-white"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
            </div>
            <span
              className={`text-sm ${active ? "font-medium" : "text-muted-foreground"}`}
            >
              {s.label}
            </span>
            {idx < steps.length - 1 && (
              <div className="w-8 h-px bg-border mx-2" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Describe
// ---------------------------------------------------------------------------

interface DescribeStepProps {
  description: string;
  onDescription: (v: string) => void;
  industry: string | null;
  onIndustry: (v: string | null) => void;
  targetCountry: string;
  onTargetCountry: (v: string) => void;
  budget: "lean" | "standard" | "premium";
  onBudget: (v: "lean" | "standard" | "premium") => void;
  lang: "ar" | "en";
  onLang: (v: "ar" | "en") => void;
  onGenerate: () => void;
  isLoading: boolean;
  error: string | null;
}

function DescribeStep(props: DescribeStepProps) {
  const placeholder =
    props.lang === "ar"
      ? "اوصف فكرة متجرك... مثلاً: متجر إلكتروني لبيع العود مع خصومات للمؤسسين"
      : "Describe your store idea... e.g. An online shop selling premium oud with founder discounts";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Storefront Builder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Describe what you want to sell. Our AI will generate a complete
            store — brand, products, pricing, discounts and marketing — in one
            step.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="space-y-2">
            <Label htmlFor="sb-desc" className="text-sm font-medium">
              Describe your business
            </Label>
            <Textarea
              id="sb-desc"
              value={props.description}
              onChange={(e) => props.onDescription(e.target.value)}
              placeholder={placeholder}
              rows={4}
              dir={props.lang === "ar" ? "rtl" : "ltr"}
              className="text-base"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Industry (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {INDUSTRY_PICKS.map((pick) => {
                const active = props.industry === pick.key;
                return (
                  <button
                    key={pick.key}
                    type="button"
                    onClick={() =>
                      props.onIndustry(active ? null : pick.key)
                    }
                    className={`px-3 py-1.5 rounded-full text-xs border transition ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent border-border"
                    }`}
                  >
                    <span className="font-medium">{pick.label}</span>
                    <span className="opacity-70 ms-2">{pick.labelAr}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sb-country" className="text-xs">
                Target country
              </Label>
              <Select
                value={props.targetCountry}
                onValueChange={props.onTargetCountry}
              >
                <SelectTrigger id="sb-country">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GCC_COUNTRY_PICKS.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label} ({c.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sb-budget" className="text-xs">
                Budget level
              </Label>
              <Select
                value={props.budget}
                onValueChange={(v) =>
                  props.onBudget(v as "lean" | "standard" | "premium")
                }
              >
                <SelectTrigger id="sb-budget">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lean">Lean</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sb-lang" className="text-xs">
                Primary language
              </Label>
              <Select
                value={props.lang}
                onValueChange={(v) => props.onLang(v as "ar" | "en")}
              >
                <SelectTrigger id="sb-lang">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ar">العربية</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {props.error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{props.error}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              size="lg"
              onClick={props.onGenerate}
              disabled={
                props.isLoading || props.description.trim().length < 3
              }
            >
              {props.isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  Generating (5-15s)...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 me-2" />
                  Generate store
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Review
// ---------------------------------------------------------------------------

interface ReviewStepProps {
  plan: StorefrontPlan;
  editedName: string;
  onEditedName: (v: string) => void;
  editedTagline: string;
  onEditedTagline: (v: string) => void;
  removedSkus: Set<string>;
  onToggleProduct: (sku: string) => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  onApply: () => void;
  isApplying: boolean;
  applyError: string | null;
}

function ReviewStep(props: ReviewStepProps) {
  const { plan } = props;
  const currency = plan.storefront.currency;
  const keptCount = plan.products.length - props.removedSkus.size;

  return (
    <>
      {plan.mock && (
        <div className="flex items-center gap-2 text-xs bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 rounded-md px-3 py-2">
          <Badge variant="outline" className="text-[10px]">
            Demo
          </Badge>
          <span>
            Generated from a deterministic template (no LLM connected). Set
            ANTHROPIC_API_KEY to use AI generation.
          </span>
        </div>
      )}

      <Card
        style={{
          background: `linear-gradient(135deg, ${plan.storefront.brandColors.primary}, ${plan.storefront.brandColors.secondary})`,
          color: "white",
        }}
      >
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 flex-1 min-w-0">
              <Input
                value={props.editedName}
                onChange={(e) => props.onEditedName(e.target.value)}
                className="text-2xl font-bold bg-white/10 border-white/30 text-white placeholder:text-white/60"
              />
              <div className="text-sm opacity-90">
                {plan.storefront.nameAr}
              </div>
              <Input
                value={props.editedTagline}
                onChange={(e) => props.onEditedTagline(e.target.value)}
                className="bg-white/10 border-white/30 text-white placeholder:text-white/60"
              />
              <div className="text-xs opacity-80">
                {plan.storefront.taglineAr}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge
                variant="secondary"
                className="bg-white/20 text-white border-0 uppercase text-[10px]"
              >
                {plan.storefront.theme}
              </Badge>
              <div className="text-xs opacity-80">
                {plan.storefront.suggestedDomain}
              </div>
              <div className="flex gap-1 mt-1">
                <div
                  className="w-5 h-5 rounded border border-white/40"
                  style={{
                    background: plan.storefront.brandColors.primary,
                  }}
                  title="primary"
                />
                <div
                  className="w-5 h-5 rounded border border-white/40"
                  style={{
                    background: plan.storefront.brandColors.secondary,
                  }}
                  title="secondary"
                />
                <div
                  className="w-5 h-5 rounded border border-white/40"
                  style={{
                    background: plan.storefront.brandColors.accent,
                  }}
                  title="accent"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={ShoppingBag}
          label="Products"
          value={`${keptCount}/${plan.products.length}`}
        />
        <StatCard
          icon={Tag}
          label="Categories"
          value={String(plan.categories.length)}
        />
        <StatCard
          icon={Megaphone}
          label="Campaigns"
          value={String(plan.campaigns.length)}
        />
        <StatCard
          icon={Globe}
          label="Country"
          value={`${plan.storefront.countryCode} (${currency})`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Categories
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {plan.categories.map((cat) => (
              <Badge
                key={cat.slug}
                variant="secondary"
                className="text-xs px-3 py-1"
              >
                {cat.name}
                <span className="ms-2 opacity-70">{cat.nameAr}</span>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Products ({plan.products.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {plan.products.map((product) => {
              const removed = props.removedSkus.has(product.sku);
              return (
                <div
                  key={product.sku}
                  className={`p-3 rounded-md border ${
                    removed
                      ? "opacity-50 bg-muted line-through"
                      : "bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">
                        {product.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {product.nameAr}
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="font-semibold">
                          {formatMoney(product.priceCents, currency)}
                        </span>
                        <span className="text-muted-foreground">
                          stock: {product.initialStock}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {product.sku}
                        </Badge>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => props.onToggleProduct(product.sku)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      title={removed ? "Restore" : "Remove"}
                    >
                      {removed ? (
                        <RefreshCcw className="h-4 w-4" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Discounts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {plan.discounts.map((d) => (
            <div
              key={d.code}
              className="flex items-center justify-between p-3 rounded-md border bg-card"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="font-mono">
                    {d.code}
                  </Badge>
                  <span className="text-sm">
                    {d.type === "percentage"
                      ? `${d.value}% off`
                      : formatMoney(d.value, currency) + " off"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {d.description}
                </div>
              </div>
              {d.expiresInDays && (
                <Badge variant="outline" className="text-[10px]">
                  expires in {d.expiresInDays}d
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Megaphone className="h-4 w-4" />
            Marketing campaigns (draft)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {plan.campaigns.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-between p-3 rounded-md border bg-card"
            >
              <div>
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.description}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {c.channel}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatMoney(c.budgetCents, currency)}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Shipping zones
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {plan.shippingZones.map((z) => (
              <div
                key={z.name}
                className="p-2 rounded-md border bg-card text-xs"
              >
                <div className="font-medium">{z.name}</div>
                <div className="text-muted-foreground mt-1">
                  {z.countries.join(", ")} ·{" "}
                  {formatMoney(z.flatRateCents, currency)}
                  {z.freeShippingMinCents
                    ? ` · free above ${formatMoney(z.freeShippingMinCents, currency)}`
                    : ""}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Payment methods
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {plan.paymentMethods.map((m) => (
                <Badge key={m} variant="outline" className="text-xs uppercase">
                  {m}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {props.applyError && (
        <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          <span>{props.applyError}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 sticky bottom-0 bg-background/95 backdrop-blur p-3 border-t -mx-4 px-4">
        <Button
          variant="outline"
          onClick={props.onRegenerate}
          disabled={props.isRegenerating || props.isApplying}
        >
          {props.isRegenerating ? (
            <>
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
              Regenerating...
            </>
          ) : (
            <>
              <RefreshCcw className="h-4 w-4 me-2" />
              Regenerate
            </>
          )}
        </Button>
        <Button
          size="lg"
          onClick={props.onApply}
          disabled={props.isApplying || keptCount === 0}
        >
          {props.isApplying ? (
            <>
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
              Building store...
            </>
          ) : (
            <>
              Launch store
              <ArrowRight className="h-4 w-4 ms-2" />
            </>
          )}
        </Button>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ShoppingBag;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-semibold text-sm truncate">{value}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Success
// ---------------------------------------------------------------------------

function SuccessStep({
  plan,
  result,
  onStartOver,
  onGoToEcommerce,
}: {
  plan: StorefrontPlan;
  result: ApplyPlanResult;
  onStartOver: () => void;
  onGoToEcommerce: () => void;
}) {
  const totals = useMemo(
    () => ({
      products: result.productIds.length,
      categories: result.categoryIds.length,
      discounts: result.discountIds.length,
      campaigns: result.campaignIds.length,
    }),
    [result],
  );

  return (
    <>
      <Card>
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Your store is live!</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {plan.storefront.name} is ready. Here's what we created:
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto">
            <SummaryStat label="Products" value={totals.products} />
            <SummaryStat label="Categories" value={totals.categories} />
            <SummaryStat label="Discounts" value={totals.discounts} />
            <SummaryStat label="Campaigns" value={totals.campaigns} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <NextStepLink
            href="/business/ecommerce"
            title="Open your storefront"
            description="Review the store, customize the theme, connect a domain."
            icon={Store}
          />
          <NextStepLink
            href="/business/inventory"
            title="Manage products"
            description={`${totals.products} products created. Adjust stock and pricing.`}
            icon={Package}
          />
          <NextStepLink
            href="/business/marketing"
            title="Launch campaigns"
            description={`${totals.campaigns} draft campaigns ready to send.`}
            icon={Megaphone}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onStartOver}>
          <Wand2 className="h-4 w-4 me-2" />
          Build another
        </Button>
        <Button onClick={onGoToEcommerce}>
          Go to storefront
          <ArrowRight className="h-4 w-4 ms-2" />
        </Button>
      </div>
    </>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function NextStepLink({
  href,
  title,
  description,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: typeof Store;
}) {
  return (
    <Link
      to={href}
      className="flex items-center gap-3 p-3 rounded-md border hover:bg-accent transition"
    >
      <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}
