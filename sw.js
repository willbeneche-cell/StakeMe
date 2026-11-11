/* StakeMe — service worker
   Permet l'installation Android/iOS et un démarrage hors-ligne du shell.
   Incrémenter VERSION à chaque mise à jour d'assets. */
const VERSION = 'stakeme-v1';

const SHELL = [
  './index.html',
  './manifest.json',
  './assets/app.css',
  './js/app.js',
  './js/core.js',
  './js/games/chicken.js',
  './js/games/mines.js',
  './js/games/crash.js',
  './js/games/dice.js',
  './assets/brand/jeu-poule.svg',
  './assets/brand/jeu-mines.svg',
  './assets/brand/jeu-crash.svg',
  './assets/brand/jeu-dice.svg',
  './assets/pwa/icon-192.png',
  './assets/pwa/icon-512.png',
  './assets/pwa/apple-touch-icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Navigation : réseau d'abord, coquille en cache hors-ligne.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Assets (y compris CDN) : cache immédiat, mise à jour en arrière-plan.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
