// sw.js — сервис-воркер PWA.
// Стратегия простая и безопасная для домашнего приложения:
//   • запросы к /api/ — только сеть (данные всегда свежие, кэшировать нельзя);
//   • статика — сеть с запасным вариантом из кэша (офлайн покажет оболочку).
// При изменении статики достаточно поднять версию CACHE.

const CACHE = 'jet-budget-v1';

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// Установка: кладём оболочку приложения в кэш
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

// Активация: удаляем кэши старых версий
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API не кэшируем никогда — только живые данные
  if (url.pathname.startsWith('/api/')) return;

  // Статика: сначала сеть (чтобы подхватывать обновления),
  // при неудаче — кэш (офлайн-режим)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
