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
    const { data, error } = await NX.sb
      .from('order_vendors')
      .select('id, name, alias_short, email, alt_emails, managed_by, role, delivery_days, subject_template, body_template, notes, archived')
      .eq('archived', false)
      .order('name', { ascending: true });
    if (error) { console.error('[ordering] loadVendors:', error); return []; }
    return data || [];
  }

  async function loadRecentOrders(location, limit = 8) {
    if (!NX.sb) return [];
    const { data, error } = await NX.sb
      .from('orders')
      .select('id, vendor_id, location, delivery_date, status, email_sent_at, created_at, updated_at')
      .eq('location', location)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) { console.error('[ordering] loadRecentOrders:', error); return []; }
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
    el.innerHTML = `
      <div class="ord-section-label">Recent</div>
      ${list.map(o => {
        const v = vendorMap[o.vendor_id];
        const status = o.status || 'draft';
        const when = fmtRel(o.updated_at || o.created_at);
        const deliv = o.delivery_date ? fmtDateShort(o.delivery_date) : '';
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
          </button>`;
      }).join('')}`;
    el.querySelectorAll('.ord-recent-row').forEach(b => {
      b.addEventListener('click', () => openExistingOrder(b.dataset.orderId));
    });
  }

  function renderVendors() {
    const el = document.getElementById('ordVendors');
    if (!el) return;
    if (!vendors.length) {
      el.innerHTML = `<div class="ord-empty">No vendors yet. Tap + to add your first one.</div>`;
      return;
    }
    // Flat alphabetical — no manager grouping. Tap the row to start an
    // order; tap the ⋮ button to open the vendor's options sheet (edit,
    // archive). The pencil-as-separate-button felt visually noisy on a
    // long list, so options are tucked behind an overflow affordance.
    let html = '';
    for (const v of vendors) {
      const itemCount = vendors._itemCounts[v.id] || 0;
      const meta = [];
      if (itemCount) meta.push(`${itemCount} item${itemCount === 1 ? '' : 's'}`);
      else meta.push('no catalog yet');
      html += `
        <div class="ord-vendor-row-wrap">
          <button class="ord-vendor-row" data-vendor-id="${esc(v.id)}" data-vendor-name="${esc(v.name).toLowerCase()}">
            <div class="ord-vendor-main">
              <div class="ord-vendor-name">${esc(v.name)}</div>
              <div class="ord-vendor-meta">${meta.join(' · ')}</div>
            </div>
            ${v.email ? '' : '<span class="ord-vendor-warn" title="No email set">!</span>'}
            <div class="ord-arrow" aria-hidden="true">›</div>
          </button>
          <button class="ord-vendor-menu" data-vendor-id="${esc(v.id)}" aria-label="More options for ${esc(v.name)}">${dotsIcon()}</button>
        </div>
      `;
    }
    el.innerHTML = html;
    el.querySelectorAll('.ord-vendor-row').forEach(b => {
      b.addEventListener('click', () => openVendor(b.dataset.vendorId));
    });
    el.querySelectorAll('.ord-vendor-menu').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const id = b.dataset.vendorId;
        const v = vendors.find(x => x.id === id);
        if (v) showVendorMenu(v);
      });
    });
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
        <div class="ord-vmenu-title">${esc(vendor.name)}</div>
        ${vendor.email ? `<div class="ord-vmenu-sub">${esc(vendor.email)}</div>` : '<div class="ord-vmenu-sub ord-vmenu-sub-warn">No email set</div>'}
        <div class="ord-vmenu-divider"></div>
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
        if (action === 'edit')    openVendorEditor(vendor);
        else if (action === 'order') openVendor(vendor.id);
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
    showEntryLoadingShell();
    const order = await loadOrderById(orderId);
    if (!order) { if (NX.toast) NX.toast('Order not found', 'error'); closeEntry(); return; }
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
      console.error('[ordering] openExistingOrder:', e);
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
        ${readOnly ? '<div class="ord-entry-spacer"></div>' : `<button class="ord-entry-add" id="ordEntryAdd" aria-label="Add item to catalog">${plusIcon()}</button>`}
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
      if (readOnly) cloneAsNewDraft();
      else if (itemCount > 0) openReview();
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
        vendor_id:     entryState.vendor.id,
        location:      entryState.location,
        delivery_date: entryState.delivery_date || null,
        status:        'draft',
        notes:         entryState.notes || null,
        created_by:    NX.user && NX.user.id ? NX.user.id : null,
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
                   <div class="ord-recipient-warn">⚠ No email set for ${esc(vendor.name)}</div>
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

  function buildMailtoUrl(to, subject, body) {
    // Manually construct — URLSearchParams uses + for spaces but mailto: needs %20.
    const enc = s => encodeURIComponent(s).replace(/\+/g, '%20');
    return `mailto:${encodeURIComponent(to || '')}?subject=${enc(subject)}&body=${enc(body)}`;
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
        status:        'sent',
        email_to:      vendor.email,
        email_subject: subject,
        email_body:    body,
        email_sent_at: new Date().toISOString(),
        notes:         notes || null,
      };
      if (entryState.draftOrderId) {
        const { error } = await NX.sb.from('orders').update(sentPayload).eq('id', entryState.draftOrderId);
        if (error) throw error;
      } else {
        const { data, error } = await NX.sb.from('orders').insert({
          ...sentPayload,
          vendor_id: vendor.id,
          location, delivery_date: delivery_date || null,
          created_by: NX.user && NX.user.id ? NX.user.id : null,
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

    // Open mailto:
    const url = buildMailtoUrl(vendor.email, subject, body);
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
        ? { name: '', email: '', delivery_days: [], subject_template: '', body_template: '', notes: '' }
        : { ...vendor },
      items: [],
      editingItemId: null,
      overlay: null,
    };
    mountVendorEditor();
    if (!isNew) {
      try {
        editorState.items = await loadVendorCatalog(vendor.id);
      } catch (e) {
        console.error('[ordering] load items for editor:', e);
        editorState.items = [];
      }
    }
    renderVendorEditor();
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

    editorState.overlay.innerHTML = `
      <div class="ord-veditor-head">
        <button class="ord-veditor-close" aria-label="Close">${arrowLeftIcon()}</button>
        <div class="ord-veditor-title-block">
          <div class="ord-veditor-title">${isNew ? 'New vendor' : esc(v.name) || 'Edit vendor'}</div>
          ${!isNew && v.email ? `<div class="ord-veditor-subtitle">${esc(v.email)}</div>` : ''}
          ${!isNew && !v.email ? '<div class="ord-veditor-subtitle ord-veditor-subtitle-warn">No email set</div>' : ''}
        </div>
        ${!isNew ? `<div class="ord-veditor-count-chip">${editorState.items.length}<span>${editorState.items.length === 1 ? 'item' : 'items'}</span></div>` : '<div class="ord-veditor-spacer"></div>'}
      </div>
      <div class="ord-veditor-body">

        <div class="ved-section-divider"><span>Vendor</span></div>
        <div class="ord-form-field">
          <label class="ord-form-label" for="vedName">Name</label>
          <input type="text" class="ord-form-input" id="vedName" value="${esc(v.name)}" placeholder="e.g. Farm To Table" autocomplete="off">
        </div>
        <div class="ord-form-field">
          <label class="ord-form-label" for="vedEmail">Email</label>
          <input type="email" class="ord-form-input" id="vedEmail" value="${esc(v.email || '')}" placeholder="orders@vendor.com" autocomplete="off" inputmode="email">
        </div>

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
          <div class="ved-section-divider"><span>Catalog (${editorState.items.length})</span></div>
          <button class="ord-veditor-add-item-btn" id="vedAddItem">${plusIcon()}<span>Add item</span></button>
          <div class="ord-veditor-items" id="vedItemsList">
            ${renderItemsList()}
          </div>
        ` : ''}

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
    // Day pills
    overlay.querySelectorAll('.ord-day-pill').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });
    // Archive
    const arch = overlay.querySelector('#vedArchive');
    if (arch) arch.addEventListener('click', archiveVendor);
    // Add item
    const addItem = overlay.querySelector('#vedAddItem');
    if (addItem) addItem.addEventListener('click', () => {
      editorState.editingItemId = 'new';
      renderItemsAreaOnly();
      // Scroll the new form into view
      setTimeout(() => {
        const form = overlay.querySelector('.ord-vitem-editing');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    });
    // Item row interactions (delegated)
    wireItemListHandlers();
  }

  function renderItemsAreaOnly() {
    // Re-render only the items list portion to avoid losing form state
    const list = document.getElementById('vedItemsList');
    if (list) {
      list.innerHTML = renderItemsList();
      wireItemListHandlers();
    }
  }

  function renderItemsList() {
    if (!editorState) return '';
    const items = editorState.items;
    let html = '';

    // "New item" row — only when adding
    if (editorState.editingItemId === 'new') {
      html += renderItemForm({ id: '__new', item_name: '', vendor_sku: '', section: '', unit: 'ea', default_par_qty: null, pars_by_day: {}, note: '' }, true);
    }

    if (!items.length && editorState.editingItemId !== 'new') {
      html += `<div class="ord-empty">No items yet. Tap "Add item" to start the catalog.</div>`;
      return html;
    }

    for (const it of items) {
      if (editorState.editingItemId === it.id) {
        html += renderItemForm(it, false);
      } else {
        html += renderItemRow(it);
      }
    }
    return html;
  }

  function renderItemRow(item) {
    const meta = [];
    if (item.vendor_sku) meta.push(`SKU ${esc(item.vendor_sku)}`);
    if (item.section)   meta.push(esc(item.section));
    if (item.default_par_qty != null) meta.push(`par ${item.default_par_qty} ${esc(item.unit || 'ea')}`);
    return `
      <div class="ord-vitem-row" data-item-id="${esc(item.id)}">
        <div class="ord-vitem-main">
          <div class="ord-vitem-name">${esc(item.item_name)}</div>
          ${meta.length ? `<div class="ord-vitem-meta">${meta.join(' · ')}</div>` : ''}
        </div>
        <button class="ord-vitem-edit-btn" data-item-id="${esc(item.id)}" aria-label="Edit ${esc(item.item_name)}">${editIcon()}</button>
      </div>
    `;
  }

  function renderItemForm(item, isNew) {
    const days = item.pars_by_day || {};
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
            <input type="text" class="ord-form-input ied-section" value="${esc(item.section || '')}" placeholder="e.g. Dairy" autocomplete="off">
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

    // Tap edit pencil → enter edit mode for that item
    list.querySelectorAll('.ord-vitem-edit-btn').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        editorState.editingItemId = b.dataset.itemId;
        renderItemsAreaOnly();
      });
    });
    // Tap row → also enter edit (whole row tappable for accessibility)
    list.querySelectorAll('.ord-vitem-row:not(.ord-vitem-editing)').forEach(row => {
      row.addEventListener('click', () => {
        editorState.editingItemId = row.dataset.itemId;
        renderItemsAreaOnly();
      });
    });
    // Cancel
    list.querySelectorAll('.ord-vitem-cancel-btn').forEach(b => {
      b.addEventListener('click', () => {
        editorState.editingItemId = null;
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
  }

  async function saveVendor() {
    if (!editorState) return;
    const overlay = editorState.overlay;
    const name = overlay.querySelector('#vedName').value.trim();
    const email = overlay.querySelector('#vedEmail').value.trim();
    const subject = overlay.querySelector('#vedSubject').value.trim();
    const body = overlay.querySelector('#vedBody').value;
    const notes = overlay.querySelector('#vedNotes').value;
    if (!name) {
      if (NX.toast) NX.toast('Name is required', 'warn');
      return;
    }
    const dayBtns = overlay.querySelectorAll('.ord-day-pill.active');
    const days = Array.from(dayBtns).map(b => b.dataset.day);

    const payload = {
      name,
      email: email || null,
      delivery_days: days,
      subject_template: subject || null,
      body_template: body.trim() || null,
      notes: notes.trim() || null,
    };

    try {
      if (editorState.isNew) {
        const { data, error } = await NX.sb.from('order_vendors')
          .insert(payload).select('*').single();
        if (error) throw error;
        vendors.push(data);
        vendors.sort((a, b) => a.name.localeCompare(b.name));
        vendors._itemCounts[data.id] = 0;
      } else {
        const { error } = await NX.sb.from('order_vendors')
          .update(payload).eq('id', editorState.vendor.id);
        if (error) throw error;
        const cached = vendors.find(x => x.id === editorState.vendor.id);
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
    if (!editorState) return;
    const isNew = itemId === '__new';
    const list = document.getElementById('vedItemsList');
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
        const maxSort = editorState.items.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
        const { data, error } = await NX.sb.from('order_guide_items')
          .insert({ ...payload, vendor_id: editorState.vendor.id, sort_order: maxSort + 1 })
          .select('*').single();
        if (error) throw error;
        editorState.items.push(data);
        vendors._itemCounts[editorState.vendor.id] = (vendors._itemCounts[editorState.vendor.id] || 0) + 1;
      } else {
        const { error } = await NX.sb.from('order_guide_items')
          .update(payload).eq('id', itemId);
        if (error) throw error;
        const it = editorState.items.find(i => i.id === itemId);
        if (it) Object.assign(it, payload);
      }
      editorState.editingItemId = null;
      renderVendorEditor();
      if (NX.toast) NX.toast(isNew ? 'Item added' : 'Item saved', 'info', 1000);
    } catch (e) {
      console.error('[ordering] saveItemFromForm:', e);
      if (NX.toast) NX.toast('Failed to save item', 'error');
    }
  }

  async function deleteItem(itemId) {
    if (!editorState || itemId === '__new') return;
    const it = editorState.items.find(i => i.id === itemId);
    if (!it) return;
    if (!confirm(`Delete "${it.item_name}"?`)) return;
    try {
      const { error } = await NX.sb.from('order_guide_items')
        .delete().eq('id', itemId);
      if (error) throw error;
      editorState.items = editorState.items.filter(i => i.id !== itemId);
      vendors._itemCounts[editorState.vendor.id] = Math.max(0, (vendors._itemCounts[editorState.vendor.id] || 1) - 1);
      editorState.editingItemId = null;
      renderVendorEditor();
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
  function plusIcon() {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  }
  function trashIcon() {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  }
  function dotsIcon() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>`;
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
  }

  NX.modules.ordering = {
    init, show, setLocation, openVendor, openExistingOrder, closeEntry,
    openVendorEditor, closeVendorEditor,
  };
  console.log('[ordering] loaded (Phase B — vendor + item management)');
})();
