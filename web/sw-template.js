// Service worker de la Cinémathèque (généré au build : voir vite.config.ts).
// - Interface : précachée, servie hors ligne. Navigation : réseau d'abord, index.html en secours.
// - Images (/images) : cache d'abord, gardées pour les affiches hors ligne (plafond 800).
// - Catalogue (/api/movies, fiches, réglages) : réseau d'abord, dernière copie en secours hors ligne.
// - Le reste de l'API, flux vidéo, sous-titres : jamais mis en cache (toujours le réseau).
const VERSION = '__VERSION__';
const SHELL = `cine-shell-${VERSION}`;
const IMAGES = 'cine-images-v1';
const DATA = 'cine-data-v1';
const DATA_PATHS = /^\/api\/(movies(\/\d+)?|settings)$/;
const PRECACHE = __PRECACHE__;
const MAX_IMAGES = 800;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('cine-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_IMAGES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (DATA_PATHS.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dev/') || req.headers.has('range')) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match('/index.html')) ?? Response.error()));
    return;
  }
  if (url.pathname.startsWith('/images/')) {
    e.respondWith((async () => {
      const cache = await caches.open(IMAGES);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { cache.put(req, res.clone()); trim(cache); }
      return res;
    })());
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
});
