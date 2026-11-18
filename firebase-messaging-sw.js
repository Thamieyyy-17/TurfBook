/* Firebase Cloud Messaging background worker for the TurfBook web app. */
importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAcRElU1dM4sK-TQm27WxKjY6-sSbC473E',
  authDomain: 'turfbook-966bc.firebaseapp.com',
  projectId: 'turfbook-966bc',
  storageBucket: 'turfbook-966bc.firebasestorage.app',
  messagingSenderId: '1075698646026',
  appId: '1:1075698646026:web:16660ff9c641e6228fb3',
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'TurfBook update';
  const options = {
    body: payload.notification?.body || 'You have a new notification.',
    icon: '/icon.png',
    badge: '/icon.png',
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
