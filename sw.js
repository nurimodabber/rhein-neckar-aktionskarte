// Rhein-Neckar Cluster Offline Service Worker (v5)
const CACHE_NAME = 'rhein-neckar-cache-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css?v=5',
  './app.js?v=5',
  './icon.svg',
  './manifest.json',
  './lib/leaflet.css',
  './lib/leaflet.js',
  './lib/html2canvas.min.js',
  './lib/qrcode.min.js',
  './surrounding_kreise.js',
  './rivers_data.js',
  './geographic_landmarks.js',
  './rhein_neckar_data.js',
  './rhein_neckar_districts.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      // Notify all open pages and take control immediately
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
        });
        return self.clients.claim();
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isHtml = event.request.mode === 'navigate' ||
                 (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) ||
                 url.pathname.endsWith('.html') ||
                 url.pathname === '/' ||
                 url.pathname.endsWith('/rhein-neckar-aktionskarte/');

  // 1. Navigation / HTML requests: NETWORK-FIRST (guarantees latest app version when online)
  if (isHtml) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback
          return caches.match(event.request).then((cached) => {
            return cached || caches.match('./index.html') || caches.match('./');
          });
        })
    );
    return;
  }

  // 2. Static Assets (JS, CSS, images, data): Cache-first with background network refresh
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => null);

      if (cachedResponse) return cachedResponse;

      return networkFetch.then((resp) => {
        if (resp) return resp;
        return caches.match(event.request);
      });
    })
  );
});
