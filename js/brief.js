/* ═══════════════════════════════════════════════════════════════════════
   NEXUS · R&M · brief
   ─────────────────────────────────────────────────────────────────────
   Two surfaces, one module:

     §1   /brief view       — Daily Brief, one scroll, urgent-first
     §2   Compliance track  — inspection / cert / gas tag expiry

   Reads v_issue_summary, v_pm_due_soon, v_compliance_due. Depends on
   core.js. Budget cards mount themselves here from money.js.
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';
  const { fmt, esc } = NXRM;

  // ─────────────────────────────────────────────────────────────────────
  // COMPLIANCE METADATA
  // ─────────────────────────────────────────────────────────────────────

  const COMPLIANCE_LABELS = {
    health_inspection:  'Health Inspection',
    gas_tag:            'Gas Tag',
    fire_inspection:    'Fire Inspection',
    hood_certification: 'Hood Cert',
    electrical_cert:    'Electrical Cert',
    grease_trap_pump:   'Grease Trap Pump',
    food_handler:       'Food Handler Cert',
    backflow:           'Backflow Test',
    pest_control:       'Pest Control Service',
  };

  const COMPLIANCE_STATUS = {
    expired:        { label: 'EXPIRED',       glyph: '🔴', tone: 'tone-critical' },
    expiring_soon:  { label: 'Expiring Soon', glyph: '🟠', tone: 'tone-warn' },
    current:        { label: 'Current',       glyph: '🟢', tone: 'tone-ok' },
    unknown:        { label: 'No Date',       glyph: '⚪', tone: 'tone-mute' },
  };

  // ─────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────

  const state = {
    issues:       [],
    pmSchedules:  [],
    compliance:   [],
    closedToday:  [],
    spend:        { today: 0, week: 0, month: 0 },
    loaded:       false,
  };

  // ─────────────────────────────────────────────────────────────────────
  // DATA — load everything in parallel
  // ─────────────────────────────────────────────────────────────────────

  async function loadAll() {
    if (!NX?.sb) return;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart  = new Date(now.getTime() - 7 * 86400000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    try {
      const [issuesRes, pmsRes, spendRes, compRes] = await Promise.all([
        NX.sb.from('v_issue_summary').select('*').limit(500),
        NX.sb.from('v_pm_due_soon').select('*').limit(100),
        NX.sb.from('equipment_issues').select('invoice_amount, invoice_paid_at')
          .gte('invoice_paid_at', monthStart),
        NX.sb.from('v_compliance_due').select('*'),
      ]);
      state.issues = issuesRes.data || [];
      state.pmSchedules = pmsRes.data || [];
      state.compliance = compRes.data || [];

      state.spend = { today: 0, week: 0, month: 0 };
      (spendRes.data || []).forEach(r => {
        const amt = Number(r.invoice_amount) || 0;
        if (!r.invoice_paid_at) return;
        if (r.invoice_paid_at >= monthStart) state.spend.month += amt;
        if (r.invoice_paid_at >= weekStart)  state.spend.week  += amt;
        if (r.invoice_paid_at >= todayStart) state.spend.today += amt;
      });
      state.closedToday = state.issues.filter(i =>
        i.repaired_at && i.repaired_at >= todayStart);
    } catch (e) {
      console.warn('[brief] load failed', e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // §1 — /brief VIEW
  // ─────────────────────────────────────────────────────────────────────

  function greeting() {
    const h = new Date().getHours();
    if (h < 5)  return 'Good night';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Good night';
  }

  function todayLabel() {
    return new Date().toLocaleDateString('en-US',
      { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function render() {
    const view = NXRM.view.ensure('briefView', 'brief');

    const critical = state.issues
      .filter(i => i.is_open && (i.priority === 'critical' || i.priority === 'high'))
      .sort((a, b) => (a.priority === 'critical' ? -1 : 0));
    const overduePM = state.pmSchedules.filter(s => s.urgency === 'overdue');
    const dueSoonPM = state.pmSchedules.filter(s => s.urgency === 'due_soon');
    const awaitingQ = state.issues.filter(i => i.awaiting_quote_approval);
    const awaitingI = state.issues.filter(i => i.awaiting_invoice_payment);
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const newToday = state.issues.filter(i => i.reported_at && i.reported_at >= yesterday);
    const urgentCompliance = state.compliance.filter(c =>
      c.status === 'expired' || c.status === 'expiring_soon');

    const facts = [];
    if (critical.length)         facts.push(`<strong>${critical.length}</strong> critical ${critical.length === 1 ? 'issue' : 'issues'}`);
    if (overduePM.length)        facts.push(`<strong>${overduePM.length}</strong> overdue PM`);
    if (awaitingQ.length)        facts.push(`<strong>${awaitingQ.length}</strong> ${awaitingQ.length === 1 ? 'quote' : 'quotes'} awaiting`);
    if (awaitingI.length)        facts.push(`<strong>${awaitingI.length}</strong> unpaid ${awaitingI.length === 1 ? 'invoice' : 'invoices'}`);
    if (urgentCompliance.length) facts.push(`<strong>${urgentCompliance.length}</strong> compliance ${urgentCompliance.length === 1 ? 'item' : 'items'}`);
    const situation = facts.length
      ? facts.join(' · ') + '.'
      : 'Nothing urgent. <strong>The restaurants are calm.</strong>';

    view.innerHTML = `
      <div class="nxrm-brief-page">
        <div class="nxrm-brief-header">
          <div class="nxrm-brief-greeting">${greeting()}</div>
          <div class="nxrm-brief-date">${todayLabel()}</div>
          <div class="nxrm-brief-situation">${situation}</div>
        </div>

        ${urgentCompliance.length ? renderComplianceSection(urgentCompliance.slice(0, 5)) : ''}
        ${critical.length ? renderSection('critical', '🚨 Critical & High Priority', critical.slice(0, 5), 'critical') : ''}
        ${overduePM.length ? renderPMSection('overdue', '🔴 PM Overdue', overduePM.slice(0, 5)) : ''}
        ${awaitingQ.length ? renderSection('quotes', '💰 Quotes Awaiting Your Approval', awaitingQ.slice(0, 5), 'quote') : ''}
        ${awaitingI.length ? renderSection('invoices', '🧾 Invoices To Mark Paid', awaitingI.slice(0, 5), 'invoice') : ''}
        ${dueSoonPM.length ? renderPMSection('due-soon', '🟠 PM Due Soon', dueSoonPM.slice(0, 5)) : ''}
        ${newToday.length ? renderSection('new', '📥 New In Last 24 Hours', newToday.slice(0, 5), 'fresh') : ''}
        ${state.closedToday.length ? renderClosedToday() : ''}

        <div class="nxrm-section">
          <div class="nxrm-section-title">💵 Spend Summary</div>
          <div class="nxrm-brief-spend-row">
            <div class="nxrm-brief-spend-tile">
              <div class="nxrm-brief-spend-lbl">Today</div>
              <div class="nxrm-brief-spend-val">${fmt.money(state.spend.today)}</div>
            </div>
            <div class="nxrm-brief-spend-tile">
              <div class="nxrm-brief-spend-lbl">Past Week</div>
              <div class="nxrm-brief-spend-val">${fmt.money(state.spend.week)}</div>
            </div>
            <div class="nxrm-brief-spend-tile">
              <div class="nxrm-brief-spend-lbl">This Month</div>
              <div class="nxrm-brief-spend-val">${fmt.money(state.spend.month)}</div>
            </div>
          </div>
          <button class="nxrm-brief-cta" data-go="spend">View full spend dashboard →</button>
        </div>

        ${facts.length === 0 ? `
          <div class="nxrm-brief-calm">
            <div class="nxrm-brief-calm-glyph">◇</div>
            <div class="nxrm-brief-calm-text">
              No critical issues, no overdue maintenance, no pending money decisions.
              Use this time to plan ahead or catch up on records.
            </div>
            <button class="nxrm-brief-cta" data-go="equipment">Browse Equipment →</button>
          </div>
        ` : ''}
      </div>
    `;
    wire(view);
  }

  function renderSection(key, title, items, type) {
    return `
      <div class="nxrm-section">
        <div class="nxrm-section-title">
          ${esc(title)}
          <span class="nxrm-section-count">${items.length}</span>
        </div>
        <div class="nxrm-brief-list">
          ${items.map(i => renderItem(i, type)).join('')}
        </div>
        ${items.length >= 5
          ? `<button class="nxrm-brief-cta" data-go="issues" data-quick="${key}">View all in Inbox →</button>`
          : ''}
      </div>`;
  }

  function renderItem(it, type) {
    const tone = it.priority === 'critical' ? 'tone-critical'
               : it.priority === 'high'     ? 'tone-high'
               : 'tone-normal';
    let badge = '', cost = '';
    if (type === 'quote')
      badge = `<span class="nxrm-brief-badge is-alert">💰 ${fmt.money(it.quote_amount)} awaiting approval</span>`;
    else if (type === 'invoice')
      badge = `<span class="nxrm-brief-badge is-alert">🧾 ${fmt.money(it.invoice_amount)} unpaid</span>`;
    else if (type === 'fresh')
      badge = `<span class="nxrm-brief-badge">${fmt.age(it.age_hours)} ago</span>`;
    else {
      badge = `<span class="nxrm-brief-badge">${fmt.age(it.age_hours)} open</span>`;
      if (it.invoice_amount || it.quote_amount)
        cost = `<span class="nxrm-brief-cost">${fmt.money(it.invoice_amount || it.quote_amount)}</span>`;
    }
    return `
      <button class="nxrm-brief-item ${tone}"
              data-equipment-id="${esc(it.equipment_id || '')}"
              data-issue-id="${esc(it.id)}">
        <div class="nxrm-brief-body">
          <div class="nxrm-brief-itemtitle">${esc(it.title || '(no title)')}</div>
          <div class="nxrm-brief-itemmeta">
            <span>${esc(it.equipment_name || '—')}</span>
            ${it.restaurant ? '<span> · ' + esc(it.restaurant) + '</span>' : ''}
            ${it.contractor_company ? '<span> · 🔧 ' + esc(it.contractor_company) + '</span>' : ''}
          </div>
          <div class="nxrm-brief-badges">${badge}${cost}</div>
        </div>
        <div class="nxrm-brief-arrow">→</div>
      </button>`;
  }

  function renderPMSection(key, title, items) {
    return `
      <div class="nxrm-section">
        <div class="nxrm-section-title">
          ${esc(title)}
          <span class="nxrm-section-count">${items.length}</span>
        </div>
        <div class="nxrm-brief-list">
          ${items.map(s => `
            <button class="nxrm-brief-item ${s.urgency === 'overdue' ? 'tone-critical' : 'tone-high'}"
                    data-go="pm-schedules">
              <div class="nxrm-brief-body">
                <div class="nxrm-brief-itemtitle">${esc(s.title || 'PM task')}</div>
                <div class="nxrm-brief-itemmeta">
                  <span>${esc(s.equipment_name || '—')}</span>
                  ${s.restaurant ? '<span> · ' + esc(s.restaurant) + '</span>' : ''}
                </div>
                <div class="nxrm-brief-badges">
                  <span class="nxrm-brief-badge is-alert">every ${s.frequency_days}d</span>
                  ${s.assigned_to ? '<span class="nxrm-brief-badge">→ ' + esc(s.assigned_to) + '</span>' : ''}
                </div>
              </div>
              <div class="nxrm-brief-arrow">→</div>
            </button>
          `).join('')}
        </div>
      </div>`;
  }

  function renderComplianceSection(items) {
    return `
      <div class="nxrm-section">
        <div class="nxrm-section-title">
          📋 Compliance Watch
          <span class="nxrm-section-count">${items.length}</span>
        </div>
        <div class="nxrm-brief-list">
          ${items.map(c => {
            const meta = COMPLIANCE_STATUS[c.status] || COMPLIANCE_STATUS.unknown;
            return `
              <button class="nxrm-brief-item ${meta.tone}"
                      data-compliance-id="${esc(c.id)}">
                <div class="nxrm-brief-body">
                  <div class="nxrm-brief-itemtitle">${esc(COMPLIANCE_LABELS[c.compliance_type] || c.compliance_type)}</div>
                  <div class="nxrm-brief-itemmeta">
                    <span>${esc(c.equipment_name || '')}</span>
                    ${c.restaurant ? ' · ' + esc(c.restaurant) : ''}
                    ${c.authority ? ' · ' + esc(c.authority) : ''}
                  </div>
                  <div class="nxrm-brief-badges">
                    <span class="nxrm-brief-badge ${c.status === 'expired' ? 'is-alert' : ''}">${meta.glyph} ${meta.label}</span>
                    <span class="nxrm-brief-badge">${fmtDaysUntilExpiry(c.days_until_expiry)}</span>
                  </div>
                </div>
                <div class="nxrm-brief-arrow">→</div>
              </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  function fmtDaysUntilExpiry(n) {
    if (n == null) return '—';
    if (n < 0)  return Math.abs(n) + 'd ago';
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n < 30) return 'in ' + n + 'd';
    return 'in ' + Math.floor(n / 30) + 'mo';
  }

  function renderClosedToday() {
    return `
      <div class="nxrm-section nxrm-section-wins">
        <div class="nxrm-section-title">
          ✅ Wins Today
          <span class="nxrm-section-count">${state.closedToday.length}</span>
        </div>
        <div class="nxrm-brief-list">
          ${state.closedToday.slice(0, 5).map(i => `
            <div class="nxrm-brief-win">
              <span class="nxrm-brief-win-glyph">✓</span>
              <span class="nxrm-brief-win-title">${esc(i.title || '(no title)')}</span>
              <span class="nxrm-brief-win-meta">${esc(i.equipment_name || '')}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function wire(view) {
    view.querySelectorAll('[data-equipment-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-equipment-id');
        if (!id) return;
        NXRM.view.switchTo('equipment');
        setTimeout(() => {
          if (typeof window.eqOpenDetail === 'function') window.eqOpenDetail(id);
        }, 180);
      });
    });
    view.querySelectorAll('[data-go]').forEach(el => {
      el.addEventListener('click', () => NXRM.view.switchTo(el.getAttribute('data-go')));
    });
    view.querySelectorAll('[data-compliance-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-compliance-id');
        const c = state.compliance.find(x => x.id === id);
        if (c) openComplianceModal(c);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // §2 — COMPLIANCE MODALS
  // ─────────────────────────────────────────────────────────────────────

  function openComplianceModal(item) {
    const html = `
      <div class="nxrm-card-head">
        <div class="nxrm-eyebrow">COMPLIANCE</div>
        <div class="nxrm-h1">${esc(COMPLIANCE_LABELS[item.compliance_type] || item.compliance_type)}</div>
        <button class="nxrm-close" data-close>✕</button>
      </div>
      <div class="nxrm-compliance-body">
        <div class="nxrm-compliance-row"><strong>Equipment:</strong> ${esc(item.equipment_name || '—')}</div>
        <div class="nxrm-compliance-row"><strong>Restaurant:</strong> ${esc(item.restaurant || '—')}</div>
        ${item.authority ? `<div class="nxrm-compliance-row"><strong>Authority:</strong> ${esc(item.authority)}</div>` : ''}
        <div class="nxrm-compliance-row"><strong>Issued:</strong> ${fmt.date(item.issued_at)}</div>
        <div class="nxrm-compliance-row"><strong>Expires:</strong> <span class="${item.status === 'expired' ? 'is-alert' : ''}">${fmt.date(item.expires_at)} (${fmtDaysUntilExpiry(item.days_until_expiry)})</span></div>
        ${item.certificate_url ? `<div class="nxrm-compliance-row"><a href="${esc(item.certificate_url)}" target="_blank">📎 View certificate</a></div>` : ''}
        ${item.notes ? `<div class="nxrm-compliance-notes">${esc(item.notes)}</div>` : ''}
      </div>
      <div class="nxrm-ts-actions">
        <button class="nxrm-ts-btn is-success" data-comp="renew">✓ Mark renewed</button>
        <button class="nxrm-ts-btn is-fallback" data-comp="edit">✎ Edit details</button>
        <button class="nxrm-ts-btn is-skip" data-comp="delete">🗑 Delete record</button>
      </div>
    `;
    const { el, close } = NXRM.overlay.open(html);

    el.querySelector('[data-comp="renew"]').addEventListener('click', async () => {
      const newDate = prompt('New expiration date (YYYY-MM-DD):',
        new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10));
      if (!newDate) return;
      const url = prompt('New certificate URL (optional):', '') || null;
      await NX.sb.from('equipment_compliance').update({
        issued_at: new Date().toISOString().slice(0, 10),
        expires_at: newDate,
        certificate_url: url || item.certificate_url,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);
      close();
      await loadAll();
      render();
      NXRM.notify.bubble(`Bzzt — ${COMPLIANCE_LABELS[item.compliance_type] || item.compliance_type} renewed.`,
        { autoHide: 3000, eyebrow: '✓ RENEWED' });
    });

    el.querySelector('[data-comp="edit"]').addEventListener('click', async () => {
      const label = prompt('Label:', item.label || '');
      const authority = prompt('Authority:', item.authority || '');
      const issued = prompt('Issued date (YYYY-MM-DD):', item.issued_at || '');
      const expires = prompt('Expires date (YYYY-MM-DD):', item.expires_at || '');
      const notes = prompt('Notes:', item.notes || '');
      await NX.sb.from('equipment_compliance').update({
        label: label || null,
        authority: authority || null,
        issued_at: issued || null,
        expires_at: expires || null,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);
      close();
      await loadAll();
      render();
    });

    el.querySelector('[data-comp="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this compliance record permanently?')) return;
      await NX.sb.from('equipment_compliance').delete().eq('id', item.id);
      close();
      await loadAll();
      render();
    });
  }

  async function promptNewCompliance(equipmentId) {
    if (!NX?.sb) return;
    let eqId = equipmentId;
    if (!eqId) {
      const { data: eq } = await NX.sb.from('equipment')
        .select('id, name, restaurant:location').order('name');   // v295: real column is `location`; alias keeps e.restaurant working
      if (!eq || !eq.length) { alert('No equipment.'); return; }
      const pick = prompt('Pick equipment:\n\n' + eq.map((e, i) =>
        `${i + 1}. ${e.name} (${e.restaurant})`).join('\n'));
      if (pick === null) return;
      const idx = parseInt(pick, 10) - 1;
      if (!eq[idx]) return;
      eqId = eq[idx].id;
    }
    const typeOpts = Object.keys(COMPLIANCE_LABELS);
    const typePrompt = typeOpts.map((t, i) => `${i + 1}. ${COMPLIANCE_LABELS[t]}`).join('\n');
    const typePick = prompt('Compliance type:\n\n' + typePrompt);
    if (typePick === null) return;
    const typeIdx = parseInt(typePick, 10) - 1;
    if (!typeOpts[typeIdx]) return;
    const compliance_type = typeOpts[typeIdx];

    const authority = prompt('Authority (e.g., "Austin Public Health"):') || null;
    const issued = prompt('Issued date (YYYY-MM-DD):',
      new Date().toISOString().slice(0, 10));
    const expires = prompt('Expires date (YYYY-MM-DD):',
      new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10));
    const url = prompt('Certificate URL (optional):') || null;

    await NX.sb.from('equipment_compliance').insert({
      equipment_id: eqId, compliance_type, authority,
      issued_at: issued || null, expires_at: expires || null,
      certificate_url: url, reminder_days: 30,
    });
    await loadAll();
    render();
    NXRM.notify.bubble(`Bzzt — ${COMPLIANCE_LABELS[compliance_type]} added.`,
      { autoHide: 3000, eyebrow: '✓ TRACKED' });
  }

  // ─────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────

  const debouncedReload = NXRM.realtime.debounce(async () => {
    await loadAll();
    render();
  }, 800);

  function subscribe() {
    NXRM.realtime.subscribe('rm-brief', [
      { filter: { event: '*', schema: 'public', table: 'equipment_issues' },      handler: debouncedReload },
      { filter: { event: '*', schema: 'public', table: 'pm_schedules' },          handler: debouncedReload },
      { filter: { event: '*', schema: 'public', table: 'equipment_compliance' }, handler: debouncedReload },
    ]);
  }

  const mod = {
    async init() {
      NXRM.view.ensure('briefView', 'brief');
      await loadAll();
      subscribe();
      state.loaded = true;
      render();
    },
    async show() {
      if (!state.loaded) await this.init();
      else { await loadAll(); render(); }
    },
    async refresh() { return loadAll().then(render); },
  };

  if (window.NX) {
    NX.modules = NX.modules || {};
    NX.modules.brief = mod;
  }

  // Render once on load so the brief is ready when you tap into it
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => mod.init(), 1000));
  } else {
    setTimeout(() => mod.init(), 1000);
  }

  // ─────────────────────────────────────────────────────────────────────
  // BRAIN
  // ─────────────────────────────────────────────────────────────────────

  NXRM.brain.register({
    name: 'get_compliance_due',
    description: 'Compliance items (inspections, gas tags, fire certs, etc.) that are expired or expiring soon.',
    params: {},
    run: async () => {
      await loadAll();
      const urgent = state.compliance.filter(c =>
        c.status === 'expired' || c.status === 'expiring_soon');
      return {
        count: urgent.length,
        items: urgent.map(c => ({
          type: COMPLIANCE_LABELS[c.compliance_type] || c.compliance_type,
          equipment: c.equipment_name,
          restaurant: c.restaurant,
          authority: c.authority,
          expires_at: c.expires_at,
          days_until_expiry: c.days_until_expiry,
          status: c.status,
        })),
      };
    },
  });

  // ─────────────────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────────────────

  window.NXBrief = { refresh: () => mod.refresh() };
  window.NXCompliance = {
    refresh: () => loadAll().then(render),
    getAll: () => state.compliance.slice(),
    promptNew: promptNewCompliance,
  };
})();
