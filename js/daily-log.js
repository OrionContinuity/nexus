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
  let res = await NX.sb.from('kanban_cards').select('*');
  if (res.error) {
    console.warn('[daily-log] kanban_cards load:', res.error.message);
    return { open: [], working: [], closed: [] };
  }
  // Exclude archived (true). Keep false AND null.
  const cards = (res.data || []).filter(c => c.archived !== true);

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

        <div class="dlog-actions">
          <span class="dlog-autosend-wrap">
            <button type="button" class="eq-btn eq-btn-secondary dlog-autosend-toggle ${dlogAutoSendOn() ? 'is-on' : ''}" id="dlogAutoSendBtn" title="When on, this log auto-uploads to Drive when you leave the screen — and, if still not sent by the time on the right, it sends automatically. Edits autosave continuously so nothing is lost.">${dlogAutoSendOn() ? '🔁 Auto-send: On' : '🔁 Auto-send: Off'}</button>
            <input type="time" id="dlogAutoSendTime" class="dlog-autosend-time" value="${esc(dlogAutoSendTime())}" title="If not sent by this time, send automatically" ${dlogAutoSendOn() ? '' : 'style="display:none"'}>
            <span class="dlog-autosend-days" id="dlogAutoSendDays" title="Days auto-send is allowed" ${dlogAutoSendOn() ? '' : 'style="display:none"'}>${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dd, i) => `<button type="button" class="dlog-day-pill ${dlogAutoSendDays().indexOf(i + 1) !== -1 ? 'is-on' : ''}" data-day="${i + 1}">${dd}</button>`).join('')}</span>
          </span>
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogEmailBtn" title="${esc(emailBtnTitle)}">${esc(emailBtnLabel)}</button>
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
    return `
      <div class="dlog-eqstatus-row" data-eq-id="${esc(eq.id)}">
        <div class="dlog-eqstatus-head">
          <span class="dlog-eqstatus-pill ${statusPillClass(eq.status)}">${esc(statusLabel(eq.status))}</span>
          <div class="dlog-eqstatus-info">
            <span class="dlog-eqstatus-name">${esc(eq.name || 'Untitled equipment')}</span>
            <span class="dlog-eqstatus-meta">${dayLabel ? esc(dayLabel) : ''}</span>
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
  const emailEachBtn = view.querySelector('#dlogEmailEachBtn');
  if (emailEachBtn) emailEachBtn.addEventListener('click', () => emailEachLocation());
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
  // Roman
  'Rome wasn’t built in a day — but the walk-in got fixed in one. Onward.',
  'Veni, vidi, verified the hood vents. — Caesar, probably.',
  'Marcus Aurelius journaled every day. You logged every day. Stoicism lives.',
  'An empire runs on clean drains. Just ask Cloacina, goddess of the sewers.',
  'Build to last — Roman concrete heals itself. The dishwasher does not. That’s our job.',
  // Greek
  'Socrates knew nothing — except that the fryer needs a deep clean.',
  'Give me a lever long enough and I’ll move the reach-in. — Archimedes, on a good day.',
  'The unexamined kitchen is not worth running. — Plato, lightly paraphrased.',
  'Even Odysseus took ten years to get home. Your repair took a week. We’re winning.',
  // Wine
  'A great wine list and a working chiller: the two pillars of civilization.',
  'In vino veritas; in maintenance, longevity. Cheers to both.',
  'Decant the wine, descale the machine. Same energy.',
  'We let the Cabernet breathe and the compressor rest. Balance in all things.',
  // Restaurant
  'Mise en place for the dining room, mise en place for the mechanicals. Both ready.',
  '86 the broken, fire the fixed. Service is up.',
  'A full reservation book and an empty repair queue — chef’s kiss.',
  'The pass is clean, the line is hot, the cooler is cold. As the gods intended.',
  // Funny
  'I’d help carry the kegs, but — tragically — I have no hands.',
  'I told the ice machine to chill. It overdid it. We defrosted.',
  'I’m not saying I’m essential, but the lights are on, aren’t they?',
  'Why did the chef get promoted? He was outstanding in his reductions.',
  'I asked the freezer how it was doing. It gave me the cold shoulder. Working as intended.',
  'I have no hands, no legs, and somehow a full to-do list. Relatable.',
  'They said think outside the box. I am the box. It went poorly. Anyway — your report.',
  'The Wi-Fi and the walk-in both went down. I fixed the important one first. You’re welcome.',
  // Japanese history
  'The samurai sharpened his blade at dawn; you sharpened the mandoline. Respect.',
  'A Zen garden is raked every morning. So is the prep station. Order is a practice.',
  'Miyamoto Musashi won sixty duels. You closed four work orders. A worthy start.',
  'Kaizen: continuous improvement. Also known as fixing one more thing before close.',
  'The tea ceremony honors every detail. So does a properly calibrated oven. Ichigo ichie.',
  'A master swordsmith folds the steel a thousand times. Patience forges everything, even a clean line.',
  'Bushido is discipline, honor, and a walk-in that holds temp. Mostly the last one.',
  // Pastry
  'Laminate the dough, laminate the schedule. Butter and timing — that’s the whole craft.',
  'A soufflé rises on precision and prayer. So does a Friday dinner service.',
  'Temper the chocolate, temper your expectations. Both set beautifully in the end.',
  'The croissant has twenty-seven layers. Your repair log has fewer, thankfully.',
  'Caramel is just sugar that kept its nerve. Be the caramel.',
  'A proofing oven that holds 80°F is worth its weight in gold leaf.',
  // Cooking
  'Low and slow wins the braise; steady and logged wins the week.',
  'Season in layers, fix in layers, and taste as you go.',
  'A watched pot never boils, but a watched compressor never dies. Keep watching.',
  'Sharp knives, hot pans, cold walk-ins — the holy trinity of a good line.',
  'Reduce, don’t panic. Great sauces and great shifts both come from patience.',
  'Master the mother sauces and the mother maintenance; the base holds everything up.',
  // More Roman
  'Hannibal crossed the Alps with elephants. You crossed the lot with a compressor. Legendary.',
  'Carthago delenda est — but first, the grease trap must be cleaned.',
  // More Greek
  'Pythagoras loved a clean triangle; I love a clean hood filter. We are not so different.',
  'Diogenes lived in a barrel. Your storeroom is better organized. Philosophy has moved on.',
  // More wine
  'Old vines make deep wine; old equipment makes deep sighs. We tend both.',
  'Sommeliers swirl, sniff, and log. So do we — minus the swirl.',
  // More restaurant
  'Fire when ready, plate with pride, and never let the ticket rail win.',
  'The best garnish is a repair that stays fixed.',
  // Dad jokes
  'The espresso machine broke down — it just couldn’t espresso its feelings. Fixed now.',
  'Why did the coffee file a police report? It got mugged. The machine’s fine.',
  'What do you call a fake noodle? An impasta. Anyway, the pasta cooker holds temp.',
  'I burned 2,000 calories today — left the pizza in the oven. We recalibrated the timer.',
  'Why don’t eggs tell jokes on the line? They’d crack each other up.',
  'What did the grape do when it got stepped on? Let out a little wine. Fitting.',
  'I don’t trust stairs — they’re always up to something. The walk-in, however, is reliable.',
  'What’s a chef’s favorite exercise? The lunge — with a side of romaine.',
  'I tried to catch fog on the line this morning. I mist.',
  'Why did the scarecrow get a raise? He was outstanding in his field. As is your crew.',
  'I’m reading a book about anti-gravity — can’t put it down. Unlike the mop. That, I put down.',
  'What do you call cheese that isn’t yours? Nacho cheese. The reach-in is guarded accordingly.',
  'Why don’t scientists trust atoms? They make up everything. The compressor, though, is honest.',
  'The rotisserie said it couldn’t eat another bite — it was already stuffed.',
  'I’m afraid of the calendar: its days are numbered. Your equipment isn’t — we maintained it.',
  'What do you call a sad espresso? A depresso. Restocked the machine anyway.',
  'I made a belt out of watches once — total waist of time. Speaking of time, here’s your day.',
  'My soup cracked a joke mid-service. A little too saucy for the pass.',
  // Film
  'Frankly, my dear, the walk-in gives a damn — it held 38°F all night.',
  'You had me at “the compressor is fixed.” — every GM, probably.',
  'Here’s looking at you, hood filter. Spotless.',
  'I’m going to make it an offer it can’t refuse: preventive maintenance.',
  'Say hello to my little torque wrench. The gasket never stood a chance.',
  'Life is like a box of chocolates — keep it at 65°F or it melts. We did.',
  'To infinity and beyond, or at least until the next PM. Buzz would approve.',
  // Gardening
  'Tend the herbs, tend the machines. Both wilt without you.',
  'Prune the dead branches, retire the dead equipment. Growth needs room.',
  'Every rose has its thorn; every walk-in has its door gasket. We replaced the thorn.',
  'You reap what you maintain. This week: a full harvest.',
  'Water daily, inspect daily. Green thumbs and clean filters, same discipline.',
  'Compost the scraps, log the repairs. Nothing is wasted.',
  // Spain
  'The paella waits for no one — and neither does the pilot light. Both lit.',
  'Siesta for the staff, never for the compressor. It ran all afternoon.',
  'Jamón cures for years; equipment lasts if you tend it. Paciencia.',
  'Gaudí took forty years on the Sagrada Família. Your repair took an afternoon. Faster, arguably.',
  'Sobremesa: linger at the table. The dishwasher, meanwhile, works. Balance.',
  // Mexican
  'Mise en place, o como decimos, todo en su lugar. The line is ready.',
  'The salsa needs heat; the walk-in needs cold. We delivered both.',
  'Slow-braise the barbacoa, low and patient. Great maintenance is the same.',
  'A molcajete lasts generations if you season it. So does a well-kept range.',
  'The agave takes eight years to mature. Your PM took eight minutes. We’re ahead.',
  // Soccer
  'The walk-in kept a clean sheet all weekend — no leaks, no goals against.',
  'Ninety minutes plus stoppage; your fryer ran the full match. No subs needed.',
  'Tiki-taka in the kitchen: short passes, clean line, no turnovers.',
  'The compressor scored in extra time — held temp when it mattered. GOAAAL.',
  'A great keeper anticipates the shot; great maintenance anticipates the breakdown. Save made.',
  'Red card to the broken gasket — off the pitch. Fresh one subbed in.',
  // Cooking — inside jokes
  'Yes, chef. No, chef. The compressor said nothing, chef — it just worked.',
  'It’s not burnt, it’s blackened. The oven, however, is genuinely calibrated.',
  'Someone left the walk-in door open again. I have named the culprit in my heart.',
  'Family meal was mystery protein again. The walk-in that stored it? Immaculate.',
  'The 86 board is a living document. So is the repair log. Respect them both.',
  'All day: two walk-ins, one ice machine, zero excuses. Heard.',
  'The stagiaire touched my station. I forgave them. The dish machine, I actually fixed.',
  // Wine — inside jokes
  'It’s not corked, it’s got terroir. The wine fridge, however, is genuinely at 55°F.',
  'Somebody ordered the second-cheapest bottle again. Classic. The cellar cooling is flawless, though.',
  'Natural wine is just a compressor that stopped trying. Ours didn’t — it’s holding temp.',
  'A vertical of the same fridge, 2019 through 2024, all still running. A rare vintage.',
  'The by-the-glass Coravin argon ran out mid-service. The walk-in did not. Priorities held.',
  'I decanted the Barolo for two hours and the GM for none. Both opened up eventually.',
  // History — inside jokes
  'Ea-nāṣir sold bad copper 3,700 years ago and we still complain online. Your gasket is premium, though.',
  'The Defenestration of Prague, but it’s just me tossing the broken gasket out the window.',
  'Tulip mania was a bubble; your maintenance budget is a sound investment. Historically vindicated.',
  'Ötzi the Iceman kept better than most walk-ins. Yours is a close second. Stay cold.',
  'The Year of Four Emperors was chaos; your Friday had one manager and it held. Progress.',
  'The Antikythera mechanism was ancient predictive maintenance. We’re just carrying the torch.',
  // Wine — pro-only inside jokes
  'Grower Champagne only — look for “RM,” not “NM,” in the fine print. The walk-in, meanwhile, is estate-grown cold.',
  'Premox claimed another white Burg. Tragic. The wine fridge will never oxidize your whites early — 55°F, rock steady.',
  'It’s not reduction, it’s “struck-match minerality.” The compressor has no such excuse, and it’s running clean.',
  'I called VA on the flight and got overruled. The walk-in humidity, however, was exactly where I said it would be.',
  'Someone poured a flabby Chard with no acid and called it “buttery.” The dish machine has more backbone. It’s fixed.',
  'Blind grid: pyrazine, high acid, medium tannin — Loire Cab Franc. The walk-in grid: 38°F. Both correct.',
  'Mouton got promoted to First Growth in ’73; nothing had moved since 1855. Your equipment gets promoted every PM.',
  'Phylloxera took the vines — nothing’s taking this compressor. Grafted onto American rootstock of pure reliability.',
  'I flagged Brett and someone said “that’s the terroir talking.” The compressor doesn’t do Brett. It just does cold.',
  'En primeur futures on a wine that might premox? Bold. The wine fridge is the safer investment — holding 55°F.',
  'Judgment of Paris, 1976: California beat Bordeaux blind. Judgment of the walk-in, tonight: it held temp. Also historic.',
  'Aged sur lie for texture, bâtonnage twice a week — meanwhile I age the service contract for the coverage.',
  // Wine — funnier somm
  'My tasting note read “forest floor, wet stone, and the faint regret of a Tuesday.” The walk-in just said 38°F. Refreshingly honest.',
  'A guest asked for “something smooth, not too dry, but red — you know?” I aged a decade in that silence. The compressor did not age. It held.',
  'I spat into the bucket with such confidence you’d think I paid for the bottle. I did not. The walk-in, however, earns its keep.',
  'Passed the theory, tanked the blind, cried in the walk-in. Standard CMS Tuesday. The walk-in was very supportive — and 38°F.',
  'I called it Old World with total conviction. It was a Thursday grocery-store special. Humbling. The wine fridge has never embarrassed me.',
  'A table sent back a flawless Chablis for being “too wine-y.” I have notes. The dishwasher took no notes and simply worked.',
  'Decanted a Beaujolais Nouveau for two hours purely for the theater. Nothing happened. The compressor, by contrast, actually did its job.',
  'The 400% by-the-glass markup funds my personality. The walk-in funds itself by not breaking. We are both essential.',
  'Somebody described a wine as “sequential.” We all nodded. No one knows what it means. The walk-in temp, we do know: 38°F.',
  'I recommended the skin-contact pét-nat and watched a table of four lose faith in me in real time. The fridge kept the faith — and the temp.',
  'Blind-tasted a Riesling as a Grüner and handed back the pin in my mind. The walk-in never fails its blind test: still 38°F.',
  'I described the finish as “long.” It was four seconds. I lied for the tip. The compressor doesn’t lie — it runs cold and true.',
  'The Coravin is a $400 way to feel rich pouring one glass. The walk-in is a free way to feel calm. Balance.',
];
function dlogEmailGreeting(label, dateStr) {
  const s = String(dateStr || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const quote = CLIPPY_QUOTES[h % CLIPPY_QUOTES.length];
  return [
    quote,
    '— Clippy 👋',
    '',
  ];
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
    let pmOverdueG = 0;
    (state.equipmentHealth || []).filter(eq => normLocKey(eq.location) === locKey && eq.archived !== true && String(eq.status || '').toLowerCase() !== 'retired').forEach(eq => {
      const pmNext = eq.next_pm_date ? new Date(String(eq.next_pm_date).slice(0, 10) + 'T00:00:00') : nextG(eq.last_pm_date, eq.pm_interval_days);
      if (pmNext && !isNaN(pmNext) && pmNext < todayG) pmOverdueG++;
    });
    const bits = [];
    if (downG) bits.push(downG + ' down');
    if (urgentG) bits.push(urgentG + ' urgent');
    if (pmOverdueG) bits.push(pmOverdueG + ' PM overdue');
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
    let insO = 0, insS = 0, dcO = 0, dcS = 0, op = 0;
    const pmItems = [];
    const shortDate2 = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    eqAll.forEach(eq => {
      if ((eq.status || 'operational').toLowerCase() === 'operational') op++;
      const pmNext = eq.next_pm_date
        ? new Date(String(eq.next_pm_date).slice(0, 10) + 'T00:00:00')
        : nextOf(eq.last_pm_date, eq.pm_interval_days);
      if (pmNext && !isNaN(pmNext) && pmNext <= soonD) {
        const overdue = pmNext < todayD;
        const days = Math.round((pmNext - todayD) / 86400000);
        pmItems.push({ name: eq.name || 'Equipment', date: pmNext, overdue, days });
      }
      const insNext = nextOf(eq.last_inspection_date, eq.inspection_interval_days);
      if (insNext) { if (insNext < todayD) insO++; else if (insNext <= soonD) insS++; }
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
        // work-order and equipment-status tags.
        out.push('    ' + (x.overdue
          ? ('[OVERDUE] ' + x.name + ' — was due ' + shortDate2(x.date) + (x.days <= -1 ? ' (' + Math.abs(x.days) + 'd ago)' : ''))
          : ('[DUE] ' + x.name + ' — ' + shortDate2(x.date) + (x.days <= 14 ? ' (in ' + x.days + 'd)' : ''))));
      });
      if (pmItems.length > 12) out.push('    +' + (pmItems.length - 12) + ' more');
    }
    const dueLine = (label, over, soon) => {
      const t = over + soon;
      return t ? ('· ' + label + ' due: ' + t + (over ? ' (' + over + ' overdue)' : '')) : null;
    };
    [dueLine('Inspections', insO, insS), dueLine('Deep cleans', dcO, dcS)]
      .filter(Boolean).forEach(l => out.push(l));
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
function emailEachLocation() {
  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  const dateStr = (log && log.log_date) || (d.header && d.header.date) || todayISO();
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

async function openDailyLogEmail() {
  const log = state.currentLog;
  const d = hydrateData(log && log.data);
  const dateStr = (log && log.log_date) || (d.header && d.header.date) || todayISO();
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

// PRIMARY provider: wttr.in - free, no key, CORS-enabled, takes a place/ZIP
// directly (NO separate geocoding step). Returns a one-line summary or null.
async function wttrWeather(place) {
  try {
    const r = await _wfetch('https://wttr.in/' + encodeURIComponent(place) + '?format=j1', 7000);
    if (!r.ok) return null;
    const j = await r.json();
    const w = j && j.weather && j.weather[0];
    if (!w || w.avgtempF == null) return null;
    const noon = (w.hourly || []).find(h => h.time === '1200') || (w.hourly || [])[4] || {};
    const cur = (j.current_condition || [])[0] || {};
    const desc = ((noon.weatherDesc && noon.weatherDesc[0] && noon.weatherDesc[0].value)
      || (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value) || '').trim();
    let str = (desc ? desc + ', ' : '') + 'avg ' + w.avgtempF + '°F (H ' + w.maxtempF + ' / L ' + w.mintempF + ')';
    const rain = parseInt((noon && noon.chanceofrain) || 0, 10);
    if (rain >= 40) str += ' · ' + rain + '% rain';
    return str;
  } catch (_) { return null; }
}

// FALLBACK geocoder: Open-Meteo's own geocoding API (reliable, CORS), cached.
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

// FALLBACK provider: Open-Meteo forecast for a coordinate.
async function fetchDayWeather(lat, lon) {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat + '&longitude=' + lon
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum'
      + '&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&forecast_days=1';
    const res = await _wfetch(url, 7000);
    if (!res.ok) return null;
    const j = await res.json();
    const dy = j && j.daily;
    if (!dy || !dy.temperature_2m_max) return null;
    const hi = dy.temperature_2m_max[0], lo = dy.temperature_2m_min[0];
    if (hi == null || lo == null) return null;
    const code = dy.weather_code ? dy.weather_code[0] : null;
    const precip = (dy.precipitation_sum && dy.precipitation_sum[0]) || 0;
    const avg = Math.round((hi + lo) / 2);
    let str = (code != null ? wmoText(code) + ', ' : '')
      + 'avg ' + avg + '°F (H ' + Math.round(hi) + ' / L ' + Math.round(lo) + ')';
    if (precip > 0.01) str += ' · ' + precip.toFixed(2) + '" precip';
    return str;
  } catch (_) { return null; }
}

// Resolve a location's weather: wttr.in by ZIP/city first, then Open-Meteo.
// Always resolves (default city) unless the network is fully down.
async function weatherForLocationKey(key) {
  const addr = (state.locAddr && state.locAddr[key]) || '';
  const place = placeKeyFromAddress(addr);
  const primary = await wttrWeather(place);
  if (primary) return primary;
  const coords = (await geocodePlace(place)) || DEFAULT_COORDS;
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
    const onView = document.body.classList.contains('view-dailylog') || (document.getElementById('dailylogView') || {}).classList?.contains('active');
    if (!state.dirty && !(dlogAutoSendOn() && onView)) return;
    // Auto-send: upload to Drive when leaving (only if the toggle is on and we
    // have a log with content). Otherwise just a quiet DB save so edits persist.
    const hasContent = state.currentLog && state.currentLog.data;
    if (dlogAutoSendOn() && onView && hasContent) commitSave({ submit: true, quiet: true });
    else if (state.dirty) commitSave({ submit: false, quiet: true });
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
}

if (!NX.modules) NX.modules = {};
NX.modules.dailylog = { init, show };

console.log('[daily-log] v18.32 Phase 3a loaded — dynamic locations + always-editable + Drive update-in-place');

})();
