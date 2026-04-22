/* NEXUS Service Worker — v4
   Strategy: network-first for JS/CSS (always get latest code),
             cache-first for HTML shell + fonts.
   Version bumped = full re-cache on next load.
*/
const CACHE_NAME = 'nexus-v4';

// App shell — everything needed to run offline
const APP_SHELL = [
  './',
  './index.html',
  './css/nexus.css',
  './js/app.js',
  './js/admin.js',
  './js/galaxy.js',           // replaced brain-canvas.js
  './js/ai-writer.js',        // new
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
      console.log('[SW v4] Caching app shell');
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
        console.log('[SW v4] Deleting old cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// Fetch — smart strategy depending on resource type
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache Supabase API, Anthropic API, or ElevenLabs calls
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('anthropic.com') ||
      url.hostname.includes('elevenlabs.io') ||
      url.hostname.includes('googleapis.com/gmail')) {
    return; // Let browser handle normally (network only)
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

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────
// Decrypted by the browser automatically — we just read the JSON.
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
    tag: data.tag,                   // collapses repeats with same tag
    renotify: !!data.tag && isHigh,  // only re-buzz on high-priority same-tag
    data: data.data || {},
    requireInteraction: isHigh,      // high-priority stays until user dismisses
    vibrate: isHigh ? [200, 100, 200, 100, 200] : [100],
    silent: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'NEXUS', opts)
  );
});

// ── NOTIFICATION CLICK ───────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};

  // Build a deep-link URL based on the alert's view + entity
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
        // If app is already open, focus it and tell it to navigate.
        // Otherwise open a fresh window at the deep link.
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

// Listen for skip-waiting message (manual update trigger)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
