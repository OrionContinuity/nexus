/* NEXUS Service Worker — Cache Everything
   Strategy: Cache-first for app shell, network-first for API calls
   Version bumped = full re-cache on next load
*/
const CACHE_NAME = 'nexus-v1';

// App shell — everything needed to run offline
const APP_SHELL = [
  './',
  './index.html',
  './css/nexus.css',
  './js/app.js',
  './js/admin.js',
  './js/brain-canvas.js',
  './js/brain-chat.js',
  './js/brain-events.js',
  './js/brain-list.js',
  './js/board.js',
  './js/calendar.js',
  './js/cleaning.js',
  './js/log.js',
  './js/native-bridge.js',
  './js/i18n.js'
];

// CDN resources to cache (fonts, icons, libs)
const CDN_CACHE = [
  'https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&display=swap'
];

// Install — cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell');
      // Cache app files (don't fail install if CDN is slow)
      return cache.addAll(APP_SHELL).then(() => {
        // Try CDN resources but don't block install
        return Promise.allSettled(
          CDN_CACHE.map(url => cache.add(url).catch(() => console.warn('[SW] CDN skip:', url)))
        );
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for app shell, network-first for API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache Supabase API, Anthropic API, or ElevenLabs calls
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('anthropic.com') ||
      url.hostname.includes('elevenlabs.io') ||
      url.hostname.includes('googleapis.com/gmail')) {
    return; // Let browser handle normally (network only)
  }

  // For app shell and static assets: cache-first, update in background
  event.respondWith(
    caches.match(event.request).then(cached => {
      // Return cache immediately if available
      const fetchPromise = fetch(event.request).then(response => {
        // Only cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Network failed — if we have cache, it was already returned
        // If no cache either, return offline fallback
        if (!cached) {
          return new Response('<h1>NEXUS Offline</h1><p>No cached version available. Connect to WiFi to load.</p>', {
            headers: { 'Content-Type': 'text/html' }
          });
        }
      });

      // Return cached version immediately, fetch updates in background
      return cached || fetchPromise;
    })
  );
});

// Listen for push notifications
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'NEXUS', {
      body: data.body || 'New notification',
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

// Handle notification click — open app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url.includes('nexus') && 'focus' in client) return client.focus();
      }
      // Otherwise open new window
      return clients.openWindow(event.notification.data?.url || '/');
    })
  );
});
