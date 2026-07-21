/* ════════════════════════════════════════════════════════════════════
   NEXUS HABITS — Trajan's invisible per-user behavioral memory
   v18.8 (May 2026) — Phase 1+2+3 foundation
   ════════════════════════════════════════════════════════════════════

   PURPOSE

   Every user of NEXUS has a private behavior fingerprint that builds
   over time. Trajan watches what each person does — which views, what
   times, which sequences, what they finish, what they leave open —
   and extracts statistical patterns from those observations.

   Then Trajan uses those patterns silently to make his presence feel
   personal: when to greet, when to stay quiet, when to drift toward
   a view, when to look faintly worried. Never says "I noticed you
   usually..." — only ever shows up in WHAT he chooses to do.

   ────────────────────────────────────────────────────────────────────

   ARCHITECTURE (three layers)

     OBSERVATION LAYER
       Passive listeners on view changes, form submits, action
       completions, dwell times. Writes lightweight event records
       to IndexedDB (rolling 30-day window per user).

     PATTERN LAYER
       Periodically (every 30 min) reads the rolling buffer for the
       current user and extracts:
         • Markov bigrams over view sequences  → next-view prediction
         • Hour-of-day histograms per behavior → quiet/active hours
         • EWMA baselines (session, dwell, ...) → "what's normal for them"
         • Day-of-week activity profile         → weekly rhythm
         • Submission-time distributions        → "you submit at ~23:45"
         • Completion-rate per action           → start vs finish ratio
         • Quiet hours, active hours derived from histograms

     CONSUMPTION LAYER (exposed to Trajan via NX.habits)
       predictNextView, isQuietHourFor, expectedViewNow,
       surpriseScore, lapseDetect, userFingerprint,
       reinforcementOpportunity — the API Trajan reads when deciding
       what to do.

   ────────────────────────────────────────────────────────────────────

   STORAGE

     Local (IndexedDB, per device):
       Database `nexus_habits`, store `events`.
       Each event: { user_id, type, key, value, at }.
       Rolling 30 days; older events auto-purged.

     Local (localStorage, per device):
       nexus_device_id            — UUID generated once
       nexus_habits_cache         — latest computed patterns (cached)
       nexus_habits_lapse_state   — per-day per-user lapse tracking

     Cloud (Supabase, per user):
       trajan_profiles row — distilled patterns + baselines + device_ids
       Synced hourly. Lets a user move to a fresh device and Trajan
       has a head-start instead of needing to re-learn from scratch.

   ────────────────────────────────────────────────────────────────────

   PRIVACY + DISCRETION

     • No UI surface (except admin debug view, gated on isAdmin).
     • Stored data is timestamps + event types + view names.
       NEVER form contents, search queries, names you typed, etc.
     • Trajan never references the data when speaking.
     • Adapts only through WHAT he chooses to do, never through
       statements like "I notice you usually..."
     • clear() wipes all habit data for the current user (called
       on logout for shared devices).

   ════════════════════════════════════════════════════════════════════ */

