/* NEXUS Service Worker — offline cache */
const CACHE_NAME = 'nexus-v4';
const ASSET_NAMES = [
  '',
  'index.html',
  'css/nexus.css',
  'js/app.js',
  'js/i18n.js',
  'js/brain-canvas.js',
  'js/brain-chat.js',
  'js/brain-list.js',
  'js/brain-events.js',
  'js/cleaning.js',
  'js/log.js',
  'js/board.js',
  'js/calendar.js',
  'js/admin.js',
  'beacon-audio.mp3'
];

// Install — cache static assets relative to scope
self.addEventListener('install', event => {
  const base = self.registration.scope;
  const urls = ASSET_NAMES.map(a => base + a);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urls).catch(err => {
        console.warn('SW: some assets failed to cache', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.hostname.includes('supabase') ||
      url.hostname.includes('anthropic') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('google.com') ||
      url.hostname.includes('elevenlabs') ||
      url.hostname.includes('cdnjs.cloudflare.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match(self.registration.scope + 'index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
