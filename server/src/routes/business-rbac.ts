import { Router } from "express";
import { z } from "zod";
import {
  BUSINESS_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PRESETS,
  type BusinessRole,
  type PermissionSet,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import {
  requireRbacAdmin,
} from "../middleware/business-rbac-guard.js";
import type { BusinessRbacService } from "../services/business-rbac-service.js";
import type { BusinessAuditService } from "../services/business-audit-service.js";

const modulePermissionsSchema = z.object({
  view: z.boolean(),
  create: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
  exportData: z.boolean(),
  fieldRestrictions: z
    .object({
      allowedFields: z.array(z.string()).optional(),
      deniedFields: z.array(z.string()).optional(),
    })
    .optional(),
});

const permissionSetSchema = z.object({
  modules: z.record(z.string(), modulePermissionsSchema),
  manageRoles: z.boolean(),
  manageSettings: z.boolean(),
  viewAuditLog: z.boolean(),
  exportData: z.boolean(),
  manageAgents: z.boolean(),
  managePayments: z.boolean(),
});

const setRoleSchema = z.object({
  role: z.enum(BUSINESS_ROLES as [BusinessRole, ...BusinessRole[]]),
  customPermissions: permissionSetSchema.optional(),
});

export function businessRbacRoutes(
  rbacService: BusinessRbacService,
  auditService: BusinessAuditService,
) {
  const router = Router();
  const adminGuard = requireRbacAdmin(rbacService);

  // Static preset list — does not need RBAC.
  router.get(
    "/companies/:companyId/business/rbac/roles",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.json({
        roles: BUSINESS_ROLES.map((r) => ({
          role: r,
          label: ROLE_LABELS[r],
          description: ROLE_DESCRIPTIONS[r],
          permissions: ROLE_PRESETS[r] as PermissionSet,
        })),
      });
    },
  );

  // Current user's permissions — every user can ask about themselves.
  router.get(
    "/companies/:companyId/business/rbac/me",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const userId =
        req.actor.type === "board" ? (req.actor.userId ?? null) : null;
      if (!userId) {
        // Agents and unauthenticated requests don't have a UserBusinessRole;
        // return null but include admin permissions so the UI degrades fine.
        res.json({
          userId: null,
          role: null,
          permissions: ROLE_PRESETS.admin,
          fallback: true,
        });
        return;
      }
      const existing = await rbacService.getUserRole(companyId, userId);
      if (existing) {
        res.json({
          userId,
          role: existing.role,
          permissions: existing.permissions,
          fallback: false,
        });
        return;
      }
      // Fallback: admin permissions (consistent with the service).
      res.json({
        userId,
        role: null,
        permissions: ROLE_PRESETS.admin,
        fallback: true,
      });
    },
  );

  router.get(
    "/companies/:companyId/business/rbac/users",
    adminGuard,
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const users = await rbacService.listUsersByCompany(companyId);
      res.json({ users });
    },
  );

  router.put(
    "/companies/:companyId/business/rbac/users/:userId",
    adminGuard,
    validate(setRoleSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const userId = req.params.userId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof setRoleSchema>;
      const grantedBy =
        req.actor.type === "board" ? req.actor.userId : undefined;
      const before = await rbacService.getUserRole(companyId, userId);
      const row = await rbacService.setUserRole(
        companyId,
        userId,
        body.role,
        body.customPermissions,
        grantedBy,
      );
      auditService
        .log({
          companyId,
          actorUserId: grantedBy,
          actorType: "user",
          action: "role_change",
          targetType: "role",
          targetId: userId,
          targetCode: userId,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          diff: {
            before: before
              ? { role: before.role, permissions: before.permissions }
              : undefined,
            after: { role: row.role, permissions: row.permissions },
            changedFields: ["role", "permissions"],
          },
        })
        .catch(() => undefined);
      res.json(row);
    },
  );

  router.delete(
    "/companies/:companyId/business/rbac/users/:userId",
    adminGuard,
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const userId = req.params.userId as string;
      assertCompanyAccess(req, companyId);
      const grantedBy =
        req.actor.type === "board" ? req.actor.userId : undefined;
      const before = await rbacService.getUserRole(companyId, userId);
      await rbacService.removeUserRole(companyId, userId);
      auditService
        .log({
          companyId,
          actorUserId: grantedBy,
          actorType: "user",
          action: "role_change",
          targetType: "role",
          targetId: userId,
          targetCode: userId,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          diff: {
            before: before
              ? { role: before.role, permissions: before.permissions }
              : undefined,
            after: undefined,
            changedFields: ["role"],
          },
          metadata: { removed: true },
        })
        .catch(() => undefined);
      res.status(204).end();
    },
  );

  return router;
}
