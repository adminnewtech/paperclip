/* Paperclip service worker — vanilla, no Workbox. */
/* eslint-disable no-restricted-globals */

const CACHE_VERSION = "paperclip-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Pre-cache app shell. Keep this list small so install doesn't fail when
// a single asset 404s. Vite emits hashed JS/CSS that will be picked up
// by the runtime cache-first strategy instead.
const PRECACHE_URLS = ["/", "/manifest.webmanifest", "/offline.html"];

// Read-only API routes safe to serve stale-while-revalidate.
const RUNTIME_CACHE_ROUTES = [
  /\/api\/companies\/[^/]+\/business\/financial-summary/,
  /\/api\/companies\/[^/]+\/business\/modules/,
];

// ---------- install ----------
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        // addAll is atomic — fall back to individual puts so one missing
        // entry (e.g. offline.html in older builds) doesn't break install.
        await Promise.all(
          PRECACHE_URLS.map(async (url) => {
            try {
              const res = await fetch(url, { cache: "reload" });
              if (res.ok) await cache.put(url, res);
            } catch {
              /* ignore individual failures */
            }
          })
        );
      } finally {
        await self.skipWaiting();
      }
    })()
  );
});

// ---------- activate ----------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ---------- helpers ----------
function isStaticAsset(url) {
  return /\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|ico)$/i.test(
    url.pathname
  );
}

function isRuntimeCacheableApi(url) {
  return RUNTIME_CACHE_ROUTES.some((re) => re.test(url.pathname));
}

async function networkFirstNavigation(request) {
  try {
    const res = await fetch(request);
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fallback = await caches.match("/offline.html");
    if (fallback) return fallback;
    const shell = await caches.match("/");
    if (shell) return shell;
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) {
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  if (cached) {
    // kick off revalidation in background
    networkPromise.catch(() => {});
    return cached;
  }
  const fresh = await networkPromise;
  if (fresh) return fresh;
  return new Response(JSON.stringify({ offline: true }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

async function cacheFirstWithRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request)
      .then((res) => {
        if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch {
    return new Response("", { status: 504 });
  }
}

// ---------- fetch ----------
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GETs. Cross-origin (e.g. CDN) bypasses SW.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Ignore dev/HMR + websocket-ish stuff if it ever sneaks in.
  if (url.pathname.startsWith("/@") || url.pathname.startsWith("/__vite")) {
    return;
  }

  // Navigation requests: network-first w/ offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // API requests.
  if (url.pathname.startsWith("/api/")) {
    if (isRuntimeCacheableApi(url)) {
      event.respondWith(staleWhileRevalidate(request));
    }
    // Otherwise: network-only. Don't call respondWith so the browser handles it.
    return;
  }

  // Static assets: cache-first w/ background revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstWithRevalidate(request));
    return;
  }
});

// ---------- background sync (placeholder) ----------
self.addEventListener("sync", (event) => {
  if (event.tag === "paperclip-pending-mutations") {
    // future: flush queued offline mutations from IndexedDB
  }
});

// ---------- push notifications ----------
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Paperclip", body: event.data.text() };
  }
  const title = data.title || "Paperclip";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-72.png",
    data: data.url || "/",
    tag: data.tag,
    renotify: Boolean(data.tag),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          try {
            await client.focus();
            if ("navigate" in client && typeof target === "string") {
              try {
                await client.navigate(target);
              } catch {
                /* cross-origin or unsupported */
              }
            }
            return;
          } catch {
            /* fallthrough */
          }
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(target);
      }
    })()
  );
});

// ---------- message channel (for skipWaiting from page) ----------
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