(function(){
  if (!window.NX) window.NX = {};

  // ─── CONSTANTS ─────────────────────────────────────────────────────
  const DB_NAME = 'nexus_habits';
  const DB_VERSION = 1;
  const STORE_EVENTS = 'events';
  const ROLLING_DAYS = 30;
  const SYNC_INTERVAL_MS = 60 * 60 * 1000;      // 1 hour cloud sync
  const PATTERN_REFRESH_MS = 30 * 60 * 1000;    // 30 min pattern recompute
  const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily purge old events

  // EWMA smoothing factor — 0.1 means recent observations weigh ~10%,
  // making the baseline drift slowly. Per Lally et al. (2010), habits
  // form over ~66 days, so a slow-moving average is appropriate.
  const EWMA_ALPHA = 0.10;

  // Number of events that constitutes "enough data" to make predictions.
  // Below this threshold, the pattern object returns nulls instead of
  // bad guesses based on too-few samples.
  const MIN_EVENTS_FOR_PATTERNS = 30;

  // Hour-histogram thresholds. For an hour to count as "active" or
  // "quiet" we need at least N observations in that hour bucket.
  const MIN_OBS_PER_HOUR = 3;

  // ─── STATE ─────────────────────────────────────────────────────────
  const _state = {
    db: null,
    deviceId: null,
    currentUserId: null,
    cachedPatterns: null,
    lastPatternComputeAt: 0,
    lastCloudSyncAt: 0,
    lastViewAt: 0,
    lastViewName: null,
    sessionStartAt: Date.now(),
    pendingActions: new Map(),   // action_id → {at, view}
    cloudProfile: null,          // last fetched cloud profile (warm-start)
    initialized: false,
  };

  // ─── UTILS ─────────────────────────────────────────────────────────
  function uuidv4() {
    // Simple v4 UUID. crypto.randomUUID is the right call when present.
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx').replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function nowMs() { return Date.now(); }
  function hourOf(ms) { return new Date(ms).getHours(); }
  function dowOf(ms) { return new Date(ms).getDay(); }   // 0=Sun
  function dayKeyOf(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
  }

  // ─── DEVICE ID ─────────────────────────────────────────────────────
  function ensureDeviceId() {
    if (_state.deviceId) return _state.deviceId;
    let id = null;
    try { id = localStorage.getItem('nexus_device_id'); } catch(_){}
    if (!id) {
      id = uuidv4();
      try { localStorage.setItem('nexus_device_id', id); } catch(_){}
    }
    _state.deviceId = id;
    return id;
  }

  // ─── INDEXED DB ────────────────────────────────────────────────────
  function openDb() {
    return new Promise((resolve, reject) => {
      if (_state.db) return resolve(_state.db);
      if (!window.indexedDB) return resolve(null);   // graceful: no IDB
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => {
        console.warn('[habits] IndexedDB unavailable');
        resolve(null);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          const os = db.createObjectStore(STORE_EVENTS, {
            keyPath: 'id', autoIncrement: true,
          });
          os.createIndex('by_user_time', ['user_id', 'at']);
          os.createIndex('by_user_type', ['user_id', 'type']);
          os.createIndex('by_user', 'user_id');
        }
      };
      req.onsuccess = (e) => {
        _state.db = e.target.result;
        resolve(_state.db);
      };
    });
  }

  async function _put(record) {
    const db = await openDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_EVENTS, 'readwrite');
        tx.objectStore(STORE_EVENTS).add(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();   // non-fatal
      } catch (e) { resolve(); }
    });
  }

  async function _getAllForUser(userId, sinceMs) {
    const db = await openDb();
    if (!db || userId == null) return [];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_EVENTS, 'readonly');
        const idx = tx.objectStore(STORE_EVENTS).index('by_user_time');
        const lowerBound = sinceMs || (Date.now() - ROLLING_DAYS * 86400000);
        const range = IDBKeyRange.bound([userId, lowerBound], [userId, Date.now()]);
        const results = [];
        const cursorReq = idx.openCursor(range);
        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { results.push(cursor.value); cursor.continue(); }
          else resolve(results);
        };
        cursorReq.onerror = () => resolve([]);
      } catch (e) { resolve([]); }
    });
  }

  async function _purgeOldEvents() {
    const db = await openDb();
    if (!db) return;
    const cutoff = Date.now() - ROLLING_DAYS * 86400000;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_EVENTS, 'readwrite');
        const os = tx.objectStore(STORE_EVENTS);
        const req = os.openCursor();
        req.onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return resolve();
          if (c.value && c.value.at < cutoff) c.delete();
          c.continue();
        };
        req.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  }

  async function _clearUserEvents(userId) {
    const db = await openDb();
    if (!db || userId == null) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_EVENTS, 'readwrite');
        const idx = tx.objectStore(STORE_EVENTS).index('by_user');
        const req = idx.openCursor(IDBKeyRange.only(userId));
        req.onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return resolve();
          c.delete();
          c.continue();
        };
        req.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  }

  // ─── OBSERVATION API ──────────────────────────────────────────────
  // Public method called from outside the module (e.g. when a form
  // is submitted) or internally by our wired DOM listeners.
  async function observe(type, key, value) {
    if (!_state.currentUserId) return;     // anonymous sessions don't track
    if (!type || !key) return;
    await _put({
      user_id: _state.currentUserId,
      type, key,
      value: value || null,
      at: nowMs(),
    });
  }

  // ─── PATTERN EXTRACTION ───────────────────────────────────────────
  // Reads the rolling buffer for current user, computes a compact
  // pattern object. Cached in memory + cloud-synced.
  async function extractPatterns() {
    const uid = _state.currentUserId;
    if (uid == null) return null;

    const events = await _getAllForUser(uid);
    const patterns = {
      version: 1,
      computed_at: nowMs(),
      observation_count: events.length,
      ready: events.length >= MIN_EVENTS_FOR_PATTERNS,
    };

    if (events.length === 0) {
      _state.cachedPatterns = patterns;
      return patterns;
    }

    // ─── Markov bigrams over view visits ─────────────────────────
    // Build: prev_view → next_view → count, then normalize.
    const viewVisits = events.filter(e => e.type === 'view_visit')
                              .sort((a,b) => a.at - b.at);
    const bigramCounts = {};   // {prev: {next: count, _total: n}}
    for (let i = 1; i < viewVisits.length; i++) {
      const prev = viewVisits[i-1].key;
      const next = viewVisits[i].key;
      if (prev === next) continue;   // self-transitions are noise
      if (!bigramCounts[prev]) bigramCounts[prev] = { _total: 0 };
      bigramCounts[prev][next] = (bigramCounts[prev][next] || 0) + 1;
      bigramCounts[prev]._total++;
    }
    const bigrams = {};
    for (const prev in bigramCounts) {
      bigrams[prev] = {};
      const tot = bigramCounts[prev]._total;
      for (const next in bigramCounts[prev]) {
        if (next === '_total') continue;
        bigrams[prev][next] = bigramCounts[prev][next] / tot;
      }
    }
    patterns.markov_bigrams = bigrams;

    // ─── Hour-of-day histograms per view ─────────────────────────
    // For each view, count visits per hour-of-day bucket [0..23].
    const hourHist = {};   // {viewName: [c0, c1, ..., c23]}
    for (const v of viewVisits) {
      if (!hourHist[v.key]) hourHist[v.key] = new Array(24).fill(0);
      hourHist[v.key][hourOf(v.at)]++;
    }
    patterns.hour_histograms = hourHist;

    // ─── Typical-view-by-hour ────────────────────────────────────
    // For each hour, which view does this user most commonly visit?
    const typicalByHour = new Array(24).fill(null);
    for (let h = 0; h < 24; h++) {
      let best = null, bestCount = 0;
      for (const view in hourHist) {
        if (hourHist[view][h] >= MIN_OBS_PER_HOUR && hourHist[view][h] > bestCount) {
          bestCount = hourHist[view][h];
          best = view;
        }
      }
      typicalByHour[h] = best;
    }
    patterns.typical_view_by_hour = typicalByHour;

    // ─── Day-of-week activity profile ────────────────────────────
    // Weight each weekday by total observations on that day.
    const dowProfile = new Array(7).fill(0);
    for (const e of events) dowProfile[dowOf(e.at)]++;
    const dowMax = Math.max(...dowProfile, 1);
    patterns.dow_activity = dowProfile.map(c => c / dowMax);

    // ─── Session-length EWMA ─────────────────────────────────────
    // Approximate sessions as runs of events within 5min of each other.
    const sessionLengths = [];
    let sessionStart = null, sessionLast = null;
    for (const e of events.slice().sort((a,b) => a.at - b.at)) {
      if (sessionStart == null) {
        sessionStart = e.at; sessionLast = e.at; continue;
      }
      if (e.at - sessionLast > 5 * 60_000) {
        // session ended
        sessionLengths.push((sessionLast - sessionStart) / 60_000);
        sessionStart = e.at;
      }
      sessionLast = e.at;
    }
    if (sessionStart != null) {
      sessionLengths.push((sessionLast - sessionStart) / 60_000);
    }
    patterns.session_length_min = sessionLengths.length
      ? { mean: avg(sessionLengths), stddev: stddev(sessionLengths), n: sessionLengths.length }
      : null;

    // ─── Submission-time distributions ───────────────────────────
    // For each submit type, mean/stddev of the submit hour-of-day.
    const submitsByKind = {};
    for (const e of events) {
      if (e.type !== 'submit') continue;
      if (!submitsByKind[e.key]) submitsByKind[e.key] = [];
      submitsByKind[e.key].push(hourOf(e.at) + new Date(e.at).getMinutes() / 60);
    }
    const submitTimes = {};
    for (const k in submitsByKind) {
      submitTimes[k] = {
        meanHour: avg(submitsByKind[k]),
        stddev:   stddev(submitsByKind[k]),
        n:        submitsByKind[k].length,
      };
    }
    patterns.submission_times = submitTimes;

    // ─── Completion rates per action ─────────────────────────────
    const startsBy = {}, donesBy = {};
    for (const e of events) {
      if (e.type === 'action_start') startsBy[e.key] = (startsBy[e.key] || 0) + 1;
      if (e.type === 'action_done')  donesBy[e.key]  = (donesBy[e.key]  || 0) + 1;
    }
    const completion = {};
    for (const k in startsBy) {
      completion[k] = {
        started: startsBy[k],
        done:    donesBy[k] || 0,
        rate:    (donesBy[k] || 0) / startsBy[k],
      };
    }
    patterns.completion_rates = completion;

    // ─── Quiet & active hours ────────────────────────────────────
    // Derived from total event counts per hour. "Active" = top 25% of
    // hours; "quiet" = hours with at least some activity but low. The
    // contract here is: "quiet" doesn't mean "user is idle" — it means
    // "when the user IS here at this hour, they tend to be focused
    // (low click churn, long dwell, few view-switches)."
    const totalByHour = new Array(24).fill(0);
    for (const e of events) totalByHour[hourOf(e.at)]++;
    const sortedHours = totalByHour.map((c, h) => ({ h, c }))
                                    .filter(x => x.c >= MIN_OBS_PER_HOUR)
                                    .sort((a, b) => b.c - a.c);
    const top25 = Math.max(1, Math.floor(sortedHours.length * 0.25));
    patterns.active_hours = sortedHours.slice(0, top25).map(x => x.h);

    // Focus windows = hours when user is in NEXUS AND has low click
    // churn (few clicks per minute spread out). Approximation: pick
    // hours where there are events but the events-per-hour rate is
    // below the user's median.
    const median = sortedHours.length
      ? sortedHours[Math.floor(sortedHours.length / 2)].c : 0;
    patterns.focus_hours = sortedHours.filter(x => x.c < median * 0.7)
                                       .map(x => x.h);

    // ─── First-view-of-session distribution ─────────────────────
    // What's the user's typical first move when they open NEXUS?
    // Useful for personalized greetings.
    const firstViews = [];
    let lastEventAt = 0;
    for (const e of events.slice().sort((a,b) => a.at - b.at)) {
      if (e.type !== 'view_visit') continue;
      if (e.at - lastEventAt > 30 * 60_000) {
        // session start (gap > 30min from last event)
        firstViews.push(e.key);
      }
      lastEventAt = e.at;
    }
    const firstViewCounts = {};
    for (const v of firstViews) firstViewCounts[v] = (firstViewCounts[v] || 0) + 1;
    const totalFV = firstViews.length || 1;
    const firstViewDist = {};
    for (const v in firstViewCounts) firstViewDist[v] = firstViewCounts[v] / totalFV;
    patterns.first_view_distribution = firstViewDist;

    // ─── Streak — consecutive days with ≥1 event ────────────────
    const days = new Set(events.map(e => dayKeyOf(e.at)));
    patterns.active_days_30 = days.size;

    _state.cachedPatterns = patterns;
    _state.lastPatternComputeAt = nowMs();

    // Cache in localStorage for fast warm-start on next page load
    try {
      localStorage.setItem('nexus_habits_cache',
        JSON.stringify({ user_id: uid, patterns }));
    } catch(_){}

    // v18.9 — implicit interest learning from patterns. When usage
    // shapes are clear enough, quietly inform the interests module so
    // it can build inferred_interests for this user. Trajan then mixes
    // those into pickForUser at reduced weight (cap 0.7 vs admin 1.0).
    try { inferInterestsFromPatterns(uid, patterns); } catch(_){}

    return patterns;
  }

  // v18.9 — quietly learn interests from observed behavior. Only
  // fires when patterns have enough observations to be reliable.
  // Each call to NX.interests.recordSignal adds one evidence point;
  // the RPC server-side caps weight at 1.0 and tracks evidence count.
  function inferInterestsFromPatterns(uid, p) {
    if (!p || !p.ready) return;
    if (!window.NX || !NX.interests || !NX.interests.recordSignal) return;
    if (uid == null) return;
    // Hour-histogram-derived signals
    const hours = p.hour_histograms || {};
    // Admin/operations: heavy usage of equipment / inventory / board / admin
    const opsViews = ['equipment', 'inventory', 'board', 'admin'];
    let opsTotal = 0;
    for (const v of opsViews) {
      if (hours[v]) opsTotal += hours[v].reduce((s, c) => s + c, 0);
    }
    if (opsTotal >= 100) {
      NX.interests.recordSignal(uid, 'admin_pro', 1);
    }
    // Reading: heavy use of education view
    if (hours.education && hours.education.reduce((s,c) => s+c, 0) >= 30) {
      NX.interests.recordSignal(uid, 'reading', 1);
    }
    // Cooking: heavy use of inventory + cleaning together (kitchen mind)
    const invCount = hours.inventory ? hours.inventory.reduce((s,c)=>s+c,0) : 0;
    const clnCount = hours.clean ? hours.clean.reduce((s,c)=>s+c,0) : 0;
    if (invCount >= 50 && clnCount >= 50) {
      NX.interests.recordSignal(uid, 'cooking', 1);
    }
  }

  // ─── CLOUD SYNC ───────────────────────────────────────────────────
  async function syncProfile() {
    const uid = _state.currentUserId;
    if (uid == null) return;
    if (!NX.sb) return;
    const patterns = _state.cachedPatterns || await extractPatterns();
    if (!patterns) return;

    try {
      // Upsert this user's profile row.
      const payload = {
        user_id: uid,
        patterns,
        observation_count: patterns.observation_count || 0,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // Add this device to the device_ids array if not already there.
      // We can't easily append-only via PostgREST in one call, so we
      // do a small upsert that pulls existing then writes.
      // v336: affective_baseline is owned exclusively by
      // updateAffectiveBaseline. Upsert with onConflict:'user_id' only SETs
      // columns present in the payload, so omitting it preserves the stored
      // value and avoids a lost-update hazard.
      const { data: existing } = await NX.sb.from('trajan_profiles')
        .select('device_ids')
        .eq('user_id', uid).maybeSingle();
      const deviceIds = new Set(existing?.device_ids || []);
      deviceIds.add(_state.deviceId);
      payload.device_ids = Array.from(deviceIds);

      // v336: supabase-js RESOLVES with {error} (law) — check it, don't
      // let a failed write fall through to marking the sync succeeded.
      const { error } = await NX.sb.from('trajan_profiles').upsert(payload, { onConflict: 'user_id' });
      if (error) { console.warn('[habits] cloud sync failed:', error.message); return; }
      _state.lastCloudSyncAt = nowMs();
    } catch (e) {
      console.warn('[habits] cloud sync failed:', e?.message || e);
    }
  }

  async function pullCloudProfile(uid) {
    if (!NX.sb || uid == null) return null;
    try {
      // v336: supabase-js RESOLVES with {error} (law) — check it.
      const { data, error } = await NX.sb.from('trajan_profiles')
        .select('*').eq('user_id', uid).maybeSingle();
      if (error) { console.warn('[habits] pull profile failed:', error.message); return null; }
      _state.cloudProfile = data || null;
      return data;
    } catch (e) {
      return null;
    }
  }

  // ─── USER LIFECYCLE ───────────────────────────────────────────────
  async function setActiveUser(userId) {
    if (userId == null) {
      _state.currentUserId = null;
      _state.cachedPatterns = null;
      return;
    }
    _state.currentUserId = userId;
    _state.sessionStartAt = nowMs();
    _state.lastViewAt = 0;
    _state.lastViewName = null;
    _state.pendingActions.clear();

    // Warm-start: use cached patterns from localStorage if user matches
    try {
      const cached = JSON.parse(localStorage.getItem('nexus_habits_cache') || 'null');
      if (cached && cached.user_id === userId) {
        _state.cachedPatterns = cached.patterns;
      } else {
        _state.cachedPatterns = null;
      }
    } catch(_){ _state.cachedPatterns = null; }

    // Async: pull cloud profile (so Trajan has data even on a fresh device)
    pullCloudProfile(userId).then(cloud => {
      if (cloud && cloud.patterns && cloud.patterns.observation_count
          && (!_state.cachedPatterns
              || cloud.patterns.observation_count > (_state.cachedPatterns.observation_count || 0))) {
        // Cloud profile has more observations than local — use it as the
        // baseline. The local rolling buffer will continue to add new data.
        _state.cachedPatterns = cloud.patterns;
      }
    });

    // Re-extract patterns after a short delay (lets us collect a few
    // fresh events before computing)
    setTimeout(() => extractPatterns(), 5000);

    // Initial observation: mark this session start
    observe('session', 'start', { device_id: _state.deviceId });
  }

  function onUserChange(e) {
    const newUser = e?.detail?.user;
    if (newUser && newUser.id != null) {
      setActiveUser(newUser.id);
    } else {
      setActiveUser(null);
    }
  }

  // ─── GLOBAL LISTENERS ─────────────────────────────────────────────
  function wireGlobalListeners() {
    // View change detection — clicks on .nav-tab or .bnav-btn with data-view
    document.addEventListener('click', (e) => {
      if (!_state.currentUserId) return;
      const tab = e.target && e.target.closest && e.target.closest('.nav-tab, .bnav-btn');
      if (!tab) return;
      const view = tab.getAttribute('data-view');
      if (!view) return;
      _handleViewChange(view);
    }, { capture: true, passive: true });

    // Form submit detection — any form submission counts
    document.addEventListener('submit', (e) => {
      if (!_state.currentUserId) return;
      const form = e.target;
      const id = (form && form.id) || 'unknown';
      observe('submit', id, { view: _state.lastViewName });
    }, { capture: true, passive: true });

    // Page visibility change — close out current view dwell
    document.addEventListener('visibilitychange', () => {
      if (!_state.currentUserId) return;
      if (document.hidden && _state.lastViewName && _state.lastViewAt) {
        const dwell = nowMs() - _state.lastViewAt;
        if (dwell > 2000) {   // ignore quick flips
          observe('view_dwell', _state.lastViewName, { ms: dwell });
        }
      }
    }, { passive: true });

    // User-change event from app.js
    document.addEventListener('nexus:user-change', onUserChange);

    // Long-press on masthead → open admin debug view
    let pressTimer = null;
    document.addEventListener('pointerdown', (e) => {
      const mast = e.target && e.target.closest && e.target.closest('.home-mast-brand, .nx-masthead');
      if (!mast) return;
      if (!window.app || !app.isAdmin) return;
      pressTimer = setTimeout(() => {
        openDebugView();
        pressTimer = null;
      }, 900);
    }, { passive: true });
    const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    document.addEventListener('pointerup',   cancelPress, { passive: true });
    document.addEventListener('pointercancel', cancelPress, { passive: true });
    document.addEventListener('pointermove', cancelPress, { passive: true });

    // URL param fallback
    try {
      if (location.search.indexOf('habits-debug=1') >= 0
          && window.app && app.isAdmin) {
        setTimeout(openDebugView, 500);
      }
    } catch(_){}
  }

  function _handleViewChange(viewName) {
    const now = nowMs();
    // Close out previous view's dwell
    if (_state.lastViewName && _state.lastViewName !== viewName && _state.lastViewAt) {
      const dwell = now - _state.lastViewAt;
      if (dwell > 1500) {
        observe('view_dwell', _state.lastViewName, { ms: dwell });
      }
    }
    if (viewName !== _state.lastViewName) {
      observe('view_visit', viewName, { from: _state.lastViewName });
      _state.lastViewName = viewName;
      _state.lastViewAt = now;
    }
  }

  // ─── PREDICTION + QUERY API (consumed by Trajan/clippy.js) ────────

  function patternsFor(userId) {
    // Returns patterns for current user; userId arg is for future
    // multi-user querying (not used today but signature-stable).
    if (userId != null && userId !== _state.currentUserId) return null;
    return _state.cachedPatterns;
  }

  function predictNextView(currentView) {
    const p = _state.cachedPatterns;
    if (!p || !p.ready || !p.markov_bigrams) return null;
    const row = p.markov_bigrams[currentView];
    if (!row) return null;
    let best = null, bestProb = 0;
    for (const next in row) {
      if (row[next] > bestProb) { bestProb = row[next]; best = next; }
    }
    return best ? { view: best, probability: bestProb } : null;
  }

  function expectedViewNow() {
    const p = _state.cachedPatterns;
    if (!p || !p.ready) return null;
    const h = new Date().getHours();
    return p.typical_view_by_hour ? p.typical_view_by_hour[h] : null;
  }

  function isQuietHourFor(userId) {
    const p = patternsFor(userId);
    if (!p || !p.ready) return false;
    const h = new Date().getHours();
    return (p.focus_hours || []).includes(h);
  }

  function isActiveHourFor(userId) {
    const p = patternsFor(userId);
    if (!p || !p.ready) return false;
    const h = new Date().getHours();
    return (p.active_hours || []).includes(h);
  }

  // Z-score-style "how surprising is this current value vs baseline?"
  function surpriseScore(category, value) {
    const p = _state.cachedPatterns;
    if (!p || !p.ready) return 0;
    let baseline = null;
    if (category === 'session_minutes' && p.session_length_min) {
      baseline = p.session_length_min;
    }
    if (!baseline || baseline.stddev === 0) return 0;
    return (value - baseline.mean) / baseline.stddev;
  }

  // Returns array of behaviors the user typically does but hasn't done
  // yet today. Trajan uses this for silent worried-mood signaling.
  async function lapseDetect() {
    const p = _state.cachedPatterns;
    if (!p || !p.ready) return [];
    if (_state.currentUserId == null) return [];

    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayEvents = await _getAllForUser(_state.currentUserId, todayStart.getTime());

    const todayHour = new Date().getHours();
    const lapses = [];

    // For each submission type: if mean submit hour was earlier today
    // (with stddev tolerance) and we haven't seen it submitted yet,
    // that's a lapse.
    for (const kind in p.submission_times) {
      const meta = p.submission_times[kind];
      if (meta.n < 5) continue;   // not enough data to call a lapse
      const tolerance = Math.max(0.5, meta.stddev || 1);
      const expectedHour = meta.meanHour;
      if (todayHour > expectedHour + tolerance) {
        const submitted = todayEvents.some(e => e.type === 'submit' && e.key === kind);
        if (!submitted) {
          lapses.push({
            kind: 'submit', key: kind,
            expected_hour: expectedHour, stddev: meta.stddev,
            hours_overdue: todayHour - expectedHour,
          });
        }
      }
    }

    // For each typical-view-by-hour: if a typical view for THIS hour
    // hasn't been visited yet today and the user has had ample time
    // to visit it, that's a soft lapse.
    const seenViewsToday = new Set(
      todayEvents.filter(e => e.type === 'view_visit').map(e => e.key));
    const typicalNow = p.typical_view_by_hour ? p.typical_view_by_hour[todayHour] : null;
    if (typicalNow && !seenViewsToday.has(typicalNow)
        && todayEvents.length > 5) {
      // user has been active today but hasn't touched their typical view
      lapses.push({ kind: 'view_skip', key: typicalNow, hour: todayHour });
    }

    return lapses;
  }

  // A short, opinionated user characterization Trajan can use to color
  // dialog choices ("you're a morning person who burns through the
  // board fast"). NEVER spoken back to the user verbatim.
  function userFingerprint() {
    const p = _state.cachedPatterns;
    if (!p || !p.ready) {
      return { confidence: 'low', morning_person: null, completer: null };
    }
    const activeMorning = (p.active_hours || []).filter(h => h >= 6 && h <= 11).length;
    const activeLate    = (p.active_hours || []).filter(h => h >= 21 || h <= 4).length;
    const activeAvg     = (p.active_hours || []).length || 1;
    // Average completion rate across actions with enough data
    let completionAvg = null;
    if (p.completion_rates) {
      const rates = Object.values(p.completion_rates)
        .filter(r => r.started >= 3).map(r => r.rate);
      if (rates.length) completionAvg = avg(rates);
    }
    return {
      confidence: p.observation_count > 200 ? 'high' :
                  p.observation_count > 60  ? 'med'  : 'low',
      morning_person: activeMorning > activeLate ? true :
                      activeLate > activeMorning ? false : null,
      late_owl: activeLate > activeMorning,
      completer: completionAvg == null ? null : completionAvg > 0.75,
      regular_views: p.first_view_distribution
        ? Object.keys(p.first_view_distribution).sort(
            (a,b) => p.first_view_distribution[b] - p.first_view_distribution[a]
          ).slice(0, 3)
        : [],
      typical_session_min: p.session_length_min ? p.session_length_min.mean : null,
      active_days_30: p.active_days_30 || 0,
    };
  }

  // Phase 3 hook — Trajan calls this when a behavior was completed,
  // to know if it warrants a tiny acknowledgment.
  async function reinforcementOpportunity(eventType, key) {
    const p = _state.cachedPatterns;
    if (!p || !p.ready) return null;

    // Did the user just complete a behavior they consistently do?
    // (= one with high observation count + reasonable completion rate)
    if (eventType === 'submit' && p.submission_times[key]
        && p.submission_times[key].n >= 7) {
      const now = new Date();
      const currentHour = now.getHours() + now.getMinutes() / 60;
      const meta = p.submission_times[key];
      // Within typical window?
      const withinWindow = Math.abs(currentHour - meta.meanHour)
                             <= Math.max(1, meta.stddev || 1) * 1.5;
      if (withinWindow) {
        return { strength: 'recurring', habit_n: meta.n };
      }
    }
    return null;
  }

  // Phase 3 hook — write/read affective baseline per user (mean stress
  // score for THIS user, used by the awareness layer to know "normal").
  function getAffectiveBaseline(userId) {
    const cloud = _state.cloudProfile;
    if (cloud && cloud.user_id === userId && cloud.affective_baseline) {
      return cloud.affective_baseline;
    }
    return null;
  }

  async function updateAffectiveBaseline(userId, partial) {
    if (!NX.sb || userId == null) return;
    try {
      const { data: existing } = await NX.sb.from('trajan_profiles')
        .select('affective_baseline').eq('user_id', userId).maybeSingle();
      const merged = Object.assign({}, existing?.affective_baseline || {}, partial);
      // v336: supabase-js RESOLVES with {error} (law) — check it.
      const { error } = await NX.sb.from('trajan_profiles').upsert({
        user_id: userId,
        affective_baseline: merged,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) { console.warn('[habits] baseline update failed:', error.message); return; }
      // v336: keep the in-memory cache coherent so getAffectiveBaseline sees
      // a baseline written mid-session (previously invisible until next login).
      if (_state.cloudProfile && _state.cloudProfile.user_id === userId) _state.cloudProfile.affective_baseline = merged;
      else _state.cloudProfile = { user_id: userId, affective_baseline: merged };
    } catch(_){}
  }

  // ─── ADMIN DEBUG VIEW ─────────────────────────────────────────────
  // Long-press on masthead OR ?habits-debug=1 → open this modal.
  // Shows admin the current pattern object as readable JSON tables.
  function openDebugView() {
    if (!window.app || !app.isAdmin) return;
    document.querySelectorAll('.habits-debug-bg').forEach(m => m.remove());

    const p = _state.cachedPatterns;
    const fp = userFingerprint();
    const uid = _state.currentUserId;
    const userName = (app.currentUser && app.currentUser.name) || '(none)';

    const bg = document.createElement('div');
    bg.className = 'habits-debug-bg';
    bg.innerHTML = `
      <div class="habits-debug-card">
        <div class="habits-debug-head">
          <div class="habits-debug-title">Trajan's Read on You</div>
          <button class="habits-debug-close">✕</button>
        </div>
        <div class="habits-debug-body">
          <div class="habits-debug-meta">
            User: <b>${esc(userName)}</b> (id ${esc(String(uid || 'none'))})  ·
            Device: <span class="habits-debug-mono">${esc(_state.deviceId || '')}</span>
          </div>
          <div class="habits-debug-meta">
            Observations: <b>${p?.observation_count || 0}</b>  ·
            Active days (30): <b>${p?.active_days_30 || 0}</b>  ·
            Confidence: <b>${fp.confidence}</b>
          </div>
          <div class="habits-debug-meta">
            Last computed: ${p?.computed_at ? new Date(p.computed_at).toLocaleTimeString() : 'never'}  ·
            Last cloud sync: ${_state.lastCloudSyncAt ? new Date(_state.lastCloudSyncAt).toLocaleTimeString() : 'never'}
          </div>

          ${renderDebugSection('Fingerprint', fp)}
          ${renderDebugSection('Typical view by hour', p?.typical_view_by_hour)}
          ${renderDebugSection('Markov bigrams (top transitions)', topBigrams(p?.markov_bigrams))}
          ${renderDebugSection('Submission times (hour mean ± stddev)', formatSubmits(p?.submission_times))}
          ${renderDebugSection('First-view distribution', p?.first_view_distribution)}
          ${renderDebugSection('Day-of-week (weighted 0..1)', p?.dow_activity
            ? { Sun: p.dow_activity[0], Mon: p.dow_activity[1], Tue: p.dow_activity[2],
                Wed: p.dow_activity[3], Thu: p.dow_activity[4], Fri: p.dow_activity[5],
                Sat: p.dow_activity[6] } : null)}
          ${renderDebugSection('Active hours', p?.active_hours)}
          ${renderDebugSection('Focus hours (low-churn)', p?.focus_hours)}
          ${renderDebugSection('Completion rates', p?.completion_rates)}
          ${renderDebugSection('Session length (min)', p?.session_length_min)}

          <div class="habits-debug-actions">
            <button class="habits-debug-btn" data-act="recompute">Recompute now</button>
            <button class="habits-debug-btn" data-act="sync">Force cloud sync</button>
            <button class="habits-debug-btn habits-debug-btn-danger" data-act="wipe">Wipe my data</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(bg);

    bg.querySelector('.habits-debug-close').addEventListener('click', () => bg.remove());
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
    bg.querySelector('[data-act="recompute"]').addEventListener('click', async () => {
      await extractPatterns();
      bg.remove(); openDebugView();
    });
    bg.querySelector('[data-act="sync"]').addEventListener('click', async () => {
      await syncProfile();
      bg.remove(); openDebugView();
    });
    bg.querySelector('[data-act="wipe"]').addEventListener('click', async () => {
      if (!confirm('Wipe ALL habit data for this user on this device?')) return;
      await _clearUserEvents(_state.currentUserId);
      _state.cachedPatterns = null;
      try { localStorage.removeItem('nexus_habits_cache'); } catch(_){}
      bg.remove();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderDebugSection(title, data) {
    if (data == null) return '';
    let body = '';
    if (Array.isArray(data)) {
      body = '<pre class="habits-debug-pre">' + esc(JSON.stringify(data, null, 1)) + '</pre>';
    } else if (typeof data === 'object') {
      const rows = [];
      for (const k in data) {
        const v = data[k];
        let vs;
        if (typeof v === 'number') vs = (v % 1 === 0) ? v : v.toFixed(2);
        else if (typeof v === 'object') vs = JSON.stringify(v);
        else vs = String(v);
        rows.push(`<tr><td>${esc(k)}</td><td>${esc(vs)}</td></tr>`);
      }
      body = `<table class="habits-debug-tbl"><tbody>${rows.join('')}</tbody></table>`;
    } else {
      body = `<div class="habits-debug-val">${esc(String(data))}</div>`;
    }
    return `<details class="habits-debug-section"><summary>${esc(title)}</summary>${body}</details>`;
  }

  function topBigrams(bigrams) {
    if (!bigrams) return null;
    const out = {};
    for (const prev in bigrams) {
      const row = bigrams[prev];
      let best = null, bestP = 0;
      for (const next in row) if (row[next] > bestP) { bestP = row[next]; best = next; }
      if (best) out[prev + ' → ' + best] = bestP.toFixed(2);
    }
    return out;
  }

  function formatSubmits(submits) {
    if (!submits) return null;
    const out = {};
    for (const k in submits) {
      const s = submits[k];
      const h = Math.floor(s.meanHour);
      const m = Math.round((s.meanHour - h) * 60);
      out[k] = `${h}:${String(m).padStart(2,'0')} ± ${(s.stddev || 0).toFixed(1)}h (n=${s.n})`;
    }
    return out;
  }

  // ─── MATH HELPERS ─────────────────────────────────────────────────
  function avg(arr) {
    if (!arr.length) return 0;
    let s = 0; for (const x of arr) s += x;
    return s / arr.length;
  }
  function stddev(arr) {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    let s = 0; for (const x of arr) s += (x - m) * (x - m);
    return Math.sqrt(s / (arr.length - 1));
  }

  // ─── INIT ─────────────────────────────────────────────────────────
  async function init() {
    if (_state.initialized) return;
    _state.initialized = true;
    ensureDeviceId();
    await openDb();
    wireGlobalListeners();

    // If a user is already logged in at module-load (page refresh),
    // pick them up. We poll briefly because app.currentUser may not
    // be set yet at this exact moment.
    let tries = 0;
    const waitForUser = () => {
      if (window.app && app.currentUser && app.currentUser.id != null) {
        setActiveUser(app.currentUser.id);
      } else if (++tries < 20) {
        setTimeout(waitForUser, 500);
      }
    };
    waitForUser();

    // Periodic tasks
    setInterval(() => {
      if (_state.currentUserId != null) extractPatterns();
    }, PATTERN_REFRESH_MS);

    setInterval(() => {
      if (_state.currentUserId != null) syncProfile();
    }, SYNC_INTERVAL_MS);

    setInterval(_purgeOldEvents, PURGE_INTERVAL_MS);
    // Also purge after a 30s delay on init (catches a stale buffer)
    setTimeout(_purgeOldEvents, 30000);

    console.log('[habits] v18.8 ready');
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────
  NX.habits = {
    init,
    observe,
    patternsFor,
    predictNextView,
    expectedViewNow,
    isQuietHourFor,
    isActiveHourFor,
    surpriseScore,
    lapseDetect,
    userFingerprint,
    reinforcementOpportunity,
    getAffectiveBaseline,
    updateAffectiveBaseline,
    refreshPatterns: extractPatterns,
    forceSync: syncProfile,
    openDebugView,
    getDeviceId: () => _state.deviceId,
    getCurrentUserId: () => _state.currentUserId,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
