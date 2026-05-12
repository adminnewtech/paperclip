/**
 * Side drawer that shows the full audit history for a single business entity.
 *
 * Designed to be opened from existing detail dialogs (invoice / deal /
 * expense). Render it wherever you have an entity id and a "History"
 * affordance.
 */

import { useQuery } from "@tanstack/react-query";
import { History, ShieldCheck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "../PageSkeleton";
import { EmptyState } from "../EmptyState";
import { useCompany } from "../../context/CompanyContext";
import {
  businessAuditApi,
  type AuditAction,
  type AuditEntry,
} from "../../api/business-audit";

export interface EntityHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string | null;
  /** Optional title for the entity (e.g. invoice code). */
  title?: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionTone(
  action: AuditAction,
): "default" | "secondary" | "outline" | "destructive" {
  if (action === "delete") return "destructive";
  if (action === "create") return "default";
  if (action === "update") return "secondary";
  return "outline";
}

export function EntityHistoryDrawer({
  open,
  onOpenChange,
  entityId,
  title,
}: EntityHistoryDrawerProps) {
  const { selectedCompanyId } = useCompany();

  const historyQuery = useQuery({
    queryKey: ["business-audit-entity-history", selectedCompanyId, entityId],
    queryFn: () =>
      businessAuditApi.entityHistory(selectedCompanyId!, entityId!),
    enabled: open && !!selectedCompanyId && !!entityId,
  });

  const entries: AuditEntry[] = historyQuery.data?.entries ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Entity history
          </SheetTitle>
          <SheetDescription>
            {title ?? "Every recorded change to this entity, newest first."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {!entityId ? (
            <EmptyState icon={ShieldCheck} message="No entity selected." />
          ) : historyQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={History}
              message="No audit history for this entity yet."
            />
          ) : (
            <ol className="relative border-l border-border ml-3 space-y-4">
              {entries.map((entry) => (
                <li key={entry.id} className="ml-4">
                  <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-primary/70 border border-background" />
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={actionTone(entry.action)}>
                      {entry.action}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(entry.timestamp)}
                    </span>
                  </div>
                  <div className="text-xs mt-1">
                    <span className="font-mono">
                      {entry.actorUserId ?? entry.actorAgentId ?? "system"}
                    </span>
                    <span className="ml-1 text-muted-foreground">
                      ({entry.actorType})
                    </span>
                  </div>
                  {entry.diff?.changedFields &&
                  entry.diff.changedFields.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entry.diff.changedFields.slice(0, 8).map((f) => (
                        <Badge
                          key={f}
                          variant="outline"
                          className="text-[10px]"
                        >
                          {f}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
