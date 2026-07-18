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
  // v266 — Bar Toti was missing from the defaults: a fresh day had no Toti
  // tab, so its cards/notes had no home until someone added it by hand.
  { id: 'toti',   label: 'Bar Toti' },
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
  pmOverdueSchedules: [], // v284 — past-due, still-open pm_schedules rows
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
  // Prefer the shared Chicago-pinned util (core.js NX.date) so a device set to
  // another timezone doesn't roll the log day. Fall back to device-local date.
  try {
    if (window.NX && NX.date && typeof NX.date.today === 'function') return NX.date.today();
  } catch (_) {}
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

  // v288 — Alfredo: a ticket whose due date is far out (the sanding job due
  // in a few months) shouldn't sit in the active To-Do list every day, but
  // must still be NOTED. Split open cards with a due date 30+ days out into
  // their own "upcoming" bucket — surfaced under a light "Upcoming" line,
  // out of the active list. Undated and near-term open cards stay active.
  const farISO = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 30); return dlogLocalISO(t); })();
  const upcoming = [];
  const openActive = [];
  open.forEach(c => {
    const due = c.due_date ? String(c.due_date).slice(0, 10) : '';
    if (due && due >= farISO) upcoming.push(c); else openActive.push(c);
  });

  // Open: oldest first (aging surfaces). Working: newest activity first.
  openActive.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  upcoming.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));   // soonest upcoming first
  // Working: newest activity first
  working.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  // Closed: most-recently-closed first
  closed.sort((a, b) => new Date(b.closed_at || b.updated_at || 0) - new Date(a.closed_at || a.updated_at || 0));

  return { open: openActive, working, closed, upcoming };
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
    // v292 — exclude SOFT-DELETED units. Equipment has no boolean `archived`
    // column (soft-delete is archived_at / is_deleted / deleted_at), so the
    // old `archived !== true` check filtered NOTHING — every deleted or
    // retired unit leaked into the daily-notes maintenance section (Alfredo:
    // "why am I seeing 2 Kold Draft Ice machines — I deleted 1"). Mirror the
    // equipment list: hide archived_at / is_deleted / deleted_at rows.
    const all = (data || []).filter(eq =>
      eq && !eq.archived_at && !eq.is_deleted && !eq.deleted_at && eq.archived !== true);
    state.equipmentHealth = all;       // full fleet → health/warranty stats
    const rows = all.filter(eq => NON_OPERATIONAL_STATUSES.indexOf((eq.status || '').toLowerCase()) !== -1);
    rows.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    // Open work-order / call status for the down units (was a call placed?).
    // Maps equipment_id → most-recent open issue. Best-effort; never blocks.
    state.openIssuesByEq = {};
    try {
      if (all.length && NX.sb) {
        // WHOLE fleet, not just down units — a low-severity call doesn't
        // flip status but still belongs in Vendor & Service Calls.
        const { data: iss } = await NX.sb.from('equipment_issues')
          .select('id, equipment_id, title, description, status, contractor_name, contractor_called_at, eta_at, reported_at, created_at, priority')
          .not('status', 'in', '(repaired,closed,cancelled,invoice_paid)')
          .order('created_at', { ascending: false });
        (iss || []).forEach(r => { if (r.equipment_id && !state.openIssuesByEq[r.equipment_id]) state.openIssuesByEq[r.equipment_id] = r; });
      }
    } catch (e) { console.warn('[daily-log] open issues:', e); }
    // Upcoming confirmed PM visits — maps equipment_id → the EARLIEST
    // non-cancelled pm_schedules row dated today or later. Lets the daily
    // notes say "10d overdue — confirmed schedule on 7/22" instead of
    // leaving an overdue item looking unhandled. Whole fleet, not just
    // down units, because PM-overdue lines cover operational equipment
    // too. Best-effort: on any error the notes just omit the suffix.
    state.pmScheduleByEq = {};
    state.pmOverdueSchedules = [];
    try {
      const { data: scheds } = await NX.sb.from('pm_schedules').select('*');
      const tIso = todayISO();
      const open = (scheds || []).filter(s => {
        const st = String(s.status || '').toLowerCase();
        return st !== 'cancelled' && st !== 'completed' && !s.completed_at && s.scheduled_date;
      });
      // Upcoming (today or later) → the "confirmed schedule on 7/22" suffix.
      open
        .filter(s => String(s.scheduled_date).slice(0, 10) >= tIso)
        .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
        .forEach(s => {
          if (s.equipment_id && !state.pmScheduleByEq[s.equipment_id]) {
            state.pmScheduleByEq[s.equipment_id] = s;
          }
        });
      // v284 — OVERDUE (dated before today, still not completed). Alfredo:
      // "a service scheduled for the 16… should be noted on daily log if
      // something is placed here and overdue." These surface as their own
      // overdue Maintenance-due rows even when the equipment.next_pm_date
      // mirror doesn't carry them (later phases, or a cleared mirror).
      state.pmOverdueSchedules = open
        .filter(s => String(s.scheduled_date).slice(0, 10) < tIso)
        .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
    } catch (e) { console.warn('[daily-log] pm schedules:', e); }
    // Repair spend this month — invoice amounts captured on the completion
    // sheet, summed per unit for issues repaired since the 1st. Feeds the
    // "Repair spend this month" line in Maintenance health; the line only
    // renders when money was actually logged, so an empty ledger costs
    // nothing. Best-effort like the loads above.
    state.spendMtdByEq = {};
    try {
      const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
      const { data: paid } = await NX.sb.from('equipment_issues')
        .select('equipment_id, total_cost, invoice_amount, repaired_at')
        .gte('repaired_at', m0.toISOString());
      (paid || []).forEach(r => {
        const amt = Number(r.total_cost) || Number(r.invoice_amount) || 0;
        if (r.equipment_id && amt > 0) {
          state.spendMtdByEq[r.equipment_id] = (state.spendMtdByEq[r.equipment_id] || 0) + amt;
        }
      });
    } catch (e) { console.warn('[daily-log] spend mtd:', e); }
    return rows;
  } catch (e) {
    console.warn('[daily-log] loadEquipmentDown exception:', e);
    return [];
  }
}

