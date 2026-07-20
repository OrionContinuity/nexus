/* ════════════════════════════════════════════════════════════════════
   clippy-gacha.js — daily card pull system
   ────────────────────────────────────────────────────────────────────
   v18.26 — extracted from clippy.js as a standalone module. This is
   the first physical sub-module split; the pattern here is the
   template for splitting other clippy sub-systems (games, mood, etc.)
   in future sessions.

   ARCHITECTURE — LATE BINDING

   Loads AFTER clippy.js. clippy.js exposes a small private namespace
   on `NX.clippy._internal` containing the helpers this module needs
   (state, bubble, pickFromPool, mood, etc.). This module reads from
   that namespace and attaches its public surface as `NX.clippy.gacha`.

   The module is self-contained:
     • Owns the gacha card catalog (GACHA_CARDS) and rates (GACHA_RATES)
     • Owns the gacha persistence (localStorage under userKey('clippy_gacha'))
     • Owns the gacha overlay UI (.clippy-gacha-overlay)
     • Exposes 4 public functions via NX.clippy.gacha

   It depends on clippy core for:
     • bubble / pickFromPool / substituteVars / esc / userKey
     • spawnParticles / playTone
     • adjustFeeling / addBondXP / depositMemory
     • openOverlay / closeOverlay (overlay manager)
     • state (specifically state.preferences.daily_streak,
              state.suppressed, state.shell, state.svgMarkup)

   PUBLIC API
     NX.clippy.gacha.showInvite()      — invitation modal + pull flow
     NX.clippy.gacha.showCollection()  — full collection grid view
     NX.clippy.gacha.getState()        — current gacha state snapshot
     NX.clippy.gacha.CARDS             — read-only catalog
   ════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  /* Late-binding init. Polls for NX.clippy._internal to be ready
     (clippy.js sets it up during its own init flow). Once available,
     captures the helpers and wires the public API. */
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

    /* ── Card catalog ────────────────────────────────────────────── */

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

    const GACHA_RATES = { common: 0.60, uncommon: 0.25, rare: 0.12, legendary: 0.03 };

    /* ── Persistence + roll mechanics ────────────────────────────── */

    function getGachaState() {
      // v330: NORMALIZE every field. The blob is cloud-synced (clippy.js installs data.gacha from
      // the shared bus), so `parsed || {...}` used to accept any truthy JSON — a missing `collection`
      // then threw mid-reveal AFTER the buttons were hidden, trapping the user under a closeless
      // fullscreen overlay with Clippy suppressed until reload; missing pity fields became NaN and
      // silently disabled pity forever.
      let parsed = null;
      try {
        const raw = localStorage.getItem(ix.userKey('clippy_gacha'));
        parsed = raw ? JSON.parse(raw) : null;
      } catch (e) {}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
      const coll = {};
      if (parsed.collection && typeof parsed.collection === 'object' && !Array.isArray(parsed.collection)) {
        for (const k in parsed.collection) { const n = Number(parsed.collection[k]); if (n > 0) coll[k] = Math.floor(n); }
      }
      return {
        collection: coll,
        pity_no_rare: Number(parsed.pity_no_rare) || 0,
        pity_no_legendary: Number(parsed.pity_no_legendary) || 0,
        last_pull_date: (typeof parsed.last_pull_date === 'string') ? parsed.last_pull_date : null,
        total_pulls: Number(parsed.total_pulls) || 0,
      };
    }
    function saveGachaState(s) {
      try { localStorage.setItem(ix.userKey('clippy_gacha'), JSON.stringify(s)); } catch (e) {}
    }
    function pickGachaRarity(g) {
      // Pity overrides — guaranteed rare every 10 pulls, legendary every 30
      if (g.pity_no_legendary >= 29) return 'legendary';
      const r = Math.random();
      let cum = 0, rolled = 'common';
      for (const rar of ['legendary', 'rare', 'uncommon', 'common']) {
        cum += GACHA_RATES[rar];
        if (r < cum) { rolled = rar; break; }
      }
      // v330: rare-pity is a FLOOR, not a ceiling. The old early `return 'rare'` fired BEFORE the
      // roll, so a pity pull could never be legendary — deflating the advertised legendary rate on
      // exactly the pulls pity is meant to improve. Roll first, then upgrade only if it came up low.
      if (g.pity_no_rare >= 9 && (rolled === 'common' || rolled === 'uncommon')) return 'rare';
      return rolled;
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
      return (ix.state.preferences.daily_streak || 0) >= 1;
    }

    /* ── Invitation modal + pull flow ────────────────────────────── */

    function showInvite() {
      if (!hasStreakForGacha()) {
        ix.bubble(ix.pickFromPool('gacha_streak_required'), { autoHide: 4000, eyebrow: '🎴 GACHA' });
        return;
      }
      if (!canPullToday()) {
        ix.bubble(ix.substituteVars(ix.pickFromPool('gacha_already_pulled_today')), { autoHide: 4000, eyebrow: '🎴 GACHA' });
        return;
      }
      runPull();
    }

    function runPull() {
      const state = ix.state;
      const g = getGachaState();
      // v331: felt anticipation — when pity is close, tease it with the (previously dead)
      // gacha_pity_warning pool so the player can feel something rare building.
      let pityLine = '';
      if (g.pity_no_legendary >= 25 || g.pity_no_rare >= 7) {
        const p = ix.pickFromPool('gacha_pity_warning');
        if (p) pityLine = `<div class="clippy-gacha-prompt" style="opacity:.85;margin-top:6px;">✨ ${ix.esc(p)}</div>`;
      }
      const ov = document.createElement('div');
      ov.className = 'clippy-gacha-overlay';
      ov.innerHTML = `
        <div class="clippy-gacha-prompt">DAILY PULL · Streak Day ${Number(state.preferences.daily_streak) || 1}</div>
        <div class="clippy-gacha-title">${ix.esc(ix.substituteVars(ix.pickFromPool('gacha_invite')))}</div>
        ${pityLine}
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
      ix.openOverlay('gacha');

      function closeOv() {
        ov.classList.remove('is-visible');
        setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
        state.suppressed = false;
        if (state.shell) state.shell.classList.remove('is-suppressed');
        ix.closeOverlay('gacha');
      }
      ov.querySelector('[data-act="later"]').addEventListener('click', closeOv);
      ov.querySelector('[data-act="pull"]').addEventListener('click', () => {
        const orb = ov.querySelector('.clippy-gacha-pull-orb');
        orb.classList.add('is-spinning');
        ov.querySelector('.clippy-game-buttons').style.display = 'none';
        ov.querySelector('.clippy-gacha-title').textContent = ix.pickFromPool('gacha_anticipate');
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
      const remarkLine = ix.substituteVars(ix.pickFromPool(rarityPool));

      // Render the card
      const rarityLabel = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', legendary: 'LEGENDARY' }[rarity];
      ov.innerHTML = `
        <div class="clippy-gacha-prompt">${ix.esc(rarityLabel)}</div>
        <div class="clippy-gacha-title">${ix.esc(remarkLine)}</div>
        <div class="clippy-gacha-card is-${rarity}">
          <div class="clippy-gacha-card-rarity">${ix.esc(rarityLabel)}</div>
          <div class="clippy-gacha-card-glyph">${card.glyph}</div>
          <div class="clippy-gacha-card-name">${ix.esc(card.name)}</div>
          <div class="clippy-gacha-card-desc">${ix.esc(card.desc)}</div>
          <div class="clippy-gacha-card-power">${ix.esc(card.power)}</div>
        </div>
        ${isDuplicate ? `<div class="clippy-gacha-duplicate">${ix.esc(ix.pickFromPool('gacha_duplicate'))}</div>` : ''}
        <div class="clippy-game-buttons">
          <button class="clippy-game-btn" data-act="collection">View Collection</button>
          <button class="clippy-game-btn is-ghost" data-act="done">Done</button>
        </div>
      `;
      // Celebration effects — kept as direct calls to preserve historical
      // game balance. Could migrate to processInteraction('gacha_pull')
      // in a future ship after tuning the dispatcher values to match.
      if (rarity === 'legendary') {
        ix.spawnParticles({ count: 32, type: 'confetti' });
        ix.playTone('milestone');
        ix.adjustFeeling('happiness', +20);
        ix.addBondXP(50);
      } else if (rarity === 'rare') {
        ix.spawnParticles({ count: 16, type: 'sparkle' });
        ix.playTone('sparkle');
        ix.adjustFeeling('happiness', +10);
        ix.addBondXP(20);
      } else if (rarity === 'uncommon') {
        ix.spawnParticles({ count: 8, type: 'sparkle' });
        ix.playTone('boop');
        ix.adjustFeeling('happiness', +5);
        ix.addBondXP(10);
      } else {
        ix.spawnParticles({ count: 4, type: 'sparkle' });
        ix.playTone('boop');
        ix.addBondXP(5);
      }
      if (isDuplicate) ix.addBondXP(5);   // small consolation bond XP

      // Memory deposit (especially for rares+)
      if (rarity === 'rare' || rarity === 'legendary') {
        ix.depositMemory('gacha_pull', `Pulled ${rarityLabel}: ${card.name}`, { card: card.id, rarity }, rarity === 'legendary' ? 4 : 3);
      }
      ov.querySelector('[data-act="done"]').addEventListener('click', closeOv);
      ov.querySelector('[data-act="collection"]').addEventListener('click', () => {
        closeOv();
        setTimeout(() => showCollection(), 320);
      });
    }

    /* ── Collection grid view ────────────────────────────────────── */

    function showCollection() {
      const state = ix.state;
      const g = getGachaState();
      const collected = Object.keys(g.collection).length;
      const total = GACHA_CARDS.length;
      const remark = ix.pickFromPool('gacha_collection_remark');
      const ov = document.createElement('div');
      ov.className = 'clippy-gacha-overlay';
      ov.innerHTML = `
        <div class="clippy-gacha-prompt">🎴 GACHA COLLECTION</div>
        <div class="clippy-gacha-title">${ix.esc(remark)}</div>
        <div class="clippy-gacha-prompt" style="margin-bottom:14px;">
          ${collected}/${total} unique · ${Number(g.total_pulls) || 0} total pulls
        </div>
        <div class="clippy-gacha-collection">
          ${GACHA_CARDS.map(c => {
            const count = g.collection[c.id] || 0;
            const lockedCls = count === 0 ? 'is-locked' : '';
            return `<div class="clippy-gacha-coll-card is-${c.rarity} ${lockedCls}">
              <div class="clippy-gacha-coll-glyph">${c.glyph}</div>
              <div class="clippy-gacha-coll-name">${count === 0 ? '???' : ix.esc(c.name)}</div>
              <div class="clippy-gacha-coll-count">×${Number(count) || 0}</div>
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
      ix.openOverlay('gacha');
      ov.querySelector('[data-act="close"]').addEventListener('click', () => {
        ov.classList.remove('is-visible');
        setTimeout(() => { try { ov.remove(); } catch (e) {} }, 280);
        state.suppressed = false;
        if (state.shell) state.shell.classList.remove('is-suppressed');
        ix.closeOverlay('gacha');
      });
    }

    /* ── Public API ──────────────────────────────────────────────── */

    NX.clippy.gacha = {
      showInvite,
      showCollection,
      getState: getGachaState,
      CARDS: GACHA_CARDS,
    };

    if (typeof console !== 'undefined') {
      console.log('[clippy-gacha v18.26] ready — ' + GACHA_CARDS.length + ' cards across 4 rarities');
    }
  }

  init();

})();
