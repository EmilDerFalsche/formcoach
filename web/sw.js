// Service Worker: App offline nutzbar machen.
// - App-Dateien: network-first mit Timeout (Updates kommen sofort, bei schlechtem Netz greift der Cache)
// - MediaPipe (CDN, versioniert, ~10 MB): cache-first in eigenem Cache, der App-Updates überlebt
const CACHE = "formcoach-v18";
const CDN_CACHE = "formcoach-cdn-v1";
const SHELL = [
  "./", "index.html", "styles.css", "manifest.json", "icon.svg",
  "js/app.js", "js/pose.js", "js/features.js", "js/squatAnalyzer.js", "js/classifier.js", "js/feedback.js",
  "js/cloud.js", "js/config.js", "js/exercises.js", "js/gesture.js", "js/pushupAnalyzer.js", "js/tennisAnalyzer.js", "js/snapshots.js", "js/streak.js",
  "model/squat_model.json",
];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isCdn = (url) => url.host.endsWith("jsdelivr.net") || url.host === "storage.googleapis.com" || url.host.endsWith("unsplash.com");

function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit && !settled && ((settled = true), resolve(hit)));
    const timer = setTimeout(fromCache, NETWORK_TIMEOUT_MS);
    fetch(req)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        if (!settled) { settled = true; resolve(res); }
      })
      .catch(async () => {
        clearTimeout(timer);
        if (settled) return;
        const hit = await caches.match(req, { ignoreSearch: true });
        settled = true;
        resolve(hit || Response.error());
      });
  });
}

function cacheFirst(req) {
  return caches.open(CDN_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") c.put(req, res.clone()); // Übungsfotos (no-cors) ebenfalls offline verfügbar
    return res;
  })));
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (isCdn(url)) e.respondWith(cacheFirst(e.request));
  else if (url.origin === location.origin) e.respondWith(networkFirst(e.request));
});
