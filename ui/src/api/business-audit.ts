import { api } from "./client";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "view"
  | "export"
  | "login"
  | "logout"
  | "permission_change"
  | "role_change";

export type AuditActorType = "user" | "agent" | "system" | "api";

export interface AuditDiff {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changedFields?: string[];
}

export interface AuditEntry {
  id: string;
  companyId: string;
  timestamp: string;
  actorUserId?: string;
  actorAgentId?: string;
  actorType: AuditActorType;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  targetCode?: string;
  moduleKey?: string;
  entityType?: string;
  ipAddress?: string;
  userAgent?: string;
  diff?: AuditDiff;
  metadata?: Record<string, unknown>;
}

export interface ListAuditLogsResponse {
  entries: AuditEntry[];
  nextCursor?: string;
}

export interface ListAuditLogsQuery {
  from?: string;
  to?: string;
  actorUserId?: string;
  action?: AuditAction | string;
  targetType?: string;
  targetId?: string;
  moduleKey?: string;
  limit?: number;
  cursor?: string;
}

function buildQuery(params: ListAuditLogsQuery | undefined) {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const businessAuditApi = {
  listLogs: (companyId: string, query?: ListAuditLogsQuery) =>
    api.get<ListAuditLogsResponse>(
      `/companies/${companyId}/business/audit/logs${buildQuery(query)}`,
    ),

  entityHistory: (companyId: string, entityId: string) =>
    api.get<{ entries: AuditEntry[] }>(
      `/companies/${companyId}/business/audit/entity/${entityId}/history`,
    ),

  exportUrl: (companyId: string, from: string, to: string) => {
    const search = new URLSearchParams({ from, to });
    return `/api/companies/${companyId}/business/audit/export?${search.toString()}`;
  },
};
