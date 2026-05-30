import { api } from "./client";

export interface OrgSettingsRow {
  id: string;
  companyId: string;
  legalName: string | null;
  logoUrl: string | null;
  address: string | null;
  taxId: string | null;
  crNumber: string | null;
  defaultCurrency: string | null;
  fiscalYearStartMonth: number | null;
  locale: string | null;
  rtl: boolean | null;
  branding: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgSettingsInput {
  legalName?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  taxId?: string | null;
  crNumber?: string | null;
  defaultCurrency?: string;
  fiscalYearStartMonth?: number;
  locale?: string;
  rtl?: boolean;
  branding?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface RoleRow {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  permissions: Record<string, unknown> | null;
  isSystem: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleInput {
  name: string;
  description?: string | null;
  permissions?: Record<string, unknown>;
  isSystem?: boolean;
}

export interface TaxRateRow {
  id: string;
  companyId: string;
  name: string;
  rateBps: number;
  isDefault: boolean | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaxRateInput {
  name: string;
  rateBps: number;
  isDefault?: boolean;
  country?: string | null;
}

export interface CurrencyRateRow {
  id: string;
  companyId: string;
  code: string;
  rateToBase: string;
  asOf: string;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyRateInput {
  code: string;
  rateToBase: number;
  asOf?: string;
}

export interface AutomationRuleRow {
  id: string;
  companyId: string;
  name: string;
  triggerEvent: string;
  conditions: unknown[] | null;
  actions: unknown[] | null;
  enabled: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRuleInput {
  name: string;
  triggerEvent: string;
  conditions?: unknown[];
  actions?: unknown[];
  enabled?: boolean;
}

export const settingsApi = {
  // Organization
  getOrg: (companyId: string) =>
    api.get<{ orgSettings: OrgSettingsRow | null }>(
      `/companies/${companyId}/settings/org`,
    ),
  updateOrg: (companyId: string, body: OrgSettingsInput) =>
    api.put<OrgSettingsRow>(`/companies/${companyId}/settings/org`, body),

  // Roles
  listRoles: (companyId: string) =>
    api.get<{ roles: RoleRow[] }>(`/companies/${companyId}/settings/roles`),
  createRole: (companyId: string, body: RoleInput) =>
    api.post<RoleRow>(`/companies/${companyId}/settings/roles`, body),
  updateRole: (companyId: string, roleId: string, body: Partial<RoleInput>) =>
    api.put<RoleRow>(`/companies/${companyId}/settings/roles/${roleId}`, body),
  deleteRole: (companyId: string, roleId: string) =>
    api.delete<void>(`/companies/${companyId}/settings/roles/${roleId}`),

  // Tax rates
  listTaxRates: (companyId: string) =>
    api.get<{ taxRates: TaxRateRow[] }>(
      `/companies/${companyId}/settings/tax-rates`,
    ),
  createTaxRate: (companyId: string, body: TaxRateInput) =>
    api.post<TaxRateRow>(`/companies/${companyId}/settings/tax-rates`, body),

  // Currency rates
  listCurrencyRates: (companyId: string) =>
    api.get<{ currencyRates: CurrencyRateRow[] }>(
      `/companies/${companyId}/settings/currency-rates`,
    ),
  createCurrencyRate: (companyId: string, body: CurrencyRateInput) =>
    api.post<CurrencyRateRow>(
      `/companies/${companyId}/settings/currency-rates`,
      body,
    ),

  // Automation rules
  listAutomationRules: (companyId: string) =>
    api.get<{ automationRules: AutomationRuleRow[] }>(
      `/companies/${companyId}/settings/automation-rules`,
    ),
  createAutomationRule: (companyId: string, body: AutomationRuleInput) =>
    api.post<AutomationRuleRow>(
      `/companies/${companyId}/settings/automation-rules`,
      body,
    ),
  updateAutomationRule: (
    companyId: string,
    ruleId: string,
    body: Partial<AutomationRuleInput>,
  ) =>
    api.put<AutomationRuleRow>(
      `/companies/${companyId}/settings/automation-rules/${ruleId}`,
      body,
    ),
};
