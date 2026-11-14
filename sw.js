/* Elpris — offline cache.
   App shell: cache-first with background refresh (bump CACHE when HTML/CSS/JS change).
   Price API (elprisetjustnu.se): network-first, falls back to the last cached copy. */
const CACHE = "elpris-v3";
const API_CACHE = "elpris-api-v1";
const ASSETS = [
  "./", "./index.html", "./styles.css?v=3", "./tariff.js?v=3", "./app.js?v=3",
  "./manifest.webmanifest?v=3", "./icon.svg?v=3", "./icon-rounded.svg?v=3", "./favicon-32.png?v=3",
  "./apple-touch-icon.png?v=3", "./icon-192.png?v=3", "./icon-512.png?v=3",
  "./icon-maskable-192.png?v=3", "./icon-maskable-512.png?v=3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((p) => new Request(p, { cache: "no-store" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(cacheName, req, res) {
  if (!res || !res.ok) return;
  const copy = res.clone();
  caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "www.elprisetjustnu.se") {
    event.respondWith(
      fetch(req).then((res) => { put(API_CACHE, req, res); return res; })
        .catch(() => caches.open(API_CACHE).then((c) => c.match(req)).then((hit) => hit || Response.error()))
    );
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.endsWith("/sw.js")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => { put(CACHE, "./index.html", res); return res; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((res) => { put(CACHE, req, res); return res; }).catch(() => cached);
      return cached || fresh;
    })
  );
});
