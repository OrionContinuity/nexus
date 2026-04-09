/* NEXUS i18n — standalone language module */
const NEXUS_I18N=(function(){
const T={
  en:{
    // Nav
    cleaning:'Cleaning',log:'Log',board:'Board',ingest:'Ingest',
    // PIN
    enterPin:'Enter your PIN',welcome:'Welcome,',
    // Brain
    searchNodes:'Search nodes...',askNexus:'Ask NEXUS...',
    imNexus:"I'm <b>NEXUS</b> — your ops brain. Ask me anything.",
    noNodes:'No knowledge nodes yet',openIngest:'Open Ingest to feed the brain',
    // Chat
    searching:'Searching',nodes:'nodes',
    noApiKey:'No API key — open Admin ⚙ to add your Anthropic key.',
    researchingWeb:'Searching the web for',
    extractingKnowledge:'Extracting knowledge',
    nodesAdded:'nodes added to brain.',
    researchFailed:'Research failed',
    tooVague:'Response too vague to extract nodes. Try a more specific topic.',
    // Cleaning
    shiftProgress:'SHIFT PROGRESS',submitReport:'Submit Daily Report',
    submitting:'Submitting...',submitted:'✓ Submitted',
    savedToLog:'Saved to daily log — view in Log tab',
    extras:'Extras',logged:'logged',quickAdd:'Quick add extra...',
    custom:'+ Custom...',logBtn:'Log',addBtn:'+ Add',
    taskEs:'Task in Spanish...',taskEn:'Task in English...',
    neverDone:'Never done',overdue:'OVERDUE',dueSoon:'Due soon',
    checkAll:'All ✓',undo:'Undo',
    // Log
    logPlaceholder:'Log a repair, observation, or note...',
    knowledgePlaceholder:'Add knowledge to the brain...',
    addBrain:'+ Brain',nothingLogged:'Nothing logged yet.',
    // Board
    todo:'To Do',inProgress:'In Progress',done:'Done',
    // Admin
    admin:'ADMIN',apiKeys:'API Keys',aiModel:'AI Model',voice:'Voice',
    integrations:'Integrations',saveKeys:'Save Keys',
    teamMembers:'Team Members',keySyncDrive:'Key Sync (Google Drive)',
    connectDrive:'Connect Drive',backup:'Backup ↑',restore:'Restore ↓',
    logOut:'Log Out',close:'Close',language:'Language',
    // Ingest
    knowledgeIngestion:'KNOWLEDGE INGESTION',
    mailMonitor:'MAIL MONITOR',mailMonitorDesc:'Auto-scan for parts orders & contractor scheduling.',
    scanOrders:'Scan for Orders & Scheduling',
    emailSync:'EMAIL SYNC',emailSyncDesc:'Pull emails into the brain with source citations.',
    notConnected:'Not connected',connectGmail:'Connect Gmail',
    pasteText:'PASTE TEXT',process:'Process',
    trello:'TRELLO',smartTrello:'Smart Trello Import',
    dataPrivacy:'DATA PRIVACY',dataPrivacyDesc:'AI scans all nodes for personal data.',
    scanRemove:'Scan & Remove Personal Data',
    // Contractor
    contractorSchedule:'CONTRACTOR SCHEDULE',schedule:'+ Schedule',
    // Offline
    noConnection:'No connection — check WiFi',
    // Status
    connectedToDrive:'✓ Connected to Drive',keysSaved:'Keys saved to server ✓',
  },
  es:{
    cleaning:'Limpieza',log:'Registro',board:'Tablero',ingest:'Importar',
    enterPin:'Ingrese su PIN',welcome:'Bienvenido,',
    searchNodes:'Buscar nodos...',askNexus:'Pregunta a NEXUS...',
    imNexus:"Soy <b>NEXUS</b> — tu cerebro de operaciones. Pregúntame lo que sea.",
    noNodes:'No hay nodos de conocimiento',openIngest:'Abre Importar para alimentar el cerebro',
    searching:'Buscando',nodes:'nodos',
    noApiKey:'Sin clave API — abre Admin ⚙ para agregar tu clave Anthropic.',
    researchingWeb:'Buscando en la web',
    extractingKnowledge:'Extrayendo conocimiento',
    nodesAdded:'nodos agregados al cerebro.',
    researchFailed:'Investigación fallida',
    tooVague:'Respuesta muy vaga. Intenta un tema más específico.',
    shiftProgress:'PROGRESO DEL TURNO',submitReport:'Enviar Reporte Diario',
    submitting:'Enviando...',submitted:'✓ Enviado',
    savedToLog:'Guardado en registro — ver en pestaña Registro',
    extras:'Extras',logged:'registrados',quickAdd:'Agregar extra rápido...',
    custom:'+ Personalizado...',logBtn:'Registrar',addBtn:'+ Agregar',
    taskEs:'Tarea en español...',taskEn:'Task in English...',
    neverDone:'Nunca hecho',overdue:'ATRASADO',dueSoon:'Próximamente',
    checkAll:'Todo ✓',undo:'Deshacer',
    logPlaceholder:'Registrar una reparación, observación o nota...',
    knowledgePlaceholder:'Agregar conocimiento al cerebro...',
    addBrain:'+ Cerebro',nothingLogged:'Nada registrado aún.',
    todo:'Por Hacer',inProgress:'En Progreso',done:'Hecho',
    admin:'ADMIN',apiKeys:'Claves API',aiModel:'Modelo de IA',voice:'Voz',
    integrations:'Integraciones',saveKeys:'Guardar Claves',
    teamMembers:'Equipo',keySyncDrive:'Sincronizar Claves (Google Drive)',
    connectDrive:'Conectar Drive',backup:'Respaldar ↑',restore:'Restaurar ↓',
    logOut:'Cerrar Sesión',close:'Cerrar',language:'Idioma',
    knowledgeIngestion:'IMPORTACIÓN DE CONOCIMIENTO',
    mailMonitor:'MONITOR DE CORREO',mailMonitorDesc:'Escaneo automático de pedidos y citas.',
    scanOrders:'Escanear Pedidos y Citas',
    emailSync:'SINCRONIZAR CORREO',emailSyncDesc:'Importar correos al cerebro con citas de origen.',
    notConnected:'No conectado',connectGmail:'Conectar Gmail',
    pasteText:'PEGAR TEXTO',process:'Procesar',
    trello:'TRELLO',smartTrello:'Importar Trello',
    dataPrivacy:'PRIVACIDAD DE DATOS',dataPrivacyDesc:'IA escanea nodos por datos personales.',
    scanRemove:'Escanear y Eliminar Datos Personales',
    contractorSchedule:'CALENDARIO DE CONTRATISTAS',schedule:'+ Agendar',
    noConnection:'Sin conexión — revisa WiFi',
    connectedToDrive:'✓ Conectado a Drive',keysSaved:'Claves guardadas ✓',
  }
};

function getLang(){return localStorage.getItem('nexus_lang')||'en';}
function setLang(lang){localStorage.setItem('nexus_lang',lang);location.reload();}
function t(key){return T[getLang()]?.[key]||T.en[key]||key;}

// Apply translations to static elements
function applyUI(){
  const lang=getLang();
  // Nav
  const tabs=document.querySelectorAll('.nav-tab');
  const tabMap=['clean','log','board','ingest'];
  const labelMap={clean:'cleaning',log:'log',board:'board',ingest:'ingest'};
  tabs.forEach(tab=>{
    const v=tab.dataset.view;
    const lbl=labelMap[v];
    if(lbl){
      const icon=tab.querySelector('i');
      tab.textContent='';
      if(icon)tab.appendChild(icon);
      tab.appendChild(document.createTextNode(' '+t(lbl)));
    }
  });
  // PIN
  const ps=document.querySelector('.pin-sub');if(ps)ps.textContent=t('enterPin');
  // Search
  const bs=document.getElementById('brainSearch');if(bs)bs.placeholder=t('searchNodes');
  // Chat
  const ci=document.getElementById('chatInput');if(ci)ci.placeholder=t('askNexus');
  const hw=document.querySelector('.hud-welcome-text');if(hw)hw.innerHTML=t('imNexus');
  // Empty state
  const cet=document.querySelector('.canvas-empty-text');if(cet)cet.textContent=t('noNodes');
  const ces=document.querySelector('.canvas-empty-sub');if(ces)ces.textContent=t('openIngest');
  // Cleaning
  const sp=document.querySelector('.clean-progress-label');if(sp)sp.textContent=t('shiftProgress');
  const cs=document.getElementById('cleanSubmit');if(cs)cs.textContent=t('submitReport');
  // Log
  const li=document.getElementById('logInput');if(li)li.placeholder=t('logPlaceholder');
  const ki=document.getElementById('knowledgeInput');if(ki)ki.placeholder=t('knowledgePlaceholder');
  const kb=document.getElementById('knowledgeBtn');if(kb)kb.textContent=t('addBrain');
  // Offline
  const ob=document.getElementById('offlineBanner');if(ob)ob.textContent=t('noConnection');
}

return{t,getLang,setLang,applyUI};
})();
