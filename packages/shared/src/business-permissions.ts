/**
 * Business RBAC: role presets and permission set shape.
 *
 * Permissions live alongside the existing CompanyAccess system; they refine
 * who can do what *within* the business module. The existing
 * `assertCompanyAccess` remains the primary gate — RBAC is additional
 * fine-grained control applied selectively to high-value routes.
 */

import type { BusinessModuleKey } from "./business-modules.js";

export type BusinessRole =
  | "admin"
  | "manager"
  | "accountant"
  | "salesperson"
  | "support"
  | "viewer"
  | "custom";

export const BUSINESS_ROLES: BusinessRole[] = [
  "admin",
  "manager",
  "accountant",
  "salesperson",
  "support",
  "viewer",
  "custom",
];

export interface ModulePermissions {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  exportData: boolean;
  /** Field-level overrides (empty = all allowed). */
  fieldRestrictions?: { allowedFields?: string[]; deniedFields?: string[] };
}

export interface PermissionSet {
  /** Per module: can the user view/create/update/delete entities? */
  modules: Record<string, ModulePermissions>;
  manageRoles: boolean;
  manageSettings: boolean;
  viewAuditLog: boolean;
  exportData: boolean;
  manageAgents: boolean;
  managePayments: boolean;
}

export const BUSINESS_MODULE_KEYS_FOR_PERMS: BusinessModuleKey[] = [
  "crm",
  "sales",
  "inventory",
  "finance",
  "hr",
  "helpdesk",
  "marketing",
  "ecommerce",
  "projects",
  "analytics",
  "documents",
];

function fullModule(): ModulePermissions {
  return {
    view: true,
    create: true,
    update: true,
    delete: true,
    exportData: true,
  };
}

function viewOnlyModule(): ModulePermissions {
  return {
    view: true,
    create: false,
    update: false,
    delete: false,
    exportData: false,
  };
}

function crudNoDelete(): ModulePermissions {
  return {
    view: true,
    create: true,
    update: true,
    delete: false,
    exportData: true,
  };
}

function noneModule(): ModulePermissions {
  return {
    view: false,
    create: false,
    update: false,
    delete: false,
    exportData: false,
  };
}

function buildModuleMap(
  fn: (key: BusinessModuleKey) => ModulePermissions,
): Record<string, ModulePermissions> {
  const out: Record<string, ModulePermissions> = {};
  for (const k of BUSINESS_MODULE_KEYS_FOR_PERMS) {
    out[k] = fn(k);
  }
  return out;
}

const ADMIN: PermissionSet = {
  modules: buildModuleMap(() => fullModule()),
  manageRoles: true,
  manageSettings: true,
  viewAuditLog: true,
  exportData: true,
  manageAgents: true,
  managePayments: true,
};

const MANAGER: PermissionSet = {
  modules: buildModuleMap(() => fullModule()),
  manageRoles: false,
  manageSettings: false,
  viewAuditLog: true,
  exportData: true,
  manageAgents: true,
  managePayments: true,
};

const ACCOUNTANT: PermissionSet = {
  modules: buildModuleMap((k) => {
    if (k === "finance" || k === "sales") return fullModule();
    return crudNoDelete();
  }),
  manageRoles: false,
  manageSettings: false,
  viewAuditLog: true,
  exportData: true,
  manageAgents: false,
  managePayments: true,
};

const SALESPERSON: PermissionSet = {
  modules: buildModuleMap((k) => {
    if (k === "crm" || k === "sales") return fullModule();
    if (k === "inventory") return viewOnlyModule();
    if (k === "finance") return noneModule();
    return viewOnlyModule();
  }),
  manageRoles: false,
  manageSettings: false,
  viewAuditLog: false,
  exportData: false,
  manageAgents: false,
  managePayments: false,
};

const SUPPORT: PermissionSet = {
  modules: buildModuleMap((k) => {
    if (k === "helpdesk") return fullModule();
    if (k === "crm") return viewOnlyModule();
    if (k === "finance" || k === "sales") return noneModule();
    return viewOnlyModule();
  }),
  manageRoles: false,
  manageSettings: false,
  viewAuditLog: false,
  exportData: false,
  manageAgents: false,
  managePayments: false,
};

const VIEWER: PermissionSet = {
  modules: buildModuleMap(() => viewOnlyModule()),
  manageRoles: false,
  manageSettings: false,
  viewAuditLog: false,
  exportData: false,
  manageAgents: false,
  managePayments: false,
};

const CUSTOM: PermissionSet = {
  modules: buildModuleMap(() => noneModule()),
  manageRoles: false,
  manageSettings: false,
  viewAuditLog: false,
  exportData: false,
  manageAgents: false,
  managePayments: false,
};

export const ROLE_PRESETS: Record<BusinessRole, PermissionSet> = {
  admin: ADMIN,
  manager: MANAGER,
  accountant: ACCOUNTANT,
  salesperson: SALESPERSON,
  support: SUPPORT,
  viewer: VIEWER,
  custom: CUSTOM,
};

export const ROLE_LABELS: Record<BusinessRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  accountant: "Accountant",
  salesperson: "Salesperson",
  support: "Support",
  viewer: "Viewer",
  custom: "Custom",
};

export const ROLE_DESCRIPTIONS: Record<BusinessRole, string> = {
  admin: "Full access. Manage users, roles, settings, all modules.",
  manager: "Full CRUD on every module. Cannot manage roles or instance settings.",
  accountant: "Finance and Sales: full CRUD. Other modules: read/create/update only.",
  salesperson: "CRM and Sales: full CRUD. Inventory: read-only. No finance access.",
  support: "Helpdesk: full CRUD. CRM: read-only. No finance or sales.",
  viewer: "Read-only across every module.",
  custom: "Empty by default — configure each module manually.",
};

export function getRolePreset(role: BusinessRole): PermissionSet {
  return ROLE_PRESETS[role];
}

/**
 * Returns a deep copy of a role preset so callers can safely mutate without
 * leaking back into the shared constant.
 */
export function clonePermissionSet(set: PermissionSet): PermissionSet {
  const modules: Record<string, ModulePermissions> = {};
  for (const [k, v] of Object.entries(set.modules)) {
    modules[k] = {
      ...v,
      fieldRestrictions: v.fieldRestrictions
        ? {
            allowedFields: v.fieldRestrictions.allowedFields
              ? [...v.fieldRestrictions.allowedFields]
              : undefined,
            deniedFields: v.fieldRestrictions.deniedFields
              ? [...v.fieldRestrictions.deniedFields]
              : undefined,
          }
        : undefined,
    };
  }
  return {
    modules,
    manageRoles: set.manageRoles,
    manageSettings: set.manageSettings,
    viewAuditLog: set.viewAuditLog,
    exportData: set.exportData,
    manageAgents: set.manageAgents,
    managePayments: set.managePayments,
  };
}
