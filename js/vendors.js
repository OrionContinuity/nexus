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
    // PMs assigned to this vendor (Phase 2 — PMs live in vendors). select('*')
    // + client-side filter/sort is the bulletproof pattern; equipment id+name
    // are always present so naming them is safe.
    let pms = [];
    if (NX?.sb) {
      try {
        const { data } = await NX.sb.from('pm_schedules').select('*').eq('vendor_id', vendor.id);
        pms = (data || [])
          .filter(p => (p.status || '') !== 'cancelled')
          .sort((a, b) => String(a.scheduled_date || '').localeCompare(String(b.scheduled_date || '')));
        const eqIds = [...new Set(pms.map(p => p.equipment_id).filter(Boolean))];
        if (eqIds.length) {
          const { data: eqs } = await NX.sb.from('equipment').select('id, name').in('id', eqIds);
          const nameById = new Map((eqs || []).map(e => [String(e.id), e.name]));
          pms.forEach(p => { p._eqName = nameById.get(String(p.equipment_id)) || 'Equipment'; });
        }
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

        ${(vendor.contact_name || vendor.website || vendor.address || vendor.account_number || vendor.hours) ? `
          <div class="nxrm-vendor-meta" style="display:flex;flex-direction:column;gap:6px;margin:4px 0 12px;font-size:13px;color:var(--text)">
            ${vendor.contact_name ? `<div><span style="color:var(--muted)">Contact:</span> ${esc(vendor.contact_name)}</div>` : ''}
            ${vendor.hours ? `<div><span style="color:var(--muted)">Hours:</span> ${esc(vendor.hours)}</div>` : ''}
            ${vendor.address ? `<div><span style="color:var(--muted)">Address:</span> ${esc(vendor.address)}</div>` : ''}
            ${vendor.account_number ? `<div><span style="color:var(--muted)">Account #:</span> ${esc(vendor.account_number)}</div>` : ''}
            ${vendor.website ? `<div><span style="color:var(--muted)">Web:</span> <a href="${esc(/^https?:\/\//.test(vendor.website) ? vendor.website : 'https://' + vendor.website)}" target="_blank" rel="noopener" style="color:var(--nx-gold)">${esc(vendor.website)}</a></div>` : ''}
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

        <div class="nxrm-section">
          <div class="nxrm-section-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div class="nxrm-section-title">Scheduled PMs · ${pms.length}</div>
            <button class="nxrm-vendor-action" data-act="schedule-pm" style="flex:0 0 auto;padding:7px 12px">+ Schedule PM</button>
          </div>
          <div class="nxrm-list">
            ${pms.length ? pms.map(p => {
              const d = p.scheduled_date ? new Date(p.scheduled_date) : null;
              const today = new Date(); today.setHours(0, 0, 0, 0);
              let chip = 'scheduled', chipCls = '';
              if (d) {
                if (d < today) { chip = 'overdue'; chipCls = 'is-overdue'; }
                else if (d < new Date(today.getTime() + 14 * 86400000)) { chip = 'soon'; chipCls = 'is-soon'; }
              }
              const dstr = d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'no date';
              return `
              <button class="nxrm-card" data-equipment-id="${esc(p.equipment_id)}">
                <div class="nxrm-card-row1">
                  <span class="nxrm-card-priority">${esc((p.status || 'scheduled').toUpperCase())}</span>
                  <span class="nxrm-card-age ${chipCls}">${chip}</span>
                </div>
                <div class="nxrm-card-title">${esc(p._eqName || p.title || 'PM')}</div>
                <div class="nxrm-card-row2">
                  <span class="nxrm-card-eq">${esc(dstr)}</span>
                  ${p.phase_label ? `<span class="nxrm-sep">·</span><span class="nxrm-card-restaurant">${esc(p.phase_label)}</span>` : ''}
                </div>
              </button>`;
            }).join('') : '<div class="nxrm-empty"><div class="nxrm-empty-body">No PMs scheduled with this vendor yet. Schedule one from any equipment\'s detail page.</div></div>'}
          </div>
        </div>
      </div>
    `;

    view.querySelector('[data-act="back-to-list"]').addEventListener('click', () => {
      state.activeVendor = null; render();
    });
    const editBtn = view.querySelector('[data-act="edit-vendor"]');
    if (editBtn) editBtn.addEventListener('click', () => promptEditVendor(vendor));
    const schedBtn = view.querySelector('[data-act="schedule-pm"]');
    if (schedBtn) schedBtn.addEventListener('click', () => openVendorPmScheduler(vendor));
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

  const TRADES = ['HVAC', 'Refrigeration', 'Plumbing', 'Electrical', 'Pest Control',
    'Fire & Safety', 'Hood / Vent', 'Grease', 'Locksmith', 'Appliance Repair',
    'General Contractor', 'Landscaping', 'Cleaning', 'Other'];

  // Full contractor/trade profile form — replaces the old prompt() chain so a
  // vendor record can hold everything (contact, trade, rates, availability,
  // account #, notes). Handles both create and edit.
  function openVendorForm(existing) {
    if (!NX?.sb) return;
    const v = existing || {};
    const isEdit = !!(existing && existing.id);

    if (!document.getElementById('nxvf-style')) {
      const st = document.createElement('style');
      st.id = 'nxvf-style';
      st.textContent =
        '.nxvf-field{display:block;margin-bottom:11px}' +
        '.nxvf-label{display:block;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin-bottom:5px}' +
        '.nxvf-input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2,var(--surface));color:var(--text);font-family:inherit;font-size:15px}' +
        '.nxvf-input:focus{outline:none;border-color:var(--nx-gold)}';
      document.head.appendChild(st);
    }

    const fld = (label, id, value, type, ph) =>
      `<label class="nxvf-field"><span class="nxvf-label">${label}</span>` +
      `<input class="nxvf-input" id="${id}" type="${type || 'text'}" value="${value != null ? esc(String(value)) : ''}" placeholder="${ph || ''}"` +
      `${type === 'number' ? ' inputmode="decimal" step="any" min="0"' : ''}></label>`;

    const overlay = document.createElement('div');
    overlay.className = 'nxrm-vendor-form-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9200;display:flex;align-items:flex-end;justify-content:center';
    overlay.innerHTML = `
      <div class="nxvf-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.5)"></div>
      <div class="nxvf-sheet" style="position:relative;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;background:var(--surface);border:1px solid var(--nx-gold-line);border-radius:16px 16px 0 0;padding:20px 18px 28px">
        <div style="font-size:18px;font-weight:700;margin-bottom:14px">${isEdit ? 'Edit vendor' : 'New vendor'}</div>
        ${fld('Company *', 'vfCompany', v.company || v.name, 'text', 'e.g. Austin Air and Ice')}
        ${fld('Contact name', 'vfContact', v.contact_name, 'text', 'Person you call')}
        <label class="nxvf-field"><span class="nxvf-label">Trade / category</span>
          <input class="nxvf-input" id="vfCategory" list="vfTrades" value="${v.category != null ? esc(v.category) : ''}" placeholder="HVAC, Refrigeration…">
          <datalist id="vfTrades">${TRADES.map(t => `<option value="${t}">`).join('')}</datalist>
        </label>
        ${fld('Phone', 'vfPhone', v.phone, 'tel', '512-…')}
        ${fld('Email', 'vfEmail', v.email, 'email', 'name@company.com')}
        ${fld('Website', 'vfWebsite', v.website, 'text', 'company.com')}
        ${fld('Address', 'vfAddress', v.address, 'text', 'Shop / dispatch address')}
        ${fld('Account #', 'vfAccount', v.account_number, 'text', 'Our account number')}
        ${fld('Hours / availability', 'vfHours', v.hours, 'text', 'Mon–Fri 7–5, 24h emergency')}
        <div style="display:flex;gap:10px">
          <div style="flex:1">${fld('Hourly rate ($)', 'vfRate', v.hourly_rate, 'number', '0')}</div>
          <div style="flex:1">${fld('Trip charge ($)', 'vfTrip', v.trip_charge, 'number', '0')}</div>
        </div>
        <label style="display:flex;align-items:center;gap:10px;padding:10px 0;cursor:pointer">
          <input type="checkbox" id="vfPreferred" ${v.is_preferred ? 'checked' : ''}> <span>⭐ Preferred vendor</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;padding:0 0 10px;cursor:pointer">
          <input type="checkbox" id="vfEmergency" ${v.is_emergency ? 'checked' : ''}> <span>24-hour emergency availability</span>
        </label>
        <label class="nxvf-field"><span class="nxvf-label">Notes</span>
          <textarea class="nxvf-input" id="vfNotes" rows="3" placeholder="Anything worth remembering">${v.notes != null ? esc(v.notes) : ''}</textarea>
        </label>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="vfCancel" style="flex:1;padding:13px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--text);font-family:inherit;cursor:pointer">Cancel</button>
          <button id="vfSave" style="flex:2;padding:13px;border-radius:10px;border:none;background:var(--nx-gold);color:#000;font-weight:700;font-family:inherit;cursor:pointer">${isEdit ? 'Save changes' : 'Create vendor'}</button>
        </div>
      </div>`;

    const close = () => overlay.remove();
    overlay.querySelector('.nxvf-backdrop').addEventListener('click', close);
    overlay.querySelector('#vfCancel').addEventListener('click', close);

    overlay.querySelector('#vfSave').addEventListener('click', async () => {
      const val = id => (overlay.querySelector('#' + id)?.value || '').trim();
      const num = id => { const n = parseFloat(val(id)); return isNaN(n) ? null : n; };
      const company = val('vfCompany');
      if (!company) { alert('Company name is required.'); return; }
      const payload = {
        company, name: company,
        contact_name: val('vfContact') || null,
        category: val('vfCategory') || null,
        phone: val('vfPhone') || null,
        email: val('vfEmail') || null,
        website: val('vfWebsite') || null,
        address: val('vfAddress') || null,
        account_number: val('vfAccount') || null,
        hours: val('vfHours') || null,
        hourly_rate: num('vfRate'),
        trip_charge: num('vfTrip'),
        is_preferred: overlay.querySelector('#vfPreferred').checked,
        is_emergency: overlay.querySelector('#vfEmergency').checked,
        notes: val('vfNotes') || null,
        updated_at: new Date().toISOString(),
      };
      const saveBtn = overlay.querySelector('#vfSave');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        if (isEdit) {
          const { error } = await NX.sb.from('vendors').update(payload).eq('id', existing.id);
          if (error) throw error;
        } else {
          payload.active = true;
          const { error } = await NX.sb.from('vendors').insert(payload);
          if (error) throw error;
        }
        close();
        state.activeVendor = null;
        await loadVendors();
      } catch (e) {
        alert('Failed: ' + (e.message || e));
        saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Save changes' : 'Create vendor';
      }
    });

    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('#vfCompany')?.focus(), 50);
  }

  async function promptNewVendor() { openVendorForm(null); }
  async function promptEditVendor(v) { openVendorForm(v); }

  // ─────────────────────────────────────────────────────────────────────
  // SCHEDULE PM — vendor-side mirror of the equipment scheduler.
  // The vendor is known (this profile); the user picks the EQUIPMENT and up
  // to 3 phase dates. Insert shape, cancel-and-reinsert strategy, title
  // synthesis, and equipment sync all match openScheduleEditor in
  // equipment.js so a PM created here is identical to one created there.
  // ─────────────────────────────────────────────────────────────────────
  async function openVendorPmScheduler(vendor) {
    if (!NX?.sb) return;
    const vName = vendor.company || vendor.name || 'this vendor';
    const vPhone = vendor.phone || '';

    if (!document.getElementById('nxvf-style')) {
      const st = document.createElement('style');
      st.id = 'nxvf-style';
      st.textContent =
        '.nxvf-field{display:block;margin-bottom:11px}' +
        '.nxvf-label{display:block;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin-bottom:5px}' +
        '.nxvf-input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2,var(--surface));color:var(--text);font-family:inherit;font-size:15px}' +
        '.nxvf-input:focus{outline:none;border-color:var(--nx-gold)}';
      document.head.appendChild(st);
    }

    // Equipment for the picker. select('*') tolerates schema gaps; filter
    // archived client-side (bulletproof pattern).
    let allEquip = [];
    try {
      const { data } = await NX.sb.from('equipment').select('*');
      allEquip = (data || [])
        .filter(e => e.archived !== true)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    } catch (_) {}

    let selectedId = null, selectedName = '', search = '';
    let phases = [{ date: '', label: '' }];

    const overlay = document.createElement('div');
    overlay.className = 'nxrm-vendor-form-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9200;display:flex;align-items:flex-end;justify-content:center';

    const applyFilter = () => {
      const q = search.trim().toLowerCase();
      overlay.querySelectorAll('[data-eq]').forEach(b => {
        const hay = (b.getAttribute('data-hay') || '').toLowerCase();
        b.style.display = (!q || hay.includes(q)) ? 'flex' : 'none';
      });
    };

    const draw = () => {
      const eqRows = allEquip.map(e => {
        const meta = [e.location, e.category].filter(Boolean).join(' · ') || '—';
        const sel = selectedId === e.id;
        return `<button type="button" class="vpm-eq-row" data-eq="${esc(e.id)}" data-name="${esc(e.name || '')}" data-hay="${esc((e.name || '') + ' ' + meta)}"
          style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:10px 12px;border-radius:9px;border:1px solid ${sel ? 'var(--nx-gold)' : 'var(--border)'};background:${sel ? 'var(--nx-gold-faint)' : 'var(--surface-2,var(--surface))'};color:var(--text);font-family:inherit;cursor:pointer;margin-bottom:6px">
          <span style="font-weight:600;font-size:14px">${esc(e.name || 'Unnamed')}</span>
          <span style="font-size:11px;color:var(--muted)">${esc(meta)}</span>
        </button>`;
      }).join('') || '<div style="padding:14px;color:var(--muted);font-size:13px">No equipment found.</div>';

      const phaseRows = phases.map((p, i) => `
        <div style="margin-bottom:8px;padding:10px;border:1px solid var(--border);border-radius:9px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)">Phase ${i + 1}</span>
            ${phases.length > 1 ? `<button type="button" data-delphase="${i}" style="border:none;background:none;color:var(--muted);font-size:20px;line-height:1;cursor:pointer">×</button>` : ''}
          </div>
          <input class="nxvf-input" type="date" data-pdate="${i}" value="${esc(p.date)}" style="margin-bottom:6px">
          <input class="nxvf-input" type="text" data-plabel="${i}" value="${esc(p.label)}" placeholder="Phase label (optional) — e.g. Coil clean" maxlength="50">
        </div>`).join('');

      overlay.innerHTML = `
        <div class="nxvf-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.5)"></div>
        <div class="nxvf-sheet" style="position:relative;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;background:var(--surface);border:1px solid var(--nx-gold-line);border-radius:16px 16px 0 0;padding:20px 18px 28px">
          <div style="font-size:18px;font-weight:700;margin-bottom:2px">Schedule PM</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:14px">with ${esc(vName)}</div>

          <div class="nxvf-label">Equipment${selectedId ? ' · <span style="color:var(--nx-gold);text-transform:none;letter-spacing:0">' + esc(selectedName) + '</span>' : ''}</div>
          <input class="nxvf-input" id="vpmSearch" value="${esc(search)}" placeholder="Search equipment by name, location…" autocomplete="off" style="margin-bottom:8px">
          <div style="max-height:240px;overflow-y:auto;margin-bottom:16px">${eqRows}</div>

          <div class="nxvf-label">Phases <span style="text-transform:none;letter-spacing:0;opacity:.6">${phases.length}/3 — most PMs are 1 visit</span></div>
          ${phaseRows}
          ${phases.length < 3 ? `<button type="button" id="vpmAddPhase" style="width:100%;padding:10px;border-radius:9px;border:1px dashed var(--border);background:none;color:var(--text);font-family:inherit;cursor:pointer;margin-bottom:8px">+ Add phase</button>` : ''}

          <div style="display:flex;gap:10px;margin-top:12px">
            <button id="vpmCancel" style="flex:1;padding:13px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--text);font-family:inherit;cursor:pointer">Cancel</button>
            <button id="vpmSave" style="flex:2;padding:13px;border-radius:10px;border:none;background:var(--nx-gold);color:#000;font-weight:700;font-family:inherit;cursor:pointer">Save schedule</button>
          </div>
        </div>`;

      overlay.querySelector('.nxvf-backdrop').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#vpmCancel').addEventListener('click', () => overlay.remove());
      const si = overlay.querySelector('#vpmSearch');
      si.addEventListener('input', () => { search = si.value; applyFilter(); });
      overlay.querySelectorAll('[data-eq]').forEach(b => b.addEventListener('click', () => {
        selectedId = b.dataset.eq; selectedName = b.dataset.name; draw();
      }));
      overlay.querySelectorAll('[data-pdate]').forEach(inp => inp.addEventListener('input', e => { phases[+e.target.dataset.pdate].date = e.target.value; }));
      overlay.querySelectorAll('[data-plabel]').forEach(inp => inp.addEventListener('input', e => { phases[+e.target.dataset.plabel].label = e.target.value; }));
      overlay.querySelectorAll('[data-delphase]').forEach(b => b.addEventListener('click', () => { phases.splice(+b.dataset.delphase, 1); draw(); }));
      const addP = overlay.querySelector('#vpmAddPhase');
      if (addP) addP.addEventListener('click', () => { if (phases.length < 3) { phases.push({ date: '', label: '' }); draw(); } });
      overlay.querySelector('#vpmSave').addEventListener('click', save);
      applyFilter();
    };

    async function save() {
      if (!selectedId) { alert('Pick an equipment first.'); return; }
      const valid = phases.filter(p => p.date && p.date.trim());
      if (!valid.length) { alert('At least one phase date is required.'); return; }
      for (let i = 1; i < valid.length; i++) {
        if (valid[i].date < valid[i - 1].date) {
          if (!confirm(`Phase ${i + 1} (${valid[i].date}) is before Phase ${i} (${valid[i - 1].date}). Save anyway?`)) return;
          break;
        }
      }
      const saveBtn = overlay.querySelector('#vpmSave');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        // Cancel this equipment's existing scheduled rows (keep history), then
        // insert fresh — single source of truth per equipment, same as the
        // equipment-side scheduler.
        const { data: existing } = await NX.sb.from('pm_schedules')
          .select('id').eq('equipment_id', selectedId).eq('status', 'scheduled');
        const rescheduleCount = (existing && existing.length) ? 1 : 0;
        if (existing && existing.length) {
          await NX.sb.from('pm_schedules').update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('equipment_id', selectedId).eq('status', 'scheduled');
        }
        const rows = valid.map((p, i) => ({
          equipment_id: selectedId,
          vendor_id: vendor.id,
          contractor_node_id: null,
          contractor_name: vName,
          scheduled_date: p.date,
          phase: i + 1,
          phase_label: p.label.trim() || null,
          title: p.label.trim() || (valid.length > 1 ? `PM Phase ${i + 1} — ${vName}` : `PM — ${vName}`),
          status: 'scheduled',
          reschedule_count: rescheduleCount,
        }));
        const { error } = await NX.sb.from('pm_schedules').insert(rows);
        if (error) throw error;

        // Sync the equipment row (best-effort, with generic column-missing recovery).
        try {
          const earliest = valid[0].date;
          const eqUpdate = {
            next_pm_date: earliest,
            service_vendor_id: vendor.id,
            service_contractor_node_id: null,
            service_contractor_name: vName,
            service_contractor_phone: vPhone || null,
          };
          const { data: priorEq } = await NX.sb.from('equipment').select('last_pm_date').eq('id', selectedId).maybeSingle();
          if (priorEq?.last_pm_date) {
            const days = Math.round((new Date(earliest) - new Date(priorEq.last_pm_date)) / 86400000);
            if (days > 0 && days <= 3650) eqUpdate.pm_interval_days = days;
          }
          let attempt = { ...eqUpdate };
          let r = await NX.sb.from('equipment').update(attempt).eq('id', selectedId);
          let guard = 0;
          while (r.error && guard < 6) {
            const m = /column "?([a-z_]+)"?.*does not exist/i.exec(r.error.message || '');
            if (!m || !(m[1] in attempt)) break;
            delete attempt[m[1]];
            r = await NX.sb.from('equipment').update(attempt).eq('id', selectedId);
            guard++;
          }
        } catch (_) {}

        overlay.remove();
        if (NX.toast) NX.toast(`PM scheduled with ${vName}`, 'success', 2000);
        // Refresh the vendor detail so the new PM appears in Scheduled PMs.
        state.activeVendor = vendor;
        render();
      } catch (e) {
        alert('Failed: ' + (e.message || e));
        saveBtn.disabled = false; saveBtn.textContent = 'Save schedule';
      }
    }

    draw();
    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('#vpmSearch')?.focus(), 50);
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
