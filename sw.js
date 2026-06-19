const CACHE = 'qas-v2.3.0';

const STATIC = [
  './',
  './index.html',
  './manifest.json',
  './css/design-system.css',
  './css/layout.css',
  './css/components.css',
  './css/animations.css',
  './js/app.js',
  './js/ui/router.js',
  './js/ui/components.js',
  './js/ui/notifications.js',
  './js/modules/auth.js',
  './js/modules/upload.js',
  './js/modules/extractor.js',
  './js/modules/classifier.js',
  './js/modules/overview.js',
  './js/modules/analysis.js',
  './js/modules/logger.js',
  './js/services/templateService.js',
  './js/data/store.js',
  './js/data/lines.js',
  './js/data/quotes.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Never cache API calls — always hit the network
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        if (!res.ok) return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
