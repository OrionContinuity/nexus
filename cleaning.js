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

  // ── Two-NX bridge (fixes "Composer unavailable" when adding a cleaning
  //    employee) ─────────────────────────────────────────────────────────
  // The shared UI engines — composer, email, archive — are attached to
  // window.NX, but this module's lexical `NX` is the app object (it carries
  // toast/sb/currentUser but NOT those engines, since they live on window.NX).
  // So NX.composer / NX.email / NX.archive were all undefined here. Copy the
  // references across once at load so every existing call site just works.
  // (composer.js/email/archive load eagerly at boot, before this lazy module.)
  try {
    if (typeof NX !== 'undefined' && window.NX) {
      NX.composer = NX.composer || window.NX.composer;
      NX.email    = NX.email    || window.NX.email;
      NX.archive  = NX.archive  || window.NX.archive;
    }
  } catch (_) {}

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
    graduation: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    scroll:   '<path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M15 8h-5"/><path d="M15 12h-5"/><path d="M21 21H8a3 3 0 0 1-3-3V7a3 3 0 0 0-3-3"/>',
    book:     '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
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
  // V16: restaurant-card landing. Cleaning opens on a card grid (one card per
  // restaurant: logo + name + shift %). Tapping a card enters that location.
  let showingLocationCards = true;
  let locationMeta = {};   // { cleaningKey: { label, photo_url, avatar_hue } }
  let progressByLoc = {};  // { cleaningKey: pct } — today's daily completion
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

  // ─── V15 state ────────────────────────────────────────────────────────
  // Assignment rows keyed by task_id. Each task can have many — one per
  // (day_of_week, shift) for weekly, one per year_month for monthly.
  let assignmentsByTaskId = {};
  let calloutsByDate = {};  // { 'YYYY-MM-DD': Set(userId string) } — last-minute call-outs
  // Local YYYY-MM-DD (toISOString is UTC → can be a day off in the evening).
  function localISO(d) { const x = d || new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
  // Linked education guides per task. Each value is an array of guide
  // objects with at least { id, title_en, primary_kind }.
  let guidesLinkedByTaskId = {};
  // Person-filter state: null = everyone (full view), otherwise the
  // user_id whose assignments are being filtered to. Persists for the
  // session in NX state so it survives navigation away+back.
  let viewingUserId = null;
  // Education mode — when ON, every task row shows a 📖 button regardless
  // of whether guides are linked. When OFF, the button is hidden entirely.
  // Lets cleaners toggle into "training mode" without cluttering the
  // checklist by default. Persisted in localStorage.
  let educationModeOn = false;
  try {
    educationModeOn = localStorage.getItem('clean_education_mode') === '1';
  } catch (e) {}
  // ─── V16 state — cleaner profiles + full-screen focus ──────────────────
  // profilesByUserId[user_id] = { working_days:int[1-7], default_shift,
  //   allowed_sections:string[] (section_es; empty = all), active }.
  // Drives soft "mine" highlighting (nothing is hidden) + the admin roster.
  let profilesByUserId = {};
  let profileTemplates = [];  // reusable profiles: {id,name,working_days,default_shift,allowed_sections}
  // Full-screen focus mode hides the app masthead so cleaning fills the
  // screen. Opt-in (default keeps the nav for fast hops). Persisted per device.
  let focusModeOn = false;
  try { focusModeOn = localStorage.getItem('clean_focus_mode') === '1'; } catch (e) {}
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
  const VIEW_MODES = ['now', 'today', 'all'];
  let viewMode = (() => {
    try {
      const saved = localStorage.getItem('nexus_clean_view_mode');
      return VIEW_MODES.includes(saved) ? saved : 'now';
    } catch (e) { return 'now'; }
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

  // ─── V15: assignments + guide-link loaders + helpers ──────────────────
  async function loadAssignments() {
    assignmentsByTaskId = {};
    if (!NX.sb || NX.paused) return;
    try {
      // Load all assignments for tasks in the current location. Avoids
      // pulling cross-location data we don't need to render this view.
      const taskIds = (tasksByLoc[activeLoc] || []).map(t => t.id);
      if (!taskIds.length) return;
      const { data, error } = await NX.sb.from('cleaning_task_assignments')
        .select('*')
        .in('task_id', taskIds);
      if (error) { console.warn('[cleaning] loadAssignments:', error); return; }
      (data || []).forEach(row => {
        if (!assignmentsByTaskId[row.task_id]) assignmentsByTaskId[row.task_id] = [];
        assignmentsByTaskId[row.task_id].push(row);
      });
    } catch (e) {
      console.warn('[cleaning] loadAssignments ex:', e);
    }
  }

  // Last-minute call-outs for the next 2 weeks. Gracefully degrades to "none"
  // if the cleaning_callouts table hasn't been migrated yet.
  async function loadCallouts() {
    calloutsByDate = {};
    if (!NX.sb || NX.paused) return;
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const to = new Date(today.getTime() + 14 * 86400000);
      const { data, error } = await NX.sb.from('cleaning_callouts')
        .select('user_id, off_date').gte('off_date', localISO(today)).lte('off_date', localISO(to));
      if (error) return;  // table missing → no call-outs (feature dormant until migrated)
      (data || []).forEach(r => { (calloutsByDate[r.off_date] = calloutsByDate[r.off_date] || new Set()).add(String(r.user_id)); });
    } catch (_) { /* dormant until migrated */ }
  }

  // ─── V16: cleaner profiles (who works which days + their allowed work) ──
  async function loadProfiles() {
    profilesByUserId = {};
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.from('cleaning_profiles').select('*');
      if (error) { console.warn('[cleaning] loadProfiles:', error); return; }
      (data || []).forEach(r => { profilesByUserId[r.user_id] = r; });
    } catch (e) {
      console.warn('[cleaning] loadProfiles ex:', e);
    }
  }

  // Profile helpers. All are permissive when no profile exists, so the
  // feature is additive: a person with no profile behaves exactly as before.
  function profileFor(userId) { return userId ? profilesByUserId[userId] : null; }
  // Works today? No profile / no days set = available any day.
  function worksToday(userId) {
    const p = profileFor(userId);
    if (!p || !Array.isArray(p.working_days) || !p.working_days.length) return true;
    return p.working_days.includes(todayDayOfWeek());
  }
  // Section allowed for this person? Unscoped profile = every section.
  function sectionAllowedFor(userId, sectionEs) {
    const p = profileFor(userId);
    if (!p || !Array.isArray(p.allowed_sections) || !p.allowed_sections.length) return true;
    return p.allowed_sections.includes(sectionEs);
  }
  // Is this task "mine" (the logged-in cleaner's) right now? SOFT signal —
  // used only for highlighting; nothing is ever hidden. Logic:
  //   • explicitly assigned to me today (am or pm) → mine
  //   • explicitly assigned to someone else today → not mine
  //   • otherwise → mine if I work today AND the section is in my scope
  function taskIsMine(task) {
    const me = getCurrentUserId();
    if (!me) return false;
    const { am, pm } = todayAssigneesFor(task);
    if ((am && am.id === me) || (pm && pm.id === me)) return true;
    if (am || pm) return false;            // assigned to others → theirs
    // Profile-scope fallback ONLY when the user has a profile — otherwise a
    // profile-less admin would light up every unassigned task.
    const p = profileFor(me);
    if (!p) return false;
    return worksToday(me) && sectionAllowedFor(me, task.section_es);
  }

  // Roster management is admin/owner only (or anyone granted 'admin').
  function canManageRoster() {
    // The roster lives inside the cleaning view, which is already access-
    // gated upstream. Keep it open to anyone who can reach cleaning so a
    // manager isn't locked out by a missing/!admin role tag. Tighten here
    // later (e.g. role check) if roster editing needs to be restricted.
    return !!(window.NX && NX.currentUser);
  }

  // ─── V16: full-screen focus mode (hide the masthead) ───────────────────
  // The body class is scoped in CSS to `body.view-clean.clean-focus`, so it
  // only hides the nav while the cleaning view is active — leaving the class
  // on after navigating away is harmless (view-clean is cleared by app.js).
  function applyFocusMode() {
    document.body.classList.toggle('clean-focus', !!focusModeOn);
  }
  function toggleFocusMode() {
    focusModeOn = !focusModeOn;
    try { localStorage.setItem('clean_focus_mode', focusModeOn ? '1' : '0'); } catch (e) {}
    applyFocusMode();
    render();
  }

  // ─── V16: "Now" lens — surface the right task at the right time ─────────
  // Wall-clock shift bucket: opening (am) before 3pm, closing (pm) after.
  function nowShift() { return new Date().getHours() < 15 ? 'am' : 'pm'; }
  function nowShiftLabel() { return nowShift() === 'am' ? 'Opening' : 'Closing'; }
  // Is this task relevant to the current shift right now? Daily tasks match
  // on shift_pattern; non-daily tasks count only when actually due (fresh=0).
  function taskIsNowRelevant(task) {
    if (!DAILY_TYPES.has(task.frequency_type)) return freshnessForTask(task) === 0;
    const sp = task.shift_pattern || 'am';
    return sp === 'both' || sp === nowShift();
  }
  // Ordering rank inside "Now": relevant-undone → other-undone → relevant-done → done.
  function nowTaskRank(task) {
    const done = getDoneState(task.section_es, task.task_order);
    const rel = taskIsNowRelevant(task);
    if (rel && !done) return 0;
    if (!rel && !done) return 1;
    if (rel && done) return 2;
    return 3;
  }

  // ─── V16: per-task training-button opt-in/out ──────────────────────────
  // The global "Learn" pill reveals + manages the training button on every
  // task. Independently, each task can be opted in or out of showing its
  // training button day-to-day. Stored per device (no migration). Default
  // (no preference) = show when the task has linked guides, as before.
  let taskTrainingPref = (() => {
    try { return JSON.parse(localStorage.getItem('clean_task_training_pref') || '{}') || {}; }
    catch (e) { return {}; }
  })();
  function setTaskTrainingPref(taskId, show) {
    if (show === null || show === undefined) delete taskTrainingPref[taskId];
    else taskTrainingPref[taskId] = !!show;
    try { localStorage.setItem('clean_task_training_pref', JSON.stringify(taskTrainingPref)); } catch (e) {}
  }
  function showTrainingFor(task) {
    const p = taskTrainingPref[task.id];
    if (p === true) return true;
    if (p === false) return false;
    return (guidesLinkedByTaskId[task.id] || []).length > 0;
  }

  // ─── V16: RESTAURANT CARDS (location landing) ──────────────────────────
  // Logos live in the shared `locations` table (photo_url / avatar_hue),
  // keyed by label. Cleaning keys are lowercase (suerte/este/toti); match by
  // label containing the key (so "Bar Toti" → toti).
  async function loadLocationMeta() {
    locationMeta = {};
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.from('locations')
        .select('label, photo_url, avatar_hue').eq('archived', false);
      if (error) { console.warn('[cleaning] loadLocationMeta:', error); return; }
      (data || []).forEach(r => {
        const lc = (r.label || '').toLowerCase();
        LOCATIONS.forEach(key => { if (lc.includes(key)) locationMeta[key] = r; });
      });
    } catch (e) { console.warn('[cleaning] loadLocationMeta ex:', e); }
  }

  // Today's daily-task completion % for every location (for the cards).
  async function loadAllLocProgress() {
    progressByLoc = {};
    const dailyKeys = {};
    LOCATIONS.forEach(loc => {
      const set = new Set();
      (tasksByLoc[loc] || []).forEach(t => {
        if (DAILY_TYPES.has(t.frequency_type)) set.add(t.section_es + '_' + t.task_order);
      });
      dailyKeys[loc] = set;
      progressByLoc[loc] = 0;
    });
    if (!NX.sb || NX.paused) return;
    try {
      const { data } = await NX.sb.from('cleaning_logs')
        .select('section, task_index, location').eq('log_date', today).eq('done', true);
      const doneSets = {};
      (data || []).forEach(r => {
        const set = dailyKeys[r.location];
        if (!set) return;
        const key = r.section + '_' + r.task_index;
        if (set.has(key)) {
          if (!doneSets[r.location]) doneSets[r.location] = new Set();
          doneSets[r.location].add(key);
        }
      });
      LOCATIONS.forEach(loc => {
        const total = dailyKeys[loc].size;
        const done = doneSets[loc] ? doneSets[loc].size : 0;
        progressByLoc[loc] = total ? Math.round(done / total * 100) : 0;
      });
    } catch (e) { console.warn('[cleaning] loadAllLocProgress:', e); }
  }

  function locLabel(loc) {
    const m = locationMeta[loc];
    return (m && m.label) ? m.label : (loc.charAt(0).toUpperCase() + loc.slice(1));
  }
  // Mirrors ordering's vendorAvatar() exactly (same hue hash, same markup +
  // classes) so the restaurant cards render identically to the vendor cards.
  function locAvatar(loc) {
    const m = locationMeta[loc];
    const label = locLabel(loc);
    const safeUrl = ((m && m.photo_url) || '').trim();
    if (safeUrl) {
      const safeAttr = safeUrl.replace(/"/g, '%22');
      return `<div class="ord-vendor-avatar ord-vendor-avatar-img" style="background-image:url(&quot;${safeAttr}&quot;)" role="img" aria-label="${esc(label)}"></div>`;
    }
    const clean = label.trim();
    const initial = clean.charAt(0).toUpperCase() || '?';
    let hue;
    if (m && typeof m.avatar_hue === 'number' && m.avatar_hue >= 0 && m.avatar_hue < 360) {
      hue = m.avatar_hue;
    } else {
      let hash = 0;
      for (let i = 0; i < clean.length; i++) hash = ((hash << 5) - hash + clean.charCodeAt(i)) | 0;
      hue = Math.abs(hash) % 360;
    }
    return `<div class="ord-vendor-avatar" style="--avatar-hue:${hue}">${esc(initial)}</div>`;
  }

  function applyCardsMode() {
    const pane = document.getElementById('dutiesCleaningPane');
    if (pane) pane.classList.toggle('is-loc-cards', showingLocationCards);
  }

  // ─── V16: printable Excel export (full schedule or per-person) ─────────
  function freqLabelFor(t) {
    const m = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
    return m[t.frequency_type] || (t.frequency_type ? (t.frequency_type[0].toUpperCase() + t.frequency_type.slice(1)) : 'Daily');
  }
  // Pull tasks (sorted) + their assignment rows for a location. Assignments
  // are queried fresh because loadAssignments() only holds the active loc.
  async function buildAssignmentMap(loc) {
    const tasks = (tasksByLoc[loc] || []).slice()
      .sort((a, b) => (a.section_es || '').localeCompare(b.section_es || '') || (a.task_order - b.task_order));
    const taskIds = tasks.map(t => t.id);
    const byTask = {};
    if (taskIds.length && NX.sb) {
      try {
        const { data } = await NX.sb.from('cleaning_task_assignments').select('*').in('task_id', taskIds);
        (data || []).forEach(r => { if (!byTask[r.task_id]) byTask[r.task_id] = []; byTask[r.task_id].push(r); });
      } catch (e) { console.warn('[cleaning] export assignments:', e); }
    }
    return { tasks, byTask };
  }

  async function exportCleaningExcel(loc, mode, userId) {
    if (typeof XLSX === 'undefined') { toast('Excel library not loaded — try again', 'error'); return; }
    const nameById = {}; usersList.forEach(u => { nameById[u.id] = u.name; });
    const { tasks, byTask } = await buildAssignmentMap(loc);
    const label = locLabel(loc);
    let aoa, cols, sheetName, fnameTag;

    if (mode === 'person') {
      const personName = nameById[userId] || 'Person';
      sheetName = personName.slice(0, 28);
      fnameTag = personName.replace(/\s+/g, '-').toLowerCase();
      aoa = [[`${label} · ${personName} — cleaning tasks`], [], ['Section', 'Task', 'Tarea', 'Frequency', 'Days', 'Shift']];
      tasks.forEach(t => {
        const mine = (byTask[t.id] || []).filter(a => String(a.user_id) === String(userId));
        if (!mine.length) return;
        const days = [...new Set(mine.map(a => a.day_of_week).filter(Boolean))].sort((a, b) => a - b).map(d => WEEKDAY_LABEL[d - 1]).join(' ');
        const shift = [...new Set(mine.map(a => a.shift).filter(Boolean))].map(s => s.toUpperCase()).join('/');
        aoa.push([t.section_en || t.section_es || '', t.name_en || '', t.name_es || '', freqLabelFor(t), days || 'any', shift || '—']);
      });
      if (aoa.length === 3) aoa.push(['—', 'No tasks assigned to this person', '', '', '', '']);
      cols = [22, 30, 30, 14, 16, 10];
    } else {
      sheetName = 'Schedule';
      fnameTag = 'full';
      aoa = [[`${label} — cleaning schedule (${today})`], [], ['Section', 'Task', 'Tarea', 'Frequency', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']];
      tasks.forEach(t => {
        const cells = ['', '', '', '', '', '', ''];
        (byTask[t.id] || []).forEach(a => {
          if (!a.day_of_week) return;
          const nm = nameById[a.user_id] || '';
          if (!nm) return;
          const i = a.day_of_week - 1;
          if (i < 0 || i > 6) return;
          const tag = a.shift ? `${nm} (${String(a.shift).toUpperCase()})` : nm;
          cells[i] = cells[i] ? cells[i] + ', ' + tag : tag;
        });
        aoa.push([t.section_en || t.section_es || '', t.name_en || '', t.name_es || '', freqLabelFor(t), ...cells]);
      });
      cols = [20, 28, 28, 12, 13, 13, 13, 13, 13, 13, 13];
    }

    try {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = cols.map(w => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `cleaning-${loc}-${fnameTag}-${today}.xlsx`);
      toast('Excel downloaded', 'success');
    } catch (e) {
      console.warn('[cleaning] export write:', e);
      toast('Export failed: ' + (e.message || e), 'error');
    }
  }

  // Small "more options" popup anchored to a card's ⋮ button (ordering-style).
  function openMenuNear(triggerBtn, innerHTML) {
    document.querySelectorAll('.clean-card-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'clean-card-menu';
    menu.innerHTML = innerHTML;
    document.body.appendChild(menu);
    const rect = triggerBtn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
    menu.style.zIndex = '8600';
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
    return { menu, close };
  }

  function openCardExportMenu(triggerBtn, loc) {
    const { menu, close } = openMenuNear(triggerBtn, `
      <div class="clean-card-menu-title">Print · ${esc(locLabel(loc))}</div>
      <button class="clean-card-menu-item" data-x="full">${svg('document', 14)} Full schedule (Excel)</button>
      <button class="clean-card-menu-item" data-x="person">${svg('user', 14)} By person… (Excel)</button>
    `);
    menu.querySelectorAll('[data-x]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const x = item.dataset.x;
        close();
        if (x === 'full') exportCleaningExcel(loc, 'full');
        else openPersonExportMenu(triggerBtn, loc);
      });
    });
  }

  async function openPersonExportMenu(triggerBtn, loc) {
    const { byTask } = await buildAssignmentMap(loc);
    const ids = new Set();
    Object.values(byTask).forEach(rows => rows.forEach(r => { if (r.user_id != null) ids.add(String(r.user_id)); }));
    const people = usersList.filter(u => ids.has(String(u.id)));
    if (!people.length) { toast('No one is assigned here yet', 'info'); return; }
    const { menu, close } = openMenuNear(triggerBtn, `
      <div class="clean-card-menu-title">Print for…</div>
      <div class="clean-card-menu-scroll">
        ${people.map(u => `<button class="clean-card-menu-item" data-uid="${esc(u.id)}">${esc(u.name)}</button>`).join('')}
      </div>
    `);
    menu.querySelectorAll('[data-uid]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(item.dataset.uid, 10) || item.dataset.uid;
        close();
        exportCleaningExcel(loc, 'person', uid);
      });
    });
  }

  function renderLocationCards(list) {
    const wrap = document.createElement('div');
    wrap.className = 'clean-loc-cards';
    wrap.innerHTML = `
      <div class="clean-loc-cards-title">Restaurants</div>
      <div class="ord-vendors">
        ${LOCATIONS.map(loc => {
          const pct = progressByLoc[loc] || 0;
          const label = locLabel(loc);
          return `
            <div class="ord-vendor-row-wrap">
              <button class="ord-vendor-row" data-enter-loc="${esc(loc)}" data-vendor-name="${esc(label.toLowerCase())}">
                <div class="ord-vendor-avatar-wrap">${locAvatar(loc)}</div>
                <div class="ord-vendor-main">
                  <div class="ord-vendor-name-row">
                    <div class="ord-vendor-name">${esc(label)}</div>
                    <div class="ord-vendor-when">${pct}%</div>
                  </div>
                  <div class="ord-vendor-meta">
                    <span class="ord-vendor-preview">shift progress today</span>
                  </div>
                </div>
                <div class="ord-arrow" aria-hidden="true">›</div>
              </button>
              <button class="clean-loc-menu" data-loc-menu="${esc(loc)}" aria-label="Print options for ${esc(label)}">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
              </button>
            </div>`;
        }).join('')}
      </div>
    `;
    list.appendChild(wrap);
    wrap.querySelectorAll('[data-enter-loc]').forEach(btn => {
      btn.addEventListener('click', () => enterLocation(btn.dataset.enterLoc));
    });
    wrap.querySelectorAll('[data-loc-menu]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openCardExportMenu(btn, btn.dataset.locMenu); });
    });
  }

  function renderLocBackRow() {
    const row = document.createElement('button');
    row.className = 'clean-loc-back';
    row.type = 'button';
    row.innerHTML = `<span class="clean-loc-back-chev">${svg('chevron', 16)}</span><span class="clean-loc-back-text">Restaurants</span><span class="clean-loc-back-current">${esc(locLabel(activeLoc))}</span>`;
    row.addEventListener('click', backToCards);
    return row;
  }

  async function enterLocation(loc) {
    if (!LOCATIONS.includes(loc)) return;
    activeLoc = loc;
    showingLocationCards = false;
    editingTaskId = null;
    addingToSection = null;
    document.querySelectorAll('.clean-tab').forEach(t => t.classList.toggle('active', t.dataset.cloc === loc));
    await loadTodayState();
    await loadHistory();
    await loadAttachments();
    await loadCosts();
    await loadLinkedCards();
    await loadTrainingData();
    await loadTaskNotes();
    applyCardsMode();
    render();
    setTimeout(() => { runAutoEscalations().catch(() => {}); }, 800);
  }

  async function backToCards() {
    showingLocationCards = true;
    editingTaskId = null;
    addingToSection = null;
    applyCardsMode();
    await loadAllLocProgress();
    render();
  }

  async function loadGuideLinks() {
    guidesLinkedByTaskId = {};
    if (!NX.sb || NX.paused) return;
    try {
      const taskIds = (tasksByLoc[activeLoc] || []).map(t => t.id);
      if (!taskIds.length) return;
      // Join through cleaning_task_guides to get the guide rows. Postgrest
      // syntax: select linked-table fields via the FK relation.
      const { data, error } = await NX.sb.from('cleaning_task_guides')
        .select('task_id, sort_order, education_guides(id, title_en, primary_kind, context_hint)')
        .in('task_id', taskIds)
        .order('sort_order', { ascending: true });
      if (error) { console.warn('[cleaning] loadGuideLinks:', error); return; }
      (data || []).forEach(row => {
        if (!row.education_guides) return;
        if (!guidesLinkedByTaskId[row.task_id]) guidesLinkedByTaskId[row.task_id] = [];
        guidesLinkedByTaskId[row.task_id].push(row.education_guides);
      });
    } catch (e) {
      console.warn('[cleaning] loadGuideLinks ex:', e);
    }
  }

  // Returns 1-7 for today (1=Sun, 2=Mon, ..., 7=Sat). Postgres convention.
  function todayDayOfWeek() {
    return new Date().getDay() + 1;
  }
  // Returns YYYYMM int for current month
  function currentYearMonth() {
    const d = new Date();
    return d.getFullYear() * 100 + (d.getMonth() + 1);
  }

  // For a given task, returns { am: user|null, pm: user|null } for today.
  // Looks up assignments based on day_of_week + scope. Also handles
  // monthly tasks by checking year_month.
  function todayAssigneesFor(task) {
    const rows = assignmentsByTaskId[task.id] || [];
    const isMonthly = (task.frequency_type === 'monthly');
    const dow = todayDayOfWeek();
    const ym = currentYearMonth();
    const offToday = calloutsByDate[localISO()] || null;  // last-minute call-outs
    let am = null, pm = null;
    rows.forEach(r => {
      if (isMonthly && r.scope === 'monthly' && r.year_month === ym) {
        // Monthly tasks: one assignee for the whole month, slot it as am
        // for display purposes (the task only happens once anyway).
        const u = usersList.find(x => x.id === r.user_id);
        if (u) am = u;
      } else if (!isMonthly && r.scope === 'weekly' && r.day_of_week === dow) {
        if (offToday && offToday.has(String(r.user_id))) return;  // called out today → slot opens up
        const u = usersList.find(x => x.id === r.user_id);
        if (!u) return;
        if (r.shift === 'am') am = u;
        if (r.shift === 'pm') pm = u;
      }
    });
    return { am, pm };
  }

  // Filters task groups to only those assigned to a specific user today.
  // Returns the original groups if userId is null (everyone view).
  // Tasks with NO assignments at all are treated as universal/unassigned —
  // they show for everyone regardless of person filter. Only tasks that
  // explicitly have assignments get filtered down to their assignees.
  function filterGroupsByUser(groups, userId) {
    if (!userId) return groups;
    return groups.map(g => {
      const filtered = g.tasks.filter(t => {
        const rows = assignmentsByTaskId[t.id] || [];
        // Zero assignments anywhere → universal task, show always
        if (rows.length === 0) return true;
        // Has assignments → only show if THIS user is on today's roster
        const { am, pm } = todayAssigneesFor(t);
        return (am && am.id === userId) || (pm && pm.id === userId);
      });
      return filtered.length ? { ...g, tasks: filtered } : null;
    }).filter(Boolean);
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
        // BUGFIX 2026-05-09: Supabase Storage rejects keys with non-ASCII
        // chars. Section names like "🍽 COMEDOR" or "JARDÍN" used to leak
        // emojis + accents into the path. We now strip ANYTHING that
        // isn't [A-Za-z0-9_-], collapse runs of underscores, and trim.
        const safeName = file.name.replace(/[^a-z0-9.]/gi, '_');
        const safeSection = (task.section_es || 'SECTION')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // ÁÉ → AE
          .replace(/[^A-Za-z0-9_-]+/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, '')
          .toUpperCase()
          || 'SECTION';
        const fname = `${activeLoc}/${today}/${safeSection}-${task.task_order}-${Date.now()}-${safeName}`;
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
    if (!(await NX.confirm('Delete this photo?', { danger: true, okLabel: 'Delete' }))) return;
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
  async function openCostEntry(task) {
    if (!NX.composer?.modal) {
      const v = await NX.prompt('Cost for this task ($):', { title: 'Task cost', placeholder: '0.00' });
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
  async function openNoteEditor(task) {
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
      const v = await NX.prompt('Note:', { title: 'Note', value: existing ? existing.note : '', multiline: true });
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


  // ═══ TASK GUIDE PICKER (v15) ═════════════════════════════════════════
  // Only used when a task has 2+ linked guides. Shows them in a small
  // sheet so the user can pick which one to open. (Single-guide tasks
  // open directly without this intermediate.)
  function openTaskGuidePicker(task, guides) {
    document.querySelectorAll('.clean-guide-picker').forEach(m => m.remove());

    const sheet = document.createElement('div');
    sheet.className = 'clean-guide-picker';
    sheet.innerHTML = `
      <div class="clean-guide-picker-bg"></div>
      <div class="clean-guide-picker-card">
        <div class="clean-guide-picker-head">
          <div class="clean-guide-picker-title">Pick a guide</div>
          <button class="clean-guide-picker-close" aria-label="Close">${svg('close', 14)}</button>
        </div>
        <div class="clean-guide-picker-list">
          ${guides.map(g => {
            const kindIcon = {
              text:'book', video:'camera', pdf:'pen', embed:'link', steps:'check'
            }[g.primary_kind] || 'book';
            return `
              <button class="clean-guide-picker-item" data-guide-id="${esc(g.id)}">
                <span class="clean-guide-picker-kind">${svg(kindIcon, 13)}</span>
                <span class="clean-guide-picker-name">${esc(g.title_en)}</span>
                ${g.context_hint ? `<span class="clean-guide-picker-hint">${esc(g.context_hint)}</span>` : ''}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    const close = () => sheet.remove();
    sheet.querySelector('.clean-guide-picker-bg').addEventListener('click', close);
    sheet.querySelector('.clean-guide-picker-close').addEventListener('click', close);
    sheet.querySelectorAll('[data-guide-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        close();
        if (NX.educationAPI && NX.educationAPI.openGuideViewer) {
          NX.educationAPI.openGuideViewer(btn.dataset.guideId, { returnToView: 'clean' });
        }
      });
    });
  }


  // ═══ PERSON FILTER PICKER (v15) ══════════════════════════════════════
  // Slide-up sheet listing all known users + "Everyone". Tap a row to
  // switch the cleaning view to that person's assignments. Persists for
  // the session in viewingUserId state.
  function openPersonFilterPicker() {
    document.querySelectorAll('.clean-person-picker').forEach(m => m.remove());

    const me = getCurrentUserId();
    const sheet = document.createElement('div');
    sheet.className = 'clean-person-picker';
    sheet.innerHTML = `
      <div class="clean-person-picker-bg"></div>
      <div class="clean-person-picker-card">
        <div class="clean-person-picker-head">
          <div class="clean-person-picker-title">Whose view to show</div>
          <button class="clean-person-picker-close" aria-label="Close">${svg('close', 14)}</button>
        </div>
        <div class="clean-person-picker-list">
          <button class="clean-person-picker-item ${viewingUserId === null ? 'is-selected' : ''}" data-user-id="">
            <span class="clean-person-picker-dot"></span>
            <span class="clean-person-picker-name">Everyone</span>
            <span class="clean-person-picker-hint">All tasks across the location</span>
          </button>
          ${usersList.map(u => {
            const isSelected = (viewingUserId === u.id);
            const isMe = (me === u.id);
            const p = profilesByUserId[u.id];
            const daysHint = (p && Array.isArray(p.working_days) && p.working_days.length && p.working_days.length < 7)
              ? p.working_days.slice().sort((a, b) => a - b).map(d => WEEKDAY_LABEL[d - 1]).filter(Boolean).join(' ')
              : (p && Array.isArray(p.working_days) && p.working_days.length === 7 ? 'Every day' : '');
            const secHint = (p && Array.isArray(p.allowed_sections) && p.allowed_sections.length)
              ? `${p.allowed_sections.length} section${p.allowed_sections.length === 1 ? '' : 's'}`
              : 'All sections';
            const hint = daysHint ? `${daysHint} · ${secHint}` : `Show ${u.name}'s tasks`;
            return `
              <button class="clean-person-picker-item ${isSelected ? 'is-selected' : ''}" data-user-id="${esc(u.id)}">
                <span class="clean-person-picker-dot"></span>
                <span class="clean-person-picker-name">${esc(u.name)}${isMe ? ' <span class="clean-person-picker-me">(me)</span>' : ''}</span>
                <span class="clean-person-picker-hint">${esc(hint)}</span>
              </button>
            `;
          }).join('')}
        </div>
        ${canManageRoster() ? `
          <button class="clean-roster-manage-btn" data-manage-roster type="button">
            ${svg('user', 14)} <span>Manage roster &amp; scope</span>
          </button>` : ''}
      </div>
    `;
    document.body.appendChild(sheet);

    const close = () => sheet.remove();
    sheet.querySelector('.clean-person-picker-bg').addEventListener('click', close);
    sheet.querySelector('.clean-person-picker-close').addEventListener('click', close);
    sheet.querySelectorAll('[data-user-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.userId;
        viewingUserId = v ? (parseInt(v, 10) || v) : null;
        close();
        render();
      });
    });
    const manageBtn = sheet.querySelector('[data-manage-roster]');
    if (manageBtn) manageBtn.addEventListener('click', () => { close(); openRosterManager(); });
  }

  // ═══ ROSTER MANAGER (v16) ════════════════════════════════════════════
  // Admin-only. One row per user → expand to set the days they work, their
  // default shift, and the SECTIONS they're allowed to clean (their scope).
  // Saved to cleaning_profiles. The scope is a SOFT limit: it drives "mine"
  // highlighting + the picker hints, it does not hide anything from anyone.
  // V16: reusable profile templates (preset days + shift + sections).
  async function loadTemplates() {
    profileTemplates = [];
    if (!NX.sb || NX.paused) return;
    try {
      const { data, error } = await NX.sb.from('cleaning_profile_templates').select('*').order('name');
      if (error) { console.warn('[cleaning] loadTemplates:', error); return; }
      profileTemplates = data || [];
    } catch (e) { console.warn('[cleaning] loadTemplates ex:', e); }
  }

  // V16: attaching/saving a profile autofills the person's weekly task
  // assignments at the CURRENT restaurant — every task in their allowed
  // sections, on each working day, at their shift. Replaces only the
  // (task,day) cells the profile covers so other manual assignments survive.
  // Needs both days and sections to do anything.
  async function autofillAssignmentsForUser(userId, days, shift, sections) {
    if (!NX.sb || !userId || !days.length || !sections.length) return { count: 0, skipped: true };
    const taskIds = (tasksByLoc[activeLoc] || [])
      .filter(t => sections.includes(t.section_es)).map(t => t.id);
    if (!taskIds.length) return { count: 0 };
    const shifts = shift === 'both' ? ['am', 'pm'] : [shift || 'am'];
    try {
      await NX.sb.from('cleaning_task_assignments').delete()
        .eq('user_id', userId).eq('scope', 'weekly')
        .in('task_id', taskIds).in('day_of_week', days);
    } catch (e) { console.warn('[cleaning] autofill clear:', e); }
    const rows = [];
    taskIds.forEach(tid => days.forEach(d => shifts.forEach(s => {
      rows.push({ task_id: tid, user_id: userId, scope: 'weekly', day_of_week: d, shift: s, year_month: null });
    })));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await NX.sb.from('cleaning_task_assignments').insert(rows.slice(i, i + 500));
      if (error) { console.warn('[cleaning] autofill insert:', error); return { count: i, error }; }
    }
    return { count: rows.length };
  }

  // Schedule-driven auto-fill: assign duties to the WHOLE scheduled crew at once
  // (the employee calendar), not just one person. For a given day-of-week, every
  // active profile that works that day gets their allowed-section duties filled
  // at their shift. autofillScheduleWeek does the same across each person's days.
  function _activeProfiles() {
    return Object.values(profilesByUserId).filter(p =>
      p && p.active !== false && p.user_id != null &&
      Array.isArray(p.allowed_sections) && p.allowed_sections.length);
  }
  async function autofillScheduleForDay(dow) {
    let total = 0, people = 0;
    for (const p of _activeProfiles()) {
      if (!Array.isArray(p.working_days) || !p.working_days.includes(dow)) continue;
      const r = await autofillAssignmentsForUser(p.user_id, [dow], p.default_shift || 'both', p.allowed_sections);
      if (r && r.count) { total += r.count; people++; }
    }
    return { total, people };
  }
  async function autofillScheduleWeek() {
    let total = 0, people = 0;
    for (const p of _activeProfiles()) {
      if (!Array.isArray(p.working_days) || !p.working_days.length) continue;
      const r = await autofillAssignmentsForUser(p.user_id, p.working_days, p.default_shift || 'both', p.allowed_sections);
      if (r && r.count) { total += r.count; people++; }
    }
    return { total, people };
  }

  async function openRosterManager() {
    if (!canManageRoster()) return;
    document.querySelectorAll('.clean-roster-manager').forEach(m => m.remove());

    // Distinct sections across every location (for the scope/duty chips).
    let sections = [];
    try {
      const { data } = await NX.sb.from('cleaning_tasks')
        .select('section_es, section_en').eq('archived', false);
      const seen = new Map();
      (data || []).forEach(r => {
        if (r.section_es && !seen.has(r.section_es)) seen.set(r.section_es, r.section_en || r.section_es);
      });
      sections = [...seen.entries()].map(([es, en]) => ({ es, en }));
    } catch (e) { console.warn('[cleaning] roster sections:', e); }

    await loadProfiles();
    await loadTemplates();
    await loadCallouts();

    const DOW = [
      { d: 1, label: 'Sun' }, { d: 2, label: 'Mon' }, { d: 3, label: 'Tue' },
      { d: 4, label: 'Wed' }, { d: 5, label: 'Thu' }, { d: 6, label: 'Fri' },
      { d: 7, label: 'Sat' },
    ];
    const dayChips = (sel) => DOW.map(x => `<button type="button" class="clean-roster-day ${sel.includes(x.d) ? 'on' : ''}" data-day="${x.d}">${x.label}</button>`).join('');
    const shiftChips = (sel) => ['am', 'pm', 'both'].map(s => `<button type="button" class="clean-roster-shift ${sel === s ? 'on' : ''}" data-shift="${s}">${s.toUpperCase()}</button>`).join('');
    const secChips = (sel) => sections.length
      ? sections.map(sc => `<button type="button" class="clean-roster-sec ${sel.includes(sc.es) ? 'on' : ''}" data-sec="${esc(sc.es)}">${esc(sc.en)}</button>`).join('')
      : '<span class="clean-roster-empty">No sections yet.</span>';
    const dayInitial = ['', 'S', 'M', 'T', 'W', 'T', 'F', 'S'];  // DOW 1=Sun … 7=Sat
    const daysAbbr = (arr) => (arr && arr.length) ? arr.slice().sort((a, b) => a - b).map(d => dayInitial[d]).join(' ') : 'any day';
    const metaText = (days, secs) => `${daysAbbr(days)} · ${secs.length ? secs.length + ' sec' : 'all'}`;

    const isRemoved = (u) => (profilesByUserId[u.id] && profilesByUserId[u.id].active === false);
    const activeUsers  = usersList.filter(u => !isRemoved(u));
    const removedUsers = usersList.filter(u => isRemoved(u));

    // "On today" crew — people explicitly scheduled for today's day-of-week.
    // Turns the roster from pure config into an at-a-glance view of who cleans
    // today (name + shift), so the sheet answers "who's on?" not just "who can".
    const _todayDow = todayDayOfWeek();
    const crewToday = activeUsers.filter(u => {
      const p = profilesByUserId[u.id];
      return p && Array.isArray(p.working_days) && p.working_days.length && p.working_days.includes(_todayDow);
    });
    const crewHTML = crewToday.length
      ? crewToday.map(u => {
          const sh = ((profilesByUserId[u.id] || {}).default_shift || 'both').toUpperCase();
          return `<span class="clean-roster-crew-chip"><span class="clean-roster-crew-dot"></span>${esc(u.name)}<span class="clean-roster-crew-shift">${esc(sh)}</span></span>`;
        }).join('')
      : '<span class="clean-roster-crew-empty">No one scheduled today — anyone can clean.</span>';

    // Next 14 days (2 weeks ahead). Each day resolves its crew from the
    // recurring profiles; call-outs are applied per date when rendering.
    const _startDay = new Date(); _startDay.setHours(0, 0, 0, 0);
    const fortnight = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(_startDay.getTime() + i * 86400000);
      return { iso: localISO(d), dow: d.getDay() + 1, dom: d.getDate(), wd: DOW[d.getDay()].label, isToday: i === 0 };
    });

    const personRowHTML = (u) => {
      const p = profilesByUserId[u.id] || {};
      const days = Array.isArray(p.working_days) ? p.working_days : [];
      const allowed = Array.isArray(p.allowed_sections) ? p.allowed_sections : [];
      const shift = p.default_shift || 'both';
      return `
        <div class="clean-roster-row" data-user-id="${esc(u.id)}">
          <button class="clean-roster-row-head" data-roster-toggle>
            <span class="clean-roster-row-name">${esc(u.name)}</span>
            <span class="clean-roster-row-meta">${metaText(days, allowed)}</span>
            <span class="clean-roster-row-chev">${svg('chevron', 16)}</span>
          </button>
          <div class="clean-roster-row-body" hidden>
            ${profileTemplates.length ? `
              <div class="clean-roster-field-label">Use a profile</div>
              <select class="clean-roster-apply-tpl" data-apply-tpl>
                <option value="">— pick a profile —</option>
                ${profileTemplates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
              </select>` : ''}
            <div class="clean-roster-field-label">Working days</div>
            <div class="clean-roster-days">${dayChips(days)}</div>
            <div class="clean-roster-field-label">Default shift</div>
            <div class="clean-roster-shifts">${shiftChips(shift)}</div>
            <div class="clean-roster-field-label">Allowed sections <span class="clean-roster-field-note">— none = all</span></div>
            <div class="clean-roster-secs">${secChips(allowed)}</div>
            <div class="clean-roster-row-actions">
              <button type="button" class="clean-roster-save" data-roster-save>Save ${esc(u.name)}</button>
              <button type="button" class="clean-roster-del" data-roster-remove>Remove</button>
            </div>
          </div>
        </div>`;
    };

    const templateRowHTML = (t) => {
      const days = Array.isArray(t.working_days) ? t.working_days : [];
      const allowed = Array.isArray(t.allowed_sections) ? t.allowed_sections : [];
      const shift = t.default_shift || 'both';
      const isNew = (t.id == null);
      return `
        <div class="clean-roster-row clean-roster-trow ${isNew ? 'is-open' : ''}" data-template-id="${esc(isNew ? '' : t.id)}">
          <button class="clean-roster-row-head" data-roster-toggle>
            <span class="clean-roster-row-name">${esc(t.name || 'New profile')}</span>
            <span class="clean-roster-row-meta">${metaText(days, allowed)}</span>
            <span class="clean-roster-row-chev">${svg('chevron', 16)}</span>
          </button>
          <div class="clean-roster-row-body" ${isNew ? '' : 'hidden'}>
            <div class="clean-roster-field-label">Profile name</div>
            <input type="text" class="clean-roster-tname" value="${esc(t.name || '')}" placeholder="e.g. PM Kitchen">
            <div class="clean-roster-field-label">Working days</div>
            <div class="clean-roster-days">${dayChips(days)}</div>
            <div class="clean-roster-field-label">Default shift</div>
            <div class="clean-roster-shifts">${shiftChips(shift)}</div>
            <div class="clean-roster-field-label">Duties <span class="clean-roster-field-note">— sections</span></div>
            <div class="clean-roster-secs">${secChips(allowed)}</div>
            <div class="clean-roster-row-actions">
              <button type="button" class="clean-roster-save" data-template-save>Save profile</button>
              ${isNew ? '' : '<button type="button" class="clean-roster-del" data-template-del>Delete</button>'}
            </div>
          </div>
        </div>`;
    };

    const sheet = document.createElement('div');
    sheet.className = 'clean-roster-manager';
    sheet.innerHTML = `
      <div class="clean-roster-bg"></div>
      <div class="clean-roster-card">
        <div class="clean-roster-head">
          <div class="clean-roster-title">Roster &amp; profiles</div>
          <button class="clean-roster-close" aria-label="Close">${svg('close', 14)}</button>
        </div>
        <div class="clean-roster-sub">Build reusable profiles (days + shift + duties), attach them to people to autofill tasks at <b>${esc(locLabel(activeLoc))}</b>, and remove anyone who doesn't clean.</div>

        <div class="clean-roster-today">
          <div class="clean-roster-today-label">On today · ${esc(DOW.find(x => x.d === _todayDow)?.label || '')}</div>
          <div class="clean-roster-today-crew">${crewHTML}</div>
        </div>

        <div class="clean-roster-section-label">Profiles</div>
        <div class="clean-roster-templates" data-templates>
          ${profileTemplates.length ? profileTemplates.map(templateRowHTML).join('') : '<div class="clean-roster-empty">No profiles yet — create one below.</div>'}
        </div>
        <button type="button" class="clean-roster-add-template" data-add-template>${svg('plus', 13)} New profile</button>

        <div class="clean-roster-section-label">People</div>
        <div class="clean-roster-list" data-people>
          ${activeUsers.length ? activeUsers.map(personRowHTML).join('') : '<div class="clean-roster-empty">No people on the roster.</div>'}
        </div>

        <div class="clean-roster-section-label">2-week schedule
          <button type="button" class="clean-sched-fillweek" data-fill-week>${svg('plus', 12)} Auto-fill week</button>
        </div>
        <div class="clean-roster-sub">The next 14 days, crewed from each profile. Tap <b>Fill</b> to assign a day's duties; tap a name's <b>✕</b> to call them out for that date — their duties open up for the rest of the crew.</div>
        <div class="clean-sched-grid clean-sched-2wk">
          ${fortnight.map(day => {
            const off = calloutsByDate[day.iso] || null;
            const crew = activeUsers.filter(u => { const p = profilesByUserId[u.id]; return p && Array.isArray(p.working_days) && p.working_days.includes(day.dow); });
            return `<div class="clean-sched-day ${day.isToday ? 'is-today' : ''}">
              <div class="clean-sched-day-head">${esc(day.wd)} ${day.dom}${day.isToday ? '<span class="clean-sched-today-dot" title="Today"></span>' : ''}</div>
              <div class="clean-sched-day-crew">${crew.length
                ? crew.map(u => {
                    const isOff = off && off.has(String(u.id));
                    const sh = ((profilesByUserId[u.id] || {}).default_shift || 'both').toUpperCase();
                    return `<span class="clean-sched-name ${isOff ? 'is-off' : ''}"><span class="clean-sched-nm">${esc((u.name || '').split(' ')[0])}</span><i>${esc(sh)}</i><button type="button" class="clean-sched-callout" data-callout-user="${esc(u.id)}" data-callout-date="${esc(day.iso)}" title="${isOff ? 'Restore' : 'Call out — off this day'}">${isOff ? '↩' : '✕'}</button></span>`;
                  }).join('')
                : '<span class="clean-sched-off">off</span>'}</div>
              <button type="button" class="clean-sched-fill" data-fill-day="${day.dow}" ${crew.length ? '' : 'disabled'}>Fill</button>
            </div>`;
          }).join('')}
        </div>

        ${removedUsers.length ? `
          <button type="button" class="clean-roster-removed-toggle" data-removed-toggle>Removed · ${removedUsers.length}</button>
          <div class="clean-roster-removed" hidden>
            ${removedUsers.map(u => `<div class="clean-roster-removed-row"><span>${esc(u.name)}</span><button type="button" class="clean-roster-readd" data-readd="${esc(u.id)}">Re-add</button></div>`).join('')}
          </div>` : ''}
      </div>
    `;
    document.body.appendChild(sheet);

    const close = () => sheet.remove();
    const reopen = () => { close(); openRosterManager(); };
    sheet.querySelector('.clean-roster-bg').addEventListener('click', close);
    sheet.querySelector('.clean-roster-close').addEventListener('click', close);

    // ─── Weekly schedule — per-day + whole-week duty auto-fill ──────────────
    sheet.querySelectorAll('[data-fill-day]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dow = parseInt(btn.dataset.fillDay, 10);
        const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Filling…';
        try {
          const r = await autofillScheduleForDay(dow);
          await loadAssignments(); render();
          btn.textContent = r.total ? `✓ ${r.total} duties` : 'None';
          toast(r.total ? `Auto-filled ${r.total} duties for ${r.people} ${r.people === 1 ? 'person' : 'people'}` : 'No scheduled crew or duties for that day', r.total ? 'success' : 'info');
        } catch (e) { console.warn('[cleaning] fill day:', e); btn.textContent = 'Failed'; toast('Fill failed: ' + (e.message || e), 'error'); }
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1800);
      });
    });
    const fillWeekBtn = sheet.querySelector('[data-fill-week]');
    if (fillWeekBtn) fillWeekBtn.addEventListener('click', async () => {
      const orig = fillWeekBtn.innerHTML; fillWeekBtn.disabled = true; fillWeekBtn.textContent = 'Filling…';
      try {
        const r = await autofillScheduleWeek();
        await loadAssignments(); render();
        fillWeekBtn.textContent = r.total ? `✓ ${r.total}` : 'Done';
        toast(r.total ? `Auto-filled ${r.total} duties across the week (${r.people} ${r.people === 1 ? 'person' : 'people'})` : 'No profiles with days + duties to fill from', r.total ? 'success' : 'info');
      } catch (e) { console.warn('[cleaning] fill week:', e); fillWeekBtn.textContent = 'Failed'; toast('Fill failed: ' + (e.message || e), 'error'); }
      setTimeout(() => { fillWeekBtn.innerHTML = orig; fillWeekBtn.disabled = false; }, 1800);
    });

    // Call-out toggle — mark a person off (or restore) for a specific date.
    // Needs the cleaning_callouts table (migration); fails gracefully with a hint.
    sheet.querySelectorAll('[data-callout-user]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const uid = btn.dataset.calloutUser, date = btn.dataset.calloutDate;
        const isOff = (calloutsByDate[date] || new Set()).has(String(uid));
        btn.disabled = true;
        try {
          if (isOff) {
            const { error } = await NX.sb.from('cleaning_callouts').delete().eq('user_id', uid).eq('off_date', date);
            if (error) throw error;
          } else {
            const { error } = await NX.sb.from('cleaning_callouts').insert({ user_id: uid, off_date: date });
            if (error) throw error;
          }
          await loadCallouts(); await loadAssignments(); render();
          reopen();  // rebuild the sheet with the updated schedule
        } catch (err) {
          console.warn('[cleaning] callout:', err);
          btn.disabled = false;
          toast('Call-out needs the cleaning_callouts table — run the migration. (' + (err.message || err) + ')', 'error', 5000);
        }
      });
    });

    const wireChips = (scopeEl) => {
      scopeEl.querySelectorAll('[data-day]').forEach(b => { if (!b._w) { b._w = 1; b.addEventListener('click', () => b.classList.toggle('on')); } });
      scopeEl.querySelectorAll('[data-sec]').forEach(b => { if (!b._w) { b._w = 1; b.addEventListener('click', () => b.classList.toggle('on')); } });
      scopeEl.querySelectorAll('.clean-roster-shifts').forEach(group => {
        group.querySelectorAll('[data-shift]').forEach(b => { if (!b._w) { b._w = 1; b.addEventListener('click', () => { group.querySelectorAll('[data-shift]').forEach(x => x.classList.remove('on')); b.classList.add('on'); }); } });
      });
    };
    const wireToggle = (rowEl) => {
      const head = rowEl.querySelector('[data-roster-toggle]');
      if (head && !head._w) {
        head._w = 1;
        head.addEventListener('click', () => {
          const body = rowEl.querySelector('.clean-roster-row-body');
          if (body) body.hidden = !body.hidden;
          rowEl.classList.toggle('is-open', body && !body.hidden);
        });
      }
    };
    const readChips = (rowEl) => {
      const shiftOn = rowEl.querySelector('.clean-roster-shift.on');
      return {
        days: [...rowEl.querySelectorAll('.clean-roster-day.on')].map(d => parseInt(d.dataset.day, 10)).sort((a, b) => a - b),
        shift: shiftOn ? shiftOn.dataset.shift : 'both',
        secs: [...rowEl.querySelectorAll('.clean-roster-sec.on')].map(s => s.dataset.sec),
      };
    };
    const setChips = (rowEl, days, shift, secs) => {
      rowEl.querySelectorAll('.clean-roster-day').forEach(b => b.classList.toggle('on', days.includes(parseInt(b.dataset.day, 10))));
      rowEl.querySelectorAll('.clean-roster-shift').forEach(b => b.classList.toggle('on', b.dataset.shift === shift));
      rowEl.querySelectorAll('.clean-roster-sec').forEach(b => b.classList.toggle('on', secs.includes(b.dataset.sec)));
    };

    const wirePerson = (rowEl) => {
      wireToggle(rowEl); wireChips(rowEl);
      const u = usersList.find(x => String(x.id) === String(rowEl.dataset.userId));
      const applySel = rowEl.querySelector('[data-apply-tpl]');
      if (applySel && !applySel._w) {
        applySel._w = 1;
        applySel.addEventListener('change', () => {
          const t = profileTemplates.find(x => String(x.id) === applySel.value);
          if (t) setChips(rowEl, t.working_days || [], t.default_shift || 'both', t.allowed_sections || []);
        });
      }
      const saveBtn = rowEl.querySelector('[data-roster-save]');
      if (saveBtn && !saveBtn._w) {
        saveBtn._w = 1;
        saveBtn.addEventListener('click', async () => {
          const userId = parseInt(rowEl.dataset.userId, 10) || rowEl.dataset.userId;
          const { days, shift, secs } = readChips(rowEl);
          const orig = saveBtn.textContent;
          saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
          try {
            const { error } = await NX.sb.from('cleaning_profiles').upsert({
              user_id: userId, working_days: days, default_shift: shift, allowed_sections: secs,
              active: true, updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });
            if (error) throw error;
            profilesByUserId[userId] = { user_id: userId, working_days: days, default_shift: shift, allowed_sections: secs, active: true };
            const af = await autofillAssignmentsForUser(userId, days, shift, secs);
            await loadAssignments();
            const meta = rowEl.querySelector('.clean-roster-row-meta');
            if (meta) meta.textContent = metaText(days, secs);
            saveBtn.textContent = (af && af.count) ? `Saved · ${af.count} tasks` : 'Saved ✓';
            setTimeout(() => { saveBtn.textContent = orig; saveBtn.disabled = false; }, 1600);
            render();
          } catch (e) {
            console.warn('[cleaning] roster save:', e);
            saveBtn.textContent = 'Failed — retry'; saveBtn.disabled = false;
            toast('Save failed: ' + (e.message || e), 'error');
          }
        });
      }
      const remBtn = rowEl.querySelector('[data-roster-remove]');
      if (remBtn && !remBtn._w) {
        remBtn._w = 1;
        remBtn.addEventListener('click', async () => {
          const userId = parseInt(rowEl.dataset.userId, 10) || rowEl.dataset.userId;
          if (!(await NX.confirm(`Remove ${u ? u.name : 'this person'} from the roster? You can re-add them later.`, { danger: true, okLabel: 'Remove' }))) return;
          const prev = profilesByUserId[userId] || {};
          try {
            const { error } = await NX.sb.from('cleaning_profiles').upsert({
              user_id: userId,
              working_days: prev.working_days || [], default_shift: prev.default_shift || 'both',
              allowed_sections: prev.allowed_sections || [], active: false,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });
            if (error) throw error;
            profilesByUserId[userId] = Object.assign({}, prev, { user_id: userId, active: false });
            reopen();
          } catch (e) { console.warn('[cleaning] roster remove:', e); toast('Remove failed: ' + (e.message || e), 'error'); }
        });
      }
    };

    const wireTemplate = (rowEl) => {
      wireToggle(rowEl); wireChips(rowEl);
      const saveBtn = rowEl.querySelector('[data-template-save]');
      if (saveBtn && !saveBtn._w) {
        saveBtn._w = 1;
        saveBtn.addEventListener('click', async () => {
          const id = rowEl.dataset.templateId || '';
          const nameEl = rowEl.querySelector('.clean-roster-tname');
          const name = (nameEl && nameEl.value || '').trim();
          if (!name) { toast('Give the profile a name', 'error'); return; }
          const { days, shift, secs } = readChips(rowEl);
          const orig = saveBtn.textContent;
          saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
          const payload = { name, working_days: days, default_shift: shift, allowed_sections: secs, updated_at: new Date().toISOString() };
          try {
            let error;
            if (id) ({ error } = await NX.sb.from('cleaning_profile_templates').update(payload).eq('id', id));
            else ({ error } = await NX.sb.from('cleaning_profile_templates').insert(payload));
            if (error) throw error;
            reopen();
          } catch (e) {
            console.warn('[cleaning] template save:', e);
            saveBtn.textContent = 'Failed — retry'; saveBtn.disabled = false;
            toast('Save failed: ' + (e.message || e), 'error');
          }
        });
      }
      const delBtn = rowEl.querySelector('[data-template-del]');
      if (delBtn && !delBtn._w) {
        delBtn._w = 1;
        delBtn.addEventListener('click', async () => {
          const id = rowEl.dataset.templateId;
          if (!id || !(await NX.confirm('Delete this profile? People already set up keep their settings.', { danger: true, okLabel: 'Delete' }))) return;
          try {
            const { error } = await NX.sb.from('cleaning_profile_templates').delete().eq('id', id);
            if (error) throw error;
            reopen();
          } catch (e) { console.warn('[cleaning] template del:', e); toast('Delete failed: ' + (e.message || e), 'error'); }
        });
      }
    };

    sheet.querySelectorAll('[data-people] .clean-roster-row').forEach(wirePerson);
    sheet.querySelectorAll('[data-templates] .clean-roster-trow').forEach(wireTemplate);

    const addBtn = sheet.querySelector('[data-add-template]');
    if (addBtn) addBtn.addEventListener('click', () => {
      const container = sheet.querySelector('[data-templates]');
      const empty = container.querySelector('.clean-roster-empty');
      if (empty) empty.remove();
      const tmp = document.createElement('div');
      tmp.innerHTML = templateRowHTML({ id: null, name: '', working_days: [], default_shift: 'both', allowed_sections: [] }).trim();
      const rowEl = tmp.firstChild;
      container.appendChild(rowEl);
      wireTemplate(rowEl);
      rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const remToggle = sheet.querySelector('[data-removed-toggle]');
    if (remToggle) remToggle.addEventListener('click', () => {
      const box = sheet.querySelector('.clean-roster-removed');
      if (box) box.hidden = !box.hidden;
    });
    sheet.querySelectorAll('[data-readd]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = parseInt(btn.dataset.readd, 10) || btn.dataset.readd;
        const prev = profilesByUserId[userId] || {};
        try {
          const { error } = await NX.sb.from('cleaning_profiles').upsert({
            user_id: userId,
            working_days: prev.working_days || [], default_shift: prev.default_shift || 'both',
            allowed_sections: prev.allowed_sections || [], active: true,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
          if (error) throw error;
          profilesByUserId[userId] = Object.assign({}, prev, { user_id: userId, active: true });
          reopen();
        } catch (e) { console.warn('[cleaning] re-add:', e); toast('Re-add failed: ' + (e.message || e), 'error'); }
      });
    });
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

    // Cleaning Lite is the default simple screen. "Advanced" flips the flag.
    if (cleaningSimpleMode) { renderLite(list); return; }

    list.innerHTML = '';

    // V16: restaurant-card landing — tap a card to open one restaurant.
    if (showingLocationCards) {
      applyCardsMode();
      renderLocationCards(list);
      return;
    }
    applyCardsMode();

    // Back-to-restaurants row sits at the top whenever inside a location.
    list.appendChild(renderLocBackRow());

    const groups = tasksBySection(activeLoc);
    if (!groups.length) {
      // Empty state — appended (not innerHTML) so the back row survives.
      const empty = document.createElement('div');
      empty.className = 'clean-empty';
      empty.innerHTML = `
          <div class="clean-empty-title">No tasks yet</div>
          <div class="clean-empty-hint">Tap the button below to start building this location's checklist.</div>
          <button class="clean-add-section-btn clean-empty-add-btn" type="button">${svg('plus', 14)} <span>Add section</span></button>`;
      list.appendChild(empty);
      const btn = empty.querySelector('.clean-add-section-btn');
      if (btn) btn.addEventListener('click', addNewSection);
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
    // "Today" / "All" segmented control + Person filter pill (v15).
    // Person filter: defaults to current logged-in user (from PIN auth).
    // Tap to switch between My / Anyone-Else / Everyone view. Lets a
    // staff member focus on their own tasks but swap to peek at someone
    // else's view or see the full picture.
    const me = getCurrentUserId();
    const meName = me ? (usersList.find(u => u.id === me)?.name || 'Me') : 'Me';
    const viewingUser = viewingUserId ? usersList.find(u => u.id === viewingUserId) : null;
    let pillLabel;
    if (viewingUserId === null) pillLabel = 'Everyone';
    else if (viewingUserId === me) pillLabel = `${meName} (me)`;
    else pillLabel = (viewingUser ? viewingUser.name : 'Filtered');

    const viewToggle = document.createElement('div');
    viewToggle.className = 'clean-view-toggle-row';
    viewToggle.innerHTML = `
      <div class="clean-view-toggle">
        <button class="clean-view-toggle-btn ${viewMode === 'now' ? 'is-active' : ''}" data-view="now">Now${viewMode === 'now' ? ` · ${nowShiftLabel()}` : ''}</button>
        <button class="clean-view-toggle-btn ${viewMode === 'today' ? 'is-active' : ''}" data-view="today">Today</button>
        <button class="clean-view-toggle-btn ${viewMode === 'all'   ? 'is-active' : ''}" data-view="all">All</button>
      </div>
      <button class="clean-person-pill ${viewingUserId !== null ? 'is-active' : ''}" data-person-pill title="Whose view to show">
        ${svg('user', 12)} <span>${esc(pillLabel)}</span>
      </button>
      <button class="clean-person-pill clean-edu-pill ${educationModeOn ? 'is-active' : ''}" data-edu-pill title="Toggle training mode — show the training button on every task" role="switch" aria-checked="${educationModeOn}">
        ${svg('graduation', 12)} <span>Learn</span><span class="clean-pill-toggle" aria-hidden="true"></span>
      </button>
      <button class="clean-person-pill clean-focus-pill ${focusModeOn ? 'is-active' : ''}" data-focus-pill title="Full screen — hide the masthead" aria-pressed="${focusModeOn}">
        ${svg(focusModeOn ? 'minimize' : 'maximize', 12)} <span>${focusModeOn ? 'Exit' : 'Focus'}</span>
      </button>
      <button class="clean-person-pill clean-roster-pill" data-roster-pill title="Shift roster & 2-week schedule">
        ${svg('calendar', 12)} <span>Roster</span>
      </button>
      <button class="clean-person-pill" data-simple-pill title="Back to the simple view">
        ${svg('minimize', 12)} <span>Simple</span>
      </button>
    `;
    const simplePill = viewToggle.querySelector('[data-simple-pill]');
    if (simplePill) simplePill.addEventListener('click', () => {
      cleaningSimpleMode = true; localStorage.setItem('nexus_cleaning_lite', '1'); render();
    });
    viewToggle.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.view));
    });
    viewToggle.querySelector('[data-person-pill]').addEventListener('click', () => {
      openPersonFilterPicker();
    });
    viewToggle.querySelector('[data-edu-pill]').addEventListener('click', () => {
      educationModeOn = !educationModeOn;
      try { localStorage.setItem('clean_education_mode', educationModeOn ? '1' : '0'); } catch (e) {}
      render();
    });
    const focusPill = viewToggle.querySelector('[data-focus-pill]');
    if (focusPill) focusPill.addEventListener('click', toggleFocusMode);
    const rosterPill = viewToggle.querySelector('[data-roster-pill]');
    if (rosterPill) rosterPill.addEventListener('click', () => openRosterManager());
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

    // Render every section card — filter by viewMode, then by person
    let visibleGroups = (viewMode === 'today' || viewMode === 'now')
      ? groups.filter(g => g.tasks.some(t => DAILY_TYPES.has(t.frequency_type)))
      : groups;

    // V15: filter to person's view if one is selected. null = Everyone.
    visibleGroups = filterGroupsByUser(visibleGroups, viewingUserId);

    // V16 "Now" lens: float sections that still have current-shift work to do.
    if (viewMode === 'now') {
      visibleGroups = visibleGroups.slice().sort((a, b) => {
        const hot = g => g.tasks.some(t => taskIsNowRelevant(t) && !getDoneState(t.section_es, t.task_order)) ? 1 : 0;
        return hot(b) - hot(a);
      });
    }

    if (!visibleGroups.length && groups.length) {
      // Could be empty due to viewMode='today' OR due to person filter.
      const hint = document.createElement('div');
      hint.className = 'clean-empty-soft';
      const isPersonFiltered = viewingUserId !== null;
      hint.innerHTML = `
        <div class="clean-empty-soft-text">
          ${isPersonFiltered
            ? `No tasks assigned to this person${(viewMode === 'today' || viewMode === 'now') ? ' today' : ''}. Tap the person pill to switch view.`
            : `No daily sections at this location. Tap <b>All</b> above to see scheduled tasks.`}
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

      // Task rows — in "Now" mode, order by current-shift relevance so the
      // next thing to do sits at the top of each section.
      const orderedTasks = (viewMode === 'now')
        ? group.tasks.slice().sort((a, b) => nowTaskRank(a) - nowTaskRank(b))
        : group.tasks;
      orderedTasks.forEach(task => {
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
    const mine = taskIsMine(task);
    const dimmed = (viewMode === 'now') && !taskIsNowRelevant(task) && !done;
    row.className = 'clean-task' + (done ? ' is-done' : '') + (mine ? ' is-mine' : '') + (dimmed ? ' is-dimmed' : '');
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

    // Assignee chip(s) — v15: read from cleaning_task_assignments based
    // on today's day-of-week + the task's shift_pattern. Falls back to
    // the legacy assignee_id (if set) so old data still renders.
    let assigneeHTML = '';
    const todayPair = todayAssigneesFor(task);
    const shiftPattern = task.shift_pattern || 'am';
    function chipFor(user, shift) {
      if (!user) return '';
      const initials = user.name.split(/\s+/).map(p => p[0]).join('').slice(0,2).toUpperCase();
      const me = getCurrentUserId();
      const isMe = (me && me === user.id);
      const shiftLabel = shiftPattern === 'both' ? `<span class="clean-assignee-shift">${shift.toUpperCase()}</span>` : '';
      return `<span class="clean-assignee ${isMe ? 'is-me' : ''}" title="${esc(user.name)} (${shift})">${shiftLabel}<span>${esc(initials)}</span></span>`;
    }
    if (shiftPattern === 'am') {
      assigneeHTML = chipFor(todayPair.am, 'am');
    } else if (shiftPattern === 'pm') {
      assigneeHTML = chipFor(todayPair.pm, 'pm');
    } else {
      // both: render two chips side by side
      assigneeHTML = chipFor(todayPair.am, 'am') + chipFor(todayPair.pm, 'pm');
    }
    // Legacy fallback — if no v15 assignment but old assignee_id exists
    if (!assigneeHTML && task.assignee_id) {
      const u = usersList.find(x => x.id === task.assignee_id);
      const name = u ? u.name : null;
      const initials = name ? name.split(/\s+/).map(p => p[0]).join('').slice(0,2).toUpperCase() : '?';
      assigneeHTML = `<span class="clean-assignee" title="${esc(name || 'Unknown')}"><span>${esc(initials)}</span></span>`;
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

    // Cost chip removed in v15 — cost-logging feature retired entirely.
    const costHTML = '';

    // Training pill removed in v15 — replaced by Education guides
    // (Phase 2). Each task will get a 📖 button that opens linked
    // education_guides in a takeover sheet.
    const trainingPillHTML = '';
    const trainingPanelHTML = '';

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
        <button class="clean-task-action-btn" aria-label="${activeNote ? 'Edit note' : 'Add note'}" data-add-note title="${activeNote ? 'Edit note' : 'Note'}">
          ${svg('alert', 14, 2)}
        </button>
        ${(() => {
          const guides = guidesLinkedByTaskId[task.id] || [];
          const hasGuides = guides.length;
          const effShow = showTrainingFor(task);
          // Everyday: show only if this task is opted in (or has guides and
          // isn't opted out). In Learn mode: always show + offer the toggle.
          if (!educationModeOn && !effShow) return '';
          const optedOut = taskTrainingPref[task.id] === false;
          const toggle = educationModeOn
            ? `<button class="clean-task-action-btn clean-train-toggle ${effShow ? 'is-on' : 'is-off'}" data-train-toggle aria-label="${effShow ? 'Hide training on this task' : 'Show training on this task'}" title="${effShow ? 'Training shown — tap to hide' : 'Training hidden — tap to show'}">${svg(effShow ? 'check' : 'close', 11, 2.4)}</button>`
            : '';
          return `
          <button class="clean-task-action-btn clean-guide-btn ${hasGuides ? '' : 'is-empty'} ${optedOut ? 'is-optedout' : ''}" aria-label="${hasGuides ? 'Open training' : 'Link training'}" data-open-guide title="${hasGuides ? 'Training' : 'Link training'}">
            ${svg('graduation', 14, 2)}
            ${guides.length > 1 ? `<span class="clean-guide-btn-count">${guides.length}</span>` : ''}
          </button>${toggle}`;
        })()}
        <button class="clean-task-action-btn" aria-label="Edit task" data-edit-task title="Edit">
          ${svg('pen', 14, 2)}
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
    const guideBtn = row.querySelector('[data-open-guide]');
    if (guideBtn) {
      guideBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // education.js may not be loaded yet (user hasn't visited
        // Training). Load it now so NX.educationAPI is available.
        await ensureEducationLoaded();
        const guides = guidesLinkedByTaskId[task.id] || [];
        if (!guides.length) {
          // No links yet — let the user attach one
          openGuideLinkPicker(task);
          return;
        }
        if (guides.length === 1) {
          if (NX.educationAPI && NX.educationAPI.openGuideViewer) {
            NX.educationAPI.openGuideViewer(guides[0].id, { returnToView: 'clean' });
          } else {
            toast('Could not open lesson — try again', 'error');
          }
        } else {
          openTaskGuidePicker(task, guides);
        }
      });
    }
    // Per-task training opt in/out (only present in Learn mode).
    const trainToggle = row.querySelector('[data-train-toggle]');
    if (trainToggle) {
      trainToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setTaskTrainingPref(task.id, !showTrainingFor(task));
        render();
      });
    }
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
        <label class="clean-edit-label">Shift pattern <span class="clean-edit-label-hint">— who does this and when</span></label>
        <div class="clean-shift-picker" data-shift-picker>
          ${['am','pm','both'].map(s => {
            const sel = (task.shift_pattern || 'am') === s;
            const label = s === 'am' ? 'AM only' : s === 'pm' ? 'PM only' : 'Both shifts';
            return `<button type="button" class="clean-shift-btn ${sel ? 'is-selected' : ''}" data-shift="${s}">${label}</button>`;
          }).join('')}
        </div>
      </div>

      ${task.frequency_type === 'monthly' ? `
        <div class="clean-edit-row">
          <label class="clean-edit-label">Monthly rotation <span class="clean-edit-label-hint">— different person per month</span></label>
          <div class="clean-month-picker" data-month-picker>
            ${(() => {
              const ym = currentYearMonth();
              const nextYm = (() => {
                const d = new Date();
                d.setMonth(d.getMonth() + 1);
                return d.getFullYear() * 100 + (d.getMonth() + 1);
              })();
              const labelOf = (yymm) => {
                const yy = Math.floor(yymm / 100), mm = yymm % 100;
                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                return `${months[mm-1]} ${yy}`;
              };
              const findUser = (yymm) => {
                const r = (assignmentsByTaskId[task.id] || []).find(x =>
                  x.scope === 'monthly' && x.year_month === yymm);
                return r ? r.user_id : '';
              };
              const opts = ['<option value="">— Unassigned —</option>']
                .concat(usersList.map(u => `<option value="${u.id}">${esc(u.name)}</option>`));
              return `
                <div class="clean-month-row">
                  <span class="clean-month-label">${labelOf(ym)} (this)</span>
                  <select class="clean-edit-select" data-month-ym="${ym}">
                    ${opts.map(o => o.replace(`value="${findUser(ym)}"`, `value="${findUser(ym)}" selected`)).join('')}
                  </select>
                </div>
                <div class="clean-month-row">
                  <span class="clean-month-label">${labelOf(nextYm)} (next)</span>
                  <select class="clean-edit-select" data-month-ym="${nextYm}">
                    ${opts.map(o => o.replace(`value="${findUser(nextYm)}"`, `value="${findUser(nextYm)}" selected`)).join('')}
                  </select>
                </div>
              `;
            })()}
          </div>
        </div>
      ` : `
        <div class="clean-edit-row" data-week-row>
          <label class="clean-edit-label">Weekly assignments <span class="clean-edit-label-hint">— who does it each day</span></label>
          <div class="clean-week-grid" data-week-grid>
            ${(() => {
              // Determine which days to show. If days_of_week is set,
              // show only those; otherwise show all 7.
              const daysOfWeek = (Array.isArray(task.days_of_week) && task.days_of_week.length)
                ? task.days_of_week
                : [1,2,3,4,5,6,7];
              const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
              const shifts = (task.shift_pattern || 'am') === 'both' ? ['am','pm'] : [(task.shift_pattern || 'am')];
              const findAsg = (dow, sh) => {
                const r = (assignmentsByTaskId[task.id] || []).find(x =>
                  x.scope === 'weekly' && x.day_of_week === dow && x.shift === sh);
                return r ? r.user_id : '';
              };
              const opts = ['<option value="">—</option>']
                .concat(usersList.map(u => `<option value="${u.id}">${esc(u.name)}</option>`));
              return daysOfWeek.map(dow => `
                <div class="clean-week-row">
                  <span class="clean-week-day-label">${dayLabels[dow - 1]}</span>
                  ${shifts.map(sh => `
                    <div class="clean-week-shift-cell">
                      ${shifts.length > 1 ? `<span class="clean-week-shift-label">${sh.toUpperCase()}</span>` : ''}
                      <select class="clean-edit-select" data-week-dow="${dow}" data-week-shift="${sh}">
                        ${opts.map(o => {
                          const cur = findAsg(dow, sh);
                          if (!cur) return o;
                          return o.replace(`value="${cur}"`, `value="${cur}" selected`);
                        }).join('')}
                      </select>
                    </div>
                  `).join('')}
                </div>
              `).join('');
            })()}
          </div>
        </div>
      `}

      <div class="clean-edit-row">
        <label class="clean-edit-label">Notes <span class="clean-edit-label-hint">(optional)</span></label>
        <textarea class="clean-edit-textarea" data-field="notes" rows="2"
                  placeholder="e.g. Use the green-handled brush from under the bar.">${esc(task.notes || '')}</textarea>
      </div>

      ${isNew ? '' : `
        <div class="clean-edit-row">
          <label class="clean-edit-label">Linked guides <span class="clean-edit-label-hint">— shown as a 📖 button on this task</span></label>
          <div class="clean-edit-guide-links" data-guide-links>
            ${(guidesLinkedByTaskId[task.id] || []).map(g => `
              <span class="clean-edit-guide-link" data-linked-guide="${esc(g.id)}">
                ${svg('scroll', 11)} <span>${esc(g.title_en)}</span>
                <button class="clean-edit-guide-link-x" data-unlink-guide="${esc(g.id)}" aria-label="Unlink">×</button>
              </span>
            `).join('')}
            <button class="clean-edit-guide-link-add" type="button" data-link-guide-add>${svg('plus', 12)} <span>Link guide</span></button>
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
    // Frequency change → re-render the form so the right assignment
    // section (weekly grid vs monthly picker) shows up.
    const freqSel = wrap.querySelector('[data-field="frequency_type"]');
    freqSel.addEventListener('change', () => {
      const t = freqSel.value;
      // Toggle the simple controls
      wrap.querySelector('[data-days-row]').style.display =
        (t === 'weekly' || t === 'custom') ? '' : 'none';
      wrap.querySelector('[data-custom-days]').style.display =
        (t === 'custom') ? '' : 'none';
      // For frequency-type changes that flip between monthly and weekly
      // the editor needs to be re-rendered (different assignment UI).
      const wasMonthly = (task.frequency_type === 'monthly');
      const isMonthly = (t === 'monthly');
      if (wasMonthly !== isMonthly) {
        // Update the in-memory task so re-render reflects pending change
        task.frequency_type = t;
        wrap.replaceWith(renderTaskEditForm(task));
      }
    });

    // Day pills toggle
    wrap.querySelectorAll('.clean-day-pill').forEach(pill => {
      pill.addEventListener('click', () => pill.classList.toggle('is-selected'));
    });

    // Shift pattern picker (am / pm / both) — purely UI; saved value
    // is read at save-time. Selecting 'both' should re-render the
    // weekly grid so it shows two columns.
    wrap.querySelectorAll('[data-shift-picker] [data-shift]').forEach(btn => {
      btn.addEventListener('click', () => {
        const newShift = btn.dataset.shift;
        wrap.querySelectorAll('[data-shift-picker] [data-shift]').forEach(b =>
          b.classList.toggle('is-selected', b === btn));
        if (task.shift_pattern !== newShift) {
          task.shift_pattern = newShift;
          // Re-render to update grid columns (am/pm/both changes layout)
          wrap.replaceWith(renderTaskEditForm(task));
        }
      });
    });

    // Linked-guides controls (only present when not isNew)
    const linkGuideAddBtn = wrap.querySelector('[data-link-guide-add]');
    if (linkGuideAddBtn) {
      linkGuideAddBtn.addEventListener('click', () => {
        openGuideLinkPicker(task);
      });
    }
    wrap.querySelectorAll('[data-unlink-guide]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const guideId = btn.dataset.unlinkGuide;
        try {
          if (NX.educationAPI && NX.educationAPI.unlinkGuideFromTask) {
            await NX.educationAPI.unlinkGuideFromTask(task.id, guideId);
          }
          await loadGuideLinks();
          // Soft re-render of just the link list
          const list = guidesLinkedByTaskId[task.id] || [];
          const container = wrap.querySelector('[data-guide-links]');
          if (container) {
            container.querySelector(`[data-linked-guide="${guideId}"]`)?.remove();
          }
        } catch (e) { toast('Unlink failed', 'error'); }
      });
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
      const notes = get('notes').trim() || null;

      // Shift pattern — captured from selected button in the picker
      const shiftBtn = wrap.querySelector('[data-shift-picker] .is-selected');
      const shift_pattern = shiftBtn ? shiftBtn.dataset.shift : 'am';

      // Collect new assignment rows from the form. We'll write them in
      // a separate step after the task is saved so we have a task_id.
      const newAssignments = [];
      if (frequency_type === 'monthly') {
        wrap.querySelectorAll('[data-month-ym]').forEach(sel => {
          const ym = parseInt(sel.dataset.monthYm, 10);
          const userId = sel.value ? (parseInt(sel.value, 10) || null) : null;
          if (userId && ym) {
            newAssignments.push({ scope: 'monthly', year_month: ym, user_id: userId });
          }
        });
      } else {
        wrap.querySelectorAll('[data-week-dow]').forEach(sel => {
          const dow = parseInt(sel.dataset.weekDow, 10);
          const sh = sel.dataset.weekShift;
          const userId = sel.value ? (parseInt(sel.value, 10) || null) : null;
          if (userId && dow && sh) {
            newAssignments.push({ scope: 'weekly', day_of_week: dow, shift: sh, user_id: userId });
          }
        });
      }

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
        assignee_id:    null,  // v15: replaced by cleaning_task_assignments
        shift_pattern,
        notes,
      };

      const saveBtn = wrap.querySelector('.clean-edit-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const savedId = await saveTask(isNew ? null : task.id, payload);
        const targetId = isNew ? savedId : task.id;
        // Persist assignments — wipe the relevant scope first, then insert.
        if (targetId) {
          await replaceAssignmentsForTask(targetId, frequency_type, newAssignments);
        }
        editingTaskId = null;
        addingToSection = null;
        await loadAllTasks();
        await loadAssignments();
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
      return existingId;
    } else {
      // For new tasks, push to end of section
      const existing = (tasksByLoc[payload.location] || [])
        .filter(t => t.section_es === payload.section_es);
      payload.task_order = existing.length;
      const { data, error } = await NX.sb.from('cleaning_tasks')
        .insert(payload).select('id').single();
      if (error) throw error;
      return data ? data.id : null;
    }
  }

  // V15: wipe + re-insert assignments for a task in the relevant scope.
  // We only touch the scope being edited so monthly assignments survive
  // weekly grid edits and vice-versa.
  async function replaceAssignmentsForTask(taskId, frequencyType, newRows) {
    if (!NX.sb || !taskId) return;
    const isMonthly = (frequencyType === 'monthly');
    const scope = isMonthly ? 'monthly' : 'weekly';
    // Delete existing rows for this scope only
    const delQ = NX.sb.from('cleaning_task_assignments')
      .delete().eq('task_id', taskId).eq('scope', scope);
    const { error: delErr } = await delQ;
    if (delErr) {
      console.warn('[cleaning] replace assignments delete:', delErr);
      // Continue — we still want to insert the new rows.
    }
    if (!newRows.length) return;
    const inserts = newRows.map(r => ({
      task_id: taskId,
      user_id: r.user_id,
      scope: r.scope,
      day_of_week: r.day_of_week || null,
      shift: r.shift || null,
      year_month: r.year_month || null,
    }));
    const { error: insErr } = await NX.sb.from('cleaning_task_assignments').insert(inserts);
    if (insErr) {
      console.error('[cleaning] replace assignments insert:', insErr);
      throw insErr;
    }
  }

  // V15: link-guide picker — opens a slide-up sheet listing all education
  // guides; tap a guide to toggle its link to this task. Used from the
  // "+ Link guide" button inside the task editor.
  // ─── Education module loader ──────────────────────────────────────────
  // education.js is lazy-loaded by app.js when the user navigates to
  // Training. But cleaning's 🎓 button needs NX.educationAPI even
  // before that — to open lesson viewers and the link-picker. Without
  // this, tapping the button silently does nothing if the user hasn't
  // visited Training yet. ensureEducationLoaded() loads the script
  // on demand, returns a promise that resolves once NX.educationAPI
  // is available.
  let _eduLoadPromise = null;
  function ensureEducationLoaded() {
    if (window.NX && NX.educationAPI) return Promise.resolve();
    if (_eduLoadPromise) return _eduLoadPromise;
    _eduLoadPromise = new Promise((resolve) => {
      const existing = document.querySelector('script[src="js/education.js"]');
      if (existing) {
        // Script is loading — wait for NX.educationAPI to appear
        const t0 = Date.now();
        const tick = () => {
          if (window.NX && NX.educationAPI) return resolve();
          if (Date.now() - t0 > 5000) return resolve();   // bail
          setTimeout(tick, 50);
        };
        tick();
        return;
      }
      const s = document.createElement('script');
      s.src = 'js/education.js';
      s.onload = () => {
        // Give it a tick to register NX.educationAPI
        setTimeout(resolve, 30);
      };
      s.onerror = () => {
        console.error('[cleaning] education.js failed to load');
        _eduLoadPromise = null;     // allow retry
        resolve();                  // don't hang the UI
      };
      document.body.appendChild(s);
    });
    return _eduLoadPromise;
  }

  async function openGuideLinkPicker(task) {
    document.querySelectorAll('.clean-guide-link-picker').forEach(m => m.remove());

    // Pull in education.js if it's not already loaded — without this,
    // NX.educationAPI is undefined and the picker shows zero lessons.
    await ensureEducationLoaded();

    let allGuides = [];
    if (NX.educationAPI && NX.educationAPI.listAllGuides) {
      try { allGuides = await NX.educationAPI.listAllGuides(); }
      catch (e) { console.warn(e); }
    }
    let allCats = [];
    if (NX.educationAPI && NX.educationAPI.listAllCategories) {
      try { allCats = await NX.educationAPI.listAllCategories(); }
      catch (e) { console.warn(e); }
    }
    const catName = (id) => {
      const c = allCats.find(x => x.id === id);
      return c ? c.name_en : 'Uncategorized';
    };
    const linkedIds = new Set((guidesLinkedByTaskId[task.id] || []).map(g => g.id));

    const sheet = document.createElement('div');
    sheet.className = 'clean-guide-link-picker';
    sheet.innerHTML = `
      <div class="clean-guide-link-picker-bg"></div>
      <div class="clean-guide-link-picker-card">
        <div class="clean-guide-link-picker-head">
          <div class="clean-guide-link-picker-title">Link a guide</div>
          <button class="clean-guide-link-picker-close" aria-label="Close">${svg('close', 14)}</button>
        </div>
        <input class="clean-guide-link-picker-search" type="text" placeholder="Search guides…">
        <div class="clean-guide-link-picker-list">
          ${allGuides.length ? allGuides.map(g => {
            const linked = linkedIds.has(g.id);
            const search = (g.title_en + ' ' + (g.description || '') + ' ' + catName(g.category_id)).toLowerCase();
            return `
              <button class="clean-guide-link-picker-item ${linked ? 'is-linked' : ''}"
                      data-guide-id="${esc(g.id)}" data-search="${esc(search)}">
                <div class="clean-guide-link-picker-name">${esc(g.title_en)}</div>
                <div class="clean-guide-link-picker-meta">${esc(catName(g.category_id))} · ${esc(g.primary_kind)}</div>
                <span class="clean-guide-link-picker-status ${linked ? '' : 'is-add'}">${linked ? 'Linked' : '+ Link'}</span>
              </button>
            `;
          }).join('') : `
            <div class="clean-guide-link-picker-empty">
              No guides yet. Tap Education in the top nav to create some.
            </div>
          `}
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    const close = () => sheet.remove();
    sheet.querySelector('.clean-guide-link-picker-bg').addEventListener('click', close);
    sheet.querySelector('.clean-guide-link-picker-close').addEventListener('click', close);

    const searchInput = sheet.querySelector('.clean-guide-link-picker-search');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      sheet.querySelectorAll('.clean-guide-link-picker-item').forEach(item => {
        const text = item.dataset.search || '';
        item.style.display = (!q || text.includes(q)) ? '' : 'none';
      });
    });

    sheet.querySelectorAll('[data-guide-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const guideId = btn.dataset.guideId;
        const isLinked = btn.classList.contains('is-linked');
        btn.disabled = true;
        try {
          if (isLinked) {
            await NX.educationAPI.unlinkGuideFromTask(task.id, guideId);
            btn.classList.remove('is-linked');
            const status = btn.querySelector('.clean-guide-link-picker-status');
            if (status) { status.textContent = '+ Link'; status.classList.add('is-add'); }
          } else {
            await NX.educationAPI.linkGuideToTask(task.id, guideId);
            btn.classList.add('is-linked');
            const status = btn.querySelector('.clean-guide-link-picker-status');
            if (status) { status.textContent = 'Linked'; status.classList.remove('is-add'); }
          }
          await loadGuideLinks();
        } finally {
          btn.disabled = false;
        }
      });
    });
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
  async function addNewSection() {
    if (!NX.composer?.modal) {
      // Fallback to native prompts if composer isn't loaded
      const sec_es = await NX.prompt('Section name (Spanish):', { title: 'New section' });
      if (!sec_es) return;
      const sec_en = await NX.prompt('Section name (English):', { title: 'New section' }) || sec_es;
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
  // Open an editable email-compose review sheet (matches the ordering
  // module's review-then-send flow). Pre-fills To/CC/BCC/Subject/Body
  // from defaults; user can edit any field before tapping Send. On send
  // the daily report is persisted, then mailto: is opened. Designed to
  // mirror Ordering's review screen — same labels, same flow, same look.
  async function submitWithEmail() {
    const locName = activeLoc.charAt(0).toUpperCase() + activeLoc.slice(1);
    let body, subject;
    try {
      body    = buildEmailBody(locName);
      subject = buildEmailSubject();
    } catch (e) {
      toast('Could not build report: ' + (e.message || ''), 'error');
      return;
    }

    // Resolve sensible defaults for the recipient list.
    // - Default To: current user's email (if known)
    // - Default CC/BCC: empty (user adds whoever they want)
    // - User can persist their own preferred recipients via localStorage
    //   so they don't have to retype every shift.
    const userEmail = (NX.currentUser && NX.currentUser.email) || '';
    let savedTo, savedCc, savedBcc;
    try {
      savedTo  = localStorage.getItem('nexus_clean_email_to')  || userEmail;
      savedCc  = localStorage.getItem('nexus_clean_email_cc')  || '';
      savedBcc = localStorage.getItem('nexus_clean_email_bcc') || '';
    } catch (_) {
      savedTo = userEmail; savedCc = ''; savedBcc = '';
    }

    openCleanComposeSheet({
      to:      savedTo,
      cc:      savedCc,
      bcc:     savedBcc,
      subject,
      body,
    });
  }

  // ═══ EMAIL COMPOSE REVIEW SHEET (v12.5) ═══════════════════════════════
  // Modeled after ordering's review screen. Full-screen takeover sheet
  // with editable To / CC / BCC chips, editable Subject, editable Body
  // (multiline), then a Send pill at the bottom that fires mailto:.
  function openCleanComposeSheet(initial) {
    const sheet = document.createElement('div');
    sheet.className = 'clean-compose-sheet';
    sheet.innerHTML = `
      <div class="clean-compose-bg"></div>
      <div class="clean-compose-card">
        <div class="clean-compose-head">
          <button class="clean-compose-back" aria-label="Back">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div class="clean-compose-titles">
            <div class="clean-compose-title">Review &amp; send</div>
            <div class="clean-compose-sub">Edit any field, then tap Send</div>
          </div>
        </div>

        <div class="clean-compose-body">
          <label class="clean-compose-label">To</label>
          <input type="email" class="clean-compose-input" id="cleanComposeTo"
                 value="${esc(initial.to || '')}" placeholder="recipient@example.com" inputmode="email" autocomplete="off">

          <label class="clean-compose-label">CC <span class="clean-compose-hint">(comma-separated)</span></label>
          <input type="text" class="clean-compose-input" id="cleanComposeCc"
                 value="${esc(initial.cc || '')}" placeholder="optional" inputmode="email" autocomplete="off">

          <label class="clean-compose-label">BCC <span class="clean-compose-hint">(silent — others won't see)</span></label>
          <input type="text" class="clean-compose-input" id="cleanComposeBcc"
                 value="${esc(initial.bcc || '')}" placeholder="optional" inputmode="email" autocomplete="off">

          <label class="clean-compose-label">Subject</label>
          <input type="text" class="clean-compose-input" id="cleanComposeSubject"
                 value="${esc(initial.subject || '')}" autocomplete="off">

          <label class="clean-compose-label">Message</label>
          <textarea class="clean-compose-textarea" id="cleanComposeBody"
                    rows="12">${esc(initial.body || '')}</textarea>

          <label class="clean-compose-checkbox">
            <input type="checkbox" id="cleanComposeRemember" checked>
            <span>Remember these recipients next time</span>
          </label>
        </div>

        <div class="clean-compose-foot">
          <button class="clean-compose-cancel" type="button">Cancel</button>
          <button class="clean-compose-send" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            <span>Send</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    const close = () => sheet.remove();
    sheet.querySelector('.clean-compose-bg').addEventListener('click', close);
    sheet.querySelector('.clean-compose-back').addEventListener('click', close);
    sheet.querySelector('.clean-compose-cancel').addEventListener('click', close);

    sheet.querySelector('.clean-compose-send').addEventListener('click', async () => {
      const to       = sheet.querySelector('#cleanComposeTo').value.trim();
      const ccStr    = sheet.querySelector('#cleanComposeCc').value.trim();
      const bccStr   = sheet.querySelector('#cleanComposeBcc').value.trim();
      const subject  = sheet.querySelector('#cleanComposeSubject').value;
      const body     = sheet.querySelector('#cleanComposeBody').value;
      const remember = sheet.querySelector('#cleanComposeRemember').checked;

      if (!to) {
        toast('Add a To address', 'warn');
        return;
      }

      // Persist recipient prefs if requested
      if (remember) {
        try {
          localStorage.setItem('nexus_clean_email_to',  to);
          localStorage.setItem('nexus_clean_email_cc',  ccStr);
          localStorage.setItem('nexus_clean_email_bcc', bccStr);
        } catch (_) {}
      }

      // Long-body warning
      const E = (window.NX && NX.email) || null;
      const warnLen = E ? E.BODY_WARN_LEN : 1900;
      if (body.length > warnLen) {
        const ok = await NX.confirm(`This email is long (${body.length} chars). Some mail apps may truncate. Send anyway?`);
        if (!ok) return;
      }

      // Persist daily log BEFORE handing off to the mail app — iOS may
      // pause JS the moment the mail app takes focus.
      const sendBtn = sheet.querySelector('.clean-compose-send');
      sendBtn.disabled = true;
      sendBtn.querySelector('span').textContent = 'Saving…';
      try {
        await persistDailyLog(body);
      } catch (e) {
        toast('Save failed (continuing to email): ' + (e.message || ''), 'warn', 4000);
      }

      // Build mailto: with cc/bcc lists. Same encoding rules as ordering's
      // buildMailtoUrl (mailto wants %20, not +).
      const ccList  = ccStr.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const bccList = bccStr.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const url = E
        ? E.buildMailtoUrl(to, subject, body, ccList, bccList)
        : buildLocalMailto(to, subject, body, ccList, bccList);

      sendBtn.querySelector('span').textContent = 'Opening mail…';
      close();
      // 100ms breather so the close animation paints before iOS context-switches
      setTimeout(() => { window.location.href = url; }, 100);
    });
  }

  // Tiny mailto: fallback if NX.email isn't loaded for any reason.
  function buildLocalMailto(to, subject, body, ccList, bccList) {
    const enc = s => encodeURIComponent(s).replace(/\+/g, '%20');
    const params = [`subject=${enc(subject)}`, `body=${enc(body)}`];
    if (ccList && ccList.length)  params.push(`cc=${ccList.map(e => encodeURIComponent(e)).join(',')}`);
    if (bccList && bccList.length) params.push(`bcc=${bccList.map(e => encodeURIComponent(e)).join(',')}`);
    return `mailto:${encodeURIComponent(to)}?${params.join('&')}`;
  }

  // ─── BUTTON HANDLER: Cleaning Actions (Finish Shift) ──────────────────
  // v18.6 — consolidates submit + print + scan into one action sheet
  // launched from the footer's gold CTA button. Mirrors ordering's
  // design language (gold-gradient primary CTA + secondary actions).
  //
  // Sheet contents (top → bottom):
  //   1. Submit & email     (primary — completes the day, sends report)
  //   2. Save without email (secondary — partial save mid-shift)
  //   3. Print checklist    (utility — opens print-friendly view)
  //   4. Scan QR            (utility — weekly photo scanner)
  //   5. Cancel
  //
  // Everything that used to live as separate footer buttons now lives
  // here. The legacy onSubmitClick is preserved as an alias for any
  // call sites that still hold a reference.
  function openCleaningActions() {
    const sheet = document.createElement('div');
    sheet.className = 'clean-actions-sheet';
    sheet.innerHTML = `
      <div class="clean-actions-sheet-bg"></div>
      <div class="clean-actions-sheet-card">
        <div class="clean-actions-sheet-handle"></div>
        <div class="clean-actions-sheet-eyebrow">END OF SHIFT</div>
        <div class="clean-actions-sheet-title">What's next?</div>

        <button class="clean-actions-cta-primary" data-action="email">
          ${svg('mail', 16)} <span>Submit &amp; email report</span>
        </button>

        <div class="clean-actions-divider"></div>

        <button class="clean-actions-row" data-action="log">
          <span class="clean-actions-row-icon">${svg('check', 16)}</span>
          <span class="clean-actions-row-label">Save without email</span>
          <span class="clean-actions-row-hint">Partial save</span>
        </button>
        <button class="clean-actions-row" data-action="print">
          <span class="clean-actions-row-icon">${svg('pen', 16)}</span>
          <span class="clean-actions-row-label">Print checklist</span>
          <span class="clean-actions-row-hint">Paper backup</span>
        </button>
        <button class="clean-actions-row" data-action="scan">
          <span class="clean-actions-row-icon">${svg('camera', 16)}</span>
          <span class="clean-actions-row-label">Scan QR</span>
          <span class="clean-actions-row-hint">Weekly</span>
        </button>

        <button class="clean-actions-cancel" data-action="cancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(sheet);
    // animate-in by reading layout then adding the class
    requestAnimationFrame(() => sheet.classList.add('is-open'));

    const close = () => {
      sheet.classList.remove('is-open');
      // wait for transition to complete before removing
      setTimeout(() => sheet.remove(), 220);
    };
    sheet.querySelector('.clean-actions-sheet-bg').addEventListener('click', close);
    sheet.querySelector('[data-action="cancel"]').addEventListener('click', close);
    sheet.querySelector('[data-action="email"]').addEventListener('click', () => {
      close(); submitWithEmail();
    });
    sheet.querySelector('[data-action="log"]').addEventListener('click', () => {
      close(); submitLogOnly();
    });
    sheet.querySelector('[data-action="print"]').addEventListener('click', () => {
      close();
      if (typeof NX.cleaningPrint === 'function') NX.cleaningPrint();
      else toast('Print unavailable', 'warn');
    });
    sheet.querySelector('[data-action="scan"]').addEventListener('click', () => {
      close();
      if (typeof NX.cleaningScan === 'function') NX.cleaningScan();
      else toast('Scanner unavailable', 'warn');
    });
  }

  // Legacy alias — onSubmitClick used to be wired to the cleanSubmit
  // button. The button is gone in v18.6 but other call sites (or
  // future ones) may reference this name.
  function onSubmitClick() { openCleaningActions(); }

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

    // Wire the takeover-close button: returns to Home. The body class
    // `view-clean` is maintained by app.js's setupNav and is what CSS
    // hooks into for the takeover treatment, so it clears automatically
    // when we navigate away.
    const closeBtn = document.getElementById('cleanTakeoverClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (window.NX && typeof NX.switchTo === 'function') {
          NX.switchTo('home');
        } else {
          const homeBtn = document.querySelector('[data-view="home"]');
          if (homeBtn) homeBtn.click();
        }
      });
    }

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

    // Wire the consolidated Cleaning Actions button (v18.6 — replaces
    // the old scan + print + submit footer trio). Falls back to wiring
    // the legacy cleanSubmit if for some reason the new button isn't
    // in the DOM (e.g. caching mid-deploy).
    const actionsBtn = document.getElementById('cleanActions');
    if (actionsBtn) actionsBtn.addEventListener('click', openCleaningActions);
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
    await loadAssignments();
    await loadGuideLinks();

    // Person filter defaults to "Everyone" — user can opt-in to person view
    // by tapping the pill at the top. Auto-defaulting to current user was
    // surprising in empty-assignment-table scenarios (showed "no tasks").

    // Register with NX.archive
    registerArchiveContributor();

    render();

    // Run auto-escalation pass after first render. Wrapped in a delay
    // so the user sees their checklist before any "sent to board" toast.
    setTimeout(() => { runAutoEscalations().catch(() => {}); }, 1500);
  }

  async function show() {
    // V16: land on the restaurant cards immediately — apply the cards-mode
    // class synchronously (before any awaits) so the per-location chrome
    // (progress bar / footer) never flashes while data loads.
    showingLocationCards = true;
    applyCardsMode();
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

    // Refresh state for current location.
    // BUGFIX 2026-05-09: also reload the task catalog itself. Previously
    // tasksByLoc was only populated in init() (once per session), so any
    // change to cleaning_tasks made AFTER the app booted (e.g. running a
    // new seed migration in Supabase) wouldn't show up until a hard
    // refresh. Now every entry into the cleaning view pulls the latest.
    await loadAllTasks();
    await loadTodayState();
    await loadHistory();
    await loadAttachments();
    await loadCosts();
    await loadLinkedCards();
    await loadTrainingData();
    await loadTaskNotes();
    await loadAssignments();
    await loadGuideLinks();
    await loadProfiles();
    await loadLocationMeta();
    await loadAllLocProgress();
    // Re-apply persisted full-screen focus on every entry to the view.
    applyFocusMode();
    // V16: open on the restaurant-card landing each time.
    showingLocationCards = true;
    applyCardsMode();
    // Person filter defaults to Everyone — see init() comment above.
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

  // ═══════════════════════════════════════════════════════════════════════
  //  CLEANING LITE — simple daily driver (mirrors the Ordering UI language)
  //  ----------------------------------------------------------------------
  //  Default screen (flag `nexus_cleaning_lite`, ON unless '0'). Zones = the
  //  sections that already exist at the active location. Pick a person per
  //  zone; their zone IS their task list. Reuses every existing helper
  //  (profiles, autofill, persistDone, exportCleaningExcel, education guides).
  //  Zone→person for display lives in localStorage `nexus_cleaning_config`
  //  so it works for schedule-only staff too; real users also get their
  //  cleaning_profiles + assignments written so the rest of NEXUS stays in
  //  sync. "Advanced" flips to the full classic UI. Reversible: delete this
  //  block + the render() dispatch + the .cleanlite-* CSS.
  // ═══════════════════════════════════════════════════════════════════════
  // The classic UI is retired — Lite is the only cleaning screen now.
  let cleaningSimpleMode = true;
  // Crew scope being edited/shown: 'all' (every day) or a day-of-week 1..7
  // (1=Sun, Postgres convention). Defaults to today so it opens on today's crew.
  let liteDay = todayDayOfWeek();
  // Overview = all locations' cleaning at a glance (the "All" pill).
  let liteOverview = false;
  async function liteSwitchLoc(loc) {
    if (loc === '__all__') { liteOverview = true; await loadAllLocProgress(); render(); return; }
    liteOverview = false; activeLoc = loc;
    await loadTodayState(); await loadHistory(); await loadAssignments(); await loadProfiles();
    render();
  }

  function liteConfig() { try { return JSON.parse(localStorage.getItem('nexus_cleaning_config') || '{}'); } catch (_) { return {}; } }
  function saveLiteConfig(c) { try { localStorage.setItem('nexus_cleaning_config', JSON.stringify(c)); } catch (_) {} }
  const LITE_DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Merged people: real nexus_users (can log in) + schedule-only staff (config).
  function litePeople() {
    const cfg = liteConfig();
    const staff = Array.isArray(cfg.staff) ? cfg.staff : [];
    return [
      ...usersList.map(u => ({ id: u.id, name: u.name, login: true })),
      ...staff.map(s => ({ id: s.id, name: s.name, login: false })),
    ];
  }
  function litePersonName(id) {
    if (id == null) return null;
    const p = litePeople().find(x => String(x.id) === String(id));
    return p ? p.name : null;
  }
  function liteInitials(name) {
    return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  }
  function liteHue(id) { let h = 0; String(id || '').split('').forEach(c => h = (h * 31 + c.charCodeAt(0)) % 360); return h; }

  // Zones = distinct sections at the active location.
  function liteZones() {
    return tasksBySection(activeLoc).map(g => ({ es: g.section_es, en: g.section_en || g.section_es, tasks: g.tasks }));
  }
  // Per-day crew map from config: cfg.dayCrew[dow][section] = personId.
  function liteDayCrewMap() { const c = liteConfig(); return c.dayCrew || {}; }
  // Resolve who works a zone for a given scope ('all' | 1..7). For 'all',
  // returns the common person across all 7 days, '__varies__' if mixed, or the
  // profile-derived fallback. For a specific day, the config value (or fallback).
  function liteZonePerson(sectionEs, scope) {
    const s = (scope === undefined) ? liteDay : scope;
    const dc = liteDayCrewMap();
    if (s === 'all') {
      const ids = [];
      for (let d = 1; d <= 7; d++) ids.push((dc[d] || {})[sectionEs] == null ? null : (dc[d] || {})[sectionEs]);
      const set = new Set(ids.map(x => x == null ? '' : String(x)));
      if (set.size === 1 && !set.has('')) return ids[0];
      if (ids.some(x => x != null)) return '__varies__';
      return liteProfilePerson(sectionEs);
    }
    if (dc[s] && dc[s][sectionEs] != null) return dc[s][sectionEs];
    return liteProfilePerson(sectionEs);
  }
  function liteProfilePerson(sectionEs) {
    const p = Object.values(profilesByUserId).find(pp =>
      pp && pp.active !== false && Array.isArray(pp.allowed_sections) && pp.allowed_sections.includes(sectionEs));
    return p ? p.user_id : null;
  }

  // Assign a person to a zone for the current scope (liteDay). Writes config
  // (display + print, works for schedule-only staff) and, for real users, the
  // per-day cleaning_task_assignments so the rest of NEXUS stays in sync.
  async function liteAssignZone(sectionEs, personId, scope) {
    const s = (scope === undefined) ? liteDay : scope;
    const days = s === 'all' ? [1,2,3,4,5,6,7] : [s];
    const cfg = liteConfig();
    cfg.dayCrew = cfg.dayCrew || {};
    days.forEach(d => {
      cfg.dayCrew[d] = cfg.dayCrew[d] || {};
      if (personId == null) delete cfg.dayCrew[d][sectionEs]; else cfg.dayCrew[d][sectionEs] = personId;
    });
    saveLiteConfig(cfg);

    if (!NX.sb) return;
    const isRealUser = usersList.some(u => String(u.id) === String(personId));
    try {
      const taskIds = (tasksByLoc[activeLoc] || []).filter(t => t.section_es === sectionEs).map(t => t.id);
      if (!taskIds.length) return;
      // Clear whoever was on these tasks for these days (one person per zone/day).
      await NX.sb.from('cleaning_task_assignments').delete()
        .eq('scope', 'weekly').in('task_id', taskIds).in('day_of_week', days);
      if (personId != null && isRealUser) {
        await autofillAssignmentsForUser(personId, days, 'both', [sectionEs]);
      }
      await loadAssignments();
    } catch (e) { console.warn('[cleanlite] assign zone:', e); }
  }

  // ─── Person picker (sheet) + new-employee (+optional login) ──────────────
  function liteOpenPersonPicker(sectionEs) {
    document.querySelectorAll('.cleanlite-sheet-bg').forEach(m => m.remove());
    const people = litePeople();
    const current = liteZonePerson(sectionEs);
    const bg = document.createElement('div');
    bg.className = 'cleanlite-sheet-bg';
    bg.innerHTML = `
      <div class="cleanlite-sheet" role="dialog" aria-modal="true">
        <div class="cleanlite-sheet-grip"></div>
        <div class="cleanlite-sheet-title">Who works <b>${esc(liteZoneName(sectionEs))}</b> · <span class="cleanlite-sheet-day">${liteDay === 'all' ? 'every day' : esc(LITE_DOW[liteDay - 1])}</span></div>
        <div class="cleanlite-people">
          <button class="cleanlite-person ${(current == null || current === '__varies__') ? 'is-active' : ''}" data-pid="">
            <span class="cleanlite-av is-none">${svg('user', 16)}</span><span>Unassigned</span></button>
          ${people.map(p => `
            <button class="cleanlite-person ${String(p.id) === String(current) ? 'is-active' : ''}" data-pid="${esc(p.id)}">
              <span class="cleanlite-av" style="--av-hue:${liteHue(p.id)}">${esc(liteInitials(p.name))}</span>
              <span class="cleanlite-person-name">${esc(p.name)}</span>
              ${p.login ? '<span class="cleanlite-tag">login</span>' : '<span class="cleanlite-tag is-muted">schedule</span>'}
            </button>`).join('')}
          <button class="cleanlite-person cleanlite-newemp" data-new>
            <span class="cleanlite-av is-add">${svg('plus', 16)}</span><span>New employee…</span></button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add('open'));
    const close = () => { bg.classList.remove('open'); setTimeout(() => bg.remove(), 200); };
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    bg.querySelectorAll('[data-pid]').forEach(btn => btn.addEventListener('click', async () => {
      const pid = btn.dataset.pid === '' ? null : btn.dataset.pid;
      close();
      await liteAssignZone(sectionEs, pid);
      render();
      const when = liteDay === 'all' ? 'every day' : LITE_DOW[liteDay - 1];
      toast(pid == null ? 'Zone cleared' : `${litePersonName(pid)} → ${liteZoneName(sectionEs)} · ${when}`, 'success');
    }));
    bg.querySelector('[data-new]').addEventListener('click', () => { close(); liteNewEmployee(sectionEs); });
  }

  function liteZoneName(es) { const z = liteZones().find(z => z.es === es); return z ? z.en : es; }

  // New employee → ask name, then ask whether to create a NEXUS login.
  function liteNewEmployee(sectionEs) {
    if (!NX.composer?.modal) { toast('Composer unavailable', 'warn'); return; }
    NX.composer.modal({
      title: 'New employee', subtitle: 'Add someone to the cleaning crew',
      buttonLabel: 'Next', fields: [{ name: 'name', label: 'Name', placeholder: 'e.g. Maria', autofocus: true }],
      onSubmit: async ({ name }) => {
        const nm = (name || '').trim();
        if (!nm) return;
        const wantsLogin = await NX.confirm(
          `Create a NEXUS login for ${nm}?\n\nYes = they get a PIN and can sign in. No = name only, just on the cleaning schedule.`,
          { okLabel: 'Create login', cancelLabel: 'Schedule only' });
        if (wantsLogin) return liteCreateLogin(nm, sectionEs);
        return liteCreateScheduleStaff(nm, sectionEs);
      },
    });
  }

  // Login path — reuses the existing add_user RPC. The MANAGER types the PIN;
  // we never generate or store credentials.
  function liteCreateLogin(name, sectionEs) {
    NX.composer.modal({
      title: `Login for ${name}`, subtitle: 'You set the PIN — share it with them privately.',
      buttonLabel: 'Create login',
      fields: [
        { name: 'pin', label: 'PIN (4 digits)', placeholder: '4-digit PIN', autofocus: true },
        { name: 'role', label: 'Role (staff / manager / admin)', placeholder: 'staff', value: 'staff' },
      ],
      onSubmit: async ({ pin, role }) => {
        const p = (pin || '').trim();
        if (!/^\d{3,8}$/.test(p)) { toast('PIN must be 3–8 digits', 'error'); return; }
        if (!NX.sb) { toast('Not connected', 'error'); return; }
        const { error } = await NX.sb.rpc('add_user', {
          p_name: name, p_pin: p, p_role: (role || 'staff').trim() || 'staff',
          p_location: activeLoc, p_language: 'en',
        });
        if (error) {
          toast(/duplicate|unique|23505/i.test(error.code + error.message) ? 'That PIN is taken — pick another' : ('Error: ' + error.message), 'error');
          return;
        }
        await loadUsers();
        const created = usersList.find(u => u.name === name);
        if (created) { await liteAssignZone(sectionEs, created.id); }
        render();
        toast(`${name} added with a login`, 'success');
      },
    });
  }

  // Schedule-only staff — stored in config, no login, no PIN.
  async function liteCreateScheduleStaff(name, sectionEs) {
    const cfg = liteConfig();
    cfg.staff = Array.isArray(cfg.staff) ? cfg.staff : [];
    const id = 'staff:' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + ':' + (cfg.staff.length + 1);
    cfg.staff.push({ id, name });
    saveLiteConfig(cfg);
    await liteAssignZone(sectionEs, id);
    render();
    toast(`${name} added (schedule only)`, 'success');
  }

  // ─── Tap-to-complete ─────────────────────────────────────────────────────
  async function liteToggleTask(t, rowEl) {
    const now = !getDoneState(t.section_es, t.task_order);
    setDoneState(t.section_es, t.task_order, now);
    if (rowEl) rowEl.classList.toggle('is-done', now);
    liteUpdateZonePill(t.section_es);
    try { await persistDone(t.section_es, t.task_order, now); } catch (e) { console.warn('[cleanlite] persist:', e); }
  }
  function liteZoneCounts(sectionEs) {
    const z = liteZones().find(z => z.es === sectionEs);
    let done = 0, total = 0;
    (z ? z.tasks : []).forEach(t => { if (DAILY_TYPES.has(t.frequency_type)) { total++; if (getDoneState(t.section_es, t.task_order)) done++; } });
    return { done, total };
  }
  function liteUpdateZonePill(sectionEs) {
    const { done, total } = liteZoneCounts(sectionEs);
    const pill = document.querySelector(`.cleanlite-zone[data-zone="${cssEsc(sectionEs)}"] .cleanlite-zone-count`);
    if (pill) { pill.textContent = `${done}/${total}`; pill.classList.toggle('is-complete', total > 0 && done === total); }
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  // ─── Training guide (button-gated) ───────────────────────────────────────
  function liteOpenZoneGuide(sectionEs) {
    const z = liteZones().find(z => z.es === sectionEs);
    let guide = null;
    (z ? z.tasks : []).some(t => { const g = guidesLinkedByTaskId[t.id]; if (g && g.length) { guide = g[0]; return true; } return false; });
    if (guide && NX.educationAPI && NX.educationAPI.openGuideViewer) {
      NX.educationAPI.openGuideViewer(guide.id, { returnToView: 'clean' });
      return;
    }
    // Fallback: an editable per-zone note.
    const cfg = liteConfig(); cfg.zoneNotes = cfg.zoneNotes || {};
    if (NX.composer?.modal) {
      NX.composer.modal({
        title: `${liteZoneName(sectionEs)} — guide`, subtitle: 'No training guide linked yet — jot the basics here.',
        buttonLabel: 'Save', fields: [{ name: 'note', label: 'How to clean this zone', value: cfg.zoneNotes[sectionEs] || '', multiline: true, autofocus: true }],
        onSubmit: ({ note }) => { cfg.zoneNotes[sectionEs] = (note || '').trim(); saveLiteConfig(cfg); toast('Saved', 'success'); },
      });
    }
  }

  // ─── Per-zone actions menu (cover/swap · note · history · photo) ─────────
  function liteZoneNoteText(sectionEs) { const c = liteConfig(); return (c.notes && c.notes[sectionEs]) || ''; }
  function liteOpenZoneMenu(sectionEs, btn) {
    const hasNote = !!liteZoneNoteText(sectionEs);
    const html =
      `<button class="clean-menu-item" data-act="swap">${svg('user', 14)} Cover / swap person</button>` +
      `<button class="clean-menu-item" data-act="note">${svg('pen', 14)} ${hasNote ? 'Edit note' : 'Add note'}</button>` +
      `<button class="clean-menu-item" data-act="history">${svg('calendar', 14)} History</button>` +
      `<button class="clean-menu-item" data-act="photo">${svg('camera', 14)} Add photo</button>`;
    const ref = openMenuNear(btn, html);
    const menu = ref && ref.menu ? ref.menu : null;
    const close = (ref && ref.close) ? ref.close : () => { if (menu) menu.remove(); };
    if (!menu) return;
    menu.querySelector('[data-act="swap"]').addEventListener('click', () => { close(); liteOpenPersonPicker(sectionEs); });
    menu.querySelector('[data-act="note"]').addEventListener('click', () => { close(); liteZoneNote(sectionEs); });
    menu.querySelector('[data-act="history"]').addEventListener('click', () => { close(); liteZoneHistory(sectionEs); });
    menu.querySelector('[data-act="photo"]').addEventListener('click', () => { close(); liteZonePhoto(sectionEs); });
  }
  function liteZoneNote(sectionEs) {
    if (!NX.composer?.modal) { toast('Composer unavailable', 'warn'); return; }
    const cfg = liteConfig(); cfg.notes = cfg.notes || {};
    NX.composer.modal({
      title: `${liteZoneName(sectionEs)} — note`, subtitle: 'A quick note for this zone — shows on the card.',
      buttonLabel: 'Save', fields: [{ name: 'note', label: 'Note', value: cfg.notes[sectionEs] || '', multiline: true, autofocus: true }],
      onSubmit: ({ note }) => {
        const t = (note || '').trim();
        if (t) cfg.notes[sectionEs] = t; else delete cfg.notes[sectionEs];
        saveLiteConfig(cfg); render(); toast(t ? 'Note saved' : 'Note cleared', 'success');
      },
    });
  }
  // Recent completion history for a zone, from lastDoneByKey (section_taskOrder).
  function liteZoneHistory(sectionEs) {
    document.querySelectorAll('.cleanlite-sheet-bg').forEach(m => m.remove());
    const z = liteZones().find(z => z.es === sectionEs);
    const rows = (z ? z.tasks : []).map(t => {
      const last = lastDoneByKey[`${t.section_es}_${t.task_order}`];
      const done = getDoneState(t.section_es, t.task_order);
      const when = done ? 'today' : (last && last.date ? esc(last.date) : 'never');
      const by = (last && last.by) ? ` · ${esc(last.by)}` : '';
      return `<div class="cleanlite-hist-row"><span class="cleanlite-hist-task">${esc(t.name_en || t.name_es || '')}</span><span class="cleanlite-hist-when ${done ? 'is-today' : ''}">${when}${by}</span></div>`;
    }).join('');
    const bg = document.createElement('div');
    bg.className = 'cleanlite-sheet-bg';
    bg.innerHTML = `<div class="cleanlite-sheet" role="dialog" aria-modal="true">
      <div class="cleanlite-sheet-grip"></div>
      <div class="cleanlite-sheet-title">${esc(liteZoneName(sectionEs))} · last cleaned</div>
      <div class="cleanlite-hist">${rows || '<div class="cleanlite-empty">No tasks.</div>'}</div></div>`;
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add('open'));
    bg.addEventListener('click', e => { if (e.target === bg) { bg.classList.remove('open'); setTimeout(() => bg.remove(), 200); } });
  }
  function liteZonePhoto(sectionEs) {
    const z = liteZones().find(z => z.es === sectionEs);
    const first = z && z.tasks[0];
    if (!first) { toast('No task in this zone to attach a photo to', 'info'); return; }
    if (typeof uploadPhotoForTask === 'function') uploadPhotoForTask(first);
    else toast('Photo upload unavailable', 'warn');
  }

  // ─── Apply the whole per-day schedule to the assignment tables ───────────
  // Writes every cfg.dayCrew[day][zone] → cleaning_task_assignments for real
  // users, so the live duties / per-assignment Excel / server cron all match.
  async function liteApplySchedule() {
    const dc = liteDayCrewMap();
    let count = 0;
    for (let d = 1; d <= 7; d++) {
      const map = dc[d] || {};
      for (const section of Object.keys(map)) {
        const pid = map[section];
        if (!usersList.some(u => String(u.id) === String(pid))) continue; // real users only
        const r = await autofillAssignmentsForUser(pid, [d], 'both', [section]);
        if (r && r.count) count += r.count;
      }
    }
    await loadAssignments();
    render();
    toast(count ? `Schedule applied — ${count} task-slots` : 'Assign people to zones first', count ? 'success' : 'info');
  }
  // Copy the selected day's crew to every other day (quick "same all week").
  function liteCopyDayToAll() {
    if (liteDay === 'all') return;
    const cfg = liteConfig(); cfg.dayCrew = cfg.dayCrew || {};
    const src = cfg.dayCrew[liteDay] || {};
    for (let d = 1; d <= 7; d++) cfg.dayCrew[d] = Object.assign({}, src);
    saveLiteConfig(cfg);
    render();
    toast(`${LITE_DOW[liteDay - 1]}'s crew copied to every day`, 'success');
  }

  // ─── Print week (clean grid + QR) and .xlsx ──────────────────────────────
  // One location's schedule table (zone · task · Mon–Sun crew). Location-
  // specific tasks; crew comes from the global section-keyed config.
  function cleanPrintTableHtml(loc) {
    const zones = tasksBySection(loc).map(g => ({ es: g.section_es, en: g.section_en || g.section_es, tasks: g.tasks }));
    const nameFor = (section, d) => litePersonName(liteZonePerson(section, d)) || '';
    const dayHead = LITE_DOW.map(d => `<th>${d}</th>`).join('');
    const rows = zones.map(z => z.tasks.map(t => {
      const cells = [1,2,3,4,5,6,7].map(d => `<td>${esc(nameFor(z.es, d))}</td>`).join('');
      return `<tr><td class="zn">${esc(z.en)}</td><td>${esc(t.name_en || t.name_es || '')}</td>${cells}</tr>`;
    }).join('')).join('');
    return `<table><thead><tr><th>Zone</th><th>Task</th>${dayHead}</tr></thead><tbody>${rows || '<tr><td colspan="9">No tasks.</td></tr>'}</tbody></table>`;
  }
  // Shared print shell — no QR. Opens a window and prints.
  function cleanPrintShell(title, bodyHtml) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>
        *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:22px;font-size:11px}
        h1{font-size:19px;margin:0} h2{font-size:15px;margin:24px 0 8px} .sub{color:#666;margin:2px 0 14px}
        table{border-collapse:collapse;width:100%} th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
        th{background:#222;color:#fff;font-size:10px} tbody tr:nth-child(even){background:#f6f6f6} td.zn{font-weight:600}
        .loc-sec{page-break-inside:avoid} .loc-sec + .loc-sec{page-break-before:always}
        @media print{body{margin:.4in}}
      </style></head><body>
      ${bodyHtml}
      <p class="sub" style="margin-top:18px">Generated by NEXUS · ${esc(new Date().toLocaleString())}</p></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print', 'error'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 350);
  }
  // Print just the active location.
  function litePrintWeek() {
    cleanPrintShell(
      `Cleaning — ${locLabel(activeLoc)} — week of ${today}`,
      `<h1>Cleaning schedule — ${esc(locLabel(activeLoc))}</h1><div class="sub">Week of ${esc(today)}</div>${cleanPrintTableHtml(activeLoc)}`
    );
  }
  // Mass print — every location, one per page.
  function litePrintAll() {
    const secs = LOCATIONS.map(l => `<div class="loc-sec"><h2>${esc(locLabel(l))}</h2>${cleanPrintTableHtml(l)}</div>`).join('');
    cleanPrintShell(
      `Cleaning — all locations — week of ${today}`,
      `<h1>Cleaning schedule — all locations</h1><div class="sub">Week of ${esc(today)}</div>${secs}`
    );
  }

  // ─── Cleaning summary → email + Daily Log tie-in ─────────────────────────
  // Builds a human-readable recap of the day: per-zone completion, the
  // monthly/quarterly tasks knocked out today, and any zone notes ("odd
  // things" / extras). Feeds the email composer and the daily log.
  function liteBuildSummary(loc) {
    loc = loc || activeLoc;
    const cfg = liteConfig();
    const zones = tasksBySection(loc).map(g => ({ es: g.section_es, en: g.section_en || g.section_es, tasks: g.tasks }));
    let dDone = 0, dTotal = 0;
    const zoneLines = [], periodic = [], noteLines = [];
    zones.forEach(z => {
      let zd = 0, zt = 0;
      z.tasks.forEach(t => {
        const done = getDoneState(t.section_es, t.task_order);
        if (DAILY_TYPES.has(t.frequency_type)) { zt++; dTotal++; if (done) { zd++; dDone++; } }
        else if (done) periodic.push((t.name_en || t.name_es || '') + ' (' + freqLabelFor(t) + ')');
      });
      const person = litePersonName(liteZonePerson(z.es, todayDayOfWeek()));
      zoneLines.push(z.en + ' — ' + zd + '/' + zt + ' done' + (person ? ' · ' + person : ''));
      const note = (cfg.notes && cfg.notes[z.es]) ? cfg.notes[z.es] : '';
      if (note) noteLines.push(z.en + ': ' + note);
    });
    const pct = dTotal ? Math.round(dDone / dTotal * 100) : 0;
    let out = 'CLEANING SUMMARY — ' + locLabel(loc) + ' — ' + today + '\n'
      + 'Overall: ' + pct + '% (' + dDone + '/' + dTotal + ' daily tasks done)\n\nBy zone:\n'
      + zoneLines.map(l => '  ' + l).join('\n');
    if (periodic.length) out += '\n\nMonthly / quarterly completed today:\n' + periodic.map(l => '  • ' + l).join('\n');
    if (noteLines.length) out += '\n\nNotes / odd things:\n' + noteLines.map(l => '  • ' + l).join('\n');
    return { text: out, pct, dDone, dTotal };
  }
  function liteOpenSummary(loc) {
    const s = liteBuildSummary(loc);
    document.querySelectorAll('.cleanlite-sheet-bg').forEach(m => m.remove());
    const bg = document.createElement('div');
    bg.className = 'cleanlite-sheet-bg';
    bg.innerHTML = `<div class="cleanlite-sheet" role="dialog" aria-modal="true">
      <div class="cleanlite-sheet-grip"></div>
      <div class="cleanlite-sheet-title">Cleaning summary · ${esc(locLabel(loc || activeLoc))}</div>
      <pre class="cleanlite-summary">${esc(s.text)}</pre>
      <div class="cleanlite-summary-actions">
        <button class="cleanlite-cta" data-sum="email">${svg('mail', 15)} Email summary</button>
        <button class="cleanlite-cta is-ghost" data-sum="dlog">${svg('document', 15)} Send to Daily Log</button>
      </div></div>`;
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add('open'));
    const close = () => { bg.classList.remove('open'); setTimeout(() => bg.remove(), 200); };
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    bg.querySelector('[data-sum="email"]').addEventListener('click', () => {
      close();
      if (window.NX && typeof NX.composeEmail === 'function') {
        NX.composeEmail({ recipientsKey: 'clean:summary:' + (loc || activeLoc), title: 'Email cleaning summary',
          subject: 'Cleaning summary — ' + locLabel(loc || activeLoc) + ' — ' + today, body: s.text });
      } else { toast('Email composer unavailable', 'warn'); }
    });
    bg.querySelector('[data-sum="dlog"]').addEventListener('click', async () => { close(); await liteSummaryToDailyLog(loc || activeLoc, s.text); });
  }
  // Merge the summary into today's daily log (facility_logs.data.cleaning).
  // Read-merge-write so we don't clobber other daily-log fields.
  async function liteSummaryToDailyLog(loc, text) {
    if (!NX.sb) { toast('Not connected', 'error'); return; }
    try {
      const me = (NX.currentUser && NX.currentUser.id) || null;
      const dateStr = today;
      let row = null;
      try {
        const q = NX.sb.from('facility_logs').select('id, data').eq('log_date', dateStr).eq('log_type', 'daily');
        const { data } = me ? await q.eq('created_by', me).maybeSingle() : await q.limit(1).maybeSingle();
        row = data || null;
      } catch (_) {}
      const data = (row && row.data) || {};
      data.cleaning = data.cleaning || {};
      // Append into the cleaning summary field; keep prior text.
      const prev = (data.cleaning.summary || '').trim();
      data.cleaning.summary = (prev ? prev + '\n\n' : '') + text;
      const payload = { log_date: dateStr, log_type: 'daily', data: data, created_by: me, updated_at: new Date().toISOString() };
      if (row && row.id) await NX.sb.from('facility_logs').update({ data: data, updated_at: payload.updated_at }).eq('id', row.id);
      else await NX.sb.from('facility_logs').upsert(payload, { onConflict: 'log_date,log_type,created_by' });
      toast('Summary added to today’s Daily Log', 'success');
    } catch (e) { console.warn('[cleanlite] summary→dlog:', e); toast('Could not reach the Daily Log', 'error'); }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  /* ═══ PERIODIC / DEEP-CLEAN CARDS (v18.33) ════════════════════════════════
     Recurring cleaning (biweekly / monthly / quarterly / annual) gets its own
     card group below the daily zones: cadence + last-done → next-due +
     freshness bar, multi-person assignee toggle, mark-done (which restarts the
     cycle via the existing freshness engine — setDoneState bumps lastDoneByKey
     to today), and create / edit / delete of cards + tasks. Daily tasks stay
     in the zone cards. All on existing tables — no schema change. */
  function periodicFreqDays(t) { return parseInt(t.frequency_days, 10) || FREQ_BY_TYPE[t.frequency_type]?.days || 30; }
  function periodicLastDone(t) { const h = lastDoneByKey[t.section_es + '_' + t.task_order]; return h ? h.date : null; }
  function periodicNextDue(t) {
    const last = periodicLastDone(t);
    if (!last) return null;
    const d = new Date(last + 'T00:00:00');
    if (isNaN(d)) return null;
    d.setDate(d.getDate() + periodicFreqDays(t));
    return d.toISOString().slice(0, 10);
  }
  function periodicAssignees(t) {
    return (assignmentsByTaskId[t.id] || []).filter(r => r.scope === 'periodic').map(r => {
      const u = usersList.find(u => String(u.id) === String(r.user_id));
      return { id: r.user_id, name: u ? u.name : '' };
    }).filter(a => a.name);
  }
  function pShortDate(iso) { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); }

  function renderPeriodicGroup() {
    const cards = liteZones().map(z => {
      const tasks = z.tasks.filter(t => !DAILY_TYPES.has(t.frequency_type));
      if (!tasks.length) return '';
      const rows = tasks.map(t => {
        const isDone = getDoneState(t.section_es, t.task_order);
        const pct = freshnessForTask(t);
        const cls = freshnessClass(pct);
        const last = periodicLastDone(t);
        const next = periodicNextDue(t);
        const overdue = next && next < today;
        const due = !last ? 'Due now · never done'
          : (overdue ? `Overdue · was due ${pShortDate(next)}` : `Last ${pShortDate(last)} → due ${pShortDate(next)}`);
        const people = periodicAssignees(t);
        const avs = people.length
          ? people.slice(0, 3).map(p => `<span class="cleanlite-pav" style="--av-hue:${liteHue(p.id)}" title="${esc(p.name)}">${esc(liteInitials(p.name))}</span>`).join('') + (people.length > 3 ? `<span class="cleanlite-pav is-more">+${people.length - 3}</span>` : '')
          : `<span class="cleanlite-pav is-none">${svg('user', 12)}</span>`;
        return `<div class="cleanlite-ptask ${isDone ? 'is-done' : ''}" data-ptask="${esc(t.id)}">
          <button class="cleanlite-pcheck" data-pdone="${esc(t.id)}" title="Mark done — restarts the cycle">${svg('check', 13)}</button>
          <div class="cleanlite-ptask-main">
            <div class="cleanlite-ptask-top"><span class="cleanlite-ptask-name">${esc(t.name_en || t.name_es || '')}</span><span class="cleanlite-pfreq">${esc(freqLabelFor(t))}</span></div>
            <div class="cleanlite-pbar"><div class="cleanlite-pbar-fill ${cls}" style="width:${pct}%"></div></div>
            <div class="cleanlite-ptask-sub ${overdue ? 'is-overdue' : ''}">${esc(due)}</div>
          </div>
          <button class="cleanlite-ppeople" data-passign="${esc(t.id)}" title="Assign people">${avs}</button>
          <button class="cleanlite-pkebab" data-pedit="${esc(t.id)}" title="Edit task">${svg('pen', 13)}</button>
        </div>`;
      }).join('');
      return `<div class="cleanlite-pcard" data-zone="${esc(z.es)}">
        <div class="cleanlite-pcard-head"><span class="cleanlite-pcard-name">${esc(z.en)}</span><button class="cleanlite-padd" data-padd="${esc(z.es)}" title="Add a periodic task">${svg('plus', 13)}</button></div>
        <div class="cleanlite-ptasks">${rows}</div>
      </div>`;
    }).filter(Boolean).join('');
    return `<div class="cleanlite-periodic">
      <div class="cleanlite-periodic-title"><span>${svg('calendar', 14)} Periodic &amp; deep cleans</span><button class="cleanlite-pnewcard" data-pnewcard title="New periodic card">${svg('plus', 13)} Card</button></div>
      ${cards || '<div class="cleanlite-empty">No periodic tasks yet — tap “+ Card”, or add a biweekly/monthly task to a zone.</div>'}
    </div>`;
  }

  function periodicWire(wrap) {
    wrap.querySelectorAll('[data-pdone]').forEach(b => b.addEventListener('click', async () => {
      const t = (tasksByLoc[activeLoc] || []).find(x => String(x.id) === b.dataset.pdone);
      if (t) { await liteToggleTask(t, b.closest('.cleanlite-ptask')); render(); }
    }));
    wrap.querySelectorAll('[data-passign]').forEach(b => b.addEventListener('click', () => litePeriodicAssign(b.dataset.passign)));
    wrap.querySelectorAll('[data-pedit]').forEach(b => b.addEventListener('click', () => litePeriodicEditor(b.dataset.pedit)));
    wrap.querySelectorAll('[data-padd]').forEach(b => b.addEventListener('click', () => litePeriodicEditor('new', b.dataset.padd)));
    const pn = wrap.querySelector('[data-pnewcard]'); if (pn) pn.addEventListener('click', litePeriodicNewCard);
  }

  function litePeriodicOverlay(innerHtml) {
    const ov = document.createElement('div');
    ov.className = 'cleanlite-ov';
    ov.innerHTML = `<div class="cleanlite-ov-card">${innerHtml}</div>`;
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }

  function litePeriodicAssign(taskId) {
    const t = (tasksByLoc[activeLoc] || []).find(x => String(x.id) === String(taskId));
    if (!t) return;
    const current = new Set(periodicAssignees(t).map(a => String(a.id)));
    const rows = (usersList || []).map(u => `<label class="cleanlite-ov-row"><input type="checkbox" data-uid="${esc(u.id)}" ${current.has(String(u.id)) ? 'checked' : ''}><span class="cleanlite-pav" style="--av-hue:${liteHue(u.id)}">${esc(liteInitials(u.name))}</span><span class="cleanlite-ov-rowname">${esc(u.name)}</span></label>`).join('') || '<div class="cleanlite-empty">No people yet — add an employee first.</div>';
    const ov = litePeriodicOverlay(`
      <div class="cleanlite-ov-title">Assign people</div>
      <div class="cleanlite-ov-sub">${esc(t.name_en || t.name_es || '')}</div>
      <div class="cleanlite-ov-list">${rows}</div>
      <div class="cleanlite-ov-actions"><button class="cleanlite-ov-btn cleanlite-ov-cancel">Cancel</button><button class="cleanlite-ov-btn is-primary cleanlite-ov-save">Save</button></div>`);
    ov.querySelector('.cleanlite-ov-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('.cleanlite-ov-save').addEventListener('click', async () => {
      const ids = Array.from(ov.querySelectorAll('input[data-uid]:checked')).map(i => i.dataset.uid);
      ov.remove();
      await savePeriodicAssignees(taskId, ids);
      await loadAssignments();
      render();
    });
  }

  async function savePeriodicAssignees(taskId, userIds) {
    if (!NX.sb) return;
    try {
      await NX.sb.from('cleaning_task_assignments').delete().eq('task_id', taskId).eq('scope', 'periodic');
      if (userIds.length) {
        await NX.sb.from('cleaning_task_assignments').insert(userIds.map(uid => ({ task_id: taskId, user_id: uid, scope: 'periodic' })));
      }
      toast('Assigned', 'success');
    } catch (e) { console.warn('[cleanlite] savePeriodicAssignees:', e); toast('Could not save', 'error'); }
  }

  function litePeriodicEditor(taskOrNew, sectionEs) {
    const isNew = !taskOrNew || taskOrNew === 'new';
    const t = isNew ? null : (tasksByLoc[activeLoc] || []).find(x => String(x.id) === String(taskOrNew));
    const sec = isNew ? sectionEs : (t ? t.section_es : sectionEs);
    const z = liteZones().find(z => z.es === sec);
    const secEn = z ? z.en : (t ? (t.section_en || t.section_es) : sec);
    const freqOpts = FREQUENCY_DEFINITIONS.filter(f => f.type !== 'daily' && f.type !== 'custom')
      .map(f => `<option value="${f.type}" ${((t && t.frequency_type === f.type) || (isNew && f.type === 'monthly')) ? 'selected' : ''}>${esc(f.labelEn)}${f.days ? ` · every ${f.days}d` : ''}</option>`).join('');
    const ov = litePeriodicOverlay(`
      <div class="cleanlite-ov-title">${isNew ? 'New periodic task' : 'Edit task'}</div>
      <div class="cleanlite-ov-sub">${esc(secEn)}</div>
      <label class="cleanlite-ov-lbl">Task name</label>
      <input class="cleanlite-ov-input" data-f="name" value="${esc(t ? (t.name_en || t.name_es || '') : '')}" placeholder="e.g. Pressure-wash patio">
      <label class="cleanlite-ov-lbl">How often</label>
      <select class="cleanlite-ov-input" data-f="freq">${freqOpts}</select>
      <label class="cleanlite-ov-lbl">Last done (optional — anchors the cycle)</label>
      <input class="cleanlite-ov-input" type="date" data-f="last" value="${esc(periodicLastDone(t) || '')}">
      <div class="cleanlite-ov-actions">
        ${isNew ? '' : '<button class="cleanlite-ov-btn cleanlite-ov-del">Delete</button>'}
        <button class="cleanlite-ov-btn cleanlite-ov-cancel">Cancel</button>
        <button class="cleanlite-ov-btn is-primary cleanlite-ov-save">Save</button>
      </div>`);
    ov.querySelector('.cleanlite-ov-cancel').addEventListener('click', () => ov.remove());
    const del = ov.querySelector('.cleanlite-ov-del');
    if (del) del.addEventListener('click', async () => { ov.remove(); await litePeriodicDelete(t); });
    ov.querySelector('.cleanlite-ov-save').addEventListener('click', async () => {
      const name = ov.querySelector('[data-f="name"]').value.trim();
      const freq = ov.querySelector('[data-f="freq"]').value;
      const last = ov.querySelector('[data-f="last"]').value;
      if (!name) { toast('Name required', 'warn'); return; }
      ov.remove();
      await litePeriodicSave({ t, isNew, sec, secEn, name, freq, last });
    });
  }

  async function litePeriodicSave(o) {
    if (!NX.sb) return;
    const def = FREQ_BY_TYPE[o.freq] || FREQ_BY_TYPE.monthly;
    try {
      let taskOrder = o.t ? o.t.task_order : null;
      if (o.isNew) {
        const inSec = (tasksByLoc[activeLoc] || []).filter(x => x.section_es === o.sec);
        taskOrder = inSec.reduce((m, x) => Math.max(m, x.task_order || 0), -1) + 1;
        const secOrder = inSec.length ? inSec[0].section_order : ((tasksByLoc[activeLoc] || []).reduce((m, x) => Math.max(m, x.section_order || 0), -1) + 1);
        const { error } = await NX.sb.from('cleaning_tasks').insert({
          location: activeLoc, section_es: o.sec, section_en: o.secEn, section_order: secOrder, task_order: taskOrder,
          name_es: o.name, name_en: o.name, frequency_type: o.freq, frequency_days: def.days,
        });
        if (error) throw error;
      } else {
        const { error } = await NX.sb.from('cleaning_tasks').update({ name_es: o.name, name_en: o.name, frequency_type: o.freq, frequency_days: def.days }).eq('id', o.t.id);
        if (error) throw error;
      }
      if (o.last) {
        await NX.sb.from('cleaning_logs').upsert({
          location: activeLoc, log_date: o.last, section: o.sec, task_index: taskOrder, done: true,
          completed_by: getUserName(), completed_at: new Date(o.last + 'T12:00:00').toISOString(),
        }, { onConflict: 'location,log_date,task_index,section' });
      }
      toast('Saved', 'success');
      await loadTasksForLocation(activeLoc); await loadHistory(); await loadAssignments();
      render();
    } catch (e) { console.warn('[cleanlite] periodicSave:', e); toast('Could not save', 'error'); }
  }

  async function litePeriodicDelete(t) {
    if (!t || !NX.sb) return;
    if (!confirm('Delete this periodic task?')) return;
    try {
      await NX.sb.from('cleaning_tasks').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', t.id);
      toast('Deleted', 'success');
      await loadTasksForLocation(activeLoc); render();
    } catch (e) { console.warn('[cleanlite] periodicDelete:', e); toast('Could not delete', 'error'); }
  }

  function litePeriodicNewCard() {
    const make = async (name) => {
      name = (name || '').trim(); if (!name) return;
      try {
        const secOrder = (tasksByLoc[activeLoc] || []).reduce((m, x) => Math.max(m, x.section_order || 0), -1) + 1;
        const { error } = await NX.sb.from('cleaning_tasks').insert({
          location: activeLoc, section_es: name, section_en: name, section_order: secOrder, task_order: 0,
          name_es: 'Nueva tarea', name_en: 'New task', frequency_type: 'monthly', frequency_days: 30,
        });
        if (error) throw error;
        toast('Card created', 'success');
        await loadTasksForLocation(activeLoc); render();
      } catch (e) { console.warn('[cleanlite] newCard:', e); toast('Could not create', 'error'); }
    };
    if (window.NX && window.NX.composer && window.NX.composer.modal) {
      window.NX.composer.modal({
        title: 'New periodic card', subtitle: 'A card to hold biweekly / monthly / quarterly tasks',
        buttonLabel: 'Create', fields: [{ name: 'name', label: 'Card name', placeholder: 'e.g. Deep cleans', autofocus: true }],
        onSubmit: ({ name }) => make(name),
      });
    } else { const n = prompt('New periodic card name:'); if (n) make(n); }
  }

  function renderLite(list) {
    list.innerHTML = '';
    const cfg = liteConfig();
    const zones = liteZones();
    const wrap = document.createElement('div');
    wrap.className = 'cleanlite';

    const todayDow = todayDayOfWeek();
    const scopeLabel = liteDay === 'all' ? 'every day' : LITE_DOW[liteDay - 1];
    const locPills = `<button class="cleanlite-loc ${liteOverview ? 'is-active' : ''}" data-loc="__all__">All</button>` +
      LOCATIONS.map(l => `<button class="cleanlite-loc ${(!liteOverview && l === activeLoc) ? 'is-active' : ''}" data-loc="${l}">${esc(locLabel(l))}</button>`).join('');

    // ── Overview: every location's cleaning progress in one place ──────────
    if (liteOverview) {
      const cards = LOCATIONS.map(l => {
        const pct = progressByLoc[l] != null ? Math.round(progressByLoc[l]) : 0;
        const zoneCount = (tasksBySection(l) || []).length;
        return `<button class="cleanlite-ovcard" data-enter-loc="${l}">
          <div class="cleanlite-ovcard-head">
            <span class="cleanlite-ovcard-name">${esc(locLabel(l))}</span>
            <span class="cleanlite-ovcard-pct ${pct >= 100 ? 'is-complete' : ''}">${pct}%</span>
          </div>
          <div class="cleanlite-ovbar"><div class="cleanlite-ovbar-fill" style="width:${pct}%"></div></div>
          <div class="cleanlite-ovcard-sub">${zoneCount} zone${zoneCount === 1 ? '' : 's'} · tap to open</div>
        </button>`;
      }).join('');
      wrap.innerHTML = `
        <div class="cleanlite-top"><div class="cleanlite-loc-picker">${locPills}</div></div>
        <div class="cleanlite-ovhead">All cleaning · today</div>
        <div class="cleanlite-ovgrid">${cards}</div>
        <div class="cleanlite-cta-wrap"><button class="cleanlite-cta is-ghost" data-print-all>${svg('document', 15)} Print all locations</button></div>`;
      wrap.querySelectorAll('[data-loc]').forEach(b => b.addEventListener('click', () => liteSwitchLoc(b.dataset.loc)));
      wrap.querySelectorAll('[data-enter-loc]').forEach(b => b.addEventListener('click', () => liteSwitchLoc(b.dataset.enterLoc)));
      wrap.querySelector('[data-print-all]').addEventListener('click', litePrintAll);
      list.appendChild(wrap);
      return;
    }
    const dayPills = `<button class="cleanlite-day ${liteDay === 'all' ? 'is-active' : ''}" data-day="all">All</button>` +
      LITE_DOW.map((lbl, i) => `<button class="cleanlite-day ${liteDay === i + 1 ? 'is-active' : ''} ${todayDow === i + 1 ? 'is-today' : ''}" data-day="${i + 1}" title="${esc(lbl)}">${lbl[0]}</button>`).join('');

    const zoneCards = zones.map(z => {
      const pid = liteZonePerson(z.es, liteDay);
      const varies = pid === '__varies__';
      const nm = varies ? 'Varies' : litePersonName(pid);
      const note = liteZoneNoteText(z.es);
      const { done, total } = liteZoneCounts(z.es);
      // Daily zone cards show DAILY tasks only — periodic (biweekly+) tasks
      // live in their own "Periodic & deep cleans" group below (no dupes).
      const taskRows = z.tasks.filter(t => DAILY_TYPES.has(t.frequency_type)).map(t => {
        const isDone = getDoneState(t.section_es, t.task_order);
        return `<button class="cleanlite-task ${isDone ? 'is-done' : ''}" data-task-id="${esc(t.id)}">
          <span class="cleanlite-check">${svg('check', 13)}</span>
          <span class="cleanlite-task-name">${esc(t.name_en || t.name_es || '')}</span>
        </button>`;
      }).join('');
      return `<div class="cleanlite-zone" data-zone="${esc(z.es)}">
        <div class="cleanlite-zone-head">
          <button class="cleanlite-person-btn" data-pick-zone="${esc(z.es)}" title="Set who works this zone on ${esc(scopeLabel)}">
            <span class="cleanlite-av ${nm ? '' : 'is-none'} ${varies ? 'is-varies' : ''}" ${(!varies && nm) ? `style="--av-hue:${liteHue(pid)}"` : ''}>${varies ? '~' : (nm ? esc(liteInitials(nm)) : svg('user', 14))}</span>
          </button>
          <div class="cleanlite-zone-titles"><div class="cleanlite-zone-name">${esc(z.en)}</div><div class="cleanlite-zone-person">${nm ? esc(nm) : 'Tap to assign'}</div></div>
          <span class="cleanlite-zone-count ${total > 0 && done === total ? 'is-complete' : ''}">${done}/${total}</span>
          <button class="cleanlite-guide" data-guide-zone="${esc(z.es)}" title="Training guide">${svg('book', 15)}</button>
          <button class="cleanlite-guide cleanlite-kebab" data-zone-menu="${esc(z.es)}" title="More — swap, note, history, photo">⋮</button>
        </div>
        ${note ? `<div class="cleanlite-zone-noterow">${svg('pen', 11)}<span>${esc(note)}</span></div>` : ''}
        <div class="cleanlite-tasks">${taskRows || '<div class="cleanlite-empty">No tasks in this zone.</div>'}</div>
      </div>`;
    }).join('');

    wrap.innerHTML = `
      <div class="cleanlite-top">
        <div class="cleanlite-loc-picker">${locPills}</div>
      </div>
      <div class="cleanlite-dayrow">
        <span class="cleanlite-dayrow-label">Crew · ${esc(scopeLabel)}</span>
        <div class="cleanlite-days">${dayPills}</div>
        ${liteDay !== 'all' ? `<button class="cleanlite-mini" data-copy-all title="Copy this day's crew to every day">${svg('calendar', 12)} → all days</button>` : ''}
      </div>
      <div class="cleanlite-zones">${zoneCards || '<div class="cleanlite-empty">No zones yet — add tasks for this location first.</div>'}</div>
      ${renderPeriodicGroup()}
      <div class="cleanlite-cta-wrap">
        <button class="cleanlite-cta" data-apply title="Write the whole week's crew to the live duties">${svg('calendar', 15)} Apply</button>
        <button class="cleanlite-cta is-ghost" data-summary title="Email a cleaning summary or send it to the Daily Log">${svg('mail', 15)} Summary</button>
        <button class="cleanlite-cta is-ghost" data-print title="Printable weekly schedule — this location">${svg('document', 15)} Print</button>
        <button class="cleanlite-cta is-ghost" data-print-all title="Print every location in one go">${svg('document', 15)} All</button>
      </div>`;

    // wiring
    wrap.querySelectorAll('[data-loc]').forEach(b => b.addEventListener('click', () => liteSwitchLoc(b.dataset.loc)));
    wrap.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.day; liteDay = v === 'all' ? 'all' : parseInt(v, 10); render();
    }));
    const copyAll = wrap.querySelector('[data-copy-all]'); if (copyAll) copyAll.addEventListener('click', liteCopyDayToAll);
    wrap.querySelectorAll('[data-pick-zone]').forEach(b => b.addEventListener('click', () => liteOpenPersonPicker(b.dataset.pickZone)));
    wrap.querySelectorAll('[data-guide-zone]').forEach(b => b.addEventListener('click', () => liteOpenZoneGuide(b.dataset.guideZone)));
    wrap.querySelectorAll('[data-zone-menu]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); liteOpenZoneMenu(b.dataset.zoneMenu, b); }));
    wrap.querySelectorAll('.cleanlite-task').forEach(b => b.addEventListener('click', () => {
      const z = liteZones().find(z => z.tasks.some(t => String(t.id) === b.dataset.taskId));
      const t = z && z.tasks.find(t => String(t.id) === b.dataset.taskId);
      if (t) liteToggleTask(t, b);
    }));
    wrap.querySelector('[data-apply]').addEventListener('click', liteApplySchedule);
    wrap.querySelector('[data-print]').addEventListener('click', litePrintWeek);
    { const pAll = wrap.querySelector('[data-print-all]'); if (pAll) pAll.addEventListener('click', litePrintAll); }
    const sumBtn = wrap.querySelector('[data-summary]'); if (sumBtn) sumBtn.addEventListener('click', () => liteOpenSummary(activeLoc));
    periodicWire(wrap);

    list.appendChild(wrap);
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
