/* ════════════════════════════════════════════════════════════════════
   NEXUS · Biweekly Review (v18.32 Phase 3d)
   ──────────────────────────────────────────────────────────────────────
   Phase 3d adds the rollup content: tickets opened/closed in the
   14-day window, PMs completed, equipment activity summary, and the
   chronic-problem tracker (open tickets >14 days). Free-text replaces
   the single `notes` field with four annotation textareas:
     Trends · Wins · Concerns · Next 2 Weeks Focus

   ROLLING OPEN TICKETS:
     The chronic-problem list comes from a live query at form-render
     time, scoped to "open + created_at < window_start". A ticket that
     stays open across multiple biweekly reviews appears in each one
     until it's closed. No persistent "carryover" state — the query
     does the carryover by definition.

   DATA SHAPE (v18.32 Phase 3d):
   {
     header: { date, window_start },
     metrics: {                      // frozen at upload time
       tickets_opened: { total, by_location, by_priority, items },
       tickets_closed: { total, by_location, avg_resolution_hours, items },
       aged_open_tickets: [ { id, title, location, priority, age_days, ... } ],
       pms_completed:    { total, items },
       equipment_activity: { total, by_type, items },
     },
     notes: { trends, wins, concerns, focus },
     checklist: { item_1..5 }       // Phase 3c placeholder retained
   }
   ════════════════════════════════════════════════════════════════════ */
