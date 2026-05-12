import { useCallback, useEffect, useState } from "react";

/**
 * Subset of the (non-standard) BeforeInstallPromptEvent surface we use.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

type PromptOutcome = "accepted" | "dismissed" | "unavailable";

export interface UsePwaInstallResult {
  canInstall: boolean;
  isInstalled: boolean;
  promptInstall: () => Promise<PromptOutcome>;
}

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
      return true;
    }
  } catch {
    /* ignore */
  }
  // iOS Safari
  // @ts-expect-error: non-standard property
  if (typeof navigator !== "undefined" && navigator.standalone === true) {
    return true;
  }
  return false;
}

export function usePwaInstall(): UsePwaInstallResult {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(detectInstalled);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBeforeInstallPrompt = (event: Event) => {
      // Prevent Chrome's mini-infobar; we'll trigger the prompt ourselves.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferred(null);
    };

    try {
      window.addEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt as EventListener
      );
      window.addEventListener("appinstalled", handleAppInstalled);
    } catch {
      return;
    }

    return () => {
      try {
        window.removeEventListener(
          "beforeinstallprompt",
          handleBeforeInstallPrompt as EventListener
        );
        window.removeEventListener("appinstalled", handleAppInstalled);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<PromptOutcome> => {
    if (!deferred) return "unavailable";
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null);
      return outcome;
    } catch {
      return "unavailable";
    }
  }, [deferred]);

  return {
    canInstall: Boolean(deferred) && !isInstalled,
    isInstalled,
    promptInstall,
  };
}
