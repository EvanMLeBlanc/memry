/* Memry service worker — v2
 *
 * v1 used cache.addAll(), which is all-or-nothing: a single missing file
 * (a 404 on an icon, say) rejected the whole install, the worker never
 * activated, and NOTHING was cached — so the app died offline with no
 * warning. v2 caches each file independently and treats the icons as
 * optional, so the app shell always survives.
 */

const CACHE = "memry-v2";

// Without these the app cannot run. Install fails loudly if any are missing.
const CRITICAL = [
  "./",
  "./index.html"
];

// Nice to have. A failure here must never block offline support.
const OPTIONAL = [
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

async function cacheOne(cache, url) {
  try {
    // cache: "reload" bypasses the HTTP cache so we store a fresh copy.
    const res = await fetch(new Request(url, { cache: "reload" }));
    if (!res || !res.ok) return false;
    await cache.put(url, res.clone());
    return true;
  } catch (e) {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    const critical = await Promise.all(CRITICAL.map((u) => cacheOne(cache, u)));

    // If "./" and "./index.html" both failed, there is no point activating.
    if (!critical.some(Boolean)) {
      throw new Error("Memry: could not cache the app shell");
    }

    await Promise.all(OPTIONAL.map((u) => cacheOne(cache, u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Navigations: always try cache first, and fall back to the shell.
    // This is what makes launching from the Home Screen work offline.
    if (req.mode === "navigate") {
      const hit = (await cache.match(req, { ignoreSearch: true })) ||
                  (await cache.match("./index.html")) ||
                  (await cache.match("./"));
      if (hit) {
        // Refresh in the background; never block the launch on it.
        event.waitUntil(cacheOne(cache, "./index.html"));
        return hit;
      }
      try {
        return await fetch(req);
      } catch (e) {
        return new Response(
          "<h1>Memry is offline</h1><p>Reconnect once to finish installing.</p>",
          { headers: { "Content-Type": "text/html" }, status: 200 }
        );
      }
    }

    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;

    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});

// Lets the page ask "is everything cached?" so the UI can show a real badge.
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "CHECK_CACHE") return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shell = (await cache.match("./index.html")) || (await cache.match("./"));
    const all = await cache.keys();
    const reply = { type: "CACHE_STATUS", ready: !!shell, count: all.length, version: CACHE };
    if (event.source) event.source.postMessage(reply);
    else (await self.clients.matchAll()).forEach((c) => c.postMessage(reply));
  })());
});
