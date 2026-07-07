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

// ─── DATA SHAPE (v18.32 Phase 3a — dynamic locations) ────────────────
// Previously had hardcoded `este` and `suerte` keys at the top level.
// Now `locations` is an array — user can add more on the fly via the
// "+ Add Location" button (options come from distinct equipment.location
// values; no free-text — keeps location names consistent across NEXUS).
// `other_properties` stays for the catch-all notes table.
//
// Old logs (with data.este / data.suerte) are migrated in hydrateData()
// on read — no DB migration needed, no destructive rewrites. The
// migrated shape only persists once the user saves the log again.
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
  // Dynamic array. Fresh logs preset with Este + Suerte (the historical
  // defaults). User can add/remove via the + Add Location button.
  // Shape per item: { id, label, rm: {10 categories}, vendor_calls: [] }
  locations: [],
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
  // v18.32 Phase 3c — biweekly content moved to its own view + module
  // (js/biweekly-log.js). Pre-3c logs that had data.biweekly populated
  // still keep it in their JSONB row — it's just no longer rendered here.
  // Users can rebuild it inside the new Biweekly Review view if they want.
};

// R&M category labels — used to render the 10 fields per location
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

// Default presets for brand-new logs (no historical data to migrate)
const DEFAULT_LOCATION_PRESETS = [
  { id: 'este',   label: 'Este'   },
  { id: 'suerte', label: 'Suerte' },
];

// In-memory state
let state = {
  currentLog: null,         // { id, log_date, data, drive_*, etc. }
  recentLogs: [],           // recent logs strip
  dirty: false,
  saveTimer: null,
  isLoading: false,
  // Cache of distinct equipment.location values, populated on init.
  // Used to populate the "+ Add Location" dropdown. Refreshed each
  // time the user opens the picker so newly-added equipment locations
  // appear without a page refresh.
  equipmentLocations: [],
  activeLoc: 'all',          // location pill selection: 'all' (Overview) or a location key
  // v18.32 Phase 3b — live equipment activity feed for the current log.
  // Re-queried whenever the log date changes (openLogForDate) so users
  // always see today's-state-of-the-world. Frozen at upload time by
  // attaching to logData.equipment_activity before the Drive doc is
  // generated — keeps the doc auditable to "what NEXUS saw at upload".
  equipmentActivity: [],
  // v18.33 — live ticket slices for the current log_date, pulled from
  // the Board (kanban_cards). Three lists: open / working / closed.
  // Same freeze-at-submit pattern as equipmentActivity — the form shows
  // live, the Drive doc captures the moment of submission. Render path
  // prefers the row's frozen snapshot (data.tickets) for already-
  // submitted past logs since the live query can't reconstruct
  // historical state.
  ticketSlices: null,
  // Ordering rollup — read-only view of the dedicated "Ordering" board
  // (boards.kind='ordering'), grouped by location. Each location bucket is
  // { to_order:[], ordered:[], received:[] }. Populated by loadOrdering on
  // log open. orderingBoardId is also used to keep these procurement cards
  // OUT of the Board-tickets rollup (which reads all kanban_cards).
  orderingByLoc: {},
  orderingBoardId: null,
  // v18.32 Vendor V1 — cached vendor list from the R&M vendors table.
  // Used for the vendor_calls picker (autocomplete) + the "Vendor
  // Activity Today" rollup section. The R&M ecosystem's vendors table
  // has its own schema (company, name, category, phone, email, active,
  // is_preferred, is_emergency) — we read it but don't mutate it
  // except to bump last_contact_at when a saved daily log references
  // a known vendor by name.
  vendors: [],
  // Per-vendor open equipment_issues count for "vendor status" display
  // in the daily log. Keyed by vendor_id. Refreshed on log open.
  vendorOpenIssues: {},
  // v18.32 — Equipment currently in a non-operational state. Loaded
  // from equipment table on log open. Each entry carries the live
  // status_note (read/written by BOTH this view and the equipment
  // edit form — single source of truth). As long as a piece of
  // equipment has status != 'operational' AND !archived, it appears
  // in every daily log until fixed.
  equipmentDown: [],
  pmScheduleByEq: {},   // equipment_id → earliest upcoming pm_schedules row
  // v18.32 — full non-archived fleet (all statuses), for the daily-log
  // Maintenance-health + Warranty stats. Populated by loadEquipmentDown.
  equipmentHealth: [],
  // v18.35 — most-recent OPEN equipment_issue per down unit (was a call placed?).
  openIssuesByEq: {},
};

// ─── Helpers ────────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Build the empty-rm shape used by every location
function makeEmptyRm() {
  const rm = {};
  RM_CATEGORIES.forEach(c => { rm[c.key] = ''; });
  return rm;
}

// Derive a stable id from a location label. Letters/digits only, lowercased,
// underscores for separators. Used when migrating old logs or adding new
// locations.
function locationIdFromLabel(label) {
  return String(label || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'loc_' + Math.random().toString(36).slice(2, 7);
}

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

// Merge a saved log's data over the template skeleton + handle the
// v18.32 Phase 3a old-shape → new-shape migration in memory.
//
// Three cases:
//   1. saved.locations exists       → use as-is (already new shape)
//   2. saved.este or saved.suerte   → migrate old hardcoded keys into a
//                                     locations array (one-time, on read)
//   3. neither                      → fresh log; preset Este + Suerte
//
// Migration is idempotent — calling hydrateData repeatedly on already-
// migrated data is a no-op. The migrated shape only persists to Supabase
// once the user saves the log again. That makes the rollout zero-risk:
// old logs continue to render, and don't get rewritten unless touched.
function hydrateData(saved) {
  const base = deepClone(SECTIONS_TEMPLATE);
  if (!saved) {
    // Brand-new log — preset default locations
    base.locations = DEFAULT_LOCATION_PRESETS.map(p => ({
      id: p.id,
      label: p.label,
      rm: makeEmptyRm(),
      vendor_calls: [],
    }));
    return base;
  }
  // Copy the static sections
  if (saved.header)   base.header   = Object.assign({}, base.header,   saved.header);
  if (saved.planning) base.planning = Object.assign({}, base.planning, saved.planning);
  if (saved.cleaning) base.cleaning = Object.assign({}, base.cleaning, saved.cleaning);
  // Phase 3c — biweekly key intentionally NOT hydrated. Old rows still
  // carry it in JSONB but it's no longer rendered by this module.
  if (Array.isArray(saved.other_properties)) {
    base.other_properties = saved.other_properties;
  }
  // Locations — handle all three migration cases
  if (Array.isArray(saved.locations) && saved.locations.length) {
    // Already new shape — pass through, defensively shape-check each item.
    // v18.32 hotfix — if a location has an empty/null label (corrupted or
    // legacy data), derive a sensible label from its id ("este" → "Este",
    // "bar-toti" → "Bar Toti") instead of forcing "Untitled". Falls back
    // to "Location N" if no id either. Also MUTATES the source so saving
    // writes back proper labels — repairs the stuck "Untitled" state
    // permanently after first open.
    base.locations = saved.locations.map((loc, i) => {
      let label = (loc.label || '').trim();
      if (!label) {
        if (loc.id) {
          // Match preset by id first (best match)
          const preset = DEFAULT_LOCATION_PRESETS.find(p => p.id === loc.id);
          if (preset) label = preset.label;
          else {
            // Derive from id: "bar-toti" → "Bar Toti"
            label = String(loc.id).split(/[-_]+/)
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ');
          }
        } else {
          label = `Location ${i + 1}`;
        }
        // Write the repaired label back to source so the next save
        // persists it. Stops the "stuck Untitled" loop.
        loc.label = label;
      }
      // Spread the saved location first so the free-text note survives
      // re-hydration; then normalize the known structural fields.
      return Object.assign({}, loc, {
        id: loc.id || locationIdFromLabel(label),
        label,
        rm: Object.assign({}, makeEmptyRm(), loc.rm || {}),
        vendor_calls: Array.isArray(loc.vendor_calls) ? loc.vendor_calls : [],
      });
    });
  } else if (saved.este || saved.suerte) {
    // Old shape — migrate. Pull vendor_calls out, treat the rest as rm fields.
    base.locations = [];
    ['este', 'suerte'].forEach(legacyKey => {
      if (!saved[legacyKey]) return;
      const old = saved[legacyKey];
      const rm = makeEmptyRm();
      RM_CATEGORIES.forEach(c => {
        if (typeof old[c.key] === 'string') rm[c.key] = old[c.key];
      });
      base.locations.push({
        id: legacyKey,
        label: legacyKey === 'este' ? 'Este' : 'Suerte',
        rm,
        vendor_calls: Array.isArray(old.vendor_calls) ? old.vendor_calls : [],
      });
    });
  } else {
    // Saved row exists but has no locations data at all — preset
    base.locations = DEFAULT_LOCATION_PRESETS.map(p => ({
      id: p.id, label: p.label, rm: makeEmptyRm(), vendor_calls: [],
    }));
  }
  return base;
}

// Pull distinct equipment locations from the equipment table — used to
// populate the "+ Add Location" dropdown. Cached in state.equipmentLocations
// after first call; explicit refresh on each picker open keeps the list
// fresh without per-keystroke queries.
async function loadEquipmentLocations() {
  if (!NX.sb) return [];
  const { data, error } = await NX.sb.from('equipment')
    .select('location')
    .not('location', 'is', null)
    .neq('location', '')
    .order('location');
  if (error) {
    console.warn('[daily-log] equipment locations load failed:', error.message);
    return state.equipmentLocations || [];
  }
  // Distinct + sorted (Supabase doesn't have a built-in DISTINCT in the
  // select() builder; dedupe client-side)
  const seen = new Set();
  const out = [];
  (data || []).forEach(row => {
    const loc = (row.location || '').trim();
    if (!loc || seen.has(loc.toLowerCase())) return;
    seen.add(loc.toLowerCase());
    out.push(loc);
  });
  state.equipmentLocations = out;
  return out;
}

// ─── Supabase I/O ───────────────────────────────────────────────────
// v18.32 Phase 3b — pull equipment activity for a given log date.
// Reads from equipment_events (the typed activity stream). For
// status_change events, we collapse multiple flips during the same day
// into a single "net change" entry: started-as / ended-as. If the
// equipment ended the day in the same state it started, the entry is
// dropped entirely (no net change — a flip-flop with no impact).
//
// Other event types (pm_logged, location_change, archived, restored,
// part_replacement, etc.) are passed through as-is — they're discrete
// events, not stateful flips, so each one is meaningful on its own.
//
// v18.32 hotfix — Also pulls equipment_issues activity for the day:
// issues opened today (reported_at), issues paid today (invoice_paid_at).
// These are mapped to synthetic "event" objects in the same shape as
// equipment_events so the existing render path handles them uniformly.
// This ties the parallel R&M and tickets ecosystems together in the
// daily log's activity view without merging the underlying tables.
// PMs performed on a given date — straight from equipment_maintenance (which
// always has performed_by + cost), joined to equipment for name + location, so
// the daily log can show "PMs logged today" grouped by location and by who.
async function loadPmsForDate(logDate) {
  if (!NX.sb || !logDate) return [];
  try {
    let { data, error } = await NX.sb.from('equipment_maintenance')
      .select('id, equipment_id, event_date, performed_by, cost, description, equipment:equipment_id(name, location)')
      .eq('event_type', 'pm').eq('event_date', logDate)
      .order('id', { ascending: false });
    if (error) {   // FK embed not available — fall back to flat columns
      const r = await NX.sb.from('equipment_maintenance')
        .select('id, equipment_id, event_date, performed_by, cost, description')
        .eq('event_type', 'pm').eq('event_date', logDate);
      data = r.data || [];
    }
    return data || [];
  } catch (_) { return []; }
}

async function loadEquipmentActivity(logDate) {
  if (!NX.sb || !logDate) return [];
  const dayStart = `${logDate}T00:00:00.000Z`;
  const dayEnd   = `${logDate}T23:59:59.999Z`;
  // Pull both streams in parallel. equipment_issues may not exist
  // (no R&M ecosystem) — that's fine, we just degrade to events-only.
  const [eventsRes, openedRes, paidRes, dispatchRes] = await Promise.all([
    NX.sb.from('equipment_events')
      .select('id, equipment_id, event_type, payload, location, actor_name, occurred_at')
      .gte('occurred_at', dayStart).lte('occurred_at', dayEnd)
      .order('occurred_at', { ascending: true }),
    NX.sb.from('equipment_issues')
      .select('id, equipment_id, title, status, priority, reported_at, reported_by_name, vendor_id')
      .gte('reported_at', dayStart).lte('reported_at', dayEnd)
      .order('reported_at', { ascending: true })
      .then(r => r, () => ({ data: [], error: null })),
    NX.sb.from('equipment_issues')
      .select('id, equipment_id, title, status, invoice_amount, invoice_paid_at, vendor_id')
      .gte('invoice_paid_at', dayStart).lte('invoice_paid_at', dayEnd)
      .order('invoice_paid_at', { ascending: true })
      .then(r => r, () => ({ data: [], error: null })),
    NX.sb.from('dispatch_events')
      .select('id, equipment_id, contractor_name, method, issue_description, dispatched_by, outcome, dispatched_at')
      .gte('dispatched_at', dayStart).lte('dispatched_at', dayEnd)
      .order('dispatched_at', { ascending: true })
      .then(r => r, () => ({ data: [], error: null })),
  ]);
  if (eventsRes.error) {
    console.warn('[daily-log] loadEquipmentActivity events:', eventsRes.error.message);
  }
  const events = eventsRes.data || [];

  // Map equipment_issues rows into synthetic event objects so the
  // render path can treat them uniformly. Two event types:
  //   • issue_opened  — payload: { title, priority, status, vendor_id }
  //   • issue_paid    — payload: { title, invoice_amount, vendor_id }
  const issueEvents = [];
  ((openedRes && openedRes.data) || []).forEach(i => {
    issueEvents.push({
      id: 'issue-opened-' + i.id,
      equipment_id: i.equipment_id,
      event_type: 'issue_opened',
      payload: {
        title: i.title,
        priority: i.priority,
        status: i.status,
        vendor_id: i.vendor_id || null,
        issue_id: i.id,
      },
      location: null,
      actor_name: i.reported_by_name || null,
      occurred_at: i.reported_at,
    });
  });
  ((paidRes && paidRes.data) || []).forEach(i => {
    issueEvents.push({
      id: 'issue-paid-' + i.id,
      equipment_id: i.equipment_id,
      event_type: 'issue_paid',
      payload: {
        title: i.title,
        invoice_amount: i.invoice_amount,
        vendor_id: i.vendor_id || null,
        issue_id: i.id,
      },
      location: null,
      actor_name: null,
      occurred_at: i.invoice_paid_at,
    });
  });
  // Contractor calls/texts/dispatches logged today → surface alongside the
  // equipment + issue streams so the day's outreach is visible.
  ((dispatchRes && dispatchRes.data) || []).forEach(d => {
    issueEvents.push({
      id: 'dispatch-' + d.id,
      equipment_id: d.equipment_id,
      event_type: 'contractor_dispatched',
      payload: {
        method: d.method,
        contractor_name: d.contractor_name,
        issue_description: d.issue_description,
        outcome: d.outcome,
      },
      location: null,
      actor_name: d.dispatched_by || null,
      occurred_at: d.dispatched_at,
    });
  });

  return collapseStatusChanges([...events, ...issueEvents]);
}

// Given a day's events ordered oldest-first, produce a list where each
// equipment_id has at most ONE status_change entry — representing the
// net change from start-of-day to end-of-day. Other event types are
// passed through unchanged. Final list is re-sorted newest-first for
// display.
function collapseStatusChanges(events) {
  const firstByEq = new Map();   // equipment_id → first status_change event of the day
  const lastByEq  = new Map();   // equipment_id → last  status_change event of the day
  const other = [];
  events.forEach(ev => {
    if (ev.event_type === 'status_change') {
      if (!firstByEq.has(ev.equipment_id)) firstByEq.set(ev.equipment_id, ev);
      lastByEq.set(ev.equipment_id, ev);
    } else {
      other.push(ev);
    }
  });
  const netStatusChanges = [];
  for (const [equipId, firstEv] of firstByEq.entries()) {
    const lastEv = lastByEq.get(equipId);
    const netFrom = firstEv.payload && firstEv.payload.from;
    const netTo   = lastEv.payload  && lastEv.payload.to;
    // Drop entries where the equipment ended the day in the same state
    // it started — that's a flip-flop with no net effect.
    if (netFrom != null && netFrom === netTo) continue;
    // How many intermediate flips happened in between (informational —
    // surfaced in the section title as a small badge)
    const flipCount = events.filter(e =>
      e.event_type === 'status_change' && e.equipment_id === equipId
    ).length;
    netStatusChanges.push({
      ...lastEv,
      payload: {
        ...(lastEv.payload || {}),
        from: netFrom,
        to: netTo,
        // Prefer the label of the day's first event for "from" (matches
        // the start-of-day state); last event's label for "to" (end-of-day).
        from_label: (firstEv.payload && firstEv.payload.from_label) || netFrom,
        to_label:   (lastEv.payload  && lastEv.payload.to_label)    || netTo,
        equipment_name: (lastEv.payload && lastEv.payload.equipment_name)
                     || (firstEv.payload && firstEv.payload.equipment_name)
                     || null,
        _flip_count: flipCount,
        _is_net: flipCount > 1,
      },
    });
  }
  return [...netStatusChanges, ...other]
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
}

// v18.32 Phase 3e — daily ticket slices.
// Returns three lists for a given log_date:
//   • opened_today  — tickets where created_at falls on logDate
//   • closed_today  — tickets where closed_at falls on logDate AND status is terminal
//   • open_as_of    — tickets currently open (not closed/resolved) AND created on/before logDate
//
// v18.33 — REWRITTEN to pull from the Board (kanban_cards) instead of
// the `tickets` table. The Board is where the actual work-tracking
// happens; the `tickets` table is just the auto-generated inbound
// stream (QR scans, AI reports). Three buckets aligned to the Board's
// lane model:
//   • open    — status reported / triaged          (logged, not started)
//   • working — Dispatched / In Progress / Waiting on Parts (active)
//   • closed  — Resolved / Closed, closed today (finished today)
//
// IMPORTANT: cards are bucketed by their LIST (list_id → board_lists),
// NOT by the `status` field. Newly-created cards insert with status=null
// and column_name='' — `status` only gets populated when a card is
// *moved* via the board's moveCard(). The board itself derives a card's
// lane from its list (see board.js isDone()), so we mirror that: load
// the lists, then classify each card by its list's name.
//
// Cards carry equipment_id (link to a piece of equipment), priority,
// location. Archived cards are excluded (tolerant of NULL archived).
//
// "closed today" prefers kanban_cards.closed_at (set by board.js +
// log.js on move-to-done); falls back to updated_at when closed_at is
// absent (pre-migration).

// Classify a board list NAME into one of our three buckets. Mirrors
// board.js's done-detection regex + adds working/open split.
// ═══════════════════════════════════════════════════════════════════
// LOCATION GROUPING (v18.35)
// Equipment Status + Board Tickets are split by location. The three data
// sources store location differently:
//   • board cards  → key:   'suerte' | 'este' | 'toti'
//   • equipment    → label: 'Suerte' | 'Este' | 'Bar Toti'
//   • log location → label: 'Este' | 'Suerte' (with id 'este'/'suerte')
// normLocKey collapses any of these to one canonical key so they group
// together. Unknown/empty → '' (rendered as "Unassigned").
// ═══════════════════════════════════════════════════════════════════
function normLocKey(v) {
  const s = (v == null ? '' : String(v)).toLowerCase().trim();
  if (!s) return '';
  if (s.includes('suerte')) return 'suerte';
  if (s.includes('este'))   return 'este';
  if (s.includes('toti'))   return 'toti';   // 'toti' or 'bar toti'
  if (s.includes('karaz'))  return 'karaz';  // forthcoming 4th location
  return s;
}
function locDisplayLabel(key) {
  return ({ suerte: 'Suerte', este: 'Este', toti: 'Bar Toti', karaz: 'Karaz' })[key]
    || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unassigned');
}
// Decide which location groups to render and in what order. The log's
// ACTIVE locations come first (in their log order); then any location
// that has equipment/cards but isn't active in the log auto-populates
// after (in preset order); 'Unassigned' ('') always last. Only keys that
// actually have items (in presentKeys) are returned.
function orderedLocationKeys(d, presentKeys) {
  const seen = new Set();
  const ordered = [];
  const push = (k) => { if (presentKeys.has(k) && !seen.has(k)) { seen.add(k); ordered.push(k); } };
  // 1. Active log locations, in log order
  (d.locations || []).forEach(l => push(normLocKey(l.label)));
  // 2. Auto-populated: preset order, then any other present keys
  ['suerte', 'este', 'toti', 'karaz'].forEach(push);
  [...presentKeys].forEach(k => { if (k) push(k); });
  // 3. Unassigned last
  push('');
  return ordered;
}

function classifyListName(name) {
  const n = (name || '').toLowerCase();
  if (/(done|closed|resolved|complete|completed|archived?|paid)/.test(n)) return 'closed';
  if (/(progress|dispatch|waiting|parts|working|active|assigned)/.test(n)) return 'working';
  return 'open';  // reported, triaged, new, backlog, to-?do, etc.
}

// Fallback lane label when a card's list can't be resolved — derive
// something readable from the status field.
function laneLabelFromStatus(status) {
  return ({
    reported: 'Reported', triaged: 'Triaged', dispatched: 'Dispatched',
    in_progress: 'In Progress', waiting_parts: 'Waiting on Parts',
    resolved: 'Resolved', closed: 'Closed', done: 'Done',
  })[status] || (status ? String(status).replace(/_/g, ' ') : '');
}

async function loadTicketSlices(logDate) {
  if (!NX.sb || !logDate) {
    return { open: [], working: [], closed: [] };
  }
  // Local day boundaries (NOT UTC). The user's "today" is their local day;
  // UTC midnight pulled tickets closed late yesterday (local) into today's
  // window. No `Z` → parsed as local time.
  const dayStart = `${logDate}T00:00:00`;
  const dayEnd   = `${logDate}T23:59:59.999`;

  // 1. Load the board lists so we can map list_id → bucket. Without
  //    this we can't tell which lane a card is in (status is unreliable).
  let listBucket = {};   // list_id → 'open' | 'working' | 'closed'
  let listName = {};     // list_id → display name (for the lane chip)
  try {
    const { data: lists, error: listErr } = await NX.sb.from('board_lists')
      .select('*');
    if (listErr) {
      console.warn('[daily-log] board_lists load:', listErr.message);
    } else {
      (lists || []).forEach(l => {
        listBucket[l.id] = classifyListName(l.name);
        listName[l.id] = l.name;
      });
    }
  } catch (e) {
    console.warn('[daily-log] board_lists exception:', e);
  }

  // 2. Load all cards with select('*') — naming specific columns
  //    (closed_at, equipment_id, created_at, etc.) errors the whole
  //    query if any one is absent, which silently blanked this section.
  //    select('*') returns whatever exists and can't fail on a missing
  //    column. Archived filtered + sorted client-side for the same reason.
  // Identify the Ordering board(s) so their procurement cards don't leak
  // into the work-order rollup. Cheap (kind is indexed-ish, few boards).
  let orderingBoardIds = new Set();
  try {
    const { data: obs } = await NX.sb.from('boards').select('id').eq('kind', 'ordering');
    (obs || []).forEach(b => orderingBoardIds.add(b.id));
  } catch (_) { /* no kind column yet → nothing to exclude */ }

  let res = await NX.sb.from('kanban_cards').select('*');
  if (res.error) {
    console.warn('[daily-log] kanban_cards load:', res.error.message);
    return { open: [], working: [], closed: [] };
  }
  // Exclude archived (true) and any card living on an Ordering board.
  // Keep archived false AND null.
  const cards = (res.data || []).filter(c => c.archived !== true && !orderingBoardIds.has(c.board_id));

  // 3. Bucket each card. Prefer the card's LIST classification; if the
  //    card has no resolvable list (orphaned), fall back to its status
  //    field, then to 'open' as a safe default.
  const open = [], working = [], closed = [];
  const dayStartMs = new Date(dayStart).getTime();
  const dayEndMs   = new Date(dayEnd).getTime();

  cards.forEach(c => {
    // Lane label for display: the card's list name, else a status-derived
    // label, else nothing.
    c._laneLabel = listName[c.list_id] || laneLabelFromStatus(c.status) || '';
    // "Moved today" — the card changed lanes within the log's day window.
    // last_status_change_at is stamped on every lane move; for brand-new
    // cards it ≈ created_at, so require a real gap (>60s after creation) to
    // avoid flagging freshly-created cards as "moved."
    {
      const chgMs = c.last_status_change_at ? new Date(c.last_status_change_at).getTime() : 0;
      const crtMs = c.created_at ? new Date(c.created_at).getTime() : 0;
      c._movedToday = chgMs >= dayStartMs && chgMs <= dayEndMs && (chgMs - crtMs) > 60000;
    }
    let bucket = listBucket[c.list_id];
    if (!bucket) {
      // Fallback: use the status field if it was ever set by a move
      const s = (c.status || '').toLowerCase();
      if (['resolved', 'closed', 'done'].includes(s)) bucket = 'closed';
      else if (['dispatched', 'in_progress', 'waiting_parts'].includes(s)) bucket = 'working';
      else bucket = 'open';
    }
    if (bucket === 'closed') {
      // Only surface cards CLOSED TODAY, and only when there's a real
      // closed_at stamp (set by the board when a card enters a done lane).
      // The old code fell back to updated_at — but updated_at is bumped by
      // ANY edit, so stale cards closed days ago that got touched today
      // leaked in as "closed today." A card in a done lane with no/old
      // closed_at is simply omitted: the log is the live backlog, not a
      // graveyard of every ticket ever closed.
      const closeMs = c.closed_at ? new Date(c.closed_at).getTime() : 0;
      if (closeMs >= dayStartMs && closeMs <= dayEndMs) closed.push(c);
    } else if (bucket === 'working') {
      working.push(c);
    } else {
      open.push(c);
    }
  });

  // Open: oldest first (aging surfaces). Working: newest activity first.
  open.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  // Working: newest activity first
  working.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  // Closed: most-recently-closed first
  closed.sort((a, b) => new Date(b.closed_at || b.updated_at || 0) - new Date(a.closed_at || a.updated_at || 0));

  return { open, working, closed };
}

// ─── ORDERING ROLLUP ─────────────────────────────────────────────────────
// Read the dedicated Ordering board (boards.kind='ordering') and group its
// open items by location for the read-only per-location rollup in the daily
// notes. "Received" is treated as done and left out of the active rollup.
async function loadOrdering() {
  state.orderingByLoc = {};
  state.orderingBoardId = null;
  if (!NX.sb) return;
  try {
    const { data: obs } = await NX.sb.from('boards').select('id').eq('kind', 'ordering').limit(1);
    const boardId = obs && obs[0] && obs[0].id;
    if (!boardId) return;                     // board not seeded → silent no-op
    state.orderingBoardId = boardId;

    const { data: lists } = await NX.sb.from('board_lists').select('id, name').eq('board_id', boardId);
    const bucketOf = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('receiv')) return 'received';
      if (n.startsWith('to ') || n.includes('to order') || n.includes('needed')) return 'to_order';
      return 'ordered';                        // "Ordered" and anything else in-flight
    };
    const listBucket = {};
    (lists || []).forEach(l => { listBucket[l.id] = bucketOf(l.name); });

    const { data: rows } = await NX.sb.from('kanban_cards').select('*').eq('board_id', boardId);
    const active = (rows || []).filter(c => c.archived !== true);
    const byLoc = {};
    active.forEach(c => {
      const bucket = listBucket[c.list_id] || 'to_order';
      const key = normLocKey(c.location) || 'unassigned';
      if (!byLoc[key]) byLoc[key] = { to_order: [], ordered: [], received: [] };
      byLoc[key][bucket].push(c);
    });
    // Stable order within each bucket: by card position then title.
    Object.values(byLoc).forEach(b => {
      ['to_order', 'ordered', 'received'].forEach(k => {
        b[k].sort((a, z) => (a.position || 0) - (z.position || 0) || String(a.title || '').localeCompare(String(z.title || '')));
      });
    });
    state.orderingByLoc = byLoc;
  } catch (e) {
    console.warn('[daily-log] loadOrdering failed:', e.message);
  }
}

