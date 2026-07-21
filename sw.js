/* NEXUS Service Worker — version lives in CACHE_NAME below (single source of truth) — do not hand-edit a version here.
   Strategy: network-first for JS/CSS/HTML (always fresh code),
             cache-first for fonts, images, icons, assets.
   Version bumped = full re-cache on next load.

   What changed v25 → v26:
   - TOOLS ROW added to Equipment view header. Four pill buttons:
     Contractors / Parts / Analytics / Brands — wired to the existing
     module overlays that previously had no UI surface (console-only).
   - LIFECYCLE PILL fix: removed the .eq-table-uniform optimization
     that was hiding the status column when all units were operational.
     The lifecycle pill is the visual heartbeat — it must always render.
   - On mobile, the pill compresses to a glowing 22px circular badge
     (label hidden, dot + glow + animation preserved) so it fits.
   - LIGHTBULB color metaphor across all states (gold-only): bright
     glow when operational, simple fading breath when in progress,
     irregular dying-bulb flicker when down.

   What changed v24 → v25:
   - OVERFLOW MENU enriched. The detail action bar's ⋯ overflow on
     each piece of equipment now mirrors the long-press dial actions
     plus the legacy management items, organized in two labeled
     sections:
       Operate — Log Service · Issue Tracker · View Parts
       Manage  — Edit Everything · Schedule PM · Print Label
       Danger  — Delete permanently
     Section labels use the gold mono kicker style. Same Edit
     Everything that lived there before is preserved alongside the
     visible Edit pill in the action bar.
   - schedulePmFromOverflow helper added to NX.modules.equipment so
     a single equipment can have its PM scheduled without entering
     bulk mode first.

   What changed v23 → v24:
   - PARTS COMPATIBILITY BULK-APPLY — the "this part fits 9 Zumex
     units" use case. The compatibility tab gets a gold "Pick multiple
     equipment" button alongside the existing one-at-a-time dropdown.
     Opens a bottom sheet with checkboxes for every eligible unit.
     Same-brand units float to the top with a SAME BRAND badge (most
     likely candidates for sharing OEM parts). Multi-select + "Apply
     to N equipment" updates compatible_equipment_ids in one go.

   What changed v22 → v23:
   - EDIT EQUIPMENT made discoverable. The full 6-tab editor (Basic /
     Specs / Photos / Attachments / Links / Custom Fields) was always
     wired but buried in the ⋯ overflow menu.
       • Visible gold "Edit" pill in the detail action bar, between
         Report Issue and the overflow disc — uses pen icon, gold-mist
         tint, distinct from the primary Call Service gradient.
       • At <420px width, secondary + edit CTAs collapse to icon-only
         52px discs to fit alongside the primary on one row.
       • Long-press dial gets a 6th action ("Edit equipment") so
         editing is reachable in 2 taps from the equipment list
         without drilling into detail first.

   What changed v21 → v22:
   - PARTS CATALOG OVERLAY — fleet-wide browsing of every replaceable
     part across all equipment. Three-tab detail per part:
       Overview — photo upload, name, OEM, qty, supplier + URL +
                  price + lead time, replacement schedule with
                  next-due banner, notes, delete
       History — vertical timeline of every replacement event
                  (date, cost, vendor, who) with "latest" badge
       Compatibility — primary equipment + cross-equipment fit list,
                        add/remove via dropdown
     Schema additions (graceful degrade): photo_url, lead_time_days,
     replacement_interval_months, last_replaced_at, replacement_history,
     compatible_equipment_ids.
   - Mark-replaced action stamps last_replaced_at, prompts cost +
     supplier, appends to replacement_history, and auto-logs an
     equipment_maintenance row for timeline visibility.
   - Long-press dial gets a 5th action ("View parts") that opens the
     parts catalog scoped to the held equipment.

   What changed v20 → v21:
   - LONG-PRESS ACTION DIAL — hold any equipment row for 1 second to
     open an expanding speed-dial with bulk-select, report-issue,
     schedule-PM, and email-contractor actions. Mirrors the duties
     speed-dial visual idiom (stacked label-chip + 52px gold-circle
     rows above the bottom nav, staggered slide-up animation).
   - Visual feedback during the hold: gold progress ring fills around
     the touch point, row visually compresses, haptic vibration when
     threshold reached. Move >10px or release early to cancel.
   - Bulk mode + tap-to-select wired into the existing row click
     handler — once the dial enters bulk mode, taps toggle selection
     instead of opening detail.
   - LIFECYCLE STATUS PILL — replaces the static OPERATIONAL pill.
     Glowing green when operational, ghost outline when down (no
     color, dim). When an issue is logged, the lifecycle state
     takes over the pill: REPORTED (amber), CONTRACTOR CALLED (gold),
     ETA SET (cool blue with time), IN PROGRESS (vibrant green pulsing),
     AWAITING PARTS (orange). Each equipment row's _openIssue is
     attached at load time so list/grid/detail all reflect state
     consistently.
   - CONTRACTORS overlay — full management workspace. List view with
     search + per-contractor cards showing phone, specialties, last
     activity. Tap into detail view with stats strip (assigned,
     calls YTD, avg response time, $YTD), three tabs:
       Activity — chronological feed of every maintenance + issue
                  this contractor has handled, grouped by month
       Equipment — currently assigned + previously serviced
       Edit — full form: name, phone, email, specialties, notes
     Add/delete/save/call/email all wired. Stats derived from
     equipment_maintenance + equipment_issues + nodes joins.

   What changed v19 → v20:
   - LIFECYCLE STATUS PILL — replaces the static OPERATIONAL pill.
     Glowing green when operational, ghost outline when down. Issue
     lifecycle states (REPORTED, CONTRACTOR CALLED, ETA SET, IN PROGRESS,
     AWAITING PARTS) take over the pill with state-appropriate colors
     and animations.
   - CONTRACTORS — full management overlay with list view, search, and
     three-tab detail (Activity feed, Equipment assignments, Edit form).
     Single bulk fetch backs all views.

   What changed v18 → v19:
   - FLEET INTELLIGENCE ANALYTICS — 4-tab dashboard. Single
     computeFleetSnapshot computation backs all four views.
       • Brand Health — per-manufacturer dashboard with units, %
         operational, $YTD spend, calls/unit, health bar
       • Patterns — cross-fleet failure clustering. 50%+ of
         brand+model cohort hit by same failure mode flags as a
         pattern with avg-age-at-failure + recommended preventive
         PM window. Tap "Schedule PM for all N units" pre-seeds bulk
         selection and opens the bulk-PM sheet.
       • Warranty — units expiring 0–90d (or just-expired last 30d),
         bucketed by urgency with colored borders.
       • Digest — Sunday-night-ready owner email with fleet stats,
         open issues by status, warranty alerts, top patterns, and
         brand-spend leaderboard. One-tap email or copy to clipboard.

   What changed v17 → v18:
   - Manufacturers / brand library: dedicated table, FK on equipment,
     three-mode logo render (image, hue, hash-auto). One brand =
     one logo applied across list view, grid view, brand library.
   - Auto-link manufacturer text to brand record on every save path
     (manual create, AI create, data plate scan, AI bulk extract).
   - Brand library overlay with file picker, hue swatches, live preview.

   What changed v16 → v17:
   - Equipment Issue Tracker — full lifecycle (reported → contractor
     called → ETA → in progress → repaired) with awaiting_parts side-
     branch. Mirrors the order detail's lifecycle pattern.
   - Auto-generated contractor emails — pulls preferred contractor's
     email + builds structured request body. Auto-advances lifecycle
     to "contractor called" on send.
   - Bulk operations on equipment: enterBulkMode/exitBulkMode +
     bottom toolbar with assign-contractor and schedule-PM bulk
     actions. Selection mode toggles is-selected class with gold
     checkmark, contractor sheet auto-fills phone from node record.

   What changed v15 → v16:
   - Vendor sort: Alphabetical / Custom / Recently used / Most ordered
     with persisted localStorage preference.
   - Custom drag-to-reorder vendors with pointer events, persisted to
     new sort_order column.
   - Multi-email recipients (CC / BCC / ALT) with kind-cycling badges
     in vendor editor; CC/BCC auto-included in mailto: send URL.
   - Fixed wonky + button — plusIcon(true) suppresses inline margin
     when used standalone in circular buttons; SVG bumped to 20px.
   - Theme button icon fix: 'circle-half' → 'contrast' (Lucide name).
   - openVendorEditor bug fix: was being called with vendor.id from
     vendor-detail edit button, causing "undefined uuid" errors.
*/

