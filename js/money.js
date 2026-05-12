/* ═══════════════════════════════════════════════════════════════════════
   NEXUS · R&M · money
   ─────────────────────────────────────────────────────────────────────
   Two surfaces, one module:

     §1   /spend view      — KPI tiles, repair-vs-replace flags, breakdowns
     §2   Budget tracker   — annual budget per restaurant with pace variance

   Reads v_spend_rollup and v_budget_status. Budget cards auto-mount
   onto Daily Brief AND the spend view itself. Depends on core.js.
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';
  const { fmt, esc } = NXRM;

  const state = {
    rollup:    [],
    budgets:   [],
    filter:    { period: 'ytd', group: 'restaurant' },
    loaded:    false,
  };

  // ─────────────────────────────────────────────────────────────────────
  // DATA
  // ─────────────────────────────────────────────────────────────────────

  async function loadRollup() {
    if (!NX?.sb) return;
    try {
      const { data } = await NX.sb.from('v_spend_rollup').select('*');
      state.rollup = data || [];
    } catch (e) {
      console.warn('[money] rollup load failed', e);
    }
  }

  async function loadBudgets() {
    if (!NX?.sb) return;
    const year = new Date().getFullYear();
    try {
      const { data, error } = await NX.sb.from('v_budget_status')
        .select('*').eq('fiscal_year', year);
      if (error) throw error;
      state.budgets = data || [];
    } catch (_) {
      try {
        const yearStart = new Date(year, 0, 1).toISOString();
        const [{ data: budgets }, { data: equipment }, { data: paid }] = await Promise.all([
          NX.sb.from('budgets').select('*').eq('fiscal_year', year),
          NX.sb.from('equipment').select('id, restaurant:location'),
          NX.sb.from('equipment_issues')
            .select('equipment_id, invoice_amount, invoice_paid_at')
            .gte('invoice_paid_at', yearStart),
        ]);
        const eqByRest = {};
        (equipment || []).forEach(e => { if (e.restaurant) eqByRest[e.id] = e.restaurant; });
        const spendByRest = {};
        (paid || []).forEach(i => {
          const r = eqByRest[i.equipment_id];
          if (!r) return;
          spendByRest[r] = (spendByRest[r] || 0) + (Number(i.invoice_amount) || 0);
        });
        const doy = Math.floor((Date.now() - new Date(year, 0, 1).getTime()) / 86400000) + 1;
        state.budgets = (budgets || []).map(b => {
          const spent = spendByRest[b.restaurant] || 0;
          const expected = Math.round(b.annual_amount * (doy / 365));
          return {
            restaurant: b.restaurant,
            fiscal_year: b.fiscal_year,
            annual_amount: b.annual_amount,
            spent_to_date: spent,
            remaining: Math.max(0, b.annual_amount - spent),
            pct_used: b.annual_amount > 0 ? Math.round((spent / b.annual_amount) * 1000) / 10 : 0,
            expected_spent_by_now: expected,
            variance_from_pace: spent - expected,
          };
        });
      } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // §1 — /spend view
  // ─────────────────────────────────────────────────────────────────────

  function renderSpendView() {
    const view = NXRM.view.ensure('spendView', 'spend');
    const f = state.filter;
    const field = f.period === 'mtd' ? 'spend_mtd' : f.period === 'all' ? 'total_spend' : 'spend_ytd';

    const total = state.rollup.reduce((s, r) => s + (Number(r[field]) || 0), 0);
    const openCost = state.rollup.reduce((s, r) =>
      s + (Number(r.open_issues_count) > 0 ? Number(r.spend_ytd) : 0), 0);
    const totalDowntime = state.rollup.reduce((s, r) => s + (Number(r.total_downtime_hours) || 0), 0);

    const flagged = state.rollup.filter(r => r.repair_vs_replace_flag);

    const gKey = f.group === 'category' ? 'equipment_category'
               : f.group === 'equipment' ? 'equipment_name' : 'restaurant';
    const grouped = {};
    state.rollup.forEach(r => {
      const k = r[gKey] || '—';
      grouped[k] = (grouped[k] || 0) + (Number(r[field]) || 0);
    });
    const groupRows = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    const topEq = state.rollup
      .filter(r => Number(r[field]) > 0)
      .sort((a, b) => Number(b[field]) - Number(a[field]))
      .slice(0, 8);

    view.innerHTML = `
      <div class="nxrm-page nxrm-spend-page">
        <div class="nxrm-masthead">
          <div>
            <div class="nxrm-eyebrow">REPAIR &amp; MAINTENANCE</div>
            <h1 class="nxrm-h1">Spend</h1>
          </div>
          <div class="nxrm-period-toggle">
            ${[['mtd','MTD'],['ytd','YTD'],['all','All time']].map(([k, l]) => `
              <button class="nxrm-period-btn ${f.period === k ? 'is-active' : ''}"
                      data-period="${k}">${l}</button>
            `).join('')}
          </div>
        </div>

        <div class="nxrm-tiles tiles-3">
          <div class="nxrm-tile">
            <div class="nxrm-tile-num">${fmt.money(total)}</div>
            <div class="nxrm-tile-lbl">Total&nbsp;${f.period.toUpperCase()}</div>
          </div>
          <div class="nxrm-tile">
            <div class="nxrm-tile-num">${fmt.money(openCost)}</div>
            <div class="nxrm-tile-lbl">Open&nbsp;Issue&nbsp;Equipment</div>
          </div>
          <div class="nxrm-tile">
            <div class="nxrm-tile-num">${Math.round(totalDowntime)}h</div>
            <div class="nxrm-tile-lbl">Total&nbsp;Downtime</div>
          </div>
        </div>

        <div class="nxrm-section nxrm-spend-budget-section"></div>

        ${flagged.length ? `
          <div class="nxrm-flag-section">
            <div class="nxrm-section-title">🚨 Repair vs Replace · ${flagged.length} flagged</div>
            <div class="nxrm-section-sub">YTD repair spend exceeds 40% of purchase price. Consider replacement.</div>
            <div class="nxrm-list">
              ${flagged.map(r => `
                <button class="nxrm-card tone-critical" data-equipment-id="${esc(r.equipment_id)}">
                  <div class="nxrm-card-title">${esc(r.equipment_name)}</div>
                  <div class="nxrm-card-row2">
                    <span>${esc(r.restaurant || '—')}</span>
                    <span class="nxrm-sep">·</span>
                    <span>${esc(r.equipment_category || '—')}</span>
                  </div>
                  <div class="nxrm-flag-bar">
                    <div class="nxrm-flag-fill" style="width:${
                      Math.min(100, Math.round((Number(r.spend_ytd) / Number(r.purchase_price)) * 100))
                    }%"></div>
                  </div>
                  <div class="nxrm-flag-meta">
                    YTD: ${fmt.money(r.spend_ytd)} of ${fmt.money(r.purchase_price)} purchase price
                    (${r.purchase_price > 0 ? Math.round((Number(r.spend_ytd) / Number(r.purchase_price)) * 100) : 0}%)
                  </div>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="nxrm-section">
          <div class="nxrm-section-title">By ${f.group}</div>
          <div class="nxrm-group-toggle">
            ${[['restaurant','Restaurant'],['category','Category'],['equipment','Equipment']].map(([k, l]) => `
              <button class="nxrm-group-btn ${f.group === k ? 'is-active' : ''}" data-group="${k}">${l}</button>
            `).join('')}
          </div>
          <div class="nxrm-group-list">
            ${groupRows.length ? groupRows.map(([name, val]) => `
              <div class="nxrm-group-row">
                <div class="nxrm-group-name">${esc(name)}</div>
                <div class="nxrm-group-bar">
                  <div class="nxrm-group-fill" style="width:${total > 0 ? Math.round((val / total) * 100) : 0}%"></div>
                </div>
                <div class="nxrm-group-val">${fmt.money(val)}</div>
              </div>
            `).join('') : '<div class="nxrm-empty"><div class="nxrm-empty-body">No spend in this period.</div></div>'}
          </div>
        </div>

        ${topEq.length ? `
          <div class="nxrm-section">
            <div class="nxrm-section-title">Top spenders · ${f.period.toUpperCase()}</div>
            <div class="nxrm-list">
              ${topEq.map((r, idx) => `
                <button class="nxrm-card" data-equipment-id="${esc(r.equipment_id)}">
                  <div class="nxrm-card-row1">
                    <span class="nxrm-rank">#${idx + 1}</span>
                    <span class="nxrm-card-cost">${fmt.money(r[field])}</span>
                  </div>
                  <div class="nxrm-card-title">${esc(r.equipment_name)}</div>
                  <div class="nxrm-card-row2">
                    <span>${esc(r.restaurant || '—')}</span>
                    <span class="nxrm-sep">·</span>
                    <span>${esc(r.equipment_category || '—')}</span>
                    ${r.open_issues_count > 0 ? `
                      <span class="nxrm-sep">·</span>
                      <span class="nxrm-card-open">${r.open_issues_count} open</span>
                    ` : ''}
                  </div>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
    wireSpendView(view);
    mountBudgetCardsToSpend();
  }

  function wireSpendView(view) {
    view.querySelectorAll('[data-period]').forEach(b => {
      b.addEventListener('click', () => {
        state.filter.period = b.getAttribute('data-period');
        renderSpendView();
      });
    });
    view.querySelectorAll('[data-group]').forEach(b => {
      b.addEventListener('click', () => {
        state.filter.group = b.getAttribute('data-group');
        renderSpendView();
      });
    });
    view.querySelectorAll('[data-equipment-id]').forEach(c => {
      c.addEventListener('click', () => {
        const id = c.getAttribute('data-equipment-id');
        if (!id) return;
        NXRM.view.switchTo('equipment');
        setTimeout(() => {
          if (typeof window.eqOpenDetail === 'function') window.eqOpenDetail(id);
        }, 180);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // §2 — BUDGET TRACKER
  // ─────────────────────────────────────────────────────────────────────

  function paceClass(variance, budget) {
    if (budget === 0) return 'tone-mute';
    const pct = variance / budget;
    if (pct > 0.10)  return 'tone-critical';
    if (pct > 0.03)  return 'tone-warn';
    if (pct < -0.10) return 'tone-good';
    return 'tone-info';
  }

  function renderBudgetCard(row) {
    const variance = Number(row.variance_from_pace) || 0;
    const pctUsed = Number(row.pct_used) || 0;
    const tone = paceClass(variance, row.annual_amount);
    const varText = variance >= 0
      ? `${fmt.money(variance)} over pace`
      : `${fmt.money(Math.abs(variance))} under pace`;
    const paceLeft = row.annual_amount > 0
      ? Math.min(100, ((row.expected_spent_by_now || 0) / row.annual_amount * 100))
      : 0;

    return `
      <div class="nxrm-budget-card ${tone}" data-budget-restaurant="${esc(row.restaurant)}">
        <div class="nxrm-budget-head">
          <div>
            <div class="nxrm-budget-restaurant">${esc(row.restaurant)}</div>
            <div class="nxrm-budget-year">FY ${row.fiscal_year} budget</div>
          </div>
          <div class="nxrm-budget-pct">${pctUsed}%</div>
        </div>
        <div class="nxrm-budget-bar">
          <div class="nxrm-budget-actual" style="width:${Math.min(100, pctUsed)}%"></div>
          <div class="nxrm-budget-pace" style="left:${paceLeft}%"></div>
        </div>
        <div class="nxrm-budget-foot">
          <span>${fmt.money(row.spent_to_date)} of ${fmt.money(row.annual_amount)}</span>
          <span class="nxrm-budget-var">${varText}</span>
        </div>
      </div>`;
  }

  function mountBudgetCardsToBrief() {
    const brief = document.getElementById('briefView');
    if (!brief || !state.budgets.length) return;
    let section = brief.querySelector('.nxrm-brief-budget-section');
    if (!section) {
      section = document.createElement('div');
      section.className = 'nxrm-section nxrm-brief-budget-section';
      const briefPage = brief.querySelector('.nxrm-brief-page');
      const spendSection = Array.from(brief.querySelectorAll('.nxrm-section'))
        .find(s => s.querySelector('.nxrm-section-title')?.textContent.includes('Spend Summary'));
      if (spendSection) spendSection.insertAdjacentElement('beforebegin', section);
      else if (briefPage) briefPage.appendChild(section);
    }
    section.innerHTML = `
      <div class="nxrm-section-title">📊 Annual Budget</div>
      <div class="nxrm-budget-grid">
        ${state.budgets.map(b => renderBudgetCard(b)).join('')}
      </div>
    `;
    wireBudgetCards(section);
  }

  function mountBudgetCardsToSpend() {
    const spend = document.getElementById('spendView');
    if (!spend) return;
    const section = spend.querySelector('.nxrm-spend-budget-section');
    if (!section) return;
    section.innerHTML = `
      <div class="nxrm-section-title">📊 Annual Budget vs Actual</div>
      <div class="nxrm-budget-grid">
        ${state.budgets.length
          ? state.budgets.map(b => renderBudgetCard(b)).join('')
          : `<button class="nxrm-budget-empty" data-act="new-budget">+ Set up your first annual budget</button>`}
      </div>
      ${state.budgets.length
        ? `<button class="nxrm-brief-cta" data-act="new-budget">+ Add another restaurant budget</button>`
        : ''}
    `;
    wireBudgetCards(section);
  }

  function wireBudgetCards(scope) {
    scope.querySelectorAll('[data-budget-restaurant]').forEach(el => {
      el.addEventListener('click', () => {
        const r = el.getAttribute('data-budget-restaurant');
        const row = state.budgets.find(b => b.restaurant === r);
        if (row) promptEditBudget(row);
      });
    });
    scope.querySelectorAll('[data-act="new-budget"]').forEach(b => {
      b.addEventListener('click', promptNewBudget);
    });
  }

  async function promptNewBudget() {
    if (!NX?.sb) return;
    const { data: equipment } = await NX.sb.from('equipment').select('restaurant:location');
    const restaurants = [...new Set((equipment || []).map(e => e.restaurant).filter(Boolean))];
    if (!restaurants.length) { alert('No restaurants found. Add equipment first.'); return; }

    const list = restaurants.map((r, i) => `${i + 1}. ${r}`).join('\n');
    const pick = prompt('Which restaurant?\n\n' + list);
    if (pick === null) return;
    const idx = parseInt(pick, 10) - 1;
    if (isNaN(idx) || !restaurants[idx]) { alert('Invalid pick.'); return; }
    const restaurant = restaurants[idx];

    const amount = prompt(`Annual R&M budget for ${restaurant} ($):`);
    if (amount === null) return;
    const num = parseFloat(amount.replace(/[$,]/g, ''));
    if (isNaN(num) || num <= 0) { alert('Invalid amount.'); return; }

    const notes = prompt('Notes (optional):') || null;
    const year = new Date().getFullYear();
    const { error } = await NX.sb.from('budgets').upsert({
      restaurant, fiscal_year: year, annual_amount: num, notes,
      updated_at: new Date().toISOString(),
    });
    if (error) { alert('Failed: ' + error.message); return; }
    NXRM.notify.bubble(`Bzzt — budget set: ${restaurant} ${fmt.money(num)} for ${year}`,
      { autoHide: 4000, eyebrow: '✓ BUDGET' });
    await loadBudgets();
    refresh();
  }

  async function promptEditBudget(row) {
    const action = prompt(
      `${row.restaurant} · FY ${row.fiscal_year}\n\n` +
      `Budget: ${fmt.money(row.annual_amount)}\n` +
      `Spent: ${fmt.money(row.spent_to_date)} (${row.pct_used}%)\n\n` +
      `1 = change budget amount\n2 = delete budget\n(cancel = nothing)`);
    if (action === '1') {
      const newAmount = prompt('New annual budget ($):', row.annual_amount);
      if (newAmount === null) return;
      const num = parseFloat(newAmount.replace(/[$,]/g, ''));
      if (isNaN(num) || num <= 0) { alert('Invalid amount.'); return; }
      await NX.sb.from('budgets').update({
        annual_amount: num,
        updated_at: new Date().toISOString(),
      }).eq('restaurant', row.restaurant).eq('fiscal_year', row.fiscal_year);
      await loadBudgets();
      refresh();
    } else if (action === '2') {
      if (confirm(`Delete the ${row.restaurant} FY ${row.fiscal_year} budget?`)) {
        await NX.sb.from('budgets').delete()
          .eq('restaurant', row.restaurant).eq('fiscal_year', row.fiscal_year);
        await loadBudgets();
        refresh();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────

  function refresh() {
    if (document.getElementById('spendView')) renderSpendView();
    mountBudgetCardsToBrief();
  }

  const debouncedReload = NXRM.realtime.debounce(async () => {
    await Promise.all([loadRollup(), loadBudgets()]);
    refresh();
  }, 800);

  function subscribe() {
    NXRM.realtime.subscribe('rm-money', [
      { filter: { event: '*', schema: 'public', table: 'equipment_issues' }, handler: debouncedReload },
      { filter: { event: '*', schema: 'public', table: 'budgets' },          handler: debouncedReload },
    ]);
  }

  const mod = {
    async init() {
      NXRM.view.ensure('spendView', 'spend');
      await Promise.all([loadRollup(), loadBudgets()]);
      subscribe();
      state.loaded = true;
      refresh();
    },
    async show() {
      if (!state.loaded) await this.init();
      else { await Promise.all([loadRollup(), loadBudgets()]); refresh(); }
    },
    async refresh() { return Promise.all([loadRollup(), loadBudgets()]).then(refresh); },
  };

  if (window.NX) {
    NX.modules = NX.modules || {};
    NX.modules.spend = mod;
  }

  NXRM.view.onSwitch(() => setTimeout(mountBudgetCardsToBrief, 200));

  // ─────────────────────────────────────────────────────────────────────
  // BRAIN
  // ─────────────────────────────────────────────────────────────────────

  NXRM.brain.register({
    name: 'get_budget_status',
    description: 'This year\'s R&M budget status per restaurant: budget, spent-to-date, pace variance.',
    params: {},
    run: async () => {
      await loadBudgets();
      return {
        year: new Date().getFullYear(),
        budgets: state.budgets.map(b => ({
          restaurant: b.restaurant,
          budget: Number(b.annual_amount) || 0,
          spent: Number(b.spent_to_date) || 0,
          remaining: Number(b.remaining) || 0,
          pct_used: Number(b.pct_used) || 0,
          expected_by_now: Number(b.expected_spent_by_now) || 0,
          variance: Number(b.variance_from_pace) || 0,
          status: b.variance_from_pace > 0
            ? (b.variance_from_pace / b.annual_amount > 0.10 ? 'over_budget' : 'slightly_over_pace')
            : 'on_pace_or_under',
        })),
      };
    },
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────────────────

  window.NXSpend = { refresh: () => mod.refresh(), getRollup: () => state.rollup.slice() };
  window.NXBudget = {
    refresh: () => loadBudgets().then(refresh),
    getAll:  () => state.budgets.slice(),
    promptNew: promptNewBudget,
  };
})();
