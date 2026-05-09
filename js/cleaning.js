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

  // ─── HELPERS: state get/set ───────────────────────────────────────────
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

  // ═══ RENDER LAYER ═══════════════════════════════════════════════════════
  // Card-based design borrowed wholesale from the ordering catalog editor:
  //   • Each section is a card with a gold-line border + rounded corners
  //   • Card head shows: name (bilingual), task count, freshness chip,
  //     overall progress, expand/collapse chevron
  //   • Expand reveals: task rows, "+ Add task" button, optional "→ On board"
  //   • Each task row: checkbox + bilingual name + freshness mini-bar +
  //     assignee chip + days-of-week pills (when relevant) + edit pencil
  //   • Tap edit pencil → inline form (same ord-vitem-editing pattern)

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

    // Render every section card
    groups.forEach(group => {
      list.appendChild(renderSectionCard(group));
    });

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

    row.innerHTML = `
      <button class="clean-task-check" aria-label="Mark done" data-toggle-done>
        ${done ? svg('check', 14, 2.5) : ''}
      </button>
      <div class="clean-task-body">
        <div class="clean-task-name">${esc(primary)}</div>
        <div class="clean-task-meta">
          ${secondary && secondary !== primary ? `<span class="clean-task-secondary">${esc(secondary)}</span>` : ''}
          ${freqHTML}
          ${daysHTML}
          ${assigneeHTML}
        </div>
        ${freshHTML}
      </div>
      <button class="clean-task-edit" aria-label="Edit task" data-edit-task>
        ${svg('pen', 14, 2)}
      </button>
    `;

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
        await loadLinkedCards();
        render();
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
    await loadLinkedCards();

    // Register with NX.archive
    registerArchiveContributor();

    render();
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
    await loadLinkedCards();
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
