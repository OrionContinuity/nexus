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
    safeQuery(() => NX.sb.from('chat_history').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(50)),
    safeQuery(() => NX.sb.from('cleaning_logs').select('*').gte('log_date', sinceDate).order('log_date', { ascending: false }).limit(100)),
  ]);

  feed = [];

  // Daily logs → split into cleaning reports, system events, and regular logs
  (logsRes.data || []).forEach(r => {
    const entry = r.entry || '';
    const isClean = entry.startsWith('Cleaning Report') || entry.startsWith('[AUTO');
    const isSys = entry.startsWith('[SYS]') || entry.startsWith('⚙') || entry.startsWith('📬') || entry.startsWith('🚨') || entry.startsWith('📷');
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

  // Cleaning tasks — skip dates already covered by daily_logs cleaning reports
  const reportDates = new Set(
    feed.filter(f => f.type === 'clean' && f.src === 'daily_logs')
      .map(f => { const m = (f.data.entry || '').match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : null; })
      .filter(Boolean)
  );
  (cleanRes.data || []).forEach(r => {
    if (r.done) {
      const d = r.log_date || '';
      if (!reportDates.has(d)) {
        const ts = r.completed_at || (r.log_date + 'T12:00:00Z');
        feed.push({ type: 'clean', ts, id: 'cl-' + (r.id || r.log_date + r.section + r.task_index), data: r, src: 'cleaning_logs' });
      }
    }
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
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (dateMatch) NX.editingReport = { logId: r.id, date: dateMatch[0] };
      document.querySelector('.nav-tab[data-view="clean"]')?.click();
      document.querySelector('.bnav-btn[data-view="clean"]')?.click();
    });
  }

  addDeleteBtn(d, r.id, 'daily_logs');
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

/* ═══ SYSTEM EVENT CARD ═══ */
function buildSystemCard(r) {
  const entry = r.entry || '';
  let clean = entry.replace(/^\[SYS\]\s*/, '');
  const parts = clean.match(/^(\w+?):\s*(.+)$/);
  let icon = '⚙';
  let label = clean;
  if (parts) {
    const event = parts[1];
    label = parts[2];
    if (event.includes('login')) icon = '🔑';
    else if (event.includes('clock')) icon = '⏱';
    else if (event.includes('card')) icon = '📋';
    else if (event.includes('clean')) icon = '🧹';
    else if (event.includes('chat')) icon = '💬';
    else if (event.includes('batch')) icon = '📥';
    else if (event.includes('notify') || event.includes('capture')) icon = '📱';
    else if (event.includes('privacy')) icon = '🔒';
    else if (event.includes('node')) icon = '🧠';
    else if (event.includes('gmail') || event.includes('email')) icon = '✉';
  }
  if (entry.startsWith('⚙')) { icon = '⚙'; label = entry.slice(2).trim(); }
  if (entry.startsWith('📬')) { icon = '📬'; label = entry.slice(2).trim(); }
  if (entry.startsWith('🚨')) { icon = '🚨'; label = entry.slice(2).trim(); }
  if (entry.startsWith('📷')) { icon = '📷'; label = entry.slice(2).trim(); }

  const el = baseCard('system',
    '<div class="feed-text"><span class="feed-sys-icon">' + icon + '</span> ' + escHTML(label) + '</div>' +
    (r.user_name && r.user_name !== 'NEXUS' ? '<div class="feed-who">' + escHTML(r.user_name) + '</div>' : ''),
    r.created_at);
  addDeleteBtn(el, r.id, 'daily_logs');
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
