// Offline support: keep the app's own files cached so it opens without signal
// (e.g. in the kitchen or the grocery store). Recipes themselves are cached by Firestore.
const CACHE = 'family-recipes-v5';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/units.js', 'js/parse.js', 'js/grocery.js', 'js/categories.js', 'js/importers.js', 'js/config.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first (so updates show up right away), cache as fallback when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
