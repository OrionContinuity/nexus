/* ════════════════════════════════════════════════════════════════════
   NEXUS PREFERENCES — unified user_preferences layer
   --------------------------------------------------------------------
   One source of truth for: persona, theme, tone, voice_idx, language.
   Backed by Supabase user_preferences table (per-user-per-device).
   localStorage acts as a write-through cache for offline + first-paint.

   Public API:
     await NX.prefs.init()              → load or create row on login
     NX.prefs.persona()                  → 'providentia' | 'trajan'
     NX.prefs.theme()                    → 'auto' | 'dark' | 'light'
     NX.prefs.effectiveTheme()           → 'dark' | 'light' (resolves auto)
     NX.prefs.tone()                     → 'default' | 'concise' | 'warm' | 'technical'
     NX.prefs.voiceIdx()                 → integer
     NX.prefs.language()                 → 'en' | 'es'
     await NX.prefs.set({ ...changes })  → DB-write + event broadcast
     NX.prefs.openSheet()                → bottom-sheet UI
     NX.prefs.closeSheet()               → close it

   Events fired on document:
     'nx-prefs-change'  detail: { changes, prev, next }
     'nx-theme-change'  detail: { theme }            (effective theme)
     'nx-persona-change' is fired by app.js setActivePersona — preserved
   ════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  const DEFAULTS = {
    persona:   'providentia',
    theme:     'auto',
    tone:      'default',
    voice_idx: 0,
    language:  'en',
  };

  // ─── DEVICE ID ─────────────────────────────────────────────────────
  // Stable per-browser identifier so prefs are scoped correctly when
  // multiple staff share a device. Generated once, persisted forever.
  function getDeviceId(){
    let id = localStorage.getItem('nexus_device_id');
    if (!id) {
      id = (window.crypto && crypto.randomUUID && crypto.randomUUID())
        || ('s_' + Date.now() + '_' + Math.random().toString(36).slice(2));
      localStorage.setItem('nexus_device_id', id);
    }
    return id;
  }

  // ─── STATE ─────────────────────────────────────────────────────────
  const state = {
    data: null,           // current row from DB (or DEFAULTS if not loaded)
    initialized: false,
    deviceId: getDeviceId(),
  };

  // ─── INIT ──────────────────────────────────────────────────────────
  // Called from app.js after login. Reads existing row or creates one
  // with defaults via the get_user_preferences RPC. Then migrates any
  // legacy localStorage values into the row on first run.
  async function init(){
    if (state.initialized) return state.data;
    if (!window.NX || !NX.sb || !NX.currentUser || NX.currentUser.id == null) {
      // Pre-login or missing supabase — fall back to localStorage cache
      hydrateFromLocalStorage();
      return state.data;
    }
    const userId = NX.currentUser.id;
    try {
      const { data, error } = await NX.sb.rpc('get_user_preferences', {
        p_user_id: userId,
        p_device_id: state.deviceId,
      });
      if (error) throw error;
      state.data = data || { ...DEFAULTS };
      state.initialized = true;
      writeLocalStorageMirror(state.data);
      // First-load migration: pull any legacy localStorage values that
      // aren't represented in DB (e.g. user changed theme before this
      // table existed) and push them up. Only runs once per device.
      await migrateLegacyOnce();
      // Apply theme on init so first paint matches DB state
      applyEffectiveTheme(false);
      return state.data;
    } catch (e) {
      console.warn('[prefs] init failed, using local fallback:', e.message);
      hydrateFromLocalStorage();
      return state.data;
    }
  }

  function hydrateFromLocalStorage(){
    state.data = {
      persona:   localStorage.getItem('nexus_active_persona') || DEFAULTS.persona,
      theme:     localStorage.getItem('nexus_theme_pref')     || DEFAULTS.theme,
      tone:      localStorage.getItem('nexus_tone')           || DEFAULTS.tone,
      voice_idx: parseInt(localStorage.getItem('nexus_voice_idx') || '0', 10) || 0,
      language:  localStorage.getItem('nexus_lang')           || DEFAULTS.language,
    };
  }

  function writeLocalStorageMirror(d){
    if (!d) return;
    try {
      localStorage.setItem('nexus_active_persona', d.persona);
      localStorage.setItem('nexus_theme_pref',     d.theme);
      localStorage.setItem('nexus_tone',           d.tone);
      localStorage.setItem('nexus_voice_idx',      String(d.voice_idx ?? 0));
      localStorage.setItem('nexus_lang',           d.language);
    } catch(_) {}
  }

  // ─── LEGACY MIGRATION ──────────────────────────────────────────────
  // Move pre-table localStorage values into Supabase exactly once. Sets
  // a sentinel so we don't keep migrating on every login.
  async function migrateLegacyOnce(){
    const SENTINEL = 'nexus_prefs_migrated_v1';
    if (localStorage.getItem(SENTINEL)) return;
    const changes = {};
    const legacyTheme = localStorage.getItem('nexus_theme'); // OLD key, just dark|light
    const legacyVoice = localStorage.getItem('nexus_voice_idx');
    const legacyLang  = localStorage.getItem('nexus_lang');
    const legacyTone  = localStorage.getItem('nx_chat_tone'); // chat-view's key
    // Old theme key was binary; map to explicit dark/light (not auto, since
    // user had clearly chosen one). DB row exists already, so only migrate
    // values we don't have yet.
    if (legacyTheme && state.data.theme === 'auto'
        && (legacyTheme === 'dark' || legacyTheme === 'light')) {
      changes.theme = legacyTheme;
    }
    if (legacyVoice && (state.data.voice_idx == null || state.data.voice_idx === 0)) {
      const n = parseInt(legacyVoice, 10);
      if (!isNaN(n) && n >= 0) changes.voice_idx = n;
    }
    if (legacyLang && state.data.language === 'en'
        && (legacyLang === 'en' || legacyLang === 'es')) {
      changes.language = legacyLang;
    }
    if (legacyTone && state.data.tone === 'default'
        && ['default','concise','warm','technical'].includes(legacyTone)) {
      changes.tone = legacyTone;
    }
    if (Object.keys(changes).length) {
      await set(changes, { silent: true });
      console.log('[prefs] migrated legacy values:', changes);
    }
    try { localStorage.setItem(SENTINEL, '1'); } catch(_) {}
  }

  // ─── READS ─────────────────────────────────────────────────────────
  function persona(){ return state.data?.persona || DEFAULTS.persona; }
  function theme(){ return state.data?.theme || DEFAULTS.theme; }
  function tone(){ return state.data?.tone || DEFAULTS.tone; }
  function voiceIdx(){ return state.data?.voice_idx ?? DEFAULTS.voice_idx; }
  function language(){ return state.data?.language || DEFAULTS.language; }
  // Resolves 'auto' to a concrete theme based on persona. This is the
  // value to feed the [data-theme] attribute on <html>.
  //
  // Mapping (after inversion): Trajan = light, Providentia = dark.
  // The reasoning: Trajan is the cold emperor of decisive action — his
  // light/parchment world reads as daylit ledgers and signed orders.
  // Providentia is the patient advisor of foresight — her dark/charcoal
  // world reads as nightwatch and counsel by lamplight.
  function effectiveTheme(){
    const t = theme();
    if (t === 'dark' || t === 'light') return t;
    return persona() === 'trajan' ? 'light' : 'dark';
  }

  // ─── WRITE ─────────────────────────────────────────────────────────
  // Single entry point for ALL preference changes. Persists to Supabase,
  // updates in-memory cache, mirrors to localStorage, dispatches events.
  async function set(changes, opts){
    if (!changes || typeof changes !== 'object') return;
    const o = opts || {};
    const prev = { ...state.data };
    // Optimistic local apply so UI updates immediately
    state.data = { ...state.data, ...changes };
    writeLocalStorageMirror(state.data);

    // Theme/persona side-effects fire IMMEDIATELY for crisp UX. The
    // DB write is fire-and-forget — if it fails, local state stays
    // and we'll retry on next change. That's fine for this layer.
    const themeChanged = ('theme' in changes) || ('persona' in changes && theme() === 'auto');
    if (themeChanged) applyEffectiveTheme(o.animated !== false);

    // Persist to Supabase if we have a session
    if (state.initialized && NX.sb && NX.currentUser && NX.currentUser.id != null) {
      try {
        const { error } = await NX.sb.rpc('upsert_user_preferences', {
          p_user_id:   NX.currentUser.id,
          p_device_id: state.deviceId,
          p_changes:   changes,
        });
        if (error) console.warn('[prefs] upsert error:', error.message);
      } catch (e) {
        console.warn('[prefs] upsert exception:', e.message);
      }
    }

    if (!o.silent) {
      try {
        document.dispatchEvent(new CustomEvent('nx-prefs-change', {
          detail: { changes, prev, next: { ...state.data } }
        }));
      } catch(_) {}
    }
    return state.data;
  }

  // ─── THEME APPLICATION ─────────────────────────────────────────────
  // Sets [data-theme] on <html> and toggles a transitioning class for
  // ~700ms so all CSS-variable-driven backgrounds, borders, shadows
  // cross-fade in lockstep. The class is auto-removed.
  let _themeFadeTimer = null;
  function applyEffectiveTheme(animated){
    // Theme follows the active persona's coin at all times — including
    // the PIN screen. Default persona is Providentia (= dark), so a
    // fresh login still feels editorial / official by default. But a
    // returning user who prefers Trajan will see the light/parchment
    // PIN screen consistent with their advisor.
    //
    // Earlier code force-painted dark on PIN regardless of preference.
    // That made theme switching feel broken (and also broke the visual
    // "this is YOUR app" continuity from the moment you tap to login).
    const next = effectiveTheme();
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    if (prev === next) return;
    if (animated) {
      root.classList.add('theme-transitioning');
      clearTimeout(_themeFadeTimer);
      _themeFadeTimer = setTimeout(() => {
        root.classList.remove('theme-transitioning');
      }, 750);
    }
    root.setAttribute('data-theme', next);
    try {
      document.dispatchEvent(new CustomEvent('nx-theme-change', { detail: { theme: next } }));
    } catch(_) {}
  }

  // ─── CINEMATIC COIN FLIP ───────────────────────────────────────────
  // Triggers the spinning coin animation + theme cross-fade together.
  // Called by setActivePersona when the user taps the masthead coin
  // OR taps the persona selector in the Preferences sheet.
  //
  // The classList.remove + reflow + add pattern alone is not enough on
  // first invocation: the base `.nx-mast-coin` rule in nx-system.css
  // already has `animation: nxMastCoinGreet 1.4s ...` set, and some
  // browsers (notably iOS WebKit) do not restart an animation when only
  // the animation-name changes via class addition. The fix is to
  // explicitly null out the `animation` property via inline style,
  // force a reflow, then clear the inline override and add the class.
  // This guarantees a clean restart every single time.
  function _restartAnimation(el, className){
    if (!el) return;
    el.classList.remove(className);
    el.style.animation = 'none';
    void el.offsetWidth;        // force reflow
    el.style.animation = '';    // clear inline override; class rule takes over
    el.classList.add(className);
  }

  function playCinematicFlip(){
    const coin = document.getElementById('mastCoin');
    const personaLabel = document.getElementById('mastPersona');
    if (coin) {
      _restartAnimation(coin, 'cinematic-flip');
      setTimeout(() => coin.classList.remove('cinematic-flip'), 750);
    }
    if (personaLabel) {
      _restartAnimation(personaLabel, 'persona-glitch');
      setTimeout(() => personaLabel.classList.remove('persona-glitch'), 700);
    }
  }

  // ─── PREFERENCES SHEET (UI) ────────────────────────────────────────
  // Bottom-sheet modal with sections for advisor, theme, tone, voice,
  // language. Renders on first open, re-renders on every state change
  // so toggles always reflect current values.
  let sheetEl = null, scrimEl = null;

  function ensureSheet(){
    if (sheetEl) return;
    scrimEl = document.createElement('div');
    scrimEl.className = 'prefs-scrim';
    scrimEl.id = 'prefsScrim';
    scrimEl.addEventListener('click', closeSheet);
    document.body.appendChild(scrimEl);

    sheetEl = document.createElement('div');
    sheetEl.className = 'prefs-sheet';
    sheetEl.id = 'prefsSheet';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-label', 'Preferences');
    document.body.appendChild(sheetEl);
    document.addEventListener('nx-prefs-change', () => {
      if (sheetEl.classList.contains('is-open')) renderSheet();
    });
    document.addEventListener('nx-persona-change', () => {
      if (sheetEl.classList.contains('is-open')) renderSheet();
    });
  }

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function renderSheet(){
    const p = persona(), t = theme(), tn = tone(), lg = language();
    const voices = (window.NX && Array.isArray(NX.VOICES) && NX.VOICES.length)
      ? NX.VOICES
      : [{ name: '—' }];
    const vIdx = voiceIdx();
    const safeIdx = ((vIdx % voices.length) + voices.length) % voices.length;
    const activeVoice = voices[safeIdx]?.name || '—';

    sheetEl.innerHTML = `
      <div class="prefs-grip"></div>
      <h3 class="prefs-h">Preferences</h3>

      <div class="prefs-section">
        <div class="prefs-section-title">Advisor</div>
        <div class="prefs-persona-row">
          <button class="prefs-persona-btn ${p==='providentia'?'is-active':''}" data-persona="providentia" type="button">
            <span class="prefs-persona-name">PROVIDENTIA</span>
            <span class="prefs-persona-sub">Foresight · advisor</span>
          </button>
          <button class="prefs-persona-btn ${p==='trajan'?'is-active':''}" data-persona="trajan" type="button">
            <span class="prefs-persona-name">TRAJAN</span>
            <span class="prefs-persona-sub">Emperor · decisive</span>
          </button>
        </div>
      </div>

      <div class="prefs-section">
        <div class="prefs-section-title">Theme</div>
        <div class="prefs-theme-row">
          <button class="prefs-theme-btn ${t==='auto'?'is-active':''}" data-theme="auto" type="button">
            <span class="prefs-theme-name">Auto</span>
            <span class="prefs-theme-sub">Follows advisor</span>
          </button>
          <button class="prefs-theme-btn ${t==='dark'?'is-active':''}" data-theme="dark" type="button">
            <span class="prefs-theme-name">Dark</span>
          </button>
          <button class="prefs-theme-btn ${t==='light'?'is-active':''}" data-theme="light" type="button">
            <span class="prefs-theme-name">Light</span>
          </button>
        </div>
      </div>

      <div class="prefs-section">
        <div class="prefs-section-title">Text tone</div>
        <div class="prefs-tone-row">
          ${['default','concise','warm','technical'].map(k => `
            <button class="prefs-tone-btn ${tn===k?'is-active':''}" data-tone="${k}" type="button">${esc(k.charAt(0).toUpperCase()+k.slice(1))}</button>
          `).join('')}
        </div>
      </div>

      <div class="prefs-section">
        <div class="prefs-section-title">Voice <span class="prefs-section-meta">— ${esc(activeVoice)}</span></div>
        <button class="prefs-voice-open" id="prefsVoiceOpen" type="button">Change voice…</button>
      </div>

      <div class="prefs-section">
        <div class="prefs-section-title">Language</div>
        <div class="prefs-lang-row">
          <button class="prefs-lang-btn ${lg==='en'?'is-active':''}" data-lang="en" type="button">English</button>
          <button class="prefs-lang-btn ${lg==='es'?'is-active':''}" data-lang="es" type="button">Español</button>
        </div>
      </div>

      <button class="prefs-close" id="prefsClose" type="button">Done</button>
    `;

    // Wire up handlers
    sheetEl.querySelectorAll('.prefs-persona-btn').forEach(b => {
      b.addEventListener('click', () => {
        const next = b.dataset.persona;
        if (next === persona()) return;
        // Use NX.setActivePersona which fires the cinematic flip via
        // its own listener (and writes to user_preferences via prefs.set)
        if (NX.setActivePersona) NX.setActivePersona(next, { animated: true });
        else set({ persona: next });
      });
    });
    sheetEl.querySelectorAll('.prefs-theme-btn').forEach(b => {
      b.addEventListener('click', () => {
        const next = b.dataset.theme;
        if (next === theme()) return;
        // Snappy cross-fade for explicit theme override (vs cinematic
        // for persona-driven theme change)
        set({ theme: next }, { animated: true });
      });
    });
    sheetEl.querySelectorAll('.prefs-tone-btn').forEach(b => {
      b.addEventListener('click', () => {
        const next = b.dataset.tone;
        set({ tone: next });
        // Update legacy global so brain-chat's getPERSONA picks it up immediately
        try { window._NX_PERSONA_SUFFIX = getToneSuffix(next); } catch(_) {}
      });
    });
    sheetEl.querySelectorAll('.prefs-lang-btn').forEach(b => {
      b.addEventListener('click', () => {
        const next = b.dataset.lang;
        set({ language: next });
        if (NX.i18n && NX.i18n.setLang) NX.i18n.setLang(next);
      });
    });
    sheetEl.querySelector('#prefsVoiceOpen')?.addEventListener('click', () => {
      // Defer to chat-view's existing voice picker if available; falls
      // back to admin's voice select. Either way, the user_preferences
      // table picks up the change via the nx-voice-idx-change listener
      // installed in init().
      closeSheet();
      if (window.chatview && chatview.openPersonaSheet) chatview.openPersonaSheet();
      else if (NX.openVoicePicker) NX.openVoicePicker();
      else NX.toast?.('Voice picker unavailable in this view', 'info');
    });
    sheetEl.querySelector('#prefsClose').addEventListener('click', closeSheet);
  }

  // Same TONE_PRESETS shape as chat-view.js — mirrored here so prefs
  // can update _NX_PERSONA_SUFFIX without depending on chat-view being
  // loaded. Keep in sync if chat-view's TONE_PRESETS change.
  function getToneSuffix(toneKey){
    const m = {
      default: '',
      concise: '\n\nTONE OVERRIDE: Be extremely concise. Answer in ONE sentence unless the question genuinely requires more. No preamble. Get straight to the point.',
      warm:    '\n\nTONE OVERRIDE: Warmer and a bit more conversational. Still concise but allow a touch of personality. Never more than 3 sentences.',
      technical: '\n\nTONE OVERRIDE: Technical and precise. Lead with facts, specs, part numbers, dates. No hedging. If you don\'t know, say so briefly.',
    };
    return m[toneKey] || '';
  }

  function openSheet(){
    ensureSheet();
    renderSheet();
    requestAnimationFrame(() => {
      sheetEl.classList.add('is-open');
      scrimEl.classList.add('is-open');
    });
  }

  function closeSheet(){
    if (!sheetEl) return;
    sheetEl.classList.remove('is-open');
    scrimEl.classList.remove('is-open');
  }

  // ─── VOICE-IDX SYNC ────────────────────────────────────────────────
  // chat-view.js writes to localStorage('nexus_voice_idx') and dispatches
  // 'nx-voice-idx-change' on `window` (not document). Mirror that into
  // user_preferences so the table stays authoritative across devices.
  // Listener target MUST match dispatch target — events on window do
  // not bubble through document by default for custom events.
  window.addEventListener('nx-voice-idx-change', (e) => {
    const idx = e?.detail?.idx;
    if (typeof idx !== 'number') return;
    if (idx === voiceIdx()) return;
    set({ voice_idx: idx }, { silent: false });
  });

  // ─── TONE SYNC (legacy compat) ─────────────────────────────────────
  // chat-view.js uses localStorage('nx_chat_tone') for tone. Preferences
  // uses 'nexus_tone'. Two keys, one setting. We mirror tone changes
  // from prefs INTO chat-view's key so chat-view reads the correct
  // value on init, AND we listen for chat-view's writes so user picks
  // there flow through to user_preferences. Single source of truth in
  // the DB, two cache mirrors for backward compat.
  document.addEventListener('nx-prefs-change', (e) => {
    const changes = e?.detail?.changes || {};
    if ('tone' in changes) {
      try { localStorage.setItem('nx_chat_tone', changes.tone); } catch(_) {}
    }
  });
  // chat-view doesn't dispatch a tone event — it just writes localStorage
  // and updates _NX_PERSONA_SUFFIX. We poll the localStorage key once
  // per second for change detection; cheap and avoids rewriting chat-view.
  // (A dispatch from chat-view would be cleaner — flagged for next pass.)
  let _lastSeenTone = localStorage.getItem('nx_chat_tone');
  setInterval(() => {
    const cur = localStorage.getItem('nx_chat_tone');
    if (cur && cur !== _lastSeenTone && cur !== tone()) {
      _lastSeenTone = cur;
      set({ tone: cur }, { silent: false });
    }
  }, 1000);

  // ─── EXPORT ────────────────────────────────────────────────────────
  window.NX = window.NX || {};
  NX.prefs = {
    init,
    getDeviceId: () => state.deviceId,
    persona, theme, effectiveTheme, tone, voiceIdx, language,
    set,
    openSheet, closeSheet,
    applyEffectiveTheme,
    playCinematicFlip,
  };

  console.log('[prefs] module loaded; deviceId=', state.deviceId.slice(0, 8) + '…');
})();
