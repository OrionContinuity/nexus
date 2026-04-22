/* NEXUS Calendar v4 — unified time view
   Pulls from:
     • contractor_events       (scheduled contractor visits)
     • equipment.next_pm_date  (preventative maintenance coming up)
     • equipment.warranty_until (warranties expiring)
     • equipment_maintenance   (past service events — small dots)
     • dispatch_events         (contractor calls made)
     • patterns.next_predicted (AI-forecasted recurrences)
     • kanban_cards.due_date   (board cards due — color by priority)
     • tickets                 (reported issues)
     • daily_logs              (cleaning reports, etc.)

   Interactions:
     • Tap any event in the day detail → jumps to the relevant view
       (board card → Board, equipment PM → Equipment detail, etc.)
     • Tap an empty day → quick-add a board card with that due_date
*/
(function(){

let currentDate = new Date();
let events = {};   // { 'YYYY-MM-DD': [ {type, title, ...} ] }

const COLORS = {
  contractor:  '#5b9bd5',   // blue
  cleaning:    '#7eb87a',   // green
  ticket:      '#d4785c',   // red-orange
  card:        '#c8a44e',   // nexus gold
  card_urgent: '#d45858',   // red
  card_high:   '#e8a830',   // amber
  log:         '#a89580',   // muted brown
  pm:          '#e8a830',   // amber (preventative maintenance)
  warranty:    '#d45858',   // red (warranty expiring)
  service:     '#7eb87a',   // green (service completed)
  dispatch:    '#5b9bd5',   // blue (call made)
  pattern:     '#a88fd8',   // purple (AI-predicted)
};
const TYPE_ICONS = {
  contractor: '🔧',
  cleaning:   '✨',
  ticket:     '🎫',
  card:       '📋',
  log:        '📝',
  pm:         '🔧',
  warranty:   '🛡',
  service:    '🛠',
  dispatch:   '📞',
  pattern:    '🔮',
};
const TYPE_LABELS = {
  contractor: 'Contractor',
  cleaning:   'Cleaning',
  ticket:     'Ticket',
  card:       'Card',
  log:        'Log',
  pm:         'PM Due',
  warranty:   'Warranty',
  service:    'Service',
  dispatch:   'Call',
  pattern:    'Predicted',
};

// ─── Utilities ───────────────────────────────────────────────────────
function fmtTime(t) {
  if (!t) return '';
  try {
    const p = String(t).match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (!p) return t;
    let h = parseInt(p[1]), m = p[2], ap = p[3];
    if (!ap) { ap = h >= 12 ? 'PM' : 'AM'; if (h > 12) h -= 12; if (h === 0) h = 12; }
    return h + ':' + m + ' ' + ap.toUpperCase();
  } catch(e) { return t; }
}
function fmtDate(ds) {
  try {
    const d = new Date(ds + 'T12:00:00');
    const dd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const mm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return dd[d.getDay()] + ', ' + mm[d.getMonth()] + ' ' + d.getDate();
  } catch(e) { return ds; }
}
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function push(dateStr, event) {
  if (!dateStr) return;
  if (!events[dateStr]) events[dateStr] = [];
  events[dateStr].push(event);
}

// ─── Data loading ────────────────────────────────────────────────────
async function loadEvents() {
  events = {};
  const year = currentDate.getFullYear(), month = currentDate.getMonth();
  const firstDay = year + '-' + String(month + 1).padStart(2, '0') + '-01';
  const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0];

  // Run all queries in parallel for speed
  await Promise.all([
    loadContractorEvents(firstDay, lastDay),
    loadDailyLogs(firstDay, lastDay),
    loadTickets(firstDay, lastDay),
    loadBoardCards(firstDay, lastDay),
    loadEquipmentPMs(firstDay, lastDay),
    loadEquipmentWarranties(firstDay, lastDay),
    loadMaintenanceHistory(firstDay, lastDay),
    loadDispatchEvents(firstDay, lastDay),
    loadPatternPredictions(firstDay, lastDay),
  ]);
}

async function loadContractorEvents(firstDay, lastDay) {
  try {
    const { data } = await NX.sb.from('contractor_events')
      .select('*')
      .gte('event_date', firstDay).lte('event_date', lastDay)
      .neq('status', 'disregarded');
    (data || []).forEach(e => {
      const st = e.status || 'pending';
      push(e.event_date, {
        type: 'contractor',
        title: e.contractor_name || 'Contractor',
        time: e.event_time ? fmtTime(e.event_time) : '',
        location: e.location || '',
        color: COLORS.contractor,
        detail: e.description || '',
        status: st,
        statusLabel: st === 'accepted' ? '✓ Confirmed' : st === 'dismissed' ? 'Noted' : st === 'pending' ? 'Pending' : '',
        id: e.id,
      });
    });
  } catch(e) { /* silent */ }
}

async function loadDailyLogs(firstDay, lastDay) {
  try {
    const { data } = await NX.sb.from('daily_logs')
      .select('id, entry, created_at')
      .gte('created_at', firstDay + 'T00:00:00')
      .lte('created_at', lastDay + 'T23:59:59')
      .limit(200);
    (data || []).forEach(e => {
      const d = (e.created_at || '').split('T')[0]; if (!d) return;
      const entry = e.entry || '';
      const time = (e.created_at || '').split('T')[1]?.slice(0, 5) || '';
      // Skip [SYS] entries — they clutter the calendar; use the Log view for those
      if (entry.startsWith('[SYS]')) return;
      if (entry.includes('[DISREGARDED]')) {
        push(d, { type: 'log', title: entry.replace('[DISREGARDED] ', '').slice(0, 60), time: fmtTime(time), color: '#9e8e7e', detail: entry, recoverable: true, logId: e.id });
        return;
      }
      if (entry.toLowerCase().includes('cleaning report')) {
        push(d, { type: 'cleaning', title: 'Cleaning Report', time: fmtTime(time), color: COLORS.cleaning, detail: entry.slice(0, 200) });
      } else if (entry.includes('[TICKET]')) {
        push(d, { type: 'ticket', title: entry.replace('[TICKET]', '').trim().slice(0, 60), time: fmtTime(time), color: COLORS.ticket, detail: entry });
      } else {
        push(d, { type: 'log', title: entry.slice(0, 60), time: fmtTime(time), color: COLORS.log, detail: entry });
      }
    });
  } catch(e) { /* silent */ }
}

async function loadTickets(firstDay, lastDay) {
  try {
    const { data } = await NX.sb.from('tickets')
      .select('*')
      .gte('created_at', firstDay + 'T00:00:00')
      .lte('created_at', lastDay + 'T23:59:59');
    // Build a name→id map from already-loaded equipment so we can link
    // tickets whose titles start with "[Equipment] Name: ..." — these
    // were created by the public QR-scan flow and reference equipment
    // by name rather than FK. Match lowercase-insensitively.
    const eqIndex = new Map();
    (NX.equipment || []).forEach(eq => {
      if (eq?.name) eqIndex.set(eq.name.toLowerCase().trim(), eq.id);
    });

    (data || []).forEach(e => {
      const d = (e.created_at || '').split('T')[0]; if (!d) return;
      const time = (e.created_at || '').split('T')[1]?.slice(0, 5) || '';

      // Extract equipment name if title has "[Equipment] <Name>: ..." shape
      let equipmentId = null;
      const m = /^\[(?:Equipment|CALL)\]\s*([^:]+?)\s*:/.exec(e.title || '');
      if (m) {
        const candidate = m[1].toLowerCase().trim();
        if (eqIndex.has(candidate)) equipmentId = eqIndex.get(candidate);
      }

      push(d, {
        type: 'ticket',
        title: e.title || 'Issue',
        time: fmtTime(time),
        location: e.location || '',
        color: COLORS.ticket,
        detail: e.description || e.title || '',
        status: e.status || 'open',
        id: e.id,
        equipmentId,      // if present, navigateToEvent opens equipment detail
        ticketId: e.id,   // always preserved so future code can open ticket UI
      });
    });
  } catch(e) { /* silent */ }
}

async function loadBoardCards(firstDay, lastDay) {
  try {
    const { data } = await NX.sb.from('kanban_cards')
      .select('id, title, due_date, priority, status, location, equipment_id, archived')
      .not('due_date', 'is', null)
      .gte('due_date', firstDay).lte('due_date', lastDay)
      .eq('archived', false);
    (data || []).forEach(c => {
      if (!c.due_date) return;
      // Priority-driven color so urgent cards jump out on the calendar
      const color = c.priority === 'urgent' ? COLORS.card_urgent
                  : c.priority === 'high'   ? COLORS.card_high
                  : COLORS.card;
      const metaBits = [];
      if (c.priority && c.priority !== 'normal') metaBits.push(c.priority.toUpperCase());
      if (c.location) metaBits.push(c.location);
      if (c.equipment_id) metaBits.push('🔧 linked');
      push(c.due_date, {
        type: 'card',
        title: c.title || 'Card due',
        color,
        detail: metaBits.length ? metaBits.join(' · ') : '',
        status: (c.status || '').replace(/_/g, ' '),
        priority: c.priority,
        cardId: c.id,
        equipmentId: c.equipment_id,
      });
    });
  } catch(e) { /* silent */ }
}

async function loadEquipmentPMs(firstDay, lastDay) {
  try {
    const { data } = await NX.sb.from('equipment')
      .select('id, name, next_pm_date, location, category, pm_interval_days')
      .not('next_pm_date', 'is', null)
      .gte('next_pm_date', firstDay).lte('next_pm_date', lastDay);
    (data || []).forEach(eq => {
      push(eq.next_pm_date, {
        type: 'pm',
        title: eq.name + ' — PM due',
        color: COLORS.pm,
        detail: [eq.location, eq.category, eq.pm_interval_days ? `every ${eq.pm_interval_days}d` : null]
          .filter(Boolean).join(' · '),
        equipmentId: eq.id,
      });
    });
  } catch(e) { /* silent */ }
}

async function loadEquipmentWarranties(firstDay, lastDay) {
  try {
    const { data } = await NX.sb.from('equipment')
      .select('id, name, warranty_until, location, manufacturer, model')
      .not('warranty_until', 'is', null)
      .gte('warranty_until', firstDay).lte('warranty_until', lastDay);
    (data || []).forEach(eq => {
      push(eq.warranty_until, {
        type: 'warranty',
        title: eq.name + ' — warranty expires',
        color: COLORS.warranty,
        detail: [eq.location, eq.manufacturer, eq.model].filter(Boolean).join(' · '),
        equipmentId: eq.id,
      });
    });
  } catch(e) { /* silent */ }
}

async function loadMaintenanceHistory(firstDay, lastDay) {
  try {
    const { data } = await NX.sb.from('equipment_maintenance')
      .select('id, equipment_id, event_date, description, cost, performed_by, event_type')
      .gte('event_date', firstDay).lte('event_date', lastDay)
      .order('event_date', { ascending: true })
      .limit(100);
    if (!data || !data.length) return;
    // Batch-lookup equipment names
    const eqIds = [...new Set(data.map(m => m.equipment_id).filter(Boolean))];
    let eqById = {};
    if (eqIds.length) {
      const { data: eqs } = await NX.sb.from('equipment')
        .select('id, name').in('id', eqIds);
      eqById = Object.fromEntries((eqs || []).map(e => [e.id, e.name]));
    }
    data.forEach(m => {
      push(m.event_date, {
        type: 'service',
        title: (eqById[m.equipment_id] || 'Equipment') + ' — ' + (m.event_type || 'service'),
        color: COLORS.service,
        detail: [
          m.description ? m.description.slice(0, 120) : null,
          m.cost ? `$${parseFloat(m.cost).toLocaleString()}` : null,
          m.performed_by,
        ].filter(Boolean).join(' · '),
        equipmentId: m.equipment_id,
      });
    });
  } catch(e) { /* silent — table may not exist */ }
}

async function loadDispatchEvents(firstDay, lastDay) {
  try {
    const { data } = await NX.sb.from('dispatch_events')
      .select('id, equipment_id, contractor_name, contractor_phone, issue_description, outcome, created_at')
      .gte('created_at', firstDay + 'T00:00:00')
      .lte('created_at', lastDay + 'T23:59:59')
      .limit(100);
    (data || []).forEach(d => {
      const dateStr = (d.created_at || '').split('T')[0];
      if (!dateStr) return;
      const time = (d.created_at || '').split('T')[1]?.slice(0, 5) || '';
      push(dateStr, {
        type: 'dispatch',
        title: `Called ${d.contractor_name || 'contractor'}`,
        time: fmtTime(time),
        color: COLORS.dispatch,
        detail: [
          d.issue_description ? '"' + d.issue_description.slice(0, 80) + '"' : null,
          d.outcome && d.outcome !== 'pending' ? d.outcome : null,
        ].filter(Boolean).join(' · '),
        status: d.outcome || 'pending',
        equipmentId: d.equipment_id,
      });
    });
  } catch(e) { /* silent */ }
}

async function loadPatternPredictions(firstDay, lastDay) {
  try {
    const { data } = await NX.sb.from('patterns')
      .select('id, entity_name, next_predicted, confidence, interval_days, location')
      .not('next_predicted', 'is', null)
      .gte('next_predicted', firstDay).lte('next_predicted', lastDay)
      .eq('active', true);
    (data || []).forEach(p => {
      // Low-confidence patterns are very tentative — show but fade them
      const conf = Math.round((p.confidence || 0) * 100);
      push(p.next_predicted, {
        type: 'pattern',
        title: `${p.entity_name || 'Recurrence'} predicted`,
        color: COLORS.pattern,
        detail: `Based on ~${p.interval_days || '?'}d cadence · ${conf}% confidence` +
                (p.location ? ` · ${p.location}` : ''),
        confidence: conf,
        tentative: true,
      });
    });
  } catch(e) { /* silent — table may not exist */ }
}

// ─── Render ──────────────────────────────────────────────────────────
function render() {
  try {
    const year = currentDate.getFullYear(), month = currentDate.getMonth();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const titleEl = document.getElementById('calTitle');
    if (titleEl) titleEl.textContent = months[month] + ' ' + year;

    const grid = document.getElementById('calGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const todayStr = today.getFullYear() + '-' +
                     String(today.getMonth() + 1).padStart(2, '0') + '-' +
                     String(today.getDate()).padStart(2, '0');

    for (let i = 0; i < firstDow; i++) {
      const cell = document.createElement('div');
      cell.className = 'cal-cell cal-empty';
      grid.appendChild(cell);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const cell = document.createElement('div');
      cell.className = 'cal-cell' + (dateStr === todayStr ? ' cal-today-cell' : '');

      const num = document.createElement('div');
      num.className = 'cal-num';
      num.textContent = d;
      cell.appendChild(num);

      const dayEvents = events[dateStr] || [];
      if (dayEvents.length) {
        const dots = document.createElement('div');
        dots.className = 'cal-dots';
        // Up to 4 unique-type dots shown (more info than just "some events")
        const types = [...new Set(dayEvents.map(e => e.type))].slice(0, 4);
        types.forEach(t => {
          const dot = document.createElement('span');
          dot.className = 'cal-dot';
          dot.style.background = COLORS[t] || '#888';
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
        if (dayEvents.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'cal-badge';
          badge.textContent = dayEvents.length;
          cell.appendChild(badge);
        }
      }

      cell.addEventListener('click', () => {
        document.querySelectorAll('.cal-cell.selected').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
        showDetail(dateStr, dayEvents);
      });
      grid.appendChild(cell);
    }

    renderLegend();
    renderUpcoming();
  } catch(e) { console.error('Cal render error:', e); }
}

// Upcoming: compact list of the next 7 days below the month grid.
// Fills the dead space below the day-detail panel and gives a quick
// preview of what's coming regardless of which day is selected.
function renderUpcoming() {
  let upEl = document.getElementById('calUpcoming');
  if (!upEl) {
    const wrap = document.querySelector('.cal-wrap');
    if (!wrap) return;
    upEl = document.createElement('div');
    upEl.id = 'calUpcoming';
    upEl.className = 'cal-upcoming';
    wrap.appendChild(upEl);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const in7 = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  // Collect events within today..today+7 from the already-loaded state.
  // events is a date→[evt] map built by load*() pushers.
  const days = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const ds = d.toISOString().slice(0, 10);
    const evts = events[ds] || [];
    if (evts.length) days.push({ date: ds, events: evts });
    if (days.length >= 5) break; // cap — keep it short and scannable
  }

  if (!days.length) {
    upEl.innerHTML = `
      <div class="cal-up-head">Next 7 days</div>
      <div class="cal-up-empty">Nothing scheduled this week.</div>
    `;
    return;
  }

  upEl.innerHTML = `
    <div class="cal-up-head">Next 7 days</div>
    <div class="cal-up-list">
      ${days.map(day => {
        const d = new Date(day.date + 'T12:00:00');
        const wd = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];
        const mo = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
        const isToday = day.date === todayStr;
        const label = isToday ? `TODAY` : `${wd} · ${mo} ${d.getDate()}`;
        const top = day.events.slice(0, 3);
        const more = day.events.length - top.length;

        return `
          <div class="cal-up-day ${isToday ? 'is-today' : ''}">
            <div class="cal-up-date">${label}</div>
            <div class="cal-up-events">
              ${top.map(e => {
                const dot = `<span class="cal-up-dot" style="background:${e.color || '#888'}"></span>`;
                const time = e.time ? `<span class="cal-up-time">${esc(e.time)}</span>` : '';
                const title = esc((e.title || '').slice(0, 64));
                return `<div class="cal-up-event">${dot}${time}<span class="cal-up-title">${title}</span></div>`;
              }).join('')}
              ${more > 0 ? `<div class="cal-up-more">+ ${more} more</div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Legend: compact row under the title listing the event types that appear
// in the current month, as colored chips. Helps decode the dots.
function renderLegend() {
  let legend = document.getElementById('calLegend');
  const header = document.querySelector('.cal-header') || document.getElementById('calTitle')?.parentNode;
  if (!header) return;
  if (!legend) {
    legend = document.createElement('div');
    legend.id = 'calLegend';
    legend.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;font-size:9px;padding:4px 8px;margin:-4px 0 8px;color:var(--text-dim,#a49c94)';
    header.parentNode?.insertBefore(legend, header.nextSibling);
  }
  // Only show types actually present this month
  const present = new Set();
  for (const day in events) for (const e of events[day]) present.add(e.type);
  const order = ['pm','warranty','card','ticket','contractor','service','dispatch','pattern','cleaning','log'];
  legend.innerHTML = order.filter(t => present.has(t)).map(t =>
    `<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:7px;height:7px;border-radius:50%;background:${COLORS[t]}"></span>${TYPE_LABELS[t]}</span>`
  ).join('');
}

function showDetail(dateStr, dayEvents) {
  const detail = document.getElementById('calDetail');
  if (!detail) return;

  // Empty day → offer quick-add card
  if (!dayEvents || !dayEvents.length) {
    detail.innerHTML =
      '<div class="cal-detail-date">' + fmtDate(dateStr) + '</div>' +
      '<div class="cal-detail-empty">Nothing scheduled</div>' +
      `<button id="calQuickAdd" style="margin-top:10px;padding:8px 14px;background:rgba(200,164,78,0.15);border:1px solid rgba(200,164,78,0.3);color:#c8a44e;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">+ Add board card due ${fmtDate(dateStr)}</button>`;
    detail.querySelector('#calQuickAdd')?.addEventListener('click', () => quickAddCard(dateStr));
    return;
  }

  // Sort by type priority for readability
  const order = { pm:0, warranty:1, contractor:2, ticket:3, card:4, dispatch:5, service:6, pattern:7, cleaning:8, log:9 };
  dayEvents.sort((a, b) => (order[a.type] || 99) - (order[b.type] || 99));

  detail.innerHTML =
    '<div class="cal-detail-date">' + fmtDate(dateStr) + ' · ' + dayEvents.length + ' event' + (dayEvents.length > 1 ? 's' : '') + '</div>' +
    dayEvents.map((e, i) => {
      const icon = TYPE_ICONS[e.type] || '•';
      const label = TYPE_LABELS[e.type] || 'Event';
      const meta = [];
      if (e.time) meta.push(e.time);
      if (e.location) meta.push(e.location);

      let statusBadge = '';
      if (e.statusLabel) {
        const sc = e.status === 'accepted' ? 'cal-status-done' : e.status === 'dismissed' ? 'cal-status-noted' : 'cal-status-open';
        statusBadge = '<span class="cal-event-status ' + sc + '">' + e.statusLabel + '</span>';
      } else if (e.status) {
        const sc = e.status === 'open' || e.status === 'todo' || e.status === 'pending' ? 'cal-status-open'
                 : e.status === 'done' || e.status === 'closed' || e.status === 'completed' ? 'cal-status-done' : '';
        statusBadge = '<span class="cal-event-status ' + sc + '">' + esc(e.status) + '</span>';
      }
      if (e.priority === 'urgent') statusBadge = '<span class="cal-event-status cal-status-open" style="color:#e88;border-color:rgba(212,88,88,.4)">🚨 URGENT</span>' + statusBadge;

      const recoverBtn = e.recoverable ? '<button class="cal-recover-btn" data-log-id="' + e.logId + '">↩ Restore</button>' : '';
      // Tap hint differs by event type:
      //   equipment/card-linked → "tap to open" (routes to that view)
      //   contractor → "💬 notes" (expands in-place with the notes UI)
      let tapHint = '';
      if (e.equipmentId || e.cardId) {
        tapHint = '<span style="font-size:10px;color:var(--text-faint,#746c5e);margin-left:6px">tap to open</span>';
      } else if (e.type === 'contractor') {
        tapHint = '<span class="cal-event-notes-hint">💬 notes</span>';
      }
      const isFaded = e.recoverable || e.tentative;

      return '<div class="cal-event ' + (isFaded ? 'cal-event-faded' : '') + '" data-type="' + e.type + '" data-idx="' + i + '"' + (e.id ? ' data-event-id="' + esc(String(e.id)) + '"' : '') + '>' +
        '<div class="cal-event-accent" style="background:' + e.color + '"></div>' +
        '<div class="cal-event-body">' +
          '<div class="cal-event-header">' +
            '<span class="cal-event-type">' + icon + ' ' + label + '</span>' +
            statusBadge + tapHint +
          '</div>' +
          '<div class="cal-event-title">' + esc(e.title || '') + '</div>' +
          (meta.length ? '<div class="cal-event-meta">' + esc(meta.join(' · ')) + '</div>' : '') +
          (e.detail ? '<div class="cal-event-detail">' + esc(e.detail) + '</div>' : '') +
          recoverBtn +
        '</div>' +
      '</div>';
    }).join('');

  // Wire event clicks — contractor events expand inline with notes,
  // everything else navigates to its native view.
  detail.querySelectorAll('.cal-event').forEach((card, i) => {
    card.addEventListener('click', ev => {
      // Don't toggle when clicking interactive children
      if (ev.target.closest('.cal-recover-btn')) return;
      if (ev.target.closest('.cal-notes-input')) return;
      if (ev.target.closest('.cal-notes-save')) return;
      if (ev.target.closest('.cal-note')) return;

      const e = dayEvents[parseInt(card.dataset.idx)];
      if (!e) return;

      // Contractor events → toggle notes panel in-place
      if (e.type === 'contractor' && e.id != null) {
        if (card.classList.contains('expanded')) {
          card.classList.remove('expanded');
        } else {
          card.classList.add('expanded');
          loadNotesInto(card, e);
        }
        return;
      }

      // Everything else → go to the native view
      navigateToEvent(e);
    });
  });
  detail.querySelectorAll('.cal-recover-btn').forEach(btn => {
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();
      NX.toast && NX.toast('Recovery: coming soon', 'info');
    });
  });
}

// ─── Navigation ──────────────────────────────────────────────────────
function navigateToEvent(e) {
  if (!e) return;

  // Card → open on Board
  if (e.cardId) {
    document.querySelector('.nav-tab[data-view="board"]')?.click();
    document.querySelector('.bnav-btn[data-view="board"]')?.click();
    if (NX.modules?.board?.reload) setTimeout(() => NX.modules.board.reload(), 250);
    return;
  }

  // Equipment-linked event → open equipment detail
  if (e.equipmentId) {
    if (NX.modules?.equipment?.openDetail) {
      document.querySelector('.nav-tab[data-view="equipment"]')?.click();
      document.querySelector('.bnav-btn[data-view="equipment"]')?.click();
      setTimeout(() => NX.modules.equipment.openDetail(e.equipmentId), 300);
    }
    return;
  }

  // Ticket without equipment link → open the Log view where all tickets live
  if (e.type === 'ticket' && e.ticketId) {
    document.querySelector('.nav-tab[data-view="log"]')?.click();
    document.querySelector('.bnav-btn[data-view="log"]')?.click();
    return;
  }

  // Everything else — no navigation; the detail panel already shows the info
}

// ─── Contractor event notes ──────────────────────────────────────────
// Loads notes for one contractor event into a .cal-notes panel inside
// the event card. Called when the user taps a contractor card (which
// expands it). Renders error UI if the table doesn't exist — so the
// feature degrades gracefully before the migration has been run.
async function loadNotesInto(card, event) {
  const body = card.querySelector('.cal-event-body');
  if (!body) return;
  let notesEl = card.querySelector('.cal-notes');
  if (!notesEl) {
    notesEl = document.createElement('div');
    notesEl.className = 'cal-notes';
    body.appendChild(notesEl);
  }
  notesEl.innerHTML = '<div class="cal-notes-loading">Loading notes…</div>';

  try {
    const { data, error } = await NX.sb.from('contractor_event_notes')
      .select('id, author_name, author_role, body, created_at')
      .eq('event_id', String(event.id))
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    if (error) throw error;
    renderNotes(card, notesEl, data || [], event);
  } catch (err) {
    const msg = (err && err.message) || '';
    const isMissingTable = /relation|does not exist|contractor_event_notes/i.test(msg);
    notesEl.innerHTML = `
      <div class="cal-notes-head">Notes</div>
      <div class="cal-notes-error">
        ${isMissingTable
          ? 'This feature needs a one-time database setup. Ask your admin to run the <code>migration_contractor_notes.sql</code> migration in the Supabase SQL editor, then try again.'
          : 'Couldn\'t load notes right now. ' + esc(msg || '')}
      </div>
    `;
  }
}

// Renders the notes list + add-note form inside the given notesEl.
// Saves optimistically: disable the button, insert, reload list.
function renderNotes(card, notesEl, notes, event) {
  const notesHtml = notes.length === 0
    ? '<div class="cal-notes-empty">No notes yet. Be the first.</div>'
    : notes.map(n => `
        <div class="cal-note" data-note-id="${esc(String(n.id))}">
          <div class="cal-note-head">
            <span class="cal-note-author">${esc(n.author_name || 'Unknown')}${n.author_role ? ' · ' + esc(n.author_role) : ''}</span>
            <span class="cal-note-time">${esc(fmtNoteTime(n.created_at))}</span>
          </div>
          <div class="cal-note-body">${esc(n.body || '')}</div>
        </div>
      `).join('');

  notesEl.innerHTML = `
    <div class="cal-notes-head">Notes · ${notes.length}</div>
    <div class="cal-notes-list">${notesHtml}</div>
    <div class="cal-notes-add">
      <textarea class="cal-notes-input" placeholder="Add a note about this visit…" rows="2" maxlength="1000"></textarea>
      <button class="cal-notes-save" type="button">Add</button>
    </div>
  `;

  const textarea = notesEl.querySelector('.cal-notes-input');
  const saveBtn  = notesEl.querySelector('.cal-notes-save');

  // Don't let clicks on the textarea bubble up to the card's toggle handler
  ['click','mousedown','touchstart'].forEach(evt => {
    textarea.addEventListener(evt, e => e.stopPropagation());
    saveBtn.addEventListener(evt, e => e.stopPropagation());
  });

  const saveNote = async () => {
    const body = textarea.value.trim();
    if (!body) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const user = NX.currentUser;
      const { error } = await NX.sb.from('contractor_event_notes').insert({
        event_id:    String(event.id),
        author_name: (user && user.name) || 'Unknown',
        author_role: (user && user.role) || null,
        body:        body.slice(0, 1000),
      });
      if (error) throw error;
      textarea.value = '';
      await loadNotesInto(card, event);
      if (NX.syslog) NX.syslog('note_added', `contractor event ${String(event.id).slice(0,8)}`);
    } catch (err) {
      NX.toast && NX.toast('Could not save note: ' + (err.message || 'unknown error'), 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Add';
    }
  };

  saveBtn.addEventListener('click', saveNote);
  // Cmd/Ctrl + Enter to save from inside the textarea
  textarea.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveNote();
    }
  });
}

