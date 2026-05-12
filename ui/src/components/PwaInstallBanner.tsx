import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/hooks/usePwaInstall";

const DISMISS_KEY = "paperclip.pwa.install.dismissedAt";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function readDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const ts = Number.parseInt(raw, 10);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function writeDismissedAt(ts: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

/**
 * Shown once `beforeinstallprompt` fires, unless the user has dismissed it
 * within the last 30 days or already installed the app.
 */
export function PwaInstallBanner() {
  const { canInstall, promptInstall } = usePwaInstall();
  const [recentlyDismissed, setRecentlyDismissed] = useState<boolean>(() => {
    const dismissedAt = readDismissedAt();
    if (!dismissedAt) return false;
    return Date.now() - dismissedAt < DISMISS_TTL_MS;
  });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // Re-check TTL on mount in case it expired since last render.
    const dismissedAt = readDismissedAt();
    setRecentlyDismissed(
      Boolean(dismissedAt) && Date.now() - (dismissedAt ?? 0) < DISMISS_TTL_MS
    );
  }, []);

  if (!canInstall || recentlyDismissed) return null;

  const handleDismiss = () => {
    writeDismissedAt(Date.now());
    setRecentlyDismissed(true);
  };

  const handleInstall = async () => {
    setPending(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "dismissed") {
        writeDismissedAt(Date.now());
        setRecentlyDismissed(true);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Install Paperclip"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-lg border border-border bg-card p-4 shadow-lg sm:inset-x-auto sm:right-4"
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <X className="size-4" />
      </button>
      <div className="space-y-1 pr-6 text-sm">
        <p className="font-medium">Install Paperclip as an app on your device</p>
        <p dir="rtl" className="text-muted-foreground">
          ثبّت Paperclip كتطبيق على جهازك
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          onClick={handleInstall}
          disabled={pending}
        >
          {pending ? "Installing..." : "Install"}
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
