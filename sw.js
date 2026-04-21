/* NEXUS Service Worker — v2
   Strategy: network-first for JS/CSS (always get latest code),
             cache-first for HTML shell + fonts.
   Version bumped = full re-cache on next load.
*/
const CACHE_NAME = 'nexus-v17';

// App shell — everything needed to run offline
const APP_SHELL = [
  './',
  './index.html',
  './css/nexus.css',
  './css/galaxy.css',
  './css/equipment.css',
  './css/equipment-fixes.css',
  './css/equipment-context-menu.css',
  './css/equipment-public-pm.css',
  './css/file-picker.css',
  './js/app.js',
  './js/admin.js',
  './js/galaxy.js',
  './js/ai-writer.js',
  './js/equipment.js',
  './js/equipment-ai.js',
  './js/equipment-public-scan.js',
  './js/equipment-fixes.js',
  './js/equipment-cleanup.js',
  './js/equipment-context-menu.js',
  './js/equipment-brain-sync.js',
  './js/equipment-badge-choice.js',
  './js/equipment-public-pm.js',
  './js/file-picker.js',
  './js/i18n.js',
  './js/brain-chat.js',
  './js/brain-events.js',
  './js/brain-list.js',
  './js/board.js',
  './js/calendar.js',
  './js/cleaning.js',
  './js/log.js',
  './js/native-bridge.js'
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
      console.log('[SW v2] Caching app shell');
      return cache.addAll(APP_SHELL).then(() => {
        return Promise.allSettled(
          CDN_CACHE.map(url => cache.add(url).catch(() => console.warn('[SW] CDN skip:', url)))
        );
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate — NUKE all old caches (this is what kills stuck old versions)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW v2] Deleting old cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// Fetch — smart strategy depending on resource type
self.addEventListener('fetch', event => {
  // CRITICAL: blob: and data: URLs must pass through without SW interception.
  // The public-scan loader uses blob URLs to inject code, and if the SW tries
  // to intercept them, the script loads as empty. Also: about:, chrome-extension:, etc.
  const reqUrl = event.request.url;
  if (reqUrl.startsWith('blob:') || reqUrl.startsWith('data:') || 
      reqUrl.startsWith('chrome-extension:') || reqUrl.startsWith('about:')) {
    return; // Let browser handle natively
  }

  const url = new URL(reqUrl);

  // Never cache Supabase API, Anthropic API, or ElevenLabs calls
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('anthropic.com') ||
      url.hostname.includes('elevenlabs.io') ||
      url.hostname.includes('googleapis.com/gmail')) {
    return; // Let browser handle normally (network only)
  }
  
  // Cache-bust: if URL has ?v= param, bypass cache entirely and fetch fresh.
  // Used by the public-scan loader to guarantee latest code.
  if (url.searchParams.has('v')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // ─── NETWORK-FIRST for JS / CSS / HTML ──────────────────────────
  // Always try to fetch the latest code. Fall back to cache only if offline.
  // This is what prevents the "old cached code" problem.
  const isCode = /\.(js|css|html)($|\?)/.test(url.pathname) ||
                 url.pathname === '/' ||
                 url.pathname.endsWith('/nexus/') ||
                 url.pathname.endsWith('/nexus');
  if (isCode && url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then(cached =>
          cached || new Response('<h1>NEXUS Offline</h1><p>No cached version available. Connect to WiFi to load.</p>', {
            headers: { 'Content-Type': 'text/html' }
          })
        )
      )
    );
    return;
  }

  // ─── CACHE-FIRST for everything else (fonts, images, CDN) ───────
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
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
      for (const client of windowClients) {
        if (client.url.includes('nexus') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(event.notification.data?.url || '/');
    })
  );
});

// Listen for skip-waiting message (manual update trigger)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
