/* ═══════════════════════════════════════════════════════════════════════
   NEXUS · R&M · prevention
   ─────────────────────────────────────────────────────────────────────
   Three preventive surfaces, one module:

     §1   /pm view  — recurring PM with auto-advance
     §2   Quick-Create        — one-tap templates (window.NXQuickCreate)
     §3   Troubleshooting     — pre-call wizard (window.NXTroubleshoot)

   Reads v_pm_due_soon, issue_templates, troubleshooting_steps. Depends
   on core.js.
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';
  const { fmt, esc, URGENCY } = NXRM;

  // ─────────────────────────────────────────────────────────────────────
  // SHARED STATE
  // ─────────────────────────────────────────────────────────────────────

  const state = {
    schedules:   [],
    templates:   [],
    troubleSteps: [],
    equipment:   [],
    filter:      { urgency: 'all', search: '' },
    loaded:      false,
  };

  // ─────────────────────────────────────────────────────────────────────
  // DATA
  // ─────────────────────────────────────────────────────────────────────

  async function loadSchedules() {
    if (!NX?.sb) return;
    try {
      const { data, error } = await NX.sb.from('v_pm_due_soon').select('*');
      if (error) throw error;
      state.schedules = data || [];
    } catch (_) {
      try {
        const { data: raw } = await NX.sb.from('pm_schedules')
          .select('*').eq('active', true);
        const { data: eqList } = await NX.sb.from('equipment')
          .select('id, name, restaurant:location, category');
        const eqMap = {}; (eqList || []).forEach(e => { eqMap[e.id] = e; });
        state.schedules = (raw || []).map(s => {
          const eq = eqMap[s.equipment_id] || {};
          const days = s.next_due_at
            ? (new Date(s.next_due_at).getTime() - Date.now()) / 86400000
            : null;
          const urgency = days == null ? 'distant'
            : days < 0  ? 'overdue'
            : days < 3  ? 'due_soon'
            : days < 14 ? 'upcoming' : 'distant';
          return {
            ...s,
            equipment_name: eq.name,
            restaurant: eq.restaurant,
            days_until_due: days,
            urgency,
          };
        });
      } catch (e) {
        console.warn('[pm] load failed', e);
      }
    }
  }

  async function loadTemplates() {
    if (!NX?.sb || state.templates.length) return;
    try {
      const { data } = await NX.sb.from('issue_templates')
        .select('*').eq('active', true).order('sort_order');
      state.templates = data || [];
    } catch (_) {}
  }

  async function loadTroubleSteps() {
    if (!NX?.sb || state.troubleSteps.length) return;
    try {
      const { data } = await NX.sb.from('troubleshooting_steps')
        .select('*').eq('active', true).order('sort_order');
      state.troubleSteps = data || [];
    } catch (_) {}
  }

  async function loadEquipment() {
    if (!NX?.sb || state.equipment.length) return;
    try {
      const { data } = await NX.sb.from('equipment')
        .select('id, name, restaurant:location, category').order('name');
      state.equipment = data || [];
    } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────────────────
  // §1 — /pm VIEW
  // ─────────────────────────────────────────────────────────────────────

  function filteredSchedules() {
    let result = state.schedules.slice();
    if (state.filter.urgency !== 'all') {
      result = result.filter(s => s.urgency === state.filter.urgency);
    }
    if (state.filter.search) {
      const q = state.filter.search.toLowerCase();
      result = result.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.equipment_name || '').toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      const wa = URGENCY[a.urgency]?.weight || 0;
      const wb = URGENCY[b.urgency]?.weight || 0;
      if (wa !== wb) return wb - wa;
      return (a.days_until_due ?? 9999) - (b.days_until_due ?? 9999);
    });
    return result;
  }

  function renderPMView() {
    const view = NXRM.view.ensure('pmView', 'pm');
    const f = state.filter;
    const overdue  = state.schedules.filter(s => s.urgency === 'overdue').length;
    const dueSoon  = state.schedules.filter(s => s.urgency === 'due_soon').length;
    const upcoming = state.schedules.filter(s => s.urgency === 'upcoming').length;
    const total    = state.schedules.length;
    const list = filteredSchedules();

    view.innerHTML = `
      <div class="nxrm-page">
        <div class="nxrm-masthead">
          <div>
            <div class="nxrm-eyebrow">RECURRING MAINTENANCE</div>
            <h1 class="nxrm-h1">PM Schedules</h1>
          </div>
          <button class="nxrm-btn-pill" data-act="new-schedule">+ New</button>
        </div>

        <div class="nxrm-tiles tiles-4">
          <button class="nxrm-tile ${overdue ? 'is-alert' : ''}" data-quick="overdue">
            <div class="nxrm-tile-num">${overdue}</div>
            <div class="nxrm-tile-lbl">Overdue</div>
          </button>
          <button class="nxrm-tile ${dueSoon ? 'is-alert' : ''}" data-quick="due_soon">
            <div class="nxrm-tile-num">${dueSoon}</div>
            <div class="nxrm-tile-lbl">Due&nbsp;Soon</div>
          </button>
          <button class="nxrm-tile" data-quick="upcoming">
            <div class="nxrm-tile-num">${upcoming}</div>
            <div class="nxrm-tile-lbl">Upcoming</div>
          </button>
          <button class="nxrm-tile" data-quick="all">
            <div class="nxrm-tile-num">${total}</div>
            <div class="nxrm-tile-lbl">Total</div>
          </button>
        </div>

        <div class="nxrm-filters">
          <div class="nxrm-chip-row">
            ${['all','overdue','due_soon','upcoming','distant'].map(u => `
              <button class="nxrm-chip ${f.urgency === u ? 'is-active' : ''}"
                      data-filter-urgency="${u}">
                ${u === 'all' ? 'All' : URGENCY[u]?.label || u}
              </button>
            `).join('')}
          </div>
          <div class="nxrm-chip-row">
            <input class="nxrm-search" placeholder="Search title or equipment…"
                   value="${esc(f.search)}" id="pmSearch">
          </div>
        </div>

        <div class="nxrm-list">${renderPMCards(list)}</div>
      </div>
    `;
    wirePMView(view);
  }

  function renderPMCards(list) {
    if (!list.length) {
      return `
        <div class="nxrm-empty">
          <div class="nxrm-empty-glyph">○</div>
          <div class="nxrm-empty-title">${state.schedules.length === 0 ? 'No PM schedules yet' : 'Nothing matches'}</div>
          <div class="nxrm-empty-body">
            ${state.schedules.length === 0
              ? 'Set up a recurring schedule (hood cleaning every 90 days, filter change every 30 days, etc.) and they will auto-generate work orders.'
              : 'Try widening the filter.'}
          </div>
        </div>`;
    }
    return list.map(s => {
      const u = URGENCY[s.urgency] || URGENCY.distant;
      return `
        <button class="nxrm-pm-card ${u.tone}" data-schedule-id="${esc(s.id)}">
          <div class="nxrm-pm-glyph">${u.glyph}</div>
          <div class="nxrm-pm-body">
            <div class="nxrm-pm-row1">
              <span class="nxrm-pm-urgency">${u.label}</span>
              <span class="nxrm-pm-when">${fmt.days(s.days_until_due)}</span>
            </div>
            <div class="nxrm-pm-title">${esc(s.title || 'PM task')}</div>
            <div class="nxrm-pm-row2">
              <span>${esc(s.equipment_name || '—')}</span>
              ${s.restaurant ? '<span class="nxrm-sep">·</span><span>' + esc(s.restaurant) + '</span>' : ''}
              <span class="nxrm-sep">·</span>
              <span class="nxrm-pm-freq">every ${s.frequency_days}d</span>
            </div>
            ${s.assigned_to ? `<div class="nxrm-pm-meta">→ ${esc(s.assigned_to)}</div>` : ''}
          </div>
          <div class="nxrm-pm-action">
            <button class="nxrm-pm-done" data-mark-done="${esc(s.id)}" type="button">
              ✓ Mark<br>done
            </button>
          </div>
        </button>`;
    }).join('');
  }

  function wirePMView(view) {
    view.querySelectorAll('[data-filter-urgency]').forEach(el => {
      el.addEventListener('click', () => {
        state.filter.urgency = el.getAttribute('data-filter-urgency');
        renderPMView();
      });
    });
    view.querySelectorAll('[data-quick]').forEach(el => {
      el.addEventListener('click', () => {
        state.filter.urgency = el.getAttribute('data-quick');
        renderPMView();
      });
    });
    const search = view.querySelector('#pmSearch');
    if (search) {
      let t;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.filter.search = search.value || '';
          renderPMView();
          const fresh = document.querySelector('#pmSearch');
          if (fresh) { fresh.focus(); fresh.setSelectionRange(fresh.value.length, fresh.value.length); }
        }, 220);
      });
    }
    view.querySelectorAll('[data-mark-done]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        await markScheduleDone(el.getAttribute('data-mark-done'));
      });
    });
    view.querySelectorAll('[data-schedule-id]').forEach(el => {
      el.addEventListener('click', () => {
        const s = state.schedules.find(x => x.id === el.getAttribute('data-schedule-id'));
        if (s) editSchedule(s);
      });
    });
    const newBtn = view.querySelector('[data-act="new-schedule"]');
    if (newBtn) newBtn.addEventListener('click', createSchedule);
  }

  async function markScheduleDone(scheduleId) {
    const s = state.schedules.find(x => x.id === scheduleId);
    if (!s) return;
    if (!confirm(`Mark "${s.title}" complete?\n\nThis creates a pm_log entry and advances the next due date by ${s.frequency_days} days.`)) return;
    if (!NX?.sb) return;

    const now = new Date().toISOString();
    const { error } = await NX.sb.from('pm_schedules').update({
      last_run_at: now, updated_at: now,
    }).eq('id', scheduleId);
    if (error) { alert('Failed: ' + error.message); return; }

    try {
      await NX.sb.from('pm_logs').insert({
        equipment_id: s.equipment_id,
        service_type: s.title || 'Scheduled PM',
        work_performed: 'Completed via NEXUS PM Schedule: ' + s.title,
        service_date: now.slice(0, 10),
        contractor_name: s.assigned_to || NX.user?.name || NX.currentUser?.name || 'Staff',
        review_status: 'approved',
        submitted_at: now,
      });
    } catch (_) {}

    NXRM.notify.bubble(`Bzzt — ${s.title} done. Next due in ${s.frequency_days} days.`,
      { autoHide: 3500, eyebrow: '✓ PM' });

    await loadSchedules();
    renderPMView();
  }

  async function createSchedule() {
    if (!NX?.sb) return;
    await loadEquipment();
    if (!state.equipment.length) { alert('No equipment found.'); return; }

    const eqOpts = state.equipment.map((e, i) => `${i + 1}. ${e.name} (${e.restaurant})`).join('\n');
    const pick = prompt('Pick equipment by number:\n\n' + eqOpts);
    if (pick === null) return;
    const idx = parseInt(pick, 10) - 1;
    if (isNaN(idx) || !state.equipment[idx]) { alert('Invalid pick.'); return; }
    const eq = state.equipment[idx];

    const title = prompt('What is this PM? (e.g., "Hood cleaning", "Filter change")');
    if (!title) return;
    const freq = prompt('How often (in days)? (e.g., 30, 90, 180)');
    const freqNum = parseInt(freq, 10);
    if (isNaN(freqNum) || freqNum < 1) { alert('Invalid frequency.'); return; }
    const assignedTo = prompt('Who handles this? (optional)') || null;

    const { error } = await NX.sb.from('pm_schedules').insert({
      equipment_id: eq.id,
      title,
      frequency_days: freqNum,
      assigned_to: assignedTo,
      active: true,
    });
    if (error) { alert('Failed: ' + error.message); return; }
    NXRM.notify.bubble(`Bzzt — new PM schedule for ${eq.name}. Every ${freqNum} days.`,
      { autoHide: 3500, eyebrow: '✓ SCHEDULED' });

    // If this schedule is already past due, create a board card now.
    // Force the throttle since this is a deliberate user action.
    if (NX.domain?.checkPMsDue) {
      NX.domain.checkPMsDue({ force: true }).catch(e => {
        console.warn('[pm createSchedule] checkPMsDue hook failed:', e);
      });
    }

    await loadSchedules();
    renderPMView();
  }

  async function editSchedule(s) {
    const action = prompt(
      `${s.title}\n\nWhat do you want to do?\n\n1 = edit details\n2 = pause (deactivate)\n3 = delete\n(cancel = nothing)`);
    if (action === '1') {
      const newTitle = prompt('Title:', s.title);
      if (newTitle === null) return;
      const newFreq = prompt('Frequency days:', s.frequency_days);
      if (newFreq === null) return;
      const newAssigned = prompt('Assigned to:', s.assigned_to || '');
      await NX.sb.from('pm_schedules').update({
        title: newTitle,
        frequency_days: parseInt(newFreq, 10) || s.frequency_days,
        assigned_to: newAssigned || null,
        updated_at: new Date().toISOString(),
      }).eq('id', s.id);
      await loadSchedules();
      renderPMView();
    } else if (action === '2') {
      await NX.sb.from('pm_schedules').update({ active: false }).eq('id', s.id);
      await loadSchedules();
      renderPMView();
    } else if (action === '3') {
      if (confirm(`Permanently delete "${s.title}"?`)) {
        await NX.sb.from('pm_schedules').delete().eq('id', s.id);
        await loadSchedules();
        renderPMView();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // §2 — QUICK-CREATE (NXQuickCreate)
  // ─────────────────────────────────────────────────────────────────────

  async function openQuickCreate(equipmentId) {
    await Promise.all([loadTemplates(), loadEquipment()]);
    if (!state.templates.length) {
      // Fall back to a single prompt
      const title = prompt('What is the issue?');
      if (!title) return;
      let eqId = equipmentId;
      if (!eqId) {
        eqId = await pickEquipment();
        if (!eqId) return;
      }
      return createIssue({ equipment_id: eqId, title, priority: 'normal' });
    }

    const html = `
      <div class="nxrm-card-head">
        <div class="nxrm-eyebrow">QUICK CREATE</div>
        <div class="nxrm-h1">New Work Order</div>
        <button class="nxrm-close" data-close>✕</button>
      </div>
      <div class="nxrm-section-title">Common issues</div>
      <div class="nxrm-template-grid">
        ${state.templates.map(t => `
          <button class="nxrm-template-card" data-template-id="${esc(t.id)}">
            <div class="nxrm-template-glyph">${esc(t.glyph || '🔧')}</div>
            <div class="nxrm-template-title">${esc(t.title)}</div>
            ${t.default_priority === 'critical' || t.default_priority === 'high'
              ? `<div class="nxrm-template-pri">${esc(t.default_priority.toUpperCase())}</div>` : ''}
          </button>
        `).join('')}
      </div>
      <div class="nxrm-or">— or —</div>
      <button class="nxrm-template-custom" data-act="custom">✎ Write custom title</button>
    `;
    const { el, close } = NXRM.overlay.open(html);

    el.querySelectorAll('[data-template-id]').forEach(b => {
      b.addEventListener('click', async () => {
        const tpl = state.templates.find(t => t.id === b.getAttribute('data-template-id'));
        if (!tpl) return;
        close();
        await handleTemplatePick(tpl, equipmentId);
      });
    });
    el.querySelector('[data-act="custom"]').addEventListener('click', async () => {
      close();
      let eqId = equipmentId;
      if (!eqId) {
        eqId = await pickEquipment();
        if (!eqId) return;
      }
      const title = prompt('What is the issue?');
      if (!title) return;
      const priority = (prompt('Priority? (critical / high / normal / low):', 'normal') || 'normal').toLowerCase();
      await createIssue({ equipment_id: eqId, title, priority });
    });
  }

  async function handleTemplatePick(template, equipmentId) {
    let eqId = equipmentId;
    if (!eqId) {
      eqId = await pickEquipment(template.category);
      if (!eqId) return;
    }
    // Offer troubleshooting first
    const ts = await maybeOfferTroubleshooting(template.category, template.fault_category);
    if (ts === 'resolved') {
      NXRM.notify.bubble('Bzzt — saved you a call. Nicely done.',
        { autoHide: 3500, eyebrow: '✓ SELF-FIXED' });
      return;
    }
    await createIssue({
      equipment_id: eqId,
      title: template.title,
      description: template.description,
      priority: template.default_priority,
      fault_category: template.fault_category,
    });
  }

  function pickEquipment(filterCategory) {
    return new Promise((resolve) => {
      const list = filterCategory && state.equipment.some(e => e.category === filterCategory)
        ? state.equipment.filter(e => e.category === filterCategory)
        : state.equipment;
      if (!list.length) { alert('No equipment found.'); resolve(null); return; }

      const html = `
        <div class="nxrm-card-head">
          <div class="nxrm-eyebrow">PICK EQUIPMENT</div>
          <div class="nxrm-h1">Which equipment?</div>
          <button class="nxrm-close" data-close>✕</button>
        </div>
        <input class="nxrm-search" placeholder="Search equipment…"
               id="qcEqSearch" style="width:100%;margin-bottom:10px;">
        <div class="nxrm-eq-list" id="qcEqList">
          ${list.map(e => `
            <button class="nxrm-eq-row" data-eq-id="${esc(e.id)}">
              <div class="nxrm-eq-name">${esc(e.name)}</div>
              <div class="nxrm-eq-meta">${esc(e.restaurant || '')} ${e.category ? '· ' + esc(e.category) : ''}</div>
            </button>
          `).join('')}
        </div>
      `;
      const { el, close } = NXRM.overlay.open(html);

      const search = el.querySelector('#qcEqSearch');
      const listEl = el.querySelector('#qcEqList');
      function wireRows(items) {
        listEl.innerHTML = items.map(e => `
          <button class="nxrm-eq-row" data-eq-id="${esc(e.id)}">
            <div class="nxrm-eq-name">${esc(e.name)}</div>
            <div class="nxrm-eq-meta">${esc(e.restaurant || '')} ${e.category ? '· ' + esc(e.category) : ''}</div>
          </button>
        `).join('');
        listEl.querySelectorAll('[data-eq-id]').forEach(b => {
          b.addEventListener('click', () => {
            close();
            resolve(b.getAttribute('data-eq-id'));
          });
        });
      }
      wireRows(list);
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase();
        wireRows(list.filter(e =>
          e.name.toLowerCase().includes(q) ||
          (e.restaurant || '').toLowerCase().includes(q)));
      });
      el.querySelector('[data-close]').addEventListener('click', () => { close(); resolve(null); });
      el.addEventListener('click', (e) => {
        if (e.target === el) { close(); resolve(null); }
      });
    });
  }

  async function createIssue(payload) {
    if (!NX?.sb) return;
    const insert = {
      ...payload,
      status: 'reported',
      reported_at: new Date().toISOString(),
      reported_by: NX.user?.id || NX.currentUser?.id || null,
      reported_by_name: NX.user?.name || NX.currentUser?.name || 'You',
    };
    const { data, error } = await NX.sb.from('equipment_issues')
      .insert(insert).select('*').single();
    if (error) { alert('Failed to create: ' + error.message); return; }

    NXRM.notify.bubble(`Bzzt — work order opened: ${payload.title}`,
      { autoHide: 3500, eyebrow: '🔴 NEW' });

    NXRM.view.switchTo('equipment');
    setTimeout(() => {
      if (typeof window.eqOpenDetail === 'function') {
        window.eqOpenDetail(payload.equipment_id, { focusIssue: data?.id });
      }
    }, 200);

    if (window.NXIssues?.refresh) window.NXIssues.refresh();
  }

  // ─────────────────────────────────────────────────────────────────────
  // §3 — TROUBLESHOOTING WIZARD
  // ─────────────────────────────────────────────────────────────────────

  function findMatchingSteps(equipmentCategory, faultCategory) {
    const eq = (equipmentCategory || '').toLowerCase();
    const f  = (faultCategory || '').toLowerCase();
    return state.troubleSteps.filter(s => {
      const matchCat = !eq || (s.equipment_category || '').toLowerCase() === eq;
      const matchFault = !f || (s.fault_category || '').toLowerCase() === f;
      return matchCat && matchFault;
    });
  }

  function maybeOfferTroubleshooting(equipmentCategory, faultCategory) {
    return new Promise(async (resolve) => {
      await loadTroubleSteps();
      const matching = findMatchingSteps(equipmentCategory, faultCategory);
      if (!matching.length) { resolve('continue'); return; }
      const wizard = matching[0];

      const html = `
        <div class="nxrm-card-head">
          <div class="nxrm-eyebrow">⚡ TRY THIS FIRST</div>
          <div class="nxrm-h1">${esc(wizard.title)}</div>
          <button class="nxrm-close" data-close>✕</button>
        </div>
        <div class="nxrm-ts-meta">
          ${wizard.est_minutes ? '<span class="nxrm-ts-chip">⏱ ' + wizard.est_minutes + ' min</span>' : ''}
          ${wizard.success_rate ? '<span class="nxrm-ts-chip">' + wizard.success_rate + '% fix it themselves</span>' : ''}
          ${wizard.difficulty ? '<span class="nxrm-ts-chip">' + esc(wizard.difficulty.toUpperCase()) + '</span>' : ''}
        </div>
        <div class="nxrm-ts-intro">
          Quick checks before calling a vendor. Most ${esc(equipmentCategory || 'equipment')} issues clear after these steps.
        </div>
        <ol class="nxrm-ts-steps">
          ${(wizard.steps || []).map((step, i) => `
            <li class="nxrm-ts-step">
              <input type="checkbox" id="ts-${i}" class="nxrm-ts-check">
              <label for="ts-${i}" class="nxrm-ts-label">${esc(step)}</label>
            </li>
          `).join('')}
        </ol>
        ${matching.length > 1 ? `
          <div class="nxrm-ts-additional">
            ${matching.length - 1} more troubleshooting guide${matching.length > 2 ? 's' : ''} available after creating the issue.
          </div>
        ` : ''}
        <div class="nxrm-ts-actions">
          <button class="nxrm-ts-btn is-success"  data-ts="resolved">✓ Resolved — no call needed</button>
          <button class="nxrm-ts-btn is-fallback" data-ts="continue">Still broken — create work order</button>
          <button class="nxrm-ts-btn is-skip"     data-ts="skip">Skip wizard</button>
        </div>
      `;
      const { el, close } = NXRM.overlay.open(html, { cardClass: 'nxrm-ts-card' });

      async function logOutcome(outcome) {
        if (!NX?.sb) return;
        try {
          const checked = el.querySelectorAll('.nxrm-ts-check:checked').length;
          await NX.sb.from('troubleshooting_outcomes').insert({
            step_id: wizard.id,
            equipment_category: equipmentCategory,
            fault_category: faultCategory,
            steps_checked: checked,
            outcome,
            resolved_at: new Date().toISOString(),
            user_id: NX.user?.id || NX.currentUser?.id || null,
          });
        } catch (_) {}
      }

      el.querySelector('[data-ts="resolved"]').addEventListener('click', async () => {
        await logOutcome('resolved');
        close();
        resolve('resolved');
      });
      el.querySelector('[data-ts="continue"]').addEventListener('click', async () => {
        await logOutcome('still_broken');
        close();
        resolve('continue');
      });
      el.querySelector('[data-ts="skip"]').addEventListener('click', () => {
        close();
        resolve('continue');
      });
      el.querySelector('[data-close]').addEventListener('click', () => {
        close();
        resolve('continue');
      });
    });
  }

  async function openTroubleshootingLibrary(equipmentCategory) {
    await loadTroubleSteps();
    const matching = equipmentCategory
      ? findMatchingSteps(equipmentCategory, null)
      : state.troubleSteps;
    if (!matching.length) { alert('No troubleshooting guides available yet.'); return; }

    const html = `
      <div class="nxrm-card-head">
        <div class="nxrm-eyebrow">TROUBLESHOOTING LIBRARY</div>
        <div class="nxrm-h1">${esc(equipmentCategory || 'All categories')}</div>
        <button class="nxrm-close" data-close>✕</button>
      </div>
      <div class="nxrm-ts-library">
        ${matching.map(s => `
          <details class="nxrm-ts-guide">
            <summary class="nxrm-ts-guide-summary">
              <span class="nxrm-ts-guide-title">${esc(s.title)}</span>
              <span class="nxrm-ts-chip">${s.est_minutes || '?'} min · ${s.difficulty || '—'}</span>
            </summary>
            <ol class="nxrm-ts-steps">
              ${(s.steps || []).map(step => '<li class="nxrm-ts-step-static">' + esc(step) + '</li>').join('')}
            </ol>
          </details>
        `).join('')}
      </div>
    `;
    NXRM.overlay.open(html, { cardClass: 'nxrm-ts-card' });
  }

  // ─────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────

  const debouncedReload = NXRM.realtime.debounce(async () => {
    await loadSchedules();
    if (document.querySelector('#pmView')?.classList.contains('active')
        || document.querySelector('#pmView')) {
      renderPMView();
    }
  }, 600);

  function subscribe() {
    NXRM.realtime.subscribe('rm-pm', [
      { filter: { event: '*', schema: 'public', table: 'pm_schedules' },
        handler: debouncedReload },
    ]);
  }

  const mod = {
    async init() {
      NXRM.view.ensure('pmView', 'pm');
      await Promise.all([loadSchedules(), loadTemplates(), loadTroubleSteps(), loadEquipment()]);
      subscribe();
      state.loaded = true;
      renderPMView();
    },
    async show() {
      if (!state.loaded) await this.init();
      else { await loadSchedules(); renderPMView(); }
    },
    async refresh() { return loadSchedules().then(renderPMView); },
  };

  if (window.NX) {
    NX.modules = NX.modules || {};
    NX.modules.pm = mod;
  }

  // ─────────────────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────────────────

  window.NXQuickCreate = {
    open: openQuickCreate,
    refresh: async () => {
      state.templates = []; state.equipment = [];
      await Promise.all([loadTemplates(), loadEquipment()]);
    },
  };

  window.NXTroubleshoot = {
    maybeOffer: maybeOfferTroubleshooting,
    openLibrary: openTroubleshootingLibrary,
    refresh: async () => { state.troubleSteps = []; return loadTroubleSteps(); },
  };
})();
