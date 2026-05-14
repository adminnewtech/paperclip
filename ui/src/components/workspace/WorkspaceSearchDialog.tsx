import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceChannel, WorkspaceMember } from "@paperclipai/shared";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { workspaceApi, workspaceQueryKeys } from "@/api/workspace";
import { MemberAvatar } from "./MemberAvatar";

export interface WorkspaceSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  channels: WorkspaceChannel[];
  members: WorkspaceMember[];
  lang?: "en" | "ar";
  onPickChannel?: (channel: WorkspaceChannel) => void;
  onPickMember?: (member: WorkspaceMember) => void;
}

export function WorkspaceSearchDialog({
  open,
  onOpenChange,
  companyId,
  channels,
  members,
  lang = "en",
  onPickChannel,
  onPickMember,
}: WorkspaceSearchDialogProps) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("messages");

  useEffect(() => {
    if (!open) {
      setQ("");
      setTab("messages");
    }
  }, [open]);

  const messagesSearch = useQuery({
    queryKey: workspaceQueryKeys.search(companyId, q),
    queryFn: () => workspaceApi.messages.search(companyId, q),
    enabled: open && q.trim().length >= 2 && tab === "messages",
  });

  const filteredChannels = useMemo(() => {
    const t = q.toLowerCase();
    if (!t) return channels.slice(0, 10);
    return channels
      .filter((c) =>
        [c.name, c.nameAr, c.slug, c.description]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(t)),
      )
      .slice(0, 20);
  }, [channels, q]);

  const filteredMembers = useMemo(() => {
    const t = q.toLowerCase();
    if (!t) return members.slice(0, 10);
    return members
      .filter((m) =>
        [m.displayName, m.displayNameAr, m.title]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(t)),
      )
      .slice(0, 20);
  }, [members, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={lang === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>
            {lang === "ar" ? "بحث" : "Search workspace"}
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              lang === "ar"
                ? "ابحث في الرسائل والقنوات والأعضاء…"
                : "Search messages, channels, members…"
            }
            className="w-full rounded-md border border-input bg-background px-3 py-2 ps-10 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="messages">
              {lang === "ar" ? "الرسائل" : "Messages"}
            </TabsTrigger>
            <TabsTrigger value="channels">
              {lang === "ar" ? "القنوات" : "Channels"}
            </TabsTrigger>
            <TabsTrigger value="members">
              {lang === "ar" ? "الأعضاء" : "Members"}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="max-h-72 space-y-1 overflow-y-auto">
            {q.trim().length < 2 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {lang === "ar"
                  ? "اكتب حرفين على الأقل…"
                  : "Type at least 2 characters…"}
              </div>
            ) : messagesSearch.isLoading ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {lang === "ar" ? "جارٍ البحث…" : "Searching…"}
              </div>
            ) : (messagesSearch.data?.results ?? []).length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {lang === "ar" ? "لا توجد نتائج" : "No matches"}
              </div>
            ) : (
              messagesSearch.data!.results.slice(0, 10).map((hit, i) => (
                <div
                  key={`${hit.message.id}-${i}`}
                  className="cursor-pointer rounded-md px-3 py-2 text-sm hover:bg-accent"
                  onClick={() => {
                    if (hit.channel) onPickChannel?.(hit.channel);
                    onOpenChange(false);
                  }}
                >
                  <div className="text-xs text-muted-foreground">
                    #{hit.channel?.slug ?? hit.message.channelId} ·{" "}
                    {hit.message.authorDisplayName ?? hit.message.authorId}
                  </div>
                  <div className="truncate">{hit.message.body}</div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="channels" className="max-h-72 space-y-1 overflow-y-auto">
            {filteredChannels.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {lang === "ar" ? "لا توجد قنوات" : "No channels"}
              </div>
            ) : (
              filteredChannels.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onPickChannel?.(c);
                    onOpenChange(false);
                  }}
                >
                  <span className="truncate font-medium">#{c.slug}</span>
                  {c.description ? (
                    <span className="ms-2 truncate text-xs text-muted-foreground">
                      {c.description}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </TabsContent>

          <TabsContent value="members" className="max-h-72 space-y-1 overflow-y-auto">
            {filteredMembers.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {lang === "ar" ? "لا يوجد أعضاء" : "No members"}
              </div>
            ) : (
              filteredMembers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onPickMember?.(m);
                    onOpenChange(false);
                  }}
                >
                  <MemberAvatar member={m} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.displayName}</div>
                    {m.title ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {m.title}
                      </div>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
