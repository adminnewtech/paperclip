import { describe, expect, it } from "vitest";
import {
  BUSINESS_MODULE_KEYS_FOR_PERMS,
  BUSINESS_ROLES,
  clonePermissionSet,
  getRolePreset,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PRESETS,
  type BusinessRole,
} from "../business-permissions.js";

describe("business-permissions: role registry", () => {
  it("BUSINESS_ROLES lists every role exactly once", () => {
    expect(new Set(BUSINESS_ROLES).size).toBe(BUSINESS_ROLES.length);
    for (const r of BUSINESS_ROLES) {
      expect(ROLE_PRESETS[r]).toBeDefined();
      expect(ROLE_LABELS[r]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[r]).toBeTruthy();
    }
  });

  it("every preset has an entry for every business module", () => {
    for (const role of BUSINESS_ROLES) {
      const preset = ROLE_PRESETS[role];
      for (const mod of BUSINESS_MODULE_KEYS_FOR_PERMS) {
        expect(preset.modules[mod]).toBeDefined();
        const m = preset.modules[mod]!;
        expect(typeof m.view).toBe("boolean");
        expect(typeof m.create).toBe("boolean");
        expect(typeof m.update).toBe("boolean");
        expect(typeof m.delete).toBe("boolean");
      }
    }
  });
});

describe("business-permissions: admin preset", () => {
  const admin = getRolePreset("admin");

  it("has every permission flag enabled", () => {
    expect(admin.manageRoles).toBe(true);
    expect(admin.manageSettings).toBe(true);
    expect(admin.viewAuditLog).toBe(true);
    expect(admin.exportData).toBe(true);
    expect(admin.manageAgents).toBe(true);
    expect(admin.managePayments).toBe(true);
  });

  it("allows full CRUD on every module", () => {
    for (const mod of BUSINESS_MODULE_KEYS_FOR_PERMS) {
      const m = admin.modules[mod]!;
      expect(m.view).toBe(true);
      expect(m.create).toBe(true);
      expect(m.update).toBe(true);
      expect(m.delete).toBe(true);
      expect(m.exportData).toBe(true);
    }
  });
});

describe("business-permissions: manager preset", () => {
  const manager = getRolePreset("manager");
  it("has CRUD but cannot manage roles or instance settings", () => {
    expect(manager.manageRoles).toBe(false);
    expect(manager.manageSettings).toBe(false);
    expect(manager.viewAuditLog).toBe(true);
    for (const mod of BUSINESS_MODULE_KEYS_FOR_PERMS) {
      expect(manager.modules[mod]!.create).toBe(true);
      expect(manager.modules[mod]!.delete).toBe(true);
    }
  });
});

describe("business-permissions: viewer preset", () => {
  const viewer = getRolePreset("viewer");
  it("can view everywhere but never create/update/delete", () => {
    for (const mod of BUSINESS_MODULE_KEYS_FOR_PERMS) {
      const m = viewer.modules[mod]!;
      expect(m.view).toBe(true);
      expect(m.create).toBe(false);
      expect(m.update).toBe(false);
      expect(m.delete).toBe(false);
    }
    expect(viewer.manageRoles).toBe(false);
    expect(viewer.managePayments).toBe(false);
    expect(viewer.manageAgents).toBe(false);
  });
});

describe("business-permissions: accountant preset", () => {
  const accountant = getRolePreset("accountant");
  it("has full CRUD on finance and sales", () => {
    expect(accountant.modules.finance!.create).toBe(true);
    expect(accountant.modules.finance!.delete).toBe(true);
    expect(accountant.modules.sales!.create).toBe(true);
    expect(accountant.modules.sales!.delete).toBe(true);
  });

  it("can create/update other modules but cannot delete", () => {
    for (const mod of BUSINESS_MODULE_KEYS_FOR_PERMS) {
      if (mod === "finance" || mod === "sales") continue;
      const m = accountant.modules[mod]!;
      expect(m.view).toBe(true);
      expect(m.create).toBe(true);
      expect(m.update).toBe(true);
      expect(m.delete).toBe(false);
    }
  });

  it("can manage payments", () => {
    expect(accountant.managePayments).toBe(true);
    expect(accountant.manageAgents).toBe(false);
  });
});

describe("business-permissions: salesperson preset", () => {
  const sales = getRolePreset("salesperson");
  it("has full CRUD on crm + sales", () => {
    expect(sales.modules.crm!.create).toBe(true);
    expect(sales.modules.sales!.create).toBe(true);
  });
  it("cannot access finance at all", () => {
    expect(sales.modules.finance!.view).toBe(false);
    expect(sales.modules.finance!.create).toBe(false);
  });
  it("is view-only on inventory", () => {
    expect(sales.modules.inventory!.view).toBe(true);
    expect(sales.modules.inventory!.create).toBe(false);
  });
});

describe("business-permissions: support preset", () => {
  const support = getRolePreset("support");
  it("has full CRUD on helpdesk and view-only on CRM", () => {
    expect(support.modules.helpdesk!.create).toBe(true);
    expect(support.modules.crm!.view).toBe(true);
    expect(support.modules.crm!.create).toBe(false);
  });
  it("cannot see finance or sales", () => {
    expect(support.modules.finance!.view).toBe(false);
    expect(support.modules.sales!.view).toBe(false);
  });
});

describe("business-permissions: custom preset", () => {
  const custom = getRolePreset("custom");
  it("is empty by default", () => {
    for (const mod of BUSINESS_MODULE_KEYS_FOR_PERMS) {
      const m = custom.modules[mod]!;
      expect(m.view).toBe(false);
      expect(m.create).toBe(false);
      expect(m.update).toBe(false);
      expect(m.delete).toBe(false);
    }
  });
});

describe("business-permissions: clonePermissionSet", () => {
  it("returns a deep copy whose modules can be mutated independently", () => {
    const original = getRolePreset("admin");
    const clone = clonePermissionSet(original);
    clone.modules.finance!.create = false;
    expect(original.modules.finance!.create).toBe(true);
  });

  it("clones fieldRestrictions arrays so mutation does not leak", () => {
    const base = clonePermissionSet(getRolePreset("viewer"));
    base.modules.finance = {
      view: true,
      create: false,
      update: false,
      delete: false,
      exportData: false,
      fieldRestrictions: { allowedFields: ["a", "b"], deniedFields: ["c"] },
    };
    const c = clonePermissionSet(base);
    c.modules.finance!.fieldRestrictions!.allowedFields!.push("x");
    expect(base.modules.finance!.fieldRestrictions!.allowedFields).toEqual([
      "a",
      "b",
    ]);
  });

  it("clones every role preset without throwing", () => {
    for (const r of BUSINESS_ROLES) {
      const role = r as BusinessRole;
      const clone = clonePermissionSet(getRolePreset(role));
      expect(clone).toBeDefined();
      expect(clone.modules).not.toBe(getRolePreset(role).modules);
    }
  });
});
