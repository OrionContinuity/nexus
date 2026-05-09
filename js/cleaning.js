/* ════════════════════════════════════════════════════════════════════════════
   NEXUS Cleaning v12 — DB-backed catalog · Freshness · Assignees · Email
   ────────────────────────────────────────────────────────────────────────────
   Replaces v11's hardcoded DEFAULTS + localStorage-only customs with a
   database-backed task catalog (cleaning_tasks). Adds:

     • Per-task editing — same pattern as the ordering catalog. Every task
       is editable: name (es/en), section, frequency, days-of-week, assignee,
       notes. No more "delete and re-add" workflow.

     • Quarterly + annual frequency — "Pressure wash patio" now schedulable.

     • Per-task assignee — initials chip on each row, dropdown in the edit
       form, populated from nexus_users via the list_user_names RPC.

     • Per-task days-of-week — "Mop bar Mon/Wed/Fri" different from "Mop
       floor every day". Toggleable pills on weekly-frequency tasks.

     • Freshness — replaces ad-hoc "OVERDUE Xd" / "Last: Xd ago" strings
       with a continuous 0-100 metric, color-bar visualization (matches
       equipment health), aggregated section + location summary.

     • Submit & email — one-tap composes a fully-formatted mailto: with
       per-section breakdown, who-did-what, missed items, and extras. Uses
       the shared NX.email engine so the format matches order emails.

     • Soft-delete archive — tasks get archived (not deleted), restorable
       from the unified NX.archive overlay (above duties).

   Reuses, doesn't replicate: NX.composer, NX.toast, NX.email, NX.archive,
   NX.i18n, NX.currentUser, NX.homeGalaxyPulse. Falls back gracefully when
   any dependency is missing.

   The cleaning_logs table keeps its existing schema — task identity in the
   log uses (location, section_es, task_order) so the audit trail survives
   the migration. v11 logs continue to work.
   ════════════════════════════════════════════════════════════════════════════ */

