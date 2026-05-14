import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkspaceChannel, WorkspaceMember } from "@paperclipai/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { workspaceApi, workspaceQueryKeys } from "@/api/workspace";
import { MemberAvatar } from "./MemberAvatar";
import { MemberStatusBadge } from "./MemberStatusBadge";

export interface StartDmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  lang?: "en" | "ar";
  onCreated?: (channel: WorkspaceChannel) => void;
}

export function StartDmDialog({
  open,
  onOpenChange,
  companyId,
  lang = "en",
  onCreated,
}: StartDmDialogProps) {
  const [filter, setFilter] = useState("");
  const queryClient = useQueryClient();

  const members = useQuery({
    queryKey: workspaceQueryKeys.members(companyId),
    queryFn: () => workspaceApi.members.list(companyId),
    enabled: open && !!companyId,
  });

  const filtered = useMemo<WorkspaceMember[]>(() => {
    const list = members.data?.members ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) =>
      [m.displayName, m.displayNameAr, m.title, m.id]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [members.data?.members, filter]);

  const start = useMutation({
    mutationFn: (memberId: string) =>
      workspaceApi.dms.findOrCreate(companyId, memberId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.channels(companyId),
      });
      onCreated?.(res.channel);
      onOpenChange(false);
      setFilter("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={lang === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>
            {lang === "ar" ? "محادثة مباشرة جديدة" : "Start a direct message"}
          </DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={
            lang === "ar" ? "ابحث عن عضو…" : "Search members…"
          }
        />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {members.isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {lang === "ar" ? "جارٍ التحميل…" : "Loading…"}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {lang === "ar" ? "لا توجد نتائج" : "No matches"}
            </div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => start.mutate(m.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
                disabled={start.isPending}
              >
                <MemberAvatar member={m} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.displayName}
                  </div>
                  {m.title ? (
                    <div className="truncate text-xs text-muted-foreground">
                      {m.title}
                    </div>
                  ) : null}
                </div>
                <MemberStatusBadge status={m.status} lang={lang} />
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