// Relative time for notes: "just now", "3h ago", "Apr 20 · 2:14 PM"
function fmtNoteTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return mins + 'm ago';
    if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
    const days = Math.floor(mins / 1440);
    if (days < 7)   return days + 'd ago';
    const mm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return mm[d.getMonth()] + ' ' + d.getDate() + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (e) { return ''; }
}

// ─── Quick-add card from calendar ────────────────────────────────────
async function quickAddCard(dateStr) {
  const title = prompt(`Title for new card due ${fmtDate(dateStr)}:`);
  if (!title || !title.trim()) return;

  try {
    // Find the first board + first "Reported" or similar list
    const { data: boards } = await NX.sb.from('boards').select('id').eq('archived', false).order('position').limit(1);
    if (!boards || !boards.length) {
      NX.toast && NX.toast('No board found — open Board view first', 'warn');
      return;
    }
    const boardId = boards[0].id;
    const { data: lists } = await NX.sb.from('board_lists').select('*').eq('board_id', boardId).order('position');
    const targetList = (lists || []).find(l => /report|todo|triage/i.test(l.name)) || (lists || [])[0];
    if (!targetList) {
      NX.toast && NX.toast('No list found on board', 'warn');
      return;
    }

    await NX.sb.from('kanban_cards').insert({
      title: title.trim(),
      board_id: boardId,
      list_id: targetList.id,
      column_name: '',
      position: 999,
      due_date: dateStr,
      priority: 'normal',
      reported_by: NX.currentUser?.name || null,
      checklist: [], comments: [], labels: [], photo_urls: [],
      archived: false,
    });

    NX.toast && NX.toast(`Card created — due ${fmtDate(dateStr)}`, 'success');
    // Refresh calendar to show the new card
    await loadEvents(); render();
  } catch(e) {
    console.error('[cal] quickAdd:', e);
    NX.toast && NX.toast('Could not create card', 'error');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────
async function init() {
  try {
    document.getElementById('calPrev')?.addEventListener('click', async () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      await loadEvents(); render();
    });
    document.getElementById('calNext')?.addEventListener('click', async () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      await loadEvents(); render();
    });
    document.getElementById('calToday')?.addEventListener('click', async () => {
      currentDate = new Date();
      await loadEvents(); render();
    });
    render();
    await loadEvents();
    render();
  } catch(e) {
    console.error('Cal init error:', e);
    render();
  }
}

async function show() {
  try { await loadEvents(); } catch(e) { /* silent */ }
  render();
}

if (!NX.modules) NX.modules = {};
NX.modules.cal = { init, show };

console.log('[calendar] v4 loaded — 9 event sources');

})();
