const CACHE_NAME = 'skydream-pwa-v25';
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
  '/assets/public.js',
  '/assets/schedule-live.js',
  '/manifest.webmanifest',
  '/logo.png',
  '/skydream-app-icon-v3.png',
  '/skydream-app-icon-512.png',
  '/offline.html'
];

const FRESH_PUBLIC_ASSETS = new Set([
  '/assets/site.css',
  '/assets/public.js',
  '/assets/schedule-live.js',
  '/manifest.webmanifest'
]);

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

async function refreshCache(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return null;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Always fetch layout bootstrap fresh so header/responsive fixes take effect immediately.
  if (url.pathname === '/pwa.js') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Never serve authentication/security/admin/student scripts or admin styling from an old PWA cache.
  if ([
    '/assets/firebase.js',
    '/assets/admin.js',
    '/assets/admin-pin.js',
    '/assets/admin-intake.js',
    '/assets/admin-suite.js',
    '/assets/admin-extra-actions.js',
    '/assets/admin-enterprise-login.js',
    '/assets/admin-enterprise.js',
    '/assets/admin-academic.js',
    '/assets/admin-suite.css',
    '/assets/facilitator.js',
    '/assets/student-portal.js'
  ].includes(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Never cache authenticated entry points or dashboards.
  if (['/staff.html', '/staff', '/admin.html', '/admin', '/facilitator.html', '/facilitator', '/student-portal.html', '/student-portal'].includes(url.pathname)) return;

  if (FRESH_PUBLIC_ASSETS.has(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const update = refreshCache(request);
      if (cached) {
        event.waitUntil(update);
        return cached;
      }
      return (await update) || new Response('', { status: 504 });
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const update = refreshCache(request);
      if (cached) {
        event.waitUntil(update);
        return cached;
      }
      const fresh = await update;
      return fresh || (await caches.match('/offline.html'));
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fresh = await refreshCache(request);
    return fresh || new Response('', { status: 504 });
  })());
});
