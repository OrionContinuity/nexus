// ═══════════════════════════════════════════════════════════════════════
//  work-orders.js — standalone Work Orders module
//
//  Work orders (open equipment_issues) were previously only viewable as a
//  sub-view of the Home dashboard (NXRM.view.switchTo('issues')), so the
//  Equipment-tab button silently depended on Home having initialized.
//  This module is self-contained and lazy-loaded on demand — same pattern
//  as Duties — so the button works from anywhere.
//
//  Surface: NX.modules.workOrders.open()
//  Reads:   v_issue_summary (fallback: equipment_issues + equipment names)
//  Actions: open the WO's board card (boardOpenIntent deep link, which
//           board.js resolves across boards), or complete it via the
//           completion sheet (invoice photo, notes, equipment status)
//           → unified NX.work.fulfillForEquipment cascade, which now
//           moves the board card to Done instead of archiving it.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.NX && NX.modules && NX.modules.workOrders) return;  // idempotent

  const esc = s => s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const STATUS_LABEL = {
    reported: 'Reported', contractor_called: 'Contractor called',
    eta_set: 'ETA set', in_progress: 'In progress',
    awaiting_parts: 'Awaiting parts',
  };
  const PRI_COLOR = { critical: '#e5484d', high: '#d4a44e', normal: '#9a8f7d', low: '#6b7a8a' };

  function age(ts) {
    if (!ts) return '';
    const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
    return d <= 0 ? 'today' : d + 'd';
  }
  function lastMove(i) {
    return i.in_progress_at || i.eta_set_at || i.contractor_called_at || i.reported_at;
  }

  async function fetchOpen() {
    // Preferred: the ready-made summary view (joins equipment name).
    try {
      const { data, error } = await NX.sb.from('v_issue_summary').select('*').limit(300);
      if (!error && data) return data.filter(i => i.is_open !== false &&
        !/^(repaired|closed|resolved)$/i.test(i.status || ''));
    } catch (_) {}
    // Fallback: raw table + a name lookup.
    const { data: issues } = await NX.sb.from('equipment_issues')
      .select('id, equipment_id, title, status, priority, reported_at, contractor_called_at, eta_set_at, in_progress_at')
      .not('status', 'in', '(repaired,closed,resolved)')
      .order('reported_at', { ascending: false }).limit(300);
    const list = issues || [];
    const eqIds = [...new Set(list.map(i => i.equipment_id).filter(Boolean))];
    let names = {};
    if (eqIds.length) {
      const { data: eqs } = await NX.sb.from('equipment').select('id, name, location').in('id', eqIds);
      (eqs || []).forEach(e => { names[e.id] = e; });
    }
    return list.map(i => ({ ...i,
      equipment_name: names[i.equipment_id]?.name || '',
      restaurant: names[i.equipment_id]?.location || '' }));
  }

  // Inline completion cascade — duplicates NX.work.fulfillForEquipment
  // deliberately: the device-side zombie cache serves a stale domain.js
  // (no NX.work), so this module must be able to complete a work order
  // entirely on its own. Uses NX.work when present; this otherwise.
  async function fulfillLocal(equipmentId, extras) {
    extras = extras || {};
    const now = new Date().toISOString();
    let card = null;
    try {
      const { data } = await NX.sb.from('kanban_cards')
        .select('id, ticket_id, prior_eq_status, board_id, list_id')
        .eq('equipment_id', equipmentId).eq('archived', false).is('closed_at', null)
        .order('created_at', { ascending: false }).limit(1);
      card = data && data[0];
    } catch (_) {}
    // 1. Mark the open issue(s) repaired (+ file the invoice photo)
    try {
      const patch = { status: 'repaired', repaired_at: now };
      if (extras.invoiceUrl) { patch.invoice_url = extras.invoiceUrl; patch.invoice_received_at = now; }
      await NX.sb.from('equipment_issues')
        .update(patch)
        .eq('equipment_id', equipmentId)
        .not('status', 'in', '(repaired,closed,resolved)');
    } catch (_) {}
    // 2. The card rides to the board's DONE list (visible, not archived);
    //    the ticket mirror closes.
    if (card) {
      try {
        const patch = { closed_at: now };
        if (extras.notes) patch.resolution_notes = extras.notes;
        if (card.board_id) {
          const { data: lists } = await NX.sb.from('board_lists')
            .select('*').eq('board_id', card.board_id).order('position');
          const live = (lists || []).filter(l => l && l.archived !== true);
          const done = live.find(l => /done|complete|closed/i.test(l.name || '')) || live[live.length - 1];
          if (done && String(done.id) !== String(card.list_id)) {
            patch.list_id = done.id;
            patch.position = 0;
            try {
              const { data: inList } = await NX.sb.from('kanban_cards')
                .select('position').eq('list_id', done.id).eq('archived', false);
              if (inList && inList.length) {
                patch.position = Math.min(...inList.map(c => (typeof c.position === 'number' ? c.position : 0))) - 1;
              }
            } catch (_) {}
          }
        }
        await NX.sb.from('kanban_cards').update(patch).eq('id', card.id);
      } catch (_) {}
      if (card.ticket_id) {
        try { await NX.sb.from('tickets').update({ status: 'closed', closed_at: now }).eq('id', card.ticket_id); } catch (_) {}
      }
    }
    // 3. Equipment status: the completion form's choice wins. Clear the
    //    sticky status_note with it (it narrated the finished saga).
    try {
      const st = extras.restoreStatus || (card && card.prior_eq_status) || 'operational';
      const { error } = await NX.sb.from('equipment')
        .update({ status: st, status_note: null }).eq('id', equipmentId);
      if (error) await NX.sb.from('equipment').update({ status: st }).eq('id', equipmentId);
    } catch (_) {}
    // 4. Audit trail, invoice attached
    try {
      const row = {
        equipment_id: equipmentId, event_type: 'service',
        description: 'Work order completed' + (extras.notes ? ' — ' + extras.notes : ''),
        performed_by: (NX.currentUser && NX.currentUser.name) || 'Staff',
        event_date: now,
      };
      if (extras.invoiceUrl) { row.receipt_url = extras.invoiceUrl; row.photos = [extras.invoiceUrl]; }
      await NX.sb.from('equipment_maintenance').insert(row);
    } catch (_) {}
    try { if (NX.modules?.board?.reload) NX.modules.board.reload(); } catch (_) {}
    return { ok: true };
  }
  function doFulfill(equipmentId, extras) {
    const api = NX.work && NX.work.fulfillForEquipment;
    const args = Object.assign({ equipmentId, performedBy: NX.currentUser?.name || 'Staff' }, extras || {});
    return api ? NX.work.fulfillForEquipment(args) : fulfillLocal(equipmentId, extras);
  }

  // Invoice/receipt photo → nexus-files bucket (same pattern as board.js).
  async function uploadInvoicePhoto(file, equipmentId) {
    try {
      const ext = (((file.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
      const path = `invoices/${equipmentId}/${Date.now()}.${ext}`;
      const { error } = await NX.sb.storage.from('nexus-files')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (error) throw error;
      const { data } = NX.sb.storage.from('nexus-files').getPublicUrl(path);
      return (data && data.publicUrl) || null;
    } catch (e) {
      console.warn('[workOrders] invoice upload failed:', e?.message || e);
      return null;
    }
  }

  // ─── Completion sheet ────────────────────────────────────────────────
  // Completing a work order asks for the story: an invoice/receipt photo
  // (opens the camera on mobile), what was done, and where the unit's
  // status should land. Photo and notes are optional — a quick tap-through
  // still completes; the status defaults to Operational.
  function openCompleteSheet({ eqId, title, onDone }) {
    const wrap = document.createElement('div');
    wrap.className = 'wo-overlay';
    wrap.innerHTML = `
      <div class="wo-head"><div class="wo-title">Complete work order</div>
      <button class="wo-close">Cancel</button></div>
      <div class="wo-list">
        ${title ? `<div class="wo-d-title" style="padding-top:0">${esc(title)}</div>` : ''}
        <div class="wo-d-block"><div class="wo-d-h">Invoice / receipt photo</div>
          <label class="wo-photo-btn">📷 <span id="woPhLbl">Take photo or upload</span>
            <input type="file" id="woPhoto" accept="image/*" capture="environment" hidden>
          </label>
          <img id="woPhPrev" alt="" style="display:none;max-width:100%;max-height:220px;border-radius:12px;margin-top:10px">
        </div>
        <div class="wo-d-block"><div class="wo-d-h">Completion notes</div>
          <textarea id="woNotes" class="wo-input" rows="3" placeholder="What was done, parts used, cost…"></textarea>
        </div>
        <div class="wo-d-block"><div class="wo-d-h">Equipment status after this</div>
          <select id="woEqStatus" class="wo-input">
            <option value="operational" selected>✅ Operational — back in service</option>
            <option value="needs_service">🟡 Still needs service</option>
            <option value="down">🔴 Still down</option>
          </select>
        </div>
        <div style="padding:16px 0 26px">
          <button class="wo-btn wo-btn-go" id="woDoComplete" style="width:100%;padding:14px;font-size:14px">✓ Complete work order</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.wo-close').addEventListener('click', () => wrap.remove());
    let file = null;
    wrap.querySelector('#woPhoto').addEventListener('change', (e) => {
      file = e.target.files && e.target.files[0];
      if (!file) return;
      wrap.querySelector('#woPhLbl').textContent = file.name || 'Photo attached';
      const img = wrap.querySelector('#woPhPrev');
      try { img.src = URL.createObjectURL(file); img.style.display = 'block'; } catch (_) {}
    });
    wrap.querySelector('#woDoComplete').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      let invoiceUrl = null;
      if (file) {
        btn.textContent = 'Uploading photo…';
        invoiceUrl = await uploadInvoicePhoto(file, eqId);
        if (!invoiceUrl) NX.toast?.('Photo upload failed — completing without it', 'warn', 3200);
      }
      btn.textContent = 'Completing…';
      const res = await doFulfill(eqId, {
        notes: (wrap.querySelector('#woNotes').value || '').trim(),
        restoreStatus: wrap.querySelector('#woEqStatus').value,
        invoiceUrl,
      }).catch(() => null);
      if (res && res.ok) {
        wrap.remove();
        NX.toast?.('Work order completed — card moved to Done', 'success');
        onDone && onDone();
      } else {
        btn.disabled = false;
        btn.textContent = '✓ Complete work order';
        NX.toast?.('Could not complete', 'error');
      }
    });
  }

  function rowHtml(i) {
    const pri = (i.priority || 'normal').toLowerCase();
    const sub = [i.equipment_name, i.restaurant].filter(Boolean).join(' · ');
    return `
      <div class="wo-row" data-issue="${esc(i.id)}" data-eq="${esc(i.equipment_id || '')}">
        <div class="wo-row-main" data-act="detail" role="button">
          <div class="wo-row-title"><span class="wo-pri" style="--c:${PRI_COLOR[pri] || PRI_COLOR.normal}"></span>${esc(i.title || 'Work order')}</div>
          <div class="wo-row-sub">${esc(sub)}${sub ? ' · ' : ''}${esc(STATUS_LABEL[i.status] || i.status || '')} · idle ${age(lastMove(i))}</div>
        </div>
        <div class="wo-row-actions">
          <button class="wo-btn" data-act="board">Board</button>
          ${i.equipment_id ? '<button class="wo-btn wo-btn-go" data-act="complete">Complete</button>' : ''}
        </div>
      </div>`;
  }

  function injectStyles() {
    if (document.getElementById('woStyles')) return;
    const s = document.createElement('style');
    s.id = 'woStyles';
    s.textContent = `
      .wo-overlay{position:fixed;inset:0;background:var(--nx-bg,rgba(12,10,8,.97));z-index:1400;display:flex;flex-direction:column;font-family:var(--nx-font-body,'DM Sans',sans-serif)}
      .wo-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 10px}
      .wo-title{font-family:var(--nx-font-display,'Outfit',sans-serif);font-size:19px;font-weight:600;color:var(--nx-text-strong,#f0e9dd)}
      .wo-count{font-size:12px;color:var(--nx-faint,#857f75);margin-left:8px}
      .wo-close{background:none;border:1px solid var(--nx-border,rgba(212,182,138,.18));border-radius:999px;color:var(--nx-faint,#9a8f7d);font-size:13px;padding:6px 14px}
      .wo-list{flex:1;overflow-y:auto;padding:4px 14px 28px}
      .wo-row{display:flex;align-items:center;gap:10px;padding:13px 12px;border:1px solid var(--nx-border,rgba(212,182,138,.12));border-radius:14px;margin-bottom:10px;background:var(--nx-elevated,rgba(255,255,255,.02))}
      .wo-row-main{flex:1;min-width:0}
      .wo-row-title{font-size:14.5px;font-weight:600;color:var(--nx-text-strong,#f0e9dd);display:flex;align-items:center;gap:8px}
      .wo-pri{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
      .wo-row-sub{font-size:12px;color:var(--nx-faint,#857f75);margin-top:3px}
      .wo-row-actions{display:flex;gap:6px;flex:none}
      .wo-btn{border:1px solid var(--nx-border,rgba(212,182,138,.22));background:none;color:var(--nx-text-strong,#e8e0d2);border-radius:999px;font-size:12px;padding:7px 12px}
      .wo-btn-go{color:var(--nx-gold,#d4a44e);border-color:var(--nx-gold,#d4a44e);font-weight:600}
      .wo-empty{text-align:center;color:var(--nx-faint,#857f75);padding:60px 20px;font-size:14px}
      .wo-d-title{font-family:var(--nx-font-display,'Outfit',sans-serif);font-size:21px;font-weight:650;color:var(--nx-text-strong,#f0e9dd);padding:6px 2px 4px}
      .wo-d-sub{font-size:13.5px;color:var(--nx-faint,#857f75);padding:0 2px 12px}
      .wo-d-chips{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:16px}
      .wo-chip{font-size:12px;padding:6px 12px;border-radius:999px;border:1px solid var(--nx-border,rgba(212,182,138,.22));color:var(--nx-text-strong,#e8e0d2)}
      .wo-d-block{padding:12px 2px;border-top:1px solid var(--nx-border,rgba(212,182,138,.10))}
      .wo-d-h{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--nx-gold,#d4a44e);margin-bottom:8px}
      .wo-d-text{font-size:14px;line-height:1.55;color:var(--nx-text-strong,#e8e0d2)}
      .wo-step{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13.5px;color:var(--nx-faint,#857f75)}
      .wo-step.is-done{color:var(--nx-text-strong,#e8e0d2)}
      .wo-step-dot{width:8px;height:8px;border-radius:50%;background:var(--nx-border,rgba(212,182,138,.25));flex:none}
      .wo-step.is-done .wo-step-dot{background:var(--nx-gold,#d4a44e)}
      .wo-step-lbl{flex:1}
      .wo-step-ts{font-size:12px}
      .wo-photo-btn{display:flex;align-items:center;gap:8px;padding:12px 14px;border:1px dashed var(--nx-border,rgba(212,182,138,.35));border-radius:12px;color:var(--nx-text-strong,#e8e0d2);font-size:13.5px;cursor:pointer}
      .wo-input{width:100%;box-sizing:border-box;background:var(--nx-elevated,rgba(255,255,255,.04));border:1px solid var(--nx-border,rgba(212,182,138,.22));border-radius:12px;color:var(--nx-text-strong,#f0e9dd);font-size:14px;padding:11px 12px;font-family:inherit}
      textarea.wo-input{resize:vertical}`;
    document.head.appendChild(s);
  }

  async function open() {
    injectStyles();
    document.querySelectorAll('.wo-overlay').forEach(m => m.remove());
    const wrap = document.createElement('div');
    wrap.className = 'wo-overlay';
    wrap.innerHTML = `
      <div class="wo-head">
        <div class="wo-title">Work Orders<span class="wo-count" id="woCount"></span></div>
        <button class="wo-close">Close</button>
      </div>
      <div class="wo-list" id="woList"><div class="wo-empty">Loading…</div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.wo-close').addEventListener('click', () => wrap.remove());

    let items = [];
    try { items = await fetchOpen(); } catch (e) { console.error('[workOrders]', e); }
    // Critical/high first, then oldest movement first (most stale on top).
    const rank = { critical: 0, high: 1, normal: 2, low: 3 };
    items.sort((a, b) =>
      (rank[(a.priority || 'normal')] ?? 2) - (rank[(b.priority || 'normal')] ?? 2) ||
      new Date(lastMove(a)) - new Date(lastMove(b)));

    const list = wrap.querySelector('#woList');
    wrap.querySelector('#woCount').textContent = items.length ? '· ' + items.length + ' open' : '';
    list.innerHTML = items.length ? items.map(rowHtml).join('')
      : '<div class="wo-empty">No open work orders. 🎉</div>';

    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('.wo-btn') || e.target.closest('[data-act="detail"]');
      if (!btn) return;
      const row = btn.closest('.wo-row');
      const issueId = row?.dataset.issue;
      const eqId = row?.dataset.eq;
      if (btn.dataset.act === 'detail' && issueId) {
        openDetail(issueId, eqId, wrap);
      } else if (btn.dataset.act === 'board' && issueId) {
        // Ensure the card exists BEFORE navigating (independent of the
        // board's own self-heal, which a stale board.js may lack).
        btn.textContent = '…';
        try { if (NX.domain?.ensureIssueCard) await NX.domain.ensureIssueCard(issueId); } catch (_) {}
        NX.boardOpenIntent = { issueId };
        wrap.remove();
        document.querySelector('.nav-tab[data-view="board"]')?.click();
        document.querySelector('.bnav-btn[data-view="board"]')?.click();
      } else if (btn.dataset.act === 'complete' && eqId) {
        const title = row.querySelector('.wo-row-title')?.textContent?.trim() || '';
        openCompleteSheet({ eqId, title, onDone: () => {
          row.remove();
          const left = list.querySelectorAll('.wo-row').length;
          wrap.querySelector('#woCount').textContent = left ? '· ' + left + ' open' : '';
          if (!left) list.innerHTML = '<div class="wo-empty">No open work orders. 🎉</div>';
        } });
      }
    });
  }

  // ─── Work-order detail sheet ─────────────────────────────────────────
  // The full picture in one place: lifecycle timeline, description,
  // contractor, AND the linked board card's info (list, labels, comments)
  // — work orders as a function of their own, with the board's view of
  // the same item folded in.
  async function openDetail(issueId, eqId, parentWrap) {
    const sheet = document.createElement('div');
    sheet.className = 'wo-overlay wo-detail';
    sheet.innerHTML = `
      <div class="wo-head"><div class="wo-title">Work Order</div>
      <button class="wo-close">Back</button></div>
      <div class="wo-list" id="woDetailBody"><div class="wo-empty">Loading…</div></div>`;
    document.body.appendChild(sheet);
    sheet.querySelector('.wo-close').addEventListener('click', () => sheet.remove());

    let issue = null, card = null, eq = null;
    try {
      const r = await NX.sb.from('equipment_issues').select('*').eq('id', issueId).maybeSingle();
      issue = r.data;
    } catch (_) {}
    try {
      if (eqId) {
        const r = await NX.sb.from('equipment').select('name, location, area, status').eq('id', eqId).maybeSingle();
        eq = r.data;
      }
    } catch (_) {}
    try {
      const r = await NX.sb.from('kanban_cards').select('id, column_name, labels, description, comments, priority, due_date, archived, created_at')
        .contains('labels', ['issue:' + issueId]).order('created_at', { ascending: false }).limit(1);
      card = r.data && r.data[0];
    } catch (_) {}

    const body = sheet.querySelector('#woDetailBody');
    if (!issue) { body.innerHTML = '<div class="wo-empty">Could not load this work order.</div>'; return; }

    const steps = [
      ['Reported', issue.reported_at], ['Contractor called', issue.contractor_called_at],
      ['ETA set', issue.eta_at || issue.eta_set_at], ['In progress', issue.in_progress_at],
      ['Awaiting parts', issue.awaiting_parts_at], ['Repaired', issue.repaired_at],
    ];
    const fmtD = ts => ts ? new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    const timeline = steps.map(([lbl, ts]) => `
      <div class="wo-step ${ts ? 'is-done' : ''}">
        <span class="wo-step-dot"></span>
        <span class="wo-step-lbl">${lbl}</span>
        <span class="wo-step-ts">${fmtD(ts) || '—'}</span>
      </div>`).join('');

    const comments = Array.isArray(card?.comments) ? card.comments.length : 0;
    body.innerHTML = `
      <div class="wo-d-title">${esc(issue.title || 'Work order')}</div>
      <div class="wo-d-sub">${esc([eq?.name, eq?.location, eq?.area].filter(Boolean).join(' · '))}</div>
      <div class="wo-d-chips">
        <span class="wo-chip">${esc(STATUS_LABEL[issue.status] || issue.status || '')}</span>
        <span class="wo-chip">${esc(issue.priority || 'normal')} priority</span>
        ${issue.reported_by_name ? `<span class="wo-chip">by ${esc(issue.reported_by_name)}</span>` : ''}
      </div>
      ${issue.description ? `<div class="wo-d-block"><div class="wo-d-h">Description</div><div class="wo-d-text">${esc(issue.description)}</div></div>` : ''}
      <div class="wo-d-block"><div class="wo-d-h">Timeline</div>${timeline}</div>
      ${issue.contractor_name ? `<div class="wo-d-block"><div class="wo-d-h">Contractor</div><div class="wo-d-text">${esc(issue.contractor_name)}</div></div>` : ''}
      <div class="wo-d-block"><div class="wo-d-h">On the board</div>
        ${card ? `<div class="wo-d-text">List: <strong>${esc(card.column_name || '—')}</strong>${card.archived ? ' · archived' : ''}
          ${card.due_date ? ' · due ' + esc(card.due_date) : ''} · ${comments} comment${comments === 1 ? '' : 's'}
          ${Array.isArray(card.labels) && card.labels.filter(l => !l.startsWith('issue:')).length
            ? '<br>Labels: ' + card.labels.filter(l => !l.startsWith('issue:')).map(esc).join(', ') : ''}</div>
          ${card.description && card.description !== issue.description ? `<div class="wo-d-text" style="margin-top:6px">${esc(card.description)}</div>` : ''}`
        : '<div class="wo-d-text">No board card yet — "Open on board" will create one.</div>'}
      </div>
      <div style="display:flex;gap:10px;padding:8px 0 20px">
        <button class="wo-btn" id="woDBoard" style="flex:1;justify-content:center;padding:13px">Open on board</button>
        ${eqId && !issue.repaired_at ? '<button class="wo-btn wo-btn-go" id="woDComplete" style="flex:1;justify-content:center;padding:13px">Complete</button>' : ''}
      </div>`;

    body.querySelector('#woDBoard')?.addEventListener('click', async (e) => {
      e.currentTarget.textContent = '…';
      try { if (NX.domain?.ensureIssueCard) await NX.domain.ensureIssueCard(issueId); } catch (_) {}
      NX.boardOpenIntent = { issueId };
      sheet.remove(); parentWrap && parentWrap.remove();
      document.querySelector('.nav-tab[data-view="board"]')?.click();
      document.querySelector('.bnav-btn[data-view="board"]')?.click();
    });
    body.querySelector('#woDComplete')?.addEventListener('click', () => {
      openCompleteSheet({ eqId, title: issue.title || 'Work order', onDone: () => {
        sheet.remove(); parentWrap && parentWrap.remove(); open();
      } });
    });
  }

  window.NX = window.NX || {};
  NX.modules = NX.modules || {};
  // openDetail is exposed so the BOARD can jump card → work order
  // (the reverse of the "Open on board" deep link).
  NX.modules.workOrders = { open, openDetail };
})();
