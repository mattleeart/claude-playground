/* Service worker: offline support for the markdown viewer.
   - Core shell + vendored libs: cache-first.
   - Documents (manifest.json, content/*.md): network-first (stay fresh). */
const VERSION = "mdv-v2";
const CORE = [
  "./",
  "index.html",
  "app.webmanifest",
  "assets/app.js",
  "assets/styles.css",
  "assets/vendor/marked.min.js",
  "assets/vendor/purify.min.js",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isDoc(url) {
  return url.pathname.endsWith("/manifest.json") || /\/content\/.+\.md$/.test(url.pathname);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (images/CDN) pass through

  if (isDoc(url)) {
    // network-first
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // cache-first for shell + assets
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })
    )
  );
});
