/* NEXUS i18n v2 — Spanish/English, comprehensive */
const NEXUS_I18N=(function(){
const T={
  en:{
    // Nav
    cleaning:'Cleaning',log:'Log',board:'Board',ingest:'Ingest',
    // PIN
    enterPin:'Enter your PIN',welcome:'Welcome,',invalidPin:'Invalid PIN',
    // Brain
    searchNodes:'Search nodes...',askNexus:'Ask NEXUS...',
    imNexus:"I'm <b>NEXUS</b> — your ops brain. Ask me anything.",
    noNodes:'No knowledge nodes yet',openIngest:'Open Ingest to feed the brain',
    voice:'Voice',
    // Chat status
    searching:'Searching',nodes:'nodes',
    noApiKey:'No API key — open Admin ⚙ to add your Anthropic key.',
    researchingWeb:'Searching the web for',
    extractingKnowledge:'Extracting knowledge',
    nodesAdded:'nodes added to brain.',
    researchFailed:'Research failed',
    tooVague:'Response too vague. Try a more specific topic.',
    // Cleaning
    shiftProgress:'SHIFT PROGRESS',submitReport:'Submit Daily Report',
    submitting:'Submitting...',submitted:'✓ Submitted',
    savedToLog:'Saved to daily log — view in Log tab',
    extras:'Extras',logged:'logged',quickAdd:'Quick add extra...',
    custom:'+ Custom...',logIt:'Log',addTask:'+ Add',
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
    admin:'ADMIN',apiKeys:'API Keys',aiModel:'AI Model',voiceLabel:'Voice',
    integrations:'Integrations',saveKeys:'Save Keys',
    teamMembers:'Team Members',keySyncDrive:'Key Sync (Google Drive)',
    connectDrive:'Connect Drive',backup:'Backup ↑',restore:'Restore ↓',
    logOut:'Log Out',close:'Close',language:'Language',
    name:'Name',pin:'PIN',role:'Role',location:'Location',
    staff:'Staff',manager:'Manager',
    // Ingest
    knowledgeIngestion:'KNOWLEDGE INGESTION',
    mailMonitor:'MAIL MONITOR',mailMonitorDesc:'Auto-scan for parts orders & contractor scheduling.',
    scanOrders:'Scan for Orders & Scheduling',
    emailSync:'EMAIL SYNC',emailSyncDesc:'Pull emails into the brain with source citations.',
    notConnected:'Not connected',connectGmail:'Connect Gmail',
    syncEmails:'Sync Emails → Brain',
    pasteText:'PASTE TEXT',process:'Process',
    trello:'TRELLO',smartTrello:'Smart Trello Import',
    dataPrivacy:'DATA PRIVACY',dataPrivacyDesc:'AI scans all nodes for personal data.',
    scanRemove:'Scan & Remove Personal Data',
    relationshipBuilder:'RELATIONSHIP BUILDER',
    relationshipDesc:'AI analyzes nodes and creates connections.',
    buildRelationships:'Build Relationships',
    autoLink:'Auto-link new nodes after import',
    activityLog:'ACTIVITY LOG',clear:'Clear',
    // Contractor
    contractorSchedule:'CONTRACTOR SCHEDULE',schedule:'+ Schedule',
    contractor:'Contractor...',service:'Service...',
    // Offline
    noConnection:'No connection — check WiFi',
    // Node panel
    sources:'SOURCES',attachments:'ATTACHMENTS',connectedTo:'CONNECTED TO',
    deleteNode:'Delete Node',showEmail:'Show full email ▼',hideEmail:'Hide email ▲',
    noSources:'No source emails linked.',
  },
  es:{
    cleaning:'Limpieza',log:'Registro',board:'Tablero',ingest:'Importar',
    enterPin:'Ingrese su PIN',welcome:'Bienvenido,',invalidPin:'PIN inválido',
    searchNodes:'Buscar nodos...',askNexus:'Pregunta a NEXUS...',
    imNexus:"Soy <b>NEXUS</b> — tu cerebro de operaciones. Pregúntame lo que sea.",
    noNodes:'No hay nodos de conocimiento',openIngest:'Abre Importar para alimentar el cerebro',
    voice:'Voz',
    searching:'Buscando',nodes:'nodos',
    noApiKey:'Sin clave API — abre Admin ⚙ para agregar tu clave.',
    researchingWeb:'Buscando en la web',
    extractingKnowledge:'Extrayendo conocimiento',
    nodesAdded:'nodos agregados.',
    researchFailed:'Investigación fallida',
    tooVague:'Respuesta vaga. Intenta un tema más específico.',
    shiftProgress:'PROGRESO DEL TURNO',submitReport:'Enviar Reporte Diario',
    submitting:'Enviando...',submitted:'✓ Enviado',
    savedToLog:'Guardado en registro',
    extras:'Extras',logged:'registrados',quickAdd:'Agregar extra rápido...',
    custom:'+ Personalizado...',logIt:'Registrar',addTask:'+ Agregar',
    taskEs:'Tarea en español...',taskEn:'Task in English...',
    neverDone:'Nunca hecho',overdue:'ATRASADO',dueSoon:'Próximamente',
    checkAll:'Todo ✓',undo:'Deshacer',
    logPlaceholder:'Registrar una reparación, observación o nota...',
    knowledgePlaceholder:'Agregar conocimiento al cerebro...',
    addBrain:'+ Cerebro',nothingLogged:'Nada registrado.',
    todo:'Por Hacer',inProgress:'En Progreso',done:'Hecho',
    admin:'ADMIN',apiKeys:'Claves API',aiModel:'Modelo IA',voiceLabel:'Voz',
    integrations:'Integraciones',saveKeys:'Guardar Claves',
    teamMembers:'Equipo',keySyncDrive:'Sincronizar (Google Drive)',
    connectDrive:'Conectar Drive',backup:'Respaldar ↑',restore:'Restaurar ↓',
    logOut:'Cerrar Sesión',close:'Cerrar',language:'Idioma',
    name:'Nombre',pin:'PIN',role:'Rol',location:'Ubicación',
    staff:'Personal',manager:'Gerente',
    knowledgeIngestion:'IMPORTACIÓN DE CONOCIMIENTO',
    mailMonitor:'MONITOR DE CORREO',mailMonitorDesc:'Escaneo automático de pedidos y citas.',
    scanOrders:'Escanear Pedidos y Citas',
    emailSync:'SINCRONIZAR CORREO',emailSyncDesc:'Importar correos con citas de origen.',
    notConnected:'No conectado',connectGmail:'Conectar Gmail',
    syncEmails:'Sincronizar Correos → Cerebro',
    pasteText:'PEGAR TEXTO',process:'Procesar',
    trello:'TRELLO',smartTrello:'Importar Trello',
    dataPrivacy:'PRIVACIDAD',dataPrivacyDesc:'IA escanea nodos por datos personales.',
    scanRemove:'Escanear y Eliminar Datos',
    relationshipBuilder:'CONSTRUCTOR DE RELACIONES',
    relationshipDesc:'IA analiza nodos y crea conexiones.',
    buildRelationships:'Construir Relaciones',
    autoLink:'Auto-vincular nodos nuevos',
    activityLog:'REGISTRO DE ACTIVIDAD',clear:'Limpiar',
    contractorSchedule:'CALENDARIO DE CONTRATISTAS',schedule:'+ Agendar',
    contractor:'Contratista...',service:'Servicio...',
    noConnection:'Sin conexión — revisa WiFi',
    sources:'FUENTES',attachments:'ADJUNTOS',connectedTo:'CONECTADO A',
    deleteNode:'Eliminar Nodo',showEmail:'Ver correo completo ▼',hideEmail:'Ocultar correo ▲',
    noSources:'Sin correos vinculados.',
  }
};

function getLang(){return localStorage.getItem('nexus_lang')||'en';}
function setLang(lang){localStorage.setItem('nexus_lang',lang);location.reload();}
function t(key){return T[getLang()]?.[key]||T.en[key]||key;}

function applyUI(){
  const lang=getLang();

  // Nav tabs — preserve SVG icons (Lucide replaces <i> with <svg>)
  document.querySelectorAll('.nav-tab').forEach(tab=>{
    const v=tab.dataset.view;
    const map={clean:'cleaning',log:'log',board:'board',ingest:'ingest'};
    if(!map[v])return;
    const svg=tab.querySelector('svg')||tab.querySelector('i');
    const txt=t(map[v]);
    // Clear and rebuild
    while(tab.childNodes.length>0)tab.removeChild(tab.lastChild);
    if(svg)tab.appendChild(svg);
    tab.appendChild(document.createTextNode(' '+txt));
  });

  // PIN screen
  const ps=document.querySelector('.pin-sub');if(ps)ps.textContent=t('enterPin');

  // Brain view
  const bs=document.getElementById('brainSearch');if(bs)bs.placeholder=t('searchNodes');
  const ci=document.getElementById('chatInput');if(ci)ci.placeholder=t('askNexus');
  const hw=document.querySelector('.hud-welcome-text');if(hw)hw.innerHTML=t('imNexus');
  const cet=document.querySelector('.canvas-empty-text');if(cet)cet.textContent=t('noNodes');
  const ces=document.querySelector('.canvas-empty-sub');if(ces)ces.textContent=t('openIngest');
  const ml=document.getElementById('micLabel');if(ml)ml.textContent=t('voice');

  // Cleaning
  const sp=document.querySelector('.clean-progress-label');if(sp)sp.textContent=t('shiftProgress');
  const cs=document.getElementById('cleanSubmit');if(cs&&!cs.disabled)cs.textContent=t('submitReport');
  const cte=document.getElementById('cleanTaskEs');if(cte)cte.placeholder=t('taskEs');
  const ctn=document.getElementById('cleanTaskEn');if(ctn)ctn.placeholder=t('taskEn');
  const cab=document.getElementById('cleanAddBtn');if(cab)cab.textContent=t('addTask');

  // Log
  const li=document.getElementById('logInput');if(li)li.placeholder=t('logPlaceholder');
  const ki=document.getElementById('knowledgeInput');if(ki)ki.placeholder=t('knowledgePlaceholder');
  const kb=document.getElementById('knowledgeBtn');if(kb)kb.textContent=t('addBrain');

  // Offline
  const ob=document.getElementById('offlineBanner');if(ob)ob.textContent=t('noConnection');

  // Contractor
  const ec=document.getElementById('eventContractor');if(ec)ec.placeholder=t('contractor');
  const ed=document.getElementById('eventDesc');if(ed)ed.placeholder=t('service');
  const eab=document.getElementById('eventAddBtn');if(eab)eab.textContent=t('schedule');

  // Ingest sections
  document.querySelectorAll('.ingest-section-title').forEach(el=>{
    const txt=el.textContent.trim();
    if(txt.includes('MAIL MONITOR')||txt.includes('MONITOR'))el.innerHTML=el.innerHTML.replace(/MAIL MONITOR|MONITOR DE CORREO/,t('mailMonitor'));
    if(txt.includes('EMAIL SYNC')||txt.includes('SINCRONIZAR'))el.innerHTML=el.innerHTML.replace(/EMAIL SYNC|SINCRONIZAR CORREO/,t('emailSync'));
    if(txt.includes('PASTE TEXT')||txt.includes('PEGAR'))el.innerHTML=el.innerHTML.replace(/PASTE TEXT|PEGAR TEXTO/,t('pasteText'));
    if(txt.includes('DATA PRIVACY')||txt.includes('PRIVACIDAD'))el.innerHTML=el.innerHTML.replace(/DATA PRIVACY|PRIVACIDAD/,t('dataPrivacy'));
    if(txt.includes('RELATIONSHIP')||txt.includes('RELACIONES'))el.innerHTML=el.innerHTML.replace(/RELATIONSHIP BUILDER|CONSTRUCTOR DE RELACIONES/,t('relationshipBuilder'));
    if(txt.includes('ACTIVITY')||txt.includes('REGISTRO DE'))el.innerHTML=el.innerHTML.replace(/ACTIVITY LOG|REGISTRO DE ACTIVIDAD/,t('activityLog'));
  });
  const ih=document.querySelector('.ingest-heading');if(ih)ih.textContent=t('knowledgeIngestion');
  const mmb=document.getElementById('mailMonitorBtn');if(mmb)mmb.textContent=t('scanOrders');
  const gcb=document.getElementById('gmailConnectBtn');if(gcb)gcb.textContent=t('connectGmail');
  const gsb=document.getElementById('gmailSyncBtn');if(gsb)gsb.textContent=t('syncEmails');
  const itb=document.getElementById('ingestTextBtn');if(itb)itb.textContent=t('process');
  const trb=document.getElementById('trelloBtn');if(trb)trb.textContent=t('smartTrello');
  const sb2=document.getElementById('sensitiveBtn');if(sb2)sb2.textContent=t('scanRemove');
  const rb=document.getElementById('relationshipBtn');if(rb)rb.textContent=t('buildRelationships');
  const npd=document.getElementById('npDelete');if(npd)npd.textContent=t('deleteNode');

  // Admin
  document.querySelectorAll('.admin-section-label').forEach(el=>{
    const txt=el.textContent.trim();
    if(txt==='API Keys'||txt==='Claves API')el.textContent=t('apiKeys');
    if(txt==='AI Model'||txt==='Modelo IA'||txt==='Modelo de IA')el.textContent=t('aiModel');
    if(txt==='Voice'||txt==='Voz')el.textContent=t('voiceLabel');
    if(txt==='Integrations'||txt==='Integraciones')el.textContent=t('integrations');
    if(txt.includes('Team')||txt.includes('Equipo'))el.textContent=t('teamMembers');
    if(txt.includes('Key Sync')||txt.includes('Sincronizar'))el.textContent=t('keySyncDrive');
  });
  const ask=document.getElementById('adminSaveKeys');if(ask)ask.textContent=t('saveKeys');
  const alo=document.getElementById('adminLogout');if(alo)alo.textContent=t('logOut');
  const acn=document.getElementById('adminCancel');if(acn)acn.textContent=t('close');
  const dcb=document.getElementById('driveConnectBtn');if(dcb)dcb.textContent=t('connectDrive');
  const dbb=document.getElementById('driveBackupBtn');if(dbb)dbb.textContent=t('backup');
  const drb=document.getElementById('driveRestoreBtn');if(drb)drb.textContent=t('restore');

  // Lang toggle button
  const ltb=document.getElementById('langToggle');if(ltb)ltb.textContent=lang.toUpperCase();
}

return{t,getLang,setLang,applyUI};
})();