// v18.33 — Resolve equipment_id → name for any cards that link to
// equipment, so the Board Tickets section can show "🔧 Walk-In Cooler"
// inline. Collects all distinct equipment_ids across the three buckets
// and does one batched lookup. Stores the map in state._cardEquipmentNames.
async function loadCardEquipmentNames(slices) {
  if (!NX.sb || !slices) { state._cardEquipmentNames = {}; return; }
  const ids = new Set();
  ['open', 'working', 'closed'].forEach(k => {
    (slices[k] || []).forEach(c => { if (c.equipment_id) ids.add(c.equipment_id); });
  });
  if (!ids.size) { state._cardEquipmentNames = {}; return; }
  try {
    const { data, error } = await NX.sb.from('equipment')
      .select('id, name')
      .in('id', Array.from(ids));
    if (error) { state._cardEquipmentNames = {}; return; }
    const map = {};
    (data || []).forEach(e => { map[e.id] = e.name; });
    state._cardEquipmentNames = map;
  } catch (e) {
    state._cardEquipmentNames = {};
  }
}

// v18.32 Vendor V1 — pull the R&M vendors table for the picker autocomplete
// and the "Vendor Activity Today" section. Reads minimal fields so the
// payload stays small even with a few hundred vendors.
//
// v18.32 hotfix — REMOVED the .eq('active', true) filter. Vendors created
// via paths that don't explicitly set active (e.g. manual SQL insert,
// older migrations) end up with active=NULL, which Postgres treats as
// "not equal to true." Those vendors never loaded, so the daily-log
// matcher tagged them "NOT IN VENDOR LIST" even though they were
// clearly in the table with equipment assigned. Now we load every
// non-archived vendor and treat NULL active as active.
async function loadVendors() {
  if (!NX.sb) return [];
  const { data, error } = await NX.sb.from('vendors')
    .select('id, name, company, category, phone, email, last_contact_at, active')
    .order('company', { ascending: true, nullsFirst: false });
  if (error) {
    // Don't toast — the vendors table may not exist or the column may
    // not have been added yet. Log and degrade silently.
    console.warn('[daily-log] loadVendors:', error.message);
    return [];
  }
  // Treat active=null as active. Only filter out explicitly false.
  return (data || []).filter(v => v.active !== false);
}

// Counts open equipment_issues per vendor — used to surface "Vendor X
// has 2 open work orders" inline. One query, grouped client-side.
async function loadVendorOpenIssueCounts() {
  if (!NX.sb) return {};
  try {
    const { data, error } = await NX.sb.from('equipment_issues')
      .select('vendor_id, status')
      .not('vendor_id', 'is', null)
      .not('status', 'in', '("closed","cancelled","invoice_paid")');
    if (error) {
      console.warn('[daily-log] loadVendorOpenIssueCounts:', error.message);
      return {};
    }
    const counts = {};
    (data || []).forEach(row => {
      if (!row.vendor_id) return;
      counts[row.vendor_id] = (counts[row.vendor_id] || 0) + 1;
    });
    return counts;
  } catch (e) {
    console.warn('[daily-log] loadVendorOpenIssueCounts error:', e);
    return {};
  }
}

// v18.32 — Equipment currently in a non-operational state. Persistent
// concern: any piece of equipment with status in
// ('down', 'needs_service', 'broken') AND !archived shows up on every
// daily log until its status flips back to 'operational'.
//
// The status_note column is the single source of truth for the "what's
// going on with this" narrative — read+written by both this section
// and the equipment edit form. No duplication, no stale state.
const NON_OPERATIONAL_STATUSES = ['down', 'needs_service', 'broken'];
async function loadEquipmentDown() {
  if (!NX.sb) return [];
  // select('*') — NEVER name optional columns (status_note, notes,
  // updated_at) in the select. Those are written by the form only when
  // non-empty, so the columns may not exist in the DB; naming a missing
  // column errors the WHOLE query and blanks the section. select('*')
  // returns whatever columns exist and can't fail on a missing one.
  // Archived filtered + sorting done client-side for the same reason.
  try {
    // Load the FULL non-archived fleet (all statuses) so the daily log can
    // report Maintenance-health + Warranty stats — not just the down units.
    // select('*') so a missing optional column never blanks the query.
    const { data, error } = await NX.sb.from('equipment')
      .select('*');
    if (error) {
      console.warn('[daily-log] loadEquipmentDown:', error.message);
      return [];
    }
    const all = (data || []).filter(eq => eq.archived !== true);
    state.equipmentHealth = all;       // full fleet → health/warranty stats
    const rows = all.filter(eq => NON_OPERATIONAL_STATUSES.indexOf((eq.status || '').toLowerCase()) !== -1);
    rows.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    // Open work-order / call status for the down units (was a call placed?).
    // Maps equipment_id → most-recent open issue. Best-effort; never blocks.
    state.openIssuesByEq = {};
    try {
      const downIds = rows.map(e => e.id);
      if (downIds.length && NX.sb) {
        const { data: iss } = await NX.sb.from('equipment_issues')
          .select('equipment_id, status, contractor_name, contractor_called_at, eta_at, reported_at, created_at, priority')
          .in('equipment_id', downIds)
          .not('status', 'in', '(repaired,closed,cancelled,invoice_paid)')
          .order('created_at', { ascending: false });
        (iss || []).forEach(r => { if (!state.openIssuesByEq[r.equipment_id]) state.openIssuesByEq[r.equipment_id] = r; });
      }
    } catch (e) { console.warn('[daily-log] open issues:', e); }
    // Upcoming confirmed PM visits — maps equipment_id → the EARLIEST
    // non-cancelled pm_schedules row dated today or later. Lets the daily
    // notes say "10d overdue — confirmed schedule on 7/22" instead of
    // leaving an overdue item looking unhandled. Whole fleet, not just
    // down units, because PM-overdue lines cover operational equipment
    // too. Best-effort: on any error the notes just omit the suffix.
    state.pmScheduleByEq = {};
    try {
      const { data: scheds } = await NX.sb.from('pm_schedules').select('*');
      const tIso = todayISO();
      (scheds || [])
        .filter(s => {
          const st = String(s.status || '').toLowerCase();
          return st !== 'cancelled' && st !== 'completed' &&
                 String(s.scheduled_date || '').slice(0, 10) >= tIso;
        })
        .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
        .forEach(s => {
          if (s.equipment_id && !state.pmScheduleByEq[s.equipment_id]) {
            state.pmScheduleByEq[s.equipment_id] = s;
          }
        });
    } catch (e) { console.warn('[daily-log] pm schedules:', e); }
    return rows;
  } catch (e) {
    console.warn('[daily-log] loadEquipmentDown exception:', e);
    return [];
  }
}

