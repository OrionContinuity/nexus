/* ═══════════════════════════════════════════════════════════════════════
   NEXUS · R&M · inbox
   ─────────────────────────────────────────────────────────────────────
   Three surfaces, one module:

     §1   /issues view   — the global Work Orders inbox
     §2   Stale section  — mounts inside the inbox above the card list
     §3   Home critical  — mounts at the top of the Home view

   All three read from v_issue_summary (fallback to base table) and
   share one realtime channel. Depends on core.js.
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';
  const { fmt, esc, score, STATUS, PRIORITY } = NXRM;

  // ─────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────

  const state = {
    issues:       [],
    filtered:     [],
    restaurants:  new Set(),
    stale:        [],
    homeTop:      [],
    filter: {
      restaurant: 'all',
      status:     'open',
      priority:   'all',
      search:     '',
      sort:       'priority',
    },
    loaded: false,
  };

  // ─────────────────────────────────────────────────────────────────────
  // DATA — load + filter + classify
  // ─────────────────────────────────────────────────────────────────────

  async function loadIssues() {
    if (!NX?.sb) return;
    try {
      const { data, error } = await NX.sb.from('v_issue_summary')
        .select('*').order('reported_at', { ascending: false }).limit(500);
      if (error) return loadFallback();
      state.issues = data || [];
    } catch (_) {
      return loadFallback();
    }
    state.restaurants = new Set(state.issues.map(i => i.restaurant).filter(Boolean));
    classify();
    applyFilters();
    render();
  }

  async function loadFallback() {
    try {
      const { data: issuesRaw } = await NX.sb.from('equipment_issues')
        .select('*').order('reported_at', { ascending: false }).limit(500);
      const { data: eqList } = await NX.sb.from('equipment')
        .select('id, name, restaurant:location, category, purchase_price');
      const eqMap = {};
      (eqList || []).forEach(e => { eqMap[e.id] = e; });
      state.issues = (issuesRaw || []).map(i => {
        const eq = eqMap[i.equipment_id] || {};
        const age = i.reported_at ? (Date.now() - new Date(i.reported_at).getTime()) / 3600000 : 0;
        return {
          ...i,
          equipment_name: eq.name || '—',
          restaurant: eq.restaurant || '—',
          equipment_category: eq.category || '',
          equipment_purchase_price: eq.purchase_price || 0,
          age_hours: age,
          is_open: !['repaired','closed','cancelled'].includes(i.status),
          unpaid_amount: (!i.invoice_paid_at) ? (i.invoice_amount || 0) : 0,
          awaiting_quote_approval: !!(i.quote_received_at && !i.quote_approved_at && !i.quote_rejected_at),
          awaiting_invoice_payment: !!(i.invoice_received_at && !i.invoice_paid_at),
          comment_count: 0,
        };
      });
      state.restaurants = new Set(state.issues.map(i => i.restaurant).filter(Boolean));
      classify();
      applyFilters();
      render();
    } catch (e) {
      console.warn('[inbox] fallback failed', e);
    }
  }

  function classify() {
    // Stale = open + idle/no-movement for >72h with status-aware reasoning
    state.stale = state.issues.filter(i => {
      if (!i.is_open) return false;
      const lastMov = i.in_progress_at || i.eta_set_at || i.contractor_called_at || i.reported_at;
      const hours = (Date.now() - new Date(lastMov).getTime()) / 3600000;
      return hours > 72;
    }).map(i => ({
      ...i,
      hours_since_movement: (Date.now() - new Date(
        i.in_progress_at || i.eta_set_at || i.contractor_called_at || i.reported_at
      ).getTime()) / 3600000,
      _reason: reasonForStale(i),
    })).sort((a, b) => b.hours_since_movement - a.hours_since_movement);

    // Home top = critical/high priority + financial pending + stale-fresh
    state.homeTop = state.issues
      .filter(i => i.is_open)
      .map(i => ({ ...i, _u: score.urgency(i) }))
      .filter(i =>
        i.priority === 'critical' || i.priority === 'high' ||
        i.awaiting_quote_approval || i.awaiting_invoice_payment ||
        (i.status === 'reported' && i.age_hours > 24) ||
        i.age_hours > 72)
      .sort((a, b) => b._u - a._u)
      .slice(0, 4);
  }

  function reasonForStale(i) {
    const lastMov = new Date(i.in_progress_at || i.eta_set_at || i.contractor_called_at || i.reported_at);
    const days = (Date.now() - lastMov.getTime()) / 86400000;
    const s = i.status || 'reported';
    if (s === 'reported' && days > 1)         return `Reported ${fmt.age(days * 24)} ago, no vendor contacted yet`;
    if (s === 'contractor_called' && days > 1) return `Vendor called ${fmt.age(days * 24)} ago, no ETA set`;
    if (s === 'eta_set' && days > 2)           return `ETA set ${fmt.age(days * 24)} ago, work not started`;
    if (s === 'in_progress' && days > 4)       return `In progress for ${fmt.age(days * 24)}, no update`;
    if (s === 'awaiting_parts' && days > 7)    return `Awaiting parts for ${fmt.age(days * 24)} — check with vendor`;
    if (s === 'awaiting_quote' && days > 3)    return `Quote requested ${fmt.age(days * 24)} ago, none received yet`;
    if (s === 'quote_approved' && days > 2)    return `Quote approved ${fmt.age(days * 24)} ago, no work scheduled`;
    return `No movement for ${fmt.age(days * 24)}`;
  }

  function applyFilters() {
    const f = state.filter;
    let result = state.issues.slice();
    if (f.restaurant !== 'all') result = result.filter(i => i.restaurant === f.restaurant);
    if (f.status === 'open')      result = result.filter(i => i.is_open);
    else if (f.status === 'closed') result = result.filter(i => !i.is_open);
    else if (f.status !== 'all')    result = result.filter(i => i.status === f.status);
    if (f.priority !== 'all') result = result.filter(i => i.priority === f.priority);
    if (f.search) {
      const q = f.search.toLowerCase();
      result = result.filter(i =>
        (i.title || '').toLowerCase().includes(q) ||
        (i.equipment_name || '').toLowerCase().includes(q) ||
        (i.contractor_company || '').toLowerCase().includes(q));
    }
    switch (f.sort) {
      case 'priority':   result.sort((a, b) => score.urgency(b) - score.urgency(a)); break;
      case 'age':        result.sort((a, b) => (b.age_hours || 0) - (a.age_hours || 0)); break;
      case 'cost':       result.sort((a, b) =>
        (b.invoice_amount || b.quote_amount || 0) - (a.invoice_amount || a.quote_amount || 0)); break;
      case 'restaurant': result.sort((a, b) => (a.restaurant || '').localeCompare(b.restaurant || '')); break;
    }
    state.filtered = result;
  }

  // ─────────────────────────────────────────────────────────────────────
  // §1 — /issues view (inbox)
  // ─────────────────────────────────────────────────────────────────────

  function renderInbox() {
    const view = NXRM.view.ensure('issuesView', 'issues');
    const f = state.filter;
    const openCount   = state.issues.filter(i => i.is_open).length;
    const awaitingQ   = state.issues.filter(i => i.awaiting_quote_approval).length;
    const awaitingI   = state.issues.filter(i => i.awaiting_invoice_payment).length;
    const pendingSpend = state.issues.filter(i => i.is_open)
      .reduce((s, i) => s + (Number(i.quote_amount) || Number(i.invoice_amount) || 0), 0);
    const restaurants = ['all', ...Array.from(state.restaurants).sort()];

    view.innerHTML = `
      <div class="nxrm-page">
        <div class="nxrm-masthead">
          <div>
            <div class="nxrm-eyebrow">REPAIR &amp; MAINTENANCE</div>
            <h1 class="nxrm-h1">Work Orders</h1>
          </div>
          <button class="nxrm-btn-pill" data-act="new-issue">+ New</button>
        </div>

        <div class="nxrm-tiles tiles-4">
          <button class="nxrm-tile" data-quick="open">
            <div class="nxrm-tile-num">${openCount}</div>
            <div class="nxrm-tile-lbl">Open</div>
          </button>
          <button class="nxrm-tile ${awaitingQ ? 'is-alert' : ''}" data-quick="quotes">
            <div class="nxrm-tile-num">${awaitingQ}</div>
            <div class="nxrm-tile-lbl">Awaiting&nbsp;Quote</div>
          </button>
          <button class="nxrm-tile ${awaitingI ? 'is-alert' : ''}" data-quick="invoices">
            <div class="nxrm-tile-num">${awaitingI}</div>
            <div class="nxrm-tile-lbl">Unpaid&nbsp;Invoices</div>
          </button>
          <div class="nxrm-tile">
            <div class="nxrm-tile-num">${fmt.money(pendingSpend)}</div>
            <div class="nxrm-tile-lbl">Pending&nbsp;Spend</div>
          </div>
        </div>

        ${renderStaleSection()}

        <div class="nxrm-filters">
          <div class="nxrm-chip-row">
            ${restaurants.map(r => `
              <button class="nxrm-chip ${f.restaurant === r ? 'is-active' : ''}"
                      data-filter-restaurant="${esc(r)}">
                ${r === 'all' ? 'All restaurants' : esc(r)}
              </button>
            `).join('')}
          </div>
          <div class="nxrm-chip-row">
            ${['open','all','reported','contractor_called','in_progress',
               'awaiting_parts','awaiting_quote','awaiting_invoice','closed']
              .map(s => `
                <button class="nxrm-chip is-secondary ${f.status === s ? 'is-active' : ''}"
                        data-filter-status="${s}">
                  ${s === 'all' ? 'All status'
                    : s === 'open' ? 'Open'
                    : s === 'closed' ? 'Closed'
                    : (STATUS[s]?.label || s)}
                </button>
              `).join('')}
          </div>
          <div class="nxrm-chip-row">
            <input class="nxrm-search" type="text"
                   placeholder="Search title, equipment, contractor…"
                   value="${esc(f.search)}" id="inboxSearch">
            <select class="nxrm-sort" id="inboxSort">
              <option value="priority"${f.sort === 'priority' ? ' selected' : ''}>Urgency</option>
              <option value="age"${f.sort === 'age' ? ' selected' : ''}>Oldest</option>
              <option value="cost"${f.sort === 'cost' ? ' selected' : ''}>Highest $</option>
              <option value="restaurant"${f.sort === 'restaurant' ? ' selected' : ''}>Restaurant</option>
            </select>
          </div>
        </div>

        <div class="nxrm-list">${renderCards()}</div>
      </div>
    `;
    wireInbox(view);
  }

  function renderCards() {
    if (!state.filtered.length) {
      return `
        <div class="nxrm-empty">
          <div class="nxrm-empty-glyph">◇</div>
          <div class="nxrm-empty-title">Nothing here.</div>
          <div class="nxrm-empty-body">
            Either the filters are too tight, or your restaurants are calm. Both are good outcomes.
          </div>
        </div>`;
    }
    return state.filtered.map(it => {
      const status = STATUS[it.status] || { label: it.status, tone: 'tone-mute', glyph: '·' };
      const pri    = PRIORITY[it.priority] || PRIORITY.normal;
      const costShown = it.invoice_amount ?? it.quote_amount;
      const badges = [];
      if (it.awaiting_quote_approval)
        badges.push(`<span class="nxrm-card-badge is-alert">💰 Quote awaiting approval — ${fmt.money(it.quote_amount)}</span>`);
      if (it.awaiting_invoice_payment)
        badges.push(`<span class="nxrm-card-badge is-alert">🧾 Invoice unpaid — ${fmt.money(it.invoice_amount)}</span>`);
      if (it.is_open && (it.age_hours || 0) > 72)
        badges.push(`<span class="nxrm-card-badge is-warn">⏱ Stale — open ${fmt.age(it.age_hours)}</span>`);

      return `
        <button class="nxrm-card ${pri.tone} ${!it.is_open ? 'is-closed' : ''}"
                data-issue-id="${esc(it.id)}"
                data-equipment-id="${esc(it.equipment_id || '')}">
          <div class="nxrm-card-row1">
            <span class="nxrm-card-priority">${pri.label}</span>
            <span class="nxrm-card-status ${status.tone}">
              <span>${status.glyph}</span> ${esc(status.label)}
            </span>
            <span class="nxrm-card-age">${fmt.age(it.age_hours)}</span>
          </div>
          <div class="nxrm-card-title">${esc(it.title || '(no title)')}</div>
          <div class="nxrm-card-row2">
            <span class="nxrm-card-eq">${esc(it.equipment_name || '—')}</span>
            <span class="nxrm-sep">·</span>
            <span class="nxrm-card-restaurant">${esc(it.restaurant || '—')}</span>
            ${it.contractor_company ? `
              <span class="nxrm-sep">·</span>
              <span class="nxrm-card-vendor">🔧 ${esc(it.contractor_company)}</span>
            ` : ''}
          </div>
          ${costShown != null ? `<div class="nxrm-card-cost">${fmt.money(costShown)}</div>` : ''}
          ${badges.length ? `<div class="nxrm-card-badges">${badges.join('')}</div>` : ''}
          ${(it.comment_count || 0) > 0 ? `<div class="nxrm-card-meta">💬 ${it.comment_count} comment${it.comment_count > 1 ? 's' : ''}</div>` : ''}
        </button>`;
    }).join('');
  }

  function wireInbox(view) {
    view.querySelectorAll('[data-filter-restaurant]').forEach(el => {
      el.addEventListener('click', () => {
        state.filter.restaurant = el.getAttribute('data-filter-restaurant');
        applyFilters(); render();
      });
    });
    view.querySelectorAll('[data-filter-status]').forEach(el => {
      el.addEventListener('click', () => {
        state.filter.status = el.getAttribute('data-filter-status');
        applyFilters(); render();
      });
    });
    view.querySelectorAll('[data-quick]').forEach(el => {
      el.addEventListener('click', () => {
        const q = el.getAttribute('data-quick');
        if (q === 'open')     { state.filter.status = 'open';  state.filter.priority = 'all'; }
        if (q === 'quotes' || q === 'invoices') {
          state.filter.status = 'all'; state.filter.priority = 'all';
        }
        applyFilters();
        if (q === 'quotes')   state.filtered = state.filtered.filter(i => i.awaiting_quote_approval);
        if (q === 'invoices') state.filtered = state.filtered.filter(i => i.awaiting_invoice_payment);
        render();
      });
    });
    const search = view.querySelector('#inboxSearch');
    if (search) {
      let t;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.filter.search = search.value || '';
          applyFilters(); render();
          const fresh = document.querySelector('#inboxSearch');
          if (fresh) { fresh.focus(); fresh.setSelectionRange(fresh.value.length, fresh.value.length); }
        }, 220);
      });
    }
    const sortSel = view.querySelector('#inboxSort');
    if (sortSel) sortSel.addEventListener('change', () => {
      state.filter.sort = sortSel.value;
      applyFilters(); render();
    });
    view.querySelectorAll('.nxrm-card').forEach(card => {
      card.addEventListener('click', () => {
        const eqId = card.getAttribute('data-equipment-id');
        const isId = card.getAttribute('data-issue-id');
        if (!eqId) return;
        NXRM.view.switchTo('equipment');
        setTimeout(() => {
          if (typeof window.eqOpenDetail === 'function') window.eqOpenDetail(eqId, { focusIssue: isId });
          else if (typeof window.openEquipment === 'function') window.openEquipment(eqId);
        }, 180);
      });
    });
    const newBtn = view.querySelector('[data-act="new-issue"]');
    if (newBtn) newBtn.addEventListener('click', () => {
      if (window.NXQuickCreate?.open) window.NXQuickCreate.open();
      else if (typeof window.promptNewIssue === 'function') window.promptNewIssue();
    });
    wireStaleActions(view);
  }

  // ─────────────────────────────────────────────────────────────────────
  // §2 — Stale section (inside inbox, above filters)
  // ─────────────────────────────────────────────────────────────────────

  function renderStaleSection() {
    if (!state.stale.length) return '';
    return `
      <div class="nxrm-stale">
        <div class="nxrm-stale-title">
          ⏰ STALE — ${state.stale.length} ${state.stale.length === 1 ? 'issue' : 'issues'} with no recent movement
        </div>
        <div class="nxrm-stale-list">
          ${state.stale.slice(0, 5).map(it => `
            <div class="nxrm-stale-card">
              <div class="nxrm-stale-row1">
                <span class="nxrm-stale-cardtitle">${esc(it.title || '(no title)')}</span>
                <span class="nxrm-stale-age">${fmt.age(it.hours_since_movement)}</span>
              </div>
              <div class="nxrm-stale-meta">
                <span>${esc(it.equipment_name || '—')}</span>
                ${it.restaurant ? ' · <span>' + esc(it.restaurant) + '</span>' : ''}
              </div>
              <div class="nxrm-stale-reason">${esc(it._reason)}</div>
              <div class="nxrm-stale-actions">
                <button class="nxrm-stale-btn" data-stale="check-in" data-issue-id="${esc(it.id)}">
                  💬 Check in with vendor
                </button>
                <button class="nxrm-stale-btn" data-stale="escalate" data-issue-id="${esc(it.id)}">
                  ⬆ Escalate
                </button>
                <button class="nxrm-stale-btn is-danger" data-stale="drop" data-issue-id="${esc(it.id)}">
                  ✗ Drop
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function wireStaleActions(view) {
    view.querySelectorAll('[data-stale]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-stale');
        const id = btn.getAttribute('data-issue-id');
        const issue = state.stale.find(s => s.id === id);
        if (!issue) return;
        if (action === 'check-in') return staleCheckIn(issue);
        if (action === 'escalate') return staleEscalate(issue);
        if (action === 'drop')     return staleDrop(issue);
      });
    });
  }

  async function staleCheckIn(issue) {
    if (window.NXDispatch?.open) {
      window.NXDispatch.open(issue.id);
      return;
    }
    if (!issue.contractor_company) {
      alert('No vendor on file for this issue.');
      return;
    }
    alert('Open the issue to dispatch the vendor.');
  }

  async function staleEscalate(issue) {
    if (!NX?.sb) return;
    const cur = issue.priority || 'normal';
    const next = cur === 'low' ? 'normal' : cur === 'normal' ? 'high' : 'critical';
    if (cur === 'critical') { alert('Already critical.'); return; }
    if (!confirm(`Escalate from ${cur} → ${next}?`)) return;
    await NX.sb.from('equipment_issues').update({ priority: next }).eq('id', issue.id);
    await NX.sb.from('equipment_issue_comments').insert({
      issue_id: issue.id,
      user_id: NX.user?.id || NX.currentUser?.id || null,
      user_name: NX.user?.name || NX.currentUser?.name || 'You',
      body: `Priority escalated from ${cur} → ${next}.`,
      is_system_event: true,
    });
    await loadIssues();
  }

  async function staleDrop(issue) {
    if (!NX?.sb) return;
    if (!confirm(`Close "${issue.title}" as dropped / no longer needed?`)) return;
    await NX.sb.from('equipment_issues').update({
      status: 'cancelled',
      repaired_at: new Date().toISOString(),
    }).eq('id', issue.id);
    await NX.sb.from('equipment_issue_comments').insert({
      issue_id: issue.id,
      user_id: NX.user?.id || NX.currentUser?.id || null,
      user_name: NX.user?.name || NX.currentUser?.name || 'You',
      body: `Closed as dropped — no movement for ${fmt.age(issue.hours_since_movement)}.`,
      is_system_event: true,
    });
    await loadIssues();
  }

  // ─────────────────────────────────────────────────────────────────────
  // §3 — Home critical issues card
  // ─────────────────────────────────────────────────────────────────────

  function renderHomeCard() {
    const homeView = document.getElementById('homeView');
    if (!homeView) return;
    let card = homeView.querySelector('.nxrm-home-critical');
    if (!state.homeTop.length) {
      if (card) card.remove();
      return;
    }
    if (!card) {
      card = document.createElement('div');
      card.className = 'nxrm-home-critical';
      if (homeView.firstChild) homeView.insertBefore(card, homeView.firstChild);
      else homeView.appendChild(card);
    }
    card.innerHTML = `
      <div class="nxrm-home-critical-title">
        <span>🔴</span>
        <span>NEEDS ATTENTION — ${state.homeTop.length} open work order${state.homeTop.length === 1 ? '' : 's'}</span>
      </div>
      <div class="nxrm-home-critical-list">
        ${state.homeTop.map(it => {
          const glyph = it.awaiting_quote_approval ? '💰'
                      : it.awaiting_invoice_payment ? '🧾'
                      : it.priority === 'critical' ? '🚨'
                      : it.priority === 'high' ? '⚠️' : '🔧';
          const metaPart = it.awaiting_quote_approval ? 'Quote awaiting approval'
                         : it.awaiting_invoice_payment ? 'Invoice unpaid'
                         : (it.equipment_name || '—') + (it.restaurant ? ' · ' + it.restaurant : '');
          return `
            <button class="nxrm-home-critical-item"
                    data-equipment-id="${esc(it.equipment_id || '')}"
                    data-issue-id="${esc(it.id)}">
              <span class="nxrm-home-critical-glyph">${glyph}</span>
              <div class="nxrm-home-critical-body">
                <div class="nxrm-home-critical-itemtitle">${esc(it.title || '(no title)')}</div>
                <div class="nxrm-home-critical-itemmeta">${esc(metaPart)}</div>
              </div>
              <span class="nxrm-home-critical-itemage">${fmt.age(it.age_hours)}</span>
            </button>`;
        }).join('')}
      </div>
      <a class="nxrm-home-critical-link" href="#" data-act="open-inbox">View all work orders →</a>`;

    card.querySelectorAll('.nxrm-home-critical-item').forEach(el => {
      el.addEventListener('click', () => {
        const eqId = el.getAttribute('data-equipment-id');
        const isId = el.getAttribute('data-issue-id');
        if (!eqId) return;
        NXRM.view.switchTo('equipment');
        setTimeout(() => {
          if (typeof window.eqOpenDetail === 'function') window.eqOpenDetail(eqId, { focusIssue: isId });
        }, 180);
      });
    });
    const linkBtn = card.querySelector('[data-act="open-inbox"]');
    if (linkBtn) linkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      NXRM.view.switchTo('issues');
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // RENDER + REALTIME + LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────

  function render() {
    renderInbox();
    renderHomeCard();
  }

  const debouncedReload = NXRM.realtime.debounce(loadIssues, 600);

  function subscribe() {
    NXRM.realtime.subscribe('rm-inbox', [
      { filter: { event: '*', schema: 'public', table: 'equipment_issues' },
        handler: debouncedReload },
      { filter: { event: '*', schema: 'public', table: 'equipment_issue_comments' },
        handler: debouncedReload },
    ]);
  }

  const mod = {
    async init() {
      NXRM.view.ensure('issuesView', 'issues');
      await loadIssues();
      subscribe();
      state.loaded = true;
    },
    async show() {
      if (!state.loaded) await this.init();
      else await loadIssues();
    },
    async refresh() { return loadIssues(); },
  };

  if (window.NX) {
    NX.modules = NX.modules || {};
    NX.modules.issues = mod;
  }

  NXRM.view.onSwitch(() => {
    const active = document.querySelector('.view.active')?.getAttribute('data-view');
    if (active === 'home') renderHomeCard();
  });

  // Re-render the home card on first home view too (since it might already be visible)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(loadIssues, 600));
  } else {
    setTimeout(loadIssues, 600);
  }

  // ─────────────────────────────────────────────────────────────────────
  // BRAIN — stale issues tool registered from here
  // ─────────────────────────────────────────────────────────────────────

  NXRM.brain.register({
    name: 'get_stale_issues',
    description: 'Open work orders with no movement for 3+ days. Use to surface forgotten WOs.',
    params: {},
    run: async () => {
      await loadIssues();
      return {
        count: state.stale.length,
        stale: state.stale.map(s => ({
          id: s.id, title: s.title, equipment: s.equipment_name, restaurant: s.restaurant,
          status: s.status, priority: s.priority,
          hours_idle: Math.round(s.hours_since_movement), reason: s._reason,
        })),
      };
    },
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────────────────

  window.NXIssues = {
    refresh: loadIssues,
    getOpenCount: () => state.issues.filter(i => i.is_open).length,
    getAwaitingQuotes: () => state.issues.filter(i => i.awaiting_quote_approval),
    getUnpaidInvoices: () => state.issues.filter(i => i.awaiting_invoice_payment),
    getStale: () => state.stale.slice(),
    getAll: () => state.issues.slice(),
  };
})();