(function () {

  // ─── INLINE SVGS — kept verbatim from v11 (works with currentColor) ───
  const ICONS = {
    check:    '<polyline points="20 6 9 17 4 12"/>',
    circle:   '<circle cx="12" cy="12" r="9"/>',
    close:    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    pen:      '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    plus:     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    chevron:  '<polyline points="6 9 12 15 18 9"/>',
    trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    user:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    mail:     '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    archive:  '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
    camera:   '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    award:    '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    play:     '<polygon points="5 3 19 12 5 21 5 3"/>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    alert:    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  };
  function svg(key, size = 14, stroke = 2) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex-shrink:0">${ICONS[key] || ''}</svg>`;
  }

  // ─── HTML escape ──────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  // ─── CONSTANTS ────────────────────────────────────────────────────────
  const LOCATIONS = ['suerte', 'este', 'toti'];
  const FREQUENCY_DEFINITIONS = [
    { type: 'daily',     days:   1, labelEn: 'Daily',     labelEs: 'Diario' },
    { type: 'weekly',    days:   7, labelEn: 'Weekly',    labelEs: 'Semanal' },
    { type: 'biweekly',  days:  14, labelEn: 'Bi-Weekly', labelEs: 'Bi-Semanal' },
    { type: 'monthly',   days:  30, labelEn: 'Monthly',   labelEs: 'Mensual' },
    { type: 'quarterly', days:  90, labelEn: 'Quarterly', labelEs: 'Trimestral' },
    { type: 'annual',    days: 365, labelEn: 'Annual',    labelEs: 'Anual' },
    { type: 'custom',    days: null, labelEn: 'Custom',   labelEs: 'Personalizado' },
  ];
  const FREQ_BY_TYPE = Object.fromEntries(FREQUENCY_DEFINITIONS.map(f => [f.type, f]));
  const WEEKDAY_KEYS  = ['SU','MO','TU','WE','TH','FR','SA'];
  const WEEKDAY_LABEL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // Daily frequencies (1-day) get section status simplified to "today's
  // shift". Anything longer-than-daily gets the freshness bar treatment.
  const DAILY_TYPES = new Set(['daily']);

  // ─── STATE ────────────────────────────────────────────────────────────
  let activeLoc = 'suerte';
  let tasksByLoc = {};        // { suerte: [tasks], este: [...], toti: [...] }
  let lastDoneByKey = {};     // { 'sectionEs_taskOrder': { date: 'YYYY-MM-DD', by: 'name' } }
  let todayStateByKey = {};   // { 'sectionEs_taskOrder': { done: true, by: 'Orion' } }
  let usersList = [];         // [{ id, name, role }]
  let editingTaskId = null;   // uuid of task currently being edited inline
  let addingToSection = null; // section_es of the section getting a new task added
  let collapsedSections = new Set();   // section_es strings collapsed
  let linkedBoardCards = {};  // { 'location__sectionEs': cardId } — overdue → board

  // ─── PHOTOS + COSTS state (v12.1) ──────────────────────────────────────
  // Photo evidence per (location, log_date, section, task_index). Loaded
  // once per location-switch in loadAttachments(); rebuilt in render().
  // Keyed the same way as cleaning_logs entries.
  let attachmentsByKey = {};       // { 'sec_taskOrder': [{id, file_url, ...}] }
  let costsByKey       = {};       // { 'sec_taskOrder': { cost, note } }  — last seen for a date
  // Active per-task notes (v12.4). Map of cleaning_task_id → most-recent
  // active note row. "Active" = not dismissed AND not yet expired.
  let notesByTaskId    = {};
  // "Coming up" lookahead — populated on render from non-daily tasks
  // whose freshness is heading toward zero in the next 7 days. Renders
  // as a horizontal scroll strip above the section cards.
  const COMING_UP_DAYS = 7;

  // ─── VIEW MODE (v12.2) ────────────────────────────────────────────────
  // 'today' = show only sections that have at least one daily task. The
  //           Coming-Up strip still surfaces non-daily things due soon.
  // 'all'   = show every section (daily + bi-weekly + monthly + etc).
  // Persisted per-user in localStorage. Default 'today' so the busy
  // morning open isn't drowned in monthly/quarterly noise.
  const VIEW_MODES = ['today', 'all'];
  let viewMode = (() => {
    try {
      const saved = localStorage.getItem('nexus_clean_view_mode');
      return VIEW_MODES.includes(saved) ? saved : 'today';
    } catch (e) { return 'today'; }
  })();
  function setViewMode(m) {
    if (!VIEW_MODES.includes(m)) return;
    viewMode = m;
    try { localStorage.setItem('nexus_clean_view_mode', m); } catch (e) {}
    render();
  }

  // ─── TRAINING MODE (v12.3) ────────────────────────────────────────────
  // Toggle that surfaces per-task training affordances. When ON, each
  // task row that has linked training modules shows a 🎓 pill with the
  // current user's completion ratio. Tap to expand an inline panel with
  // a Mark-complete button per module. Edit form always has the link
  // controls regardless of this toggle, so admins can manage links
  // without turning training mode on for everyday use.
  let trainingMode = (() => {
    try { return localStorage.getItem('nexus_clean_training_mode') === '1'; }
    catch (e) { return false; }
  })();
  function setTrainingMode(on) {
    trainingMode = !!on;
    try { localStorage.setItem('nexus_clean_training_mode', trainingMode ? '1' : '0'); }
    catch (e) {}
    if (trainingMode) {
      // First time toggling on → make sure we have the data loaded
      loadTrainingData().then(() => render()).catch(() => render());
    } else {
      // Collapse any expanded training panels on toggle-off
      expandedTrainingTaskId = null;
      render();
    }
  }
  let expandedTrainingTaskId = null;  // which task's training panel is open

  // Caches for cleaning ↔ training relationship
  let linksByTaskId      = {};   // { cleaningTaskId: [trainingModuleId, ...] }
  let trainingModulesById = {};  // { trainingModuleId: { ...module } }
  let myTrainingByModule = {};   // { trainingModuleId: latest completion for current user }

  // ─── DATE: 8AM rollover (a "cleaning shift" is 8am-to-8am) ────────────
  function getCleaningDate() {
    const now = new Date();
    if (now.getHours() < 8) now.setDate(now.getDate() - 1);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  let today = getCleaningDate();

  function daysBetween(d1, d2) {
    return Math.floor((new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24));
  }
  function daysAgoText(days) {
    if (days <= 0)   return 'Today';
    if (days === 1)  return 'Yesterday';
    if (days < 7)    return days + 'd ago';
    if (days < 30)   return Math.floor(days / 7) + 'w ago';
    if (days < 365)  return Math.floor(days / 30) + 'mo ago';
    return Math.floor(days / 365) + 'y ago';
  }

  function getUserName() {
    return (window.NX && NX.currentUser && NX.currentUser.name) || 'Unknown';
  }
  function getCurrentUserId() {
    return (window.NX && NX.currentUser && NX.currentUser.id) || null;
  }
  function getLang() {
    return (window.NX && NX.i18n && typeof NX.i18n.getLang === 'function')
      ? NX.i18n.getLang() : 'en';
  }
  function toast(msg, kind, ms) {
    if (window.NX && NX.toast) NX.toast(msg, kind || 'info', ms || 1800);
  }

  // ─── FRESHNESS — the metric that replaces ad-hoc "OVERDUE Xd" strings ──
  /**
   * Compute a 0-100 freshness score for a task. 100 = just done, 0 = at or
   * past the frequency cliff. Daily tasks always return 100 if done today,
   * else freshness based on days since last done vs 1-day cycle.
   */
  function freshnessForTask(task) {
    const freq = task.frequency_days || FREQ_BY_TYPE[task.frequency_type]?.days || 30;
    const histKey = task.section_es + '_' + task.task_order;
    const hist = lastDoneByKey[histKey];
    if (!hist) return 0;  // never done
    const daysSince = daysBetween(hist.date, today);
    if (daysSince <= 0) return 100;
    const fresh = 100 * (1 - daysSince / freq);
    return Math.max(0, Math.min(100, Math.round(fresh)));
  }
  function freshnessClass(pct) {
    if (pct >= 70) return 'is-fresh';
    if (pct >= 40) return 'is-aging';
    return 'is-stale';
  }
  function sectionFreshness(tasks) {
    if (!tasks.length) return 100;
    const sum = tasks.reduce((acc, t) => acc + freshnessForTask(t), 0);
    return Math.round(sum / tasks.length);
  }

  // ─── DB: load tasks (replaces hardcoded DEFAULTS) ─────────────────────
  async function loadTasksForLocation(loc) {
    if (!NX.sb || NX.paused) return [];
    try {
      const { data, error } = await NX.sb.from('cleaning_tasks')
        .select('*')
        .eq('location', loc)
        .eq('archived', false)
        .order('section_order', { ascending: true })
        .order('task_order',    { ascending: true });
      if (error) {
        console.error('[cleaning] loadTasksForLocation:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.error('[cleaning] loadTasksForLocation exception:', e);
      return [];
    }
  }

  async function loadAllTasks() {
    const out = {};
    for (const loc of LOCATIONS) {
      out[loc] = await loadTasksForLocation(loc);
    }
    tasksByLoc = out;
  }

  // ─── DB: load today's done-state for active location ──────────────────
  async function loadTodayState() {
    todayStateByKey = {};
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.from('cleaning_logs')
        .select('section, task_index, done, completed_by')
        .eq('log_date', today)
        .eq('location', activeLoc);
      if (error) { console.warn('[cleaning] loadTodayState:', error); return; }
      (data || []).forEach(r => {
        // r.section is section_es (we kept the legacy v11 key shape)
        todayStateByKey[r.section + '_' + r.task_index] = {
          done: r.done,
          by: r.completed_by || '',
        };
      });
    } catch (e) {
      console.warn('[cleaning] loadTodayState exception:', e);
    }
  }

  // ─── DB: load history (most-recent done per task, for freshness calc) ─
  async function loadHistory() {
    lastDoneByKey = {};
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.from('cleaning_logs')
        .select('section, task_index, log_date, completed_by')
        .eq('location', activeLoc)
        .eq('done', true)
        .order('log_date', { ascending: false })
        .limit(1000);
      if (error) { console.warn('[cleaning] loadHistory:', error); return; }
      (data || []).forEach(r => {
        const key = r.section + '_' + r.task_index;
        if (!lastDoneByKey[key]) {
          lastDoneByKey[key] = { date: r.log_date, by: r.completed_by || '' };
        }
      });
    } catch (e) {
      console.warn('[cleaning] loadHistory exception:', e);
    }
  }

  // ─── DB: load users list for assignee dropdowns ───────────────────────
  async function loadUsers() {
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.rpc('list_user_names');
      if (!error && Array.isArray(data)) {
        usersList = data;
        return;
      }
      // RPC might not exist — fall back to direct SELECT (works for
      // privileged roles; fails silently for staff RLS).
      const fb = await NX.sb.from('nexus_users').select('id, name, role').order('name');
      if (!fb.error) usersList = fb.data || [];
    } catch (e) {
      // Network/RLS failure — empty list is acceptable, dropdown shows
      // "No users available" and the user can save without an assignee.
      console.warn('[cleaning] loadUsers:', e);
      usersList = [];
    }
  }

  // ─── DB: load any open board cards linked to cleaning sections ────────
  // (Preserved from v11 — the section header shows "→ On board" or
  // "→ Add to board" depending on whether an open escalation exists.)
  async function loadLinkedCards() {
    Object.keys(linkedBoardCards).forEach(k => delete linkedBoardCards[k]);
    if (!NX.sb || NX.paused) return;
    try {
      const { data } = await NX.sb.from('kanban_cards')
        .select('id, cleaning_link_location, cleaning_link_section, column_name, archived')
        .eq('cleaning_link_location', activeLoc)
        .eq('archived', false);
      if (!data) return;
      data.forEach(c => {
        const cn = (c.column_name || '').toLowerCase();
        if (/(done|closed|resolved|complete|archived?)/.test(cn)) return;
        if (c.cleaning_link_section) {
          linkedBoardCards[activeLoc + '__' + c.cleaning_link_section] = c.id;
        }
      });
    } catch (e) {
      console.warn('[cleaning] loadLinkedCards:', e);
    }
  }

  // ─── DB: load photo attachments for active location + today ──────────
  // We keep this scoped to today's shift. Older photos are still in the
  // DB and visible in the per-task history detail (TODO), but the row
  // UI only shows today's. Cost tracking works the same way.
  async function loadAttachments() {
    attachmentsByKey = {};
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.from('cleaning_attachments')
        .select('id, section, task_index, file_url, mime_type, caption, uploaded_by, created_at')
        .eq('location', activeLoc)
        .eq('log_date', today)
        .order('created_at', { ascending: true });
      if (error) { console.warn('[cleaning] loadAttachments:', error); return; }
      (data || []).forEach(a => {
        const k = a.section + '_' + a.task_index;
        if (!attachmentsByKey[k]) attachmentsByKey[k] = [];
        attachmentsByKey[k].push(a);
      });
    } catch (e) {
      console.warn('[cleaning] loadAttachments exception:', e);
    }
  }

  async function loadCosts() {
    costsByKey = {};
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.from('cleaning_logs')
        .select('section, task_index, completion_cost, completion_cost_note')
        .eq('location', activeLoc)
        .eq('log_date', today)
        .not('completion_cost', 'is', null);
      if (error) { console.warn('[cleaning] loadCosts:', error); return; }
      (data || []).forEach(r => {
        const k = r.section + '_' + r.task_index;
        costsByKey[k] = {
          cost: parseFloat(r.completion_cost) || 0,
          note: r.completion_cost_note || '',
        };
      });
    } catch (e) {
      console.warn('[cleaning] loadCosts exception:', e);
    }
  }

  // ─── DB: load active per-task notes for this location's tasks ─────────
  // Notes are scoped per-task and disappear after their expires_at, or
  // when explicitly dismissed. Only the most recent active note per task
  // is surfaced in the UI.
  async function loadTaskNotes() {
    notesByTaskId = {};
    if (!NX.sb || NX.paused) return;
    const taskIds = (tasksByLoc[activeLoc] || []).map(t => t.id);
    if (!taskIds.length) return;
    try {
      const { data, error } = await NX.sb.from('cleaning_task_notes')
        .select('id, cleaning_task_id, note, expires_at, created_by, created_at, dismissed_at')
        .in('cleaning_task_id', taskIds)
        .is('dismissed_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (error) { console.warn('[cleaning] loadTaskNotes:', error); return; }
      // Take latest per task
      (data || []).forEach(n => {
        if (!notesByTaskId[n.cleaning_task_id]) {
          notesByTaskId[n.cleaning_task_id] = n;
        }
      });
    } catch (e) {
      console.warn('[cleaning] loadTaskNotes exception:', e);
    }
  }

  // Save a new note for a task (replaces visible previous note via the
  // latest-wins rendering — old rows still live in the DB for the audit
  // trail). Default expiry = 7 days from now.
  async function saveTaskNote(taskId, noteText) {
    if (!NX.sb) throw new Error('Database unavailable');
    const text = (noteText || '').trim();
    if (!text) return;
    const { error } = await NX.sb.from('cleaning_task_notes').insert({
      cleaning_task_id: taskId,
      note:             text.slice(0, 500),
      created_by:       getUserName(),
      created_by_id:    getCurrentUserId(),
      // expires_at defaults to now() + 7 days at the DB level
    });
    if (error) throw error;
    await loadTaskNotes();
    render();
  }

  // Dismiss a note explicitly. Sets dismissed_at on the row so it
  // disappears immediately in the UI but stays in the table for audit.
  async function dismissTaskNote(noteId) {
    if (!NX.sb) return;
    try {
      await NX.sb.from('cleaning_task_notes')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', noteId);
      await loadTaskNotes();
      render();
    } catch (e) {
      console.warn('[cleaning] dismissTaskNote:', e);
      toast('Could not dismiss', 'error');
    }
  }

  // ─── DB: fetch completion history for a single task ──────────────────
  // Used by the completion-history modal. Returns the last N completions
  // joined with their attachments + costs so the modal can show a
  // visual "what done looks like" reference.
  async function fetchTaskHistory(task, limit = 10) {
    if (!NX.sb) return [];
    try {
      const { data: logs, error } = await NX.sb.from('cleaning_logs')
        .select('log_date, done, completed_by, completed_at, completion_cost, completion_cost_note')
        .eq('location',   activeLoc)
        .eq('section',    task.section_es)
        .eq('task_index', task.task_order)
        .eq('done',       true)
        .order('log_date', { ascending: false })
        .limit(limit);
      if (error) { console.warn('[cleaning] fetchTaskHistory logs:', error); return []; }
      const history = logs || [];
      if (!history.length) return [];

      // Pull all attachments for these dates in one query
      const dates = history.map(h => h.log_date);
      const { data: atts } = await NX.sb.from('cleaning_attachments')
        .select('log_date, file_url, mime_type, caption, uploaded_by')
        .eq('location',   activeLoc)
        .eq('section',    task.section_es)
        .eq('task_index', task.task_order)
        .in('log_date',   dates)
        .order('created_at', { ascending: true });
      const attsByDate = {};
      (atts || []).forEach(a => {
        if (!attsByDate[a.log_date]) attsByDate[a.log_date] = [];
        attsByDate[a.log_date].push(a);
      });
      history.forEach(h => { h.attachments = attsByDate[h.log_date] || []; });
      return history;
    } catch (e) {
      console.warn('[cleaning] fetchTaskHistory exception:', e);
      return [];
    }
  }

  // ─── DB: load cleaning↔training link data ──────────────────────────────
  // Loads (a) which training modules each cleaning task is linked to,
  // (b) the linked modules' details, (c) current user's most-recent
  // completion for each linked module. All three caches keyed by ID.
  // Cheap to call repeatedly — short-circuits when training mode is off.
  async function loadTrainingData() {
    if (!NX.sb || NX.paused) return;
    // Step 1: links for this location's tasks
    const taskIds = (tasksByLoc[activeLoc] || []).map(t => t.id);
    if (!taskIds.length) {
      linksByTaskId = {};
      trainingModulesById = {};
      myTrainingByModule = {};
      return;
    }
    try {
      const { data: links, error: linkErr } = await NX.sb
        .from('cleaning_task_training_links')
        .select('cleaning_task_id, training_module_id')
        .in('cleaning_task_id', taskIds);
      if (linkErr) { console.warn('[cleaning] training links:', linkErr); return; }

      linksByTaskId = {};
      const moduleIds = new Set();
      (links || []).forEach(l => {
        if (!linksByTaskId[l.cleaning_task_id]) linksByTaskId[l.cleaning_task_id] = [];
        linksByTaskId[l.cleaning_task_id].push(l.training_module_id);
        moduleIds.add(l.training_module_id);
      });

      if (!moduleIds.size) {
        trainingModulesById = {};
        myTrainingByModule = {};
        return;
      }

      // Step 2: the linked modules
      const { data: mods } = await NX.sb.from('training_modules')
        .select('*')
        .in('id', Array.from(moduleIds))
        .eq('archived', false);
      trainingModulesById = {};
      (mods || []).forEach(m => { trainingModulesById[m.id] = m; });

      // Step 3: my completions for those modules (latest first per module)
      const userId = getCurrentUserId();
      if (userId) {
        const { data: completions } = await NX.sb.from('training_completions')
          .select('id, module_id, user_id, completed_at, expires_at')
          .eq('user_id', userId)
          .in('module_id', Array.from(moduleIds))
          .order('completed_at', { ascending: false });
        myTrainingByModule = {};
        (completions || []).forEach(c => {
          // Most-recent wins (we ordered desc, so first one we see is latest)
          if (!myTrainingByModule[c.module_id]) myTrainingByModule[c.module_id] = c;
        });
      }
    } catch (e) {
      console.warn('[cleaning] loadTrainingData exception:', e);
    }
  }

  // Returns [done, total] for a cleaning task's linked training, for current user
  function trainingProgressForTask(taskId) {
    const moduleIds = linksByTaskId[taskId] || [];
    if (!moduleIds.length) return [0, 0];
    let done = 0;
    moduleIds.forEach(mid => {
      const c = myTrainingByModule[mid];
      if (!c) return;
      // If module has expiration AND we're past it, don't count as done
      if (c.expires_at) {
        const remaining = (new Date(c.expires_at) - new Date()) / (1000 * 60 * 60 * 24);
        if (remaining < 0) return;  // expired
      }
      done++;
    });
    return [done, moduleIds.length];
  }


  function getDoneState(sectionEs, taskOrder) {
    const k = sectionEs + '_' + taskOrder;
    return !!todayStateByKey[k]?.done;
  }
  function setDoneState(sectionEs, taskOrder, done) {
    const k = sectionEs + '_' + taskOrder;
    todayStateByKey[k] = { done, by: done ? getUserName() : '' };
    if (done) {
      lastDoneByKey[k] = { date: today, by: getUserName() };
    }
  }
  async function persistDone(sectionEs, taskOrder, done) {
    if (!NX.sb || NX.paused) return;
    try {
      await NX.sb.from('cleaning_logs').upsert({
        location:     activeLoc,
        log_date:     today,
        section:      sectionEs,
        task_index:   taskOrder,
        done:         done,
        completed_by: done ? getUserName() : null,
        completed_at: done ? new Date().toISOString() : null,
      }, { onConflict: 'location,log_date,task_index,section' });
    } catch (e) {
      console.error('[cleaning] persistDone:', e);
      toast('Could not save — retry by tapping again', 'error');
    }
  }

  // ─── GROUP TASKS BY SECTION (for rendering) ───────────────────────────
  function tasksBySection(loc) {
    const tasks = tasksByLoc[loc] || [];
    const groups = new Map();
    tasks.forEach(t => {
      const key = t.section_es;
      if (!groups.has(key)) {
        groups.set(key, {
          section_es:    t.section_es,
          section_en:    t.section_en,
          section_order: t.section_order,
          tasks:         [],
        });
      }
      groups.get(key).tasks.push(t);
    });
    return Array.from(groups.values()).sort((a, b) => a.section_order - b.section_order);
  }

  // ═══ PHOTO UPLOAD ════════════════════════════════════════════════════
  // Open a file picker → upload to cleaning-attachments bucket → INSERT
  // a row in cleaning_attachments → re-render. Mirrors the pattern from
  // equipment.js (see equipment_attachments at lines 7665-7690).
  async function uploadPhotoForTask(task) {
    if (!NX.sb) { toast('Database unavailable', 'error'); return; }
    // Build a hidden file input with capture="environment" so mobile
    // camera defaults to the rear-facing lens (better for photographing
    // the work area). Falls back to the file picker when no camera.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;

      const MAX_SIZE = 10 * 1024 * 1024;  // 10 MB hard cap
      if (file.size > MAX_SIZE) {
        toast(`Photo too large (${Math.round(file.size/1024/1024)}MB max 10MB)`, 'error', 4000);
        return;
      }

      toast('Uploading photo…', 'info', 8000);
      try {
        // Path scheme: {location}/{date}/{section}-{task_order}-{ts}.{ext}
        const safeName = file.name.replace(/[^a-z0-9.]/gi, '_');
        const fname = `${activeLoc}/${today}/${task.section_es.replace(/\s+/g,'_')}-${task.task_order}-${Date.now()}-${safeName}`;
        const { error: upErr } = await NX.sb.storage
          .from('cleaning-attachments')
          .upload(fname, file, { upsert: false, contentType: file.type });
        if (upErr) throw upErr;

        const { data: { publicUrl } } = NX.sb.storage
          .from('cleaning-attachments').getPublicUrl(fname);

        const { error: dbErr } = await NX.sb.from('cleaning_attachments').insert({
          location:       activeLoc,
          log_date:       today,
          section:        task.section_es,
          task_index:     task.task_order,
          file_url:       publicUrl,
          mime_type:      file.type,
          file_size:      file.size,
          uploaded_by:    getUserName(),
          uploaded_by_id: getCurrentUserId(),
        });
        if (dbErr) throw dbErr;

        // Mark the task done if it isn't already — uploading proof is a
        // strong signal of completion. Caller can uncheck if they were
        // mid-task.
        if (!getDoneState(task.section_es, task.task_order)) {
          setDoneState(task.section_es, task.task_order, true);
          await persistDone(task.section_es, task.task_order, true);
        }

        await loadAttachments();
        render();
        toast('Photo saved', 'info', 1600);
      } catch (e) {
        console.error('[cleaning] photo upload:', e);
        toast('Upload failed: ' + (e.message || ''), 'error', 4500);
      }
    });
    input.click();
  }

  async function deletePhoto(attachmentId, fileUrl) {
    if (!confirm('Delete this photo?')) return;
    if (!NX.sb) return;
    try {
      // Strip bucket prefix from URL to get the storage path
      const m = (fileUrl || '').match(/cleaning-attachments\/(.+)$/);
      if (m && m[1]) {
        await NX.sb.storage.from('cleaning-attachments').remove([m[1]]);
      }
      await NX.sb.from('cleaning_attachments').delete().eq('id', attachmentId);
      await loadAttachments();
      render();
      toast('Photo removed', 'info', 1400);
    } catch (e) {
      console.error('[cleaning] deletePhoto:', e);
      toast('Could not delete', 'error');
    }
  }

  function openPhotoViewer(url) {
    // Lightweight full-screen image viewer. Tap-anywhere to dismiss.
    const v = document.createElement('div');
    v.className = 'clean-photo-viewer';
    v.innerHTML = `
      <div class="clean-photo-viewer-bg"></div>
      <img class="clean-photo-viewer-img" src="${esc(url)}" alt="">
      <button class="clean-photo-viewer-close" aria-label="Close">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    const close = () => v.remove();
    v.querySelector('.clean-photo-viewer-bg').addEventListener('click', close);
    v.querySelector('.clean-photo-viewer-close').addEventListener('click', close);
    document.body.appendChild(v);
  }


  // ═══ COST ENTRY ══════════════════════════════════════════════════════
  // Opens a tiny modal to record the cost of completing this task today.
  // Used for pressure washing, deep cleans, contractor work — anything
  // where money was spent. Stores on cleaning_logs.completion_cost.
  function openCostEntry(task) {
    if (!NX.composer?.modal) {
      const v = prompt('Cost for this task ($):');
      if (v === null) return;
      const cost = parseFloat(v);
      if (isNaN(cost) || cost < 0) return;
      saveCost(task, cost, '');
      return;
    }
    const existing = costsByKey[task.section_es + '_' + task.task_order];
    NX.composer.modal({
      title: 'Log cost',
      subtitle: `${task.name_en} — ${activeLoc.charAt(0).toUpperCase() + activeLoc.slice(1)}`,
      buttonLabel: 'Save',
      fields: [
        {
          name: 'cost',
          label: 'Cost ($)',
          placeholder: 'e.g. 320.00',
          value: existing ? String(existing.cost) : '',
          autofocus: true,
        },
        {
          name: 'note',
          label: 'Note (optional)',
          placeholder: 'e.g. Power wash by ContractorCo invoice #4421',
          value: existing ? existing.note : '',
        },
      ],
      onSubmit: async ({ cost, note }) => {
        const n = parseFloat(cost);
        if (isNaN(n) || n < 0) throw new Error('Enter a valid amount');
        await saveCost(task, n, (note || '').trim());
      },
    });
  }

  async function saveCost(task, cost, note) {
    if (!NX.sb) throw new Error('Database unavailable');
    // Upsert into cleaning_logs — completion_cost is a column on the
    // existing row, not a separate table. The (location, log_date,
    // section, task_index) UNIQUE composite acts as the key.
    try {
      // Mark the task done as a side-effect (recording cost implies done)
      const wasDone = getDoneState(task.section_es, task.task_order);
      const { error } = await NX.sb.from('cleaning_logs').upsert({
        location:              activeLoc,
        log_date:              today,
        section:               task.section_es,
        task_index:            task.task_order,
        done:                  true,
        completed_by:          getUserName(),
        completed_at:          wasDone ? undefined : new Date().toISOString(),
        completion_cost:       cost,
        completion_cost_note:  note || null,
      }, { onConflict: 'location,log_date,task_index,section' });
      if (error) throw error;
      setDoneState(task.section_es, task.task_order, true);
      costsByKey[task.section_es + '_' + task.task_order] = { cost, note: note || '' };
      render();
      toast('Cost logged', 'info', 1600);
    } catch (e) {
      throw e;
    }
  }

  function fmtCost(n) {
    if (n == null || n === 0) return '';
    return '$' + (Math.round(n * 100) / 100).toLocaleString(undefined, {
      minimumFractionDigits: n % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }


  // ═══ AUTO-ESCALATE TO BOARD ════════════════════════════════════════════
  // For non-daily tasks past their freshness cliff, automatically create
  // a board card if one doesn't already exist — with a buffer threshold
  // so we don't escalate a single-day overdue (which is normal noise).
  // Threshold: overdue by >25% of the task's frequency_days. So a
  // monthly task escalates ~7d after the cliff; quarterly ~22d; annual
  // ~91d. Daily tasks never auto-escalate (manual is fine).
  const AUTO_ESCALATE_OVERDUE_RATIO = 0.25;

  async function runAutoEscalations() {
    if (!NX.sb) return;
    const groups = tasksBySection(activeLoc);
    // Find overdue groups where no card is linked yet
    const candidates = [];
    for (const group of groups) {
      // Skip daily-only sections
      const nonDaily = group.tasks.filter(t => !DAILY_TYPES.has(t.frequency_type));
      if (!nonDaily.length) continue;
      // Already linked? Skip.
      if (linkedBoardCards[activeLoc + '__' + group.section_es]) continue;
      // Compute most-overdue task in section
      let worstRatio = 0;
      for (const t of nonDaily) {
        const freq = t.frequency_days || FREQ_BY_TYPE[t.frequency_type]?.days || 30;
        const hist = lastDoneByKey[t.section_es + '_' + t.task_order];
        const since = hist ? daysBetween(hist.date, today) : 9999;
        if (since <= freq) continue;
        const overRatio = (since - freq) / freq;
        if (overRatio > worstRatio) worstRatio = overRatio;
      }
      if (worstRatio >= AUTO_ESCALATE_OVERDUE_RATIO) {
        candidates.push(group);
      }
    }
    if (!candidates.length) return;

    // Fire off escalations sequentially (avoid multiple board lookups
    // hitting the same board api in parallel). Silent — no toast per
    // escalation; one summary toast at the end.
    let count = 0;
    for (const g of candidates) {
      try {
        await escalateSectionToBoardSilent(g);
        count++;
      } catch (e) {
        console.warn('[cleaning] auto-escalate failed for', g.section_es, e);
      }
    }
    if (count) {
      await loadLinkedCards();
      render();
      toast(`${count} section${count === 1 ? '' : 's'} sent to board`, 'info', 2400);
    }
  }

  // Internal version of escalateSectionToBoard without the user-facing
  // toasts (auto-escalation should be quiet). Same DB writes.
  async function escalateSectionToBoardSilent(group) {
    const { data: bs } = await NX.sb.from('boards')
      .select('id').eq('archived', false).order('position').limit(1);
    if (!bs?.length) throw new Error('No board');
    const boardId = bs[0].id;
    const { data: ls } = await NX.sb.from('board_lists')
      .select('*').eq('board_id', boardId).order('position');
    const list = (ls || []).find(l => /report|todo|triage/i.test(l.name)) || (ls || [])[0];
    if (!list) throw new Error('No list');
    const desc = group.tasks.map(t => `• ${t.name_es} / ${t.name_en}`).join('\n');
    const { error } = await NX.sb.from('kanban_cards').insert({
      board_id:                boardId,
      list_id:                 list.id,
      title:                   `Cleaning · ${group.section_en} · ${activeLoc} (auto)`,
      description:             desc + '\n\n[Auto-escalated by NEXUS — overdue cleaning section]',
      cleaning_link_location:  activeLoc,
      cleaning_link_section:   group.section_es,
      due_date:                today,
      position:                Date.now(),
    });
    if (error) throw error;
  }


  // ═══ PER-TASK NOTES UI (v12.4) ═══════════════════════════════════════
  // Quick contextual notes that surface on the task row and persist
  // across shifts. Open the editor via the note icon (existing notes)
  // or via a long-press anywhere on the task body (new notes).
  function openNoteEditor(task) {
    const existing = notesByTaskId[task.id];
    if (NX.composer?.modal) {
      NX.composer.modal({
        title: existing ? 'Edit note' : 'Add note',
        subtitle: `${task.name_en} — ${activeLoc.charAt(0).toUpperCase() + activeLoc.slice(1)}`,
        buttonLabel: existing ? 'Save' : 'Add',
        fields: [
          {
            name: 'note',
            label: 'Note (visible to next shift, expires in 7 days)',
            placeholder: 'e.g. Mop is broken — using one in the office for now.',
            value: existing ? existing.note : '',
            autofocus: true,
            multiline: true,
          },
        ],
        onSubmit: async ({ note }) => {
          const text = (note || '').trim();
          if (!text) {
            // Empty submit on existing note → dismiss it
            if (existing) await dismissTaskNote(existing.id);
            return;
          }
          await saveTaskNote(task.id, text);
        },
      });
    } else {
      const v = prompt('Note:', existing ? existing.note : '');
      if (v === null) return;
      if (!v.trim() && existing) {
        dismissTaskNote(existing.id);
      } else {
        saveTaskNote(task.id, v).catch(e => toast(e.message, 'error'));
      }
    }
  }


  // ═══ TASK COMPLETION HISTORY MODAL (v12.4) ═══════════════════════════
  // Tap a task name → see the last N completions with photos + cost +
  // who completed it. Read-only reference for QA and "this is what done
  // looks like".
  async function openTaskHistory(task) {
    const sheet = document.createElement('div');
    sheet.className = 'clean-history-sheet';
    sheet.innerHTML = `
      <div class="clean-history-bg"></div>
      <div class="clean-history-card">
        <div class="clean-history-head">
          <div class="clean-history-titles">
            <div class="clean-history-title">${esc(task.name_en)}</div>
            <div class="clean-history-sub">${esc(task.name_es)} · ${esc(activeLoc.charAt(0).toUpperCase() + activeLoc.slice(1))}</div>
          </div>
          <button class="clean-history-close" aria-label="Close">${svg('close', 18, 2.2)}</button>
        </div>
        <div class="clean-history-body" data-history-body>
          <div class="clean-history-loading">Loading…</div>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    sheet.querySelector('.clean-history-bg').addEventListener('click', close);
    sheet.querySelector('.clean-history-close').addEventListener('click', close);

    const history = await fetchTaskHistory(task, 12);
    const body = sheet.querySelector('[data-history-body]');
    if (!history.length) {
      body.innerHTML = `
        <div class="clean-history-empty">
          <div class="clean-history-empty-title">No completions yet</div>
          <div class="clean-history-empty-sub">Once this task is checked off, the last 12 completions will appear here with photos and cost notes.</div>
        </div>`;
      return;
    }

    body.innerHTML = history.map(h => {
      const dateStr = new Date(h.log_date + 'T12:00:00').toLocaleDateString([], {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      const completedTime = h.completed_at
        ? new Date(h.completed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '';
      const photosHTML = h.attachments.length ? `
        <div class="clean-history-photos">
          ${h.attachments.map(a => `
            <button class="clean-history-photo" data-photo-url="${esc(a.file_url)}">
              <img src="${esc(a.file_url)}" alt="" loading="lazy">
            </button>
          `).join('')}
        </div>` : '';
      const costHTML = (h.completion_cost && h.completion_cost > 0)
        ? `<span class="clean-history-cost">${esc(fmtCost(h.completion_cost))}${h.completion_cost_note ? ` · ${esc(h.completion_cost_note)}` : ''}</span>`
        : '';
      return `
        <div class="clean-history-row">
          <div class="clean-history-row-head">
            <span class="clean-history-row-date">${esc(dateStr)}</span>
            ${completedTime ? `<span class="clean-history-row-time">${esc(completedTime)}</span>` : ''}
            ${h.completed_by ? `<span class="clean-history-row-by">${esc(h.completed_by)}</span>` : ''}
          </div>
          ${costHTML}
          ${photosHTML}
        </div>
      `;
    }).join('');

    // Tap thumbnail → reuse the photo viewer
    body.querySelectorAll('[data-photo-url]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPhotoViewer(btn.dataset.photoUrl);
      });
    });
  }


  // ═══ COMING UP — 7-day forward look ══════════════════════════════════
  // Returns a sorted list of upcoming task cliffs in the next N days,
  // useful for the "Coming up" strip rendered above the section cards.
  // Each entry: { task, daysUntilDue, dateStr }
  function computeComingUp(days = COMING_UP_DAYS) {
    const out = [];
    const tasks = tasksByLoc[activeLoc] || [];
    for (const t of tasks) {
      // Skip daily — no point telling someone "mop the floor due Tuesday"
      if (DAILY_TYPES.has(t.frequency_type)) continue;
      const freq = t.frequency_days || FREQ_BY_TYPE[t.frequency_type]?.days || 30;
      const hist = lastDoneByKey[t.section_es + '_' + t.task_order];
      const since = hist ? daysBetween(hist.date, today) : 9999;
      const daysUntil = freq - since;
      // Include if due within window (positive = future) OR slightly
      // overdue (≤2 days). Sort ascending so most-urgent appears first.
      if (daysUntil > -2 && daysUntil <= days) {
        out.push({
          task: t,
          daysUntil,
        });
      }
    }
    out.sort((a, b) => a.daysUntil - b.daysUntil);
    return out;
  }



  // Card-based design borrowed wholesale from the ordering catalog editor:
  //   • Each section is a card with a gold-line border + rounded corners
  //   • Card head shows: name (bilingual), task count, freshness chip,
  //     overall progress, expand/collapse chevron
  //   • Expand reveals: task rows, "+ Add task" button, optional "→ On board"
  //   • Each task row: checkbox + bilingual name + freshness mini-bar +
  //     assignee chip + days-of-week pills (when relevant) + edit pencil
  //   • Tap edit pencil → inline form (same ord-vitem-editing pattern)

  // ═══ TRAINING ACTIONS FROM CLEANING (v12.3) ═════════════════════════
  // The cleaning view can mark training-completion on behalf of the
  // current user when training mode is on. These helpers wrap the
  // direct training_completions writes so the cleaning view doesn't
  // need to depend on the training module being loaded.
  async function markTrainingCompleteFromCleaning(moduleId) {
    if (!NX.sb) { toast('Database unavailable', 'error'); return; }
    const userId = getCurrentUserId();
    if (!userId) { toast('Not signed in', 'warn'); return; }
    const mod = trainingModulesById[moduleId];
    if (!mod) { toast('Module not loaded', 'error'); return; }

    let expiresAt = null;
    if (mod.renewal_type === 'annual')        expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();
    else if (mod.renewal_type === 'biennial') expiresAt = new Date(Date.now() + 730 * 86400000).toISOString();
    else if (mod.renewal_type === 'custom' && mod.expires_after_days) {
      expiresAt = new Date(Date.now() + mod.expires_after_days * 86400000).toISOString();
    }

    try {
      const { error } = await NX.sb.from('training_completions').insert({
        module_id:    moduleId,
        user_id:      userId,
        user_name:    getUserName(),
        completed_at: new Date().toISOString(),
        expires_at:   expiresAt,
      });
      if (error) throw error;
      await loadTrainingData();
      render();
      toast(`Training complete: ${mod.name_en}`, 'info', 2400);
    } catch (e) {
      console.error('[cleaning] markTrainingComplete:', e);
      toast('Could not save: ' + (e.message || ''), 'error');
    }
  }

  async function linkTrainingModuleToTask(taskId, moduleId) {
    if (!NX.sb) return;
    try {
      const { error } = await NX.sb.from('cleaning_task_training_links').insert({
        cleaning_task_id:   taskId,
        training_module_id: moduleId,
      });
      if (error && error.code !== '23505') throw error;  // 23505 = already exists, fine
      await loadTrainingData();
      render();
    } catch (e) {
      console.error('[cleaning] linkTrainingModule:', e);
      toast('Could not link: ' + (e.message || ''), 'error');
    }
  }

  async function unlinkTrainingModuleFromTask(taskId, moduleId) {
    if (!NX.sb) return;
    try {
      await NX.sb.from('cleaning_task_training_links').delete()
        .eq('cleaning_task_id', taskId)
        .eq('training_module_id', moduleId);
      await loadTrainingData();
      render();
    } catch (e) {
      console.error('[cleaning] unlinkTrainingModule:', e);
      toast('Could not unlink: ' + (e.message || ''), 'error');
    }
  }

  // Open a picker showing all (non-archived) training modules. User taps
  // any to link or unlink; multi-link is supported. Live-fetches from
  // training_modules so we don't depend on the Training view having
  // ever been visited.
  async function openTrainingLinkPicker(task, alreadyLinkedIds) {
    if (!NX.sb) { toast('Database unavailable', 'error'); return; }
    let allModules = [];
    try {
      const { data } = await NX.sb.from('training_modules')
        .select('id, name_es, name_en, category_en, kind, mandatory')
        .eq('archived', false)
        .order('category_order', { ascending: true })
        .order('module_order',   { ascending: true });
      allModules = data || [];
    } catch (e) {
      toast('Could not load modules', 'error');
      return;
    }
    if (!allModules.length) {
      toast('No training modules — create some in the Training view first', 'info', 3500);
      return;
    }

    const linkedSet = new Set(alreadyLinkedIds || []);
    const sheet = document.createElement('div');
    sheet.className = 'clean-train-pick-sheet';
    sheet.innerHTML = `
      <div class="clean-train-pick-bg"></div>
      <div class="clean-train-pick-card">
        <div class="clean-train-pick-title">Link training to "${esc(task.name_en)}"</div>
        <div class="clean-train-pick-sub">Tap to link or unlink. Already-linked modules are highlighted.</div>
        <div class="clean-train-pick-search-wrap">
          <input type="text" class="clean-train-pick-search" placeholder="Search modules…" autofocus>
        </div>
        <div class="clean-train-pick-list">
          ${allModules.map(m => `
            <button class="clean-train-pick-item ${linkedSet.has(m.id) ? 'is-linked' : ''}"
                    data-mod-id="${esc(m.id)}"
                    data-mod-search="${esc((m.name_en + ' ' + m.name_es + ' ' + (m.category_en || '')).toLowerCase())}">
              <div class="clean-train-pick-item-head">
                <span class="clean-train-pick-item-name">${esc(m.name_en)}</span>
                ${linkedSet.has(m.id)
                  ? '<span class="clean-train-pick-item-status">Linked</span>'
                  : '<span class="clean-train-pick-item-status is-add">+ Link</span>'}
              </div>
              <div class="clean-train-pick-item-meta">${esc(m.category_en || '')} · ${esc(m.kind)}</div>
            </button>
          `).join('')}
        </div>
        <div class="clean-train-pick-actions">
          <button class="clean-train-pick-close">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    const close = () => sheet.remove();
    sheet.querySelector('.clean-train-pick-bg').addEventListener('click', close);
    sheet.querySelector('.clean-train-pick-close').addEventListener('click', close);

    const searchInput = sheet.querySelector('.clean-train-pick-search');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      sheet.querySelectorAll('.clean-train-pick-item').forEach(item => {
        const text = item.dataset.modSearch || '';
        item.style.display = (!q || text.includes(q)) ? '' : 'none';
      });
    });

    sheet.querySelectorAll('[data-mod-id]').forEach(item => {
      item.addEventListener('click', async () => {
        const moduleId = item.dataset.modId;
        const isLinked = item.classList.contains('is-linked');
        item.disabled = true;
        try {
          if (isLinked) {
            await unlinkTrainingModuleFromTask(task.id, moduleId);
            item.classList.remove('is-linked');
            const status = item.querySelector('.clean-train-pick-item-status');
            if (status) { status.textContent = '+ Link'; status.classList.add('is-add'); }
          } else {
            await linkTrainingModuleToTask(task.id, moduleId);
            item.classList.add('is-linked');
            const status = item.querySelector('.clean-train-pick-item-status');
            if (status) { status.textContent = 'Linked'; status.classList.remove('is-add'); }
          }
        } finally {
          item.disabled = false;
        }
      });
    });
  }


  // ═══ REORDER (v12.2) ════════════════════════════════════════════════
  // Move-up / move-down for tasks within a section, and for whole sections
  // within a location. Implemented as two index swaps + DB updates so the
  // existing cleaning_logs (keyed on task_index a.k.a. task_order) stays
  // consistent — old log rows still resolve correctly because we never
  // gap or re-base, just swap pairs.

  async function moveTaskInSection(task, direction) {
    if (!NX.sb) return;
    const peers = (tasksByLoc[activeLoc] || [])
      .filter(t => t.section_es === task.section_es)
      .sort((a, b) => a.task_order - b.task_order);
    const idx = peers.findIndex(t => t.id === task.id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= peers.length) return;
    const other = peers[swapIdx];
    try {
      // Swap their task_order values
      await NX.sb.from('cleaning_tasks').update({ task_order: other.task_order }).eq('id', task.id);
      await NX.sb.from('cleaning_tasks').update({ task_order: task.task_order  }).eq('id', other.id);
      await loadAllTasks();
      render();
    } catch (e) {
      toast('Could not move: ' + (e.message || ''), 'error');
    }
  }

  async function moveSectionInLocation(group, direction) {
    if (!NX.sb) return;
    const groups = tasksBySection(activeLoc);
    const idx = groups.findIndex(g => g.section_es === group.section_es);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= groups.length) return;
    const other = groups[swapIdx];
    const myOrder    = group.tasks[0]?.section_order ?? 0;
    const otherOrder = other.tasks[0]?.section_order ?? 0;
    if (myOrder === otherOrder) return;
    try {
      await NX.sb.from('cleaning_tasks')
        .update({ section_order: otherOrder })
        .eq('location', activeLoc).eq('section_es', group.section_es);
      await NX.sb.from('cleaning_tasks')
        .update({ section_order: myOrder })
        .eq('location', activeLoc).eq('section_es', other.section_es);
      await loadAllTasks();
      render();
    } catch (e) {
      toast('Could not move section: ' + (e.message || ''), 'error');
    }
  }


  // ═══ COPY SECTION TO OTHER LOCATIONS (v12.2) ═════════════════════════
  // Useful when adding a new daily task ("wipe the new espresso machine")
  // to one location's Comedor and wanting it across all three locations
  // without re-typing. Copies all tasks in a source section into target
  // location(s), creating the section there if it doesn't exist. Skips
  // tasks whose Spanish name already exists in the target — Copy is
  // idempotent so re-running doesn't duplicate.
  function openCopySectionDialog(group) {
    const otherLocs = LOCATIONS.filter(l => l !== activeLoc);
    if (!otherLocs.length) {
      toast('No other locations to copy to', 'info');
      return;
    }
    const sheet = document.createElement('div');
    sheet.className = 'clean-copy-sheet';
    sheet.innerHTML = `
      <div class="clean-copy-sheet-bg"></div>
      <div class="clean-copy-sheet-card">
        <div class="clean-copy-sheet-title">Copy "${esc(group.section_en)}" to…</div>
        <div class="clean-copy-sheet-sub">Adds ${group.tasks.length} task${group.tasks.length === 1 ? '' : 's'} to the selected location${otherLocs.length === 1 ? '' : 's'}. Existing tasks won't be duplicated.</div>
        <div class="clean-copy-sheet-options">
          ${otherLocs.map(loc => `
            <label class="clean-copy-option">
              <input type="checkbox" class="clean-copy-checkbox" data-loc="${esc(loc)}" checked>
              <span class="clean-copy-option-label">${esc(loc.charAt(0).toUpperCase() + loc.slice(1))}</span>
              <span class="clean-copy-option-meta" data-existing-count="${esc(loc)}"></span>
            </label>
          `).join('')}
        </div>
        <div class="clean-copy-sheet-actions">
          <button class="clean-copy-cancel">Cancel</button>
          <button class="clean-copy-confirm">Copy</button>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    // Show count of pre-existing tasks per target location for context
    otherLocs.forEach(loc => {
      const existing = (tasksByLoc[loc] || [])
        .filter(t => t.section_es === group.section_es).length;
      const label = sheet.querySelector(`[data-existing-count="${loc}"]`);
      if (label) {
        label.textContent = existing
          ? `(${existing} task${existing === 1 ? '' : 's'} already there)`
          : '(new section)';
      }
    });

    const close = () => sheet.remove();
    sheet.querySelector('.clean-copy-sheet-bg').addEventListener('click', close);
    sheet.querySelector('.clean-copy-cancel').addEventListener('click', close);
    sheet.querySelector('.clean-copy-confirm').addEventListener('click', async () => {
      const targets = Array.from(sheet.querySelectorAll('.clean-copy-checkbox:checked'))
        .map(cb => cb.dataset.loc);
      if (!targets.length) { close(); return; }
      const btn = sheet.querySelector('.clean-copy-confirm');
      btn.disabled = true;
      btn.textContent = 'Copying…';
      try {
        const total = await copySectionToLocations(group, targets);
        close();
        toast(`Copied ${total} task${total === 1 ? '' : 's'} to ${targets.length} location${targets.length === 1 ? '' : 's'}`, 'info', 2400);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Copy';
        toast('Copy failed: ' + (e.message || ''), 'error');
      }
    });
  }

  async function copySectionToLocations(sourceGroup, targetLocs) {
    if (!NX.sb) throw new Error('Database unavailable');
    let inserted = 0;
    for (const targetLoc of targetLocs) {
      const targetTasks = tasksByLoc[targetLoc] || [];
      const existingSection = targetTasks.filter(t => t.section_es === sourceGroup.section_es);
      let sectionOrder;
      if (existingSection.length) {
        sectionOrder = existingSection[0].section_order;
      } else {
        sectionOrder = targetTasks.length
          ? Math.max(...targetTasks.map(t => t.section_order)) + 1
          : 0;
      }
      let nextTaskOrder = existingSection.length;
      for (const t of sourceGroup.tasks) {
        // Idempotency: skip if same Spanish name already in this section
        const dupe = existingSection.find(et =>
          et.name_es.trim().toLowerCase() === t.name_es.trim().toLowerCase()
        );
        if (dupe) continue;
        const { error } = await NX.sb.from('cleaning_tasks').insert({
          location:       targetLoc,
          section_es:     sourceGroup.section_es,
          section_en:     sourceGroup.section_en,
          section_order:  sectionOrder,
          task_order:     nextTaskOrder++,
          name_es:        t.name_es,
          name_en:        t.name_en,
          frequency_type: t.frequency_type,
          frequency_days: t.frequency_days,
          days_of_week:   t.days_of_week,
          assignee_id:    null,  // Don't carry assignee across locations
          notes:          t.notes,
        });
        if (!error) inserted++;
      }
    }
    await loadAllTasks();
    render();
    return inserted;
  }


  // ═══ SECTION KEBAB MENU (v12.2) ══════════════════════════════════════
  // Tap the small ⋯ button on a section card head → small popup with:
  //   • Copy to other locations…
  //   • Move section up
  //   • Move section down
  // Lives at viewport-fixed coords like the equipment overflow menu.
  function openSectionKebab(triggerBtn, group) {
    document.querySelectorAll('.clean-section-kebab-menu').forEach(m => m.remove());

    const groups = tasksBySection(activeLoc);
    const idx = groups.findIndex(g => g.section_es === group.section_es);
    const canUp   = idx > 0;
    const canDown = idx < groups.length - 1;

    const menu = document.createElement('div');
    menu.className = 'clean-section-kebab-menu';
    menu.innerHTML = `
      <button class="clean-section-kebab-item" data-action="copy">
        ${svg('plus', 14)} <span>Copy to other locations…</span>
      </button>
      <button class="clean-section-kebab-item ${canUp ? '' : 'is-disabled'}" data-action="up">
        <span class="clean-section-kebab-arrow">↑</span> <span>Move section up</span>
      </button>
      <button class="clean-section-kebab-item ${canDown ? '' : 'is-disabled'}" data-action="down">
        <span class="clean-section-kebab-arrow">↓</span> <span>Move section down</span>
      </button>
    `;
    document.body.appendChild(menu);

    // Position above the trigger, right-aligned
    const rect = triggerBtn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.bottom   = (window.innerHeight - rect.top + 4) + 'px';
    menu.style.right    = (window.innerWidth - rect.right) + 'px';
    menu.style.zIndex   = '8500';

    const close = (e) => {
      if (e && menu.contains(e.target)) return;
      menu.remove();
      document.removeEventListener('click', close, true);
      document.removeEventListener('touchstart', close, true);
    };
    setTimeout(() => {
      document.addEventListener('click', close, true);
      document.addEventListener('touchstart', close, true);
    }, 0);

    menu.querySelectorAll('[data-action]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        if (item.classList.contains('is-disabled')) return;
        menu.remove();
        document.removeEventListener('click', close, true);
        document.removeEventListener('touchstart', close, true);
        if (action === 'copy') openCopySectionDialog(group);
        else if (action === 'up')   moveSectionInLocation(group, 'up');
        else if (action === 'down') moveSectionInLocation(group, 'down');
      });
    });
  }


  function render() {
    const list = document.getElementById('cleanList');
    if (!list) return;
    list.innerHTML = '';

    const groups = tasksBySection(activeLoc);
    if (!groups.length) {
      list.innerHTML = `
        <div class="clean-empty">
          <div class="clean-empty-title">No tasks yet</div>
          <div class="clean-empty-hint">Tap <b>+ Add section</b> below to start building this location's checklist.</div>
        </div>`;
      renderFooterToolbar(list);
      return;
    }

    // Aggregate counts for header bar (daily completion %)
    let dailyDone = 0, dailyTotal = 0;
    groups.forEach(g => {
      g.tasks.forEach(t => {
        if (DAILY_TYPES.has(t.frequency_type)) {
          dailyTotal++;
          if (getDoneState(t.section_es, t.task_order)) dailyDone++;
        }
      });
    });
    const pct = dailyTotal ? Math.round(dailyDone / dailyTotal * 100) : 0;

    // Update top progress bar (already in HTML)
    const fillEl = document.getElementById('cleanFill');
    const pctEl  = document.getElementById('cleanPct');
    if (fillEl) fillEl.style.width = pct + '%';
    if (pctEl)  pctEl.textContent  = pct + '%';

    // ─── VIEW MODE TOGGLE ─────────────────────────────────────
    // "Today" / "All" segmented control + Training mode pill.
    // Stays at the top of the list; tap either side to flip
    // between minimal-noise morning view and full-catalog view.
    // Training pill (rightmost) toggles per-task training affordances.
    const viewToggle = document.createElement('div');
    viewToggle.className = 'clean-view-toggle-row';
    viewToggle.innerHTML = `
      <div class="clean-view-toggle">
        <button class="clean-view-toggle-btn ${viewMode === 'today' ? 'is-active' : ''}" data-view="today">Today</button>
        <button class="clean-view-toggle-btn ${viewMode === 'all'   ? 'is-active' : ''}" data-view="all">All</button>
      </div>
      <button class="clean-train-mode-pill ${trainingMode ? 'is-active' : ''}" data-train-toggle title="Show training affordances on each task">
        ${svg('award', 12)} <span>Training ${trainingMode ? 'on' : 'off'}</span>
      </button>
    `;
    viewToggle.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.view));
    });
    viewToggle.querySelector('[data-train-toggle]').addEventListener('click', () => {
      setTrainingMode(!trainingMode);
    });
    list.appendChild(viewToggle);

    // ─── COMING UP strip — 7-day forward look ────────────────────
    const comingUp = computeComingUp(COMING_UP_DAYS);
    if (comingUp.length) {
      const strip = document.createElement('div');
      strip.className = 'clean-coming-up';
      strip.innerHTML = `
        <div class="clean-coming-up-label">${svg('calendar', 12)} Coming up · ${COMING_UP_DAYS}d</div>
        <div class="clean-coming-up-scroll">
          ${comingUp.map(c => {
            const t = c.task;
            const d = c.daysUntil;
            const dueLabel = d <= 0
              ? (d === 0 ? 'Today' : `${Math.abs(d)}d overdue`)
              : (d === 1 ? 'Tomorrow' : `in ${d}d`);
            const cls = d <= 0 ? 'is-due' : (d <= 3 ? 'is-soon' : 'is-far');
            const assigneeName = t.assignee_id
              ? (usersList.find(u => u.id === t.assignee_id)?.name || '')
              : '';
            return `
              <button class="clean-coming-up-pill ${cls}" data-coming-task-id="${esc(t.id)}">
                <span class="clean-coming-up-pill-when">${esc(dueLabel)}</span>
                <span class="clean-coming-up-pill-name">${esc(t.name_en)}</span>
                ${assigneeName ? `<span class="clean-coming-up-pill-who">· ${esc(assigneeName)}</span>` : ''}
              </button>
            `;
          }).join('')}
        </div>
      `;
      // Tap a pill → expand its section + scroll to it
      strip.querySelectorAll('[data-coming-task-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tid = btn.dataset.comingTaskId;
          const t = (tasksByLoc[activeLoc] || []).find(x => x.id === tid);
          if (!t) return;
          collapsedSections.delete(t.section_es);
          render();
          // Scroll to the task row after re-render
          requestAnimationFrame(() => {
            const target = document.querySelector(
              `[data-section-es="${CSS.escape(t.section_es)}"] [data-task-id="${CSS.escape(t.id)}"]`
            );
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        });
      });
      list.appendChild(strip);
    }

    // Render every section card — filter by viewMode
    const visibleGroups = viewMode === 'today'
      ? groups.filter(g => g.tasks.some(t => DAILY_TYPES.has(t.frequency_type)))
      : groups;

    if (!visibleGroups.length && groups.length) {
      // viewMode='today' but no daily sections exist — show a hint
      const hint = document.createElement('div');
      hint.className = 'clean-empty-soft';
      hint.innerHTML = `
        <div class="clean-empty-soft-text">
          No daily sections at this location. Tap <b>All</b> above to see scheduled tasks.
        </div>`;
      list.appendChild(hint);
    } else {
      visibleGroups.forEach(group => {
        list.appendChild(renderSectionCard(group));
      });
    }

    renderFooterToolbar(list);
  }

  function renderSectionCard(group) {
    const isCollapsed = collapsedSections.has(group.section_es);
    const lang = getLang();
    const isDailySection = group.tasks.some(t => DAILY_TYPES.has(t.frequency_type));

    // Section status badge:
    //   • Daily: today's progress (4/6, 100% green when complete)
    //   • Non-daily: aggregate freshness (avg of task freshness)
    let statusHTML;
    let needsBoard = false;
    let onBoard = false;

    if (isDailySection) {
      const done = group.tasks.filter(t =>
        DAILY_TYPES.has(t.frequency_type) && getDoneState(t.section_es, t.task_order)
      ).length;
      const total = group.tasks.filter(t => DAILY_TYPES.has(t.frequency_type)).length;
      const ratio = total ? done / total : 0;
      const cls = ratio >= 1 ? 'is-fresh' : ratio >= 0.5 ? 'is-aging' : 'is-stale';
      statusHTML = `<div class="clean-sec-status">
        <span class="clean-fresh-chip ${cls}">${done}/${total}</span>
      </div>`;
    } else {
      const freshPct = sectionFreshness(group.tasks);
      const cls = freshnessClass(freshPct);
      // Show OVERDUE badge when any task is past its frequency
      const anyOverdue = group.tasks.some(t => freshnessForTask(t) === 0);
      statusHTML = `<div class="clean-sec-status">
        ${anyOverdue ? '<span class="clean-fresh-chip is-overdue">OVERDUE</span>' : ''}
        <span class="clean-fresh-chip ${cls}">${freshPct}%</span>
      </div>`;
      // Linked-board state — only meaningful for non-daily, action-needed sections
      const aging = freshPct < 50 || anyOverdue;
      onBoard    = !!linkedBoardCards[activeLoc + '__' + group.section_es];
      needsBoard = aging && !onBoard;
    }

    const card = document.createElement('div');
    card.className = 'clean-card' + (isCollapsed ? ' is-collapsed' : '');
    card.dataset.sectionEs = group.section_es;

    // ─── HEAD ─────────────────────────────────────────────────────
    const head = document.createElement('div');
    head.className = 'clean-card-head';
    head.innerHTML = `
      <div class="clean-card-titles">
        <div class="clean-card-title">${esc(lang === 'es' ? group.section_es : group.section_en)}</div>
        <div class="clean-card-sub">${esc(lang === 'es' ? group.section_en : group.section_es)}  ·  ${group.tasks.length} task${group.tasks.length === 1 ? '' : 's'}</div>
      </div>
      ${statusHTML}
      ${onBoard
        ? `<button class="clean-board-pill is-on-board" data-board-jump>${svg('archive', 12)} On board</button>`
        : (needsBoard ? `<button class="clean-board-pill" data-board-add>${svg('plus', 12)} To board</button>` : '')}
      <button class="clean-card-kebab" aria-label="Section options" data-section-kebab>⋯</button>
      <button class="clean-card-chev" aria-label="Toggle section">${svg('chevron', 18, 2)}</button>
    `;

    // Tapping the title block (NOT the buttons) toggles collapse
    head.querySelector('.clean-card-titles').addEventListener('click', () => {
      if (isCollapsed) collapsedSections.delete(group.section_es);
      else collapsedSections.add(group.section_es);
      render();
    });
    head.querySelector('.clean-card-chev').addEventListener('click', () => {
      if (isCollapsed) collapsedSections.delete(group.section_es);
      else collapsedSections.add(group.section_es);
      render();
    });
    // Board escalation
    const boardAddBtn = head.querySelector('[data-board-add]');
    if (boardAddBtn) {
      boardAddBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        escalateSectionToBoard(group);
      });
    }
    const boardJumpBtn = head.querySelector('[data-board-jump]');
    if (boardJumpBtn) {
      boardJumpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (NX.switchTo) NX.switchTo('board');
      });
    }
    // Section kebab → Copy / Move up / Move down
    const kebabBtn = head.querySelector('[data-section-kebab]');
    if (kebabBtn) {
      kebabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSectionKebab(kebabBtn, group);
      });
    }
    card.appendChild(head);

    // ─── BODY ─────────────────────────────────────────────────────
    if (!isCollapsed) {
      const body = document.createElement('div');
      body.className = 'clean-card-body';

      // "Check All" / "Undo all" — quick action for daily sections
      if (isDailySection) {
        const dailyTasks = group.tasks.filter(t => DAILY_TYPES.has(t.frequency_type));
        const allDone = dailyTasks.every(t => getDoneState(t.section_es, t.task_order));
        const checkAllBtn = document.createElement('button');
        checkAllBtn.className = 'clean-check-all-btn';
        checkAllBtn.innerHTML = allDone
          ? `${svg('close', 12)} <span>Undo all</span>`
          : `${svg('check', 12)} <span>Check all</span>`;
        checkAllBtn.addEventListener('click', async () => {
          const newState = !allDone;
          dailyTasks.forEach(t => setDoneState(t.section_es, t.task_order, newState));
          render();
          for (const t of dailyTasks) {
            await persistDone(t.section_es, t.task_order, newState);
          }
        });
        body.appendChild(checkAllBtn);
      }

      // Task rows
      group.tasks.forEach(task => {
        if (editingTaskId === task.id) {
          body.appendChild(renderTaskEditForm(task));
        } else {
          body.appendChild(renderTaskRow(task));
        }
      });

      // "+ Add task" inline form trigger (or the form itself if active)
      if (addingToSection === group.section_es) {
        body.appendChild(renderTaskEditForm({
          id: 'new',
          location: activeLoc,
          section_es: group.section_es,
          section_en: group.section_en,
          section_order: group.section_order,
          task_order: group.tasks.length,
          name_es: '',
          name_en: '',
          frequency_type: 'daily',
          frequency_days: 1,
          days_of_week: null,
          assignee_id: null,
          notes: '',
        }));
      } else {
        const addBtn = document.createElement('button');
        addBtn.className = 'clean-add-task-btn';
        addBtn.innerHTML = `${svg('plus', 14)} <span>Add task</span>`;
        addBtn.addEventListener('click', () => {
          addingToSection = group.section_es;
          editingTaskId = null;
          render();
        });
        body.appendChild(addBtn);
      }

      card.appendChild(body);
    }
    return card;
  }

  // ─── TASK ROW (display mode) ──────────────────────────────────────────
  function renderTaskRow(task) {
    const lang = getLang();
    const done = getDoneState(task.section_es, task.task_order);
    const isDaily = DAILY_TYPES.has(task.frequency_type);

    const row = document.createElement('div');
    row.className = 'clean-task' + (done ? ' is-done' : '');
    row.dataset.taskId = task.id;

    // Primary text in active language, secondary in the other
    const primary   = lang === 'es' ? task.name_es : task.name_en;
    const secondary = lang === 'es' ? task.name_en : task.name_es;

    // Freshness mini-bar (only for non-daily tasks — daily is just done/not-done)
    let freshHTML = '';
    if (!isDaily) {
      const pct = freshnessForTask(task);
      const cls = freshnessClass(pct);
      const histKey = task.section_es + '_' + task.task_order;
      const hist = lastDoneByKey[histKey];
      const subText = hist
        ? `${daysAgoText(daysBetween(hist.date, today))}${hist.by ? ' · ' + esc(hist.by) : ''}`
        : 'Never done';
      freshHTML = `
        <div class="clean-task-fresh">
          <div class="clean-fresh-bar">
            <div class="clean-fresh-bar-fill ${cls}" style="width:${pct}%"></div>
          </div>
          <div class="clean-task-fresh-sub">${esc(subText)}</div>
        </div>`;
    } else {
      // For daily tasks, show "done by X" if checked today
      const stateKey = task.section_es + '_' + task.task_order;
      const todayBy = todayStateByKey[stateKey]?.by;
      if (done && todayBy) {
        freshHTML = `<div class="clean-task-fresh-sub">by ${esc(todayBy)}</div>`;
      }
    }

    // Assignee chip
    let assigneeHTML = '';
    if (task.assignee_id) {
      const u = usersList.find(x => x.id === task.assignee_id);
      const name = u ? u.name : null;
      const initials = name ? name.split(/\s+/).map(p => p[0]).join('').slice(0,2).toUpperCase() : '?';
      assigneeHTML = `<span class="clean-assignee" title="${esc(name || 'Unknown')}">${esc(initials)}</span>`;
    }

    // Days-of-week pills (only for weekly + custom with days)
    let daysHTML = '';
    if (Array.isArray(task.days_of_week) && task.days_of_week.length && task.days_of_week.length < 7) {
      const labels = task.days_of_week
        .map(i => WEEKDAY_LABEL[i - 1] || '')
        .filter(Boolean)
        .join(' ');
      if (labels) {
        daysHTML = `<span class="clean-days-tag">${esc(labels)}</span>`;
      }
    }

    // Frequency badge for non-daily
    let freqHTML = '';
    if (!isDaily) {
      const def = FREQ_BY_TYPE[task.frequency_type];
      if (def) freqHTML = `<span class="clean-freq-tag">${esc(def.labelEn)}</span>`;
    }

    // Photos for this task today
    const taskKey = task.section_es + '_' + task.task_order;
    const photos = attachmentsByKey[taskKey] || [];
    let photosHTML = '';
    if (photos.length) {
      photosHTML = `<div class="clean-task-photos" data-photos>${
        photos.map(p => `
          <button class="clean-task-photo" data-photo-url="${esc(p.file_url)}" data-photo-id="${esc(p.id)}" aria-label="View photo">
            <img src="${esc(p.file_url)}" alt="" loading="lazy">
          </button>
        `).join('')
      }</div>`;
    }

    // Cost chip — only renders if a cost was logged today
    const costEntry = costsByKey[taskKey];
    let costHTML = '';
    if (costEntry && costEntry.cost > 0) {
      costHTML = `<span class="clean-cost-chip" title="${esc(costEntry.note || '')}">${esc(fmtCost(costEntry.cost))}</span>`;
    }

    // Training pill (visible only when training mode is on AND there
    // are linked modules). Shows "🎓 done/total"; tap to expand the
    // inline panel beneath the row.
    let trainingPillHTML = '';
    let trainingPanelHTML = '';
    if (trainingMode) {
      const [doneCount, totalCount] = trainingProgressForTask(task.id);
      if (totalCount > 0) {
        const allDone = doneCount === totalCount;
        const isOpen = expandedTrainingTaskId === task.id;
        trainingPillHTML = `
          <button class="clean-train-pill ${allDone ? 'is-done' : 'is-pending'} ${isOpen ? 'is-open' : ''}"
                  data-train-pill aria-label="Toggle training panel">
            ${svg('award', 11)} <span>${doneCount}/${totalCount}</span>
          </button>`;
        if (isOpen) {
          trainingPanelHTML = `
            <div class="clean-train-panel">
              ${(linksByTaskId[task.id] || []).map(modId => {
                const m = trainingModulesById[modId];
                if (!m) return '';
                const c = myTrainingByModule[modId];
                let status, statusCls;
                if (c) {
                  if (c.expires_at && (new Date(c.expires_at) - new Date()) / 86400000 < 0) {
                    status = 'Expired'; statusCls = 'is-expired';
                  } else if (c.expires_at && (new Date(c.expires_at) - new Date()) / 86400000 < 30) {
                    const d = Math.max(0, Math.floor((new Date(c.expires_at) - new Date()) / 86400000));
                    status = `Expiring · ${d}d`; statusCls = 'is-expiring';
                  } else {
                    status = 'Done'; statusCls = 'is-done';
                  }
                } else {
                  status = 'Pending'; statusCls = 'is-pending';
                }
                const showMarkBtn = !c || statusCls === 'is-expired' || statusCls === 'is-expiring';
                return `
                  <div class="clean-train-panel-row ${statusCls}">
                    <div class="clean-train-panel-info">
                      <div class="clean-train-panel-name">${esc(m.name_en)}</div>
                      <div class="clean-train-panel-meta">${esc(m.kind)}${m.category_en ? ' · ' + esc(m.category_en) : ''}</div>
                    </div>
                    <span class="clean-train-panel-status ${statusCls}">${esc(status)}</span>
                    ${m.resource_url ? `<a class="clean-train-panel-resource" href="${esc(m.resource_url)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
                    ${showMarkBtn ? `<button class="clean-train-panel-mark" data-mark-mod="${esc(modId)}">${svg('check', 12, 2.5)}</button>` : ''}
                  </div>
                `;
              }).join('')}
            </div>`;
        }
      }
    }

    // Active note for this task (v12.4) — surfaces an amber chip in
    // the meta row + the full note text below the freshness bar. Tap
    // the chip to dismiss; tap anywhere on the note to edit.
    const activeNote = notesByTaskId[task.id];
    let notePillHTML = '';
    let noteCardHTML = '';
    if (activeNote) {
      const ageHours = Math.floor((Date.now() - new Date(activeNote.created_at)) / 3600000);
      const ageStr = ageHours < 1 ? 'just now'
                   : ageHours < 24 ? `${ageHours}h ago`
                   : `${Math.floor(ageHours / 24)}d ago`;
      notePillHTML = `<span class="clean-note-pill" title="${esc(activeNote.note)}" data-note-pill>${svg('alert', 11)}<span>Note</span></span>`;
      noteCardHTML = `
        <div class="clean-note-card" data-edit-note>
          <div class="clean-note-card-text">${esc(activeNote.note)}</div>
          <div class="clean-note-card-meta">
            ${activeNote.created_by ? `<span>${esc(activeNote.created_by)}</span>` : ''}
            <span>·</span><span>${esc(ageStr)}</span>
          </div>
          <button class="clean-note-card-x" data-dismiss-note aria-label="Dismiss note">×</button>
        </div>`;
    }

    row.innerHTML = `
      <button class="clean-task-check" aria-label="Mark done" data-toggle-done>
        ${done ? svg('check', 14, 2.5) : ''}
      </button>
      <div class="clean-task-body">
        <button class="clean-task-name" data-show-history aria-label="Show completion history">${esc(primary)}</button>
        <div class="clean-task-meta">
          ${secondary && secondary !== primary ? `<span class="clean-task-secondary">${esc(secondary)}</span>` : ''}
          ${freqHTML}
          ${daysHTML}
          ${assigneeHTML}
          ${costHTML}
          ${notePillHTML}
          ${trainingPillHTML}
        </div>
        ${freshHTML}
        ${noteCardHTML}
        ${photosHTML}
        ${trainingPanelHTML}
      </div>
      <div class="clean-task-actions">
        <button class="clean-task-action-btn" aria-label="Add photo" data-add-photo title="Photo">
          ${svg('camera', 14, 2)}
        </button>
        <button class="clean-task-action-btn" aria-label="Log cost" data-log-cost title="Cost">
          <span style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px">$</span>
        </button>
        <button class="clean-task-action-btn" aria-label="${activeNote ? 'Edit note' : 'Add note'}" data-add-note title="${activeNote ? 'Edit note' : 'Note'}">
          ${svg('alert', 14, 2)}
        </button>
        <button class="clean-task-action-btn" aria-label="Edit task" data-edit-task title="Edit">
          ${svg('pen', 14, 2)}
        </button>
        </button>
      </div>
    `;

    // Training pill toggles the expanded panel
    const tpill = row.querySelector('[data-train-pill]');
    if (tpill) {
      tpill.addEventListener('click', (e) => {
        e.stopPropagation();
        expandedTrainingTaskId = (expandedTrainingTaskId === task.id) ? null : task.id;
        render();
      });
    }
    // Mark-complete buttons inside training panel
    row.querySelectorAll('[data-mark-mod]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await markTrainingCompleteFromCleaning(btn.dataset.markMod);
      });
    });

    // Wire interactions
    row.querySelector('[data-toggle-done]').addEventListener('click', async () => {
      const newDone = !done;
      setDoneState(task.section_es, task.task_order, newDone);
      render();
      await persistDone(task.section_es, task.task_order, newDone);
    });
    row.querySelector('[data-edit-task]').addEventListener('click', () => {
      editingTaskId = task.id;
      addingToSection = null;
      render();
    });
    row.querySelector('[data-add-photo]').addEventListener('click', () => {
      uploadPhotoForTask(task);
    });
    row.querySelector('[data-log-cost]').addEventListener('click', () => {
      openCostEntry(task);
    });
    // Note action: opens the editor (creates new or edits existing)
    row.querySelector('[data-add-note]').addEventListener('click', () => {
      openNoteEditor(task);
    });
    // Tap on the task name → completion history modal
    const nameBtn = row.querySelector('[data-show-history]');
    if (nameBtn) {
      nameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTaskHistory(task);
      });
    }
    // Active note card: tap text to edit, tap × to dismiss
    const dismissBtn = row.querySelector('[data-dismiss-note]');
    if (dismissBtn && activeNote) {
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissTaskNote(activeNote.id);
      });
    }
    const noteCard = row.querySelector('[data-edit-note]');
    if (noteCard && activeNote) {
      noteCard.addEventListener('click', (e) => {
        // Don't fire when tapping the dismiss × (it has its own handler
        // that stops propagation)
        if (e.target.closest('[data-dismiss-note]')) return;
        openNoteEditor(task);
      });
    }
    // Tap a photo thumbnail → full-screen viewer; long-press → delete
    row.querySelectorAll('[data-photo-url]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPhotoViewer(btn.dataset.photoUrl);
      });
      // Long-press (700ms) → confirm delete
      let pressTimer = null;
      const startPress = () => {
        pressTimer = setTimeout(() => {
          deletePhoto(btn.dataset.photoId, btn.dataset.photoUrl);
        }, 700);
      };
      const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
      btn.addEventListener('touchstart', startPress, { passive: true });
      btn.addEventListener('touchend',   cancelPress);
      btn.addEventListener('touchcancel', cancelPress);
      btn.addEventListener('mousedown',  startPress);
      btn.addEventListener('mouseup',    cancelPress);
      btn.addEventListener('mouseleave', cancelPress);
    });

    return row;
  }

  // ─── TASK EDIT FORM (inline, replaces the row when editing) ───────────
  // Same visual pattern as ordering's catalog item editor — full-card
  // inline form with stacked rows, gold "Save" pill, neutral "Cancel",
  // amber "Archive" for existing tasks. New tasks omit Archive.
  function renderTaskEditForm(task) {
    const isNew = task.id === 'new';
    const wrap = document.createElement('div');
    wrap.className = 'clean-task-edit-form';

    // Build assignee dropdown options
    const assigneeOptions = ['<option value="">— Unassigned —</option>']
      .concat(usersList.map(u =>
        `<option value="${u.id}" ${task.assignee_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`
      )).join('');

    // Frequency dropdown
    const freqOptions = FREQUENCY_DEFINITIONS.map(f =>
      `<option value="${f.type}" ${task.frequency_type === f.type ? 'selected' : ''}>${esc(f.labelEn)}${f.days ? ` (${f.days}d)` : ''}</option>`
    ).join('');

    // Days-of-week pills (only meaningful for weekly + custom)
    const daysSelected = new Set(task.days_of_week || []);
    const dayPillsHTML = WEEKDAY_LABEL.map((lbl, i) => {
      const dayNum = i + 1;
      const sel = daysSelected.has(dayNum);
      return `<button type="button" class="clean-day-pill ${sel ? 'is-selected' : ''}" data-day="${dayNum}">${esc(lbl.slice(0,1))}</button>`;
    }).join('');

    // Custom-frequency days input (only shown when type = 'custom')
    const showCustomDays = task.frequency_type === 'custom';

    // Days-of-week row visible only when frequency is weekly or custom
    const showDays = task.frequency_type === 'weekly' || task.frequency_type === 'custom';

    wrap.innerHTML = `
      <div class="clean-edit-row">
        <label class="clean-edit-label">Tarea (Español)</label>
        <input type="text" class="clean-edit-input" data-field="name_es"
               value="${esc(task.name_es || '')}"
               placeholder="p.ej. Limpiar las mesas." autocomplete="off">
      </div>
      <div class="clean-edit-row">
        <label class="clean-edit-label">Task (English)</label>
        <input type="text" class="clean-edit-input" data-field="name_en"
               value="${esc(task.name_en || '')}"
               placeholder="e.g. Wipe down the tables." autocomplete="off">
      </div>
      <div class="clean-edit-row clean-edit-row-2col">
        <div>
          <label class="clean-edit-label">Frequency</label>
          <select class="clean-edit-select" data-field="frequency_type">
            ${freqOptions}
          </select>
        </div>
        <div data-custom-days style="${showCustomDays ? '' : 'display:none'}">
          <label class="clean-edit-label">Custom days</label>
          <input type="number" class="clean-edit-input" data-field="frequency_days"
                 min="1" max="999" value="${task.frequency_days || 30}">
        </div>
      </div>
      <div class="clean-edit-row" data-days-row style="${showDays ? '' : 'display:none'}">
        <label class="clean-edit-label">On these days</label>
        <div class="clean-day-pills">${dayPillsHTML}</div>
      </div>
      <div class="clean-edit-row">
        <label class="clean-edit-label">Assigned to</label>
        <select class="clean-edit-select" data-field="assignee_id">
          ${assigneeOptions}
        </select>
      </div>
      <div class="clean-edit-row">
        <label class="clean-edit-label">Notes <span class="clean-edit-label-hint">(optional)</span></label>
        <textarea class="clean-edit-textarea" data-field="notes" rows="2"
                  placeholder="e.g. Use the green-handled brush from under the bar.">${esc(task.notes || '')}</textarea>
      </div>
      ${isNew ? '' : `
      <div class="clean-edit-row">
        <label class="clean-edit-label">Training modules <span class="clean-edit-label-hint">(staff must complete to do this task)</span></label>
        <div class="clean-edit-train-links" data-train-links-container>
          ${(linksByTaskId[task.id] || []).map(modId => {
            const m = trainingModulesById[modId];
            return `
              <span class="clean-edit-train-link" data-linked-mod="${esc(modId)}">
                ${svg('award', 11)} <span>${esc(m ? m.name_en : modId.slice(0,8))}</span>
                <button class="clean-edit-train-link-x" data-unlink-mod="${esc(modId)}" aria-label="Unlink">×</button>
              </span>
            `;
          }).join('')}
          <button class="clean-edit-train-link-add" type="button" data-link-add>${svg('plus', 12)} <span>Link module</span></button>
        </div>
      </div>
      `}
      ${isNew ? '' : `
      <div class="clean-edit-row clean-edit-reorder-row">
        <label class="clean-edit-label">Position</label>
        <div class="clean-edit-reorder">
          <button class="clean-edit-reorder-btn" type="button" data-move="up" aria-label="Move task up">↑ Up</button>
          <button class="clean-edit-reorder-btn" type="button" data-move="down" aria-label="Move task down">↓ Down</button>
        </div>
      </div>
      `}
      <div class="clean-edit-actions">
        <button class="clean-edit-cancel" type="button">Cancel</button>
        ${isNew ? '' : '<button class="clean-edit-archive" type="button">Archive</button>'}
        <button class="clean-edit-save" type="button">${isNew ? 'Add task' : 'Save'}</button>
      </div>
    `;

    // ─── Live wiring ──────────────────────────────────────────────
    // Frequency change → show/hide days-of-week + custom-days inputs
    const freqSel = wrap.querySelector('[data-field="frequency_type"]');
    freqSel.addEventListener('change', () => {
      const t = freqSel.value;
      wrap.querySelector('[data-days-row]').style.display =
        (t === 'weekly' || t === 'custom') ? '' : 'none';
      wrap.querySelector('[data-custom-days]').style.display =
        (t === 'custom') ? '' : 'none';
    });

    // Day pills toggle
    wrap.querySelectorAll('.clean-day-pill').forEach(pill => {
      pill.addEventListener('click', () => pill.classList.toggle('is-selected'));
    });

    // Cancel
    wrap.querySelector('.clean-edit-cancel').addEventListener('click', () => {
      editingTaskId = null;
      addingToSection = null;
      render();
    });

    // Move up / Move down — close the form and re-render the list
    wrap.querySelectorAll('[data-move]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const direction = btn.dataset.move;
        editingTaskId = null;
        await moveTaskInSection(task, direction);
      });
    });

    // Training-link controls (only present when not isNew)
    const linkAddBtn = wrap.querySelector('[data-link-add]');
    if (linkAddBtn) {
      linkAddBtn.addEventListener('click', () => {
        // Make sure caches are loaded so the picker shows the latest
        // existing-link state.
        loadTrainingData().then(() => {
          openTrainingLinkPicker(task, linksByTaskId[task.id] || []);
        });
      });
    }
    wrap.querySelectorAll('[data-unlink-mod]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await unlinkTrainingModuleFromTask(task.id, btn.dataset.unlinkMod);
      });
    });

    // Archive (existing tasks only) — single tap with toast undo
    const archiveBtn = wrap.querySelector('.clean-edit-archive');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', async () => {
        archiveBtn.disabled = true;
        archiveBtn.textContent = 'Archiving…';
        try {
          await archiveTask(task.id);
          editingTaskId = null;
          await loadAllTasks();
          render();
          toast('Task archived — restore from Archive button', 'info', 2400);
        } catch (e) {
          archiveBtn.disabled = false;
          archiveBtn.textContent = 'Archive';
          toast('Could not archive: ' + (e.message || ''), 'error');
        }
      });
    }

    // Save
    wrap.querySelector('.clean-edit-save').addEventListener('click', async () => {
      const get = (sel) => wrap.querySelector('[data-field="' + sel + '"]')?.value || '';
      const name_es = get('name_es').trim();
      const name_en = get('name_en').trim();
      if (!name_es && !name_en) {
        toast('Add a name in at least one language', 'warn');
        return;
      }
      const frequency_type = get('frequency_type') || 'daily';
      const def = FREQ_BY_TYPE[frequency_type];
      let frequency_days = def?.days || null;
      if (frequency_type === 'custom') {
        frequency_days = parseInt(get('frequency_days'), 10) || 30;
      }
      // Days of week — collect from pill UI
      const days_of_week = Array.from(wrap.querySelectorAll('.clean-day-pill.is-selected'))
        .map(p => parseInt(p.dataset.day, 10))
        .filter(n => n >= 1 && n <= 7);
      const assignee_raw = get('assignee_id');
      const assignee_id = assignee_raw ? parseInt(assignee_raw, 10) : null;
      const notes = get('notes').trim() || null;

      const payload = {
        location:       task.location,
        section_es:     task.section_es,
        section_en:     task.section_en,
        section_order:  task.section_order,
        task_order:     task.task_order,
        name_es:        name_es || name_en,
        name_en:        name_en || name_es,
        frequency_type,
        frequency_days,
        days_of_week:   (frequency_type === 'weekly' || frequency_type === 'custom') && days_of_week.length ? days_of_week : null,
        assignee_id,
        notes,
      };

      const saveBtn = wrap.querySelector('.clean-edit-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await saveTask(isNew ? null : task.id, payload);
        editingTaskId = null;
        addingToSection = null;
        await loadAllTasks();
        render();
        toast(isNew ? 'Task added' : 'Saved', 'info', 1400);
      } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = isNew ? 'Add task' : 'Save';
        toast('Could not save: ' + (e.message || ''), 'error');
      }
    });

    return wrap;
  }

  // ─── DB: save (insert/update) a task ──────────────────────────────────
  async function saveTask(existingId, payload) {
    if (!NX.sb) throw new Error('Database unavailable');
    if (existingId) {
      const { error } = await NX.sb.from('cleaning_tasks')
        .update(payload).eq('id', existingId);
      if (error) throw error;
    } else {
      // For new tasks, push to end of section
      const existing = (tasksByLoc[payload.location] || [])
        .filter(t => t.section_es === payload.section_es);
      payload.task_order = existing.length;
      const { error } = await NX.sb.from('cleaning_tasks').insert(payload);
      if (error) throw error;
    }
  }

  // ─── DB: archive a task (soft-delete) ─────────────────────────────────
  async function archiveTask(taskId) {
    if (!NX.sb) throw new Error('Database unavailable');
    const { error } = await NX.sb.from('cleaning_tasks')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq('id', taskId);
    if (error) throw error;
  }

  // ─── DB: restore an archived task ─────────────────────────────────────
  async function restoreTask(taskId) {
    if (!NX.sb) throw new Error('Database unavailable');
    const { error } = await NX.sb.from('cleaning_tasks')
      .update({ archived: false, archived_at: null })
      .eq('id', taskId);
    if (error) throw error;
    await loadAllTasks();
    render();
  }

  // ─── DB: fetch archived tasks (for the Archive overlay) ───────────────
  async function fetchArchivedTasks() {
    if (!NX.sb) return [];
    const { data, error } = await NX.sb.from('cleaning_tasks')
      .select('*')
      .eq('archived', true)
      .order('archived_at', { ascending: false })
      .limit(200);
    if (error) {
      console.warn('[cleaning] fetchArchivedTasks:', error);
      return [];
    }
    return data || [];
  }

  // ─── BOARD ESCALATION (preserved from v11) ────────────────────────────
  // When a non-daily section ages past its frequency cliff, the user
  // can escalate it to a kanban card. The card carries cleaning_link_*
  // metadata so when it's later marked Done in board.js, that closure
  // writes back to cleaning_logs (clearing the OVERDUE pill on this view).
  async function escalateSectionToBoard(group) {
    if (!NX.sb) { toast('Database unavailable', 'error'); return; }
    if (linkedBoardCards[activeLoc + '__' + group.section_es]) {
      toast('Already on the board', 'info');
      return;
    }
    // Pick first non-archived board + a list named report/todo/triage
    let target = null;
    try {
      const { data: bs } = await NX.sb.from('boards')
        .select('id').eq('archived', false).order('position').limit(1);
      if (!bs?.length) { toast('No board found — open Board view first', 'warn'); return; }
      const boardId = bs[0].id;
      const { data: ls } = await NX.sb.from('board_lists')
        .select('*').eq('board_id', boardId).order('position');
      const list = (ls || []).find(l => /report|todo|triage/i.test(l.name)) || (ls || [])[0];
      if (!list) { toast('No list available on the board', 'warn'); return; }
      target = { boardId, listId: list.id };
    } catch (e) {
      toast('Could not resolve board: ' + (e.message || ''), 'error');
      return;
    }

    // Build description = bilingual checklist of the section's tasks
    const desc = group.tasks.map(t => `• ${t.name_es} / ${t.name_en}`).join('\n');
    const freq = FREQ_BY_TYPE[group.tasks[0]?.frequency_type]?.days || 30;
    const oldestDays = group.tasks.reduce((acc, t) => {
      const hist = lastDoneByKey[t.section_es + '_' + t.task_order];
      return Math.max(acc, hist ? daysBetween(hist.date, today) : 999);
    }, 0);
    const isOverdue = oldestDays >= freq;
    const dueDate = isOverdue
      ? today
      : new Date(Date.now() + (freq - oldestDays) * 86400000).toISOString().slice(0, 10);

    try {
      await NX.sb.from('kanban_cards').insert({
        board_id:                target.boardId,
        list_id:                 target.listId,
        title:                   `Cleaning · ${group.section_en} · ${activeLoc}`,
        description:             desc,
        cleaning_link_location:  activeLoc,
        cleaning_link_section:   group.section_es,
        due_date:                dueDate,
        position:                Date.now(),
      });
      toast('Sent to board', 'info');
      await loadLinkedCards();
      render();
    } catch (e) {
      toast('Could not escalate: ' + (e.message || ''), 'error');
    }
  }

  // ─── FOOTER TOOLBAR (Add section button at bottom of list) ────────────
  function renderFooterToolbar(list) {
    const wrap = document.createElement('div');
    wrap.className = 'clean-footer-toolbar';
    wrap.innerHTML = `
      <button class="clean-add-section-btn" type="button">${svg('plus', 14)} <span>Add section</span></button>
    `;
    wrap.querySelector('.clean-add-section-btn').addEventListener('click', addNewSection);
    list.appendChild(wrap);
  }

  // ─── ADD SECTION (composer modal) ─────────────────────────────────────
  // New sections are created by inserting a placeholder task — there's
  // no separate sections table. Once one task exists, the section card
  // appears in the list and tasks can be added to it normally.
  function addNewSection() {
    if (!NX.composer?.modal) {
      // Fallback to native prompts if composer isn't loaded
      const sec_es = prompt('Section name (Spanish):');
      if (!sec_es) return;
      const sec_en = prompt('Section name (English):') || sec_es;
      createSectionWithFirstTask(sec_es, sec_en);
      return;
    }
    NX.composer.modal({
      title: 'New section',
      subtitle: 'Adds a section card with one starter task — you can rename or remove that task after.',
      buttonLabel: 'Create',
      fields: [
        { name: 'sec_es', label: 'Section (Español)', placeholder: 'p.ej. Bodega', autofocus: true },
        { name: 'sec_en', label: 'Section (English)', placeholder: 'e.g. Storage' },
      ],
      onSubmit: async ({ sec_es, sec_en }) => {
        const a = (sec_es || '').trim();
        const b = (sec_en || '').trim();
        if (!a && !b) throw new Error('Need a section name');
        await createSectionWithFirstTask(a || b, b || a);
      },
    });
  }

  async function createSectionWithFirstTask(sec_es, sec_en) {
    if (!NX.sb) { toast('Database unavailable', 'error'); return; }
    // Find next section_order for this location
    const existingOrders = (tasksByLoc[activeLoc] || []).map(t => t.section_order);
    const nextOrder = existingOrders.length ? Math.max(...existingOrders) + 1 : 0;
    try {
      await NX.sb.from('cleaning_tasks').insert({
        location:       activeLoc,
        section_es:     sec_es,
        section_en:     sec_en,
        section_order:  nextOrder,
        task_order:     0,
        name_es:        '(nueva tarea)',
        name_en:        '(new task)',
        frequency_type: 'daily',
        frequency_days: 1,
      });
      await loadAllTasks();
      // Auto-open the new section's first task for editing
      const section = (tasksByLoc[activeLoc] || []).find(t =>
        t.section_es === sec_es && t.task_order === 0);
      if (section) {
        editingTaskId = section.id;
        collapsedSections.delete(sec_es);
      }
      render();
    } catch (e) {
      toast('Could not create section: ' + (e.message || ''), 'error');
    }
  }

  // ─── EXTRAS — log work that wasn't in the catalog ─────────────────────
  // Preserved from v11 (with the localStorage backing — extras are
  // ephemeral, per-day records, not catalog entries). Common extras
  // dropdown for fast adds; "+ Custom" opens a composer modal for
  // one-off entries.
  const COMMON_EXTRAS = [
    ['Limpiar paredes.',                      'Clean the walls.'],
    ['Limpiar tubos de cobre.',               'Polish the copper pipes.'],
    ['Lavado a presión.',                     'Pressure wash.'],
    ['Limpieza profunda de refrigeradores.',  'Deep clean the fridges.'],
    ['Pulir latón/bronce.',                   'Polish brass and bronze.'],
    ['Limpiar trampas de grasa.',             'Clean the grease traps.'],
    ['Limpiar ductos de ventilación.',        'Clean the vent ducts.'],
    ['Limpiar detrás de equipos.',            'Clean behind equipment.'],
    ['Pulir pisos.',                          'Polish and buff the floors.'],
    ['Limpiar canaletas.',                    'Clean the gutters.'],
    ['Limpiar campana extractora.',           'Deep clean the hood.'],
    ['Descongelar congeladores.',             'Defrost the freezers.'],
  ];
  function getExtrasToday() {
    try {
      return JSON.parse(localStorage.getItem('nexus_extras_' + activeLoc + '_' + today) || '[]');
    } catch (e) { return []; }
  }
  function saveExtrasToday(ex) {
    localStorage.setItem('nexus_extras_' + activeLoc + '_' + today, JSON.stringify(ex));
  }

  function logExtra(es, en) {
    const ex = getExtrasToday();
    const timeNow = new Date().toLocaleTimeString([], {
      hour: 'numeric', minute: '2-digit',
    }).toLowerCase();
    ex.push({
      es:   es || en,
      en:   en || es,
      time: timeNow,
      by:   getUserName(),
    });
    saveExtrasToday(ex);
    render();
    toast('Extra logged', 'info', 1200);
  }

  function openExtrasMenu() {
    if (!NX.composer?.modal) return;
    // Build a select-options string for a quick custom-modal flow
    NX.composer.modal({
      title: 'Log an extra',
      subtitle: 'Work done today that isn\'t in the catalog',
      buttonLabel: 'Log',
      fields: [
        { name: 'es', label: 'Tarea (Español)', placeholder: 'p.ej. Limpiar bajo la nevera', autofocus: true },
        { name: 'en', label: 'Task (English)',  placeholder: 'e.g. Clean under fridge' },
      ],
      onSubmit: async ({ es, en }) => {
        if (!es && !en) throw new Error('Need a description');
        logExtra((es || '').trim(), (en || '').trim());
      },
    });
  }

  // ═══ SUBMIT + EMAIL ═════════════════════════════════════════════════════
  // Two paths from the same button:
  //   • Submit & log    — writes to daily_logs (today's record)
  //   • Submit & email  — does the above + opens mailto: with the report
  // The user picks via a small action menu; default is "Submit & email"
  // since the email is the highest-friction action and the user
  // explicitly asked for it.

  function buildEmailSubject() {
    const date = new Date(today + 'T12:00');
    const wk = date.toLocaleDateString([], { weekday: 'short' });
    const md = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const locName = activeLoc.charAt(0).toUpperCase() + activeLoc.slice(1);
    // Compute overall %
    const groups = tasksBySection(activeLoc);
    let dailyDone = 0, dailyTotal = 0;
    groups.forEach(g => g.tasks.forEach(t => {
      if (DAILY_TYPES.has(t.frequency_type)) {
        dailyTotal++;
        if (getDoneState(t.section_es, t.task_order)) dailyDone++;
      }
    }));
    const pct = dailyTotal ? Math.round(dailyDone / dailyTotal * 100) : 0;
    return `Cleaning · ${locName} · ${wk} ${md} · ${pct}%`;
  }

  /**
   * Build the full email body. Three sections:
   *   • DAILY        — today's progress per section, missed items called out
   *   • ON SCHEDULE  — non-daily sections with freshness % + assignee
   *   • EXTRAS       — ad-hoc work logged via the Extras flow
   * Format matches ordering's email body conventions: 45-char rules,
   * uppercase section labels, middle-dot bullets for sub-items.
   */
  function buildEmailBody(locName) {
    const groups = tasksBySection(activeLoc);
    const lines = [];
    const E = (window.NX && NX.email) || null;
    const sectionHeader = E ? E.sectionHeader : (lbl, suf) =>
      `--- ${String(lbl).toUpperCase()} ---${suf ? ' ' + suf : ''}`;
    const rule = E ? E.rule : () => '─'.repeat(45);

    // ─── Header block ──────────────────────────────────────────
    const date = new Date(today + 'T12:00');
    const dateStr = date.toLocaleDateString([], {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const submitter = getUserName();
    const submitTime = new Date().toLocaleTimeString([], {
      hour: 'numeric', minute: '2-digit',
    });

    lines.push(`Cleaning Report — ${dateStr}`);
    lines.push(`Location: ${locName}  ·  Submitted by ${submitter} at ${submitTime}`);
    lines.push('');

    // Aggregate metrics
    let dailyDone = 0, dailyTotal = 0;
    let allFreshness = [];
    groups.forEach(g => {
      g.tasks.forEach(t => {
        if (DAILY_TYPES.has(t.frequency_type)) {
          dailyTotal++;
          if (getDoneState(t.section_es, t.task_order)) dailyDone++;
        } else {
          allFreshness.push(freshnessForTask(t));
        }
      });
    });
    const dailyPct = dailyTotal ? Math.round(dailyDone / dailyTotal * 100) : 0;
    const overallFresh = allFreshness.length
      ? Math.round(allFreshness.reduce((a, b) => a + b, 0) / allFreshness.length)
      : 100;

    lines.push(`Overall freshness: ${overallFresh}%   ·   Daily completion: ${dailyDone}/${dailyTotal} (${dailyPct}%)`);
    lines.push('');

    // ─── DAILY section ─────────────────────────────────────────
    const dailyGroups = groups.filter(g =>
      g.tasks.some(t => DAILY_TYPES.has(t.frequency_type))
    );
    if (dailyGroups.length) {
      lines.push(sectionHeader('DAILY', `${dailyGroups.length} sections`));
      dailyGroups.forEach(g => {
        const dailyTasks = g.tasks.filter(t => DAILY_TYPES.has(t.frequency_type));
        const done = dailyTasks.filter(t => getDoneState(t.section_es, t.task_order));
        const missed = dailyTasks.filter(t => !getDoneState(t.section_es, t.task_order));
        const symbol = missed.length ? '⚠' : '✓';
        // Pick "done by" — most-recently-set name from today's state
        const completers = new Set();
        dailyTasks.forEach(t => {
          const k = t.section_es + '_' + t.task_order;
          const by = todayStateByKey[k]?.by;
          if (by) completers.add(by);
        });
        const byStr = completers.size
          ? `done by ${Array.from(completers).join(', ')}`
          : (missed.length ? '' : 'done');
        const namePart = padRight(g.section_en, 16);
        const ratioPart = padLeft(`${done.length}/${dailyTasks.length}`, 5);
        lines.push(`  ${namePart} ${ratioPart} ${symbol}  ${byStr}`);
        if (missed.length) {
          const missedNames = missed.map(t => t.name_en).join(', ');
          lines.push(`    missed: ${missedNames}`);
        }
      });
      lines.push('');
    }

    // ─── ON SCHEDULE section ───────────────────────────────────
    const scheduledGroups = groups.filter(g =>
      g.tasks.some(t => !DAILY_TYPES.has(t.frequency_type))
    );
    if (scheduledGroups.length) {
      lines.push(sectionHeader('ON SCHEDULE', `${scheduledGroups.length} sections`));
      scheduledGroups.forEach(g => {
        const schedTasks = g.tasks.filter(t => !DAILY_TYPES.has(t.frequency_type));
        const freshArr = schedTasks.map(t => freshnessForTask(t));
        const avgFresh = Math.round(freshArr.reduce((a, b) => a + b, 0) / freshArr.length);
        const anyOverdue = schedTasks.some(t => freshnessForTask(t) === 0);
        const symbol = anyOverdue ? '⚠' : (avgFresh >= 70 ? '✓' : '·');
        const namePart = padRight(g.section_en, 16);
        let info;
        if (anyOverdue) {
          // Find oldest overdue task to lead with
          let worst = null;
          schedTasks.forEach(t => {
            const hist = lastDoneByKey[t.section_es + '_' + t.task_order];
            const dSince = hist ? daysBetween(hist.date, today) : 999;
            const freq = t.frequency_days || FREQ_BY_TYPE[t.frequency_type]?.days || 30;
            const over = dSince - freq;
            if (!worst || over > worst.over) worst = { task: t, over, dSince };
          });
          info = `OVERDUE ${worst.over}d`;
          // Append assignee if set
          if (worst.task.assignee_id) {
            const u = usersList.find(x => x.id === worst.task.assignee_id);
            if (u) info += `  (assigned: ${u.name})`;
          }
        } else {
          info = `freshness ${avgFresh}%`;
        }
        lines.push(`  ${namePart} ${symbol}  ${info}`);
        // Per-task detail for non-daily — useful for quarterly + annual
        // tasks where each item has its own assignee/cadence.
        schedTasks.forEach(t => {
          const hist = lastDoneByKey[t.section_es + '_' + t.task_order];
          const since = hist ? daysAgoText(daysBetween(hist.date, today)) : 'never done';
          const freq = FREQ_BY_TYPE[t.frequency_type]?.labelEn || `${t.frequency_days}d`;
          const assignee = t.assignee_id
            ? (usersList.find(x => x.id === t.assignee_id)?.name || '')
            : '';
          let line = `    · ${t.name_en} — ${freq.toLowerCase()}, ${since}`;
          if (assignee) line += `, ${assignee}`;
          lines.push(line);
        });
      });
      lines.push('');
    }

    // ─── EXTRAS section ────────────────────────────────────────
    const extras = getExtrasToday();
    if (extras.length) {
      lines.push(sectionHeader('EXTRAS', `${extras.length} logged`));
      extras.forEach(ex => {
        const time = ex.time ? padRight(ex.time, 8) : padRight('', 8);
        const by = ex.by ? `  by ${ex.by}` : '';
        lines.push(`  ${time}${ex.en}${by}`);
      });
      lines.push('');
    }

    // ─── COSTS section ─────────────────────────────────────────
    // Aggregate any task completions today that recorded a cost.
    const costEntries = Object.entries(costsByKey)
      .filter(([_, v]) => v && v.cost > 0)
      .map(([k, v]) => {
        const [secEs, taskOrder] = (() => {
          const idx = k.lastIndexOf('_');
          return [k.slice(0, idx), parseInt(k.slice(idx + 1), 10)];
        })();
        const t = (tasksByLoc[activeLoc] || []).find(
          x => x.section_es === secEs && x.task_order === taskOrder
        );
        return { task: t, secEs, cost: v.cost, note: v.note };
      })
      .filter(e => e.task);
    if (costEntries.length) {
      const total = costEntries.reduce((acc, e) => acc + e.cost, 0);
      lines.push(sectionHeader('COSTS', `total ${fmtCost(total)}`));
      costEntries.forEach(e => {
        const name = padRight(e.task.name_en, 28);
        const cost = padLeft(fmtCost(e.cost), 8);
        const noteFrag = e.note ? `  — ${e.note}` : '';
        lines.push(`  ${name}${cost}${noteFrag}`);
      });
      lines.push('');
    }

    // ─── PHOTOS section ────────────────────────────────────────
    // Just a count + link list. Bodies are mailto:, so URLs render as
    // tap-to-open in any mail client. We list one URL per line so each
    // is selectable.
    const totalPhotos = Object.values(attachmentsByKey)
      .reduce((acc, arr) => acc + arr.length, 0);
    if (totalPhotos > 0) {
      lines.push(sectionHeader('PHOTOS', `${totalPhotos} attached`));
      Object.entries(attachmentsByKey).forEach(([k, arr]) => {
        const [secEs, taskOrder] = (() => {
          const idx = k.lastIndexOf('_');
          return [k.slice(0, idx), parseInt(k.slice(idx + 1), 10)];
        })();
        const t = (tasksByLoc[activeLoc] || []).find(
          x => x.section_es === secEs && x.task_order === taskOrder
        );
        const label = t ? t.name_en : secEs;
        lines.push(`  ${label} (${arr.length})`);
        arr.forEach(p => {
          lines.push(`    ${p.file_url}`);
        });
      });
      lines.push('');
    }

    // ─── Footer ────────────────────────────────────────────────
    lines.push(rule());
    lines.push('Photos and full audit trail in NEXUS.');

    return lines.join('\n');
  }

  // String padding helpers — left/right pad with spaces (mailto: bodies
  // render in monospace on most clients, so columns will line up).
  function padRight(s, n) {
    s = String(s == null ? '' : s);
    return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
  }
  function padLeft(s, n) {
    s = String(s == null ? '' : s);
    return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s;
  }

  // ─── DB: write today's report to daily_logs ───────────────────────────
  async function persistDailyLog(plainTextBody) {
    if (!NX.sb) throw new Error('Database unavailable');
    const locName = activeLoc.charAt(0).toUpperCase() + activeLoc.slice(1);
    const entry = `Cleaning Report — ${today}\n===\n${locName}\n${plainTextBody}`;
    // Update if a report for today already exists, else insert
    try {
      const { data: existing } = await NX.sb.from('daily_logs')
        .select('id')
        .ilike('entry', `Cleaning Report%${today}%${locName}%`)
        .limit(1);
      if (existing && existing.length) {
        const { error } = await NX.sb.from('daily_logs')
          .update({ entry })
          .eq('id', existing[0].id);
        if (error) throw error;
      } else {
        const { error } = await NX.sb.from('daily_logs').insert({ entry });
        if (error) throw error;
      }
    } catch (e) {
      throw e;
    }
    if (NX.syslog) NX.syslog('clean_report', `Cleaning report submitted for ${today} (${locName})`);
    if (NX.homeGalaxyPulse) NX.homeGalaxyPulse();
  }

  // ─── ACTION: Submit & log only (no email) ─────────────────────────────
  async function submitLogOnly() {
    const locName = activeLoc.charAt(0).toUpperCase() + activeLoc.slice(1);
    try {
      const body = buildEmailBody(locName);
      await persistDailyLog(body);
      toast('Report saved', 'info', 1600);
    } catch (e) {
      toast('Save failed: ' + (e.message || ''), 'error');
    }
  }

  // ─── ACTION: Submit & email (writes log, then opens mailto:) ──────────
  async function submitWithEmail() {
    const locName = activeLoc.charAt(0).toUpperCase() + activeLoc.slice(1);
    let body, subject;
    try {
      body = buildEmailBody(locName);
      subject = buildEmailSubject();
    } catch (e) {
      toast('Could not build report: ' + (e.message || ''), 'error');
      return;
    }

    // Long-email warning (the user explicitly opted in to long emails,
    // but we still warn so they can copy/paste into a different client
    // if their default mail app truncates).
    const E = (window.NX && NX.email) || null;
    const warnLen = E ? E.BODY_WARN_LEN : 1900;
    if (body.length > warnLen) {
      const ok = confirm(
        `This email is long (${body.length} chars). Some mail apps may truncate. Send anyway?`
      );
      if (!ok) return;
    }

    // Persist BEFORE opening mailto — iOS may pause JS once the mail
    // app takes focus, so the DB write must complete first.
    try {
      await persistDailyLog(body);
    } catch (e) {
      toast('Save failed (continuing to email): ' + (e.message || ''), 'warn', 4000);
    }

    // Resolve recipient email — currentUser's email if available
    const toAddress = (NX.currentUser && NX.currentUser.email) || '';
    const url = E
      ? E.buildMailtoUrl(toAddress, subject, body)
      : `mailto:${encodeURIComponent(toAddress)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    if (!toAddress) {
      // No email on file — open the mailto: anyway with empty TO so the
      // user can fill in their address in the mail app.
      toast('No email on file — fill it in your mail app', 'info', 3000);
    }

    // Same iOS-safe pattern as ordering: change href, don't open new
    // tab. Mail app takes focus, JS may pause, but the persist has
    // already completed.
    setTimeout(() => { window.location.href = url; }, 100);
  }

  // ─── BUTTON HANDLER: Submit Daily Report ──────────────────────────────
  // Decision UX: small action menu with two options. Default action
  // (the prominent one) is "Submit & email" since that's the new
  // capability the user just asked for. "Save without email" is the
  // secondary option for partial-day saves.
  function onSubmitClick() {
    if (!NX.composer?.modal) {
      // Fallback — go straight to email
      return submitWithEmail();
    }
    // Use a tiny custom action sheet via raw DOM (composer.modal is
    // for forms, not action menus). Render a backdrop + two buttons.
    const sheet = document.createElement('div');
    sheet.className = 'clean-submit-sheet';
    sheet.innerHTML = `
      <div class="clean-submit-sheet-bg"></div>
      <div class="clean-submit-sheet-card">
        <div class="clean-submit-sheet-title">Submit report</div>
        <div class="clean-submit-sheet-sub">Choose how to finish today's shift</div>
        <button class="clean-submit-sheet-primary" data-action="email">
          ${svg('mail', 16)} <span>Submit &amp; email</span>
        </button>
        <button class="clean-submit-sheet-secondary" data-action="log">
          Save without email
        </button>
        <button class="clean-submit-sheet-cancel" data-action="cancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    sheet.querySelector('.clean-submit-sheet-bg').addEventListener('click', close);
    sheet.querySelector('[data-action="cancel"]').addEventListener('click', close);
    sheet.querySelector('[data-action="email"]').addEventListener('click', () => {
      close(); submitWithEmail();
    });
    sheet.querySelector('[data-action="log"]').addEventListener('click', () => {
      close(); submitLogOnly();
    });
  }

  // ═══ LOCALSTORAGE MIGRATION ═════════════════════════════════════════════
  // v11 stored user-added tasks in localStorage under 'nexus_custom_tasks'.
  // On first v12 load, port any local-only customs into cleaning_tasks
  // and clear the localStorage key so we don't double-migrate. Idempotent
  // — safe to run on every load, but the localStorage check short-circuits
  // after the first successful migration.
  async function migrateLocalStorageCustoms() {
    let raw;
    try {
      raw = localStorage.getItem('nexus_custom_tasks');
      if (!raw) return;
    } catch (e) { return; }

    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return; }
    if (!parsed || typeof parsed !== 'object') return;

    let migrated = 0;
    for (const loc of Object.keys(parsed)) {
      const customs = parsed[loc] || [];
      if (!customs.length) continue;
      // Find the section_order base for this loc — we'll append
      // migrated customs as new tasks within their existing section
      // if the section exists, or create a new section if not.
      const existing = await loadTasksForLocation(loc);
      for (const ct of customs) {
        // Skip if a matching task already exists (idempotent check)
        const dupe = existing.find(t =>
          t.section_es === ct.section &&
          (t.name_es === ct.es || t.name_en === ct.en)
        );
        if (dupe) continue;
        // Find max task_order in this section
        const sectionTasks = existing.filter(t => t.section_es === ct.section);
        const nextTaskOrder = sectionTasks.length;
        // Find or invent section_order
        const sectionOrder = sectionTasks.length
          ? sectionTasks[0].section_order
          : (existing.length ? Math.max(...existing.map(t => t.section_order)) + 1 : 0);
        const sectionEn = sectionTasks.length ? sectionTasks[0].section_en : ct.section;
        try {
          const { error } = await NX.sb.from('cleaning_tasks').insert({
            location:       loc,
            section_es:     ct.section,
            section_en:     sectionEn,
            section_order:  sectionOrder,
            task_order:     nextTaskOrder,
            name_es:        ct.es || ct.en,
            name_en:        ct.en || ct.es,
            frequency_type: 'daily',
            frequency_days: 1,
          });
          if (!error) migrated++;
        } catch (e) {
          console.warn('[cleaning] migrate failed for one custom:', e);
        }
      }
    }

    if (migrated > 0) {
      try { localStorage.removeItem('nexus_custom_tasks'); } catch (e) {}
      console.log(`[cleaning] migrated ${migrated} custom task(s) from localStorage`);
      toast(`Restored ${migrated} custom task${migrated === 1 ? '' : 's'} from this device`, 'info', 3000);
    } else if (raw) {
      // Nothing migrated but we did have a payload — still clear it,
      // it was either all-duplicates or empty arrays.
      try { localStorage.removeItem('nexus_custom_tasks'); } catch (e) {}
    }
  }

  // ═══ ARCHIVE REGISTRATION ═══════════════════════════════════════════════
  // Plug into the unified NX.archive overlay. The overlay's "Cleaning" tab
  // pulls archived tasks via fetchArchivedTasks; tapping Restore on a row
  // calls restoreTask. Row rendering shows: location · section · task name
  // (bilingual) · when archived.
  function registerArchiveContributor() {
    if (!window.NX || !NX.archive) return;
    NX.archive.register({
      key:   'cleaning',
      label: 'Cleaning',
      empty: 'No archived cleaning tasks. Edit a task and tap Archive to send it here.',
      fetch: fetchArchivedTasks,
      renderRow: (row, ctx) => {
        const e = ctx.esc;
        const when = row.archived_at
          ? new Date(row.archived_at).toLocaleDateString([], {
              month: 'short', day: 'numeric', year: 'numeric',
            })
          : '';
        const locName = row.location.charAt(0).toUpperCase() + row.location.slice(1);
        const freqDef = FREQ_BY_TYPE[row.frequency_type];
        const freq = freqDef ? freqDef.labelEn : (row.frequency_type || '');
        return `
          <div class="nx-archive-row-title">${e(row.name_en || row.name_es)}</div>
          <div class="nx-archive-row-meta">
            <span class="nx-archive-row-loc">${e(locName)}</span>
            <span class="nx-archive-row-dot">·</span>
            <span class="nx-archive-row-section">${e(row.section_en || row.section_es)}</span>
            <span class="nx-archive-row-dot">·</span>
            <span class="nx-archive-row-freq">${e(freq)}</span>
            ${when ? `<span class="nx-archive-row-dot">·</span><span class="nx-archive-row-when">archived ${e(when)}</span>` : ''}
          </div>
          ${row.name_es && row.name_es !== row.name_en
            ? `<div class="nx-archive-row-secondary">${e(row.name_es)}</div>`
            : ''}
        `;
      },
      restore: async (id) => { await restoreTask(id); },
    });
  }

  // ═══ INIT + SHOW ════════════════════════════════════════════════════════
  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;

    // Wire the date display
    const dateEl = document.getElementById('cleanDate');
    if (dateEl) dateEl.textContent = today;

    // Wire location tabs
    document.querySelectorAll('.clean-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        document.querySelectorAll('.clean-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeLoc = tab.dataset.cloc;
        editingTaskId = null;
        addingToSection = null;
        await loadTodayState();
        await loadHistory();
        await loadAttachments();
        await loadCosts();
        await loadLinkedCards();
        await loadTrainingData();
        await loadTaskNotes();
        render();
        // Auto-escalate after a short delay so the user sees the
        // location's data first before any toast fires.
        setTimeout(() => { runAutoEscalations().catch(() => {}); }, 800);
      });
    });

    // Wire submit (with two-action menu)
    const submitBtn = document.getElementById('cleanSubmit');
    if (submitBtn) submitBtn.addEventListener('click', onSubmitClick);

    // Wire archive button (added to HTML alongside cleanSubmit)
    const archiveBtn = document.getElementById('cleanArchive');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', () => {
        if (NX.archive) NX.archive.open();
        else toast('Archive unavailable', 'warn');
      });
    }

    // Wire extras button (replaces the old in-list dropdown)
    const extrasBtn = document.getElementById('cleanExtras');
    if (extrasBtn) extrasBtn.addEventListener('click', openExtrasMenu);

    // Migrate any v11 localStorage customs first (one-time)
    try { await migrateLocalStorageCustoms(); } catch (e) {
      console.warn('[cleaning] migration error:', e);
    }

    // Load all data, then render
    await loadAllTasks();
    await loadUsers();
    await loadTodayState();
    await loadHistory();
    await loadAttachments();
    await loadCosts();
    await loadLinkedCards();
    await loadTrainingData();
    await loadTaskNotes();

    // Register with NX.archive
    registerArchiveContributor();

    render();

    // Run auto-escalation pass after first render. Wrapped in a delay
    // so the user sees their checklist before any "sent to board" toast.
    setTimeout(() => { runAutoEscalations().catch(() => {}); }, 1500);
  }

  async function show() {
    // Edit-past-report banner support (preserved from v11)
    if (window.NX && NX.editingReport) {
      today = NX.editingReport.date;
      let banner = document.getElementById('cleanEditBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'cleanEditBanner';
        banner.className = 'clean-edit-banner';
        const wrap = document.getElementById('cleanView');
        if (wrap) wrap.insertBefore(banner, wrap.firstChild);
      }
      banner.innerHTML = `
        <span>${svg('pen', 13)} Editing report for <b>${esc(today)}</b></span>
        <button id="cancelEditClean" class="clean-edit-cancel-banner">${svg('close', 12)} Cancel</button>
      `;
      banner.style.display = 'flex';
      const cancelBtn = document.getElementById('cancelEditClean');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          NX.editingReport = null;
          today = getCleaningDate();
          banner.style.display = 'none';
          show();
        });
      }
    } else {
      today = getCleaningDate();
      const banner = document.getElementById('cleanEditBanner');
      if (banner) banner.style.display = 'none';
    }

    const dateEl = document.getElementById('cleanDate');
    if (dateEl) dateEl.textContent = today;

    // Refresh state for current location
    await loadTodayState();
    await loadHistory();
    await loadAttachments();
    await loadCosts();
    await loadLinkedCards();
    await loadTrainingData();
    await loadTaskNotes();
    render();
  }

  // ═══ PUBLIC API ═════════════════════════════════════════════════════════
  // Expose hooks for ai chat / other modules to add tasks programmatically.
  // The shape mirrors v11's NX.cleaningAPI for backward compatibility,
  // but the underlying storage is now the database, not localStorage.
  async function apiAddTask(loc, sectionEs, sectionEn, es, en) {
    const existing = await loadTasksForLocation(loc);
    const sectionTasks = existing.filter(t => t.section_es === sectionEs);
    const sectionOrder = sectionTasks.length
      ? sectionTasks[0].section_order
      : (existing.length ? Math.max(...existing.map(t => t.section_order)) + 1 : 0);
    const taskOrder = sectionTasks.length;
    const { error } = await NX.sb.from('cleaning_tasks').insert({
      location: loc,
      section_es: sectionEs,
      section_en: sectionEn || sectionEs,
      section_order: sectionOrder,
      task_order: taskOrder,
      name_es: es || en,
      name_en: en || es,
      frequency_type: 'daily',
      frequency_days: 1,
    });
    if (error) throw error;
    if (loc === activeLoc) {
      await loadAllTasks();
      render();
    }
    return true;
  }

  async function apiRemoveTask(loc, text) {
    const lc = (text || '').toLowerCase();
    const tasks = await loadTasksForLocation(loc);
    const matches = tasks.filter(t =>
      (t.name_es || '').toLowerCase().includes(lc) ||
      (t.name_en || '').toLowerCase().includes(lc)
    );
    if (!matches.length) return false;
    for (const t of matches) {
      await archiveTask(t.id);
    }
    if (loc === activeLoc) {
      await loadAllTasks();
      render();
    }
    return true;
  }

  // ═══ EXPORTS ════════════════════════════════════════════════════════════
  if (!window.NX) window.NX = {};
  if (!NX.modules) NX.modules = {};
  NX.modules.clean = { init, show };

  // Backward-compatible API surface for AI chat / other callers
  NX.cleaningAPI = {
    addTask: apiAddTask,
    removeTask: apiRemoveTask,
    getLocations: () => LOCATIONS.slice(),
  };

})();
