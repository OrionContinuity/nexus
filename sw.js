/* NEXUS Service Worker — offline cache */
const CACHE_NAME = 'nexus-v1';
const STATIC_ASSETS = [
  '/nexus/',
  '/nexus/index.html',
  '/nexus/css/nexus.css',
  '/nexus/js/app.js',
  '/nexus/js/i18n.js',
  '/nexus/js/brain-canvas.js',
  '/nexus/js/brain-chat.js',
  '/nexus/js/brain-list.js',
  '/nexus/js/brain-events.js',
  '/nexus/js/cleaning.js',
  '/nexus/js/log.js',
  '/nexus/js/board.js',
  '/nexus/js/admin.js',
  '/nexus/beacon-audio.mp3'
];

// Install — cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
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
  
  // Never cache API calls
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
        // Cache successful responses
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — try cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Return offline page for navigation
          if (event.request.mode === 'navigate') {
            return caches.match('/nexus/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
