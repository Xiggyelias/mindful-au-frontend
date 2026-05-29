/* global self, caches, fetch */
const CACHE_NAME = "cms-cache-v6";

/** System notification artwork — black / crimson / white (matches counseling UI). */
const NOTIFY_ICON = "/assets/icons/notify-192.png";
const NOTIFY_BADGE = "/assets/icons/notify-badge-96.png";

/** Precache: SPA shell only (hashed JS/CSS is loaded lazily from network). */
const urlsToCache = [
  "/",
  "/manifest.json",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  NOTIFY_ICON,
  NOTIFY_BADGE,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        urlsToCache.map((url) =>
          cache.add(url).catch(() => {
            /* ignore individual failures (e.g. dev server paths) */
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never intercept API calls - let them go directly to server
  if (url.hostname === 'mindfulapi.africau.co.zw') {
    return; // bypass service worker completely for all API calls
  }

  // ✅ Never intercept signed file URLs — let them go straight to network
  if (
    url.pathname.includes('/chat/files/') ||
    url.searchParams.has('signature') ||
    url.searchParams.has('expires')
  ) {
    return; // bypass service worker entirely
  }

  const { request } = event;
  if (request.method !== "GET") return;

  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => {
        // Return a basic error response for cross-origin failures
        return new Response('Service worker fetch failed', { 
          status: 500, 
          statusText: 'Service Worker Error' 
        });
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match("/"))
        )
    );
    return;
  }

  // Hashed Vite bundles: network-first so deploys never serve stale JS/CSS from cache.
  if (url.pathname.startsWith("/assets/") && /\.(js|css|mjs)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || fetch(request)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (!res || res.status !== 200 || res.type !== "basic") return res;
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return res;
      }).catch(() => {
        // Return a basic error response for fetch failures
        return new Response('Service worker fetch failed', { 
          status: 500, 
          statusText: 'Service Worker Error' 
        });
      });
    })
  );
});

/** Web Push — payload JSON: { title, body, url, path, icon?, badge?, tag, requireInteraction?, silent?, urgency? } */
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {
        title: "Africa University Counseling",
        body: "You have a new notification.",
        url: "/",
        path: "/",
        icon: NOTIFY_ICON,
        badge: NOTIFY_BADGE,
        tag: "cms-default",
        requireInteraction: false,
        silent: false,
      };

      if (event.data) {
        try {
          const parsed = event.data.json();
          payload = { ...payload, ...parsed };
        } catch {
          try {
            const text = await event.data.text();
            if (text) {
              payload = { ...payload, body: text };
            }
          } catch {
            /* keep defaults */
          }
        }
      }

      const resolveUrl = () => {
        const raw = payload.url || payload.path || "/";
        if (typeof raw === "string" && raw.startsWith("http")) return raw;
        try {
          return new URL(String(raw || "/"), self.location.origin).href;
        } catch {
          return self.location.origin + "/";
        }
      };

      const targetUrl = resolveUrl();
      const icon = payload.icon || NOTIFY_ICON;
      const badge = payload.badge || NOTIFY_BADGE;

      await self.registration.showNotification(payload.title || "Africa University Counseling", {
        body: payload.body || "",
        icon,
        badge,
        tag: payload.tag || "cms-" + String(Date.now()),
        vibrate: payload.silent ? undefined : [200, 100, 200],
        requireInteraction: Boolean(payload.requireInteraction),
        silent: Boolean(payload.silent),
        data: { url: targetUrl, path: payload.path || "/", tag: payload.tag, icon, badge },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const raw = data.url || data.path || "/";
  let targetUrl;
  try {
    targetUrl =
      typeof raw === "string" && raw.startsWith("http")
        ? raw
        : new URL(String(raw), self.location.origin).href;
  } catch {
    targetUrl = self.location.origin + "/";
  }

  event.waitUntil(
    self.clients.openWindow ? self.clients.openWindow(targetUrl) : Promise.resolve()
  );
});
