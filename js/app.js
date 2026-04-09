/* ═══════════════════════════════════════════
   NEXUS — App Orchestrator (app.js)
   Initializes Supabase, handles routing,
   lazy-loads modules on demand.
   NO API KEYS IN CODE — all keys via Admin.
   ═══════════════════════════════════════════ */

const NX = {
  // ─── Config (non-secret only) ───
  SUPA_URL: 'https://oprsthfxqrdbwdvommpw.supabase.co',
  SUPA_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wcnN0aGZ4cXJkYndkdm9tbXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MDU2MzMsImV4cCI6MjA5MTE4MTYzM30.1Yy5BNXWy19Xzdt-ZdcoF0_MF6vvr1rYN5mcDsRYSWY',
  ADMIN_PASS: 'orion',

  // ─── Shared State ───
  sb: null,
  isAdmin: false,
  nodes: [],
  today: new Date().toISOString().split('T')[0],

  // ─── Module registry ───
  modules: {},
  loaded: {},
  brain: null,

  // ─── Key helpers (all from localStorage) ───
  getApiKey() { return localStorage.getItem('nexus_api_key') || ''; },
  getElevenLabsKey() { return localStorage.getItem('nexus_eleven_key') || ''; },
  getGoogleClientId() { return localStorage.getItem('nexus_google_client_id') || ''; },
  getTrelloKey() { return localStorage.getItem('nexus_trello_key') || ''; },
  getTrelloToken() { return localStorage.getItem('nexus_trello_token') || ''; },
  getModel() { return localStorage.getItem('nexus_model') || 'claude-sonnet-4-20250514'; },

  // ─── Google Drive Key Sync ───
  // Backs up all API keys to Google Drive appDataFolder (hidden, app-only)
  async driveBackupKeys() {
    const token = localStorage.getItem('nexus_drive_token');
    if (!token) throw new Error('Not connected to Google Drive');
    const config = {
      api_key: this.getApiKey(),
      eleven_key: this.getElevenLabsKey(),
      google_client_id: this.getGoogleClientId(),
      trello_key: this.getTrelloKey(),
      trello_token: this.getTrelloToken(),
      model: this.getModel(),
      voice_idx: localStorage.getItem('nexus_voice_idx') || '0',
      admin_pass: localStorage.getItem('nexus_admin_pass') || '',
      backed_up: new Date().toISOString()
    };
    // Check if file exists
    const searchR = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27nexus-config.json%27&fields=files(id)', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const searchD = await searchR.json();
    const existingId = searchD.files && searchD.files.length ? searchD.files[0].id : null;

    if (existingId) {
      // Update existing file
      await fetch('https://www.googleapis.com/upload/drive/v3/files/' + existingId + '?uploadType=media', {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    } else {
      // Create new file in appDataFolder
      const metadata = { name: 'nexus-config.json', parents: ['appDataFolder'] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', new Blob([JSON.stringify(config)], { type: 'application/json' }));
      await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: form
      });
    }
    return true;
  },

  async driveRestoreKeys() {
    const token = localStorage.getItem('nexus_drive_token');
    if (!token) throw new Error('Not connected to Google Drive');
    const searchR = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27nexus-config.json%27&fields=files(id)', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const searchD = await searchR.json();
    if (!searchD.files || !searchD.files.length) throw new Error('No backup found on Drive');
    const fileR = await fetch('https://www.googleapis.com/drive/v3/files/' + searchD.files[0].id + '?alt=media', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const config = await fileR.json();
    if (config.api_key) localStorage.setItem('nexus_api_key', config.api_key);
    if (config.eleven_key) localStorage.setItem('nexus_eleven_key', config.eleven_key);
    if (config.google_client_id) localStorage.setItem('nexus_google_client_id', config.google_client_id);
    if (config.trello_key) localStorage.setItem('nexus_trello_key', config.trello_key);
    if (config.trello_token) localStorage.setItem('nexus_trello_token', config.trello_token);
    if (config.model) localStorage.setItem('nexus_model', config.model);
    if (config.voice_idx) localStorage.setItem('nexus_voice_idx', config.voice_idx);
    return config;
  },

  driveConnect() {
    const clientId = this.getGoogleClientId();
    if (!clientId) { alert('Add Google OAuth Client ID first in Admin'); return; }
    const doConnect = () => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: (r) => {
          if (r.access_token) {
            localStorage.setItem('nexus_drive_token', r.access_token);
            localStorage.setItem('nexus_drive_expiry', String(Date.now() + 55 * 60 * 1000));
            const s = document.getElementById('driveStatus');
            if (s) { s.textContent = '✓ Connected to Drive'; s.style.color = '#39ff14'; }
          }
        }
      });
      tc.requestAccessToken();
    };
    if (window.google?.accounts?.oauth2) { doConnect(); }
    else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = doConnect;
      document.head.appendChild(s);
    }
  },

  // ─── Persistent Memory: fetch relevant past conversations ───
  async fetchMemory(question) {
    try {
      const { data } = await this.sb.from('chat_history')
        .select('question,answer,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!data || !data.length) return '';
      // Score past conversations by relevance to current question
      const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const scored = data.map(row => {
        const text = ((row.question || '') + ' ' + (row.answer || '')).toLowerCase();
        let score = 0;
        words.forEach(w => { if (text.includes(w)) score++; });
        return { row, score };
      }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      if (!scored.length) return '';
      return '\n\nPAST CONVERSATIONS (your memory):\n' + scored.map(s => {
        const date = new Date(s.row.created_at).toLocaleDateString();
        return `[${date}] Q: ${s.row.question}\nA: ${(s.row.answer || '').slice(0, 200)}`;
      }).join('\n\n');
    } catch (e) { return ''; }
  },

  // ─── Track node access: increment access_count in Supabase ───
  async trackAccess(nodeIds) {
    if (!nodeIds || !nodeIds.length) return;
    for (const id of nodeIds.slice(0, 10)) {
      try {
        const node = this.nodes.find(n => n.id === id);
        if (!node) continue;
        const newCount = (node.access_count || 0) + 1;
        node.access_count = newCount;
        await this.sb.from('nodes').update({ access_count: newCount }).eq('id', id);
      } catch (e) { }
    }
  },

  // ─── Initialize ───
  init() {
    this.sb = supabase.createClient(this.SUPA_URL, this.SUPA_KEY);
    // Auto-restore keys from Drive if none locally
    const driveToken = localStorage.getItem('nexus_drive_token');
    const driveExpiry = localStorage.getItem('nexus_drive_expiry');
    if (!this.getApiKey() && driveToken && driveExpiry && Date.now() < parseInt(driveExpiry)) {
      this.driveRestoreKeys().then((config) => {
        console.log('NEXUS: Keys auto-restored from Drive backup (' + config.backed_up + ')');
      }).catch(() => {});
    }
    this.loadNodes().then(() => {
      // Load brain modules in order: canvas first (creates namespace), then others
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
  },

  // ─── Load nodes (INFINITE — paginated, merged with seeds) ───
  async loadNodes() {
    const seeds = this.getSeedNodes();
    let allNodes = [];
    try {
      // Supabase default limit is 1000 — paginate to get ALL
      let from = 0;
      const PAGE = 1000;
      let keepGoing = true;
      while (keepGoing) {
        const { data, error } = await this.sb.from('nodes').select('*').range(from, from + PAGE - 1);
        if (error) { console.error('Node fetch error:', error); break; }
        if (data && data.length) {
          allNodes = allNodes.concat(data);
          from += PAGE;
          if (data.length < PAGE) keepGoing = false;
        } else {
          keepGoing = false;
        }
      }
      console.log(`Loaded ${allNodes.length} nodes from Supabase`);
    } catch (e) {
      console.log('Supabase unavailable, using seed nodes only');
    }

    // Merge: Supabase nodes take priority, fill in missing seeds
    if (allNodes.length) {
      const dbIds = new Set(allNodes.map(n => n.id));
      const missedSeeds = seeds.filter(s => !dbIds.has(s.id));
      this.nodes = [...allNodes, ...missedSeeds];
    } else {
      this.nodes = seeds;
    }
    console.log(`Total nodes in brain: ${this.nodes.length}`);
  },

  // ─── Tab Routing ───
  setupNav() {
    const tabs = document.querySelectorAll('.nav-tab');
    const nexusBtn = document.getElementById('navNexus');

    const switchTo = (view) => {
      tabs.forEach(t => t.classList.remove('active'));
      nexusBtn.classList.remove('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      if (view === 'brain') {
        nexusBtn.classList.add('active');
      } else {
        const tab = document.querySelector(`.nav-tab[data-view="${view}"]`);
        if (tab) tab.classList.add('active');
      }
      document.getElementById(view + 'View').classList.add('active');
      this.activateModule(view);
    };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => switchTo(tab.dataset.view));
    });

    // NEXUS button → Brain + AI
    nexusBtn.classList.add('active');
    nexusBtn.addEventListener('click', () => switchTo('brain'));
  },

  activateModule(view) {
    const moduleMap = {
      clean: 'js/cleaning.js',
      log: 'js/log.js',
      board: 'js/board.js',
      ingest: 'js/admin.js'
    };
    // Brain is pre-loaded, just call show
    if (view === 'brain') {
      if (NX.brain && NX.brain.show) NX.brain.show();
      return;
    }
    const file = moduleMap[view];
    if (!file) return;
    if (this.loaded[view]) {
      const mod = this.modules[view];
      if (mod && mod.show) mod.show();
    } else {
      this.loadScript(file, () => {
        this.loaded[view] = true;
        const mod = this.modules[view];
        if (mod && mod.init) mod.init();
      });
    }
  },

  // ─── Dynamic Script Loader ───
  loadScript(src, cb) {
    if (document.querySelector(`script[src="${src}"]`)) { if (cb) cb(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = () => console.error('Failed to load:', src);
    document.body.appendChild(s);
  },

  // ─── Admin (with key management) ───
  setupAdmin() {
    const modal = document.getElementById('adminModal');
    const keySection = document.getElementById('adminKeySection');

    document.getElementById('adminBtn').addEventListener('click', () => {
      if (this.isAdmin) {
        // Already admin — show key management
        modal.classList.add('open');modal.style.display='flex';
        document.getElementById('adminPass').style.display = 'none';
        document.getElementById('adminEnter').style.display = 'none';
        keySection.style.display = 'block';
        // Pre-fill masked hints
        const k = this.getApiKey();
        document.getElementById('adminApiKey').placeholder = k ? 'Key saved (••••' + k.slice(-6) + ')' : 'Anthropic API Key';
        const ek = this.getElevenLabsKey();
        document.getElementById('adminElevenKey').placeholder = ek ? 'Key saved (••••' + ek.slice(-4) + ')' : 'ElevenLabs API Key (for voice)';
        const gc = this.getGoogleClientId();
        document.getElementById('adminGoogleClientId').placeholder = gc ? 'ID saved (••••' + gc.slice(-6) + ')' : 'Google OAuth Client ID (for Gmail)';
        const tk = this.getTrelloKey();
        document.getElementById('adminTrelloKey').placeholder = tk ? 'Key saved (••••' + tk.slice(-4) + ')' : 'Trello API Key';
        const tt = this.getTrelloToken();
        document.getElementById('adminTrelloToken').placeholder = tt ? 'Token saved (••••' + tt.slice(-4) + ')' : 'Trello Token';
        // Load model and voice selections
        document.getElementById('adminModel').value = this.getModel();
        document.getElementById('adminVoice').value = localStorage.getItem('nexus_voice_idx') || '0';
        return;
      }
      modal.classList.add('open');modal.style.display='flex';
      document.getElementById('adminPass').style.display = '';
      document.getElementById('adminEnter').style.display = '';
      keySection.style.display = 'none';
    });

    document.getElementById('adminEnter').addEventListener('click', () => {
      if (document.getElementById('adminPass').value === this.ADMIN_PASS) {
        this.isAdmin = true;
        document.getElementById('adminBtn').classList.add('on');
        modal.classList.remove('open');modal.style.display='';
        document.getElementById('adminPass').value = '';
        document.getElementById('ingestTab').style.display = '';
        // Show key section for next open
        keySection.style.display = 'block';
      } else {
        alert('Nope.');
      }
    });

    document.getElementById('adminCancel').addEventListener('click', () => {
      modal.classList.remove('open');modal.style.display='';
      document.getElementById('adminPass').value = '';
    });

    // Save keys handler
    document.getElementById('adminSaveKeys').addEventListener('click', () => {
      const apiKey = document.getElementById('adminApiKey').value.trim();
      const elevenKey = document.getElementById('adminElevenKey').value.trim();
      const googleId = document.getElementById('adminGoogleClientId').value.trim();
      const trelloKey = document.getElementById('adminTrelloKey').value.trim();
      const trelloToken = document.getElementById('adminTrelloToken').value.trim();
      if (apiKey) localStorage.setItem('nexus_api_key', apiKey);
      if (elevenKey) localStorage.setItem('nexus_eleven_key', elevenKey);
      if (googleId) localStorage.setItem('nexus_google_client_id', googleId);
      if (trelloKey) localStorage.setItem('nexus_trello_key', trelloKey);
      if (trelloToken) localStorage.setItem('nexus_trello_token', trelloToken);
      // Save model and voice
      localStorage.setItem('nexus_model', document.getElementById('adminModel').value);
      localStorage.setItem('nexus_voice_idx', document.getElementById('adminVoice').value);
      // Clear fields
      document.getElementById('adminApiKey').value = '';
      document.getElementById('adminElevenKey').value = '';
      document.getElementById('adminGoogleClientId').value = '';
      document.getElementById('adminTrelloKey').value = '';
      document.getElementById('adminTrelloToken').value = '';
      document.getElementById('adminKeyStatus').textContent = 'Keys saved securely.';
      // Auto-backup to Drive if connected
      const dt = localStorage.getItem('nexus_drive_token');
      const de = localStorage.getItem('nexus_drive_expiry');
      if (dt && de && Date.now() < parseInt(de)) {
        NX.driveBackupKeys().then(() => {
          document.getElementById('adminKeyStatus').textContent = 'Keys saved + backed up to Drive ✓';
        }).catch(() => {});
      }
      setTimeout(() => { document.getElementById('adminKeyStatus').textContent = ''; }, 4000);
    });

    // Drive sync buttons
    document.getElementById('driveConnectBtn').addEventListener('click', () => NX.driveConnect());
    document.getElementById('driveBackupBtn').addEventListener('click', async () => {
      const s = document.getElementById('driveStatus');
      try { s.textContent = 'Backing up...'; s.style.color = 'var(--muted)';
        await NX.driveBackupKeys(); s.textContent = '✓ Keys backed up to Drive'; s.style.color = '#39ff14';
      } catch(e) { s.textContent = 'Backup failed: ' + e.message; s.style.color = '#ff5533'; }
    });
    document.getElementById('driveRestoreBtn').addEventListener('click', async () => {
      const s = document.getElementById('driveStatus');
      try { s.textContent = 'Restoring...'; s.style.color = 'var(--muted)';
        const config = await NX.driveRestoreKeys();
        s.textContent = '✓ Keys restored from Drive (backed up ' + new Date(config.backed_up).toLocaleDateString() + ')';
        s.style.color = '#39ff14';
      } catch(e) { s.textContent = 'Restore failed: ' + e.message; s.style.color = '#ff5533'; }
    });

    // Check if Drive token is still valid
    const driveToken = localStorage.getItem('nexus_drive_token');
    const driveExpiry = localStorage.getItem('nexus_drive_expiry');
    if (driveToken && driveExpiry && Date.now() < parseInt(driveExpiry)) {
      const ds = document.getElementById('driveStatus');
      if (ds) { ds.textContent = '✓ Connected to Drive'; ds.style.color = '#39ff14'; }
    }
  },

  // ─── Claude API helper (key from localStorage ONLY) ───
  async askClaude(system, messages, maxTokens = 600, useSearch = false) {
    const key = this.getApiKey();
    if (!key) {
      throw new Error('No API key set. Open Admin (⚙) to add your Anthropic key.');
    }
    try {
      const body = {
        model: this.getModel(),
        max_tokens: maxTokens,
        system,
        messages
      };
      if (useSearch) {
        body.tools = [{ type: "web_search_20250305", name: "web_search" }];
      }
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      if (data.error) {
        console.error('Claude API error:', data.error);
        throw new Error(data.error.message || 'API returned an error');
      }
      return data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
    } catch (e) {
      console.error('askClaude failed:', e);
      throw e;
    }
  },

  // ─── Seed Nodes ───
  getSeedNodes() {
    return [
      {id:1,name:'Suerte',category:'location',tags:['restaurant','austin','kitchen','bar','patio'],notes:'Primary location. 2002 Manor Road. Full kitchen, bar, patio, deck. Mezcal Monday. Uses 7shifts + MarginEdge.',links:[4,5,8,20],access_count:50},
      {id:2,name:'Este',category:'location',tags:['restaurant','austin','patio','vinyl','manor-rd'],notes:'Vino Y Vinyl Tuesdays. Patio with string lights, wisteria project planned. Record player + sound system. Garden program.',links:[8,12,22,25,30,37],access_count:48},
      {id:3,name:'Toti',category:'location',tags:['restaurant','austin','bar'],notes:'Bar Toti. Third location. New True low-boy on order.',links:[8,19],access_count:35},
      {id:4,name:'Hoshizaki Ice Machine',category:'equipment',tags:['ice','hoshizaki','auger','commercial'],notes:'Auger type. Common failure: harvest assist spring. Tyler recommends over Kold Draft.',links:[1,6,15],access_count:30},
      {id:5,name:'Oven Repair Protocol',category:'procedure',tags:['oven','repair','troubleshoot','kitchen'],notes:'Diagnostic: 1) Igniter 2) Gas valve 3) Thermostat 4) Control board. Igniter is #1 failure.',links:[1],access_count:25},
      {id:6,name:'Ice Machine Troubleshoot',category:'procedure',tags:['ice','troubleshoot','hoshizaki'],notes:'No ice: Water supply → inlet valve → evap temp → auger motor → harvest spring.',links:[4],access_count:22},
      {id:7,name:'Z260 Zero-Turn',category:'equipment',tags:['mower','zero-turn','kawasaki'],notes:'Kawasaki FS730V engine. Needs full service. OEM parts.',links:[9],access_count:8},
      {id:8,name:'Cleaning Checklists',category:'procedure',tags:['cleaning','bilingual','daily'],notes:'Bilingual EN/ES all 3 locations. Daily through 6-Month frequencies.',links:[1,2,3],access_count:60},
      {id:9,name:'Kawasaki FS730V',category:'parts',tags:['engine','kawasaki','v-twin'],notes:'Engine on Z260. Fuel pump diaphragm issue.',links:[7],access_count:6},
      {id:10,name:'F-150 EcoBoost',category:'equipment',tags:['ford','f150','truck'],notes:'2016 2.7L EcoBoost. Spark plug spec needed.',links:[],access_count:5},
      {id:11,name:'Craftsman Smart Charger',category:'equipment',tags:['charger','battery'],notes:'Multi-mode battery charger/maintainer.',links:[],access_count:4},
      {id:12,name:'Irrigation Zones',category:'procedure',tags:['irrigation','landscape','este'],notes:'Project 19-320. Interactive HTML diagram.',links:[2],access_count:10},
      {id:13,name:'Ruskin CBD-150',category:'equipment',tags:['damper','backdraft','hvac'],notes:'Backdraft damper. Check blade linkage + actuator.',links:[],access_count:3},
      {id:14,name:'Echo PE-225 Edger',category:'equipment',tags:['echo','edger','2-stroke'],notes:'Diaphragm carb. Fuel lines deteriorate.',links:[],access_count:3},
      {id:15,name:'Austin Air & Ice',category:'contractors',tags:['ice-machine','hvac','refrigeration','warranty'],notes:'Tyler Maffi 512-884-6803. Lori Martin (service). Debbie (invoicing). Office 512-800-2228. Hoshizaki authorized.',links:[4,18,19,28],access_count:40},
      {id:17,name:'Weekend On-Call Rates',category:'procedure',tags:['rates','weekend','service'],notes:'Rate structure for weekend/holiday repair calls.',links:[],access_count:7},
      {id:18,name:'Kold Draft Ice Machine',category:'equipment',tags:['ice','kold-draft','craft-cube'],notes:'Craft cube. Can\'t get larger bin. Tyler recommends Hoshizaki.',links:[15,4],access_count:15},
      {id:19,name:'True Refrigeration',category:'equipment',tags:['true','refrigeration','low-boy'],notes:'New True unit ordered. Invoice #INV2987. Low-boy for Bar Toti.',links:[3,15],access_count:12},
      {id:20,name:'Hoshizaki vs Kold Draft',category:'procedure',tags:['ice','comparison'],notes:'Tyler recommends Hoshizaki: same cube, larger bins, 2-day parts, warranty authorized.',links:[4,18],access_count:18},
      {id:22,name:'Este Sound System',category:'equipment',tags:['speakers','amp','sound','record-player'],notes:'Record player back. Amp popping. 2 speakers acting up. Cordon Connect checking.',links:[2,23],access_count:14},
      {id:23,name:'Cordon Connect',category:'contractors',tags:['sound','speakers','audio'],notes:'Tim Nobles — tim@cordonconnect.com. AV/sound contractor.',links:[22],access_count:10},
      {id:24,name:'Bartlett Tree Experts',category:'contractors',tags:['tree','arborist','pruning'],notes:'Savanna Maddox — Certified Arborist TX-4835A. Tree pruning at Este.',links:[2],access_count:8},
      {id:25,name:'Espresso Machine',category:'equipment',tags:['espresso','coffee','leak'],notes:'Leaking from tray NOT wand. Macchinisti ATX dispatching tech.',links:[2,26],access_count:16},
      {id:26,name:'Macchinisti ATX',category:'contractors',tags:['espresso','coffee','repair'],notes:'Abby — hello@macchinistiatx.com. Espresso service.',links:[25],access_count:10},
      {id:27,name:'Parts Town',category:'vendors',tags:['parts','equipment','supply'],notes:'Customer #0101165421. Fast shipping. Recent orders on file.',links:[],access_count:20},
      {id:28,name:'Controllers (Fan Motor)',category:'equipment',tags:['controller','fan-motor','hvac'],notes:'Fan motor part ordered. Lori confirmed completed 4/7/2026.',links:[15],access_count:8},
      {id:29,name:'Masienda',category:'vendors',tags:['corn','masa','tortilla'],notes:'Corn/masa supplier. Order #162125 shipped.',links:[],access_count:6},
      {id:30,name:'Flourish Austin',category:'contractors',tags:['plants','landscape','wisteria'],notes:'Rachel Roberts. Wisteria project for Este patio.',links:[2,37],access_count:8},
      {id:31,name:'KaTom Restaurant Supply',category:'vendors',tags:['equipment','kitchen'],notes:'Restaurant equipment vendor.',links:[],access_count:4},
      {id:37,name:'Este Wisteria Project',category:'projects',tags:['wisteria','patio','plants'],notes:'Wisteria on patio cables. Cable strong enough. Easy to implement.',links:[2,30],access_count:12},
      {id:38,name:'Frost Insurance',category:'contractors',tags:['insurance','inspection'],notes:'Michael Henry. Policy FSF18800238. Inspection walkthrough pending.',links:[1],access_count:6},
      {id:39,name:'Joss Growers',category:'vendors',tags:['plants','nursery'],notes:'Plant supplier.',links:[],access_count:3},
      {id:40,name:'Mushroom Blocks',category:'projects',tags:['mushroom','garden'],notes:'Central Texas Mycology. Good for front plants. Easy.',links:[],access_count:5},
      {id:41,name:'Employee Review Tracker',category:'projects',tags:['reviews','hr','tracker'],notes:'Celia created tracker. Cleaning crew templates discussed.',links:[],access_count:9},
      {id:42,name:'7shifts',category:'systems',tags:['scheduling','staff','chat'],notes:'Staff scheduling + chat. All locations.',links:[1,2,3],access_count:55},
      {id:43,name:'MarginEdge',category:'systems',tags:['sales','reporting'],notes:'Nightly sales reports + price alerts.',links:[1,2],access_count:45},
    ];
  }
};

// ─── Boot ───
document.addEventListener('DOMContentLoaded', () => NX.init());
