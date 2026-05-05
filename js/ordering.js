/* ═══════════════════════════════════════════════════════════════════
   ordering.js — vendor list + order shell (Phase 1)
   ═══════════════════════════════════════════════════════════════════
   This is the entry view of the Ordering pane. Three sections:

     1. HEADER — location pill (Este / Toti / Suerte), title.
     2. RECENT — last few orders for the active location, tap-to-open.
     3. VENDORS — full list grouped by managed_by (Cameron / Jessie /
        Rene / Shift). Tap a vendor to start a new order.

   Phase 1 (this file): list rendering only. Vendor tap logs and
   shows a placeholder. Phase 2 will add the order-entry guide,
   cart-review, and mailto compose.

   Data model recap (from ordering_phase_a.sql):
     order_vendors:        catalog of vendors with email, managed_by, etc.
     order_guide_items:    items each vendor sells (vendor_sku, unit, pars).
     order_guide_pars:     per-location overrides (Toti/Suerte/Este).
     orders + order_lines: the actual orders.

   Persisted state:
     localStorage['nexus_order_location']  →  'este'|'toti'|'suerte'

   Defaults:
     - Last-used location wins. Falls back to admin setting if present
       (NX.prefs.get('default_order_location')), then 'este'.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  if (window.NX && window.NX.modules && window.NX.modules.ordering) return;
  window.NX = window.NX || {}; NX.modules = NX.modules || {};

  const PANE_SEL    = '#dutiesOrderingPane';
  const LOC_KEY     = 'nexus_order_location';
  const LOCS        = [
    { id: 'este',   label: 'Este'   },
    { id: 'toti',   label: 'Toti'   },
    { id: 'suerte', label: 'Suerte' },
  ];

  // Manager grouping for the vendor list. Order matters: shift first
  // (the high-volume vendors), then individual managers alphabetically.
  const GROUP_ORDER = ['shift', 'cameron', 'jessie', 'rene', 'other'];
  const GROUP_LABEL = {
    shift:   'Shift vendors',
    cameron: "Cameron's vendors",
    jessie:  "Jessie's vendors",
    rene:    "Rene's vendors",
    other:   'Other vendors',
  };

  let vendors      = [];
  let orders       = [];
  let activeLoc    = null;
  let initialized  = false;

  // ─── HTML escaping ────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
    ));
  }

  // ─── Location resolution ──────────────────────────────────────────
  function resolveLocation() {
    // 1. localStorage (last-used)
    const ls = localStorage.getItem(LOC_KEY);
    if (ls && LOCS.some(l => l.id === ls)) return ls;
    // 2. Admin/user prefs (if NX.prefs exposes it)
    if (NX.prefs && typeof NX.prefs.get === 'function') {
      const p = NX.prefs.get('default_order_location');
      if (p && LOCS.some(l => l.id === p)) return p;
    }
    // 3. Hard default
    return 'este';
  }

  // ─── Data fetches ─────────────────────────────────────────────────
  async function loadVendors() {
    if (!NX.sb) return [];
    const { data, error } = await NX.sb
      .from('order_vendors')
      .select('id, name, alias_short, email, managed_by, role, delivery_days, archived')
      .eq('archived', false)
      .order('name', { ascending: true });
    if (error) {
      console.error('[ordering] loadVendors:', error);
      return [];
    }
    return data || [];
  }

  async function loadRecentOrders(location, limit = 8) {
    if (!NX.sb) return [];
    const { data, error } = await NX.sb
      .from('orders')
      .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at')
      .eq('location', location)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[ordering] loadRecentOrders:', error);
      return [];
    }
    return data || [];
  }

  // ─── Counts per vendor (for "N items" hint on each row) ───────────
  async function loadItemCounts() {
    if (!NX.sb) return {};
    // One query — group_by isn't available in the JS client without RPC,
    // so we just fetch (vendor_id, id) and count client-side. With ~250
    // items this is trivial.
    const { data, error } = await NX.sb
      .from('order_guide_items')
      .select('vendor_id, id')
      .eq('archived', false);
    if (error) { console.error('[ordering] loadItemCounts:', error); return {}; }
    const counts = {};
    (data || []).forEach(row => {
      counts[row.vendor_id] = (counts[row.vendor_id] || 0) + 1;
    });
    return counts;
  }

  // ─── Rendering ────────────────────────────────────────────────────
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
        <div class="ord-section-label">Vendors</div>
        <div class="ord-search-wrap">
          <input
            type="search"
            class="ord-search"
            id="ordSearch"
            placeholder="Search vendors…"
            autocomplete="off"
            spellcheck="false"
            aria-label="Search vendors"
          >
        </div>
        <div class="ord-vendors" id="ordVendors"></div>
      </div>
    `;
    // Wire location picker
    root.querySelectorAll('.ord-loc-btn').forEach(b => {
      b.addEventListener('click', () => setLocation(b.dataset.loc));
    });
    // Wire search
    const search = root.querySelector('#ordSearch');
    if (search) {
      search.addEventListener('input', e => filterVendors(e.target.value));
    }
    return root;
  }

  function renderRecent(list, vendorMap) {
    const el = document.getElementById('ordRecent');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `
        <div class="ord-section-label">Recent</div>
        <div class="ord-empty">No recent orders for ${esc(activeLoc)}.</div>
      `;
      return;
    }
    const fmtDate = ts => {
      if (!ts) return '';
      const d = new Date(ts);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const diff = (now - d) / 86400000;
      if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
    el.innerHTML = `
      <div class="ord-section-label">Recent</div>
      ${list.map(o => {
        const v = vendorMap[o.vendor_id];
        const status = o.status || 'draft';
        const when = fmtDate(o.created_at);
        const deliv = o.delivery_date
          ? new Date(o.delivery_date + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
          : '';
        return `
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
          </button>
        `;
      }).join('')}
    `;
    // Wire row clicks — Phase 2 will open the order; for now, log.
    el.querySelectorAll('.ord-recent-row').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.orderId;
        console.log('[ordering] open order', id);
        if (NX.toast) NX.toast('Order detail coming in Phase 2');
      });
    });
  }

  function renderVendors() {
    const el = document.getElementById('ordVendors');
    if (!el) return;

    // Group vendors by managed_by
    const groups = {};
    for (const v of vendors) {
      const key = v.managed_by && GROUP_LABEL[v.managed_by] ? v.managed_by : 'other';
      (groups[key] = groups[key] || []).push(v);
    }

    let html = '';
    for (const key of GROUP_ORDER) {
      const list = groups[key];
      if (!list || !list.length) continue;
      html += `<div class="ord-vgroup-label">${esc(GROUP_LABEL[key])}</div>`;
      html += `<div class="ord-vgroup">`;
      for (const v of list) {
        const itemCount = vendors._itemCounts[v.id] || 0;
        const meta = [];
        if (v.role) meta.push(esc(v.role));
        if (itemCount) meta.push(`${itemCount} item${itemCount === 1 ? '' : 's'}`);
        else meta.push('no catalog yet');
        html += `
          <button class="ord-vendor-row" data-vendor-id="${esc(v.id)}" data-vendor-name="${esc(v.name).toLowerCase()}">
            <div class="ord-vendor-main">
              <div class="ord-vendor-name">${esc(v.name)}</div>
              <div class="ord-vendor-meta">${meta.join(' · ')}</div>
            </div>
            ${v.email ? '' : '<span class="ord-vendor-warn" title="No email set">!</span>'}
            <div class="ord-arrow" aria-hidden="true">›</div>
          </button>
        `;
      }
      html += `</div>`;
    }
    el.innerHTML = html;

    // Wire row clicks — Phase 2 will open the order entry.
    el.querySelectorAll('.ord-vendor-row').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.vendorId;
        const v = vendors.find(x => x.id === id);
        console.log('[ordering] open vendor', id, v && v.name);
        if (NX.toast) NX.toast(`${v ? v.name : 'Vendor'}: order entry in Phase 2`);
      });
    });
  }

  // ─── Search filter ────────────────────────────────────────────────
  function filterVendors(query) {
    const q = (query || '').trim().toLowerCase();
    const root = document.getElementById('ordVendors');
    if (!root) return;
    let visibleGroup = false;
    let lastGroupLabel = null;
    Array.from(root.children).forEach(child => {
      if (child.classList.contains('ord-vgroup-label')) {
        // We'll decide visibility after seeing the group's vendors
        if (lastGroupLabel) lastGroupLabel.style.display = visibleGroup ? '' : 'none';
        lastGroupLabel = child;
        visibleGroup = false;
        child.style.display = '';
      } else if (child.classList.contains('ord-vgroup')) {
        let any = false;
        Array.from(child.children).forEach(row => {
          const name = row.dataset.vendorName || '';
          const match = !q || name.includes(q);
          row.style.display = match ? '' : 'none';
          if (match) any = true;
        });
        visibleGroup = any;
        child.style.display = any ? '' : 'none';
      }
    });
    if (lastGroupLabel) lastGroupLabel.style.display = visibleGroup ? '' : 'none';
  }

  // ─── Location switching ───────────────────────────────────────────
  async function setLocation(loc) {
    if (!LOCS.some(l => l.id === loc)) return;
    if (loc === activeLoc) return;
    activeLoc = loc;
    try { localStorage.setItem(LOC_KEY, loc); } catch (_) {}
    // Update picker visual state
    document.querySelectorAll('.ord-loc-btn').forEach(b => {
      const match = b.dataset.loc === loc;
      b.classList.toggle('active', match);
      b.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    // Refresh recent for this location
    orders = await loadRecentOrders(loc);
    const vendorMap = {};
    vendors.forEach(v => vendorMap[v.id] = v);
    renderRecent(orders, vendorMap);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────
  async function init() {
    if (initialized) return;
    activeLoc = resolveLocation();
    renderShell();

    // Parallel-fetch vendors + item counts + recent orders
    const [vList, counts, oList] = await Promise.all([
      loadVendors(),
      loadItemCounts(),
      loadRecentOrders(activeLoc),
    ]);
    vendors = vList;
    vendors._itemCounts = counts;  // attach as hidden prop
    orders  = oList;

    const vendorMap = {};
    vendors.forEach(v => vendorMap[v.id] = v);
    renderRecent(orders, vendorMap);
    renderVendors();
    initialized = true;
  }

  async function show() {
    if (!initialized) { return init(); }
    // Re-fetch recent orders only — vendor list changes infrequently
    // and a stale display is fine until a full app reload.
    orders = await loadRecentOrders(activeLoc);
    const vendorMap = {};
    vendors.forEach(v => vendorMap[v.id] = v);
    renderRecent(orders, vendorMap);
  }

  NX.modules.ordering = { init, show, setLocation };
  console.log('[ordering] loaded');
})();
