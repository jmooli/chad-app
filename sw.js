/**
 * Service worker: app shell only.
 *
 * Deliberately narrow. Nothing from api.github.com is ever cached — personal
 * data must not linger in a browser cache, and a doctor must never be shown a
 * stale reading because the network was slow.
 */

const VERSION = 'chad-shell-v4';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/github.js',
  './js/format.js',
  './js/schema.js',
  './js/store.js',
  './js/stats.js',
  './js/chart.js',
  './js/chartview.js',
  './js/ui.js',
  './js/views/setup.js',
  './js/views/today.js',
  './js/views/plan.js',
  './js/views/progress.js',
  './js/views/log.js',
  './js/views/clinical.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never touch the data API — always straight to the network.
  if (url.hostname !== self.location.hostname) return;
  if (e.request.method !== 'GET') return;

  // Network-first so a deployed fix reaches the phone without a hard reload,
  // falling back to the cached shell when offline (the gym basement case).
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))),
  );
});
