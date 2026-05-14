import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChannelKind, WorkspaceChannel } from "@paperclipai/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { workspaceApi, workspaceQueryKeys } from "@/api/workspace";

export interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  lang?: "en" | "ar";
  onCreated?: (channel: WorkspaceChannel) => void;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function CreateChannelDialog({
  open,
  onOpenChange,
  companyId,
  lang = "en",
  onCreated,
}: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [kind, setKind] = useState<ChannelKind>("public");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () =>
      workspaceApi.channels.create(companyId, {
        slug: toSlug(name),
        name: name.trim(),
        nameAr: nameAr.trim() || undefined,
        description: description.trim() || undefined,
        kind,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.channels(companyId),
      });
      onCreated?.(res.channel);
      setName("");
      setNameAr("");
      setDescription("");
      setKind("public");
      setError(null);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={lang === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>
            {lang === "ar" ? "إنشاء قناة" : "Create a channel"}
          </DialogTitle>
          <DialogDescription>
            {lang === "ar"
              ? "نظّم المحادثات حسب الموضوع."
              : "Organise conversations by topic."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ch-name">
              {lang === "ar" ? "الاسم" : "Name"}
            </Label>
            <Input
              id="ch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={lang === "ar" ? "مبيعات" : "sales"}
              autoFocus
            />
            {name ? (
              <p className="text-xs text-muted-foreground">
                #{toSlug(name)}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ch-name-ar">
              {lang === "ar" ? "الاسم (عربي)" : "Name (Arabic, optional)"}
            </Label>
            <Input
              id="ch-name-ar"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              placeholder="مبيعات"
              dir="rtl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ch-desc">
              {lang === "ar" ? "الوصف" : "Description"}
            </Label>
            <Input
              id="ch-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                lang === "ar"
                  ? "ما الذي ستناقشه هذه القناة؟"
                  : "What is this channel for?"
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>{lang === "ar" ? "الرؤية" : "Visibility"}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={kind === "public" ? "default" : "outline"}
                size="sm"
                onClick={() => setKind("public")}
              >
                {lang === "ar" ? "عامة" : "Public"}
              </Button>
              <Button
                type="button"
                variant={kind === "private" ? "default" : "outline"}
                size="sm"
                onClick={() => setKind("private")}
              >
                {lang === "ar" ? "خاصة" : "Private"}
              </Button>
            </div>
          </div>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {lang === "ar" ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending
              ? lang === "ar"
                ? "جارٍ الإنشاء…"
                : "Creating…"
              : lang === "ar"
                ? "إنشاء"
                : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
