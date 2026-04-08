/* ═══════════════════════════════════════════
   NEXUS — App Orchestrator (app.js)
   Initializes Supabase, handles routing,
   lazy-loads modules on demand.
   ═══════════════════════════════════════════ */

const NX = {
  // ─── Config ───
  SUPA_URL: 'https://oprsthfxqrdbwdvommpw.supabase.co',
  SUPA_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wcnN0aGZ4cXJkYndkdm9tbXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MDU2MzMsImV4cCI6MjA5MTE4MTYzM30.1Yy5BNXWy19Xzdt-ZdcoF0_MF6vvr1rYN5mcDsRYSWY',
  API_KEY: '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',
  ADMIN_PASS: 'orion',
  TRELLO_KEY: '58b11ca040f84d8d2161ec09d8eee293',
  TRELLO_TOKEN: 'ATTAe10c6dc43d33e8a92cfd90cd402b5c057f78aaccfa6af24ccac846306d379f05991808BA',

  // ─── Shared State ───
  sb: null,
  isAdmin: false,
  nodes: [],
  today: new Date().toISOString().split('T')[0],

  // ─── Module registry ───
  modules: {},
  loaded: {},
  brain: null,  // always loaded

  // ─── Initialize ───
  init() {
    this.sb = supabase.createClient(this.SUPA_URL, this.SUPA_KEY);
    this.loadNodes().then(() => {
      this.loadScript('js/brain.js', () => {
        NX.brain.init();
      });
    });
    this.setupNav();
    this.setupAdmin();
  },

  // ─── Load nodes (shared across modules) ───
  async loadNodes() {
    // Seed nodes always available
    this.nodes = this.getSeedNodes();
    try {
      const { data } = await this.sb.from('nodes').select('*');
      if (data && data.length) this.nodes = data;
    } catch (e) {
      console.log('Supabase unavailable, using seed nodes');
    }
  },

  // ─── Tab Routing ───
  setupNav() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(view + 'View').classList.add('active');
        this.activateModule(view);
      });
    });
  },

  activateModule(view) {
    const moduleMap = {
      brain: 'js/brain.js',
      clean: 'js/cleaning.js',
      log: 'js/log.js',
      board: 'js/board.js',
      ingest: 'js/admin.js'
    };
    const file = moduleMap[view];
    if (!file) return;

    if (this.loaded[view]) {
      // Already loaded — just show
      const mod = this.modules[view];
      if (mod && mod.show) mod.show();
    } else {
      // Lazy load
      this.loadScript(file, () => {
        this.loaded[view] = true;
        const mod = this.modules[view];
        if (mod && mod.init) mod.init();
      });
    }
  },

  // ─── Dynamic Script Loader ───
  loadScript(src, cb) {
    // Prevent double-loading
    if (document.querySelector(`script[src="${src}"]`)) {
      if (cb) cb();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = () => console.error('Failed to load:', src);
    document.body.appendChild(s);
  },

  // ─── Admin ───
  setupAdmin() {
    document.getElementById('adminBtn').addEventListener('click', () => {
      if (this.isAdmin) {
        this.isAdmin = false;
        document.getElementById('adminBtn').classList.remove('on');
        document.getElementById('ingestTab').style.display = 'none';
        return;
      }
      document.getElementById('adminModal').style.display = 'flex';
    });
    document.getElementById('adminEnter').addEventListener('click', () => {
      if (document.getElementById('adminPass').value === this.ADMIN_PASS) {
        this.isAdmin = true;
        document.getElementById('adminBtn').classList.add('on');
        document.getElementById('adminModal').style.display = 'none';
        document.getElementById('adminPass').value = '';
        document.getElementById('ingestTab').style.display = '';
      } else {
        alert('Nope.');
      }
    });
    document.getElementById('adminCancel').addEventListener('click', () => {
      document.getElementById('adminModal').style.display = 'none';
      document.getElementById('adminPass').value = '';
    });
  },

  // ─── Claude API helper ───
  async askClaude(system, messages, maxTokens = 600) {
    const key = localStorage.getItem('nexus_api_key') || this.API_KEY;
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system,
        messages
      })
    });
    const data = await resp.json();
    return data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
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
