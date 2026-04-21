/* NEXUS Service Worker — v3
   Strategy: network-first for JS/CSS (always get latest code),
             cache-first for HTML shell + fonts.
   Version bumped = full re-cache on next load.
*/
const CACHE_NAME = 'nexus-v3';

// App shell — everything needed to run offline
const APP_SHELL = [
  './',
  './index.html',
  // ── CSS ──
  './css/nexus.css',
  './css/galaxy.css',
  './css/equipment.css',
  './css/equipment-fixes.css',
  './css/equipment-context-menu.css',
  './css/equipment-public-pm.css',
  './css/file-picker.css',
  // ── JS (eager — loaded in index.html) ──
  './js/i18n.js',
  './js/app.js',
  './js/native-bridge.js',
  './js/file-picker.js',
  './js/equipment-public-scan.js',
  './js/equipment-public-pm.js',
  // ── JS (lazy — loaded on demand by app.js) ──
  './js/admin.js',
  './js/galaxy.js',
  './js/ai-writer.js',
  './js/brain-chat.js',
  './js/brain-events.js',
  './js/brain-list.js',
  './js/board.js',
  './js/calendar.js',
  './js/cleaning.js',
  './js/log.js',
  './js/equipment.js',
  './js/equipment-ai.js',
  './js/equipment-cleanup.js',
  './js/equipment-context-menu.js',
  './js/equipment-brain-sync.js',
  './js/equipment-badge-choice.js'
];

// CDN resources to cache (fonts, icons, libs)
const CDN_CACHE = [
  'https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js',
  'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap'
];

// Install — cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW v3] Caching app shell');
      // Use allSettled so one missing file doesn't nuke the whole install
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(err => console.warn('[SW] skip:', url, err.message)))
      ).then(() => Promise.allSettled(
        CDN_CACHE.map(url => cache.add(url).catch(() => console.warn('[SW] CDN skip:', url)))
      ));
    }).then(() => self.skipWaiting())
  );
});

// Activate — NUKE all old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW v3] Deleting old cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// Fetch — smart strategy depending on resource type
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache API calls
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('anthropic.com') ||
      url.hostname.includes('elevenlabs.io') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('accounts.google.com')) {
    return;
  }

  // ─── NETWORK-FIRST for JS / CSS / HTML ──────────────────────────
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

// Push notifications
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

// Notification click — open app
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

// Manual skip-waiting trigger
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
