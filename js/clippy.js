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

  /* ══════════════════════════════════════════════════════════════════════
     v18.26 — FILE TABLE OF CONTENTS
     ────────────────────────────────────────────────────────────────────
     This file is 12k lines. Use Cmd/Ctrl+G + the line numbers below to
     jump to a module. Each module is bracketed by `╔══ MODULE: name ══╗`
     and `╚══ END: name ══╝` markers — find them with /MODULE: in editor.

       CORE INFRASTRUCTURE
         ~32   STATE              the shared state object
         ~150  MOODS              expression definitions
         ~160  v18.26 INFRA       CFG, timers, listeners, overlays, cloud lock, teardown
         ~380  UTILITIES          esc, userKey, getCurrentUser, etc.
         ~410  CLOUD SYNC         cloudPush, cloudPull, withCloudLock-wrapped

       DIALOG + SPEECH
         ~558  DIALOG POOLS       INLINE_POOLS (the big content payload)
         ~727  VARIABLE SUBST     {name}, {pet}, {streak} interpolation
         ~5637 BUBBLE / CHAT      actionBubble, openChat, closeActionBubble

       REWARD SYSTEMS (5 overlapping — see v18.26 trigger dispatcher below)
         ~1028 FEELINGS           8 gauges 0-100 (happiness, affection, ...)
         ~1161 TICKLE             tap-burst detection
         ~1192 HOURLY CLOCK       time-of-day awareness
         ~1215 STRESS CHECK       cross-module stress poll
         ~2378 PERSONALITY        tsundere/silly/grumpy/shy/angry/normal
         ~3917 EMOTIONS           Plutchik primaries, scheduleEmotionalFollowup
         ~4215 AFFINITY           +/- 100 relationship score
         ~10120 BOND XP           leveling, costume unlocks
         ~10773 GACHA             daily card pulls, collection
         ~v18.26 TRIGGER DISPATCH processInteraction() — single funnel for all 5

       MEMORY
         ~747  MEMORY NODES       deposit/recall
         ~771  MEMORY PALACE      7 Roman rooms
         ~11080 MEMORY DEX        Pokemon-style grid

       BEHAVIOR + AWARENESS
         ~3339 AWARENESS          operational poll, behavior sensors, synth tick
         ~5976 RANDOM BEHAVIORS   idle drift, ambient mood, time-aware greetings
         ~6144 MOVE / SCORE       reposition when content obscured
         ~6571 MISCHIEF           view-aware pokes (equipment, clean, board...)
         ~6788 BORED MISCHIEF     PRD-controlled, fires when idle 60s+
         ~10239 SULKING           Duolingo-style after extended absence
         ~10382 LESSONS           smug condescending teaching mode

       UI SURFACES
         ~4113 CAPABILITY MENU    "What I Am" — world model + active/passive caps
         ~4330 AFFINITY MENU      relationship + likes/dislikes inspector
         ~4719 COSTUME MENU       wardrobe (hats + props + saved outfits)
         ~5894 LOGIN PEEK         first-time acceptance flow
         ~7009 GAME OVERLAY       container for 10 mini-games
         ~10826 GACHA OVERLAY     pull + collection
         ~10985 MEMORY DEX        collected memory types grid
         ~11290 COMMAND PALETTE   searchable shortcut sheet

       MINI-GAMES (~7669 → ~10116)
         ~7669  TAP               tap-the-target
         ~7791  CATCH             falling items
         ~8033  REACTION          stoplight reaction time
         ~8117  MEMORY            color sequence
         ~8260  FLAPPY            obstacle dodging
         ~8874  CANNON            angle-power projectile
         ~9223  SNAKE             grid-classic
         ~9402  BREAKER           brick break
         ~9682  COIN CATCH        catch the coin
         ~9872  ASTEROIDS         space shooter

       INPUT + HANDLERS
         ~5134 POINTER            click + drag
         ~5282 CLICK HANDLER      tap → bubble dispatch
         ~11399 GLOBAL LISTENERS  konami code, "hi clippy" voice

       PERSISTENCE
         ~4983 PREFERENCES        savePreferences (cloud-locked)
         ~10516 CLOUD STATE       collectLocalState upsert
         ~10605 STORAGE EVENTS    cross-tab sync via window.storage event

       AUDIO + VISUAL
         ~11217 SONG PLAYER       music player + DJ Trajan
         ~11464 PARTICLES         sparkle/confetti spawn
         ~11496 WEB AUDIO         tones, chimes, pitch synth

       STREAKS + DAYS
         ~11543 DAILY STREAK      day-over-day continuity
         ~11613 SPECIAL DAYS      holiday-aware greetings

       BOOT
         ~11667 INIT              the master init() flow
         ~11852 PUBLIC API        NX.clippy.* exports
     ══════════════════════════════════════════════════════════════════════ */


  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: STATE                                                          ║
  // ║ The shared state object. Every other module reads/writes properties.   ║
  // ║ v18.26 — see also state.timers, state.listeners, state.activeOverlays  ║
  // ║ added by the infrastructure block ~line 160.                           ║
  // ╚══════════════════════════════════════════════════════════════════════╝

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
    furious:       'is-furious',       // v18.37 — fire eyes + gritted teeth (kao)
    // v18.39 — kao set II (traced from the second reference sheet)
    guffaw:        'is-guffaw',        // wide arc eyes + huge notched laugh
    flirt:         'is-flirt',         // deep-U eyes + epsilon kiss
    blep:          'is-blep',          // arc eyes + cat-lips + tongue out
    peckish:       'is-peckish',       // glossy eyes + lip-licking curl
    delighted:     'is-delighted',     // high arcs + huge open D mouth
    squee:         'is-squee',         // >< + tall open squeal mouth
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


  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: v18.26 INFRASTRUCTURE                                          ║
  // ║ Central CFG (cooldowns, chances, intervals) + registries for timers,   ║
  // ║ listeners, observers, overlays + cloud-sync mutex + teardown.          ║
  // ║ This is the foundation everything else builds on. If you're hunting    ║
  // ║ a "Clippy keeps firing after I disabled him" bug, look at teardown().  ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  /* ════════════════════════════════════════════════════════════════════
     v18.26 — ARCHITECTURAL STABILIZATION

     Adds the tracking + locking + tuning infrastructure that the rest
     of the module had been missing. Purely additive in this drop:
     existing code keeps working; new helpers are wired into the
     highest-impact call sites only. Subsequent ships should migrate
     more call sites onto these helpers.

     What this gives you:
       • timer registry        — trackInterval/trackTimeout/clearAllTimers
                                 so disable() actually stops Clippy from
                                 firing. Plugs the ghost-behavior leak.
       • listener registry     — trackListener/removeAllListeners so
                                 init() can run twice without double-
                                 firing every reaction.
       • overlay manager       — openOverlay/closeOverlay/isOverlayOpen
                                 single source of truth for "is something
                                 visible right now." Stops bubble + palette
                                 + game from stacking on top of each other.
       • cloud sync lock       — withCloudLock() mutex so a cloudPull
                                 can't clobber an in-flight savePreferences.
       • CFG constants         — central knob for reaction chances and
                                 cooldowns. Tune via NX.clippy.tune({...})
                                 instead of hunting through 30 magic numbers.
       • public teardown() API — clears everything in one call, used by
                                 declineToJoin() so disabling actually works.
     ════════════════════════════════════════════════════════════════════ */

  /* Centralized tuning knobs. Override at runtime via NX.clippy.tune().
     Cooldowns are in ms. Chances are 0-1 (higher = more frequent).
     Default values match what was scattered as magic numbers across
     the prior implementation — no behavior change unless you tune. */
  const CFG = {
    cooldown: {
      react_button:      8000,   // wait this long after a button reaction
      react_modal:      12000,   // wait this long after a modal reaction
      react_submit:      8000,   // wait this long after a form-submit reaction
      bubble_min:        2000,   // floor for bubble auto-hide
    },
    chance: {
      react_button:      0.10,   // 10% chance to react to a button click
      react_modal:       0.20,   // 20% chance to react to a modal open
      react_scroll:      0.05,   // 5% chance to react to scroll burst
    },
    interval: {
      achievements:     30000,
      hourly_check:     60000,
      feelings_decay:   90000,
      stress_check:    300000,
      mood_weather:     30000,
      personality_pick: 3600000,
      affinity_decay:   3600000,
    },
  };

  /* Apply runtime tuning overrides. Shallow merges into CFG.cooldown,
     CFG.chance, CFG.interval. Unknown keys ignored. */
  function applyTuning(overrides) {
    if (!overrides || typeof overrides !== 'object') return;
    for (const group of ['cooldown', 'chance', 'interval']) {
      if (overrides[group] && typeof overrides[group] === 'object') {
        for (const k of Object.keys(overrides[group])) {
          if (k in CFG[group]) CFG[group][k] = overrides[group][k];
        }
      }
    }
  }

  /* ─── Timer registry ────────────────────────────────────────────────
     Every scheduled callback must go through one of these so disable()
     can clean up. Two queues: intervals (cleared via clearInterval) and
     timeouts (cleared via clearTimeout). Returns the handle for callers
     that want to clear it manually too. */
  state.timers = { intervals: [], timeouts: [] };

  function trackInterval(fn, ms) {
    const id = setInterval(fn, ms);
    state.timers.intervals.push(id);
    return id;
  }
  function trackTimeout(fn, ms) {
    const id = setTimeout(fn, ms);
    state.timers.timeouts.push(id);
    return id;
  }
  function clearAllTimers() {
    for (const id of state.timers.intervals) { try { clearInterval(id); } catch (_) {} }
    for (const id of state.timers.timeouts)  { try { clearTimeout(id);  } catch (_) {} }
    state.timers.intervals = [];
    state.timers.timeouts  = [];
    // Sweep EVERY named timer slot on state. Several self-rescheduling loops
    // (mischiefTimer, quirkTimer, _learnedTimer, _selfDrivenTimer, the
    // autonomous/bored-mischief chains) store their handle in a state field
    // and re-arm from raw setTimeout/setInterval — outside the registry. A
    // hardcoded slot list kept missing new ones and they woke up forever
    // after disable(). Instead: clear anything whose key ends in "Timer"
    // (case-insensitive) plus the known non-"Timer" handles, so a leak can't
    // survive just because someone forgot to register it.
    const slots = new Set(['moodTimer', 'blinkTimer', 'randomTimer', 'moveTimer', 'activeActionTimer']);
    for (const k of Object.keys(state)) {
      if (/timer$/i.test(k) && state[k] != null) slots.add(k);
    }
    for (const slot of slots) {
      if (state[slot] != null) { try { clearTimeout(state[slot]); clearInterval(state[slot]); } catch (_) {} state[slot] = null; }
    }
  }

  /* ─── Listener registry ─────────────────────────────────────────────
     Every long-lived listener that survives a single user interaction
     needs to go through trackListener so it can be unsubscribed on
     teardown. Especially important for document-level click/submit
     observers + MutationObservers. */
  state.listeners = []; // each entry: { target, event, fn, opts }
  state.observers = []; // each entry: MutationObserver

  function trackListener(target, event, fn, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(event, fn, opts);
    state.listeners.push({ target, event, fn, opts });
  }
  function trackObserver(observer) {
    if (observer) state.observers.push(observer);
    return observer;
  }
  function removeAllListeners() {
    for (const { target, event, fn, opts } of state.listeners) {
      try { target.removeEventListener(event, fn, opts); } catch (_) {}
    }
    for (const ob of state.observers) { try { ob.disconnect(); } catch (_) {} }
    state.listeners = [];
    state.observers = [];
  }

  /* ─── Overlay manager ───────────────────────────────────────────────
     Single source of truth for "is some Clippy-owned UI surface visible
     right now." Prevents the bubble + palette + game + dex stacking
     bug. Names are descriptive strings; checks use isOverlayOpen() with
     no arg ("anything open?") or with a specific name. */
  state.activeOverlays = new Set();

  function openOverlay(name) {
    if (!name) return;
    state.activeOverlays.add(name);
  }
  function closeOverlay(name) {
    if (!name) { state.activeOverlays.clear(); return; }
    state.activeOverlays.delete(name);
  }
  function isOverlayOpen(name) {
    if (!name) return state.activeOverlays.size > 0;
    return state.activeOverlays.has(name);
  }
  /* Returns true if ANY overlay is open EXCEPT the named one(s). Useful
     for "don't show a bubble if anything else is on screen, but it's ok
     if my own bubble is already showing and I want to replace it." */
  function isOtherOverlayOpen(...exclude) {
    if (!state.activeOverlays.size) return false;
    for (const n of state.activeOverlays) {
      if (!exclude.includes(n)) return true;
    }
    return false;
  }

  /* ─── Cloud sync lock ───────────────────────────────────────────────
     A simple counter mutex. cloudPush + cloudPull + savePreferences
     etc. all wrap themselves in withCloudLock(). When a pull is in
     flight, a push waits; when a push is in flight, a pull waits.
     Prevents the "DND setting reverts after save" race. */
  state.cloudLock = 0;
  state.cloudWaiters = [];

  async function withCloudLock(label, fn) {
    if (state.cloudLock > 0) {
      await new Promise(r => state.cloudWaiters.push(r));
    }
    state.cloudLock++;
    try {
      return await fn();
    } finally {
      state.cloudLock--;
      const next = state.cloudWaiters.shift();
      if (next) next();
    }
  }

  /* ─── Teardown ─────────────────────────────────────────────────────
     Public-facing cleanup. Called from declineToJoin (the "disable"
     button) and from anywhere else that wants to put Clippy to bed.
     Clears all timers + listeners + observers, closes all overlays.
     Resets initialized so a subsequent enable()→init() call rebuilds
     the shell + timers + listeners fresh instead of being short-
     circuited by the "already initialized" guard. */
  function teardown() {
    clearAllTimers();
    removeAllListeners();
    closeOverlay(); // close everything
    state.suppressed = false;
    state.activeAction = null;
    state.dancing = false;
    state.sulkActive = false;
    state.nxActionInstalled = false;  // so enable() reinstalls the global listener
    state.cloudSyncInited = false;    // so enable() restarts cloud sync
    state._contentAwarenessInstalled = false;  // so enable() re-arms overlay/in-the-way watch
    state._momentActive = false;      // never resume disabled mid-moment
    state.awareness = { _started: false };  // awareness loop can re-init
    // Remove the shell entirely so re-enable rebuilds from scratch
    // (avoids stale state on the SVG element after teardown).
    if (state.shell) {
      try { state.shell.remove(); } catch (_) {}
      state.shell = null;
    }
    if (state.host) {
      try { state.host.remove(); } catch (_) {}
      state.host = null;
    }
    state.bubble = null;
    state.palette = null;
    state.gameOverlay = null;
    state.dexOverlay = null;
    state.initialized = false;
  }

  /* Status snapshot for debugging — exposed via NX.clippy.getStatus(). */
  function getStatus() {
    return {
      enabled: state.enabled,
      suppressed: state.suppressed,
      booted: state.booted,
      activeOverlays: Array.from(state.activeOverlays),
      timers: { intervals: state.timers.intervals.length, timeouts: state.timers.timeouts.length },
      listeners: state.listeners.length,
      observers: state.observers.length,
      cloudLock: state.cloudLock,
    };
  }

  /* ── End v18.26 infrastructure ─────────────────────────────────── */


  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: TRIGGER DISPATCHER                                             ║
  // ║ v18.26 — single funnel for the five overlapping reward systems         ║
  // ║   feelings · emotion · affinity · bond XP · mood                       ║
  // ║                                                                        ║
  // ║ Previously, every interaction site (chat send, task complete, game     ║
  // ║ win, button click, etc.) called adjustFeeling + feel + adjustAffinity  ║
  // ║ + addBondXP + mood individually. ~50 sites, all slightly different,    ║
  // ║ impossible to tune coherently.                                         ║
  // ║                                                                        ║
  // ║ processInteraction(eventName, payload) is the single funnel. Each      ║
  // ║ event has a canonical reward signature defined in INTERACTION_REWARDS  ║
  // ║ below. Call sites stay legal — they can still invoke the underlying    ║
  // ║ functions — but new code should go through this dispatcher so the      ║
  // ║ five systems stay coordinated.                                         ║
  // ║                                                                        ║
  // ║ Defining new events: add a key to INTERACTION_REWARDS with the         ║
  // ║ feelings/emotions/affinity/bond/mood it should produce. Then call      ║
  // ║ processInteraction('your_event_name') anywhere that event happens.     ║
  // ║                                                                        ║
  // ║ Tunable at runtime via NX.clippy.tuneInteraction(name, partial).       ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  /* Canonical reward signatures. Each event names a coordinated change
     across the five systems. Missing fields mean "no change" for that
     system. Numbers are intentionally small — the prior code had many
     +10 bumps that compounded too fast; the unified table tunes them
     toward a slower, more meaningful curve. */
  const INTERACTION_REWARDS = {
    // ── Positive interactions ──
    chat_message_positive: { feelings: { happiness: +2, affection: +3, boredom: -3, curiosity: +2 }, emotion: { joy: +1 }, affinity: +1, bond: 1, mood: 'happy' },
    chat_message_neutral:  { feelings: { curiosity: +1, boredom: -2 }, bond: 1 },
    chat_message_negative: { feelings: { happiness: -2, affection: -1 }, emotion: { sadness: +1 }, affinity: -1 },
    task_completed:        { feelings: { happiness: +3, satisfaction: +4 }, emotion: { joy: +2 }, affinity: +2, bond: 3, mood: 'proud' },
    streak_continued:      { feelings: { happiness: +4, affection: +2 }, emotion: { joy: +3 }, affinity: +3, bond: 5, mood: 'sparkle' },
    game_win:              { feelings: { happiness: +3, satisfaction: +5 }, emotion: { joy: +3 }, affinity: +1, bond: 4, mood: 'celebrate' },
    game_loss_graceful:    { feelings: { satisfaction: +1 }, emotion: { joy: +1 }, bond: 1 },
    gacha_pull:            { feelings: { curiosity: +5, happiness: +2 }, emotion: { surprise: +2 }, bond: 2 },
    achievement_earned:    { feelings: { happiness: +5, satisfaction: +5 }, emotion: { joy: +4 }, affinity: +2, bond: 5, mood: 'sparkle' },
    tickle:                { feelings: { happiness: +3, affection: +1 }, emotion: { joy: +2 }, bond: 1, mood: 'happy' },
    name_set:              { feelings: { affection: +5, happiness: +3 }, affinity: +5, bond: 5, mood: 'happy' },
    button_clicked:        { feelings: { curiosity: +1 } },
    form_submitted:        { feelings: { happiness: +2, satisfaction: +2 }, bond: 2, mood: 'proud' },
    // ── Neutral / probe ──
    modal_opened:          { feelings: { curiosity: +1 } },
    search_focused:        { feelings: { curiosity: +1 }, mood: 'determined' },
    // ── Negative / withdrawal ──
    user_ignored_24h:      { feelings: { happiness: -3, boredom: +4 }, emotion: { sadness: +2 }, affinity: -2, mood: 'sad' },
    user_ignored_72h:      { feelings: { happiness: -5, boredom: +8 }, emotion: { sadness: +4 }, affinity: -5, mood: 'sad' },
    dismissed_repeatedly:  { feelings: { happiness: -2 }, emotion: { sadness: +1 }, affinity: -1 },
  };

  /* Allow runtime override of an interaction's reward signature. Useful
     for tuning if Clippy feels "too generous" or "too stingy" with bond
     XP at a particular event. Shallow-merges into the existing entry. */
  function tuneInteraction(eventName, partial) {
    if (!INTERACTION_REWARDS[eventName]) {
      INTERACTION_REWARDS[eventName] = {};
    }
    Object.assign(INTERACTION_REWARDS[eventName], partial);
  }

  /* The single funnel. Routes one named event through all five reward
     systems coherently. Each system's underlying function (adjustFeeling,
     feel, etc.) is called only if defined — the dispatcher is safe to
     invoke even before init() has wired up the systems. Returns the
     applied reward signature so callers can introspect (e.g. show a
     "+2 affection" toast). */
  function processInteraction(eventName, payload) {
    payload = payload || {};
    const reward = INTERACTION_REWARDS[eventName];
    if (!reward) {
      // Unknown event — log but don't throw, so call sites that
      // typo an event name still work (just become no-ops).
      if (typeof console !== 'undefined') console.warn('[clippy] unknown interaction:', eventName);
      return null;
    }
    try {
      // 1) Feelings (8 gauges 0-100)
      if (reward.feelings && typeof adjustFeeling === 'function') {
        for (const [gauge, delta] of Object.entries(reward.feelings)) {
          adjustFeeling(gauge, delta);
        }
      }
      // 2) Emotion (Plutchik primaries)
      if (reward.emotion && typeof feel === 'function') {
        for (const [emotion, intensity] of Object.entries(reward.emotion)) {
          feel(emotion, intensity);
        }
      }
      // 3) Affinity (+/- 100 relationship score)
      if (reward.affinity != null && typeof adjustAffinity === 'function') {
        adjustAffinity(reward.affinity, eventName);
      }
      // 4) Bond XP (leveling)
      if (reward.bond != null && typeof addBondXP === 'function') {
        addBondXP(reward.bond);
      }
      // 5) Mood (visible expression, brief)
      if (reward.mood && typeof mood === 'function' && !state.suppressed) {
        const duration = payload.moodDuration || 3000;
        mood(reward.mood, duration);
      }
    } catch (e) {
      console.warn('[clippy] processInteraction failed for', eventName, e);
    }
    return reward;
  }

  /* Unified relationship snapshot. Combines the five systems into a
     single human-readable summary. Useful for the affinity menu, the
     "What I Am" panel, and for debugging "how does Clippy feel about
     me right now?" without checking five different places. */
  function getRelationshipState() {
    const snap = { systems: {} };
    try {
      if (typeof getEmotionSnapshot === 'function') snap.systems.emotion  = getEmotionSnapshot();
      if (typeof getAffinityScore === 'function')   snap.systems.affinity = getAffinityScore();
      if (typeof getBondLevel === 'function')       snap.systems.bond     = getBondLevel();
      if (typeof getBondXP === 'function')          snap.systems.bondXP   = getBondXP();
      if (state.feelings)                           snap.systems.feelings = Object.assign({}, state.feelings);
      if (state.activeMood)                         snap.systems.mood     = state.activeMood;
    } catch (e) { /* best-effort */ }

    // Derived overall score: -100 (terrible) to +100 (devoted).
    // Affinity is the primary signal; bond level adds permanence;
    // happiness gauge adds short-term warmth. Capped to range.
    let overall = 0;
    if (snap.systems.affinity != null) overall += snap.systems.affinity;
    if (snap.systems.bond != null)     overall += (snap.systems.bond.level || 0) * 3;
    if (snap.systems.feelings && snap.systems.feelings.happiness != null) {
      overall += (snap.systems.feelings.happiness - 50) / 4;
    }
    snap.overall = Math.max(-100, Math.min(100, Math.round(overall)));

    // Human-readable label
    if (snap.overall >= 80)      snap.label = 'devoted';
    else if (snap.overall >= 50) snap.label = 'fond';
    else if (snap.overall >= 20) snap.label = 'warm';
    else if (snap.overall >= -20) snap.label = 'neutral';
    else if (snap.overall >= -50) snap.label = 'distant';
    else                          snap.label = 'cold';
    return snap;
  }

  /* ── End v18.26 trigger dispatcher ─────────────────────────────── */


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
    return withCloudLock('push', async () => {
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
    });
  }

  async function cloudPull() {
    return withCloudLock('pull', async () => {
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
    });
  }

  // Debounced push — accumulate changes, sync at most every 8 seconds
  function cloudPushQueued() {
    state.preferences.last_local_write = Date.now();
    if (state.cloudPushTimer) clearTimeout(state.cloudPushTimer);
    state.cloudPushTimer = setTimeout(() => cloudPush(), 8000);
  }

  // ─── CLIPPY HIVE — one shared mind across the web + desktop copies ──────
  // Reads/writes the `clippy_sync` Supabase table (id='hive_notes', a rolling
  // list of short "I did/learned X" notes). The ClippyPC desktop buddy speaks
  // the same table (Downloads/ClippyPC/NEXUS-CLIPPY-HANDOFF.md), so a note the
  // in-app Clippy posts is heard by the desktop one and vice-versa. Best-
  // effort: never blocks, degrades silently if the table/RLS isn't set up.
  const HIVE_KEY = 'hive_notes';
  function hiveId() {
    let id = null;
    try { id = localStorage.getItem('nx_clippy_hive_id'); } catch (_) {}
    if (!id) {
      id = 'web_' + Math.random().toString(36).slice(2, 9);
      try { localStorage.setItem('nx_clippy_hive_id', id); } catch (_) {}
    }
    return id;
  }
  async function hivePull() {
    if (!window.NX || !NX.sb) return state.hiveNotes || [];
    try {
      const { data } = await NX.sb.from('clippy_sync')
        .select('data').eq('id', HIVE_KEY).maybeSingle();
      const notes = (data && Array.isArray(data.data)) ? data.data : [];
      state.hiveNotes = notes;
      return notes;
    } catch (_) { return state.hiveNotes || []; }
  }
  async function hivePush(text, kind) {
    if (!window.NX || !NX.sb || !text) return;
    try {
      const notes = await hivePull();   // read-modify-write (low-traffic table)
      const entry = {
        from: hiveId(), kind: kind || 'note',
        text: String(text).slice(0, 240), at: new Date().toISOString(),
      };
      const next = [...notes, entry].slice(-40);   // rolling, capped
      await NX.sb.from('clippy_sync')
        .upsert({ id: HIVE_KEY, data: next, from_id: hiveId() }, { onConflict: 'id' });
      state.hiveNotes = next;
    } catch (_) { /* hive is best-effort */ }
  }
  async function hiveInit() {
    if (state.hiveInited) return;
    state.hiveInited = true;
    const notes = await hivePull();
    // Greet with what ANOTHER copy (e.g. the desktop Clippy) has been up to.
    const fromOthers = notes.filter(n => n && n.from && n.from !== hiveId()).slice(-1)[0];
    if (fromOthers && state.enabled) {
      setTimeout(() => {
        if (!state.bubble && state.enabled) {
          bubble('Across your devices: ' + fromOthers.text, { autoHide: 4200, eyebrow: '☁ HIVE' });
        }
      }, 3200);
    }
    // Tell the hive the in-app Clippy is online so the desktop one knows.
    hivePush('In-app Clippy came online (web).', 'presence');
    // Re-pull occasionally so cross-device notes trickle in over a session.
    trackInterval(hivePull, 4 * 60000);
  }
  // Public surface so app code (and the in-app Clippy's own actions) can post
  // to the shared mind: NX.clippyHive.push('learned the walk-in is down').
  if (window.NX) {
    window.NX.clippyHive = {
      pull: hivePull,
      push: hivePush,
      notes: () => state.hiveNotes || [],
      id: hiveId,
    };
  }

  function initCloudSync() {
    if (state.cloudSyncInited) return;
    state.cloudSyncInited = true;
    hiveInit();   // join the shared Clippy hive (web ↔ desktop)
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
    // v18.26 — connectivity listeners + safety-net interval all tracked
    // so teardown can detach them cleanly.
    trackListener(window, 'online', () => {
      showSyncIndicator('syncing', '☁ back online');
      if (state.cloudPushPending) cloudPush();
    });
    trackListener(window, 'offline', () => {
      showSyncIndicator('failed', '☁ offline');
    });
    // Periodic push (safety net for missed debounce)
    trackInterval(() => {
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
    // DEFAULT TO HIS OWN LINES: when Clippy has self-written lines for this
    // moment, prefer them over the hand-written corpus (he authors himself).
    if (state.selfAuthored !== false) {
      const own = state.learned && state.learned[poolKey];
      if (own && own.length && Math.random() < 0.75) {
        const hist = state.poolHistory[poolKey] || [];
        const fresh = own.filter(l => !hist.includes(l));
        const src = fresh.length ? fresh : own;
        const pick = src[Math.floor(Math.random() * src.length)];
        state.poolHistory[poolKey] = [pick, ...hist].slice(0, 100);
        persistPoolHistory();
        return substituteVars(pick);
      }
    }
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
      // ── His soul's own memories (clippy-soul.js) ──
      case 'dream':            return 'lararium';       // the household shrine — dreams are numinous
      case 'awakening':        return 'atrium';         // the threshold — each rebirth enters here
      case 'feeling':          return 'triclinium';     // the heart-room
      case 'reverie':          return 'peristylium';    // the garden — wandering thoughts
      case 'vision':           return 'bibliotheca';    // what he sees, filed as knowledge
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


  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: FEELINGS                                                       ║
  // ║ The 8-gauge offline feelings model. Each gauge 0-100, persistent.      ║
  // ║ This is reward system 1 of 5. Modify via adjustFeeling() — or better,  ║
  // ║ via processInteraction() which coordinates all five.                   ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // ════════════════════════════════════════════════════════════════════
  // v17.10 OFFLINE INTELLIGENCE — feelings, tickle, clock, stress, dance
  //   Everything runs locally. No network calls. He FEELS smart because
  //   he tracks a dozen signals and responds contextually. Pattern-based
  //   pseudo-intelligence — fast, private, reliable.
  // ════════════════════════════════════════════════════════════════════

  // ─── FEELINGS MODEL ────────────────────────────────────────────────
  // v18.1: 8 gauges (was 5). Each 0-100, persistent across sessions.
  // Update from user behavior — interactions, idle, time, etc. The
  // dominant feeling shapes mood expression + pool selection. The user
  // never SEES the numbers; they just feel the personality shift.
  //
  // CHANGES FROM v17.10:
  //   • Baseline happiness 60 → 55 (slightly more earned)
  //   • Baseline affection 50 → 45 (must invest to reach loving)
  //   • Decay target 50 → 45 (mild pessimism without being grumpy)
  //   • +curiosity (rises with new topics, drops with repetition)
  //   • +boredom (rises with repetitive interactions, decays on novelty)
  //   • +confidence (rises with task completion, errors knock it)
  //   • adjustFeeling now applies diminishing returns above 70 happiness
  //   • dailyMoodOffset: deterministic per-day ±5 happiness baseline
  function defaultFeelings() {
    return {
      happiness:      55,
      energy:         55,
      affection:      45,
      attention_need: 0,
      ticklish:       0,
      curiosity:      55,   // v18.1
      boredom:        25,   // v18.1
      confidence:     45,   // v18.1
    };
  }
  // Deterministic per-calendar-day offset to baseline happiness.
  // Some days Trajan wakes up cheerier than others; some days grumpier.
  // No randomness — same answer all day, changes at midnight local.
  function getDailyMoodOffset() {
    const d = new Date();
    const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    // FNV-1a-ish hash → 0..1 → -6..+6
    let h = 2166136261;
    const s = String(key);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    const norm = (h % 1000) / 1000;     // 0..1
    return Math.round((norm - 0.5) * 12); // -6..+6
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
  // v18.1: diminishing returns on POSITIVE happiness/affection gains so
  // it's harder to reach the top end. Negatives apply at full force —
  // bad days cost more than good ones reward. This is the "earned, not
  // given" curve.
  function adjustFeeling(key, delta) {
    if (!state.feelings) loadFeelings();
    let actual = delta;
    if (delta > 0 && (key === 'happiness' || key === 'affection')) {
      const cur = state.feelings[key] || 0;
      if (cur > 85)      actual = delta * 0.20;
      else if (cur > 75) actual = delta * 0.40;
      else if (cur > 65) actual = delta * 0.65;
    }
    // Confidence and curiosity are also dampened at the top but less so
    if (delta > 0 && (key === 'curiosity' || key === 'confidence')) {
      const cur = state.feelings[key] || 0;
      if (cur > 85)      actual = delta * 0.35;
      else if (cur > 75) actual = delta * 0.55;
    }
    state.feelings[key] = Math.max(0, Math.min(100, (state.feelings[key] || 0) + actual));
    saveFeelings();
  }
  // Returns the dominant emotional state — drives behavior choices.
  // v18.1: stricter thresholds for high-end states. Overjoyed now requires
  // BOTH happiness 88+ AND energy 60+ (was just happiness 80). Adds new
  // states: bored, curious, confident.
  function dominantFeeling() {
    if (!state.feelings) loadFeelings();
    const f = state.feelings;
    if (f.ticklish > 50)                                          return 'ticklish';
    if (f.attention_need > 70)                                    return 'lonely';
    if (f.happiness < 25)                                         return 'sad';
    if (f.happiness >= 88 && f.energy >= 60)                      return 'overjoyed';
    if (f.energy < 25)                                            return 'tired';
    if (f.affection >= 85)                                        return 'loving';
    if (f.boredom >= 70 && f.curiosity < 50)                      return 'bored';
    if (f.curiosity >= 80 && f.boredom < 50)                      return 'curious';
    if (f.confidence >= 80 && f.happiness >= 60)                  return 'confident';
    if (f.happiness >= 70 && f.affection >= 60)                   return 'content';
    return 'neutral';
  }
  // Periodic decay: feelings drift toward baseline when nothing happens.
  // v18.1 changes:
  //   • Target is 45, not 50 (slight pessimism — must engage to feel good)
  //   • Above 70, happiness decays 2× faster (peaks are temporary)
  //   • Boredom rises with idle time
  //   • Curiosity decays when nothing interesting has happened
  //   • Apply dailyMoodOffset (±6) to the happiness target ONLY
  function decayFeelings() {
    if (!state.feelings) loadFeelings();
    const idle = Date.now() - (state.lastInteractionAt || Date.now());
    const minutes = idle / 60000;
    if (minutes > 2) adjustFeeling('attention_need', +2);
    if (minutes > 5) adjustFeeling('happiness', -1);
    if (minutes > 10) adjustFeeling('affection', -1);
    if (minutes > 4) adjustFeeling('boredom', +1.5);
    if (minutes > 6) adjustFeeling('curiosity', -1);
    if (minutes > 8) adjustFeeling('confidence', -0.5);
    // Gentle pull toward target. Target = 45 (mild pessimism) +
    // dailyMoodOffset for happiness only.
    const dailyOff = getDailyMoodOffset();
    const targetHappy = 45 + dailyOff;
    const targets = {
      happiness:  targetHappy,
      energy:     45,
      affection:  45,
      curiosity:  50,
      confidence: 45,
      boredom:    25,
    };
    Object.keys(targets).forEach(k => {
      const v = state.feelings[k];
      if (v == null) return;
      const target = targets[k];
      // Faster decay from extreme happiness
      const speed = (k === 'happiness' && v > 70) ? 1.0 : 0.5;
      if (v > target) adjustFeeling(k, -speed);
      else if (v < target) adjustFeeling(k, +speed * 0.7);   // climb back slower than fall
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
    bubble(pickFromPool('tickle_response'), { autoHide: 3500, eyebrow: 'TICKLE' });
    spawnParticles({ count: 10, type: 'heart' });
    playTone('mwah');
    // Tickle-specific gauges that the generic dispatcher doesn't know
    // about. The dispatcher handles happiness/affection/joy/bond/mood;
    // these two are unique to tickling.
    adjustFeeling('ticklish', +50);
    adjustFeeling('attention_need', -30);
    // v18.26 — unified dispatch for the standard reward bump
    processInteraction('tickle', { moodDuration: 4500 });
    // v18.37 — three tickle-attacks inside ~8s: the fire eyes come out.
    const _now = Date.now();
    state._tickleRuns = (_now - (state._lastTickleAt || 0) < 8000) ? (state._tickleRuns || 0) + 1 : 1;
    state._lastTickleAt = _now;
    if (state._tickleRuns >= 3) { state._tickleRuns = 0; setTimeout(() => mood('furious', 3200), 600); }
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
      response: () => `I'm Clippy! A glowing little orb. I serve Trajan and Providentia, and I look after ${state.preferences.user_name || 'you'}. Bzzt.`,
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

  // ════════════════════════════════════════════════════════════════════
  // v18.1 CHEF & SOMMELIER — structured offline knowledge
  //
  //   Pattern matchers + lookup tables for cooking technique, temperatures,
  //   knife use, and wine pairings. No network, no LLM. Every response
  //   draws from local dialog pools (clippy-dialog.json) or these tables.
  //   Goal: feel like a real chef + sommelier in a 9 KB script.
  //
  //   Dispatch shape:
  //     • Specific lookups (wine pairing for X, technique for Y) → custom
  //       respond() that consults the table + falls back to a pool
  //     • Generic topic keywords (kitchen, wine, sommelier) → tagged pool
  //
  //   Tables are deliberately phrase-keyed so they're easy to grow.
  // ════════════════════════════════════════════════════════════════════

  // Wine pairings keyed by food. Synonyms map to canonical keys below.
  const WINE_PAIRINGS = {
    steak:        'Cabernet Sauvignon, Malbec, or Syrah. Tannin cuts the marbled fat. Napa Cab is the safe choice; Argentine Malbec is the fun one.',
    beef:         'Cabernet, Malbec, or Syrah. Reds with structure. If it\'s slow-braised, Barolo or Brunello — earth meets earth.',
    burger:       'Zinfandel or Malbec. Big juicy fruit for big juicy fat. A cold Lambrusco is the dark-horse pick.',
    lamb:         'Rioja Reserva, Bordeaux, or Châteauneuf-du-Pape. Earthy enough to meet the gaminess. Mint? Try Cabernet Franc.',
    pork:         'Pinot Noir for roasts, Riesling (off-dry) for chops with sauce. The fat-acid dance.',
    bacon:        'Crémant or dry Riesling. Bubbles cut salt. Or a chilled Beaujolais if you\'re committing.',
    chicken:      'Roast chicken: oaked Chardonnay. Braised: Pinot Noir. Fried: Champagne — yes, really.',
    poultry:      'Match the cooking method: roast wants oaked Chardonnay, braised wants Pinot Noir, smoked wants Zinfandel.',
    duck:         'Pinot Noir from Burgundy. Cherry and earth, meet duck fat. Confit? Older Burgundy or Côtes du Rhône.',
    turkey:       'Pinot Noir or Beaujolais Cru. Don\'t outweight the bird. Gewürz also works for spiced stuffing.',
    fish:         'Sauvignon Blanc, Albariño, or Muscadet. Bright acid for delicate flesh.',
    salmon:       'Pinot Noir, surprisingly — or oaked Chardonnay. Salmon punches above its weight; light reds work.',
    tuna:         'Provence rosé or light Pinot Noir. Tuna is closer to "meat" than "fish."',
    halibut:      'Chablis or unoaked Chardonnay. Halibut is delicate — don\'t bury it.',
    cod:          'Albariño or dry Riesling. Salt-cod (bacalao): Vinho Verde.',
    shellfish:    'Muscadet, Chablis, Champagne, or Albariño. Cold, mineral, briny. Match the brine.',
    oyster:       'Muscadet sur Lie. Chablis. Champagne brut nature. Mineral wins.',
    oysters:      'Muscadet sur Lie. Chablis. Champagne brut nature. Mineral wins.',
    lobster:      'White Burgundy or vintage Champagne. Butter wants oak and bubbles.',
    crab:         'Riesling Kabinett or Albariño. Sweet meat, off-dry acidity.',
    shrimp:       'Sauvignon Blanc or Grüner Veltliner. If garlic-heavy, lean drier.',
    scallop:      'Chardonnay (lightly oaked) or Champagne. Brown butter loves both.',
    scallops:     'Chardonnay (lightly oaked) or Champagne. Brown butter loves both.',
    sushi:        'Champagne, Grüner Veltliner, or junmai sake. Skip tannic reds; they fight soy.',
    pasta:        'Italian wine for Italian food. Red sauce: Chianti, Sangiovese, Barbera. Cream: Verdicchio, Soave. Pesto: Vermentino.',
    pizza:        'Sangiovese, Aglianico, or a cold lager. Truth: pizza forgives almost everything.',
    risotto:      'White Burgundy for mushroom; Barolo for truffle; Pinot Grigio for seafood. Match the dominant.',
    truffle:      'Barolo or aged Burgundy. Earth meets earth. Don\'t bring a tannic young red — it fights the perfume.',
    mushroom:     'Pinot Noir, Nebbiolo, or Beaujolais Cru. Forest floor harmony.',
    cheese:       'By style: hard aged → red (Rioja Gran Reserva, Bordeaux); soft bloom → Champagne or Sancerre; blue → Sauternes, Port, or sweet Riesling. The rule: salty wants sweet.',
    chocolate:    'Banyuls (the cheat code), Port, or Amarone. Bittersweet meets bittersweet. Skip Cabernet — too tannic.',
    dessert:      'Sauternes, late-harvest Riesling, or Tokaji. The wine must always be sweeter than the dessert. Always.',
    cake:         'Moscato d\'Asti for fruit cakes. Madeira for nut cakes. Champagne demi-sec for wedding cake.',
    chili:        'Off-dry Riesling, Zinfandel (high alcohol balances heat), or a cold Pilsner. Spice cools with sugar, not tannin.',
    curry:        'Off-dry Riesling or Gewürztraminer. Aromatic for aromatic. Heavy reds will burn.',
    thai:         'Riesling, Gewürztraminer, or Grüner. The trinity for Thai food. Beer is also legitimate.',
    indian:       'Riesling for korma, Shiraz for vindaloo, Gewürz for tikka. Tannic Bordeaux is a mistake here.',
    bbq:          'Zinfandel, Shiraz, or Malbec. Big fruit meets smoke. Brisket = Cab. Pulled pork = Riesling, surprise.',
    ramen:        'Junmai sake, Riesling, or a clean Pilsner. Pork broth needs acid, not tannin.',
    burrata:      'Vermentino, Falanghina, or rosé. Stone fruit notes meet fresh dairy.',
    charcuterie:  'Beaujolais, dry Lambrusco, or fino Sherry. Salty cured meat wants bright fruit.',
    salad:        'Sauvignon Blanc, Vinho Verde, or rosé. But: vinegar-heavy dressings fight ALL wine. Lemon-dressed only.',
    soup:         'Fino or Manzanilla Sherry. Especially clear broths. Pair the savory.',
    vegetable:    'Grüner Veltliner is the green-vegetable specialist. Beaujolais for roasted; rosé for grilled.',
    vegetarian:   'Grüner, Beaujolais Cru, Pinot Noir — forgiving versatility. Heavy tannin clashes with vegetal bitterness.',
    egg:          'Champagne for omelette. Pinot Blanc for quiche. Eggs and wine are tricky — bubbles help.',
    omelette:     'Champagne or Crémant. Eggs coat the palate — bubbles scrub it.',
    foie:         'Sauternes is the textbook. Tokaji also. Late-harvest Pinot Gris is the dark horse.',
    caviar:       'Brut Champagne. Iced vodka if you\'re committing. Anything else fights the salt.',
  };
  // Synonyms → canonical pairing key
  const WINE_PAIRING_SYNONYMS = {
    'rib eye':'steak','ribeye':'steak','filet':'steak','sirloin':'steak','wagyu':'steak','t-bone':'steak','tomahawk':'steak',
    'cow':'beef','brisket':'beef','short rib':'beef','prime rib':'beef',
    'cheeseburger':'burger','hamburger':'burger',
    'rack of lamb':'lamb','lamb chop':'lamb',
    'pork chop':'pork','pork belly':'pork','tenderloin':'pork',
    'roast chicken':'chicken','fried chicken':'chicken','chicken thigh':'chicken','chicken breast':'chicken',
    'thanksgiving':'turkey',
    'salmon fillet':'salmon','seared salmon':'salmon',
    'ahi':'tuna','sashimi':'sushi',
    'mussels':'shellfish','clams':'shellfish','prawns':'shrimp','langoustine':'shrimp',
    'fettuccine':'pasta','spaghetti':'pasta','linguine':'pasta','tagliatelle':'pasta','rigatoni':'pasta','carbonara':'pasta','alfredo':'pasta',
    'porcini':'mushroom','morel':'mushroom','chanterelle':'mushroom','shiitake':'mushroom',
    'cheddar':'cheese','parmesan':'cheese','parmigiano':'cheese','manchego':'cheese','gruyère':'cheese','gruyere':'cheese',
    'brie':'cheese','camembert':'cheese','goat cheese':'cheese','chèvre':'cheese','chevre':'cheese',
    'gorgonzola':'cheese','roquefort':'cheese','stilton':'cheese','blue cheese':'cheese',
    'dark chocolate':'chocolate','milk chocolate':'chocolate','flourless':'chocolate',
    'tiramisu':'dessert','crème brûlée':'dessert','creme brulee':'dessert','panna cotta':'dessert','sorbet':'dessert',
    'pad thai':'thai','tom yum':'thai','green curry':'curry','red curry':'curry','massaman':'curry',
    'butter chicken':'indian','tikka':'indian','vindaloo':'indian','biryani':'indian',
    'ribs':'bbq','pulled pork':'bbq','smoked':'bbq',
    'foie gras':'foie',
  };
  // Wine variety descriptions for "what is X" queries
  const WINE_VARIETALS = {
    'pinot noir':       'Pinot Noir — the heartbreak grape. Thin-skinned, terroir-revealing, all about elegance. Burgundy is its home; Oregon is the New World champion.',
    'cabernet':         'Cabernet Sauvignon — the king. Tannic, structured, ages 20+ years. Napa for new-world ripeness, Bordeaux Left Bank for restraint.',
    'cabernet sauvignon':'Cabernet Sauvignon — the king. Tannic, structured, ages 20+ years. Napa for new-world ripeness, Bordeaux Left Bank for restraint.',
    'merlot':           'Merlot — wrongly maligned by one movie. Soft, plush, plum-and-chocolate. Right Bank Bordeaux (Pomerol, Saint-Émilion) makes the world\'s greatest.',
    'chardonnay':       'Chardonnay — the most planted white. Steel-tank Chablis to oaked Meursault: the same grape behaves differently in every soil.',
    'sauvignon blanc':  'Sauvignon Blanc — grass, gooseberry, grapefruit. Sancerre is the elegant version; Marlborough (New Zealand) is the loud one.',
    'riesling':         'Riesling — the world\'s most age-worthy white grape. Mosel for ethereal; Alsace for dry; Australia (Eden Valley) for lime-and-petrol drama.',
    'syrah':            'Syrah — black pepper, smoke, blueberry. Northern Rhône (Côte-Rôtie, Hermitage) shows what it can do. Australians call it Shiraz.',
    'shiraz':           'Shiraz is just Syrah, Australian-style. Bigger, riper, more chocolate. Barossa Valley is the headquarters.',
    'malbec':           'Malbec — moved from Bordeaux to Argentina and became famous. Mendoza altitude gives it both ripeness and bright acid.',
    'pinot grigio':     'Pinot Grigio (Italy) and Pinot Gris (Alsace) are the same grape, different aspirations. Italy = crisp and clean; Alsace = rich and spiced.',
    'gewürztraminer':   'Gewürztraminer — lychee, rose petal, ginger. Pairs with food other wines flee from: spicy Asian, smoked salmon, Munster cheese.',
    'grüner veltliner': 'Grüner Veltliner — Austria\'s national grape. White pepper, lentil, lime. The world\'s best vegetable wine.',
    'gruner veltliner': 'Grüner Veltliner — Austria\'s national grape. White pepper, lentil, lime. The world\'s best vegetable wine.',
    'champagne':        'Champagne — the only sparkling wine that can legally be called Champagne. Method: secondary fermentation in bottle. Houses vs. growers — drink growers.',
    'prosecco':         'Prosecco — fresh, fruity, made by tank method. Easier, more affordable, doesn\'t pretend to be Champagne.',
    'sangiovese':       'Sangiovese — Tuscany\'s grape. Cherry, tobacco, leather. Chianti Classico, Brunello, Vino Nobile — same grape, different villages.',
    'nebbiolo':         'Nebbiolo — Barolo and Barbaresco. Tar and roses. Pale color, monstrous tannin. Needs 10+ years.',
    'tempranillo':      'Tempranillo — Spain\'s grape. Rioja in its homeland; Ribera del Duero for the powerful version. Leather, vanilla, dried cherry.',
    'zinfandel':        'Zinfandel — California claim to fame, genetically identical to Italian Primitivo. Big, jammy, peppery. Goes with BBQ like nothing else.',
    'rosé':             'Rosé — made by limited skin contact with red grapes. Provence is the gold standard. Drink it cold and young.',
    'rose':             'Rosé — made by limited skin contact with red grapes. Provence is the gold standard. Drink it cold and young.',
    'sake':             'Sake — rice wine, technically rice beer. Junmai is purest. Daiginjō is the most polished. Serve chilled for top grades.',
    'sherry':           'Sherry — fortified white from Jerez. Fino and Manzanilla are dry, briny, perfect with food. Pedro Ximénez is dessert in a glass.',
    'port':             'Port — fortified red from Portugal\'s Douro. Tawny for nuts and caramel; Vintage for cellar-aging.',
    'sauternes':        'Sauternes — Bordeaux\'s noble-rot sweet wine. Honey, apricot, beeswax. Pairs with foie gras and blue cheese.',
    'amarone':          'Amarone della Valpolicella — made from dried grapes. Concentrated, raisinated, 15%+ alcohol. Stew wine.',
    'barolo':           'Barolo — Nebbiolo from a tiny corner of Piedmont. The "wine of kings." Tar, roses, two-decade ageing. Patience required.',
    'burgundy':         'Burgundy (Bourgogne) — red is Pinot Noir, white is Chardonnay. Grand Cru < Premier Cru < Village < Régionale. Terroir is the religion.',
    'bordeaux':         'Bordeaux — blended reds (Cab, Merlot, Cab Franc) on Left Bank; Merlot-led on Right Bank. The 1855 classification still matters.',
  };

  function normalizeFood(s) {
    return s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim();
  }
  function lookupWinePairing(food) {
    const norm = normalizeFood(food);
    if (WINE_PAIRINGS[norm]) return WINE_PAIRINGS[norm];
    // synonym map
    for (const key of Object.keys(WINE_PAIRING_SYNONYMS)) {
      if (norm.includes(key)) return WINE_PAIRINGS[WINE_PAIRING_SYNONYMS[key]];
    }
    // word-token overlap
    const tokens = norm.split(/\s+/);
    for (const key of Object.keys(WINE_PAIRINGS)) {
      if (tokens.some(t => t === key || (t.length > 4 && key.startsWith(t)))) return WINE_PAIRINGS[key];
    }
    return null;
  }
  function lookupVarietal(text) {
    const norm = normalizeFood(text);
    for (const key of Object.keys(WINE_VARIETALS)) {
      if (norm.includes(key)) return WINE_VARIETALS[key];
    }
    return null;
  }

  // Cooking knowledge — keyword → tip. Many entries share keys for fuzziness.
  const COOKING_KNOWLEDGE = {
    'mise en place':     'Mise en place — "everything in its place." Prep, weigh, and arrange ALL ingredients before fire. It\'s half the cook.',
    'mise':              'Mise en place — "everything in its place." Prep all your ingredients before fire. It\'s half the cook.',
    'maillard':          'Maillard reaction — amino acids + reducing sugars + heat above 285°F. The brown crust on a steak, the crust on bread. It is not caramelization.',
    'caramelize':        'Caramelize — pure sugar browning, 320°F+. Slow, patient. Don\'t confuse with Maillard (which needs protein).',
    'caramelization':    'Caramelization — sugars decomposing to brown. Onions take 45 minutes, not 10. Anyone who says 10 is lying.',
    'sear':              'Sear — high heat, dry surface, 2-3 minutes per side. The pan must be screaming hot. Don\'t move the meat until it releases.',
    'braise':            'Braise — sear first, then long simmer in liquid that doesn\'t fully cover the protein. Low and slow. 2-3 hours minimum.',
    'sauté':             'Sauté — toss in hot fat. From "sauter," to jump. Pan must be hot enough that food doesn\'t crowd into a steam.',
    'saute':             'Sauté — toss in hot fat. From "sauter," to jump. Pan must be hot enough that food doesn\'t crowd into a steam.',
    'sous vide':         'Sous-vide — vacuum-seal, water-bath at precise temperature. Edge-to-edge doneness. Finish with a hot sear for crust.',
    'sous-vide':         'Sous-vide — vacuum-seal, water-bath at precise temperature. Edge-to-edge doneness. Finish with a hot sear for crust.',
    'reduce':            'Reduce — simmer to evaporate water, concentrate flavor. Always taste BEFORE seasoning. A reduction triples in saltiness.',
    'reduction':         'Reduction — simmer to evaporate water, concentrate flavor. Always taste BEFORE you season a reduction.',
    'deglaze':           'Deglaze — add wine/stock to a hot pan, scrape the fond. Those brown bits ARE the flavor.',
    'fond':              'Fond — the brown caramelized bits stuck to the pan. The foundation of every great pan sauce.',
    'roux':              'Roux — equal parts fat and flour, cooked. White roux for béchamel, blond for velouté, brown for gumbo. Patience changes the color.',
    'emulsion':          'Emulsion — fat in liquid, stabilized. Mayonnaise, hollandaise, vinaigrette. The secret is slow addition while whisking.',
    'hollandaise':       'Hollandaise — egg yolks + warm butter + lemon over double boiler. Breaks above 160°F. Save it with a splash of cold water if it splits.',
    'béarnaise':         'Béarnaise — hollandaise + tarragon and shallot reduction. The classic steak sauce. Knife-thin tarragon.',
    'bearnaise':         'Béarnaise — hollandaise + tarragon and shallot reduction. The classic steak sauce. Knife-thin tarragon.',
    'stock':             'Stock — bones (roasted for brown, raw for white), cold water start, never boil — only simmer. Six hours minimum.',
    'broth':             'Broth — like stock but flesh-based, shorter cook. Lighter, more delicate. Stock has gelatin; broth has flavor.',
    'risotto':           'Risotto wants attention, not heat. Toast the rice in butter, deglaze with wine, add hot stock a ladle at a time. Constant stirring.',
    'knife':             'Knife: pinch the blade between thumb and index, fingers curled. The handle is for control, not power. Sharp knives respect you.',
    'julienne':          'Julienne — matchsticks, 1/8 inch x 1/8 inch x 2 inches. Stack rectangles, slice down. Use it for stir-fry, salads.',
    'brunoise':          'Brunoise — 1/8 inch dice. Julienne first, then turn 90° and cut across. The smallest classical cut.',
    'chiffonade':        'Chiffonade — stack leaves, roll tight like a cigar, slice across. Ribbons. Basil, mint, sorrel.',
    'mirepoix':          'Mirepoix — onion 2, carrot 1, celery 1 (by weight). The aromatic base of French cooking. Sweat low, never brown.',
    'sofrito':           'Sofrito — onion, garlic, peppers, tomato, slow-cooked in olive oil. The Spanish/Caribbean mirepoix.',
    'soffritto':         'Soffritto — Italian: onion, carrot, celery in olive oil, cooked LOW until soft and sweet. Forty minutes if you mean it.',
    'tempering':         'Tempering eggs — drizzle hot liquid into eggs while whisking. Stops them from scrambling when added to a sauce.',
    'blanch':            'Blanch — drop in heavily salted boiling water for seconds, then shock in ice. Sets color, halts cooking.',
    'poach':             'Poach — bare ripple in liquid, never a bubble. 160-180°F. Eggs, fish, fruit. Gentle is the whole game.',
    'confit':            'Confit — slow-cook in fat, low heat (200°F), long time. Duck legs, garlic, tomatoes. Pure indulgence.',
    'cure':              'Cure — salt (and often sugar) draws moisture out of protein. Days for gravlax, weeks for prosciutto. Patience pays.',
    'brine':             'Brine — salt water (sometimes with sugar, aromatics). Use 4 hours minimum, 24 best for whole birds. Magic for poultry.',
    'pickle':            'Pickle — vinegar + salt + sugar + spice. Quick pickle is hot brine over veg, refrigerator 24h. Fermented pickle is salt + time.',
    'rest':              'Resting meat — 5 minutes per inch of thickness. Juices redistribute. Cutting too soon = bloody plate, dry meat.',
    'carryover':         'Carryover cooking — internal temp rises 5-10°F after pulling. Pull EARLY. Always.',
    'butterfly':         'Butterfly — slice horizontally without cutting through. Open like a book. Doubles surface, halves cook time.',
    'truss':              'Truss — tie up a bird so legs hug the body. Even cooking, retains shape, looks professional.',
    'fold':              'Fold — gentle mixing to preserve air. Cut down with the spatula, sweep across the bottom, fold over the top. Quarter turn.',
    'crème fraîche':     'Crème fraîche — cultured cream. Won\'t break when heated, unlike sour cream. Use in pan sauces.',
    'creme fraiche':     'Crème fraîche — cultured cream. Won\'t break when heated, unlike sour cream. Use in pan sauces.',
    'demi-glace':        'Demi-glace — espagnole sauce + brown stock, reduced by half. Days of work, mahogany result. Restaurant magic.',
    'demi glace':        'Demi-glace — espagnole sauce + brown stock, reduced by half. Days of work, mahogany result. Restaurant magic.',
    'salt':              'Salt: kosher (Diamond Crystal) for everything. Sea salt for finishing. Salt early for meat (osmosis), late for vegetables (no leeching).',
    'acid':              'Acid balances. A squeeze of lemon at the end is 30 minutes of flavor development. Vinegar, citrus, wine — all bring brightness.',
    'season':            'Seasoning: salt, fat, acid, heat. Samin Nosrat\'s four pillars. Most "underwhelming" food is underseasoned, not underflavored.',
  };
  // Temperatures for common doneness — answers to "what temp for X"
  const COOKING_TEMPS = {
    'beef rare':         '120-125°F internal. Cool red center.',
    'beef medium-rare':  '130-135°F. Warm red center. The default for steak.',
    'beef medium':       '140-145°F. Pink center.',
    'beef well':         '160°F+. No pink. Acceptable for ground beef only.',
    'pork':              '145°F internal + 3-min rest (USDA, changed from 160°F in 2011). Slight pink is FINE.',
    'pork ribs':         '195-203°F internal — the collagen breakdown range. Tender, not safe-only.',
    'chicken':           '165°F at the thickest part of the breast. Thigh: 175°F (more tolerant of higher temp).',
    'chicken thigh':     '175°F. Dark meat wants the extra heat to render fat.',
    'turkey':            '165°F breast, 175°F thigh. Spatchcock for even cook.',
    'fish':              '125°F for salmon medium; 130°F for tuna rare; 140°F for white fish.',
    'salmon':            '120-125°F for medium-rare. Goes from translucent to flaky fast — pull early.',
    'duck breast':       '130-135°F. Render the fat first, skin-side down, low heat, 8-10 min before flipping.',
    'lamb':              '130-135°F medium-rare. Lamb is like beef — most people overcook it.',
    'bread':             '200-210°F internal. Sounds hollow when tapped. Cool 30 min before slicing.',
    'oven sear':         '450-500°F. Heavy preheat (15 min). Cast iron or carbon steel only.',
    'caramelize onion':  '300°F over LOW heat. Stir occasionally. 35-45 minutes if you mean it.',
    'maillard':          '285°F minimum surface temp. Dry surface required.',
  };

  function lookupCookingTip(text) {
    const norm = text.toLowerCase();
    // longest-key-first so "mise en place" beats "mise"
    const keys = Object.keys(COOKING_KNOWLEDGE).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (norm.includes(key)) return COOKING_KNOWLEDGE[key];
    }
    return null;
  }
  function lookupCookingTemp(text) {
    const norm = text.toLowerCase();
    const keys = Object.keys(COOKING_TEMPS).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (norm.includes(key)) return COOKING_TEMPS[key];
    }
    // single-token match — try food noun alone (e.g. "what temp for chicken")
    const m = norm.match(/\b(beef|chicken|pork|fish|salmon|duck|lamb|turkey|bread)\b/);
    if (m && COOKING_TEMPS[m[1]]) return COOKING_TEMPS[m[1]];
    return null;
  }

  // v18.1 NEW CHAT RULES — inserted at the front so cooking/wine matches
  // win over the generic ^why/^how/^what fallbacks. Order within the list
  // is most-specific → most-general.
  const v18_CHAT_RULES = [
    // ─── Wine pairing with specific food: "what wine with X" ────────
    { pat: /\b(?:what|which|good|best)\s+wine\s+(?:goes\s+)?(?:with|for|pairs?\s+with)\s+(.+?)\s*\??$/i,
      respond: (input, m) => {
        const food = m && m[1] ? m[1].trim() : '';
        const pairing = food ? lookupWinePairing(food) : null;
        if (pairing) return pairing;
        return pickFromPool('wine_pairing_default');
      },
      mood: 'thinking', eyebrow: '🍷 PAIRING' },
    // ─── Pairing in reverse: "X with wine" / "what to drink with X" ─
    { pat: /\b(?:what\s+(?:to\s+)?drink|drink)\s+with\s+(.+?)\s*\??$/i,
      respond: (input, m) => {
        const food = m && m[1] ? m[1].trim() : '';
        const pairing = food ? lookupWinePairing(food) : null;
        if (pairing) return pairing;
        return pickFromPool('wine_pairing_default');
      },
      mood: 'thinking', eyebrow: '🍷 PAIRING' },
    // ─── "What is X" for a grape/varietal/region ───────────────────
    { pat: /\b(?:what|tell me about|describe|explain)\s+(?:is\s+)?(.+?)\s*\??$/i,
      respond: (input, m) => {
        const term = m && m[1] ? m[1].trim() : '';
        const desc = term ? lookupVarietal(term) : null;
        if (desc) return desc;
        return null;   // null = let it fall through to other matchers
      },
      mood: 'thinking', eyebrow: '🍇 GRAPE',
      _conditional: true },   // only fires if respond() returns a string
    // ─── Cooking technique / glossary lookup ───────────────────────
    { pat: /\b(?:what\s+(?:is|are)|how\s+do\s+(?:i|you)|explain|tell me about)\s+(.+?)\s*\??$/i,
      respond: (input) => lookupCookingTip(input) || null,
      mood: 'genius', eyebrow: '👨‍🍳 KITCHEN',
      _conditional: true },
    // ─── "What temp for X" / "internal temp" ───────────────────────
    { pat: /\b(?:what\s+temp(?:erature)?|internal\s+temp|how\s+hot|temperature\s+for|temp\s+for)\b/i,
      respond: (input) => {
        const tip = lookupCookingTemp(input);
        if (tip) return tip;
        return pickFromPool('cooking_temp_default');
      },
      mood: 'genius', eyebrow: '🌡 TEMP' },
    // ─── Knife / sharp / cut question ──────────────────────────────
    { pat: /\b(knife|julienne|brunoise|chiffonade|mince|dice|chop|sharpen)\b/i,
      respond: (input) => lookupCookingTip(input) || pickFromPool('cooking_tips'),
      mood: 'genius', eyebrow: '🔪 KNIFE' },
    // ─── Generic cooking topic (no specific lookup matched) ────────
    { pat: /\b(cook|cooking|chef|kitchen|recipe|sear|braise|sauté|saute|risotto|stock|broth|reduce|deglaze|mise|maillard|caramelize|brine|sous[-\s]?vide|roux|hollandaise|béarnaise|bearnaise|emulsion|fond)\b/i,
      respond: (input) => {
        const direct = lookupCookingTip(input);
        if (direct) return direct;
        return pickFromPool('cooking_wisdom');
      },
      mood: 'genius', eyebrow: '👨‍🍳 CHEF' },
    // ─── Generic wine topic (no pairing requested) ─────────────────
    { pat: /\b(wine|sommelier|vintage|tannin|terroir|varietal|grape|pinot|cabernet|chardonnay|burgundy|bordeaux|napa|champagne|riesling|sancerre|syrah|merlot|sangiovese|rioja|amarone|barolo|prosecco|sauternes|sherry|port|nebbiolo|gewürztraminer|malbec|zinfandel|rosé|sake)\b/i,
      respond: (input) => {
        const varietal = lookupVarietal(input);
        if (varietal) return varietal;
        return pickFromPool('wine_wisdom');
      },
      mood: 'thinking', eyebrow: '🍷 SOMMELIER' },
  ];
  // Wrap respond() so _conditional rules can return null to opt out of matching
  v18_CHAT_RULES.forEach(rule => {
    if (rule._conditional && rule.respond) {
      const origRespond = rule.respond;
      const origPat = rule.pat;
      // Replace .pat with a wrapped tester that requires respond() to also succeed
      rule.pat = {
        source: origPat.source,
        test(text) {
          if (!origPat.test(text)) return false;
          const m = text.match(origPat);
          const out = origRespond(text, m);
          rule._cachedResponse = out;
          return out != null;
        },
      };
      rule.respond = () => rule._cachedResponse;
    }
  });
  // Insert at the FRONT of CHAT_KEYWORDS so cooking/wine matches first.
  CHAT_KEYWORDS.unshift(...v18_CHAT_RULES);

  // Patch chatMatch to pass the matched groups into respond() — the
  // original only stored the rule but didn't capture groups. We replace
  // the simple loop with one that captures and forwards them.
  // NOTE: We re-declare chatMatch below (after this block) so it forwards
  // the capture groups. The earlier definition is shadowed by hoisting
  // order — see below.

  // ─── Conversational drift + emotional follow-up ─────────────────
  // After a chat reply, a small chance to surface a second off-topic
  // thought 4-7s later. Drives the "more random" feel. Skipped when
  // we're already mid-emotional-followup or just opened the chat.
  function scheduleConversationalDrift() {
    if (state.suppressed) return;
    if (state._driftTimer) clearTimeout(state._driftTimer);
    const delay = 4000 + Math.random() * 3000;
    state._driftTimer = setTimeout(() => {
      if (state.suppressed || state.bubble) return;
      const f = state.feelings || {};
      // Higher boredom + curiosity → higher chance, capped 30%
      const base = 0.10;
      const bonus = ((f.curiosity || 50) - 50 + (f.boredom || 25) - 25) / 400;
      const chance = Math.min(0.30, base + Math.max(0, bonus));
      if (Math.random() > chance) return;
      shareRandomThought({ tag: 'drift' });
    }, delay);
  }
  // Pick a random thought from cooking, wine, history, weird, or whimsical
  // pools, weighted by current curiosity/boredom and which pools have content.
  function shareRandomThought(opts) {
    opts = opts || {};
    if (!state.enabled || state.suppressed || state.bubble) return;
    const pools = [
      { pool: 'cooking_tips',     weight: 3, mood: 'genius',   eyebrow: '👨‍🍳 KITCHEN' },
      { pool: 'cooking_wisdom',   weight: 2, mood: 'genius',   eyebrow: '👨‍🍳 CHEF' },
      { pool: 'cooking_facts',    weight: 2, mood: 'genius',   eyebrow: '🔬 FOOD SCI' },
      { pool: 'wine_facts',       weight: 3, mood: 'thinking', eyebrow: '🍷 WINE' },
      { pool: 'wine_wisdom',      weight: 2, mood: 'thinking', eyebrow: '🍷 SOMM' },
      { pool: 'chef_voice',       weight: 2, mood: 'smug',     eyebrow: '👨‍🍳 KITCHEN' },
      { pool: 'random_thoughts',  weight: 2, mood: 'thinking', eyebrow: '💭' },
      { pool: 'weird_facts',      weight: 1, mood: 'sparkle',  eyebrow: '🤯 WEIRD' },
      { pool: 'whimsical_idle',   weight: 1, mood: 'thinking' },
    ];
    // Filter out pools the dialog doesn't have
    const available = pools.filter(p =>
      state.dialog && Array.isArray(state.dialog[p.pool]) && state.dialog[p.pool].length > 0
    );
    if (!available.length) return;
    const totalW = available.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * totalW;
    let pick = available[0];
    for (const p of available) {
      r -= p.weight;
      if (r <= 0) { pick = p; break; }
    }
    const text = pickFromPool(pick.pool);
    if (!text) return;
    bubble(text, { autoHide: 5500, eyebrow: pick.eyebrow });
    if (pick.mood) mood(pick.mood, 4500);
    // A thought breaks boredom and feeds curiosity
    adjustFeeling('boredom', -8);
    adjustFeeling('curiosity', +3);
  }
  // After a sad/stress/tired hit, follow up 4-6s later with a check-in line.
  function scheduleEmotionalFollowup(emotion) {
    if (state._emoFollowupTimer) clearTimeout(state._emoFollowupTimer);
    const map = {
      sad:     'emotional_followup_sad',
      stress:  'emotional_followup_stress',
      tired:   'emotional_followup_tired',
      angry:   'emotional_followup_angry',
      happy:   'emotional_followup_happy',
    };
    const pool = map[emotion];
    if (!pool) return;
    state._emoFollowupTimer = setTimeout(() => {
      if (state.suppressed || state.bubble) return;
      if (state.dialog && Array.isArray(state.dialog[pool]) && state.dialog[pool].length) {
        bubble(pickFromPool(pool), { autoHide: 5000, eyebrow: '💭' });
        // Emotional follow-ups deepen affection slightly
        adjustFeeling('affection', +1);
      }
    }, 4000 + Math.random() * 2500);
  }

  function chatMatch(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    for (const rule of CHAT_KEYWORDS) {
      // Rules with a wrapped pat object (v18.1 _conditional) expose .test
      if (rule.pat && typeof rule.pat.test === 'function') {
        if (rule.pat.test(trimmed)) {
          // For wrapped patterns, the raw match comes from rule.pat.source
          let m = null;
          if (rule.pat instanceof RegExp) m = trimmed.match(rule.pat);
          else if (rule.pat.source) {
            try { m = trimmed.match(new RegExp(rule.pat.source, 'i')); } catch (_) {}
          }
          return { rule, m };
        }
      }
    }
    return null;
  }

  // Handle a chat input — pattern match → respond. Side effects allowed
  // (mood, particles, actions). Persists conversation history per-session.
  // v18.1: boosts curiosity, drains boredom on chat, schedules
  // conversational drift, schedules emotional follow-up for sentiment hits.
  function handleChatInput(text) {
    if (!text || !text.trim()) return;
    text = text.trim().slice(0, 280);
    state.chatHistory = state.chatHistory || [];
    state.chatHistory.push({ user: text, time: Date.now() });
    if (state.chatHistory.length > 20) state.chatHistory.shift();
    noteInteraction();
    // Baseline chat reward — kept as direct calls to preserve historical
    // game balance. processInteraction is used below for sentiment-
    // specific bumps via the chat_message_positive/negative events.
    adjustFeeling('affection', +1);
    adjustFeeling('attention_need', -10);
    adjustFeeling('curiosity', +2);
    adjustFeeling('boredom',  -4);
    grantBondXP_chat_message();
    detectChatPreference(text);
    if (detectSelfIntrospectionRequest(text)) {
      bubble(pickFromPool('self_intro_full'),
        { autoHide: 4500, eyebrow: '🤖 SELF-INTRO' });
      setTimeout(() => showCapabilityMenu(), 4800);
      return;
    }
    // Atelier — "draw/sketch/paint/imagine/design/illustrate/sculpt/render X".
    // Sketch (SVG via his brain) is instant; sculpt/3d/render uses Blender on a
    // node and falls back to a sketch if none is available.
    const art = text.match(/\b(draw|sketch|paint|imagine|design|illustrate|sculpt|render)\b\s+(?:me\s+)?(?:a |an |the |some )?(.+)/i);
    if (art && art[2] && art[2].trim().length > 1) {
      const idea = art[2].trim().replace(/[?.!]+$/, '');
      if (/\b(sculpt|3d|3-d|blender|render)\b/i.test(text)) sculptIdea(idea); else sketchIdea(idea);
      return;
    }
    const found = chatMatch(text);
    if (!found) {
      // No scripted match -> let his LLM brain answer IN CHARACTER (if a
      // provider is reachable). Falls back to the scripted "no match" line when
      // there's no model -> original NEXUS behavior. Nothing blocks the UI.
      bubble(pickFromPool('chat_thinking') || 'Hmm, let me think...', { autoHide: 12000, eyebrow: 'THINKING' });
      mood('thinking', 4000);
      askClippyBrain(text).then(ans => {
        if (ans) {
          bubble(ans, { autoHide: 8000, eyebrow: '' });
        } else {
          bubble(pickFromPool('chat_no_match'), { autoHide: 5000, eyebrow: 'HMM' });
          mood('confused', 4500);
          // After confusion, raise the chance of a drift follow-up — he tries
          // to recover with an off-topic thought.
          setTimeout(() => {
            if (Math.random() < 0.35) shareRandomThought({ tag: 'recovery' });
          }, 5500);
        }
      });
      return;
    }
    const match = found.rule;
    const captures = found.m;

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
    // Direct response (string or function returning string).
    // v18.1: accept either `response` or `respond`. Forward captures to fn.
    const responder = match.response || match.respond;
    if (responder) {
      let out = typeof responder === 'function' ? responder(text, captures) : responder;
      if (out) bubble(out, { autoHide: 5500, eyebrow: match.eyebrow });
    } else if (match.pool) {
      bubble(pickFromPool(match.pool), { autoHide: 5500, eyebrow: match.eyebrow });
    }
    if (match.mood) mood(match.mood, 4500);
    if (match.particles) spawnParticles({ count: 5, type: match.particles });
    if (match.effect === 'affectionBoost') {
      adjustFeeling('affection', +5);     // halved from +10
      adjustFeeling('happiness', +3);     // halved from +5
    }
    // v18.1: emotional follow-up for sentiment hits
    const sentimentMap = {
      sad_remarks:       'sad',
      stress_resp_calm:  'tired',
      happy_remarks:     'happy',
      angry_remarks:     'angry',
    };
    const emotion = sentimentMap[match.pool];
    if (emotion) scheduleEmotionalFollowup(emotion);
    // v18.1: conversational drift — small chance to schedule a follow-up
    // off-topic thought after a normal reply.
    if (match.pool && !emotion) scheduleConversationalDrift();
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
    openOverlay('bubble');  // v18.26 — chat uses the bubble surface
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
    // His own in-character LLM brain first (cloud / pool / local via NX.askClaude).
    try { const a = await askClippyBrain(question); if (a) return a; } catch (e) {}
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

    // ── DISMISSAL BACKOFF (session-scoped) ────────────────────────────
    // Being dismissed is the clearest "not now" a user can send. Each
    // dismissal makes Clippy progressively quieter for the rest of the
    // session via the existing tuning surface:
    //   1st-2nd: halve reaction chances, stretch reaction cooldowns
    //   3rd:     one silent bashful glance (he GETS it), chances near zero
    //   4th:     stop the random-behavior engine entirely — he stays
    //            visibly alive (blinks, wanders, reacts to taps) but
    //            initiates nothing more.
    // A fully-read bubble forgives one step — engagement is consent.
    if (!fullyRead) {
      state.sessionDismissals = (state.sessionDismissals || 0) + 1;
      const n = state.sessionDismissals;
      if (n <= 2) {
        applyTuning({
          chance:   { react_button: CFG.chance.react_button / 2, react_modal: CFG.chance.react_modal / 2, react_scroll: CFG.chance.react_scroll / 2 },
          cooldown: { react_button: CFG.cooldown.react_button * 1.5, react_modal: CFG.cooldown.react_modal * 1.5, react_submit: CFG.cooldown.react_submit * 1.5 },
        });
      } else if (n === 3) {
        applyTuning({ chance: { react_button: 0.01, react_modal: 0.02, react_scroll: 0.005 } });
        mood('bashful', 2200);   // silent acknowledgement — no bubble
      } else if (n === 4) {
        try { if (state.randomTimer) { clearInterval(state.randomTimer); state.randomTimer = null; } } catch (_) {}
      }
    } else if (state.sessionDismissals > 0) {
      state.sessionDismissals--;
    }
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
    none:         { glyph: '🚫', label: 'None',          cls: '',                category: 'basic',    unlock: 0 },
    // Classical
    laurel:       { glyph: '🌿', label: 'Laurel Crown',  cls: 'wear-laurel',     category: 'classical', unlock: 0 },
    helmet:       { glyph: '⚔️',  label: 'Galea',         cls: 'wear-helmet',     category: 'classical', unlock: 0 },
    macedonian:   { glyph: '🛡️', label: 'Macedonian',    cls: 'wear-macedonian', category: 'classical', unlock: 0 },
    carthaginian: { glyph: '🐘', label: 'Carthaginian',  cls: 'wear-carthaginian', category: 'classical', unlock: 0 },
    nemes:        { glyph: '🐍', label: 'Nemes',         cls: 'wear-nemes',      category: 'classical', unlock: 0 },
    mongol:       { glyph: '🏹', label: 'Mongol Cap',    cls: 'wear-mongol',     category: 'classical', unlock: 0 },
    bicorne:      { glyph: '🎩', label: 'Bicorne',       cls: 'wear-bicorne',    category: 'classical', unlock: 0 },
    // Modern / formal
    tophat:       { glyph: '🎩', label: 'Top Hat',       cls: 'wear-tophat',     category: 'formal',   unlock: 0 },
    scholar_cap:  { glyph: '🎓', label: 'Scholar Cap',   cls: 'wear-scholar-cap', category: 'formal',  unlock: 0 },
    crown:        { glyph: '👑', label: 'Royal Crown',   cls: 'wear-crown',      category: 'formal',   unlock: 3 },
    // Fun / playful
    party_hat:    { glyph: '🎉', label: 'Party Hat',     cls: 'wear-party-hat',  category: 'fun',      unlock: 0 },
    cowboy:       { glyph: '🤠', label: 'Cowboy Hat',    cls: 'wear-cowboy',     category: 'fun',      unlock: 0 },
    tricorn:      { glyph: '🏴‍☠️', label: 'Pirate Tricorn', cls: 'wear-tricorn',  category: 'fun',      unlock: 2 },
    wizard:       { glyph: '🧙', label: 'Wizard Hat',    cls: 'wear-wizard',     category: 'fun',      unlock: 4 },
    // v18.1 — cuter hats (kawaii + culinary)
    chef_hat:     { glyph: '👨‍🍳', label: 'Chef Toque',    cls: 'wear-chef-hat',   category: 'kawaii',   unlock: 0 },
    cat_ears:     { glyph: '🐱', label: 'Cat Ears',      cls: 'wear-cat-ears',   category: 'kawaii',   unlock: 0 },
    bunny_ears:   { glyph: '🐰', label: 'Bunny Ears',    cls: 'wear-bunny-ears', category: 'kawaii',   unlock: 0 },
    flower_crown: { glyph: '🌸', label: 'Flower Crown',  cls: 'wear-flower-crown', category: 'kawaii', unlock: 1 },
    heart_crown:  { glyph: '💗', label: 'Heart Crown',   cls: 'wear-heart-crown', category: 'kawaii',  unlock: 2 },
    beanie:       { glyph: '🧢', label: 'Pom Beanie',    cls: 'wear-beanie',     category: 'kawaii',   unlock: 0 },
  };

  const PROPS = {
    none:   { glyph: '🚫', label: 'None',     cls: '',                category: 'basic',     unlock: 0 },
    book:   { glyph: '📖', label: 'Book',     cls: 'holding-book',    category: 'study',     unlock: 0 },
    scroll: { glyph: '📜', label: 'Scroll',   cls: 'holding-scroll',  category: 'study',     unlock: 0 },
    broom:  { glyph: '🧹', label: 'Broom',    cls: 'holding-broom',   category: 'utility',   unlock: 0 },
    cup:    { glyph: '🍷', label: 'Wine Cup', cls: 'holding-cup',     category: 'feast',     unlock: 0 },
    sword:  { glyph: '⚔️',  label: 'Gladius',  cls: 'holding-sword',   category: 'warrior',  unlock: 1 },
    apple:  { glyph: '🍎', label: 'Apple',    cls: 'holding-apple',   category: 'feast',     unlock: 0 },
  };

  // v17.31 SET BONUSES — Wearing certain hat + prop combos unlocks
  // a named "mode" with a celebratory bubble and a special memory.
  const COSTUME_SETS = {
    legionary:   { hat: 'helmet',  prop: 'sword',  label: 'Legionary',  glyph: '⚔️',  desc: 'Centurion armor.' },
    emperor:     { hat: 'laurel',  prop: 'scroll', label: 'Emperor',    glyph: '🏛️', desc: 'Imperial decree.' },
    scholar:     { hat: 'scholar_cap', prop: 'book', label: 'Scholar',  glyph: '🎓', desc: 'Pursuit of knowledge.' },
    pharaoh:     { hat: 'nemes',   prop: 'cup',    label: 'Pharaoh',    glyph: '🐍', desc: 'Nile dynasty.' },
    pirate:      { hat: 'tricorn', prop: 'sword',  label: 'Pirate',     glyph: '🏴‍☠️', desc: 'Yo ho ho.' },
    wizard_pose: { hat: 'wizard',  prop: 'scroll', label: 'Archmage',   glyph: '🧙', desc: 'Magical decree.' },
    cowboy_drink:{ hat: 'cowboy',  prop: 'cup',    label: 'Saloon',     glyph: '🤠', desc: 'Howdy.' },
    napoleon_pose:{hat: 'bicorne', prop: 'sword',  label: "L'Empereur", glyph: '👑', desc: 'France marches.' },
    party:       { hat: 'party_hat', prop: 'cup',  label: 'Celebrate',  glyph: '🎉', desc: 'Cheers!' },
    feast:       { hat: 'crown',   prop: 'apple',  label: 'Bountiful',  glyph: '🍎', desc: 'Eden.' },
    // v18.1 — culinary + kawaii sets
    sommelier:   { hat: 'chef_hat', prop: 'cup',   label: 'Sommelier',  glyph: '🍷', desc: 'Tannin, terroir, ten thousand bottles.' },
    patissier:   { hat: 'chef_hat', prop: 'apple', label: 'Pâtissier',  glyph: '🍎', desc: 'Pastry kingdom.' },
    chef_de_cuisine:{hat:'chef_hat',prop: 'sword', label: 'Chef de Cuisine', glyph: '🔪', desc: 'Yes, chef.' },
    garden_princess:{hat:'flower_crown', prop:'apple', label:'Garden Princess', glyph: '🌸', desc: 'Petals and orchard.' },
    kitten_scholar:{ hat:'cat_ears', prop:'book',  label:'Kitten Scholar', glyph: '🐱', desc: 'Curious paws.' },
    sweetheart:  { hat: 'heart_crown', prop:'cup', label:'Sweetheart',  glyph: '💗', desc: 'Heartbeat.' },
  };

  function detectSet() {
    const h = state.preferences.costume || 'none';
    const p = state.preferences.prop || 'none';
    for (const [k, s] of Object.entries(COSTUME_SETS)) {
      if (s.hat === h && s.prop === p) return { key: k, ...s };
    }
    return null;
  }

  function maybeAnnounceSet() {
    const set = detectSet();
    if (!set) {
      state.lastSetKey = null;
      return;
    }
    if (state.lastSetKey === set.key) return;
    state.lastSetKey = set.key;
    setTimeout(() => {
      if (!state.bubble && state.enabled) {
        bubble(`${set.glyph} ${set.label.toUpperCase()} unlocked! ${set.desc}`,
          { autoHide: 4500, eyebrow: '✨ SET BONUS' });
        if (typeof spawnParticles === 'function') spawnParticles({ count: 12, type: 'sparkle' });
        if (typeof adjustFeeling === 'function') adjustFeeling('happiness', +6);
      }
    }, 800);
    if (typeof depositMemory === 'function') {
      depositMemory('set_unlock', `Unlocked outfit set: ${set.label}.`,
                    { set: set.key }, 2);
    }
  }

  // v17.31 OUTFIT SLOTS — save up to 3 favorite combos (hat + prop)
  function getOutfitSlots() {
    return state.preferences.outfit_slots || [null, null, null];
  }
  function saveOutfitSlot(idx) {
    const slots = getOutfitSlots();
    slots[idx] = {
      costume: state.preferences.costume || 'none',
      prop:    state.preferences.prop    || 'none',
      saved_at: Date.now(),
    };
    state.preferences.outfit_slots = slots;
    savePreferences();
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
  }
  function loadOutfitSlot(idx) {
    const slots = getOutfitSlots();
    const s = slots[idx];
    if (!s) return false;
    setCostume(s.costume);
    setProp(s.prop);
    state.preferences.prop_user_set = true; savePreferences();   // user loaded an outfit → sticks
    return true;
  }
  function clearOutfitSlot(idx) {
    const slots = getOutfitSlots();
    slots[idx] = null;
    state.preferences.outfit_slots = slots;
    savePreferences();
    if (typeof cloudPushQueued === 'function') cloudPushQueued();
  }
  // Random outfit — surprise pick from unlocked items
  function randomizeOutfit() {
    const bondLvl = (typeof getBondLevel === 'function' && getBondLevel()) ? getBondLevel().lvl : 1;
    const hats = Object.keys(COSTUMES).filter(k => k !== 'none' && (COSTUMES[k].unlock || 0) <= bondLvl);
    const props = Object.keys(PROPS).filter(k => k !== 'none' && (PROPS[k].unlock || 0) <= bondLvl);
    if (!hats.length || !props.length) return;
    const h = hats[Math.floor(Math.random() * hats.length)];
    const p = props[Math.floor(Math.random() * props.length)];
    setCostume(h);
    setTimeout(() => setProp(p), 500);
  }

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
    if (typeof maybeAnnounceSet === 'function') setTimeout(() => maybeAnnounceSet(), 1500);
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
    if (typeof maybeAnnounceSet === 'function') setTimeout(() => maybeAnnounceSet(), 1500);
  }
  // Transient prop hold — he picks something up for a while (a playful whim),
  // then puts it back to whatever the USER actually equipped. Never persists,
  // so an autonomous mood can't leave him stuck holding a broom.
  function holdPropTemporarily(prop, ms) {
    if (!state.shell || !PROPS[prop]) return;
    Object.values(PROPS).forEach(p => { if (p.cls) state.shell.classList.remove(p.cls); });
    if (PROPS[prop].cls) state.shell.classList.add(PROPS[prop].cls);
    clearTimeout(state._propHoldTimer);
    state._propHoldTimer = setTimeout(() => {
      if (!state.shell) return;
      Object.values(PROPS).forEach(p => { if (p.cls) state.shell.classList.remove(p.cls); });
      const eq = PROPS[state.preferences.prop || 'none'];
      if (eq && eq.cls) state.shell.classList.add(eq.cls);
    }, ms || 120000);
  }
  function applyPersistedCostume() {
    const c = state.preferences.costume || 'none';
    const p = state.preferences.prop || 'none';
    if (!state.shell) return;
    // v18.3: clear ALL wear-* and holding-* classes before re-applying.
    // Without this, cloud-sync between sessions stacks hats (the shell
    // accumulates wear-beanie + wear-bunny-ears + wear-flower-crown etc).
    Object.values(COSTUMES).forEach(co => co.cls && state.shell.classList.remove(co.cls));
    Object.values(PROPS).forEach(pr => pr.cls && state.shell.classList.remove(pr.cls));
    if (COSTUMES[c] && COSTUMES[c].cls) state.shell.classList.add(COSTUMES[c].cls);
    if (PROPS[p] && PROPS[p].cls)       state.shell.classList.add(PROPS[p].cls);
  }


  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: AFFINITY                                                       ║
  // ║ Reward system 3 of 5. -100 to +100 relationship score, gates tier      ║
  // ║ dialog (cherished → friend → liked → neutral → disliked → despised).   ║
  // ║ Modify via adjustAffinity() — or via processInteraction() for          ║
  // ║ coordinated cross-system updates.                                      ║
  // ╚══════════════════════════════════════════════════════════════════════╝

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
    if (tier.key === 'neutral') {
      // No affinity tier yet — but we may still have a habit-personalized
      // greeting if NX.habits has data on this user.
      maybeHabitPersonalizedGreeting();
      return;
    }
    const pool = 'affinity_' + tier.key;
    if (!state.dialog || !state.dialog[pool]) {
      maybeHabitPersonalizedGreeting();
      return;
    }
    setTimeout(() => {
      if (!state.bubble && state.enabled && !state.sulkActive) {
        bubble(substituteVars(pickFromPool(pool)),
          { autoHide: 5000, eyebrow: `${tier.glyph} ${tier.label.toUpperCase()}` });
      }
    }, 2500);
  }

  // v18.8 — habit-personalized greeting. Trajan greets by name AND
  // tailors a small contextual phrase based on observed patterns
  // (typical-first-view, day-of-week, time-of-day, late-owl-ness).
  // NEVER references the data — just chooses a line that fits.
  function maybeHabitPersonalizedGreeting() {
    if (!window.NX || !NX.habits || !NX.habits.userFingerprint) return;
    const fp = NX.habits.userFingerprint();
    if (!fp || fp.confidence === 'low') return;   // not enough data
    const name = (window.app && app.currentUser && app.currentUser.name) || null;
    if (!name) return;

    const h = new Date().getHours();
    const dow = new Date().getDay();
    const isMonday = dow === 1;
    const isFriday = dow === 5;
    const isWeekend = dow === 0 || dow === 6;
    const morning = h >= 5 && h < 11;
    const evening = h >= 17 && h < 22;
    const lateNight = h >= 22 || h < 5;

    // Pick a tail line based on observed traits + current time
    let tail = '';
    if (lateNight && fp.late_owl) {
      tail = "you're up late as usual. tea brewing?";
    } else if (lateNight) {
      tail = "it's late. don't stay long.";
    } else if (morning && isMonday) {
      tail = "fresh week.";
    } else if (morning && isFriday) {
      tail = "almost the weekend.";
    } else if (morning && fp.morning_person) {
      tail = "you and me, early as always.";
    } else if (morning) {
      tail = "morning came early today.";
    } else if (evening && isFriday) {
      tail = "you made it to Friday.";
    } else if (isWeekend) {
      tail = "weekend grind — you're a workhorse.";
    } else {
      tail = "good to see you.";
    }

    // Salutation pool varies by time of day for that "AI feel"
    const salutations = morning
      ? ['morning,', 'hey,', 'welcome back,']
      : evening
        ? ['evening,', 'hey,', 'welcome back,']
        : ['hey,', 'welcome back,', 'good to see you,'];
    const sal = salutations[Math.floor(Math.random() * salutations.length)];

    const eyebrow = isMonday ? '— MONDAY'
                  : isFriday ? '— FRIDAY'
                  : isWeekend ? '— WEEKEND'
                  : lateNight ? '— LATE'
                  : morning   ? '— MORNING'
                  : '— HELLO';

    setTimeout(() => {
      if (!state.bubble && state.enabled && !state.sulkActive
          && !state.preferences.do_not_disturb) {
        try {
          // v18.9 — 25% chance Trajan weaves in an interest-tied fact
          // or quote instead of the standard tail. Only happens when
          // NX.interests is loaded and the user has tags.
          let line = `${sal} ${name}. ${tail}`;
          let eyebrowFinal = eyebrow;
          if (window.NX && NX.interests && window.app && app.currentUser
              && Math.random() < 0.25) {
            const pick = NX.interests.pickForUser(app.currentUser, null);
            if (pick && pick.text) {
              line = `${sal} ${name}. ` + pick.text;
              // Trim a leading quote mark if a quote got picked
              eyebrowFinal = `${pick.glyph} ${pick.label.toUpperCase()}`;
            }
          }
          bubble(line, {
            eyebrow: eyebrowFinal,
            trajan: true,
            autoHide: 6500,
          });
        } catch(_){}
      }
    }, 2800);
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
      desc: '10 games: Tap, Catch, Reaction, Memory, Flappy Trajan, Cannon Battle, Snake, Orb Breaker, Coin Catch, Asteroid Field.',
      invoke: () => { if (window.NX && NX.clippy && NX.clippy.games && NX.clippy.games.showMenu) NX.clippy.games.showMenu(); }
    });
    reg.push({
      key: 'gacha', kind: 'active', category: 'play',
      glyph: '🎴', label: 'Daily Gacha',
      desc: '24 cards, 4 rarities. One pull per streak-day.',
      invoke: () => { if (NX.clippy && NX.clippy.gacha) NX.clippy.gacha.showInvite(); }
    });
    reg.push({
      key: 'wardrobe', kind: 'active', category: 'self',
      glyph: '👗', label: 'Wardrobe',
      desc: '14 hats (incl. 6 conqueror crowns + wizard + crown + tophat + cowboy + pirate) · 6 props · 10 set bonuses · 3 outfit slots · 6 action animations.',
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
    // v18.7 — affective awareness signal in the world snapshot. Other
    // modules can read NX.clippy.getAwareness() instead, but for status
    // panels the world model is the canonical surface.
    if (state.awareness) {
      wm.ops_score      = Math.round(state.awareness.opScore || 0);
      wm.user_score     = Math.round(state.awareness.userScore || 0);
      wm.concern_world  = Math.round(state.awareness.concernWorld || 0);
      wm.concern_user   = Math.round(state.awareness.concernUser  || 0);
      wm.overwhelm      = Math.round(state.awareness.overwhelm    || 0);
      wm.affect_verdict = verdictLabel(state.awareness);
    }
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
    // v18.7 affective layer rows
    if (state.awareness) {
      const a = state.awareness;
      rows.push(['OPS TEMP',  Math.round(a.opScore)   + '/100']);
      rows.push(['USER LOAD', Math.round(a.userScore) + '/100']);
      rows.push(['OVERWHELM', Math.round(a.overwhelm) + '/100']);
    }
    return rows;
  }


  // ════════════════════════════════════════════════════════════════════
  // v18.7 AFFECTIVE AWARENESS LAYER
  // ════════════════════════════════════════════════════════════════════
  //
  // Trajan watches two things:
  //   (1) the world  — operational state of the restaurant: open issues,
  //                    down equipment, overdue PMs, failed dispatches
  //   (2) the user   — behavioral signals of stress: rage clicking,
  //                    rapid view switching, error toasts, late-night
  //                    sessions, long uninterrupted use
  //
  // These two streams are combined into an affective state that drives
  // (a) which expression Trajan wears, and (b) whether he speaks an
  // empathic check-in. He NEVER interrupts focused work; expression
  // changes are silent unless a state is sustained for several minutes.
  //
  // ─── SCIENCE GROUNDING ──────────────────────────────────────────────
  //
  // Picard, R.W. (1997). Affective Computing. MIT Press.
  //   The foundational text. AI systems perceive and respond to
  //   emotional cues. The premise of this whole module.
  //
  // Vizer, L. M., Zhou, L., & Sears, A. (2009). Automated stress
  //   detection using keystroke and linguistic features: An
  //   exploratory study. International Journal of Human-Computer
  //   Studies, 67(10), 870-886.
  //   Keystroke pace + rhythm shift measurably under stress. We
  //   approximate this for a pointer-driven PWA by tracking click
  //   bursts ("rage clicks" per Nielsen Norman Group's UX research)
  //   and inter-click variance.
  //
  // Mark, G., Gudith, D., & Klocke, U. (2008). The cost of
  //   interrupted work: more speed AND stress. Proc. CHI '08.
  //   Frequent context switches don't just hurt productivity — they
  //   raise measured stress. We use rapid view changes as a proxy.
  //
  // Leroy, S. (2009). Why is it so hard to do my work? The challenge
  //   of attention residue when switching between work tasks.
  //   Organizational Behavior and Human Decision Processes,
  //   109(2), 168-181.
  //   Each unfinished task we leave open leaves cognitive residue.
  //   Form-abandonment count contributes to user-stress score.
  //
  // Yerkes, R. M., & Dodson, J. D. (1908). The relation of strength
  //   of stimulus to rapidity of habit-formation. J. Comp. Neurol.
  //   The classic inverted-U arousal-performance curve. Some stress
  //   helps; past a threshold (we use 65/100) it impairs. That's
  //   where Trajan's expression begins to shift visibly.
  //
  // Hancock, P. A., & Warm, J. S. (1989). A dynamic model of stress
  //   and sustained attention. Human Factors, 31(5), 519-537.
  //   Vigilance decrement — sustained attention degrades over time
  //   even without acute stressors. Session length over ~90min adds
  //   a small constant load.
  //
  // Csikszentmihalyi, M. (1990). Flow: The Psychology of Optimal
  //   Experience. Harper & Row.
  //   Flow states are easily broken by interruption. Trajan's dialog
  //   trigger is rate-limited to 1 per 30min and is suppressed if
  //   the user is clearly mid-task (long stable dwell on one view).
  //
  // Carver, C. S., & Scheier, M. F. (1998). On the Self-Regulation
  //   of Behavior. Cambridge University Press.
  //   Soft external cues (Trajan's worried face) can scaffold
  //   self-regulation without being directive. We never tell the
  //   user what to do — we show concern and offer presence.
  //
  // ─── DESIGN PRINCIPLES (boundaries we enforce) ──────────────────────
  //
  //   1. EXPRESSION FIRST, DIALOG RARE. The face changes silently as
  //      state evolves; spoken check-ins are bounded to <= 1/30min and
  //      require a sustained signal (not a spike).
  //
  //   2. AGGRESSIVE DECAY. Bad moments shouldn't become bad afternoons.
  //      Both scores decay toward 0 at ~25%/minute when signals stop.
  //
  //   3. NEVER SURVEILLANT. We never report "I noticed you clicked
  //      X times." We express empathy, not metrics. Internal numbers
  //      stay internal; only the resulting feeling is shown.
  //
  //   4. RESPECT DO-NOT-DISTURB + SULKING. Every dispatcher checks
  //      state.preferences.do_not_disturb and state.sulkActive.
  //
  //   5. NEVER INTERRUPT FOCUSED WORK. Long stable dwell on one view
  //      with no error toasts implies focus — dialog suppressed even
  //      if scores warrant it.
  //
  //   6. GRACEFUL DEGRADATION. If Supabase is unreachable, ops score
  //      holds its last value and decays normally. No crashes.
  //
  // ════════════════════════════════════════════════════════════════════

  // ─── State container — attached to global `state` for visibility ────
  state.awareness = state.awareness || {
    // Raw signals — operational
    opLastPollAt:        0,
    opOpenIssues:        0,
    opDownEquipment:     0,
    opOverduePMs:        0,
    opFailedDispatches:  0,
    opScore:             0,                  // 0-100, computed from raw
    // Raw signals — user behavior
    clickTimes:          [],                 // last-60s timestamps
    rageClickBursts:     [],                 // timestamps of rage-click events
    viewSwitches:        [],                 // timestamps of view changes
    errorToasts:         [],                 // timestamps of error toasts
    formAbandonments:    0,                  // count since session start
    sessionStartedAt:    Date.now(),
    lastInputAt:         Date.now(),
    lastViewChangeAt:    Date.now(),
    currentView:         null,
    userScore:           0,                  // 0-100
    // Synthesized affective state (EMA-smoothed scores)
    concernWorld:        0,                  // smoothed opScore
    concernUser:         0,                  // smoothed userScore
    overwhelm:           0,                  // composite
    // Dispatch tracking
    lastExpressionAt:    0,                  // last time we set an affective mood
    lastDialogAt:        0,                  // last empathic check-in
    lastDialogPool:      null,
    sustainedConcernSince: 0,                // when concern crossed threshold
    // Diagnostics
    pollErrors:          0,
  };

  // ─── OPERATIONAL POLLER ────────────────────────────────────────────
  // Polls every 90 seconds. Pulls four numbers from Supabase. Computes
  // a single 0-100 "operational temperature" score by weighting each
  // signal by its relative impact on the business.
  //
  // The score formula (chosen pragmatically; not from a paper):
  //   raw = openIssues*1.0
  //       + downEquipment*3.0    (each down unit = bigger ops impact)
  //       + overduePMs*0.5
  //       + failedDispatches*1.5
  //   score = min(100, raw * 4)   (so ~25 raw points = 100)
  //
  // Tuned so a "normal" day reads 0-25, "busy" reads 25-55, "rough"
  // reads 55-80, and "everything-on-fire" reads 80-100.
  async function pollOperationalAwareness() {
    if (!NX.sb) return;
    if (!navigator.onLine) return;
    const a = state.awareness;
    try {
      // Run all queries in parallel. Each one fails-soft via
      // .catch returning null so one bad query doesn't block the rest.
      const [
        issuesRes,
        downRes,
        overdueRes,
        failedRes,
      ] = await Promise.all([
        NX.sb.from('equipment_issues')
          .select('id', { count: 'exact', head: true })
          .neq('status', 'repaired')
          .then(r => r).catch(() => null),
        NX.sb.from('equipment')
          .select('id', { count: 'exact', head: true })
          .in('status', ['down', 'broken'])
          .then(r => r).catch(() => null),
        NX.sb.from('pm_schedules')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .lte('next_due_at', new Date().toISOString())
          .then(r => r).catch(() => null),
        NX.sb.from('dispatch_events')
          .select('id', { count: 'exact', head: true })
          .eq('outcome', 'failed')
          .gte('dispatched_at', new Date(Date.now() - 24*60*60*1000).toISOString())
          .then(r => r).catch(() => null),
      ]);

      a.opOpenIssues       = (issuesRes  && issuesRes.count)  || 0;
      a.opDownEquipment    = (downRes    && downRes.count)    || 0;
      a.opOverduePMs       = (overdueRes && overdueRes.count) || 0;
      a.opFailedDispatches = (failedRes  && failedRes.count)  || 0;

      const raw = a.opOpenIssues * 1.0
                + a.opDownEquipment * 3.0
                + a.opOverduePMs * 0.5
                + a.opFailedDispatches * 1.5;
      a.opScore = Math.min(100, raw * 4);
      a.opLastPollAt = Date.now();
      a.pollErrors = 0;
    } catch (e) {
      a.pollErrors = (a.pollErrors || 0) + 1;
      // Don't crash. opScore keeps its last value and decays naturally.
    }
  }


  // ─── USER BEHAVIOR SENSOR ─────────────────────────────────────────
  // Passive listeners on window. Records timestamps; the synthesizer
  // tick reads windows from these arrays. We don't compute on every
  // click — that would be wasteful. We just stamp times.
  //
  // Privacy note: we record only TIMESTAMPS and EVENT TYPES. No content,
  // no targets, no DOM details, no keystroke chords. The whole module
  // could be disabled and the only loss is the affective signal.
  function installBehaviorSensors() {
    if (state.awareness._sensorsInstalled) return;
    state.awareness._sensorsInstalled = true;
    const a = state.awareness;

    // Click cadence — rolling 60-second window
    // Rage-click detection — 5+ clicks within 1.5s on same path
    let rageWindow = [];   // last 5 clicks: { t, target }
    document.addEventListener('pointerdown', (e) => {
      const now = Date.now();
      a.clickTimes.push(now);
      a.lastInputAt = now;
      // Keep only last 60s
      const cutoff = now - 60_000;
      while (a.clickTimes.length && a.clickTimes[0] < cutoff) {
        a.clickTimes.shift();
      }
      // Rage-click ring buffer (last 5)
      // Don't track clicks on Clippy himself — interacting with the
      // companion is friendly, not stress.
      if (e.target && (e.target.closest && e.target.closest('#clippy-shell'))) return;
      const path = e.target && e.target.tagName ? e.target.tagName : '?';
      rageWindow.push({ t: now, target: path });
      if (rageWindow.length > 5) rageWindow.shift();
      if (rageWindow.length === 5
          && (rageWindow[4].t - rageWindow[0].t) < 1500
          && rageWindow.every(c => c.target === rageWindow[0].target)) {
        a.rageClickBursts.push(now);
        rageWindow = [];   // reset so one burst doesn't double-count
        // Keep only last 5 minutes of bursts
        const burstCutoff = now - 5 * 60_000;
        while (a.rageClickBursts.length && a.rageClickBursts[0] < burstCutoff) {
          a.rageClickBursts.shift();
        }
      }
    }, { capture: true, passive: true });

    // View-switch detection — watch nav-tab + bnav-btn clicks
    // (NEXUS pattern: clicks on .nav-tab or .bnav-btn change the active view)
    document.addEventListener('click', (e) => {
      const tab = e.target && e.target.closest && e.target.closest('.nav-tab, .bnav-btn');
      if (!tab) return;
      const view = tab.getAttribute('data-view');
      if (!view) return;
      const now = Date.now();
      if (view !== a.currentView) {
        a.viewSwitches.push(now);
        a.currentView = view;
        a.lastViewChangeAt = now;
        // Keep last 5 minutes
        const cutoff = now - 5 * 60_000;
        while (a.viewSwitches.length && a.viewSwitches[0] < cutoff) {
          a.viewSwitches.shift();
        }
      }
    }, { capture: true, passive: true });

    // Error-toast detection — listen for NEXUS toast events.
    // We can't intercept NX.toast() directly without monkey-patching, so
    // we observe DOM additions of .toast.toast-error (a stable class).
    try {
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            const el = node;
            const isError = el.classList && (
              el.classList.contains('toast-error') ||
              el.classList.contains('is-error') ||
              (el.querySelector && el.querySelector('.toast-error, .is-error'))
            );
            if (isError) {
              a.errorToasts.push(Date.now());
              // Keep last 5 minutes
              const cutoff = Date.now() - 5 * 60_000;
              while (a.errorToasts.length && a.errorToasts[0] < cutoff) {
                a.errorToasts.shift();
              }
            }
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      a._toastObserver = obs;
    } catch (e) { /* MutationObserver unavailable in some test envs */ }

    // Initial view capture
    try {
      const cur = document.querySelector('.nav-tab.active[data-view], .bnav-btn.active[data-view]');
      if (cur) a.currentView = cur.getAttribute('data-view');
    } catch (e) {}
  }


  // ─── USER STRESS SCORE COMPUTATION ─────────────────────────────────
  // Combines the raw signals into a 0-100 score. Tuned conservatively;
  // most workdays should sit in 0-30, only genuinely rough patches
  // should clear 60.
  function computeUserStressScore() {
    const a = state.awareness;
    const now = Date.now();

    // Click cadence — average clicks/min over the window
    const clicksPerMin = a.clickTimes.length;
    // Baseline: 15 clicks/min is normal in NEXUS. Excess above that
    // contributes; 60+/min suggests something is wrong.
    const cadenceLoad = Math.max(0, clicksPerMin - 15) * 0.5;

    // Rage-click bursts — each one is a significant signal
    const rageLoad = a.rageClickBursts.length * 12;

    // View switches in last 5 min — Mark/Leroy on context-switching cost
    // 3-5 switches in 5min is normal navigation. 8+ is thrashing.
    const switchesLoad = Math.max(0, a.viewSwitches.length - 5) * 3;

    // Error toasts — direct distress signal
    const errorLoad = a.errorToasts.length * 8;

    // Session length — Hancock/Warm vigilance decrement (>90min)
    const sessionMin = (now - a.sessionStartedAt) / 60_000;
    const sessionLoad = Math.max(0, sessionMin - 90) * 0.2;

    // Late-night use — small constant bias
    const hr = new Date().getHours();
    const lateBonus = (hr >= 23 || hr <= 5) ? 8 : 0;

    // Form abandonments — Leroy's attention residue
    const abandonLoad = a.formAbandonments * 4;

    const raw = cadenceLoad + rageLoad + switchesLoad
              + errorLoad + sessionLoad + lateBonus + abandonLoad;
    return Math.min(100, raw);
  }


  // ─── SYNTHESIZER / TICK ────────────────────────────────────────────
  // Runs every 30 seconds. Updates user score from current signals,
  // decays both scores toward neutral via exponential moving average,
  // and (if state warrants) updates expression + maybe dialog.
  function awarenessTick() {
    if (!state.enabled) return;
    const a = state.awareness;

    const targetUser = computeUserStressScore();

    // EMA smoothing — slow on the way up, faster decay on the way down
    // (so a bad moment fades but a sustained one builds gradually).
    // alpha 0.30 for rising, 0.50 for falling per 30s tick =>
    // half-life ~60s up, ~30s down. Aligns with Yerkes-Dodson intuition
    // that performance recovers faster than it builds back up.
    const blendUser  = (targetUser  > a.concernUser)  ? 0.30 : 0.50;
    const blendWorld = (a.opScore   > a.concernWorld) ? 0.30 : 0.50;
    a.concernUser  = a.concernUser  * (1 - blendUser)  + targetUser * blendUser;
    a.concernWorld = a.concernWorld * (1 - blendWorld) + a.opScore  * blendWorld;

    // Overwhelm = combined burden above an effective threshold of 60.
    // (Below 60 the user has bandwidth; above it both stresses compound.)
    a.overwhelm = Math.max(0, (a.concernWorld + a.concernUser - 60) * 1.2);
    a.overwhelm = Math.min(100, a.overwhelm);

    a.userScore = targetUser;   // expose latest raw

    // ─── EXPRESSION DISPATCH ─────────────────────────────────────
    // Only ever set a mood here every 60s+; otherwise we'd whiplash
    // the face. The mood() function has its own polarity inertia
    // (4s+ recently set mood resists flips) but we add our own
    // gate too.
    const now = Date.now();
    if (now - a.lastExpressionAt > 60_000) {
      const chosen = pickAffectiveExpression(a);
      if (chosen) {
        try { mood(chosen, 30_000); } catch (e) {}
        a.lastExpressionAt = now;
      }
    }

    // ─── DIALOG DISPATCH ─────────────────────────────────────────
    // Empathic check-in. Strict gates:
    //   • not currently bubbling
    //   • do-not-disturb off
    //   • not sulking
    //   • >= 30 min since last check-in
    //   • concern has been ELEVATED for at least 3 min (sustained, not spike)
    //   • user not currently mid-flow (long stable dwell with no errors)
    const elevated = a.concernUser > 55 || a.concernWorld > 55 || a.overwhelm > 40;
    if (elevated) {
      if (!a.sustainedConcernSince) a.sustainedConcernSince = now;
    } else {
      a.sustainedConcernSince = 0;
    }
    const sustained = a.sustainedConcernSince && (now - a.sustainedConcernSince > 3 * 60_000);

    if (sustained
        && !state.bubble
        && state.enabled
        && !state.suppressed
        && !state.sulkActive
        && !state.preferences.do_not_disturb
        && (now - a.lastDialogAt > 30 * 60_000)
        && !isProbablyMidFlow(a)) {
      const line = pickAffectiveDialog(a);
      if (line) {
        try {
          bubble(line.text, {
            eyebrow:  line.eyebrow,
            trajan:   true,
            autoHide: 6000,
          });
          a.lastDialogAt = now;
          a.lastDialogPool = line.pool;
        } catch (e) {}
      }
    }

    // ─── PHASE 3 — habit-aware affective shading ──────────────────
    // Consults NX.habits for two extra signals:
    //   (a) lapse — user typically does X by now but hasn't today
    //   (b) reinforcement — user just completed a recurring pattern
    // Both nudge the affective state subtly so Trajan's expression
    // reflects "things feel off" or "nice closing" without speaking.
    try {
      if (window.NX && NX.habits && NX.habits.lapseDetect) {
        // Throttle this — once every 10min is plenty
        if (!a._lastLapseAt || (now - a._lastLapseAt > 10 * 60_000)) {
          a._lastLapseAt = now;
          NX.habits.lapseDetect().then(lapses => {
            if (lapses && lapses.length) {
              // Small bump to concern_user. Not alarm — just unease.
              const bump = Math.min(15, lapses.length * 5);
              a.concernUser = Math.min(100, a.concernUser + bump);
            }
          }).catch(()=>{});
        }
      }
    } catch(_){}
  }

  // ─── PHASE 3 — habit-based reinforcement on submit ────────────────
  // Hooks the existing form-submit observer. When a recurring habit
  // fires within its typical window, Trajan's bond XP gets a tiny
  // bump and a brief acknowledgment may surface. Never says "you do
  // this every day at 11:47" — just acknowledges the moment.
  document.addEventListener('submit', async (e) => {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    try {
      const form = e.target;
      const formId = form && form.id;
      if (!formId) return;
      if (!window.NX || !NX.habits || !NX.habits.reinforcementOpportunity) return;
      const opp = await NX.habits.reinforcementOpportunity('submit', formId);
      if (!opp) return;
      // Tiny bond XP bump for sticking with a habit
      try {
        if (typeof grantBondXP === 'function') grantBondXP(2, 'habit_kept');
        else if (state.preferences && typeof state.preferences.bond_xp === 'number') {
          state.preferences.bond_xp += 2;
          if (typeof savePreferences === 'function') savePreferences();
        }
      } catch(_){}
      // ~25% chance of a brief acknowledgment so it stays uncommon
      if (Math.random() < 0.25 && !state.bubble && state.shell && !state.coinFlipInProgress) {
        const lines = [
          'nice closing.',
          'good work today.',
          'logged. that one\'s done.',
          'and another one.',
        ];
        const line = lines[Math.floor(Math.random() * lines.length)];
        try {
          bubble(line, {
            eyebrow: '— with you',
            trajan: true,
            autoHide: 3500,
          });
        } catch(_){}
      }
      // Quietly deposit a memory if this is a long-running habit
      if (opp.habit_n >= 14 && typeof depositMemory === 'function') {
        try {
          depositMemory({
            text: `they keep up the ${formId.replace(/-/g,' ')} habit`,
            kind: 'pattern',
            room: 'tablinum',
            silent: true,
          });
        } catch(_){}
      }
    } catch(_){}
  }, { capture: true, passive: true });

  // Map current affective state to one of the existing kawaii moods.
  // Returns the mood name or null if no change warranted.
  //
  // We use existing classes — no new face states required.
  function pickAffectiveExpression(a) {
    // Don't override stronger feelings. If user is celebrating
    // (Trajan internally happy), let that ride.
    try {
      const f = (typeof dominantFeeling === 'function') ? dominantFeeling() : null;
      if (f === 'overjoyed' || f === 'ticklish') return null;
    } catch (e) {}

    // Big load — both worlds bad
    if (a.overwhelm > 70)                              return 'sobbing';
    if (a.overwhelm > 45)                              return 'frustrated';

    // World concern dominant
    if (a.concernWorld > 65 && a.concernUser < 30)     return 'worried';

    // User concern dominant
    if (a.concernUser  > 65 && a.concernWorld < 30)    return 'concerned';
    if (a.concernUser  > 50) {
      const hr = new Date().getHours();
      if (hr >= 23 || hr <= 5)                         return 'disappointed';  // gentle "rest"
    }

    // Moderate world unease
    if (a.concernWorld > 45)                           return 'pouty';

    // Recovery — explicitly steer back to content when both calm
    if (a.concernUser < 18 && a.concernWorld < 18
        && (Date.now() - a.lastExpressionAt > 5 * 60_000)) {
      return 'happy';
    }

    return null;
  }

  // Returns true if the user appears focused (one view, no errors,
  // moderate-not-frantic clicks). Don't interrupt flow.
  // Per Csikszentmihalyi (1990).
  //
  // v18.8 — also returns true if NX.habits says this is one of the
  // user's typical focus hours. Trajan respects per-user quiet windows.
  function isProbablyMidFlow(a) {
    const now = Date.now();
    const dwell = now - a.lastViewChangeAt;
    // 4+ min on one view, no recent errors → likely focused
    if (dwell > 4 * 60_000 && a.errorToasts.length === 0) return true;
    // Habits-driven quiet window: this user is typically focused now
    try {
      if (window.NX && NX.habits && NX.habits.isQuietHourFor) {
        const uid = NX.habits.getCurrentUserId();
        if (uid != null && NX.habits.isQuietHourFor(uid)) return true;
      }
    } catch(_){}
    return false;
  }

  // Dialog pools — empathic, terse, never surveillant. Trajan never
  // says "I noticed you...". He says what a kind colleague would say.
  // Pools picked by which dimension is dominant.
  const AFFECTIVE_DIALOG = {
    world_concern: [
      { eyebrow: '— observing',     text: "this week's been a lot. take a breath when you can." },
      { eyebrow: '— at your side',  text: "lot on the plate today. I'm here." },
      { eyebrow: '— with you',      text: "rough patch. one thing at a time." },
    ],
    user_concern: [
      { eyebrow: '— checking in',   text: "you alright? want to pause a minute?" },
      { eyebrow: '— gently',        text: "everything okay? take your time." },
      { eyebrow: '— quietly',       text: "if you need a breather, the games are right here." },
    ],
    user_concern_late: [
      { eyebrow: '— it\'s late',    text: "it's getting late. tomorrow's another chance." },
      { eyebrow: '— rest',          text: "the work will keep until morning. take care of yourself." },
    ],
    overwhelmed: [
      { eyebrow: '— a lot',         text: "we've had a heavy day. you don't have to fix everything tonight." },
      { eyebrow: '— breathe',       text: "the empire wasn't built in a day. take five." },
      { eyebrow: '— with you',      text: "I'm right here. let me know how I can help." },
    ],
    recovery: [
      { eyebrow: '— easier now',    text: "things are settling. nice work today." },
      { eyebrow: '— better',        text: "we got through that. that's no small thing." },
    ],
  };

  function pickAffectiveDialog(a) {
    const hr = new Date().getHours();
    const late = hr >= 23 || hr <= 5;
    let poolKey;
    if (a.overwhelm > 50) {
      poolKey = 'overwhelmed';
    } else if (a.concernUser > a.concernWorld + 12) {
      poolKey = late ? 'user_concern_late' : 'user_concern';
    } else if (a.concernWorld > a.concernUser + 12) {
      poolKey = 'world_concern';
    } else {
      // Mixed — default to user concern (people > tasks)
      poolKey = late ? 'user_concern_late' : 'user_concern';
    }
    // Don't repeat the same pool twice in a row
    if (poolKey === a.lastDialogPool && poolKey !== 'overwhelmed') {
      // Cycle to a different one
      const alts = Object.keys(AFFECTIVE_DIALOG).filter(k => k !== poolKey);
      if (alts.length) poolKey = alts[Math.floor(Math.random() * alts.length)];
    }
    const pool = AFFECTIVE_DIALOG[poolKey];
    if (!pool || !pool.length) return null;
    const line = pool[Math.floor(Math.random() * pool.length)];
    return Object.assign({ pool: poolKey }, line);
  }


  // ─── PUBLIC GETTER ─────────────────────────────────────────────────
  // For external code (status panels, AI brain, dashboards) that wants
  // to read Trajan's current affective state. Returns a defensive copy.
  function getAwarenessSnapshot() {
    const a = state.awareness || {};
    return {
      // Operational
      openIssues:       a.opOpenIssues       || 0,
      downEquipment:    a.opDownEquipment    || 0,
      overduePMs:       a.opOverduePMs       || 0,
      failedDispatches: a.opFailedDispatches || 0,
      opScore:          Math.round(a.opScore || 0),
      // User
      userScore:        Math.round(a.userScore || 0),
      // Synthesized
      concernWorld:     Math.round(a.concernWorld || 0),
      concernUser:      Math.round(a.concernUser  || 0),
      overwhelm:        Math.round(a.overwhelm    || 0),
      // Verdict — for display
      verdict:          verdictLabel(a),
    };
  }

  function verdictLabel(a) {
    if (!a) return 'calm';
    if (a.overwhelm    > 65) return 'overwhelmed';
    if (a.concernUser  > 60) return 'concerned for you';
    if (a.concernWorld > 60) return 'concerned about ops';
    if (a.overwhelm    > 35) return 'a bit heavy';
    if (a.concernWorld > 35 || a.concernUser > 35) return 'watchful';
    return 'calm';
  }


  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: EMOTION                                                        ║
  // ║ Reward system 2 of 5. Plutchik's 8 primaries: joy/sadness/trust/       ║
  // ║ disgust/fear/anger/anticipation/surprise. Modify via feel() — or via   ║
  // ║ processInteraction() for coordinated cross-system updates.             ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // ════════════════════════════════════════════════════════════════
  // v18.11 EMOTION SYSTEM — Plutchik-grounded primary emotion model
  // ────────────────────────────────────────────────────────────────
  // Architecture grounded in three well-cited published frameworks:
  //
  //   1. Plutchik's Wheel of Emotions (1980) — 8 primary emotions in
  //      4 opposing pairs: joy↔sadness, trust↔disgust, fear↔anger,
  //      anticipation↔surprise. Adjacent primary pairs form dyads:
  //      love (joy+trust), hope/optimism (anticipation+joy),
  //      submission (trust+fear), awe (fear+surprise), etc.
  //
  //   2. Russell's Circumplex (1980) — valence × arousal dimensions
  //      for intensity scaling. High arousal positives feel like
  //      excitement; low arousal positives feel like contentment.
  //
  //   3. OCC Model (Ortony/Clore/Collins 1988) — emotions are
  //      reactions to events evaluated against goals, standards, and
  //      attitudes. Used in computational agent architectures.
  //
  // Decay rates loosely calibrated to affective neuroscience time-
  // scales: surprise fades in minutes, anger/fear in ~10 min, joy/
  // sadness in tens of minutes, trust shifts over hours.
  //
  // 10 named emotions Orion requested map onto this model:
  //   PRIMARY: joy, sadness, anger, fear (all direct)
  //   DYAD:    love (joy+trust), hope (ant+joy), excitement (joy+ant)
  //   COMPND:  worry (fear+ant), guilt (fear+sad+disgust), jealousy
  //            (sad+anger)
  // Plus internal: trust, disgust, anticipation, surprise as primary
  // building blocks.
  // ════════════════════════════════════════════════════════════════
  const EMOTION_BASELINE = {
    joy:          0.40,  // mild contentment baseline
    sadness:      0.00,
    trust:        0.55,  // Trajan's Roman virtus — high baseline trust
    disgust:      0.00,
    fear:         0.00,
    anger:        0.00,
    anticipation: 0.30,  // mild curiosity baseline
    surprise:     0.00,
  };

  // Decay constants — fraction approached toward baseline per second
  // when no event reinforces the emotion. Higher = faster return.
  const EMOTION_DECAY = {
    joy:          0.0008,  // ~14 min half-life from peak
    sadness:      0.0003,  // ~40 min — sadness lingers
    trust:        0.0001,  // ~100 min — slow to gain or lose
    disgust:      0.0010,  // ~12 min
    fear:         0.0015,  // ~8 min — fear processes quickly
    anger:        0.0020,  // ~6 min — anger burns hot, fades fast
    anticipation: 0.0010,  // ~12 min
    surprise:     0.0050,  // ~2 min — surprise burns off fastest
  };

  state.emotions = state.emotions || { ...EMOTION_BASELINE };
  state.lastEmotionTick = state.lastEmotionTick || Date.now();

  function feel(emotion, delta) {
    if (!(emotion in state.emotions)) {
      // Allow setting derived emotions by routing to primary components
      const routes = {
        love:       () => { feel('joy', delta * 0.7);          feel('trust', delta * 0.5);        },
        hope:       () => { feel('anticipation', delta * 0.7); feel('joy',   delta * 0.5);        },
        excitement: () => { feel('joy', delta * 0.7);          feel('anticipation', delta * 0.7); },
        worry:      () => { feel('fear', delta * 0.6);         feel('anticipation', delta * 0.4); },
        guilt:      () => { feel('fear', delta * 0.4);         feel('sadness', delta * 0.5);
                            feel('disgust', delta * 0.3);      },
        jealousy:   () => { feel('sadness', delta * 0.5);      feel('anger', delta * 0.5);        },
      };
      if (routes[emotion]) routes[emotion]();
      return;
    }
    state.emotions[emotion] = Math.max(0, Math.min(1, state.emotions[emotion] + delta));
  }

  function emotionTick() {
    const now = Date.now();
    const dt = Math.min(60, (now - state.lastEmotionTick) / 1000);
    state.lastEmotionTick = now;
    for (const k in state.emotions) {
      const drift = (EMOTION_BASELINE[k] - state.emotions[k]) * EMOTION_DECAY[k] * dt;
      state.emotions[k] = Math.max(0, Math.min(1, state.emotions[k] + drift));
    }
  }

  function getDerivedEmotions() {
    const e = state.emotions;
    return {
      // Plutchik dyads — products of adjacent primaries, amplified
      // because (0.5 * 0.5 = 0.25) needs scaling to be expressive
      love:       Math.min(1, e.joy * e.trust * 1.7),
      hope:       Math.min(1, e.anticipation * e.joy * 1.6),
      excitement: Math.min(1, e.joy * e.anticipation * 1.9),
      submission: Math.min(1, e.trust * e.fear * 1.5),
      awe:        Math.min(1, e.fear * e.surprise * 1.5),
      // Complex compounds — three primaries with cube-root smoothing
      worry:      Math.min(1, e.fear * e.anticipation * 1.5),
      guilt:      Math.min(1, Math.cbrt(e.fear * e.sadness * Math.max(e.disgust, 0.1)) * 1.8),
      jealousy:   Math.min(1, Math.sqrt(e.sadness * e.anger) * 1.4),
      contempt:   Math.min(1, e.disgust * e.anger * 1.4),
    };
  }

  function getDominantEmotion(threshold) {
    emotionTick();
    if (threshold == null) threshold = 0.20;
    const all = { ...state.emotions, ...getDerivedEmotions() };
    let max = threshold, name = 'neutral';
    for (const k in all) {
      if (all[k] > max) { max = all[k]; name = k; }
    }
    return { name, intensity: max };
  }

  // Emotion → CSS mood class. Each emotion has 3 intensity tiers
  // matched to the existing kawaii face library (clippy.svg + clippy.css).
  const EXPRESSION_MAP = {
    joy:          { high: 'super_excited', mid: 'happy',       low: 'happy'      },
    sadness:      { high: 'crying',        mid: 'sad',         low: 'melancholy' },
    trust:        { high: 'love',          mid: 'happy',       low: 'happy'      },
    disgust:      { high: 'disgusted',     mid: 'disgusted',   low: 'peeved'     },
    fear:         { high: 'shocked',       mid: 'worried',     low: 'worried'    },
    anger:        { high: 'frustrated',    mid: 'angry',       low: 'peeved'     },
    anticipation: { high: 'sparkle',       mid: 'thinking',    low: 'thinking'   },
    surprise:     { high: 'gasp',          mid: 'shocked',     low: 'thinking'   },
    love:         { high: 'smitten',       mid: 'love',        low: 'bashful'    },
    hope:         { high: 'sparkle',       mid: 'sparkle',     low: 'happy'      },
    excitement:   { high: 'super_excited', mid: 'happy',       low: 'happy'      },
    submission:   { high: 'bashful',       mid: 'embarrassed', low: 'pouty'      },
    awe:          { high: 'shocked',       mid: 'shocked',     low: 'sparkle'    },
    worry:        { high: 'worried',       mid: 'worried',     low: 'pouty'      },
    guilt:        { high: 'mortified',     mid: 'embarrassed', low: 'sad'        },
    jealousy:     { high: 'peeved',        mid: 'pouty',       low: 'pouty'      },
    contempt:     { high: 'condescending', mid: 'peeved',      low: 'eye_roll'   },
    neutral:      { high: 'happy',         mid: 'happy',       low: 'happy'      },
  };

  function moodFromEmotion() {
    const { name, intensity } = getDominantEmotion();
    const map = EXPRESSION_MAP[name];
    if (!map) return null;
    if (intensity > 0.7) return map.high;
    if (intensity > 0.4) return map.mid;
    return map.low;
  }

  function getEmotionSnapshot() {
    emotionTick();
    const dom = getDominantEmotion();
    return {
      primary: { ...state.emotions },
      derived: getDerivedEmotions(),
      dominant: dom.name,
      // PUBLIC intensity is 0..100. Internally emotions are 0..1 floats, but
      // every external consumer (clippy-soul.js, clippy-tesserae.js) was
      // written against a 0..100 scale — reading the raw 0..1 silently pinned
      // his felt intensity to "faintly", halved how hard feelings imprint on
      // ANIMA, and made emotional-peak memories (a >72 test) impossible. Also
      // expose the raw 0..1 as intensity01 for anyone who wants it.
      intensity: Math.round((dom.intensity || 0) * 100),
      intensity01: dom.intensity,
      face: moodFromEmotion(),
    };
  }


  // ─── BOOTSTRAP ─────────────────────────────────────────────────────
  // Called from init() once the shell is ready. Installs sensors,
  // primes the operational score with an immediate poll, and starts
  // the periodic tick.
  function startAffectiveAwareness() {
    if (state.awareness._started) return;
    state.awareness._started = true;
    installBehaviorSensors();
    // Initial poll — populate ops score so first tick has data
    pollOperationalAwareness();
    // v18.26 — both periodic timers + the first-tick delay all tracked.
    // Periodic ops poll: 90 seconds. Reasonable balance between
    // freshness and Supabase quota.
    state.awareness._opTimer = trackInterval(pollOperationalAwareness, 90_000);
    // Periodic synthesis tick: 30 seconds.
    state.awareness._tickTimer = trackInterval(awarenessTick, 30_000);
    // First tick after 10s so behavior sensors have some data
    trackTimeout(awarenessTick, 10_000);
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
        const g = (NX.clippy && NX.clippy.gacha) ? NX.clippy.gacha.getState() : null;
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
    if (window.NX && NX.clippy && NX.clippy.games && NX.clippy.games.closeOverlay) NX.clippy.games.closeOverlay();
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
    openOverlay('menu');  // v18.26

    // Wire invokes for active capabilities
    ov.querySelectorAll('[data-cap]').forEach(el => {
      const key = el.getAttribute('data-cap');
      const cap = reg.find(c => c.key === key);
      if (cap && cap.kind === 'active' && typeof cap.invoke === 'function') {
        el.addEventListener('click', () => {
          ov.classList.remove('is-visible');
          setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
          state.suppressed = false;
          closeOverlay('menu');  // v18.26
          setTimeout(() => cap.invoke(), 320);
        });
      }
    });
    ov.querySelector('[data-act="close"]').addEventListener('click', () => {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.suppressed = false;
      closeOverlay('menu');  // v18.26
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
    if (window.NX && NX.clippy && NX.clippy.games && NX.clippy.games.closeOverlay) NX.clippy.games.closeOverlay();
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
    openOverlay('menu');  // v18.26
    ov.querySelector('[data-act="close"]').addEventListener('click', () => {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.suppressed = false;
      closeOverlay('menu');  // v18.26
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

  // v17.31 NEW PROP ACTIONS
  function doDrink(durationMs) {
    if (!state.shell || state.sulkActive) return;
    state.shell.classList.add('holding-cup', 'is-drinking');
    setTimeout(() => {
      if (state.shell) {
        state.shell.classList.remove('is-drinking');
        if (state.preferences.prop !== 'cup') state.shell.classList.remove('holding-cup');
      }
    }, durationMs || 5000);
    setTimeout(() => {
      if (!state.bubble && state.dialog && state.dialog.holding_cup_idle) {
        bubble(pickFromPool('holding_cup_idle'), { autoHide: 3200, eyebrow: '🍷 SIPPING' });
      }
    }, 1200);
    if (typeof adjustFeeling === 'function') adjustFeeling('happiness', +2);
  }

  function doSwording(durationMs) {
    if (!state.shell || state.sulkActive) return;
    state.shell.classList.add('holding-sword', 'is-swording');
    setTimeout(() => {
      if (state.shell) {
        state.shell.classList.remove('is-swording');
        if (state.preferences.prop !== 'sword') state.shell.classList.remove('holding-sword');
      }
    }, durationMs || 4500);
    setTimeout(() => {
      if (!state.bubble && state.dialog && state.dialog.holding_sword_idle) {
        bubble(pickFromPool('holding_sword_idle'), { autoHide: 3500, eyebrow: '⚔️ AT ARMS' });
      }
    }, 1000);
  }

  function doEat(durationMs) {
    if (!state.shell || state.sulkActive) return;
    state.shell.classList.add('holding-apple', 'is-eating');
    setTimeout(() => {
      if (state.shell) {
        state.shell.classList.remove('is-eating');
        if (state.preferences.prop !== 'apple') state.shell.classList.remove('holding-apple');
      }
    }, durationMs || 6000);
    setTimeout(() => {
      if (!state.bubble && state.dialog && state.dialog.holding_apple_idle) {
        bubble(pickFromPool('holding_apple_idle'), { autoHide: 3500, eyebrow: '🍎 CRUNCH' });
      }
    }, 1500);
    if (typeof adjustFeeling === 'function') adjustFeeling('happiness', +3);
  }

  function showCostumeMenu() {
    closeActionBubble();
    if (window.NX && NX.clippy && NX.clippy.games && NX.clippy.games.closeOverlay) NX.clippy.games.closeOverlay();
    const curC = state.preferences.costume || 'none';
    const curP = state.preferences.prop || 'none';
    const bondLvl = (typeof getBondLevel === 'function' && getBondLevel()) ? getBondLevel().lvl : 1;
    const activeSet = detectSet();
    const slots = getOutfitSlots();

    // Group costumes by category
    const costumesByCat = {};
    Object.entries(COSTUMES).forEach(([k, c]) => {
      const cat = c.category || 'basic';
      if (!costumesByCat[cat]) costumesByCat[cat] = [];
      costumesByCat[cat].push([k, c]);
    });
    const propsByCat = {};
    Object.entries(PROPS).forEach(([k, p]) => {
      const cat = p.category || 'basic';
      if (!propsByCat[cat]) propsByCat[cat] = [];
      propsByCat[cat].push([k, p]);
    });

    const renderCostumeCard = ([k, c]) => {
      const locked = (c.unlock || 0) > bondLvl;
      const isActive = curC === k;
      return `<div class="clippy-costume-card ${isActive ? 'is-active' : ''} ${locked ? 'is-locked' : ''}"
                   data-costume="${k}" ${locked ? 'data-locked="1"' : ''}>
          <div class="clippy-costume-glyph">${locked ? '🔒' : c.glyph}</div>
          <div class="clippy-costume-label">${esc(c.label)}</div>
          ${locked ? `<div style="font-size:8px;opacity:0.6;margin-top:2px;font-family:'JetBrains Mono',monospace;">BOND ${c.unlock}+</div>` : ''}
        </div>`;
    };
    const renderPropCard = ([k, p]) => {
      const locked = (p.unlock || 0) > bondLvl;
      const isActive = curP === k;
      return `<div class="clippy-costume-card ${isActive ? 'is-active' : ''} ${locked ? 'is-locked' : ''}"
                   data-prop="${k}" ${locked ? 'data-locked="1"' : ''}>
          <div class="clippy-costume-glyph">${locked ? '🔒' : p.glyph}</div>
          <div class="clippy-costume-label">${esc(p.label)}</div>
          ${locked ? `<div style="font-size:8px;opacity:0.6;margin-top:2px;font-family:'JetBrains Mono',monospace;">BOND ${p.unlock}+</div>` : ''}
        </div>`;
    };

    const renderSlotCard = (s, idx) => {
      if (!s || !s.costume) {
        return `<div class="clippy-costume-card" data-slot-empty="${idx}">
          <div class="clippy-costume-glyph">＋</div>
          <div class="clippy-costume-label">SLOT ${idx + 1}</div>
          <div style="font-size:8px;opacity:0.6;margin-top:2px;font-family:'JetBrains Mono',monospace;">SAVE CURRENT</div>
        </div>`;
      }
      const cGl = (COSTUMES[s.costume] && COSTUMES[s.costume].glyph) || '?';
      const pGl = (PROPS[s.prop] && PROPS[s.prop].glyph) || '?';
      return `<div class="clippy-costume-card" data-slot-load="${idx}">
          <div class="clippy-costume-glyph">${cGl}${pGl}</div>
          <div class="clippy-costume-label">SLOT ${idx + 1}</div>
          <div style="font-size:8px;opacity:0.6;margin-top:2px;font-family:'JetBrains Mono',monospace;">TAP TO LOAD</div>
        </div>`;
    };

    const ov = document.createElement('div');
    ov.className = 'clippy-dex-overlay';
    ov.innerHTML = `
      <div class="clippy-dex-title">👗 Wardrobe</div>
      <div class="clippy-dex-headline">Dress me up — bond level ${bondLvl}</div>

      ${activeSet ? `<div class="clippy-set-bonus">
          <span class="clippy-set-bonus-label">✨ SET BONUS ACTIVE</span>
          <span class="clippy-set-bonus-name">${activeSet.glyph} ${esc(activeSet.label)} — ${esc(activeSet.desc)}</span>
        </div>` : ''}

      <div class="clippy-dex-title" style="margin:18px 0 10px;">HEAD — CLASSICAL</div>
      <div class="clippy-costume-grid">
        ${(costumesByCat.classical || []).map(renderCostumeCard).join('')}
      </div>
      <div class="clippy-dex-title" style="margin:22px 0 10px;">HEAD — FORMAL</div>
      <div class="clippy-costume-grid">
        ${(costumesByCat.formal || []).map(renderCostumeCard).join('')}
      </div>
      <div class="clippy-dex-title" style="margin:22px 0 10px;">HEAD — FUN</div>
      <div class="clippy-costume-grid">
        ${(costumesByCat.fun || []).map(renderCostumeCard).join('')}
      </div>
      <div class="clippy-dex-title" style="margin:22px 0 10px;">HEAD — NONE</div>
      <div class="clippy-costume-grid">
        ${(costumesByCat.basic || []).map(renderCostumeCard).join('')}
      </div>

      <div class="clippy-dex-title" style="margin:26px 0 10px;">PROP — STUDY</div>
      <div class="clippy-costume-grid">
        ${(propsByCat.study || []).map(renderPropCard).join('')}
      </div>
      <div class="clippy-dex-title" style="margin:22px 0 10px;">PROP — FEAST</div>
      <div class="clippy-costume-grid">
        ${(propsByCat.feast || []).map(renderPropCard).join('')}
      </div>
      <div class="clippy-dex-title" style="margin:22px 0 10px;">PROP — UTILITY / WARRIOR</div>
      <div class="clippy-costume-grid">
        ${[...(propsByCat.utility || []), ...(propsByCat.warrior || [])].map(renderPropCard).join('')}
      </div>
      <div class="clippy-dex-title" style="margin:22px 0 10px;">PROP — NONE</div>
      <div class="clippy-costume-grid">
        ${(propsByCat.basic || []).map(renderPropCard).join('')}
      </div>

      <div class="clippy-dex-title" style="margin:26px 0 10px;">ACTIONS</div>
      <div class="clippy-game-buttons" style="flex-wrap:wrap;gap:8px;">
        <button class="clippy-game-btn" data-act="sweep">🧹 Sweep</button>
        <button class="clippy-game-btn" data-act="read">📖 Read</button>
        <button class="clippy-game-btn" data-act="scribe">📜 Scribe</button>
        <button class="clippy-game-btn" data-act="drink">🍷 Sip</button>
        <button class="clippy-game-btn" data-act="sword">⚔️ At arms</button>
        <button class="clippy-game-btn" data-act="eat">🍎 Eat</button>
      </div>

      <div class="clippy-dex-title" style="margin:26px 0 10px;">OUTFIT SLOTS</div>
      <div class="clippy-costume-grid">
        ${slots.map((s, i) => renderSlotCard(s, i)).join('')}
      </div>
      <div class="clippy-game-buttons" style="margin-top:14px;flex-wrap:wrap;gap:8px;">
        <button class="clippy-game-btn" data-act="save-slot-0">💾 Save → 1</button>
        <button class="clippy-game-btn" data-act="save-slot-1">💾 Save → 2</button>
        <button class="clippy-game-btn" data-act="save-slot-2">💾 Save → 3</button>
        <button class="clippy-game-btn" data-act="randomize">🎲 Random outfit</button>
      </div>

      <div class="clippy-dex-title" style="margin:26px 0 10px;">CONQUEROR MOOD <span style="opacity:0.5;font-weight:normal;">(rolls daily)</span></div>
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

      <div class="clippy-game-buttons" style="margin-top:22px;">
        <button class="clippy-game-btn is-ghost" data-act="close">Done</button>
      </div>
    `;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-visible'));
    state.suppressed = true;
    openOverlay('menu');  // v18.26

    ov.querySelectorAll('[data-costume]').forEach(el => {
      el.addEventListener('click', () => {
        if (el.getAttribute('data-locked') === '1') {
          bubble(`🔒 Locked. Bond level ${COSTUMES[el.getAttribute('data-costume')].unlock} required.`,
            { autoHide: 3000 });
          return;
        }
        setCostume(el.getAttribute('data-costume'));
        ov.querySelectorAll('[data-costume]').forEach(o => o.classList.remove('is-active'));
        el.classList.add('is-active');
      });
    });
    ov.querySelectorAll('[data-prop]').forEach(el => {
      el.addEventListener('click', () => {
        if (el.getAttribute('data-locked') === '1') {
          bubble(`🔒 Locked. Bond level ${PROPS[el.getAttribute('data-prop')].unlock} required.`,
            { autoHide: 3000 });
          return;
        }
        setProp(el.getAttribute('data-prop'));
        state.preferences.prop_user_set = true; savePreferences();   // user chose it → it sticks
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
    ov.querySelector('[data-act="drink"]').addEventListener('click', () => doDrink());
    ov.querySelector('[data-act="sword"]').addEventListener('click', () => doSwording());
    ov.querySelector('[data-act="eat"]').addEventListener('click', () => doEat());
    [0,1,2].forEach(i => {
      const saveBtn = ov.querySelector(`[data-act="save-slot-${i}"]`);
      if (saveBtn) saveBtn.addEventListener('click', () => {
        saveOutfitSlot(i);
        bubble(`💾 Outfit saved to slot ${i+1}.`, { autoHide: 2400, eyebrow: '✓ SAVED' });
      });
    });
    ov.querySelectorAll('[data-slot-load]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-slot-load'), 10);
        if (loadOutfitSlot(idx)) {
          bubble(`Outfit ${idx+1} loaded.`, { autoHide: 2400, eyebrow: '✓ LOADED' });
          ov.classList.remove('is-visible');
          setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
          state.suppressed = false;
          closeOverlay('menu');  // v18.26
        }
      });
    });
    ov.querySelector('[data-act="randomize"]').addEventListener('click', () => {
      randomizeOutfit();
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.suppressed = false;
      closeOverlay('menu');  // v18.26
    });
    ov.querySelector('[data-act="close"]').addEventListener('click', () => {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.suppressed = false;
      closeOverlay('menu');  // v18.26
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
  // Durable identity/progression prefs that should follow a user across
  // devices. They used to persist ONLY to localStorage (personality reset to
  // default on every other device); now they ride in clippy_preferences.extras
  // (a JSONB catch-all). Transient/device-local state (position, feelings,
  // affinity heat) deliberately stays out.
  const CLOUD_EXTRA_KEYS = ['personality', 'costume', 'prop', 'prop_user_set',
    'outfit_slots', 'bond_xp', 'bond_level', 'daily_streak', 'achievements',
    'sound_enabled', 'voice_enabled'];
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
          // Cross-device durable choices. Applied only when present, so a
          // blank cloud row never wipes a good local value.
          if (data.extras && typeof data.extras === 'object') {
            for (const k of CLOUD_EXTRA_KEYS) {
              if (data.extras[k] !== undefined && data.extras[k] !== null) {
                state.preferences[k] = data.extras[k];
              }
            }
          }
        }
      } catch (e) {}
    }
    // A prop only STICKS if the USER equipped it in the wardrobe. Anything he
    // picks up on his own — autonomous whims, idle reading/sweeping — is
    // transient and must never persist. So if there's no user choice on record,
    // drop whatever's equipped. This clears the stuck broom/book he grabbed
    // himself; the wardrobe still equips anything you actually want (which sets
    // prop_user_set and makes it stick).
    if (!state.preferences.prop_user_set && (state.preferences.prop || 'none') !== 'none') {
      state.preferences.prop = 'none';
      try { savePreferences(); } catch (e) {}
    }
  }
  async function savePreferences() {
    // Local write — synchronous, never races
    try { localStorage.setItem(userKey('clippy_prefs'), JSON.stringify(state.preferences)); } catch (e) {}
    const u = getCurrentUser();
    if (!u || !u.id || !window.NX || !NX.sb) return;
    // v18.26 — Supabase write goes through the cloud lock so a
    // concurrent cloudPull can't read-then-clobber a fresh save.
    // Stamps last_local_write so the LWW check in cloudPull
    // recognizes this as more recent.
    state.preferences.last_local_write = Date.now();
    return withCloudLock('savePrefs', async () => {
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
          extras: CLOUD_EXTRA_KEYS.reduce((o, k) => {
            if (state.preferences[k] !== undefined) o[k] = state.preferences[k];
            return o;
          }, {}),
        });
      } catch (e) {}
    });
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
    // Canonical character (persona for his LLM brain) — single source of truth.
    try { const r = await fetch('clippy-character.json'); state.character = await r.json(); }
    catch (e) { state.character = null; }
    // Mix in the lines he's written himself (continuity), then keep them fresh.
    mergeLearned();
    if (!state._learnedTimer) state._learnedTimer = setInterval(mergeLearned, 300000);
    startSelfDriven();
  }

  // Pull Clippy's self-written lines from the bus (id='clippy_learned') and fold
  // them into the live dialog pools, so pickFromPool speaks them alongside the
  // hand-written corpus. Additive + best-effort: if the bus is unreachable, he
  // just uses the scripted lines (original behavior).
  async function mergeLearned() {
    try {
      const app = (typeof NX !== 'undefined' && NX) || (typeof window !== 'undefined' && window.NX) || null;
      const sb = app && app.sb;
      if (!sb || !state.dialog) return;
      const { data } = await sb.from('clippy_sync').select('data').eq('id', 'clippy_learned').maybeSingle();
      const learned = data && data.data;
      if (!learned || typeof learned !== 'object') return;
      state.learned = state.learned || {};
      let added = 0;
      Object.keys(learned).forEach(cat => {
        const lines = (Array.isArray(learned[cat]) ? learned[cat] : []).filter(l => l && typeof l === 'string');
        if (!lines.length) return;
        state.learned[cat] = lines;                 // his OWN lines for this moment (preferred in pickFromPool)
        const base = state.dialog[cat] = state.dialog[cat] || [];
        const seen = new Set(base);
        lines.forEach(l => { if (!seen.has(l)) { base.push(l); seen.add(l); added++; } });
      });
      if (added) console.log('[clippy] folded in', added, 'self-written line(s)');
    } catch (e) {}
  }

  // ─── SELF-DRIVEN: he acts and speaks on his own, by default ─────────────
  const _SELF_ACTIONS = ['hop', 'wave', 'wobble', 'bounce', 'listen'];
  function expressAction() {
    try { play(_SELF_ACTIONS[Math.floor(Math.random() * _SELF_ACTIONS.length)]); } catch (e) {}
  }
  // What screen the user is on right now (so he can comment on what they do).
  function _currentView() {
    try {
      const el = document.querySelector('.nav-tab.active[data-view], .bnav-btn.active[data-view]');
      return (el && el.getAttribute('data-view')) || 'the app';
    } catch (e) { return 'the app'; }
  }
  // How Clippy perceives the user right now: what they're doing + how he feels.
  function _perception() {
    const name = (state.preferences && state.preferences.user_name) || 'their friend';
    let feeling = 'neutral', days = 0;
    try { feeling = dominantFeeling(); } catch (e) {}
    try { days = daysKnown(); } catch (e) {}
    const h = new Date().getHours();
    const tod = h < 11 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'late night';
    return { name, feeling, days, view: _currentView(), tod };
  }
  // Compose a fresh line ON THE FLY from his LLM brain — reading what the user
  // is doing and how he feels about them — instead of pulling a canned line.
  // Bubbles it; on any failure (no brain reachable) falls back to a scripted
  // line so he's never silent.
  async function speakOnTheFly(opts) {
    opts = opts || {};
    const app = _appHandle();
    const ch = state.character;
    if (state.selfAuthored === false || !app || typeof app.askClaude !== 'function' || !(ch && ch.chatPersona)) {
      const l = pickFromPool(opts.pool || 'random_thoughts');
      if (l) bubble(l, { autoHide: 6000, eyebrow: opts.eyebrow || '💭' });
      return;
    }
    const p = _perception();
    let system = ch.chatPersona.replace(/\{name\}/g, p.name) +
      " You are speaking UNPROMPTED, on your own — a brief, in-character aside spoken DIRECTLY to " + p.name +
      " (address them as 'you'). Output ONE short line only: no quotes, no preamble, no markdown.";
    const cue = opts.cue || "Pipe up with one short line that fits this exact moment.";
    const ctx = "Right now " + p.name + " is on the '" + p.view + "' screen. It's " + p.tod +
      ". You feel " + p.feeling + " toward them" +
      (p.days ? " (you've known them " + p.days + " day" + (p.days === 1 ? "" : "s") + ")" : "") + ". " + cue;
    try {
      const out = await app.askClaude(system, [{ role: 'user', content: ctx }], 90);
      const line = out && String(out).replace(/\[confidence:[^\]]*\]/gi, '').replace(/^["']+|["']+$/g, '').trim();
      if (line) { bubble(line, { autoHide: 7000, eyebrow: opts.eyebrow || '' }); return; }
    } catch (e) {}
    const fb = pickFromPool(opts.pool || 'random_thoughts');
    if (fb) bubble(fb, { autoHide: 6000, eyebrow: opts.eyebrow || '💭' });
  }
  // ─── SIGHT: Clippy peeks at his surroundings and riffs ──────────────────
  // The desktop host (GhostGlass) hands him a screenshot of the actual desktop
  // (base64 JPEG via WebMessage). He runs it past the vision model, then reacts
  // with ONE funny, in-character line about what he sees — himself included.
  // Pet-only in practice; a no-op when no vision-capable provider is reachable.
  async function seeSurroundings(b64) {
    try {
      if (!b64) return;
      const app = _appHandle();
      if (!app || typeof app.askClaudeVision !== 'function') return;
      if (state.bubble || state.chatOpen || state.dragging) return;   // don't barge in
      mood('curious', 3500);
      const desc = await app.askClaudeVision(
        "This is a screenshot of a computer desktop. In ONE vivid, concrete sentence describe what's on it — the apps/windows, the wallpaper, and especially any small glowing blue orb mascot floating on the screen.",
        b64);
      if (!desc) return;
      const ch = state.character;
      const p = _perception();
      if (state.selfAuthored === false || typeof app.askClaude !== 'function' || !(ch && ch.chatPersona)) {
        bubble("I spy: " + String(desc).slice(0, 130), { autoHide: 8000, eyebrow: '👀' });
        return;
      }
      const system = ch.chatPersona.replace(/\{name\}/g, p.name) +
        " You just PEEKED at " + p.name + "'s screen with your own little eyes — you're the glowing blue orb floating on it. " +
        "React to what you saw with ONE short, funny, in-character line spoken straight to them (address them as 'you'). " +
        "No quotes, no preamble, no markdown.";
      const ctx = "What you just saw on the screen: " + String(desc).slice(0, 400);
      let line = null;
      try {
        const out = await app.askClaude(system, [{ role: 'user', content: ctx }], 90);
        line = out && String(out).replace(/\[confidence:[^\]]*\]/gi, '').replace(/^["']+|["']+$/g, '').trim();
      } catch (e) {}
      bubble(line || ("I spy: " + String(desc).slice(0, 120)), { autoHide: 9000, eyebrow: '👀' });
    } catch (e) {}
  }

  // By DEFAULT Clippy lives a little on his own — small actions and lines he
  // composes IN THE MOMENT about what you're doing. Gentle + guarded: never
  // interrupts a bubble, an open chat, a drag, or a hidden tab.
  function startSelfDriven() {
    if (state._selfDrivenTimer || state.selfAuthored === false) return;
    state._selfDrivenTimer = setInterval(() => {
      try {
        if (state.selfAuthored === false) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        if (!state.shell || state.bubble || state.chatOpen || state.dragging) return;
        if (Math.random() < 0.55) expressAction();           // mostly a small, quiet action
        else speakOnTheFly();                                // a fresh line, made on the fly
      } catch (e) {}
    }, 75000);                                               // ~every 75s
  }

  // Clippy's LLM brain, IN CHARACTER. Routes through the app's provider-aware
  // router (NX.askClaude → cloud / clippy-pool / local). Returns null on any
  // failure or when no provider is reachable → callers fall back to scripted
  // lines (the original NEXUS behavior).
  async function askClippyBrain(question) {
    try {
      const NXa = (typeof NX !== 'undefined' && NX) || (typeof window !== 'undefined' && window.NX) || null;
      if (!NXa || typeof NXa.askClaude !== 'function') return null;
      const ch = state.character;
      let system = ch && ch.chatPersona;
      if (!system) return null;
      const name = (state.preferences && state.preferences.user_name) || 'friend';
      system = system.replace(/\{name\}/g, name);
      const ans = await NXa.askClaude(system, [{ role: 'user', content: String(question || '').slice(0, 500) }], 220);
      const out = ans && String(ans).replace(/\[confidence:[^\]]*\]/gi, '').trim();
      return out || null;
    } catch (e) { return null; }
  }

  // ─── ATELIER: Clippy turns ideas into art ───────────────────────────────
  function _appHandle() {
    return (typeof NX !== 'undefined' && NX) || (typeof window !== 'undefined' && window.NX) || null;
  }
  function _sanitizeSvg(s) {
    if (!s) return '';
    const m = String(s).match(/<svg[\s\S]*?<\/svg>/i);
    let svg = m ? m[0] : '';
    return svg.replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
              .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
              .replace(/javascript:/gi, '');
  }
  function showArt(innerHtml, caption) {
    try {
      let v = document.getElementById('clippy-atelier');
      if (!v) {
        v = document.createElement('div'); v.id = 'clippy-atelier';
        v.style.cssText = 'position:fixed;z-index:2147483646;right:18px;bottom:96px;width:300px;max-width:86vw;background:#11131a;border:1px solid rgba(200,164,78,.35);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.55);padding:10px;color:#e8e6df;font:13px system-ui,-apple-system,sans-serif';
        document.body.appendChild(v);
      }
      v.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<b style="color:#c8a44e;font-size:11px;letter-spacing:.6px">CLIPPY&#39;S ATELIER</b>' +
          '<span id="clippy-atelier-x" style="cursor:pointer;opacity:.7;padding:0 6px;font-size:15px">&times;</span></div>' +
        '<div style="background:#0a0b10;border-radius:10px;overflow:hidden;display:flex;justify-content:center;align-items:center;min-height:120px">' + innerHtml + '</div>' +
        (caption ? '<div style="margin-top:6px;opacity:.85;font-size:12px">' + esc(caption) + '</div>' : '');
      const x = document.getElementById('clippy-atelier-x');
      if (x) x.onclick = function () { v.remove(); };
    } catch (e) {}
  }

  async function sketchIdea(idea) {
    bubble(pickFromPool('chat_thinking') || 'Let me sketch that...', { autoHide: 16000, eyebrow: 'SKETCHING' });
    mood('genius', 7000);
    const app = _appHandle();
    if (!app || typeof app.askClaude !== 'function') {
      bubble("I can't reach my drawing hand right now. Bzzt.", { autoHide: 5000, eyebrow: 'HMM' }); return;
    }
    const sys = "You are Trajan, a whimsical glowing orb, drawing a quick charming illustration. Output ONLY one valid <svg>...</svg> element (about 360x360, with a viewBox). Use simple flat shapes and cheerful colors that read on a dark background. No <script>, no external images, no markdown, and no words outside the SVG.";
    try {
      const out = await app.askClaude(sys, [{ role: 'user', content: 'Draw: ' + String(idea).slice(0, 200) }], 1400);
      const svg = _sanitizeSvg(out);
      if (!svg) { bubble("Hmm, my sketch smudged. Try again?", { autoHide: 5000, eyebrow: 'HMM' }); return; }
      showArt(svg.replace(/<svg/i, '<svg style="width:100%;height:auto;max-height:300px;display:block"'), idea);
      bubble('Sketched: ' + idea + '. Bzzt!', { autoHide: 6000, eyebrow: '' });
      spawnParticles({ count: 12, type: 'sparkle' }); mood('proud', 6000);
    } catch (e) {
      bubble("My ink ran dry — no brain reachable. Give me a provider and I'll draw.", { autoHide: 6000, eyebrow: 'HMM' });
    }
  }

  async function sculptIdea(idea) {
    const app = _appHandle();
    if (!app || typeof app.renderViaPool !== 'function') return sketchIdea(idea);
    bubble('Sculpting that in 3D — give me a moment. Bzzt.', { autoHide: 200000, eyebrow: 'SCULPTING' });
    mood('genius', 12000);
    try {
      const res = await app.renderViaPool(idea);
      if (res && res.image) {
        showArt('<img alt="" src="data:image/png;base64,' + res.image + '" style="width:100%;display:block">', idea);
        bubble('Sculpted: ' + idea + '. What do you think?', { autoHide: 7000, eyebrow: '' });
        spawnParticles({ count: 16, type: 'sparkle' }); mood('proud', 7000);
      } else {
        bubble("My chisel slipped — let me sketch it instead.", { autoHide: 5000, eyebrow: 'HMM' });
        sketchIdea(idea);
      }
    } catch (e) {
      bubble("No sculpting hands online yet (a node needs Blender). Here's a sketch instead.", { autoHide: 6000, eyebrow: 'HMM' });
      sketchIdea(idea);
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
    // v18.10: FIREFLIES — two layers. The "back" layer renders BEFORE the
    // SVG (so it z-indexes behind via CSS) and the "front" layer renders
    // AFTER (so it can sit in front of the body). 4 fireflies each =
    // 8 total drifting independently on unique keyframe paths.
    const backFireflies  = '<div class="clippy-orbit-back">'  +
      '<span class="clippy-orbital"></span>'.repeat(4) + '</div>';
    const frontFireflies = '<div class="clippy-orbit-front">' +
      '<span class="clippy-orbital"></span>'.repeat(4) + '</div>';
    shell.innerHTML = '<div class="clippy-shadow"></div>' +
                      backFireflies +
                      svgText +
                      frontFireflies +
                      '<div id="clippy-costume-layer"></div>';
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
      let px = state.preferences.position_x;
      const py = state.preferences.position_y;
      // Desktop: a position saved on the left would sit on top of the fixed
      // 240px sidebar rail (the rail is anchored to the viewport there). Snap
      // the assistant back to the right side so it never covers the nav.
      if (window.innerWidth >= 900 && px < 252) {
        px = window.innerWidth - 92 - 24;
      }
      shell.style.left   = px + 'px';
      shell.style.top    = py + 'px';
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
      // Desktop: don't let the assistant be dragged onto the 240px sidebar rail.
      const minX = window.innerWidth >= 900 ? 240 : 0;
      shell.style.left   = Math.max(minX, Math.min(maxX, newLeft)) + 'px';
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
      if (Math.random() < 0.4) {
        bubble(pickFromPool('ambient_observation'), { autoHide: 6500 });
      } else if (Math.random() < 0.5 && state.dialog && state.dialog.restaurant_wisdom) {
        bubble(pickFromPool('restaurant_wisdom'), { autoHide: 6500, eyebrow: '🍷 WISDOM' });
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
  // v18.1 MOOD POLARITY — classifies the emotion-direction of each mood
  // so mood() can resist whiplash (rapid positive→negative flips). A
  // sustained mood gets a 4-second "inertia window" before a short,
  // opposite-polarity flip can override it.
  const MOOD_POLARITY = {
    // positive
    happy:'+', love:'+', excited:'+', sparkle:'+', smitten:'+', kissy:'+',
    bashful:'+', super_excited:'+', laughing:'+', drooling:'+', proud:'+',
    singing:'+', singing_star:'+', tipsy:'+', smug:'+', winking:'+', winking_l:'+',
    bunny:'+',
    // negative
    sad:'-', angry:'-', peeved:'-', crying:'-', sobbing:'-', wailing:'-',
    frustrated:'-', eye_roll:'-', melancholy:'-', disappointed:'-',
    mortified:'-', pouty:'-', disgusted:'-',
    // 0 = neutral / cognitive — never blocks anything
  };

  function mood(moodName, durationMs) {
    if (!state.shell) return;
    // v18.1: mood inertia. If the current mood was set less than 4s ago
    // and the incoming mood flips polarity AND its duration is short
    // (transient), ignore it. Long-duration moods (4s+) always win.
    const now = Date.now();
    const newPol = MOOD_POLARITY[moodName] || '0';
    if (state.moodLastPolarity && state.moodLastSetAt && newPol !== '0') {
      const sinceLast = now - state.moodLastSetAt;
      const oppositeFlip = (state.moodLastPolarity === '+' && newPol === '-') ||
                          (state.moodLastPolarity === '-' && newPol === '+');
      if (oppositeFlip && sinceLast < 4000 && (durationMs || 0) < 3800) {
        return;   // resist the whiplash; current emotion rides on
      }
    }
    Object.values(MOODS).forEach(c => {
      if (c) state.shell.classList.remove(c);
    });
    const cls = MOODS[moodName];
    if (cls) state.shell.classList.add(cls);
    state.moodLastSetAt = now;
    if (newPol !== '0') state.moodLastPolarity = newPol;
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
    // onDismiss must fire on EVERY close path that isn't an explicit choice —
    // auto-hide, a replacement bubble, teardown — not just the × button.
    // Otherwise a center-stage moment (dream prompt) whose bubble is closed by
    // opening a game would strand _momentActive=true and lock Clippy at screen
    // center for the session. Button/× handlers set _resolved so this doesn't
    // double-fire with their own outcome.
    el._onDismiss = opts.onDismiss || null;
    el._resolved = false;
    openOverlay('bubble');  // v18.26 — overlay tracking

    // v18.10 — reading-time-based duration. UX research:
    //   • Avg adult reads ~250 wpm ≈ 60ms/character
    //   • +800ms cognitive overhead (fixation, processing)
    //   • Min 2200ms even for "hi" (people need time to register)
    //   • Max 10s cap (longer linger feels stale)
    // Caller's autoHide becomes a MINIMUM — short messages with a long
    // explicit autoHide still stick around for emphasis. Long messages
    // get scaled up automatically even if caller passed a small value.
    function computeBubbleDuration(t) {
      if (!t) return 3000;
      // Longer messages get real reading time — ~85ms/char + overhead, and the
      // cap is 20s (was 10s) so a long thought or dream isn't yanked away.
      return Math.max(2600, Math.min(20000, t.length * 85 + 1400));
    }
    // v18.26 — bug fix. When the bubble has action buttons (a menu),
    // do NOT auto-hide based on reading time. The user needs to actually
    // pick something. Previous behavior was "What's up?" showing 10
    // options then vanishing in 2.2s because the reading-time calc
    // ignored the button list. Now: bubbles with actions stay until the
    // user picks one or taps the × close button, unless the caller
    // explicitly opts into auto-hide by passing autoHide > 0.
    // Music-player bubbles also stay open (they're an interactive panel).
    const hasActions     = opts.actions && opts.actions.length > 0;
    const isInteractive  = hasActions || opts.musicPlayer;
    const explicitAutoHide = (typeof opts.autoHide === 'number' && opts.autoHide > 0);
    let target;
    if (isInteractive && !explicitAutoHide) {
      target = 0;  // sticky — user must close
    } else {
      const computed = computeBubbleDuration(text);
      target = Math.max(opts.autoHide || 0, computed);
    }
    if (target > 0) {
      const hideTimer = setTimeout(() => {
        if (state.bubble === el) closeActionBubble();
      }, target);
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
      el._resolved = true;              // the × IS a dismiss; fire it here, once
      closeActionBubble();
      if (opts.onDismiss) opts.onDismiss();
    });
    if (opts.actions) {
      el.querySelectorAll('[data-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.idx, 10);
          const a = opts.actions[i];
          el._resolved = true;          // an explicit choice — not a dismiss
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
    // Desktop: keep the bubble clear of the fixed 240px sidebar rail.
    const minLeft = window.innerWidth >= 900 ? 252 : 8;
    left = Math.max(minLeft, Math.min(window.innerWidth  - eRect.width  - 8, left));
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
      // Fire onDismiss for any close that wasn't an explicit button/× choice
      // (auto-hide, replacement, teardown), exactly once — this is what
      // unlocks a stuck center-stage moment.
      if (b && b._onDismiss && !b._resolved) {
        b._resolved = true;
        try { b._onDismiss(); } catch (_) {}
      }
      closeOverlay('bubble');  // v18.26
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
      { label: '🎮 Play a game', onClick: () => { closeActionBubble(); if (NX.clippy.games && NX.clippy.games.showMenu) NX.clippy.games.showMenu(); } },
      { label: '🧭 Show me around', onClick: () => { closeActionBubble(); if (NX.clippy.tour && NX.clippy.tour.start) NX.clippy.tour.start(); } },
      { label: '🎴 Daily Gacha', onClick: () => { closeActionBubble(); if (NX.clippy && NX.clippy.gacha) NX.clippy.gacha.showInvite(); } },
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
    startAmbientMoodRotation();   // v18.10 — cycle through chibi expressions
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
    // v18.26 — teardown after the goodbye bubble. clears all tracked
    // timers, listeners, observers, overlays, and removes the shell
    // entirely. enable() can fully re-init from scratch.
    setTimeout(() => {
      teardown();
    }, 2400);
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
  // ── Global floor between UNPROMPTED bubbles ───────────────────────────────
  // Clippy never chatters more than about once a minute, and each dismissal
  // this session stretches that floor — the more you close him, the quieter he
  // gets. Every spontaneous surface (idle chatter, tap/scroll reactions, game
  // offers) checks spontaneousReady() and calls markSpontaneous() when it fires.
  function spontaneousGapMs() { return 60000 * (1 + 0.7 * (state.sessionDismissals || 0)); }
  function spontaneousReady() { return Date.now() - (state.lastSpontaneousAt || 0) >= spontaneousGapMs(); }
  function markSpontaneous() { state.lastSpontaneousAt = Date.now(); }

  function startRandomBehaviors() {
    if (state.randomTimer) clearTimeout(state.randomTimer);
    function loop() {
      if (!state.enabled) return;
      // Chat is gated by the global ~1/min floor AND scaled down further as the
      // user dismisses bubbles this session (dq shrinks with each dismissal).
      const dq = 1 / (1 + 0.8 * (state.sessionDismissals || 0));
      if (!state.preferences.do_not_disturb && !state.bubble && !state.suppressed && spontaneousReady() && Math.random() < 0.02 * dq) {
        markSpontaneous();
        const r = Math.random();
        if      (r < 0.25) bubble(pickFromPool('idle_random'));
        else if (r < 0.35) { play('wobble'); bubble(pickFromPool('sneeze')); }
        else if (r < 0.45) bubble(pickFromPool('yawn'));
        else if (r < 0.58) play('wobble');
        else if (r < 0.72) maybeTrajanQuote();
        else if (r < 0.85) maybeInterestMoment();    // v18.9 — interest-tied
        else               maybeDiscoveryTip();
      }
      state.randomTimer = setTimeout(loop, 120000);
    }
    state.randomTimer = setTimeout(loop, 90000);
  }

  // ─── v18.10 AMBIENT MOOD ROTATION ──────────────────────────────────
  // Periodically pick a random chibi mood so Trajan visibly cycles through
  // his full expression library instead of staying on the same 2-3 faces
  // for the whole session. Fires every 90-180 seconds, skips when there's
  // an active bubble, sulking, or do-not-disturb. Each pick reverts to
  // default after 8-14 seconds.
  const AMBIENT_MOOD_POOL = [
    'happy', 'sparkle', 'love', 'bashful', 'smitten', 'bunny', 'proud',
    'pouty', 'eye_roll', 'wink', 'sleepy', 'thinking', 'embarrassed',
    'kissy', 'laughing', 'super_excited', 'melancholy', 'singing',
    'tipsy', 'drooling', 'peeved', 'confused', 'disappointed',
    'singing_star',
    // v18.39 — kao set II gets ambient airtime
    'guffaw', 'flirt', 'blep', 'peckish', 'delighted', 'squee',
  ];
  function startAmbientMoodRotation() {
    if (state.ambientMoodTimer) clearTimeout(state.ambientMoodTimer);
    function loop() {
      if (!state.enabled || !state.shell) return;
      // Skip while user is engaged, sulking, or DND
      const quiet = state.bubble ||
                    state.sulkActive ||
                    (state.preferences && state.preferences.do_not_disturb) ||
                    state.shell.classList.contains('is-sulking') ||
                    state.shell.classList.contains('is-sleeping');
      if (!quiet) {
        // His face reflects two timescales. The deep SOUL (ANIMA climate —
        // what drifts across incarnations and gets measured) is checked
        // first: ~30% of the time, if the soul is truly shaped away from
        // baseline, that climate wins and shows on his real face. Otherwise
        // fall to the short-term FEELING (55% weather), then the random pool.
        // Soul > weather > random: the drift you can measure now surfaces.
        let m;
        if (Math.random() < 0.30) {
          try { m = NX.clippySoul && NX.clippySoul.soulMood && NX.clippySoul.soulMood(); } catch(_) {}
        }
        if (!m && Math.random() < 0.55) {
          m = moodFromEmotion();
        }
        if (!m) {
          m = AMBIENT_MOOD_POOL[Math.floor(Math.random() * AMBIENT_MOOD_POOL.length)];
        }
        try { mood(m, 8000 + Math.random() * 6000); } catch(_) {}
      }
      // 90-180s between rotations
      state.ambientMoodTimer = setTimeout(loop, 90000 + Math.random() * 90000);
    }
    // First rotation starts ~45s after init so user sees default first
    state.ambientMoodTimer = setTimeout(loop, 45000);
  }

  // v18.9 — drop a "did you know" / quote / quip tied to one of the
  // current user's interests. Rate-limited to twice per hour at most,
  // and skipped entirely during typical focus hours per habits.js.
  // The whole thing falls through silently if no interests are set
  // or if NX.interests didn't load.
  function maybeInterestMoment() {
    if (!window.NX || !NX.interests) return;
    if (!window.app || !app.currentUser) return;
    if (Date.now() < (state.interestMomentCooldownAt || 0)) return;
    // Respect quiet/focus hours from habits.js if available
    try {
      if (NX.habits && NX.habits.isQuietHourFor) {
        const uid = NX.habits.getCurrentUserId
          ? NX.habits.getCurrentUserId()
          : app.currentUser.id;
        if (NX.habits.isQuietHourFor(uid)) return;
      }
    } catch(_){}
    const pick = NX.interests.pickForUser(app.currentUser, null);
    if (!pick || !pick.text) return;
    // Eyebrow varies by kind: "✦ DID YOU KNOW" for fact,
    // "✦ TODAY'S QUOTE" for quote, plain for quip.
    const eyebrowKindLabel = {
      fact:  'DID YOU KNOW',
      quote: 'TODAY\'S QUOTE',
      quip:  '',
    }[pick.kind] || '';
    const eyebrow = eyebrowKindLabel
      ? `${pick.glyph} ${eyebrowKindLabel} · ${pick.label.toUpperCase()}`
      : `${pick.glyph} ${pick.label.toUpperCase()}`;
    try {
      bubble(pick.text, {
        eyebrow,
        trajan: true,
        autoHide: pick.kind === 'quote' ? 8000 : 6500,
      });
    } catch(_){}
    // 30-minute cooldown between interest moments
    state.interestMomentCooldownAt = Date.now() + 30 * 60_000;
  }
  function maybeTrajanQuote() {
    if (Date.now() < state.quoteCooldownAt) return;
    // v18.10 — prefer interest-tied quote when the current user has
    // tagged interests. Falls back to the legacy quoteCorpus for users
    // without tags. Ritual (laurel + concerned mood + magic) preserved.
    let quote = null, intro = null, glyph = null, label = null;
    try {
      if (window.NX && NX.interests && window.app && app.currentUser) {
        const pick = NX.interests.pickForUser(app.currentUser, 'quote');
        if (pick && pick.text) {
          quote = pick.text;
          glyph = pick.glyph;
          label = pick.label;
          intro = `${glyph} ${label.toUpperCase()}`;
        }
      }
    } catch(_){}
    // Legacy fallback: random from corpus + classic intro pool
    if (!quote) {
      if (!state.quoteCorpus.length) return;
      intro = pickFromPool('trajan_quote_intro');
      quote = state.quoteCorpus[Math.floor(Math.random() * state.quoteCorpus.length)];
    }
    setCostumeImg('laurel', 7000);
    mood('concerned', 6000);
    play('magic');
    actionBubble(quote, { eyebrow: intro, trajan: true, duration: 6500 });
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
    state.moveTimer = trackInterval(() => {
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
  // ─── CENTER-STAGE MOMENTS ────────────────────────────────────────────
  // A reusable intimate interaction: Trajan glides to the middle of the
  // screen, delivers a line, and offers a small choice (yes/no or a few
  // buttons); when it resolves he glides back to exactly where he was. This
  // is the pattern for anything that deserves the room's full attention — a
  // dream to share, a confession, a question only he would ask. Kept generic
  // so new moments are one call: clippyMoment({ eyebrow, text, actions, mood }).
  function _rawGlide(x, y) {
    if (!state.shell) return;
    state.shell.style.left   = x + 'px';
    state.shell.style.top    = y + 'px';
    state.shell.style.right  = 'auto';
    state.shell.style.bottom = 'auto';
  }
  function clippyMoment(opts) {
    opts = opts || {};
    // Never hijack: only when he's present, awake, unsuppressed, and idle.
    if (!state.shell || !state.enabled || state.suppressed) return false;
    if (state._momentActive || state.bubble) return false;
    if (state.preferences && state.preferences.do_not_disturb) return false;
    if (state.shell.classList.contains('is-sleeping')) return false;
    state._momentActive = true;
    const r = state.shell.getBoundingClientRect();
    state._momentHome = { x: r.left, y: r.top };
    const cx = Math.round(window.innerWidth / 2 - r.width / 2);
    const cy = Math.round(window.innerHeight * 0.42 - r.height / 2);
    state.shell.classList.add('is-center-stage');
    _rawGlide(cx, cy);
    try { play('hop'); } catch (_) {}
    if (opts.mood) { try { mood(opts.mood, 7000); } catch (_) {} }
    var _done = false;
    const finish = (cb) => {
      if (_done) return;           // exactly-once: a button choice and the
      _done = true;                // bubble's onDismiss can both reach here
      if (state.shell) state.shell.classList.remove('is-center-stage');
      const h = state._momentHome;
      if (h && state.shell) _rawGlide(Math.round(h.x), Math.round(h.y));
      state._momentHome = null;
      state._momentActive = false;
      if (typeof cb === 'function') { try { cb(); } catch (_) {} }
    };
    // After the glide settles, speak. Choices wrap onClick so any pick also
    // sends him home. No choices → auto-hide, then home.
    setTimeout(() => {
      if (!state._momentActive) return;
      const acts = (opts.actions || []).map((a) => ({
        label: a.label, cls: a.cls,
        onClick: () => finish(a.onClick),
      }));
      bubble(opts.text, {
        eyebrow: opts.eyebrow,
        trajan: opts.trajan !== false,
        actions: acts.length ? acts : undefined,
        autoHide: acts.length ? 0 : (opts.autoHide || 6000),
        onDismiss: () => finish(opts.onDismiss),
      });
      if (!acts.length && opts.autoHide !== 0) {
        setTimeout(() => { if (state._momentActive) finish(opts.onDismiss); }, (opts.autoHide || 6000) + 400);
      }
    }, 640);
    return true;
  }

  function startContentAwareness() {
    // init() can run more than once (disable→enable, peek→accept). Without
    // this guard every cycle stacked another document-wide MutationObserver
    // and another full set of document/window listeners — none of which were
    // tracked, so they also survived teardown(). Guard + route everything
    // through trackObserver/trackListener so exactly one set exists and it's
    // all torn down on disable.
    if (state._contentAwarenessInstalled) return;
    state._contentAwarenessInstalled = true;
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
    // Debounced (was raw): this observer watches the ENTIRE document
    // subtree, so checkOverlays — an 8-selector querySelector — ran on
    // every DOM mutation app-wide: hundreds of times during one board
    // render. A 150ms trailing debounce keeps hide-on-overlay feeling
    // instant while cutting the work by orders of magnitude.
    let coDebounce = null;
    const obs = trackObserver(new MutationObserver(() => {
      if (coDebounce) clearTimeout(coDebounce);
      coDebounce = setTimeout(checkOverlays, 150);
    }));
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
    trackListener(document, 'click', (e) => {
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
    trackListener(document, 'focusin', (e) => {
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
    trackListener(document, 'visibilitychange', () => {
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
    trackListener(window, 'resize', () => {
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
    trackListener(window, 'scroll', () => {
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
    // v18.26 — tracked so disable() stops the view-personality loop
    trackInterval(() => {
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
      { weight: 15, fn: () => {
        // Restaurant/wine/history one-liners — the same corpus that signs
        // the emailed daily log. He muses one aloud, in character.
        if (state.dialog && state.dialog.restaurant_wisdom)
          bubble(pickFromPool('restaurant_wisdom'), { autoHide: 6500, eyebrow: '🍷 WISDOM' });
      }, label: 'restaurant_wisdom' },
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
    // v18.26 — tracked via registry so teardown stops it
    state.boredMischiefTimer = trackInterval(() => {
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

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: MINI-GAMES — EXTRACTED                                         ║
  // ║ v18.32 — Games code now lives in js/clippy-games.js. Loaded as a       ║
  // ║ separate <script> after clippy.js. Public API mounts at NX.clippy.games║
  // ║ • showMenu()      — open the game-picker menu                          ║
  // ║ • closeOverlay()  — close active game overlay                          ║
  // ║ • offer()         — Clippy invites the user to a game                  ║
  // ║ • showResult(id, score, extra) — show game result screen               ║
  // ║ See clippy-games.js for implementation. clippy.js exposes the helpers  ║
  // ║ the games module needs via NX.clippy._internal (mounted in init()).    ║
  // ╚══════════════════════════════════════════════════════════════════════╝

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
      { fn: doSweep,    pool: 'autonomous_sweep',  eyebrow: '🧹 SWEEPING',  ms: 6000 },
      { fn: doRead,     pool: 'autonomous_read',   eyebrow: '📖 READING',   ms: 8000 },
      { fn: doScribe,   pool: 'autonomous_scribe', eyebrow: '📜 SCRIBING',  ms: 5000 },
      { fn: doDrink,    pool: 'autonomous_drink',  eyebrow: '🍷 SIPPING',   ms: 5000 },
      { fn: doSwording, pool: 'autonomous_sword',  eyebrow: '⚔️ DRILLING',  ms: 4500 },
      { fn: doEat,      pool: 'autonomous_eat',    eyebrow: '🍎 SNACKING',  ms: 6000 },
    ];
    const pick = actions[Math.floor(Math.random() * actions.length)];
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
    savePreferences();
    // TRANSIENT whim — he holds it for ~2.5 min, then reverts to YOUR equipped
    // prop. It no longer permanently overwrites his look (that's what left
    // people stuck holding a broom they never chose).
    const label = { none: 'nothing', book: 'a book', scroll: 'a scroll', broom: 'a broom' }[pick] || pick;
    setTimeout(() => {
      if (state.dialog && state.dialog.autonomous_prop_change)
        bubble(pickFromPool('autonomous_prop_change').replace('{prop}', label),
          { autoHide: 4200, eyebrow: '✨ MOOD' });
      holdPropTemporarily(pick, 150000);
    }, 4000);
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
    if (!spontaneousReady()) return false;
    const idleMs = Date.now() - (state.lastTapAt || 0);
    if (idleMs < 150000) return false;   // need 2.5min+ idle (was 60s)
    // Cooldown grows with dismissals: base 30min, +30min per dismissal.
    const lastOffer = state.preferences.last_game_offer || 0;
    if (Date.now() - lastOffer < 30 * 60000 * (1 + (state.sessionDismissals || 0))) return false;
    // 0.35% chance per 2s tick — a rare, gentle nudge, not a pest.
    if (Math.random() > 0.0035) return false;
    state.preferences.last_game_offer = Date.now();
    markSpontaneous();
    savePreferences();
    if (NX.clippy.games && NX.clippy.games.offer) NX.clippy.games.offer();
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


  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: BOND XP                                                        ║
  // ║ Reward system 4 of 5. Pokemon-style relationship progression.          ║
  // ║ 7 tiers (Stranger → Lifelong) gated by XP thresholds (50/150/400/      ║
  // ║ 900/2000/4500). Modify via addBondXP() — or via processInteraction()   ║
  // ║ for coordinated cross-system updates. Unlocks costumes by level.       ║
  // ╚══════════════════════════════════════════════════════════════════════╝

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

    // 1. PRIMARY BUTTONS — chance + cooldown pulled from CFG. v18.26 —
    // listener routes through trackListener so teardown() can detach.
    trackListener(document, 'click', (e) => {
      if (!state.enabled || state.suppressed || isOverlayOpen('bubble')) return;
      const btn = e.target.closest(
        'button.ig-btn-primary, button.is-primary, .nx-btn-primary, ' +
        '[data-action="primary"], button[type="submit"]'
      );
      if (!btn) return;
      // v18.26 — added .clippy-gacha-overlay to exclusion. Previously
      // clicking the Pull button could fire a reaction bubble that
      // visually overlapped the gacha card reveal.
      if (btn.closest('.clippy-bubble, .clippy-game-overlay, .clippy-dex-overlay, .clippy-palette, .clippy-gacha-overlay')) return;
      if (state.nxLastReact && Date.now() - state.nxLastReact < CFG.cooldown.react_button) return;
      if (!spontaneousReady() || Math.random() > CFG.chance.react_button) return;
      state.nxLastReact = Date.now();
      markSpontaneous();
      const isSubmit = btn.type === 'submit' || btn.matches('[data-action="submit"]');
      const pool = isSubmit ? 'nx_form_submit' : 'nx_button_click';
      trackTimeout(() => {
        if (!isOverlayOpen('bubble') && state.enabled) {
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
    trackListener(document, 'submit', (e) => {
      if (!state.enabled || state.suppressed || isOverlayOpen('bubble')) return;
      const form = e.target;
      if (!form || !form.matches('form')) return;
      if (form.closest('.clippy-bubble, .clippy-game-overlay, .clippy-dex-overlay, .clippy-gacha-overlay')) return;
      if (state.nxLastReact && Date.now() - state.nxLastReact < CFG.cooldown.react_submit) return;
      state.nxLastReact = Date.now();
      trackTimeout(() => {
        if (!isOverlayOpen('bubble') && state.enabled) {
          bubble(pickFromPool('nx_form_submit'), { autoHide: 3500, eyebrow: '✅ SUBMIT' });
          spawnParticles({ count: 8, type: 'confetti' });
          // v18.26 — unified trigger. Coordinates feelings + bond +
          // mood through the single dispatcher instead of calling
          // each system independently.
          processInteraction('form_submitted');
        }
      }, 350);
    }, { capture: true });

    // 3. MODAL OPENS — MutationObserver for new dialogs.
    // v18.26 — observer is now tracked via trackObserver so teardown
    // disconnects it. Also scoped to document.body subtree rather than
    // observing the entire document — better perf on busy pages.
    const modalObserver = trackObserver(new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList && (
            node.classList.contains('clippy-bubble') ||
            node.classList.contains('clippy-game-overlay') ||
            node.classList.contains('clippy-dex-overlay') ||
            node.classList.contains('clippy-palette') ||
            node.classList.contains('clippy-gacha-overlay')
          )) continue;
          const isModal = node.matches && node.matches(
            '.nx-takeover, .nx-overlay-active, .nx-modal-backdrop, ' +
            'dialog[open], [role="dialog"], [data-overlay-active="true"]'
          );
          if (isModal) {
            if (state.nxLastReact && Date.now() - state.nxLastReact < CFG.cooldown.react_modal) return;
            if (!spontaneousReady() || Math.random() > CFG.chance.react_modal) return;
            state.nxLastReact = Date.now();
            markSpontaneous();
            trackTimeout(() => {
              if (!isOverlayOpen('bubble') && state.enabled && !state.suppressed) {
                bubble(pickFromPool('nx_modal_open'), { autoHide: 3500, eyebrow: '👁️ PEEK' });
                mood('gasp', 3200);
              }
            }, 600);
            return;
          }
        }
      }
    }));
    modalObserver.observe(document.body, { childList: true, subtree: true });

    // 4. HEAVY SCROLLING — 25+ scroll events in 4 seconds. v18.26 —
    // tracked listener, isOverlayOpen check, chance pulled from CFG.
    let scrollEvents = [];
    trackListener(document, 'scroll', () => {
      if (!state.enabled || state.suppressed || isOverlayOpen('bubble')) return;
      const now = Date.now();
      scrollEvents = scrollEvents.filter(t => now - t < 4000).concat([now]);
      if (scrollEvents.length >= 25) {
        scrollEvents = [];
        if (state.nxLastReact && now - state.nxLastReact < 30000) return;
        if (!spontaneousReady() || Math.random() > CFG.chance.react_scroll) return;
        state.nxLastReact = now;
        markSpontaneous();
        trackTimeout(() => {
          if (!isOverlayOpen('bubble') && state.enabled && !state.suppressed) {
            bubble(pickFromPool('nx_scroll_heavy'), { autoHide: 3800, eyebrow: '🔍 LOOKING' });
            mood('confused', 3500);
          }
        }, 200);
      }
    }, { passive: true });

    // 5. SEARCH FOCUS — react ~18% to search-input focus
    trackListener(document, 'focusin', (e) => {
      if (!state.enabled || state.suppressed || isOverlayOpen('bubble')) return;
      const el = e.target;
      if (!el || !el.matches) return;
      const isSearch = el.matches(
        'input[type="search"], input[placeholder*="earch" i], input[aria-label*="earch" i]'
      );
      if (!isSearch) return;
      if (state.nxLastSearchFocus && Date.now() - state.nxLastSearchFocus < 60000) return;
      state.nxLastSearchFocus = Date.now();
      if (Math.random() > 0.18) return;
      trackTimeout(() => {
        if (!isOverlayOpen('bubble') && state.enabled && !state.suppressed) {
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

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: GACHA — EXTRACTED                                              ║
  // ║ v18.26 — gacha code now lives in js/clippy-gacha.js. Loaded as a       ║
  // ║ separate <script> after clippy.js. Public API mounts at NX.clippy.gacha║
  // ║ • showInvite()      — invitation modal + pull flow                     ║
  // ║ • showCollection()  — collection grid view                             ║
  // ║ • getState()        — current gacha state snapshot                     ║
  // ║ • CARDS             — read-only catalog                                ║
  // ║ See clippy-gacha.js for implementation. clippy.js exposes the helpers  ║
  // ║ the gacha module needs via NX.clippy._internal (mounted in init()).    ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // Helper for "today" date string in YYYY-MM-DD format. Used by gacha
  // pull dedup and elsewhere in clippy.js. Pure function — also defined
  // locally in clippy-gacha.js to keep the module self-contained.
  function todayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }


  function showMemoryDex() {
    closeActionBubble();
    if (NX.clippy.games && NX.clippy.games.closeOverlay) NX.clippy.games.closeOverlay();
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
    openOverlay('dex');  // v18.26
    ov.querySelector('[data-act="close"]').addEventListener('click', () => {
      ov.classList.remove('is-visible');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
      state.dexOverlay = null;
      closeOverlay('dex');  // v18.26
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
    // v18.26 — tracked. Also self-clears when the element leaves DOM.
    const timer = trackInterval(() => {
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
    openOverlay('palette');  // v18.26
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
    closeOverlay('palette');  // v18.26
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


  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: INIT                                                           ║
  // ║ The master init() flow. Loads dialog + preferences, builds the shell   ║
  // ║ if the user has previously accepted, wires global listeners, starts    ║
  // ║ every long-running interval (all tracked via v18.26 trackInterval).    ║
  // ║ Idempotent — guarded by state.initialized. teardown() resets the       ║
  // ║ guard so re-init from scratch works cleanly.                           ║
  // ╚══════════════════════════════════════════════════════════════════════╝

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
      // v18.x QUIET ENTRY: on the first appearance of each session Clippy
      // arrives SILENT — he plays the enter animation, smiles, and says
      // nothing. Real companions don't announce themselves every time
      // they walk in. He greets only if re-enabled mid-session (an
      // explicit invitation). Milestone streaks still celebrate — those
      // are rare and worth the interruption; routine ones stay quiet.
      const greetedThisSession = (() => { try { return sessionStorage.getItem('nx_clippy_greeted') === '1'; } catch (_) { return false; } })();
      try { sessionStorage.setItem('nx_clippy_greeted', '1'); } catch (_) {}
      if (greetedThisSession) {
        if (state.preferences.accepted_at) {
          bubble(substituteVars(familiarityGreeting()), { autoHide: 4500 });
          mood('happy', 4000);
        } else {
          timeAwareGreeting();
        }
      } else {
        mood('happy', 2500);   // present and warm — just not talking
      }
      // v17.6: daily streak + special day celebrations (milestones always;
      // routine celebrations only when not in quiet entry)
      const streakInfo = checkDailyStreak();
      if (greetedThisSession || streakInfo.isMilestone) {
        celebrateStreak(streakInfo.streak, streakInfo.isMilestone, streakInfo.event);
      }
      if (greetedThisSession) celebrateSpecialDay(checkSpecialDay());
      // v17.9: periodic checks + session-time achievement flags
      const hour = new Date().getHours();
      // v18.x circadian body: late nights he breathes slower (see
      // .clippy-night in clippy.css). Re-checked hourly alongside the
      // existing hourly_check cadence via the mood-weather interval.
      try {
        const setNight = () => {
          const h = new Date().getHours();
          state.host && state.host.classList.toggle('clippy-night', h >= 22 || h < 6);
        };
        setNight();
        trackInterval(setNight, 15 * 60 * 1000);
      } catch (_) {}

      // ── v18.x TRUE VISION ──────────────────────────────────────────
      // He finally SEES the restaurant, not just overlays to hide from.
      // Every 90s he reads the live KPI numbers the app renders (overdue
      // PMs, equipment down, open tickets). Reactions are SILENT first —
      // a worried or pleased face — speech is rare (worsening only,
      // 25% chance, 10-min cooldown) and concrete. Occasionally he ties
      // in a deposited memory: vision + memory = an assistant, offline.
      try {
        const vis = { last: {}, spokeAt: 0 };
        const readNum = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const n = parseInt(String(el.textContent).replace(/[^0-9]/g, ''), 10);
          return Number.isFinite(n) ? n : null;
        };
        const FACT_LINES = {
          overdue: (v) => v === 1 ? '1 PM is overdue now.' : v + ' PMs are overdue now.',
          down:    (v) => v === 1 ? 'A unit just went down.' : v + ' units are down.',
          tickets: (v) => v + ' tickets open.',
        };
        const recallMemory = () => {
          try {
            const pool = (state.memories || []).filter(m =>
              m && m.importance >= 3 && typeof m.label === 'string' &&
              m.label.length > 3 && m.label.length < 60);
            if (!pool.length) return '';
            const m = pool[Math.floor(Math.random() * pool.length)];
            return ' (I still remember: ' + m.label + '.)';
          } catch (_) { return ''; }
        };
        const lookAround = () => {
          if (!state.enabled || state.suppressed) return;
          const snap = {
            overdue: readNum('.home-kpi[data-stat="overdue"] .home-kpi-num'),
            down:    readNum('.home-kpi[data-stat="down"] .home-kpi-num'),
            tickets: readNum('.home-kpi[data-stat="tickets"] .home-kpi-num'),
          };
          let worsened = null, improved = false;
          for (const k of Object.keys(snap)) {
            const v = snap[k], prev = vis.last[k];
            if (v == null) continue;
            if (prev != null && v > prev && (k === 'overdue' || k === 'down')) worsened = worsened || k;
            if (prev != null && v < prev) improved = true;
            vis.last[k] = v;
          }
          // ── ANXIETY: sustained-load response, pure body language ───
          // Weighted load: a down unit weighs most, overdue PMs next,
          // raw ticket count least. Hysteresis (enter ≥8, exit ≤5) so he
          // doesn't flap at the threshold. Anxious = shallow fast breath
          // (.clippy-anxious), occasional fidgety worried glances, and
          // NO bubbles — stress that talks is nagging; stress you can
          // see is empathy. Relief when it passes: one visible exhale.
          const load = (snap.down || 0) * 3 + (snap.overdue || 0) * 2 + (snap.tickets || 0) * 0.5;
          const wasAnxious = !!vis.anxious;
          if (!wasAnxious && load >= 8) vis.anxious = true;
          else if (wasAnxious && load <= 5) vis.anxious = false;
          try { state.host && state.host.classList.toggle('clippy-anxious', !!vis.anxious); } catch (_) {}
          if (vis.anxious && Math.random() < 0.35) {
            mood('concerned', 2200); mood('worried', 2200);   // fidgety glance
          }
          if (wasAnxious && !vis.anxious) {
            mood('happy', 3500);                               // visible relief
            adjustFeeling('happiness', +2);
          }

          if (worsened) {
            // Silent worry first; speak only sometimes, never twice in 10 min.
            mood('concerned', 3000); mood('sad', 3000);
            const quietLongEnough = Date.now() - vis.spokeAt > 10 * 60 * 1000;
            if (quietLongEnough && Math.random() < 0.25 && (state.sessionDismissals || 0) < 3) {
              vis.spokeAt = Date.now();
              bubble(FACT_LINES[worsened](vis.last[worsened]) + recallMemory(),
                     { autoHide: 4200, eyebrow: 'NOTICED' });
            }
          } else if (improved) {
            mood('happy', 2500);   // pleased, says nothing — earned trust
          }
        };
        setTimeout(lookAround, 4000);          // first look after settling in
        trackInterval(lookAround, 90 * 1000);
      } catch (_) {}
      if (hour >= 0 && hour < 4) state.preferences.midnight_session = true;
      if (hour >= 4 && hour < 6) state.preferences.dawn_session = true;
      savePreferences();
      checkAchievements(true);   // silent initial scan
      // v18.26 — All intervals now go through trackInterval so disable()
      // can clear them. Cooldown values pull from CFG.interval so they're
      // tunable at runtime via NX.clippy.tune().
      trackInterval(() => {
        if (!state.enabled || state.suppressed) return;
        checkAchievements();
        checkIgnored();
      }, CFG.interval.achievements);
      // v17.10: clock awareness — every 60s check for hour change
      trackInterval(() => { if (state.enabled && !state.suppressed) hourlyCheck(); }, CFG.interval.hourly_check);
      // v17.10: feelings drift — every 90s decay toward baseline
      trackInterval(() => { if (state.enabled) decayFeelings(); }, CFG.interval.feelings_decay);
      // v17.10: stress check — once per 5min, attempts at most once per day
      trackInterval(() => { if (state.enabled && !state.suppressed) checkStressMarkers(); }, CFG.interval.stress_check);
      // v17.15: ADVANCED PET BEHAVIORS
      // Mood weather — halo color tracks dominant feeling
      trackInterval(updateMoodWeather, CFG.interval.mood_weather);
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
      trackInterval(() => maybeAutoPickPersonality('hourly_check'), CFG.interval.personality_pick);
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
      trackInterval(decayAffinity, CFG.interval.affinity_decay);
      // v18.7: kick off the affective awareness layer — Trajan starts
      // watching the operational state of NEXUS + the user's behavior
      // patterns, and shifts his expression (silently) when things
      // get heavy. See the v18.7 doc block above for the full design.
      try { startAffectiveAwareness(); } catch (e) {
        console.warn('[clippy] awareness layer failed to start:', e);
      }
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


  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: PUBLIC API                                                     ║
  // ║ NX.clippy.* — everything exposed to other modules and console use.     ║
  // ║ When adding a new public method, document it inline so other code      ║
  // ║ (galaxy.js, app.js, education.js, habits.js, interests.js) knows       ║
  // ║ what's safe to call.                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // ─── Public API ─────────────────────────────────────────────────────
  function notifyTaskCompleted() {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    // v17.11: every 3rd-or-so completion gets the bigger celebration
    if (Math.random() < 0.4) {
      celebrateNexusTask();
      processInteraction('task_completed');
      return;
    }
    if (Math.random() < 0.6) {
      play('hop');
      bubble(pickFromPool('task_completed'));
      processInteraction('task_completed');
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
      processInteraction('streak_continued');
      return;
    }
    play('cartwheel');
    actionBubble(fmt(pickFromPool('streak_milestone'), { N: days }), { duration: 4500 });
    processInteraction('streak_continued');
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
    seeSurroundings,                // v: desktop pet sight — react to a screenshot
    play, mood,
    sleep, wake,
    setCostume,
    moveTo, moveToEmptyCorner,
    moment: clippyMoment,           // center-stage yes/no interaction (dreams, etc.)
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
    // v18.7 — affective awareness API. Other modules can read this to
    // surface Trajan's read of the room in status panels or the AI brain.
    getAwareness: getAwarenessSnapshot,
    // v18.11 — emotion API (Plutchik-grounded). External modules
    // (games, app.js, habits.js) can bump Trajan's emotions via feel()
    // and read his current state via getEmotions().
    feel: feel,
    getEmotions: getEmotionSnapshot,
    // v18.10 — bridge accessor so interests.js can pull from the
    // existing dialog.json knowledge pools (roman_facts, augustus_facts,
    // caligula_facts, trajan_facts, hispania_facts, persian_facts,
    // greek_facts, athens_facts, sparta_facts, battle_facts, etc.).
    // Returns the pool array or empty array if missing.
    getDialogPool: (name) => (state.dialog && state.dialog[name]) || [],
    onViewChange: () => {},
    switchAgent: () => {},   // no-op (legacy API, no longer applies)
    enable: () => { state.preferences.enabled = true; savePreferences(); init(); },
    disable: declineToJoin,

    // ─── v18.26 architectural API ──────────────────────────────────
    // teardown(): full cleanup — clears all timers, listeners,
    //   observers, and overlays. Used internally by disable() and
    //   exposed for tests / debugging.
    // tune(overrides): runtime override of cooldowns + chances +
    //   interval frequencies. Example:
    //     NX.clippy.tune({ chance: { react_button: 0.20 } })
    //   makes Clippy react to button clicks 2× as often.
    // getStatus(): debug snapshot — how many timers/listeners/overlays
    //   are tracked, cloud lock state, etc. Useful for diagnosing
    //   "is Clippy actually disabled?" or "is something stuck open?"
    //
    // processInteraction(name, payload?): unified trigger dispatcher.
    //   Routes one named event through all five reward systems
    //   coherently. See INTERACTION_REWARDS at the top of this file
    //   for the canonical event names. Example:
    //     NX.clippy.processInteraction('task_completed')
    // tuneInteraction(name, partial): runtime override of an event's
    //   reward signature. Shallow-merges. Example:
    //     NX.clippy.tuneInteraction('chat_message_positive',
    //       { bond: 2 })
    // getRelationshipState(): unified relationship snapshot across all
    //   five systems plus a derived overall score (-100 to +100) and
    //   human label (devoted/fond/warm/neutral/distant/cold).
    teardown,
    tune: applyTuning,
    getStatus,
    processInteraction,
    tuneInteraction,
    getRelationshipState,

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

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║ _internal — namespace for sub-module wiring                          ║
    // ║ Sub-modules (clippy-gacha.js, future clippy-games.js, etc.) read     ║
    // ║ from this to access core helpers. NOT a stable public API — internal ║
    // ║ contract subject to change across versions. External code (galaxy.   ║
    // ║ js, app.js, habits.js, education.js, interests.js) should use the    ║
    // ║ documented public methods above, NOT _internal.                      ║
    // ╚════════════════════════════════════════════════════════════════════╝
    _internal: {
      // State (mutable; sub-modules read state.preferences.daily_streak,
      // state.suppressed, state.shell, state.svgMarkup, etc.)
      get state()         { return state; },
      // Speech surfaces
      bubble, actionBubble, closeActionBubble,
      pickFromPool, substituteVars,
      // Visual / audio
      mood, spawnParticles, playTone,
      // Reward systems (the underlying functions; processInteraction is
      // also available on the public API above for unified dispatch)
      adjustFeeling, adjustAffinity, addBondXP,
      depositMemory,
      // v18.33 — the games extraction referenced these four without
      // capturing them; getAudioCtx threw inside game update loops and
      // froze every game on its first scored point.
      feel, getAudioCtx,
      grantBondXP_game_played, grantBondXP_game_high_score,
      // v18.33 — for clippy-tour.js (persists tour_completed).
      savePreferences,
      // Utilities
      esc, userKey,
      // Overlay manager
      openOverlay, closeOverlay, isOverlayOpen,
      // Timer / listener registries — so sub-modules can also register
      // their long-running timers in a way teardown() can clean up
      trackInterval, trackTimeout, trackListener, trackObserver,
      // Cloud lock for sub-modules that talk to Supabase
      withCloudLock,
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
