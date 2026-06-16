const CACHE = 'reading-highlight-v1';

function should_cache(url) {
  return url.endsWith('.mp3') || url.endsWith('/abou-ben-adhem.json');
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !should_cache(e.request.url)) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      // ponytail: clone before put; can't read a Response body twice.
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
      return res;
    }),
  );
});
