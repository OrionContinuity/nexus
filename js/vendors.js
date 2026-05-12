/* ═══════════════════════════════════════════════════════════════════════
   NEXUS · R&M · vendors
   ─────────────────────────────────────────────────────────────────────
   Three surfaces, one module:

     §1   /vendors view       — list with computed A-F scorecards
     §2   Vendor detail       — stats grid + recent jobs
     §3   Dispatch picker     — SMS / Call / Email with pre-filled body

   Reads v_vendor_performance (fallback to vendors + equipment_issues).
   Exposes window.NXVendors (list/get/etc) and window.NXDispatch (open
   the dispatch picker from anywhere with an issue_id).

   Depends on core.js.
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';
  const { fmt, esc, score } = NXRM;

  const state = {
    vendors:       [],
    perfRows:      [],
    filtered:      [],
    activeVendor:  null,
    filter: {
      category:  'all',
      preferred: false,
      search:    '',
      sort:      'spend',
    },
    loaded: false,
  };

  // ─────────────────────────────────────────────────────────────────────
  // DATA
  // ─────────────────────────────────────────────────────────────────────

  async function loadVendors() {
    if (!NX?.sb) return;
    try {
      const [{ data: vendors }, { data: perf }] = await Promise.all([
        NX.sb.from('vendors').select('*').eq('active', true).order('company'),
        NX.sb.from('v_vendor_performance').select('*'),
      ]);
      state.vendors = vendors || [];
      state.perfRows = perf || [];
    } catch (e) {
      console.warn('[vendors] load failed', e);
      try {
        const { data } = await NX.sb.from('vendors').select('*').eq('active', true);
        state.vendors = data || [];
        state.perfRows = [];
      } catch (_) {}
    }
    applyFilters();
    render();
  }

  function mergeData() {
    return state.vendors.map(v => {
      const perf = state.perfRows.find(p => p.vendor_id === v.id) || {};
      return {
        ...v,
        total_jobs:              Number(perf.total_jobs)         || 0,
        completed_jobs:          Number(perf.completed_jobs)     || 0,
        active_jobs:             Number(perf.active_jobs)        || 0,
        total_spend:             Number(perf.total_spend)        || 0,
        avg_response_hours:      perf.avg_response_hours == null ? null : Number(perf.avg_response_hours),
        avg_time_to_fix_hours:   perf.avg_time_to_fix_hours == null ? null : Number(perf.avg_time_to_fix_hours),
        last_job_at:             perf.last_job_at,
        equipment_serviced_count: Number(perf.equipment_serviced_count) || 0,
      };
    });
  }

  function applyFilters() {
    const f = state.filter;
    let result = mergeData();
    if (f.category !== 'all') {
      result = result.filter(v => (v.category || '').toLowerCase() === f.category.toLowerCase());
    }
    if (f.preferred) result = result.filter(v => v.is_preferred);
    if (f.search) {
      const q = f.search.toLowerCase();
      result = result.filter(v =>
        (v.name || '').toLowerCase().includes(q) ||
        (v.company || '').toLowerCase().includes(q) ||
        (v.category || '').toLowerCase().includes(q));
    }
    switch (f.sort) {
      case 'spend':    result.sort((a, b) => b.total_spend - a.total_spend); break;
      case 'jobs':     result.sort((a, b) => b.total_jobs - a.total_jobs); break;
      case 'response': result.sort((a, b) => (a.avg_response_hours ?? 999) - (b.avg_response_hours ?? 999)); break;
      case 'name':     result.sort((a, b) => (a.company || a.name || '').localeCompare(b.company || b.name || '')); break;
    }
    state.filtered = result;
  }

  // ─────────────────────────────────────────────────────────────────────
  // §1 — LIST VIEW
  // ─────────────────────────────────────────────────────────────────────

  function render() {
    const view = NXRM.view.ensure('vendorsView', 'vendors');
    if (state.activeVendor) return renderDetail(view, state.activeVendor);

    const f = state.filter;
    const merged = mergeData();
    const cats = ['all', ...new Set(merged.map(v => v.category).filter(Boolean))];
    const pref = merged.filter(v => v.is_preferred).length;
    const emerg = merged.filter(v => v.is_emergency).length;
    const totalSpend = merged.reduce((s, v) => s + v.total_spend, 0);

    view.innerHTML = `
      <div class="nxrm-page">
        <div class="nxrm-masthead">
          <div>
            <div class="nxrm-eyebrow">CONTRACTORS &amp; TRADES</div>
            <h1 class="nxrm-h1">Vendors</h1>
          </div>
          <button class="nxrm-btn-pill" data-act="new-vendor">+ New</button>
        </div>

        <div class="nxrm-tiles tiles-4">
          <div class="nxrm-tile">
            <div class="nxrm-tile-num">${merged.length}</div>
            <div class="nxrm-tile-lbl">Active</div>
          </div>
          <div class="nxrm-tile">
            <div class="nxrm-tile-num">${pref}</div>
            <div class="nxrm-tile-lbl">Preferred</div>
          </div>
          <div class="nxrm-tile">
            <div class="nxrm-tile-num">${emerg}</div>
            <div class="nxrm-tile-lbl">24-Hour</div>
          </div>
          <div class="nxrm-tile">
            <div class="nxrm-tile-num">${fmt.money(totalSpend)}</div>
            <div class="nxrm-tile-lbl">Total&nbsp;Spend</div>
          </div>
        </div>

        <div class="nxrm-filters">
          <div class="nxrm-chip-row">
            ${cats.map(c => `
              <button class="nxrm-chip ${f.category === c ? 'is-active' : ''}"
                      data-cat="${esc(c)}">
                ${c === 'all' ? 'All categories' : esc(c)}
              </button>
            `).join('')}
          </div>
          <div class="nxrm-chip-row">
            <button class="nxrm-chip is-secondary ${f.preferred ? 'is-active' : ''}"
                    data-toggle-pref>⭐ Preferred only</button>
            <input class="nxrm-search" placeholder="Search vendor name, company…"
                   value="${esc(f.search)}" id="vendorsSearch">
            <select class="nxrm-sort" id="vendorsSort">
              <option value="spend"${f.sort === 'spend' ? ' selected' : ''}>Total Spend</option>
              <option value="jobs"${f.sort === 'jobs' ? ' selected' : ''}>Most Jobs</option>
              <option value="response"${f.sort === 'response' ? ' selected' : ''}>Fastest Response</option>
              <option value="name"${f.sort === 'name' ? ' selected' : ''}>Name A-Z</option>
            </select>
          </div>
        </div>

        <div class="nxrm-vendor-list">${renderCards()}</div>
      </div>
    `;
    wire(view);
  }

  function renderCards() {
    if (!state.filtered.length) {
      return `
        <div class="nxrm-empty">
          <div class="nxrm-empty-glyph">○</div>
          <div class="nxrm-empty-title">No vendors yet</div>
          <div class="nxrm-empty-body">
            Add your first vendor — name, phone, category — and computed scorecards will appear once issues are dispatched to them.
          </div>
        </div>`;
    }
    return state.filtered.map(v => {
      const grade = score.vendorGrade(v);
      return `
        <button class="nxrm-vendor-card" data-vendor-id="${esc(v.id)}">
          <div class="nxrm-vendor-grade ${grade.tone}">${grade.letter}</div>
          <div class="nxrm-vendor-body">
            <div class="nxrm-vendor-row1">
              <span class="nxrm-vendor-name">${esc(v.company || v.name)}</span>
              ${v.is_preferred ? '<span class="nxrm-vendor-badge is-pref">⭐ Preferred</span>' : ''}
              ${v.is_emergency ? '<span class="nxrm-vendor-badge is-emerg">24-hr</span>' : ''}
            </div>
            <div class="nxrm-vendor-row2">
              ${v.category ? '<span class="nxrm-vendor-cat">' + esc(v.category) + '</span>' : ''}
              ${v.phone ? '<span class="nxrm-vendor-phone">📞 ' + esc(v.phone) + '</span>' : ''}
            </div>
            <div class="nxrm-vendor-stats">
              <div class="nxrm-vendor-stat"><div class="nxrm-vendor-stat-val">${v.total_jobs}</div><div class="nxrm-vendor-stat-lbl">jobs</div></div>
              <div class="nxrm-vendor-stat"><div class="nxrm-vendor-stat-val">${fmt.money(v.total_spend)}</div><div class="nxrm-vendor-stat-lbl">spent</div></div>
              <div class="nxrm-vendor-stat"><div class="nxrm-vendor-stat-val">${fmt.hours(v.avg_response_hours)}</div><div class="nxrm-vendor-stat-lbl">response</div></div>
              <div class="nxrm-vendor-stat"><div class="nxrm-vendor-stat-val">${fmt.sinceWords(v.last_job_at)}</div><div class="nxrm-vendor-stat-lbl">last job</div></div>
            </div>
          </div>
        </button>`;
    }).join('');
  }

  function wire(view) {
    view.querySelectorAll('[data-cat]').forEach(el => {
      el.addEventListener('click', () => {
        state.filter.category = el.getAttribute('data-cat');
        applyFilters(); render();
      });
    });
    const pref = view.querySelector('[data-toggle-pref]');
    if (pref) pref.addEventListener('click', () => {
      state.filter.preferred = !state.filter.preferred;
      applyFilters(); render();
    });
    const search = view.querySelector('#vendorsSearch');
    if (search) {
      let t;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.filter.search = search.value || '';
          applyFilters(); render();
          const fresh = document.querySelector('#vendorsSearch');
          if (fresh) { fresh.focus(); fresh.setSelectionRange(fresh.value.length, fresh.value.length); }
        }, 220);
      });
    }
    const sortSel = view.querySelector('#vendorsSort');
    if (sortSel) sortSel.addEventListener('change', () => {
      state.filter.sort = sortSel.value;
      applyFilters(); render();
    });
    view.querySelectorAll('[data-vendor-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-vendor-id');
        const v = state.filtered.find(x => x.id === id);
        if (v) { state.activeVendor = v; render(); }
      });
    });
    const newBtn = view.querySelector('[data-act="new-vendor"]');
    if (newBtn) newBtn.addEventListener('click', promptNewVendor);
  }

  // ─────────────────────────────────────────────────────────────────────
  // §2 — DETAIL VIEW
  // ─────────────────────────────────────────────────────────────────────

  async function renderDetail(view, vendor) {
    let issues = [];
    if (NX?.sb) {
      try {
        const { data } = await NX.sb.from('v_issue_summary')
          .select('*').eq('vendor_id', vendor.id)
          .order('reported_at', { ascending: false }).limit(50);
        issues = data || [];
      } catch (_) {}
    }
    const grade = score.vendorGrade(vendor);

    view.innerHTML = `
      <div class="nxrm-page">
        <button class="nxrm-back" data-act="back-to-list">← Back to vendors</button>

        <div class="nxrm-vendor-header">
          <div class="nxrm-vendor-grade-big ${grade.tone}">
            <div class="nxrm-vendor-grade-letter">${grade.letter}</div>
            <div class="nxrm-vendor-grade-lbl">${grade.label}</div>
          </div>
          <div class="nxrm-vendor-headline">
            <div class="nxrm-eyebrow">${esc(vendor.category || 'VENDOR')}</div>
            <h1 class="nxrm-h1">${esc(vendor.company || vendor.name)}</h1>
            <div class="nxrm-vendor-tags">
              ${vendor.is_preferred ? '<span class="nxrm-vendor-badge is-pref">⭐ Preferred</span>' : ''}
              ${vendor.is_emergency ? '<span class="nxrm-vendor-badge is-emerg">24-hour</span>' : ''}
            </div>
          </div>
        </div>

        <div class="nxrm-vendor-contact">
          ${vendor.phone ? `
            <a class="nxrm-vendor-action" href="tel:${esc(vendor.phone)}">📞 Call</a>
            <a class="nxrm-vendor-action" href="sms:${esc(vendor.phone)}">💬 Text</a>
          ` : ''}
          ${vendor.email ? `
            <a class="nxrm-vendor-action" href="mailto:${esc(vendor.email)}">✉ Email</a>
          ` : ''}
          <button class="nxrm-vendor-action" data-act="edit-vendor">⚙ Edit</button>
        </div>

        <div class="nxrm-vendor-detail-stats">
          <div class="nxrm-vendor-detail-stat">
            <div class="nxrm-vendor-detail-val">${vendor.total_jobs}</div>
            <div class="nxrm-vendor-detail-lbl">Total Jobs</div>
          </div>
          <div class="nxrm-vendor-detail-stat">
            <div class="nxrm-vendor-detail-val">${fmt.money(vendor.total_spend)}</div>
            <div class="nxrm-vendor-detail-lbl">Total Spend</div>
          </div>
          <div class="nxrm-vendor-detail-stat">
            <div class="nxrm-vendor-detail-val">${fmt.hours(vendor.avg_response_hours)}</div>
            <div class="nxrm-vendor-detail-lbl">Avg Response</div>
          </div>
          <div class="nxrm-vendor-detail-stat">
            <div class="nxrm-vendor-detail-val">${fmt.hours(vendor.avg_time_to_fix_hours)}</div>
            <div class="nxrm-vendor-detail-lbl">Avg Time-to-Fix</div>
          </div>
          <div class="nxrm-vendor-detail-stat">
            <div class="nxrm-vendor-detail-val">${vendor.active_jobs}</div>
            <div class="nxrm-vendor-detail-lbl">Active Now</div>
          </div>
          <div class="nxrm-vendor-detail-stat">
            <div class="nxrm-vendor-detail-val">${vendor.equipment_serviced_count}</div>
            <div class="nxrm-vendor-detail-lbl">Equipment&nbsp;Touched</div>
          </div>
        </div>

        ${vendor.hourly_rate || vendor.trip_charge ? `
          <div class="nxrm-vendor-rates">
            ${vendor.hourly_rate ? '<div>Hourly: <strong>' + fmt.money(vendor.hourly_rate) + '/hr</strong></div>' : ''}
            ${vendor.trip_charge ? '<div>Trip charge: <strong>' + fmt.money(vendor.trip_charge) + '</strong></div>' : ''}
          </div>
        ` : ''}

        ${vendor.notes ? `<div class="nxrm-vendor-notes">${esc(vendor.notes)}</div>` : ''}

        <div class="nxrm-section">
          <div class="nxrm-section-title">Recent Jobs · ${issues.length}</div>
          <div class="nxrm-list">
            ${issues.length ? issues.map(i => `
              <button class="nxrm-card" data-equipment-id="${esc(i.equipment_id)}" data-issue-id="${esc(i.id)}">
                <div class="nxrm-card-row1">
                  <span class="nxrm-card-priority">${esc((i.status || '').toUpperCase())}</span>
                  <span class="nxrm-card-age">${i.repaired_at ? 'closed' : 'open'}</span>
                </div>
                <div class="nxrm-card-title">${esc(i.title)}</div>
                <div class="nxrm-card-row2">
                  <span class="nxrm-card-eq">${esc(i.equipment_name || '—')}</span>
                  <span class="nxrm-sep">·</span>
                  <span class="nxrm-card-restaurant">${esc(i.restaurant || '—')}</span>
                </div>
                ${i.invoice_amount ? `<div class="nxrm-card-cost">${fmt.money(i.invoice_amount)}</div>` : ''}
              </button>
            `).join('') : '<div class="nxrm-empty"><div class="nxrm-empty-body">No jobs assigned to this vendor yet.</div></div>'}
          </div>
        </div>
      </div>
    `;

    view.querySelector('[data-act="back-to-list"]').addEventListener('click', () => {
      state.activeVendor = null; render();
    });
    const editBtn = view.querySelector('[data-act="edit-vendor"]');
    if (editBtn) editBtn.addEventListener('click', () => promptEditVendor(vendor));
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
  }

  // ─────────────────────────────────────────────────────────────────────
  // §3 — DISPATCH PICKER (SMS / Call / Email with templates)
  // ─────────────────────────────────────────────────────────────────────

  function buildSMSBody(issue, equipment, vendor) {
    const restaurant = equipment?.location || issue.restaurant || '';
    const eqName = equipment?.name || issue.equipment_name || 'equipment';

    if (vendor?.dispatch_template) {
      return vendor.dispatch_template
        .replace(/{restaurant}/g, restaurant)
        .replace(/{equipment}/g, eqName)
        .replace(/{issue}/g, issue.title || '')
        .replace(/{priority}/g, issue.priority || 'normal')
        .replace(/{description}/g, issue.description || '');
    }
    const urgencyPrefix = issue.priority === 'critical' ? '🚨 URGENT: '
                       : issue.priority === 'high'     ? '⚠ Priority: '
                       : '';
    const parts = [
      `${urgencyPrefix}${eqName} at ${restaurant}`,
      '',
      `Issue: ${issue.title || ''}`,
    ];
    if (issue.description) parts.push(issue.description);
    parts.push(''); parts.push('Can you let me know your ETA?');
    return parts.join('\n');
  }

  function buildEmailSubject(issue, equipment) {
    const restaurant = equipment?.location || issue.restaurant || '';
    const eqName = equipment?.name || issue.equipment_name || 'equipment';
    const prefix = issue.priority === 'critical' ? '[URGENT] '
                 : issue.priority === 'high'     ? '[Priority] '
                 : '';
    return `${prefix}${restaurant}: ${eqName} — ${issue.title || 'repair needed'}`;
  }

  function buildEmailBody(issue, equipment, vendor, comments) {
    const lines = [];
    lines.push(`Hi ${vendor?.name?.split(' ')[0] || 'team'},`);
    lines.push('');
    lines.push('We need service on:');
    lines.push(`• Equipment: ${equipment?.name || issue.equipment_name || '—'}`);
    if (equipment?.manufacturer) lines.push(`• Make/Model: ${equipment.manufacturer} ${equipment.model || ''}`);
    if (equipment?.serial_number) lines.push(`• Serial: ${equipment.serial_number}`);
    lines.push(`• Location: ${equipment?.location || issue.restaurant || ''}${equipment?.area ? ' · ' + equipment.area : ''}`);
    lines.push('');
    lines.push(`Issue: ${issue.title || ''}`);
    if (issue.description) { lines.push(''); lines.push(issue.description); }
    if (issue.priority === 'critical') {
      lines.push('');
      lines.push('This is a CRITICAL priority — we need immediate response if possible.');
    }
    const photoLinks = (comments || []).filter(c => c.attachment_url).slice(0, 5).map(c => c.attachment_url);
    if (photoLinks.length) {
      lines.push(''); lines.push('Photos:');
      photoLinks.forEach(url => lines.push('  ' + url));
    }
    lines.push(''); lines.push('Please reply with your ETA and a quote if available.');
    lines.push(''); lines.push('Thanks,');
    lines.push(NX?.user?.name || NX?.currentUser?.name || 'Manager');
    return lines.join('\n');
  }

  function dispatchSMS(issue, equipment, vendor) {
    if (!vendor?.phone) { alert('No phone on file for this vendor.'); return; }
    const body = buildSMSBody(issue, equipment, vendor);
    const sep = navigator.userAgent.includes('iPhone') ? '&body=' : '?body=';
    window.location.href = 'sms:' + vendor.phone + sep + encodeURIComponent(body);
    logDispatch(issue, vendor, 'sms');
  }
  function dispatchCall(issue, equipment, vendor) {
    if (!vendor?.phone) { alert('No phone on file for this vendor.'); return; }
    window.location.href = 'tel:' + vendor.phone;
    logDispatch(issue, vendor, 'call');
  }
  function dispatchEmail(issue, equipment, vendor, comments) {
    if (!vendor?.email) { alert('No email on file for this vendor.'); return; }
    const subject = buildEmailSubject(issue, equipment);
    const body = buildEmailBody(issue, equipment, vendor, comments);
    window.location.href = 'mailto:' + vendor.email
      + '?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(body);
    logDispatch(issue, vendor, 'email');
  }

  async function logDispatch(issue, vendor, channel) {
    if (!NX?.sb || !issue?.id) return;
    const label = { sms: 'SMS', call: 'Call', email: 'Email' }[channel] || channel;
    try {
      await NX.sb.from('equipment_issue_comments').insert({
        issue_id: issue.id,
        user_id: NX.user?.id || NX.currentUser?.id || null,
        user_name: NX.user?.name || NX.currentUser?.name || 'You',
        body: `${label} dispatched to ${vendor.company || vendor.name}.`,
        is_system_event: true,
      });
      if (!issue.contractor_called_at) {
        await NX.sb.from('equipment_issues').update({
          contractor_called_at: new Date().toISOString(),
          contractor_company: vendor.company || vendor.name,
          vendor_id: vendor.id,
          status: 'contractor_called',
        }).eq('id', issue.id);
      }
      if (window.NXIssues?.refresh) window.NXIssues.refresh();
      if (NXRM.detail?.refresh) NXRM.detail.refresh(issue.id);
    } catch (e) {
      console.warn('[dispatch] log failed', e);
    }
  }

  async function fetchDispatchContext(issueId) {
    if (!NX?.sb) return {};
    try {
      const { data: issue } = await NX.sb.from('equipment_issues').select('*').eq('id', issueId).maybeSingle();
      if (!issue) return {};
      const [{ data: eq }, { data: comments }, { data: vendors }] = await Promise.all([
        issue.equipment_id
          ? NX.sb.from('equipment').select('*').eq('id', issue.equipment_id).maybeSingle()
          : Promise.resolve({ data: null }),
        NX.sb.from('equipment_issue_comments').select('*').eq('issue_id', issueId),
        NX.sb.from('vendors').select('*').eq('active', true),
      ]);
      return { issue, equipment: eq, comments: comments || [], vendors: vendors || [] };
    } catch (e) {
      return {};
    }
  }

  async function openDispatchPicker(issueId) {
    const ctx = await fetchDispatchContext(issueId);
    if (!ctx.issue) { alert('Issue not found.'); return; }

    const assigned = ctx.vendors.find(v => v.id === ctx.issue.vendor_id);
    const recommended = (ctx.equipment?.category
      ? ctx.vendors.filter(v => (v.category || '').toLowerCase() === ctx.equipment.category.toLowerCase())
      : []
    ).filter(v => v.is_preferred && v.id !== assigned?.id);

    const otherList = ctx.vendors.filter(v =>
      v.id !== assigned?.id && !recommended.find(r => r.id === v.id));

    const html = `
      <div class="nxrm-card-head">
        <div class="nxrm-eyebrow">DISPATCH WORK ORDER</div>
        <div class="nxrm-h1">${esc(ctx.issue.title)}</div>
        <button class="nxrm-close" data-close>✕</button>
      </div>

      ${assigned ? `
        <div class="nxrm-section-title">Assigned vendor</div>
        ${renderVendorRow(assigned, true)}
        <div class="nxrm-or">— or pick another —</div>
      ` : ''}

      ${recommended.length ? `
        <div class="nxrm-section-title">⭐ Recommended for ${esc(ctx.equipment?.category || '')}</div>
        ${recommended.map(v => renderVendorRow(v)).join('')}
      ` : ''}

      <div class="nxrm-section-title">All vendors</div>
      <div class="nxrm-dispatch-list">
        ${otherList.length
          ? otherList.map(v => renderVendorRow(v)).join('')
          : '<div class="nxrm-empty"><div class="nxrm-empty-body">No more vendors. Add one from the Vendors view.</div></div>'}
      </div>
    `;

    const { el, close } = NXRM.overlay.open(html);

    el.querySelectorAll('[data-dispatch]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-dispatch');
        const vid = btn.getAttribute('data-vendor-id');
        const vendor = ctx.vendors.find(v => v.id === vid);
        if (!vendor) return;
        close();
        if (action === 'sms')   dispatchSMS(ctx.issue, ctx.equipment, vendor);
        if (action === 'call')  dispatchCall(ctx.issue, ctx.equipment, vendor);
        if (action === 'email') dispatchEmail(ctx.issue, ctx.equipment, vendor, ctx.comments);
      });
    });
  }

  function renderVendorRow(v, assigned) {
    return `
      <div class="nxrm-dispatch-row ${assigned ? 'is-assigned' : ''}">
        <div class="nxrm-dispatch-name">
          ${esc(v.company || v.name)}
          ${v.is_preferred ? '<span class="nxrm-vendor-badge is-pref">⭐</span>' : ''}
          ${v.is_emergency ? '<span class="nxrm-vendor-badge is-emerg">24-hr</span>' : ''}
        </div>
        <div class="nxrm-dispatch-actions">
          ${v.phone ? `
            <button class="nxrm-dispatch-btn" data-dispatch="call" data-vendor-id="${esc(v.id)}">📞</button>
            <button class="nxrm-dispatch-btn" data-dispatch="sms"  data-vendor-id="${esc(v.id)}">💬</button>
          ` : ''}
          ${v.email ? `
            <button class="nxrm-dispatch-btn" data-dispatch="email" data-vendor-id="${esc(v.id)}">✉</button>
          ` : ''}
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────
  // NEW / EDIT
  // ─────────────────────────────────────────────────────────────────────

  async function promptNewVendor() {
    if (!NX?.sb) return;
    const company = prompt('Vendor company name:');
    if (!company) return;
    const category = prompt('Category (HVAC, Refrigeration, Plumbing, Electrical, Pest, etc.):') || null;
    const phone = prompt('Phone (optional):') || null;
    const email = prompt('Email (optional):') || null;
    const { error } = await NX.sb.from('vendors').insert({
      company, name: company, category, phone, email, active: true,
    });
    if (error) { alert('Failed: ' + error.message); return; }
    await loadVendors();
  }

  async function promptEditVendor(v) {
    const company = prompt('Company:', v.company || v.name);
    if (company === null) return;
    const category = prompt('Category:', v.category || '');
    const phone = prompt('Phone:', v.phone || '');
    const email = prompt('Email:', v.email || '');
    const preferred = confirm('Mark as PREFERRED vendor? (OK = yes, Cancel = no)');
    const emergency = confirm('Available 24-hour for emergencies? (OK = yes, Cancel = no)');
    const notes = prompt('Notes (optional):', v.notes || '');
    if (!NX?.sb) return;
    const { error } = await NX.sb.from('vendors').update({
      company, name: company,
      category: category || null,
      phone: phone || null, email: email || null,
      is_preferred: preferred, is_emergency: emergency,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', v.id);
    if (error) { alert('Failed: ' + error.message); return; }
    state.activeVendor = null;
    await loadVendors();
  }

  // ─────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────

  const debouncedReload = NXRM.realtime.debounce(loadVendors, 600);
  function subscribe() {
    NXRM.realtime.subscribe('rm-vendors', [
      { filter: { event: '*', schema: 'public', table: 'vendors' },          handler: debouncedReload },
      { filter: { event: '*', schema: 'public', table: 'equipment_issues' }, handler: debouncedReload },
    ]);
  }

  const mod = {
    async init() {
      NXRM.view.ensure('vendorsView', 'vendors');
      await loadVendors();
      subscribe();
      state.loaded = true;
    },
    async show() {
      if (!state.loaded) await this.init();
      else await loadVendors();
    },
    async refresh() { return loadVendors(); },
  };

  if (window.NX) {
    NX.modules = NX.modules || {};
    NX.modules.vendors = mod;
  }

  // ─────────────────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────────────────

  window.NXVendors = {
    refresh: loadVendors,
    getAll: () => mergeData(),
    getPreferred: () => mergeData().filter(v => v.is_preferred),
    getByCategory: (cat) => mergeData().filter(v =>
      (v.category || '').toLowerCase() === cat.toLowerCase()),
  };

  window.NXDispatch = {
    open: openDispatchPicker,
    sms:   dispatchSMS,
    call:  dispatchCall,
    email: dispatchEmail,
    buildSMSBody, buildEmailSubject, buildEmailBody,
  };

  // Auto-wire dispatch-vendor buttons placed anywhere in the DOM
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act="dispatch-vendor"][data-issue-id]');
    if (t) {
      e.preventDefault();
      openDispatchPicker(t.getAttribute('data-issue-id'));
    }
  });
})();