/*
   What changed v10 → v15:
   - Ordering pane buildout: vendor detail overlay, recent-orders
     pagination (3 → 10 → paginate), date dividers, draft state
     highlighting, brand-color picker, vendor pin, photo upload @ 384px,
     order detail view (read-only) with REPORT ISSUES + Reorder.
   - Order lifecycle state machine (draft → sent → confirmed →
     delivered → closed) with timeline + transition buttons.
   - Sender attribution: created_by_name + sent_by_name stamped on
     every order, surfaced in detail header.
   - Issue flag (orthogonal to status) with amber banner + ISSUE pill
     on vendor cards.
   - Activity preview lines on vendor cards distinguish all 5
     lifecycle states + issue state.
   - Theme bug fixes: bottom-nav theming, 10 hardcoded dark rgba
     replaced with tokens, speed-dial render bug (dual conflicting
     CSS blocks deleted).
   - Cleaning view UX overhaul: top tabs removed, bottom action bar
     redesigned (48px equal-height buttons), race condition fixed
     in pane wiring.

   v281 — THE COUNCIL'S SECOND ROUND (2026-07-11, keeper's word:
   "full on build. permission granted."):
   - Providentia's arc: pantheon-voice now records a structured reading
     {open, overdue, aging30, unfiled, unowned, undated, done_fresh,
     eq_down, by_loc} every time a god speaks; her past readings are fed
     back to her so she speaks in trends. Her chip shows the arc line.
   - Trajan's pulse + trust: a daily factual counts line and a weekly
     0-100 trust-number (transparent penalties), both under his word in
     Ask NEXUS. His eyes fixed too — v1 counted done cards as open
     (neq.Done vs lowercase 'done').
   - Unowned lens on the board — Trajan's ask: "every open card should
     name whose hand, by when." Muted chip, live count, only when needed.
   - Kind notes (Clippy's ask: "voice, not tasks") — public.kind_notes +
     a quiet Home card; teammates leave kind words, @name hands one over.
   - Cleaning auto-escalator now sets location (the leak that birthed
     houseless cards #933/#934).

   v282 — ACCUMULATE UNTIL SENT (2026-07-11, Alfredo: "If I don't send
   out the daily notes, allow the tickets and info to accumulate until
   it is sent out."):
   - dlog_sends ledger stamps every real send per scope ('all' or a
     house). The daily-log email window is now "since the last send"
     (capped at 7 days), not "today".
   - Unsent days ride the next email: each skipped day's notes in its
     own dated block + board tickets closed/born/moved since the marker
     ("Catching up — N unsent days" + "Board activity since last send").
   - Gmail-API sends stamp the ledger automatically (confirmed
     delivery); classic drafts get a one-tap "sent ✓" chip (NEXUS can't
     see Gmail's Send). Untapped = keeps accumulating — the safe way.
   - Quiet banner on the Daily Log shows what the next email carries.
   - composer onSend now reports method: 'gmail-api' | 'draft'.
   - Empty ledger (first use) = exactly the old today-only behavior.
*/
const CACHE_NAME = 'nexus-v347-somm-deepdive';
const SW_VERSION = CACHE_NAME.replace(/^nexus-/, '');

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
  './css/cleaning-system.css',
  './css/cleaning-roster.css',
  './css/education-system.css',
  './css/clippy.css',
  './css/training-system.css',
  './css/interests.css',
  './css/habits-debug.css',
  './css/ordering-system.css',
  './css/public-views.css',
  './css/preferences.css',
  './css/daily-card.css',   // v295 audit — file DOES exist and is linked; stale "404" note removed

  // NEXUS · R&M — single stylesheet for the whole module
  './css/home-soft.css',
  './css/nexus-rm.css',

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
  './js/education.js',
  './js/clippy.js',
  './js/clippy-gacha.js',
  './js/clippy-mens.js',
  './js/clippy-manus.js',
  './js/clippy-soul.js',
  './js/clippy-anima.js',
  './js/clippy-tesserae.js',
  './js/clippy-senses.js',
  './js/clippy-buddy.js',
  './js/clippy-power.js',
  './js/clippy-controller.js',
  './clippy-character.json',
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

  // Eagerly loaded in index.html but previously absent from the shell
  './js/domain.js',
  './js/nx-email.js',
  './js/nx-archive.js',
  './js/nx-drive.js',
  './js/habits.js',
  './js/interests.js',
  './js/clippy-games.js',
  './js/clippy-tour.js',
  './js/record-editor.js',
  './js/daily-log.js',
  './js/biweekly-log.js',
  // v295 audit — eagerly loaded in index.html but were missing from the shell
  // (daily-card.js removed — the file no longer exists, replaced by library.js)
  './js/email-composer.js',
  './js/hideaway.js',
  './js/moneta-mind.js',
  './js/nexus-qr.js',
  './js/notifications-bell.js',
  './js/seance.js',
  './js/tools.js',
  './js/library.js',

  // Lazy-loaded on demand via NX.app.loadScript (moduleMap + chains) —
  // precached so first offline open of these views still works
  './js/ordering.js',
  './js/duties.js',
  './js/inventory.js',
  './js/preferences.js',
  './js/work-orders.js',
  './js/nx-backup.js',
  // NEXUS · R&M — 7 modules, core.js must load first
  './js/core.js',
  './js/inbox.js',
  './js/detail.js',
  './js/vendors.js',
  './js/pm.js',
  './js/money.js',
  './js/brief.js',
  './js/home-rm.js',

  // Data + audio
  './clippy-dialog.json',
  './clippy.svg',
  './audio/nexus-theme.mp3',
];

