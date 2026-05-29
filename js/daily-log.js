/* ════════════════════════════════════════════════════════════════════════
   NEXUS Daily Facilities Log — v18.32 (Phase 1: form + Supabase save)
   ════════════════════════════════════════════════════════════════════════
   Mirrors the Facilities Daily Log template structure (Word doc kept in
   Drive). Sections:
     • Header           — Date, Weather, Significant Events
     • Planning         — Tomorrow's Plan, This Week, Side Notes
     • ESTE             — 10 R&M categories + vendor calls table
     • SUERTE           — same as ESTE
     • Other Properties — name + notes (catch-all, includes Bar Toti)
     • Cleaning         — 7 fields (attendance, performance, training, etc.)

   Data model: the entire filled template lives as JSONB in
   `facility_logs.data` so the schema doesn't have to evolve when the
   template does. Lookup is by (log_date, created_by) — one log per
   user per day. Idempotent upsert.

   TABLE NAME NOTE: this module writes to `facility_logs`, NOT
   `daily_logs`. The first version of this code used `daily_logs` but
   that name was already taken by the system-wide activity feed (AI
   logger / brain-chat / cleaning summaries). Renamed to facility_logs
   after the schema-cache collision was caught.

   Phase 1 ships the form + save. Phase 2 wires document generation
   (filled Google Doc) and Drive upload via the existing browser OAuth
   token — see js/nx-drive.js.
   ════════════════════════════════════════════════════════════════════════ */
