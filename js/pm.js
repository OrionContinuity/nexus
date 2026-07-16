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
    vendors:     [],
    filter:      { urgency: 'all', search: '' },
    loaded:      false,
  };

  // ─────────────────────────────────────────────────────────────────────
  // DATA
  // ─────────────────────────────────────────────────────────────────────

  // v267 — status notes ("scheduled for the 30th", "rep's mistake") live on
  // pm_schedules; the v_pm_due_soon view predates them, so merge them in
  // with one light query. Never blocks the list.
  async function mergeStatusNotes() {
    try {
      if (!state.schedules.length) return;
      const { data } = await NX.sb.from('pm_schedules')
        .select('id, status_note, status_note_by, status_note_at');
      const byId = {};
      (data || []).forEach(r => { byId[r.id] = r; });
      state.schedules.forEach(s => {
        const n = byId[s.id];
        if (n) { s.status_note = n.status_note; s.status_note_by = n.status_note_by; s.status_note_at = n.status_note_at; }
      });
    } catch (_) {}
  }

  async function loadSchedules() {
    if (!NX?.sb) return;
    try {
      const { data, error } = await NX.sb.from('v_pm_due_soon').select('*');
      if (error) throw error;
      state.schedules = data || [];
      await mergeStatusNotes();
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
        .select('id, name, restaurant:location, category, service_vendor_id').order('name');
      state.equipment = data || [];
    } catch (_) {}
  }

  // Active R&M vendors for the "Assigned to" dropdown. Display name is
  // company || name (matches vendors.js). Cached after first load.
  async function loadVendors() {
    if (!NX?.sb || state.vendors.length) return;
    try {
      const { data } = await NX.sb.from('vendors')
        .select('id, company, name').eq('active', true).order('company');
      state.vendors = (data || []).map(v => ({ id: v.id, name: v.company || v.name || 'Unnamed' }));
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

        <!-- The tiles ARE the filter — tap a number to see just those, tap
             again for all. The old duplicate chip row is gone (simpler). -->
        <div class="nxrm-tiles tiles-4">
          <button class="nxrm-tile ${overdue ? 'is-alert' : ''}${f.urgency === 'overdue' ? ' is-active' : ''}" data-quick="overdue">
            <div class="nxrm-tile-num">${overdue}</div>
            <div class="nxrm-tile-lbl">Overdue</div>
          </button>
          <button class="nxrm-tile ${dueSoon ? 'is-alert' : ''}${f.urgency === 'due_soon' ? ' is-active' : ''}" data-quick="due_soon">
            <div class="nxrm-tile-num">${dueSoon}</div>
            <div class="nxrm-tile-lbl">Due&nbsp;Soon</div>
          </button>
          <button class="nxrm-tile${f.urgency === 'upcoming' ? ' is-active' : ''}" data-quick="upcoming">
            <div class="nxrm-tile-num">${upcoming}</div>
            <div class="nxrm-tile-lbl">Upcoming</div>
          </button>
          <button class="nxrm-tile${f.urgency === 'all' ? ' is-active' : ''}" data-quick="all">
            <div class="nxrm-tile-num">${total}</div>
            <div class="nxrm-tile-lbl">All</div>
          </button>
        </div>

        <div class="nxrm-filters">
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
      // An overdue schedule with a note is acknowledged — someone already
      // explained it. Keep the honest label, drop the alarm styling.
      const noted = s.urgency === 'overdue' && !!s.status_note;
      return `
        <div class="nxrm-pm-card ${u.tone}${noted ? ' is-noted' : ''}" data-schedule-id="${esc(s.id)}" role="button" tabindex="0">
          <div class="nxrm-pm-glyph">${u.glyph}</div>
          <div class="nxrm-pm-body">
            <div class="nxrm-pm-row1">
              <span class="nxrm-pm-urgency">${u.label}${noted ? ' <span class="nxrm-pm-notedchip">· noted</span>' : ''}</span>
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
            ${s.status_note
              ? `<div class="nxrm-pm-note" data-note="${esc(s.id)}" role="button" tabindex="0" title="Tap to edit the note">📝 ${esc(s.status_note)}${s.status_note_by ? ` <span class="nxrm-pm-note-by">— ${esc(s.status_note_by)}${s.status_note_at ? ' · ' + new Date(s.status_note_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</span>` : ''}<span class="nxrm-pm-note-edit">✎</span></div>`
              : `<button class="nxrm-pm-addnote" data-note="${esc(s.id)}" type="button">＋ note</button>`}
          </div>
          <div class="nxrm-pm-action">
            <button class="nxrm-pm-done" data-mark-done="${esc(s.id)}" type="button">
              ✓ Mark<br>done
            </button>
          </div>
        </div>`;
    }).join('');
  }

  function wirePMView(view) {
    view.querySelectorAll('[data-quick]').forEach(el => {
      el.addEventListener('click', () => {
        const q = el.getAttribute('data-quick');
        // Tap the active tile again to go back to All.
        state.filter.urgency = (state.filter.urgency === q) ? 'all' : q;
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
    // v267 — the 📝 note: why a PM is late / when it's actually booked.
    // Tap the note (or "＋ note") to edit; themed sheet, not a browser prompt.
    view.querySelectorAll('[data-note]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const s = state.schedules.find(x => String(x.id) === String(el.getAttribute('data-note')));
        if (s) await editNote(s);
      });
    });
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
    if (newBtn) newBtn.addEventListener('click', bulkCreateSchedule);
  }

  // The 📝 note flow — saved on the schedule AND mirrored to
  // equipment.pm_note so the PM list, the equipment page, daily notes and
  // the daily email all tell the same story. Empty text clears the note.
  async function editNote(s) {
    if (!s || !NX.sb) return;
    // themed dialogs mark themselves via confirm.__nx (core.js)
    const ask = (NX.confirm && NX.confirm.__nx && NX.prompt) ? NX.prompt : null;
    const txt = ask
      ? await ask('Everyone sees this on the PM list, the equipment page, daily notes, and the daily email. Leave empty to clear.', {
          title: '📝 ' + (s.title || 'PM'),
          value: s.status_note || '',
          placeholder: 'e.g. scheduled for the 30th — rep rebooked',
          okLabel: 'Save', multiline: true,
        })
      : prompt(`Note for "${s.title || 'PM'}" — empty clears it.`, s.status_note || '');
    if (txt === null) return;   // cancelled
    const note = txt.trim();
    const by = (NX.currentUser && NX.currentUser.name) || null;
    const at = new Date().toISOString();
    try {
      const patch = note
        ? { status_note: note, status_note_by: by, status_note_at: at }
        : { status_note: null, status_note_by: null, status_note_at: null };
      const { error } = await NX.sb.from('pm_schedules').update(patch).eq('id', s.id);
      if (error) throw error;
      if (s.equipment_id) {
        await NX.sb.from('equipment').update(note
          ? { pm_note: note, pm_note_by: by, pm_note_at: at }
          : { pm_note: null, pm_note_by: null, pm_note_at: null }
        ).eq('id', s.equipment_id);
      }
      s.status_note = note || null; s.status_note_by = note ? by : null; s.status_note_at = note ? at : null;
      renderPMView();
      NXRM.notify.bubble(note ? '📝 Note saved — it shows everywhere this PM does.' : 'Note cleared.', 'success');
    } catch (err) {
      console.warn('[pm] note save:', err);
      NXRM.notify.bubble('Could not save the note — try again.', 'error');
    }
  }

  async function markScheduleDone(scheduleId) {
    const s = state.schedules.find(x => x.id === scheduleId);
    if (!s) return;
    // themed dialogs mark themselves via confirm.__nx (core.js); native fallback
    const sure = (NX.confirm && NX.confirm.__nx)
      ? await NX.confirm(`Mark "${s.title}" complete? This creates a pm_log entry and advances the next due date by ${s.frequency_days} days.`, { okLabel: 'Mark complete' })
      : confirm(`Mark "${s.title}" complete?\n\nThis creates a pm_log entry and advances the next due date by ${s.frequency_days} days.`);
    if (!sure) return;
    if (!NX?.sb) return;

    // Single completion path — shared with the board's drag-to-Done
    // (NX.domain.completePMSchedule). Rolls the schedule's next_due_at
    // forward, logs the PM, advances the equipment's health cadence, AND
    // archives the 'PM Due' board card so it stops lingering.
    if (NX.domain && NX.domain.completePMSchedule) {
      await NX.domain.completePMSchedule({ scheduleId, equipmentId: s.equipment_id });
    } else if (NX.sb) {
      // Fallback only if a stale domain.js is cached: at least record the run.
      const now = new Date().toISOString();
      await NX.sb.from('pm_schedules').update({ last_run_at: now, updated_at: now }).eq('id', scheduleId);
    }

    NXRM.notify.bubble(`Bzzt — ${s.title} done. Next due in ${s.frequency_days} days.`,
      { autoHide: 3500, eyebrow: '✓ PM' });

    await loadSchedules();
    renderPMView();
  }

  // Single-unit PM creation via the themed sheet (was a native prompt() chain:
  // pick-by-number → title → days → who). Same fields, same insert, same
  // post-create hooks — just the themed modal pattern the rest of pm.js uses.
  async function createSchedule() {
    if (!NX?.sb) return;
    await loadEquipment();
    if (!state.equipment.length) { NX.toast('No equipment found.', 'error'); return; }
    injectBulkStyles();

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:center';

    const eqRows = state.equipment.map(e => {
      const meta = [e.restaurant, e.category].filter(Boolean).join(' · ') || '—';
      return `<option value="${esc(e.id)}">${esc(e.name || 'Unnamed')} — ${esc(meta)}</option>`;
    }).join('');

    overlay.innerHTML = `
      <div class="pm-bulk-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.5)"></div>
      <div class="pm-bulk-sheet" style="position:relative;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;background:var(--nx-surface-solid,#1b1b24);border:1px solid var(--nx-gold-line);border-radius:16px 16px 0 0;padding:20px 18px 28px">
        <div style="font-size:18px;font-weight:700;color:var(--nx-text)">New PM schedule</div>
        <div style="font-size:12.5px;color:var(--nx-muted);margin-bottom:6px">Schedule a recurring preventive-maintenance task for one unit.</div>
        <label class="pm-bulk-lbl">Equipment</label>
        <select id="pmcEq" class="pm-bulk-input">${eqRows}</select>
        <label class="pm-bulk-lbl">Task</label>
        <input id="pmcTitle" class="pm-bulk-input" placeholder="e.g. Hood cleaning, Filter change" autocomplete="off">
        <div style="display:flex;gap:10px">
          <div style="flex:1"><label class="pm-bulk-lbl">Every (days)</label>
            <input id="pmcFreq" type="number" min="1" inputmode="numeric" class="pm-bulk-input" placeholder="e.g. 30, 90, 180"></div>
          <div style="flex:1"><label class="pm-bulk-lbl">Who handles this <span style="text-transform:none;letter-spacing:0;opacity:.6">— optional</span></label>
            <input id="pmcWho" class="pm-bulk-input" placeholder="vendor / person" autocomplete="off"></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="pmcCancel" class="pm-bulk-btn-ghost">Cancel</button>
          <button id="pmcSave" class="pm-bulk-btn-gold">Create</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const $ = s => overlay.querySelector(s);
    const close = () => overlay.remove();
    const saveBtn = $('#pmcSave');

    $('.pm-bulk-backdrop').addEventListener('click', close);
    $('#pmcCancel').addEventListener('click', close);

    saveBtn.addEventListener('click', async () => {
      const eq = state.equipment.find(e => String(e.id) === String($('#pmcEq').value));
      const title = $('#pmcTitle').value.trim();
      const freqNum = parseInt($('#pmcFreq').value, 10);
      const assignedTo = $('#pmcWho').value.trim() || null;
      if (!eq) { NX.toast('Pick a unit.', 'error'); return; }
      if (!title) { $('#pmcTitle').focus(); $('#pmcTitle').style.borderColor = 'var(--nx-red)'; return; }
      if (isNaN(freqNum) || freqNum < 1) { $('#pmcFreq').focus(); $('#pmcFreq').style.borderColor = 'var(--nx-red)'; NX.toast('Invalid frequency.', 'error'); return; }

      saveBtn.disabled = true; saveBtn.textContent = 'Creating…';
      const { error } = await NX.sb.from('pm_schedules').insert({
        equipment_id: eq.id,
        title,
        frequency_days: freqNum,
        assigned_to: assignedTo,
        active: true,
      });
      if (error) { NX.toast('Failed: ' + error.message, 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Create'; return; }

      close();
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
    });

    requestAnimationFrame(() => $('#pmcTitle')?.focus());
  }

  // Bulk PM creation — pick a task + cadence once, then check every unit it
  // applies to. Creates one recurring pm_schedules row per selected unit.
  // Replaces the old prompt() chain (single unit, numeric picking). Modeled on
  // the vendor "Assign equipment" multi-select. Renders once, then mutates the
  // DOM in place so the text fields don't lose focus/value.
  function injectBulkStyles() {
    if (document.getElementById('pm-bulk-style')) return;
    const s = document.createElement('style');
    s.id = 'pm-bulk-style';
    s.textContent = `
      .pm-bulk-lbl{display:block;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--nx-muted);margin:10px 0 5px}
      .pm-bulk-input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--nx-gold-line);background:var(--nx-surface-2);color:var(--nx-text);font-family:inherit;font-size:14px;-webkit-appearance:none;appearance:none}
      .pm-bulk-input:focus{outline:none;border-color:var(--nx-gold)}
      .pm-bulk-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 12px;border:1px solid var(--nx-gold-line);border-radius:10px;background:var(--nx-surface-1);color:var(--nx-text);font-family:inherit;cursor:pointer;margin-bottom:6px}
      .pm-bulk-row.on{border-color:var(--nx-gold);background:var(--nx-gold-soft)}
      .pm-bulk-check{flex:0 0 22px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1.5px solid var(--nx-gold-line);color:#1a1710;font-weight:800;font-size:13px}
      .pm-bulk-row.on .pm-bulk-check{background:var(--nx-gold);border-color:var(--nx-gold)}
      .pm-bulk-info{display:flex;flex-direction:column;min-width:0}
      .pm-bulk-name{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pm-bulk-meta{font-size:12px;color:var(--nx-muted)}
      .pm-bulk-btn-ghost{flex:1;padding:13px;border-radius:10px;border:1px solid var(--nx-gold-line);background:none;color:var(--nx-text);font-family:inherit;font-weight:600;cursor:pointer}
      .pm-bulk-btn-gold{flex:2;padding:13px;border-radius:10px;border:none;background:var(--nx-gold);color:#1a1710;font-weight:700;font-family:inherit;cursor:pointer}
      .pm-bulk-btn-gold:disabled{opacity:.6}
    `;
    document.head.appendChild(s);
  }

  async function bulkCreateSchedule() {
    if (!NX?.sb) return;
    await loadEquipment();
    await loadVendors();
    if (!state.equipment.length) { NX.toast('No equipment found.', 'error'); return; }
    injectBulkStyles();

    const sel = new Set();
    const iso = d => d.toISOString().slice(0, 10);
    const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
    const CADENCES = [
      { d: 7,   label: 'Weekly · 7d' },
      { d: 14,  label: 'Biweekly · 14d' },
      { d: 30,  label: 'Monthly · 30d' },
      { d: 60,  label: 'Every 2 months · 60d' },
      { d: 90,  label: 'Quarterly · 90d' },
      { d: 180, label: 'Semiannual · 180d' },
      { d: 365, label: 'Annual · 365d' },
    ];
    const DEFAULT_CADENCE = 90;
    let firstTouched = false;   // did the user hand-edit "first due"?

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:center';

    // Only offer equipment that isn't already assigned to a service vendor.
    // Once a unit has a vendor (set when its PM is created here, or via the
    // vendor "Assign equipment" flow) it drops off this list — no double-
    // assigning the same unit to two vendors.
    const available = state.equipment.filter(e => !e.service_vendor_id);

    const rows = available.map(e => {
      const meta = [e.restaurant, e.category].filter(Boolean).join(' · ') || '—';
      const hay = ((e.name || '') + ' ' + meta).toLowerCase();
      return `<button type="button" class="pm-bulk-row" data-pick="${esc(e.id)}" data-hay="${esc(hay)}">
        <span class="pm-bulk-check"></span>
        <span class="pm-bulk-info"><span class="pm-bulk-name">${esc(e.name || 'Unnamed')}</span><span class="pm-bulk-meta">${esc(meta)}</span></span>
      </button>`;
    }).join('');

    overlay.innerHTML = `
      <div class="pm-bulk-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.5)"></div>
      <div class="pm-bulk-sheet" style="position:relative;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;background:var(--nx-surface-solid,#1b1b24);border:1px solid var(--nx-gold-line);border-radius:16px 16px 0 0;padding:20px 18px 28px">
        <div style="font-size:18px;font-weight:700;color:var(--nx-text)">New PM schedule</div>
        <div style="font-size:12.5px;color:var(--nx-muted);margin-bottom:6px">Pick a task and cadence, then select every unit it applies to. One recurring schedule is created per unit.</div>
        <label class="pm-bulk-lbl">Task</label>
        <input id="pmbTitle" class="pm-bulk-input" placeholder="e.g. Hood cleaning, Filter change" autocomplete="off">
        <div style="display:flex;gap:10px">
          <div style="flex:1"><label class="pm-bulk-lbl">Cadence</label>
            <select id="pmbCadence" class="pm-bulk-input">
              ${CADENCES.map(c => `<option value="${c.d}"${c.d === DEFAULT_CADENCE ? ' selected' : ''}>${c.label}</option>`).join('')}
            </select></div>
          <div style="flex:1"><label class="pm-bulk-lbl">First due</label>
            <input id="pmbFirst" type="date" class="pm-bulk-input" value="${plusDays(DEFAULT_CADENCE)}"></div>
        </div>
        <label class="pm-bulk-lbl">Vendor <span style="text-transform:none;letter-spacing:0;opacity:.6">— optional</span></label>
        <select id="pmbVendor" class="pm-bulk-input">
          <option value="">— No vendor —</option>
          ${state.vendors.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}
        </select>
        <label class="pm-bulk-lbl" style="margin-top:8px">Equipment <span style="text-transform:none;letter-spacing:0;opacity:.6">— unassigned only</span></label>
        <input id="pmbSearch" class="pm-bulk-input" placeholder="Search equipment…" autocomplete="off">
        <div class="pm-bulk-list" style="max-height:300px;overflow-y:auto;margin:8px 0 16px">${rows || '<div style="padding:14px;color:var(--nx-muted);font-size:13px">No unassigned equipment — every unit already has a service vendor.</div>'}</div>
        <div style="display:flex;gap:10px">
          <button id="pmbCancel" class="pm-bulk-btn-ghost">Cancel</button>
          <button id="pmbSave" class="pm-bulk-btn-gold" disabled>Create · 0</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const $ = s => overlay.querySelector(s);
    const close = () => overlay.remove();
    const saveBtn = $('#pmbSave');
    const updateCount = () => { saveBtn.textContent = `Create · ${sel.size}`; saveBtn.disabled = sel.size === 0; };

    $('.pm-bulk-backdrop').addEventListener('click', close);
    $('#pmbCancel').addEventListener('click', close);

    // First-due tracks cadence until the user edits it by hand.
    $('#pmbCadence').addEventListener('change', e => {
      if (!firstTouched) $('#pmbFirst').value = plusDays(parseInt(e.target.value, 10) || DEFAULT_CADENCE);
    });
    $('#pmbFirst').addEventListener('input', () => { firstTouched = true; });

    // Search filters rows in place (no redraw → fields keep focus/value).
    $('#pmbSearch').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      overlay.querySelectorAll('.pm-bulk-row').forEach(r => {
        r.style.display = (!q || (r.dataset.hay || '').includes(q)) ? 'flex' : 'none';
      });
    });

    overlay.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.pick;
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      b.classList.toggle('on', sel.has(id));
      b.querySelector('.pm-bulk-check').textContent = sel.has(id) ? '✓' : '';
      updateCount();
    }));

    saveBtn.addEventListener('click', async () => {
      const title = $('#pmbTitle').value.trim();
      const cadence = parseInt($('#pmbCadence').value, 10) || DEFAULT_CADENCE;
      const firstDue = $('#pmbFirst').value || plusDays(cadence);
      const vendorId = $('#pmbVendor').value || null;
      const vendorName = vendorId ? (state.vendors.find(v => String(v.id) === String(vendorId))?.name || null) : null;
      if (!title) { $('#pmbTitle').focus(); $('#pmbTitle').style.borderColor = 'var(--nx-red)'; return; }
      if (!sel.size) return;

      saveBtn.disabled = true; saveBtn.textContent = 'Creating…';
      const ids = [...sel];
      const rowsToInsert = ids.map(equipment_id => ({
        equipment_id, title,
        frequency_days: cadence,
        next_due_at: firstDue,
        assigned_to: vendorName,   // human-readable, for the list "→ Vendor" line
        vendor_id: vendorId,       // FK link to the vendor record
        active: true,
      }));
      const { error } = await NX.sb.from('pm_schedules').insert(rowsToInsert);
      if (error) { NX.toast('Failed: ' + error.message, 'error'); saveBtn.disabled = false; updateCount(); return; }

      // Communicate the PM to each equipment record so the unit itself reflects
      // its service vendor + next PM + cadence (mirrors the per-vendor scheduler).
      // Best-effort, with generic column-missing recovery; never blocks the save.
      try {
        const eqUpdate = {
          next_pm_date: firstDue,
          pm_interval_days: cadence,
        };
        if (vendorId) {
          eqUpdate.service_vendor_id = vendorId;
          eqUpdate.service_contractor_node_id = null;
          eqUpdate.service_contractor_name = vendorName;
        }
        let attempt = { ...eqUpdate };
        let r = await NX.sb.from('equipment').update(attempt).in('id', ids);
        let guard = 0;
        while (r.error && guard < 6) {
          const m = /column "?([a-z_]+)"?.*does not exist/i.exec(r.error.message || '');
          if (!m || !(m[1] in attempt)) break;
          delete attempt[m[1]];
          r = await NX.sb.from('equipment').update(attempt).in('id', ids);
          guard++;
        }
      } catch (e) { console.warn('[pm bulkCreate] equipment sync failed:', e); }

      // Drop the now-assigned units from the in-memory cache so a reopened
      // modal won't list them again (they're no longer "unassigned").
      if (vendorId) {
        state.equipment.forEach(e => { if (sel.has(e.id)) e.service_vendor_id = vendorId; });
      }

      close();
      NXRM.notify.bubble(`Bzzt — ${rowsToInsert.length} PM schedule${rowsToInsert.length === 1 ? '' : 's'} created${vendorName ? ' with ' + vendorName : ''}. Every ${cadence} days.`,
        { autoHide: 3500, eyebrow: '✓ SCHEDULED' });

      // Materialize any that are already due into board cards (deliberate action).
      if (NX.domain?.checkPMsDue) {
        NX.domain.checkPMsDue({ force: true }).catch(e => console.warn('[pm bulkCreate] checkPMsDue hook failed:', e));
      }
      await loadSchedules();
      renderPMView();
    });

    requestAnimationFrame(() => $('#pmbTitle')?.focus());
  }

  // Tap a card → one clear sheet: edit the fields, or pause/delete below.
  // (Replaced the old numeric prompt() menu — "type 1, 2 or 3" is not a UI.)
  async function editSchedule(s) {
    const html = `
      <div class="nxrm-card-head">
        <div class="nxrm-eyebrow">PM SCHEDULE</div>
        <div class="nxrm-h1">${esc(s.title || 'PM task')}</div>
        <button class="nxrm-close" data-close>✕</button>
      </div>
      <div class="nxrm-sheet-form">
        <label class="nxrm-sheet-field"><span>Title</span>
          <input id="pmEsTitle" value="${esc(s.title || '')}"></label>
        <div class="nxrm-sheet-2col">
          <label class="nxrm-sheet-field"><span>Every (days)</span>
            <input id="pmEsFreq" type="number" min="1" inputmode="numeric" value="${esc(String(s.frequency_days || ''))}"></label>
          <label class="nxrm-sheet-field"><span>Assigned to</span>
            <input id="pmEsWho" value="${esc(s.assigned_to || '')}" placeholder="vendor / person"></label>
        </div>
        <button class="nxrm-btn-pill nxrm-sheet-save" data-act="save">Save changes</button>
        <div class="nxrm-sheet-row">
          <button class="nxrm-sheet-minor" data-act="note" type="button">📝 ${s.status_note ? 'Edit note' : 'Add note'}</button>
          <button class="nxrm-sheet-minor" data-act="pause" type="button">⏸ Pause</button>
          <button class="nxrm-sheet-minor is-danger" data-act="delete" type="button">Delete</button>
        </div>
      </div>`;
    const { el, close } = NXRM.overlay.open(html);
    const refresh = async () => { await loadSchedules(); renderPMView(); };
    el.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const title = (el.querySelector('#pmEsTitle').value || '').trim() || s.title;
      const freq = parseInt(el.querySelector('#pmEsFreq').value, 10) || s.frequency_days;
      const who = (el.querySelector('#pmEsWho').value || '').trim();
      close();
      const { error } = await NX.sb.from('pm_schedules').update({
        title, frequency_days: freq, assigned_to: who || null,
        updated_at: new Date().toISOString(),
      }).eq('id', s.id);
      if (error) { console.warn('[pm] edit save:', error); NXRM.notify.bubble('Could not save — try again.', 'error'); return; }
      await refresh();
    });
    el.querySelector('[data-act="note"]').addEventListener('click', async () => {
      close();
      await editNote(s);
    });
    el.querySelector('[data-act="pause"]').addEventListener('click', async () => {
      close();
      const { error } = await NX.sb.from('pm_schedules').update({ active: false }).eq('id', s.id);
      if (error) { console.warn('[pm] pause:', error); NXRM.notify.bubble('Could not pause — try again.', 'error'); return; }
      NXRM.notify.bubble('Paused — it will not generate work until reactivated.', 'success');
      await refresh();
    });
    el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      const sure = (NX.confirm && NX.confirm.__nx)
        ? await NX.confirm(`Permanently delete "${s.title}"?`, { danger: true, okLabel: 'Delete' })
        : confirm(`Permanently delete "${s.title}"?`);
      if (!sure) return;
      close();
      const { error } = await NX.sb.from('pm_schedules').delete().eq('id', s.id);
      if (error) { console.warn('[pm] delete:', error); NXRM.notify.bubble('Could not delete — try again.', 'error'); return; }
      await refresh();
    });
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
      if (!list.length) { NX.toast('No equipment found.', 'error'); resolve(null); return; }

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
    if (error) { NX.toast('Failed to create: ' + error.message, 'error'); return; }

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
    if (!matching.length) { NX.toast('No troubleshooting guides available yet.', 'info'); return; }

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
