import type {
  BusinessRole,
  PermissionSet,
} from "@paperclipai/shared";
import { api } from "./client";

export interface UserBusinessRoleRow {
  companyId: string;
  userId: string;
  role: BusinessRole;
  permissions: PermissionSet;
  grantedAt: string;
  grantedBy?: string;
}

export interface RolePreset {
  role: BusinessRole;
  label: string;
  description: string;
  permissions: PermissionSet;
}

export interface MePermissionsResponse {
  userId: string | null;
  role: BusinessRole | null;
  permissions: PermissionSet;
  fallback: boolean;
}

export const businessRbacApi = {
  listRoles: (companyId: string) =>
    api.get<{ roles: RolePreset[] }>(
      `/companies/${companyId}/business/rbac/roles`,
    ),

  listUsers: (companyId: string) =>
    api.get<{ users: UserBusinessRoleRow[] }>(
      `/companies/${companyId}/business/rbac/users`,
    ),

  me: (companyId: string) =>
    api.get<MePermissionsResponse>(`/companies/${companyId}/business/rbac/me`),

  setRole: (
    companyId: string,
    userId: string,
    body: { role: BusinessRole; customPermissions?: PermissionSet },
  ) =>
    api.put<UserBusinessRoleRow>(
      `/companies/${companyId}/business/rbac/users/${userId}`,
      body,
    ),

  removeRole: (companyId: string, userId: string) =>
    api.delete<void>(
      `/companies/${companyId}/business/rbac/users/${userId}`,
    ),
};
