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
    patchSoftDelete();
    patchLogDeletedTab();
    console.log('[ctx-menu] all hooks installed');
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
      { icon: '✎', label: 'Edit', action: () => NX.modules.equipment?.edit?.(equipId) },
      { icon: '🖨', label: 'Print this Tab', action: () => printActiveTab(equipId) },
      { icon: '🏷', label: 'Print Single Label', action: () => printSingleLabel(equipId) },
      { icon: '📄', label: 'Print Avery Sheet (10×)', action: () => printAverySheet(equipId) },
      { icon: '🛒', label: 'Shopping List', action: () => exportShoppingList(equipId) },
      { icon: '✨', label: 'Extract Parts from Manual', action: () => triggerExtractFromManual(equipId) },
      { icon: '👥', label: 'Set Parent / Add Child', action: () => openFamilyManager(equipId, equipName) },
      { icon: '📜', label: 'Audit Log', action: () => openItemAuditLog('equipment', equipId, equipName) },
      { icon: '🗑', label: 'Delete', danger: true, action: () => softDeleteWithConfirm('equipment', equipId, equipName) }
    ];
  }

  function buildPartMenu(partId, partName, equipId) {
    return [
      { icon: '✎', label: 'Edit', action: () => NX.modules.equipment?.editPart?.(partId) },
      { icon: '📜', label: 'Audit Log', action: () => openItemAuditLog('equipment_parts', partId, partName) },
      { icon: '🗑', label: 'Delete', danger: true, action: () => softDeleteWithConfirm('equipment_parts', partId, partName, equipId) }
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
        <div class="ctx-confirm-icon">🗑</div>
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
          <div class="ctx-audit-title">📜 Activity Log</div>
          <button class="ctx-audit-close">✕</button>
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
          type: 'create', icon: '✨',
          title: 'Created',
          detail: null,
          who: item.created_by || item.reported_by || null,
          when: item.created_at
        });
      }
      if (item?.is_deleted && item?.deleted_at) {
        events.push({
          type: 'delete', icon: '🗑',
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
          type: 'ai', icon: '⚡',
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
            type: 'dispatch', icon: '📞',
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
            type: 'service', icon: '🔧',
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
            type: 'log', icon: '📝',
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
            type: 'ticket', icon: '🎫',
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
    chip.innerHTML = '🗑 Deleted';
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
        placeholder="🔍 Search log…" autocomplete="off">
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

    const TYPE_ICONS = {
      equipment: '⚙', part: '🔩', node: '⭐',
      ticket: '🎫', card: '📋', event: '📅'
    };

    list.innerHTML = currentDeletedItems.map(item => `
      <div class="feed-row ctx-deleted-row" data-table="${tableForType(item.item_type)}" data-id="${esc(item.item_id)}">
        <div class="ctx-deleted-icon">${TYPE_ICONS[item.item_type] || '📄'}</div>
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
        <button class="ctx-deleted-restore-btn">♻ Restore</button>
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
          <div style="font-size:15px;font-weight:600;color:var(--accent,#c8a44e);">👥 Equipment Family</div>
          <button class="ctx-audit-close" id="famClose">✕</button>
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

  // Expose key functions
  NX.ctxMenu = {
    openContextMenu, closeOpenMenu,
    softDeleteWithConfirm, restoreItem,
    openItemAuditLog,
    printSingleLabel, printAverySheet, printActiveTab,
    exportShoppingList, openFamilyManager
  };

})();
