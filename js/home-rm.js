/* ═══════════════════════════════════════════════════════════════════════
   NEXUS · R&M · home extension
   ─────────────────────────────────────────────────────────────────────
   Mounts five R&M widgets onto the existing Home view non-invasively:

     §1   Trajan's read       — persona commentary, 1 line
     §2   R&M tile row        — 4 metrics below the existing glance
     §3   Decisions card      — quotes + invoices + stale + compliance
                                + annual budget pace bar
     §4   Work Orders feed    — top-4 open issues by urgency
     §5   Wins celebration    — closed-today + closed-yesterday

   Reads from the same v_* views as the rest of R&M. Hooks into home
   re-renders via MutationObserver so widgets persist across the
   stale-while-revalidate refreshes home.js performs.

   Depends on core.js. Loads after brief.js.
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';
  const { fmt, esc, score } = NXRM;

  // ─────────────────────────────────────────────────────────────────────
  // COMPLIANCE LABELS
  // ─────────────────────────────────────────────────────────────────────

  const COMPLIANCE_LABELS = {
    health_inspection:  'Health',
    gas_tag:            'Gas tag',
    fire_inspection:    'Fire',
    hood_certification: 'Hood cert',
    electrical_cert:    'Electrical',
    grease_trap_pump:   'Grease trap',
    food_handler:       'Food handler',
    backflow:           'Backflow',
    pest_control:       'Pest control',
  };

  // ─────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────

  const state = {
    issues:           [],
    schedules:        [],
    compliance:       [],
    budgets:          [],
    spendMTD:         0,
    closedToday:      [],
    closedYesterday:  [],
    topVendor:        null,
    lastLoad:         0,
  };

  // ─────────────────────────────────────────────────────────────────────
  // DATA — load everything in parallel
  // ─────────────────────────────────────────────────────────────────────

  async function loadAll() {
    if (!NX?.sb) return;
    const now = new Date();
    const todayStart     = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const yesterdayStart = new Date(Date.now() - 86400000).toISOString();
    const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const year           = now.getFullYear();

    try {
      const [issuesRes, pmsRes, compRes, budgetsRes, vendorRes, paidRes] = await Promise.all([
        NX.sb.from('v_issue_summary').select('*').limit(500),
        NX.sb.from('v_pm_due_soon').select('*').limit(50),
        NX.sb.from('v_compliance_due').select('*'),
        NX.sb.from('v_budget_status').select('*').eq('fiscal_year', year),
        NX.sb.from('v_vendor_performance').select('*').gte('completed_jobs', 2),
        NX.sb.from('equipment_issues').select('invoice_amount, invoice_paid_at')
          .gte('invoice_paid_at', monthStart),
      ]);
      state.issues     = issuesRes.data     || [];
      state.schedules  = pmsRes.data        || [];
      state.compliance = compRes.data       || [];
      state.budgets    = budgetsRes.data    || [];

      state.spendMTD = (paidRes.data || []).reduce((s, r) =>
        s + (r.invoice_paid_at ? (Number(r.invoice_amount) || 0) : 0), 0);

      state.closedToday     = state.issues.filter(i => i.repaired_at && i.repaired_at >= todayStart);
      state.closedYesterday = state.issues.filter(i =>
        i.repaired_at && i.repaired_at >= yesterdayStart && i.repaired_at < todayStart);

      // Top vendor — highest grade with most completed jobs
      const graded = (vendorRes.data || []).map(v => ({ ...v, _g: score.vendorGrade(v) }));
      state.topVendor = graded
        .filter(v => ['A', 'B'].includes(v._g.letter))
        .sort((a, b) => (b.completed_jobs || 0) - (a.completed_jobs || 0))[0] || null;

      state.lastLoad = Date.now();
    } catch (e) {
      console.warn('[home-rm] load failed', e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // §1 — TRAJAN'S READ (persona commentary)
  // ─────────────────────────────────────────────────────────────────────

  function quotesAwaiting() { return state.issues.filter(i => i.awaiting_quote_approval); }
  function invoicesUnpaid() { return state.issues.filter(i => i.awaiting_invoice_payment); }
  function staleIssues() {
    return state.issues.filter(i => {
      if (!i.is_open) return false;
      const mov = i.in_progress_at || i.eta_set_at || i.contractor_called_at || i.reported_at;
      const days = (Date.now() - new Date(mov).getTime()) / 86400000;
      return days > 5;
    });
  }

  function numberWord(n) {
    return ['zero','one','two','three','four','five','six','seven','eight','nine','ten'][n] || String(n);
  }

  function buildTrajansRead() {
    const critical = state.issues.filter(i => i.is_open && i.priority === 'critical').length;
    const high     = state.issues.filter(i => i.is_open && i.priority === 'high').length;
    const decisions = quotesAwaiting().length + invoicesUnpaid().length;
    const overduePM = state.schedules.filter(s => s.urgency === 'overdue').length;
    const expired   = state.compliance.filter(c => c.status === 'expired').length;
    const expiring  = state.compliance.filter(c => c.status === 'expiring_soon').length;
    const stale     = staleIssues().length;
    const ydayWins  = state.closedYesterday.length;
    const todayWins = state.closedToday.length;

    // Crisis voice — multiple urgent fronts
    if (critical >= 2)        return `Wars on ${numberWord(critical)} fronts. Triage and act.`;
    if (critical === 1)       return `One front is hot. Stabilize before the day opens.`;
    if (expired > 0)          return `Compliance has lapsed. Renew before it costs you.`;
    if (stale >= 3)           return `Time stands still on ${stale} idle orders. Strike now.`;

    // Decision voice — money or movement waiting
    if (decisions >= 3)       return `${decisions} decisions await your seal. Move them.`;
    if (decisions === 2)      return `Two decisions wait on you.`;
    if (decisions === 1)      return `One decision waits on you.`;

    // Maintenance voice — prevention slipping
    if (overduePM >= 2)       return `Prevention unchecked becomes repair. Tend the machines.`;
    if (overduePM === 1)      return `One PM has slipped. Catch it before it cascades.`;
    if (high >= 3)            return `${high} high-priority orders open. Press them forward.`;
    if (stale >= 1)           return `${stale === 1 ? 'One order' : stale + ' orders'} idle for days. Check or escalate.`;
    if (expiring > 0)         return `Renewals approach. Schedule before they're late.`;

    // Calm voice — momentum and breathing room
    if (todayWins >= 2)       return `${todayWins} orders closed today. Momentum holds.`;
    if (todayWins === 1)      return `One order closed already. Keep the cadence.`;
    if (ydayWins >= 3)        return `Yesterday's victories hold. The fleet is steady.`;
    if (ydayWins > 0)         return `Quiet morning. ${ydayWins} ${ydayWins === 1 ? 'win' : 'wins'} on the books from yesterday.`;

    return `Forum is quiet. Reinforce supply lines today.`;
  }

  function renderTrajansRead() {
    const el = document.querySelector('.home-rm-read');
    if (!el) return;
    const text = buildTrajansRead();
    el.innerHTML = `
      <span class="home-rm-read-mark" aria-hidden="true">⚔</span>
      <em class="home-rm-read-text">${esc(text)}</em>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────
  // §2 — R&M TILE ROW
  // ─────────────────────────────────────────────────────────────────────

  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function renderTiles() {
    const el = document.querySelector('.home-rm-tiles');
    if (!el) return;
    const openWO = state.issues.filter(i => i.is_open).length;
    const pmDue  = state.schedules.filter(s => ['overdue','due_soon'].includes(s.urgency)).length;
    const tv     = state.topVendor;
    const tvName = tv ? (tv.display_name || tv.name || 'vendor') : '';

    // Attention-first render: anything actionable becomes a full-width
    // hero card in plain language ("3 work orders need attention"), so the
    // user reads the screen top-down and stops when the urgency stops.
    // Quiet metrics stay as compact tiles. Same data-go wiring as before.
    const hero = [];
    if (openWO > 0) hero.push({ go: 'issues', num: openWO,
      text: openWO === 1 ? '1 work order needs attention' : `${openWO} work orders need attention` });
    if (pmDue > 0) hero.push({ go: 'pm', num: pmDue,
      text: pmDue === 1 ? '1 unit due for maintenance' : `${pmDue} units due for maintenance` });
    const heroHtml = hero.map(h => `
      <button class="home-rm-tile is-warn is-hero" data-go="${h.go}" onclick="event.stopPropagation();NX.openWorkOrders&&NX.openWorkOrders()"
        style="grid-column:1/-1;display:flex;align-items:center;gap:16px;text-align:left;min-height:84px">
        <div class="home-rm-tile-num" style="font-size:46px;line-height:1">${h.num}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:650;line-height:1.3;color:var(--nx-text-strong)">${h.text}</div>
          <div class="home-rm-tile-lbl" style="margin-top:3px">Tap to open</div>
        </div>
        <div style="font-size:20px;opacity:.5">→</div>
      </button>`).join('');
    el.innerHTML = `
      ${heroHtml}
      ${hero.length === 0 ? `
      <button class="home-rm-tile is-hero" data-go="issues" onclick="event.stopPropagation();NX.openWorkOrders&&NX.openWorkOrders()"
        style="grid-column:1/-1;min-height:72px;display:flex;align-items:center;gap:14px;text-align:left">
        <div style="font-size:26px;color:var(--nx-green)">✓</div>
        <div style="font-size:17px;font-weight:650;color:var(--nx-text-strong)">All clear — nothing needs you right now</div>
      </button>` : ''}
      <button class="home-rm-tile" data-go="spend">
        <div class="home-rm-tile-num">${fmt.money(state.spendMTD)}</div>
        <div class="home-rm-tile-lbl">Spent this month</div>
      </button>
      <button class="home-rm-tile" data-go="vendors">
        <div class="home-rm-tile-num home-rm-tile-grade ${tv ? tv._g.tone : 'tone-mute'}">${tv ? tv._g.letter : '—'}</div>
        <div class="home-rm-tile-lbl">${tv ? esc(truncate(tvName, 14)) : 'Top vendor'}</div>
      </button>
    `;
    el.querySelectorAll('[data-go]').forEach(b => {
      b.addEventListener('click', () => {
        const go = b.getAttribute('data-go');
        // 'issues' = work orders. The internal NXRM issues view renders
        // blank on some devices (the root cause of dead taps from Home),
        // so route to the standalone module instead.
        if (go === 'issues') {
          // Self-contained module loader (no dependency on domain.js
          // version — a stale copy made these taps die silently).
          const open = () => NX.modules?.workOrders?.open
            ? NX.modules.workOrders.open()
            : NXRM.view.switchTo('issues');
          if (NX.modules?.workOrders) { open(); return; }
          const s = document.createElement('script');
          s.src = 'js/work-orders.js?v=4';
          s.onload = open; s.onerror = open;
          document.body.appendChild(s);
          return;
        }
        NXRM.view.switchTo(go);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // §3 — DECISIONS CARD (with embedded budget pace bar)
  // ─────────────────────────────────────────────────────────────────────

  function uniqueRestaurants(items) {
    return [...new Set(items.map(i => i.restaurant).filter(Boolean))];
  }
  function oldestDate(items, field) {
    return items.reduce((acc, i) => {
      const d = i[field];
      if (!d) return acc;
      return !acc || d < acc ? d : acc;
    }, null);
  }

  function renderPaceBar() {
    // Pick the budget closest to over-pace (most urgent), or the only one
    const all = state.budgets || [];
    if (!all.length) return '';
    const focus = all.slice().sort((a, b) =>
      (Number(b.variance_from_pace) || 0) - (Number(a.variance_from_pace) || 0))[0];
    if (!focus || !focus.annual_amount) return '';

    const annual   = Number(focus.annual_amount) || 0;
    const spent    = Number(focus.spent_to_date) || 0;
    const expected = Number(focus.expected_spent_by_now) || 0;
    const variance = Number(focus.variance_from_pace) || 0;

    const pctUsed = annual > 0 ? Math.min(100, (spent / annual) * 100) : 0;
    const pctPace = annual > 0 ? Math.min(100, (expected / annual) * 100) : 0;

    let tone = 'tone-info';
    let varPhrase;
    if (Math.abs(variance) < annual * 0.02) {
      varPhrase = 'on pace';
      tone = 'tone-ok';
    } else if (variance > 0) {
      varPhrase = fmt.money(variance) + ' over pace';
      tone = variance > annual * 0.10 ? 'tone-critical' : 'tone-warn';
    } else {
      varPhrase = fmt.money(Math.abs(variance)) + ' under pace';
      tone = 'tone-ok';
    }

    return `
      <div class="home-rm-pace ${tone}">
        <div class="home-rm-pace-lbl">
          <span>${esc(focus.restaurant)}</span>
          <span class="home-rm-pace-pct">${Math.round(pctUsed * 10) / 10}%</span>
        </div>
        <div class="home-rm-pace-bar">
          <div class="home-rm-pace-fill" style="width:${pctUsed}%"></div>
          <div class="home-rm-pace-marker" style="left:${pctPace}%"></div>
        </div>
        <div class="home-rm-pace-legend">
          <span>${fmt.money(spent)} of ${fmt.money(annual)} YTD</span>
          <span class="home-rm-pace-var">${esc(varPhrase)}</span>
        </div>
      </div>
    `;
  }

  function renderDecisions() {
    const el = document.querySelector('.home-rm-decisions');
    if (!el) return;

    const quotes   = quotesAwaiting();
    const invoices = invoicesUnpaid();
    const stale    = staleIssues();
    const expired  = state.compliance.filter(c => c.status === 'expired');
    const expiring = state.compliance.filter(c => c.status === 'expiring_soon');
    const total    = quotes.length + invoices.length + stale.length + expired.length + expiring.length;

    if (total === 0 && state.budgets.length === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';

    const quotesTotal   = quotes.reduce((s, i) => s + (Number(i.quote_amount) || 0), 0);
    const invoicesTotal = invoices.reduce((s, i) => s + (Number(i.invoice_amount) || 0), 0);
    const oldestInvoice = oldestDate(invoices, 'invoice_received_at');
    const rows = [];

    if (quotes.length) {
      const restaurants = uniqueRestaurants(quotes);
      const sub = quotes.length === 1
        ? (quotes[0].equipment_name || quotes[0].restaurant || '')
        : restaurants.length > 1
          ? `across ${restaurants.slice(0, 2).join(', ')}${restaurants.length > 2 ? ' + more' : ''}`
          : restaurants[0] || '';
      rows.push(`
        <button class="home-rm-decision-row" data-go="issues">
          <span class="home-rm-decision-glyph">💰</span>
          <div class="home-rm-decision-body">
            <div class="home-rm-decision-title">${quotes.length} quote${quotes.length === 1 ? '' : 's'} awaiting approval</div>
            <div class="home-rm-decision-meta">${fmt.money(quotesTotal)}${sub ? ' · ' + esc(sub) : ''}</div>
          </div>
          <span class="home-rm-decision-arrow">→</span>
        </button>`);
    }
    if (invoices.length) {
      const oldestWords = oldestInvoice ? fmt.sinceWords(oldestInvoice) : '';
      rows.push(`
        <button class="home-rm-decision-row" data-go="issues">
          <span class="home-rm-decision-glyph">🧾</span>
          <div class="home-rm-decision-body">
            <div class="home-rm-decision-title">${invoices.length} unpaid invoice${invoices.length === 1 ? '' : 's'}</div>
            <div class="home-rm-decision-meta">${fmt.money(invoicesTotal)}${oldestWords ? ' · oldest ' + oldestWords : ''}</div>
          </div>
          <span class="home-rm-decision-arrow">→</span>
        </button>`);
    }
    if (stale.length) {
      const single = stale.length === 1 ? stale[0] : null;
      const subText = single
        ? `${single.equipment_name || ''} · idle ${fmt.age(stale.reduce((m, s) => Math.max(m, (Date.now() - new Date(s.in_progress_at || s.eta_set_at || s.contractor_called_at || s.reported_at).getTime()) / 3600000), 0))}`
        : `No movement for 5+ days — check or escalate`;
      rows.push(`
        <button class="home-rm-decision-row" data-go="issues">
          <span class="home-rm-decision-glyph">⏰</span>
          <div class="home-rm-decision-body">
            <div class="home-rm-decision-title">${stale.length} stale work order${stale.length === 1 ? '' : 's'}</div>
            <div class="home-rm-decision-meta">${esc(subText)}</div>
          </div>
          <span class="home-rm-decision-arrow">→</span>
        </button>`);
    }
    if (expired.length) {
      const labels = expired.map(c => COMPLIANCE_LABELS[c.compliance_type] || c.compliance_type).slice(0, 2);
      rows.push(`
        <button class="home-rm-decision-row is-critical" data-go="brief">
          <span class="home-rm-decision-glyph">🔴</span>
          <div class="home-rm-decision-body">
            <div class="home-rm-decision-title">${expired.length} compliance item${expired.length === 1 ? '' : 's'} expired</div>
            <div class="home-rm-decision-meta">${esc(labels.join(', '))}${expired.length > 2 ? ' + ' + (expired.length - 2) + ' more' : ''}</div>
          </div>
          <span class="home-rm-decision-arrow">→</span>
        </button>`);
    }
    if (expiring.length) {
      const first = expiring[0];
      const firstLabel = COMPLIANCE_LABELS[first.compliance_type] || first.compliance_type;
      rows.push(`
        <button class="home-rm-decision-row" data-go="brief">
          <span class="home-rm-decision-glyph">📋</span>
          <div class="home-rm-decision-body">
            <div class="home-rm-decision-title">${expiring.length} compliance renewal${expiring.length === 1 ? '' : 's'} approaching</div>
            <div class="home-rm-decision-meta">Earliest: ${esc(firstLabel)} in ${first.days_until_expiry}d</div>
          </div>
          <span class="home-rm-decision-arrow">→</span>
        </button>`);
    }

    el.innerHTML = `
      ${total > 0 ? `<div class="home-rm-decisions-head">DECISIONS NEEDED · ${total}</div>` : ''}
      ${rows.join('')}
      ${renderPaceBar()}
    `;

    el.querySelectorAll('[data-go]').forEach(b => {
      b.addEventListener('click', () => {
        const go = b.getAttribute('data-go');
        // 'issues' = work orders. The internal NXRM issues view renders
        // blank on some devices (the root cause of dead taps from Home),
        // so route to the standalone module instead.
        if (go === 'issues') {
          // Self-contained module loader (no dependency on domain.js
          // version — a stale copy made these taps die silently).
          const open = () => NX.modules?.workOrders?.open
            ? NX.modules.workOrders.open()
            : NXRM.view.switchTo('issues');
          if (NX.modules?.workOrders) { open(); return; }
          const s = document.createElement('script');
          s.src = 'js/work-orders.js?v=4';
          s.onload = open; s.onerror = open;
          document.body.appendChild(s);
          return;
        }
        NXRM.view.switchTo(go);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // §4 — WORK ORDERS feed (top-4 by urgency)
  // ─────────────────────────────────────────────────────────────────────

  function renderWorkOrders() {
    const el = document.querySelector('.home-rm-wo');
    if (!el) return;

    const open = state.issues
      .filter(i => i.is_open)
      .map(i => ({ ...i, _u: score.urgency(i) }))
      .sort((a, b) => b._u - a._u)
      .slice(0, 4);

    if (open.length === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const totalOpen = state.issues.filter(i => i.is_open).length;

    el.innerHTML = `
      <h2 class="nx-section">
        <span class="nx-section-title">Work Orders</span>
        <span class="home-rm-wo-count">${totalOpen} open</span>
      </h2>
      <div class="home-rm-wo-list">
        ${open.map(it => {
          const status = NXRM.STATUS[it.status] || { glyph: '·', label: it.status };
          const tone = it.priority === 'critical' ? 'tone-critical'
                    : it.priority === 'high'     ? 'tone-high'
                    : 'tone-normal';
          const subBits = [];
          if (it.equipment_name) subBits.push(it.equipment_name);
          if (it.restaurant)     subBits.push(it.restaurant);
          return `
            <button class="home-rm-wo-item ${tone}"
                    data-equipment-id="${esc(it.equipment_id || '')}"
                    data-issue-id="${esc(it.id)}">
              <span class="home-rm-wo-glyph">${status.glyph}</span>
              <div class="home-rm-wo-body">
                <div class="home-rm-wo-title">${esc(it.title || '(no title)')}</div>
                <div class="home-rm-wo-meta">${esc(subBits.join(' · '))}</div>
              </div>
              <span class="home-rm-wo-age">${fmt.age(it.age_hours)}</span>
            </button>`;
        }).join('')}
      </div>
      ${totalOpen > 4 ? `<button class="home-rm-wo-viewall" data-go="issues">View all ${totalOpen} work orders →</button>` : ''}
    `;

    el.querySelectorAll('[data-equipment-id]').forEach(b => {
      b.addEventListener('click', () => {
        const eqId = b.getAttribute('data-equipment-id');
        const isId = b.getAttribute('data-issue-id');
        // A work order IS a board card — open it on the Board. The board's
        // show() reads this intent, finds the card tagged issue:<id>, and
        // opens its detail.
        if (isId) {
          NX.boardOpenIntent = { issueId: isId };
          NXRM.view.switchTo('board');
          return;
        }
        // Fallback (no issue id): open the equipment detail as before.
        if (!eqId) return;
        NXRM.view.switchTo('equipment');
        setTimeout(() => {
          if (typeof window.eqOpenDetail === 'function') window.eqOpenDetail(eqId, { focusIssue: isId });
        }, 180);
      });
    });
    const viewAll = el.querySelector('[data-go]');
    if (viewAll) viewAll.addEventListener('click', () => NXRM.view.switchTo('issues'));
  }

  // ─────────────────────────────────────────────────────────────────────
  // §5 — WINS celebration
  // ─────────────────────────────────────────────────────────────────────

  function renderWins() {
    const el = document.querySelector('.home-rm-wins');
    if (!el) return;
    const all = [];
    state.closedToday.forEach(i => all.push({ ...i, _when: 'Today' }));
    state.closedYesterday.slice(0, 5 - all.length).forEach(i => all.push({ ...i, _when: 'Yesterday' }));

    if (all.length === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';

    const todayCount = state.closedToday.length;
    const ydayCount  = state.closedYesterday.length;
    const totalSpend = all.reduce((s, i) => s + (Number(i.invoice_amount) || 0), 0);

    el.innerHTML = `
      <div class="home-rm-wins-head">
        <span class="home-rm-wins-glyph">✓</span>
        <span>WINS</span>
        ${todayCount > 0 ? `<span class="home-rm-wins-pill">${todayCount} today</span>` : ''}
        ${ydayCount  > 0 ? `<span class="home-rm-wins-pill is-quiet">${ydayCount} yesterday</span>` : ''}
        ${totalSpend > 0 ? `<span class="home-rm-wins-spend">${fmt.money(totalSpend)} settled</span>` : ''}
      </div>
      <div class="home-rm-wins-list">
        ${all.slice(0, 4).map(w => `
          <div class="home-rm-win">
            <span class="home-rm-win-glyph">✓</span>
            <div class="home-rm-win-body">
              <div class="home-rm-win-title">${esc(w.title || '(no title)')}</div>
              <div class="home-rm-win-meta">${esc(w.equipment_name || '')}${w.restaurant ? ' · ' + esc(w.restaurant) : ''}${w.invoice_amount ? ' · ' + fmt.money(w.invoice_amount) + ' paid' : ''}</div>
            </div>
            <span class="home-rm-win-when">${w._when}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────
  // MOUNT POINTS — idempotent injection into existing home DOM
  // ─────────────────────────────────────────────────────────────────────

  function ensureMounts() {
    const home = document.getElementById('homeView');
    if (!home) return false;
    const page = home.querySelector('.home-page');
    if (!page) return false;

    // 1. Trajan's read — after .home-intro
    if (!page.querySelector('.home-rm-read')) {
      const intro = page.querySelector('.home-intro, #homeIntro');
      if (intro) {
        const el = document.createElement('div');
        el.className = 'home-rm-read';
        intro.insertAdjacentElement('afterend', el);
      }
    }

    // 2. R&M tiles — after #homeGlance
    if (!page.querySelector('.home-rm-tiles')) {
      const glance = page.querySelector('#homeGlance, .home-glance');
      if (glance) {
        const el = document.createElement('div');
        el.className = 'home-rm-tiles';
        glance.insertAdjacentElement('afterend', el);
      }
    }

    // 3. Decisions — after tiles
    if (!page.querySelector('.home-rm-decisions')) {
      const tiles = page.querySelector('.home-rm-tiles');
      if (tiles) {
        const el = document.createElement('div');
        el.className = 'home-rm-decisions';
        tiles.insertAdjacentElement('afterend', el);
      }
    }

    // 4. Wins — after decisions (before "Today" section header)
    if (!page.querySelector('.home-rm-wins')) {
      const dec = page.querySelector('.home-rm-decisions');
      if (dec) {
        const el = document.createElement('div');
        el.className = 'home-rm-wins';
        dec.insertAdjacentElement('afterend', el);
      }
    }

    // 5. Work Orders — after the Today feed (#homeFeed), before "On the books"
    if (!page.querySelector('.home-rm-wo')) {
      const feed = page.querySelector('#homeFeed');
      if (feed) {
        const el = document.createElement('div');
        el.className = 'home-rm-wo';
        feed.insertAdjacentElement('afterend', el);
      }
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────
  // RENDER + LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────

  let renderScheduled = false;
  function scheduleRender(delay) {
    if (renderScheduled) return;
    renderScheduled = true;
    setTimeout(() => {
      renderScheduled = false;
      doRender();
    }, delay || 80);
  }

  function doRender() {
    if (!ensureMounts()) return;
    renderTrajansRead();
    renderTiles();
    renderDecisions();
    renderWorkOrders();
    renderWins();
  }

  async function refreshAll() {
    await loadAll();
    doRender();
  }

  const debouncedRefresh = NXRM.realtime.debounce(refreshAll, 1200);

  function subscribe() {
    NXRM.realtime.subscribe('rm-home', [
      { filter: { event: '*', schema: 'public', table: 'equipment_issues' },     handler: debouncedRefresh },
      { filter: { event: '*', schema: 'public', table: 'pm_schedules' },         handler: debouncedRefresh },
      { filter: { event: '*', schema: 'public', table: 'equipment_compliance' }, handler: debouncedRefresh },
      { filter: { event: '*', schema: 'public', table: 'budgets' },              handler: debouncedRefresh },
    ]);
  }

  // Watch the homeView for re-renders by home.js (stale-while-revalidate
  // wipes our mounts; re-inject promptly).
  function watchHome() {
    const home = document.getElementById('homeView');
    if (!home) { setTimeout(watchHome, 400); return; }
    const observer = new MutationObserver(() => scheduleRender(80));
    observer.observe(home, { childList: true, subtree: false });
  }

  // Watch for view switches too — when home becomes active, render
  NXRM.view.onSwitch(() => {
    const active = document.querySelector('.view.active')?.getAttribute('data-view');
    if (active === 'home') scheduleRender(150);
  });

  async function init() {
    await loadAll();
    subscribe();
    watchHome();
    scheduleRender(300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 700));
  } else {
    setTimeout(init, 700);
  }

  // ─────────────────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────────────────

  window.NXHomeRM = {
    refresh: refreshAll,
    rerender: doRender,
    getTrajansRead: buildTrajansRead,
  };
})();
