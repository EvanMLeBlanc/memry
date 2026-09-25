/* Memry service worker — v3
 *
 * Caches each file independently. A missing icon can never block offline
 * support (that bug killed v1 entirely).
 */

const CACHE = "memry-v3";

const CRITICAL = [
  "./",
  "./index.html"
];

const OPTIONAL = [
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

async function cacheOne(cache, url) {
  try {
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

    if (req.mode === "navigate") {
      const hit = (await cache.match(req, { ignoreSearch: true })) ||
                  (await cache.match("./index.html")) ||
                  (await cache.match("./"));
      if (hit) {
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
