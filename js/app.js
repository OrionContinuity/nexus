/* ═══════════════════════════════════════════
   NEXUS v10 — PIN Auth + Supabase Config
   Keys in DB, not localStorage. PIN login.
   Roles: admin, manager, staff
   ═══════════════════════════════════════════ */

const NX = {
  // Supabase (public, non-secret)
  SUPA_URL: 'https://oprsthfxqrdbwdvommpw.supabase.co',
  SUPA_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wcnN0aGZ4cXJkYndkdm9tbXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MDU2MzMsImV4cCI6MjA5MTE4MTYzM30.1Yy5BNXWy19Xzdt-ZdcoF0_MF6vvr1rYN5mcDsRYSWY',
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
      // Fetch last 200 conversations for deep memory
      const { data } = await this.sb.from('chat_history')
        .select('question,answer,created_at,user_name')
        .order('created_at', { ascending: false }).limit(200);
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
        // Re-verify user exists in Supabase with current role
        const { data, error } = await this.sb.from('nexus_users').select('*').eq('id', u.id).single();
        if (error || !data) { this._clearSession(); return; }
        // Verify token matches (proves this device authenticated with correct PIN before)
        const expectedToken = await this._makeSessionToken(data.pin, data.id);
        if (savedToken !== expectedToken) { this._clearSession(); return; }
        this.currentUser = data;
        this._sessionPin = data.pin;
        this._applyRole(data.role);
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
      const { data, error } = await this.sb.from('nexus_users').select('*').eq('pin', pin).single();
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
    // Guard — must have valid session (prevents console bypass)
    if (!this.currentUser || !this._sessionPin) return;
    this.isAdmin = role === 'admin';
    this.isManager = role === 'manager' || role === 'admin';
    this.isStaff = true;
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
    this.syslog&&this.syslog('login',`${this.currentUser.name} (${this.currentUser.role}) logged in`);
    if (window.lucide) { lucide.createIcons(); if(this.i18n)this.i18n.applyUI(); }
    else { 
      // Wait for Lucide then apply
      const waitLucide=setInterval(()=>{
        if(window.lucide){clearInterval(waitLucide);lucide.createIcons();if(this.i18n)this.i18n.applyUI();}
      },200);
      setTimeout(()=>clearInterval(waitLucide),5000);
    }

    // Apply role visibility
    if (this.isAdmin || this.isManager) {
      document.getElementById('ingestTab').style.display = '';
      const utilIngest = document.getElementById('utilIngest');
      if (utilIngest) {
        utilIngest.style.display = '';
        utilIngest.addEventListener('click', () => {
          // Switch to ingest view
          document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('navNexus').classList.remove('active');
          document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
          const tab = document.querySelector('.nav-tab[data-view="ingest"]');
          if (tab) tab.classList.add('active');
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
      this.loadScript('js/galaxy.js', () => {
        this.loadScript('js/brain-list.js', () => {
          this.loadScript('js/brain-events.js', () => {
            this.loadScript('js/ai-writer.js', () => {
              this.loadScript('js/brain-chat.js', () => {
                NX.brain.init();
              });
            });
          });
        });
      });
    });
    this.setupNav();
    this.setupAdmin();
    // Time clock nav widget
    NX.timeClock.setupNavWidget();
    // Ticket badge
    this.checkTicketBadge();
    // PM pending logs badge — initial + every 60s while app is open
    setTimeout(() => this.refreshPmPendingCount(), 2000);
    setInterval(() => this.refreshPmPendingCount(), 60000);
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
    // Test Supabase connection
    this.sb.from('nexus_users').select('id',{count:'exact',head:true}).then(({error})=>{
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
      document.body.classList.remove('view-brain','view-clean','view-log','view-board','view-cal','view-equipment','view-ingest');
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
    // Default active state
    nexusBtn.classList.add('active');
    nexusBtn.addEventListener('click', () => switchTo('brain'));
    // Initialize body class for default view (brain)
    document.body.classList.add('view-brain');
  },

  activateModule(view) {
    const moduleMap = { clean: 'js/cleaning.js', log: 'js/log.js', board: 'js/board.js', cal: 'js/calendar.js', ingest: 'js/admin.js', equipment: 'js/equipment.js' };
    if (view === 'brain') { if (NX.brain && NX.brain.show) NX.brain.show(); return; }
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
      const keyColor = this.getApiKey() ? '#5bba5f' : '#d45858';
      const source = this.config?.anthropic_key ? 'Supabase' : (localStorage.getItem('nexus_api_key') ? 'localStorage' : 'none');
      userInfo.innerHTML = `<span class="admin-user-name">${this.currentUser.name}</span><span class="admin-user-role">${this.currentUser.role.toUpperCase()}</span><div style="font-size:11px;margin-top:6px;color:${keyColor}">${hasKey} (source: ${source})</div>`;
    }

    document.getElementById('adminBtn').addEventListener('click', () => {
      modal.classList.add('open'); modal.style.display = 'flex';
      // Refresh PM pending count badge whenever admin opens
      this.refreshPmPendingCount();
      if (this.isAdmin) {
        keySection.style.display = 'block';
        // Pre-fill hints
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
        // Voice saves immediately on change
        document.getElementById('adminVoice').addEventListener('change', async (e) => {
          const idx = parseInt(e.target.value) || 0;
          localStorage.setItem('nexus_voice_idx', idx);
          if (this.config) this.config.voice_idx = idx;
          try { await this.sb.from('nexus_config').update({ voice_idx: idx }).eq('id', 1); } catch(e) {}
          const voiceNames = ['Adam','Bella','Daniel','Charlotte','Liam','Emily','Sam','Dorothy','Arnold','Bill','Antoni','Domi','Fin','Freya','Gigi','Grace','Harry','James','Josh','Rachel'];
          const vs = document.getElementById('voiceTestStatus');
          if (vs) { vs.textContent = `✓ ${voiceNames[idx]} selected & saved`; vs.style.color = '#5bba5f'; }
        });
        this.loadUserList();
        // Show chat log for admin
        document.getElementById('adminChatLog').style.display='block';
        document.getElementById('adminBackupSection').style.display='block';
        document.getElementById('adminAiActivity').style.display='block';
        this.loadChatLog();
        this.refreshAiWritesStatus();
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
      document.getElementById('adminKeyStatus').style.color = error ? '#d45858' : '#5bba5f';
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

    // Test voice button
    document.getElementById('testVoiceBtn').addEventListener('click', async () => {
      const voiceIdx = parseInt(document.getElementById('adminVoice').value) || 0;
      const voiceNames = ['Adam','Bella','Daniel','Charlotte','Liam','Emily','Sam','Dorothy','Arnold','Bill','Antoni','Domi','Fin','Freya','Gigi','Grace','Harry','James','Josh','Rachel'];
      const voiceIds = ['pNInz6obpgDQGcFmaJgB','EXAVITQu4vr4xnSDxMaL','onwK4e9ZLuTAKqWW03F9','XB0fDUnXU5powFXDhCwa','TX3LPaxmHKxFdv7VOQHJ','LcfcDJNUP1GQjkzn1xUU','yoZ06aMxZJJ28mfd3POQ','ThT5KcBeYPX3keUQqHPh','VR6AewLTigWG4xSOukaG','pqHfZKP75CvOlQylNhV4','ErXwobaYiN019PkySvjV','AZnzlk1XvdvUeBnXmlld','D38z5RcWu1voky8WS1ja','jsCqWAovK2LkecY7zXl4','jBpfuIE2acCO8z3wKNLl','oWAxZDx7w5VEj9dCyTzz','SOYHLrjzK2X1ezoPC6cr','ZQe5CZNOzWyzPSCn5a3c','TxGEqnHWrfWFTfGW9XjX','21m00Tcm4TlvDq8ikWAM'];
      const status = document.getElementById('voiceTestStatus');
      const ek = this.getElevenLabsKey();
      if (!ek) { status.textContent = 'Add ElevenLabs key first'; status.style.color = '#d45858'; return; }
      status.textContent = `Playing ${voiceNames[voiceIdx]}...`; status.style.color = 'var(--accent)';
      try {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceIds[voiceIdx]}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': ek },
          body: JSON.stringify({ text: `Hi, I'm ${voiceNames[voiceIdx]}. I'll be your NEXUS voice.`, model_id: 'eleven_turbo_v2', voice_settings: { stability: .45, similarity_boost: .78, style: .35, use_speaker_boost: true } })
        });
        if (r.ok) {
          const bl = await r.blob(), u = URL.createObjectURL(bl), a = new Audio(u);
          a.play(); a.onended = () => { URL.revokeObjectURL(u); status.textContent = `✓ ${voiceNames[voiceIdx]} ready`; status.style.color = '#5bba5f'; };
        } else { status.textContent = 'Voice test failed'; status.style.color = '#d45858'; }
      } catch (e) { status.textContent = 'Error: ' + e.message; status.style.color = '#d45858'; }
    });

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
        await this.driveBackupKeys(); s.textContent = '✓ Backed up to Drive'; s.style.color = '#5bba5f';
      } catch (e) { s.textContent = 'Failed: ' + e.message; s.style.color = '#d45858'; }
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
        s.textContent = '✓ Restored from Drive'; s.style.color = '#5bba5f';
      } catch (e) { s.textContent = 'Failed: ' + e.message; s.style.color = '#d45858'; }
    });

    const driveToken = localStorage.getItem('nexus_drive_token');
    const driveExpiry = localStorage.getItem('nexus_drive_expiry');
    if (driveToken && driveExpiry && Date.now() < parseInt(driveExpiry)) {
      const ds = document.getElementById('driveStatus');
      if (ds) { ds.textContent = '✓ Connected'; ds.style.color = '#5bba5f'; }
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
      const { error } = await this.sb.from('nexus_users').insert({ name, pin, role, location: loc, language: lang });
      if (error) {
        if (error.message.includes('unique') || error.message.includes('duplicate')) {
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

  async loadUserList() {
    const el = document.getElementById('adminUserList'); if (!el) return;
    try {
      const { data } = await this.sb.from('nexus_users').select('*').order('created_at');
      if (!data) return;
      el.innerHTML = data.map(u => `
        <div class="admin-user-row">
          <span class="admin-user-name-sm">${u.name}</span>
          <span class="admin-user-role-sm">${u.role}</span>
          <span class="admin-user-loc-sm">${u.location}</span>
          <span class="admin-user-loc-sm">${u.language||'en'}</span>
          <span class="admin-user-pin-sm">PIN: ${u.pin}</span>
          ${u.id !== this.currentUser?.id ? `<button class="admin-user-del" data-id="${u.id}">✕</button>` : ''}
        </div>
      `).join('');
      el.querySelectorAll('.admin-user-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Remove this user?')) return;
          await this.sb.from('nexus_users').delete().eq('id', btn.dataset.id);
          this.loadUserList();
        });
      });
    } catch (e) { el.innerHTML = '<div style="color:var(--faint);font-size:11px">Could not load users</div>'; }
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
    if (!clientId) { alert('No Google Client ID'); return; }
    const doConnect = () => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: (r) => {
          if (r.access_token) {
            localStorage.setItem('nexus_drive_token', r.access_token);
            localStorage.setItem('nexus_drive_expiry', String(Date.now() + 55 * 60 * 1000));
            const s = document.getElementById('driveStatus');
            if (s) { s.textContent = '✓ Connected'; s.style.color = '#5bba5f'; }
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
          el.innerHTML = `<div class="agenda-item-title">🔧 ${(t.title || t.notes || '').slice(0, 30)}</div><div class="agenda-item-meta">${t.reported_by || ''} · ${t.priority || ''}</div>`;
          col.appendChild(el);
        });

        // Contractor events for this location — with triage actions
        const locEvents = (events || []).filter(e => (e.location || '').toLowerCase() === loc).slice(0, 4);
        locEvents.forEach(e => {
          const el = document.createElement('div');
          el.className = 'agenda-item agenda-event';
          el.innerHTML = `<div class="agenda-item-title">👷 ${e.contractor_name}</div><div class="agenda-item-meta">${e.event_date || ''} ${e.event_time || ''} · ${e.description || ''}</div><div class="agenda-actions"><button class="ag-btn ag-accept" data-action="accepted" title="Confirm">✓</button><button class="ag-btn ag-dismiss" data-action="dismissed" title="Dismiss">—</button><button class="ag-btn ag-disregard" data-action="disregarded" title="Disregard">✕</button></div>`;
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
      if (!confirm(`Import: ${tableList}\n\nThis will ADD data (not replace). Duplicates will be skipped. Continue?`)) {
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
      status.style.color = '#5bba5f';
      this.toast('Imported: ' + summary.join(', '), 'success');
      await this.loadNodes();
      if (this.brain) this.brain.init();
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.style.color = '#d45858';
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
      // Try unified cards table first
      let count=0;
      const{count:c1,error}=await this.sb.from('cards').select('*',{count:'exact',head:true}).eq('status','todo').eq('priority','urgent');
      if(!error){count=c1||0;}
      else{
        const{count:c2}=await this.sb.from('tickets').select('*',{count:'exact',head:true}).eq('status','open');
        count=c2||0;
      }
      const badge=document.getElementById('ticketBadge');
      if(badge){badge.textContent=count||'';badge.style.display=count?'flex':'none';}
    }catch(e){}
  },

  // ─── Expanded System Logging ───
  // Auto-logs every system event to daily_logs
  async syslog(event,detail){
    const ICONS={
      login:'🔑',logout:'🔑',
      clock_in:'⏱',clock_out:'⏱',
      card_created:'📋',card_moved:'📋',card_closed:'📋',card_deleted:'📋',
      clean_checked:'🧹',clean_unchecked:'🧹',clean_report:'🧹',
      chat_ask:'💬',
      batch_complete:'📥',
      notify_captured:'📱',sms_captured:'📱',
      privacy_delete:'🔒',privacy_keep:'🔒',privacy_private:'🔒',privacy_edit:'🔒',
      node_created:'🧠',node_updated:'🧠',node_deleted:'🧠',
      email_processed:'✉',gmail_refresh:'✉',
      doc_scanned:'📷',
      whatsapp_import:'📱',sms_import:'📱',contact_import:'👤',
      digest_generated:'📊',
      backup_exported:'⬇',backup_imported:'⬆',
      link_built:'🔗',
      theme_change:'🎨',
      error:'❌'
    };
    const icon=ICONS[event]||'⚡';
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
          banner.innerHTML='🔵 TODAY: '+briefing.contractors.map(e=>`<b>${e.contractor_name}</b>${e.event_time?' @ '+e.event_time:''}${e.location?' · '+e.location:''}`).join(' | ')+' <button class="alert-dismiss" onclick="this.parentElement.style.display=\'none\';this.parentElement.dataset.dismissed=\'1\'">✕</button>';
          banner.style.display='';
        }
      }

      // Overdue cards — try unified cards table first
      let overdue=[];
      const{data:oCards,error:oErr}=await this.sb.from('cards').select('title,due_date')
        .lt('due_date',today).not('status','eq','done').not('status','eq','closed').limit(20);
      if(!oErr&&oCards){overdue=oCards;}
      else{
        const{data:oLegacy}=await this.sb.from('kanban_cards').select('title,due_date')
          .lt('due_date',today).neq('column_name','done').limit(20);
        if(oLegacy)overdue=oLegacy;
      }
      briefing.overdue=overdue;

      // Show overdue banner
      if(briefing.overdue.length){
        const count=briefing.overdue.length>=20?'20+':briefing.overdue.length;
        const banner=document.getElementById('overdueBanner');
        if(banner&&!banner.dataset.dismissed){
          banner.innerHTML=`⚠ ${count} OVERDUE: ${briefing.overdue.slice(0,3).map(c=>c.title).join(', ')}${briefing.overdue.length>3?' +more':''} <button class="alert-dismiss" onclick="this.parentElement.style.display='none';this.parentElement.dataset.dismissed='1'">✕</button>`;
          banner.style.display='';
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
          briefEl.innerHTML=`<div class="brief-header">☀ Morning Brief</div><div class="brief-text">${brief[0].brief_text}</div><button class="brief-dismiss" onclick="this.parentElement.style.display='none';NX.trackBriefDismiss()">✕</button>`;
          briefEl.dataset.shownAt=Date.now();
          welcome.parentElement.insertBefore(briefEl,welcome.nextSibling);
        }
      }
    }catch(e){}

    // Store for proactive chat
    this._briefingData=briefing;

    // Quick toast summary
    const items=[];
    if(briefing.tickets.length)items.push(`🔴 ${briefing.tickets.length} ticket${briefing.tickets.length>1?'s':''}`);
    if(briefing.contractors.length)items.push(`🔵 ${briefing.contractors.map(e=>e.contractor_name).join(', ')} today`);
    if(briefing.overdue.length>3)items.push(`⚠ ${briefing.overdue.length} overdue`);
    if(!briefing.clockedIn){
      // Only remind during typical operating hours (10am-11pm). No point nagging at 3am.
      const hour=new Date().getHours();
      if(hour>=10&&hour<23)items.push(`⏱ Not clocked in`);
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
    const key = this.getApiKey();
    if (!key) return '';
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
      const data = await resp.json();
      if (data.error) return '';
      return data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
    } catch (e) { return ''; }
  }
};

