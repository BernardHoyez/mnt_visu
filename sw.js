const CACHE_NAME = 'mnt_visu-cache-v1'; // à incrémenter à chaque livraison touchant un fichier statique

// Fichiers de l'app : network-first (jamais de version obsolète quand il y a du réseau)
const APP_FILES = ['./', './index.html', './style.css', './app.js', './manifest.json']
  .map((p) => new URL(p, self.location).href);
// Fichiers stables : cache-first
const STATIC_FILES = [
  './icon-192.png', './icon-512.png',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png', './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png', './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png'
].map((p) => new URL(p, self.location).href);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_FILES, ...STATIC_FILES]))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // tuiles IGN/OSM, WMS : réseau direct

  const href = url.origin + url.pathname;
  const isApp = request.mode === 'navigate' || APP_FILES.includes(href) ||
    APP_FILES.includes(url.href);

  if (isApp) {
    event.respondWith(
      fetch(request.url, { cache: 'no-cache' }) // contourne le cache HTTP de GitHub Pages
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true })
          .then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