// ─── CDN resources to cache (fonts, icons, libs) ──────────────────
const CDN_CACHE = [
  'https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
  // (clippyjs CDN URLs removed — Clippy v3 is fully self-contained now)
];

// ─── INSTALL — cache the app shell ────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW ' + SW_VERSION + '] Caching app shell');
      // Use allSettled so one bad file doesn't poison the whole install
      return Promise.allSettled(
        // cache:'reload' bypasses the browser HTTP cache — GitHub Pages serves max-age=600,
        // so without this a freshly-bumped SW could re-cache stale bytes for up to 10 min
        // (exactly what defeated the kawaii-face bump).
        APP_SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(err => {
          console.warn('[SW ' + SW_VERSION + '] Skip:', url, err.message);
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
        console.log('[SW ' + SW_VERSION + '] Deleting old cache:', k);
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
      url.hostname.includes('open-meteo.com') ||      // weather + geocode — must stay fresh
      (url.hostname.includes('googleapis.com') && url.pathname.startsWith('/gmail'))) {  // hostname can't carry a path — must test host + path separately, else Gmail API GETs fell through and got cached stale
    return; // Let browser handle normally (network only)
  }

  // ─── NETWORK-FIRST for JS / CSS / HTML ──────────────────────────
  // Always try latest code. Fall back to cache only if offline.
  const isCode = /\.(js|css|html|svg)($|\?)/.test(url.pathname) ||   // v329: .svg too — clippy.svg is the pet's face; a cache-bump must actually refetch it (the old regex left it cache-first, so a face change never reached devices)
                 /model-config\.json($|\?)/.test(url.pathname) ||  // model "save file" — must reflect edits, like code
                 /clippy-(dialog|character)\.json($|\?)/.test(url.pathname) ||  // pet persona + dialog pools — edits must reach devices, and must stay paired with the JS that reads them
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
        caches.match(event.request, { ignoreSearch: true }).then(cached => {   // ignoreSearch: clippy-power.js?v=1 is precached without the query — an exact match would miss it offline
          if (cached) return cached;
          // v336: only navigations get the HTML offline page. A missing JS/CSS/
          // SVG/JSON subresource must fail cleanly, not receive an HTML body
          // served under the wrong content type.
          if (event.request.mode === 'navigate') {
            return new Response('<h1>NEXUS Offline</h1><p>No cached version available. Connect to WiFi to load.</p>', {
              headers: { 'Content-Type': 'text/html' }
            });
          }
          return new Response('', { status: 504, statusText: 'Offline' });
        })
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

  // Scope-relative icon paths — the app is served from the /nexus/ subpath
  // on GitHub Pages, so absolute '/icon-192.png' 404s. Derive from scope.
  const _base = new URL(self.registration.scope).pathname;
  const opts = {
    body: data.body || '',
    icon: data.icon || (_base + 'icon-192.png'),
    badge: _base + 'icon-192.png',
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
  // Scope-relative — the app lives at /nexus/, so a hardcoded '/' opened the
  // wrong page. Derive the base from the SW registration scope.
  const _base = new URL(self.registration.scope).pathname;
  const targetUrl = _base + (params.toString() ? `?${params}` : '');

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
