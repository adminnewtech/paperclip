import { useEffect, useState } from "react";
import { WifiOff, X } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * Persistent top-of-screen banner shown while offline. Dismissible — the
 * dismissal lasts only for the current offline session; if the user goes
 * back online and offline again, the banner reappears.
 */
export function OfflineIndicator() {
  const { isOnline } = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal whenever we come back online so the next offline event
  // shows the banner again.
  useEffect(() => {
    if (isOnline && dismissed) setDismissed(false);
  }, [isOnline, dismissed]);

  if (isOnline || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 backdrop-blur-sm dark:text-amber-200"
    >
      <div className="flex min-w-0 items-center gap-2">
        <WifiOff className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">
          You're offline — work continues and will sync when reconnected.
        </span>
        <span dir="rtl" className="hidden truncate sm:inline">
          • أنت غير متصل بالإنترنت — يمكنك الاستمرار في العمل وستتم المزامنة عند العودة
        </span>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss offline notice"
        className="shrink-0 rounded-md p-1 hover:bg-amber-500/20"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
