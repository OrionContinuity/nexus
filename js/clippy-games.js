/* ════════════════════════════════════════════════════════════════════
   clippy-games.js — Mini-games sub-module
   ────────────────────────────────────────────────────────────────────
   v18.32 — Extracted from clippy.js (was lines 7206–10421). Follows the
   pattern established by clippy-gacha.js: late-binding init that polls
   for NX.clippy._internal to be ready, then captures the helpers it
   needs and attaches its public surface as NX.clippy.games.

   This module owns:
     • The mini-games catalog (GAMES) and high-score persistence
     • The game overlay shell (createGameOverlay / closeGameOverlay)
     • The game menu and result screens (showGameMenu / showGameResult)
     • Score utilities (medalForScore, medalEmoji)
     • The game framework (makeCanvasBoard, drawTrajanOrb, playPitch,
       createMiniOrb, runCountdown, gameLoop, makeJuice)
     • All 10 game start functions

   The 10 games:
     1. ⚡ Tap the Orb         2. 🏃 Catch Me            3. ⚡ Reaction
     4. 🧠 Memory Match        5. 🕊️ Flappy Trajan       6. 🚀 Cannon Battle
     7. 🐍 Snake               8. 🧱 Orb Breaker         9. 🪙 Coin Catch
    10. 🌌 Asteroid Field

   Depends on clippy core for:
     • state (the shared mutable state object)
     • bubble / actionBubble / closeActionBubble (speech surfaces)
     • pickFromPool / substituteVars (dialog selection)
     • mood (expression switching)
     • spawnParticles / playTone (visual / audio cues)
     • adjustFeeling / adjustAffinity / addBondXP (reward integration)
     • depositMemory (high-score memory storage)
     • esc / userKey (utilities)
     • openOverlay / closeOverlay (overlay manager)

   PUBLIC API
     NX.clippy.games.showMenu()      — open the game-picker menu
     NX.clippy.games.closeOverlay()  — close any active game overlay
     NX.clippy.games.offer()         — Clippy invites the user to a game
     NX.clippy.games.showResult(id, score, extra) — show game result screen

   LOADED via a separate <script> tag in index.html, AFTER clippy.js.
   ════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  /* Late-binding init. Polls for NX.clippy._internal to be ready
     (clippy.js sets it up during its own init flow). Once available,
     captures the helpers and attaches the public API. */
  function init() {
    if (!window.NX || !NX.clippy || !NX.clippy._internal) {
      // Capped retry (was uncapped): if Clippy is disabled or failed to
      // boot, _internal never mounts — the old infinite 50ms poll then
      // burned battery forever. ~15s of patience, then back off to a slow
      // 5s heartbeat so enabling Clippy later still wires us up.
      init._n = (init._n || 0) + 1;
      setTimeout(init, init._n < 300 ? 50 : 5000);
      return;
    }
    const ix = NX.clippy._internal;

    /* ── Capture clippy core helpers into locals ────────────────────
       The games body below references these names directly. Capturing
       as locals (rather than rewriting to ix.foo()) keeps the games
       code identical to its pre-extraction form, minimizing diff risk.
       state is a mutable object — capturing a reference, never reassigned. */
    const state             = ix.state;
    const bubble            = ix.bubble;
    const actionBubble      = ix.actionBubble;
    const closeActionBubble = ix.closeActionBubble;
    const pickFromPool      = ix.pickFromPool;
    const substituteVars    = ix.substituteVars;
    const mood              = ix.mood;
    const spawnParticles    = ix.spawnParticles;
    const playTone          = ix.playTone;
    const adjustFeeling     = ix.adjustFeeling;
    const adjustAffinity    = ix.adjustAffinity;
    const addBondXP         = ix.addBondXP;
    const depositMemory     = ix.depositMemory;
    const esc               = ix.esc;
    const userKey           = ix.userKey;
    const openOverlay       = ix.openOverlay;
    const closeOverlay      = ix.closeOverlay;
    // v18.33 — these four were referenced throughout the games body but
    // never captured (the extraction missed them). getAudioCtx was the
    // game-freeze bug: playPitch() threw a ReferenceError inside update
    // loops, killing the rAF tick on the first scored point. Fallbacks
    // keep the games alive even against a stale clippy.js.
    const feel              = ix.feel              || function () {};
    const getAudioCtx       = ix.getAudioCtx       || function () { return null; };
    const grantBondXP_game_played     = ix.grantBondXP_game_played     || function () {};
    const grantBondXP_game_high_score = ix.grantBondXP_game_high_score || function () {};

    /* ── Games body (extracted unchanged from clippy.js) ─────────── */

  // ════════════════════════════════════════════════════════════════════
  // v18.0 GAMES — 10 mini-games. Complete overhaul of v17.22.
  //
  //   1. ⚡ Tap the Orb        2. 🏃 Catch Me           3. ⚡ Reaction
  //   4. 🧠 Memory Match       5. 🕊️ Flappy Trajan      6. 🚀 Cannon Battle
  //   7. 🐍 Snake              8. 🧱 Orb Breaker        9. 🪙 Coin Catch
  //  10. 🌌 Asteroid Field
  //
  //   Architecture changes from v17.22:
  //     • Play Again now routes through GAMES[gameId].start, so it
  //       works for ALL games (was broken for flappy/cannon/snake).
  //     • Canvas-based rendering for 5–10 (was DOM thrash). Shared
  //       helper drawTrajanOrb() for visual identity. dt-based loops
  //       (frame-rate-independent).
  //     • Per-game difficulty curves; medal tiers; richer result stats.
  //     • Snake speed-up actually works (was dead code — setInterval
  //       captured initial STEP_MS forever).
  //     • Flappy: circular hitbox (forgiving), tap-to-begin, parallax.
  //     • Memory: per-orb musical pitches; +1 orb every 5 lvls (was 10).
  //
  //   Per-user scores via userKey(). Beating a high score deposits a
  //   memory + grants bond XP + confetti.
  // ════════════════════════════════════════════════════════════════════

  const GAMES = {
    tap:       { label: '⚡ Tap the Orb',    pool: 'game_intro_tap',       higherIsBetter: true,  unit: 'pts',  start: () => startTapGame() },
    catch:     { label: '🏃 Catch Me',       pool: 'game_intro_catch',     higherIsBetter: true,  unit: '/20',  start: () => startCatchGame() },
    reaction:  { label: '⚡ Reaction',       pool: 'game_intro_reaction',  higherIsBetter: false, unit: 'ms',   start: () => startReactionGame() },
    memory:    { label: '🧠 Memory Match',   pool: 'game_intro_memory',    higherIsBetter: true,  unit: 'lvl',  start: () => startMemoryGame() },
    flappy:    { label: '🕊️ Flappy Trajan',  pool: 'game_intro_flappy',    higherIsBetter: true,  unit: 'cols', start: () => startFlappyGame() },
    cannon:    { label: '🚀 Cannon Battle',  pool: 'game_intro_cannon',    higherIsBetter: true,  unit: 'pts',  start: () => startCannonGame() },
    snake:     { label: '🐍 Snake',          pool: 'game_intro_snake',     higherIsBetter: true,  unit: 'len',  start: () => startSnakeGame() },
    breaker:   { label: '🧱 Orb Breaker',    pool: 'game_intro_breaker',   higherIsBetter: true,  unit: 'pts',  start: () => startBreakerGame() },
    coins:     { label: '🪙 Coin Catch',     pool: 'game_intro_coins',     higherIsBetter: true,  unit: 'pts',  start: () => startCoinCatchGame() },
    asteroids: { label: '🌌 Asteroid Field', pool: 'game_intro_asteroids', higherIsBetter: true,  unit: 'pts',  start: () => startAsteroidsGame() },
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
      return true;
    }
    return false;
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ MODULE: MINI-GAMES                                                     ║
  // ║ 10 mini-games sharing the game overlay shell. Each game has its own    ║
  // ║ start function (startTapGame, startCatchGame, etc.) and uses           ║
  // ║ state.gameCleanupFns to register teardown handlers fired on close.     ║
  // ║ CANDIDATE for clean extraction — this section is ~3500 lines and the   ║
  // ║ games barely cross-reference anything except shared scoring helpers.   ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // ─── Game overlay shell ────────────────────────────────────────
  function createGameOverlay() {
    closeGameOverlay();
    // v18.2: force-close any active bubble/chat so Clippy is fully hidden
    // for the duration of the game. If the game itself needs to surface
    // a message (e.g. high-score), bubble() is wrapped to render on top
    // of the game overlay via the .clippy-bubble-on-top class.
    try { closeActionBubble(); } catch (_) {}
    try {
      if (state.bubble && state.bubble.remove) state.bubble.remove();
    } catch (_) {}
    state.bubble = null;
    if (state._driftTimer) clearTimeout(state._driftTimer);
    if (state._emoFollowupTimer) clearTimeout(state._emoFollowupTimer);
    const ov = document.createElement('div');
    ov.className = 'clippy-game-overlay';
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-visible'));
    state.gameOverlay = ov;
    state.suppressed = true;
    openOverlay('game');  // v18.26
    if (state.shell) state.shell.classList.add('is-suppressed');
    document.body.classList.add('clippy-game-open');
    return ov;
  }
  function closeGameOverlay() {
    if (state.gameOverlay) {
      state.gameOverlay.classList.remove('is-visible');
      const o = state.gameOverlay;
      setTimeout(() => { try { o.remove(); } catch (e) {} }, 280);
      state.gameOverlay = null;
      closeOverlay('game');  // v18.26
    }
    state.suppressed = false;
    if (state.shell) state.shell.classList.remove('is-suppressed');
    document.body.classList.remove('clippy-game-open');
    if (state.gameCleanupFns) {
      state.gameCleanupFns.forEach(fn => { try { fn(); } catch (e) {} });
      state.gameCleanupFns = [];
    }
  }

  // ─── Offer flow ────────────────────────────────────────────────
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
    adjustFeeling('happiness', +4);
  }

  function showGameMenu() {
    const scores = getHighScores();
    const fmt = (id) => {
      const s = scores[id];
      if (s == null) return '—';
      const g = GAMES[id];
      return g.higherIsBetter ? s + ' ' + g.unit : s + g.unit;
    };
    actionBubble('Pick a game!', {
      eyebrow: '🎮 GAMES',
      autoHide: 0,
      actions: [
        ...Object.keys(GAMES).map(id => ({
          label: `${GAMES[id].label} (best: ${fmt(id)})`,
          onClick: () => { closeActionBubble(); GAMES[id].start(); }
        })),
        { label: 'Never mind', onClick: closeActionBubble },
      ],
    });
  }

  // ─── End-of-game shared screen ─────────────────────────────────
  // v18.0 FIX: Play Again now routes through GAMES[gameId].start so
  // it works for all 10 games (was broken for flappy/cannon/snake).
  function showGameResult(gameId, score, extra) {
    extra = extra || {};
    const game = GAMES[gameId];
    if (!game) { closeGameOverlay(); return; }
    const newRecord = saveHighScore(gameId, score);
    const allScores = getHighScores();
    const medal = medalForScore(gameId, score);
    // v18.11 — wire game outcomes to emotion deltas.
    // New best: large joy + excitement + small trust ("Trajan believes in you more")
    // Medal: smaller joy proportional to medal tier
    // No medal: tiny sadness (sympathy, not crushing — "we'll get it next time")
    try {
      if (newRecord) {
        feel('joy',     0.30);
        feel('excitement', 0.25);
        feel('trust',   0.05);
        feel('surprise', 0.15);
      } else if (medal === 'platinum' || medal === 'gold') {
        feel('joy',     0.18);
        feel('excitement', 0.12);
      } else if (medal === 'silver' || medal === 'bronze') {
        feel('joy',     0.10);
      } else {
        feel('sadness', 0.05);
        feel('anticipation', 0.05);  // "next time" — hope for the rematch
      }
    } catch (_) {}
    const ov = state.gameOverlay || createGameOverlay();
    const medalHTML = medal
      ? `<div class="clippy-game-medal is-${medal}">${medalEmoji(medal)} ${medal.toUpperCase()}</div>`
      : '';
    const extraStatsHTML = (extra.stats && extra.stats.length)
      ? `<div class="clippy-game-extra-stats">${extra.stats.map(s =>
          `<div><span class="lbl">${esc(s.label)}</span><span class="val">${esc(String(s.value))}</span></div>`
        ).join('')}</div>`
      : '';
    ov.innerHTML = `
      <div class="clippy-game-title">${esc(game.label)} — RESULTS</div>
      <div class="clippy-game-stat-label">Your Score</div>
      <div class="clippy-game-stat">${esc(String(score))} <span style="font-size:18px;opacity:0.5;">${esc(game.unit)}</span></div>
      ${medalHTML}
      ${extraStatsHTML}
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
      if (typeof game.start === 'function') game.start();
    });
    ov.querySelector('[data-act="menu"]').addEventListener('click', () => {
      closeGameOverlay();
      showGameMenu();
    });
    ov.querySelector('[data-act="done"]').addEventListener('click', closeGameOverlay);

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
        mood(score > 0 ? 'happy' : 'thinking', 4500);
        adjustFeeling('happiness', +4);
      }
    }, 200);
  }

  // ─── Medal tiers ───────────────────────────────────────────────
  // cmp: 'lt' means lower-is-better (reaction). Default ascending.
  const MEDALS = {
    tap:       [{ t: 200, k: 'platinum' }, { t: 130, k: 'gold' }, { t: 80, k: 'silver' }, { t: 40, k: 'bronze' }],
    catch:     [{ t: 15,  k: 'platinum' }, { t: 12,  k: 'gold' }, { t: 9,  k: 'silver' }, { t: 6,  k: 'bronze' }],
    reaction:  [{ t: 200, k: 'platinum', cmp: 'lt' }, { t: 260, k: 'gold', cmp: 'lt' }, { t: 320, k: 'silver', cmp: 'lt' }, { t: 400, k: 'bronze', cmp: 'lt' }],
    memory:    [{ t: 20,  k: 'platinum' }, { t: 15,  k: 'gold' }, { t: 10, k: 'silver' }, { t: 5,  k: 'bronze' }],
    flappy:    [{ t: 50,  k: 'platinum' }, { t: 25,  k: 'gold' }, { t: 10, k: 'silver' }, { t: 3,  k: 'bronze' }],
    cannon:    [{ t: 500, k: 'platinum' }, { t: 300, k: 'gold' }, { t: 150,k: 'silver' }, { t: 50, k: 'bronze' }],
    snake:     [{ t: 30,  k: 'platinum' }, { t: 20,  k: 'gold' }, { t: 12, k: 'silver' }, { t: 7,  k: 'bronze' }],
    breaker:   [{ t: 500, k: 'platinum' }, { t: 300, k: 'gold' }, { t: 150,k: 'silver' }, { t: 50, k: 'bronze' }],
    coins:     [{ t: 60,  k: 'platinum' }, { t: 40,  k: 'gold' }, { t: 25, k: 'silver' }, { t: 10, k: 'bronze' }],
    asteroids: [{ t: 600, k: 'platinum' }, { t: 400, k: 'gold' }, { t: 200,k: 'silver' }, { t: 80, k: 'bronze' }],
  };
  function medalForScore(gameId, score) {
    const tiers = MEDALS[gameId];
    if (!tiers) return null;
    for (const tier of tiers) {
      const pass = tier.cmp === 'lt' ? score < tier.t : score >= tier.t;
      if (pass) return tier.k;
    }
    return null;
  }
  function medalEmoji(kind) {
    return { platinum: '💎', gold: '🥇', silver: '🥈', bronze: '🥉' }[kind] || '🏅';
  }

  // ─── Canvas board factory ──────────────────────────────────────
  function makeCanvasBoard(container, opts) {
    opts = opts || {};
    const maxW = Math.min(420, Math.floor(window.innerWidth * 0.9));
    const w = opts.w || maxW;
    const h = opts.h || Math.min(500, Math.floor(window.innerHeight * 0.62));
    const wrap = document.createElement('div');
    wrap.className = 'clippy-canvas-board';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    if (opts.bg) wrap.style.background = opts.bg;
    const canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { wrap, canvas, ctx, w, h };
  }

  // ─── Trajan orb sprite (canvas) ────────────────────────────────
  // v18.3: matches the actual Clippy SVG. Body is blue (#4cb6ff) by
  // default — same as clippy.svg's orb-body gradient. For game props
  // like coins/food that AREN'T supposed to be Trajan, pass hue:'gold'
  // or 'silver'. The kawaii face (eyes + cheek blush + smile) auto-
  // draws when r >= 14; below that it's a simple body (too small for
  // legible facial features).
  //
  // opts.hue:   'blue' (default) | 'silver' | 'gold'
  // opts.face:  'happy' (default) | 'flap' | 'fall' | 'dead' | 'none'
  // opts.halo:  true (default) | false
  function drawTrajanOrb(ctx, x, y, r, opts) {
    opts = opts || {};
    const hue = opts.hue || 'blue';
    // ─── Palettes ─────────────────────────────────────────────────
    let bodyTop, bodyEdge, haloRGB, faceColor, glintColor;
    if (hue === 'silver') {
      bodyTop    = '#f0f4f8';
      bodyEdge   = '#6a7480';
      haloRGB    = '180, 200, 220';
      faceColor  = '#1a2030';
      glintColor = '#ffffff';
    } else if (hue === 'gold') {
      bodyTop    = '#ffe488';
      bodyEdge   = '#8c6418';
      haloRGB    = '212, 164, 78';
      faceColor  = '#3a2410';
      glintColor = '#fff8d8';
    } else {
      // Default: blue — matches the actual Clippy
      bodyTop    = '#4cb6ff';
      bodyEdge   = '#2e8de0';
      haloRGB    = '92, 176, 255';
      faceColor  = '#04124a';
      glintColor = '#ffffff';
    }

    // ─── Halo glow ───────────────────────────────────────────────
    if (opts.halo !== false) {
      const halo = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 1.65);
      halo.addColorStop(0, 'rgba(' + haloRGB + ', 0.42)');
      halo.addColorStop(1, 'rgba(' + haloRGB + ', 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(x, y, r * 1.65, 0, Math.PI * 2); ctx.fill();
    }

    // ─── Body ────────────────────────────────────────────────────
    // Flat-ish radial: most of the body solid, slight vignette at edge —
    // matches the v17.3 "FLAT 2D body" comment in clippy.svg.
    const body = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    body.addColorStop(0,    bodyTop);
    body.addColorStop(0.80, bodyTop);
    body.addColorStop(1,    bodyEdge);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    // ─── Face ────────────────────────────────────────────────────
    // Skip face for very small orbs (snake body/food, tiny bricks) —
    // facial features under r=14 are illegible noise.
    const face = opts.face || 'happy';
    if (face === 'none' || r < 14) return;

    // Reference proportions from clippy.svg (viewBox 200, body r=58):
    //   Eyes:   x ±17 (±0.293r), y +3 (+0.052r) below center, rx=10/ry=13
    //   Cheek:  x ±27 (±0.466r), y +20 (+0.345r), rx=11/ry=5.2
    //   Mouth:  y ~+30 (+0.517r), width ~16 (~0.276r)
    const EYE_DX    = r * 0.29;
    const CHEEK_DX  = r * 0.46;
    const CHEEK_DY  = r * 0.35;
    const CHEEK_RX  = r * 0.19;
    const CHEEK_RY  = r * 0.09;

    // Eye + mouth Y by face state
    let eyeDY, mouthY, mouthShape, eyeShape;
    if (face === 'flap') {
      // Excited: eyes wide & shining, big smile, blush
      eyeDY = r * -0.05;
      mouthY = r * 0.42;
      mouthShape = 'bigSmile';
      eyeShape = 'happy';
    } else if (face === 'fall') {
      // Worried: eyes look down, frown
      eyeDY = r * 0.10;
      mouthY = r * 0.48;
      mouthShape = 'frown';
      eyeShape = 'dots';
    } else if (face === 'dead') {
      // X eyes, flat mouth
      eyeDY = r * 0.05;
      mouthY = r * 0.45;
      mouthShape = 'flat';
      eyeShape = 'x';
    } else {
      // Default kawaii: small dots, gentle smile
      eyeDY = r * 0.05;
      mouthY = r * 0.45;
      mouthShape = 'smile';
      eyeShape = 'dots';
    }

    // ─── Cheek blush ─────────────────────────────────────────────
    // Pink ovals on lower cheeks — chibi signature. Pumped opacity
    // and slight outer glow so it reads clearly at game sizes.
    if (hue !== 'silver') {
      const blushColor = hue === 'gold'
        ? 'rgba(255, 110, 140, 0.55)'
        : 'rgba(255, 130, 165, 0.70)';
      ctx.fillStyle = blushColor;
      ctx.beginPath(); ctx.ellipse(x - CHEEK_DX, y + CHEEK_DY, CHEEK_RX * 1.05, CHEEK_RY * 1.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + CHEEK_DX, y + CHEEK_DY, CHEEK_RX * 1.05, CHEEK_RY * 1.1, 0, 0, Math.PI * 2); ctx.fill();
    }

    // ─── Eyes — chibi style ──────────────────────────────────────
    const eyeY = y + eyeDY;
    if (eyeShape === 'happy') {
      // Closed happy curves ^^ — for when overjoyed/excited.
      // Thicker stroke + slight upward arc so it reads as eyes squinting in joy.
      ctx.strokeStyle = faceColor;
      ctx.lineWidth = Math.max(1.8, r * 0.12);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x - EYE_DX, eyeY + r * 0.06, r * 0.19, Math.PI * 1.18, Math.PI * 1.82);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + EYE_DX, eyeY + r * 0.06, r * 0.19, Math.PI * 1.18, Math.PI * 1.82);
      ctx.stroke();
    } else if (eyeShape === 'x') {
      // X eyes — KO'd. Thicker for emphasis.
      ctx.strokeStyle = faceColor;
      ctx.lineWidth = Math.max(1.8, r * 0.12);
      ctx.lineCap = 'round';
      for (const ex of [x - EYE_DX, x + EYE_DX]) {
        ctx.beginPath();
        ctx.moveTo(ex - r * 0.12, eyeY - r * 0.12);
        ctx.lineTo(ex + r * 0.12, eyeY + r * 0.12);
        ctx.moveTo(ex + r * 0.12, eyeY - r * 0.12);
        ctx.lineTo(ex - r * 0.12, eyeY + r * 0.12);
        ctx.stroke();
      }
    } else {
      // ▶ DEFAULT CHIBI SPARKLE EYE ◀
      // Big tall ovals (taller than wide — the kawaii proportion) with
      // a large primary glint in the upper-left and a tiny secondary
      // glint in the lower-right. Matches clippy.svg's eyes-default.
      const eyeRX = r * 0.15;     // width
      const eyeRY = r * 0.22;     // height — taller for chibi look
      for (const dir of [-1, 1]) {
        const ex = x + EYE_DX * dir;
        // Dark eye fill
        ctx.fillStyle = faceColor;
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2);
        ctx.fill();
        // Subtle inner blue tint along the bottom — sells the depth.
        // Skip for silver hue (looks weird).
        if (hue !== 'silver') {
          ctx.fillStyle = 'rgba(90, 127, 255, 0.35)';
          ctx.beginPath();
          ctx.ellipse(ex, eyeY + eyeRY * 0.45, eyeRX * 0.78, eyeRY * 0.20, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // PRIMARY GLINT — big slanted oval, upper-left of eye
        ctx.fillStyle = glintColor;
        ctx.beginPath();
        ctx.ellipse(
          ex - eyeRX * 0.32,
          eyeY - eyeRY * 0.42,
          eyeRX * 0.46,
          eyeRY * 0.42,
          -0.35,             // tilt for sparkle feel
          0, Math.PI * 2
        );
        ctx.fill();
        // SECONDARY GLINT — small dot, lower-right
        ctx.beginPath();
        ctx.arc(
          ex + eyeRX * 0.32,
          eyeY + eyeRY * 0.32,
          Math.max(0.8, eyeRX * 0.22),
          0, Math.PI * 2
        );
        ctx.fill();
      }
    }

    // ─── Mouth ───────────────────────────────────────────────────
    ctx.strokeStyle = faceColor;
    ctx.lineWidth = Math.max(1.6, r * 0.09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (mouthShape === 'flat') {
      ctx.moveTo(x - r * 0.16, y + mouthY);
      ctx.lineTo(x + r * 0.16, y + mouthY);
    } else if (mouthShape === 'frown') {
      // Inverted arc — sad frown
      ctx.arc(x, y + mouthY + r * 0.20, r * 0.18, Math.PI * 1.15, Math.PI * 1.85);
    } else if (mouthShape === 'bigSmile') {
      // Bigger happy mouth
      ctx.arc(x, y + mouthY - r * 0.10, r * 0.22, Math.PI * 0.18, Math.PI * 0.82);
    } else {
      // Default smile: gentle upward arc — matches clippy.svg's cl-mouth-smile
      // M 92 130 Q 100 137 108 130  → centered Q below
      ctx.arc(x, y + mouthY - r * 0.08, r * 0.18, Math.PI * 0.22, Math.PI * 0.78);
    }
    ctx.stroke();
  }

  // ─── Arbitrary-pitch tone (Memory color tones, combo pitch) ───
  function playPitch(freq, dur, type) {
    if (state.preferences.sound_enabled === false) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (dur || 0.25));
    osc.start(now); osc.stop(now + (dur || 0.25) + 0.05);
  }

  // ─── Mini-Trajan for DOM games (kept from v17.21) ──────────────
  function createMiniOrb(opts) {
    opts = opts || {};
    const mini = document.createElement('div');
    mini.className = 'clippy-mini-shell';
    if (state.svgMarkup) mini.innerHTML = state.svgMarkup;
    else mini.innerHTML = '<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="60" fill="#d4a44e"/></svg>';
    if (opts.style) Object.assign(mini.style, opts.style);
    return mini;
  }

  // ─── 3-2-1-GO countdown ────────────────────────────────────────
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
      if (i >= sequence.length) { onComplete && onComplete(); return; }
      const step = sequence[i++];
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

  // ─── Shared dt-driven loop helper ──────────────────────────────
  // Returns a start() that kicks off the rAF loop, and registers a
  // cleanup so closeGameOverlay() stops it cleanly.
  function gameLoop(update) {
    let running = false, rafId = 0, lastT = 0;
    function tick(now) {
      if (!running) return;
      const dt = Math.min(2, (now - lastT) / 16.67);   // cap dt to 2 frames
      lastT = now;
      // A thrown frame must never kill the loop — that reads as a frozen
      // game with no error surfaced. Log the first few, keep ticking.
      try { update(dt); } catch (e) {
        tick._errs = (tick._errs || 0) + 1;
        if (tick._errs <= 3) console.warn('[clippy-games] frame error:', e);
      }
      if (running) rafId = requestAnimationFrame(tick);
    }
    const handle = {
      start() { running = true; lastT = performance.now(); rafId = requestAnimationFrame(tick); },
      stop()  { running = false; cancelAnimationFrame(rafId); },
      get running() { return running; },
    };
    state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => handle.stop()]);
    return handle;
  }

  // ────────────────────────────────────────────────────────────────
  // v18.4 SHARED JUICE TOOLKIT — game-feel primitives used by every
  // canvas game. Built around principles from Vlambeer (Nijman, GDC
  // 2014) and Swink's "Game Feel" (2009):
  //
  //   • Screen shake with exponential decay (not linear)
  //   • Hitstop — freeze simulation 3-6 frames on impact for weight
  //   • Score flyers — numbers that float up+fade from where points hit
  //   • Full-screen flash — white/red tint that decays
  //   • Particle bursts — far more than feels reasonable (Vlambeer: 50+)
  //
  // Usage pattern per game:
  //   const juice = makeJuice(W, H);
  //   function update(dt) {
  //     if (juice.update(dt)) return;   // hitstop pauses game logic
  //     // ... normal update
  //   }
  //   function render() {
  //     ctx.save();
  //     juice.applyShake(ctx);          // shake translates the world
  //     // ... draw world
  //     ctx.restore();
  //     juice.drawOverlay(ctx);         // flyers + flash above shake
  //   }
  //
  //   juice.shake(intensity)   // intensity ~8-18 typical; auto-decays
  //   juice.hitstop(frames)    // 3-5 frames typical; pauses update
  //   juice.flyScore(text, x, y, color?)
  //   juice.flash(color, alpha, frames)
  //   juice.particles.push({...}) for ad-hoc bursts
  // ────────────────────────────────────────────────────────────────
  function makeJuice(W, H) {
    return {
      W, H,
      shakeAmount: 0,
      flashColor: '#ffffff',
      flashAlpha: 0,
      flyers: [],
      particles: [],
      _hitstop: 0,

      shake(intensity) {
        this.shakeAmount = Math.max(this.shakeAmount, intensity || 8);
      },
      hitstop(frames) {
        this._hitstop = Math.max(this._hitstop, frames || 4);
      },
      flyScore(text, x, y, color) {
        this.flyers.push({
          text: String(text), x, y,
          vy: -1.8, vx: (Math.random() - 0.5) * 0.6,
          life: 38, maxLife: 38,
          color: color || '#ffd870',
          size: 28,
        });
      },
      flash(color, alpha, frames) {
        this.flashColor = color || '#ffffff';
        this.flashAlpha = Math.max(this.flashAlpha, alpha || 0.5);
        this._flashLife = frames || 10;
        this._flashMax  = frames || 10;
      },
      burst(x, y, count, opts) {
        opts = opts || {};
        const colors = opts.colors || ['#ffd870', '#fffef6', '#ff9a55'];
        const speed = opts.speed || 3.2;
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = 0.4 + Math.random() * speed;
          this.particles.push({
            x, y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            life: 24 + Math.random() * 26,
            maxLife: 50,
            r: 1.5 + Math.random() * 2.4,
            color: colors[Math.floor(Math.random() * colors.length)],
            gravity: opts.gravity != null ? opts.gravity : 0.10,
          });
        }
      },

      // Returns true if game logic should be paused (hitstop active).
      update(dt) {
        if (this._hitstop > 0) {
          this._hitstop -= dt;
          // Still decay shake during hitstop so the freeze feels punchy
          if (this.shakeAmount > 0) this.shakeAmount *= 0.94;
          return true;
        }
        // Shake decays with exponential easing — feels more natural
        if (this.shakeAmount > 0.05) this.shakeAmount *= 0.86;
        else this.shakeAmount = 0;
        // Flyers
        for (let i = this.flyers.length - 1; i >= 0; i--) {
          const f = this.flyers[i];
          f.y += f.vy * dt;
          f.x += f.vx * dt;
          f.vy *= 0.96;
          f.life -= dt;
          if (f.life <= 0) this.flyers.splice(i, 1);
        }
        // Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
          const p = this.particles[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += p.gravity * dt;
          p.vx *= 0.985;
          p.life -= dt;
          if (p.life <= 0) this.particles.splice(i, 1);
        }
        // Flash decay
        if (this._flashLife > 0) {
          this._flashLife -= dt;
          if (this._flashLife <= 0) this.flashAlpha = 0;
        }
        return false;
      },

      applyShake(ctx) {
        if (this.shakeAmount > 0.1) {
          const dx = (Math.random() - 0.5) * this.shakeAmount * 2;
          const dy = (Math.random() - 0.5) * this.shakeAmount * 2;
          ctx.translate(dx, dy);
        }
      },

      drawParticles(ctx) {
        for (const p of this.particles) {
          const a = Math.max(0, p.life / p.maxLife);
          const c = p.color || '#ffd870';
          if (c[0] === '#') {
            const v = parseInt(c.slice(1), 16);
            ctx.fillStyle = 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a.toFixed(2) + ')';
          } else {
            ctx.fillStyle = c;
          }
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      },

      drawOverlay(ctx) {
        // Flyers (no shake — they're UI)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const f of this.flyers) {
          const a = Math.max(0, f.life / f.maxLife);
          const sz = f.size || 24;
          ctx.font = '900 ' + sz + 'px JetBrains Mono, monospace';
          ctx.strokeStyle = 'rgba(0,0,0,' + (a * 0.85).toFixed(2) + ')';
          ctx.lineWidth = 4;
          // Color with alpha
          const c = f.color;
          if (c[0] === '#') {
            const v = parseInt(c.slice(1), 16);
            ctx.fillStyle = 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a.toFixed(2) + ')';
          } else { ctx.fillStyle = c; }
          ctx.strokeText(f.text, f.x, f.y);
          ctx.fillText(f.text, f.x, f.y);
        }
        // Flash
        if (this.flashAlpha > 0 && this._flashLife > 0) {
          const a = this.flashAlpha * Math.max(0, this._flashLife / this._flashMax);
          ctx.fillStyle = this.flashColor;
          ctx.globalAlpha = a;
          ctx.fillRect(0, 0, this.W, this.H);
          ctx.globalAlpha = 1;
        }
      },
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Medals for Flappy/Cannon-style scoring games. Returns the tier
  // object or null if score below bronze threshold.
  // v18.33 — thresholds now MATCH the shared MEDALS.flappy table
  // (50/25/10/3). The in-canvas game-over panel and the result screen
  // used to disagree (this said platinum≥100, the table said ≥50).
  // ────────────────────────────────────────────────────────────────
  function flappyMedalFor(score) {
    if (score >= 50) return { tier: 'platinum', label: 'Platinum', glyph: '◆', color: '#e0f0ff', edge: '#90b8e0' };
    if (score >= 25) return { tier: 'gold',     label: 'Gold',     glyph: '●', color: '#ffe488', edge: '#c89010' };
    if (score >= 10) return { tier: 'silver',   label: 'Silver',   glyph: '●', color: '#e8e8ec', edge: '#909098' };
    if (score >= 3)  return { tier: 'bronze',   label: 'Bronze',   glyph: '●', color: '#e0a060', edge: '#8c5418' };
    return null;
  }

  // ────────────────────────────────────────────────────────────────
  // Persistent best-score store for any game. Keyed per-game, per-user.
  // v18.33 — now a VIEW over the same clippy_highscores map that the
  // menu and result screen use. There were two divergent stores
  // (clippy_best_<id> vs the map), so the in-game "BEST" HUD and the
  // result screen could show different numbers forever. One-time
  // migration folds the higher of the two in.
  // ────────────────────────────────────────────────────────────────
  function getBest(gameId) {
    try {
      const legacy = parseInt(localStorage.getItem(userKey('clippy_best_' + gameId)), 10) || 0;
      const map = getHighScores()[gameId] || 0;
      if (legacy > map) { saveHighScore(gameId, legacy); return legacy; }
      return map;
    } catch (_) { return 0; }
  }
  function setBest(gameId, value) {
    try { saveHighScore(gameId, value); } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════════
  // GAME 1: TAP THE ORB — 30s, combo chains, gold bonus orbs
  // ════════════════════════════════════════════════════════════════
  function startTapGame() {
    const ov = createGameOverlay();
    let score = 0, taps = 0, combo = 0, maxCombo = 0, bonuses = 0;
    let timeLeft = 30, lastTapAt = 0;
    let running = false, bonusTimer = null;
    const intro = pickFromPool('game_intro_tap');
    ov.innerHTML = `
      <div class="clippy-game-title">⚡ Tap the Orb</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">⚡ TAP THE ORB</div>
        <div class="clippy-tap-hud">
          <div class="hud-stat">⏱ <span data-time>${timeLeft}</span>s</div>
          <div class="hud-stat">PTS <span data-score>0</span></div>
          <div class="hud-stat clippy-tap-combo" data-combo-wrap><span>🔥</span><span data-combo>0</span></div>
        </div>
        <div class="clippy-game-board" data-board></div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;">Chain taps for combos. Gold orbs = +10!</div>
        <div class="clippy-game-buttons"><button class="clippy-game-btn is-ghost" data-act="quit">Quit</button></div>`;
      const board = ov.querySelector('[data-board]');
      const timeEl = ov.querySelector('[data-time]');
      const scoreEl = ov.querySelector('[data-score]');
      const comboEl = ov.querySelector('[data-combo]');
      const comboWrap = ov.querySelector('[data-combo-wrap]');
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => {
        running = false; if (bonusTimer) clearTimeout(bonusTimer); closeGameOverlay();
      });

      const target = createMiniOrb({ style: { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } });
      board.appendChild(target);

      function mult() { return combo >= 10 ? 3 : combo >= 5 ? 2 : 1; }
      function refreshCombo() {
        comboEl.textContent = combo;
        comboWrap.classList.remove('is-hot', 'is-blazing');
        if (combo >= 10) comboWrap.classList.add('is-blazing');
        else if (combo >= 5) comboWrap.classList.add('is-hot');
      }

      target.addEventListener('click', () => {
        if (!running) return;
        const now = performance.now();
        if (lastTapAt && now - lastTapAt < 400) combo++;
        else combo = 1;
        if (combo > maxCombo) maxCombo = combo;
        lastTapAt = now;
        taps++;
        score += mult();
        scoreEl.textContent = score;
        refreshCombo();
        target.classList.remove('is-tapped');
        void target.offsetWidth;
        target.classList.add('is-tapped');
        playPitch(660 + Math.min(combo, 20) * 30, 0.06, 'triangle');
        if (mult() >= 3) spawnParticles({ count: 3, type: 'sparkle' });
      });

      function spawnBonus() {
        if (!running) return;
        const bonus = document.createElement('div');
        bonus.className = 'clippy-tap-bonus';
        const bw = board.getBoundingClientRect();
        bonus.style.left = (40 + Math.random() * Math.max(1, bw.width - 80) - 30) + 'px';
        bonus.style.top = (40 + Math.random() * Math.max(1, bw.height - 80) - 30) + 'px';
        bonus.innerHTML = state.svgMarkup || '';
        board.appendChild(bonus);
        const life = setTimeout(() => {
          try { bonus.classList.add('is-fading'); } catch (_) {}
          setTimeout(() => { try { bonus.remove(); } catch (_) {} }, 250);
          combo = 0; refreshCombo();
        }, 2500);
        bonus.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!running) return;
          clearTimeout(life);
          score += 10; bonuses++; combo++;
          if (combo > maxCombo) maxCombo = combo;
          scoreEl.textContent = score;
          refreshCombo();
          bonus.classList.add('is-caught');
          spawnParticles({ count: 8, type: 'sparkle' });
          playPitch(1200, 0.20, 'triangle');
          setTimeout(() => { try { bonus.remove(); } catch (_) {} }, 350);
        });
        bonusTimer = setTimeout(spawnBonus, 5000 + Math.random() * 4000);
      }

      runCountdown(board, () => {
        running = true;
        const tick = setInterval(() => {
          if (!running || document.hidden) return;
          timeLeft--;
          timeEl.textContent = timeLeft;
          if (timeLeft <= 0) {
            clearInterval(tick);
            if (bonusTimer) clearTimeout(bonusTimer);
            running = false;
            showGameResult('tap', score, {
              stats: [
                { label: 'Taps', value: taps },
                { label: 'Bonuses', value: bonuses },
                { label: 'Max combo', value: maxCombo },
              ],
            });
          }
        }, 1000);
        bonusTimer = setTimeout(spawnBonus, 4000 + Math.random() * 3000);
        state.gameCleanupFns = (state.gameCleanupFns || []).concat([
          () => clearInterval(tick),
          () => { if (bonusTimer) clearTimeout(bonusTimer); },
        ]);
      });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // GAME 2: CATCH ME — v18.11 leveled progression
  //
  //   20 levels, 5 rounds each. Need 4/5 hits (80%) to advance.
  //   First 5 levels are deliberately forgiving so onboarding feels
  //   good; difficulty ramps sharply after that. Score = highest
  //   level cleared. Game ends when player fails to advance.
  //
  //   Phases (each = 5 levels):
  //     1-5   EASY    — large target, long window, no decoys
  //     6-10  MEDIUM  — smaller, faster, optional decoy at lvl 8+
  //     11-15 HARD    — tight, 1 decoy
  //     16-20 EXTREME — tiny, lightning fast, 2 decoys
  // ════════════════════════════════════════════════════════════════
  function startCatchGame() {
    const ov = createGameOverlay();
    const TOTAL_LEVELS = 20;
    const ROUNDS_PER_LEVEL = 5;
    const PASS_THRESHOLD = 4; // 80% of 5

    let level = 1, roundInLevel = 0, hitsThisLevel = 0;
    let running = false, moveTimer = null;
    const intro = pickFromPool('game_intro_catch');
    ov.innerHTML = `
      <div class="clippy-game-title">🏃 Catch Me</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-instruction" style="font-size:12px;opacity:0.65;">
        20 levels. Hit 4 of 5 to advance. The first five are slow on purpose.
      </div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      running = true;
      ov.innerHTML = `
        <div class="clippy-game-title">🏃 CATCH ME</div>
        <div class="clippy-tap-hud">
          <div class="hud-stat">LVL <span data-level>1</span>/${TOTAL_LEVELS}</div>
          <div class="hud-stat">HIT <span data-hits>0</span>/${ROUNDS_PER_LEVEL}</div>
          <div class="hud-stat" data-phase>EASY</div>
        </div>
        <div class="clippy-game-board" data-board></div>
        <div class="clippy-game-buttons"><button class="clippy-game-btn is-ghost" data-act="quit">Quit</button></div>`;
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => {
        running = false;
        if (moveTimer) clearTimeout(moveTimer);
        closeGameOverlay();
      });
      const board = ov.querySelector('[data-board]');
      const target = createMiniOrb();
      target.style.transition = 'transform 0.12s ease';
      board.appendChild(target);
      const decoys = [];

      const levelEl = ov.querySelector('[data-level]');
      const hitsEl  = ov.querySelector('[data-hits]');
      const phaseEl = ov.querySelector('[data-phase]');

      // Level-based difficulty. First 5 levels are GENTLE — large
      // target, long reaction window, zero decoys. After that the
      // curve gets meaningfully tighter at every level.
      function levelParams(lv) {
        let windowMs, sizePx, decoyCount, phase;
        if (lv <= 5) {
          // EASY phase: 1900 → 1400ms, 115 → 95px
          windowMs   = 1900 - (lv - 1) * 125;
          sizePx     = 115  - (lv - 1) * 5;
          decoyCount = 0;
          phase      = 'EASY';
        } else if (lv <= 10) {
          // MEDIUM phase: 1300 → 850ms, 88 → 70px, decoy from lvl 8
          windowMs   = 1300 - (lv - 6) * 110;
          sizePx     = 88   - (lv - 6) * 4;
          decoyCount = lv >= 8 ? 1 : 0;
          phase      = 'MEDIUM';
        } else if (lv <= 15) {
          // HARD: 780 → 560ms, 64 → 50px, always 1 decoy
          windowMs   = 780  - (lv - 11) * 55;
          sizePx     = 64   - (lv - 11) * 3;
          decoyCount = 1;
          phase      = 'HARD';
        } else {
          // EXTREME: 520 → 380ms, 46 → 38px, 2 decoys
          windowMs   = 520  - (lv - 16) * 35;
          sizePx     = 46   - (lv - 16) * 2;
          decoyCount = 2;
          phase      = 'EXTREME';
        }
        return { windowMs, sizePx, decoyCount, phase };
      }

      function clearDecoys() {
        for (const d of decoys) { try { d.remove(); } catch (_) {} }
        decoys.length = 0;
      }

      function makeDecoy(sz) {
        const d = document.createElement('div');
        d.className = 'clippy-tap-target clippy-decoy';
        // Decoys are visually similar but slightly dimmed + tinted red
        d.style.width = sz + 'px';
        d.style.height = sz + 'px';
        d.style.position = 'absolute';
        d.style.borderRadius = '50%';
        d.style.background = 'radial-gradient(circle, rgba(255,140,140,0.85) 35%, rgba(180,60,60,0.6) 80%)';
        d.style.boxShadow = '0 0 8px rgba(255,80,80,0.5)';
        d.style.cursor = 'pointer';
        d.addEventListener('click', () => {
          if (!running) return;
          // Tapping a decoy = miss penalty (counts as missed round)
          d.classList.add('is-tapped');
          playPitch(180, 0.08, 'square');
          try { feel('surprise', 0.10); feel('disgust', 0.05); } catch(_){}
          nextRound(false); // explicit miss
        });
        board.appendChild(d);
        return d;
      }

      function reposition() {
        const params = levelParams(level);
        const rect = board.getBoundingClientRect();
        // Real target
        target.style.width  = params.sizePx + 'px';
        target.style.height = params.sizePx + 'px';
        target.style.left = (Math.random() * Math.max(0, rect.width  - params.sizePx)) + 'px';
        target.style.top  = (Math.random() * Math.max(0, rect.height - params.sizePx)) + 'px';
        // Decoys
        clearDecoys();
        for (let i = 0; i < params.decoyCount; i++) {
          const d = makeDecoy(params.sizePx);
          d.style.left = (Math.random() * Math.max(0, rect.width  - params.sizePx)) + 'px';
          d.style.top  = (Math.random() * Math.max(0, rect.height - params.sizePx)) + 'px';
          decoys.push(d);
        }
      }

      function nextRound(hit) {
        if (moveTimer) clearTimeout(moveTimer);
        // Score the round we just finished (if there was one)
        if (roundInLevel > 0) {
          if (hit) hitsThisLevel++;
        }
        // Did we just finish a level?
        if (roundInLevel >= ROUNDS_PER_LEVEL) {
          finishLevel();
          return;
        }
        roundInLevel++;
        hitsEl.textContent = hitsThisLevel;
        reposition();
        const params = levelParams(level);
        moveTimer = setTimeout(() => nextRound(false), params.windowMs);
      }

      function finishLevel() {
        const passed = hitsThisLevel >= PASS_THRESHOLD;
        // Show a brief banner
        const banner = document.createElement('div');
        banner.className = 'clippy-game-level-banner';
        banner.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
          'padding:14px 22px;border-radius:14px;font-weight:700;font-size:18px;' +
          'background:rgba(0,0,0,0.85);color:#fff;z-index:10;';
        if (passed) {
          banner.textContent = `LEVEL ${level} CLEARED — ${hitsThisLevel}/5`;
          banner.style.border = '2px solid #4cb6ff';
          banner.style.color = '#7fd0ff';
          try { feel('joy', 0.18); feel('excitement', 0.08); } catch(_){}
        } else {
          banner.textContent = `Got ${hitsThisLevel}/5. Need 4 to advance.`;
          banner.style.border = '2px solid #ffa8c4';
          banner.style.color = '#ffc8d8';
          try { feel('sadness', 0.10); feel('anticipation', 0.10); } catch(_){}
        }
        board.appendChild(banner);
        clearDecoys();
        try { target.style.opacity = '0'; } catch(_){}

        setTimeout(() => {
          try { banner.remove(); } catch(_){}
          try { target.style.opacity = '1'; } catch(_){}
          if (!passed) {
            // Game over — score = last cleared level
            running = false;
            const cleared = level - 1;
            showGameResult('catch', cleared, {
              stats: [
                { label: 'Phase reached', value: levelParams(level).phase },
                { label: 'Final round',   value: `${hitsThisLevel}/5 hits` },
              ],
            });
            return;
          }
          // Advance
          if (level >= TOTAL_LEVELS) {
            // Beat the game
            running = false;
            try { feel('joy', 0.40); feel('excitement', 0.35); feel('trust', 0.10); } catch(_){}
            showGameResult('catch', TOTAL_LEVELS, {
              stats: [
                { label: 'Perfect run',   value: 'all 20 levels' },
                { label: 'Phase reached', value: 'EXTREME' },
              ],
            });
            return;
          }
          level++;
          roundInLevel = 0;
          hitsThisLevel = 0;
          levelEl.textContent = level;
          hitsEl.textContent  = 0;
          phaseEl.textContent = levelParams(level).phase;
          nextRound(false);
        }, 1400);
      }

      target.addEventListener('click', () => {
        if (!running) return;
        if (moveTimer) clearTimeout(moveTimer);
        target.classList.add('is-tapped');
        setTimeout(() => target.classList.remove('is-tapped'), 220);
        playTone('boop');
        spawnParticles({ count: 4, type: 'sparkle' });
        nextRound(true);
      });

      // Initial state + first round
      phaseEl.textContent = levelParams(1).phase;
      runCountdown(board, () => {
        nextRound(false);
        state.gameCleanupFns = (state.gameCleanupFns || []).concat([
          () => moveTimer && clearTimeout(moveTimer),
          () => clearDecoys(),
        ]);
      });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // GAME 3: REACTION — 5 rounds, anti-cheat aborts after 2 early taps
  // ════════════════════════════════════════════════════════════════
  function startReactionGame() {
    const ov = createGameOverlay();
    let round = 0;
    const totalRounds = 5;
    const times = [];
    let earlyCount = 0;
    const intro = pickFromPool('game_intro_reaction');
    ov.innerHTML = `
      <div class="clippy-game-title">⚡ Reaction Time</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', runRound);
    function runRound() {
      round++;
      ov.innerHTML = `
        <div class="clippy-game-title">⚡ REACTION ${round}/${totalRounds}</div>
        <div class="clippy-game-instruction" data-msg>Wait for GREEN glow...</div>
        <div class="clippy-game-board"></div>`;
      const board = ov.querySelector('.clippy-game-board');
      const target = createMiniOrb({ style: { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } });
      target.classList.add('is-wait');
      board.appendChild(target);
      const msg = ov.querySelector('[data-msg]');
      const delay = 1200 + Math.random() * 2800;
      let goAt = 0, earlyClick = false;
      const earlyHandler = () => {
        if (goAt === 0) {
          earlyClick = true;
          earlyCount++;
          if (earlyCount >= 2) {
            msg.textContent = 'Two false starts — game over.';
            setTimeout(() => showGameResult('reaction', 999, {
              stats: [{ label: 'Aborted', value: 'too many false starts' }],
            }), 1400);
            return;
          }
          msg.textContent = 'Too early! Retrying...';
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
              const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
              const best = Math.min(...times);
              const worst = Math.max(...times);
              showGameResult('reaction', avg, {
                stats: [
                  { label: 'Best', value: best + ' ms' },
                  { label: 'Worst', value: worst + ' ms' },
                  { label: 'All', value: times.join(', ') + ' ms' },
                ],
              });
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

  // ════════════════════════════════════════════════════════════════
  // GAME 4: MEMORY MATCH — +1 orb every 5 levels, per-orb pitches
  // ════════════════════════════════════════════════════════════════
  function startMemoryGame() {
    const ov = createGameOverlay();
    const ALL_COLORS = ['r', 'g', 'b', 'y', 'p', 'o', 'c', 'k', 'w'];
    // Pentatonic-ish C-major pitches per color so any sequence is musical
    const PITCHES = { r: 392, g: 440, b: 523, y: 587, p: 659, o: 698, c: 784, k: 880, w: 988 };
    const sequence = [];
    let userIdx = 0, level = 0, acceptingInput = false;
    let activeColors = ALL_COLORS.slice(0, 4);
    const intro = pickFromPool('game_intro_memory');
    ov.innerHTML = `
      <div class="clippy-game-title">🧠 Memory Match</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">🧠 MEMORY MATCH</div>
        <div class="clippy-flappy-board" style="height:300px;" data-countdown-board></div>`;
      const cdBoard = ov.querySelector('[data-countdown-board]');
      runCountdown(cdBoard, () => { level = 0; runNextLevel(); });
    });

    function colorsForLevel(lvl) {
      const extra = Math.floor((lvl - 1) / 5);   // +1 orb every 5 levels (was 10)
      const count = Math.min(ALL_COLORS.length, 4 + extra);
      return ALL_COLORS.slice(0, count);
    }

    function runNextLevel() {
      level++;
      activeColors = colorsForLevel(level);
      sequence.push(activeColors[Math.floor(Math.random() * activeColors.length)]);
      userIdx = 0;
      acceptingInput = false;
      ov.innerHTML = `
        <div class="clippy-game-title">🧠 MEMORY MATCH</div>
        <div class="clippy-memory-level-banner">Level ${level} · ${activeColors.length} orbs · Watch...</div>
        <div class="clippy-memory-grid" data-grid></div>
        <div class="clippy-game-buttons"><button class="clippy-game-btn is-ghost" data-act="quit">Quit</button></div>`;
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => {
        showGameResult('memory', Math.max(0, level - 1));
      });
      const grid = ov.querySelector('[data-grid]');
      const banner = ov.querySelector('.clippy-memory-level-banner');
      const cells = activeColors.map(color => {
        const cell = createMiniOrb();
        cell.classList.remove('clippy-mini-shell');
        cell.classList.add('clippy-memory-cell', 'is-disabled');
        cell.setAttribute('data-color', color);
        grid.appendChild(cell);
        return cell;
      });
      // Faster playback as levels increase
      const flashEach = Math.max(280, 520 - Math.floor(level / 3) * 30);
      const gapBetween = Math.max(120, flashEach - 340);
      let i = 0;
      const playInterval = setInterval(() => {
        if (i >= sequence.length) {
          clearInterval(playInterval);
          acceptingInput = true;
          cells.forEach(c => c.classList.remove('is-disabled'));
          banner.textContent = `Level ${level} · Your turn`;
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
          playPitch(PITCHES[c] || 660, 0.18, 'triangle');
          setTimeout(() => cell.classList.remove('flash-' + c), flashEach - gapBetween);
        }
        i++;
      }, flashEach);
      state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => clearInterval(playInterval)]);

      function handleTap(color, cell) {
        const expected = sequence[userIdx];
        if (color !== expected) {
          banner.textContent = `Wrong! Reached level ${level - 1}.`;
          acceptingInput = false;
          playPitch(180, 0.4, 'square');
          setTimeout(() => showGameResult('memory', Math.max(0, level - 1)), 1400);
          return;
        }
        cell.classList.add('flash-' + color);
        playPitch(PITCHES[color] || 660, 0.18, 'triangle');
        setTimeout(() => cell.classList.remove('flash-' + color), 280);
        userIdx++;
        if (userIdx >= sequence.length) {
          acceptingInput = false;
          banner.textContent = `Level ${level} cleared!`;
          if (level % 5 === 0 && level > 0) {
            spawnParticles({ count: 16, type: 'sparkle' });
            playTone('milestone');
            setTimeout(() => {
              banner.textContent = `LEVEL ${level}! +1 orb...`;
            }, 600);
          }
          setTimeout(runNextLevel, level % 5 === 0 ? 1800 : 950);
        }
      }
    }
  }


  // ════════════════════════════════════════════════════════════════
  // GAME 5: FLAPPY TRAJAN — v18.4 overhaul with real game feel
  //
  //   Studied: Flappy Bird's feel (Dong Nguyen), Vlambeer screenshake
  //   talk, Swink's Game Feel book. Concretely applied:
  //
  //   PHYSICS (canonical Flappy values, not the soft v18.2 set):
  //     • GRAVITY = 0.62, FLAP_V = -9.4 — snappy + weighty fall
  //     • Bird rotates with velocity (banking up + nose-dive down)
  //
  //   JUICE (every input has loud feedback):
  //     • Each scored pillar = "+1" big flyer popping up from pillar
  //       location + ascending chime per combo level
  //     • Bonus star = "+5" gold flyer + 18-particle burst + bright flash
  //     • Combo milestones (5/10/15...) = banner flyer + chord
  //     • Collision = 5-frame hitstop + shake intensity 16 + 32-particle
  //       burst + dark red flash. The freeze sells the impact.
  //     • New best = confetti burst + "NEW BEST!" stencil flyer
  //
  //   PROGRESSION (the addiction loop):
  //     • Persistent best score per user, shown always
  //     • Medals: bronze 10, silver 25, gold 50, platinum 100 — drawn
  //       with brass-relief style on game over
  //     • Day → sunset → night sky cycle (kept from v18.2)
  //     • Difficulty curve: gap 170→100, speed 2.2→3.6
  //
  //   RETRY: one tap. No overlay teardown. Hint row + button row swap
  //   in place, countdown re-runs.
  // ════════════════════════════════════════════════════════════════
  function startFlappyGame() {
    const ov = createGameOverlay();
    const intro = pickFromPool('game_intro_flappy');
    ov.innerHTML = `
      <div class="clippy-game-title">🕊️ Flappy Trajan</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-stat" data-stats>Best: <b>${getBest('flappy')}</b></div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">🕊️ FLAPPY TRAJAN</div>
        <div class="clippy-canvas-wrap" data-wrap></div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;" data-hint>Tap to flap.  Best: ${getBest('flappy')}</div>
        <div class="clippy-game-buttons"><button class="clippy-game-btn is-ghost" data-act="quit">Quit</button></div>`;
      const wrap = ov.querySelector('[data-wrap]');
      const hint = ov.querySelector('[data-hint]');
      const board = makeCanvasBoard(wrap, { bg: 'transparent' });
      const { ctx, w: W, h: H } = board;
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => { loop.stop(); closeGameOverlay(); });

      // ─── Constants — canonical Flappy feel ──────────────────────
      const GROUND_Y = H - 28;
      // v18.33 — hitbox was Ø32 vs a Ø44 drawing: "clearly hit it but
      // lived / clearly missed but died". Now near-visual with a small
      // grace margin; gap floors raised below to stay fair.
      const BIRD_R   = 19;
      const BIRD_VR  = 22;
      const BIRD_X   = Math.floor(W * 0.28);
      const GRAVITY  = 0.62;
      const FLAP_V   = -9.4;
      const PILLAR_W = 56;

      // ─── State ──────────────────────────────────────────────────
      let birdY = H * 0.42, birdV = 0, birdRot = 0;
      let score = 0, combo = 0, bestCombo = 0;
      let best  = getBest('flappy');
      let started = false, alive = true, isRetryShown = false;
      const columns = [];
      const trail = [];
      const bonusStars = [];
      let nextColumnX = W + 60;
      let groundOff = 0, t = 0;
      let flapPulse = 0;
      let comboFlash = 0, comboFlashLabel = '';
      let nearMissPulse = 0;
      const juice = makeJuice(W, H);

      // ─── Difficulty ─────────────────────────────────────────────
      // v18.11 — two-stage curves. Linear ramp up to score 50-ish,
      // then a slower continued ramp toward harder floors. Difficulty
      // never plateaus.
      function gapAt(s) {
        if (s <= 50) return Math.max(110, 170 - s * 1.2);
        return Math.max(92, 110 - (s - 50) * 0.5);
      }
      function speedAt(s) {
        if (s <= 50) return Math.min(3.6, 2.2 + s * 0.028);
        return Math.min(5.0, 3.6 + (s - 50) * 0.014);
      }
      function spacingAt(s) {
        if (s <= 40) return Math.max(155, 220 - s * 1.6);
        return Math.max(130, 155 - (s - 40) * 0.4);
      }
      // v18.11 — moving pipes get more common as score climbs.
      // 0% before score 15. 30% by 15-30. 55% by 30-50. 75% past 50.
      function oscChanceAt(s) {
        if (s < 15) return 0;
        if (s < 30) return 0.30;
        if (s < 50) return 0.55;
        return 0.75;
      }

      // ─── Sky palette (day → sunset → night) ─────────────────────
      function skyColors(s) {
        if (s < 20) {
          const k = s / 20;
          return [mixColor('#5fa8e8', '#e89a64', k), mixColor('#a6c4e0', '#ffc89a', k), mixColor('#dbe5f2', '#ffd8a8', k)];
        }
        if (s < 40) {
          const k = (s - 20) / 20;
          return [mixColor('#e89a64', '#1a2858', k), mixColor('#ffc89a', '#3a3870', k), mixColor('#ffd8a8', '#4a4078', k)];
        }
        return ['#0a1430', '#1c1b40', '#2a2658'];
      }
      function mixColor(a, b, t) {
        const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
        const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
        const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
        return 'rgb(' + Math.round(ar + (br - ar) * t) + ',' + Math.round(ag + (bg - ag) * t) + ',' + Math.round(ab + (bb - ab) * t) + ')';
      }

      // ─── Parallax layers ────────────────────────────────────────
      const farClouds = [], nearClouds = [], mountains = [], nightStars = [];
      for (let i = 0; i < 5; i++) farClouds.push({ x: Math.random() * W, y: 25 + Math.random() * (H * 0.3), r: 18 + Math.random() * 14, v: 0.10 + Math.random() * 0.10 });
      for (let i = 0; i < 4; i++) nearClouds.push({ x: Math.random() * W, y: 60 + Math.random() * (H * 0.35), r: 22 + Math.random() * 18, v: 0.25 + Math.random() * 0.20 });
      for (let i = 0; i < 6; i++) mountains.push({ x: i * (W / 5) + Math.random() * 40 - 20, h: 60 + Math.random() * 40, w: 110 + Math.random() * 60 });
      for (let i = 0; i < 38; i++) nightStars.push({ x: Math.random() * W, y: Math.random() * (H * 0.55), r: Math.random() * 1.2 + 0.3, p: Math.random() * Math.PI * 2 });

      // ─── Spawning ───────────────────────────────────────────────
      function spawnColumn() {
        // v18.33 — difficulty rides the REAL score (was partly driven
        // by how many columns happened to be alive on screen).
        const lastScore = score;
        const GAP = gapAt(lastScore);
        const baseGapY = 40 + Math.random() * (GROUND_Y - GAP - 80);
        // v18.11 — moving pipes. Probability scales with score. Each
        // oscillating pipe gets its own amplitude, frequency, phase
        // so they don't all bob in unison.
        const oscillate = Math.random() < oscChanceAt(lastScore);
        const oscAmp   = oscillate ? 18 + Math.random() * 22 : 0;
        const oscFreq  = 0.0016 + Math.random() * 0.0014;
        const oscPhase = Math.random() * Math.PI * 2;
        const col = {
          x: nextColumnX,
          gapY: baseGapY, baseGapY,
          gap: GAP, scored: false, idx: columns.length,
          oscillate, oscAmp, oscFreq, oscPhase,
        };
        columns.push(col);
        nextColumnX += spacingAt(lastScore);
        if (score >= 6 && Math.random() < 0.40) {
          bonusStars.push({ colIdx: col.idx, taken: false, phase: Math.random() * Math.PI * 2 });
        }
      }
      function flap() {
        if (!alive) { if (isRetryShown) restart(); return; }
        if (!started) { started = true; hint.textContent = 'Dodge the columns. Catch the stars.'; }
        birdV = FLAP_V;
        flapPulse = 1;
        // Thock: low percussive triangle wave — distinctly punchy
        playPitch(280, 0.07, 'triangle');
        // v18.11 — every flap is a small anticipatory beat
        try { feel('anticipation', 0.015); } catch(_){}
      }
      function restart() {
        birdY = H * 0.42; birdV = 0; birdRot = 0;
        score = 0; combo = 0;
        started = false; alive = true;
        columns.length = 0; trail.length = 0; bonusStars.length = 0;
        nextColumnX = W + 60;
        groundOff = 0; t = 0;
        flapPulse = 0; comboFlash = 0; nearMissPulse = 0;
        isRetryShown = false;
        juice.flyers.length = 0;
        juice.particles.length = 0;
        juice.shakeAmount = 0;
        juice._hitstop = 0;
        hint.textContent = 'Tap to flap.  Best: ' + best;
        const btnRow = ov.querySelector('.clippy-game-buttons');
        btnRow.innerHTML = '<button class="clippy-game-btn is-ghost" data-act="quit">Quit</button>';
        btnRow.querySelector('[data-act="quit"]').addEventListener('click', () => { loop.stop(); closeGameOverlay(); });
        runCountdown(board.wrap, () => {});
      }
      // v18.33 — ONE input path. click+touchstart both fired on mobile
      // (touchstart, then the synthesized click ~300ms later) → double
      // flap per tap → the floaty, uncontrollable feel. pointerdown
      // covers mouse + touch + pen exactly once.
      board.wrap.addEventListener('pointerdown', (e) => { e.preventDefault(); flap(); });

      // ─── Update ─────────────────────────────────────────────────
      function update(dt) {
        t += dt;

        // Parallax always animates
        for (const c of farClouds)  { c.x -= c.v * dt; if (c.x + c.r * 2 < 0) { c.x = W + c.r * 2; c.y = 25 + Math.random() * (H * 0.3); } }
        for (const c of nearClouds) { c.x -= c.v * dt; if (c.x + c.r * 2 < 0) { c.x = W + c.r * 2; c.y = 60 + Math.random() * (H * 0.35); } }

        if (flapPulse > 0)     flapPulse     = Math.max(0, flapPulse     - 0.085 * dt);
        if (comboFlash > 0)    comboFlash    = Math.max(0, comboFlash    - 0.035 * dt);
        if (nearMissPulse > 0) nearMissPulse = Math.max(0, nearMissPulse - 0.05  * dt);

        // Juice update (handles hitstop — we run our death animation
        // even during hitstop, so don't early-return)
        const frozen = juice.update(dt);

        if (!started) return;

        if (!alive) {
          // Death animation continues even during hitstop, but slower
          const tick = frozen ? 0.25 : 1;
          birdV += GRAVITY * dt * tick;
          birdY += birdV * dt * tick;
          if (birdY > GROUND_Y - BIRD_R) {
            birdY = GROUND_Y - BIRD_R;
            birdV = 0;
            if (!isRetryShown) {
              isRetryShown = true;
              juice.shake(6);
              juice.burst(BIRD_X, birdY, 14, { colors: ['#8c6418', '#4a3a20'], speed: 2.0, gravity: 0.4 });
              setTimeout(showDeathOptions, 380);
            }
          }
          return;
        }
        if (frozen) return;   // hitstop pauses live gameplay

        // Physics
        birdV += GRAVITY * dt;
        birdY += birdV * dt;
        birdRot = Math.max(-0.55, Math.min(1.35, birdV * 0.08));
        groundOff = (groundOff + speedAt(score) * dt) % 24;

        // Trail emit (more particles → meatier feel)
        if (Math.random() < 0.55) {
          trail.push({ x: BIRD_X - BIRD_VR * 0.4, y: birdY + (Math.random() - 0.5) * 6, life: 20, maxLife: 20, r: 2 + Math.random() * 1.6 });
        }
        for (let i = trail.length - 1; i >= 0; i--) {
          trail[i].life -= dt;
          trail[i].x -= speedAt(score) * dt;
          if (trail[i].life <= 0) trail.splice(i, 1);
        }

        // Columns
        const SCROLL = speedAt(score);
        if (columns.length === 0 || columns[columns.length - 1].x < W - spacingAt(score)) spawnColumn();
        for (let i = columns.length - 1; i >= 0; i--) {
          const c = columns[i];
          c.x -= SCROLL * dt;
          // v18.11 — moving pipes: shift gapY along a sine wave per column.
          if (c.oscillate) {
            c.gapY = c.baseGapY + Math.sin(t * c.oscFreq + c.oscPhase) * c.oscAmp;
          }
          if (c.x + PILLAR_W < 0) { columns.splice(i, 1); continue; }

          // Score the moment the bird passes the column's right edge
          if (!c.scored && c.x + PILLAR_W < BIRD_X - BIRD_R) {
            c.scored = true;
            score++;
            combo++;
            // Ascending chime per combo level
            const pitch = 440 + Math.min(660, combo * 32);
            playPitch(pitch, 0.10, 'triangle');
            // Score flyer pops from the gap center
            const fx = c.x + PILLAR_W / 2;
            const fy = c.gapY + c.gap / 2;
            juice.flyScore('+1', fx, fy, '#ffd870');
            juice.burst(fx, fy, 6, { colors: ['#ffd870', '#fffef6'], speed: 1.6, gravity: -0.02 });
            // Combo milestone (5/10/15...)
            if (combo > 0 && combo % 5 === 0) {
              comboFlash = 1;
              comboFlashLabel = combo + ' FLOW!';
              juice.flash('#ffd870', 0.25, 10);
              juice.burst(W / 2, H * 0.32, 18, { colors: ['#ffd870', '#fff4c8'], speed: 4 });
              // Chord
              playPitch(523, 0.12, 'triangle');
              setTimeout(() => playPitch(659, 0.12, 'triangle'), 60);
              setTimeout(() => playPitch(784, 0.14, 'triangle'), 120);
              // v18.11 — milestone = joy + excitement burst
              try { feel('joy', 0.10); feel('excitement', 0.08); } catch(_){}
            }
          }
          // Collision
          const top    = { x: c.x, y: 0,              w: PILLAR_W, h: c.gapY };
          const bottom = { x: c.x, y: c.gapY + c.gap, w: PILLAR_W, h: GROUND_Y - (c.gapY + c.gap) };
          if (circleAABB(BIRD_X, birdY, BIRD_R, top) || circleAABB(BIRD_X, birdY, BIRD_R, bottom)) {
            return killBird();
          }
          // Near-miss visual (no score, just feel)
          if (!c.scored && Math.abs((c.x + PILLAR_W) - (BIRD_X - BIRD_R)) < 12) {
            const gapEdge = Math.min(Math.abs(birdY - c.gapY), Math.abs(birdY - (c.gapY + c.gap)));
            if (gapEdge < 22) {
              nearMissPulse = Math.max(nearMissPulse, 0.9);
              // v18.11 — near miss = surprise spike (small, repeating)
              try { feel('surprise', 0.04); } catch(_){}
            }
          }
        }

        // Bonus stars
        for (let i = bonusStars.length - 1; i >= 0; i--) {
          const s = bonusStars[i];
          if (s.taken) { bonusStars.splice(i, 1); continue; }
          const col = columns.find(c => c.idx === s.colIdx);
          if (!col) { bonusStars.splice(i, 1); continue; }
          const sx = col.x + PILLAR_W / 2;
          const sy = col.gapY + col.gap / 2;
          if (sx + 12 < 0) { bonusStars.splice(i, 1); continue; }
          const dx = sx - BIRD_X, dy = sy - birdY;
          if (dx * dx + dy * dy < (BIRD_R + 11) * (BIRD_R + 11)) {
            s.taken = true;
            score += 5;
            juice.flyScore('+5', sx, sy, '#ffe488');
            juice.burst(sx, sy, 18, { colors: ['#ffd870', '#fff4c8', '#ffffff'], speed: 4 });
            juice.flash('#fff4c8', 0.30, 8);
            playPitch(880, 0.18, 'triangle');
            setTimeout(() => playPitch(1320, 0.12, 'triangle'), 70);
          }
        }

        // Ceiling / ground
        if (birdY - BIRD_R < 0) { birdY = BIRD_R; birdV = 0; }
        if (birdY + BIRD_R > GROUND_Y) return killBird();
      }

      function circleAABB(cx, cy, cr, rect) {
        const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        const dx = cx - nx, dy = cy - ny;
        return dx * dx + dy * dy < cr * cr;
      }

      function killBird() {
        if (!alive) return;
        alive = false;
        // Big impact moment: hitstop + shake + flash + burst
        juice.hitstop(5);
        juice.shake(18);
        juice.flash('#c83a3a', 0.55, 12);
        juice.burst(BIRD_X, birdY, 36, { colors: ['#d4a44e', '#fff4c8', '#ff8855'], speed: 5.4 });
        // Stronger sound — thud + scrape
        playPitch(140, 0.18, 'sawtooth');
        setTimeout(() => playPitch(90, 0.30, 'sawtooth'), 60);
        // Slight upward bounce on death
        birdV = -2;
        if (combo > bestCombo) bestCombo = combo;
        combo = 0;
        // v18.11 — emotion response to death. Higher score = more
        // disappointment (player was invested). Always a surprise spike.
        try {
          feel('surprise', 0.20);
          feel('sadness',  0.05 + Math.min(0.15, score * 0.004));
        } catch(_){}
      }

      function showDeathOptions() {
        const isNewBest = score > best;
        if (isNewBest) {
          best = score;
          setBest('flappy', best);
          // Confetti for new best
          for (let k = 0; k < 50; k++) {
            juice.burst(W / 2 + (Math.random() - 0.5) * W * 0.6, H * 0.3 + (Math.random() - 0.5) * 40, 1, {
              colors: ['#ffd870', '#c896f5', '#5fff8a', '#ff8855'],
              speed: 5.5, gravity: 0.05,
            });
          }
          juice.flyScore('NEW BEST!', W / 2, H * 0.28, '#ffd870');
        }
        const medal = flappyMedalFor(score);
        hint.innerHTML = `Score: <b>${score}</b> · Best: <b>${best}</b>` +
          (medal ? ` · <span style="color:${medal.color};">${medal.label}</span>` : '');
        const btnRow = ov.querySelector('.clippy-game-buttons');
        btnRow.innerHTML = `
          <button class="clippy-game-btn" data-act="retry">↺ Retry</button>
          <button class="clippy-game-btn is-ghost" data-act="finish">Finish</button>`;
        btnRow.querySelector('[data-act="retry"]').addEventListener('click', restart);
        btnRow.querySelector('[data-act="finish"]').addEventListener('click', () => {
          loop.stop();
          // v18.33 — pass THIS run's score (was `best`, so the result
          // screen always showed your best and never your actual run).
          showGameResult('flappy', score);
        });
      }

      // ─── Render ─────────────────────────────────────────────────
      function render() {
        ctx.save();
        juice.applyShake(ctx);

        const sky = skyColors(score);
        const skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
        skyGrad.addColorStop(0,   sky[0]);
        skyGrad.addColorStop(0.55, sky[1]);
        skyGrad.addColorStop(1,   sky[2]);
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, GROUND_Y);

        // Night stars
        if (score >= 30) {
          const alpha = Math.min(1, (score - 30) / 10);
          for (const s of nightStars) {
            const tw = 0.7 + Math.sin(t * 0.03 + s.p) * 0.3;
            ctx.fillStyle = 'rgba(255,255,240,' + (alpha * tw).toFixed(2) + ')';
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
          }
        }

        // Mountains
        ctx.fillStyle = score >= 30 ? 'rgba(20,18,40,0.85)' : 'rgba(60,72,96,0.55)';
        for (const m of mountains) {
          const mx = ((m.x - groundOff * 0.05) % (W + 200) + W + 200) % (W + 200) - 100;
          ctx.beginPath();
          ctx.moveTo(mx, GROUND_Y);
          ctx.lineTo(mx + m.w / 2, GROUND_Y - m.h);
          ctx.lineTo(mx + m.w, GROUND_Y);
          ctx.closePath();
          ctx.fill();
        }

        ctx.fillStyle = 'rgba(255,255,255,0.40)';
        for (const c of farClouds) drawCloud(c.x, c.y, c.r);
        ctx.fillStyle = 'rgba(255,255,255,0.62)';
        for (const c of nearClouds) drawCloud(c.x, c.y, c.r);

        // Columns
        for (const c of columns) {
          drawColumn(c.x, 0, c.gapY, true);
          drawColumn(c.x, c.gapY + c.gap, GROUND_Y - (c.gapY + c.gap), false);
        }
        // Bonus stars
        for (const s of bonusStars) {
          if (s.taken) continue;
          const col = columns.find(c => c.idx === s.colIdx);
          if (!col) continue;
          drawBonusStar(col.x + PILLAR_W / 2, col.gapY + col.gap / 2, 11, t * 0.02 + s.phase);
        }
        // Ground
        ctx.fillStyle = '#4a6033';
        ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
        ctx.fillStyle = '#3a5028';
        for (let x = -groundOff; x < W; x += 24) ctx.fillRect(x, GROUND_Y, 12, H - GROUND_Y);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y); ctx.stroke();

        // Trail
        for (const p of trail) {
          const a = p.life / p.maxLife;
          ctx.fillStyle = 'rgba(212,164,78,' + (a * 0.65).toFixed(2) + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }

        // Flap puff
        if (flapPulse > 0.05) {
          const fr = BIRD_VR * (1.6 + (1 - flapPulse) * 1.2);
          const g = ctx.createRadialGradient(BIRD_X - 4, birdY + 6, BIRD_VR * 0.5, BIRD_X - 4, birdY + 6, fr);
          g.addColorStop(0, 'rgba(255,238,180,' + (0.55 * flapPulse).toFixed(2) + ')');
          g.addColorStop(1, 'rgba(255,238,180,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(BIRD_X - 4, birdY + 6, fr, 0, Math.PI * 2); ctx.fill();
        }

        // Trajan
        const faceState = !alive ? 'dead' : flapPulse > 0.3 ? 'flap' : birdV > 2 ? 'fall' : 'happy';
        ctx.save();
        ctx.translate(BIRD_X, birdY);
        ctx.rotate(birdRot);
        drawTrajanOrb(ctx, 0, 0, BIRD_VR, { face: faceState });
        if (flapPulse > 0.15) {
          const wingY = -BIRD_VR * 0.15;
          ctx.strokeStyle = 'rgba(255, 244, 208, 0.85)';
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-BIRD_VR * 0.4, wingY);
          ctx.quadraticCurveTo(-BIRD_VR * 1.1, wingY - BIRD_VR * 0.6 * flapPulse, -BIRD_VR * 1.4, wingY - BIRD_VR * 0.2);
          ctx.moveTo(BIRD_VR * 0.4, wingY);
          ctx.quadraticCurveTo(BIRD_VR * 1.1, wingY - BIRD_VR * 0.6 * flapPulse, BIRD_VR * 1.4, wingY - BIRD_VR * 0.2);
          ctx.stroke();
        }
        ctx.restore();

        // Near-miss ring
        if (nearMissPulse > 0.05) {
          ctx.strokeStyle = 'rgba(255,180,90,' + (nearMissPulse * 0.7).toFixed(2) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(BIRD_X, birdY, BIRD_VR + 4 + (1 - nearMissPulse) * 8, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Juice particles (in world space, so under shake)
        juice.drawParticles(ctx);

        ctx.restore();   // end shake

        // ─── HUD (no shake) ───────────────────────────────────────
        // Score in the middle
        ctx.font = '900 42px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 5;
        ctx.fillStyle = '#fffef6';
        ctx.strokeText(String(score), W / 2, 52);
        ctx.fillText(String(score), W / 2, 52);
        if (combo >= 2) {
          ctx.font = '700 14px JetBrains Mono, monospace';
          ctx.fillStyle = '#ffd870';
          ctx.fillText('×' + combo, W / 2, 72);
        }
        // Best score top-right
        ctx.font = '700 11px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,254,246,0.65)';
        ctx.fillText('BEST  ' + best, W - 8, 22);

        // Combo flash banner
        if (comboFlash > 0.05) {
          ctx.font = '900 28px Outfit, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255,216,112,' + comboFlash.toFixed(2) + ')';
          ctx.strokeStyle = 'rgba(26,26,26,' + comboFlash.toFixed(2) + ')';
          ctx.lineWidth = 4;
          ctx.strokeText(comboFlashLabel, W / 2, H * 0.32);
          ctx.fillText(comboFlashLabel, W / 2, H * 0.32);
        }

        // Tap-to-start
        if (!started && alive) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(0, H / 2 - 30, W, 60);
          ctx.fillStyle = '#fffef6';
          ctx.font = '700 18px Outfit, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('TAP TO START', W / 2, H / 2 + 6);
        }

        // Game over panel — medal + score
        if (!alive && isRetryShown) {
          const medal = flappyMedalFor(score);
          const panelW = 240, panelH = medal ? 160 : 130;
          const px = W / 2 - panelW / 2;
          const py = H / 2 - panelH / 2 - 20;
          ctx.fillStyle = 'rgba(20,18,30,0.92)';
          ctx.strokeStyle = '#d4a44e';
          ctx.lineWidth = 2;
          ctx.fillRect(px, py, panelW, panelH);
          ctx.strokeRect(px, py, panelW, panelH);
          ctx.textAlign = 'center';
          ctx.font = '900 22px Outfit, sans-serif';
          ctx.fillStyle = '#fffef6';
          ctx.fillText('GAME OVER', W / 2, py + 28);
          ctx.font = '700 14px JetBrains Mono, monospace';
          ctx.fillStyle = 'rgba(255,254,246,0.75)';
          ctx.fillText('Score', W / 2 - 60, py + 56);
          ctx.fillText('Best',  W / 2 + 60, py + 56);
          ctx.font = '900 24px JetBrains Mono, monospace';
          ctx.fillStyle = '#fffef6';
          ctx.fillText(String(score), W / 2 - 60, py + 80);
          ctx.fillText(String(best),  W / 2 + 60, py + 80);
          if (medal) {
            // Brass medal disc
            const cx = W / 2, cy = py + 124, r = 16;
            const mgrad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
            mgrad.addColorStop(0, '#ffffff');
            mgrad.addColorStop(0.4, medal.color);
            mgrad.addColorStop(1, medal.edge);
            ctx.fillStyle = mgrad;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = medal.edge;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.font = '700 11px Outfit, sans-serif';
            ctx.fillStyle = medal.edge;
            ctx.textAlign = 'left';
            ctx.fillText(medal.label.toUpperCase(), cx + r + 8, cy + 4);
          }
        }

        // Juice overlay (flyers + flash) — drawn last, no shake
        juice.drawOverlay(ctx);
      }

      function drawCloud(x, y, r) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.arc(x + r * 0.7, y + 2, r * 0.8, 0, Math.PI * 2);
        ctx.arc(x - r * 0.7, y + 2, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      function drawColumn(x, y, h, isTop) {
        if (h <= 0) return;
        const grad = ctx.createLinearGradient(x, 0, x + PILLAR_W, 0);
        grad.addColorStop(0,   '#8b6f3d');
        grad.addColorStop(0.5, '#c9a063');
        grad.addColorStop(1,   '#8b6f3d');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, PILLAR_W, h);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, PILLAR_W, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 5; i++) {
          const fx = x + (PILLAR_W / 5) * i;
          ctx.beginPath(); ctx.moveTo(fx, y); ctx.lineTo(fx, y + h); ctx.stroke();
        }
        ctx.fillStyle = '#6b4a1f';
        const capY = isTop ? y + h - 14 : y;
        ctx.fillRect(x - 4, capY, PILLAR_W + 8, 14);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 4, capY, PILLAR_W + 8, 14);
      }
      function drawBonusStar(x, y, r, phase) {
        const wob = Math.sin(phase) * 1.5;
        ctx.save();
        ctx.translate(x, y + wob);
        ctx.rotate(Math.sin(phase * 0.5) * 0.15);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.5);
        g.addColorStop(0, 'rgba(255,238,180,0.65)');
        g.addColorStop(1, 'rgba(255,238,180,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r * 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (Math.PI / 5) * i - Math.PI / 2;
          const rr = i % 2 === 0 ? r : r * 0.45;
          const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = '#ffd870';
        ctx.fill();
        ctx.strokeStyle = '#8c6418';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }

      render();
      // v18.33 — sub-step physics when a frame hitches (dt can reach 2):
      // at top speed a 2-frame step moved bird+columns ~19px against a
      // per-step collision test, letting the bird tunnel through pillars
      // or die unfairly. Two half-steps keep every test under ~10px.
      const loop = gameLoop((dt) => {
        if (dt > 1.15) { update(dt / 2); update(dt / 2); }
        else update(dt);
        render();
      });
      runCountdown(board.wrap, () => loop.start());
    });
  }

  // ════════════════════════════════════════════════════════════════
  // GAME 6: CANNON BATTLE — per-enemy fire cooldown, bullet cap, power-ups
  // ════════════════════════════════════════════════════════════════
  function startCannonGame() {
    const ov = createGameOverlay();
    const intro = pickFromPool('game_intro_cannon');
    ov.innerHTML = `
      <div class="clippy-game-title">🚀 Cannon Battle</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">🚀 CANNON BATTLE</div>
        <div class="clippy-canvas-wrap" data-wrap></div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;">Drag to move · Tap to fire · Catch power-ups</div>
        <div class="clippy-game-buttons"><button class="clippy-game-btn is-ghost" data-act="quit">Quit</button></div>`;
      const wrap = ov.querySelector('[data-wrap]');
      const board = makeCanvasBoard(wrap, { bg: 'linear-gradient(180deg, #06081a 0%, #0d1330 60%, #1a2548 100%)' });
      const { ctx, w: W, h: H } = board;
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => { loop.stop(); closeGameOverlay(); });

      const PLAYER_W = 60, PLAYER_R = 22;
      let playerX = W / 2 - PLAYER_W / 2;
      let score = 0, hp = 3, timeLeft = 90;
      let best = getBest('cannon');
      const bullets = [], enemies = [], enemyBullets = [], powerups = [], explosions = [];
      const stars = [];
      for (let i = 0; i < 32; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.4, a: 0.4 + Math.random() * 0.5 });
      let lastEnemySpawn = 0, lastFire = 0, t = 0;
      let powerTriple = 0, powerRapid = 0;
      let bossAt = 30 * 60;
      let dragActive = false;
      let kills = 0;
      const juice = makeJuice(W, H);

      const MAX_BULLETS = 12;
      function fire() {
        if (bullets.length >= MAX_BULLETS) return;
        const cooldown = powerRapid > 0 ? 100 : 220;
        const now = Date.now();
        if (now - lastFire < cooldown) return;
        lastFire = now;
        const bx = playerX + PLAYER_W / 2 - 3;
        const by = H - 80;
        if (powerTriple > 0) {
          bullets.push({ x: bx, y: by, vx: -2 });
          bullets.push({ x: bx, y: by, vx: 0 });
          bullets.push({ x: bx, y: by, vx: 2 });
        } else {
          bullets.push({ x: bx, y: by, vx: 0 });
        }
        playTone('boop');
      }
      function spawnEnemy(isBoss) {
        const ex = Math.random() * (W - 36);
        enemies.push({
          x: ex, y: 20, vx: (Math.random() - 0.5) * 1.4, vy: 0.4 + Math.random() * 0.5,
          hp: isBoss ? 5 : 1, lastShot: Date.now() + Math.random() * 1200,
          shotInterval: isBoss ? 800 : 1500 + Math.random() * 800,
          isBoss: !!isBoss, w: isBoss ? 56 : 36, h: isBoss ? 56 : 36,
        });
      }
      function spawnPowerup(x, y) {
        if (Math.random() > 0.18) return;
        const kinds = ['triple', 'rapid', 'hp'];
        powerups.push({ x, y, kind: kinds[Math.floor(Math.random() * kinds.length)], vy: 1.4 });
      }

      function setPlayerFromPoint(clientX) {
        const rect = board.wrap.getBoundingClientRect();
        playerX = Math.max(0, Math.min(W - PLAYER_W, clientX - rect.left - PLAYER_W / 2));
      }
      board.wrap.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length) { dragActive = true; setPlayerFromPoint(e.touches[0].clientX); fire(); }
      }, { passive: false });
      board.wrap.addEventListener('touchmove', (e) => { if (dragActive && e.touches.length) setPlayerFromPoint(e.touches[0].clientX); }, { passive: false });
      board.wrap.addEventListener('touchend', () => { dragActive = false; });
      board.wrap.addEventListener('mousedown', (e) => { dragActive = true; setPlayerFromPoint(e.clientX); fire(); });
      board.wrap.addEventListener('mousemove', (e) => { if (dragActive) setPlayerFromPoint(e.clientX); });
      board.wrap.addEventListener('mouseup', () => { dragActive = false; });
      board.wrap.addEventListener('mouseleave', () => { dragActive = false; });

      let timerInt = null;
      function update(dt) {
        if (juice.update(dt)) return;   // hitstop pauses game
        t += dt;
        if (powerTriple > 0) powerTriple = Math.max(0, powerTriple - dt);
        if (powerRapid  > 0) powerRapid  = Math.max(0, powerRapid  - dt);
        const now = Date.now();

        // Bullets
        for (let i = bullets.length - 1; i >= 0; i--) {
          const b = bullets[i];
          b.y -= 9 * dt; b.x += (b.vx || 0) * dt;
          if (b.y < -20 || b.x < -10 || b.x > W + 10) { bullets.splice(i, 1); continue; }
          let hit = false;
          for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (b.x + 6 > e.x && b.x < e.x + e.w && b.y + 16 > e.y && b.y < e.y + e.h) {
              e.hp--;
              if (e.hp <= 0) {
                const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
                explosions.push({ x: ex, y: ey, life: 24, max: 24 });
                spawnPowerup(ex, ey);
                const pts = e.isBoss ? 50 : 10;
                score += pts;
                kills++;
                enemies.splice(j, 1);
                // JUICE: shake proportional to kill size, score flyer, particle burst
                juice.shake(e.isBoss ? 14 : 5);
                juice.flyScore('+' + pts, ex, ey, e.isBoss ? '#ffd870' : '#fffef6');
                juice.burst(ex, ey, e.isBoss ? 28 : 14, {
                  colors: ['#ffd870', '#ff8855', '#fff4c8'],
                  speed: e.isBoss ? 5 : 3.5,
                  gravity: 0.05,
                });
                if (e.isBoss) {
                  juice.hitstop(4);
                  juice.flash('#ffd870', 0.35, 8);
                  playPitch(660, 0.14, 'triangle');
                  setTimeout(() => playPitch(880, 0.16, 'triangle'), 90);
                } else {
                  playPitch(540 + Math.min(440, kills * 6), 0.08, 'triangle');
                }
              } else {
                // Hit but not killed — small shake + flash
                juice.shake(2);
                juice.burst(b.x + 3, b.y, 4, { colors: ['#ff8855'], speed: 1.5 });
              }
              bullets.splice(i, 1);
              hit = true;
              break;
            }
          }
          if (hit) continue;
        }
        // Spawn regular enemies (rate scales gently with score)
        const spawnEvery = Math.max(700, 1500 - Math.min(800, score * 4));
        if (now - lastEnemySpawn > spawnEvery) { spawnEnemy(false); lastEnemySpawn = now; }
        // Spawn boss
        if (t > bossAt) { spawnEnemy(true); bossAt = t + 30 * 60; }
        // Enemy motion + shooting
        for (let i = enemies.length - 1; i >= 0; i--) {
          const e = enemies[i];
          e.x += e.vx * dt; e.y += e.vy * dt;
          if (e.x < 0 || e.x > W - e.w) e.vx *= -1;
          if (now - e.lastShot > e.shotInterval) {
            enemyBullets.push({ x: e.x + e.w / 2 - 2, y: e.y + e.h });
            e.lastShot = now;
          }
          if (e.y > H - 80) {
            enemies.splice(i, 1);
            hp--;
            // Enemy broke through — bigger shake
            juice.shake(10);
            juice.flash('#c83a3a', 0.4, 8);
            juice.burst(e.x + e.w / 2, H - 70, 12, { colors: ['#c83a3a', '#ff8855'], speed: 4 });
            playPitch(180, 0.18, 'sawtooth');
            if (hp <= 0) return gameOver(false);
          }
        }
        // Enemy bullets
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
          const b = enemyBullets[i];
          b.y += 6 * dt;
          if (b.y > H) { enemyBullets.splice(i, 1); continue; }
          if (b.x + 5 > playerX && b.x < playerX + PLAYER_W && b.y + 14 > H - 80 && b.y < H - 20) {
            enemyBullets.splice(i, 1);
            hp--;
            explosions.push({ x: playerX + PLAYER_W / 2, y: H - 50, life: 20, max: 20 });
            // Player hit — heavy juice
            juice.shake(12);
            juice.hitstop(3);
            juice.flash('#c83a3a', 0.45, 10);
            juice.burst(playerX + PLAYER_W / 2, H - 50, 16, {
              colors: ['#c83a3a', '#ff8855', '#fff4c8'], speed: 4, gravity: 0.1,
            });
            playPitch(140, 0.20, 'sawtooth');
            if (hp <= 0) return gameOver(false);
          }
        }
        // Powerups
        for (let i = powerups.length - 1; i >= 0; i--) {
          const p = powerups[i];
          p.y += p.vy * dt;
          if (p.y > H) { powerups.splice(i, 1); continue; }
          if (p.x > playerX && p.x < playerX + PLAYER_W && p.y > H - 80) {
            if (p.kind === 'triple')  powerTriple = 60 * 8;
            else if (p.kind === 'rapid') powerRapid = 60 * 6;
            else if (p.kind === 'hp')    hp = Math.min(hp + 1, 5);
            powerups.splice(i, 1);
            // POWERUP JUICE
            juice.flash(p.kind === 'hp' ? '#5fff8a' : p.kind === 'rapid' ? '#7df0ff' : '#ff8855', 0.35, 8);
            juice.flyScore(p.kind === 'hp' ? '+HP' : p.kind === 'rapid' ? 'RAPID' : 'TRIPLE',
                           p.x, p.y, p.kind === 'hp' ? '#5fff8a' : p.kind === 'rapid' ? '#7df0ff' : '#ff8855');
            juice.burst(p.x, p.y, 12, { colors: ['#fff4c8', '#ffd870'], speed: 3, gravity: -0.05 });
            playPitch(700, 0.12, 'triangle');
            setTimeout(() => playPitch(1050, 0.16, 'triangle'), 80);
          }
        }
        // Explosions
        for (let i = explosions.length - 1; i >= 0; i--) {
          explosions[i].life -= dt;
          if (explosions[i].life <= 0) explosions.splice(i, 1);
        }
      }

      function render() {
        ctx.clearRect(0, 0, W, H);
        // ─── Shake-wrapped world ────────────────────────────────────
        ctx.save();
        juice.applyShake(ctx);

        // Stars
        for (const s of stars) {
          ctx.globalAlpha = s.a;
          ctx.fillStyle = '#fffef6';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // Bullets (player) — bigger, with motion trail
        for (const b of bullets) {
          // Trail
          const tgrad = ctx.createLinearGradient(b.x + 4, b.y, b.x + 4, b.y + 32);
          tgrad.addColorStop(0,   'rgba(255,216,112,0.85)');
          tgrad.addColorStop(1,   'rgba(255,216,112,0)');
          ctx.fillStyle = tgrad;
          ctx.fillRect(b.x + 1, b.y, 6, 32);
          // Core bullet
          ctx.fillStyle = '#fffef6';
          ctx.fillRect(b.x, b.y, 8, 20);
          ctx.fillStyle = '#ffd870';
          ctx.fillRect(b.x + 1, b.y + 2, 6, 16);
        }
        // Enemy bullets — slightly bigger with red core
        for (const b of enemyBullets) {
          ctx.fillStyle = '#ff8888';
          ctx.fillRect(b.x - 1, b.y, 8, 18);
          ctx.fillStyle = '#ff3344';
          ctx.fillRect(b.x, b.y + 2, 6, 14);
        }
        // Enemies — silver Trajans with crimson sash
        for (const e of enemies) {
          drawTrajanOrb(ctx, e.x + e.w / 2, e.y + e.h / 2, e.w / 2, { hue: 'silver' });
          ctx.fillStyle = '#c62a4a';
          ctx.fillRect(e.x + 6, e.y + e.h / 2 - 2, e.w - 12, 4);
          if (e.isBoss) {
            const pipW = (e.w - 8) / 5;
            for (let i = 0; i < 5; i++) {
              ctx.fillStyle = i < e.hp ? '#5fff8a' : '#444';
              ctx.fillRect(e.x + 4 + i * pipW, e.y - 8, pipW - 2, 4);
            }
          }
        }
        // Powerups
        for (const p of powerups) {
          ctx.fillStyle = p.kind === 'triple' ? '#ff8855' : p.kind === 'rapid' ? '#7df0ff' : '#ff5577';
          ctx.fillRect(p.x - 10, p.y - 10, 20, 20);
          ctx.fillStyle = '#1a1a1a';
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.kind === 'triple' ? '3' : p.kind === 'rapid' ? '⚡' : '+', p.x, p.y + 5);
        }
        // Player
        drawTrajanOrb(ctx, playerX + PLAYER_W / 2, H - 50, PLAYER_R);
        // Old-style explosions (kept for variety)
        for (const x of explosions) {
          const k = 1 - x.life / x.max;
          ctx.globalAlpha = 1 - k;
          const r = 8 + k * 30;
          const grad = ctx.createRadialGradient(x.x, x.y, 0, x.x, x.y, r);
          grad.addColorStop(0, '#ffd870');
          grad.addColorStop(0.5, '#ff5577');
          grad.addColorStop(1, 'rgba(255,85,119,0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(x.x, x.y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // Juice particles in world space
        juice.drawParticles(ctx);

        ctx.restore();   // end shake

        // ─── HUD (no shake) ─────────────────────────────────────────
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(8, 8, W - 16, 26);
        ctx.strokeStyle = '#d4a44e';
        ctx.lineWidth = 1;
        ctx.strokeRect(8, 8, W - 16, 26);
        ctx.fillStyle = '#fffef6';
        ctx.font = '700 14px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('SCORE ' + score, 16, 26);
        ctx.textAlign = 'center';
        // HP as heart pips for clarity
        const heartChars = '♥'.repeat(Math.max(0, hp)) + '·'.repeat(Math.max(0, 3 - hp));
        ctx.fillStyle = hp <= 1 ? '#ff5577' : '#fffef6';
        ctx.fillText(heartChars, W / 2, 26);
        ctx.fillStyle = '#fffef6';
        ctx.textAlign = 'right';
        ctx.fillText(Math.ceil(timeLeft) + 's', W - 16, 26);
        // Best score line
        ctx.font = '700 10px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(255,254,246,0.55)';
        ctx.textAlign = 'right';
        ctx.fillText('BEST ' + best, W - 16, 46);
        // Power-up badges
        if (powerTriple > 0 || powerRapid > 0) {
          ctx.textAlign = 'left';
          ctx.fillStyle = '#7df0ff';
          ctx.font = '700 12px JetBrains Mono, monospace';
          let bx = 16, by = 50;
          if (powerTriple > 0) { ctx.fillText('3× ' + Math.ceil(powerTriple / 60) + 's', bx, by); bx += 70; }
          if (powerRapid  > 0) { ctx.fillText('⚡ ' + Math.ceil(powerRapid  / 60) + 's', bx, by); }
        }

        // Juice overlay (flyers + flash) on top, unaffected by shake
        juice.drawOverlay(ctx);
      }

      function gameOver(survived) {
        loop.stop();
        clearInterval(timerInt);
        if (score > best) { best = score; setBest('cannon', best); }
        if (!survived) bubble(pickFromPool('cannon_die'), { autoHide: 2500 });
        setTimeout(() => showGameResult('cannon', score, {
          stats: [{ label: 'Time', value: (90 - Math.ceil(timeLeft)) + 's' }],
        }), 700);
      }

      render(); // v18.2: paint initial frame so countdown sits over the populated scene
      const loop = gameLoop((dt) => { update(dt); render(); });
      runCountdown(board.wrap, () => {
        loop.start();
        timerInt = setInterval(() => {
          if (!loop.running || document.hidden) return;
          timeLeft--;
          if (timeLeft <= 0) gameOver(true);
        }, 1000);
        state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => clearInterval(timerInt)]);
      });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // GAME 7: SNAKE — canvas, dt-driven, real speed-up, bonus food
  // ════════════════════════════════════════════════════════════════
  function startSnakeGame() {
    const ov = createGameOverlay();
    const intro = pickFromPool('game_intro_snake');
    ov.innerHTML = `
      <div class="clippy-game-title">🐍 Snake</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">🐍 SNAKE — Length: <span data-score>3</span></div>
        <div class="clippy-canvas-wrap" data-wrap></div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;">Tap any side to turn ⇦⇧⇨⇩  ·  gold food = +3</div>
        <div class="clippy-game-buttons"><button class="clippy-game-btn is-ghost" data-act="quit">Quit</button></div>`;
      const wrap = ov.querySelector('[data-wrap]');
      const side = Math.min(400, Math.floor(window.innerWidth * 0.9));
      const board = makeCanvasBoard(wrap, { w: side, h: side, bg: '#0d1330' });
      const { ctx, w: W, h: H } = board;
      const scoreEl = ov.querySelector('[data-score]');
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => { loop.stop(); closeGameOverlay(); });

      const CELL = 20;
      const COLS = Math.floor(W / CELL);
      const ROWS = Math.floor(H / CELL);
      const snake = [
        { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) },
        { x: Math.floor(COLS / 2) - 1, y: Math.floor(ROWS / 2) },
        { x: Math.floor(COLS / 2) - 2, y: Math.floor(ROWS / 2) },
      ];
      let dir = { x: 1, y: 0 };
      let nextDir = dir;
      let food = spawnFood(false);
      let goldFoodEvery = 5;
      let eatenSinceGold = 0;
      let stepMs = 140;
      let timeToNext = stepMs;
      let best = getBest('snake');
      const juice = makeJuice(W, H);

      function spawnFood(gold) {
        // Capped retries — an (unreachably good) snake filling the board
        // would otherwise spin this loop forever and hang the tab.
        let f, tries = 0;
        do { f = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS), gold: !!gold }; }
        while (snake.some(s => s.x === f.x && s.y === f.y) && ++tries < 400);
        return f;
      }
      function handleTap(clientX, clientY) {
        const rect = board.wrap.getBoundingClientRect();
        const x = clientX - rect.left, y = clientY - rect.top;
        const head = snake[0];
        const hx = head.x * CELL + CELL / 2;
        const hy = head.y * CELL + CELL / 2;
        const dx = x - hx, dy = y - hy;
        if (Math.abs(dx) > Math.abs(dy)) nextDir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
        else nextDir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
        if (snake.length > 1 && nextDir.x === -dir.x && nextDir.y === -dir.y) nextDir = dir;
      }
      board.wrap.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length) handleTap(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });
      board.wrap.addEventListener('click', (e) => handleTap(e.clientX, e.clientY));

      function update(dt) {
        if (juice.update(dt)) return;
        timeToNext -= dt * 16.67;     // dt is in frames @ 60fps; convert back to ms
        if (timeToNext > 0) return;
        timeToNext += stepMs;
        dir = nextDir;
        const head = snake[0];
        const newHead = { x: head.x + dir.x, y: head.y + dir.y };
        if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) return die();
        if (snake.some(s => s.x === newHead.x && s.y === newHead.y)) return die();
        snake.unshift(newHead);
        if (newHead.x === food.x && newHead.y === food.y) {
          const fx = food.x * CELL + CELL / 2;
          const fy = food.y * CELL + CELL / 2;
          if (food.gold) {
            // +3 length: skip pop twice more
            snake.push({ ...snake[snake.length - 1] });
            snake.push({ ...snake[snake.length - 1] });
            juice.flyScore('+3', fx, fy, '#ffd870');
            juice.burst(fx, fy, 18, { colors: ['#ffd870', '#fff4c8', '#ffffff'], speed: 3.5 });
            juice.flash('#fff4c8', 0.22, 6);
            playPitch(880, 0.14, 'triangle');
            setTimeout(() => playPitch(1320, 0.12, 'triangle'), 70);
            eatenSinceGold = 0;
          } else {
            juice.flyScore('+1', fx, fy, '#fffef6');
            juice.burst(fx, fy, 8, { colors: ['#ffd870', '#fff4c8'], speed: 2.5 });
            const pitch = 440 + Math.min(440, snake.length * 8);
            playPitch(pitch, 0.08, 'triangle');
            eatenSinceGold++;
          }
          food = spawnFood(eatenSinceGold >= goldFoodEvery);
          if (food.gold) eatenSinceGold = 0;
          scoreEl.textContent = snake.length;
          // Real speed-up
          if (snake.length % 5 === 0 && stepMs > 70) stepMs = Math.max(70, stepMs - 8);
        } else {
          snake.pop();
        }
      }
      function die() {
        loop.stop();
        // Death: shake + flash + burst at head
        const head = snake[0];
        const hx = head.x * CELL + CELL / 2;
        const hy = head.y * CELL + CELL / 2;
        juice.shake(16);
        juice.hitstop(4);
        juice.flash('#c83a3a', 0.45, 10);
        juice.burst(hx, hy, 24, { colors: ['#4cb6ff', '#fffef6', '#ff8855'], speed: 4.5 });
        playPitch(160, 0.20, 'sawtooth');
        if (snake.length > best) { best = snake.length; setBest('snake', best); }
        bubble(pickFromPool('snake_die'), { autoHide: 2500 });
        setTimeout(() => showGameResult('snake', snake.length, {
          stats: [{ label: 'Speed', value: (140 - stepMs) + ' ms faster' }],
        }), 700);
      }
      function render() {
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        juice.applyShake(ctx);
        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= COLS; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke(); }
        for (let i = 0; i <= ROWS; i++) { ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke(); }
        // Food
        const fx = food.x * CELL + CELL / 2;
        const fy = food.y * CELL + CELL / 2;
        drawTrajanOrb(ctx, fx, fy, 8, { hue: 'gold' });
        if (food.gold) {
          // pulsing ring
          ctx.strokeStyle = 'rgba(255, 216, 112, 0.7)';
          ctx.lineWidth = 2;
          const pulse = 10 + Math.sin(Date.now() / 150) * 3;
          ctx.beginPath(); ctx.arc(fx, fy, pulse, 0, Math.PI * 2); ctx.stroke();
        }
        // Snake — head is full Trajan, body fades toward tail
        for (let i = snake.length - 1; i >= 0; i--) {
          const seg = snake[i];
          const sx = seg.x * CELL + CELL / 2;
          const sy = seg.y * CELL + CELL / 2;
          if (i === 0) {
            drawTrajanOrb(ctx, sx, sy, 10);
          } else {
            const tt = i / snake.length;
            ctx.fillStyle = '#4cb6ff';
            ctx.beginPath(); ctx.arc(sx, sy, 8 - tt * 2, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#1a1a1a';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
        // Juice particles inside shake
        juice.drawParticles(ctx);
        ctx.restore();
        // HUD: best score (no shake)
        ctx.font = '700 10px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(255,254,246,0.55)';
        ctx.textAlign = 'right';
        ctx.fillText('BEST ' + best, W - 8, H - 8);
        // Juice overlay
        juice.drawOverlay(ctx);
      }

      render(); // v18.2: paint initial frame so countdown sits over the populated scene
      const loop = gameLoop((dt) => { update(dt); render(); });
      runCountdown(board.wrap, () => loop.start());
    });
  }

  // ════════════════════════════════════════════════════════════════
  // GAME 8: ORB BREAKER — breakout w/ Roman-pillar bricks, power-ups
  // ════════════════════════════════════════════════════════════════
  function startBreakerGame() {
    const ov = createGameOverlay();
    const intro = pickFromPool('game_intro_breaker');
    ov.innerHTML = `
      <div class="clippy-game-title">🧱 Orb Breaker</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">🧱 ORB BREAKER</div>
        <div class="clippy-canvas-wrap" data-wrap></div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;">Drag the paddle. Don't drop the orb.</div>
        <div class="clippy-game-buttons"><button class="clippy-game-btn is-ghost" data-act="quit">Quit</button></div>`;
      const wrap = ov.querySelector('[data-wrap]');
      const board = makeCanvasBoard(wrap, { bg: 'linear-gradient(180deg, #1a1330 0%, #0d0d24 100%)' });
      const { ctx, w: W, h: H } = board;
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => { loop.stop(); closeGameOverlay(); });

      let paddleW = 90;
      const paddleH = 12;
      let paddleX = W / 2 - paddleW / 2;
      const paddleY = H - 36;
      const balls = [{ x: W / 2, y: paddleY - 14, vx: 2.4, vy: -3.4, r: 7 }];
      const bricks = [];
      const COLS = 7, ROWS = 5, BPAD = 4;
      const TOP = 40;
      const BW = (W - BPAD * 2 - (COLS - 1) * 4) / COLS;
      const BH = 18;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          bricks.push({
            x: BPAD + c * (BW + 4),
            y: TOP + r * (BH + 4),
            w: BW, h: BH,
            hp: r < 1 ? 2 : 1,
            isPower: Math.random() < 0.1,
            alive: true,
          });
        }
      }
      const powerups = [];
      let score = 0, lives = 3, started = false;
      let best = getBest('breaker');
      let stickyTimer = 0;
      let dragActive = false;
      let paddleSquish = 0;   // 0..1 — squashes briefly on ball hit
      const juice = makeJuice(W, H);

      function setPaddleFromPoint(clientX) {
        const rect = board.wrap.getBoundingClientRect();
        paddleX = Math.max(0, Math.min(W - paddleW, clientX - rect.left - paddleW / 2));
      }
      board.wrap.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length) { dragActive = true; setPaddleFromPoint(e.touches[0].clientX); started = true; }
      }, { passive: false });
      board.wrap.addEventListener('touchmove', (e) => { if (dragActive && e.touches.length) setPaddleFromPoint(e.touches[0].clientX); }, { passive: false });
      board.wrap.addEventListener('touchend', () => { dragActive = false; });
      board.wrap.addEventListener('mousedown', (e) => { dragActive = true; setPaddleFromPoint(e.clientX); started = true; });
      board.wrap.addEventListener('mousemove', (e) => { if (dragActive) setPaddleFromPoint(e.clientX); });
      board.wrap.addEventListener('mouseup', () => { dragActive = false; });
      board.wrap.addEventListener('mouseleave', () => { dragActive = false; });

      function update(dt) {
        if (juice.update(dt)) return;
        if (paddleSquish > 0) paddleSquish = Math.max(0, paddleSquish - 0.07 * dt);
        if (!started) return;
        if (stickyTimer > 0) stickyTimer = Math.max(0, stickyTimer - dt);
        for (let bi = balls.length - 1; bi >= 0; bi--) {
          const b = balls[bi];
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.x - b.r < 0) { b.x = b.r; b.vx *= -1; juice.shake(2); }
          if (b.x + b.r > W) { b.x = W - b.r; b.vx *= -1; juice.shake(2); }
          if (b.y - b.r < 0) { b.y = b.r; b.vy *= -1; juice.shake(2); }
          // Paddle collision
          if (b.y + b.r > paddleY && b.y + b.r < paddleY + paddleH + 6 && b.x > paddleX - b.r && b.x < paddleX + paddleW + b.r && b.vy > 0) {
            b.y = paddleY - b.r;
            const offset = (b.x - (paddleX + paddleW / 2)) / (paddleW / 2);
            const ang = offset * 1.0;
            const sp = Math.hypot(b.vx, b.vy);
            b.vx = Math.sin(ang) * sp;
            b.vy = -Math.abs(Math.cos(ang) * sp);
            paddleSquish = 1;
            playPitch(440 + Math.abs(offset) * 220, 0.06, 'triangle');
            juice.burst(b.x, paddleY, 3, { colors: ['#7df0ff'], speed: 2 });
          }
          // Below paddle
          if (b.y - b.r > H) {
            balls.splice(bi, 1);
            if (balls.length === 0) {
              lives--;
              juice.shake(10);
              juice.flash('#c83a3a', 0.30, 8);
              playPitch(180, 0.16, 'sawtooth');
              if (lives <= 0) return gameOver();
              balls.push({ x: W / 2, y: paddleY - 14, vx: 2.4, vy: -3.4, r: 7 });
              started = false;
            }
            continue;
          }
          // Brick collisions
          for (const br of bricks) {
            if (!br.alive) continue;
            if (b.x + b.r > br.x && b.x - b.r < br.x + br.w && b.y + b.r > br.y && b.y - b.r < br.y + br.h) {
              br.hp--;
              const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
              if (br.hp <= 0) {
                br.alive = false;
                score += 10;
                juice.flyScore('+10', cx, cy, '#fffef6');
                juice.burst(cx, cy, 14, {
                  colors: br.isPower ? ['#ff8855', '#ffd870', '#7df0ff'] : ['#c9a063', '#8b6f3d', '#fff4c8'],
                  speed: 3.5, gravity: 0.08,
                });
                juice.shake(3);
                if (br.isPower) {
                  const kinds = ['wide', 'multi', 'slow'];
                  powerups.push({ x: cx, y: cy, kind: kinds[Math.floor(Math.random() * kinds.length)], vy: 1.6 });
                }
                playPitch(660, 0.08, 'triangle');
              } else {
                juice.burst(cx, cy, 4, { colors: ['#c9a063'], speed: 1.5 });
                playPitch(440, 0.06, 'triangle');
              }
              // bounce
              const dx = (b.x - cx) / (br.w / 2);
              const dy = (b.y - cy) / (br.h / 2);
              if (Math.abs(dx) > Math.abs(dy)) b.vx *= -1;
              else b.vy *= -1;
              break;
            }
          }
        }
        // Powerups fall
        for (let i = powerups.length - 1; i >= 0; i--) {
          const p = powerups[i];
          p.y += p.vy * dt;
          if (p.y > H) { powerups.splice(i, 1); continue; }
          if (p.y > paddleY - 8 && p.y < paddleY + paddleH + 8 && p.x > paddleX && p.x < paddleX + paddleW) {
            if (p.kind === 'wide')  paddleW = Math.min(160, paddleW + 30);
            else if (p.kind === 'multi') {
              const newBalls = [];
              for (const b of balls) {
                const sp = Math.hypot(b.vx, b.vy);
                newBalls.push({ ...b, vx: b.vx * 0.7 + Math.cos(Math.PI / 4) * sp * 0.5, vy: -Math.abs(b.vy) });
                newBalls.push({ ...b, vx: b.vx * 0.7 - Math.cos(Math.PI / 4) * sp * 0.5, vy: -Math.abs(b.vy) });
              }
              for (const nb of newBalls) balls.push(nb);
            }
            else if (p.kind === 'slow') {
              for (const b of balls) { b.vx *= 0.7; b.vy *= 0.7; }
            }
            powerups.splice(i, 1);
            juice.flash(p.kind === 'multi' ? '#ff8855' : p.kind === 'wide' ? '#5fff8a' : '#7df0ff', 0.30, 8);
            juice.flyScore(p.kind.toUpperCase(), p.x, p.y, '#ffd870');
            juice.burst(p.x, p.y, 10, { colors: ['#ffd870', '#fff4c8'], speed: 3 });
            playPitch(700, 0.12, 'triangle');
          }
        }
        // Cleared all bricks?
        if (bricks.every(b => !b.alive)) {
          loop.stop();
          // CELEBRATION
          juice.flash('#ffd870', 0.45, 16);
          juice.shake(12);
          for (let k = 0; k < 40; k++) {
            juice.burst(Math.random() * W, Math.random() * H * 0.6, 1, {
              colors: ['#ffd870', '#fff4c8', '#7df0ff', '#ff8855'], speed: 5, gravity: 0.05,
            });
          }
          if (score + 100 > best) { best = score + 100; setBest('breaker', best); }
          setTimeout(() => showGameResult('breaker', score + 100, {
            stats: [{ label: 'Bonus', value: 'Cleared! +100' }, { label: 'Lives left', value: lives }],
          }), 800);
        }
      }

      function gameOver() {
        loop.stop();
        juice.shake(18); juice.flash('#c83a3a', 0.5, 14);
        if (score > best) { best = score; setBest('breaker', best); }
        bubble(pickFromPool('breaker_die'), { autoHide: 2500 });
        setTimeout(() => showGameResult('breaker', score, {
          stats: [{ label: 'Bricks broken', value: bricks.filter(b => !b.alive).length }],
        }), 700);
      }

      function render() {
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        juice.applyShake(ctx);
        // Bricks
        for (const br of bricks) {
          if (!br.alive) continue;
          const grad = ctx.createLinearGradient(br.x, br.y, br.x, br.y + br.h);
          if (br.isPower) {
            grad.addColorStop(0, '#7df0ff'); grad.addColorStop(1, '#2e8de0');
          } else if (br.hp === 2) {
            grad.addColorStop(0, '#a8b5c2'); grad.addColorStop(1, '#5a6873');
          } else {
            grad.addColorStop(0, '#e8c264'); grad.addColorStop(1, '#8b6f3d');
          }
          ctx.fillStyle = grad;
          ctx.fillRect(br.x, br.y, br.w, br.h);
          ctx.strokeStyle = '#1a1a1a';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(br.x, br.y, br.w, br.h);
          // pillar fluting
          ctx.strokeStyle = 'rgba(0,0,0,0.16)';
          ctx.lineWidth = 1;
          for (let i = 1; i < 4; i++) {
            const fx = br.x + (br.w / 4) * i;
            ctx.beginPath(); ctx.moveTo(fx, br.y + 2); ctx.lineTo(fx, br.y + br.h - 2); ctx.stroke();
          }
        }
        // Paddle — squashes on ball hit (squish decays per frame)
        ctx.save();
        const sx = 1 + paddleSquish * 0.18;
        const sy = 1 - paddleSquish * 0.28;
        const pcx = paddleX + paddleW / 2;
        const pcy = paddleY + paddleH / 2;
        ctx.translate(pcx, pcy);
        ctx.scale(sx, sy);
        ctx.translate(-pcx, -pcy);
        const pg = ctx.createLinearGradient(paddleX, paddleY, paddleX, paddleY + paddleH);
        pg.addColorStop(0, '#fffef6'); pg.addColorStop(1, '#a8b5c2');
        ctx.fillStyle = pg;
        ctx.fillRect(paddleX, paddleY, paddleW, paddleH);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.strokeRect(paddleX, paddleY, paddleW, paddleH);
        ctx.restore();
        // Powerups
        for (const p of powerups) {
          ctx.fillStyle = p.kind === 'wide' ? '#5fff8a' : p.kind === 'multi' ? '#ff8855' : '#7df0ff';
          ctx.fillRect(p.x - 12, p.y - 8, 24, 16);
          ctx.fillStyle = '#1a1a1a';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.kind === 'wide' ? '↔' : p.kind === 'multi' ? '×3' : '◐', p.x, p.y + 4);
        }
        // Balls
        for (const b of balls) drawTrajanOrb(ctx, b.x, b.y, b.r + 3);
        // Juice particles inside shake
        juice.drawParticles(ctx);
        ctx.restore();
        // HUD (no shake)
        ctx.fillStyle = '#fffef6';
        ctx.font = '700 14px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('SCORE ' + score, 8, 22);
        ctx.textAlign = 'right';
        ctx.fillText('♥ '.repeat(lives), W - 8, 22);
        // Best score line
        ctx.font = '700 10px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(255,254,246,0.55)';
        ctx.fillText('BEST ' + best, W - 8, 40);
        if (!started) {
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = '700 16px Outfit, sans-serif';
          ctx.fillText('TAP & DRAG TO BEGIN', W / 2, H / 2);
        }
        // Juice overlay (flyers + flash) above everything
        juice.drawOverlay(ctx);
      }

      render(); // v18.2: paint initial frame so countdown sits over the populated scene
      const loop = gameLoop((dt) => { update(dt); render(); });
      runCountdown(board.wrap, () => loop.start());
    });
  }

  // ════════════════════════════════════════════════════════════════
  // GAME 9: COIN CATCH — catch your persona's coins, avoid the other
  // ════════════════════════════════════════════════════════════════
  function startCoinCatchGame() {
    const ov = createGameOverlay();
    const intro = pickFromPool('game_intro_coins');
    ov.innerHTML = `
      <div class="clippy-game-title">🪙 Coin Catch</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-coin-side-pick">
        <button class="clippy-game-btn" data-side="gold">🥇 Catch Trajan (gold)</button>
        <button class="clippy-game-btn" data-side="silver">🥈 Catch Providentia (silver)</button>
      </div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
      ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
      ov.querySelectorAll('[data-side]').forEach(btn => {
        btn.addEventListener('click', () => beginRound(btn.getAttribute('data-side')));
      });

    function beginRound(side) {
      const wantHue = side;     // 'gold' | 'silver'
      const otherHue = wantHue === 'gold' ? 'silver' : 'gold';
      ov.innerHTML = `
        <div class="clippy-game-title">🪙 COIN CATCH</div>
        <div class="clippy-canvas-wrap" data-wrap></div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;">Drag the basket. Catch ${wantHue}, dodge ${otherHue}.</div>
        <div class="clippy-game-buttons"><button class="clippy-game-btn is-ghost" data-act="quit">Quit</button></div>`;
      const wrap = ov.querySelector('[data-wrap]');
      const board = makeCanvasBoard(wrap, { bg: 'linear-gradient(180deg, #2a2540 0%, #1a1530 100%)' });
      const { ctx, w: W, h: H } = board;
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => { loop.stop(); clearInterval(timerInt); closeGameOverlay(); });

      const BASKET_W = 70, BASKET_H = 18;
      let basketX = W / 2 - BASKET_W / 2;
      const basketY = H - 36;
      const coins = [];
      let score = 0, missed = 0, wrongCaught = 0, timeLeft = 60;
      let combo = 0;
      let best = getBest('coins');
      let spawnTimer = 0;
      let dragActive = false;
      const juice = makeJuice(W, H);

      function setBasketFromPoint(clientX) {
        const rect = board.wrap.getBoundingClientRect();
        basketX = Math.max(0, Math.min(W - BASKET_W, clientX - rect.left - BASKET_W / 2));
      }
      board.wrap.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length) { dragActive = true; setBasketFromPoint(e.touches[0].clientX); }
      }, { passive: false });
      board.wrap.addEventListener('touchmove', (e) => { if (dragActive && e.touches.length) setBasketFromPoint(e.touches[0].clientX); }, { passive: false });
      board.wrap.addEventListener('touchend', () => { dragActive = false; });
      board.wrap.addEventListener('mousedown', (e) => { dragActive = true; setBasketFromPoint(e.clientX); });
      board.wrap.addEventListener('mousemove', (e) => { if (dragActive) setBasketFromPoint(e.clientX); });
      board.wrap.addEventListener('mouseup', () => { dragActive = false; });
      board.wrap.addEventListener('mouseleave', () => { dragActive = false; });

      function update(dt) {
        if (juice.update(dt)) return;
        spawnTimer -= dt;
        const elapsed = 60 - timeLeft;
        const spawnEvery = Math.max(18, 50 - elapsed);
        if (spawnTimer <= 0) {
          const r = Math.random();
          const hue = r < 0.55 ? wantHue : otherHue;
          coins.push({ x: 20 + Math.random() * (W - 40), y: -16, vy: 2.4 + Math.random() * 1.6 + elapsed * 0.03, r: 12, hue });
          spawnTimer = spawnEvery;
        }
        for (let i = coins.length - 1; i >= 0; i--) {
          const c = coins[i];
          c.y += c.vy * dt;
          // Caught?
          if (c.y + c.r > basketY && c.y - c.r < basketY + BASKET_H && c.x > basketX && c.x < basketX + BASKET_W) {
            if (c.hue === wantHue) {
              score++;
              combo++;
              // Pitch rises with combo
              const pitch = 440 + Math.min(660, combo * 26);
              playPitch(pitch, 0.08, 'triangle');
              juice.flyScore('+1', c.x, c.y, c.hue === 'gold' ? '#ffd870' : '#e8e8ec');
              juice.burst(c.x, c.y, 6, {
                colors: c.hue === 'gold' ? ['#ffd870', '#fff4c8'] : ['#e8e8ec', '#fff'],
                speed: 2.4,
              });
              if (combo > 0 && combo % 8 === 0) {
                juice.flash('#ffd870', 0.22, 8);
                juice.flyScore('×' + combo + ' STREAK', W / 2, H * 0.4, '#ffd870');
                playPitch(660, 0.10, 'triangle');
                setTimeout(() => playPitch(880, 0.12, 'triangle'), 60);
              }
            } else {
              wrongCaught++;
              score = Math.max(0, score - 1);
              combo = 0;
              juice.shake(12);
              juice.hitstop(2);
              juice.flash('#c83a3a', 0.30, 8);
              juice.flyScore('-1', c.x, c.y, '#ff5577');
              juice.burst(c.x, c.y, 8, { colors: ['#ff5577', '#c83a3a'], speed: 3 });
              playPitch(180, 0.16, 'sawtooth');
            }
            coins.splice(i, 1);
            continue;
          }
          if (c.y - c.r > H) {
            if (c.hue === wantHue) {
              missed++;
              combo = 0;
              juice.flash('#c83a3a', 0.18, 5);
            }
            coins.splice(i, 1);
          }
        }
      }

      function render() {
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        juice.applyShake(ctx);
        // Coins
        for (const c of coins) drawTrajanOrb(ctx, c.x, c.y, c.r, { hue: c.hue });
        // Basket
        ctx.fillStyle = '#5a3a1f';
        ctx.fillRect(basketX, basketY, BASKET_W, BASKET_H);
        ctx.fillStyle = '#7a5b2e';
        ctx.fillRect(basketX, basketY, BASKET_W, 4);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.strokeRect(basketX, basketY, BASKET_W, BASKET_H);
        // Weave lines
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 5; i++) {
          const xL = basketX + (BASKET_W / 5) * i;
          ctx.beginPath(); ctx.moveTo(xL, basketY + 2); ctx.lineTo(xL, basketY + BASKET_H - 2); ctx.stroke();
        }
        // Juice particles inside shake
        juice.drawParticles(ctx);
        ctx.restore();
        // HUD (no shake)
        ctx.fillStyle = '#fffef6';
        ctx.font = '700 14px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('PTS ' + score, 8, 22);
        ctx.textAlign = 'center';
        ctx.fillText('MISS ' + missed, W / 2, 22);
        ctx.textAlign = 'right';
        ctx.fillText(timeLeft + 's', W - 8, 22);
        // Best + combo
        ctx.font = '700 10px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(255,254,246,0.55)';
        ctx.textAlign = 'right';
        ctx.fillText('BEST ' + best, W - 8, 40);
        if (combo >= 2) {
          ctx.fillStyle = '#ffd870';
          ctx.textAlign = 'left';
          ctx.fillText('×' + combo, 8, 40);
        }
        // Juice overlay
        juice.drawOverlay(ctx);
      }

      let timerInt = null;
      render(); // v18.2: paint initial frame so countdown sits over the populated scene
      const loop = gameLoop((dt) => { update(dt); render(); });
      runCountdown(board.wrap, () => {
        loop.start();
        timerInt = setInterval(() => {
          if (!loop.running || document.hidden) return;
          timeLeft--;
          if (timeLeft <= 0) {
            loop.stop();
            clearInterval(timerInt);
            if (score > best) { best = score; setBest('coins', best); }
            setTimeout(() => showGameResult('coins', score, {
              stats: [
                { label: 'Missed', value: missed },
                { label: 'Wrong caught', value: wrongCaught },
              ],
            }), 500);
          }
        }, 1000);
        state.gameCleanupFns = (state.gameCleanupFns || []).concat([() => clearInterval(timerInt)]);
      });
    }
  }

  // ════════════════════════════════════════════════════════════════
  // GAME 10: ASTEROID FIELD — swipe to drift, collect stars, survive
  // ════════════════════════════════════════════════════════════════
  function startAsteroidsGame() {
    const ov = createGameOverlay();
    const intro = pickFromPool('game_intro_asteroids');
    ov.innerHTML = `
      <div class="clippy-game-title">🌌 Asteroid Field</div>
      <div class="clippy-game-instruction">${esc(intro)}</div>
      <div class="clippy-game-buttons">
        <button class="clippy-game-btn" data-act="start">Start!</button>
        <button class="clippy-game-btn is-ghost" data-act="cancel">Cancel</button>
      </div>`;
    ov.querySelector('[data-act="cancel"]').addEventListener('click', closeGameOverlay);
    ov.querySelector('[data-act="start"]').addEventListener('click', () => {
      ov.innerHTML = `
        <div class="clippy-game-title">🌌 ASTEROID FIELD</div>
        <div class="clippy-canvas-wrap" data-wrap></div>
        <div class="clippy-game-instruction" style="font-size:13px;opacity:0.6;">Drag anywhere to steer. Grab stars. Survive.</div>
        <div class="clippy-game-buttons"><button class="clippy-game-btn is-ghost" data-act="quit">Quit</button></div>`;
      const wrap = ov.querySelector('[data-wrap]');
      const board = makeCanvasBoard(wrap, { bg: 'radial-gradient(ellipse at center, #1a1a3e 0%, #06081a 100%)' });
      const { ctx, w: W, h: H } = board;
      ov.querySelector('[data-act="quit"]').addEventListener('click', () => { loop.stop(); closeGameOverlay(); });

      const PLAYER_R = 18;
      let px = W / 2, py = H * 0.7;
      let vx = 0, vy = 0;
      let targetX = px, targetY = py;
      let alive = true;
      const asteroids = [], starsFx = [];
      const bgStars = [];
      for (let i = 0; i < 50; i++) bgStars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.3, v: 0.3 + Math.random() * 1.2, a: 0.4 + Math.random() * 0.6 });
      let score = 0, starsCaught = 0, t = 0, lastAst = 0, lastStar = 0;
      let best = getBest('asteroids');
      let dragActive = false;
      const juice = makeJuice(W, H);

      function setTargetFromPoint(clientX, clientY) {
        const rect = board.wrap.getBoundingClientRect();
        targetX = clientX - rect.left;
        targetY = clientY - rect.top;
      }
      board.wrap.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length) { dragActive = true; setTargetFromPoint(e.touches[0].clientX, e.touches[0].clientY); }
      }, { passive: false });
      board.wrap.addEventListener('touchmove', (e) => { if (dragActive && e.touches.length) setTargetFromPoint(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
      board.wrap.addEventListener('touchend', () => { dragActive = false; });
      board.wrap.addEventListener('mousedown', (e) => { dragActive = true; setTargetFromPoint(e.clientX, e.clientY); });
      board.wrap.addEventListener('mousemove', (e) => { if (dragActive) setTargetFromPoint(e.clientX, e.clientY); });
      board.wrap.addEventListener('mouseup', () => { dragActive = false; });
      board.wrap.addEventListener('mouseleave', () => { dragActive = false; });

      function spawnAsteroid() {
        // Spawn from one of the four edges
        const side = Math.floor(Math.random() * 4);
        const r = 14 + Math.random() * 22;
        let x, y, vx2, vy2;
        const sp = 1.4 + Math.random() * 1.6 + Math.min(2.5, t / 600);
        if (side === 0)      { x = Math.random() * W; y = -r;          vx2 = (Math.random() - 0.5) * 1; vy2 =  sp; }
        else if (side === 1) { x = W + r;             y = Math.random() * H; vx2 = -sp;                vy2 = (Math.random() - 0.5) * 1; }
        else if (side === 2) { x = Math.random() * W; y = H + r;       vx2 = (Math.random() - 0.5) * 1; vy2 = -sp; }
        else                 { x = -r;                y = Math.random() * H; vx2 =  sp;                vy2 = (Math.random() - 0.5) * 1; }
        asteroids.push({ x, y, vx: vx2, vy: vy2, r, rot: 0, rotV: (Math.random() - 0.5) * 0.06 });
      }
      function spawnStar() {
        starsFx.push({ x: 20 + Math.random() * (W - 40), y: 20 + Math.random() * (H - 40), r: 9, life: 0, phase: Math.random() * Math.PI * 2 });
      }

      function update(dt) {
        if (juice.update(dt)) return;
        t += dt;
        // Player steering via spring towards target
        if (dragActive) {
          const ax = (targetX - px) * 0.012;
          const ay = (targetY - py) * 0.012;
          vx += ax * dt; vy += ay * dt;
        }
        vx *= 0.93; vy *= 0.93;
        px += vx * dt; py += vy * dt;
        if (px - PLAYER_R < 0)   { px = PLAYER_R;   vx *= -0.6; }
        if (px + PLAYER_R > W)   { px = W - PLAYER_R; vx *= -0.6; }
        if (py - PLAYER_R < 0)   { py = PLAYER_R;   vy *= -0.6; }
        if (py + PLAYER_R > H)   { py = H - PLAYER_R; vy *= -0.6; }
        // BG stars
        for (const s of bgStars) {
          s.y += s.v * dt;
          if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
        }
        // Spawn rate scales with time
        const astEvery = Math.max(20, 60 - t / 30);
        if (t - lastAst > astEvery) { spawnAsteroid(); lastAst = t; }
        if (t - lastStar > 200) { spawnStar(); lastStar = t; }
        // Move asteroids
        for (let i = asteroids.length - 1; i >= 0; i--) {
          const a = asteroids[i];
          a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.rotV * dt;
          if (a.x < -100 || a.x > W + 100 || a.y < -100 || a.y > H + 100) { asteroids.splice(i, 1); continue; }
          // Collision (circle)
          const dx = a.x - px, dy = a.y - py;
          if (dx * dx + dy * dy < (a.r + PLAYER_R - 2) * (a.r + PLAYER_R - 2)) {
            alive = false;
            return die();
          }
        }
        // Stars (collect)
        for (let i = starsFx.length - 1; i >= 0; i--) {
          const s = starsFx[i];
          s.life += dt; s.phase += 0.08 * dt;
          if (s.life > 60 * 6) { starsFx.splice(i, 1); continue; }
          const dx = s.x - px, dy = s.y - py;
          if (dx * dx + dy * dy < (s.r + PLAYER_R) * (s.r + PLAYER_R)) {
            score += 5; starsCaught++;
            // JUICE
            juice.flyScore('+5', s.x, s.y, '#ffd870');
            juice.burst(s.x, s.y, 16, { colors: ['#ffd870', '#fff4c8', '#ffffff'], speed: 4 });
            juice.flash('#fff4c8', 0.20, 6);
            const pitch = 660 + Math.min(880, starsCaught * 20);
            playPitch(pitch, 0.10, 'triangle');
            starsFx.splice(i, 1);
          }
        }
        // Survival scoring: +1 per second
        score = Math.floor(t / 60) + starsCaught * 5;
      }
      function die() {
        loop.stop();
        // Big death moment
        juice.hitstop(5);
        juice.shake(22);
        juice.flash('#c83a3a', 0.55, 14);
        juice.burst(px, py, 40, { colors: ['#7df0ff', '#fffef6', '#ff8855', '#4cb6ff'], speed: 6 });
        playPitch(140, 0.20, 'sawtooth');
        setTimeout(() => playPitch(85, 0.35, 'sawtooth'), 80);
        if (score > best) { best = score; setBest('asteroids', best); }
        bubble(pickFromPool('asteroids_die'), { autoHide: 2500 });
        setTimeout(() => showGameResult('asteroids', score, {
          stats: [
            { label: 'Survived', value: Math.floor(t / 60) + 's' },
            { label: 'Stars', value: starsCaught },
          ],
        }), 700);
      }
      function render() {
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        juice.applyShake(ctx);
        // BG stars
        for (const s of bgStars) {
          ctx.globalAlpha = s.a;
          ctx.fillStyle = '#fffef6';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // Stars (collectible)
        for (const s of starsFx) {
          const pulse = 1 + Math.sin(s.phase) * 0.18;
          ctx.fillStyle = '#ffd870';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.scale(pulse, pulse);
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
            const r1 = s.r, r2 = s.r * 0.45;
            ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
            const a2 = a + Math.PI / 5;
            ctx.lineTo(Math.cos(a2) * r2, Math.sin(a2) * r2);
          }
          ctx.closePath();
          ctx.fill(); ctx.stroke();
          ctx.restore();
        }
        // Asteroids
        for (const a of asteroids) {
          ctx.save();
          ctx.translate(a.x, a.y);
          ctx.rotate(a.rot);
          const g = ctx.createRadialGradient(-a.r * 0.3, -a.r * 0.3, a.r * 0.2, 0, 0, a.r);
          g.addColorStop(0, '#9a8c75');
          g.addColorStop(1, '#3a2f24');
          ctx.fillStyle = g;
          ctx.beginPath();
          const sides = 8;
          for (let i = 0; i < sides; i++) {
            const ang = (i / sides) * Math.PI * 2;
            const rr = a.r * (0.78 + (i % 2 === 0 ? 0.18 : 0));
            ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#1a1a1a';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
        // Player Trajan
        drawTrajanOrb(ctx, px, py, PLAYER_R);
        // Engine trail — fatter when moving fast
        if (alive && (Math.abs(vx) > 0.3 || Math.abs(vy) > 0.3)) {
          const speed = Math.hypot(vx, vy);
          // Outer halo
          const tg = ctx.createRadialGradient(px - vx * 2, py - vy * 2, 0, px - vx * 2, py - vy * 2, Math.min(14, speed * 2));
          tg.addColorStop(0, 'rgba(125, 240, 255, 0.7)');
          tg.addColorStop(1, 'rgba(125, 240, 255, 0)');
          ctx.fillStyle = tg;
          ctx.beginPath();
          ctx.arc(px - vx * 2, py - vy * 2, Math.min(14, speed * 2), 0, Math.PI * 2);
          ctx.fill();
          // Core
          ctx.fillStyle = 'rgba(125, 240, 255, 0.7)';
          ctx.beginPath();
          ctx.arc(px - vx * 2, py - vy * 2, Math.min(6, speed * 1.0), 0, Math.PI * 2);
          ctx.fill();
        }
        // Juice particles
        juice.drawParticles(ctx);
        ctx.restore();
        // HUD (no shake)
        ctx.fillStyle = '#fffef6';
        ctx.font = '700 14px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('PTS ' + score, 8, 22);
        ctx.textAlign = 'right';
        ctx.fillText('★ ' + starsCaught, W - 8, 22);
        ctx.textAlign = 'center';
        ctx.fillText(Math.floor(t / 60) + 's', W / 2, 22);
        // Best score
        ctx.font = '700 10px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(255,254,246,0.55)';
        ctx.textAlign = 'right';
        ctx.fillText('BEST ' + best, W - 8, 40);
        // Juice overlay
        juice.drawOverlay(ctx);
      }

      render(); // v18.2: paint initial frame so countdown sits over the populated scene
      const loop = gameLoop((dt) => { update(dt); render(); });
      runCountdown(board.wrap, () => loop.start());
    });
  }



    /* ── Public API ─────────────────────────────────────────────────
       The functions above stay in scope via closure. We surface only
       the ones called from outside the games module. */
    NX.clippy.games = {
      showMenu:     showGameMenu,
      closeOverlay: closeGameOverlay,
      offer:        offerGame,
      showResult:   showGameResult,
      // Internal helpers also surfaced for completeness — used by
      // command palette + the bored-mischief "offer a game" hook.
      _GAMES:       GAMES,
    };

    console.log('[clippy-games] Module ready — 10 mini-games loaded');
  }

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
