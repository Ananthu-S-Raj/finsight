// Cache id — stamped with a per-deploy version by scripts/stamp-sw.mjs during
// `npm run build`. The bytes of this file must change on every release or the
// browser will never install the new worker and the auto-update flow stops.
const CACHE = "finsight-v4-68f9acd";
const CORE_URLS = ["/dashboard", "/login", "/register", "/manifest.json", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];
const NAVIGATIONS = ["/", "/dashboard", "/login", "/register", "/verify", "/transactions", "/analytics", "/budgets", "/savings", "/cards", "/lend", "/insights", "/notifications", "/profile", "/settings", "/admin"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
          for (const client of clients) {
            try {
              client.postMessage({ type: "finsight-version", version: CACHE });
            } catch {
              // client not ready — best-effort
            }
          }
        })
      )
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const method = event.request.method;

  // Only handle GET requests.
  if (method !== "GET") return;

  // Never cache Supabase API calls — network first, offline fails fast with a
  // 503 the app already understands. Sensitive financial data is never stored.
  if (url.origin.includes("supabase.co")) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } }))
    );
    return;
  }

  // App shell navigation — network first, fall back to cache (offline).
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || caches.match("/dashboard"))
        )
    );
    return;
  }

  // Next.js build chunks — network first, fall back to cache (offline).
  // In dev mode, webpack recompiles on every edit and some chunk URLs lack
  // version hashes; serving stale cached chunks causes runtime errors and
  // forces a full reload that breaks Fast Refresh.
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Same-origin non-API requests — cache first, then network.
  // API routes are excluded: they carry auth tokens, return user-specific
  // data, and caching a 401/403 would break authenticated sessions.
  if (url.origin === self.location.origin && !url.pathname.startsWith("/api/")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Everything else — network only.
  event.respondWith(fetch(event.request));
});

// ------------------------------------------------------------------
// Notifications
// ------------------------------------------------------------------

const ACTIONS = {
  dismiss: { action: "dismiss", title: "Dismiss" },
};

function normalizeData(raw) {
  // Never put balances or sensitive figures in notification text unless the
  // payload explicitly does; default to privacy-safe copy.
  const data = raw && typeof raw === "object" ? raw : {};
  const title = String(data.title || "FinSight").slice(0, 120);
  const body = String(data.body || "Your finances need a quick check-in.").slice(0, 300);
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/dashboard";
  const tag = String(data.tag || `finsight-${Date.now()}`);
  const actions = Array.isArray(data.actions)
    ? data.actions.filter((a) => a && typeof a.action === "string" && typeof a.title === "string")
    : undefined;
  return { title, body, url, tag, actions };
}

self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const { title, body, url, tag, actions } = normalizeData(payload);

  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag,
    data: { url },
    actions,
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      // Bridge to open app windows so the in-app notification center stays in
      // sync with what push delivered.
      return self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => {
          for (const client of clients) {
            try {
              client.postMessage({ type: "finsight-push", payload: { title, body, url, tag, category: payload.category } });
            } catch {
              // client not ready — in-app sync is best-effort
            }
          }
        });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const action = event.action;

  if (action === "dismiss") {
    notification.close();
    return;
  }

  notification.close();

  const data = notification.data || {};
  // If a notification defined per-action destinations, honor them.
  const url =
    (action &&
      Array.isArray(data.actions) &&
      data.actions.find((a) => a.action === action)?.url) ||
    data.url ||
    "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.length && "navigate" in clients[0]) {
        try {
          return clients[0].navigate(url);
        } catch {
          return self.clients.openWindow(url);
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("notificationclose", () => {
  // Reserved: future per-device quiet-hour tracking could live here.
});
