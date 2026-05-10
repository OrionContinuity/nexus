/* ════════════════════════════════════════════════════════════════════════
   NEXUS Clippy — v2 (clippyjs-backed)
   ────────────────────────────────────────────────────────────────────
   Now uses pithings/clippy (clippyjs) as the character layer:
     - Authentic original Microsoft Clippy + 9 alternate agents
     - Real 1997 hand-drawn animations (Wave, Congratulate, Searching, etc.)
     - Their built-in speech bubble for plain messages
     - agent.gestureAt(x, y) for hop-and-point at UI elements

   We layer ON TOP of the library:
     - Dialog pool + anti-repeat selector (clippy-dialog.json)
     - Custom action-bubble for prompts that need buttons (Yes/No/Maybe)
     - Command palette (search across NEXUS)
     - Persona handoff (Providentia / Trajan, with quirky "you sure?")
     - Trajan-quote moments (with laurel costume overlay)
     - Song player (audio/nexus-theme.mp3)
     - Costume overlay layer (PNG/SVG over the agent)
     - Agent switching (Meet my friends → Bonzi, Merlin, Rover…)
     - Easter eggs (5x click, 100x unlock, konami, "hi clippy")
     - Preferences (Supabase clippy_preferences + localStorage)
     - Comeback rules (peek again after dismiss, stops at 3 rejects)

   Loads clippyjs via dynamic import (ESM from jsDelivr CDN). Self-host
   later for full offline support.
   ════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  const CDN_INDEX  = 'https://cdn.jsdelivr.net/npm/clippyjs/dist/index.mjs';
  const CDN_AGENTS = 'https://cdn.jsdelivr.net/npm/clippyjs/dist/agents/index.mjs';

  const AVAILABLE_AGENTS = [
    { key: 'Clippy',  label: 'Clippy',  hint: 'The classic.' },
    { key: 'Bonzi',   label: 'Bonzi',   hint: 'Purple monkey energy.' },
    { key: 'Merlin',  label: 'Merlin',  hint: 'Wizard. Spooky.' },
    { key: 'Rover',   label: 'Rover',   hint: 'Good dog.' },
    { key: 'Genie',   label: 'Genie',   hint: 'Three wishes-ish.' },
    { key: 'Genius',  label: 'Genius',  hint: 'Big brain Einstein.' },
    { key: 'Peedy',   label: 'Peedy',   hint: 'Parrot. Loud.' },
    { key: 'Rocky',   label: 'Rocky',   hint: 'Another good dog.' },
    { key: 'Links',   label: 'Links',   hint: 'Cat with attitude.' },
    { key: 'F1',      label: 'F1',      hint: 'Clippy\'s robotic cousin.' },
  ];


  // ─── State ──────────────────────────────────────────────────────────
  const state = {
    initialized: false,
    enabled: false,
    agent: null,                // clippyjs agent instance
    agentName: 'Clippy',
    agentDomEl: null,
    bubble: null,               // our custom action bubble
    palette: null,
    costumeLayer: null,
    currentCostume: null,
    costumeFrame: 0,
    dialog: null,
    quoteCorpus: [],
    poolHistory: {},
    preferences: {
      enabled: null,
      do_not_disturb: false,
      preferred_agent: 'Clippy',
      position_x: null,         // saved drag position (px from left)
      position_y: null,         // saved drag position (px from top)
      dismissed_tips: [],
      total_clicks: 0,
      unlocked: [],
      preferred_persona: null,
      last_seen_at: null,
      reject_count: 0,
      session_count: 0,
    },
    audio: null,
    audioPlaying: false,
    konamiSeq: [],
    rapidClicks: [],
    quoteCooldownAt: 0,
    songCooldownAt: 0,
    randomTimer: null,
  };

  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];


  // ─── Utilities ──────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function getCurrentUser() {
    try { return (window.NX && NX.currentUser) || null; } catch (e) { return null; }
  }


  // ─── Dialog selection with anti-repeat ──────────────────────────────
  function pickFromPool(poolKey, fallback) {
    const pool = state.dialog && state.dialog[poolKey];
    if (!pool || !pool.length) return fallback || '';
    const history = state.poolHistory[poolKey] || [];
    const candidates = pool.length > 3 ? pool.filter(line => !history.includes(line)) : pool;
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    state.poolHistory[poolKey] = [picked, ...history].slice(0, 3);
    persistPoolHistory();
    return picked;
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
  function fmt(line, vars) {
    if (!vars) return line;
    return line.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  }


  // ─── Preferences (Supabase + localStorage) ──────────────────────────
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
    if (state.preferences.preferred_agent) {
      state.agentName = state.preferences.preferred_agent;
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
        preferred_agent: state.agentName,
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


  // ─── Load dialog file ───────────────────────────────────────────────
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


  // ─── Agent loading via clippyjs ─────────────────────────────────────
  let _libCache = null, _agentsCache = null;
  async function importLib() {
    if (!_libCache) {
      // Try locally-vendored library first (populated by the
      // .github/workflows/vendor-clippyjs.yml action). Falls back to
      // jsDelivr CDN if not present. Either way, the service worker
      // caches the result so subsequent loads are offline.
      try {
        _libCache    = await import(/* @vite-ignore */ './js/clippyjs-vendor/index.mjs');
        _agentsCache = await import(/* @vite-ignore */ './js/clippyjs-vendor/agents/index.mjs');
        console.log('[clippy] using local vendored library');
      } catch (e) {
        console.log('[clippy] no local vendor — falling back to CDN');
        _libCache    = await import(/* @vite-ignore */ CDN_INDEX);
        _agentsCache = await import(/* @vite-ignore */ CDN_AGENTS);
      }
    }
    return { lib: _libCache, agents: _agentsCache };
  }

  async function loadAgent(name) {
    const { lib, agents } = await importLib();
    const ctor = agents[name] || agents.Clippy;
    if (state.agent) {
      try { state.agent.dispose(); } catch (e) {}
      state.agent = null;
    }
    state.agentName = name;
    state.agent = await lib.initAgent(ctor);
    state.agent.show();
    state.agentDomEl = await waitForAgentEl();
    // CRITICAL: move the agent into our top-layer popover host so it
    // escapes all NEXUS stacking contexts (cards-on-top-of-clippy bug)
    moveToTopLayer(state.agentDomEl);
    setupAgentInteractions();
    setupCostumeLayer();
    applySavedPosition();
  }
  async function waitForAgentEl(maxWait = 2500) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const el = document.querySelector('.clippy') ||
                 document.querySelector('[data-clippy]') ||
                 document.querySelector('.clippyjs-agent') ||
                 document.querySelector('.clippyjs');
      if (el) return el;
      await new Promise(r => setTimeout(r, 80));
    }
    return null;
  }


  // ─── Costume overlay layer ──────────────────────────────────────────
  function setupCostumeLayer() {
    if (!state.costumeLayer) {
      state.costumeLayer = document.createElement('div');
      state.costumeLayer.id = 'clippy-costume-layer';
      state.costumeLayer.style.display = 'none';
      ensureTopLayer().appendChild(state.costumeLayer);
    }
    if (state.costumeFrame) cancelAnimationFrame(state.costumeFrame);
    syncCostumePosition();
  }
  function syncCostumePosition() {
    if (!state.agentDomEl || !state.costumeLayer) {
      state.costumeFrame = requestAnimationFrame(syncCostumePosition);
      return;
    }
    const rect = state.agentDomEl.getBoundingClientRect();
    if (rect.width > 0) {
      state.costumeLayer.style.left = rect.left + 'px';
      state.costumeLayer.style.top = rect.top + 'px';
      state.costumeLayer.style.width = rect.width + 'px';
      state.costumeLayer.style.height = rect.height + 'px';
    }
    state.costumeFrame = requestAnimationFrame(syncCostumePosition);
  }
  function setCostume(name, durationMs) {
    if (!state.costumeLayer) return;
    state.costumeLayer.innerHTML = '';
    state.currentCostume = name || null;
    if (!name) {
      state.costumeLayer.style.display = 'none';
      return;
    }
    const img = document.createElement('img');
    img.src = `clippy-costumes/${name}.png`;
    img.alt = '';
    img.className = `clippy-costume-img clippy-costume-${name}`;
    img.onerror = () => {
      // Costume file not found yet — silently hide, no error spam
      state.costumeLayer.style.display = 'none';
    };
    state.costumeLayer.appendChild(img);
    state.costumeLayer.style.display = 'block';
    if (durationMs) {
      setTimeout(() => {
        if (state.currentCostume === name) setCostume(null);
      }, durationMs);
    }
  }


  // ─── TOP LAYER (the bulletproof stacking fix) ───────────────────────
  // Modern browsers render popover-mode elements in a special "top layer"
  // that escapes ALL stacking contexts. Even if NEXUS cards are wrapped
  // in transform/filter parents, even if modals raise z-index, the top
  // layer is on top. Period. We host Clippy + hit-target + bubbles +
  // palette inside this popover so nothing can ever cover them.
  //
  // Spec: https://developer.mozilla.org/en-US/docs/Web/API/Popover_API
  // Support: Chrome 114+ (May 2023), Safari 17+ (Sept 2023), Firefox 125+
  function ensureTopLayer() {
    if (state.topLayer && document.body.contains(state.topLayer)) return state.topLayer;
    const host = document.createElement('div');
    host.id = 'clippy-host';
    host.setAttribute('popover', 'manual');
    host.style.cssText = [
      'position: fixed',
      'inset: 0',
      'width: 100vw',
      'height: 100vh',
      'pointer-events: none',         // pass clicks through; children opt in
      'background: transparent',
      'border: 0',
      'padding: 0',
      'margin: 0',
      'overflow: visible',
    ].join('; ');
    document.body.appendChild(host);
    try {
      if (typeof host.showPopover === 'function') {
        host.showPopover();
        console.log('[clippy] top-layer (popover) active — bulletproof stacking');
      } else {
        // Fallback: max-int z-index. Less reliable but the best we can do.
        host.style.zIndex = '2147483646';
        console.warn('[clippy] popover unsupported — falling back to z-index 2147483646');
      }
    } catch (e) {
      host.style.zIndex = '2147483646';
      console.warn('[clippy] showPopover failed, using z-index fallback:', e);
    }
    state.topLayer = host;
    return host;
  }

  // Move an element into our top-layer host (preserving event listeners)
  function moveToTopLayer(el) {
    if (!el) return;
    const host = ensureTopLayer();
    if (el.parentElement !== host) {
      host.appendChild(el);
    }
  }


  // ─── Apply saved drag position (after agent loads) ──────────────────
  function applySavedPosition() {
    if (!state.agentDomEl) return;
    const px = state.preferences.position_x;
    const py = state.preferences.position_y;
    if (px == null || py == null) return;
    const maxX = Math.max(0, window.innerWidth  - 80);
    const maxY = Math.max(0, window.innerHeight - 80);
    const x = Math.max(0, Math.min(maxX, px));
    const y = Math.max(0, Math.min(maxY, py));
    state.agentDomEl.style.position = 'fixed';
    state.agentDomEl.style.left   = x + 'px';
    state.agentDomEl.style.top    = y + 'px';
    state.agentDomEl.style.right  = 'auto';
    state.agentDomEl.style.bottom = 'auto';
  }


  // ─── Hit target overlay (the click + drag surface) ──────────────────
  // The fundamental problem: clippyjs renders Clippy as a .clippy div
  // (background-image sprite) and may install its own pointer handlers
  // with stopPropagation. CSS transform: scale also makes the visual
  // larger than the layout box, so taps on his "head" can miss the
  // actual element. SOLUTION: a transparent overlay div sized to match
  // Clippy's visual rect (via getBoundingClientRect, which DOES include
  // transforms). All pointer events go through this overlay, with
  // setPointerCapture() so drag is bulletproof. clippyjs is bypassed
  // entirely for input handling — we use it only to drive animations.
  function ensureHitTarget() {
    if (state.hitTarget) return;
    const t = document.createElement('div');
    t.id = 'clippy-hit-target';
    t.style.cssText = [
      'position: fixed',
      'background: transparent',
      'cursor: grab',
      'pointer-events: auto',         // opt in to click capture
      'touch-action: none',           // critical: stops iOS from hijacking
      '-webkit-user-select: none',
      'user-select: none',
      'display: none',
    ].join('; ');
    // Append to TOP LAYER, not body — escapes all stacking contexts
    ensureTopLayer().appendChild(t);
    state.hitTarget = t;
    attachHitHandlers(t);
    if (state.hitFrame) cancelAnimationFrame(state.hitFrame);
    syncHitTarget();
  }

  function syncHitTarget() {
    state.hitFrame = requestAnimationFrame(syncHitTarget);
    if (!state.hitTarget || !state.agentDomEl) return;
    // getBoundingClientRect respects CSS transforms — gives us the
    // visual rect of the scaled Clippy, not the layout box.
    const r = state.agentDomEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      state.hitTarget.style.display = 'none';
      return;
    }
    // Add 8px padding so taps NEAR him still register
    state.hitTarget.style.display = state._suppressed ? 'none' : 'block';
    state.hitTarget.style.left   = (r.left - 8) + 'px';
    state.hitTarget.style.top    = (r.top - 8) + 'px';
    state.hitTarget.style.width  = (r.width + 16) + 'px';
    state.hitTarget.style.height = (r.height + 16) + 'px';
  }

  function attachHitHandlers(el) {
    let drag = null;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const aRect = state.agentDomEl ? state.agentDomEl.getBoundingClientRect() : null;
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        startTime: Date.now(),
        moved: false,
        pointerId: e.pointerId,
        agentLeftAtStart: aRect ? aRect.left : 0,
        agentTopAtStart:  aRect ? aRect.top  : 0,
      };
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      el.style.cursor = 'grabbing';
    });

    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      drag.moved = true;
      const newLeft = drag.agentLeftAtStart + dx;
      const newTop  = drag.agentTopAtStart  + dy;
      const maxX = window.innerWidth  - 60;
      const maxY = window.innerHeight - 60;
      const x = Math.max(0, Math.min(maxX, newLeft));
      const y = Math.max(0, Math.min(maxY, newTop));
      if (state.agentDomEl) {
        state.agentDomEl.style.position = 'fixed';
        state.agentDomEl.style.left   = x + 'px';
        state.agentDomEl.style.top    = y + 'px';
        state.agentDomEl.style.right  = 'auto';
        state.agentDomEl.style.bottom = 'auto';
      }
      e.preventDefault();
    });

    el.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const finished = drag;
      drag = null;
      el.style.cursor = 'grab';
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (finished.moved) {
        // Drag end — persist new position
        if (state.agentDomEl) {
          const r = state.agentDomEl.getBoundingClientRect();
          state.preferences.position_x = Math.round(r.left);
          state.preferences.position_y = Math.round(r.top);
          savePreferences();
        }
        return;
      }
      // Tap — fire click handler
      handleAgentClick();
    });

    el.addEventListener('pointercancel', () => {
      drag = null;
      el.style.cursor = 'grab';
    });
  }


  // ─── Content awareness ──────────────────────────────────────────────
  // Hide Clippy when modals/sheets/full-screen overlays are open. Watch
  // the DOM for the appearance of any high-z-index UI and suppress.
  function startContentAwareness() {
    if (state._awarenessStarted) return;
    state._awarenessStarted = true;
    const checkOverlays = () => {
      if (!state.enabled || !state.agent) return;
      // Heuristic match for common overlay/modal patterns in NEXUS
      const overlay = document.querySelector(
        '.nx-takeover.is-open, ' +
        '.nx-overlay-active, ' +
        '.nx-modal-backdrop:not([hidden]), ' +
        '.takeover.is-open, ' +
        'dialog[open], ' +
        '[role="dialog"][aria-hidden="false"], ' +
        '[data-overlay-active="true"], ' +
        '.clippy-palette.is-open'
      );
      const shouldHide = !!overlay;
      if (shouldHide && !state._suppressed) {
        state._suppressed = true;
        if (state.hitTarget) state.hitTarget.style.display = 'none';
      } else if (!shouldHide && state._suppressed) {
        state._suppressed = false;
        // hitTarget will re-show on next syncHitTarget tick
      }
    };
    const obs = new MutationObserver(checkOverlays);
    obs.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'aria-hidden', 'open', 'hidden', 'data-overlay-active']
    });
    checkOverlays();

    // When user focuses an input near Clippy, move him out of the way
    // to the opposite corner. Smart-move only fires once per focus, no
    // jumpy behavior.
    document.addEventListener('focusin', (e) => {
      if (!state.enabled || !state.agentDomEl) return;
      const t = e.target;
      if (!t || !t.matches) return;
      if (!t.matches('input, textarea, [contenteditable="true"]')) return;
      const inputRect = t.getBoundingClientRect();
      const agentRect = state.agentDomEl.getBoundingClientRect();
      // Are they overlapping or close? If so, move agent.
      const overlap = !(
        inputRect.right  < agentRect.left  ||
        inputRect.left   > agentRect.right ||
        inputRect.bottom < agentRect.top   ||
        inputRect.top    > agentRect.bottom
      );
      // Also nudge if agent is in same vertical band as input + within 100px
      const verticalConflict = Math.abs(
        (inputRect.top + inputRect.bottom) / 2 - (agentRect.top + agentRect.bottom) / 2
      ) < 120;
      if (overlap || verticalConflict) {
        moveToEmptyCorner();
      }
    });
  }

  // Periodically reposition to an empty corner. Keeps Clippy out of
  // the way without manual dragging. Runs every 60-90 seconds, with
  // a 30% chance of actually moving so he doesn't feel jumpy.
  function startMovingAround() {
    if (state._moveTimer) return;
    function loop() {
      if (!state.enabled) return;
      if (!state.preferences.do_not_disturb &&
          !state.bubble &&
          !state.palette &&
          !state._suppressed &&
          Math.random() < 0.3) {
        moveToEmptyCorner();
      }
      // Random interval 60-90s
      const next = 60_000 + Math.random() * 30_000;
      state._moveTimer = setTimeout(loop, next);
    }
    state._moveTimer = setTimeout(loop, 30_000);  // first check after 30s
  }

  // Programmatically move Clippy to the corner with the least UI noise.
  // Default heuristic: prefer top-right (least likely to have important
  // bottom-nav / FAB buttons), fall back to top-left.
  function moveToEmptyCorner() {
    if (!state.agentDomEl) return;
    const corners = [
      { x: window.innerWidth  - 180, y: 80, name: 'top-right' },
      { x: 20,                       y: 80, name: 'top-left' },
      { x: 20,                       y: window.innerHeight - 220, name: 'bottom-left' },
    ];
    // Score each by how much "noise" is at that point
    const scored = corners.map(c => {
      let score = 0;
      try {
        const el = document.elementFromPoint(c.x + 80, c.y + 60);
        if (el) {
          // Heavily penalize landing on interactive UI
          if (el.matches('button, input, textarea, a, [role="button"]')) score += 50;
          if (el.closest('.bottom-nav, .nx-tabbar, .nx-tr-fab, [data-overlay-active]')) score += 100;
          if (el.closest('header, nav, .masthead')) score += 30;
        }
      } catch (_) {}
      return { ...c, score };
    });
    scored.sort((a, b) => a.score - b.score);
    const target = scored[0];
    state.agentDomEl.style.position = 'fixed';
    state.agentDomEl.style.left   = target.x + 'px';
    state.agentDomEl.style.top    = target.y + 'px';
    state.agentDomEl.style.right  = 'auto';
    state.agentDomEl.style.bottom = 'auto';
    state.preferences.position_x = target.x;
    state.preferences.position_y = target.y;
    savePreferences();
  }


  // ─── Agent click handler — kept simple, just delegates to bubble ────
  function setupAgentInteractions() {
    // The actual handlers are on the hit-target overlay. This function
    // just kicks off the overlay creation and content-awareness watcher.
    ensureHitTarget();
    startContentAwareness();
  }

  function handleAgentClick() {
    state.preferences.total_clicks = (state.preferences.total_clicks || 0) + 1;
    const now = Date.now();
    state.rapidClicks = state.rapidClicks.filter(t => now - t < 1500);
    state.rapidClicks.push(now);
    if (state.rapidClicks.length >= 5) {
      state.rapidClicks = [];
      tryPlay('Surprised') || tryPlay('Sad');
      bubble(pickFromPool('5_clicks'));
      return;
    }
    if (state.preferences.total_clicks === 100 &&
        !(state.preferences.unlocked || []).includes('chef')) {
      state.preferences.unlocked = [...(state.preferences.unlocked || []), 'chef'];
      savePreferences();
      tryPlay('Congratulate');
      setCostume('chef', 8000);
      bubble(pickFromPool('100_clicks_unlock'));
      return;
    }
    savePreferences();

    // Pre-acceptance: clicking him is the handshake
    if (!state.enabled) {
      offerToJoin();
      return;
    }

    // If a bubble is already up (e.g. he was speaking), close it on click.
    // Two clicks in a row = "be quiet for a sec." Otherwise show the menu.
    if (state.bubble) {
      closeActionBubble();
      return;
    }

    // Open the "What's up?" mini-menu with dismiss options
    showWhatsUp();
  }

  // Quick "what's up" picker. Runs on every tap when enabled. Lightweight
  // alternative to the full command palette — the four options here cover
  // 90% of what users want: open the palette, say hi, hide for now,
  // permanently dismiss.
  function showWhatsUp() {
    actionBubble("what's up?", {
      actions: [
        { label: 'Open menu',   cls: 'is-primary', onClick: openPalette },
        { label: 'Just hi 👋',  onClick: () => { tryPlay('Wave'); bubble('hi!'); }},
        { label: 'Quiet, plz', onClick: hideForSession },
        { label: 'Send away',  cls: 'is-danger', onClick: declineToJoin },
      ]
    });
  }

  // Hide for the rest of this tab session — no preference change, no
  // comeback-rule penalty. He returns on next page load. Distinct from
  // declineToJoin (which is a sticky decline).
  function hideForSession() {
    if (state.agent) {
      try { state.agent.hide(); } catch (e) {}
    }
    state.enabled = false;  // local only — preference is unchanged
  }

  function tryPlay(animationName) {
    if (!state.agent) return false;
    try {
      state.agent.play(animationName);
      return true;
    } catch (e) { return false; }
  }
  function tryAnimate() {
    if (!state.agent) return;
    try { state.agent.animate(); } catch (e) {}
  }


  // ─── Speech: native bubble for plain text, custom for actions ───────
  function bubble(text) {
    if (!state.agent || !text) return;
    try { state.agent.speak(text); } catch (e) { console.warn(e); }
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
    // Hide while we calculate position (prevents flash at top-left of viewport
    // before first layout). Append, force layout, position, then reveal.
    el.style.visibility = 'hidden';
    ensureTopLayer().appendChild(el);
    state.bubble = el;

    // Position on next frame (after layout) and refresh for ~1s in case
    // the agent is still animating into place (peek animation, drag, etc.)
    let positionFrames = 0;
    function refreshPosition() {
      if (state.bubble !== el || !document.body.contains(el)) return;
      positionActionBubble(el);
      positionFrames++;
      if (positionFrames === 1) {
        // Reveal after first positioning
        el.style.visibility = '';
        el.classList.add('is-visible');
      }
      if (positionFrames < 60) {  // refresh for ~1 second (60fps)
        requestAnimationFrame(refreshPosition);
      }
    }
    requestAnimationFrame(refreshPosition);
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

  function positionActionBubble(el) {
    // Force layout flush
    void el.offsetHeight;
    const eRect = el.getBoundingClientRect();

    // If we have no agent, or the agent rect is degenerate, position
    // bubble in lower-right above where Clippy normally is
    let rect = state.agentDomEl ? state.agentDomEl.getBoundingClientRect() : null;
    if (!rect || rect.width === 0 || rect.height === 0) {
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


  // ─── Login peek REMOVED ─────────────────────────────────────────────
  // The legacy CSS-paperclip-eyes peek element is gone. We now boot
  // the real clippyjs Clippy on the PIN screen too — see init().
  async function offerToJoin() {
    // Make sure the agent is loaded (covers manual re-enable case)
    if (!state.agent) {
      try { await loadAgent(state.agentName || 'Clippy'); } catch (e) {}
    }
    tryPlay('Wave') || tryPlay('Show');
    setTimeout(offerToJoinBubble, 600);
  }
  function acceptToJoin() {
    state.preferences.enabled = true;
    state.preferences.reject_count = 0;
    state.preferences.session_count = (state.preferences.session_count || 0) + 1;
    savePreferences();
    state.enabled = true;
    // Clear peek — pop into full visibility
    if (state.agentDomEl) {
      state.agentDomEl.classList.remove('is-peeking', 'is-peek-entering');
    }
    tryPlay('Pleased');
    // Move to a good empty corner after the peek animation settles
    setTimeout(() => moveToEmptyCorner(), 900);
    setTimeout(() => bubble(pickFromPool('after_yes')), 1200);
    startRandomBehaviors();
    startMovingAround();
    afterJoinSchedule();
  }
  function declineToJoin() {
    state.preferences.enabled = false;
    state.preferences.reject_count = (state.preferences.reject_count || 0) + 1;
    state.preferences.last_seen_at = new Date().toISOString();
    savePreferences();
    state.enabled = false;
    bubble(pickFromPool('after_no'));
    setTimeout(() => {
      if (state.agent) { try { state.agent.hide(); } catch (e) {} }
    }, 2200);
  }


  // ─── Comeback rules ─────────────────────────────────────────────────
  function shouldShowComeback() {
    const p = state.preferences;
    if (p.enabled === true) return false;
    if (p.enabled === null) return true;
    if (p.reject_count >= 3) {
      if (!p.last_seen_at) return false;
      const daysSince = (Date.now() - new Date(p.last_seen_at)) / 86400000;
      return daysSince > 30;
    }
    if (!p.last_seen_at) return true;
    const daysSince = (Date.now() - new Date(p.last_seen_at)) / 86400000;
    const threshold = 3 + Math.floor(Math.random() * 5);
    return daysSince >= threshold;
  }


  // ─── Time-based pool selection ──────────────────────────────────────
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


  // ─── Random idle behaviors ──────────────────────────────────────────
  function startRandomBehaviors() {
    if (state.randomTimer) clearTimeout(state.randomTimer);
    function loop() {
      if (!state.enabled) return;
      if (!state.preferences.do_not_disturb && !state.bubble && Math.random() < 0.04) {
        const r = Math.random();
        if      (r < 0.30) bubble(pickFromPool('idle_random'));
        else if (r < 0.40) { tryPlay('Surprised'); bubble(pickFromPool('sneeze')); }
        else if (r < 0.50) bubble(pickFromPool('yawn'));
        else if (r < 0.65) tryAnimate();
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
    tryPlay('Explain') || tryPlay('Announce') || tryPlay('GetAttention');
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
    tryPlay('Sad') || tryPlay('CheckingSomething');
    actionBubble(pickFromPool('pick_trajan_warning'), {
      actions: [
        { label: 'Yes, Trajan', cls: 'is-warning-trajan', onClick: () => {
          bubble(pickFromPool('pick_trajan_confirmed'));
          setTimeout(() => handoffToBrain('trajan'), 1200);
        }},
        { label: 'Actually, no', onClick: () => {} },
      ]
    });
  }
  function handoffToBrain(persona) {
    state.preferences.preferred_persona = persona;
    savePreferences();
    if (window.NX && typeof NX.switchTo === 'function') {
      try { window.NX.preferredPersona = persona; } catch (e) {}
      NX.switchTo('brain');
    } else { console.warn('[clippy] NX.switchTo not available'); }
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
    tryPlay('Pleased');
  }
  function stopSong() {
    if (state.audio) { state.audio.pause(); state.audio.currentTime = 0; }
    state.audioPlaying = false;
  }
  function renderMusicPlayer() {
    return `
      <div class="clippy-music-player">
        <button class="clippy-music-btn" data-music-toggle aria-label="Play/pause">▶</button>
        <div class="clippy-music-progress"><div class="clippy-music-progress-fill" data-music-progress></div></div>
        <button class="clippy-music-btn" data-music-stop aria-label="Stop">■</button>
      </div>
    `;
  }
  function wireMusicPlayer(host) {
    const toggleBtn = host.querySelector('[data-music-toggle]');
    const stopBtn = host.querySelector('[data-music-stop]');
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
        { name: "Today's tasks", hint: "Open the cleaning checklist", icon: '✔', action: () => goView('clean') },
        { name: "Person filter", hint: "Switch whose view you see", icon: '👤', action: () => { goView('clean'); setTimeout(() => bubble(pickFromPool('discover_person_filter')), 600); }},
      ]},
      { section: 'Education', items: [
        { name: "Browse guides", hint: "How-to library", icon: '📖', action: () => goView('education') },
        { name: "Add a guide",   hint: "Create new how-to", icon: '＋', action: () => goView('education') },
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
        { name: "Meet my friends",            hint: "Switch to Bonzi, Merlin, Rover…", icon: '👥', action: () => { closePalette(); openAgentPicker(); }},
        { name: "Say something funny",        hint: "Random observation", icon: '💬', action: () => { closePalette(); bubble(pickFromPool('idle_random')); }},
        { name: "Wave at me",                 hint: "Just a wave", icon: '👋', action: () => { closePalette(); tryPlay('Wave'); }},
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
        <input class="clippy-palette-search" type="text" placeholder="Search… (try 'song', 'mop', 'PMs', 'friends')">
        <div class="clippy-palette-results"></div>
      </div>
    `;
    ensureTopLayer().appendChild(p);
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
    let html = '';
    let total = 0;
    sections.forEach(sec => {
      const items = sec.items.filter(it =>
        !q || it.name.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q));
      if (!items.length) return;
      total += items.length;
      html += `<div class="clippy-palette-section-label">${esc(sec.section)}</div>`;
      items.forEach((it, i) => {
        html += `
          <button class="clippy-palette-item" data-section="${esc(sec.section)}" data-idx="${i}">
            <div class="clippy-palette-item-icon">${esc(it.icon)}</div>
            <div class="clippy-palette-item-body">
              <div class="clippy-palette-item-name">${esc(it.name)}</div>
              <div class="clippy-palette-item-hint">${esc(it.hint)}</div>
            </div>
          </button>
        `;
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


  // ─── Agent picker ("Meet my friends") ───────────────────────────────
  function openAgentPicker() {
    if (state.palette) closePalette();
    const sheet = document.createElement('div');
    sheet.className = 'clippy-palette';
    sheet.innerHTML = `
      <div class="clippy-palette-bg"></div>
      <div class="clippy-palette-card">
        <div class="clippy-palette-head">
          <span class="clippy-palette-title">Meet my friends</span>
          <button class="clippy-palette-close" aria-label="Close">×</button>
        </div>
        <div class="clippy-palette-results">
          <div class="clippy-palette-section-label">Currently: ${esc(state.agentName)}</div>
          ${AVAILABLE_AGENTS.map(a => `
            <button class="clippy-palette-item" data-agent="${esc(a.key)}">
              <div class="clippy-palette-item-icon">${a.key === state.agentName ? '✔' : ' '}</div>
              <div class="clippy-palette-item-body">
                <div class="clippy-palette-item-name">${esc(a.label)}</div>
                <div class="clippy-palette-item-hint">${esc(a.hint)}</div>
              </div>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    ensureTopLayer().appendChild(sheet);
    state.palette = sheet;
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    sheet.querySelector('.clippy-palette-bg').addEventListener('click', closePalette);
    sheet.querySelector('.clippy-palette-close').addEventListener('click', closePalette);
    sheet.querySelectorAll('[data-agent]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.agent;
        closePalette();
        if (name === state.agentName) return;
        bubble(`switching to ${name}…`);
        await loadAgent(name);
        state.preferences.preferred_agent = name;
        savePreferences();
        tryPlay('Wave') || tryPlay('Show');
        setTimeout(() => bubble(`hi! it's me, ${name}.`), 800);
      });
    });
  }


  // ─── Konami / "hi clippy" listeners ─────────────────────────────────
  function wireGlobalListeners() {
    document.addEventListener('keydown', (e) => {
      state.konamiSeq.push(e.key);
      if (state.konamiSeq.length > KONAMI.length) state.konamiSeq.shift();
      if (state.konamiSeq.length === KONAMI.length &&
          state.konamiSeq.every((k, i) => k === KONAMI[i])) {
        state.konamiSeq = [];
        if (state.enabled) {
          tryPlay('DoMagic1') || tryPlay('GetWizardy') || tryPlay('Surprised');
          bubble(pickFromPool('konami_code'));
        }
      }
    });
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || typeof t.value !== 'string') return;
      const v = t.value.toLowerCase();
      // Summon trigger: works even when Clippy is hidden / disabled
      if (v.endsWith('hi clippy') || v.endsWith('clippy come back') || v.endsWith('come back clippy')) {
        if (!state.enabled || !state.agent) {
          summon();
        } else {
          tryPlay('Wave');
          bubble('hi!');
        }
      }
    });
  }


  // ─── Greetings ──────────────────────────────────────────────────────
  function afterJoinSchedule() {
    setTimeout(() => {
      if (!state.enabled || state.bubble) return;
      const dowKey = pickDayOfWeekPool();
      const todKey = pickTimeOfDayPool();
      const key = (dowKey && Math.random() < 0.4) ? dowKey : todKey;
      bubble(pickFromPool(key));
    }, 5000);
  }


  // ─── Init ───────────────────────────────────────────────────────────
  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    loadPoolHistory();
    await loadDialog();
    await loadPreferences();
    wireGlobalListeners();

    if (state.preferences.enabled === true) {
      // Already accepted — boot agent normally
      state.enabled = true;
      try {
        await loadAgent(state.agentName);
        // After login: settle into a good empty corner
        setTimeout(() => moveToEmptyCorner(), 800);
        tryPlay('Wave') || tryPlay('Show');
        startRandomBehaviors();
        startMovingAround();
        afterJoinSchedule();
      } catch (e) {
        console.error('[clippy] agent init failed:', e);
      }
    } else if (shouldShowComeback()) {
      // Pre-acceptance / comeback — boot the REAL clippyjs Clippy
      // and have him "peek" up from below the viewport: only his head
      // pokes above the screen edge. Tap him or "Yes!" to bring him in.
      try {
        await loadAgent(state.agentName || 'Clippy');
        // Apply peek-entering state (off-screen below) THEN peek
        if (state.agentDomEl) {
          state.agentDomEl.classList.add('is-peek-entering');
          // Clear any saved drag position during peek so he's at default
          state.agentDomEl.style.left = '';
          state.agentDomEl.style.top = '';
          state.agentDomEl.style.right = '';
          state.agentDomEl.style.bottom = '';
          requestAnimationFrame(() => {
            state.agentDomEl.classList.remove('is-peek-entering');
            state.agentDomEl.classList.add('is-peeking');
          });
        }
        tryPlay('Wave') || tryPlay('Show');
        // Brief pause so the peek-up animation lands first
        setTimeout(() => offerToJoinBubble(), 1300);
      } catch (e) {
        console.error('[clippy] pre-acceptance load failed:', e);
      }
    }
    // else: hidden silently (rejected too many times — comeback rules)
  }

  // Just the bubble offer — agent is already loaded by init() in
  // pre-acceptance mode.
  function offerToJoinBubble() {
    actionBubble(pickFromPool('login_peek'), {
      actions: [
        { label: 'Yes!',      cls: 'is-primary', onClick: acceptToJoin },
        { label: 'Not today', onClick: declineToJoin },
      ]
    });
  }


  // ─── Public API ─────────────────────────────────────────────────────
  function notifyTaskCompleted() {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    if (Math.random() < 0.6) {
      tryPlay('Pleased');
      bubble(pickFromPool('task_completed'));
    }
  }
  function notifyStreak(days) {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    tryPlay('Congratulate') || tryPlay('Pleased');
    actionBubble(fmt(pickFromPool('streak_milestone'), { N: days }), { duration: 4500 });
  }
  function notifyOverdueDetected() {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    if (Math.random() > 0.4) return;
    tryPlay('Sad') || tryPlay('Alert');
    bubble(pickFromPool('task_overdue_passive'));
  }
  function checkForStress(metrics) {
    if (!state.enabled || state.preferences.do_not_disturb) return;
    if (Date.now() < state.songCooldownAt) return;
    const stressed = (metrics && (metrics.overdueCount >= 3 || metrics.sessionMinutes >= 120));
    if (stressed) offerSong('stressed');
  }
  function addTrajanQuote(q) { if (q) state.quoteCorpus.push(q); }
  function gestureAt(x, y) {
    if (state.agent) { try { state.agent.gestureAt(x, y); } catch (e) {} }
  }
  function moveTo(x, y) {
    if (state.agent) { try { state.agent.moveTo(x, y); } catch (e) {} }
  }

  // Summon — force Clippy to appear, regardless of stored preferences.
  // Useful when he's been dismissed and you want him back manually.
  // Resets reject_count and sets enabled=true. Available as
  // NX.clippy.summon() in the console or as a menu action. Also fires
  // when the user types "hi clippy" or "clippy come back" in any input.
  async function summon() {
    state.preferences.enabled = true;
    state.preferences.reject_count = 0;
    state.preferences.last_seen_at = new Date().toISOString();
    state.preferences.session_count = (state.preferences.session_count || 0) + 1;
    await savePreferences();
    state.enabled = true;
    if (!state.agent) {
      try { await loadAgent(state.agentName || 'Clippy'); }
      catch (e) { console.error('[clippy] summon load failed:', e); return; }
    } else {
      try { state.agent.show(); } catch (e) {}
    }
    tryPlay('Wave') || tryPlay('Show') || tryPlay('Greet');
    setTimeout(() => bubble("hi! i'm back."), 700);
    if (!state.randomTimer) startRandomBehaviors();
  }

  if (!window.NX) window.NX = {};
  NX.clippy = {
    init,
    bubble,
    actionBubble,
    play: tryPlay,
    notifyTaskCompleted,
    notifyStreak,
    notifyOverdueDetected,
    checkForStress,
    onViewChange: () => {},
    addTrajanQuote,
    offerBrain,
    offerSong,
    openPalette,
    setCostume,
    gestureAt,
    moveTo,
    moveToEmptyCorner,            // Find an unobtrusive corner and go there
    switchAgent: loadAgent,
    summon,                    // Force-show, ignoring prefs. NX.clippy.summon()
    enable: () => { state.preferences.enabled = true; savePreferences(); init(); },
    disable: declineToJoin,
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
