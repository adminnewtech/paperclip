import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Settings,
  Building2,
  ShieldCheck,
  Percent,
  Languages,
  Workflow,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  settingsApi,
  type OrgSettingsRow,
  type RoleRow,
  type TaxRateRow,
  type CurrencyRateRow,
  type AutomationRuleRow,
} from "../api/settings";

type SectionKey =
  | "organization"
  | "roles"
  | "taxes"
  | "localization"
  | "automation";

const settingsKeys = {
  org: (companyId: string) => ["bos-settings", "org", companyId] as const,
  roles: (companyId: string) => ["bos-settings", "roles", companyId] as const,
  taxRates: (companyId: string) =>
    ["bos-settings", "tax-rates", companyId] as const,
  currencyRates: (companyId: string) =>
    ["bos-settings", "currency-rates", companyId] as const,
  automationRules: (companyId: string) =>
    ["bos-settings", "automation-rules", companyId] as const,
};

const SECTIONS: Array<{
  key: SectionKey;
  label: string;
  arabicLabel: string;
  icon: typeof Building2;
}> = [
  { key: "organization", label: "Organization", arabicLabel: "المنشأة", icon: Building2 },
  { key: "roles", label: "Roles & Permissions", arabicLabel: "الأدوار والصلاحيات", icon: ShieldCheck },
  { key: "taxes", label: "Taxes & Currencies", arabicLabel: "الضرائب والعملات", icon: Percent },
  { key: "localization", label: "Localization", arabicLabel: "اللغة والمنطقة", icon: Languages },
  { key: "automation", label: "Automation", arabicLabel: "الأتمتة", icon: Workflow },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function BusinessSettings() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [section, setSection] = useState<SectionKey>("organization");

  useEffect(() => {
    setBreadcrumbs([{ label: "Business Settings" }]);
  }, [setBreadcrumbs]);

  const orgQuery = useQuery({
    queryKey: settingsKeys.org(selectedCompanyId!),
    queryFn: () => settingsApi.getOrg(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const rtl = orgQuery.data?.orgSettings?.rtl ?? true;

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Settings}
        message="Select a workspace to manage business settings."
      />
    );
  }

  return (
    <div className="space-y-6" dir={rtl ? "rtl" : "ltr"}>
      <div>
        <h1 className="text-2xl font-semibold">
          {rtl ? "الإعدادات" : "Business Settings"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {rtl
            ? "إدارة بيانات المنشأة والأدوار والضرائب والأتمتة."
            : "Manage organization details, roles, taxes, localization, and automation."}
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left nav */}
        <nav className="lg:w-56 shrink-0">
          <ul className="flex lg:flex-col gap-1 overflow-x-auto">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = s.key === section;
              return (
                <li key={s.key} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setSection(s.key)}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-start transition-colors ${
                      active
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/50"
                    }`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {rtl ? s.arabicLabel : s.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Right panel */}
        <div className="flex-1 min-w-0">
          {section === "organization" && (
            <OrganizationSection
              companyId={selectedCompanyId}
              orgQuery={orgQuery}
              rtl={rtl}
            />
          )}
          {section === "roles" && (
            <RolesSection companyId={selectedCompanyId} rtl={rtl} />
          )}
          {section === "taxes" && (
            <TaxesSection companyId={selectedCompanyId} rtl={rtl} />
          )}
          {section === "localization" && (
            <OrganizationSection
              companyId={selectedCompanyId}
              orgQuery={orgQuery}
              rtl={rtl}
              localizationOnly
            />
          )}
          {section === "automation" && (
            <AutomationSection companyId={selectedCompanyId} rtl={rtl} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organization (+ Localization subset)
// ---------------------------------------------------------------------------

function OrganizationSection({
  companyId,
  orgQuery,
  rtl,
  localizationOnly = false,
}: {
  companyId: string;
  orgQuery: ReturnType<typeof useQuery<{ orgSettings: OrgSettingsRow | null }>>;
  rtl: boolean;
  localizationOnly?: boolean;
}) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const org = orgQuery.data?.orgSettings ?? null;

  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [crNumber, setCrNumber] = useState("");
  const [address, setAddress] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("KWD");
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(1);
  const [locale, setLocale] = useState("ar");
  const [rtlValue, setRtlValue] = useState(true);

  useEffect(() => {
    setLegalName(org?.legalName ?? "");
    setTaxId(org?.taxId ?? "");
    setCrNumber(org?.crNumber ?? "");
    setAddress(org?.address ?? "");
    setDefaultCurrency(org?.defaultCurrency ?? "KWD");
    setFiscalYearStartMonth(org?.fiscalYearStartMonth ?? 1);
    setLocale(org?.locale ?? "ar");
    setRtlValue(org?.rtl ?? true);
  }, [org]);

  const save = useMutation({
    mutationFn: () =>
      settingsApi.updateOrg(companyId, {
        legalName: legalName.trim() || null,
        taxId: taxId.trim() || null,
        crNumber: crNumber.trim() || null,
        address: address.trim() || null,
        defaultCurrency,
        fiscalYearStartMonth,
        locale,
        rtl: rtlValue,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.org(companyId) });
      pushToast({
        title: rtl ? "تم الحفظ" : "Settings saved",
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: rtl ? "فشل الحفظ" : "Failed to save",
        body: (error as Error)?.message,
        tone: "error",
      });
    },
  });

  if (orgQuery.isLoading) return <PageSkeleton variant="detail" />;
  if (orgQuery.isError) {
    return (
      <EmptyState
        icon={Building2}
        message={
          (orgQuery.error as Error)?.message ?? "Failed to load settings."
        }
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        {!localizationOnly && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="legal-name">
                {rtl ? "الاسم القانوني" : "Legal name"}
              </Label>
              <Input
                id="legal-name"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder={rtl ? "اسم الشركة" : "Company legal name"}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tax-id">{rtl ? "الرقم الضريبي" : "Tax ID"}</Label>
                <Input
                  id="tax-id"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-number">
                  {rtl ? "رقم السجل التجاري" : "CR number"}
                </Label>
                <Input
                  id="cr-number"
                  value={crNumber}
                  onChange={(e) => setCrNumber(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">{rtl ? "العنوان" : "Address"}</Label>
              <Textarea
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="currency">
                  {rtl ? "العملة الافتراضية" : "Default currency"}
                </Label>
                <Input
                  id="currency"
                  value={defaultCurrency}
                  onChange={(e) =>
                    setDefaultCurrency(e.target.value.toUpperCase())
                  }
                  maxLength={10}
                  placeholder="KWD"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{rtl ? "بداية السنة المالية" : "Fiscal year start"}</Label>
                <Select
                  value={String(fiscalYearStartMonth)}
                  onValueChange={(v) => setFiscalYearStartMonth(Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}

        {/* Localization fields (shown in both views) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>{rtl ? "اللغة" : "Locale"}</Label>
            <Select value={locale} onValueChange={setLocale}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ar">العربية (ar)</SelectItem>
                <SelectItem value="en">English (en)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{rtl ? "اتجاه من اليمين لليسار" : "Right-to-left (RTL)"}</Label>
            <div className="flex items-center gap-2 h-9">
              <ToggleSwitch checked={rtlValue} onCheckedChange={setRtlValue} />
              <span className="text-sm text-muted-foreground">
                {rtlValue ? (rtl ? "مفعّل" : "Enabled") : rtl ? "معطّل" : "Disabled"}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending
              ? rtl
                ? "جارٍ الحفظ…"
                : "Saving…"
              : rtl
                ? "حفظ"
                : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

function RolesSection({ companyId, rtl }: { companyId: string; rtl: boolean }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const rolesQuery = useQuery({
    queryKey: settingsKeys.roles(companyId),
    queryFn: () => settingsApi.listRoles(companyId),
    enabled: !!companyId,
  });

  const createRole = useMutation({
    mutationFn: () =>
      settingsApi.createRole(companyId, {
        name: name.trim(),
        description: description.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.roles(companyId) });
      setDialogOpen(false);
      setName("");
      setDescription("");
      pushToast({ title: rtl ? "تم إنشاء الدور" : "Role created", tone: "success" });
    },
    onError: (error) =>
      pushToast({
        title: rtl ? "فشل الإنشاء" : "Failed to create role",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  const roles = rolesQuery.data?.roles ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {rtl ? "الأدوار والصلاحيات" : "Roles & Permissions"}
        </h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          {rtl ? "دور جديد" : "New role"}
        </Button>
      </div>

      {rolesQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : rolesQuery.isError ? (
        <EmptyState
          icon={ShieldCheck}
          message={(rolesQuery.error as Error)?.message ?? "Failed to load roles."}
        />
      ) : roles.length === 0 ? (
        <EmptyState icon={ShieldCheck} message={rtl ? "لا توجد أدوار بعد." : "No roles yet."} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {roles.map((role: RoleRow) => (
            <Card key={role.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{role.name}</span>
                  {role.isSystem && (
                    <Badge variant="secondary" className="text-[10px]">
                      {rtl ? "نظام" : "System"}
                    </Badge>
                  )}
                </div>
                {role.description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {role.description}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{rtl ? "دور جديد" : "New role"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">{rtl ? "الاسم" : "Name"}</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-desc">{rtl ? "الوصف" : "Description"}</Label>
              <Textarea
                id="role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createRole.isPending}
            >
              {rtl ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={() => createRole.mutate()}
              disabled={!name.trim() || createRole.isPending}
            >
              {createRole.isPending
                ? rtl
                  ? "جارٍ…"
                  : "Creating…"
                : rtl
                  ? "إنشاء"
                  : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taxes & Currencies
// ---------------------------------------------------------------------------

function TaxesSection({ companyId, rtl }: { companyId: string; rtl: boolean }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [taxDialogOpen, setTaxDialogOpen] = useState(false);
  const [currencyDialogOpen, setCurrencyDialogOpen] = useState(false);
  const [taxName, setTaxName] = useState("");
  const [taxPct, setTaxPct] = useState("");
  const [taxCountry, setTaxCountry] = useState("");
  const [taxDefault, setTaxDefault] = useState(false);
  const [currencyCode, setCurrencyCode] = useState("");
  const [currencyRate, setCurrencyRate] = useState("");

  const taxRatesQuery = useQuery({
    queryKey: settingsKeys.taxRates(companyId),
    queryFn: () => settingsApi.listTaxRates(companyId),
    enabled: !!companyId,
  });
  const currencyRatesQuery = useQuery({
    queryKey: settingsKeys.currencyRates(companyId),
    queryFn: () => settingsApi.listCurrencyRates(companyId),
    enabled: !!companyId,
  });

  const createTaxRate = useMutation({
    mutationFn: () =>
      settingsApi.createTaxRate(companyId, {
        name: taxName.trim(),
        rateBps: Math.round(Number(taxPct) * 100),
        isDefault: taxDefault,
        country: taxCountry.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.taxRates(companyId),
      });
      setTaxDialogOpen(false);
      setTaxName("");
      setTaxPct("");
      setTaxCountry("");
      setTaxDefault(false);
      pushToast({ title: rtl ? "تم إنشاء الضريبة" : "Tax rate created", tone: "success" });
    },
    onError: (error) =>
      pushToast({
        title: rtl ? "فشل الإنشاء" : "Failed to create tax rate",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  const createCurrencyRate = useMutation({
    mutationFn: () =>
      settingsApi.createCurrencyRate(companyId, {
        code: currencyCode.trim().toUpperCase(),
        rateToBase: Number(currencyRate),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.currencyRates(companyId),
      });
      setCurrencyDialogOpen(false);
      setCurrencyCode("");
      setCurrencyRate("");
      pushToast({ title: rtl ? "تم إنشاء سعر الصرف" : "Currency rate created", tone: "success" });
    },
    onError: (error) =>
      pushToast({
        title: rtl ? "فشل الإنشاء" : "Failed to create currency rate",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  const taxRates = taxRatesQuery.data?.taxRates ?? [];
  const currencyRates = currencyRatesQuery.data?.currencyRates ?? [];

  return (
    <div className="space-y-6">
      {/* Tax rates */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{rtl ? "الضرائب" : "Tax rates"}</h2>
          <Button size="sm" onClick={() => setTaxDialogOpen(true)}>
            <Plus className="me-1.5 h-4 w-4" />
            {rtl ? "ضريبة جديدة" : "New tax rate"}
          </Button>
        </div>
        {taxRatesQuery.isLoading ? (
          <PageSkeleton variant="list" />
        ) : taxRates.length === 0 ? (
          <EmptyState icon={Percent} message={rtl ? "لا توجد ضرائب بعد." : "No tax rates yet."} />
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-start font-medium px-4 py-2">{rtl ? "الاسم" : "Name"}</th>
                    <th className="text-end font-medium px-4 py-2">{rtl ? "النسبة" : "Rate"}</th>
                    <th className="text-start font-medium px-4 py-2">{rtl ? "الدولة" : "Country"}</th>
                  </tr>
                </thead>
                <tbody>
                  {taxRates.map((t: TaxRateRow) => (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        <span className="font-medium">{t.name}</span>
                        {t.isDefault && (
                          <Badge variant="secondary" className="ms-2 text-[10px]">
                            {rtl ? "افتراضي" : "Default"}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-end font-mono">
                        {(t.rateBps / 100).toFixed(2)}%
                      </td>
                      <td className="px-4 py-2">{t.country ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Currency rates */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{rtl ? "أسعار الصرف" : "Currency rates"}</h2>
          <Button size="sm" onClick={() => setCurrencyDialogOpen(true)}>
            <Plus className="me-1.5 h-4 w-4" />
            {rtl ? "سعر صرف جديد" : "New currency rate"}
          </Button>
        </div>
        {currencyRatesQuery.isLoading ? (
          <PageSkeleton variant="list" />
        ) : currencyRates.length === 0 ? (
          <EmptyState icon={Percent} message={rtl ? "لا توجد أسعار صرف بعد." : "No currency rates yet."} />
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-start font-medium px-4 py-2">{rtl ? "العملة" : "Code"}</th>
                    <th className="text-end font-medium px-4 py-2">{rtl ? "السعر للأساس" : "Rate to base"}</th>
                    <th className="text-start font-medium px-4 py-2">{rtl ? "بتاريخ" : "As of"}</th>
                  </tr>
                </thead>
                <tbody>
                  {currencyRates.map((c: CurrencyRateRow) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium">{c.code}</td>
                      <td className="px-4 py-2 text-end font-mono">{c.rateToBase}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(c.asOf).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tax dialog */}
      <Dialog open={taxDialogOpen} onOpenChange={setTaxDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{rtl ? "ضريبة جديدة" : "New tax rate"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="tax-name">{rtl ? "الاسم" : "Name"}</Label>
              <Input
                id="tax-name"
                value={taxName}
                onChange={(e) => setTaxName(e.target.value)}
                placeholder="VAT"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tax-pct">{rtl ? "النسبة %" : "Rate %"}</Label>
                <Input
                  id="tax-pct"
                  type="number"
                  value={taxPct}
                  onChange={(e) => setTaxPct(e.target.value)}
                  placeholder="15"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax-country">{rtl ? "الدولة" : "Country"}</Label>
                <Input
                  id="tax-country"
                  value={taxCountry}
                  onChange={(e) => setTaxCountry(e.target.value)}
                  placeholder="KW"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ToggleSwitch checked={taxDefault} onCheckedChange={setTaxDefault} />
              <span className="text-sm text-muted-foreground">
                {rtl ? "افتراضي" : "Set as default"}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTaxDialogOpen(false)}
              disabled={createTaxRate.isPending}
            >
              {rtl ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={() => createTaxRate.mutate()}
              disabled={!taxName.trim() || !taxPct || createTaxRate.isPending}
            >
              {createTaxRate.isPending
                ? rtl ? "جارٍ…" : "Creating…"
                : rtl ? "إنشاء" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Currency dialog */}
      <Dialog open={currencyDialogOpen} onOpenChange={setCurrencyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{rtl ? "سعر صرف جديد" : "New currency rate"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cur-code">{rtl ? "العملة" : "Code"}</Label>
                <Input
                  id="cur-code"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                  placeholder="USD"
                  maxLength={10}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cur-rate">{rtl ? "السعر للأساس" : "Rate to base"}</Label>
                <Input
                  id="cur-rate"
                  type="number"
                  value={currencyRate}
                  onChange={(e) => setCurrencyRate(e.target.value)}
                  placeholder="0.307"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCurrencyDialogOpen(false)}
              disabled={createCurrencyRate.isPending}
            >
              {rtl ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={() => createCurrencyRate.mutate()}
              disabled={
                !currencyCode.trim() || !currencyRate || createCurrencyRate.isPending
              }
            >
              {createCurrencyRate.isPending
                ? rtl ? "جارٍ…" : "Creating…"
                : rtl ? "إنشاء" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

function AutomationSection({
  companyId,
  rtl,
}: {
  companyId: string;
  rtl: boolean;
}) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("");

  const rulesQuery = useQuery({
    queryKey: settingsKeys.automationRules(companyId),
    queryFn: () => settingsApi.listAutomationRules(companyId),
    enabled: !!companyId,
  });

  const createRule = useMutation({
    mutationFn: () =>
      settingsApi.createAutomationRule(companyId, {
        name: name.trim(),
        triggerEvent: triggerEvent.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.automationRules(companyId),
      });
      setDialogOpen(false);
      setName("");
      setTriggerEvent("");
      pushToast({ title: rtl ? "تم إنشاء القاعدة" : "Rule created", tone: "success" });
    },
    onError: (error) =>
      pushToast({
        title: rtl ? "فشل الإنشاء" : "Failed to create rule",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      settingsApi.updateAutomationRule(companyId, id, { enabled }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: settingsKeys.automationRules(companyId),
      }),
    onError: (error) =>
      pushToast({
        title: rtl ? "فشل التحديث" : "Failed to update rule",
        body: (error as Error)?.message,
        tone: "error",
      }),
  });

  const rules = rulesQuery.data?.automationRules ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{rtl ? "الأتمتة" : "Automation"}</h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          {rtl ? "قاعدة جديدة" : "New rule"}
        </Button>
      </div>

      {rulesQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : rulesQuery.isError ? (
        <EmptyState
          icon={Workflow}
          message={(rulesQuery.error as Error)?.message ?? "Failed to load rules."}
        />
      ) : rules.length === 0 ? (
        <EmptyState icon={Workflow} message={rtl ? "لا توجد قواعد بعد." : "No automation rules yet."} />
      ) : (
        <div className="space-y-2">
          {rules.map((rule: AutomationRuleRow) => (
            <Card key={rule.id}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{rule.name}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {rule.triggerEvent}
                  </div>
                </div>
                <ToggleSwitch
                  checked={rule.enabled ?? false}
                  onCheckedChange={(enabled) =>
                    toggleRule.mutate({ id: rule.id, enabled })
                  }
                  disabled={toggleRule.isPending}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{rtl ? "قاعدة جديدة" : "New automation rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">{rtl ? "الاسم" : "Name"}</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-trigger">{rtl ? "الحدث المُشغّل" : "Trigger event"}</Label>
              <Input
                id="rule-trigger"
                value={triggerEvent}
                onChange={(e) => setTriggerEvent(e.target.value)}
                placeholder="invoice.created"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createRule.isPending}
            >
              {rtl ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={() => createRule.mutate()}
              disabled={!name.trim() || !triggerEvent.trim() || createRule.isPending}
            >
              {createRule.isPending
                ? rtl ? "جارٍ…" : "Creating…"
                : rtl ? "إنشاء" : "Create rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