(function(){

const INTERVAL_DAYS = 14;
const TERMINAL_STATUSES = ['closed', 'resolved', 'done'];

// v18.32 — Real biweekly checklist defaults (replaces the placeholder
// items that shipped in Phase 3c). Facility-management-focused starter
// items appropriate for a 14-day cadence across the three restaurants.
// User can edit/add/remove them via the inline editor in the biweekly
// view — the custom list persists to nexus_config.biweekly_checklist_items
// (org-wide, single-row config table).
const CHECKLIST_DEFAULTS = [
  { key: 'bw_hood',   label: 'Hood vents — grease buildup walk-through' },
  { key: 'bw_walkin', label: 'Walk-in cooler deep clean rotation' },
  { key: 'bw_fire',   label: 'Fire safety — extinguishers, emergency lights, exit signs' },
  { key: 'bw_pest',   label: 'Pest control — log review + schedule service' },
  { key: 'bw_water',  label: 'Ice machines descale check + water filter cartridge dates' },
];

const NOTES_SECTIONS = [
  { key: 'trends',   label: 'Trends',
    hint: 'Overall direction — are things improving, holding steady, or sliding?' },
  { key: 'wins',     label: 'Wins',
    hint: 'What went well in the past two weeks. Worth celebrating or replicating.' },
  { key: 'concerns', label: 'Concerns',
    hint: 'Warning signs, repeat problems, things to watch.' },
  { key: 'focus',    label: 'Next 2 Weeks Focus',
    hint: 'What you want to drive forward in the coming window.' },
];

const SECTIONS_TEMPLATE = {
  header: { date: '', window_start: '' },
  metrics: {
    tickets_opened: null,
    tickets_closed: null,
    aged_open_tickets: null,
    pms_completed: null,
    equipment_activity: null,
    // v18.32 Vendor V2 — Per-vendor performance snapshot for the
    // 14-day window. Combines:
    //   • window-scoped activity from equipment_issues (opened/closed/spend)
    //   • lifetime context from v_vendor_performance (grade, total jobs)
    // so the review shows BOTH "what they did this period" and "how
    // they're trending overall."
    vendor_performance: null,
  },
  notes: { trends: '', wins: '', concerns: '', focus: '' },
  // Per-review check state. Keys match items in the active checklist
  // (loaded from nexus_config or CHECKLIST_DEFAULTS). Old reviews with
  // item_1..item_5 keys still render fine — their bools just don't map
  // to any current item, so they're effectively dormant.
  checklist: {},
};

let state = {
  currentLog: null,
  recentLogs: [],
  dirty: false,
  saveTimer: null,
  isLoading: false,
  lastBiweeklyDate: null,
  liveMetrics: null,
  // v18.32 polish — live checklist item list. Loaded from
  // nexus_config.biweekly_checklist_items at init, falls back to
  // CHECKLIST_DEFAULTS if unset. Edited inline via the toggle in the
  // checklist section.
  checklistItems: CHECKLIST_DEFAULTS.slice(),
  checklistEditing: false,    // true when the user is editing the item labels
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const friendlyDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const friendlyDateShort = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function windowStart(endDateIso) {
  return shiftDate(endDateIso, -(INTERVAL_DAYS - 1));
}

function daysBetween(aIso, bIso) {
  const a = new Date(aIso + 'T12:00:00').getTime();
  const b = new Date(bIso + 'T12:00:00').getTime();
  return Math.round((b - a) / 86400000);
}

// Hydrate saved row data over the template + migrate 3c shape (notes
// as a string) to 3d shape (notes as a 4-key object).
function hydrateData(saved) {
  const base = deepClone(SECTIONS_TEMPLATE);
  if (!saved) return base;
  if (saved.header)    base.header    = Object.assign({}, base.header,    saved.header);
  if (saved.checklist) base.checklist = Object.assign({}, base.checklist, saved.checklist);
  if (saved.metrics)   base.metrics   = saved.metrics;
  // 3c → 3d notes migration. If saved.notes is a string, drop it into
  // the `concerns` slot (best-guess landing for free-text observations).
  if (typeof saved.notes === 'string') {
    base.notes = Object.assign({}, base.notes, { concerns: saved.notes });
  } else if (saved.notes && typeof saved.notes === 'object') {
    base.notes = Object.assign({}, base.notes, saved.notes);
  }
  return base;
}

// ─── ROLLUP METRICS QUERIES (v18.32 Phase 3d) ──────────────────────
async function loadMetrics(windowStartIso, windowEndIso) {
  if (!NX.sb) return null;
  const startTs = `${windowStartIso}T00:00:00.000Z`;
  const endTs   = `${windowEndIso}T23:59:59.999Z`;
  const [opened, closed, aged, pms, activity, vendors, dispatches] = await Promise.all([
    loadTicketsOpened(startTs, endTs),
    loadTicketsClosed(startTs, endTs),
    loadAgedOpenTickets(windowStartIso),
    loadPmsCompleted(startTs, endTs),
    loadEquipmentActivity(startTs, endTs),
    loadVendorPerformance(startTs, endTs),
    loadContractorDispatches(startTs, endTs),
  ]);
  return {
    tickets_opened: opened,
    tickets_closed: closed,
    aged_open_tickets: aged,
    pms_completed: pms,
    equipment_activity: activity,
    vendor_performance: vendors,
    contractor_dispatches: dispatches,
  };
}

// v18.32 Vendor V2 — vendor performance for the 14-day window.
// Pulls equipment_issues with vendor_id IN window (any movement),
// groups client-side per vendor, then enriches with lifetime stats
// from v_vendor_performance (where available) and contact info from
// the vendors table.
//
// Tolerates missing R&M infra: if equipment_issues or
// v_vendor_performance don't exist (or are inaccessible), each
// sub-query degrades to empty rather than blowing up the whole report.
async function loadVendorPerformance(startTs, endTs) {
  try {
    // 1) Issues with movement in window — opened or paid or just touched.
    // Use reported_at as the primary date axis since invoice_paid_at and
    // updated_at may not exist on every schema. Captures "vendors you
    // opened work with this period" — the most actionable lens.
    const { data: opened, error: openedErr } = await NX.sb.from('equipment_issues')
      .select('id, vendor_id, status, priority, reported_at, invoice_amount, invoice_paid_at, title')
      .not('vendor_id', 'is', null)
      .gte('reported_at', startTs)
      .lte('reported_at', endTs);
    if (openedErr) throw openedErr;

    // 2) Issues closed/paid in window (separate axis — these may have
    // been REPORTED outside the window but completed within it).
    const { data: paid, error: paidErr } = await NX.sb.from('equipment_issues')
      .select('id, vendor_id, status, priority, reported_at, invoice_amount, invoice_paid_at, title')
      .not('vendor_id', 'is', null)
      .gte('invoice_paid_at', startTs)
      .lte('invoice_paid_at', endTs);
    if (paidErr && paidErr.code !== '42703') throw paidErr;  // 42703 = column doesn't exist; tolerate

    // Combine + dedupe by issue id
    const allIssues = [...(opened || []), ...(paid || [])];
    const seen = new Set();
    const issues = allIssues.filter(i => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });

    if (!issues.length) return { total_vendors: 0, items: [], highlights: null };

    // 3) Group by vendor_id, compute window-scoped stats
    const TERMINAL = new Set(['repaired', 'invoice_paid', 'closed', 'cancelled']);
    const byVendor = new Map();
    issues.forEach(i => {
      if (!byVendor.has(i.vendor_id)) {
        byVendor.set(i.vendor_id, {
          vendor_id: i.vendor_id,
          window_opened: 0,
          window_closed: 0,
          window_spend: 0,
          window_titles: [],
        });
      }
      const entry = byVendor.get(i.vendor_id);
      const openedInWindow = i.reported_at && i.reported_at >= startTs && i.reported_at <= endTs;
      const paidInWindow   = i.invoice_paid_at && i.invoice_paid_at >= startTs && i.invoice_paid_at <= endTs;
      if (openedInWindow) entry.window_opened++;
      if (paidInWindow || (TERMINAL.has(i.status) && openedInWindow)) entry.window_closed++;
      if (paidInWindow && i.invoice_amount) entry.window_spend += Number(i.invoice_amount) || 0;
      if (i.title) entry.window_titles.push(i.title);
    });

    const vendorIds = Array.from(byVendor.keys());

    // 4) Pull vendor identity + lifetime performance in parallel
    const [vendorsRes, perfRes] = await Promise.all([
      NX.sb.from('vendors')
        .select('id, name, company, category, phone, last_contact_at')
        .in('id', vendorIds),
      NX.sb.from('v_vendor_performance')
        .select('*')
        .in('vendor_id', vendorIds)
        .then(r => r, () => ({ data: [], error: null })),  // tolerate missing view
    ]);
    if (vendorsRes.error) throw vendorsRes.error;
    const vendorById = {};
    (vendorsRes.data || []).forEach(v => { vendorById[v.id] = v; });
    const perfById = {};
    (perfRes.data || []).forEach(p => { perfById[p.vendor_id] = p; });

    // 5) Combine + compute lifetime grade. Reuse NXRM.score.vendorGrade
    // if the R&M ecosystem is loaded (canonical implementation).
    // Otherwise compute a simpler grade locally so the report still works.
    const computeGrade = (typeof window !== 'undefined' && window.NXRM && window.NXRM.score && window.NXRM.score.vendorGrade)
      ? window.NXRM.score.vendorGrade
      : simpleVendorGrade;

    const items = [];
    for (const [vid, entry] of byVendor.entries()) {
      const v = vendorById[vid] || {};
      const perf = perfById[vid] || {};
      const lifetime = {
        total_jobs:           Number(perf.total_jobs)         || 0,
        completed_jobs:       Number(perf.completed_jobs)     || 0,
        total_spend:          Number(perf.total_spend)        || 0,
        avg_response_hours:   perf.avg_response_hours == null ? null : Number(perf.avg_response_hours),
        avg_time_to_fix_hours:perf.avg_time_to_fix_hours == null ? null : Number(perf.avg_time_to_fix_hours),
      };
      const grade = computeGrade(lifetime);
      items.push({
        vendor_id: vid,
        name:      v.name || null,
        company:   v.company || v.name || '(unknown vendor)',
        category:  v.category || null,
        phone:     v.phone || null,
        last_contact_at: v.last_contact_at || null,
        // Window metrics
        window_opened: entry.window_opened,
        window_closed: entry.window_closed,
        window_spend:  Math.round(entry.window_spend * 100) / 100,
        window_titles: entry.window_titles.slice(0, 8),
        // Lifetime context
        lifetime,
        grade,
      });
    }
    items.sort((a, b) =>
      (b.window_opened + b.window_closed) - (a.window_opened + a.window_closed)
    );

    // 6) Highlights — best/slowest/biggest. Computed off the items list.
    let highlights = null;
    if (items.length) {
      const withGrade = items.filter(i => i.grade && i.grade.letter && i.grade.letter !== '—');
      const withResp  = items.filter(i => i.lifetime.avg_response_hours != null && i.lifetime.avg_response_hours > 0);
      const withSpend = items.filter(i => i.window_spend > 0);
      const gradeRank = ['A', 'B', 'C', 'D', 'F'];
      const best  = withGrade.sort((a, b) => gradeRank.indexOf(a.grade.letter) - gradeRank.indexOf(b.grade.letter))[0];
      const slow  = withResp.sort((a, b)  => b.lifetime.avg_response_hours - a.lifetime.avg_response_hours)[0];
      const big   = withSpend.sort((a, b) => b.window_spend - a.window_spend)[0];
      highlights = {
        best:   best ? { company: best.company, grade: best.grade.letter }                : null,
        slow:   slow ? { company: slow.company, response_hours: slow.lifetime.avg_response_hours } : null,
        big:    big  ? { company: big.company,  spend: big.window_spend }                 : null,
      };
    }

    return { total_vendors: items.length, items, highlights };
  } catch (e) {
    // R&M tables probably don't exist or aren't accessible. Don't blow
    // up the whole biweekly — degrade to empty section.
    console.warn('[biweekly] loadVendorPerformance:', e.message || e);
    return { total_vendors: 0, items: [], highlights: null };
  }
}

// Local fallback grade computation. Mirrors the NXRM.score.vendorGrade
// algorithm conceptually (completed-job rate + response time + ttf) so
// the report still gives meaningful grades when core.js isn't loaded.
function simpleVendorGrade(v) {
  const completed = Number(v.completed_jobs) || 0;
  const total     = Number(v.total_jobs) || 0;
  const resp      = Number(v.avg_response_hours);
  if (total < 2) return { letter: '—', label: 'New' };
  let s = 0;
  if (total > 0) s += (completed / total) * 50;
  if (!isNaN(resp) && resp > 0) {
    if (resp < 4)       s += 50;
    else if (resp < 24) s += 40;
    else if (resp < 48) s += 30;
    else if (resp < 72) s += 20;
    else                s += 10;
  } else s += 25;
  if (s >= 85) return { letter: 'A', label: 'Excellent' };
  if (s >= 70) return { letter: 'B', label: 'Good' };
  if (s >= 55) return { letter: 'C', label: 'Average' };
  if (s >= 40) return { letter: 'D', label: 'Below avg' };
  return { letter: 'F', label: 'Poor' };
}

async function loadTicketsOpened(startTs, endTs) {
  try {
    const { data, error } = await NX.sb.from('tickets')
      .select('id, title, location, priority, status, created_at')
      .gte('created_at', startTs)
      .lte('created_at', endTs)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return summarizeTickets(data || []);
  } catch (e) {
    console.warn('[biweekly] loadTicketsOpened:', e.message);
    return { total: 0, by_location: {}, by_priority: {}, items: [] };
  }
}

async function loadTicketsClosed(startTs, endTs) {
  try {
    const { data, error } = await NX.sb.from('tickets')
      .select('id, title, location, priority, status, created_at, closed_at')
      .gte('closed_at', startTs)
      .lte('closed_at', endTs)
      .in('status', ['closed', 'resolved'])
      .order('closed_at', { ascending: false });
    if (error) throw error;
    const items = (data || []).map(t => {
      const created = new Date(t.created_at).getTime();
      const closed  = new Date(t.closed_at).getTime();
      const duration_hours = (closed - created) / 3600000;
      return Object.assign({}, t, { duration_hours });
    });
    const sum = summarizeTickets(items);
    const durs = items.map(i => i.duration_hours).filter(h => h >= 0 && isFinite(h));
    sum.avg_resolution_hours = durs.length
      ? Math.round((durs.reduce((a, b) => a + b, 0) / durs.length) * 10) / 10
      : null;
    return sum;
  } catch (e) {
    console.warn('[biweekly] loadTicketsClosed:', e.message);
    return { total: 0, by_location: {}, by_priority: {}, items: [], avg_resolution_hours: null };
  }
}

// The chronic-problem tracker. "Aged open" = created before the start
// of the current window AND not yet in a terminal state. These keep
// rolling into every biweekly until they close.
async function loadAgedOpenTickets(windowStartIso) {
  try {
    const cutoffTs = `${windowStartIso}T00:00:00.000Z`;
    const { data, error } = await NX.sb.from('tickets')
      .select('id, title, location, priority, status, created_at, equipment_id')
      .lt('created_at', cutoffTs)
      .not('status', 'in', `(${TERMINAL_STATUSES.map(s => `"${s}"`).join(',')})`)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const today = todayISO();
    return (data || []).map(t => Object.assign({}, t, {
      age_days: daysBetween(t.created_at.slice(0, 10), today),
    }));
  } catch (e) {
    console.warn('[biweekly] loadAgedOpenTickets:', e.message);
    return [];
  }
}

async function loadPmsCompleted(startTs, endTs) {
  // Read the SAME source the daily log and PM logger use: equipment_maintenance
  // rows with event_type='pm'. The old query read equipment_events
  // event_type='pm_logged', which NOTHING writes — so this metric silently
  // reported 0 forever while real PMs piled up in equipment_maintenance.
  // event_date is a DATE, so window on the date portion.
  try {
    const startDate = String(startTs).slice(0, 10);
    const endDate = String(endTs).slice(0, 10);
    const { data, error } = await NX.sb.from('equipment_maintenance')
      .select('id, equipment_id, event_type, event_date, performed_by, cost')
      .eq('event_type', 'pm')
      .gte('event_date', startDate)
      .lte('event_date', endDate)
      .order('event_date', { ascending: false });
    if (error) throw error;
    const items = data || [];
    // best-effort per-location grouping via the equipment table
    const by_location = {};
    try {
      const ids = [...new Set(items.map(i => i.equipment_id).filter(Boolean))];
      if (ids.length) {
        const { data: eqs } = await NX.sb.from('equipment').select('id, location').in('id', ids);
        const locOf = {}; (eqs || []).forEach(e => { locOf[e.id] = e.location || '—'; });
        items.forEach(ev => { const loc = locOf[ev.equipment_id] || '—'; by_location[loc] = (by_location[loc] || 0) + 1; });
      }
    } catch (_) {}
    return { total: items.length, by_location, items };
  } catch (e) {
    console.warn('[biweekly] loadPmsCompleted:', e.message);
    return { total: 0, by_location: {}, items: [] };
  }
}

async function loadEquipmentActivity(startTs, endTs) {
  try {
    const { data, error } = await NX.sb.from('equipment_events')
      .select('id, equipment_id, event_type, payload, location, actor_name, occurred_at')
      .neq('event_type', 'pm_logged')
      .gte('occurred_at', startTs)
      .lte('occurred_at', endTs)
      .order('occurred_at', { ascending: false });
    if (error) throw error;
    const items = data || [];
    const by_type = {};
    items.forEach(ev => { by_type[ev.event_type] = (by_type[ev.event_type] || 0) + 1; });
    const statusChanges = items.filter(e => e.event_type === 'status_change');
    const lastByEq = new Map();
    statusChanges.forEach(ev => { lastByEq.set(ev.equipment_id, ev); });
    let currently_down = 0;
    for (const ev of lastByEq.values()) {
      const to = ev.payload && ev.payload.to;
      if (to === 'down' || to === 'broken') currently_down++;
    }
    return { total: items.length, by_type, currently_down, items };
  } catch (e) {
    console.warn('[biweekly] loadEquipmentActivity:', e.message);
    return { total: 0, by_type: {}, currently_down: 0, items: [] };
  }
}

// Contractor outreach in the window — calls/texts/emails/in-house dispatches.
async function loadContractorDispatches(startTs, endTs) {
  try {
    const { data, error } = await NX.sb.from('dispatch_events')
      .select('id, equipment_id, contractor_name, method, outcome, dispatched_at')
      .gte('dispatched_at', startTs)
      .lte('dispatched_at', endTs)
      .order('dispatched_at', { ascending: false });
    if (error) throw error;
    const items = data || [];
    const by_method = {};
    const by_outcome = {};
    items.forEach(d => {
      const m = d.method || 'call';
      by_method[m] = (by_method[m] || 0) + 1;
      const o = d.outcome || 'pending';
      by_outcome[o] = (by_outcome[o] || 0) + 1;
    });
    return { total: items.length, by_method, by_outcome, items };
  } catch (e) {
    console.warn('[biweekly] loadContractorDispatches:', e.message);
    return { total: 0, by_method: {}, by_outcome: {}, items: [] };
  }
}

function summarizeTickets(tickets) {
  const by_location = {};
  const by_priority = {};
  tickets.forEach(t => {
    const loc = (t.location || '—').trim() || '—';
    const pri = (t.priority || 'normal').trim() || 'normal';
    by_location[loc] = (by_location[loc] || 0) + 1;
    by_priority[pri] = (by_priority[pri] || 0) + 1;
  });
  return {
    total: tickets.length,
    by_location,
    by_priority,
    items: tickets.slice(0, 50),
  };
}

// ─── Supabase I/O ──────────────────────────────────────────────────
async function loadRecentLogs() {
  if (!NX.sb) return [];
  const user = NX.currentUser;
  const userId = user && user.id;
  let q = NX.sb.from('facility_logs')
    .select('id, log_date, created_by, created_by_name, drive_upload_status, drive_file_url, submitted_at')
    .eq('log_type', 'biweekly')
    .order('log_date', { ascending: false })
    .limit(20);
  if (userId) q = q.eq('created_by', userId);
  const { data, error } = await q;
  if (error) { console.error('[biweekly] loadRecentLogs:', error); return []; }
  return data || [];
}

async function loadLog(logDate) {
  if (!NX.sb) return null;
  const user = NX.currentUser;
  if (!user || !user.id) return null;
  const { data, error } = await NX.sb.from('facility_logs')
    .select('*')
    .eq('log_date', logDate)
    .eq('log_type', 'biweekly')
    .eq('created_by', user.id)
    .maybeSingle();
  if (error) { console.error('[biweekly] loadLog:', error); return null; }
  return data;
}

async function loadLastBiweeklyDate() {
  if (!NX.sb) return null;
  const user = NX.currentUser;
  if (!user || !user.id) return null;
  const today = todayISO();
  const { data, error } = await NX.sb.from('facility_logs')
    .select('log_date')
    .eq('log_type', 'biweekly')
    .eq('created_by', user.id)
    .lt('log_date', today)
    .not('submitted_at', 'is', null)
    .order('log_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.warn('[biweekly] loadLastBiweeklyDate:', error.message); return null; }
  return data && data.log_date;
}

async function saveLog(logData, options) {
  options = options || {};
  if (!NX.sb) return { error: 'No Supabase' };
  const user = NX.currentUser;
  if (!user || !user.id) return { error: 'You need to be signed in to save a review.' };
  const row = {
    log_date: logData.header.date || todayISO(),
    log_type: 'biweekly',
    created_by: user.id,
    created_by_name: user.name || null,
    data: logData,
    updated_at: new Date().toISOString(),
  };
  if (options.submit) {
    row.submitted_at = new Date().toISOString();
    row.drive_upload_status = 'pending';
  }
  const { data, error } = await NX.sb.from('facility_logs')
    .upsert(row, { onConflict: 'log_date,log_type,created_by' })
    .select()
    .single();
  if (error) {
    // v18.32 hotfix — same fallback as daily-log.js when the production
    // DB is missing the facility_logs_per_user_per_type_per_day unique
    // constraint. See sql/facility_logs_constraint_repair.sql for the
    // permanent fix.
    const isConflictMissing = error.code === '42P10' ||
      /no unique or exclusion constraint/i.test(error.message || '');
    if (isConflictMissing) {
      console.warn('[biweekly] upsert constraint missing — falling back to manual save. Run sql/facility_logs_constraint_repair.sql to fix permanently.');
      try {
        const { data: existing, error: selErr } = await NX.sb.from('facility_logs')
          .select('id')
          .eq('log_date', row.log_date)
          .eq('log_type', row.log_type)
          .eq('created_by', row.created_by)
          .limit(1)
          .maybeSingle();
        if (selErr) throw selErr;
        let result;
        if (existing && existing.id) {
          result = await NX.sb.from('facility_logs')
            .update(row).eq('id', existing.id).select().single();
        } else {
          result = await NX.sb.from('facility_logs')
            .insert(row).select().single();
        }
        if (result.error) throw result.error;
        if (!window._dlogConstraintWarned) {
          window._dlogConstraintWarned = true;
          if (NX.toast) NX.toast(
            'Save worked (fallback). Run sql/facility_logs_constraint_repair.sql to fix the DB.',
            'warn', 7000);
        }
        return { data: result.data };
      } catch (fbErr) {
        console.error('[biweekly] fallback save also failed:', fbErr);
        return { error: fbErr.message || 'Save failed (and fallback failed)' };
      }
    }
    console.error('[biweekly] saveLog:', error);
    return { error: error.message || 'Save failed' };
  }
  return { data };
}

// v18.32 — Load the org-wide biweekly checklist item list. Reads from
// the in-memory NX.config first (already pulled at app boot from
// nexus_config), falls back to a direct fetch if missing. If the user
// has never customized the list, returns CHECKLIST_DEFAULTS. Defensive
// against the column not yet being added (silently returns defaults).
async function loadChecklistItems() {
  // Prefer the in-memory copy already loaded at boot
  if (NX.config && Array.isArray(NX.config.biweekly_checklist_items)
      && NX.config.biweekly_checklist_items.length) {
    return validateItems(NX.config.biweekly_checklist_items);
  }
  // Fall back to a fresh read
  if (!NX.sb) return CHECKLIST_DEFAULTS.slice();
  try {
    const { data, error } = await NX.sb.from('nexus_config')
      .select('biweekly_checklist_items').eq('id', 1).maybeSingle();
    if (error) {
      // Column may not exist yet (migration not run) — log and degrade
      if (error.code !== '42703') console.warn('[biweekly] loadChecklistItems:', error.message);
      return CHECKLIST_DEFAULTS.slice();
    }
    const items = data && data.biweekly_checklist_items;
    if (Array.isArray(items) && items.length) {
      // Cache for future calls
      if (NX.config) NX.config.biweekly_checklist_items = items;
      return validateItems(items);
    }
    return CHECKLIST_DEFAULTS.slice();
  } catch (e) {
    console.warn('[biweekly] loadChecklistItems exception:', e);
    return CHECKLIST_DEFAULTS.slice();
  }
}

// Defensive shape-check — drop malformed entries, ensure every item has
// a unique non-empty key + label.
function validateItems(items) {
  const seenKeys = new Set();
  const out = [];
  items.forEach(i => {
    if (!i || typeof i !== 'object') return;
    const key   = String(i.key || '').trim();
    const label = String(i.label || '').trim();
    if (!key || !label || seenKeys.has(key)) return;
    seenKeys.add(key);
    out.push({ key, label });
  });
  return out.length ? out : CHECKLIST_DEFAULTS.slice();
}

// Persist the current checklist items to nexus_config. Best effort —
// failures are surfaced as a toast but don't roll back the local edit.
async function saveChecklistItems(items) {
  if (!NX.sb) return { error: 'No Supabase' };
  const cleaned = validateItems(items);
  try {
    const { error } = await NX.sb.from('nexus_config')
      .update({ biweekly_checklist_items: cleaned, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) {
      console.error('[biweekly] saveChecklistItems:', error);
      return { error: error.message || 'Save failed' };
    }
    // Mirror into in-memory cache so subsequent loads see the change
    if (NX.config) NX.config.biweekly_checklist_items = cleaned;
    return { ok: true, items: cleaned };
  } catch (e) {
    console.error('[biweekly] saveChecklistItems exception:', e);
    return { error: e.message || 'Save failed' };
  }
}

// Generate a stable random-ish key for a newly-added checklist item.
// Format keeps the "bw_" prefix for visual scanability in the DB.
function newChecklistItemKey() {
  return 'bw_' + Math.random().toString(36).slice(2, 9);
}

// ─── Render ─────────────────────────────────────────────────────────
function render() {
  const view = document.getElementById('biweeklyView');
  if (!view) return;

  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  const driveStatus = log && log.drive_upload_status;
  const hasDriveFile = !!(log && log.drive_file_id);
  const lastUploadedAt = log && log.drive_uploaded_at;
  const endDate = d.header.date || todayISO();
  const startDate = windowStart(endDate);

  // Prefer live metrics; fall back to frozen snapshot.
  const metrics = state.liveMetrics || d.metrics || null;

  let statusText, statusKind;
  if (driveStatus === 'uploaded' && lastUploadedAt) {
    const t = new Date(lastUploadedAt);
    const timeStr = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    statusText = `✓ Updated in Drive · ${timeStr}`; statusKind = 'uploaded';
  } else if (driveStatus === 'pending') { statusText = '⏳ Uploading…'; statusKind = 'pending'; }
  else if (driveStatus === 'failed') { statusText = '✗ Drive upload failed'; statusKind = 'failed'; }
  else { statusText = 'Not yet uploaded'; statusKind = 'draft'; }
  const uploadBtnLabel = hasDriveFile ? 'Update Drive doc' : 'Upload to Drive';

  let cadencePill = '';
  if (state.lastBiweeklyDate) {
    const next = shiftDate(state.lastBiweeklyDate, INTERVAL_DAYS);
    const daysToNext = daysBetween(todayISO(), next);
    if (daysToNext < 0) cadencePill = `<span class="dlog-status dlog-status-failed">Overdue by ${-daysToNext} day${daysToNext === -1 ? '' : 's'}</span>`;
    else if (daysToNext === 0) cadencePill = `<span class="dlog-status dlog-status-pending">Due today</span>`;
    else if (daysToNext <= 3) cadencePill = `<span class="dlog-status dlog-status-pending">Due in ${daysToNext} day${daysToNext === 1 ? '' : 's'}</span>`;
    else cadencePill = `<span class="dlog-status dlog-status-draft">Next due ${friendlyDateShort(next)}</span>`;
  } else {
    cadencePill = `<span class="dlog-status dlog-status-draft">First biweekly review</span>`;
  }

  view.innerHTML = `
    <div class="dlog-shell">
      <header class="dlog-header">
        <div class="dlog-title-row">
          <h1 class="dlog-title">Biweekly Review</h1>
          <button class="eq-btn eq-btn-secondary" id="bwNewBtn" title="Start a review for a different date">＋ New</button>
        </div>
        <p class="bw-window-label">Covers <b>${esc(friendlyDateShort(startDate))}</b> — <b>${esc(friendlyDateShort(endDate))}</b></p>
        <div class="dlog-meta">
          <label class="dlog-date-pick">
            <span class="dlog-meta-label">Window end</span>
            <input type="date" id="bwDateInput" value="${esc(endDate)}">
          </label>
          ${cadencePill}
          <span class="dlog-status dlog-status-${statusKind}">${esc(statusText)}</span>
          ${hasDriveFile ? `<a class="dlog-drive-link" href="${esc(log.drive_file_url || '#')}" target="_blank" rel="noopener">Open in Drive ↗</a>` : ''}
        </div>
      </header>

      ${renderRecentLogsStrip()}

      <form class="dlog-form" id="bwForm" autocomplete="off">
        ${renderAgedOpenTicketsCard(metrics)}
        ${renderRollupCards(metrics)}
        ${renderVendorPerformanceCard(metrics)}
        ${renderNotesSections(d)}
        ${renderChecklistSection(d)}

        <div class="dlog-actions">
          <button type="button" class="eq-btn eq-btn-secondary" id="bwSaveBtn">Save</button>
          <button type="button" class="eq-btn eq-btn-primary"   id="bwSubmitBtn">${esc(uploadBtnLabel)}</button>
        </div>
      </form>
    </div>
  `;
  wireForm();
}

function renderRecentLogsStrip() {
  if (!state.recentLogs || !state.recentLogs.length) return '';
  const rows = state.recentLogs.slice(0, 6).map(r => {
    const isOpen = state.currentLog && state.currentLog.id === r.id;
    return `
      <button type="button" class="dlog-recent-chip ${isOpen ? 'is-active' : ''}" data-log-date="${esc(r.log_date)}">
        <span class="dlog-recent-date">${esc(friendlyDateShort(r.log_date))}</span>
        ${r.submitted_at ? `<span class="dlog-recent-dot dlog-status-${r.drive_upload_status || 'pending'}"></span>` : ''}
      </button>`;
  }).join('');
  return `
    <div class="dlog-recent">
      <span class="dlog-recent-label">RECENT REVIEWS</span>
      <div class="dlog-recent-strip">${rows}</div>
    </div>`;
}

// The chronic-problem tracker — surfaced first, open by default.
function renderAgedOpenTicketsCard(metrics) {
  const aged = (metrics && metrics.aged_open_tickets) || [];
  const hint = aged.length
    ? `${aged.length} ticket${aged.length === 1 ? '' : 's'} open longer than 2 weeks — these roll forward every biweekly until closed.`
    : 'No tickets open longer than two weeks. 🎉';
  const rows = aged.length ? aged.map(t => {
    const pri = (t.priority || 'normal').toLowerCase();
    const priClass = pri === 'urgent' ? 'bw-pri-urgent' : (pri === 'low' ? 'bw-pri-low' : 'bw-pri-normal');
    return `
      <div class="bw-aged-row">
        <span class="bw-pri-pill ${priClass}">${esc(pri)}</span>
        <div class="bw-aged-main">
          <div class="bw-aged-title">${esc(t.title || 'Untitled ticket')}</div>
          <div class="bw-aged-meta">
            <span class="bw-aged-age">${t.age_days}d open</span>
            <span class="dlog-act-loc">${esc(t.location || '—')}</span>
          </div>
        </div>
      </div>`;
  }).join('') : '';
  return `
    <details class="dlog-section bw-card-chronic" open>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Chronic — open &gt; 2 weeks</span>
        <span class="dlog-section-count">${aged.length}</span>
      </summary>
      <div class="dlog-section-body">
        <p class="dlog-empty-hint">${esc(hint)}</p>
        ${rows ? `<div class="bw-aged-list">${rows}</div>` : ''}
      </div>
    </details>`;
}

function renderRollupCards(metrics) {
  const opened   = (metrics && metrics.tickets_opened)   || { total: 0, by_location: {}, by_priority: {}, items: [] };
  const closed   = (metrics && metrics.tickets_closed)   || { total: 0, by_location: {}, by_priority: {}, items: [], avg_resolution_hours: null };
  const pms      = (metrics && metrics.pms_completed)    || { total: 0, by_location: {}, items: [] };
  const activity = (metrics && metrics.equipment_activity)|| { total: 0, by_type: {}, currently_down: 0, items: [] };
  const calls    = (metrics && metrics.contractor_dispatches) || { total: 0, by_method: {}, by_outcome: {}, items: [] };

  const fmtAvg = (h) => {
    if (h == null) return '—';
    if (h < 1)   return `${Math.round(h * 60)} min`;
    if (h < 48)  return `${h.toFixed(1)} hr`;
    return `${(h / 24).toFixed(1)} days`;
  };
  const breakdownLine = (obj) => {
    const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<span class="bw-card-hint">No activity</span>';
    return entries.map(([k, v]) => `<span class="bw-bd-chip"><b>${v}</b> ${esc(k)}</span>`).join('');
  };

  return `
    <div class="bw-cards-grid">
      <div class="bw-card">
        <div class="bw-card-head"><span class="bw-card-title">Tickets opened</span><span class="bw-card-total">${opened.total}</span></div>
        <div class="bw-card-body">
          <div class="bw-card-row"><span class="bw-card-label">By location</span><div class="bw-bd">${breakdownLine(opened.by_location)}</div></div>
          <div class="bw-card-row"><span class="bw-card-label">By priority</span><div class="bw-bd">${breakdownLine(opened.by_priority)}</div></div>
        </div>
      </div>

      <div class="bw-card">
        <div class="bw-card-head"><span class="bw-card-title">Tickets closed</span><span class="bw-card-total">${closed.total}</span></div>
        <div class="bw-card-body">
          <div class="bw-card-row"><span class="bw-card-label">By location</span><div class="bw-bd">${breakdownLine(closed.by_location)}</div></div>
          <div class="bw-card-row"><span class="bw-card-label">Avg resolution</span><span class="bw-card-value">${esc(fmtAvg(closed.avg_resolution_hours))}</span></div>
        </div>
      </div>

      <div class="bw-card">
        <div class="bw-card-head"><span class="bw-card-title">PMs completed</span><span class="bw-card-total">${pms.total}</span></div>
        <div class="bw-card-body">
          <div class="bw-card-row"><span class="bw-card-label">By location</span><div class="bw-bd">${breakdownLine(pms.by_location)}</div></div>
        </div>
      </div>

      <div class="bw-card">
        <div class="bw-card-head"><span class="bw-card-title">Equipment activity</span><span class="bw-card-total">${activity.total}</span></div>
        <div class="bw-card-body">
          <div class="bw-card-row"><span class="bw-card-label">By type</span><div class="bw-bd">${breakdownLine(activity.by_type)}</div></div>
          <div class="bw-card-row"><span class="bw-card-label">Ended period down</span><span class="bw-card-value ${activity.currently_down > 0 ? 'bw-card-value-warn' : ''}">${activity.currently_down}</span></div>
        </div>
      </div>

      <div class="bw-card">
        <div class="bw-card-head"><span class="bw-card-title">Contractor calls</span><span class="bw-card-total">${calls.total}</span></div>
        <div class="bw-card-body">
          <div class="bw-card-row"><span class="bw-card-label">By method</span><div class="bw-bd">${breakdownLine(calls.by_method)}</div></div>
          <div class="bw-card-row"><span class="bw-card-label">By outcome</span><div class="bw-bd">${breakdownLine(calls.by_outcome)}</div></div>
        </div>
      </div>
    </div>`;
}

// v18.32 Vendor V2 — Vendor performance card.
// One row per vendor active in the 14-day window. Each row shows:
//   • Lifetime grade pill (A–F)
//   • Vendor name + category
//   • Window activity (issues opened/closed this period, spend this period)
//   • Lifetime context (total jobs, avg response time)
//   • Tap-to-call when phone is on file
// Highlights row at the top calls out best/slowest/biggest spender.
function renderVendorPerformanceCard(metrics) {
  const perf = metrics && metrics.vendor_performance;
  const items = (perf && perf.items) || [];
  const highlights = perf && perf.highlights;

  const fmtMoney = (n) => {
    if (!n || isNaN(n)) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  };
  const fmtHours = (h) => {
    if (h == null || isNaN(h)) return '—';
    if (h < 1)   return Math.round(h * 60) + 'm';
    if (h < 48)  return Math.round(h * 10) / 10 + 'h';
    return Math.round(h / 24 * 10) / 10 + 'd';
  };
  const gradeClass = (letter) => {
    if (letter === 'A') return 'bw-grade-a';
    if (letter === 'B') return 'bw-grade-b';
    if (letter === 'C') return 'bw-grade-c';
    if (letter === 'D') return 'bw-grade-d';
    if (letter === 'F') return 'bw-grade-f';
    return 'bw-grade-na';
  };

  const highlightsRow = highlights && (highlights.best || highlights.slow || highlights.big) ? `
    <div class="bw-vendor-highlights">
      ${highlights.best ? `<div class="bw-vendor-hl"><span class="bw-vendor-hl-label">Best</span><span class="bw-vendor-hl-value">${esc(highlights.best.company)} <small>(${esc(highlights.best.grade)})</small></span></div>` : ''}
      ${highlights.slow ? `<div class="bw-vendor-hl"><span class="bw-vendor-hl-label">Slowest response</span><span class="bw-vendor-hl-value">${esc(highlights.slow.company)} <small>(${esc(fmtHours(highlights.slow.response_hours))})</small></span></div>` : ''}
      ${highlights.big  ? `<div class="bw-vendor-hl"><span class="bw-vendor-hl-label">Biggest spend</span><span class="bw-vendor-hl-value">${esc(highlights.big.company)} <small>(${esc(fmtMoney(highlights.big.spend))})</small></span></div>` : ''}
    </div>
  ` : '';

  const rows = items.map(v => {
    const phoneHref = v.phone ? `<a class="bw-vendor-phone" href="tel:${esc(String(v.phone).replace(/[^\d+]/g, ''))}">📞</a>` : '';
    const grade = v.grade || { letter: '—' };
    return `
      <div class="bw-vendor-row">
        <span class="bw-vendor-grade ${gradeClass(grade.letter)}">${esc(grade.letter || '—')}</span>
        <div class="bw-vendor-main">
          <div class="bw-vendor-name">${esc(v.company)}${v.category ? ` <span class="bw-vendor-cat">${esc(v.category)}</span>` : ''}</div>
          <div class="bw-vendor-meta">
            <span class="bw-vendor-stat"><b>${v.window_opened}</b> opened</span>
            <span class="bw-vendor-stat"><b>${v.window_closed}</b> closed</span>
            ${v.window_spend > 0 ? `<span class="bw-vendor-stat bw-vendor-spend"><b>${esc(fmtMoney(v.window_spend))}</b> spend</span>` : ''}
            <span class="bw-vendor-stat-faint">lifetime: <b>${v.lifetime.total_jobs}</b> jobs · response <b>${esc(fmtHours(v.lifetime.avg_response_hours))}</b></span>
          </div>
        </div>
        ${phoneHref}
      </div>`;
  }).join('');

  return `
    <details class="dlog-section bw-card-vendors" ${items.length > 0 ? 'open' : ''}>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Vendor Performance</span>
        <span class="dlog-section-count">${items.length}</span>
      </summary>
      <div class="dlog-section-body">
        ${items.length
          ? `${highlightsRow}<div class="bw-vendor-list">${rows}</div>`
          : '<p class="dlog-empty-hint">No vendor activity in this 14-day window.</p>'}
      </div>
    </details>
  `;
}

function renderNotesSections(d) {
  const fields = NOTES_SECTIONS.map(s => `
    <label class="dlog-field">
      <span class="dlog-field-label">${esc(s.label)}</span>
      <span class="dlog-field-hint">${esc(s.hint)}</span>
      <textarea data-path="notes.${s.key}" rows="4" placeholder="">${esc((d.notes && d.notes[s.key]) || '')}</textarea>
    </label>
  `).join('');
  return `
    <details class="dlog-section" open>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Annotations</span>
      </summary>
      <div class="dlog-section-body">
        <div class="bw-notes-grid">${fields}</div>
      </div>
    </details>`;
}

function renderChecklistSection(d) {
  const checked = d.checklist || {};
  const items = state.checklistItems || [];
  const checkedCount = items.reduce((n, it) => n + (checked[it.key] ? 1 : 0), 0);

  // EDIT MODE: each item becomes a text input + delete button, plus an
  // "+ Add item" button. Save persists to nexus_config.
  if (state.checklistEditing) {
    const rows = items.map((item, idx) => `
      <div class="bw-checklist-edit-row" data-item-idx="${idx}">
        <input type="text" class="bw-checklist-edit-input" data-item-idx="${idx}" value="${esc(item.label)}" placeholder="Checklist item label">
        <button type="button" class="bw-checklist-item-remove" data-item-idx="${idx}" title="Remove item" aria-label="Remove item">×</button>
      </div>
    `).join('');
    return `
      <details class="dlog-section" open>
        <summary class="dlog-section-header">
          <span class="dlog-section-title">Checklist <small style="opacity:0.6;">— editing items</small></span>
          <span class="dlog-section-count">${items.length}</span>
        </summary>
        <div class="dlog-section-body">
          <p class="dlog-empty-hint">Edit the labels below. These items persist across all biweekly reviews until you change them again.</p>
          <div class="bw-checklist-edit-list">${rows}</div>
          <button type="button" class="eq-btn eq-btn-secondary dlog-add-row-btn" id="bwChecklistAddBtn">＋ Add item</button>
          <div class="dlog-actions" style="margin-top:12px;">
            <button type="button" class="eq-btn eq-btn-secondary" id="bwChecklistCancelBtn">Cancel</button>
            <button type="button" class="eq-btn eq-btn-primary" id="bwChecklistSaveBtn">Save items</button>
          </div>
        </div>
      </details>`;
  }

  // NORMAL MODE: checkboxes + small edit toggle in the header
  const rows = items.map(item => `
    <label class="dlog-check-row">
      <input type="checkbox" data-bipath="${esc(item.key)}" ${checked[item.key] ? 'checked' : ''}>
      <span class="dlog-check-label">${esc(item.label)}</span>
    </label>
  `).join('');
  return `
    <details class="dlog-section">
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Checklist</span>
        <span class="dlog-section-count">${checkedCount}/${items.length}</span>
      </summary>
      <div class="dlog-section-body">
        <div class="dlog-check-list">${rows}</div>
        <button type="button" class="bw-checklist-edit-toggle" id="bwChecklistEditBtn">✏ Edit items</button>
      </div>
    </details>`;
}

function wireForm() {
  const view = document.getElementById('biweeklyView');
  if (!view) return;

  const dateInput = view.querySelector('#bwDateInput');
  if (dateInput) {
    dateInput.addEventListener('change', async (e) => {
      const iso = e.target.value;
      if (!iso) return;
      await openLogForDate(iso);
    });
  }

  const newBtn = view.querySelector('#bwNewBtn');
  if (newBtn) newBtn.addEventListener('click', () => openLogForDate(todayISO()));

  view.querySelectorAll('[data-log-date]').forEach(btn => {
    btn.addEventListener('click', () => openLogForDate(btn.dataset.logDate));
  });

  // Notes textareas — walk dotted path (notes.trends, notes.wins, etc.)
  view.querySelectorAll('[data-path]').forEach(field => {
    field.addEventListener('input', () => {
      const log = ensureCurrentLog();
      const path = field.dataset.path;
      const parts = path.split('.');
      let cursor = log.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
        cursor = cursor[parts[i]];
      }
      cursor[parts[parts.length - 1]] = field.value;
      markDirty();
    });
  });

  view.querySelectorAll('[data-bipath]').forEach(box => {
    box.addEventListener('change', () => {
      const log = ensureCurrentLog();
      if (!log.data.checklist) log.data.checklist = {};
      log.data.checklist[box.dataset.bipath] = !!box.checked;
      markDirty();
      // Update live X/Y counter — count only checks for items in the
      // CURRENT checklist (ignore dormant keys from old reviews).
      const countEl = view.querySelector('.dlog-section-count');
      if (countEl) {
        const items = state.checklistItems || [];
        const checked = items.reduce((n, it) => n + (log.data.checklist[it.key] ? 1 : 0), 0);
        countEl.textContent = `${checked}/${items.length}`;
      }
    });
  });

  // ── Checklist EDIT MODE handlers ─────────────────────────────────
  const editToggle = view.querySelector('#bwChecklistEditBtn');
  if (editToggle) editToggle.addEventListener('click', () => {
    state.checklistEditing = true;
    render();
  });

  const cancelEdit = view.querySelector('#bwChecklistCancelBtn');
  if (cancelEdit) cancelEdit.addEventListener('click', () => {
    // Discard any in-form edits — fresh render reads from state.checklistItems
    // which we haven't mutated yet
    state.checklistEditing = false;
    render();
  });

  const saveEdit = view.querySelector('#bwChecklistSaveBtn');
  if (saveEdit) saveEdit.addEventListener('click', async () => {
    // Collect labels from each input. If the row had a key already
    // (existing item), preserve it; otherwise mint a new key. This
    // keeps per-review check-state stable when only labels change.
    const inputs = Array.from(view.querySelectorAll('.bw-checklist-edit-input'));
    const next = inputs.map(inp => {
      const idx = parseInt(inp.dataset.itemIdx, 10);
      const existing = state.checklistItems[idx];
      const label = (inp.value || '').trim();
      if (!label) return null;
      const key = (existing && existing.key) || newChecklistItemKey();
      return { key, label };
    }).filter(Boolean);
    if (!next.length) {
      if (NX.toast) NX.toast('Add at least one item before saving.', 'error', 3000);
      return;
    }
    const result = await saveChecklistItems(next);
    if (result.error) {
      if (NX.toast) NX.toast('Could not save: ' + result.error, 'error', 4500);
      return;
    }
    state.checklistItems = result.items;
    state.checklistEditing = false;
    if (NX.toast) NX.toast('Checklist items saved', 'success', 1800);
    render();
  });

  const addItemBtn = view.querySelector('#bwChecklistAddBtn');
  if (addItemBtn) addItemBtn.addEventListener('click', () => {
    // Pull current values from the existing inputs first so the user
    // doesn't lose unsaved edits when adding a row
    const inputs = Array.from(view.querySelectorAll('.bw-checklist-edit-input'));
    const updated = inputs.map((inp, idx) => {
      const existing = state.checklistItems[idx];
      return { key: existing ? existing.key : newChecklistItemKey(),
               label: (inp.value || existing && existing.label || '') };
    });
    updated.push({ key: newChecklistItemKey(), label: '' });
    state.checklistItems = updated;
    render();
  });

  view.querySelectorAll('.bw-checklist-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      // Same pattern as add — preserve in-form edits before mutating
      const idx = parseInt(btn.dataset.itemIdx, 10);
      const inputs = Array.from(view.querySelectorAll('.bw-checklist-edit-input'));
      const updated = inputs
        .map((inp, i) => i === idx ? null : {
          key: state.checklistItems[i] ? state.checklistItems[i].key : newChecklistItemKey(),
          label: inp.value || (state.checklistItems[i] && state.checklistItems[i].label) || '',
        })
        .filter(Boolean);
      state.checklistItems = updated;
      render();
    });
  });

  const saveBtn = view.querySelector('#bwSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => commitSave({ submit: false }));
  const submitBtn = view.querySelector('#bwSubmitBtn');
  if (submitBtn) submitBtn.addEventListener('click', () => commitSave({ submit: true }));
}

function ensureCurrentLog() {
  if (!state.currentLog) {
    state.currentLog = { log_date: todayISO(), data: hydrateData(null), submitted_at: null };
    state.currentLog.data.header.date = todayISO();
    state.currentLog.data.header.window_start = windowStart(todayISO());
  }
  if (!state.currentLog.data) state.currentLog.data = hydrateData(null);
  return state.currentLog;
}

function markDirty() {
  state.dirty = true;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => commitSave({ submit: false, quiet: true }), 3000);
}