// Writes status_note back to the equipment row. Best-effort: failures
// log but don't block the daily-log autosave. Returns { ok } or { error }.
async function writeEquipmentStatusNote(equipmentId, note) {
  if (!NX.sb || !equipmentId) return { error: 'Bad request' };
  try {
    const { error } = await NX.sb.from('equipment')
      .update({ status_note: note || null })
      .eq('id', equipmentId);
    if (error) {
      if (error.code === '42703') {
        if (!window._equipmentStatusNoteWarned) {
          window._equipmentStatusNoteWarned = true;
          if (NX.toast) NX.toast(
            'Status notes need a DB migration. Run sql/equipment_status_note.sql.',
            'warn', 6000);
        }
        return { error: 'status_note column missing' };
      }
      console.warn('[daily-log] writeEquipmentStatusNote:', error.message);
      return { error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { error: e.message || 'write failed' };
  }
}

// Flips equipment.status to 'operational' AND clears its status_note.
// Logs a status_change event so it appears in Today's Equipment Activity.
// Used by the daily-log "✓ Mark operational" button when something gets
// fixed. Returns { ok, eq } with the updated row.
async function markEquipmentOperational(equipmentId) {
  if (!NX.sb || !equipmentId) return { error: 'Bad request' };
  try {
    const { data: cur, error: getErr } = await NX.sb.from('equipment')
      .select('id, name, status, location')
      .eq('id', equipmentId)
      .maybeSingle();
    if (getErr || !cur) return { error: 'Could not load current state' };
    const fromStatus = cur.status;

    // Update status + clear status_note; if column missing, status-only update
    let updateErr;
    const tryFull = await NX.sb.from('equipment')
      .update({ status: 'operational', status_note: null })
      .eq('id', equipmentId);
    updateErr = tryFull.error;
    if (updateErr && updateErr.code === '42703') {
      const tryPartial = await NX.sb.from('equipment')
        .update({ status: 'operational' })
        .eq('id', equipmentId);
      updateErr = tryPartial.error;
    }
    if (updateErr) {
      return { error: updateErr.message || 'Update failed' };
    }

    // Log the status_change event so it shows in Today's Equipment Activity
    try {
      if (typeof NX !== 'undefined' && NX.logEquipmentEvent) {
        // logEquipmentEvent takes a SINGLE object — this was passing positional
        // args, so every field destructured to undefined and the activity event
        // logged garbage (empty status_change). Pass the object it expects.
        await NX.logEquipmentEvent({
          equipmentId,
          eventType: 'status_change',
          payload: {
            from: fromStatus,
            to: 'operational',
            equipment_name: cur.name,
            source: 'daily-log',
          },
          location: cur.location,
        });
      }
    } catch (e) {
      console.warn('[daily-log] logEquipmentEvent failed (non-fatal):', e);
    }

    return { ok: true, eq: Object.assign({}, cur, { status: 'operational' }) };
  } catch (e) {
    return { error: e.message || 'mark operational failed' };
  }
}

// v18.32 hotfix — Vendor name matching utility. Used by both the
// Vendor Activity rendering and the last_contact_at bumper on save.
// Tries progressively more forgiving matches:
//   1. Exact case-insensitive match on company OR name (trimmed)
//   2. Normalized: collapse whitespace, strip suffixes (Inc, LLC, Co, Ltd)
// Returns the matched vendor row, or null if no match.
function findVendorMatch(display, vendors) {
  if (!display || !Array.isArray(vendors) || !vendors.length) return null;
  const target = String(display).trim().toLowerCase();
  if (!target) return null;

  // Pass 1 — exact case-insensitive on name OR company
  for (const v of vendors) {
    const n = String(v.name || '').trim().toLowerCase();
    const c = String(v.company || '').trim().toLowerCase();
    if (n === target || c === target) return v;
  }

  // Pass 2 — normalized: drop common business suffixes + collapse spaces
  const normalize = (s) => String(s || '')
    .toLowerCase()
    .replace(/[.,&]/g, ' ')
    .replace(/\b(inc|incorporated|llc|llp|co|company|corp|corporation|ltd|limited|services|service|svcs)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const normTarget = normalize(target);
  if (normTarget) {
    for (const v of vendors) {
      const n = normalize(v.name);
      const c = normalize(v.company);
      if ((n && n === normTarget) || (c && c === normTarget)) return v;
    }
  }
  return null;
}

// On submit, scan the saved log's vendor_calls for vendor names that
// match known vendors and bump their last_contact_at. Tolerant of
// schema gaps: if the column doesn't exist, the UPDATE 400s and we
// log+continue (the user's daily log save itself is unaffected).
//
// v18.32 hotfix — Uses findVendorMatch so the SAME forgiving matcher
// the Vendor Activity section uses is the one that decides whether to
// bump last_contact_at. Previously these could disagree (the section
// said "matched" but the bump didn't update the row, or vice versa).
async function bumpVendorLastContact(logData) {
  if (!NX.sb || !logData || !Array.isArray(state.vendors) || !state.vendors.length) return;
  // Extract every non-empty vendor name from every location's vendor_calls
  const calledNames = new Set();
  (logData.locations || []).forEach(loc => {
    (loc.vendor_calls || []).forEach(vc => {
      const name = (vc && vc.vendor || '').trim();
      if (name) calledNames.add(name);
    });
  });
  if (!calledNames.size) return;
  // Use findVendorMatch (the same one used in render) to figure out
  // which vendors are referenced. Collect into a set keyed by id so we
  // bump each vendor only once even if mentioned across multiple rows.
  const matchedIds = new Set();
  for (const name of calledNames) {
    const m = findVendorMatch(name, state.vendors);
    if (m && m.id) matchedIds.add(m.id);
  }
  if (!matchedIds.size) return;
  const today = (logData.header && logData.header.date) || todayISO();
  for (const id of matchedIds) {
    try {
      await NX.sb.from('vendors')
        .update({ last_contact_at: today })
        .eq('id', id);
    } catch (e) {
      // Column may not exist yet — log once, don't block save flow
      console.warn('[daily-log] vendor last_contact bump failed for', id, e.message);
    }
  }
}

async function loadRecentLogs() {
  if (!NX.sb) return [];
  const user = NX.currentUser;
  const userId = user && user.id;
  // v18.32 Phase 3c — scope to log_type='daily' so the biweekly logs
  // (which now share the same table) don't contaminate the daily strip.
  let q = NX.sb.from('facility_logs')
    .select('id, log_date, created_by, created_by_name, drive_upload_status, drive_file_url, submitted_at')
    .eq('log_type', 'daily')
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
    .eq('log_type', 'daily')
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
    log_type: 'daily',
    created_by: user.id,
    created_by_name: user.name || null,
    data: logData,
    updated_at: new Date().toISOString(),
  };
  if (options.submit) {
    row.submitted_at = new Date().toISOString();
    row.drive_upload_status = 'pending';
  }
  // Upsert by (log_date, log_type, created_by) — one daily log per user per day
  const { data, error } = await NX.sb.from('facility_logs')
    .upsert(row, { onConflict: 'log_date,log_type,created_by' })
    .select()
    .single();
  if (error) {
    // v18.32 hotfix — if the production DB is missing the
    // facility_logs_per_user_per_type_per_day unique constraint (e.g. the
    // facility_logs_log_type.sql migration was never run), Postgres returns:
    //   "there is no unique or exclusion constraint matching the ON
    //    CONFLICT specification" (error code 42P10).
    // Rather than losing the user's edit, fall back to a manual
    // SELECT-then-UPDATE-or-INSERT. The user gets a one-time toast
    // pointing at the SQL repair, but their save lands.
    const isConflictMissing = error.code === '42P10' ||
      /no unique or exclusion constraint/i.test(error.message || '');
    if (isConflictMissing) {
      console.warn('[daily-log] upsert constraint missing — falling back to manual save. Run sql/facility_logs_constraint_repair.sql to fix permanently.');
      try {
        // Look for an existing row matching log_date + log_type + user
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
        // One-time toast pointing at the fix — only shown once per session
        if (!window._dlogConstraintWarned) {
          window._dlogConstraintWarned = true;
          if (NX.toast) NX.toast(
            'Save worked (fallback). Run sql/facility_logs_constraint_repair.sql to fix the DB.',
            'warn', 7000);
        }
        return { data: result.data };
      } catch (fbErr) {
        console.error('[daily-log] fallback save also failed:', fbErr);
        return { error: fbErr.message || 'Save failed (and fallback failed)' };
      }
    }
    console.error('[daily-log] saveLog:', error);
    return { error: error.message || 'Save failed' };
  }
  return { data };
}

// ─── Render ─────────────────────────────────────────────────────────
// Ensure every distinct equipment location has its own note slot in this log.
// Equipment is the canonical source of which venues/areas exist, so the daily
// notes' location list is populated from it. Additive only — never removes a
// location you added manually, and never disturbs existing notes.
function syncLocationsFromEquipment(d) {
  const eqLocs = state.equipmentLocations || [];
  if (!d) return;
  if (!Array.isArray(d.locations)) d.locations = [];
  const have = new Set(d.locations.map(l => normLocKey(l.label)));
  eqLocs.forEach(loc => {
    const key = normLocKey(loc);
    if (!key || have.has(key)) return;
    have.add(key);
    d.locations.push({ id: key, label: loc, rm: makeEmptyRm(), vendor_calls: [], notes: '' });
  });
}

// One location's self-contained note (Repairs & Maintenance, vendor/service
// calls, and free observations). Shown when its pill is selected.
function renderLocationPills(d) {
  const cur = state.activeLoc || 'all';
  const pills = ['<button type="button" class="dlog-loc-pill ' + (cur === 'all' ? 'is-active' : '') + '" data-loc-pill="all">Overview</button>'];
  (d.locations || []).forEach(loc => {
    const key = normLocKey(loc.label);
    pills.push('<button type="button" class="dlog-loc-pill ' + (cur === key ? 'is-active' : '') + '" data-loc-pill="' + esc(key) + '">' + esc(loc.label) + '</button>');
  });
  return '<div class="dlog-loc-pills" role="tablist">' + pills.join('') + '</div>';
}

function renderActiveLocation(d) {
  const key = state.activeLoc;
  const idx = (d.locations || []).findIndex(l => normLocKey(l.label) === key);
  if (idx < 0) return '<p class="dlog-empty-hint">This location has no notes yet.</p>';
  return renderLocationSection(d.locations[idx], idx);
}

function render() {
  const view = document.getElementById('dailylogView');
  if (!view) return;

  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  syncLocationsFromEquipment(d);     // populate location list from equipment
  if (log) log.data = d;             // keep the merged shape on the live log
  const driveStatus = log && log.drive_upload_status;
  const hasDriveFile = !!(log && log.drive_file_id);
  const lastUploadedAt = log && log.drive_uploaded_at;

  // ── Status pill text/class for the meta row.
  // v18.32 Phase 3a removed the "submitted = locked" model. The status
  // pill is now informational only — it tells you whether/when the Drive
  // doc was last refreshed. The form remains editable at all times so
  // logs can be opened multiple times throughout the day and re-uploaded.
  let statusText, statusKind;
  if (driveStatus === 'uploaded' && lastUploadedAt) {
    const t = new Date(lastUploadedAt);
    const timeStr = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    statusText = `✓ Saved ${timeStr}`;
    statusKind = 'uploaded';
  } else if (driveStatus === 'pending') {
    statusText = 'Uploading…';
    statusKind = 'pending';
  } else if (driveStatus === 'failed') {
    statusText = 'Upload failed';
    statusKind = 'failed';
  } else {
    statusText = 'Not uploaded';
    statusKind = 'draft';
  }
  const uploadBtnLabel = hasDriveFile ? 'Update Drive doc' : 'Upload to Drive';

  const emailLocLabel = (state.activeLoc && state.activeLoc !== 'all')
    ? (((d.locations || []).find(l => normLocKey(l.label) === state.activeLoc) || {}).label || '')
    : '';
  const emailBtnLabel = emailLocLabel ? ('✉ Email ' + emailLocLabel) : '✉ Email day';
  const emailBtnTitle = emailLocLabel
    ? ('Compose an email of just ' + emailLocLabel + '\u2019s notes')
    : 'Compose an email of the full day';

  view.innerHTML = `
    <div class="dlog-shell">
      <header class="dlog-header">
        <div class="dlog-title-row">
          <h1 class="dlog-title">Daily Facilities Log</h1>
          <button class="dlog-new-btn" id="dlogNewBtn" title="Start a log for a different date">＋ New</button>
        </div>
        <div class="dlog-meta">
          <input type="date" id="dlogDateInput" class="dlog-date-input" value="${esc(d.header.date || todayISO())}">
          <span class="dlog-status dlog-status-${statusKind}">${esc(statusText)}</span>
          ${hasDriveFile ? `
            <a class="dlog-drive-link" href="${esc(log.drive_file_url || '#')}" target="_blank" rel="noopener">Open ↗</a>
          ` : ''}
        </div>
        ${(driveStatus === 'failed' && log && log.drive_upload_error) ? `
          <p class="dlog-error-detail">Error: ${esc(log.drive_upload_error)}</p>
        ` : ''}
      </header>

      ${renderRecentLogsStrip()}

      <form class="dlog-form" id="dlogForm" autocomplete="off">
        ${renderVendorDatalist()}
        ${renderLocationPills(d)}
        ${(state.activeLoc && state.activeLoc !== 'all')
          ? renderActiveLocation(d)
          : `
            ${renderHeaderSection(d)}
            ${renderPlanningSection(d)}
            ${renderEquipmentStatusSection(d)}
            ${renderPmsSection()}
            ${renderEquipmentActivitySection(d)}
            ${renderVendorActivitySection(d)}
            ${renderTicketsSection(d)}
            ${renderOtherPropertiesSection(d)}
            ${renderCleaningSection(d)}
            ${renderAddLocationControl(d)}
          `}

        ${renderOpenerPreview(d.header.date || todayISO())}

        <div class="dlog-actions">
          <span class="dlog-autosend-wrap">
            <button type="button" class="eq-btn eq-btn-secondary dlog-autosend-toggle ${dlogAutoSendOn() ? 'is-on' : ''}" id="dlogAutoSendBtn" title="When on, this log auto-uploads to Drive when you leave the screen — and, if still not sent by the time on the right, it sends automatically. Edits autosave continuously so nothing is lost.">${dlogAutoSendOn() ? '🔁 Auto-send: On' : '🔁 Auto-send: Off'}</button>
            <input type="time" id="dlogAutoSendTime" class="dlog-autosend-time" value="${esc(dlogAutoSendTime())}" title="If not sent by this time, send automatically" ${dlogAutoSendOn() ? '' : 'style="display:none"'}>
            <span class="dlog-autosend-days" id="dlogAutoSendDays" title="Days auto-send is allowed" ${dlogAutoSendOn() ? '' : 'style="display:none"'}>${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dd, i) => `<button type="button" class="dlog-day-pill ${dlogAutoSendDays().indexOf(i + 1) !== -1 ? 'is-on' : ''}" data-day="${i + 1}">${dd}</button>`).join('')}</span>
          </span>
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogEmailBtn" title="${esc(emailBtnTitle)}">${esc(emailBtnLabel)}</button>
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogStyledEmailBtn" title="Same report, same recipients, same Send — delivered as a styled email. First use asks for one Google permission. Falls back to the plain draft if anything fails.">✨ Styled email</button>
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogEmailEachBtn" title="Open one Gmail draft per location at once — just hit Send on each">✉️ Email each location</button>
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogSaveDraftBtn">Save</button>
          <button type="button" class="eq-btn eq-btn-primary"   id="dlogSubmitBtn">${esc(uploadBtnLabel)}</button>
        </div>
      </form>
    </div>
  `;
  wireForm();
}

function renderAddLocationControl(d) {
  // The dropdown options are computed at click time (see wireForm),
  // not at render time — keeps the menu fresh without forcing a re-render
  // every time equipment locations change in the background.
  return `
    <div class="dlog-add-loc-wrap">
      <button type="button" class="eq-btn eq-btn-secondary dlog-add-loc-btn" id="dlogAddLocBtn">＋ Add location</button>
      <div class="dlog-add-loc-menu" id="dlogAddLocMenu" hidden></div>
    </div>
  `;
}

function renderRecentLogsStrip() {
  if (!state.recentLogs || !state.recentLogs.length) return '';
  const curDate = state.currentLog && state.currentLog.log_date;
  // Quick chips for the last few days...
  const rows = state.recentLogs.slice(0, 7).map(r => {
    const isOpen = state.currentLog && state.currentLog.id === r.id;
    return `
      <button type="button" class="dlog-recent-chip ${isOpen ? 'is-active' : ''}" data-log-date="${esc(r.log_date)}">
        <span class="dlog-recent-date">${esc(friendlyDate(r.log_date))}</span>
        ${r.submitted_at ? `<span class="dlog-recent-dot dlog-status-${r.drive_upload_status || 'pending'}"></span>` : ''}
      </button>
    `;
  }).join('');
  // ...plus a dropdown to jump to any older submitted log.
  const opts = state.recentLogs.map(r => {
    const tag = r.submitted_at ? ' ✓' : ' · draft';
    return `<option value="${esc(r.log_date)}" ${r.log_date === curDate ? 'selected' : ''}>${esc(friendlyDate(r.log_date))}${tag}</option>`;
  }).join('');
  return `
    <div class="dlog-recent">
      <span class="dlog-recent-label">RECENT</span>
      <select class="dlog-recent-select" id="dlogRecentSelect" title="Open an older log" aria-label="Open an older log">
        <option value="" disabled ${curDate ? '' : 'selected'}>Older logs…</option>
        ${opts}
      </select>
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
          <div class="dlog-weather-row">
            <input type="text" data-path="header.weather" value="${esc(d.header.weather)}" placeholder="e.g. Sunny, 78°F, evening showers">
            <button type="button" class="dlog-weather-refresh" id="dlogWeatherRefresh" title="Fetch today's weather now">↻</button>
          </div>
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

// Read-only per-location procurement rollup, sourced from the Ordering
// board. Shows open items (To order + Ordered); "Received" is done and
// omitted. No data-path inputs — this is a mirror, edited on the board.
function renderOrderingRollup(locKey) {
  const data = (state.orderingByLoc && state.orderingByLoc[locKey]) || null;
  const toOrder = (data && data.to_order) || [];
  const ordered = (data && data.ordered) || [];
  const total = toOrder.length + ordered.length;

  const money = (v) => {
    const n = Number(v);
    if (!v && v !== 0) return '';
    if (!isFinite(n)) return '';
    return '~$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };
  const item = (c, bucket) => `
    <div class="dlog-order-item">
      <span class="dlog-order-dot dlog-order-dot-${bucket}"></span>
      <span class="dlog-order-title">${esc(c.title || 'Item')}</span>
      ${c.cost_estimate ? `<span class="dlog-order-cost">${esc(money(c.cost_estimate))}</span>` : ''}
      <span class="dlog-order-lane dlog-order-lane-${bucket}">${bucket === 'to_order' ? 'To order' : 'Ordered'}</span>
    </div>`;

  const body = total === 0
    ? '<p class="dlog-empty-hint">Nothing to order right now.</p>'
    : [...toOrder.map(c => item(c, 'to_order')), ...ordered.map(c => item(c, 'ordered'))].join('');

  return `
    <h3 class="dlog-subsection-title">
      Ordering / Supplies${total ? ` <span class="dlog-subsection-count">${total}</span>` : ''}
    </h3>
    <div class="dlog-order-list">${body}</div>
    <button type="button" class="eq-btn eq-btn-secondary dlog-open-ordering" data-loc="${esc(locKey)}">Open Ordering board →</button>
  `;
}

function renderLocationSection(loc, idx) {
  // Paths now address the location by array index: locations.{idx}.rm.{cat}
  // and locations.{idx}.vendor_calls.{rowIdx}.{field}. The writeFieldToState
  // machinery walks dotted paths and detects numeric segments as array
  // indices automatically.
  const rmFields = RM_CATEGORIES.map(cat => `
    <label class="dlog-field dlog-field-rm">
      <span class="dlog-field-label">${esc(cat.label)}</span>
      <textarea data-path="locations.${idx}.rm.${cat.key}" rows="2">${esc(loc.rm[cat.key] || '')}</textarea>
    </label>
  `).join('');

  const vendorRows = (loc.vendor_calls || []).map((row, vIdx) => `
    <div class="dlog-vendor-row" data-row-idx="${vIdx}">
      <input type="date" data-path="locations.${idx}.vendor_calls.${vIdx}.date" value="${esc(row.date || '')}" placeholder="Opened">
      <input type="text" data-path="locations.${idx}.vendor_calls.${vIdx}.vendor" value="${esc(row.vendor || '')}" placeholder="Vendor" list="dlog-vendor-options" autocomplete="off">
      <input type="text" data-path="locations.${idx}.vendor_calls.${vIdx}.equipment" value="${esc(row.equipment || '')}" placeholder="Equipment">
      <textarea data-path="locations.${idx}.vendor_calls.${vIdx}.issue" rows="2" placeholder="Issue">${esc(row.issue || '')}</textarea>
      <textarea data-path="locations.${idx}.vendor_calls.${vIdx}.status" rows="2" placeholder="Status / next steps">${esc(row.status || '')}</textarea>
      <button type="button" class="dlog-row-remove" data-remove-vendor="${idx}" data-idx="${vIdx}" title="Remove row">×</button>
    </div>
  `).join('');

  return `
    <details class="dlog-section dlog-section-location" data-loc-idx="${idx}" open>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">${esc(loc.label)}</span>
        <button type="button" class="dlog-loc-remove" data-remove-loc="${idx}" title="Remove this location" aria-label="Remove location ${esc(loc.label)}">×</button>
      </summary>
      <div class="dlog-section-body">
        <div class="dlog-loc-weather" data-loc-weather="${esc(normLocKey(loc.label))}">${esc((state.weatherByLoc && state.weatherByLoc[normLocKey(loc.label)]) || '')}</div>
        <label class="dlog-field">
          <span class="dlog-field-label">Notes &amp; observations</span>
          <textarea data-path="locations.${idx}.notes" rows="4" placeholder="The shift recap for ${esc(loc.label)} — service, guests, 86s, anything noteworthy…">${esc(loc.notes || '')}</textarea>
        </label>
        <h3 class="dlog-subsection-title">Repairs &amp; Maintenance</h3>
        <div class="dlog-rm-grid">${rmFields}</div>

        <h3 class="dlog-subsection-title">Vendor &amp; service calls</h3>
        <div class="dlog-vendor-list">
          ${vendorRows || '<p class="dlog-empty-hint">No vendor calls logged yet.</p>'}
        </div>
        <button type="button" class="eq-btn eq-btn-secondary dlog-add-row-btn" data-add-vendor="${idx}">＋ Add vendor call</button>

        ${renderOrderingRollup(normLocKey(loc.label))}
      </div>
    </details>
  `;
}

// v18.32 — Equipment Status section. Lists every piece of equipment
// currently in a non-operational state with an editable status_note +
// "Mark operational" button. Pre-populates from the canonical
// equipment.status_note (single source of truth). Edits write back
// directly to the equipment row, so the equipment view sees the same
// state. As long as a piece of equipment is non-operational, it
// appears here on every daily log.
// "confirmed schedule on 7/22 (HOODZ)" for a unit with an upcoming
// pm_schedules visit, '' otherwise. Vendor resolved from state.vendors at
// render time (both load in the same Promise.all, so the map can't safely
// bake names in at load time).
function pmConfirmNote(eqId) {
  const s = (state.pmScheduleByEq || {})[eqId];
  if (!s || !s.scheduled_date) return '';
  const d = new Date(String(s.scheduled_date).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return '';
  const when = (d.getMonth() + 1) + '/' + d.getDate();
  const v = s.vendor_id != null
    && (state.vendors || []).find(x => String(x.id) === String(s.vendor_id));
  const vn = v ? (v.company || v.name || '') : '';
  return 'confirmed schedule on ' + when + (vn ? ' (' + vn + ')' : '');
}

function renderEquipmentStatusSection(d) {
  const items = state.equipmentDown || [];
  const statusLabel = (k) => ({
    down: 'DOWN', needs_service: 'NEEDS SERVICE', broken: 'BROKEN'
  })[k] || (k || '').toUpperCase();
  const statusPillClass = (k) => ({
    down: 'dlog-eqstatus-pill-down',
    needs_service: 'dlog-eqstatus-pill-service',
    broken: 'dlog-eqstatus-pill-down',
  })[k] || 'dlog-eqstatus-pill-service';

  if (!items.length) {
    return `
      <details class="dlog-section">
        <summary class="dlog-section-header">
          <span class="dlog-section-title">Equipment Status</span>
          <span class="dlog-section-count">0</span>
        </summary>
        <div class="dlog-section-body">
          <p class="dlog-empty-hint">All equipment is operational. 🎉</p>
        </div>
      </details>`;
  }

  // One row per piece of down equipment.
  const eqRow = (eq) => {
    const daysDown = eq.updated_at
      ? Math.max(0, Math.floor((Date.now() - new Date(eq.updated_at).getTime()) / 86400000))
      : null;
    const dayLabel = daysDown == null ? ''
      : daysDown === 0 ? 'updated today'
      : daysDown === 1 ? '1 day'
      : `${daysDown} days`;
    const noteValue = eq.status_note || '';
    const sched = pmConfirmNote(eq.id);
    const metaBits = [dayLabel, sched].filter(Boolean).join(' · ');
    return `
      <div class="dlog-eqstatus-row" data-eq-id="${esc(eq.id)}">
        <div class="dlog-eqstatus-head">
          <span class="dlog-eqstatus-pill ${statusPillClass(eq.status)}">${esc(statusLabel(eq.status))}</span>
          <div class="dlog-eqstatus-info">
            <span class="dlog-eqstatus-name">${esc(eq.name || 'Untitled equipment')}</span>
            <span class="dlog-eqstatus-meta">${metaBits ? esc(metaBits) : ''}</span>
          </div>
        </div>
        <textarea
          class="dlog-eqstatus-note"
          data-eq-note="${esc(eq.id)}"
          rows="2"
          placeholder="Current status &mdash; parts ordered, vendor coming, etc."
        >${esc(noteValue)}</textarea>
      </div>`;
  };

  // Group by location, then render in log-order (active first, then
  // auto-populated, then unassigned).
  const groups = {};
  items.forEach(eq => {
    const k = normLocKey(eq.location);
    (groups[k] = groups[k] || []).push(eq);
  });
  const orderedKeys = orderedLocationKeys(d, new Set(Object.keys(groups)));
  const activeKeys = new Set((d.locations || []).map(l => normLocKey(l.label)));

  const groupBlocks = orderedKeys.map(k => {
    const rows = groups[k].map(eqRow).join('');
    const isAuto = !activeKeys.has(k);
    return `
      <div class="dlog-loc-group">
        <div class="dlog-loc-group-head">
          <span class="dlog-loc-group-name">${esc(locDisplayLabel(k))}</span>
          ${isAuto ? '<span class="dlog-loc-group-auto">not in log</span>' : ''}
          <span class="dlog-loc-group-count">${groups[k].length}</span>
        </div>
        <div class="dlog-eqstatus-list">${rows}</div>
      </div>`;
  }).join('');

  return `
    <details class="dlog-section" open>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Equipment Status</span>
        <span class="dlog-section-count">${items.length}</span>
      </summary>
      <div class="dlog-section-body">
        <p class="dlog-empty-hint">Not operational, split by location — notes update the equipment record directly. Change status in the Equip view when back up.</p>
        ${groupBlocks}
      </div>
    </details>`;
}

// v18.32 Vendor V1 — autocomplete options for the vendor_calls inputs.
// Rendered once at the top of the form; each vendor input references
// it via `list="dlog-vendor-options"`. Uses company OR name as the
// display value since the R&M vendors module keys on `company` with
// `name` as a fallback. Native datalist is mobile-friendly: typing
// filters, tapping selects, and free-text is still allowed for new
// vendor names that aren't yet in the table.
function renderVendorDatalist() {
  if (!state.vendors || !state.vendors.length) return '';
  const options = state.vendors.map(v => {
    const display = (v.company || v.name || '').trim();
    if (!display) return '';
    return `<option value="${esc(display)}"></option>`;
  }).filter(Boolean).join('');
  return `<datalist id="dlog-vendor-options">${options}</datalist>`;
}

// v18.32 Vendor V1 — "Vendor Activity Today" rollup section.
// Aggregates from two sources:
//   1. Names mentioned in this log's vendor_calls (across all locations)
//   2. The vendors table (for status: phone, open work orders, last contact)
//
// For each unique vendor name in today's vendor_calls, we try to match
// against the vendors table. If matched, show open-issue count + phone
// + last contact. If unmatched (typed-but-not-saved-as-vendor), show
// as "Unknown — add to vendors?" with a hint.
function renderVendorActivitySection(d) {
  // Extract distinct vendor names from this log's vendor_calls, with the
  // location they appeared in for context.
  const mentionedByName = new Map();   // lowercased name → { display, locations: Set, issues: [] }
  (d.locations || []).forEach(loc => {
    (loc.vendor_calls || []).forEach(vc => {
      const display = (vc && vc.vendor || '').trim();
      if (!display) return;
      const key = display.toLowerCase();
      if (!mentionedByName.has(key)) {
        mentionedByName.set(key, { display, locations: new Set(), issues: [] });
      }
      mentionedByName.get(key).locations.add(loc.label);
      if (vc.issue) mentionedByName.get(key).issues.push(vc.issue);
    });
  });

  const total = mentionedByName.size;
  const rows = Array.from(mentionedByName.values()).map(m => {
    // v18.32 hotfix — match against the vendors table more permissively.
    // Try (in order):
    //   1. Exact case-insensitive match on company OR name (trimmed)
    //   2. Match after normalizing common variants (collapsing whitespace,
    //      stripping "Inc", "LLC", "Co", "Ltd" suffixes)
    // This catches vendors stored with subtle variations from what the
    // user typed (or what auto-filled from the datalist with a trailing
    // space). "Austin Industrial" matches "Austin Industrial Inc."
    const matched = findVendorMatch(m.display, state.vendors || []);
    const phoneHref = matched && matched.phone
      ? `<a class="dlog-vd-phone" href="tel:${esc(String(matched.phone).replace(/[^\d+]/g, ''))}">📞 ${esc(matched.phone)}</a>`
      : '';
    const openCount = matched ? (state.vendorOpenIssues[matched.id] || 0) : 0;
    const openBadge = openCount > 0
      ? `<span class="dlog-vd-issues">${openCount} open work order${openCount === 1 ? '' : 's'}</span>`
      : '';
    const lastContact = matched && matched.last_contact_at
      ? `<span class="dlog-vd-last">last: ${esc(matched.last_contact_at)}</span>`
      : '';
    const matchedHint = matched
      ? `<span class="dlog-vd-match">${esc(matched.category || 'vendor')}</span>`
      : `<span class="dlog-vd-unmatched">not in vendor list</span>`;
    const locs = Array.from(m.locations).filter(Boolean).join(', ');
    return `
      <div class="dlog-vd-row">
        <div class="dlog-vd-main">
          <div class="dlog-vd-name">${esc(m.display)} ${matchedHint}</div>
          <div class="dlog-vd-meta">
            ${locs ? `<span class="dlog-act-loc">${esc(locs)}</span>` : ''}
            ${openBadge}
            ${lastContact}
          </div>
        </div>
        ${phoneHref}
      </div>`;
  }).join('');

  return `
    <details class="dlog-section" ${total > 0 ? 'open' : ''}>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Vendor Activity Today</span>
        <span class="dlog-section-count">${total}</span>
      </summary>
      <div class="dlog-section-body">
        ${total
          ? `<div class="dlog-vd-list">${rows}</div>`
          : '<p class="dlog-empty-hint">No vendors mentioned in today\'s vendor calls yet. Add a vendor call to a location above — autocomplete pulls from your vendor list.</p>'}
        <label class="dlog-field">
          <span class="dlog-field-label">Notes on vendor activity</span>
          <span class="dlog-field-hint">Quick observations on responsiveness, repairs, follow-ups</span>
          <textarea data-path="vendor_activity_notes" rows="3" placeholder="">${esc(d.vendor_activity_notes || '')}</textarea>
        </label>
      </div>
    </details>
  `;
}

// "PMs Logged Today" — preventive maintenance performed on this date, grouped
// by location, each showing the equipment and the vendor who did it. Sourced
// from equipment_maintenance (state.pmsToday). Hidden on days with no PMs.
function renderPmsSection() {
  const pms = state.pmsToday || [];
  if (!pms.length) return '';
  const groups = {};
  pms.forEach(p => {
    const loc = (p.equipment && p.equipment.location) || 'Unspecified location';
    (groups[loc] = groups[loc] || []).push(p);
  });
  const body = Object.keys(groups).sort().map(loc => {
    const rows = groups[loc].map(p => {
      const eqName = (p.equipment && p.equipment.name) || ('Equipment ' + String(p.equipment_id || '').slice(0, 8));
      const who = p.performed_by ? esc(p.performed_by) : '<span style="color:var(--nx-faint)">no vendor</span>';
      const cost = (p.cost != null && !isNaN(p.cost) && Number(p.cost) > 0) ? ' · $' + Math.round(Number(p.cost)).toLocaleString() : '';
      return `
        <div class="dlog-act-row${p.equipment_id ? ' dlog-eqjump' : ''}"${p.equipment_id ? ` data-eq-id="${esc(p.equipment_id)}" role="button" tabindex="0" style="cursor:pointer" title="Open ${esc(eqName)}"` : ''}>
          <span class="dlog-act-pill dlog-act-pill-pm"></span>
          <div class="dlog-act-main">
            <div class="dlog-act-line"><b>${esc(eqName)}</b></div>
            <div class="dlog-act-detail">by ${who}${cost}</div>
          </div>
        </div>`;
    }).join('');
    return `<div style="margin-bottom:8px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:var(--nx-gold);font-weight:600;margin:8px 2px 4px">${esc(loc)} <span style="color:var(--nx-faint)">· ${groups[loc].length}</span></div>
        ${rows}
      </div>`;
  }).join('');
  return `
    <details class="dlog-section" open>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">PMs Logged Today</span>
        <span class="dlog-section-count">${pms.length}</span>
      </summary>
      <div class="dlog-section-body">
        <div class="dlog-act-list">${body}</div>
      </div>
    </details>`;
}

// v18.32 Phase 3b — Equipment activity card.
// Auto-populated from state.equipmentActivity (which is loaded by
// openLogForDate). Read-only feed — each row shows the event with a
// human-readable label. A single notes textarea sits at the bottom of
// the card and is wired to data.equipment_activity_notes so the user
// can annotate the day's events with one shared text block.
function renderEquipmentActivitySection(d) {
  const events = state.equipmentActivity || [];
  const rows = events.map(ev => {
    const eqName = (ev.payload && ev.payload.equipment_name) || `Equipment ${String(ev.equipment_id).slice(0, 8)}`;
    const loc = ev.location ? `<span class="dlog-act-loc">${esc(ev.location)}</span>` : '';
    let detail = '';
    let pillClass = 'dlog-act-pill';
    if (ev.event_type === 'status_change') {
      const fromL = (ev.payload && ev.payload.from_label) || (ev.payload && ev.payload.from) || '?';
      const toL   = (ev.payload && ev.payload.to_label)   || (ev.payload && ev.payload.to)   || '?';
      const flipNote = (ev.payload && ev.payload._is_net && ev.payload._flip_count > 1)
        ? `<span class="dlog-act-note">(net of ${ev.payload._flip_count} flips today)</span>` : '';
      detail = `${esc(fromL)} → <b>${esc(toL)}</b> ${flipNote}`;
      pillClass += ` dlog-act-pill-status to-${esc(ev.payload && ev.payload.to || '')}`;
    } else if (ev.event_type === 'pm_logged') {
      detail = 'PM completed';
      pillClass += ' dlog-act-pill-pm';
    } else if (ev.event_type === 'location_change') {
      detail = `${esc(ev.payload?.from || '?')} → <b>${esc(ev.payload?.to || '?')}</b>`;
      pillClass += ' dlog-act-pill-move';
    } else if (ev.event_type === 'archived') {
      detail = 'Archived';
      pillClass += ' dlog-act-pill-archive';
    } else if (ev.event_type === 'restored') {
      detail = 'Restored from archive';
      pillClass += ' dlog-act-pill-archive';
    } else if (ev.event_type === 'created') {
      detail = 'New equipment created';
      pillClass += ' dlog-act-pill-create';
    } else if (ev.event_type === 'issue_opened') {
      // v18.32 hotfix — equipment_issues opened today. Surfaces the
      // R&M work-order stream alongside equipment_events.
      const title = (ev.payload && ev.payload.title) || 'Work order opened';
      const pri = (ev.payload && ev.payload.priority) || '';
      const priLabel = pri && pri !== 'normal' ? ` <span class="dlog-act-pri-${esc(pri)}">${esc(pri)}</span>` : '';
      detail = `Work order: ${esc(String(title).slice(0, 60))}${priLabel}`;
      pillClass += ' dlog-act-pill-issue';
    } else if (ev.event_type === 'issue_paid') {
      // v18.32 hotfix — equipment_issues invoice paid today.
      const title = (ev.payload && ev.payload.title) || 'Work order';
      const amt = ev.payload && ev.payload.invoice_amount;
      const amtLabel = (amt && !isNaN(amt))
        ? ` <b>$${Math.round(Number(amt)).toLocaleString()}</b>`
        : '';
      detail = `Invoice paid: ${esc(String(title).slice(0, 50))}${amtLabel}`;
      pillClass += ' dlog-act-pill-paid';
    } else if (ev.event_type === 'contractor_dispatched') {
      const m = ev.payload && ev.payload.method;
      const verb = m === 'text' ? 'Texted' : m === 'email' ? 'Emailed' : m === 'in_house' ? 'In-house dispatch' : 'Called';
      const who = (ev.payload && ev.payload.contractor_name) || 'contractor';
      const reason = (ev.payload && ev.payload.issue_description)
        ? ` — ${esc(String(ev.payload.issue_description).slice(0, 50))}` : '';
      detail = `${verb} ${esc(who)}${reason}`;
      pillClass += ' dlog-act-pill-issue';
    } else {
      // Catch-all for less common types (fields_edited, note_added,
      // photo_replaced, part_replacement, etc.)
      detail = String(ev.event_type).replace(/_/g, ' ');
    }
    const time = ev.occurred_at
      ? new Date(ev.occurred_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';
    const actor = ev.actor_name ? ` · ${esc(ev.actor_name)}` : '';
    return `
      <div class="dlog-act-row${ev.equipment_id ? ' dlog-eqjump' : ''}"${ev.equipment_id ? ` data-eq-id="${esc(ev.equipment_id)}" role="button" tabindex="0" style="cursor:pointer" title="Open ${esc(eqName)}"` : ''}>
        <span class="${pillClass}"></span>
        <div class="dlog-act-main">
          <div class="dlog-act-line"><b>${esc(eqName)}</b> ${loc}</div>
          <div class="dlog-act-detail">${detail}</div>
        </div>
        <div class="dlog-act-time">${esc(time)}${actor}</div>
      </div>
    `;
  }).join('');
  // One-time: clicking an activity row (or Enter/Space on it) jumps to that
  // equipment's detail — previously the row named the unit but was a dead end.
  if (!state._eqJumpWired) {
    state._eqJumpWired = true;
    const jump = (e) => {
      const row = e.target.closest && e.target.closest('.dlog-act-row[data-eq-id]');
      if (!row) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      const id = row.getAttribute('data-eq-id');
      if (!id) return;
      e.preventDefault();
      const open = (NX.modules && NX.modules.equipment && NX.modules.equipment.openDetail) || window.eqOpenDetail;
      if (open) open(id);
    };
    document.addEventListener('click', jump);
    document.addEventListener('keydown', jump);
  }
  const count = events.length;
  return `
    <details class="dlog-section" ${count ? 'open' : ''}>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Today's Equipment Activity</span>
        <span class="dlog-section-count">${count}</span>
      </summary>
      <div class="dlog-section-body">
        ${count
          ? `<div class="dlog-act-list">${rows}</div>`
          : '<p class="dlog-empty-hint">No equipment activity logged for this date.</p>'}
        <label class="dlog-field">
          <span class="dlog-field-label">Notes on equipment activity</span>
          <span class="dlog-field-hint">Annotations on what happened — visible in the Drive doc</span>
          <textarea data-path="equipment_activity_notes" rows="3" placeholder="Anything to flag about today's equipment activity...">${esc(d.equipment_activity_notes || '')}</textarea>
        </label>
      </div>
    </details>
  `;
}

// v18.32 Phase 3e — Daily tickets continuity.
// Three slices in one collapsible card:
//   • Open as of today
//   • Closed today
//   • Newly opened today
// Each has its own count badge + ticket list + free-text notes field.
// The slices come from state.ticketSlices (live) unless we're viewing
// a past submitted log that has a frozen snapshot in data.tickets —
// in which case we prefer the snapshot for historical accuracy.
// ─── Card field helpers (shared by the on-screen section + the email body) ──
function cardAssignee(c) {
  return (c && (c.assignee || c.assigned_to || c.assigned_name || c.reported_by)) || '';
}
function cardDetail(c) {
  if (!c) return '';
  let t = String(c.description || c.notes || '').trim();
  if (!t && Array.isArray(c.comments) && c.comments.length) {
    const last = c.comments[c.comments.length - 1];
    t = String((last && (last.text || last.body || last.note || last.message)) || '').trim();
  }
  t = t.replace(/\s+/g, ' ');
  return t.length > 180 ? t.slice(0, 180) + '…' : t;
}
// "created Sat Jun 21" for cards NOT made today (i.e. carried over / queued from
// a weekend) — so the daily email shows when an older open card was created.
// Empty for today's cards (the log is already dated today).
function cardCreatedLabel(c) {
  if (!c || !c.created_at) return '';
  const dt = new Date(c.created_at);
  if (isNaN(dt)) return '';
  const iso = dt.toISOString().slice(0, 10);
  if (iso >= todayISO()) return '';
  return 'created ' + dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderTicketsSection(d) {
  // Source preference: LIVE state.ticketSlices for today's editable log.
  // The frozen snapshot (d.tickets) is only used for a PAST SUBMITTED log
  // — there, live can't reconstruct historical state, so the snapshot is
  // authoritative. The old check used d.tickets truthiness, but empty
  // arrays are truthy, so a saved-empty snapshot beat live data and the
  // section showed 0 even when the board had cards. Now we only defer to
  // the snapshot for genuinely-past submitted logs.
  const log = state.currentLog || {};
  const isPastSubmitted = !!log.submitted_at && log.log_date && log.log_date < todayISO();
  const slices = (isPastSubmitted && d.tickets &&
                  (d.tickets.open || d.tickets.working || d.tickets.closed))
    ? d.tickets
    : (state.ticketSlices || { open: [], working: [], closed: [] });
  const notes = d.ticket_notes || { open: '', working: '', closed: '' };

  const openCount    = (slices.open    || []).length;
  const workingCount = (slices.working || []).length;
  const closedCount  = (slices.closed  || []).length;
  const totalCount   = openCount + workingCount + closedCount;

  // Map equipment_id → name for inline equipment links (state.equipmentDown
  // + any loaded equipment). We keep a light lookup built from what's in
  // memory; cards without a resolvable name just show the location.
  const eqNameById = state._cardEquipmentNames || {};

  const laneLabel = (status) => ({
    reported: 'Reported', triaged: 'Triaged', dispatched: 'Dispatched',
    in_progress: 'In Progress', waiting_parts: 'Waiting on Parts',
    resolved: 'Resolved', closed: 'Closed', done: 'Done',
  })[status] || (status || '').replace(/_/g, ' ');

  const cardRow = (c, bucket) => {
    const pri = (c.priority || 'normal').toLowerCase();
    const priClass = pri === 'urgent' ? 'bw-pri-urgent' : (pri === 'low' ? 'bw-pri-low' : 'bw-pri-normal');
    const lane = c._laneLabel || laneLabel(c.status);
    const detail = cardDetail(c);                 // description / first comment, if any
    // Compact: priority pill + title + lane. No assignee / created / emoji.
    const metaBits = [];
    if (lane) metaBits.push(`<span class="dlog-tk-lane dlog-tk-lane-${bucket}">${esc(lane)}</span>`);
    return `
      <div class="dlog-tk-row">
        <span class="bw-pri-pill ${priClass}">${esc(pri)}</span>
        <div class="dlog-tk-main">
          <div class="dlog-tk-title">${esc(c.title || 'Untitled card')}</div>
          <div class="dlog-tk-loc">${metaBits.join(' · ')}</div>
          ${detail ? `<div class="dlog-tk-detail">${esc(detail)}</div>` : ''}
        </div>
      </div>`;
  };

  // v18.35 — split cards by LOCATION. Each card is tagged with its bucket
  // (open/working/closed) so the lane chip still conveys state, but the
  // primary grouping is location, matching the rest of the log. Cards
  // within a location are ordered open → working → closed-today.
  const tagged = [];
  (slices.open    || []).forEach(c => tagged.push({ c, bucket: 'open',    rank: 0 }));
  (slices.working || []).forEach(c => tagged.push({ c, bucket: 'working', rank: 1 }));
  (slices.closed  || []).forEach(c => tagged.push({ c, bucket: 'closed',  rank: 2 }));

  const groups = {};
  tagged.forEach(t => {
    const k = normLocKey(t.c.location);
    (groups[k] = groups[k] || []).push(t);
  });
  Object.values(groups).forEach(arr => arr.sort((a, b) => a.rank - b.rank));
  const orderedKeys = orderedLocationKeys(d, new Set(Object.keys(groups)));
  const activeKeys = new Set((d.locations || []).map(l => normLocKey(l.label)));

  const groupBlocks = orderedKeys.map(k => {
    const rows = groups[k].map(t => cardRow(t.c, t.bucket)).join('');
    const isAuto = !activeKeys.has(k);
    return `
      <div class="dlog-loc-group">
        <div class="dlog-loc-group-head">
          <span class="dlog-loc-group-name">${esc(locDisplayLabel(k))}</span>
          ${isAuto ? '<span class="dlog-loc-group-auto">not in log</span>' : ''}
          <span class="dlog-loc-group-count">${groups[k].length}</span>
        </div>
        <div class="dlog-tk-list">${rows}</div>
      </div>`;
  }).join('');

  // Bucket notes preserved at the section bottom (data model unchanged:
  // ticket_notes.open / .working / .closed).
  const noteField = (label, key, placeholder) => `
    <label class="dlog-field dlog-tk-note">
      <span class="dlog-field-label">${esc(label)} notes</span>
      <textarea data-path="ticket_notes.${key}" rows="2" placeholder="${esc(placeholder)}">${esc(notes[key] || '')}</textarea>
    </label>`;

  return `
    <details class="dlog-section" ${totalCount > 0 ? 'open' : ''}>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Board Tickets</span>
        <span class="dlog-section-count">${totalCount}</span>
      </summary>
      <div class="dlog-section-body">
        <p class="dlog-empty-hint">Live from the Board, split by location. Lane chips show state — open, working, or closed today.</p>
        ${groupBlocks || '<p class="dlog-empty-hint">No active cards.</p>'}
        <div class="dlog-tk-notes-wrap">
          ${noteField('Open',         'open',    'Notes on the backlog…')}
          ${noteField('Working',      'working', 'Status on what\'s being worked…')}
          ${noteField('Closed today', 'closed',  'How they were resolved…')}
        </div>
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
  view.querySelectorAll('[data-loc-pill]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeLoc = btn.getAttribute('data-loc-pill') || 'all';
      render();
    });
  });
  // ── Open Ordering board (from a per-location ordering rollup)
  view.querySelectorAll('.dlog-open-ordering').forEach(btn => {
    btn.addEventListener('click', () => {
      NX.boardActivateKind = 'ordering';   // board.show() switches to it
      if (NX.switchTo) NX.switchTo('board');
      else document.querySelector('.bnav-btn[data-view="board"], .nav-tab[data-view="board"]')?.click();
    });
  });

  const weatherRefresh = view.querySelector('#dlogWeatherRefresh');
  if (weatherRefresh) weatherRefresh.addEventListener('click', () => forceWeather());
  const recentSelect = view.querySelector('#dlogRecentSelect');
  if (recentSelect) recentSelect.addEventListener('change', () => { if (recentSelect.value) openLogForDate(recentSelect.value); });
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

  // ── Add vendor call (per-location, addressed by array idx)
  view.querySelectorAll('[data-add-vendor]').forEach(btn => {
    btn.addEventListener('click', () => {
      const locIdx = parseInt(btn.dataset.addVendor, 10);
      const log = ensureCurrentLog();
      if (!log.data.locations[locIdx]) return;
      if (!Array.isArray(log.data.locations[locIdx].vendor_calls)) {
        log.data.locations[locIdx].vendor_calls = [];
      }
      log.data.locations[locIdx].vendor_calls.push({
        date: '', vendor: '', equipment: '', issue: '', status: ''
      });
      markDirty();
      render();
    });
  });

  // ── Remove vendor row
  view.querySelectorAll('[data-remove-vendor]').forEach(btn => {
    btn.addEventListener('click', () => {
      const locIdx = parseInt(btn.dataset.removeVendor, 10);
      const rowIdx = parseInt(btn.dataset.idx, 10);
      const log = ensureCurrentLog();
      if (!log.data.locations[locIdx]) return;
      log.data.locations[locIdx].vendor_calls.splice(rowIdx, 1);
      markDirty();
      render();
    });
  });

  // ── v18.32 Equipment Status note textarea — writes back to
  // equipment.status_note on blur. Debounced 600ms so rapid typing
  // doesn't generate one UPDATE per keystroke.
  view.querySelectorAll('[data-eq-note]').forEach(ta => {
    const equipmentId = ta.dataset.eqNote;
    let writeTimer = null;
    const flush = async () => {
      const note = ta.value;
      // Update in-memory state.equipmentDown for immediate consistency
      const item = (state.equipmentDown || []).find(eq => eq.id === equipmentId);
      if (item) item.status_note = note;
      // Persist to the equipment row (best-effort, doesn't toast on error)
      await writeEquipmentStatusNote(equipmentId, note);
    };
    ta.addEventListener('input', () => {
      if (writeTimer) clearTimeout(writeTimer);
      writeTimer = setTimeout(flush, 600);
    });
    ta.addEventListener('blur', () => {
      if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
      flush();
    });
  });

  // ── Remove location (the × button in the location section header).
  // stopPropagation is critical — otherwise the click also toggles the
  // <details> open/closed since the × button sits inside <summary>.
  view.querySelectorAll('[data-remove-loc]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(btn.dataset.removeLoc, 10);
      const log = ensureCurrentLog();
      const loc = log.data.locations[idx];
      if (!loc) return;
      // Light confirm before nuking content — locations carry 10 R&M
      // fields + vendor calls, hard to recreate accidentally.
      const filledFields = Object.values(loc.rm || {}).filter(v => v && v.trim()).length
        + (loc.vendor_calls || []).length;
      if (filledFields > 0 && !(await NX.confirm(`Remove "${loc.label}" and all its data (${filledFields} fields)? This can't be undone.`, { danger: true, okLabel: 'Remove' }))) {
        return;
      }
      log.data.locations.splice(idx, 1);
      markDirty();
      render();
    });
  });

  // ── + Add Location picker. Click opens a menu populated from distinct
  // equipment.location values, filtered to ones not already in the log.
  const addLocBtn = view.querySelector('#dlogAddLocBtn');
  const addLocMenu = view.querySelector('#dlogAddLocMenu');
  if (addLocBtn && addLocMenu) {
    addLocBtn.addEventListener('click', async () => {
      const log = ensureCurrentLog();
      const existingLabels = new Set(
        (log.data.locations || []).map(l => (l.label || '').toLowerCase())
      );
      // Refresh dropdown options from equipment table (catches any
      // locations added since the user opened the form)
      const allLocs = await loadEquipmentLocations();
      const available = allLocs.filter(l => !existingLabels.has(l.toLowerCase()));
      if (!available.length) {
        addLocMenu.innerHTML = `<p class="dlog-add-loc-empty">All known equipment locations are already in this log.</p>`;
      } else {
        addLocMenu.innerHTML = available.map(label =>
          `<button type="button" class="dlog-add-loc-opt" data-add-loc-label="${esc(label)}">${esc(label)}</button>`
        ).join('');
        // Bind clicks on each option
        addLocMenu.querySelectorAll('[data-add-loc-label]').forEach(opt => {
          opt.addEventListener('click', () => {
            const label = opt.dataset.addLocLabel;
            const log2 = ensureCurrentLog();
            log2.data.locations.push({
              id: locationIdFromLabel(label),
              label,
              rm: makeEmptyRm(),
              vendor_calls: [],
            });
            addLocMenu.hidden = true;
            markDirty();
            render();
          });
        });
      }
      addLocMenu.hidden = false;
    });
    // Click outside the menu closes it
    document.addEventListener('click', (e) => {
      if (!addLocMenu.hidden && !addLocMenu.contains(e.target) && e.target !== addLocBtn) {
        addLocMenu.hidden = true;
      }
    }, { capture: true });
  }

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

  // ── Save / Upload-to-Drive — both always available regardless of state.
  // Save: persists to Supabase only.
  // Upload: persists + generates/refreshes the Drive doc (same file ID
  // on subsequent calls — see nx-drive's existingFileId path).
  const saveDraft = view.querySelector('#dlogSaveDraftBtn');
  if (saveDraft) saveDraft.addEventListener('click', () => commitSave({ submit: false }));
  const submitBtn = view.querySelector('#dlogSubmitBtn');
  if (submitBtn) submitBtn.addEventListener('click', () => commitSave({ submit: true }));
  const emailBtn = view.querySelector('#dlogEmailBtn');
  if (emailBtn) emailBtn.addEventListener('click', () => openDailyLogEmail());
  const styledBtn = view.querySelector('#dlogStyledEmailBtn');
  if (styledBtn) styledBtn.addEventListener('click', () => openDailyLogStyledEmail());
  const emailEachBtn = view.querySelector('#dlogEmailEachBtn');
  if (emailEachBtn) emailEachBtn.addEventListener('click', () => emailEachLocation());
  const openerLLMBtn = view.querySelector('#dlogOpenerLLM');
  if (openerLLMBtn) openerLLMBtn.addEventListener('click', () => refreshOpenerLLM(openerLLMBtn));
  const openerPoolBtn = view.querySelector('#dlogOpenerPool');
  if (openerPoolBtn) openerPoolBtn.addEventListener('click', () => refreshOpenerPool());
  const autoSendBtn = view.querySelector('#dlogAutoSendBtn');
  const autoSendTime = view.querySelector('#dlogAutoSendTime');
  const autoSendDays = view.querySelector('#dlogAutoSendDays');
  if (autoSendDays) autoSendDays.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
    const dow = parseInt(b.dataset.day, 10);
    let days = dlogAutoSendDays();
    days = days.indexOf(dow) !== -1 ? days.filter(x => x !== dow) : days.concat(dow).sort((a, c) => a - c);
    if (!days.length) days = [dow];   // never allow an empty set
    try { localStorage.setItem('nexus_dlog_autosend_days', JSON.stringify(days)); } catch (_) {}
    b.classList.toggle('is-on', days.indexOf(dow) !== -1);
  }));
  if (autoSendBtn) autoSendBtn.addEventListener('click', () => {
    const on = !dlogAutoSendOn();
    try { localStorage.setItem('nexus_dlog_autosend', on ? '1' : '0'); } catch (_) {}
    autoSendBtn.textContent = on ? '🔁 Auto-send: On' : '🔁 Auto-send: Off';
    autoSendBtn.classList.toggle('is-on', on);
    if (autoSendTime) autoSendTime.style.display = on ? '' : 'none';
    if (autoSendDays) autoSendDays.style.display = on ? '' : 'none';
    if (NX.toast) NX.toast(on
      ? `Auto-send on — uploads to Drive when you leave, or by ${dlogAutoSendTime()} if still unsent`
      : 'Auto-send off — use Upload to send manually', on ? 'success' : 'info', 3800);
  });
  if (autoSendTime) autoSendTime.addEventListener('change', () => {
    const v = autoSendTime.value || '22:00';
    try { localStorage.setItem('nexus_dlog_autosend_time', v); } catch (_) {}
    if (NX.toast) NX.toast(`Auto-send by ${v} if not sent`, 'info');
  });
}

