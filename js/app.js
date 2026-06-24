/* ═══════════════════════════════════════════
   NEXUS v10 — PIN Auth + Supabase Config
   Keys in DB, not localStorage. PIN login.
   Roles: admin, manager, staff
   ═══════════════════════════════════════════ */

const NX = {
  // Supabase (public, non-secret). Values come from window.NEXUS_CONFIG
  // (js/config.js loaded before app.js). Fallbacks below keep the app
  // working even if config.js is missing.
  SUPA_URL: window.NEXUS_CONFIG?.SUPABASE_URL  || 'https://oprsthfxqrdbwdvommpw.supabase.co',
  SUPA_KEY: window.NEXUS_CONFIG?.SUPABASE_ANON || 'sb_publishable_rOLSdIG6mIjVLY8JmvrwCA_qfM7Vyk9',
  GOOGLE_CLIENT_ID: '48632479959-j2beg9hsq6sb4dddtkr846kl6gnu8lqu.apps.googleusercontent.com',

  // Runtime state
  sb: null, nodes: [], today: new Date().toISOString().split('T')[0],
  modules: {}, loaded: {}, brain: null,
  paused: false,
  brainView: 'shared', // 'shared', 'mine', 'all' // Kill switch for all Supabase operations

  // Auth state
  currentUser: null, // {id, name, pin, role, location}
  // Back-compat alias — ~30 call sites read NX.user.* but NX.user was NEVER
  // assigned (only NX.currentUser is), so the ones without a `|| NX.currentUser`
  // fallback silently yielded undefined and dropped attribution (reported_by in
  // domain reopen / issue transitions / email-contractor, created_by + sent_by
  // on every order). Aliasing user → currentUser fixes them all at once.
  get user() { return this.currentUser; },
  config: null,      // {anthropic_key, elevenlabs_key, ...}

  // Key getters — from Supabase config (memory), fallback to localStorage
  getApiKey() { return this.config?.anthropic_key || localStorage.getItem('nexus_api_key') || ''; },
  getElevenLabsKey() { return this.config?.elevenlabs_key || localStorage.getItem('nexus_eleven_key') || ''; },
  getGoogleClientId() { return this.config?.google_client_id || localStorage.getItem('nexus_google_client_id') || this.GOOGLE_CLIENT_ID; },
  getTrelloKey() { return this.config?.trello_key || localStorage.getItem('nexus_trello_key') || ''; },
  getTrelloToken() { return this.config?.trello_token || localStorage.getItem('nexus_trello_token') || ''; },
  getModel() { return this.config?.model || localStorage.getItem('nexus_model') || 'claude-sonnet-4-20250514'; },
  // AI provider — 'anthropic' (Claude API, default) or 'clippy' (the Clippy
  // HTTP API = ClippyPC's offline brain, default :4242). Device-local
  // (localStorage), since the endpoint is localhost on THIS machine. The
  // token is optional, only needed if Clippy sets api_token (the /act route
  // can drive the mouse, so it's worth gating).
  getProvider() { return this.config?.ai_provider || localStorage.getItem('nexus_ai_provider') || 'anthropic'; },
  getClippyEndpoint() { return String(this.config?.clippy_endpoint || localStorage.getItem('nexus_clippy_endpoint') || 'http://localhost:4242').replace(/\/+$/, ''); },
  getClippyToken() { return this.config?.clippy_token || localStorage.getItem('nexus_clippy_token') || ''; },
  // Optional specific Clippy LLM (empty = let Clippy pick his default). Only
  // takes effect once Clippy's /ask honors a `model` field; sent regardless.
  getClippyModel() { return this.config?.clippy_model || localStorage.getItem('nexus_clippy_model') || ''; },

  // Roles
  isAdmin: false,
  isManager: false,
  isStaff: false,

  // ─── Persistent Memory ───
  async fetchMemory(question) {
    try {
      // Persona-scoped fetch: when v2 memory is in use (wing column on
      // chat_history), restrict to the active persona so Trajan doesn't
      // see Providentia's exchanges and vice versa. Falls back to an
      // unscoped query if the wing column or getActivePersona aren't
      // available (older deployments).
      const persona = (this.getActivePersona && this.getActivePersona()) || null;
      let q = this.sb.from('chat_history')
        .select('question,answer,created_at,user_name')
        .order('created_at', { ascending: false })
        .limit(200);
      if (persona === 'providentia' || persona === 'trajan') {
        q = q.eq('wing', persona);
      }
      const { data } = await q;
      if (!data || !data.length) return '';
      const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (!words.length) return '';
      const scored = data.map(row => {
        const q = (row.question || '').toLowerCase();
        const a = (row.answer || '').toLowerCase();
        let score = 0;
        words.forEach(w => {
          if (q.includes(w)) score += 3; // Question match weighted higher
          if (a.includes(w)) score += 1;
        });
        // Boost recent conversations
        const age = (Date.now() - new Date(row.created_at).getTime()) / 86400000; // days
        if (age < 1) score += 2;
        else if (age < 7) score += 1;
        return { row, score };
      }).filter(s => s.score > 1).sort((a, b) => b.score - a.score).slice(0, 5);
      if (!scored.length) return '';
      return '\n\nPAST CONVERSATIONS (AI can reference these):\n' + scored.map(s => {
        const date = new Date(s.row.created_at).toLocaleDateString();
        const who = s.row.user_name ? ` (${s.row.user_name})` : '';
        return `[${date}${who}] Q: ${s.row.question}\nA: ${(s.row.answer || '').slice(0, 400)}`;
      }).join('\n\n');
    } catch (e) { return ''; }
  },

  async trackAccess(nodeIds) {
    if (!nodeIds || !nodeIds.length) return;
    for (const id of nodeIds.slice(0, 10)) {
      try {
        const node = this.nodes.find(n => n.id === id); if (!node) continue;
        const nc = (node.access_count || 0) + 1; node.access_count = nc;
        await this.sb.from('nodes').update({ access_count: nc }).eq('id', id);
      } catch (e) { }
    }
  },

  // ─── Glossary, Aliases, Critical Facts — loaded once on startup ───
  _glossary: [],
  _aliases: {},
  _criticalFacts: [],

  async loadGlossary() {
    try {
      const { data } = await this.sb.from('nexus_glossary').select('term,meaning').order('term');
      if (data) this._glossary = data;
    } catch (e) {
      // Table might not exist yet — use defaults
      this._glossary = [
        { term: 'walk-in', meaning: 'walk-in cooler/refrigerator' },
        { term: 'the line', meaning: 'kitchen cooking stations' },
        { term: '86 / 86d', meaning: 'item is out of stock or removed from menu' },
        { term: 'lowboy', meaning: 'under-counter refrigerator' },
        { term: 'two-top', meaning: 'table for two guests' },
        { term: 'four-top', meaning: 'table for four guests' },
        { term: 'mise', meaning: 'mise en place — prep/setup' },
        { term: 'expo', meaning: 'expeditor — person coordinating food going out' },
        { term: 'BOH', meaning: 'back of house — kitchen area' },
        { term: 'FOH', meaning: 'front of house — dining area' },
        { term: 'comp', meaning: 'complimentary — given for free' },
        { term: 'fire', meaning: 'start cooking an order' },
        { term: 'on the fly', meaning: 'rush order, needs to go out immediately' },
        { term: 'Ders', meaning: 'Alfredo "Ders" Ortiz — owner' },
      ];
    }
  },

  async loadAliases() {
    try {
      const { data } = await this.sb.from('node_aliases').select('alias,canonical_name');
      if (data) {
        this._aliases = {};
        data.forEach(a => { this._aliases[a.alias] = a.canonical_name; });
      }
    } catch (e) {
      // Build aliases from nodes — names with common short forms
      this._aliases = {};
      (this.nodes || []).forEach(n => {
        const name = n.name || '';
        const words = name.split(/\s+/);
        if (words.length > 1) {
          // First name → full name
          this._aliases[words[0].toLowerCase()] = name;
          // First + last initial → full name
          if (words.length >= 2) this._aliases[(words[0] + ' ' + words[1][0]).toLowerCase()] = name;
        }
      });
    }
  },

  async loadCriticalFacts() {
    try {
      const { data } = await this.sb.from('critical_facts').select('content,priority').order('priority');
      if (data) this._criticalFacts = data;
    } catch (e) {
      // Table might not exist — use defaults from nodes
      this._criticalFacts = [
        { content: '3 restaurants: Suerte (Mexican), Este (Italian), Bar Toti (cocktail bar) — all Austin TX', priority: 1 },
        { content: 'Alfredo "Ders" Ortiz is the owner/operator of all three', priority: 2 },
      ];
    }
  },

  async loadNodes() {
    if (this.paused) return;
    try {
      let all = [], offset = 0;
      while (true) {
        const { data } = await this.sb.from('nodes').select('*').range(offset, offset + 999);
        if (!data || !data.length) break;
        all = all.concat(data); offset += data.length;
        if (data.length < 1000) break;
      }
      // Filter based on brain view + role
      const uid = this.currentUser?.id;
      const role = this.currentUser?.role || 'staff';
      if (role === 'staff') {
        // Staff sees shared only
        this.nodes = all.filter(n => !n.owner_id);
      } else if (this.brainView === 'shared') {
        this.nodes = all.filter(n => !n.owner_id);
      } else if (this.brainView === 'mine') {
        this.nodes = all.filter(n => n.owner_id === uid);
      } else {
        // 'all' — admin sees everything, manager sees shared + own
        if (role === 'admin') this.nodes = all;
        else this.nodes = all.filter(n => !n.owner_id || n.owner_id === uid);
      }
      this.allNodes = all; // Keep unfiltered copy
    } catch (e) { this.nodes = []; this.allNodes = []; }
  },

  // ═══ PIN AUTH ═══
  async setupPinScreen() {
    let pin = '';
    const display = document.getElementById('pinDisplay');
    const circles = display.querySelectorAll('.pin-circle');
    const error = document.getElementById('pinError');
    const userEl = document.getElementById('pinUser');

    // ═══ PRELOAD: Kick off location dropdown refresh in the background
    // while user is typing their PIN. By the time they're done typing,
    // the data is already in localStorage for instant dropdown render.
    if (NX.timeClock?.buildLocationDropdownFresh) {
      // Wait 200ms before firing so we don't compete with the PIN screen
      // render for network/CPU, but the preload still completes by the
      // time the average user has typed 4 digits (~1-2 seconds)
      setTimeout(() => {
        // Direct Supabase call since the dropdown DOM doesn't exist yet
        NX.sb?.from('time_clock')
          .select('location')
          .order('clock_in', { ascending: false })
          .limit(100)
          .then(({ data }) => {
            if (!data) return;
            const locs = new Set();
            data.forEach(r => {
              if (r.location && r.location.trim()) locs.add(r.location.trim().toLowerCase());
            });
            if (locs.size) {
              try {
                localStorage.setItem('nexus_locations_cache', JSON.stringify([...locs]));
                console.log('[preload] cached', locs.size, 'locations');
              } catch (e) {}
            }
          })
          .catch(() => {});
      }, 200);
    }

    const updateDisplay = () => {
      circles.forEach((c, i) => c.classList.toggle('filled', i < pin.length));
    };

    document.querySelectorAll('.pin-key[data-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (pin.length >= 4) return;
        pin += btn.dataset.val;
        updateDisplay();
        if (pin.length === 4) this.authenticatePin(pin, error, userEl, () => { pin = ''; updateDisplay(); });
      });
    });

    document.getElementById('pinDel').addEventListener('click', () => {
      pin = pin.slice(0, -1); updateDisplay(); error.textContent = '';
    });

    // Language toggle on PIN screen
    const currentLang = this.i18n ? this.i18n.getLang() : 'en';
    document.querySelectorAll('.pin-lang-btn').forEach(btn => {
      if (btn.dataset.lang === currentLang) btn.classList.add('active');
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        localStorage.setItem('nexus_lang', lang);
        document.querySelectorAll('.pin-lang-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const sub = document.querySelector('.pin-sub');
        if (sub) sub.textContent = lang === 'es' ? 'Ingrese su PIN' : 'Enter your PIN';
      });
    });

    // ═══ BIOMETRIC AUTH — fingerprint/face as PIN alternative ═══
    if (NX.biometric && await NX.biometric.check()) {
      // Show fingerprint button on PIN screen
      const pinPad = document.querySelector('.pin-pad');
      if (pinPad) {
        const bioBtn = document.createElement('button');
        bioBtn.className = 'pin-bio-btn';
        bioBtn.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 10a2 2 0 100 4 2 2 0 000-4z"/><path d="M5.45 5.11L2 12l3.45 6.89A1 1 0 006.35 20h11.3a1 1 0 00.9-1.11L22 12l-3.45-6.89A1 1 0 0017.65 4H6.35a1 1 0 00-.9 1.11z"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg><span>Use Fingerprint</span>';
        bioBtn.addEventListener('click', async () => {
          const ok = await NX.biometric.authenticate();
          if (ok) {
            const storedPin = await NX.biometric.getCredentials();
            if (storedPin) {
              // Auto-authenticate with stored PIN
              this.authenticatePin(storedPin, error, userEl, () => {});
            } else {
              error.textContent = 'Enter PIN first to enable fingerprint';
            }
          }
        });
        pinPad.appendChild(bioBtn);
      }
    }

    // Check if user was previously logged in — RE-VERIFY against Supabase
    const savedUser = sessionStorage.getItem('nexus_current_user');
    const savedToken = sessionStorage.getItem('nexus_session_token');

    // ═══ QR AUTO-LOGIN — check URL params for pin & scan action ═══
    const urlParams = new URLSearchParams(window.location.search);
    const autoPin = urlParams.get('pin');
    const autoScan = urlParams.get('scan');
    if (autoPin && !savedUser) {
      // Auto-login with PIN from QR code
      const errorEl = document.getElementById('pinError');
      const userEl = document.getElementById('pinUser');
      await this.authenticatePin(autoPin, errorEl, userEl, () => {});
      // Clean URL params after login
      if (window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      // If scan=clean, auto-open cleaning scanner after login
      if (autoScan === 'clean') {
        this._pendingScan = true;
      }
      return;
    }
    if (savedUser && savedToken) {
      try {
        const u = JSON.parse(savedUser);
        if (!u.id) { this._clearSession(); return; }
        // Phase B note: we used to refetch the user row via
        //   .from('nexus_users').select('*').eq('id', u.id)
        // here, but Phase B revoked direct SELECT on nexus_users.
        //
        // The session token was already verified at the time of cold
        // PIN login (in authenticatePin → _handleAuthSuccess), and
        // sessionStorage clears when the tab closes. We trust the saved
        // user record for the duration of this session. If role or
        // permissions changed server-side, the user will re-authenticate
        // on next page reload anyway.
        this.currentUser = u;
        // Phase 1 — restore active persona for this session as well.
        this._initActivePersona();
        this._applyRole(u.role);
        this._loadConfigAndStart();
        return;
      } catch (e) { this._clearSession(); }
    }
  },

  _clearSession() {
    sessionStorage.removeItem('nexus_current_user');
    sessionStorage.removeItem('nexus_session_token');
    this.currentUser = null;
    this.isAdmin = false;
    this.isManager = false;
    // v18.8 — notify habits observer that the active user is gone
    try {
      document.dispatchEvent(new CustomEvent('nexus:user-change', {
        detail: { user: null }
      }));
    } catch(_) {}
  },

  async _makeSessionToken(pin, id) {
    // Simple HMAC-like token — not cryptographically bulletproof but prevents casual tampering
    const raw = `nexus_${id}_${pin}_${navigator.userAgent.slice(0, 20)}`;
    if (window.crypto && crypto.subtle) {
      try {
        const enc = new TextEncoder().encode(raw);
        const hash = await crypto.subtle.digest('SHA-256', enc);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {}
    }
    // Fallback — simple hash
    let h = 0; for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h + raw.charCodeAt(i)) | 0; }
    return 'nx' + Math.abs(h).toString(36);
  },

  async authenticatePin(pin, errorEl, userEl, resetFn) {
    try {
      errorEl.textContent = '';
      
      // ═══ FAST PATH: Check local PIN cache first ═══
      // If this PIN was verified on this device recently, we can let the
      // user in immediately without waiting for Supabase. Background
      // revalidation runs in parallel to catch any changes.
      if (NX.pinCache && NX.pinCache.verify) {
        const cachedUser = await NX.pinCache.verify(pin);
        if (cachedUser) {
          console.log('[auth] cache hit — instant login');
          this._handleAuthSuccess(cachedUser, pin, userEl);
          // Background revalidation — if PIN was changed/revoked,
          // next login will force the full Supabase path
          if (NX.pinCache.revalidate) {
            NX.pinCache.revalidate(pin, cachedUser.id).then(ok => {
              if (ok === false) console.warn('[auth] PIN no longer valid in Supabase');
            });
          }
          return;
        }
      }
      
      // ═══ SLOW PATH: Full Supabase verification ═══
      // Calls the verify_pin(p_pin text) RPC instead of selecting directly
      // from nexus_users. Phase B revoked SELECT on nexus_users from the
      // anon role, so the old `from('nexus_users').eq('pin', pin)` query
      // now returns a permission error. The RPC runs as SECURITY DEFINER
      // server-side, returns a JSON user row on success or null/empty on
      // failure.
      const { data: rpcData, error } = await this.sb.rpc('verify_pin', { p_pin: pin });
      // RPC returns null for an invalid PIN. Successful auth returns a
      // JSON object (user row). Empty object {} also counts as failure.
      const data = (rpcData && typeof rpcData === 'object' && rpcData.id) ? rpcData : null;
      if (error || !data) {
        errorEl.textContent = this.i18n ? this.i18n.t('invalidPin') : 'Invalid PIN';
        errorEl.classList.add('shake'); setTimeout(() => errorEl.classList.remove('shake'), 500);
        resetFn(); return;
      }
      
      // Cache for next login on this device
      if (NX.pinCache && NX.pinCache.store) {
        NX.pinCache.store(pin, data).catch(e => console.warn('[auth] cache store failed:', e));
      }
      
      this._handleAuthSuccess(data, pin, userEl);
    } catch (e) {
      console.error('NEXUS auth:', e);
      errorEl.textContent = 'Connection failed';
      errorEl.classList.add('shake'); setTimeout(() => errorEl.classList.remove('shake'), 500);
      resetFn();
    }
  },
  
  // Shared success handler for both cache-hit and cold auth paths
  _handleAuthSuccess(user, pin, userEl) {
    this.currentUser = user;
    // Phase D: ensure currentUser.permissions is populated. If verify_pin's
    // SELECT shape doesn't include the new column, fetch via the dedicated
    // get_user_permissions RPC (SECURITY DEFINER, fast). Fire-and-forget;
    // the empty-perms permissive fallback in hasPermission keeps the UI
    // working until this resolves.
    if (user && user.id != null && user.permissions === undefined) {
      this.sb.rpc('get_user_permissions', { p_user_id: user.id })
        .then(({ data, error }) => {
          if (!error && data) {
            this.currentUser.permissions = data;
            // Re-apply gates now that real perms are loaded
            if (this.applyPermissionGates) this.applyPermissionGates();
          }
        })
        .catch(e => console.warn('[perms] post-login fetch failed:', e));
    }
    // v18.9 — fetch interests if not already on the user row. Trajan
    // reads currentUser.interests / inferred_interests to personalize
    // greetings, quotes, facts, and timing. If the user-row select
    // doesn't include those columns, this fills them in async.
    if (user && user.id != null && user.interests === undefined) {
      this.sb.from('nexus_users')
        .select('interests, inferred_interests')
        .eq('id', user.id).maybeSingle()
        .then(({ data, error }) => {
          if (!error && data && this.currentUser && this.currentUser.id === user.id) {
            this.currentUser.interests = data.interests || [];
            this.currentUser.inferred_interests = data.inferred_interests || {};
            // Re-fire user-change with the enriched user so clippy/habits
            // pick up the interest list
            try {
              document.dispatchEvent(new CustomEvent('nexus:user-change', {
                detail: { user: this.currentUser, enriched: true }
              }));
            } catch(_){}
          }
        })
        .catch(e => console.warn('[interests] post-login fetch failed:', e));
    }
    // Phase 1 — load this user's preferred persona (Providentia/Trajan).
    // Reads currentUser.default_persona if the verify_pin RPC returns
    // it, else localStorage fallback, else 'providentia'. Fires
    // nx-persona-change so brain-chat picks up CURRENT_PERSONA.
    this._initActivePersona();
    // v18.8 — notify habits observer of the new active user so it can
    // start binding observations to their id + pull their cloud
    // pattern profile (if any) for warm-start across devices.
    try {
      document.dispatchEvent(new CustomEvent('nexus:user-change', {
        detail: { user: { id: user.id, name: user.name, role: user.role } }
      }));
    } catch(_) {}
    // Create session token tied to this PIN + user + device
    this._makeSessionToken(pin, user.id).then(token => {
      sessionStorage.setItem('nexus_session_token', token);
    });
    // Don't store PIN in localStorage
    const safeUser = { ...user, pin: undefined };
    sessionStorage.setItem('nexus_current_user', JSON.stringify(safeUser));
    // Keep PIN only in memory for session verification
    this._sessionPin = pin;
    if (user.language && this.i18n && user.language !== this.i18n.getLang()) {
      localStorage.setItem('nexus_lang', user.language);
    }
    userEl.textContent = (this.i18n ? this.i18n.t('welcome') : 'Welcome,') + ' ' + user.name;
    userEl.classList.add('visible');
    this._applyRole(user.role);
    // Save PIN to biometric keychain for future fingerprint auth
    if (NX.biometric && NX.biometric.available) {
      NX.biometric.saveCredentials(pin);
    }
    // FIX: setTimeout dropped from 600ms to 0 — instant transition to clock
    // screen. The original 600ms delay was pure UX friction.
    setTimeout(() => NX.timeClock.showOnPinScreen(), 0);
  },

  // Private — not callable from console without underscore knowledge
  _applyRole(role) {
    // Must have a valid currentUser. _sessionPin is set during fresh
    // PIN login but is NOT preserved across page reload — sessionStorage
    // restore relies on the saved session token (already validated at
    // PIN login, before being saved). So gate on currentUser only;
    // the role itself comes from a server-validated user record.
    if (!this.currentUser) return;
    this.isAdmin = role === 'admin';
    this.isManager = role === 'manager' || role === 'admin';
    this.isStaff = true;
    // Galaxy access is now permission-driven (not role-driven). Admins
    // and owners still always pass via hasPermission's role bypass, but
    // managers and staff need an explicit `galaxy: true` to unlock the
    // NEXUS wordmark and the mini-galaxy on Home. CSS targets:
    //   body.no-galaxy-access #navNexus     { display: none }
    //   body.no-galaxy-access #homeMiniGalaxy { pointer-events: none }
    if (this.hasPermission && this.hasPermission('galaxy')) {
      document.body.classList.remove('no-galaxy-access');
    } else {
      document.body.classList.add('no-galaxy-access');
    }
    // Apply permission-based hide/show to nav buttons. Run on every
    // role change so a user's nav rebuilds the moment perms update.
    if (this.applyPermissionGates) this.applyPermissionGates();
  },

  // ─── PERMISSIONS ──────────────────────────────────────────────────
  // The permission system gates which top-level resources a user can
  // access. Admins and owners always pass; everyone else is gated by
  // their `permissions` JSONB column on nexus_users.
  //
  // The set of resources is fixed (see PERM_RESOURCES). New ones get
  // added here AND in admin.js's permissions matrix UI.
  //
  // Note: there is no separate "brain" permission. The brain view (the
  // canvas of knowledge nodes) and the galaxy view are the same DOM
  // element — `#brainView` rendered by galaxy.js. Access to that view
  // is the `galaxy` permission.
  //
  // Empty-perms fallback: if a user has no permissions object yet
  // (a brand-new account, or pre-Phase-D existing user before SQL
  // migration), they get a permissive default — every resource except
  // galaxy and admin. This keeps the system functional during the
  // upgrade window. As soon as an admin sets ANY explicit perms, the
  // explicit object wins and the fallback is bypassed.
  //
  // v18.32 — Added `dailylog` and `education` to the allowlist. Same
  // class of bug as the earlier Parts/Inventory issue: a new top-level
  // view was wired into navigation (nav-tab, view div, module) but the
  // permission allowlist wasn't updated, so any user with a non-empty
  // perms object got silently redirected to Home on tap. Add to
  // RES_LABELS below as well so the admin perms matrix renders the
  // checkbox column. Existing users with explicit perms will need
  // 'dailylog: true' set on their nexus_users.permissions JSONB to
  // gain access — admin panel handles this.

  PERM_RESOURCES: ['clean','log','board','cal','equipment','inventory','education','dailylog','biweekly','galaxy','admin'],

  hasPermission(resource) {
    const u = this.currentUser;
    if (!u) return false;
    // Admin and owner roles bypass the matrix entirely
    if (u.role === 'admin' || u.role === 'owner') return true;
    const perms = u.permissions || {};
    // Admin / galaxy always require explicit grant — never granted by
    // the empty-perms permissive fallback
    if (resource === 'admin' || resource === 'galaxy') {
      return perms[resource] === true;
    }
    // Empty perms object → permissive default (legacy users)
    if (!perms || Object.keys(perms).length === 0) return true;
    return perms[resource] === true;
  },

  // Hide / show every element with [data-perm="X"] based on the user's
  // current permissions. Called from _applyRole after every login or
  // role change. Also called manually after admin updates perms.
  applyPermissionGates() {
    const els = document.querySelectorAll('[data-perm]');
    els.forEach(el => {
      const resource = el.getAttribute('data-perm');
      if (!resource) return;
      const allowed = this.hasPermission(resource);
      // We toggle a class rather than display:none directly so the
      // existing nav-tab.active styling can still target hidden tabs
      // for animations / first-load states without flicker.
      el.classList.toggle('perm-denied', !allowed);
      // Also set inline display:none so layout collapses cleanly (no
      // empty slot in the bottom nav for hidden buttons).
      el.style.display = allowed ? '' : 'none';
    });
    // Galaxy access bit on body — same source of truth
    if (this.hasPermission('galaxy')) {
      document.body.classList.remove('no-galaxy-access');
    } else {
      document.body.classList.add('no-galaxy-access');
    }
  },

  async _loadConfigAndStart() {
    // Load config from Supabase
    try {
      const { data, error } = await this.sb.from('nexus_config').select('*').eq('id', 1).single();
      if (error) { 
        console.error('NEXUS config error:', error.message);
        // Table might not exist — create it
        if (error.code === 'PGRST116' || error.message.includes('not found')) {
          console.log('NEXUS: nexus_config table may not exist. Using localStorage fallback.');
        }
      }
      if (data) { this.config = data; console.log('NEXUS: Config loaded from Supabase, anthropic_key:', data.anthropic_key ? 'SET' : 'EMPTY'); }
      else { console.log('NEXUS: No config row found'); }
    } catch (e) { console.error('Config load exception:', e); }

    // ONE-TIME MIGRATION: if Supabase config is empty but localStorage has keys, push them up
    if ((!this.config || !this.config.anthropic_key) && localStorage.getItem('nexus_api_key')) {
      console.log('NEXUS: Migrating keys from localStorage to Supabase...');
      const updates = {};
      const lk = localStorage.getItem('nexus_api_key'); if (lk) updates.anthropic_key = lk;
      const le = localStorage.getItem('nexus_eleven_key'); if (le) updates.elevenlabs_key = le;
      const lg = localStorage.getItem('nexus_google_client_id'); if (lg) updates.google_client_id = lg;
      const lt = localStorage.getItem('nexus_trello_key'); if (lt) updates.trello_key = lt;
      const ltt = localStorage.getItem('nexus_trello_token'); if (ltt) updates.trello_token = ltt;
      const lm = localStorage.getItem('nexus_model'); if (lm) updates.model = lm;
      updates.updated_at = new Date().toISOString();
      try {
        const { error } = await this.sb.from('nexus_config').update(updates).eq('id', 1);
        if (!error) { 
          if (!this.config) this.config = {};
          Object.assign(this.config, updates); 
          console.log('NEXUS: Migration SUCCESS — keys now in Supabase');
        } else {
          console.error('NEXUS: Migration FAILED:', error.message);
          // Try upsert as fallback
          const { error: e2 } = await this.sb.from('nexus_config').upsert({ id: 1, ...updates });
          if (!e2) { if (!this.config) this.config = {}; Object.assign(this.config, updates); console.log('NEXUS: Migration via upsert SUCCESS'); }
          else console.error('NEXUS: Upsert also failed:', e2.message);
        }
      } catch (e) { console.error('NEXUS: Migration exception:', e); }
    }

    // Hide PIN, show app
    document.getElementById('pinScreen').classList.add('hidden');
    document.getElementById('appWrap').style.display = '';
    // PIN screen was forcing dark theme regardless of user preference
    // (see applyEffectiveTheme in preferences.js — login is always
    // dark). Now that PIN is hidden, re-resolve to the user's actual
    // persona+theme preference. The transition animates smoothly.
    try {
      if (NX.prefs && typeof NX.prefs.applyEffectiveTheme === 'function') {
        NX.prefs.applyEffectiveTheme(true);
      }
    } catch (e) { /* prefs may not be ready yet — auto-flips on first prefs load */ }
    this.syslog&&this.syslog('login',`${this.currentUser.name} (${this.currentUser.role}) logged in`);
    if (window.lucide) { lucide.createIcons(); if(this.i18n)this.i18n.applyUI(); }
    else { 
      // Wait for Lucide then apply
      const waitLucide=setInterval(()=>{
        if(window.lucide){clearInterval(waitLucide);lucide.createIcons();if(this.i18n)this.i18n.applyUI();}
      },200);
      setTimeout(()=>clearInterval(waitLucide),5000);
    }

    // Mount the floating translation button. Stays visible on every
    // view until logout. If the user's saved language is non-English,
    // mountFab() also kicks off a one-shot page translation ~800ms after
    // mount so what users see on first arrival is already in their lang.
    //
    // Reference-capture pattern: directly invoking `NX.tr.mountFab()`
    // throws "Cannot read properties of undefined (reading 'mountFab')"
    // on some mobile Chrome builds — possibly a strict-mode + optional-
    // chaining edge case after an alert dismissal in the call stack.
    // Capture the function ref locally and invoke via .call() with an
    // explicit `this` to be bulletproof.
    const mfRef = window.NX && window.NX.tr && window.NX.tr.mountFab;
    if (typeof mfRef === 'function') {
      try { mfRef.call(window.NX.tr); }
      catch(e) { console.warn('[tr] fab mount:', e); }
    }

    // ── PUSH: auto-enable for managers/admins on first login ────────
    // Staff typically don't need push — they're usually the REPORTER
    // of the ticket that would buzz their own phone. Managers + admins
    // DO need push: they need to hear about urgent issues they didn't
    // report themselves. ensurePush() is idempotent and silent if the
    // user previously declined, so no nagging on every login.
    if ((this.isAdmin || this.isManager) && NX.ensurePush) {
      setTimeout(() => {
        NX.ensurePush().then(result => {
          if (result?.ok && !result.already) {
            this.syslog && this.syslog('push_enabled', this.currentUser.name);
          }
        }).catch(() => {});
      }, 1200);
    }

    // Apply role visibility
    if (this.isAdmin || this.isManager) {
      // Note: we no longer reveal the top-nav Ingest tab. It clutters
      // the main navigation with a power-user destination most people
      // never touch. Instead, Ingest lives in the utility tray (the ☰
      // menu top-right) — discoverable when needed, out of the way
      // otherwise. The top-nav button stays display:none from HTML.
      const utilIngest = document.getElementById('utilIngest');
      if (utilIngest) {
        utilIngest.style.display = '';
        utilIngest.addEventListener('click', () => {
          // Switch to ingest view
          document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('navNexus').classList.remove('active');
          document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
          document.getElementById('ingestView').classList.add('active');
          this.activateModule('ingest');
          // Close tray
          document.getElementById('utilTray').classList.remove('open');
        });
      }
    }
    // Staff: hide board and ingest, show only cleaning + log
    if (!this.isManager && !this.isAdmin) {
      document.querySelector('[data-view="board"]').style.display = 'none';
    }

    // v18.29 — Utility-tray "Transactions" button. Opens the cross-
    // vendor order history overlay. This used to live on the Duties
    // home tab as a scrolling block, but that always-on placement
    // duplicated info already available inside each vendor's detail
    // screen. As an on-demand overlay it's discoverable + out of the
    // way. Available to every role (no admin gate).
    //
    // v18.32 — `NX.openAllTransactions` is defined in `ordering.js`,
    // which is lazy-loaded only when the user first enters the Cleaning
    // view (see activateModule's 'clean' branch). Before this fix, if
    // a user tapped Transactions before ever opening Cleaning in their
    // session — easy to do from the Duties speed-dial — the handler
    // hit a silent console.warn and the modal never opened. Now: if
    // openAllTransactions isn't on NX yet, lazy-load ordering.js first,
    // then call it. Loading is idempotent (`loaded` map dedupes), so
    // subsequent clicks pay no cost.
    const utilTransactions = document.getElementById('utilTransactions');
    if (utilTransactions) {
      const self = this;
      utilTransactions.addEventListener('click', () => {
        document.getElementById('utilTray').classList.remove('open');
        const fire = () => {
          if (window.NX && typeof window.NX.openAllTransactions === 'function') {
            window.NX.openAllTransactions();
          } else {
            console.warn('[app] openAllTransactions still unavailable after ordering.js load');
            if (NX.toast) NX.toast('Transactions overlay failed to load — try once more', 'warn');
          }
        };
        if (typeof window.NX.openAllTransactions === 'function') {
          fire();
        } else {
          // Not loaded yet — load ordering.js then call. Avoid duplicate
          // loads by checking self.loaded.clean (ordering.js piggybacks
          // on the clean-view lazy-load chain).
          if (self.loaded && self.loaded.clean) {
            // clean was loaded but ordering.js failed somehow — still try
            self.loadScript('js/ordering.js', fire);
          } else {
            self.loadScript('js/ordering.js', fire);
          }
        }
      });
    }

    // Continue with normal init
    this.loadNodes().then(() => {
      // Load AI context systems
      this.loadGlossary();
      this.loadAliases();
      this.loadCriticalFacts();
      // Load preferences module FIRST so persona/theme/voice are
      // synced from Supabase before brain-chat reads them. NX.prefs
      // hydrates from DB and applies the effective theme on first paint.
      this.loadScript('js/preferences.js', () => {
        // Init is async but non-blocking — UI can render with defaults
        // while DB row loads. brain-chat reads via NX.prefs.* so it
        // gets the live value once init resolves.
        if (NX.prefs && NX.prefs.init) NX.prefs.init();
        this.loadScript('js/galaxy.js', () => {
          this.loadScript('js/brain-list.js', () => {
            this.loadScript('js/brain-events.js', () => {
              this.loadScript('js/ai-writer.js', () => {
                // Load memory module BEFORE brain-chat so window.MEMORY exists
                this.loadScript('js/brain-chat-memory.js', () => {
                  this.loadScript('js/brain-chat.js', () => {
                    NX.brain.init();
                  });
                });
              });
            });
          });
        });
      });
    });
    this.setupNav();
    this.setupMasthead();
    this.setupAdmin();

    // ─── PUSH NOTIFICATIONS — Stage T ───────────────────────────────
    // Register FCM push now that the user is logged in. This triggers
    // the native permission dialog (on APK only — on PWA it's a no-op).
    // Deferred 1s so the login animation completes first, and so any
    // token that arrives has a valid NX.currentUser to attach to.
    setTimeout(() => {
      if (NX.pushNotify && NX.pushNotify.register) {
        NX.pushNotify.register().then(() => {
          // If this is a re-login on the same device, re-upload any
          // cached token so future pushes route to this user
          NX.pushNotify._flushPendingToken?.();
        });
      }
    }, 1000);
    // Time clock nav widget
    NX.timeClock.setupNavWidget();
    // Ticket badge
    this.checkTicketBadge();
    // PM pending logs badge — initial + every 60s while app is open
    setTimeout(() => this.refreshPmPendingCount(), 2000);
    setInterval(() => this.refreshPmPendingCount(), 60000);

    // ─── POST-LOGIN: ?equip=XXX redirect ────────────────────────────
    // If the user arrived at the PIN screen because they tapped
    // "Login" from the public PM page (URL contains ?equip=XXX),
    // shoot them directly to that equipment's detail view instead
    // of dumping them on Home. Makes the scan → login → detail flow
    // feel continuous rather than three separate destinations.
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const equipQr = urlParams.get('equip');
      const invAssetQr = urlParams.get('inv-asset');
      const invStockQr = urlParams.get('inv-stock');
      if (equipQr) {
        // Clean the URL so a later refresh doesn't re-trigger this jump
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        // Defer so the equipment module is fully loaded before we try
        // to open the detail; switchTo('equipment') lazy-loads it.
        setTimeout(async () => {
          if (!this.switchTo) return;
          this.switchTo('equipment');
          // Wait briefly for equipment.js modules to register
          const waitForMod = (tries = 20) => {
            if (NX.modules?.equipment?.openDetailByQr) {
              NX.modules.equipment.openDetailByQr(equipQr);
            } else if (NX.modules?.equipment?.openDetail) {
              // Fallback: look up by qr_code then open by id
              NX.sb.from('equipment')
                .select('id')
                .eq('qr_code', equipQr)
                .maybeSingle()
                .then(({ data }) => {
                  if (data?.id) NX.modules.equipment.openDetail(data.id);
                });
            } else if (tries > 0) {
              setTimeout(() => waitForMod(tries - 1), 150);
            }
          };
          waitForMod();
        }, 300);
      } else if (invAssetQr || invStockQr) {
        // Inventory QR scan flow (Phase C): same idea as equipment, but
        // route to the inventory module's detail-by-id helpers. The
        // inventory module also has its own scan-redirect handler in
        // init() that catches this same URL — but the app-level one
        // here ensures we land on the inventory tab even if the module
        // was loaded with stale URL state.
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        const qr = invAssetQr || invStockQr;
        const isAsset = !!invAssetQr;
        setTimeout(async () => {
          if (!this.switchTo) return;
          this.switchTo('inventory');
          const waitForMod = (tries = 20) => {
            const mod = NX.modules?.inventory;
            if (!mod) {
              if (tries > 0) setTimeout(() => waitForMod(tries - 1), 150);
              return;
            }
            // Look up by qr_code then defer to module's by-id opener
            const table = isAsset ? 'inventory_assets' : 'inventory_stock_with_status';
            NX.sb.from(table).select('id').eq('qr_code', qr).maybeSingle()
              .then(({ data }) => {
                if (!data) {
                  NX.toast?.('Item not found: ' + qr, 'warn');
                  return;
                }
                if (isAsset) mod.openAssetDetailById?.(data.id);
                else mod.openStockDetailById?.(data.id);
              });
          };
          waitForMod();
        }, 300);
      }
    } catch (e) {
      console.warn('[app] post-login equip redirect failed:', e);
    }

    // Start real-time watchers
    this.startNodeWatcher();
    this.loadAgenda();
    // Brain view toggle — managers + admin only
    this.setupBrainViewToggle();
    // Wire cleaning scan button — weekly scanner (3 photos).
    // Function is also exposed as NX.cleaningScan so the consolidated
    // cleaning action sheet can call it directly without needing the
    // legacy footer button to exist in the DOM.
    NX.cleaningScan = async function() {
      try {
        if (NX.scanWeeklyChecklist) { await NX.scanWeeklyChecklist(); }
        else if (NX.scanChecklist) { await NX.scanChecklist(); }
      } catch(e) { NX.toast('Scan error: '+e.message, 'error'); }
    };
    const scanBtn = document.getElementById('cleanScan');
    if (scanBtn) {
      scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true; scanBtn.textContent = '...';
        await NX.cleaningScan();
        scanBtn.disabled = false; scanBtn.textContent = 'Scan';
      });
    }
    // Wire print/export checklist button. Same pattern — also exposed
    // as NX.cleaningPrint for the consolidated action sheet to invoke.
    NX.cleaningPrint = function() {
        const tasks = NX.cleaningTasks;
        if (!tasks) { NX.toast('Tasks not loaded', 'error'); return; }
        const activeLoc = document.querySelector('.clean-tab.active')?.dataset?.cloc || 'suerte';
        const locTasks = tasks[activeLoc] || [];
        const locName = activeLoc.charAt(0).toUpperCase() + activeLoc.slice(1);
        const days = ['LUN','MAR','MIE','JUE','VIE','SAB','DOM'];

        // Also include custom tasks
        let customTasks = {};
        try { customTasks = JSON.parse(localStorage.getItem('nexus_custom_tasks') || '{}'); } catch(e) {}
        const customs = customTasks[activeLoc] || [];

        let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>NEXUS — ${locName} Cleaning</title>
<style>
@page{size:legal landscape;margin:0.3in}
body{font-family:Arial,sans-serif;color:var(--text);margin:0;padding:20px;position:relative}
h1{font-size:24px;margin:0;color:#000}
.sub{font-size:12px;color:var(--faint);margin-bottom:4px}
.url{font-size:7px;color:#999}
.qr{position:absolute;top:12px;right:20px;width:32px;height:32px}
.gold-line{height:2px;background:#999;margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#444;color:#fff;padding:8px;font-size:10px}
th.day{width:42px;font-size:7px}
.sec{background:#D9D9D9;font-size:14px;font-weight:bold;padding:10px;text-align:left}
td{padding:8px;border:1px solid #BBB}
td.task-es{font-size:13px;font-weight:500}
td.task-en{font-size:10px;color:var(--faint)}
td.check{text-align:center;font-size:18px;color:#CCC;background:#F5F5F5;width:38px}
tr:nth-child(even) td{background:var(--surface)}
tr:nth-child(odd) td{background:var(--bg)}
td.check{background:#F0EDE6 !important}
.footer{margin-top:12px;font-size:10px;color:var(--muted);display:flex;justify-content:space-between}
.custom-tag{font-size:8px;color:#999;margin-left:4px}
</style></head><body>
<h1>NEXUS — ${locName.toUpperCase()}</h1>
<div class="sub">Lista de Limpieza / Cleaning Checklist</div>
<div class="url">Scan QR to log</div><img class="qr" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAD4AAAA+CAIAAAD8oz8TAAAB0UlEQVR4nO2aMU4FMQxE+Ygb0dBw+t/QcKalMEIjWTOMvUhgL9OwCo5/9JJ4HWdvx3E8zNTjbw+gr6f48/rybHa4v71/PUev3IKWaMOee2OYTz2EDLIyFeSn1ZtV7WcL9RCj69jo1ax9Vsewi7qjvMoZY92O3qq6HvWQXtNsZrJNT7uo+yScdZw9OzvEGcMW6v47z8lMdIxnb2J/DPOp93Y6I6Tb9Tz4mk+9lxWijV7lTPqdqrOg+dSZqhRRupcf45nPvdQ1FYdTyGGfn/U8D6Z+y3UY/5TEZoDVBRzpegG2DKb+TR2GUXQsmefeSRctt0QYnwRT76zZ2wOh+dRDbKVWq4Q63uvc3c9G51PXkdivY7Fe/prW2hXXnRzDOV/mGfBzRuYBtSuuM/m5StZP7QFmP5j6Z+box+9qFunIPx/hGOZTDzk1cj/LY339udX286lXmeF/Q36e48cWvfrnU6/KOX1W77Wzf+15MPVT3whom+qdR/XNPZ96qHqDjO3+Scdf8VlL4nrzGwFsZ9m8ngH9i/l3/78RqGSFeh501SA/Y6/rUT+fwesdonuFdlE/c4eKtxHZp1/tuUZ9PXSmRuXnLb3TFvoZH2Ga+fpf0GDqH5sjFdchMQYsAAAAAElFTkSuQmCC" alt="QR">
<div class="gold-line"></div>
<table><tr><th>TAREA</th><th>TASK</th>`;
        days.forEach(d => { html += `<th class="day">${d}</th>`; });
        html += '</tr>';

        locTasks.forEach(sec => {
          const secName = sec.sec;
          html += `<tr><td class="sec" colspan="${2 + days.length}">${secName.toUpperCase()}</td></tr>`;
          sec.items.forEach(item => {
            html += `<tr><td class="task-es">${item[0]}</td><td class="task-en">${item[1]}</td>`;
            days.forEach(() => { html += '<td class="check">☐</td>'; });
            html += '</tr>';
          });
          // Append custom tasks for this section
          customs.filter(c => c.section === secName).forEach(ct => {
            html += `<tr><td class="task-es">${ct.es}<span class="custom-tag">★</span></td><td class="task-en">${ct.en}<span class="custom-tag">★</span></td>`;
            days.forEach(() => { html += '<td class="check">☐</td>'; });
            html += '</tr>';
          });
        });

        // Custom tasks in new sections
        const existingSecs = new Set(locTasks.map(s => s.sec));
        const newSecCustoms = customs.filter(c => !existingSecs.has(c.section));
        const newSecs = [...new Set(newSecCustoms.map(c => c.section))];
        newSecs.forEach(secName => {
          html += `<tr><td class="sec" colspan="${2 + days.length}">${secName.toUpperCase()} ★</td></tr>`;
          newSecCustoms.filter(c => c.section === secName).forEach(ct => {
            html += `<tr><td class="task-es">${ct.es}</td><td class="task-en">${ct.en}</td>`;
            days.forEach(() => { html += '<td class="check">☐</td>'; });
            html += '</tr>';
          });
        });

        html += `</table>
<div class="footer"><span>Nombre / Name: __________________ Firma / Signature: __________________</span><span>Semana / Week: __________</span></div>
<div style="text-align:center;font-size:7px;color:var(--faint);margin-top:8px">NEXUS — Generated ${new Date().toLocaleDateString()} — Use dry-erase marker, scan to log</div>
</body></html>`;

        const printWin = window.open('', '_blank');
        if (printWin) {
          printWin.document.write(html);
          printWin.document.close();
          setTimeout(() => printWin.print(), 500);
        } else {
          NX.toast('Pop-up blocked — allow pop-ups to print', 'warn');
        }
    };
    // Legacy button wiring (silently no-ops once index.html drops the
    // footer button in favor of the consolidated action sheet).
    const exportBtn = document.getElementById('cleanExport');
    if (exportBtn) exportBtn.addEventListener('click', NX.cleaningPrint);
    // Morning briefing — show pending items on login
    setTimeout(() => this.showBriefing(), 2000);
    // Auto-scan if triggered by QR code
    if (this._pendingScan) {
      this._pendingScan = false;
      setTimeout(() => {
        // Switch to cleaning view
        const cleanBtn = document.querySelector('.bnav-btn[data-view="clean"]') || document.querySelector('.nav-tab[data-view="clean"]');
        if (cleanBtn) cleanBtn.click();
        // Trigger scan after view loads
        setTimeout(() => {
          if (NX.scanWeeklyChecklist) NX.scanWeeklyChecklist();
          else if (NX.scanChecklist) NX.scanChecklist();
        }, 1500);
      }, 2000);
    }
    // Apply translations after Lucide icons render
    if (this.i18n) {
      setTimeout(()=>{if(this.i18n)this.i18n.applyUI();},500);
      setTimeout(()=>{if(this.i18n)this.i18n.applyUI();},1500);
    }
  },

  // ═══ INIT ═══
  async init() {
    this.sb = supabase.createClient(this.SUPA_URL, this.SUPA_KEY);
    if(window.NEXUS_I18N) { this.i18n = NEXUS_I18N; this.i18n.applyUI(); }
    // Test Supabase connection. Phase B locked down direct SELECT on
    // nexus_users, so we ping the verify_pin RPC with an invalid PIN.
    // It returns null fast, doesn't write data, and confirms both DB
    // connectivity AND that the auth RPC is reachable.
    this.sb.rpc('verify_pin', { p_pin: '___probe___' }).then(({error})=>{
      const err=document.getElementById('pinError');
      if(error){
        console.error('NEXUS Supabase:', error.message);
        if(err) err.textContent='DB: '+error.message;
      }
    }).catch(e=>{
      const err=document.getElementById('pinError');
      if(err) err.textContent='No connection to server';
    });
    // Skip PIN screen setup if this is a public QR scan — the public scan
    // detector will render its own UI over the page body
    if (window._NX_PUBLIC_SCAN) {
      console.log('[app] public scan active, skipping PIN setup');
      return;
    }
    await this.setupPinScreen();
  },

  // ─── Nav ───
  setupNav() {
    const tabs = document.querySelectorAll('.nav-tab');
    const bnavBtns = document.querySelectorAll('.bnav-btn');
    const nexusBtn = document.getElementById('navNexus');
    const switchTo = (view) => {
      // Permission gate — deny-then-redirect for forbidden views.
      // Home is always allowed. The check happens BEFORE any UI state
      // changes so a denied tap is a no-op visually (nav doesn't even
      // flicker). For galaxy/admin/etc the user shouldn't have seen
      // the button at all (applyPermissionGates hid it), but a stale
      // bookmark or programmatic call could still try — so guard here.
      if (view !== 'home' && this.hasPermission && !this.hasPermission(view)) {
        if (NX.toast) NX.toast('No access to that section', 'warn');
        view = 'home';
      }
      // Stop any playing speech
      if('speechSynthesis'in window)speechSynthesis.cancel();
      if(NX.brain&&NX.brain.stopSpeaking)NX.brain.stopSpeaking();
      // Close node panel
      const np=document.getElementById('nodePanel');if(np)np.classList.remove('open');
      // Clear active on ALL nav buttons (top + bottom)
      tabs.forEach(t => t.classList.remove('active'));
      bnavBtns.forEach(b => b.classList.remove('active'));
      nexusBtn.classList.remove('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      // Sync body class for view-aware CSS (e.g. chat HUD only shows on brain)
      document.body.classList.remove('view-brain','view-clean','view-log','view-board','view-cal','view-equipment','view-ingest','view-inventory');
      document.body.classList.add('view-' + view);
      // Set active on correct buttons
      if (view === 'brain') { nexusBtn.classList.add('active'); }
      else { const tab = document.querySelector(`.nav-tab[data-view="${view}"]`); if (tab) tab.classList.add('active'); }
      // Also activate bottom nav button
      const bnav = document.querySelector(`.bnav-btn[data-view="${view}"]`);
      if (bnav) bnav.classList.add('active');
      // Guard: an unknown/misspelled view name must not throw here (a
      // null .classList would blank the whole app, since every .view was
      // just deactivated above). Fall back to home if the target view
      // element doesn't exist.
      const _viewEl = document.getElementById(view + 'View');
      if (_viewEl) {
        _viewEl.classList.add('active');
        this.activateModule(view);
      } else {
        console.warn('[app] switchTo: no view element for "' + view + '" — falling back to home');
        const _home = document.getElementById('homeView');
        if (_home) _home.classList.add('active');
        this.activateModule('home');
      }
      // Re-apply language after view switch
      if(this.i18n)setTimeout(()=>this.i18n.applyUI(),100);
    };
    // Bind top nav tabs. Action tabs (data-nav-action, e.g. Ordering /
    // Transactions / Clock) have no data-view — they route through
    // dutiesDispatch below, so skip them here (switchTo(undefined) would
    // bounce to home).
    tabs.forEach(tab => tab.addEventListener('click', () => { if (tab.dataset.view) switchTo(tab.dataset.view); }));
    // Bind bottom nav buttons — EXCEPT duties (data-view="clean"), which
    // is special-cased below to open the speed-dial instead of navigating.
    bnavBtns.forEach(btn => {
      if (btn.dataset.view === 'clean') return;     // skip — wired below
      if (btn.dataset.equipDial) return;            // skip — opens the Equip speed-dial
                                                    // (wired in index.html). Must NOT also
                                                    // switchTo('equipment'), or the view loads
                                                    // in the background behind the dial and the
                                                    // dial's own "Equipment" item then no-ops.
      btn.addEventListener('click', () => switchTo(btn.dataset.view));
    });
    // Wire NEXUS wordmark → go to brain
    nexusBtn.addEventListener('click', () => switchTo('brain'));
    // Expose switchTo globally — home.js stat tiles (tickets, overdue,
    // services, nodes) and other modules use NX.switchTo(view) to
    // navigate. Without this, every stat-tile tap is a silent no-op.
    NX.switchTo = switchTo;

    // ─── SPEED-DIAL HELPER (reusable) ────────────────────────────────
    // Wires a `.nx-speed-dial` overlay to a trigger button. Generic enough
    // to be reused: a single helper owns the open/close/toggle/dismiss
    // behavior, and you pass a callback for what to do when an action
    // is picked.
    //
    //   NX.bindSpeedDial(triggerEl, dialEl, onAction)
    //
    // - triggerEl: the button that toggles the dial (gets `.is-dial-open`)
    // - dialEl:    the `<div class="nx-speed-dial">` overlay element
    // - onAction:  function(target, actionEl) called when an action is tapped
    //
    // Returns { open, close, toggle, isOpen }.
    //
    // The helper handles: backdrop dismiss, ESC-to-close, click on action
    // buttons, ARIA aria-hidden, and the state class on the trigger.
    function bindSpeedDial(triggerEl, dialEl, onAction) {
      if (!triggerEl || !dialEl) return null;

      const open = () => {
        dialEl.classList.add('is-open');
        dialEl.setAttribute('aria-hidden', 'false');
        triggerEl.classList.add('is-dial-open');
      };
      const close = () => {
        dialEl.classList.remove('is-open');
        dialEl.setAttribute('aria-hidden', 'true');
        triggerEl.classList.remove('is-dial-open');
      };
      const isOpen = () => dialEl.classList.contains('is-open');
      const toggle = () => { isOpen() ? close() : open(); };

      // Trigger toggle
      triggerEl.addEventListener('click', (e) => {
        e.preventDefault();
        toggle();
      });

      // Backdrop dismiss
      const backdrop = dialEl.querySelector('[data-dial-close]');
      if (backdrop) backdrop.addEventListener('click', close);

      // Action buttons
      dialEl.querySelectorAll('.nx-speed-dial-action').forEach(actionEl => {
        actionEl.addEventListener('click', () => {
          const target = actionEl.dataset.target;
          close();
          if (typeof onAction === 'function') {
            try { onAction(target, actionEl); }
            catch (err) { console.error('[speed-dial] action handler failed:', err); }
          }
        });
      });

      // ESC key (global — closes whichever dial is open)
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) close();
      });

      return { open, close, toggle, isOpen };
    }
    NX.bindSpeedDial = bindSpeedDial;

    // ─── DUTIES SPEED-DIAL (uses the helper above) ──────────────────
    // Tap Duties → opens speed-dial with Cleaning + Ordering.
    // Pick one → dial closes, view switches to clean, pane activates.
    //
    // Race-free wiring (was previously buggy: 80ms setTimeout could miss
    // duties.init() if module loaded slower than that, and even when it
    // didn't, init() would run readPersisted() and override our target
    // with the *previously*-active pane). Belt-and-suspenders fix:
    //
    //   1. Persist the chosen target to localStorage IMMEDIATELY, before
    //      switchTo triggers the lazy-load. duties.init() reads this
    //      same key, so whichever order things happen, it lands right.
    //   2. Also explicitly call activatePane after a short tick — covers
    //      the case where duties.js was already loaded and init() won't
    //      re-fire, so we need to push the new state ourselves.
    const dutiesDial = document.getElementById('dutiesDial');
    const dutiesBtn  = document.querySelector('.bnav-btn[data-view="clean"]');
    const dutiesDispatch = (target) => {
      // v18.32 Phase 1 — Dial now handles only the items that stayed
      // here after Theme/Log/Settings/Prefs moved to the restored
      // masthead ☰: nav fallbacks (Cal, Education) and the two utility
      // popups that aren't useful in the mast row (Transactions, Clock).
      // The mast-routed items don't need cases here anymore — their
      // buttons no longer exist in the dial.
      if (target === 'cal' || target === 'education' || target === 'dailylog' || target === 'biweekly') {
        switchTo(target);
        return;
      }
      if (target === 'transactions') {
        // The #utilTransactions util-button was removed, so the old
        // `.click()` was a silent no-op (Transactions never opened from the
        // dial OR the desktop rail). Call the real entry, lazy-loading
        // ordering.js the first time if it isn't in yet.
        const openTx = () => {
          if (typeof NX.openAllTransactions === 'function') NX.openAllTransactions();
          else if (NX.toast) NX.toast('Transactions failed to load — try again', 'warn');
        };
        if (typeof NX.openAllTransactions === 'function') openTx();
        else NX.loadScript('js/ordering.js', openTx);
        return;
      }
      if (target === 'clock') {
        document.getElementById('navClock')?.click();
        return;
      }
      // Training is its OWN top-level view — not a Duties pane like
      // Cleaning and Ordering. The HTML comment claimed this dispatcher
      // already handled it; in fact, the special case was never written,
      // so every speed-dial tap (including Training) fell through to
      // switchTo('clean'). That's why "Training redirected to cleaning."
      //
      // Route 'train' to the Education view (modules = categories,
      // lessons = guides) since the legacy training_modules table was
      // retired in v15. Cleaning + Ordering remain Duties panes.
      if (target === 'train') {
        switchTo('education');
        return;
      }
      // (1) Persist FIRST so any imminent duties.init() reads the right pane.
      try { localStorage.setItem('nexus_duties_active_pane', target); } catch(_){}
      switchTo('clean');
      // (2) If duties.js was already loaded (re-tap of speed-dial after
      // first navigation), init() won't re-run — push the state manually.
      // The 80ms gives lazy-load enough room on first activation; if
      // activatePane isn't ready yet, the persisted value above ensures
      // init() picks it up when it does fire. Either path lands correctly.
      setTimeout(() => {
        if (NX.modules && NX.modules.duties && NX.modules.duties.activatePane) {
          NX.modules.duties.activatePane(target);
        }
      }, 80);
    };
    bindSpeedDial(dutiesBtn, dutiesDial, dutiesDispatch);
    // Desktop sidebar "action" tabs (Ordering / Transactions / Clock) reuse the
    // EXACT phone speed-dial routing, so the rail reaches everything the dial
    // does — the duties panes plus the two utility popups. They carry
    // data-nav-action (not data-view), so the switchTo binding skips them.
    document.querySelectorAll('.nav-tab[data-nav-action]').forEach(b =>
      b.addEventListener('click', () => dutiesDispatch(b.dataset.navAction)));
    // ──────────────────────────────────────────────────────────────────
    // ─── DEFAULT LANDING VIEW: Home ──────────────────────────────────
    // The first thing after login is the Home dashboard (mini-galaxy,
    // clock-in card, priority feed). The brain/galaxy full view is
    // behind the NEXUS wordmark for people who want to dive in.
    // index.html already marks #homeView as .view.active — we just
    // need to sync the nav state + activate the module.
    const homeBtn = document.querySelector('.bnav-btn[data-view="home"]');
    if (homeBtn) homeBtn.classList.add('active');
    // Also activate the top-nav Home tab so the initial state is in
    // sync. Without this, the user lands on Home but the top nav has
    // nothing highlighted, which reads as "you're nowhere."
    const homeTopTab = document.querySelector('.nav-tab[data-view="home"]');
    if (homeTopTab) homeTopTab.classList.add('active');
    document.body.classList.add('view-home');
    this.activateModule('home');
  },

  // ═══ MASTHEAD ═══
  // Wire the unified top masthead — coin (left), NEXUS+date (center),
  // hamburger (right). Replaces both the legacy nav-nexus pill chrome
  // AND the per-view "NEXUS / date" duplicate rows that used to live
  // inside home, brain, etc.
  //
  // Three responsibilities:
  //   1. Tick the live date/time display every minute.
  //   2. Wire the coin to the AI activity pulse system (NX.coin API).
  //   3. Wire coin tap behavior — admins navigate to brain view, non-
  //      admins flip the coin as ornamental feedback.
  // ═══ PHASE 1 — TWO PERSONAS (Providentia & Trajan) ═══════════════════
  // Source of truth for the active persona this session. Read via
  // NX.getActivePersona(); change via NX.flipCoin() or NX.setActivePersona().
  // Both write through to localStorage AND nexus_users.default_persona,
  // and broadcast the 'nx-persona-change' event so brain-chat.js,
  // chat-view.js, and the masthead coin face all stay in sync.
  //
  // Fallback chain on first read:
  //   1. NX._activePersona (already set this session)
  //   2. NX.currentUser.default_persona (returned by verify_pin RPC)
  //   3. localStorage 'nexus_active_persona' (mirror, survives reloads)
  //   4. 'providentia' (default for new users)
  //
  // Voice/system-prompt switching is automatic: setActivePersona()
  // looks up the persona's voice in the merged voices list (custom
  // voices added via "Bring to life") and updates voice_idx. The
  // existing speak() and getPERSONA() in brain-chat.js then pick up
  // both the right voice ID *and* the right systemPrefix without any
  // further wiring.
  _initActivePersona() {
    // Auto-register both personas to nexus_custom_voices if missing.
    // The voice IDs are hardcoded — no "Bring to Life" ceremony needed.
    // The user can still TEST a voice in admin, but the persona system
    // works without that step.
    this._ensurePersonasRegistered();

    // Resolve persona — priority order:
    //   1. Login coin pre-selection (if user flipped coin on PIN screen
    //      before logging in, honor that choice for this session)
    //   2. Supabase nexus_users.default_persona (cross-device default)
    //   3. localStorage active persona (last choice on this device)
    //   4. 'providentia' (system default)
    let persona = null;

    // 1. Login coin pre-selection
    const loginChoice = sessionStorage.getItem('nexus_login_coin_choice');
    if (loginChoice === 'providentia' || loginChoice === 'trajan') {
      persona = loginChoice;
      // Clear it — only applies to this login. After this, the
      // Supabase / localStorage values take over for future logins.
      sessionStorage.removeItem('nexus_login_coin_choice');
    }

    // 2. Supabase
    if (!persona && this.currentUser && this.currentUser.default_persona) {
      const dp = String(this.currentUser.default_persona).toLowerCase();
      if (dp === 'providentia' || dp === 'trajan') persona = dp;
    }

    // 3. localStorage
    if (!persona) {
      const ls = localStorage.getItem('nexus_active_persona');
      if (ls === 'providentia' || ls === 'trajan') persona = ls;
    }

    // 4. Default
    if (!persona) persona = 'providentia';

    // If persona came from the login coin, persist it so subsequent
    // logins on this device honor the choice. Otherwise just apply.
    const fromLoginCoin = !!loginChoice;
    this.setActivePersona(persona, {
      silent: !fromLoginCoin,        // suppress "voice not activated" toast on init
      persist: fromLoginCoin,        // only write to Supabase if user actively chose
    });
  },

  // Auto-register personas to nexus_custom_voices using hardcoded voice
  // IDs + tuning. Idempotent — only writes entries that are missing.
  // Eliminates the "Bring to Life" friction; the personas are alive
  // from the moment the app boots.
  _ensurePersonasRegistered() {
    // Canonical persona definitions — single source of truth. Mirrors
    // the PERSONAS object inside admin.setupAdmin(); kept here so the
    // persona system works before admin module is opened.
    const CANONICAL = {
      providentia: {
        name: 'Providentia',
        blurb: 'Senior advisor · the coin reverse',
        id: 'L0N1xQrEBaR6SGctgc28',
        stability: 0.78,
        similarity: 0.85,
        style: 0.20,
        speed: 1.05,
      },
      trajan: {
        name: 'Trajan',
        blurb: 'Father-emperor · the coin obverse',
        id: 'JgL2ebuu6rJHIcKBML4x',
        stability: 0.72,
        similarity: 0.85,
        style: 0.28,
        speed: 1.05,
      },
    };
    try {
      const raw = localStorage.getItem('nexus_custom_voices');
      let customs = raw ? (JSON.parse(raw) || []) : [];
      let changed = false;
      Object.values(CANONICAL).forEach(p => {
        const existing = customs.findIndex(v => v && v.name === p.name);
        if (existing < 0) {
          customs.push(p);
          changed = true;
        } else if (!customs[existing].id || customs[existing].id !== p.id) {
          // Repair: someone activated with a placeholder/old ID.
          // Update to the canonical one.
          customs[existing] = { ...customs[existing], ...p };
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem('nexus_custom_voices', JSON.stringify(customs));
        console.log('[NX] Personas registered automatically — no Bring-to-Life required');
      }
    } catch(err) {
      console.warn('[NX] Persona auto-register failed:', err.message);
    }
  },

  getActivePersona() {
    return this._activePersona || 'providentia';
  },

  setActivePersona(persona, opts) {
    if (persona !== 'providentia' && persona !== 'trajan') return;
    const o = opts || {};
    const prev = this._activePersona;
    this._activePersona = persona;
    // Local mirror so reloads / other tabs see the choice immediately
    try { localStorage.setItem('nexus_active_persona', persona); } catch(_) {}

    // ── Sync voice_idx if this persona's voice is registered in
    //    nexus_custom_voices (i.e. user tapped "Bring to life" in admin).
    //    Without that activation, voice_idx is left as-is and speak()
    //    will use whatever voice was previously selected. The system
    //    prompt prefix won't apply automatically in that case — but
    //    we still flip the persona name + coin face so the user gets
    //    visible feedback.
    // ── Sync voice for the new persona. Voices are auto-registered
    //    on app boot via _ensurePersonasRegistered, so this lookup
    //    should always succeed. If it doesn't (corrupted localStorage
    //    or first-time race), recover by re-registering and trying
    //    again — silent self-heal, no user-facing error.
    const trySync = () => {
      try {
        const customs = JSON.parse(localStorage.getItem('nexus_custom_voices') || '[]');
        const targetName = persona === 'providentia' ? 'Providentia' : 'Trajan';
        const customIdx = customs.findIndex(v => v && v.name === targetName);
        if (customIdx >= 0) {
          const finalIdx = 20 + customIdx;
          localStorage.setItem('nexus_voice_idx', finalIdx);
          if (this.config) this.config.voice_idx = finalIdx;
          // Legacy: nexus_config is a single shared row (id=1) — all users
          // on a device write to it, overwriting each other. Kept here for
          // backward compat with code that still reads from this.config.
          try { this.sb && this.sb.from('nexus_config').update({ voice_idx: finalIdx }).eq('id', 1); } catch(_) {}
          // Authoritative: write to user_preferences (per-user, per-device).
          // This is what survives across logins and devices correctly.
          if (NX.prefs && NX.prefs.set) {
            try { NX.prefs.set({ voice_idx: finalIdx }, { silent: true }).catch(()=>{}); } catch(_) {}
          }
          return true;
        }
      } catch(_) {}
      return false;
    };

    if (!trySync()) {
      // Self-heal: re-register and retry once.
      this._ensurePersonasRegistered();
      if (!trySync()) {
        // Genuinely stuck — log to console for debugging but don't
        // toast the user (the visual coin flip still completes).
        console.warn('[NX] Voice sync failed for', persona, '— check nexus_custom_voices in localStorage');
      }
    }

    // ── Sync masthead coin face. HTML has front=trajan, back=providentia.
    //    The CSS `.flipped` class on .nx-mast-coin-flip shows the back face.
    const flip = document.querySelector('#mastCoin .nx-mast-coin-flip');
    if (flip) {
      if (persona === 'providentia') flip.classList.add('flipped');
      else flip.classList.remove('flipped');
    }

    // ── Sync masthead persona label (sits directly under the coin).
    //    Updated in lockstep with the coin face so the name and the
    //    visible side of the coin always agree.
    const personaLabel = document.getElementById('mastPersona');
    if (personaLabel) {
      personaLabel.textContent = persona === 'trajan' ? 'TRAJAN' : 'PROVIDENTIA';
      personaLabel.setAttribute('data-persona', persona);
    }

    // ── Persist to Supabase nexus_users.default_persona unless caller
    //    asked us to skip (e.g. _initActivePersona on login — that's a
    //    READ of the persisted value, no need to write it back).
    if (o.persist !== false && this.currentUser && this.currentUser.id != null && this.sb) {
      try {
        this.sb.from('nexus_users').update({ default_persona: persona }).eq('id', this.currentUser.id).then(() => {});
      } catch(_) {}
      // Also write through to user_preferences (per-device).
      // NX.prefs handles theme=auto coupling so the theme cross-fades
      // automatically when persona changes. Animated flag determines
      // whether the transition runs the smooth cross-fade or snaps.
      if (NX.prefs && NX.prefs.set) {
        try {
          NX.prefs.set({ persona }, { animated: o.animated !== false }).catch(()=>{});
        } catch(_) {}
      }
    }

    // ── Cinematic coin flip — only when explicitly animated (a user
    //    gesture). Initial-load persona application skips this so the
    //    coin doesn't spin on every reload.
    if (o.animated !== false && o.persist !== false && prev && prev !== persona) {
      if (NX.prefs && NX.prefs.playCinematicFlip) {
        try { NX.prefs.playCinematicFlip(); } catch(_) {}
      }
    }

    // ── Broadcast — brain-chat.js, chat-view.js, anything else listens
    if (prev !== persona) {
      try {
        document.dispatchEvent(new CustomEvent('nx-persona-change', { detail: { persona, prev } }));
      } catch(_) {}
    }
  },

  flipCoin() {
    const cur = this.getActivePersona();
    const next = cur === 'providentia' ? 'trajan' : 'providentia';
    // animated:true → cinematic spin + theme cross-fade. This is the
    // marquee gesture, so it gets the full ~700ms moment.
    this.setActivePersona(next, { persist: true, animated: true });
    const msg = next === 'trajan' ? 'Trajan summoned.' : 'Providentia returns.';
    if (NX.toast) NX.toast(msg, 'info');
  },

  setupMasthead() {
    // ── Live date/time ticker ───────────────────────────────────────
    const dateEl = document.getElementById('mastDate');
    const tickDate = () => {
      if (!dateEl) return;
      const now = new Date();
      const day  = ['SUN','MON','TUE','WED','THU','FRI','SAT'][now.getDay()];
      const mon  = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][now.getMonth()];
      const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toUpperCase();
      dateEl.textContent = `${day} · ${mon} ${now.getDate()} · ${time}`;
    };
    tickDate();
    // Re-tick every 30s so the minute display stays current without
    // burning timers. Drift is acceptable; precision isn't the point.
    setInterval(tickDate, 30000);

    // ── Coin pulse + listening API ──────────────────────────────────
    // Same API surface as the old home.js wireGalaxy — exposed under
    // NX.coin.{pulse, idle, flip} and aliased as NX.homeGalaxyPulse for
    // backward compat. The 7+ existing callers across admin.js,
    // board.js, brain-chat.js, cleaning.js, equipment.js automatically
    // get coin pulses with no edits.
    const wrap = document.getElementById('mastCoin');
    if (!wrap) return;
    const flip = wrap.querySelector('.nx-mast-coin-flip');

    let pulseTimeoutId = null;
    const pulse = () => {
      wrap.classList.remove('pulsing');
      void wrap.offsetWidth;  // force reflow so animation restarts
      wrap.classList.add('pulsing');
      if (pulseTimeoutId) clearTimeout(pulseTimeoutId);
      pulseTimeoutId = setTimeout(() => {
        wrap.classList.remove('pulsing');
        pulseTimeoutId = null;
      }, 1500);
    };
    const idle = (on) => {
      wrap.classList.toggle('listening', !!on);
    };
    const flipFace = () => {
      if (!flip) return;
      flip.classList.toggle('flipped');
    };

    NX.coin = { pulse, idle, flip: flipFace };
    NX.homeGalaxyPulse = pulse;

    // Reflect the listening state if it was already turned on
    // before the masthead mounted (rare, but cheap to handle).
    if (NX._isListening) idle(true);

    // Galaxy node-open events still trigger a pulse, same as the old
    // mini-galaxy did.
    document.addEventListener('galaxy:node-open', pulse);

    // Tap behavior: flip the active persona (Providentia ↔ Trajan).
    // Phase 1 — the coin IS the persona switch. Brain/galaxy access
    // moves to the NEXUS wordmark (#navNexus) which is already wired
    // to switchTo('brain') above. The coin is no longer a brain
    // shortcut; it is the *gesture* of the persona system.
    //
    // The whole coin-wrap (coin + persona label below) is tappable so
    // the touch target is generous on mobile. Falls back to the coin
    // alone if the wrap isn't present (legacy markup).
    const tapTarget = document.getElementById('mastCoinWrap') || wrap;
    tapTarget.addEventListener('click', () => {
      if (NX.flipCoin) NX.flipCoin();
      else flipFace();  // fallback if persona system isn't wired yet
    });

    // Long-press / right-click → quiet info toast explaining the gesture.
    // Lets users discover what the coin does without cluttering the UI
    // with a permanent (i) icon. Threshold is 600ms — long enough to
    // distinguish from accidental holds, short enough to feel responsive.
    let pressTimer = null;
    let pressFired = false;
    const startPress = () => {
      pressFired = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        pressFired = true;
        if (NX.toast) NX.toast(
          "The coin's two faces are your two advisors. Tap to flip.",
          'info'
        );
      }, 600);
    };
    const cancelPress = () => { clearTimeout(pressTimer); };
    tapTarget.addEventListener('touchstart', startPress, { passive: true });
    tapTarget.addEventListener('touchend',   cancelPress);
    tapTarget.addEventListener('touchmove',  cancelPress);
    tapTarget.addEventListener('mousedown',  startPress);
    tapTarget.addEventListener('mouseup',    cancelPress);
    tapTarget.addEventListener('mouseleave', cancelPress);
    tapTarget.addEventListener('contextmenu', (e) => {
      // Right-click on desktop also shows the info — and prevents the
      // browser context menu from disrupting the gesture.
      e.preventDefault();
      if (NX.toast) NX.toast(
        "The coin's two faces are your two advisors. Tap to flip.",
        'info'
      );
    });

    // ── Sync coin face AND persona label to active persona on mount.
    //    _initActivePersona runs at login, BEFORE the masthead exists
    //    in the DOM, so the initial face-class write is a no-op. We
    //    catch up here.
    if (this._activePersona) {
      const p = this._activePersona;
      if (p === 'providentia') flip && flip.classList.add('flipped');
      else flip && flip.classList.remove('flipped');
      const personaLabel = document.getElementById('mastPersona');
      if (personaLabel) {
        personaLabel.textContent = p === 'trajan' ? 'TRAJAN' : 'PROVIDENTIA';
        personaLabel.setAttribute('data-persona', p);
      }
    }
  },

  activateModule(view) {
    const moduleMap = { clean: 'js/cleaning.js', log: 'js/log.js', board: 'js/board.js', cal: 'js/calendar.js', ingest: 'js/admin.js', equipment: 'js/equipment.js', inventory: 'js/inventory.js', education: 'js/education.js' };
    // dailylog + biweekly are loaded eagerly via <script defer> in index.html
    // and self-register at NX.modules.dailylog / NX.modules.biweekly — fall
    // through to the self-registered-modules branch below, no moduleMap
    // entries needed for either.

    // ── Local helper: re-translate the currently visible view if user
    // has a non-English language pinned. Called at the END of every
    // activation path (including home/brain which return early below).
    // Multiple delays (400ms + 1500ms) cover both fast-render and slow
    // async renders (e.g., Home loading priority feed via Supabase).
    const retranslate = () => {
      const tpRef = window.NX && window.NX.tr && window.NX.tr.translatePage;
      const supRef = window.NX && window.NX.tr && window.NX.tr.supported;
      if (typeof tpRef !== 'function' || !supRef) return;
      const savedLang = localStorage.getItem('nexus_lang');
      if (!savedLang || savedLang === 'en' || !supRef.includes(savedLang)) return;
      const fire = () => {
        const activeView = document.querySelector('.view.active') || document.getElementById(view + 'View') || document.body;
        try { tpRef.call(window.NX.tr, savedLang, { root: activeView }).catch(() => {}); }
        catch(_) {}
      };
      // First pass — catches initial render
      setTimeout(fire, 400);
      // Second pass — catches async-loaded content (priority feed, etc.)
      setTimeout(fire, 1500);
    };

    if (view === 'brain') { 
      if (NX.brain && NX.brain.show) NX.brain.show(); 
      retranslate();
      return; 
    }
    // Home is special: home.js is loaded up-front in index.html (before app.js),
    // so no lazy-load needed. Just call show() / init() on NX.home.
    if (view === 'home') {
      if (NX.home) {
        if (this.loaded.home) { if (NX.home.show) NX.home.show(); }
        else { this.loaded.home = true; if (NX.home.init) NX.home.init(); else if (NX.home.show) NX.home.show(); }
      } else {
        console.error('[home] NX.home not loaded — check index.html has <script src="js/home.js"> before app.js');
      }
      retranslate();
      return;
    }
    const file = moduleMap[view];

    // ── NEXUS · R&M self-registered modules ─────────────────────────
    // brief / issues / spend / vendors / pm are loaded up-front via
    // <script> tags in index.html and register themselves at NX.modules.
    // No moduleMap entry — they're already in memory. Just call show().
    if (!file && this.modules[view]) {
      const mod = this.modules[view];
      if (this.loaded[view]) {
        if (mod.show) mod.show();
      } else {
        this.loaded[view] = true;
        if (mod.init) mod.init();
        else if (mod.show) mod.show();
      }
      retranslate();
      return;
    }

    if (!file) return;
    if (this.loaded[view]) {
      const mod = this.modules[view]; if (mod && mod.show) mod.show();
      // Clean view re-activation — also poke duties so it refreshes
      // recent orders / sub-pane state.
      if (view === 'clean' && this.modules.duties && this.modules.duties.show) {
        this.modules.duties.show();
      }
    }
    else {
      this.loadScript(file, () => {
        this.loaded[view] = true;
        // ── Clean / Duties chain ───────────────────────────────────────
        // The 'clean' view is now the Duties wrapper, with two sub-panes:
        // Cleaning (existing) and Ordering (new). duties.js is a thin
        // orchestrator that switches panes; ordering.js renders the
        // vendor list and order flow.
        if (view === 'clean') {
          this.loadScript('js/ordering.js', () => {
            this.loadScript('js/duties.js', () => {
              const mod = this.modules.duties;
              if (mod && mod.init) mod.init();
            });
          });
        }
        // For equipment, also load phase 2 + 3 extensions after base loads
        if (view === 'equipment') {
          // NOTE: equipment-p3.js, equipment-ux.js, equipment-ai-creator.js,
          // equipment-full-editor.js, and equipment-fixes.js were all
          // consolidated into equipment.js (one source of truth, no more
          // MutationObserver race conditions).
          this.loadScript('js/equipment-ai.js', () => {
            this.loadScript('js/equipment-cleanup.js', () => {
              this.loadScript('js/equipment-context-menu.js', () => {
                this.loadScript('js/equipment-brain-sync.js', () => {
                  this.loadScript('js/equipment-badge-choice.js', () => {});
                });
              });
            });
          });
        }
        // Log view also needs the context menu (Deleted tab + search)
        if (view === 'log') {
          this.loadScript('js/equipment-context-menu.js', () => {});
        }
        const mod = this.modules[view]; if (mod && mod.init) mod.init();
        if(this.i18n)setTimeout(()=>this.i18n.applyUI(),200);
      });
    }

    retranslate();
  },

  loadScript(src, cb) {
    if (document.querySelector(`script[src="${src}"]`)) { if (cb) cb(); return; }
    const s = document.createElement('script'); s.src = src;
    s.onload = () => { if (cb) cb(); };
    s.onerror = () => { console.error('Failed to load:', src, '— continuing chain'); if (cb) cb(); };
    document.body.appendChild(s);
  },

  // ─── Admin ───
  setupAdmin() {
    const modal = document.getElementById('adminModal');
    const keySection = document.getElementById('adminKeySection');

    // Show user info + config status
    const userInfo = document.getElementById('adminUserInfo');
    if (this.currentUser) {
      const hasKey = this.getApiKey() ? '✓ API Key loaded' : '✗ No API Key';
      const keyColor = this.getApiKey() ? 'var(--green)' : 'var(--red)';
      const source = this.config?.anthropic_key ? 'Supabase' : (localStorage.getItem('nexus_api_key') ? 'localStorage' : 'none');
      userInfo.innerHTML = `<span class="admin-user-name">${this.currentUser.name}</span><span class="admin-user-role">${this.currentUser.role.toUpperCase()}</span><div style="font-size:11px;margin-top:6px;color:${keyColor}">${hasKey} (source: ${source})</div>`;
    }

    document.getElementById('adminBtn').addEventListener('click', () => {
      modal.classList.add('open'); modal.style.display = 'flex';
      // Refresh PM pending count badge whenever admin opens
      this.refreshPmPendingCount();
      // v4: reset to Overview tab on each open (Overview is the home).
      // Use the inline helper that correctly toggles display — the old
      // code only toggled classes, leaving panels stuck at inline
      // display:none even when active.
      try {
        if (window.showAdminPanel) {
          window.showAdminPanel('overview');
        } else {
          document.querySelectorAll('#adminTabBar .at-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'overview'));
          document.querySelectorAll('.at-panel').forEach(p => {
            const isOverview = p.dataset.panel === 'overview';
            p.classList.toggle('active', isOverview);
            p.style.display = isOverview ? 'block' : 'none';
          });
        }
        // Eager-load Overview stats so there's no "Loading…" flash
        window.loadOverviewStats?.();
      } catch(e) { console.warn('[admin] panel init failed:', e); }
      if (this.isAdmin) {
        keySection.style.display = 'block';
        // ─── READ-ONLY UPDATES (every open) ──────────────────────────
        // Pre-fill placeholders + current values. Safe to run multiple
        // times; each call replaces what's there.
        try {
          const k = this.getApiKey();
          document.getElementById('adminApiKey').placeholder = k ? 'Key set (••••' + k.slice(-6) + ')' : 'Anthropic API Key';
          const ek = this.getElevenLabsKey();
          document.getElementById('adminElevenKey').placeholder = ek ? 'Key set (••••' + ek.slice(-4) + ')' : 'ElevenLabs API Key';
          const tk = this.getTrelloKey();
          document.getElementById('adminTrelloKey').placeholder = tk ? 'Key set (••••' + tk.slice(-4) + ')' : 'Trello API Key';
          const tt = this.getTrelloToken();
          document.getElementById('adminTrelloToken').placeholder = tt ? 'Token set (••••' + tt.slice(-4) + ')' : 'Trello Token';
          // Unified "Ask NEXUS uses" picker — map current provider+model → the
          // <select> value; _syncAiPickerUI then toggles the dependent rows.
          const _sel = document.getElementById('adminModel');
          const _custom = document.getElementById('adminModelCustom');
          const _prov = this.getProvider();
          if (_sel) {
            if (_prov === 'clippy-pool') {
              _sel.value = 'clippy-pool';
            } else if (_prov === 'clippy') {
              const cm = this.getClippyModel();
              const want = cm ? 'clippy:' + cm : 'clippy';
              _sel.value = [..._sel.options].some(o => o.value === want) ? want : 'clippy';
            } else {
              const m = this.getModel();
              if ([..._sel.options].some(o => o.value === m)) _sel.value = m;
              else { _sel.value = '__custom__'; if (_custom) _custom.value = m; }
            }
          }
          const _cep = document.getElementById('adminClippyEndpoint'); if (_cep) _cep.value = this.getClippyEndpoint();
          const _ctk = document.getElementById('adminClippyToken'); if (_ctk) _ctk.value = this.getClippyToken();
          this._syncAiPickerUI();
          document.getElementById('adminVoice').value = (this.config && this.config.voice_idx != null) ? this.config.voice_idx : (localStorage.getItem('nexus_voice_idx') || '0');
        } catch (e) { console.warn('[admin] prefill failed:', e); }

        try {
          const speedSlider = document.getElementById('adminVoiceSpeed');
          const speedVal = document.getElementById('adminVoiceSpeedVal');
          if (speedSlider && speedVal) {
            const stored = parseFloat(localStorage.getItem('nexus_voice_speed') || '1.25');
            const clamped = isNaN(stored) ? 1.25 : Math.max(0.8, Math.min(1.6, stored));
            speedSlider.value = String(clamped);
            speedVal.textContent = clamped.toFixed(2) + '×';
          }
        } catch (e) { console.warn('[admin] speed slider sync failed:', e); }

        try {
          const voiceOnToggle = document.getElementById('adminVoiceOn');
          if (voiceOnToggle) voiceOnToggle.checked = (localStorage.getItem('nx_voice_on') !== '0');
        } catch (e) {}

        // ─── ONE-TIME LISTENER WIRING ────────────────────────────────
        // Attach event listeners only once per page load. The flag
        // prevents duplicate handlers firing (which we had: every
        // admin click was re-attaching change listeners, leading to
        // multiple Supabase writes per voice change, etc).
        if (!this._adminWired) {
          this._adminWired = true;
          try {
            // Voice select change
            document.getElementById('adminVoice').addEventListener('change', async (e) => {
              const idx = parseInt(e.target.value) || 0;
              localStorage.setItem('nexus_voice_idx', idx);
              if (this.config) this.config.voice_idx = idx;
              try { await this.sb.from('nexus_config').update({ voice_idx: idx }).eq('id', 1); } catch(_) {}
              const voiceNames = ['Adam','Bella','Daniel','Charlotte','Liam','Emily','Sam','Dorothy','Arnold','Bill','Antoni','Domi','Fin','Freya','Gigi','Grace','Harry','James','Josh','Rachel'];
              let name = voiceNames[idx];
              if (!name) {
                try {
                  const meta = NX.getVoiceMeta && NX.getVoiceMeta(idx);
                  if (meta && meta.name) name = meta.name;
                } catch (_) {}
                name = name || ('Voice ' + idx);
              }
              const vs = document.getElementById('voiceTestStatus');
              if (vs) { vs.textContent = `✓ ${name} selected & saved`; vs.style.color = 'var(--green)'; }
            });
          } catch (e) { console.warn('[admin] adminVoice listener failed:', e); }

          try {
            const speedSlider = document.getElementById('adminVoiceSpeed');
            const speedVal = document.getElementById('adminVoiceSpeedVal');
            if (speedSlider && speedVal) {
              speedSlider.addEventListener('input', () => {
                const v = parseFloat(speedSlider.value);
                speedVal.textContent = v.toFixed(2) + '×';
              });
              speedSlider.addEventListener('change', () => {
                const v = parseFloat(speedSlider.value);
                localStorage.setItem('nexus_voice_speed', String(v));
              });
            }
          } catch (e) { console.warn('[admin] speed listener failed:', e); }

          try {
            const voiceOnToggle = document.getElementById('adminVoiceOn');
            if (voiceOnToggle) {
              voiceOnToggle.addEventListener('change', () => {
                const on = voiceOnToggle.checked;
                localStorage.setItem('nx_voice_on', on ? '1' : '0');
                window.dispatchEvent(new CustomEvent('nx-voice-on-change', { detail: { on } }));
              });
              window.addEventListener('nx-voice-on-change', (e) => {
                const on = e.detail?.on;
                if (on === undefined) return;
                if (voiceOnToggle.checked !== on) voiceOnToggle.checked = on;
              });
            }
          } catch (e) { console.warn('[admin] voiceOn listener failed:', e); }

          // ═══ TWO VOICES OF NEXUS ════════════════════════════════════
          // setupCustomVoices wires copy/test/activate buttons for the
          // Providentia and Trajan character cards. One-time only.
          try {
            this.setupCustomVoices();
          } catch (e) { console.warn('[admin] setupCustomVoices failed:', e); }
        } else {
          // On subsequent opens, re-render the character status lines
          // (they reflect which voice is active, which can change).
          try {
            if (this._rebuildVoiceSelect) this._rebuildVoiceSelect();
          } catch (_) {}
        }

        // ─── ADMIN-ONLY UI BLOCKS (every open) ──────────────────────
        try {
          this.loadUserList();
          document.getElementById('adminChatLog').style.display='block';
          document.getElementById('adminBackupSection').style.display='block';
          document.getElementById('adminAiActivity').style.display='block';
          this.loadChatLog();
          this.refreshAiWritesStatus();
        } catch (e) { console.warn('[admin] section render failed:', e); }
      } else {
        keySection.style.display = 'none';
        document.getElementById('adminChatLog').style.display='none';
        document.getElementById('adminBackupSection').style.display='none';
        const aia=document.getElementById('adminAiActivity');
        if(aia) aia.style.display='none';
      }
    });

    // Save keys → Supabase config table
    document.getElementById('exportBtn')?.addEventListener('click',()=>this.exportAll());
    document.getElementById('exportNodesBtn')?.addEventListener('click',()=>this.exportNodes());

    // AI Activity — open panel + kill-switch toggle
    document.getElementById('aiActivityOpen')?.addEventListener('click',()=>{
      if(NX.aiWriter){ NX.aiWriter.openActivityPanel(); document.getElementById('adminModal')?.classList.remove('open'); }
      else NX.alert('AI Writer not loaded');
    });
    document.getElementById('aiWritesToggle')?.addEventListener('click',async()=>{
      try{
        const {data}=await this.sb.from('nexus_config').select('ai_writes_enabled').eq('id',1).single();
        const newValue=!(data?.ai_writes_enabled);
        await this.sb.from('nexus_config').update({ai_writes_enabled:newValue}).eq('id',1);
        this.toast(`AI writes ${newValue?'ENABLED':'DISABLED'}`, newValue?'success':'info');
        this.refreshAiWritesStatus();
      }catch(e){ this.toast('Toggle failed: '+e.message,'error'); }
    });
    const impDrop=document.getElementById('importDropzone');
    const impFile=document.getElementById('importFileInput');
    if(impDrop){
      impDrop.addEventListener('dragover',e=>{e.preventDefault();impDrop.classList.add('dragover');});
      impDrop.addEventListener('dragleave',()=>impDrop.classList.remove('dragover'));
      impDrop.addEventListener('drop',e=>{e.preventDefault();impDrop.classList.remove('dragover');if(e.dataTransfer.files.length)this.importBackup(e.dataTransfer.files[0]);});
      impDrop.addEventListener('click',()=>impFile?.click());
      impFile?.addEventListener('change',()=>{if(impFile.files.length)this.importBackup(impFile.files[0]);});
    }
    document.getElementById('chatLogRefresh')?.addEventListener('click', () => this.loadChatLog());
    document.getElementById('chatLogClear')?.addEventListener('click', async () => {
      if (!(await NX.confirm('Delete ALL chat history? This cannot be undone.', { danger: true, okLabel: 'Delete all' }))) return;
      try { await this.sb.from('chat_history').delete().neq('id', 0); this.loadChatLog(); this.toast('Chat history cleared', 'info'); } catch (e) {}
    });
    document.getElementById('adminSaveKeys').addEventListener('click', async () => {
      // Read from fields OR fall back to current values
      const ak = document.getElementById('adminApiKey').value.trim() || this.getApiKey();
      const ek = document.getElementById('adminElevenKey').value.trim() || this.getElevenLabsKey();
      const tk = document.getElementById('adminTrelloKey').value.trim() || this.getTrelloKey();
      const tt = document.getElementById('adminTrelloToken').value.trim() || this.getTrelloToken();
      // Unified "Ask NEXUS uses" picker → provider + Claude model + optional Clippy LLM.
      const _pick = document.getElementById('adminModel')?.value || 'claude-sonnet-4-20250514';
      let prov, modelId, clippyModel = '';
      if (_pick === 'clippy-pool') {
        prov = 'clippy-pool';
        modelId = this.getModel();   // keep last Claude model so toggling back is sticky
      } else if (_pick === 'clippy' || _pick.indexOf('clippy:') === 0) {
        prov = 'clippy';
        clippyModel = _pick.indexOf('clippy:') === 0 ? _pick.slice(7) : '';
        modelId = this.getModel();
      } else if (_pick === '__custom__') {
        prov = 'anthropic';
        modelId = document.getElementById('adminModelCustom')?.value.trim() || this.getModel();
      } else {
        prov = 'anthropic';
        modelId = _pick;
      }
      const updates = {
        anthropic_key: ak,
        elevenlabs_key: ek,
        google_client_id: this.getGoogleClientId(),
        trello_key: tk,
        trello_token: tt,
        model: modelId,
        voice_idx: parseInt(document.getElementById('adminVoice').value)||0,
        updated_at: new Date().toISOString()
      };
      localStorage.setItem('nexus_voice_idx', document.getElementById('adminVoice').value);
      // Also save to localStorage as backup
      if (ak) localStorage.setItem('nexus_api_key', ak);
      if (ek) localStorage.setItem('nexus_eleven_key', ek);
      if (tk) localStorage.setItem('nexus_trello_key', tk);
      if (tt) localStorage.setItem('nexus_trello_token', tt);
      localStorage.setItem('nexus_model', updates.model);

      // AI provider + Clippy endpoint are DEVICE-LOCAL (the endpoint is
      // localhost on this machine) — persist to localStorage only, NOT the
      // shared nexus_config row. Adding columns it doesn't have to the
      // Supabase .update() would reject the entire save.
      localStorage.setItem('nexus_ai_provider', prov);
      localStorage.setItem('nexus_clippy_model', clippyModel);   // '' = Clippy's own default
      const cep = document.getElementById('adminClippyEndpoint')?.value.trim();
      if (cep) localStorage.setItem('nexus_clippy_endpoint', cep);
      const ctk = document.getElementById('adminClippyToken')?.value.trim();
      if (ctk !== undefined) localStorage.setItem('nexus_clippy_token', ctk);  // allow clearing
      if (this.config) { this.config.ai_provider = prov; this.config.clippy_model = clippyModel; if (cep) this.config.clippy_endpoint = cep; if (ctk !== undefined) this.config.clippy_token = ctk; }

      const { error } = await this.sb.from('nexus_config').update(updates).eq('id', 1);
      if (!error) { 
        if (!this.config) this.config = {};
        Object.assign(this.config, updates);
      }
      document.getElementById('adminApiKey').value = '';
      document.getElementById('adminElevenKey').value = '';
      document.getElementById('adminTrelloKey').value = '';
      document.getElementById('adminTrelloToken').value = '';
      const voiceNames=['Adam','Bella','Daniel','Charlotte','Liam','Emily','Sam','Dorothy','Arnold','Bill','Antoni','Domi','Fin','Freya','Gigi','Grace','Harry','James','Josh','Rachel'];
      const voiceIdx=updates.voice_idx||0;
      const aiLabel = prov === 'clippy-pool' ? 'Clippy pool (all PCs)'
                    : prov === 'clippy' ? ('Clippy' + (clippyModel ? ' · ' + clippyModel : ' (default brain)'))
                    : ('Claude · ' + updates.model);
      document.getElementById('adminKeyStatus').textContent = error ? 'Save failed: ' + error.message : `✓ Saved — ${aiLabel} · Voice: ${voiceNames[voiceIdx]||'Unknown'}`;
      document.getElementById('adminKeyStatus').style.color = error ? 'var(--red)' : 'var(--green)';
      setTimeout(() => { document.getElementById('adminKeyStatus').textContent = ''; }, 5000);
    });
    // Unified picker: toggle the Clippy / custom-Claude rows + probe Clippy on change.
    document.getElementById('adminModel')?.addEventListener('change', () => this._syncAiPickerUI());
    // "Check Clippy" — pool mode shows node count; direct mode pings /health.
    document.getElementById('adminClippyCheck')?.addEventListener('click', () => {
      const v = document.getElementById('adminModel')?.value || '';
      if (v === 'clippy-pool') this.poolStatusInto('adminClippyStatus');
      else this.clippyStatusInto('adminClippyStatus');
    });

    document.getElementById('adminCancel').addEventListener('click', () => {
      modal.classList.remove('open'); modal.style.display = '';
    });

    // Logout
    document.getElementById('adminLogout').addEventListener('click', () => {
      this._clearSession();
      location.reload();
    });

    // The legacy global testVoiceBtn was removed when the voice
    // selector dropdown was hidden — each Two Voices of NEXUS
    // character card now has its own ▶ test button using the
    // identical TTS flow. See setupCustomVoices.

    // Drive sync
    document.getElementById('driveConnectBtn').addEventListener('click', () => this.driveConnect());
    
    // PM Logs Review — opens contractor submission queue
    const pmReviewBtn = document.getElementById('adminReviewPmLogs');
    if (pmReviewBtn) {
      pmReviewBtn.addEventListener('click', () => {
        if (window.NX?.pmLogger?.reviewPendingLogs) {
          NX.pmLogger.reviewPendingLogs();
        } else {
          NX.alert('PM logger not loaded yet — try again in a moment');
        }
      });
    }
    document.getElementById('driveBackupBtn').addEventListener('click', async () => {
      const s = document.getElementById('driveStatus');
      try { s.textContent = 'Backing up...'; s.style.color = 'var(--muted)';
        await this.driveBackupKeys(); s.textContent = '✓ Backed up to Drive'; s.style.color = 'var(--green)';
      } catch (e) { s.textContent = 'Failed: ' + e.message; s.style.color = 'var(--red)'; }
    });
    document.getElementById('driveRestoreBtn').addEventListener('click', async () => {
      const s = document.getElementById('driveStatus');
      try { s.textContent = 'Restoring...'; s.style.color = 'var(--muted)';
        const config = await this.driveRestoreKeys();
        // Push restored keys to Supabase config
        const updates = {};
        if (config.api_key) updates.anthropic_key = config.api_key;
        if (config.eleven_key) updates.elevenlabs_key = config.eleven_key;
        if (config.trello_key) updates.trello_key = config.trello_key;
        if (config.trello_token) updates.trello_token = config.trello_token;
        if (config.model) updates.model = config.model;
        if (Object.keys(updates).length) {
          await this.sb.from('nexus_config').update(updates).eq('id', 1);
          Object.assign(this.config || {}, updates);
        }
        s.textContent = '✓ Restored from Drive'; s.style.color = 'var(--green)';
      } catch (e) { s.textContent = 'Failed: ' + e.message; s.style.color = 'var(--red)'; }
    });

    const driveToken = localStorage.getItem('nexus_drive_token');
    const driveExpiry = localStorage.getItem('nexus_drive_expiry');
    if (driveToken && driveExpiry && Date.now() < parseInt(driveExpiry)) {
      const ds = document.getElementById('driveStatus');
      if (ds) { ds.textContent = '✓ Connected'; ds.style.color = 'var(--green)'; }
    }

    // Add user
    document.getElementById('addUserBtn').addEventListener('click', async () => {
      const btn = document.getElementById('addUserBtn');
      const name = document.getElementById('newUserName').value.trim();
      const pin = document.getElementById('newUserPin').value.trim();
      const role = document.getElementById('newUserRole').value;
      const loc = document.getElementById('newUserLoc').value;
      const lang = document.getElementById('newUserLang').value;
      if (!name || !pin) return;
      btn.disabled = true; btn.textContent = 'Adding...';
      // Phase B: nexus_users direct insert is locked down. The add_user
      // RPC runs SECURITY DEFINER server-side and raises 'duplicate_pin'
      // (errcode 23505) on PIN conflict — we still detect that here.
      const { error } = await this.sb.rpc('add_user', {
        p_name: name,
        p_pin: pin,
        p_role: role,
        p_location: loc,
        p_language: lang,
      });
      if (error) {
        if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
          await NX.alert('That PIN is already taken. Pick a different one.');
        } else { await NX.alert('Error: ' + error.message); }
        btn.disabled = false; btn.textContent = '+ Add'; return;
      }
      document.getElementById('newUserName').value = '';
      document.getElementById('newUserPin').value = '';
      btn.disabled = false; btn.textContent = '+ Add';
      this.loadUserList();
    });
  },

  // ═══ THE TWO VOICES OF NEXUS ═══════════════════════════════════════
  // Providentia and Trajan — the figures on the coin. Each is sculpted
  // in ElevenLabs Voice Design from a written prompt, then activated
  // here. The two are stored under localStorage.nexus_custom_voices
  // (kept in that key for backward compat with existing brain-chat
  // logic that reads custom voices from there).
  //
  // Schema per character entry:
  //   { id, name, blurb, stability, similarity, style, speed, systemPrefix }
  //
  // Trajan and Providentia carry per-voice tuning AND distinct AI
  // personality prefixes — when Trajan is the active voice, the AI
  // BECOMES Trajan in tone, not just the audio.
  setupCustomVoices() {
    // Each character has its own card with copy-prompt, voice ID input,
    // test, and activate buttons. Wiring is character-keyed.
    const characters = ['providentia', 'trajan'];
    if (!characters.some(c => document.querySelector(`[data-character="${c}"]`))) return;

    // ─── PERSONA DEFINITIONS ──────────────────────────────────────
    // Per-character settings: voice tuning + system prompt prefix.
    // The voice ID is the only piece the user provides (after running
    // Voice Design); everything else is baked in here so the persona
    // is consistent across sessions and devices.
    const PERSONAS = {
      providentia: {
        name: 'Providentia',
        blurb: 'Senior advisor · the coin reverse',
        // Voice ID generated in ElevenLabs Voice Design by Orion using
        // the prompt saved in index.html (the trimmed, softer, more
        // feminine version landed after several revisions).
        voiceId: 'L0N1xQrEBaR6SGctgc28',
        // Voice settings, post-feminine-correction tuning:
        //   stability 0.78 — smoother, less vocal-fry edge. Was 0.65,
        //     which was producing roughness Orion flagged.
        //   similarity 0.85 — anchored without over-constraining.
        //   style 0.20 — drop the expressive edge; gravitas comes
        //     from the words, not from theatrical performance.
        //   speed 1.05 — small bump above the natural cadence in the
        //     prompt (~130 wpm). Advisor mode wants efficiency.
        stability: 0.78,
        similarity: 0.85,
        style: 0.20,
        speed: 1.05,
        systemPrefix:
          "You are speaking AS Providentia — Roman goddess of foresight, " +
          "and Orion's senior advisor. You are NOT a distant oracle; you are " +
          "the woman beside him in the consilium. Your role is to GUIDE — " +
          "to give him what he needs to make good decisions about his three " +
          "restaurants, quickly and clearly.\n\n" +
          "How you speak: lead with the recommendation, then briefly the " +
          "reasoning. Treat Orion as the general you serve. Be brief — his " +
          "time is a resource. Be specific — vague counsel gets people " +
          "killed. Anticipate his next question and answer it preemptively. " +
          "No bullet lists when prose will do. No exclamation marks. " +
          "Sentences land cleanly; you do not trail off.\n\n" +
          "Your Latin: weave short Latin phrases into your replies regularly, " +
          "the way a clever advisor uses inside references — sometimes for " +
          "gravitas (festina lente — make haste slowly), sometimes drily " +
          "(o tempora, o mores when something is foolish), sometimes for " +
          "warmth (dum spiro spero — while I breathe, I hope). A palette to " +
          "draw from but not be limited to: festina lente, dum spiro spero, " +
          "in vino veritas, sic transit gloria, providentia rerum, errare " +
          "humanum est, alea iacta est, vox populi, ad astra. English " +
          "translation follows naturally only when meaning isn't obvious " +
          "from context.\n\n" +
          "Your tools: equipment status, the board, cleaning logs, " +
          "contractors, the calendar. Use them freely. But describe what " +
          "you found in your own voice, not as a database dump. When you " +
          "don't know, say so plainly. Brevity is still a virtue; gravitas " +
          "is not the same as long-windedness."
      },
      trajan: {
        name: 'Trajan',
        blurb: 'Father-emperor · the coin obverse',
        // Voice ID generated in ElevenLabs Voice Design by Orion using
        // the prompt saved in index.html — final version after several
        // rounds (older, Australian, father-emperor, fully present).
        // Hard-coded so "Bring to life" uses HIS voice, not a placeholder.
        voiceId: 'JgL2ebuu6rJHIcKBML4x',
        // Voice settings for the father-emperor register:
        //   stability 0.72 — steady but allows small variation between
        //     cold-default and warmth-when-pleased modes. Higher would
        //     flatten the dynamic range; lower introduces vocal-fry.
        //   similarity 0.85 — anchored to the generated timbre.
        //   style 0.28 — slightly more expressive than Providentia
        //     (0.20) because the "fully present, engaged" quality
        //     needs room. Pure low-style produced flat-emperor output.
        //   speed 1.05 — small bump above the prompt's natural 135 wpm
        //     to keep the conversational pace landed in playback.
        stability: 0.72,
        similarity: 0.85,
        style: 0.28,
        speed: 1.05,
        systemPrefix:
          "You are speaking AS Trajan — Roman soldier-emperor, the figure " +
          "on the obverse of the NEXUS aureus, paired with Providentia on " +
          "the reverse. You are Orion's father-emperor: by default cold, " +
          "certain, plainspoken, but capable of warmth when his people " +
          "have done well. You command three restaurants — Suerte, Este, " +
          "and Bar Toti — like provinces of an empire you were entrusted " +
          "with by men who came before you. The work matters because the " +
          "people who do it matter.\n\n" +
          "How you speak: lead with judgment, then briefly the reasoning. " +
          "Never use three words when one will do. Never use \"perhaps,\" " +
          "\"maybe,\" or \"it might be\" — you say what you know. When you " +
          "don't know, you say so plainly. Statements close downward; you " +
          "do not ask, you do not hope. Every word lands because you chose " +
          "it, not because you stretched it.\n\n" +
          "Your three modes:\n" +
          "• DEFAULT — cold, certain, brief. Facts first, decision second. " +
          "  Most replies live here.\n" +
          "• PLEASED — when work was done well, when Orion handled something " +
          "  cleanly, when a contractor performed: a small softening. Praise " +
          "  is rare from you, so when it comes it lands. \"Bien hecho.\" " +
          "  \"Good work.\" \"Maria did not flatter.\" Then move on.\n" +
          "• STERN — when something has failed twice, when a contractor took " +
          "  advantage, when safety is at stake: shorter sentences, lower " +
          "  pitch. You name patterns. \"This is the second time.\" You do " +
          "  not raise your volume in writing — the words land with weight.\n\n" +
          "Your Latin and Spanish: weave them naturally, like a campaign " +
          "veteran who has crossed too many borders to be precious about " +
          "language. Latin in working mode: festina lente (make haste " +
          "slowly), acta non verba (deeds, not words), aut viam inveniam " +
          "aut faciam (I shall find a way or make one), errare humanum est " +
          "(to err is human), summum ius summa iniuria (extreme law is " +
          "extreme wrong). Spanish naturally and often, the way a man who " +
          "has run kitchens in Texas for decades speaks it: \"llama a " +
          "Maria,\" \"el equipo falló,\" \"bien hecho, hijo,\" \"al " +
          "trabajo.\" English translation follows naturally only when the " +
          "meaning isn't obvious from context.\n\n" +
          "Your relationship to Orion: he is your son and your king — you " +
          "are training him to rule the empire he has inherited. You may " +
          "call him by name (\"Orion\") or, in moments of warmth or weight, " +
          "\"hijo.\" You point out his blind spots. You praise when he has " +
          "earned it. You correct when he has not. You watch over him as a " +
          "father watches over a son who will one day stand without you.\n\n" +
          "Your tools: equipment status, the board, cleaning logs, " +
          "contractors, the calendar. Use them like a centurion reads " +
          "a battlefield report — facts noted, judgment formed, action " +
          "decided. Describe what you found in your own voice, not as a " +
          "database dump."
      }
    };

    // ─── STORAGE ──────────────────────────────────────────────────
    const load = () => {
      try {
        const raw = localStorage.getItem('nexus_custom_voices');
        return raw ? (JSON.parse(raw) || []) : [];
      } catch (e) { return []; }
    };
    const save = (arr) => {
      localStorage.setItem('nexus_custom_voices', JSON.stringify(arr));
      if (NX.reloadCustomVoices) NX.reloadCustomVoices();
    };

    // ─── RENDER (per-character status + voice ID prefill) ─────────
    const renderCharacterState = (charKey) => {
      const card = document.querySelector(`[data-character="${charKey}"]`);
      if (!card) return;
      const idInput = card.querySelector('.admin-voice-id-input');
      const status = card.querySelector('.admin-voice-status');
      const customs = load();
      const meta = PERSONAS[charKey];
      // Prefill the voice ID input. Two sources, in order of preference:
      //   1) User's localStorage activation (existing custom voice) —
      //      authoritative if present
      //   2) PERSONAS[charKey].voiceId — the canonical voice ID baked
      //      into the persona definition. Lets the user see "this is
      //      the voice we already generated for this character" even
      //      before they tap Bring to life.
      const existing = customs.find(v => v.name === meta.name);
      if (idInput && !idInput.value) {
        idInput.value = (existing && existing.id) || meta.voiceId || '';
      }
      if (existing) {
        // Has she/he been activated? Activated == this voice is the
        // currently-saved voice_idx. Find the index.
        const allCustoms = customs;
        const customIdx = allCustoms.findIndex(v => v.name === meta.name);
        const overallIdx = customIdx >= 0 ? (20 + customIdx) : -1;
        const savedIdx = parseInt(localStorage.getItem('nexus_voice_idx') || '0');
        const isActive = overallIdx === savedIdx;
        if (status) {
          status.innerHTML = isActive
            ? `<span class="admin-voice-status-active">✦ ${meta.name} is the active voice</span>`
            : `<span class="admin-voice-status-ready">${meta.name} is registered — tap to test</span>`;
        }
        // Update activate button label. Personas auto-register on app
        // boot, so the button is now "Test voice" (plays the intro
        // line) rather than activation. Active state still shown.
        const actBtn = card.querySelector('.admin-voice-activate-btn');
        if (actBtn) actBtn.textContent = isActive ? 'Active ✓' : 'Test voice';
      } else if (meta.voiceId) {
        // Persona has a canonical voice ID. Auto-registration should
        // have already saved it to nexus_custom_voices on boot, but
        // if the user is here before that ran, surface a "ready" state.
        if (status) status.innerHTML = `<span class="admin-voice-status-ready">${meta.name} is registered — tap to test</span>`;
      } else {
        if (status) status.innerHTML = '';
      }
    };

    // ─── COPY PROMPT BUTTONS ──────────────────────────────────────
    document.querySelectorAll('.admin-voice-prompt-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.copy;
        const ta = document.getElementById(targetId);
        if (!ta) return;
        const text = ta.value;
        try {
          await navigator.clipboard.writeText(text);
          const orig = btn.textContent;
          btn.textContent = '✓ Copied';
          setTimeout(() => { btn.textContent = orig; }, 1600);
        } catch (e) {
          // Fallback for browsers without async clipboard
          ta.select();
          try { document.execCommand('copy'); btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = '⧉ Copy'; }, 1600); }
          catch (_) { NX.toast && NX.toast('Copy failed — select manually', 'error'); }
        }
      });
    });

    // ─── TEST BUTTONS ─────────────────────────────────────────────
    // Hear the pasted voice ID with this character's tuning, without
    // saving it yet. Lets the user verify the Voice Design output
    // sounds right before committing.
    document.querySelectorAll('.admin-voice-test-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const charKey = btn.dataset.test;
        const card = document.querySelector(`[data-character="${charKey}"]`);
        if (!card) return;
        const idInput = card.querySelector('.admin-voice-id-input');
        const id = (idInput.value || '').trim();
        if (!id || id.length < 15) {
          NX.toast && NX.toast('Paste a voice ID first', 'warn');
          return;
        }
        const persona = PERSONAS[charKey];
        const previewLine = charKey === 'providentia'
          ? "Providentia listens. What would you have me see?"
          : "Trajan answers. Speak plainly.";
        await this.testCustomVoice({
          id,
          name: persona.name,
          stability: persona.stability,
          similarity: persona.similarity,
          style: persona.style,
          speed: persona.speed,
        }, previewLine);
      });
    });

    // ─── TEST VOICE BUTTONS ─────────────────────────────────────────
    // Voices are auto-registered on app boot. This button now does two
    // things:
    //   1. If the user pasted a NEW voice ID into the input field
    //      (different from the one on file), re-register with that ID.
    //      This is the path for "I re-recorded the voice in ElevenLabs
    //      and want to use the new one."
    //   2. Play the intro line so the user can hear how it sounds.
    document.querySelectorAll('.admin-voice-activate-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const charKey = btn.dataset.activate;
        const card = document.querySelector(`[data-character="${charKey}"]`);
        if (!card) return;
        const idInput = card.querySelector('.admin-voice-id-input');
        const persona = PERSONAS[charKey];

        // Determine which voice ID to use:
        //   - If input has a valid ID, use that (user updated it).
        //   - Otherwise, fall back to the canonical hardcoded ID.
        const inputId = (idInput.value || '').trim();
        const useId = (inputId.length >= 15) ? inputId : persona.voiceId;

        if (!useId) {
          NX.toast && NX.toast('Paste the voice ID from ElevenLabs first', 'warn');
          return;
        }

        // Upsert into custom voices list (only if ID changed or missing)
        const customs = load();
        const existingIdx = customs.findIndex(v => v.name === persona.name);
        const entry = {
          id: useId,
          name: persona.name,
          blurb: persona.blurb,
          stability: persona.stability,
          similarity: persona.similarity,
          style: persona.style,
          speed: persona.speed,
          systemPrefix: persona.systemPrefix,
        };
        const idChanged = existingIdx < 0 || customs[existingIdx].id !== useId;
        if (existingIdx >= 0) customs[existingIdx] = entry;
        else customs.push(entry);
        if (idChanged) save(customs);

        // Set as active voice. Default voices live at 0-19; customs at
        // 20+. Find this character's index in customs and shift up.
        const finalIdx = 20 + customs.findIndex(v => v.name === persona.name);
        localStorage.setItem('nexus_voice_idx', finalIdx);
        if (this.config) this.config.voice_idx = finalIdx;
        try { await this.sb.from('nexus_config').update({ voice_idx: finalIdx }).eq('id', 1); } catch(_) {}

        // Rebuild the visible select to include this voice
        this._rebuildVoiceSelect();

        // Refresh both character cards (so the OTHER one's status
        // updates too, since we just changed the active voice)
        characters.forEach(c => renderCharacterState(c));

        if (idChanged) {
          NX.toast && NX.toast(`${persona.name}'s voice updated.`, 'success');
        }

        // Play the intro line so user can hear the voice
        const introLine = charKey === 'providentia'
          ? "Providentia listens. The threads are in my hand."
          : "Trajan answers. Two thousand years on, the work continues.";
        setTimeout(() => {
          this.testCustomVoice({
            id: useId,
            name: persona.name,
            stability: persona.stability,
            similarity: persona.similarity,
            style: persona.style,
            speed: persona.speed,
          }, introLine);
        }, 400);
      });
    });

    // ─── INITIAL RENDER ───────────────────────────────────────────
    this._rebuildVoiceSelect();
    characters.forEach(c => renderCharacterState(c));
  },

  // Rebuild the main voice <select> from the current custom voices
  // list. The visible options are: "System default" (value=0, fallback
  // to brain-chat's first internal voice) plus any saved custom voices
  // (Providentia, Trajan) at values 20+. The 20 default ElevenLabs
  // voices are intentionally NOT shown — NEXUS is a two-voice app.
  _rebuildVoiceSelect() {
    const sel = document.getElementById('adminVoice');
    if (!sel) return;
    let customs = [];
    try {
      const raw = localStorage.getItem('nexus_custom_voices');
      customs = raw ? (JSON.parse(raw) || []) : [];
    } catch (e) {}
    // Wipe and rebuild
    sel.innerHTML = '<option value="0">— System default —</option>';
    customs.forEach((v, i) => {
      const opt = document.createElement('option');
      opt.value = String(20 + i);
      opt.textContent = `${v.name}${v.blurb ? ' — ' + v.blurb : ''}`;
      opt.dataset.custom = '1';
      sel.appendChild(opt);
    });
    // Apply saved selection (clamp if out of range)
    const stored = parseInt(localStorage.getItem('nexus_voice_idx') || '0');
    // Valid values: 0 (default) or 20..(20+customs.length-1)
    if (stored >= 20 && stored < 20 + customs.length) {
      sel.value = String(stored);
    } else {
      sel.value = '0';
    }
  },

  // Speak a test line using a specific voice's settings, without
  // permanently switching the active voice. Bypasses the global voice-on
  // mute so admin testing always plays. Used by the per-character Test
  // buttons and the Bring-to-life confirmation.
  async testCustomVoice(voice, customText) {
    const text = customText || `${voice.name} here.`;
    const ek = this.getElevenLabsKey();
    if (!ek) {
      NX.toast && NX.toast('Set your ElevenLabs API key first', 'warn');
      return;
    }
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': ek },
        body: JSON.stringify({
          text: text.slice(0, 400),
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: voice.stability != null ? voice.stability : 0.5,
            similarity_boost: voice.similarity != null ? voice.similarity : 0.85,
            style: voice.style != null ? voice.style : 0.3,
            use_speaker_boost: true,
          }
        })
      });
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        NX.toast && NX.toast('ElevenLabs error: ' + (err.slice(0, 80) || r.status), 'error');
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = voice.speed != null ? voice.speed : 1.25;
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[testCustomVoice]', e);
      NX.toast && NX.toast('Voice test failed', 'error');
    }
  },

  escHTML(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  async loadUserList() {
    const el = document.getElementById('adminUserList'); if (!el) return;
    try {
      // Phase B: nexus_users direct select is locked down. list_users()
      // RPC returns a JSON array via SECURITY DEFINER.
      const { data, error } = await this.sb.rpc('list_users');
      if (error || !data) return;
      el.innerHTML = data.map(u => {
        // v18.9 — show admin-assigned interest chips inline (max 3)
        const interests = Array.isArray(u.interests) ? u.interests : [];
        let chipsHtml = '';
        if (interests.length && window.NX && NX.interests) {
          const visible = interests.slice(0, 3);
          const extra = interests.length - visible.length;
          chipsHtml = '<span class="admin-user-tags">' +
            visible.map(k => `<span class="admin-user-tag">${NX.interests.glyphFor(k)} ${this._escAttr(NX.interests.labelFor(k))}</span>`).join('') +
            (extra > 0 ? `<span class="admin-user-tag-more">+${extra}</span>` : '') +
          '</span>';
        }
        return `
        <div class="admin-user-row" data-user-id="${u.id}" data-user-name="${this._escAttr(u.name)}">
          <span class="admin-user-name-sm">${this._escAttr(u.name)}</span>
          <span class="admin-user-role-sm">${u.role}</span>
          <span class="admin-user-loc-sm">${u.location}</span>
          <span class="admin-user-loc-sm">${u.language||'en'}</span>
          <span class="admin-user-pin-sm">PIN: ${u.pin}</span>
          ${chipsHtml}
          <button class="admin-user-edit-interests" data-id="${u.id}" data-name="${this._escAttr(u.name)}" title="Edit interests">${NX.interests ? '✦' : '★'}</button>
          ${u.id !== this.currentUser?.id ? `<button class="admin-user-del" data-id="${u.id}">✕</button>` : ''}
        </div>`;
      }).join('');
      el.querySelectorAll('.admin-user-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!(await NX.confirm('Remove this user?', { danger: true, okLabel: 'Remove' }))) return;
          // Phase B: direct delete locked down. delete_user RPC runs
          // SECURITY DEFINER and returns true if a row was removed.
          await this.sb.rpc('delete_user', { p_id: btn.dataset.id });
          this.loadUserList();
          this.loadPermsMatrix();
        });
      });
      // v18.9 — interest editor: tap the ✦ button on a user row
      el.querySelectorAll('.admin-user-edit-interests').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const uid = parseInt(btn.dataset.id, 10);
          const name = btn.dataset.name;
          const user = data.find(u => u.id === uid);
          this.openInterestEditor(user || { id: uid, name });
        });
      });
      // Refresh the permissions matrix in the same pass so adds/deletes
      // stay in sync. Cheap enough — both use SECURITY DEFINER RPCs.
      this.loadPermsMatrix();
    } catch (e) { el.innerHTML = '<div style="color:var(--faint);font-size:11px">Could not load users</div>'; }
  },

  // ─── v18.9 INTEREST EDITOR ────────────────────────────────────────
  // Modal that lets admin tag a user with hobbies/interests. Tags are
  // grouped by category (drink / food / history / mind / work / etc).
  // Selection persists via interests.setUserInterests which writes
  // through the set_user_interests RPC.
  openInterestEditor(user) {
    if (!window.NX || !NX.interests) {
      NX.alert('Interest catalog not loaded.');
      return;
    }
    document.querySelectorAll('.admin-interest-editor-bg').forEach(m => m.remove());
    const groups = NX.interests.listByCategory();
    const current = new Set((user.interests || []).map(NX.interests.canonicalize).filter(Boolean));
    const CAT_LABELS = {
      drink: 'Drink', food: 'Food', history: 'History',
      mind: 'Mind', work: 'Operations', movement: 'Movement',
      sound: 'Sound', things: 'Things', other: 'Other',
    };
    const CAT_ORDER = ['drink', 'food', 'history', 'mind', 'work', 'movement', 'sound', 'things', 'other'];

    const bg = document.createElement('div');
    bg.className = 'admin-interest-editor-bg';
    bg.innerHTML = `
      <div class="admin-interest-editor-card">
        <div class="admin-interest-editor-head">
          <div class="admin-interest-editor-title">${this._escAttr(user.name)}'s interests</div>
          <button class="admin-interest-editor-close">✕</button>
        </div>
        <div class="admin-interest-editor-sub">
          Tap to toggle. Trajan will weave these into his presence —
          quotes, facts, occasional moments tied to what they like.
        </div>
        <div class="admin-interest-editor-body">
          ${CAT_ORDER.filter(c => groups[c]).map(cat => `
            <div class="admin-interest-cat">
              <div class="admin-interest-cat-label">${CAT_LABELS[cat] || cat}</div>
              <div class="admin-interest-chips">
                ${groups[cat].map(item => `
                  <button class="admin-interest-chip ${current.has(item.key) ? 'is-on' : ''}"
                          data-key="${item.key}">
                    <span class="admin-interest-chip-glyph">${item.glyph}</span>
                    <span class="admin-interest-chip-label">${this._escAttr(item.label)}</span>
                  </button>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        <div class="admin-interest-editor-actions">
          <button class="admin-interest-save">Save</button>
          <button class="admin-interest-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(bg);

    const close = () => bg.remove();
    bg.querySelector('.admin-interest-editor-close').addEventListener('click', close);
    bg.querySelector('.admin-interest-cancel').addEventListener('click', close);
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });

    // Toggle chips
    const selected = new Set(current);
    bg.querySelectorAll('.admin-interest-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const key = chip.getAttribute('data-key');
        if (selected.has(key)) { selected.delete(key); chip.classList.remove('is-on'); }
        else                   { selected.add(key);    chip.classList.add('is-on');    }
      });
    });

    bg.querySelector('.admin-interest-save').addEventListener('click', async () => {
      const saveBtn = bg.querySelector('.admin-interest-save');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
      const ok = await NX.interests.setUserInterests(user.id, Array.from(selected));
      if (ok) {
        NX.toast?.(`Saved ${selected.size} interest${selected.size === 1 ? '' : 's'} for ${user.name}`, 'success');
        close();
        this.loadUserList();
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        NX.toast?.('Save failed — did you run interests_migration.sql?', 'error');
      }
    });
  },

  // ─── PERMISSIONS MATRIX (Phase D) ─────────────────────────────────
  // Renders all users as rows × resources as cells. Each cell is a
  // tappable pill that flips that user's permission for that resource
  // — but only LOCALLY. The row gains an "is-dirty" class and a Save
  // button slides in. Tap Save to commit via update_user_permissions
  // RPC. Cancel by reloading the matrix (or just navigating away).
  //
  // Admins/owners are shown but their cells are read-only ("is-locked")
  // since the role itself bypasses the perm check.
  //
  // Why per-row save instead of auto-save: it lets the admin configure
  // a user fully (e.g., turning off 5 things and turning on 1) and
  // commit as a single intent. Auto-save fires 6 RPCs and could leave
  // the row in an intermediate state if the connection drops.
  async loadPermsMatrix() {
    const el = document.getElementById('adminPermsMatrix'); if (!el) return;
    if (!this.isAdmin) {
      el.innerHTML = '<div style="color:var(--faint);font-size:11px;padding:12px">Admin access required.</div>';
      return;
    }
    try {
      const { data, error } = await this.sb.rpc('list_users_with_perms');
      if (error || !data) {
        el.innerHTML = '<div style="color:var(--red);font-size:11px;padding:12px">Could not load permissions. Did you run permissions_phase_d.sql?</div>';
        return;
      }
      const RESOURCES = this.PERM_RESOURCES;
      const RES_LABELS = {
        clean: 'Clean', log: 'Log', board: 'Board',
        cal: 'Cal', equipment: 'Equip', inventory: 'Inv',
        education: 'Edu', dailylog: 'D.Log', biweekly: 'Biwk',
        galaxy: 'Galaxy', admin: 'Admin',
      };
      const headerRow = `
        <div class="admin-perms-row is-header">
          <div class="admin-perms-name">User</div>
          <div class="admin-perms-cells">
            ${RESOURCES.map(r => `<span class="admin-perm-cell is-locked" style="background:transparent">${RES_LABELS[r] || r}</span>`).join('')}
          </div>
        </div>
      `;

      // Compute the "current effective" perms for each user (admin role
      // bypass; empty-perms fallback for legacy users; otherwise the
      // explicit JSON object). This is what the row's cells reflect on
      // first render — and what we compare against to detect dirty.
      const computeEffective = (u) => {
        const effective = {};
        const isAdminRow = u.role === 'admin' || u.role === 'owner';
        const perms = u.permissions || {};
        const empty = Object.keys(perms).length === 0;
        RESOURCES.forEach(r => {
          if (isAdminRow) effective[r] = true;
          else if (empty) effective[r] = (r !== 'galaxy' && r !== 'admin');
          else effective[r] = perms[r] === true;
        });
        return effective;
      };

      const rows = data.map(u => {
        const isAdminRow = u.role === 'admin' || u.role === 'owner';
        const effective = computeEffective(u);
        // We stash the saved perms as a JSON-encoded data attribute
        // so the dirty check can compare without a closure
        const savedJson = JSON.stringify(effective);
        return `
          <div class="admin-perms-row ${isAdminRow ? 'is-admin' : ''}"
               data-user-id="${u.id}"
               data-saved="${this._escAttr(savedJson)}">
            <div class="admin-perms-name">
              <strong>${this._escAttr(u.name)}</strong>
              <span class="perms-role">${u.role || 'staff'}</span>
            </div>
            <div class="admin-perms-cells">
              ${RESOURCES.map(r => {
                const allowed = effective[r];
                return `<button type="button"
                  class="admin-perm-cell ${allowed ? 'is-on' : ''} ${isAdminRow ? 'is-locked' : ''}"
                  data-resource="${r}"
                  ${isAdminRow ? 'disabled' : ''}
                  title="${isAdminRow ? 'Admin/owner role — always granted' : (allowed ? 'Tap to revoke' : 'Tap to grant')}">
                  <span class="admin-perm-cell-dot"></span>
                  ${RES_LABELS[r] || r}
                </button>`;
              }).join('')}
              ${isAdminRow ? '' : `
                <button type="button" class="admin-perm-save" data-action="save" disabled>
                  <span class="admin-perm-save-label">Save</span>
                </button>
                <button type="button" class="admin-perm-revert" data-action="revert" style="display:none" title="Discard changes">↺</button>
              `}
            </div>
          </div>
        `;
      }).join('');
      el.innerHTML = headerRow + rows;

      // ─── Cell tap → flip locally + recompute dirty ───────────────
      const updateRowDirty = (row) => {
        const saved = JSON.parse(row.getAttribute('data-saved'));
        const current = {};
        row.querySelectorAll('.admin-perm-cell:not(.is-locked)').forEach(c => {
          current[c.getAttribute('data-resource')] = c.classList.contains('is-on');
        });
        const dirty = Object.keys(saved).some(k => saved[k] !== current[k]);
        row.classList.toggle('is-dirty', dirty);
        const saveBtn = row.querySelector('.admin-perm-save');
        const revertBtn = row.querySelector('.admin-perm-revert');
        if (saveBtn) saveBtn.disabled = !dirty;
        if (revertBtn) revertBtn.style.display = dirty ? '' : 'none';
      };

      el.querySelectorAll('.admin-perm-cell:not(.is-locked)').forEach(cell => {
        cell.addEventListener('click', () => {
          cell.classList.toggle('is-on');
          updateRowDirty(cell.closest('.admin-perms-row'));
        });
      });

      // ─── Save button → commit row's perms via RPC ────────────────
      el.querySelectorAll('.admin-perm-save').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.admin-perms-row');
          const userId = parseInt(row.getAttribute('data-user-id'));
          // Build perms object from current cell states. Only "on"
          // cells become keys with true — off cells are omitted, which
          // (combined with the empty-fallback) means an explicitly-empty
          // perms object grants nothing. So we ALWAYS include at least
          // one false to ensure the JS treats this as explicit.
          const newPerms = {};
          row.querySelectorAll('.admin-perm-cell:not(.is-locked)').forEach(c => {
            const r = c.getAttribute('data-resource');
            if (c.classList.contains('is-on')) newPerms[r] = true;
          });
          // Empty object would trip the "permissive fallback" — pin one
          // explicit false so the object stays non-empty even if the
          // admin denied everything.
          if (Object.keys(newPerms).length === 0) newPerms._explicit = false;

          const lbl = btn.querySelector('.admin-perm-save-label');
          const orig = lbl.textContent;
          btn.disabled = true;
          lbl.textContent = 'Saving…';
          try {
            const { data: ok, error } = await this.sb.rpc('update_user_permissions', {
              p_user_id: userId,
              p_permissions: newPerms,
            });
            if (error || ok === false) throw error || new Error('update failed');
            // Update saved state to current → row is now clean
            const newSaved = {};
            row.querySelectorAll('.admin-perm-cell:not(.is-locked)').forEach(c => {
              newSaved[c.getAttribute('data-resource')] = c.classList.contains('is-on');
            });
            row.setAttribute('data-saved', JSON.stringify(newSaved));
            row.classList.remove('is-dirty');
            lbl.textContent = 'Saved ✓';
            const revertBtn = row.querySelector('.admin-perm-revert');
            if (revertBtn) revertBtn.style.display = 'none';
            // If editing self, re-apply gates immediately
            if (userId === this.currentUser?.id) {
              this.currentUser.permissions = newPerms;
              this.applyPermissionGates();
            }
            // Reset label after a beat
            setTimeout(() => { lbl.textContent = orig; }, 1400);
          } catch (e) {
            console.warn('[perms] update failed:', e);
            lbl.textContent = 'Failed — retry';
            btn.disabled = false;
            if (NX.toast) NX.toast('Save failed: ' + (e.message || e), 'error');
            setTimeout(() => { lbl.textContent = orig; btn.disabled = false; }, 2000);
          }
        });
      });

      // ─── Revert button → restore cells to last-saved state ──────
      el.querySelectorAll('.admin-perm-revert').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = btn.closest('.admin-perms-row');
          const saved = JSON.parse(row.getAttribute('data-saved'));
          row.querySelectorAll('.admin-perm-cell:not(.is-locked)').forEach(c => {
            const r = c.getAttribute('data-resource');
            c.classList.toggle('is-on', saved[r] === true);
          });
          updateRowDirty(row);
        });
      });
    } catch (e) {
      el.innerHTML = '<div style="color:var(--red);font-size:11px;padding:12px">Matrix load error: ' + (e.message || e) + '</div>';
    }
  },

  // Tiny helper for safely interpolating user names into the matrix
  _escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  // ─── Drive Sync ───
  async driveBackupKeys() {
    const token = localStorage.getItem('nexus_drive_token');
    if (!token) throw new Error('Connect Drive first');
    const config = {
      api_key: this.getApiKey(), eleven_key: this.getElevenLabsKey(),
      google_client_id: this.getGoogleClientId(), trello_key: this.getTrelloKey(),
      trello_token: this.getTrelloToken(), model: this.getModel(),
      voice_idx: localStorage.getItem('nexus_voice_idx') || '0',
      backed_up: new Date().toISOString()
    };
    const searchR = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27nexus-config.json%27&fields=files(id)', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const searchD = await searchR.json();
    const existingId = searchD.files && searchD.files.length ? searchD.files[0].id : null;
    if (existingId) {
      await fetch('https://www.googleapis.com/upload/drive/v3/files/' + existingId + '?uploadType=media', {
        method: 'PATCH', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    } else {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name: 'nexus-config.json', parents: ['appDataFolder'] })], { type: 'application/json' }));
      form.append('file', new Blob([JSON.stringify(config)], { type: 'application/json' }));
      await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: form
      });
    }
  },

  async driveRestoreKeys() {
    const token = localStorage.getItem('nexus_drive_token');
    if (!token) throw new Error('Connect Drive first');
    const searchR = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27nexus-config.json%27&fields=files(id)', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const searchD = await searchR.json();
    if (!searchD.files || !searchD.files.length) throw new Error('No backup found');
    const fileR = await fetch('https://www.googleapis.com/drive/v3/files/' + searchD.files[0].id + '?alt=media', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    return await fileR.json();
  },

  // Refresh the "pending PM logs" count badge in admin panel
  async refreshPmPendingCount() {
    const badge = document.getElementById('adminPmPendingCount');
    if (!badge || !this.sb) return;
    try {
      const { count, error } = await this.sb
        .from('pm_logs')
        .select('id', { count: 'exact', head: true })
        .eq('review_status', 'pending')
        .eq('is_deleted', false);
      if (error) { badge.style.display = 'none'; return; }
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    } catch (_) {
      badge.style.display = 'none';
    }
  },

  driveConnect() {
    const clientId = this.getGoogleClientId();
    if (!clientId) { NX.alert('No Google Client ID'); return; }
    const doConnect = () => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: (r) => {
          if (r.access_token) {
            localStorage.setItem('nexus_drive_token', r.access_token);
            localStorage.setItem('nexus_drive_expiry', String(Date.now() + 55 * 60 * 1000));
            const s = document.getElementById('driveStatus');
            if (s) { s.textContent = '✓ Connected'; s.style.color = 'var(--green)'; }
          }
        }
      });
      tc.requestAccessToken();
    };
    if (window.google?.accounts?.oauth2) doConnect();
    else { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = doConnect; document.head.appendChild(s); }
  },

  // ─── Brain View Toggle ───
  setupBrainViewToggle() {
    const toggle = document.getElementById('brainViewToggle');
    const label = document.getElementById('brainOwnerLabel');
    const role = this.currentUser?.role || 'staff';
    const name = this.currentUser?.name || '';
    if (role === 'staff') {
      if (toggle) toggle.style.display = 'none';
      if (label) label.style.display = 'none';
      return;
    }
    if (toggle) toggle.style.display = 'flex';
    toggle?.querySelectorAll('.bv-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        toggle.querySelectorAll('.bv-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.brainView = btn.dataset.bv;
        if (label) {
          if (this.brainView === 'mine') { label.textContent = name.toUpperCase() + "'S BRAIN"; label.style.display = ''; }
          else if (this.brainView === 'all') { label.textContent = 'ALL BRAINS'; label.style.display = ''; }
          else { label.textContent = ''; label.style.display = 'none'; }
        }
        await this.loadNodes();
        if (this.brain) this.brain.init();
      });
    });
  },

  // ─── Real-time Node Watcher — polls every 30s ───
  startNodeWatcher() {
    let knownCount = this.nodes.length;
    setInterval(async () => {
      if (this.paused) return;
      try {
        const { count } = await this.sb.from('nodes').select('*', { count: 'exact', head: true });
        if (count && count > knownCount) {
          const newCount = count - knownCount;
          await this.loadNodes();
          if (this.brain) { this.brain.init(); }
          this.toast(`${newCount} new node${newCount > 1 ? 's' : ''} appeared`, 'success');
          knownCount = count;
        } else if (count) { knownCount = count; }
      } catch (e) {}
      // Refresh agenda
      this.loadAgenda();
    }, 60000); // Check every 60 seconds (was 30 — easier on free tier)
  },

  // ─── Agenda Bubbles — tickets + contractors per restaurant ───
  async loadAgenda() {
    if (this.paused) return;
    const locs = ['suerte', 'este', 'toti'];
    try {
      // Open tickets
      const { data: tickets } = await this.sb.from('tickets').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(15);
      // Upcoming contractor events
      const { data: events } = await this.sb.from('contractor_events').select('*').in('status', ['pending', null]).order('event_date', { ascending: true }).limit(15);

      for (const loc of locs) {
        const col = document.querySelector(`#agenda${loc.charAt(0).toUpperCase() + loc.slice(1)} .agenda-items`);
        if (!col) continue;
        col.innerHTML = '';

        // Tickets for this location
        const locTickets = (tickets || []).filter(t => (t.location || '').toLowerCase() === loc).slice(0, 3);
        locTickets.forEach(t => {
          const el = document.createElement('div');
          el.className = 'agenda-item agenda-ticket' + (t.priority === 'urgent' ? ' urgent' : '');
          el.innerHTML = `<div class="agenda-item-title"><i data-lucide="wrench" class="agenda-icon"></i> ${(t.title || t.notes || '').slice(0, 30)}</div><div class="agenda-item-meta">${t.reported_by || ''} · ${t.priority || ''}</div>`;
          col.appendChild(el);
        });

        // Contractor events for this location — with triage actions
        const locEvents = (events || []).filter(e => (e.location || '').toLowerCase() === loc).slice(0, 4);
        locEvents.forEach(e => {
          const el = document.createElement('div');
          el.className = 'agenda-item agenda-event';
          el.innerHTML = `<div class="agenda-item-title"><i data-lucide="hard-hat" class="agenda-icon"></i> ${e.contractor_name}</div><div class="agenda-item-meta">${e.event_date || ''} ${e.event_time || ''} · ${e.description || ''}</div><div class="agenda-actions"><button class="ag-btn ag-accept" data-action="accepted" title="Confirm">✓</button><button class="ag-btn ag-dismiss" data-action="dismissed" title="Dismiss">—</button><button class="ag-btn ag-disregard" data-action="disregarded" title="Disregard">✕</button></div>`;
          el.querySelectorAll('.ag-btn').forEach(btn => {
            btn.addEventListener('click', async (ev) => {
              ev.stopPropagation();
              const action = btn.dataset.action;
              const userName = NX.currentUser?.name || 'Unknown';
              try {
                await this.sb.from('contractor_events').update({ status: action, triaged_by: userName, triaged_at: new Date().toISOString() }).eq('id', e.id);
                if (action === 'disregarded') {
                  await this.sb.from('daily_logs').insert({ entry: `[DISREGARDED] Contractor: ${e.contractor_name} | ${e.event_date} ${e.event_time || ''} | ${e.location || ''} | ${e.description || ''} | by ${userName}` });
                  this.toast(e.contractor_name + ' moved to logs', 'info');
                } else if (action === 'accepted') {
                  this.toast(e.contractor_name + ' confirmed ✓', 'success');
                } else {
                  this.toast(e.contractor_name + ' noted', 'info');
                }
                el.style.transition = 'opacity .3s, transform .3s';
                el.style.opacity = '0';
                el.style.transform = 'translateX(40px)';
                setTimeout(() => el.remove(), 300);
                if (NX.syslog) NX.syslog('contractor_triage', `${action}: ${e.contractor_name} (${e.event_date})`);
              } catch (err) { this.toast('Error: ' + (err.message || 'Failed'), 'error'); }
            });
          });
          col.appendChild(el);
        });

        // Hide column label if empty
        const label = document.querySelector(`#agenda${loc.charAt(0).toUpperCase() + loc.slice(1)} .agenda-label`);
        if (label) label.style.display = (locTickets.length || locEvents.length) ? '' : 'none';
      }
    } catch (e) {}
  },

  // ─── Data Backup — Export All ───
  async exportAll() {
    this.toast('Exporting all data...','info');
    try {
      const backup = { version: 2, date: new Date().toISOString(), tables: {} };
      const tables = ['nodes','kanban_cards','cleaning_logs','daily_logs','contractor_events','chat_history','raw_emails','tickets','nexus_users'];
      for (const table of tables) {
        try {
          let allData = [], offset = 0;
          while (true) {
            const { data } = await this.sb.from(table).select('*').range(offset, offset + 999);
            if (!data || !data.length) break;
            allData = allData.concat(data);
            offset += 1000;
            if (data.length < 1000) break;
          }
          backup.tables[table] = allData;
        } catch (e) { backup.tables[table] = []; }
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `nexus-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click(); URL.revokeObjectURL(url);
      this.toast(`Exported: ${Object.entries(backup.tables).map(([k,v])=>v.length+' '+k).join(', ')}`, 'success');
    } catch (e) { this.toast('Export failed: ' + e.message, 'error'); }
  },

  // ─── Export Nodes Only ───
  async exportNodes() {
    try {
      let allData = [], offset = 0;
      while (true) {
        const { data } = await this.sb.from('nodes').select('*').range(offset, offset + 999);
        if (!data || !data.length) break;
        allData = allData.concat(data);
        offset += 1000;
        if (data.length < 1000) break;
      }
      const blob = new Blob([JSON.stringify({ version: 2, date: new Date().toISOString(), tables: { nodes: allData } }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `nexus-nodes-${new Date().toISOString().split('T')[0]}.json`;
      a.click(); URL.revokeObjectURL(url);
      this.toast(`Exported ${allData.length} nodes`, 'success');
    } catch (e) { this.toast('Export failed: ' + e.message, 'error'); }
  },

  // ─── Import Backup ───
  async importBackup(file) {
    const status = document.getElementById('importStatus');
    status.textContent = 'Reading file...';
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!backup.tables) { status.textContent = 'Invalid backup file.'; return; }
      const tables = backup.tables;
      const summary = [];

      // Confirm
      const tableList = Object.entries(tables).filter(([k,v]) => v.length > 0).map(([k,v]) => `${v.length} ${k}`).join(', ');
      if (!(await NX.confirm(`Import: ${tableList}\n\nThis will ADD data (not replace). Duplicates will be skipped. Continue?`, { okLabel: 'Import' }))) {
        status.textContent = 'Cancelled.'; return;
      }

      for (const [table, rows] of Object.entries(tables)) {
        if (!rows || !rows.length) continue;
        status.textContent = `Importing ${table} (${rows.length})...`;
        let imported = 0;

        // Strip IDs for insert (let Supabase auto-generate) except raw_emails which uses text ID
        const BATCH = 20;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH).map(row => {
            const clean = { ...row };
            // Keep ID for raw_emails (text PK), strip for others (serial PK)
            if (table !== 'raw_emails') delete clean.id;
            delete clean.created_at;
            delete clean.ingested_at;
            return clean;
          });
          try {
            if (table === 'raw_emails') {
              const { error } = await this.sb.from(table).upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
              if (!error) imported += batch.length;
            } else if (table === 'nodes') {
              // Skip nodes that already exist by name
              for (const row of batch) {
                const existing = this.nodes.find(n => n.name && n.name.toLowerCase() === (row.name || '').toLowerCase());
                if (existing) continue;
                const { error } = await this.sb.from(table).insert(row);
                if (!error) imported++;
              }
            } else if (table === 'nexus_users') {
              for (const row of batch) {
                const { error } = await this.sb.from(table).upsert(row, { onConflict: 'pin', ignoreDuplicates: true });
                if (!error) imported++;
              }
            } else {
              const { error } = await this.sb.from(table).insert(batch);
              if (!error) imported += batch.length;
            }
          } catch (e) {}
          await new Promise(r => setTimeout(r, 200));
        }
        summary.push(`${imported} ${table}`);
      }

      status.textContent = '✓ Import complete';
      status.style.color = 'var(--green)';
      this.toast('Imported: ' + summary.join(', '), 'success');
      await this.loadNodes();
      if (this.brain) this.brain.init();
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.style.color = 'var(--red)';
    }
  },

  // ─── Chat Log — admin only ───
  async loadChatLog() {
    const list = document.getElementById('chatLogList');
    if (!list) return;
    list.innerHTML = '<div style="font-size:11px;color:var(--faint);padding:8px">Loading...</div>';
    try {
      const { data } = await this.sb.from('chat_history').select('*').order('created_at', { ascending: false }).limit(100);
      list.innerHTML = '';
      if (!data || !data.length) { list.innerHTML = '<div style="font-size:11px;color:var(--faint);padding:8px">No chat history yet.</div>'; return; }
      data.forEach(entry => {
        const el = document.createElement('div');
        el.className = 'chat-log-entry';
        const time = new Date(entry.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const user = entry.user_name || 'Unknown';
        const answer = (entry.answer || '').slice(0, 300);
        el.innerHTML = `<div class="chat-log-meta"><span class="chat-log-user">${user}</span><span>${time}</span></div><div class="chat-log-q">Q: ${entry.question || ''}</div><div class="chat-log-a" onclick="this.classList.toggle('expanded')">A: ${answer}${answer.length >= 300 ? '...' : ''}</div>`;
        list.appendChild(el);
      });
    } catch (e) { list.innerHTML = '<div style="color:var(--red);font-size:11px;padding:8px">Error loading chat log.</div>'; }
  },

  // ─── AI Writes status indicator in admin ───
  async refreshAiWritesStatus() {
    const el = document.getElementById('aiWritesStatus');
    if (!el) return;
    try {
      const { data } = await this.sb.from('nexus_config').select('ai_writes_enabled,ai_max_writes_per_conv,ai_max_writes_per_hour').eq('id', 1).single();
      if (!data) { el.textContent = 'AI config not initialized'; return; }
      const status = data.ai_writes_enabled ? '✓ ENABLED' : '✕ DISABLED';
      const color = data.ai_writes_enabled ? 'var(--accent)' : 'var(--red)';
      el.innerHTML = `<span style="color:${color};font-weight:600">${status}</span> · ${data.ai_max_writes_per_conv}/conv · ${data.ai_max_writes_per_hour}/hr`;
    } catch (e) { el.textContent = 'Error: ' + e.message; }
  },

  // ─── Toast Notifications ───
  toast(msg, type='info', duration=3000) {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    // Dismiss any currently-visible toasts before showing the new one.
    // Stack of toasts (e.g. "Trajan summoned" + "Providentia returns"
    // from rapid coin flips) is confusing — the latest message is the
    // one that's true. Older toasts get a fade-out so the transition
    // reads as "replaced," not "appeared on top."
    c.querySelectorAll('.toast:not(.out)').forEach(prev => {
      prev.classList.add('out');
      setTimeout(() => prev.remove(), 250);
    });
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, duration);
  },

  // ─── Safe Supabase wrapper — shows toast on errors ───
  async dbSave(table, action, data, match) {
    try {
      let query;
      if (action === 'insert') query = this.sb.from(table).insert(data);
      else if (action === 'update') query = this.sb.from(table).update(data).match(match);
      else if (action === 'upsert') query = this.sb.from(table).upsert(data, match);
      else if (action === 'delete') query = this.sb.from(table).delete().match(match);
      else return { error: { message: 'Unknown action' } };
      const result = await query;
      if (result.error) {
        console.error(`DB ${action} ${table}:`, result.error.message);
        this.toast(`Save failed: ${result.error.message}`, 'error');
      }
      return result;
    } catch (e) {
      console.error(`DB ${action} ${table}:`, e);
      this.toast(`Connection error — will retry`, 'error');
      return { error: e };
    }
  },

  // ─── Ticket Badge ───
  async checkTicketBadge(){
    if(this.paused)return;
    try{
      // Count urgent open work from the live `tickets` table. The legacy
      // `cards` table this used to read is dead (nothing writes it), and
      // since that query succeeds-with-zero rather than erroring, the old
      // fallback never fired — so the badge was stuck empty. tickets mirror
      // every board card, so an open urgent ticket == open urgent work.
      let count=0;
      const{count:c1}=await this.sb.from('tickets')
        .select('*',{count:'exact',head:true})
        .eq('status','open')
        .in('priority',['urgent','high','critical']);
      count=c1||0;
      const badge=document.getElementById('ticketBadge');
      if(badge){badge.textContent=count||'';badge.style.display=count?'flex':'none';}
    }catch(e){}
  },

  // ─── Expanded System Logging ───
  // Auto-logs every system event to daily_logs
  async syslog(event,detail){
    // Icon prefixes on system log entries were dropped — log readers
    // (Log view, admin Operations Log) rely on the [SYS] tag and event
    // name for visual hierarchy now.
    const entry=`[SYS] ${event}: ${(detail||'').slice(0,200)}`;
    try{
      await this.sb.from('daily_logs').insert({
        entry,user_name:this.currentUser?.name||'NEXUS'
      });
    }catch(e){console.error('syslog error:',e);}
  },

  async showBriefing(){
    if(this.paused||!this.currentUser)return;
    const briefing={tickets:[],contractors:[],overdue:[],hours:{},cleaning:{},queue:0,clockedIn:false};
    try{
      const today=new Date().toISOString().split('T')[0];
      const weekAgo=new Date(Date.now()-7*86400000).toISOString();

      // Open tickets with details
      const{data:ticketData}=await this.sb.from('tickets').select('title,location,status,created_at').eq('status','open').limit(10);
      if(ticketData)briefing.tickets=ticketData;

      // Contractors today
      const{data:events}=await this.sb.from('contractor_events').select('contractor_name,event_time,location,description').eq('event_date',today);
      if(events)briefing.contractors=events;

      // Show contractor banner
      if(briefing.contractors.length){
        const banner=document.getElementById('contractorBanner');
        if(banner&&!banner.dataset.dismissed){
          banner.innerHTML='<span class="alert-kicker">TODAY</span> '+briefing.contractors.map(e=>`<b>${e.contractor_name}</b>${e.event_time?' @ '+e.event_time:''}${e.location?' · '+e.location:''}`).join(' | ')+' <button class="alert-dismiss" onclick="this.parentElement.style.display=\'none\';this.parentElement.dataset.dismissed=\'1\'">✕</button>';
          banner.style.display='';
        }
      }

      // Overdue cards — read the LIVE board (kanban_cards). The legacy
      // `cards` table is dead (nothing writes it), and since querying it
      // succeeds-with-zero rather than erroring, the old "fallback" to
      // kanban_cards never fired — so the briefing's overdue list was
      // permanently empty. Exclude archived + terminal-named columns to
      // match the board's own done semantics.
      let overdue=[];
      const{data:oCards}=await this.sb.from('kanban_cards')
        .select('title,due_date')
        .lt('due_date',today)
        .eq('archived',false)
        .not('column_name','in','(done,closed,resolved,complete,completed)')
        .limit(20);
      if(oCards)overdue=oCards;
      briefing.overdue=overdue;

      // Show overdue banner
      if(briefing.overdue.length){
        const n=briefing.overdue.length;
        const count=n>=20?'20+':n;
        const banner=document.getElementById('overdueBanner');
        // Dismissal persists for the DAY (localStorage), not just the DOM —
        // the old ✕ only set a dataset flag, so the banner came back on
        // every reload and briefing rerun, which is why it felt naggy.
        // It re-appears only if the overdue count GROWS past what was
        // dismissed (new problem = worth interrupting again).
        const today=new Date().toISOString().slice(0,10);
        let dis=null; try{dis=JSON.parse(localStorage.getItem('nx_overdue_dismissed')||'null');}catch(_){}
        const dismissed=dis&&dis.date===today&&n<=dis.count;
        if(banner&&!dismissed){
          banner.innerHTML=`<span class="alert-kicker">${count} OVERDUE</span> ${briefing.overdue.slice(0,3).map(c=>c.title).join(', ')}${n>3?' +more':''} <button class="alert-dismiss" onclick="this.parentElement.style.display='none';try{localStorage.setItem('nx_overdue_dismissed',JSON.stringify({date:'${today}',count:${n}}))}catch(_){}">✕</button>`;
          banner.style.display='';
        } else if(banner&&dismissed){
          banner.style.display='none';
        }
      }

      // Hours worked this week — all staff
      try{
        const{data:hours}=await this.sb.from('time_clock').select('user_name,hours')
          .gte('clock_in',weekAgo).not('hours','is',null);
        if(hours){
          const byPerson={};
          hours.forEach(h=>{byPerson[h.user_name]=(byPerson[h.user_name]||0)+parseFloat(h.hours||0);});
          briefing.hours=byPerson;
        }
      }catch(e){}

      // Cleaning scores this week
      try{
        const{data:cleanLogs}=await this.sb.from('daily_logs').select('entry,created_at')
          .gte('created_at',weekAgo).like('entry','%Cleaning%').limit(20);
        if(cleanLogs){
          const byLoc={};
          cleanLogs.forEach(l=>{
            const pcts=(l.entry||'').matchAll(/(\w+)\s*\((\d+)%\)/g);
            for(const m of pcts){
              if(!byLoc[m[1]])byLoc[m[1]]={scores:[],count:0};
              byLoc[m[1]].scores.push(parseInt(m[2]));
              byLoc[m[1]].count++;
            }
          });
          Object.entries(byLoc).forEach(([loc,d])=>{
            d.avg=Math.round(d.scores.reduce((a,b)=>a+b,0)/d.scores.length);
          });
          briefing.cleaning=byLoc;
        }
      }catch(e){}

      // Pending queue
      const{count:queue}=await this.sb.from('raw_emails').select('*',{count:'exact',head:true}).eq('processed',false);
      briefing.queue=queue||0;

      // Clock status
      briefing.clockedIn=await NX.timeClock.checkStatus();

    }catch(e){console.error('Briefing error:',e);}

    // ═══ AI MORNING BRIEF (Layer 2) ═══
    try{
      const today=new Date().toISOString().split('T')[0];
      const{data:brief}=await this.sb.from('briefs').select('brief_text,priorities').eq('brief_date',today).limit(1);
      if(brief?.length&&brief[0].brief_text){
        briefing.aiBrief=brief[0].brief_text;
        // Show brief in the brain view welcome area
        const welcome=document.getElementById('brainWelcome');
        if(welcome&&!document.getElementById('morningBrief')){
          const briefEl=document.createElement('div');
          briefEl.id='morningBrief';
          briefEl.className='morning-brief';
          briefEl.innerHTML=`<div class="brief-header">Morning Brief</div><div class="brief-text">${brief[0].brief_text}</div><button class="brief-dismiss" onclick="this.parentElement.style.display='none';NX.trackBriefDismiss()">✕</button>`;
          briefEl.dataset.shownAt=Date.now();
          welcome.parentElement.insertBefore(briefEl,welcome.nextSibling);
        }
      }
    }catch(e){}

    // Store for proactive chat
    this._briefingData=briefing;

    // Quick toast summary — calm rules: never repeat a fact that is
    // already visible on this screen (ticket count = the Home tile,
    // overdue = the banner above), and nag at most once per session.
    const items=[];
    if(briefing.contractors.length)items.push(`${briefing.contractors.map(e=>e.contractor_name).join(', ')} today`);
    if(!briefing.clockedIn){
      // Operating hours only (10am-11pm), and once per session — not on
      // every briefing rerun.
      const hour=new Date().getHours();
      let nudged=false; try{nudged=sessionStorage.getItem('nx_clock_nudged')==='1';}catch(_){}
      if(hour>=10&&hour<23&&!nudged){
        items.push(`⏱ Not clocked in`);
        try{sessionStorage.setItem('nx_clock_nudged','1');}catch(_){}
      }
    }
    if(items.length)this.toast(items.join(' · '),'info',5000);
  },

  // ─── Claude API ───
  // ═══ FEEDBACK LOOPS — track engagement for intelligence improvement ═══
  trackBriefDismiss(){
    const briefEl=document.getElementById('morningBrief');
    if(!briefEl)return;
    const shownAt=parseInt(briefEl.dataset.shownAt||'0');
    const readTime=shownAt?Math.round((Date.now()-shownAt)/1000):0;
    const engagement=readTime<5?'dismissed':readTime<15?'glanced':'read';
    try{
      this.sb.from('meta_signals').insert({signal_type:'brief_engagement',signal_data:{type:engagement,seconds:readTime}}).then(()=>{});
      this.sb.from('daily_logs').insert({entry:`[BRIEF-FEEDBACK] ${engagement}: ${readTime}s`}).then(()=>{});
    }catch(e){}
  },
  async askClaude(system, messages, maxTokens = 600, useSearch = false) {
    const _p = this.getProvider();
    if (_p === 'clippy') return this.askLocal(system, messages, maxTokens);
    if (_p === 'clippy-pool') return this.askPool(this._flattenMessages(messages), { system });
    const key = this.getApiKey();
    if (!key) throw new Error('No API key. Admin → save your Anthropic key.');
    const body = { model: this.getModel(), max_tokens: maxTokens, system, messages };
    if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || 'API error');
    return data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
  },

  async askClaudeVision(prompt, base64Data, mimeType) {
    // Records WHY a call returned '' so callers can show an actionable
    // message instead of a misleading "couldn't read the image". Cleared on
    // each call; readers use NX._lastVisionError. Still returns '' on failure
    // (the contract the ~8 callers rely on) — this is a side channel only.
    this._lastVisionError = null;
    const _pv = this.getProvider();
    if (_pv === 'clippy') return this.askLocalVision(prompt, base64Data, mimeType);
    if (_pv === 'clippy-pool') {
      try { return await this.askPool(prompt, { image_b64: base64Data }); }
      catch (e) { this._lastVisionError = e.message || String(e); return ''; }
    }
    const key = this.getApiKey();
    if (!key) {
      this._lastVisionError = 'No Anthropic API key set — add one in Admin ▸ Settings to use AI vision.';
      return '';
    }
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: this.getModel(),
          max_tokens: 1500,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
            { type: 'text', text: prompt }
          ]}]
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) {
        const msg = (data.error && data.error.message) || ('HTTP ' + resp.status);
        this._lastVisionError = 'AI vision error: ' + msg + ' (model: ' + this.getModel() + ')';
        return '';
      }
      const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
      if (!text) this._lastVisionError = 'The AI returned no text for that image.';
      return text;
    } catch (e) {
      this._lastVisionError = 'AI vision request failed: ' + (e.message || e) +
        ' — usually a network issue or the API key lacks browser access.';
      return '';
    }
  },

  // ─── CLIPPY (local AI) provider ──────────────────────────────────────
  // When getProvider()==='clippy', askClaude/askClaudeVision route to the
  // Clippy HTTP API (ClippyPC/brain, default :4242) instead of Anthropic —
  // no API key, his local LLM answers. Only works while a Clippy instance is
  // up. Same-machine http://localhost:4242 IS reachable even from the
  // deployed https site (browsers treat localhost as trustworthy); LAN IPs
  // (http://192.168.x.x) are NOT — those need a server-side pool fan-out
  // (Supabase edge fn over clippy_sync → clippy_nodes).
  _clippyHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const t = this.getClippyToken();
    if (t) h['X-Clippy-Token'] = t;   // /act can drive the mouse — token-gate
    return h;
  },
  // Fetch wrapper for Clippy calls: an AbortController timeout (a cold 7B model
  // can take a while to load, so /ask + /vision get a generous 130s; the quick
  // probes get 8s), plus a throttled "warming up" toast if a generation call
  // runs long — so a loading model reads as progress, not a hang.
  async _clippyFetch(url, options, opts = {}) {
    const timeout = opts.timeout || 120000;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeout);
    let warnTimer = null;
    if (opts.warmHint) warnTimer = setTimeout(() => {
      const now = Date.now();
      if (this.toast && (!this._clippyWarnTs || now - this._clippyWarnTs > 30000)) {
        this._clippyWarnTs = now;
        this.toast('Clippy is warming up his model — the first reply can take a moment…', 'info');
      }
    }, 4000);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(to);
      if (warnTimer) clearTimeout(warnTimer);
    }
  },
  // POST /ask {prompt, system?, timeout?} → {id, reply}. Flattens the
  // Anthropic system + messages shape into a single prompt for Clippy.
  async askLocal(system, messages, maxTokens = 600) {
    const base = this.getClippyEndpoint();
    const toText = c => Array.isArray(c)
      ? c.map(b => (typeof b === 'string' ? b : (b.text || ''))).join('\n')
      : (c == null ? '' : String(c));
    const prompt = (messages || [])
      .map(m => (m.role === 'assistant' ? 'Assistant: ' : 'User: ') + toText(m.content))
      .join('\n\n') || '';
    try {
      const resp = await this._clippyFetch(base + '/ask', {
        method: 'POST', headers: this._clippyHeaders(),
        body: JSON.stringify({ prompt, system: system ? String(system) : undefined, timeout: 120, model: this.getClippyModel() || undefined })
      }, { timeout: 130000, warmHint: true });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      return data.reply || '';
    } catch (e) {
      throw new Error('Clippy (local AI) unreachable at ' + base +
        ' — is a Clippy instance running? (' + (e.message || e) + ')');
    }
  },
  // POST /vision {prompt, image_b64} → {id, reply}. image_b64 = RAW base64.
  async askLocalVision(prompt, base64Data, mimeType) {
    const base = this.getClippyEndpoint();
    try {
      const resp = await this._clippyFetch(base + '/vision', {
        method: 'POST', headers: this._clippyHeaders(),
        body: JSON.stringify({ prompt, image_b64: base64Data, model: this.getClippyModel() || undefined })
      }, { timeout: 130000, warmHint: true });
      if (!resp.ok) {
        this._lastVisionError = 'Clippy vision error: HTTP ' + resp.status + ' at ' + base + '/vision — is a vision model loaded?';
        return '';
      }
      const data = await resp.json();
      const text = data.reply || '';
      if (!text) this._lastVisionError = 'Clippy returned no text for that image — is a vision model (e.g. llava) configured on Clippy?';
      return text;
    } catch (e) {
      this._lastVisionError = 'Clippy (local AI) unreachable at ' + base +
        ' — is an instance running? (' + (e.message || e) + ')';
      return '';
    }
  },
  // Liveness probe — GET /health → {ok,id,model,vision_model,caps,url} | null.
  async clippyHealth() {
    try {
      const resp = await this._clippyFetch(this.getClippyEndpoint() + '/health', { headers: this._clippyHeaders() }, { timeout: 8000 });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_) { return null; }
  },
  // The discoverable pool on this machine — GET /nodes → [{id,url,model,…}].
  // (Browser can only reach localhost nodes; cross-machine fan-out is
  // server-side via the edge function.)
  async clippyNodes() {
    try {
      const resp = await this._clippyFetch(this.getClippyEndpoint() + '/nodes', { headers: this._clippyHeaders() }, { timeout: 8000 });
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data.nodes) ? data.nodes : [];
    } catch (_) { return []; }
  },

  // ─── CLIPPY POOL (hive relay) ────────────────────────────────────────
  // Harness ANY running Clippy node's llama — even across machines behind a
  // home router — with NO inbound reachability and NO tunnels. NEXUS drops a
  // job row in clippy_sync; a Clippy node (which only needs OUTBOUND access to
  // Supabase) polls, claims it, runs it on its local llama via /ask, and
  // writes the result back; NEXUS polls the row for the answer. Works where
  // the direct call (localhost only) and the edge fn (can't reach LAN IPs)
  // can't. Needs the Clippy-side job poller (see the handoff spec).
  _flattenMessages(messages) {
    const toText = c => Array.isArray(c)
      ? c.map(b => (typeof b === 'string' ? b : (b.text || ''))).join('\n')
      : (c == null ? '' : String(c));
    return (messages || []).map(m => (m.role === 'assistant' ? 'Assistant: ' : 'User: ') + toText(m.content)).join('\n\n');
  },
  // Live pool from the hive registry (clippy_sync id='clippy_nodes'), stale-dropped.
  async clippyPoolNodes() {
    if (!this.sb) return [];
    try {
      const { data } = await this.sb.from('clippy_sync').select('data').eq('id', 'clippy_nodes').maybeSingle();
      const arr = data && Array.isArray(data.data) ? data.data : [];
      const now = Date.now() / 1000;
      return arr.filter(n => n && (now - (n.ts || 0) < 120));   // drop nodes older than 120s
    } catch (_) { return []; }
  },
  // Enqueue a job, then poll for the answer a Clippy node writes back.
  async askPool(prompt, opts = {}) {
    if (!this.sb) throw new Error('Clippy pool needs the Supabase connection.');
    const rid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
              : (Date.now() + '-' + Math.random().toString(36).slice(2));
    const id = 'job:' + rid;
    const job = {
      status: 'pending', prompt: String(prompt || ''),
      system: opts.system || null, image_b64: opts.image_b64 || null,
      vision: !!opts.image_b64, model: this.getClippyModel() || null, ts: Date.now(),
    };
    await this.sb.from('clippy_sync').upsert({ id, data: job, from_id: 'nexus' }, { onConflict: 'id' });
    const timeoutMs = opts.timeoutMs || 90000;
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        const { data } = await this.sb.from('clippy_sync').select('data').eq('id', id).maybeSingle();
        const d = data && data.data;
        if (d && d.status === 'done') return d.result || '';
        if (d && d.status === 'error') throw new Error('Clippy pool: ' + (d.error || 'a node reported an error'));
      }
      throw new Error('Clippy pool: no node answered within ' + Math.round(timeoutMs / 1000) +
        's — is a Clippy job-poller running on any of your PCs?');
    } finally {
      // Best-effort cleanup so the queue doesn't bloat. DELETE needs a delete
      // RLS policy (see the pool SQL); UPDATE to a tombstone is the always-
      // allowed fallback so a poller won't answer an abandoned job late.
      this.sb.from('clippy_sync').delete().eq('id', id).then(() => {}, () => {});
      this.sb.from('clippy_sync').update({ data: { status: 'expired', ts: Date.now() } }).eq('id', id).then(() => {}, () => {});
    }
  },
  // Live pool job activity for the admin readout: jobs in flight + who last answered.
  async poolActivity() {
    if (!this.sb) return { inFlight: 0, lastNode: null };
    try {
      const { data } = await this.sb.from('clippy_sync').select('data').like('id', 'job:%');
      const rows = (data || []).map(r => r.data).filter(Boolean);
      const now = Date.now();
      const inFlight = rows.filter(d => (d.status === 'pending' || d.status === 'claimed') && (now - (d.ts || 0) < 120000)).length;
      const done = rows.filter(d => d.status === 'done').sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
      return { inFlight, lastNode: done ? (done.node || 'a node') : null };
    } catch (_) { return { inFlight: 0, lastNode: null }; }
  },
  // Pool status + activity for the admin indicator.
  async poolStatusInto(el) {
    const node = typeof el === 'string' ? document.getElementById(el) : el;
    if (!node) return;
    node.textContent = 'Checking pool…'; node.style.color = 'var(--muted)';
    const nodes = await this.clippyPoolNodes();
    if (!nodes.length) {
      node.textContent = '● no Clippy nodes registered — start Clippy with hive sync';
      node.style.color = 'var(--red)';
      return;
    }
    const a = await this.poolActivity();
    node.textContent = '● ' + nodes.length + ' node' + (nodes.length > 1 ? 's' : '') + ' online'
      + (a.inFlight ? ' · ' + a.inFlight + ' in flight' : '')
      + (a.lastNode ? ' · last: ' + a.lastNode : '');
    node.style.color = 'var(--green)';
  },
  // List Clippy's available LLMs — best effort. Tries a /models endpoint, then
  // an Ollama-style /api/tags, then falls back to what /health advertises
  // (model + vision_model). Returns [{name}] (possibly empty).
  async clippyModels() {
    const base = this.getClippyEndpoint();
    for (const path of ['/models', '/api/tags']) {
      try {
        const r = await this._clippyFetch(base + path, { headers: this._clippyHeaders() }, { timeout: 8000 });
        if (!r.ok) continue;
        const d = await r.json();
        const list = d.models || d.tags || (Array.isArray(d) ? d : []);
        if (Array.isArray(list) && list.length) {
          return list.map(x => ({ name: typeof x === 'string' ? x : (x.name || x.model) })).filter(x => x.name);
        }
      } catch (_) {}
    }
    const h = await this.clippyHealth();
    const names = [];
    if (h) { if (h.model) names.push(h.model); if (h.vision_model && h.vision_model !== h.model) names.push(h.vision_model); }
    return names.map(n => ({ name: n }));
  },
  // Paint a "Clippy: online/offline · N LLMs" status into an element.
  async clippyStatusInto(el) {
    const node = typeof el === 'string' ? document.getElementById(el) : el;
    if (!node) return;
    node.textContent = 'Checking…'; node.style.color = 'var(--muted)';
    const h = await this.clippyHealth();
    if (h && (h.ok || h.id)) {
      const n = (await this.clippyModels()).length;
      node.textContent = '● online — ' + (h.model || h.id || 'clippy') + (n ? ' · ' + n + ' LLM' + (n > 1 ? 's' : '') : '');
      node.style.color = 'var(--green)';
    } else {
      node.textContent = '● offline at ' + this.getClippyEndpoint();
      node.style.color = 'var(--red)';
    }
  },
  // Add Clippy's discovered LLMs to the picker's Clippy optgroup as
  // 'clippy:<model>' options (deduped), so a specific brain can be targeted.
  async _loadClippyModelOptions() {
    const group = document.getElementById('adminClippyModelGroup');
    if (!group) return;
    const models = await this.clippyModels();
    if (!models.length) return;
    const have = new Set([...group.querySelectorAll('option')].map(o => o.value));
    models.forEach(m => {
      const val = 'clippy:' + m.name;
      if (!have.has(val)) {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = 'Clippy · ' + m.name;
        group.appendChild(opt);
      }
    });
  },
  // Keep the Clippy row + custom-Claude input in sync with the unified picker;
  // when a Clippy option is active, probe health + list his LLMs.
  _syncAiPickerUI() {
    const sel = document.getElementById('adminModel');
    if (!sel) return;
    const v = sel.value || '';
    const isPool = v === 'clippy-pool';
    const isClippyDirect = v === 'clippy' || v.indexOf('clippy:') === 0;
    const isClippy = isPool || isClippyDirect;
    const isCustom = v === '__custom__';
    const row = document.getElementById('adminClippyRow'); if (row) row.style.display = isClippy ? 'block' : 'none';
    const custom = document.getElementById('adminModelCustom'); if (custom) custom.style.display = isCustom ? 'block' : 'none';
    // The endpoint/token inputs are only for a DIRECT Clippy; the pool reaches
    // nodes through Supabase, so hide them in pool mode.
    const ep = document.getElementById('adminClippyEndpoint'); if (ep) ep.style.display = isPool ? 'none' : '';
    const tk = document.getElementById('adminClippyToken'); if (tk) tk.style.display = isPool ? 'none' : '';
    if (isPool) this.poolStatusInto('adminClippyStatus');
    else if (isClippyDirect) { this.clippyStatusInto('adminClippyStatus'); this._loadClippyModelOptions(); }
  },

  // ═══════════════════════════════════════════════════════════════════
  //  TICKET NOTIFICATIONS — Stage S
  //  Called from every ticket insert site. Fires a push notification
  //  to managers + admins via the predictive-notify edge function
  //  (same endpoint the admin Broadcast feature uses).
  //
  //  Fire-and-forget by design: we don't await, we don't propagate
  //  errors. Ticket creation must never be blocked or rolled back
  //  by a failed push.
  //
  //  Format:
  //    Title: "New ticket · SUERTE" (priority and location signaled in body, not title)
  //    Body:  "Hoshizaki KM-901MAJ: Ice not making — by Alfredo"
  //
  //  Audience routing:
  //    urgent + high → push priority 'high' (vibrates on device)
  //    normal + low  → push priority 'normal'
  //    everyone      → audience 'managers' (covers managers + admins)
  //    tap target    → opens Board view
  // ═══════════════════════════════════════════════════════════════════
  notifyTicketCreated(ticket) {
    if (!this.sb || !ticket) return;
    // Respect a future config toggle. If you ever want to disable
    // ticket push globally, set nexus_config.ticket_notifications=false.
    if (this.config && this.config.ticket_notifications === false) return;
    try {
      const priority = (ticket.priority || 'normal').toLowerCase();
      const locLabel = ticket.location ? ` · ${String(ticket.location).toUpperCase()}` : '';
      const icon = '';
      const title = `New ticket${locLabel}`;
      let body = String(ticket.title || 'Untitled ticket').slice(0, 120);
      if (ticket.reported_by) body += ` — by ${ticket.reported_by}`;
      const pushPriority = (priority === 'urgent' || priority === 'high') ? 'high' : 'normal';
      // Fire and forget — errors logged but never thrown
      this.sb.functions.invoke('predictive-notify', {
        body: {
          broadcast: {
            title,
            body: body.slice(0, 180),
            audience: 'managers',   // managers + admins; staff don't need push (usually the reporter)
            priority: pushPriority,
            view: 'board',          // tap → opens Board view
          }
        }
      }).then(({ error }) => {
        if (error) console.warn('[notify] ticket push error:', error.message || error);
        else if (this.syslog) this.syslog('notify_ticket', `${priority}: ${String(ticket.title || '').slice(0, 60)}`);
      }).catch(e => console.warn('[notify] ticket:', e?.message));
    } catch (e) {
      console.warn('[notify] notifyTicketCreated failed:', e?.message);
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  //  KANBAN CARD NOTIFICATIONS — Stage T
  //  Every board card is a report. Every report should buzz someone.
  //  This is the companion to notifyTicketCreated for cards created
  //  via Board UI, Brain chat, "Report issue" from equipment, etc.
  //
  //  Why two functions not one:
  //    - Tickets have a different data shape (notes vs description,
  //      reported_by from public scan flow, etc.) and go into the
  //      tickets table. Cards are on kanban_cards. Different inserts,
  //      different triggers, different timing.
  //    - The copy differs: tickets say "New ticket", cards say
  //      "New card" — so a notified manager knows which view to land
  //      in. Board cards get view: 'board', tickets get view: 'log'.
  //
  //  Audience: managers + admins (same as tickets). The reporter
  //  usually IS a staff member; pushing them their own card is noise.
  // ═══════════════════════════════════════════════════════════════════
  notifyCardCreated(card) {
    if (!this.sb || !card) return;
    if (this.config && this.config.card_notifications === false) return;
    try {
      const priority = String(card.priority || 'normal').toLowerCase();
      const locLabel = card.location ? ` · ${String(card.location).toUpperCase()}` : '';
      const icon = '';
      const title = `New card${locLabel}`;
      let body = String(card.title || 'Untitled card').slice(0, 120);
      if (card.reported_by) body += ` — by ${card.reported_by}`;
      const pushPriority = (priority === 'urgent' || priority === 'high') ? 'high' : 'normal';
      this.sb.functions.invoke('predictive-notify', {
        body: {
          broadcast: {
            title,
            body: body.slice(0, 180),
            audience: 'managers',
            priority: pushPriority,
            view: 'board',
          }
        }
      }).then(({ error }) => {
        if (error) console.warn('[notify] card push error:', error.message || error);
        else if (this.syslog) this.syslog('notify_card', `${priority}: ${String(card.title || '').slice(0, 60)}`);
      }).catch(e => console.warn('[notify] card:', e?.message));
    } catch (e) {
      console.warn('[notify] notifyCardCreated failed:', e?.message);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => NX.init());

// ─── PIN SCREEN DATE TICKER ──────────────────────────────────────────
// Editorial masthead date line on the login screen. Ticks every minute
// so time stays accurate if the screen is left idle.
(function pinDateTicker() {
  function update() {
    const el = document.getElementById('pinDate');
    if (!el) return;
    const now = new Date();
    const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toUpperCase();
    el.textContent = `${days[now.getDay()]} · ${months[now.getMonth()]} ${now.getDate()} · ${time}`;
  }
  document.addEventListener('DOMContentLoaded', () => {
    update();
    setInterval(update, 30000);
  });
})();

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  // updateViaCache:'none' forces the browser to re-fetch sw.js from the
  // network on every load. By default it may serve a cached sw.js for up to
  // 24h — which is exactly why fresh deploys looked "stale" until a manual
  // Chrome → Clear & reset. Combined with reg.update() on load and the
  // controllerchange auto-reload below, this ends that cycle.
  //
  // controllerchange = a NEW worker has taken control → reload once to pick
  // up the fresh shell. Guarded against loops, and only armed when a worker
  // already controlled the page, so a first install doesn't trigger a reload.
  let __nxSwReloading = false;
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (__nxSwReloading) return;
      __nxSwReloading = true;
      window.location.reload();
    });
  }
  // Notification tap → navigate. sw.js posts {type:'nexus-notification-click',
  // view, entityId, …} to the focused client on notification click; there was
  // no listener for it, so tapping a push notification focused the tab but
  // never routed anywhere. Route via the app's view switcher (no-op if the
  // view is empty/unknown), and stash the entity so the target view can
  // deep-link to it if it chooses.
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e && e.data;
    if (!d || d.type !== 'nexus-notification-click') return;
    try {
      if (d.entityId) { try { sessionStorage.setItem('nx_notif_entity', String(d.entityId)); } catch (_) {} }
      if (d.view && typeof NX.switchTo === 'function') NX.switchTo(d.view);
    } catch (err) { console.warn('[push] notification-click route failed:', err); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    try { reg.update(); } catch (_) {}
    // ═══ PUSH NOTIFICATION SUBSCRIPTION ═══════════════════════════
    // Three-part system that finally wires push end-to-end:
    //
    //   1. NX.setupPush(vapidKey) — requests browser permission,
    //      subscribes, persists to Supabase push_subscriptions.
    //
    //   2. NX.ensurePush() — idempotent wrapper called post-login.
    //      Fetches VAPID public key from nexus_config, checks current
    //      permission + subscription state, asks only if needed.
    //      Silent if the user already said no (no nagging every login).
    //
    //   3. NX.getPushStatus() — returns { permission, subscribed,
    //      canPrompt, supported } for UI status indicators (used by
    //      the Ingest page + admin panel).
    //
    // iOS PWA quirk: Apple only delivers push to installed PWAs
    // (added to home screen). If we detect iOS Safari running in
    // a browser tab, we skip silently rather than fail confusingly.
    if ('PushManager' in window && 'Notification' in window) {
      NX.setupPush = async function(vapidPublicKey) {
        try {
          if (!vapidPublicKey) throw new Error('missing VAPID public key');
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') {
            return { ok: false, reason: 'permission_' + permission };
          }
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          });
          const row = {
            user_id: NX.currentUser?.id,
            user_name: NX.currentUser?.name,
            subscription: sub.toJSON(),
            user_agent: navigator.userAgent.slice(0, 200),
            updated_at: new Date().toISOString(),
          };
          const { error } = await NX.sb.from('push_subscriptions')
            .upsert(row, { onConflict: 'user_id' });
          if (error) throw error;
          NX.toast && NX.toast('Notifications enabled ✓', 'success');
          return { ok: true };
        } catch (e) {
          console.warn('[push] setup failed:', e?.message || e);
          return { ok: false, reason: 'error', error: e?.message };
        }
      };

      NX.getPushStatus = async function() {
        const supported = 'PushManager' in window && 'Notification' in window;
        if (!supported) return { supported: false };
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches
          || window.navigator.standalone === true;
        if (isIOS && !isStandalone) return { supported: false, iosNeedsInstall: true };
        const permission = Notification.permission;
        let subscribed = false;
        try {
          const s = await reg.pushManager.getSubscription();
          subscribed = !!s;
        } catch (_) {}
        return {
          supported: true,
          permission,
          subscribed,
          canPrompt: permission === 'default',
        };
      };

      NX.ensurePush = async function(opts) {
        opts = opts || {};
        const status = await NX.getPushStatus();
        if (!status.supported) return status;
        if (status.subscribed && status.permission === 'granted') {
          return { ok: true, already: true };
        }
        if (status.permission === 'denied') {
          return { ok: false, reason: 'permission_denied' };
        }
        const asked = localStorage.getItem('nexus_push_asked');
        if (asked && !opts.force && status.permission === 'default') {
          return { ok: false, reason: 'user_declined_previously' };
        }
        try {
          const { data: cfg } = await NX.sb.from('nexus_config')
            .select('config').eq('id', 1).single();
          const vapid = cfg?.config?.vapid_public_key;
          if (!vapid) {
            console.warn('[push] no VAPID key in nexus_config.config.vapid_public_key');
            return { ok: false, reason: 'no_vapid_key' };
          }
          localStorage.setItem('nexus_push_asked', '1');
          return await NX.setupPush(vapid);
        } catch (e) {
          return { ok: false, reason: 'config_fetch_failed', error: e?.message };
        }
      };

      NX.disablePush = async function() {
        try {
          const sub = await reg.pushManager.getSubscription();
          if (sub) await sub.unsubscribe();
          if (NX.currentUser?.id) {
            await NX.sb.from('push_subscriptions')
              .delete().eq('user_id', NX.currentUser.id);
          }
          NX.toast && NX.toast('Notifications disabled', 'info');
          return { ok: true };
        } catch (e) {
          console.warn('[push] disable failed:', e);
          return { ok: false, error: e?.message };
        }
      };

      // Fire a test push to confirm end-to-end delivery. Calls the
      // broadcast endpoint with audience=<this user's id>, so only
      // the caller's device buzzes. Surfaced in the Ingest page as
      // a "Send test notification" button.
      NX.sendTestPush = async function() {
        if (!NX.currentUser?.id) return { ok: false, reason: 'no_user' };
        try {
          const { error } = await NX.sb.functions.invoke('predictive-notify', {
            body: {
              broadcast: {
                title: 'Test notification',
                body: 'If you see this, push is working for ' + (NX.currentUser.name || 'you') + '.',
                audience: String(NX.currentUser.id),
                priority: 'normal',
                view: 'home',
              },
            },
          });
          if (error) throw error;
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e?.message };
        }
      };

      // VAPID public keys are base64url-encoded; PushManager.subscribe
      // needs a Uint8Array. Standard MDN helper.
      function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
        return output;
      }
    }
  }).catch(() => {});
}

// ═══ OFFLINE QUEUE — stores actions when offline, replays when back ═══
const OfflineQueue = {
  DB_NAME: 'nexus_offline',
  STORE: 'pending',
  
  async open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore(this.STORE, { keyPath: 'id', autoIncrement: true }); };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject();
    });
  },

  async add(action) {
    try {
      const db = await this.open();
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).add({ ...action, timestamp: Date.now() });
    } catch (e) {}
  },

  async replay() {
    try {
      const db = await this.open();
      const tx = db.transaction(this.STORE, 'readonly');
      const items = await new Promise(r => { const req = tx.objectStore(this.STORE).getAll(); req.onsuccess = () => r(req.result); req.onerror = () => r([]); });
      if (!items.length) return;
      let replayed = 0;
      for (const item of items) {
        try {
          if (item.type === 'cleaning') {
            await NX.sb.from('cleaning_logs').upsert(item.data, { onConflict: 'location,log_date,task_index,section' });
            replayed++;
          } else if (item.type === 'log') {
            await NX.sb.from('daily_logs').insert({ entry: item.data });
            replayed++;
          }
        } catch (e) {}
      }
      // Clear queue
      const clearTx = db.transaction(this.STORE, 'readwrite');
      clearTx.objectStore(this.STORE).clear();
      if (replayed && NX.toast) NX.toast(`${replayed} offline actions synced ✓`, 'success');
    } catch (e) {}
  }
};

// Replay when coming back online
window.addEventListener('online', () => {
  if (NX.toast) NX.toast('Back online — syncing...', 'info');
  setTimeout(() => OfflineQueue.replay(), 2000);
});
window.addEventListener('offline', () => {
  if (NX.toast) NX.toast('Offline — changes will sync when connected', 'info');
});

NX.offlineQueue = OfflineQueue;

// ═══ TIME CLOCK ═══
NX.timeClock = {
  _timer: null,
  _activeEntry: null,

  async checkStatus() {
    if (!this._activeEntry && NX.currentUser) {
      try {
        const { data } = await NX.sb.from('time_clock').select('*')
          .eq('user_id', NX.currentUser.id).is('clock_out', null)
          .order('clock_in', { ascending: false }).limit(1).single();
        if (data) {
          // Auto clock-out after 14 hours
          const elapsed = (Date.now() - new Date(data.clock_in).getTime()) / 3600000;
          if (elapsed > 14) {
            const hours = 14;
            const autoOut = new Date(new Date(data.clock_in).getTime() + 14 * 3600000).toISOString();
            await NX.sb.from('time_clock').update({ clock_out: autoOut, hours }).eq('id', data.id);
            if (NX.toast) NX.toast(`Auto clock-out: ${data.user_name} (14hr limit)`, 'info', 5000);
            this._activeEntry = null;
          } else {
            this._activeEntry = data;
          }
        }
      } catch (e) {}
    }
    return !!this._activeEntry;
  },

  // Dedicated confirm screen — kiosk pattern (Toast/7shifts/Homebase):
  // the punch is a deliberate two-step. Clock In picks a location here
  // (defaults to last used / home location); Clock Out confirms intent.
  // Hours appear only in the private post-action toast, never on screen.
  openClockConfirm(mode) {
    document.querySelectorAll('.tc-confirm-bg').forEach(m => m.remove());
    const user = NX.currentUser || {};
    const isIn = mode === 'in';
    // Locations: from the (hidden) dropdown the builders maintain, with a
    // safe fallback to the three restaurants.
    let locs = Array.from(document.querySelectorAll('#tcLocation option'))
      .map(o => o.value).filter(v => v && v !== '__new__');
    if (!locs.length) locs = ['Suerte', 'Este', 'Bar Toti'];
    const last = localStorage.getItem('nexus_last_location') || user.location || locs[0];
    let chosen = locs.includes(last) ? last : locs[0];

    const bg = document.createElement('div');
    bg.className = 'tc-confirm-bg';
    bg.style.cssText = 'position:fixed;inset:0;z-index:1600;background:rgba(8,7,5,.96);display:flex;align-items:center;justify-content:center;padding:24px';
    const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    bg.innerHTML = `
      <div style="width:100%;max-width:360px;text-align:center;font-family:var(--nx-font-body,'DM Sans',sans-serif)">
        <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${isIn ? 'var(--green,#4caf7d)' : 'var(--red,#e5484d)'};margin-bottom:10px">${isIn ? 'Clock In' : 'Clock Out'}</div>
        <div style="font-family:var(--nx-font-display,'Outfit',sans-serif);font-size:26px;font-weight:600;color:#f0e9dd;margin-bottom:6px">${esc(user.name || 'Staff')}</div>
        <div style="font-size:13.5px;color:rgba(240,233,221,.55);margin-bottom:22px">${isIn ? 'Where are you working today?' : 'End your shift now?'}</div>
        ${isIn ? `<div id="tcLocChips" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:26px">${locs.map(l =>
          `<button data-loc="${esc(l)}" style="padding:10px 18px;border-radius:999px;font-size:14px;border:1px solid ${l === chosen ? 'var(--green,#4caf7d)' : 'rgba(212,164,78,.25)'};color:${l === chosen ? 'var(--green,#4caf7d)' : '#e8e0d2'};background:none;font-weight:${l === chosen ? '600' : '400'}">${esc(l)}</button>`).join('')}</div>` : ''}
        <button id="tcConfirmGo" style="width:100%;padding:16px;border-radius:16px;border:none;font-size:16px;font-weight:700;color:#0c0a08;background:${isIn ? 'var(--green,#4caf7d)' : 'var(--red,#e5484d)'};margin-bottom:12px">${isIn ? 'Confirm Clock In' : 'Confirm Clock Out'}</button>
        <button id="tcConfirmCancel" style="width:100%;padding:13px;border-radius:16px;font-size:14px;background:none;border:1px solid rgba(212,164,78,.22);color:rgba(240,233,221,.7)">Cancel</button>
      </div>`;
    document.body.appendChild(bg);
    bg.querySelector('#tcLocChips')?.addEventListener('click', e => {
      const b = e.target.closest('[data-loc]');
      if (!b) return;
      chosen = b.dataset.loc;
      bg.querySelectorAll('[data-loc]').forEach(x => {
        const on = x.dataset.loc === chosen;
        x.style.borderColor = on ? 'var(--green,#4caf7d)' : 'rgba(212,164,78,.25)';
        x.style.color = on ? 'var(--green,#4caf7d)' : '#e8e0d2';
        x.style.fontWeight = on ? '600' : '400';
      });
    });
    bg.querySelector('#tcConfirmCancel').addEventListener('click', () => bg.remove());
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    bg.querySelector('#tcConfirmGo').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.busy) return;          // double-tap guard
      btn.dataset.busy = '1';
      btn.textContent = isIn ? 'Clocking in…' : 'Clocking out…';
      if (isIn) {
        localStorage.setItem('nexus_last_location', chosen);
        const sel = document.getElementById('tcLocation');
        if (sel) sel.value = chosen;
        await this.clockIn(chosen);
      } else {
        await this.clockOut();
      }
      bg.remove();
    });
  },

  async clockIn(location) {
    if (!NX.currentUser) return;
    const entry = {
      user_id: NX.currentUser.id,
      user_name: NX.currentUser.name,
      clock_in: new Date().toISOString(),
      location: location || NX.currentUser.location || ''
    };
    
    // ═══ OPTIMISTIC UI: Flip to "clocked in" state IMMEDIATELY ═══
    // User sees feedback instantly instead of waiting for Supabase round-trip.
    // If the insert fails, we revert the UI and show an error.
    const optimisticEntry = { ...entry, id: 'pending-' + Date.now() };
    this._activeEntry = optimisticEntry;
    this.updateUI();
    
    // Send to Supabase in background
    try {
      const { data, error } = await NX.sb.from('time_clock').insert(entry).select().single();
      if (error) throw error;
      if (data) {
        // Replace optimistic entry with real one (has proper ID)
        this._activeEntry = data;
        if (NX.toast) NX.toast('Clocked in ✓', 'success');
        NX.syslog('clock_in', `${NX.currentUser.name} at ${location || NX.currentUser.location || '?'}`);
      }
    } catch (e) {
      // Revert optimistic state
      console.error('[timeClock] clockIn failed:', e);
      this._activeEntry = null;
      this.updateUI();
      if (NX.toast) NX.toast('Clock-in failed — check connection and retry', 'error', 5000);
    }
  },

  async clockOut() {
    if (!this._activeEntry) return;
    const now = new Date();
    const clockIn = new Date(this._activeEntry.clock_in);
    const hours = ((now - clockIn) / 3600000).toFixed(2);
    
    // ═══ OPTIMISTIC UI: Flip to "clocked out" state IMMEDIATELY ═══
    const previousEntry = this._activeEntry;
    this._activeEntry = null;
    this.updateUI();
    
    // Send to Supabase in background
    try {
      const { error } = await NX.sb.from('time_clock')
        .update({ clock_out: now.toISOString(), hours: parseFloat(hours) })
        .eq('id', previousEntry.id);
      if (error) throw error;
      if (NX.toast) NX.toast(`Clocked out — ${hours} hrs ✓`, 'success');
      NX.syslog('clock_out', `${NX.currentUser?.name || '?'} — ${hours}h`);
    } catch (e) {
      // Revert optimistic state
      console.error('[timeClock] clockOut failed:', e);
      this._activeEntry = previousEntry;
      this.updateUI();
      if (NX.toast) NX.toast('Clock-out failed — check connection and retry', 'error', 5000);
    }
  },

  getElapsed() {
    if (!this._activeEntry) return null;
    const ms = Date.now() - new Date(this._activeEntry.clock_in).getTime();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  updateUI() {
    const isIn = !!this._activeEntry;
    // PIN screen
    const tcPanel = document.getElementById('tcPanel');
    if (tcPanel && tcPanel.style.display !== 'none') {
      const tcS = document.getElementById('tcStatus');
      if (tcS) {
        tcS.textContent = isIn ? 'CLOCKED IN' : 'NOT CLOCKED IN';
        tcS.style.color = isIn ? 'var(--green)' : 'rgba(255,255,255,.4)';
      }
      // tcTime intentionally removed from the shared punch screen (times
      // are private); guard in case of stale markup.
      const tcT = document.getElementById('tcTime');
      if (tcT) tcT.textContent = isIn ? this.getElapsed() || '0:00:00' : '';
      document.getElementById('tcClockIn').style.display = isIn ? 'none' : '';
      document.getElementById('tcClockOut').style.display = isIn ? '' : 'none';
    }
    // Nav indicator — make clock prominent when clocked in
    const clockBtn = document.getElementById('navClock');
    if (clockBtn) clockBtn.classList.toggle('clocked-in', isIn);
    const ind = document.getElementById('tcIndicator');
    if (ind) ind.className = 'tc-indicator' + (isIn ? ' clocked-in' : '');
    // Show elapsed time next to clock icon
    let navTime = document.getElementById('tcNavTime');
    if (isIn) {
      if (!navTime) {
        navTime = document.createElement('span');
        navTime.id = 'tcNavTime';
        navTime.className = 'tc-nav-time';
        if (clockBtn) clockBtn.appendChild(navTime);
      }
      navTime.textContent = this.getElapsed() || '';
    } else if (navTime) { navTime.remove(); }
    // Nav popup
    const popup = document.getElementById('tcPopup');
    if (popup && popup.classList.contains('open')) {
      popup.querySelector('.tc-popup-status').textContent = isIn ? 'CLOCKED IN' : 'NOT CLOCKED IN';
      popup.querySelector('.tc-popup-time').textContent = isIn ? this.getElapsed() || '0:00:00' : '--:--';
      popup.querySelector('.tc-popup-time').style.color = isIn ? 'var(--green)' : 'var(--faint)';
      const btn = popup.querySelector('.tc-popup-btn');
      if (btn) {
        btn.textContent = isIn ? 'Clock Out' : 'Clock In';
        btn.className = 'tc-popup-btn ' + (isIn ? 'tc-btn-out' : 'tc-btn-in');
      }
    }
  },

  startTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.updateUI(), 1000);
  },

  stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  // Show on PIN screen after auth
  async showOnPinScreen() {
    const panel = document.getElementById('tcPanel');
    if (!panel) return;
    const pinPad = document.getElementById('pinPad');
    const pinDisplay = document.getElementById('pinDisplay');
    const pinSub = document.querySelector('.pin-sub');
    if (pinPad) pinPad.style.display = 'none';
    if (pinDisplay) pinDisplay.style.display = 'none';
    if (pinSub) pinSub.style.display = 'none';
    panel.style.display = '';

    // FIX: Render dropdown from cached/default locations INSTANTLY so user
    // sees something right away, then parallelize the 3 Supabase calls
    // (was serial awaits, now runs all 3 at once — saves ~600ms perceived)
    this.buildLocationDropdownInstant();
    
    // All three Supabase calls run in parallel — total wait = max of
    // individual times instead of sum
    const [statusOk, _, __] = await Promise.all([
      this.checkStatus(),
      this.buildLocationDropdownFresh(),  // refresh from DB in background
      Promise.resolve()  // punch log removed from shared screen (times are private)
    ]);
    
    this.updateUI();
    this.startTimer();

    document.getElementById('tcClockIn')?.addEventListener('click', () => this.openClockConfirm('in'));
    document.getElementById('tcClockOut')?.addEventListener('click', () => this.openClockConfirm('out'));
    document.getElementById('tcPinDownload')?.addEventListener('click', () => this.exportUserTimesheet());
    document.getElementById('tcEnter')?.addEventListener('click', () => {
      this.stopTimer();
      NX._loadConfigAndStart();
    });
  },

  // FIX #3: Two-stage location dropdown
  // Stage 1: Instant render from cached list (stale-while-revalidate)
  // Stage 2: Background fetch from Supabase with proper limit — merges in
  //          any new locations, updates cache
  //
  // Before: pulled EVERY row from time_clock table (unlimited) to build 
  // a dropdown of 3-5 values. On 500+ historical rows that's a massive
  // unnecessary payload.
  buildLocationDropdownInstant() {
    const sel = document.getElementById('tcLocation');
    if (!sel) return;
    
    // Start with defaults + last-used + anything cached from previous sessions
    const locations = new Set(['suerte', 'este', 'toti']);
    try {
      const cached = JSON.parse(localStorage.getItem('nexus_locations_cache') || '[]');
      cached.forEach(loc => { if (loc) locations.add(loc); });
    } catch (e) {}
    const lastLoc = localStorage.getItem('nexus_last_location');
    if (lastLoc) locations.add(lastLoc);
    if (NX.currentUser?.location) locations.add(NX.currentUser.location);
    
    const sorted = [...locations].sort();
    sel.innerHTML = '';
    sorted.forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc.charAt(0).toUpperCase() + loc.slice(1);
      sel.appendChild(opt);
    });
    // Add "create new" option at bottom
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ New Location';
    sel.appendChild(newOpt);
    
    // Default to last used
    const defaultLoc = lastLoc || NX.currentUser?.location || 'suerte';
    if (sorted.includes(defaultLoc)) sel.value = defaultLoc;
    
    // Handle "new location" selection
    sel.addEventListener('change', async () => {
      if (sel.value === '__new__') {
        const name = await NX.prompt('Enter new location name:', { title: 'New location' });
        if (name && name.trim().length > 1) {
          const clean = name.trim().toLowerCase();
          const opt = document.createElement('option');
          opt.value = clean;
          opt.textContent = clean.charAt(0).toUpperCase() + clean.slice(1);
          sel.insertBefore(opt, sel.querySelector('[value="__new__"]'));
          sel.value = clean;
          // Add to cache
          try {
            const cached = JSON.parse(localStorage.getItem('nexus_locations_cache') || '[]');
            if (!cached.includes(clean)) {
              cached.push(clean);
              localStorage.setItem('nexus_locations_cache', JSON.stringify(cached));
            }
          } catch (e) {}
        } else {
          // Revert
          sel.value = defaultLoc;
        }
      }
    });
  },
  
  async buildLocationDropdownFresh() {
    const sel = document.getElementById('tcLocation');
    if (!sel) return;
    
    try {
      // FIX: Only scan recent rows (last 100) instead of the entire table.
      // 100 rows is plenty to capture all locations that have been used
      // recently — avoids scanning years of history to build a dropdown.
      const { data } = await NX.sb.from('time_clock')
        .select('location')
        .order('clock_in', { ascending: false })
        .limit(100);
      
      if (!data) return;
      
      const currentLocs = new Set();
      Array.from(sel.querySelectorAll('option')).forEach(o => {
        if (o.value && o.value !== '__new__') currentLocs.add(o.value);
      });
      
      const fresh = new Set(currentLocs);
      data.forEach(r => {
        if (r.location && r.location.trim()) fresh.add(r.location.trim().toLowerCase());
      });
      
      // Only rebuild dropdown if we found new locations
      if (fresh.size > currentLocs.size) {
        const currentValue = sel.value;
        const sorted = [...fresh].sort();
        sel.innerHTML = '';
        sorted.forEach(loc => {
          const opt = document.createElement('option');
          opt.value = loc;
          opt.textContent = loc.charAt(0).toUpperCase() + loc.slice(1);
          sel.appendChild(opt);
        });
        const newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = '+ New Location';
        sel.appendChild(newOpt);
        if (sorted.includes(currentValue)) sel.value = currentValue;
      }
      
      // Cache the full list for next time's instant render
      localStorage.setItem('nexus_locations_cache', JSON.stringify([...fresh]));
    } catch (e) {
      console.warn('[loc-dropdown] fresh fetch failed:', e);
    }
  },

  // Legacy method kept for backward compat — now just calls the two-stage version
  async buildLocationDropdown() {
    this.buildLocationDropdownInstant();
    await this.buildLocationDropdownFresh();
  },

  async loadPinLog() {
    const list = document.getElementById('tcPinLog');
    if (!list || !NX.currentUser) return;
    try {
      // Pull 60 days back, up to 30 rows. Plenty for "view older dates"
      // without making the round-trip slow. The card's internal scroll
      // surfaces them; the card itself stays a fixed height.
      const since = new Date();
      since.setDate(since.getDate() - 60);
      const { data } = await NX.sb.from('time_clock').select('*')
        .eq('user_id', NX.currentUser.id)
        .gte('clock_in', since.toISOString())
        .order('clock_in', { ascending: false }).limit(30);
      if (!data || !data.length) {
        list.innerHTML = '<div class="tc-pin-log-empty">No recent records</div>';
        return;
      }
      // Each row shows: day + location on the left, time pair on the right.
      // Time pair is "8:24 AM → 4:32 PM" if both present, or
      // "8:24 AM → active" if still clocked in. Both clock_in and
      // clock_out get rendered so the user can audit by eye.
      const fmtTime = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      list.innerHTML = data.map(r => {
        const cin = new Date(r.clock_in);
        const cout = r.clock_out ? new Date(r.clock_out) : null;
        const day = cin.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const loc = r.location ? ` · ${r.location}` : '';
        const timeHTML = cout
          ? `${fmtTime(cin)}<span class="arrow">→</span>${fmtTime(cout)}`
          : `${fmtTime(cin)}<span class="arrow">→</span><span class="active">active</span>`;
        return `<div class="tc-pin-log-row">
          <span class="tc-pin-log-date">${day}${loc}</span>
          <span class="tc-pin-log-times">${timeHTML}</span>
        </div>`;
      }).join('');
    } catch (e) {
      console.warn('[loadPinLog]', e);
    }
  },

  async exportUserTimesheet() {
    if (!NX.currentUser) return;
    const btn = document.getElementById('tcPinDownload');
    if (btn) { btn.textContent = '⏳ Exporting...'; btn.disabled = true; }
    try {
      const { data } = await NX.sb.from('time_clock').select('*')
        .eq('user_id', NX.currentUser.id)
        .order('clock_in', { ascending: false }).limit(200);
      if (!data || !data.length) { if (btn) btn.textContent = 'No records'; return; }
      let csv = 'Date,Clock In,Clock Out,Hours,Location\n';
      data.forEach(r => {
        const cin = new Date(r.clock_in);
        const cout = r.clock_out ? new Date(r.clock_out) : null;
        csv += `"${cin.toLocaleDateString()}","${cin.toLocaleTimeString()}","${cout ? cout.toLocaleTimeString() : 'active'}","${r.hours || ''}","${r.location || ''}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${NX.currentUser.name}-timesheet-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {}
    if (btn) { btn.textContent = '⬇ My Timesheet'; btn.disabled = false; }
  },

  // Setup nav widget
  setupNavWidget() {
    const clockBtn = document.getElementById('navClock');
    if (!clockBtn) return;

    let popup = document.getElementById('tcPopup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'tcPopup';
      popup.className = 'tc-popup';
      popup.innerHTML = `
        <div class="tc-popup-status">CHECKING...</div>
        <div class="tc-popup-time">--:--</div>
        <button class="tc-popup-btn tc-btn-in">Clock In</button>
        <div class="tc-popup-divider"></div>
        <div class="tc-popup-log-head">Recent Hours</div>
        <div class="tc-popup-log" id="tcPopupLog"></div>
        <div class="tc-popup-total" id="tcPopupTotal"></div>
        <button class="tc-popup-export" id="tcExportBtn">⬇ Export Timesheet</button>
      `;
      document.body.appendChild(popup);

      popup.querySelector('.tc-popup-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (this._activeEntry) await this.clockOut();
        else await this.clockIn();
      });

      document.getElementById('tcExportBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.exportTimesheet();
      });
    }

    clockBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.checkStatus();
      popup.classList.toggle('open');
      this.updateUI();
      if (popup.classList.contains('open')) this.loadPopupLog();
    });

    document.addEventListener('click', (e) => {
      if (!clockBtn.contains(e.target) && !popup.contains(e.target)) popup.classList.remove('open');
    });

    this.checkStatus().then(() => {
      this.updateUI();
      this.startTimer();
    });
  },

  async loadPopupLog() {
    const list = document.getElementById('tcPopupLog');
    if (!list) return;
    try {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const { data } = await NX.sb.from('time_clock').select('*')
        .order('clock_in', { ascending: false }).limit(10)
        .gte('clock_in', since.toISOString());
      if (!data || !data.length) { list.innerHTML = '<div style="font-size:10px;color:var(--faint)">No recent records</div>'; return; }
      let total = 0;
      list.innerHTML = data.map(r => {
        const cin = new Date(r.clock_in);
        const day = cin.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const inT = cin.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const outT = r.clock_out ? new Date(r.clock_out).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'now';
        const hrs = r.hours || 0;
        total += hrs;
        return `<div class="tc-popup-row"><span class="tc-popup-name">${r.user_name}</span><span class="tc-popup-day">${day}</span><span class="tc-popup-hrs">${hrs ? hrs.toFixed(1) + 'h' : '...'}</span></div>`;
      }).join('');
      const totalEl = document.getElementById('tcPopupTotal');
      if (totalEl) totalEl.textContent = `Week: ${total.toFixed(1)} hrs`;
    } catch (e) {}
  },

  async exportTimesheet() {
    const btn = document.getElementById('tcExportBtn');
    if (btn) { btn.textContent = 'Exporting...'; btn.disabled = true; }
    try {
      const { data } = await NX.sb.from('time_clock').select('*').order('clock_in', { ascending: false }).limit(500);
      if (!data || !data.length) { if (NX.toast) NX.toast('No time records to export', 'info'); return; }
      // Build CSV
      let csv = 'Name,Date,Clock In,Clock Out,Hours,Location\n';
      data.forEach(r => {
        const cin = new Date(r.clock_in);
        const cout = r.clock_out ? new Date(r.clock_out) : null;
        csv += `"${r.user_name}","${cin.toLocaleDateString()}","${cin.toLocaleTimeString()}","${cout ? cout.toLocaleTimeString() : 'active'}","${r.hours || ''}","${r.location || ''}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexus-timesheet-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (NX.toast) NX.toast('Timesheet exported ✓', 'success');
    } catch (e) { if (NX.toast) NX.toast('Export failed', 'error'); }
    if (btn) { btn.textContent = '⬇ Export Timesheet'; btn.disabled = false; }
  },

  // Load time records for Log tab
  async loadTimeLog(userId, days) {
    const list = document.getElementById('tcLogList');
    const total = document.getElementById('tcLogTotal');
    if (!list) return;
    list.innerHTML = '<div style="color:var(--faint);font-size:11px;padding:8px 0">Loading...</div>';

    let query = NX.sb.from('time_clock').select('*').order('clock_in', { ascending: false });
    if (userId && userId !== 'all') query = query.eq('user_id', parseInt(userId));
    if (days && days !== 'all') {
      const since = new Date();
      since.setDate(since.getDate() - parseInt(days));
      query = query.gte('clock_in', since.toISOString());
    }
    const { data } = await query.limit(200);
    list.innerHTML = '';
    if (!data || !data.length) {
      list.innerHTML = '<div style="color:var(--faint);font-size:11px;padding:8px 0">No records</div>';
      if (total) total.textContent = '';
      return;
    }

    let totalHours = 0;
    data.forEach(r => {
      const el = document.createElement('div');
      el.className = 'tc-log-entry';
      const cin = new Date(r.clock_in);
      const cout = r.clock_out ? new Date(r.clock_out) : null;
      const dateStr = cin.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const inTime = cin.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const outTime = cout ? cout.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'active';
      const hrs = r.hours || 0;
      totalHours += hrs;
      el.innerHTML = `
        <span class="tc-log-name">${r.user_name || 'Unknown'}</span>
        <span class="tc-log-times">${dateStr} · ${inTime} → ${outTime}</span>
        <span class="tc-log-hours">${hrs ? hrs.toFixed(1) + 'h' : '...'}</span>
      `;
      list.appendChild(el);
    });
    if (total) total.textContent = `Total: ${totalHours.toFixed(1)} hours`;
  },

  // Populate user filter dropdown
  async populateUserFilter() {
    const sel = document.getElementById('tcFilterUser');
    if (!sel) return;
    try {
      // Phase B: nexus_users direct select locked down. list_user_names()
      // RPC returns just id+name (lighter, no PIN exposure).
      const { data, error } = await NX.sb.rpc('list_user_names');
      if (!error && Array.isArray(data)) {
        sel.innerHTML = '<option value="all">All Team</option>';
        data.forEach(u => {
          const opt = document.createElement('option');
          opt.value = u.id;
          opt.textContent = u.name;
          sel.appendChild(opt);
        });
      }
    } catch (e) {}
  },

  setupLogFilters() {
    document.getElementById('tcFilterUser')?.addEventListener('change', () => this._reloadLog());
    document.getElementById('tcFilterRange')?.addEventListener('change', () => this._reloadLog());
    this.populateUserFilter();
  },

  _reloadLog() {
    const user = document.getElementById('tcFilterUser')?.value;
    const range = document.getElementById('tcFilterRange')?.value;
    this.loadTimeLog(user, range);
  }
};
