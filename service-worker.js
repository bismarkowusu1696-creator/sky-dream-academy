const CACHE_NAME = 'skydream-pwa-v7';
const PUBLIC_SHELL = [
  '/',
  '/index.html',
  '/programs.html',
  '/schedule.html',
  '/about.html',
  '/contact.html',
  '/register.html',
  '/check-status.html',
  '/privacy.html',
  '/terms.html',
  '/assets/site.css',
  '/assets/firebase.js',
  '/assets/public.js',
  '/manifest.webmanifest',
  '/skydream-app-icon-v3.png',
  '/skydream-app-icon-v3.svg',
  '/logo.png',
  '/offline.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PUBLIC_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache staff dashboards. Their HTML does not contain records, but
  // keeping protected surfaces out of offline caches is safer and clearer.
  if (url.pathname === '/admin.html' || url.pathname === '/facilitator.html') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/offline.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }))
  );
});