document.addEventListener('DOMContentLoaded', () => NX.init());

// Register service worker for offline support + push notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    // Initialize push subscription + deep-link handlers once we have a logged-in user.
    // We poll because PIN login happens async, no event fires for it.
    const tryInit = (attempts = 0) => {
      if (NX.currentUser) {
        NX.push.init(reg);
        NX.deepLink.init();
      } else if (attempts < 60) {
        setTimeout(() => tryInit(attempts + 1), 1000);
      }
    };
    tryInit();
  }).catch(err => console.warn('[sw] register failed:', err));
}

// ── PUSH NOTIFICATIONS ───────────────────────────────────────────────
// Full subscription module. Exposes:
//   NX.push.enable()  — prompt user, subscribe, save to DB
//   NX.push.disable() — unsubscribe and remove from DB
//   NX.push.status()  — 'granted' | 'denied' | 'default' | 'unsupported' | 'no-vapid'
// Wire buttons like:
//   <button onclick="NX.push.enable()">🔔 Enable Notifications</button>
NX.push = {
  reg: null,
  vapidKey: null,

  async init(serviceWorkerReg) {
    this.reg = serviceWorkerReg;
    if (!('PushManager' in window)) {
      console.log('[push] PushManager not supported');
      return;
    }
    if (!NX.currentUser) return;

    // Fetch the VAPID public key from nexus_config (single source of truth)
    try {
      const { data: cfg } = await NX.sb
        .from('nexus_config')
        .select('vapid_public_key')
        .eq('id', 1)
        .single();
      if (!cfg?.vapid_public_key) {
        console.log('[push] no VAPID key in nexus_config — push disabled');
        return;
      }
      this.vapidKey = cfg.vapid_public_key;
    } catch (e) {
      console.warn('[push] failed to load VAPID key:', e);
      return;
    }

    // If already subscribed, refresh last_seen_at in the DB
    try {
      const existing = await this.reg.pushManager.getSubscription();
      if (existing) await this._save(existing);
    } catch (e) {
      console.warn('[push] resubscribe check failed:', e);
    }
  },

  status() {
    if (!('PushManager' in window) || !this.reg) return 'unsupported';
    if (!this.vapidKey) return 'no-vapid';
    return Notification.permission;
  },

  async enable() {
    const s = this.status();
    if (s === 'unsupported') {
      NX.toast?.('Push not supported on this browser', 'warn');
      return false;
    }
    if (s === 'no-vapid') {
      NX.toast?.('Push not configured (admin: set VAPID key)', 'error');
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        NX.toast?.('Notification permission denied', 'warn');
        return false;
      }
      const sub = await this.reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlB64ToUint8Array(this.vapidKey),
      });
      await this._save(sub);
      NX.toast?.('Notifications enabled ✓', 'success');
      return true;
    } catch (e) {
      console.error('[push] enable failed:', e);
      NX.toast?.('Notifications failed: ' + e.message, 'error');
      return false;
    }
  },

  async disable() {
    if (!this.reg) return false;
    try {
      const sub = await this.reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      if (NX.currentUser) {
        await NX.sb.from('push_subscriptions')
          .delete().eq('user_id', String(NX.currentUser.id));
      }
      NX.toast?.('Notifications disabled', 'info');
      return true;
    } catch (e) {
      console.warn('[push] disable error:', e);
      return false;
    }
  },

  async _save(sub) {
    if (!NX.currentUser) return;
    try {
      await NX.sb.from('push_subscriptions').upsert({
        user_id: String(NX.currentUser.id),
        user_name: NX.currentUser.name,
        subscription: sub.toJSON(),
        user_agent: navigator.userAgent.slice(0, 200),
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch (e) {
      console.warn('[push] save failed:', e);
    }
  },

  _urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const b64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  },
};

// ── NOTIFICATION DEEP LINKS ──────────────────────────────────────────
// When a push notification arrives:
//   * If app is already open: service worker posts 'nexus-notification-click'
//     message here and we navigate to the right view + entity.
//   * If app is NOT open: SW opens a new window with ?view=X&id=Y&alert=Z,
//     and we handle those params on startup, then clean the URL.
//
// Alert types map to views:
//   pm_due / warranty_expiring / dispatch_stale → equipment + openDetail(id)
//   pattern_due  → log view
//   broadcast    → brain view
NX.deepLink = {
  // Main handler — called from both URL params and SW postMessage.
  async handle({ view, id, alertType }) {
    if (!view) return;
    console.log('[deepLink] handling', { view, id, alertType });

    // Switch to the requested view. Brain has a special button;
    // other views use the .nav-tab or .bnav-btn with matching data-view.
    if (view === 'brain') {
      document.getElementById('navNexus')?.click();
    } else {
      const btn = document.querySelector(`.nav-tab[data-view="${view}"]`)
               || document.querySelector(`.bnav-btn[data-view="${view}"]`);
      if (btn) btn.click();
    }

    // If an entity ID was provided, open it after the view has activated.
    if (!id) return;

    if (view === 'equipment') {
      // Wait for the equipment module to finish loading (first-click init)
      const ready = await this._waitFor(
        () => NX.modules?.equipment?.openDetail, 10000
      );
      if (ready) {
        // Small delay so the view is visually active before the modal opens
        setTimeout(() => {
          try { NX.modules.equipment.openDetail(id); }
          catch (e) { console.warn('[deepLink] openDetail failed:', e); }
        }, 400);
      } else {
        console.warn('[deepLink] equipment module did not load in time');
      }
    }
    // log / brain views: switching to the view is enough for now
  },

  // Poll for a condition every 100ms until true or timeout
  async _waitFor(pred, maxMs = 10000) {
    const start = Date.now();
    while (!pred() && Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 100));
    }
    return pred();
  },

  // Read ?view=X&id=Y&alert=Z from the URL on startup, then clean the URL
  _readStartupParams() {
    const url = new URL(window.location.href);
    const view = url.searchParams.get('view');
    const id = url.searchParams.get('id');
    const alertType = url.searchParams.get('alert');
    if (!view) return;

    this.handle({ view, id, alertType });

    url.searchParams.delete('view');
    url.searchParams.delete('id');
    url.searchParams.delete('alert');
    window.history.replaceState({}, '', url);
  },

  // Service worker → app messaging (notification clicked while app is open)
  _listenSW() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'nexus-notification-click') {
        this.handle({
          view: msg.view,
          id: msg.entityId,
          alertType: msg.alertType,
        });
      }
    });
  },

  // Called once after login
  init() {
    this._listenSW();
    // Give NX modules a moment to finish their own init before we try to route
    setTimeout(() => this._readStartupParams(), 2000);
  },
};

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
      document.getElementById('tcStatus').textContent = isIn ? 'CLOCKED IN' : 'NOT CLOCKED IN';
      document.getElementById('tcStatus').style.color = isIn ? '#5bba5f' : 'rgba(255,255,255,.4)';
      document.getElementById('tcTime').textContent = isIn ? this.getElapsed() || '0:00:00' : '';
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
      popup.querySelector('.tc-popup-time').style.color = isIn ? '#5bba5f' : 'var(--faint)';
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
      this.loadPinLog()
    ]);
    
    this.updateUI();
    this.startTimer();

    document.getElementById('tcClockIn')?.addEventListener('click', () => {
      const loc = document.getElementById('tcLocation')?.value || '';
      if (loc === '__new__') return; // shouldn't happen, handled in change
      localStorage.setItem('nexus_last_location', loc);
      this.clockIn(loc);
    });
    document.getElementById('tcClockOut')?.addEventListener('click', () => this.clockOut());
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
    sel.addEventListener('change', () => {
      if (sel.value === '__new__') {
        const name = prompt('Enter new location name:');
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
      const since = new Date();
      since.setDate(since.getDate() - 14);
      const { data } = await NX.sb.from('time_clock').select('*')
        .eq('user_id', NX.currentUser.id)
        .gte('clock_in', since.toISOString())
        .order('clock_in', { ascending: false }).limit(7);
      if (!data || !data.length) { list.innerHTML = '<div style="font-size:10px;color:var(--faint);text-align:center">No recent records</div>'; return; }
      list.innerHTML = data.map(r => {
        const cin = new Date(r.clock_in);
        const day = cin.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const hrs = r.hours ? r.hours.toFixed(1) + 'h' : '...';
        const loc = r.location ? ` · ${r.location}` : '';
        return `<div class="tc-pin-log-row"><span class="tc-pin-log-date">${day}${loc}</span><span class="tc-pin-log-hrs">${hrs}</span></div>`;
      }).join('');
    } catch (e) {}
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
      const { data } = await NX.sb.from('nexus_users').select('id,name');
      if (data) {
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
