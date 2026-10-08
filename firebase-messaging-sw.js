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

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const data = payload && payload.data || {};
  const title = data.title || 'SkyDream Skills Training Academy';

  return self.registration.showNotification(title, {
    body: data.body || 'You have a new SkyDream message.',
    icon: '/skydream-app-icon-512.png',
    badge: '/skydream-app-icon-v3.png',
    tag: 'skydream-student-message',
    renotify: true,
    data: {
      url: data.url || '/student-portal#portalMessages'
    }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/student-portal#portalMessages',
    self.location.origin
  ).href;

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
