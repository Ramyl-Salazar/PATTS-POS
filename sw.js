const CACHE_NAME = "patts-pos-v14";
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./access.js", "./backup.js", "./checkout.js", "./db.js", "./inventory.js", "./order.js", "./reader-protocol.js", "./reader-diagnostics.js", "./views.js", "./wallet.js", "./students.js", "./cards.js", "./manifest.webmanifest", "./icon.svg", "./vendor/geist-latin-wght-normal.woff2", "./vendor/gsap.min.js", "./vendor/ScrollTrigger.min.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (event.request.mode === "navigate") return caches.match("./index.html");
    return Response.error();
  }));
});
