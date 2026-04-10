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
  paused: false, // Kill switch for all Supabase operations

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
      const { data } = await this.sb.from('chat_history').select('question,answer,created_at').order('created_at', { ascending: false }).limit(50);
      if (!data || !data.length) return '';
      const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const scored = data.map(row => {
        const text = ((row.question || '') + ' ' + (row.answer || '')).toLowerCase();
        let score = 0; words.forEach(w => { if (text.includes(w)) score++; });
        return { row, score };
      }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      if (!scored.length) return '';
      return '\n\nPAST CONVERSATIONS:\n' + scored.map(s => {
        const date = new Date(s.row.created_at).toLocaleDateString();
        return `[${date}] Q: ${s.row.question}\nA: ${(s.row.answer || '').slice(0, 200)}`;
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
      this.nodes = all;
    } catch (e) { this.nodes = []; }
  },

  // ═══ PIN AUTH ═══
  setupPinScreen() {
    let pin = '';
    const display = document.getElementById('pinDisplay');
    const circles = display.querySelectorAll('.pin-circle');
    const error = document.getElementById('pinError');
    const userEl = document.getElementById('pinUser');

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
        // Update PIN screen text immediately
        const sub = document.querySelector('.pin-sub');
        if (sub) sub.textContent = lang === 'es' ? 'Ingrese su PIN' : 'Enter your PIN';
      });
    });

    // Check if user was previously logged in (session persistence)
    const savedUser = localStorage.getItem('nexus_current_user');
    if (savedUser) {
      try {
        const u = JSON.parse(savedUser);
        this.currentUser = u;
        this.applyRole(u.role);
        this.loadConfigAndStart();
        return;
      } catch (e) { localStorage.removeItem('nexus_current_user'); }
    }
  },

  async authenticatePin(pin, errorEl, userEl, resetFn) {
    try {
      errorEl.textContent = '';
      const { data, error } = await this.sb.from('nexus_users').select('*').eq('pin', pin).single();
      if (error) {
        console.error('NEXUS PIN:', error.message, error.code);
        // Table might not exist — allow admin bypass with 0000
        if (error.message.includes('does not exist') || error.message.includes('relation') || error.code === '42P01') {
          errorEl.textContent = 'Setup needed — run SQL';
          if (pin === '0000') {
            this.currentUser = { id: 0, name: 'Admin', pin: '0000', role: 'admin', location: 'suerte', language: 'en' };
            localStorage.setItem('nexus_current_user', JSON.stringify(this.currentUser));
            userEl.textContent = 'Admin (setup mode)'; userEl.classList.add('visible');
            this.applyRole('admin');
            setTimeout(() => this.loadConfigAndStart(), 600); return;
          }
        } else if (error.code === 'PGRST116') {
          // No matching row — invalid PIN
          errorEl.textContent = this.i18n ? this.i18n.t('invalidPin') : 'Invalid PIN';
        } else {
          errorEl.textContent = 'Connection error';
        }
        errorEl.classList.add('shake'); setTimeout(() => errorEl.classList.remove('shake'), 500);
        resetFn(); return;
      }
      if (!data) { errorEl.textContent = this.i18n ? this.i18n.t('invalidPin') : 'Invalid PIN'; errorEl.classList.add('shake'); setTimeout(() => errorEl.classList.remove('shake'), 500); resetFn(); return; }
      this.currentUser = data;
      localStorage.setItem('nexus_current_user', JSON.stringify(data));
      if (data.language && this.i18n && data.language !== this.i18n.getLang()) {
        localStorage.setItem('nexus_lang', data.language);
      }
      userEl.textContent = (this.i18n ? this.i18n.t('welcome') : 'Welcome,') + ' ' + data.name;
      userEl.classList.add('visible');
      this.applyRole(data.role);
      setTimeout(() => this.loadConfigAndStart(), 600);
    } catch (e) {
      console.error('NEXUS auth:', e);
      errorEl.textContent = 'Connection failed';
      errorEl.classList.add('shake'); setTimeout(() => errorEl.classList.remove('shake'), 500);
      resetFn();
    }
  },

  applyRole(role) {
    this.isAdmin = role === 'admin';
    this.isManager = role === 'manager' || role === 'admin';
    this.isStaff = true;
  },

  async loadConfigAndStart() {
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
    }
    // Staff: hide board and ingest, show only cleaning + log
    if (!this.isManager && !this.isAdmin) {
      document.querySelector('[data-view="board"]').style.display = 'none';
    }

    // Continue with normal init
    this.loadNodes().then(() => {
      this.loadScript('js/brain-canvas.js', () => {
        this.loadScript('js/brain-list.js', () => {
          this.loadScript('js/brain-events.js', () => {
            this.loadScript('js/brain-chat.js', () => {
              NX.brain.init();
            });
          });
        });
      });
    });
    this.setupNav();
    this.setupAdmin();
    // Ticket badge
    this.checkTicketBadge();
    // Start real-time watchers
    this.startNodeWatcher();
    this.loadAgenda();
    // Language toggle
    if (this.i18n) {
      const langBtn = document.getElementById('langToggle');
      if (langBtn) {
        langBtn.textContent = this.i18n.getLang().toUpperCase();
        langBtn.addEventListener('click', async () => {
          const newLang = this.i18n.getLang() === 'en' ? 'es' : 'en';
          // Save to user profile
          if(this.currentUser && !this.paused){
            try{await this.sb.from('nexus_users').update({language:newLang}).eq('id',this.currentUser.id);}catch(e){}
            this.currentUser.language=newLang;
            localStorage.setItem('nexus_current_user',JSON.stringify(this.currentUser));
          }
          // Apply immediately
          this.i18n.setLang(newLang);
          langBtn.textContent = newLang.toUpperCase();
        });
      }
      // Apply translations after Lucide icons render
      setTimeout(()=>{if(this.i18n)this.i18n.applyUI();},500);
      setTimeout(()=>{if(this.i18n)this.i18n.applyUI();},1500);
    }
  },

  // ═══ INIT ═══
  init() {
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
    this.setupPinScreen();
  },

  // ─── Nav ───
  setupNav() {
    const tabs = document.querySelectorAll('.nav-tab');
    const nexusBtn = document.getElementById('navNexus');
    const switchTo = (view) => {
      tabs.forEach(t => t.classList.remove('active'));
      nexusBtn.classList.remove('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      if (view === 'brain') { nexusBtn.classList.add('active'); }
      else { const tab = document.querySelector(`.nav-tab[data-view="${view}"]`); if (tab) tab.classList.add('active'); }
      document.getElementById(view + 'View').classList.add('active');
      this.activateModule(view);
      // Re-apply language after view switch
      if(this.i18n)setTimeout(()=>this.i18n.applyUI(),100);
    };
    tabs.forEach(tab => tab.addEventListener('click', () => switchTo(tab.dataset.view)));
    nexusBtn.classList.add('active');
    nexusBtn.addEventListener('click', () => switchTo('brain'));
  },

  activateModule(view) {
    const moduleMap = { clean: 'js/cleaning.js', log: 'js/log.js', board: 'js/board.js', ingest: 'js/admin.js' };
    if (view === 'brain') { if (NX.brain && NX.brain.show) NX.brain.show(); return; }
    const file = moduleMap[view]; if (!file) return;
    if (this.loaded[view]) { const mod = this.modules[view]; if (mod && mod.show) mod.show(); }
    else { this.loadScript(file, () => { this.loaded[view] = true; const mod = this.modules[view]; if (mod && mod.init) mod.init(); if(this.i18n)setTimeout(()=>this.i18n.applyUI(),200); }); }
  },

  loadScript(src, cb) {
    if (document.querySelector(`script[src="${src}"]`)) { if (cb) cb(); return; }
    const s = document.createElement('script'); s.src = src;
    s.onload = () => { if (cb) cb(); };
    s.onerror = () => console.error('Failed:', src);
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
      const keyColor = this.getApiKey() ? '#39ff14' : '#ff5533';
      const source = this.config?.anthropic_key ? 'Supabase' : (localStorage.getItem('nexus_api_key') ? 'localStorage' : 'none');
      userInfo.innerHTML = `<span class="admin-user-name">${this.currentUser.name}</span><span class="admin-user-role">${this.currentUser.role.toUpperCase()}</span><div style="font-size:11px;margin-top:6px;color:${keyColor}">${hasKey} (source: ${source})</div>`;
    }

    document.getElementById('adminBtn').addEventListener('click', () => {
      modal.classList.add('open'); modal.style.display = 'flex';
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
          if (vs) { vs.textContent = `✓ ${voiceNames[idx]} selected & saved`; vs.style.color = '#39ff14'; }
        });
        this.loadUserList();
        // Show chat log for admin
        document.getElementById('adminChatLog').style.display='block';
        this.loadChatLog();
      } else {
        keySection.style.display = 'none';
        document.getElementById('adminChatLog').style.display='none';
      }
    });

    // Save keys → Supabase config table
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
      document.getElementById('adminKeyStatus').style.color = error ? '#ff5533' : '#39ff14';
      setTimeout(() => { document.getElementById('adminKeyStatus').textContent = ''; }, 5000);
    });

    document.getElementById('adminCancel').addEventListener('click', () => {
      modal.classList.remove('open'); modal.style.display = '';
    });

    // Logout
    document.getElementById('adminLogout').addEventListener('click', () => {
      localStorage.removeItem('nexus_current_user');
      location.reload();
    });

    // Test voice button
    document.getElementById('testVoiceBtn').addEventListener('click', async () => {
      const voiceIdx = parseInt(document.getElementById('adminVoice').value) || 0;
      const voiceNames = ['Adam','Bella','Daniel','Charlotte','Liam','Emily','Sam','Dorothy','Arnold','Bill','Antoni','Domi','Fin','Freya','Gigi','Grace','Harry','James','Josh','Rachel'];
      const voiceIds = ['pNInz6obpgDQGcFmaJgB','EXAVITQu4vr4xnSDxMaL','onwK4e9ZLuTAKqWW03F9','XB0fDUnXU5powFXDhCwa','TX3LPaxmHKxFdv7VOQHJ','LcfcDJNUP1GQjkzn1xUU','yoZ06aMxZJJ28mfd3POQ','ThT5KcBeYPX3keUQqHPh','VR6AewLTigWG4xSOukaG','pqHfZKP75CvOlQylNhV4','ErXwobaYiN019PkySvjV','AZnzlk1XvdvUeBnXmlld','D38z5RcWu1voky8WS1ja','jsCqWAovK2LkecY7zXl4','jBpfuIE2acCO8z3wKNLl','oWAxZDx7w5VEj9dCyTzz','SOYHLrjzK2X1ezoPC6cr','ZQe5CZNOzWyzPSCn5a3c','TxGEqnHWrfWFTfGW9XjX','21m00Tcm4TlvDq8ikWAM'];
      const status = document.getElementById('voiceTestStatus');
      const ek = this.getElevenLabsKey();
      if (!ek) { status.textContent = 'Add ElevenLabs key first'; status.style.color = '#ff5533'; return; }
      status.textContent = `Playing ${voiceNames[voiceIdx]}...`; status.style.color = 'var(--accent)';
      try {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceIds[voiceIdx]}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': ek },
          body: JSON.stringify({ text: `Hi, I'm ${voiceNames[voiceIdx]}. I'll be your NEXUS voice.`, model_id: 'eleven_turbo_v2', voice_settings: { stability: .45, similarity_boost: .78, style: .35, use_speaker_boost: true } })
        });
        if (r.ok) {
          const bl = await r.blob(), u = URL.createObjectURL(bl), a = new Audio(u);
          a.play(); a.onended = () => { URL.revokeObjectURL(u); status.textContent = `✓ ${voiceNames[voiceIdx]} ready`; status.style.color = '#39ff14'; };
        } else { status.textContent = 'Voice test failed'; status.style.color = '#ff5533'; }
      } catch (e) { status.textContent = 'Error: ' + e.message; status.style.color = '#ff5533'; }
    });

    // Drive sync
    document.getElementById('driveConnectBtn').addEventListener('click', () => this.driveConnect());
    document.getElementById('driveBackupBtn').addEventListener('click', async () => {
      const s = document.getElementById('driveStatus');
      try { s.textContent = 'Backing up...'; s.style.color = 'var(--muted)';
        await this.driveBackupKeys(); s.textContent = '✓ Backed up to Drive'; s.style.color = '#39ff14';
      } catch (e) { s.textContent = 'Failed: ' + e.message; s.style.color = '#ff5533'; }
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
        s.textContent = '✓ Restored from Drive'; s.style.color = '#39ff14';
      } catch (e) { s.textContent = 'Failed: ' + e.message; s.style.color = '#ff5533'; }
    });

    const driveToken = localStorage.getItem('nexus_drive_token');
    const driveExpiry = localStorage.getItem('nexus_drive_expiry');
    if (driveToken && driveExpiry && Date.now() < parseInt(driveExpiry)) {
      const ds = document.getElementById('driveStatus');
      if (ds) { ds.textContent = '✓ Connected'; ds.style.color = '#39ff14'; }
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
            if (s) { s.textContent = '✓ Connected'; s.style.color = '#39ff14'; }
          }
        }
      });
      tc.requestAccessToken();
    };
    if (window.google?.accounts?.oauth2) doConnect();
    else { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = doConnect; document.head.appendChild(s); }
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
    }, 30000);
  },

  // ─── Agenda Bubbles — tickets + contractors per restaurant ───
  async loadAgenda() {
    if (this.paused) return;
    const locs = ['suerte', 'este', 'toti'];
    try {
      // Open tickets
      const { data: tickets } = await this.sb.from('tickets').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(15);
      // Upcoming contractor events
      const { data: events } = await this.sb.from('contractor_events').select('*').neq('status', 'done').order('event_date', { ascending: true }).limit(15);

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

        // Contractor events for this location
        const locEvents = (events || []).filter(e => (e.location || '').toLowerCase() === loc).slice(0, 3);
        locEvents.forEach(e => {
          const el = document.createElement('div');
          el.className = 'agenda-item agenda-event';
          const isDone = e.status === 'done';
          if (isDone) el.classList.add('agenda-done');
          el.innerHTML = `<div class="agenda-item-title">👷 ${e.contractor_name}${isDone?' ✓':''}</div><div class="agenda-item-meta">${e.event_date || ''} ${e.event_time || ''} · ${e.description || ''}</div>`;
          if (!isDone) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', async () => {
              try {
                await this.sb.from('contractor_events').update({ status: 'done' }).eq('id', e.id);
                el.classList.add('agenda-done');
                el.querySelector('.agenda-item-title').textContent = '👷 ' + e.contractor_name + ' ✓';
                this.toast(e.contractor_name + ' marked done', 'success');
              } catch (err) {}
            });
          }
          col.appendChild(el);
        });

        // Hide column label if empty
        const label = document.querySelector(`#agenda${loc.charAt(0).toUpperCase() + loc.slice(1)} .agenda-label`);
        if (label) label.style.display = (locTickets.length || locEvents.length) ? '' : 'none';
      }
    } catch (e) {}
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

  // ─── Ticket Badge ───
  async checkTicketBadge(){
    if(this.paused)return;
    try{
      const{count}=await this.sb.from('tickets').select('*',{count:'exact',head:true}).eq('status','open');
      const badge=document.getElementById('ticketBadge');
      if(badge){badge.textContent=count||'';badge.style.display=count?'flex':'none';}
    }catch(e){}
    // Poll every 2 minutes
    setInterval(()=>this.checkTicketBadge(),120000);
  },

  // ─── Claude API ───
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
  }
};

document.addEventListener('DOMContentLoaded', () => NX.init());
