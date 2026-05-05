/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Context Menu System v1
   
   Universal three-dot (⋯) menu that appears on:
     - Every equipment grid card (top-right)
     - Every equipment list row (right side)
     - Every equipment detail header (replaces "More" overflow)
     - Every part row in the Parts tab
     - Every ticket row
     - Every kanban card
     - Every node detail panel
   
   Menu contents per item type:
     • Edit
     • Print Label (HTML print, browser dialog)
     • Print Avery Sheet (10-up Avery 5163, HTML print)
     • Audit Log (per-item history: edits, dispatches, tickets, mentions)
     • Delete (soft delete → moves to Log → Deleted Items)
   
   Soft delete writes is_deleted=true, deleted_at=now(), deleted_by=user,
   deleted_reason=optional-prompt. Item disappears from active views,
   stays in DB indefinitely, can be restored from Log → Deleted Items.
   
   Load order: AFTER equipment.js, equipment-fixes.js, log.js. Patches all.
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Icon helper ──────────────────────────────────────────────────
     The context menu's icon column accepts raw HTML, so we pass SVG
     line-art instead of emoji glyphs. Same Lucide path family used
     in equipment.js. Defined locally so this file doesn't depend on
     load order with equipment.js (which has its own ACTION_ICONS). */
  const CM_ICONS = {
    edit:       '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    sparkles:   '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    family:     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    audit:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    trash:      '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    documents:  '<path d="M14 4.272A2 2 0 0 1 13 6h-3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3a2 2 0 0 1-1-1.728"/><path d="M16 2H8a2 2 0 0 0-2 2v16"/>',
    label:      '<path d="M3 8h18l-2 11H5L3 8Z"/><path d="M5 8V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/>',
    phone:      '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    ticket:     '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>',
    pen:        '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    settings:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    clipboard:  '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
    note:       '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    calendar:   '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    cog:        '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    bolt:       '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    star:       '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    refresh:    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>',
    close:      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    printer:    '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    cart:       '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
    bolt:       '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    wrench:     '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.121 2.121 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    search:     '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    email:      '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    phone2:     '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  };
  function cmSvg(key, size = '15px') {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex-shrink:0">${CM_ICONS[key] || ''}</svg>`;
  }

  function whenReady(check, fn, maxWait = 5000) {
    const start = Date.now();
    const interval = setInterval(() => {
      if (check()) { clearInterval(interval); fn(); }
      else if (Date.now() - start > maxWait) { clearInterval(interval); }
    }, 100);
  }

  whenReady(
    () => NX && NX.modules && NX.sb,
    () => init()
  );

  function init() {
    console.log('[ctx-menu] initializing universal context menu system');
    installContextMenuOnEquipmentCards();
    installContextMenuOnEquipmentDetail();
    installContextMenuOnParts();
    installPrintEverythingOnOverview();
    installTimelineCardClick();
    patchSoftDelete();
    patchLogDeletedTab();
    patchPmApprovalToLinkMaintenance();
    console.log('[ctx-menu] all hooks installed');
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PRINT EVERYTHING button on Overview tab — prominent call-to-action
     Lives at the top-right of the Overview panel so it's the first thing
     you see when you need a full equipment report.
     ═════════════════════════════════════════════════════════════════════════ */

  function installPrintEverythingOnOverview() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const panels = node.matches?.('[data-panel="overview"]')
            ? [node]
            : Array.from(node.querySelectorAll?.('[data-panel="overview"]') || []);
          panels.forEach(addPrintEverythingButton);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function addPrintEverythingButton(overviewPanel) {
    if (overviewPanel.dataset.printEverythingAdded === '1') return;
    overviewPanel.dataset.printEverythingAdded = '1';

    // Get equipment ID — walk up to modal with data-eq-id, or parse from an onclick
    const modal = overviewPanel.closest('.eq-modal, .eq-detail');
    let equipId = modal?.dataset?.eqId || overviewPanel.dataset.eqId;
    if (!equipId) {
      // Scan for any onclick inside the panel that carries an ID
      const anyBtn = overviewPanel.querySelector('button[onclick*="equipment"]');
      const m = anyBtn?.getAttribute('onclick')?.match(/['"]([\w-]+)['"]/);
      if (m) equipId = m[1];
    }
    // Fallback: ask surrounding modal's action bar
    if (!equipId) {
      const bar = modal?.querySelector('.eq-actionbar-clean, .eq-detail-actions');
      if (bar) {
        const b = bar.querySelector('button[onclick]');
        const m = b?.getAttribute('onclick')?.match(/['"]([\w-]+)['"]/);
        if (m) equipId = m[1];
      }
    }

    // Build the button. Prepend to the panel so it sits at the top.
    const wrap = document.createElement('div');
    wrap.className = 'eq-print-everything-wrap';
    wrap.innerHTML = `
      <button class="eq-print-everything-btn" id="eqPrintEverythingBtn">
        <span class="eq-pe-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.272A2 2 0 0 1 13 6h-3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3a2 2 0 0 1-1-1.728"/><path d="M16 2H8a2 2 0 0 0-2 2v16"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="15" y2="15"/></svg></span>
        <span class="eq-pe-body">
          <span class="eq-pe-title">Print EVERYTHING</span>
          <span class="eq-pe-sub">Complete dossier — specs, parts, timeline, all</span>
        </span>
        <span class="eq-pe-arrow"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span>
      </button>
    `;
    overviewPanel.insertBefore(wrap, overviewPanel.firstChild);

    wrap.querySelector('#eqPrintEverythingBtn').addEventListener('click', () => {
      // Try again to resolve the equipId if we didn't find it at render time
      let id = equipId;
      if (!id) {
        const bar = document.querySelector('.eq-actionbar-clean');
        const b = bar?.querySelector('button[onclick]');
        const m = b?.getAttribute('onclick')?.match(/['"]([\w-]+)['"]/);
        if (m) id = m[1];
      }
      if (id && typeof printEverything === 'function') {
        printEverything(id);
      } else {
        toast('Could not identify equipment', 'error');
      }
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     UTILITIES
     ═════════════════════════════════════════════════════════════════════════ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type, duration) {
    if (NX.toast) NX.toast(msg, type, duration);
    else console.log('[ctx-menu]', type || 'info', msg);
  }

  function userName() {
    return NX.currentUser?.name || 'Unknown';
  }

  /* ═════════════════════════════════════════════════════════════════════════
     CONTEXT MENU CORE — opens a popup menu anchored to a button
     ═════════════════════════════════════════════════════════════════════════ */

  let openMenu = null;

  function closeOpenMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
  }

  document.addEventListener('click', (e) => {
    if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.ctx-menu-trigger')) {
      closeOpenMenu();
    }
  }, { capture: true });

  // Open the universal three-dot menu near the trigger button.
  // items = [{ icon, label, action, danger?, hidden? }, ...]
  function openContextMenu(triggerEl, items) {
    closeOpenMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    items.filter(it => !it.hidden).forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'ctx-menu-item' + (item.danger ? ' danger' : '');
      btn.innerHTML = `
        <span class="ctx-menu-icon">${item.icon || ''}</span>
        <span class="ctx-menu-label">${esc(item.label)}</span>
      `;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeOpenMenu();
        try { item.action(); } catch (err) { console.error('[ctx-menu] action error:', err); }
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    openMenu = menu;

    // Position near the trigger
    const rect = triggerEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    
    // Default: drop below + right-align with trigger
    let top = rect.bottom + 6;
    let left = rect.right - menuRect.width;
    
    // Flip to above if no room below
    if (top + menuRect.height > vh - 16) {
      top = rect.top - menuRect.height - 6;
    }
    // Keep on screen horizontally
    if (left < 8) left = 8;
    if (left + menuRect.width > vw - 8) left = vw - menuRect.width - 8;
    
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    requestAnimationFrame(() => menu.classList.add('open'));
  }

  // Build the standard ⋯ icon button used everywhere
  function makeContextTrigger(onClick) {
    const btn = document.createElement('button');
    btn.className = 'ctx-menu-trigger';
    btn.setAttribute('aria-label', 'More options');
    btn.innerHTML = '<span class="ctx-menu-trigger-dots">⋯</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(btn);
    });
    return btn;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     ITEM-SPECIFIC MENUS
     ═════════════════════════════════════════════════════════════════════════ */

  function buildEquipmentMenu(equipId, equipName) {
    return [
      { icon: cmSvg('pen'), label: 'Edit', action: () => NX.modules.equipment?.edit?.(equipId) },
      { icon: cmSvg('documents'), label: 'Print EVERYTHING', action: () => printEverything(equipId) },
      { icon: cmSvg('printer'), label: 'Print this Tab', action: () => printActiveTab(equipId) },
      { icon: cmSvg('label'), label: 'Print Single Label', action: () => printSingleLabel(equipId) },
      { icon: cmSvg('label'), label: 'Print Avery Sheet (10×)', action: () => printAverySheet(equipId) },
      { icon: cmSvg('cart'), label: 'Shopping List', action: () => exportShoppingList(equipId) },
      { icon: cmSvg('sparkles'), label: 'Extract Parts from Manual', action: () => triggerExtractFromManual(equipId) },
      { icon: cmSvg('family'), label: 'Set Parent / Add Child', action: () => openFamilyManager(equipId, equipName) },
      { icon: cmSvg('audit'), label: 'Audit Log', action: () => openItemAuditLog('equipment', equipId, equipName) },
      { icon: cmSvg('trash'), label: 'Delete', danger: true, action: () => softDeleteWithConfirm('equipment', equipId, equipName) }
    ];
  }

  function buildPartMenu(partId, partName, equipId) {
    return [
      { icon: cmSvg('pen'), label: 'Edit', action: () => NX.modules.equipment?.editPart?.(partId) },
      { icon: cmSvg('audit'), label: 'Audit Log', action: () => openItemAuditLog('equipment_parts', partId, partName) },
      { icon: cmSvg('trash'), label: 'Delete', danger: true, action: () => softDeleteWithConfirm('equipment_parts', partId, partName, equipId) }
    ];
  }

  /* ═════════════════════════════════════════════════════════════════════════
     INSTALL: ⋯ on equipment grid cards
     ═════════════════════════════════════════════════════════════════════════ */

  function installContextMenuOnEquipmentCards() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const cards = node.matches?.('.eq-card') 
            ? [node]
            : Array.from(node.querySelectorAll?.('.eq-card') || []);
          cards.forEach(addContextMenuToCard);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial pass for cards already in DOM
    document.querySelectorAll('.eq-card').forEach(addContextMenuToCard);
  }

  function addContextMenuToCard(card) {
    if (card.dataset.ctxMenuAdded === '1') return;
    card.dataset.ctxMenuAdded = '1';
    const equipId = card.dataset.eqId;
    if (!equipId) return;

    const trigger = makeContextTrigger((btn) => {
      const titleEl = card.querySelector('.eq-card-title');
      const equipName = titleEl ? titleEl.textContent.trim() : 'this item';
      openContextMenu(btn, buildEquipmentMenu(equipId, equipName));
    });
    trigger.classList.add('ctx-menu-trigger-on-card');
    
    // Make sure card-top is positioned so the absolute trigger lands properly
    const top = card.querySelector('.eq-card-top');
    if (top) {
      top.style.position = 'relative';
      top.appendChild(trigger);
    } else {
      card.style.position = 'relative';
      card.appendChild(trigger);
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     INSTALL: ⋯ on equipment detail bottom action bar (replaces "More")
     ═════════════════════════════════════════════════════════════════════════ */

  function installContextMenuOnEquipmentDetail() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const bars = node.matches?.('.eq-actionbar-clean')
            ? [node]
            : Array.from(node.querySelectorAll?.('.eq-actionbar-clean') || []);
          bars.forEach(replaceMoreWithContextMenu);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function replaceMoreWithContextMenu(bar) {
    // Wait one tick so equipment-fixes.js has finished building the bar
    setTimeout(() => {
      if (bar.dataset.ctxMenuMoreReplaced === '1') return;
      bar.dataset.ctxMenuMoreReplaced = '1';

      const moreWrap = bar.querySelector('.eq-actionbar-more-wrap');
      if (!moreWrap) return;

      // Get the equipment ID from any onclick handler in the bar
      const equipId = extractEquipIdFromBar(bar);

      // Get the equipment name from the modal header
      const modal = bar.closest('.eq-modal, .eq-detail');
      const titleEl = modal?.querySelector('.eq-detail-head h2, .eq-detail-title h2');
      const equipName = titleEl ? titleEl.textContent.trim() : 'this equipment';

      // Find the existing menu items so we can preserve any third-party additions
      const existingMenuItems = Array.from(moreWrap.querySelectorAll('.eq-actionbar-menu-item'));
      const extraItems = existingMenuItems.map(item => ({
        icon: '',
        label: item.textContent.trim(),
        action: () => item.click(),
        // Extra items from other modules — leave their styling alone
        // but if they look like a delete, route to soft delete instead
        skipForDelete: /delete/i.test(item.textContent)
      })).filter(it => !it.skipForDelete);

      // Build new ⋯ menu trigger that replaces the More button
      const newTrigger = document.createElement('button');
      newTrigger.className = 'eq-actionbar-btn eq-actionbar-more ctx-menu-trigger';
      newTrigger.innerHTML = '<span class="eq-ab-icon">⋯</span><span class="eq-ab-label">More</span>';
      newTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Build menu: standard equipment items + any extras from other modules
        const menuItems = buildEquipmentMenu(equipId, equipName);
        // Insert extras before the Delete entry
        const deleteIdx = menuItems.findIndex(it => it.danger);
        if (extraItems.length && deleteIdx > -1) {
          menuItems.splice(deleteIdx, 0, ...extraItems);
        } else if (extraItems.length) {
          menuItems.push(...extraItems);
        }
        openContextMenu(newTrigger, menuItems);
      });

      moreWrap.replaceWith(newTrigger);
    }, 100);
  }

  function extractEquipIdFromBar(bar) {
    const buttons = bar.querySelectorAll('button[onclick]');
    for (const b of buttons) {
      const m = b.getAttribute('onclick').match(/['"]([\w-]+)['"]/);
      if (m) return m[1];
    }
    // Fallback: look for data attribute on parent
    const wrapper = bar.closest('[data-eq-id]');
    if (wrapper) return wrapper.dataset.eqId;
    return null;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     INSTALL: ⋯ on individual part rows in the Parts tab
     ═════════════════════════════════════════════════════════════════════════ */

  function installContextMenuOnParts() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const parts = node.matches?.('.eq-part')
            ? [node]
            : Array.from(node.querySelectorAll?.('.eq-part') || []);
          parts.forEach(addContextMenuToPart);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function addContextMenuToPart(partEl) {
    if (partEl.dataset.ctxMenuAdded === '1') return;
    partEl.dataset.ctxMenuAdded = '1';

    // Extract part ID from the existing edit/delete buttons
    const editBtn = partEl.querySelector('button[onclick*="editPart"]');
    const deleteBtn = partEl.querySelector('button[onclick*="deletePart"]');
    if (!editBtn && !deleteBtn) return;
    const onclick = (editBtn || deleteBtn).getAttribute('onclick');
    const ids = onclick.match(/['"]([\w-]+)['"]/g);
    const partId = ids?.[0]?.replace(/['"]/g, '');
    const equipId = ids?.[1]?.replace(/['"]/g, '');
    if (!partId) return;

    const partName = partEl.querySelector('.eq-part-name')?.textContent.trim() || 'this part';

    // Hide the original edit + delete buttons
    if (editBtn) editBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';

    // Add a ⋯ trigger at TOP-RIGHT corner of the part card
    const trigger = makeContextTrigger((btn) => {
      openContextMenu(btn, buildPartMenu(partId, partName, equipId));
    });
    trigger.classList.add('ctx-menu-trigger-on-part');
    
    // Anchor the part as a positioning context, then absolute-position the
    // trigger in its top-right.
    partEl.style.position = 'relative';
    partEl.appendChild(trigger);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     SOFT DELETE — replaces hard DELETE everywhere
     
     Maps table → friendly type name + reload-after callback.
     ═════════════════════════════════════════════════════════════════════════ */

  const TABLE_META = {
    equipment: { 
      label: 'Equipment', 
      reload: () => { closeAnyEquipmentDetail(); NX.modules.equipment?.refresh?.() || NX.modules.equipment?.show?.(); }
    },
    equipment_parts: { 
      label: 'Part', 
      reload: (extra) => { if (extra) NX.modules.equipment?.show?.(extra); }
    },
    nodes: { 
      label: 'Node', 
      reload: () => NX.brain?.rebuild?.()
    },
    tickets: { 
      label: 'Ticket', 
      reload: () => NX.modules.tickets?.refresh?.() 
    },
    kanban_cards: { 
      label: 'Card', 
      reload: () => NX.modules.board?.refresh?.() 
    },
    contractor_events: { 
      label: 'Event', 
      reload: () => {} 
    }
  };

  function closeAnyEquipmentDetail() {
    document.querySelectorAll('.eq-modal.active').forEach(m => m.classList.remove('active'));
  }

  async function softDeleteWithConfirm(table, id, name, extraContext) {
    const meta = TABLE_META[table];
    if (!meta) {
      toast('Unknown item type', 'error');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'ctx-confirm-modal';
    modal.innerHTML = `
      <div class="ctx-confirm-bg"></div>
      <div class="ctx-confirm-card">
        <div class="ctx-confirm-icon">${cmSvg("trash", "32px")}</div>
        <div class="ctx-confirm-title">Delete ${esc(meta.label)}?</div>
        <div class="ctx-confirm-name">${esc(name)}</div>
        <div class="ctx-confirm-msg">
          This will move it to <strong>Log → Deleted</strong>. 
          You can restore it any time. Nothing is permanently lost.
        </div>
        <div class="ctx-confirm-reason-wrap">
          <label class="ctx-confirm-reason-label">Reason (optional)</label>
          <input type="text" class="ctx-confirm-reason" id="ctxConfirmReason" 
            placeholder="Why are you deleting this?" maxlength="200">
        </div>
        <div class="ctx-confirm-actions">
          <button class="ctx-confirm-cancel" id="ctxConfirmCancel">Cancel</button>
          <button class="ctx-confirm-delete" id="ctxConfirmDelete">Move to Trash</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.ctx-confirm-bg').addEventListener('click', close);
    modal.querySelector('#ctxConfirmCancel').addEventListener('click', close);
    
    modal.querySelector('#ctxConfirmDelete').addEventListener('click', async () => {
      const reason = modal.querySelector('#ctxConfirmReason').value.trim();
      const btn = modal.querySelector('#ctxConfirmDelete');
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      try {
        const updates = {
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: userName(),
          deleted_reason: reason || null
        };
        const { error } = await NX.sb.from(table).update(updates).eq('id', id);
        if (error) throw error;

        // Log the deletion event to daily_logs for audit
        try {
          await NX.sb.from('daily_logs').insert({
            entry: `🗑 [DELETE] ${userName()} moved ${meta.label} "${name}" to trash${reason ? ' — ' + reason : ''}`
          });
        } catch (_) {}

        toast(`${meta.label} moved to trash`, 'info');
        close();
        meta.reload(extraContext);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Move to Trash';
        toast('Delete failed: ' + e.message, 'error');
      }
    });

    // Auto-focus the reason field after a moment
    setTimeout(() => modal.querySelector('#ctxConfirmReason')?.focus(), 200);
  }

  // Restore a soft-deleted item
  async function restoreItem(table, id, name) {
    try {
      const updates = {
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        deleted_reason: null
      };
      const { error } = await NX.sb.from(table).update(updates).eq('id', id);
      if (error) throw error;
      try {
        await NX.sb.from('daily_logs').insert({
          entry: `♻ [RESTORE] ${userName()} restored "${name}" from trash`
        });
      } catch (_) {}
      toast('Restored ✓', 'success');
      // Refresh the deleted-items list
      refreshDeletedItemsList();
    } catch (e) {
      toast('Restore failed: ' + e.message, 'error');
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PATCH: existing delete functions to redirect to soft delete
     ═════════════════════════════════════════════════════════════════════════ */

  function patchSoftDelete() {
    // Wait until equipment module is fully loaded, then override its delete fns
    whenReady(() => NX.modules?.equipment?.deleteEquipment, () => {
      const original = NX.modules.equipment.deleteEquipment;
      NX.modules.equipment.deleteEquipment = function(id) {
        // Find the equipment to get its name
        const eq = NX.modules.equipment._allEquipment?.find?.(e => e.id === id) ||
                   { name: 'this equipment' };
        softDeleteWithConfirm('equipment', id, eq.name);
      };
      console.log('[ctx-menu] patched equipment.deleteEquipment → soft delete');
    });

    whenReady(() => NX.modules?.equipment?.deletePart, () => {
      const original = NX.modules.equipment.deletePart;
      NX.modules.equipment.deletePart = function(partId, equipId) {
        softDeleteWithConfirm('equipment_parts', partId, 'this part', equipId);
      };
      console.log('[ctx-menu] patched equipment.deletePart → soft delete');
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PER-ITEM AUDIT LOG MODAL
     
     Shows EVERYTHING that happened to a specific item:
       • created_at + creator
       • soft-delete events (if any)
       • dispatches (for equipment)
       • tickets that mention/reference this item
       • daily_logs entries that mention it by name
       • ai_actions that touched it
     ═════════════════════════════════════════════════════════════════════════ */

  async function openItemAuditLog(table, id, name) {
    const modal = document.createElement('div');
    modal.className = 'ctx-audit-modal';
    modal.innerHTML = `
      <div class="ctx-audit-bg"></div>
      <div class="ctx-audit-card">
        <div class="ctx-audit-header">
          <div class="ctx-audit-title">${cmSvg("audit", "14px")} Activity Log</div>
          <button class="ctx-audit-close">${cmSvg("close", "14px")}</button>
        </div>
        <div class="ctx-audit-subject">${esc(name)}</div>
        <div class="ctx-audit-body" id="ctxAuditBody">Loading history…</div>
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.ctx-audit-close').addEventListener('click', close);
    modal.querySelector('.ctx-audit-bg').addEventListener('click', close);

    const body = modal.querySelector('#ctxAuditBody');
    const events = await collectItemAuditEvents(table, id, name);

    if (!events.length) {
      body.innerHTML = '<div class="ctx-audit-empty">No history found yet.</div>';
      return;
    }

    body.innerHTML = events.map(ev => `
      <div class="ctx-audit-event ${ev.type}">
        <div class="ctx-audit-event-icon">${ev.icon}</div>
        <div class="ctx-audit-event-body">
          <div class="ctx-audit-event-title">${esc(ev.title)}</div>
          ${ev.detail ? `<div class="ctx-audit-event-detail">${esc(ev.detail)}</div>` : ''}
          <div class="ctx-audit-event-meta">
            ${ev.who ? esc(ev.who) + ' · ' : ''}${formatDate(ev.when)}
          </div>
        </div>
      </div>
    `).join('');
  }

  async function collectItemAuditEvents(table, id, name) {
    const events = [];

    try {
      // 1. The item itself (creation)
      const { data: item } = await NX.sb.from(table).select('*').eq('id', id).single();
      if (item?.created_at) {
        events.push({
          type: 'create', icon: cmSvg('sparkles'),
          title: 'Created',
          detail: null,
          who: item.created_by || item.reported_by || null,
          when: item.created_at
        });
      }
      if (item?.is_deleted && item?.deleted_at) {
        events.push({
          type: 'delete', icon: cmSvg('trash'),
          title: 'Moved to trash',
          detail: item.deleted_reason || null,
          who: item.deleted_by,
          when: item.deleted_at
        });
      }

      // 2. AI actions affecting this row
      try {
        const { data: ai } = await NX.sb.from('ai_actions')
          .select('tool_name, reasoning, created_at, user_id, result_status')
          .eq('affected_table', table)
          .eq('affected_row_id', String(id))
          .order('created_at', { ascending: false })
          .limit(50);
        (ai || []).forEach(row => events.push({
          type: 'ai', icon: cmSvg('sparkles'),
          title: `AI: ${row.tool_name}`,
          detail: row.reasoning || null,
          who: 'AI · status: ' + row.result_status,
          when: row.created_at
        }));
      } catch (_) {}

      // 3. For equipment: dispatches + maintenance
      if (table === 'equipment') {
        try {
          const { data: dispatches } = await NX.sb.from('dispatch_events')
            .select('*').eq('equipment_id', id).order('dispatched_at', { ascending: false });
          (dispatches || []).forEach(d => events.push({
            type: 'dispatch', icon: cmSvg('phone'),
            title: `Dispatched: ${d.contractor_name || 'Unknown'}`,
            detail: d.issue_description || null,
            who: d.dispatched_by,
            when: d.dispatched_at
          }));
        } catch (_) {}
        try {
          const { data: maint } = await NX.sb.from('equipment_maintenance')
            .select('*').eq('equipment_id', id).order('event_date', { ascending: false });
          (maint || []).forEach(m => events.push({
            type: 'service', icon: cmSvg('wrench'),
            title: m.event_type || 'Service',
            detail: m.notes || null,
            who: m.performed_by || null,
            when: m.event_date || m.created_at
          }));
        } catch (_) {}
      }

      // 4. Daily logs that mention this item by name (best-effort fuzzy match)
      if (name && name.length > 3) {
        try {
          const { data: logs } = await NX.sb.from('daily_logs')
            .select('entry, created_at')
            .ilike('entry', `%${name}%`)
            .order('created_at', { ascending: false })
            .limit(30);
          (logs || []).forEach(l => events.push({
            type: 'log', icon: cmSvg('note'),
            title: 'Mentioned in log',
            detail: l.entry,
            who: null,
            when: l.created_at
          }));
        } catch (_) {}
      }

      // 5. Tickets referencing this equipment in title/notes
      if (table === 'equipment' && name) {
        try {
          const { data: tickets } = await NX.sb.from('tickets')
            .select('title, notes, status, created_at, reported_by')
            .or(`title.ilike.%${name}%,notes.ilike.%${name}%`)
            .order('created_at', { ascending: false })
            .limit(20);
          (tickets || []).forEach(t => events.push({
            type: 'ticket', icon: cmSvg('ticket'),
            title: `Ticket: ${t.title || 'Untitled'}`,
            detail: (t.notes || '').slice(0, 200),
            who: t.reported_by + ' · ' + (t.status || 'open'),
            when: t.created_at
          }));
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[ctx-menu] audit collect error:', e);
    }

    // Sort all events newest-first
    events.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
    return events;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return diffDay + 'd ago';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     LOG TAB → DELETED ITEMS sub-tab + search
     
     Adds a "Deleted" filter chip to log.js's filter bar. When selected,
     queries deleted_items_unified view and renders restore-able rows.
     Also adds a search input that filters across all rows.
     ═════════════════════════════════════════════════════════════════════════ */

  function patchLogDeletedTab() {
    whenReady(
      () => document.getElementById('feedFilters'),
      () => {
        addDeletedFilterChip();
        addSearchInput();
      }
    );
  }

  function addDeletedFilterChip() {
    const bar = document.getElementById('feedFilters');
    if (!bar || bar.querySelector('[data-filter="deleted"]')) return;
    const chip = document.createElement('button');
    chip.className = 'feed-chip ctx-deleted-chip';
    chip.dataset.filter = 'deleted';
    chip.innerHTML = cmSvg('trash','11px') + ' Deleted';
    chip.addEventListener('click', async () => {
      // Toggle active class on chip
      bar.querySelectorAll('.feed-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      await renderDeletedItemsView();
    });
    bar.appendChild(chip);
  }

  function addSearchInput() {
    const feedView = document.getElementById('feedList') || document.querySelector('.feed-list');
    if (!feedView) return;
    if (document.getElementById('ctxFeedSearch')) return;
    const wrap = document.createElement('div');
    wrap.className = 'ctx-feed-search-wrap';
    wrap.innerHTML = `
      <input type="text" id="ctxFeedSearch" class="ctx-feed-search" 
        placeholder="Search log…" autocomplete="off">
    `;
    feedView.parentElement?.insertBefore(wrap, feedView);
    
    let debounceTimer;
    document.getElementById('ctxFeedSearch').addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const q = e.target.value.trim().toLowerCase();
      debounceTimer = setTimeout(() => filterFeedRows(q), 200);
    });
  }

  function filterFeedRows(q) {
    const list = document.getElementById('feedList') || document.querySelector('.feed-list');
    if (!list) return;
    const rows = list.querySelectorAll('.feed-row, .ctx-deleted-row');
    let shown = 0;
    rows.forEach(row => {
      if (!q) { row.style.display = ''; shown++; return; }
      const text = row.textContent.toLowerCase();
      const match = text.includes(q);
      row.style.display = match ? '' : 'none';
      if (match) shown++;
    });
  }

  let currentDeletedItems = [];

  async function renderDeletedItemsView() {
    const list = document.getElementById('feedList') || document.querySelector('.feed-list');
    if (!list) return;
    list.innerHTML = '<div class="ctx-deleted-loading">Loading deleted items…</div>';

    try {
      const { data, error } = await NX.sb.from('deleted_items_unified')
        .select('*')
        .order('deleted_at', { ascending: false });
      if (error) throw error;
      currentDeletedItems = data || [];
      paintDeletedList();
    } catch (e) {
      list.innerHTML = `<div class="ctx-deleted-error">Could not load deleted items: ${esc(e.message)}</div>`;
    }
  }

  function paintDeletedList() {
    const list = document.getElementById('feedList') || document.querySelector('.feed-list');
    if (!list) return;
    if (!currentDeletedItems.length) {
      list.innerHTML = '<div class="ctx-deleted-empty">Trash is empty.</div>';
      return;
    }

    function TYPE_ICONS_SVG(t) { return ({ equipment:'settings', part:'bolt', node:'star', ticket:'ticket', card:'clipboard', event:'calendar' })[t]; }
  const TYPE_ICONS = new Proxy({}, { get: (_, t) => cmSvg(TYPE_ICONS_SVG(t) || 'documents', '14px') });

    list.innerHTML = currentDeletedItems.map(item => `
      <div class="feed-row ctx-deleted-row" data-table="${tableForType(item.item_type)}" data-id="${esc(item.item_id)}">
        <div class="ctx-deleted-icon">${TYPE_ICONS[item.item_type] || cmSvg('documents','14px')}</div>
        <div class="ctx-deleted-body">
          <div class="ctx-deleted-name">${esc(item.item_name || 'Untitled')}</div>
          <div class="ctx-deleted-meta">
            <span class="ctx-deleted-type">${item.item_type}</span>
            ${item.item_meta ? '· ' + esc(item.item_meta) : ''}
          </div>
          <div class="ctx-deleted-when">
            ${item.deleted_by ? esc(item.deleted_by) + ' · ' : ''}${formatDate(item.deleted_at)}
            ${item.deleted_reason ? ' · ' + esc(item.deleted_reason) : ''}
          </div>
        </div>
        <button class="ctx-deleted-restore-btn">${cmSvg("refresh", "12px")} Restore</button>
      </div>
    `).join('');

    list.querySelectorAll('.ctx-deleted-row').forEach(row => {
      const restoreBtn = row.querySelector('.ctx-deleted-restore-btn');
      restoreBtn.addEventListener('click', async () => {
        const table = row.dataset.table;
        const id = row.dataset.id;
        const name = row.querySelector('.ctx-deleted-name').textContent;
        if (!confirm(`Restore "${name}"?`)) return;
        await restoreItem(table, id, name);
      });
    });
  }

  function tableForType(type) {
    const map = {
      equipment: 'equipment', part: 'equipment_parts', node: 'nodes',
      ticket: 'tickets', card: 'kanban_cards', event: 'contractor_events'
    };
    return map[type] || type;
  }

  function refreshDeletedItemsList() {
    if (document.querySelector('.feed-chip.active')?.dataset.filter === 'deleted') {
      renderDeletedItemsView();
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PRINT — single label (Zebra-style 2"×4") and Avery sheet (10-up 5163)
     ═════════════════════════════════════════════════════════════════════════ */

  async function printSingleLabel(equipId) {
    const eq = await loadEquipment(equipId);
    if (!eq) { toast('Could not load equipment', 'error'); return; }
    const html = buildLabelHTML([eq], 'single');
    openPrintWindow(html, 'Print Label');
  }

  async function printAverySheet(equipId) {
    const eq = await loadEquipment(equipId);
    if (!eq) { toast('Could not load equipment', 'error'); return; }
    // Avery 5163: 10 labels per sheet, 2" × 4", 2 columns × 5 rows
    const copies = Array(10).fill(eq);
    const html = buildLabelHTML(copies, 'avery5163');
    openPrintWindow(html, 'Print Avery Sheet');
  }

  async function loadEquipment(id) {
    try {
      const { data } = await NX.sb.from('equipment').select('*').eq('id', id).single();
      return data;
    } catch (_) { return null; }
  }

  function buildLabelHTML(items, mode) {
    // mode = 'single' (one 2"×4" label) or 'avery5163' (10-up sheet, 2 col × 5 row)
    const isAvery = mode === 'avery5163';
    const cells = items.map(eq => `
      <div class="lbl-cell">
        <div class="lbl-name">${esc(eq.name || 'Equipment')}</div>
        <div class="lbl-row">
          ${eq.location ? `<div class="lbl-loc">${esc(eq.location)}${eq.area ? ' · ' + esc(eq.area) : ''}</div>` : ''}
        </div>
        <div class="lbl-row lbl-mfr">
          ${eq.manufacturer ? esc(eq.manufacturer) : ''} ${eq.model ? esc(eq.model) : ''}
        </div>
        ${eq.serial_number ? `<div class="lbl-row lbl-serial">SN: ${esc(eq.serial_number)}</div>` : ''}
        ${eq.category ? `<div class="lbl-row lbl-cat">${esc(eq.category)}</div>` : ''}
        <div class="lbl-footer">
          <div class="lbl-id">ID: ${esc(eq.id)}</div>
        </div>
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>NEXUS Label Print</title>
<style>
  /* Reset for clean print */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: white; color: black; }
  
  ${isAvery ? `
    /* Avery 5163: 10 labels per sheet, 2" × 4", 2 cols × 5 rows */
    @page { size: letter portrait; margin: 0.5in 0.156in; }
    body { width: 8.5in; }
    .lbl-sheet {
      display: grid;
      grid-template-columns: 4in 4in;
      grid-template-rows: repeat(5, 2in);
      column-gap: 0.188in;
      row-gap: 0;
      width: 8.188in;
      margin: 0 auto;
    }
    .lbl-cell {
      width: 4in;
      height: 2in;
      padding: 0.18in 0.22in;
      page-break-inside: avoid;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      border: 1px dashed #d0d0d0;  /* visible only in screen; invisible-ish on print */
    }
  ` : `
    /* Single label: one 2"×4" centered on page */
    @page { size: letter portrait; margin: 1in; }
    body { width: 8.5in; padding: 1in 0; }
    .lbl-sheet { width: 4in; margin: 0 auto; }
    .lbl-cell {
      width: 4in;
      height: 2in;
      padding: 0.2in 0.25in;
      border: 1px solid #333;
      border-radius: 4px;
      display: flex;
      flex-direction: column;
    }
  `}
  
  .lbl-name {
    font-size: 13pt;
    font-weight: 700;
    line-height: 1.15;
    margin-bottom: 4pt;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lbl-row {
    font-size: 9pt;
    line-height: 1.3;
    margin-bottom: 2pt;
    color: #222;
  }
  .lbl-loc {
    font-weight: 600;
    color: #000;
  }
  .lbl-mfr {
    font-style: italic;
    color: #444;
  }
  .lbl-serial {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 8.5pt;
    color: #333;
  }
  .lbl-cat {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    color: #666;
  }
  .lbl-footer {
    margin-top: auto;
    padding-top: 4pt;
    border-top: 1px solid #ddd;
  }
  .lbl-id {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 7pt;
    color: #888;
  }
  
  /* Print toolbar — visible on screen, hidden on print */
  .print-toolbar {
    position: fixed;
    top: 0; left: 0; right: 0;
    background: #1a1a1a;
    color: white;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    z-index: 100;
  }
  .print-toolbar h1 { font-size: 14px; font-weight: 600; }
  .print-toolbar button {
    background: #c8a44e;
    color: #1a1408;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  body { padding-top: 60px; }
  
  @media print {
    .print-toolbar { display: none; }
    body { padding-top: 0; }
    .lbl-cell { border: none !important; }
  }
</style>
</head>
<body>
  <div class="print-toolbar">
    <h1>${isAvery ? 'NEXUS — Avery 5163 (10 labels)' : 'NEXUS — Equipment Label'}</h1>
    <button onclick="window.print()">Print →</button>
  </div>
  <div class="lbl-sheet">${cells}</div>
  <script>
    // Auto-trigger print dialog on load
    setTimeout(() => window.print(), 300);
  </script>
</body>
</html>`;
  }

  function openPrintWindow(html, title) {
    const win = window.open('', '_blank');
    if (!win) {
      toast('Pop-up blocked — allow pop-ups to print', 'error');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.document.title = title;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     SMART PER-TAB PRINT — prints whatever tab is currently active
     ═════════════════════════════════════════════════════════════════════════ */

  async function printActiveTab(equipId) {
    const eq = await loadEquipment(equipId);
    if (!eq) { toast('Could not load equipment', 'error'); return; }

    // Detect which tab is currently active inside the equipment detail modal
    const modal = document.querySelector('.eq-modal.active') || document.querySelector('.eq-detail');
    const activeTab = modal?.querySelector('.eq-tab.active')?.dataset?.tab 
                   || modal?.querySelector('.eq-tab-panel.active')?.dataset?.panel
                   || 'overview';

    // Load supporting data for the active tab
    let extra = {};
    try {
      if (activeTab === 'parts') {
        const { data } = await NX.sb.from('equipment_parts')
          .select('*').eq('equipment_id', equipId).eq('is_deleted', false).order('part_name');
        extra.parts = data || [];
      } else if (activeTab === 'timeline') {
        const { data } = await NX.sb.from('equipment_maintenance')
          .select('*').eq('equipment_id', equipId).order('event_date', { ascending: false });
        extra.maintenance = data || [];
        const { data: dispatches } = await NX.sb.from('dispatch_events')
          .select('*').eq('equipment_id', equipId).order('dispatched_at', { ascending: false });
        extra.dispatches = dispatches || [];
      } else if (activeTab === 'manual') {
        // Just open the PDF in a new tab — that IS the print path for PDFs
        if (eq.manual_url) {
          window.open(eq.manual_url, '_blank');
          toast('Opened manual — use browser Print', 'info');
          return;
        }
        toast('No manual uploaded yet', 'info');
        return;
      }
    } catch (e) {
      console.warn('[ctx-menu] tab data load:', e);
    }

    const html = buildTabPrintHTML(eq, activeTab, extra);
    openPrintWindow(html, `${eq.name} — ${activeTab}`);
  }

  function buildTabPrintHTML(eq, tab, extra) {
    let body = '';
    
    if (tab === 'overview' || tab === 'ai') {
      body = `
        <h1 class="rpt-title">${esc(eq.name)}</h1>
        <div class="rpt-sub">${esc(eq.location || '')}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
        
        <table class="rpt-grid">
          <tr><th>Manufacturer</th><td>${esc(eq.manufacturer || '—')}</td>
              <th>Model</th><td>${esc(eq.model || '—')}</td></tr>
          <tr><th>Serial #</th><td>${esc(eq.serial_number || '—')}</td>
              <th>Category</th><td>${esc(eq.category || '—')}</td></tr>
          <tr><th>Install Date</th><td>${esc(eq.install_date || '—')}</td>
              <th>Warranty Until</th><td>${esc(eq.warranty_until || '—')}</td></tr>
          <tr><th>Purchase Price</th><td>${eq.purchase_price ? '$' + eq.purchase_price : '—'}</td>
              <th>Health Score</th><td>${eq.health_score != null ? eq.health_score + '%' : '—'}</td></tr>
          <tr><th>Next PM</th><td>${esc(eq.next_pm_date || '—')}</td>
              <th>Status</th><td>${esc(eq.status || '—')}</td></tr>
          ${eq.service_contractor_name ? `
            <tr><th>Service Contractor</th>
                <td colspan="3">${esc(eq.service_contractor_name)}${eq.service_contractor_phone ? ' · ' + esc(eq.service_contractor_phone) : ''}</td></tr>
          ` : ''}
        </table>
        
        ${eq.notes ? `
          <h2 class="rpt-section">Notes</h2>
          <div class="rpt-notes">${esc(eq.notes)}</div>
        ` : ''}
        
        ${eq.manual_url ? `
          <h2 class="rpt-section">Manual</h2>
          <div class="rpt-link">${esc(eq.manual_url)}</div>
        ` : ''}
      `;
    } else if (tab === 'timeline') {
      const maint = extra.maintenance || [];
      const dispatches = extra.dispatches || [];
      // Merge + sort by date
      const events = [
        ...maint.map(m => ({ date: m.event_date || m.created_at, type: m.event_type || 'service', detail: m.notes || '', who: m.performed_by, kind: 'maintenance' })),
        ...dispatches.map(d => ({ date: d.dispatched_at, type: 'dispatch', detail: `Called ${d.contractor_name || 'contractor'}: ${d.issue_description || '—'}`, who: d.dispatched_by, kind: 'dispatch' }))
      ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      
      body = `
        <h1 class="rpt-title">${esc(eq.name)} — Service Timeline</h1>
        <div class="rpt-sub">${esc(eq.location || '')}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
        ${!events.length ? '<div class="rpt-empty">No service history yet.</div>' : `
          <table class="rpt-table">
            <thead><tr><th>Date</th><th>Type</th><th>Detail</th><th>By</th></tr></thead>
            <tbody>
              ${events.map(e => `
                <tr class="rpt-${e.kind}">
                  <td>${e.date ? new Date(e.date).toLocaleDateString() : ''}</td>
                  <td>${esc(e.type)}</td>
                  <td>${esc(e.detail)}</td>
                  <td>${esc(e.who || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      `;
    } else if (tab === 'parts') {
      const parts = extra.parts || [];
      body = `
        <h1 class="rpt-title">${esc(eq.name)} — Bill of Materials</h1>
        <div class="rpt-sub">${esc(eq.location || '')} · ${parts.length} part${parts.length === 1 ? '' : 's'}</div>
        ${!parts.length ? '<div class="rpt-empty">No parts cataloged.</div>' : `
          <table class="rpt-table">
            <thead><tr><th>Part</th><th>OEM #</th><th>Assembly</th><th>Qty</th><th>Vendors</th></tr></thead>
            <tbody>
              ${parts.map(p => {
                const vendors = Array.isArray(p.vendors) ? p.vendors : [];
                const vendorStr = vendors.length 
                  ? vendors.map(v => `${esc(v.name)}${v.price ? ' $' + parseFloat(v.price).toFixed(2) : ''}`).join('<br>')
                  : (p.supplier ? esc(p.supplier) : '—');
                return `
                  <tr>
                    <td><strong>${esc(p.part_name)}</strong></td>
                    <td class="mono">${esc(p.oem_part_number || '—')}</td>
                    <td>${esc(p.assembly_path || '—')}</td>
                    <td>${esc(p.quantity || 1)}</td>
                    <td>${vendorStr}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `}
      `;
    }

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${esc(eq.name)} — ${tab}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
         padding: 0.6in 0.7in; background: white; color: #1a1408; line-height: 1.4; }
  @page { size: letter portrait; margin: 0.5in; }
  
  .rpt-title { font-size: 22pt; font-weight: 700; color: #1a1408; margin-bottom: 4pt; }
  .rpt-sub { font-size: 11pt; color: #666; margin-bottom: 18pt; padding-bottom: 10pt; border-bottom: 2pt solid #c8a44e; }
  .rpt-section { font-size: 13pt; font-weight: 700; margin-top: 18pt; margin-bottom: 8pt; color: #1a1408; }
  .rpt-notes { font-size: 11pt; padding: 10pt 14pt; background: #faf6ec; border-left: 3pt solid #c8a44e; border-radius: 4pt; white-space: pre-wrap; }
  .rpt-link { font-size: 10pt; font-family: 'Courier New', monospace; color: #555; word-break: break-all; }
  .rpt-empty { padding: 30pt 0; text-align: center; color: #888; font-style: italic; }
  
  .rpt-grid { width: 100%; border-collapse: collapse; margin-top: 8pt; }
  .rpt-grid th, .rpt-grid td { padding: 8pt 10pt; border-bottom: 1pt solid #eee; vertical-align: top; }
  .rpt-grid th { background: #faf6ec; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5pt; color: #666; font-weight: 600; width: 18%; }
  .rpt-grid td { font-size: 11pt; width: 32%; }
  
  .rpt-table { width: 100%; border-collapse: collapse; margin-top: 12pt; font-size: 10pt; }
  .rpt-table th { background: #1a1408; color: #c8a44e; padding: 8pt 10pt; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5pt; }
  .rpt-table td { padding: 8pt 10pt; border-bottom: 1pt solid #eee; vertical-align: top; }
  .rpt-table tr.rpt-dispatch td { background: #fff7e6; }
  .mono { font-family: 'Courier New', monospace; }
  
  .print-toolbar { position: fixed; top: 0; left: 0; right: 0;
    background: #1a1a1a; color: white; padding: 12px 16px;
    display: flex; align-items: center; justify-content: space-between;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3); z-index: 100; }
  .print-toolbar h1 { font-size: 14px; font-weight: 600; color: #c8a44e; }
  .print-toolbar button { background: #c8a44e; color: #1a1408; border: none;
    padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
  body { padding-top: 70px; }
  @media print { .print-toolbar { display: none; } body { padding-top: 0.6in; } }
</style>
</head>
<body>
  <div class="print-toolbar">
    <h1>NEXUS — ${esc(eq.name)} (${tab})</h1>
    <button onclick="window.print()">Print →</button>
  </div>
  ${body}
  <script>setTimeout(() => window.print(), 400);</script>
</body>
</html>`;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PRINT EVERYTHING — complete equipment dossier
     
     Pulls data from every related table and produces one comprehensive
     HTML document: identity/specs, family relationships, full parts list
     with vendors, complete service timeline, all dispatches, all PM logs
     (approved), notes, warranty, manual link, contractor info.
     ═════════════════════════════════════════════════════════════════════════ */

  async function printEverything(equipId) {
    const eq = await loadEquipment(equipId);
    if (!eq) { toast('Could not load equipment', 'error'); return; }
    
    // Show loading indicator
    toast('Building complete dossier…', 'info', 3000);
    
    // Parallel fetch everything
    const [
      { data: parts },
      { data: maint },
      { data: dispatches },
      { data: pmLogs },
      { data: familyChildren },
      { data: familyParent }
    ] = await Promise.all([
      NX.sb.from('equipment_parts').select('*').eq('equipment_id', equipId).eq('is_deleted', false).order('assembly_path').order('part_name'),
      NX.sb.from('equipment_maintenance').select('*').eq('equipment_id', equipId).order('event_date', { ascending: false }),
      NX.sb.from('dispatch_events').select('*').eq('equipment_id', equipId).order('dispatched_at', { ascending: false }),
      NX.sb.from('pm_logs').select('*').eq('equipment_id', equipId).eq('review_status', 'approved').eq('is_deleted', false).order('service_date', { ascending: false }),
      NX.sb.from('equipment').select('id, name, location, model').eq('parent_equipment_id', equipId).eq('is_deleted', false),
      eq.parent_equipment_id ? NX.sb.from('equipment').select('id, name, location, model').eq('id', eq.parent_equipment_id).single() : Promise.resolve({ data: null })
    ]);
    
    const html = buildCompleteDossierHTML(eq, {
      parts: parts || [],
      maintenance: maint || [],
      dispatches: dispatches || [],
      pmLogs: pmLogs || [],
      children: familyChildren || [],
      parent: familyParent || null
    });
    openPrintWindow(html, `${eq.name} — Complete Dossier`);
  }

  function buildCompleteDossierHTML(eq, d) {
    const fmt = (iso) => iso ? new Date(iso).toLocaleDateString() : '—';
    const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString() : '—';
    const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString() : '—';
    
    // Merge maintenance + dispatches + approved PM logs into one timeline
    const timeline = [
      ...d.maintenance.map(m => ({ 
        date: m.event_date || m.created_at, 
        type: 'service',
        label: (m.event_type || 'SERVICE').toUpperCase(),
        detail: m.description || m.notes || '',
        who: m.performed_by || '',
        cost: m.cost
      })),
      ...d.dispatches.map(x => ({ 
        date: x.dispatched_at, 
        type: 'dispatch',
        label: 'DISPATCH',
        detail: `Called ${x.contractor_name || 'contractor'}${x.issue_description ? ' — ' + x.issue_description : ''}${x.resolution_notes ? ' · Resolution: ' + x.resolution_notes : ''}`,
        who: x.dispatched_by,
        cost: null
      })),
      ...d.pmLogs.map(p => ({ 
        date: p.service_date, 
        type: 'pmlog',
        label: (p.service_type || 'PM').toUpperCase() + ' (QR SUBMISSION)',
        detail: p.work_performed + (p.parts_replaced ? '\nParts: ' + p.parts_replaced : ''),
        who: p.contractor_name + (p.contractor_company ? ' · ' + p.contractor_company : ''),
        cost: p.cost_amount
      }))
    ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    
    // Totals
    const totalMaintCost = timeline.reduce((sum, e) => sum + (parseFloat(e.cost) || 0), 0);
    
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(eq.name)} — Complete Dossier</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
         padding: 0.5in 0.6in; background: white; color: #1a1408; line-height: 1.45; font-size: 10.5pt; }
  @page { size: letter portrait; margin: 0.4in; }
  
  /* Cover header */
  .dos-cover {
    padding-bottom: 14pt;
    border-bottom: 3pt solid #c8a44e;
    margin-bottom: 20pt;
  }
  .dos-cover-meta {
    font-size: 9pt;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.6pt;
    margin-bottom: 4pt;
  }
  .dos-title {
    font-size: 26pt;
    font-weight: 800;
    color: #1a1408;
    line-height: 1.1;
    margin-bottom: 4pt;
  }
  .dos-subtitle {
    font-size: 13pt;
    color: #666;
    margin-bottom: 8pt;
  }
  .dos-status-pill {
    display: inline-block;
    padding: 3pt 10pt;
    border-radius: 100pt;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.6pt;
    font-weight: 600;
    background: #fff8e8;
    color: #b89342;
    border: 1pt solid #c8a44e;
  }
  .dos-status-pill.operational { background: #e8f5e9; color: #2e7d32; border-color: #4caf50; }
  .dos-status-pill.needs_service { background: #fff3e0; color: #e65100; border-color: #ff9800; }
  .dos-status-pill.down { background: #ffebee; color: #c62828; border-color: #f44336; }
  
  /* Section */
  .dos-section {
    margin-bottom: 22pt;
    page-break-inside: avoid;
  }
  .dos-section-title {
    font-size: 11pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8pt;
    color: #c8a44e;
    margin-bottom: 10pt;
    padding-bottom: 4pt;
    border-bottom: 1pt solid #e8e2d4;
  }
  
  /* Grid of specs */
  .dos-specs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    background: #faf8f5;
    border-radius: 6pt;
    overflow: hidden;
  }
  .dos-spec {
    padding: 8pt 12pt;
    border-bottom: 1pt solid #eee;
    border-right: 1pt solid #eee;
  }
  .dos-spec:nth-child(even) { border-right: none; }
  .dos-spec-label {
    font-size: 8pt;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.4pt;
    margin-bottom: 2pt;
  }
  .dos-spec-value {
    font-size: 11pt;
    color: #1a1408;
    font-weight: 500;
    word-break: break-word;
  }
  .dos-spec-value.mono { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 10pt; }
  
  /* Notes block */
  .dos-notes {
    padding: 12pt 14pt;
    background: #fff8e8;
    border-left: 3pt solid #c8a44e;
    border-radius: 4pt;
    white-space: pre-wrap;
    font-size: 10.5pt;
    line-height: 1.5;
  }
  
  /* Family */
  .dos-family-item {
    padding: 6pt 10pt;
    background: #faf8f5;
    border-radius: 4pt;
    margin-bottom: 4pt;
    font-size: 10pt;
  }
  .dos-family-label {
    font-size: 8pt;
    text-transform: uppercase;
    color: #888;
    letter-spacing: 0.4pt;
    margin-right: 6pt;
  }
  
  /* Parts table */
  .dos-parts-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
  }
  .dos-parts-table th {
    background: #1a1408;
    color: #c8a44e;
    padding: 7pt 8pt;
    text-align: left;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
  }
  .dos-parts-table td {
    padding: 7pt 8pt;
    border-bottom: 1pt solid #eee;
    vertical-align: top;
  }
  .dos-parts-table tr:nth-child(even) td { background: #faf8f5; }
  .dos-parts-table strong { color: #1a1408; }
  .dos-parts-vendors {
    font-size: 8.5pt;
    color: #666;
    line-height: 1.4;
  }
  .dos-parts-vendor-row {
    display: block;
    margin-top: 1pt;
  }
  .dos-parts-vendor-preferred {
    font-weight: 600;
    color: #b89342;
  }
  .mono { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 9pt; }
  
  /* Timeline */
  .dos-timeline-entry {
    display: flex;
    gap: 12pt;
    padding: 10pt 12pt;
    background: #faf8f5;
    border-left: 3pt solid #c8a44e;
    border-radius: 4pt;
    margin-bottom: 6pt;
    page-break-inside: avoid;
  }
  .dos-timeline-entry.service { border-left-color: #c8a44e; }
  .dos-timeline-entry.dispatch { border-left-color: #6db2e0; }
  .dos-timeline-entry.pmlog { border-left-color: #5cb377; background: #f0f8f2; }
  .dos-tl-date {
    font-size: 9pt;
    color: #888;
    font-weight: 600;
    flex-shrink: 0;
    width: 70pt;
  }
  .dos-tl-body { flex: 1; min-width: 0; }
  .dos-tl-label {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    color: #c8a44e;
    margin-bottom: 3pt;
  }
  .dos-tl-detail {
    font-size: 10pt;
    color: #1a1408;
    line-height: 1.4;
    white-space: pre-wrap;
    margin-bottom: 3pt;
  }
  .dos-tl-footer {
    font-size: 8.5pt;
    color: #888;
  }
  
  /* Contractors */
  .dos-contractor {
    display: flex;
    gap: 14pt;
    padding: 10pt 12pt;
    background: #faf8f5;
    border-radius: 6pt;
    margin-bottom: 6pt;
  }
  .dos-contractor-label {
    font-size: 8pt;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.4pt;
    width: 60pt;
    flex-shrink: 0;
  }
  .dos-contractor-info {
    flex: 1;
    font-size: 10pt;
    color: #1a1408;
  }
  
  /* Empty state */
  .dos-empty {
    padding: 18pt;
    text-align: center;
    color: #888;
    font-style: italic;
    background: #faf8f5;
    border-radius: 6pt;
    font-size: 10pt;
  }
  
  /* Totals footer */
  .dos-totals {
    margin-top: 10pt;
    padding: 10pt 14pt;
    background: #1a1408;
    color: #c8a44e;
    border-radius: 6pt;
    display: flex;
    justify-content: space-between;
    font-size: 11pt;
    font-weight: 600;
  }
  
  /* Report footer */
  .dos-footer {
    margin-top: 30pt;
    padding-top: 12pt;
    border-top: 1pt solid #e8e2d4;
    font-size: 8pt;
    color: #999;
    text-align: center;
    letter-spacing: 0.4pt;
  }
  
  /* Print toolbar */
  .print-toolbar {
    position: fixed;
    top: 0; left: 0; right: 0;
    background: #1a1a1a;
    color: white;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    z-index: 100;
  }
  .print-toolbar h1 { font-size: 14px; font-weight: 600; color: #c8a44e; }
  .print-toolbar button {
    background: #c8a44e;
    color: #1a1408;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  body { padding-top: 70px; }
  @media print {
    .print-toolbar { display: none; }
    body { padding-top: 0.4in; }
  }
</style>
</head>
<body>
  <div class="print-toolbar">
    <h1>NEXUS — ${esc(eq.name)} Complete Dossier</h1>
    <button onclick="window.print()">Print →</button>
  </div>
  
  <!-- COVER -->
  <div class="dos-cover">
    <div class="dos-cover-meta">Equipment Dossier · Generated ${new Date().toLocaleString()}</div>
    <div class="dos-title">${esc(eq.name)}</div>
    <div class="dos-subtitle">${esc(eq.location || '')}${eq.area ? ' · ' + esc(eq.area) : ''}</div>
    <div class="dos-status-pill ${esc(eq.status || '')}">${esc(eq.status || 'unknown')}</div>
  </div>
  
  <!-- IDENTITY + SPECS -->
  <div class="dos-section">
    <div class="dos-section-title">${cmSvg("settings", "13px")} Identity & Specifications</div>
    <div class="dos-specs">
      <div class="dos-spec">
        <div class="dos-spec-label">Manufacturer</div>
        <div class="dos-spec-value">${esc(eq.manufacturer || '—')}</div>
      </div>
      <div class="dos-spec">
        <div class="dos-spec-label">Model</div>
        <div class="dos-spec-value mono">${esc(eq.model || '—')}</div>
      </div>
      <div class="dos-spec">
        <div class="dos-spec-label">Serial Number</div>
        <div class="dos-spec-value mono">${esc(eq.serial_number || '—')}</div>
      </div>
      <div class="dos-spec">
        <div class="dos-spec-label">Category</div>
        <div class="dos-spec-value">${esc(eq.category || '—')}</div>
      </div>
      <div class="dos-spec">
        <div class="dos-spec-label">Install Date</div>
        <div class="dos-spec-value">${fmtDate(eq.install_date)}</div>
      </div>
      <div class="dos-spec">
        <div class="dos-spec-label">Warranty Until</div>
        <div class="dos-spec-value">${fmtDate(eq.warranty_until)}</div>
      </div>
      <div class="dos-spec">
        <div class="dos-spec-label">Purchase Price</div>
        <div class="dos-spec-value">${eq.purchase_price ? '$' + parseFloat(eq.purchase_price).toFixed(2) : '—'}</div>
      </div>
      <div class="dos-spec">
        <div class="dos-spec-label">Health Score</div>
        <div class="dos-spec-value">${eq.health_score != null ? eq.health_score + '%' : '—'}</div>
      </div>
      <div class="dos-spec">
        <div class="dos-spec-label">Next PM Due</div>
        <div class="dos-spec-value">${fmtDate(eq.next_pm_date)}</div>
      </div>
      <div class="dos-spec">
        <div class="dos-spec-label">QR Code / ID</div>
        <div class="dos-spec-value mono">${esc(eq.qr_code || eq.id)}</div>
      </div>
    </div>
    ${eq.manual_url ? `
      <div style="margin-top:10pt;padding:8pt 12pt;background:#fff8e8;border-radius:4pt;font-size:9pt;">
        ${cmSvg("document","13px")} <strong>Manual:</strong> <span class="mono">${esc(eq.manual_url)}</span>
      </div>
    ` : ''}
  </div>
  
  <!-- NOTES -->
  ${eq.notes ? `
    <div class="dos-section">
      <div class="dos-section-title">${cmSvg("note", "13px")} Notes</div>
      <div class="dos-notes">${esc(eq.notes)}</div>
    </div>
  ` : ''}
  
  <!-- CONTRACTORS -->
  ${(eq.service_contractor_name || eq.backup_contractor_name) ? `
    <div class="dos-section">
      <div class="dos-section-title">${cmSvg("phone", "13px")} Service Contractors</div>
      ${eq.service_contractor_name ? `
        <div class="dos-contractor">
          <div class="dos-contractor-label">Primary</div>
          <div class="dos-contractor-info">
            <strong>${esc(eq.service_contractor_name)}</strong>
            ${eq.service_contractor_phone ? ' · ' + esc(eq.service_contractor_phone) : ''}
          </div>
        </div>
      ` : ''}
      ${eq.backup_contractor_name ? `
        <div class="dos-contractor">
          <div class="dos-contractor-label">Backup</div>
          <div class="dos-contractor-info">
            <strong>${esc(eq.backup_contractor_name)}</strong>
            ${eq.backup_contractor_phone ? ' · ' + esc(eq.backup_contractor_phone) : ''}
          </div>
        </div>
      ` : ''}
    </div>
  ` : ''}
  
  <!-- FAMILY -->
  ${(d.parent || d.children.length) ? `
    <div class="dos-section">
      <div class="dos-section-title">${cmSvg("family", "13px")} Equipment Family</div>
      ${d.parent ? `
        <div class="dos-family-item">
          <span class="dos-family-label">Parent:</span>
          <strong>${esc(d.parent.name)}</strong>
          ${d.parent.location ? ' · ' + esc(d.parent.location) : ''}
          ${d.parent.model ? ' · ' + esc(d.parent.model) : ''}
        </div>
      ` : ''}
      ${d.children.length ? `
        <div class="dos-family-item">
          <span class="dos-family-label">Children (${d.children.length}):</span>
          <br>
          ${d.children.map(c => `<div style="margin-top:3pt;margin-left:12pt;">• <strong>${esc(c.name)}</strong>${c.location ? ' · ' + esc(c.location) : ''}${c.model ? ' · ' + esc(c.model) : ''}</div>`).join('')}
        </div>
      ` : ''}
    </div>
  ` : ''}
  
  <!-- BILL OF MATERIALS -->
  <div class="dos-section">
    <div class="dos-section-title">${cmSvg("bolt", "13px")} Bill of Materials (${d.parts.length} part${d.parts.length === 1 ? '' : 's'})</div>
    ${d.parts.length ? `
      <table class="dos-parts-table">
        <thead>
          <tr>
            <th style="width:30%">Part</th>
            <th style="width:15%">OEM #</th>
            <th style="width:20%">Assembly</th>
            <th style="width:6%">Qty</th>
            <th style="width:29%">Vendors</th>
          </tr>
        </thead>
        <tbody>
          ${d.parts.map(p => {
            const vendors = Array.isArray(p.vendors) ? p.vendors : [];
            const vendorHtml = vendors.length ? vendors.map(v => `
              <span class="dos-parts-vendor-row ${v.is_preferred ? 'dos-parts-vendor-preferred' : ''}">
                ${v.is_preferred ? '* ' : ''}${esc(v.name)}${v.price ? ' · $' + parseFloat(v.price).toFixed(2) : ''}${v.in_stock === true ? ' · in stock' : v.in_stock === false ? ' · out' : ''}
              </span>
            `).join('') : (p.supplier ? `<span>${esc(p.supplier)}${p.last_price ? ' · $' + parseFloat(p.last_price).toFixed(2) : ''}</span>` : '<span style="color:#aaa;">—</span>');
            
            return `
              <tr>
                <td><strong>${esc(p.part_name)}</strong></td>
                <td class="mono">${esc(p.oem_part_number || '—')}</td>
                <td>${esc(p.assembly_path || '—')}</td>
                <td>${esc(p.quantity || 1)}</td>
                <td class="dos-parts-vendors">${vendorHtml}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    ` : '<div class="dos-empty">No parts cataloged.</div>'}
  </div>
  
  <!-- COMPLETE SERVICE TIMELINE -->
  <div class="dos-section">
    <div class="dos-section-title">${cmSvg("calendar", "13px")} Complete Service Timeline (${timeline.length} event${timeline.length === 1 ? '' : 's'})</div>
    ${timeline.length ? timeline.map(e => `
      <div class="dos-timeline-entry ${e.type}">
        <div class="dos-tl-date">${fmtDate(e.date)}</div>
        <div class="dos-tl-body">
          <div class="dos-tl-label">${esc(e.label)}</div>
          <div class="dos-tl-detail">${esc(e.detail)}</div>
          <div class="dos-tl-footer">
            ${e.who ? esc(e.who) : ''}${e.cost ? ' · $' + parseFloat(e.cost).toFixed(2) : ''}
          </div>
        </div>
      </div>
    `).join('') : '<div class="dos-empty">No service history yet.</div>'}
    ${totalMaintCost > 0 ? `
      <div class="dos-totals">
        <span>Lifetime Maintenance Cost</span>
        <span>$${totalMaintCost.toFixed(2)}</span>
      </div>
    ` : ''}
  </div>
  
  <!-- FOOTER -->
  <div class="dos-footer">
    Generated by NEXUS · Orion Continuity · ${new Date().toISOString()}
    <br>
    Equipment ID: ${esc(eq.id)}
    ${eq.equipment_node_id ? ' · Brain Node: ' + esc(eq.equipment_node_id) : ''}
  </div>
  
  <script>setTimeout(() => window.print(), 500);</script>
</body>
</html>`;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     SHOPPING LIST — pulls all parts with vendors and exports as printable list
     ═════════════════════════════════════════════════════════════════════════ */

  async function exportShoppingList(equipId) {
    try {
      const eq = await loadEquipment(equipId);
      const { data: parts } = await NX.sb.from('equipment_parts')
        .select('*').eq('equipment_id', equipId).eq('is_deleted', false);
      if (!parts?.length) { toast('No parts cataloged', 'info'); return; }
      
      // Build a printable shopping list grouped by preferred vendor
      const byVendor = {};
      parts.forEach(p => {
        const vendors = Array.isArray(p.vendors) ? p.vendors : [];
        const preferred = vendors.find(v => v.is_preferred) || vendors[0] || { name: p.supplier || 'Unassigned', url: p.supplier_url, price: p.last_price };
        const key = preferred.name || 'Unassigned';
        if (!byVendor[key]) byVendor[key] = [];
        byVendor[key].push({ ...p, vendor: preferred });
      });
      
      const html = buildShoppingListHTML(eq, byVendor);
      openPrintWindow(html, 'Shopping List');
    } catch (e) {
      toast('Shopping list failed: ' + e.message, 'error');
    }
  }

  function buildShoppingListHTML(eq, byVendor) {
    const sections = Object.entries(byVendor).map(([vendor, items]) => {
      const total = items.reduce((sum, it) => sum + (parseFloat(it.vendor.price) || 0) * (it.quantity || 1), 0);
      return `
        <div class="sl-vendor">
          <h2 class="sl-vendor-name">${esc(vendor)}</h2>
          <table class="sl-table">
            <thead><tr><th>☐</th><th>Part</th><th>OEM #</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
            <tbody>
              ${items.map(it => {
                const price = parseFloat(it.vendor.price) || 0;
                const qty = it.quantity || 1;
                const lineTotal = price * qty;
                return `
                  <tr>
                    <td class="sl-check"></td>
                    <td><strong>${esc(it.part_name)}</strong>${it.assembly_path ? '<br><small>' + esc(it.assembly_path) + '</small>' : ''}</td>
                    <td class="mono">${esc(it.vendor.oem_number || it.oem_part_number || '—')}</td>
                    <td>${qty}</td>
                    <td>${price ? '$' + price.toFixed(2) : '—'}</td>
                    <td>${lineTotal ? '$' + lineTotal.toFixed(2) : '—'}</td>
                  </tr>
                `;
              }).join('')}
              ${total ? `<tr class="sl-total"><td colspan="5"><strong>Vendor Total</strong></td><td><strong>$${total.toFixed(2)}</strong></td></tr>` : ''}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Shopping List — ${esc(eq.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, sans-serif; padding: 0.6in 0.7in; color: #1a1408; }
  @page { size: letter; margin: 0.5in; }
  h1 { font-size: 22pt; margin-bottom: 4pt; }
  .sl-sub { color: #666; margin-bottom: 20pt; padding-bottom: 10pt; border-bottom: 2pt solid #c8a44e; }
  .sl-vendor { margin-bottom: 24pt; page-break-inside: avoid; }
  .sl-vendor-name { font-size: 14pt; padding: 6pt 10pt; background: #1a1408; color: #c8a44e; border-radius: 4pt 4pt 0 0; }
  .sl-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  .sl-table th { background: #faf6ec; padding: 6pt 8pt; text-align: left; font-size: 8pt; text-transform: uppercase; }
  .sl-table td { padding: 8pt; border-bottom: 1pt solid #eee; vertical-align: top; }
  .sl-table .sl-check { width: 24pt; text-align: center; font-size: 14pt; }
  .sl-table .sl-total td { background: #faf6ec; border-top: 2pt solid #c8a44e; }
  .mono { font-family: 'Courier New', monospace; }
  small { color: #888; font-size: 8pt; }
  .print-toolbar { position: fixed; top: 0; left: 0; right: 0; background: #1a1a1a; color: white; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; }
  .print-toolbar button { background: #c8a44e; color: #1a1408; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; }
  body { padding-top: 70px; }
  @media print { .print-toolbar { display: none; } body { padding-top: 0.6in; } }
</style>
</head>
<body>
  <div class="print-toolbar"><h1 style="font-size:14px;color:#c8a44e">Shopping List — ${esc(eq.name)}</h1><button onclick="window.print()">Print →</button></div>
  <h1>Shopping List</h1>
  <div class="sl-sub">${esc(eq.name)}${eq.location ? ' · ' + esc(eq.location) : ''} · ${new Date().toLocaleDateString()}</div>
  ${sections}
  <script>setTimeout(() => window.print(), 400);</script>
</body></html>`;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     Trigger the existing extract-from-manual flow from the ⋯ menu
     ═════════════════════════════════════════════════════════════════════════ */

  function triggerExtractFromManual(equipId) {
    // The button is removed from the Parts tab head, but the function still
    // exists in equipment-fixes.js (or equipment-p3.js fallback). Find and call.
    if (typeof window.runExtractWithProgress === 'function') {
      window.runExtractWithProgress(equipId);
      return;
    }
    if (NX.modules?.equipment?.extractBOMFromManual) {
      NX.modules.equipment.extractBOMFromManual(equipId);
      return;
    }
    // Last-ditch: simulate clicking the original (hidden) button if still in DOM
    const btn = document.querySelector('button[onclick*="extractBOM"]');
    if (btn) { btn.click(); return; }
    toast('Extract function not available', 'error');
  }

  /* ═════════════════════════════════════════════════════════════════════════
     FAMILY MANAGER — Set Parent / Add Child as a focused modal
     ═════════════════════════════════════════════════════════════════════════ */

  async function openFamilyManager(equipId, equipName) {
    const eq = await loadEquipment(equipId);
    if (!eq) { toast('Could not load equipment', 'error'); return; }

    const { data: allEq } = await NX.sb.from('equipment')
      .select('id, name, location, manufacturer, model, parent_equipment_id')
      .eq('is_deleted', false)
      .neq('id', equipId)
      .order('name');

    const candidates = allEq || [];
    const currentChildren = candidates.filter(e => e.parent_equipment_id === equipId);
    const currentParent = candidates.find(e => e.id === eq.parent_equipment_id);

    const modal = document.createElement('div');
    modal.className = 'ctx-confirm-modal';
    modal.innerHTML = `
      <div class="ctx-confirm-bg"></div>
      <div class="ctx-confirm-card" style="max-width:480px;text-align:left;padding:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:600;color:var(--accent,#c8a44e);">${cmSvg("family","14px")} Equipment Family</div>
          <button class="ctx-audit-close" id="famClose">${cmSvg("close", "14px")}</button>
        </div>
        <div style="font-size:13px;color:var(--text,#e6dccc);margin-bottom:14px;">
          ${esc(equipName)}
        </div>
        <div style="font-size:11px;color:var(--muted,#8a826f);margin-bottom:12px;line-height:1.5;">
          Use this to link related equipment — e.g., a walk-in cooler is the <strong>parent</strong>
          of multiple condenser units (<strong>children</strong>). Helps you find sub-components fast.
        </div>
        
        <div style="margin-bottom:16px;">
          <label class="ctx-confirm-reason-label">Parent Equipment</label>
          ${currentParent ? `
            <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(200,164,78,0.08);border-radius:8px;margin-bottom:6px;">
              <span style="flex:1;color:var(--text,#e6dccc);font-size:13px;">${esc(currentParent.name)}</span>
              <button class="ctx-confirm-cancel" style="padding:5px 10px;font-size:11px;" id="famClearParent">Remove</button>
            </div>
          ` : ''}
          <select class="ctx-confirm-reason" id="famParentSelect">
            <option value="">— Choose a parent (optional) —</option>
            ${candidates.map(c => `<option value="${esc(c.id)}" ${eq.parent_equipment_id === c.id ? 'selected' : ''}>${esc(c.name)}${c.location ? ' (' + esc(c.location) + ')' : ''}</option>`).join('')}
          </select>
        </div>
        
        <div style="margin-bottom:18px;">
          <label class="ctx-confirm-reason-label">Children (${currentChildren.length})</label>
          ${currentChildren.length ? `
            <div style="max-height:160px;overflow-y:auto;margin-bottom:8px;">
              ${currentChildren.map(c => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(200,164,78,0.05);border-radius:6px;margin-bottom:4px;">
                  <span style="flex:1;color:var(--text,#e6dccc);font-size:12.5px;">${esc(c.name)}</span>
                  <button class="ctx-confirm-cancel" style="padding:4px 8px;font-size:10px;" data-unlink="${esc(c.id)}">Unlink</button>
                </div>
              `).join('')}
            </div>
          ` : '<div style="font-size:11px;color:var(--muted,#8a826f);font-style:italic;margin-bottom:8px;">No children yet.</div>'}
          <select class="ctx-confirm-reason" id="famChildSelect">
            <option value="">— Add a child equipment —</option>
            ${candidates.filter(c => c.parent_equipment_id !== equipId && c.id !== eq.parent_equipment_id).map(c => 
              `<option value="${esc(c.id)}">${esc(c.name)}${c.location ? ' (' + esc(c.location) + ')' : ''}</option>`
            ).join('')}
          </select>
        </div>
        
        <div class="ctx-confirm-actions">
          <button class="ctx-confirm-cancel" id="famCancel">Close</button>
          <button class="ctx-confirm-delete" style="background:linear-gradient(135deg,#5cb377,#4ea866);" id="famSave">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    const close = () => modal.remove();
    modal.querySelector('#famClose').addEventListener('click', close);
    modal.querySelector('#famCancel').addEventListener('click', close);
    modal.querySelector('.ctx-confirm-bg').addEventListener('click', close);
    
    // Clear parent
    modal.querySelector('#famClearParent')?.addEventListener('click', async () => {
      try {
        await NX.sb.from('equipment').update({ parent_equipment_id: null }).eq('id', equipId);
        toast('Parent removed', 'success');
        close();
      } catch (e) { toast('Failed: ' + e.message, 'error'); }
    });
    
    // Unlink child
    modal.querySelectorAll('[data-unlink]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await NX.sb.from('equipment').update({ parent_equipment_id: null }).eq('id', btn.dataset.unlink);
          toast('Child unlinked', 'success');
          close();
        } catch (e) { toast('Failed: ' + e.message, 'error'); }
      });
    });
    
    // Save
    modal.querySelector('#famSave').addEventListener('click', async () => {
      const newParent = modal.querySelector('#famParentSelect').value || null;
      const newChild = modal.querySelector('#famChildSelect').value;
      try {
        if (newParent !== eq.parent_equipment_id) {
          await NX.sb.from('equipment').update({ parent_equipment_id: newParent }).eq('id', equipId);
        }
        if (newChild) {
          await NX.sb.from('equipment').update({ parent_equipment_id: equipId }).eq('id', newChild);
        }
        toast('Family updated', 'success');
        close();
        // Re-sync to brain
        if (NX.eqBrainSync?.syncOne) NX.eqBrainSync.syncOne(equipId);
      } catch (e) { 
        toast('Save failed (you may need to add a parent_equipment_id column): ' + e.message, 'error');
      }
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PARTS TAB ⋯ — top-right of each part section
     Already installed by installContextMenuOnParts() but with a default
     position. Let's reposition via CSS class.
     ═════════════════════════════════════════════════════════════════════════ */

  /* ═════════════════════════════════════════════════════════════════════════
     TIMELINE card click → rich detail modal
     
     When a user taps a timeline card, we open a modal showing:
       • Full unabbreviated description
       • Photos (from linked pm_log if exists)
       • PDF invoice (from linked pm_log)
       • Finger-drawn signature (from linked pm_log)
       • Contractor phone / company
       • Cost, parts replaced, next service date
       • Approval metadata
     
     For legacy timeline entries (no pm_log_id), we still show a modal with
     just the maintenance row's fields — consistent UX, no photos/PDF.
     ═════════════════════════════════════════════════════════════════════════ */

  function installTimelineCardClick() {
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.eq-timeline-item').forEach(card => {
        if (card.dataset.clickWired === '1') return;
        card.dataset.clickWired = '1';
        card.classList.add('eq-timeline-clickable');
        
        card.addEventListener('click', (e) => {
          // Don't trigger when the ✕ delete button is tapped
          if (e.target.closest('.eq-timeline-del, button, a')) return;
          // Extract maintenance ID from the delete button's onclick
          const delBtn = card.querySelector('.eq-timeline-del');
          const m = delBtn?.getAttribute('onclick')?.match(/['"]([\w-]+)['"]/);
          if (!m) { console.warn('[ctx-menu] no maintenance ID on card'); return; }
          openTimelineDetail(m[1]);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function openTimelineDetail(maintId) {
    const modal = document.createElement('div');
    modal.className = 'eq-tl-detail-modal';
    modal.innerHTML = `
      <div class="eq-tl-detail-bg"></div>
      <div class="eq-tl-detail-card">
        <div class="eq-tl-detail-header">
          <div class="eq-tl-detail-title">Service Detail</div>
          <button class="eq-tl-detail-close">${cmSvg("close","16px")}</button>
        </div>
        <div class="eq-tl-detail-body" id="eqTlDetailBody">Loading…</div>
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.eq-tl-detail-close').addEventListener('click', close);
    modal.querySelector('.eq-tl-detail-bg').addEventListener('click', close);

    try {
      // 1. Load the maintenance row
      const { data: m } = await NX.sb.from('equipment_maintenance')
        .select('*')
        .eq('id', maintId)
        .single();
      if (!m) throw new Error('Maintenance record not found');

      // 2. If it has a pm_log_id, load the rich PM log
      let pmLog = null;
      if (m.pm_log_id) {
        const { data } = await NX.sb.from('pm_logs')
          .select('*')
          .eq('id', m.pm_log_id)
          .single();
        pmLog = data;
      }

      renderTimelineDetail(modal, m, pmLog);
    } catch (err) {
      modal.querySelector('#eqTlDetailBody').innerHTML = 
        `<div class="eq-tl-detail-error">Could not load: ${esc(err.message)}</div>`;
    }
  }

  function renderTimelineDetail(modal, m, pmLog) {
    const body = modal.querySelector('#eqTlDetailBody');
    const typeLabel = (m.event_type || 'service').toUpperCase();
    const dateStr = m.event_date ? new Date(m.event_date).toLocaleDateString([], 
      { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
    
    // Use pmLog fields if available (richer), else fall back to m fields
    const photoUrls = pmLog?.photo_urls || [];
    const pdfUrl = pmLog?.pdf_url || null;
    const signature = pmLog?.signature_data || null;
    const contractorPhone = pmLog?.contractor_phone || null;
    const contractorEmail = pmLog?.contractor_email || null;
    const partsReplaced = pmLog?.parts_replaced || null;
    const nextServiceDate = pmLog?.next_service_date || null;
    const submittedAt = pmLog?.submitted_at || null;
    const reviewedAt = pmLog?.reviewed_at || null;
    const reviewedBy = pmLog?.reviewed_by || null;
    const cost = m.cost || pmLog?.cost_amount || null;
    
    body.innerHTML = `
      <div class="eq-tl-detail-hero">
        <div class="eq-tl-detail-type">${esc(typeLabel)}</div>
        <div class="eq-tl-detail-date">${esc(dateStr)}</div>
        ${pmLog ? `<div class="eq-tl-detail-source">Submitted via QR code</div>` : ''}
      </div>

      ${m.description ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-section-label">Work Performed</div>
          <div class="eq-tl-detail-text">${esc(m.description)}</div>
        </div>
      ` : ''}

      ${partsReplaced ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-section-label">Parts Replaced</div>
          <div class="eq-tl-detail-text">${esc(partsReplaced)}</div>
        </div>
      ` : ''}

      ${m.performed_by ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-section-label">Service Tech</div>
          <div class="eq-tl-detail-contractor">
            <div class="eq-tl-detail-contractor-name">${esc(m.performed_by)}</div>
            ${contractorPhone ? `
              <a href="tel:${esc(contractorPhone.replace(/[^\d+]/g,''))}" class="eq-tl-detail-contact-btn">
                ${cmSvg('phone2','12px')} ${esc(contractorPhone)}
              </a>
            ` : ''}
            ${contractorEmail ? `
              <a href="mailto:${esc(contractorEmail)}" class="eq-tl-detail-contact-btn">
                ${cmSvg('email','12px')} ${esc(contractorEmail)}
              </a>
            ` : ''}
          </div>
        </div>
      ` : ''}

      ${cost || nextServiceDate || m.downtime_hours ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-stats">
            ${cost ? `
              <div class="eq-tl-detail-stat">
                <div class="eq-tl-detail-stat-label">Cost</div>
                <div class="eq-tl-detail-stat-value">$${parseFloat(cost).toFixed(2)}</div>
              </div>
            ` : ''}
            ${nextServiceDate ? `
              <div class="eq-tl-detail-stat">
                <div class="eq-tl-detail-stat-label">Next Service</div>
                <div class="eq-tl-detail-stat-value">${esc(new Date(nextServiceDate).toLocaleDateString())}</div>
              </div>
            ` : ''}
            ${m.downtime_hours ? `
              <div class="eq-tl-detail-stat">
                <div class="eq-tl-detail-stat-label">Downtime</div>
                <div class="eq-tl-detail-stat-value">${m.downtime_hours}h</div>
              </div>
            ` : ''}
          </div>
        </div>
      ` : ''}

      ${m.symptoms ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-section-label">Symptoms</div>
          <div class="eq-tl-detail-text">${esc(m.symptoms)}</div>
        </div>
      ` : ''}

      ${m.root_cause ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-section-label">Root Cause</div>
          <div class="eq-tl-detail-text">${esc(m.root_cause)}</div>
        </div>
      ` : ''}

      ${photoUrls.length ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-section-label">Photos (${photoUrls.length})</div>
          <div class="eq-tl-detail-photos">
            ${photoUrls.map(url => `
              <a href="${esc(url)}" target="_blank" rel="noopener" class="eq-tl-detail-photo-link">
                <img src="${esc(url)}" class="eq-tl-detail-photo" loading="lazy">
              </a>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${pdfUrl ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-section-label">Invoice / Report</div>
          <a href="${esc(pdfUrl)}" target="_blank" rel="noopener" class="eq-tl-detail-pdf-btn">
            ${cmSvg('documents','12px')} Open PDF
          </a>
        </div>
      ` : ''}

      ${signature ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-section-label">Signature</div>
          <img src="${esc(signature)}" class="eq-tl-detail-signature">
        </div>
      ` : ''}

      ${m.notes ? `
        <div class="eq-tl-detail-section">
          <div class="eq-tl-detail-section-label">Notes</div>
          <div class="eq-tl-detail-text">${esc(m.notes)}</div>
        </div>
      ` : ''}

      ${submittedAt || reviewedAt ? `
        <div class="eq-tl-detail-metadata">
          ${submittedAt ? `<div>Submitted: ${new Date(submittedAt).toLocaleString()}</div>` : ''}
          ${reviewedAt ? `<div>Approved: ${new Date(reviewedAt).toLocaleString()}${reviewedBy ? ' by ' + esc(reviewedBy) : ''}</div>` : ''}
        </div>
      ` : ''}
    `;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     PATCH PM approval flow so new equipment_maintenance rows get the
     pm_log_id link. This enables the timeline detail modal to pull
     photos/PDF/signature from the original contractor submission.
     
     We override updateReviewStatus — but wait, that function is local to
     equipment-public-pm.js, not accessible here. Instead we patch 
     NX.pmLogger.reviewPendingLogs() output at approval time by hooking
     the Supabase .insert call on equipment_maintenance via a proxy.
     
     Simpler approach: after the existing approval inserts the maintenance
     row, we run a quick cleanup job that backfills pm_log_id on any
     orphaned rows with matching contractor_name + service date.
     ═════════════════════════════════════════════════════════════════════════ */

  function patchPmApprovalToLinkMaintenance() {
    // Run a backfill pass every few minutes: any equipment_maintenance rows
    // that were created by a PM log approval but don't have pm_log_id set 
    // (because they were created before this migration landed), try to
    // link them by matching contractor + equipment + date.
    const runBackfill = async () => {
      try {
        // Get approved pm_logs that might have a matching maintenance
        const { data: approvedLogs } = await NX.sb.from('pm_logs')
          .select('id, equipment_id, contractor_name, service_date, work_performed')
          .eq('review_status', 'approved')
          .eq('is_deleted', false);
        if (!approvedLogs?.length) return;
        
        // For each, check if there's an equipment_maintenance row that looks
        // like it — same equipment, same date, performed_by contains the contractor name
        // — and doesn't yet have pm_log_id set
        for (const log of approvedLogs) {
          const { data: matches } = await NX.sb.from('equipment_maintenance')
            .select('id, pm_log_id, performed_by')
            .eq('equipment_id', log.equipment_id)
            .eq('event_date', log.service_date)
            .is('pm_log_id', null);
          if (!matches?.length) continue;
          // Find the one whose performed_by contains the contractor name
          const candidate = matches.find(m => 
            m.performed_by && m.performed_by.includes(log.contractor_name)
          );
          if (candidate) {
            await NX.sb.from('equipment_maintenance')
              .update({ pm_log_id: log.id })
              .eq('id', candidate.id);
          }
        }
      } catch (e) {
        console.warn('[ctx-menu] pm_log backfill failed:', e);
      }
    };
    
    // Run once after init, and every 3 minutes while app is open
    setTimeout(runBackfill, 4000);
    setInterval(runBackfill, 180000);
    
    // Also wrap NX.pmLogger's approve flow if it exists, to set pm_log_id
    // directly on new maintenance inserts (forward-compatible, no backfill 
    // needed for future approvals)
    whenReady(() => NX.pmLogger && NX.pmLogger.reviewPendingLogs, () => {
      // Can't easily hook the nested updateReviewStatus — but the backfill 
      // covers it within a few minutes. Acceptable tradeoff.
    });
  }

  // Expose key functions
  NX.ctxMenu = {
    openContextMenu, closeOpenMenu,
    softDeleteWithConfirm, restoreItem,
    openItemAuditLog,
    printSingleLabel, printAverySheet, printActiveTab, printEverything,
    exportShoppingList, openFamilyManager
  };

})();
