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
    embarrassed: 'is-embarrassed',  // looking away + brighter blush
    kissy:       'is-kissy',        // closed eyes + kiss pucker
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
    const histSize = Math.max(2, Math.min(50, Math.floor(pool.length * 0.4)));
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
    try { localStorage.setItem('clippy_pool_history', JSON.stringify(state.poolHistory)); } catch (e) {}
  }
  function loadPoolHistory() {
    try {
      const raw = localStorage.getItem('clippy_pool_history');
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
      const raw = localStorage.getItem('clippy_memories');
      state.memories = raw ? (JSON.parse(raw) || []) : [];
    } catch (e) { state.memories = []; }
  }
  function saveMemories() {
    try { localStorage.setItem('clippy_memories', JSON.stringify(state.memories || [])); } catch (e) {}
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




  // ─── Preferences ────────────────────────────────────────────────────
  async function loadPreferences() {
    try {
      const raw = localStorage.getItem('clippy_prefs');
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
    try { localStorage.setItem('clippy_prefs', JSON.stringify(state.preferences)); } catch (e) {}
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
    const shell = document.createElement('div');
    shell.id = 'clippy-shell';
    shell.innerHTML = svgText + '<div id="clippy-costume-layer"></div>';
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
      setCostume('chef', 8000);
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
    // v17.6: tactile feedback — sparkle + boop on every tap
    spawnParticles({ count: 4, type: 'sparkle' });
    playTone('boop');
    // v17.7: 8% chance to recall a memory if we have at least 3 stored
    if (state.memories && state.memories.length >= 3 && Math.random() < 0.08) {
      if (showRecallBubble()) return;
    }
    const r = Math.random();
    if (r < 0.18) {
      // v17.6: occasional name-personalized bubble
      bubble(pickFromPool('name_random'), { autoHide: 4200 });
      mood('happy', 3800);
    } else if (r < 0.32) {
      bubble(pickFromPool('roman_facts'), { eyebrow: 'ROMA', autoHide: 5800 });
      mood('thinking', 5500);
    } else if (r < 0.42) {
      bubble(pickFromPool('whimsical_idle'), { autoHide: 3800 });
    } else if (r < 0.50) {
      bubble(pickFromPool('dad_jokes'), { autoHide: 4500 });
      mood('winking', 3800);
    } else if (r < 0.60) {
      // v17.6: name-aware compliments — more emotional impact
      bubble(pickFromPool('name_compliment'), { autoHide: 3800 });
      mood('love', 3800);
      spawnParticles({ count: 3, type: 'heart' });
    } else if (r < 0.70) {
      bubble(pickFromPool('latin_phrases'), { eyebrow: 'LATINA', autoHide: 4500 });
      mood('determined', 4000);
    } else if (r < 0.78) {
      // v17.5: multilang hi or bye
      const which = Math.random() < 0.6 ? 'multilang_hi' : 'multilang_bye';
      bubble(pickFromPool(which), { eyebrow: 'POLYGLOT', autoHide: 4500 });
      mood('happy', 3500);
    } else if (r < 0.85) {
      // v17.5: random translation
      bubble(pickFromPool('translations'), { eyebrow: 'LINGUA', autoHide: 5000 });
      mood('thinking', 4500);
    } else if (r < 0.93) {
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
      el.classList.add('tail-right');
      return;
    }
    const rect = state.shell.getBoundingClientRect();
    if (rect.width === 0) {
      el.style.top  = (window.innerHeight - eRect.height - 200) + 'px';
      el.style.left = (window.innerWidth  - eRect.width  - 24)  + 'px';
      el.classList.add('tail-right');
      return;
    }
    let top  = rect.top - eRect.height - 24;
    let left = rect.left + (rect.width / 2) - (eRect.width / 2);
    left = Math.max(8, Math.min(window.innerWidth  - eRect.width  - 8, left));
    top  = Math.max(8, top);
    el.style.top  = top  + 'px';
    el.style.left = left + 'px';
    el.classList.remove('tail-left', 'tail-right');
    el.classList.add(rect.left < window.innerWidth / 2 ? 'tail-left' : 'tail-right');
  }
  function closeActionBubble() {
    if (state.bubble) {
      state.bubble.classList.remove('is-visible');
      const b = state.bubble;
      setTimeout(() => { try { b.remove(); } catch (e) {} }, 220);
      state.bubble = null;
    }
  }


  // ─── "What's up?" tap menu ──────────────────────────────────────────
  function showWhatsUp() {
    const soundOn = state.preferences.sound_enabled !== false;
    const memCount = (state.memories || []).length;
    const actions = [
      { label: 'Open menu', cls: 'is-primary', onClick: openPalette },
      { label: 'Set my name', onClick: askForName },
    ];
    if (memCount >= 3) {
      actions.push({ label: `🏛️ Tour palace (${memCount})`, onClick: tourPalace });
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
    setCostume('laurel', 7000);
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
    let lastView = null;
    let lastViewBubbleAt = 0;
    setInterval(() => {
      if (!state.enabled || !state.shell || state.suppressed) return;
      const active = document.querySelector('.nav-tab.active[data-view], .bnav-btn.active[data-view]');
      const view = active ? active.getAttribute('data-view') : null;
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
        // Only react if it's been 25+ seconds since last view bubble,
        // and a fresh switch (not initial detection). Also random gate.
        const now = Date.now();
        if (now - lastViewBubbleAt > 25_000 && Math.random() < 0.55 && !state.bubble) {
          lastViewBubbleAt = now;
          const pool = 'context_' + view;
          // Only fire if a pool actually exists for this view
          if (state.dialog && state.dialog[pool] && state.dialog[pool].length) {
            setTimeout(() => {
              if (!state.bubble && state.enabled) {
                bubble(pickFromPool(pool), { autoHide: 4200 });
              }
            }, 600);
          }
        }
      }
    }, 2000);
  }
  // is focusing. After ~3.5s, politely retreat. Quirky behavior, ~12%.
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


  // ─── Costumes ───────────────────────────────────────────────────────
  function setCostume(name, durationMs) {
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
        if (state.costumeLayer.querySelector(`.clippy-costume-${name}`)) setCostume(null);
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
      setTimeout(() => bubble(pickFromPool('streak_broken'), { autoHide: 4500 }), 2500);
      return;
    }
    if (!isMilestone) return;
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
      // v17 fix: greet already-enabled users on each session too. Without
      // this they see Clippy appear silently and report "no dialog" —
      // the only path that called timeAwareGreeting was acceptJoin(),
      // which only fires during onboarding.
      timeAwareGreeting();
      // v17.6: daily streak + special day celebrations
      const streakInfo = checkDailyStreak();
      celebrateStreak(streakInfo.streak, streakInfo.isMilestone, streakInfo.event);
      celebrateSpecialDay(checkSpecialDay());
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
    if (Math.random() < 0.6) {
      mood('happy', 2200);
      play('hop');
      bubble(pickFromPool('task_completed'));
    }
  }
  function notifyStreak(days) {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    mood('happy', 4500);
    play('cartwheel');
    actionBubble(fmt(pickFromPool('streak_milestone'), { N: days }), { duration: 4500 });
  }
  function notifyOverdueDetected() {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    if (Math.random() > 0.4) return;
    mood('sad', 3000);
    bubble(pickFromPool('task_overdue_passive'));
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