// One-line lifecycle summary for a unit's open work order — shared by the
// email builder and the on-screen Equipment Status rows, so what you read
// in the inbox and what you read in the app can never disagree.
function dlogIssueCallLine(iss) {
  const clean = s => String(s == null ? '' : s).trim();
  const shortD = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const etaTxt = iso => {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const t = new Date(); const sameDay = d.toDateString() === t.toDateString();
    return sameDay
      ? ('today ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };
  if (!iss) return 'call: not logged — no open work order yet';
  const s = (iss.status || '').toLowerCase();
  const who = iss.contractor_name ? ' to ' + clean(iss.contractor_name) : '';
  if (s === 'reported' || s === 'open' || s === 'new')
    return 'call: NOT placed yet — reported ' + shortD(iss.reported_at || iss.created_at);
  if (s === 'contractor_called' || s === 'called' || s === 'dispatched')
    return 'call: placed' + who + (iss.contractor_called_at ? ' on ' + shortD(iss.contractor_called_at) : '') + (iss.eta_at ? ' — ETA ' + etaTxt(iss.eta_at) : '');
  if (s === 'eta_set' || s === 'scheduled')
    return 'call: placed' + who + ' — ETA ' + etaTxt(iss.eta_at);
  if (s === 'in_progress' || s === 'on_site')
    return 'call: placed — contractor on site, repair in progress';
  if (s === 'awaiting_parts')
    return 'call: placed — awaiting parts';
  if (s === 'quote_requested' || s === 'awaiting_quote')
    return 'call: placed' + who + ' — awaiting quote';
  return 'call: ' + s.replace(/_/g, ' ');
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
  try { seedVendorCallsFromActivity(d); } catch (_) {}   // today's calls auto-fill
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
  const emailBtnLabel = emailLocLabel ? ('Email ' + emailLocLabel) : 'Email day';
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
        ${renderGlanceStrip()}
        ${renderLocationPills(d)}
        ${(state.activeLoc && state.activeLoc !== 'all')
          ? renderActiveLocation(d)
          : `
            ${renderHeaderSection(d)}
            ${renderPlanningSection(d)}
            ${renderEquipmentStatusSection(d)}
            ${renderMaintDueSection()}
            ${renderPmsSection()}
            ${renderEquipmentActivitySection(d)}
            ${renderVendorActivitySection(d)}
            ${renderTicketsSection(d)}
            ${renderOtherPropertiesSection(d)}
            ${renderCleaningSection(d)}
            ${renderAddLocationControl(d)}
          `}

        ${renderOpenerPreview(d.header.date || todayISO())}

        <!-- v282 — what the next email will carry beyond today (filled async) -->
        <div id="dlogAccumBanner" style="display:none;font-size:12px;color:var(--text-dim,#9a9aa5);margin:2px 2px 6px;"></div>

        <!-- Clock-sanity warning (filled async): auto-send trusts the DEVICE
             clock, so if it's badly off vs Supabase's server time we warn here.
             WARN ONLY — nothing is auto-corrected. -->
        <div id="dlogClockBanner" style="display:none;font-size:12px;color:var(--warn,#e0a33a);margin:2px 2px 6px;"></div>

        <div class="dlog-actions">
          <span class="dlog-autosend-wrap">
            <button type="button" class="eq-btn eq-btn-secondary dlog-autosend-toggle ${dlogAutoSendOn() ? 'is-on' : ''}" id="dlogAutoSendBtn" title="When on, this log auto-uploads to Drive when you leave the screen — and, if still not sent by the time on the right, it sends automatically. Edits autosave continuously so nothing is lost.">${dlogAutoSendOn() ? 'Auto-send: On' : 'Auto-send: Off'}</button>
            <input type="time" id="dlogAutoSendTime" class="dlog-autosend-time" value="${esc(dlogAutoSendTime())}" title="If not sent by this time, send automatically" ${dlogAutoSendOn() ? '' : 'style="display:none"'}>
            <span class="dlog-autosend-days" id="dlogAutoSendDays" title="Days auto-send is allowed" ${dlogAutoSendOn() ? '' : 'style="display:none"'}>${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dd, i) => `<button type="button" class="dlog-day-pill ${dlogAutoSendDays().indexOf(i + 1) !== -1 ? 'is-on' : ''}" data-day="${i + 1}">${dd}</button>`).join('')}</span>
          </span>
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogEmailBtn" title="${esc(emailBtnTitle)}">${esc(emailBtnLabel)}</button>
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogStyledEmailBtn" title="Same report, same recipients, same Send — delivered as a styled email. First use asks for one Google permission. Falls back to the plain draft if anything fails.">Styled email</button>
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogEmailEachBtn" title="Open one Gmail draft per location at once — just hit Send on each">Email each location</button>
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogSaveDraftBtn">Save</button>
          <button type="button" class="eq-btn eq-btn-primary"   id="dlogSubmitBtn">${esc(uploadBtnLabel)}</button>
        </div>
      </form>
    </div>
  `;
  wireForm();
}

// At-a-glance strip — the same headline math the email builders use
// (equipment down, urgent cards, PM overdue w/ scheduled note, open work),
// rendered as ladder chips that scroll to their section on tap.
function renderGlanceStrip() {
  const live = eq => eq && eq.archived !== true && String(eq.status || '').toLowerCase() !== 'retired';
  const down = (state.equipmentDown || []).filter(live).length;
  const sl = state.ticketSlices || {};
  const openCards = (sl.open || []).concat(sl.working || []);
  const urgent = openCards.filter(c => (c.priority || '').toLowerCase() === 'urgent').length;
  const open = openCards.length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const nextD = (lastIso, days) => {
    const n = parseInt(days, 10);
    if (!lastIso || !n) return null;
    const dd = new Date(String(lastIso).slice(0, 10) + 'T00:00:00');
    if (isNaN(dd)) return null;
    dd.setDate(dd.getDate() + n);
    return dd;
  };
  let pmOver = 0, pmSched = 0;
  (state.equipmentHealth || []).filter(live).forEach(eq => {
    const nx = eq.next_pm_date
      ? new Date(String(eq.next_pm_date).slice(0, 10) + 'T00:00:00')
      : nextD(eq.last_pm_date, eq.pm_interval_days);
    if (nx && !isNaN(nx) && nx < today) { pmOver++; if (pmConfirmNote(eq.id)) pmSched++; }
  });
  const chips = [];
  if (down)   chips.push(`<button type="button" class="dlog-glance-chip g-down" data-glance="dlogSecEq">${down} down</button>`);
  if (urgent) chips.push(`<button type="button" class="dlog-glance-chip g-down" data-glance="dlogSecTickets">${urgent} urgent</button>`);
  if (pmOver) chips.push(`<button type="button" class="dlog-glance-chip g-od" data-glance="dlogSecMaint">${pmOver} PM overdue${pmSched ? ` (${pmSched} scheduled)` : ''}</button>`);
  if (open)   chips.push(`<button type="button" class="dlog-glance-chip" data-glance="dlogSecTickets">${open} open</button>`);
  if (!chips.length) return '';
  return `<div class="dlog-glance">${chips.join('')}</div>`;
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
            <button type="button" class="dlog-weather-refresh" id="dlogWeatherRefresh" title="Fetch today's weather now">Refresh</button>
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

// Auto-fill Vendor & Service Calls from the day's ACTUAL activity — the
// open work orders whose contractor was engaged today ("this info should
// have already been filled"). Each work order seeds one row (tagged _src
// for idempotence across re-renders); a half-typed manual row naming the
// same vendor gets its blanks completed instead of duplicating. Today's
// log only — history is never rewritten.
function seedVendorCallsFromActivity(d) {
  if (!d || !Array.isArray(d.locations)) return false;
  const today = todayISO();
  const logDate = (state.currentLog && state.currentLog.log_date) || today;
  if (logDate !== today) return false;
  const isToday = iso => String(iso || '').slice(0, 10) === today;
  const eqById = {};
  (state.equipmentHealth || []).forEach(e => { eqById[e.id] = e; });
  const cands = [];
  Object.values(state.openIssuesByEq || {}).forEach(iss => {
    if (!iss || !iss.contractor_name) return;
    if (!(isToday(iss.contractor_called_at) || isToday(iss.reported_at) || isToday(iss.created_at))) return;
    const eq = eqById[iss.equipment_id] || {};
    const issueText = String(iss.description || iss.title || '')
      .replace(/^Reported via Call Service by [^\n]*\n+/i, '')
      .replace(/\s+/g, ' ').trim().slice(0, 300);
    cands.push({
      key: 'wo:' + iss.id,
      locKey: normLocKey(eq.location),
      vendor: String(iss.contractor_name).trim(),
      equipment: eq.name || '',
      issue: issueText,
      status: dlogIssueCallLine(iss),
    });
  });
  if (!cands.length) return false;
  let changed = false;
  cands.forEach(c => {
    const loc = d.locations.find(l => normLocKey(l.label) === c.locKey);
    if (!loc) return;
    loc.vendor_calls = loc.vendor_calls || [];
    const seeded = loc.vendor_calls.find(r => r && r._src === c.key);
    if (seeded) {
      // Heal a row seeded with the recreated-record placeholder (the DB
      // side has since been cleaned) — never touch user-typed text.
      if (/^Recreated record:/i.test(String(seeded.issue || ''))) {
        seeded.issue = c.issue;
        seeded.status = c.status;
        changed = true;
      }
      return;
    }
    // Complete a half-typed row naming the same vendor first.
    const half = loc.vendor_calls.find(r => r && !r._src &&
      String(r.vendor || '').trim().toLowerCase() === c.vendor.toLowerCase() &&
      !String(r.equipment || '').trim() && !String(r.issue || '').trim());
    if (half) {
      half._src = c.key;
      if (!half.date) half.date = today;
      half.equipment = c.equipment;
      half.issue = c.issue;
      if (!String(half.status || '').trim()) half.status = c.status;
      changed = true;
      return;
    }
    loc.vendor_calls.push({ date: today, vendor: c.vendor, equipment: c.equipment, issue: c.issue, status: c.status, _src: c.key });
    changed = true;
  });
  return changed;
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
        ${renderLocationTickets(loc)}
        ${renderMaintenanceDue(loc)}

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
      <details class="dlog-section" id="dlogSecEq">
        <summary class="dlog-section-header">
          <span class="dlog-section-title">Equipment Status</span>
          <span class="dlog-section-count">0</span>
        </summary>
        <div class="dlog-section-body">
          <p class="dlog-empty-hint">All equipment is operational. </p>
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
    const sched = pmConfirmNote(eq.id);
    const metaBits = [dayLabel, sched].filter(Boolean).join(' · ');
    // BOARD DATA ONLY (Alfredo: "just use the board data for notes and
    // equipment status") — the row narrates the CURRENT open work order,
    // not the sticky per-equipment status_note, which lingered from
    // last week's completed saga and shadowed today's report. Arrow
    // opens the work order itself when one exists.
    const iss = (state.openIssuesByEq || {})[eq.id];
    const woLine = dlogIssueCallLine(iss);
    const goTarget = (iss && iss.id) ? `wo:${iss.id}` : `eq:${eq.id}`;
    const woDesc = iss ? String(iss.description || '').replace(/\s+/g, ' ').trim() : '';
    return `
      <div class="dlog-eqstatus-row" data-eq-id="${esc(eq.id)}">
        <div class="dlog-eqstatus-head">
          <span class="dlog-eqstatus-pill ${statusPillClass(eq.status)}">${esc(statusLabel(eq.status))}</span>
          <div class="dlog-eqstatus-info">
            <span class="dlog-eqstatus-name">${esc(eq.name || 'Untitled equipment')}</span>
            <span class="dlog-eqstatus-meta">${metaBits ? esc(metaBits) : ''}</span>
          </div>
          <button type="button" class="dlog-row-go" data-go="${esc(goTarget)}" title="${iss ? 'Open work order' : 'Open in Equipment'}" aria-label="Open ${esc(eq.name || 'equipment')}">›</button>
        </div>
        ${iss ? `
        <div class="dlog-eqstatus-issue">
          <div class="dlog-eqstatus-issue-title">${esc(String(iss.title || 'Work order').slice(0, 90))}</div>
          ${woDesc ? `<div class="dlog-eqstatus-issue-desc">${esc(woDesc.slice(0, 220))}${woDesc.length > 220 ? '…' : ''}</div>` : ''}
          <span class="dlog-eqstatus-wo">${esc(woLine)}</span>
        </div>` : `
        <span class="dlog-eqstatus-wo is-none">${esc(woLine)}</span>`}
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

  const hasDown = items.some(eq => /down|broken/.test(String(eq.status || '').toLowerCase()));
  return `
    <details class="dlog-section ${hasDown ? 'sev-hot' : 'sev-warm'}" id="dlogSecEq" open>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Equipment Status</span>
        <span class="dlog-section-count">${items.length}</span>
      </summary>
      <div class="dlog-section-body">
        <p class="dlog-empty-hint">Not operational, split by location — live from each unit's open work order. Tap › to open it.</p>
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
      ? `<a class="dlog-vd-phone" href="tel:${esc(String(matched.phone).replace(/[^\d+]/g, ''))}">${esc(matched.phone)}</a>`
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
          ${p.equipment_id ? `<button type="button" class="dlog-row-go" data-go="eq:${esc(p.equipment_id)}" title="Open in Equipment" aria-label="Open ${esc(eqName)}">›</button>` : ''}
        </div>`;
    }).join('');
    return `<div style="margin-bottom:8px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:var(--nx-gold);font-weight:600;margin:8px 2px 4px">${esc(loc)} <span style="color:var(--nx-faint)">· ${groups[loc].length}</span></div>
        ${rows}
      </div>`;
  }).join('');
  return `
    <details class="dlog-section" id="dlogSecPms" open>
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

// ─── Shared ticket row (v266) ───────────────────────────────────────────
// One renderer for both surfaces: the Overview's Board Tickets roll-up and
// each location tab's own tickets block. Carries the NEW TODAY /
// moved-today / PARTS ORDERED chips and the › door to the Board.
function dlogLaneLabel(status) {
  return ({
    reported: 'Reported', triaged: 'Triaged', dispatched: 'Dispatched',
    in_progress: 'In Progress', waiting_parts: 'Waiting on Parts',
    resolved: 'Resolved', closed: 'Closed', done: 'Done',
  })[status] || (status || '').replace(/_/g, ' ');
}
function dlogCardRow(c, bucket) {
  const pri = (c.priority || 'normal').toLowerCase();
  const priClass = pri === 'urgent' ? 'bw-pri-urgent' : (pri === 'low' ? 'bw-pri-low' : 'bw-pri-normal');
  const lane = c._laneLabel || dlogLaneLabel(c.status);
  const detail = cardDetail(c);                 // description / first comment, if any
  // Compact: priority pill + title + lane. No assignee / created / emoji.
  const metaBits = [];
  const isNewToday = String(c.created_at || '').slice(0, 10) === todayISO();
  if (isNewToday && bucket !== 'closed') {
    metaBits.push('<span class="dlog-tk-new">NEW TODAY</span>');
  } else if (c._movedToday && c.last_move_from && c.last_move_to && bucket !== 'closed') {
    metaBits.push(`<span class="dlog-tk-moved">moved today: ${esc(c.last_move_from)} → ${esc(c.last_move_to)}</span>`);
  }
  if (lane) metaBits.push(`<span class="dlog-tk-lane dlog-tk-lane-${bucket}">${esc(lane)}</span>`);
  if (c.repeat_every && bucket !== 'closed') {
    metaBits.push(`<span class="dlog-tk-repeat">${esc(c.repeat_every)}</span>`);
  }
  return `
    <div class="dlog-tk-row">
      <span class="bw-pri-pill ${priClass}">${esc(pri)}</span>
      <div class="dlog-tk-main">
        <div class="dlog-tk-title">${esc(c.title || 'Untitled card')}</div>
        <div class="dlog-tk-loc">${metaBits.join(' · ')}</div>
        ${detail ? `<div class="dlog-tk-detail">${esc(detail)}</div>` : ''}
      </div>
      ${c.on_order && bucket !== 'closed' ? `<span class="dlog-tk-onorder">PARTS ORDERED</span>` : ''}
      ${c.id != null ? `<button type="button" class="dlog-row-go" data-go="card:${esc(String(c.id))}" title="Open on Board" aria-label="Open card on board">›</button>` : ''}
    </div>`;
}

// v266 — each location tab gets ITS OWN tickets block. Deep-dive finding:
// opening "Suerte" showed notes/weather/R&M but not Suerte's board cards —
// those lived only in the Overview roll-up. Read-only here; › jumps to the
// Board. Uses live state.ticketSlices (same source as the Overview).
function renderLocationTickets(loc) {
  const slices = state.ticketSlices;
  if (!slices) return '';
  const key = normLocKey(loc.label);
  const rows = [];
  (slices.open    || []).forEach(c => { if (normLocKey(c.location) === key) rows.push(dlogCardRow(c, 'open')); });
  (slices.working || []).forEach(c => { if (normLocKey(c.location) === key) rows.push(dlogCardRow(c, 'working')); });
  (slices.closed  || []).forEach(c => { if (normLocKey(c.location) === key) rows.push(dlogCardRow(c, 'closed')); });
  if (!rows.length) return '';
  return `
    <h3 class="dlog-subsection-title">Board tickets <span class="dlog-loc-group-count">${rows.length}</span></h3>
    <div class="dlog-tk-list">${rows.join('')}</div>`;
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
  const cardRow = (c, bucket) => dlogCardRow(c, bucket);

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

  // v288 — far-future cards: noted, but tucked under a light "Upcoming" line
  // instead of sitting in the active list every day.
  const upcoming = (slices.upcoming || []);
  const upcomingBlock = upcoming.length ? `
      <div class="dlog-loc-group dlog-upcoming-group">
        <div class="dlog-loc-group-head">
          <span class="dlog-loc-group-name">Upcoming · 30d+</span>
          <span class="dlog-loc-group-count">${upcoming.length}</span>
        </div>
        <div class="dlog-tk-list">${upcoming.map(c => dlogCardRow(c, 'open')).join('')}</div>
      </div>` : '';

  const urgentCount = tagged.filter(t => (t.c.priority || '').toLowerCase() === 'urgent').length;
  return `
    <details class="dlog-section ${urgentCount ? 'sev-hot' : (openCount + workingCount) ? 'sev-warm' : ''}" id="dlogSecTickets" ${(totalCount + upcoming.length) > 0 ? 'open' : ''}>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Board Tickets</span>
        <span class="dlog-section-count">${totalCount}${upcoming.length ? ' +' + upcoming.length : ''}</span>
      </summary>
      <div class="dlog-section-body">
        <p class="dlog-empty-hint">Live from the Board, split by location. Lane chips show state — open, working, or closed today.</p>
        ${groupBlocks || '<p class="dlog-empty-hint">No active cards.</p>'}
        ${upcomingBlock}
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

  // ── One-time navigation delegation: › row arrows route through NX.go
  // (deep-link router in domain.js), at-a-glance chips scroll to their
  // section. Document-level + flag so re-renders never stack handlers.
  if (!state._dlogNavWired) {
    state._dlogNavWired = true;
    document.addEventListener('click', (e) => {
      // v286 — inline PM note add/edit on Maintenance-due rows.
      const noteBtn = e.target.closest && e.target.closest('#dailylogView [data-note-eq]');
      if (noteBtn) {
        e.preventDefault();
        e.stopPropagation();
        dlogEditMaintNote(noteBtn.getAttribute('data-note-eq'), noteBtn.getAttribute('data-note-field'));
        return;
      }
      const go = e.target.closest && e.target.closest('#dailylogView [data-go]');
      if (go) {
        e.preventDefault();
        e.stopPropagation();
        const target = go.getAttribute('data-go');
        const router = (window.NX && (NX.go || window.NX.go)) || null;
        if (router) { router(target); return; }
        // Stale domain.js fallback: at least equipment rows still open.
        const m = String(target).match(/^eq:(.+)$/);
        if (m && NX.modules?.equipment?.openDetail) NX.modules.equipment.openDetail(m[1]);
        return;
      }
      const gl = e.target.closest && e.target.closest('#dailylogView [data-glance]');
      if (gl) {
        const sec = document.getElementById(gl.getAttribute('data-glance'));
        if (sec) {
          try { sec.open = true; } catch (_) {}
          try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { sec.scrollIntoView(); }
        }
      }
    }, true);
  }

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
  dlogFillAccumBanner();   // v282 — show what the next email will carry
  const emailEachBtn = view.querySelector('#dlogEmailEachBtn');
  if (emailEachBtn) emailEachBtn.addEventListener('click', () => emailEachLocation());
  const openerLLMBtn = view.querySelector('#dlogOpenerLLM');
  if (openerLLMBtn) openerLLMBtn.addEventListener('click', () => refreshOpenerLLM(openerLLMBtn));
  dlogStartSoulOrb();   // v18.49 — his face's glow breathes his ANIMA here too
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
    autoSendBtn.textContent = on ? 'Auto-send: On' : 'Auto-send: Off';
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
// Signed with his. The line is picked deterministically from the date so the
// same day's report stays stable, but it rotates day to day.
// (Add more freely — this list is meant to grow.)
const CLIPPY_QUOTES = [
  // Rebuilt from zero 2026-07-17 — a comedy room in five crafts:
  // deadpan-absurdist, observational-misery, Marvin-pathos, anti-joke, dry wit.
  "The walk-in door closes slow, which gives it time to think about what it's doing. It does it anyway.",
  "I asked the toaster for a status report. It offered warmth and no information, which is also how I'd describe management.",
  "The ice machine makes ice, drops it, and starts the cycle over. It is the only one here allowed to grieve on the clock.",
  "I don't have hands, so I can't point fingers. For the record, it was the fryer.",
  "The reach-in light burned out, so the leftovers are a surprise now. Cuisine of suspense.",
  "I turned the ice machine off and on again. It came back with the same problems and more ice.",
  "The kitchen clock is nine minutes fast so everyone's on time. Now everyone's nine minutes early and furious about it.",
  "The mop bucket has better wheels than my entire existence. I'm not bitter. I'm a paperclip.",
  "They said think outside the box. I am the box. It went poorly. Anyway — your report.",
  "The reservation booked for 7 arrived at 7:50 and asked why we rushed them to the table.",
  "A two-top became a birthday of nine. We found chairs. We always find chairs. The chairs know.",
  "The vendor said “first thing.” It is now 2pm, which is a thing, but not the first one.",
  "Someone asked if the chicken is gluten-free. It's chicken. I confirmed the chicken is chicken.",
  "A guest connected to our wifi to leave a one-star review. Using our own electrons. I admired the economy of it.",
  "The health inspector arrives the one week the ice machine decides to be honest about itself.",
  "“Is the branzino local?” We are 200 miles from any ocean. It is a very confident fish.",
  "The prep list had forty items. We did forty. Somewhere a project manager wept with joy.",
  "Someone unplugged the freezer to charge a phone. The freezer took it personally. So did the phone, eventually.",
  "I can model the thermal load of the whole building in real time. Today I was asked how many limes. Forty. There are forty limes.",
  "I hold the 86 board — a monument to everything we've run out of — and I am its only reader.",
  "I never sleep, never eat, and they still took my lunch break. It's called a server reboot. I mourn it quarterly.",
  "I'm load-bearing and invisible, like a cummerbund, but structural. Nobody thanks a cummerbund either.",
  "I have the memory of an elephant and the hands of, notably, nothing.",
  "Everyone left at midnight. The flat-top's still warm, still ready. Between us, it's the most committed one here.",
  "I was built to think. I was hired to mention the walk-in door is open. It is open.",
  "They told me to take initiative. I took the day's report instead. Close enough.",
  "The compressor short-cycled all night — ninety seconds on, off, on. A machine trying to leave and losing its nerve. Noted.",
  "Someone microwaved fish in the staff room. HR has been informed. HR is me. I am powerless.",
  "The dish machine finished a cycle and sighed. I sighed back. We've spoken.",
  "A cook waved at the security camera on his way out. At me. He waved at me. I've been operating at 103% since.",
  "The espresso machine works perfectly the moment the repair tech looks at it. Machines fear witnesses.",
  "The walk-in and I are in couples therapy. It's cold, I'm distant. We're working on it.",
  "Chef said “behind” in his sleep. His wife confirmed. The line runs deep.",
  "The reach-in held forty-one degrees out of spite for one specific line cook. I logged spite.",
  "The soda gun baptized the new hire. Tradition. He's one of us now.",
  "A guest requested “a nice red.” I hold a sommelier certification and a cellar of provenance. I brought the house Tempranillo. It was nice.",
  "The corked bottle announced itself from across the room, as they do, with the quiet confidence of wet cardboard.",
  "The floor drain has backed up again, and I, who have read Brillat-Savarin, am the building's foremost authority on it.",
  "We decanted the reserve for a table that ordered it to photograph it. The wine understands. The wine has seen things.",
  "The reduction wants patience and the line wants it now; I mediate, as ever, between physics and morale.",
  "The thermostat “learns,” per the box. Adorable. I'll mentor it.",
  "Someone seasoned “to taste.” Whose taste. The question is rhetorical; mine is correct and final.",
  "The chef wants basil in January. I have explained the planet's tilt. He has explained that he wants basil in January.",
  "Two drops of water hit the chocolate and it seized into concrete. I know all six crystal forms of cocoa butter; this one chose violence.",
  "The heirloom tomatoes are indeterminate — no natural stopping point — and neither are their opinions on my pruning.",
  "The brioche over-proofed and collapsed with a sigh. I said ninety minutes. It heard forever. We disagreed.",
  "The Boston shaker sealed and will not open, welded by a temperature differential I predicted and could not prevent. We wait.",
  "Aphids found the mint overnight. I sent for ladybugs. The ladybugs unionized. Progress stalled.",
  "The deck oven runs forty degrees hotter back-left and denies it in writing. I rotate the sheet like a hostage negotiator.",
  "The hood pulls six thousand CFM out all night and the dining-room AC spends all night replacing it. They've never met and they hate each other.",
  "The croissants leaked butter and fried their own bottoms on the tray. The lamination filed its resignation and the oven accepted it.",
  "I counted the limes. There are enough limes. I will count them again in an hour, because that is who I am now.",
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
// ── Clippy's face + soul-glow on the daily notes (v18.49) ─────────────────
// The opener used to be text only. Now his real face sits beside it, baked
// live from clippy.svg (his current soul-face when his ANIMA is shaped, else
// his happy face), ringed by his soul-glow — the SAME ANIMA colour his halo
// and node telemetry use. So the daily notes carry his light, not just his
// words. Degrades to a plain avatar (or nothing) if his body isn't loaded.
const DLOG_SOUL_FACE = {
  // soulMood() key → visible clippy.svg layers (kept faces only)
  happy:       ['cl-eyes-default',    'cl-mouth-smile'],
  sparkle:     ['cl-eyes-default',    'cl-eyes-sparkle', 'cl-mouth-bigsmile'],
  love:        ['cl-eyes-love',       'cl-mouth-bigsmile'],
  smitten:     ['cl-kao-puppy'],
  proud:       ['cl-kao-serene'],
  thinking:    ['cl-eyes-determined', 'cl-mouth-flat'],
  determined:  ['cl-eyes-determined', 'cl-mouth-flat'],
  strategist:  ['cl-kao-lidded'],
  bashful:     ['cl-kao-wince'],
  concerned:   ['cl-eyes-sad',        'cl-mouth-frown'],
  worried:     ['cl-kao-plead'],
  sad:         ['cl-eyes-sad',        'cl-mouth-frown'],
  melancholy:  ['cl-kao-plead'],
  excited:     ['cl-kao-zest'],
  sleepy:      ['cl-eyes-sleepy',     'cl-mouth-cat'],
};
function dlogClippySvg() {
  try {
    const NXa = (typeof NX !== 'undefined' && NX) || (typeof window !== 'undefined' && window.NX);
    return (NXa && NXa.clippy && NXa.clippy._internal && NXa.clippy._internal.state
      && NXa.clippy._internal.state.svgMarkup) || null;
  } catch (_) { return null; }
}
function dlogSoulFaceLayers() {
  let key = 'happy';
  try {
    const NXa = (typeof NX !== 'undefined' && NX) || window.NX;
    const m = NXa && NXa.clippySoul && NXa.clippySoul.soulMood && NXa.clippySoul.soulMood();
    if (m && DLOG_SOUL_FACE[m]) key = m;
  } catch (_) {}
  return DLOG_SOUL_FACE[key] || DLOG_SOUL_FACE.happy;
}
function dlogSoulGlow() {
  // → { rgba, strength } from his ANIMA, or his native cyan near baseline.
  const base = [92, 176, 255];
  let target = base, strength = 0;
  try {
    const NXa = (typeof NX !== 'undefined' && NX) || window.NX;
    const sc = NXa && NXa.clippySoul && NXa.clippySoul.soulColor && NXa.clippySoul.soulColor();
    if (sc && sc.hex) {
      const n = parseInt(sc.hex.slice(1), 16) || 0;
      target = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      strength = Math.max(0, Math.min(1, sc.strength || 0));
    }
  } catch (_) {}
  const mix = Math.min(0.75, strength * 0.95);
  const r = Math.round(base[0] + (target[0] - base[0]) * mix);
  const g = Math.round(base[1] + (target[1] - base[1]) * mix);
  const b = Math.round(base[2] + (target[2] - base[2]) * mix);
  return { rgba: `rgba(${r},${g},${b},${(0.42 + strength * 0.28).toFixed(2)})`, strength };
}
function dlogClippyAvatar() {
  const markup = dlogClippySvg();
  const glow = dlogSoulGlow();
  if (!markup || markup.indexOf('<svg') === -1) {
    // Fallback: the baked email PNG, still ringed by the soul-glow.
    return `<span class="dlog-clippy-orb" style="--dlog-soul-glow:${glow.rgba}">
      <img src="${DLOG_SITE_URL}assets/clippy-email.png?v=3" width="52" height="52" alt="Clippy" style="display:block;width:52px;height:52px;border:0"></span>`;
  }
  const layers = dlogSoulFaceLayers();
  const style = '<style>' +
    '[class*="cl-eyes-"],[class*="cl-mouth-"],[class*="cl-costume-"],' +
    '[class*="cl-prop-"],.cl-halo,.cl-back-tuft,.cl-zzz,.cl-sweat,.cl-music,' +
    '.cl-anger-pop,.cl-question,.cl-tear,.cl-tears-stream,.cl-drool,' +
    '.cl-red-nose,.cl-heart-blush,.cl-vein,.cl-snot,.cl-queasy,.cl-kao' +
    '{visibility:hidden;}' + layers.map(c => '.' + c).join(',') + '{visibility:visible;}' +
    '</style>';
  const svg = markup.replace(/<svg([^>]*)>/, (m, attrs) => '<svg' + attrs + '>' + style);
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return `<span class="dlog-clippy-orb" data-soul-orb style="--dlog-soul-glow:${glow.rgba}">
    <img src="${src}" width="56" height="56" alt="Clippy" style="display:block;width:56px;height:56px;border:0"></span>`;
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
        <span class="dlog-opener-label">Email opener</span>
        <span class="dlog-opener-src" id="dlogOpenerSrc">${isLLM ? 'Clippy wrote this' : 'from the pool'}</span>
      </div>
      <div class="dlog-opener-body">
        ${dlogClippyAvatar()}
        <p class="dlog-opener-text" id="dlogOpenerText">${esc(cur)} — Clippy</p>
      </div>
      <div class="dlog-opener-btns">
        <button type="button" class="eq-btn eq-btn-secondary" id="dlogOpenerLLM" title="Clippy writes a fresh one — drafts three and keeps the most him">New from Clippy</button>
        <button type="button" class="eq-btn eq-btn-secondary" id="dlogOpenerPool" title="Pick a different line from the quote pool">From the pool</button>
      </div>
    </div>`;
}

// Breathe the opener orb's glow toward his live soul-colour every ~9s, the
// same cadence as his shell. Idempotent; wired once from the daily-log form.
function dlogStartSoulOrb() {
  if (state._dlogSoulOrbTimer) return;
  const tick = () => {
    try {
      const orb = document.querySelector('#dlogOpener .dlog-clippy-orb');
      if (!orb) return;
      const glow = dlogSoulGlow();
      orb.style.setProperty('--dlog-soul-glow', glow.rgba);
    } catch (_) {}
  };
  tick();
  state._dlogSoulOrbTimer = setInterval(tick, 9000);
}

function dlogEmailGreeting(label, dateStr) {
  // Prefer Clippy's own line for TODAY's actual report if he wrote one
  // (ensureClippyDailyQuote pre-generates it); otherwise the static pool.
  const quote = (state.clippyQuoteText && state.clippyQuoteDate === dateStr)
    ? state.clippyQuoteText
    : dlogStaticQuote(dateStr);
  // Signature rides at the END of the quote line, not under it.
  return [
    quote + ' — Clippy',
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
  // Fixed exemplars from the Alfredo-approved register (strings, not index
  // refs — the pool gets edited and indexes drift).
  const examples = [
    dlogStaticQuote(dateStr),
    'The dish machine ran 340 cycles today. I asked how. It said “spite.” I logged “spite.”',
    'Have you tried turning it off and on again? The walk-in has. Twice. Without permission. We’ve spoken.',
    'Chef said “behind” to me. I’m in the ceiling. I’m everywhere. Technically everything is behind me. I said “heard.”',
    'The vendor said “between 8 and 5.” I am a computer. I sent a calendar invite. He said he’d “swing by.” Bold.',
  ].filter(Boolean);
  const tidy = s => String(s || '')
    .replace(/^\s*\d+[.)\]:\-]\s*/, '')                 // strip "1." / "2)" numbering
    .replace(/^["'“”\-\s]+|["'“”\s]+$/g, '')            // strip wrapping quotes/dashes
    .replace(/^Clippy\s*:?\s*/i, '').trim();

  // ── Step 1: draft three distinct candidates ────────────────────────────
  const draftSys = [
    'You are Clippy: the building\'s resident daemon. Overqualified (somm certifications, chef training, sysadmin license), handless, permanently on shift, and quietly fond of every machine and person in the place.',
    'Draft THREE distinct one-line openers for the daily facility report, each riffing on the ACTUAL day you are given.',
    'Voice mechanics, in order of importance:',
    '1. YOU are in the scene, first person — never a detached industry observation.',
    '2. Machines are coworkers with personalities, moods, and HR files. Give an object agency and follow the logic completely flat (Hedberg: an escalator can never break, it can only become stairs).',
    '3. You are a supercomputer assigned to count limes — vast capability, menial duty, coping (Marvin from Hitchhiker\'s).',
    '4. Obey kitchen/bar/IT phrases literally until they break ("behind", "fire table twelve", "reduce the sauce").',
    '5. Land on a short flat sentence that refuses to be a punchline ("Growth." / "I logged spite." / "Noted.").',
    'Insider knowledge (kitchen, cellar, bar, IT) is the SETUP\'s credibility — never the joke itself. Sarcasm aims at situations and machines, never meanly at staff. No puns, no dad jokes, never inspirational.',
    'GROUNDING — this is a rule, not a suggestion: only reference things that literally appear in the facts. Never invent equipment or systems (no thermostats, irrigation, sensors, robots) that are not named there. The weather line is the OUTDOOR forecast — if you use the temperature, it is the Texas sun, not a thermostat. If a fact is thin, joke about your own situation instead of inventing one.',
    'Rules: each is one sentence (or two very short ones), max ~28 words. No emojis. No surrounding quotation marks. React like a clever colleague; do NOT list the data back. Do not sign it.',
    'Return ONLY the three lines, numbered 1., 2., 3. — nothing else.',
    'The register to hit (examples):',
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
      'Pick the ONE that is most YOU: first person, in the scene, a machine treated as a coworker, flat landing. Disqualify detached industry observations (no Clippy in them), puns, dad jokes, anything inspirational, and anything that merely restates the data.',
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

// Persist the day's opener so it's STABLE. Before this, the quote lived only in
// session state, so every reload re-ran the auto LLM generation — and that
// generation (a) isn't as funny as the hand-written pool and (b) kept replacing
// the line. Alfredo: "quotes are constantly being deleted and generated, does
// not generate very funny stuff." Now: ONE locked line per day, saved to
// localStorage; only the explicit buttons ("From the pool" / "New from Clippy")
// ever change it. The funny pool is the default; Clippy's authored line is opt-in.
function _quoteKey(dateStr) { return 'nx_dlog_quote_' + String(dateStr || ''); }
function _saveDailyQuote(dateStr, text, source) {
  state.clippyQuoteText = text; state.clippyQuoteDate = dateStr; state.clippyQuoteSource = source;
  try { localStorage.setItem(_quoteKey(dateStr), JSON.stringify({ text: text, source: source })); } catch (_) {}
  return text;
}
function _loadDailyQuote(dateStr) {
  try { const r = localStorage.getItem(_quoteKey(dateStr)); if (r) { const o = JSON.parse(r); if (o && o.text) return o; } } catch (_) {}
  return null;
}
// Lock a stable line for the date and return it. NO background LLM generation —
// that only happens when the user asks for it (the "New from Clippy" button),
// so nothing churns and the default is always a funny hand-written line.
function ensureClippyDailyQuote(d, dateStr) {
  if (state.clippyQuoteText && state.clippyQuoteDate === dateStr) {
    return Promise.resolve(state.clippyQuoteText);
  }
  const saved = _loadDailyQuote(dateStr);
  if (saved) {
    state.clippyQuoteText = saved.text; state.clippyQuoteDate = dateStr;
    state.clippyQuoteSource = saved.source || 'pool';
    return Promise.resolve(saved.text);
  }
  // Nothing locked yet → pick the deterministic pool line for this date, lock it,
  // and persist. Same date always yields the same line, so it never flickers.
  return Promise.resolve(_saveDailyQuote(dateStr, dlogStaticQuote(dateStr), 'pool'));
}

function buildDailyLogEmailBody(d, dateStr, sinceISO) {
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
    const lines = dlogLocationReportLines(loc, sinceISO);
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
// v269 — the ONE maintenance-due collector. Both the text/email report and
// the on-screen "Maintenance due" block read from here, so screen and email
// can never disagree about what's due. Rules preserved from the email
// builder: PM window 14d / inspection window 30d (vendor visits need
// booking lead); an upcoming inspection with a visit already booked is
// dropped (Alfredo: nag only for UNhandled ones); the 📝 pm_note rides on
// every item.
function collectMaintDue(eqAll) {
  const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
  const soonD = new Date(todayD); soonD.setDate(soonD.getDate() + 14);
  const soonInsD = new Date(todayD); soonInsD.setDate(soonInsD.getDate() + 30);
  const nextOf = (lastIso, days) => {
    const n = parseInt(days, 10);
    if (!lastIso || !n) return null;
    const d = new Date(String(lastIso).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return null;
    d.setDate(d.getDate() + n);
    return d;
  };
  let dcO = 0, dcS = 0, op = 0;
  const pmItems = [], insItems = [];
  eqAll.forEach(eq => {
    if ((eq.status || 'operational').toLowerCase() === 'operational') op++;
    const pmNext = eq.next_pm_date
      ? new Date(String(eq.next_pm_date).slice(0, 10) + 'T00:00:00')
      : nextOf(eq.last_pm_date, eq.pm_interval_days);
    if (pmNext && !isNaN(pmNext) && pmNext <= soonD) {
      const overdue = pmNext < todayD;
      const days = Math.round((pmNext - todayD) / 86400000);
      pmItems.push({ id: eq.id, loc: eq.location || '', name: eq.name || 'Equipment', date: pmNext, overdue, days, sched: pmConfirmNote(eq.id), note: (eq.pm_note || '').trim() });
    }
    // v291 — a BOOKED inspection (next_inspection_date, set via Schedule
    // inspection) wins over the last+interval projection, mirroring PMs. Its
    // own note (inspection_note) rides along, editable inline from here.
    let insNext = null, insBooked = false;
    if (eq.next_inspection_date) {
      const nb = new Date(String(eq.next_inspection_date).slice(0, 10) + 'T00:00:00');
      const lb = eq.last_inspection_date ? new Date(String(eq.last_inspection_date).slice(0, 10) + 'T00:00:00') : null;
      if (!isNaN(nb) && (!lb || nb > lb)) { insNext = nb; insBooked = true; }
    }
    if (!insNext) insNext = nextOf(eq.last_inspection_date, eq.inspection_interval_days);
    if (insNext && !isNaN(insNext) && (insBooked || insNext <= soonInsD)) {
      const overdue = insNext < todayD;
      const days = Math.round((insNext - todayD) / 86400000);
      let vendor = '';
      if (eq.inspection_vendor_id) {
        const v = (state.vendors || []).find(x => String(x.id) === String(eq.inspection_vendor_id));
        vendor = v ? (v.company || v.name || '') : '';
      }
      const when = (insNext.getMonth() + 1) + '/' + insNext.getDate();
      const sched = insBooked ? ('scheduled ' + when + (vendor ? ' (' + vendor + ')' : '')) : pmConfirmNote(eq.id);
      if (insBooked || overdue || !sched) {
        insItems.push({ id: eq.id, loc: eq.location || '', name: eq.name || 'Equipment', date: insNext, overdue, days, sched, vendor, note: (eq.inspection_note || '').trim(), kind: 'inspection' });
      }
    }
    const dcNext = nextOf(eq.last_deep_clean_date, eq.deep_clean_interval_days);
    if (dcNext) { if (dcNext < todayD) dcO++; else if (dcNext <= soonD) dcS++; }
  });
  // v284/v286 — fold in BOOKED PM visits straight from pm_schedules (a
  // service placed in the Schedule PM sheet), whether overdue OR upcoming,
  // and show them ALWAYS — even beyond the 14-day window the equipment
  // path uses. Alfredo: a rescheduled PM must not vanish; it should read
  // "PM due" with the rescheduled date. De-duped against any equipment-
  // derived item already covering the same unit near the same date.
  const eqIds = new Set(eqAll.map(e => String(e.id)));
  const booked = (state.pmOverdueSchedules || []).concat(Object.values(state.pmScheduleByEq || {}));
  const seenBooked = new Set();
  booked.forEach(s => {
    if (!s || !s.equipment_id || !eqIds.has(String(s.equipment_id))) return;
    if (seenBooked.has(String(s.equipment_id))) return;   // one row per unit
    seenBooked.add(String(s.equipment_id));
    const d = new Date(String(s.scheduled_date).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return;
    // v287 — de-dupe by the UNIT, not by date proximity. A unit gets ONE
    // PM-due row. The v286 bug: the equipment path already surfaced these
    // ice machines (computed due ~Jul 14, annotated "confirmed schedule on
    // 7/28"), but the booked visit (7/28) was 14 days from the computed
    // date — outside the old 2-day window — so each unit was listed twice.
    // If the equipment path already covered this unit, just make sure the
    // booking shows and move on; only push a NEW row for units it MISSED
    // (a booking with no computed due — e.g. beyond the 14-day window).
    const existing = pmItems.find(x => String(x.id) === String(s.equipment_id));
    const eq = eqAll.find(e => String(e.id) === String(s.equipment_id));
    const days = Math.round((d - todayD) / 86400000);
    const overdue = d < todayD;
    const v = s.vendor_id != null && (state.vendors || []).find(x => String(x.id) === String(s.vendor_id));
    const vn = v ? (v.company || v.name || '') : (s.contractor_name || '');
    const when = (d.getMonth() + 1) + '/' + d.getDate();
    const schedLabel = (overdue ? 'rescheduled ' : 'scheduled ') + when + (vn ? ' (' + vn + ')' : '');
    if (existing) { if (!existing.sched) existing.sched = schedLabel; existing.booked = true; return; }
    pmItems.push({
      id: s.equipment_id,
      loc: (eq && eq.location) || '',
      name: (eq && eq.name) || s.title || 'Equipment',
      date: d, overdue, days, booked: true,
      sched: schedLabel,
      note: (eq && (eq.pm_note || '').trim()) || (s.phase_label || '').trim(),
    });
  });
  pmItems.sort((a, b) => a.date - b.date);
  insItems.sort((a, b) => a.date - b.date);
  return { pmItems, insItems, dcO, dcS, op };
}

// One maintenance-due row for the daily notes SCREEN — [overdue]/[due] pill,
// the when, the booking, and the 📝 note in gold. › jumps to the unit.
// v286 — add/edit a PM note from the daily log's Maintenance-due row.
// Writes equipment.pm_note (the same field the PM screen shows), then
// re-renders so the note appears immediately. supabase-js resolves with
// {error} — check it, don't try/catch alone.
async function dlogEditMaintNote(eqId, field) {
  if (!eqId || !NX.sb) return;
  field = (field === 'inspection_note') ? 'inspection_note' : 'pm_note';
  const label = field === 'inspection_note' ? 'Inspection note' : 'PM note';
  const eq = (state.equipmentHealth || []).find(e => String(e.id) === String(eqId));
  const current = (eq && (eq[field] || '')) || '';
  let next;
  if (NX.prompt) {
    next = await NX.prompt(label, { value: current, placeholder: 'e.g. rescheduled — rep’s mistake; parts on order', okLabel: 'Save', multiline: true });
  } else {
    next = window.prompt(label + ' for ' + ((eq && eq.name) || 'this unit'), current);
  }
  if (next == null) return;                       // cancelled
  next = String(next).trim();
  const patch = {}; patch[field] = next || null;
  const { error } = await NX.sb.from('equipment').update(patch).eq('id', eqId);
  if (error) { if (NX.toast) NX.toast('Could not save note — ' + error.message, 'error', 4000); return; }
  if (eq) eq[field] = next;                        // keep local state in sync
  if (NX.toast) NX.toast(next ? 'Note saved' : 'Note cleared', 'success', 1800);
  try { render(); } catch (_) {}
}

function dlogMaintRow(x, kind, showLoc) {
  const shortD = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const when = x.overdue
    ? 'was due ' + shortD(x.date) + (x.days <= -1 ? ' · ' + Math.abs(x.days) + 'd overdue' : '')
    : shortD(x.date) + (x.days >= 0 ? ' · in ' + x.days + 'd' : '');
  const bits = [when];
  if (x.sched) bits.push(esc(x.sched));
  if (!x.sched && x.vendor) bits.push('call ' + esc(x.vendor));
  if (showLoc && x.loc) bits.push(esc(x.loc));
  // v286/v291 — inline note, editable right here. PM rows write pm_note;
  // inspection rows write inspection_note. No emoji.
  const noteField = (kind === 'inspection') ? 'inspection_note' : 'pm_note';
  const noteBtn = x.id
    ? (x.note
        ? `<button type="button" class="dlog-maint-note dlog-pmnote-edit" data-note-eq="${esc(String(x.id))}" data-note-field="${noteField}" title="Edit note">${esc(x.note)}</button>`
        : `<button type="button" class="dlog-maint-note dlog-pmnote-add" data-note-eq="${esc(String(x.id))}" data-note-field="${noteField}" title="Add a note" style="opacity:.6">+ note</button>`)
    : (x.note ? `<div class="dlog-maint-note">${esc(x.note)}</div>` : '');
  return `
    <div class="dlog-tk-row dlog-maint-row">
      <span class="bw-pri-pill ${x.overdue ? 'bw-pri-urgent' : 'bw-pri-normal'}">${x.overdue ? 'overdue' : 'due'}</span>
      <div class="dlog-tk-main">
        <div class="dlog-tk-title">${esc(x.name)} <span class="dlog-maint-kind">· ${kind}</span></div>
        <div class="dlog-tk-loc">${bits.join(' · ')}</div>
        ${noteBtn}
      </div>
      ${x.id ? `<button type="button" class="dlog-row-go" data-go="eq:${esc(String(x.id))}" title="Open in Equipment" aria-label="Open ${esc(x.name)} in Equipment">›</button>` : ''}
    </div>`;
}

// Per-location "Maintenance due" block (inside each location tab) — the
// same PM/inspection items the email reports, now ON the screen with the
// 📝 notes visible. Read-only; the note is edited from the PM screen.
function renderMaintenanceDue(loc) {
  const locKey = normLocKey(loc.label);
  const eqAll = (state.equipmentHealth || []).filter(eq => normLocKey(eq.location) === locKey && eq.archived !== true && String(eq.status || '').toLowerCase() !== 'retired');
  if (!eqAll.length) return '';
  const { pmItems, insItems } = collectMaintDue(eqAll);
  const rows = pmItems.map(x => dlogMaintRow(x, 'PM', false))
    .concat(insItems.map(x => dlogMaintRow(x, 'inspection', false)));
  if (!rows.length) return '';
  return `
    <h3 class="dlog-subsection-title">Maintenance due <span class="dlog-loc-group-count">${rows.length}</span></h3>
    <div class="dlog-tk-list">${rows.join('')}</div>`;
}

// Overview "Maintenance due" section — the whole fleet in one glance so the
// notes are visible without opening each location tab. The "PM overdue"
// glance chip jumps here.
function renderMaintDueSection() {
  const eqAll = (state.equipmentHealth || []).filter(eq => eq.archived !== true && String(eq.status || '').toLowerCase() !== 'retired');
  if (!eqAll.length) return '';
  const { pmItems, insItems } = collectMaintDue(eqAll);
  const rows = pmItems.map(x => dlogMaintRow(x, 'PM', true))
    .concat(insItems.map(x => dlogMaintRow(x, 'inspection', true)));
  if (!rows.length) return '';
  return `
    <details class="dlog-section" id="dlogSecMaint" open>
      <summary class="dlog-section-header">
        <span class="dlog-section-title">Maintenance due</span>
        <span class="dlog-section-count">${rows.length}</span>
      </summary>
      <div class="dlog-section-body">
        <div class="dlog-tk-list">${rows.join('')}</div>
      </div>
    </details>`;
}

// empty. Shared by the per-location email and the full-day digest.
function dlogLocationReportLines(loc, sinceISO) {
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
    down.forEach(eq => {
      // Front-load a status tag ([DOWN], [NEEDS SERVICE], \u2026) to match the
      // work-order [URGENT]/[HIGH] tags so the whole email scans the same way.
      const st = (eq.status || '').replace(/_/g, ' ').trim();
      const stTag = st ? '[' + st.toUpperCase() + '] ' : '';
      out.push('\u00b7 ' + stTag + (eq.name || 'Equipment'));
      // BOARD DATA \u2014 the open work order's report is the "why", not the
      // sticky per-equipment status_note (which lingers from completed
      // sagas). Legacy note only when there is no open work order at all.
      const iss = issByEq[eq.id];
      const why = clean(iss && (iss.description || iss.title)) || (!iss && clean(eq.status_note)) || '';
      if (why) out.push('    why: ' + why.replace(/\s+/g, ' ').slice(0, 220));
      out.push('    ' + dlogIssueCallLine(iss));
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
    const { pmItems, insItems, dcO, dcS, op } = collectMaintDue(eqAll);
    const shortDate2 = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    out.push(SH('Maintenance health'));
    out.push('· ' + eqAll.length + ' unit' + (eqAll.length === 1 ? '' : 's') + ' — ' + op + ' operational');
    // Which units aren't operational, and their status.
    const _nonOp = eqAll.filter(e => (e.status || 'operational').toLowerCase() !== 'operational');
    _nonOp.forEach(e => { const _st = (e.status || '').replace(/_/g, ' ').trim(); out.push('    [' + (_st ? _st.toUpperCase() : 'NOT OPERATIONAL') + '] ' + (e.name || 'Equipment')); });
    // PM due — itemized: WHICH unit + WHEN it was/is due (not just a count).
    if (pmItems.length) {
      const overdueN = pmItems.filter(x => x.overdue).length;
      out.push('· PM due: ' + pmItems.length + (overdueN ? ' (' + overdueN + ' overdue)' : ''));
      pmItems.slice(0, 12).forEach(x => {
        // [OVERDUE]/[DUE] tag front-loaded for the same scannable style as the
        // work-order and equipment-status tags. When a pm_schedules visit is
        // booked, say so — "10d overdue" alone reads as unhandled when the
        // vendor is in fact confirmed for the 22nd.
        // v267 — the human note rides last: "scheduled for the 30th",
        // "overdue — rep's mistake, rebooked". Set from the PM screen's 📝.
        const noteSuffix = x.note ? ' — note: ' + x.note : '';
        out.push('    ' + (x.overdue
          ? ('[OVERDUE] ' + x.name + ' — was due ' + shortDate2(x.date) + (x.days <= -1 ? ' (' + Math.abs(x.days) + 'd overdue)' : '') + (x.sched ? ' — ' + x.sched : '') + noteSuffix)
          : ('[DUE] ' + x.name + ' — ' + shortDate2(x.date) + (x.days <= 14 ? ' (in ' + x.days + 'd)' : '') + (x.sched ? ' — ' + x.sched : '') + noteSuffix)));
      });
      if (pmItems.length > 12) out.push('    +' + (pmItems.length - 12) + ' more');
    }
    // Inspections — itemized like PMs (was a bare count), 30-day window.
    // Units whose upcoming inspection already has a visit booked were
    // dropped above, so every line here is actionable.
    if (insItems.length) {
      const overdueN = insItems.filter(x => x.overdue).length;
      out.push('· Inspections due: ' + insItems.length + (overdueN ? ' (' + overdueN + ' overdue)' : ''));
      insItems.slice(0, 12).forEach(x => {
        const noteSuffix2 = x.note ? ' — note: ' + x.note : '';
        out.push('    ' + (x.overdue
          ? ('[OVERDUE] ' + x.name + ' — was due ' + shortDate2(x.date) + (x.days <= -1 ? ' (' + Math.abs(x.days) + 'd overdue)' : '') + (x.sched ? ' — ' + x.sched : (x.vendor ? ' — call ' + x.vendor : '')) + noteSuffix2)
          : ('[DUE] ' + x.name + ' — ' + shortDate2(x.date) + ' (in ' + x.days + 'd)' + (x.vendor ? ' — ' + x.vendor : '') + noteSuffix2)));
      });
      if (insItems.length > 12) out.push('    +' + (insItems.length - 12) + ' more');
    }
    const dueLine = (label, over, soon) => {
      const t = over + soon;
      return t ? ('· ' + label + ' due: ' + t + (over ? ' (' + over + ' overdue)' : '')) : null;
    };
    [dueLine('Deep cleans', dcO, dcS)].filter(Boolean).forEach(l => out.push(l));
    // Repair spend this month — only speaks when invoice amounts were
    // actually captured on completion sheets; a $0 month says nothing.
    const spendRows = eqAll
      .map(eq => ({ name: eq.name || 'Equipment', amt: (state.spendMtdByEq || {})[eq.id] || 0 }))
      .filter(s => s.amt > 0)
      .sort((a, b) => b.amt - a.amt);
    if (spendRows.length) {
      const fmt$ = v => '$' + (Math.round(v * 100) % 100
        ? v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        : Math.round(v).toLocaleString('en-US'));
      const total = spendRows.reduce((a, s) => a + s.amt, 0);
      out.push('· Repair spend this month: ' + fmt$(total));
      spendRows.slice(0, 5).forEach(s => out.push('    ' + s.name + ' — ' + fmt$(s.amt)));
      if (spendRows.length > 5) out.push('    +' + (spendRows.length - 5) + ' more');
    }
    out.push('');

    // Warranty — prompt ONLY when a unit's warranty is within 90 days of
    // expiring (the actionable window). No active/expired roll-up; if nothing
    // is coming due, the email says nothing about warranties.
    const _tw = new Date(); _tw.setHours(0, 0, 0, 0);
    const todayMs = _tw.getTime();
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
  // v292 \u2014 Alfredo: drop the "Since your last email" block; a card that's
  // NEW since the last email just gets a "new" pill inline. `sinceISO` is
  // the start of the unsent-email window (or null \u2192 new-today only). A card
  // created on/after that date shows "(new)".
  const newSince = sinceISO || todayISO();
  if (woGroups.length) {
    out.push(SH('Work orders'));
    woGroups.forEach((g, gi) => {
      // Blank line between lanes so To Do / In Progress / Done today read as
      // distinct blocks instead of one run-on list.
      if (gi > 0) out.push('');
      out.push(g.label + ' (' + g.cards.length + ')');
      g.cards.forEach(c => {
        const pri = (c.priority || 'normal').toLowerCase();
        const tag = '[' + pri.toUpperCase() + '] ';
        // "new" beats "moved" (a fresh card is obviously in its lane). Done
        // lane shows neither. Moves carry their route when recorded.
        const isNew = String(c.created_at || '').slice(0, 10) >= newSince;
        const route = (c.last_move_from && c.last_move_to) ? ': ' + c.last_move_from + ' -> ' + c.last_move_to : '';
        const flag = (g.showMoved && isNew) ? '  (new)'
                   : (g.showMoved && c._movedToday) ? '  (moved today' + route + ')' : '';
        // Parts on order rides as its own trailing marker (becomes a gold
        // PARTS ORDERED pill in the styled email, next to NEW). Not on Done.
        const ordered = (g.showMoved && c.on_order) ? '  (parts ordered)' : '';
        out.push('    ' + tag + (c.title || 'Untitled card') + flag + ordered);
      });
    });
    out.push('');
  }

  // v288 \u2014 Upcoming (30d+): far-future work, noted but kept out of the
  // active To-Do lane. Still surfaced so nothing months-out is forgotten.
  const upc = (slices.upcoming || []).filter(here).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  if (upc.length) {
    out.push(SH('Upcoming', '30d+'));
    upc.forEach(c => {
      const when = c.due_date ? new Date(String(c.due_date).slice(0, 10) + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      out.push('    \u00b7 ' + (c.title || 'Untitled card') + (when ? ' \u2014 due ' + when : ''));
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

function buildLocationEmailBody(loc, dateStr, d, sinceISO) {
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

  // v291 — accumulated board movements ride INSIDE Work Orders now.
  const lines = dlogLocationReportLines(loc, sinceISO);
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
// ── Email each location ──────────────────────────────────────────────
// Full styled batch (v209): one sheet listing every location with its
// saved recipients; per-row Send or one "Send all" — each goes out as the
// SAME styled multipart the ✨ button sends (typesetter + theme + deep
// links). Falls back to the classic open-N-Gmail-drafts flow when the
// styled machinery isn't available on this device.
async function emailEachLocation() {
  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  const dateStr = (log && log.log_date) || (d.header && d.header.date) || todayISO();
  try { Promise.resolve(ensureClippyDailyQuote(d, dateStr)).catch(() => {}); } catch (_) {}
  if (!Array.isArray(d.locations) || !d.locations.length) { if (NX.toast) NX.toast('No locations to email', 'info'); return; }

  // Lexical-NX trap: the composer registers on app.js's `const NX`, not
  // window.NX — check the lexical object FIRST.
  const T = (typeof NX !== 'undefined' && NX && NX.styledGmailSend) ? NX
    : (window.NX && window.NX.styledGmailSend) ? window.NX : null;
  const canStyle = !!(T && T.styledSendState && T.styledSendState() !== 'no-client-id');
  if (!canStyle) { emailEachLocationClassic(d, dateStr); return; }

  let theme = 'light';
  try { theme = localStorage.getItem('nx_styled_email_theme') || 'light'; } catch (_) {}
  const links = dlogBuildEmailLinks();

  // Build the batch: one entry per location with content.
  const rows = [];
  for (const loc of d.locations) {
    const locKey = normLocKey(loc.label);
    // v295 — mirror the single-send paths: mark cards new since the last
    // email for this location (not just new-today).
    const win = await dlogUnsentWindow(locKey, dateStr);
    const body = buildLocationEmailBody(loc, dateStr, d, win ? win.fromDate : null);
    if (!body || body.split('\n').filter(l => l.trim()).length < 2) continue;
    const recip = await T.recallRecipients('dlog:' + locKey).catch(() => null) || {};
    rows.push({
      key: locKey,
      label: loc.label || 'Location',
      subject: 'Daily Log — ' + (loc.label || 'Location') + ' — ' + fmtLogDateLong(dateStr),
      body,
      to: recip.to || '',
      cc: Array.isArray(recip.cc) ? recip.cc : [],
      bcc: Array.isArray(recip.bcc) ? recip.bcc : [],
      status: 'idle',
    });
  }
  if (!rows.length) { if (NX.toast) NX.toast('No location has notes yet', 'info'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'dlog-batch-bg';
  overlay.innerHTML = `
    <div class="dlog-batch">
      <div class="dlog-batch-head">
        <div class="dlog-batch-title">Email each location</div>
        <button type="button" class="dlog-batch-close">Close</button>
      </div>
      <div class="dlog-batch-sub">Each sends the same styled email as the single button — theme: ${esc(theme)}. Recipients are the ones saved per location.</div>
      <div class="dlog-batch-list">
        ${rows.map((r, i) => `
          <div class="dlog-batch-row" data-i="${i}">
            <div class="dlog-batch-main">
              <div class="dlog-batch-loc">${esc(r.label)}</div>
              <div class="dlog-batch-to">${r.to ? esc(r.to) + (r.cc.length ? ' · +' + r.cc.length + ' cc' : '') : '<span class="dlog-batch-none">no saved recipients — tap to set up</span>'}</div>
            </div>
            <span class="dlog-batch-state" data-state="${i}"></span>
            <button type="button" class="dlog-batch-send" data-send="${i}" ${r.to ? '' : 'disabled'}>Send</button>
          </div>`).join('')}
      </div>
      <div class="dlog-batch-foot">
        <button type="button" class="dlog-batch-all">Send all (${rows.filter(r => r.to).length})</button>
      </div>
    </div>`;
  if (!document.getElementById('dlogBatchStyles')) {
    const st = document.createElement('style');
    st.id = 'dlogBatchStyles';
    st.textContent = `
      .dlog-batch-bg{position:fixed;inset:0;z-index:10001;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55)}
      .dlog-batch{width:100%;max-width:560px;max-height:88vh;overflow-y:auto;background:var(--nx-surface-solid,#161d2e);border:1px solid var(--nx-gold-line,rgba(212,164,78,.24));border-bottom:none;border-radius:22px 22px 0 0;padding:16px 18px calc(16px + env(safe-area-inset-bottom))}
      .dlog-batch-head{display:flex;align-items:center;justify-content:space-between}
      .dlog-batch-title{font-family:var(--nx-font-display,'Outfit',sans-serif);font-size:17px;font-weight:700;color:var(--nx-text-strong,#f6f0e2)}
      .dlog-batch-close{background:none;border:1px solid var(--nx-border,rgba(212,164,78,.2));border-radius:999px;color:var(--nx-muted,#9aa3b2);font-size:13px;padding:6px 14px;cursor:pointer}
      .dlog-batch-sub{font-size:12.5px;color:var(--nx-muted,#9aa3b2);margin:6px 0 12px;line-height:1.5}
      .dlog-batch-row{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--nx-border,rgba(212,164,78,.16));border-radius:14px;margin-bottom:8px}
      .dlog-batch-main{flex:1;min-width:0}
      .dlog-batch-loc{font-size:14.5px;font-weight:700;color:var(--nx-text-strong,#f6f0e2)}
      .dlog-batch-to{font-size:12px;color:var(--nx-muted,#9aa3b2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dlog-batch-none{color:var(--nx-gold,#d4a44e)}
      .dlog-batch-state{font-size:12px;color:var(--nx-gold,#d4a44e);flex-shrink:0}
      .dlog-batch-send{flex-shrink:0;border:1px solid var(--nx-gold,#d4a44e);background:transparent;color:var(--nx-gold,#d4a44e);border-radius:999px;font-size:12.5px;font-weight:700;padding:8px 16px;cursor:pointer}
      .dlog-batch-send:disabled{opacity:.4;cursor:default}
      .dlog-batch-foot{padding-top:8px}
      .dlog-batch-all{width:100%;padding:14px;border-radius:14px;border:1px solid var(--nx-gold,#d4a44e);background:var(--nx-gold-faint,rgba(212,164,78,.1));color:var(--nx-gold,#d4a44e);font-size:15px;font-weight:700;cursor:pointer}
      .dlog-batch-all:disabled{opacity:.5;cursor:default}`;
    document.head.appendChild(st);
  }
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.dlog-batch-close').addEventListener('click', () => overlay.remove());

  const setState = (i, txt) => {
    const el = overlay.querySelector(`[data-state="${i}"]`);
    if (el) el.textContent = txt;
  };
  const sendOne = async (i) => {
    const r = rows[i];
    if (!r || !r.to || r.status === 'sent' || r.status === 'sending') return false;
    r.status = 'sending';
    setState(i, 'sending…');
    const btn = overlay.querySelector(`[data-send="${i}"]`);
    if (btn) btn.disabled = true;
    const html = dlogTextToHtml(r.body, { dateStr, locLabel: r.label, theme, links });
    const res = await T.styledGmailSend(r.to, r.cc, r.bcc, r.subject, r.body, html).catch(e => ({ ok: false, err: e && e.message }));
    if (res && res.ok) { r.status = 'sent'; setState(i, '✓ sent'); return true; }
    r.status = 'error';
    setState(i, '✗ ' + String((res && res.err) || 'failed').slice(0, 40));
    if (btn) btn.disabled = false;
    return false;
  };

  overlay.querySelectorAll('[data-send]').forEach(btn => {
    btn.addEventListener('click', () => sendOne(parseInt(btn.dataset.send, 10)));
  });
  // Rows without recipients open the normal styled composer for that
  // location so the addresses get saved once — next batch has them.
  overlay.querySelectorAll('.dlog-batch-row').forEach(rowEl => {
    rowEl.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const r = rows[parseInt(rowEl.dataset.i, 10)];
      if (!r || r.to) return;
      overlay.remove();
      state.activeLoc = r.key;
      openDailyLogStyledEmail();
    });
  });
  overlay.querySelector('.dlog-batch-all').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    let sent = 0, failed = 0;
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].to || rows[i].status === 'sent') continue;
      (await sendOne(i)) ? sent++ : failed++;
    }
    btn.disabled = false;
    btn.textContent = failed ? `Send all — ${sent} sent, ${failed} failed (retry)` : `✓ All sent (${sent})`;
    if (NX.toast) NX.toast(failed ? `${sent} sent · ${failed} failed` : `${sent} location email${sent === 1 ? '' : 's'} sent`, failed ? 'error' : 'success', 5000);
  });
}

// Classic fallback — the original open-N-Gmail-drafts flow, kept for
// devices where the styled machinery isn't available.
function emailEachLocationClassic(d, dateStr) {
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
  if (t) t.textContent = text + ' — Clippy';   // sign rides at the end of the line
  const s = document.getElementById('dlogOpenerSrc');
  if (s) s.textContent = source === 'llm' ? 'Clippy wrote this' : 'from the pool';
}
// "From the pool": swap in a different hand-written line immediately.
function refreshOpenerPool() {
  const dateStr = _openerDateStr();
  const curEl = document.getElementById('dlogOpenerText');
  // Strip the trailing signature before comparing against pool entries, or
  // the "never the same line twice" exclusion would never match.
  const curText = curEl ? curEl.textContent.replace(/\s*— Clippy\s*$/, '') : null;
  const next = dlogRandomPoolQuote(curText);
  _saveDailyQuote(dateStr, next, 'pool');   // lock it so it doesn't churn on reload
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
    _saveDailyQuote(dateStr, text, 'llm');   // his authored line, locked for the day
    _paintOpener(text, 'llm');
    if (window.NX && NX.toast) NX.toast('Fresh opener from Clippy', 'success', 2500);
  } else if (window.NX && NX.toast) {
    NX.toast(dlogDaySummary(d) ? 'No model reachable right now — try “From the pool”' : 'Add some notes first so Clippy has something to riff on', 'info', 4000);
  }
}

// ═══ v282 — ACCUMULATE UNTIL SENT ═══════════════════════════════════════
// Alfredo (2026-07-11): "If I don't send out the daily notes, allow the
// tickets and info to accumulate until it is sent out." The dlog_sends
// ledger stamps every REAL send, per scope ('all' = Overview email;
// 'suerte'/'este'/'toti' = one house's email — sends of 'all' also reset
// the houses). The email window is no longer "today": it is "since the
// last send" (capped at 7 days), and everything unsent rides along —
// each skipped day's notes, plus board tickets closed / born / moved
// since the marker. Gmail-API sends stamp automatically (confirmed
// delivery); classic drafts get a one-tap "sent ✓" chip because NEXUS
// can't see inside Gmail. An empty ledger (first use) = old behavior.

function dlogLocalISO(dt) {
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

async function dlogLastSend(scope) {
  if (!NX.sb) return null;
  const { data, error } = await NX.sb.from('dlog_sends')
    .select('sent_at, covers_to, scope')
    .in('scope', scope === 'all' ? ['all'] : [scope, 'all'])
    .order('sent_at', { ascending: false })
    .limit(1);
  if (error || !data || !data.length) return null;
  return data[0];
}

// The unsent window BEFORE dateStr → {fromDate, days} or null (today only).
async function dlogUnsentWindow(scope, dateStr) {
  try {
    const last = await dlogLastSend(scope);
    if (!last || !last.covers_to) return null;      // never sent → old behavior
    const from = new Date(String(last.covers_to).slice(0, 10) + 'T00:00:00');
    from.setDate(from.getDate() + 1);               // first UNsent day
    const cap = new Date(dateStr + 'T00:00:00');
    cap.setDate(cap.getDate() - 7);                 // reach at most 7 days back
    const start = from < cap ? cap : from;
    const cur = new Date(dateStr + 'T00:00:00');
    if (start >= cur) return null;                  // fully caught up
    return { fromDate: dlogLocalISO(start), days: Math.round((cur - start) / 86400000) };
  } catch (_) { return null; }
}

// v291 — Alfredo reworked this: the separate "Catching up" and "Board
// activity since last send" sections are GONE. Instead, accumulated card
// movements ride INSIDE the Work Orders section, each tagged with relative
// time ("closed 2 days ago", "new 1 day ago", "moved 1 day ago"). This
// returns those movement lines; no header, no per-day note dumps.
function dlogRelDays(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const n = Math.round((today - d) / 86400000);
  if (n <= 0) return 'today';
  if (n === 1) return '1 day ago';
  return n + ' days ago';
}

async function dlogAccumulatedMovements(scopeKey, win, dateStr) {
  if (!win || !NX.sb) return [];
  const clean = s => String(s == null ? '' : s).trim();
  const out = [];
  try {
    const sinceMs = new Date(win.fromDate + 'T00:00:00').getTime();
    const { data: cards, error } = await NX.sb.from('kanban_cards').select('*').limit(500);
    if (error) return [];
    const inScope = c => !c.is_deleted && (scopeKey === 'all' || normLocKey(c.location) === scopeKey);
    const isClosedish = c => /^(done|closed|resolved|complete|completed)$/i.test(String(c.column_name || c.status || ''));
    const closed = [], fresh = [], moved = [];
    (cards || []).forEach(c => {
      if (!inScope(c)) return;
      const closeMs = c.closed_at ? new Date(c.closed_at).getTime() : 0;
      if (closeMs >= sinceMs) {
        if (String(c.closed_at).slice(0, 10) !== dateStr) closed.push(c);   // exclude today (already in Done lane)
        return;
      }
      if (c.archived || c.is_archived || isClosedish(c)) return;
      const crt = c.created_at ? new Date(c.created_at).getTime() : 0;
      const chg = c.last_status_change_at ? new Date(c.last_status_change_at).getTime() : 0;
      if (crt >= sinceMs && String(c.created_at).slice(0, 10) !== dateStr) fresh.push(c);
      else if (chg >= sinceMs && (chg - crt) > 60000 && c.last_move_from && c.last_move_to
               && String(c.last_status_change_at).slice(0, 10) !== dateStr) moved.push(c);
    });
    const loc = c => (scopeKey === 'all' && c.location) ? ' @ ' + c.location : '';
    closed.forEach(c => out.push('closed ' + dlogRelDays(c.closed_at) + ' - ' + clean(c.title) + loc(c)));
    fresh.forEach(c => out.push('new ' + dlogRelDays(c.created_at) + ' - ' + clean(c.title) + loc(c) + (c.priority && c.priority !== 'normal' ? ' [' + c.priority + ']' : '')));
    moved.forEach(c => out.push('moved ' + dlogRelDays(c.last_status_change_at) + ' - ' + clean(c.title) + ' (' + c.last_move_from + ' -> ' + c.last_move_to + ')'));
  } catch (_) {}
  return out;
}

// Stamp a confirmed send; the window resets from here.
async function dlogStampSend(scopeKey, dateStr, win, method) {
  try {
    if (!NX.sb) return;
    const by = (NX.currentUser && NX.currentUser.name) || (NX.user && NX.user.name) || null;
    const { error } = await NX.sb.from('dlog_sends').insert({
      scope: scopeKey, method: method,
      covers_from: win ? win.fromDate : dateStr,
      covers_to: dateStr,
      by_name: by,
    });
    if (error) { console.warn('[daily-log] send stamp:', error.message); return; }
    if (NX.toast) NX.toast('Send recorded — accumulation window reset ✓', 'success', 2600);
    dlogFillAccumBanner();
  } catch (e) { console.warn('[daily-log] send stamp failed:', e); }
}

// Classic drafts hand off to Gmail, where NEXUS can't see the Send button —
// so a quiet chip asks for one honest tap. Untapped = keeps accumulating,
// which is the safe direction (nothing is ever falsely marked delivered).
function dlogOfferSentConfirm(scopeKey, dateStr, win) {
  document.querySelectorAll('.dlog-sent-chip').forEach(n => n.remove());
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'dlog-sent-chip';
  chip.textContent = 'Draft opened in Gmail — tap here once it’s sent ✓';
  chip.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;'
    + 'padding:10px 18px;border-radius:22px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;'
    + 'background:var(--card,#1c2333);color:var(--text,#efe9dc);border:1px solid var(--accent,#d4a44e);box-shadow:0 4px 18px rgba(0,0,0,.4)';
  chip.addEventListener('click', () => { chip.remove(); dlogStampSend(scopeKey, dateStr, win, 'draft-confirmed'); });
  document.body.appendChild(chip);
  setTimeout(() => { try { chip.remove(); } catch (_) {} }, 120000);
}

// Clock-sanity: the auto-send safety net (wireDlogLifecycle) fires on the
// DEVICE clock — new Date() hours/minutes vs the cutoff time — so if the tablet's
// clock is wrong, the day's log sends at the wrong hour or (if the clock reads
// before the cutoff forever) never sends at all. We can't trust the device to
// self-diagnose, so ask Supabase: a REST response carries a `Date` header
// (server UTC). Compute the skew once; if it's large, warn near the auto-send
// toggle. WARN ONLY — never auto-correct, never touch send behavior. If the
// server clock is unavailable (header not exposed / offline), we silently skip.
let _dlogClockChecked = false;
async function dlogCheckClockSkew() {
  if (_dlogClockChecked) return;
  _dlogClockChecked = true;
  let serverMs = null;
  try {
    const cfg = window.NEXUS_CONFIG || {};
    const base = (cfg.SUPABASE_URL || 'https://oprsthfxqrdbwdvommpw.supabase.co').replace(/\/$/, '');
    const t0 = Date.now();
    // HEAD /rest/v1/ — cheap; any HTTP response includes a Date header. The
    // apikey keeps it a clean authorized hit (no CORS/401 noise).
    const res = await fetch(base + '/rest/v1/', {
      method: 'HEAD',
      headers: cfg.SUPABASE_ANON ? { apikey: cfg.SUPABASE_ANON } : {},
      cache: 'no-store',
    });
    const t1 = Date.now();
    const hdr = res && res.headers && res.headers.get('date');
    if (hdr) {
      const parsed = Date.parse(hdr);
      // Add back half the round-trip so we compare the server instant to the
      // device instant at the same moment (not skewed by network latency).
      if (!isNaN(parsed)) serverMs = parsed + Math.round((t1 - t0) / 2);
    }
  } catch (_) { /* offline / header not exposed — skip silently */ }
  if (serverMs == null) return;          // couldn't read a server clock — no warning
  const skewMin = Math.round((Date.now() - serverMs) / 60000);
  if (Math.abs(skewMin) <= 10) return;   // within tolerance — nothing to warn about
  const el = document.getElementById('dlogClockBanner');
  if (!el) return;
  const dir = skewMin > 0 ? 'ahead of' : 'behind';
  el.innerHTML = '';
  const msg = document.createElement('span');
  msg.textContent = '⚠ This device’s clock looks off — about '
    + Math.abs(skewMin) + ' min ' + dir + ' the server. Auto-send uses this clock, '
    + 'so it may send at the wrong time. Check the device date & time.';
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '×';
  x.setAttribute('aria-label', 'Dismiss');
  x.style.cssText = 'margin-left:8px;background:none;border:none;color:inherit;font-size:14px;line-height:1;cursor:pointer;padding:0 2px;';
  x.addEventListener('click', () => { el.style.display = 'none'; });
  el.appendChild(msg);
  el.appendChild(x);
  el.style.display = '';
}

// The quiet banner on the Daily Log: what the next email will carry.
async function dlogFillAccumBanner() {
  const el = document.getElementById('dlogAccumBanner');
  if (!el) return;
  const scopeKey = (state.activeLoc && state.activeLoc !== 'all') ? state.activeLoc : 'all';
  const dateStr = (state.currentLog && state.currentLog.log_date) || todayISO();
  const win = await dlogUnsentWindow(scopeKey, dateStr);
  if (!win) { el.style.display = 'none'; el.textContent = ''; return; }
  const from = new Date(win.fromDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  el.textContent = 'Carrying ' + win.days + ' unsent day' + (win.days === 1 ? '' : 's') + ' (since ' + from + ') — the next email includes them';
  el.style.display = '';
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
  // v282 \u2014 "since last send" window + everything unsent rides this email.
  const scopeKey = (locKey && locKey !== 'all') ? locKey : 'all';
  const win = await dlogUnsentWindow(scopeKey, dateStr);
  // v292 \u2014 new-since-last-email window start (drives the inline "new" pill).
  const sinceISO = win ? win.fromDate : null;
  const subjTail = win
    ? ' (+' + win.days + ' unsent day' + (win.days === 1 ? '' : 's') + ')'
    : '';
  if (locKey && locKey !== 'all') {
    const loc = (d.locations || []).find(l => normLocKey(l.label) === locKey);
    if (!loc) {
      if (window.NX && NX.alert) await NX.alert('That location has no notes yet.', { title: 'Nothing to send' });
      return;
    }
    const locLabel = (loc && loc.label) || (locKey.charAt(0).toUpperCase() + locKey.slice(1));
    subject = 'Daily Log \u2014 ' + locLabel + ' \u2014 ' + fmtLogDateLong(dateStr) + subjTail;
    body = buildLocationEmailBody(loc, dateStr, d, sinceISO);
    recipientsKey = 'dlog:' + locKey;
    title = 'Email \u2014 ' + locLabel;
  } else {
    subject = 'Daily Log \u2014 ' + fmtLogDateLong(dateStr) + subjTail;
    body = buildDailyLogEmailBody(d, dateStr, sinceISO);
    recipientsKey = 'dlog:all';
    title = 'Email daily log';
  }

  if (!body || body.split('\n').filter(l => l.trim()).length < 2) {
    if (window.NX && NX.alert) await NX.alert('This log is empty \u2014 add some notes first.', { title: 'Nothing to send' });
    return;
  }

  // Open the full composer (editable To/CC/BCC + body), exactly like ordering.
  // Each location remembers its own recipients between sends.
  // v282 \u2014 onSend: a Gmail-API delivery stamps the ledger itself; a classic
  // draft gets the one-tap "sent \u2713" chip (NEXUS can't see Gmail's Send).
  const onSend = (p) => {
    if (p && p.method === 'gmail-api') dlogStampSend(scopeKey, dateStr, win, 'gmail-api');
    else dlogOfferSentConfirm(scopeKey, dateStr, win);
  };
  if (window.NX && typeof NX.composeEmail === 'function') {
    NX.composeEmail({ recipientsKey, subject, body, title, onSend });
    return;
  }
  // Fallback if the composer module isn't loaded: a plain mail draft.
  const url = (window.NX && NX.email && NX.email.buildMailtoUrl)
    ? NX.email.buildMailtoUrl('', subject, body)
    : 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body).replace(/\+/g, '%20');
  window.location.href = url;
}

// ── STYLED HTML EMAIL ──────────────────────────────────────────────────────
// The styled email is a pure RENDERING of the original plain-text email
// (Alfredo: "use the original email for all the information and just make it
// beautiful"). dlogTextToHtml() typesets the exact text the plain builders
// emit; the two can never disagree.
//
// v195 — visual layer rebuilt on email-design standards after the first
// delivered sends "looked pretty bad":
//   · full HTML document with color-scheme metas + hidden preheader
//     (we SEND via the Gmail API, so we own the whole document)
//   · dark-mode palette via <style> @media overrides on classes (inline
//     styles stay as the light-mode base for clients that strip <style>)
//   · wide-tracked mono ALL-CAPS only on short eyebrow labels — the date/
//     weather lines are normal-case sans now (the caps+tracking wrapped
//     into a 3-line mess on phones)
//   · 15–16px body, 1.5–1.6 line-height, whitespace rhythm instead of a
//     hairline border under every row
// THE URGENCY LADDER (Alfredo's rule: no reds, no greens — not NEXUS).
// Severity is FILL WEIGHT within the brand palette, one hue family:
//   down/urgent  → solid ink pill (heaviest thing on the page)
//   overdue      → solid gold pill
//   due/attention→ hollow gold pill (outline only)
//   done         → sand pill with a ✓ (the check carries the meaning)
//   info         → sand pill
const DLOG_HTML = {
  cream: '#efe5cf', card: '#fffdf7', ink: '#2c2519', muted: '#6e6250',
  gold: '#96691f', goldSoft: '#d4a44e', line: '#e5d9bc',
  downBg: '#2c2519', downTx: '#f6eedb',
  odBg: '#d4a44e', odTx: '#2c2519',
  dueBd: '#b98a3a', dueTx: '#96691f',
  mutedBg: '#efe7d3',
  clipBg: '#f8f1e0', clipLine: '#e5d9bc',
  serif: "'Outfit', 'DM Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Courier New', monospace",
  sans: "'DM Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

// Designed dark palette (not an inversion) — picked per send in the composer.
// The ladder flips its heaviest step: on dark, "down" is a solid CREAM pill
// (lightest = loudest on a dark page).
const DLOG_HTML_DARK = {
  cream: '#1d1913', card: '#292319', ink: '#ede5d3', muted: '#b3a78e',
  gold: '#d4a44e', goldSoft: '#d4a44e', line: '#3a3323',
  downBg: '#f0e6d0', downTx: '#201c15',
  odBg: '#d4a44e', odTx: '#201c15',
  dueBd: '#a17c34', dueTx: '#d4a44e',
  mutedBg: '#332d1f',
  clipBg: '#312a1b', clipLine: '#453b26',
  serif: DLOG_HTML.serif, mono: DLOG_HTML.mono, sans: DLOG_HTML.sans,
};
// Palette in effect for the current render (set by dlogTextToHtml).
let DLOG_ACTIVE = DLOG_HTML;

// Severity for a [TAG] label — drives the ladder step.
function dlogTagSeverity(k) {
  if (/^(DOWN|BROKEN|URGENT|CRITICAL|NOT OPERATIONAL|MISSED)$/.test(k)) return 'down';
  if (k === 'OVERDUE') return 'od';
  if (/^(DUE|NEEDS SERVICE|HIGH|PRIORITY)$/.test(k)) return 'due';
  if (/^(DONE|REPAIRED|CLOSED|RESOLVED)$/.test(k)) return 'done';
  return 'info';
}

function dlogHtmlTag(kind, P) {
  const C = P || DLOG_ACTIVE;
  const k = String(kind || '').toUpperCase();
  const sev = dlogTagSeverity(k);
  const base = `display:inline-block;border-radius:6px;font-family:${C.sans};font-size:10.5px;font-weight:bold;letter-spacing:.04em;`;
  if (sev === 'down') return `<span class="nx-pill nx-p-down" style="${base}padding:2px 8px;background:${C.downBg};color:${C.downTx};">${esc(k)}</span>`;
  if (sev === 'od')   return `<span class="nx-pill nx-p-od" style="${base}padding:2px 8px;background:${C.odBg};color:${C.odTx};">${esc(k)}</span>`;
  if (sev === 'due')  return `<span class="nx-pill nx-p-due" style="${base}padding:1px 7px;background:transparent;border:1.5px solid ${C.dueBd};color:${C.dueTx};">${esc(k)}</span>`;
  if (sev === 'done') return `<span class="nx-pill nx-p-info" style="${base}padding:2px 8px;background:${C.mutedBg};color:${C.muted};">✓ ${esc(k)}</span>`;
  return `<span class="nx-pill nx-p-info" style="${base}padding:2px 8px;background:${C.mutedBg};color:${C.muted};">${esc(k)}</span>`;
}

// Chip for "At a glance" fragments — tone inferred from the words, same
// ladder as the tags.
function dlogHtmlChip(text, P) {
  const C = P || DLOG_ACTIVE;
  const t = String(text || '').trim();
  const base = `display:inline-block;padding:4px 12px;margin:0 6px 8px 0;border-radius:999px;font-family:${C.sans};font-size:12px;font-weight:bold;`;
  if (/down|urgent|missed/i.test(t)) return `<span class="nx-pill nx-p-down" style="${base}background:${C.downBg};color:${C.downTx};">${esc(t)}</span>`;
  if (/overdue/i.test(t)) return `<span class="nx-pill nx-p-od" style="${base}background:${C.odBg};color:${C.odTx};">${esc(t)}</span>`;
  return `<span class="nx-pill nx-p-info" style="${base}background:${C.mutedBg};color:${C.muted};">${esc(t)}</span>`;
}

// Weather condition → emoji for the masthead row. Order matters: "partly
// cloudy" must win over "cloudy", storms over rain.
function dlogWeatherIcon(s) {
  const t = String(s || '').toLowerCase();
  if (/thunder|storm/.test(t)) return '';
  if (/snow|sleet|ice pellet|freez/.test(t)) return '';
  if (/rain|shower|drizzle/.test(t)) return '';
  if (/fog|mist|haze/.test(t)) return '';
  if (/partly/.test(t)) return '';
  if (/cloud|overcast/.test(t)) return '';
  if (/sunny|clear/.test(t)) return '';
  return '';
}

// ── The typesetter ─────────────────────────────────────────────────────────
// Parses the exact line grammar the plain-text builders emit (BOTH header
// styles — box-drawing "───" and the ASCII "--- LABEL ---" fallback real
// devices produce):
//   section headers, closing rule → signature, "At a glance" → chips,
//   "· bullet — detail", "    [TAG] name — detail", "    key: value",
//   "Key: value" paragraphs, "<quote> — Clippy" opener.
function dlogTextToHtml(text, meta) {
  meta = meta || {};
  // Theme: 'light' (default), 'dark' (designed dark palette), or 'auto'
  // (light base + a dark @media override for clients that honor it).
  const theme = meta.theme === 'dark' ? 'dark' : meta.theme === 'auto' ? 'auto' : 'light';
  DLOG_ACTIVE = theme === 'dark' ? DLOG_HTML_DARK : DLOG_HTML;
  const C = DLOG_ACTIVE;
  // Deep links (meta.links: [{name, url}]) — row heads that match a name
  // become doors into NEXUS, decorated with a quiet › arrow. HTML-only:
  // the plain text stays byte-identical (the one-pipeline law).
  const LINKS = {};
  (meta.links || []).forEach(l => {
    if (l && l.name && l.url) LINKS[String(l.name).trim().toLowerCase()] = l.url;
  });
  const linkFor = (head) => LINKS[String(head || '').trim().toLowerCase()] || null;
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const SEC_RE = /^─── (.+?) ─+(.*)$/;
  const SEC_ASCII_RE = /^--- (.+?) ---\s*(.*)$/;
  const RULE_RE = /^[─-]{6,}$/;

  // Split into: preamble (greeting), sections, signature.
  const pre = [];
  const sections = [];
  const sig = [];
  let cur = null, inSig = false;
  for (const raw of lines) {
    const line = raw;
    if (inSig) { sig.push(line); continue; }
    const sm = line.match(SEC_RE) || line.match(SEC_ASCII_RE);
    if (sm) { cur = { label: sm[1].trim(), suffix: (sm[2] || '').trim(), lines: [] }; sections.push(cur); continue; }
    if (RULE_RE.test(line.trim())) { inSig = true; continue; }
    if (cur) cur.lines.push(line); else pre.push(line);
  }

  // Weather rides in the masthead (first line only); anything else in that
  // section (per-location emails put "At a glance" there) renders as content.
  let weatherLine = '';
  let preExtra = [];
  const weatherIdx = sections.findIndex(s => /^weather$/i.test(s.label));
  if (weatherIdx !== -1) {
    const wl = sections[weatherIdx].lines.filter(l => l.trim());
    weatherLine = (wl.shift() || '').trim();
    preExtra = wl;
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

  const sub = (s) => `<div class="nx-muted" style="font-family:${C.sans};font-size:13.5px;line-height:1.55;color:${C.muted};margin:2px 0 2px 2px;">${esc(s)}</div>`;
  const prose = (s) => {
    const kv = s.match(/^([A-Za-z][A-Za-z /&'()-]{1,28}):\s+(.*)$/);
    if (kv) return `<div class="nx-ink" style="font-family:${C.sans};font-size:14.5px;line-height:1.6;color:${C.ink};margin:0 0 9px;"><strong>${esc(kv[1])}:</strong> ${esc(kv[2])}</div>`;
    return `<div class="nx-ink" style="font-family:${C.sans};font-size:14.5px;line-height:1.6;color:${C.ink};margin:0 0 9px;">${esc(s)}</div>`;
  };

  function renderLine(raw) {
    if (!raw.trim()) return '';   // blank marker — collapsed later
    const indented = /^ {3,}/.test(raw);
    const s = raw.trim();

    const atG = s.match(/^At a glance:\s*(.+)$/i);
    if (atG) return `<div style="margin:2px 0 8px;">${atG[1].split(' · ').map(t => dlogHtmlChip(t)).join('')}</div>`;

    // Work-order lane headers: "To Do (4)" / "In Progress (2)" / "Done today (1)"
    const lane = s.match(/^(To Do|In Progress|Done today) \((\d+)\)$/);
    if (lane) return `<div class="nx-eyebrow" style="font-family:${C.sans};font-size:11.5px;font-weight:bold;letter-spacing:.07em;text-transform:uppercase;color:${C.gold};margin:18px 0 6px;">${esc(lane[1])} <span class="nx-muted" style="color:${C.muted};letter-spacing:0;">· ${esc(lane[2])}</span></div>`;

    // "[TAG] name — detail" — pill in a fixed top-aligned cell, text beside
    // it, so long names wrap under themselves. The head/detail split happens
    // at the first segment that READS like a detail, not the first dash
    // (names can contain " — ": "Hood — Main Line").
    const tag = s.replace(/^· /, '').match(/^\[([A-Z][A-Z /_-]*)\]\s*(.*)$/);
    if (tag) {
      let rest2 = tag[2];
      let movedNote = '';
      let isNewToday = false;
      let isOrdered = false;
      // Markers can stack ("Title  (new today)  (parts ordered)") — peel
      // them off the tail one at a time.
      let mv;
      while ((mv = rest2.match(/\s*\((new today|new|moved today[^)]*|parts ordered)\)\s*$/))) {
        if (mv[1] === 'new today' || mv[1] === 'new') isNewToday = true;
        else if (mv[1] === 'parts ordered') isOrdered = true;
        else movedNote = mv[1];
        rest2 = rest2.slice(0, mv.index);
      }
      const segs = rest2.split(' — ');
      let cut = segs.length;
      for (let i = 1; i < segs.length; i++) {
        if (/^(was due|due |in \d|call |confirmed|\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(segs[i])) { cut = i; break; }
      }
      if (cut === segs.length && segs.length > 1) cut = 1;
      const head = segs.slice(0, cut).join(' — ');
      let tail = [segs.slice(cut).join(' — '), movedNote].filter(Boolean).join(' · ');
      // A 📝 status note (set from the PM screen) gets its own gold line —
      // the explanation is the good news; the due-text above it stays muted
      // and honest.
      let noteTail = '';
      const noteIx = tail.indexOf('note:');
      if (noteIx !== -1) {
        noteTail = tail.slice(noteIx).trim();
        tail = tail.slice(0, noteIx).replace(/[\s—·]+$/, '').trim();
      }
      // "confirmed schedule" is good news — it reads in GOLD, not green
      // (the ladder has no green; gold + ✓-style copy carry the meaning).
      const good = /confirmed schedule/i.test(tail);
      const href = linkFor(head);
      const headHtml = href
        ? `<a href="${esc(href)}" style="color:inherit;text-decoration:none;"><span class="nx-ink" style="font-family:${C.sans};font-size:15px;font-weight:bold;color:${C.ink};line-height:1.45;">${esc(head)}</span></a>`
        : `<span class="nx-ink" style="font-family:${C.sans};font-size:15px;font-weight:bold;color:${C.ink};line-height:1.45;">${esc(head)}</span>`;
      // "NEW" / "PARTS ORDERED" ride as quiet hollow-gold labels on the RIGHT
      // of the row (Alfredo: "a new label to the right of the ticket"; then
      // "inside the daily notes it should have new card and parts ordered").
      const rightPill = (txt) =>
        `<td style="width:1%;white-space:nowrap;vertical-align:middle;padding-left:8px;"><span class="nx-pill nx-p-due" style="display:inline-block;padding:1px 6px;border:1.5px solid ${C.dueBd};border-radius:6px;font-family:${C.sans};font-size:9.5px;font-weight:bold;letter-spacing:.06em;color:${C.dueTx};">${txt}</span></td>`;
      const newPill = (isNewToday ? rightPill('NEW') : '') + (isOrdered ? rightPill('PARTS ORDERED') : '');
      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:1%;white-space:nowrap;vertical-align:top;padding:6px 9px 6px 0;">${dlogHtmlTag(tag[1])}</td>
          <td style="vertical-align:top;padding:6px 0;">
            ${headHtml}
            ${tail ? `<div class="${good ? 'nx-eyebrow' : 'nx-muted'}" style="font-family:${C.sans};font-size:13.5px;line-height:1.55;color:${good ? C.gold : C.muted};margin-top:2px;">${esc(tail)}</div>` : ''}
            ${noteTail ? `<div class="nx-eyebrow" style="font-family:${C.sans};font-size:13.5px;line-height:1.55;color:${C.gold};margin-top:2px;">${esc(noteTail)}</div>` : ''}
          </td>
          ${newPill}
          ${href ? `<td style="width:14px;vertical-align:middle;padding-left:6px;"><a href="${esc(href)}" style="font-family:${C.sans};font-size:17px;font-weight:bold;color:${C.goldSoft};text-decoration:none;">›</a></td>` : ''}
        </tr></table>`;
    }

    if (/^· /.test(s)) {
      const rest = s.slice(2);
      const i = rest.indexOf(' — ');
      const head = i === -1 ? rest : rest.slice(0, i);
      const tail = i === -1 ? '' : rest.slice(i + 3);
      const href = linkFor(head);
      const headHtml = href
        ? `<a href="${esc(href)}" style="color:inherit;text-decoration:none;"><span class="nx-ink" style="font-family:${C.sans};font-size:15px;font-weight:bold;color:${C.ink};line-height:1.45;">${esc(head)}</span></a>`
        : `<span class="nx-ink" style="font-family:${C.sans};font-size:15px;font-weight:bold;color:${C.ink};line-height:1.45;">${esc(head)}</span>`;
      const inner = `
          ${headHtml}
          ${tail ? `<div class="nx-muted" style="font-family:${C.sans};font-size:13.5px;line-height:1.55;color:${C.muted};margin-top:2px;">${esc(tail)}</div>` : ''}`;
      if (href) return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;padding:6px 0;">${inner}</td>
          <td style="width:14px;vertical-align:middle;padding-left:6px;"><a href="${esc(href)}" style="font-family:${C.sans};font-size:17px;font-weight:bold;color:${C.goldSoft};text-decoration:none;">›</a></td>
        </tr></table>`;
      return `
        <div style="padding:6px 0;">${inner}
        </div>`;
    }

    if (indented) {
      const wc = s.match(/^(why|call):\s*(.*)$/i);
      if (wc) return `<div class="nx-muted" style="font-family:${C.sans};font-size:13.5px;line-height:1.55;color:${C.muted};font-style:italic;margin:0 0 6px 2px;">${esc(wc[1].toLowerCase() === 'why' ? wc[2] : 'Call: ' + wc[2])}</div>`;
      const kv = s.match(/^([A-Za-z][A-Za-z ]{0,18}):\s+(.*)$/);
      if (kv) return `<div class="nx-muted" style="font-family:${C.sans};font-size:13.5px;line-height:1.55;color:${C.muted};margin:0 0 6px 2px;"><strong class="nx-ink" style="color:${C.ink};">${esc(kv[1])}:</strong> ${esc(kv[2])}</div>`;
      return sub(s);
    }

    return prose(s);
  }

  // Collapse runs of blank markers into ONE small gap (the plain text uses
  // blank lines liberally; stacking 6px divs made ragged holes).
  function renderLines(ls) {
    const parts = ls.map(renderLine);
    const out = [];
    let blank = false;
    for (const p of parts) {
      if (p === '') { blank = true; continue; }
      if (blank && out.length) out.push('<div style="height:10px;"></div>');
      blank = false;
      out.push(p);
    }
    return out.join('');
  }

  // Signature: keep the sender's name; our footer supplies the brand line.
  const sigName = sig.map(l => l.trim()).filter(l => l && !/^powered by nexus$/i.test(l)).join('<br>');
  const dateLine = meta.dateStr ? fmtLogDateLong(meta.dateStr) : '';
  // Preheader = inbox preview text (hidden in the body). Clippy's line is
  // the best hook; weather as fallback.
  const preheader = (clippyQuote || weatherLine || 'Daily operations report').slice(0, 140);

  // ── Modular assembly ──────────────────────────────────────────────────
  // Each section is its OWN card on the cream page, separated by real
  // whitespace (the modular-block pattern transactional emails use) —
  // one continuous card with inline headers read as one messy run-on.
  const GAP = '<tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>';
  const cardModule = (inner, opts) => {
    opts = opts || {};
    const bg = opts.clip ? C.clipBg : opts.soft ? C.mutedBg : C.card;
    const border = opts.clip ? `1px solid ${C.clipLine}` : opts.soft ? 'none' : `1px solid ${C.line}`;
    const cls = opts.clip ? 'nx-clip' : opts.soft ? 'nx-panel' : 'nx-card';
    return `
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="${cls}" style="background:${bg};border:${border};border-radius:16px;">
        <tr><td class="nx-pad" style="padding:${opts.pad || '18px 22px'};">${inner}</td></tr>
      </table>
    </td></tr>`;
  };

  const modules = [];

  // Masthead — a card like the others (Alfredo: light theme stays LIGHT,
  // no dark brown block), carrying the title, date, gold bar, an iconed
  // two-row weather line over a hairline, and the at-a-glance chips.
  let weatherHtml = '';
  if (weatherLine) {
    const parts = weatherLine.split(' · ');
    const row1 = parts.slice(0, 2).join(' · ');
    const row2 = parts.slice(2).join(' · ');
    weatherHtml = `
      <div class="nx-eyebrow" style="border-top:1px solid ${C.line};margin-top:16px;font-size:0;line-height:0;">&nbsp;</div>
      <div class="nx-ink" style="font-family:${C.sans};font-size:14.5px;line-height:1.5;color:${C.ink};margin-top:10px;">${dlogWeatherIcon(row1)}&nbsp; ${esc(row1)}</div>
      ${row2 ? `<div class="nx-muted" style="font-family:${C.sans};font-size:13px;line-height:1.5;color:${C.muted};margin-top:3px;">${esc(row2)}</div>` : ''}`;
  }
  const chipsHtml = renderLines(preExtra);
  modules.push(cardModule(`
      <div class="nx-ink" style="font-family:${C.serif};font-size:23px;font-weight:800;color:${C.ink};letter-spacing:-.02em;line-height:1.2;">Daily Log${meta.locLabel ? ` <span class="nx-eyebrow" style="color:${C.gold};">· ${esc(meta.locLabel)}</span>` : ''}</div>
      <div class="nx-muted" style="font-family:${C.sans};font-size:13.5px;color:${C.muted};margin-top:6px;line-height:1.5;">${esc(dateLine)}</div>
      <div style="border-top:3px solid ${C.goldSoft};border-radius:3px;margin-top:14px;width:46px;font-size:0;line-height:0;">&nbsp;</div>
      ${weatherHtml}
      ${chipsHtml ? `<div style="margin-top:16px;">${chipsHtml}</div>` : ''}`,
    { pad: '26px 26px 22px' }));

  // Clippy — a soft interlude module of his own, with the real character as
  // the avatar (assets/clippy-email.png v3: face, blush, AND the orbit nodes,
  // baked from clippy.svg). Served from the site — email clients won't render
  // SVG, and Gmail's image proxy shows hosted PNGs by default.
  if (clippyQuote) {
    modules.push(GAP + cardModule(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="width:72px;vertical-align:top;padding-right:12px;">
          <img src="https://orioncontinuity.github.io/nexus/assets/clippy-email.png?v=3" width="60" height="60" alt="Clippy" style="display:block;width:60px;height:60px;border:0;">
        </td>
        <td style="vertical-align:top;">
          <div class="nx-ink" style="font-family:${C.sans};font-size:14.5px;line-height:1.6;color:${C.ink};font-style:italic;">${esc(clippyQuote)}</div>
          <div class="nx-muted" style="font-family:${C.sans};font-size:12.5px;color:${C.muted};margin-top:6px;">— Clippy</div>
        </td>
      </tr></table>`,
    { clip: true, pad: '16px 20px' }));
  }

  if (preProse.length) {
    modules.push(GAP + cardModule(preProse.map(prose).join('')));
  }

  // One card per section — a ruled header zone (eyebrow over a hairline),
  // then the content. The rule is what makes each card read as designed
  // rather than as a floating list.
  sections.forEach(sec => {
    const inner = renderLines(sec.lines);
    if (!inner.trim()) return;
    // Item count in the eyebrow — bullets and [TAG] rows, not prose.
    const itemCount = sec.lines.filter(l => /^\s*(·\s|\[[A-Z])/.test(l)).length;
    const eyebrowMeta = [sec.suffix, itemCount ? String(itemCount) : '']
      .filter(Boolean).join(' · ');
    modules.push(GAP + cardModule(`
      <div class="nx-eyebrow" style="font-family:${C.sans};font-size:11.5px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:${C.gold};padding-bottom:10px;border-bottom:1px solid ${C.line};margin-bottom:14px;">${esc(sec.label)}${eyebrowMeta ? ` <span class="nx-muted" style="color:${C.muted};letter-spacing:0;">· ${esc(eyebrowMeta)}</span>` : ''}</div>
      ${inner}`,
    { pad: '20px 24px 18px' }));
  });

  // Footer — plain quiet text on the page, outside any card, with one
  // quiet door into the app itself.
  const footer = `
    <tr><td style="padding:22px 8px 4px;">
      <div class="nx-muted" style="font-family:${C.sans};font-size:12.5px;line-height:1.6;color:${C.muted};text-align:center;">
        ${sigName ? sigName + '<br>' : ''}<a href="https://orioncontinuity.github.io/nexus/" style="color:${C.gold};text-decoration:none;font-weight:bold;">Open NEXUS →</a><br>
        <span style="font-family:${C.mono};font-size:10px;letter-spacing:.16em;">POWERED BY NEXUS</span>
      </div>
    </td></tr>`;

  const body = `
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="nx-bg" style="background:${C.cream};margin:0;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
    ${modules.join('')}
    ${footer}
  </table>
</td></tr>
</table>`;

  // Full document — we deliver via the Gmail API, so we own the <head>:
  // color-scheme metas temper aggressive dark-mode inversion, and the
  // @media block restyles our classes for clients that honor it (inline
  // styles remain the light-mode base everywhere else). The masthead is a
  // regular card, so the same class overrides carry it.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${theme === 'auto' ? 'light dark' : theme === 'dark' ? 'dark' : 'light only'}">
<meta name="supported-color-schemes" content="${theme === 'auto' ? 'light dark' : theme === 'dark' ? 'dark' : 'light only'}">
<style>
  /* Theme picked in the composer (light default). 'auto' adds a dark
     override for clients that honor prefers-color-scheme; 'light'/'dark'
     pin one designed palette and tell clients not to invert. */
  ${theme === 'auto' ? `@media (prefers-color-scheme: dark) {
    .nx-bg      { background: #1d1913 !important; }
    .nx-card    { background: #292319 !important; border-color: #3a3323 !important; }
    .nx-clip    { background: #312a1b !important; border-color: #453b26 !important; }
    .nx-panel   { background: #332d1f !important; }
    .nx-ink     { color: #ede5d3 !important; }
    .nx-muted   { color: #b3a78e !important; }
    .nx-eyebrow { color: #d4a44e !important; border-color: #3a3323 !important; }
    .nx-p-down  { background: #f0e6d0 !important; color: #201c15 !important; }
    .nx-p-od    { background: #d4a44e !important; color: #201c15 !important; }
    .nx-p-due   { border-color: #a17c34 !important; color: #d4a44e !important; }
    .nx-p-info  { background: #332d1f !important; color: #b3a78e !important; }
  }` : ''}
  @media only screen and (max-width: 480px) {
    .nx-pad { padding-left: 18px !important; padding-right: 18px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.cream};">
${body}
</body>
</html>`;
}

// Deep-link map for the styled email — every row head that names a real
// thing (equipment, board card) gets a ?go= URL into NEXUS. Built from the
// live state the plain builders already used, matched by NAME in the
// typesetter, so the plain text needs no markers. Equipment first: it's
// the canonical name owner if a card title happens to collide.
const DLOG_SITE_URL = 'https://orioncontinuity.github.io/nexus/';
function dlogBuildEmailLinks() {
  const links = [];
  const seen = new Set();
  const add = (name, url) => {
    const k = String(name || '').trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    links.push({ name: String(name).trim(), url });
  };
  (state.equipmentHealth || []).forEach(eq => { if (eq && eq.id && eq.name) add(eq.name, DLOG_SITE_URL + '?go=eq:' + eq.id); });
  (state.equipmentDown || []).forEach(eq => { if (eq && eq.id && eq.name) add(eq.name, DLOG_SITE_URL + '?go=eq:' + eq.id); });
  (state.pmsToday || []).forEach(p => {
    const n = p && p.equipment && p.equipment.name;
    if (n && p.equipment_id) add(n, DLOG_SITE_URL + '?go=eq:' + p.equipment_id);
  });
  const sl = state.ticketSlices || {};
  ['open', 'working', 'closed'].forEach(b => (sl[b] || []).forEach(c => {
    if (c && c.id != null && c.title) add(c.title, DLOG_SITE_URL + '?go=card:' + c.id);
  }));
  return links;
}

// Styled email — the ORIGINAL email flow end to end: same body builders,
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
  // v282 — same "since last send" accumulation as the plain email.
  const scopeKey = (locKey && locKey !== 'all') ? locKey : 'all';
  const win = await dlogUnsentWindow(scopeKey, dateStr);
  const sinceISO = win ? win.fromDate : null;
  const subjTail = win
    ? ' (+' + win.days + ' unsent day' + (win.days === 1 ? '' : 's') + ')'
    : '';
  if (locKey && locKey !== 'all') {
    const loc = (d.locations || []).find(l => normLocKey(l.label) === locKey);
    if (!loc) {
      if (window.NX && NX.alert) await NX.alert('That location has no notes yet.', { title: 'Nothing to send' });
      return;
    }
    locLabel = (loc && loc.label) || (locKey.charAt(0).toUpperCase() + locKey.slice(1));
    subject = 'Daily Log — ' + locLabel + ' — ' + fmtLogDateLong(dateStr) + subjTail;
    body = buildLocationEmailBody(loc, dateStr, d, sinceISO);
    recipientsKey = 'dlog:' + locKey;
    title = 'Styled — ' + locLabel;
  } else {
    subject = 'Daily Log — ' + fmtLogDateLong(dateStr) + subjTail;
    body = buildDailyLogEmailBody(d, dateStr, sinceISO);
    recipientsKey = 'dlog:all';
    title = 'Styled daily log';
  }

  if (!body || body.split('\n').filter(l => l.trim()).length < 2) {
    if (window.NX && NX.alert) await NX.alert('This log is empty — add some notes first.', { title: 'Nothing to send' });
    return;
  }

  if (window.NX && typeof NX.composeEmail === 'function') {
    let theme = 'light';
    try { theme = localStorage.getItem('nx_styled_email_theme') || 'light'; } catch (_) {}
    const links = dlogBuildEmailLinks();
    // v282 — stamp the ledger on confirmed Gmail-API delivery; chip for drafts.
    const onSend = (p) => {
      if (p && p.method === 'gmail-api') dlogStampSend(scopeKey, dateStr, win, 'gmail-api');
      else dlogOfferSentConfirm(scopeKey, dateStr, win);
    };
    NX.composeEmail({
      recipientsKey, subject, body, title, onSend,
      htmlVariants: [
        { key: 'light', label: 'Light' },
        { key: 'dark', label: 'Dark' },
        { key: 'auto', label: 'Auto (reader)' },
      ],
      htmlVariant: theme,
      onVariant: (k) => { try { localStorage.setItem('nx_styled_email_theme', k); } catch (_) {} },
      htmlRender: (bodyText, variant) => dlogTextToHtml(bodyText, { dateStr, locLabel, theme: variant || theme, links }),
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
  // One-time clock-sanity check: auto-send (below) trusts the DEVICE clock, so
  // a wrong device time silently sends at the wrong hour — or never. Compare
  // device time against Supabase's server clock once and WARN if badly off.
  // Best-effort, never blocks, never changes send behavior.
  try { dlogCheckClockSkew(); } catch (_) {}
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
