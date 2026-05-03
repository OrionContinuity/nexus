/* ═══════════════════════════════════════════════════════════════════════
   NEXUS Chat View — Stage B
   
   Full-screen chat that takes over when user taps "Ask NEXUS" from the
   home dashboard (or hits `/` as a keyboard shortcut).
   
   IMPORTANT — architectural decision:
     This module does NOT reimplement the chat AI logic. It's purely UI.
     All AI intelligence (RAG, tool use, persona, ReAct loop) stays in
     brain-chat.js. We reuse it by:
       - Mounting our new input with id="chatInput" + send with id="chatSend"
       - Mounting our transcript container with id="chatMessages"
       - Letting the existing addB() function find these IDs and render
         messages into them (addB queries by getElementById).
     
     When the chat view closes, we pop our IDs off those elements and let
     the legacy HUD reclaim them if needed. The legacy chat-hud is hidden
     via body.chatview-open class while our view is active.
   
   This "ID handoff" pattern means:
     ✓ Zero duplication of askAI/tool logic
     ✓ Voice/camera/mic buttons still work (they bind to element IDs)
     ✓ Chat history persistence (chat_history + session_id) continues
     ✓ Persona + confidence + all ReAct reasoning preserved
     
     But we get the new look: transcript turns instead of bubbles,
     proper typography, conversation history, persona sheet.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const TONE_PRESETS = {
    default: {
      label: 'Default',
      desc: 'Calm, warm, a little dry',
      suffix: '',
    },
    concise: {
      label: 'Concise',
      desc: 'Tight. One sentence answers',
      suffix:
        '\n\nTONE OVERRIDE: Be extremely concise. Answer in ONE sentence unless the question genuinely requires more. No preamble. Get straight to the point.',
    },
    warm: {
      label: 'Warm',
      desc: 'Conversational, friendlier',
      suffix:
        '\n\nTONE OVERRIDE: Warmer and a bit more conversational. Still concise but allow a touch of personality. Never more than 3 sentences.',
    },
    technical: {
      label: 'Technical',
      desc: 'Precise, specs & numbers first',
      suffix:
        '\n\nTONE OVERRIDE: Technical and precise. Lead with facts, specs, part numbers, dates. No hedging. If you don\'t know, say so briefly.',
    },
  };

  // Single source of truth is brain-chat.js → NX.VOICES (20 voices).
  // This getter reads dynamically so if brain-chat hasn't finished
  // registering yet on first render, we still get the latest list on
  // re-render (which happens on persona-sheet open). Fallback is a
  // minimal 4-voice list that matches brain-chat ordering, so even
  // if the main list fails to load, picking voice idx 0 still plays
  // Charlotte (not a silently-wrong voice).
  const VOICES_FALLBACK = [
    { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', desc: 'Smart & smooth' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',     desc: 'Warm & witty'  },
    { id: 'jsCqWAovK2LkecY7zXl4', name: 'Freya',     desc: 'Breathy & warm' },
    { id: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace',     desc: 'Southern elegance' },
  ];
  function getVoices() {
    return (window.NX && Array.isArray(NX.VOICES) && NX.VOICES.length)
      ? NX.VOICES
      : VOICES_FALLBACK;
  }

  const ICONS = {
    back:       '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    menu:       '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
    // Clock-history icon — used in the top bar for "past conversations".
    // More legible than ≡ for this purpose; users now see a clock face
    // and know "this is where my previous chats are."
    history:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    plus:       '<path d="M5 12h14"/><path d="M12 5v14"/>',
    send:       '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4z"/>',
    camera:     '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    mic:        '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    volume:     '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    volumeOff:  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
    newChat:    '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  };
  const svg = (p, size = 18) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}">${p}</svg>`;

  /* ═════════════════════════════════════════════════════════════════
     STATE
     ═════════════════════════════════════════════════════════════════ */
  const state = {
    isOpen: false,
    currentSessionId: null,
    tone: localStorage.getItem('nx_chat_tone') || 'default',
    voiceIdx: parseInt(localStorage.getItem('nexus_voice_idx') || '0') || 0,
    voiceOn: localStorage.getItem('nx_voice_on') !== '0',
    sessions: [],
    plusOpen: false,
    recording: false,
  };

  let built = false;
  let rootEl, transcriptEl, inputEl, sendEl, drawerEl, personaSheetEl;

  /* ═════════════════════════════════════════════════════════════════
     PUBLIC API (what home.js + anywhere else calls)
     ═════════════════════════════════════════════════════════════════ */
  const chatview = {
    open(opts = {}) {
      if (!built) build();
      // Claim the chat IDs — brain-chat.js binds to these.
      claimIds();
      document.body.classList.add('chatview-open');
      rootEl.classList.add('open');
      state.isOpen = true;
      // Load most recent session into the transcript
      if (!state.currentSessionId) {
        state.currentSessionId = getActiveSessionId();
      }
      this.renderTranscript();
      // Fetch session list in background for the drawer
      loadSessions();
      // Autofocus input unless user came via a specific flow
      if (!opts.noFocus) {
        setTimeout(() => inputEl?.focus(), 320);
      }
    },

    close() {
      if (!state.isOpen) return;
      rootEl.classList.remove('open');
      document.body.classList.remove('chatview-open');
      closePlusMenu();
      state.isOpen = false;
      // Release IDs back so legacy HUD can reclaim them if user goes to brain view
      releaseIds();
    },

    toggle() { state.isOpen ? this.close() : this.open(); },

    renderTranscript() {
      if (!transcriptEl) return;
      // Brain-chat.js renders via addB() into #chatMessages. We host that
      // container inside .cv-transcript-inner. On open, re-hydrate from
      // chat_history for this session so conversations persist.
      const holder = transcriptEl.querySelector('#chatMessages');
      if (!holder) return;
      holder.innerHTML = '';
      hydrateSession(state.currentSessionId).then(turns => {
        if (!turns.length) {
          renderEmptyState(holder);
        } else {
          renderTurns(holder, turns);
        }
        scrollToBottom();
      });
    },

    setPersona(toneKey) {
      state.tone = toneKey;
      localStorage.setItem('nx_chat_tone', toneKey);
      // Expose so brain-chat.js can read when building persona
      window._NX_PERSONA_SUFFIX = TONE_PRESETS[toneKey]?.suffix || '';
    },
  };

  // Make persona suffix available immediately (even before chat is opened)
  window._NX_PERSONA_SUFFIX = TONE_PRESETS[state.tone]?.suffix || '';

  NX.chatview = chatview;

  /* ═════════════════════════════════════════════════════════════════
     BUILD — mount DOM lazily on first open
     ═════════════════════════════════════════════════════════════════ */
  function build() {
    rootEl = document.createElement('div');
    rootEl.className = 'chatview';
    rootEl.innerHTML = `
      <div class="cv-top">
        <button class="cv-back" id="cvBack" aria-label="Back">${svg(ICONS.back)}</button>
        <div class="cv-brand" id="cvBrand" title="Tone & voice settings">
          <span class="cv-brand-galaxy" id="cvBrandGalaxy">
            <canvas width="36" height="36"></canvas>
          </span>
          <span class="cv-brand-mark">NEXUS</span>
        </div>
        <button class="cv-icon-btn cv-voice-toggle ${state.voiceOn ? 'is-on' : 'is-off'}" id="cvVoiceToggle" aria-label="${state.voiceOn ? 'Mute voice replies' : 'Unmute voice replies'}" title="${state.voiceOn ? 'Voice on — tap to mute' : 'Muted — tap to unmute'}" type="button">${svg(state.voiceOn ? ICONS.volume : ICONS.volumeOff)}</button>
        <button class="cv-icon-btn" id="cvMenu" aria-label="Past conversations" title="Past conversations">${svg(ICONS.history)}</button>
      </div>

      <div class="cv-transcript" id="cvTranscript">
        <div class="cv-transcript-inner">
          <div id="chatMessages"></div>
        </div>
      </div>

      <div class="cv-input-wrap">
        <div class="cv-input-wrap-inner">
          <button class="cv-plus" id="cvPlus" aria-label="More" type="button">${svg(ICONS.plus)}</button>
          <div class="cv-plus-menu" id="cvPlusMenu" role="menu"></div>
          <textarea class="cv-input" id="chatInput" rows="1"
            placeholder="Ask anything…" aria-label="Message"
            autocomplete="off" data-lpignore="true" data-form-type="other"></textarea>
          <button class="cv-mic" id="cvMicBtn" aria-label="Speak to NEXUS" title="Speak to NEXUS" type="button">${svg(ICONS.mic, 16)}</button>
          <button class="cv-send" id="chatSend" disabled aria-label="Send" type="button">${svg(ICONS.send, 16)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(rootEl);

    // Drawer (conversations)
    const scrim = document.createElement('div');
    scrim.className = 'cv-drawer-scrim';
    scrim.id = 'cvDrawerScrim';
    document.body.appendChild(scrim);

    drawerEl = document.createElement('aside');
    drawerEl.className = 'cv-drawer';
    drawerEl.id = 'cvDrawer';
    drawerEl.innerHTML = `
      <div class="cv-drawer-header">
        <div class="cv-drawer-title">Conversations</div>
        <button class="cv-icon-btn" id="cvDrawerClose" aria-label="Close">${svg(ICONS.back, 18)}</button>
      </div>
      <button class="cv-drawer-new" id="cvDrawerNew">
        ${svg(ICONS.newChat, 14)} New conversation
      </button>
      <div class="cv-drawer-list" id="cvDrawerList"></div>
    `;
    document.body.appendChild(drawerEl);

    // Persona sheet
    const psScrim = document.createElement('div');
    psScrim.className = 'cv-persona-scrim';
    psScrim.id = 'cvPersonaScrim';
    document.body.appendChild(psScrim);

    personaSheetEl = document.createElement('div');
    personaSheetEl.className = 'cv-persona-sheet';
    personaSheetEl.id = 'cvPersonaSheet';
    document.body.appendChild(personaSheetEl);

    // Cache refs
    transcriptEl = rootEl.querySelector('#cvTranscript');
    inputEl = rootEl.querySelector('#chatInput');
    sendEl = rootEl.querySelector('#chatSend');

    wireTopBar();
    wireInput();
    wirePlusMenu();
    wireDrawer(scrim);
    wirePersonaSheet(psScrim);
    wireBrandGalaxy();
    wireKeyboardShortcuts();

    built = true;
  }

  /* ═════════════════════════════════════════════════════════════════
     ID CLAIM/RELEASE
     ═════════════════════════════════════════════════════════════════ */
  function claimIds() {
    // Find the legacy HUD's inputs — if they still hold these IDs,
    // rename them so ours win getElementById(). This lets brain-chat.js
    // addB() write into OUR transcript and voice/camera buttons keep
    // working because they bind by ID at setup time (already bound).
    const legacyInput = document.querySelector('.hud-input #chatInput');
    const legacySend = document.querySelector('.hud-input #chatSend');
    const legacyMessages = document.querySelector('.chat-hud #chatMessages');
    if (legacyInput && legacyInput !== inputEl) legacyInput.id = 'legacyChatInput';
    if (legacySend && legacySend !== sendEl) legacySend.id = 'legacyChatSend';
    if (legacyMessages) legacyMessages.id = 'legacyChatMessages';
  }

  function releaseIds() {
    const legacyInput = document.getElementById('legacyChatInput');
    const legacySend = document.getElementById('legacyChatSend');
    const legacyMessages = document.getElementById('legacyChatMessages');
    if (legacyInput) legacyInput.id = 'chatInput';
    if (legacySend) legacySend.id = 'chatSend';
    if (legacyMessages) legacyMessages.id = 'chatMessages';
  }

  /* ═════════════════════════════════════════════════════════════════
     WIRING
     ═════════════════════════════════════════════════════════════════ */
  function wireTopBar() {
    rootEl.querySelector('#cvBack').addEventListener('click', () => chatview.close());
    rootEl.querySelector('#cvMenu').addEventListener('click', () => openDrawer());
    rootEl.querySelector('#cvBrand').addEventListener('click', () => openPersonaSheet());

    // Mic button — speak to NEXUS. Sits in the input row next to send.
    // Was previously only accessible via the + menu; user remembered it
    // as a top-level button. Triggers the existing brain-chat mic flow
    // through the same code path the plus-menu uses, so all the
    // SpeechRecognition / mic-permission / transcript logic just works.
    const micBtn = rootEl.querySelector('#cvMicBtn');
    if (micBtn) {
      micBtn.addEventListener('click', () => {
        // Visual press feedback so the user knows it registered
        micBtn.classList.add('is-listening');
        setTimeout(() => micBtn.classList.remove('is-listening'), 300);
        // Brain-chat owns the mic. It registers a hidden #micBtn handler
        // and also listens for the nx-mic-tap event. Either path works;
        // we try the direct click first (legacy preferred), fall back
        // to the event so we can't double-trigger.
        const legacy = document.getElementById('micBtn');
        if (legacy) {
          legacy.click();
        } else {
          window.dispatchEvent(new Event('nx-mic-tap'));
        }
      });
      // Mirror brain-chat's recording state — when it's actively listening,
      // the mic glows. brain-chat fires nx-mic-state events.
      window.addEventListener('nx-mic-state', (e) => {
        const recording = !!e.detail?.recording;
        micBtn.classList.toggle('is-recording', recording);
      });
    }

    // Voice mute toggle — tap to toggle voiceOn state. Was buried in
    // the plus-menu (Voice replies), now surfaced in the top bar so
    // it's one tap away. The plus-menu version is kept too so users
    // who already learned that path don't get surprised.
    const voiceToggleBtn = rootEl.querySelector('#cvVoiceToggle');
    if (voiceToggleBtn) {
      voiceToggleBtn.addEventListener('click', () => {
        state.voiceOn = !state.voiceOn;
        localStorage.setItem('nx_voice_on', state.voiceOn ? '1' : '0');
        // Update the icon + class + aria/title
        voiceToggleBtn.classList.toggle('is-on', state.voiceOn);
        voiceToggleBtn.classList.toggle('is-off', !state.voiceOn);
        voiceToggleBtn.innerHTML = svg(state.voiceOn ? ICONS.volume : ICONS.volumeOff);
        voiceToggleBtn.setAttribute('aria-label', state.voiceOn ? 'Mute voice replies' : 'Unmute voice replies');
        voiceToggleBtn.title = state.voiceOn ? 'Voice on — tap to mute' : 'Muted — tap to unmute';
        // Stop any audio currently playing if we just muted
        if (!state.voiceOn) {
          try { window.speechSynthesis?.cancel(); } catch(_) {}
          if (NX._currentAudio) { try { NX._currentAudio.pause(); } catch(_){} NX._currentAudio = null; }
        }
        // Notify the rest of the app — admin section, plus-menu, etc.
        window.dispatchEvent(new CustomEvent('nx-voice-on-change', { detail: { on: state.voiceOn } }));
        NX.toast && NX.toast(state.voiceOn ? 'Voice replies on' : 'Voice replies muted', state.voiceOn ? 'success' : 'info');
      });
    }
    // Listen for changes from elsewhere (e.g., admin checkbox) so the
    // top-bar icon stays in sync. We re-read from state because
    // some other component might have updated it.
    window.addEventListener('nx-voice-on-change', (e) => {
      const on = e.detail?.on;
      if (on === undefined || !voiceToggleBtn) return;
      if (state.voiceOn === on) return;  // already in sync
      state.voiceOn = on;
      voiceToggleBtn.classList.toggle('is-on', on);
      voiceToggleBtn.classList.toggle('is-off', !on);
      voiceToggleBtn.innerHTML = svg(on ? ICONS.volume : ICONS.volumeOff);
    });
  }

  function wireInput() {
    // Auto-grow textarea
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(140, inputEl.scrollHeight) + 'px';
      sendEl.disabled = !inputEl.value.trim();
    });
    inputEl.addEventListener('keydown', (e) => {
      // Enter sends, Shift+Enter newlines
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        triggerSend();
      }
    });
    sendEl.addEventListener('click', triggerSend);
  }

  function triggerSend() {
    // brain-chat's askAI reads #chatInput.value, clears it, and pushes
    // the user turn into #chatMessages itself. After our ID claim, our
    // input owns #chatInput, so we just need to dispatch — don't clear
    // the input first or askAI sees an empty string.
    const q = inputEl.value.trim();
    if (!q) return;
    window.dispatchEvent(new CustomEvent('nx-chat-ask', { detail: { q } }));
    // askAI will clear the value + disable send itself — we just collapse
    // the autogrow height so visual state matches
    setTimeout(() => {
      inputEl.style.height = 'auto';
    }, 40);
  }

  function wirePlusMenu() {
    const plus = rootEl.querySelector('#cvPlus');
    const menu = rootEl.querySelector('#cvPlusMenu');
    renderPlusMenu(menu);
    plus.addEventListener('click', (e) => {
      e.stopPropagation();
      state.plusOpen ? closePlusMenu() : openPlusMenu();
    });
    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!state.plusOpen) return;
      if (!menu.contains(e.target) && !plus.contains(e.target)) closePlusMenu();
    });
  }

  function renderPlusMenu(menu) {
    const items = [
      { key: 'camera', label: 'Scan document', icon: ICONS.camera },
      { key: 'mic',    label: 'Voice input',   icon: ICONS.mic },
      { key: 'voice',  label: 'Voice replies', icon: state.voiceOn ? ICONS.volume : ICONS.volumeOff, toggle: true },
    ];
    menu.innerHTML = items.map(it => `
      <button class="cv-plus-item ${it.toggle && it.key === 'voice' && state.voiceOn ? 'active' : ''}" data-key="${it.key}" type="button" role="menuitem">
        ${svg(it.icon, 16)}
        <span>${it.label}</span>
        ${it.toggle ? '<span class="cv-plus-item-dot"></span>' : ''}
      </button>
    `).join('');
    menu.querySelectorAll('.cv-plus-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePlusAction(btn.dataset.key);
      });
    });
  }

  function openPlusMenu() {
    const menu = rootEl.querySelector('#cvPlusMenu');
    const plus = rootEl.querySelector('#cvPlus');
    renderPlusMenu(menu); // re-render to pick up voiceOn state
    menu.classList.add('is-open');
    plus.classList.add('is-open');
    state.plusOpen = true;
  }

  function closePlusMenu() {
    const menu = rootEl.querySelector('#cvPlusMenu');
    const plus = rootEl.querySelector('#cvPlus');
    menu?.classList.remove('is-open');
    plus?.classList.remove('is-open');
    state.plusOpen = false;
  }

  function handlePlusAction(key) {
    closePlusMenu();
    if (key === 'camera') {
      // Re-trigger the legacy camera button logic which brain-chat owns
      document.getElementById('camBtn')?.click() ||
        window.dispatchEvent(new Event('nx-cam-tap'));
    } else if (key === 'mic') {
      document.getElementById('micBtn')?.click() ||
        window.dispatchEvent(new Event('nx-mic-tap'));
    } else if (key === 'voice') {
      state.voiceOn = !state.voiceOn;
      localStorage.setItem('nx_voice_on', state.voiceOn ? '1' : '0');
      // Signal brain-chat so its internal voiceOn stays in sync
      window.dispatchEvent(new CustomEvent('nx-voice-toggle', { detail: { on: state.voiceOn } }));
    }
  }

  function wireDrawer(scrim) {
    drawerEl.querySelector('#cvDrawerClose').addEventListener('click', closeDrawer);
    drawerEl.querySelector('#cvDrawerNew').addEventListener('click', startNewConversation);
    scrim.addEventListener('click', closeDrawer);
  }

  function openDrawer() {
    drawerEl.classList.add('is-open');
    document.getElementById('cvDrawerScrim').classList.add('is-open');
    renderSessionsList();
  }
  function closeDrawer() {
    drawerEl.classList.remove('is-open');
    document.getElementById('cvDrawerScrim').classList.remove('is-open');
  }

  function startNewConversation() {
    const newId = crypto.randomUUID ? crypto.randomUUID() : 's_' + Date.now();
    localStorage.setItem('nexus_session_id', newId);
    state.currentSessionId = newId;
    closeDrawer();
    chatview.renderTranscript();
    inputEl?.focus();
  }

  function wirePersonaSheet(scrim) {
    renderPersonaSheet();
    scrim.addEventListener('click', closePersonaSheet);
  }

  function renderPersonaSheet() {
    const current = state.tone;
    const currentVoice = state.voiceIdx;
    const voices = getVoices();                    // canonical NX.VOICES
    const toneHTML = Object.entries(TONE_PRESETS).map(([k, v]) => `
      <button class="cv-persona-opt ${k === current ? 'is-active' : ''}" data-tone="${k}" type="button">
        <span class="cv-persona-opt-label">${esc(v.label)}</span>
        <span class="cv-persona-opt-desc">${esc(v.desc)}</span>
      </button>
    `).join('');

    // Clamp voiceIdx to current list length in case stored idx came
    // from a stale / larger list. Keeps UI highlighting consistent.
    const safeVoiceIdx = (currentVoice % voices.length + voices.length) % voices.length;
    const voiceHTML = voices.map((v, idx) => `
      <button class="cv-persona-voice ${idx === safeVoiceIdx ? 'is-active' : ''}" data-voice-idx="${idx}" type="button" title="${esc(v.desc || '')}">
        <span class="cv-persona-voice-name">${esc(v.name)}</span>
        ${v.desc ? `<span class="cv-persona-voice-desc">${esc(v.desc)}</span>` : ''}
      </button>
    `).join('');
    const activeVoiceName = voices[safeVoiceIdx]?.name || '—';

    personaSheetEl.innerHTML = `
      <div class="cv-persona-grip"></div>
      <h3 class="cv-persona-h">Tone & voice</h3>
      <div class="cv-persona-sub">How should NEXUS talk to you?</div>

      <div class="cv-persona-section-title">Text tone</div>
      <div class="cv-persona-grid">${toneHTML}</div>

      <div class="cv-persona-section-title">Voice — currently <strong>${esc(activeVoiceName)}</strong></div>
      <div class="cv-persona-voices">${voiceHTML}</div>

      <button class="cv-persona-close" id="cvPersonaClose" type="button">Done</button>
    `;

    personaSheetEl.querySelectorAll('.cv-persona-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        chatview.setPersona(btn.dataset.tone);
        renderPersonaSheet();
      });
    });
    personaSheetEl.querySelectorAll('.cv-persona-voice').forEach(btn => {
      btn.addEventListener('click', () => {
        state.voiceIdx = parseInt(btn.dataset.voiceIdx, 10);
        localStorage.setItem('nexus_voice_idx', String(state.voiceIdx));
        // Signal brain-chat so its voice picker stays in sync
        window.dispatchEvent(new CustomEvent('nx-voice-idx-change', { detail: { idx: state.voiceIdx } }));
        // Also sync the admin panel's select element if it's rendered
        const adminVoice = document.getElementById('adminVoice');
        if (adminVoice) adminVoice.value = String(state.voiceIdx);
        renderPersonaSheet();
      });
    });
    personaSheetEl.querySelector('#cvPersonaClose').addEventListener('click', closePersonaSheet);
  }

  function openPersonaSheet() {
    renderPersonaSheet();
    personaSheetEl.classList.add('is-open');
    document.getElementById('cvPersonaScrim').classList.add('is-open');
  }
  function closePersonaSheet() {
    personaSheetEl.classList.remove('is-open');
    document.getElementById('cvPersonaScrim').classList.remove('is-open');
  }

  function wireBrandGalaxy() {
    const canvas = rootEl.querySelector('#cvBrandGalaxy canvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 18;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const cx = size / 2, cy = size / 2;
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      r: 2 + (i % 3) * 1.5 + Math.random() * 0.6,
      theta: i * Math.PI / 4,
      speed: 0.0005 + (i % 3) * 0.0002,
      size: 0.7 + Math.random() * 0.5,
      alpha: 0.35 + Math.random() * 0.45,
    }));
    let lastT = performance.now();
    (function frame(t) {
      const dt = t - lastT; lastT = t;
      ctx.clearRect(0, 0, size, size);
      for (const n of nodes) {
        n.theta += n.speed * dt;
        const x = cx + Math.cos(n.theta) * n.r;
        const y = cy + Math.sin(n.theta) * n.r;
        ctx.fillStyle = `rgba(237, 233, 224, ${n.alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, n.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(212, 164, 78, 0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.2, 0, Math.PI * 2);
      ctx.fill();
      requestAnimationFrame(frame);
    })(performance.now());
  }

  function wireKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Escape closes chat view
      if (e.key === 'Escape' && state.isOpen) {
        // Let dropdowns close first
        if (state.plusOpen) { closePlusMenu(); return; }
        if (document.getElementById('cvDrawerScrim')?.classList.contains('is-open')) {
          closeDrawer(); return;
        }
        if (document.getElementById('cvPersonaScrim')?.classList.contains('is-open')) {
          closePersonaSheet(); return;
        }
        chatview.close();
      }
    });
  }

  /* ═════════════════════════════════════════════════════════════════
     TRANSCRIPT RENDERING
     ═════════════════════════════════════════════════════════════════ */
  async function renderEmptyState(holder) {
    const firstName = (NX.currentUser?.name || '').split(' ')[0] || 'there';
    const hour = new Date().getHours();
    const salutation = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';

    // Paint immediately with a placeholder, then enrich with live data.
    // That way the empty state renders instantly and fills in detail
    // after Supabase responses arrive — no perceived lag.
    holder.innerHTML = `
      <div class="cv-empty">
        <div class="cv-empty-ambient"></div>
        <div class="cv-empty-inner">
          <div class="cv-empty-eyebrow">Just ask</div>
          <h2 class="cv-empty-h">
            <em>${esc(salutation)}</em>, ${esc(firstName)}.<br>
            What do you need?
          </h2>
          <div class="cv-empty-situation" id="cvEmptySituation">
            Checking what's happening across the restaurants…
          </div>

          <div class="cv-empty-section-label">Ask about</div>
          <div class="cv-empty-prompts" id="cvEmptyPrompts">
            ${renderPromptSkeletons()}
          </div>

          <div class="cv-empty-recents-wrap" id="cvEmptyRecentsWrap" style="display:none;">
            <div class="cv-empty-section-label">Pick up where you left off</div>
            <div class="cv-empty-recents" id="cvEmptyRecents"></div>
          </div>
        </div>
      </div>
    `;

    // Paint real content in parallel — never block on any single fetch
    Promise.allSettled([
      paintSituation(),
      paintPrompts(),
      paintRecents(),
    ]);
  }

  function renderPromptSkeletons() {
    // 6 skeleton placeholders so the grid doesn't pop in empty
    return Array(6).fill(0).map(() => `
      <div class="cv-prompt cv-prompt-skeleton" aria-hidden="true"></div>
    `).join('');
  }

  // ─── Situation line — "2 overdue · 3 tickets overnight · 1 visit today"
  async function paintSituation() {
    const el = document.getElementById('cvEmptySituation');
    if (!el || !NX.sb) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const twoDays = new Date(Date.now() + 48 * 3600000).toISOString().slice(0, 10);
      const sinceOvernight = new Date(Date.now() - 18 * 3600000).toISOString();

      const [overdueRes, ticketsRes, eventsRes] = await Promise.allSettled([
        NX.sb.from('equipment').select('*', { count: 'exact', head: true }).lt('next_pm_date', today),
        NX.sb.from('tickets').select('*', { count: 'exact', head: true }).eq('status', 'open').gte('created_at', sinceOvernight),
        NX.sb.from('contractor_events').select('*', { count: 'exact', head: true }).gte('event_date', today).lte('event_date', twoDays).neq('status', 'cancelled'),
      ]);

      const nOverdue = overdueRes.status === 'fulfilled' ? (overdueRes.value.count || 0) : 0;
      const nTickets = ticketsRes.status === 'fulfilled' ? (ticketsRes.value.count || 0) : 0;
      const nEvents  = eventsRes.status === 'fulfilled' ? (eventsRes.value.count || 0) : 0;

      const parts = [];
      if (nOverdue) parts.push(`<strong>${nOverdue}</strong> overdue PM${nOverdue === 1 ? '' : 's'}`);
      if (nTickets) parts.push(`<strong>${nTickets}</strong> ticket${nTickets === 1 ? '' : 's'} overnight`);
      if (nEvents)  parts.push(`<strong>${nEvents}</strong> contractor visit${nEvents === 1 ? '' : 's'} coming up`);

      if (!parts.length) {
        el.innerHTML = 'All quiet across the restaurants. Nothing urgent on the board.';
      } else {
        // Join with the serial comma — reads like a news wire line
        const joined =
          parts.length === 1 ? parts[0] :
          parts.length === 2 ? parts.join(' and ') :
          parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
        el.innerHTML = joined + '.';
      }
    } catch (err) {
      console.warn('[chat] situation paint failed:', err.message);
      el.textContent = 'Everything I know is here whenever you need it.';
    }
  }

  // ─── Prompts grid — mix evergreen starters + context-aware suggestions
  async function paintPrompts() {
    const gridEl = document.getElementById('cvEmptyPrompts');
    if (!gridEl) return;

    const prompts = [
      { kicker: 'Today',        text: "What happened overnight?" },
      { kicker: 'Operations',   text: "What needs my attention today?" },
      { kicker: 'Equipment',    text: "What's overdue for maintenance?" },
      { kicker: 'Contractors',  text: "Who's visiting this week?" },
      { kicker: 'Finance',      text: "How much have we spent on repairs this month?" },
      { kicker: 'Intel',        text: "Summarize this week across all three restaurants" },
    ];

    // Fold in 2 dynamic prompts from most-used nodes if we have any
    try {
      const top = (NX.nodes || [])
        .filter(n => !n.is_private)
        .sort((a, b) => (b.access_count || 0) - (a.access_count || 0))
        .slice(0, 2);
      top.forEach(n => {
        if (n.category === 'contractors')    prompts.push({ kicker: 'Contractor', text: `Tell me about ${n.name}` });
        else if (n.category === 'equipment') prompts.push({ kicker: 'Equipment',  text: `${n.name} — status & history` });
        else if (n.category === 'procedure') prompts.push({ kicker: 'Procedure',  text: `Walk me through ${n.name}` });
      });
    } catch (e) {}

    // Cap at 8 — two columns of four looks balanced
    const capped = prompts.slice(0, 8);

    gridEl.innerHTML = capped.map(p => `
      <button class="cv-prompt" data-prompt="${esc(p.text)}" type="button">
        <span class="cv-prompt-kicker">${esc(p.kicker)}</span>
        <span class="cv-prompt-text">${esc(p.text)}</span>
      </button>
    `).join('');

    gridEl.querySelectorAll('.cv-prompt').forEach(btn => {
      btn.addEventListener('click', () => {
        inputEl.value = btn.dataset.prompt;
        inputEl.dispatchEvent(new Event('input'));
        triggerSend();
      });
    });
  }

  // ─── Recents rail — last 3 conversations, tappable
  async function paintRecents() {
    const wrap = document.getElementById('cvEmptyRecentsWrap');
    const list = document.getElementById('cvEmptyRecents');
    if (!wrap || !list || !NX.sb) return;

    if (!state.sessions.length) {
      // loadSessions() may not have completed — try it directly, fail silent
      try { await loadSessions(); } catch (e) {}
    }

    // Exclude the currently-active session from recents (you're looking at it)
    const recents = state.sessions
      .filter(s => s.id !== state.currentSessionId && s.title)
      .slice(0, 3);

    if (!recents.length) {
      wrap.style.display = 'none';
      return;
    }

    wrap.style.display = '';
    list.innerHTML = recents.map(s => `
      <button class="cv-recent" data-sess="${esc(s.id)}" type="button">
        <span class="cv-recent-time">${esc(formatRelDate(s.last))}</span>
        <span class="cv-recent-title">${esc(truncate(s.title, 60))}</span>
      </button>
    `).join('');

    list.querySelectorAll('.cv-recent').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.sess;
        localStorage.setItem('nexus_session_id', id);
        state.currentSessionId = id;
        chatview.renderTranscript();
      });
    });
  }

  function renderTurns(holder, turns) {
    // Render past turns using the SAME .chat-bubble markup that brain-chat's
    // addB() uses. The chatview's CSS remaps those bubbles to transcript
    // style, so historical turns and new live turns render identically.
    const byDay = groupByDay(turns);
    let html = '';
    byDay.forEach(([day, dayTurns]) => {
      html += `<div class="cv-day">${esc(day)}</div>`;
      dayTurns.forEach(t => {
        const cls = t.role === 'user' ? 'chat-user' : 'chat-ai';
        const time = t.ts ? formatTime(t.ts) : '';
        html += `
          <div class="chat-bubble ${cls}">${escMultiline(t.content || '')}${time ? `<span class="chat-time">${esc(time)}</span>` : ''}</div>
        `;
      });
    });
    holder.innerHTML = html;
  }

  function groupByDay(turns) {
    const groups = new Map();
    const fmt = (d) => {
      const today = new Date(); today.setHours(0,0,0,0);
      const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
      const dt = new Date(d); dt.setHours(0,0,0,0);
      if (dt.getTime() === today.getTime())    return 'Today';
      if (dt.getTime() === yesterday.getTime()) return 'Yesterday';
      return dt.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    };
    turns.forEach(t => {
      const k = t.ts ? fmt(t.ts) : 'Earlier';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    });
    return [...groups.entries()];
  }

  function scrollToBottom() {
    setTimeout(() => {
      if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }, 30);
  }

  /* ═════════════════════════════════════════════════════════════════
     SESSION DATA (chat_history table)
     ═════════════════════════════════════════════════════════════════ */
  function getActiveSessionId() {
    return localStorage.getItem('nexus_session_id');
  }

  async function hydrateSession(sessionId) {
    if (!sessionId || !NX.sb) return [];
    try {
      const { data, error } = await NX.sb
        .from('chat_history')
        .select('question, answer, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error || !data) return [];
      // Each row has q + a. Expand into two turn objects each.
      const turns = [];
      data.forEach(r => {
        if (r.question) turns.push({ role: 'user', content: r.question, ts: r.created_at });
        if (r.answer)   turns.push({ role: 'assistant', content: r.answer, ts: r.created_at });
      });
      return turns;
    } catch (err) {
      console.warn('[chat] hydrate failed:', err.message);
      return [];
    }
  }

  async function loadSessions() {
    if (!NX.sb) return;
    try {
      // Group chat_history by session_id, most recent first
      const since = new Date(Date.now() - 60 * 86400000).toISOString();
      const { data, error } = await NX.sb
        .from('chat_history')
        .select('session_id, question, answer, created_at, user_name')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(400);
      if (error || !data) return;

      const byId = new Map();
      data.forEach(r => {
        if (!r.session_id) return;
        if (!byId.has(r.session_id)) {
          byId.set(r.session_id, {
            id: r.session_id,
            title: '',
            last: r.created_at,
            count: 0,
          });
        }
        const s = byId.get(r.session_id);
        s.count++;
        // Use the FIRST question as the title (earliest row of this session)
        if (r.question) s.title = r.question;
      });
      state.sessions = [...byId.values()].sort((a, b) => new Date(b.last) - new Date(a.last)).slice(0, 40);
      if (drawerEl?.classList.contains('is-open')) renderSessionsList();
    } catch (err) {
      console.warn('[chat] loadSessions failed:', err.message);
    }
  }

  function renderSessionsList() {
    const list = drawerEl.querySelector('#cvDrawerList');
    if (!list) return;
    if (!state.sessions.length) {
      list.innerHTML = `<div class="cv-drawer-empty">No conversations yet. Start one with the input below.</div>`;
      return;
    }
    list.innerHTML = state.sessions.map(s => `
      <button class="cv-drawer-item ${s.id === state.currentSessionId ? 'is-active' : ''}" data-sess="${esc(s.id)}" type="button">
        <div class="cv-drawer-item-title">${esc(truncate(s.title || 'Untitled', 80))}</div>
        <div class="cv-drawer-item-meta">${esc(formatRelDate(s.last))} · ${s.count} msg${s.count === 1 ? '' : 's'}</div>
      </button>
    `).join('');
    list.querySelectorAll('.cv-drawer-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.sess;
        localStorage.setItem('nexus_session_id', id);
        state.currentSessionId = id;
        closeDrawer();
        chatview.renderTranscript();
      });
    });
  }

  /* ═════════════════════════════════════════════════════════════════
     HELPERS
     ═════════════════════════════════════════════════════════════════ */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escMultiline(s) {
    // preserve line breaks visually; the container has white-space:pre-wrap
    return esc(s);
  }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function formatTime(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function formatRelDate(iso) {
    try {
      const d = new Date(iso);
      const mins = Math.floor((Date.now() - d.getTime()) / 60000);
      if (mins < 60)   return mins + 'm ago';
      if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
      const days = Math.floor(mins / 1440);
      if (days < 7)    return days + 'd ago';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  }
})();
