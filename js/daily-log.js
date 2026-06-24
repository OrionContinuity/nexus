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
    const { data, error } = await NX.sb.from('equipment')
      .select('*')
      .in('status', NON_OPERATIONAL_STATUSES);
    if (error) {
      console.warn('[daily-log] loadEquipmentDown:', error.message);
      return [];
    }
    const rows = (data || []).filter(eq => eq.archived !== true);
    rows.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
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
        await NX.logEquipmentEvent('status_change', equipmentId, {
          from: fromStatus,
          to: 'operational',
          equipment_name: cur.name,
          source: 'daily-log',
        }, cur.location);
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
            ${renderEquipmentActivitySection(d)}
            ${renderVendorActivitySection(d)}
            ${renderTicketsSection(d)}
            ${renderOtherPropertiesSection(d)}
            ${renderCleaningSection(d)}
            ${renderAddLocationControl(d)}
          `}

        <div class="dlog-actions">
          <button type="button" class="eq-btn eq-btn-secondary" id="dlogEmailBtn" title="${esc(emailBtnTitle)}">${esc(emailBtnLabel)}</button>
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
  const rows = state.recentLogs.slice(0, 7).map(r => {
    const isOpen = state.currentLog && state.currentLog.id === r.id;
    return `
      <button type="button" class="dlog-recent-chip ${isOpen ? 'is-active' : ''}" data-log-date="${esc(r.log_date)}">
        <span class="dlog-recent-date">${esc(friendlyDate(r.log_date))}</span>
        ${r.submitted_at ? `<span class="dlog-recent-dot dlog-status-${r.drive_upload_status || 'pending'}"></span>` : ''}
      </button>
    `;
  }).join('');
  return `
    <div class="dlog-recent">
      <span class="dlog-recent-label">RECENT</span>
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
          <input type="text" data-path="header.weather" value="${esc(d.header.weather)}" placeholder="e.g. Sunny, 78°F, evening showers">
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
      <div class="dlog-act-row">
        <span class="${pillClass}"></span>
        <div class="dlog-act-main">
          <div class="dlog-act-line"><b>${esc(eqName)}</b> ${loc}</div>
          <div class="dlog-act-detail">${detail}</div>
        </div>
        <div class="dlog-act-time">${esc(time)}${actor}</div>
      </div>
    `;
  }).join('');
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
    const eqName = c.equipment_id ? eqNameById[c.equipment_id] : null;
    const lane = c._laneLabel || laneLabel(c.status);
    const metaBits = [];
    if (eqName) metaBits.push('🔧 ' + esc(eqName));
    if (lane) metaBits.push(`<span class="dlog-tk-lane dlog-tk-lane-${bucket}">${esc(lane)}</span>`);
    return `
      <div class="dlog-tk-row">
        <span class="bw-pri-pill ${priClass}">${esc(pri)}</span>
        <div class="dlog-tk-main">
          <div class="dlog-tk-title">${esc(c.title || 'Untitled card')}</div>
          <div class="dlog-tk-loc">${metaBits.join(' · ')}</div>
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

