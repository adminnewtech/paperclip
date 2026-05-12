import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export interface PageOfflineFallbackProps {
  /** Optional title override. */
  title?: string;
  /** Optional description override. */
  description?: string;
  /** Optional retry handler. Defaults to `window.location.reload`. */
  onRetry?: () => void;
}

/**
 * Friendly fallback for routes that require a network connection. Use this
 * in route components that can't render meaningfully from cache.
 */
export function PageOfflineFallback({
  title,
  description,
  onRetry,
}: PageOfflineFallbackProps) {
  const { isOnline } = useOnlineStatus();

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    try {
      window.location.reload();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
          <WifiOff className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold">
          {title ?? "This page requires a connection"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {description ??
            "You're offline. Reconnect to load this page — your other work continues uninterrupted."}
        </p>
        <p
          dir="rtl"
          className="mt-2 text-sm text-muted-foreground"
        >
          هذه الصفحة تتطلب اتصالاً بالإنترنت. سيتم تحميلها فور عودة الاتصال.
        </p>
        <div className="mt-4 flex justify-center">
          <Button onClick={handleRetry} disabled={!isOnline}>
            {isOnline ? "Retry" : "Waiting for connection..."}
          </Button>
        </div>
      </div>
    </div>
  );
}
