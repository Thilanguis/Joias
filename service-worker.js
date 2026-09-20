// Estrutura adaptada do service worker do Buraco Findom.
const CACHE_NAME = 'joias-findom-v40-dev-controls';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './characters.js',
  './pix.js',
  './firebase.js',
  './styles.css',
  './jewel-theme.css',
  './hud.css',
  './assets/characters/prism.webp',
  './assets/characters/chaos.webp',
  './assets/characters/time.webp',
  './assets/characters/demolition.webp',
  './gems.svg',
  './manifest.json',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './audio/gem-match.mp3',
  './audio/bomb.mp3',
  './audio/clock.mp3',
  './audio/extra-move.mp3',
  './audio/crown.mp3',
  './audio/cash.mp3',
  './audio/devil.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of ASSETS) {
        try { await cache.add(url); }
        catch (error) { console.error('[SW] Falha ao cachear recurso:', url, error); }
      }
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function unavailableResponse() {
  return new Response('Recurso offline indisponível.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' }),
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const isAppCode = /\.(?:css|html|js|json|webmanifest)$/i.test(url.pathname);

  if (isNavigation || isAppCode) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cacheKey = isNavigation ? './index.html' : request;
            const cache = await caches.open(CACHE_NAME);
            await cache.put(cacheKey, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = isNavigation ? await caches.match('./index.html') : await caches.match(request);
          return cached || unavailableResponse();
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(() => unavailableResponse())),
  );
});