// ── Email composer ────────────────────────────────────────────────────────
// Folds the day's log into a clean, digestible plain-text recap and hands it
// to the device mail composer. Uses the same shared NX.email formatting
// language as the vendor + ordering emails (uppercase section headers,
// 45-char rules, middle-dot bullets) so everything NEXUS emails reads alike.
// Empty fields are skipped so the recap stays scannable.
function fmtLogDateLong(dateStr) {
  try {
    return new Date((dateStr || todayISO()) + 'T00:00:00')
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch (_) { return dateStr || ''; }
}

// Clippy opens the emailed daily log with a one-line quote in his voice —
// restaurant, wine, Roman, Greek, and just-plain-funny, all the way he'd say it.
// Signed with his 👋. The line is picked deterministically from the date so the
// same day's report stays stable, but it rotates day to day.
// (Add more freely — this list is meant to grow.)
const CLIPPY_QUOTES = [
  // ── Clippy himself (handless, load-bearing, coping) ──
  'I\u2019d help carry the kegs, but \u2014 tragically \u2014 I have no hands.',
  'I told the ice machine to chill. It overdid it. We defrosted.',
  'I\u2019m not saying I\u2019m essential, but the lights are on, aren\u2019t they?',
  'I have no hands, no legs, and somehow a full to-do list. Relatable.',
  'They said think outside the box. I am the box. It went poorly. Anyway \u2014 your report.',
  'I asked the toaster for a status update. It gave me nothing but warmth and silence.',
  'I have the memory of an elephant and the hands of, notably, nothing.',
  'They told me to take initiative. I took the day\u2019s report instead. Close enough.',
  'I tried yoga once. I do not bend. I am, structurally, a very round idea.',
  'I don\u2019t have hands, which makes it hard to point fingers. It was the fryer, though.',
  'The mop bucket has better wheels than my entire existence. I\u2019m not bitter. I\u2019m a paperclip.',
  'Invisible, essential infrastructure \u2014 like a cummerbund, but load-bearing. That\u2019s me.',
  // ── Kitchen life ──
  'The line cook said \u201cit\u2019s basically done\u201d about a brisket that needs six more hours. Optimism is a spice.',
  'A recipe says \u201cseason to taste.\u201d Whose taste. Mine is correct and final.',
  'Brunoise, julienne, chiffonade \u2014 three ways to say \u201cI\u2019m stalling before service.\u201d',
  'The stockpot has simmered since Tuesday. It has secrets. We do not ask.',
  'Every great sauce starts with a roux and ends with someone claiming credit for it.',
  'It\u2019s not burnt, it\u2019s blackened. The oven, however, is genuinely calibrated.',
  'The stagiaire touched my station. I forgave them. The dish machine, I actually fixed.',
  'The 86 board is a living document. So is the repair log. Respect them both.',
  'Chef says \u201cbehind\u201d in his sleep. His wife confirms. The line runs deep.',
  'Someone microwaved fish in the staff room. HR has been notified. HR is me. I am powerless.',
  'Someone labeled a container \u201cmystery \u2014 do not open.\u201d Six days now. Morale is high; curiosity, higher.',
  'We found the missing saut\u00e9 pan. We do not discuss where. The dish pit keeps its secrets.',
  'The soda gun baptized the new guy. Tradition. He\u2019s one of us now.',
  'Prep list had 40 items. We did 40. Somewhere, a project manager wept with joy.',
  '\u201cIs the chicken gluten-free?\u201d It\u2019s chicken. The chicken is chicken. I answered with dignity.',
  'A guest asked if the branzino was local. We are 200 miles from any sea. Confident fish, though.',
  'The hood fan hums in B flat, the dish machine answers in D. No cover charge for jazz night.',
  'Today\u2019s forecast: 100% chance of someone unplugging the freezer to charge a phone.',
  'The espresso machine works perfectly now that the repair guy watched it. Machines fear witnesses.',
  'The reach-in door seal broke, so technically it was a walk-in. Fixed. Boundaries restored.',
  'The walk-in and I are in couples therapy. It\u2019s cold, I\u2019m distant. We\u2019re working on it.',
  'The oven and I aren\u2019t speaking, but professionally. It preheats, I log. Cold war, warm food.',
  // ── Front of house ──
  'The reservation said 7:00. The table arrived at 7:45 and asked why we rushed them.',
  'A five-top became a nine-top became a birthday. We adapted. We always adapt.',
  'The special sold out in an hour. The soup of the day remains, tragically, undiscovered.',
  'Somebody asked to split the check nine ways. The math took longer than the meal.',
  'A full reservation book and an empty repair queue \u2014 chef\u2019s kiss.',
  'Fire when ready, plate with pride, and never let the ticket rail win.',
  // ── Somm confessions ──
  'A guest returned a wine for being \u201ccorked.\u201d It was a screwcap. I nodded gravely and brought another. The customer is always corked.',
  'Nothing humbles you like confidently calling a Barbera a Gamay in front of three Master Sommeliers. I have not recovered. I never will.',
  'Half of blind tasting is deduction. The other half is announcing \u201cNebbiolo\u201d with total conviction and being wrong in a beautiful, structured way.',
  'You haven\u2019t known fear until a table orders \u201cthe driest red you have\u201d and means \u201cthe sweetest.\u201d The grid does not prepare you for people.',
  'Somm certifications go Intro, Certified, Advanced, Master, and Divorced. They don\u2019t print the last pin, but we all know it\u2019s there.',
  '\u201cIt just needs to open up\u201d has saved more sommeliers than any decanter. It means \u201cI have no idea what this is yet, please wait.\u201d',
  'The most dangerous words in wine are \u201csurprise me.\u201d That is not curiosity. That is a trap, and the markup is the spring.',
  'You know the somm is nervous when the tasting note gets longer. Four adjectives is confidence. Eleven is a cry for help.',
  'Orange wine is just white wine that spent time on the skins and came back with a whole personality and a podcast.',
  'The natural wine was cloudy, funky, and smelled of a barnyard. \u201cThat\u2019s the point,\u201d said the importer, who I suspect has never met a barn.',
  'I own a $340 Coravin, a decanter, and a foil cutter so I can pour a $14 by-the-glass with the gravity of a coronation.',
  'A wine in its \u201cdumb phase\u201d is closed and giving nothing. So is my will to explain, for the fourth time, why the Riesling isn\u2019t sweet.',
  'Provenance matters enormously, said the man selling me a Burgundy \u201cdefinitely\u201d stored perfectly in a Reseda garage since 1990.',
  'Nobody has ever finished the Wine Bible. We keep it on the shelf the way people keep a Peloton: a monument to intention.',
  'A vertical tasting is drinking the same wine across ten vintages while pretending the seventh didn\u2019t taste exactly like the eighth.',
  'Somebody described a wine as \u201csequential.\u201d We all nodded. No one knows what it means.',
  'I called the finish \u201clong.\u201d It lasted four seconds. I lied for the tip, and I\u2019d do it again.',
  'A guest asked if the wine \u201cpairs with the chicken.\u201d They ordered the steak. I aged visibly.',
  'I swirled with such passion I redecorated the tablecloth in Syrah. Art demands sacrifice.',
  'I decanted a screwcap into crystal so the guest could feel the romance. The romance is a lie and the lie is the job.',
  'The wine list is 46 pages; the food menu is one. We have priorities and they are not lunch.',
  'I recommended an obscure Georgian grape, then could not pronounce it. Neither could the guest. We bonded in mutual defeat.',
  'A guest sent back a wine because \u201cit tastes like alcohol.\u201d Sir. Sir. I composed myself.',
  'I sniffed the cork like it would confess something. It confessed nothing. Corks never do.',
  'I described the tannins as \u201cgrippy, like a firm handshake from a distant uncle.\u201d The table just stared.',
  'A guest asked for \u201ca nice Pinot Grigio\u201d and something in me died, quietly, professionally.',
  'I told a table the wine \u201chas a sense of humor.\u201d It does not. Wine cannot laugh. It also can\u2019t fire me.',
  'I aerated a $14 red in a $200 decanter. The theater is the whole point.',
  'Corkage fee: the price of watching someone else\u2019s bottle outshine my whole list.',
  'A table sent back a flawless Chablis for being \u201ctoo wine-y.\u201d I have notes. The dishwasher took no notes and simply worked.',
  'I called it Old World with total conviction. It was a Thursday grocery-store special. Humbling. The wine fridge has never embarrassed me.',
  'I decanted the Barolo for two hours and the GM for none. Both opened up eventually.',
  'A vertical of the same fridge, 2019 through 2024, all still running. A rare vintage.',
  // ── Rome & Greece (with jokes) ──
  'Veni, vidi, verified the hood vents. \u2014 Caesar, probably.',
  'Carthago delenda est \u2014 but first, the grease trap must be cleaned.',
  'Nero fiddled while Rome burned. We replaced the fiddle and the smoke detector.',
  'Caesar was stabbed 23 times. Our reservation system, only four today. Rome would be jealous.',
  'Hannibal crossed the Alps with 37 elephants. Our produce guy still can\u2019t find the loading dock.',
  'The Year of Four Emperors was chaos; your Friday had one manager and it held. Progress.',
  'The Defenestration of Prague, but it\u2019s just me tossing the broken gasket out the window.',
  'The Colosseum sat 50,000. Your dining room seats 80 and somehow feels louder.',
  'An empire runs on clean drains. Just ask Cloacina, actual Roman goddess of the sewers.',
  'Build to last \u2014 Roman concrete heals itself. The dishwasher does not. That\u2019s our job.',
  'Marcus Aurelius journaled every day. You logged every day. Stoicism lives.',
  'Socrates knew nothing \u2014 except that the fryer needs a deep clean.',
  'Diogenes lived in a barrel. Your storeroom is better organized. Philosophy has moved on.',
  'Icarus flew too close to the fryer. We keep our distance and our eyebrows.',
  'Sisyphus rolled the same boulder daily. We roll the same dough daily. He had it easier.',
  'Even Odysseus took ten years to get home. Your repair took a week. We\u2019re winning.',
  'Pythagoras loved a clean triangle; I love a clean hood filter. We are not so different.',
  // ── History, misc (with jokes) ──
  'Ea-n\u0101\u1e63ir sold bad copper 3,700 years ago and we still complain online. Your gasket is premium, though.',
  'Tulip mania was a bubble; your maintenance budget is a sound investment. Historically vindicated.',
  'The Antikythera mechanism was ancient predictive maintenance. We\u2019re just carrying the torch.',
  'The Library of Alexandria burned; our recipe binder is backed up twice. Lessons learned.',
  'Pompeii was buried in a day. Our prep list survives, somehow, every single one.',
  'The printing press changed everything. So did the POS system, allegedly.',
  'Miyamoto Musashi won sixty duels. You closed four work orders. A worthy start.',
  'Wabi-sabi finds beauty in imperfection. The dented pot stays in rotation on principle.',
  'Ikigai: your reason for being. Mine is currently \u201cthe walk sheet is done.\u201d',
  'The tea master perfects one gesture for a lifetime. We\u2019re still working on the napkin fold.',
  'Gaud\u00ed took forty years on the Sagrada Fam\u00edlia. Your repair took an afternoon. Faster, arguably.',
  'La Tomatina throws tomatoes for fun. We use ours in sauce. Waste not.',
  'Sobremesa: linger at the table. The dishwasher, meanwhile, works. Balance.',
  'The agave takes eight years to mature. Your PM took eight minutes. We\u2019re ahead.',
  'The mol\u00e9 takes days to build and seconds to disappear off the pass.',
  'Red card to the broken gasket \u2014 off the pitch. Fresh one subbed in.',
  'Extra time is stressful in football and in a slammed Friday. We finish both.',
  // ── Pastry (heartbreak division) ──
  'A macaron has one acceptable foot. The rest is heartbreak in almond flour.',
  'P\u00e2te \u00e0 choux either puffs or it doesn\u2019t, and there is no in-between and no mercy.',
  'Chocolate seized once. We do not speak of it. We temper carefully now.',
  'The bench flour never runs out; neither does the manager\u2019s patience, allegedly.',
  'The croissant has twenty-seven layers. Your repair log has fewer, thankfully.',
  'Caramel is just sugar that kept its nerve. Be the caramel.',
  // ── Dad jokes (premium shelf) ──
  'The espresso machine broke down \u2014 it just couldn\u2019t espresso its feelings. Fixed now.',
  'Why did the coffee file a police report? It got mugged. The machine\u2019s fine.',
  'I burned 2,000 calories today \u2014 left the pizza in the oven. We recalibrated the timer.',
  'Why don\u2019t eggs tell jokes on the line? They\u2019d crack each other up.',
  'What did the grape do when it got stepped on? Let out a little wine. Fitting.',
  'I tried to catch fog on the line this morning. I mist.',
  'I\u2019m reading a book about anti-gravity \u2014 can\u2019t put it down. Unlike the mop. That, I put down.',
  'The rotisserie said it couldn\u2019t eat another bite \u2014 it was already stuffed.',
  'What do you call a sad espresso? A depresso. Restocked the machine anyway.',
  'I made a belt out of watches once \u2014 total waist of time. Speaking of time, here\u2019s your day.',
  'My soup cracked a joke mid-service. A little too saucy for the pass.',
  'I\u2019m on a seafood diet. I see food, I log it, I move on with my life.',
  'What do you call an alligator in a vest? An investigator. He found nothing wrong with tonight\u2019s prep.',
  // ── Film ──
  'I\u2019m going to make it an offer it can\u2019t refuse: preventive maintenance.',
  'Say hello to my little torque wrench. The gasket never stood a chance.',
  'Life is like a box of chocolates \u2014 keep it at 65\u00b0F or it melts. We did.',
  'I see dead pilot lights. Relit two of them personally.',
  'May the fourth be with the fryer oil \u2014 changed today, right on schedule.',
  'Show me the money \u2014 or at least the invoice. Either works.',
];
// The static pool line for a date — deterministic, always available. Used as
// the fallback when Clippy hasn't authored a fresh line for the day (offline
// brain, no API key, or generation still in flight).
function dlogStaticQuote(dateStr) {
  const s = String(dateStr || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CLIPPY_QUOTES[h % CLIPPY_QUOTES.length];
}
// A RANDOM pool line (for the "from the pool" refresh button), never the same
// one twice in a row.
function dlogRandomPoolQuote(exclude) {
  if (CLIPPY_QUOTES.length < 2) return CLIPPY_QUOTES[0];
  let q;
  do { q = CLIPPY_QUOTES[Math.floor(Math.random() * CLIPPY_QUOTES.length)]; } while (q === exclude);
  return q;
}
// The current opener for a date: Clippy's authored line if he wrote one today,
// else the deterministic pool line.
function dlogCurrentOpener(dateStr) {
  return (state.clippyQuoteText && state.clippyQuoteDate === dateStr)
    ? state.clippyQuoteText : dlogStaticQuote(dateStr);
}
// The email opener, shown in the log with two refresh controls: one has Clippy
// write a fresh line (drafts three, keeps the best), one pulls a different line
// from the static pool. Whatever shows here is exactly what the emails use.
function renderOpenerPreview(dateStr) {
  const cur = dlogCurrentOpener(dateStr);
  const isLLM = state.clippyQuoteSource === 'llm' && state.clippyQuoteDate === dateStr;
  return `
    <div class="dlog-opener" id="dlogOpener">
      <div class="dlog-opener-head">
        <span class="dlog-opener-label">✉ Email opener</span>
        <span class="dlog-opener-src" id="dlogOpenerSrc">${isLLM ? 'Clippy wrote this' : 'from the pool'}</span>
      </div>
      <p class="dlog-opener-text" id="dlogOpenerText">${esc(cur)} — Clippy 👋</p>
      <div class="dlog-opener-btns">
        <button type="button" class="eq-btn eq-btn-secondary" id="dlogOpenerLLM" title="Clippy writes a fresh one — drafts three and keeps the most him">↻ New from Clippy</button>
        <button type="button" class="eq-btn eq-btn-secondary" id="dlogOpenerPool" title="Pick a different line from the quote pool">↻ From the pool</button>
      </div>
    </div>`;
}

function dlogEmailGreeting(label, dateStr) {
  // Prefer Clippy's own line for TODAY's actual report if he wrote one
  // (ensureClippyDailyQuote pre-generates it); otherwise the static pool.
  const quote = (state.clippyQuoteText && state.clippyQuoteDate === dateStr)
    ? state.clippyQuoteText
    : dlogStaticQuote(dateStr);
  // Signature rides at the END of the quote line, not under it.
  return [
    quote + ' — Clippy 👋',
    '',
  ];
}

// ── Clippy writes the day's line ─────────────────────────────────────────
// Instead of a canned quote, hand Clippy the day's ACTUAL facts and let him
// riff one opener in his voice via NX.askClaude (cloud / node pool / local).
// Everything degrades to dlogStaticQuote on any failure, so the report always
// has a signature line.

// Compact, factual digest of the day for Clippy to react to (not a data dump).
function dlogDaySummary(d) {
  const clean = s => String(s == null ? '' : s).trim();
  const bits = [];
  const wx = clean(d.header && d.header.weather);
  if (wx) bits.push('Weather: ' + wx);
  const sig = clean(d.header && d.header.significant_events);
  if (sig) bits.push('Notable: ' + sig.slice(0, 200));
  const pms = state.pmsToday || [];
  if (pms.length) {
    const names = pms.slice(0, 6).map(p => (p.equipment && p.equipment.name) || 'a unit').join(', ');
    bits.push(pms.length + ' PM' + (pms.length > 1 ? 's' : '') + ' completed (' + names + ')');
  }
  const down = (state.equipmentDown || []).filter(e => e && e.archived !== true);
  if (down.length) bits.push(down.length + ' unit(s) down: ' + down.slice(0, 5).map(e => e.name || 'a unit').join(', '));
  const acts = (state.equipmentActivity || []).length;
  if (acts) bits.push(acts + ' equipment event(s) logged');
  const va = clean(d.vendor_activity_notes);
  if (va) bits.push('Vendor activity: ' + va.slice(0, 150));
  const locNotes = (d.locations || []).map(l => clean(l.notes)).filter(Boolean);
  if (locNotes.length) bits.push('Floor notes: ' + locNotes.join(' | ').slice(0, 220));
  return bits.join('. ');
}

// ONE opener for the whole day, shared across every location (memoized per date
// in ensureClippyDailyQuote). To make sure it really sounds like HIM and not a
// generic assistant, Clippy drafts THREE candidates, then reads them back and
// picks the one that's most his — dry, warm, a little literary. Runs entirely
// in the background now, so the extra self-selection pass costs nothing the
// user waits on. Any failure at any step degrades to the static quote pool.
// Ask an LLM for one short line. Prefer the app's router (NX.askClaude →
// node pool / whatever's wired), then fall back to the clippy-brain Supabase
// edge function, which holds the Anthropic key in Supabase — so the opener can
// still improvise even when the node pool is off. Returns null if neither is
// reachable, and the caller drops to the static pool.
async function dlogAskLLM(system, user, maxTokens) {
  // ORDER MATTERS. The clippy-brain edge function (Anthropic key in
  // Supabase) answers in a few seconds and is always on; the node-pool
  // router (NX.askClaude) posts a job to clippy_sync and waits for a
  // desktop worker to pick it up — when that worker's local model is off,
  // the job hangs far past our UI timeout. That hang is exactly why
  // "New from Clippy" reported "no model reachable" while the job bus
  // quietly filled with connection-refused failures. Cloud first, pool second.
  try {
    const base = 'https://oprsthfxqrdbwdvommpw.supabase.co';
    const anon = 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9';
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 12000) : null;
    const res = await fetch(base + '/functions/v1/clippy-brain', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + anon, apikey: anon, 'content-type': 'application/json' },
      body: JSON.stringify({ system, user, max_tokens: maxTokens }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    const data = await res.json();
    const s = String((data && data.text) || '').trim();
    if (s) return s;
  } catch (_) {}
  // Fallback: the node pool — capped short so a dead desktop worker can't
  // hold the button hostage.
  try {
    if (window.NX && typeof NX.askClaude === 'function') {
      const r = await Promise.race([
        NX.askClaude(system, [{ role: 'user', content: user }], maxTokens),
        new Promise(res2 => setTimeout(() => res2(null), 8000)),
      ]);
      const s = String(r || '').trim();
      if (s) return s;
    }
  } catch (_) {}
  return null;
}

async function generateClippyDailyQuote(d, dateStr) {
  const summary = dlogDaySummary(d);
  if (!summary) return null;   // nothing happened → let the static pool carry it
  const examples = [dlogStaticQuote(dateStr), CLIPPY_QUOTES[3], CLIPPY_QUOTES[70]].filter(Boolean);
  const tidy = s => String(s || '')
    .replace(/^\s*\d+[.)\]:\-]\s*/, '')                 // strip "1." / "2)" numbering
    .replace(/^["'“”\-\s]+|["'“”\s]+$/g, '')            // strip wrapping quotes/dashes
    .replace(/^Clippy\s*:?\s*/i, '').trim();

  // ── Step 1: draft three distinct candidates ────────────────────────────
  const draftSys = [
    'You are Clippy, the wry maintenance daemon for a group of restaurants.',
    'Draft THREE distinct one-line openers for the daily facility report, each riffing on the ACTUAL day you are given.',
    'Voice: FUNNY first — deadpan, dry, a little absurd. Aim for an actual laugh, not a nod. Kitchen chaos, somm confessions, Roman history with a punchline, and your own handless-paperclip predicament are all fair game.',
    'Comedy rules: land ONE joke per line and get out. Specific beats generic. Self-deprecation beats smugness. A pun is allowed only if it is excellent. Never inspirational, never a metaphor about maintenance being like cooking.',
    'Rules: each is one sentence (or two very short ones), max ~28 words. No emojis. No surrounding quotation marks. React like a clever colleague; do NOT list the data back. Do not sign it.',
    'Return ONLY the three lines, numbered 1., 2., 3. — nothing else.',
    'The sound to hit (examples):',
    ...examples.map(e => '- ' + e),
  ].join('\n');
  const draftUser = "Today's report facts:\n" + summary + "\n\nDraft Clippy's three candidate openers.";
  let candidates = [];
  try {
    const raw = await dlogAskLLM(draftSys, draftUser, 220);
    candidates = String(raw || '').split('\n').map(tidy)
      .filter(x => x.length >= 8 && x.length <= 240).slice(0, 3);
  } catch (_) { return null; }
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  // ── Step 2: Clippy reads them back and keeps the most Clippy one ────────
  try {
    const judgeSys = [
      'You are Clippy. Below are candidate openers for today\'s report.',
      'Pick the ONE that is genuinely the FUNNIEST while still sounding like you: deadpan, dry, specific. Disqualify anything inspirational or that merely restates the data.',
      'Reply with ONLY the number of the best line (1, 2, or 3). Nothing else.',
    ].join('\n');
    const judgeUser = candidates.map((c, i) => (i + 1) + '. ' + c).join('\n');
    const pick = await dlogAskLLM(judgeSys, judgeUser, 8);
    const m = String(pick || '').match(/[123]/);
    const n = m ? parseInt(m[0], 10) : 0;
    if (n >= 1 && n <= candidates.length) return candidates[n - 1];
  } catch (_) { /* judge failed → fall through to first candidate */ }
  return candidates[0];
}

// Memoized per date. Resolves the day's line into state for the sync greeting
// builder. Caps its own wait so composing an email is never blocked for long;
// on null it clears the memo so a later open can retry.
function ensureClippyDailyQuote(d, dateStr) {
  // ONE quote per day, everywhere. If a line is already locked in for this
  // date — Clippy authored it, or the user hand-picked one from the pool —
  // never overwrite it in the background. Without this, a slow generation
  // could land between two per-location sends and give Este and Suerte
  // different openers (or clobber a pool pick the user just made).
  if (state.clippyQuoteText && state.clippyQuoteDate === dateStr) {
    return Promise.resolve(state.clippyQuoteText);
  }
  if (state._cqPromise && state._cqDate === dateStr) return state._cqPromise;
  if (state._cqDate !== dateStr) { state._cqDate = dateStr; state._cqAttempts = 0; }
  const attempt = (state._cqAttempts = (state._cqAttempts || 0) + 1);
  state._cqPromise = (async () => {
    let text = null;
    try {
      // Generous cap: generation is fully in the background now (the email
      // never awaits it), and it makes two calls — a 3-candidate draft plus a
      // self-selection pass — so give it room. On timeout we settle on the pool.
      text = await Promise.race([
        generateClippyDailyQuote(d, dateStr),
        new Promise(r => setTimeout(() => r(null), 22000)),
      ]);
    } catch (_) {}
    state.clippyQuoteDate = dateStr;
    state.clippyQuoteText = text || null;
    state.clippyQuoteSource = text ? 'llm' : null;
    // Allow a few retries across the day (brain was cold/offline), then settle
    // on the static pool so repeated opens can't spam generation.
    if (!text && attempt < 4) state._cqPromise = null;
    return text;
  })();
  return state._cqPromise;
}

function buildDailyLogEmailBody(d, dateStr) {
  const SH = (l, s) => (window.NX && NX.email) ? NX.email.sectionHeader(l, s) : ('--- ' + String(l).toUpperCase() + ' ---');
  const RULE = () => (window.NX && NX.email) ? NX.email.rule() : '-----------------------------------';
  const clean = s => String(s == null ? '' : s).trim();
  const out = [];

  // No title line here \u2014 the email subject already carries "Daily Log \u2014 <date>",
  // and the greeting restates the day, so repeating it up top was redundant.
  dlogEmailGreeting(null, dateStr).forEach(l => out.push(l));
  // Weather now lives in the body (was a header line). Placed before _bodyStart
  // so it's ambient context and a weather-only report still reads as "Quiet day".
  if (clean(d.header && d.header.weather)) { out.push(SH('Weather')); out.push(clean(d.header.weather)); out.push(''); }
  const _bodyStart = out.length;   // section content begins here (after greeting + weather)

  if (clean(d.header && d.header.significant_events)) {
    out.push(SH('Significant events'));
    out.push(clean(d.header.significant_events));
    out.push('');
  }

  const plan = [];
  if (d.planning) {
    if (clean(d.planning.tomorrow_plan)) plan.push(['Tomorrow', d.planning.tomorrow_plan]);
    if (clean(d.planning.this_week))     plan.push(['This week', d.planning.this_week]);
    if (clean(d.planning.side_notes))    plan.push(['Side notes', d.planning.side_notes]);
  }
  if (plan.length) {
    out.push(SH('Planning'));
    plan.forEach(p => out.push(p[0] + ': ' + clean(p[1])));
    out.push('');
  }

  (d.locations || []).forEach(loc => {
    const lines = dlogLocationReportLines(loc);
    if (!lines.length) return;     // skip empty location
    out.push(SH(loc.label || 'Location'));
    lines.forEach(l => out.push(l));
    out.push('');
  });

  // PMs performed today now render inside each location's own block above
  // (dlogLocationReportLines). This catch-all only lists PMs whose equipment
  // location doesn't match any location section in the report, so a PM at an
  // un-listed location is never silently dropped from the full-day digest.
  const matchedLocs = new Set((d.locations || []).map(l => normLocKey(l.label)));
  const orphanPms = (state.pmsToday || []).filter(p =>
    !matchedLocs.has(normLocKey((p.equipment && p.equipment.location) || '')));
  if (orphanPms.length) {
    out.push(SH('PMs logged', String(orphanPms.length)));
    const pmGroups = {};
    orphanPms.forEach(p => {
      const loc = (p.equipment && p.equipment.location) || 'Unspecified location';
      (pmGroups[loc] = pmGroups[loc] || []).push(p);
    });
    Object.keys(pmGroups).sort().forEach(loc => {
      out.push(loc + ':');
      pmGroups[loc].forEach(p => {
        const eqName = (p.equipment && p.equipment.name) || ('Equipment ' + String(p.equipment_id || '').slice(0, 8));
        const who = clean(p.performed_by) || 'unassigned';
        const cost = (p.cost != null && !isNaN(p.cost) && Number(p.cost) > 0) ? ' — $' + Math.round(Number(p.cost)).toLocaleString() : '';
        out.push('· ' + eqName + ' — by ' + who + cost);
      });
    });
    out.push('');
  }

  if (clean(d.vendor_activity_notes)) {
    out.push(SH('Vendor activity'));
    out.push(clean(d.vendor_activity_notes));
    out.push('');
  }

  const clLines = [];
  if (d.cleaning) CLEANING_FIELDS.forEach(f => {
    const v = clean(d.cleaning[f.key]);
    if (v) clLines.push('\u00b7 ' + f.label + ': ' + v);
  });
  if (clLines.length) { out.push(SH('Cleaning')); clLines.forEach(l => out.push(l)); out.push(''); }

  const others = (d.other_properties || []).filter(o => clean(o.property_name) || clean(o.notes));
  if (others.length) {
    out.push(SH('Other properties'));
    others.forEach(o => out.push('\u00b7 ' + (clean(o.property_name) || 'Property') + (clean(o.notes) ? ': ' + clean(o.notes) : '')));
    out.push('');
  }

  // Empty-day friendliness — if no section produced content, say so plainly
  // instead of sending an email that's just a header and a signature.
  while (out.length > _bodyStart && out[out.length - 1] === '') out.pop();
  if (out.length === _bodyStart) { out.push('Quiet day — nothing flagged.'); out.push(''); }

  out.push(RULE());
  const me = (window.NX && (NX.user || NX.currentUser)) ? ((NX.user && NX.user.name) || (NX.currentUser && NX.currentUser.name) || '') : '';
  if (me) out.push(me);

  // Quiet brand footnote.
  out.push('');
  out.push('powered by nexus');

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Builds a recap that pertains to ONE location only — its notes, R&M, and
// vendor/service calls. Used when a location pill is selected so you can send
// a venue manager just their venue, split out from the rest of the day.
// Render ONE location's report as digestible email lines: service report,
// R&M, vendor calls, next service, other notes — each section skipped when
// empty. Shared by the per-location email and the full-day digest.
function dlogLocationReportLines(loc) {
  const clean = s => String(s == null ? '' : s).trim();
  const SH = l => (window.NX && NX.email) ? NX.email.sectionHeader(l) : ('--- ' + String(l).toUpperCase() + ' ---');
  const out = [];
  const locKey = normLocKey(loc.label);

  // At a glance — the day's signal up front, so the reader gets the headline
  // before scrolling into detail. Counts equipment down, urgent work orders,
  // PM overdue, and total open work; each bit is dropped when zero, and the
  // whole line is skipped when there's nothing to flag.
  {
    const hereG = c => normLocKey(c.location) === locKey;
    const slicesG = state.ticketSlices || {};
    const openG = (slicesG.open || []).filter(hereG);
    const workingG = (slicesG.working || []).filter(hereG);
    const urgentG = openG.concat(workingG).filter(c => (c.priority || '').toLowerCase() === 'urgent').length;
    const downG = (state.equipmentDown || []).filter(eq => normLocKey(eq.location) === locKey && eq.archived !== true && String(eq.status || '').toLowerCase() !== 'retired').length;
    const todayG = new Date(); todayG.setHours(0, 0, 0, 0);
    const nextG = (lastIso, days) => { const n = parseInt(days, 10); if (!lastIso || !n) return null; const dd = new Date(String(lastIso).slice(0, 10) + 'T00:00:00'); if (isNaN(dd)) return null; dd.setDate(dd.getDate() + n); return dd; };
    let pmOverdueG = 0, pmSchedG = 0;
    (state.equipmentHealth || []).filter(eq => normLocKey(eq.location) === locKey && eq.archived !== true && String(eq.status || '').toLowerCase() !== 'retired').forEach(eq => {
      const pmNext = eq.next_pm_date ? new Date(String(eq.next_pm_date).slice(0, 10) + 'T00:00:00') : nextG(eq.last_pm_date, eq.pm_interval_days);
      if (pmNext && !isNaN(pmNext) && pmNext < todayG) {
        pmOverdueG++;
        if (pmConfirmNote(eq.id)) pmSchedG++;
      }
    });
    const bits = [];
    if (downG) bits.push(downG + ' down');
    if (urgentG) bits.push(urgentG + ' urgent');
    if (pmOverdueG) bits.push(pmOverdueG + ' PM overdue' + (pmSchedG ? ' (' + pmSchedG + ' scheduled)' : ''));
    const openTotalG = openG.length + workingG.length;
    if (openTotalG) bits.push(openTotalG + ' open');
    if (bits.length) { out.push('At a glance: ' + bits.join(' · ')); out.push(''); }
  }

  // Weather is shown once in the email header (see buildLocationEmailBody /
  // buildDailyLogEmailBody) — no standalone WEATHER section here, or it reads
  // twice.

  // Notes — the shift recap the manager types into this location's note.
  if (clean(loc.notes)) { out.push(SH('Notes')); out.push(clean(loc.notes)); out.push(''); }

  // Equipment status — pulled live from NEXUS: anything non-operational at
  // this location, with its status note. No manual entry.
  // Retired units are excluded from the daily recap entirely — they're out of
  // service, not actionable, so they shouldn't surface in status or health.
  const down = (state.equipmentDown || []).filter(eq => normLocKey(eq.location) === locKey && eq.archived !== true && String(eq.status || '').toLowerCase() !== 'retired');
  if (down.length) {
    out.push(SH('Equipment status'));
    const issByEq = state.openIssuesByEq || {};
    const shortD = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
    const etaTxt = iso => {
      if (!iso) return '';
      const d = new Date(iso); if (isNaN(d)) return '';
      const t = new Date(); const sameDay = d.toDateString() === t.toDateString();
      return sameDay
        ? ('today ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
        : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    };
    down.forEach(eq => {
      // Front-load a status tag ([DOWN], [NEEDS SERVICE], \u2026) to match the
      // work-order [URGENT]/[HIGH] tags so the whole email scans the same way.
      const st = (eq.status || '').replace(/_/g, ' ').trim();
      const stTag = st ? '[' + st.toUpperCase() + '] ' : '';
      out.push('\u00b7 ' + stTag + (eq.name || 'Equipment'));
      if (clean(eq.status_note)) out.push('    why: ' + clean(eq.status_note));
      // Has a contractor been called? Surface the open work-order lifecycle.
      const iss = issByEq[eq.id];
      if (!iss) {
        out.push('    call: not logged \u2014 no open work order yet');
      } else {
        const s = (iss.status || '').toLowerCase();
        const who = iss.contractor_name ? ' to ' + clean(iss.contractor_name) : '';
        if (s === 'reported' || s === 'open' || s === 'new')
          out.push('    call: NOT placed yet \u2014 reported ' + shortD(iss.reported_at || iss.created_at));
        else if (s === 'contractor_called' || s === 'called' || s === 'dispatched')
          out.push('    call: placed' + who + (iss.contractor_called_at ? ' on ' + shortD(iss.contractor_called_at) : '') + (iss.eta_at ? ' \u2014 ETA ' + etaTxt(iss.eta_at) : ''));
        else if (s === 'eta_set' || s === 'scheduled')
          out.push('    call: placed' + who + ' \u2014 ETA ' + etaTxt(iss.eta_at));
        else if (s === 'in_progress' || s === 'on_site')
          out.push('    call: placed \u2014 contractor on site, repair in progress');
        else if (s === 'awaiting_parts')
          out.push('    call: placed \u2014 awaiting parts');
        else if (s === 'quote_requested' || s === 'awaiting_quote')
          out.push('    call: placed' + who + ' \u2014 awaiting quote');
        else
          out.push('    call: ' + s.replace(/_/g, ' '));
      }
    });
    out.push('');
  }

  // PMs performed today at THIS location — preventive maintenance actually
  // completed on this date (state.pmsToday), each with the equipment and who
  // did it. Distinct from "Maintenance health" below, which is what's DUE.
  // Lives here so it rides along in both the per-location email and each
  // location's block of the full-day digest.
  const pmsHere = (state.pmsToday || []).filter(p =>
    normLocKey((p.equipment && p.equipment.location) || '') === locKey);
  if (pmsHere.length) {
    out.push(SH('PMs logged'));
    pmsHere.forEach(p => {
      const eqName = (p.equipment && p.equipment.name) || ('Equipment ' + String(p.equipment_id || '').slice(0, 8));
      const who = clean(p.performed_by) || 'unassigned';
      const cost = (p.cost != null && !isNaN(p.cost) && Number(p.cost) > 0) ? ' — $' + Math.round(Number(p.cost)).toLocaleString() : '';
      out.push('· ' + eqName + ' — by ' + who + cost);
    });
    out.push('');
  }

  // Maintenance health + warranties — pulled live from the full fleet
  // (state.equipmentHealth). Health = PM/inspection/deep-clean due counts;
  // the Warranties block only renders when this location has units with a
  // warranty date ("if it has any").
  const eqAll = (state.equipmentHealth || []).filter(eq => normLocKey(eq.location) === locKey && eq.archived !== true && String(eq.status || '').toLowerCase() !== 'retired');
  if (eqAll.length) {
    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
    const soonD = new Date(todayD); soonD.setDate(soonD.getDate() + 14);
    const nextOf = (lastIso, days) => {
      const n = parseInt(days, 10);
      if (!lastIso || !n) return null;
      const d = new Date(String(lastIso).slice(0, 10) + 'T00:00:00');
      if (isNaN(d)) return null;
      d.setDate(d.getDate() + n);
      return d;
    };
    // Inspections get a LONGER lead time than PMs (30 days vs 14) — they're
    // usually vendor visits that need booking, so the note flags them early.
    const soonInsD = new Date(todayD); soonInsD.setDate(soonInsD.getDate() + 30);
    let dcO = 0, dcS = 0, op = 0;
    const pmItems = [], insItems = [];
    const shortDate2 = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    eqAll.forEach(eq => {
      if ((eq.status || 'operational').toLowerCase() === 'operational') op++;
      const pmNext = eq.next_pm_date
        ? new Date(String(eq.next_pm_date).slice(0, 10) + 'T00:00:00')
        : nextOf(eq.last_pm_date, eq.pm_interval_days);
      if (pmNext && !isNaN(pmNext) && pmNext <= soonD) {
        const overdue = pmNext < todayD;
        const days = Math.round((pmNext - todayD) / 86400000);
        pmItems.push({ name: eq.name || 'Equipment', date: pmNext, overdue, days, sched: pmConfirmNote(eq.id) });
      }
      const insNext = nextOf(eq.last_inspection_date, eq.inspection_interval_days);
      if (insNext && !isNaN(insNext) && insNext <= soonInsD) {
        const overdue = insNext < todayD;
        const days = Math.round((insNext - todayD) / 86400000);
        const sched = pmConfirmNote(eq.id);
        // The unit's assigned inspection vendor (pool-picked in Equipment)
        // rides along so the note says who to call.
        let vendor = '';
        if (eq.inspection_vendor_id) {
          const v = (state.vendors || []).find(x => String(x.id) === String(eq.inspection_vendor_id));
          vendor = v ? (v.company || v.name || '') : '';
        }
        // Alfredo's rule: an upcoming inspection with the next visit already
        // booked doesn't need to appear at all — the nag is only for
        // UNhandled ones. Overdue inspections always show (with the booking
        // note when one exists), same treatment as overdue PMs.
        if (overdue || !sched) {
          insItems.push({ name: eq.name || 'Equipment', date: insNext, overdue, days, sched, vendor });
        }
      }
      const dcNext = nextOf(eq.last_deep_clean_date, eq.deep_clean_interval_days);
      if (dcNext) { if (dcNext < todayD) dcO++; else if (dcNext <= soonD) dcS++; }
    });
    out.push(SH('Maintenance health'));
    out.push('· ' + eqAll.length + ' unit' + (eqAll.length === 1 ? '' : 's') + ' — ' + op + ' operational');
    // Which units aren't operational, and their status.
    const _nonOp = eqAll.filter(e => (e.status || 'operational').toLowerCase() !== 'operational');
    _nonOp.forEach(e => { const _st = (e.status || '').replace(/_/g, ' ').trim(); out.push('    [' + (_st ? _st.toUpperCase() : 'NOT OPERATIONAL') + '] ' + (e.name || 'Equipment')); });
    // PM due — itemized: WHICH unit + WHEN it was/is due (not just a count).
    if (pmItems.length) {
      pmItems.sort((a, b) => a.date - b.date);
      const overdueN = pmItems.filter(x => x.overdue).length;
      out.push('· PM due: ' + pmItems.length + (overdueN ? ' (' + overdueN + ' overdue)' : ''));
      pmItems.slice(0, 12).forEach(x => {
        // [OVERDUE]/[DUE] tag front-loaded for the same scannable style as the
        // work-order and equipment-status tags. When a pm_schedules visit is
        // booked, say so — "10d overdue" alone reads as unhandled when the
        // vendor is in fact confirmed for the 22nd.
        out.push('    ' + (x.overdue
          ? ('[OVERDUE] ' + x.name + ' — was due ' + shortDate2(x.date) + (x.days <= -1 ? ' (' + Math.abs(x.days) + 'd overdue)' : '') + (x.sched ? ' — ' + x.sched : ''))
          : ('[DUE] ' + x.name + ' — ' + shortDate2(x.date) + (x.days <= 14 ? ' (in ' + x.days + 'd)' : '') + (x.sched ? ' — ' + x.sched : ''))));
      });
      if (pmItems.length > 12) out.push('    +' + (pmItems.length - 12) + ' more');
    }
    // Inspections — itemized like PMs (was a bare count), 30-day window.
    // Units whose upcoming inspection already has a visit booked were
    // dropped above, so every line here is actionable.
    if (insItems.length) {
      insItems.sort((a, b) => a.date - b.date);
      const overdueN = insItems.filter(x => x.overdue).length;
      out.push('· Inspections due: ' + insItems.length + (overdueN ? ' (' + overdueN + ' overdue)' : ''));
      insItems.slice(0, 12).forEach(x => {
        out.push('    ' + (x.overdue
          ? ('[OVERDUE] ' + x.name + ' — was due ' + shortDate2(x.date) + (x.days <= -1 ? ' (' + Math.abs(x.days) + 'd overdue)' : '') + (x.sched ? ' — ' + x.sched : (x.vendor ? ' — call ' + x.vendor : '')))
          : ('[DUE] ' + x.name + ' — ' + shortDate2(x.date) + ' (in ' + x.days + 'd)' + (x.vendor ? ' — ' + x.vendor : ''))));
      });
      if (insItems.length > 12) out.push('    +' + (insItems.length - 12) + ' more');
    }
    const dueLine = (label, over, soon) => {
      const t = over + soon;
      return t ? ('· ' + label + ' due: ' + t + (over ? ' (' + over + ' overdue)' : '')) : null;
    };
    [dueLine('Deep cleans', dcO, dcS)].filter(Boolean).forEach(l => out.push(l));
    out.push('');

    // Warranty — prompt ONLY when a unit's warranty is within 90 days of
    // expiring (the actionable window). No active/expired roll-up; if nothing
    // is coming due, the email says nothing about warranties.
    const todayMs = todayD.getTime();
    const warrSoon = eqAll
      .filter(eq => eq.warranty_until)
      .map(eq => {
        const d = new Date(String(eq.warranty_until).slice(0, 10) + 'T00:00:00');
        return { name: eq.name || 'Equipment', d, days: Math.round((d.getTime() - todayMs) / 86400000) };
      })
      .filter(w => w.d && !isNaN(w.d) && w.days >= 0 && w.days <= 90)
      .sort((a, b) => a.days - b.days);
    if (warrSoon.length) {
      out.push(SH('Warranty due soon'));
      warrSoon.forEach(w => {
        const ds = w.d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
        out.push('· ' + w.name + ' — warranty ends ' + ds + ' (in ' + w.days + 'd)');
      });
      out.push('');
    }
  }

  // Work orders — the live Board backlog for this location, grouped by lane
  // (To Do / In Progress / Done today) so the status reads at a glance. Each
  // card shows its priority, and cards that changed lanes during the day are
  // flagged "moved today." Pulled straight from kanban_cards via the slices.
  const slices = state.ticketSlices || {};
  const here = c => normLocKey(c.location) === locKey;
  const priRank = p => { const m = { urgent: 0, high: 1, normal: 2, low: 3 }; const k = (p || 'normal').toLowerCase(); return (k in m) ? m[k] : 2; };
  const byPri = (a, b) => priRank(a.priority) - priRank(b.priority);
  const woGroups = [
    { label: 'To Do',       cards: (slices.open    || []).filter(here).sort(byPri), showMoved: true },
    { label: 'In Progress', cards: (slices.working || []).filter(here).sort(byPri), showMoved: true },
    { label: 'Done today',  cards: (slices.closed  || []).filter(here).sort(byPri), showMoved: false },
  ].filter(g => g.cards.length);
  if (woGroups.length) {
    out.push(SH('Work orders'));
    woGroups.forEach((g, gi) => {
      // Blank line between lanes so To Do / In Progress / Done today read as
      // distinct blocks instead of one run-on list.
      if (gi > 0) out.push('');
      out.push(g.label + ' (' + g.cards.length + ')');
      g.cards.forEach(c => {
        // Front-load an uppercase priority tag on every card so the priority
        // reads at a glance and the tags line up into a scannable column.
        // Status is the group header; "moved today" is omitted from Done (the
        // "Done today" header already implies it moved today).
        const pri = (c.priority || 'normal').toLowerCase();
        const tag = '[' + pri.toUpperCase() + '] ';
        const moved = (g.showMoved && c._movedToday) ? '  (moved today)' : '';
        out.push('    \u00b7 ' + tag + (c.title || 'Untitled card') + moved);
      });
    });
    out.push('');
  }

  // Repairs & maintenance — from this location's note.
  const rmLines = [];
  RM_CATEGORIES.forEach(cat => { const v = clean(loc.rm && loc.rm[cat.key]); if (v) rmLines.push('\u00b7 ' + cat.label + ': ' + v); });
  if (rmLines.length) { out.push(SH('Repairs & maintenance')); rmLines.forEach(l => out.push(l)); out.push(''); }

  // Vendor / service calls — from this location's note.
  const calls = (loc.vendor_calls || []).filter(c => clean(c.vendor) || clean(c.issue) || clean(c.status) || clean(c.equipment));
  if (calls.length) {
    out.push(SH('Vendor / service calls'));
    calls.forEach(c => {
      const head = [clean(c.vendor), clean(c.equipment)].filter(Boolean).join(' \u2014 ');
      out.push('\u00b7 ' + (head || 'Call') + (clean(c.date) ? ' (' + clean(c.date) + ')' : ''));
      if (clean(c.issue))  out.push('    Issue: ' + clean(c.issue));
      if (clean(c.status)) out.push('    Status: ' + clean(c.status));
    });
    out.push('');
  }

  return out;
}

function buildLocationEmailBody(loc, dateStr, d) {
  const clean = s => String(s == null ? '' : s).trim();
  const SH = l => (window.NX && NX.email) ? NX.email.sectionHeader(l) : ('--- ' + String(l).toUpperCase() + ' ---');
  const RULE = () => (window.NX && NX.email) ? NX.email.rule() : '-----------------------------------';
  const out = [];

  // No title line here \u2014 the subject already says "Daily Log \u2014 <Location> \u2014 <date>"
  // and the greeting restates both, so repeating it up top was redundant.
  dlogEmailGreeting(loc.label || 'Location', dateStr).forEach(l => out.push(l));
  // Weather now lives in the body \u2014 prefer this location's own reading, fall
  // back to the day-level weather. Placed before _bodyStart so a weather-only
  // report still reads as "Quiet day".
  const _hdrWx = (state.weatherByLoc && state.weatherByLoc[normLocKey(loc.label)]) || (d && d.header && d.header.weather) || '';
  if (clean(_hdrWx)) { out.push(SH('Weather')); out.push(clean(_hdrWx)); out.push(''); }
  const _bodyStart = out.length;   // section content begins here (after greeting + weather)

  if (d && clean(d.header && d.header.significant_events)) {
    out.push(SH('Significant events'));
    out.push(clean(d.header.significant_events));
    out.push('');
  }

  const lines = dlogLocationReportLines(loc);
  lines.forEach(l => out.push(l));

  // Empty-day friendliness — a clear note beats a header-and-signature email.
  while (out.length > _bodyStart && out[out.length - 1] === '') out.pop();
  if (out.length === _bodyStart) { out.push('Quiet day — nothing flagged.'); out.push(''); }

  out.push(RULE());
  const me = (window.NX && (NX.user || NX.currentUser)) ? ((NX.user && NX.user.name) || (NX.currentUser && NX.currentUser.name) || '') : '';
  if (me) out.push(me);

  // Quiet brand footnote.
  out.push('');
  out.push('powered by nexus');

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// One button → opens a Gmail compose tab for EACH location at once (each
// pre-filled with that location's recap + its saved recipients). The user just
// hits Send on each tab. Browsers may block multiple pop-ups the first time —
// allow pop-ups for the site once and they'll all open thereafter.
async function emailEachLocation() {
  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  const dateStr = (log && log.log_date) || (d.header && d.header.date) || todayISO();
  // Fire-and-forget: don't block, and critically don't await before the
  // window.open loop below — a delay here would drop us out of the click
  // gesture and trip pop-up blockers. The opener uses the cached line or the
  // static pool.
  try { Promise.resolve(ensureClippyDailyQuote(d, dateStr)).catch(() => {}); } catch (_) {}
  if (!Array.isArray(d.locations) || !d.locations.length) { if (NX.toast) NX.toast('No locations to email', 'info'); return; }
  if (!(window.NX && NX.email && NX.email.gmailComposeUrl)) { if (NX.toast) NX.toast('Email engine not ready — try again', 'error'); return; }
  let opened = 0, empty = 0;
  d.locations.forEach(loc => {
    const body = buildLocationEmailBody(loc, dateStr, d);
    if (!body || body.split('\n').filter(l => l.trim()).length < 2) { empty++; return; }   // skip empty location
    const locKey = normLocKey(loc.label);
    let to = '', cc = [], bcc = [];
    try { const s = JSON.parse(localStorage.getItem('nx_recip_dlog:' + locKey) || 'null'); if (s) { to = s.to || ''; cc = Array.isArray(s.cc) ? s.cc : []; bcc = Array.isArray(s.bcc) ? s.bcc : []; } } catch (_) {}
    const subject = 'Daily Log — ' + (loc.label || 'Location') + ' — ' + fmtLogDateLong(dateStr);
    const url = NX.email.gmailComposeUrl(to, subject, body, cc, bcc);
    if (window.open(url, '_blank', 'noopener')) opened++;
  });
  if (NX.toast) {
    if (opened) NX.toast('Opened ' + opened + ' Gmail draft' + (opened > 1 ? 's' : '') + ' — hit Send on each' + (empty ? ' (' + empty + ' empty skipped)' : ''), 'success', 5000);
    else NX.toast(empty ? 'No location has notes yet' : 'Nothing opened — allow pop-ups for this site, then retry', 'info', 5000);
  }
}

// ── Opener refresh controls (two buttons under the log) ───────────────────
function _openerDateStr() {
  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  return (log && log.log_date) || (d.header && d.header.date) || todayISO();
}
function _paintOpener(text, source) {
  const t = document.getElementById('dlogOpenerText');
  if (t) t.textContent = text + ' — Clippy 👋';   // sign rides at the end of the line
  const s = document.getElementById('dlogOpenerSrc');
  if (s) s.textContent = source === 'llm' ? 'Clippy wrote this' : 'from the pool';
}
// "From the pool": swap in a different hand-written line immediately.
function refreshOpenerPool() {
  const dateStr = _openerDateStr();
  const curEl = document.getElementById('dlogOpenerText');
  // Strip the trailing signature before comparing against pool entries, or
  // the "never the same line twice" exclusion would never match.
  const curText = curEl ? curEl.textContent.replace(/\s*— Clippy 👋\s*$/, '') : null;
  const next = dlogRandomPoolQuote(curText);
  state.clippyQuoteText = next;
  state.clippyQuoteDate = dateStr;
  state.clippyQuoteSource = 'pool';
  _paintOpener(next, 'pool');
}
// "New from Clippy": force a fresh authored line (bypasses the day's memo).
// Uses the app router, then the clippy-brain edge function; if neither answers,
// says so and leaves the current line in place.
async function refreshOpenerLLM(btn) {
  const dateStr = _openerDateStr();
  const d = hydrateData(state.currentLog && state.currentLog.data);
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '… thinking'; }
  state._cqPromise = null; state._cqDate = null; state._cqAttempts = 0;   // bypass memo
  let text = null;
  try {
    text = await Promise.race([
      generateClippyDailyQuote(d, dateStr),
      new Promise(r => setTimeout(() => r(null), 25000)),
    ]);
  } catch (_) {}
  if (btn) { btn.disabled = false; btn.textContent = label; }
  if (text) {
    state.clippyQuoteText = text;
    state.clippyQuoteDate = dateStr;
    state.clippyQuoteSource = 'llm';
    _paintOpener(text, 'llm');
    if (window.NX && NX.toast) NX.toast('Fresh opener from Clippy', 'success', 2500);
  } else if (window.NX && NX.toast) {
    NX.toast(dlogDaySummary(d) ? 'No model reachable right now — try “From the pool”' : 'Add some notes first so Clippy has something to riff on', 'info', 4000);
  }
}

async function openDailyLogEmail() {
  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  const dateStr = (log && log.log_date) || (d.header && d.header.date) || todayISO();
  // Warm today's authored opener for next time, but NEVER block the email on it.
  // A cold/slow LLM call (up to a 7s timeout) must not hold the composer hostage
  // — this was why "Email <location>" took forever. dlogEmailGreeting uses the
  // line if it's already cached, otherwise the static pool. Instant either way.
  try { Promise.resolve(ensureClippyDailyQuote(d, dateStr)).catch(() => {}); } catch (_) {}
  // Split option: a selected location pill sends ONLY that location's notes;
  // Overview sends the full day.
  let subject, body, recipientsKey, title;
  const locKey = state.activeLoc;
  if (locKey && locKey !== 'all') {
    const loc = (d.locations || []).find(l => normLocKey(l.label) === locKey);
    if (!loc) {
      if (window.NX && NX.alert) await NX.alert('That location has no notes yet.', { title: 'Nothing to send' });
      return;
    }
    subject = 'Daily Log \u2014 ' + (loc.label || 'Location') + ' \u2014 ' + fmtLogDateLong(dateStr);
    body = buildLocationEmailBody(loc, dateStr, d);
    recipientsKey = 'dlog:' + locKey;
    title = 'Email \u2014 ' + (loc.label || 'Location');
  } else {
    subject = 'Daily Log \u2014 ' + fmtLogDateLong(dateStr);
    body = buildDailyLogEmailBody(d, dateStr);
    recipientsKey = 'dlog:all';
    title = 'Email daily log';
  }

  if (!body || body.split('\n').filter(l => l.trim()).length < 2) {
    if (window.NX && NX.alert) await NX.alert('This log is empty \u2014 add some notes first.', { title: 'Nothing to send' });
    return;
  }

  // Open the full composer (editable To/CC/BCC + body), exactly like ordering.
  // Each location remembers its own recipients between sends.
  if (window.NX && typeof NX.composeEmail === 'function') {
    NX.composeEmail({ recipientsKey, subject, body, title });
    return;
  }
  // Fallback if the composer module isn't loaded: a plain mail draft.
  const url = (window.NX && NX.email && NX.email.buildMailtoUrl)
    ? NX.email.buildMailtoUrl('', subject, body)
    : 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body).replace(/\+/g, '%20');
  window.location.href = url;
}

// ── STYLED HTML EMAIL ──────────────────────────────────────────────────────
// v3 (Alfredo: "use the original email for all the information and just make
// it beautiful — I don't know why we are making new systems"): the styled
// email is now a pure RENDERING of the original plain-text email. One data
// pipeline — buildDailyLogEmailBody / buildLocationEmailBody stay the single
// source of truth — and dlogTextToHtml() just typesets that text: section
// rules become gold eyebrows, [OVERDUE]/[DOWN] brackets become tinted pills,
// Clippy's opener becomes the soft panel. Any future change to the plain
// email automatically appears here; the two can never disagree.
//
// Sending: the ✨ button opens the ORIGINAL composer (same To/CC/BCC store,
// same Send button) with opts.htmlRender — the composer sends plain+HTML
// via the Gmail API and falls back to the classic draft on any failure.
const DLOG_HTML = {
  cream: '#f4eddc', card: '#fdf9f0', ink: '#2a2318', muted: '#96897a',
  gold: '#c29237', goldSoft: '#d4a44e', line: '#ece1c9',
  redBg: '#f6e3de', redTx: '#a2493c',
  amberBg: '#f5ecd8', amberTx: '#906618',
  greenBg: '#e4efe3', greenTx: '#44704f',
  mutedBg: '#f0e9da',
  // NEXUS's own faces first (Outfit display / DM Sans body / JetBrains Mono
  // eyebrows) — recipients without them installed fall back to their clean
  // system sans, never a serif. `serif` keeps its key name (it's referenced
  // throughout) but is the DISPLAY stack now.
  serif: "'Outfit', 'DM Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Courier New', monospace",
  sans: "'DM Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

function dlogHtmlTag(kind) {
  const C = DLOG_HTML;
  const k = String(kind || '').toUpperCase();
  const map = {
    OVERDUE: [C.redBg, C.redTx], DOWN: [C.redBg, C.redTx], BROKEN: [C.redBg, C.redTx],
    URGENT: [C.redBg, C.redTx], 'NOT OPERATIONAL': [C.redBg, C.redTx],
    DUE: [C.amberBg, C.amberTx], 'NEEDS SERVICE': [C.amberBg, C.amberTx],
    HIGH: [C.amberBg, C.amberTx], PRIORITY: [C.amberBg, C.amberTx],
    DONE: [C.greenBg, C.greenTx], REPAIRED: [C.greenBg, C.greenTx],
  };
  const [bg, tx] = map[k] || [C.mutedBg, C.muted];
  return `<span style="display:inline-block;padding:4px 11px;background:${bg};border-radius:7px;font-family:${DLOG_HTML.sans};font-size:12px;font-weight:bold;letter-spacing:.05em;color:${tx};">${esc(k)}</span>`;
}

// Chip for "At a glance" fragments — tone inferred from the words.
function dlogHtmlChip(text) {
  const C = DLOG_HTML;
  const t = String(text || '').trim();
  let bg = C.mutedBg, tx = C.muted;
  if (/down|urgent/i.test(t)) { bg = C.redBg; tx = C.redTx; }
  else if (/overdue/i.test(t)) { bg = C.amberBg; tx = C.amberTx; }
  return `<span style="display:inline-block;padding:6px 14px;margin:0 6px 8px 0;background:${bg};border-radius:999px;font-family:${C.sans};font-size:13px;font-weight:bold;letter-spacing:.04em;color:${tx};">${esc(t)}</span>`;
}

// ── The typesetter ─────────────────────────────────────────────────────────
// Parses the exact line grammar the plain-text builders emit:
//   "─── LABEL ─────── suffix"   section header (NX.email.sectionHeader)
//   "──────────────"             closing rule → everything after = signature
//   "At a glance: a · b · c"     chips
//   "· bullet — detail"          primary row (bold head, muted tail)
//   "    [TAG] name — detail"    tinted pill + row ("confirmed schedule" → green)
//   "    key: value"             muted sub-line (why:/call: italic)
//   "Key: value"                 bold-key paragraph (Tomorrow:, FOH:, …)
//   "<quote> — Clippy 👋"        the opener panel
function dlogTextToHtml(text, meta) {
  const C = DLOG_HTML;
  meta = meta || {};
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const SEC_RE = /^─── (.+?) ─+(.*)$/;
  const RULE_RE = /^─{6,}$/;

  // Split into: preamble (greeting), sections, signature.
  const pre = [];
  const sections = [];
  const sig = [];
  let cur = null, inSig = false;
  for (const raw of lines) {
    const line = raw;
    if (inSig) { sig.push(line); continue; }
    const sm = line.match(SEC_RE);
    if (sm) { cur = { label: sm[1].trim(), suffix: (sm[2] || '').trim(), lines: [] }; sections.push(cur); continue; }
    if (RULE_RE.test(line.trim())) { inSig = true; continue; }
    if (cur) cur.lines.push(line); else pre.push(line);
  }

  // Weather rides in the masthead, not as a body section.
  let weatherLine = '';
  const weatherIdx = sections.findIndex(s => /^weather$/i.test(s.label));
  if (weatherIdx !== -1) {
    weatherLine = sections[weatherIdx].lines.map(l => l.trim()).filter(Boolean).join(' ');
    sections.splice(weatherIdx, 1);
  }

  // Clippy's opener from the preamble; any other preamble text stays as prose.
  let clippyQuote = '';
  const preProse = [];
  pre.forEach(l => {
    const t = l.trim();
    if (!t) return;
    if (/— Clippy/.test(t)) clippyQuote = t.replace(/\s*— Clippy.*$/, '').trim();
    else preProse.push(t);
  });

  const sub = (s) => `<div style="font-family:${C.sans};font-size:14px;line-height:1.6;color:${C.muted};margin:3px 0 3px 2px;">${esc(s)}</div>`;
  const prose = (s) => {
    const kv = s.match(/^([A-Za-z][A-Za-z /&'()-]{1,28}):\s+(.*)$/);
    if (kv) return `<div style="font-family:${C.sans};font-size:15.5px;line-height:1.7;color:${C.ink};margin:0 0 8px;"><strong style="font-family:${C.serif};font-size:16px;">${esc(kv[1])}:</strong> ${esc(kv[2])}</div>`;
    return `<div style="font-family:${C.serif};font-size:16.5px;line-height:1.7;color:${C.ink};margin:0 0 8px;">${esc(s)}</div>`;
  };

  function renderLine(raw) {
    if (!raw.trim()) return '<div style="height:6px;"></div>';
    const indented = /^ {3,}/.test(raw);
    const s = raw.trim();

    const atG = s.match(/^At a glance:\s*(.+)$/i);
    if (atG) return `<div style="margin:2px 0 6px;">${atG[1].split(' · ').map(dlogHtmlChip).join('')}</div>`;

    // "[TAG] name — detail — detail" (both bulleted and indented forms).
    // Names can themselves contain " — " ("Hood — Main Line"), so the
    // head/detail split happens at the first segment that READS like a
    // detail (was due…, a date, in Nd…), not blindly at the first dash.
    const tag = s.replace(/^· /, '').match(/^\[([A-Z][A-Z /_-]*)\]\s*(.*)$/);
    if (tag) {
      const segs = tag[2].split(' — ');
      let cut = segs.length;
      for (let i = 1; i < segs.length; i++) {
        if (/^(was due|due |in \d|call |confirmed|\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(segs[i])) { cut = i; break; }
      }
      if (cut === segs.length && segs.length > 1) cut = 1;   // fallback: first dash
      const head = segs.slice(0, cut).join(' — ');
      const tail = segs.slice(cut).join(' — ');
      const good = /confirmed schedule/i.test(tail);
      return `
        <div style="padding:10px 0;border-bottom:1px solid ${C.line};">
          <div>${dlogHtmlTag(tag[1])}<span style="font-family:${C.serif};font-size:17px;font-weight:bold;color:${C.ink};margin-left:8px;">${esc(head)}</span></div>
          ${tail ? `<div style="font-family:${C.sans};font-size:14.5px;line-height:1.6;color:${good ? C.greenTx : C.muted};margin-top:5px;${good ? 'font-weight:bold;' : ''}">${esc(tail)}</div>` : ''}
        </div>`;
    }

    if (/^· /.test(s)) {
      const rest = s.slice(2);
      const i = rest.indexOf(' — ');
      const head = i === -1 ? rest : rest.slice(0, i);
      const tail = i === -1 ? '' : rest.slice(i + 3);
      return `
        <div style="padding:9px 0;border-bottom:1px solid ${C.line};">
          <span style="font-family:${C.serif};font-size:16.5px;font-weight:bold;color:${C.ink};">${esc(head)}</span>
          ${tail ? `<div style="font-family:${C.sans};font-size:14.5px;line-height:1.6;color:${C.muted};margin-top:4px;">${esc(tail)}</div>` : ''}
        </div>`;
    }

    if (indented) {
      const kv = s.match(/^(why|call):\s*(.*)$/i);
      if (kv) return `<div style="font-family:${C.sans};font-size:14px;line-height:1.6;color:${C.muted};font-style:italic;margin:2px 0 6px 2px;">${esc(kv[1] === 'why' ? kv[2] : 'Call: ' + kv[2])}</div>`;
      return sub(s);
    }

    return prose(s);
  }

  const sectionHtml = sections.map(sec => {
    const inner = sec.lines.map(renderLine).join('');
    if (!inner.replace(/<div style="height:6px;"><\/div>/g, '').trim()) return '';
    return `
      <tr><td style="padding:24px 24px 0;">
        <div style="border-top:1px solid ${C.line};padding-top:18px;">
          <div style="font-family:${C.mono};font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:${C.gold};margin-bottom:10px;">${esc(sec.label)}${sec.suffix ? ` <span style="color:${C.muted};letter-spacing:.05em;">· ${esc(sec.suffix)}</span>` : ''}</div>
          ${inner}
        </div>
      </td></tr>`;
  }).join('');

  const clippyBlock = clippyQuote ? `
    <tr><td style="padding:22px 24px 0;">
      <div style="background:${C.mutedBg};border-radius:16px;padding:18px 20px;">
        <div style="font-family:${C.serif};font-size:16.5px;line-height:1.65;color:${C.ink};font-style:italic;">${esc(clippyQuote)}</div>
        <div style="font-family:${C.sans};font-size:14px;color:${C.muted};margin-top:8px;">— Clippy 👋</div>
      </div>
    </td></tr>` : '';

  const preBlock = preProse.length ? `
    <tr><td style="padding:20px 24px 0;">${preProse.map(prose).join('')}</td></tr>` : '';

  // Signature: keep the sender's name; our own footer supplies the brand line.
  const sigName = sig.map(l => l.trim()).filter(l => l && !/^powered by nexus$/i.test(l)).join('<br>');

  const dateLine = meta.dateStr ? fmtLogDateLong(meta.dateStr) : '';
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};padding:0;margin:0;">
<tr><td align="center" style="padding:20px 10px;">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:${C.card};border:1px solid ${C.line};border-radius:22px;">
    <tr><td style="padding:30px 24px 0;">
      <div style="font-family:${C.serif};font-size:34px;font-weight:800;color:${C.ink};letter-spacing:-.02em;">Daily Log${meta.locLabel ? ` <span style="color:${C.gold};">· ${esc(meta.locLabel)}</span>` : ''}</div>
      <div style="font-family:${C.mono};font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${C.muted};margin-top:8px;line-height:1.6;">${esc(dateLine)}${weatherLine ? '<br>' + esc(weatherLine) : ''}</div>
      <div style="border-top:3px solid ${C.goldSoft};border-radius:3px;margin-top:20px;width:64px;"></div>
    </td></tr>
    ${clippyBlock}
    ${preBlock}
    ${sectionHtml}
    <tr><td style="padding:28px 24px 28px;">
      <div style="border-top:1px solid ${C.line};padding-top:16px;font-family:${C.sans};font-size:14px;line-height:1.7;color:${C.muted};">
        ${sigName ? sigName + '<br>' : ''}<span style="font-family:${C.mono};font-size:11px;letter-spacing:.2em;">POWERED BY NEXUS</span>
      </div>
    </td></tr>
  </table>
</td></tr>
</table>`;
}

// ✨ Styled email — the ORIGINAL email flow end to end: same body builders,
// same composer sheet, same remembered To/CC/BCC, same Send button. The only
// difference is opts.htmlRender: the composer sends the typed text plus its
// styled render via the Gmail API (classic plain draft on any failure).
async function openDailyLogStyledEmail() {
  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  const dateStr = (log && log.log_date) || (d.header && d.header.date) || todayISO();
  try { Promise.resolve(ensureClippyDailyQuote(d, dateStr)).catch(() => {}); } catch (_) {}

  let subject, body, recipientsKey, title, locLabel = '';
  const locKey = state.activeLoc;
  if (locKey && locKey !== 'all') {
    const loc = (d.locations || []).find(l => normLocKey(l.label) === locKey);
    if (!loc) {
      if (window.NX && NX.alert) await NX.alert('That location has no notes yet.', { title: 'Nothing to send' });
      return;
    }
    locLabel = loc.label || 'Location';
    subject = 'Daily Log — ' + locLabel + ' — ' + fmtLogDateLong(dateStr);
    body = buildLocationEmailBody(loc, dateStr, d);
    recipientsKey = 'dlog:' + locKey;
    title = '✨ Styled — ' + locLabel;
  } else {
    subject = 'Daily Log — ' + fmtLogDateLong(dateStr);
    body = buildDailyLogEmailBody(d, dateStr);
    recipientsKey = 'dlog:all';
    title = '✨ Styled daily log';
  }

  if (!body || body.split('\n').filter(l => l.trim()).length < 2) {
    if (window.NX && NX.alert) await NX.alert('This log is empty — add some notes first.', { title: 'Nothing to send' });
    return;
  }

  if (window.NX && typeof NX.composeEmail === 'function') {
    NX.composeEmail({
      recipientsKey, subject, body, title,
      htmlRender: (bodyText) => dlogTextToHtml(bodyText, { dateStr, locLabel }),
    });
    return;
  }
  // Composer missing (stale cache): fall back to the plain email path.
  openDailyLogEmail();
}

// ── Weather auto-populate (address-based, per location) ───────────────────
// Each location carries a street address (the `locations` table). We geocode
// it once — Photon, a free CORS-enabled OSM geocoder, cached in localStorage —
// then pull the day's weather from Open-Meteo for those coordinates. The header
// field shows the active location's weather; each location's email section
// carries its own. Falls back to the venues' default city if an address is
// missing or won't geocode, so weather always resolves. Never overwrites a
// manual entry.
const DEFAULT_COORDS = { lat: 30.2672, lon: -97.7431 };   // Austin, TX - last-resort fallback

// fetch() with a hard timeout so a slow/unreachable provider can NEVER hang the
// weather flow (the previous Photon geocoder had no timeout and would stall,
// which is why weather "didn't work"). On timeout it aborts -> caught -> null.
async function _wfetch(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 7000);
  try { return await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } }); }
  finally { clearTimeout(t); }
}

// localStorage cache: place-key -> {lat,lon} for the Open-Meteo fallback only.
const GEO_CACHE_KEY = 'nexus_geo_cache_v2';
function _geoGet(k) { try { return (JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'))[k] || null; } catch (_) { return null; } }
function _geoSet(k, c) { try { const m = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); m[k] = c; localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(m)); } catch (_) {} }

// A weather query from a street address: prefer the 5-digit ZIP (cleanest -
// both providers resolve it directly), else "City, ST", else the default city.
function placeKeyFromAddress(addr) {
  const a = String(addr || '').trim();
  if (!a || a.toUpperCase() === 'NA') return 'Austin, TX';
  const zips = a.match(/\b\d{5}\b/g);          // ZIP = the LAST 5-digit group
  if (zips) return zips[zips.length - 1];       // (street number comes first)
  const m = a.match(/([A-Za-z .'-]{2,}),\s*([A-Z]{2})\b/);   // "City, ST"
  if (m) return m[1].trim() + ', ' + m[2];
  return a;
}

// Each location's street address from the `locations` table -> state.locAddr
// keyed by normalized label. Best-effort.
async function loadLocationAddresses() {
  state.locAddr = state.locAddr || {};
  try {
    const { data } = await NX.sb.from('locations').select('label,address').eq('archived', false);
    (data || []).forEach(r => { if (r && r.label) state.locAddr[normLocKey(r.label)] = (r.address || '').trim(); });
  } catch (_) {}
  return state.locAddr;
}

// SEEDED COORDINATES — the venues' exact locations, from the addresses in
// the `locations` table (geocoded once, by hand, 2026-07-07). Weather for a
// known venue NEVER depends on a live geocoder. Keyed by normLocKey, with a
// ZIP fallback map for future venues in the same areas.
//   Suerte        1800 E 6th St, 78702
//   Este + Toti   2113 Manor Rd, 78722   (Toti is in Este's building)
//   Karaz         2627 Manor Rd, 78722
//   Stripe It Up  11824 Tesla Rd, 78725
const VENUE_COORDS = {
  suerte:     { lat: 30.2617, lon: -97.7196 },
  este:       { lat: 30.2866, lon: -97.7207 },
  toti:       { lat: 30.2866, lon: -97.7207 },
  karaz:      { lat: 30.2889, lon: -97.7135 },
  stripeitup: { lat: 30.2270, lon: -97.6060 },
};
const ZIP_COORDS = {
  '78702': { lat: 30.2632, lon: -97.7147 },
  '78722': { lat: 30.2900, lon: -97.7150 },
  '78725': { lat: 30.2360, lon: -97.6080 },
};

// Geocoder for UNKNOWN venues only (Open-Meteo's geocoding API, cached in
// localStorage). Known venues resolve from VENUE_COORDS/ZIP_COORDS above.
async function geocodePlace(place) {
  const cached = _geoGet(place);
  if (cached && isFinite(cached.lat) && isFinite(cached.lon)) return cached;
  try {
    const r = await _wfetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(place), 7000);
    if (r.ok) {
      const j = await r.json();
      const g = j && j.results && j.results[0];
      if (g && isFinite(g.latitude) && isFinite(g.longitude)) {
        const c = { lat: g.latitude, lon: g.longitude };
        _geoSet(place, c); return c;
      }
    }
  } catch (_) {}
  return null;
}

// THE provider: Open-Meteo forecast at exact coordinates. One call returns
// current conditions + the day's forecast in the venue's own timezone.
// Composed for a manager's eye — what it's like NOW, the day's range, and
// when rain starts — not a daily average:
//   "Partly cloudy · 96°F now (feels 104) · H 101 / L 77 · rain 45% from 5pm"
async function fetchDayWeather(lat, lon) {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat + '&longitude=' + lon
      + '&current=temperature_2m,apparent_temperature,weather_code'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max'
      + '&hourly=precipitation_probability'
      + '&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&forecast_days=1';
    const res = await _wfetch(url, 7000);
    if (!res.ok) return null;
    const j = await res.json();
    const dy = j && j.daily;
    if (!dy || !dy.temperature_2m_max || dy.temperature_2m_max[0] == null) return null;
    const hi = Math.round(dy.temperature_2m_max[0]);
    const lo = Math.round(dy.temperature_2m_min[0]);
    const cur = j.current || {};
    const nowT = cur.temperature_2m != null ? Math.round(cur.temperature_2m) : null;
    const feels = cur.apparent_temperature != null ? Math.round(cur.apparent_temperature) : null;
    const code = (cur.weather_code != null) ? cur.weather_code : (dy.weather_code ? dy.weather_code[0] : null);

    const bits = [];
    if (code != null) bits.push(wmoText(code));
    if (nowT != null) {
      // Only call out feels-like when it meaningfully differs (Texas humidity).
      bits.push(nowT + '\u00b0F now' + (feels != null && Math.abs(feels - nowT) >= 4 ? ' (feels ' + feels + ')' : ''));
    }
    bits.push('H ' + hi + ' / L ' + lo);

    // Rain: probability + WHEN it starts. Scan the remaining hours of today
    // for the first hour with >= 40% chance.
    const prob = (dy.precipitation_probability_max && dy.precipitation_probability_max[0]) || 0;
    if (prob >= 30) {
      let from = '';
      try {
        const hh = j.hourly || {};
        const times = hh.time || [], probs = hh.precipitation_probability || [];
        const nowHour = new Date().getHours();
        for (let i = 0; i < times.length; i++) {
          const h = parseInt(String(times[i]).slice(11, 13), 10);
          if (h >= nowHour && (probs[i] || 0) >= 40) {
            from = ' from ' + (h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm');
            break;
          }
        }
      } catch (_) {}
      bits.push('rain ' + prob + '%' + from);
    }
    return bits.join(' \u00b7 ');
  } catch (_) { return null; }
}

// Resolve a location's weather. Order: exact venue coordinates (seeded) ->
// ZIP coordinates (seeded) -> live geocode of the address's place key ->
// Austin default. wttr.in is GONE: it was the primary and it is why weather
// was "way off" — overloaded, stale cache, and it routinely resolved bare
// US ZIPs to the wrong place entirely. Open-Meteo at exact coordinates is
// the only forecast source now.
async function weatherForLocationKey(key) {
  let coords = VENUE_COORDS[key] || null;
  if (!coords) {
    const addr = (state.locAddr && state.locAddr[key]) || '';
    const place = placeKeyFromAddress(addr);
    if (/^\d{5}$/.test(place) && ZIP_COORDS[place]) coords = ZIP_COORDS[place];
    else coords = (await geocodePlace(place)) || DEFAULT_COORDS;
  }
  return fetchDayWeather(coords.lat, coords.lon);
}

function wmoText(code) {
  const m = {
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy rain showers',
    85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorms', 96: 'Thunderstorms with hail', 99: 'Thunderstorms with hail',
  };
  return m[code] || 'Mixed conditions';
}

// Manual "↻" — clears the field + today's cache and re-fetches on demand.
async function forceWeather() {
  const log = ensureCurrentLog();
  if ((log.log_date || todayISO()) !== todayISO()) { if (NX.toast) NX.toast('Weather only fetches for today', 'info'); return; }
  if (!log.data) log.data = hydrateData(null);
  if (!log.data.header) log.data.header = {};
  log.data.header.weather = '';
  const input = document.querySelector('[data-path="header.weather"]');
  if (input) input.value = '';
  state.weatherByLoc = {};   // drop today's cached per-location weather
  state._weatherDate = null;
  state.locAddr = null;      // re-read addresses too (in case one changed)
  if (NX.toast) NX.toast('Fetching weather…', 'info', 1200);
  await maybeAutoWeather();
  const got = String((log.data.header && log.data.header.weather) || '').trim();
  if (NX.toast) NX.toast(got ? 'Weather updated' : 'Could not reach the weather service', got ? 'success' : 'error');
}

async function maybeAutoWeather() {
  try {
    const log = state.currentLog;
    if (!log) return;
    const dateStr = log.log_date || todayISO();
    if (dateStr !== todayISO()) return;                       // today's log only
    if (!log.data) log.data = hydrateData(null);
    if (!log.data.header) log.data.header = {};
    // We no longer bail when the header already holds a manual entry — we still
    // fetch each location's weather below (for the per-location email sections)
    // and simply skip overwriting the header field itself.
    if (state._weatherFetching) return;
    state._weatherFetching = true;

    // Reset the per-location weather cache at the start of each new day.
    const today = todayISO();
    if (state._weatherDate !== today) { state.weatherByLoc = {}; state._weatherDate = today; }
    state.weatherByLoc = state.weatherByLoc || {};

    if (!state.locAddr) await loadLocationAddresses();

    // Fetch each active location's weather from its OWN address (cached/day).
    // state.weatherByLoc feeds the per-location email sections.
    const locs = (log.data.locations || []).filter(l => l && l.label);
    for (const loc of locs) {
      const key = normLocKey(loc.label);
      if (state.weatherByLoc[key]) continue;
      try {
        const str = await weatherForLocationKey(key);
        if (str) state.weatherByLoc[key] = str;
      } catch (_) { /* one location's network hiccup must not block the rest */ }
    }
    // Reflect each location's weather into its on-screen section (best-effort —
    // render() ran before this async fetch, so we fill the placeholders now).
    locs.forEach(loc => {
      const k = normLocKey(loc.label);
      const sp = document.querySelector('[data-loc-weather="' + k + '"]');
      if (sp && state.weatherByLoc[k]) sp.textContent = state.weatherByLoc[k];
    });
    // Always have something to show even before a location is added.
    if (!state.weatherByLoc.__default) {
      const str = await fetchDayWeather(DEFAULT_COORDS.lat, DEFAULT_COORDS.lon);
      if (str) state.weatherByLoc.__default = str;
    }

    // Header field = the active location's weather (or the first location's, or
    // the default). Only when blank \u2014 never clobber a manual entry. The empty-
    // field check IS the dedupe, so it re-fills any day the field is blank.
    if (!String(log.data.header.weather || '').trim()) {
      let key = (state.activeLoc && state.activeLoc !== 'all') ? state.activeLoc : null;
      if (!key || !state.weatherByLoc[key]) key = locs[0] ? normLocKey(locs[0].label) : null;
      const w = (key && state.weatherByLoc[key]) || state.weatherByLoc.__default || '';
      if (w) {
        log.data.header.weather = w;
        const input = document.querySelector('[data-path="header.weather"]');
        if (input && !input.value.trim()) input.value = w;
        markDirty();   // quiet autosave so it persists with the rest of the log
      }
    }
  } catch (e) { if (window.NX && NX.debug) NX.debug('dlog.weather', e); /* offline/API hiccup — field stays editable, retries next open */ }
  finally { state._weatherFetching = false; }
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
  // Autosave after a short typing-pause. Quiet — no toast unless it fails.
  state.saveTimer = setTimeout(() => commitSave({ submit: false, quiet: true }), 1200);
}

// ─── No-data-loss: flush pending saves when the tab is hidden / closed, and
//     (if auto-send is on) auto-upload the day's log to Drive on leave. Wired
//     once in init(). dlogAutoSendOn() reads the per-device toggle. ───────────
function dlogAutoSendOn() { try { return localStorage.getItem('nexus_dlog_autosend') === '1'; } catch (_) { return false; } }
function dlogAutoSendTime() { try { return localStorage.getItem('nexus_dlog_autosend_time') || '22:00'; } catch (_) { return '22:00'; } }
// Master control: which days-of-week auto-send is allowed (1=Sun … 7=Sat).
// e.g. weekdays-only. Default = every day. A card made on a non-send day stays
// in the open backlog and rolls into the next allowed day's log/email.
function dlogAutoSendDays() {
  try { const v = JSON.parse(localStorage.getItem('nexus_dlog_autosend_days') || 'null'); return (Array.isArray(v) && v.length) ? v : [1, 2, 3, 4, 5, 6, 7]; }
  catch (_) { return [1, 2, 3, 4, 5, 6, 7]; }
}
function dlogDayAllowed(dow) { return dlogAutoSendDays().indexOf(dow) !== -1; }
function dlogHasContent(d) {
  if (!d) return false;
  return !!((d.header && (d.header.weather || d.header.significant_events)) ||
    (d.planning && (d.planning.tomorrow_plan || d.planning.this_week || d.planning.side_notes)) ||
    (Array.isArray(d.locations) && d.locations.length) ||
    (d.cleaning && Object.values(d.cleaning).some(v => String(v || '').trim())));
}
let _dlogLifecycleWired = false;
function wireDlogLifecycle() {
  if (_dlogLifecycleWired) return;
  _dlogLifecycleWired = true;
  // Time-based safety net: if auto-send is on and today's log still isn't
  // uploaded by the cutoff time, send it automatically. Runs every 3 min while
  // the app is open. (A fully-closed app can't fire this — a true unattended
  // send would need a server cron; this covers the always-open ops tablet.)
  setInterval(() => {
    try {
      if (!dlogAutoSendOn()) return;
      if (!dlogDayAllowed(new Date().getDay() + 1)) return;        // master day-control
      const log = state.currentLog;
      if (!log || !log.data) return;
      if ((log.log_date || todayISO()) !== todayISO()) return;     // today only
      if (log.drive_upload_status === 'uploaded') return;          // already sent (never re-sends)
      const now = new Date();
      const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      if (hhmm < dlogAutoSendTime()) return;                        // not yet cutoff
      if (!dlogHasContent(log.data)) return;
      commitSave({ submit: true, quiet: true });
    } catch (_) {}
  }, 180000);
  const flush = () => {
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    // Leaving the tab is NOT a "send." Previously, with auto-send on, every
    // tab-hide fired a full Drive upload — so app-switching on a phone
    // re-uploaded (and effectively re-sent) the day's log many times. Now the
    // leave-flush only persists the draft to the DB so nothing is lost; the
    // actual Drive upload is owned solely by the cutoff-time safety net above
    // and the explicit Upload button.
    if (state.dirty) commitSave({ submit: false, quiet: true });
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
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
    // ── Phase 2 + 3b + 3e: Drive upload with frozen snapshots ──
    // After Supabase save succeeded, refresh the live equipment activity
    // AND ticket slices one more time (catches any events that fired in
    // the seconds between last render and submit), freeze both into
    // data.equipment_activity / data.tickets, then push to Drive. The
    // frozen snapshots are what the Drive doc captures — auditable trace
    // of "what NEXUS saw at upload time". Subsequent live re-renders
    // of the form still query fresh.
    try {
      const [freshActivity, freshSlices, freshEqDown] = await Promise.all([
        loadEquipmentActivity(log.data.header.date),
        loadTicketSlices(log.data.header.date),
        loadEquipmentDown(),
        loadOrdering(),
      ]);
      state.equipmentActivity = freshActivity;
      state.ticketSlices = freshSlices;
      await loadCardEquipmentNames(freshSlices);
      state.equipmentDown = freshEqDown;
      log.data.equipment_activity = freshActivity;
      log.data.tickets = freshSlices;
      // v18.32 — Snapshot the "equipment status today" list with the
      // CURRENT status_note from each item. The Drive doc preserves the
      // narrative as-of-upload-time, even if status_note changes later.
      log.data.equipment_status = freshEqDown.map(eq => ({
        id: eq.id,
        name: eq.name,
        location: eq.location,
        status: eq.status,
        status_note: eq.status_note || '',
      }));
      // Persist both snapshots alongside the user's notes
      await NX.sb.from('facility_logs').update({ data: log.data }).eq('id', state.currentLog.id);
      state.currentLog.data = log.data;
      // v18.32 Vendor V1 — bump last_contact_at for any vendors named in
      // this log's vendor_calls. Best effort; failures don't block save.
      bumpVendorLastContact(log.data).catch(e =>
        console.warn('[daily-log] vendor bump failed (non-fatal):', e));
    } catch (e) {
      console.warn('[daily-log] snapshot freeze failed (non-fatal):', e);
    }
    render();   // show updated counts immediately
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
    // v18.32 Phase 3a — pass the previously-stored Drive file ID so
    // nx-drive uses files.update (PATCH) instead of files.create. Same
    // Drive doc gets refreshed in place; URL and ID stay stable so any
    // bookmarks or links to "today's log" don't break on re-upload.
    const result = await NX.drive.uploadDailyLog(logRow.data, {
      existingFileId: logRow.drive_file_id || null,
    });
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
  state.activeLoc = 'all';   // start a freshly-opened day on the Overview
  // Load the log + the day's equipment activity in parallel. The activity
  // feed is live (re-queried every time) — the snapshot only gets frozen
  // into data.equipment_activity at upload time.
  const [existing, activity, slices, vendors, vendorIssues, eqDown, pms] = await Promise.all([
    loadLog(iso),
    loadEquipmentActivity(iso),
    loadTicketSlices(iso),
    loadVendors(),
    loadVendorOpenIssueCounts(),
    loadEquipmentDown(),
    loadPmsForDate(iso),
    loadOrdering(),
  ]);
  state.pmsToday = pms;
  state.equipmentActivity = activity;
  state.ticketSlices = slices;
  await loadCardEquipmentNames(slices);
  state.vendors = vendors;
  state.vendorOpenIssues = vendorIssues;
  state.equipmentDown = eqDown;
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
  // Pre-warm Clippy's authored opener for this day so it's ready by the time
  // the user composes an email (fire-and-forget; falls back to the pool).
  try { ensureClippyDailyQuote(hydrateData(state.currentLog && state.currentLog.data), iso); } catch (_) {}
}

// ─── Module lifecycle ────────────────────────────────────────────────
async function init() {
  // Load recent + today's log + equipment-location cache + today's
  // equipment activity + today's ticket slices in parallel. Pre-warming
  // everything so the first render shows the full state instantly.
  // NOTE — Pre-3e versions of init() had a destructuring bug here that
  // dropped the equipment activity result and assigned the locations
  // array to it. Fixed by destructuring all four loads explicitly with
  // an underscore placeholder for the locations side-channel (which
  // already sets state.equipmentLocations internally — we don't need
  // the return value).
  wireDlogLifecycle();   // flush-on-leave autosave + auto-send (idempotent)
  const today = todayISO();
  const [rs, todayRow, _locations, activity, slices, vendors, vendorIssues, eqDown, pms] = await Promise.all([
    loadRecentLogs(),
    loadLog(today),
    loadEquipmentLocations().catch(() => []),
    loadEquipmentActivity(today),
    loadTicketSlices(today),
    loadVendors(),
    loadVendorOpenIssueCounts(),
    loadEquipmentDown(),
    loadPmsForDate(today),
    loadOrdering(),
  ]);
  state.recentLogs = rs;
  state.pmsToday = pms || [];
  state.equipmentActivity = activity || [];
  state.ticketSlices = slices;
  await loadCardEquipmentNames(slices);
  state.vendors = vendors || [];
  state.vendorOpenIssues = vendorIssues || {};
  state.equipmentDown = eqDown || [];
  if (todayRow) {
    state.currentLog = todayRow;
  } else {
    state.currentLog = {
      log_date: today,
      data: hydrateData(null),
      submitted_at: null,
    };
    state.currentLog.data.header.date = today;
  }
  render();
  maybeAutoWeather();
  try { ensureClippyDailyQuote(hydrateData(state.currentLog && state.currentLog.data), today); } catch (_) {}
}

async function show() {
  // Re-sync recent + current + activity + tickets on every view activation
  // in case data changed from another device/session
  const date = (state.currentLog && state.currentLog.log_date) || todayISO();
  const [rs, current, activity, slices, vendors, vendorIssues, eqDown, pms] = await Promise.all([
    loadRecentLogs(),
    loadLog(date),
    loadEquipmentActivity(date),
    loadTicketSlices(date),
    loadVendors(),
    loadVendorOpenIssueCounts(),
    loadEquipmentDown(),
    loadPmsForDate(date),
    loadOrdering(),
  ]);
  state.recentLogs = rs;
  state.pmsToday = pms || [];
  state.equipmentActivity = activity || [];
  state.ticketSlices = slices;
  await loadCardEquipmentNames(slices);
  state.vendors = vendors || [];
  state.vendorOpenIssues = vendorIssues || {};
  state.equipmentDown = eqDown || [];
  if (current) {
    state.currentLog = current;
  } else if (!state.currentLog) {
    state.currentLog = {
      log_date: date,
      data: hydrateData(null),
      submitted_at: null,
    };
    state.currentLog.data.header.date = date;
  }
  render();
  maybeAutoWeather();
  try { ensureClippyDailyQuote(hydrateData(state.currentLog && state.currentLog.data), date); } catch (_) {}
}

if (!NX.modules) NX.modules = {};
NX.modules.dailylog = { init, show };

console.log('[daily-log] v18.32 Phase 3a loaded — dynamic locations + always-editable + Drive update-in-place');

})();