async function commitSave(opts) {
  opts = opts || {};
  const log = ensureCurrentLog();
  const dateInput = document.getElementById('bwDateInput');
  if (dateInput && dateInput.value) {
    log.data.header.date = dateInput.value;
    log.data.header.window_start = windowStart(dateInput.value);
  }
  const result = await saveLog(log.data, { submit: !!opts.submit });
  if (result.error) {
    if (NX.toast) NX.toast('Save failed — ' + result.error, 'error', 4500);
    return;
  }
  state.currentLog = result.data;
  state.dirty = false;
  loadRecentLogs().then(rs => { state.recentLogs = rs; });

  if (opts.submit) {
    // v18.32 Phase 3d — freeze the live rollup metrics into data.metrics
    // before pushing to Drive. The frozen snapshot is the auditable
    // record of "what NEXUS saw at upload time."
    // v18.32 polish — also snapshot the active checklist item labels so
    // each Drive doc renders the labels that were in effect at upload,
    // even if the user later edits the org-wide list.
    try {
      const winStart = log.data.header.window_start || windowStart(log.data.header.date);
      const winEnd   = log.data.header.date;
      const freshMetrics = await loadMetrics(winStart, winEnd);
      state.liveMetrics = freshMetrics;
      log.data.metrics = freshMetrics;
      log.data.checklist_items = state.checklistItems;
      await NX.sb.from('facility_logs').update({ data: log.data }).eq('id', state.currentLog.id);
      state.currentLog.data = log.data;
    } catch (e) {
      console.warn('[biweekly] metrics snapshot freeze failed (non-fatal):', e);
    }
    render();
    await driveUploadAndUpdateRow(state.currentLog);
  } else if (!opts.quiet && NX.toast) {
    NX.toast('Draft saved', 'success', 1800);
  }
}

