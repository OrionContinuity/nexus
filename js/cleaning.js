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
  // Base trio always present; loadLocationMeta() APPENDS any additional
  // non-archived rows from the locations table (normalized to a key), so a
  // 4th restaurant (Karaz…) joins the cleaning pane without a code change.
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
  let lastDoneByTaskId = {};  // { task_uuid: { date, by } } — identity-based history (v18.37)
  const autoEscalationsRan = new Set();  // 'loc__date' — one auto-escalation sweep per shift-day
  let todayStateByKey = {};   // { 'sectionEs_taskOrder': { done: true, by: 'Orion' } }
  let usersList = [];         // [{ id, name, role }]
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
  // The 7 Dates of the current week, Sunday-first (matches LITE_DOW and
  // day_of_week 1..7). Used by the weekly print + Excel exports.
  function currentWeekDates() {
    const sun = new Date();
    sun.setHours(12, 0, 0, 0);
    sun.setDate(sun.getDate() - sun.getDay());
    return [...Array(7)].map((_, i) => { const d = new Date(sun); d.setDate(d.getDate() + i); return d; });
  }
  // Linked education guides per task. Each value is an array of guide
  // objects with at least { id, title_en, primary_kind }.
  let guidesLinkedByTaskId = {};
  // ─── V16 state — cleaner profiles + full-screen focus ──────────────────
  // profilesByUserId[user_id] = { working_days:int[1-7], default_shift,
  //   allowed_sections:string[] (section_es; empty = all), active }.
  // Drives soft "mine" highlighting (nothing is hidden) + the admin roster.
  let profilesByUserId = {};
  // Full-screen focus mode hides the app masthead so cleaning fills the
  // screen. Opt-in (default keeps the nav for fast hops). Persisted per device.
  let focusModeOn = false;
  try { focusModeOn = localStorage.getItem('clean_focus_mode') === '1'; } catch (e) {}

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
    const hist = lastDoneFor(task);   // identity-first, positional fallback
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
    lastDoneByTaskId = {};
    if (!NX.sb || NX.paused) return;
    try {
      // Server-side latest-per-task (cleaning_last_done RPC). The old
      // client-side approach pulled the newest 1000 rows and derived
      // per-task latest from them — anything last done before that window
      // (quarterlies, annuals) silently read as "never done", producing
      // false OVERDUEs and spurious auto-escalations.
      const { data, error } = await NX.sb.rpc('cleaning_last_done', { p_location: activeLoc });
      if (!error && Array.isArray(data)) {
        data.forEach(r => {
          const entry = { date: r.log_date, by: r.completed_by || '' };
          const key = r.section + '_' + r.task_index;
          if (!lastDoneByKey[key] || lastDoneByKey[key].date < r.log_date) lastDoneByKey[key] = entry;
          if (r.task_id && (!lastDoneByTaskId[r.task_id] || lastDoneByTaskId[r.task_id].date < r.log_date)) {
            lastDoneByTaskId[r.task_id] = entry;
          }
        });
        return;
      }
      // RPC missing (pre-migration) — legacy capped query.
      const fb = await NX.sb.from('cleaning_logs')
        .select('section, task_index, log_date, completed_by')
        .eq('location', activeLoc)
        .eq('done', true)
        .order('log_date', { ascending: false })
        .limit(1000);
      if (fb.error) { console.warn('[cleaning] loadHistory:', fb.error); return; }
      (fb.data || []).forEach(r => {
        const key = r.section + '_' + r.task_index;
        if (!lastDoneByKey[key]) {
          lastDoneByKey[key] = { date: r.log_date, by: r.completed_by || '' };
        }
      });
    } catch (e) {
      console.warn('[cleaning] loadHistory exception:', e);
    }
  }
  // Identity-first lookup: prefer the task's own id (survives reorders and
  // section renames), fall back to the legacy positional key.
  function lastDoneFor(task) {
    return lastDoneByTaskId[task.id] || lastDoneByKey[task.section_es + '_' + task.task_order] || null;
  }

  // Last-7-shift-days score for the active location: done-count per day vs
  // the current daily-task count, plus a streak (consecutive days ≥80%).
  // Powers the week strip in the Lite header — the "how are we actually
  // doing" signal the pane never had.
  let weekStats = null;
  async function loadWeekStats() {
    weekStats = null;
    if (!NX.sb || NX.paused) return;
    try {
      const start = new Date(today + 'T12:00:00');
      start.setDate(start.getDate() - 6);
      const startISO = start.toISOString().slice(0, 10);
      const { data, error } = await NX.sb.from('cleaning_logs')
        .select('log_date, task_id, section, task_index')
        .eq('location', activeLoc)
        .eq('done', true)
        .gte('log_date', startISO)
        .lte('log_date', today);
      if (error) { console.warn('[cleaning] loadWeekStats:', error); return; }
      // Count DAILY-task completions only. Periodic tasks also write done
      // rows (including noon "last done" anchors from the editor), and
      // counting those against a daily-only denominator painted 100% bars
      // on days nobody cleaned. Match by task_id, legacy rows by position.
      const dailyTasks = (tasksByLoc[activeLoc] || []).filter(t => DAILY_TYPES.has(t.frequency_type));
      const dailyById = new Set(dailyTasks.map(t => String(t.id)));
      const dailyByKey = new Set(dailyTasks.map(t => t.section_es + '#' + t.task_order));
      const byDay = {};
      const seen = new Set();
      (data || []).forEach(r => {
        const isDaily = (r.task_id != null)
          ? dailyById.has(String(r.task_id))
          : dailyByKey.has(r.section + '#' + r.task_index);
        if (!isDaily) return;
        const key = r.log_date + '|' + (r.task_id != null ? r.task_id : r.section + '#' + r.task_index);
        if (seen.has(key)) return;   // dupes (legacy + identity rows) count once
        seen.add(key);
        byDay[r.log_date] = (byDay[r.log_date] || 0) + 1;
      });
      const expected = dailyTasks.length || 1;
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today + 'T12:00:00');
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().slice(0, 10);
        const done = byDay[iso] || 0;
        days.push({ date: iso, done, pct: Math.min(100, Math.round(100 * done / expected)) });
      }
      // Streak: consecutive ≥80% days ending yesterday; today joins live
      // once it crosses the bar (so the number grows during the shift).
      let streak = 0;
      for (let i = days.length - 2; i >= 0; i--) {
        if (days[i].pct >= 80) streak++; else break;
      }
      if (days[days.length - 1].pct >= 80) streak++;
      weekStats = { days, streak, expected };
    } catch (e) { console.warn('[cleaning] loadWeekStats exception:', e); }
  }

  // ONE loader set for every location switch. The old code had two
  // switchers loading two different subsets (.clean-tab skipped
  // assignments/profiles/guides; the Lite pills skipped attachments/
  // linked-cards/notes), so avatars, guides, and the end-of-shift email
  // could show the PREVIOUS location's data.
  async function reloadLocationState() {
    await loadTodayState();
    await loadHistory();
    await loadAssignments();
    await loadProfiles();
    await loadAttachments();
    await loadLinkedCards();
    await loadGuideLinks();
    await loadTaskNotes();
    await loadWeekStats();
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

  // ─── V16: full-screen focus mode (hide the masthead) ───────────────────
  // The body class is scoped in CSS to `body.view-clean.clean-focus`, so it
  // only hides the nav while the cleaning view is active — leaving the class
  // on after navigating away is harmless (view-clean is cleared by app.js).
  function applyFocusMode() {
    document.body.classList.toggle('clean-focus', !!focusModeOn);
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
        let matched = false;
        LOCATIONS.forEach(key => { if (lc.includes(key)) { locationMeta[key] = r; matched = true; } });
        // New restaurant (no matching base key): derive a stable key from
        // the label and add it to the working set so its pills, tasks, and
        // progress all light up without touching code.
        if (!matched) {
          const key = lc.replace(/[^a-z0-9]+/g, '') || null;
          if (key && !LOCATIONS.includes(key)) {
            LOCATIONS.push(key);
            locationMeta[key] = r;
          }
        }
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

  function applyCardsMode() {
    const pane = document.getElementById('dutiesCleaningPane');
    if (pane) pane.classList.toggle('is-loc-cards', showingLocationCards);
  }

  // ─── V16: printable Excel export (full schedule or per-person) ─────────
  function freqLabelFor(t) {
    const m = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
    return m[t.frequency_type] || (t.frequency_type ? (t.frequency_type[0].toUpperCase() + t.frequency_type.slice(1)) : 'Daily');
  }

  // ─── Excel export (weekly print sheet) — restored post-purge and
  //     wired into the Lite CTA row (it was only reachable from the
  //     retired classic location cards before). ───────────────────────
  const WEEKDAY_LABEL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function localISO(d) { const x = d || new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }

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

    // This sheet gets printed WEEKLY — autofill the current week's real
    // dates into the day headers, and carry the app's last-done/due dates
    // for every periodic task. Dates come from the RPC (not the live
    // caches) so exporting a non-active location stays correct.
    const lastByTask = {}, lastByKey = {};
    try {
      const { data: ld } = await NX.sb.rpc('cleaning_last_done', { p_location: loc });
      (ld || []).forEach(r => {
        if (r.task_id && (!lastByTask[r.task_id] || lastByTask[r.task_id] < r.log_date)) lastByTask[r.task_id] = r.log_date;
        const k = r.section + '_' + r.task_index;
        if (!lastByKey[k] || lastByKey[k] < r.log_date) lastByKey[k] = r.log_date;
      });
    } catch (e) { console.warn('[cleaning] export last-done:', e); }
    const lastFor = t => lastByTask[t.id] || lastByKey[t.section_es + '_' + t.task_order] || null;
    const dueFor = t => {
      const l = lastFor(t); if (!l) return null;
      const d = new Date(l + 'T00:00:00'); if (isNaN(d)) return null;
      d.setDate(d.getDate() + periodicFreqDays(t));
      return localISO(d);
    };
    const whoFor = t => (byTask[t.id] || []).filter(a => a.scope === 'periodic')
      .map(a => nameById[a.user_id]).filter(Boolean).join(', ');
    const weekDates = currentWeekDates();
    const dm = d => `${d.getMonth() + 1}/${d.getDate()}`;
    const weekLabel = `${weekDates[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekDates[6].toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    const shiftLbl = t => { const s = t.shift_pattern || 'am'; return s === 'both' ? 'AM+PM' : s.toUpperCase(); };

    if (mode === 'person') {
      const personName = nameById[userId] || 'Person';
      sheetName = personName.slice(0, 28);
      fnameTag = personName.replace(/\s+/g, '-').toLowerCase();
      aoa = [[`${label} · ${personName} — cleaning tasks · week of ${weekLabel}`], [],
        ['Section', 'Task', 'Tarea', 'Frequency', 'Days', 'Shift', 'Photo', 'Last done', 'Due']];
      tasks.forEach(t => {
        const mine = (byTask[t.id] || []).filter(a => String(a.user_id) === String(userId));
        if (!mine.length) return;
        const isDaily = DAILY_TYPES.has(t.frequency_type);
        const days = [...new Set(mine.map(a => a.day_of_week).filter(Boolean))].sort((a, b) => a - b).map(d => WEEKDAY_LABEL[d - 1]).join(' ');
        const shift = [...new Set(mine.map(a => a.shift).filter(Boolean))].map(s => s.toUpperCase()).join('/');
        const last = isDaily ? '' : (pShortDate(lastFor(t)) || 'never');
        const due = isDaily ? '' : (pShortDate(dueFor(t)) || 'NOW');
        aoa.push([t.section_en || t.section_es || '', t.name_en || '', t.name_es || '', freqLabelFor(t),
          days || (isDaily ? 'any' : 'on due date'), shift || shiftLbl(t), t.photo_required ? 'YES' : '', last, due]);
      });
      if (aoa.length === 3) aoa.push(['—', 'No tasks assigned to this person', '', '', '', '', '', '', '']);
      cols = [22, 30, 30, 14, 16, 10, 7, 11, 11];
    } else {
      sheetName = 'Schedule';
      fnameTag = 'week';
      aoa = [[`${label} — cleaning schedule · week of ${weekLabel}`],
        [`Printed ${today} · Photo = a picture is required to check off`], [],
        ['Section', 'Task', 'Tarea', 'Frequency', 'Shift', 'Photo', 'Last done', 'Due',
          ...WEEKDAY_LABEL.map((w, i) => `${w} ${dm(weekDates[i])}`)]];
      tasks.forEach(t => {
        const isDaily = DAILY_TYPES.has(t.frequency_type);
        // Merge each person's AM+PM rows into one clean tag per day.
        const dayUsers = [...Array(7)].map(() => new Map());
        (byTask[t.id] || []).forEach(a => {
          if (a.scope !== 'weekly' || !a.day_of_week) return;
          const nm = nameById[a.user_id] || '';
          const i = a.day_of_week - 1;
          if (!nm || i < 0 || i > 6) return;
          if (!dayUsers[i].has(nm)) dayUsers[i].set(nm, new Set());
          if (a.shift) dayUsers[i].get(nm).add(a.shift);
        });
        const cells = dayUsers.map(m => Array.from(m.entries()).map(([nm, sh]) =>
          (sh.size === 1) ? `${nm} (${Array.from(sh)[0].toUpperCase()})` : nm).join(', '));
        let last = '', due = '';
        if (!isDaily) {
          last = pShortDate(lastFor(t)) || 'never';
          const dueIso = dueFor(t);
          due = pShortDate(dueIso) || 'NOW';
          // Drop the due marker (+ periodic crew) into the matching day
          // column so the printed week shows WHEN it lands and WHO owns it.
          const who = whoFor(t);
          if (dueIso) {
            const wk0 = localISO(weekDates[0]), wk6 = localISO(weekDates[6]);
            if (dueIso < wk0) cells[0] = ['OVERDUE', who].filter(Boolean).join(' — ');
            else if (dueIso <= wk6) {
              const idx = weekDates.findIndex(d => localISO(d) === dueIso);
              if (idx >= 0) cells[idx] = ['DUE', who].filter(Boolean).join(' — ');
            }
          } else {
            cells[0] = ['DUE NOW', who].filter(Boolean).join(' — ');
          }
        }
        aoa.push([t.section_en || t.section_es || '', t.name_en || '', t.name_es || '', freqLabelFor(t),
          shiftLbl(t), t.photo_required ? 'YES' : '', last, due, ...cells]);
      });
      cols = [20, 28, 28, 12, 8, 7, 11, 11, 15, 15, 15, 15, 15, 15, 15];
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

  // ─── DB: load cleaning↔training link data ──────────────────────────────
  // Loads (a) which training modules each cleaning task is linked to,
  // (b) the linked modules' details, (c) current user's most-recent
  // completion for each linked module. All three caches keyed by ID.
  // Cheap to call repeatedly — short-circuits when training mode is off.
  async function loadTrainingData() {
    // NO-OP (v18.37). This queried cleaning_task_training_links — a table
    // that does not exist in the database — silently 404ing on every
    // location switch, and its output (trainingPillHTML) was rendered
    // nowhere. Zone guides use cleaning_task_guides instead (loadGuideLinks).
    linksByTaskId = {};
    trainingModulesById = {};
    myTrainingByModule = {};
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
  // Persist a check-off. Returns true on success, false on ANY failure —
  // and on failure it ROLLS BACK the optimistic UI itself, so a checkmark
  // on screen always means a row in the database. (The old version never
  // inspected the upsert result: supabase-js RESOLVES with {error}, so its
  // catch was unreachable and RLS/constraint/network failures produced
  // phantom completions that silently never saved.)
  async function persistDone(sectionEs, taskOrder, done, taskId) {
    const rollback = () => {
      setDoneState(sectionEs, taskOrder, !done);
      // A failed "mark done" also bumped the in-session freshness — undo it.
      if (done) {
        delete lastDoneByKey[sectionEs + '_' + taskOrder];
        if (taskId) delete lastDoneByTaskId[taskId];
      }
      toast('Could not save — check connection and tap again', 'error', 3200);
      render();
    };
    if (!NX.sb || NX.paused) { rollback(); return false; }
    try {
      const { error } = await NX.sb.from('cleaning_logs').upsert({
        location:        activeLoc,
        log_date:        today,
        section:         sectionEs,
        task_index:      taskOrder,
        task_id:         taskId || null,          // identity-based history (v18.37)
        done:            done,
        completed_by:    done ? getUserName() : null,
        completed_by_id: done ? getCurrentUserId() : null,
        completed_at:    done ? new Date().toISOString() : null,
      }, { onConflict: 'location,log_date,task_index,section' });
      if (error) {
        // Pre-migration column tolerance: retry without the new columns.
        if (/task_id|completed_by_id|column|schema cache/i.test(error.message || '')) {
          const { error: e2 } = await NX.sb.from('cleaning_logs').upsert({
            location: activeLoc, log_date: today, section: sectionEs, task_index: taskOrder,
            done, completed_by: done ? getUserName() : null,
            completed_at: done ? new Date().toISOString() : null,
          }, { onConflict: 'location,log_date,task_index,section' });
          if (e2) throw e2;
        } else {
          throw error;
        }
      }
      // Clippy notices finished cleaning tasks (self-guarded, probabilistic
      // inside — most completions pass silently, some get a hop or a line).
      if (done) { try { NX.clippy?.notifyTaskCompleted?.(); } catch (_) {} }
      return true;
    } catch (e) {
      console.error('[cleaning] persistDone:', e);
      rollback();
      return false;
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
    // Once per location per shift-day per session. Two timers used to race
    // here (init + tab handler), both passing the linkedBoardCards check
    // before either insert landed → duplicate cards.
    const guardKey = activeLoc + '__' + today;
    if (autoEscalationsRan.has(guardKey)) return;
    autoEscalationsRan.add(guardKey);
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
        const hist = lastDoneFor(t);
        let since;
        if (hist) {
          since = daysBetween(hist.date, today);
        } else {
          // Never done: measure from the task's creation, not "forever".
          // A brand-new monthly task used to escalate ~1.5s after being
          // created (since=9999 → infinitely overdue → instant board card).
          const created = t.created_at ? String(t.created_at).slice(0, 10) : null;
          if (!created) continue;                     // unknown age → don't guess
          since = daysBetween(created, today);
        }
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

  // Quiet section-to-board escalation (auto-escalation shows no
  // user-facing toasts). Same DB writes.
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


  // Card-based design borrowed wholesale from the ordering catalog editor:
  //   • Each section is a card with a gold-line border + rounded corners
  //   • Card head shows: name (bilingual), task count, freshness chip,
  //     overall progress, expand/collapse chevron
  //   • Expand reveals: task rows, "+ Add task" button, optional "→ On board"
  //   • Each task row: checkbox + bilingual name + freshness mini-bar +
  //     assignee chip + days-of-week pills (when relevant) + edit pencil
  //   • Tap edit pencil → inline form (same ord-vitem-editing pattern)

  // ═══ REORDER (v12.2) ════════════════════════════════════════════════
  // Move-up / move-down for tasks within a section, and for whole sections
  // within a location. Implemented as two index swaps + DB updates so the
  // existing cleaning_logs (keyed on task_index a.k.a. task_order) stays
  // consistent — old log rows still resolve correctly because we never
  // gap or re-base, just swap pairs.

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

  function render() {
    const list = document.getElementById('cleanList');
    if (!list) return;
    renderLite(list);
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

    // ONE email engine (v18.37): route through the shared NX.composeEmail
    if (window.NX && typeof NX.composeEmail === 'function') {
      NX.composeEmail({
        recipientsKey: 'clean:report:' + activeLoc,
        subject, body,
        title: 'Email cleaning report — ' + locName,
      });
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
    let failures = 0;
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
          else failures++;
        } catch (e) {
          failures++;
          console.warn('[cleaning] migrate failed for one custom:', e);
        }
      }
    }

    if (migrated > 0) {
      console.log(`[cleaning] migrated ${migrated} custom task(s) from localStorage`);
      toast(`Restored ${migrated} custom task${migrated === 1 ? '' : 's'} from this device`, 'info', 3000);
    }
    // Only clear the device payload when nothing FAILED. If every insert
    // errored (offline / RLS), the old code deleted the backup anyway —
    // the user's custom tasks were gone forever. All-duplicates/empty is
    // safe to clear; failures keep the payload so a later open can retry.
    if (failures === 0) {
      try { localStorage.removeItem('nexus_custom_tasks'); } catch (e) {}
    } else {
      console.warn(`[cleaning] migration kept localStorage payload (${failures} failure(s)) — will retry next load`);
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
        await reloadLocationState();
        render();
        // Auto-escalate after a short delay so the user sees the
        // location's data first before any toast fires.
        setTimeout(() => { runAutoEscalations().catch(() => {}); }, 800);
      });
    });

    // Shift-day watchdog: a device parked on this screen across the 8am
    // rollover must not keep writing to yesterday. Whenever the tab comes
    // back to the foreground, re-derive the shift date and refresh.
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') return;
      const liveDay = getCleaningDate();
      if (liveDay !== today && !(window.NX && NX.editingReport)) {
        today = liveDay;
        const dateEl2 = document.getElementById('cleanDate');
        if (dateEl2) dateEl2.textContent = today;
        await loadTodayState();
        await loadAttachments();
        render();
      }
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

    // Load all data, then render (one loader set — same as every switch)
    await loadAllTasks();
    await loadUsers();
    await reloadLocationState();

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
  //  The only cleaning screen (the classic UI was removed). Zones = the
  //  sections that already exist at the active location. Pick a person per
  //  zone; their zone IS their task list. Reuses every existing helper
  //  (profiles, autofill, persistDone, education guides).
  //  Zone→person for display lives in localStorage `nexus_cleaning_config`
  //  so it works for schedule-only staff too; real users also get their
  //  cleaning_profiles + assignments written so the rest of NEXUS stays in
  //  sync.
  // ═══════════════════════════════════════════════════════════════════════
  // Crew scope being edited/shown: 'all' (every day) or a day-of-week 1..7
  // (1=Sun, Postgres convention). Defaults to today so it opens on today's crew.
  let liteDay = todayDayOfWeek();
  // v260 — the screen was a cleaner's checklist and a manager's scheduling
  // console fused into one wall (crew pills + autofill + shift + zones +
  // exports all at once; opening it could even show "0/0" everywhere).
  // Split: TODAY = do the work; CREW = plan the people. Persisted.
  let liteMode = localStorage.getItem('nexus_cleaning_mode') || 'today';
  if (liteMode !== 'today' && liteMode !== 'crew') liteMode = 'today';
  // Overview = all locations' cleaning at a glance (the "All" pill).
  let liteOverview = false;
  async function liteSwitchLoc(loc) {
    if (loc === '__all__') { liteOverview = true; await loadAllLocProgress(); render(); return; }
    liteOverview = false; activeLoc = loc;
    await reloadLocationState();
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
  // DB-first day resolution: the cleaning_task_assignments written by
  // "Apply"/zone assignment are the shared, per-location truth. The old
  // order read the per-device localStorage map first — a schedule set on
  // the manager's phone didn't exist on the kitchen tablet, and because
  // that map is keyed by section NAME only, assigning "COCINA" at Este
  // silently changed COCINA's displayed crew at Suerte and Toti too.
  // v18.38: zones can have SEVERAL people per day. These return arrays
  // (deduped user ids as strings); liteZonePerson stays as a single-person
  // compat view for print/paint callers.
  function liteZoneDbPeople(sectionEs, dow) {
    const tasks = (tasksByLoc[activeLoc] || []).filter(t => t.section_es === sectionEs);
    const ids = new Set();
    tasks.forEach(t => (assignmentsByTaskId[t.id] || [])
      .filter(r => r.scope === 'weekly' && r.day_of_week === dow)
      .forEach(r => ids.add(String(r.user_id))));
    return Array.from(ids);
  }
  function liteZonePeopleForDay(sectionEs, d) {
    const db = liteZoneDbPeople(sectionEs, d);
    if (db.length) return db;
    const dc = liteDayCrewMap();
    const v = dc[d] ? dc[d][sectionEs] : null;                        // legacy device map (schedule-only staff)
    if (v == null) return [];
    return (Array.isArray(v) ? v : [v]).filter(x => x != null).map(String);
  }
  function liteZonePeople(sectionEs, scope) {
    const s = (scope === undefined) ? liteDay : scope;
    if (s === 'all') {
      const perDay = [];
      for (let d = 1; d <= 7; d++) perDay.push(liteZonePeopleForDay(sectionEs, d));
      const keys = new Set(perDay.map(a => a.slice().sort().join('|')));
      if (keys.size === 1 && perDay[0].length) return perDay[0];
      if (perDay.some(a => a.length)) return '__varies__';
      const p = liteProfilePerson(sectionEs);
      return p != null ? [String(p)] : [];
    }
    const v = liteZonePeopleForDay(sectionEs, s);
    if (v.length) return v;
    const p = liteProfilePerson(sectionEs);
    return p != null ? [String(p)] : [];
  }
  function liteZonePerson(sectionEs, scope) {
    const v = liteZonePeople(sectionEs, scope);
    if (v === '__varies__') return '__varies__';
    return v.length ? v[0] : null;
  }
  function liteProfilePerson(sectionEs) {
    const p = Object.values(profilesByUserId).find(pp =>
      pp && pp.active !== false && Array.isArray(pp.allowed_sections) && pp.allowed_sections.includes(sectionEs));
    return p ? p.user_id : null;
  }

  // Assign people to a zone for a scope (liteDay | 'all' | day | [days]).
  // v18.38: accepts one id OR an array of ids — a zone can have a whole crew.
  // Writes config (display + print, works for schedule-only staff) and, for
  // real users, the per-day cleaning_task_assignments so NEXUS stays in sync.
  async function liteAssignZone(sectionEs, personIds, scope) {
    const ids = (personIds == null) ? []
      : (Array.isArray(personIds) ? personIds : [personIds]).filter(x => x != null).map(String);
    const s = (scope === undefined) ? liteDay : scope;
    const days = Array.isArray(s) ? s : (s === 'all' ? [1,2,3,4,5,6,7] : [s]);
    const cfg = liteConfig();
    cfg.dayCrew = cfg.dayCrew || {};
    days.forEach(d => {
      cfg.dayCrew[d] = cfg.dayCrew[d] || {};
      if (!ids.length) delete cfg.dayCrew[d][sectionEs]; else cfg.dayCrew[d][sectionEs] = ids.slice();
    });
    saveLiteConfig(cfg);

    if (!NX.sb) return;
    try {
      const taskIds = (tasksByLoc[activeLoc] || []).filter(t => t.section_es === sectionEs).map(t => t.id);
      if (!taskIds.length) return;
      // Clear whoever was on these tasks for these days, then write the new crew.
      await NX.sb.from('cleaning_task_assignments').delete()
        .eq('scope', 'weekly').in('task_id', taskIds).in('day_of_week', days);
      for (const pid of ids) {
        if (!usersList.some(u => String(u.id) === String(pid))) continue; // schedule-only staff live in config
        await autofillAssignmentsForUser(pid, days, 'both', [sectionEs]);
      }
      await loadAssignments();
    } catch (e) { console.warn('[cleanlite] assign zone:', e); }
  }

  // ─── Person picker (sheet) + new-employee (+optional login) ──────────────
  // v18.38: MULTI-SELECT — tap people to build the zone's crew (full login-
  // user pool + schedule-only staff), then Save. No more one-per-assignment.
  function liteOpenPersonPicker(sectionEs) {
    document.querySelectorAll('.cleanlite-sheet-bg').forEach(m => m.remove());
    const people = litePeople();
    const cur = liteZonePeople(sectionEs);
    const selected = new Set(cur === '__varies__' ? [] : cur.map(String));
    // v262 — hidden users sink to a dimmed section at the bottom: out of the
    // way, still selectable. The eye on each row hides/unhides (persisted).
    const hiddenIds = liteHiddenIds();
    const isHidden = (p) => hiddenIds.has(String(p.id)) && !selected.has(String(p.id));
    const visible = people.filter(p => !isHidden(p));
    const hidden = people.filter(isHidden);
    const personRow = (p, dim) => `
            <button class="cleanlite-person ${selected.has(String(p.id)) ? 'is-active' : ''} ${dim ? 'is-hidden' : ''}" data-pid="${esc(p.id)}">
              <span class="cleanlite-av" style="--av-hue:${liteHue(p.id)}">${esc(liteInitials(p.name))}</span>
              <span class="cleanlite-person-name">${esc(p.name)}</span>
              ${p.login ? '<span class="cleanlite-tag">login</span>' : '<span class="cleanlite-tag is-muted">schedule</span>'}
              <span class="cleanlite-eye" data-eye="${esc(p.id)}" title="${hiddenIds.has(String(p.id)) ? 'Unhide from crew lists' : 'Hide from crew lists'}">${hiddenIds.has(String(p.id)) ? '🙈' : '👁'}</span>
              <span class="cleanlite-psel">${svg('check', 13)}</span>
            </button>`;
    const bg = document.createElement('div');
    bg.className = 'cleanlite-sheet-bg';
    bg.innerHTML = `
      <div class="cleanlite-sheet" role="dialog" aria-modal="true">
        <div class="cleanlite-sheet-grip"></div>
        <div class="cleanlite-sheet-title">Who works <b>${esc(liteZoneName(sectionEs))}</b> · <span class="cleanlite-sheet-day">${liteDay === 'all' ? 'every day' : esc(LITE_DOW[liteDay - 1])}</span></div>
        <div class="cleanlite-sheet-hint">Tap everyone on this zone — you can pick more than one. The eye hides accounts that don't clean.</div>
        <div class="cleanlite-people">
          ${visible.map(p => personRow(p, false)).join('')}
          ${hidden.length ? `<div class="cleanlite-hiddenlbl">Hidden · still tappable when needed</div>${hidden.map(p => personRow(p, true)).join('')}` : ''}
          <button class="cleanlite-person cleanlite-newemp" data-new>
            <span class="cleanlite-av is-add">${svg('plus', 16)}</span><span>New employee…</span></button>
        </div>
        <div class="cleanlite-sheet-actions">
          <button class="cleanlite-sheet-clear" data-clear>Clear zone</button>
          <button class="cleanlite-sheet-save" data-save>Save crew</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add('open'));
    const close = () => { bg.classList.remove('open'); setTimeout(() => bg.remove(), 200); };
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    const saveBtn = bg.querySelector('[data-save]');
    const paintSave = () => { saveBtn.textContent = selected.size ? `Save crew (${selected.size})` : 'Save crew'; };
    paintSave();
    bg.querySelectorAll('[data-pid]').forEach(btn => btn.addEventListener('click', (e) => {
      if (e.target.closest('[data-eye]')) return;   // the eye is not a select
      const pid = btn.dataset.pid;
      if (selected.has(pid)) { selected.delete(pid); btn.classList.remove('is-active'); }
      else { selected.add(pid); btn.classList.add('is-active'); }
      paintSave();
    }));
    // Eye: hide/unhide from crew lists (persisted; row dims in place).
    bg.querySelectorAll('[data-eye]').forEach(eye => eye.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowHidden = liteToggleHidden(eye.dataset.eye);
      const row = eye.closest('.cleanlite-person');
      if (row) row.classList.toggle('is-hidden', nowHidden);
      eye.textContent = nowHidden ? '🙈' : '👁';
      eye.title = nowHidden ? 'Unhide from crew lists' : 'Hide from crew lists';
      toast(nowHidden ? 'Hidden from crew lists — find them under "Hidden" when needed' : 'Back in the crew lists', 'success');
    }));
    const when = liteDay === 'all' ? 'every day' : LITE_DOW[liteDay - 1];
    saveBtn.addEventListener('click', async () => {
      close();
      const ids = Array.from(selected);
      await liteAssignZone(sectionEs, ids);
      render();
      const names = ids.map(litePersonName).filter(Boolean);
      toast(names.length ? `${names.join(', ')} → ${liteZoneName(sectionEs)} · ${when}` : 'Zone cleared', 'success');
    });
    bg.querySelector('[data-clear]').addEventListener('click', async () => {
      close();
      await liteAssignZone(sectionEs, []);
      render();
      toast('Zone cleared', 'success');
    });
    bg.querySelector('[data-new]').addEventListener('click', () => { close(); liteNewEmployee(sectionEs); });
  }

  function liteZoneName(es) { const z = liteZones().find(z => z.es === es); return z ? z.en : es; }

  // ─── Day planner + crew profiles (v261) ──────────────────────────────────
  // Alfredo: "give me a schedule to autofill in the week. like Monday — let
  // me assign Yobani and Martin. or a profile for a mass duty to fill in."
  // One sheet plans a whole day: every zone × every person as toggle chips.
  // Save it to the day, to the whole week, or as a NAMED PROFILE ("Weekday",
  // "Deep clean Monday") that refills the sheet in one tap next time.
  // Hidden users (v262) — Alfredo: location/test accounts "have almost
  // absolutely nothing to do with cleaning… but still clickable if it's
  // ever needed." Hidden ids tuck behind a "+N" chip / dimmed section
  // instead of disappearing. Managed with the eye toggle in the pickers.
  function liteHiddenIds() {
    const c = liteConfig();
    return new Set((Array.isArray(c.hiddenPeople) ? c.hiddenPeople : []).map(String));
  }
  function liteToggleHidden(id) {
    const c = liteConfig();
    const set = new Set((Array.isArray(c.hiddenPeople) ? c.hiddenPeople : []).map(String));
    const k = String(id);
    if (set.has(k)) set.delete(k); else set.add(k);
    c.hiddenPeople = Array.from(set);
    saveLiteConfig(c);
    return set.has(k);
  }

  function liteCrewProfiles() { const c = liteConfig(); return (c.crewProfiles && typeof c.crewProfiles === 'object') ? c.crewProfiles : {}; }
  function liteSaveCrewProfile(name, map) {
    const c = liteConfig(); c.crewProfiles = liteCrewProfiles(); c.crewProfiles[name] = map; saveLiteConfig(c);
  }
  function liteDeleteCrewProfile(name) {
    const c = liteConfig(); c.crewProfiles = liteCrewProfiles(); delete c.crewProfiles[name]; saveLiteConfig(c);
  }

  function liteOpenDayPlanner(day) {
    document.querySelectorAll('.cleanlite-sheet-bg').forEach(m => m.remove());
    const zones = liteZones();
    const people = litePeople();
    if (!zones.length) { toast('No zones at this location yet', 'warn'); return; }
    // Selection state: zone → Set of person ids, seeded from the day's crew.
    const sel = {};
    zones.forEach(z => { sel[z.es] = new Set(liteZonePeopleForDay(z.es, day).map(String)); });

    const dayName = LITE_DOW[day - 1];
    const profiles = liteCrewProfiles();
    const profileChips = Object.keys(profiles).map(n =>
      `<span class="cleanlite-pl-profile" data-profile="${esc(n)}">${esc(n)}<button class="cleanlite-pl-profile-x" data-del-profile="${esc(n)}" title="Delete profile">×</button></span>`).join('');

    // Hidden users tuck behind a "+N" chip per zone (still clickable when
    // revealed). A hidden person who's SELECTED stays visible — a chip you
    // can't see shouldn't be able to hold an assignment.
    const hiddenIds = liteHiddenIds();
    const nHidden = people.filter(p => hiddenIds.has(String(p.id))).length;
    const zoneBlock = (z) => `
      <div class="cleanlite-pl-zone" data-zone="${esc(z.es)}">
        <div class="cleanlite-pl-zonename">${esc(z.en)} <span class="cleanlite-pl-count" data-count="${esc(z.es)}"></span></div>
        <div class="cleanlite-pl-people">
          ${people.map(p => {
            const pid = String(p.id);
            const tucked = hiddenIds.has(pid) && !sel[z.es].has(pid);
            return `
            <button class="cleanlite-pl-chip ${sel[z.es].has(pid) ? 'is-active' : ''} ${tucked ? 'is-hidden' : ''}" data-z="${esc(z.es)}" data-pid="${esc(p.id)}">
              <span class="cleanlite-av is-sm" style="--av-hue:${liteHue(p.id)}">${esc(liteInitials(p.name))}</span>${esc((p.name || '').split(' ')[0])}
            </button>`;
          }).join('')}
          ${nHidden ? `<button class="cleanlite-pl-chip cleanlite-pl-more" data-morez>+${nHidden}</button>` : ''}
        </div>
      </div>`;

    const bg = document.createElement('div');
    bg.className = 'cleanlite-sheet-bg';
    bg.innerHTML = `
      <div class="cleanlite-sheet cleanlite-planner" role="dialog" aria-modal="true">
        <div class="cleanlite-sheet-grip"></div>
        <div class="cleanlite-sheet-title">Plan <b>${esc(dayName)}</b> · ${esc(locLabel(activeLoc))}</div>
        <div class="cleanlite-sheet-hint">Tap people onto each zone — the whole day on one screen.</div>
        ${profileChips ? `<div class="cleanlite-pl-profiles"><span class="cleanlite-pl-profiles-lbl">Profiles</span>${profileChips}</div>` : ''}
        <div class="cleanlite-pl-zones">${zones.map(zoneBlock).join('')}</div>
        <div class="cleanlite-pl-saveprofile" style="display:none">
          <input class="cleanlite-ov-input" data-profile-name placeholder="Profile name — e.g. Weekday, Mass duty" maxlength="28">
          <button class="cleanlite-sheet-save" data-profile-ok>Save profile</button>
        </div>
        <div class="cleanlite-sheet-actions cleanlite-pl-actions">
          <button class="cleanlite-sheet-clear" data-save-profile>☆ Save as profile</button>
          <button class="cleanlite-sheet-clear" data-save-week>Save Mon–Sun</button>
          <button class="cleanlite-sheet-save" data-save-day>Save ${esc(dayName)}</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add('open'));
    const close = () => { bg.classList.remove('open'); setTimeout(() => bg.remove(), 200); };
    bg.addEventListener('click', e => { if (e.target === bg) close(); });

    const paintCounts = () => zones.forEach(z => {
      const el = bg.querySelector(`[data-count="${cssEsc(z.es)}"]`);
      if (el) el.textContent = sel[z.es].size ? `· ${sel[z.es].size}` : '';
    });
    paintCounts();

    bg.querySelectorAll('.cleanlite-pl-chip:not(.cleanlite-pl-more)').forEach(btn => btn.addEventListener('click', () => {
      const s = sel[btn.dataset.z]; const pid = btn.dataset.pid;
      if (s.has(pid)) { s.delete(pid); btn.classList.remove('is-active'); }
      else { s.add(pid); btn.classList.add('is-active'); }
      paintCounts();
    }));
    // "+N" reveals the tucked-away users (sheet-wide toggle, still clickable)
    bg.querySelectorAll('[data-morez]').forEach(btn => btn.addEventListener('click', () => {
      const sheet = bg.querySelector('.cleanlite-planner');
      const on = sheet.classList.toggle('show-hidden');
      bg.querySelectorAll('[data-morez]').forEach(b => { b.textContent = on ? '− hide' : `+${nHidden}`; });
    }));

    // Apply a profile → refill every zone's selection in one tap.
    bg.querySelectorAll('[data-profile]').forEach(chip => chip.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-profile]')) return;
      const map = liteCrewProfiles()[chip.dataset.profile] || {};
      zones.forEach(z => {
        sel[z.es] = new Set((map[z.es] || []).map(String));
        bg.querySelectorAll(`.cleanlite-pl-chip[data-z="${cssEsc(z.es)}"]`).forEach(b =>
          b.classList.toggle('is-active', sel[z.es].has(b.dataset.pid)));
      });
      paintCounts();
      toast(`Profile "${chip.dataset.profile}" loaded — save it to a day or the week`, 'info');
    }));
    bg.querySelectorAll('[data-del-profile]').forEach(x => x.addEventListener('click', (e) => {
      e.stopPropagation();
      liteDeleteCrewProfile(x.dataset.delProfile);
      const chip = x.closest('.cleanlite-pl-profile'); if (chip) chip.remove();
      toast('Profile deleted', 'success');
    }));

    const saveTo = async (days, label) => {
      close();
      toast(`Writing ${label}…`, 'info');
      for (const z of zones) await liteAssignZone(z.es, Array.from(sel[z.es]), days);
      render();
      toast(`Crew saved — ${label}`, 'success');
    };
    bg.querySelector('[data-save-day]').addEventListener('click', () => saveTo([day], dayName));
    bg.querySelector('[data-save-week]').addEventListener('click', () => saveTo([1,2,3,4,5,6,7], 'every day'));

    // Save-as-profile: inline name field (no window.prompt).
    bg.querySelector('[data-save-profile]').addEventListener('click', () => {
      const row = bg.querySelector('.cleanlite-pl-saveprofile');
      row.style.display = row.style.display === 'none' ? 'flex' : 'none';
      if (row.style.display !== 'none') row.querySelector('[data-profile-name]').focus();
    });
    bg.querySelector('[data-profile-ok]').addEventListener('click', () => {
      const inp = bg.querySelector('[data-profile-name]');
      const name = (inp.value || '').trim();
      if (!name) { inp.focus(); return; }
      const map = {};
      zones.forEach(z => { if (sel[z.es].size) map[z.es] = Array.from(sel[z.es]); });
      liteSaveCrewProfile(name, map);
      toast(`Profile "${name}" saved — it'll be one tap next time`, 'success');
      bg.querySelector('.cleanlite-pl-saveprofile').style.display = 'none';
    });
  }

  // Add one person to a zone's existing crew (used by the new-employee flows).
  async function liteAppendZonePerson(sectionEs, pid) {
    const cur = liteZonePeople(sectionEs);
    const ids = cur === '__varies__' ? [] : cur.map(String);
    if (!ids.includes(String(pid))) ids.push(String(pid));
    await liteAssignZone(sectionEs, ids);
  }

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
        if (created) { await liteAppendZonePerson(sectionEs, created.id); }
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
    await liteAppendZonePerson(sectionEs, id);
    render();
    toast(`${name} added (schedule only)`, 'success');
  }

  // ─── Tap-to-complete ─────────────────────────────────────────────────────
  async function liteToggleTask(t, rowEl) {
    // Shift-day guard: a phone parked on this screen across the 8am rollover
    // (or overnight) must not keep writing to yesterday. Re-derive the date;
    // if it moved, reload today's state and repaint instead of toggling.
    const liveDay = getCleaningDate();
    if (liveDay !== today) {
      today = liveDay;
      await loadTodayState();
      render();
      toast('New shift day — checklist refreshed', 'info', 2200);
      return;
    }
    // Photo-required gate (v18.37): the flagged task needs proof before it
    // can be checked off. Cancelling the picker cancels the completion.
    const turningOn = !getDoneState(t.section_es, t.task_order);
    if (turningOn && t.photo_required && !photoTakenToday(t)) {
      const ok = await capturePhotoForTask(t);
      if (!ok) { toast('Photo required to complete this task', 'warn', 2400); return; }
    }
    setDoneState(t.section_es, t.task_order, turningOn);
    // Keep the identity-based freshness map in step with the optimistic UI.
    if (turningOn) {
      lastDoneByTaskId[t.id] = { date: today, by: getUserName() };
    } else {
      const k = t.section_es + '_' + t.task_order;
      if (lastDoneByTaskId[t.id] && lastDoneByTaskId[t.id].date === today) delete lastDoneByTaskId[t.id];
      if (lastDoneByKey[k] && lastDoneByKey[k].date === today) delete lastDoneByKey[k];
    }
    if (rowEl) rowEl.classList.toggle('is-done', turningOn);
    liteUpdateZonePill(t.section_es);
    await persistDone(t.section_es, t.task_order, turningOn, t.id);
  }

  // Has this task had a photo attached today? loadAttachments only pulls
  // rows for the current shift day, so presence in the map = taken today.
  function photoTakenToday(t) {
    return (attachmentsByKey[t.section_es + '_' + t.task_order] || []).length > 0;
  }
  // Open the camera/picker for a specific task; resolve true once uploaded.
  function capturePhotoForTask(t) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
      input.style.display = 'none';
      document.body.appendChild(input);
      let settled = false;
      const finish = (val) => { if (!settled) { settled = true; input.remove(); resolve(val); } };
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) { finish(false); return; }
        try {
          const url = await uploadCleaningPhoto(f, t);
          finish(!!url);
        } catch (_) { finish(false); }
      });
      // Cancelled pickers fire no event — sweep up when focus returns.
      window.addEventListener('focus', () => setTimeout(() => finish(false), 1200), { once: true });
      input.click();
    });
  }
  // Upload + record an attachment for a task (identity + positional keys).
  async function uploadCleaningPhoto(f, t) {
    if (!NX.sb || !f) return null;
    if (f.size > 12 * 1024 * 1024) { toast('Photo too large (12MB max)', 'warn'); return null; }
    const path = `cleaning/${activeLoc}/${today}/${Date.now()}_${(f.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: upErr } = await NX.sb.storage.from('nexus-files').upload(path, f, { contentType: f.type || 'image/jpeg' });
    if (upErr) { toast('Upload failed', 'error'); return null; }
    const { data: urlData } = NX.sb.storage.from('nexus-files').getPublicUrl(path);
    const url = urlData && urlData.publicUrl;
    if (!url) return null;
    const { error } = await NX.sb.from('cleaning_attachments').insert({
      location: activeLoc, log_date: today, section: t.section_es, task_index: t.task_order,
      task_id: t.id, file_url: url, mime_type: f.type || null, file_size: f.size || null,
      uploaded_by: getUserName(), uploaded_by_id: getCurrentUserId(),
    });
    if (error) {
      // Pre-migration tolerance for the new task_id column.
      const { error: e2 } = await NX.sb.from('cleaning_attachments').insert({
        location: activeLoc, log_date: today, section: t.section_es, task_index: t.task_order,
        file_url: url, mime_type: f.type || null, file_size: f.size || null,
        uploaded_by: getUserName(), uploaded_by_id: getCurrentUserId(),
      });
      if (e2) { toast('Photo saved but not recorded', 'warn'); return url; }
    }
    const k = t.section_es + '_' + t.task_order;
    attachmentsByKey[k] = attachmentsByKey[k] || [];
    attachmentsByKey[k].push({ log_date: today, file_url: url });
    toast('Photo attached', 'success', 1600);
    return url;
  }
  // AM/PM shift filter for the daily checklist. Tasks carry an optional
  // shift_pattern ('am' | 'pm' | anything else = both); untagged tasks show
  // in every shift. Defaults to the shift we're currently in (3pm boundary).
  let liteShift = (new Date().getHours() < 15) ? 'am' : 'pm';
  function liteShiftMatch(t) {
    if (liteShift === 'all') return true;
    const p = (t.shift_pattern || '').toLowerCase();
    if (p !== 'am' && p !== 'pm') return true;   // untagged → both shifts
    return p === liteShift;
  }
  function liteZoneCounts(sectionEs) {
    const z = liteZones().find(z => z.es === sectionEs);
    let done = 0, total = 0;
    (z ? z.tasks : []).forEach(t => {
      if (DAILY_TYPES.has(t.frequency_type) && liteShiftMatch(t)) {
        total++;
        if (getDoneState(t.section_es, t.task_order)) done++;
      }
    });
    return { done, total };
  }
  // Overdue periodic tasks at the active location — powers the header chip.
  function liteOverdueCount() {
    let n = 0;
    (tasksByLoc[activeLoc] || []).forEach(t => {
      if (t.archived || DAILY_TYPES.has(t.frequency_type)) return;
      const next = periodicNextDue(t);
      if (!periodicLastDone(t) || (next && next < today)) n++;
    });
    return n;
  }
  // Seven mini bars + streak — the "how did this week actually go" signal.
  function liteWeekStripHTML() {
    if (!weekStats || !weekStats.days) return '';
    const bars = weekStats.days.map(d => {
      const cls = d.pct >= 80 ? 'is-good' : d.pct >= 40 ? 'is-mid' : 'is-low';
      const dow = LITE_DOW[new Date(d.date + 'T12:00:00').getDay()][0];
      return `<div class="cleanlite-wk-day" title="${esc(d.date)} · ${d.done}/${weekStats.expected} (${d.pct}%)">
        <div class="cleanlite-wk-bar"><div class="cleanlite-wk-fill ${cls}" style="height:${Math.max(6, d.pct)}%"></div></div>
        <span class="cleanlite-wk-lbl">${dow}</span>
      </div>`;
    }).join('');
    const streak = weekStats.streak > 1
      ? `<span class="cleanlite-wk-streak" title="Consecutive days at 80%+">🔥 ${weekStats.streak}</span>` : '';
    // v260 — renamed from .cleanlite-week: that class doubles as a pill-
    // button style elsewhere in nexus-rm.css, so the strip inherited
    // padding/cursor it never asked for.
    return `<div class="cleanlite-weekstrip">${bars}${streak}</div>`;
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
        const pids = Array.isArray(map[section]) ? map[section] : [map[section]];
        for (const pid of pids) {
          if (!usersList.some(u => String(u.id) === String(pid))) continue; // real users only
          const r = await autofillAssignmentsForUser(pid, [d], 'both', [section]);
          if (r && r.count) count += r.count;
        }
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
    for (let d = 1; d <= 7; d++) cfg.dayCrew[d] = JSON.parse(JSON.stringify(src));
    saveLiteConfig(cfg);
    render();
    toast(`${LITE_DOW[liteDay - 1]}'s crew copied to every day`, 'success');
  }

  // ─── Autofill the next two weeks ─────────────────────────────────────────
  // One tap fills every EMPTY day/zone slot from the zone's known crew:
  // the selected day's crew if set, else the first day that has people.
  // Already-assigned days are never overwritten. The schedule is weekly-
  // recurring, so a filled week covers the next two weeks (and beyond).
  async function liteAutofillTwoWeeks() {
    const zones = liteZones();
    let filledSlots = 0, skippedZones = [];
    toast('Autofilling schedule…', 'info');
    for (const z of zones) {
      // Reference crew: prefer the day being viewed, else first assigned day.
      let ref = (liteDay !== 'all') ? liteZonePeopleForDay(z.es, liteDay) : [];
      if (!ref.length) {
        for (let d = 1; d <= 7 && !ref.length; d++) ref = liteZonePeopleForDay(z.es, d);
      }
      if (!ref.length) {
        const p = liteProfilePerson(z.es);
        if (p != null) ref = [String(p)];
      }
      if (!ref.length) { skippedZones.push(z.en); continue; }
      const emptyDays = [];
      for (let d = 1; d <= 7; d++) {
        if (!liteZonePeopleForDay(z.es, d).length) emptyDays.push(d);
      }
      if (!emptyDays.length) continue;
      await liteAssignZone(z.es, ref, emptyDays);
      filledSlots += emptyDays.length;
    }
    render();
    if (filledSlots) {
      toast(`Autofilled ${filledSlots} day-slot${filledSlots === 1 ? '' : 's'} — repeats weekly, so the next two weeks are covered${skippedZones.length ? ` (skipped ${skippedZones.join(', ')} — no one assigned yet)` : ''}`, 'success');
    } else if (skippedZones.length === zones.length) {
      toast('Assign at least one person to a zone first, then autofill', 'info');
    } else {
      toast('Nothing to fill — every zone already has crew all week', 'success');
    }
  }

  // ─── Print week (clean grid + QR) and .xlsx ──────────────────────────────
  // One location's schedule table (zone · task · Mon–Sun crew). Location-
  // specific tasks; crew comes from the global section-keyed config.
  function cleanPrintTableHtml(loc) {
    const zones = tasksBySection(loc).map(g => ({ es: g.section_es, en: g.section_en || g.section_es, tasks: g.tasks }));
    const nameFor = (section, d) => {
      const v = liteZonePeople(section, d);
      if (v === '__varies__') return '';
      return v.map(litePersonName).filter(Boolean).join(', ');
    };
    // Weekly print sheet — put the week's real dates in the headers.
    const weekDates = currentWeekDates();
    const dayHead = LITE_DOW.map((d, i) =>
      `<th>${d} ${weekDates[i].getMonth() + 1}/${weekDates[i].getDate()}</th>`).join('');
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
  function periodicLastDone(t) { const h = lastDoneFor(t); return h ? h.date : null; }
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
    if (!NX.sb) return false;
    // supabase-js RESOLVES with {error} — the old try/catch never fired,
    // so a rejected insert (scope CHECK) still toasted "Assigned".
    try {
      const { error: delErr } = await NX.sb.from('cleaning_task_assignments')
        .delete().eq('task_id', taskId).eq('scope', 'periodic');
      if (delErr) { console.warn('[cleanlite] savePeriodicAssignees delete:', delErr); toast('Could not save: ' + delErr.message, 'error'); return false; }
      if (userIds.length) {
        const { error: insErr } = await NX.sb.from('cleaning_task_assignments')
          .insert(userIds.map(uid => ({ task_id: taskId, user_id: uid, scope: 'periodic', day_of_week: null, shift: null, year_month: null })));
        if (insErr) { console.warn('[cleanlite] savePeriodicAssignees insert:', insErr); toast('Could not save: ' + insErr.message, 'error'); return false; }
      }
      toast('Assigned', 'success');
      return true;
    } catch (e) { console.warn('[cleanlite] savePeriodicAssignees:', e); toast('Could not save', 'error'); return false; }
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
      <label class="cleanlite-ov-lbl" style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0">
        <input type="checkbox" data-f="photoreq" ${t && t.photo_required ? 'checked' : ''} style="width:16px;height:16px">
        Photo required to complete
      </label>
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
      const photoRequired = !!(ov.querySelector('[data-f="photoreq"]') || {}).checked;
      if (!name) { toast('Name required', 'warn'); return; }
      ov.remove();
      await litePeriodicSave({ t, isNew, sec, secEn, name, freq, last, photoRequired });
    });
  }

  async function litePeriodicSave(o) {
    if (!NX.sb) return;
    const def = FREQ_BY_TYPE[o.freq] || FREQ_BY_TYPE.monthly;
    try {
      let taskOrder = o.t ? o.t.task_order : null;
      let taskId = o.t ? o.t.id : null;
      const photoReq = !!o.photoRequired;
      if (o.isNew) {
        const inSec = (tasksByLoc[activeLoc] || []).filter(x => x.section_es === o.sec);
        taskOrder = inSec.reduce((m, x) => Math.max(m, x.task_order || 0), -1) + 1;
        const secOrder = inSec.length ? inSec[0].section_order : ((tasksByLoc[activeLoc] || []).reduce((m, x) => Math.max(m, x.section_order || 0), -1) + 1);
        const { data: ins, error } = await NX.sb.from('cleaning_tasks').insert({
          location: activeLoc, section_es: o.sec, section_en: o.secEn, section_order: secOrder, task_order: taskOrder,
          name_es: o.name, name_en: o.name, frequency_type: o.freq, frequency_days: def.days,
          photo_required: photoReq,
        }).select('id').single();
        if (error) throw error;
        taskId = ins && ins.id;
      } else {
        const { error } = await NX.sb.from('cleaning_tasks').update({
          name_es: o.name, name_en: o.name, frequency_type: o.freq, frequency_days: def.days,
          photo_required: photoReq,
        }).eq('id', o.t.id);
        if (error) throw error;
      }
      if (o.last) {
        const { error: le } = await NX.sb.from('cleaning_logs').upsert({
          location: activeLoc, log_date: o.last, section: o.sec, task_index: taskOrder, task_id: taskId || null, done: true,
          completed_by: getUserName(), completed_by_id: getCurrentUserId(),
          completed_at: new Date(o.last + 'T12:00:00').toISOString(),
        }, { onConflict: 'location,log_date,task_index,section' });
        if (le) console.warn('[cleanlite] anchor log:', le);
      }
      toast('Saved', 'success');
      // ASSIGN the reload — loadTasksForLocation RETURNS rows, it doesn't
      // mutate tasksByLoc. The old code discarded the result, so the UI
      // showed stale data until the user left and re-entered the view.
      tasksByLoc[activeLoc] = await loadTasksForLocation(activeLoc);
      await loadHistory(); await loadAssignments();
      render();
    } catch (e) { console.warn('[cleanlite] periodicSave:', e); toast('Could not save', 'error'); }
  }

  async function litePeriodicDelete(t) {
    if (!t || !NX.sb) return;
    if (!NX.isManager && !NX.isAdmin) { toast('Manager only — ask a manager to delete tasks', 'warn'); return; }
    if (!confirm('Delete this periodic task?')) return;
    try {
      const { error } = await NX.sb.from('cleaning_tasks').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', t.id);
      if (error) throw error;
      toast('Deleted', 'success');
      tasksByLoc[activeLoc] = await loadTasksForLocation(activeLoc);
      render();
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
        tasksByLoc[activeLoc] = await loadTasksForLocation(activeLoc);
        render();
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
    // Daily zone cards only make sense for zones that have at least one DAILY
    // task. Zones whose tasks are all periodic (e.g. "Every 2 weeks", "Every
    // month", "Garden") rendered as empty "No tasks in this zone" cards up top
    // even though their work already lives in "Periodic & deep cleans" below —
    // pure clutter. Drop them from the daily list (they still surface in the
    // periodic group via renderPeriodicGroup).
    const zones = liteZones().filter(z => z.tasks.some(t => DAILY_TYPES.has(t.frequency_type)));
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

    // v260 — the AM/PM default could hide EVERY task (open at 4pm with an
    // all-AM catalog → "0/0", "No tasks in this zone" everywhere). If the
    // current shift filter yields nothing but 'all' would, fall back.
    if (liteShift !== 'all') {
      const anyNow = zones.some(z => z.tasks.some(t => DAILY_TYPES.has(t.frequency_type) && liteShiftMatch(t)));
      const anyEver = zones.some(z => z.tasks.some(t => DAILY_TYPES.has(t.frequency_type)));
      if (!anyNow && anyEver) liteShift = 'all';
    }
    // TODAY mode always shows today's crew on the zone cards; the liteDay
    // scope belongs to CREW mode (scheduling other days).
    const crewScope = liteMode === 'today' ? todayDow : liteDay;
    const showTasks = liteMode === 'today';

    const zoneCards = zones.map(z => {
      const ppl = liteZonePeople(z.es, crewScope);
      const varies = ppl === '__varies__';
      const crew = varies ? [] : ppl;
      const crewNames = crew.map(litePersonName).filter(Boolean);
      const nm = varies ? 'Varies'
        : (crewNames.length === 0 ? null
          : crewNames.length <= 2 ? crewNames.join(' + ')
          : crewNames.slice(0, 2).join(', ') + ' +' + (crewNames.length - 2));
      const avStack = varies ? '<span class="cleanlite-av is-varies">~</span>'
        : (crew.length ? crew.slice(0, 3).map(pid =>
            `<span class="cleanlite-av" style="--av-hue:${liteHue(pid)}">${esc(liteInitials(litePersonName(pid) || '?'))}</span>`).join('')
          : `<span class="cleanlite-av is-none">${svg('user', 14)}</span>`);
      const note = liteZoneNoteText(z.es);
      const { done, total } = liteZoneCounts(z.es);
      // Daily zone cards show DAILY tasks only — periodic (biweekly+) tasks
      // live in their own "Periodic & deep cleans" group below (no dupes).
      // Rows respect the AM/PM shift filter; done rows show who checked
      // them off (accountability visible right on the list).
      const taskRows = !showTasks ? '' : z.tasks.filter(t => DAILY_TYPES.has(t.frequency_type) && liteShiftMatch(t)).map(t => {
        const st = todayStateByKey[t.section_es + '_' + t.task_order];
        const isDone = !!(st && st.done);
        const by = isDone && st.by ? `<span class="cleanlite-task-by">${esc(st.by.split(' ')[0])}</span>` : '';
        const cam = t.photo_required ? `<span class="cleanlite-task-cam" title="Photo required">📷</span>` : '';
        return `<button class="cleanlite-task ${isDone ? 'is-done' : ''}" data-task-id="${esc(t.id)}">
          <span class="cleanlite-check">${svg('check', 13)}</span>
          <span class="cleanlite-task-name">${esc(t.name_en || t.name_es || '')}</span>
          ${cam}${by}
        </button>`;
      }).join('');
      return `<div class="cleanlite-zone" data-zone="${esc(z.es)}">
        <div class="cleanlite-zone-head">
          <button class="cleanlite-person-btn" data-pick-zone="${esc(z.es)}" title="Set who works this zone on ${esc(scopeLabel)}">
            ${avStack}
          </button>
          <div class="cleanlite-zone-titles"><div class="cleanlite-zone-name">${esc(z.en)}</div><div class="cleanlite-zone-person">${nm ? esc(nm) : 'Tap to assign'}</div></div>
          <span class="cleanlite-zone-count ${total > 0 && done === total ? 'is-complete' : ''}">${done}/${total}</span>
          <button class="cleanlite-guide" data-guide-zone="${esc(z.es)}" title="Training guide">${svg('book', 15)}</button>
          <button class="cleanlite-guide cleanlite-kebab" data-zone-menu="${esc(z.es)}" title="More — swap, note, history, photo">⋮</button>
        </div>
        ${note ? `<div class="cleanlite-zone-noterow">${svg('pen', 11)}<span>${esc(note)}</span></div>` : ''}
        ${showTasks ? `<div class="cleanlite-tasks">${taskRows || '<div class="cleanlite-empty">No tasks in this zone.</div>'}</div>` : ''}
      </div>`;
    }).join('');

    const overdueN = liteOverdueCount();
    const shiftSeg = `<div class="cleanlite-shift" role="tablist" aria-label="Shift">
        ${['am', 'pm', 'all'].map(s => `<button class="cleanlite-shift-btn ${liteShift === s ? 'is-active' : ''}" data-shift="${s}">${s === 'all' ? 'All' : s.toUpperCase()}</button>`).join('')}
      </div>`;
    // v260 — one screen, two jobs, cleanly split:
    //   TODAY: the checklist (week strip, overdue chip, shift, zones with
    //          tasks, periodic group) + Summary.
    //   CREW:  the planner (day pills, copy, autofill, assignment-focused
    //          zone cards) + Apply / Print / All / Excel.
    const modeSeg = `<div class="cleanlite-mode" role="tablist" aria-label="Cleaning mode">
        <button class="cleanlite-mode-btn ${liteMode === 'today' ? 'is-active' : ''}" data-mode="today">Today</button>
        <button class="cleanlite-mode-btn ${liteMode === 'crew' ? 'is-active' : ''}" data-mode="crew">Crew</button>
      </div>`;
    const todayBlocks = `
      ${liteWeekStripHTML()}
      ${overdueN ? `<button class="cleanlite-overdue" data-goto-periodic>✦ ${overdueN} deep-clean${overdueN === 1 ? '' : 's'} overdue — tap to review</button>` : ''}
      <div class="cleanlite-dayrow">
        <span class="cleanlite-dayrow-label">Shift</span>
        ${shiftSeg}
      </div>`;
    const crewBlocks = `
      <div class="cleanlite-dayrow">
        <span class="cleanlite-dayrow-label">Crew · ${esc(scopeLabel)}</span>
        <div class="cleanlite-days">${dayPills}</div>
      </div>
      <div class="cleanlite-dayrow">
        <button class="cleanlite-mini is-accent" data-plan title="Plan the whole day on one screen — every zone, every person, plus saved profiles">📋 Plan ${liteDay === 'all' ? esc(LITE_DOW[todayDow - 1]) : esc(LITE_DOW[liteDay - 1])}</button>
        ${liteDay !== 'all' ? `<button class="cleanlite-mini" data-copy-all title="Copy this day's crew to every day">${svg('calendar', 12)} → all days</button>` : ''}
        <button class="cleanlite-mini" data-autofill title="Fill every empty day for every zone from its current crew — covers the next two weeks">⚡ Autofill 2 wks</button>
      </div>`;
    const ctas = liteMode === 'today'
      ? `<button class="cleanlite-cta" data-summary title="Email a cleaning summary or send it to the Daily Log">${svg('mail', 15)} Summary</button>`
      : `<button class="cleanlite-cta" data-apply title="Write the whole week's crew to the live duties">${svg('calendar', 15)} Apply</button>
         <button class="cleanlite-cta is-ghost" data-print title="Printable weekly schedule — this location">${svg('document', 15)} Print</button>
         <button class="cleanlite-cta is-ghost" data-print-all title="Print every location in one go">${svg('document', 15)} All</button>
         <button class="cleanlite-cta is-ghost" data-excel title="Weekly Excel — full schedule or one person's tasks">${svg('document', 15)} Excel</button>`;
    wrap.innerHTML = `
      <div class="cleanlite-top">
        <div class="cleanlite-loc-picker">${locPills}</div>
        ${modeSeg}
      </div>
      <div class="cleanlite-eqdown" id="cleanliteEqDown" style="display:none"></div>
      ${liteMode === 'today' ? todayBlocks : crewBlocks}
      <div class="cleanlite-zones">${zoneCards || '<div class="cleanlite-empty">No zones yet — add tasks for this location first.</div>'}</div>
      ${liteMode === 'today' ? renderPeriodicGroup() : ''}
      <div class="cleanlite-cta-wrap">${ctas}</div>`;

    // ── Clippy's counsel (v279): cleaning and equipment finally talk.
    // "When a piece of equipment goes down, the cleaning checklist still
    // cheerfully asks the team to clean it." If any unit at THIS house is
    // down/broken/needs service, say so at the top of the checklist so
    // nobody scrubs a machine that shouldn't be touched. Async fill,
    // best-effort — the checklist never waits on it.
    (async () => {
      try {
        const el = wrap.querySelector('#cleanliteEqDown');
        if (!el || !NX.sb) return;
        const { data } = await NX.sb.from('equipment')
          .select('name, location, status, status_note')
          .in('status', ['down', 'broken', 'needs_service'])
          .eq('is_deleted', false).limit(20);
        const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
        const here = (data || []).filter(e => {
          const l = norm(e.location);
          return l && (l.includes(norm(activeLoc)) || norm(activeLoc).includes(l));
        });
        if (!here.length) return;
        el.style.display = '';
        el.innerHTML = `⚠️ <b>Don't clean these — not running:</b> ` +
          here.map(e => `${esc(e.name)} <span class="cleanlite-eqdown-st">(${esc(e.status.replace('_', ' '))}${e.status_note ? ' — ' + esc(String(e.status_note).slice(0, 40)) : ''})</span>`).join(' · ');
      } catch (_) {}
    })();

    // wiring
    wrap.querySelectorAll('[data-loc]').forEach(b => b.addEventListener('click', () => liteSwitchLoc(b.dataset.loc)));
    wrap.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.day; liteDay = v === 'all' ? 'all' : parseInt(v, 10); render();
    }));
    const planBtn = wrap.querySelector('[data-plan]');
    if (planBtn) planBtn.addEventListener('click', () => liteOpenDayPlanner(liteDay === 'all' ? todayDayOfWeek() : liteDay));
    const copyAll = wrap.querySelector('[data-copy-all]'); if (copyAll) copyAll.addEventListener('click', liteCopyDayToAll);
    const autoBtn = wrap.querySelector('[data-autofill]'); if (autoBtn) autoBtn.addEventListener('click', liteAutofillTwoWeeks);
    wrap.querySelectorAll('[data-shift]').forEach(b => b.addEventListener('click', () => { liteShift = b.dataset.shift; render(); }));
    const odBtn = wrap.querySelector('[data-goto-periodic]');
    if (odBtn) odBtn.addEventListener('click', () => {
      const p = document.querySelector('.cleanlite-periodic');
      if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    wrap.querySelectorAll('[data-pick-zone]').forEach(b => b.addEventListener('click', () => liteOpenPersonPicker(b.dataset.pickZone)));
    wrap.querySelectorAll('[data-guide-zone]').forEach(b => b.addEventListener('click', () => liteOpenZoneGuide(b.dataset.guideZone)));
    wrap.querySelectorAll('[data-zone-menu]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); liteOpenZoneMenu(b.dataset.zoneMenu, b); }));
    wrap.querySelectorAll('.cleanlite-task').forEach(b => b.addEventListener('click', () => {
      const z = liteZones().find(z => z.tasks.some(t => String(t.id) === b.dataset.taskId));
      const t = z && z.tasks.find(t => String(t.id) === b.dataset.taskId);
      if (t) liteToggleTask(t, b);
    }));
    wrap.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      liteMode = b.dataset.mode;
      try { localStorage.setItem('nexus_cleaning_mode', liteMode); } catch (_) {}
      render();
    }));
    { const ap = wrap.querySelector('[data-apply]'); if (ap) ap.addEventListener('click', liteApplySchedule); }
    { const pr = wrap.querySelector('[data-print]'); if (pr) pr.addEventListener('click', litePrintWeek); }
    { const pAll = wrap.querySelector('[data-print-all]'); if (pAll) pAll.addEventListener('click', litePrintAll); }
    const sumBtn = wrap.querySelector('[data-summary]'); if (sumBtn) sumBtn.addEventListener('click', () => liteOpenSummary(activeLoc));
    const xlBtn = wrap.querySelector('[data-excel]'); if (xlBtn) xlBtn.addEventListener('click', () => openCardExportMenu(xlBtn, activeLoc));
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
