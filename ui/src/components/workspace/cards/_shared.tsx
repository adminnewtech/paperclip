import { useState, type ReactNode } from "react";
import type { WorkspaceMessageCardAction } from "@paperclipai/shared";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type CardActionHandler = (actionKey: string) => void | Promise<void>;

export interface CardShellProps {
  icon: ReactNode;
  title: string;
  badge?: string;
  lang?: "en" | "ar";
  actions?: WorkspaceMessageCardAction[];
  busyAction?: string | null;
  onAction?: CardActionHandler;
  children?: ReactNode;
}

export function CardShell({
  icon,
  title,
  badge,
  lang = "en",
  actions,
  busyAction,
  onAction,
  children,
}: CardShellProps) {
  const [confirm, setConfirm] = useState<WorkspaceMessageCardAction | null>(null);

  const runAction = async (action: WorkspaceMessageCardAction) => {
    if (action.danger) {
      setConfirm(action);
      return;
    }
    await onAction?.(action.key);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1 truncate text-sm font-medium">{title}</span>
        {badge ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {badge}
          </span>
        ) : null}
      </div>
      {children ? <div className="px-3 py-3">{children}</div> : null}
      {actions && actions.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-border bg-muted/20 px-3 py-2">
          {actions.map((action) => {
            const label = lang === "ar" && action.labelAr ? action.labelAr : action.label;
            const isBusy = busyAction === action.key;
            return (
              <Button
                key={action.key}
                size="xs"
                variant={action.danger ? "destructive" : "outline"}
                disabled={isBusy || !!busyAction}
                onClick={() => runAction(action)}
              >
                {isBusy ? <Loader2 className="animate-spin" /> : null}
                {label}
              </Button>
            );
          })}
        </div>
      ) : null}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent dir={lang === "ar" ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>
              {lang === "ar" ? "تأكيد الإجراء" : "Confirm action"}
            </DialogTitle>
            <DialogDescription>
              {lang === "ar"
                ? `هل أنت متأكد من تنفيذ "${confirm?.labelAr ?? confirm?.label}"؟`
                : `Are you sure you want to "${confirm?.label}"?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {lang === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirm) return;
                const key = confirm.key;
                setConfirm(null);
                await onAction?.(key);
              }}
            >
              {lang === "ar" ? "تأكيد" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
