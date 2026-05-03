/* NEXUS Service Worker — v10
   Strategy: network-first for JS/CSS/HTML (always fresh code),
             cache-first for fonts, images, icons, assets.
   Version bumped = full re-cache on next load.
   
   What changed v9 → v10:
   - Added all current JS modules (was missing 12 files)
   - Added all current CSS files (was missing 8 files)
   - Added coin assets so they're available offline
   - Added manifest.json + icons to shell
*/
const CACHE_NAME = 'nexus-v10';

// ─── App shell — everything needed to run offline ─────────────────
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',

  // Coin assets — masthead + login render flicker-free if these are cached
  './assets/coin-trajan.png',
  './assets/coin-providentia.png',

  // CSS — all of them
  './css/nexus.css',
  './css/nx-system.css',
  './css/home.css',
  './css/chat.css',
  './css/composer.css',
  './css/galaxy.css',
  './css/equipment.css',
  './css/equipment-fixes.css',
  './css/equipment-context-menu.css',
  './css/equipment-public-pm.css',
  './css/equipment-public-pm-system.css',
  './css/equipment-card-polish.css',
  './css/equipment-system.css',
  './css/views-system.css',
  './css/board-system.css',
  './css/admin-system.css',
  './css/ingest-system.css',
  './css/file-picker.css',

  // JS — all current modules
  './js/app.js',
  './js/admin.js',
  './js/ai-writer.js',
  './js/board.js',
  './js/brain-chat.js',
  './js/brain-chat-memory.js',
  './js/brain-events.js',
  './js/brain-list.js',
  './js/calendar.js',
  './js/chat-view.js',
  './js/cleaning.js',
  './js/composer.js',
  './js/config.js',
  './js/equipment.js',
  './js/equipment-ai.js',
  './js/equipment-badge-choice.js',
  './js/equipment-brain-sync.js',
  './js/equipment-cleanup.js',
  './js/equipment-context-menu.js',
  './js/equipment-public-pm.js',
  './js/equipment-public-scan.js',
  './js/file-picker.js',
  './js/galaxy.js',
  './js/home.js',
  './js/i18n.js',
  './js/log.js',
  './js/native-bridge.js',
  './js/translate.js',
];

// ─── CDN resources to cache (fonts, icons, libs) ──────────────────
const CDN_CACHE = [
  'https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
];

// ─── INSTALL — cache the app shell ────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW v10] Caching app shell');
      // Use allSettled so one bad file doesn't poison the whole install
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(err => {
          console.warn('[SW v10] Skip:', url, err.message);
        }))
      ).then(() =>
        Promise.allSettled(
          CDN_CACHE.map(url => cache.add(url).catch(() => console.warn('[SW] CDN skip:', url)))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE — nuke old caches ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW v10] Deleting old cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH — smart strategy depending on resource type ────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache live API calls
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('anthropic.com') ||
      url.hostname.includes('elevenlabs.io') ||
      url.hostname.includes('googleapis.com/gmail')) {
    return; // Let browser handle normally (network only)
  }

  // ─── NETWORK-FIRST for JS / CSS / HTML ──────────────────────────
  // Always try latest code. Fall back to cache only if offline.
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

// ─── PUSH NOTIFICATIONS ────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch (_) {
    try {
      data = { title: 'NEXUS', body: event.data?.text() || 'New notification' };
    } catch (__) {
      data = { title: 'NEXUS', body: 'New notification' };
    }
  }

  const isHigh = data.priority === 'high';

  const opts = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag,
    renotify: !!data.tag && isHigh,
    data: data.data || {},
    requireInteraction: isHigh,
    vibrate: isHigh ? [200, 100, 200, 100, 200] : [100],
    silent: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'NEXUS', opts)
  );
});

// ─── NOTIFICATION CLICK ───────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};

  const view = data.view || '';
  const entityId =
    data.equipment_id || data.pattern_id || data.dispatch_id || '';
  const params = new URLSearchParams();
  if (view) params.set('view', view);
  if (entityId) params.set('id', String(entityId));
  if (data.alert_type) params.set('alert', data.alert_type);
  const targetUrl = params.toString() ? `/?${params}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url.includes(self.location.host) && 'focus' in client) {
            client.postMessage({
              type: 'nexus-notification-click',
              view, entityId, alertType: data.alert_type, raw: data,
            });
            return client.focus();
          }
        }
        return clients.openWindow(targetUrl);
      })
  );
});

// ─── SKIP-WAITING (manual update trigger) ─────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
