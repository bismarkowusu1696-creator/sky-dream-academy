let pushMessaging = null;
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyDlj6cyl4Ul__DS6Bp-sIlC6K3cDoiYVvE',
    authDomain: 'skydream-academy.firebaseapp.com',
    projectId: 'skydream-academy',
    storageBucket: 'skydream-academy.firebasestorage.app',
    messagingSenderId: '394576038705',
    appId: '1:394576038705:web:2d055fb58a02c4b7cafe10'
  });
  pushMessaging = firebase.messaging();
  pushMessaging.onBackgroundMessage(payload => {
    const data = payload && payload.data || {};
    const title = data.title || 'SkyDream Skills Training Academy';
    return self.registration.showNotification(title, {
      body: data.body || 'You have a new SkyDream message.',
      icon: '/skydream-app-icon-512.png',
      badge: '/skydream-app-icon-v3.png',
      tag: 'skydream-student-message',
      renotify: true,
      data: { url: data.url || '/student-portal#portalMessages' }
    });
  });
} catch (err) {
  console.warn('Firebase Messaging could not initialize in the service worker.', err);
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/student-portal#portalMessages', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin)) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

const CACHE_NAME = 'skydream-pwa-v34';
const PUBLIC_SHELL = [
  '/',
  '/programs',
  '/schedule',
  '/about',
  '/contact',
  '/register',
  '/check-status',
  '/student-portal',
  '/privacy',
  '/terms',
  '/assets/site.css',
  '/assets/public.js',
  '/assets/schedule-live.js',
  '/assets/student-portal.js',
  '/assets/offline.js',
  '/assets/print.css',
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
  '/assets/student-portal.js',
  '/student-portal',
  '/manifest.webmanifest'
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(
      PUBLIC_SHELL.map(async path => {
        const response = await fetch(path, { cache: 'reload' });
        if (!response.ok) throw new Error(`Failed to precache ${path}: ${response.status}`);
        await cache.put(path, response);
      })
    );
    await self.skipWaiting();
  })());
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
  if (url.pathname === '/pwa.js' || url.pathname === '/firebase-messaging-sw.js') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Never serve authentication/security/admin/student scripts or admin styling from an old PWA cache.
  if ([
    '/assets/firebase.js',
    '/assets/admin.js',
    '/assets/admin-registration.js',
    '/assets/admin-pin.js',
    '/assets/admin-intake.js',
    '/assets/admin-suite.js',
    '/assets/admin-extra-actions.js',
    '/assets/admin-enterprise-login.js',
    '/assets/admin-enterprise.js',
    '/assets/admin-suite.css',
    '/assets/facilitator.js'
  ].includes(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Never cache authenticated entry points or dashboards.
  if (['/staff.html', '/staff', '/admin.html', '/admin', '/facilitator.html', '/facilitator'].includes(url.pathname)) return;

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
