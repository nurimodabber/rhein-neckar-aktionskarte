// Rhein-Neckar Cluster Offline Service Worker (v4)
const CACHE_NAME = 'rhein-neckar-cache-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
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
      // Notify all open pages that a new app version is installed
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
  // Cache-First with Network Background Refresh:
  // Responds from cache immediately (true offline-first), and
  // updates the cache in the background when online.
  if (event.request.method !== 'GET') return;

  // Only intercept same-origin requests
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Background network refresh
      const networkFetch = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => null);

      // Return cached version immediately if available
      if (cachedResponse) return cachedResponse;

      // Otherwise wait for network
      return networkFetch.then((resp) => {
        if (resp) return resp;
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
