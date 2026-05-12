/**
 * Business RBAC service: per-user role + permission set scoped to a company.
 *
 * Storage layout — a single row per (company, user) in `businessEntities`
 * with `moduleKey="rbac"`, `entityType="user_role"`, `code=userId`. The
 * data column holds the resolved `PermissionSet`.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import {
  ROLE_PRESETS,
  getRolePreset,
  clonePermissionSet,
  type BusinessRole,
  type PermissionSet,
  type ModulePermissions,
} from "@paperclipai/shared";
import type { AuditAction } from "./business-audit-service.js";

const RBAC_MODULE_KEY = "rbac";
const RBAC_ENTITY_TYPE = "user_role";

export interface UserBusinessRole {
  companyId: string;
  userId: string;
  role: BusinessRole;
  permissions: PermissionSet;
  grantedAt: string;
  grantedBy?: string;
}

export interface PermissionCheckTarget {
  moduleKey?: string;
  entityType?: string;
  fields?: string[];
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface BusinessRbacService {
  getUserRole(
    companyId: string,
    userId: string,
  ): Promise<UserBusinessRole | null>;
  setUserRole(
    companyId: string,
    userId: string,
    role: BusinessRole,
    customPermissions?: PermissionSet,
    grantedBy?: string,
  ): Promise<UserBusinessRole>;
  listUsersByCompany(companyId: string): Promise<UserBusinessRole[]>;
  canPerform(
    companyId: string,
    userId: string,
    action: AuditAction,
    target?: PermissionCheckTarget,
  ): Promise<PermissionCheckResult>;
  removeUserRole(companyId: string, userId: string): Promise<void>;
  /** Computed permission set: stored row else admin fallback. */
  resolvePermissions(
    companyId: string,
    userId: string,
  ): Promise<PermissionSet>;
}

function defaultGrantedAt(): string {
  return new Date().toISOString();
}

function rowToUserRole(row: {
  companyId: string;
  code: string | null;
  data: Record<string, unknown>;
  createdAt: Date | string;
  ownerUserId: string | null;
  status: string;
}): UserBusinessRole {
  const data = (row.data ?? {}) as {
    role?: BusinessRole;
    permissions?: PermissionSet;
    grantedAt?: string;
    grantedBy?: string;
  };
  const ts =
    typeof row.createdAt === "string"
      ? row.createdAt
      : row.createdAt.toISOString();
  const role = (data.role ?? (row.status as BusinessRole)) || "viewer";
  return {
    companyId: row.companyId,
    userId: row.code ?? "",
    role,
    permissions:
      data.permissions ?? clonePermissionSet(getRolePreset(role)),
    grantedAt: data.grantedAt ?? ts,
    grantedBy: data.grantedBy,
  };
}

