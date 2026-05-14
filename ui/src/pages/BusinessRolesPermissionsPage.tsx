import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  UserCog,
  Plus,
  Trash2,
  Save,
  Users,
} from "lucide-react";
import {
  BUSINESS_MODULE_KEYS_FOR_PERMS,
  BUSINESS_ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_PRESETS,
  clonePermissionSet,
  type BusinessRole,
  type PermissionSet,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  businessRbacApi,
  type UserBusinessRoleRow,
} from "../api/business-rbac";

export function BusinessRolesPermissionsPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState<BusinessRole>("viewer");
  const [draftPerms, setDraftPerms] = useState<PermissionSet | null>(null);
  const [newUserId, setNewUserId] = useState<string>("");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Roles & Permissions" },
    ]);
  }, [setBreadcrumbs]);

  const usersQuery = useQuery({
    queryKey: ["business-rbac-users", selectedCompanyId],
    queryFn: () => businessRbacApi.listUsers(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const rolesQuery = useQuery({
    queryKey: ["business-rbac-roles", selectedCompanyId],
    queryFn: () => businessRbacApi.listRoles(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const setRoleMutation = useMutation({
    mutationFn: (input: {
      userId: string;
      role: BusinessRole;
      customPermissions?: PermissionSet;
    }) =>
      businessRbacApi.setRole(selectedCompanyId!, input.userId, {
        role: input.role,
        customPermissions: input.customPermissions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["business-rbac-users", selectedCompanyId],
      });
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: (userId: string) =>
      businessRbacApi.removeRole(selectedCompanyId!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["business-rbac-users", selectedCompanyId],
      });
    },
  });

  const users: UserBusinessRoleRow[] = usersQuery.data?.users ?? [];

  function startEdit(user: UserBusinessRoleRow) {
    setEditingUserId(user.userId);
    setDraftRole(user.role);
    setDraftPerms(clonePermissionSet(user.permissions));
  }

  function startNewUser() {
    if (!newUserId.trim()) return;
    setEditingUserId(newUserId.trim());
    setDraftRole("viewer");
    setDraftPerms(clonePermissionSet(ROLE_PRESETS.viewer));
  }

  function applyPreset(role: BusinessRole) {
    setDraftRole(role);
    setDraftPerms(clonePermissionSet(ROLE_PRESETS[role]));
  }

  function toggleModulePerm(
    moduleKey: string,
    field: keyof PermissionSet["modules"][string],
    value: boolean,
  ) {
    if (!draftPerms) return;
    const next = clonePermissionSet(draftPerms);
    const m = next.modules[moduleKey];
    if (!m) return;
    if (field === "fieldRestrictions") return;
    (m as unknown as Record<string, unknown>)[field] = value;
    setDraftPerms(next);
    setDraftRole("custom");
  }

  function toggleTopPerm(field: keyof PermissionSet, value: boolean) {
    if (!draftPerms) return;
    if (field === "modules") return;
    const next = clonePermissionSet(draftPerms);
    (next as unknown as Record<string, unknown>)[field] = value;
    setDraftPerms(next);
    setDraftRole("custom");
  }

  async function saveDraft() {
    if (!editingUserId || !draftPerms) return;
    await setRoleMutation.mutateAsync({
      userId: editingUserId,
      role: draftRole,
      customPermissions: draftRole === "custom" ? draftPerms : undefined,
    });
    setEditingUserId(null);
    setDraftPerms(null);
    setNewUserId("");
  }

  if (!selectedCompanyId) {
    return (
      <EmptyState icon={ShieldCheck} message="Select a workspace first." />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Roles &amp; Permissions</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Assign business roles and fine-tune what each user can do per
            module.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Users</h2>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="user id"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  className="w-40 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startNewUser}
                  disabled={!newUserId.trim()}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Assign
                </Button>
              </div>
            </div>
            {usersQuery.isLoading ? (
              <PageSkeleton variant="list" />
            ) : users.length === 0 ? (
              <EmptyState
                icon={Users}
                message="No users have an explicit business role yet."
              />
            ) : (
              <div className="space-y-2">
                {users.map((u) => (
                  <div
                    key={u.userId}
                    className="border border-border rounded p-2 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-mono text-xs">{u.userId}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge>{ROLE_LABELS[u.role]}</Badge>
                        <span className="text-xs text-muted-foreground">
                          Since {new Date(u.grantedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(u)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeRoleMutation.mutate(u.userId)}
                        disabled={removeRoleMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            {editingUserId && draftPerms ? (
              <RoleEditor
                userId={editingUserId}
                role={draftRole}
                permissions={draftPerms}
                onPreset={applyPreset}
                onToggleModule={toggleModulePerm}
                onToggleTop={toggleTopPerm}
                onCancel={() => {
                  setEditingUserId(null);
                  setDraftPerms(null);
                }}
                onSave={saveDraft}
                saving={setRoleMutation.isPending}
              />
            ) : (
              <RolePresetGallery />
            )}
          </CardContent>
        </Card>
      </div>

      {rolesQuery.data ? (
        <Card>
          <CardContent className="p-4">
            <h2 className="text-base font-semibold mb-2">Role Presets</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {rolesQuery.data.roles.map((preset) => (
                <div
                  key={preset.role}
                  className="border border-border rounded p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{preset.label}</div>
                    <Badge variant="outline">{preset.role}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {preset.description}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function RolePresetGallery() {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">Pick a user to edit</h2>
      <p className="text-sm text-muted-foreground">
        Choose a user on the left to manage their business permissions, or
        assign a role to a new user.
      </p>
      <div className="border-t border-border my-3" />
      <div className="space-y-2">
        {BUSINESS_ROLES.map((role) => (
          <div key={role} className="text-xs">
            <span className="font-medium">{ROLE_LABELS[role]}</span>
            <span className="ml-2 text-muted-foreground">
              {ROLE_DESCRIPTIONS[role]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface RoleEditorProps {
  userId: string;
  role: BusinessRole;
  permissions: PermissionSet;
  onPreset: (role: BusinessRole) => void;
  onToggleModule: (
    moduleKey: string,
    field: keyof PermissionSet["modules"][string],
    value: boolean,
  ) => void;
  onToggleTop: (field: keyof PermissionSet, value: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}

function RoleEditor({
  userId,
  role,
  permissions,
  onPreset,
  onToggleModule,
  onToggleTop,
  onCancel,
  onSave,
  saving,
}: RoleEditorProps) {
  const moduleKeys = useMemo(
    () => BUSINESS_MODULE_KEYS_FOR_PERMS,
    [],
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">Editing</div>
          <div className="font-mono text-sm">{userId}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Preset:</span>
        <Select value={role} onValueChange={(v) => onPreset(v as BusinessRole)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BUSINESS_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border-t border-border" />

      <div>
        <h3 className="text-xs font-medium uppercase text-muted-foreground mb-2">
          System
        </h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <TopFlag
            label="Manage roles"
            checked={permissions.manageRoles}
            onChange={(v) => onToggleTop("manageRoles", v)}
          />
          <TopFlag
            label="Manage settings"
            checked={permissions.manageSettings}
            onChange={(v) => onToggleTop("manageSettings", v)}
          />
          <TopFlag
            label="View audit log"
            checked={permissions.viewAuditLog}
            onChange={(v) => onToggleTop("viewAuditLog", v)}
          />
          <TopFlag
            label="Export data"
            checked={permissions.exportData}
            onChange={(v) => onToggleTop("exportData", v)}
          />
          <TopFlag
            label="Manage agents"
            checked={permissions.manageAgents}
            onChange={(v) => onToggleTop("manageAgents", v)}
          />
          <TopFlag
            label="Manage payments"
            checked={permissions.managePayments}
            onChange={(v) => onToggleTop("managePayments", v)}
          />
        </div>
      </div>

      <div className="border-t border-border" />

      <div>
        <h3 className="text-xs font-medium uppercase text-muted-foreground mb-2">
          Modules
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-1">Module</th>
                <th className="py-1">View</th>
                <th className="py-1">Create</th>
                <th className="py-1">Update</th>
                <th className="py-1">Delete</th>
                <th className="py-1">Export</th>
              </tr>
            </thead>
            <tbody>
              {moduleKeys.map((mk) => {
                const m = permissions.modules[mk];
                if (!m) return null;
                return (
                  <tr key={mk} className="border-t border-border/50">
                    <td className="py-1 font-mono">{mk}</td>
                    <td className="py-1 text-center">
                      <Checkbox
                        checked={m.view}
                        onCheckedChange={(v) =>
                          onToggleModule(mk, "view", Boolean(v))
                        }
                      />
                    </td>
                    <td className="py-1 text-center">
                      <Checkbox
                        checked={m.create}
                        onCheckedChange={(v) =>
                          onToggleModule(mk, "create", Boolean(v))
                        }
                      />
                    </td>
                    <td className="py-1 text-center">
                      <Checkbox
                        checked={m.update}
                        onCheckedChange={(v) =>
                          onToggleModule(mk, "update", Boolean(v))
                        }
                      />
                    </td>
                    <td className="py-1 text-center">
                      <Checkbox
                        checked={m.delete}
                        onCheckedChange={(v) =>
                          onToggleModule(mk, "delete", Boolean(v))
                        }
                      />
                    </td>
                    <td className="py-1 text-center">
                      <Checkbox
                        checked={m.exportData}
                        onCheckedChange={(v) =>
                          onToggleModule(mk, "exportData", Boolean(v))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TopFlag({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} />
      <span>{label}</span>
    </label>
  );
}
