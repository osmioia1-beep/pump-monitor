'use strict';
const OFFLINE_CACHE = 'pump-monitor-offline-v1';
const OFFLINE_PAGE = '/offline.html';

self.addEventListener('install', event => {
    event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.addAll([
        OFFLINE_PAGE, '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'
    ])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith('pump-monitor-offline-') && key !== OFFLINE_CACHE)
            .map(key => caches.delete(key))
    )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
    if (['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'].includes(url.pathname)) {
        event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
        return;
    }
    if (event.request.mode !== 'navigate') return;
    event.respondWith(fetch(event.request).then(response => {
        if (response.ok) return response;
        return caches.match(OFFLINE_PAGE).then(fallback => fallback || response);
    }).catch(() => caches.match(OFFLINE_PAGE)));
});