export function createBusinessRbacService(db: Db): BusinessRbacService {
  async function findRow(companyId: string, userId: string) {
    const rows = await db
      .select({
        companyId: businessEntities.companyId,
        code: businessEntities.code,
        data: businessEntities.data,
        createdAt: businessEntities.createdAt,
        ownerUserId: businessEntities.ownerUserId,
        status: businessEntities.status,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, RBAC_MODULE_KEY),
          eq(businessEntities.entityType, RBAC_ENTITY_TYPE),
          eq(businessEntities.code, userId),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return rowToUserRole({
      ...r,
      data: (r.data ?? {}) as Record<string, unknown>,
    });
  }

  async function listRows(companyId: string): Promise<UserBusinessRole[]> {
    const rows = await db
      .select({
        companyId: businessEntities.companyId,
        code: businessEntities.code,
        data: businessEntities.data,
        createdAt: businessEntities.createdAt,
        ownerUserId: businessEntities.ownerUserId,
        status: businessEntities.status,
      })
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, RBAC_MODULE_KEY),
          eq(businessEntities.entityType, RBAC_ENTITY_TYPE),
        ),
      );
    return rows.map((r) =>
      rowToUserRole({
        ...r,
        data: (r.data ?? {}) as Record<string, unknown>,
      }),
    );
  }

  async function resolvePerms(
    companyId: string,
    userId: string,
  ): Promise<PermissionSet> {
    const row = await findRow(companyId, userId);
    if (row) return row.permissions;
    // Fallback: admin permissions. The existing CompanyAccess system already
    // gates whether this user reaches us at all; if they do and have no RBAC
    // row we treat them as a full admin until a manager assigns them a role.
    return clonePermissionSet(ROLE_PRESETS.admin);
  }

  function modulePermsAllow(
    perms: ModulePermissions | undefined,
    action: AuditAction,
    fields?: string[],
  ): PermissionCheckResult {
    if (!perms) {
      return { allowed: false, reason: "Module not granted to this user" };
    }
    let allowed = false;
    switch (action) {
      case "view":
        allowed = perms.view;
        break;
      case "create":
        allowed = perms.create;
        break;
      case "update":
        allowed = perms.update;
        break;
      case "delete":
        allowed = perms.delete;
        break;
      case "export":
        allowed = perms.exportData;
        break;
      default:
        // Non-CRUD actions fall through to allowed; system-level checks live
        // in PermissionSet flags handled in `canPerform`.
        allowed = true;
    }
    if (!allowed) {
      return {
        allowed: false,
        reason: `Action "${action}" not permitted for this module`,
      };
    }
    if (fields && perms.fieldRestrictions) {
      const allow = perms.fieldRestrictions.allowedFields;
      const deny = perms.fieldRestrictions.deniedFields ?? [];
      for (const f of fields) {
        if (deny.includes(f)) {
          return { allowed: false, reason: `Field "${f}" is denied` };
        }
        if (allow && allow.length > 0 && !allow.includes(f)) {
          return {
            allowed: false,
            reason: `Field "${f}" is not in the allowed whitelist`,
          };
        }
      }
    }
    return { allowed: true };
  }

  return {
    resolvePermissions: resolvePerms,

    async getUserRole(companyId, userId) {
      return findRow(companyId, userId);
    },

    async setUserRole(companyId, userId, role, customPermissions, grantedBy) {
      const preset = getRolePreset(role);
      const permissions = customPermissions ?? clonePermissionSet(preset);
      const grantedAt = defaultGrantedAt();
      const now = new Date();
      const data = {
        role,
        permissions,
        grantedAt,
        grantedBy,
      };

      // The `business_entities` table has no unique index on
      // (companyId, moduleKey, entityType, code), so we explicitly delete
      // any existing row before inserting a fresh one.
      await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, RBAC_MODULE_KEY),
            eq(businessEntities.entityType, RBAC_ENTITY_TYPE),
            eq(businessEntities.code, userId),
          ),
        );
      await db.insert(businessEntities).values({
        companyId,
        moduleKey: RBAC_MODULE_KEY,
        entityType: RBAC_ENTITY_TYPE,
        code: userId,
        name: userId,
        status: role,
        ownerUserId: userId,
        data: data as Record<string, unknown>,
        tags: [`role:${role}`],
        createdByUserId: grantedBy ?? null,
        updatedByUserId: grantedBy ?? null,
        createdAt: now,
        updatedAt: now,
      });

      return {
        companyId,
        userId,
        role,
        permissions,
        grantedAt,
        grantedBy,
      };
    },

    async listUsersByCompany(companyId) {
      return listRows(companyId);
    },

    async canPerform(companyId, userId, action, target) {
      const perms = await resolvePerms(companyId, userId);

      // System-level actions (no moduleKey) use the top-level flags.
      if (action === "role_change" || action === "permission_change") {
        if (!perms.manageRoles) {
          return {
            allowed: false,
            reason: "User lacks manageRoles permission",
          };
        }
        return { allowed: true };
      }
      if (action === "export" && !target?.moduleKey) {
        if (!perms.exportData) {
          return { allowed: false, reason: "User lacks exportData permission" };
        }
        return { allowed: true };
      }
      if (action === "login" || action === "logout") {
        return { allowed: true };
      }

      if (target?.moduleKey) {
        return modulePermsAllow(
          perms.modules[target.moduleKey],
          action,
          target.fields,
        );
      }

      // Default: allow. The actual route still enforces assertCompanyAccess.
      return { allowed: true };
    },

    async removeUserRole(companyId, userId) {
      await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.companyId, companyId),
            eq(businessEntities.moduleKey, RBAC_MODULE_KEY),
            eq(businessEntities.entityType, RBAC_ENTITY_TYPE),
            eq(businessEntities.code, userId),
          ),
        );
    },
  };
}
