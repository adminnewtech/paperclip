/**
 * Opt-in fine-grained permission middleware for business routes.
 *
 * The existing `assertCompanyAccess` remains the primary gate that decides
 * whether a request can touch a company at all. `requirePermission`
 * additionally enforces the RBAC permission set for high-value actions
 * (delete, export, role changes, settings).
 *
 * Apply selectively — do NOT mount globally, or existing flows will break.
 */

import type { Request, RequestHandler } from "express";
import { forbidden, unauthorized } from "../errors.js";
import type {
  AuditAction,
  BusinessAuditService,
} from "../services/business-audit-service.js";
import type {
  BusinessRbacService,
} from "../services/business-rbac-service.js";

export interface RequirePermissionOptions {
  action: AuditAction;
  /** Resolves the moduleKey from the request (params, body, etc.). */
  moduleKey?: (req: Request) => string | undefined;
  /** Resolves the entityType from the request. */
  entityType?: (req: Request) => string | undefined;
  /** Resolves a companyId; defaults to `req.params.companyId`. */
  companyId?: (req: Request) => string | undefined;
  /** Optional audit hook fired on denials. */
  auditService?: BusinessAuditService;
}

export function requirePermission(
  service: BusinessRbacService,
  options: RequirePermissionOptions,
): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (req.actor.type === "none") {
        throw unauthorized();
      }
      // Agents bypass user-RBAC — they were minted with a company-scoped key
      // that the existing auth layer already gated.
      if (req.actor.type === "agent") {
        next();
        return;
      }
      // Instance admins (local board, instance_admin role) skip RBAC.
      if (req.actor.type === "board" && req.actor.source === "local_implicit") {
        next();
        return;
      }
      if (req.actor.type === "board" && req.actor.isInstanceAdmin) {
        next();
        return;
      }

      const userId = req.actor.type === "board" ? req.actor.userId : undefined;
      if (!userId) {
        throw unauthorized();
      }

      const companyId =
        options.companyId?.(req) ?? (req.params.companyId as string | undefined);
      if (!companyId) {
        throw forbidden("Missing companyId for RBAC check");
      }

      const moduleKey = options.moduleKey?.(req);
      const entityType = options.entityType?.(req);

      const result = await service.canPerform(companyId, userId, options.action, {
        moduleKey,
        entityType,
      });
      if (!result.allowed) {
        // Best-effort audit on denial.
        if (options.auditService) {
          options.auditService
            .log({
              companyId,
              actorUserId: userId,
              actorType: "user",
              action: options.action,
              targetType: "permission",
              moduleKey,
              entityType,
              ipAddress: req.ip,
              userAgent: req.get("user-agent"),
              metadata: { denied: true, reason: result.reason },
            })
            .catch(() => undefined);
        }
        throw forbidden(result.reason ?? "Permission denied");
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Guard that only allows admins (manageRoles=true) or instance admins.
 */
export function requireRbacAdmin(
  service: BusinessRbacService,
): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (req.actor.type === "none") throw unauthorized();
      if (req.actor.type === "board" && req.actor.source === "local_implicit") {
        next();
        return;
      }
      if (req.actor.type === "board" && req.actor.isInstanceAdmin) {
        next();
        return;
      }
      if (req.actor.type !== "board" || !req.actor.userId) {
        throw forbidden("Admin access required");
      }
      const companyId = req.params.companyId as string | undefined;
      if (!companyId) throw forbidden("Missing companyId");
      const perms = await service.resolvePermissions(companyId, req.actor.userId);
      if (!perms.manageRoles) {
        throw forbidden("Admin role required to manage RBAC");
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Guard that requires audit-log viewing permission.
 */
export function requireAuditViewer(
  service: BusinessRbacService,
): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (req.actor.type === "none") throw unauthorized();
      if (req.actor.type === "board" && req.actor.source === "local_implicit") {
        next();
        return;
      }
      if (req.actor.type === "board" && req.actor.isInstanceAdmin) {
        next();
        return;
      }
      if (req.actor.type !== "board" || !req.actor.userId) {
        throw forbidden("Board access required");
      }
      const companyId = req.params.companyId as string | undefined;
      if (!companyId) throw forbidden("Missing companyId");
      const perms = await service.resolvePermissions(companyId, req.actor.userId);
      if (!perms.viewAuditLog) {
        throw forbidden("Permission to view audit log is required");
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
