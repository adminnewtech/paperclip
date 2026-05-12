/**
 * PWA registration + lifecycle helpers.
 *
 * Designed to be safe to import from anywhere: every call is feature-detected,
 * try/catched, and a no-op in environments without service worker support.
 */

let cachedRegistration: ServiceWorkerRegistration | null = null;
const updateListeners = new Set<() => void>();

function supported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    cachedRegistration = registration;

    // Detect updates: when a new worker is installing and there's already an
    // active controller, notify listeners once the new worker reaches
    // "installed" — they can show an "update available" UI and call
    // applyPendingUpdate() to swap to it.
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (
          newWorker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          updateListeners.forEach((cb) => {
            try {
              cb();
            } catch {
              /* ignore */
            }
          });
        }
      });
    });

    // If the controller changes (because a waiting worker took over), reload
    // once so the new assets are picked up.
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      try {
        window.location.reload();
      } catch {
        /* ignore */
      }
    });

    return registration;
  } catch {
    // Registration failure is non-fatal — the app must still work.
    return null;
  }
}

export async function unregisterServiceWorker(): Promise<void> {
  if (!supported()) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    cachedRegistration = null;
  } catch {
    /* ignore */
  }
}

export function getServiceWorkerStatus():
  | "supported"
  | "unsupported"
  | "installing"
  | "active" {
  if (!supported()) return "unsupported";
  if (!cachedRegistration) return "supported";
  if (cachedRegistration.active) return "active";
  if (cachedRegistration.installing || cachedRegistration.waiting)
    return "installing";
  return "supported";
}

export function listenForUpdates(callback: () => void): () => void {
  updateListeners.add(callback);
  return () => {
    updateListeners.delete(callback);
  };
}

export async function applyPendingUpdate(): Promise<void> {
  if (!supported()) return;
  try {
    const registration =
      cachedRegistration ?? (await navigator.serviceWorker.getRegistration());
    const waiting = registration?.waiting;
    if (!waiting) return;
    waiting.postMessage({ type: "SKIP_WAITING" });
  } catch {
    /* ignore */
  }
}
