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
  config: null,      // {anthropic_key, elevenlabs_key, ...}

  // Key getters — from Supabase config (memory), fallback to localStorage
  getApiKey() { return this.config?.anthropic_key || localStorage.getItem('nexus_api_key') || ''; },
  getElevenLabsKey() { return this.config?.elevenlabs_key || localStorage.getItem('nexus_eleven_key') || ''; },
  getGoogleClientId() { return this.config?.google_client_id || localStorage.getItem('nexus_google_client_id') || this.GOOGLE_CLIENT_ID; },
  getTrelloKey() { return this.config?.trello_key || localStorage.getItem('nexus_trello_key') || ''; },
  getTrelloToken() { return this.config?.trello_token || localStorage.getItem('nexus_trello_token') || ''; },
  getModel() { return this.config?.model || localStorage.getItem('nexus_model') || 'claude-sonnet-4-20250514'; },

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
    // Phase 1 — load this user's preferred persona (Providentia/Trajan).
    // Reads currentUser.default_persona if the verify_pin RPC returns
    // it, else localStorage fallback, else 'providentia'. Fires
    // nx-persona-change so brain-chat picks up CURRENT_PERSONA.
    this._initActivePersona();
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

  PERM_RESOURCES: ['clean','log','board','cal','equipment','inventory','galaxy','admin'],

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

    // Mount the floating 🌐 translation button. Stays visible on every
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
    // Wire cleaning scan button — weekly scanner (3 photos)
    const scanBtn = document.getElementById('cleanScan');
    if (scanBtn) {
      scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true; scanBtn.textContent = '📷...';
        try {
          if (NX.scanWeeklyChecklist) { await NX.scanWeeklyChecklist(); }
          else if (NX.scanChecklist) { await NX.scanChecklist(); }
        } catch(e) { NX.toast('Scan error: '+e.message, 'error'); }
        scanBtn.disabled = false; scanBtn.textContent = '📷 Scan';
      });
    }
    // Wire print/export checklist button
    const exportBtn = document.getElementById('cleanExport');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
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
body{font-family:Arial,sans-serif;color:#2A2520;margin:0;padding:20px;position:relative}
h1{font-size:24px;margin:0;color:#000}
.sub{font-size:12px;color:#666;margin-bottom:4px}
.url{font-size:7px;color:#999}
.qr{position:absolute;top:12px;right:20px;width:32px;height:32px}
.gold-line{height:2px;background:#999;margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#444;color:#fff;padding:8px;font-size:10px}
th.day{width:42px;font-size:7px}
.sec{background:#D9D9D9;font-size:14px;font-weight:bold;padding:10px;text-align:left}
td{padding:8px;border:1px solid #BBB}
td.task-es{font-size:13px;font-weight:500}
td.task-en{font-size:10px;color:#666}
td.check{text-align:center;font-size:18px;color:#CCC;background:#F5F5F5;width:38px}
tr:nth-child(even) td{background:#FAFAF6}
tr:nth-child(odd) td{background:#F4F1EB}
td.check{background:#F0EDE6 !important}
.footer{margin-top:12px;font-size:10px;color:#635B50;display:flex;justify-content:space-between}
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
<div style="text-align:center;font-size:7px;color:#857D72;margin-top:8px">NEXUS — Generated ${new Date().toLocaleDateString()} — Use dry-erase marker, scan with 📷 to log</div>
</body></html>`;

        const printWin = window.open('', '_blank');
        if (printWin) {
          printWin.document.write(html);
          printWin.document.close();
          setTimeout(() => printWin.print(), 500);
        } else {
          NX.toast('Pop-up blocked — allow pop-ups to print', 'warn');
        }
      });
    }
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
      document.getElementById(view + 'View').classList.add('active');
      this.activateModule(view);
      // Re-apply language after view switch
      if(this.i18n)setTimeout(()=>this.i18n.applyUI(),100);
    };
    // Bind top nav tabs
    tabs.forEach(tab => tab.addEventListener('click', () => switchTo(tab.dataset.view)));
    // Bind bottom nav buttons
    bnavBtns.forEach(btn => btn.addEventListener('click', () => switchTo(btn.dataset.view)));
    // Wire NEXUS wordmark → go to brain
    nexusBtn.addEventListener('click', () => switchTo('brain'));
    // Expose switchTo globally — home.js stat tiles (tickets, overdue,
    // services, nodes) and other modules use NX.switchTo(view) to
    // navigate. Without this, every stat-tile tap is a silent no-op.
    NX.switchTo = switchTo;
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
    const moduleMap = { clean: 'js/cleaning.js', log: 'js/log.js', board: 'js/board.js', cal: 'js/calendar.js', ingest: 'js/admin.js', equipment: 'js/equipment.js', inventory: 'js/inventory.js' };

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
    const file = moduleMap[view]; if (!file) return;
    if (this.loaded[view]) { const mod = this.modules[view]; if (mod && mod.show) mod.show(); }
    else {
      this.loadScript(file, () => {
        this.loaded[view] = true;
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
      const keyColor = this.getApiKey() ? '#9c8a3e' : '#a83e3e';
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
          document.getElementById('adminModel').value = this.getModel();
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
              if (vs) { vs.textContent = `✓ ${name} selected & saved`; vs.style.color = '#9c8a3e'; }
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
      else alert('AI Writer not loaded');
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
      if (!confirm('Delete ALL chat history? This cannot be undone.')) return;
      try { await this.sb.from('chat_history').delete().neq('id', 0); this.loadChatLog(); this.toast('Chat history cleared', 'info'); } catch (e) {}
    });
    document.getElementById('adminSaveKeys').addEventListener('click', async () => {
      // Read from fields OR fall back to current values
      const ak = document.getElementById('adminApiKey').value.trim() || this.getApiKey();
      const ek = document.getElementById('adminElevenKey').value.trim() || this.getElevenLabsKey();
      const tk = document.getElementById('adminTrelloKey').value.trim() || this.getTrelloKey();
      const tt = document.getElementById('adminTrelloToken').value.trim() || this.getTrelloToken();
      const updates = {
        anthropic_key: ak,
        elevenlabs_key: ek,
        google_client_id: this.getGoogleClientId(),
        trello_key: tk,
        trello_token: tt,
        model: document.getElementById('adminModel').value,
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
      document.getElementById('adminKeyStatus').textContent = error ? 'Save failed: ' + error.message : `✓ Saved — Voice: ${voiceNames[voiceIdx]||'Unknown'}, Model: ${updates.model.includes('opus')?'Opus':'Sonnet'}`;
      document.getElementById('adminKeyStatus').style.color = error ? '#a83e3e' : '#9c8a3e';
      setTimeout(() => { document.getElementById('adminKeyStatus').textContent = ''; }, 5000);
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
          alert('PM logger not loaded yet — try again in a moment');
        }
      });
    }
    document.getElementById('driveBackupBtn').addEventListener('click', async () => {
      const s = document.getElementById('driveStatus');
      try { s.textContent = 'Backing up...'; s.style.color = 'var(--muted)';
        await this.driveBackupKeys(); s.textContent = '✓ Backed up to Drive'; s.style.color = '#9c8a3e';
      } catch (e) { s.textContent = 'Failed: ' + e.message; s.style.color = '#a83e3e'; }
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
        s.textContent = '✓ Restored from Drive'; s.style.color = '#9c8a3e';
      } catch (e) { s.textContent = 'Failed: ' + e.message; s.style.color = '#a83e3e'; }
    });

    const driveToken = localStorage.getItem('nexus_drive_token');
    const driveExpiry = localStorage.getItem('nexus_drive_expiry');
    if (driveToken && driveExpiry && Date.now() < parseInt(driveExpiry)) {
      const ds = document.getElementById('driveStatus');
      if (ds) { ds.textContent = '✓ Connected'; ds.style.color = '#9c8a3e'; }
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
          alert('That PIN is already taken. Pick a different one.');
        } else { alert('Error: ' + error.message); }
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
        const card = document.querySelector(`[data-char
