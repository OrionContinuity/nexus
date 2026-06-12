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
//           unified NX.work.fulfillForEquipment cascade.
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
      .wo-step-ts{font-size:12px}`;
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
        if (!NX.work?.fulfillForEquipment) { NX.toast?.('Work API not loaded', 'error'); return; }
        if (!confirm('Mark this work order complete? Closes the card and logs the service.')) return;
        btn.textContent = '…';
        btn.disabled = true;
        const res = await NX.work.fulfillForEquipment({
          equipmentId: eqId,
          performedBy: NX.currentUser?.name || 'Staff',
        }).catch(() => null);
        if (res && res.ok) {
          NX.toast?.('Work order completed', 'success');
          row.remove();
          const left = list.querySelectorAll('.wo-row').length;
          wrap.querySelector('#woCount').textContent = left ? '· ' + left + ' open' : '';
          if (!left) list.innerHTML = '<div class="wo-empty">No open work orders. 🎉</div>';
        } else {
          btn.textContent = 'Complete';
          btn.disabled = false;
          NX.toast?.('Could not complete', 'error');
        }
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
    body.querySelector('#woDComplete')?.addEventListener('click', async (e) => {
      if (!NX.work?.fulfillForEquipment) { NX.toast?.('Work API not loaded', 'error'); return; }
      if (!confirm('Mark this work order complete?')) return;
      e.currentTarget.textContent = '…'; e.currentTarget.disabled = true;
      const res = await NX.work.fulfillForEquipment({ equipmentId: eqId, performedBy: NX.currentUser?.name || 'Staff' }).catch(() => null);
      if (res && res.ok) { NX.toast?.('Work order completed', 'success'); sheet.remove(); parentWrap && parentWrap.remove(); open(); }
      else { NX.toast?.('Could not complete', 'error'); e.currentTarget.textContent = 'Complete'; e.currentTarget.disabled = false; }
    });
  }

  window.NX = window.NX || {};
  NX.modules = NX.modules || {};
  NX.modules.workOrders = { open };
})();