function buildDailyLogEmailBody(d, dateStr) {
  const SH = (l, s) => (window.NX && NX.email) ? NX.email.sectionHeader(l, s) : ('--- ' + String(l).toUpperCase() + ' ---');
  const RULE = () => (window.NX && NX.email) ? NX.email.rule() : '-----------------------------------';
  const clean = s => String(s == null ? '' : s).trim();
  const out = [];

  out.push('Daily Log \u2014 ' + fmtLogDateLong(dateStr));
  if (clean(d.header && d.header.weather)) out.push('Weather: ' + clean(d.header.weather));
  out.push('');

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

  out.push(RULE());
  const me = (window.NX && (NX.user || NX.currentUser)) ? ((NX.user && NX.user.name) || (NX.currentUser && NX.currentUser.name) || '') : '';
  if (me) out.push(me);

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

  // Notes — the shift recap the manager types into this location's note.
  if (clean(loc.notes)) { out.push(SH('Notes')); out.push(clean(loc.notes)); out.push(''); }

  // Equipment status — pulled live from NEXUS: anything non-operational at
  // this location, with its status note. No manual entry.
  const down = (state.equipmentDown || []).filter(eq => normLocKey(eq.location) === locKey && eq.archived !== true);
  if (down.length) {
    out.push(SH('Equipment status'));
    down.forEach(eq => {
      const st = (eq.status || '').replace(/_/g, ' ').trim();
      out.push('\u00b7 ' + (eq.name || 'Equipment') + (st ? ' \u2014 ' + st : ''));
      if (clean(eq.status_note)) out.push('    ' + clean(eq.status_note));
    });
    out.push('');
  }

  // Board / work orders — open + in-progress cards on the Board for this
  // location (the live backlog), pulled straight from kanban_cards.
  const slices = state.ticketSlices || {};
  const eqNameById = state._cardEquipmentNames || {};
  const cards = [].concat(slices.open || [], slices.working || [])
    .filter(c => normLocKey(c.location) === locKey);
  if (cards.length) {
    out.push(SH('Board / work orders'));
    cards.forEach(c => {
      const bits = [];
      const eqName = c.equipment_id ? eqNameById[c.equipment_id] : '';
      if (eqName) bits.push('\ud83d\udd27 ' + eqName);
      if (c._laneLabel) bits.push(c._laneLabel);
      out.push('\u00b7 ' + (c.title || 'Untitled card') + (bits.length ? ' (' + bits.join(', ') + ')' : ''));
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

  out.push('Daily Log \u2014 ' + (loc.label || 'Location') + ' \u2014 ' + fmtLogDateLong(dateStr));
  if (d && clean(d.header && d.header.weather)) out.push('Weather: ' + clean(d.header.weather));
  out.push('');

  if (d && clean(d.header && d.header.significant_events)) {
    out.push(SH('Significant events'));
    out.push(clean(d.header.significant_events));
    out.push('');
  }

  const lines = dlogLocationReportLines(loc);
  lines.forEach(l => out.push(l));

  out.push(RULE());
  const me = (window.NX && (NX.user || NX.currentUser)) ? ((NX.user && NX.user.name) || (NX.currentUser && NX.currentUser.name) || '') : '';
  if (me) out.push(me);

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

// ── Weather auto-populate ─────────────────────────────────────────────────
// Once a day, when today's log opens with an empty Weather field, fetch the
// day's weather for the venues' city (Austin) from Open-Meteo — free, no API
// key — and fill a one-line summary with the day's average temp. Never
// overwrites anything you typed; a per-date localStorage flag keeps it to one
// network call a day. Change WEATHER_COORDS to move the location.
const WEATHER_COORDS = { lat: 30.2672, lon: -97.7431 };   // Austin, TX

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

async function maybeAutoWeather() {
  try {
    const log = state.currentLog;
    if (!log) return;
    const dateStr = log.log_date || todayISO();
    if (dateStr !== todayISO()) return;                       // today's log only
    if (!log.data) log.data = hydrateData(null);
    if (!log.data.header) log.data.header = {};
    if (String(log.data.header.weather || '').trim()) return; // never overwrite a manual entry
    const guardKey = 'nexus_weather_done_' + dateStr;
    try { if (localStorage.getItem(guardKey)) return; } catch (_) {}

    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + WEATHER_COORDS.lat + '&longitude=' + WEATHER_COORDS.lon
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum'
      + '&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&forecast_days=1';
    const res = await fetch(url);
    if (!res.ok) return;
    const j = await res.json();
    const dy = j && j.daily;
    if (!dy || !dy.temperature_2m_max) return;
    const hi = dy.temperature_2m_max[0];
    const lo = dy.temperature_2m_min[0];
    if (hi == null || lo == null) return;
    const code = dy.weather_code ? dy.weather_code[0] : null;
    const precip = (dy.precipitation_sum && dy.precipitation_sum[0]) || 0;
    const avg = Math.round((hi + lo) / 2);
    let str = (code != null ? wmoText(code) + ', ' : '')
      + 'avg ' + avg + '\u00b0F (H ' + Math.round(hi) + ' / L ' + Math.round(lo) + ')';
    if (precip > 0.01) str += ' \u00b7 ' + precip.toFixed(2) + '" precip';

    try { localStorage.setItem(guardKey, '1'); } catch (_) {}
    log.data.header.weather = str;
    const input = document.querySelector('[data-path="header.weather"]');
    if (input && !input.value.trim()) input.value = str;
    markDirty();   // quiet autosave so it persists with the rest of the log
  } catch (e) { if (window.NX && NX.debug) NX.debug('dlog.weather', e); /* offline/API hiccup — field stays editable */ }
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
  // Autosave after 3s of typing-pause. Quiet — no toast unless it fails.
  state.saveTimer = setTimeout(() => commitSave({ submit: false, quiet: true }), 3000);
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
  const [existing, activity, slices, vendors, vendorIssues, eqDown] = await Promise.all([
    loadLog(iso),
    loadEquipmentActivity(iso),
    loadTicketSlices(iso),
    loadVendors(),
    loadVendorOpenIssueCounts(),
    loadEquipmentDown(),
  ]);
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
  const today = todayISO();
  const [rs, todayRow, _locations, activity, slices, vendors, vendorIssues, eqDown] = await Promise.all([
    loadRecentLogs(),
    loadLog(today),
    loadEquipmentLocations().catch(() => []),
    loadEquipmentActivity(today),
    loadTicketSlices(today),
    loadVendors(),
    loadVendorOpenIssueCounts(),
    loadEquipmentDown(),
  ]);
  state.recentLogs = rs;
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
  const [rs, current, activity, slices, vendors, vendorIssues, eqDown] = await Promise.all([
    loadRecentLogs(),
    loadLog(date),
    loadEquipmentActivity(date),
    loadTicketSlices(date),
    loadVendors(),
    loadVendorOpenIssueCounts(),
    loadEquipmentDown(),
  ]);
  state.recentLogs = rs;
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
