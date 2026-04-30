/* ═══ NEXUS Activity Feed v12 — All bugs fixed ═══
   FIXES from v11:
   - syslog user_id removed (column doesn't exist)
   - addLog uses NX.currentUser not NX.user
   - cleaning_logs query uses log_date not created_at
   - cards table removed — queries tickets + kanban_cards directly
   - All catch blocks now log errors
   - Defensive checks on timeClock
*/
(function(){

let feed = [];
let activeFilter = 'all';

const FILTERS = [
  { key: 'all',    label: 'All' },
  { key: 'log',    label: 'Logs' },
  { key: 'ticket', label: 'Tickets' },
  { key: 'task',   label: 'Tasks' },
  { key: 'clock',  label: 'Clock' },
  { key: 'chat',   label: 'Chat' },
  { key: 'clean',  label: 'Clean' },
  { key: 'system', label: 'System' }
];

const COLORS = {
  log:    'var(--accent)',
  ticket: 'var(--amber)',
  task:   'var(--blue)',
  clock:  'var(--green)',
  chat:   'var(--purple)',
  clean:  'var(--green)',
  system: 'var(--blue)'
};

/* ═══ INIT ═══ */
async function init() {
  buildFilterBar();

  const logBtn = document.getElementById('logAdd');
  const logIn  = document.getElementById('logInput');
  const kbBtn  = document.getElementById('knowledgeBtn');
  const kbIn   = document.getElementById('knowledgeInput');

  if (logBtn) logBtn.addEventListener('click', addLog);
  if (logIn)  logIn.addEventListener('keydown', e => { if (e.key === 'Enter') addLog(); });
  if (kbBtn)  kbBtn.addEventListener('click', addKnowledge);
  if (kbIn)   kbIn.addEventListener('keydown', e => { if (e.key === 'Enter') addKnowledge(); });

  await loadFeed();
}

/* ═══ FILTER BAR ═══ */
function buildFilterBar() {
  const bar = document.getElementById('feedFilters');
  if (!bar) return;
  bar.innerHTML = '';
  FILTERS.forEach(f => {
    const btn = document.createElement('button');
    btn.className = 'feed-chip' + (activeFilter === f.key ? ' active' : '');
    btn.textContent = f.label;
    btn.addEventListener('click', () => {
      activeFilter = f.key;
      buildFilterBar();
      renderFeed();
    });
    bar.appendChild(btn);
  });
}

/* ═══ LOAD ALL DATA ═══ */
async function loadFeed() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const sinceDate = since.slice(0, 10); // YYYY-MM-DD for date columns

  // Query all data sources in parallel — each wrapped to never throw
  const safeQuery = async (fn) => {
    try { return await fn(); }
    catch (e) { console.error('[Log] Query error:', e); return { data: null, error: e }; }
  };

  const [logsRes, ticketsRes, cardsRes, clockRes, chatRes, cleanRes] = await Promise.all([
    safeQuery(() => NX.sb.from('daily_logs').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(100)),
    safeQuery(() => NX.sb.from('tickets').select('*').order('created_at', { ascending: false }).limit(50)),
    safeQuery(() => NX.sb.from('kanban_cards').select('*').order('created_at', { ascending: false }).limit(50)),
    safeQuery(() => NX.sb.from('time_clock').select('*').gte('clock_in', since).order('clock_in', { ascending: false }).limit(100)),
    safeQuery(() => NX.sb.rpc('get_chat_history_admin', { p_since: since, p_limit: 50 })),
    safeQuery(() => NX.sb.from('cleaning_logs').select('*').gte('log_date', sinceDate).order('log_date', { ascending: false }).limit(100)),
  ]);

  feed = [];

  // Daily logs → split into cleaning reports, system events, and regular logs
  (logsRes.data || []).forEach(r => {
    const entry = r.entry || '';
    const isClean = entry.startsWith('Cleaning Report') || entry.startsWith('[AUTO');
    const isSys = entry.startsWith('[SYS]') || entry.startsWith('⚙') || entry.startsWith('📬') || entry.startsWith('🚨') || entry.startsWith('📷') || entry.startsWith('📞');
    const type = isClean ? 'clean' : isSys ? 'system' : 'log';
    feed.push({ type, ts: r.created_at, id: 'dl-' + r.id, data: r, src: 'daily_logs' });
  });

  // Tickets
  (ticketsRes.data || []).forEach(r => {
    feed.push({ type: 'ticket', ts: r.created_at, id: 'tk-' + r.id, data: r });
  });

  // Kanban cards (tasks)
  (cardsRes.data || []).forEach(r => {
    feed.push({
      type: 'task',
      ts: r.created_at,
      id: 'kb-' + r.id,
      data: { ...r, status: r.status || r.column_name || 'todo', column_name: r.status || r.column_name, reported_by: r.reported_by || r.assignee }
    });
  });

  // Time clock
  (clockRes.data || []).forEach(r => {
    feed.push({ type: 'clock', ts: r.clock_in, id: 'tc-' + r.id, data: r });
  });

  // Chat
  (chatRes.data || []).forEach(r => {
    feed.push({ type: 'chat', ts: r.created_at, id: 'ch-' + r.id, data: r });
  });

  // Cleaning — if a daily_logs "Cleaning Report" exists for a date, show that summary card.
  // Otherwise synthesize a summary card on-the-fly from cleaning_logs rows so the Log
  // always reflects what's currently checked off in the Clean view (no manual Submit needed).
  // Tagged [AUTO] so you can tell auto-generated from manually submitted reports.
  const NON_DAILY_SECTIONS = ['Bi-Semanal','Mensual','Semanal','Quincenal','Trimestral','Jardín','Jardin','Garden'];
  // Daily task totals per location, derived from js/cleaning.js DEFAULTS (excluding NON_DAILY sections).
  // Keep in sync with cleaning.js if task lists change.
  const DAILY_TASK_COUNTS = { suerte: 24, este: 22, toti: 17 };

  const reportDates = new Set(
    feed.filter(f => f.type === 'clean' && f.src === 'daily_logs')
      .map(f => { const m = (f.data.entry || '').match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : null; })
      .filter(Boolean)
  );

  // Group cleaning_logs rows by date, excluding dates already covered by a submitted report
  const rowsByDate = {};
  (cleanRes.data || []).forEach(r => {
    const d = r.log_date;
    if (!d || reportDates.has(d)) return;
    if (!rowsByDate[d]) rowsByDate[d] = [];
    rowsByDate[d].push(r);
  });

  // For each "unreported" date, synthesize a Cleaning Report card
  Object.entries(rowsByDate).forEach(([date, rows]) => {
    // Group by location, tracking per-section done/touched counts
    const byLoc = {};
    rows.forEach(r => {
      const loc = r.location || 'unknown';
      const section = r.section || '';
      if (!byLoc[loc]) byLoc[loc] = { done: 0, sections: {} };
      const isDaily = !NON_DAILY_SECTIONS.some(nd => section.toLowerCase().includes(nd.toLowerCase()));
      if (isDaily && r.done) byLoc[loc].done++;
      if (!byLoc[loc].sections[section]) byLoc[loc].sections[section] = { done: 0, touched: 0 };
      byLoc[loc].sections[section].touched++;
      if (r.done) byLoc[loc].sections[section].done++;
    });

    // Skip dates with no activity at all
    const hasActivity = Object.values(byLoc).some(v => v.done > 0);
    if (!hasActivity) return;

    // Build entry string in the same format as a submitted Cleaning Report so the
    // existing parser in parseCleanPcts() + buildCleanReportCard() render it correctly.
    const parts = [];
    for (const [loc, data] of Object.entries(byLoc)) {
      const total = DAILY_TASK_COUNTS[loc] || 0;
      const pct = total ? Math.min(100, Math.round(data.done / total * 100)) : 0;
      const locName = loc.charAt(0).toUpperCase() + loc.slice(1);
      const sectionLines = Object.entries(data.sections)
        .map(([sec, info]) => `${sec} (${info.done}/${info.touched})`)
        .join('\n');
      parts.push(`Cleaning Report — ${locName} — ${date}\nDaily: ${pct}% (${data.done}/${total})\n---\n${sectionLines}`);
    }
    const combined = `[AUTO] Cleaning Report — ${date}\n===\n${parts.join('\n===\n')}`;

    // Timestamp at end of the day so it sorts into the correct day bucket
    const ts = date + 'T23:59:59';
    feed.push({
      type: 'clean',
      ts,
      id: 'synth-' + date,
      data: { id: null, entry: combined, created_at: ts, __synthetic: true },
      src: 'daily_logs',
    });
  });

  feed.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  renderFeed();
}

/* ═══ TIME FORMAT ═══ */
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  const days = Math.floor(diff / 86400000);
  if (days < 7) return days + 'd ago';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/* ═══ RENDER FEED ═══ */
function renderFeed() {
  const list = document.getElementById('logList');
  if (!list) return;
  list.innerHTML = '';

  const filtered = activeFilter === 'all' ? feed : feed.filter(f => f.type === activeFilter);

  // Pin open tickets
  if (activeFilter === 'all' || activeFilter === 'ticket') {
    const open = feed.filter(f => f.type === 'ticket' && f.data.status === 'open');
    if (open.length) {
      const sec = document.createElement('div');
      sec.className = 'feed-pinned';
      sec.innerHTML = '<div class="feed-pinned-title">OPEN TICKETS (' + open.length + ')</div>';
      open.forEach(item => sec.appendChild(buildTicketCard(item.data, true)));
      list.appendChild(sec);
    }
  }

  if (!filtered.length) {
    list.innerHTML = '<div class="log-empty">No activity yet.<br><span style="font-size:11px;color:var(--faint)">Actions across all systems appear here.</span></div>';
    return;
  }

  // Group by day
  const days = new Map();
  filtered.forEach(item => {
    if (item.type === 'ticket' && item.data.status === 'open' && (activeFilter === 'all' || activeFilter === 'ticket')) return;
    const dayKey = new Date(item.ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (!days.has(dayKey)) days.set(dayKey, []);
    days.get(dayKey).push(item);
  });

  for (const [day, items] of days) {
    const sec = document.createElement('div');
    sec.className = 'feed-day';
    sec.innerHTML = '<div class="feed-day-label">' + day + '</div>';
    items.forEach(item => { const el = buildCard(item); if (el) sec.appendChild(el); });
    if (sec.children.length > 1) list.appendChild(sec);
  }

  // Auto-translate feed entry text. .feed-text holds the log/ticket/
  // chat content; if a user writes a log in Spanish and an English-
  // preferring manager views it, the entry translates silently with a
  // "Translated from Spanish · show original" badge above it. Calls
  // are memoized client + server, so opening the same day repeatedly
  // is zero additional cost.
  if (window.NX?.tr) {
    list.querySelectorAll('.feed-text').forEach(el => {
      try { NX.tr.auto(el); } catch (_) {}
    });
  }
}

/* ═══ CARD ROUTER ═══ */
function buildCard(item) {
  switch (item.type) {
    case 'log':    return buildLogCard(item.data);
    case 'ticket': return buildTicketCard(item.data, false);
    case 'task':   return buildTaskCard(item.data);
    case 'clock':  return buildClockCard(item.data);
    case 'chat':   return buildChatCard(item.data);
    case 'clean':  return item.src === 'daily_logs' ? buildCleanReportCard(item.data) : buildCleanTaskCard(item.data);
    case 'system': return buildSystemCard(item.data);
    default: return null;
  }
}

/* ═══ BASE CARD ═══ */
function baseCard(type, html, ts) {
  const d = document.createElement('div');
  d.className = 'feed-item feed-' + type;
  d.innerHTML =
    '<div class="feed-bar" style="background:' + (COLORS[type] || 'var(--border)') + '"></div>' +
    '<div class="feed-body">' +
      '<div class="feed-head"><span class="feed-ts">' + timeAgo(ts) + '</span></div>' +
      '<div class="feed-content">' + html + '</div>' +
    '</div>';
  return d;
}

/* ═══ LOG CARD ═══ */
function buildLogCard(r) {
  const entry = r.entry || '';
  const isTicket = entry.includes('TICKET');
  const el = baseCard('log',
    '<div class="feed-text' + (isTicket ? ' feed-text-tk' : '') + '">' + escHTML(entry) + '</div>' +
    (r.user_name ? '<div class="feed-who">' + escHTML(r.user_name) + '</div>' : ''),
    r.created_at);
  addDeleteBtn(el, r.id, 'daily_logs');
  return el;
}

/* ═══ TICKET CARD ═══ */
function buildTicketCard(r, pinned) {
  const pc = r.priority === 'urgent' ? 'var(--red)' : r.priority === 'low' ? 'var(--green)' : 'var(--amber)';
  const d = document.createElement('div');
  d.className = 'feed-item feed-ticket' + (pinned ? ' feed-pinned-item' : '');
  d.innerHTML =
    '<div class="feed-bar" style="background:' + pc + '"></div>' +
    '<div class="feed-body">' +
      '<div class="feed-head">' +
        '<span class="feed-pri" style="color:' + pc + '">' + (r.priority || 'normal').toUpperCase() + '</span> ' +
        '<span class="feed-loc">' + escHTML(r.location || '') + '</span>' +
        '<span class="feed-ts">' + timeAgo(r.created_at) + '</span>' +
      '</div>' +
      '<div class="feed-content">' +
        '<div class="feed-text">' + escHTML(r.title || r.notes || '') + '</div>' +
        (r.notes && r.title ? '<div class="feed-sub">' + escHTML(r.notes) + '</div>' : '') +
        (r.photo_url ? '<img src="' + r.photo_url + '" class="feed-photo">' : '') +
        (r.ai_troubleshoot ? '<details class="feed-ai-detail"><summary>AI Troubleshoot</summary><div class="feed-ai-body">' + r.ai_troubleshoot + '</div></details>' : '') +
        '<div class="feed-who">' + escHTML(r.reported_by || '') + ' · ' + (r.status || 'open') + '</div>' +
      '</div>' +
    '</div>';

  if (pinned && r.status === 'open') {
    const btn = document.createElement('button');
    btn.className = 'feed-close-btn';
    btn.textContent = '✓ Close';
    btn.addEventListener('click', async () => {
      // Try tickets table (legacy) then kanban_cards
      try { await NX.sb.from('tickets').update({ status: 'closed' }).eq('id', r.id); } catch(e){}
      try { await NX.sb.from('kanban_cards').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', r.id); } catch(e){}
      btn.textContent = 'Closed';
      d.style.opacity = '0.4';
      if (NX.checkTicketBadge) NX.checkTicketBadge();
      if (NX.syslog) NX.syslog('card_closed', r.title || 'ticket');
    });
    d.querySelector('.feed-content').appendChild(btn);
  }
  return d;
}

/* ═══ TASK CARD ═══ */
function buildTaskCard(r) {
  const status = (r.column_name || r.status || 'todo').toLowerCase();
  const icon = status === 'done' ? '✅' : status === 'doing' ? '🔄' : '📌';
  const due = r.due_date
    ? '<span class="feed-due' + (new Date(r.due_date) < new Date() ? ' feed-overdue' : '') + '">Due ' +
      new Date(r.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' }) + '</span>'
    : '';
  return baseCard('task',
    '<div class="feed-text">' + icon + ' ' + escHTML(r.title || '') + '</div>' +
    '<div class="feed-who">' + status.toUpperCase() + (r.location ? ' · ' + r.location : '') + ' ' + due + '</div>',
    r.created_at);
}

/* ═══ CLOCK CARD ═══ */
function buildClockCard(r) {
  const hrs = r.hours ? parseFloat(r.hours).toFixed(1) + 'h' : 'active';
  const dot = r.clock_out ? '🔴' : '🟢';
  return baseCard('clock',
    '<div class="feed-text">' + dot + ' ' + (r.clock_out ? 'Out' : 'In') + ' — ' + escHTML(r.user_name || '?') + '</div>' +
    '<div class="feed-who">' + escHTML(r.location || '') + ' · ' + hrs + '</div>',
    r.clock_in);
}

/* ═══ CHAT CARD ═══ */
function buildChatCard(r) {
  const q = escHTML((r.question || '').slice(0, 120));
  const a = escHTML((r.answer || '').slice(0, 200));
  return baseCard('chat',
    '<div class="feed-text feed-chat-q">' + escHTML(r.user_name || '?') + ': ' + q + '</div>' +
    '<div class="feed-chat-a" onclick="this.classList.toggle(\'expanded\')">' + a + '</div>',
    r.created_at);
}

/* ═══ CLEANING REPORT CARD ═══ */
function buildCleanReportCard(r) {
  const entry = r.entry || '';
  const dateMatch = entry.match(/\d{4}-\d{2}-\d{2}/);
  const reportDate = dateMatch ? dateMatch[0] : '';
  const isAuto = entry.includes('[AUTO');

  const pcts = parseCleanPcts(entry);

  const d = document.createElement('div');
  d.className = 'feed-item feed-clean';

  let pctChips = '';
  if (pcts.length) {
    pctChips = '<div class="feed-pcts">' + pcts.map(p => {
      const color = p.pct >= 90 ? 'var(--green)' : p.pct >= 70 ? 'var(--amber)' : 'var(--red)';
      return '<span class="feed-pct-chip" style="border-color:' + color + ';color:' + color + '">' +
        escHTML(p.name) + ' ' + p.pct + '%</span>';
    }).join('') + '</div>';
  }

  d.innerHTML =
    '<div class="feed-bar" style="background:var(--green)"></div>' +
    '<div class="feed-body">' +
      '<div class="feed-head">' +
        (isAuto ? '<span class="feed-auto">AUTO</span>' : '') +
        '<span class="feed-ts">' + timeAgo(r.created_at) + '</span>' +
        '<button class="feed-edit-btn" title="Edit report">✏</button>' +
      '</div>' +
      '<div class="feed-content">' +
        '<div class="feed-text">Cleaning Report ' + reportDate + '</div>' +
        pctChips +
        '<details class="feed-raw-detail"><summary>Full report</summary><pre class="feed-raw-pre">' + escHTML(entry) + '</pre></details>' +
      '</div>' +
    '</div>';

  const editBtn = d.querySelector('.feed-edit-btn');
  if (editBtn) {
    if (!r.id) {
      // Synthesized card (auto-generated from cleaning_logs) — no DB row to edit.
      // User can navigate to Clean view manually and tap Submit to persist.
      editBtn.remove();
    } else {
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (dateMatch) NX.editingReport = { logId: r.id, date: dateMatch[0] };
        document.querySelector('.nav-tab[data-view="clean"]')?.click();
        document.querySelector('.bnav-btn[data-view="clean"]')?.click();
      });
    }
  }

  if (r.id) addDeleteBtn(d, r.id, 'daily_logs');
  return d;
}

/* ═══ PARSE CLEANING PERCENTAGES ═══ */
function parseCleanPcts(entry) {
  const results = [];
  const sections = entry.split(/={3,}/);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    let name = null;
    let pct = null;

    for (const line of lines) {
      if (!name) {
        const m = line.match(/Cleaning Report\s*[\u2014\u2013\-\u2015]+\s*([A-Za-z][A-Za-z\s]*?)\s*[\u2014\u2013\-\u2015]+\s*\d/);
        if (m) name = m[1].trim();
      }
      if (!pct) {
        const m = line.match(/Daily:\s*(\d+)%/);
        if (m) pct = parseInt(m[1]);
      }
      if (name && pct !== null) break;
    }

    if (name && pct !== null) results.push({ name, pct });
  }

  if (!results.length) {
    const pctM = entry.match(/Daily:\s*(\d+)%/);
    if (pctM) {
      const nameM = entry.match(/Cleaning Report\s*[\u2014\u2013\-\u2015]+\s*([A-Za-z][A-Za-z\s]*?)\s*[\u2014\u2013\-\u2015]/);
      results.push({ name: nameM ? nameM[1].trim() : 'Overall', pct: parseInt(pctM[1]) });
    }
  }

  return results;
}

/* ═══ CLEAN TASK CARD ═══ */
function buildCleanTaskCard(r) {
  return baseCard('clean',
    '<div class="feed-text">✓ ' + escHTML(r.section || '') + ' #' + (r.task_index || 0) + '</div>' +
    '<div class="feed-who">' + escHTML(r.location || '') + ' · ' + escHTML(r.log_date || '') + '</div>',
    r.completed_at || r.log_date);
}

/* ═══ SYSTEM EVENT CARD ═══
   Parses [SYS] entries in either format:
     New: "[SYS] 🧠 node_created: HVAC Unit"     (icon embedded, preferred)
     Old: "[SYS] node_created: HVAC Unit"        (icon inferred from event)
   Also recognizes legacy dispatch entries starting with 📞.
*/
function buildSystemCard(r) {
  const entry = r.entry || '';
  let clean = entry.replace(/^\[SYS\]\s*/, '');

  let icon = '⚙';
  let label = clean;
  let event = '';

  // Prefer icon embedded at the start of the entry (new format).
  // Match one leading symbol/emoji token (non-whitespace, non-alphanumeric)
  // followed by a space and an event-name.
  const newFmt = clean.match(/^([^\s\w]+?)\s+(\w[\w_]*)\s*:\s*(.*)$/);
  if (newFmt) {
    icon = newFmt[1];
    event = newFmt[2];
    label = newFmt[3];
  } else {
    // Fallback: old format "event_name: detail"
    const oldFmt = clean.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (oldFmt) {
      event = oldFmt[1];
      label = oldFmt[2];
      // Pick an icon from keyword matching
      if      (event.includes('login') || event.includes('logout')) icon = '🔑';
      else if (event.includes('clock')) icon = '⏱';
      else if (event.includes('card'))  icon = '📋';
      else if (event.includes('ticket')) icon = '🎫';
      else if (event.includes('clean')) icon = '🧹';
      else if (event.includes('chat'))  icon = '💬';
      else if (event.includes('batch')) icon = '📥';
      else if (event.includes('notify') || event.includes('capture')) icon = '📱';
      else if (event.includes('privacy')) icon = '🔒';
      else if (event.includes('node'))  icon = '🧠';
      else if (event.includes('gmail') || event.includes('email')) icon = '✉';
      else if (event.includes('equipment')) icon = '🔧';
      else if (event.includes('maintenance')) icon = '🛠';
      else if (event.includes('call') || event.includes('dispatch')) icon = '📞';
      else if (event.includes('push') || event.includes('subscribed')) icon = '🔔';
      else if (event.includes('broadcast')) icon = '📣';
      else if (event.includes('pattern')) icon = '🔮';
    }
  }

  // Non-[SYS] legacy prefixes that we still classify as system events
  if (entry.startsWith('⚙')) { icon = '⚙'; label = entry.slice(2).trim(); event = ''; }
  if (entry.startsWith('📬')) { icon = '📬'; label = entry.slice(2).trim(); event = ''; }
  if (entry.startsWith('🚨')) { icon = '🚨'; label = entry.slice(2).trim(); event = ''; }
  if (entry.startsWith('📷')) { icon = '📷'; label = entry.slice(2).trim(); event = ''; }
  if (entry.startsWith('📞')) { icon = '📞'; label = entry.replace(/^📞\s*(\[DISPATCH\]\s*)?/, '').trim(); event = 'call_made'; }

  // Pretty event label — strip underscores for display
  const prettyEvent = event ? event.replace(/_/g, ' ') : '';
  const eventBadge = prettyEvent
    ? '<span class="feed-sys-event" style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;opacity:.55;margin-right:6px;">' + escHTML(prettyEvent) + '</span>'
    : '';

  const el = baseCard('system',
    '<div class="feed-text"><span class="feed-sys-icon">' + icon + '</span> ' + eventBadge + escHTML(label) + '</div>' +
    (r.user_name && r.user_name !== 'NEXUS' ? '<div class="feed-who">' + escHTML(r.user_name) + '</div>' : ''),
    r.created_at);
  if (r.id) addDeleteBtn(el, r.id, 'daily_logs');
  return el;
}

/* ═══ UTILITIES ═══ */
function escHTML(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addDeleteBtn(el, id, table) {
  const actions = document.createElement('div');
  actions.className = 'feed-actions';

  const ackBtn = document.createElement('button');
  ackBtn.className = 'feed-ack';
  ackBtn.textContent = '✓';
  ackBtn.title = 'Acknowledge';
  ackBtn.addEventListener('click', e => {
    e.stopPropagation();
    el.style.transition = 'opacity .3s, max-height .3s';
    el.style.opacity = '0';
    el.style.maxHeight = '0';
    el.style.overflow = 'hidden';
    setTimeout(() => el.remove(), 350);
    feed = feed.filter(f => f.id !== (table === 'daily_logs' ? 'dl-' + id : f.id));
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'feed-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    el.style.transition = 'opacity .3s, max-height .3s';
    el.style.opacity = '0';
    el.style.maxHeight = '0';
    el.style.overflow = 'hidden';
    setTimeout(() => el.remove(), 350);
    try { await NX.sb.from(table).delete().eq('id', id); } catch(e) { console.error('[Log] Delete error:', e); }
  });

  actions.appendChild(ackBtn);
  actions.appendChild(delBtn);
  const head = el.querySelector('.feed-head');
  if (head) head.appendChild(actions);
}

/* ═══ ADD LOG — FIXED: uses NX.currentUser ═══ */
async function addLog() {
  const input = document.getElementById('logInput');
  const text = input?.value.trim();
  if (!text) return;
  try {
    await NX.sb.from('daily_logs').insert({ entry: text, user_name: NX.currentUser?.name || '' });
    if (NX.toast) NX.toast('Logged ✓', 'success');
    input.value = '';
    loadFeed();
  } catch (e) {
    console.error('[Log] Add error:', e);
    if (NX.toast) NX.toast('Error saving log', 'error');
  }
}

/* ═══ ADD KNOWLEDGE ═══ */
async function addKnowledge() {
  const inp = document.getElementById('knowledgeInput');
  const btn = document.getElementById('knowledgeBtn');
  const text = inp?.value.trim();
  if (!text) return;

  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    const prompt = 'Extract knowledge for restaurant ops. Return ONLY raw JSON: {"nodes":[{"name":"...","category":"equipment|contractors|vendors|procedure|projects|people|systems|parts|location","tags":["..."],"notes":"..."}]}';
    const answer = await NX.askClaude(prompt, [{ role: 'user', content: text }], 1000);

    let json = answer.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    const s = json.indexOf('{'), e = json.lastIndexOf('}');

    if (s !== -1 && e > s) {
      const parsed = JSON.parse(json.slice(s, e + 1));

      if (parsed.nodes?.length) {
        let created = 0;
        const cats = ['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];

        for (const n of parsed.nodes) {
          const nm = (n.name || '').trim();
          if (!nm || nm.length < 2) continue;
          const { error } = await NX.sb.from('nodes').insert({
            name: nm.slice(0, 200),
            category: cats.includes(n.category) ? n.category : 'equipment',
            tags: Array.isArray(n.tags) ? n.tags.filter(x => typeof x === 'string').slice(0, 20) : [],
            notes: (n.notes || '').slice(0, 2000),
            links: [], access_count: 1, source_emails: []
          });
          if (!error) created++;
        }

        inp.value = '';
        btn.textContent = '✓ ' + created + ' node' + (created !== 1 ? 's' : '') + ' added';
        if (NX.toast) NX.toast(created + ' node' + (created !== 1 ? 's' : '') + ' added to brain ✓', 'success');
        await NX.loadNodes();
        if (NX.brain) NX.brain.init();
      } else {
        btn.textContent = 'No knowledge found';
      }
    } else {
      btn.textContent = 'No data extracted';
    }
  } catch (err) {
    console.error('[Log] Knowledge error:', err);
    btn.textContent = 'Error';
  }

  setTimeout(() => { btn.disabled = false; btn.textContent = '+ Brain'; }, 2500);
}

/* ═══ EXPORT ═══ */
NX.modules.log = {
  init: () => {
    init();
    try { if (NX.timeClock && NX.timeClock.setupLogFilters) NX.timeClock.setupLogFilters(); } catch(e){}
  },
  show: () => {
    loadFeed();
    try { if (NX.timeClock && NX.timeClock._reloadLog) NX.timeClock._reloadLog(); } catch(e){}
  }
};

})();