(function(){

const SECTIONS_TEMPLATE = {
  header: {
    date: '',                       // YYYY-MM-DD
    weather: '',
    significant_events: '',
  },
  planning: {
    tomorrow_plan: '',
    this_week: '',
    side_notes: '',
  },
  este: {
    hvac: '', refrigeration: '', cooking: '', plumbing: '',
    electrical: '', interior: '', landscaping: '', furniture: '',
    restrooms: '', safety: '',
    vendor_calls: [],               // [{date, vendor, equipment, issue, status}]
  },
  suerte: {
    hvac: '', refrigeration: '', cooking: '', plumbing: '',
    electrical: '', interior: '', landscaping: '', furniture: '',
    restrooms: '', safety: '',
    vendor_calls: [],
  },
  other_properties: [],             // [{property_name, notes}]
  cleaning: {
    attendance: '',
    performance: '',
    training: '',
    requested_tasks: '',
    weekly_tasks: '',
    monthly_tasks: '',
    quarterly_tasks: '',
  },
  // PLACEHOLDER — Orion will define the real biweekly items later.
  // Stored as boolean-per-item so the eventual real list is a drop-in
  // replacement (just swap BIWEEKLY_PLACEHOLDER_ITEMS, the storage shape
  // stays the same). When the real list arrives we'll likely also add
  // last-completed-date logic (only show section every 14 days, or
  // surface a "due now" badge).
  biweekly: {
    item_1: false,
    item_2: false,
    item_3: false,
    item_4: false,
    item_5: false,
  },
};

// PLACEHOLDER list — will be replaced with real items later
const BIWEEKLY_PLACEHOLDER_ITEMS = [
  { key: 'item_1', label: 'Biweekly check — placeholder item 1' },
  { key: 'item_2', label: 'Biweekly check — placeholder item 2' },
  { key: 'item_3', label: 'Biweekly check — placeholder item 3' },
  { key: 'item_4', label: 'Biweekly check — placeholder item 4' },
  { key: 'item_5', label: 'Biweekly check — placeholder item 5' },
];

// R&M category labels — used to render the 10 fields for ESTE + SUERTE
const RM_CATEGORIES = [
  { key: 'hvac',         label: 'HVAC' },
  { key: 'refrigeration',label: 'Refrigeration' },
  { key: 'cooking',      label: 'Cooking Equipment' },
  { key: 'plumbing',     label: 'Plumbing' },
  { key: 'electrical',   label: 'Electrical / IT / Internet' },
  { key: 'interior',     label: 'Interior' },
  { key: 'landscaping',  label: 'Landscaping / Exterior' },
  { key: 'furniture',    label: 'Furniture' },
  { key: 'restrooms',    label: 'Restrooms' },
  { key: 'safety',       label: 'Safety / Security' },
];

const CLEANING_FIELDS = [
  { key: 'attendance',       label: 'Attendance / Coverage' },
  { key: 'performance',      label: 'Performance & Recognition' },
  { key: 'training',         label: 'Training & Assignments' },
  { key: 'requested_tasks',  label: 'Requested Cleaning Tasks (by Mgmt)' },
  { key: 'weekly_tasks',     label: 'Upcoming Weekly Tasks' },
  { key: 'monthly_tasks',    label: 'Upcoming Monthly Tasks' },
  { key: 'quarterly_tasks',  label: 'Upcoming Quarterly Tasks' },
];

// In-memory state
let state = {
  currentLog: null,         // { id, log_date, data, drive_*, etc. }
  recentLogs: [],           // [{ id, log_date, created_by_name, drive_upload_status }]
  dirty: false,
  saveTimer: null,
  isLoading: false,
};

// ─── Helpers ────────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const friendlyDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Merge a saved log's data over the template skeleton — protects against
// schema drift (saved logs missing newly-added fields don't crash render)
function hydrateData(saved) {
  const base = deepClone(SECTIONS_TEMPLATE);
  if (!saved) return base;
  for (const section of Object.keys(base)) {
    if (saved[section] == null) continue;
    if (Array.isArray(base[section])) {
      base[section] = Array.isArray(saved[section]) ? saved[section] : base[section];
    } else if (typeof base[section] === 'object') {
      base[section] = Object.assign({}, base[section], saved[section]);
    } else {
      base[section] = saved[section];
    }
  }
  return base;
}

// ─── Supabase I/O ───────────────────────────────────────────────────
async function loadRecentLogs() {
  if (!NX.sb) return [];
  const user = NX.currentUser;
  const userId = user && user.id;
  let q = NX.sb.from('facility_logs')
    .select('id, log_date, created_by, created_by_name, drive_upload_status, drive_file_url, submitted_at')
    .order('log_date', { ascending: false })
    .limit(30);
  if (userId) q = q.eq('created_by', userId);
  const { data, error } = await q;
  if (error) {
    console.error('[daily-log] loadRecentLogs:', error);
    return [];
  }
  return data || [];
}

async function loadLog(logDate) {
  if (!NX.sb) return null;
  const user = NX.currentUser;
  const userId = user && user.id;
  if (!userId) return null;
  const { data, error } = await NX.sb.from('facility_logs')
    .select('*')
    .eq('log_date', logDate)
    .eq('created_by', userId)
    .maybeSingle();
  if (error) {
    console.error('[daily-log] loadLog:', error);
    return null;
  }
  return data;
}

async function saveLog(logData, options) {
  options = options || {};
  if (!NX.sb) return { error: 'No Supabase' };
  const user = NX.currentUser;
  if (!user || !user.id) {
    return { error: 'You need to be signed in to save a log.' };
  }
  const row = {
    log_date: logData.header.date || todayISO(),
    created_by: user.id,
    created_by_name: user.name || null,
    data: logData,
    updated_at: new Date().toISOString(),
  };
  if (options.submit) {
    row.submitted_at = new Date().toISOString();
    row.drive_upload_status = 'pending';   // Phase 2 picks this up
  }
  // Upsert by (log_date, created_by) — one log per user per day
  const { data, error } = await NX.sb.from('facility_logs')
    .upsert(row, { onConflict: 'log_date,created_by' })
    .select()
    .single();
  if (error) {
    console.error('[daily-log] saveLog:', error);
    return { error: error.message || 'Save failed' };
  }
  return { data };
}

// ─── Render ─────────────────────────────────────────────────────────
function render() {
  const view = document.getElementById('dailylogView');
  if (!view) return;

  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  const submitted = !!(log && log.submitted_at);
  const driveStatus = log && log.drive_upload_status;

  view.innerHTML = `
    <div class="dlog-shell">
      <header class="dlog-header">
        <div class="dlog-title-row">
          <h1 class="dlog-title">Daily Facilities Log</h1>
          <button class="eq-btn eq-btn-secondary" id="dlogNewBtn" title="Start a log for a different date">＋ New</button>
        </div>
        <div class="dlog-meta">
          <label class="dlog-date-pick">
            <span class="dlog-meta-label">Log date</span>
            <input type="date" id="dlogDateInput" value="${esc(d.header.date || todayISO())}" ${submitted ? 'disabled' : ''}>
          </label>
          ${submitted ? `
            <span class="dlog-status dlog-status-${driveStatus || 'pending'}">
              ${driveStatus === 'uploaded' ? '✓ Uploaded to Drive' :
                driveStatus === 'failed'   ? '✗ Drive upload failed' :
                                              '⏳ Submitted — Drive upload pending'}
            </span>
            ${(log && log.drive_file_url) ? `
              <a class="dlog-drive-link" href="${esc(log.drive_file_url)}" target="_blank" rel="noopener">Open in Drive ↗</a>
            ` : ''}
            ${driveStatus === 'failed' ? `
              <button type="button" class="eq-btn eq-btn-secondary" id="dlogRetryBtn">↻ Retry Drive upload</button>
            ` : ''}
          ` : `
            <span class="dlog-status dlog-status-draft">Draft</span>
          `}
        </div>
        ${(submitted && driveStatus === 'failed' && log && log.drive_upload_error) ? `
          <p class="dlog-error-detail">Error: ${esc(log.drive_upload_error)}</p>
        ` : ''}
      </header>

      ${renderRecentLogsStrip()}

      <form class="dlog-form" id="dlogForm" autocomplete="off" ${submitted ? 'data-locked="1"' : ''}>
        ${renderHeaderSection(d)}
        ${renderPlanningSection(d)}
        ${renderLocationSection('este',   'Este',   d.este)}
        ${renderLocationSection('suerte', 'Suerte', d.suerte)}
        ${renderOtherPropertiesSection(d)}
        ${renderCleaningSection(d)}
        ${renderBiweeklySection(d)}

        <div class="dlog-actions">
          ${submitted ? `
            <span class="dlog-locked-note">This log has been submitted. To make edits, start a new log for a different date.</span>
          ` : `
            <button type="button" class="eq-btn eq-btn-secondary" id="dlogSaveDraftBtn">Save draft</button>
            <button type="button" class="eq-btn eq-btn-primary"   id="dlogSubmitBtn">Submit</button>
          `}
        </div>
      </form>
    </div>
  `;
  wireForm();
}

function renderRecentLogsStrip() {
  if (!state.recentLogs || !state.recentLogs.length) return '';
  const rows = state.recentLogs.slice(0, 7).map(r => {
    const isOpen = state.currentLog && state.currentLog.id === r.id;
    return `
      <button type="button" class="dlog-recent-chip ${isOpen ? 'is-active' : ''}" data-log-date="${esc(r.log_date)}">
        <span class="dlog-recent-date">${esc(friendlyDate(r.log_date))}</span>
        ${r.submitted_at ? `<span class="dlog-recent-dot dlog-status-${r.drive_upload_status || 'pending'}"></span>` : ''}
      </button>
    `;
  }).join('');
  return `
    <div class="dlog-recent">
      <span class="dlog-recent-label">RECENT</span>
      <div class="dlog-recent-strip">${rows}</div>
    </div>
  `;
}

function renderHeaderSection(d) {
  return `
    <details class="dlog-section" open>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Day overview</span>
      </summary>
      <div class="dlog-section-body">
        <label class="dlog-field">
          <span class="dlog-field-label">Weather</span>
          <input type="text" data-path="header.weather" value="${esc(d.header.weather)}" placeholder="e.g. Sunny, 78°F, evening showers">
        </label>
        <label class="dlog-field">
          <span class="dlog-field-label">Significant events or disruptions</span>
          <textarea data-path="header.significant_events" rows="3" placeholder="Anything out of the ordinary today...">${esc(d.header.significant_events)}</textarea>
        </label>
      </div>
    </details>
  `;
}

function renderPlanningSection(d) {
  return `
    <details class="dlog-section">
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Planning</span>
      </summary>
      <div class="dlog-section-body">
        <label class="dlog-field">
          <span class="dlog-field-label">Tomorrow's plan</span>
          <span class="dlog-field-hint">Concrete tasks, appointments, urgent</span>
          <textarea data-path="planning.tomorrow_plan" rows="4">${esc(d.planning.tomorrow_plan)}</textarea>
        </label>
        <label class="dlog-field">
          <span class="dlog-field-label">This week / farther out</span>
          <span class="dlog-field-hint">Projects in flight, things being pushed</span>
          <textarea data-path="planning.this_week" rows="4">${esc(d.planning.this_week)}</textarea>
        </label>
        <label class="dlog-field">
          <span class="dlog-field-label">Side notes & observations</span>
          <span class="dlog-field-hint">Patterns, conversations, lessons</span>
          <textarea data-path="planning.side_notes" rows="4">${esc(d.planning.side_notes)}</textarea>
        </label>
      </div>
    </details>
  `;
}

function renderLocationSection(key, label, locData) {
  const rmFields = RM_CATEGORIES.map(cat => `
    <label class="dlog-field dlog-field-rm">
      <span class="dlog-field-label">${esc(cat.label)}</span>
      <textarea data-path="${key}.${cat.key}" rows="2">${esc(locData[cat.key] || '')}</textarea>
    </label>
  `).join('');

  const vendorRows = (locData.vendor_calls || []).map((row, idx) => `
    <div class="dlog-vendor-row" data-row-idx="${idx}">
      <input type="date" data-path="${key}.vendor_calls.${idx}.date" value="${esc(row.date || '')}" placeholder="Opened">
      <input type="text" data-path="${key}.vendor_calls.${idx}.vendor" value="${esc(row.vendor || '')}" placeholder="Vendor">
      <input type="text" data-path="${key}.vendor_calls.${idx}.equipment" value="${esc(row.equipment || '')}" placeholder="Equipment">
      <textarea data-path="${key}.vendor_calls.${idx}.issue" rows="2" placeholder="Issue">${esc(row.issue || '')}</textarea>
      <textarea data-path="${key}.vendor_calls.${idx}.status" rows="2" placeholder="Status / next steps">${esc(row.status || '')}</textarea>
      <button type="button" class="dlog-row-remove" data-remove-vendor="${key}" data-idx="${idx}" title="Remove row">×</button>
    </div>
  `).join('');

  return `
    <details class="dlog-section">
      <summary class="dlog-section-header">
        <span class="dlog-section-title">${esc(label)}</span>
      </summary>
      <div class="dlog-section-body">
        <h3 class="dlog-subsection-title">Repairs &amp; Maintenance</h3>
        <div class="dlog-rm-grid">${rmFields}</div>

        <h3 class="dlog-subsection-title">Vendor &amp; service calls</h3>
        <div class="dlog-vendor-list">
          ${vendorRows || '<p class="dlog-empty-hint">No vendor calls logged yet.</p>'}
        </div>
        <button type="button" class="eq-btn eq-btn-secondary dlog-add-row-btn" data-add-vendor="${key}">＋ Add vendor call</button>
      </div>
    </details>
  `;
}

function renderOtherPropertiesSection(d) {
  const rows = (d.other_properties || []).map((row, idx) => `
    <div class="dlog-other-row" data-row-idx="${idx}">
      <input type="text" data-path="other_properties.${idx}.property_name" value="${esc(row.property_name || '')}" placeholder="Property name (e.g. Bar Toti)">
      <textarea data-path="other_properties.${idx}.notes" rows="2" placeholder="Notes, repairs, tasks completed or pending">${esc(row.notes || '')}</textarea>
      <button type="button" class="dlog-row-remove" data-remove-other="1" data-idx="${idx}" title="Remove row">×</button>
    </div>
  `).join('');

  return `
    <details class="dlog-section">
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Other properties</span>
      </summary>
      <div class="dlog-section-body">
        <div class="dlog-other-list">
          ${rows || '<p class="dlog-empty-hint">No other properties logged yet.</p>'}
        </div>
        <button type="button" class="eq-btn eq-btn-secondary dlog-add-row-btn" id="dlogAddOtherBtn">＋ Add property</button>
      </div>
    </details>
  `;
}

function renderCleaningSection(d) {
  const fields = CLEANING_FIELDS.map(f => `
    <label class="dlog-field">
      <span class="dlog-field-label">${esc(f.label)}</span>
      <textarea data-path="cleaning.${f.key}" rows="2">${esc(d.cleaning[f.key] || '')}</textarea>
    </label>
  `).join('');
  return `
    <details class="dlog-section">
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Cleaning</span>
      </summary>
      <div class="dlog-section-body">${fields}</div>
    </details>
  `;
}

function renderBiweeklySection(d) {
  // PLACEHOLDER section — Orion will define the real items later.
  // Storage shape is boolean-per-item under data.biweekly so when the
  // real list lands the swap is just BIWEEKLY_PLACEHOLDER_ITEMS.
  const checked = d.biweekly || {};
  const checkedCount = Object.values(checked).filter(Boolean).length;
  const total = BIWEEKLY_PLACEHOLDER_ITEMS.length;
  const items = BIWEEKLY_PLACEHOLDER_ITEMS.map(item => {
    const isChecked = !!checked[item.key];
    return `
      <label class="dlog-check-row">
        <input type="checkbox" data-bipath="${esc(item.key)}" ${isChecked ? 'checked' : ''}>
        <span class="dlog-check-label">${esc(item.label)}</span>
      </label>
    `;
  }).join('');
  return `
    <details class="dlog-section">
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Biweekly Checklist</span>
        <span class="dlog-section-count">${checkedCount}/${total}</span>
      </summary>
      <div class="dlog-section-body">
        <p class="dlog-placeholder-note">⚠ Placeholder — final checklist items pending. Items here are checked off every two weeks.</p>
        <div class="dlog-check-list">${items}</div>
      </div>
    </details>
  `;
}

// ─── Wire form ───────────────────────────────────────────────────────
function wireForm() {
  const view = document.getElementById('dailylogView');
  if (!view) return;

  // ── Date input
  const dateInput = view.querySelector('#dlogDateInput');
  if (dateInput) {
    dateInput.addEventListener('change', async (e) => {
      const newDate = e.target.value;
      if (!newDate) return;
      await openLogForDate(newDate);
    });
  }

  // ── New button
  const newBtn = view.querySelector('#dlogNewBtn');
  if (newBtn) newBtn.addEventListener('click', () => openLogForDate(todayISO()));

  // ── Recent log chips
  view.querySelectorAll('[data-log-date]').forEach(btn => {
    btn.addEventListener('click', () => openLogForDate(btn.dataset.logDate));
  });

  // ── Field input/change — write to state.currentLog.data
  view.querySelectorAll('[data-path]').forEach(field => {
    field.addEventListener('input', () => {
      writeFieldToState(field.dataset.path, field.value);
      markDirty();
    });
  });

  // ── Biweekly checkboxes — separate path because checkboxes use
  // .checked (boolean) not .value (string). Storage is under
  // data.biweekly[item_key], keyed by data-bipath attribute.
  view.querySelectorAll('[data-bipath]').forEach(box => {
    box.addEventListener('change', () => {
      const log = ensureCurrentLog();
      if (!log.data.biweekly) log.data.biweekly = {};
      log.data.biweekly[box.dataset.bipath] = !!box.checked;
      markDirty();
      // Update the X/Y count in the section header live
      const countEl = view.querySelector('.dlog-section-count');
      if (countEl) {
        const checked = Object.values(log.data.biweekly).filter(Boolean).length;
        const total = BIWEEKLY_PLACEHOLDER_ITEMS.length;
        countEl.textContent = `${checked}/${total}`;
      }
    });
  });

  // ── Add vendor call
  view.querySelectorAll('[data-add-vendor]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.addVendor;
      const log = ensureCurrentLog();
      const arr = log.data[key].vendor_calls;
      arr.push({ date: '', vendor: '', equipment: '', issue: '', status: '' });
      markDirty();
      render();
    });
  });

  // ── Remove vendor row
  view.querySelectorAll('[data-remove-vendor]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.removeVendor;
      const idx = parseInt(btn.dataset.idx, 10);
      const log = ensureCurrentLog();
      log.data[key].vendor_calls.splice(idx, 1);
      markDirty();
      render();
    });
  });

  // ── Add other property
  const addOtherBtn = view.querySelector('#dlogAddOtherBtn');
  if (addOtherBtn) {
    addOtherBtn.addEventListener('click', () => {
      const log = ensureCurrentLog();
      log.data.other_properties.push({ property_name: '', notes: '' });
      markDirty();
      render();
    });
  }
  view.querySelectorAll('[data-remove-other]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const log = ensureCurrentLog();
      log.data.other_properties.splice(idx, 1);
      markDirty();
      render();
    });
  });

  // ── Save / Submit
  const saveDraft = view.querySelector('#dlogSaveDraftBtn');
  if (saveDraft) saveDraft.addEventListener('click', () => commitSave({ submit: false }));
  const submitBtn = view.querySelector('#dlogSubmitBtn');
  if (submitBtn) submitBtn.addEventListener('click', () => commitSave({ submit: true }));

  // ── Retry Drive upload (only visible when status='failed')
  const retryBtn = view.querySelector('#dlogRetryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (state.currentLog) driveUploadAndUpdateRow(state.currentLog);
    });
  }
}