async function driveUploadAndUpdateRow(logRow) {
  if (!logRow || !logRow.id) return;
  if (!NX.drive || !NX.drive.uploadBiweeklyLog) {
    if (NX.toast) NX.toast('Drive helper not loaded — refresh the page', 'error', 4500);
    return;
  }
  state.currentLog.drive_upload_status = 'pending';
  render();
  if (NX.toast) NX.toast('Uploading to Drive…', 'info', 2200);
  try {
    const result = await NX.drive.uploadBiweeklyLog(logRow.data, {
      existingFileId: logRow.drive_file_id || null,
    });
    const { error: updErr } = await NX.sb.from('facility_logs').update({
      drive_file_id: result.fileId,
      drive_file_url: result.webViewLink,
      drive_upload_status: 'uploaded',
      drive_uploaded_at: new Date().toISOString(),
      drive_upload_error: null,
    }).eq('id', logRow.id);
    if (updErr) throw updErr;
    state.currentLog.drive_file_id = result.fileId;
    state.currentLog.drive_file_url = result.webViewLink;
    state.currentLog.drive_upload_status = 'uploaded';
    state.currentLog.drive_uploaded_at = new Date().toISOString();
    state.currentLog.drive_upload_error = null;
    if (NX.toast) NX.toast('Drive updated ✓', 'success', 2000);
    render();
    loadLastBiweeklyDate().then(d => { state.lastBiweeklyDate = d; });
  } catch (err) {
    console.error('[biweekly] drive upload:', err);
    state.currentLog.drive_upload_status = 'failed';
    state.currentLog.drive_upload_error = err.message || String(err);
    await NX.sb.from('facility_logs').update({
      drive_upload_status: 'failed',
      drive_upload_error: err.message || String(err),
    }).eq('id', logRow.id);
    if (NX.toast) NX.toast('Drive upload failed: ' + (err.message || ''), 'error', 5000);
    render();
  }
}

