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

  // Vendor sort state.
  //   'alpha'   = alphabetical by name (default)
  //   'custom'  = manual sort_order column from DB
  //   'recent'  = most recently ordered/active first
  //   'busiest' = most ordered (frequency over the last 30 orders)
  // Persisted to localStorage. Pinned vendors always float to the top
  // regardless of mode, in their own internal sort order.
  const VENDOR_SORT_KEY = 'nexus_ordering_vendor_sort';
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
      return VENDOR_SORT_MODES.includes(v) ? v : 'alpha';
    } catch (_) { return 'alpha'; }
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

  /** Best initial delivery date — the next day in vendor.delivery_days. */
  function nextDeliveryDate(vendor) {
    const days = Array.isArray(vendor && vendor.delivery_days) ? vendor.delivery_days : [];
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
    // First try the full select with the new columns (image_url,
    // avatar_hue, pinned). If those columns haven't been migrated yet,
    // fall back to the legacy column set so the app still works — the
    // missing fields will just render as null/false everywhere.
    let { data, error } = await NX.sb
      .from('order_vendors')
      .select('id, name, alias_short, email, alt_emails, managed_by, role, delivery_days, subject_template, body_template, notes, archived, image_url, avatar_hue, pinned, sort_order')
      .eq('archived', false)
      .order('pinned', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) {
      // Most likely cause: a missing column. Log and retry without it.
      console.warn('[ordering] loadVendors with new columns failed, falling back:', error.message || error);
      const fallback = await NX.sb
        .from('order_vendors')
        .select('id, name, alias_short, email, alt_emails, managed_by, role, delivery_days, subject_template, body_template, notes, archived')
        .eq('archived', false)
        .order('name', { ascending: true });
      if (fallback.error) { console.error('[ordering] loadVendors fallback:', fallback.error); return []; }
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
      .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at, updated_at, created_by_name, sent_by_name, confirmed_at, delivered_at, closed_at, issue_at, issue_note')
      .eq('location', location)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) {
      // Fallback: new lifecycle columns may not exist yet. Retry with the
      // legacy SELECT so the activity preview still works pre-migration.
      console.warn('[ordering] loadRecentOrders new cols failed, falling back:', error.message || error);
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
    const { data, error } = await NX.sb
      .from('order_guide_items')
      .select('id, item_name, vendor_sku, section, unit, default_par_qty, pars_by_day, note, sort_order')
      .eq('vendor_id', vendorId)
      .eq('archived', false)
      .order('sort_order', { ascending: true });
    if (error) { console.error('[ordering] loadVendorCatalog:', error); return []; }
    return data || [];
  }

  async function loadParOverrides(vendorId, location) {
    if (!NX.sb) return {};
    const { data: items, error: e1 } = await NX.sb
      .from('order_guide_items').select('id').eq('vendor_id', vendorId);
    if (e1 || !items || !items.length) return {};
    const itemIds = items.map(i => i.id);
    const { data, error } = await NX.sb
      .from('order_guide_pars')
      .select('item_id, pars_by_day, enabled')
      .eq('location', location)
      .in('item_id', itemIds);
    if (error) { console.error('[ordering] loadParOverrides:', error); return {}; }
    const map = {};
    (data || []).forEach(row => { map[row.item_id] = row; });
    return map;
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
      <div class="ord-recent" id="ordRecent"></div>
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

  function renderRecent(list, vendorMap) {
    const el = document.getElementById('ordRecent');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div class="ord-section-label">Recent</div><div class="ord-empty">No recent orders for ${esc(activeLoc)}.</div>`;
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

    // Slice the list based on collapsed / expanded mode.
    //   Collapsed: first 3.
    //   Expanded:  page-windowed slice of 10.
    let visible, totalPages, controlsHTML;
    if (!recentExpanded) {
      visible = list.slice(0, RECENT_COLLAPSED_COUNT);
      const hidden = list.length - visible.length;
      controlsHTML = hidden > 0
        ? `<button class="ord-recent-more" id="ordRecentMore" type="button" aria-label="Show more orders">
             <span>${hidden} more</span>
             <span class="ord-recent-more-arrow" aria-hidden="true">↓</span>
           </button>`
        : '';
    } else {
      const start = recentPage * RECENT_PAGE_SIZE;
      visible = list.slice(start, start + RECENT_PAGE_SIZE);
      totalPages = Math.ceil(list.length / RECENT_PAGE_SIZE);
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
    // date changes. Buckets, in order: today, yesterday, this-week, older.
    // The divider is only rendered when the bucket changes from the row
    // above — if every row is in "older", you get one "OLDER" header at
    // the top and no further dividers below.
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
      return `${dividerHTML}
        <button class="ord-recent-row" data-order-id="${esc(o.id)}">
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
      <div class="ord-section-label">Recent</div>
      ${rowsHTML}
      ${controlsHTML}
    `;

    el.querySelectorAll('.ord-recent-row').forEach(b => {
      b.addEventListener('click', () => openExistingOrder(b.dataset.orderId));
    });

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
        if (recentPage < totalPages - 1) { recentPage += 1; renderRecent(recentOrders, vendorMap); }
      });
    }
  }

  function renderVendors() {
    const el = document.getElementById('ordVendors');
    if (!el) return;
    if (!vendors.length) {
      el.innerHTML = `<div class="ord-empty">No vendors yet. Tap + to add your first one.</div>`;
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
    // Within their group, pinned vendors sort by sort_order (custom-set
    // order from the user, falling back to name). Within unpinned, the
    // active sort mode applies.
    const sorted = vendors.slice().sort((a, b) => {
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
        preview = itemCount ? `${itemCount} item${itemCount === 1 ? '' : 's'} in catalog` : 'No catalog yet';
      }

      const rowClasses = ['ord-vendor-row'];
      if (isDraft)  rowClasses.push('has-draft');
      if (hasIssue) rowClasses.push('has-issue');
      if (v.pinned) rowClasses.push('is-pinned');
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
        const action = btn.dataset.action;
        close();
        if (action === 'edit')         openVendorEditor(vendor);
        else if (action === 'catalog') openCatalogEditor(vendor);
        else if (action === 'order')   openVendor(vendor.id);
        else if (action === 'archive') archiveVendorById(vendor.id, vendor.name);
      });
    });
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
      .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at, updated_at, created_by_name, sent_by_name, confirmed_at, delivered_at, closed_at, issue_at, issue_note')
      .eq('vendor_id', vendorId)
      .eq('location', location)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[ordering] loadVendorOrders new cols failed, falling back:', error.message || error);
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
    };

    renderVendorDetail();   // initial paint with loading state

    try {
      const orders = await loadVendorOrders(vendor.id, activeLoc);
      if (!detailState || detailState.overlay !== overlay) return;  // user closed before load completed
      detailState.orders = orders;
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
    const { vendor, orders, ordersLoading, hasDraft, overlay } = detailState;

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

    // Sticky CTA: "Continue order →" if draft exists, else "Start new order →"
    const ctaLabel = hasDraft ? 'Continue order' : 'Start new order';
    const footerHTML = `
      <div class="ord-vdetail-foot">
        <button class="ord-vdetail-cta" data-action="start-order">
          <span>${ctaLabel}</span>
          <span class="ord-vdetail-cta-arrow" aria-hidden="true">→</span>
        </button>
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
    overlay.querySelector('[data-action="start-order"]').addEventListener('click', () => {
      const vid = vendor.id;
      closeVendorDetail();
      openVendor(vid);
    });
    overlay.querySelectorAll('.ord-recent-row').forEach(b => {
      b.addEventListener('click', () => {
        const oid = b.dataset.orderId;
        closeVendorDetail();
        openExistingOrder(oid);
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
          const name = l.item_name || '(unnamed item)';
          const note = l.note ? `<div class="ord-odetail-line-note">${esc(l.note)}</div>` : '';
          return `
            <div class="ord-odetail-line">
              <div class="ord-odetail-line-qty">${esc(qtyDisplay)}</div>
              <div class="ord-odetail-line-body">
                <div class="ord-odetail-line-name">${esc(name)}</div>
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
            <div class="${cls.join(' ')}">
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
      delivery_date: nextDeliveryDate(vendor),
      notes:         '',
      lines:         {},
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
    const lineList = lines.length
      ? '\n\nItems on this order:\n' + lines.map(l => `  [ ] ${l.qty || 0} ${l.unit || ''} — ${l.item_name}`).join('\n')
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
      console.warn('[ordering] flagOrderIssue:', error.message || error);
      return;
    }
    Object.assign(order, update);
    renderOrderDetail();
  }

  /** Clear an outstanding issue once the user marks it resolved. */
  async function resolveOrderIssue(order) {
    if (!order || !NX.sb) return;
    const update = { issue_at: null, issue_note: null };
    const { error } = await NX.sb.from('orders').update(update).eq('id', order.id);
    if (error) {
      console.error('[ordering] resolveOrderIssue:', error);
      if (NX.toast) NX.toast('Could not clear issue: ' + (error.message || ''), 'error');
      return;
    }
    Object.assign(order, update);
    if (NX.toast) NX.toast('Issue cleared', 'info', 1200);
    renderOrderDetail();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2 — ORDER ENTRY OVERLAY
  // ═══════════════════════════════════════════════════════════════════

  /** Open the entry overlay for a vendor. Continues an existing draft if present. */
  async function openVendor(vendorId) {
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
      delivery_date: nextDeliveryDate(vendor),
      notes: '', lines: {},
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
      renderEntryItems();
    } catch (e) {
      console.error('[ordering] openVendor:', e);
      if (NX.toast) NX.toast('Failed to load vendor catalog', 'error');
    }
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
      delivery_date: order.delivery_date || nextDeliveryDate(vendor),
      notes:         order.notes || '',
      lines:         {},
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
    return { qty, label: `par: ${qty} ${unit}${wkLbl ? ' ' + wkLbl : ''}` };
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

    // Group catalog by section (preserve sort_order within)
    const groups = new Map();
    for (const it of catalog) {
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
          <div class="ord-entry-sub">${esc(LOCS.find(l => l.id === location)?.label || location)}${readOnly ? ' · sent order' : ''}</div>
        </div>
        ${readOnly ? '<div class="ord-entry-spacer"></div>' : `<button class="ord-entry-add" id="ordEntryAdd" aria-label="Add item to catalog">${plusIcon(true)}</button>`}
      </div>
      <div class="ord-entry-meta">
        <label class="ord-meta-field">
          <span class="ord-meta-label">Delivery</span>
          <input type="date" id="ordDeliveryDate" value="${esc(delivery_date || '')}" ${readOnly ? 'disabled' : ''}>
        </label>
      </div>
      <div class="ord-entry-search-wrap">
        <input type="search" class="ord-entry-search" id="ordEntrySearch" placeholder="Search items…" autocomplete="off" spellcheck="false">
      </div>
      <div class="ord-entry-list" id="ordEntryList">
        ${sections.map(sec => `
          <div class="ord-entry-section">
            ${sec ? `<div class="ord-entry-section-label">${esc(sec)}</div>` : ''}
            ${groups.get(sec).map(it => itemRowHtml(it, lines[it.id], delivery_date, location, readOnly)).join('')}
          </div>
        `).join('')}
        ${catalog.length === 0 ? `
          <div class="ord-empty">
            This vendor has no catalog yet.<br>
            <span style="font-size:11px;opacity:0.7">Items can be added from the vendor editor (coming soon).</span>
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
    overlay.querySelector('#ordDeliveryDate').addEventListener('change', e => {
      entryState.delivery_date = e.target.value;
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

    if (!entryState._escWired) {
      const escHandler = e => {
        if (e.key === 'Escape' && document.body.classList.contains('ord-overlay-open')) closeEntry();
      };
      document.addEventListener('keydown', escHandler);
      entryState._escWired = true;
      entryState._escHandler = escHandler;
    }
  }

  function itemRowHtml(item, line, deliveryDate, location, readOnly) {
    const hint = parHintFor(item, deliveryDate, location);
    if (hint.disabled) {
      return `
        <div class="ord-item-row is-disabled" data-item-id="${esc(item.id)}" data-item-name="${esc(item.item_name).toLowerCase()}">
          <div class="ord-item-main">
            <div class="ord-item-name">${esc(item.item_name)}</div>
            <div class="ord-item-meta">not stocked at ${esc(location)}</div>
          </div>
        </div>`;
    }
    const qty = (line && line.qty) || 0;
    const meta = [];
    if (item.vendor_sku) meta.push(`SKU ${esc(item.vendor_sku)}`);
    if (hint.label) meta.push(esc(hint.label));
    if (item.note) meta.push(esc(item.note));
    return `
      <div class="ord-item-row${qty > 0 ? ' has-qty' : ''}" data-item-id="${esc(item.id)}" data-item-name="${esc(item.item_name).toLowerCase()}">
        <div class="ord-item-main">
          <div class="ord-item-name">${esc(item.item_name)}</div>
          ${meta.length ? `<div class="ord-item-meta">${meta.join(' · ')}</div>` : ''}
        </div>
        <div class="ord-qty">
          <button class="ord-qty-btn" data-action="dec" aria-label="Decrease" ${readOnly ? 'disabled' : ''}>−</button>
          <input class="ord-qty-input" type="number" min="0" step="1" inputmode="numeric" value="${qty || ''}" placeholder="0" ${readOnly ? 'readonly' : ''}>
          <button class="ord-qty-btn" data-action="inc" aria-label="Increase" ${readOnly ? 'disabled' : ''}>+</button>
        </div>
        <div class="ord-item-unit">${esc(item.unit || 'ea')}</div>
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

    function applyQty(qty) {
      qty = Math.max(0, parseFloat(qty) || 0);
      if (qty === 0) {
        delete entryState.lines[id];
        row.classList.remove('has-qty');
        inp.value = '';
      } else {
        entryState.lines[id] = {
          qty,
          unit: item.unit || 'ea',
          item_name: item.item_name,
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
          item_name: l.item_name, vendor_sku: l.vendor_sku,
          qty: l.qty, unit: l.unit, note: l.note, sort_order: i,
        }));
      if (lineRows.length) {
        const { error: insErr } = await NX.sb.from('order_lines').insert(lineRows);
        if (insErr) throw insErr;
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
      delivery_date: nextDeliveryDate(entryState.vendor),
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
            ${list.map(l => `
              <div class="ord-review-line">
                <div class="ord-review-qty">${esc(l.qty)} ${esc(l.unit || 'ea')}</div>
                <div class="ord-review-name">
                  ${esc(l.item_name)}
                  ${l.vendor_sku ? `<span class="ord-review-sku">${esc(l.vendor_sku)}</span>` : ''}
                </div>
              </div>
            `).join('')}
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

    // Build the formatted line list once — same for both default and
    // custom templates. {lines} in custom templates expands to this.
    let linesText = '';
    let lastSection = null;
    for (const l of linesArr) {
      if (l.section && l.section !== lastSection) {
        linesText += `\n${l.section.toUpperCase()}\n`;
        lastSection = l.section;
      }
      const qtyUnit = `${l.qty} ${l.unit || 'ea'}`.padEnd(8);
      const sku = l.vendor_sku ? `  [${l.vendor_sku}]` : '';
      linesText += `  ${qtyUnit}  ${l.item_name}${sku}\n`;
    }
    linesText = linesText.replace(/^\n+/, '');  // trim leading blank from first section

    // If the vendor has a custom body_template, expand its tokens.
    // Otherwise use the standard hi-team / please-prepare / lines format.
    if (vendor.body_template && vendor.body_template.trim()) {
      let body = vendor.body_template
        .replace(/\{vendor\}/gi,             ctx.vendor)
        .replace(/\{location\}/gi,           ctx.location)
        .replace(/\{delivery_date_long\}/gi, ctx.delivery_date_long)
        .replace(/\{delivery_date\}/gi,      ctx.delivery_date)
        .replace(/\{date\}/gi,               ctx.delivery_date)
        .replace(/\{lines\}/gi,              linesText.trimEnd())
        .replace(/\{notes\}/gi,              (notes || '').trim());
      return body + '\n';
    }

    // Default template
    let body = `Hi ${vendor.name} team,\n\n`;
    body += `Please prepare for ${ctx.delivery_date_long} delivery to ${ctx.location}:\n\n`;
    body += linesText;
    if (notes && notes.trim()) {
      body += `\nNotes: ${notes.trim()}\n`;
    }
    body += `\nThanks,\n`;
    return body;
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
            item_name: l.item_name, vendor_sku: l.vendor_sku,
            qty: l.qty, unit: l.unit, note: l.note, sort_order: i,
          }));
        if (lineRows.length) await NX.sb.from('order_lines').insert(lineRows);
      }
    } catch (e) {
      console.error('[ordering] mark sent:', e);
      if (NX.toast) NX.toast('Could not save order — sending email anyway', 'warn', 3000);
    }

    // Open mailto: with CC + BCC pulled from the vendor's recipient list.
    // Recipients marked 'alt' are NOT auto-included (manual-only by design).
    const recipients = parseAltEmails(vendor.alt_emails);
    const ccList  = recipients.filter(r => r.kind === 'cc').map(r => r.email);
    const bccList = recipients.filter(r => r.kind === 'bcc').map(r => r.email);
    const url = buildMailtoUrl(vendor.email, subject, body, ccList, bccList);
    window.location.href = url;

    setTimeout(() => {
      closeEntry();
      show().catch(() => {});
      if (NX.toast) NX.toast('Order sent — check your mail app', 'info', 3000);
    }, 600);
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
  async function openVendorEditor(vendor) {
    const isNew = !vendor;
    editorState = {
      isNew,
      vendor: isNew
        ? { name: '', email: '', alt_emails: [], image_url: '', avatar_hue: null, pinned: false, delivery_days: [], subject_template: '', body_template: '', notes: '' }
        : { ...vendor },
      itemCount: null,           // count for the "Manage catalog" CTA — fetched async
      overlay: null,
    };
    mountVendorEditor();
    renderVendorEditor();             // render immediately — no blank flash
    if (!isNew) {
      // Just fetch the count for the CTA chip; full catalog is loaded
      // by the dedicated catalog editor.
      try {
        const { count } = await NX.sb
          .from('order_guide_items')
          .select('id', { count: 'exact', head: true })
          .eq('vendor_id', vendor.id)
          .eq('archived', false);
        editorState.itemCount = count || 0;
      } catch (e) {
        console.error('[ordering] count items for editor:', e);
        editorState.itemCount = null;
      }
      renderVendorEditor();
    }
  }

  function mountVendorEditor() {
    let el = document.querySelector('.ord-veditor-overlay');
    if (!el) {
      syncMastheadHeight();         // re-measure right before positioning
      el = document.createElement('div');
      el.className = 'ord-veditor-overlay';
      document.body.appendChild(el);
      document.body.classList.add('ord-overlay-open');
    }
    editorState.overlay = el;
  }

  function renderVendorEditor() {
    if (!editorState || !editorState.overlay) return;
    const v = editorState.vendor;
    const isNew = editorState.isNew;
    const days = Array.isArray(v.delivery_days) ? v.delivery_days : [];

    // Items section is now its own dedicated editor. Vendor editor only
    // surfaces a button to open it + a quick item count.
    const itemCountLabel = isNew
      ? null
      : (editorState.itemCount == null
          ? 'Loading…'
          : `${editorState.itemCount} item${editorState.itemCount === 1 ? '' : 's'}`);
    const itemsHTML = isNew
      ? `
        <div class="ved-section-divider"><span>Catalog</span></div>
        <div class="ved-catalog-cta ved-catalog-cta-disabled">
          <div class="ved-catalog-cta-icon">${listIcon()}</div>
          <div class="ved-catalog-cta-main">
            <div class="ved-catalog-cta-title">Catalog comes after</div>
            <div class="ved-catalog-cta-sub">Save the vendor first, then manage its catalog.</div>
          </div>
        </div>
      `
      : `
        <div class="ved-section-divider">
          <span>Catalog</span>
          ${editorState.itemCount != null ? `<span class="ved-section-divider-count">${editorState.itemCount}</span>` : ''}
        </div>
        <button class="ved-catalog-cta" id="vedManageCatalog" type="button">
          <div class="ved-catalog-cta-icon">${listIcon()}</div>
          <div class="ved-catalog-cta-main">
            <div class="ved-catalog-cta-title">Manage catalog</div>
            <div class="ved-catalog-cta-sub">${esc(itemCountLabel || '')} · sections, items, reorder</div>
          </div>
          <div class="ved-catalog-cta-arrow" aria-hidden="true">›</div>
        </button>
      `;

    editorState.overlay.innerHTML = `
      <div class="ord-veditor-head">
        <button class="ord-veditor-close" aria-label="Close">${arrowLeftIcon()}</button>
        <div class="ord-veditor-title-block">
          <div class="ord-veditor-title">${isNew ? 'New vendor' : esc(v.name) || 'Edit vendor'}</div>
          ${!isNew && v.email ? `<div class="ord-veditor-subtitle">${esc(v.email)}</div>` : ''}
          ${!isNew && !v.email ? '<div class="ord-veditor-subtitle ord-veditor-subtitle-warn">No email set</div>' : ''}
        </div>
        ${!isNew && editorState.itemCount != null ? `<div class="ord-veditor-count-chip">${editorState.itemCount}<span>${editorState.itemCount === 1 ? 'item' : 'items'}</span></div>` : '<div class="ord-veditor-spacer"></div>'}
      </div>
      <div class="ord-veditor-body">

        <div class="ved-section-divider"><span>Vendor</span></div>
        <div class="ved-vendor-head">
          <button type="button" class="ved-avatar-btn" id="vedAvatarBtn" aria-label="Upload vendor photo from device">
            <div class="ved-avatar-preview" id="vedAvatarPreview" aria-hidden="true">
              ${vendorAvatar(v.name, v.image_url, v.avatar_hue)}
            </div>
            <span class="ved-avatar-badge" aria-hidden="true">${cameraIcon()}</span>
          </button>
          <input type="file" id="vedImageFile" accept="image/*" hidden>
          <div class="ved-vendor-head-fields">
            <div class="ord-form-field">
              <label class="ord-form-label" for="vedName">Name</label>
              <input type="text" class="ord-form-input" id="vedName" value="${esc(v.name)}" placeholder="e.g. Farm To Table" autocomplete="off">
            </div>
            <div class="ord-form-field">
              <label class="ord-form-label" for="vedEmail">Primary email <span class="ord-form-label-hint">— required for sending orders</span></label>
              <input type="email" class="ord-form-input" id="vedEmail" value="${esc(v.email || '')}" placeholder="orders@vendor.com" autocomplete="off" inputmode="email">
            </div>
          </div>
        </div>
        <div class="ord-form-field">
          <label class="ord-form-label">Additional recipients <span class="ord-form-label-hint">— CC / BCC / alternate. Tap the badge to cycle.</span></label>
          <div class="ved-recipients" id="vedRecipients">
            ${renderRecipientRows(v.alt_emails || [])}
          </div>
          <button type="button" class="ved-recipient-add-btn" id="vedRecipientAdd">
            ${plusIcon()}<span>Add another recipient</span>
          </button>
          <div class="ord-form-hint">Each row can be marked CC, BCC, or ALT. CC and BCC recipients are automatically included when you send an order. ALT recipients aren't auto-included — useful for storing backups or seasonal contacts.</div>
        </div>
        <div class="ord-form-field">
          <label class="ord-form-label">Photo <span class="ord-form-label-hint">— tap the circle to pick from your gallery, or paste a URL below</span></label>
          <div class="ved-photo-actions">
            <button type="button" class="ved-photo-action-btn" id="vedPhotoUpload">${cameraIcon()}<span>Upload from device</span></button>
            <button type="button" class="ved-photo-action-btn ved-photo-action-clear" id="vedPhotoClear">${trashIcon()}<span>Remove photo</span></button>
          </div>
          <input type="url" class="ord-form-input" id="vedImageUrl" value="${esc(v.image_url || '')}" placeholder="https://example.com/logo.png  (optional URL)" autocomplete="off" inputmode="url" style="margin-top:8px">
          <div class="ord-form-hint">Photos are auto-cropped to square and downscaled to 384 px for crisp retina rendering. Leave empty for the colored-letter avatar.</div>
        </div>

        <div class="ord-form-field">
          <label class="ord-form-label">Avatar color <span class="ord-form-label-hint">— only matters when there's no photo</span></label>
          <div class="ved-hue-picker" id="vedHuePicker" data-selected="${typeof v.avatar_hue === 'number' ? v.avatar_hue : 'auto'}">
            <button type="button" class="ved-hue-swatch ved-hue-auto${typeof v.avatar_hue !== 'number' ? ' active' : ''}" data-hue="auto" aria-label="Auto (hash from name)">A</button>
            ${[15, 35, 55, 90, 130, 165, 200, 230, 265, 295, 325, 355].map(h =>
              `<button type="button" class="ved-hue-swatch${v.avatar_hue === h ? ' active' : ''}" data-hue="${h}" style="--avatar-hue:${h}" aria-label="Hue ${h}"></button>`
            ).join('')}
          </div>
        </div>

        <div class="ord-form-field">
          <label class="ord-form-toggle">
            <input type="checkbox" id="vedPinned" ${v.pinned ? 'checked' : ''}>
            <span class="ord-form-toggle-track"><span class="ord-form-toggle-thumb"></span></span>
            <span class="ord-form-toggle-text">
              <span class="ord-form-toggle-title">Pin to top</span>
              <span class="ord-form-toggle-sub">Pinned vendors appear above all others, in the order they were pinned.</span>
            </span>
          </label>
        </div>

        ${itemsHTML}

        <div class="ved-section-divider"><span>Delivery days</span></div>
        <div class="ord-form-field">
          <div class="ord-day-pills" id="vedDays">
            ${WEEKDAY_KEYS.map((k, i) => `
              <button type="button" class="ord-day-pill${days.includes(k) ? ' active' : ''}" data-day="${k}">${WEEKDAY_LBL[i]}</button>
            `).join('')}
          </div>
          <div class="ord-form-hint">Tap to toggle. Used to pick the next delivery date when starting an order.</div>
        </div>

        <div class="ved-section-divider"><span>Email composition</span></div>
        <div class="ord-form-field">
          <label class="ord-form-label" for="vedSubject">Subject line</label>
          <input type="text" class="ord-form-input" id="vedSubject" value="${esc(v.subject_template || '')}" placeholder="${esc(v.name || 'Vendor')} order — {location} for {delivery_date}" autocomplete="off">
          <div class="ord-form-hint">Tokens: <code>{vendor}</code> <code>{location}</code> <code>{delivery_date}</code></div>
        </div>
        <div class="ord-form-field">
          <label class="ord-form-label" for="vedBody">Body template</label>
          <textarea class="ord-form-textarea" id="vedBody" rows="6" placeholder="Leave blank to use the standard format. If you set this, your text replaces the body — use {lines} where the item list should appear.">${esc(v.body_template || '')}</textarea>
          <div class="ord-form-hint">Tokens: <code>{vendor}</code> <code>{location}</code> <code>{delivery_date_long}</code> <code>{lines}</code> <code>{notes}</code></div>
        </div>

        <div class="ved-section-divider"><span>Internal notes</span></div>
        <div class="ord-form-field">
          <textarea class="ord-form-textarea" id="vedNotes" rows="3" placeholder="Anything to remember about this vendor — only you see this">${esc(v.notes || '')}</textarea>
        </div>

        ${!isNew ? `
          <div class="ved-section-divider ved-section-divider-danger"><span>Danger zone</span></div>
          <button class="ord-veditor-archive-btn" id="vedArchive">${trashIcon()}<span>Archive vendor</span></button>
          <div class="ord-form-hint" style="text-align:center">Archived vendors are hidden from the list. Order history is preserved.</div>
        ` : ''}
      </div>
      <div class="ord-veditor-foot">
        <button class="ord-veditor-cancel" id="vedCancel">Cancel</button>
        <button class="ord-veditor-save" id="vedSave">${isNew ? 'Create vendor' : 'Save changes'}</button>
      </div>
    `;

    // Wire all handlers
    const overlay = editorState.overlay;
    overlay.querySelector('.ord-veditor-close').addEventListener('click', closeVendorEditor);
    overlay.querySelector('#vedCancel').addEventListener('click', closeVendorEditor);
    overlay.querySelector('#vedSave').addEventListener('click', saveVendor);
    overlay.querySelectorAll('.ord-day-pill').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });

    // Live avatar preview — re-renders when name or image URL changes so
    // the user can see what the card will look like before saving.
    const previewEl = overlay.querySelector('#vedAvatarPreview');
    const huePicker = overlay.querySelector('#vedHuePicker');
    const readSelectedHue = () => {
      if (!huePicker) return undefined;
      const sel = huePicker.dataset.selected;
      if (!sel || sel === 'auto') return undefined;
      const n = Number(sel);
      return Number.isFinite(n) ? n : undefined;
    };
    const updatePreview = () => {
      if (!previewEl) return;
      const nm = overlay.querySelector('#vedName')?.value.trim() || '';
      const url = overlay.querySelector('#vedImageUrl')?.value.trim() || '';
      previewEl.innerHTML = vendorAvatar(nm, url, readSelectedHue());
    };
    overlay.querySelector('#vedName')?.addEventListener('input', updatePreview);
    overlay.querySelector('#vedImageUrl')?.addEventListener('input', updatePreview);

    // Hue swatch picker — tapping a swatch flips the .active state and
    // stores the choice on the picker's data-selected attribute, then
    // refreshes the preview. "auto" means hash-from-name (no override).
    if (huePicker) {
      huePicker.querySelectorAll('.ved-hue-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          huePicker.querySelectorAll('.ved-hue-swatch').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          huePicker.dataset.selected = btn.dataset.hue;
          updatePreview();
        });
      });
    }

    // Photo upload from device — file picker, downscale to a 256px JPEG,
    // store as a data URL in the same #vedImageUrl input so save logic
    // doesn't need to change. Avatar tap and "Upload from device" both
    // trigger the picker; "Remove photo" clears the URL.
    const fileInput  = overlay.querySelector('#vedImageFile');
    const urlInput   = overlay.querySelector('#vedImageUrl');
    const avatarBtn  = overlay.querySelector('#vedAvatarBtn');
    const uploadBtn  = overlay.querySelector('#vedPhotoUpload');
    const clearBtn   = overlay.querySelector('#vedPhotoClear');
    if (fileInput && urlInput) {
      const triggerPicker = () => fileInput.click();
      avatarBtn?.addEventListener('click', triggerPicker);
      uploadBtn?.addEventListener('click', triggerPicker);
      clearBtn?.addEventListener('click', () => {
        urlInput.value = '';
        urlInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (window.NX?.toast) NX.toast('Photo removed');
      });
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';   // allow re-picking the same file later
        if (!file) return;
        if (!file.type || !file.type.startsWith('image/')) {
          if (window.NX?.toast) NX.toast('Please pick an image file', 'warn');
          return;
        }
        if (file.size > 12 * 1024 * 1024) {
          if (window.NX?.toast) NX.toast('Image too large (12 MB max)', 'warn');
          return;
        }
        try {
          const dataUrl = await downscaleImageToDataUrl(file, 384, 0.85);
          urlInput.value = dataUrl;
          urlInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (window.NX?.toast) NX.toast('Photo set — save to apply');
        } catch (err) {
          console.warn('[ordering] photo upload failed:', err);
          if (window.NX?.toast) NX.toast('Could not process that image', 'error');
        }
      });
    }

    const arch = overlay.querySelector('#vedArchive');
    if (arch) arch.addEventListener('click', archiveVendor);

    // Recipient list — wire kind-cycling and remove on existing rows,
    // then bind the "Add another" button to append a new empty row.
    const recipientsEl = overlay.querySelector('#vedRecipients');
    const recipientAddBtn = overlay.querySelector('#vedRecipientAdd');
    if (recipientsEl) wireRecipientRowsHandlers(recipientsEl);
    if (recipientAddBtn && recipientsEl) {
      recipientAddBtn.addEventListener('click', () => {
        // Snapshot current rows, append a fresh empty CC row, re-render.
        const current = readRecipientRows(recipientsEl);
        current.push({ email: '', kind: 'cc' });
        recipientsEl.innerHTML = renderRecipientRows(current);
        wireRecipientRowsHandlers(recipientsEl);
        // Focus the new row's input so the user can type immediately.
        const lastInput = recipientsEl.querySelector('.ved-recipient-row:last-child .ved-recipient-email');
        if (lastInput) lastInput.focus();
      });
    }

    const manageCatalog = overlay.querySelector('#vedManageCatalog');
    if (manageCatalog) manageCatalog.addEventListener('click', () => {
      if (!editorState || !editorState.vendor || !editorState.vendor.id) return;
      openCatalogEditor(editorState.vendor);
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
    const reorder = !!catalogState.reorderMode;
    const searchQ = (catalogState.searchQuery || '').trim().toLowerCase();
    const pending = catalogState.pendingSections || [];
    let html = '';

    // Apply search filter (item name + sku). Sections that end up with
    // 0 matching items are hidden from the list, but pending empty
    // sections are always shown (so you can still find them while filtering).
    const items = searchQ
      ? allItems.filter(i => {
          const name = (i.item_name || '').toLowerCase();
          const sku  = (i.vendor_sku || '').toLowerCase();
          return name.indexOf(searchQ) !== -1 || sku.indexOf(searchQ) !== -1;
        })
      : allItems;

    // "New item" form rendered at the top when adding (only when not in reorder mode)
    if (catalogState.editingItemId === 'new' && !reorder) {
      const defaultSec = catalogState._newItemDefaultSection || '';
      html += renderItemForm({
        id: '__new', item_name: '', vendor_sku: '',
        section: defaultSec, unit: 'ea',
        default_par_qty: null, pars_by_day: {}, note: ''
      }, true);
    }

    if (!allItems.length && !pending.length && catalogState.editingItemId !== 'new') {
      html += `
        <div class="ved-items-empty">
          <div class="ved-items-empty-icon">${listIcon()}</div>
          <div class="ved-items-empty-title">No items yet</div>
          <div class="ved-items-empty-msg">Tap <b>+ Section</b> or <b>+ Item</b> above to start the catalog.</div>
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

    // Pending (empty) sections appear after sections with items but
    // before "Uncategorized". They have no items so no min sort_order.
    for (const p of pending) {
      if (!groups.has(p)) groups.set(p, []);
    }

    // Sort sections: by min sort_order, then alpha; pending-empty
    // sections after real ones (they have Infinity min); '' always last.
    const sections = Array.from(groups.keys()).sort((a, b) => {
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
      html += renderSectionGroup(sec, groups.get(sec), reorder);
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

  function renderSectionGroup(sec, items, reorder) {
    const isUncat = sec === '';
    const isRenaming = catalogState.renamingSection === sec && !reorder;
    const headerInner = isRenaming
      ? `
        <input type="text" class="ved-section-rename-input" value="${esc(sec)}" autocomplete="off" spellcheck="false" placeholder="Section name">
        <button class="ved-section-rename-save" data-old="${esc(sec)}">Save</button>
        <button class="ved-section-rename-cancel">Cancel</button>
      `
      : `
        ${reorder ? `
          <span class="ved-section-drag" data-section="${esc(sec)}" aria-label="Reorder section ${esc(sec || 'uncategorized')}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="3" y1="8" x2="21" y2="8"/>
              <line x1="3" y1="16" x2="21" y2="16"/>
            </svg>
          </span>
        ` : ''}
        <span class="ved-section-name${isUncat ? ' is-uncat' : ''}" ${!reorder && !isUncat ? `data-section="${esc(sec)}" role="button" tabindex="0"` : ''}>
          ${esc(sec || 'Uncategorized')}
        </span>
        <span class="ved-section-count">${items.length}</span>
        ${!reorder && !isUncat ? `
          <button class="ved-section-rename-btn" data-section="${esc(sec)}" aria-label="Rename section ${esc(sec)}">${editIcon()}</button>
        ` : ''}
      `;

    let inner = `<div class="ved-section-row${reorder ? ' is-reordering' : ''}" data-section="${esc(sec)}">${headerInner}</div>`;

    if (items.length === 0 && !isUncat) {
      // Pending / emptied section — show placeholder with quick-add CTA
      // and a small "remove" button (X) to clear the placeholder client-side.
      inner += `
        <div class="ved-section-empty">
          <div class="ved-section-empty-text">No items in this section yet.</div>
          <div class="ved-section-empty-actions">
            <button class="ved-section-empty-add" type="button" data-section="${esc(sec)}">${plusIcon()}<span>Add to ${esc(sec)}</span></button>
            ${!reorder ? `<button class="ved-section-empty-remove" type="button" data-section="${esc(sec)}" aria-label="Remove empty section">×</button>` : ''}
          </div>
        </div>
      `;
    }

    for (const it of items) {
      if (catalogState.editingItemId === it.id && !reorder) {
        inner += renderItemForm(it, false);
      } else {
        inner += renderItemRow(it, reorder);
      }
    }

    return `<div class="ved-section-block" data-section="${esc(sec)}">${inner}</div>`;
  }

  function renderItemRow(item, reorder) {
    // Build the meta line in the order: SKU · section · par. Use
    // monospace (set in CSS) so numbers align across rows.
    const meta = [];
    if (item.vendor_sku) meta.push(`<span class="ved-meta-sku">${esc(item.vendor_sku)}</span>`);
    if (item.default_par_qty != null) meta.push(`par ${item.default_par_qty} ${esc(item.unit || 'ea')}`);
    // Section is now shown via the section header, so we omit it from the
    // per-row meta line — keeps the row clean and emphasizes the grouping.
    const handle = reorder ? `
      <span class="ved-item-drag-handle" data-item-id="${esc(item.id)}" aria-label="Drag to reorder ${esc(item.item_name)}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="3" y1="8" x2="21" y2="8"/>
          <line x1="3" y1="16" x2="21" y2="16"/>
        </svg>
      </span>
    ` : '';
    const rowTag = reorder ? 'div' : 'button';
    const rowAttrs = reorder
      ? `class="ved-item-row is-reordering" data-item-id="${esc(item.id)}"`
      : `class="ved-item-row" data-item-id="${esc(item.id)}" type="button"`;
    return `
      <${rowTag} ${rowAttrs}>
        ${handle}
        <div class="ved-item-main">
          <div class="ved-item-name">${esc(item.item_name)}</div>
          ${meta.length ? `<div class="ved-item-meta">${meta.join('<span class="ved-meta-sep">·</span>')}</div>` : ''}
        </div>
        ${reorder ? '' : '<div class="ved-item-chevron" aria-hidden="true">›</div>'}
      </${rowTag}>
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
          <label class="ord-form-label">Item name</label>
          <input type="text" class="ord-form-input ied-name" value="${esc(item.item_name || '')}" placeholder="e.g. milk" autocomplete="off">
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
        <div class="ord-vitem-edit-actions">
          ${!isNew ? `<button class="ord-vitem-delete-btn" data-item-id="${esc(item.id)}">${trashIcon()} Delete</button>` : '<div></div>'}
          <button class="ord-vitem-cancel-btn">Cancel</button>
          <button class="ord-vitem-save-btn" data-item-id="${esc(item.id)}">Save item</button>
        </div>
      </div>
    `;
  }

  function wireItemListHandlers() {
    const list = document.getElementById('vedItemsList');
    if (!list) return;

    const reorder = !!(editorState && catalogState.reorderMode);

    // Tap item row → enter edit mode (only when NOT in reorder mode)
    if (!reorder) {
      list.querySelectorAll('.ved-item-row').forEach(row => {
        if (row.tagName !== 'BUTTON') return;
        row.addEventListener('click', () => {
          catalogState.editingItemId = row.dataset.itemId;
          renderItemsAreaOnly();
          setTimeout(() => {
            const form = list.querySelector('.ord-vitem-editing');
            if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 50);
        });
      });
    }

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

    // ─── Section rename — normal mode ──────────────────────────────
    if (!reorder) {
      // Tap section name → start inline rename
      list.querySelectorAll('.ved-section-name[data-section]').forEach(el => {
        el.addEventListener('click', () => {
          catalogState.renamingSection = el.dataset.section;
          renderItemsAreaOnly();
          setTimeout(() => {
            const inp = list.querySelector('.ved-section-rename-input');
            if (inp) { inp.focus(); inp.select(); }
          }, 30);
        });
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            catalogState.renamingSection = el.dataset.section;
            renderItemsAreaOnly();
          }
        });
      });
      list.querySelectorAll('.ved-section-rename-btn').forEach(btn => {
        btn.addEventListener('click', () => {
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
    }

    // ─── Drag handlers — reorder mode only ─────────────────────────
    if (reorder) {
      wireItemDragHandlers(list);
      wireSectionDragHandlers(list);
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

  /* ── Item drag handlers: reorder within section, or drag across
   * boundaries to change section. Mirrors the vendor-list drag pattern
   * but adds section detection on drop. */
  function wireItemDragHandlers(listEl) {
    let draggingId = null;
    let startY = 0;
    let liveOrder = [];   // array of {id, section} entries reflecting current visual state

    const handles = listEl.querySelectorAll('.ved-item-drag-handle');
    handles.forEach(h => h.addEventListener('pointerdown', onPointerDown));

    function snapshot() {
      // Walk DOM in document order to capture current item-row sequence
      // and which section block each row currently lives in. This is the
      // single source of truth during a drag.
      const rows = listEl.querySelectorAll('.ved-section-block');
      const out = [];
      rows.forEach(block => {
        const sec = block.dataset.section || '';
        block.querySelectorAll('.ved-item-row[data-item-id]').forEach(r => {
          out.push({ id: r.dataset.itemId, section: sec, el: r });
        });
      });
      return out;
    }

    function onPointerDown(e) {
      e.preventDefault();
      const handle = e.currentTarget;
      const row = handle.closest('.ved-item-row');
      if (!row) return;
      draggingId = row.dataset.itemId;
      startY = e.clientY;
      row.classList.add('is-dragging');
      liveOrder = snapshot();
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
      if (!draggingId) return;
      const draggedRow = listEl.querySelector('.ved-item-row.is-dragging');
      if (!draggedRow) return;
      const dy = e.clientY - startY;
      draggedRow.style.transform = `translateY(${dy}px)`;

      // Find the closest non-dragged item row whose vertical center we've
      // crossed. When found, swap positions in the DOM + liveOrder.
      const draggedRect = draggedRow.getBoundingClientRect();
      const draggedCenter = draggedRect.top + draggedRect.height / 2;
      const allRows = Array.from(listEl.querySelectorAll('.ved-item-row[data-item-id]'))
                           .filter(r => r.dataset.itemId !== draggingId);
      for (const other of allRows) {
        const r = other.getBoundingClientRect();
        if (draggedCenter > r.top && draggedCenter < r.bottom) {
          // Crossed center — move dragged row before/after `other` in the DOM.
          const targetSecBlock = other.closest('.ved-section-block');
          const otherIdInOrder = other.dataset.itemId;
          const fromIdx = liveOrder.findIndex(x => x.id === draggingId);
          const toIdx   = liveOrder.findIndex(x => x.id === otherIdInOrder);
          if (fromIdx === -1 || toIdx === -1 || !targetSecBlock) break;

          // Determine target section from `other`'s parent block
          const newSection = targetSecBlock.dataset.section || '';

          // Mutate liveOrder
          const moved = liveOrder.splice(fromIdx, 1)[0];
          moved.section = newSection;
          // After splice, indices may shift — recompute toIdx
          const newToIdx = liveOrder.findIndex(x => x.id === otherIdInOrder);
          // If dragging downward we want to insert AFTER `other`, otherwise BEFORE.
          const insertBefore = (fromIdx > toIdx);  // moved upward → insert before
          liveOrder.splice(insertBefore ? newToIdx : newToIdx + 1, 0, moved);

          // Reflect in DOM: physically move the dragged row into the
          // target block at the new position.
          if (insertBefore) {
            targetSecBlock.insertBefore(draggedRow, other);
          } else {
            other.after(draggedRow);
          }
          // Reset transform — the row is now in its new home, finger
          // stays at the same screen position so we re-anchor.
          startY = e.clientY;
          draggedRow.style.transform = 'translateY(0px)';
          break;
        }
      }
    }

    async function onPointerUp(e) {
      if (!draggingId) return;
      const handle = e.currentTarget;
      const draggedRow = listEl.querySelector('.ved-item-row.is-dragging');
      if (draggedRow) {
        draggedRow.classList.remove('is-dragging');
        draggedRow.style.transform = '';
      }
      handle.releasePointerCapture?.(e.pointerId);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
      const finalOrder = liveOrder.slice();
      draggingId = null;
      liveOrder = [];
      await persistItemReorder(finalOrder);
    }
  }

  /* ── Section drag: pickup the whole section block, drop relative
   * to other section blocks. On drop, the section's items are
   * re-numbered to slot in at the new position. */
  function wireSectionDragHandlers(listEl) {
    let draggingSec = null;
    let startY = 0;
    let liveOrder = [];   // array of section names in current visual order

    const handles = listEl.querySelectorAll('.ved-section-drag');
    handles.forEach(h => h.addEventListener('pointerdown', onPointerDown));

    function onPointerDown(e) {
      e.preventDefault();
      const handle = e.currentTarget;
      const block = handle.closest('.ved-section-block');
      if (!block) return;
      draggingSec = block.dataset.section || '';
      startY = e.clientY;
      block.classList.add('is-dragging');
      liveOrder = Array.from(listEl.querySelectorAll('.ved-section-block')).map(b => b.dataset.section || '');
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
      if (draggingSec == null) return;
      const block = listEl.querySelector('.ved-section-block.is-dragging');
      if (!block) return;
      const dy = e.clientY - startY;
      block.style.transform = `translateY(${dy}px)`;

      const blockRect = block.getBoundingClientRect();
      const blockCenter = blockRect.top + blockRect.height / 2;
      const others = Array.from(listEl.querySelectorAll('.ved-section-block'))
                          .filter(b => (b.dataset.section || '') !== draggingSec);
      for (const other of others) {
        const r = other.getBoundingClientRect();
        if (blockCenter > r.top && blockCenter < r.bottom) {
          const fromIdx = liveOrder.indexOf(draggingSec);
          const toIdx = liveOrder.indexOf(other.dataset.section || '');
          if (fromIdx === -1 || toIdx === -1) break;
          liveOrder.splice(fromIdx, 1);
          liveOrder.splice(toIdx, 0, draggingSec);
          // Reflect in DOM
          if (fromIdx > toIdx) {
            other.parentNode.insertBefore(block, other);
          } else {
            other.after(block);
          }
          startY = e.clientY;
          block.style.transform = 'translateY(0px)';
          break;
        }
      }
    }

    async function onPointerUp(e) {
      if (draggingSec == null) return;
      const handle = e.currentTarget;
      const block = listEl.querySelector('.ved-section-block.is-dragging');
      if (block) {
        block.classList.remove('is-dragging');
        block.style.transform = '';
      }
      handle.releasePointerCapture?.(e.pointerId);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
      const finalSectionOrder = liveOrder.slice();
      draggingSec = null;
      liveOrder = [];
      await persistSectionReorder(finalSectionOrder);
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

  async function saveVendor() {
    if (!editorState) return;
    const overlay = editorState.overlay;
    const name = overlay.querySelector('#vedName').value.trim();
    const email = overlay.querySelector('#vedEmail').value.trim();
    const imageUrl = overlay.querySelector('#vedImageUrl')?.value.trim() || '';
    const subject = overlay.querySelector('#vedSubject').value.trim();
    const body = overlay.querySelector('#vedBody').value;
    const notes = overlay.querySelector('#vedNotes').value;
    if (!name) {
      if (NX.toast) NX.toast('Name is required', 'warn');
      return;
    }
    const dayBtns = overlay.querySelectorAll('.ord-day-pill.active');
    const days = Array.from(dayBtns).map(b => b.dataset.day);

    // Avatar hue: data-selected on the picker holds the value. "auto" or
    // missing means no override (null in DB → hash-from-name at render).
    let avatarHue = null;
    const huePicker = overlay.querySelector('#vedHuePicker');
    if (huePicker) {
      const sel = huePicker.dataset.selected;
      if (sel && sel !== 'auto') {
        const n = Number(sel);
        if (Number.isFinite(n) && n >= 0 && n < 360) avatarHue = n;
      }
    }
    const pinned = !!overlay.querySelector('#vedPinned')?.checked;

    // Recipient list (alt_emails) — read from current DOM rows. Empty
    // rows are filtered by readRecipientRows. Stored as JSON array of
    // {email, kind} objects in the alt_emails column.
    const altEmails = readRecipientRows(overlay.querySelector('#vedRecipients'));

    const payload = {
      name,
      email: email || null,
      alt_emails: altEmails.length ? altEmails : null,
      image_url: imageUrl || null,
      avatar_hue: avatarHue,
      pinned,
      delivery_days: days,
      subject_template: subject || null,
      body_template: body.trim() || null,
      notes: notes.trim() || null,
    };

    // Columns that may not exist if the DB migration hasn't been run.
    // If the save fails with a missing-column error, we strip them and
    // retry with the legacy set so the user's edits still land.
    const optionalCols = ['image_url', 'avatar_hue', 'pinned', 'alt_emails'];
    const stripOptionalCols = (p) => {
      const o = { ...p };
      for (const k of optionalCols) delete o[k];
      return o;
    };
    const isMissingColumnError = (err) => {
      const msg = (err && (err.message || err.toString())) || '';
      return /column|schema|does not exist|could not find/i.test(msg);
    };

    try {
      if (editorState.isNew) {
        let res = await NX.sb.from('order_vendors').insert(payload).select('*').single();
        if (res.error && isMissingColumnError(res.error)) {
          console.warn('[ordering] saveVendor insert: retry without new columns');
          res = await NX.sb.from('order_vendors').insert(stripOptionalCols(payload)).select('*').single();
        }
        if (res.error) throw res.error;
        vendors.push(res.data);
        vendors.sort((a, b) => a.name.localeCompare(b.name));
        vendors._itemCounts[res.data.id] = 0;
      } else {
        // Defensive: editorState.vendor.id MUST be a real UUID for the
        // update path. If it's missing (caller passed wrong shape), bail
        // with a clear error rather than letting Postgres reject "undefined".
        const vendorId = editorState.vendor && editorState.vendor.id;
        if (!vendorId) {
          throw new Error('Editor state missing vendor.id — cannot update');
        }
        let res = await NX.sb.from('order_vendors').update(payload).eq('id', vendorId);
        if (res.error && isMissingColumnError(res.error)) {
          console.warn('[ordering] saveVendor update: retry without new columns');
          res = await NX.sb.from('order_vendors').update(stripOptionalCols(payload)).eq('id', vendorId);
        }
        if (res.error) throw res.error;
        const cached = vendors.find(x => x.id === vendorId);
        if (cached) Object.assign(cached, payload);
      }
      if (NX.toast) NX.toast('Saved', 'info', 1200);
      closeVendorEditor();
      renderVendors();
    } catch (e) {
      console.error('[ordering] saveVendor:', e);
      if (NX.toast) NX.toast('Failed to save: ' + (e.message || ''), 'error');
    }
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
        console.warn('[ordering] archive returned no rows — likely RLS denial or stale id');
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

  async function archiveVendor() {
    if (!editorState || editorState.isNew) return;
    const id = editorState.vendor.id;
    const name = editorState.vendor.name;
    const ok = await archiveVendorById(id, name);
    if (ok) closeVendorEditor();
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
      vendor_sku: sku || null,
      section: sec || null,
      unit,
      default_par_qty: par,
      pars_by_day: days,
      note: note || null,
    };

    try {
      if (isNew) {
        // Determine sort_order — append to end
        const maxSort = catalogState.items.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
        const { data, error } = await NX.sb.from('order_guide_items')
          .insert({ ...payload, vendor_id: catalogState.vendor.id, sort_order: maxSort + 1 })
          .select('*').single();
        if (error) throw error;
        catalogState.items.push(data);
        if (vendors._itemCounts) {
          vendors._itemCounts[catalogState.vendor.id] = (vendors._itemCounts[catalogState.vendor.id] || 0) + 1;
        }
        // If the new item lives in a "newly-created empty section" placeholder,
        // remove it from pendingSections (it's now backed by a real row).
        if (sec && Array.isArray(catalogState.pendingSections)) {
          catalogState.pendingSections = catalogState.pendingSections.filter(s => s !== sec);
        }
      } else {
        const { error } = await NX.sb.from('order_guide_items')
          .update(payload).eq('id', itemId);
        if (error) throw error;
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

  function closeVendorEditor() {
    const overlay = document.querySelector('.ord-veditor-overlay');
    if (overlay) overlay.remove();
    document.body.classList.remove('ord-overlay-open');
    editorState = null;
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
      reorderMode: false,
      renamingSection: null,         // section name being inline-edited (null otherwise)
      addingSection: false,          // true while the "+ Section" inline form is open
      pendingSections: [],           // names of empty sections the user just created
                                     // (kept client-side until first item lands in them)
      searchQuery: '',
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
    // Refresh the vendor editor's count chip if it's open
    if (editorState && catalogState) {
      editorState.itemCount = catalogState.items.length;
      try { renderVendorEditor(); } catch (_) { /* ignore — editor may have closed */ }
    }
    catalogState = null;
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
    const reorder = !!catalogState.reorderMode;
    const itemCountSub = `${itemCount} item${itemCount === 1 ? '' : 's'}`;

    // Toolbar: + Section, + Item, Reorder/Done
    const canReorder = itemCount >= 2 || (catalogState.pendingSections && catalogState.pendingSections.length >= 2);
    const toolbarHTML = `
      <div class="ord-cat-toolbar">
        <button class="ord-cat-tool-btn" id="catAddSection" type="button" ${reorder ? 'disabled' : ''}>
          ${plusIcon()}<span>Section</span>
        </button>
        <button class="ord-cat-tool-btn ord-cat-tool-primary" id="catAddItem" type="button" ${reorder ? 'disabled' : ''}>
          ${plusIcon()}<span>Item</span>
        </button>
        ${canReorder ? `
          <button class="ord-cat-tool-btn ord-cat-reorder${reorder ? ' is-active' : ''}" id="catReorderToggle" type="button" aria-pressed="${reorder}">
            ${reorder ? 'Done' : 'Reorder'}
          </button>
        ` : ''}
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

    // Search bar — hidden during reorder mode (less clutter)
    const searchHTML = !reorder ? `
      <div class="ord-entry-search-wrap ord-cat-search-wrap">
        <input type="search" class="ord-entry-search" id="catSearch" placeholder="Search items…" value="${esc(catalogState.searchQuery || '')}" autocomplete="off" spellcheck="false">
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
      <div class="ord-entry-list ord-cat-list" id="catItemsList">
        ${renderItemsList()}
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

    // Add item — opens inline form at top of list, default section = first existing or empty
    const addItem = overlay.querySelector('#catAddItem');
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

    // Reorder toggle
    const reorderBtn = overlay.querySelector('#catReorderToggle');
    if (reorderBtn) reorderBtn.addEventListener('click', () => {
      catalogState.reorderMode = !catalogState.reorderMode;
      catalogState.editingItemId = null;
      catalogState.renamingSection = null;
      catalogState.addingSection = false;
      renderCatalog();
    });

    // Search
    const search = overlay.querySelector('#catSearch');
    if (search) {
      search.addEventListener('input', e => {
        catalogState.searchQuery = e.target.value;
        renderItemsAreaOnly();
      });
    }

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
  }

  /* When opening the "Add item" form, default the section to the most
   * useful one: the most-recently-created pending section, or the
   * alphabetically-first existing section, or empty. */
  function pickDefaultNewItemSection() {
    if (!catalogState) return '';
    const pending = catalogState.pendingSections || [];
    if (pending.length) return pending[pending.length - 1];
    const sections = new Set();
    catalogState.items.forEach(i => { if (i.section) sections.add(i.section); });
    if (!sections.size) return '';
    return Array.from(sections).sort()[0];
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
    catalogState.pendingSections.push(name);
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
  function parseAltEmails(raw) {
    if (!raw) return [];
    if (!Array.isArray(raw)) return [];
    return raw.map(r => {
      if (typeof r === 'string') return { email: r.trim(), kind: 'cc' };
      if (r && typeof r === 'object') {
        const kind = ['cc', 'bcc', 'alt'].includes(r.kind) ? r.kind : 'cc';
        return { email: (r.email || '').trim(), kind };
      }
      return { email: '', kind: 'cc' };
    }).filter(r => r.email);  // drop empty rows
  }

  /**
   * Render the editable rows of a recipient list. Each row has:
   *   - a kind badge (CC / BCC / ALT) that cycles on tap
   *   - an email input
   *   - a remove (×) button
   * Returns HTML for the list body. Wiring lives in
   * wireRecipientRowsHandlers() below.
   */
  function renderRecipientRows(rawAltEmails) {
    const rows = parseAltEmails(rawAltEmails);
    if (!rows.length) {
      return '<div class="ved-recipients-empty">No additional recipients yet.</div>';
    }
    return rows.map((r, i) => recipientRowHTML(r, i)).join('');
  }

  function recipientRowHTML(row, index) {
    const kindLabel = (row.kind || 'cc').toUpperCase();
    return `
      <div class="ved-recipient-row" data-index="${index}">
        <button type="button" class="ved-recipient-kind ved-recipient-kind-${esc(row.kind)}" data-action="cycle-kind" aria-label="Cycle recipient type (currently ${esc(kindLabel)})">${esc(kindLabel)}</button>
        <input type="email" class="ved-recipient-email" value="${esc(row.email)}" placeholder="cc@vendor.com" autocomplete="off" inputmode="email">
        <button type="button" class="ved-recipient-remove" data-action="remove" aria-label="Remove recipient">${closeIcon()}</button>
      </div>
    `;
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

  NX.modules.ordering = {
    init, show, setLocation, openVendor, openExistingOrder, closeEntry,
    openVendorEditor, closeVendorEditor,
    openVendorDetail, closeVendorDetail,
    openOrderDetail, closeOrderDetail, reorderFromOrder, reportIssuesOnOrder,
  };
  console.log('[ordering] loaded (Phase B — vendor + item management)');
})();
