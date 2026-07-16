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
    perfStale:     false,
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
      // supabase-js RESOLVES with {error} — a failed perf read does NOT throw,
      // it hands back {data:null,error}. If we blindly `perf || []` that, every
      // vendor renders as "New / no history" and the whole scorecard silently
      // lies. So destructure {data,error} from each result and check both.
      const [vRes, pRes] = await Promise.all([
        NX.sb.from('vendors').select('*').eq('active', true).order('company'),
        NX.sb.from('v_vendor_performance').select('*'),
      ]);
      if (vRes.error) throw vRes.error;              // vendor list is load-bearing
      state.vendors = vRes.data || [];
      if (pRes.error) {
        console.warn('[vendors] performance read failed', pRes.error);
        state.perfRows = [];
        state.perfStale = true;                       // grades unavailable, not zero
      } else {
        state.perfRows = pRes.data || [];
        state.perfStale = false;
      }
    } catch (e) {
      console.warn('[vendors] load failed', e);
      state.perfStale = true;
      try {
        const { data, error } = await NX.sb.from('vendors').select('*').eq('active', true);
        if (error) throw error;
        state.vendors = data || [];
        state.perfRows = [];
      } catch (_) {}
    }
    applyFilters();
    render();
    // Backfill any missing phone/email from contractor nodes + equipment
    // (Public-PM / Report-Issues already hold this contact). Cheap no-op
    // once every vendor has contact; re-renders only if it filled something.
    reconcileVendorContacts().then(n => { if (n) { applyFilters(); render(); } }).catch(() => {});
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
    ensurePicStyle();
    backfillContractorsToVendors(); // one-time, flag-guarded, fire-and-forget
    const view = NXRM.view.ensure('vendorsView', 'vendors');
    if (state.activeVendor) return renderDetail(view, state.activeVendor);

    const f = state.filter;
    const merged = mergeData();
    const cats = ['all', ...new Set(merged.map(v => v.category).filter(Boolean))];
    const pref = merged.filter(v => v.is_preferred).length;
    const emerg = merged.filter(v => v.is_emergency).length;
    const totalSpend = merged.reduce((s, v) => s + v.total_spend, 0);

    // Freshness + reliability of the performance layer. `asOf` = the most
    // recent job any vendor was touched (max last_job_at across perf rows).
    // `perfUnavailable` = the read errored (perfStale) OR came back empty; in
    // either case the A-F scorecards would be fabricated from all-zeros, so we
    // surface a banner instead of silently grading everyone "New".
    const asOf = state.perfRows.reduce((mx, p) => {
      const d = p && p.last_job_at;
      if (!d) return mx;
      return (!mx || new Date(d) > new Date(mx)) ? d : mx;
    }, null);
    const perfUnavailable = state.perfStale || state.perfRows.length === 0;

    view.innerHTML = `
      <div class="nxrm-page">
        <div class="nxrm-masthead">
          <div>
            <div class="nxrm-eyebrow">CONTRACTORS &amp; TRADES</div>
            <h1 class="nxrm-h1">Vendors</h1>
            ${asOf ? `<div class="nxrm-masthead-asof" style="margin-top:2px;font-size:12px;color:var(--nx-faint,#9a9081)">Performance as of ${esc(fmt.date(asOf))}</div>` : ''}
          </div>
          <div style="display:flex;gap:8px;flex:0 0 auto">
            <button class="nxrm-btn-pill" data-act="resq-export"
                    title="Export every active vendor as one CSV for ResQ onboarding — hand it to the CSM once instead of emailing vendors in one at a time"
                    style="background:none;color:var(--nx-gold,#d4a44e)">→ ResQ</button>
            <button class="nxrm-btn-pill" data-act="new-vendor">+ New</button>
          </div>
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

        ${perfUnavailable ? `
        <div class="nxrm-perf-banner" role="status"
             style="display:flex;align-items:flex-start;gap:8px;margin:0 0 14px;padding:11px 14px;border:1px solid var(--nx-gold-line,rgba(212,164,78,.4));border-radius:12px;background:rgba(212,164,78,.08);color:var(--nx-text,#f3ede1);font-size:13px;line-height:1.45">
          <span aria-hidden="true" style="color:var(--nx-gold,#d4a44e);font-weight:700">⚠</span>
          <span><strong style="color:var(--nx-gold,#d4a44e)">Performance view unavailable</strong> — showing directory only; grades hidden.</span>
        </div>` : ''}

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

        <div class="nxrm-vendor-list" style="padding:0">${renderCards()}</div>
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
    const DOTS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
    return state.filtered.map(v => {
      const name = v.company || v.name || 'Unnamed';
      const jobs = v.total_jobs || 0;
      let preview;
      if (jobs > 0) {
        preview = `${jobs} job${jobs === 1 ? '' : 's'} · ${fmt.money(v.total_spend)}` + (v.last_job_at ? ` · last ${fmt.sinceWords(v.last_job_at)}` : '');
      } else {
        preview = v.phone || v.email || 'No contact on file';
      }
      const noContact = !v.phone && !v.email;
      return `
        <div class="ord-vendor-row-wrap">
          <button class="ord-vendor-row" data-vendor-id="${esc(v.id)}" data-vendor-name="${esc(name.toLowerCase())}">
            <div class="ord-vendor-avatar-wrap">
              ${vendorAvatarCircle(v, '')}
              ${v.is_preferred ? '<span class="ord-vendor-pin" title="Preferred vendor">★</span>' : ''}
            </div>
            <div class="ord-vendor-main">
              <div class="ord-vendor-name-row">
                <div class="ord-vendor-name">${esc(name)}</div>
                ${v.category ? `<div class="ord-vendor-when">${esc(v.category)}</div>` : ''}
              </div>
              <div class="ord-vendor-meta">
                <span class="ord-vendor-preview">${esc(preview)}</span>
              </div>
            </div>
            ${noContact ? '<span class="ord-vendor-warn" title="No phone or email on file">!</span>' : ''}
            <div class="ord-arrow" aria-hidden="true">›</div>
          </button>
          <button class="ord-vendor-menu" data-vendor-menu="${esc(v.id)}" aria-label="More options for ${esc(name)}">${DOTS}</button>
        </div>`;
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
    view.querySelectorAll('.ord-vendor-row[data-vendor-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-vendor-id');
        const v = state.filtered.find(x => String(x.id) === String(id)) || mergeData().find(x => String(x.id) === String(id));
        if (v) { state.activeVendor = v; state._detailCache = null; render(); }
      });
    });
    view.querySelectorAll('[data-vendor-menu]').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-vendor-menu');
        const v = state.filtered.find(x => String(x.id) === String(id)) || mergeData().find(x => String(x.id) === String(id));
        if (v) openVendorRowMenu(v);
      });
    });
    const newBtn = view.querySelector('[data-act="new-vendor"]');
    if (newBtn) newBtn.addEventListener('click', promptNewVendor);
    const resqBtn = view.querySelector('[data-act="resq-export"]');
    if (resqBtn) resqBtn.addEventListener('click', exportVendorsToResQ);
  }

  // Compact action sheet opened from a vendor row's ⋮ kebab. Mirrors the
  // quick actions available inside the detail view so common tasks (call,
  // schedule a PM, log a service visit) don't require opening the profile.
  function openVendorRowMenu(v) {
    if (!v) return;
    document.querySelectorAll('.nxrm-vmenu-overlay').forEach(n => n.remove());
    const name = v.company || v.name || 'Vendor';
    const ov = document.createElement('div');
    ov.className = 'nxrm-vmenu-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9300;display:flex;align-items:flex-end;justify-content:center';
    const item = (label, act) =>
      `<button data-vm="${act}" style="display:block;width:100%;text-align:left;padding:15px 18px;border:none;border-top:1px solid var(--nx-line,rgba(255,255,255,.07));background:none;color:var(--nx-text,#f3ede1);font:inherit;font-size:15px;cursor:pointer">${label}</button>`;
    ov.innerHTML =
      '<div class="nxrm-vmenu-bd" style="position:absolute;inset:0;background:rgba(0,0,0,.55)"></div>' +
      '<div style="position:relative;width:100%;max-width:520px;background:var(--nx-surface-solid,#1b1b24);border:1px solid var(--nx-gold-line,rgba(212,164,78,.4));border-bottom:none;border-radius:18px 18px 0 0;overflow:hidden;padding-bottom:env(safe-area-inset-bottom)">' +
        `<div style="padding:16px 18px 12px;font-weight:700;font-size:15px;color:var(--nx-text,#f3ede1)">${esc(name)}</div>` +
        item('Open profile', 'open') +
        item('Edit vendor', 'edit') +
        (v.phone ? item('Call', 'call') : '') +
        (v.phone ? item('Text', 'text') : '') +
        item('Schedule PM', 'pm') +
        item('Log service', 'log') +
        item('Copy for ResQ', 'resq') +
        '<button data-vm="delete" style="display:block;width:100%;text-align:left;padding:15px 18px;border:none;border-top:1px solid var(--nx-line,rgba(255,255,255,.07));background:none;color:var(--nx-red,#a83e3e);font:inherit;font-size:15px;cursor:pointer">Delete vendor</button>' +
        '<button data-vm="cancel" style="display:block;width:100%;text-align:center;padding:15px 18px;border:none;border-top:1px solid var(--nx-line,rgba(255,255,255,.07));background:none;color:var(--nx-faint,#9a9081);font:inherit;font-size:15px;cursor:pointer">Cancel</button>' +
      '</div>';
    const close = () => ov.remove();
    ov.querySelector('.nxrm-vmenu-bd').addEventListener('click', close);
    ov.querySelectorAll('[data-vm]').forEach(b => b.addEventListener('click', () => {
      const act = b.getAttribute('data-vm');
      close();
      if (act === 'open') { state.activeVendor = v; state._detailCache = null; render(); }
      else if (act === 'edit') promptEditVendor(v);
      else if (act === 'call' && v.phone) { stampVendorContact(v.id); window.location.href = 'tel:' + String(v.phone).replace(/[^\d+]/g, ''); }
      else if (act === 'text' && v.phone) { stampVendorContact(v.id); window.location.href = 'sms:' + String(v.phone).replace(/[^\d+]/g, ''); }
      else if (act === 'pm') openVendorPmScheduler(v);
      else if (act === 'log') openVendorServiceLogger(v);
      else if (act === 'resq') copyVendorResQPacket(v);
      else if (act === 'delete') deleteVendor(v);
    }));
    document.body.appendChild(ov);
  }

  // Soft-delete a vendor: the app filters every list on active=true, and
  // equipment rows hold FK references (service_vendor_id / repair_vendor_id),
  // so we deactivate rather than hard-delete (a hard delete would orphan
  // equipment + PM rows or be rejected by the FK constraint). Equipment is
  // unassigned so detail views don't point at a hidden vendor. Service
  // history (equipment_maintenance) is matched by name and is left intact.
  async function deleteVendor(v) {
    if (!v || !NX?.sb) return;
    const nm = v.company || v.name || 'this vendor';
    if (!confirm(`Delete ${nm}?\n\nRemoves them from your vendor list and unassigns them from any equipment. Past service history is kept.`)) return;
    try {
      await saveVendorPatch(v.id, { active: false });
      try { await NX.sb.from('equipment').update({ service_vendor_id: null }).eq('service_vendor_id', v.id); } catch (_) {}
      try { await NX.sb.from('equipment').update({ repair_vendor_id: null }).eq('repair_vendor_id', v.id); } catch (_) {}
      if (state.activeVendor && String(state.activeVendor.id) === String(v.id)) {
        state.activeVendor = null; state._detailCache = null;
      }
      NX.toast && NX.toast(`${nm} deleted`, 'success', 1800);
      await loadVendors();
    } catch (e) {
      console.error('[deleteVendor]', e);
      NX.toast && NX.toast('Delete failed — try again', 'error', 2200);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // §2 — DETAIL VIEW
  // ─────────────────────────────────────────────────────────────────────

  async function renderDetail(view, vendor) {
    ensurePicStyle();
    const vid = String(vendor.id);
    const nameLower = (vendor.company || vendor.name || '').toLowerCase().trim();
    if (state.detailLocation === undefined) {
      try { state.detailLocation = localStorage.getItem('nexus.vendors.detailLocation') || 'all'; }
      catch (_) { state.detailLocation = 'all'; }
    }

    // Raw data, cached per vendor so the location pills re-filter instantly
    // (no refetch). Cache is invalidated by mutations (assign / unassign / PM).
    let cache = state._detailCache;
    if (!cache || cache.vendorId !== vid) {
      const out = { vendorId: vid, issues: [], pms: [], allEquip: [], maint: [] };
      if (NX?.sb) {
        try {
          const { data } = await NX.sb.from('v_issue_summary').select('*')
            .eq('vendor_id', vendor.id).order('reported_at', { ascending: false }).limit(80);
          out.issues = data || [];
        } catch (_) {}
        try {
          const { data } = await NX.sb.from('pm_schedules').select('*').eq('vendor_id', vendor.id);
          out.pms = (data || []).filter(p => (p.status || '') !== 'cancelled')
            .sort((a, b) => String(a.scheduled_date || '').localeCompare(String(b.scheduled_date || '')));
        } catch (_) {}
        try {
          const { data } = await NX.sb.from('equipment').select('*');
          out.allEquip = (data || []).filter(e => e.archived !== true);
        } catch (_) {}
        try {
          const since = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
          const { data } = await NX.sb.from('equipment_maintenance')
            .select('id, equipment_id, event_date, event_type, description, performed_by, cost')
            .gte('event_date', since);
          out.maint = data || [];
        } catch (_) {
          try { const { data } = await NX.sb.from('equipment_maintenance').select('equipment_id, performed_by, event_date'); out.maint = data || []; } catch (_2) {}
        }
        // Open work orders for this vendor's equipment — pulled live from the
        // Board module (cross-module read). One call per serviced unit; cached
        // so the location pills don't re-query.
        out.workOrders = [];
        try {
          const sids = [...new Set(out.allEquip
            .filter(e => String(e.service_vendor_id || '') === vid || String(e.repair_vendor_id || '') === vid)
            .map(e => e.id))];
          const board = (window.NX && NX.modules && NX.modules.board) || null;
          if (sids.length && board && typeof board.getOpenCardsForEquipment === 'function') {
            const eqById = new Map(out.allEquip.map(e => [String(e.id), e]));
            for (const id of sids) {
              let cards = [];
              try { cards = await board.getOpenCardsForEquipment(id); } catch (_) {}
              (cards || []).forEach(c => {
                const eq = eqById.get(String(id)) || {};
                c._eqName = eq.name || '';
                c._eqLoc = eq.location || '';
                out.workOrders.push(c);
              });
            }
          }
        } catch (_) {}
      }
      cache = out;
      state._detailCache = cache;
    }

    const { issues: allIssues, pms: allPms, allEquip, maint } = cache;
    const eqMap = new Map(allEquip.map(e => [String(e.id), { name: e.name, location: e.location }]));
    allPms.forEach(p => {
      const m = eqMap.get(String(p.equipment_id));
      p._eqName = (m && m.name) || p.title || 'Equipment';
      p._eqLoc = (m && m.location) || '';
    });

    // Assigned (per role) + previously-serviced (historical).
    let servicedEquip = allEquip
      .filter(e => String(e.service_vendor_id || '') === vid || String(e.repair_vendor_id || '') === vid)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    servicedEquip.forEach(e => {
      e._isPm = String(e.service_vendor_id || '') === vid;
      e._isRepair = String(e.repair_vendor_id || '') === vid;
    });
    const assignedIds = new Set(servicedEquip.map(e => e.id));
    const myMaint = maint.filter(m => {
      const pb = (m.performed_by || '').toLowerCase().trim();
      return nameLower && pb && (pb.includes(nameLower) || nameLower.includes(pb));
    });
    const servicedIds = new Set(myMaint.map(m => m.equipment_id));
    let historicalEquip = allEquip
      .filter(e => servicedIds.has(e.id) && !assignedIds.has(e.id))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    // Activity feed = matched maintenance events + issues, newest first.
    let activity = [];
    myMaint.forEach(m => {
      const eq = eqMap.get(String(m.equipment_id)) || {};
      activity.push({
        type: 'maintenance', date: m.event_date,
        title: m.event_type ? String(m.event_type).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Service',
        cost: parseFloat(m.cost) || 0,
        eqId: m.equipment_id, eqName: eq.name || '(equipment removed)', eqLoc: eq.location || '',
        desc: m.description || '',
      });
    });
    allIssues.forEach(i => {
      activity.push({
        type: 'issue', date: i.reported_at,
        title: i.title || 'Issue', cost: parseFloat(i.invoice_amount) || 0,
        eqId: i.equipment_id, eqName: i.equipment_name || '(equipment)', eqLoc: i.restaurant || '',
        status: i.status, desc: '',
      });
    });
    activity.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Open work orders (Board) — exclude closed/resolved.
    let workOrders = (cache.workOrders || []).filter(c => !/^(closed|resolved|done)$/i.test(c.status || ''));

    // Location scope — derive the set of restaurants this vendor actually
    // touches; show pills only when there's more than one.
    const locSet = new Set();
    servicedEquip.forEach(e => e.location && locSet.add(e.location));
    historicalEquip.forEach(e => e.location && locSet.add(e.location));
    activity.forEach(ev => ev.eqLoc && locSet.add(ev.eqLoc));
    allPms.forEach(p => p._eqLoc && locSet.add(p._eqLoc));
    workOrders.forEach(c => c._eqLoc && locSet.add(c._eqLoc));
    const LOCS = [...locSet].sort();
    let activeLoc = state.detailLocation || 'all';
    if (activeLoc !== 'all' && !LOCS.includes(activeLoc)) activeLoc = 'all';
    const showLocPills = LOCS.length >= 2;
    const inLoc = (loc) => activeLoc === 'all' || (loc || '') === activeLoc;
    if (activeLoc !== 'all') {
      servicedEquip = servicedEquip.filter(e => inLoc(e.location));
      historicalEquip = historicalEquip.filter(e => inLoc(e.location));
      activity = activity.filter(ev => inLoc(ev.eqLoc));
      workOrders = workOrders.filter(c => inLoc(c._eqLoc));
    }
    const pms = (activeLoc !== 'all') ? allPms.filter(p => inLoc(p._eqLoc)) : allPms;
    const locLabel = (l) => esc(String(l).replace(/^Bar\s+/i, ''));
    const grade = score.vendorGrade(vendor);

    view.innerHTML = `
      <div class="nxrm-page">
        <button class="nxrm-back" data-act="back-to-list">← Back to vendors</button>

        <div class="nxrm-vendor-header">
          ${vendorDetailAvatar(vendor, grade)}
          <div class="nxrm-vendor-headline">
            <div class="nxrm-eyebrow">${esc(vendor.category || 'VENDOR')}</div>
            <h1 class="nxrm-h1">${esc(vendor.company || vendor.name)}</h1>
            <div class="nxrm-vendor-tags">
              <span class="nxrm-grade-pill">${grade.letter}${grade.label ? ' · ' + esc(grade.label) : ''}</span>
              ${vendor.is_preferred ? '<span class="nxrm-vendor-badge is-pref">⭐ Preferred</span>' : ''}
            </div>
          </div>
        </div>

        <div class="nxrm-vendor-contact">
          ${vendor.phone ? `
            <a class="nxrm-vendor-action" href="tel:${esc(vendor.phone)}" data-act="contact-call">📞 Call</a>
            <a class="nxrm-vendor-action" href="sms:${esc(vendor.phone)}" data-act="contact-text">💬 Text</a>
          ` : ''}
          ${vendor.email ? `
            <button class="nxrm-vendor-action" data-act="contact-email" type="button">✉ Email</button>
          ` : ''}
          <button class="nxrm-vendor-action" data-act="edit-vendor">⚙ Edit</button>
          <button class="nxrm-vendor-action" data-act="copy-resq" type="button"
                  title="Copy this vendor's details, field-for-field what ResQ's invite form asks for">⧉ ResQ</button>
        </div>
        ${(Array.isArray(vendor.phones) && vendor.phones.length > 1) || (Array.isArray(vendor.emails) && vendor.emails.length > 1) ? `
        <div class="nxrm-extra-contacts">
          ${(Array.isArray(vendor.phones) ? vendor.phones.slice(1) : []).filter(p => p && p.value).map(p => `<a class="nxrm-extra-chip" href="tel:${esc(p.value)}" data-act="contact-call">📞 ${esc(p.label || p.value)}</a>`).join('')}
          ${(Array.isArray(vendor.emails) ? vendor.emails.slice(1) : []).filter(e => e && e.value).map(e => `<a class="nxrm-extra-chip" href="mailto:${esc(e.value)}" data-act="contact-email">✉ ${esc(e.label || e.value)}</a>`).join('')}
        </div>` : ''}
        ${vendor.last_contact_at ? `<div class="nxrm-last-contact">Last contacted ${esc(fmtLastContact(vendor.last_contact_at))}</div>` : ''}

        ${showLocPills ? `
        <div class="nxrm-loc-pills">
          <button class="nxrm-loc-pill ${activeLoc === 'all' ? 'is-active' : ''}" data-loc="all">All</button>
          ${LOCS.map(l => `<button class="nxrm-loc-pill ${activeLoc === l ? 'is-active' : ''}" data-loc="${esc(l)}">${locLabel(l)}</button>`).join('')}
        </div>` : ''}

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

        ${workOrders.length ? `
        <div class="nxrm-section">
          <div class="nxrm-section-title">Open work orders · ${workOrders.length}</div>
          <div class="nxrm-list">
            ${workOrders.map(c => {
              const pr = (c.priority || '').toLowerCase();
              const prCls = (pr === 'high' || pr === 'urgent') ? 'is-overdue' : '';
              return `
              <button class="nxrm-card" data-card-id="${esc(c.id)}">
                <div class="nxrm-card-row1">
                  <span class="nxrm-card-priority">${esc((c.status || 'open').toUpperCase().replace(/_/g, ' '))}</span>
                  ${pr ? `<span class="nxrm-card-age ${prCls}">${esc(pr)}</span>` : ''}
                </div>
                <div class="nxrm-card-title">${esc(c.title || 'Untitled')}</div>
                <div class="nxrm-card-row2"><span class="nxrm-card-eq">${esc(c._eqName || 'Equipment')}</span>${c._eqLoc ? `<span class="nxrm-sep">·</span><span class="nxrm-card-restaurant">${esc(c._eqLoc)}</span>` : ''}</div>
              </button>`;
            }).join('')}
          </div>
        </div>` : ''}

        <div class="nxrm-section">
          <div class="nxrm-section-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div class="nxrm-section-title">Activity${activeLoc !== 'all' ? ' · ' + locLabel(activeLoc) : ''} · ${activity.length}</div>
            <button class="nxrm-vendor-action" data-act="log-service" style="flex:0 0 auto;padding:7px 12px">+ Log service</button>
          </div>
          <div class="nxrm-list">
            ${activity.length ? (() => {
              const groups = {};
              activity.forEach(ev => {
                const d = new Date(ev.date);
                const key = isNaN(d) ? '0000-00' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (!groups[key]) groups[key] = { label: isNaN(d) ? 'Undated' : d.toLocaleDateString([], { month: 'long', year: 'numeric' }), events: [] };
                groups[key].events.push(ev);
              });
              return Object.keys(groups).sort().reverse().map(k => {
                const g = groups[k];
                return `<div class="nxrm-act-group"><div class="nxrm-act-month">${esc(g.label)}</div>` +
                  g.events.map(ev => {
                    const dt = new Date(ev.date);
                    const dstr = isNaN(dt) ? '—' : dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
                    const tone = ev.type === 'issue' ? 'is-issue' : 'is-maint';
                    const sub = [ev.eqName, ev.eqLoc].filter(Boolean).join(' · ');
                    const statusChip = (ev.type === 'issue' && ev.status) ? ` <span class="nxrm-act-status">${esc(String(ev.status).toUpperCase())}</span>` : '';
                    return `<button class="nxrm-act-row ${tone}" ${ev.eqId ? `data-equipment-id="${esc(ev.eqId)}"` : ''}>
                      <span class="nxrm-act-date">${esc(dstr)}</span>
                      <span class="nxrm-act-body">
                        <span class="nxrm-act-title">${esc(ev.title)}${ev.cost ? ' · ' + fmt.money(ev.cost) : ''}${statusChip}</span>
                        <span class="nxrm-act-eq">${esc(sub)}</span>
                        ${ev.desc ? `<span class="nxrm-act-desc">${esc(ev.desc)}</span>` : ''}
                      </span>
                    </button>`;
                  }).join('') + `</div>`;
              }).join('');
            })() : '<div class="nxrm-empty"><div class="nxrm-empty-body">No service calls or issues logged for this vendor yet.</div></div>'}
          </div>
        </div>

        <div class="nxrm-section">
          <div class="nxrm-section-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div class="nxrm-section-title">Equipment Serviced · ${servicedEquip.length}</div>
            <button class="nxrm-vendor-action" data-act="assign-equip" style="flex:0 0 auto;padding:7px 12px">+ Assign equipment</button>
          </div>
          <div class="nxrm-list">
            ${servicedEquip.length ? servicedEquip.map(e => {
              const meta = [e.location, e.category].filter(Boolean).join(' · ') || '—';
              const chips =
                (e._isPm ? '<span class="nxrm-role-chip is-pm">PM</span>' : '') +
                (e._isRepair ? '<span class="nxrm-role-chip is-repair">Repair</span>' : '');
              return `
              <div class="nxrm-vendor-eq-row">
                <button class="nxrm-card" data-equipment-id="${esc(e.id)}" style="flex:1;margin:0">
                  <div class="nxrm-card-title">${esc(e.name || 'Equipment')}${chips}</div>
                  <div class="nxrm-card-row2"><span class="nxrm-card-eq">${esc(meta)}</span></div>
                </button>
                <button class="nxrm-vendor-eq-unassign" data-unassign-eq="${esc(e.id)}" data-eq-name="${esc(e.name || 'this equipment')}" data-pm="${e._isPm ? 1 : 0}" data-repair="${e._isRepair ? 1 : 0}" title="Unassign from this vendor">×</button>
              </div>`;
            }).join('') : '<div class="nxrm-empty"><div class="nxrm-empty-body">No equipment assigned yet. Tap &ldquo;Assign equipment&rdquo; to set this vendor as the PM and/or repair provider for any unit.</div></div>'}
          </div>
          ${historicalEquip.length ? `
            <div class="nxrm-eq-sub-title">Previously serviced · ${historicalEquip.length}</div>
            <div class="nxrm-list">
              ${historicalEquip.map(e => {
                const meta = [e.location, e.category].filter(Boolean).join(' · ') || '—';
                return `
                <button class="nxrm-card" data-equipment-id="${esc(e.id)}" style="width:100%;margin-bottom:8px">
                  <div class="nxrm-card-title">${esc(e.name || 'Equipment')}</div>
                  <div class="nxrm-card-row2"><span class="nxrm-card-eq">${esc(meta)}</span><span class="nxrm-sep">·</span><span class="nxrm-card-restaurant">serviced before</span></div>
                </button>`;
              }).join('')}
            </div>
          ` : ''}
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
      state._detailCache = null;
      state.activeVendor = null; render();
    });
    view.querySelectorAll('.nxrm-loc-pill[data-loc]').forEach(btn => {
      btn.addEventListener('click', () => {
        const loc = btn.getAttribute('data-loc') || 'all';
        if (loc === state.detailLocation) return;
        state.detailLocation = loc;
        try { localStorage.setItem('nexus.vendors.detailLocation', loc); } catch (_) {}
        render(); // cache stays valid → instant re-filter, no refetch
      });
    });
    const editBtn = view.querySelector('[data-act="edit-vendor"]');
    if (editBtn) editBtn.addEventListener('click', () => promptEditVendor(vendor));
    const resqCopyBtn = view.querySelector('[data-act="copy-resq"]');
    if (resqCopyBtn) resqCopyBtn.addEventListener('click', () => copyVendorResQPacket(vendor));
    // Stamp last_contact_at whenever the user taps Call / Text.
    // No preventDefault, so the tel:/sms: link still fires.
    view.querySelectorAll('[data-act="contact-call"],[data-act="contact-text"]').forEach(el => {
      el.addEventListener('click', () => { stampVendorContact(vendor.id); });
    });
    // Email goes through the composer engine with the vendor's saved
    // template (tokens without context stay visible for manual fill).
    // Extra-chip mailto links keep their old behavior for specific addresses.
    view.querySelectorAll('button[data-act="contact-email"]').forEach(el => {
      el.addEventListener('click', () => {
        if (window.NX && typeof NX.vendorEmail === 'function') {
          NX.vendorEmail(vendor, { onSend: () => stampVendorContact(vendor.id) });
        } else {
          stampVendorContact(vendor.id);
          window.location.href = 'mailto:' + encodeURIComponent(vendor.email || '');
        }
      });
    });
    view.querySelectorAll('a[data-act="contact-email"]').forEach(el => {
      el.addEventListener('click', () => { stampVendorContact(vendor.id); });
    });
    const schedBtn = view.querySelector('[data-act="schedule-pm"]');
    if (schedBtn) schedBtn.addEventListener('click', () => openVendorPmScheduler(vendor));
    const assignBtn = view.querySelector('[data-act="assign-equip"]');
    if (assignBtn) assignBtn.addEventListener('click', () => openVendorEquipmentAssign(vendor));
    const logBtn = view.querySelector('[data-act="log-service"]');
    if (logBtn) logBtn.addEventListener('click', () => openVendorServiceLogger(vendor));
    const photoBtn = view.querySelector('[data-act="change-photo"]');
    if (photoBtn) photoBtn.addEventListener('click', async () => {
      const url = await pickVendorPhoto();
      if (url === null) return; // user cancelled the picker
      try {
        await saveVendorPatch(vendor.id, { image_url: url });
        vendor.image_url = url;   // instant feedback
        render();                 // re-render the detail with the new photo
        loadVendors();            // sync the list in the background
      } catch (e) { alert('Could not save photo: ' + (e.message || e)); }
    });
    view.querySelectorAll('[data-unassign-eq]').forEach(el => {
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const id = el.getAttribute('data-unassign-eq');
        const nm = el.getAttribute('data-eq-name') || 'this equipment';
        const vName = vendor.company || vendor.name;
        const isPm = el.getAttribute('data-pm') === '1';
        const isRepair = el.getAttribute('data-repair') === '1';
        if (!id) return;
        let clearPm = false, clearRepair = false;
        if (isPm && isRepair) {
          const choice = (prompt(
            'Unassign ' + nm + ' from ' + vName + '?\n\n' +
            'Linked for BOTH PM and Repair.\n\n' +
            'Type:\n  P = remove PM only\n  R = remove Repair only\n  B = remove Both\n\nOr cancel to keep both.',
            'B'
          ) || '').trim().toUpperCase();
          if (!choice) return;
          if (choice === 'P') clearPm = true;
          else if (choice === 'R') clearRepair = true;
          else if (choice === 'B') { clearPm = true; clearRepair = true; }
          else { NX.toast && NX.toast('Cancelled — type P, R, or B', 'info', 1800); return; }
        } else if (isPm) {
          if (!confirm('Remove ' + nm + ' from ' + vName + ' as the PM provider?')) return;
          clearPm = true;
        } else if (isRepair) {
          if (!confirm('Remove ' + nm + ' from ' + vName + ' as the repair provider?')) return;
          clearRepair = true;
        } else { return; }
        const patch = {};
        if (clearPm) { patch.service_vendor_id = null; patch.service_contractor_name = null; }
        if (clearRepair) { patch.repair_vendor_id = null; patch.repair_contractor_name = null; }
        try {
          await saveEquipPatch(id, patch);
          NX.toast && NX.toast(nm + ' unassigned', 'success', 1500);
          state._detailCache = null;
          render();
        } catch (e) { alert('Failed: ' + (e.message || e)); }
      });
    });
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

    // Open work orders → deep-link into the exact Board card (cross-module).
    view.querySelectorAll('[data-card-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-card-id');
        if (!id) return;
        const board = (window.NX && NX.modules && NX.modules.board) || null;
        if (board && typeof board.openCard === 'function') board.openCard(id);
        else if (NXRM && NXRM.view && NXRM.view.switchTo) NXRM.view.switchTo('board');
        else if (window.NX && typeof NX.switchTo === 'function') NX.switchTo('board');
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

  function buildEmailSubject(issue, equipment, vendor) {
    const restaurant = equipment?.location || issue.restaurant || '';
    const eqName = equipment?.name || issue.equipment_name || 'equipment';
    if (vendor?.dispatch_subject) {
      return vendor.dispatch_subject
        .replace(/{restaurant}/g, restaurant)
        .replace(/{equipment}/g, eqName)
        .replace(/{issue}/g, issue.title || '')
        .replace(/{priority}/g, issue.priority || 'normal')
        .replace(/{description}/g, issue.description || '');
    }
    const prefix = issue.priority === 'critical' ? '[URGENT] '
                 : issue.priority === 'high'     ? '[Priority] '
                 : '';
    return `${prefix}${restaurant}: ${eqName} — ${issue.title || 'repair needed'}`;
  }

  function buildEmailBody(issue, equipment, vendor, comments) {
    // Per-vendor template wins (SMS + subject already honored it; the email
    // body was the one surface that ignored it).
    if (vendor?.dispatch_template) {
      const tokens = {
        restaurant:  equipment?.location || issue.restaurant || '',
        equipment:   equipment?.name || issue.equipment_name || '',
        unit:        [equipment?.manufacturer, equipment?.model].filter(Boolean).join(' '),
        serial:      equipment?.serial_number || '',
        area:        equipment?.area || '',
        issue:       issue.title || '',
        priority:    issue.priority || 'normal',
        description: issue.description || '',
        user:        NX?.user?.name || NX?.currentUser?.name || '',
      };
      if (window.NX && typeof NX.renderVendorTemplate === 'function') {
        return NX.renderVendorTemplate(vendor.dispatch_template, tokens);
      }
      return vendor.dispatch_template.replace(/\{(\w+)\}/g, (m, k) => {
        const v = tokens[k.toLowerCase()];
        return (v == null || v === '') ? m : String(v);
      });
    }
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

  // Stamp last_contact_at when the user actually reaches out (call/text/email/
  // dispatch). Column-tolerant via saveVendorPatch: silently no-ops if the
  // migration hasn't been run yet.
  async function stampVendorContact(vendorId) {
    if (!vendorId) return;
    const now = new Date().toISOString();
    try {
      await saveVendorPatch(vendorId, { last_contact_at: now });
      const v = mergeData().find(x => String(x.id) === String(vendorId));
      if (v) v.last_contact_at = now;
    } catch (_) {}
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
    // Preferred path: the shared composer engine (NX.vendorEmail). Renders
    // the vendor's saved dispatch_subject / dispatch_template with real
    // values, opens the editable To/CC/BCC + body composer, and CCs the
    // vendor's extra addresses. Dispatch is logged when the user taps Send.
    if (window.NX && typeof NX.vendorEmail === 'function') {
      NX.vendorEmail(vendor, {
        restaurant:  equipment?.location || issue.restaurant || '',
        equipment:   equipment?.name || issue.equipment_name || '',
        unit:        [equipment?.manufacturer, equipment?.model].filter(Boolean).join(' '),
        serial:      equipment?.serial_number || '',
        area:        equipment?.area || '',
        issue:       issue.title || '',
        priority:    issue.priority || 'normal',
        description: issue.description || '',
        onSend: () => logDispatch(issue, vendor, 'email'),
      });
      return;
    }
    const subject = buildEmailSubject(issue, equipment, vendor);
    const body = buildEmailBody(issue, equipment, vendor, comments);
    // Legacy fallbacks: the Ordering email helper, then encoded mailto.
    if (window.NXEmail && typeof window.NXEmail.openVendorEmail === 'function') {
      window.NXEmail.openVendorEmail(vendor, subject, body);
    } else {
      const enc = s => encodeURIComponent(s).replace(/\+/g, '%20');
      window.location.href = 'mailto:' + encodeURIComponent(vendor.email)
        + '?subject=' + enc(subject) + '&body=' + enc(body);
    }
    logDispatch(issue, vendor, 'email');
  }

  async function logDispatch(issue, vendor, channel) {
    if (vendor && vendor.id) stampVendorContact(vendor.id);
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
        // Vendor called → the board card follows to In Progress.
        try { NX.domain?.syncIssueCardList?.(issue.id, 'contractor_called'); } catch (_) {}
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
  // PHOTO + AVATAR + ASSIGN-EQUIPMENT HELPERS
  // Photos are stored as small base64 JPEG data URLs in vendors.image_url,
  // exactly like the ordering module's order_vendors.image_url. The list +
  // detail show the photo when set, falling back to the A–F grade scorecard
  // (so the grade is never lost — it becomes a corner chip over a photo).
  // ─────────────────────────────────────────────────────────────────────

  function ensurePicStyle() {
    if (document.getElementById('nxrm-pic-style')) return;
    const st = document.createElement('style');
    st.id = 'nxrm-pic-style';
    st.textContent =
      '.nxrm-vendor-ava-img,.nxrm-vendor-ava-img-big{background-size:cover;background-position:center;position:relative;overflow:hidden}' +
      '.nxrm-vendor-ava-chip{position:absolute;right:-1px;bottom:-1px;min-width:15px;text-align:center;font-size:10px;font-weight:800;padding:1px 5px;border-radius:8px 0 0 0;background:rgba(0,0,0,.66);color:#fff;line-height:1.4;letter-spacing:0}' +
      '.nxrm-vendor-ava-chip-big{position:absolute;right:6px;bottom:6px;font-size:12px;font-weight:800;padding:2px 8px;border-radius:9px;background:rgba(0,0,0,.6);color:#fff;letter-spacing:0}' +
      'button.nxrm-vendor-grade-big{cursor:pointer;border:none;font-family:inherit;padding:0;position:relative}' +
      '.nxrm-vendor-eq-row{display:flex;align-items:stretch;gap:8px;margin-bottom:8px}' +
      '.nxrm-vendor-eq-unassign{flex:0 0 auto;width:44px;border:1px solid var(--border);border-radius:9px;background:none;color:var(--muted);font-size:22px;line-height:1;cursor:pointer}' +
      '.nxrm-vendor-eq-unassign:hover{border-color:#c44;color:#c44}' +
      '.nxrm-role-chip{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.3px;padding:1px 6px;border-radius:6px;vertical-align:middle;margin-left:6px}' +
      '.nxrm-role-chip.is-pm{background:var(--nx-gold-faint,rgba(212,164,78,.16));color:var(--nx-gold)}' +
      '.nxrm-role-chip.is-repair{background:rgba(108,123,208,.16);color:#6c7bd0}' +
      '.nxrm-eq-sub-title{margin:16px 0 8px;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)}' +
      '.vea-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2,var(--surface));margin-bottom:6px}' +
      '.vea-pm-detail{flex:0 0 100%;margin-top:2px;padding-top:8px;border-top:1px dashed var(--border)}' +
      '.vea-pm-detail .nxvf-label{margin-bottom:4px}' +
      '.vea-pm-detail .nxvf-row{display:flex;gap:8px}' +
      '.vea-pm-detail .nxvf-input{padding:8px 10px;font-size:13px}' +
      '.vea-row-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
      '.vea-state{font-size:10px;font-weight:800;letter-spacing:.3px;color:var(--nx-gold);text-transform:uppercase}' +
      '.vea-name{font-weight:600;font-size:14px}' +
      '.vea-meta{font-size:11px;color:var(--muted)}' +
      '.vea-toggles{flex:0 0 auto;display:flex;gap:6px}' +
      '.vea-toggle{padding:6px 11px;border-radius:8px;border:1px solid var(--border);background:none;color:var(--muted);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.vea-toggle.on{background:var(--nx-gold);color:#000;border-color:var(--nx-gold)}' +
      '.vea-toggle.on[data-toggle-pm]{background:var(--nx-gold);color:#000;border-color:var(--nx-gold)}' +
      '.vea-toggle.on[data-toggle-repair]{background:#6c7bd0;color:#fff;border-color:#6c7bd0}' +
      '.nxrm-loc-pills{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 14px}' +
      '.nxrm-loc-pill{padding:6px 13px;border-radius:999px;border:1px solid var(--border);background:none;color:var(--muted);font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.nxrm-loc-pill.is-active{background:var(--nx-gold);color:#000;border-color:var(--nx-gold)}' +
      '.nxrm-act-group{margin-bottom:8px}' +
      '.nxrm-act-month{font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin:8px 2px 6px}' +
      '.nxrm-act-row{display:flex;gap:10px;width:100%;text-align:left;padding:9px 10px;border-radius:9px;border:1px solid var(--border);border-left-width:3px;background:var(--surface-2,var(--surface));color:var(--text);font-family:inherit;cursor:pointer;margin-bottom:6px}' +
      '.nxrm-act-row.is-issue{border-left-color:#c98a3a}' +
      '.nxrm-act-row.is-maint{border-left-color:#6c7bd0}' +
      '.nxrm-act-date{flex:0 0 auto;width:42px;font-size:11px;color:var(--muted);padding-top:1px}' +
      '.nxrm-act-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
      '.nxrm-act-title{font-weight:600;font-size:13.5px}' +
      '.nxrm-act-status{font-size:9px;font-weight:800;letter-spacing:.3px;padding:1px 5px;border-radius:5px;background:rgba(0,0,0,.10);margin-left:4px;vertical-align:middle}' +
      '.nxrm-act-eq{font-size:11.5px;color:var(--muted)}' +
      '.nxrm-act-desc{font-size:11.5px;color:var(--muted);opacity:.85}' +
      '.nxrm-ava-wrap{position:relative;flex-shrink:0;display:inline-flex;align-self:center}' +
      '.nxrm-ava-btn{background:transparent;border:0;padding:0;cursor:pointer;border-radius:50%;-webkit-tap-highlight-color:transparent;transition:transform .12s}' +
      '.nxrm-ava-btn:active{transform:scale(.96)}' +
      '.ord-vendor-avatar.nxrm-ava-md{width:56px;height:56px;font-size:21px}' +
      '.ord-vendor-avatar.nxrm-ava-lg{width:80px;height:80px;font-size:31px}' +
      '.nxrm-ava-grade-dot{position:absolute;right:-3px;bottom:-3px;min-width:19px;height:19px;padding:0 4px;border-radius:10px;background:rgba(28,24,18,.82);color:#fff;font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;border:2px solid var(--surface,#faf6ef);line-height:1}' +
      '.nxrm-ava-cam{position:absolute;right:-2px;bottom:-2px;width:24px;height:24px;border-radius:50%;background:var(--nx-gold);color:#000;display:inline-flex;align-items:center;justify-content:center;border:2px solid var(--surface,#faf6ef);pointer-events:none}' +
      '.nxrm-grade-pill{display:inline-flex;align-items:center;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--nx-gold-faint,rgba(212,164,78,.16));color:var(--nx-gold)}' +
      '.nxrm-extra-contacts{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 4px}' +
      '.nxrm-extra-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;padding:5px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface-2,var(--surface));color:var(--text);text-decoration:none}' +
      '.nxrm-last-contact{font-size:11px;color:var(--muted);margin:2px 0 6px}' +
      /* List-redesign overflow guard: the shared .ord-vendor-row base sets
         width:calc(100% - 28px)+margins which, beside the 40px kebab, blew
         past the viewport and dragged the whole page out of bounds. Pin the
         row to flex/shrink within the list and clip any residual. */
      '.nxrm-vendor-list{overflow-x:hidden;max-width:100%}' +
      '.nxrm-vendor-list .ord-vendor-row-wrap{margin:0;width:100%;box-sizing:border-box}' +
      '.nxrm-vendor-list .ord-vendor-row{width:auto;margin:0;flex:1 1 auto;min-width:0;box-sizing:border-box}' +
      '.nxrm-vendor-list .ord-vendor-menu{flex:0 0 40px}';
    document.head.appendChild(st);
  }

  // Take a picked image File → centered, cover-fit square JPEG data URL,
  // small enough for TEXT storage. Ported from the ordering module.
  function downscaleImageToDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const sz = Math.min(img.width, img.height);
            const sx = (img.width - sz) / 2;
            const sy = (img.height - sz) / 2;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = maxDim;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, maxDim, maxDim);
            ctx.drawImage(img, sx, sy, sz, sz, 0, 0, maxDim, maxDim);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  }

  // Open the OS photo picker, return a downscaled data URL (or null if the
  // user cancels). Resolves null on cancel so callers can no-op cleanly.
  function pickVendorPhoto() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.style.display = 'none';
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0];
        inp.remove();
        if (!file) { resolve(null); return; }
        try { resolve(await downscaleImageToDataUrl(file, 320, 0.82)); }
        catch (e) { alert('Could not read image: ' + (e.message || e)); resolve(null); }
      });
      // Some mobile browsers need the input in the DOM before .click().
      document.body.appendChild(inp);
      inp.click();
    });
  }

  // Avatar markup. Photo when image_url is set (with the grade as a corner
  // chip); otherwise the existing grade square — unchanged for vendors
  // without a photo, so nothing regresses.
  // Deterministic hue from a string — matches the ordering module so a
  // vendor's initial-avatar color is stable and gold-adjacent.
  // Short relative phrasing for "last contacted" — today / Nd ago / a date.
  function fmtLastContact(iso) {
    if (!iso) return '';
    const then = new Date(iso);
    if (isNaN(then.getTime())) return '';
    const days = Math.floor((Date.now() - then.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    if (days < 30) { const w = Math.floor(days / 7); return w + (w === 1 ? ' week ago' : ' weeks ago'); }
    const sameYear = then.getFullYear() === new Date().getFullYear();
    return then.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function hashHue(str) {
    const clean = (str || '').trim();
    let h = 0;
    for (let i = 0; i < clean.length; i++) h = ((h << 5) - h + clean.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }

  // Circular avatar — identical to ordering's .ord-vendor-avatar. Photo when
  // image_url is set; otherwise a hue-tinted circle with the initial. Reuses
  // ordering's global classes so it matches that UI exactly (incl. light mode).
  function vendorAvatarCircle(v, sizeClass) {
    const name = (v && (v.company || v.name)) || '';
    if (v && v.image_url) {
      const u = String(v.image_url).replace(/'/g, '%27');
      return `<span class="ord-vendor-avatar ord-vendor-avatar-img ${sizeClass || ''}" style="background-image:url('${u}')" role="img" aria-label="${esc(name)}"></span>`;
    }
    const hue = (v && typeof v.avatar_hue === 'number' && v.avatar_hue >= 0 && v.avatar_hue < 360) ? v.avatar_hue : hashHue(name);
    const initial = (name.trim().charAt(0) || '?').toUpperCase();
    return `<span class="ord-vendor-avatar ${sizeClass || ''}" style="--avatar-hue:${hue}">${esc(initial)}</span>`;
  }

  function vendorListAvatar(v, grade) {
    return `<span class="nxrm-ava-wrap">${vendorAvatarCircle(v, 'nxrm-ava-md')}` +
      `<span class="nxrm-ava-grade-dot" title="Grade: ${esc(grade.label || '')}">${grade.letter}</span></span>`;
  }

  function vendorDetailAvatar(v, grade) {
    const hasPhoto = !!(v && v.image_url);
    return `<button class="nxrm-ava-wrap nxrm-ava-btn" data-act="change-photo" title="${hasPhoto ? 'Change photo' : 'Add photo'}">` +
      `${vendorAvatarCircle(v, 'nxrm-ava-lg')}` +
      `<span class="nxrm-ava-cam" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span></button>`;
  }

  // One-time migration: import legacy contractor "nodes" into the vendors
  // table so Vendors can fully replace the equipment Contractors manager.
  // Guarded by a localStorage flag; de-dupes by normalized name so vendors
  // that already exist are never duplicated. Fire-and-forget from render().
  async function backfillContractorsToVendors() {
    if (!NX?.sb) return;
    try { if (localStorage.getItem('nexus.vendors.contractorBackfillDone')) return; } catch (_) { return; }
    let nodes = [];
    try {
      const { data, error } = await NX.sb.from('nodes').select('*').in('category', ['contractor', 'contractors']);
      if (error) throw error;
      nodes = data || [];
    } catch (_) {
      try { const { data } = await NX.sb.from('nodes').select('*').eq('category', 'contractors'); nodes = data || []; } catch (_2) { return; }
    }
    const done = () => { try { localStorage.setItem('nexus.vendors.contractorBackfillDone', '1'); } catch (_) {} };
    if (!nodes.length) { done(); return; }
    let existing = [];
    try { const { data } = await NX.sb.from('vendors').select('*'); existing = data || []; } catch (_) {}
    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const have = new Set(existing.map(v => norm(v.company || v.name)));
    const toImport = nodes.filter(n => n.name && !have.has(norm(n.name)));
    if (!toImport.length) { done(); return; }
    let imported = 0;
    for (const n of toImport) {
      const phone = nodeContactPhones(n)[0] || null;
      const email = nodeContactEmails(n)[0] || null;
      const tags = Array.isArray(n.tags) ? n.tags.filter(t => t && !/^contractors?$/i.test(t)) : [];
      try {
        await saveVendorRow({
          company: n.name, name: n.name,
          phone: phone, email: email,
          category: tags[0] || null,
          notes: n.notes || null,
          active: true,
        }, null);
        imported++;
      } catch (_) {}
    }
    done();
    if (imported > 0) {
      NX.toast && NX.toast(`Imported ${imported} contractor${imported === 1 ? '' : 's'} into Vendors`, 'success', 3200);
      try { await loadVendors(); } catch (_) {}
    }
  }

  // ─── Contractor-contact extractors ──────────────────────────────────
  // Contractor phone/email lives on the `nodes` record's `links`, which can
  // be EITHER an array of {phone}/{email}/string entries (written by the
  // public-PM QR flow) OR a flat {phone,email} object (written by the
  // equipment contact editor), with a notes-regex fallback. These mirror
  // extractFirstPhone/EmailFromNode in equipment-public-pm so Vendors reads
  // the exact same source of truth as Public PM and Report-Issues.
  const PHONE_RE = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
  function nodeContactPhones(node) {
    const out = [];
    const push = p => { const s = (p == null ? '' : String(p)).trim(); if (s && !out.includes(s)) out.push(s); };
    if (node) {
      const links = node.links;
      if (Array.isArray(links)) {
        for (const l of links) {
          if (l && typeof l === 'object' && l.phone) push(l.phone);
          else if (typeof l === 'string') { const m = l.match(PHONE_RE); if (m) push(m[0]); }
        }
      } else if (links && typeof links === 'object' && links.phone) push(links.phone);
      if (!out.length && node.notes) { const m = String(node.notes).match(PHONE_RE); if (m) push(m[0]); }
    }
    return out;
  }
  function nodeContactEmails(node) {
    const out = [];
    const push = e => { const s = (e == null ? '' : String(e)).trim(); if (s && !out.includes(s)) out.push(s); };
    if (node) {
      const links = node.links;
      if (Array.isArray(links)) {
        const tos = [], rest = [];
        for (const l of links) {
          if (l && typeof l === 'object' && l.email) (l.role === 'to' ? tos : rest).push(l.email);
          else if (typeof l === 'string') { const m = l.match(EMAIL_RE); if (m) rest.push(m[0]); }
        }
        tos.forEach(push); rest.forEach(push);
      } else if (links && typeof links === 'object' && links.email) push(links.email);
      if (!out.length && node.notes) { const m = String(node.notes).match(EMAIL_RE); if (m) push(m[0]); }
    }
    return out;
  }

  // Fill in any vendor missing a phone/email from the authoritative sources:
  // contractor `nodes` (matched by name) and the denormalized equipment
  // columns (matched by contractor name AND by the service_/repair_vendor_id
  // FK). Email exists ONLY on the node, so equipment contributes phone while
  // the node (direct or via *_contractor_node_id) contributes email. Runs on
  // every load but is cheap (skips entirely once no vendor is missing data)
  // and NON-DESTRUCTIVE — it never overwrites a contact the vendor already
  // has. Found values are written back so the data becomes durable.
  async function reconcileVendorContacts() {
    if (!NX?.sb || !state.vendors.length) return;
    const needy = state.vendors.filter(v => !v.phone || !v.email);
    if (!needy.length) return;

    let nodes = [], equip = [];
    try {
      const [n, e] = await Promise.all([
        NX.sb.from('nodes').select('*').in('category', ['contractor', 'contractors']),
        NX.sb.from('equipment').select('*'),
      ]);
      nodes = n.data || []; equip = e.data || [];
    } catch (_) {
      try { const { data } = await NX.sb.from('nodes').select('*').eq('category', 'contractors'); nodes = data || []; } catch (__) {}
    }

    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const byName = new Map();   // norm(name) -> {phones:[], emails:[]}
    const byVid  = new Map();   // vendor uuid  -> {phones:[], emails:[]}
    const bucket = (map, key) => { if (!map.has(key)) map.set(key, { phones: [], emails: [] }); return map.get(key); };
    const addP = (b, p) => { const s = (p == null ? '' : String(p)).trim(); if (s && !b.phones.includes(s)) b.phones.push(s); };
    const addE = (b, e) => { const s = (e == null ? '' : String(e)).trim(); if (s && !b.emails.includes(s)) b.emails.push(s); };

    const nodeById = new Map();
    for (const nd of nodes) {
      nodeById.set(nd.id, nd);
      if (!nd.name) continue;
      const b = bucket(byName, norm(nd.name));
      nodeContactPhones(nd).forEach(p => addP(b, p));
      nodeContactEmails(nd).forEach(e => addE(b, e));
    }

    for (const eq of equip) {
      const sides = [
        { name: eq.service_contractor_name, phone: eq.service_contractor_phone, nodeId: eq.service_contractor_node_id, vid: eq.service_vendor_id },
        { name: eq.repair_contractor_name,  phone: eq.repair_contractor_phone,  nodeId: eq.repair_contractor_node_id,  vid: eq.repair_vendor_id  },
      ];
      for (const s of sides) {
        if (s.name && s.phone) addP(bucket(byName, norm(s.name)), s.phone);
        const nd = s.nodeId ? nodeById.get(s.nodeId) : null;
        if (s.vid) {
          const bv = bucket(byVid, s.vid);
          if (s.phone) addP(bv, s.phone);
          if (nd) { nodeContactPhones(nd).forEach(p => addP(bv, p)); nodeContactEmails(nd).forEach(e => addE(bv, e)); }
        }
      }
    }

    let filled = 0;
    for (const v of needy) {
      const fn = byName.get(norm(v.company || v.name)) || { phones: [], emails: [] };
      const fv = byVid.get(v.id) || { phones: [], emails: [] };
      const phones = [];
      [v.phone, ...fn.phones, ...fv.phones].forEach(p => { const s = (p == null ? '' : String(p)).trim(); if (s && !phones.includes(s)) phones.push(s); });
      const emails = [];
      [v.email, ...fn.emails, ...fv.emails].forEach(e => { const s = (e == null ? '' : String(e)).trim(); if (s && !emails.includes(s)) emails.push(s); });

      const patch = {};
      if (!v.phone && phones.length) patch.phone = phones[0];
      if (!v.email && emails.length) patch.email = emails[0];
      const curPhones = Array.isArray(v.phones) ? v.phones : [];
      const curEmails = Array.isArray(v.emails) ? v.emails : [];
      // jsonb method arrays are [{value,label}] with index 0 = primary (the
      // detail view renders .slice(1) as extra chips). Only write when the
      // editor hasn't already populated them and we found more than one.
      if (!curPhones.length && phones.length > 1) patch.phones = phones.map(p => ({ value: p, label: '' }));
      if (!curEmails.length && emails.length > 1) patch.emails = emails.map(e => ({ value: e, label: '' }));

      if (Object.keys(patch).length) {
        Object.assign(v, patch);                       // immediate in-memory display
        saveVendorPatch(v.id, patch).catch(() => {});  // durable, fire-and-forget
        filled++;
      }
    }
    return filled;
  }

  // Generic column-tolerant UPDATE on vendors. If the DB is missing a column
  // the payload names (e.g. image_url before the migration is run), drop that
  // key and retry instead of failing the whole save.
  async function saveVendorPatch(id, patch) {
    let p = Object.assign({}, patch, { updated_at: new Date().toISOString() });
    for (let i = 0; i < 8; i++) {
      const { error } = await NX.sb.from('vendors').update(p).eq('id', id);
      if (!error) return true;
      const m = /column "?([a-z_]+)"?.*does not exist/i.exec(error.message || '');
      if (m && m[1] && (m[1] in p)) { delete p[m[1]]; continue; }
      throw error;
    }
    return false;
  }

  // Generic column-tolerant INSERT/UPDATE on vendors (used by the editor).
  async function saveVendorRow(payload, existingId) {
    let p = Object.assign({}, payload);
    for (let i = 0; i < 10; i++) {
      let error;
      if (existingId) ({ error } = await NX.sb.from('vendors').update(p).eq('id', existingId));
      else ({ error } = await NX.sb.from('vendors').insert(p));
      if (!error) return true;
      const m = /column "?([a-z_]+)"?.*does not exist/i.exec(error.message || '');
      if (m && m[1] && (m[1] in p)) { delete p[m[1]]; continue; }
      throw error;
    }
    return false;
  }

  // Generic column-tolerant UPDATE on equipment (assign/unassign vendor).
  async function saveEquipPatch(id, patch) {
    let p = Object.assign({}, patch);
    for (let i = 0; i < 8; i++) {
      const { error } = await NX.sb.from('equipment').update(p).eq('id', id);
      if (!error) return true;
      const m = /column "?([a-z_]+)"?.*does not exist/i.exec(error.message || '');
      if (m && m[1] && (m[1] in p)) { delete p[m[1]]; continue; }
      throw error;
    }
    return false;
  }

  // ── ASSIGN EQUIPMENT (role-aware) ─────────────────────────────────────
  // Vendor is known (this profile). For each piece of equipment the user
  // toggles PM and/or Repair independently:
  //   PM     → equipment.service_vendor_id
  //   Repair → equipment.repair_vendor_id
  // This is the vendor-side mirror of the equipment detail's two contractor
  // pickers, so a vendor can be the PM provider, the repair provider, or
  // both — full parity with the (legacy) equipment Contractors manager.
  async function openVendorEquipmentAssign(vendor) {
    if (!NX?.sb) return;
    const vName = vendor.company || vendor.name || 'this vendor';
    const vid = String(vendor.id);
    ensurePicStyle();
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

    let allEquip = [];
    try {
      const { data } = await NX.sb.from('equipment').select('*');
      allEquip = (data || [])
        .filter(e => e.archived !== true)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    } catch (_) {}

    const pmSel     = new Set(allEquip.filter(e => String(e.service_vendor_id || '') === vid).map(e => e.id));
    const repairSel = new Set(allEquip.filter(e => String(e.repair_vendor_id  || '') === vid).map(e => e.id));
    const initialPm     = new Set(pmSel);
    const initialRepair = new Set(repairSel);
    const pmDates     = {};   // equipment_id -> next PM date (optional)
    const pmIntervals = {};   // equipment_id -> recurrence in days
    let search = '';

    // Shared PM cadence options (mirrors the Schedule-PM sheet).
    const CADENCE = [[0, 'One-time'], [30, 'Monthly'], [60, 'Every 2 mo'], [90, 'Quarterly'], [182, 'Semi-annual'], [365, 'Annual']];
    const cadenceOptions = (sel) => CADENCE.map(([v, l]) => `<option value="${v}"${(+sel === v) ? ' selected' : ''}>${l}</option>`).join('');

    // Schedule (or reschedule) a single PM for one unit and sync the equipment
    // row — same single-source-of-truth pattern as the Schedule-PM sheet.
    async function schedulePmFor(eqId, dateStr, intervalDays) {
      const { data: existing } = await NX.sb.from('pm_schedules')
        .select('id').eq('equipment_id', eqId).eq('status', 'scheduled');
      const rc = (existing && existing.length) ? 1 : 0;
      if (existing && existing.length) {
        await NX.sb.from('pm_schedules').update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('equipment_id', eqId).eq('status', 'scheduled');
      }
      await NX.sb.from('pm_schedules').insert([{
        equipment_id: eqId, vendor_id: vendor.id, contractor_node_id: null, contractor_name: vName,
        scheduled_date: dateStr, phase: 1, phase_label: null,
        title: `PM — ${vName}`, status: 'scheduled', reschedule_count: rc,
      }]);
      const eqUpdate = {
        next_pm_date: dateStr, service_vendor_id: vendor.id,
        service_contractor_node_id: null, service_contractor_name: vName,
        service_contractor_phone: vendor.phone || null,
      };
      if (intervalDays > 0) eqUpdate.pm_interval_days = intervalDays;
      await saveEquipPatch(eqId, eqUpdate);
    }
    async function cancelScheduledPm(eqId) {
      try {
        await NX.sb.from('pm_schedules').update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('equipment_id', eqId).eq('status', 'scheduled');
      } catch (_) {}
    }

    const overlay = document.createElement('div');
    overlay.className = 'nxrm-vendor-form-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9200;display:flex;align-items:flex-end;justify-content:center';

    const applyFilter = () => {
      const q = search.trim().toLowerCase();
      overlay.querySelectorAll('.vea-row').forEach(r => {
        const hay = (r.getAttribute('data-hay') || '').toLowerCase();
        r.style.display = (!q || hay.includes(q)) ? 'flex' : 'none';
      });
    };

    const updateCount = () => {
      const btn = overlay.querySelector('#veaSave');
      if (btn) btn.textContent = `Save · ${pmSel.size} PM · ${repairSel.size} repair`;
    };

    const draw = () => {
      const eqRows = allEquip
        // Hide units already assigned to another vendor for PM — they're
        // "taken", so they shouldn't show up in this vendor's picker. To move
        // one, unassign it from the other vendor first.
        .filter(e => !(e.service_vendor_id && String(e.service_vendor_id) !== vid))
        .map(e => {
          const meta = [e.location, e.category].filter(Boolean).join(' · ') || '—';
          const pmOn = pmSel.has(e.id);
          const rpOn = repairSel.has(e.id);
          const rpOther = e.repair_vendor_id && String(e.repair_vendor_id) !== vid;
          const flags = [];
          if (rpOther && !rpOn) flags.push('repair elsewhere');
          // Surface a legacy contractor (old "node era" or typed name, no vendor
          // link) so these units can be migrated onto this vendor with a tap.
          const legacyName = (!e.service_vendor_id && e.service_contractor_name) ? e.service_contractor_name : '';
          if (legacyName) flags.push('was ' + legacyName);
          const state = pmOn && rpOn ? 'Both' : pmOn ? 'PM only' : rpOn ? 'Repair only' : '';
          return `<div class="vea-row" data-hay="${esc((e.name || '') + ' ' + meta + ' ' + legacyName)}">
            <div class="vea-row-info">
              <span class="vea-name">${esc(e.name || 'Unnamed')} <span class="vea-state" data-state="${esc(e.id)}">${state}</span></span>
              <span class="vea-meta">${esc(meta)}${flags.length ? ' · ' + esc(flags.join(' · ')) : ''}</span>
            </div>
            <div class="vea-toggles">
              <button type="button" class="vea-toggle ${pmOn ? 'on' : ''}" data-toggle-pm="${esc(e.id)}">PM</button>
              <button type="button" class="vea-toggle ${rpOn ? 'on' : ''}" data-toggle-repair="${esc(e.id)}">Repair</button>
            </div>
          </div>`;
        }).join('') || '<div style="padding:14px;color:var(--muted);font-size:13px">No equipment available — every unit is already assigned to another vendor for PM.</div>';

      overlay.innerHTML = `
        <div class="nxvf-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.5)"></div>
        <div class="nxvf-sheet" style="position:relative;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;background:var(--surface);border:1px solid var(--nx-gold-line);border-radius:16px 16px 0 0;padding:20px 18px 28px">
          <div style="font-size:18px;font-weight:700;margin-bottom:2px">Assign equipment</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:4px">to ${esc(vName)}</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:14px">Tap <strong style="color:var(--nx-gold)">PM</strong> to make this the unit's service (PM) vendor. <strong style="color:#6c7bd0">Repair</strong> sets the repair vendor. Set how often PM runs over in PM&nbsp;Schedules.</div>
          <input class="nxvf-input" id="veaSearch" value="${esc(search)}" placeholder="Search equipment by name, location…" autocomplete="off" style="margin-bottom:8px">
          <div style="max-height:320px;overflow-y:auto;margin-bottom:16px">${eqRows}</div>
          <div style="display:flex;gap:10px">
            <button id="veaCancel" style="flex:1;padding:13px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--text);font-family:inherit;cursor:pointer">Cancel</button>
            <button id="veaSave" style="flex:2;padding:13px;border-radius:10px;border:none;background:var(--nx-gold);color:#000;font-weight:700;font-family:inherit;cursor:pointer">Save · ${pmSel.size} PM · ${repairSel.size} repair</button>
          </div>
        </div>`;

      overlay.querySelector('.nxvf-backdrop').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#veaCancel').addEventListener('click', () => overlay.remove());
      const si = overlay.querySelector('#veaSearch');
      si.addEventListener('input', () => { search = si.value; applyFilter(); });
      // In-place toggles — flip the Set + the button class without a full
      // redraw, so scroll position and the search box stay put.
      const refreshState = (id) => {
        const el = overlay.querySelector(`[data-state="${id}"]`);
        if (el) el.textContent = pmSel.has(id) && repairSel.has(id) ? 'Both' : pmSel.has(id) ? 'PM only' : repairSel.has(id) ? 'Repair only' : '';
      };
      overlay.querySelectorAll('[data-toggle-pm]').forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-toggle-pm');
        if (pmSel.has(id)) pmSel.delete(id); else pmSel.add(id);
        b.classList.toggle('on', pmSel.has(id));
        refreshState(id);
        updateCount();
      }));
      overlay.querySelectorAll('[data-toggle-repair]').forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-toggle-repair');
        if (repairSel.has(id)) repairSel.delete(id); else repairSel.add(id);
        b.classList.toggle('on', repairSel.has(id));
        refreshState(id);
        updateCount();
      }));
      overlay.querySelector('#veaSave').addEventListener('click', save);
      applyFilter();
    };

    async function save() {
      const pmAdd    = [...pmSel].filter(id => !initialPm.has(id));
      const pmRemove = [...initialPm].filter(id => !pmSel.has(id));
      const rpAdd    = [...repairSel].filter(id => !initialRepair.has(id));
      const rpRemove = [...initialRepair].filter(id => !repairSel.has(id));
      const saveBtn = overlay.querySelector('#veaSave');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        for (const id of pmAdd) {
          await saveEquipPatch(id, { service_vendor_id: vendor.id, service_contractor_name: vName, service_contractor_node_id: null });
        }
        for (const id of pmRemove) {
          await saveEquipPatch(id, { service_vendor_id: null, service_contractor_name: null });
          await cancelScheduledPm(id);   // don't leave a scheduled PM pointing at an unassigned vendor
        }
        for (const id of rpAdd) {
          await saveEquipPatch(id, { repair_vendor_id: vendor.id, repair_contractor_name: vName, repair_contractor_node_id: null });
        }
        for (const id of rpRemove) {
          await saveEquipPatch(id, { repair_vendor_id: null, repair_contractor_name: null });
        }
        overlay.remove();
        const changes = pmAdd.length + pmRemove.length + rpAdd.length + rpRemove.length;
        NX.toast && NX.toast(changes ? `Saved ${changes} change${changes === 1 ? '' : 's'}` : 'No changes', 'success', 1800);
        state._detailCache = null;
        render(); // re-render the detail (state.activeVendor still set)
      } catch (e) {
        alert('Failed: ' + (e.message || e));
        saveBtn.disabled = false; updateCount();
      }
    }

    draw();
    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('#veaSearch')?.focus(), 50);
  }

  // Generic column-tolerant INSERT on equipment_maintenance.
  async function saveMaintRow(payload) {
    let p = Object.assign({}, payload);
    for (let i = 0; i < 8; i++) {
      const { error } = await NX.sb.from('equipment_maintenance').insert(p);
      if (!error) return true;
      const m = /column "?([a-z_]+)"?.*does not exist/i.exec(error.message || '');
      if (m && m[1] && (m[1] in p)) { delete p[m[1]]; continue; }
      throw error;
    }
    return false;
  }

  // ── LOG SERVICE ───────────────────────────────────────────────────────
  // Record a service call performed by this vendor — writes an
  // equipment_maintenance row with performed_by = vendor name, so it feeds
  // straight into this vendor's Activity feed and the equipment's history.
  async function openVendorServiceLogger(vendor) {
    if (!NX?.sb) return;
    const vName = vendor.company || vendor.name || 'this vendor';
    ensurePicStyle();
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

    let allEquip = [];
    try {
      const { data } = await NX.sb.from('equipment').select('*');
      allEquip = (data || []).filter(e => e.archived !== true)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    } catch (_) {}

    const today = new Date().toISOString().slice(0, 10);
    let selId = null, selName = '', search = '';
    let evType = 'repair', dateStr = today, costStr = '', descStr = '';
    const TYPES = ['repair', 'pm', 'inspection', 'other'];

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
        const sel = selId === e.id;
        return `<button type="button" class="vpm-eq-row" data-eq="${esc(e.id)}" data-name="${esc(e.name || '')}" data-hay="${esc((e.name || '') + ' ' + meta)}"
          style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:10px 12px;border-radius:9px;border:1px solid ${sel ? 'var(--nx-gold)' : 'var(--border)'};background:${sel ? 'var(--nx-gold-faint)' : 'var(--surface-2,var(--surface))'};color:var(--text);font-family:inherit;cursor:pointer;margin-bottom:6px">
          <span style="font-weight:600;font-size:14px">${esc(e.name || 'Unnamed')}</span>
          <span style="font-size:11px;color:var(--muted)">${esc(meta)}</span>
        </button>`;
      }).join('') || '<div style="padding:14px;color:var(--muted);font-size:13px">No equipment found.</div>';

      const typePills = TYPES.map(t => `<button type="button" class="vea-toggle ${evType === t ? 'on' : ''}" data-type="${t}" style="text-transform:capitalize">${t}</button>`).join('');

      overlay.innerHTML = `
        <div class="nxvf-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.5)"></div>
        <div class="nxvf-sheet" style="position:relative;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;background:var(--surface);border:1px solid var(--nx-gold-line);border-radius:16px 16px 0 0;padding:20px 18px 28px">
          <div style="font-size:18px;font-weight:700;margin-bottom:2px">Log service</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:14px">by ${esc(vName)}</div>

          <div class="nxvf-label">Equipment${selId ? ' · <span style="color:var(--nx-gold);text-transform:none;letter-spacing:0">' + esc(selName) + '</span>' : ''}</div>
          <input class="nxvf-input" id="vslSearch" value="${esc(search)}" placeholder="Search equipment by name, location…" autocomplete="off" style="margin-bottom:8px">
          <div style="max-height:220px;overflow-y:auto;margin-bottom:16px">${eqRows}</div>

          <div class="nxvf-label">Type</div>
          <div class="vea-toggles" style="flex-wrap:wrap;margin-bottom:14px">${typePills}</div>

          <label class="nxvf-field"><span class="nxvf-label">Date</span>
            <input class="nxvf-input" type="date" id="vslDate" value="${esc(dateStr)}"></label>
          <label class="nxvf-field"><span class="nxvf-label">Cost ($)</span>
            <input class="nxvf-input" type="number" inputmode="decimal" step="any" min="0" id="vslCost" value="${esc(costStr)}" placeholder="0"></label>
          <label class="nxvf-field"><span class="nxvf-label">What was done</span>
            <textarea class="nxvf-input" id="vslDesc" rows="3" placeholder="Optional notes about the work">${esc(descStr)}</textarea></label>

          <div style="display:flex;gap:10px;margin-top:6px">
            <button id="vslCancel" style="flex:1;padding:13px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--text);font-family:inherit;cursor:pointer">Cancel</button>
            <button id="vslSave" style="flex:2;padding:13px;border-radius:10px;border:none;background:var(--nx-gold);color:#000;font-weight:700;font-family:inherit;cursor:pointer">Log service</button>
          </div>
        </div>`;

      overlay.querySelector('.nxvf-backdrop').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#vslCancel').addEventListener('click', () => overlay.remove());
      const si = overlay.querySelector('#vslSearch');
      si.addEventListener('input', () => { search = si.value; applyFilter(); });
      overlay.querySelectorAll('[data-eq]').forEach(b => b.addEventListener('click', () => {
        selId = b.dataset.eq; selName = b.dataset.name; draw();
      }));
      overlay.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { evType = b.dataset.type; draw(); }));
      overlay.querySelector('#vslDate').addEventListener('input', e => { dateStr = e.target.value; });
      overlay.querySelector('#vslCost').addEventListener('input', e => { costStr = e.target.value; });
      overlay.querySelector('#vslDesc').addEventListener('input', e => { descStr = e.target.value; });
      overlay.querySelector('#vslSave').addEventListener('click', save);
      applyFilter();
    };

    async function save() {
      if (!selId) { alert('Pick the equipment that was serviced.'); return; }
      if (!dateStr) { alert('Pick a date.'); return; }
      const saveBtn = overlay.querySelector('#vslSave');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        // parseFloat(costStr) || null wrongly turned a real $0 (free service)
        // into null; keep 0, only null out empty/non-numeric input.
        const _c = parseFloat(costStr);
        const cost = Number.isFinite(_c) ? _c : null;
        await saveMaintRow({
          equipment_id: selId,
          event_date: dateStr,
          event_type: evType,
          description: descStr.trim() || null,
          performed_by: vName,
          cost: cost,
          notes: 'Logged from Vendors',
        });
        overlay.remove();
        NX.toast && NX.toast('Service logged', 'success', 1600);
        state._detailCache = null;
        render();
      } catch (e) {
        alert('Failed: ' + (e.message || e));
        saveBtn.disabled = false; saveBtn.textContent = 'Log service';
      }
    }

    draw();
    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('#vslSearch')?.focus(), 50);
  }

  // ─────────────────────────────────────────────────────────────────────
  // RESQ BRIDGE
  // Management runs ResQ; NEXUS stays the source of truth. ResQ has no
  // self-serve vendor import — every vendor goes through their "Invite
  // Your Own Vendor" form or an email thread with the CSM. These helpers
  // kill the email thread:
  //   exportVendorsToResQ()   — every active vendor as ONE CSV, handed to
  //                             the CSM once for bulk onboarding.
  //   copyVendorResQPacket(v) — one vendor on the clipboard, field-for-
  //                             field what the invite form asks for.
  // Companion to the equipment "→ ResQ" exports in equipment.js (v18.32).
  // ─────────────────────────────────────────────────────────────────────

  // RFC 4180 cell escape — same rules as equipment.js's csv().
  function csvCell(val) {
    if (val == null) return '';
    const s = String(val);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Primary phone/email column first, then extras from the phones/emails
  // JSON arrays, deduped case-insensitively.
  function vendorContactList(v, kind) {
    const primary = kind === 'email' ? v.email : v.phone;
    const arr = Array.isArray(v[kind + 's']) ? v[kind + 's'] : [];
    const seen = new Set(), out = [];
    [primary, ...arr.map(r => r && r.value)].forEach(val => {
      const t = (val || '').trim();
      if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
    });
    return out;
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }

  function exportVendorsToResQ() {
    const rows = mergeData().slice()
      .sort((a, b) => (a.company || a.name || '').localeCompare(b.company || b.name || ''));
    if (!rows.length) { NX.toast && NX.toast('No vendors to export', 'warn', 2200); return; }

    const headers = ['Vendor Company', 'Trade / Category', 'Contact Name', 'Email',
      'Phone', 'Address', 'Website', 'Our Account #', '24hr Emergency', 'Preferred', 'Notes'];
    const lines = [headers.join(',')];
    let missingEmail = 0;
    for (const v of rows) {
      const emails = vendorContactList(v, 'email');
      const phones = vendorContactList(v, 'phone');
      if (!emails.length) missingEmail++;
      lines.push([
        csvCell(v.company || v.name),
        csvCell(v.category),
        csvCell(v.contact_name),
        csvCell(emails.join('; ')),
        csvCell(phones.join('; ')),
        csvCell(v.address),
        csvCell(v.website),
        csvCell(v.account_number),
        csvCell(v.is_emergency ? 'YES' : ''),
        csvCell(v.is_preferred ? 'YES' : ''),
        csvCell(v.notes),
      ].join(','));
    }

    // UTF-8 BOM so Windows Excel renders accents without import fiddling.
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-resq-vendors-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const n = rows.length;
    const msg = missingEmail
      ? `${n} vendors exported — ${missingEmail} missing an email (ResQ can't invite those until it's filled in)`
      : `${n} vendors exported for ResQ onboarding`;
    NX.toast && NX.toast(msg, missingEmail ? 'warn' : 'success', 5500);
  }

  async function copyVendorResQPacket(v) {
    if (!v) return;
    const nm = v.company || v.name || 'Vendor';
    const emails = vendorContactList(v, 'email');
    const phones = vendorContactList(v, 'phone');
    const row = (label, val) => val ? (label + ' ').padEnd(15, ' ') + val : null;
    const packet = [
      nm + ' — vendor details for ResQ',
      row('Company:', nm),
      row('Trade:', v.category),
      row('Contact:', v.contact_name),
      row('Email:', emails.join(', ') || '⚠ none on file — ResQ needs one to send the invite'),
      row('Phone:', phones.join(', ')),
      row('Address:', v.address),
      row('Website:', v.website),
      row('Our acct #:', v.account_number),
      row('Hours:', v.hours),
      v.is_emergency ? '24h emergency: yes' : null,
      row('Notes:', v.notes),
    ].filter(Boolean).join('\n');

    const ok = await copyToClipboard(packet);
    if (ok) {
      NX.toast && NX.toast(
        emails.length
          ? `${nm} copied — paste into ResQ's "Invite Your Own Vendor" form`
          : `${nm} copied — ⚠ no email on file, ResQ will need one`,
        emails.length ? 'success' : 'warn', 4200);
    } else {
      // Clipboard blocked (rare — non-HTTPS or permissions): show the packet
      // so the user can still select-and-copy by hand.
      alert(packet);
    }
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
    let photoUrl = v.image_url || '';

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

    // Multi-value repeater (phones / emails). Each row is value + optional
    // label + a remove button. The first non-empty value becomes the primary
    // (synced to the single phone/email columns for Call/Text + dispatch).
    const repRow = (kind, r) => {
      const ph = kind === 'email' ? 'name@company.com' : '512-555-1234';
      const itype = kind === 'email' ? 'email' : 'tel';
      return `<div class="nxvf-rep-row" style="display:flex;gap:6px;margin-bottom:6px">` +
        `<input class="nxvf-input nxvf-rep-val" type="${itype}" value="${esc((r && r.value) || '')}" placeholder="${ph}" style="flex:2;min-width:0">` +
        `<input class="nxvf-input nxvf-rep-label" type="text" value="${esc((r && r.label) || '')}" placeholder="label" style="flex:1;min-width:0">` +
        `<button type="button" class="nxvf-rep-del" title="Remove" style="flex:0 0 auto;width:40px;border-radius:9px;border:1px solid var(--border);background:none;color:var(--muted);font-size:18px;cursor:pointer">×</button>` +
        `</div>`;
    };
    const repSection = (kind, label, items) => {
      const rows = (items && items.length ? items : [null]);
      return `<div class="nxvf-field"><span class="nxvf-label">${label}</span>` +
        `<div class="nxvf-rep" data-rep="${kind}">${rows.map(r => repRow(kind, r)).join('')}</div>` +
        `<button type="button" class="nxvf-rep-add" data-rep-add="${kind}" style="margin-top:2px;padding:7px 12px;border-radius:8px;border:1px dashed var(--border);background:none;color:var(--nx-gold);font:inherit;font-size:12px;cursor:pointer">+ Add ${kind === 'email' ? 'email' : 'phone'}</button>` +
        `</div>`;
    };
    const seedPhones = Array.isArray(v.phones) && v.phones.length ? v.phones : (v.phone ? [{ value: v.phone }] : []);
    const seedEmails = Array.isArray(v.emails) && v.emails.length ? v.emails : (v.email ? [{ value: v.email }] : []);

    const overlay = document.createElement('div');
    overlay.className = 'nxrm-vendor-form-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9200;display:flex;align-items:flex-end;justify-content:center';
    overlay.innerHTML = `
      <div class="nxvf-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.5)"></div>
      <div class="nxvf-sheet" style="position:relative;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;background:var(--surface);border:1px solid var(--nx-gold-line);border-radius:16px 16px 0 0;padding:20px 18px 28px">
        <div style="font-size:18px;font-weight:700;margin-bottom:14px">${isEdit ? 'Edit vendor' : 'New vendor'}</div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
          <div id="vfPhotoPreview" style="width:64px;height:64px;flex:0 0 auto;border-radius:14px;border:1px solid var(--nx-gold-line);background:${photoUrl ? "url('" + String(photoUrl).replace(/'/g, '%27') + "') center/cover" : 'var(--surface-2,var(--surface))'};display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.4px">${photoUrl ? '' : 'No photo'}</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button type="button" id="vfPhotoPick" style="padding:9px 14px;border-radius:9px;border:1px solid var(--border);background:none;color:var(--text);font-family:inherit;cursor:pointer">${photoUrl ? 'Change photo' : '+ Add photo'}</button>
            <button type="button" id="vfPhotoRemove" style="padding:7px 14px;border-radius:9px;border:none;background:none;color:var(--muted);font-family:inherit;cursor:pointer;${photoUrl ? '' : 'display:none'}">Remove</button>
          </div>
        </div>
        ${fld('Company *', 'vfCompany', v.company || v.name, 'text', 'e.g. Austin Air and Ice')}
        ${fld('Contact name', 'vfContact', v.contact_name, 'text', 'Person you call')}
        <label class="nxvf-field"><span class="nxvf-label">Trade / category</span>
          <input class="nxvf-input" id="vfCategory" list="vfTrades" value="${v.category != null ? esc(v.category) : ''}" placeholder="HVAC, Refrigeration…">
          <datalist id="vfTrades">${TRADES.map(t => `<option value="${t}">`).join('')}</datalist>
        </label>
        ${repSection('phone', 'Phones', seedPhones)}
        ${repSection('email', 'Emails', seedEmails)}
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
        <label class="nxvf-field"><span class="nxvf-label">Dispatch email subject <span style="text-transform:none;color:var(--muted)">— optional</span></span>
          <input class="nxvf-input" id="vfDispatchSubject" value="${v.dispatch_subject != null ? esc(v.dispatch_subject) : ''}" placeholder="{restaurant}: {equipment} — {issue}">
        </label>
        <label class="nxvf-field"><span class="nxvf-label">Dispatch message template <span style="text-transform:none;color:var(--muted)">— SMS &amp; email</span></span>
          <textarea class="nxvf-input" id="vfDispatchBody" rows="6" placeholder="Variables: {restaurant} {equipment} {unit} {serial} {area} {issue} {priority} {description} {user}">${v.dispatch_template != null ? esc(v.dispatch_template) : ''}</textarea>
          <div style="margin-top:4px;font-size:11px;color:var(--muted);line-height:1.5">Tokens fill in automatically when emailing from an issue or equipment: {restaurant} {equipment} {unit} {serial} {area} {issue} {priority} {description} {user}. Unknown tokens stay visible so you can fill them in the composer.</div>
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

    const refreshPhotoUi = () => {
      const prev = overlay.querySelector('#vfPhotoPreview');
      const rm = overlay.querySelector('#vfPhotoRemove');
      const pick = overlay.querySelector('#vfPhotoPick');
      if (prev) {
        if (photoUrl) { prev.style.background = "url('" + String(photoUrl).replace(/'/g, '%27') + "') center/cover"; prev.textContent = ''; }
        else { prev.style.background = 'var(--surface-2,var(--surface))'; prev.textContent = 'No photo'; }
      }
      if (pick) pick.textContent = photoUrl ? 'Change photo' : '+ Add photo';
      if (rm) rm.style.display = photoUrl ? '' : 'none';
    };
    overlay.querySelector('#vfPhotoPick')?.addEventListener('click', async () => {
      const url = await pickVendorPhoto();
      if (url === null) return;
      photoUrl = url; refreshPhotoUi();
    });
    overlay.querySelector('#vfPhotoRemove')?.addEventListener('click', () => { photoUrl = ''; refreshPhotoUi(); });

    // Repeater add/remove (phones / emails)
    overlay.querySelectorAll('[data-rep-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.getAttribute('data-rep-add');
        const cont = overlay.querySelector('.nxvf-rep[data-rep="' + kind + '"]');
        if (!cont) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = repRow(kind, null);
        const row = tmp.firstElementChild;
        if (row) { cont.appendChild(row); row.querySelector('.nxvf-rep-val')?.focus(); }
      });
    });
    overlay.addEventListener('click', (ev) => {
      const del = ev.target.closest('.nxvf-rep-del');
      if (del) { const row = del.closest('.nxvf-rep-row'); if (row) row.remove(); }
    });

    overlay.querySelector('#vfSave').addEventListener('click', async () => {
      const val = id => (overlay.querySelector('#' + id)?.value || '').trim();
      const num = id => { const n = parseFloat(val(id)); return isNaN(n) ? null : n; };
      const collectRep = (kind) => {
        const out = [];
        overlay.querySelectorAll('.nxvf-rep[data-rep="' + kind + '"] .nxvf-rep-row').forEach(row => {
          const value = (row.querySelector('.nxvf-rep-val')?.value || '').trim();
          const label = (row.querySelector('.nxvf-rep-label')?.value || '').trim();
          if (value) out.push(label ? { value, label } : { value });
        });
        return out;
      };
      const company = val('vfCompany');
      if (!company) { alert('Company name is required.'); return; }
      const phones = collectRep('phone');
      const emails = collectRep('email');
      const payload = {
        company, name: company,
        contact_name: val('vfContact') || null,
        category: val('vfCategory') || null,
        phone: (phones[0] && phones[0].value) || null,
        email: (emails[0] && emails[0].value) || null,
        phones: phones.length ? phones : null,
        emails: emails.length ? emails : null,
        website: val('vfWebsite') || null,
        address: val('vfAddress') || null,
        account_number: val('vfAccount') || null,
        hours: val('vfHours') || null,
        hourly_rate: num('vfRate'),
        trip_charge: num('vfTrip'),
        is_preferred: overlay.querySelector('#vfPreferred').checked,
        is_emergency: overlay.querySelector('#vfEmergency').checked,
        dispatch_subject: val('vfDispatchSubject') || null,
        dispatch_template: val('vfDispatchBody') || null,
        notes: val('vfNotes') || null,
        image_url: photoUrl || null,
        updated_at: new Date().toISOString(),
      };
      const saveBtn = overlay.querySelector('#vfSave');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        if (!isEdit) payload.active = true;
        await saveVendorRow(payload, isEdit ? existing.id : null);
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
    const vid = String(vendor.id || '');
    try {
      const { data } = await NX.sb.from('equipment').select('*');
      allEquip = (data || [])
        .filter(e => e.archived !== true)
        // Only equipment ASSIGNED to this vendor — same definition used
        // across vendors.js (service OR repair vendor FK). Previously this
        // listed EVERY piece of equipment regardless of vendor.
        .filter(e => String(e.service_vendor_id || '') === vid || String(e.repair_vendor_id || '') === vid)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    } catch (_) {}

    let selectedIds = new Set(), search = '';
    let phases = [{ date: '', label: '' }];
    let intervalDays = 90;   // recurrence cadence; default Quarterly

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
        const sel = selectedIds.has(e.id);
        return `<button type="button" class="vpm-eq-row" data-eq="${esc(e.id)}" data-name="${esc(e.name || '')}" data-hay="${esc((e.name || '') + ' ' + meta)}"
          style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 12px;border-radius:9px;border:1px solid ${sel ? 'var(--nx-gold)' : 'var(--border)'};background:${sel ? 'var(--nx-gold-faint)' : 'var(--surface-2,var(--surface))'};color:var(--text);font-family:inherit;cursor:pointer;margin-bottom:6px">
          <span class="vpm-check" style="flex:0 0 18px;width:18px;height:18px;border-radius:5px;border:1.5px solid ${sel ? 'var(--nx-gold)' : 'var(--border)'};background:${sel ? 'var(--nx-gold)' : 'transparent'};display:flex;align-items:center;justify-content:center;color:#000;font-size:12px;font-weight:800;line-height:1">${sel ? '✓' : ''}</span>
          <span style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
            <span style="font-weight:600;font-size:14px">${esc(e.name || 'Unnamed')}</span>
            <span style="font-size:11px;color:var(--muted)">${esc(meta)}</span>
          </span>
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

          <div class="nxvf-label">Equipment<span id="vpmEqCount" style="color:var(--nx-gold);text-transform:none;letter-spacing:0">${selectedIds.size ? ' · ' + selectedIds.size + ' selected' : ''}</span></div>
          <input class="nxvf-input" id="vpmSearch" value="${esc(search)}" placeholder="Search equipment by name, location…" autocomplete="off" style="margin-bottom:8px">
          <div style="max-height:240px;overflow-y:auto;margin-bottom:16px">${eqRows}</div>

          <div class="nxvf-label">Phases <span style="text-transform:none;letter-spacing:0;opacity:.6">${phases.length}/3 — most PMs are 1 visit</span></div>
          ${phaseRows}
          ${phases.length < 3 ? `<button type="button" id="vpmAddPhase" style="width:100%;padding:10px;border-radius:9px;border:1px dashed var(--border);background:none;color:var(--text);font-family:inherit;cursor:pointer;margin-bottom:8px">+ Add phase</button>` : ''}

          <div class="nxvf-label" style="margin-top:6px">Repeat cadence</div>
          <select class="nxvf-input" id="vpmCadence" style="margin-bottom:4px">
            <option value="0"${intervalDays === 0 ? ' selected' : ''}>One-time (no repeat)</option>
            <option value="30"${intervalDays === 30 ? ' selected' : ''}>Monthly</option>
            <option value="60"${intervalDays === 60 ? ' selected' : ''}>Every 2 months</option>
            <option value="90"${intervalDays === 90 ? ' selected' : ''}>Quarterly</option>
            <option value="182"${intervalDays === 182 ? ' selected' : ''}>Semi-annual</option>
            <option value="365"${intervalDays === 365 ? ' selected' : ''}>Annual</option>
          </select>
          <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Sets how often this PM recurs, so the next due date is known even for brand-new equipment with no service history.</div>

          <div style="display:flex;gap:10px;margin-top:12px">
            <button id="vpmCancel" style="flex:1;padding:13px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--text);font-family:inherit;cursor:pointer">Cancel</button>
            <button id="vpmSave" style="flex:2;padding:13px;border-radius:10px;border:none;background:var(--nx-gold);color:#000;font-weight:700;font-family:inherit;cursor:pointer">Save schedule</button>
          </div>
        </div>`;

      overlay.querySelector('.nxvf-backdrop').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#vpmCancel').addEventListener('click', () => overlay.remove());
      const si = overlay.querySelector('#vpmSearch');
      si.addEventListener('input', () => { search = si.value; applyFilter(); });
      const updateSelCount = () => {
        const lbl = overlay.querySelector('#vpmEqCount');
        if (lbl) lbl.textContent = selectedIds.size ? ' · ' + selectedIds.size + ' selected' : '';
        const sb = overlay.querySelector('#vpmSave');
        if (sb && !sb.disabled) sb.textContent = selectedIds.size > 1 ? `Save for ${selectedIds.size} units` : 'Save schedule';
      };
      overlay.querySelectorAll('[data-eq]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.eq;
        if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
        const sel = selectedIds.has(id);
        // Toggle visuals in place — a full redraw would reset the list scroll,
        // which is painful when ticking several units out of a long list.
        b.style.borderColor = sel ? 'var(--nx-gold)' : 'var(--border)';
        b.style.background = sel ? 'var(--nx-gold-faint)' : 'var(--surface-2,var(--surface))';
        const chk = b.querySelector('.vpm-check');
        if (chk) {
          chk.style.borderColor = sel ? 'var(--nx-gold)' : 'var(--border)';
          chk.style.background = sel ? 'var(--nx-gold)' : 'transparent';
          chk.textContent = sel ? '✓' : '';
        }
        updateSelCount();
      }));
      overlay.querySelectorAll('[data-pdate]').forEach(inp => inp.addEventListener('input', e => { phases[+e.target.dataset.pdate].date = e.target.value; }));
      overlay.querySelectorAll('[data-plabel]').forEach(inp => inp.addEventListener('input', e => { phases[+e.target.dataset.plabel].label = e.target.value; }));
      overlay.querySelectorAll('[data-delphase]').forEach(b => b.addEventListener('click', () => { phases.splice(+b.dataset.delphase, 1); draw(); }));
      const addP = overlay.querySelector('#vpmAddPhase');
      if (addP) addP.addEventListener('click', () => { if (phases.length < 3) { phases.push({ date: '', label: '' }); draw(); } });
      const cad = overlay.querySelector('#vpmCadence');
      if (cad) cad.addEventListener('change', () => { intervalDays = parseInt(cad.value, 10) || 0; });
      overlay.querySelector('#vpmSave').addEventListener('click', save);
      applyFilter();
    };

    async function save() {
      if (!selectedIds.size) { alert('Pick at least one piece of equipment.'); return; }
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
      const ids = Array.from(selectedIds);
      try {
        for (const selectedId of ids) {
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
          if (intervalDays > 0) {
            eqUpdate.pm_interval_days = intervalDays;          // explicit cadence — works for new equipment
          } else if (priorEq?.last_pm_date) {
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
        }   // end per-equipment loop

        overlay.remove();
        if (NX.toast) NX.toast(`PM scheduled with ${vName} for ${ids.length} unit${ids.length > 1 ? 's' : ''}`, 'success', 2000);
        // Refresh the vendor detail so the new PM appears in Scheduled PMs.
        state.activeVendor = vendor;
        state._detailCache = null;
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
    // Deep-link primitive: open a specific vendor's profile from anywhere
    // (Equipment, Board, Calendar). Loads the vendor if it isn't in memory,
    // switches to the Vendors view, and renders its detail.
    async openVendor(vendorId) {
      if (!vendorId) return;
      if (!state.loaded) { try { await mod.init(); } catch (_) {} }
      let v = mergeData().find(x => String(x.id) === String(vendorId));
      if (!v && window.NX && NX.sb) {
        try { const { data } = await NX.sb.from('vendors').select('*').eq('id', vendorId).single(); if (data) v = data; } catch (_) {}
      }
      if (!v) { (window.NX && NX.toast) && NX.toast('Vendor not found', 'warn', 1800); return; }
      state.activeVendor = v;
      state._detailCache = null;
      try {
        if (NXRM && NXRM.view && NXRM.view.switchTo) NXRM.view.switchTo('vendors');
        else if (window.NX && typeof NX.switchTo === 'function') NX.switchTo('vendors');
      } catch (_) {}
      render();
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
    openVendor: (id) => mod.openVendor(id),
    exportResQ: exportVendorsToResQ,
    copyResQPacket: copyVendorResQPacket,
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