async function openLogForDate(iso) {
  state.isLoading = true;
  const winStart = windowStart(iso);
  const [existing, liveMetrics] = await Promise.all([
    loadLog(iso),
    loadMetrics(winStart, iso),
  ]);
  state.liveMetrics = liveMetrics;
  if (existing) {
    state.currentLog = existing;
    if (!state.currentLog.data) state.currentLog.data = hydrateData(null);
    state.currentLog.data.header.date = iso;
    state.currentLog.data.header.window_start = winStart;
  } else {
    state.currentLog = { log_date: iso, data: hydrateData(null), submitted_at: null };
    state.currentLog.data.header.date = iso;
    state.currentLog.data.header.window_start = winStart;
  }
  state.isLoading = false;
  render();
}

async function init() {
  const today = todayISO();
  const winStart = windowStart(today);
  const [rs, todayRow, lastDate, liveMetrics, checklistItems] = await Promise.all([
    loadRecentLogs(),
    loadLog(today),
    loadLastBiweeklyDate(),
    loadMetrics(winStart, today),
    loadChecklistItems(),
  ]);
  state.recentLogs = rs;
  state.lastBiweeklyDate = lastDate;
  state.liveMetrics = liveMetrics;
  state.checklistItems = checklistItems;
  if (todayRow) {
    state.currentLog = todayRow;
  } else {
    state.currentLog = { log_date: today, data: hydrateData(null), submitted_at: null };
    state.currentLog.data.header.date = today;
    state.currentLog.data.header.window_start = winStart;
  }
  render();
}

async function show() {
  const date = (state.currentLog && state.currentLog.log_date) || todayISO();
  const winStart = windowStart(date);
  const [rs, current, lastDate, liveMetrics, checklistItems] = await Promise.all([
    loadRecentLogs(),
    loadLog(date),
    loadLastBiweeklyDate(),
    loadMetrics(winStart, date),
    loadChecklistItems(),
  ]);
  state.recentLogs = rs;
  state.lastBiweeklyDate = lastDate;
  state.liveMetrics = liveMetrics;
  state.checklistItems = checklistItems;
  if (current) {
    state.currentLog = current;
  } else if (!state.currentLog) {
    state.currentLog = { log_date: date, data: hydrateData(null), submitted_at: null };
    state.currentLog.data.header.date = date;
    state.currentLog.data.header.window_start = winStart;
  }
  render();
}

if (!NX.modules) NX.modules = {};
NX.modules.biweekly = { init, show };

console.log('[biweekly-log] v18.32 Phase 3d loaded — rollup metrics + chronic ticket tracker');

})();
