import { useEffect, useState } from "react";

function readInitial(): boolean {
  if (typeof navigator === "undefined") return true;
  if (typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

/**
 * Tracks whether the browser thinks we have a network connection.
 *
 * Feature-detected: in environments without `navigator.onLine` we assume
 * online so the UI never gets stuck behind a fallback.
 */
export function useOnlineStatus(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState<boolean>(readInitial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof navigator === "undefined") return;
    if (typeof navigator.onLine !== "boolean") return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    try {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    } catch {
      return;
    }

    // Re-read once in case state changed between mount and effect.
    setIsOnline(navigator.onLine);

    return () => {
      try {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { isOnline };
}
