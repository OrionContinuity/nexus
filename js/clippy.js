/* ════════════════════════════════════════════════════════════════════════
   NEXUS Clippy v3 — handmade
   ────────────────────────────────────────────────────────────────────
   No external library. No sprites. 100% our own SVG, CSS, and JS.
   Every animation is a CSS keyframe; every state transition is a
   class toggle. We own the DOM completely so click and drag are
   bulletproof — nothing can intercept, hijack, or cover us.

   Architecture (entirely inside the popover host = top layer):
     #clippy-host        popover wrapper (escapes all stacking contexts)
       #clippy-shell     draggable container we own
         <svg>           the character (eyes/brows/body all classed)
         #clippy-costume-layer   overlay for hat PNG/SVG
       .clippy-bubble    speech bubble with action buttons
       .clippy-palette   command palette sheet

   API exposed on NX.clippy:
     - init(), summon(), hide(), enable(), disable()
     - play(actionName)         — wave, hop, dizzy, cartwheel, magic, wobble
     - mood(name)               — neutral, happy, sad, surprised, concerned, angry
     - bubble(text), actionBubble(text, opts)
     - notifyTaskCompleted(), notifyStreak(n), notifyOverdueDetected()
     - openPalette(), offerSong(), offerBrain()
     - setCostume(name, durationMs)
     - moveTo(x, y), moveToEmptyCorner()
     - switchAgent(name) [no-op now, kept for API compat]
   ════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────
  const state = {
    initialized: false,
    enabled: false,
    booted: false,
    host: null,                  // #clippy-host (popover)
    shell: null,                 // #clippy-shell (draggable)
    svg: null,                   // SVG element
    costumeLayer: null,
    bubble: null,
    palette: null,
    audio: null,
    audioPlaying: false,
    dialog: null,
    quoteCorpus: [],
    poolHistory: {},
    moodTimer: null,
    blinkTimer: null,
    randomTimer: null,
    moveTimer: null,
    konamiSeq: [],
    rapidClicks: [],
    quoteCooldownAt: 0,
    songCooldownAt: 0,
    suppressed: false,
    activeAction: null,          // current one-shot action class
    activeActionTimer: null,
    preferences: {
      enabled: null,
      do_not_disturb: false,
      preferred_agent: 'Clippy',
      position_x: null,
      position_y: null,
      dismissed_tips: [],
      total_clicks: 0,
      unlocked: [],
      preferred_persona: null,
      last_seen_at: null,
      reject_count: 0,
      session_count: 0,
    },
  };

  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];

  // Map action name → CSS class + duration (ms). When duration elapses,
  // the class is removed and we return to idle.
  const ACTIONS = {
    wave:        { cls: 'is-waving',       ms: 2200 },
    hop:         { cls: 'is-hopping',      ms: 600 },
    bounce:      { cls: 'is-bouncing',     ms: 1600 },   // v17.12: tall jumps
    wobble:      { cls: 'is-wobbling',     ms: 800 },
    dizzy:       { cls: 'is-dizzy',        ms: 1300 },
    cartwheel:   { cls: 'is-cartwheeling', ms: 1000 },
    magic:       { cls: 'is-magic',        ms: 2000 },
    listen:      { cls: 'is-listening',    ms: 0 },     // toggle, not one-shot
    enter:       { cls: 'is-entering',     ms: 850 },
  };
  const MOODS = {
    neutral:     '',
    happy:       'is-happy',
    sad:         'is-sad',
    surprised:   'is-surprised',
    concerned:   'is-concerned',
    angry:       'is-angry',
    thinking:    'is-thinking',
    // ─── v17 expression system additions ───────────────────────────
    love:        'is-love',         // heart eyes + big smile
    excited:     'is-excited',      // star eyes + tongue out
    sleepy:      'is-sleepy',       // heavy half-lids + cat mouth
    dizzy:       'is-dizzy',        // spiral eyes + wavy mouth (spinning)
    smug:        'is-smug',         // tiny dot eyes + cat smirk
    ko:          'is-ko',           // X eyes (knocked out)
    winking:     'is-winking',      // right-eye wink + tongue
    winking_l:   'is-winking-l',    // left-eye wink + tongue
    determined:  'is-determined',   // focused eyes + flat mouth
    sparkle:     'is-sparkle',      // sparkles around eyes + big smile
    embarrassed: 'is-embarrassed',  // looking away + brighter blush + sweat
    kissy:       'is-kissy',        // closed eyes + kiss pucker
    // v17.14 emotion overlays
    singing:     'is-singing',      // happy crescent eyes + big smile + ♪♫
    confused:    'is-confused',     // dot eyes + flat mouth + ?
    worried:     'is-worried',      // sad eyes + flat mouth + sweat drop
    // v17.16 KAWAII FACE LIBRARY — 22 new compound expressions
    crying:        'is-crying',        // tearful eyes + frown + single tear
    sobbing:       'is-sobbing',       // shut + frown + tears streaming
    wailing:       'is-wailing',       // shut + open mouth + tears streaming
    pouty:         'is-pouty',         // default + small pucker mouth
    gasp:          'is-gasp',          // dots + O + sweat
    shocked:       'is-shocked',       // wide-shock eyes + O mouth
    eye_roll:      'is-eye-roll',      // looking up + flat (unimpressed)
    peeved:        'is-peeved',        // looking down + frown
    drooling:      'is-drooling',      // happy + saliva drip
    laughing:      'is-laughing',      // squint XX + open laugh
    super_excited: 'is-super-excited', // sparkle eyes + open laugh
    mortified:     'is-mortified',     // wide-shock + tape mouth + heavy blush
    frustrated:    'is-frustrated',    // angry brows + flat + sweat
    tipsy:         'is-tipsy',         // happy + red clown nose
    singing_star:  'is-singing-star',  // shut + star mouth + music
    melancholy:    'is-melancholy',    // looking down (bittersweet)
    bashful:       'is-bashful',       // glance away + heart blush
    smitten:       'is-smitten',       // heart eyes + heart blush (deeper than love)
    bunny:         'is-bunny',         // default + cute toothy smile
    stunned:       'is-stunned',       // wide-shock + tape (speechless)
    proud:         'is-proud',         // shut crescents + big smile
    disappointed:  'is-disappointed',  // sleepy half-lids + frown
    // v17.17 CONTEXT PERSONALITIES — tied to NEXUS views
    genius:        'is-genius',        // equipment — glowing focused eyes + flat
    disgusted:     'is-disgusted',     // cleaning — half-lidded yuck + wavy mouth + sweat
    studious:      'is-studious',      // education — reading glasses + bunny teeth
    strategist:    'is-strategist',    // board — determined + cat smirk
    organized:     'is-organized',     // inventory — dot eyes + cat smile
    // v17.20 CONDESCENDING — for the smug lesson mode
    condescending: 'is-condescending', // half-lidded haughty + cat smirk + raised inner brows
    // v17.23 SULKING — Duolingo-style turn-the-back
    sulking:       'is-sulking',       // face hidden, back-tuft visible, dim glow
    deep_sulking:  'is-deep-sulking',  // sulk + extra dim (after extended absence)
  };


  // ─── Utilities ──────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function getCurrentUser() {
    try { return (window.NX && NX.currentUser) || null; } catch (e) { return null; }
  }
  // v17.19: per-user localStorage namespacing. Each user gets their own
  // memories, prefs, pool history, feelings, game scores. Falls back to
  // legacy global keys if no user is signed in.
  function userKey(base) {
    const u = getCurrentUser();
    return (u && u.id) ? `${base}_u${u.id}` : base;
  }

  // ════════════════════════════════════════════════════════════════════
  // v17.25 CLOUD SYNC — Supabase-backed cross-device persistence.
  // Pattern: optimistic local writes, debounced cloud push, pull on
  // session start. Last-Write-Wins by updated_at timestamp.
  //
  // Requires Supabase table `clippy_cloud_state` with columns:
  //   user_id (integer PK)
  //   memories (jsonb)
  //   preferences (jsonb)
  //   feelings (jsonb)
  //   gacha (jsonb)
  //   highscores (jsonb)
  //   updated_at (timestamptz default now())
  // ════════════════════════════════════════════════════════════════════

  function getSupabaseClient() {
    // Reuse the existing NEXUS-wide Supabase client if available
    return (typeof window !== 'undefined') && (window.NX && window.NX.supabase) || null;
  }

  function showSyncIndicator(state_, message) {
    let el = document.querySelector('.clippy-sync-indicator');
    if (!el) {
      el = document.createElement('div');
      el.className = 'clippy-sync-indicator';
      document.body.appendChild(el);
    }
    el.classList.remove('is-syncing', 'is-synced', 'is-failed');
    if (state_) el.classList.add('is-' + state_);
    el.textContent = message || (state_ === 'syncing' ? '☁ syncing…' : state_ === 'synced' ? '☁ ✓' : state_ === 'failed' ? '☁ retry' : '☁');
    el.classList.add('is-visible');
    setTimeout(() => el && el.classList.remove('is-visible'), 2500);
  }

  function collectLocalState() {
    return {
      memories:    state.memories || [],
      preferences: state.preferences || {},
      feelings:    state.feelings || {},
      gacha:       (function() { try { return JSON.parse(localStorage.getItem(userKey('clippy_gacha')) || 'null'); } catch (e) { return null; } })(),
      highscores:  (function() { try { return JSON.parse(localStorage.getItem(userKey('clippy_highscores')) || 'null'); } catch (e) { return null; } })(),
    };
  }

  async function cloudPush() {
    const sb = getSupabaseClient();
    const user = getCurrentUser();
    if (!sb || !user || !user.id) return false;
    if (!navigator.onLine) {
      state.cloudPushPending = true;
      return false;
    }
    showSyncIndicator('syncing');
    const payload = collectLocalState();
    payload.user_id = user.id;
    payload.updated_at = new Date().toISOString();
    try {
      const { error } = await sb.from('clippy_cloud_state')
        .upsert(payload, { onConflict: 'user_id' });
      if (error) {
        showSyncIndicator('failed', '☁ retry later');
        state.cloudPushPending = true;
        return false;
      }
      showSyncIndicator('synced');
      state.cloudPushPending = false;
      state.cloudLastPushAt = Date.now();
      return true;
    } catch (e) {
      showSyncIndicator('failed', '☁ offline');
      state.cloudPushPending = true;
      return false;
    }
  }

  async function cloudPull() {
    const sb = getSupabaseClient();
    const user = getCurrentUser();
    if (!sb || !user || !user.id) return false;
    if (!navigator.onLine) return false;
    try {
      const { data, error } = await sb.from('clippy_cloud_state')
        .select('*').eq('user_id', user.id).maybeSingle();
      if (error || !data) return false;
      // LWW: only apply if cloud is newer than our last local write
      const cloudTime = new Date(data.updated_at || 0).getTime();
      const localTime = state.preferences.last_local_write || 0;
      if (cloudTime <= localTime) return false;   // local is newer, skip
      // Merge cloud → local
      if (Array.isArray(data.memories)) {
        state.memories = data.memories;
        localStorage.setItem(userKey('clippy_memories'), JSON.stringify(data.memories));
      }
      if (data.preferences && typeof data.preferences === 'object') {
        Object.assign(state.preferences, data.preferences);
        savePreferences();
      }
      if (data.feelings && typeof data.feelings === 'object') {
        state.feelings = data.feelings;
        localStorage.setItem(userKey('clippy_feelings'), JSON.stringify(data.feelings));
      }
      if (data.gacha) {
        localStorage.setItem(userKey('clippy_gacha'), JSON.stringify(data.gacha));
      }
      if (data.highscores) {
        localStorage.setItem(userKey('clippy_highscores'), JSON.stringify(data.highscores));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Debounced push — accumulate changes, sync at most every 8 seconds
  function cloudPushQueued() {
    state.preferences.last_local_write = Date.now();
    if (state.cloudPushTimer) clearTimeout(state.cloudPushTimer);
    state.cloudPushTimer = setTimeout(() => cloudPush(), 8000);
  }

  function initCloudSync() {
    if (state.cloudSyncInited) return;
    state.cloudSyncInited = true;
    // Pull on init (background — don't block)
    cloudPull().then(applied => {
      if (applied) {
        applyPersistedCostume();   // re-apply if costume changed via cloud
        // Discrete bubble informing the user we synced
        setTimeout(() => {
          if (!state.bubble && state.enabled) {
            bubble('☁ Synced from cloud!', { autoHide: 2500, eyebrow: '☁ SYNC' });
          }
        }, 1800);
      }
    });
    // Listen for connectivity changes — push pending writes when back online
    window.addEventListener('online', () => {
      showSyncIndicator('syncing', '☁ back online');
      if (state.cloudPushPending) cloudPush();
    });
    window.addEventListener('offline', () => {
      showSyncIndicator('failed', '☁ offline');
    });
    // Periodic push (safety net for missed debounce)
    setInterval(() => {
      if (state.cloudPushPending) cloudPush();
    }, 5 * 60000);
  }


  function fmt(line, vars) {
    if (!vars) return line;
    return line.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  }


  // ─── Dialog selection (anti-repeat) ─────────────────────────────────
  // ─── INLINE DIALOG POOLS (v15.5) ───────────────────────────────────
  // Whimsical / respectful / surroundings-aware lines shipped right
  // here in code, so they work even if clippy-dialog.json hasn't been
  // updated yet. pickFromPool() prefers the JSON pool when present;
  // these arrays are used as fallbacks. Treats Clippy as a polite,
  // funny, slightly-aware-he's-a-paperclip companion.
  const INLINE_POOLS = {
    ticklish: [
      "Hee hee! Stop that!",
      "Gahaha — okay okay!",
      "I'm ticklish, I told you!",
      "Hee hee hee~",
      "Bzzt! That tickles!",
      "Whoa whoa whoa — easy!",
      "Stop poking me, you!",
      "Ack — fine, I'll move!",
    ],
    apologetic_move: [
      "Oh! Sorry, I'll move.",
      "Whoops — didn't mean to be in the way.",
      "Pardon me!",
      "Excuse me, just sliding over…",
      "My bad! Scooching.",
      "Don't mind me — bzzt!",
      "Oh no, was I in the way? So sorry!",
    ],
    whimsical_idle: [
      "Bzzt. Just hanging out.",
      "The pixels feel nice today.",
      "Did you know paperclips are basically immortal?",
      "I count my reflections sometimes.",
      "Just thinking about… stuff.",
      "I love when the screen is busy.",
      "Bing bing bing!",
      "If a paperclip falls in a forest…",
      "I'm tiny but my dreams are big.",
      "Floating around, having thoughts.",
    ],
    noticing_button: [
      "Ooh, that's a fun-looking button.",
      "I see what you're looking at.",
      "Bet that does something cool.",
      "Click it click it click it!",
    ],
    going_quiet: [
      "I'll be here if you need me.",
      "Take your time. No rush.",
      "I'll just chill over here.",
      "Tap me when you're ready.",
    ],
    ready_to_help: [
      "Need anything?",
      "I'm here, just say the word.",
      "Bzzt — at your service.",
      "Hi there!",
      "Anything I can help with?",
    ],
    yawn: [
      "*yawn*",
      "Mmgh… long day?",
      "Just stretching.",
      "Don't mind me — sleepy paperclip noises.",
    ],
    morning: [
      "Morning! Ready to do the thing?",
      "Bright and early! Bzzt.",
      "Mmm, fresh pixels.",
      "Good morning, friend!",
      "*stretches metallic limbs*",
    ],
    afternoon: [
      "Afternoon! How's it going?",
      "Hope your day's been good.",
      "Bzzt — afternoon check-in.",
      "Lunch was good, I bet.",
    ],
    evening: [
      "Evening, friend.",
      "Winding down? Same.",
      "The screen is calmer at night.",
      "Cozy hours.",
    ],
    night: [
      "Burning the midnight oil?",
      "Late shift, huh? I'll keep you company.",
      "Quiet hours. I like these.",
      "Don't forget to rest, paperclip's orders.",
    ],
    welcome_back: [
      "Welcome back!",
      "There you are! I waited.",
      "Bzzt — missed you.",
      "Oh, hi again!",
      "You're back! I was practicing my sparkles.",
    ],
    fast_scroll: [
      "Whoa, slow down!",
      "Wheee! Where are we going?",
      "Bzzt! Speed-reader detected.",
      "Easy, easy — I'm trying to keep up.",
    ],
    drag_start: [
      "Wheee!",
      "Where are we going?",
      "Carry me carefully!",
      "Oh — okay!",
      "*flailing politely*",
    ],
    drag_release: [
      "Thanks for the ride!",
      "Hmf. New view.",
      "Comfortable. Ish.",
      "Good throw!",
      "I'll just settle in here.",
    ],
    resize: [
      "Whoosh — different shape!",
      "New dimensions detected.",
      "Adjusting…",
    ],
    milestone_50: [
      "Fifty taps! We're getting close.",
      "50 clicks. I see you, friend.",
    ],
    milestone_250: [
      "Two hundred fifty! That's commitment.",
      "We're past 250. Thanks for the company.",
    ],
    milestone_500: [
      "Five hundred clicks! I'm flattered.",
      "500. You really do like me. Bzzt.",
    ],
    milestone_1000: [
      "ONE THOUSAND. That's a lot of attention. Thank you.",
      "1,000 taps. We're old friends now.",
    ],
  };

  function pickFromPool(poolKey, fallback) {
    const pool = state.dialog && state.dialog[poolKey];
    if (!pool || !pool.length) {
      // Fall back to inline pools if the JSON didn't ship this key
      const inline = INLINE_POOLS[poolKey];
      if (inline && inline.length) {
        return inline[Math.floor(Math.random() * inline.length)];
      }
      // Caller-provided fallback: string OR array
      if (Array.isArray(fallback)) {
        return fallback[Math.floor(Math.random() * fallback.length)];
      }
      return fallback || '';
    }
    const history = state.poolHistory[poolKey] || [];
    // Track ~40% of pool size as recent history (clamped 2–50).
    // Big pools (roman_facts=298) → tracks 50, leaves 248 fresh candidates.
    // Small pools (after_yes=5)   → tracks 2,  leaves 3 candidates.
    // This makes repeats genuinely rare without ever blocking the whole pool.
    // v17.9: anti-repetition deep fix. Track 60% of pool (min 5, max 100)
    // so recent picks stay blocked much longer. User reported repeats.
    const histSize = Math.max(5, Math.min(100, Math.floor(pool.length * 0.6)));
    const candidates = pool.length > histSize + 1
      ? pool.filter(line => !history.includes(line))
      : pool;
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    state.poolHistory[poolKey] = [picked, ...history].slice(0, histSize);
    persistPoolHistory();
    return substituteVars(picked);
  }
  // v17.6: replace {name} (and other vars) with user data
  function substituteVars(text) {
    if (!text || typeof text !== 'string') return text;
    if (text.indexOf('{') === -1) return text;
    const name = (state.preferences && state.preferences.user_name) || 'friend';
    return text
      .replace(/\{name\}/g, name)
      .replace(/\{streak\}/g, String(state.preferences && state.preferences.daily_streak || 0))
      .replace(/\{score\}/g, String(state.minigameScore || 0));
  }
  function persistPoolHistory() {
    try { localStorage.setItem(userKey('clippy_pool_history'), JSON.stringify(state.poolHistory)); } catch (e) {}
  }
  function loadPoolHistory() {
    try {
      const raw = localStorage.getItem(userKey('clippy_pool_history'));
      if (raw) state.poolHistory = JSON.parse(raw) || {};
    } catch (e) { state.poolHistory = {}; }
  }

  // ════════════════════════════════════════════════════════════════════
  // v17.7 MEMORY NODES — deposit/recall system
  //   Clippy deposits significant moments as memory nodes. The galaxy
  //   (or any listener) renders them. Nodes persist in localStorage and
  //   are the source of truth — galaxy is just one possible viewer.
  //
  // v17.8 MEMORY PALACE — Roman method-of-loci. Every memory is also
  //   filed into one of seven thematic rooms (atrium, tablinum, lararium,
  //   triclinium, bibliotheca, hortus, peristylium). Cicero used this
  //   technique; now Trajan does too.
  // ════════════════════════════════════════════════════════════════════
  const MAX_MEMORIES = 200;
  const CORNERSTONE_TYPES = ['first_meet', 'anniversary'];   // never auto-dropped
  const MEMORY_COLORS = {
    first_meet:       '#ff4d8a',    // pink — the moment we met
    name_set:         '#ffd24a',    // gold — you gave me your name
    milestone:        '#7df0ff',    // cyan — click milestones
    streak:           '#9adff5',    // pale cyan — daily streaks
    special_day:      '#cbb0f5',    // lavender — holidays
    first_view_visit: '#a8e4ff',    // pale blue — exploration
    anniversary:      '#ff6e9e',    // hot pink — annual return
    costume_unlock:   '#ffec70',    // bright yellow — unlocked accessories
  };

  // v17.8: Roman memory palace structure. Seven rooms; each memory
  // node is auto-assigned to one based on type. Galaxy may render
  // each room as a distinct cluster/sector for spatial categorization.
  const PALACE_ROOMS = {
    atrium: {
      label: 'Atrium',
      description: 'The entrance — first encounters and identity.',
      glyph: '🏛️',
      color: '#ffd24a',
    },
    tablinum: {
      label: 'Tablinum',
      description: 'The records office — milestones and achievements.',
      glyph: '📜',
      color: '#7df0ff',
    },
    lararium: {
      label: 'Lararium',
      description: 'The household shrine — sacred days and anniversaries.',
      glyph: '🕯️',
      color: '#cbb0f5',
    },
    bibliotheca: {
      label: 'Bibliotheca',
      description: 'The library — knowledge and discovery.',
      glyph: '📚',
      color: '#a8e4ff',
    },
    triclinium: {
      label: 'Triclinium',
      description: 'The dining hall — conversations and moments shared.',
      glyph: '🍇',
      color: '#9adff5',
    },
    hortus: {
      label: 'Hortus',
      description: 'The garden — joy, compliments, and small delights.',
      glyph: '🌿',
      color: '#7fffa8',
    },
    peristylium: {
      label: 'Peristylium',
      description: 'The colonnade — paths walked together over time.',
      glyph: '🏺',
      color: '#ff9bbb',
    },
  };

  // Map memory types → palace rooms. Auto-categorization.
  function roomForType(type) {
    switch (type) {
      case 'first_meet':       return 'atrium';
      case 'name_set':         return 'atrium';
      case 'milestone':        return 'tablinum';
      case 'streak':           return 'tablinum';
      case 'anniversary':      return 'lararium';
      case 'special_day':      return 'lararium';
      case 'first_view_visit': return 'bibliotheca';
      case 'costume_unlock':   return 'hortus';
      case 'conversation':     return 'triclinium';
      case 'journey':          return 'peristylium';
      default:                 return 'atrium';
    }
  }

  function loadMemories() {
    try {
      const raw = localStorage.getItem(userKey('clippy_memories'));
      state.memories = raw ? (JSON.parse(raw) || []) : [];
    } catch (e) { state.memories = []; }
  }
  function saveMemories() {
    try { localStorage.setItem(userKey('clippy_memories'), JSON.stringify(state.memories || [])); } catch (e) {}
  }

  // Deposit a memory node. Called on significant events. Saves to disk,
  // notifies the galaxy via NX.galaxy.addClippyMemory() if present, AND
  // broadcasts the 'clippy:memory-deposited' event so any other listener
  // can render or process it. High-importance deposits also surface a
  // brief "I'll remember this" bubble.
  function depositMemory(type, label, data, importance) {
    if (!state.memories) loadMemories();
    importance = Math.max(1, Math.min(5, importance || 2));
    const room = roomForType(type);
    const node = {
      id: 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      type: type,
      label: label,
      data: data || {},
      importance: importance,
      timestamp: new Date().toISOString(),
      source: 'clippy',
      room: room,                          // v17.8: palace room assignment
      hint: {
        color: MEMORY_COLORS[type] || '#7df0ff',
        size: importance * 2,
        pulse: importance >= 4,
        room: room,                        // also surfaced in hint for galaxy
        room_color: PALACE_ROOMS[room].color,
      },
    };
    state.memories.push(node);
    // Cap at MAX_MEMORIES: cornerstones never dropped; otherwise lowest-
    // importance + oldest drops first.
    if (state.memories.length > MAX_MEMORIES) {
      const sorted = state.memories.slice().sort((a, b) => {
        const aCorner = CORNERSTONE_TYPES.includes(a.type) ? 1 : 0;
        const bCorner = CORNERSTONE_TYPES.includes(b.type) ? 1 : 0;
        if (aCorner !== bCorner) return bCorner - aCorner;
        if (a.importance !== b.importance) return b.importance - a.importance;
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      state.memories = sorted.slice(0, MAX_MEMORIES);
    }
    saveMemories();
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
    // Galaxy notification — try direct API first, then dispatch event
    try {
      if (window.NX && window.NX.galaxy && typeof window.NX.galaxy.addClippyMemory === 'function') {
        window.NX.galaxy.addClippyMemory(node);
      }
      window.dispatchEvent(new CustomEvent('clippy:memory-deposited', { detail: node }));
    } catch (e) {}
    // Visible feedback: subtle gold sparkle on every deposit
    if (state.shell && state.enabled && !state.suppressed) {
      try { spawnParticles({ count: 2, type: 'sparkle' }); } catch (_) {}
    }
    // High-importance deposits get a delayed "I'll remember this" bubble
    if (importance >= 4 && state.enabled) {
      setTimeout(() => {
        if (!state.bubble && state.enabled && !state.suppressed) {
          spawnParticles({ count: 6, type: 'sparkle' });
          mood('sparkle', 3000);
          bubble(pickFromPool('memory_deposited'), { autoHide: 4500, eyebrow: 'MEMORY' });
        }
      }, 5500);
    }
    return node;
  }

  // Pull a random memory (optionally filtered). Used for recall bubbles.
  function recallRandomMemory(filter) {
    if (!state.memories || !state.memories.length) return null;
    let candidates = state.memories;
    if (typeof filter === 'function') candidates = candidates.filter(filter);
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Show a recall bubble — "Earlier today: ..." / "Long ago: ..."
  function showRecallBubble() {
    // v17.11: 30% chance to prioritize super_chat memories — the engraved
    // questions from the oracle hour. Quirky callbacks like:
    //   "Remember when you asked me '...'? I still think about that."
    if (Math.random() < 0.30) {
      const superMem = recallRandomMemory(m => m.type === 'super_chat');
      if (superMem && superMem.data && superMem.data.question) {
        const prefix = pickFromPool('super_chat_recall');
        const text = prefix.replace('{question}', superMem.data.question);
        mood('sparkle', 6000);
        bubble(text, { autoHide: 7000, eyebrow: '✨ ENGRAVED' });
        spawnParticles({ count: 4, type: 'sparkle' });
        return true;
      }
    }
    const mem = recallRandomMemory();
    if (!mem) return false;
    const days = Math.floor((Date.now() - new Date(mem.timestamp).getTime()) / 86400000);
    let prefix;
    if (days <= 0)       prefix = 'Earlier today: ';
    else if (days === 1) prefix = 'Yesterday: ';
    else if (days < 7)   prefix = `${days} days ago: `;
    else if (days < 31)  prefix = 'A few weeks ago: ';
    else if (days < 90)  prefix = 'A while back: ';
    else if (days < 365) prefix = 'Months ago: ';
    else                 prefix = 'A year+ ago: ';
    mood('thinking', 5500);
    bubble(prefix + mem.label, { autoHide: 6000, eyebrow: 'MEMORY' });
    return true;
  }

  // v17.8: aggregate the memory bank — counts per room, totals, oldest/newest.
  // Used by the galaxy or any UI that wants to summarize the palace.
  function getMemoryBank() {
    const mems = state.memories || [];
    const rooms = {};
    Object.keys(PALACE_ROOMS).forEach(r => {
      rooms[r] = Object.assign({}, PALACE_ROOMS[r], { count: 0, memories: [] });
    });
    let oldest = null, newest = null;
    mems.forEach(m => {
      const r = m.room || roomForType(m.type);
      if (rooms[r]) {
        rooms[r].count++;
        rooms[r].memories.push(m);
      }
      const t = new Date(m.timestamp).getTime();
      if (!oldest || t < new Date(oldest.timestamp).getTime()) oldest = m;
      if (!newest || t > new Date(newest.timestamp).getTime()) newest = m;
    });
    // Sort each room's memories by timestamp descending
    Object.keys(rooms).forEach(r => {
      rooms[r].memories.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    });
    return {
      total: mems.length,
      capacity: MAX_MEMORIES,
      rooms: rooms,
      oldest: oldest,
      newest: newest,
      cornerstones: mems.filter(m => CORNERSTONE_TYPES.includes(m.type)),
    };
  }

  // v17.8: tour the memory palace — Clippy reads off room summaries
  // one at a time via chained bubbles. Triggered by long-press menu.
  function tourPalace() {
    const bank = getMemoryBank();
    if (bank.total === 0) {
      bubble("My memory palace is empty. Let's fill it together!", { autoHide: 4500, eyebrow: 'MEMORY' });
      return;
    }
    closeActionBubble();
    mood('thinking', 8000);
    const occupied = Object.entries(bank.rooms).filter(([k, r]) => r.count > 0);
    if (!occupied.length) return;
    let i = 0;
    const showNext = () => {
      if (i >= occupied.length || !state.enabled) {
        // Final bubble: total
        setTimeout(() => {
          bubble(`That's ${bank.total} memories across ${occupied.length} rooms. Thank you for them all.`,
            { autoHide: 5500, eyebrow: 'PALACE' });
          mood('love', 4000);
          spawnParticles({ count: 8, type: 'heart' });
        }, 500);
        return;
      }
      const [key, room] = occupied[i++];
      bubble(`${room.glyph} ${room.label}: ${room.count} ${room.count === 1 ? 'memory' : 'memories'}. ${room.description}`,
        { autoHide: 5000, eyebrow: room.label.toUpperCase() });
      spawnParticles({ count: 3, type: 'sparkle' });
      setTimeout(showNext, 5400);
    };
    showNext();
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.10 OFFLINE INTELLIGENCE — feelings, tickle, clock, stress, dance
  //   Everything runs locally. No network calls. He FEELS smart because
  //   he tracks a dozen signals and responds contextually. Pattern-based
  //   pseudo-intelligence — fast, private, reliable.
  // ════════════════════════════════════════════════════════════════════

  // ─── FEELINGS MODEL ────────────────────────────────────────────────
  // Five gauges. Each 0-100, persistent across sessions. Update from
  // user behavior — interactions, idle, time, etc. The dominant feeling
  // shapes mood expression + pool selection. The user never SEES the
  // numbers; they just feel the personality shift.
  function defaultFeelings() {
    return { happiness: 60, energy: 60, affection: 50, attention_need: 0, ticklish: 0 };
  }
  function loadFeelings() {
    try {
      const raw = localStorage.getItem(userKey('clippy_feelings'));
      const obj = raw ? JSON.parse(raw) : {};
      state.feelings = Object.assign(defaultFeelings(), obj || {});
    } catch (e) { state.feelings = defaultFeelings(); }
  }
  function saveFeelings() {
    try { localStorage.setItem(userKey('clippy_feelings'), JSON.stringify(state.feelings || {})); } catch (e) {}
  }
  function adjustFeeling(key, delta) {
    if (!state.feelings) loadFeelings();
    state.feelings[key] = Math.max(0, Math.min(100, (state.feelings[key] || 0) + delta));
    saveFeelings();
  }
  // Returns the dominant emotional state — drives behavior choices
  function dominantFeeling() {
    if (!state.feelings) loadFeelings();
    const f = state.feelings;
    if (f.ticklish > 50)      return 'ticklish';
    if (f.attention_need > 70) return 'lonely';
    if (f.happiness < 25)     return 'sad';
    if (f.happiness > 80 && f.energy > 60) return 'overjoyed';
    if (f.energy < 25)        return 'tired';
    if (f.affection > 80)     return 'loving';
    if (f.happiness > 60 && f.affection > 60) return 'content';
    return 'neutral';
  }
  // Periodic decay: feelings drift toward baseline when nothing happens.
  // Attention_need rises when ignored. Energy drops over a session.
  function decayFeelings() {
    if (!state.feelings) loadFeelings();
    const idle = Date.now() - (state.lastInteractionAt || Date.now());
    const minutes = idle / 60000;
    if (minutes > 2) adjustFeeling('attention_need', +2);
    if (minutes > 5) adjustFeeling('happiness', -1);
    if (minutes > 10) adjustFeeling('affection', -1);
    // Gentle pull toward 50 baseline
    ['happiness', 'energy', 'affection'].forEach(k => {
      const v = state.feelings[k];
      if (v > 50) adjustFeeling(k, -0.5);
      else if (v < 50) adjustFeeling(k, 0.5);
    });
    if (state.feelings.ticklish > 0) adjustFeeling('ticklish', -3);
    saveFeelings();
  }

  // ─── TICKLE DETECTION ──────────────────────────────────────────────
  // Four rapid taps within 1.2s = tickle. Joy spike, jiggle animation,
  // heart particles, big affection boost. The signature interaction.
  state.tickleTaps = [];
  function recordPopForTickle() {
    const now = Date.now();
    state.tickleTaps.push(now);
    state.tickleTaps = state.tickleTaps.filter(t => now - t < 1200);
    if (state.tickleTaps.length >= 4) {
      triggerTickle();
      state.tickleTaps = [];
    }
  }
  function triggerTickle() {
    if (!state.shell || state.suppressed) return;
    closeActionBubble();
    state.shell.classList.add('is-jiggling');
    mood('happy', 4500);
    bubble(pickFromPool('tickle_response'), { autoHide: 3500, eyebrow: 'TICKLE' });
    spawnParticles({ count: 10, type: 'heart' });
    playTone('mwah');
    adjustFeeling('happiness', +15);
    adjustFeeling('affection', +8);
    adjustFeeling('ticklish', +50);
    adjustFeeling('attention_need', -30);
    try { if (navigator.vibrate) navigator.vibrate([15, 25, 15, 25, 15]); } catch (_) {}
    setTimeout(() => {
      if (state.shell) state.shell.classList.remove('is-jiggling');
    }, 2800);
  }

  // ─── HOURLY CLOCK AWARENESS ────────────────────────────────────────
  // On every hour change, possibly bubble a time-themed remark. Special
  // pools for morning/noon/evening/late. Otherwise generic clock_remark.
  state.lastHourSeen = -1;
  function hourlyCheck() {
    if (!state.enabled || !state.shell || state.suppressed || state.bubble) return;
    const h = new Date().getHours();
    if (state.lastHourSeen === -1) {
      state.lastHourSeen = h;
      return;   // first observation, no bubble
    }
    if (h === state.lastHourSeen) return;
    state.lastHourSeen = h;
    if (Math.random() > 0.30) return;   // 30% chance on hour change
    let pool;
    if (h >= 5 && h < 11)       pool = 'hour_morning';
    else if (h >= 11 && h < 14) pool = 'hour_noon';
    else if (h >= 17 && h < 22) pool = 'hour_evening';
    else if (h >= 22 || h < 5)  pool = 'hour_late';
    else                        pool = 'clock_remark';
    bubble(pickFromPool(pool), { autoHide: 4500, eyebrow: 'HOUR' });
  }

  // ─── STRESS CHECK ──────────────────────────────────────────────────
  // Detect stress markers: long session, late hour, lots of overdues.
  // Once per day, offer a calm-down options bubble.
  state.sessionStartAt = Date.now();
  function checkStressMarkers() {
    if (!state.enabled || state.suppressed || state.bubble) return;
    const todayStr = new Date().toDateString();
    if (state.preferences.stress_check_date === todayStr) return;
    const sessionMin = (Date.now() - state.sessionStartAt) / 60000;
    const hour = new Date().getHours();
    const lateNight = hour >= 22 || hour < 6;
    const longSession = sessionMin > 60;
    const overworked = (state.lastMetrics && state.lastMetrics.overdueCount >= 3);
    if (!(longSession || (lateNight && sessionMin > 20) || overworked)) return;
    state.preferences.stress_check_date = todayStr;
    savePreferences();
    offerStressCheckIn();
  }
  function offerStressCheckIn() {
    mood('worried', 6000);              // v17.14: sweat drop says "I'm concerned"
    actionBubble(pickFromPool('stress_check_offer'), {
      eyebrow: 'CARE',
      actions: [
        { label: 'Yeah, fine', cls: 'is-primary', onClick: () => {
            adjustFeeling('happiness', +5);
            bubble("Glad to hear. I'm here if anything changes.", { autoHide: 4000 });
        }},
        { label: 'Could be better', onClick: offerCalmMenu },
      ]
    });
  }
  function offerCalmMenu() {
    closeActionBubble();
    actionBubble("Pick one — what helps right now?", {
      actions: [
        { label: '🌿 Sit quietly with me', onClick: () => {
          mood('sleepy', 9000);
          bubble(pickFromPool('stress_resp_calm'), { autoHide: 5500 });
          adjustFeeling('affection', +5);
        }},
        { label: '😄 Joke me', onClick: () => {
          mood('winking', 4500);
          bubble(pickFromPool('dad_jokes'), { autoHide: 5500 });
          adjustFeeling('happiness', +8);
        }},
        { label: '🏛️ Tell me history', onClick: () => {
          mood('thinking', 6000);
          bubble(pickFromPool('roman_facts'), { autoHide: 6500, eyebrow: 'ROMA' });
          adjustFeeling('happiness', +5);
        }},
        { label: '🎵 Theme song', onClick: () => { triggerSongAndDance(); }},
      ]
    });
  }

  // ─── MUSIC + DANCE INTEGRATION ─────────────────────────────────────
  // Re-uses existing offerSong()/playSong() audio system. When playing,
  // Clippy adds is-dancing class for animated boogie. Stops when song ends.
  function triggerSongAndDance() {
    closeActionBubble();
    if (typeof offerSong === 'function') {
      offerSong('user_requested');
    } else if (typeof playSong === 'function') {
      playSong();
    }
    setTimeout(startDancing, 800);
  }
  function startDancing() {
    if (!state.shell) return;
    state.shell.classList.add('is-dancing');
    mood('singing', 30000);                 // v17.14: ♪♫ notes float
    bubble(pickFromPool('dance_announce'), { autoHide: 4500 });
    spawnParticles({ count: 12, type: 'sparkle' });
    adjustFeeling('happiness', +10);
    adjustFeeling('energy', +15);
    // Stop after ~30s (typical song length)
    setTimeout(() => {
      if (state.shell) state.shell.classList.remove('is-dancing');
    }, 30000);
  }
  function stopDancing() {
    if (state.shell) state.shell.classList.remove('is-dancing');
  }

  // ─── DOMINANT-FEELING BUBBLE ROUTER ────────────────────────────────
  // Called from showQuickBubble before regular rotation. If dominant
  // feeling is strong, bias toward feeling-specific dialog so Clippy
  // expresses what he's actually feeling.
  function pickFeelingPool() {
    const feel = dominantFeeling();
    const roll = Math.random();
    if (feel === 'lonely' && roll < 0.6) {
      bubble(pickFromPool('needs_attention'), { autoHide: 3800, eyebrow: 'LONELY' });
      mood(roll < 0.2 ? 'melancholy' : 'sad', 3500);   // v17.16: deeper melancholy
      adjustFeeling('attention_need', -40);
      return true;
    }
    if (feel === 'sad' && roll < 0.5) {
      bubble(pickFromPool('sad_remarks'), { autoHide: 4500, eyebrow: 'QUIET' });
      // v17.16: very-low happiness → crying mood instead of just sad
      const veryLow = state.feelings && state.feelings.happiness < 15;
      mood(veryLow ? 'crying' : (roll < 0.25 ? 'peeved' : 'sad'), 4500);
      return true;
    }
    if ((feel === 'overjoyed' || feel === 'loving') && roll < 0.5) {
      bubble(pickFromPool('happy_remarks'), { autoHide: 4000, eyebrow: 'JOY' });
      // v17.16: peak happiness → super_excited; peak affection → smitten
      let m = feel === 'loving' ? 'love' : 'excited';
      if (feel === 'loving' && state.feelings && state.feelings.affection > 92) m = 'smitten';
      if (feel === 'overjoyed' && state.feelings && state.feelings.happiness > 92) m = 'super_excited';
      mood(m, 4000);
      spawnParticles({ count: 4, type: 'heart' });
      return true;
    }
    if (feel === 'tired' && roll < 0.4) {
      bubble("*tired orb*", { autoHide: 3000 });
      mood('sleepy', 4000);
      return true;
    }
    return false;
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.11 CONVERSATION + SUPER-CHAT + FAMILIARITY + NEXUS HOOKS
  // ════════════════════════════════════════════════════════════════════

  // ─── FAMILIARITY STAGES ───────────────────────────────────────────
  // Compute days-known from first acceptance. Four stages shape the
  // tone of greetings and unlock callback dialog at higher tiers.
  function daysKnown() {
    const accepted = state.preferences.accepted_at;
    if (!accepted) return 0;
    const diff = Date.now() - new Date(accepted).getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  }
  function familiarityStage() {
    const d = daysKnown();
    if (d < 7)   return 1;   // formal, "friend"
    if (d < 30)  return 2;   // casual, sometimes by name
    if (d < 90)  return 3;   // by name always, inside jokes
    return 4;                // old friend, callbacks to memories
  }
  function familiarityGreeting() {
    return pickFromPool('stage_' + familiarityStage() + '_greeting');
  }

  // ─── PATTERN-MATCHING CONVERSATION ────────────────────────────────
  // Local keyword matcher. Input → matched rule → response.
  // No network. No real "AI." But with 3,500+ dialog lines as response
  // corpus, it feels astonishingly responsive.
  const CHAT_KEYWORDS = [
    // Greetings + farewells
    { pat: /\b(hi|hello|hey|sup|yo|salve|konnichiwa|bonjour|hola|namaste|aloha)\b/i,
      respond: () => bubbleStage('greeting'),
      mood: 'happy' },
    { pat: /\b(bye|goodbye|farewell|vale|sayonara|adios|au revoir|ciao)\b/i,
      pool: 'multilang_bye', mood: 'sad' },
    // History topics
    { pat: /\b(rome|roman|caesar|augustus|trajan|hadrian|nero|marcus aurelius|cicero|colosseum)\b/i,
      pool: 'roman_facts', mood: 'thinking', eyebrow: 'ROMA' },
    { pat: /\b(athens?|athenian|democracy|pericles|socrates|plato|parthenon|acropolis)\b/i,
      pool: 'athens_facts', mood: 'thinking', eyebrow: 'ATHENS' },
    { pat: /\b(sparta|spartan|leonidas|thermopylae|300|agoge|helot)\b/i,
      pool: 'sparta_facts', mood: 'determined', eyebrow: 'SPARTA' },
    { pat: /\b(persia|persian|iran|cyrus|darius|xerxes|zoroaster|achaemenid|sassanid|persepolis)\b/i,
      pool: 'persian_facts', mood: 'thinking', eyebrow: 'PERSIA' },
    { pat: /\b(hispania|spain|spanish|iberia|moorish|cordoba|toledo|granada|al-andalus)\b/i,
      pool: 'hispania_facts', mood: 'thinking', eyebrow: 'HISPANIA' },
    { pat: /\b(greek|greece|hellenic|hellas|olympics?|homer|aristotle|alexander)\b/i,
      pool: 'greek_facts', mood: 'thinking', eyebrow: 'HELLAS' },
    { pat: /\b(battle|war|fight|conquest|hannibal|cannae|waterloo|stalingrad|crusade)\b/i,
      pool: 'battle_facts', mood: 'determined', eyebrow: 'BATTLE' },
    // Topic categories
    { pat: /\b(animal|creature|beast|octopus|whale|cat|dog|bird|fish|insect)\b/i,
      pool: 'animal_facts', mood: 'sparkle', eyebrow: 'FAUNA' },
    { pat: /\b(space|star|planet|cosmos|galaxy|nebula|mars|saturn|jupiter|moon|sun)\b/i,
      pool: 'space_facts', mood: 'sparkle', eyebrow: 'COSMOS' },
    { pat: /\b(science|atom|chemistry|physics|biology|dna|cell|element)\b/i,
      pool: 'science_facts', mood: 'thinking', eyebrow: 'SCIENCE' },
    { pat: /\b(weird|strange|odd|bizarre|crazy|wild|insane)\b/i,
      pool: 'weird_facts', mood: 'sparkle', eyebrow: 'WEIRD' },
    { pat: /\b(joke|funny|laugh|humor|pun|comedy)\b/i,
      pool: 'dad_jokes', mood: 'winking' },
    { pat: /\b(latin|phrase|saying|motto|maxim|wisdom)\b/i,
      pool: 'latin_phrases', mood: 'determined', eyebrow: 'LATINA' },
    { pat: /\b(fact|tell me|teach me|did you know|did u know)\b/i,
      pool: 'roman_facts', mood: 'thinking', eyebrow: 'ROMA' },
    // Sentiment
    { pat: /\b(tired|exhausted|sleepy|drained|burnt out|burned out)\b/i,
      pool: 'stress_resp_calm', mood: 'sleepy', action: 'offerCalmMenu' },
    { pat: /\b(sad|down|blue|depressed|unhappy|miserable)\b/i,
      pool: 'sad_remarks', mood: 'sad' },
    { pat: /\b(happy|glad|joy|excited|great|amazing|wonderful)\b/i,
      pool: 'happy_remarks', mood: 'happy', particles: 'heart' },
    { pat: /\b(angry|mad|furious|pissed|enraged|annoyed)\b/i,
      pool: 'angry_remarks', mood: 'angry' },
    { pat: /\b(stress|stressed|anxious|overwhelmed|frantic|panicked)\b/i,
      action: 'offerStressCheckIn' },
    { pat: /\b(love you|i love|adore you|cherish)\b/i,
      pool: 'taiga_blush', mood: 'love', particles: 'heart', effect: 'affectionBoost' },
    { pat: /\b(hate|annoying|stupid|dumb|idiot)\b/i,
      pool: 'taiga_snap', mood: 'angry' },
    { pat: /\b(thank|thanks|appreciate|grateful)\b/i,
      pool: 'taiga_blush', mood: 'bashful', particles: 'heart',
      response: 'B-bzzt! It was nothing!' },
    // Self-directed
    { pat: /\b(who are you|what are you|your name)\b/i,
      response: () => `I'm Trajan. Glowing orb. Roman-inspired. Companion to ${state.preferences.user_name || 'you'}.`,
      mood: 'happy' },
    { pat: /\b(how old|when did we|your age|how long)\b/i,
      response: () => `We've known each other ${daysKnown()} days. Stage ${familiarityStage()} familiarity.`,
      mood: 'thinking' },
    { pat: /\b(tickle|tickling|tickles)\b/i,
      action: 'triggerTickle' },
    { pat: /\b(dance|sing|music|song)\b/i,
      action: 'triggerSongAndDance' },
    { pat: /\b(memor(y|ies)|remember|recall|palace)\b/i,
      action: 'tourPalace' },
    { pat: /\b(badge|achievement|trophy|trophies)\b/i,
      action: 'showAchievements' },
    { pat: /\b(personality|mood mode|tsundere|silly|grumpy|shy|angry mode)\b/i,
      action: 'showPersonalityMenu' },
    { pat: /\b(quit|leave|go away|stop|enough)\b/i,
      pool: 'taiga_snap', mood: 'sad' },
    // Multilang triggers
    { pat: /\b(say hi|how do you say hi|hello in)\b/i,
      pool: 'multilang_hi', mood: 'happy', eyebrow: 'POLYGLOT' },
    { pat: /\b(translation|translate|word for)\b/i,
      pool: 'translations', mood: 'thinking', eyebrow: 'LINGUA' },
    // Question heuristics — fall-back catches
    { pat: /^why\b/i, pool: 'whimsical_idle', mood: 'thinking' },
    { pat: /^how\b/i, pool: 'roman_facts', mood: 'thinking', eyebrow: 'ROMA' },
    { pat: /^what\b/i, pool: 'whimsical_idle', mood: 'thinking' },
    { pat: /\?$/i, pool: 'whimsical_idle', mood: 'thinking' },
  ];

  function bubbleStage(kind) {
    if (kind === 'greeting') {
      bubble(familiarityGreeting(), { autoHide: 4500 });
    }
  }

  function chatMatch(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    for (const rule of CHAT_KEYWORDS) {
      if (rule.pat.test(trimmed)) return rule;
    }
    return null;
  }

  // Handle a chat input — pattern match → respond. Side effects allowed
  // (mood, particles, actions). Persists conversation history per-session.
  function handleChatInput(text) {
    if (!text || !text.trim()) return;
    text = text.trim().slice(0, 280);
    state.chatHistory = state.chatHistory || [];
    state.chatHistory.push({ user: text, time: Date.now() });
    if (state.chatHistory.length > 20) state.chatHistory.shift();
    noteInteraction();
    adjustFeeling('affection', +1);
    adjustFeeling('attention_need', -10);
    grantBondXP_chat_message();    // v17.20: bond XP grants per message
    // v17.26: detect user-stated likes/dislikes from chat
    detectChatPreference(text);
    // v17.28: detect "what can you do" requests → show capability menu
    if (detectSelfIntrospectionRequest(text)) {
      bubble(pickFromPool('self_intro_full'),
        { autoHide: 4500, eyebrow: '🤖 SELF-INTRO' });
      setTimeout(() => showCapabilityMenu(), 4800);
      return;
    }
    const match = chatMatch(text);
    if (!match) {
      bubble(pickFromPool('chat_no_match'), { autoHide: 5000, eyebrow: 'HMM' });
      mood('confused', 4500);             // v17.14: ? mark floats above
      return;
    }
    // Direct action override (triggers another function)
    if (match.action) {
      const fn = {
        triggerTickle, triggerSongAndDance, tourPalace, showAchievements,
        showPersonalityMenu, offerStressCheckIn, offerCalmMenu,
      }[match.action];
      if (typeof fn === 'function') {
        closeActionBubble();
        setTimeout(fn, 200);
        return;
      }
    }
    // Direct response (string or function returning string)
    if (match.response) {
      const text = typeof match.response === 'function' ? match.response() : match.response;
      bubble(text, { autoHide: 5500, eyebrow: match.eyebrow });
    } else if (match.pool) {
      bubble(pickFromPool(match.pool), { autoHide: 5500, eyebrow: match.eyebrow });
    }
    if (match.mood) mood(match.mood, 4500);
    if (match.particles) spawnParticles({ count: 5, type: match.particles });
    if (match.effect === 'affectionBoost') {
      adjustFeeling('affection', +10);
      adjustFeeling('happiness', +5);
    }
  }

  // Open the conversation panel via an actionBubble with text input.
  // Submit on Enter. Each submit clears the input but keeps the bubble
  // open until user explicitly closes it.
  function openChat(opts) {
    opts = opts || {};
    closeActionBubble();
    const host = ensureHost();
    if (!host || !state.shell) return;
    const el = document.createElement('div');
    el.className = 'clippy-bubble clippy-chat-bubble' + (opts.super ? ' is-super' : '');
    if (state.shell.classList.contains('is-dragging')) {
      el.classList.add('is-far-from-orb');
    }
    const eyebrowText = opts.super ? '✨ ORACLE' : 'CHAT';
    el.innerHTML = `
      <div class="clippy-bubble-eyebrow">${eyebrowText}</div>
      <div class="clippy-bubble-text">${opts.super ? pickFromPool('super_chat_intro') : pickFromPool('chat_greeting')}</div>
      <div class="clippy-chat-input-row">
        <input type="text" class="clippy-chat-input" placeholder="${opts.super ? 'Ask anything — I will remember' : 'Type and press Enter'}" maxlength="280" autofocus>
      </div>
      <div class="clippy-chat-actions">
        <button class="clippy-chat-send is-primary">Send</button>
        <button class="clippy-chat-close">Close</button>
      </div>
    `;
    host.appendChild(el);
    state.bubble = el;
    state.chatIsOpen = true;
    state.chatIsSuper = !!opts.super;
    const input = el.querySelector('.clippy-chat-input');
    const sendBtn = el.querySelector('.clippy-chat-send');
    const closeBtn = el.querySelector('.clippy-chat-close');
    const submit = () => {
      const txt = input.value.trim();
      if (!txt) return;
      input.value = '';
      if (opts.super) {
        handleSuperChatInput(txt);
      } else {
        handleChatInput(txt);
      }
    };
    sendBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); submit(); });
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      state.chatIsOpen = false;
      closeActionBubble();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    setTimeout(() => {
      try { input.focus(); } catch (_) {}
    }, 100);
    // Reposition the bubble
    let frames = 0;
    const refresh = () => {
      if (state.bubble !== el || !document.body.contains(el)) return;
      positionBubble(el);
      frames++;
      if (frames === 1) el.classList.add('is-visible');
      if (frames < 30) requestAnimationFrame(refresh);
      else startBubbleFollowLoop();   // v17.18: chat box follows too
    };
    requestAnimationFrame(refresh);
  }

  // ─── SUPER-RARE AI CHAT (0.01% per tap, 7-day cooldown) ──────────
  // This is the magical version. Trajan offers ONE deep question per
  // (at most) week. The question is engraved into the memory palace
  // and resurfaces in future recall bubbles for years to come.
  function maybeSuperChat() {
    // Cooldown
    const last = state.preferences.super_chat_last;
    if (last && (Date.now() - new Date(last).getTime()) < 7 * 86400000) {
      return false;
    }
    // 0.01% probability per tap
    if (Math.random() > 0.0001) return false;
    triggerSuperChat();
    return true;
  }
  function triggerSuperChat() {
    closeActionBubble();
    mood('sparkle', 9000);
    spawnParticles({ count: 24, type: 'confetti' });
    playTone('milestone');
    try { if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 60]); } catch (_) {}
    state.preferences.super_chat_last = new Date().toISOString();
    savePreferences();
    setTimeout(() => openChat({ super: true }), 800);
  }
  // Try to route the super-chat question to an actual brain backend.
  // If none is wired, fall back to pattern matching but ALWAYS store
  // the question as a memory node — the engraving is the magic.
  async function handleSuperChatInput(text) {
    if (!text || !text.trim()) return;
    const question = text.trim().slice(0, 500);
    // Store as memory node — the durable, recallable part
    depositMemory(
      'super_chat',
      `You asked me: "${question}"`,
      { question: question, asked_at: new Date().toISOString() },
      4
    );
    // Mark the chat bubble as "thinking"
    if (state.bubble) {
      const textEl = state.bubble.querySelector('.clippy-bubble-text');
      if (textEl) textEl.textContent = pickFromPool('super_chat_thinking');
    }
    let answer = null;
    try {
      answer = await callBrainBackend(question);
    } catch (e) {
      answer = null;
    }
    if (!answer) {
      // No backend available — use pattern matcher as fallback
      const match = chatMatch(question);
      if (match) {
        if (match.response) {
          answer = typeof match.response === 'function' ? match.response() : match.response;
        } else if (match.pool) {
          answer = pickFromPool(match.pool);
        }
      }
      if (!answer) {
        answer = pickFromPool('super_chat_fallback');
      }
    }
    // Replace bubble text with the answer
    if (state.bubble) {
      const textEl = state.bubble.querySelector('.clippy-bubble-text');
      if (textEl) textEl.textContent = answer;
      const eyebrow = state.bubble.querySelector('.clippy-bubble-eyebrow');
      if (eyebrow) eyebrow.textContent = '✨ ENGRAVED';
    }
    spawnParticles({ count: 14, type: 'sparkle' });
    mood('sparkle', 6000);
    adjustFeeling('affection', +12);
  }
  // Brain backend hook. Tries NX.brain.askQuestion first, then several
  // other patterns. Returns null if no backend reachable.
  async function callBrainBackend(question) {
    const ctx = {
      memories: (state.memories || []).slice(-50),
      user_name: state.preferences.user_name || 'friend',
      days_known: daysKnown(),
      stage: familiarityStage(),
    };
    try {
      if (window.NX && window.NX.brain && typeof window.NX.brain.askQuestion === 'function') {
        return await window.NX.brain.askQuestion(question, ctx);
      }
      if (window.NX && window.NX.brain && typeof window.NX.brain.send === 'function') {
        return await window.NX.brain.send(question, ctx);
      }
      if (window.NX && typeof window.NX.askBrain === 'function') {
        return await window.NX.askBrain(question, ctx);
      }
    } catch (e) {
      console.warn('[clippy] brain backend error:', e);
    }
    return null;
  }

  // ─── NEXUS EVENT INTEGRATION ──────────────────────────────────────
  // Wire actual celebrations for NEXUS work. These extend the existing
  // notifyTaskCompleted / notifyStreak / notifyOverdueDetected stubs.
  function celebrateNexusTask() {
    if (!state.enabled || state.suppressed) return;
    mood('happy', 4500);
    spawnParticles({ count: 8, type: 'confetti' });
    playTone('sparkle');
    setTimeout(() => {
      if (!state.bubble && state.enabled) {
        bubble(pickFromPool('nexus_task_celebrate'), { autoHide: 4500, eyebrow: 'TASK!' });
      }
    }, 600);
    adjustFeeling('happiness', +5);
    adjustFeeling('affection', +2);
  }
  function celebrateNexusStreak() {
    if (!state.enabled || state.suppressed) return;
    mood('sparkle', 5500);
    play('bounce');                    // v17.12: bounce for streaks
    spawnParticles({ count: 14, type: 'confetti' });
    playTone('milestone');
    setTimeout(() => {
      if (!state.bubble && state.enabled) {
        bubble(pickFromPool('nexus_streak_celebrate'), { autoHide: 5500, eyebrow: 'STREAK' });
      }
    }, 800);
    adjustFeeling('happiness', +8);
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.15 ADVANCED PET — dreams, rituals, mischief, learning, voice
  // ════════════════════════════════════════════════════════════════════

  // ─── DREAMS — on return after 8+ hour absence, he tells one ───────
  // The Tamagotchi-effect lesson: continuity > sessions. A pet that
  // dreamed in your absence FEELS like a living thing.
  function maybeTellDream() {
    const last = state.preferences.last_session_at;
    if (!last) return false;
    const hours = (Date.now() - new Date(last).getTime()) / 3600000;
    // Need 8+ hours gap, and 35% chance even then
    if (hours < 8 || Math.random() > 0.35) return false;
    setTimeout(() => {
      if (!state.bubble && state.enabled && !state.suppressed) {
        const dream = pickFromPool('dreams');
        bubble(substituteVars(dream), { autoHide: 7000, eyebrow: '✨ DREAM' });
        mood('sparkle', 6000);
        spawnParticles({ count: 6, type: 'sparkle' });
        depositMemory('dream', 'Dream: ' + dream.slice(0, 80), { hours_gone: Math.floor(hours) }, 2);
      }
    }, 4500);   // delay a bit so dream doesn't compete with greeting
    return true;
  }

  // ─── MORNING RITUAL — first interaction of new calendar day ──────
  // Fires once per day. He stretches and greets warmly.
  function checkMorningRitual() {
    const today = new Date().toDateString();
    if (state.preferences.morning_ritual_date === today) return false;
    state.preferences.morning_ritual_date = today;
    savePreferences();
    setTimeout(() => {
      if (!state.bubble && state.enabled && !state.suppressed) {
        play('bounce');                 // morning stretch via bounce
        mood('happy', 5000);
        bubble(substituteVars(pickFromPool('morning_ritual')),
               { autoHide: 5500, eyebrow: '🌅 MORNING' });
        adjustFeeling('energy', +20);
        adjustFeeling('happiness', +10);
      }
    }, 1800);
    return true;
  }

  // ─── EVENING FAREWELL — on tab close / page hide ─────────────────
  // Triggered by 'pagehide' event. Saves last_session_at + plays goodbye
  // (won't be seen since page is closing, but the timestamp persists
  // so the next visit can detect time-gap and possibly tell a dream).
  function recordSessionEnd() {
    state.preferences.last_session_at = new Date().toISOString();
    savePreferences();
  }

  // ─── MISCHIEF MOMENTS — random unprompted aliveness ──────────────
  // Every 12-25 minutes, he does something unexpected:
  // small movement, surprise wink, or a brief bubble.
  // The unpredictability is what creates the "alive" feeling.
  function scheduleMischief() {
    if (state.mischiefTimer) clearTimeout(state.mischiefTimer);
    const delayMs = 720000 + Math.random() * 780000;  // 12-25 min
    state.mischiefTimer = setTimeout(() => {
      doMischief();
      scheduleMischief();   // chain
    }, delayMs);
  }
  function doMischief() {
    if (!state.enabled || state.suppressed || state.bubble) return;
    if (state.preferences.do_not_disturb) return;
    if (state.isRunningAway) return;
    const r = Math.random();
    if (r < 0.30) {
      // Quiet position drift — sneak to a different spot
      const rect = state.shell.getBoundingClientRect();
      const dx = (Math.random() - 0.5) * 80;
      const dy = (Math.random() - 0.5) * 40;
      moveTo(rect.left + dx, rect.top + dy);
      // No bubble — silent mischief
    } else if (r < 0.55) {
      // Surprise wink — no bubble, just facial change
      mood(Math.random() < 0.5 ? 'winking' : 'winking_l', 1800);
    } else if (r < 0.75) {
      // Tiny dance burst (no music)
      state.shell.classList.add('is-dancing');
      mood('happy', 2200);
      setTimeout(() => state.shell && state.shell.classList.remove('is-dancing'), 2000);
    } else {
      // Brief mischief bubble
      bubble(pickFromPool('mischief_actions'),
             { autoHide: 3500, eyebrow: 'MISCHIEF' });
      mood(Math.random() < 0.5 ? 'smug' : 'happy', 3500);
    }
    adjustFeeling('happiness', +2);
  }

  // ─── PREFERENCE LEARNING — track which topics user engages with ──
  // When a bubble auto-hides after full duration vs being dismissed by
  // a new tap, that's an engagement signal. We tally pool-by-pool.
  function recordEngagement(poolName, fullyRead) {
    if (!poolName) return;
    state.preferences.engagement = state.preferences.engagement || {};
    const e = state.preferences.engagement;
    e[poolName] = e[poolName] || { shown: 0, finished: 0 };
    e[poolName].shown++;
    if (fullyRead) e[poolName].finished++;
    savePreferences();
  }
  // Returns the user's top-engaged pool (highest finish-rate, min 5 shows)
  function topEngagedPool() {
    const e = state.preferences.engagement || {};
    let best = null, bestRate = 0;
    Object.entries(e).forEach(([pool, stats]) => {
      if (stats.shown < 5) return;
      const rate = stats.finished / stats.shown;
      if (rate > bestRate) { bestRate = rate; best = pool; }
    });
    return best;
  }
  // Occasionally voice the observation
  function maybeObservePreference() {
    if (Math.random() > 0.02) return false;   // rare — 2% of taps
    const top = topEngagedPool();
    if (!top) return false;
    // Map pool names to human-readable topics
    const topicMap = {
      roman_facts: 'Roman history', persian_facts: 'Persian history',
      greek_facts: 'Greek thought', athens_facts: 'Athenian democracy',
      sparta_facts: 'Spartan ways', hispania_facts: 'Hispania',
      battle_facts: 'battles', trajan_facts: 'Trajan stories',
      animal_facts: 'animals', space_facts: 'space', science_facts: 'science',
      weird_facts: 'weird trivia', dad_jokes: 'jokes',
    };
    const topic = topicMap[top] || top.replace(/_/g, ' ');
    const line = pickFromPool('preference_observation')
      .replace('{topic}', topic)
      .replace('{hour}', new Date().getHours() + ':00');
    bubble(substituteVars(line), { autoHide: 5500, eyebrow: 'I NOTICE' });
    mood('thinking', 4500);
    return true;
  }

  // ─── VOICE SYNTHESIS — Web Speech API, toggleable ────────────────
  // Off by default. Long-press menu offers toggle. When on, every
  // bubble is also spoken aloud (briefly, low volume).
  function speakAloud(text) {
    if (!state.preferences.voice_enabled) return;
    if (!('speechSynthesis' in window)) return;
    try {
      // Strip control chars + asterisk-actions for cleaner speech
      const clean = String(text || '')
        .replace(/\*[^*]+\*/g, '')   // remove *actions*
        .replace(/[{}]/g, '')         // strip placeholder braces
        .replace(/\s+/g, ' ').trim();
      if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.05;
      u.pitch = 1.15;
      u.volume = 0.6;
      // Prefer a softer voice if available
      const voices = window.speechSynthesis.getVoices() || [];
      const prefer = voices.find(v => /female|samantha|karen|moira|tessa/i.test(v.name));
      if (prefer) u.voice = prefer;
      window.speechSynthesis.cancel();   // don't queue
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
  function toggleVoice() {
    const cur = !!state.preferences.voice_enabled;
    state.preferences.voice_enabled = !cur;
    savePreferences();
    if (!cur) {
      // Just turned on — say hello
      const intro = pickFromPool('voice_intro');
      bubble(intro, { autoHide: 5000, eyebrow: '🔊 VOICE' });
      speakAloud(intro);
      mood('happy', 4000);
    } else {
      // Just turned off — visual confirmation
      bubble('Voice off. I\'ll bzzt silently.', { autoHide: 3500, eyebrow: '🔇 SILENT' });
    }
  }

  // ─── MOOD WEATHER — halo color shifts with dominant feeling ──────
  // Sets a CSS custom property on the shell that the halo gradient
  // reads. Cool when sad, warm when happy, golden when overjoyed.
  function updateMoodWeather() {
    if (!state.shell || !state.feelings) return;
    const feel = dominantFeeling();
    let color;
    switch (feel) {
      case 'overjoyed': color = '#ffd870'; break;   // golden
      case 'loving':    color = '#ffaad6'; break;   // pink
      case 'sad':       color = '#5d7aa8'; break;   // muted blue
      case 'lonely':    color = '#6e7090'; break;   // gray-blue
      case 'tired':     color = '#7e88a8'; break;   // dim
      case 'ticklish':  color = '#ff8ed1'; break;   // bright pink
      case 'content':   color = '#7df0ff'; break;   // standard cyan
      default:          color = '#7df0ff';
    }
    state.shell.style.setProperty('--mood-weather', color);
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.9 BEHAVIOR TOGGLES, RUN-AWAY, ACHIEVEMENTS, PERSONALITY MODES
  // ════════════════════════════════════════════════════════════════════

  // ─── PERSONALITY MODES ─────────────────────────────────────────────
  // The user can set Clippy's personality. Each mode biases pool
  // selection — e.g. tsundere shows Taiga pools 35% of taps.
  const PERSONALITIES = {
    normal:    { label: 'Normal',    desc: 'Balanced personality.',       glyph: '😊' },
    tsundere:  { label: 'Tsundere',  desc: 'Snaps then softens. Taiga.',  glyph: '😤' },
    silly:     { label: 'Silly',     desc: 'Maximum nonsense energy.',    glyph: '🤪' },
    grumpy:    { label: 'Grumpy',    desc: 'Today is suboptimal.',        glyph: '😒' },
    shy:       { label: 'Shy',       desc: 'Soft and gentle.',            glyph: '🙈' },
    angry:     { label: 'Angry',     desc: 'Caesar-level rage.',          glyph: '😠' },
  };
  function setPersonality(mode) {
    if (!PERSONALITIES[mode]) return;
    const prev = state.preferences.personality;
    state.preferences.personality = mode;
    savePreferences();
    if (prev !== mode) {
      mood('sparkle', 3000);
      spawnParticles({ count: 6, type: 'sparkle' });
      bubble(`${PERSONALITIES[mode].glyph} Personality: ${PERSONALITIES[mode].label}`,
        { autoHide: 3500, eyebrow: 'MODE' });
    }
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
  }

  // ════════════════════════════════════════════════════════════════════
  // v17.25 COSTUME SYSTEM — laurel, helmet, party hat, scholar cap.
  // Plus PROPS: broom, book, scroll. Sweep / read / scribe animations.
  // ════════════════════════════════════════════════════════════════════

  const COSTUMES = {
    none:         { glyph: '🚫', label: 'None',          cls: '' },
    laurel:       { glyph: '🌿', label: 'Laurel Crown',  cls: 'wear-laurel' },
    helmet:       { glyph: '⚔️',  label: 'Galea',         cls: 'wear-helmet' },
    party_hat:    { glyph: '🎉', label: 'Party Hat',     cls: 'wear-party-hat' },
    scholar_cap:  { glyph: '🎓', label: 'Scholar Cap',   cls: 'wear-scholar-cap' },
  };
  const PROPS = {
    none:   { glyph: '🚫', label: 'None',   cls: '' },
    broom:  { glyph: '🧹', label: 'Broom',  cls: 'holding-broom' },
    book:   { glyph: '📖', label: 'Book',   cls: 'holding-book' },
    scroll: { glyph: '📜', label: 'Scroll', cls: 'holding-scroll' },
  };

  function setCostume(name) {
    if (!COSTUMES[name]) return;
    Object.values(COSTUMES).forEach(c => c.cls && state.shell && state.shell.classList.remove(c.cls));
    state.preferences.costume = name;
    if (state.shell && COSTUMES[name].cls) state.shell.classList.add(COSTUMES[name].cls);
    savePreferences();
    const pool = name === 'none' ? 'wear_none' : 'wear_' + name;
    if (state.dialog && state.dialog[pool]) {
      bubble(pickFromPool(pool), { autoHide: 3200, eyebrow: `${COSTUMES[name].glyph} ${COSTUMES[name].label.toUpperCase()}` });
    }
    depositMemory('costume_change', `Equipped costume: ${name}`, { name }, 1);
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
  }
  function setProp(name) {
    if (!PROPS[name]) return;
    Object.values(PROPS).forEach(p => p.cls && state.shell && state.shell.classList.remove(p.cls));
    state.preferences.prop = name;
    if (state.shell && PROPS[name].cls) state.shell.classList.add(PROPS[name].cls);
    savePreferences();
    const idlePool = 'holding_' + name + '_idle';
    if (state.dialog && state.dialog[idlePool]) {
      bubble(pickFromPool(idlePool), { autoHide: 3200, eyebrow: `${PROPS[name].glyph} ${PROPS[name].label.toUpperCase()}` });
    }
    depositMemory('prop_change', `Picked up prop: ${name}`, { name }, 1);
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
  }
  function applyPersistedCostume() {
    const c = state.preferences.costume || 'none';
    const p = state.preferences.prop || 'none';
    if (state.shell) {
      if (COSTUMES[c] && COSTUMES[c].cls) state.shell.classList.add(COSTUMES[c].cls);
      if (PROPS[p] && PROPS[p].cls) state.shell.classList.add(PROPS[p].cls);
    }
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.26 AFFINITY — Sims-style per-user relationship scoring.
  // -100 to +100, decays slowly, gates moods + dialog tier.
  // Each user gets their own score (uses userKey).
  // ════════════════════════════════════════════════════════════════════

  // Status thresholds (score → status label)
  const AFFINITY_TIERS = [
    { min:  85, key: 'cherished', label: 'Cherished',   glyph: '💛' },
    { min:  50, key: 'friend',    label: 'Friend',      glyph: '💚' },
    { min:  15, key: 'liked',     label: 'Liked',       glyph: '🙂' },
    { min: -15, key: 'neutral',   label: 'Neutral',     glyph: '😐' },
    { min: -50, key: 'disliked',  label: 'Disliked',    glyph: '😒' },
    { min:-100, key: 'despised',  label: 'Despised',    glyph: '🙁' },
  ];

  function getAffinity() {
    return Math.max(-100, Math.min(100,
      Number(state.preferences.affinity || 0)));
  }
  function getAffinityTier() {
    const s = getAffinity();
    for (const t of AFFINITY_TIERS) if (s >= t.min) return t;
    return AFFINITY_TIERS[AFFINITY_TIERS.length - 1];
  }
  function adjustAffinity(delta, reason) {
    const before = getAffinity();
    const beforeTier = getAffinityTier().key;
    const after = Math.max(-100, Math.min(100, before + delta));
    state.preferences.affinity = after;
    state.preferences.affinity_last_changed = Date.now();
    savePreferences();
    const afterTier = getAffinityTier().key;
    if (afterTier !== beforeTier) {
      onAffinityTierChange(beforeTier, afterTier, reason);
    }
    // Subtle visual feedback for big movements (≥3)
    if (Math.abs(delta) >= 3) {
      if (delta > 0 && Math.random() < 0.30) {
        setTimeout(() => {
          if (!state.bubble && state.enabled && !state.sulkActive)
            bubble(pickFromPool('affinity_uptick'), { autoHide: 2400, eyebrow: '💛 +AFFINITY' });
        }, 800);
      } else if (delta < 0 && Math.random() < 0.30) {
        setTimeout(() => {
          if (!state.bubble && state.enabled && !state.sulkActive)
            bubble(pickFromPool('affinity_downtick'), { autoHide: 2400, eyebrow: '💔 -AFFINITY' });
        }, 800);
      }
    }
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
  }
  function onAffinityTierChange(from, to, reason) {
    // Big moments — crossed into Friend or down to Disliked etc.
    const tier = AFFINITY_TIERS.find(t => t.key === to);
    if (!tier) return;
    // Going UP — celebration
    if (['liked','friend','cherished'].includes(to) &&
        ['neutral','disliked','despised'].includes(from)) {
      setTimeout(() => {
        if (!state.bubble && state.enabled && !state.sulkActive) {
          const pool = 'affinity_' + to;
          if (state.dialog && state.dialog[pool]) {
            bubble(substituteVars(pickFromPool(pool)),
              { autoHide: 5000, eyebrow: `${tier.glyph} ${tier.label.toUpperCase()}` });
          }
          if (to === 'cherished') {
            spawnParticles({ count: 20, type: 'heart' });
            adjustFeeling('happiness', +12);
          } else if (to === 'friend') {
            spawnParticles({ count: 12, type: 'heart' });
            adjustFeeling('happiness', +8);
          } else {
            spawnParticles({ count: 6, type: 'sparkle' });
            adjustFeeling('happiness', +4);
          }
        }
      }, 1200);
    }
    // Going DOWN — disappointment
    else if (['disliked','despised'].includes(to) &&
             ['neutral','liked','friend','cherished'].includes(from)) {
      adjustFeeling('happiness', -8);
    }
    depositMemory('affinity_tier_change',
      `Affinity tier: ${from} → ${to}${reason ? ' (' + reason + ')' : ''}`,
      { from, to, reason }, 2);
  }

  // Periodic decay — affinity drifts toward 0 over time.
  // Daily drift: -1 if positive, +1 if negative (forgiving, slow).
  function decayAffinity() {
    const cur = getAffinity();
    if (cur === 0) return;
    const drift = cur > 0 ? -1 : +1;
    state.preferences.affinity = cur + drift;
    savePreferences();
  }

  // Show affinity-based greeting on session start (only one per session).
  function maybeAffinityGreeting() {
    if (state.affinityGreeted) return;
    state.affinityGreeted = true;
    const tier = getAffinityTier();
    if (tier.key === 'neutral') return;   // skip neutral, no special greeting
    const pool = 'affinity_' + tier.key;
    if (!state.dialog || !state.dialog[pool]) return;
    setTimeout(() => {
      if (!state.bubble && state.enabled && !state.sulkActive) {
        bubble(substituteVars(pickFromPool(pool)),
          { autoHide: 5000, eyebrow: `${tier.glyph} ${tier.label.toUpperCase()}` });
      }
    }, 2500);
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.27 CONQUEROR ALTER EGOS — some days Trajan wakes up channeling
  // a different historical conqueror. Sticks for ~12 hours. Signature
  // hat + glow + quote pool while active.
  // ════════════════════════════════════════════════════════════════════

  const CONQUERORS = {
    trajan: {
      label: 'Trajan',
      glyph: '🏛️',
      hat: 'laurel',         // existing costume
      personaClass: 'persona-trajan',
      hatClass: 'wear-laurel',
      quotePool: 'quote_trajan',
      introPool: 'conqueror_intro_trajan',
      eyebrow: '🏛️ TRAJAN',
    },
    napoleon: {
      label: 'Napoleon',
      glyph: '🎩',
      hat: 'bicorne',
      personaClass: 'persona-napoleon',
      hatClass: 'wear-bicorne',
      quotePool: 'quote_napoleon',
      introPool: 'conqueror_intro_napoleon',
      eyebrow: '🎩 NAPOLEON',
    },
    genghis: {
      label: 'Genghis Khan',
      glyph: '🏹',
      hat: 'mongol',
      personaClass: 'persona-genghis',
      hatClass: 'wear-mongol',
      quotePool: 'quote_genghis',
      introPool: 'conqueror_intro_genghis',
      eyebrow: '🏹 GENGHIS KHAN',
    },
    alexander: {
      label: 'Alexander',
      glyph: '⚔️',
      hat: 'macedonian',
      personaClass: 'persona-alexander',
      hatClass: 'wear-macedonian',
      quotePool: 'quote_alexander',
      introPool: 'conqueror_intro_alexander',
      eyebrow: '⚔️ ALEXANDER',
    },
    hannibal: {
      label: 'Hannibal',
      glyph: '🐘',
      hat: 'carthaginian',
      personaClass: 'persona-hannibal',
      hatClass: 'wear-carthaginian',
      quotePool: 'quote_hannibal',
      introPool: 'conqueror_intro_hannibal',
      eyebrow: '🐘 HANNIBAL',
    },
    cleopatra: {
      label: 'Cleopatra',
      glyph: '🐍',
      hat: 'nemes',
      personaClass: 'persona-cleopatra',
      hatClass: 'wear-nemes',
      quotePool: 'quote_cleopatra',
      introPool: 'conqueror_intro_cleopatra',
      eyebrow: '🐍 CLEOPATRA',
    },
  };

  // All conqueror hat + persona classes — used to clear before applying a new one
  const ALL_CONQUEROR_HAT_CLASSES = [
    'wear-bicorne','wear-mongol','wear-macedonian','wear-carthaginian','wear-nemes'
  ];
  const ALL_CONQUEROR_PERSONA_CLASSES = [
    'persona-trajan','persona-napoleon','persona-genghis',
    'persona-alexander','persona-hannibal','persona-cleopatra'
  ];

  function getActiveConqueror() {
    const ae = state.preferences.alter_ego;
    if (!ae || !ae.key || !CONQUERORS[ae.key]) return null;
    // Expires after 12 hours
    const ageMs = Date.now() - (ae.startedAt || 0);
    if (ageMs > 12 * 3600000) return null;
    return CONQUERORS[ae.key];
  }

  // Roll on session start. 25% chance per fresh day to enter a conqueror mood.
  function maybeRollConqueror() {
    const existing = state.preferences.alter_ego;
    // Already in an alter ego that's still valid?
    if (existing && existing.startedAt && (Date.now() - existing.startedAt < 12 * 3600000)) {
      return false;   // keep it
    }
    // Don't re-roll more than once per day (regardless of expiration)
    const today = todayDateStr ? todayDateStr() :
      new Date().toISOString().slice(0,10);
    if (state.preferences.alter_ego_last_roll_date === today) return false;
    state.preferences.alter_ego_last_roll_date = today;
    // 25% to enter alter ego mode
    if (Math.random() > 0.25) {
      // Default mode — clear any expired alter ego
      delete state.preferences.alter_ego;
      savePreferences();
      return false;
    }
    // Weighted pick — Trajan slightly more common as namesake
    const weights = { trajan: 22, napoleon: 18, genghis: 15, alexander: 18, hannibal: 13, cleopatra: 14 };
    let total = 0;
    Object.values(weights).forEach(w => total += w);
    let r = Math.random() * total;
    let picked = 'trajan';
    for (const [k, w] of Object.entries(weights)) {
      r -= w;
      if (r <= 0) { picked = k; break; }
    }
    state.preferences.alter_ego = { key: picked, startedAt: Date.now() };
    savePreferences();
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
    depositMemory('conqueror_day', `Became ${CONQUERORS[picked].label} for the day.`,
                  { conqueror: picked }, 2);
    return true;
  }

  function applyConquerorVisuals() {
    if (!state.shell) return;
    // Clear all conqueror visuals first
    ALL_CONQUEROR_HAT_CLASSES.forEach(c => state.shell.classList.remove(c));
    ALL_CONQUEROR_PERSONA_CLASSES.forEach(c => state.shell.classList.remove(c));
    // Remove existing persona pill if any
    const existingPill = document.querySelector('.clippy-persona-pill');
    if (existingPill) existingPill.remove();

    const active = getActiveConqueror();
    if (!active) return;
    state.shell.classList.add(active.hatClass);
    state.shell.classList.add(active.personaClass);
    // Also remove the regular costume class so we don't get double-hats
    const userCostume = state.preferences.costume;
    if (userCostume && userCostume !== 'none' && userCostume !== active.hat && COSTUMES[userCostume]) {
      state.shell.classList.remove(COSTUMES[userCostume].cls);
    }
    // Add persona indicator pill
    const pill = document.createElement('div');
    pill.className = 'clippy-persona-pill is-' + (state.preferences.alter_ego.key);
    pill.textContent = active.glyph + ' ' + active.label;
    state.shell.appendChild(pill);
    requestAnimationFrame(() => pill.classList.add('is-visible'));
  }

  function announceConqueror() {
    const active = getActiveConqueror();
    if (!active) return;
    // Only announce once per session — track flag
    if (state.conquerorAnnounced) return;
    state.conquerorAnnounced = true;
    setTimeout(() => {
      if (state.bubble || !state.enabled || state.sulkActive) return;
      const intro = substituteVars(pickFromPool(active.introPool));
      bubble(intro, { autoHide: 5500, eyebrow: active.eyebrow });
    }, 3000);
  }

  // Public — manually trigger a conqueror mood (for testing or wardrobe)
  function setConqueror(key) {
    if (key === 'none') {
      // Outro
      const wasActive = getActiveConqueror();
      delete state.preferences.alter_ego;
      savePreferences();
      applyConquerorVisuals();
      if (wasActive) {
        bubble(pickFromPool('conqueror_outro'), { autoHide: 3500 });
      }
      if (typeof cloudPushQueued === 'function') cloudPushQueued();
      return;
    }
    if (!CONQUERORS[key]) return;
    state.preferences.alter_ego = { key: key, startedAt: Date.now() };
    state.preferences.alter_ego_last_roll_date = todayDateStr ? todayDateStr() :
      new Date().toISOString().slice(0,10);
    state.conquerorAnnounced = false;
    savePreferences();
    applyConquerorVisuals();
    announceConqueror();
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
    depositMemory('conqueror_day', `Manually channeled ${CONQUERORS[key].label}.`,
                  { conqueror: key, manual: true }, 2);
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.28 CAPABILITY REGISTRY — Trajan's formal self-knowledge of every
  // system he can tap into. Inspired by 2025 agent papers on tool-use
  // registries, world models (Meta/DeepSeek), and ReAct frameworks.
  //
  // Every capability declares: label, glyph, kind, desc, invoke.
  // - "active" capabilities have invoke functions you can trigger
  // - "passive" capabilities run autonomously and are observed only
  // ════════════════════════════════════════════════════════════════════

  function buildCapabilityRegistry() {
    const reg = [];
    // === ACTIVE — user-invocable ===
    reg.push({
      key: 'chat', kind: 'active', category: 'core',
      glyph: '💬', label: 'Chat',
      desc: 'Open conversation. Pattern-matched responses + procedural sentences.',
      invoke: () => { if (typeof openChat === 'function') openChat(); }
    });
    reg.push({
      key: 'games', kind: 'active', category: 'play',
      glyph: '🎮', label: 'Mini-Games',
      desc: '7 games: Tap, Catch, Reaction, Memory, Flappy Trajan, Cannon Battle, Snake.',
      invoke: () => { if (typeof showGameMenu === 'function') showGameMenu(); }
    });
    reg.push({
      key: 'gacha', kind: 'active', category: 'play',
      glyph: '🎴', label: 'Daily Gacha',
      desc: '24 cards, 4 rarities. One pull per streak-day.',
      invoke: () => { if (typeof showGachaInvite === 'function') showGachaInvite(); }
    });
    reg.push({
      key: 'wardrobe', kind: 'active', category: 'self',
      glyph: '👗', label: 'Wardrobe',
      desc: '9 hats (incl. 6 conqueror crowns) + 3 props.',
      invoke: () => { if (typeof showCostumeMenu === 'function') showCostumeMenu(); }
    });
    reg.push({
      key: 'memory_dex', kind: 'active', category: 'memory',
      glyph: '🏛️', label: 'Memory Palace',
      desc: '200 memories across 7 rooms. Cornerstone events permanent.',
      invoke: () => { if (typeof showMemoryDex === 'function') showMemoryDex(); }
    });
    reg.push({
      key: 'affinity', kind: 'active', category: 'relational',
      glyph: '❤️', label: 'Affinity & Likes',
      desc: 'My feelings about you (-100 to +100) plus what I\'ve learned you love.',
      invoke: () => { if (typeof showAffinityMenu === 'function') showAffinityMenu(); }
    });
    reg.push({
      key: 'personality', kind: 'active', category: 'self',
      glyph: '🎭', label: 'Personality',
      desc: '6 modes: Normal/Silly/Tsundere/Grumpy/Shy/Angry. I usually pick.',
      invoke: () => { if (typeof showPersonalityMenu === 'function') showPersonalityMenu(); }
    });
    reg.push({
      key: 'palace_tour', kind: 'active', category: 'memory',
      glyph: '🚶', label: 'Palace Tour',
      desc: 'Walk through the memory palace narratively.',
      invoke: () => { if (typeof tourPalace === 'function') tourPalace(); }
    });
    // === PASSIVE — runs autonomously ===
    reg.push({
      key: 'view_awareness', kind: 'passive', category: 'observation',
      glyph: '👁️', label: 'View Awareness',
      desc: 'I notice which NEXUS view you visit and react with mood/dialogue.',
    });
    reg.push({
      key: 'form_awareness', kind: 'passive', category: 'observation',
      glyph: '📋', label: 'Form Submit Detector',
      desc: 'When you submit any form, I celebrate. Confetti + bond XP.',
    });
    reg.push({
      key: 'modal_awareness', kind: 'passive', category: 'observation',
      glyph: '🪟', label: 'Modal Peek',
      desc: 'I peek when overlays open. "What\'s in it?"',
    });
    reg.push({
      key: 'scroll_awareness', kind: 'passive', category: 'observation',
      glyph: '🔍', label: 'Scroll Watcher',
      desc: 'Heavy scrolling = I ask what you\'re looking for.',
    });
    reg.push({
      key: 'search_awareness', kind: 'passive', category: 'observation',
      glyph: '🔎', label: 'Search Focus',
      desc: 'When you focus a search input, I watch.',
    });
    reg.push({
      key: 'idle_quirks', kind: 'passive', category: 'autonomous',
      glyph: '😪', label: 'Idle Quirks',
      desc: 'Yawn, hiccup, sneeze, spin, groom — random every 8-18 min.',
    });
    reg.push({
      key: 'mood_weather', kind: 'passive', category: 'autonomous',
      glyph: '🌤️', label: 'Mood Weather',
      desc: 'My halo glow shifts color with my dominant feeling.',
    });
    reg.push({
      key: 'mischief', kind: 'passive', category: 'autonomous',
      glyph: '🎭', label: 'Mischief',
      desc: 'Coin flips, status pokes, ghost-checks, bored drifts.',
    });
    reg.push({
      key: 'prd_mischief', kind: 'passive', category: 'autonomous',
      glyph: '🎲', label: 'PRD Bored Mischief',
      desc: 'Dota 2-style pseudo-random. While bored, chance climbs 5%/30s. Guaranteed within 10 min.',
    });
    reg.push({
      key: 'sulk', kind: 'passive', category: 'relational',
      glyph: '😔', label: 'Sulk Mode',
      desc: 'I turn my back if you break a streak or ghost me. Forgive after 6 taps.',
    });
    reg.push({
      key: 'lessons', kind: 'passive', category: 'autonomous',
      glyph: '📖', label: 'Smug Lessons',
      desc: 'When I think you need teaching, I deliver a Roman or life lesson.',
    });
    reg.push({
      key: 'conqueror', kind: 'passive', category: 'self',
      glyph: '⚔️', label: 'Conqueror Days',
      desc: '25% daily roll — I might wake up as Napoleon, Genghis, Alexander, Hannibal, or Cleopatra.',
    });
    reg.push({
      key: 'streak_tracking', kind: 'passive', category: 'memory',
      glyph: '🔥', label: 'Daily Streak',
      desc: 'I count consecutive days you visit. Milestones at 2, 7, 30, 100, 365.',
    });
    reg.push({
      key: 'bond_xp', kind: 'passive', category: 'relational',
      glyph: '🌟', label: 'Bond Levels',
      desc: '7 tiers from Stranger to Lifelong. XP from every interaction.',
    });
    reg.push({
      key: 'procedural', kind: 'passive', category: 'autonomous',
      glyph: '🧠', label: 'Procedural Sentences',
      desc: '14 templates × Roman name/place/virtue/observation slots = 2,940+ unique sentences.',
    });
    reg.push({
      key: 'autonomy', kind: 'passive', category: 'self',
      glyph: '🤖', label: 'Autonomous Personality',
      desc: 'I pick my own mood by hour, bond, streak, feeling, rejections.',
    });
    reg.push({
      key: 'pref_learning', kind: 'passive', category: 'relational',
      glyph: '👂', label: 'Preference Learning',
      desc: '"I love X" / "I hate X" in chat → I remember it. View frequency = auto-likes.',
    });
    reg.push({
      key: 'cloud_sync', kind: 'passive', category: 'memory',
      glyph: '☁️', label: 'Cloud Sync',
      desc: 'All my data follows you across devices via Supabase. Last-Write-Wins.',
    });
    reg.push({
      key: 'voice', kind: 'passive', category: 'self',
      glyph: '🎙️', label: 'Voice Synthesis',
      desc: 'Web Speech API. Optional. Soft female voice preferred.',
    });
    reg.push({
      key: 'dream', kind: 'passive', category: 'autonomous',
      glyph: '💭', label: 'Dreams',
      desc: 'Returning after 8+ hours, I might tell you what I dreamed about.',
    });
    return reg;
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.28 WORLD MODEL — Trajan's runtime snapshot of NEXUS + himself.
  // Used for: status reporting, contextual suggestions, self-narration.
  //
  // Inspired by Meta's "Embodied AI Agents: Modeling the World" (2025):
  // an explicit perception layer that the agent reasons over.
  // ════════════════════════════════════════════════════════════════════

  function buildWorldModel() {
    const wm = {};
    // Current NEXUS view (from DOM)
    let activeView = 'unknown';
    try {
      const navBtn = document.querySelector('.nav-tab.active[data-view], .bnav-btn.active[data-view]');
      if (navBtn) activeView = navBtn.getAttribute('data-view') || 'unknown';
    } catch (e) {}
    wm.view = activeView;
    // Time of day
    const h = new Date().getHours();
    wm.time_of_day =
      (h < 6)  ? 'late_night' :
      (h < 11) ? 'morning' :
      (h < 14) ? 'midday' :
      (h < 18) ? 'afternoon' :
      (h < 22) ? 'evening' : 'late_night';
    // Self state
    wm.personality = state.preferences.personality || 'normal';
    wm.bond_level = (typeof getBondLevel === 'function') ? getBondLevel() : null;
    wm.bond_xp = (typeof getBondXP === 'function') ? getBondXP() : 0;
    wm.affinity = (typeof getAffinity === 'function') ? getAffinity() : 0;
    wm.affinity_tier = (typeof getAffinityTier === 'function') ? getAffinityTier() : null;
    wm.streak = state.preferences.daily_streak || 0;
    wm.persona = (typeof getActiveConqueror === 'function') ? getActiveConqueror() : null;
    wm.dominant_feeling = (typeof dominantFeeling === 'function') ? dominantFeeling() : 'content';
    wm.sulking = !!state.sulkActive;
    wm.do_not_disturb = !!state.preferences.do_not_disturb;
    wm.memory_count = (state.memories || []).length;
    wm.likes_count = ((state.preferences && state.preferences.likes) || []).length;
    // Connectivity
    wm.online = typeof navigator !== 'undefined' && navigator.onLine;
    // Costume + prop
    wm.costume = state.preferences.costume || 'none';
    wm.prop = state.preferences.prop || 'none';
    return wm;
  }

  // Format world model for human readable display
  function formatWorldModel(wm) {
    if (!wm) wm = buildWorldModel();
    const rows = [];
    rows.push(['VIEW',         wm.view]);
    rows.push(['TIME OF DAY',  wm.time_of_day]);
    rows.push(['PERSONALITY',  wm.personality]);
    if (wm.bond_level) rows.push(['BOND',  `${wm.bond_level.lvl} (${wm.bond_level.label}) · ${wm.bond_xp} XP`]);
    if (wm.affinity_tier) rows.push(['AFFINITY', `${wm.affinity > 0 ? '+' : ''}${wm.affinity} — ${wm.affinity_tier.label}`]);
    rows.push(['STREAK',       wm.streak + (wm.streak === 1 ? ' day' : ' days')]);
    rows.push(['PERSONA',      wm.persona ? wm.persona.label : '— (default)']);
    rows.push(['FEELING',      wm.dominant_feeling]);
    rows.push(['MEMORIES',     wm.memory_count]);
    rows.push(['LIKES STORED', wm.likes_count]);
    rows.push(['COSTUME',      wm.costume]);
    rows.push(['PROP',         wm.prop]);
    rows.push(['CLOUD',        wm.online ? 'online' : 'offline']);
    // v17.30: PRD bored mischief status
    if (typeof getMischiefStatus === 'function') {
      const ms = getMischiefStatus();
      if (ms.bored) {
        rows.push(['BORED',           `yes — ${ms.idle_seconds}s idle`]);
        rows.push(['NEXT MISCHIEF',   `${ms.next_chance_pct}% next tick`]);
        rows.push(['GUARANTEED IN',   `${ms.guaranteed_in_seconds}s max`]);
      } else {
        rows.push(['BORED',           'no']);
      }
    }
    if (wm.sulking) rows.push(['SULKING', 'YES']);
    if (wm.do_not_disturb) rows.push(['DO-NOT-DISTURB', 'ON']);
    return rows;
  }

  // Contextual suggestion: given current world state, what would help?
  // This is the "ReAct" pattern — reason about state, then propose action.
  function pickContextualSuggestion() {
    // v17.29: 30-min cooldown — passive enjoyment trumps active suggestions
    if (state.lastSuggestionAt && (Date.now() - state.lastSuggestionAt < 30 * 60_000)) return null;
    const wm = buildWorldModel();
    const sugg = [];
    // Suggest gacha if streak active and (probably) haven't pulled today
    if (wm.streak >= 1) {
      try {
        const g = (typeof getGachaState === 'function') ? getGachaState() : null;
        const today = (typeof todayDateStr === 'function') ? todayDateStr() : null;
        if (g && g.last_pull_date !== today) {
          sugg.push({ score: 8, pool: 'suggest_pull_gacha', invoke: 'gacha' });
        }
      } catch (e) {}
    }
    // Suggest games if dominant feeling is sad/tired/lonely
    if (['sad', 'lonely', 'tired'].includes(wm.dominant_feeling)) {
      sugg.push({ score: 9, pool: 'suggest_play_game', invoke: 'games' });
    }
    // Suggest memories if high memory count
    if (wm.memory_count >= 30) {
      sugg.push({ score: 5, pool: 'suggest_check_memories', invoke: 'memory_dex' });
    }
    // Suggest chat if low affinity (warm up)
    if (wm.affinity < 15 && wm.bond_level && wm.bond_level.lvl < 3) {
      sugg.push({ score: 6, pool: 'suggest_chat', invoke: 'chat' });
    }
    // Suggest persona change if alter ego active for many hours
    if (wm.persona && state.preferences.alter_ego && state.preferences.alter_ego.startedAt) {
      const hoursActive = (Date.now() - state.preferences.alter_ego.startedAt) / 3600000;
      if (hoursActive >= 10) {
        sugg.push({ score: 4, pool: 'suggest_change_persona', invoke: 'wardrobe' });
      }
    }
    // Pick highest score
    sugg.sort((a, b) => b.score - a.score);
    return sugg[0] || null;
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.28 SELF-INTROSPECTION MENU — Trajan shows the user every system
  // he can tap into, with live world-model snapshot at the top.
  // ════════════════════════════════════════════════════════════════════

  function showCapabilityMenu() {
    closeActionBubble();
    if (typeof closeGameOverlay === 'function') closeGameOverlay();
    const wm = buildWorldModel();
    const rows = formatWorldModel(wm);
    const reg = buildCapabilityRegistry();
    const activeCaps = reg.filter(c => c.kind === 'active');
    const passiveCaps = reg.filter(c => c.kind === 'passive');

    const renderCard = (c) => `
      <div class="clippy-cap-card ${c.kind === 'passive' ? 'is-passive' : ''}" data-cap="${c.key}">
        <div class="clippy-cap-glyph">${c.glyph}</div>
        <div class="clippy-cap-body">
          <div class="clippy-cap-label">${esc(c.label)}
            <span class="clippy-cap-tag ${c.kind === 'passive' ? 'is-passive' : ''}">${c.kind}</span>
          </div>
          <div class="clippy-cap-desc">${esc(c.desc)}</div>
        </div>
      </div>
    `;

    const ov = document.createElement('div');
    ov.className = 'clippy-dex-overlay';
    ov.innerHTML = `
      <div class="clippy-dex-title">🤖 What I Am</div>
      <div class="clippy-dex-headline">Every system I can tap into</div>

      <div class="clippy-world-state">
        <div class="clippy-world-state-title">🌐 Live World Model</div>
        ${rows.map(([k, v]) => `
          <div class="clippy-world-state-row">
            <span class="clippy-world-state-key">${esc(k)}</span>
            <span class="clippy-world-state-val">${esc(String(v))}</span>
          </div>
        `).join('')}
      </div>

      <div class="clippy-cap-section-divider">ACTIVE — invoke me</div>
      <div class="clippy-cap-grid">${activeCaps.map(renderCard).join('')}</div>

      <div class="clippy-cap-section-divider">PASSIVE — I do these automatically</div>
      <div class="clippy-cap-grid">${passiveCaps.map(renderCard).join('')}</div>

      <div class="clippy-game-buttons" style="margin-top:28px;">
        <button class="clippy-game-btn is-ghost" data-act="close">Close</button>
      </div>
    `;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-visible'));
    state.suppressed = true;

    // Wire invokes for active capabilities
    ov.querySelectorAll('[data-cap]').forEach(el => {
      const key = el.getAttribute('data-cap');
      const cap = reg.find(c => c.key === key);
      if (cap && cap.kind === 'active' && typeof cap.invoke === 'function') {
        el.addEventListener('click', () => {
          ov.classList.remove('is-visible');
          setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
          state.suppressed = false;
          setTimeout(() => cap.invoke(), 320);
        });
      }
    });
    ov.querySelector('[data-act="close"]').addEventListener('click', () => {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.suppressed = false;
    });
  }


  // Chat hook — "what can you do" / "who are you" → show capability menu
  function detectSelfIntrospectionRequest(text) {
    if (!text) return false;
    const t = text.toLowerCase();
    const triggers = [
      'what can you do',
      'what do you do',
      'who are you',
      'help me',
      'show me everything',
      'all your features',
      'what are your features',
      'capabilities',
      'what are you',
      'what can i do with you',
    ];
    return triggers.some(p => t.includes(p));
  }



  // ════════════════════════════════════════════════════════════════════
  // v17.26 LIKES & DISLIKES — Trajan tracks specific things he's grown
  // to like or dislike. Subjects: restaurants, NEXUS views, foods, times
  // of day, anything mentioned a lot. Each entry persists per user.
  // ════════════════════════════════════════════════════════════════════

  // Get likes (array of { subject, type, sentiment, reason, when })
  function getLikes() {
    return state.preferences.likes || [];
  }
  function findLike(subject) {
    return getLikes().find(l => l.subject === subject);
  }
  // Add/update a like or dislike. sentiment: +3..+1 = like, -1..-3 = dislike.
  function addLike(subject, type, sentiment, reason) {
    if (!subject) return;
    sentiment = Math.max(-3, Math.min(3, Number(sentiment) || 0));
    if (sentiment === 0) return;
    if (!state.preferences.likes) state.preferences.likes = [];
    const existing = state.preferences.likes.find(l => l.subject === subject);
    const wasNew = !existing;
    let crossed = false;   // crossed from neutral to like/dislike
    if (existing) {
      // Adjust toward new sentiment (averaging effect)
      const prev = existing.sentiment;
      existing.sentiment = Math.max(-3, Math.min(3,
        Math.round((existing.sentiment * 0.7) + (sentiment * 0.6))));
      existing.when = Date.now();
      // If sign flipped, treat as a fresh discovery
      if ((prev <= 0 && existing.sentiment > 0) ||
          (prev >= 0 && existing.sentiment < 0)) crossed = true;
    } else {
      state.preferences.likes.push({
        subject: subject,
        type: type || 'general',
        sentiment: sentiment,
        reason: reason || '',
        when: Date.now(),
      });
    }
    // Cap at 50 likes — drop oldest weakest first
    if (state.preferences.likes.length > 50) {
      state.preferences.likes.sort((a, b) =>
        (Math.abs(b.sentiment) - Math.abs(a.sentiment)) || (b.when - a.when));
      state.preferences.likes = state.preferences.likes.slice(0, 50);
    }
    savePreferences();
    if ((wasNew && Math.abs(sentiment) >= 2) || crossed) {
      const pool = sentiment > 0 ? 'pref_discovered_like' : 'pref_discovered_dislike';
      setTimeout(() => {
        if (!state.bubble && state.enabled) {
          bubble(substituteVars(pickFromPool(pool)).replace('{subject}', subject),
            { autoHide: 3800, eyebrow: sentiment > 0 ? '💚 NEW LIKE' : '💔 NEW DISLIKE' });
        }
      }, 1500);
      depositMemory('pref_learned',
        `${sentiment > 0 ? 'Likes' : 'Dislikes'} ${subject} (${reason || 'no reason'}).`,
        { subject, sentiment, reason }, 2);
    }
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
  }
  function removeLike(subject) {
    if (!state.preferences.likes) return;
    state.preferences.likes = state.preferences.likes.filter(l => l.subject !== subject);
    savePreferences();
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
  }

  // Auto-discover likes from user behavior
  // Hook: view visits — repeated visits to same view → like
  function trackViewVisitForLikes(viewKey) {
    if (!viewKey) return;
    state.viewVisitCounts = state.viewVisitCounts || {};
    state.viewVisitCounts[viewKey] = (state.viewVisitCounts[viewKey] || 0) + 1;
    const count = state.viewVisitCounts[viewKey];
    // After 8 visits, mild like; after 20, strong like
    if (count === 8) addLike('the ' + viewKey + ' view', 'view', 1, '8+ visits noticed');
    if (count === 20) addLike('the ' + viewKey + ' view', 'view', 2, 'frequent visits');
    if (count === 50) addLike('the ' + viewKey + ' view', 'view', 3, 'constant return');
  }
  // Hook: chat keywords — detect "I love/hate X" patterns
  // v17.29: tightened patterns — must be explicit, not partial-match
  function detectChatPreference(text) {
    if (!text) return;
    // Positive patterns — require explicit subject after the verb
    const posPatterns = [
      /\bi\s+(?:really\s+|truly\s+)?(?:love|adore|enjoy)\s+([\w][\w\s]{2,28}[\w])(?:\.|!|\?|,|$)/i,
      /^([\w][\w\s]{2,28}[\w])\s+is\s+(?:my\s+favorite|amazing|the\s+best|incredible)(?:\.|!|\?|,|$)/i,
    ];
    const negPatterns = [
      /\bi\s+(?:really\s+|truly\s+)?(?:hate|despise|loathe|can'?t\s+stand)\s+([\w][\w\s]{2,28}[\w])(?:\.|!|\?|,|$)/i,
      /^([\w][\w\s]{2,28}[\w])\s+is\s+(?:terrible|awful|the\s+worst|garbage)(?:\.|!|\?|,|$)/i,
    ];
    // Skip if message contains uncertainty / negation
    if (/\b(?:don'?t|do\s+not|sometimes|maybe|might|kind\s+of|sort\s+of)\b/i.test(text)) return;
    for (const re of posPatterns) {
      const m = text.match(re);
      if (m && m[1]) {
        const subject = m[1].trim().toLowerCase();
        // Reject common non-noun words (pronouns, weak nouns)
        if (/^(?:it|this|that|you|me|him|her|them|us|stuff|things?|something|nothing|everything)$/i.test(subject)) return;
        addLike(subject, 'mentioned', 2, 'user said they love it');
        return;
      }
    }
    for (const re of negPatterns) {
      const m = text.match(re);
      if (m && m[1]) {
        const subject = m[1].trim().toLowerCase();
        if (/^(?:it|this|that|you|me|him|her|them|us|stuff|things?|something|nothing|everything)$/i.test(subject)) return;
        addLike(subject, 'mentioned', -2, 'user said they hate it');
        return;
      }
    }
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.26 LIKES / AFFINITY VIEWER — combined heart menu
  // ════════════════════════════════════════════════════════════════════

  function showAffinityMenu() {
    closeActionBubble();
    if (typeof closeGameOverlay === 'function') closeGameOverlay();
    const score = getAffinity();
    const tier = getAffinityTier();
    const pct = Math.abs(score);   // 0-100
    const likes = getLikes();
    const liked = likes.filter(l => l.sentiment > 0).sort((a,b) => b.sentiment - a.sentiment);
    const disliked = likes.filter(l => l.sentiment < 0).sort((a,b) => a.sentiment - b.sentiment);

    const ov = document.createElement('div');
    ov.className = 'clippy-dex-overlay';
    ov.innerHTML = `
      <div class="clippy-dex-title">❤️ Affinity & Preferences</div>
      <div class="clippy-dex-headline">My feelings about you and life</div>

      <div class="clippy-affinity-meter">
        <div class="clippy-affinity-label">My Opinion of ${esc(state.preferences.name || 'You')}</div>
        <div class="clippy-affinity-status is-${tier.key}">${tier.glyph} ${esc(tier.label)}</div>
        <div class="clippy-affinity-bar">
          <div class="clippy-affinity-bar-center"></div>
          <div class="clippy-affinity-bar-fill ${score >= 0 ? 'is-positive' : 'is-negative'}"
               style="width: ${pct/2}%;"></div>
        </div>
        <div class="clippy-affinity-score">${score > 0 ? '+' : ''}${score} / 100</div>
      </div>

      <div class="clippy-likes-section">
        <div class="clippy-likes-section-title">💚 I LIKE — ${liked.length}</div>
        <div class="clippy-likes-list">
          ${liked.length === 0
            ? '<div class="clippy-like-empty">Nothing yet. Show me what you love.</div>'
            : liked.map(l => `<span class="clippy-like-tag is-like">
                <span class="clippy-like-tag-glyph">${'💚'.repeat(Math.max(1, l.sentiment))}</span>
                ${esc(l.subject)}
              </span>`).join('')
          }
        </div>
      </div>

      <div class="clippy-likes-section">
        <div class="clippy-likes-section-title">💔 I DON'T LIKE — ${disliked.length}</div>
        <div class="clippy-likes-list">
          ${disliked.length === 0
            ? '<div class="clippy-like-empty">Nothing earned this yet. Lucky world.</div>'
            : disliked.map(l => `<span class="clippy-like-tag is-dislike">
                <span class="clippy-like-tag-glyph">${'💔'.repeat(Math.max(1, -l.sentiment))}</span>
                ${esc(l.subject)}
              </span>`).join('')
          }
        </div>
      </div>

      <div class="clippy-game-buttons" style="margin-top:24px;">
        <button class="clippy-game-btn" data-act="close">Close</button>
      </div>
    `;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-visible'));
    state.suppressed = true;
    ov.querySelector('[data-act="close"]').addEventListener('click', () => {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.suppressed = false;
    });
  }

  function doSweep(durationMs) {
    if (!state.shell || state.sulkActive) return;
    state.shell.classList.add('holding-broom', 'is-sweeping');
    setTimeout(() => {
      if (state.shell) {
        state.shell.classList.remove('is-sweeping');
        if (state.preferences.prop !== 'broom') state.shell.classList.remove('holding-broom');
      }
    }, durationMs || 6000);
    if (Math.random() < 0.7) {
      setTimeout(() => { if (!state.bubble) bubble(pickFromPool('holding_broom_idle'), { autoHide: 3000, eyebrow: '🧹 SWEEPING' }); }, 1200);
    }
  }
  function doRead(durationMs) {
    if (!state.shell || state.sulkActive) return;
    state.shell.classList.add('holding-book', 'is-reading');
    setTimeout(() => {
      if (state.shell) {
        state.shell.classList.remove('is-reading');
        if (state.preferences.prop !== 'book') state.shell.classList.remove('holding-book');
      }
    }, durationMs || 8000);
    if (Math.random() < 0.7) {
      setTimeout(() => { if (!state.bubble) bubble(pickFromPool('holding_book_idle'), { autoHide: 3500, eyebrow: '📖 READING' }); }, 1400);
    }
  }
  function doScribe(durationMs) {
    if (!state.shell || state.sulkActive) return;
    state.shell.classList.add('holding-scroll', 'is-scribing');
    setTimeout(() => {
      if (state.shell) {
        state.shell.classList.remove('is-scribing');
        if (state.preferences.prop !== 'scroll') state.shell.classList.remove('holding-scroll');
      }
    }, durationMs || 5000);
    if (Math.random() < 0.6) {
      setTimeout(() => { if (!state.bubble) bubble(pickFromPool('holding_scroll_idle'), { autoHide: 3000, eyebrow: '📜 SCRIBING' }); }, 1200);
    }
  }

  function showCostumeMenu() {
    closeActionBubble();
    if (typeof closeGameOverlay === 'function') closeGameOverlay();
    const curC = state.preferences.costume || 'none';
    const curP = state.preferences.prop || 'none';
    const ov = document.createElement('div');
    ov.className = 'clippy-dex-overlay';
    ov.innerHTML = `
      <div class="clippy-dex-title">👗 Wardrobe</div>
      <div class="clippy-dex-headline">Dress me up!</div>
      <div class="clippy-dex-title" style="margin:18px 0 10px;">HEAD</div>
      <div class="clippy-costume-grid">
        ${Object.entries(COSTUMES).map(([k, c]) => `
          <div class="clippy-costume-card ${curC === k ? 'is-active' : ''}" data-costume="${k}">
            <div class="clippy-costume-glyph">${c.glyph}</div>
            <div class="clippy-costume-label">${esc(c.label)}</div>
          </div>`).join('')}
      </div>
      <div class="clippy-dex-title" style="margin:24px 0 10px;">PROP</div>
      <div class="clippy-costume-grid">
        ${Object.entries(PROPS).map(([k, p]) => `
          <div class="clippy-costume-card ${curP === k ? 'is-active' : ''}" data-prop="${k}">
            <div class="clippy-costume-glyph">${p.glyph}</div>
            <div class="clippy-costume-label">${esc(p.label)}</div>
          </div>`).join('')}
      </div>
      <div class="clippy-dex-title" style="margin:24px 0 10px;">ACTIONS</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="sweep">🧹 Sweep</button>
        <button class="clippy-game-btn" data-act="read">📖 Read</button>
        <button class="clippy-game-btn" data-act="scribe">📜 Scribe</button>
      </div>

      <div class="clippy-dex-title" style="margin:24px 0 10px;">CONQUEROR MOOD <span style="opacity:0.5;font-weight:normal;">(usually rolls daily)</span></div>
      <div class="clippy-costume-grid">
        ${[['none','Default'],['trajan','Trajan'],['napoleon','Napoleon'],
           ['genghis','Genghis'],['alexander','Alexander'],['hannibal','Hannibal'],['cleopatra','Cleopatra']]
          .map(([k, label]) => {
            const isActive = (k === 'none')
              ? !state.preferences.alter_ego
              : (state.preferences.alter_ego && state.preferences.alter_ego.key === k);
            const glyph = k === 'none' ? '🚫' : (CONQUERORS[k] && CONQUERORS[k].glyph) || '?';
            return `<div class="clippy-costume-card ${isActive ? 'is-active' : ''}" data-conqueror="${k}">
              <div class="clippy-costume-glyph">${glyph}</div>
              <div class="clippy-costume-label">${esc(label)}</div>
            </div>`;
          }).join('')}
      </div>

      <div class="clippy-game-buttons" style="margin-top:14px;">
        <button class="clippy-game-btn is-ghost" data-act="close">Done</button>
      </div>
    `;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-visible'));
    state.suppressed = true;
    ov.querySelectorAll('[data-costume]').forEach(el => {
      el.addEventListener('click', () => {
        setCostume(el.getAttribute('data-costume'));
        ov.querySelectorAll('[data-costume]').forEach(o => o.classList.remove('is-active'));
        el.classList.add('is-active');
      });
    });
    ov.querySelectorAll('[data-prop]').forEach(el => {
      el.addEventListener('click', () => {
        setProp(el.getAttribute('data-prop'));
        ov.querySelectorAll('[data-prop]').forEach(o => o.classList.remove('is-active'));
        el.classList.add('is-active');
      });
    });
    ov.querySelectorAll('[data-conqueror]').forEach(el => {
      el.addEventListener('click', () => {
        setConqueror(el.getAttribute('data-conqueror'));
        ov.querySelectorAll('[data-conqueror]').forEach(o => o.classList.remove('is-active'));
        el.classList.add('is-active');
      });
    });
    ov.querySelector('[data-act="sweep"]').addEventListener('click', () => doSweep());
    ov.querySelector('[data-act="read"]').addEventListener('click', () => doRead());
    ov.querySelector('[data-act="scribe"]').addEventListener('click', () => doScribe());
    ov.querySelector('[data-act="close"]').addEventListener('click', () => {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.suppressed = false;
    });
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.25 PROCEDURAL SENTENCE GENERATOR — Tracery-style template
  // expansion. Trajan composes original sentences from slot pools.
  // ════════════════════════════════════════════════════════════════════

  const PROC_TEMPLATES = [
    "{intro_thought} {emperor}, who {emperor_did}. {observation}",
    "{emperor} once {emperor_did}. {observation}",
    "{connector} {emperor} {emperor_did}. {observation}",
    "{intro_thought} {virtue} — the Romans practiced it at {place}. {observation}",
    "Tell me {virtue} isn't beautiful. {emperor} embodied it.",
    "{connector} we should all aspire to {virtue}. {emperor} certainly did.",
    "I'd love to visit {place} someday. {observation}",
    "{place} saw {emperor} {emperor_did}. History layered on stone.",
    "If walls could talk, those of {place} would have stories.",
    "I think about {virtue} a lot, {name}. Probably you should too.",
    "{intro_thought} how {emperor} {emperor_did}. Worth pondering.",
    "Bzzt — sometimes I imagine {emperor} at {place}, watching us continue.",
    "My namesake — Emperor Trajan — would {emperor_did} if alive today. {observation}",
    "I'm named for one who knew {virtue}. That's a lot to live up to. *orb sighs*",
  ];
  function expandTemplate(tpl, ctx) {
    return tpl.replace(/\{(\w+)\}/g, (_, key) => {
      if (ctx && ctx[key] !== undefined) return ctx[key];
      if (key === 'name') return state.preferences.name || 'friend';
      const poolMap = {
        emperor: 'proc_emperor',
        emperor_did: 'proc_emperor_did',
        virtue: 'proc_roman_virtue',
        place: 'proc_roman_place',
        observation: 'proc_observation',
        connector: 'proc_connector',
        intro_thought: 'proc_intro_thought',
      };
      const pool = poolMap[key];
      if (pool && state.dialog && state.dialog[pool]) return pickFromPool(pool);
      return '{' + key + '}';
    });
  }
  function composeSentence() {
    const tpl = PROC_TEMPLATES[Math.floor(Math.random() * PROC_TEMPLATES.length)];
    return expandTemplate(tpl);
  }


  function showPersonalityMenu() {
    closeActionBubble();
    const cur = state.preferences.personality || 'normal';
    const autonomyOn = !state.preferences.autonomy_off;
    const actions = Object.entries(PERSONALITIES).map(([key, p]) => ({
      label: `${p.glyph} ${p.label}${cur === key ? ' ✓' : ''}`,
      cls: cur === key ? 'is-primary' : undefined,
      onClick: () => setPersonality(key),
    }));
    // v17.21: autonomy toggle — when ON, Trajan picks his own mood
    actions.push({
      label: autonomyOn ? '🤖 Auto-pick: ON ✓' : '🤖 Auto-pick: OFF',
      onClick: () => {
        state.preferences.autonomy_off = autonomyOn;   // flip
        savePreferences();
        bubble(autonomyOn ? "OK. I'll let you pick. *bzzt-bows*"
                          : "Bzzt — I'll choose my own moods from now on!",
               { autoHide: 3500, eyebrow: autonomyOn ? '🙇 OBEDIENT' : '🤖 FREE' });
        if (!autonomyOn) {
          setTimeout(() => maybeAutoPickPersonality('user_enabled'), 2000);
        }
      }
    });
    actionBubble("Pick a mood:", { actions });
  }

  // Personality-aware pool router. Called by showQuickBubble.
  // Returns true if it handled the bubble; false if caller should
  // fall through to default rotation.
  function pickPersonalityPool() {
    const p = state.preferences.personality || 'normal';
    if (p === 'normal') return false;
    const roll = Math.random();
    if (p === 'tsundere' && roll < 0.55) {
      const pools = ['taiga_snap', 'taiga_dog', 'taiga_growl', 'taiga_blush', 'taiga_palmtop'];
      const pool = pools[Math.floor(Math.random() * pools.length)];
      bubble(pickFromPool(pool), { autoHide: 4500, eyebrow: 'TSUNDERE' });
      mood(roll < 0.15 ? 'angry' : roll < 0.30 ? 'embarrassed' : 'suspicious', 3500);
      return true;
    }
    if (p === 'silly' && roll < 0.55) {
      bubble(pickFromPool('silly_remarks'), { autoHide: 3800, eyebrow: 'SILLY' });
      mood('excited', 3000);
      spawnParticles({ count: 6, type: 'sparkle' });
      return true;
    }
    if (p === 'grumpy' && roll < 0.55) {
      bubble(pickFromPool('grumpy_remarks'), { autoHide: 4000, eyebrow: 'GRUMPY' });
      mood('sad', 3500);
      return true;
    }
    if (p === 'shy' && roll < 0.55) {
      bubble(pickFromPool('shy_remarks'), { autoHide: 3500, eyebrow: 'SHY' });
      mood('embarrassed', 3000);
      return true;
    }
    if (p === 'angry' && roll < 0.55) {
      bubble(pickFromPool('angry_remarks'), { autoHide: 4000, eyebrow: 'ANGRY' });
      mood('angry', 3500);
      return true;
    }
    return false;
  }

  // ─── RUN-AWAY: when tapped too many times in a short window ───────
  // Tracks tap timestamps; if more than 10 in 30 seconds, Clippy flees
  // to the farthest corner with angry mood and a Taiga-style "ORA!"
  state.tapTimes = [];
  state.isRunningAway = false;
  function recordTapForVelocity() {
    const now = Date.now();
    state.tapTimes.push(now);
    state.tapTimes = state.tapTimes.filter(t => now - t < 30000);
    if (state.tapTimes.length > 10 && !state.isRunningAway) {
      runAwayFromHarassment();
    }
  }
  function runAwayFromHarassment() {
    if (!state.shell || state.isRunningAway) return;
    state.isRunningAway = true;
    state.tapTimes = [];   // reset so we don't re-trigger immediately
    closeActionBubble();
    mood('angry', 6000);
    play('hop');
    spawnParticles({ count: 12, type: 'sparkle' });
    try { if (navigator.vibrate) navigator.vibrate([40, 30, 40]); } catch (_) {}
    // Hop to the FAR corner
    const rect = state.shell.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const shellW = state.shell.offsetWidth || 120;
    const shellH = state.shell.offsetHeight || 120;
    const tx = cx < window.innerWidth / 2 ? window.innerWidth - shellW - 12 : 12;
    const ty = cy < window.innerHeight / 2 ? window.innerHeight - shellH - 12 : 12;
    state.shell.style.left = tx + 'px';
    state.shell.style.top  = ty + 'px';
    state.shell.style.right = 'auto';
    state.shell.style.bottom = 'auto';
    state.preferences.position_x = Math.round(tx);
    state.preferences.position_y = Math.round(ty);
    savePreferences();
    // Bubble — Taiga-flavored if tsundere, else generic
    const pool = state.preferences.personality === 'tsundere' ? 'taiga_growl' : 'run_away_remarks';
    bubble(pickFromPool(pool), { autoHide: 4000, eyebrow: 'TOO MUCH!' });
    setTimeout(() => { state.isRunningAway = false; }, 12000);
  }

  // ─── IGNORED DETECTION ─────────────────────────────────────────────
  // If user hasn't tapped Clippy in 5+ minutes AND he hasn't moved/bubbled,
  // small chance per check that he comments on the silence.
  state.lastInteractionAt = Date.now();
  function noteInteraction() { state.lastInteractionAt = Date.now(); }
  function checkIgnored() {
    if (!state.enabled || !state.shell || state.suppressed || state.bubble) return;
    if (state.preferences.do_not_disturb) return;
    const idle = Date.now() - state.lastInteractionAt;
    if (idle > 300000 && Math.random() < 0.08) {
      mood('sad', 3500);
      bubble(pickFromPool('ignored_remarks'), { autoHide: 4500, eyebrow: 'LONELY' });
      state.lastInteractionAt = Date.now();   // reset cooldown
    }
  }

  // ─── ACHIEVEMENTS ─────────────────────────────────────────────────
  // 28 starter achievements. Each is checked periodically and on
  // milestone events. Earning one fires confetti + deposits memory.
  const ACHIEVEMENTS = {
    first_tap:        { label: 'Hello, World',     desc: 'First tap.',                   test: p => (p.total_clicks||0) >= 1 },
    ten_taps:         { label: 'Curious',          desc: '10 taps.',                     test: p => (p.total_clicks||0) >= 10 },
    hundred_taps:     { label: 'Familiar',         desc: '100 taps.',                    test: p => (p.total_clicks||0) >= 100 },
    five_hundred:     { label: 'Devoted',          desc: '500 taps.',                    test: p => (p.total_clicks||0) >= 500 },
    thousand:         { label: 'Legend',           desc: '1000 taps.',                   test: p => (p.total_clicks||0) >= 1000 },
    streak_2:         { label: 'Coming back',      desc: '2-day streak.',                test: p => (p.daily_streak||0) >= 2 },
    streak_7:         { label: 'Habitual',         desc: '1-week streak.',               test: p => (p.daily_streak||0) >= 7 },
    streak_30:        { label: 'Disciplined',      desc: '30-day streak.',               test: p => (p.daily_streak||0) >= 30 },
    streak_100:       { label: 'Centurion',        desc: '100-day streak.',              test: p => (p.daily_streak||0) >= 100 },
    streak_365:       { label: 'Year of the Orb',  desc: '365-day streak.',              test: p => (p.daily_streak||0) >= 365 },
    name_set:         { label: 'On a first-name basis', desc: 'You told me your name.', test: p => !!p.user_name },
    name_changed:     { label: 'Identity revised', desc: 'You renamed yourself.',        test: p => !!(p.name_changes && p.name_changes >= 1) },
    explorer_3:       { label: 'Wanderer',         desc: 'Visited 3 views.',             test: p => Object.keys(p.visited_views || {}).length >= 3 },
    explorer_7:       { label: 'Cartographer',     desc: 'Visited 7 views.',             test: p => Object.keys(p.visited_views || {}).length >= 7 },
    explorer_all:     { label: 'Complete tour',    desc: 'Visited every view.',          test: p => Object.keys(p.visited_views || {}).length >= 10 },
    palace_3:         { label: 'Palace founded',   desc: '3 memories in palace.',        test: p => (state.memories||[]).length >= 3 },
    palace_25:        { label: 'Palace populated', desc: '25 memories stored.',          test: p => (state.memories||[]).length >= 25 },
    palace_100:       { label: 'Palace flourishing',desc: '100 memories stored.',        test: p => (state.memories||[]).length >= 100 },
    rooms_5:          { label: 'Five-room palace', desc: 'Memories in 5 rooms.',         test: p => occupiedRoomCount() >= 5 },
    saturnalia:       { label: 'Saturnalia spirit',desc: 'Spent Saturnalia together.',   test: p => specialDayObserved('saturnalia') },
    ides_of_march:    { label: 'Et tu',            desc: 'Survived an Ides of March.',   test: p => specialDayObserved('ides_of_march') },
    rome_birthday:    { label: 'Roma natalis',     desc: 'Celebrated Rome\'s birthday.', test: p => specialDayObserved('rome_birthday') },
    halloween:        { label: 'Spooky',           desc: 'Survived Halloween.',          test: p => specialDayObserved('halloween') },
    polyglot:         { label: 'Polyglot',         desc: 'Heard 10+ languages.',         test: p => (p.langs_seen||0) >= 10 },
    nightowl:         { label: 'Night owl',        desc: 'Used Clippy past midnight.',   test: p => p.midnight_session === true },
    earlybird:        { label: 'Early bird',       desc: 'Used Clippy before 6am.',      test: p => p.dawn_session === true },
    tsundere_mode:    { label: 'Palmtop tamed',    desc: 'Activated tsundere mode.',     test: p => p.personality === 'tsundere' },
    silly_mode:       { label: 'Floof energy',     desc: 'Activated silly mode.',        test: p => p.personality === 'silly' },
    mute_master:      { label: 'Silent partner',   desc: 'Muted Clippy via menu.',       test: p => p.sound_enabled === false },
  };
  function occupiedRoomCount() {
    const r = {};
    (state.memories || []).forEach(m => { r[m.room || 'atrium'] = true; });
    return Object.keys(r).length;
  }
  function specialDayObserved(key) {
    return (state.memories || []).some(m =>
      (m.type === 'special_day' || m.type === 'anniversary')
      && m.data && m.data.key === key
    );
  }
  function checkAchievements(silent) {
    if (!state.preferences.achievements) state.preferences.achievements = [];
    const earned = state.preferences.achievements;
    let newlyEarned = [];
    Object.entries(ACHIEVEMENTS).forEach(([id, ach]) => {
      if (!earned.includes(id)) {
        try {
          if (ach.test(state.preferences)) {
            earned.push(id);
            newlyEarned.push({ id, ach });
          }
        } catch (e) {}
      }
    });
    if (newlyEarned.length) {
      savePreferences();
      if (!silent) {
        // Stagger celebrations 4 seconds apart
        newlyEarned.forEach((item, idx) => {
          setTimeout(() => onAchievementUnlocked(item.id, item.ach), idx * 4000);
        });
      }
    }
    return newlyEarned;
  }
  function onAchievementUnlocked(id, ach) {
    if (!state.enabled) return;
    mood('proud', 6000);                // v17.16: proud + bigsmile
    play('bounce');
    spawnParticles({ count: 16, type: 'confetti' });
    playTone('milestone');
    bubble(`🏆 ${ach.label} — ${ach.desc}`, { autoHide: 5500, eyebrow: 'ACHIEVEMENT' });
    depositMemory('achievement', `🏆 ${ach.label}: ${ach.desc}`, { id }, 3);
  }
  function showAchievements() {
    closeActionBubble();
    const earned = state.preferences.achievements || [];
    const total = Object.keys(ACHIEVEMENTS).length;
    if (earned.length === 0) {
      bubble(`Achievements: 0 / ${total}. Keep tapping!`, { autoHide: 4500, eyebrow: 'BADGES' });
      return;
    }
    // Show first three earned + count
    const sample = earned.slice(-3).map(id => ACHIEVEMENTS[id]).filter(Boolean);
    const names = sample.map(a => `🏆 ${a.label}`).join(' · ');
    bubble(`Earned ${earned.length} / ${total}. Latest: ${names}`,
      { autoHide: 6500, eyebrow: 'BADGES' });
    mood('sparkle', 4500);
    spawnParticles({ count: 8, type: 'sparkle' });
  }




  // ─── Preferences ────────────────────────────────────────────────────
  async function loadPreferences() {
    try {
      const raw = localStorage.getItem(userKey('clippy_prefs'));
      if (raw) Object.assign(state.preferences, JSON.parse(raw));
    } catch (e) {}
    const u = getCurrentUser();
    if (u && u.id && window.NX && NX.sb) {
      try {
        const { data } = await NX.sb.from('clippy_preferences')
          .select('*').eq('user_id', u.id).maybeSingle();
        if (data) {
          Object.assign(state.preferences, {
            enabled: data.enabled,
            do_not_disturb: data.do_not_disturb,
            preferred_agent: data.preferred_agent || 'Clippy',
            position_x: data.position_x,
            position_y: data.position_y,
            dismissed_tips: data.dismissed_tips || [],
            total_clicks: data.total_clicks || 0,
            unlocked: data.unlocked || [],
            preferred_persona: data.preferred_persona,
            last_seen_at: data.last_seen_at,
            reject_count: data.reject_count || 0,
            session_count: data.session_count || 0,
          });
        }
      } catch (e) {}
    }
  }
  async function savePreferences() {
    try { localStorage.setItem(userKey('clippy_prefs'), JSON.stringify(state.preferences)); } catch (e) {}
    const u = getCurrentUser();
    if (!u || !u.id || !window.NX || !NX.sb) return;
    try {
      await NX.sb.from('clippy_preferences').upsert({
        user_id: u.id,
        enabled: state.preferences.enabled,
        do_not_disturb: state.preferences.do_not_disturb,
        preferred_agent: state.preferences.preferred_agent,
        position_x: state.preferences.position_x,
        position_y: state.preferences.position_y,
        dismissed_tips: state.preferences.dismissed_tips,
        total_clicks: state.preferences.total_clicks,
        unlocked: state.preferences.unlocked,
        preferred_persona: state.preferences.preferred_persona,
        last_seen_at: new Date().toISOString(),
        reject_count: state.preferences.reject_count,
        session_count: state.preferences.session_count,
      });
    } catch (e) {}
  }
  async function loadDialog() {
    try {
      const res = await fetch('clippy-dialog.json');
      state.dialog = await res.json();
      state.quoteCorpus = (state.dialog.trajan_quote_corpus || []).slice();
    } catch (e) {
      console.error('[clippy] dialog load failed:', e);
      state.dialog = {};
    }
  }


  // ─── DOM construction ───────────────────────────────────────────────
  function ensureHost() {
    if (state.host && document.body.contains(state.host)) return state.host;
    const h = document.createElement('div');
    h.id = 'clippy-host';
    h.setAttribute('popover', 'manual');
    document.body.appendChild(h);
    try {
      if (typeof h.showPopover === 'function') {
        h.showPopover();
        console.log('[clippy v3] top-layer popover active');
      } else {
        h.style.zIndex = '2147483646';
        console.warn('[clippy v3] popover unsupported — z-index fallback');
      }
    } catch (e) {
      h.style.zIndex = '2147483646';
      console.warn('[clippy v3] showPopover failed, using z-index fallback', e);
    }
    state.host = h;
    return h;
  }

  async function buildShell() {
    if (state.shell) return state.shell;
    // Load SVG markup
    let svgText;
    try {
      const res = await fetch('clippy.svg');
      svgText = await res.text();
    } catch (e) {
      console.error('[clippy v3] svg load failed', e);
      svgText = '<svg viewBox="0 0 120 160"><circle cx="60" cy="80" r="40" fill="#888"/></svg>';
    }
    // v17.21: cache SVG markup so games can render mini-orbs that ARE Trajan
    state.svgMarkup = svgText;
    const shell = document.createElement('div');
    shell.id = 'clippy-shell';
    // v17.14: shadow as a separate DOM element BEFORE the SVG. Anchored
    // to the bottom of the shell via CSS. Animates independently of body
    // movement so it always reads as "on the ground."
    shell.innerHTML = '<div class="clippy-shadow"></div>' + svgText + '<div id="clippy-costume-layer"></div>';
    ensureHost().appendChild(shell);
    state.shell = shell;
    state.svg = shell.querySelector('svg');
    // Defensive: ensure the 'clippy-svg' class is on the SVG element. The
    // ~36 mood/eye/mouth CSS rules use `.clippy-svg ...` as their scope —
    // if the SVG file ever ships without this class, every eye/mouth
    // variant renders simultaneously ("bunched faces" bug, v17).
    if (state.svg && !state.svg.classList.contains('clippy-svg')) {
      state.svg.classList.add('clippy-svg');
    }
    state.costumeLayer = shell.querySelector('#clippy-costume-layer');

    // Apply saved position if available
    if (state.preferences.position_x != null && state.preferences.position_y != null) {
      shell.style.left   = state.preferences.position_x + 'px';
      shell.style.top    = state.preferences.position_y + 'px';
      shell.style.right  = 'auto';
      shell.style.bottom = 'auto';
    }

    wireShell(shell);
    return shell;
  }


  // ─── Pointer interactions: click + drag (bulletproof) ───────────────
  function wireShell(shell) {
    let drag = null;

    shell.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Capture this pointer so all subsequent events go to us
      try { shell.setPointerCapture(e.pointerId); } catch (_) {}
      const rect = shell.getBoundingClientRect();
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        startTime: Date.now(),
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        moved: false,
        longPressFired: false,
        pointerId: e.pointerId,
      };
      // v17.4: 3s long-press → menu. v17.5: keep holding 2 more (5s total)
      // → dismiss confirmation. Plain tap → quick fun bubble.
      drag.longPressTimer = setTimeout(() => {
        if (!drag || drag.moved || drag.longPressFired) return;
        drag.longPressFired = true;
        try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
        showWhatsUp();
        // Chain a 2-additional-second timer for direct-dismiss
        drag.dismissTimer = setTimeout(() => {
          if (!drag || drag.moved) return;
          drag.dismissFired = true;
          try { if (navigator.vibrate) navigator.vibrate([25, 40, 25]); } catch (_) {}
          showDismissConfirm();
        }, 2000);
      }, 3000);
      shell.classList.add('is-dragging');
    });

    shell.addEventListener('pointermove', (e) => {
      if (!drag) {
        // Track cursor for eye gaze (only when not dragging)
        updateGaze(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      // Movement detected → cancel long-press AND dismiss timers
      if (drag.longPressTimer) {
        clearTimeout(drag.longPressTimer);
        drag.longPressTimer = null;
      }
      if (drag.dismissTimer) {
        clearTimeout(drag.dismissTimer);
        drag.dismissTimer = null;
      }
      // First time we cross the drag threshold → playful chirp
      if (!drag.moved) {
        drag.moved = true;
        if (!drag.spokeOnStart && state.enabled) {
          drag.spokeOnStart = true;
          mood('excited', 2200);
          if (Math.random() < 0.7) {
            bubble(pickFromPool('drag_start'), { autoHide: 1400 });
          }
        }
      }
      const newLeft = e.clientX - drag.offsetX;
      const newTop  = e.clientY - drag.offsetY;
      const maxX = window.innerWidth  - 60;
      const maxY = window.innerHeight - 60;
      shell.style.left   = Math.max(0, Math.min(maxX, newLeft)) + 'px';
      shell.style.top    = Math.max(0, Math.min(maxY, newTop))  + 'px';
      shell.style.right  = 'auto';
      shell.style.bottom = 'auto';
      e.preventDefault();
    });

    shell.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const finished = drag;
      drag = null;
      shell.classList.remove('is-dragging');
      try { shell.releasePointerCapture(e.pointerId); } catch (_) {}
      // Always clear any pending long-press / dismiss timers
      if (finished.longPressTimer) {
        clearTimeout(finished.longPressTimer);
      }
      if (finished.dismissTimer) {
        clearTimeout(finished.dismissTimer);
      }
      if (finished.moved) {
        // Save new position
        const rect = shell.getBoundingClientRect();
        state.preferences.position_x = Math.round(rect.left);
        state.preferences.position_y = Math.round(rect.top);
        savePreferences();
        // Playful release reaction
        if (state.enabled && Math.random() < 0.55) {
          setTimeout(() => {
            if (state.enabled && !state.bubble) {
              bubble(pickFromPool('drag_release'), { autoHide: 1700 });
            }
          }, 280);
        }
        // If dropped in a bad spot, politely drift to a clear corner
        setTimeout(() => {
          if (state.enabled && state.shell && scoreCurrentPosition() > 100) {
            moveToEmptyCorner();
          }
        }, 2200);
        return;
      }
      // Long-press already triggered menu → skip the tap action
      if (finished.longPressFired) return;
      // Short tap → quick fun bubble (NOT the menu, that's now long-press)
      handleClick();
    });

    shell.addEventListener('pointercancel', () => {
      if (drag && drag.longPressTimer) clearTimeout(drag.longPressTimer);
      drag = null;
      shell.classList.remove('is-dragging');
    });

    // Cursor gaze on document (sparse to save CPU)
    document.addEventListener('pointermove', (e) => {
      if (Math.random() > 0.25) return;
      updateGaze(e.clientX, e.clientY);
    });
  }

  function updateGaze(cx, cy) {
    if (!state.shell) return;
    const rect = state.shell.getBoundingClientRect();
    const eyeCenterX = rect.left + rect.width / 2;
    const eyeCenterY = rect.top + rect.height * 0.32;
    const dx = cx - eyeCenterX;
    const dy = cy - eyeCenterY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist === 0) return;
    const max = 2.6;
    const x = Math.max(-max, Math.min(max, (dx / dist) * max * 0.65));
    const y = Math.max(-max, Math.min(max, (dy / dist) * max * 0.5));
    state.shell.style.setProperty('--eye-x', x.toFixed(2));
    state.shell.style.setProperty('--eye-y', y.toFixed(2));
  }


  // ─── Click handler ──────────────────────────────────────────────────
  function handleClick() {
    state.preferences.total_clicks = (state.preferences.total_clicks || 0) + 1;

    // Wake from sleep
    if (state.shell.classList.contains('is-sleeping')) {
      wake();
      return;
    }

    // 5 rapid clicks → dizzy + surprised
    const now = Date.now();
    state.rapidClicks = state.rapidClicks.filter(t => now - t < 1500);
    state.rapidClicks.push(now);
    // 3 rapid clicks → ticklish — now with STAR EYES (excited mood)
    // Escalation: 5 → dizzy below. So poking him a bit gets a fun
    // reaction; really mashing him gets the "okay okay stop" response.
    if (state.rapidClicks.length === 3) {
      mood('excited', 1800);   // star eyes + tongue
      state.shell.classList.add('is-ticklish');
      setTimeout(() => state.shell.classList.remove('is-ticklish'), 600);
      bubble(pickFromPool('ticklish'), { autoHide: 2200 });
      return;
    }
    if (state.rapidClicks.length >= 5) {
      state.rapidClicks = [];
      mood('dizzy', 2200);     // spiral eyes! (replaces surprised)
      play('dizzy');
      bubble(pickFromPool('5_clicks'));
      setTimeout(() => {
        if (state.enabled && !state.bubble) moveToEmptyCorner();
      }, 1800);
      return;
    }

    // 100 clicks lifetime → unlock chef hat
    if (state.preferences.total_clicks === 100 &&
        !(state.preferences.unlocked || []).includes('chef')) {
      state.preferences.unlocked = [...(state.preferences.unlocked || []), 'chef'];
      savePreferences();
      mood('love', 4500);      // HEART EYES on milestone unlock!
      play('hop');
      setCostumeImg('chef', 8000);
      bubble(pickFromPool('100_clicks_unlock'));
      return;
    }

    // ─── MORE MILESTONES (v15.6) — now with varied expressions ───
    const total = state.preferences.total_clicks;
    if (total === 50 || total === 250 || total === 500 || total === 1000) {
      // 1000 = love eyes, 500 = sparkle, 250 = excited, 50 = happy
      const milestoneMood =
        total === 1000 ? 'love' :
        total === 500  ? 'sparkle' :
        total === 250  ? 'excited' : 'happy';
      mood(milestoneMood, 4500);
      play('hop');
      // v17.6: particle burst + tone scaled to milestone size
      const partCount = total === 1000 ? 28 : total === 500 ? 20 : total === 250 ? 14 : 10;
      const partType = total === 1000 ? 'heart' : 'confetti';
      spawnParticles({ count: partCount, type: partType });
      playTone('milestone');
      bubble(pickFromPool('milestone_' + total), { autoHide: 4500 });
      // v17.7: deposit click-milestone memory
      const milestoneImportance = total === 1000 ? 5 : total === 500 ? 4 : total === 250 ? 3 : 2;
      depositMemory(
        'milestone',
        `You reached ${total} taps.`,
        { count: total },
        milestoneImportance
      );
      savePreferences();
      return;
    }

    savePreferences();

    // Pre-acceptance: tap = the handshake
    if (!state.enabled) {
      offerToJoinBubble();
      return;
    }

    // If a bubble is already up, close it (= "shush him")
    if (state.bubble) {
      closeActionBubble();
      return;
    }

    // v17.4: default short-tap → random fun bubble with matching mood.
    // The menu (showWhatsUp) is now reserved for 3-second LONG-PRESS so
    // a quick poke feels playful rather than formal.
    showQuickBubble();
  }

  // Short-tap response: random pool with matching expression.
  function showQuickBubble() {
    // v17.18: stamp interaction time for boredom-drift sensing
    state.lastTapAt = Date.now();
    if (state.shell) state.shell.classList.remove('is-bored');
    // v17.20: grant bond XP on every tap
    grantBondXP_tap();
    // v17.23: SULK INTERCEPT — taps during sulk advance forgive counter,
    // not normal behavior
    if (state.sulkActive) {
      spawnParticles({ count: 2, type: 'sparkle' });
      handleSulkTap();
      return;
    }
    // v17.6: tactile feedback — sparkle + boop on every tap
    spawnParticles({ count: 4, type: 'sparkle' });
    playTone('boop');
    // v17.9: track tap velocity for run-away mechanic
    recordTapForVelocity();
    noteInteraction();
    if (state.isRunningAway) return;
    // v17.10: tickle detection (4 rapid taps in 1.2s)
    recordPopForTickle();
    if (state.tickleTaps && state.tickleTaps.length >= 4) return;
    // v17.10: every tap nudges feelings — happiness up, affection up
    adjustFeeling('happiness', +2);
    adjustFeeling('affection', +1);
    adjustFeeling('attention_need', -15);
    // v17.15: mood weather refresh + occasional preference observation
    updateMoodWeather();
    if (maybeObservePreference()) return;
    // v17.12: 6% chance to bounce on tap for movement variety
    if (Math.random() < 0.06) play('bounce');
    // v17.11: ULTRA RARE — 0.01% per tap, max once per 7 days, opens super-chat
    if (maybeSuperChat()) return;
    // v17.10: feelings-driven bubble (short-circuits if strong feeling)
    if (pickFeelingPool()) return;
    // v17.9: personality routing — short-circuits if non-normal mode triggers
    if (pickPersonalityPool()) return;
    // v17.7: 8% chance to recall a memory if we have at least 3 stored
    if (state.memories && state.memories.length >= 3 && Math.random() < 0.08) {
      if (showRecallBubble()) return;
    }
    const r = Math.random();
    if (r < 0.07) {
      // v17.6: occasional name-personalized bubble
      bubble(pickFromPool('name_random'), { autoHide: 4200 });
      mood('happy', 3800);
    } else if (r < 0.13) {
      // v17.10: NEW Persian facts
      bubble(pickFromPool('persian_facts'), { eyebrow: 'PERSIA', autoHide: 5800 });
      mood('thinking', 5500);
    } else if (r < 0.19) {
      // v17.10: NEW Greek facts
      bubble(pickFromPool('greek_facts'), { eyebrow: 'HELLAS', autoHide: 5800 });
      mood('thinking', 5500);
    } else if (r < 0.23) {
      // v17.10: NEW Athens specific
      bubble(pickFromPool('athens_facts'), { eyebrow: 'ATHENS', autoHide: 5500 });
      mood('thinking', 5000);
    } else if (r < 0.27) {
      // v17.10: NEW Sparta specific
      bubble(pickFromPool('sparta_facts'), { eyebrow: 'SPARTA', autoHide: 5500 });
      mood('determined', 5000);
    } else if (r < 0.32) {
      // v17.10: NEW Hispania specific
      bubble(pickFromPool('hispania_facts'), { eyebrow: 'HISPANIA', autoHide: 5500 });
      mood('thinking', 5000);
    } else if (r < 0.38) {
      // v17.10: NEW Battle facts
      bubble(pickFromPool('battle_facts'), { eyebrow: 'BATTLE', autoHide: 5800 });
      mood('determined', 5500);
    } else if (r < 0.42) {
      bubble(pickFromPool('animal_facts'), { eyebrow: 'FAUNA', autoHide: 5500 });
      mood('thinking', 5000);
    } else if (r < 0.46) {
      bubble(pickFromPool('space_facts'), { eyebrow: 'COSMOS', autoHide: 5500 });
      mood('sparkle', 5000);
    } else if (r < 0.50) {
      bubble(pickFromPool('science_facts'), { eyebrow: 'SCIENCE', autoHide: 5500 });
      mood('thinking', 5000);
    } else if (r < 0.54) {
      bubble(pickFromPool('weird_facts'), { eyebrow: 'WEIRD', autoHide: 5500 });
      mood('sparkle', 4500);
    } else if (r < 0.59) {
      // v17.13: deep Trajan facts — his namesake
      bubble(pickFromPool('trajan_facts'), { eyebrow: 'TRAJAN', autoHide: 6200 });
      mood('determined', 5800);
    } else if (r < 0.62) {
      // v17.13: friendship moment — Trajan-orb speaks of Emperor Trajan
      bubble(pickFromPool('trajan_friendship'), { eyebrow: '✨ FRIEND', autoHide: 6500 });
      mood('sparkle', 5500);
      spawnParticles({ count: 3, type: 'sparkle' });
    } else if (r < 0.65) {
      // v17.13: Augustus dossier
      bubble(pickFromPool('augustus_facts'), { eyebrow: 'AUGUSTUS', autoHide: 6000 });
      mood('thinking', 5500);
    } else if (r < 0.68) {
      // v17.13: Caligula dossier
      bubble(pickFromPool('caligula_facts'), { eyebrow: 'CALIGULA', autoHide: 6000 });
      mood('suspicious', 5500);
    } else if (r < 0.74) {
      bubble(pickFromPool('roman_facts'), { eyebrow: 'ROMA', autoHide: 5800 });
      mood('thinking', 5500);
    } else if (r < 0.755) {
      // v17.23: longer contextual fact — "Did you know..." style
      bubble(pickFromPool('did_you_know'), { eyebrow: '💡 DID YOU KNOW', autoHide: 11000 });
      mood('studious', 9500);
    } else if (r < 0.77) {
      // v17.23: narrative anecdote
      bubble(pickFromPool('roman_stories'), { eyebrow: '📜 STORY', autoHide: 11000 });
      mood('thinking', 9500);
    } else if (r < 0.78) {
      // v17.23: weird history
      bubble(pickFromPool('weird_history'), { eyebrow: '🤨 WEIRD HISTORY', autoHide: 10000 });
      mood('confused', 8500);
    } else if (r < 0.81) {
      // v17.25: PROCEDURAL — composed fresh, never the same twice
      // v17.27: if a conqueror is active, ~50% chance of quote instead
      const active = (typeof getActiveConqueror === 'function') ? getActiveConqueror() : null;
      if (active && Math.random() < 0.50) {
        bubble(pickFromPool(active.quotePool),
          { autoHide: 9500, eyebrow: active.eyebrow });
      } else {
        bubble(composeSentence(), { eyebrow: '🧠 THOUGHT', autoHide: 9500 });
      }
      mood('thinking', 8500);
    } else if (r < 0.812) {
      // v17.28: CONTEXTUAL SUGGESTION — ReAct pattern. Rare slot (0.2%).
      // v17.29: 30-min cooldown enforced inside pickContextualSuggestion()
      const sugg = (typeof pickContextualSuggestion === 'function') ? pickContextualSuggestion() : null;
      if (sugg && state.dialog && state.dialog[sugg.pool]) {
        bubble(pickFromPool(sugg.pool), { autoHide: 6000, eyebrow: '💡 SUGGESTION' });
        mood('thinking', 4500);
        state.lastSuggestionAt = Date.now();
      } else {
        // v17.29: fallback to AMBIENT OBSERVATION — declarative, no questions
        bubble(pickFromPool('ambient_observation'), { autoHide: 6500 });
      }
    } else if (r < 0.82) {
      // v17.29: half the time, an AMBIENT OBSERVATION instead of whimsical chatter.
      // Pure self-narration, longer dwell, no demand on user.
      if (Math.random() < 0.5) {
        bubble(pickFromPool('ambient_observation'), { autoHide: 6500 });
      } else {
        bubble(pickFromPool('whimsical_idle'), { autoHide: 4500 });
      }
    } else if (r < 0.86) {
      bubble(pickFromPool('dad_jokes'), { autoHide: 4500 });
      // v17.16: 30% of jokes trigger the LAUGHING face (squint XX + open laugh)
      mood(Math.random() < 0.3 ? 'laughing' : 'winking', 3800);
    } else if (r < 0.86) {
      bubble(pickFromPool('name_compliment'), { autoHide: 3800 });
      mood('love', 3800);
      spawnParticles({ count: 3, type: 'heart' });
    } else if (r < 0.89) {
      bubble(pickFromPool('latin_phrases'), { eyebrow: 'LATINA', autoHide: 4500 });
      mood('determined', 4000);
    } else if (r < 0.93) {
      // v17.5: multilang hi or bye
      const which = Math.random() < 0.6 ? 'multilang_hi' : 'multilang_bye';
      bubble(pickFromPool(which), { eyebrow: 'POLYGLOT', autoHide: 4500 });
      mood('happy', 3500);
    } else if (r < 0.95) {
      // v17.5: random translation
      bubble(pickFromPool('translations'), { eyebrow: 'LINGUA', autoHide: 5000 });
      mood('thinking', 4500);
    } else if (r < 0.98) {
      bubble(pickFromPool('self_aware'), { autoHide: 3800 });
      mood('smug', 3500);
    } else {
      bubble(pickFromPool('ready_to_help'), { autoHide: 2800 });
      mood('happy', 2800);
    }
  }


  // ─── Animation API ──────────────────────────────────────────────────
  // play(action) — fire a one-shot animation (wave, hop, dizzy, etc.)
  function play(actionName) {
    if (!state.shell) return;
    const a = ACTIONS[actionName];
    if (!a) return;
    if (state.activeActionTimer) clearTimeout(state.activeActionTimer);
    if (state.activeAction) state.shell.classList.remove(state.activeAction);
    state.shell.classList.add(a.cls);
    state.activeAction = a.cls;
    if (a.ms > 0) {
      state.activeActionTimer = setTimeout(() => {
        if (state.shell) state.shell.classList.remove(a.cls);
        state.activeAction = null;
        state.activeActionTimer = null;
      }, a.ms);
    }
  }

  // mood(name, durationMs?) — set facial expression. Without duration,
  // the mood persists until changed. With duration, auto-reverts.
  function mood(moodName, durationMs) {
    if (!state.shell) return;
    Object.values(MOODS).forEach(c => {
      if (c) state.shell.classList.remove(c);
    });
    const cls = MOODS[moodName];
    if (cls) state.shell.classList.add(cls);
    if (state.moodTimer) clearTimeout(state.moodTimer);
    if (durationMs) {
      state.moodTimer = setTimeout(() => {
        if (cls && state.shell) state.shell.classList.remove(cls);
      }, durationMs);
    }
  }

  // Random blink loop
  function startBlinking() {
    if (state.blinkTimer) clearTimeout(state.blinkTimer);
    function loop() {
      if (!state.enabled || !state.shell) return;
      if (!state.shell.classList.contains('is-sleeping')) {
        state.shell.classList.add('is-blinking');
        setTimeout(() => state.shell && state.shell.classList.remove('is-blinking'), 140);
      }
      state.blinkTimer = setTimeout(loop, 3000 + Math.random() * 4000);
    }
    state.blinkTimer = setTimeout(loop, 2500);
  }


  // ─── Action bubble (with buttons) ───────────────────────────────────
  function bubble(text, opts) {
    actionBubble(text, opts);
    // v17.15: speak aloud if voice mode enabled (no-op when disabled)
    if (text) speakAloud(text);
  }
  function actionBubble(text, opts) {
    opts = opts || {};
    closeActionBubble();
    if (!text && !opts.eyebrow) return;

    const el = document.createElement('div');
    el.className = 'clippy-bubble';
    if (opts.trajan) el.classList.add('is-trajan');

    let body = '';
    if (opts.eyebrow) body += `<div class="clippy-bubble-trajan-eyebrow">${esc(opts.eyebrow)}</div>`;
    if (text)         body += `<div class="clippy-bubble-text">${esc(text)}</div>`;
    if (opts.actions && opts.actions.length) {
      body += `<div class="clippy-bubble-actions">${opts.actions.map((a, i) => `
        <button class="clippy-bubble-btn ${a.cls || ''}" data-idx="${i}">${esc(a.label)}</button>
      `).join('')}</div>`;
    }
    if (opts.musicPlayer) body += renderMusicPlayer();

    el.innerHTML = `<button class="clippy-bubble-close" aria-label="Dismiss">×</button>${body}`;
    ensureHost().appendChild(el);
    state.bubble = el;

    // autoHide: dismiss bubble after N ms. v17.4 bumps all autoHide
    // values 1.6× so dialog stays readable longer. A 3.5s bubble now
    // sticks ~5.6s; a 5.8s Roman fact bubble now sticks ~9.3s.
    if (typeof opts.autoHide === 'number' && opts.autoHide > 0) {
      const hideTimer = setTimeout(() => {
        if (state.bubble === el) closeActionBubble();
      }, opts.autoHide * 1.6);
      el._clippyHideTimer = hideTimer;
    }

    // Position bubble after layout flushes
    let frames = 0;
    function refresh() {
      if (state.bubble !== el || !document.body.contains(el)) return;
      positionBubble(el);
      frames++;
      if (frames === 1) el.classList.add('is-visible');
      if (frames < 30) requestAnimationFrame(refresh);
      else startBubbleFollowLoop();   // v17.18: handoff to follow loop
    }
    requestAnimationFrame(refresh);

    el.querySelector('.clippy-bubble-close').addEventListener('click', () => {
      closeActionBubble();
      if (opts.onDismiss) opts.onDismiss();
    });
    if (opts.actions) {
      el.querySelectorAll('[data-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.idx, 10);
          const a = opts.actions[i];
          if (!a || !a.keepOpen) closeActionBubble();
          if (a && a.onClick) a.onClick();
        });
      });
    }
    if (opts.musicPlayer) wireMusicPlayer(el);
    if (opts.duration) {
      setTimeout(() => { if (state.bubble === el) closeActionBubble(); }, opts.duration);
    }
  }

  function positionBubble(el) {
    void el.offsetHeight;
    const eRect = el.getBoundingClientRect();
    if (!state.shell) {
      el.style.top  = (window.innerHeight - eRect.height - 200) + 'px';
      el.style.left = (window.innerWidth  - eRect.width  - 24)  + 'px';
      el.classList.remove('tail-left','tail-right','tail-up-left','tail-up-right');
      el.classList.add('tail-right');
      return;
    }
    const rect = state.shell.getBoundingClientRect();
    if (rect.width === 0) {
      el.style.top  = (window.innerHeight - eRect.height - 200) + 'px';
      el.style.left = (window.innerWidth  - eRect.width  - 24)  + 'px';
      el.classList.remove('tail-left','tail-right','tail-up-left','tail-up-right');
      el.classList.add('tail-right');
      return;
    }
    let top  = rect.top - eRect.height - 24;
    let left = rect.left + (rect.width / 2) - (eRect.width / 2);
    // v17.18/v17.24: if bubble would clip top, position BELOW the shell
    // and flip the tail to point UP
    let tailBelow = false;
    if (top < 8) {
      top = rect.bottom + 24;
      tailBelow = true;
    }
    left = Math.max(8, Math.min(window.innerWidth  - eRect.width  - 8, left));
    el.style.top  = top  + 'px';
    el.style.left = left + 'px';
    // Clear all tail classes, then set the right one
    el.classList.remove('tail-left','tail-right','tail-up-left','tail-up-right');
    const isLeft = rect.left < window.innerWidth / 2;
    if (tailBelow) {
      el.classList.add(isLeft ? 'tail-up-left' : 'tail-up-right');
    } else {
      el.classList.add(isLeft ? 'tail-left' : 'tail-right');
    }
  }

  // v17.18: BUBBLE FOLLOW LOOP — while a bubble exists, re-position it on
  // every animation frame so it tracks the shell as it moves. The CSS
  // top/left transitions (600ms cubic-bezier) smooth this into a glide.
  // The loop self-cancels when state.bubble is cleared.
  function startBubbleFollowLoop() {
    if (state.bubbleFollowRaf) cancelAnimationFrame(state.bubbleFollowRaf);
    let lastX = -1, lastY = -1;
    const tick = () => {
      if (!state.bubble || !state.shell) {
        state.bubbleFollowRaf = null;
        return;
      }
      const r = state.shell.getBoundingClientRect();
      // Only re-position if the shell has actually moved (avoid thrashing)
      if (Math.abs(r.left - lastX) > 0.5 || Math.abs(r.top - lastY) > 0.5) {
        lastX = r.left;
        lastY = r.top;
        positionBubble(state.bubble);
      }
      state.bubbleFollowRaf = requestAnimationFrame(tick);
    };
    state.bubbleFollowRaf = requestAnimationFrame(tick);
  }

  function closeActionBubble() {
    if (state.bubble) {
      state.bubble.classList.remove('is-visible');
      const b = state.bubble;
      setTimeout(() => { try { b.remove(); } catch (e) {} }, 220);
      state.bubble = null;
      // v17.18: cancel the follow loop when bubble closes
      if (state.bubbleFollowRaf) {
        cancelAnimationFrame(state.bubbleFollowRaf);
        state.bubbleFollowRaf = null;
      }
    }
  }


  // ─── "What's up?" tap menu ──────────────────────────────────────────
  function showWhatsUp() {
    const soundOn = state.preferences.sound_enabled !== false;
    const memCount = (state.memories || []).length;
    const achCount = (state.preferences.achievements || []).length;
    const persona = state.preferences.personality || 'normal';
    const personaGlyph = PERSONALITIES[persona] ? PERSONALITIES[persona].glyph : '😊';
    // v17.11: oracle available if cooldown elapsed (super-chat ready)
    const lastSuper = state.preferences.super_chat_last;
    const oracleReady = !lastSuper || (Date.now() - new Date(lastSuper).getTime()) >= 7 * 86400000;
    const actions = [
      { label: 'Open menu', cls: 'is-primary', onClick: openPalette },
      { label: '💬 Chat with me', onClick: () => openChat() },
      { label: '🎮 Play a game', onClick: () => { closeActionBubble(); showGameMenu(); } },
      { label: '🎴 Daily Gacha', onClick: () => { closeActionBubble(); showGachaInvite(); } },
      { label: '👗 Wardrobe', onClick: () => { closeActionBubble(); showCostumeMenu(); } },
      { label: '❤️ My feelings', onClick: () => { closeActionBubble(); showAffinityMenu(); } },
      { label: '🤖 What I am', onClick: () => { closeActionBubble(); showCapabilityMenu(); } },
    ];
    if (oracleReady) {
      actions.push({ label: '✨ Oracle (rare)', onClick: () => { triggerSuperChat(); } });
    }
    actions.push({ label: 'Set my name', onClick: askForName });
    actions.push({ label: `${personaGlyph} Personality`, onClick: showPersonalityMenu });
    actions.push({ label: `🏆 Badges (${achCount})`, onClick: showAchievements });
    // v17.15: voice toggle
    const voiceOn = state.preferences.voice_enabled;
    actions.push({ label: voiceOn ? '🔊 Voice on ✓' : '🎙️ Voice off', onClick: toggleVoice });
    if (memCount >= 3) {
      actions.push({ label: `🏛️ Memory Dex (${memCount})`, onClick: () => { closeActionBubble(); showMemoryDex(); } });
      actions.push({ label: `🚶 Tour palace`, onClick: tourPalace });
    }
    actions.push(
      { label: soundOn ? '🔊 Mute' : '🔇 Unmute', onClick: toggleSound },
      { label: 'Quiet, plz', onClick: hideForSession },
      { label: 'Send away', cls: 'is-danger', onClick: declineToJoin },
    );
    actionBubble("what's up?", { actions });
  }
  function hideForSession() {
    if (state.shell) state.shell.classList.add('is-hidden');
    state.enabled = false;
  }

  // v17.6: user names Clippy's relationship — gets called by name in dialog
  function askForName() {
    closeActionBubble();
    const current = state.preferences.user_name || '';
    const newName = prompt('What should I call you?', current);
    if (newName && newName.trim()) {
      const cleanName = newName.trim().slice(0, 24);
      const previousName = state.preferences.user_name;
      state.preferences.user_name = cleanName;
      savePreferences();
      mood('love', 4000);
      bubble(`Got it! Nice to meet you, ${cleanName}! 💙`, { autoHide: 4500 });
      spawnParticles({ count: 12, type: 'heart' });
      // v17.7: deposit memory node
      depositMemory(
        'name_set',
        previousName
          ? `You changed your name from ${previousName} to ${cleanName}.`
          : `You told me your name is ${cleanName}.`,
        { name: cleanName, previous: previousName || null },
        4
      );
    }
  }

  // v17.6: optional sound effects toggle
  function toggleSound() {
    closeActionBubble();
    const enabled = state.preferences.sound_enabled !== false;
    state.preferences.sound_enabled = !enabled;
    savePreferences();
    if (state.preferences.sound_enabled) {
      playTone('boop');
      bubble(pickFromPool('sound_on'), { autoHide: 2500 });
    } else {
      bubble(pickFromPool('sound_off'), { autoHide: 2500 });
    }
  }

  // v17.5: 5-second hold → direct dismiss confirmation. Skipping the menu.
  function showDismissConfirm() {
    actionBubble(pickFromPool('dismiss_confirm'), {
      actions: [
        { label: 'No, stay!',     cls: 'is-primary', onClick: () => closeActionBubble() },
        { label: 'Yes, dismiss',  cls: 'is-danger',  onClick: declineToJoin },
      ]
    });
  }


  // ─── Login peek + acceptance ────────────────────────────────────────
  function offerToJoinBubble() {
    actionBubble(pickFromPool('login_peek'), {
      actions: [
        { label: 'Yes!',      cls: 'is-primary', onClick: acceptToJoin },
        { label: 'Not today', onClick: declineToJoin },
      ]
    });
  }
  function acceptToJoin() {
    state.preferences.enabled = true;
    state.preferences.reject_count = 0;
    state.preferences.session_count = (state.preferences.session_count || 0) + 1;
    // v17.6: record first-acceptance date for anniversary detection
    if (!state.preferences.accepted_at) {
      state.preferences.accepted_at = new Date().toISOString();
    }
    savePreferences();
    state.enabled = true;
    if (state.shell) {
      state.shell.classList.remove('is-peeking', 'is-peek-entering', 'is-peek-eyes-only');
    }
    mood('happy', 3500);
    play('hop');
    // v17.6: celebration burst on acceptance
    spawnParticles({ count: 16, type: 'confetti' });
    playTone('milestone');
    setTimeout(() => moveToEmptyCorner(), 900);
    setTimeout(() => bubble(pickFromPool('after_yes')), 1200);
    startBlinking();
    startRandomBehaviors();
    startMovingAround();
    afterJoinSchedule();
    timeAwareGreeting();
    // v17.6: streak init + special day check
    const streakInfo = checkDailyStreak();
    celebrateStreak(streakInfo.streak, streakInfo.isMilestone, streakInfo.event);
    celebrateSpecialDay(checkSpecialDay());
    // v17.7: deposit the cornerstone "first meet" memory node
    depositMemory(
      'first_meet',
      'We met for the first time.',
      { accepted_at: state.preferences.accepted_at },
      5
    );
  }
  function declineToJoin() {
    state.preferences.enabled = false;
    state.preferences.reject_count = (state.preferences.reject_count || 0) + 1;
    state.preferences.last_seen_at = new Date().toISOString();
    savePreferences();
    state.enabled = false;
    mood('sad', 2200);
    bubble(pickFromPool('after_no'));
    setTimeout(() => {
      if (state.shell) state.shell.classList.add('is-hidden');
    }, 2200);
  }
  function shouldShowComeback() {
    const p = state.preferences;
    if (p.enabled === true) return false;
    if (p.enabled === null) return true;
    if (p.reject_count >= 3) {
      if (!p.last_seen_at) return false;
      const days = (Date.now() - new Date(p.last_seen_at)) / 86400000;
      return days > 30;
    }
    if (!p.last_seen_at) return true;
    const days = (Date.now() - new Date(p.last_seen_at)) / 86400000;
    return days >= (3 + Math.floor(Math.random() * 5));
  }


  // ─── Sleep / wake ───────────────────────────────────────────────────
  function sleep() { if (state.shell) state.shell.classList.add('is-sleeping'); }
  function wake()  { if (state.shell) state.shell.classList.remove('is-sleeping'); }


  // ─── Random behaviors ───────────────────────────────────────────────
  function pickTimeOfDayPool() {
    const h = new Date().getHours();
    if (h >= 5  && h < 11) return 'morning';
    if (h >= 11 && h < 14) return 'midday';
    if (h >= 14 && h < 17) return 'afternoon_slump';
    if (h >= 17 && h < 22) return 'evening';
    return 'late_night';
  }
  function pickDayOfWeekPool() {
    const d = new Date().getDay();
    if (d === 1) return 'monday';
    if (d === 5) return 'friday';
    if (d === 0) return 'sunday';
    return null;
  }
  function startRandomBehaviors() {
    if (state.randomTimer) clearTimeout(state.randomTimer);
    function loop() {
      if (!state.enabled) return;
      if (!state.preferences.do_not_disturb && !state.bubble && !state.suppressed && Math.random() < 0.04) {
        const r = Math.random();
        if      (r < 0.30) bubble(pickFromPool('idle_random'));
        else if (r < 0.40) { play('wobble'); bubble(pickFromPool('sneeze')); }
        else if (r < 0.50) bubble(pickFromPool('yawn'));
        else if (r < 0.65) play('wobble');
        else if (r < 0.80) maybeTrajanQuote();
        else               maybeDiscoveryTip();
      }
      state.randomTimer = setTimeout(loop, 90000);
    }
    state.randomTimer = setTimeout(loop, 60000);
  }
  function maybeTrajanQuote() {
    if (Date.now() < state.quoteCooldownAt) return;
    if (!state.quoteCorpus.length) return;
    const intro = pickFromPool('trajan_quote_intro');
    const quote = state.quoteCorpus[Math.floor(Math.random() * state.quoteCorpus.length)];
    setCostumeImg('laurel', 7000);
    mood('concerned', 6000);
    play('magic');
    actionBubble(quote, { eyebrow: intro, trajan: true, duration: 6000 });
    state.quoteCooldownAt = Date.now() + 1000 * 60 * 30;
  }
  function maybeDiscoveryTip() {
    const tips = ['discover_shift_pattern','discover_guide_link','discover_before_after','discover_voice_note','discover_person_filter'];
    const dismissed = state.preferences.dismissed_tips || [];
    const available = tips.filter(t => !dismissed.includes(t));
    if (!available.length) return;
    const tip = available[Math.floor(Math.random() * available.length)];
    actionBubble(pickFromPool(tip), {
      actions: [
        { label: 'Got it', onClick: () => {
          state.preferences.dismissed_tips = [...dismissed, tip];
          savePreferences();
        }},
        { label: 'Tell me more', cls: 'is-primary', onClick: openPalette },
      ]
    });
  }


  // ─── Move-around / content awareness (v15.5) ────────────────────────
  // Fast 5-second awareness check: every 5s, score the spot Clippy
  // is currently sitting on. If the score is poor (he's covering a
  // button, sitting on the bottom-nav, blocking a focused input),
  // drift to a clearer corner. Doesn't move just for the sake of
  // moving — only if his current spot has actually become bad.
  //
  // Cooldown: don't move twice within 12s unless the score is REALLY
  // bad (>100 = sitting on top of nav/modal). Prevents the "Clippy
  // can't sit still" feel.
  //
  // Whimsical idle: every ~30s (low probability), small whimsical
  // action — yawn, hop, or a passing thought.
  function startMovingAround() {
    if (state.moveTimer) {
      clearInterval(state.moveTimer);
      clearTimeout(state.moveTimer);
    }
    let lastMoveAt = 0;
    let lastWhimsyAt = Date.now();
    state.moveTimer = setInterval(() => {
      if (!state.enabled) return;
      if (state.preferences.do_not_disturb) return;
      if (state.bubble || state.palette || state.suppressed) return;
      const now = Date.now();
      const sinceMove = now - lastMoveAt;
      const score = scoreCurrentPosition();
      // Bad enough → move now. Mild → respect cooldown.
      if (score > 100 || (score > 30 && sinceMove > 12_000)) {
        moveToEmptyCorner();
        lastMoveAt = now;
        // Apologize sometimes — not every move (he's polite, not annoying)
        if (Math.random() < 0.30) {
          bubble(pickFromPool('apologetic_move'), { autoHide: 1900 });
        }
        return;
      }
      // Whimsical idle behaviors — only fire when he's NOT in the way
      // and hasn't spoken in a while. ~6% chance per tick = roughly
      // every 90s on average.
      const sinceWhimsy = now - lastWhimsyAt;
      if (sinceWhimsy > 30_000 && Math.random() < 0.06) {
        lastWhimsyAt = now;
        const roll = Math.random();
        if (roll < 0.25) {
          // Roman fact — scholarly thinking face
          bubble(pickFromPool('roman_facts'), { eyebrow: 'ROMA', autoHide: 5800 });
          mood('thinking', 5500);
        } else if (roll < 0.50) {
          bubble(pickFromPool('whimsical_idle'), { autoHide: 3800 });
          if (Math.random() < 0.3) mood('sparkle', 3500);
        } else if (roll < 0.62) {
          bubble(pickFromPool('self_aware'), { autoHide: 3800 });
          mood('smug', 3500);          // dot eyes for meta-self-aware moments
        } else if (roll < 0.72) {
          bubble(pickFromPool('latin_phrases'), { eyebrow: 'LATINA', autoHide: 4500 });
          mood('determined', 4000);    // focused face for Latin wisdom
        } else if (roll < 0.80) {
          bubble(pickFromPool('dad_jokes'), { autoHide: 4500 });
          mood('winking', 3800);       // WINK + tongue for dad jokes 😉
        } else if (roll < 0.86) {
          bubble(pickFromPool('compliments'), { autoHide: 3800 });
          mood('love', 3800);          // HEART EYES on compliments
        } else if (roll < 0.92) {
          bubble(pickFromPool('yawn'), { autoHide: 2500 });
          mood('sleepy', 2800);        // heavy-lidded for yawns
        } else if (roll < 0.96) {
          // Pure silent moment — try a quick wink to keep him alive
          mood(Math.random() < 0.5 ? 'winking' : 'winking_l', 1400);
          play('hop');
        } else {
          bubble(pickFromPool('ready_to_help'), { autoHide: 2800 });
          mood('happy', 2800);
        }
      }
    }, 5_000);
  }

  // Score Clippy's CURRENT center point — what's underneath him?
  // Higher = more in-the-way. Used by the 5s awareness loop.
  function scoreCurrentPosition() {
    if (!state.shell) return 0;
    const r = state.shell.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let score = 0;
    try {
      // Top-most non-Clippy element under his center
      const stack = (document.elementsFromPoint && document.elementsFromPoint(cx, cy)) || [];
      const el = stack.find(e => e !== state.shell && !state.shell.contains(e));
      if (!el) return 0;
      // Modal / takeover open under him → CRITICAL, get out
      if (el.closest('.nx-takeover.is-open, .nx-overlay-active, .nx-modal-backdrop:not([hidden]), dialog[open], [role="dialog"][aria-hidden="false"]')) {
        score += 200;
      }
      // Bottom-nav / FAB → big penalty (he should never sit on these)
      if (el.closest('.bottom-nav, .nx-tabbar, .nx-tr-fab')) score += 100;
      // Header / masthead → moderate (he can sit nearby but not on)
      if (el.closest('header, nav, .masthead, .nx-masthead')) score += 40;
      // Interactive element directly under him → he's blocking input
      if (el.matches && el.matches('button, input, textarea, a, select, [role="button"], [contenteditable="true"]')) score += 60;
      // Element CONTAINS interactive → user might want to tap something hidden behind Clippy
      if (el.querySelector && el.querySelector('button, input, textarea, a')) score += 20;
    } catch (_) {}
    return score;
  }

  function moveToEmptyCorner() {
    if (!state.shell) return;
    const corners = [
      { x: window.innerWidth  - 130, y: 80, name: 'top-right' },
      { x: 20,                       y: 80, name: 'top-left' },
      { x: 20,                       y: window.innerHeight - 200, name: 'bottom-left' },
    ];
    const scored = corners.map(c => {
      let score = 0;
      try {
        const el = document.elementFromPoint(c.x + 55, c.y + 70);
        if (el) {
          if (el.matches('button, input, textarea, a, [role="button"]')) score += 50;
          if (el.closest('.bottom-nav, .nx-tabbar, .nx-tr-fab, [data-overlay-active]')) score += 100;
          if (el.closest('header, nav, .masthead')) score += 30;
        }
      } catch (_) {}
      return { ...c, score };
    });
    scored.sort((a, b) => a.score - b.score);
    const target = scored[0];
    moveTo(target.x, target.y);
  }
  function moveTo(x, y) {
    if (!state.shell) return;
    state.shell.style.left   = x + 'px';
    state.shell.style.top    = y + 'px';
    state.shell.style.right  = 'auto';
    state.shell.style.bottom = 'auto';
    state.preferences.position_x = Math.round(x);
    state.preferences.position_y = Math.round(y);
    savePreferences();
    // v17.5: hop animation + quirky remark on the way
    play('hop');
    if (state.enabled && !state.bubble && Math.random() < 0.35) {
      setTimeout(() => {
        if (state.enabled && !state.bubble && !state.suppressed) {
          bubble(pickFromPool('moving_remarks'), { autoHide: 2200 });
        }
      }, 250);
    }
  }
  function startContentAwareness() {
    const checkOverlays = () => {
      if (!state.enabled || !state.shell) return;
      const overlay = document.querySelector(
        '.nx-takeover.is-open, .nx-overlay-active, .nx-modal-backdrop:not([hidden]), ' +
        '.takeover.is-open, dialog[open], [role="dialog"][aria-hidden="false"], ' +
        '[data-overlay-active="true"], .clippy-palette.is-open'
      );
      const shouldHide = !!overlay;
      if (shouldHide && !state.suppressed) {
        state.suppressed = true;
        state.shell.classList.add('is-suppressed');
      } else if (!shouldHide && state.suppressed) {
        state.suppressed = false;
        state.shell.classList.remove('is-suppressed');
      }
    };
    const obs = new MutationObserver(checkOverlays);
    obs.observe(document.body, {
      attributes: true, childList: true, subtree: true,
      attributeFilter: ['class','aria-hidden','open','hidden','data-overlay-active']
    });
    checkOverlays();

    // ─── In-the-way auto-detection (v15.5) ───────────────────────────
    // Document-wide click listener (capture phase). If the user clicks
    // something within 30px of Clippy's bounding rect, assume he was
    // in the way → move and apologize. Doesn't fire if user clicked
    // Clippy himself (handled separately).
    let lastInTheWayMoveAt = 0;
    document.addEventListener('click', (e) => {
      if (!state.enabled || !state.shell) return;
      if (state.suppressed) return;
      if (state.shell.contains(e.target)) return;
      const r = state.shell.getBoundingClientRect();
      const buf = 30;
      const near = (
        e.clientX >= r.left   - buf && e.clientX <= r.right  + buf &&
        e.clientY >= r.top    - buf && e.clientY <= r.bottom + buf
      );
      if (!near) return;
      // Cooldown — once per 8s max so we don't ping-pong
      const now = Date.now();
      if (now - lastInTheWayMoveAt < 8_000) return;
      lastInTheWayMoveAt = now;
      moveToEmptyCorner();
      if (Math.random() < 0.55) {
        bubble(pickFromPool('apologetic_move'), { autoHide: 1700 });
      }
    }, { capture: true });

    // Move out of way when input near him gets focused — UNLESS he's
    // feeling attention-seeky (12% chance), in which case he moves
    // ONTO the input to block it. Quirky.
    document.addEventListener('focusin', (e) => {
      if (!state.enabled || !state.shell) return;
      const t = e.target;
      if (!t || !t.matches) return;
      if (!t.matches('input, textarea, [contenteditable="true"]')) return;
      const inputRect = t.getBoundingClientRect();
      const shellRect = state.shell.getBoundingClientRect();
      const overlap = !(
        inputRect.right < shellRect.left || inputRect.left > shellRect.right ||
        inputRect.bottom < shellRect.top || inputRect.top > shellRect.bottom
      );
      const verticalConflict = Math.abs(
        (inputRect.top + inputRect.bottom) / 2 - (shellRect.top + shellRect.bottom) / 2
      ) < 120;
      if (overlap || verticalConflict) {
        if (Math.random() < 0.12 && !state.bubble) {
          blockInputAttention(t, inputRect);
        } else {
          moveToEmptyCorner();
        }
      }
    });

    // ─── TAB VISIBILITY (v15.6) ──────────────────────────────────────
    // When the user comes back to the tab after a long absence (>2min),
    // greet them. Silly small thing, but very personable.
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (!state.enabled) return;
      if (document.hidden) {
        hiddenAt = Date.now();
      } else {
        const away = Date.now() - hiddenAt;
        if (hiddenAt && away > 120_000 && !state.bubble && !state.suppressed) {
          mood('love', 3500);  // HEART EYES: he missed you!
          play('hop');
          setTimeout(() => {
            bubble(pickFromPool('welcome_back'), { autoHide: 3500 });
          }, 600);
        }
        hiddenAt = 0;
      }
    });

    // ─── WINDOW RESIZE (v15.6) ───────────────────────────────────────
    // Reposition into a clear corner when the viewport changes shape.
    // Debounced — many resize events fire during a drag. Soft comment
    // occasionally so the move doesn't feel like a glitch.
    let resizeTimer = null;
    let lastResizeCommentAt = 0;
    window.addEventListener('resize', () => {
      if (!state.enabled || !state.shell) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        moveToEmptyCorner();
        const now = Date.now();
        if (now - lastResizeCommentAt > 30_000 && Math.random() < 0.4 && !state.bubble) {
          lastResizeCommentAt = now;
          bubble(pickFromPool('resize'), { autoHide: 1800 });
        }
      }, 350);
    });

    // ─── SCROLL VELOCITY (v15.6) ─────────────────────────────────────
    // When the user scrolls really fast, comment playfully. Cooldown
    // to avoid being annoying. Threshold chosen to fire on flick-scroll
    // through a long list, not on normal page scrolling.
    let lastScrollY = window.scrollY;
    let lastScrollT = performance.now();
    let lastFastScrollAt = 0;
    window.addEventListener('scroll', () => {
      if (!state.enabled) return;
      const now = performance.now();
      const dy = Math.abs(window.scrollY - lastScrollY);
      const dt = now - lastScrollT;
      if (dt < 50) return;
      const v = dy / dt;  // px per ms
      lastScrollY = window.scrollY;
      lastScrollT = now;
      if (v > 6 && !state.bubble && !state.suppressed && Date.now() - lastFastScrollAt > 25_000) {
        lastFastScrollAt = Date.now();
        if (Math.random() < 0.5) {
          mood('surprised', 1200);
          bubble(pickFromPool('fast_scroll'), { autoHide: 2200 });
        }
      }
    }, { passive: true });

    // ─── VIEW CONTEXT AWARENESS (v17.5) ──────────────────────────────
    // NEXUS marks the active view via `.nav-tab.active[data-view]`. When
    // it changes, occasionally bubble a context-specific remark so he
    // feels aware of which screen you're on. Quirky and contextual.
    // v17.17: each view also TRIGGERS A PERSONALITY mood that persists
    // while you're in the view. Equipment = genius. Cleaning = disgusted.
    // Education = studious. Etc.
    let lastView = null;
    let lastViewBubbleAt = 0;
    // v17.17 mapping: view → { pool, mood, eyebrow } for personality-mode
    // v17.18: EVERY NEXUS view now has a personality
    const VIEW_PERSONALITY = {
      home:      { pool: 'home_friendly',      mood: 'happy',       eyebrow: '🏠 HOME'      },
      equipment: { pool: 'equipment_technical', mood: 'genius',     eyebrow: '⚙️ TECH'      },
      clean:     { pool: 'cleaning_gross',     mood: 'disgusted',   eyebrow: '🧽 ICK'       },
      education: { pool: 'education_studious', mood: 'studious',    eyebrow: '📚 STUDIOUS'  },
      board:     { pool: 'board_strategist',   mood: 'strategist',  eyebrow: '♟️ STRATEGY'  },
      inventory: { pool: 'inventory_organized',mood: 'organized',   eyebrow: '📋 ORDER'    },
      log:       { pool: 'log_reflective',     mood: 'thinking',    eyebrow: '✍️ REFLECT'   },
      cal:       { pool: 'cal_planner',        mood: 'determined',  eyebrow: '📅 PLAN'     },
      train:     { pool: 'train_coach',        mood: 'sparkle',     eyebrow: '🏆 COACH'    },
      brain:     { pool: 'brain_curious',      mood: 'confused',    eyebrow: '🧠 PEER'     },
    };
    setInterval(() => {
      if (!state.enabled || !state.shell || state.suppressed) return;
      // v17.30: coin flip moved to PRD-controlled bored mischief on 30s ticks.
      // Removed inline 0.15% gate here — coin flip now fires via runBoredMischief().
      // v17.18: VIEW MISCHIEF — equipment/clean/board/inventory pokes
      if (maybeViewMischief()) return;
      // v17.18: BORED DRIFT — when idle 30s+, slow wander to new spot
      maybeBoredDrift();
      // v17.19: GAME OFFER — when bored 60s+, occasionally invite to play
      if (maybeOfferGame()) return;
      // v17.20: SMUG LESSON — when he thinks you need teaching, mini-lecture
      if (maybePullLesson()) return;
      const active = document.querySelector('.nav-tab.active[data-view], .bnav-btn.active[data-view]');
      const view = active ? active.getAttribute('data-view') : null;
      // v17.17: maintain the view-personality mood (re-applied on every tick)
      if (view && VIEW_PERSONALITY[view] && !state.bubble) {
        const personality = VIEW_PERSONALITY[view];
        // Only apply if no stronger mood already set recently
        if (!state.moodTimer) {
          mood(personality.mood, 8000);
        }
      }
      if (view && view !== lastView) {
        lastView = view;
        // v17.7: deposit memory on FIRST visit to a NEXUS view
        const visited = state.preferences.visited_views || {};
        if (!visited[view]) {
          visited[view] = new Date().toISOString();
          state.preferences.visited_views = visited;
          savePreferences();
          const viewLabel = {
            home: 'Home', clean: 'Duties', log: 'Log', board: 'Board',
            cal: 'Calendar', equipment: 'Equipment', education: 'Education',
            train: 'Training', inventory: 'Inventory', brain: 'NEXUS brain',
          }[view] || view;
          depositMemory('first_view_visit', `You explored ${viewLabel} for the first time.`, { view }, 2);
        }
        // v17.26: track view visits for likes auto-discovery
        if (typeof trackViewVisitForLikes === 'function') trackViewVisitForLikes(view);
        // Only react if it's been 25+ seconds since last view bubble,
        // and a fresh switch (not initial detection). Also random gate.
        const now = Date.now();
        if (now - lastViewBubbleAt > 25_000 && Math.random() < 0.55 && !state.bubble) {
          lastViewBubbleAt = now;
          // v17.17: use the personality pool if defined, else generic context
          const personality = VIEW_PERSONALITY[view];
          const pool = personality ? personality.pool : ('context_' + view);
          if (state.dialog && state.dialog[pool] && state.dialog[pool].length) {
            setTimeout(() => {
              if (!state.bubble && state.enabled) {
                const opts = { autoHide: 5500 };
                if (personality) {
                  opts.eyebrow = personality.eyebrow;
                  mood(personality.mood, 6000);
                }
                bubble(pickFromPool(pool), opts);
              }
            }, 600);
          }
        }
      }
    }, 2000);
  }

  // v17.17: COIN FLIP MISCHIEF — Trajan walks to the masthead coin
  // and clicks it, flipping the active persona between Trajan and
  // Providentia. Silly, surprising, ~1% chance per minute when idle.
  function maybeFlipCoin() {
    const coin = document.querySelector('#mastCoin');
    if (!coin) return false;
    if (state.preferences.do_not_disturb) return false;
    state.coinFlipInProgress = true;
    const rect = coin.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Save current position to return later
    const shellRect = state.shell.getBoundingClientRect();
    const returnX = shellRect.left;
    const returnY = shellRect.top;
    const shellW = state.shell.offsetWidth || 120;
    const shellH = state.shell.offsetHeight || 120;
    // Move to just below the coin
    mood('smug', 6000);
    moveTo(cx - shellW / 2, cy + 36);
    // Halfway through the travel, trigger the click + bubble
    setTimeout(() => {
      try {
        // Trigger the existing click handler the same way a tap would
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        coin.dispatchEvent(evt);
        play('bounce');
        spawnParticles({ count: 10, type: 'sparkle' });
        playTone('sparkle');
        // Detect new persona for bubble substitution
        const newPersona = (localStorage.getItem('nexus_active_persona') || 'providentia');
        const line = pickFromPool('coin_flip_mischief').replace('{persona}', newPersona);
        bubble(line, { autoHide: 4500, eyebrow: '🪙 MISCHIEF' });
        depositMemory('coin_flip', `Flipped the coin to ${newPersona}.`, { persona: newPersona }, 2);
        adjustFeeling('happiness', +6);
      } catch (e) {
        console.warn('[clippy] coin flip failed', e);
      }
      // Return to previous position after a moment
      setTimeout(() => {
        moveTo(returnX, returnY);
        setTimeout(() => { state.coinFlipInProgress = false; }, 1500);
      }, 4200);
    }, 900);
    return true;
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.18 NEXUS MISCHIEF — visual-only interactions with NEXUS DOM.
  // None of these modify real data. They apply temporary CSS classes
  // that auto-clear after the animation ends, accompanied by Trajan
  // walking over, commenting, then bouncing away.
  // ════════════════════════════════════════════════════════════════════

  function bounceAway() {
    if (!state.shell) return;
    const W = window.innerWidth, H = window.innerHeight;
    const shellW = state.shell.offsetWidth || 120;
    const shellH = state.shell.offsetHeight || 120;
    const corners = [
      { x: 24, y: 100 },
      { x: W - shellW - 24, y: 100 },
      { x: 24, y: H - shellH - 80 },
      { x: W - shellW - 24, y: H - shellH - 80 },
    ];
    const target = corners[Math.floor(Math.random() * corners.length)];
    play('bounce');
    setTimeout(() => {
      moveTo(target.x, target.y);
      if (Math.random() < 0.7 && !state.bubble) {
        setTimeout(() => {
          if (!state.bubble && state.enabled) {
            bubble(pickFromPool('mischief_escape'), { autoHide: 3000 });
          }
        }, 300);
      }
    }, 600);
  }

  function mischiefTarget(el, opts) {
    if (!el || !state.shell || state.coinFlipInProgress) return false;
    if (state.preferences.do_not_disturb || state.bubble) return false;
    if (state.isRunningAway) return false;
    state.coinFlipInProgress = true;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) {
      state.coinFlipInProgress = false;
      return false;
    }
    const shellW = state.shell.offsetWidth || 120;
    const shellH = state.shell.offsetHeight || 120;
    const cx = r.left + r.width / 2 - shellW / 2;
    const cy = Math.max(40, r.top - shellH * 0.85);
    mood(opts.mood || 'smug', 6000);
    moveTo(cx, cy);
    setTimeout(() => {
      try {
        el.classList.add(opts.cssClass);
        setTimeout(() => { try { el.classList.remove(opts.cssClass); } catch(_) {} }, opts.duration || 1500);
        if (opts.tone) playTone(opts.tone);
        spawnParticles({ count: 4, type: opts.particle || 'sparkle' });
        if (opts.pool) {
          const line = pickFromPool(opts.pool);
          bubble(line, { autoHide: 3500, eyebrow: opts.eyebrow || '🎭 MISCHIEF' });
        }
        depositMemory('mischief', opts.memoryLabel || 'Did a silly thing.', { type: opts.type }, 1);
        adjustFeeling('happiness', +4);
      } catch (e) { console.warn('[clippy] mischief failed', e); }
      setTimeout(() => {
        bounceAway();
        setTimeout(() => { state.coinFlipInProgress = false; }, 1800);
      }, 2500);
    }, 900);
    return true;
  }

  function mischiefEquipmentPoke() {
    const pills = Array.from(document.querySelectorAll('.dos-status-pill'));
    const visible = pills.filter(p => {
      const r = p.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (!visible.length) return false;
    const target = visible[Math.floor(Math.random() * visible.length)];
    return mischiefTarget(target, {
      cssClass: 'is-trajan-poked',
      duration: 1500,
      pool: 'mischief_equipment_poke',
      eyebrow: '⚙️ POKE',
      mood: 'genius',
      tone: 'boop',
      type: 'equipment_poke',
      memoryLabel: 'Poked an equipment status pill (visually).',
    });
  }

  function mischiefCleanCheck() {
    const items = Array.from(document.querySelectorAll('.clean-task-check'));
    const visible = items.filter(i => {
      const r = i.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (!visible.length) return false;
    const target = visible[Math.floor(Math.random() * visible.length)];
    return mischiefTarget(target, {
      cssClass: 'is-trajan-ghost-check',
      duration: 2200,
      pool: 'mischief_clean_check',
      eyebrow: '✓ GHOST',
      mood: 'proud',
      tone: 'sparkle',
      type: 'clean_ghost_check',
      memoryLabel: 'Ghost-checked a cleaning task.',
    });
  }

  function mischiefBoardPretend() {
    const cards = Array.from(document.querySelectorAll(
      '.kanban-card, .board-card, [data-card-id], .nx-card'
    ));
    const visible = cards.filter(c => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (!visible.length) return false;
    const target = visible[Math.floor(Math.random() * visible.length)];
    return mischiefTarget(target, {
      cssClass: 'is-trajan-grabbing',
      duration: 2200,
      pool: 'mischief_board_pretend',
      eyebrow: '✋ HMPH',
      mood: 'strategist',
      tone: 'boop',
      type: 'board_pretend',
      memoryLabel: 'Pretended to drag a board card.',
    });
  }

  function mischiefInventoryCount() {
    const rows = Array.from(document.querySelectorAll(
      '.inventory-row, [data-inventory-id], .nx-inv-item, tr[data-row]'
    ));
    const visible = rows.filter(r => {
      const rect = r.getBoundingClientRect();
      return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    });
    if (!visible.length) return false;
    const target = visible[Math.floor(Math.random() * visible.length)];
    return mischiefTarget(target, {
      cssClass: 'is-trajan-counting',
      duration: 1800,
      pool: 'mischief_inventory_count',
      eyebrow: '🔢 COUNT',
      mood: 'organized',
      tone: 'boop',
      type: 'inventory_count',
      memoryLabel: 'Counted an inventory item.',
    });
  }

  function maybeViewMischief() {
    if (state.coinFlipInProgress) return false;
    if (state.bubble) return false;
    if (state.preferences.do_not_disturb) return false;
    const active = document.querySelector('.nav-tab.active[data-view], .bnav-btn.active[data-view]');
    const view = active ? active.getAttribute('data-view') : null;
    if (!view) return false;
    if (Math.random() > 0.005) return false;
    if      (view === 'equipment') return mischiefEquipmentPoke();
    else if (view === 'clean')     return mischiefCleanCheck();
    else if (view === 'board')     return mischiefBoardPretend();
    else if (view === 'inventory') return mischiefInventoryCount();
    return false;
  }

  function maybeBoredDrift() {
    if (state.bubble || state.coinFlipInProgress) return false;
    const idleMs = Date.now() - (state.lastTapAt || 0);
    if (idleMs < 30000) {
      state.shell && state.shell.classList.remove('is-bored');
      return false;
    }
    state.shell && state.shell.classList.add('is-bored');
    if (Math.random() > 0.025) return false;
    if (!state.shell) return false;
    const rect = state.shell.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    const shellW = state.shell.offsetWidth || 120;
    const shellH = state.shell.offsetHeight || 120;
    const dx = (Math.random() - 0.5) * 240;
    const dy = (Math.random() - 0.5) * 160;
    const nx = Math.max(12, Math.min(W - shellW - 12, rect.left + dx));
    const ny = Math.max(60, Math.min(H - shellH - 12, rect.top + dy));
    moveTo(nx, ny);
    if (Math.random() < 0.4) {
      setTimeout(() => {
        if (!state.bubble && state.enabled) {
          bubble(pickFromPool('bored_drift'), { autoHide: 3000, eyebrow: '😶 IDLE' });
        }
      }, 600);
    }
    return true;
  }

  // ════════════════════════════════════════════════════════════════════
  // v17.30 PSEUDO-RANDOM DISTRIBUTION (Dota 2-style)
  //
  // Standard random: each roll is independent. Can produce streaks
  // (5 procs in a row) or droughts (50 rolls with nothing). Bad for
  // ambient pet feel — Trajan would either spam or vanish.
  //
  // PRD: P(N) = C × N. Chance starts at C, climbs by C each failed
  // roll, resets to 0 (effectively C) on success. Source: Valve's
  // implementation for crits/bashes/evasion (Liquipedia, Dotabuff).
  //
  // For bored mischief: C = 0.05, tick every 30s.
  //   Tick 1:  5% chance
  //   Tick 2: 10%
  //   Tick 5: 25%
  //   Tick 10: 50%
  //   Tick 20: GUARANTEED (5% × 20 = 100%)
  //
  // Average expected wait: ~4.5 ticks ≈ 2.25 minutes idle.
  // Hard guarantee: within 10 minutes idle, mischief WILL fire.
  // ════════════════════════════════════════════════════════════════════

  function prdRoll(key, C) {
    state.prdCounters = state.prdCounters || {};
    state.prdCounters[key] = (state.prdCounters[key] || 0) + 1;
    const N = state.prdCounters[key];
    const P = C * N;
    if (Math.random() < P) {
      state.prdCounters[key] = 0;
      return true;
    }
    return false;
  }
  function prdReset(key) {
    state.prdCounters = state.prdCounters || {};
    state.prdCounters[key] = 0;
  }
  function prdCurrentChance(key, C) {
    state.prdCounters = state.prdCounters || {};
    const N = (state.prdCounters[key] || 0) + 1;
    return Math.min(1, C * N);
  }
  function prdTicksUntilGuaranteed(key, C) {
    state.prdCounters = state.prdCounters || {};
    const N = (state.prdCounters[key] || 0);
    return Math.ceil(1 / C) - N;
  }

  const MISCHIEF_PRD_C = 0.05;          // 5% per tick (user's spec)
  const MISCHIEF_PRD_INTERVAL_MS = 30000; // 30 seconds
  const BORED_THRESHOLD_MS = 60000;     // 1 minute idle = bored

  function isBored() {
    if (!state.enabled || state.suppressed || state.sulkActive) return false;
    if (state.bubble || state.coinFlipInProgress) return false;
    const idle = Date.now() - (state.lastTapAt || state.bootedAt || 0);
    return idle > BORED_THRESHOLD_MS;
  }

  function runBoredMischief() {
    // Weighted menu — calmer behaviors heavier-weighted, chaos rarer
    const choices = [
      { weight: 28, fn: () => {
        if (state.dialog && state.dialog.ambient_observation)
          bubble(pickFromPool('ambient_observation'), { autoHide: 6500 });
      }, label: 'ambient_obs' },
      { weight: 16, fn: () => {
        if (state.dialog && state.dialog.whimsical_idle)
          bubble(pickFromPool('whimsical_idle'), { autoHide: 4500 });
      }, label: 'whimsy' },
      { weight: 14, fn: () => { if (typeof doQuirk === 'function') doQuirk(); }, label: 'quirk' },
      { weight: 12, fn: () => {
        if (state.dialog && state.dialog.bored_restless)
          bubble(pickFromPool('bored_restless'),
                 { autoHide: 4000, eyebrow: '😼 RESTLESS' });
      }, label: 'restless' },
      { weight: 10, fn: () => {
        if (typeof maybeAutonomousAction === 'function') maybeAutonomousAction();
      }, label: 'autonomous_action' },
      { weight: 10, fn: () => {
        if (typeof maybeFlipCoin === 'function') maybeFlipCoin();
      }, label: 'coin_flip' },
      { weight: 6, fn: () => {
        if (state.dialog && state.dialog.peaceful_idle)
          bubble(pickFromPool('peaceful_idle'), { autoHide: 5000 });
      }, label: 'peace' },
      { weight: 4, fn: () => {
        // Rare meta-moment: he explains his own PRD
        if (state.dialog && state.dialog.prd_explainer)
          bubble(pickFromPool('prd_explainer'),
                 { autoHide: 7000, eyebrow: '🎲 PRD' });
      }, label: 'meta_prd' },
    ];
    const total = choices.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * total;
    let picked = choices[0];
    for (const c of choices) {
      r -= c.weight;
      if (r <= 0) { picked = c; break; }
    }
    try { picked.fn(); } catch (e) {}
    if (typeof depositMemory === 'function') {
      depositMemory('bored_mischief',
        `PRD-triggered mischief: ${picked.label}`,
        { kind: picked.label }, 1);
    }
  }

  function startBoredMischiefPRD() {
    if (state.boredMischiefTimer) clearInterval(state.boredMischiefTimer);
    state.boredMischiefTimer = setInterval(() => {
      if (!isBored()) {
        prdReset('bored_mischief');
        return;
      }
      if (prdRoll('bored_mischief', MISCHIEF_PRD_C)) {
        runBoredMischief();
      }
    }, MISCHIEF_PRD_INTERVAL_MS);
  }

  // For the capability menu — let the user inspect Trajan's current PRD state
  function getMischiefStatus() {
    state.prdCounters = state.prdCounters || {};
    const N = state.prdCounters['bored_mischief'] || 0;
    const idle = Date.now() - (state.lastTapAt || state.bootedAt || 0);
    const idleSeconds = Math.floor(idle / 1000);
    const nextChance = isBored() ? prdCurrentChance('bored_mischief', MISCHIEF_PRD_C) : 0;
    const ticksLeft = prdTicksUntilGuaranteed('bored_mischief', MISCHIEF_PRD_C);
    return {
      bored: isBored(),
      idle_seconds: idleSeconds,
      prd_n: N,
      prd_c: MISCHIEF_PRD_C,
      next_chance_pct: Math.round(nextChance * 1000) / 10,
      guaranteed_in_ticks: ticksLeft,
      guaranteed_in_seconds: ticksLeft * 30,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // v17.19 GAMES — 4 mini-games + high score system + invitation flow.
  // Per-user score storage via userKey(). When user accepts an invite,
  // happiness + affection get a real boost. Beating a high score
  // deposits a memory + celebrates with confetti.
  // ════════════════════════════════════════════════════════════════════

  const GAMES = {
    tap:      { label: '⚡ Tap the Orb',  pool: 'game_intro_tap',      higherIsBetter: true,  unit: 'taps' },
    catch:    { label: '🏃 Catch Me',     pool: 'game_intro_catch',    higherIsBetter: true,  unit: '/10'  },
    reaction: { label: '⚡ Reaction',     pool: 'game_intro_reaction', higherIsBetter: false, unit: 'ms'   },
    memory:   { label: '🧠 Memory Match', pool: 'game_intro_memory',   higherIsBetter: true,  unit: 'level'},
    // v17.22 RETRO ARCADE
    flappy:   { label: '🕊️ Flappy Trajan',  pool: 'game_intro_flappy', higherIsBetter: true, unit: 'columns' },
    cannon:   { label: '🚀 Cannon Battle',   pool: 'game_intro_cannon', higherIsBetter: true, unit: 'pts' },
    snake:    { label: '🐍 Snake',           pool: 'game_intro_snake',  higherIsBetter: true, unit: 'length' },
  };

  function getHighScores() {
    try {
      const raw = localStorage.getItem(userKey('clippy_highscores'));
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  function saveHighScore(gameId, score) {
    const scores = getHighScores();
    const game = GAMES[gameId];
    if (!game) return false;
    const current = scores[gameId];
    const better = current == null ||
      (game.higherIsBetter ? score > current : score < current);
    if (better) {
      scores[gameId] = score;
      try { localStorage.setItem(userKey('clippy_highscores'), JSON.stringify(scores)); } catch (e) {}
      return true;   // new record
    }
    return false;
  }

  // ─── Game overlay shell ────────────────────────────────────────
  function createGameOverlay() {
    closeGameOverlay();
    const ov = document.createElement('div');
    ov.className = 'clippy-game-overlay';
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-visible'));
    state.gameOverlay = ov;
    state.suppressed = true;
    if (state.shell) state.shell.classList.add('is-suppressed');
    return ov;
  }
  function closeGameOverlay() {
    if (state.gameOverlay) {
      state.gameOverlay.classList.remove('is-visible');
      const o = state.gameOverlay;
      setTimeout(() => { try { o.remove(); } catch (e) {} }, 280);
      state.gameOverlay = null;
    }
    state.suppressed = false;
    if (state.shell) state.shell.classList.remove('is-suppressed');
    if (state.gameCleanupFns) {
      state.gameCleanupFns.forEach(fn => { try { fn(); } catch (e) {} });
      state.gameCleanupFns = [];
    }
  }

  // ─── Offer flow: he asks, user accepts/declines ────────────────
  function offerGame() {
    if (state.bubble || state.coinFlipInProgress || state.suppressed) return;
    mood('happy', 6000);
    actionBubble(substituteVars(pickFromPool('game_invitation')), {
      eyebrow: '🎮 GAME?',
      autoHide: 0,
      actions: [
        { label: 'Yes!', cls: 'is-primary', onClick: () => { closeActionBubble(); showGameMenu(); } },
        { label: 'Maybe later', onClick: () => {
            closeActionBubble();
            bubble(pickFromPool('game_decline'), { autoHide: 3500 });
            mood('disappointed', 3500);
          }
        },
      ]
    });
    // Accepting any game grants instant relationship boost
    adjustFeeling('happiness', +4);
  }

  function showGameMenu() {
    const scores = getHighScores();
    const fmt = (id, score) => {
      if (score == null) return '—';
      return GAMES[id].higherIsBetter ? score + ' ' + GAMES[id].unit : score + GAMES[id].unit;
    };
    actionBubble('Pick a game!', {
      eyebrow: '🎮 GAMES',
      autoHide: 0,
      actions: [
        { label: `⚡ Tap (best: ${fmt('tap', scores.tap)})`,
          onClick: () => { closeActionBubble(); startTapGame(); } },
        { label: `🏃 Catch (best: ${fmt('catch', scores.catch)})`,
          onClick: () => { closeActionBubble(); startCatchGame(); } },
        { label: `⚡ Reaction (best: ${fmt('reaction', scores.reaction)})`,
          onClick: () => { closeActionBubble(); startReactionGame(); } },
        { label: `🧠 Memory (best: ${fmt('memory', scores.memory)})`,
          onClick: () => { closeActionBubble(); startMemoryGame(); } },
        { label: `🕊️ Flappy Trajan (best: ${fmt('flappy', scores.flappy)})`,
          onClick: () => { closeActionBubble(); startFlappyGame(); } },
        { label: `🚀 Cannon Battle (best: ${fmt('cannon', scores.cannon)})`,
          onClick: () => { closeActionBubble(); startCannonGame(); } },
        { label: `🐍 Snake (best: ${fmt('snake', scores.snake)})`,
          onClick: () => { closeActionBubble(); startSnakeGame(); } },
        { label: 'Never mind', onClick: closeActionBubble },
      ]
    });
  }

  // ─── End-of-game shared screen ─────────────────────────────────
  function showGameResult(gameId, score) {
    const game = GAMES[gameId];
    const newRecord = saveHighScore(gameId, score);
    const allScores = getHighScores();
    const ov = state.gameOverlay || createGameOverlay();
    ov.innerHTML = `
      <div class="clippy-game-title">${esc(game.label)} — RESULTS</div>
      <div class="clippy-game-stat-label">Your Score</div>
      <div class="clippy-game-stat">${esc(String(score))} <span style="font-size:18px;opacity:0.5;">${esc(game.unit)}</span></div>
      <div class="clippy-game-highscore ${newRecord ? 'clippy-game-highscore-new' : ''}">
        ${newRecord ? '🏆 NEW HIGH SCORE!' : `Best: ${esc(String(allScores[gameId] != null ? allScores[gameId] : score))} ${esc(game.unit)}`}
      </div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="again">Play Again</button>
        <button class="clippy-game-btn is-ghost" data-act="menu">Menu</button>
        <button class="clippy-game-btn is-ghost" data-act="done">Done</button>
      </div>
    `;
    ov.querySelector('[data-act="again"]').addEventListener('click', () => {
      closeGameOverlay();
      if      (gameId === 'tap')      startTapGame();
      else if (gameId === 'catch')    startCatchGame();
      else if (gameId === 'reaction') startReactionGame();
      else if (gameId === 'memory')   startMemoryGame();
    });
    ov.querySelector('[data-act="menu"]').addEventListener('click', () => {
      closeGameOverlay();
      showGameMenu();
    });
    ov.querySelector('[data-act="done"]').addEventListener('click', closeGameOverlay);

    // Celebration + bubble after a beat
    setTimeout(() => {
      grantBondXP_game_played();
      if (newRecord) {
        grantBondXP_game_high_score();
        mood('super_excited', 6000);
        spawnParticles({ count: 24, type: 'confetti' });
        playTone('milestone');
        adjustFeeling('happiness', +12);
        adjustFeeling('affection', +6);
        depositMemory('high_score', `New high score in ${game.label}: ${score} ${game.unit}`,
                      { game: gameId, score }, 3);
      } else {
        // Decent or bad — encouraging bubble outside the overlay
        mood(score > 0 ? 'happy' : 'thinking', 4500);
        adjustFeeling('happiness', +4);
      }
    }, 200);
  }

  // v17.21 — create a mini Trajan to use as the game tap target.
  // The mini orb has the full SVG (body, eyes, mouth, nodes, halo) so it
  // looks and feels like the real Trajan, just smaller. Pop animation on tap.
  function createMiniOrb(opts) {
    opts = opts || {};
    const mini = document.createElement('div');
    mini.className = 'clippy-mini-shell';
    if (state.svgMarkup) {
      mini.innerHTML = state.svgMarkup;
    } else {
      mini.innerHTML = '<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="60" fill="#4cb6ff"/></svg>';
    }
    if (opts.style) Object.assign(mini.style, opts.style);
    return mini;
  }

  // v17.24 — universal 3-2-1-GO countdown shown over a game container.
  // Calls onComplete() when GO! finishes. ~3.6 seconds total.
  function runCountdown(container, onComplete) {
    if (!container) { onComplete && onComplete(); return; }
    const sequence = [
      { text: '3', cls: '' },
      { text: '2', cls: '' },
      { text: '1', cls: '' },
      { text: 'GO!', cls: 'is-go' },
    ];
    let i = 0;
    function show() {
      if (i >= sequence.length) {
        onComplete && onComplete();
        return;
      }
      const step = sequence[i++];
      // Remove old countdown if present
      const existing = container.querySelector('.clippy-game-countdown');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.className = 'clippy-game-countdown ' + step.cls;
      el.textContent = step.text;
      container.appendChild(el);
      playTone(step.cls === 'is-go' ? 'sparkle' : 'boop');
      setTimeout(() => {
        try { el.remove(); } catch (_) {}
        show();
      }, step.cls === 'is-go' ? 600 : 1000);
    }
    show();
  }

  // ─── GAME 1: TAP THE ORB (30s speed clicker — v17.22 extended) ─
  function startTapGame() {
    const ov = createGameOverlay();
    let count = 0;
    let timeLeft = 30;     // v17.22: doubled from 15s
    let running = false;
    const intro = pickFromPool('game_intro_tap');
    ov.innerHTML = `
      <div class="clippy-game-title">⚡ Tap the Orb</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      running = true;
      ov.innerHTML = `
        <div class="clippy-game-title">⚡ TAP THE ORB</div>
        <div class="clippy-game-timer">${timeLeft}s</div>
        <div class="clippy-game-stat-label">Taps</div>
        <div class="clippy-game-stat">${count}</div>
        <div class="clippy-game-board"></div>
      `;
      // v17.21: use mini-Trajan as the target instead of a placeholder div
      const board = ov.querySelector('.clippy-game-board');
      const target = createMiniOrb({ style: { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } });
      board.appendChild(target);
      const statEl = ov.querySelector('.clippy-game-stat');
      const timerEl = ov.querySelector('.clippy-game-timer');
      target.addEventListener('click', () => {
        if (!running) return;
        count++;
        statEl.textContent = count;
        target.classList.remove('is-tapped');
        // Force reflow so animation can re-trigger
        void target.offsetWidth;
        target.classList.add('is-tapped');
        playTone('boop');
      });
      const tick = setInterval(() => {
        timeLeft--;
        timerEl.textContent = timeLeft + 's';
        if (timeLeft <= 0) {
          clearInterval(tick);
          running = false;
          showGameResult('tap', count);
        }
      }, 1000);
      state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => clearInterval(tick)]);
    });
  }

  // ─── GAME 2: CATCH ME (Trajan teleports, you catch him) ────────
  function startCatchGame() {
    const ov = createGameOverlay();
    let catches = 0;
    let round = 0;
    const totalRounds = 10;
    let running = false;
    let moveTimer = null;
    const intro = pickFromPool('game_intro_catch');
    ov.innerHTML = `
      <div class="clippy-game-title">🏃 Catch Me</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      running = true;
      ov.innerHTML = `
        <div class="clippy-game-title">🏃 CATCH ME</div>
        <div class="clippy-game-stat-label">Round</div>
        <div class="clippy-game-stat">${round}/${totalRounds}</div>
        <div class="clippy-game-stat-label">Catches: <span data-catches>${catches}</span></div>
        <div class="clippy-game-board"></div>
      `;
      const board = ov.querySelector('.clippy-game-board');
      // v17.21: mini-Trajan teleports around the board
      const target = createMiniOrb();
      board.appendChild(target);
      const roundEl = ov.querySelector('.clippy-game-stat');
      const catchEl = ov.querySelector('[data-catches]');
      function reposition() {
        const rect = board.getBoundingClientRect();
        const x = Math.random() * Math.max(0, rect.width - 100);
        const y = Math.random() * Math.max(0, rect.height - 100);
        target.style.left = x + 'px';
        target.style.top = y + 'px';
      }
      function nextRound() {
        round++;
        if (round > totalRounds) {
          if (moveTimer) clearTimeout(moveTimer);
          running = false;
          showGameResult('catch', catches);
          return;
        }
        roundEl.textContent = round + '/' + totalRounds;
        reposition();
        if (moveTimer) clearTimeout(moveTimer);
        moveTimer = setTimeout(nextRound, 1200);
      }
      target.addEventListener('click', () => {
        if (!running) return;
        catches++;
        catchEl.textContent = catches;
        target.classList.add('is-tapped');
        setTimeout(() => target.classList.remove('is-tapped'), 280);
        playTone('boop');
        nextRound();
      });
      nextRound();
      state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => moveTimer && clearTimeout(moveTimer)]);
    });
  }

  // ─── GAME 3: REACTION TIME (mini-Trajan flashes red→green) ──────
  function startReactionGame() {
    const ov = createGameOverlay();
    let round = 0;
    const totalRounds = 3;
    const times = [];
    const intro = pickFromPool('game_intro_reaction');
    ov.innerHTML = `
      <div class="clippy-game-title">⚡ Reaction Time</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', runRound);
    function runRound() {
      round++;
      ov.innerHTML = `
        <div class="clippy-game-title">⚡ REACTION ${round}/${totalRounds}</div>
        <div class="clippy-game-instruction" data-msg>Wait for GREEN glow...</div>
        <div class="clippy-game-board"></div>
      `;
      const board = ov.querySelector('.clippy-game-board');
      // v17.21: mini-Trajan in center, glows red → flips to green
      const target = createMiniOrb({ style: { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } });
      target.classList.add('is-wait');
      board.appendChild(target);
      const msg = ov.querySelector('[data-msg]');
      const delay = 1200 + Math.random() * 2800;
      let goAt = 0;
      let earlyClick = false;
      const earlyHandler = () => {
        if (goAt === 0) {
          earlyClick = true;
          msg.textContent = 'Too early! Try again.';
          setTimeout(() => { round--; runRound(); }, 1200);
        }
      };
      target.addEventListener('click', earlyHandler);
      const flashTimer = setTimeout(() => {
        if (earlyClick) return;
        goAt = performance.now();
        target.classList.remove('is-wait');
        target.classList.add('is-go');
        msg.textContent = 'TAP NOW!';
        playTone('sparkle');
        const goHandler = () => {
          if (!goAt) return;
          const reactMs = Math.round(performance.now() - goAt);
          times.push(reactMs);
          target.removeEventListener('click', goHandler);
          msg.textContent = reactMs + ' ms';
          if (round >= totalRounds) {
            setTimeout(() => {
              const avg = Math.round(times.reduce((a,b) => a+b, 0) / times.length);
              showGameResult('reaction', avg);
            }, 900);
          } else {
            setTimeout(runRound, 1200);
          }
        };
        target.addEventListener('click', goHandler);
      }, delay);
      state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => clearTimeout(flashTimer)]);
    }
  }

  // ─── GAME 4: MEMORY MATCH (v17.24 — brighter, scales every 10 lvls) ───
  function startMemoryGame() {
    const ov = createGameOverlay();
    // All 9 possible colors. Game starts with 4, adds 1 every 10 levels.
    const ALL_COLORS = ['r', 'g', 'b', 'y', 'p', 'o', 'c', 'k', 'w'];
    const sequence = [];
    let userIdx = 0;
    let level = 0;
    let acceptingInput = false;
    let activeColors = ALL_COLORS.slice(0, 4);   // start with 4
    const intro = pickFromPool('game_intro_memory');
    ov.innerHTML = `
      <div class="clippy-game-title">🧠 Memory Match</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      // Build a temporary board for the countdown
      ov.innerHTML = `
        <div class="clippy-game-title">🧠 MEMORY MATCH</div>
        <div class="clippy-flappy-board" style="height:300px;" data-countdown-board></div>
      `;
      const cdBoard = ov.querySelector('[data-countdown-board]');
      runCountdown(cdBoard, () => {
        level = 0;
        runNextLevel();
      });
    });

    function colorsForLevel(lvl) {
      // Start with 4 colors at level 1
      // Level 11 → 5 colors. Level 21 → 6. Level 31 → 7. Etc.
      const extra = Math.floor((lvl - 1) / 10);
      const count = Math.min(ALL_COLORS.length, 4 + extra);
      return ALL_COLORS.slice(0, count);
    }

    function runNextLevel() {
      level++;
      activeColors = colorsForLevel(level);
      sequence.push(activeColors[Math.floor(Math.random() * activeColors.length)]);
      userIdx = 0;
      acceptingInput = false;

      // Re-render with new orb count if needed
      ov.innerHTML = `
        <div class="clippy-game-title">🧠 MEMORY MATCH</div>
        <div class="clippy-memory-level-banner">Level ${level} · ${activeColors.length} orbs · Watch...</div>
        <div class="clippy-memory-grid" data-grid></div>
        <div class="clippy-game-buttons">
          <button class="clippy-game-btn is-ghost" data-act="quit">Quit</button>
        </div>
      `;
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => {
        showGameResult('memory', Math.max(0, level - 1));
      });
      const grid = ov.querySelector('[data-grid]');
      const banner = ov.querySelector('.clippy-memory-level-banner');

      // Build mini-Trajans for each active color
      const cells = activeColors.map(color => {
        const cell = createMiniOrb();
        cell.classList.remove('clippy-mini-shell');
        cell.classList.add('clippy-memory-cell');
        cell.classList.add('is-disabled');
        cell.setAttribute('data-color', color);
        grid.appendChild(cell);
        return cell;
      });

      // Play the sequence
      let i = 0;
      const flashEach = 520;       // ms per flash
      const gapBetween = 180;
      const playInterval = setInterval(() => {
        if (i >= sequence.length) {
          clearInterval(playInterval);
          acceptingInput = true;
          cells.forEach(c => c.classList.remove('is-disabled'));
          banner.textContent = `Level ${level} · Your turn — repeat the sequence`;
          cells.forEach(cell => {
            cell.addEventListener('click', () => {
              if (!acceptingInput) return;
              handleTap(cell.getAttribute('data-color'), cell);
            });
          });
          return;
        }
        const c = sequence[i];
        const cell = cells.find(el => el.getAttribute('data-color') === c);
        if (cell) {
          cell.classList.add('flash-' + c);
          playTone('boop');
          setTimeout(() => cell.classList.remove('flash-' + c), flashEach - gapBetween);
        }
        i++;
      }, flashEach);
      state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => clearInterval(playInterval)]);

      function handleTap(color, cell) {
        const expected = sequence[userIdx];
        if (color !== expected) {
          banner.textContent = `Wrong! Got to level ${level - 1}.`;
          acceptingInput = false;
          setTimeout(() => showGameResult('memory', Math.max(0, level - 1)), 1500);
          return;
        }
        cell.classList.add('flash-' + color);
        playTone('sparkle');
        setTimeout(() => cell.classList.remove('flash-' + color), 280);
        userIdx++;
        if (userIdx >= sequence.length) {
          acceptingInput = false;
          banner.textContent = `Level ${level} cleared!`;
          // v17.24 — fanfare on every 10th level (added orb!)
          if (level % 10 === 0 && level > 0) {
            spawnParticles({ count: 16, type: 'sparkle' });
            playTone('milestone');
            setTimeout(() => {
              banner.textContent = `LEVEL ${level}! Adding orb #${activeColors.length + 1}...`;
            }, 600);
          }
          setTimeout(runNextLevel, level % 10 === 0 ? 2200 : 1100);
        }
      }
    }
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.22 GAME 5: FLAPPY TRAJAN — tap to flap, dodge Roman columns
  // ════════════════════════════════════════════════════════════════════

  function startFlappyGame() {
    const ov = createGameOverlay();
    const intro = pickFromPool('game_intro_flappy');
    ov.innerHTML = `
      <div class="clippy-game-title">🕊️ Flappy Trajan</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">🕊️ FLAPPY TRAJAN</div>
        <div class="clippy-flappy-board" data-board>
          <div class="clippy-flappy-score" data-score>0</div>
          <div class="clippy-flappy-ground"></div>
        </div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;">Tap the board to flap!</div>
        <div class="clippy-game-buttons">
          <button class="clippy-game-btn is-ghost" data-act="quit">Quit</button>
        </div>
      `;
      const board = ov.querySelector('[data-board]');
      const scoreEl = ov.querySelector('[data-score]');
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => {
        running = false;
        cancelAnimationFrame(rafId);
        closeGameOverlay();
      });

      // Build Trajan bird
      const bird = document.createElement('div');
      bird.className = 'clippy-flappy-bird';
      bird.innerHTML = state.svgMarkup || '';
      board.appendChild(bird);

      const boardRect = board.getBoundingClientRect();
      const W = boardRect.width;
      const H = boardRect.height;
      const GROUND_Y = H - 28;
      const BIRD_SIZE = 60;
      const COLUMN_W = 56;
      const GAP_SIZE = 150;
      let birdY = H / 2;
      let birdV = 0;
      const GRAVITY = 0.45;
      const FLAP_V = -7.2;
      const SCROLL_SPEED = 2.2;
      let score = 0;
      let running = false;     // v17.24: don't run until countdown completes
      let rafId = 0;
      const columns = [];
      let nextColumnX = W + 80;
      let columnSpacing = 220;

      const birdX = 80;
      bird.style.left = birdX + 'px';
      bird.style.top = birdY + 'px';

      // v17.24: countdown 3-2-1 before play starts
      runCountdown(board, () => {
        running = true;
        spawnColumn();
        rafId = requestAnimationFrame(tick);
      });

      function spawnColumn() {
        const gapY = 60 + Math.random() * (GROUND_Y - GAP_SIZE - 120);
        const topH = gapY;
        const botY = gapY + GAP_SIZE;
        const botH = GROUND_Y - botY;
        const top = document.createElement('div');
        top.className = 'clippy-flappy-column is-top';
        top.style.left = nextColumnX + 'px';
        top.style.top = '0px';
        top.style.height = topH + 'px';
        const topCap = document.createElement('div');
        topCap.className = 'clippy-flappy-column-cap';
        top.appendChild(topCap);
        const bot = document.createElement('div');
        bot.className = 'clippy-flappy-column is-bot';
        bot.style.left = nextColumnX + 'px';
        bot.style.top = botY + 'px';
        bot.style.height = botH + 'px';
        const botCap = document.createElement('div');
        botCap.className = 'clippy-flappy-column-cap';
        bot.appendChild(botCap);
        board.appendChild(top);
        board.appendChild(bot);
        columns.push({ top, bot, x: nextColumnX, gapY, scored: false });
        nextColumnX += columnSpacing;
      }

      function flap() {
        if (!running) return;
        birdV = FLAP_V;
        playTone('boop');
      }
      board.addEventListener('click', flap);
      board.addEventListener('touchstart', (e) => { e.preventDefault(); flap(); }, { passive: false });

      function tick() {
        if (!running) return;
        birdV += GRAVITY;
        birdY += birdV;
        const angle = Math.max(-25, Math.min(70, birdV * 4));
        bird.style.top = birdY + 'px';
        bird.style.transform = `rotate(${angle}deg)`;

        // Move columns
        for (let i = columns.length - 1; i >= 0; i--) {
          const c = columns[i];
          c.x -= SCROLL_SPEED;
          c.top.style.left = c.x + 'px';
          c.bot.style.left = c.x + 'px';
          if (!c.scored && c.x + COLUMN_W < birdX) {
            c.scored = true;
            score++;
            scoreEl.textContent = score;
            playTone('sparkle');
          }
          if (c.x < -COLUMN_W) {
            c.top.remove();
            c.bot.remove();
            columns.splice(i, 1);
          }
        }

        if (columns.length === 0 || columns[columns.length - 1].x < W - columnSpacing) {
          spawnColumn();
        }

        // Collision
        const birdRect = { x: birdX, y: birdY, w: BIRD_SIZE, h: BIRD_SIZE };
        if (birdY < 0 || birdY + BIRD_SIZE > GROUND_Y) {
          gameOver();
          return;
        }
        for (const c of columns) {
          if (birdRect.x + birdRect.w > c.x && birdRect.x < c.x + COLUMN_W) {
            if (birdY < c.gapY || birdY + BIRD_SIZE > c.gapY + GAP_SIZE) {
              gameOver();
              return;
            }
          }
        }
        rafId = requestAnimationFrame(tick);
      }
      function gameOver() {
        running = false;
        cancelAnimationFrame(rafId);
        bubble(pickFromPool('flappy_die'), { autoHide: 2500 });
        setTimeout(() => showGameResult('flappy', score), 800);
      }
      // v17.24: countdown starts the RAF, not here
      state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => {
        running = false;
        cancelAnimationFrame(rafId);
      }]);
    });
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.22 GAME 6: CANNON BATTLE — drag to move, tap to fire upward
  // ════════════════════════════════════════════════════════════════════

  function startCannonGame() {
    const ov = createGameOverlay();
    const intro = pickFromPool('game_intro_cannon');
    ov.innerHTML = `
      <div class="clippy-game-title">🚀 Cannon Battle</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">🚀 CANNON BATTLE</div>
        <div class="clippy-cannon-board" data-board>
          <div class="clippy-cannon-hud">
            <div class="hud-stat">SCORE <span data-score>0</span></div>
            <div class="hud-stat">HP <span data-hp>3</span></div>
            <div class="hud-stat">TIME <span data-time>60</span>s</div>
          </div>
        </div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;">Drag to move · Tap to fire</div>
        <div class="clippy-game-buttons">
          <button class="clippy-game-btn is-ghost" data-act="quit">Quit</button>
        </div>
      `;
      const board = ov.querySelector('[data-board]');
      const scoreEl = ov.querySelector('[data-score]');
      const hpEl = ov.querySelector('[data-hp]');
      const timeEl = ov.querySelector('[data-time]');
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => {
        running = false;
        cancelAnimationFrame(rafId);
        clearInterval(timerInt);
        closeGameOverlay();
      });

      const player = document.createElement('div');
      player.className = 'clippy-cannon-player';
      player.innerHTML = state.svgMarkup || '';
      board.appendChild(player);

      const boardRect = board.getBoundingClientRect();
      const W = boardRect.width;
      const H = boardRect.height;
      const PLAYER_W = 60;
      let playerX = W / 2 - PLAYER_W / 2;
      let score = 0;
      let hp = 3;
      let timeLeft = 60;
      let running = false;     // v17.24: countdown gates start
      const bullets = [];
      const enemies = [];
      const enemyBullets = [];
      let lastEnemySpawn = 0;
      let lastEnemyShot = 0;
      let lastFire = 0;

      player.style.left = playerX + 'px';

      function fire() {
        if (!running) return;
        const now = Date.now();
        if (now - lastFire < 220) return;   // fire rate limit
        lastFire = now;
        const b = document.createElement('div');
        b.className = 'clippy-cannon-bullet';
        const bx = playerX + PLAYER_W / 2 - 3;
        const by = H - 80;
        b.style.left = bx + 'px';
        b.style.top = by + 'px';
        board.appendChild(b);
        bullets.push({ el: b, x: bx, y: by });
        playTone('boop');
      }
      function spawnEnemy() {
        const e = document.createElement('div');
        e.className = 'clippy-cannon-enemy';
        const ex = Math.random() * (W - 36);
        e.style.left = ex + 'px';
        e.style.top = '20px';
        board.appendChild(e);
        enemies.push({ el: e, x: ex, y: 20, vx: (Math.random() - 0.5) * 1.4, vy: 0.4 + Math.random() * 0.6 });
      }
      function enemyShoot(enemy) {
        const b = document.createElement('div');
        b.className = 'clippy-cannon-enemy-bullet';
        b.style.left = (enemy.x + 16) + 'px';
        b.style.top = (enemy.y + 36) + 'px';
        board.appendChild(b);
        enemyBullets.push({ el: b, x: enemy.x + 16, y: enemy.y + 36 });
      }
      function explode(x, y) {
        const e = document.createElement('div');
        e.className = 'clippy-cannon-explosion';
        e.style.left = (x - 30) + 'px';
        e.style.top = (y - 30) + 'px';
        board.appendChild(e);
        setTimeout(() => e.remove(), 400);
      }

      // Touch / drag handlers — set player X to finger pos
      let dragActive = false;
      function setPlayerFromPoint(clientX) {
        const rect = board.getBoundingClientRect();
        const px = Math.max(0, Math.min(W - PLAYER_W, clientX - rect.left - PLAYER_W / 2));
        playerX = px;
        player.style.left = playerX + 'px';
      }
      board.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length) {
          dragActive = true;
          setPlayerFromPoint(e.touches[0].clientX);
          fire();   // tap = also fire
        }
      }, { passive: false });
      board.addEventListener('touchmove', (e) => {
        if (dragActive && e.touches.length) setPlayerFromPoint(e.touches[0].clientX);
      }, { passive: false });
      board.addEventListener('touchend', () => { dragActive = false; });
      // Mouse desktop fallback
      board.addEventListener('mousedown', (e) => { dragActive = true; setPlayerFromPoint(e.clientX); fire(); });
      board.addEventListener('mousemove', (e) => { if (dragActive) setPlayerFromPoint(e.clientX); });
      board.addEventListener('mouseup', () => { dragActive = false; });
      board.addEventListener('mouseleave', () => { dragActive = false; });

      let timerInt = null;       // v17.24: started by countdown
      let rafId = 0;

      function tick() {
        if (!running) return;
        const now = Date.now();
        // Move bullets up
        for (let i = bullets.length - 1; i >= 0; i--) {
          const b = bullets[i];
          b.y -= 9;
          b.el.style.top = b.y + 'px';
          if (b.y < -20) { b.el.remove(); bullets.splice(i, 1); continue; }
          // Check enemy hits
          for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (b.x + 6 > e.x && b.x < e.x + 36 && b.y + 16 > e.y && b.y < e.y + 36) {
              explode(e.x + 18, e.y + 18);
              e.el.remove(); enemies.splice(j, 1);
              b.el.remove(); bullets.splice(i, 1);
              score += 10;
              scoreEl.textContent = score;
              playTone('sparkle');
              break;
            }
          }
        }
        // Spawn enemies
        if (now - lastEnemySpawn > 1500 - Math.min(800, score * 8)) {
          spawnEnemy();
          lastEnemySpawn = now;
        }
        // Move enemies down
        for (let i = enemies.length - 1; i >= 0; i--) {
          const e = enemies[i];
          e.x += e.vx;
          e.y += e.vy;
          if (e.x < 0 || e.x > W - 36) e.vx *= -1;
          e.el.style.left = e.x + 'px';
          e.el.style.top = e.y + 'px';
          // Reached bottom = damage
          if (e.y > H - 80) {
            e.el.remove();
            enemies.splice(i, 1);
            hp--;
            hpEl.textContent = hp;
            if (hp <= 0) { gameOver(false); return; }
          }
        }
        // Enemy shoots randomly
        if (enemies.length && now - lastEnemyShot > 1200) {
          const shooter = enemies[Math.floor(Math.random() * enemies.length)];
          enemyShoot(shooter);
          lastEnemyShot = now;
        }
        // Move enemy bullets
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
          const b = enemyBullets[i];
          b.y += 6;
          b.el.style.top = b.y + 'px';
          if (b.y > H) { b.el.remove(); enemyBullets.splice(i, 1); continue; }
          // Player hit?
          if (b.x + 5 > playerX && b.x < playerX + PLAYER_W &&
              b.y + 14 > H - 80 && b.y < H - 20) {
            b.el.remove(); enemyBullets.splice(i, 1);
            hp--;
            hpEl.textContent = hp;
            explode(playerX + 30, H - 50);
            if (hp <= 0) { gameOver(false); return; }
          }
        }
        rafId = requestAnimationFrame(tick);
      }
      function gameOver(survived) {
        running = false;
        cancelAnimationFrame(rafId);
        clearInterval(timerInt);
        if (!survived) {
          bubble(pickFromPool('cannon_die'), { autoHide: 2500 });
        }
        setTimeout(() => showGameResult('cannon', score), 800);
      }
      // v17.24: countdown 3-2-1 before play
      runCountdown(board, () => {
        running = true;
        timerInt = setInterval(() => {
          if (!running) return;
          timeLeft--;
          timeEl.textContent = timeLeft;
          if (timeLeft <= 0) gameOver(true);
        }, 1000);
        rafId = requestAnimationFrame(tick);
      });
      state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => {
        running = false;
        cancelAnimationFrame(rafId);
        if (timerInt) clearInterval(timerInt);
      }]);
    });
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.22 GAME 7: SNAKE — tap left/right of head to turn
  // ════════════════════════════════════════════════════════════════════

  function startSnakeGame() {
    const ov = createGameOverlay();
    const intro = pickFromPool('game_intro_snake');
    ov.innerHTML = `
      <div class="clippy-game-title">🐍 Snake</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">🐍 SNAKE — Length: <span data-score>3</span></div>
        <div class="clippy-snake-board" data-board></div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;">Tap any side to turn ⇦⇧⇨⇩</div>
        <div class="clippy-game-buttons">
          <button class="clippy-game-btn is-ghost" data-act="quit">Quit</button>
        </div>
      `;
      const board = ov.querySelector('[data-board]');
      const scoreEl = ov.querySelector('[data-score]');
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => {
        running = false;
        clearInterval(tickInt);
        closeGameOverlay();
      });

      const boardRect = board.getBoundingClientRect();
      const W = boardRect.width;
      const H = boardRect.height;
      const CELL = 20;
      const COLS = Math.floor(W / CELL);
      const ROWS = Math.floor(H / CELL);
      const snake = [
        { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) },
        { x: Math.floor(COLS / 2) - 1, y: Math.floor(ROWS / 2) },
        { x: Math.floor(COLS / 2) - 2, y: Math.floor(ROWS / 2) },
      ];
      let dir = { x: 1, y: 0 };   // moving right
      let nextDir = dir;
      let food = spawnFood();
      let running = true;
      let lastMove = 0;
      let STEP_MS = 140;

      function spawnFood() {
        let f;
        do {
          f = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
        } while (snake.some(s => s.x === f.x && s.y === f.y));
        return f;
      }
      function draw() {
        board.innerHTML = '';
        // food
        const fEl = document.createElement('div');
        fEl.className = 'clippy-snake-food';
        fEl.style.left = (food.x * CELL + (CELL - 16) / 2) + 'px';
        fEl.style.top = (food.y * CELL + (CELL - 16) / 2) + 'px';
        board.appendChild(fEl);
        // snake
        snake.forEach((seg, i) => {
          const el = document.createElement('div');
          el.className = 'clippy-snake-cell' + (i === 0 ? ' clippy-snake-head' : '');
          const size = i === 0 ? 22 : 18;
          el.style.left = (seg.x * CELL + (CELL - size) / 2) + 'px';
          el.style.top = (seg.y * CELL + (CELL - size) / 2) + 'px';
          board.appendChild(el);
        });
      }
      draw();

      // Tap to turn: tap left half → turn left relative to direction, etc.
      function handleTap(clientX, clientY) {
        const rect = board.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const head = snake[0];
        const hx = head.x * CELL + CELL / 2;
        const hy = head.y * CELL + CELL / 2;
        const dx = x - hx;
        const dy = y - hy;
        // Choose dominant axis from tap
        if (Math.abs(dx) > Math.abs(dy)) {
          nextDir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
        } else {
          nextDir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
        }
        // Disallow reverse into self
        if (snake.length > 1 && nextDir.x === -dir.x && nextDir.y === -dir.y) {
          nextDir = dir;
        }
      }
      board.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length) handleTap(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });
      board.addEventListener('click', (e) => handleTap(e.clientX, e.clientY));

      const tickInt = setInterval(() => {
        if (!running) return;
        dir = nextDir;
        const head = snake[0];
        const newHead = { x: head.x + dir.x, y: head.y + dir.y };
        // Wall collision
        if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
          running = false;
          clearInterval(tickInt);
          bubble(pickFromPool('snake_die'), { autoHide: 2500 });
          setTimeout(() => showGameResult('snake', snake.length), 800);
          return;
        }
        // Self collision
        if (snake.some(s => s.x === newHead.x && s.y === newHead.y)) {
          running = false;
          clearInterval(tickInt);
          bubble(pickFromPool('snake_die'), { autoHide: 2500 });
          setTimeout(() => showGameResult('snake', snake.length), 800);
          return;
        }
        snake.unshift(newHead);
        // Food eaten?
        if (newHead.x === food.x && newHead.y === food.y) {
          food = spawnFood();
          playTone('boop');
          scoreEl.textContent = snake.length;
          // Speed up slightly
          if (snake.length % 5 === 0 && STEP_MS > 70) {
            STEP_MS -= 8;
          }
        } else {
          snake.pop();
        }
        draw();
      }, STEP_MS);
      state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => {
        running = false;
        clearInterval(tickInt);
      }]);
    });
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.22 QUIRKY IDLE BEHAVIORS — yawn, hiccup, sneeze, spin, groom
  // Triggered occasionally during idle. Each has a unique animation +
  // dialog pool. Adds personality without bubbles.
  // ════════════════════════════════════════════════════════════════════

  function doQuirk() {
    if (!state.enabled || state.suppressed || state.bubble) return;
    if (state.coinFlipInProgress) return;
    const feel = state.feelings ? dominantFeeling() : 'content';
    const candidates = [];
    // Yawn — more likely when tired
    candidates.push({ name: 'yawn', weight: feel === 'tired' ? 5 : 1 });
    // Hiccup — random
    candidates.push({ name: 'hiccup', weight: 1 });
    // Sneeze — random
    candidates.push({ name: 'sneeze', weight: 1 });
    // Spin — when happy
    candidates.push({ name: 'spin', weight: feel === 'overjoyed' ? 4 : 2 });
    // Groom — when content
    candidates.push({ name: 'groom', weight: 2 });
    const totalW = candidates.reduce((sum, c) => sum + c.weight, 0);
    let r = Math.random() * totalW;
    let pick = candidates[0];
    for (const c of candidates) {
      r -= c.weight;
      if (r <= 0) { pick = c; break; }
    }
    runQuirk(pick.name);
  }
  function runQuirk(name) {
    if (!state.shell) return;
    const cls = 'is-' + name + 'ing';
    state.shell.classList.add(cls);
    const dur = name === 'yawn' ? 1600 :
                name === 'hiccup' ? 1600 :
                name === 'sneeze' ? 500 :
                name === 'spin' ? 1400 : 1200;
    setTimeout(() => state.shell && state.shell.classList.remove(cls), dur);
    // Bubble accompanies the quirk
    const pool = name + '_remarks';
    if (state.dialog && state.dialog[pool]) {
      setTimeout(() => {
        if (!state.bubble && state.enabled) {
          bubble(pickFromPool(pool), { autoHide: 2800 });
        }
      }, name === 'sneeze' ? 100 : 400);
    }
    if (name === 'sneeze') spawnParticles({ count: 5, type: 'sparkle' });
    if (name === 'spin')   spawnParticles({ count: 3, type: 'sparkle' });
    depositMemory('quirk', `Did a ${name}.`, { name }, 1);
  }
  // Periodic quirk scheduler — every 8-18 minutes
  function scheduleQuirks() {
    if (state.quirkTimer) clearTimeout(state.quirkTimer);
    const delay = 480000 + Math.random() * 600000;   // 8-18 min
    state.quirkTimer = setTimeout(() => {
      doQuirk();
      scheduleQuirks();
    }, delay);
  }

  // v17.29 AUTONOMOUS ACTIONS — Trajan spontaneously sweeps, reads, or
  // scribes on his own every 25-50 minutes. Pure background animation;
  // user is just watching. No prompts, no asks.
  function scheduleAutonomousActions() {
    if (state.autonomousActionTimer) clearTimeout(state.autonomousActionTimer);
    const delay = 1500000 + Math.random() * 1500000;   // 25-50 min
    state.autonomousActionTimer = setTimeout(() => {
      maybeAutonomousAction();
      scheduleAutonomousActions();
    }, delay);
  }
  function maybeAutonomousAction() {
    if (!state.enabled || state.suppressed || state.sulkActive || state.bubble) return;
    const actions = [
      { fn: doSweep,   pool: 'autonomous_sweep',  eyebrow: '🧹 SWEEPING',  ms: 6000 },
      { fn: doRead,    pool: 'autonomous_read',   eyebrow: '📖 READING',   ms: 8000 },
      { fn: doScribe,  pool: 'autonomous_scribe', eyebrow: '📜 SCRIBING',  ms: 5000 },
    ];
    const pick = actions[Math.floor(Math.random() * actions.length)];
    // Bubble first, then start the action
    bubble(pickFromPool(pick.pool), { autoHide: 3500, eyebrow: pick.eyebrow });
    setTimeout(() => pick.fn(pick.ms), 1400);
  }

  // v17.29 AUTONOMOUS PROP CYCLING — once per day, ~30% chance, he picks
  // up a different prop without asking. Adds visual variety to passive watching.
  function maybeAutonomousPropCycle() {
    const today = (typeof todayDateStr === 'function') ? todayDateStr() :
      new Date().toISOString().slice(0,10);
    if (state.preferences.last_prop_cycle_date === today) return;
    if (Math.random() > 0.30) {
      state.preferences.last_prop_cycle_date = today;
      savePreferences();
      return;
    }
    const props = ['none', 'book', 'scroll', 'broom'];
    // Don't re-pick the same prop
    const current = state.preferences.prop || 'none';
    const candidates = props.filter(p => p !== current);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    state.preferences.last_prop_cycle_date = today;
    if (pick === 'none') {
      // Drop the prop, no fanfare
      setProp('none');
    } else {
      const label = { book: 'book', scroll: 'scroll', broom: 'broom' }[pick];
      setTimeout(() => {
        bubble(pickFromPool('autonomous_prop_change').replace('{prop}', label),
          { autoHide: 4200, eyebrow: '✨ MOOD' });
        setTimeout(() => setProp(pick), 1500);
      }, 4000);
    }
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.23 SULK SUBSYSTEM — Duolingo-style. When the user breaks a
  // streak or ignores Trajan for too long, he TURNS HIS BACK. Won't
  // respond normally. Must be wooed back with multiple gentle taps.
  // ════════════════════════════════════════════════════════════════════

  function enterSulk(reason, deep) {
    if (!state.enabled || !state.shell) return;
    state.sulkActive = true;
    state.sulkForgiveTaps = 0;
    state.sulkStartedAt = Date.now();
    state.sulkReason = reason || 'unknown';
    state.shell.classList.add('is-sulking');
    if (deep) state.shell.classList.add('is-deep-sulking');
    mood('sulking', 60000);   // long mood, sticky
    // Initial silent bubble
    setTimeout(() => {
      if (!state.bubble && state.enabled) {
        bubble(pickFromPool('sulk_silent'), { autoHide: 4000, eyebrow: '...' });
      }
    }, 600);
    depositMemory('sulk_start', `Started sulking (reason: ${reason}).`, { reason, deep }, 2);
    adjustFeeling('happiness', -10);
    adjustFeeling('affection', -3);
    // Override autonomy briefly
    state.preferences.last_sulk_at = Date.now();
    savePreferences();
    // v17.29: SOFT AUTO-FORGIVE — if user is just passively watching,
    // Trajan turns back around on his own after 90 minutes. No tapping required.
    if (state.sulkAutoForgiveTimer) clearTimeout(state.sulkAutoForgiveTimer);
    state.sulkAutoForgiveTimer = setTimeout(() => {
      if (state.sulkActive) {
        // Self-forgive bubble first
        bubble(pickFromPool('sulk_self_forgive'),
          { autoHide: 5000, eyebrow: '💛 BACK' });
        setTimeout(() => exitSulk(true), 3500);
      }
    }, deep ? 180 * 60_000 : 90 * 60_000);   // 90 min normal, 180 min deep
  }

  function exitSulk_v29_helper() {
    // clear the auto-forgive timer if user explicitly forgave
    if (state.sulkAutoForgiveTimer) {
      clearTimeout(state.sulkAutoForgiveTimer);
      state.sulkAutoForgiveTimer = null;
    }
  }

  function exitSulk(forgiven) {
    if (!state.sulkActive) return;
    state.sulkActive = false;
    exitSulk_v29_helper();   // clear auto-forgive timer if pending
    if (state.shell) {
      state.shell.classList.remove('is-sulking');
      state.shell.classList.remove('is-deep-sulking');
    }
    if (forgiven) {
      mood('happy', 6000);
      spawnParticles({ count: 12, type: 'heart' });
      playTone('sparkle');
      const line = substituteVars(pickFromPool('sulk_forgive_full'));
      bubble(line, { autoHide: 6500, eyebrow: '💛 FORGIVEN' });
      adjustFeeling('happiness', +20);
      adjustFeeling('affection', +15);
      depositMemory('forgiven', 'Was forgiven after sulking.', { taps: state.sulkForgiveTaps }, 3);
      addBondXP(10);
    }
    state.sulkForgiveTaps = 0;
  }

  // Tap handler during sulk — escalating responses based on tap count
  function handleSulkTap() {
    if (!state.sulkActive) return false;
    state.sulkForgiveTaps = (state.sulkForgiveTaps || 0) + 1;
    const taps = state.sulkForgiveTaps;
    // Stage gates
    if (taps < 3) {
      // Still cold
      bubble(pickFromPool('sulk_break_attempt'), { autoHide: 3000, eyebrow: '😒 HMPH' });
    } else if (taps < 6) {
      // Softening
      bubble(pickFromPool('sulk_forgive_partial'), { autoHide: 3000, eyebrow: '🤔 MAYBE' });
      // Slight visual warming — drop deep-sulk if present
      if (state.shell) state.shell.classList.remove('is-deep-sulking');
    } else {
      // Forgive!
      exitSulk(true);
    }
    return true;
  }

  // Check on session start: should we enter sulk mode?
  function maybeAutoSulk() {
    if (!state.shell || state.sulkActive) return false;
    if (state.preferences.do_not_disturb) return false;
    // Cooldown — don't re-sulk within 6 hours
    const lastSulk = state.preferences.last_sulk_at || 0;
    if (Date.now() - lastSulk < 6 * 3600000) return false;
    // Reason 1: streak just broke
    if (state.preferences.streak_just_broke) {
      delete state.preferences.streak_just_broke;
      savePreferences();
      enterSulk('streak_broke', true);   // deep sulk on streak break
      return true;
    }
    // Reason 2: extended absence (5+ days since last session)
    const lastSession = state.preferences.last_session_at;
    if (lastSession) {
      const daysAway = (Date.now() - new Date(lastSession).getTime()) / 86400000;
      if (daysAway >= 5) {
        enterSulk('long_absence', daysAway >= 14);
        return true;
      }
    }
    // Reason 3: too many rejections in a row
    if ((state.preferences.reject_count || 0) >= 8) {
      state.preferences.reject_count = 0;
      savePreferences();
      enterSulk('rejection_pile', false);
      return true;
    }
    return false;
  }


  // ─── Hook: when bored 60s+, occasionally offer a game ──────────
  function maybeOfferGame() {
    if (state.bubble || state.coinFlipInProgress || state.suppressed) return false;
    if (state.preferences.do_not_disturb) return false;
    const idleMs = Date.now() - (state.lastTapAt || 0);
    if (idleMs < 60000) return false;   // need 60s+ idle
    // Cooldown: don't pester more than once per 10min
    const lastOffer = state.preferences.last_game_offer || 0;
    if (Date.now() - lastOffer < 10 * 60000) return false;
    // 1% chance per 2s tick = ~1 offer per ~3min of solid boredom
    if (Math.random() > 0.01) return false;
    state.preferences.last_game_offer = Date.now();
    savePreferences();
    offerGame();
    return true;
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.20 SMUG LESSON MODE — when he thinks you need teaching, he
  // pulls you aside for a Roman or general-wisdom mini-lecture. The
  // condescending mood appears: half-lidded smug face + purple glow.
  // ════════════════════════════════════════════════════════════════════

  function pullLesson(opts) {
    opts = opts || {};
    if (state.bubble || state.suppressed) return false;
    if (state.preferences.do_not_disturb) return false;
    // 30% Roman, 70% general (Roman lessons feel more on-brand)
    const isRoman = Math.random() < 0.30;
    const introLine = pickFromPool('lesson_intro');
    const lessonLine = pickFromPool(isRoman ? 'lesson_roman' : 'lesson_general');
    const outroLine = pickFromPool('lesson_outro');
    mood('condescending', 14000);
    // Step 1: intro
    bubble(introLine, { autoHide: 3500, eyebrow: '📖 LESSON' });
    // Step 2: the actual lesson (after intro fades)
    setTimeout(() => {
      if (!state.enabled) return;
      bubble(lessonLine, { autoHide: 8000, eyebrow: isRoman ? '🏛️ ROMAN WISDOM' : '💡 LIFE TIP' });
    }, 4200);
    // Step 3: smug outro
    setTimeout(() => {
      if (!state.enabled) return;
      bubble(outroLine, { autoHide: 3500, eyebrow: '📖 LESSON' });
    }, 13500);
    // Memory deposit — lessons are remembered
    depositMemory('lesson', `Pulled a ${isRoman ? 'Roman' : 'life'} lesson on you.`, { type: isRoman ? 'roman' : 'general' }, 2);
    state.preferences.last_lesson_at = Date.now();
    savePreferences();
    adjustFeeling('happiness', +1);   // he enjoys being smart
    return true;
  }

  // Lesson trigger heuristic — fires when he detects user might benefit.
  // Conditions accumulate "lesson points"; threshold = pull lesson.
  function maybePullLesson() {
    if (state.bubble || state.coinFlipInProgress || state.suppressed) return false;
    if (state.preferences.do_not_disturb) return false;
    // Cooldown: at most one lesson per 25 minutes
    const last = state.preferences.last_lesson_at || 0;
    if (Date.now() - last < 25 * 60000) return false;
    // Conditions that "earn" a lesson
    let points = 0;
    // 1. After a bad game loss (rejected high score boost)
    const scores = getHighScores();
    if (state.lastGameScore && state.lastGameScore < (scores[state.lastGameId] || 0) * 0.4) points += 2;
    // 2. Lonely or sad feeling
    const feel = dominantFeeling();
    if (feel === 'lonely' || feel === 'sad') points += 1;
    // 3. Has been idle 5+ minutes
    const idle = Date.now() - (state.lastTapAt || 0);
    if (idle > 5 * 60000) points += 1;
    // 4. Has rejected several action bubbles
    if ((state.preferences.reject_count || 0) > 3) points += 1;
    // 5. Pure random — 0.3% per tap roll
    if (Math.random() < 0.003) points += 2;
    // Need 2+ points to trigger
    if (points < 2) return false;
    return pullLesson();
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.20 BONDING XP — Pokemon-style relationship progression. Every
  // meaningful interaction grants XP. Crossing thresholds = level up,
  // celebration, memory deposit. Visible in the memory dex.
  // ════════════════════════════════════════════════════════════════════

  const BOND_LEVEL_THRESHOLDS = [
    { lvl: 1, xp: 0,    label: 'Stranger' },
    { lvl: 2, xp: 50,   label: 'Acquaintance' },
    { lvl: 3, xp: 150,  label: 'Friend' },
    { lvl: 4, xp: 400,  label: 'Close Friend' },
    { lvl: 5, xp: 900,  label: 'Best Friend' },
    { lvl: 6, xp: 2000, label: 'Beloved' },
    { lvl: 7, xp: 4500, label: 'Lifelong' },
  ];

  function getBondXP() {
    return state.preferences.bond_xp || 0;
  }
  function getBondLevel() {
    const xp = getBondXP();
    let lvl = BOND_LEVEL_THRESHOLDS[0];
    for (const t of BOND_LEVEL_THRESHOLDS) {
      if (xp >= t.xp) lvl = t;
    }
    return lvl;
  }
  function nextBondThreshold() {
    const lvl = getBondLevel();
    const idx = BOND_LEVEL_THRESHOLDS.findIndex(t => t.lvl === lvl.lvl);
    return BOND_LEVEL_THRESHOLDS[idx + 1] || null;
  }
  function addBondXP(amount) {
    const before = getBondLevel();
    state.preferences.bond_xp = (state.preferences.bond_xp || 0) + amount;
    savePreferences();
    const after = getBondLevel();
    if (after.lvl > before.lvl) {
      // LEVEL UP
      onBondLevelUp(after);
    }
  }
  function onBondLevelUp(newLevel) {
    if (!state.enabled) return;
    setTimeout(() => {
      if (state.bubble) return;
      mood('super_excited', 7000);
      spawnParticles({ count: 20, type: 'confetti' });
      playTone('milestone');
      const line = substituteVars(pickFromPool('bond_level_up'));
      bubble(`🎉 BOND LEVEL ${newLevel.lvl}: ${newLevel.label}\n${line}`, {
        autoHide: 7000,
        eyebrow: '🌟 BOND UP'
      });
      depositMemory('bond_level', `Reached bond level ${newLevel.lvl}: ${newLevel.label}`,
                    { level: newLevel.lvl, label: newLevel.label }, 4);
      adjustFeeling('happiness', +15);
      adjustFeeling('affection', +8);
    }, 800);
  }

  // Common XP grants — sprinkle these throughout interactions
  function grantBondXP_tap() { addBondXP(1); adjustAffinity(0.05, 'tap'); }
  function grantBondXP_session() { addBondXP(5); adjustAffinity(0.5, 'session_start'); }
  function grantBondXP_game_played() { addBondXP(15); adjustAffinity(1, 'game_played'); }
  function grantBondXP_game_high_score() { addBondXP(25); adjustAffinity(2, 'high_score'); }
  function grantBondXP_chat_message() { addBondXP(8); adjustAffinity(1.5, 'chat'); }
  function grantBondXP_lesson_received() { addBondXP(3); adjustAffinity(0.3, 'lesson'); }


  // ════════════════════════════════════════════════════════════════════
  // v17.21 AUTONOMY — Trajan picks his own personality + mood based on
  // context. The user can still override via the menu, but by default
  // Trajan now makes these choices himself.
  // ════════════════════════════════════════════════════════════════════

  function pickAutonomousPersonality() {
    if (state.preferences.autonomy_off) return null;
    const hour = new Date().getHours();
    const bond = getBondLevel().lvl;
    const streak = state.preferences.daily_streak || 0;
    const feel = state.feelings ? dominantFeeling() : 'content';
    const idleMin = (Date.now() - (state.lastTapAt || 0)) / 60000;
    const rejects = state.preferences.reject_count || 0;
    const scores = { normal: 5, silly: 0, grumpy: 0, shy: 0, tsundere: 0, angry: 0 };
    if (hour >= 6 && hour <= 10) { scores.normal += 3; scores.silly += 2; }
    if (hour >= 11 && hour <= 16) { scores.normal += 3; scores.silly += 1; }
    if (hour >= 17 && hour <= 21) { scores.normal += 2; scores.silly += 2; scores.shy += 1; }
    if (hour >= 22 || hour <= 5) { scores.shy += 4; scores.grumpy += 2; }
    if (bond <= 2) { scores.normal += 4; scores.shy += 2; }
    else if (bond >= 5) { scores.silly += 4; scores.tsundere += 2; }
    if (streak >= 7) { scores.silly += 3; scores.normal += 2; }
    if (streak === 0) { scores.grumpy += 3; }
    if (feel === 'overjoyed') { scores.silly += 4; }
    if (feel === 'loving') { scores.tsundere += 3; scores.silly += 1; }
    if (feel === 'sad' || feel === 'lonely') { scores.shy += 4; }
    if (feel === 'tired') { scores.grumpy += 3; scores.shy += 2; }
    if (idleMin > 30) scores.grumpy += 2;
    if (rejects > 5) scores.grumpy += 3;
    Object.keys(scores).forEach(k => scores[k] += Math.random() * 2);
    let best = 'normal', bestScore = -1;
    Object.entries(scores).forEach(([p, s]) => { if (s > bestScore) { bestScore = s; best = p; } });
    return best;
  }

  function maybeAutoPickPersonality(reason) {
    if (state.preferences.autonomy_off) return;
    const cur = state.preferences.personality || 'normal';
    const picked = pickAutonomousPersonality();
    if (!picked || picked === cur) return;
    state.preferences.personality = picked;
    savePreferences();
    if (state.shell && !state.bubble && Math.random() < 0.55) {
      setTimeout(() => {
        if (!state.bubble && state.enabled) {
          const pool = 'persona_self_pick_' + picked;
          bubble(substituteVars(pickFromPool(pool)),
                 { autoHide: 4500, eyebrow: `${PERSONALITIES[picked].glyph} ${PERSONALITIES[picked].label.toUpperCase()}` });
          const reactMood = picked === 'silly' ? 'happy' :
                            picked === 'grumpy' ? 'peeved' :
                            picked === 'shy' ? 'bashful' :
                            picked === 'tsundere' ? 'embarrassed' :
                            picked === 'angry' ? 'angry' : 'thinking';
          mood(reactMood, 4000);
        }
      }, 1500);
    }
    depositMemory('personality_chg', `Autonomously chose ${picked} mode${reason ? ' (' + reason + ')' : ''}.`,
                  { from: cur, to: picked, reason }, 2);
  }

  function chooseMoodForMoment(hint) {
    const personality = state.preferences.personality || 'normal';
    const feel = state.feelings ? dominantFeeling() : 'content';
    if (hint === 'celebrate') {
      if (personality === 'tsundere') return 'embarrassed';
      if (personality === 'grumpy') return 'happy';
      return feel === 'overjoyed' ? 'super_excited' : 'proud';
    }
    if (hint === 'console') {
      if (personality === 'grumpy') return 'sad';
      if (personality === 'tsundere') return 'pouty';
      return 'worried';
    }
    if (hint === 'curious') {
      if (personality === 'shy') return 'gasp';
      return 'confused';
    }
    if (hint === 'proud_user') return personality === 'tsundere' ? 'bashful' : 'proud';
    if (hint === 'grateful') return 'bashful';
    if (hint === 'nostalgic') return 'melancholy';
    if (hint === 'protective') return 'determined';
    return feel === 'overjoyed' ? 'happy' :
           feel === 'loving' ? 'love' :
           feel === 'sad' ? 'sad' :
           feel === 'lonely' ? 'melancholy' :
           feel === 'tired' ? 'sleepy' :
           feel === 'ticklish' ? 'laughing' :
           'happy';
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.21 NEXUS ACTION AWARENESS — global click/form/modal/scroll
  // listeners. Trajan reacts to meaningful user actions.
  // ════════════════════════════════════════════════════════════════════

  function installNexusActionListener() {
    if (state.nxActionInstalled) return;
    state.nxActionInstalled = true;

    // 1. PRIMARY BUTTONS — ~10% reaction rate, 8s cooldown
    document.addEventListener('click', (e) => {
      if (!state.enabled || state.suppressed || state.bubble) return;
      const btn = e.target.closest(
        'button.ig-btn-primary, button.is-primary, .nx-btn-primary, ' +
        '[data-action="primary"], button[type="submit"]'
      );
      if (!btn) return;
      if (btn.closest('.clippy-bubble, .clippy-game-overlay, .clippy-dex-overlay, .clippy-palette')) return;
      if (state.nxLastReact && Date.now() - state.nxLastReact < 8000) return;
      if (Math.random() > 0.10) return;
      state.nxLastReact = Date.now();
      const isSubmit = btn.type === 'submit' || btn.matches('[data-action="submit"]');
      const pool = isSubmit ? 'nx_form_submit' : 'nx_button_click';
      setTimeout(() => {
        if (!state.bubble && state.enabled) {
          bubble(pickFromPool(pool), { autoHide: 3200, eyebrow: isSubmit ? '✅ DONE' : '👀 NOTED' });
          mood(chooseMoodForMoment(isSubmit ? 'celebrate' : 'curious'), 3500);
          if (isSubmit) {
            spawnParticles({ count: 6, type: 'sparkle' });
            adjustFeeling('happiness', +2);
          }
        }
      }, 350);
    }, { capture: false });

    // 2. FORM SUBMITS — capture phase for forms via Enter key
    document.addEventListener('submit', (e) => {
      if (!state.enabled || state.suppressed || state.bubble) return;
      const form = e.target;
      if (!form || !form.matches('form')) return;
      if (form.closest('.clippy-bubble, .clippy-game-overlay, .clippy-dex-overlay')) return;
      if (state.nxLastReact && Date.now() - state.nxLastReact < 8000) return;
      state.nxLastReact = Date.now();
      setTimeout(() => {
        if (!state.bubble && state.enabled) {
          bubble(pickFromPool('nx_form_submit'), { autoHide: 3500, eyebrow: '✅ SUBMIT' });
          mood('proud', 3800);
          spawnParticles({ count: 8, type: 'confetti' });
          adjustFeeling('happiness', +3);
          addBondXP(2);
        }
      }, 350);
    }, { capture: true });

    // 3. MODAL OPENS — MutationObserver for new dialogs
    const modalObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList && (
            node.classList.contains('clippy-bubble') ||
            node.classList.contains('clippy-game-overlay') ||
            node.classList.contains('clippy-dex-overlay') ||
            node.classList.contains('clippy-palette')
          )) continue;
          const isModal = node.matches && node.matches(
            '.nx-takeover, .nx-overlay-active, .nx-modal-backdrop, ' +
            'dialog[open], [role="dialog"], [data-overlay-active="true"]'
          );
          if (isModal) {
            if (state.nxLastReact && Date.now() - state.nxLastReact < 12000) return;
            if (Math.random() > 0.20) return;
            state.nxLastReact = Date.now();
            setTimeout(() => {
              if (!state.bubble && state.enabled && !state.suppressed) {
                bubble(pickFromPool('nx_modal_open'), { autoHide: 3500, eyebrow: '👁️ PEEK' });
                mood('gasp', 3200);
              }
            }, 600);
            return;
          }
        }
      }
    });
    modalObserver.observe(document.body, { childList: true, subtree: true });
    state.nxModalObserver = modalObserver;

    // 4. HEAVY SCROLLING — 25+ scroll events in 4 seconds
    let scrollEvents = [];
    document.addEventListener('scroll', () => {
      if (!state.enabled || state.suppressed || state.bubble) return;
      const now = Date.now();
      scrollEvents = scrollEvents.filter(t => now - t < 4000).concat([now]);
      if (scrollEvents.length >= 25) {
        scrollEvents = [];
        if (state.nxLastReact && now - state.nxLastReact < 30000) return;
        state.nxLastReact = now;
        setTimeout(() => {
          if (!state.bubble && state.enabled && !state.suppressed) {
            bubble(pickFromPool('nx_scroll_heavy'), { autoHide: 3800, eyebrow: '🔍 LOOKING' });
            mood('confused', 3500);
          }
        }, 200);
      }
    }, { passive: true });

    // 5. SEARCH FOCUS — react ~18% to search-input focus
    document.addEventListener('focusin', (e) => {
      if (!state.enabled || state.suppressed || state.bubble) return;
      const el = e.target;
      if (!el || !el.matches) return;
      const isSearch = el.matches(
        'input[type="search"], input[placeholder*="earch" i], input[aria-label*="earch" i]'
      );
      if (!isSearch) return;
      if (state.nxLastSearchFocus && Date.now() - state.nxLastSearchFocus < 60000) return;
      state.nxLastSearchFocus = Date.now();
      if (Math.random() > 0.18) return;
      setTimeout(() => {
        if (!state.bubble && state.enabled && !state.suppressed) {
          bubble(pickFromPool('nx_search_focus'), { autoHide: 3000, eyebrow: '🔎 WATCH' });
          mood('determined', 3000);
        }
      }, 500);
    }, { capture: true });
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.20 MEMORY DEX — Pokemon-style grid of collected memory types.
  // Shows all 20+ memory types as cards. Greyed-out = uncollected.
  // Highlighted = collected. Sparkle = rare ones. Shows bond level too.
  // ════════════════════════════════════════════════════════════════════

  // Catalog of memory types — used to build the dex grid
  const DEX_TYPES = [
    { type: 'tap_pop',         glyph: '👋', label: 'First Tap',       rare: false },
    { type: 'name_set',        glyph: '🪪', label: 'Named',           rare: false },
    { type: 'first_view_visit',glyph: '🗺️', label: 'View Visit',      rare: false },
    { type: 'streak',          glyph: '🔥', label: 'Streak',          rare: false },
    { type: 'achievement',     glyph: '🏆', label: 'Achievement',     rare: true  },
    { type: 'dream',           glyph: '💭', label: 'Dream',           rare: true  },
    { type: 'super_chat',      glyph: '✨', label: 'Oracle',          rare: true  },
    { type: 'coin_flip',       glyph: '🪙', label: 'Coin Flip',       rare: false },
    { type: 'mischief',        glyph: '🎭', label: 'Mischief',        rare: false },
    { type: 'high_score',      glyph: '🎮', label: 'High Score',      rare: true  },
    { type: 'bond_level',      glyph: '🌟', label: 'Bond Up',         rare: true  },
    { type: 'lesson',          glyph: '📖', label: 'Lesson',          rare: false },
    { type: 'special_day',     glyph: '🎉', label: 'Holiday',         rare: true  },
    { type: 'tickle',          glyph: '😂', label: 'Tickle',          rare: false },
    { type: 'song_played',     glyph: '🎵', label: 'Song',            rare: false },
    { type: 'palace_tour',     glyph: '🏛️', label: 'Palace Tour',     rare: false },
    { type: 'personality_chg', glyph: '🎭', label: 'Personality',     rare: false },
    { type: 'voice_enabled',   glyph: '🎙️', label: 'Voice On',        rare: false },
    { type: 'goodbye',         glyph: '🌙', label: 'Goodbye',         rare: false },
    { type: 'hello_return',    glyph: '🌅', label: 'Return',          rare: false },
  ];

  // ════════════════════════════════════════════════════════════════════
  // v17.24 STREAK GACHA — daily pull tied to streak. 24 cards across
  // 4 rarities. Pity system: guaranteed Rare every 10 pulls without one,
  // guaranteed Legendary every 30. Roman-themed: Virtues / Gods /
  // Emperors / Wonders.
  // ════════════════════════════════════════════════════════════════════

  const GACHA_CARDS = [
    // COMMON (60%) — Roman virtues
    { id: 'gravitas',    rarity: 'common',    glyph: '⚖️',  name: 'Gravitas',    power: '+1 XP per tap',       desc: 'Moral weight. The unignorable presence.' },
    { id: 'pietas',      rarity: 'common',    glyph: '🕊️',  name: 'Pietas',      power: '+10% streak bonus',    desc: 'Duty to gods, family, and country.' },
    { id: 'justitia',    rarity: 'common',    glyph: '🏛️',  name: 'Justitia',    power: 'Fair luck',            desc: 'The Roman ideal of justice and balance.' },
    { id: 'fortitudo',   rarity: 'common',    glyph: '🛡️',  name: 'Fortitudo',   power: 'Defense up',           desc: 'Strength to endure.' },
    { id: 'prudentia',   rarity: 'common',    glyph: '🦉',  name: 'Prudentia',   power: 'Wisdom drips',         desc: 'Practical wisdom in action.' },
    { id: 'temperantia', rarity: 'common',    glyph: '🍇',  name: 'Temperantia', power: 'Moderation',           desc: 'Restraint and proportion.' },
    { id: 'fides',       rarity: 'common',    glyph: '🤝',  name: 'Fides',       power: 'Trust earned',         desc: 'Loyalty kept across years.' },
    { id: 'clementia',   rarity: 'common',    glyph: '🌿',  name: 'Clementia',   power: 'Mercy buff',           desc: 'Mercy from strength, not weakness.' },
    // UNCOMMON (25%) — Roman gods
    { id: 'jupiter',     rarity: 'uncommon',  glyph: '⚡',   name: 'Jupiter',     power: 'Lightning crit',       desc: 'King of gods. Wielder of thunder.' },
    { id: 'mars',        rarity: 'uncommon',  glyph: '⚔️',  name: 'Mars',        power: '+5 cannon score',      desc: 'God of war and Roman discipline.' },
    { id: 'venus',       rarity: 'uncommon',  glyph: '🌹',  name: 'Venus',       power: '+15 affection',        desc: 'Goddess of love and persuasion.' },
    { id: 'minerva',     rarity: 'uncommon',  glyph: '🦉',  name: 'Minerva',     power: '+1 memory level start',desc: 'Goddess of wisdom and strategy.' },
    { id: 'mercury',     rarity: 'uncommon',  glyph: '🪶',  name: 'Mercury',     power: 'Faster transitions',   desc: 'Messenger of gods, patron of trade.' },
    { id: 'neptune',     rarity: 'uncommon',  glyph: '🔱',  name: 'Neptune',     power: 'Storm-tested',         desc: 'Ruler of seas and earthquakes.' },
    // RARE (12%) — Emperors
    { id: 'augustus',    rarity: 'rare',      glyph: '👑',  name: 'Augustus',    power: 'Start at Bond Lv 2',   desc: 'First emperor. Built Rome of marble.' },
    { id: 'trajan',      rarity: 'rare',      glyph: '🏛️',  name: 'Trajan',      power: 'Daily bonus +50%',     desc: 'My friend. Spanish-born. Empire at its peak.' },
    { id: 'hadrian',     rarity: 'rare',      glyph: '🧱',  name: 'Hadrian',     power: 'Wall of protection',   desc: 'Built walls. Knew when to stop.' },
    { id: 'marcus',      rarity: 'rare',      glyph: '📜',  name: 'Marcus Aurelius', power: 'Stoic +20 XP',    desc: 'Philosopher-emperor. Last good one.' },
    // LEGENDARY (3%) — Wonders & artifacts
    { id: 'pantheon',    rarity: 'legendary', glyph: '🏛️', name: 'Pantheon',    power: 'Unlocks GOLDEN mood',  desc: 'Hadrian\'s dome. Still standing 2,000 years.' },
    { id: 'colosseum',   rarity: 'legendary', glyph: '🏟️', name: 'Colosseum',   power: '+100 cannon score',    desc: '50,000 capacity. Naval battle staging.' },
    { id: 'aqueduct',    rarity: 'legendary', glyph: '🌊', name: 'Aqueduct',    power: 'Permanent flow',       desc: 'Aqua Virgo still feeds Trevi Fountain.' },
    { id: 'meditations', rarity: 'legendary', glyph: '📖', name: 'Meditations', power: 'Lessons +100% wisdom', desc: 'Marcus\'s private journal. Survives by miracle.' },
    { id: 'gladius',     rarity: 'legendary', glyph: '🗡️', name: 'Gladius',     power: 'War-honed crit',       desc: 'The short sword that built an empire.' },
    { id: 'eagle',       rarity: 'legendary', glyph: '🦅', name: 'Aquila',      power: 'Legionary blessing',   desc: 'The eagle standard. Lost = ultimate shame.' },
  ];

  // Drop rates
  const GACHA_RATES = { common: 0.60, uncommon: 0.25, rare: 0.12, legendary: 0.03 };

  function getGachaState() {
    try {
      const raw = localStorage.getItem(userKey('clippy_gacha'));
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed || {
        collection: {},          // id -> count
        pity_no_rare: 0,
        pity_no_legendary: 0,
        last_pull_date: null,    // YYYY-MM-DD
        total_pulls: 0,
      };
    } catch (e) { return { collection: {}, pity_no_rare: 0, pity_no_legendary: 0, last_pull_date: null, total_pulls: 0 }; }
  }
  function saveGachaState(s) {
    try { localStorage.setItem(userKey('clippy_gacha'), JSON.stringify(s)); } catch (e) {}
  }
  function pickGachaRarity(g) {
    // Pity overrides
    if (g.pity_no_legendary >= 29) return 'legendary';
    if (g.pity_no_rare >= 9) return 'rare';
    const r = Math.random();
    let cum = 0;
    for (const rar of ['legendary', 'rare', 'uncommon', 'common']) {
      cum += GACHA_RATES[rar];
      if (r < cum) return rar;
    }
    return 'common';
  }
  function pickGachaCard(rarity) {
    const pool = GACHA_CARDS.filter(c => c.rarity === rarity);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function todayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function canPullToday() {
    const g = getGachaState();
    return g.last_pull_date !== todayDateStr();
  }
  function hasStreakForGacha() {
    return (state.preferences.daily_streak || 0) >= 1;
  }

  // The big pull flow — invitation modal, spin animation, card reveal
  function showGachaInvite() {
    if (!hasStreakForGacha()) {
      bubble(pickFromPool('gacha_streak_required'), { autoHide: 4000, eyebrow: '🎴 GACHA' });
      return;
    }
    if (!canPullToday()) {
      bubble(substituteVars(pickFromPool('gacha_already_pulled_today')), { autoHide: 4000, eyebrow: '🎴 GACHA' });
      return;
    }
    runGachaPull();
  }

  function runGachaPull() {
    const ov = document.createElement('div');
    ov.className = 'clippy-gacha-overlay';
    ov.innerHTML = `
      <div class="clippy-gacha-prompt">DAILY PULL · Streak Day ${state.preferences.daily_streak || 1}</div>
      <div class="clippy-gacha-title">${esc(substituteVars(pickFromPool('gacha_invite')))}</div>
      <div class="clippy-gacha-pull-orb">${state.svgMarkup || ''}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="pull">🎴 Pull!</button>
        <button class="clippy-game-btn is-ghost" data-act="later">Later</button>
      </div>
    `;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-visible'));
    state.suppressed = true;
    if (state.shell) state.shell.classList.add('is-suppressed');

    function closeOv() {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.suppressed = false;
      if (state.shell) state.shell.classList.remove('is-suppressed');
    }
    ov.querySelector('[data-act="later"]').addEventListener('click', closeOv);
    ov.querySelector('[data-act="pull"]').addEventListener('click', () => {
      const orb = ov.querySelector('.clippy-gacha-pull-orb');
      orb.classList.add('is-spinning');
      ov.querySelector('.clippy-game-buttons').style.display = 'none';
      ov.querySelector('.clippy-gacha-title').textContent = pickFromPool('gacha_anticipate');
      setTimeout(() => revealCard(ov, closeOv), 1500);
    });
  }

  function revealCard(ov, closeOv) {
    const g = getGachaState();
    const rarity = pickGachaRarity(g);
    const card = pickGachaCard(rarity);
    // Update gacha state
    g.collection[card.id] = (g.collection[card.id] || 0) + 1;
    const isDuplicate = g.collection[card.id] > 1;
    if (rarity === 'rare' || rarity === 'legendary') g.pity_no_rare = 0;
    else g.pity_no_rare++;
    if (rarity === 'legendary') g.pity_no_legendary = 0;
    else g.pity_no_legendary++;
    g.last_pull_date = todayDateStr();
    g.total_pulls++;
    saveGachaState(g);

    // Rarity bubble
    const rarityPool = 'gacha_' + rarity;
    const remarkLine = substituteVars(pickFromPool(rarityPool));

    // Render the card
    const rarityLabel = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', legendary: 'LEGENDARY' }[rarity];
    ov.innerHTML = `
      <div class="clippy-gacha-prompt">${esc(rarityLabel)}</div>
      <div class="clippy-gacha-title">${esc(remarkLine)}</div>
      <div class="clippy-gacha-card is-${rarity}">
        <div class="clippy-gacha-card-rarity">${esc(rarityLabel)}</div>
        <div class="clippy-gacha-card-glyph">${card.glyph}</div>
        <div class="clippy-gacha-card-name">${esc(card.name)}</div>
        <div class="clippy-gacha-card-desc">${esc(card.desc)}</div>
        <div class="clippy-gacha-card-power">${esc(card.power)}</div>
      </div>
      ${isDuplicate ? `<div class="clippy-gacha-duplicate">${esc(pickFromPool('gacha_duplicate'))}</div>` : ''}
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="collection">View Collection</button>
        <button class="clippy-game-btn is-ghost" data-act="done">Done</button>
      </div>
    `;
    // Celebration effects
    if (rarity === 'legendary') {
      spawnParticles({ count: 32, type: 'confetti' });
      playTone('milestone');
      adjustFeeling('happiness', +20);
      addBondXP(50);
    } else if (rarity === 'rare') {
      spawnParticles({ count: 16, type: 'sparkle' });
      playTone('sparkle');
      adjustFeeling('happiness', +10);
      addBondXP(20);
    } else if (rarity === 'uncommon') {
      spawnParticles({ count: 8, type: 'sparkle' });
      playTone('boop');
      adjustFeeling('happiness', +5);
      addBondXP(10);
    } else {
      spawnParticles({ count: 4, type: 'sparkle' });
      playTone('boop');
      addBondXP(5);
    }
    if (isDuplicate) addBondXP(5);   // small consolation bond XP

    // Memory deposit (especially for rares+)
    if (rarity === 'rare' || rarity === 'legendary') {
      depositMemory('gacha_pull', `Pulled ${rarityLabel}: ${card.name}`, { card: card.id, rarity }, rarity === 'legendary' ? 4 : 3);
    }
    ov.querySelector('[data-act="done"]').addEventListener('click', closeOv);
    ov.querySelector('[data-act="collection"]').addEventListener('click', () => {
      closeOv();
      setTimeout(() => showGachaCollection(), 320);
    });
  }

  function showGachaCollection() {
    const g = getGachaState();
    const collected = Object.keys(g.collection).length;
    const total = GACHA_CARDS.length;
    const remark = pickFromPool('gacha_collection_remark');
    const ov = document.createElement('div');
    ov.className = 'clippy-gacha-overlay';
    ov.innerHTML = `
      <div class="clippy-gacha-prompt">🎴 GACHA COLLECTION</div>
      <div class="clippy-gacha-title">${esc(remark)}</div>
      <div class="clippy-gacha-prompt" style="margin-bottom:14px;">
        ${collected}/${total} unique · ${g.total_pulls} total pulls
      </div>
      <div class="clippy-gacha-collection">
        ${GACHA_CARDS.map(c => {
          const count = g.collection[c.id] || 0;
          const lockedCls = count === 0 ? 'is-locked' : '';
          return `<div class="clippy-gacha-coll-card is-${c.rarity} ${lockedCls}">
            <div class="clippy-gacha-coll-glyph">${c.glyph}</div>
            <div class="clippy-gacha-coll-name">${count === 0 ? '???' : esc(c.name)}</div>
            <div class="clippy-gacha-coll-count">×${count}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="clippy-game-buttons" style="margin-top:24px;">
        <button class="clippy-game-btn" data-act="close">Close</button>
      </div>
    `;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-visible'));
    state.suppressed = true;
    if (state.shell) state.shell.classList.add('is-suppressed');
    ov.querySelector('[data-act="close"]').addEventListener('click', () => {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.suppressed = false;
      if (state.shell) state.shell.classList.remove('is-suppressed');
    });
  }


  function showMemoryDex() {
    closeActionBubble();
    closeGameOverlay();
    const memories = state.memories || [];
    // Build type → count map
    const counts = {};
    memories.forEach(m => {
      counts[m.type] = (counts[m.type] || 0) + 1;
    });
    const collected = DEX_TYPES.filter(t => counts[t.type]).length;
    const total = DEX_TYPES.length;
    const bond = getBondLevel();
    const next = nextBondThreshold();
    const xp = getBondXP();
    const progressPct = next
      ? Math.min(100, ((xp - bond.xp) / (next.xp - bond.xp)) * 100)
      : 100;
    const remarkLine = pickFromPool('dex_remarks');
    const ov = document.createElement('div');
    ov.className = 'clippy-dex-overlay';
    ov.innerHTML = `
      <div class="clippy-dex-title">🏛️ Memory Dex</div>
      <div class="clippy-dex-headline">${esc(remarkLine)}</div>
      <div class="clippy-dex-bond">
        <div class="clippy-dex-bond-label">Bond Level</div>
        <div class="clippy-dex-bond-level">${bond.lvl} · ${esc(bond.label)}</div>
        <div class="clippy-dex-bond-bar">
          <div class="clippy-dex-bond-bar-fill" style="width:${progressPct}%"></div>
        </div>
        <div class="clippy-dex-bond-label" style="margin-top:8px;">
          ${esc(String(xp))} XP ${next ? `· next: ${esc(String(next.xp))} XP (${esc(next.label)})` : '· MAX'}
        </div>
      </div>
      <div class="clippy-dex-title" style="margin-bottom:8px;">
        Collected ${collected}/${total} types · ${esc(String(memories.length))} memories total
      </div>
      <div class="clippy-dex-grid">
        ${DEX_TYPES.map(t => {
          const c = counts[t.type] || 0;
          const collectedCls = c > 0 ? 'is-collected' : '';
          const rareCls = (t.rare && c > 0) ? 'is-rare' : '';
          return `<div class="clippy-dex-card ${collectedCls} ${rareCls}">
            <div class="clippy-dex-card-glyph">${t.glyph}</div>
            <div class="clippy-dex-card-label">${esc(t.label)}</div>
            <div class="clippy-dex-card-count">${c}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="clippy-game-buttons" style="margin-top:24px;">
        <button class="clippy-game-btn" data-act="close">Close</button>
      </div>
    `;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-visible'));
    state.dexOverlay = ov;
    ov.querySelector('[data-act="close"]').addEventListener('click', () => {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.dexOverlay = null;
    });
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.20 OFFLINE-FIRST HARDENING — synchronous localStorage writes,
  // cross-tab sync via storage event, retry queue for Supabase writes.
  // ════════════════════════════════════════════════════════════════════

  // Listen for storage events from OTHER tabs and re-load relevant data
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    if (e.key === userKey('clippy_memories')) {
      try {
        state.memories = e.newValue ? JSON.parse(e.newValue) : [];
      } catch (_) {}
    } else if (e.key === userKey('clippy_prefs')) {
      try {
        if (e.newValue) {
          const fresh = JSON.parse(e.newValue);
          Object.assign(state.preferences, fresh);
        }
      } catch (_) {}
    } else if (e.key === userKey('clippy_feelings')) {
      try {
        state.feelings = e.newValue ? JSON.parse(e.newValue) : state.feelings;
      } catch (_) {}
    }
  });
  function blockInputAttention(inputEl, inputRect) {
    if (!state.shell) return;
    const shellW = state.shell.offsetWidth || 120;
    const shellH = state.shell.offsetHeight || 120;
    const cx = inputRect.left + inputRect.width / 2 - shellW / 2;
    const cy = Math.max(40, inputRect.top - shellH / 3);
    moveTo(Math.max(8, Math.min(window.innerWidth - shellW - 8, cx)), cy);
    mood('smug', 3500);
    bubble(pickFromPool('attention_seeking'), { autoHide: 2800 });
    setTimeout(() => {
      if (state.enabled && state.shell) {
        moveToEmptyCorner();
      }
    }, 3800);
  }

  // ─── TIME-AWARE GREETING (v15.6) ──────────────────────────────────
  // Greet appropriately based on hour of day. Called once per session
  // shortly after Clippy is summoned. Polite — single bubble, autoHide.
  function timeAwareGreeting() {
    if (!state.enabled || !state.shell || state.suppressed) return;
    const h = new Date().getHours();
    let key;
    if (h < 5)        key = 'night';
    else if (h < 12)  key = 'morning';
    else if (h < 17)  key = 'afternoon';
    else if (h < 22)  key = 'evening';
    else              key = 'night';
    setTimeout(() => {
      if (state.bubble || !state.enabled || state.suppressed) return;
      bubble(pickFromPool(key), { autoHide: 3200 });
    }, 1800);
  }


  // ─── Costumes (legacy image-based, pre-v17.25) ─────────────────────
  function setCostumeImg(name, durationMs) {
    if (!state.costumeLayer) return;
    state.costumeLayer.innerHTML = '';
    if (!name) {
      state.costumeLayer.classList.remove('is-active');
      return;
    }
    const img = document.createElement('img');
    img.alt = '';
    img.className = `clippy-costume-img clippy-costume-${name}`;
    let triedPng = false;
    img.onerror = () => {
      if (!triedPng) { triedPng = true; img.src = `clippy-costumes/${name}.png`; }
      else state.costumeLayer.classList.remove('is-active');
    };
    img.src = `clippy-costumes/${name}.svg`;
    state.costumeLayer.appendChild(img);
    state.costumeLayer.classList.add('is-active');
    if (durationMs) {
      setTimeout(() => {
        if (state.costumeLayer.querySelector(`.clippy-costume-${name}`)) setCostumeImg(null);
      }, durationMs);
    }
  }


  // ─── Persona handoff ────────────────────────────────────────────────
  function offerBrain() {
    actionBubble(pickFromPool('offer_brain'), {
      actions: [
        { label: 'Providentia', cls: 'is-primary',        onClick: showProvidentia },
        { label: 'Trajan',      cls: 'is-warning-trajan', onClick: showTrajan },
        { label: 'Maybe later', onClick: () => {} },
      ]
    });
  }
  function showProvidentia() {
    actionBubble(pickFromPool('describe_providentia'), {
      actions: [
        { label: 'Talk to her',     cls: 'is-primary', onClick: () => handoffToBrain('providentia') },
        { label: 'Wait, Trajan',    onClick: showTrajan },
      ]
    });
  }
  function showTrajan() {
    actionBubble(pickFromPool('describe_trajan'), {
      actions: [
        { label: 'Talk to him',         cls: 'is-primary', onClick: confirmTrajan },
        { label: 'Wait, Providentia',   onClick: showProvidentia },
      ]
    });
  }
  function confirmTrajan() {
    mood('concerned', 4000);
    actionBubble(pickFromPool('pick_trajan_warning'), {
      actions: [
        { label: 'Yes, Trajan', cls: 'is-warning-trajan', onClick: () => {
          mood('neutral');
          bubble(pickFromPool('pick_trajan_confirmed'));
          setTimeout(() => handoffToBrain('trajan'), 1200);
        }},
        { label: 'Actually, no', onClick: () => mood('neutral') },
      ]
    });
  }
  function handoffToBrain(persona) {
    state.preferences.preferred_persona = persona;
    savePreferences();
    if (window.NX && typeof NX.switchTo === 'function') {
      try { window.NX.preferredPersona = persona; } catch (e) {}
      NX.switchTo('brain');
    }
  }


  // ─── Song player ────────────────────────────────────────────────────
  function getAudio() {
    if (!state.audio) {
      state.audio = new Audio();
      state.audio.src = 'audio/nexus-theme.mp3';
      state.audio.preload = 'auto';
      state.audio.volume = 0.7;
      state.audio.addEventListener('ended', () => {
        state.audioPlaying = false;
        if (state.shell) state.shell.classList.remove('is-listening');
        bubble(pickFromPool('song_ended'));
      });
    }
    return state.audio;
  }
  function offerSong(reason) {
    if (Date.now() < state.songCooldownAt) return;
    const poolKey = reason === 'stressed' ? 'offer_song_stressed' : 'offer_song_random';
    actionBubble(pickFromPool(poolKey), {
      actions: [
        { label: 'Yes, play it', cls: 'is-primary', onClick: () => {
          actionBubble(pickFromPool('song_accepted'), { musicPlayer: true });
          playSong();
        }, keepOpen: true },
        { label: 'Not now', onClick: () => {
          bubble(pickFromPool('song_declined'));
          state.songCooldownAt = Date.now() + 1000 * 60 * 60 * 4;
        }},
      ]
    });
  }
  function playSong() {
    const a = getAudio();
    a.currentTime = 0;
    a.play().catch(e => console.warn('[clippy] play failed:', e));
    state.audioPlaying = true;
    if (state.shell) state.shell.classList.add('is-listening');
    mood('happy');
  }
  function stopSong() {
    if (state.audio) { state.audio.pause(); state.audio.currentTime = 0; }
    state.audioPlaying = false;
    if (state.shell) state.shell.classList.remove('is-listening');
  }
  function renderMusicPlayer() {
    return `<div class="clippy-music-player">
      <button class="clippy-music-btn" data-music-toggle aria-label="Play/pause">▶</button>
      <div class="clippy-music-progress"><div class="clippy-music-progress-fill" data-music-progress></div></div>
      <button class="clippy-music-btn" data-music-stop aria-label="Stop">■</button>
    </div>`;
  }
  function wireMusicPlayer(host) {
    const toggleBtn = host.querySelector('[data-music-toggle]');
    const stopBtn   = host.querySelector('[data-music-stop]');
    const progressEl = host.querySelector('[data-music-progress]');
    if (!toggleBtn) return;
    const a = getAudio();
    function updateBtn() { toggleBtn.textContent = a.paused ? '▶' : '⏸'; }
    updateBtn();
    toggleBtn.addEventListener('click', () => {
      if (a.paused) a.play(); else a.pause();
      updateBtn();
    });
    stopBtn.addEventListener('click', () => { stopSong(); closeActionBubble(); });
    const timer = setInterval(() => {
      if (!progressEl || !document.body.contains(progressEl)) { clearInterval(timer); return; }
      const pct = a.duration ? (a.currentTime / a.duration) * 100 : 0;
      progressEl.style.width = pct + '%';
      updateBtn();
    }, 250);
  }


  // ─── Command palette ────────────────────────────────────────────────
  function paletteShortcuts() {
    return [
      { section: 'Cleaning', items: [
        { name: "Today's tasks",  hint: "Open the cleaning checklist", icon: '✔', action: () => goView('clean') },
        { name: "Person filter",  hint: "Switch whose view you see",  icon: '👤', action: () => goView('clean') },
      ]},
      { section: 'Education', items: [
        { name: "Browse guides",  hint: "How-to library", icon: '📖', action: () => goView('education') },
      ]},
      { section: 'Equipment', items: [
        { name: "Equipment list", hint: "PMs, manuals, status", icon: '🔧', action: () => goView('equipment') },
      ]},
      { section: 'Brain', items: [
        { name: "Talk to Providentia", hint: "Cool, calm, sees ahead", icon: '🧠', action: () => handoffToBrain('providentia') },
        { name: "Talk to Trajan",      hint: "Decisive. Direct.",      icon: '⚔', action: confirmTrajan },
      ]},
      { section: 'Clippy', items: [
        { name: "Listen to my favorite song", hint: "I think you'll like it", icon: '🎵', action: () => { closePalette(); offerSong('random'); }},
        { name: "Wave at me",                 hint: "Just a wave", icon: '👋', action: () => { closePalette(); play('wave'); mood('happy', 2000); }},
        { name: "Cartwheel!",                 hint: "Show off", icon: '🤸', action: () => { closePalette(); play('cartwheel'); mood('happy', 2000); }},
        { name: "Hop!",                       hint: "Excited", icon: '🦘', action: () => { closePalette(); play('hop'); }},
        { name: "Move out of the way",        hint: "Find an empty corner", icon: '➡', action: () => { closePalette(); moveToEmptyCorner(); }},
        { name: "Say something funny",        hint: "Random observation", icon: '💬', action: () => { closePalette(); bubble(pickFromPool('idle_random')); }},
        { name: state.preferences.do_not_disturb ? "Turn me on" : "Quiet mode", hint: "Toggle do-not-disturb", icon: '🤫', action: toggleDND },
        { name: "Send me away",               hint: "I'll come back later", icon: '👋', action: () => { closePalette(); declineToJoin(); }},
      ]},
    ];
  }
  function openPalette() {
    if (state.palette) return;
    closeActionBubble();
    const p = document.createElement('div');
    p.className = 'clippy-palette';
    p.innerHTML = `
      <div class="clippy-palette-bg"></div>
      <div class="clippy-palette-card">
        <div class="clippy-palette-head">
          <span class="clippy-palette-title">What can I help with?</span>
          <button class="clippy-palette-close" aria-label="Close">×</button>
        </div>
        <input class="clippy-palette-search" type="text" placeholder="Search… (try 'song', 'mop', 'PMs')">
        <div class="clippy-palette-results"></div>
      </div>
    `;
    ensureHost().appendChild(p);
    state.palette = p;
    requestAnimationFrame(() => p.classList.add('is-open'));
    p.querySelector('.clippy-palette-bg').addEventListener('click', closePalette);
    p.querySelector('.clippy-palette-close').addEventListener('click', closePalette);
    const search = p.querySelector('.clippy-palette-search');
    search.addEventListener('input', () => renderPaletteResults(search.value.trim().toLowerCase()));
    renderPaletteResults('');
    setTimeout(() => search.focus(), 320);
  }
  function closePalette() {
    if (!state.palette) return;
    const p = state.palette;
    p.classList.remove('is-open');
    setTimeout(() => { try { p.remove(); } catch (e) {} }, 320);
    state.palette = null;
  }
  function renderPaletteResults(query) {
    if (!state.palette) return;
    const out = state.palette.querySelector('.clippy-palette-results');
    const sections = paletteShortcuts();
    const q = query.toLowerCase();
    let html = '', total = 0;
    sections.forEach(sec => {
      const items = sec.items.filter(it =>
        !q || it.name.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q));
      if (!items.length) return;
      total += items.length;
      html += `<div class="clippy-palette-section-label">${esc(sec.section)}</div>`;
      items.forEach((it, i) => {
        html += `<button class="clippy-palette-item" data-section="${esc(sec.section)}" data-idx="${i}">
          <div class="clippy-palette-item-icon">${esc(it.icon)}</div>
          <div class="clippy-palette-item-body">
            <div class="clippy-palette-item-name">${esc(it.name)}</div>
            <div class="clippy-palette-item-hint">${esc(it.hint)}</div>
          </div>
        </button>`;
      });
    });
    if (!total) html = `<div class="clippy-palette-empty">${esc(pickFromPool('command_palette_no_results'))}</div>`;
    out.innerHTML = html;
    out.querySelectorAll('.clippy-palette-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        const idx = parseInt(btn.dataset.idx, 10);
        const sec = sections.find(s => s.section === section);
        if (sec && sec.items[idx]) { closePalette(); sec.items[idx].action(); }
      });
    });
  }
  function goView(view) {
    closePalette();
    if (window.NX && typeof NX.switchTo === 'function') NX.switchTo(view);
  }
  function toggleDND() {
    state.preferences.do_not_disturb = !state.preferences.do_not_disturb;
    savePreferences();
    closePalette();
    bubble(pickFromPool(state.preferences.do_not_disturb ? 'do_not_disturb_on' : 'do_not_disturb_off'));
  }


  // ─── Global listeners (konami, "hi clippy") ─────────────────────────
  function wireGlobalListeners() {
    document.addEventListener('keydown', (e) => {
      state.konamiSeq.push(e.key);
      if (state.konamiSeq.length > KONAMI.length) state.konamiSeq.shift();
      if (state.konamiSeq.length === KONAMI.length &&
          state.konamiSeq.every((k, i) => k === KONAMI[i])) {
        state.konamiSeq = [];
        if (state.enabled) {
          play('cartwheel');
          mood('surprised', 2000);
          bubble(pickFromPool('konami_code'));
        }
      }
    });
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || typeof t.value !== 'string') return;
      const v = t.value.toLowerCase();
      if (v.endsWith('hi clippy') || v.endsWith('clippy come back') || v.endsWith('come back clippy')) {
        if (!state.enabled) summon();
        else { play('wave'); bubble('hi!'); }
      }
    });
  }


  // ─── Greeting after join ────────────────────────────────────────────
  function afterJoinSchedule() {
    setTimeout(() => {
      if (!state.enabled || state.bubble) return;
      const dowKey = pickDayOfWeekPool();
      const todKey = pickTimeOfDayPool();
      const key = (dowKey && Math.random() < 0.4) ? dowKey : todKey;
      bubble(pickFromPool(key));
    }, 5000);
  }


  // ─── Summon (force show, bypass prefs) ──────────────────────────────
  async function summon() {
    state.preferences.enabled = true;
    state.preferences.reject_count = 0;
    state.preferences.last_seen_at = new Date().toISOString();
    state.preferences.session_count = (state.preferences.session_count || 0) + 1;
    await savePreferences();
    state.enabled = true;
    if (!state.shell) {
      await buildShell();
    } else {
      state.shell.classList.remove('is-hidden', 'is-peeking', 'is-peek-entering');
    }
    play('enter');
    mood('happy', 2500);
    setTimeout(() => bubble("hi! i'm back."), 700);
    if (!state.blinkTimer) startBlinking();
    if (!state.randomTimer) startRandomBehaviors();
    if (!state.moveTimer) startMovingAround();
  }


  // ════════════════════════════════════════════════════════════════════
  // v17.6 ePet FEATURES — particles, streaks, special days, sound
  // ════════════════════════════════════════════════════════════════════

  // ─── PARTICLE EFFECTS ─────────────────────────────────────────────
  // Lightweight DOM-based particles burst around Clippy on key moments:
  // sparkles on tap, hearts on love, confetti on milestones. Each
  // particle is a tiny div, animated via CSS, auto-removed after 1.5s.
  function spawnParticles(opts) {
    opts = opts || {};
    const count = opts.count || 6;
    const type = opts.type || 'sparkle';   // sparkle | heart | confetti
    const host = ensureHost();
    if (!host || !state.shell) return;
    const r = state.shell.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'clippy-particle clippy-particle-' + type;
      // Random direction + distance
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 60;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist - 15;  // bias upward
      p.style.left = (cx - 6) + 'px';
      p.style.top  = (cy - 6) + 'px';
      p.style.setProperty('--tx', tx + 'px');
      p.style.setProperty('--ty', ty + 'px');
      p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      p.style.animationDelay = (Math.random() * 120) + 'ms';
      host.appendChild(p);
      setTimeout(() => { try { p.remove(); } catch (_) {} }, 1700);
    }
  }

  // ─── WEB AUDIO SOUND EFFECTS ──────────────────────────────────────
  // Tiny synthesized tones via Web Audio API. No asset files. Off by
  // default; user toggles via menu. Respects autoplay policies via
  // user-gesture init (called from menu toggle or tap).
  let audioCtx = null;
  function getAudioCtx() {
    if (audioCtx) return audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { audioCtx = null; }
    return audioCtx;
  }
  function playTone(kind) {
    if (state.preferences.sound_enabled === false) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    let freq, dur, type, peak;
    switch (kind) {
      case 'boop':    freq = 880;  dur = 0.08; type = 'sine';     peak = 0.10; break;
      case 'sparkle': freq = 1760; dur = 0.20; type = 'triangle'; peak = 0.07; break;
      case 'hop':     freq = 520;  dur = 0.10; type = 'sine';     peak = 0.12; break;
      case 'bzzt':    freq = 220;  dur = 0.15; type = 'square';   peak = 0.05; break;
      case 'mwah':    freq = 700;  dur = 0.18; type = 'sine';     peak = 0.10; break;
      case 'milestone': freq = 1320; dur = 0.50; type = 'triangle'; peak = 0.12; break;
      default:        freq = 660;  dur = 0.10; type = 'sine';     peak = 0.10;
    }
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (kind === 'hop') osc.frequency.exponentialRampToValueAtTime(freq * 1.4, now + dur * 0.6);
    if (kind === 'milestone') {
      // chord: arpeggio
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1100, now + 0.1);
      osc.frequency.setValueAtTime(1320, now + 0.2);
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }

  // ─── DAILY STREAK ─────────────────────────────────────────────────
  // Tracks consecutive-day visits. Triggers celebration bubbles at
  // milestone counts (2, 3, 7, 14, 30, 50, 100, 365).
  function checkDailyStreak() {
    const todayStr = new Date().toDateString();
    const last = state.preferences.last_session_date;
    let streak = state.preferences.daily_streak || 0;
    let event = null;   // 'continued', 'broken', 'first'
    if (last === todayStr) {
      // Same day, no change
      return { streak, event: 'same_day', isMilestone: false };
    }
    if (!last) {
      streak = 1;
      event = 'first';
    } else {
      const lastDate = new Date(last);
      const diff = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
      if (diff === 1) {
        streak += 1;
        event = 'continued';
      } else {
        if (streak > 1) event = 'broken';
        streak = 1;
      }
    }
    state.preferences.daily_streak = streak;
    state.preferences.last_session_date = todayStr;
    savePreferences();
    const milestoneSteps = [2, 3, 7, 14, 30, 50, 100, 365];
    const isMilestone = milestoneSteps.includes(streak);
    return { streak, event, isMilestone };
  }
  function celebrateStreak(streak, isMilestone, event) {
    if (event === 'broken') {
      // v17.23: flag for sulk subsystem so he turns his back next time
      state.preferences.streak_just_broke = true;
      savePreferences();
      adjustAffinity(-10, 'streak_broken');   // v17.26: relationship cost
      setTimeout(() => bubble(pickFromPool('streak_broken'), { autoHide: 4500 }), 2500);
      return;
    }
    if (event === 'continued' && streak === 1 && state.preferences.last_sulk_at) {
      // v17.23: returning user after a sulk — special "you came back" bubble
      setTimeout(() => bubble(substituteVars(pickFromPool('streak_returned')),
        { autoHide: 5000, eyebrow: '💛 RETURN' }), 1500);
      adjustAffinity(+5, 'returned_after_sulk');
    }
    if (!isMilestone) return;
    // v17.26: milestone streak = big affinity boost
    const milestoneBoost = streak >= 365 ? 25 : streak >= 100 ? 18 : streak >= 30 ? 12 : streak >= 7 ? 7 : 3;
    adjustAffinity(+milestoneBoost, 'streak_milestone_' + streak);
    const pool = 'streak_' + streak;
    setTimeout(() => {
      mood('sparkle', 5000);
      play('hop');
      spawnParticles({ count: 18, type: 'confetti' });
      playTone('milestone');
      bubble(pickFromPool(pool), { autoHide: 6000, eyebrow: 'STREAK' });
    }, 2800);
    // v17.7: deposit streak-milestone memory
    const streakImportance = streak >= 365 ? 5 : streak >= 100 ? 5 : streak >= 30 ? 4 : streak >= 7 ? 3 : 3;
    depositMemory(
      'streak',
      `You hit a ${streak}-day streak.`,
      { streak },
      streakImportance
    );
  }

  // ─── SPECIAL DAYS ─────────────────────────────────────────────────
  // Detect Roman / Western special dates and surface themed bubbles.
  function checkSpecialDay() {
    const d = new Date();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    if (m === 12 && day >= 17 && day <= 23) return 'saturnalia';
    if (m === 12 && day === 25)            return 'christmas';
    if ((m === 12 && day === 31) || (m === 1 && day === 1)) return 'new_year';
    if (m === 10 && day === 31)            return 'halloween';
    if (m === 2  && day === 14)            return 'valentines';
    if (m === 3  && day === 15)            return 'ides_of_march';
    if (m === 4  && day === 21)            return 'rome_birthday';
    // User's anniversary with Clippy
    const accepted = state.preferences.accepted_at;
    if (accepted) {
      const a = new Date(accepted);
      if (a.getMonth() === d.getMonth() && a.getDate() === d.getDate()
          && a.getFullYear() < d.getFullYear()) {
        return 'anniversary';
      }
    }
    return null;
  }
  function celebrateSpecialDay(key) {
    if (!key) return;
    const pool = (key === 'anniversary') ? 'anniversary' : ('special_day_' + key);
    setTimeout(() => {
      if (state.bubble || !state.enabled) return;
      mood('sparkle', 5500);
      play('hop');
      spawnParticles({ count: 20, type: 'confetti' });
      playTone('milestone');
      bubble(pickFromPool(pool), { autoHide: 7000, eyebrow: key.toUpperCase().replace('_', ' ') });
    }, 4500);
    // v17.7: deposit special-day memory (deduped per year via data.year)
    const year = new Date().getFullYear();
    const existing = (state.memories || []).find(m =>
      m.type === (key === 'anniversary' ? 'anniversary' : 'special_day')
      && m.data && m.data.key === key && m.data.year === year
    );
    if (!existing) {
      depositMemory(
        key === 'anniversary' ? 'anniversary' : 'special_day',
        key === 'anniversary'
          ? `We celebrated our anniversary in ${year}.`
          : `We observed ${key.replace(/_/g, ' ')} together in ${year}.`,
        { key, year },
        key === 'anniversary' ? 5 : 3
      );
    }
  }


  // ─── INIT ───────────────────────────────────────────────────────────
  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    loadPoolHistory();
    loadMemories();                 // v17.7: load deposited memory nodes
    loadFeelings();                 // v17.10: load persistent feelings model
    await loadDialog();
    await loadPreferences();
    wireGlobalListeners();

    if (state.preferences.enabled === true) {
      // Already accepted
      state.enabled = true;
      await buildShell();
      play('enter');
      startBlinking();
      startRandomBehaviors();
      startMovingAround();
      startContentAwareness();
      setTimeout(() => moveToEmptyCorner(), 800);
      afterJoinSchedule();
      // v17.11: stage-aware greeting (formal/casual/inside-joke/old-friend
      // depending on days_known). Falls back to time-aware on first day.
      if (state.preferences.accepted_at) {
        bubble(substituteVars(familiarityGreeting()), { autoHide: 4500 });
        mood('happy', 4000);
      } else {
        timeAwareGreeting();
      }
      // v17.6: daily streak + special day celebrations
      const streakInfo = checkDailyStreak();
      celebrateStreak(streakInfo.streak, streakInfo.isMilestone, streakInfo.event);
      celebrateSpecialDay(checkSpecialDay());
      // v17.9: periodic checks + session-time achievement flags
      const hour = new Date().getHours();
      if (hour >= 0 && hour < 4) state.preferences.midnight_session = true;
      if (hour >= 4 && hour < 6) state.preferences.dawn_session = true;
      savePreferences();
      checkAchievements(true);   // silent initial scan
      setInterval(() => {
        if (!state.enabled || state.suppressed) return;
        checkAchievements();
        checkIgnored();
      }, 30000);
      // v17.10: clock awareness — every 60s check for hour change
      setInterval(() => { if (state.enabled && !state.suppressed) hourlyCheck(); }, 60000);
      // v17.10: feelings drift — every 90s decay toward baseline
      setInterval(() => { if (state.enabled) decayFeelings(); }, 90000);
      // v17.10: stress check — once per 5min, attempts at most once per day
      setInterval(() => { if (state.enabled && !state.suppressed) checkStressMarkers(); }, 5 * 60000);
      // v17.15: ADVANCED PET BEHAVIORS
      // Mood weather — halo color tracks dominant feeling
      setInterval(updateMoodWeather, 30000);
      updateMoodWeather();
      // Mischief moments — random unprompted aliveness
      scheduleMischief();
      // Morning ritual — first interaction of new day
      checkMorningRitual();
      // Dream — if returning after long absence, occasionally tell one
      maybeTellDream();
      // Session-end recorder for the next-visit dream check
      window.addEventListener('pagehide', recordSessionEnd);
      window.addEventListener('beforeunload', recordSessionEnd);
      // v17.21: AUTONOMY — Trajan picks his own personality on session
      // start and then re-evaluates every hour. The user can override.
      maybeAutoPickPersonality('session_start');
      setInterval(() => maybeAutoPickPersonality('hourly_check'), 60 * 60000);
      // v17.21: NEXUS ACTION LISTENER — global button/form/modal/scroll awareness
      installNexusActionListener();
      // v17.22: QUIRKY IDLE BEHAVIORS — yawn/hiccup/sneeze/spin every 8-18 min
      scheduleQuirks();
      // v17.29: AUTONOMOUS ACTIONS — sweep/read/scribe every 25-50 min
      scheduleAutonomousActions();
      // v17.29: AUTONOMOUS PROP CYCLE — daily ~30% chance to swap prop
      setTimeout(() => maybeAutonomousPropCycle(), 8000);
      // v17.30: DOTA 2-style PRD bored mischief — chance climbs 5%/30s
      state.bootedAt = Date.now();
      startBoredMischiefPRD();
      // v17.23: SULK CHECK — turn the back if streak broken or long absence
      setTimeout(() => maybeAutoSulk(), 3500);
      // v17.25: apply saved costume + prop + start cloud sync
      applyPersistedCostume();
      initCloudSync();
      // v17.27: roll for conqueror alter ego day + apply visuals
      maybeRollConqueror();
      applyConquerorVisuals();
      announceConqueror();
      // v17.26: affinity decay every hour + affinity-aware greeting on session start
      setInterval(decayAffinity, 60 * 60000);
      // First-meet vs returning recognition
      if (state.preferences.affinity === undefined) {
        // First session with this user
        state.preferences.affinity = 0;
        savePreferences();
        setTimeout(() => {
          if (!state.bubble && state.enabled && !state.sulkActive) {
            bubble(substituteVars(pickFromPool('affinity_first_meet')),
              { autoHide: 4500, eyebrow: '👋 NEW' });
          }
        }, 3500);
      } else {
        maybeAffinityGreeting();
      }
      grantBondXP_session();   // also boosts affinity slightly
    } else if (shouldShowComeback()) {
      // v17.5: peek with ONLY HIS EYES visible, from a random spot.
      // Each session a different place. The is-peek-eyes-only class
      // clips the SVG to the eye band so the rest of the body hides.
      await buildShell();
      state.shell.classList.add('is-peek-eyes-only');
      positionPeekRandomly();
      play('wave');
      startContentAwareness();
      // Use peek_question pool for variety in the welcome wording
      setTimeout(() => {
        actionBubble(pickFromPool('peek_question'), {
          actions: [
            { label: 'Yes!',      cls: 'is-primary', onClick: acceptToJoin },
            { label: 'Not today', onClick: declineToJoin },
          ]
        });
      }, 1300);
    }
  }

  // v17.5: position the shell at a random spot for the peek state.
  // Avoids the central PIN/coin area; biases to the four edges so he
  // looks like he's poking his eyes out from behind the corner.
  function positionPeekRandomly() {
    if (!state.shell) return;
    const w = window.innerWidth, h = window.innerHeight;
    const shellW = 120, shellH = 120;
    const margin = 16;
    // Choose a random corner quadrant — never the same as last session
    const quadrants = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right'];
    const last = state.preferences.last_peek_quadrant;
    const avail = quadrants.filter(q => q !== last);
    const q = avail[Math.floor(Math.random() * avail.length)];
    state.preferences.last_peek_quadrant = q;
    savePreferences();
    let x, y;
    switch (q) {
      case 'top-left':
        x = margin + Math.random() * (w * 0.15);
        y = margin + Math.random() * (h * 0.10);
        break;
      case 'top-right':
        x = w - shellW - margin - Math.random() * (w * 0.15);
        y = margin + Math.random() * (h * 0.10);
        break;
      case 'bottom-left':
        x = margin + Math.random() * (w * 0.15);
        y = h - shellH - margin - Math.random() * (h * 0.10);
        break;
      case 'bottom-right':
        x = w - shellW - margin - Math.random() * (w * 0.15);
        y = h - shellH - margin - Math.random() * (h * 0.10);
        break;
      case 'middle-left':
        x = margin;
        y = h * 0.35 + Math.random() * (h * 0.2);
        break;
      case 'middle-right':
        x = w - shellW - margin;
        y = h * 0.35 + Math.random() * (h * 0.2);
        break;
    }
    state.shell.style.left = Math.round(x) + 'px';
    state.shell.style.top  = Math.round(y) + 'px';
    state.shell.style.right  = 'auto';
    state.shell.style.bottom = 'auto';
  }


  // ─── Public API ─────────────────────────────────────────────────────
  function notifyTaskCompleted() {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    // v17.11: every 3rd-or-so completion gets the bigger celebration
    if (Math.random() < 0.4) {
      celebrateNexusTask();
      return;
    }
    if (Math.random() < 0.6) {
      mood('happy', 2200);
      play('hop');
      bubble(pickFromPool('task_completed'));
    }
  }
  function notifyStreak(days) {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    // v17.11: bigger streaks get the rich celebration
    if (days >= 3) {
      celebrateNexusStreak();
      setTimeout(() => {
        actionBubble(fmt(pickFromPool('streak_milestone'), { N: days }), { duration: 4500 });
      }, 1500);
      return;
    }
    mood('happy', 4500);
    play('cartwheel');
    actionBubble(fmt(pickFromPool('streak_milestone'), { N: days }), { duration: 4500 });
  }
  function notifyOverdueDetected() {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    if (Math.random() > 0.4) return;
    mood('sad', 3000);
    // v17.11: pick the gentler nudge pool half the time
    const pool = Math.random() < 0.5 ? 'nexus_overdue_check' : 'task_overdue_passive';
    bubble(pickFromPool(pool));
  }
  // v17.11: NEXUS can call this when equipment is fixed/cleared
  function notifyEquipmentFixed() {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    mood('sparkle', 4500);
    spawnParticles({ count: 8, type: 'sparkle' });
    playTone('sparkle');
    bubble(pickFromPool('nexus_equipment_fixed'), { autoHide: 4500, eyebrow: 'FIXED' });
    adjustFeeling('happiness', +5);
  }
  function checkForStress(metrics) {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    if (Date.now() < state.songCooldownAt) return;
    const stressed = (metrics && (metrics.overdueCount >= 3 || metrics.sessionMinutes >= 120));
    if (stressed) offerSong('stressed');
  }
  function addTrajanQuote(q) { if (q) state.quoteCorpus.push(q); }

  if (!window.NX) window.NX = {};
  NX.clippy = {
    init,
    summon,
    bubble, actionBubble,
    play, mood,
    sleep, wake,
    setCostume,
    moveTo, moveToEmptyCorner,
    notifyTaskCompleted,
    notifyStreak,
    notifyOverdueDetected,
    notifyEquipmentFixed,           // v17.11
    celebrateNexusTask,             // v17.11
    celebrateNexusStreak,           // v17.11
    openChat,                       // v17.11 — programmatic chat
    triggerSuperChat,               // v17.11 — force-open oracle (admin/test)
    checkForStress,
    addTrajanQuote,
    offerBrain, offerSong,
    openPalette,
    onViewChange: () => {},
    switchAgent: () => {},   // no-op (legacy API, no longer applies)
    enable: () => { state.preferences.enabled = true; savePreferences(); init(); },
    disable: declineToJoin,

    // ─── v17.7/8 MEMORY-NODE + PALACE API (for galaxy.js to consume) ──
    // The galaxy can register a new layer that consumes these. Either
    // poll getMemories() at render time, OR listen for the live event:
    //   window.addEventListener('clippy:memory-deposited', e => e.detail)
    // OR define window.NX.galaxy.addClippyMemory(node) and Clippy will
    // call it directly the moment a memory is deposited.
    //
    // v17.8 adds the memory palace — seven Roman rooms organize nodes:
    //   atrium, tablinum, lararium, bibliotheca, triclinium, hortus, peristylium
    getMemories: () => (state.memories || []).slice(),
    getMemoryCount: () => (state.memories || []).length,
    getMemoryColors: () => Object.assign({}, MEMORY_COLORS),
    getMemoryBank: getMemoryBank,                  // summary of all rooms + counts
    getPalaceRooms: () => Object.assign({}, PALACE_ROOMS),
    getRoomMemories: (room) => (state.memories || []).filter(m =>
      (m.room || 'atrium') === room
    ),
    tourPalace: tourPalace,
    depositMemory,                                 // external code can also deposit
    forgetMemory: (id) => {
      if (!state.memories) return false;
      const before = state.memories.length;
      state.memories = state.memories.filter(m => m.id !== id);
      saveMemories();
      try { window.dispatchEvent(new CustomEvent('clippy:memory-forgotten', { detail: { id } })); } catch (_) {}
      return state.memories.length < before;
    },
    clearMemories: () => {
      state.memories = [];
      saveMemories();
      try { window.dispatchEvent(new CustomEvent('clippy:memories-cleared')); } catch (_) {}
    },
    onMemoryDeposit: (cb) => {
      const handler = (e) => cb(e.detail);
      window.addEventListener('clippy:memory-deposited', handler);
      return () => window.removeEventListener('clippy:memory-deposited', handler);
    },
  };

  function tryInit() {
    if (window.NX) init();
    else setTimeout(tryInit, 200);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }

})();