function ensureCurrentLog() {
  if (!state.currentLog) {
    state.currentLog = {
      log_date: todayISO(),
      data: hydrateData(null),
      submitted_at: null,
    };
    state.currentLog.data.header.date = todayISO();
  }
  if (!state.currentLog.data) state.currentLog.data = hydrateData(null);
  return state.currentLog;
}

function writeFieldToState(path, value) {
  const log = ensureCurrentLog();
  const parts = path.split('.');
  let cur = log.data;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    // Numeric index for arrays
    if (/^\d+$/.test(parts[i + 1])) {
      if (!Array.isArray(cur[key])) cur[key] = [];
    } else if (cur[key] == null) {
      cur[key] = {};
    }
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

function markDirty() {
  state.dirty = true;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  // Autosave after 3s of typing-pause. Quiet — no toast unless it fails.
  state.saveTimer = setTimeout(() => commitSave({ submit: false, quiet: true }), 3000);
}

async function commitSave(opts) {
  opts = opts || {};
  const log = ensureCurrentLog();
  // Make sure header.date stays in sync with current date selector
  const dateInput = document.getElementById('dlogDateInput');
  if (dateInput && dateInput.value) log.data.header.date = dateInput.value;

  const result = await saveLog(log.data, { submit: !!opts.submit });
  if (result.error) {
    if (NX.toast) NX.toast('Save failed — ' + result.error, 'error', 4500);
    return;
  }
  state.currentLog = result.data;
  state.dirty = false;
  // Refresh the recent strip in the background so the new log appears there
  loadRecentLogs().then(rs => { state.recentLogs = rs; });

  if (opts.submit) {
    // ── Phase 2: Drive upload ──
    // After Supabase save succeeded, build HTML + push to Drive.
    // Failures are non-fatal here — the data is already safely saved
    // to Supabase; only the Drive artifact failed. User can retry.
    render();   // show submitted state immediately
    await driveUploadAndUpdateRow(state.currentLog);
  } else if (!opts.quiet && NX.toast) {
    NX.toast('Draft saved', 'success', 1800);
  }
}

/**
 * Upload the current log to Drive and update the Supabase row with
 * the file ID + URL + status. Called from commitSave on submit and
 * from the Retry button when upload status is 'failed'.
 */
async function driveUploadAndUpdateRow(logRow) {
  if (!logRow || !logRow.id) return;
  if (!NX.drive || !NX.drive.uploadDailyLog) {
    if (NX.toast) NX.toast('Drive helper not loaded — refresh the page', 'error', 4500);
    return;
  }
  // Optimistically show "uploading…" status
  state.currentLog.drive_upload_status = 'pending';
  render();
  if (NX.toast) NX.toast('Uploading to Drive…', 'info', 2200);

  try {
    const result = await NX.drive.uploadDailyLog(logRow.data);
    // Update Supabase row with success metadata
    const { error: updErr } = await NX.sb.from('facility_logs').update({
      drive_file_id: result.fileId,
      drive_file_url: result.webViewLink,
      drive_upload_status: 'uploaded',
      drive_upload_error: null,
      drive_uploaded_at: new Date().toISOString(),
    }).eq('id', logRow.id);
    if (updErr) {
      // Drive upload succeeded but DB update failed — log it but treat
      // as overall success since the file IS in Drive.
      console.error('[daily-log] DB update after Drive upload failed:', updErr);
    }
    state.currentLog.drive_file_id = result.fileId;
    state.currentLog.drive_file_url = result.webViewLink;
    state.currentLog.drive_upload_status = 'uploaded';
    if (NX.toast) NX.toast('✓ Uploaded to Drive', 'success', 3200);
  } catch (e) {
    console.error('[daily-log] Drive upload failed:', e);
    const errMsg = (e && e.message) ? e.message : String(e);
    // Mark as failed in Supabase so a sweep job (Phase 3) could retry
    await NX.sb.from('facility_logs').update({
      drive_upload_status: 'failed',
      drive_upload_error: errMsg,
    }).eq('id', logRow.id).then(() => {}, () => {});
    state.currentLog.drive_upload_status = 'failed';
    state.currentLog.drive_upload_error = errMsg;
    if (NX.toast) NX.toast('Drive upload failed — tap Retry', 'error', 4500);
  }
  render();
}

async function openLogForDate(iso) {
  state.isLoading = true;
  const existing = await loadLog(iso);
  if (existing) {
    state.currentLog = existing;
    if (!state.currentLog.data) state.currentLog.data = hydrateData(null);
    state.currentLog.data.header.date = iso;
  } else {
    state.currentLog = {
      log_date: iso,
      data: hydrateData(null),
      submitted_at: null,
    };
    state.currentLog.data.header.date = iso;
  }
  state.isLoading = false;
  render();
}

// ─── Module lifecycle ────────────────────────────────────────────────
async function init() {
  // Load recent + today's log in parallel
  const [rs, today] = await Promise.all([
    loadRecentLogs(),
    loadLog(todayISO()),
  ]);
  state.recentLogs = rs;
  if (today) {
    state.currentLog = today;
  } else {
    state.currentLog = {
      log_date: todayISO(),
      data: hydrateData(null),
      submitted_at: null,
    };
    state.currentLog.data.header.date = todayISO();
  }
  render();
}

async function show() {
  // Re-sync recent + current on every view activation in case data changed
  // from another device/session
  const [rs, current] = await Promise.all([
    loadRecentLogs(),
    state.currentLog ? loadLog(state.currentLog.log_date) : loadLog(todayISO()),
  ]);
  state.recentLogs = rs;
  if (current) {
    state.currentLog = current;
  } else if (!state.currentLog) {
    state.currentLog = {
      log_date: todayISO(),
      data: hydrateData(null),
      submitted_at: null,
    };
    state.currentLog.data.header.date = todayISO();
  }
  render();
}

if (!NX.modules) NX.modules = {};
NX.modules.dailylog = { init, show };

console.log('[daily-log] v18.32 Phase 1 loaded — form + Supabase save (no Drive upload yet)');

})();
