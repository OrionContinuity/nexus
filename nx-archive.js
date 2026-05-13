/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Archive — unified soft-deleted-items viewer
   ──────────────────────────────────────────────────
   Single overlay surface that shows everything currently archived
   across the duties tools (Ordering + Cleaning today; future modules
   plug in via NX.archive.register). Each tool contributes:

     • a tab label
     • a fetcher returning archived rows
     • a row renderer (HTML string)
     • a restorer (id → unarchive)

   The user opens the overlay from the "Archive" button that lives in
   the duties view header — one button, both tools' archives reachable.

   Exposes: NX.archive = { open, close, register }
   Loaded via index.html. Idempotent. No side effects on import.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  // v18.11 fix — was: `if (window.NX && NX.archive) return;` which throws
  // ReferenceError because the `const NX` below is hoisted into TDZ for
  // the whole function block, so referencing NX on this line crashes the
  // IIFE silently (when window.NX is already truthy, which it always is
  // by the time this script runs — domain.js etc. set window.NX earlier).
  // Result: NX.archive was NEVER registered. Cleaning archive button
  // showed "Archive unavailable" because consumers couldn't see it.
  if (window.NX && window.NX.archive) return;
  const NX = window.NX = window.NX || {};
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  /* Registry of pluggable tabs. Each module calls register() at init
     time with a config; we render whatever's registered at open(). */
  const tabs = [];
  /** @typedef {{
   *   key: string,        // unique identifier, e.g. 'orders'
   *   label: string,      // tab label, e.g. 'Orders'
   *   icon?: string,      // SVG inner contents (optional)
   *   fetch: () => Promise<Array>,    // returns rows to display
   *   renderRow: (row, ctx) => string, // HTML for one row (no outer wrapper)
   *   restore: (id) => Promise<void>, // unarchive
   *   empty?: string,     // empty-state message
   * }} ArchiveTab */

  function register(tab) {
    if (!tab || !tab.key) return;
    // Replace if already registered (re-register on re-init)
    const existing = tabs.findIndex(t => t.key === tab.key);
    if (existing >= 0) tabs[existing] = tab;
    else tabs.push(tab);
  }

  let activeKey = null;  // remembered between open/close

  async function open() {
    close();  // remove any existing overlay first
    if (!tabs.length) {
      if (NX.toast) NX.toast('Nothing to archive yet', 'info', 1500);
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'nx-archive-overlay';
    overlay.innerHTML = `
      <div class="nx-archive-backdrop"></div>
      <div class="nx-archive-sheet" role="dialog" aria-label="Archive">
        <div class="nx-archive-head">
          <div class="nx-archive-title-block">
            <div class="nx-archive-title">Archive</div>
            <div class="nx-archive-sub">Soft-deleted items, restorable any time</div>
          </div>
          <button class="nx-archive-close" aria-label="Close archive">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="nx-archive-tabs" role="tablist">
          ${tabs.map(t => `
            <button class="nx-archive-tab" data-tab-key="${esc(t.key)}" role="tab">
              <span class="nx-archive-tab-label">${esc(t.label)}</span>
              <span class="nx-archive-tab-count" data-archive-count></span>
            </button>
          `).join('')}
        </div>
        <div class="nx-archive-body">
          <div class="nx-archive-list" id="nxArchiveList">
            <div class="nx-archive-loading">Loading…</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Wiring
    overlay.querySelector('.nx-archive-backdrop').addEventListener('click', close);
    overlay.querySelector('.nx-archive-close').addEventListener('click', close);

    // Tab clicks switch which contributor's data is loaded
    overlay.querySelectorAll('.nx-archive-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeKey = btn.dataset.tabKey;
        switchToTab(activeKey);
      });
    });

    // ESC to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Default to last-used tab, or first registered
    const initial = tabs.find(t => t.key === activeKey)?.key || tabs[0].key;
    activeKey = initial;
    switchToTab(initial);

    // Pre-fetch counts for the tab badges
    fetchAllCounts(overlay);
  }

  async function fetchAllCounts(overlay) {
    for (const t of tabs) {
      try {
        const rows = await t.fetch();
        const badge = overlay.querySelector(`.nx-archive-tab[data-tab-key="${t.key}"] [data-archive-count]`);
        if (badge) {
          const n = (rows || []).length;
          badge.textContent = String(n);
          badge.classList.toggle('is-zero', n === 0);
        }
      } catch (e) {
        // Silent — count badge optional. Console for diagnosis.
        console.warn('[archive] count fetch failed for', t.key, e);
      }
    }
  }

  async function switchToTab(key) {
    const overlay = document.querySelector('.nx-archive-overlay');
    if (!overlay) return;
    const tab = tabs.find(t => t.key === key);
    if (!tab) return;

    // Visual active state
    overlay.querySelectorAll('.nx-archive-tab').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tabKey === key);
    });

    const list = overlay.querySelector('#nxArchiveList');
    list.innerHTML = '<div class="nx-archive-loading">Loading…</div>';

    let rows = [];
    try {
      rows = await tab.fetch();
    } catch (e) {
      console.error('[archive] fetch failed', e);
      list.innerHTML = `<div class="nx-archive-empty">Could not load: ${esc(e.message || 'error')}</div>`;
      return;
    }

    if (!rows || !rows.length) {
      list.innerHTML = `<div class="nx-archive-empty">${esc(tab.empty || 'Nothing archived here.')}</div>`;
      return;
    }

    // Render every row using the tab's renderRow function. Wrapper
    // <div class="nx-archive-row"> provides consistent layout; restore
    // button is appended automatically.
    list.innerHTML = rows.map(row => `
      <div class="nx-archive-row" data-row-id="${esc(row.id)}">
        <div class="nx-archive-row-body">${tab.renderRow(row, { esc })}</div>
        <button class="nx-archive-restore" data-restore-id="${esc(row.id)}" type="button">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-5"/>
          </svg>
          <span>Restore</span>
        </button>
      </div>
    `).join('');

    // Wire restore buttons
    list.querySelectorAll('.nx-archive-restore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.restoreId;
        const labelEl = btn.querySelector('span');
        const original = labelEl ? labelEl.textContent : '';
        btn.disabled = true;
        if (labelEl) labelEl.textContent = 'Restoring…';
        try {
          await tab.restore(id);
          // Remove the row from the list — fast feedback
          const row = btn.closest('.nx-archive-row');
          if (row) row.remove();
          // Decrement count badge
          const badge = overlay.querySelector(`.nx-archive-tab[data-tab-key="${key}"] [data-archive-count]`);
          if (badge) {
            const n = parseInt(badge.textContent, 10) || 1;
            badge.textContent = String(Math.max(0, n - 1));
            badge.classList.toggle('is-zero', n - 1 === 0);
          }
          // If list is now empty, show empty state
          if (!list.querySelector('.nx-archive-row')) {
            list.innerHTML = `<div class="nx-archive-empty">${esc(tab.empty || 'Nothing archived here.')}</div>`;
          }
          if (NX.toast) NX.toast('Restored', 'info', 1400);
        } catch (e) {
          console.error('[archive] restore failed', e);
          btn.disabled = false;
          if (labelEl) labelEl.textContent = original;
          if (NX.toast) NX.toast('Could not restore: ' + (e.message || ''), 'error', 4000);
        }
      });
    });
  }

  function close() {
    const overlay = document.querySelector('.nx-archive-overlay');
    if (overlay) overlay.remove();
  }

  NX.archive = { open, close, register };
})();
