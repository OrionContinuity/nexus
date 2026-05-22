/* ═══════════════════════════════════════════════════════════════════
   ordering.js — vendor list + order entry + cart review + mailto
   ═══════════════════════════════════════════════════════════════════
   Three views, layered:

   1. ENTRY PANE (the Ordering tab inside Duties)
      - Header with location pills (Este / Toti / Suerte)
      - Recent orders for the active location
      - Vendor list grouped by managed_by
      - Search filter

   2. ORDER ENTRY OVERLAY (full-screen, opened by tapping a vendor)
      - Header: vendor name, delivery date, location, close
      - Item list grouped by section, with par hints + qty controls
      - Sticky bottom CTA: "Review & Send · N items"
      - Auto-saves draft to Supabase every 1.5s after edits

   3. CART REVIEW OVERLAY (replaces entry overlay on Review tap)
      - Recipient pill (vendor.email; inline editor if missing)
      - Subject preview (from vendor.subject_template)
      - Line summary grouped by section
      - Notes textarea
      - SEND ORDER button → opens mailto, marks order sent

   Email composition:
      mailto:vendor@x.com?subject=...&body=...
      Subject from vendor.subject_template with {vendor}/{location}/
      {delivery_date} substitutions.
      Body: simple plaintext list. User's mail app handles signature.

   Persisted state:
      localStorage['nexus_order_location']  →  active location
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  if (window.NX && window.NX.modules && window.NX.modules.ordering) return;
  window.NX = window.NX || {}; NX.modules = NX.modules || {};

  // ─── DEBUG HELPERS ────────────────────────────────────────────────
  // Gate verbose console output behind NX.debug so production is quiet
  // by default. Errors always fire — they're the signal that survives
  // through the noise. Flip `NX.debug = true` in DevTools to turn the
  // log/info/warn channels back on for postmortem investigation.
  const dlog  = (...a) => { if (window.NX && NX.debug) dlog(...a);  };
  const dinfo = (...a) => { if (window.NX && NX.debug) dinfo(...a); };
  const dwarn = (...a) => { if (window.NX && NX.debug) dwarn(...a); };

  // ─── CONSTANTS ────────────────────────────────────────────────────
  const PANE_SEL    = '#dutiesOrderingPane';
  const LOC_KEY     = 'nexus_order_location';
  const LOCS        = [
    { id: 'este',   label: 'Este'   },
    { id: 'toti',   label: 'Toti'   },
    { id: 'suerte', label: 'Suerte' },
  ];
  const GROUP_ORDER = ['shift', 'cameron', 'jessie', 'rene', 'other'];
  const GROUP_LABEL = {
    shift:   'Shift vendors',
    cameron: "Cameron's vendors",
    jessie:  "Jessie's vendors",
    rene:    "Rene's vendors",
    other:   'Other vendors',
  };
  const WEEKDAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];
  const WEEKDAY_LBL  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const DRAFT_SAVE_DEBOUNCE_MS = 1500;
  // mailto safety: most clients accept ~2000 chars in body. Warn above 1800.
  const MAILTO_BODY_WARN_LEN = 1800;

  // ─── STATE (Phase 1 — list pane) ─────────────────────────────────
  let vendors      = [];
  let recentOrders = [];
  let activeLoc    = null;
  let initialized  = false;

  // Recent-orders pagination state.
  //   Default: collapsed → 3 most recent.
  //   Expanded: 10 per page, prev/next paging through all loaded orders.
  // Server fetches up to 30 (3 pages of 10) so this is a client-only slice.
  const RECENT_COLLAPSED_COUNT = 3;
  const RECENT_PAGE_SIZE       = 10;
  let   recentExpanded         = false;
  let   recentPage             = 0;     // 0-indexed

  // Recent list filter state — applied client-side to recentOrders before
  // pagination. recentStatusFilter is one of: 'all', 'draft', 'sent',
  // 'confirmed', 'delivered'. recentSearchQuery is a free-text vendor-name
  // match. Both are kept across re-renders so flipping a filter while
  // scrolling pages doesn't lose state.
  let recentStatusFilter = 'all';
  let recentSearchQuery  = '';

  // Vendor sort state.
  //   'alpha'   = alphabetical by name (default)
  //   'custom'  = manual sort_order column from DB
  //   'recent'  = most recently ordered/active first
  //   'busiest' = most ordered (frequency over the last 30 orders)
  // Persisted to localStorage. Pinned vendors always float to the top
  // regardless of mode, in their own internal sort order.
  // Key bumped to v2 so older 'alpha' values from the previous default
  // are ignored — every install now defaults to "Recently used", which
  // matches how the page is actually used (re-orders touch the same
  // vendors over and over). Users who explicitly want alpha can pick
  // it from the sort menu and the v2 key will retain their choice.
  const VENDOR_SORT_KEY = 'nexus_ordering_vendor_sort_v2';
  const VENDOR_SORT_MODES = ['alpha', 'custom', 'recent', 'busiest'];
  const VENDOR_SORT_LABELS = {
    alpha:   'Alphabetical',
    custom:  'Custom order',
    recent:  'Recently used',
    busiest: 'Most ordered',
  };
  function readVendorSort() {
    try {
      const v = localStorage.getItem(VENDOR_SORT_KEY);
      return VENDOR_SORT_MODES.includes(v) ? v : 'recent';
    } catch (_) { return 'recent'; }
  }
  let   vendorSortMode = readVendorSort();
  let   vendorReorderMode = false;     // true while user is dragging

  // ─── STATE (Phase 2 — entry overlay) ─────────────────────────────
  let entryState = null;
  /* shape:
     {
       vendor: {…}, catalog: [items], par_overrides: {[id]: {…}},
       location, delivery_date, notes, lines: {[id]: {qty,unit,…}},
       draftOrderId, saveTimer, saveInFlight, overlay,
       reviewing, readOnly, _escWired, _escHandler
     } */

  // ─── HELPERS ─────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
    ));
  }

  function fmtDateShort(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtDateLong(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
           + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
           + '-' + String(d.getDate()).padStart(2, '0');
  }
  function weekdayOf(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    return WEEKDAY_KEYS[d.getDay()];
  }

  /* ───────────────────────────────────────────────────────────────────
     PER-LOCATION SCHEDULE RESOLUTION
     ───────────────────────────────────────────────────────────────────
     Vendors have default schedule fields (delivery_days, cutoff_time,
     cutoff_days_before). Each location can OPTIONALLY override these
     via vendor.location_overrides[location] = { delivery_days, ... }.
     effectiveSchedule(vendor, location) returns the in-effect values
     for that location, falling back to defaults when no override.
     This is the single point where every other schedule helper resolves
     per-location values, so adding new schedule fields later only
     requires touching this function. */
  function effectiveSchedule(vendor, location) {
    if (!vendor) return { delivery_days: [], cutoff_time: null, cutoff_days_before: null, isCustom: false };
    const override = vendor.location_overrides && location && vendor.location_overrides[location];
    if (override && typeof override === 'object') {
      return {
        delivery_days:      Array.isArray(override.delivery_days) ? override.delivery_days : (vendor.delivery_days || []),
        cutoff_time:        override.cutoff_time != null ? override.cutoff_time : (vendor.cutoff_time || null),
        cutoff_days_before: override.cutoff_days_before != null ? override.cutoff_days_before : (vendor.cutoff_days_before == null ? null : vendor.cutoff_days_before),
        isCustom: true,
      };
    }
    return {
      delivery_days:      vendor.delivery_days || [],
      cutoff_time:        vendor.cutoff_time || null,
      cutoff_days_before: vendor.cutoff_days_before == null ? null : vendor.cutoff_days_before,
      isCustom: false,
    };
  }

  /* Is this vendor available at the given location?
     vendor.locations is an optional text[] — when null/empty, the
     vendor is available everywhere (default). When populated, the
     vendor only shows at locations in the list. */
  function isVendorVisible(vendor, location) {
    if (!vendor) return false;
    const locs = vendor.locations;
    if (!Array.isArray(locs) || locs.length === 0) return true;
    return locs.includes(location);
  }

  /** Best initial delivery date — the next day in vendor.delivery_days. */
  function nextDeliveryDate(vendor, location) {
    const sched = effectiveSchedule(vendor, location);
    const days = sched.delivery_days || [];
    let cursor = todayISO();
    if (!days.length) return addDays(cursor, 1);
    const beforeNoon = new Date().getHours() < 12;
    for (let i = 0; i < 14; i++) {
      const wk = weekdayOf(cursor);
      if (days.includes(wk)) {
        if (i === 0 && !beforeNoon) {
          cursor = addDays(cursor, 1);
          continue;
        }
        return cursor;
      }
      cursor = addDays(cursor, 1);
    }
    return addDays(todayISO(), 1);
  }

  /** Short label for the vendor's next delivery, used in cards and hints. */
  function nextDeliveryLabel(vendor, location) {
    const sched = effectiveSchedule(vendor, location);
    if (!sched.delivery_days.length) return null;
    const iso = nextDeliveryDate(vendor, location);
    if (!iso) return null;
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    if (iso === today) return 'today';
    if (iso === tomorrow) return 'tomorrow';
    const d = new Date(iso + 'T00:00:00');
    const wkLbl = WEEKDAY_LBL[d.getDay()];
    const diffDays = Math.round((new Date(iso) - new Date(today)) / 86400000);
    if (diffDays < 7) return wkLbl;
    const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return `${wkLbl} ${month} ${d.getDate()}`;
  }

  /** Check if a date (ISO yyyy-mm-dd) falls on a vendor's delivery day at a location. */
  function isVendorDeliveryDay(vendor, isoDate, location) {
    const sched = effectiveSchedule(vendor, location);
    const days = sched.delivery_days || [];
    if (!days.length || !isoDate) return true;
    return days.includes(weekdayOf(isoDate));
  }

  /** When does the vendor's order cutoff for `deliveryDateIso` land? */
  function vendorCutoffMoment(vendor, deliveryDateIso, location) {
    const sched = effectiveSchedule(vendor, location);
    if (!sched.cutoff_time || !deliveryDateIso) return null;
    const daysBefore = sched.cutoff_days_before == null ? 1 : sched.cutoff_days_before;
    const cutoffDateIso = addDays(deliveryDateIso, -daysBefore);
    const [hh, mm] = String(sched.cutoff_time).split(':').map(s => parseInt(s, 10));
    if (isNaN(hh) || isNaN(mm)) return null;
    const d = new Date(cutoffDateIso + 'T00:00:00');
    d.setHours(hh, mm, 0, 0);
    return d;
  }

  /** Format a duration in ms as a friendly countdown like "2h 14m". */
  function fmtCountdown(ms) {
    if (ms <= 0) return 'past cutoff';
    const totalMin = Math.floor(ms / 60000);
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin % (60 * 24)) / 60);
    const mins = totalMin % 60;
    if (days >= 1) return `${days}d ${hours}h`;
    if (hours >= 1) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function resolveLocation() {
    const ls = localStorage.getItem(LOC_KEY);
    if (ls && LOCS.some(l => l.id === ls)) return ls;
    if (NX.prefs && typeof NX.prefs.get === 'function') {
      const p = NX.prefs.get('default_order_location');
      if (p && LOCS.some(l => l.id === p)) return p;
    }
    return 'este';
  }

  // ─── DATA FETCHES ────────────────────────────────────────────────
  async function loadVendors() {
    if (!NX.sb) return [];
    // First try the full select with the new columns (recipient_names,
    // default_fill_mode). If those haven't been migrated yet, fall back
    // to the legacy column set — but CRITICALLY keep image_url, avatar_hue,
    // pinned, sort_order in the fallback so we don't lose track of them
    // and accidentally wipe images on save.
    //
    // v18.27 — image-disappearing bug fix. The previous fallback dropped
    // image_url, which combined with the saveVendor payload always sending
    // `image_url: id.photoUrl || null` meant: ANY transient error on
    // loadVendors → fallback fires → id.photoUrl loads as '' →
    // next save writes image_url=NULL to the DB → image gone forever.
    // Keeping image_url in the fallback closes that vector entirely.
    let { data, error } = await NX.sb
      .from('order_vendors')
      .select('id, name, alias_short, email, alt_emails, managed_by, role, delivery_days, cutoff_time, cutoff_days_before, locations, location_overrides, subject_template, body_template, notes, archived, image_url, avatar_hue, pinned, sort_order, recipient_names, default_fill_mode')
      .eq('archived', false)
      .order('pinned', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) {
      // Most likely cause: a recipient_names or default_fill_mode column
      // missing (pre-v18.25 migration). Keep image_url + avatar_hue +
      // pinned + sort_order in the fallback — those have been in the
      // schema for a while and dropping them caused the image-wipe bug.
      dwarn('[ordering] loadVendors with new columns failed, falling back:', error.message || error);
      const fallback = await NX.sb
        .from('order_vendors')
        .select('id, name, alias_short, email, alt_emails, managed_by, role, delivery_days, cutoff_time, cutoff_days_before, locations, location_overrides, subject_template, body_template, notes, archived, image_url, avatar_hue, pinned, sort_order')
        .eq('archived', false)
        .order('name', { ascending: true });
      if (fallback.error) {
        // Second-tier fallback — only used if even image_url is missing.
        // Drops the photo-related fields but at least returns SOMETHING.
        dwarn('[ordering] loadVendors second fallback (no image_url):', fallback.error.message);
        const minimal = await NX.sb
          .from('order_vendors')
          .select('id, name, alias_short, email, alt_emails, managed_by, role, delivery_days, subject_template, body_template, notes, archived')
          .eq('archived', false)
          .order('name', { ascending: true });
        if (minimal.error) { console.error('[ordering] loadVendors minimal fallback:', minimal.error); return []; }
        // Mark each row so saveVendor knows NOT to send image_url back —
        // we don't know its true value, so don't risk overwriting.
        const rows = minimal.data || [];
        rows.forEach(r => { r._image_url_unknown = true; });
        return rows;
      }
      data = fallback.data;
    }
    return data || [];
  }

  /**
   * Build a map of vendor_id → most recent order (already sorted by
   * updated_at desc in the recent-orders fetch). Used by the vendor list
   * to surface the most-actionable status as a preview line.
   */
  function buildLatestOrderMap(orders) {
    const map = {};
    for (const o of orders) {
      if (!map[o.vendor_id]) map[o.vendor_id] = o;
    }
    return map;
  }

  /**
   * Format a "when" string for the activity preview.
   * Same-day → "4:23 PM". Within a week → "Mon". Older → "May 5".
   */
  function fmtActivityWhen(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const diff = (now - d) / 86400000;
    if (diff < 1.5) return 'yesterday';
    if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  async function loadRecentOrders(location, limit = 30) {
    if (!NX.sb) return [];
    const { data, error } = await NX.sb
      .from('orders')
      .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at, updated_at, created_by_name, sent_by_name, confirmed_at, delivered_at, closed_at, issue_at, issue_note, archived_at')
      .eq('location', location)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) {
      // Fallback: new lifecycle columns may not exist yet. Retry with the
      // legacy SELECT so the activity preview still works pre-migration.
      dwarn('[ordering] loadRecentOrders new cols failed, falling back:', error.message || error);
      const fb = await NX.sb
        .from('orders')
        .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at, updated_at')
        .eq('location', location)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (fb.error) { console.error('[ordering] loadRecentOrders:', fb.error); return []; }
      return fb.data || [];
    }
    return data || [];
  }

  async function loadItemCounts() {
    if (!NX.sb) return {};
    const { data, error } = await NX.sb
      .from('order_guide_items')
      .select('vendor_id, id')
      .eq('archived', false);
    if (error) { console.error('[ordering] loadItemCounts:', error); return {}; }
    const counts = {};
    (data || []).forEach(row => { counts[row.vendor_id] = (counts[row.vendor_id] || 0) + 1; });
    return counts;
  }

  async function loadVendorCatalog(vendorId) {
    if (!NX.sb) return [];
    // Try the full SELECT first (with house_name). If the column
    // doesn't exist yet (pre-migration), fall back to legacy SELECT.
    const fullSelect = 'id, item_name, house_name, vendor_sku, section, unit, default_par_qty, pars_by_day, note, sort_order';
    const legacySelect = 'id, item_name, vendor_sku, section, unit, default_par_qty, pars_by_day, note, sort_order';
    let { data, error } = await NX.sb
      .from('order_guide_items')
      .select(fullSelect)
      .eq('vendor_id', vendorId)
      .eq('archived', false)
      .order('sort_order', { ascending: true });
    if (error && /house_name|column.*does not exist|schema cache/i.test(error.message || '')) {
      const fb = await NX.sb
        .from('order_guide_items')
        .select(legacySelect)
        .eq('vendor_id', vendorId)
        .eq('archived', false)
        .order('sort_order', { ascending: true });
      if (fb.error) { console.error('[ordering] loadVendorCatalog:', fb.error); return []; }
      data = fb.data; error = null;
    }
    if (error) { console.error('[ordering] loadVendorCatalog:', error); return []; }
    return data || [];
  }

  async function loadParOverrides(vendorId, location) {
    if (!NX.sb) return {};
    const { data: items, error: e1 } = await NX.sb
      .from('order_guide_items').select('id').eq('vendor_id', vendorId);
    if (e1 || !items || !items.length) return {};
    const itemIds = items.map(i => i.id);
    // Try with house_name (per-location team name override)
    let res = await NX.sb
      .from('order_guide_pars')
      .select('item_id, pars_by_day, enabled, house_name')
      .eq('location', location)
      .in('item_id', itemIds);
    if (res.error && /house_name|column.*does not exist|schema cache/i.test(res.error.message || '')) {
      res = await NX.sb
        .from('order_guide_pars')
        .select('item_id, pars_by_day, enabled')
        .eq('location', location)
        .in('item_id', itemIds);
    }
    if (res.error) { console.error('[ordering] loadParOverrides:', res.error); return {}; }
    const map = {};
    (res.data || []).forEach(row => { map[row.item_id] = row; });
    return map;
  }

  /* Pick the right display name for an item at a location, with fallbacks:
     1. Per-location house_name from order_guide_pars (most specific)
     2. Catalog-wide house_name from order_guide_items (vendor-level team name)
     3. Vendor's actual item_name (raw catalog entry)

     This is the single point where per-location team names are resolved.
     Used in order entry, review-and-send, and order detail views. */
  function pickHouseName(item, parOverride) {
    const perLoc  = (parOverride && parOverride.house_name || '').trim();
    const perItem = (item && item.house_name || '').trim();
    const vendor  = (item && item.item_name || '').trim();
    return perLoc || perItem || vendor || '(unnamed item)';
  }

  /* Compress a unit string to its shortest natural form for the order
     email. Catalog units like "3/1 GA" (3 cases of 1 gallon each) become
     just "ga". Plain units like "CS"/"EA"/"LB" lowercase to "cs"/"ea"/"lb".
     Empty falls back to "ea".

     Used so the line list reads naturally:
       5cs sunflower oil          (from unit "CS")
       1gal red wine vinegar       (from unit "1/1 GA" → "ga")
       20lbs garlic                (from unit "LBS")

     Whatever the user typed in the catalog flows through directly. */
  function shortUnit(u) {
    if (!u) return 'ea';
    const s = String(u).trim();
    // "N/M UNIT" pattern → take the part after the slash group
    const m = s.match(/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s+(.+)$/);
    const base = m ? m[1] : s;
    return base.toLowerCase().replace(/\s+/g, '');
  }

  async function loadOrderById(orderId) {
    if (!NX.sb) return null;
    const { data: order, error } = await NX.sb
      .from('orders').select('*').eq('id', orderId).single();
    if (error) { console.error('[ordering] loadOrderById:', error); return null; }
    const { data: lines } = await NX.sb
      .from('order_lines').select('*').eq('order_id', orderId)
      .order('sort_order', { ascending: true });
    return { ...order, lines: lines || [] };
  }

  async function findExistingDraft(vendorId, location) {
    if (!NX.sb) return null;
    const { data, error } = await NX.sb
      .from('orders')
      .select('id, updated_at')
      .eq('vendor_id', vendorId).eq('location', location).eq('status', 'draft')
      .order('updated_at', { ascending: false }).limit(1);
    if (error) { console.error('[ordering] findExistingDraft:', error); return null; }
    return (data && data[0]) || null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1 — LIST PANE RENDERING
  // ═══════════════════════════════════════════════════════════════════

  function renderShell() {
    const root = document.querySelector(PANE_SEL);
    if (!root) return null;
    root.innerHTML = `
      <div class="ord-header">
        <div class="ord-title">Ordering</div>
        <div class="ord-loc-picker" role="tablist" aria-label="Location">
          ${LOCS.map(l => `
            <button class="ord-loc-btn${l.id === activeLoc ? ' active' : ''}" data-loc="${l.id}" role="tab" aria-selected="${l.id === activeLoc ? 'true' : 'false'}">${esc(l.label)}</button>
          `).join('')}
        </div>
      </div>
      <div class="ord-pulse" id="ordPulse"></div>
      <!-- v18.29 — Home RECENT section removed. The cross-vendor
           recent-orders block (search + status chips + paginated list)
           moved into a dedicated "All transactions" overlay reachable
           from the masthead utility tray. Per-vendor recent orders
           still live inside each vendor detail screen, which was
           the right place all along. -->
      <div class="ord-vendors-wrap">
        <div class="ord-section-label ord-section-label-with-action">
          <span>Vendors</span>
          <button class="ord-add-vendor-btn" id="ordAddVendor" aria-label="Add new vendor">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Add</span>
          </button>
        </div>
        <div class="ord-search-wrap">
          <input type="search" class="ord-search" id="ordSearch"
            placeholder="Search vendors…" autocomplete="off" spellcheck="false"
            aria-label="Search vendors">
        </div>
        <div class="ord-vendors" id="ordVendors"></div>
      </div>
    `;
    root.querySelectorAll('.ord-loc-btn').forEach(b => {
      b.addEventListener('click', () => setLocation(b.dataset.loc));
    });
    const search = root.querySelector('#ordSearch');
    if (search) search.addEventListener('input', e => filterVendors(e.target.value));
    const addBtn = root.querySelector('#ordAddVendor');
    if (addBtn) addBtn.addEventListener('click', () => openVendorEditor(null));
    return root;
  }

  /* Daily Pulse — compact at-a-glance summary panel above Recent.
     Surfaces five operational states as tappable chips:
       • needs-ordering : vendors with imminent delivery + no order
       • cutoff-soon    : vendors with cutoff in next 4h
       • issues         : orders with unresolved issue
       • awaiting-conf  : sent orders not yet confirmed
       • arriving-today : confirmed/sent orders with delivery_date today

     Renders nothing when the day is fully quiet (all counts zero).
     Each chip is tappable: needs-ordering scrolls to the first such
     vendor in the list, issues + awaiting + arriving filter Recent. */
  function renderPulse() {
    const el = document.getElementById('ordPulse');
    if (!el) return;

    const today = todayISO();
    const tomorrow = addDays(today, 1);
    const orders = recentOrders || [];
    const vendorList = vendors || [];

    // 1) Vendors that need ordering — delivery today/tomorrow + no
    //    active order for that delivery yet.
    let needsOrderingCount = 0;
    let firstNeedsOrderingId = null;
    for (const v of vendorList) {
      if (v.archived) continue;
      if (!Array.isArray(v.delivery_days) || !v.delivery_days.length) continue;
      const nextIso = nextDeliveryDate(v, activeLoc);
      if (nextIso !== today && nextIso !== tomorrow) continue;
      const hasActive = orders.some(o =>
        o.vendor_id === v.id
        && o.location === activeLoc
        && !o.archived_at
        && o.delivery_date === nextIso
      );
      if (!hasActive) {
        needsOrderingCount++;
        if (!firstNeedsOrderingId) firstNeedsOrderingId = v.id;
      }
    }

    // 2) Cutoffs in the next 4 hours
    const fourHrMs = 4 * 3600 * 1000;
    const now = Date.now();
    let cutoffSoonCount = 0;
    for (const v of vendorList) {
      if (v.archived || !v.cutoff_time) continue;
      const nextIso = nextDeliveryDate(v, activeLoc);
      if (!nextIso) continue;
      // Only count if there's actually something to send — a draft order
      // or a vendor with no order at all for this delivery cycle.
      const draft = orders.find(o =>
        o.vendor_id === v.id && o.location === activeLoc
        && !o.archived_at && o.delivery_date === nextIso
        && (o.status === 'draft' || !o.email_sent_at)
      );
      // Surface either if there's a draft to send, OR if there's nothing
      // (the user might still need to start one).
      const cutoff = vendorCutoffMoment(v, nextIso, activeLoc);
      if (!cutoff) continue;
      const ms = cutoff.getTime() - now;
      if (ms > 0 && ms <= fourHrMs) {
        // Skip only if order is already sent (no-action-needed)
        const sentAlready = orders.some(o =>
          o.vendor_id === v.id && o.location === activeLoc
          && !o.archived_at && o.delivery_date === nextIso
          && o.email_sent_at
        );
        if (!sentAlready) cutoffSoonCount++;
      }
    }

    // 3) Issues unresolved
    const issuesCount = orders.filter(o =>
      o.location === activeLoc
      && !o.archived_at
      && o.issue_at
      && !o.issue_resolved_at
    ).length;

    // 4) Sent but not yet confirmed
    const awaitingCount = orders.filter(o =>
      o.location === activeLoc
      && !o.archived_at
      && o.status === 'sent'
    ).length;

    // 5) Deliveries arriving today (confirmed/sent with delivery=today)
    const arrivingTodayCount = orders.filter(o =>
      o.location === activeLoc
      && !o.archived_at
      && o.delivery_date === today
      && (o.status === 'sent' || o.status === 'confirmed')
    ).length;

    const total = needsOrderingCount + cutoffSoonCount + issuesCount + awaitingCount + arrivingTodayCount;
    if (total === 0) {
      // Quiet day — render a calm "all clear" line if there are vendors
      // configured at all, else nothing (new install state).
      if (vendorList.length) {
        el.innerHTML = `
          <div class="ord-pulse-calm">
            <span class="ord-pulse-calm-dot" aria-hidden="true">◆</span>
            <span>All clear.</span>
          </div>
        `;
      } else {
        el.innerHTML = '';
      }
      return;
    }

    const chips = [];
    if (needsOrderingCount > 0) {
      chips.push({
        cls: 'is-needs',
        action: 'scroll-vendor',
        target: firstNeedsOrderingId,
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
        count: needsOrderingCount,
        label: needsOrderingCount === 1 ? 'vendor needs ordering' : 'vendors need ordering',
      });
    }
    if (cutoffSoonCount > 0) {
      chips.push({
        cls: 'is-cutoff',
        action: 'noop',
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        count: cutoffSoonCount,
        label: cutoffSoonCount === 1 ? 'cutoff in 4h' : 'cutoffs in 4h',
      });
    }
    if (issuesCount > 0) {
      chips.push({
        cls: 'is-issue',
        action: 'filter-issue',
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        count: issuesCount,
        label: issuesCount === 1 ? 'open issue' : 'open issues',
      });
    }
    if (arrivingTodayCount > 0) {
      chips.push({
        cls: 'is-arriving',
        action: 'filter-status',
        target: 'confirmed',
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20l16-16M21 16v5h-5M4 4l5 5"/></svg>`,
        count: arrivingTodayCount,
        label: arrivingTodayCount === 1 ? 'arriving today' : 'arriving today',
      });
    }
    if (awaitingCount > 0) {
      chips.push({
        cls: 'is-awaiting',
        action: 'filter-status',
        target: 'sent',
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
        count: awaitingCount,
        label: awaitingCount === 1 ? 'awaiting confirmation' : 'awaiting confirmation',
      });
    }

    el.innerHTML = `
      <div class="ord-pulse-chips" role="list" aria-label="Today's operational pulse">
        ${chips.map(c => `
          <button class="ord-pulse-chip ${c.cls}" type="button"
            data-pulse-action="${esc(c.action)}"
            ${c.target ? `data-pulse-target="${esc(c.target)}"` : ''}>
            ${c.icon}
            <span class="ord-pulse-chip-count">${c.count}</span>
            <span class="ord-pulse-chip-label">${esc(c.label)}</span>
          </button>
        `).join('')}
      </div>
    `;

    // Wire chip taps. Filtering chips set the Recent status filter and
    // re-render Recent. Scroll-vendor chip jumps to the relevant vendor.
    el.querySelectorAll('.ord-pulse-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.pulseAction;
        const target = btn.dataset.pulseTarget;
        if (action === 'scroll-vendor' && target) {
          const row = document.querySelector(`.ord-vendor-row[data-vendor-id="${target}"]`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Quick visual flash so the user knows which vendor we landed on
            row.classList.add('is-flash');
            setTimeout(() => row.classList.remove('is-flash'), 1600);
          }
        } else if (action === 'filter-status' && target) {
          // v18.29 — Home Recent section was removed; filter chips now
          // open the All Transactions overlay with the filter applied.
          recentStatusFilter = target;
          recentSearchQuery = '';
          recentPage = 0;
          openAllTransactions();
        } else if (action === 'filter-issue') {
          // Same redirect for the issue chip — open the overlay,
          // pre-filtered by the "issue" search proxy.
          recentSearchQuery = 'issue';
          recentStatusFilter = 'all';
          recentPage = 0;
          openAllTransactions();
        }
      });
    });
  }

  function renderRecent(list, vendorMap) {
    const el = document.getElementById('ordRecent');
    if (!el) return;

    // ── Apply filters BEFORE slicing/pagination ─────────────────────
    // Status chip filters by exact order.status. Search matches vendor
    // name OR status label, case-insensitive. Filters compose: a search
    // for "PFG" with status="sent" only shows sent PFG orders.
    const filtered = (list || []).filter(o => {
      if (recentStatusFilter !== 'all') {
        if ((o.status || 'draft') !== recentStatusFilter) return false;
      }
      if (recentSearchQuery) {
        const q = recentSearchQuery.toLowerCase();
        const v = vendorMap[o.vendor_id];
        const vendorName = (v && v.name || '').toLowerCase();
        const status = (o.status || '').toLowerCase();
        if (!vendorName.includes(q) && !status.includes(q)) return false;
      }
      return true;
    });

    // ── Sticky header: search + status chips ─────────────────────────
    // Even when there are zero orders we still render the header so the
    // user can clear filters that may be hiding everything. The chip
    // counts (e.g. "All 12") help the user understand the filter is
    // doing something — without a count, "0 results" is confusing.
    const filterCounts = (list || []).reduce((acc, o) => {
      const s = o.status || 'draft';
      acc.all = (acc.all || 0) + 1;
      acc[s]  = (acc[s]  || 0) + 1;
      return acc;
    }, {});
    const chipDef = [
      { key: 'all',       label: 'All' },
      { key: 'draft',     label: 'Drafts' },
      { key: 'sent',      label: 'Sent' },
      { key: 'confirmed', label: 'Confirmed' },
      { key: 'delivered', label: 'Delivered' },
    ];
    const chipsHTML = chipDef.map(c => {
      const count = filterCounts[c.key] || 0;
      const active = recentStatusFilter === c.key;
      return `
        <button type="button" class="ord-recent-chip${active ? ' is-active' : ''}" data-status="${esc(c.key)}" aria-pressed="${active}">
          <span class="ord-recent-chip-label">${esc(c.label)}</span>
          ${count > 0 ? `<span class="ord-recent-chip-count">${count}</span>` : ''}
        </button>`;
    }).join('');
    const searchHasValue = !!recentSearchQuery;
    const headerHTML = `
      <div class="ord-section-label">Recent</div>
      <div class="ord-recent-controls">
        <div class="ord-recent-search-wrap">
          <svg class="ord-recent-search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" class="ord-recent-search" id="ordRecentSearch" placeholder="Search orders…" value="${esc(recentSearchQuery)}" autocomplete="off" spellcheck="false" inputmode="search">
          ${searchHasValue ? `<button type="button" class="ord-recent-search-clear" id="ordRecentSearchClear" aria-label="Clear search">×</button>` : ''}
        </div>
        <div class="ord-recent-chips" role="group" aria-label="Filter by status">
          ${chipsHTML}
        </div>
      </div>
    `;

    // ── Empty states ─────────────────────────────────────────────────
    // Zero overall: vendor-list-aware CTA so the user knows the next
    // step. Zero after filter: "clear filters" affordance instead of a
    // dead end.
    if (!list.length) {
      el.innerHTML = `
        ${headerHTML}
        <div class="ord-empty ord-empty-cta">
          <div class="ord-empty-msg">No orders yet for ${esc(activeLoc)}.</div>
          <div class="ord-empty-hint-row">${vendors && vendors.length
            ? 'Pick a vendor below to start your first order →'
            : 'Add a vendor first to start ordering.'}</div>
        </div>
      `;
      wireRecentControls(el, vendorMap);
      return;
    }
    if (!filtered.length) {
      el.innerHTML = `
        ${headerHTML}
        <div class="ord-empty ord-empty-filtered">
          <div class="ord-empty-msg">No orders match these filters.</div>
          <button type="button" class="ord-empty-clear-btn" id="ordEmptyClear">Clear filters</button>
        </div>
      `;
      wireRecentControls(el, vendorMap);
      return;
    }

    const fmtRel = ts => {
      if (!ts) return '';
      const d = new Date(ts), now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const diff = (now - d) / 86400000;
      if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    // Slice the filtered list based on collapsed / expanded mode.
    let visible, totalPages, controlsHTML;
    if (!recentExpanded) {
      visible = filtered.slice(0, RECENT_COLLAPSED_COUNT);
      const hidden = filtered.length - visible.length;
      controlsHTML = hidden > 0
        ? `<button class="ord-recent-more" id="ordRecentMore" type="button" aria-label="Show more orders">
             <span>${hidden} more</span>
             <span class="ord-recent-more-arrow" aria-hidden="true">↓</span>
           </button>`
        : '';
    } else {
      const start = recentPage * RECENT_PAGE_SIZE;
      visible = filtered.slice(start, start + RECENT_PAGE_SIZE);
      totalPages = Math.ceil(filtered.length / RECENT_PAGE_SIZE);
      const showPaging = totalPages > 1;
      controlsHTML = `
        <div class="ord-recent-foot">
          <button class="ord-recent-collapse" id="ordRecentCollapse" type="button" aria-label="Show less">
            <span class="ord-recent-collapse-arrow" aria-hidden="true">↑</span>
            <span>Show less</span>
          </button>
          ${showPaging ? `
            <div class="ord-recent-pager" role="group" aria-label="Order history pages">
              <button class="ord-recent-page-btn" id="ordRecentPrev" ${recentPage === 0 ? 'disabled' : ''} aria-label="Previous page">‹</button>
              <span class="ord-recent-page-label">${recentPage + 1} / ${totalPages}</span>
              <button class="ord-recent-page-btn" id="ordRecentNext" ${recentPage >= totalPages - 1 ? 'disabled' : ''} aria-label="Next page">›</button>
            </div>
          ` : ''}
        </div>`;
    }

    // Bucket each visible row by date so we can insert dividers as the
    // date changes.
    const bucketOf = ts => {
      if (!ts) return 'older';
      const d = new Date(ts), now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) return 'today';
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
      const diff = (now - d) / 86400000;
      if (diff < 7) return 'thisweek';
      return 'older';
    };
    const bucketLabel = {
      today:     'TODAY',
      yesterday: 'YESTERDAY',
      thisweek:  'EARLIER THIS WEEK',
      older:     'OLDER',
    };

    let lastBucket = null;
    const rowsHTML = visible.map(o => {
      const v = vendorMap[o.vendor_id];
      const status = o.status || 'draft';
      const when = fmtRel(o.updated_at || o.created_at);
      const deliv = o.delivery_date ? fmtDateShort(o.delivery_date) : '';
      const bucket = bucketOf(o.updated_at || o.created_at);
      let dividerHTML = '';
      if (bucket !== lastBucket) {
        dividerHTML = `<div class="ord-recent-divider">${bucketLabel[bucket]}</div>`;
        lastBucket = bucket;
      }
      // Avatar — uses vendor's stored hue + image_url so it matches the
      // vendor list, vendor detail, and order entry header. Visual
      // continuity makes scanning the recent list MUCH faster: you
      // recognize "PFG" by its color before reading the text.
      const avatarHTML = v
        ? vendorAvatar(v.name, v.image_url, v.avatar_hue)
        : `<div class="ord-vendor-avatar ord-vendor-avatar-unknown">?</div>`;
      return `${dividerHTML}
        <button class="ord-recent-row ord-recent-row--with-avatar" data-order-id="${esc(o.id)}">
          <div class="ord-recent-row-avatar">${avatarHTML}</div>
          <div class="ord-recent-main">
            <div class="ord-recent-vendor">${esc(v ? v.name : 'Unknown vendor')}</div>
            <div class="ord-recent-meta">
              <span class="ord-status ord-status-${esc(status)}">${esc(status)}</span>
              ${deliv ? `<span class="ord-recent-deliv">· deliver ${esc(deliv)}</span>` : ''}
              <span class="ord-recent-when">· ${esc(when)}</span>
            </div>
          </div>
          <div class="ord-arrow" aria-hidden="true">›</div>
        </button>`;
    }).join('');

    el.innerHTML = `
      ${headerHTML}
      ${rowsHTML}
      ${controlsHTML}
      <button class="ord-recent-tx-link" id="ordRecentTxLink" type="button" aria-label="View all transactions">
        <span>View all transactions</span>
        <span class="ord-recent-tx-link-arrow" aria-hidden="true">→</span>
      </button>
    `;

    // Wire the transactions link
    const txLink = el.querySelector('#ordRecentTxLink');
    if (txLink) {
      txLink.addEventListener('click', () => openTransactionsView());
    }

    wireRecentControls(el, vendorMap, totalPages);
    // Pulse follows every state change Recent reflects
    renderPulse();
  }

  /* Wire all recent-list interactions in one place — the search input,
     status chips, more/collapse buttons, paging, and the "Clear
     filters" button shown in the empty-filtered state. Pulled out of
     renderRecent so the early-return empty paths can reuse it. */
  function wireRecentControls(el, vendorMap, totalPages) {
    el.querySelectorAll('.ord-recent-row').forEach(b => {
      b.addEventListener('click', () => openExistingOrder(b.dataset.orderId));
    });

    // Search — debounce-light: re-render on every input but state is
    // pure render-side so the cost is small. Resets pagination so a
    // search after page 3 doesn't show page 3 of the new filtered set.
    const searchInput = el.querySelector('#ordRecentSearch');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        recentSearchQuery = searchInput.value.trim();
        recentPage = 0;
        renderRecent(recentOrders, vendorMap);
        // Keep focus on the input so typing flows naturally.
        const next = document.getElementById('ordRecentSearch');
        if (next) {
          next.focus();
          // Restore caret to end (innerHTML re-render moves it).
          const len = next.value.length;
          try { next.setSelectionRange(len, len); } catch (_) {}
        }
      });
    }
    const clearBtn = el.querySelector('#ordRecentSearchClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        recentSearchQuery = '';
        recentPage = 0;
        renderRecent(recentOrders, vendorMap);
      });
    }

    // Chips — also reset paging on filter change.
    el.querySelectorAll('[data-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        recentStatusFilter = chip.dataset.status;
        recentPage = 0;
        renderRecent(recentOrders, vendorMap);
      });
    });

    // "Clear filters" inside the empty-filtered state.
    const emptyClear = el.querySelector('#ordEmptyClear');
    if (emptyClear) {
      emptyClear.addEventListener('click', () => {
        recentSearchQuery  = '';
        recentStatusFilter = 'all';
        recentPage         = 0;
        renderRecent(recentOrders, vendorMap);
      });
    }

    const moreBtn = el.querySelector('#ordRecentMore');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        recentExpanded = true;
        recentPage = 0;
        renderRecent(recentOrders, vendorMap);
      });
    }

    const collapseBtn = el.querySelector('#ordRecentCollapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        recentExpanded = false;
        recentPage = 0;
        renderRecent(recentOrders, vendorMap);
      });
    }

    const prevBtn = el.querySelector('#ordRecentPrev');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (recentPage > 0) { recentPage -= 1; renderRecent(recentOrders, vendorMap); }
      });
    }
    const nextBtn = el.querySelector('#ordRecentNext');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (totalPages && recentPage < totalPages - 1) { recentPage += 1; renderRecent(recentOrders, vendorMap); }
      });
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     v18.29 — ALL TRANSACTIONS OVERLAY

     The cross-vendor recent-orders list used to sit on the Home/Duties
     tab between the pulse chips and the vendors list. That position
     was noisy: most rows were the same high-volume vendor (PFG) showing
     up multiple times, duplicating info already available inside each
     vendor's detail screen. Removed from Home → relocated here as an
     on-demand overlay reachable from:
       • The masthead utility tray ("Transactions" button)
       • Pulse chip taps (e.g. "5 awaiting confirmation" opens the
         overlay pre-filtered to status=sent)

     Internals: reuses renderRecent() unchanged by embedding the same
     `id="ordRecent"` container inside the overlay. The existing search
     + status filter + pagination + bucketing all just work.
     ════════════════════════════════════════════════════════════════════ */
  function openAllTransactions() {
    let overlay = document.querySelector('.ord-allorders-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'ord-allorders-overlay';
      document.body.appendChild(overlay);
      document.body.classList.add('ord-overlay-open');
    }
    const locLabel = (LOCS.find(l => l.id === activeLoc) || {}).label || activeLoc;
    overlay.innerHTML = `
      <div class="ord-entry-head ord-allorders-head">
        <button class="ord-entry-close" id="allOrdersClose" aria-label="Close">${arrowLeftIcon()}</button>
        <div class="ord-entry-title">
          <div class="ord-entry-vendor">All transactions</div>
          <div class="ord-entry-sub">${esc(locLabel)}</div>
        </div>
        <div class="ord-entry-spacer"></div>
      </div>
      <div class="ord-allorders-body">
        <div class="ord-recent" id="ordRecent"></div>
      </div>
    `;
    overlay.querySelector('#allOrdersClose').addEventListener('click', closeAllTransactions);
    // Paint Recent into the overlay's container using the existing
    // renderer. The vendorMap is rebuilt fresh (vendor state may have
    // changed since the last paint).
    const vmap = {}; (vendors || []).forEach(v => vmap[v.id] = v);
    renderRecent(recentOrders, vmap);

    // ESC closes the overlay (matches the other ordering overlays).
    if (!overlay._escWired) {
      const escHandler = e => {
        if (e.key === 'Escape' && document.querySelector('.ord-allorders-overlay')) {
          closeAllTransactions();
        }
      };
      document.addEventListener('keydown', escHandler);
      overlay._escWired = true;
      overlay._escHandler = escHandler;
    }
  }

  function closeAllTransactions() {
    const overlay = document.querySelector('.ord-allorders-overlay');
    if (!overlay) return;
    if (overlay._escHandler) {
      document.removeEventListener('keydown', overlay._escHandler);
    }
    overlay.remove();
    // Drop the body class only if no other ordering overlay is open
    const anyOpen = document.querySelector(
      '.ord-entry-overlay, .ord-catalog-overlay, .ord-vdetail-overlay'
    );
    if (!anyOpen) document.body.classList.remove('ord-overlay-open');
  }
  // Expose so the masthead utility-tray button can call into it.
  NX.openAllTransactions = openAllTransactions;

  function renderVendors() {
    const el = document.getElementById('ordVendors');
    if (!el) return;
    if (!vendors.length) {
      el.innerHTML = `
        <div class="ord-empty ord-empty-cta">
          <div class="ord-empty-msg">No vendors yet.</div>
          <div class="ord-empty-hint-row">Tap the <strong>+</strong> button above to add your first one →</div>
        </div>
      `;
      return;
    }

    // Compute the latest-order-per-vendor map for the active location.
    // Used to surface a vendor's most-actionable status as a preview line:
    //   - has open draft → "Continue order · 3 items started"
    //   - recently sent  → "Order sent · 2 days ago"
    //   - long ago sent  → "Last sent · May 3"
    //   - never ordered  → catalog summary fallback
    const latestByVendor = buildLatestOrderMap(recentOrders);

    // Order frequency for the 'busiest' sort mode — count of orders
    // per vendor in the recentOrders window (up to 30 orders).
    const orderCountByVendor = {};
    for (const o of recentOrders) {
      orderCountByVendor[o.vendor_id] = (orderCountByVendor[o.vendor_id] || 0) + 1;
    }

    // Sort. Pinned vendors always float to the top regardless of mode.
    // Filter out vendors that don't serve the active location. Vendors
    // without an explicit locations[] are visible everywhere (the
    // default — most vendors). Vendors with locations[] only show at
    // the locations they actually serve.
    const visibleVendors = vendors.filter(v => isVendorVisible(v, activeLoc));

    // Within their group, pinned vendors sort by sort_order (custom-set
    // order from the user, falling back to name). Within unpinned, the
    // active sort mode applies.
    const sorted = visibleVendors.slice().sort((a, b) => {
      const ap = a.pinned ? 1 : 0, bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;

      switch (vendorSortMode) {
        case 'custom': {
          // sort_order is a nullable int — vendors with no value sort to the
          // bottom of their group. Within a tie, fall back to name.
          const aSort = a.sort_order, bSort = b.sort_order;
          if (aSort != null && bSort != null) {
            if (aSort !== bSort) return aSort - bSort;
          } else if (aSort != null) {
            return -1;
          } else if (bSort != null) {
            return 1;
          }
          return (a.name || '').localeCompare(b.name || '');
        }
        case 'recent': {
          // Most-recently-active first. Vendors with no activity sort to
          // the bottom (alphabetical among themselves).
          const aT = latestByVendor[a.id]?.updated_at || latestByVendor[a.id]?.created_at;
          const bT = latestByVendor[b.id]?.updated_at || latestByVendor[b.id]?.created_at;
          if (aT && bT) return new Date(bT) - new Date(aT);
          if (aT) return -1;
          if (bT) return 1;
          return (a.name || '').localeCompare(b.name || '');
        }
        case 'busiest': {
          // Highest order count first. Tie-break by name.
          const aC = orderCountByVendor[a.id] || 0;
          const bC = orderCountByVendor[b.id] || 0;
          if (aC !== bC) return bC - aC;
          return (a.name || '').localeCompare(b.name || '');
        }
        case 'alpha':
        default:
          return (a.name || '').localeCompare(b.name || '');
      }
    });

    let html = '';
    for (const v of sorted) {
      const itemCount = vendors._itemCounts[v.id] || 0;
      const latest = latestByVendor[v.id];
      const isDraft = latest && latest.status === 'draft';
      const hasIssue = latest && latest.issue_at;

      // Build the activity preview line. Order of priority:
      //   1. ISSUE — anything with an unresolved issue flag is most
      //      actionable, surfaces with an amber pill regardless of status
      //   2. Status-based preview for draft/sent/confirmed/delivered/closed
      //   3. Catalog summary for vendors with no recent activity
      let preview = '';
      let timestamp = '';
      let pillHTML = '';
      if (latest) {
        timestamp = fmtActivityWhen(latest.updated_at || latest.created_at);
        if (hasIssue) {
          pillHTML = `<span class="ord-vendor-pill ord-vendor-pill-issue">ISSUE</span>`;
          preview = latest.issue_note
            ? `Issue · ${latest.issue_note}`
            : `Issue reported · tap to resolve`;
        } else if (isDraft) {
          pillHTML = `<span class="ord-vendor-pill ord-vendor-pill-draft">DRAFT</span>`;
          preview = `Continue order · ${itemCount ? itemCount + ' in catalog' : 'catalog empty'}`;
        } else if (latest.status === 'sent') {
          preview = `Sent · awaiting confirmation${latest.delivery_date ? ' · deliver ' + fmtDateShort(latest.delivery_date) : ''}`;
        } else if (latest.status === 'confirmed') {
          preview = `Confirmed${latest.delivery_date ? ' · deliver ' + fmtDateShort(latest.delivery_date) : ''}`;
        } else if (latest.status === 'delivered') {
          preview = `Delivered${latest.delivered_at ? ' ' + fmtActivityWhen(latest.delivered_at) : ''}`;
        } else if (latest.status === 'closed') {
          preview = `Closed${latest.closed_at ? ' ' + fmtActivityWhen(latest.closed_at) : ''}`;
        } else {
          preview = `${esc(latest.status || 'order')} · ${itemCount} item${itemCount === 1 ? '' : 's'} in catalog`;
        }
      } else {
        // No recent activity — surface the catalog size + next delivery
        // day if known, so the user can see "this vendor delivers Wed,
        // I should think about ordering soon" at a glance.
        const nextLbl = nextDeliveryLabel(v, activeLoc);
        if (itemCount && nextLbl) {
          preview = `${itemCount} item${itemCount === 1 ? '' : 's'} · next delivery ${nextLbl}`;
        } else if (itemCount) {
          preview = `${itemCount} item${itemCount === 1 ? '' : 's'} in catalog`;
        } else {
          preview = 'No catalog yet';
        }
      }

      const rowClasses = ['ord-vendor-row'];
      if (isDraft)  rowClasses.push('has-draft');
      if (hasIssue) rowClasses.push('has-issue');
      if (v.pinned) rowClasses.push('is-pinned');

      // "Needs ordering" indicator. Surfaces when delivery is imminent
      // (today or tomorrow per vendor.delivery_days) AND there's no
      // active order yet covering that delivery. The signal is "you
      // should probably draft an order for this vendor now."
      // Skipped for vendors with no delivery_days (no schedule) or
      // when there's already a non-archived order in progress.
      let needsOrdering = false;
      if (Array.isArray(v.delivery_days) && v.delivery_days.length) {
        const nextIso = nextDeliveryDate(v, activeLoc);
        const today = todayISO();
        const tomorrow = addDays(today, 1);
        const isImminent = nextIso === today || nextIso === tomorrow;
        if (isImminent) {
          // Check the recent orders cache for any active (non-archived,
          // non-closed) order for this vendor at this location with a
          // matching delivery date.
          const hasActiveForNext = (recentOrders || []).some(o =>
            o.vendor_id === v.id
            && o.location === activeLoc
            && !o.archived_at
            && o.delivery_date === nextIso
          );
          needsOrdering = !hasActiveForNext;
        }
      }
      if (needsOrdering) rowClasses.push('needs-ordering');
      // Drag handles only render in custom-sort + reorder mode. The
      // handle is a passive child div that the touch/pointer events
      // hook into; the row button itself remains tappable for normal
      // navigation when not in reorder mode.
      const showDragHandle = vendorSortMode === 'custom' && vendorReorderMode;
      if (showDragHandle) rowClasses.push('is-reordering');

      html += `
        <div class="ord-vendor-row-wrap" data-vendor-id="${esc(v.id)}">
          ${showDragHandle ? `
            <div class="ord-vendor-drag-handle" data-vendor-id="${esc(v.id)}" aria-label="Drag to reorder ${esc(v.name)}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="3" y1="8" x2="21" y2="8"/>
                <line x1="3" y1="16" x2="21" y2="16"/>
              </svg>
            </div>
          ` : ''}
          <button class="${rowClasses.join(' ')}" data-vendor-id="${esc(v.id)}" data-vendor-name="${esc(v.name).toLowerCase()}">
            <div class="ord-vendor-avatar-wrap">
              ${vendorAvatar(v.name, v.image_url, v.avatar_hue)}
              ${v.pinned ? pinIndicator() : ''}
            </div>
            <div class="ord-vendor-main">
              <div class="ord-vendor-name-row">
                <div class="ord-vendor-name">${esc(v.name)}</div>
                ${timestamp ? `<div class="ord-vendor-when">${esc(timestamp)}</div>` : ''}
              </div>
              <div class="ord-vendor-meta">
                ${pillHTML}
                <span class="ord-vendor-preview">${esc(preview)}</span>
              </div>
            </div>
            ${v.email ? '' : '<span class="ord-vendor-warn" title="No email set">!</span>'}
            <div class="ord-arrow" aria-hidden="true">›</div>
          </button>
          ${!showDragHandle ? `<button class="ord-vendor-menu" data-vendor-id="${esc(v.id)}" aria-label="More options for ${esc(v.name)}">${dotsIcon()}</button>` : ''}
        </div>
      `;
    }
    // Inject the sort header above the rows. The "Reorder" affordance
    // only appears in custom-sort mode; tapping it flips reorder-mode
    // which rotates the menu buttons out and drag handles in.
    const sortHeaderHTML = `
      <div class="ord-vendor-sort-bar">
        <div class="ord-vendor-sort-pill" id="ordVendorSortPill" role="button" tabindex="0" aria-label="Change vendor sort">
          <span class="ord-vendor-sort-label">Sort:</span>
          <span class="ord-vendor-sort-value">${esc(VENDOR_SORT_LABELS[vendorSortMode] || vendorSortMode)}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        ${vendorSortMode === 'custom' ? `
          <button class="ord-vendor-reorder-btn ${vendorReorderMode ? 'is-active' : ''}" id="ordVendorReorderBtn" aria-pressed="${vendorReorderMode}">
            ${vendorReorderMode ? 'Done' : 'Reorder'}
          </button>
        ` : ''}
      </div>
    `;
    el.innerHTML = sortHeaderHTML + html;
    // Sort pill — opens a tiny menu of sort modes.
    el.querySelector('#ordVendorSortPill')?.addEventListener('click', showVendorSortMenu);
    // Reorder toggle (custom mode only).
    el.querySelector('#ordVendorReorderBtn')?.addEventListener('click', () => {
      vendorReorderMode = !vendorReorderMode;
      renderVendors();
    });
    // Tap row → open vendor detail (suppressed during reorder mode —
    // the handle takes precedence and the row body becomes inert).
    el.querySelectorAll('.ord-vendor-row').forEach(b => {
      b.addEventListener('click', e => {
        if (vendorReorderMode) {
          e.preventDefault();
          return;
        }
        openVendorDetail(b.dataset.vendorId);
      });
    });
    el.querySelectorAll('.ord-vendor-menu').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const id = b.dataset.vendorId;
        const v = vendors.find(x => x.id === id);
        if (v) showVendorMenu(v);
      });
    });
    // Drag-to-reorder — only active in custom-sort + reorder mode.
    if (vendorSortMode === 'custom' && vendorReorderMode) {
      wireVendorDragHandlers(el);
    }
  }

  /**
   * Show a small floating menu for changing vendor sort mode. Modeled
   * on the recent-orders pager — minimal, no extra layer of clicks.
   */
  function showVendorSortMenu() {
    const existing = document.querySelector('.ord-vmenu-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ord-vmenu-overlay';
    overlay.innerHTML = `
      <div class="ord-vmenu-backdrop"></div>
      <div class="ord-vmenu-sheet">
        <div class="ord-vmenu-handle"></div>
        <div class="ord-vmenu-actions">
          ${VENDOR_SORT_MODES.map(mode => `
            <button class="ord-vmenu-action${mode === vendorSortMode ? ' is-active' : ''}" data-mode="${esc(mode)}">
              <span class="ord-vmenu-action-text">
                <span class="ord-vmenu-action-title">${esc(VENDOR_SORT_LABELS[mode])}</span>
                <span class="ord-vmenu-action-sub">${esc(sortModeDescription(mode))}</span>
              </span>
              ${mode === vendorSortMode ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            </button>
          `).join('')}
          <button class="ord-vmenu-action ord-vmenu-action-cancel" data-mode="cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.ord-vmenu-backdrop').addEventListener('click', close);
    overlay.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode !== 'cancel' && VENDOR_SORT_MODES.includes(mode)) {
          vendorSortMode = mode;
          try { localStorage.setItem(VENDOR_SORT_KEY, mode); } catch (_) {}
          // Auto-exit reorder mode if we left custom.
          if (mode !== 'custom') vendorReorderMode = false;
          renderVendors();
        }
        close();
      });
    });
  }

  function sortModeDescription(mode) {
    switch (mode) {
      case 'alpha':   return 'A → Z by vendor name';
      case 'custom':  return 'Manually arranged — tap Reorder to drag';
      case 'recent':  return 'Most recent activity first';
      case 'busiest': return 'Most-ordered vendors first';
      default:        return '';
    }
  }

  /**
   * Bind pointer-event drag handlers to the vendor list. Touch and
   * mouse both flow through the same path. The dragged row is given
   * .is-dragging which lifts it visually; the row currently being
   * hovered gets .is-drop-target (a thin gold line above or below).
   * On pointerup, we compute the final ordering and persist via
   * persistVendorSortOrder.
   */
  function wireVendorDragHandlers(listEl) {
    let draggingId = null;
    let startY = 0;
    let placeholder = null;
    let liveOrder = []; // current visual order during drag

    const handles = listEl.querySelectorAll('.ord-vendor-drag-handle');
    handles.forEach(handle => {
      handle.addEventListener('pointerdown', onPointerDown);
    });

    function onPointerDown(e) {
      e.preventDefault();
      const handle = e.currentTarget;
      const wrap = handle.closest('.ord-vendor-row-wrap');
      if (!wrap) return;
      draggingId = wrap.dataset.vendorId;
      startY = e.clientY;
      wrap.classList.add('is-dragging');
      // Snapshot current visual order so we can mutate it as we drag.
      liveOrder = Array.from(listEl.querySelectorAll('.ord-vendor-row-wrap'))
                       .map(w => w.dataset.vendorId);
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup',   onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
      if (!draggingId) return;
      const wrap = listEl.querySelector(`.ord-vendor-row-wrap[data-vendor-id="${draggingId}"]`);
      if (!wrap) return;
      const dy = e.clientY - startY;
      wrap.style.transform = `translateY(${dy}px)`;

      // Find the row whose vertical center we're closest to and swap.
      const others = Array.from(listEl.querySelectorAll('.ord-vendor-row-wrap'))
                          .filter(w => w.dataset.vendorId !== draggingId);
      const wrapRect = wrap.getBoundingClientRect();
      const wrapCenter = wrapRect.top + wrapRect.height / 2;
      for (const other of others) {
        const r = other.getBoundingClientRect();
        const otherCenter = r.top + r.height / 2;
        if (wrapCenter > r.top && wrapCenter < r.bottom) {
          // We've crossed over this row's center — swap positions.
          const fromIdx = liveOrder.indexOf(draggingId);
          const toIdx = liveOrder.indexOf(other.dataset.vendorId);
          if (fromIdx !== -1 && toIdx !== -1) {
            liveOrder.splice(fromIdx, 1);
            liveOrder.splice(toIdx, 0, draggingId);
            // Reflect the new order in the DOM (excluding the dragged
            // row's transform — it stays under the user's finger).
            applyDOMOrder(listEl, liveOrder);
            // Reset the drag offset relative to the row's new position.
            startY = e.clientY;
            wrap.style.transform = 'translateY(0px)';
          }
          break;
        }
      }
    }

    async function onPointerUp(e) {
      if (!draggingId) return;
      const handle = e.currentTarget;
      const wrap = listEl.querySelector(`.ord-vendor-row-wrap[data-vendor-id="${draggingId}"]`);
      if (wrap) {
        wrap.classList.remove('is-dragging');
        wrap.style.transform = '';
      }
      handle.releasePointerCapture?.(e.pointerId);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup',   onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
      const finalOrder = liveOrder.slice();
      draggingId = null;
      liveOrder = [];
      // Persist if order actually changed.
      await persistVendorSortOrder(finalOrder);
    }

    function applyDOMOrder(container, order) {
      // Re-append wraps in the new order. The browser handles repaints.
      const wraps = {};
      container.querySelectorAll('.ord-vendor-row-wrap').forEach(w => {
        wraps[w.dataset.vendorId] = w;
      });
      order.forEach(id => {
        if (wraps[id]) container.appendChild(wraps[id]);
      });
    }
  }

  /**
   * Persist the user's manual sort order. Each visible vendor gets a
   * sort_order value matching its position in the list. Pinned vendors
   * stay separate (they always float top), so we track their ordering
   * inside their own group.
   */
  async function persistVendorSortOrder(idOrder) {
    if (!NX.sb || !idOrder || !idOrder.length) return;
    // Build an update per vendor: sort_order = index. We only update
    // the values that changed from the in-memory state to keep writes
    // minimal.
    const updates = [];
    idOrder.forEach((id, idx) => {
      const v = vendors.find(x => x.id === id);
      if (v && v.sort_order !== idx) {
        updates.push({ id, sort_order: idx });
      }
    });
    if (!updates.length) return;
    // Apply optimistically to in-memory state first so the UI matches
    // even if a network failure delays the actual write.
    updates.forEach(u => {
      const v = vendors.find(x => x.id === u.id);
      if (v) v.sort_order = u.sort_order;
    });
    // Run updates in parallel; tolerate per-row failures.
    try {
      await Promise.all(updates.map(u =>
        NX.sb.from('order_vendors').update({ sort_order: u.sort_order }).eq('id', u.id)
      ));
      if (NX.toast) NX.toast(`Reordered ${updates.length} vendor${updates.length === 1 ? '' : 's'}`, 'info', 1100);
    } catch (e) {
      console.error('[ordering] persistVendorSortOrder:', e);
      const msg = (e && e.message) || '';
      if (/column|schema|does not exist|could not find/i.test(msg)) {
        if (NX.toast) NX.toast('Reordering needs a DB migration — see notes', 'warn', 2400);
      } else {
        if (NX.toast) NX.toast('Could not save order: ' + msg, 'error');
      }
    }
  }

  /**
   * Bottom sheet shown when a user taps the ⋮ on a vendor row. Lists
   * the actions available for that vendor: edit, archive. Tap on
   * backdrop or Cancel to dismiss.
   */
  function showVendorMenu(vendor) {
    // Remove any existing menu first
    const existing = document.querySelector('.ord-vmenu-overlay');
    if (existing) existing.remove();

    // Look up the most recent non-archived sent/closed order at the
    // active location BEFORE rendering, so we can show the "Reorder
    // last" item with helpful context ("from 4 days ago") and disable
    // it correctly when there's nothing to reorder.
    const recentForVendor = (recentOrders || [])
      .filter(o => o.vendor_id === vendor.id
                && o.location === activeLoc
                && !o.archived_at
                && o.status !== 'draft');
    const lastSent = recentForVendor[0];
    const lastSentLabel = lastSent && lastSent.updated_at
      ? `from ${fmtActivityWhen(lastSent.updated_at)}`
      : 'no past orders found';

    const overlay = document.createElement('div');
    overlay.className = 'ord-vmenu-overlay';
    overlay.innerHTML = `
      <div class="ord-vmenu-backdrop"></div>
      <div class="ord-vmenu-sheet">
        <div class="ord-vmenu-handle"></div>
        <div class="ord-vmenu-header">
          ${vendorAvatar(vendor.name, vendor.image_url, vendor.avatar_hue)}
          <div class="ord-vmenu-header-text">
            <div class="ord-vmenu-title">${esc(vendor.name)}</div>
            ${vendor.email ? `<div class="ord-vmenu-sub">${esc(vendor.email)}</div>` : '<div class="ord-vmenu-sub ord-vmenu-sub-warn">No email set</div>'}
          </div>
        </div>
        <div class="ord-vmenu-divider"></div>
        <button class="ord-vmenu-item ord-vmenu-item-primary${lastSent ? '' : ' is-disabled'}" data-action="reorder-last"${lastSent ? '' : ' disabled'}>
          ${reorderIcon()}<span class="ord-vmenu-item-text">
            <span class="ord-vmenu-item-title">Reorder last</span>
            <span class="ord-vmenu-item-sub">${esc(lastSentLabel)}</span>
          </span>
        </button>
        <button class="ord-vmenu-item" data-action="catalog">${listIcon()}<span>Edit catalog</span></button>
        <button class="ord-vmenu-item" data-action="edit">${editIcon()}<span>Edit details</span></button>
        <button class="ord-vmenu-item ord-vmenu-danger" data-action="archive">${trashIcon()}<span>Archive vendor</span></button>
        <button class="ord-vmenu-cancel" data-action="cancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); };
    overlay.querySelector('.ord-vmenu-backdrop').addEventListener('click', close);
    overlay.querySelector('.ord-vmenu-cancel').addEventListener('click', close);
    overlay.querySelectorAll('.ord-vmenu-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.classList.contains('is-disabled')) return;
        const action = btn.dataset.action;
        close();
        if (action === 'edit')              openVendorEditor(vendor);
        else if (action === 'catalog')      openCatalogEditor(vendor);
        else if (action === 'order')        openVendor(vendor.id);
        else if (action === 'archive')      archiveVendorById(vendor.id, vendor.name);
        else if (action === 'reorder-last' && lastSent) {
          duplicateOrderAsDraft(lastSent);
        }
      });
    });
  }

  /* Inline-rendered SVG used by the Reorder action — circular arrow
     suggesting "do this again." Defined here because it's used only
     in this menu. */
  function reorderIcon() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15A9 9 0 1 1 18.36 5.64L23 10"/>
    </svg>`;
  }

  function filterVendors(query) {
    const q = (query || '').trim().toLowerCase();
    const root = document.getElementById('ordVendors');
    if (!root) return;
    let any = false;
    root.querySelectorAll('.ord-vendor-row-wrap').forEach(wrap => {
      const row = wrap.querySelector('.ord-vendor-row');
      const name = row ? row.dataset.vendorName : '';
      const match = !q || name.includes(q);
      wrap.style.display = match ? '' : 'none';
      if (match) any = true;
    });
  }

  async function setLocation(loc) {
    if (!LOCS.some(l => l.id === loc) || loc === activeLoc) return;
    activeLoc = loc;
    try { localStorage.setItem(LOC_KEY, loc); } catch (_) {}
    document.querySelectorAll('.ord-loc-btn').forEach(b => {
      const match = b.dataset.loc === loc;
      b.classList.toggle('active', match);
      b.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    recentOrders = await loadRecentOrders(loc);
    const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
    renderRecent(recentOrders, vmap);
    // Re-render vendor list too — activity-preview lines depend on
    // recentOrders (which is location-scoped), so changing location
    // changes what each vendor card shows.
    renderVendors();
  }

  // ═══════════════════════════════════════════════════════════════════
  // VENDOR DETAIL OVERLAY  —  past orders + start new order CTA
  // ═══════════════════════════════════════════════════════════════════
  // Triggered by tapping a vendor row in the list. Replaces the old
  // "go straight to the entry overlay" behavior — adding a one-tap
  // detour gives the user context (recent orders, draft state) before
  // committing to a new order. Modeled after BlueCart's vendor view.
  //
  // Layers:
  //   1. Header  — back, avatar+name, pin-toggle, gear (→ editor)
  //   2. Body    — past orders for this vendor at active location,
  //                date-bucketed (today/yesterday/this-week/older)
  //   3. Sticky bottom — large "Start new order" or "Continue draft"
  //                CTA + small archive link
  //
  // Persisted draft is detected on open so the CTA flips automatically.

  let detailState = null;

  async function loadVendorOrders(vendorId, location, limit = 50) {
    if (!NX.sb) return [];
    const { data, error } = await NX.sb
      .from('orders')
      .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at, updated_at, created_by_name, sent_by_name, confirmed_at, delivered_at, closed_at, issue_at, issue_note, archived_at')
      .eq('vendor_id', vendorId)
      .eq('location', location)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) {
      dwarn('[ordering] loadVendorOrders new cols failed, falling back:', error.message || error);
      const fb = await NX.sb
        .from('orders')
        .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at, updated_at')
        .eq('vendor_id', vendorId)
        .eq('location', location)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (fb.error) { console.error('[ordering] loadVendorOrders:', fb.error); return []; }
      return fb.data || [];
    }
    return data || [];
  }

  /* Load only ARCHIVED orders for a vendor at a location. Used by the
     "Show archived" expander in the vendor detail so the user can find
     and restore them. Mirrors the ordering of loadVendorOrders so it
     reads the same way. */
  async function loadVendorArchivedOrders(vendorId, location, limit = 50) {
    if (!NX.sb) return [];
    const { data, error } = await NX.sb
      .from('orders')
      .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at, updated_at, created_by_name, sent_by_name, confirmed_at, delivered_at, closed_at, issue_at, issue_note, archived_at')
      .eq('vendor_id', vendorId)
      .eq('location', location)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(limit);
    if (error) {
      // Pre-migration: column doesn't exist, no archived to show
      console.warn('[ordering] loadVendorArchivedOrders:', error.message || error);
      return [];
    }
    return data || [];
  }

  async function openVendorDetail(vendorId) {
    const vendor = vendors.find(v => v.id === vendorId);
    if (!vendor) {
      if (NX.toast) NX.toast('Vendor not found', 'error');
      return;
    }

    // Tear down any existing detail overlay (in case of double-tap).
    closeVendorDetail();

    const overlay = document.createElement('div');
    overlay.className = 'ord-vdetail-overlay';
    document.body.appendChild(overlay);
    document.body.classList.add('ord-overlay-open');

    detailState = {
      vendor,
      orders: [],
      ordersLoading: true,
      hasDraft: false,
      overlay,
      archivedOrders: [],
      archivedExpanded: false,
      archivedLoading: false,
    };

    renderVendorDetail();   // initial paint with loading state

    try {
      // Load active + archived in parallel so the expander knows whether
      // to show itself by the time the first paint completes.
      const [orders, archived] = await Promise.all([
        loadVendorOrders(vendor.id, activeLoc),
        loadVendorArchivedOrders(vendor.id, activeLoc),
      ]);
      if (!detailState || detailState.overlay !== overlay) return;  // user closed before load completed
      detailState.orders = orders;
      detailState.archivedOrders = archived;
      detailState.ordersLoading = false;
      detailState.hasDraft = orders.some(o => o.status === 'draft');
      renderVendorDetail();
    } catch (e) {
      console.error('[ordering] openVendorDetail:', e);
      if (detailState) {
        detailState.ordersLoading = false;
        renderVendorDetail();
      }
    }
  }

  function closeVendorDetail() {
    if (!detailState) return;
    if (detailState.overlay && detailState.overlay.parentNode) {
      detailState.overlay.parentNode.removeChild(detailState.overlay);
    }
    detailState = null;
    // Drop the body class only if no other overlay is also open.
    // (When detail closes because the editor is opening, the editor's
    // own open path will re-apply the class; checking ensures we don't
    // strand the bnav visible if both overlays were ever stacked.)
    const stillOpen = !!document.querySelector('.ord-veditor-overlay, .ord-entry-overlay');
    if (!stillOpen) document.body.classList.remove('ord-overlay-open');
  }

  function renderVendorDetail() {
    if (!detailState || !detailState.overlay) return;
    const { vendor, orders, ordersLoading, hasDraft, overlay, archivedOrders, archivedExpanded } = detailState;
    // v18.29 — pluck the most-recent active draft row for use in the
    // "Continue draft from {time}" link. orders is already sorted by
    // updated_at desc, so .find(...) returns the freshest draft.
    const draftRow = (orders || []).find(o => (o.status || 'draft') === 'draft');

    // Relative-time formatter for the continue-draft link.
    // "5 minutes ago", "2 hours ago", "yesterday", "Mon", "May 11"
    const fmtRelTime = ts => {
      if (!ts) return '';
      const d = new Date(ts);
      if (isNaN(d)) return '';
      const now = new Date();
      const diffMs = now - d;
      const mins = Math.round(diffMs / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
      const hours = Math.round(mins / 60);
      if (hours < 6) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
      // Same day → show time of day
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      }
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
      const days = Math.round(diffMs / 86400000);
      if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    // Header: back, avatar+identity, pin-toggle, gear
    const headerHTML = `
      <div class="ord-vdetail-head">
        <button class="ord-vdetail-back" aria-label="Back to vendors">${arrowLeftIcon()}</button>
        <div class="ord-vdetail-identity">
          ${vendorAvatar(vendor.name, vendor.image_url, vendor.avatar_hue)}
          <div class="ord-vdetail-identity-text">
            <div class="ord-vdetail-name">${esc(vendor.name)}</div>
            <div class="ord-vdetail-sub">${vendor.email ? esc(vendor.email) : '<span class="ord-vdetail-sub-warn">No email set</span>'}</div>
          </div>
        </div>
        <button class="ord-vdetail-pin ${vendor.pinned ? 'is-pinned' : ''}" aria-label="${vendor.pinned ? 'Unpin' : 'Pin to top'}" data-action="pin">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="${vendor.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
          </svg>
        </button>
        <button class="ord-vdetail-gear" aria-label="Edit vendor settings" data-action="edit">${gearIcon()}</button>
      </div>
    `;

    // Body: past orders, date-bucketed
    let bodyHTML;
    if (ordersLoading) {
      bodyHTML = `<div class="ord-vdetail-loading">Loading order history…</div>`;
    } else if (!orders.length) {
      bodyHTML = `
        <div class="ord-vdetail-empty">
          <div class="ord-vdetail-empty-title">No orders yet</div>
          <div class="ord-vdetail-empty-msg">Tap below to start the first order from ${esc(vendor.name)}.</div>
        </div>`;
    } else {
      const bucketOf = ts => {
        if (!ts) return 'older';
        const d = new Date(ts), now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        if (sameDay) return 'today';
        const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
        const diff = (now - d) / 86400000;
        if (diff < 7) return 'thisweek';
        return 'older';
      };
      const bucketLabel = {
        today:     'TODAY',
        yesterday: 'YESTERDAY',
        thisweek:  'EARLIER THIS WEEK',
        older:     'OLDER',
      };
      let lastBucket = null;
      const rowsHTML = orders.map(o => {
        const status = o.status || 'draft';
        const when = fmtActivityWhen(o.updated_at || o.created_at);
        const deliv = o.delivery_date ? fmtDateShort(o.delivery_date) : '';
        const bucket = bucketOf(o.updated_at || o.created_at);
        let dividerHTML = '';
        if (bucket !== lastBucket) {
          dividerHTML = `<div class="ord-recent-divider">${bucketLabel[bucket]}</div>`;
          lastBucket = bucket;
        }
        return `${dividerHTML}
          <button class="ord-recent-row" data-order-id="${esc(o.id)}">
            <div class="ord-recent-main">
              <div class="ord-recent-vendor-row">
                <span class="ord-status ord-status-${esc(status)}">${esc(status)}</span>
                <span class="ord-recent-when">${esc(when)}</span>
              </div>
              <div class="ord-recent-meta">
                ${deliv ? `deliver ${esc(deliv)} · ` : ''}<span class="ord-recent-id">${esc(o.id.slice(0, 8))}</span>
              </div>
            </div>
            <div class="ord-arrow" aria-hidden="true">›</div>
          </button>`;
      }).join('');
      bodyHTML = `<div class="ord-vdetail-orders">${rowsHTML}</div>`;
    }

    // Archived-orders expander. Lives at the bottom of the orders body
    // so it doesn't compete with the active list, and only renders when
    // there's at least one archived order to find. Collapsed: a single
    // muted line ("3 archived orders ▾"). Expanded: each archived order
    // with timestamp + a restore button.
    const archivedCount = (archivedOrders || []).length;
    let archivedHTML = '';
    if (archivedCount > 0) {
      const archivedRowsHTML = archivedExpanded
        ? archivedOrders.map(o => {
            const status = o.status || 'sent';
            const archAt = o.archived_at ? fmtActivityWhen(o.archived_at) : '';
            const shortId = o.id ? o.id.slice(0, 8) : '';
            return `
              <div class="ord-vdetail-archived-row">
                <div class="ord-vdetail-archived-main">
                  <div class="ord-vdetail-archived-meta">
                    <span class="ord-status ord-status-${esc(status)}">${esc(status)}</span>
                    <span class="ord-vdetail-archived-when">archived ${esc(archAt)}</span>
                  </div>
                  <div class="ord-vdetail-archived-id">${esc(shortId)}</div>
                </div>
                <button class="ord-vdetail-archived-restore" data-action="restore" data-order-id="${esc(o.id)}" type="button">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M3.51 15a9 9 0 1 0 .49-5"/>
                  </svg>
                  <span>Restore</span>
                </button>
              </div>`;
          }).join('')
        : '';
      archivedHTML = `
        <div class="ord-vdetail-archived-block">
          <button class="ord-vdetail-archived-toggle" data-action="toggle-archived" type="button" aria-expanded="${archivedExpanded ? 'true' : 'false'}">
            <span class="ord-vdetail-archived-label">
              ${archivedCount} archived order${archivedCount === 1 ? '' : 's'}
            </span>
            <span class="ord-vdetail-archived-chev" aria-hidden="true">${archivedExpanded ? '▴' : '▾'}</span>
          </button>
          ${archivedExpanded ? `<div class="ord-vdetail-archived-list">${archivedRowsHTML}</div>` : ''}
        </div>
      `;
    }
    bodyHTML = bodyHTML + archivedHTML;

    // v18.29 — Sticky CTA rework. Was an auto-flipping label
    // ("Continue order" when a draft existed, else "Start new
    // order"). Both led to the same flow — kept work in the existing
    // draft. New model is cleaner:
    //
    //   Primary button: ALWAYS "New order" — starts fresh. Any
    //   existing draft is auto-archived first (recoverable from
    //   the archived block below). Chef expectation matches result.
    //
    //   Secondary text link: only renders when a draft exists.
    //   Plain-text affordance "Continue draft from {time} →" sits
    //   under the primary button so the existing draft is one tap
    //   away without being the path of least resistance.
    //
    // The auto-archive on New order is the safety net we picked
    // over a confirmation dialog: drafts persist as recoverable
    // records, so no work is lost; nothing's destructive, just
    // moved to the archived list.
    const draftTimeLabel = hasDraft && draftRow && draftRow.updated_at
      ? fmtRelTime(draftRow.updated_at)
      : '';
    const footerHTML = `
      <div class="ord-vdetail-foot">
        <button class="ord-vdetail-cta" data-action="start-order">
          <span>New order</span>
          <span class="ord-vdetail-cta-arrow" aria-hidden="true">→</span>
        </button>
        ${hasDraft ? `
          <button class="ord-vdetail-continue-link" data-action="continue-draft" type="button">
            <span>Continue draft${draftTimeLabel ? ` from ${esc(draftTimeLabel)}` : ''}</span>
            <span aria-hidden="true">→</span>
          </button>
        ` : ''}
      </div>
    `;

    overlay.innerHTML = headerHTML + `<div class="ord-vdetail-body">${bodyHTML}</div>` + footerHTML;

    // Wiring
    overlay.querySelector('.ord-vdetail-back').addEventListener('click', closeVendorDetail);
    overlay.querySelector('[data-action="pin"]').addEventListener('click', () => toggleVendorPin(vendor));
    overlay.querySelector('[data-action="edit"]').addEventListener('click', () => {
      closeVendorDetail();
      // openVendorEditor takes the full vendor object (or null for new),
      // not just an ID. Passing vendor.id used to spread the string and
      // produce { 0: '4', 1: '0', ... } with no .id field, which then
      // crashed saveVendor with an "undefined uuid" Postgres error.
      openVendorEditor(vendor);
    });
    // v18.29 — Primary "New order" click. If a draft exists, archive
    // it first so openVendor() starts a genuinely fresh draft. The
    // old draft becomes recoverable from the Archived block above.
    // Pass forceEmpty: true so the new draft starts at 0 qty for
    // every item — fresh start ignoring the vendor's auto-fill mode.
    overlay.querySelector('[data-action="start-order"]').addEventListener('click', async () => {
      const vid = vendor.id;
      const draftId = (hasDraft && draftRow && draftRow.id) || null;
      closeVendorDetail();
      if (draftId) {
        try {
          await archiveOrder(draftId);
        } catch (err) {
          console.error('[ordering] auto-archive draft on New order:', err);
          if (NX.toast) NX.toast(
            `Could not archive prior draft: ${err.message || 'unknown'}`,
            'warn', 3000
          );
          // Fall through and still try to open — openVendor will pick
          // up the still-present draft (graceful fallback).
        }
      }
      openVendor(vid, { forceEmpty: true });
    });
    // v18.29 — Secondary "Continue draft" link. Goes straight to the
    // existing draft without touching it.
    const continueLink = overlay.querySelector('[data-action="continue-draft"]');
    if (continueLink) {
      continueLink.addEventListener('click', () => {
        const did = (draftRow && draftRow.id) || null;
        if (!did) return;
        closeVendorDetail();
        openExistingOrder(did);
      });
    }
    overlay.querySelectorAll('.ord-recent-row').forEach(b => {
      b.addEventListener('click', () => {
        const oid = b.dataset.orderId;
        closeVendorDetail();
        openExistingOrder(oid);
      });
    });

    // Archived expander toggle
    overlay.querySelector('[data-action="toggle-archived"]')?.addEventListener('click', () => {
      if (!detailState) return;
      detailState.archivedExpanded = !detailState.archivedExpanded;
      renderVendorDetail();
    });

    // Restore individual archived order. Restoration is safe (worst
    // case: order shows up again), so no confirm modal — just do it
    // and toast the result.
    overlay.querySelectorAll('[data-action="restore"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const oid = btn.dataset.orderId;
        const shortId = (oid || '').slice(0, 8).toUpperCase();
        btn.disabled = true;
        btn.querySelector('span').textContent = 'Restoring…';
        try {
          await restoreOrder(oid);
          // Refresh the detailState orders so the UI reflects reality
          if (detailState && detailState.vendor && detailState.vendor.id === vendor.id) {
            const [fresh, freshArch] = await Promise.all([
              loadVendorOrders(vendor.id, activeLoc),
              loadVendorArchivedOrders(vendor.id, activeLoc),
            ]);
            detailState.orders = fresh;
            detailState.archivedOrders = freshArch;
            detailState.hasDraft = fresh.some(o => o.status === 'draft');
            renderVendorDetail();
          }
          if (NX.toast) NX.toast(`Restored order ${shortId}`, 'info', 1800);
        } catch (e) {
          console.error('[ordering] restoreOrder:', e);
          btn.disabled = false;
          btn.querySelector('span').textContent = 'Restore';
          if (NX.toast) NX.toast('Could not restore: ' + ((e && e.message) || ''), 'error', 4000);
        }
      });
    });
  }

  /** Toggle the pinned state on a vendor and persist to DB. */
  async function toggleVendorPin(vendor) {
    if (!NX.sb || !vendor) return;
    const newPinned = !vendor.pinned;
    const { error } = await NX.sb.from('order_vendors')
      .update({ pinned: newPinned })
      .eq('id', vendor.id);
    if (error) {
      const msg = (error.message || '') + '';
      if (/column|schema|does not exist|could not find/i.test(msg)) {
        if (NX.toast) NX.toast('Pinning needs a DB migration — see notes', 'warn', 2400);
      } else {
        if (NX.toast) NX.toast('Could not update pin: ' + msg, 'error');
      }
      console.error('[ordering] toggleVendorPin:', error);
      return;
    }
    vendor.pinned = newPinned;
    // Re-render both surfaces so the change is visible everywhere.
    if (detailState) renderVendorDetail();
    renderVendors();
    if (NX.toast) NX.toast(newPinned ? 'Pinned to top' : 'Unpinned', 'info', 1100);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ORDER DETAIL OVERLAY  —  read-only card view for sent/delivered
  // ═══════════════════════════════════════════════════════════════════
  // Modeled after the BlueCart order detail screen (Image 5). Shows the
  // order's location, delivery date, products, and notes as a vertical
  // stack of cards. Sticky bottom: REPORT ISSUES (amber, primary) and
  // REORDER (gold-soft, secondary). Tapping × goes back to wherever
  // the user came from (vendor detail or recent list).
  //
  // Why a separate view from the entry overlay:
  //   - Sent orders are reference material, not work surfaces. The rich
  //     editor's qty steppers, par hints, and search bar are noise here.
  //   - The reference treats "I'm placing an order" and "I'm looking up
  //     a past order" as distinct flows. NEXUS now does the same.
  //   - REPORT ISSUES is a per-order action that doesn't belong on the
  //     entry overlay. Putting it on detail keeps the surface clean.

  let orderDetailState = null;

  function openOrderDetail(order) {
    if (!order) return;

    // Tear down any existing detail (defensive).
    closeOrderDetail();

    const overlay = document.createElement('div');
    overlay.className = 'ord-odetail-overlay';
    document.body.appendChild(overlay);
    document.body.classList.add('ord-overlay-open');

    orderDetailState = { order, overlay };
    renderOrderDetail();
  }

  function closeOrderDetail() {
    if (!orderDetailState) return;
    if (orderDetailState.overlay && orderDetailState.overlay.parentNode) {
      orderDetailState.overlay.parentNode.removeChild(orderDetailState.overlay);
    }
    orderDetailState = null;
    const stillOpen = !!document.querySelector('.ord-veditor-overlay, .ord-entry-overlay, .ord-vdetail-overlay');
    if (!stillOpen) document.body.classList.remove('ord-overlay-open');
  }

  function renderOrderDetail() {
    if (!orderDetailState || !orderDetailState.overlay) return;
    const { order, overlay } = orderDetailState;
    const vendor = vendors.find(v => v.id === order.vendor_id);
    const vendorName = vendor ? vendor.name : 'Unknown vendor';
    const locLabel = (LOCS.find(l => l.id === order.location) || {}).label || order.location || '—';

    // Lines block — each a [qty] [name + unit] row, mirroring the
    // reference's product list. Empty state if the order has no lines.
    const lines = order.lines || [];
    const linesHTML = lines.length
      ? lines.map(l => {
          const qty = parseFloat(l.qty);
          const qtyDisplay = (qty && qty > 0) ? (Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '')) : '0';
          const unit = (l.unit || '').toLowerCase();
          // Display name precedence: team's name (house_name) when set,
          // else vendor's name. Vendor name shows as an alias when both
          // exist and differ — gives the team a fast cross-check against
          // what the vendor will see on their end.
          const houseName  = (l.house_name || '').trim();
          const vendorName = (l.item_name  || '').trim();
          const name = houseName || vendorName || '(unnamed item)';
          const showAlias = houseName && vendorName && houseName !== vendorName;
          const note = l.note ? `<div class="ord-odetail-line-note">${esc(l.note)}</div>` : '';
          return `
            <div class="ord-odetail-line">
              <div class="ord-odetail-line-qty">${esc(qtyDisplay)}</div>
              <div class="ord-odetail-line-body">
                <div class="ord-odetail-line-name">${esc(name)}</div>
                ${showAlias ? `<div class="ord-odetail-line-alias">${esc(vendorName)}</div>` : ''}
                <div class="ord-odetail-line-unit">${esc(unit)}</div>
                ${note}
              </div>
            </div>`;
        }).join('')
      : '<div class="ord-odetail-empty-lines">No items recorded on this order.</div>';

    const status = order.status || 'sent';
    const orderShortId = order.id ? order.id.slice(0, 8).toUpperCase() : '—';

    // Sender / creator attribution. We prefer sent_by_name (who actually
    // hit Send) over created_by_name (who started the draft) when the
    // order has been sent — that's usually who the vendor talks to.
    const attribution = (status === 'draft')
      ? (order.created_by_name ? `started by ${esc(order.created_by_name)}` : '')
      : (order.sent_by_name ? `sent by ${esc(order.sent_by_name)}`
        : (order.created_by_name ? `by ${esc(order.created_by_name)}` : ''));

    // Status lifecycle timeline. Each stage shows its label, a check or
    // pending dot, and the timestamp it was reached. Visualizes "where
    // is this order in its journey" at a glance.
    const currentIdx = ORDER_LIFECYCLE.indexOf(status);
    const timelineHTML = `
      <div class="ord-odetail-timeline">
        ${ORDER_LIFECYCLE.map((s, i) => {
          const reached = i <= currentIdx;
          const isCurrent = i === currentIdx;
          const ts = reached ? fmtLifecycleTs(tsForStatus(order, s)) : '';
          const cls = ['ord-odetail-tl-step'];
          if (reached) cls.push('is-reached');
          if (isCurrent) cls.push('is-current');
          return `
            <div class="${cls.join(' ')}"${reached && i > 0 ? ` data-revert-status="${esc(s)}"` : ''}${reached && i > 0 ? ' role="button" aria-label="Long-press to revert to this step"' : ''}>
              <div class="ord-odetail-tl-marker" aria-hidden="true">
                ${reached
                  ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                  : ''}
              </div>
              <div class="ord-odetail-tl-text">
                <div class="ord-odetail-tl-label">${esc(ORDER_LIFECYCLE_LABELS[s])}</div>
                ${ts ? `<div class="ord-odetail-tl-ts">${esc(ts)}</div>` : ''}
              </div>
            </div>
            ${i < ORDER_LIFECYCLE.length - 1 ? `<div class="ord-odetail-tl-bar ${i < currentIdx ? 'is-reached' : ''}"></div>` : ''}
          `;
        }).join('')}
      </div>
    `;

    // Next-status transition button. Forward-only — no backwards moves.
    // 'closed' is terminal; nothing further to do.
    let transitionBtnHTML = '';
    const nextStatus = ORDER_LIFECYCLE[currentIdx + 1];
    if (nextStatus && status !== 'draft') {
      // Drafts shouldn't show "mark sent" here — that flow belongs in
      // the entry overlay's review/send screen, where the email is
      // composed properly. Detail view is only for already-sent.
      const nextLabel = ORDER_LIFECYCLE_LABELS[nextStatus];
      transitionBtnHTML = `
        <button class="ord-odetail-transition" data-action="advance" data-target="${esc(nextStatus)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Mark ${esc(nextLabel.toLowerCase())}</span>
        </button>`;
    }

    // Issue banner — surfaces when issue_at is set, regardless of status.
    // Lets the user clear the issue once resolved.
    const issueBannerHTML = order.issue_at ? `
      <div class="ord-odetail-issue-banner">
        <div class="ord-odetail-issue-banner-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div class="ord-odetail-issue-banner-text">
          <div class="ord-odetail-issue-banner-title">Issue reported · ${esc(fmtLifecycleTs(order.issue_at))}</div>
          ${order.issue_note ? `<div class="ord-odetail-issue-banner-note">${esc(order.issue_note)}</div>` : ''}
        </div>
        <button class="ord-odetail-issue-banner-resolve" data-action="resolve-issue" aria-label="Mark issue resolved">Resolve</button>
      </div>
    ` : '';

    overlay.innerHTML = `
      <div class="ord-odetail-head">
        <button class="ord-odetail-close" aria-label="Close order detail">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="ord-odetail-head-text">
          <div class="ord-odetail-vendor">${esc(vendorName)}</div>
          <div class="ord-odetail-id">
            order ${esc(orderShortId)} · <span class="ord-status ord-status-${esc(status)}">${esc(status)}</span>
            ${attribution ? `<span class="ord-odetail-attribution"> · ${attribution}</span>` : ''}
          </div>
        </div>
        <button class="ord-odetail-menu" aria-label="More options" data-action="more">${dotsIcon()}</button>
      </div>

      <div class="ord-odetail-body">
        ${issueBannerHTML}
        ${timelineHTML}
        ${transitionBtnHTML}

        <div class="ord-odetail-card">
          <div class="ord-odetail-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>
          <div class="ord-odetail-card-body">
            <div class="ord-odetail-card-label">location</div>
            <div class="ord-odetail-card-value">${esc(locLabel)}</div>
          </div>
        </div>

        <div class="ord-odetail-card">
          <div class="ord-odetail-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div class="ord-odetail-card-body">
            <div class="ord-odetail-card-label">delivery date</div>
            <div class="ord-odetail-card-value">${order.delivery_date ? esc(fmtDateLong(order.delivery_date)) : 'Not set'}</div>
          </div>
        </div>

        ${order.notes ? `
        <div class="ord-odetail-card ord-odetail-card-notes">
          <div class="ord-odetail-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <div class="ord-odetail-card-body">
            <div class="ord-odetail-card-label">notes</div>
            <div class="ord-odetail-card-value ord-odetail-card-value-pre">${esc(order.notes)}</div>
          </div>
        </div>` : ''}

        <div class="ord-odetail-section-label">products ordered <span class="ord-odetail-section-count">${lines.length}</span></div>
        <div class="ord-odetail-lines">${linesHTML}</div>
      </div>

      <div class="ord-odetail-foot">
        <button class="ord-odetail-action ord-odetail-action-secondary" data-action="reorder">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>Reorder</span>
        </button>
        <button class="ord-odetail-action ord-odetail-action-issue" data-action="report-issue">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Report issues</span>
        </button>
      </div>
    `;

    overlay.querySelector('.ord-odetail-close').addEventListener('click', closeOrderDetail);
    overlay.querySelector('[data-action="reorder"]').addEventListener('click', () => reorderFromOrder(order));
    overlay.querySelector('[data-action="report-issue"]').addEventListener('click', () => reportIssuesOnOrder(order));
    overlay.querySelector('[data-action="more"]')?.addEventListener('click', () => showOrderMoreMenu(order));
    overlay.querySelector('[data-action="advance"]')?.addEventListener('click', e => {
      const target = e.currentTarget.dataset.target;
      transitionOrderTo(order, target);
    });
    overlay.querySelector('[data-action="resolve-issue"]')?.addEventListener('click', () => resolveOrderIssue(order));

    // Long-press a reached timeline step to revert the order back to
    // that status. Forward-only is the default lifecycle, but mistakes
    // happen — clicked Confirmed too early, accidentally tapped
    // Delivered. 600ms touch-and-hold gives an explicit, deliberate
    // gesture that won't fire from incidental taps.
    overlay.querySelectorAll('[data-revert-status]').forEach(step => {
      let pressTimer = null;
      let pressed = false;
      const start = (e) => {
        // Only respond to primary button on mouse; touch always starts
        if (e.type === 'mousedown' && e.button !== 0) return;
        pressed = true;
        step.classList.add('is-pressing');
        pressTimer = setTimeout(() => {
          if (!pressed) return;
          step.classList.remove('is-pressing');
          // Provide haptic if available — telegraphs that the action was triggered
          if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
          confirmRevertTo(order, step.dataset.revertStatus);
        }, 600);
      };
      const cancel = () => {
        pressed = false;
        step.classList.remove('is-pressing');
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      };
      step.addEventListener('touchstart', start, { passive: true });
      step.addEventListener('mousedown',  start);
      step.addEventListener('touchend',   cancel);
      step.addEventListener('touchcancel',cancel);
      step.addEventListener('touchmove',  cancel, { passive: true });
      step.addEventListener('mouseup',    cancel);
      step.addEventListener('mouseleave', cancel);
    });
  }

  /**
   * Clone a sent order's lines into a fresh draft. Opens the entry
   * overlay pre-populated with the source's items + quantities, but
   * with a NEW draftOrderId (autosave will insert a new row instead
   * of modifying the source). Delivery date defaults to the next
   * scheduled delivery for the vendor — the user can change it.
   */
  async function reorderFromOrder(sourceOrder) {
    if (!sourceOrder) return;
    const vendor = vendors.find(v => v.id === sourceOrder.vendor_id);
    if (!vendor) { if (NX.toast) NX.toast('Vendor missing for this order', 'error'); return; }

    closeOrderDetail();

    // Fresh state — draftOrderId starts null so autosave inserts new row.
    entryState = {
      vendor, catalog: [], par_overrides: {},
      location:      sourceOrder.location || activeLoc,
      delivery_date: nextDeliveryDate(vendor, location),
      notes:         '',
      lines:         {},
      unitOverrides: loadUnitOverrides(vendor.id),
      draftOrderId:  null,
      saveTimer:     null,
      saveInFlight:  false,
      overlay:       null,
      reviewing:     false,
      readOnly:      false,
    };
    (sourceOrder.lines || []).forEach(l => {
      if (l.item_id) {
        entryState.lines[l.item_id] = {
          qty: parseFloat(l.qty) || 0,
          unit: l.unit || 'ea',
          item_name: l.item_name,
          vendor_sku: l.vendor_sku,
          note: l.note,
        };
      }
    });

    entryState.overlay = mountEntryOverlay();
    showEntryLoading();
    try {
      const [catalog, pars] = await Promise.all([
        loadVendorCatalog(vendor.id),
        loadParOverrides(vendor.id, entryState.location),
      ]);
      entryState.catalog = catalog;
      entryState.par_overrides = pars;
      renderEntryItems();
      if (NX.toast) NX.toast(`Reordered ${(sourceOrder.lines || []).length} items — review & send`, 'info', 1800);
      // Force an initial save so this becomes a real draft right away.
      if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
    } catch (e) {
      console.error('[ordering] reorderFromOrder:', e);
      if (NX.toast) NX.toast('Failed to load catalog', 'error');
    }
  }

  /**
   * Open the user's mail app pre-filled with a delivery-issue email
   * to the vendor. Subject is auto-built from the order ID + date so
   * the vendor can match it to their records. Body lists the order's
   * line items with empty checkboxes the user fills in.
   */
  function reportIssuesOnOrder(order) {
    if (!order) return;
    const vendor = vendors.find(v => v.id === order.vendor_id);
    if (!vendor) { if (NX.toast) NX.toast('Vendor missing for this order', 'error'); return; }
    if (!vendor.email) {
      if (NX.toast) NX.toast(`No email set for ${vendor.name}`, 'warn');
      return;
    }

    const orderShortId = order.id ? order.id.slice(0, 8).toUpperCase() : '';
    const locLabel = (LOCS.find(l => l.id === order.location) || {}).label || order.location || '';
    const delivDate = order.delivery_date ? fmtDateLong(order.delivery_date) : '';

    const subject = `Issue with order ${orderShortId} — ${locLabel}${delivDate ? ' (' + delivDate + ')' : ''}`;
    const lines = (order.lines || []).filter(l => l.item_name);
    // Match the order-send email's simple {qty}{unit} {name} #{sku} layout
    // so the followup reads like a continuation of the original order.
    // Name uses house_name (team name) when present, fallback to item_name.
    const lineList = lines.length
      ? '\n\nItems on this order:\n' + lines.map(l => {
          const name = (l.house_name || '').trim() || l.item_name;
          const u = shortUnit(l.unit);
          const sku = (l.vendor_sku || '').trim();
          let s = `  [ ] ${l.qty || 0}${u} ${name}`;
          if (sku) s += `  #${sku}`;
          return s;
        }).join('\n')
      : '';

    const body =
`Hi ${vendor.name},

I'm following up on order ${orderShortId} for ${locLabel}${delivDate ? ' (delivery ' + delivDate + ')' : ''}.

There's an issue with this delivery. Details:

  • [describe the issue here — missing item / wrong qty / damaged / wrong item / late]
${lineList}

Thanks for your help sorting this out.`;

    const mailto = `mailto:${encodeURIComponent(vendor.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // Stamp the issue flag on the order BEFORE redirecting to mailto.
    // Mobile may background JS once the mail app takes focus, so the
    // record needs to land first. The note placeholder is a clue to
    // come back and edit it once the email's been sent.
    flagOrderIssue(order, 'See email for details');
    window.location.href = mailto;
    if (NX.toast) NX.toast('Opening mail app…', 'info', 1200);
  }

  /**
   * Bottom-sheet menu for additional order actions. Currently slim:
   * just "Open in editor" (legacy view of the order in the rich entry
   * overlay — useful for power-users who want to see par/catalog
   * context). Designed to be the place where future per-order actions
   * land (mark delivered, archive, duplicate, etc.).
   */
  function showOrderMoreMenu(order) {
    const existing = document.querySelector('.ord-vmenu-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ord-vmenu-overlay';
    overlay.innerHTML = `
      <div class="ord-vmenu-backdrop"></div>
      <div class="ord-vmenu-sheet">
        <div class="ord-vmenu-handle"></div>
        <div class="ord-vmenu-actions">
          <button class="ord-vmenu-action" data-action="open-in-editor">
            <span class="ord-vmenu-action-text">
              <span class="ord-vmenu-action-title">Open in editor</span>
              <span class="ord-vmenu-action-sub">View this order with par hints + catalog context</span>
            </span>
          </button>
          <button class="ord-vmenu-action" data-action="duplicate">
            <span class="ord-vmenu-action-text">
              <span class="ord-vmenu-action-title">Duplicate as draft</span>
              <span class="ord-vmenu-action-sub">Copy the line items into a new draft for tomorrow</span>
            </span>
          </button>
          <button class="ord-vmenu-action ord-vmenu-action-danger" data-action="delete">
            <span class="ord-vmenu-action-text">
              <span class="ord-vmenu-action-title">Archive order</span>
              <span class="ord-vmenu-action-sub">Hides from your orders list. Restorable any time.</span>
            </span>
          </button>
          <button class="ord-vmenu-action ord-vmenu-action-cancel" data-action="cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.ord-vmenu-backdrop').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-action="open-in-editor"]').addEventListener('click', () => {
      close();
      closeOrderDetail();
      openOrderInEntry(order);
    });
    overlay.querySelector('[data-action="duplicate"]').addEventListener('click', () => {
      close();
      duplicateOrderAsDraft(order);
    });
    overlay.querySelector('[data-action="delete"]').addEventListener('click', () => {
      close();
      confirmDeleteOrder(order);
    });
  }

  /* Clone the order's line items into a brand-new draft order. The new
     draft uses tomorrow's date by default (since most reorders are
     "send the same thing for next delivery") but the user can change
     it in the entry editor. The original order is untouched.

     Why a real DB insert vs. just opening the entry editor with cloned
     state: persistDraft already handles the in-progress save flow, so
     creating the order row + lines explicitly here avoids a race where
     the user closes before persistDraft fires. The new draft is then
     opened in the entry editor for further edits. */
  async function duplicateOrderAsDraft(order) {
    if (!order || !NX.sb) return;
    if (NX.toast) NX.toast('Duplicating…', 'info', 1200);
    try {
      // 1. Load the source order's line items so we can clone them
      const linesRes = await NX.sb.from('order_lines')
        .select('item_id, item_name, house_name, vendor_sku, qty, unit, note, sort_order')
        .eq('order_id', order.id)
        .order('sort_order', { ascending: true });
      // house_name might not exist pre-migration — retry without if so
      let sourceLines = linesRes.data;
      if (linesRes.error && /house_name|column.*does not exist|schema cache/i.test(linesRes.error.message || '')) {
        const fb = await NX.sb.from('order_lines')
          .select('item_id, item_name, vendor_sku, qty, unit, note, sort_order')
          .eq('order_id', order.id)
          .order('sort_order', { ascending: true });
        if (fb.error) throw fb.error;
        sourceLines = fb.data;
      } else if (linesRes.error) {
        throw linesRes.error;
      }
      sourceLines = sourceLines || [];

      // 2. Compute a sensible default delivery date — tomorrow.
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const ymd = tomorrow.toISOString().slice(0, 10);

      // 3. Insert the new draft order row
      const newOrderPayload = {
        vendor_id: order.vendor_id,
        location: order.location,
        delivery_date: ymd,
        status: 'draft',
        created_by:      NX.user && NX.user.id   ? NX.user.id   : null,
        created_by_name: NX.user && NX.user.name ? NX.user.name : null,
      };
      const { data: newOrder, error: oErr } = await NX.sb.from('orders')
        .insert(newOrderPayload).select('*').single();
      if (oErr) throw oErr;

      // 4. Copy lines into the new order
      if (sourceLines.length) {
        const newLines = sourceLines.map((l, i) => ({
          order_id: newOrder.id,
          item_id: l.item_id,
          item_name: l.item_name,
          house_name: l.house_name || null,
          vendor_sku: l.vendor_sku,
          qty: l.qty,
          unit: l.unit,
          note: l.note,
          sort_order: i,
        }));
        let insRes = await NX.sb.from('order_lines').insert(newLines);
        if (insRes.error && /house_name|column.*does not exist|schema cache/i.test(insRes.error.message || '')) {
          const fb = newLines.map(r => { const { house_name, ...rest } = r; return rest; });
          insRes = await NX.sb.from('order_lines').insert(fb);
        }
        if (insRes.error) throw insRes.error;
      }

      // 5. Open the new draft in the entry editor for review/edit
      closeOrderDetail();
      // Refresh state then open
      if (initialized) {
        recentOrders = await loadRecentOrders(activeLoc);
        const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
        renderRecent(recentOrders, vmap);
        renderVendors();
      }
      openExistingOrder(newOrder.id);
      if (NX.toast) NX.toast(`Duplicated as draft for ${ymd}`, 'info', 2200);
    } catch (e) {
      console.error('[ordering] duplicateOrderAsDraft:', e);
      if (NX.toast) NX.toast('Could not duplicate: ' + ((e && e.message) || ''), 'error', 4000);
    }
  }

  /* Two-step archive with an explicit confirmation modal. The kebab menu
     itself is one tap, so there's no "muscle memory" guard against
     bumping it accidentally — the confirm modal forces a deliberate
     choice with the order's short-id shown so the user sees exactly
     what's being archived. Archived orders disappear from list views
     but stay in the DB with archived_at set, so they can be restored
     from the "Show archived" expander in the vendor detail. */
  function confirmDeleteOrder(order) {
    const existing = document.querySelector('.ord-confirm-overlay');
    if (existing) existing.remove();

    const vendor = vendors.find(v => v.id === order.vendor_id);
    const vendorName = vendor ? vendor.name : 'this vendor';
    const orderShortId = order.id ? order.id.slice(0, 8).toUpperCase() : '—';
    const lineCount = (order.lines || []).length;

    const overlay = document.createElement('div');
    overlay.className = 'ord-confirm-overlay';
    overlay.innerHTML = `
      <div class="ord-confirm-backdrop"></div>
      <div class="ord-confirm-modal" role="dialog" aria-label="Confirm archive">
        <div class="ord-confirm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="21 8 21 21 3 21 3 8"/>
            <rect x="1" y="3" width="22" height="5"/>
            <line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
        </div>
        <div class="ord-confirm-title">Archive this order?</div>
        <div class="ord-confirm-body">
          <div class="ord-confirm-line"><strong>${esc(vendorName)}</strong> &middot; order ${esc(orderShortId)}</div>
          <div class="ord-confirm-sub">${lineCount} item${lineCount === 1 ? '' : 's'} &middot; ${esc((order.status || 'sent').toUpperCase())}</div>
          <div class="ord-confirm-warn">It will be hidden from your active orders list. You can restore it any time from <strong>Show archived</strong> at the bottom of the vendor's order history.</div>
        </div>
        <div class="ord-confirm-actions">
          <button class="ord-confirm-cancel" type="button">Cancel</button>
          <button class="ord-confirm-delete" type="button">Archive order</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.ord-confirm-backdrop').addEventListener('click', close);
    overlay.querySelector('.ord-confirm-cancel').addEventListener('click', close);
    overlay.querySelector('.ord-confirm-delete').addEventListener('click', async () => {
      const btn = overlay.querySelector('.ord-confirm-delete');
      btn.disabled = true;
      btn.textContent = 'Archiving…';
      try {
        await archiveOrder(order.id);
        close();
        closeOrderDetail();
        if (NX.toast) NX.toast(`Archived order ${orderShortId}`, 'info', 1800);
      } catch (e) {
        console.error('[ordering] archiveOrder:', e);
        btn.disabled = false;
        btn.textContent = 'Archive order';
        if (NX.toast) NX.toast('Could not archive: ' + ((e && e.message) || ''), 'error', 4000);
      }
    });
  }

  /* Soft-delete an order by stamping archived_at. Order rows + their
     order_lines stay in the database — the archived_at filter on list
     queries hides them from active views. Restoration is a matter of
     setting archived_at = NULL again (see restoreOrder).
     Falls back to a hard delete only if the column doesn't exist yet
     (pre-migration) — and in that case it warns the user that the
     action was irreversible after the fact. */
  async function archiveOrder(orderId) {
    if (!NX.sb || !orderId) throw new Error('Missing Supabase client or order id');
    const res = await NX.sb.from('orders')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', orderId);
    if (res.error) {
      const msg = (res.error.message || '') + '';
      // If the column doesn't exist (pre-migration), we don't want to
      // silently hard-delete the order — that would surprise the user
      // who explicitly chose "Archive (recoverable)". Throw with a
      // clear message so they know to run the migration.
      if (/column.*archived_at|could not find|schema cache/i.test(msg)) {
        throw new Error('Database needs migration: add archived_at to orders. See SQL note.');
      }
      throw res.error;
    }
    // Refresh in-memory state so list views update immediately.
    if (initialized) {
      try {
        recentOrders = await loadRecentOrders(activeLoc);
        const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
        renderRecent(recentOrders, vmap);
        renderVendors();
      } catch (_) {}
    }
  }

  /* Reverse an archive: clear archived_at so the order shows up in
     active list views again. Status is preserved — a SENT order
     restored stays SENT, etc. */
  async function restoreOrder(orderId) {
    if (!NX.sb || !orderId) throw new Error('Missing Supabase client or order id');
    const res = await NX.sb.from('orders')
      .update({ archived_at: null })
      .eq('id', orderId);
    if (res.error) throw res.error;
    if (initialized) {
      try {
        recentOrders = await loadRecentOrders(activeLoc);
        const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
        renderRecent(recentOrders, vmap);
        renderVendors();
      } catch (_) {}
    }
  }

  /* Legacy hard-delete — preserved as a private helper in case ever
     needed (e.g. a future "purge archived after 90 days" job). NOT
     wired to the kebab anymore. */
  async function deleteOrder(orderId) {
    if (!NX.sb || !orderId) throw new Error('Missing Supabase client or order id');
    const linesRes = await NX.sb.from('order_lines').delete().eq('order_id', orderId);
    if (linesRes.error) throw linesRes.error;
    const orderRes = await NX.sb.from('orders').delete().eq('id', orderId);
    if (orderRes.error) throw orderRes.error;
    if (initialized) {
      try {
        recentOrders = await loadRecentOrders(activeLoc);
        const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
        renderRecent(recentOrders, vmap);
        renderVendors();
      } catch (_) {}
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ORDER STATUS LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════
  // Forward-only state machine for sent orders:
  //
  //   draft → sent → confirmed → delivered → closed
  //
  // Plus an orthogonal "issue" flag (issue_at + issue_note) that can be
  // raised from any post-draft state. Filing an issue doesn't change
  // status — the order keeps moving forward, but the issue banner
  // surfaces on detail until resolved.
  //
  // Transitions are user-initiated via buttons on the order detail
  // view. No auto-transitions yet (could add: auto-close N days after
  // delivered).

  const ORDER_LIFECYCLE = ['draft', 'sent', 'confirmed', 'delivered', 'closed'];

  const ORDER_LIFECYCLE_LABELS = {
    draft:     'Draft',
    sent:      'Sent',
    confirmed: 'Confirmed',
    delivered: 'Delivered',
    closed:    'Closed',
  };

  /** Pick the timestamp field that records entry into a given status. */
  function tsForStatus(order, status) {
    if (!order) return null;
    switch (status) {
      case 'draft':     return order.created_at;
      case 'sent':      return order.email_sent_at || order.updated_at;
      case 'confirmed': return order.confirmed_at;
      case 'delivered': return order.delivered_at;
      case 'closed':    return order.closed_at;
      default:          return null;
    }
  }

  /** Pretty short timestamp for the status timeline rows. */
  function fmtLifecycleTs(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const diff = (now - d) / 86400000;
    if (diff < 1.5) return 'yesterday';
    if (diff < 7)   return d.toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /**
   * Persist a status transition for an order. Stamps the appropriate
   * timestamp column for the new status and updates the in-memory
   * cache so re-renders pick up the change without a refetch.
   */
  async function transitionOrderTo(order, newStatus) {
    if (!order || !NX.sb) return;
    if (!ORDER_LIFECYCLE.includes(newStatus)) return;

    const currentIdx = ORDER_LIFECYCLE.indexOf(order.status || 'draft');
    const targetIdx  = ORDER_LIFECYCLE.indexOf(newStatus);
    if (targetIdx <= currentIdx) {
      if (NX.toast) NX.toast(`Already ${ORDER_LIFECYCLE_LABELS[order.status] || order.status}`, 'warn');
      return;
    }

    const stamp = new Date().toISOString();
    const update = { status: newStatus };
    if (newStatus === 'confirmed') update.confirmed_at = stamp;
    if (newStatus === 'delivered') update.delivered_at = stamp;
    if (newStatus === 'closed')    update.closed_at    = stamp;

    const { error } = await NX.sb.from('orders').update(update).eq('id', order.id);
    if (error) {
      console.error('[ordering] transitionOrderTo:', error);
      const msg = (error.message || '') + '';
      if (/column|schema|does not exist|could not find/i.test(msg)) {
        if (NX.toast) NX.toast('Order lifecycle needs a DB migration — see notes', 'warn', 2400);
      } else {
        if (NX.toast) NX.toast('Could not update status: ' + msg, 'error');
      }
      return;
    }

    // Mutate the order object in place so detail re-render is consistent.
    Object.assign(order, update);
    if (NX.toast) NX.toast(`Marked ${ORDER_LIFECYCLE_LABELS[newStatus]}`, 'info', 1200);
    renderOrderDetail();

    // Refresh recent + vendor list activity previews.
    if (initialized) {
      try {
        recentOrders = await loadRecentOrders(activeLoc);
        const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
        renderRecent(recentOrders, vmap);
        renderVendors();
      } catch (_) {}
    }
  }

  /**
   * Mark an order as having an issue. Stamps issue_at + issue_note;
   * does not change status (forward-only flow continues). Used as the
   * persistence layer behind reportIssuesOnOrder so the audit trail
   * survives even when the user closes the mailto: dialog.
   */
  async function flagOrderIssue(order, note) {
    if (!order || !NX.sb) return;
    const stamp = new Date().toISOString();
    const update = { issue_at: stamp, issue_note: note || '(no details — see email)' };
    const { error } = await NX.sb.from('orders').update(update).eq('id', order.id);
    if (error) {
      // Silent fail — the email's already gone, the issue exists, we
      // just couldn't flag it. Log and move on.
      dwarn('[ordering] flagOrderIssue:', error.message || error);
      return;
    }
    Object.assign(order, update);
    renderOrderDetail();
  }

  /** Clear an outstanding issue once the user marks it resolved. */
  async function resolveOrderIssue(order) {
    if (!order || !NX.sb) return;
    confirmResolveIssue(order);
  }

  /* Long-press revert flow: confirm modal explains what's about to
     happen (status moves back, later timestamps clear), then applies
     it. Reverting BACK PAST 'sent' also clears email_sent_at since
     conceptually the order is no longer "sent" — it's a draft again.
     Same for confirmed/delivered/closed. */
  function confirmRevertTo(order, targetStatus) {
    document.querySelector('.ord-confirm-overlay')?.remove();

    const targetLabel = ORDER_LIFECYCLE_LABELS[targetStatus] || targetStatus;
    const currentLabel = ORDER_LIFECYCLE_LABELS[order.status] || order.status;

    const overlay = document.createElement('div');
    overlay.className = 'ord-confirm-overlay';
    overlay.innerHTML = `
      <div class="ord-confirm-backdrop"></div>
      <div class="ord-confirm-modal" role="dialog" aria-label="Revert status">
        <div class="ord-confirm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
        </div>
        <div class="ord-confirm-title">Revert to ${esc(targetLabel.toLowerCase())}?</div>
        <div class="ord-confirm-body">
          <div class="ord-confirm-line">Status will move from <strong>${esc(currentLabel)}</strong> back to <strong>${esc(targetLabel)}</strong>.</div>
          <div class="ord-confirm-warn">Timestamps for the steps after ${esc(targetLabel.toLowerCase())} will clear. The order returns to that point in its lifecycle.</div>
        </div>
        <div class="ord-confirm-actions">
          <button class="ord-confirm-cancel" type="button">Cancel</button>
          <button class="ord-confirm-delete" type="button">Revert</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.ord-confirm-backdrop').addEventListener('click', close);
    overlay.querySelector('.ord-confirm-cancel').addEventListener('click', close);
    overlay.querySelector('.ord-confirm-delete').addEventListener('click', async () => {
      const btn = overlay.querySelector('.ord-confirm-delete');
      btn.disabled = true;
      btn.textContent = 'Reverting…';
      try {
        await revertOrderTo(order, targetStatus);
        close();
        if (NX.toast) NX.toast(`Reverted to ${targetLabel.toLowerCase()}`, 'info', 1800);
      } catch (e) {
        console.error('[ordering] revertOrderTo:', e);
        btn.disabled = false;
        btn.textContent = 'Revert';
        if (NX.toast) NX.toast('Could not revert: ' + ((e && e.message) || ''), 'error', 3000);
      }
    });
  }

  async function revertOrderTo(order, targetStatus) {
    if (!order || !NX.sb || !targetStatus) throw new Error('Missing order or target');
    const targetIdx = ORDER_LIFECYCLE.indexOf(targetStatus);
    if (targetIdx < 0) throw new Error('Invalid target status');

    // Build the update: set status, clear timestamps for steps AFTER target.
    // Map of status → timestamp column. Draft has no ts (it's the
    // initial state), so it's not in the map but is handled by the index.
    const STATUS_TS = {
      sent:      'email_sent_at',
      confirmed: 'confirmed_at',
      delivered: 'delivered_at',
      closed:    'closed_at',
    };
    const update = { status: targetStatus };
    for (let i = targetIdx + 1; i < ORDER_LIFECYCLE.length; i++) {
      const col = STATUS_TS[ORDER_LIFECYCLE[i]];
      if (col) update[col] = null;
    }
    const { error } = await NX.sb.from('orders').update(update).eq('id', order.id);
    if (error) throw error;
    Object.assign(order, update);
    // Refresh in-memory cache so list views update
    if (initialized) {
      try {
        recentOrders = await loadRecentOrders(activeLoc);
        const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
        renderRecent(recentOrders, vmap);
        renderVendors();
      } catch (_) {}
    }
    renderOrderDetail();
  }

  /* Modal: capture a resolution note on issue clearance. The original
     issue_note shows in the modal as context so the user remembers what
     was reported. The resolution note saves to issue_resolution_note
     (via migration); if that column doesn't exist, the issue still clears
     but the resolution note is dropped silently so legacy DBs keep
     working. */
  function confirmResolveIssue(order) {
    document.querySelector('.ord-confirm-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ord-confirm-overlay';
    overlay.innerHTML = `
      <div class="ord-confirm-backdrop"></div>
      <div class="ord-confirm-modal" role="dialog" aria-label="Resolve issue">
        <div class="ord-confirm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div class="ord-confirm-title">Resolve issue</div>
        <div class="ord-confirm-body">
          ${order.issue_note ? `
            <div class="ord-confirm-line">
              <strong>Reported:</strong> ${esc(order.issue_note)}
            </div>
          ` : ''}
          <div class="ord-confirm-sub">What was the resolution? Optional, but helps future you.</div>
          <textarea class="ord-confirm-textarea" id="ordResolveNote" rows="3"
            placeholder="e.g. Vendor delivered 4 cases instead of 6 — credited difference"></textarea>
        </div>
        <div class="ord-confirm-actions">
          <button class="ord-confirm-cancel" type="button">Cancel</button>
          <button class="ord-confirm-delete ord-confirm-resolve" type="button">Mark resolved</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.ord-confirm-backdrop').addEventListener('click', close);
    overlay.querySelector('.ord-confirm-cancel').addEventListener('click', close);
    setTimeout(() => overlay.querySelector('#ordResolveNote')?.focus(), 100);
    overlay.querySelector('.ord-confirm-resolve').addEventListener('click', async () => {
      const noteEl = overlay.querySelector('#ordResolveNote');
      const note = (noteEl && noteEl.value || '').trim();
      const btn = overlay.querySelector('.ord-confirm-resolve');
      btn.disabled = true;
      btn.textContent = 'Resolving…';
      try {
        await applyIssueResolution(order, note);
        close();
        if (NX.toast) NX.toast('Issue cleared', 'info', 1200);
      } catch (e) {
        console.error('[ordering] applyIssueResolution:', e);
        btn.disabled = false;
        btn.textContent = 'Mark resolved';
        if (NX.toast) NX.toast('Could not clear: ' + ((e && e.message) || ''), 'error', 3000);
      }
    });
  }

  async function applyIssueResolution(order, resolutionNote) {
    const update = {
      issue_at: null,
      issue_note: null,
      issue_resolved_at: new Date().toISOString(),
      issue_resolution_note: resolutionNote || null,
    };
    let res = await NX.sb.from('orders').update(update).eq('id', order.id);
    // Pre-migration: drop new columns and retry so it still clears
    if (res.error && /issue_resolved_at|issue_resolution_note|column.*does not exist|schema cache/i.test(res.error.message || '')) {
      const { issue_resolved_at, issue_resolution_note, ...legacy } = update;
      res = await NX.sb.from('orders').update(legacy).eq('id', order.id);
    }
    if (res.error) throw res.error;
    Object.assign(order, update);
    renderOrderDetail();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2 — ORDER ENTRY OVERLAY
  // ═══════════════════════════════════════════════════════════════════

  /** Open the entry overlay for a vendor. Continues an existing draft if present.
   *  v18.29 — when called with { forceEmpty: true }, skips the auto-fill
   *  pass entirely (par fill / last-order fill) so the chef starts with
   *  zero quantities. The fill-mode picker remains available so they
   *  can manually trigger par-fill or last-order-fill mid-entry if they
   *  change their mind. Used by the vendor detail "New order" button to
   *  give a genuine fresh-start experience. */
  async function openVendor(vendorId, opts) {
    opts = opts || {};
    const forceEmpty = opts.forceEmpty === true;
    const vendor = vendors.find(v => v.id === vendorId);
    if (!vendor) {
      if (NX.toast) NX.toast('Vendor not found', 'error');
      return;
    }
    const existingDraft = await findExistingDraft(vendorId, activeLoc);
    if (existingDraft) return openExistingOrder(existingDraft.id);
    entryState = {
      vendor, catalog: [], par_overrides: {},
      location: activeLoc,
      delivery_date: nextDeliveryDate(vendor, location),
      notes: '', lines: {},
      // v18.26 — per-vendor unit overrides map: { [item_id]: 'ea'|'cs'|'bag'|... }
      // Persisted to localStorage (key: nexus_ord_units_${vendor_id}) so an
      // override set when qty=0 survives reload. Once qty becomes positive,
      // the override gets baked into entryState.lines[id].unit which flows
      // through to order_lines.unit → the email. Keyed by item_id, not by
      // (item_id, location) — the unit you order an item in is the same
      // everywhere it's ordered.
      unitOverrides: loadUnitOverrides(vendor.id),
      draftOrderId: null, saveTimer: null, saveInFlight: false,
      overlay: null, reviewing: false,
    };
    entryState.overlay = mountEntryOverlay();
    showEntryLoading();
    try {
      const [catalog, pars] = await Promise.all([
        loadVendorCatalog(vendorId),
        loadParOverrides(vendorId, activeLoc),
      ]);
      entryState.catalog       = catalog;
      entryState.par_overrides = pars;

      // ─── v18.25 — Fill mode dispatch ──────────────────────────────
      // Honor the vendor's saved default_fill_mode preference:
      //   'par'        → auto-fill from par hints (current default)
      //   'last_order' → copy quantities from most recent sent order
      //   'empty'      → start with no quantities, chef enters manually
      // Falls back to 'par' if the column is absent or unset.
      // The user can change the mode mid-entry via the fill picker; this
      // path only runs once on initial open.
      //
      // v18.29 — forceEmpty override. When the entry was launched from
      // the vendor detail's "New order" button, the chef explicitly
      // asked for a fresh start. Skip the auto-fill regardless of the
      // vendor's saved fill mode. The fill-mode picker is still in the
      // header, so they can pull in pars / last order manually if they
      // change their mind. The vendor's default_fill_mode is preserved
      // (this is a one-time per-session override).
      const fillMode = forceEmpty ? 'empty' : (vendor.default_fill_mode || 'par');
      let autofilled = 0;
      if (fillMode === 'last_order') {
        autofilled = await fillFromLastOrder(vendor, activeLoc, catalog);
        if (NX.toast) NX.toast(autofilled > 0
          ? `Pre-filled ${autofilled} item${autofilled === 1 ? '' : 's'} from last order`
          : 'No previous order found — starting empty', autofilled > 0 ? 'info' : 'warn', 2600);
      } else if (fillMode === 'par') {
        autofilled = fillFromPars(catalog);
        if (autofilled > 0 && NX.toast) {
          NX.toast(`Pre-filled ${autofilled} item${autofilled === 1 ? '' : 's'} from pars — review and edit before sending`, 'info', 2600);
        }
      }
      // 'empty' mode does nothing.
      renderEntryItems();
      if (autofilled > 0) scheduleDraftSave();
    } catch (e) {
      console.error('[ordering] openVendor:', e);
      if (NX.toast) NX.toast('Failed to load vendor catalog', 'error');
    }
  }

  /* ════════════════════════════════════════════════════════════════
     v18.25 — Fill-mode helpers + picker.

     Three sources to seed a fresh order:
       fillFromPars       — par hints per item (existing logic, extracted)
       fillFromLastOrder  — clone the most recent sent order's line qty/units
       (empty mode = no fill, just return 0)

     openFillModePicker — bottom sheet that lets the user pick a mode
     mid-entry. Tapping a mode WIPES current selections and re-fills,
     then optionally saves the choice as the vendor's default so the
     next new order opens the same way.
     ════════════════════════════════════════════════════════════════ */

  function fillFromPars(catalog) {
    let n = 0;
    if (!entryState) return 0;
    const overrides = entryState.unitOverrides || {};
    for (const item of catalog) {
      const hint = parHintFor(item, entryState.delivery_date, entryState.location);
      if (hint.disabled) continue;
      if (hint.qty == null || hint.qty <= 0) continue;
      entryState.lines[item.id] = {
        qty:        hint.qty,
        // v18.26 — vendor override wins over catalog default
        unit:       overrides[item.id] || shortUnit(item.unit) || 'ea',
        item_name:  item.item_name,
        house_name: item.house_name || null,
        vendor_sku: item.vendor_sku,
        note:       item.note,
      };
      n++;
    }
    return n;
  }

  async function fillFromLastOrder(vendor, locationId, catalog) {
    if (!entryState || !NX.sb) return 0;
    try {
      const { data: lastOrder } = await NX.sb.from('orders')
        .select('id, email_sent_at')
        .eq('vendor_id', vendor.id)
        .eq('location', locationId)
        .eq('status', 'sent')
        .order('email_sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastOrder) return 0;

      const { data: lines, error } = await NX.sb.from('order_lines')
        .select('item_id, qty, unit')
        .eq('order_id', lastOrder.id);
      if (error || !lines || !lines.length) return 0;

      const overrides = entryState.unitOverrides || {};
      let n = 0;
      for (const line of lines) {
        const item = (catalog || entryState.catalog).find(i => i.id === line.item_id);
        if (!item) continue; // item may have been removed from catalog since
        const qty = parseFloat(line.qty);
        if (!qty || qty <= 0) continue;
        entryState.lines[item.id] = {
          qty,
          // v18.26 — vendor override wins over last order's unit, which wins
          // over catalog default. Override is the user's stated preference,
          // last order is historical, catalog is the absolute fallback.
          unit:       overrides[item.id] || line.unit || shortUnit(item.unit) || 'ea',
          item_name:  item.item_name,
          house_name: item.house_name || null,
          vendor_sku: item.vendor_sku,
          note:       item.note,
        };
        n++;
      }
      return n;
    } catch (e) {
      console.warn('[ordering] fillFromLastOrder:', e);
      return 0;
    }
  }

  /* Bottom-sheet picker for fill mode. Wipes current entry quantities
     before re-filling so the user always gets a clean state from the
     selected source. Saves the choice as the vendor's default so future
     orders for this vendor open in the same mode. */
  async function openFillModePicker() {
    if (!entryState || !entryState.vendor) return;
    const vendor = entryState.vendor;
    const currentMode = vendor.default_fill_mode || 'par';

    const overlay = document.createElement('div');
    overlay.className = 'ord-vmenu-overlay';
    overlay.innerHTML = `
      <div class="ord-vmenu-backdrop"></div>
      <div class="ord-vmenu-sheet">
        <div class="ord-vmenu-handle"></div>
        <div style="padding: 8px 18px 12px; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 1.5px; color: var(--nx-faint); text-transform: uppercase">Fill order from</div>
        <div class="ord-vmenu-actions">
          <button class="ord-vmenu-action ${currentMode === 'par' ? 'is-selected' : ''}" data-mode="par">
            <span class="ord-vmenu-action-text">
              <span class="ord-vmenu-action-title">Par levels${currentMode === 'par' ? ' · default' : ''}</span>
              <span class="ord-vmenu-action-sub">Use each item's configured par for the delivery date</span>
            </span>
          </button>
          <button class="ord-vmenu-action ${currentMode === 'last_order' ? 'is-selected' : ''}" data-mode="last_order">
            <span class="ord-vmenu-action-text">
              <span class="ord-vmenu-action-title">Last order${currentMode === 'last_order' ? ' · default' : ''}</span>
              <span class="ord-vmenu-action-sub">Copy quantities from the most recent sent order</span>
            </span>
          </button>
          <button class="ord-vmenu-action ${currentMode === 'empty' ? 'is-selected' : ''}" data-mode="empty">
            <span class="ord-vmenu-action-text">
              <span class="ord-vmenu-action-title">Start empty${currentMode === 'empty' ? ' · default' : ''}</span>
              <span class="ord-vmenu-action-sub">Clear all quantities — enter from scratch</span>
            </span>
          </button>
          <button class="ord-vmenu-action ord-vmenu-action-cancel" data-action="cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.ord-vmenu-backdrop').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);

    overlay.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        close();

        // Wipe current quantities. The user is explicitly opting into
        // a different source so we don't keep stale par-fill values.
        entryState.lines = {};

        let n = 0;
        if (mode === 'par')        n = fillFromPars(entryState.catalog);
        if (mode === 'last_order') n = await fillFromLastOrder(vendor, entryState.location, entryState.catalog);
        // 'empty' → n stays 0

        renderEntryItems();
        updateCtaCounter();
        scheduleDraftSave();

        // Persist the choice as the vendor's default. Best-effort —
        // failure to write the preference shouldn't block the fill.
        // v18.27 — was writing to `vendors` (wrong table); the actual
        // table is `order_vendors`. Fixed so the preference now persists.
        try {
          await NX.sb.from('order_vendors').update({ default_fill_mode: mode }).eq('id', vendor.id);
          vendor.default_fill_mode = mode;
        } catch (e) {
          console.warn('[ordering] save fill mode pref:', e);
        }

        const msg = mode === 'par'        ? (n > 0 ? `Filled ${n} from pars`        : 'No par values set — order is empty')
                  : mode === 'last_order' ? (n > 0 ? `Filled ${n} from last order`  : 'No previous order found — order is empty')
                                          :         'Cleared — enter items manually';
        if (NX.toast) NX.toast(msg, n > 0 ? 'info' : 'warn', 2400);
      });
    });
  }

  /** Open an existing order — draft (continue) or sent (read-only with Reorder). */
  async function openExistingOrder(orderId) {
    if (!orderId) return;
    // Dispatch by status. Drafts continue to flow into the entry overlay
    // (the existing rich editor) so the user can keep adding items. Sent
    // and delivered orders go to the new card-based detail view, modeled
    // after BlueCart's order detail screen — read-only by default with
    // a "Reorder" affordance and a "Report issues" CTA.
    const order = await loadOrderById(orderId);
    if (!order) { if (NX.toast) NX.toast('Order not found', 'error'); return; }
    if (order.status === 'sent' || order.status === 'delivered') {
      return openOrderDetail(order);
    }
    return openOrderInEntry(order);
  }

  /**
   * The legacy openExistingOrder body — opens the rich entry overlay
   * for a given (already-loaded) order. Now invoked only for drafts and
   * fallback unknown statuses, since sent/delivered get the detail view.
   */
  async function openOrderInEntry(order) {
    if (!order) return;
    showEntryLoadingShell();
    const vendor = vendors.find(v => v.id === order.vendor_id);
    if (!vendor) { if (NX.toast) NX.toast('Vendor missing for this order', 'error'); closeEntry(); return; }
    entryState = {
      vendor, catalog: [], par_overrides: {},
      location:      order.location || activeLoc,
      delivery_date: order.delivery_date || nextDeliveryDate(vendor, order.location || activeLoc),
      notes:         order.notes || '',
      lines:         {},
      unitOverrides: loadUnitOverrides(vendor.id),
      draftOrderId:  order.id,
      saveTimer:     null,
      saveInFlight:  false,
      overlay:       document.querySelector('.ord-entry-overlay'),
      reviewing:     false,
      readOnly:      order.status === 'sent',
      sourceStatus:  order.status,
    };
    (order.lines || []).forEach(l => {
      if (l.item_id) {
        entryState.lines[l.item_id] = {
          qty: parseFloat(l.qty) || 0,
          unit: l.unit || 'ea',
          item_name: l.item_name,
          vendor_sku: l.vendor_sku,
          note: l.note,
        };
      }
    });
    try {
      const [catalog, pars] = await Promise.all([
        loadVendorCatalog(vendor.id),
        loadParOverrides(vendor.id, entryState.location),
      ]);
      entryState.catalog = catalog;
      entryState.par_overrides = pars;
      renderEntryItems();
    } catch (e) {
      console.error('[ordering] openOrderInEntry:', e);
    }
  }

  /**
   * Extract the trailing "base unit" from a vendor pack-size string.
   * Inputs follow the foodservice convention "<caseQty>/<unitSize> <UNIT>"
   * (e.g. "3/1 GA", "6/32 OZ", "12/1 CT") or just a plain unit ("EA", "LB").
   * Returns just the trailing unit word so par chips, totals, and inline
   * stats can display in meaningful units instead of repeating the whole
   * pack format. Falls back to 'ea' when nothing is provided.
   */
  function baseUnit(unitStr) {
    if (!unitStr) return 'ea';
    const s = String(unitStr).trim();
    const m = s.match(/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s+(.+)$/);
    if (m) return m[1].trim();
    return s;
  }

  /**
   * Format a vendor pack-size string into a readable two-line display.
   * Returns { primary, secondary } so the right-edge column of an item
   * row can render a clearer card than the raw "3/1 GA" the vendor sends.
   *
   * Examples (input → primary, secondary):
   *   "3/1 GA"  → "3 × 1 GA",  "case"
   *   "12/1 CT" → "12 × 1 CT", "case"
   *   "6/32 OZ" → "6 × 32 OZ", "case"
   *   "1/1 CT"  → "1 CT",      ""        (singular pack — drop the redundant "× 1")
   *   "EA"      → "EA",        ""
   *   ""        → "EA",        ""
   *
   * The user's mental model: "1 box, 3 gallons" — the case unit on top,
   * the contents underneath. We invert that slightly because the vendor's
   * "3" leads (it's the case quantity) and the unit follows. The "× 1"
   * disambiguates how many of the unit are in each box.
   */
  function prettyPackSize(unitStr) {
    if (!unitStr) return { primary: 'EA', secondary: '' };
    const s = String(unitStr).trim();
    const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+(.+)$/);
    if (!m) return { primary: s.toUpperCase(), secondary: '' };
    const caseQty = parseFloat(m[1]);
    const unitQty = parseFloat(m[2]);
    const unit = m[3].trim().toUpperCase();
    // Singular pack (one unit per case) — collapsing "1 × 1 CT" to just
    // "1 CT" reads cleaner and matches how the eye reads it anyway.
    if (caseQty === 1 && unitQty === 1) {
      return { primary: `1 ${unit}`, secondary: '' };
    }
    if (caseQty === 1) {
      return { primary: `${unitQty} ${unit}`, secondary: '' };
    }
    return {
      primary: `${caseQty} × ${unitQty} ${unit}`,
      secondary: 'case',
    };
  }

  /** Resolve par hint for an item on a given delivery date + location. */
  function parHintFor(item, deliveryDate, location) {
    const wk = weekdayOf(deliveryDate);
    const wkLbl = wk ? WEEKDAY_LBL[WEEKDAY_KEYS.indexOf(wk)] : '';
    let pars = null;
    const override = entryState.par_overrides[item.id];
    if (override) {
      if (override.enabled === false) return { qty: null, label: 'skip', disabled: true };
      pars = override.pars_by_day || null;
    }
    if (!pars && item.pars_by_day && Object.keys(item.pars_by_day).length) {
      pars = item.pars_by_day;
    }
    let qty = null;
    if (pars) {
      if (wk && pars[wk] != null) qty = parseFloat(pars[wk]);
      else if (pars.default != null) qty = parseFloat(pars.default);
    }
    if (qty == null && item.default_par_qty != null) qty = parseFloat(item.default_par_qty);
    if (qty == null || isNaN(qty)) return { qty: null, label: '' };
    const unit = item.unit || 'ea';
    // chipUnit uses the BASE unit (e.g. "GA" not "3/1 GA") so the par
    // chip reads "PAR 5 GA" instead of nonsense "PAR 5 3/1 GA".
    return {
      qty,
      label: `par: ${qty} ${unit}${wkLbl ? ' ' + wkLbl : ''}`,
      chipQty:  qty,
      chipUnit: baseUnit(unit),
      chipDay:  wkLbl || '',
    };
  }

  function mountEntryOverlay() {
    let el = document.querySelector('.ord-entry-overlay');
    if (el) return el;
    syncMastheadHeight();           // re-measure right before positioning
    el = document.createElement('div');
    el.className = 'ord-entry-overlay';
    el.innerHTML = `<div class="ord-entry-loading">Loading…</div>`;
    document.body.appendChild(el);
    document.body.classList.add('ord-overlay-open');
    return el;
  }
  function showEntryLoadingShell() {
    const el = mountEntryOverlay();
    entryState = entryState || {};
    entryState.overlay = el;
    el.innerHTML = `<div class="ord-entry-loading">Loading…</div>`;
  }
  function showEntryLoading() {
    const el = entryState && entryState.overlay;
    if (el) el.innerHTML = `<div class="ord-entry-loading">Loading…</div>`;
  }

  function renderEntryItems() {
    if (!entryState) return;
    const { vendor, catalog, location, delivery_date, lines, readOnly } = entryState;
    const overlay = entryState.overlay;
    if (!overlay) return;

    // Lazy-init collapsedSections — used by the new section-card UI to
    // remember which sections the user has collapsed during this session.
    if (!entryState.collapsedSections) entryState.collapsedSections = new Set();

    // Par filter: "mine" (only items this location actually orders, via
    // parHint) or "all" (full vendor catalog). Per-location preference
    // sticks in localStorage so each restaurant remembers its own view.
    const parFilterKey = `nexus.parFilter.${vendor.id}.${location}`;
    if (!entryState.parFilter) {
      entryState.parFilter = (typeof localStorage !== 'undefined' && localStorage.getItem(parFilterKey)) || 'mine';
    }
    const parFilter = entryState.parFilter;

    // Determine which items to show. "mine" = parHint says we order this
    // (any par configured) OR user has already typed a qty (don't hide
    // active edits). "all" = full catalog.
    const isMine = (item) => {
      if (lines[item.id] && lines[item.id].qty > 0) return true;  // never hide an item the user is editing
      const hint = parHintFor(item, delivery_date, location);
      if (hint.disabled) return false;
      return hint.qty != null;
    };
    const visibleCatalog = parFilter === 'mine' ? catalog.filter(isMine) : catalog;
    const hiddenByFilter = catalog.length - visibleCatalog.length;

    // Group catalog by section (preserve sort_order within)
    const groups = new Map();
    for (const it of visibleCatalog) {
      const sec = it.section || '';
      if (!groups.has(sec)) groups.set(sec, []);
      groups.get(sec).push(it);
    }
    const sections = Array.from(groups.keys());

    const itemCount  = countItemsInOrder();
    const ctaLabel   = readOnly
      ? 'Reorder these items'
      : (itemCount > 0 ? `Review & Send · ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Review & Send');
    const ctaDisabled = !readOnly && itemCount === 0;

    overlay.innerHTML = `
      <div class="ord-entry-head">
        <button class="ord-entry-close" aria-label="Close">${closeIcon()}</button>
        <div class="ord-entry-title">
          <div class="ord-entry-vendor">${esc(vendor.name)}</div>
          <!-- v18.28 — date moved INTO subtitle as a tappable chip.
               Previously the standalone "DELIVERY [date]" row burned
               ~60px of vertical space, costing one item-per-screen.
               Now the date sits inline: "ESTE · Thu May 21" with the
               chip opening the native date picker on tap. -->
          <div class="ord-entry-sub ord-entry-sub-row">
            <span>${esc(LOCS.find(l => l.id === location)?.label || location)}${readOnly ? ' · sent order' : ''}</span>
            ${delivery_date ? `
              <span>·</span>
              <label class="ord-entry-date-chip" aria-label="Change delivery date">
                <span id="ordDeliveryDateLabel">${esc(fmtDateShort(delivery_date))}</span>
                <input type="date" id="ordDeliveryDate" value="${esc(delivery_date)}" ${readOnly ? 'disabled' : ''}>
              </label>
            ` : ''}
          </div>
        </div>
        ${readOnly ? '<div class="ord-entry-spacer"></div>' : `<button class="ord-entry-add" id="ordEntryAdd" aria-label="Add item to catalog">${plusIcon(true)}</button>`}
      </div>
      <div class="ord-entry-meta">
        ${(() => {
          // Mismatch hint: only render when vendor has delivery_days
          // configured AND the picked date isn't one of them. Silent
          // when delivery_days is empty (no basis to flag) or when
          // the date matches.
          if (readOnly || !delivery_date) return '';
          if (!Array.isArray(vendor.delivery_days) || !vendor.delivery_days.length) return '';
          if (isVendorDeliveryDay(vendor, delivery_date, location)) return '';
          const dayLbls = vendor.delivery_days.map(k => WEEKDAY_LBL[WEEKDAY_KEYS.indexOf(k)]).filter(Boolean).join(', ');
          return `
            <div class="ord-meta-warn">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>${esc(vendor.name)} usually delivers ${esc(dayLbls)}</span>
            </div>
          `;
        })()}
        ${(() => {
          // Cutoff banner. Three states:
          //   • > 4h until cutoff → quiet "send by X" reminder
          //   • ≤ 4h until cutoff → emphasized "running out" banner
          //   • past cutoff       → "cutoff passed" warning (still allows send)
          if (readOnly || !delivery_date) return '';
          const cutoff = vendorCutoffMoment(vendor, delivery_date, location);
          if (!cutoff) return '';
          const now = new Date();
          const ms = cutoff.getTime() - now.getTime();
          const cutoffStr = cutoff.toLocaleString([], {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
          });
          let cls = 'ord-meta-cutoff';
          let body = '';
          if (ms <= 0) {
            cls += ' is-past';
            body = `<strong>Past cutoff</strong> — ${esc(vendor.name)} typically stops accepting orders ${esc(cutoffStr)}`;
          } else if (ms <= 4 * 3600 * 1000) {
            cls += ' is-soon';
            body = `<strong>${esc(fmtCountdown(ms))} until cutoff</strong> — send by ${esc(cutoffStr)}`;
          } else {
            body = `Cutoff in ${esc(fmtCountdown(ms))} — by ${esc(cutoffStr)}`;
          }
          return `
            <div class="${cls}">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span>${body}</span>
            </div>
          `;
        })()}
      </div>
      <div class="ord-entry-search-wrap">
        <input type="search" class="ord-entry-search" id="ordEntrySearch" placeholder="Search items…" autocomplete="off" spellcheck="false">
      </div>
      <div class="ord-entry-filter">
        <button type="button" class="ord-entry-filter-pill${parFilter === 'mine' ? ' is-active' : ''}" data-filter="mine">
          My items
        </button>
        <button type="button" class="ord-entry-filter-pill${parFilter === 'all' ? ' is-active' : ''}" data-filter="all">
          All
        </button>
        ${readOnly ? '' : `
          <!-- v18.25 — Fill source picker. Sits inline with the My/All
               filter pills so it's discoverable without taking another
               row of vertical space. Label updates to reflect the
               current vendor default. -->
          <button type="button" class="ord-entry-filter-pill ord-entry-fill-pill" id="ordEntryFillPill" style="margin-left:auto">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:4px">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Fill: ${(() => {
              const m = (vendor.default_fill_mode || 'par');
              return m === 'last_order' ? 'Last order' : m === 'empty' ? 'Empty' : 'Pars';
            })()}
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-left:4px">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        `}
        ${parFilter === 'mine' && hiddenByFilter > 0 ? `
          <span class="ord-entry-filter-hint">${hiddenByFilter} hidden — tap All to see full catalog</span>
        ` : ''}
      </div>
      <div class="ord-entry-list" id="ordEntryList">
        ${sections.map(sec => {
          const groupItems = groups.get(sec);
          const isCollapsed = entryState.collapsedSections && entryState.collapsedSections.has(sec);
          return `
          <div class="ord-entry-section${isCollapsed ? ' is-collapsed' : ''}" data-section="${esc(sec || '')}">
            <div class="ord-entry-section-head" data-section="${esc(sec || '')}">
              <span class="ord-entry-section-name">${esc(sec || 'Uncategorized')}</span>
              <span class="ord-entry-section-count">${groupItems.length}</span>
              <button type="button" class="ord-entry-section-collapse" data-section="${esc(sec || '')}" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} section">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            </div>
            <div class="ord-entry-section-items">
              ${groupItems.map(it => itemRowHtml(it, lines[it.id], delivery_date, location, readOnly)).join('')}
            </div>
          </div>
        `;}).join('')}
        ${catalog.length === 0 ? `
          <div class="ord-empty">
            This vendor has no catalog yet.<br>
            <span class="ord-empty-hint">Items can be added from the vendor editor (coming soon).</span>
          </div>
        ` : ''}
      </div>
      <div class="ord-entry-cta-wrap">
        <button class="ord-entry-cta" id="ordEntryReview" ${ctaDisabled ? 'disabled' : ''}>${ctaLabel}</button>
        <div class="ord-entry-save-status" id="ordSaveStatus"></div>
      </div>
    `;

    overlay.querySelector('.ord-entry-close').addEventListener('click', closeEntry);
    const addBtn = overlay.querySelector('#ordEntryAdd');
    if (addBtn) addBtn.addEventListener('click', () => openQuickAddItem(vendor));

    // Par filter pills — set the mode + persist per-location preference
    overlay.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.filter;
        if (mode === entryState.parFilter) return;
        entryState.parFilter = mode;
        try { localStorage.setItem(parFilterKey, mode); } catch (_) {}
        renderEntryItems();
      });
    });
    // v18.25 — Fill-mode pill: opens the par/last-order/empty picker
    const fillPill = overlay.querySelector('#ordEntryFillPill');
    if (fillPill) fillPill.addEventListener('click', () => openFillModePicker());
    overlay.querySelector('#ordDeliveryDate').addEventListener('change', e => {
      entryState.delivery_date = e.target.value;
      // v18.28 — sync the visible chip label (date input itself is
      // invisible-overlay, only the label is rendered to the user).
      const lbl = overlay.querySelector('#ordDeliveryDateLabel');
      if (lbl) lbl.textContent = fmtDateShort(e.target.value);
      renderEntryItems();
      scheduleDraftSave();
    });
    overlay.querySelector('#ordEntrySearch').addEventListener('input', e => {
      filterEntryItems(e.target.value);
    });
    overlay.querySelector('#ordEntryReview').addEventListener('click', () => {
      if (readOnly) { cloneAsNewDraft(); return; }
      // Re-read the current count instead of the value captured when
      // this listener was attached. renderEntry() runs once when the
      // overlay opens; if the user bumps qtys after that, only the
      // button label updates via updateCtaCounter(). The closure's
      // `itemCount` stays frozen at the original (often 0), which made
      // the first tap silently no-op until the user backed out and
      // re-entered the overlay.
      if (countItemsInOrder() > 0) openReview();
    });
    overlay.querySelectorAll('.ord-item-row').forEach(row => wireItemRow(row));

    // ─── Order-entry section collapse ─────────────────────────────────
    // Tap the chevron (or anywhere on the section head) to collapse/expand.
    // Collapsed sections hide their items but stay in the DOM so quantity
    // state isn't lost when the user collapses then expands.
    overlay.querySelectorAll('.ord-entry-section-head').forEach(head => {
      head.addEventListener('click', (e) => {
        // Don't toggle if the tap landed on something interactive
        // (currently nothing else, but defensive for future additions).
        const sec = head.dataset.section || '';
        if (entryState.collapsedSections.has(sec)) {
          entryState.collapsedSections.delete(sec);
        } else {
          entryState.collapsedSections.add(sec);
        }
        // Just toggle the class on the parent — no full re-render needed,
        // the items are already in the DOM and CSS handles the hide.
        const block = head.closest('.ord-entry-section');
        if (block) block.classList.toggle('is-collapsed');
        const btn = head.querySelector('.ord-entry-section-collapse');
        if (btn) btn.setAttribute('aria-expanded', String(!entryState.collapsedSections.has(sec)));
      });
    });

    if (!entryState._escWired) {
      const escHandler = e => {
        if (e.key === 'Escape' && document.body.classList.contains('ord-overlay-open')) closeEntry();
      };
      document.addEventListener('keydown', escHandler);
      entryState._escWired = true;
      entryState._escHandler = escHandler;
    }

    // ─── v18.28 — Auto-hide CTA on scroll-down, show on scroll-up ───
    // Pattern lifted from LinkedIn / Facebook mobile: sticky bottom bars
    // slide out of the way when the user is scrolling DOWN (so they can
    // see more content), and slide back in when scrolling UP (so the
    // primary action is reachable without scrolling to top or bottom).
    // Always-show conditions: at very top, at bottom, or scrolling up.
    //
    // TOLERANCE: 10px. iOS scroll-bounce + finger shake cause tiny
    // direction reversals; without tolerance the bar jitters on every
    // finger lift. 10px is enough to ignore micro-movements but small
    // enough that real direction changes feel instant.
    const list = overlay.querySelector('#ordEntryList');
    const ctaWrap = overlay.querySelector('.ord-entry-cta-wrap');
    if (list && ctaWrap && !readOnly) {
      let lastY = 0;
      let lastDir = 0;       // -1 = up, +1 = down, 0 = settled
      const TOLERANCE = 10;
      const BOTTOM_THRESHOLD = 24;  // px from bottom counts as "at bottom"
      const TOP_THRESHOLD    = 8;   // px from top counts as "at top"

      const onScroll = () => {
        const y = list.scrollTop;
        const max = list.scrollHeight - list.clientHeight;
        const atTop    = y <= TOP_THRESHOLD;
        const atBottom = max - y <= BOTTOM_THRESHOLD;
        // Direction with tolerance — only flip when movement exceeds threshold
        const delta = y - lastY;
        if (Math.abs(delta) >= TOLERANCE) {
          lastDir = delta > 0 ? 1 : -1;
          lastY   = y;
        }
        // Show: at top, at bottom, or scrolling up. Hide: scrolling down
        // anywhere in the middle.
        const shouldHide = lastDir === 1 && !atTop && !atBottom;
        ctaWrap.classList.toggle('is-hidden', shouldHide);
      };

      list.addEventListener('scroll', onScroll, { passive: true });
      // Initial state: visible
      ctaWrap.classList.remove('is-hidden');
    }
  }

  function itemRowHtml(item, line, deliveryDate, location, readOnly) {
    // Display name precedence (handled by pickHouseName):
    //   1. Per-location team name (order_guide_pars.house_name)
    //   2. Catalog team name (order_guide_items.house_name)
    //   3. Vendor's raw item_name
    // The OTHER name moves to the meta line so SKU verification still
    // works (e.g. "Big Foil" up top, "FOIL HD 18\" ROLL · SKU 157549" below).
    const parOverride = entryState && entryState.par_overrides && entryState.par_overrides[item.id];
    const primary    = pickHouseName(item, parOverride);
    const vendorName = (item.item_name || '').trim();
    const showVendorAlias = primary !== vendorName && vendorName;

    // Search-match attribute: combine team name + vendor name lowercased
    // so search hits regardless of which one the user typed.
    const searchKey = `${primary} ${vendorName}`.toLowerCase().trim();

    const hint = parHintFor(item, deliveryDate, location);
    if (hint.disabled) {
      return `
        <div class="ord-item-row is-disabled" data-item-id="${esc(item.id)}" data-item-name="${esc(searchKey)}">
          <div class="ord-item-main">
            <div class="ord-item-name">${esc(primary)}</div>
            <div class="ord-item-meta">not stocked at ${esc(location)}</div>
          </div>
        </div>`;
    }
    const qty = (line && line.qty) || 0;
    // Meta line: alias, SKU, note. Par used to be in this line as
    // "par: 5 GA Mon" — it's now broken out into a dedicated chip below
    // so the user can see PAR + UNIT at a glance instead of hunting for
    // it inside a comma-separated meta string.
    const meta = [];
    if (showVendorAlias)  meta.push(esc(vendorName));
    if (item.vendor_sku)  meta.push(`SKU ${esc(item.vendor_sku)}`);
    if (item.note)        meta.push(esc(item.note));

    // Par chip — bottom-left of the main column, below the meta line.
    // Empty when there's no par configured. Shows the day label ("Mon",
    // "Tue") only when a per-weekday override is active for the
    // delivery date, otherwise just "PAR 5 GA".
    // v18.28 (polish) — adds .is-met (qty ≥ par, soft green) and
    // .is-short (0 < qty < par, soft amber) modifiers so the chip
    // becomes a glance-able status badge. Bare/zero-qty rows stay
    // neutral so the page doesn't look like a stoplight.
    const liveQty = line ? Number(line.qty) || 0 : 0;
    let parStateCls = '';
    if (hint.chipQty != null && liveQty > 0) {
      parStateCls = liveQty >= Number(hint.chipQty) ? ' is-met' : ' is-short';
    }
    const parChip = (hint.chipQty != null) ? `
      <div class="ord-item-par-chip${parStateCls}" title="Target stock level">
        <span class="ord-item-par-label">PAR</span>
        <span class="ord-item-par-qty">${esc(String(hint.chipQty))}</span>
        <span class="ord-item-par-unit">${esc(hint.chipUnit)}</span>
        ${hint.chipDay ? `<span class="ord-item-par-day">· ${esc(hint.chipDay)}</span>` : ''}
      </div>` : '';

    // Pack-size column — split into a primary "3 × 1 GA" line and a
    // muted "case" sub-line so the format is self-explaining at a glance.
    const pack = prettyPackSize(item.unit);

    // v18.26 — Per-row unit (editable). Resolution order:
    //   1. The live entry's unit (set if user has qty + edited unit)
    //   2. The per-vendor override map (set if user typed unit at qty=0)
    //   3. The catalog item's unit
    //   4. Fallback 'ea'
    // The override map persists in localStorage so a unit edit at qty=0
    // survives reload. Once qty becomes positive, the override gets
    // baked into the line entry which then writes to order_lines.unit
    // and flows through to the email.
    const overrideUnit = entryState && entryState.unitOverrides && entryState.unitOverrides[item.id];
    const rowUnit = (line && line.unit) || overrideUnit || shortUnit(item.unit) || 'ea';

    return `
      <div class="ord-item-row${qty > 0 ? ' has-qty' : ''}" data-item-id="${esc(item.id)}" data-item-name="${esc(searchKey)}">
        <div class="ord-item-main">
          <div class="ord-item-name">${esc(primary)}</div>
          ${meta.length ? `<div class="ord-item-meta">${meta.join(' · ')}</div>` : ''}
          ${parChip}
        </div>
        <div class="ord-qty">
          <button class="ord-qty-btn" data-action="dec" aria-label="Decrease" ${readOnly ? 'disabled' : ''}>−</button>
          <input class="ord-qty-input" type="number" min="0" step="1" inputmode="numeric" value="${qty || ''}" placeholder="0" ${readOnly ? 'readonly' : ''}>
          <button class="ord-qty-btn" data-action="inc" aria-label="Increase" ${readOnly ? 'disabled' : ''}>+</button>
        </div>
        <div class="ord-item-unit">
          <!-- v18.25 — Unit is now a free text input per row. Lets the
               chef override the catalog unit on-the-fly (1 bag of beans
               instead of 1 cs, 20 lbs of garlic instead of 1 ea, etc.)
               Defaults to the catalog item's unit. Saves to entryState
               .lines[id].unit so it persists through draft save + makes
               it into the order email exactly as typed. -->
          <input class="ord-item-unit-input" type="text"
                 value="${esc(rowUnit)}"
                 placeholder="ea"
                 maxlength="8"
                 autocomplete="off"
                 spellcheck="false"
                 aria-label="Unit"
                 ${readOnly ? 'readonly' : ''}>
          ${pack.secondary ? `<div class="ord-item-unit-sub">${esc(pack.secondary)}</div>` : ''}
        </div>
      </div>`;
  }

  function wireItemRow(row) {
    if (entryState.readOnly) return;
    const id = row.dataset.itemId;
    const item = entryState.catalog.find(c => c.id === id);
    if (!item) return;
    const dec = row.querySelector('[data-action="dec"]');
    const inc = row.querySelector('[data-action="inc"]');
    const inp = row.querySelector('.ord-qty-input');
    const unitInp = row.querySelector('.ord-item-unit-input');

    function applyQty(qty) {
      qty = Math.max(0, parseFloat(qty) || 0);
      if (qty === 0) {
        delete entryState.lines[id];
        row.classList.remove('has-qty');
        inp.value = '';
      } else {
        // v18.26 — Unit resolution order, identical to rowUnit derivation
        // so what you see in the input is what gets saved:
        //   1. Existing line's unit (if user changed unit after adding qty)
        //   2. Per-vendor override map (typed unit at qty=0)
        //   3. Current input value (defensive — should match #2)
        //   4. Catalog default
        const overrideUnit = entryState.unitOverrides && entryState.unitOverrides[id];
        const existingUnit = (entryState.lines[id] && entryState.lines[id].unit)
          || overrideUnit
          || (unitInp && unitInp.value && unitInp.value.trim())
          || item.unit
          || 'ea';
        entryState.lines[id] = {
          qty,
          unit: existingUnit,
          item_name: item.item_name,
          house_name: item.house_name || null,
          vendor_sku: item.vendor_sku,
          note: item.note,
        };
        row.classList.add('has-qty');
        inp.value = qty;
      }
      updateCtaCounter();
      scheduleDraftSave();
    }

    dec.addEventListener('click', () => applyQty((parseFloat(inp.value) || 0) - 1));
    inc.addEventListener('click', () => applyQty((parseFloat(inp.value) || 0) + 1));
    inp.addEventListener('input', e => applyQty(e.target.value));
    inp.addEventListener('blur',  e => applyQty(e.target.value));
    inp.addEventListener('focus', e => e.target.select());

    // v18.26 — Per-row unit input. ALWAYS persists to the per-vendor
    // override map in localStorage, regardless of whether a line entry
    // exists. This fixes the bug where a unit change with qty=0 was
    // silently dropped (applyUnit early-returned if no line existed,
    // so the typed unit vanished on next render).
    //
    // Now: type unit → write to override map → flush to localStorage.
    // If a line entry also exists, sync its unit too so the next save
    // writes the correct value into order_lines.unit, which the email
    // builder reads as `${qty}${unit} ${name}`.
    if (unitInp) {
      const applyUnit = (val) => {
        // Normalize: trim, lowercase, fall back to catalog or 'ea' if blank
        const trimmed = (val || '').trim();
        const u = trimmed || item.unit || 'ea';
        // ALWAYS write to the per-vendor override map. Persistent
        // regardless of whether there's a qty yet.
        if (!entryState.unitOverrides) entryState.unitOverrides = {};
        entryState.unitOverrides[id] = u;
        saveUnitOverrides(entryState.vendor.id, entryState.unitOverrides);
        // If there's a live line entry, sync its unit too
        if (entryState.lines[id]) {
          entryState.lines[id].unit = u;
          scheduleDraftSave();
        }
      };
      unitInp.addEventListener('input', e => applyUnit(e.target.value));
      unitInp.addEventListener('blur',  e => {
        // Re-normalize to fallback if blank
        if (!e.target.value.trim()) e.target.value = item.unit || 'ea';
        applyUnit(e.target.value);
      });
      unitInp.addEventListener('focus', e => e.target.select());
    }
  }

  function countItemsInOrder() {
    if (!entryState) return 0;
    return Object.values(entryState.lines).filter(l => l && l.qty > 0).length;
  }

  function updateCtaCounter() {
    const cta = document.getElementById('ordEntryReview');
    if (!cta || entryState.readOnly) return;
    const n = countItemsInOrder();
    cta.textContent = n > 0 ? `Review & Send · ${n} item${n === 1 ? '' : 's'}` : 'Review & Send';
    cta.disabled = n === 0;
  }

  function filterEntryItems(query) {
    const q = (query || '').trim().toLowerCase();
    const list = document.getElementById('ordEntryList');
    if (!list) return;
    list.querySelectorAll('.ord-entry-section').forEach(section => {
      let any = false;
      section.querySelectorAll('.ord-item-row').forEach(row => {
        const name = row.dataset.itemName || '';
        const match = !q || name.includes(q);
        row.style.display = match ? '' : 'none';
        if (match) any = true;
      });
      const label = section.querySelector('.ord-entry-section-label');
      if (label) label.style.display = any ? '' : 'none';
      section.style.display = any ? '' : 'none';
    });
  }

  // ─── DRAFT AUTOSAVE ──────────────────────────────────────────────
  function scheduleDraftSave() {
    if (!entryState || entryState.readOnly) return;
    if (entryState.saveTimer) clearTimeout(entryState.saveTimer);
    setSaveStatus('saving');
    entryState.saveTimer = setTimeout(() => persistDraft(), DRAFT_SAVE_DEBOUNCE_MS);
  }

  /* ════════════════════════════════════════════════════════════════════
     v18.26 — Per-vendor unit overrides (localStorage)

     A unit override is "for this vendor, I prefer to order item X in unit
     'ea' instead of the catalog's 'cs'." It needs to persist BEFORE qty
     is set (so typing 'ea' on a qty=0 row doesn't get lost), and survive
     across sessions. Stored in localStorage rather than the orders table
     because it's a vendor-level preference, not order-specific.

     Once qty > 0, the override gets BAKED into entryState.lines[id].unit
     which then writes to order_lines.unit, which the email builder reads.
     So: override → live entry → order line → email. One unit per item per
     vendor, consistent through the whole pipeline.
     ════════════════════════════════════════════════════════════════════ */
  function unitOverridesKey(vendorId) {
    return `nexus_ord_units_${vendorId}`;
  }
  function loadUnitOverrides(vendorId) {
    if (!vendorId) return {};
    try {
      const raw = localStorage.getItem(unitOverridesKey(vendorId));
      const parsed = raw ? JSON.parse(raw) : null;
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  function saveUnitOverrides(vendorId, map) {
    if (!vendorId) return;
    try {
      localStorage.setItem(unitOverridesKey(vendorId), JSON.stringify(map || {}));
    } catch (e) {
      // localStorage may be full or blocked — silent fail, override
      // remains in memory for this session at least.
    }
  }

  function setSaveStatus(state) {
    const el = document.getElementById('ordSaveStatus');
    if (!el) return;
    if (state === 'saving') el.textContent = 'Saving…';
    else if (state === 'saved') el.textContent = 'Draft saved';
    else if (state === 'error') el.textContent = 'Save failed (will retry)';
    else el.textContent = '';
    if (state === 'saved') setTimeout(() => {
      if (el.textContent === 'Draft saved') el.textContent = '';
    }, 2000);
  }
  async function persistDraft() {
    if (!entryState || entryState.readOnly || entryState.saveInFlight || !NX.sb) return;
    entryState.saveInFlight = true;
    try {
      const payload = {
        vendor_id:       entryState.vendor.id,
        location:        entryState.location,
        delivery_date:   entryState.delivery_date || null,
        status:          'draft',
        notes:           entryState.notes || null,
        created_by:      NX.user && NX.user.id   ? NX.user.id   : null,
        created_by_name: NX.user && NX.user.name ? NX.user.name : null,
      };
      let orderId = entryState.draftOrderId;
      if (!orderId) {
        const { data, error } = await NX.sb.from('orders').insert(payload).select('id').single();
        if (error) throw error;
        orderId = data.id;
        entryState.draftOrderId = orderId;
      } else {
        const { error } = await NX.sb.from('orders').update(payload).eq('id', orderId);
        if (error) throw error;
      }
      const { error: delErr } = await NX.sb.from('order_lines').delete().eq('order_id', orderId);
      if (delErr) throw delErr;
      const lineRows = Object.entries(entryState.lines)
        .filter(([_id, l]) => l && l.qty > 0)
        .map(([item_id, l], i) => ({
          order_id: orderId, item_id,
          item_name: l.item_name, house_name: l.house_name || null, vendor_sku: l.vendor_sku,
          qty: l.qty, unit: l.unit, note: l.note, sort_order: i,
        }));
      if (lineRows.length) {
        let res = await NX.sb.from('order_lines').insert(lineRows);
        // Retry without house_name if the column doesn't exist yet
        if (res.error && /house_name|column.*does not exist|schema cache/i.test(res.error.message || '')) {
          const fb = lineRows.map(r => { const { house_name, ...rest } = r; return rest; });
          res = await NX.sb.from('order_lines').insert(fb);
        }
        if (res.error) throw res.error;
      }
      setSaveStatus('saved');
    } catch (e) {
      console.error('[ordering] persistDraft:', e);
      setSaveStatus('error');
    } finally {
      entryState.saveInFlight = false;
    }
  }
  async function flushDraftIfPending() {
    if (!entryState || entryState.readOnly) return;
    if (entryState.saveTimer) {
      clearTimeout(entryState.saveTimer);
      entryState.saveTimer = null;
      await persistDraft();
    }
  }

  async function cloneAsNewDraft() {
    if (!entryState) return;
    const oldLines = entryState.lines;
    entryState = {
      vendor: entryState.vendor,
      catalog: entryState.catalog,
      par_overrides: entryState.par_overrides,
      location: entryState.location,
      delivery_date: nextDeliveryDate(entryState.vendor, entryState.location),
      notes: '',
      lines: JSON.parse(JSON.stringify(oldLines)),
      draftOrderId: null,
      saveTimer: null, saveInFlight: false,
      overlay: entryState.overlay,
      reviewing: false,
    };
    if (NX.toast) NX.toast('Reorder draft created', 'info', 1500);
    renderEntryItems();
    scheduleDraftSave();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2 — CART REVIEW
  // ═══════════════════════════════════════════════════════════════════

  function openReview() {
    if (!entryState) return;
    entryState.reviewing = true;
    renderReview();
  }

  function renderReview() {
    if (!entryState) return;
    const { vendor, location, delivery_date, lines, notes } = entryState;
    const overlay = entryState.overlay;
    if (!overlay) return;

    const itemById = {};
    entryState.catalog.forEach(it => itemById[it.id] = it);
    const linesArr = Object.entries(lines)
      .filter(([_id, l]) => l && l.qty > 0)
      .map(([item_id, l]) => ({
        item_id, ...l,
        section: itemById[item_id]?.section || null,
        sort_order: itemById[item_id]?.sort_order ?? 9999,
      }))
      .sort((a, b) => (a.section || '').localeCompare(b.section || '') || a.sort_order - b.sort_order);

    const grouped = new Map();
    linesArr.forEach(l => {
      const k = l.section || '';
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(l);
    });

    const subject = buildSubject(vendor, location, delivery_date);
    const recipient = vendor.email || '';

    overlay.innerHTML = `
      <div class="ord-entry-head">
        <button class="ord-entry-close" id="ordReviewBack" aria-label="Back">${arrowLeftIcon()}</button>
        <div class="ord-entry-title">
          <div class="ord-entry-vendor">Review · ${esc(vendor.name)}</div>
          <div class="ord-entry-sub">${esc(LOCS.find(l => l.id === location)?.label || location)} · ${esc(fmtDateShort(delivery_date))}</div>
        </div>
        <div class="ord-entry-spacer"></div>
      </div>

      <div class="ord-review-body">
        <div class="ord-review-section">
          <div class="ord-section-label">Sending to</div>
          <div class="ord-recipient-wrap" id="ordRecipientWrap">
            ${recipient
              ? `<div class="ord-recipient-row">
                   <span class="ord-recipient-email">${esc(recipient)}</span>
                   <button class="ord-recipient-edit" id="ordRecipientEdit">Change</button>
                 </div>`
              : `<div class="ord-recipient-missing">
                   <div class="ord-recipient-warn"><i data-lucide="alert-triangle" class="ord-warn-icon"></i> No email set for ${esc(vendor.name)}</div>
                   <input type="email" class="ord-recipient-input" id="ordRecipientInput" placeholder="vendor@example.com">
                   <button class="ord-recipient-save" id="ordRecipientSave">Save email</button>
                 </div>`
            }
          </div>
        </div>

        <div class="ord-review-section">
          <div class="ord-section-label">Subject</div>
          <div class="ord-subject-preview">${esc(subject)}</div>
        </div>

        <div class="ord-review-section">
          <div class="ord-section-label">${linesArr.length} item${linesArr.length === 1 ? '' : 's'}</div>
          ${Array.from(grouped.entries()).map(([sec, list]) => `
            ${sec ? `<div class="ord-review-section-head">${esc(sec)}</div>` : ''}
            ${list.map(l => {
              // Team name when set, vendor name as alias when both exist.
              const houseName  = (l.house_name || '').trim();
              const vendorName = (l.item_name  || '').trim();
              const primary    = houseName || vendorName;
              const showAlias  = houseName && vendorName && houseName !== vendorName;
              return `
              <div class="ord-review-line">
                <div class="ord-review-qty">${esc(l.qty)} ${esc(l.unit || 'ea')}</div>
                <div class="ord-review-name">
                  ${esc(primary)}
                  ${showAlias ? `<span class="ord-review-alias">${esc(vendorName)}</span>` : ''}
                  ${l.vendor_sku ? `<span class="ord-review-sku">${esc(l.vendor_sku)}</span>` : ''}
                </div>
              </div>
              `;
            }).join('')}
          `).join('')}
        </div>

        <div class="ord-review-section">
          <div class="ord-section-label">Notes (optional)</div>
          <textarea class="ord-notes-input" id="ordNotesInput"
            placeholder="Anything special? e.g. 'leave avocados firm', 'split into 2 boxes'…">${esc(notes)}</textarea>
        </div>
      </div>

      <div class="ord-entry-cta-wrap">
        <button class="ord-entry-cta ord-send-cta" id="ordSendBtn" ${recipient ? '' : 'disabled'}>
          ${envelopeIcon()} Send Order
        </button>
        <div class="ord-entry-save-status" id="ordSaveStatus"></div>
      </div>
    `;

    overlay.querySelector('#ordReviewBack').addEventListener('click', () => {
      entryState.reviewing = false;
      renderEntryItems();
    });
    const notesEl = overlay.querySelector('#ordNotesInput');
    if (notesEl) {
      notesEl.addEventListener('input', e => {
        entryState.notes = e.target.value;
        scheduleDraftSave();
      });
    }
    const editBtn = overlay.querySelector('#ordRecipientEdit');
    if (editBtn) editBtn.addEventListener('click', () => promptVendorEmail(vendor));
    const saveBtn = overlay.querySelector('#ordRecipientSave');
    if (saveBtn) saveBtn.addEventListener('click', () => saveVendorEmailInline(vendor));
    const sendBtn = overlay.querySelector('#ordSendBtn');
    if (sendBtn) sendBtn.addEventListener('click', confirmAndSend);
  }

  // ─── VENDOR EMAIL EDIT ───────────────────────────────────────────
  async function saveVendorEmailInline(vendor) {
    const input = document.getElementById('ordRecipientInput');
    if (!input) return;
    const email = (input.value || '').trim();
    if (!email || !email.includes('@')) {
      if (NX.toast) NX.toast('Enter a valid email', 'warn');
      return;
    }
    const { error } = await NX.sb.from('order_vendors').update({ email }).eq('id', vendor.id);
    if (error) {
      console.error('[ordering] save vendor email:', error);
      if (NX.toast) NX.toast('Could not save email', 'error');
      return;
    }
    vendor.email = email;
    const cached = vendors.find(v => v.id === vendor.id);
    if (cached) cached.email = email;
    if (NX.toast) NX.toast('Email saved', 'info', 1200);
    renderReview();
  }

  function promptVendorEmail(vendor) {
    const wrap = document.getElementById('ordRecipientWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="ord-recipient-missing">
        <input type="email" class="ord-recipient-input" id="ordRecipientInput" value="${esc(vendor.email || '')}" placeholder="vendor@example.com">
        <button class="ord-recipient-save" id="ordRecipientSave">Save</button>
      </div>`;
    const inp = wrap.querySelector('#ordRecipientInput');
    if (inp) inp.focus();
    wrap.querySelector('#ordRecipientSave').addEventListener('click', () => saveVendorEmailInline(vendor));
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2 — EMAIL COMPOSITION (mailto)
  // ═══════════════════════════════════════════════════════════════════

  function fillTemplate(template, ctx) {
    return (template || '')
      .replace(/\{vendor\}/gi,        ctx.vendor || '')
      .replace(/\{location\}/gi,      ctx.location || '')
      .replace(/\{delivery_date\}/gi, ctx.delivery_date || '')
      .replace(/\{date\}/gi,          ctx.delivery_date || '');
  }

  function buildSubject(vendor, location, deliveryDate) {
    const ctx = {
      vendor: vendor.name,
      location: (LOCS.find(l => l.id === location)?.label) || location,
      delivery_date: fmtDateShort(deliveryDate),
    };
    if (vendor.subject_template) {
      const filled = fillTemplate(vendor.subject_template, ctx).trim();
      if (filled) return filled;
    }
    return `${vendor.name} order — ${ctx.location} for ${ctx.delivery_date}`;
  }

  /* Render the universal default email body. Single source of truth —
     called from buildBody when the vendor has no custom template, AND
     from the template editor's preview pane so the user sees exactly
     what the default produces.

     Pure function: takes formatted lines text + ctx, returns the full
     body string. Doesn't touch entryState or DB. */
  /* v18.25 — Email format match. Body now reads as a friendly, terse
     handoff matching how chefs actually message produce/dry-goods reps:

       Hey Anthony and Michael! Hope you are having a great weekend!!

       For tomorrow:
       1cs black trash bags
       1cs steel wool
       ...

       Thank you!!

     Replaces the prior "Hi {team}, please prepare this order: Delivery:…
     Location:…" block. Auto-detects weekend vs day from today's date,
     and tomorrow vs explicit-date from delivery_date.

     Recipient names pulled from vendor.recipient_names if set (e.g.
     "Anthony and Michael"); falls back to "{vendor.name} team" so
     unfamiliar vendors still get a sensible greeting. */
  function defaultEmailBody(vendor, ctx, linesText, notes, totalItemCount) {
    // Greeting names — prefer the explicit recipient_names field, else
    // fall back to "{vendor} team"
    const recipNames = (vendor.recipient_names || '').trim();
    const greetTo = recipNames || `${vendor.name} team`;

    // Weekend vs day — based on TODAY (when the email is being sent),
    // not the delivery date. Saturday/Sunday → "weekend"; otherwise "day".
    const dow = new Date().getDay();
    const isWeekend = (dow === 0 || dow === 6);
    const dayWord = isWeekend ? 'weekend' : 'day';

    // For X — if delivery is tomorrow (calendar-wise), say "tomorrow".
    // Otherwise spell out the day name + date for clarity ("Monday, May 11").
    const deliveryLabel = computeForLabel(ctx.delivery_date) || ctx.delivery_date_long || 'this order';

    let body = `Hey ${greetTo}! Hope you are having a great ${dayWord}!!\n\n`;
    // v18.28 (polish) — blank line after the "For X:" header so the
    // item list sits as a distinct block instead of crowding the
    // header. Better visual rhythm for the vendor scanning the email.
    body += `For ${deliveryLabel}:\n\n`;
    body += linesText;
    if (notes && notes.trim()) {
      body += `\n\n${notes.trim()}`;
    }
    body += `\n\nThank you!!\n`;
    return body;
  }

  /* Helper for the email greeting: turn a delivery_date (YYYY-MM-DD)
     into the right "For X" label.
       today              → "today"
       tomorrow           → "tomorrow"
       within next 7 days → "Monday" / "Tuesday" / etc.
       further out        → "Monday, May 11"
     Returns null if the date is unparseable; caller falls back. */
  function computeForLabel(dateStr) {
    if (!dateStr) return null;
    const target = new Date(dateStr + 'T00:00:00');
    if (isNaN(target)) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayDiff = Math.round((target - today) / 86400000);
    if (dayDiff === 0) return 'today';
    if (dayDiff === 1) return 'tomorrow';
    const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (dayDiff > 1 && dayDiff <= 7) return dowNames[target.getDay()];
    // Further out — use the long format from the existing helper
    return fmtDateLong(dateStr);
  }

  /* Detect a "legacy default" body template — the pattern from before
     the email format was overhauled. If a vendor's body_template
     matches this loose pattern, we suggest they reset to default
     instead of staying on the old format. We don't auto-overwrite —
     just surface the option in the template editor. */
  function isLegacyDefaultTemplate(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    // Heuristic: starts with "Hi ... team", contains "Please prepare for"
    // (the old phrasing), contains {lines}, ends with "Thanks". This
    // matches the pre-overhaul default but not custom prose.
    return /^Hi\s+[^,\n]+\s+team,/i.test(t)
        && /Please prepare for/i.test(t)
        && /\{lines\}/i.test(t)
        && /Thanks/i.test(t);
  }

  /* Render a preview of the default email body using sample data, for
     display in the vendor template editor. Sample lines mirror the
     simple {qty}{unit} {name} #{sku} format used in real emails. */
  function buildDefaultPreview(vendor) {
    const sampleCtx = {
      vendor: vendor.name || 'Vendor',
      location: 'Este Restaurant',
      // Pick tomorrow so the "For tomorrow:" branch fires in the preview
      delivery_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      delivery_date_long: 'Tomorrow',
    };
    const sampleLines =
      `1cs black trash bags\n` +
      `1cs steel wool\n` +
      `2cs large gloves\n` +
      `5cs sunflower oil\n` +
      `20lbs garlic\n` +
      `1bag black beans`;
    return defaultEmailBody(vendor, sampleCtx, sampleLines, '', 6);
  }

  function buildBody(vendor, location, deliveryDate, lines, notes) {
    const ctx = {
      vendor: vendor.name,
      location: (LOCS.find(l => l.id === location)?.label) || location,
      delivery_date_long: fmtDateLong(deliveryDate),
      delivery_date: fmtDateShort(deliveryDate),
    };
    const itemById = {};
    entryState.catalog.forEach(it => itemById[it.id] = it);
    const linesArr = Object.entries(lines)
      .filter(([_id, l]) => l && l.qty > 0)
      .map(([item_id, l]) => ({
        ...l, item_id,
        section: itemById[item_id]?.section || null,
        sort_order: itemById[item_id]?.sort_order ?? 9999,
      }))
      .sort((a, b) => (a.section || '').localeCompare(b.section || '') || a.sort_order - b.sort_order);

    /* ─────────────────────────────────────────────────────────────────
       Format the line list — one item per line, simple form:

         {qty}{unit} {team_name_or_vendor_name}  #{sku}

       Examples:
         1cs degreaser spray bottles
         1gal red wine vinegar  #RWV-1G
         5cs sunflower oil
         20lbs garlic

       Name uses team name (per-location override → catalog → vendor's
       item_name) so the vendor sees the human-friendly label everyone
       on the team uses internally. SKU appears to the right only when
       set, prefixed with # for invoice convention. No section headers,
       no two-line metadata, no per-item notes — just the order list.
       ───────────────────────────────────────────────────────────── */
    let linesText = '';
    let totalItemCount = 0;
    for (const l of linesArr) {
      const item = itemById[l.item_id];
      const parOverride = entryState && entryState.par_overrides && entryState.par_overrides[l.item_id];
      const name = pickHouseName(item, parOverride);
      const qty = l.qty;
      const u = shortUnit(l.unit || (item && item.unit));
      // v18.28 (polish, round 2) — mirrors the review screen structure
      // in plain text. The review shows three columns: qty (gold) +
      // name (white, large) + SKU (faint, small). Plain text has no
      // font sizes, so we reproduce the hierarchy via convention and
      // spacing:
      //   • bullet  — distinct list marker
      //   • qty unit — space-separated readable count
      //   • name    — primary content
      //   • #SKU    — invoice-convention prefix puts SKU in "reference"
      //               position so it reads as secondary
      // SKU only appears when set (catalog vendor_sku). Items without
      // a SKU just omit the column — no trailing whitespace.
      const sku = l.vendor_sku || (item && item.vendor_sku) || '';
      linesText += `  • ${qty} ${u}  ${name}`;
      if (sku) linesText += `  #${sku}`;
      linesText += `\n`;
      totalItemCount++;
    }
    linesText = linesText.replace(/\n+$/, '');

    // If the vendor has a custom body_template, expand its tokens.
    // Otherwise use the standard hi-team / please-prepare / lines format.
    if (vendor.body_template && vendor.body_template.trim()) {
      let body = vendor.body_template
        .replace(/\{vendor\}/gi,             ctx.vendor)
        .replace(/\{location\}/gi,           ctx.location)
        .replace(/\{delivery_date_long\}/gi, ctx.delivery_date_long)
        .replace(/\{delivery_date\}/gi,      ctx.delivery_date)
        .replace(/\{date\}/gi,               ctx.delivery_date)
        .replace(/\{lines\}/gi,              linesText)
        .replace(/\{notes\}/gi,              (notes || '').trim());
      return body + '\n';
    }

    // Default template — clean two-block layout: header / line items /
    // footer / sign-off. Calls into defaultEmailBody so the same format
    // can be previewed from the template editor.
    return defaultEmailBody(vendor, ctx, linesText, notes, totalItemCount);
  }

  /* ─── Sender self-CC filter ─────────────────────────────────────────
     The vendor's CC list is configured per-location and may include the
     user's own email (e.g. when the ops person sets themselves up so
     other team members get a copy). When the user is the one ACTUALLY
     SENDING, they don't need to be CC'd on their own email — most mail
     apps auto-bounce or duplicate the message in their inbox.

     NX.currentUser doesn't carry an email field, so we ask the user
     once and remember it in localStorage. Three states:
       null            → never asked, prompt next send
       ''/'__none__'   → asked + opted out, never prompt again, no filter
       'x@y.z'         → filter this email (case-insensitive) from cc/bcc

     The user can change/clear it later from the order entry footer's
     "Recipients" inspector (added below).
     ───────────────────────────────────────────────────────────────── */
  const SENDER_EMAIL_KEY = 'nexus.sender.email';

  function getSenderEmailFilter() {
    try {
      const v = localStorage.getItem(SENDER_EMAIL_KEY);
      if (v == null) return null;            // never asked
      if (v === '__none__') return '';       // explicitly opted out
      return String(v).trim().toLowerCase();
    } catch (_) { return ''; }
  }
  function setSenderEmailFilter(email) {
    try {
      const v = (email == null || email === '') ? '__none__' : String(email).trim().toLowerCase();
      localStorage.setItem(SENDER_EMAIL_KEY, v);
    } catch (_) {}
  }
  function clearSenderEmailFilter() {
    try { localStorage.removeItem(SENDER_EMAIL_KEY); } catch (_) {}
  }

  /**
   * Strip the saved sender email from cc/bcc. Returns the cleaned lists
   * plus a count of how many entries were removed (so the caller can
   * surface a toast). Idempotent — safe to call when no filter is set.
   */
  function stripSenderFromRecipients(ccList, bccList) {
    const me = getSenderEmailFilter();
    if (!me) return { ccList, bccList, removed: 0, sender: '' };
    const eq = (e) => (e || '').trim().toLowerCase() === me;
    const cBefore = ccList.length;
    const bBefore = bccList.length;
    const cleanCc  = ccList.filter(e => !eq(e));
    const cleanBcc = bccList.filter(e => !eq(e));
    const removed = (cBefore - cleanCc.length) + (bBefore - cleanBcc.length);
    return { ccList: cleanCc, bccList: cleanBcc, removed, sender: me };
  }

  function buildMailtoUrl(to, subject, body, cc, bcc) {
    // Manually construct — URLSearchParams uses + for spaces but mailto: needs %20.
    const enc = s => encodeURIComponent(s).replace(/\+/g, '%20');
    const params = [`subject=${enc(subject)}`, `body=${enc(body)}`];
    if (cc && cc.length)  params.push(`cc=${cc.map(e => encodeURIComponent(e)).join(',')}`);
    if (bcc && bcc.length) params.push(`bcc=${bcc.map(e => encodeURIComponent(e)).join(',')}`);
    return `mailto:${encodeURIComponent(to || '')}?${params.join('&')}`;
  }

  async function confirmAndSend() {
    if (!entryState) return;
    const { vendor, location, delivery_date, lines, notes } = entryState;
    if (!vendor.email) {
      if (NX.toast) NX.toast('Add a vendor email first', 'warn');
      return;
    }
    if (countItemsInOrder() === 0) {
      if (NX.toast) NX.toast('No items selected', 'warn');
      return;
    }

    // Cutoff check — soft block. If the cutoff for this delivery has
    // passed, surface a confirm so the user explicitly acknowledges
    // they're sending late. Vendors do accept late orders sometimes,
    // so we don't hard-block, just slow them down for one extra tap.
    const cutoff = vendorCutoffMoment(vendor, delivery_date, location);
    if (cutoff && cutoff.getTime() <= Date.now()) {
      const cutoffStr = cutoff.toLocaleString([], {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      });
      const ok = confirm(
        `${vendor.name}'s order cutoff was ${cutoffStr}. They may not accept this for ${fmtDateLong(delivery_date)}. Send anyway?`
      );
      if (!ok) return;
    }

    const subject = buildSubject(vendor, location, delivery_date);
    const body    = buildBody(vendor, location, delivery_date, lines, notes);

    if (body.length > MAILTO_BODY_WARN_LEN) {
      const ok = confirm(`This email is large (${body.length} chars). Some mail apps may truncate it. Send anyway?`);
      if (!ok) return;
    }

    // Persist as 'sent' BEFORE opening mailto (mobile may background JS)
    try {
      await flushDraftIfPending();
      const sentPayload = {
        status:         'sent',
        email_to:       vendor.email,
        email_subject:  subject,
        email_body:     body,
        email_sent_at:  new Date().toISOString(),
        notes:          notes || null,
        sent_by:        NX.user && NX.user.id   ? NX.user.id   : null,
        sent_by_name:   NX.user && NX.user.name ? NX.user.name : null,
      };
      if (entryState.draftOrderId) {
        const { error } = await NX.sb.from('orders').update(sentPayload).eq('id', entryState.draftOrderId);
        if (error) throw error;
      } else {
        const { data, error } = await NX.sb.from('orders').insert({
          ...sentPayload,
          vendor_id: vendor.id,
          location, delivery_date: delivery_date || null,
          created_by:      NX.user && NX.user.id   ? NX.user.id   : null,
          created_by_name: NX.user && NX.user.name ? NX.user.name : null,
        }).select('id').single();
        if (error) throw error;
        entryState.draftOrderId = data.id;
        const lineRows = Object.entries(lines)
          .filter(([_id, l]) => l && l.qty > 0)
          .map(([item_id, l], i) => ({
            order_id: data.id, item_id,
            item_name: l.item_name, house_name: l.house_name || null, vendor_sku: l.vendor_sku,
            qty: l.qty, unit: l.unit, note: l.note, sort_order: i,
          }));
        if (lineRows.length) {
          let res = await NX.sb.from('order_lines').insert(lineRows);
          if (res.error && /house_name|column.*does not exist|schema cache/i.test(res.error.message || '')) {
            const fb = lineRows.map(r => { const { house_name, ...rest } = r; return rest; });
            res = await NX.sb.from('order_lines').insert(fb);
          }
          if (res.error) throw res.error;
        }
      }
    } catch (e) {
      console.error('[ordering] mark sent:', e);
      if (NX.toast) NX.toast('Could not save order — sending email anyway', 'warn', 3000);
    }

    // Open mailto: with CC + BCC pulled from the vendor's recipient list
    // FOR THIS LOCATION. Each location has its own profile (Este might
    // CC alfredo@este, Suerte might CC ops@suerte) so the same vendor
    // sends with different recipients depending on which restaurant
    // is ordering. Recipients marked 'alt' are NOT auto-included
    // (manual-only by design).
    const recipients = parseAltEmails(vendor.alt_emails, location);
    let ccList  = recipients.filter(r => r.kind === 'cc').map(r => r.email);
    let bccList = recipients.filter(r => r.kind === 'bcc').map(r => r.email);

    // Self-CC filter — first send on this device prompts the user for
    // their own email so we can keep them off the CC line. Subsequent
    // sends silently strip. If they decline ('' / cancel), we mark as
    // opted-out and never ask again. Skip if there's nothing to strip
    // anyway — no point asking when there's no recipient list.
    if (getSenderEmailFilter() === null && (ccList.length || bccList.length)) {
      const reply = prompt(
        'What email do you send from?\n\n' +
        'We\'ll keep this address off the CC/BCC line on your own sends ' +
        'so you don\'t get a copy of every order you send. Stored on this ' +
        'device only — leave blank to skip and never ask again.'
      );
      // null = cancel pressed, '' = OK with empty input — both mean "skip".
      setSenderEmailFilter(reply);
    }
    const filtered = stripSenderFromRecipients(ccList, bccList);
    ccList  = filtered.ccList;
    bccList = filtered.bccList;
    if (filtered.removed > 0 && NX.toast) {
      NX.toast(`Removed your address (${filtered.sender}) from CC`, 'info', 2000);
    }

    const url = buildMailtoUrl(vendor.email, subject, body, ccList, bccList);
    window.location.href = url;

    // Capture the order ID before closeEntry() clears entryState
    const sentOrderId = entryState && entryState.draftOrderId;
    setTimeout(() => {
      closeEntry();
      show().catch(() => {});
      // Undo banner with 10s window — handles "wrong email", "missed item",
      // "wrong delivery date" mistakes that you only realize once the
      // mail app pops up. Tapping Undo reverts the order to draft and
      // clears email_sent_at; the email might have already been sent
      // from the user's mail app, but at least the NEXUS state matches
      // the user's intent so they can reopen the draft and try again.
      if (sentOrderId) showUndoSendBanner(sentOrderId, vendor.name);
      else if (NX.toast) NX.toast('Order sent — check your mail app', 'info', 3000);
    }, 600);
  }

  /* Snackbar-style banner that slides up from bottom-right with a
     countdown + Undo button. Lives 10 seconds then auto-dismisses.
     Stacks with NX.toast (which doesn't support actions) — this is
     a separate UI element since revert is a deliberate action that
     needs its own affordance. */
  function showUndoSendBanner(orderId, vendorName) {
    document.querySelector('.ord-undo-banner')?.remove();
    const banner = document.createElement('div');
    banner.className = 'ord-undo-banner';
    banner.innerHTML = `
      <div class="ord-undo-banner-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </div>
      <div class="ord-undo-banner-text">
        <div class="ord-undo-banner-title">Sent to ${esc(vendorName)}</div>
        <div class="ord-undo-banner-sub" data-undo-countdown>10s to undo</div>
      </div>
      <button class="ord-undo-banner-btn" type="button">Undo</button>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('is-shown'));

    let remaining = 10;
    const sub = banner.querySelector('[data-undo-countdown]');
    const tick = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) { clearInterval(tick); return; }
      if (sub) sub.textContent = `${remaining}s to undo`;
    }, 1000);
    const dismissTimer = setTimeout(() => {
      banner.classList.remove('is-shown');
      setTimeout(() => banner.remove(), 250);
      clearInterval(tick);
    }, 10000);

    banner.querySelector('.ord-undo-banner-btn').addEventListener('click', async () => {
      clearTimeout(dismissTimer);
      clearInterval(tick);
      banner.querySelector('.ord-undo-banner-btn').disabled = true;
      banner.querySelector('.ord-undo-banner-btn').textContent = 'Undoing…';
      try {
        const update = { status: 'draft', email_sent_at: null };
        const { error } = await NX.sb.from('orders').update(update).eq('id', orderId);
        if (error) throw error;
        if (initialized) {
          recentOrders = await loadRecentOrders(activeLoc);
          const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
          renderRecent(recentOrders, vmap);
          renderVendors();
        }
        banner.classList.remove('is-shown');
        setTimeout(() => banner.remove(), 250);
        if (NX.toast) NX.toast('Reverted to draft. Email may have already gone — reopen and resend if needed.', 'warn', 4000);
      } catch (e) {
        console.error('[ordering] undo send:', e);
        banner.querySelector('.ord-undo-banner-btn').disabled = false;
        banner.querySelector('.ord-undo-banner-btn').textContent = 'Undo';
        if (NX.toast) NX.toast('Could not undo: ' + ((e && e.message) || ''), 'error', 3000);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // OVERLAY LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  async function closeEntry() {
    if (entryState && entryState._escWired && entryState._escHandler) {
      document.removeEventListener('keydown', entryState._escHandler);
    }
    try { await flushDraftIfPending(); } catch (_) {}
    const overlay = document.querySelector('.ord-entry-overlay');
    if (overlay) overlay.remove();
    document.body.classList.remove('ord-overlay-open');
    entryState = null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE B — VENDOR + ITEM MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════
  // Two new overlays layered on top of the list pane:
  //   .ord-veditor-overlay — vendor editor (name, email, days, templates,
  //                           items list, archive)
  //   Item editing is INLINE inside the vendor editor — tapping an item
  //   row swaps it for a form, save/cancel returns to the row view.
  //
  // Anything that has a body persists to Supabase via direct table CRUD.
  // The `editorState` global tracks the current editor session.

  let editorState = null;
  let catalogState = null;       // dedicated catalog (items + sections) editor state
  /* shape:
     {
       isNew: bool,
       vendor: { … vendor row, possibly empty for new },
       items: [ … catalog rows ],
       editingItemId: itemId | 'new' | null,
       overlay: DOM,
     } */

  /**
   * Open the vendor editor. Pass null/undefined for "new vendor" mode.
   */
  /* ─────────────────────────────────────────────────────────────────────
   * openVendorEditor — opens the vendor edit screen via NX.recordEditor.
   *
   * Uses the shared engine in js/record-editor.js. The vendor editor is
   * one of two callers (the contractor editor in equipment.js is the
   * other). All visual chrome — overlay shell, collapsible cards with
   * chevrons, chip groups, photo + color picker — comes from the
   * engine. This function only wires vendor-specific bits (delivery
   * day pills, catalog CTA, archive) and the save payload that writes
   * to order_vendors.
   * ───────────────────────────────────────────────────────────────────── */
  async function openVendorEditor(vendor) {
    if (!window.NX || !NX.recordEditor) {
      console.error('[ordering] NX.recordEditor is required but not loaded — check script load order in index.html');
      if (NX.toast) NX.toast('Editor failed to load — refresh the page', 'error', 4000);
      return;
    }
    const isNew = !vendor;
    const v = isNew
      ? { name: '', email: '', alt_emails: [], image_url: '', avatar_hue: null, pinned: false,
          delivery_days: [], subject_template: '', body_template: '', notes: '' }
      : { ...vendor };

    // Bucket existing alt_emails into separate chip arrays per kind.
    // FOR THE ACTIVE LOCATION: each location is its own profile, so the
    // editor only ever shows/edits one location's recipients at a time.
    // The alt_emails column may be a legacy array (pre per-location) —
    // parseAltEmails returns the right slice either way.
    const altParsed = parseAltEmails(v.alt_emails, activeLoc);
    const ccArr  = altParsed.filter(r => r.kind === 'cc' ).map(r => r.email);
    const bccArr = altParsed.filter(r => r.kind === 'bcc').map(r => r.email);
    const altArr = altParsed.filter(r => r.kind === 'alt').map(r => r.email);
    const otherLocsConfigured = vendorHasOtherLocationPrefs(v, activeLoc);
    const activeLocLabel = (LOCS.find(l => l.id === activeLoc) || {}).label || activeLoc;

    // Catalog item count for the count chip + "Manage catalog" CTA.
    let itemCount = 0;
    if (!isNew && v.id) {
      try {
        const { count } = await NX.sb
          .from('order_guide_items')
          .select('id', { count: 'exact', head: true })
          .eq('vendor_id', v.id)
          .eq('archived', false);
        itemCount = count || 0;
      } catch (e) {
        dwarn('[ordering] count items for editor:', e);
      }
    }

    const RX = NX.recordEditor;
    const cards = [];

    // ─── Identity card ───────────────────────────────────────────
    cards.push({
      key: 'identity',
      title: 'Identity',
      expanded: true,
      body: RX.buildIdentityCardBody({
        name: v.name,
        photoUrl: v.image_url || '',
        hue: typeof v.avatar_hue === 'number' ? v.avatar_hue : 'auto',
        showPin: true,
        pinned: !!v.pinned,
        pinTitle: 'Pin to top of vendor list',
        pinSub: 'Pinned vendors always sort first.',
        nameLabel: 'Vendor name',
        namePlaceholder: 'e.g. Farm To Table',
      }),
    });

    // ─── Availability card — which restaurants does this vendor serve? ──
    // When all 3 pills active OR all 3 inactive, vendor is available
    // everywhere (locations stays null). When a strict subset is
    // active, locations is set to that array — vendors hide from
    // restaurants not in the list.
    const currentLocs = Array.isArray(v.locations) ? v.locations : null;
    const isAvailableAt = (locId) => {
      if (!currentLocs || !currentLocs.length) return true;
      return currentLocs.includes(locId);
    };
    cards.push({
      key: 'availability',
      title: 'Available at',
      expanded: false,
      body: `
        <div class="rx-form-field">
          <div class="rx-form-hint" style="margin-bottom:8px">Which restaurants does this vendor serve? Vendors hide from locations they don't serve.</div>
          <div class="rx-loc-pills" data-rx-locs>
            ${LOCS.map(l => `
              <button type="button" class="rx-loc-availability-pill${isAvailableAt(l.id) ? ' active' : ''}" data-loc-id="${esc(l.id)}">
                ${esc(l.label)}
              </button>
            `).join('')}
          </div>
        </div>
      `,
    });

    // ─── Recipients card (TO + CC chips + BCC chips + Other chips) ──
    // CC/BCC/Other are PER-LOCATION (each restaurant maintains its own
    // recipient profile). The TO is shared across all locations since
    // vendors typically have one orders@ inbox regardless of which
    // restaurant is sending.
    cards.push({
      key: 'recipients',
      title: 'Recipients',
      expanded: true,
      body: `
        <div class="rx-loc-scope">
          <span class="rx-loc-scope-icon"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span>
          <span class="rx-loc-scope-text">CC / BCC / Other are <strong>${esc(activeLocLabel)}'s profile</strong>${otherLocsConfigured ? ' — other locations have separate recipients' : ''}</span>
        </div>
        <div class="rx-form-field">
          <label class="rx-form-label">
            <span class="rx-chip-pill rx-chip-pill-to">TO</span>
            <span class="rx-form-hint">— required for sending orders, shared across all locations</span>
          </label>
          <input type="email" class="rx-form-input" data-rx-vendor-email value="${esc(v.email || '')}" placeholder="orders@vendor.com" autocomplete="off" inputmode="email">
        </div>
        <!-- v18.25 — Recipient names for the email greeting line.
             Used by defaultEmailBody to render "Hey {names}!" instead
             of "Hi {vendor} team,". Optional — empty falls back to the
             vendor name. Type names exactly as you'd write them in the
             greeting, e.g. "Anthony and Michael" or just "Anthony". -->
        <div class="rx-form-field">
          <label class="rx-form-label">
            Greeting names
            <span class="rx-form-hint">— used in "Hey ___!" line. Blank = "{vendor} team"</span>
          </label>
          <input type="text" class="rx-form-input" data-rx-recipient-names value="${esc(v.recipient_names || '')}" placeholder="e.g. Anthony and Michael" autocomplete="off" maxlength="120">
        </div>
        ${RX.buildChipGroupHTML(ccArr,  'cc',  { label: 'CC',    hint: `always copied on ${esc(activeLocLabel)}'s orders`,        inputType: 'email', inputMode: 'email', placeholder: 'cc@example.com',     addLabel: 'Add CC' })}
        ${RX.buildChipGroupHTML(bccArr, 'bcc', { label: 'BCC',   hint: `silent copies on ${esc(activeLocLabel)}'s orders`,       inputType: 'email', inputMode: 'email', placeholder: 'bcc@example.com',    addLabel: 'Add BCC' })}
        ${RX.buildChipGroupHTML(altArr, 'alt', { label: 'OTHER', hint: `stored only for ${esc(activeLocLabel)} — NOT auto-sent`, inputType: 'email', inputMode: 'email', placeholder: 'backup@example.com', addLabel: 'Add other' })}
      `,
    });

    // ─── Schedule (delivery days + cutoff) ──
    // Defaults live on the vendor; each location can override via
    // location_overrides[loc] = { delivery_days, cutoff_time,
    // cutoff_days_before }. The editor shows the EFFECTIVE schedule for
    // the active location with a toggle: "Same as default" (uses
    // vendor defaults — inputs disabled) vs. "Custom for [Loc]"
    // (inputs editable, writes to the override slice on save).
    const sched = effectiveSchedule(v, activeLoc);
    const isCustomForLoc = sched.isCustom;

    // Render a small "default schedule" summary for the dimmed mode.
    // Helps the user see WHAT the default actually is at a glance.
    const defDays = (v.delivery_days || []);
    const defDaysLbl = defDays.length
      ? defDays.map(k => WEEKDAY_LBL[WEEKDAY_KEYS.indexOf(k)]).filter(Boolean).join(', ')
      : 'no days set';
    const defCutoffLbl = v.cutoff_time
      ? `${v.cutoff_time} ${v.cutoff_days_before === 0 ? 'on delivery day' : `${v.cutoff_days_before == null ? 1 : v.cutoff_days_before}d before`}`
      : 'no cutoff';

    // Render the per-location overrides count for a sub-line
    const overrideCount = v.location_overrides && typeof v.location_overrides === 'object'
      ? Object.keys(v.location_overrides).length
      : 0;
    const otherLocsScheduled = overrideCount > (isCustomForLoc ? 1 : 0);

    cards.push({
      key: 'schedule',
      title: 'Schedule',
      expanded: false,
      body: `
        <div class="rx-loc-scope rx-sched-scope${isCustomForLoc ? ' is-custom' : ''}">
          <span class="rx-loc-scope-icon">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </span>
          <span class="rx-loc-scope-text">
            ${isCustomForLoc
              ? `<strong>Custom schedule for ${esc(activeLocLabel)}</strong> — overrides the vendor default`
              : `Using vendor's <strong>default schedule</strong> at ${esc(activeLocLabel)}${otherLocsScheduled ? ' — other locations have custom schedules' : ''}`}
          </span>
        </div>

        <div class="rx-sched-toggle-row" data-rx-sched-toggle-wrap>
          <button type="button" class="rx-sched-toggle-btn${isCustomForLoc ? ' is-active' : ''}" data-rx-sched-toggle="custom" aria-pressed="${isCustomForLoc ? 'true' : 'false'}">
            ${isCustomForLoc ? `Custom for ${esc(activeLocLabel)}` : `Customize for ${esc(activeLocLabel)}`}
          </button>
          ${isCustomForLoc ? `
            <button type="button" class="rx-sched-reset-btn" data-rx-sched-toggle="reset">Reset to default</button>
          ` : ''}
        </div>

        ${!isCustomForLoc ? `
          <div class="rx-sched-default-summary">
            <div class="rx-sched-default-row">
              <span class="rx-sched-default-label">Default delivery days</span>
              <span class="rx-sched-default-value">${esc(defDaysLbl)}</span>
            </div>
            <div class="rx-sched-default-row">
              <span class="rx-sched-default-label">Default cutoff</span>
              <span class="rx-sched-default-value">${esc(defCutoffLbl)}</span>
            </div>
            <div class="rx-sched-default-hint">Edits below update the vendor default — applies to every location without a custom schedule.</div>
          </div>
        ` : ''}

        <div class="rx-form-field${isCustomForLoc ? ' is-editing-override' : ''}">
          <label class="rx-form-label">Delivery days ${isCustomForLoc ? `<span class="rx-form-hint">— for ${esc(activeLocLabel)} only</span>` : `<span class="rx-form-hint">— vendor default</span>`}</label>
          <div class="rx-day-pills" data-rx-days>
            ${WEEKDAY_KEYS.map((k, i) => `
              <button type="button" class="rx-day-pill${(sched.delivery_days || []).includes(k) ? ' active' : ''}" data-day="${esc(k)}">${esc(WEEKDAY_LBL[i])}</button>
            `).join('')}
          </div>
        </div>
        <div class="rx-form-field${isCustomForLoc ? ' is-editing-override' : ''}">
          <label class="rx-form-label">Order cutoff ${isCustomForLoc ? `<span class="rx-form-hint">— for ${esc(activeLocLabel)} only</span>` : `<span class="rx-form-hint">— vendor default</span>`}</label>
          <div class="rx-cutoff-row">
            <input type="time" class="rx-form-input rx-cutoff-time" data-rx-cutoff-time value="${esc(sched.cutoff_time || '')}">
            <span class="rx-cutoff-conn">on</span>
            <select class="rx-form-input rx-cutoff-days" data-rx-cutoff-days>
              <option value="0"${(sched.cutoff_days_before === 0) ? ' selected' : ''}>delivery day</option>
              <option value="1"${(sched.cutoff_days_before == null || sched.cutoff_days_before === 1) ? ' selected' : ''}>day before</option>
              <option value="2"${(sched.cutoff_days_before === 2) ? ' selected' : ''}>2 days before</option>
              <option value="3"${(sched.cutoff_days_before === 3) ? ' selected' : ''}>3 days before</option>
            </select>
          </div>
          <div class="rx-form-hint">Leave time blank if this vendor has no firm cutoff.</div>
        </div>

        <input type="hidden" data-rx-sched-mode value="${isCustomForLoc ? 'custom' : 'default'}">
      `,
    });

    // ─── Email templates ──
    // Universal default first. Lead-in note explains that all vendors
    // share the same clean format unless overridden — most users never
    // need to touch this card. Legacy templates (matching the old
    // default pattern) get an upgrade banner.
    const isLegacy = isLegacyDefaultTemplate(v.body_template);
    cards.push({
      key: 'templates',
      title: 'Email templates',
      expanded: false,
      body: `
        <div class="rx-form-note">
          Every vendor uses the same clean default email format. Set fields below only if this vendor needs different copy.
        </div>

        <details class="rx-form-preview" data-rx-preview>
          <summary>Preview the default format</summary>
          <pre class="rx-form-preview-pre" data-rx-preview-body>${esc(buildDefaultPreview(v))}</pre>
        </details>

        ${isLegacy ? `
          <div class="rx-form-banner rx-form-banner-warn" data-rx-legacy-banner>
            <div class="rx-form-banner-text">
              <strong>This template uses the old email format.</strong>
              <span>Tap <em>Use default</em> to switch to the new universal format.</span>
            </div>
          </div>
        ` : ''}

        <div class="rx-form-field">
          <div class="rx-form-label-row">
            <label class="rx-form-label">Subject line override</label>
            <button type="button" class="rx-form-link" data-rx-reset-subject>Use default</button>
          </div>
          <input type="text" class="rx-form-input" data-rx-subject value="${esc(v.subject_template || '')}" placeholder="${esc(v.name || 'Vendor')} order — {location} for {delivery_date}" autocomplete="off">
          <div class="rx-form-hint">Tokens: <code>{vendor}</code> <code>{location}</code> <code>{delivery_date}</code></div>
        </div>
        <div class="rx-form-field">
          <div class="rx-form-label-row">
            <label class="rx-form-label">Body template override</label>
            <button type="button" class="rx-form-link" data-rx-reset-body>Use default</button>
          </div>
          <textarea class="rx-form-input rx-form-textarea" data-rx-body rows="6" placeholder="Leave blank to use the default shown above. If set, your text replaces the body — use {lines} where the item list should appear.">${esc(v.body_template || '')}</textarea>
          <div class="rx-form-hint">Tokens: <code>{vendor}</code> <code>{location}</code> <code>{delivery_date_long}</code> <code>{lines}</code> <code>{notes}</code></div>
        </div>
      `,
    });

    // ─── Internal notes ──
    cards.push({
      key: 'notes',
      title: 'Internal notes',
      expanded: false,
      body: `
        <div class="rx-form-field">
          <textarea class="rx-form-input rx-form-textarea rx-form-textarea-sm" data-rx-notes rows="3" placeholder="Anything to remember about this vendor — only you see this">${esc(v.notes || '')}</textarea>
        </div>
      `,
    });

    // ─── Catalog CTA (existing vendors only) ──
    if (!isNew) {
      cards.push({
        key: 'catalog',
        title: 'Catalog',
        subtitle: `${itemCount} item${itemCount === 1 ? '' : 's'}`,
        expanded: false,
        body: `
          <button class="ved-catalog-cta" type="button" data-rx-catalog-cta>
            <div class="ved-catalog-cta-icon">${listIcon()}</div>
            <div class="ved-catalog-cta-main">
              <div class="ved-catalog-cta-title">Manage catalog →</div>
              <div class="ved-catalog-cta-sub">Sections, items, reorder</div>
            </div>
          </button>
        `,
      });
    }

    // ─── Danger zone ──
    if (!isNew) {
      cards.push({
        key: 'danger',
        title: 'Danger zone',
        expanded: false,
        danger: true,
        body: `
          <button class="ord-veditor-archive-btn" type="button" data-rx-archive>${trashIcon()}<span>Archive vendor</span></button>
          <div class="rx-form-hint rx-form-hint--center">Archived vendors are hidden from the list. Order history is preserved.</div>
        `,
      });
    }

    // Validation: light-touch email format check
    const emailValidator = (e) => {
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
      return ok ? null : 'Invalid email';
    };

    RX.openOverlay({
      title:    isNew ? 'New vendor' : (v.name || 'Vendor'),
      subtitle: isNew ? null : (v.email || 'No email set'),
      countChip: isNew ? null : { num: itemCount, label: itemCount === 1 ? 'item' : 'items' },
      cards,
      saveLabel:   isNew ? 'Create vendor' : 'Save changes',
      cancelLabel: 'Cancel',
      state: {
        chips: { cc: ccArr, bcc: bccArr, alt: altArr },
      },

      onMount: (overlay, state) => {
        // Identity widgets: photo (with downscale) + hue picker
        RX.wirePhotoPicker(overlay, state, {
          maxBytes: 12 * 1024 * 1024,
          tooLargeMsg: 'Image too large (12 MB max)',
          processFile: (file) => downscaleImageToDataUrl(file, 384, 0.85),
        });
        RX.wireHuePicker(overlay, state);

        // Recipient chip groups (cc / bcc / alt)
        ['cc', 'bcc', 'alt'].forEach(kind => {
          RX.wireChipGroup(overlay, kind, state, {
            label: kind === 'alt' ? 'OTHER' : kind.toUpperCase(),
            hint: kind === 'cc' ? 'always copied on every order'
                : kind === 'bcc' ? "silent copies — others can't see them"
                : 'stored only — NOT auto-sent (backups)',
            inputType: 'email',
            inputMode: 'email',
            placeholder: 'email@example.com',
            addLabel: kind === 'alt' ? 'Add other' : `Add ${kind.toUpperCase()}`,
            validate: emailValidator,
          });
        });

        // Delivery day pills — toggle on tap
        overlay.querySelectorAll('[data-rx-days] .rx-day-pill').forEach(btn => {
          btn.addEventListener('click', () => btn.classList.toggle('active'));
        });

        // Schedule custom / default mode toggle. Tapping "Customize for X"
        // flips the schedule inputs from "editing the vendor default"
        // into "editing the override slice for this location." The save
        // flow reads data-rx-sched-mode at save time to know which
        // destination to write to. We update visual classes here so the
        // banner copy + field hint text reflect the new state, but we
        // don't re-render the inputs — the day pills + cutoff time keep
        // their current values, the user just continues from there.
        const wireSchedToggle = () => {
          overlay.querySelectorAll('[data-rx-sched-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
              const mode = btn.dataset.rxSchedToggle;  // 'custom' or 'reset'
              const modeInput = overlay.querySelector('[data-rx-sched-mode]');
              const scopeBanner = overlay.querySelector('.rx-sched-scope');
              const scopeText   = scopeBanner ? scopeBanner.querySelector('.rx-loc-scope-text') : null;
              const fields      = overlay.querySelectorAll('.rx-form-field.is-editing-override, .rx-form-field:has([data-rx-days]), .rx-form-field:has([data-rx-cutoff-time])');
              const summary     = overlay.querySelector('.rx-sched-default-summary');
              const toggleWrap  = overlay.querySelector('[data-rx-sched-toggle-wrap]');
              if (!modeInput) return;

              if (mode === 'custom') {
                modeInput.value = 'custom';
                if (scopeBanner) scopeBanner.classList.add('is-custom');
                if (scopeText)   scopeText.innerHTML = `<strong>Custom schedule for ${esc(activeLocLabel)}</strong> — overrides the vendor default`;
                fields.forEach(f => f.classList.add('is-editing-override'));
                if (summary) summary.style.display = 'none';
                if (toggleWrap) {
                  toggleWrap.innerHTML = `
                    <button type="button" class="rx-sched-toggle-btn is-active" data-rx-sched-toggle="custom" aria-pressed="true">Custom for ${esc(activeLocLabel)}</button>
                    <button type="button" class="rx-sched-reset-btn" data-rx-sched-toggle="reset">Reset to default</button>
                  `;
                  wireSchedToggle();  // re-bind on the new buttons
                }
                // Update field hints
                overlay.querySelectorAll('.rx-form-field .rx-form-label .rx-form-hint').forEach((hint, i) => {
                  if (i < 2) hint.textContent = `— for ${activeLocLabel} only`;
                });
              } else if (mode === 'reset') {
                modeInput.value = 'default';
                if (scopeBanner) scopeBanner.classList.remove('is-custom');
                if (scopeText)   scopeText.innerHTML = `Using vendor's <strong>default schedule</strong> at ${esc(activeLocLabel)}`;
                fields.forEach(f => f.classList.remove('is-editing-override'));
                // Reset inputs to vendor defaults
                overlay.querySelectorAll('[data-rx-days] .rx-day-pill').forEach(p => {
                  if ((v.delivery_days || []).includes(p.dataset.day)) p.classList.add('active');
                  else p.classList.remove('active');
                });
                const tIn = overlay.querySelector('[data-rx-cutoff-time]');
                if (tIn) tIn.value = v.cutoff_time || '';
                const dSel = overlay.querySelector('[data-rx-cutoff-days]');
                if (dSel) dSel.value = String(v.cutoff_days_before == null ? 1 : v.cutoff_days_before);
                if (summary) summary.style.display = '';
                if (toggleWrap) {
                  toggleWrap.innerHTML = `
                    <button type="button" class="rx-sched-toggle-btn" data-rx-sched-toggle="custom" aria-pressed="false">Customize for ${esc(activeLocLabel)}</button>
                  `;
                  wireSchedToggle();
                }
                overlay.querySelectorAll('.rx-form-field .rx-form-label .rx-form-hint').forEach((hint, i) => {
                  if (i < 2) hint.textContent = `— vendor default`;
                });
              }
            });
          });
        };
        wireSchedToggle();

        // Visibility location pills — toggle which locations this vendor serves
        overlay.querySelectorAll('[data-rx-locs] .rx-loc-availability-pill').forEach(btn => {
          btn.addEventListener('click', () => btn.classList.toggle('active'));
        });

        // Catalog CTA — closes editor, opens catalog editor for this vendor
        const catalogBtn = overlay.querySelector('[data-rx-catalog-cta]');
        if (catalogBtn) {
          catalogBtn.addEventListener('click', () => {
            RX.close();
            // Re-find vendor from the cache to get the freshest data
            const fresh = vendors.find(x => x.id === v.id) || v;
            openCatalogEditor(fresh);
          });
        }

        // Archive button — confirms then archives
        const archiveBtn = overlay.querySelector('[data-rx-archive]');
        if (archiveBtn) {
          archiveBtn.addEventListener('click', async () => {
            if (!confirm(`Archive ${v.name}? It will be hidden from the vendor list. Order history is preserved.`)) return;
            try {
              await archiveVendorById(v.id, v.name);
              RX.close();
            } catch (err) {
              console.error('[ordering] archive failed:', err);
              if (NX.toast) NX.toast('Failed to archive: ' + (err.message || ''), 'error', 3000);
            }
          });
        }

        // Template reset buttons — clear the override field so the
        // universal default takes over on next email send. The user
        // still has to hit Save to persist, so the change isn't
        // committed without their consent.
        const resetSubject = overlay.querySelector('[data-rx-reset-subject]');
        if (resetSubject) {
          resetSubject.addEventListener('click', () => {
            const inp = overlay.querySelector('[data-rx-subject]');
            if (inp) {
              inp.value = '';
              inp.focus();
              if (NX.toast) NX.toast('Subject reset to default — tap Save to apply', 'info', 1800);
            }
          });
        }
        const resetBody = overlay.querySelector('[data-rx-reset-body]');
        if (resetBody) {
          resetBody.addEventListener('click', () => {
            const ta = overlay.querySelector('[data-rx-body]');
            if (ta) {
              ta.value = '';
              ta.focus();
              // Hide the legacy banner if it was showing — clearing the
              // field is exactly what we were asking the user to do.
              const banner = overlay.querySelector('[data-rx-legacy-banner]');
              if (banner) banner.remove();
              if (NX.toast) NX.toast('Body reset to default — tap Save to apply', 'info', 1800);
            }
          });
        }
      },

      onSave: async (overlay, state) => {
        const id = RX.readIdentityValues(overlay, state);
        if (!id.name) {
          if (NX.toast) NX.toast('Name is required', 'warn', 1800);
          return false;
        }

        // ─── Auto-commit ANY pending chip input values ────────────────
        // The user might have typed an email and tapped Save WITHOUT
        // first pressing Enter or the Add button. Without this rescue,
        // that email vanishes silently. Walk every VISIBLE chip input;
        // if the value is non-empty + valid + not already in state, push
        // it. This is the single biggest source of "CC didn't save."
        //
        // CRITICAL: only auto-commit from VISIBLE input wraps. Chrome on
        // Android aggressively autofills email-type inputs across the
        // whole page — when the user accepts an autofill suggestion in
        // (say) CC's open input, the same value gets shoved silently
        // into the hidden BCC and OTHER inputs too. Without the
        // visibility guard below, we'd then commit those autofilled
        // values to BCC + OTHER as well, and the email would mysteriously
        // appear in all three groups on the next open. That was the bug.
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        ['cc', 'bcc', 'alt'].forEach(kind => {
          const inp = overlay.querySelector(`[data-rx-chip-input="${kind}"]`);
          if (!inp) return;
          const wrap = inp.closest('.rx-chip-input-wrap');
          if (!wrap || wrap.hidden) return;       // hidden wrap = autofill leak; ignore
          const v = (inp.value || '').trim();
          if (!v) return;
          if (!emailRe.test(v)) return;
          state.chips[kind] = state.chips[kind] || [];
          if (state.chips[kind].includes(v)) return;
          state.chips[kind].push(v);
        });

        const email = (overlay.querySelector('[data-rx-vendor-email]') || {}).value || '';
        const recipientNames = ((overlay.querySelector('[data-rx-recipient-names]') || {}).value || '').trim();
        const subject = (overlay.querySelector('[data-rx-subject]') || {}).value || '';
        const body    = (overlay.querySelector('[data-rx-body]')    || {}).value || '';
        const notes   = (overlay.querySelector('[data-rx-notes]')   || {}).value || '';
        const days = Array.from(overlay.querySelectorAll('[data-rx-days] .rx-day-pill.active'))
                          .map(b => b.dataset.day);

        // Cutoff fields. Empty time = no cutoff configured (vendor with
        // flexible deadlines). Days defaults to "1 day before" since
        // that's the common pattern (orders by 4pm for next-day delivery).
        const cutoffTimeRaw = ((overlay.querySelector('[data-rx-cutoff-time]') || {}).value || '').trim();
        const cutoffDaysRaw = ((overlay.querySelector('[data-rx-cutoff-days]') || {}).value || '').trim();
        const cutoffTime = cutoffTimeRaw || null;
        const cutoffDaysBefore = cutoffTime
          ? (cutoffDaysRaw === '' ? 1 : parseInt(cutoffDaysRaw, 10))
          : null;

        // Schedule mode — 'custom' (write to override slice for active
        // location) or 'default' (update vendor defaults + drop the
        // override for this location if it existed).
        const schedMode = ((overlay.querySelector('[data-rx-sched-mode]') || {}).value || 'default');

        // Visibility — selected location pills determine where the
        // vendor is available. All-selected (or none-selected) → null
        // (visible everywhere). Strict subset → array.
        const selectedLocs = Array.from(overlay.querySelectorAll('[data-rx-locs] .rx-loc-availability-pill.active'))
          .map(b => b.dataset.locId)
          .filter(Boolean);
        const visLocations = (selectedLocs.length === 0 || selectedLocs.length === LOCS.length)
          ? null
          : selectedLocs;

        // Build per-location alt_emails. Each restaurant has its own
        // CC/BCC/Other profile, so we save these as a slice keyed by
        // activeLoc and preserve any existing slices for other
        // locations. The TO email is shared across all locations
        // (vendors typically have one orders@ inbox).
        const altEmails = [];
        for (const e of (state.chips.cc  || [])) { const t = String(e).trim(); if (t) altEmails.push({ email: t, kind: 'cc'  }); }
        for (const e of (state.chips.bcc || [])) { const t = String(e).trim(); if (t) altEmails.push({ email: t, kind: 'bcc' }); }
        for (const e of (state.chips.alt || [])) { const t = String(e).trim(); if (t) altEmails.push({ email: t, kind: 'alt' }); }
        const newAltEmailsObj = writeAltEmailsForLocation(v.alt_emails, activeLoc, altEmails);

        // Build location_overrides for schedule fields. When mode is
        // 'custom' we write the active location's slice; when 'default'
        // we strip the slice (so no stale override leftover).
        let newLocOverrides = (v.location_overrides && typeof v.location_overrides === 'object' && !Array.isArray(v.location_overrides))
          ? { ...v.location_overrides }
          : {};
        let payloadDefaultDays = v.delivery_days || [];
        let payloadDefaultCutoffTime = v.cutoff_time || null;
        let payloadDefaultCutoffDays = v.cutoff_days_before;

        if (schedMode === 'custom') {
          // Override slice for active location only. Defaults untouched.
          newLocOverrides[activeLoc] = {
            delivery_days: days,
            cutoff_time: cutoffTime,
            cutoff_days_before: cutoffDaysBefore,
          };
        } else {
          // Default mode: apply edits to vendor-level defaults and drop
          // any prior override for this location (user said "use default").
          payloadDefaultDays = days;
          payloadDefaultCutoffTime = cutoffTime;
          payloadDefaultCutoffDays = cutoffDaysBefore;
          delete newLocOverrides[activeLoc];
        }
        if (Object.keys(newLocOverrides).length === 0) newLocOverrides = null;

        const ccCount = (state.chips.cc || []).length;
        const bccCount = (state.chips.bcc || []).length;
        dinfo('[ordering] saveVendor about to persist', {
          ccCount, bccCount, altCount: (state.chips.alt || []).length,
          location: activeLoc,
          schedMode,
          alt_emails: newAltEmailsObj,
          locations: visLocations,
        });

        const payload = {
          name: id.name,
          email: email.trim() || null,
          alt_emails: newAltEmailsObj,
          pinned: id.pinned,
          delivery_days: payloadDefaultDays,
          cutoff_time: payloadDefaultCutoffTime,
          cutoff_days_before: payloadDefaultCutoffDays,
          locations: visLocations,
          location_overrides: newLocOverrides,
          subject_template: subject.trim() || null,
          body_template:    body.trim()    || null,
          notes:            notes.trim()   || null,
          recipient_names:  recipientNames || null,
        };

        // v18.27 — image-disappearing bug fix. Previously this was always
        // `image_url: id.photoUrl || null` which wiped the DB value to
        // NULL any time id.photoUrl was empty (e.g., after the fallback
        // SELECT path that didn't load image_url, OR when the user just
        // wanted to update an email field without touching the image).
        //
        // New rule: only include image_url in the UPDATE payload when
        // the user actually has a photo in the editor state. Sending
        // nothing leaves the existing DB value untouched. There's no
        // "remove image" UI today; if one is added later, it should
        // explicitly write `image_url: null` via a dedicated path.
        //
        // Same defense for avatar_hue — don't wipe it if id.avatarHue
        // is undefined/null (the hue picker may not have initialized).
        // Also skip if loaded via the minimal fallback that didn't read
        // image_url — we explicitly don't know its true value there.
        const loadedViaMinimalFallback = v && v._image_url_unknown;
        if (id.photoUrl && !loadedViaMinimalFallback) payload.image_url = id.photoUrl;
        if (id.avatarHue != null && id.avatarHue !== 'auto' && !loadedViaMinimalFallback) payload.avatar_hue = id.avatarHue;

        const optionalCols = ['image_url', 'avatar_hue', 'pinned', 'alt_emails', 'cutoff_time', 'cutoff_days_before', 'locations', 'location_overrides', 'recipient_names'];
        const stripOptionalCols = (p) => {
          const o = { ...p };
          for (const k of optionalCols) delete o[k];
          return o;
        };
        const isMissingColumnError = (err) => {
          const msg = (err && (err.message || err.toString())) || '';
          return /column|schema|does not exist|could not find/i.test(msg);
        };
        let altEmailsStripped = false;
        let firstError = null;  // v18.28 — preserved for honest toast on retry

        try {
          if (isNew) {
            let res = await NX.sb.from('order_vendors').insert(payload).select('*').single();
            if (res.error && isMissingColumnError(res.error)) {
              dwarn('[ordering] saveVendor insert: retry without new columns', res.error);
              firstError = res.error;
              altEmailsStripped = true;
              res = await NX.sb.from('order_vendors').insert(stripOptionalCols(payload)).select('*').single();
            }
            if (res.error) throw res.error;
            vendors.push(res.data);
            vendors.sort((a, b) => a.name.localeCompare(b.name));
            if (vendors._itemCounts) vendors._itemCounts[res.data.id] = 0;
          } else {
            const vendorId = v.id;
            if (!vendorId) throw new Error('Missing vendor.id — cannot update');
            // .select('*') so we get the saved row back; without it Supabase
            // doesn't return data, and we can't verify alt_emails persisted.
            let res = await NX.sb.from('order_vendors').update(payload).eq('id', vendorId).select('*').single();
            if (res.error && isMissingColumnError(res.error)) {
              dwarn('[ordering] saveVendor update: retry without new columns', res.error);
              firstError = res.error;
              altEmailsStripped = true;
              res = await NX.sb.from('order_vendors').update(stripOptionalCols(payload)).eq('id', vendorId).select('*').single();
            }
            if (res.error) throw res.error;
            const cached = vendors.find(x => x.id === vendorId);
            if (cached) Object.assign(cached, res.data || payload);
            // Verify what came back. If we sent CCs but the saved row has
            // no alt_emails, something's wrong — surface it.
            if (altEmails.length && (!res.data || res.data.alt_emails == null) && !altEmailsStripped) {
              dwarn('[ordering] saveVendor: sent', altEmails.length, 'alt_emails but server returned null', res.data);
            }
          }
          if (altEmailsStripped && (ccCount || bccCount || (state.chips.alt || []).length)) {
            // The first UPDATE failed with a column-related error and the
            // retry path stripped every optional column to get a partial
            // save through. CC/BCC/Other lists (and image_url, avatar_hue,
            // recipient_names, default_fill_mode) were silently dropped.
            // v18.28 — surface the ACTUAL Postgres error so debugging is
            // possible. The old toast hardcoded "alt_emails column missing"
            // which was misleading when the real missing column was
            // recipient_names or default_fill_mode.
            const actualMsg = (firstError && (firstError.message || firstError.toString())) || 'unknown';
            if (NX.toast) NX.toast(`Saved name + email, but optional fields were dropped: ${actualMsg}`, 'error', 6000);
          } else if (NX.toast) {
            const parts = [];
            if (ccCount) parts.push(`${ccCount} CC`);
            if (bccCount) parts.push(`${bccCount} BCC`);
            const suffix = parts.length ? ` (${parts.join(', ')})` : '';
            NX.toast('Saved' + suffix, 'info', 1400);
          }
          renderVendors();
          return true;     // engine closes the overlay
        } catch (err) {
          console.error('[ordering] saveVendor:', err);
          if (NX.toast) NX.toast('Failed to save: ' + (err.message || ''), 'error', 3000);
          return false;    // keep open so user can retry
        }
      },
    });
  }

  function renderItemsAreaOnly() {
    // Re-render only the items list portion. Used by the catalog editor.
    const list = document.getElementById('catItemsList');
    if (list) {
      list.innerHTML = renderItemsList();
      wireItemListHandlers();
      return;
    }
    // Fallback: full catalog editor re-render so toolbar/state stays correct
    if (catalogState && catalogState.overlay) renderCatalog();
  }

  function renderItemsList() {
    if (!catalogState) return '';
    const allItems = catalogState.items;
    const searchQ = (catalogState.searchQuery || '').trim().toLowerCase();
    const parFilter = catalogState.parFilter || 'all';
    const pending = catalogState.pendingSections || [];
    let html = '';

    // Apply search filter (item name + sku). Sections that end up with
    // 0 matching items are hidden from the list, but pending empty
    // sections are always shown (so you can still find them while filtering).
    //
    // v18.28 Phase 2 — par-state filter chained AFTER search. When
    // parFilter='missing-par', drop any item with a non-zero
    // default_par_qty. Lets the operator audit "what still needs
    // setup" while a search is in effect (e.g. search "trash" +
    // filter missing-par to see un-set trash items).
    const items = (searchQ || parFilter !== 'all')
      ? allItems.filter(i => {
          if (searchQ) {
            const name  = (i.item_name  || '').toLowerCase();
            const house = (i.house_name || '').toLowerCase();
            const sku   = (i.vendor_sku || '').toLowerCase();
            if (name.indexOf(searchQ) === -1
                && house.indexOf(searchQ) === -1
                && sku.indexOf(searchQ) === -1) return false;
          }
          if (parFilter === 'missing-par') {
            const par = i.default_par_qty;
            if (par != null && Number(par) > 0) return false;
          }
          return true;
        })
      : allItems;

    // "New item" form rendered at the top when adding
    if (catalogState.editingItemId === 'new') {
      const defaultSec = catalogState._newItemDefaultSection || '';
      html += renderItemForm({
        id: '__new', item_name: '', vendor_sku: '',
        section: defaultSec, unit: 'ea',
        default_par_qty: null, pars_by_day: {}, note: ''
      }, true);
    }

    if (!allItems.length && !pending.length && catalogState.editingItemId !== 'new') {
      html += `
        <div class="ved-items-empty ved-items-empty-cta">
          <div class="ved-items-empty-icon">${listIcon()}</div>
          <div class="ved-items-empty-title">No items yet</div>
          <div class="ved-items-empty-msg">Get started fast — import a list, or add items one by one.</div>
          <div class="ved-items-empty-actions">
            <button type="button" class="ved-items-empty-btn ved-items-empty-btn-primary" id="vedEmptyImport">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>Upload spreadsheet</span>
            </button>
            <button type="button" class="ved-items-empty-btn ved-items-empty-btn-secondary" id="vedEmptyDownload">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download blank template</span>
            </button>
            <button type="button" class="ved-items-empty-btn ved-items-empty-btn-tertiary" id="vedEmptyManual">
              <span>+ Add first item manually</span>
            </button>
          </div>
        </div>
      `;
      return html;
    }

    // Group items by section
    const groups = new Map();          // section → items[]
    const sectionMinSort = new Map();  // section → smallest sort_order
    for (const it of items) {
      const sec = it.section || '';
      if (!groups.has(sec)) groups.set(sec, []);
      groups.get(sec).push(it);
      const cur = sectionMinSort.get(sec);
      const mySort = (it.sort_order != null) ? it.sort_order : Infinity;
      if (cur == null || mySort < cur) sectionMinSort.set(sec, mySort);
    }

    // Pending (empty) sections — make sure they always appear in the list.
    for (const p of pending) {
      if (!groups.has(p)) groups.set(p, []);
    }

    // Sort sections:
    //   1. PENDING (newly created, empty) sections come FIRST, in the order
    //      they were added (most recent first — pendingSections[0]).
    //   2. Then sections with items, ordered by min(sort_order).
    //   3. Uncategorized ('') always last.
    const pendingIdx = (s) => pending.indexOf(s);    // -1 if not pending
    const sections = Array.from(groups.keys()).sort((a, b) => {
      const aP = pendingIdx(a), bP = pendingIdx(b);
      const aIsPending = aP !== -1;
      const bIsPending = bP !== -1;
      if (aIsPending && !bIsPending) return -1;
      if (bIsPending && !aIsPending) return 1;
      if (aIsPending && bIsPending) return aP - bP;     // earlier in pending array = first
      if (a === '' && b !== '') return 1;
      if (b === '' && a !== '') return -1;
      const am = sectionMinSort.get(a);
      const bm = sectionMinSort.get(b);
      if (am !== bm) return (am ?? Infinity) - (bm ?? Infinity);
      return a.localeCompare(b);
    });

    // Sort items within each section by sort_order ascending.
    for (const sec of sections) {
      groups.get(sec).sort((a, b) => {
        const ao = (a.sort_order != null) ? a.sort_order : Infinity;
        const bo = (b.sort_order != null) ? b.sort_order : Infinity;
        return ao - bo;
      });
    }

    for (const sec of sections) {
      html += renderSectionGroup(sec, groups.get(sec));
    }

    if (searchQ && !items.length) {
      html += `
        <div class="ved-items-empty">
          <div class="ved-items-empty-title" style="text-transform:none">No matches for “${esc(searchQ)}”</div>
        </div>
      `;
    }

    return html;
  }

  function renderSectionGroup(sec, items) {
    const isUncat = sec === '';
    const isRenaming = catalogState.renamingSection === sec;
    const isCollapsed = catalogState.collapsedSections.has(sec);
    // v18.28 Phase 2 — bulk-apply UI state. When this section's name
    // matches catalogState.bulkSection, an inline form below the
    // header lets the user set par + unit for ALL items in this
    // section in one shot. Useful e.g. "set every Cleaning Supplies
    // item to par 2 cs" without tapping each row.
    const isBulkActive = catalogState.bulkSection === sec;
    const headerInner = isRenaming
      ? `
        <input type="text" class="ved-section-rename-input" value="${esc(sec)}" autocomplete="off" spellcheck="false" placeholder="Section name">
        <button class="ved-section-rename-save" data-old="${esc(sec)}">Save</button>
        <button class="ved-section-rename-cancel">Cancel</button>
      `
      : `
        <span class="ved-section-name${isUncat ? ' is-uncat' : ''}" data-section="${esc(sec)}" role="button" tabindex="0">
          ${esc(sec || 'Uncategorized')}
        </span>
        <span class="ved-section-count">${items.length}</span>
        <div class="ved-section-move-stack" role="group" aria-label="Reorder this section">
          <button type="button" class="ved-section-move-btn" data-section-move="up" data-section="${esc(sec)}" aria-label="Move section up">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button type="button" class="ved-section-move-btn" data-section-move="down" data-section="${esc(sec)}" aria-label="Move section down">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
        ${items.length > 0 ? `
          <button class="ved-section-bulk-btn${isBulkActive ? ' is-active' : ''}" data-section-bulk="${esc(sec)}" aria-label="Bulk apply par + unit to all items in this section" title="Bulk apply to all ${items.length} items">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
        ` : ''}
        ${!isUncat ? `
          <button class="ved-section-rename-btn" data-section="${esc(sec)}" aria-label="Rename section ${esc(sec)}">${editIcon()}</button>
          <button class="ved-section-delete-btn" data-section-delete="${esc(sec)}" aria-label="Delete section ${esc(sec)}" title="Delete section + all items in it">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        ` : ''}
        <button class="ved-section-collapse" data-section="${esc(sec)}" type="button" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} section ${esc(sec || 'uncategorized')}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      `;

    let inner = `<div class="ved-section-row" data-section="${esc(sec)}">${headerInner}</div>`;

    // v18.28 Phase 2 — Bulk apply inline form (shows under the header
    // when isBulkActive). Two inputs (par + unit), an "Apply to N
    // items" button, a Cancel button. Blank fields are no-ops — only
    // non-empty fields get applied, so you can update par only,
    // unit only, or both.
    if (isBulkActive && !isRenaming) {
      inner += `
        <div class="ved-bulk-panel" data-section="${esc(sec)}">
          <div class="ved-bulk-panel-title">
            Bulk apply to <strong>${items.length} item${items.length === 1 ? '' : 's'}</strong> in <em>${esc(sec || 'Uncategorized')}</em>
          </div>
          <div class="ved-bulk-panel-row">
            <label class="ved-bulk-field">
              <span class="ved-bulk-label">Par</span>
              <input type="number" inputmode="numeric" min="0" step="1"
                     class="ved-bulk-input ved-bulk-par"
                     placeholder="(leave blank to skip)"
                     data-section="${esc(sec)}">
            </label>
            <label class="ved-bulk-field">
              <span class="ved-bulk-label">Unit</span>
              <input type="text" class="ved-bulk-input ved-bulk-unit"
                     placeholder="(leave blank to skip)"
                     maxlength="8" autocomplete="off" spellcheck="false"
                     data-section="${esc(sec)}">
            </label>
          </div>
          <div class="ved-bulk-panel-actions">
            <button type="button" class="ved-bulk-cancel" data-section="${esc(sec)}">Cancel</button>
            <button type="button" class="ved-bulk-apply" data-section="${esc(sec)}">Apply</button>
          </div>
        </div>
      `;
    }

    // Items wrapper — items live inside the section card. When the
    // section is collapsed, this wrapper is hidden via CSS but the
    // items remain in the DOM so the snapshot for drag-reorder still
    // includes them (they just have zero height + are hit-tested out).
    let itemsHTML = '';

    if (items.length === 0 && !isUncat) {
      itemsHTML += `
        <div class="ved-section-empty">
          <div class="ved-section-empty-text">No items in this section yet.</div>
          <div class="ved-section-empty-actions">
            <button class="ved-section-empty-add" type="button" data-section="${esc(sec)}">${plusIcon()}<span>Add to ${esc(sec)}</span></button>
            <button class="ved-section-empty-remove" type="button" data-section="${esc(sec)}" aria-label="Remove empty section">×</button>
          </div>
        </div>
      `;
    }

    for (const it of items) {
      if (catalogState.editingItemId === it.id) {
        itemsHTML += renderItemForm(it, false);
      } else {
        itemsHTML += renderItemRow(it);
      }
    }

    inner += `<div class="ved-section-items">${itemsHTML}</div>`;

    return `<div class="ved-section-block${isCollapsed ? ' is-collapsed' : ''}" data-section="${esc(sec)}">${inner}</div>`;
  }

  function renderItemRow(item) {
    // Display name precedence: team's name when set, else vendor's name.
    // Vendor name shows in the meta line as an alias when both exist —
    // mirrors the order entry display so the catalog editor reads the
    // same way as where the team actually places orders.
    const houseName  = (item.house_name || '').trim();
    const vendorName = (item.item_name  || '').trim();
    const primary    = houseName || vendorName;
    const showVendorAlias = houseName && vendorName && houseName !== vendorName;

    // v18.28 (catalog revamp) — meta now ONLY carries vendor alias +
    // SKU. The par + unit USED to live in meta as static text
    // ("par 2 ct"); they're now inline editable controls on the right
    // of the row (par stepper + unit input — mirrors the ordering
    // screen's qty pill + unit input). Removing them from meta drops
    // the duplication and gives the meta line breathing room.
    const meta = [];
    if (showVendorAlias) meta.push(`<span class="ved-meta-alias">${esc(vendorName)}</span>`);
    if (item.vendor_sku) meta.push(`<span class="ved-meta-sku">${esc(item.vendor_sku)}</span>`);

    const parVal  = (item.default_par_qty != null && item.default_par_qty !== '') ? item.default_par_qty : 0;
    const unitVal = item.unit || 'ea';
    const hasPar  = Number(parVal) > 0;

    return `
      <div class="ved-item-row${hasPar ? ' has-par' : ''}" data-item-id="${esc(item.id)}">
        <!-- Name area is the tap target that opens the full edit form -->
        <button class="ved-item-tap" data-item-id="${esc(item.id)}" type="button">
          <div class="ved-item-main">
            <div class="ved-item-name">${esc(primary)}</div>
            ${meta.length ? `<div class="ved-item-meta">${meta.join('<span class="ved-meta-sep">·</span>')}</div>` : ''}
          </div>
        </button>

        <!-- v18.29 — par stepper uses the EXACT same component as
             ordering's qty pill (.ord-qty + .ord-qty-btn + .ord-qty-input).
             Identical visual — same pill shape, same dimensions, same
             behavior. The .ved-par-* classes are additional hooks so
             handlers wire to the catalog-specific save flow, not the
             ordering one. The gold-fill hero treatment from ordering
             is scoped to .ord-item-row.has-qty, so it does NOT apply
             here (catalog row is .ved-item-row). -->
        <div class="ord-qty" role="group" aria-label="Default par">
          <button type="button" class="ord-qty-btn ved-par-btn" data-par-step="-1" data-item-id="${esc(item.id)}" aria-label="Decrease par">−</button>
          <input type="number" inputmode="numeric" min="0" step="1"
                 class="ord-qty-input ved-par-input" data-item-id="${esc(item.id)}"
                 value="${esc(String(parVal))}" aria-label="Default par">
          <button type="button" class="ord-qty-btn ved-par-btn" data-par-step="1" data-item-id="${esc(item.id)}" aria-label="Increase par">+</button>
        </div>

        <!-- v18.29 — Unit input uses ordering's .ord-item-unit-input
             visual. Same input the chef uses on the order entry screen
             — typing here changes the catalog default, which becomes
             the per-line default in every subsequent order for this
             vendor. (Per-line overrides on the ordering screen are
             session-only and don't write back to catalog.) -->
        <div class="ord-item-unit ved-unit-cell">
          <input type="text" class="ord-item-unit-input ved-unit-input" data-item-id="${esc(item.id)}"
                 value="${esc(unitVal)}" placeholder="ea" autocomplete="off"
                 spellcheck="false" maxlength="8" aria-label="Unit">
        </div>

        <!-- Combined move column. Up/down kept for single-tap reorder;
             tap row name to open the edit form for advanced fields
             (section change, day-of-week pars, notes, rename). -->
        <div class="ved-item-move-stack" role="group" aria-label="Reorder this item">
          <button type="button" class="ved-item-move-btn" data-row-move="up" data-item-id="${esc(item.id)}" aria-label="Move up">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button type="button" class="ved-item-move-btn" data-row-move="down" data-item-id="${esc(item.id)}" aria-label="Move down">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderItemForm(item, isNew) {
    const days = item.pars_by_day || {};
    // Build datalist of known section names so the user can pick an
    // existing section (avoiding typo splits like "Dairy" vs "Diary")
    // while still being free to type a brand-new one.
    const knownSections = new Set();
    if (catalogState && Array.isArray(catalogState.items)) {
      catalogState.items.forEach(i => { if (i.section) knownSections.add(i.section); });
    }
    if (catalogState && Array.isArray(catalogState.pendingSections)) {
      catalogState.pendingSections.forEach(s => knownSections.add(s));
    }
    const datalistId = 'sectionList-' + (isNew ? 'new' : esc(item.id));
    const datalistHTML = knownSections.size ? `
      <datalist id="${datalistId}">
        ${Array.from(knownSections).sort().map(s => `<option value="${esc(s)}">`).join('')}
      </datalist>
    ` : '';
    return `
      <div class="ord-vitem-row ord-vitem-editing" data-item-id="${esc(item.id)}">
        <div class="ord-form-field">
          <label class="ord-form-label">Item name <span class="ord-form-label-hint">(vendor's name — what they see in email)</span></label>
          <input type="text" class="ord-form-input ied-name" value="${esc(item.item_name || '')}" placeholder="e.g. FOIL HD 18&quot; ROLL" autocomplete="off">
        </div>
        <div class="ord-form-field">
          <label class="ord-form-label">Team name <span class="ord-form-label-hint">(optional — what your team calls it)</span></label>
          <input type="text" class="ord-form-input ied-house" value="${esc(item.house_name || '')}" placeholder="e.g. Big Foil" autocomplete="off">
        </div>
        <div class="ord-form-row-2">
          <div class="ord-form-field">
            <label class="ord-form-label">SKU (optional)</label>
            <input type="text" class="ord-form-input ied-sku" value="${esc(item.vendor_sku || '')}" placeholder="vendor's code" autocomplete="off">
          </div>
          <div class="ord-form-field">
            <label class="ord-form-label">Section</label>
            <input type="text" class="ord-form-input ied-section" value="${esc(item.section || '')}" placeholder="e.g. Dairy" autocomplete="off" list="${datalistId}">
            ${datalistHTML}
          </div>
        </div>
        <div class="ord-form-row-2">
          <div class="ord-form-field">
            <label class="ord-form-label">Unit</label>
            <input type="text" class="ord-form-input ied-unit" value="${esc(item.unit || 'ea')}" placeholder="ea / cs / lb / gal" autocomplete="off">
          </div>
          <div class="ord-form-field">
            <label class="ord-form-label">Default par</label>
            <input type="number" class="ord-form-input ied-par" value="${item.default_par_qty != null ? item.default_par_qty : ''}" placeholder="0" inputmode="numeric" min="0" step="1">
          </div>
        </div>
        <div class="ord-form-field">
          <label class="ord-form-label">Day-of-week pars (optional, overrides default)</label>
          <div class="ord-day-pars">
            ${WEEKDAY_KEYS.map((k, i) => `
              <label class="ord-day-par">
                <span>${WEEKDAY_LBL[i]}</span>
                <input type="number" class="ied-day" data-day="${k}" value="${days[k] != null ? days[k] : ''}" placeholder="—" inputmode="numeric" min="0" step="1">
              </label>
            `).join('')}
          </div>
        </div>
        <div class="ord-form-field">
          <label class="ord-form-label">Note (optional)</label>
          <input type="text" class="ord-form-input ied-note" value="${esc(item.note || '')}" placeholder="e.g. 'up to 10' or 'bag'" autocomplete="off">
        </div>
        ${!isNew ? `
          <div class="ord-vitem-move-row" role="group" aria-label="Reorder this item">
            <button type="button" class="ord-vitem-move-btn" data-move="up" data-item-id="${esc(item.id)}" aria-label="Move up one position">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
              Move up
            </button>
            <button type="button" class="ord-vitem-move-btn" data-move="down" data-item-id="${esc(item.id)}" aria-label="Move down one position">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
              Move down
            </button>
          </div>
        ` : ''}
        <div class="ord-vitem-edit-actions">
          ${!isNew ? `<button class="ord-vitem-delete-btn" data-item-id="${esc(item.id)}">${trashIcon()} Delete</button>` : '<div></div>'}
          <button class="ord-vitem-cancel-btn">Cancel</button>
          <button class="ord-vitem-save-btn" data-item-id="${esc(item.id)}">Save item</button>
        </div>
      </div>
    `;
  }

  function wireItemListHandlers() {
    const list = document.getElementById('catItemsList');
    if (!list) return;

    // Tap item body → open edit form. The drag handle is a sibling
    // of .ved-item-tap, so its events don't reach this listener.
    list.querySelectorAll('.ved-item-tap').forEach(btn => {
      btn.addEventListener('click', () => {
        catalogState.editingItemId = btn.dataset.itemId;
        renderItemsAreaOnly();
        setTimeout(() => {
          const form = list.querySelector('.ord-vitem-editing');
          if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      });
    });

    // Cancel
    list.querySelectorAll('.ord-vitem-cancel-btn').forEach(b => {
      b.addEventListener('click', () => {
        catalogState.editingItemId = null;
        renderItemsAreaOnly();
      });
    });
    // Save
    list.querySelectorAll('.ord-vitem-save-btn').forEach(b => {
      b.addEventListener('click', () => saveItemFromForm(b.dataset.itemId));
    });
    // Delete
    list.querySelectorAll('.ord-vitem-delete-btn').forEach(b => {
      b.addEventListener('click', () => deleteItem(b.dataset.itemId));
    });

    // ─── Move up / Move down ───────────────────────────────────────
    // Explicit reorder fallback for users who can't / don't want to
    // long-press drag. Each click swaps the item with its neighbor in
    // the same section. If the item is already at the top/bottom of
    // its section, the click is a no-op (we shake the button briefly).
    list.querySelectorAll('.ord-vitem-move-btn[data-move]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.dataset.itemId;
        const dir = btn.dataset.move; // 'up' or 'down'
        await moveItemByOne(itemId, dir);
      });
    });

    // ─── Section collapse / expand ─────────────────────────────────
    // Tap section name OR chevron → toggle collapse. Rename now lives
    // on the pencil button only (clearer separation of intents).
    list.querySelectorAll('.ved-section-name[data-section]').forEach(el => {
      el.addEventListener('click', () => toggleCollapseSection(el.dataset.section));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleCollapseSection(el.dataset.section);
        }
      });
    });
    list.querySelectorAll('.ved-section-collapse').forEach(btn => {
      btn.addEventListener('click', () => toggleCollapseSection(btn.dataset.section));
    });

    // ─── Item move (up/down arrows on each row) ───────────────────────
    // Always-visible reorder controls. Stop propagation so these don't
    // also fire the ved-item-tap edit handler.
    list.querySelectorAll('.ved-item-move-btn[data-row-move]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const dir = btn.dataset.rowMove;
        const itemId = btn.dataset.itemId;
        if (itemId && (dir === 'up' || dir === 'down')) moveItemByOne(itemId, dir);
      });
    });

    // ─── v18.28 — Inline par stepper (+/-) ─────────────────────────────
    // Updates default_par_qty without opening the full edit form.
    // Stops propagation so the row-tap edit handler doesn't fire.
    list.querySelectorAll('.ved-par-btn[data-par-step]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const itemId = btn.dataset.itemId;
        const delta = parseInt(btn.dataset.parStep, 10);
        if (!itemId || isNaN(delta)) return;
        const item = catalogState.items.find(i => i.id === itemId);
        if (!item) return;
        const current = parseInt(item.default_par_qty, 10) || 0;
        const next = Math.max(0, current + delta);
        item.default_par_qty = next;
        // Update the input visually + the row's has-par class
        const row = btn.closest('.ved-item-row');
        if (row) {
          const inp = row.querySelector('.ved-par-input');
          if (inp) inp.value = String(next);
          row.classList.toggle('has-par', next > 0);
        }
        scheduleInlineItemSave(itemId, { default_par_qty: next });
      });
    });

    // ─── v18.28 — Inline par input (direct typing) ─────────────────────
    list.querySelectorAll('.ved-par-input').forEach(inp => {
      inp.addEventListener('click', e => e.stopPropagation());
      inp.addEventListener('focus', e => e.target.select());
      inp.addEventListener('input', (e) => {
        e.stopPropagation();
        const itemId = inp.dataset.itemId;
        const item = catalogState.items.find(i => i.id === itemId);
        if (!item) return;
        const raw = inp.value.trim();
        const next = raw === '' ? 0 : Math.max(0, parseInt(raw, 10) || 0);
        item.default_par_qty = next;
        const row = inp.closest('.ved-item-row');
        if (row) row.classList.toggle('has-par', next > 0);
        scheduleInlineItemSave(itemId, { default_par_qty: next });
      });
    });

    // ─── v18.28 — Inline unit input (cs/gal/ea button) ─────────────────
    // The cs/gal/ea editor Orion specifically asked for. Same visual
    // language as the ordering screen's per-line unit input, but here
    // it edits the CATALOG default unit so every future order from
    // this item pre-fills with the right unit.
    list.querySelectorAll('.ved-unit-input').forEach(inp => {
      inp.addEventListener('click', e => e.stopPropagation());
      inp.addEventListener('focus', e => e.target.select());
      inp.addEventListener('input', (e) => {
        e.stopPropagation();
        const itemId = inp.dataset.itemId;
        const item = catalogState.items.find(i => i.id === itemId);
        if (!item) return;
        // Normalize on input but don't reformat (let user type freely)
        const value = inp.value.trim() || 'ea';
        item.unit = value;
        scheduleInlineItemSave(itemId, { unit: value });
      });
      inp.addEventListener('blur', (e) => {
        // Empty → fall back to 'ea'
        if (!inp.value.trim()) inp.value = 'ea';
      });
    });

    // ─── Section move (up/down arrows in section header) ──────────────
    list.querySelectorAll('.ved-section-move-btn[data-section-move]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const dir = btn.dataset.sectionMove;
        const sec = btn.dataset.section;
        if (sec != null && (dir === 'up' || dir === 'down')) moveSectionByOne(sec, dir);
      });
    });

    // ─── Section rename ────────────────────────────────────────────
    list.querySelectorAll('.ved-section-rename-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Make sure section is expanded so the input is visible
        catalogState.collapsedSections.delete(btn.dataset.section);
        catalogState.renamingSection = btn.dataset.section;
        renderItemsAreaOnly();
        setTimeout(() => {
          const inp = list.querySelector('.ved-section-rename-input');
          if (inp) { inp.focus(); inp.select(); }
        }, 30);
      });
    });
    list.querySelectorAll('.ved-section-rename-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        catalogState.renamingSection = null;
        renderItemsAreaOnly();
      });
    });
    list.querySelectorAll('.ved-section-rename-save').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = list.querySelector('.ved-section-rename-input');
        if (!inp) return;
        const next = inp.value.trim();
        renameSection(btn.dataset.old, next);
      });
    });
    list.querySelectorAll('.ved-section-rename-input').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = list.querySelector('.ved-section-rename-save');
          if (btn) renameSection(btn.dataset.old, inp.value.trim());
        } else if (e.key === 'Escape') {
          catalogState.renamingSection = null;
          renderItemsAreaOnly();
        }
      });
    });

    // Empty-section "Add to <section>" — opens new-item form pre-filled
    list.querySelectorAll('.ved-section-empty-add').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!catalogState) return;
        catalogState.editingItemId = 'new';
        catalogState._newItemDefaultSection = btn.dataset.section || '';
        renderItemsAreaOnly();
        setTimeout(() => {
          const form = list.querySelector('.ord-vitem-editing');
          if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      });
    });

    // Empty-section "×" — drops the pending-section placeholder
    list.querySelectorAll('.ved-section-empty-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!catalogState) return;
        const sec = btn.dataset.section || '';
        catalogState.pendingSections = (catalogState.pendingSections || []).filter(s => s !== sec);
        renderItemsAreaOnly();
      });
    });

    // Section delete (populated sections) — nukes section + all items.
    // Two-step confirm inside deleteSection() guards the destructive
    // path. FK-safe: order_lines pointing at deleted items get
    // detached first so order history stays readable.
    list.querySelectorAll('.ved-section-delete-btn[data-section-delete]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sec = btn.dataset.sectionDelete || '';
        deleteSection(sec);
      });
    });

    // ─── v18.28 Phase 2 — Section bulk-apply toggle ───────────────────
    // Tap the brush icon in the section header to reveal an inline
    // form for setting par + unit across every item in the section.
    // Toggling the same section closes the form. Switching to a
    // different section closes the prior one (only one open at a
    // time to keep the surface calm).
    list.querySelectorAll('.ved-section-bulk-btn[data-section-bulk]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sec = btn.dataset.sectionBulk;
        if (catalogState.bulkSection === sec) {
          catalogState.bulkSection = null;
        } else {
          catalogState.bulkSection = sec;
          // Ensure the section is expanded so the form is visible
          catalogState.collapsedSections.delete(sec);
        }
        renderItemsAreaOnly();
        // Focus the par input for immediate typing
        if (catalogState.bulkSection) {
          setTimeout(() => {
            const inp = list.querySelector(`.ved-bulk-par[data-section="${cssEsc(sec)}"]`);
            if (inp) inp.focus();
          }, 30);
        }
      });
    });

    list.querySelectorAll('.ved-bulk-cancel[data-section]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        catalogState.bulkSection = null;
        renderItemsAreaOnly();
      });
    });

    list.querySelectorAll('.ved-bulk-apply[data-section]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sec = btn.dataset.section;
        const panel = list.querySelector(`.ved-bulk-panel[data-section="${cssEsc(sec)}"]`);
        if (!panel) return;
        const parInp  = panel.querySelector('.ved-bulk-par');
        const unitInp = panel.querySelector('.ved-bulk-unit');
        const parRaw  = (parInp  && parInp.value  || '').trim();
        const unitRaw = (unitInp && unitInp.value || '').trim();
        applyBulkSection(sec, parRaw, unitRaw);
      });
    });

    // ─── Drag handlers (long-press to activate, single delegated listener) ──
    wireDragHandlers(list);
  }

  /* CSS escape for use in querySelector attribute selectors. The
     section names can contain spaces, ampersands, and other chars
     that break a bare selector. Falls back to the global function
     when available, else a minimal manual escape. */
  function cssEsc(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/["'\\\s&]/g, '\\$&');
  }

  /* v18.28 Phase 2 — Apply par and/or unit to every item in a section.
     Either field can be blank (treated as "skip"); we only update
     fields the user actually entered. UI shows toast on success +
     refreshes the rendered list so the new values + has-par treatments
     reflect immediately.

     Implementation notes:
       • Local state updates first (so UI is responsive)
       • Single batched UPDATE to Supabase using .in(...) instead of
         N row-by-row updates. Atomic from the server's perspective —
         either all rows update or none.
       • No "undo" UX in v1; the user can re-bulk-apply with different
         values to revert. */
  async function applyBulkSection(sec, parRaw, unitRaw) {
    if (!catalogState || !NX.sb) return;
    const sectionName = sec || '';
    const targetItems = catalogState.items.filter(i => (i.section || '') === sectionName);
    if (!targetItems.length) {
      if (NX.toast) NX.toast('No items in this section', 'warn');
      return;
    }
    // Validate inputs
    let parVal = null;
    let unitVal = null;
    if (parRaw !== '') {
      const n = parseInt(parRaw, 10);
      if (isNaN(n) || n < 0) {
        if (NX.toast) NX.toast('Par must be 0 or a positive number', 'warn');
        return;
      }
      parVal = n;
    }
    if (unitRaw !== '') {
      unitVal = unitRaw.toLowerCase().slice(0, 8);
    }
    if (parVal == null && unitVal == null) {
      if (NX.toast) NX.toast('Enter a par or unit to apply', 'warn');
      return;
    }
    // Build patch + apply locally
    const patch = {};
    if (parVal  != null) patch.default_par_qty = parVal;
    if (unitVal != null) patch.unit            = unitVal;
    const itemIds = targetItems.map(i => i.id);
    targetItems.forEach(i => {
      if (parVal  != null) i.default_par_qty = parVal;
      if (unitVal != null) i.unit            = unitVal;
    });
    // Re-render immediately so the changes show before the network call
    catalogState.bulkSection = null;
    renderItemsAreaOnly();
    // Persist
    try {
      const { error } = await NX.sb.from('order_guide_items')
        .update(patch).in('id', itemIds);
      if (error) throw error;
      const parts = [];
      if (parVal  != null) parts.push(`par ${parVal}`);
      if (unitVal != null) parts.push(`unit "${unitVal}"`);
      if (NX.toast) NX.toast(
        `Applied ${parts.join(' + ')} to ${itemIds.length} item${itemIds.length === 1 ? '' : 's'}`,
        'success',
        2000
      );
    } catch (err) {
      console.error('[catalog] bulk apply failed:', err);
      if (NX.toast) NX.toast(
        `Bulk apply failed: ${err.message || 'unknown'}`,
        'error',
        3500
      );
      // Reload from server to recover from inconsistent local state
      try {
        catalogState.items = await loadVendorCatalog(catalogState.vendor.id);
        renderItemsAreaOnly();
      } catch {}
    }
  }

  /* ── Section rename: bulk-update all items in the old section ────
   * No-op if the new name matches the old, equals empty, or already
   * exists (sections can't be merged blindly — that would mash sort_orders
   * together; require an explicit second drag if they want to merge). */
  async function renameSection(oldName, newName) {
    if (!catalogState || !catalogState.vendor || !NX.sb) return;
    const old = (oldName || '').trim();
    const next = (newName || '').trim();
    if (!next) {
      if (NX.toast) NX.toast('Section name cannot be empty', 'warn');
      return;
    }
    if (next === old) {
      catalogState.renamingSection = null;
      renderItemsAreaOnly();
      return;
    }
    // Reject merging into an existing section in v1 — user intent unclear
    const existsAlready = catalogState.items.some(i => (i.section || '') === next && (i.section || '') !== old);
    if (existsAlready) {
      if (NX.toast) NX.toast('A section already has that name — merge by dragging items instead', 'warn', 2400);
      return;
    }
    // Optimistic in-memory update
    const affected = catalogState.items.filter(i => (i.section || '') === old);
    affected.forEach(i => { i.section = next; });
    catalogState.renamingSection = null;
    renderItemsAreaOnly();
    // Persist — one update per row. Tolerate per-row failures.
    const { error } = await NX.sb
      .from('order_guide_items')
      .update({ section: next })
      .eq('vendor_id', catalogState.vendor.id)
      .eq('section', old);
    if (error) {
      console.error('[ordering] renameSection:', error);
      if (NX.toast) NX.toast('Could not rename section: ' + (error.message || ''), 'error');
      // roll back in-memory
      affected.forEach(i => { i.section = old; });
      renderItemsAreaOnly();
      return;
    }
    if (NX.toast) NX.toast(`Renamed “${old || 'Uncategorized'}” → “${next}”`, 'info', 1400);
  }

  /* ─────────────────────────────────────────────────────────────────────
   * Long-press → "Move to section" picker (board.js pattern).
   *
   * The previous implementation tried to do real drag-and-drop on touch:
   * long-press to activate, then track pointermove to swap rows, with
   * auto-scroll near container edges. It worked in theory but was
   * fragile in practice — the pointer-move tracking fights the scroll
   * container, the activation threshold was hard to tune (too short →
   * fires on scroll attempts; too long → user thinks it's broken), and
   * even when it activated cleanly, the cross-section drop math was
   * unreliable.
   *
   * The board (board.js) has the same problem and solves it better:
   * long-press a card → the press timer fires → instead of trying to
   * drag, OPEN A "MOVE TO …" PICKER. User taps the destination, we
   * persist optimistically, done. Reliable on every browser, every
   * input modality, no scroll-container conflicts. Orion confirmed
   * this works well on the board, so we copy that pattern here.
   *
   * Within-section ordering uses the always-visible ↑/↓ buttons on
   * each row (those still work fine — they're plain click handlers).
   * The picker is for cross-section moves (the operation the arrows
   * can't do).
   * ───────────────────────────────────────────────────────────────────── */
  function wireDragHandlers(listEl) {
    const LONG_PRESS_MS  = 500;          // standard mobile long-press feel
    const MOVE_THRESH_PX = 12;            // tolerate a bit of finger wiggle

    let pressTimer = null;
    let pressTarget = null;               // .ved-item-row currently being held
    let pressStartX = 0;
    let pressStartY = 0;
    let pressFired = false;

    const cancelPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (pressTarget) {
        pressTarget.classList.remove('is-pressing');
        pressTarget = null;
      }
    };

    listEl.addEventListener('pointerdown', (e) => {
      // Skip if the press lands on a control that needs its own handling —
      // up/down arrows (independent click), section rename input, the
      // inline edit form, etc. Notably we do NOT exclude every <button>:
      // the item row's whole content is wrapped in a .ved-item-tap button
      // so tapping the chevron also opens the edit form, and that button
      // IS the long-press target. The specific selectors below cover the
      // controls that genuinely need their own click semantics.
      if (e.target.closest('input, textarea, select, .ord-vitem-editing, .ved-section-rename-input, .ved-section-rename-btn, .ved-section-collapse, .ved-item-move-stack, .ved-section-move-stack')) {
        return;
      }
      // Only items get the picker; sections already have rename + ↑/↓
      // arrows + the items-area inside, so a long-press menu there would
      // conflict with the section name's own click-to-collapse.
      const itemRow = e.target.closest('.ved-item-row');
      if (!itemRow) return;

      pressTarget = itemRow;
      pressStartX = e.clientX;
      pressStartY = e.clientY;
      pressFired = false;
      itemRow.classList.add('is-pressing');

      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (!pressTarget) return;
        pressFired = true;

        // Haptic confirmation (Android Chrome supports navigator.vibrate;
        // iOS Safari ignores it silently — fine, no error)
        try { navigator.vibrate?.(15); } catch (_) {}

        pressTarget.classList.remove('is-pressing');
        pressTarget.classList.add('is-press-fired');
        const fired = pressTarget;
        setTimeout(() => fired.classList.remove('is-press-fired'), 220);

        const itemId = pressTarget.dataset.itemId;
        pressTarget = null;
        if (itemId) openItemMovePicker(itemId);
      }, LONG_PRESS_MS);
    });

    listEl.addEventListener('pointermove', (e) => {
      if (!pressTimer) return;
      const dx = Math.abs(e.clientX - pressStartX);
      const dy = Math.abs(e.clientY - pressStartY);
      if (dx > MOVE_THRESH_PX || dy > MOVE_THRESH_PX) {
        cancelPress();
      }
    });

    // Suppress the natural click that follows pointerup if the long-press
    // fired — otherwise the row's tap-to-edit handler would trigger right
    // after the picker opens, which feels broken.
    listEl.addEventListener('click', (e) => {
      if (pressFired) {
        e.stopPropagation();
        e.preventDefault();
        pressFired = false;
      }
    }, true);

    listEl.addEventListener('pointerup', cancelPress);
    listEl.addEventListener('pointercancel', cancelPress);
    listEl.addEventListener('pointerleave', cancelPress);
  }

  /* Open the "Move to section…" picker for a given item. Same UX as the
     board's openMovePicker — modal background, one button per section,
     tap to commit. Doesn't try to be clever about creating new sections
     inline; if the user wants a new section, they tap the
     "+ New section…" footer button which prompts for a name. */
  function openItemMovePicker(itemId) {
    if (!catalogState || !Array.isArray(catalogState.items)) return;
    const item = catalogState.items.find(x => String(x.id) === String(itemId));
    if (!item) return;

    // Gather sections in their canonical order (by first item's sort_order),
    // matching how the catalog list renders them. This way the picker lists
    // sections in the same order the user sees them — no surprise.
    const sectionsInOrder = [];
    const seen = new Set();
    catalogState.items
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .forEach(x => {
        const s = x.section || '';
        if (!seen.has(s)) { sectionsInOrder.push(s); seen.add(s); }
      });
    if (Array.isArray(catalogState.pendingSections)) {
      catalogState.pendingSections.forEach(s => {
        if (!seen.has(s)) { sectionsInOrder.unshift(s); seen.add(s); }
      });
    }

    const currentSection = item.section || '';

    const bg = document.createElement('div');
    bg.className = 'ord-pick-bg';
    bg.innerHTML = `
      <div class="ord-pick-modal" role="dialog" aria-label="Move item">
        <div class="ord-pick-head">
          <div class="ord-pick-title">
            <div class="ord-pick-eyebrow">Move to section</div>
            <div class="ord-pick-name">${esc((item.house_name || '').trim() || item.item_name)}</div>
          </div>
          <button class="ord-pick-close" aria-label="Cancel">×</button>
        </div>
        <div class="ord-pick-list">
          ${sectionsInOrder.map(s => {
            const isCurrent = s === currentSection;
            const label = s || 'Uncategorized';
            return `
              <button class="ord-pick-item${isCurrent ? ' is-current' : ''}" data-section="${esc(s)}" ${isCurrent ? 'disabled' : ''}>
                <span class="ord-pick-check" aria-hidden="true">${isCurrent ? '✓' : ''}</span>
                <span class="ord-pick-label">${esc(label)}</span>
                ${isCurrent ? '<span class="ord-pick-meta">current</span>' : ''}
              </button>
            `;
          }).join('')}
        </div>
        <div class="ord-pick-foot">
          <button class="ord-pick-new" type="button">+ New section…</button>
        </div>
      </div>
    `;

    const close = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    bg.querySelector('.ord-pick-close').addEventListener('click', close);

    bg.querySelectorAll('.ord-pick-item:not(.is-current)').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetSection = btn.dataset.section || '';
        close();
        await moveItemToSection(itemId, targetSection);
      });
    });

    bg.querySelector('.ord-pick-new').addEventListener('click', () => {
      const raw = prompt('New section name:');
      if (!raw) return;
      const name = raw.trim();
      if (!name) return;
      // Add to pendingSections so the section appears even before the
      // first item is moved into it (matches existing addSection flow).
      if (!Array.isArray(catalogState.pendingSections)) catalogState.pendingSections = [];
      if (!catalogState.pendingSections.includes(name) &&
          !catalogState.items.some(x => (x.section || '') === name)) {
        catalogState.pendingSections.unshift(name);
      }
      close();
      moveItemToSection(itemId, name);
    });

    document.body.appendChild(bg);
  }

  /* Move an item to a different section. Sets sort_order to "end of new
     section" so it lands at the bottom — caller can then use ↑/↓ to
     fine-tune. Optimistic: updates in-memory state + re-renders first,
     then fires the DB write in the background. On error, toasts; the
     in-memory state is already consistent because that's where we
     persisted to first. */
  async function moveItemToSection(itemId, newSection) {
    if (!catalogState || !Array.isArray(catalogState.items) || !NX.sb) return;
    const it = catalogState.items.find(x => String(x.id) === String(itemId));
    if (!it) return;
    const newSec = newSection || '';
    if ((it.section || '') === newSec) return;

    // Place at end of target section. Find max sort_order in that section
    // and add 1. If the section is empty (e.g. just-created via picker),
    // fall back to the global max + 1 so we don't collide with existing rows.
    const sectionRows = catalogState.items.filter(x =>
      (x.section || '') === newSec && String(x.id) !== String(itemId)
    );
    let newSort;
    if (sectionRows.length) {
      newSort = Math.max(...sectionRows.map(x => x.sort_order || 0)) + 1;
    } else {
      const allSorts = catalogState.items.map(x => x.sort_order || 0);
      newSort = (allSorts.length ? Math.max(...allSorts) : 0) + 1;
    }

    // Optimistic: update local state + re-render immediately
    const prevSection = it.section;
    const prevSort = it.sort_order;
    it.section = newSec;
    it.sort_order = newSort;
    renderItemsAreaOnly();

    try {
      const { error } = await NX.sb.from('order_guide_items')
        .update({ section: newSec, sort_order: newSort })
        .eq('id', it.id);
      if (error) throw error;
      if (NX.toast) NX.toast(`Moved to “${newSec || 'Uncategorized'}”`, 'info', 1400);
    } catch (e) {
      // Roll back on error
      it.section = prevSection;
      it.sort_order = prevSort;
      renderItemsAreaOnly();
      console.error('[ordering] moveItemToSection:', e);
      if (NX.toast) NX.toast('Could not move: ' + ((e && e.message) || ''), 'error', 3000);
    }
  }


  /* CSS.escape polyfill — kept for any future selector that needs the
   * actual section name. Not used by the simplified .is-dragging path. */
  function cssEsc(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch);
  }

  /* ── Persist item reorder ────────────────────────────────────────
   * Walks the final liveOrder and writes the new sort_order (and
   * section, if it changed) for any row that differs from in-memory state.
   * Optimistically updates catalogState.items first so the UI is stable. */
  /* ── Move a single item up or down by one position ──────────────────
   * Used by the ↑/↓ buttons in the item edit form. Builds the same
   * shape persistItemReorder expects (an array of {id, section}) so
   * the swap goes through the same DB write path the drag does.
   * Items only move within their current section — to change sections
   * the user types in the Section field of the edit form. */
  async function moveItemByOne(itemId, dir) {
    if (!catalogState || !Array.isArray(catalogState.items)) return;
    const it = catalogState.items.find(x => String(x.id) === String(itemId));
    if (!it) return;
    const sec = it.section || '';
    // Build current ordered list of items in this section
    const sectionItems = catalogState.items
      .filter(x => (x.section || '') === sec)
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = sectionItems.findIndex(x => String(x.id) === String(itemId));
    if (idx === -1) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sectionItems.length) {
      // Already at the edge — quick toast so the user knows it tried
      if (NX.toast) NX.toast(dir === 'up' ? 'Already at top of section' : 'Already at bottom of section', 'info', 1200);
      return;
    }
    // Swap them in the local section list
    [sectionItems[idx], sectionItems[swapIdx]] = [sectionItems[swapIdx], sectionItems[idx]];
    // Build full liveOrder for ALL sections — persistItemReorder rewrites
    // sort_order based on global index, so we need every item present.
    const allSectionsInOrder = [];
    const seenSec = new Set();
    catalogState.items
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .forEach(x => {
        const s = x.section || '';
        if (!seenSec.has(s)) { allSectionsInOrder.push(s); seenSec.add(s); }
      });
    const finalOrder = [];
    for (const s of allSectionsInOrder) {
      const items = (s === sec)
        ? sectionItems
        : catalogState.items
            .filter(x => (x.section || '') === s)
            .slice()
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      items.forEach(x => finalOrder.push({ id: x.id, section: s }));
    }
    await persistItemReorder(finalOrder);
    // Re-render so the item visibly moves while staying in edit mode.
    if (typeof renderItemsAreaOnly === 'function') renderItemsAreaOnly();
    // Re-scroll to keep the item in view.
    setTimeout(() => {
      const list = document.getElementById('catItemsList');
      const form = list && list.querySelector('.ord-vitem-editing');
      if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  /* ════════════════════════════════════════════════════════════════════
     v18.28 (catalog revamp) — Inline item field save with debounce

     Saves a SINGLE field on a catalog item without going through the
     full edit form. Used by the inline par stepper + unit input on
     each catalog row. Debounced 350ms per item so rapid typing/stepping
     doesn't fire a write per keystroke.

     State semantics:
       • catalogState.items[i].<field> is already updated by the caller
         (so the UI reflects the change immediately)
       • This function persists that update to the DB on the debounce
       • Errors surface as toast; no automatic revert (the user can fix
         and trigger another save)
     ════════════════════════════════════════════════════════════════════ */
  const _inlineItemSaveTimers = {};
  function scheduleInlineItemSave(itemId, patch) {
    if (!itemId || !patch) return;
    if (_inlineItemSaveTimers[itemId]) clearTimeout(_inlineItemSaveTimers[itemId]);
    // Merge any prior pending patch for this item so we always send
    // the most-recent set of changes in one go
    _inlineItemSaveTimers[itemId] = setTimeout(async () => {
      delete _inlineItemSaveTimers[itemId];
      try {
        const { error } = await NX.sb.from('order_guide_items')
          .update(patch).eq('id', itemId);
        if (error) throw error;
        // Soft success — no toast on every keystroke. Errors get one though.
      } catch (err) {
        console.error('[catalog] inline save failed:', err, 'patch:', patch);
        if (NX.toast) NX.toast(
          `Save failed: ${err.message || 'unknown error'}`,
          'error',
          3500
        );
      }
    }, 350);
  }

  /* Move an entire SECTION up or down by one position. Mirrors moveItemByOne
     for items. The section ordering is determined by the sort_order of the
     FIRST item in each section (sections don't have their own sort_order in
     this schema), so persistSectionReorder rewrites every item's sort_order
     to put the sections in the requested sequence. */
  async function moveSectionByOne(sectionName, dir) {
    if (!catalogState || !Array.isArray(catalogState.items)) return;
    const sec = sectionName || '';
    // Build current ordered list of sections by first-item sort_order
    const sectionsInOrder = [];
    const seen = new Set();
    catalogState.items
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .forEach(x => {
        const s = x.section || '';
        if (!seen.has(s)) { sectionsInOrder.push(s); seen.add(s); }
      });
    // Include any pending (empty) sections at the front, matching the
    // existing renderCatalog logic.
    if (Array.isArray(catalogState.pendingSections)) {
      catalogState.pendingSections.forEach(s => {
        if (!seen.has(s)) { sectionsInOrder.unshift(s); seen.add(s); }
      });
    }
    const idx = sectionsInOrder.indexOf(sec);
    if (idx === -1) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sectionsInOrder.length) {
      if (NX.toast) NX.toast(dir === 'up' ? 'Already at top' : 'Already at bottom', 'info', 1200);
      return;
    }
    [sectionsInOrder[idx], sectionsInOrder[swapIdx]] = [sectionsInOrder[swapIdx], sectionsInOrder[idx]];
    await persistSectionReorder(sectionsInOrder);
  }


  async function persistItemReorder(finalOrder) {
    if (!catalogState || !NX.sb || !finalOrder.length) return;
    const updates = [];
    finalOrder.forEach((entry, idx) => {
      const it = catalogState.items.find(x => String(x.id) === String(entry.id));
      if (!it) return;
      const wantSort = idx;
      const wantSec = entry.section;
      if (it.sort_order !== wantSort || (it.section || '') !== wantSec) {
        updates.push({ id: it.id, sort_order: wantSort, section: wantSec });
        it.sort_order = wantSort;
        it.section = wantSec;
      }
    });
    if (!updates.length) return;
    try {
      await Promise.all(updates.map(u =>
        NX.sb.from('order_guide_items')
          .update({ sort_order: u.sort_order, section: u.section })
          .eq('id', u.id)
      ));
      if (NX.toast) NX.toast(`Reordered ${updates.length} item${updates.length === 1 ? '' : 's'}`, 'info', 1100);
    } catch (e) {
      console.error('[ordering] persistItemReorder:', e);
      if (NX.toast) NX.toast('Could not save order: ' + ((e && e.message) || ''), 'error');
    }
    // Re-render to reflect canonical sort_order indexes
    renderItemsAreaOnly();
  }

  /* ── Persist section reorder ─────────────────────────────────────
   * Each section is rewritten to a contiguous block of sort_orders,
   * spaced 1000 apart so subsequent within-section drags have room. */
  async function persistSectionReorder(sectionOrder) {
    if (!catalogState || !NX.sb || !sectionOrder.length) return;
    // Rewrite sort_orders so each section's items occupy a unique band
    const updates = [];
    let cursor = 0;
    sectionOrder.forEach(sec => {
      // Pick up items in this section, in their current within-section order
      const inSec = catalogState.items
        .filter(i => (i.section || '') === sec)
        .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
      inSec.forEach(it => {
        if (it.sort_order !== cursor) {
          updates.push({ id: it.id, sort_order: cursor });
          it.sort_order = cursor;
        }
        cursor++;
      });
    });
    if (!updates.length) return;
    try {
      await Promise.all(updates.map(u =>
        NX.sb.from('order_guide_items')
          .update({ sort_order: u.sort_order })
          .eq('id', u.id)
      ));
      if (NX.toast) NX.toast('Sections reordered', 'info', 1100);
    } catch (e) {
      console.error('[ordering] persistSectionReorder:', e);
      if (NX.toast) NX.toast('Could not save section order: ' + ((e && e.message) || ''), 'error');
    }
    renderItemsAreaOnly();
  }

  /**
   * Archive any vendor by id. Shared by the editor's Archive button and
   * the vendor row's overflow menu. Surfaces the actual failure
   * mode — RLS denial returns empty .data with no .error, network
   * problems throw, validation problems set .error.
   */
  async function archiveVendorById(id, name) {
    if (!id) {
      if (NX.toast) NX.toast('Cannot archive: no vendor id', 'error');
      return false;
    }
    if (!confirm(`Archive ${name}? It will be hidden from the list. Order history is preserved.`)) return false;
    try {
      const { data, error } = await NX.sb.from('order_vendors')
        .update({ archived: true })
        .eq('id', id)
        .select();
      if (error) {
        console.error('[ordering] archive RPC error:', error);
        const msg = error.message || error.details || error.hint || 'unknown error';
        if (NX.toast) NX.toast('Archive failed: ' + msg, 'error', 4000);
        return false;
      }
      if (!data || data.length === 0) {
        dwarn('[ordering] archive returned no rows — likely RLS denial or stale id');
        if (NX.toast) NX.toast('Archive failed: no rows updated (check Supabase logs)', 'error', 4000);
        return false;
      }
      // Mutate the vendors array in place — DO NOT reassign with
      // .filter() because the array carries a custom ._itemCounts
      // property that would be lost on a fresh array, breaking
      // renderVendors() on the very next call.
      const idx = vendors.findIndex(v => v.id === id);
      if (idx >= 0) vendors.splice(idx, 1);
      if (vendors._itemCounts) delete vendors._itemCounts[id];
      renderVendors();
      if (NX.toast) NX.toast(`${name} archived`, 'info', 1500);
      return true;
    } catch (e) {
      console.error('[ordering] archiveVendorById threw:', e);
      if (NX.toast) NX.toast('Archive failed: ' + (e.message || 'network error'), 'error', 4000);
      return false;
    }
  }

  async function saveItemFromForm(itemId) {
    if (!catalogState) return;
    const isNew = itemId === '__new';
    const list = document.getElementById('catItemsList');
    if (!list) return;
    const formRow = list.querySelector(`.ord-vitem-editing[data-item-id="${itemId}"]`);
    if (!formRow) return;
    const name = formRow.querySelector('.ied-name').value.trim();
    if (!name) {
      if (NX.toast) NX.toast('Item name is required', 'warn');
      return;
    }
    const sku  = formRow.querySelector('.ied-sku').value.trim();
    const house = (formRow.querySelector('.ied-house')?.value || '').trim();
    const sec  = formRow.querySelector('.ied-section').value.trim();
    const unit = formRow.querySelector('.ied-unit').value.trim() || 'ea';
    const parRaw = formRow.querySelector('.ied-par').value.trim();
    const note = formRow.querySelector('.ied-note').value.trim();
    const par = parRaw === '' ? null : parseFloat(parRaw);
    // Day pars
    const days = {};
    formRow.querySelectorAll('.ied-day').forEach(inp => {
      const v = inp.value.trim();
      if (v !== '') days[inp.dataset.day] = parseFloat(v);
    });

    const payload = {
      item_name: name,
      house_name: house || null,
      vendor_sku: sku || null,
      section: sec || null,
      unit,
      default_par_qty: par,
      pars_by_day: days,
      note: note || null,
    };

    // Helper: if the DB write fails because house_name column doesn't
    // exist (pre-migration), strip it and retry. Keeps saves working
    // until the user runs the migration SQL.
    const stripHouseName = (p) => {
      const { house_name, ...rest } = p;
      return rest;
    };

    try {
      if (isNew) {
        // Determine sort_order. By default, append to end. But if the
        // section was a pending (newly-created) one, the user expects it
        // at the TOP — so give the new item a sort_order one below the
        // current minimum, which pulls its section to the front of the
        // section sort.
        const wasPending = sec && Array.isArray(catalogState.pendingSections)
                              && catalogState.pendingSections.indexOf(sec) !== -1;
        let newSortOrder;
        if (wasPending && catalogState.items.length > 0) {
          const minSort = catalogState.items.reduce(
            (m, i) => Math.min(m, i.sort_order != null ? i.sort_order : 0), 0);
          newSortOrder = minSort - 1;
        } else if (wasPending) {
          newSortOrder = 0;
        } else {
          const maxSort = catalogState.items.reduce(
            (m, i) => Math.max(m, i.sort_order || 0), 0);
          newSortOrder = maxSort + 1;
        }
        const insertPayload = { ...payload, vendor_id: catalogState.vendor.id, sort_order: newSortOrder };
        let res = await NX.sb.from('order_guide_items')
          .insert(insertPayload).select('*').single();
        if (res.error && /house_name|column.*does not exist|schema cache/i.test(res.error.message || '')) {
          res = await NX.sb.from('order_guide_items')
            .insert(stripHouseName(insertPayload)).select('*').single();
        }
        if (res.error) throw res.error;
        catalogState.items.push(res.data);
        if (vendors._itemCounts) {
          vendors._itemCounts[catalogState.vendor.id] = (vendors._itemCounts[catalogState.vendor.id] || 0) + 1;
        }
        // Section is now backed by a real row — drop it from pendingSections.
        if (sec && Array.isArray(catalogState.pendingSections)) {
          catalogState.pendingSections = catalogState.pendingSections.filter(s => s !== sec);
        }
      } else {
        let res = await NX.sb.from('order_guide_items').update(payload).eq('id', itemId);
        if (res.error && /house_name|column.*does not exist|schema cache/i.test(res.error.message || '')) {
          res = await NX.sb.from('order_guide_items').update(stripHouseName(payload)).eq('id', itemId);
        }
        if (res.error) throw res.error;
        const it = catalogState.items.find(i => i.id === itemId);
        if (it) Object.assign(it, payload);
      }
      catalogState.editingItemId = null;
      renderCatalog();
      if (NX.toast) NX.toast(isNew ? 'Item added' : 'Item saved', 'info', 1000);
    } catch (e) {
      console.error('[ordering] saveItemFromForm:', e);
      if (NX.toast) NX.toast('Failed to save item', 'error');
    }
  }

  async function deleteItem(itemId) {
    if (!catalogState || itemId === '__new') return;
    const it = catalogState.items.find(i => i.id === itemId);
    if (!it) return;
    if (!confirm(`Delete "${it.item_name}"?`)) return;
    try {
      // 1) Detach order_lines that reference this item. Without this,
      // a FK constraint on order_lines.item_id blocks the delete when
      // the item appears in any draft / sent / confirmed / delivered
      // order. order_lines store item_name and vendor_sku denormalized,
      // so nulling item_id keeps order history fully readable while
      // letting us drop the catalog row.
      await NX.sb.from('order_lines')
        .update({ item_id: null })
        .eq('item_id', itemId);

      // 2) Drop any per-location pars rows for this item (FK to items)
      await NX.sb.from('order_guide_pars')
        .delete()
        .eq('item_id', itemId);

      // 3) Now safe to delete the catalog row itself
      const { error } = await NX.sb.from('order_guide_items')
        .delete().eq('id', itemId);
      if (error) throw error;
      catalogState.items = catalogState.items.filter(i => i.id !== itemId);
      if (vendors._itemCounts) {
        vendors._itemCounts[catalogState.vendor.id] = Math.max(0, (vendors._itemCounts[catalogState.vendor.id] || 1) - 1);
      }
      catalogState.editingItemId = null;
      renderCatalog();
      if (NX.toast) NX.toast('Item deleted', 'info', 1000);
    } catch (e) {
      console.error('[ordering] deleteItem:', e);
      if (NX.toast) NX.toast('Failed to delete', 'error');
    }
  }

  /* Delete an entire section + every item in it. Two-step confirm
     because this is destructive: a single click could nuke 30+
     catalog items at once. Same FK-safe pattern as deleteItem —
     nulls out order_lines first so historical orders stay readable. */
  async function deleteSection(sectionName) {
    if (!catalogState || !catalogState.vendor || !NX.sb) return;
    const sec = sectionName || '';
    const itemsInSection = catalogState.items.filter(i => (i.section || '') === sec);
    if (itemsInSection.length === 0) {
      // Empty section — just drop the pending placeholder if present
      catalogState.pendingSections = (catalogState.pendingSections || []).filter(s => s !== sec);
      renderItemsAreaOnly();
      return;
    }
    const label = sec || 'Uncategorized';
    if (!confirm(`Delete section "${label}" and all ${itemsInSection.length} item${itemsInSection.length === 1 ? '' : 's'} in it?\n\nThis cannot be undone. Order history will remain readable.`)) return;
    if (itemsInSection.length >= 10) {
      // Second confirm for large sections — guards against fat-finger
      if (!confirm(`Really delete ${itemsInSection.length} items? Last chance.`)) return;
    }
    try {
      const itemIds = itemsInSection.map(i => i.id);

      // 1) Detach order_lines referencing any of these items
      await NX.sb.from('order_lines')
        .update({ item_id: null })
        .in('item_id', itemIds);

      // 2) Drop per-location pars rows
      await NX.sb.from('order_guide_pars')
        .delete()
        .in('item_id', itemIds);

      // 3) Delete the catalog rows
      const { error } = await NX.sb.from('order_guide_items')
        .delete()
        .in('id', itemIds);
      if (error) throw error;

      // Update local state
      catalogState.items = catalogState.items.filter(i => (i.section || '') !== sec);
      catalogState.pendingSections = (catalogState.pendingSections || []).filter(s => s !== sec);
      catalogState.collapsedSections.delete(sec);
      if (catalogState.renamingSection === sec) catalogState.renamingSection = null;
      if (vendors._itemCounts) {
        vendors._itemCounts[catalogState.vendor.id] = Math.max(0, (vendors._itemCounts[catalogState.vendor.id] || itemIds.length) - itemIds.length);
      }

      renderCatalog();
      if (NX.toast) NX.toast(`Section "${label}" deleted (${itemIds.length} item${itemIds.length === 1 ? '' : 's'})`, 'info', 1800);
    } catch (e) {
      console.error('[ordering] deleteSection:', e);
      if (NX.toast) NX.toast('Failed to delete section', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CATALOG EDITOR — full-screen overlay, looks like the order-entry
  // screen. Manages sections + items for a single vendor: add, edit,
  // delete, reorder via drag, rename sections, search-filter.
  // ═══════════════════════════════════════════════════════════════════

  async function openCatalogEditor(vendor) {
    if (!vendor || !vendor.id) {
      if (NX.toast) NX.toast('Save the vendor first', 'warn');
      return;
    }
    catalogState = {
      vendor: { ...vendor },
      items: [],
      itemsLoading: true,
      editingItemId: null,           // 'new' | item.id | null
      renamingSection: null,         // section name being inline-edited (null otherwise)
      addingSection: false,          // true while the "+ Section" inline form is open
      pendingSections: [],           // names of empty sections the user just created
                                     // (kept client-side until first item lands in them)
      collapsedSections: new Set(),  // section names currently collapsed (header-only)
      searchQuery: '',
      // v18.28 Phase 2 — filter pill state. 'all' (default) shows
      // every item; 'missing-par' shows items where default_par_qty
      // is null, undefined, or 0. Helps an operator audit catalog
      // setup ("which items still need a par?") without scrolling
      // the whole catalog.
      parFilter: 'all',              // 'all' | 'missing-par'
      // v18.28 Phase 2 — section-level bulk apply UI state. When a
      // section name is in here, that section shows an inline form
      // for "Apply par/unit to all N items in this section".
      bulkSection: null,             // section name or null
      overlay: null,
    };
    mountCatalogEditor();
    renderCatalog();
    try {
      catalogState.items = await loadVendorCatalog(vendor.id);
    } catch (e) {
      console.error('[ordering] openCatalogEditor load:', e);
      catalogState.items = [];
    }
    catalogState.itemsLoading = false;
    if (catalogState.overlay) renderCatalog();
  }

  function mountCatalogEditor() {
    let el = document.querySelector('.ord-catalog-overlay');
    if (!el) {
      syncMastheadHeight();
      el = document.createElement('div');
      el.className = 'ord-catalog-overlay';
      document.body.appendChild(el);
      document.body.classList.add('ord-overlay-open');
    }
    catalogState.overlay = el;
  }

  function closeCatalogEditor() {
    const overlay = document.querySelector('.ord-catalog-overlay');
    if (overlay) overlay.remove();
    if (catalogState && catalogState._escHandler) {
      document.removeEventListener('keydown', catalogState._escHandler);
    }
    // If the vendor editor is still open behind us, leave the body class.
    // Otherwise clear it.
    if (!document.querySelector('.ord-veditor-overlay') &&
        !document.querySelector('.ord-entry-overlay')) {
      document.body.classList.remove('ord-overlay-open');
    }
    catalogState = null;
  }

  /* ════════════════════════════════════════════════════════════════════
     CATALOG BULK IMPORT
     ──────────────────────────────────────────────────────────────────
     Lets admin replace/refresh a vendor's catalog from a spreadsheet
     instead of typing items one by one. Flow:

       1. Pick file (.xlsx, .xls, .csv) — uses SheetJS already in NEXUS
       2. Parse — header-row tolerant; recognized columns:
            section / item name / vendor sku / unit / pack size /
            default par / note. First row is the header; everything
            below is data. Empty rows skipped.
       3. Preview — diff against current vendor catalog by SKU:
            • match by SKU → UPDATE in place (preserves item_id so
              old order_lines.item_id still resolves)
            • new SKU → INSERT
            • current SKU not in upload → ARCHIVE (NOT delete; history
              stays linked, items just hide from active picker)
       4. Confirm → execute → close → reload catalog
     ════════════════════════════════════════════════════════════════════ */

  /* Generate a downloadable .xlsx file for this vendor's catalog and
     trigger a browser download. Two modes:
       - generateBlank=true (no items arg): 3 sample rows + Instructions
         sheet so a vendor can fill it in
       - items provided: current catalog exported, columns match what
         the importer expects so it round-trips back in cleanly
     Filename: "<vendor>_catalog.xlsx" or "<vendor>_template.xlsx" */
  function downloadCatalogTemplate(vendor, items) {
    if (!window.XLSX) {
      if (NX.toast) NX.toast('Spreadsheet engine not loaded — refresh page', 'error');
      return;
    }
    const generateBlank = !items || !items.length;
    const wb = window.XLSX.utils.book_new();

    // ── Items sheet ─────────────────────────────────────────────────
    const headers = ['Section', 'Item Name', 'Team Name', 'Vendor SKU', 'Unit', 'Default Par', 'Note'];
    const titleBanner   = ['NEXUS Vendor Catalog', '', '', '', '', '', ''];
    const vendorBanner  = [`For: ${vendor.name || 'Unknown vendor'}`, '', '', '', '', '', ''];
    const instrBanner   = [
      generateBlank
        ? 'Fill in below. Re-upload via Catalog → Import. Items match by Vendor SKU.'
        : `Current catalog snapshot. Edit and re-upload to update — matches by SKU.`,
      '', '', '', '', '', ''
    ];

    let dataRows;
    if (generateBlank) {
      dataRows = [
        ['Produce', 'Romaine Hearts, 24ct', 'Romaine',    'PFG-12345', '1 CS', 2, 'Tribe — pre-washed'],
        ['Produce', 'Tomatoes, slicing',     '',           'PFG-67890', 'lb',  30, ''],
        ['Dairy',   'Whole Milk',            'Whole Milk', 'PFG-22100', '1 GA', 4, 'Lactaid alt available'],
      ];
    } else {
      const sorted = items.slice().sort((a, b) => {
        const sa = (a.section || '').toLowerCase();
        const sb = (b.section || '').toLowerCase();
        if (sa !== sb) return sa.localeCompare(sb);
        return (a.sort_order || 0) - (b.sort_order || 0);
      });
      dataRows = sorted.map(it => [
        it.section || '',
        it.item_name || '',
        it.house_name || '',
        it.vendor_sku || '',
        it.unit || '',
        it.default_par_qty != null ? it.default_par_qty : '',
        it.note || '',
      ]);
    }

    const aoa = [
      titleBanner,
      vendorBanner,
      instrBanner,
      ['', '', '', '', '', ''],
      headers,
      ['', '', '', '', '', ''],
      ...dataRows,
    ];

    const itemsSheet = window.XLSX.utils.aoa_to_sheet(aoa);

    // Style the title block + header row. SheetJS community ignores
    // most cell styles in writeFile, but font weight + freeze panes +
    // column widths + merged cells DO survive — and those are the four
    // visual cues that matter most for "this looks polished."
    itemsSheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, // title row
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }, // vendor row
      { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }, // instruction row
    ];
    // Cell styles via the .s property — supported by recent SheetJS
    // builds and gracefully ignored otherwise.
    const setStyle = (addr, style) => {
      if (!itemsSheet[addr]) return;
      itemsSheet[addr].s = style;
    };
    setStyle('A1', { font: { name: 'Arial', sz: 16, bold: true, color: { rgb: '8B6914' } } });
    setStyle('A2', { font: { name: 'Arial', sz: 11, italic: true, color: { rgb: '6B6258' } } });
    setStyle('A3', { font: { name: 'Arial', sz: 10, italic: true, color: { rgb: '8B6914' } } });
    // Header row at index 4 (zero-based), so cells A5..F5
    ['A5','B5','C5','D5','E5','F5','G5'].forEach(addr => setStyle(addr, {
      font: { name: 'Arial', sz: 11, bold: true, color: { rgb: '1A1408' } },
      fill: { fgColor: { rgb: 'D4A44E' }, patternType: 'solid' },
      alignment: { horizontal: 'left', vertical: 'center' },
    }));
    // Sample rows in italic gray when blank template
    if (generateBlank) {
      [7, 8, 9].forEach(rowNum => {
        ['A','B','C','D','E','F','G'].forEach(col => {
          setStyle(`${col}${rowNum}`, {
            font: { name: 'Arial', sz: 10, italic: true, color: { rgb: '999999' } }
          });
        });
      });
    }

    // Column widths so the file opens nicely in Excel/Google Sheets
    itemsSheet['!cols'] = [
      { wch: 22 },  // Section
      { wch: 32 },  // Item Name
      { wch: 22 },  // Team Name
      { wch: 16 },  // SKU
      { wch: 14 },  // Unit
      { wch: 12 },  // Default Par
      { wch: 32 },  // Note
    ];
    // Row heights for the title block
    itemsSheet['!rows'] = [
      { hpt: 24 }, { hpt: 18 }, { hpt: 16 }, { hpt: 8 }, { hpt: 22 }, { hpt: 8 },
    ];
    // Freeze the header row + first column so scrolling stays oriented
    itemsSheet['!freeze'] = { xSplit: 0, ySplit: 5 };
    window.XLSX.utils.book_append_sheet(wb, itemsSheet, 'Items');

    // ── Instructions sheet ─────────────────────────────────────────
    // Reads as a one-pager: title, "how it works" steps, column
    // reference table, and tips.
    const instAoa = [
      ['NEXUS Vendor Catalog Template', '', ''],
      [`For: ${vendor.name || 'Unknown vendor'}`, '', ''],
      [generateBlank ? 'Blank template — fill in the Items sheet, then upload.' : 'Catalog export. Edit and re-upload to update.', '', ''],
      ['', '', ''],
      ['HOW IT WORKS', '', ''],
      ['1.', 'Edit the "Items" sheet — one row per item. First-row header stays as-is.', ''],
      ['2.', "In NEXUS: open this vendor's Catalog → Import → pick this file.", ''],
      ['3.', 'Preview shows what will change. Confirm to apply.', ''],
      ['',   'Items match by Vendor SKU. Items not in the file get archived (not deleted).', ''],
      ['', '', ''],
      ['COLUMN REFERENCE', '', ''],
      ['Column',     'Required?',   'What it means'],
      ['Section',     'Required',    'Group header. Items group by this. Examples: Produce, Dairy, Disposables.'],
      ['Item Name',   'Required',    "Vendor's name — what they see in the email."],
      ['Team Name',   'Optional',    "Your team's nickname for the item. Shown in the order screen instead of the vendor name. Vendor never sees this."],
      ['Vendor SKU',  'Recommended', "Vendor's product code. Used to match items on re-import — without it, every re-import duplicates."],
      ['Unit',        'Required',    'Pack size: case, lb, 24/12 OZ, etc.'],
      ['Default Par', 'Optional',    'Default order quantity. Per-location pars set inside NEXUS.'],
      ['Note',        'Optional',    'Brand, allergen, prep notes.'],
      ['', '', ''],
      ['TIPS', '', ''],
      ['•', 'Re-importing the same file is safe — items match on Vendor SKU and update rather than duplicate.', ''],
      ['•', 'Items removed from the file get archived in NEXUS (history preserved, just hidden).', ''],
      ['•', 'Empty rows are skipped.', ''],
      ['•', 'Sections are case-sensitive: "Produce" and "PRODUCE" become two separate sections.', ''],
      ['•', 'One catalog covers all locations. Per-location pars (Este orders 5, Suerte orders 3) live inside NEXUS, not this file.', ''],
    ];
    const instSheet = window.XLSX.utils.aoa_to_sheet(instAoa);
    instSheet['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 64 }];
    instSheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
    ];
    setStyleOn(instSheet, 'A1', { font: { name: 'Arial', sz: 16, bold: true, color: { rgb: '8B6914' } } });
    setStyleOn(instSheet, 'A2', { font: { name: 'Arial', sz: 11, italic: true, color: { rgb: '6B6258' } } });
    setStyleOn(instSheet, 'A3', { font: { name: 'Arial', sz: 10, italic: true, color: { rgb: '8B6914' } } });
    setStyleOn(instSheet, 'A5',  { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: '8B6914' } } });
    setStyleOn(instSheet, 'A11', { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: '8B6914' } } });
    setStyleOn(instSheet, 'A21', { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: '8B6914' } } });
    // Column-reference table header row
    ['A12','B12','C12'].forEach(addr => setStyleOn(instSheet, addr, {
      font: { name: 'Arial', sz: 10, bold: true, color: { rgb: '1A1408' } },
      fill: { fgColor: { rgb: 'D4A44E' }, patternType: 'solid' },
    }));

    window.XLSX.utils.book_append_sheet(wb, instSheet, 'Instructions');

    // ── Trigger download ─────────────────────────────────────────────
    const safeName = (vendor.name || 'vendor').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
    const suffix = generateBlank ? 'template' : 'catalog';
    const filename = `${safeName}_${suffix}.xlsx`;
    try {
      // bookSST + cellStyles options preserve the .s style metadata
      // when SheetJS supports it; harmless otherwise.
      window.XLSX.writeFile(wb, filename, { bookSST: false, cellStyles: true });
      if (NX.toast) NX.toast(generateBlank
        ? `Template downloaded — ${filename}`
        : `Exported ${dataRows.length} items — ${filename}`, 'info', 2500);
    } catch (e) {
      console.error('[ordering] xlsx download failed:', e);
      if (NX.toast) NX.toast('Download failed: ' + (e.message || ''), 'error');
    }
  }

  // Helper: set a style on a cell only if the cell exists. Used inside
  // downloadCatalogTemplate to avoid undefined-cell errors when the AOA
  // shape changes.
  function setStyleOn(sheet, addr, style) {
    if (!sheet || !sheet[addr]) return;
    sheet[addr].s = style;
  }

  function openCatalogImport(vendor) {
    if (!vendor || !vendor.id) return;
    if (!window.XLSX) {
      if (NX.toast) NX.toast('Spreadsheet engine not loaded — refresh page', 'error');
      return;
    }
    // Strip any leftover modal first
    document.querySelector('.ord-cat-import-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ord-cat-import-overlay';
    const hasItems = !!(catalogState && catalogState.items && catalogState.items.length);
    overlay.innerHTML = `
      <div class="ord-cat-import-backdrop"></div>
      <div class="ord-cat-import-modal" role="dialog" aria-label="Catalog spreadsheet sync">
        <div class="ord-cat-import-head">
          <div class="ord-cat-import-title">Catalog spreadsheet</div>
          <button class="ord-cat-import-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="ord-cat-import-body" id="catImpBody">
          <div class="ord-cat-import-step">
            <!-- Hidden file input — clicked programmatically by the upload button.
                 The "hidden" HTML attribute caused tap failures on some
                 Android Chrome builds, so we use display:none CSS instead. -->
            <input type="file" accept=".xlsx,.xls,.csv" id="catImpFile" style="display:none">

            <button type="button" class="ord-cat-import-upload" id="catImpUploadBtn">
              <div class="ord-cat-import-upload-icon">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <div class="ord-cat-import-upload-title">Upload spreadsheet</div>
              <div class="ord-cat-import-upload-sub">.xlsx, .xls, or .csv</div>
            </button>

            <div class="ord-cat-import-step-sub">
              Replaces <strong>${esc(vendor.name)}</strong>'s catalog with what's in the file. Items match by Vendor SKU and update in place — order history stays linked. Items missing from your file get archived, not deleted.
            </div>

            <div class="ord-cat-import-divider"><span>or download a sheet to edit</span></div>

            <div class="ord-cat-import-downloads">
              <button type="button" class="ord-cat-import-dllink" id="catImpDlBlank">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <polyline points="9 15 12 18 15 15"/>
                </svg>
                <span>Blank template</span>
              </button>
              ${hasItems ? `
                <button type="button" class="ord-cat-import-dllink" id="catImpDlCurrent">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="12" y1="18" x2="12" y2="12"/>
                    <polyline points="9 15 12 18 15 15"/>
                  </svg>
                  <span>Current catalog <span class="ord-cat-import-dllink-count">(${catalogState.items.length})</span></span>
                </button>
              ` : ''}
            </div>

            <div class="ord-cat-import-tips">
              <strong>Expected columns</strong>: Section · Item Name · Vendor SKU · Unit · Default Par · Note
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.ord-cat-import-backdrop').addEventListener('click', close);
    overlay.querySelector('.ord-cat-import-close').addEventListener('click', close);

    // Upload — explicitly trigger the hidden input on tap. Without this
    // dispatch, mobile browsers don't always associate a label/input
    // pair when the input is display:none.
    const fileInput = overlay.querySelector('#catImpFile');
    const uploadBtn = overlay.querySelector('#catImpUploadBtn');
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
      });
    }
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        await handleCatalogFilePicked(file, vendor, overlay);
      });
    }

    // Download buttons — both call the same generator, current-mode
    // includes existing rows, blank-mode just sample/header.
    const dlBlank = overlay.querySelector('#catImpDlBlank');
    if (dlBlank) dlBlank.addEventListener('click', () => downloadCatalogTemplate(vendor));
    const dlCurrent = overlay.querySelector('#catImpDlCurrent');
    if (dlCurrent) dlCurrent.addEventListener('click', () => downloadCatalogTemplate(vendor, catalogState.items));
  }

  async function handleCatalogFilePicked(file, vendor, overlay) {
    const body = overlay.querySelector('#catImpBody');
    body.innerHTML = `<div class="ord-cat-import-loading">Reading ${esc(file.name)}…</div>`;
    let rows;
    try {
      rows = await parseCatalogFile(file);
    } catch (e) {
      console.error('[ordering] parseCatalogFile:', e);
      body.innerHTML = `
        <div class="ord-cat-import-error">
          <div><strong>Couldn't read that file.</strong></div>
          <div>${esc(e.message || 'Unknown error')}</div>
          <button type="button" class="ord-cat-import-retry">Try again</button>
        </div>`;
      body.querySelector('.ord-cat-import-retry').addEventListener('click', () => {
        overlay.remove();
        openCatalogImport(vendor);
      });
      return;
    }
    if (!rows.length) {
      body.innerHTML = `
        <div class="ord-cat-import-error">
          <div><strong>No items found in that file.</strong></div>
          <div>Check that the first row is a header (Section, Item Name, etc.) and at least one item row follows.</div>
          <button type="button" class="ord-cat-import-retry">Try again</button>
        </div>`;
      body.querySelector('.ord-cat-import-retry').addEventListener('click', () => {
        overlay.remove();
        openCatalogImport(vendor);
      });
      return;
    }
    renderCatalogImportPreview(rows, vendor, overlay);
  }

  /* Read the file with SheetJS, normalize headers, return an array of
     {section, item_name, vendor_sku, unit, default_par_qty, note}.
     Header matching is fuzzy (lowercase, trim, ignore underscores) so
     "Item Name" / "item_name" / "ITEM" all map to the same field. */
  async function parseCatalogFile(file) {
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array', cellDates: false });
    // Pick the first non-empty sheet (skips an "Instructions" sheet
    // that might be sheet 0 in the template).
    let sheet;
    for (const name of wb.SheetNames) {
      const s = wb.Sheets[name];
      // Skip if name is "Instructions" or "README"
      if (/^(instructions?|readme|notes?)$/i.test(name)) continue;
      sheet = s;
      break;
    }
    if (!sheet) sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('Workbook is empty');

    const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!aoa.length) throw new Error('Sheet is empty');

    // Find the header row — first row containing both an "item" word
    // and a "name|description|sku" word. Skips merged-cell metadata at
    // the top of vendor-supplied files.
    let headerIdx = -1;
    for (let i = 0; i < Math.min(aoa.length, 30); i++) {
      const cells = (aoa[i] || []).map(c => String(c || '').toLowerCase());
      const hasItem = cells.some(c => /\b(item|product|description)\b/.test(c));
      const hasIdent = cells.some(c => /\b(sku|name|description|product)\b/.test(c));
      if (hasItem && hasIdent) { headerIdx = i; break; }
    }
    if (headerIdx === -1) throw new Error("Couldn't find a header row (Item Name / SKU / etc.)");

    const headers = (aoa[headerIdx] || []).map(c => String(c || '').toLowerCase().replace(/[_\s]+/g, ''));
    const colIdx = (matchers) => {
      for (let i = 0; i < headers.length; i++) {
        if (matchers.some(m => headers[i].includes(m))) return i;
      }
      return -1;
    };
    const idx = {
      section:    colIdx(['section', 'category', 'group', 'productclass']),
      item_name:  colIdx(['itemname', 'item', 'product', 'description', 'name']),
      house_name: colIdx(['teamname', 'housename', 'displayname', 'ourname', 'nickname']),
      vendor_sku: colIdx(['sku', 'productcode', 'itemcode', 'productnumber', 'productid']),
      unit:       colIdx(['unit', 'pack', 'size', 'uom']),
      default_par_qty: colIdx(['par', 'qty', 'quantity']),
      note:       colIdx(['note', 'comment', 'brand']),
    };
    // Item Name and Team Name use overlapping keywords ("name") — if the
    // header has both columns, item_name will match first and house_name's
    // resolver might land on the wrong column. Rerun house_name's resolver
    // EXCLUDING the column item_name claimed.
    if (idx.item_name >= 0 && idx.house_name === idx.item_name) {
      idx.house_name = -1;
      for (let i = 0; i < headers.length; i++) {
        if (i === idx.item_name) continue;
        if (['teamname','housename','displayname','ourname','nickname'].some(m => headers[i].includes(m))) {
          idx.house_name = i; break;
        }
      }
    }
    if (idx.item_name === -1 && idx.vendor_sku === -1) {
      throw new Error('No Item Name or Vendor SKU column found');
    }

    const rows = [];
    let lastSection = '';
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const get = (k) => idx[k] >= 0 ? String(row[idx[k]] == null ? '' : row[idx[k]]).trim() : '';
      const item_name = get('item_name');
      const vendor_sku = get('vendor_sku');
      // Skip blank rows
      if (!item_name && !vendor_sku) continue;
      // Section: explicit value wins, else inherit last (handles
      // section-header rows that only have section filled).
      const section = get('section') || lastSection || 'Uncategorized';
      if (get('section')) lastSection = section;

      const parRaw = get('default_par_qty');
      const par = parRaw && !isNaN(parseFloat(parRaw)) ? parseFloat(parRaw) : null;

      rows.push({
        section,
        item_name: item_name || vendor_sku,
        house_name: get('house_name') || null,
        vendor_sku: vendor_sku || null,
        unit: get('unit') || null,
        default_par_qty: par,
        note: get('note') || null,
      });
    }
    return rows;
  }

  function renderCatalogImportPreview(rows, vendor, overlay) {
    const body = overlay.querySelector('#catImpBody');
    body.innerHTML = `<div class="ord-cat-import-loading">Comparing against current catalog…</div>`;

    // Diff against current catalog. Match by SKU when present; if no
    // SKU, match by (section + name) lowercased — that's the only way
    // to identify a SKU-less item across imports.
    NX.sb.from('order_guide_items')
      .select('id, item_name, vendor_sku, section, unit, note, archived')
      .eq('vendor_id', vendor.id)
      .then(({ data: existing, error }) => {
        if (error) {
          body.innerHTML = `<div class="ord-cat-import-error"><div>Database read failed: ${esc(error.message)}</div></div>`;
          return;
        }
        const cur = existing || [];
        const curBySku  = new Map();
        const curByName = new Map();
        for (const c of cur) {
          if (c.vendor_sku) curBySku.set(String(c.vendor_sku).trim().toLowerCase(), c);
          const k = (c.section || '').toLowerCase() + '|' + (c.item_name || '').toLowerCase();
          curByName.set(k, c);
        }

        const inserts = [], updates = [], unchanged = [];
        const matchedIds = new Set();
        for (const r of rows) {
          let m = null;
          if (r.vendor_sku) m = curBySku.get(String(r.vendor_sku).trim().toLowerCase());
          if (!m) {
            const k = (r.section || '').toLowerCase() + '|' + (r.item_name || '').toLowerCase();
            m = curByName.get(k);
          }
          if (m) {
            matchedIds.add(m.id);
            // Was anything actually different?
            const changed = (
              (m.item_name || '')  !== (r.item_name || '')  ||
              (m.house_name || '') !== (r.house_name || '') ||
              (m.section || '')    !== (r.section || '')    ||
              (m.unit || '')       !== (r.unit || '')       ||
              (m.note || '')       !== (r.note || '')       ||
              ((m.vendor_sku || '') !== (r.vendor_sku || ''))
            );
            if (changed) updates.push({ id: m.id, ...r });
            else unchanged.push(m);
          } else {
            inserts.push(r);
          }
        }
        // Items in current but NOT in upload → will be archived
        const toArchive = cur.filter(c => !c.archived && !matchedIds.has(c.id));

        // Render the preview screen
        body.innerHTML = `
          <div class="ord-cat-import-preview">
            <div class="ord-cat-import-summary">
              <div class="ord-cat-import-stat ord-cat-import-stat-add">
                <div class="ord-cat-import-stat-num">${inserts.length}</div>
                <div class="ord-cat-import-stat-lbl">to add</div>
              </div>
              <div class="ord-cat-import-stat ord-cat-import-stat-update">
                <div class="ord-cat-import-stat-num">${updates.length}</div>
                <div class="ord-cat-import-stat-lbl">to update</div>
              </div>
              <div class="ord-cat-import-stat ord-cat-import-stat-keep">
                <div class="ord-cat-import-stat-num">${unchanged.length}</div>
                <div class="ord-cat-import-stat-lbl">unchanged</div>
              </div>
              <div class="ord-cat-import-stat ord-cat-import-stat-archive">
                <div class="ord-cat-import-stat-num">${toArchive.length}</div>
                <div class="ord-cat-import-stat-lbl">to archive</div>
              </div>
            </div>
            <div class="ord-cat-import-summary-note">
              <strong>${rows.length}</strong> rows in your file · vendor catalog will end with <strong>${inserts.length + updates.length + unchanged.length}</strong> active items.
            </div>

            ${inserts.length ? `
              <details class="ord-cat-import-group" open>
                <summary>Add (${inserts.length})</summary>
                <div class="ord-cat-import-list">
                  ${inserts.slice(0, 50).map(r => `
                    <div class="ord-cat-import-row ord-cat-import-row-add">
                      <span class="ord-cat-import-row-sec">${esc(r.section)}</span>
                      <span class="ord-cat-import-row-name">${esc(r.item_name)}</span>
                      ${r.vendor_sku ? `<span class="ord-cat-import-row-sku">${esc(r.vendor_sku)}</span>` : ''}
                      ${r.unit ? `<span class="ord-cat-import-row-unit">${esc(r.unit)}</span>` : ''}
                    </div>
                  `).join('')}
                  ${inserts.length > 50 ? `<div class="ord-cat-import-more">…and ${inserts.length - 50} more</div>` : ''}
                </div>
              </details>
            ` : ''}

            ${updates.length ? `
              <details class="ord-cat-import-group">
                <summary>Update (${updates.length})</summary>
                <div class="ord-cat-import-list">
                  ${updates.slice(0, 50).map(r => `
                    <div class="ord-cat-import-row ord-cat-import-row-update">
                      <span class="ord-cat-import-row-sec">${esc(r.section)}</span>
                      <span class="ord-cat-import-row-name">${esc(r.item_name)}</span>
                      ${r.vendor_sku ? `<span class="ord-cat-import-row-sku">${esc(r.vendor_sku)}</span>` : ''}
                    </div>
                  `).join('')}
                  ${updates.length > 50 ? `<div class="ord-cat-import-more">…and ${updates.length - 50} more</div>` : ''}
                </div>
              </details>
            ` : ''}

            ${toArchive.length ? `
              <details class="ord-cat-import-group">
                <summary>Archive (${toArchive.length}) — won't be deleted, just hidden from order picker</summary>
                <div class="ord-cat-import-list">
                  ${toArchive.slice(0, 50).map(c => `
                    <div class="ord-cat-import-row ord-cat-import-row-archive">
                      <span class="ord-cat-import-row-sec">${esc(c.section || '')}</span>
                      <span class="ord-cat-import-row-name">${esc(c.item_name || '')}</span>
                      ${c.vendor_sku ? `<span class="ord-cat-import-row-sku">${esc(c.vendor_sku)}</span>` : ''}
                    </div>
                  `).join('')}
                  ${toArchive.length > 50 ? `<div class="ord-cat-import-more">…and ${toArchive.length - 50} more</div>` : ''}
                </div>
              </details>
            ` : ''}

            <div class="ord-cat-import-actions">
              <button type="button" class="ord-cat-import-cancel">Cancel</button>
              <button type="button" class="ord-cat-import-confirm">Apply changes</button>
            </div>
          </div>
        `;
        body.querySelector('.ord-cat-import-cancel').addEventListener('click', () => overlay.remove());
        body.querySelector('.ord-cat-import-confirm').addEventListener('click', async () => {
          await executeCatalogImport({ inserts, updates, toArchive }, vendor, overlay);
        });
      });
  }

  async function executeCatalogImport({ inserts, updates, toArchive }, vendor, overlay) {
    const body = overlay.querySelector('#catImpBody');
    body.innerHTML = `<div class="ord-cat-import-loading">Applying changes — don't close…</div>`;
    const errors = [];

    // Compute next sort_order — append new items after current max so
    // they don't shuffle existing ordering. Group by section and offset
    // within so they cluster sensibly.
    let maxSort = 0;
    try {
      const { data } = await NX.sb.from('order_guide_items')
        .select('sort_order').eq('vendor_id', vendor.id)
        .order('sort_order', { ascending: false }).limit(1);
      if (data && data[0]) maxSort = data[0].sort_order || 0;
    } catch (_) {}

    // 1) Archive
    if (toArchive.length) {
      try {
        const ids = toArchive.map(c => c.id);
        const { error } = await NX.sb.from('order_guide_items')
          .update({ archived: true }).in('id', ids);
        if (error) errors.push('archive: ' + error.message);
      } catch (e) { errors.push('archive: ' + e.message); }
    }

    // 2) Update (one row at a time to keep error messages traceable)
    for (const u of updates) {
      try {
        const fullPayload = {
          item_name: u.item_name,
          house_name: u.house_name || null,
          vendor_sku: u.vendor_sku,
          section: u.section,
          unit: u.unit,
          note: u.note,
          archived: false,
        };
        let res = await NX.sb.from('order_guide_items').update(fullPayload).eq('id', u.id);
        if (res.error && /house_name|column.*does not exist|schema cache/i.test(res.error.message || '')) {
          const { house_name, ...fb } = fullPayload;
          res = await NX.sb.from('order_guide_items').update(fb).eq('id', u.id);
        }
        if (res.error) errors.push(`update ${u.item_name}: ${res.error.message}`);
      } catch (e) { errors.push(`update ${u.item_name}: ${e.message}`); }
    }

    // 3) Insert (batch — Supabase handles arrays)
    if (inserts.length) {
      const rows = inserts.map((r, i) => ({
        vendor_id: vendor.id,
        item_name: r.item_name,
        house_name: r.house_name || null,
        vendor_sku: r.vendor_sku,
        section: r.section,
        unit: r.unit,
        note: r.note,
        default_par_qty: r.default_par_qty,
        sort_order: maxSort + 10 + (i * 10),
        archived: false,
      }));
      // Some columns may not exist on the schema (note, default_par_qty,
      // house_name are newer additions). Retry without them on column-
      // missing errors so the import still mostly works pre-migration.
      let res = await NX.sb.from('order_guide_items').insert(rows);
      if (res.error && /column.*does not exist|schema cache/i.test(res.error.message || '')) {
        const safe = rows.map(r => {
          const { note, default_par_qty, house_name, ...rest } = r;
          return rest;
        });
        res = await NX.sb.from('order_guide_items').insert(safe);
      }
      if (res.error) errors.push('insert: ' + res.error.message);
    }

    // Done — show result and reload catalog
    if (errors.length) {
      body.innerHTML = `
        <div class="ord-cat-import-error">
          <div><strong>Finished with ${errors.length} error${errors.length === 1 ? '' : 's'}.</strong></div>
          <ul>${errors.slice(0, 6).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
          ${errors.length > 6 ? `<div>…and ${errors.length - 6} more (check console).</div>` : ''}
          <button type="button" class="ord-cat-import-retry">Close</button>
        </div>`;
      console.error('[ordering] catalog import errors:', errors);
      body.querySelector('.ord-cat-import-retry').addEventListener('click', () => overlay.remove());
    } else {
      body.innerHTML = `
        <div class="ord-cat-import-success">
          <div class="ord-cat-import-success-icon">✓</div>
          <div class="ord-cat-import-success-title">Catalog updated</div>
          <div class="ord-cat-import-success-sub">
            ${inserts.length} added · ${updates.length} updated · ${toArchive.length} archived
          </div>
          <button type="button" class="ord-cat-import-done">Done</button>
        </div>`;
      body.querySelector('.ord-cat-import-done').addEventListener('click', () => {
        overlay.remove();
        // Reload catalog so the editor shows the new state
        if (catalogState && catalogState.vendor && catalogState.vendor.id === vendor.id) {
          (async () => {
            const cat = await loadVendorCatalog(vendor.id);
            catalogState.items = cat;
            renderCatalog();
          })();
        }
      });
      if (NX.toast) NX.toast(`Catalog imported — ${inserts.length + updates.length} items active`, 'info', 2500);
    }
  }

  function renderCatalog() {
    if (!catalogState || !catalogState.overlay) return;
    const v = catalogState.vendor;
    const overlay = catalogState.overlay;

    if (catalogState.itemsLoading) {
      overlay.innerHTML = `
        <div class="ord-entry-head ord-catalog-head">
          <button class="ord-entry-close" id="catClose" aria-label="Close">${arrowLeftIcon()}</button>
          <div class="ord-entry-title">
            <div class="ord-entry-vendor">${esc(v.name)}</div>
            <div class="ord-entry-sub">Catalog</div>
          </div>
          <div class="ord-entry-spacer"></div>
        </div>
        <div class="ord-entry-loading">Loading catalog…</div>
      `;
      overlay.querySelector('#catClose').addEventListener('click', closeCatalogEditor);
      return;
    }

    const itemCount = catalogState.items.length;
    const itemCountSub = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
    // v18.28 Phase 2 — items missing par. Used both for the filter
    // pill label and to decide whether to even render that pill.
    const missingParCount = catalogState.items.filter(i => {
      const p = i.default_par_qty;
      return p == null || Number(p) === 0;
    }).length;
    const parFilter = catalogState.parFilter || 'all';

    // v18.28 Phase 2 — top toolbar simplified. The primary action
    // (+ Item) moves to a floating CTA at the bottom of the screen.
    // The top toolbar keeps the less-frequent actions (Section,
    // Import). This mirrors the ordering screen's pattern: primary
    // action floats above content, scrolls away on scroll-down.
    const toolbarHTML = `
      <div class="ord-cat-toolbar">
        <button class="ord-cat-tool-btn" id="catAddSection" type="button">
          ${plusIcon()}<span>Section</span>
        </button>
        <button class="ord-cat-tool-btn ord-cat-tool-import" id="catImport" type="button" title="Bulk import from spreadsheet">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>Import</span>
        </button>
      </div>
    `;

    // Add-section inline form
    const addSectionHTML = catalogState.addingSection ? `
      <div class="ord-cat-addsection">
        <input type="text" class="ord-cat-addsection-input" id="catNewSectionInput" placeholder="Section name (e.g. Dairy)" autocomplete="off" spellcheck="false">
        <button class="ord-cat-addsection-save" id="catNewSectionSave" type="button">Add</button>
        <button class="ord-cat-addsection-cancel" id="catNewSectionCancel" type="button">Cancel</button>
      </div>
    ` : '';

    // Search bar with a collapse-all toggle on the right
    const allSectionNames = collectAllSectionNames();
    const allCollapsed = allSectionNames.length > 0 &&
                         allSectionNames.every(s => catalogState.collapsedSections.has(s));
    const searchHTML = `
      <div class="ord-cat-search-row">
        <div class="ord-entry-search-wrap ord-cat-search-wrap">
          <input type="search" class="ord-entry-search" id="catSearch" placeholder="Search items…" value="${esc(catalogState.searchQuery || '')}" autocomplete="off" spellcheck="false">
        </div>
        ${allSectionNames.length ? `
          <button class="ord-cat-collapse-all" id="catCollapseAll" type="button" aria-pressed="${allCollapsed}" aria-label="${allCollapsed ? 'Expand all sections' : 'Collapse all sections'}" title="${allCollapsed ? 'Expand all' : 'Collapse all'}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              ${allCollapsed
                ? '<polyline points="6 9 12 15 18 9"/><polyline points="6 15 12 9 18 15" style="opacity:.4"/>'
                : '<polyline points="6 15 12 9 18 15"/><polyline points="6 9 12 15 18 9" style="opacity:.4"/>'}
            </svg>
          </button>
        ` : ''}
      </div>
    `;

    // v18.28 Phase 2 — Filter pills (All / Missing par). Same visual
    // language as the ordering screen's My-items/All/Fill pills, but
    // here surfacing catalog-setup audit ("which items still need a
    // par configured?"). Pill only renders if there's a non-trivial
    // count of missing-par items, otherwise it's noise.
    const filterPillsHTML = (itemCount > 0) ? `
      <div class="ord-cat-filter-row">
        <button type="button" class="ord-entry-filter-pill${parFilter === 'all' ? ' is-active' : ''}" data-cat-filter="all">
          All${itemCount ? ` <span class="ord-pill-count">${itemCount}</span>` : ''}
        </button>
        ${missingParCount > 0 ? `
          <button type="button" class="ord-entry-filter-pill${parFilter === 'missing-par' ? ' is-active' : ''}" data-cat-filter="missing-par">
            Missing par <span class="ord-pill-count">${missingParCount}</span>
          </button>
        ` : ''}
        ${parFilter === 'missing-par' ? `
          <span class="ord-entry-filter-hint">Showing items with no par set</span>
        ` : ''}
      </div>
    ` : '';

    overlay.innerHTML = `
      <div class="ord-entry-head ord-catalog-head">
        <button class="ord-entry-close" id="catClose" aria-label="Close">${arrowLeftIcon()}</button>
        <div class="ord-entry-title">
          <div class="ord-entry-vendor">${esc(v.name)}</div>
          <div class="ord-entry-sub">Catalog · ${itemCountSub}</div>
        </div>
        <div class="ord-entry-spacer"></div>
      </div>
      ${toolbarHTML}
      ${addSectionHTML}
      ${searchHTML}
      ${filterPillsHTML}
      <div class="ord-entry-list ord-cat-list" id="catItemsList">
        ${renderItemsList()}
      </div>
      <!-- v18.28 Phase 2 — Floating primary action. Mirrors the
           ordering screen's Review & Send pattern: position absolute,
           transparent wrapper, button carries elevation shadow,
           auto-hides on downward scroll. -->
      <div class="ord-entry-cta-wrap ord-cat-cta-wrap">
        <button class="ord-entry-cta ord-cat-cta" id="catAddItemFloating" type="button">
          ${plusIcon(true)}<span>Add item</span>
        </button>
      </div>
    `;

    wireCatalogHandlers();
  }

  function wireCatalogHandlers() {
    if (!catalogState || !catalogState.overlay) return;
    const overlay = catalogState.overlay;

    // Close
    const close = overlay.querySelector('#catClose');
    if (close) close.addEventListener('click', closeCatalogEditor);

    // Add section
    const addSec = overlay.querySelector('#catAddSection');
    if (addSec) addSec.addEventListener('click', () => {
      catalogState.addingSection = true;
      renderCatalog();
      setTimeout(() => {
        const inp = overlay.querySelector('#catNewSectionInput');
        if (inp) { inp.focus(); inp.select(); }
      }, 30);
    });

    // Add section — save / cancel
    const newSecSave = overlay.querySelector('#catNewSectionSave');
    if (newSecSave) newSecSave.addEventListener('click', commitNewSection);
    const newSecCancel = overlay.querySelector('#catNewSectionCancel');
    if (newSecCancel) newSecCancel.addEventListener('click', () => {
      catalogState.addingSection = false;
      renderCatalog();
    });
    const newSecInput = overlay.querySelector('#catNewSectionInput');
    if (newSecInput) {
      newSecInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commitNewSection(); }
        else if (e.key === 'Escape') {
          catalogState.addingSection = false;
          renderCatalog();
        }
      });
    }

    // v18.28 Phase 2 — Add item — primary CTA is now the floating
    // button at the bottom of the screen, not the top toolbar. Same
    // behavior (opens inline new-item form at the top of the list).
    const addItem = overlay.querySelector('#catAddItemFloating');
    if (addItem) addItem.addEventListener('click', () => {
      catalogState.editingItemId = 'new';
      // Inject suggested default section into the new-item form via state
      catalogState._newItemDefaultSection = pickDefaultNewItemSection();
      renderItemsAreaOnly();
      setTimeout(() => {
        const form = overlay.querySelector('.ord-vitem-editing');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    });

    // v18.28 Phase 2 — Filter pills (All / Missing par). Click to
    // toggle catalog-wide filtering. The renderItemsAreaOnly call
    // re-runs the filter chain in renderItemsList.
    overlay.querySelectorAll('[data-cat-filter]').forEach(pill => {
      pill.addEventListener('click', () => {
        catalogState.parFilter = pill.dataset.catFilter || 'all';
        renderCatalog();  // full re-render to update pill active states + counts
      });
    });

    // Bulk import — opens the spreadsheet import modal. Sits next to
    // Add Item so it's discoverable but visually less prominent (admin
    // power-user action). The modal handles file picker, parse, preview,
    // and confirm/execute.
    const importBtn = overlay.querySelector('#catImport');
    if (importBtn) importBtn.addEventListener('click', () => openCatalogImport(catalogState.vendor));

    // Empty-state CTAs — same flows as the toolbar buttons, just in a
    // friendlier place when the catalog is brand new.
    const emptyImport = overlay.querySelector('#vedEmptyImport');
    if (emptyImport) emptyImport.addEventListener('click', () => openCatalogImport(catalogState.vendor));

    const emptyDownload = overlay.querySelector('#vedEmptyDownload');
    if (emptyDownload) emptyDownload.addEventListener('click', () => downloadCatalogTemplate(catalogState.vendor));

    const emptyManual = overlay.querySelector('#vedEmptyManual');
    if (emptyManual) emptyManual.addEventListener('click', () => {
      catalogState.editingItemId = 'new';
      catalogState._newItemDefaultSection = pickDefaultNewItemSection();
      renderItemsAreaOnly();
      setTimeout(() => {
        const form = overlay.querySelector('.ord-vitem-editing');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    });

    // Search
    const search = overlay.querySelector('#catSearch');
    if (search) {
      search.addEventListener('input', e => {
        catalogState.searchQuery = e.target.value;
        renderItemsAreaOnly();
      });
    }

    // Collapse-all toggle
    const collapseAllBtn = overlay.querySelector('#catCollapseAll');
    if (collapseAllBtn) collapseAllBtn.addEventListener('click', toggleCollapseAll);

    // Wire item-list interactions (rename, edit form, drag)
    wireItemListHandlers();

    // ESC to close catalog editor (matches the order-entry overlay UX).
    // Bound once per render — the overlay holds the listener so we can
    // detach it on close.
    if (!catalogState._escWired) {
      const escHandler = e => {
        if (e.key !== 'Escape') return;
        if (!document.querySelector('.ord-catalog-overlay')) return;
        // Don't intercept ESC when an inline form is open — let the form
        // cancel itself first.
        if (catalogState && catalogState.editingItemId != null) {
          catalogState.editingItemId = null;
          renderItemsAreaOnly();
          return;
        }
        if (catalogState && catalogState.renamingSection != null) {
          catalogState.renamingSection = null;
          renderItemsAreaOnly();
          return;
        }
        if (catalogState && catalogState.addingSection) {
          catalogState.addingSection = false;
          renderCatalog();
          return;
        }
        closeCatalogEditor();
      };
      document.addEventListener('keydown', escHandler);
      catalogState._escWired = true;
      catalogState._escHandler = escHandler;
    }

    // v18.28 Phase 2 — Floating "+ Add Item" CTA auto-hide on
    // downward scroll. Same pattern as the ordering screen's Review
    // & Send button. 10px tolerance to ignore iOS scroll-bounce
    // jitter; always-visible at top, at bottom, or scrolling up.
    const list = overlay.querySelector('#catItemsList');
    const ctaWrap = overlay.querySelector('.ord-cat-cta-wrap');
    if (list && ctaWrap) {
      let lastY = 0;
      let lastDir = 0;
      const TOLERANCE = 10;
      const BOTTOM_THRESHOLD = 24;
      const TOP_THRESHOLD = 8;
      const onScroll = () => {
        const y = list.scrollTop;
        const max = list.scrollHeight - list.clientHeight;
        const atTop    = y <= TOP_THRESHOLD;
        const atBottom = max - y <= BOTTOM_THRESHOLD;
        const delta = y - lastY;
        if (Math.abs(delta) >= TOLERANCE) {
          lastDir = delta > 0 ? 1 : -1;
          lastY = y;
        }
        const shouldHide = lastDir === 1 && !atTop && !atBottom;
        ctaWrap.classList.toggle('is-hidden', shouldHide);
      };
      list.addEventListener('scroll', onScroll, { passive: true });
      ctaWrap.classList.remove('is-hidden');
    }
  }

  /* When opening the "Add item" form, default the section to the most
   * useful one: the most-recently-created pending section, or the
   * alphabetically-first existing section, or empty. */
  function pickDefaultNewItemSection() {
    if (!catalogState) return '';
    const pending = catalogState.pendingSections || [];
    if (pending.length) return pending[0];   // unshifted to front, so [0] is newest
    const sections = new Set();
    catalogState.items.forEach(i => { if (i.section) sections.add(i.section); });
    if (!sections.size) return '';
    return Array.from(sections).sort()[0];
  }

  /* Return all named sections (real + pending). Used for collapse-all
   * state evaluation and for the auto-scroll bounds. */
  function collectAllSectionNames() {
    if (!catalogState) return [];
    const out = new Set();
    catalogState.items.forEach(i => { if (i.section) out.add(i.section); });
    (catalogState.pendingSections || []).forEach(s => out.add(s));
    return Array.from(out);
  }

  function toggleCollapseSection(sec) {
    if (!catalogState) return;
    if (catalogState.collapsedSections.has(sec)) {
      catalogState.collapsedSections.delete(sec);
    } else {
      catalogState.collapsedSections.add(sec);
    }
    renderItemsAreaOnly();
  }

  function toggleCollapseAll() {
    if (!catalogState) return;
    const all = collectAllSectionNames();
    if (!all.length) return;
    const everyCollapsed = all.every(s => catalogState.collapsedSections.has(s));
    if (everyCollapsed) {
      catalogState.collapsedSections.clear();
    } else {
      all.forEach(s => catalogState.collapsedSections.add(s));
    }
    renderCatalog();   // full re-render so the toggle button label updates
  }

  /* Validate + commit a new section. Sections that already exist (or
   * collide with a pending one) are rejected with a toast. Pending
   * sections live in catalogState.pendingSections until the user adds
   * an item to them. */
  function commitNewSection() {
    if (!catalogState) return;
    const inp = catalogState.overlay && catalogState.overlay.querySelector('#catNewSectionInput');
    if (!inp) return;
    const name = (inp.value || '').trim();
    if (!name) {
      if (NX.toast) NX.toast('Section name cannot be empty', 'warn');
      return;
    }
    const existsOnItems = catalogState.items.some(i => (i.section || '') === name);
    const existsPending = (catalogState.pendingSections || []).indexOf(name) !== -1;
    if (existsOnItems || existsPending) {
      if (NX.toast) NX.toast('A section with that name already exists', 'warn');
      return;
    }
    catalogState.pendingSections = catalogState.pendingSections || [];
    catalogState.pendingSections.unshift(name);   // newest first → renders at top
    catalogState.addingSection = false;
    renderCatalog();
    if (NX.toast) NX.toast(`Section “${name}” created — add an item to keep it`, 'info', 1800);
  }

  // ═══════════════════════════════════════════════════════════════════
  // QUICK-ADD ITEM (from order entry)
  // ═══════════════════════════════════════════════════════════════════
  // When the chef is mid-order and realizes they need something not in
  // the catalog, they can tap "+" in the entry header to add it on the
  // fly. The item is persisted to the catalog so future orders pick it
  // up too. Default qty in the current order is 1 — they can adjust
  // after the modal closes.

  function openQuickAddItem(vendor) {
    if (!vendor || !entryState) return;

    // Mount a modal overlay
    const modal = document.createElement('div');
    modal.className = 'ord-qadd-overlay';
    modal.innerHTML = `
      <div class="ord-qadd-backdrop"></div>
      <div class="ord-qadd-card">
        <div class="ord-qadd-head">
          <div class="ord-qadd-title">Add item</div>
          <div class="ord-qadd-sub">to ${esc(vendor.name)}</div>
        </div>
        <div class="ord-qadd-body">
          <div class="ord-form-field">
            <label class="ord-form-label" for="qaddName">Name</label>
            <input type="text" class="ord-form-input" id="qaddName" placeholder="e.g. cilantro" autocomplete="off">
          </div>
          <div class="ord-form-row-2">
            <div class="ord-form-field">
              <label class="ord-form-label" for="qaddUnit">Unit</label>
              <input type="text" class="ord-form-input" id="qaddUnit" value="ea" placeholder="ea / cs / lb" autocomplete="off">
            </div>
            <div class="ord-form-field">
              <label class="ord-form-label" for="qaddQty">Qty for this order</label>
              <input type="number" class="ord-form-input" id="qaddQty" value="1" min="0" step="1" inputmode="numeric">
            </div>
          </div>
          <div class="ord-form-field">
            <label class="ord-form-label" for="qaddSection">Section (optional)</label>
            <input type="text" class="ord-form-input" id="qaddSection" placeholder="e.g. Produce" autocomplete="off">
          </div>
          <div class="ord-form-hint">This adds the item to <b>${esc(vendor.name)}</b>'s catalog so it's there for future orders too.</div>
        </div>
        <div class="ord-qadd-foot">
          <button class="ord-veditor-cancel" id="qaddCancel">Cancel</button>
          <button class="ord-veditor-save" id="qaddSave">Add to order</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.ord-qadd-backdrop').addEventListener('click', close);
    modal.querySelector('#qaddCancel').addEventListener('click', close);

    // Focus name input on open
    setTimeout(() => modal.querySelector('#qaddName').focus(), 30);

    modal.querySelector('#qaddSave').addEventListener('click', async () => {
      const name = modal.querySelector('#qaddName').value.trim();
      const unit = modal.querySelector('#qaddUnit').value.trim() || 'ea';
      const sec  = modal.querySelector('#qaddSection').value.trim();
      const qtyStr = modal.querySelector('#qaddQty').value.trim();
      const qty = qtyStr === '' ? 1 : Math.max(0, parseFloat(qtyStr) || 0);
      if (!name) {
        if (NX.toast) NX.toast('Item name is required', 'warn');
        return;
      }

      try {
        // Determine sort_order: append to end of catalog
        const maxSort = entryState.catalog.reduce(
          (m, i) => Math.max(m, i.sort_order || 0), 0);
        const { data, error } = await NX.sb.from('order_guide_items').insert({
          vendor_id: vendor.id,
          item_name: name,
          unit,
          section: sec || null,
          sort_order: maxSort + 1,
        }).select('*').single();
        if (error) {
          console.error('[ordering] quick-add insert:', error);
          if (NX.toast) NX.toast('Failed: ' + (error.message || 'unknown'), 'error', 4000);
          return;
        }

        // Append to in-memory catalog
        entryState.catalog.push(data);
        // Bump cached vendor item count
        if (vendors._itemCounts) {
          vendors._itemCounts[vendor.id] = (vendors._itemCounts[vendor.id] || 0) + 1;
        }
        // Set the qty on the new item if user specified one
        if (qty > 0) {
          entryState.lines[data.id] = {
            qty,
            unit: data.unit,
            item_name: data.item_name,
            vendor_sku: data.vendor_sku || null,
          };
          scheduleDraftSave();
        }
        renderEntryItems();
        close();
        if (NX.toast) NX.toast(`Added "${name}"`, 'info', 1200);

        // Scroll the new item into view
        setTimeout(() => {
          const row = document.querySelector(`.ord-item-row[data-item-id="${data.id}"]`);
          if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
      } catch (e) {
        console.error('[ordering] quick-add threw:', e);
        if (NX.toast) NX.toast('Failed: ' + (e.message || 'network error'), 'error', 4000);
      }
    });
  }

  // ─── ICONS ───────────────────────────────────────────────────────
  function closeIcon() {
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  }
  function arrowLeftIcon() {
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
  }
  function envelopeIcon() {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></svg>`;
  }
  function editIcon() {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  }
  /**
   * Render a plus icon. By default includes a 4px right margin which
   * gives breathing room when paired with text (e.g. "+ Add item").
   * Pass standalone=true to suppress the margin when the icon is used
   * by itself inside a circular icon button — the margin would push
   * the glyph off-center otherwise.
   */
  function plusIcon(standalone) {
    const m = standalone ? '0' : '4px';
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:${m}"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  }
  function trashIcon() {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  }
  function dotsIcon() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>`;
  }
  function gearIcon() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  }
  function listIcon() {
    return `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>`;
  }
  function cameraIcon() {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  }

  /**
   * Take a user-picked image File and return a data URL of a centered,
   * cover-fit, square JPEG at maxDim×maxDim. Used to keep vendor logo
   * uploads small enough for Supabase TEXT storage (~20–30 KB each).
   */
  function downscaleImageToDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => {
        const img = new Image();
        img.onload  = () => {
          try {
            const sz = Math.min(img.width, img.height);
            const sx = (img.width  - sz) / 2;
            const sy = (img.height - sz) / 2;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = maxDim;
            const ctx = canvas.getContext('2d');
            // Clear in case canvas has transparency leftovers.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, maxDim, maxDim);
            ctx.drawImage(img, sx, sy, sz, sz, 0, 0, maxDim, maxDim);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Generates a circular initial-based avatar for a vendor row.
   * The hue is derived deterministically from the vendor name (hash
   * of the name → 0..360°), then desaturated and warmed toward the
   * NEXUS gold palette so all avatars look like they belong to the
   * same family even though no two vendors share the same exact tone.
   *
   * Visual: 44px circle, dark surface with a colored letter on top,
   * subtle gold outline. Reads cleanly in both light and dark themes.
   */
  /**
   * Render a vendor avatar. Three modes, in priority order:
   *   1. If imageUrl is set → image-mode (background-image, neutral border)
   *   2. If hueOverride is a number (0-359) → use that color
   *   3. Else hash the name to derive a deterministic color
   *
   * The function tolerates being called with just (name) for legacy
   * call-sites that haven't been threaded through with image/hue yet.
   */
  function vendorAvatar(name, imageUrl, hueOverride) {
    const safeUrl = (imageUrl || '').trim();
    if (safeUrl) {
      const safeAttr = safeUrl.replace(/"/g, '%22');
      return `<div class="ord-vendor-avatar ord-vendor-avatar-img" style="background-image:url(&quot;${safeAttr}&quot;)" role="img" aria-label="${esc(name || '')}"></div>`;
    }
    const clean = (name || '').trim();
    const initial = clean.charAt(0).toUpperCase() || '?';
    let hue;
    if (typeof hueOverride === 'number' && hueOverride >= 0 && hueOverride < 360) {
      hue = hueOverride;
    } else {
      let hash = 0;
      for (let i = 0; i < clean.length; i++) {
        hash = ((hash << 5) - hash + clean.charCodeAt(i)) | 0;
      }
      hue = Math.abs(hash) % 360;
    }
    return `<div class="ord-vendor-avatar" style="--avatar-hue:${hue}">${esc(initial)}</div>`;
  }

  /**
   * Small gold pin icon shown in the corner of pinned vendor cards.
   * Decorative — the actual toggle lives in the vendor detail header.
   */
  function pinIndicator() {
    return `<span class="ord-vendor-pin" aria-label="Pinned" title="Pinned">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
        <path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
      </svg>
    </span>`;
  }

  /**
   * Parse the alt_emails column from the DB into a normalized array of
   * {email, kind} objects. Tolerant of three legacy formats:
   *   - null / undefined  → []
   *   - array of strings  → all marked 'cc'
   *   - array of objects  → passed through (validated/defaulted)
   * Unknown kinds default to 'cc' so they auto-include in sent orders.
   */
  /* alt_emails has two valid shapes — the parser handles both:

     LEGACY (array): [{email, kind}, …]
       Treated as applying to ALL locations. Pre-dates per-location
       profiles.

     NEW (object): { este: [...], toti: [...], suerte: [...], _default: [...] }
       Per-location lists. Each location has its own CC/BCC/Other.
       _default is used as fallback for locations without an explicit
       slice (e.g. brand-new locations the user hasn't configured yet).

     parseAltEmails(raw, location) returns the array of {email, kind}
     entries for the given location. Always returns an array. */
  function parseAltEmails(raw, location) {
    if (!raw) return [];

    // Legacy array shape — applies to every location.
    if (Array.isArray(raw)) {
      return raw.map(r => {
        if (typeof r === 'string') return { email: r.trim(), kind: 'cc' };
        if (r && typeof r === 'object') {
          const kind = ['cc', 'bcc', 'alt'].includes(r.kind) ? r.kind : 'cc';
          return { email: (r.email || '').trim(), kind };
        }
        return { email: '', kind: 'cc' };
      }).filter(r => r.email);
    }

    // New per-location object shape
    if (typeof raw === 'object') {
      const slice = (location && Array.isArray(raw[location])) ? raw[location]
                  : (Array.isArray(raw._default) ? raw._default : []);
      return parseAltEmails(slice);  // recurse on the array slice to normalize
    }

    return [];
  }

  /* Build the alt_emails write payload for saving. Preserves slices for
     OTHER locations while writing the active location's slice fresh.
     This is what makes the per-location editor non-destructive — saving
     Este's CCs doesn't wipe what you set up for Suerte.

     `existing` is the vendor's current alt_emails (any shape).
     `location` is the location whose slice we're updating.
     `entries` is the new array of {email, kind} for that location. */
  function writeAltEmailsForLocation(existing, location, entries) {
    const cleaned = (entries || []).filter(e => e && e.email);
    // Build the merged object. If existing is legacy array, we promote
    // it to _default and add the new location-specific slice on top.
    let next;
    if (Array.isArray(existing)) {
      next = { _default: existing.slice() };
    } else if (existing && typeof existing === 'object') {
      next = { ...existing };
    } else {
      next = {};
    }
    if (cleaned.length) {
      next[location] = cleaned;
    } else {
      delete next[location];
    }
    // If the object is now empty, return null so the column clears
    if (!Object.keys(next).length) return null;
    return next;
  }

  /* Has this vendor been customized for a non-active location? Used
     to badge the editor with a hint that other locations exist. */
  function vendorHasOtherLocationPrefs(vendor, currentLoc) {
    const raw = vendor && vendor.alt_emails;
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') return false;
    return Object.keys(raw).some(k => k !== currentLoc && k !== '_default' && Array.isArray(raw[k]) && raw[k].length);
  }

  /* ── Collapsible card shell for the vendor editor ──
   *   key       — stable identifier ('identity', 'recipients', etc.)
   *   title     — visible label in the card header
   *   isExpanded — initial state
   *   bodyHTML  — markup for the body
   *   danger    — when true, applies a red accent to the card border */
  function renderVendorCard(key, title, isExpanded, bodyHTML, danger) {
    return `
      <div class="ved-card${isExpanded ? '' : ' is-collapsed'}${danger ? ' ved-card-danger' : ''}" data-card="${esc(key)}">
        <button class="ved-card-head" type="button" data-card-toggle="${esc(key)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
          <span class="ved-card-title">${esc(title)}</span>
          <span class="ved-card-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </button>
        <div class="ved-card-body">${bodyHTML}</div>
      </div>
    `;
  }

  /* ── Recipient card body — TO + CC chips + BCC chips + Other ──
   * Replaces the older row-with-cycle-badge UI. Each kind has its own
   * dedicated chip area + Add button so the user can see at a glance
   * which addresses get CC'd vs BCC'd vs just stored.
   *   - TO    — vendor's primary email (single input, required for sending)
   *   - CC    — chips, every order auto-includes them
   *   - BCC   — chips, silent copies on every order
   *   - Other — chips for backups / seasonal contacts (NOT auto-sent) */
  function renderRecipientCardBody(vendor, recipients) {
    const list = Array.isArray(recipients) ? recipients : [];
    const cc  = list.filter(r => r.kind === 'cc');
    const bcc = list.filter(r => r.kind === 'bcc');
    const alt = list.filter(r => r.kind === 'alt');
    return `
      <div class="ord-form-field">
        <label class="ord-form-label" for="vedEmail">
          <span class="ved-rec-label-pill ved-rec-label-pill-to">TO</span>
          <span class="ord-form-label-hint">— primary recipient, required for sending</span>
        </label>
        <input type="email" class="ord-form-input" id="vedEmail" value="${esc(vendor.email || '')}" placeholder="orders@vendor.com" autocomplete="off" inputmode="email">
      </div>
      <div class="ved-recipient-section" data-kind="cc">
        <div class="ved-recipient-section-head">
          <span class="ved-rec-label-pill ved-rec-label-pill-cc">CC</span>
          <span class="ved-recipient-section-hint">always copied on every order</span>
        </div>
        <div class="ved-chips" data-kind="cc">${renderChipGroupContents(cc, 'cc')}</div>
      </div>
      <div class="ved-recipient-section" data-kind="bcc">
        <div class="ved-recipient-section-head">
          <span class="ved-rec-label-pill ved-rec-label-pill-bcc">BCC</span>
          <span class="ved-recipient-section-hint">silent copies — others can't see them</span>
        </div>
        <div class="ved-chips" data-kind="bcc">${renderChipGroupContents(bcc, 'bcc')}</div>
      </div>
      <div class="ved-recipient-section" data-kind="alt">
        <div class="ved-recipient-section-head">
          <span class="ved-rec-label-pill ved-rec-label-pill-alt">OTHER</span>
          <span class="ved-recipient-section-hint">stored only — NOT auto-sent (backups)</span>
        </div>
        <div class="ved-chips" data-kind="alt">${renderChipGroupContents(alt, 'alt')}</div>
      </div>
    `;
  }

  /* Inner contents of one chip group (chips + Add button). Kept separate
   * so a single group can be re-rendered after add/remove without
   * disturbing the rest of the card (and its inputs/focus). */
  function renderChipGroupContents(items, kind) {
    const chipsHTML = items.map(r => renderRecipientChip(r)).join('');
    const addLabel = kind === 'alt' ? 'Add backup contact'
                   : kind === 'bcc' ? 'Add BCC'
                   : 'Add CC';
    return `
      ${chipsHTML}
      <button class="ved-chip-add" type="button" data-add-kind="${esc(kind)}">
        ${plusIcon()}<span>${esc(addLabel)}</span>
      </button>
    `;
  }

  function renderRecipientChip(r) {
    return `
      <span class="ved-chip" data-email="${esc(r.email)}" data-kind="${esc(r.kind)}">
        <span class="ved-chip-text">${esc(r.email)}</span>
        <button class="ved-chip-remove" type="button" aria-label="Remove ${esc(r.email)}">×</button>
      </span>
    `;
  }

  /* Re-render just one chip group (cc / bcc / alt) from current state.
   * Used after add/remove so we don't blow away the email input above. */
  function refreshChipGroup(kind) {
    if (!editorState || !editorState.overlay) return;
    const wrap = editorState.overlay.querySelector(`.ved-chips[data-kind="${kind}"]`);
    if (!wrap) return;
    const items = (editorState.recipients || []).filter(r => r.kind === kind);
    wrap.innerHTML = renderChipGroupContents(items, kind);
    wireRecipientChipHandlers(editorState.overlay);   // re-bind on this group's new buttons
  }

  /* Wire all chip add/remove handlers in the recipients card. Idempotent —
   * stamps a flag so re-binds don't double up. */
  function wireRecipientChipHandlers(overlay) {
    if (!overlay) return;

    // Remove (×) on existing chips
    overlay.querySelectorAll('.ved-chip-remove').forEach(btn => {
      if (btn._chipBound) return;
      btn._chipBound = true;
      btn.addEventListener('click', () => {
        const chip = btn.closest('.ved-chip');
        if (!chip || !editorState) return;
        const email = chip.dataset.email;
        const kind  = chip.dataset.kind;
        editorState.recipients = (editorState.recipients || [])
          .filter(r => !(r.email === email && r.kind === kind));
        refreshChipGroup(kind);
      });
    });

    // Add button — replaces the button with an inline input. Enter or
    // blur commits the value; Escape cancels.
    overlay.querySelectorAll('.ved-chip-add').forEach(btn => {
      if (btn._chipBound) return;
      btn._chipBound = true;
      btn.addEventListener('click', () => {
        const kind = btn.dataset.addKind;
        const wrap = btn.parentElement;
        if (!wrap) return;
        // Inject inline input in place of the Add button
        const input = document.createElement('input');
        input.type = 'email';
        input.className = 'ved-chip-input';
        input.placeholder = kind === 'alt' ? 'name@email.com' : `${kind}@vendor.com`;
        input.autocomplete = 'off';
        input.inputMode = 'email';
        wrap.insertBefore(input, btn);
        btn.style.display = 'none';
        input.focus();

        const cancel = () => {
          input.remove();
          btn.style.display = '';
        };
        const commit = () => {
          const email = (input.value || '').trim();
          if (!email) { cancel(); return; }
          if (!isLikelyEmail(email)) {
            input.classList.add('ved-chip-input-invalid');
            input.focus();
            return;
          }
          // Avoid duplicates (same email + kind)
          const exists = (editorState.recipients || []).some(r =>
            r.email.toLowerCase() === email.toLowerCase() && r.kind === kind);
          if (!exists) {
            editorState.recipients = (editorState.recipients || []).slice();
            editorState.recipients.push({ email, kind });
          }
          refreshChipGroup(kind);
        };

        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          else if (e.key === ',' || e.key === ';') {
            e.preventDefault();
            commit();
            // After commit, refreshChipGroup re-creates the Add button.
            // Re-tap it programmatically so the user can chain entries.
            const newAdd = wrap.querySelector(`.ved-chip-add[data-add-kind="${kind}"]`);
            if (newAdd) newAdd.click();
          }
        });
        input.addEventListener('blur', () => {
          // Small delay so a tap on the (now-hidden) Add button doesn't
          // race the commit.
          setTimeout(() => {
            if (!input.isConnected) return;
            if (input.value.trim()) commit();
            else cancel();
          }, 80);
        });
      });
    });
  }

  /* Loose email check — accepts what most mail clients accept; not
   * RFC-strict (which is overkill for a UI guard). */
  function isLikelyEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
  }

  /* Legacy helper retained for back-compat — older code paths still
   * call renderRecipientRows() and recipientRowHTML(). They now no-op
   * for the chip UI but stay defined so nothing throws. */
  function renderRecipientRows(rawAltEmails) {
    const rows = parseAltEmails(rawAltEmails);
    if (!rows.length) return '';
    return rows.map((r, i) => recipientRowHTML(r, i)).join('');
  }

  function recipientRowHTML(row, index) {
    return `<span class="ved-chip" data-email="${esc(row.email)}" data-kind="${esc(row.kind)}">${esc(row.email)}</span>`;
  }

  /**
   * Read the current state of recipient rows from the DOM. Used by
   * saveVendor and by the "Add another" handler to preserve unsaved
   * input when re-rendering the list.
   */
  function readRecipientRows(container) {
    if (!container) return [];
    const rows = container.querySelectorAll('.ved-recipient-row');
    const out = [];
    rows.forEach(row => {
      const email = row.querySelector('.ved-recipient-email')?.value.trim() || '';
      const kindBtn = row.querySelector('.ved-recipient-kind');
      let kind = 'cc';
      if (kindBtn) {
        if (kindBtn.classList.contains('ved-recipient-kind-bcc')) kind = 'bcc';
        else if (kindBtn.classList.contains('ved-recipient-kind-alt')) kind = 'alt';
      }
      if (email) out.push({ email, kind });
    });
    return out;
  }

  /** Bind click handlers for kind-cycling and row-removal. */
  function wireRecipientRowsHandlers(container) {
    if (!container) return;
    container.querySelectorAll('[data-action="cycle-kind"]').forEach(btn => {
      btn.addEventListener('click', () => {
        // Cycle order: CC → BCC → ALT → CC
        const current = btn.classList.contains('ved-recipient-kind-bcc') ? 'bcc'
                      : btn.classList.contains('ved-recipient-kind-alt') ? 'alt'
                      : 'cc';
        const next = current === 'cc' ? 'bcc' : current === 'bcc' ? 'alt' : 'cc';
        btn.classList.remove('ved-recipient-kind-cc', 'ved-recipient-kind-bcc', 'ved-recipient-kind-alt');
        btn.classList.add(`ved-recipient-kind-${next}`);
        btn.textContent = next.toUpperCase();
        btn.setAttribute('aria-label', `Cycle recipient type (currently ${next.toUpperCase()})`);
      });
    });
    container.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.ved-recipient-row');
        if (!row) return;
        // Snapshot all rows except this one, then re-render.
        const all = readRecipientRows(container);
        const idx = parseInt(row.dataset.index, 10);
        all.splice(idx, 1);
        const fakeAlt = all.length ? all : [];
        container.innerHTML = renderRecipientRows(fakeAlt);
        wireRecipientRowsHandlers(container);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  async function init() {
    if (initialized) return;
    activeLoc = resolveLocation();
    syncMastheadHeight();
    renderShell();
    const [vList, counts, oList] = await Promise.all([
      loadVendors(),
      loadItemCounts(),
      loadRecentOrders(activeLoc),
    ]);
    vendors = vList;
    vendors._itemCounts = counts;
    recentOrders = oList;
    const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
    renderRecent(recentOrders, vmap);
    renderVendors();
    initialized = true;
  }

  /**
   * Measure the persistent masthead's actual rendered height and
   * publish it as `--nx-mast-h` on :root. Overlays use this to sit
   * exactly below the masthead instead of guessing at 53px (which is
   * outdated — the persona label below the coin makes the masthead
   * ~85-90px now). Re-measures via ResizeObserver so persona flips,
   * orientation changes, and dynamic content all stay correct.
   */
  function syncMastheadHeight() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const apply = () => {
      const h = nav.offsetHeight;
      if (h > 0) document.documentElement.style.setProperty('--nx-mast-h', h + 'px');
    };
    apply();
    if (window.ResizeObserver && !nav._ordMastObserver) {
      const ro = new ResizeObserver(apply);
      ro.observe(nav);
      nav._ordMastObserver = ro;
    }
    window.addEventListener('orientationchange', apply);
    // Catch the post-fonts-load layout state — the persona label below
    // the coin can shift the masthead height once fonts settle, and
    // any overlay opened before that fires would have used the wrong
    // value. Idempotent.
    if (!window._ordMastLoadHooked) {
      window.addEventListener('load', apply);
      window._ordMastLoadHooked = true;
    }
  }

  async function show() {
    if (!initialized) return init();
    recentOrders = await loadRecentOrders(activeLoc);
    const vmap = {}; vendors.forEach(v => vmap[v.id] = v);
    renderRecent(recentOrders, vmap);
    // Also re-render the vendor list — activity-preview lines and
    // draft-state highlighting depend on recentOrders and may be stale.
    renderVendors();
  }

  /* ════════════════════════════════════════════════════════════════════
     TRANSACTIONS — full-history subscreen of Duties
     ────────────────────────────────────────────────────────────────────
     The home pulse shows a slice of recent orders for quick scanning.
     This view is the canonical history: every order at the active
     location, filterable by status (including archived), searchable,
     paginated. The shape becomes the template for cleaning's history
     view — same pill component, same time-grouping, same row pattern,
     just different status keys + label text per module.
     ════════════════════════════════════════════════════════════════════ */

  const TX_PAGE_SIZE = 50;
  const TX_STATUS_PILLS = [
    { id: 'all',       label: 'All' },
    { id: 'draft',     label: 'Drafts' },
    { id: 'sent',      label: 'Sent' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'delivered', label: 'Delivered' },
    { id: 'closed',    label: 'Closed' },
    { id: 'archived',  label: 'Archived' },
  ];

  let txState = {
    status: 'all',
    search: '',
    orders: [],
    counts: {},
    loading: false,
    hasMore: true,
  };

  /* Local fmtRel — same shape as the one in renderRecent's closure.
     Duplicated rather than extracted because that function is well-
     tested in the home pulse and I don't want to touch its scope. */
  function txFmtRel(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)  return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  async function openTransactionsView() {
    closeTransactionsView();

    const overlay = document.createElement('div');
    overlay.className = 'ord-tx-overlay';
    overlay.id = 'ordTxOverlay';
    overlay.innerHTML = renderTxShell();
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('is-open'));

    txState = { status: 'all', search: '', orders: [], counts: {}, loading: false, hasMore: true };
    wireTxOverlay(overlay);

    setTxLoading(overlay, true);
    await Promise.all([
      loadTxCounts(),
      loadTxPage(false),
    ]);
    setTxLoading(overlay, false);

    renderTxPills(overlay);
    renderTxList(overlay);
  }

  function closeTransactionsView() {
    const overlay = document.getElementById('ordTxOverlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 220);
    }
  }

  function renderTxShell() {
    const locLabel = (LOCS.find(l => l.id === activeLoc) || {}).label || activeLoc;
    return `
      <div class="ord-tx-backdrop"></div>
      <div class="ord-tx-sheet">
        <header class="ord-tx-header">
          <button class="ord-tx-back" aria-label="Back" data-tx-action="back">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="ord-tx-title-wrap">
            <h2 class="ord-tx-title">Transactions</h2>
            <span class="ord-tx-loc-label">${esc(locLabel)}</span>
          </div>
        </header>
        <div class="ord-tx-pills" id="ordTxPills"></div>
        <div class="ord-tx-search-wrap">
          <input type="search" class="ord-tx-search" id="ordTxSearch" placeholder="Search order #, vendor…" autocomplete="off" spellcheck="false" inputmode="search">
        </div>
        <div class="ord-tx-list" id="ordTxList">
          <div class="ord-tx-loading">Loading transactions…</div>
        </div>
      </div>
    `;
  }

  function setTxLoading(overlay, isLoading) {
    txState.loading = isLoading;
    const list = overlay.querySelector('#ordTxList');
    if (list) list.classList.toggle('is-loading', isLoading);
  }

  /* Run 7 head-only count queries in parallel. Each is cheap (Postgres
     does count(*) on an indexed column with a small filter set). On
     mobile this typically lands in 200-400ms total. */
  async function loadTxCounts() {
    if (!NX.sb) return;
    const base = () => NX.sb.from('orders').select('id', { count: 'exact', head: true }).eq('location', activeLoc);
    try {
      const [all, draft, sent, confirmed, delivered, closed, archived] = await Promise.all([
        base().is('archived_at', null),
        base().is('archived_at', null).eq('status', 'draft'),
        base().is('archived_at', null).eq('status', 'sent'),
        base().is('archived_at', null).eq('status', 'confirmed'),
        base().is('archived_at', null).eq('status', 'delivered'),
        base().is('archived_at', null).eq('status', 'closed'),
        base().not('archived_at', 'is', null),
      ]);
      txState.counts = {
        all: all.count || 0,
        draft: draft.count || 0,
        sent: sent.count || 0,
        confirmed: confirmed.count || 0,
        delivered: delivered.count || 0,
        closed: closed.count || 0,
        archived: archived.count || 0,
      };
    } catch (e) {
      console.error('[ordering] loadTxCounts:', e);
    }
  }

  /* Cursor-paginate by updated_at desc. Each call returns up to
     TX_PAGE_SIZE rows; if exactly that many, hasMore stays true and
     subsequent calls add `.lt(updated_at, lastSeen)` to skip already-
     loaded rows. Filter the status server-side so the page is dense. */
  async function loadTxPage(append) {
    if (!NX.sb) return;
    let q = NX.sb.from('orders')
      .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at, updated_at, created_by_name, sent_by_name, confirmed_at, delivered_at, closed_at, issue_at, issue_note, archived_at')
      .eq('location', activeLoc)
      .order('updated_at', { ascending: false })
      .limit(TX_PAGE_SIZE);

    if (txState.status === 'archived') {
      q = q.not('archived_at', 'is', null);
    } else {
      q = q.is('archived_at', null);
      if (txState.status !== 'all') q = q.eq('status', txState.status);
    }

    if (append && txState.orders.length) {
      const last = txState.orders[txState.orders.length - 1];
      if (last.updated_at) q = q.lt('updated_at', last.updated_at);
    }

    try {
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      txState.orders = append ? [...txState.orders, ...rows] : rows;
      txState.hasMore = rows.length === TX_PAGE_SIZE;
    } catch (e) {
      console.error('[ordering] loadTxPage:', e);
    }
  }

  function renderTxPills(overlay) {
    const el = overlay.querySelector('#ordTxPills');
    if (!el) return;
    el.innerHTML = TX_STATUS_PILLS.map(p => {
      const count = txState.counts[p.id] != null ? txState.counts[p.id] : '';
      const active = txState.status === p.id;
      return `
        <button class="ord-tx-pill${active ? ' active' : ''}" data-tx-status="${esc(p.id)}">
          <span>${esc(p.label)}</span>
          ${count !== '' ? `<span class="ord-tx-pill-count">${count}</span>` : ''}
        </button>
      `;
    }).join('');
  }

  function renderTxList(overlay) {
    const el = overlay.querySelector('#ordTxList');
    if (!el) return;

    // Search filter applied to loaded orders only. If the user wants
    // historic orders that aren't loaded, they need to load more first.
    // Could add server-side search later if it becomes a real ergonomic
    // problem, but for now client-side is fine for the page-by-page UX.
    const search = (txState.search || '').toLowerCase().trim();
    const filtered = !search ? txState.orders : txState.orders.filter(o => {
      const v = vendors.find(x => x.id === o.vendor_id);
      const vendorName = (v ? v.name : '').toLowerCase();
      const id = (o.id || '').toLowerCase();
      const shortId = id.slice(-8);
      return vendorName.includes(search) || id.includes(search) || shortId.includes(search);
    });

    if (!filtered.length && !txState.loading) {
      el.innerHTML = `<div class="ord-tx-empty">${search ? 'No orders match your search.' : 'No orders to show.'}</div>`;
      return;
    }

    // Time buckets — extended for the longer history view (months go
    // out as their own buckets so 6 months back you scroll past
    // FEBRUARY 2025, JANUARY 2025, etc.).
    const bucketOf = ts => {
      if (!ts) return 'older';
      const d = new Date(ts), now = new Date();
      if (d.toDateString() === now.toDateString()) return 'today';
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
      const diff = (now - d) / 86400000;
      if (diff < 7)  return 'thisweek';
      if (diff < 30) return 'thismonth';
      const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
      return `month:${d.getFullYear()}-${mon}`;
    };
    const bucketLabel = b => {
      if (b === 'today') return 'TODAY';
      if (b === 'yesterday') return 'YESTERDAY';
      if (b === 'thisweek') return 'EARLIER THIS WEEK';
      if (b === 'thismonth') return 'EARLIER THIS MONTH';
      if (b.startsWith('month:')) {
        const [, ym] = b.split(':');
        const [year, mon] = ym.split('-');
        return `${mon.toUpperCase()} ${year}`;
      }
      return 'OLDER';
    };

    let lastBucket = null;
    const rowsHTML = filtered.map(o => {
      const v = vendors.find(x => x.id === o.vendor_id);
      // Archived orders display "archived" as their status pill, even
      // if the underlying status is e.g. "sent" — what matters for
      // visual scanning is the archive state, not the previous lifecycle.
      const status = o.archived_at ? 'archived' : (o.status || 'draft');
      const when = txFmtRel(o.updated_at || o.created_at);
      const deliv = o.delivery_date ? fmtDateShort(o.delivery_date) : '';
      const bucket = bucketOf(o.updated_at || o.created_at);
      let dividerHTML = '';
      if (bucket !== lastBucket) {
        dividerHTML = `<div class="ord-tx-divider">${esc(bucketLabel(bucket))}</div>`;
        lastBucket = bucket;
      }
      const avatarHTML = v
        ? vendorAvatar(v.name, v.image_url, v.avatar_hue)
        : `<div class="ord-vendor-avatar ord-vendor-avatar-unknown">?</div>`;
      const shortId = (o.id || '').slice(-8).toUpperCase();
      return `${dividerHTML}
        <button class="ord-tx-row" data-tx-order-id="${esc(o.id)}">
          <div class="ord-tx-row-avatar">${avatarHTML}</div>
          <div class="ord-tx-row-main">
            <div class="ord-tx-row-top">
              <span class="ord-tx-row-vendor">${esc(v ? v.name : 'Unknown vendor')}</span>
              <span class="ord-tx-row-shortid">#${esc(shortId)}</span>
            </div>
            <div class="ord-tx-row-meta">
              <span class="ord-status ord-status-${esc(status)}">${esc(status)}</span>
              ${deliv ? `<span class="ord-tx-row-deliv">· deliver ${esc(deliv)}</span>` : ''}
              <span class="ord-tx-row-when">· ${esc(when)}</span>
            </div>
          </div>
          <div class="ord-arrow" aria-hidden="true">›</div>
        </button>`;
    }).join('');

    const moreHTML = txState.hasMore && !search
      ? `<button class="ord-tx-load-more" type="button" data-tx-action="load-more">Load more</button>`
      : (txState.orders.length && !search && !txState.hasMore
          ? `<div class="ord-tx-end">— end of history —</div>`
          : '');

    el.innerHTML = rowsHTML + moreHTML;

    el.querySelectorAll('.ord-tx-row').forEach(r => {
      r.addEventListener('click', () => {
        const id = r.dataset.txOrderId;
        if (id) openExistingOrder(id);
      });
    });
    el.querySelector('[data-tx-action="load-more"]')?.addEventListener('click', async () => {
      setTxLoading(overlay, true);
      const btn = el.querySelector('[data-tx-action="load-more"]');
      if (btn) btn.textContent = 'Loading…';
      await loadTxPage(true);
      setTxLoading(overlay, false);
      renderTxList(overlay);
    });
  }

  function wireTxOverlay(overlay) {
    overlay.querySelector('.ord-tx-backdrop')?.addEventListener('click', closeTransactionsView);
    overlay.querySelector('[data-tx-action="back"]')?.addEventListener('click', closeTransactionsView);

    // Pill clicks — switch status, refetch first page
    overlay.addEventListener('click', async e => {
      const pill = e.target.closest('[data-tx-status]');
      if (!pill || !overlay.contains(pill)) return;
      const newStatus = pill.dataset.txStatus;
      if (newStatus === txState.status) return;
      txState.status = newStatus;
      txState.orders = [];
      txState.hasMore = true;
      renderTxPills(overlay);
      const list = overlay.querySelector('#ordTxList');
      if (list) list.innerHTML = `<div class="ord-tx-loading">Loading…</div>`;
      setTxLoading(overlay, true);
      await loadTxPage(false);
      setTxLoading(overlay, false);
      renderTxList(overlay);
    });

    // Search — debounced
    const search = overlay.querySelector('#ordTxSearch');
    if (search) {
      let t = null;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          txState.search = search.value;
          renderTxList(overlay);
        }, 150);
      });
    }
  }


  NX.modules.ordering = {
    init, show, setLocation, openVendor, openExistingOrder, closeEntry,
    openVendorEditor,
    openVendorDetail, closeVendorDetail,
    openOrderDetail, closeOrderDetail, reorderFromOrder, reportIssuesOnOrder,
    openTransactionsView, closeTransactionsView,
  };
  console.log('[ordering] loaded (Phase B — vendor + item management)');
})();
