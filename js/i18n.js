/* NEXUS i18n v3 — Complete EN/ES coverage */
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
    noNodes:'No knowledge nodes yet',getStarted:'Get started:',
    tipIngest:'Open <b>Ingest</b> → connect Gmail or drop email files',
    tipRemember:'Chat: type <b>remember [name] - [details]</b> to add knowledge',
    tipLookup:'Chat: type <b>look up [topic]</b> to search the web',
    // Chat
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
    logTip:'Log a repair, observation, or note above.',
    logTip2:'Cleaning reports auto-save here too.',
    // Board
    todo:'To Do',inProgress:'In Progress',done:'Done',
    // Admin
    admin:'ADMIN',apiKeys:'API Keys',aiModel:'AI Model',voiceLabel:'Voice',
    integrations:'Integrations',saveKeys:'Save Keys',
    teamMembers:'Team Members',keySyncDrive:'Key Sync (Google Drive)',
    connectDrive:'Connect Drive',backup:'Backup ↑',restore:'Restore ↓',
    logOut:'Log Out',close:'Close',language:'Language',
    name:'Name',pin:'PIN',role:'Role',location:'Location',
    staff:'Staff',manager:'Manager',chatHistory:'Chat History',
    // Ingest
    ingestion:'INGESTION',
    email:'Email',mailMonitor:'Mail Monitor',pasteText:'Paste Text',
    trello:'Trello',slack:'Slack',tools:'Tools',activity:'Activity',
    autoProcess:'Auto-process (3 every 5 min)',syncing:'● Syncing',paused:'⏸ Paused',
    connectGmail:'Connect Gmail',reconnect:'Reconnect',
    syncToBrain:'⚡ Sync to Brain',reIngest:'♻ Re-ingest Archive',
    dropEmail:'Drop email files or',browse:'browse',
    scanOrders:'Scan Orders & Scheduling',
    scanDesc:'Scans Gmail for orders, invoices, scheduling & attachments.',
    pastePlaceholder:'Paste email, notes, transcript, vendor info...',
    processText:'Process Text',importTrello:'Import from Trello',
    slackDesc:'Import Slack export (.zip or .json files) or paste channel content.',
    slackPaste:'Or paste Slack channel content here...',
    processSlack:'Process Slack Content',
    relationships:'Relationships',privacyScan:'Privacy Scan',
    relDesc:'AI links related nodes together.',buildLinks:'Build Links',
    autoLinkImport:'Auto-link on import',
    privDesc:'Find & remove personal data.',scanNodes:'Scan Nodes',
    clear:'Clear',
    // Contractor
    contractorSchedule:'CONTRACTOR SCHEDULE',schedule:'+ Schedule',
    contractor:'Contractor...',service:'Service...',
    // Node panel
    sources:'SOURCES',attachments:'ATTACHMENTS',connectedTo:'CONNECTED TO',
    deleteNode:'Delete Node',showEmail:'Show full email ▼',hideEmail:'Hide email ▲',
    noSources:'No source emails linked.',editNotes:'Edit Notes',save:'Save',cancel:'Cancel',
    addFile:'Add File/Photo',
    // Offline
    noConnection:'No connection — check WiFi',
    // Agenda
    suerte:'SUERTE',este:'ESTE',toti:'TOTI',
    // Category filters
    all:'All',
  },
  es:{
    cleaning:'Limpieza',log:'Registro',board:'Tablero',ingest:'Importar',
    enterPin:'Ingrese su PIN',welcome:'Bienvenido,',invalidPin:'PIN inválido',
    searchNodes:'Buscar nodos...',askNexus:'Pregunta a NEXUS...',
    imNexus:"Soy <b>NEXUS</b> — tu cerebro de operaciones. Pregúntame lo que sea.",
    noNodes:'No hay nodos de conocimiento',getStarted:'Para empezar:',
    tipIngest:'Abre <b>Importar</b> → conecta Gmail o sube archivos',
    tipRemember:'Chat: escribe <b>recuerda [nombre] - [detalles]</b>',
    tipLookup:'Chat: escribe <b>buscar [tema]</b> para buscar en la web',
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
    logTip:'Registra una reparación, observación o nota arriba.',
    logTip2:'Los reportes de limpieza se guardan aquí también.',
    todo:'Por Hacer',inProgress:'En Progreso',done:'Hecho',
    admin:'ADMIN',apiKeys:'Claves API',aiModel:'Modelo IA',voiceLabel:'Voz',
    integrations:'Integraciones',saveKeys:'Guardar Claves',
    teamMembers:'Equipo',keySyncDrive:'Sincronizar (Google Drive)',
    connectDrive:'Conectar Drive',backup:'Respaldar ↑',restore:'Restaurar ↓',
    logOut:'Cerrar Sesión',close:'Cerrar',language:'Idioma',
    name:'Nombre',pin:'PIN',role:'Rol',location:'Ubicación',
    staff:'Personal',manager:'Gerente',chatHistory:'Historial de Chat',
    ingestion:'IMPORTACIÓN',
    email:'Correo',mailMonitor:'Monitor de Correo',pasteText:'Pegar Texto',
    trello:'Trello',slack:'Slack',tools:'Herramientas',activity:'Actividad',
    autoProcess:'Auto-procesar (3 cada 5 min)',syncing:'● Sincronizando',paused:'⏸ Pausado',
    connectGmail:'Conectar Gmail',reconnect:'Reconectar',
    syncToBrain:'⚡ Sincronizar al Cerebro',reIngest:'♻ Re-importar Archivo',
    dropEmail:'Arrastra archivos de correo o',browse:'buscar',
    scanOrders:'Escanear Pedidos y Citas',
    scanDesc:'Escanea Gmail por pedidos, facturas, citas y adjuntos.',
    pastePlaceholder:'Pegar correo, notas, transcripción, info de proveedor...',
    processText:'Procesar Texto',importTrello:'Importar de Trello',
    slackDesc:'Importar exportación de Slack (.zip o .json) o pegar contenido.',
    slackPaste:'O pegar contenido del canal de Slack aquí...',
    processSlack:'Procesar Contenido de Slack',
    relationships:'Relaciones',privacyScan:'Escaneo de Privacidad',
    relDesc:'IA vincula nodos relacionados.',buildLinks:'Construir Vínculos',
    autoLinkImport:'Auto-vincular al importar',
    privDesc:'Encontrar y eliminar datos personales.',scanNodes:'Escanear Nodos',
    clear:'Limpiar',
    contractorSchedule:'CALENDARIO DE CONTRATISTAS',schedule:'+ Agendar',
    contractor:'Contratista...',service:'Servicio...',
    sources:'FUENTES',attachments:'ADJUNTOS',connectedTo:'CONECTADO A',
    deleteNode:'Eliminar Nodo',showEmail:'Ver correo completo ▼',hideEmail:'Ocultar correo ▲',
    noSources:'Sin correos vinculados.',editNotes:'Editar Notas',save:'Guardar',cancel:'Cancelar',
    addFile:'Agregar Archivo/Foto',
    noConnection:'Sin conexión — revisa WiFi',
    suerte:'SUERTE',este:'ESTE',toti:'TOTI',
    all:'Todos',
  }
};

function getLang(){return localStorage.getItem('nexus_lang')||'en';}
function setLang(lang){localStorage.setItem('nexus_lang',lang);applyUI();}
function t(key){return T[getLang()]?.[key]||T.en[key]||key;}

function applyUI(){
  const lang=getLang();

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab=>{
    const v=tab.dataset.view;
    const map={clean:'cleaning',log:'log',board:'board',ingest:'ingest'};
    if(!map[v])return;
    const svg=tab.querySelector('svg')||tab.querySelector('i');
    while(tab.childNodes.length>0)tab.removeChild(tab.lastChild);
    if(svg)tab.appendChild(svg);
    tab.appendChild(document.createTextNode(' '+t(map[v])));
  });

  // PIN screen
  const ps=document.querySelector('.pin-sub');if(ps)ps.textContent=t('enterPin');

  // Brain search + chat
  const bs=document.getElementById('brainSearch');if(bs)bs.placeholder=t('searchNodes');
  const ci=document.getElementById('chatInput');if(ci)ci.placeholder=t('askNexus');
  const hw=document.querySelector('.hud-welcome-text');if(hw)hw.innerHTML=t('imNexus');

  // Empty state
  const cet=document.querySelector('.canvas-empty-text');if(cet)cet.textContent=t('noNodes');
  const ces=document.querySelector('.canvas-empty-sub');if(ces)ces.textContent=t('getStarted');
  const tips=document.querySelectorAll('.empty-tip');
  if(tips.length>=3){tips[0].innerHTML=t('tipIngest');tips[1].innerHTML=t('tipRemember');tips[2].innerHTML=t('tipLookup');}

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

  // Ingest — new card-based UI
  const ih=document.querySelector('.ingest-heading');if(ih)ih.textContent=t('ingestion');
  document.querySelectorAll('.ig-title').forEach(el=>{
    const txt=el.textContent.trim();
    if(txt==='Email'||txt==='Correo')el.textContent=t('email');
    if(txt==='Mail Monitor'||txt==='Monitor de Correo')el.textContent=t('mailMonitor');
    if(txt==='Paste Text'||txt==='Pegar Texto')el.textContent=t('pasteText');
    if(txt==='Trello')el.textContent=t('trello');
    if(txt==='Slack')el.textContent=t('slack');
    if(txt==='Tools'||txt==='Herramientas')el.textContent=t('tools');
    if(txt==='Activity'||txt==='Actividad')el.textContent=t('activity');
  });
  const gcb=document.getElementById('gmailConnectBtn');if(gcb&&gcb.textContent.includes('Connect'))gcb.textContent=t('connectGmail');
  const gsb=document.getElementById('gmailSyncBtn');if(gsb)gsb.textContent=t('syncToBrain');
  const rib=document.getElementById('reIngestBtn');if(rib)rib.textContent=t('reIngest');
  const mmb=document.getElementById('mailMonitorBtn');if(mmb)mmb.textContent=t('scanOrders');
  const itb=document.getElementById('ingestTextBtn');if(itb)itb.textContent=t('processText');
  const trb=document.getElementById('trelloBtn');if(trb)trb.textContent=t('importTrello');
  const spb=document.getElementById('slackProcessBtn');if(spb)spb.textContent=t('processSlack');
  const spt=document.getElementById('slackPasteText');if(spt)spt.placeholder=t('slackPaste');
  const ipt=document.getElementById('ingestText');if(ipt)ipt.placeholder=t('pastePlaceholder');

  // Ingest descriptions
  document.querySelectorAll('.ig-desc').forEach(el=>{
    const txt=el.textContent.trim();
    if(txt.includes('Scans Gmail')||txt.includes('Escanea'))el.textContent=t('scanDesc');
    if(txt.includes('links related')||txt.includes('vincula'))el.textContent=t('relDesc');
    if(txt.includes('remove personal')||txt.includes('eliminar'))el.textContent=t('privDesc');
    if(txt.includes('Slack export')||txt.includes('exportación'))el.textContent=t('slackDesc');
  });

  // Tools
  document.querySelectorAll('.ig-tool-label').forEach(el=>{
    const txt=el.textContent.trim();
    if(txt.includes('Relationship')||txt.includes('Relaciones'))el.textContent='🔗 '+t('relationships');
    if(txt.includes('Privacy')||txt.includes('Privacidad'))el.textContent='🔒 '+t('privacyScan');
  });
  const rlb=document.getElementById('relationshipBtn');if(rlb)rlb.textContent=t('buildLinks');
  const snb=document.getElementById('sensitiveBtn');if(snb)snb.textContent=t('scanNodes');

  // Background processor
  const bgt=document.querySelector('.ig-bg-bar .ig-toggle span');if(bgt)bgt.textContent=t('autoProcess');
  const pb=document.getElementById('pauseBtn');if(pb&&!NX.paused)pb.textContent=t('syncing');
  if(pb&&NX.paused)pb.textContent=t('paused');

  // Agenda labels
  document.querySelectorAll('.agenda-label').forEach(el=>{
    const txt=el.textContent.trim().toUpperCase();
    if(txt==='SUERTE')el.textContent=t('suerte');
    if(txt==='ESTE')el.textContent=t('este');
    if(txt==='TOTI')el.textContent=t('toti');
  });

  // Admin
  document.querySelectorAll('.admin-section-label').forEach(el=>{
    const txt=el.textContent.trim();
    if(txt==='API Keys'||txt==='Claves API')el.textContent=t('apiKeys');
    if(txt==='AI Model'||txt==='Modelo IA')el.textContent=t('aiModel');
    if(txt==='Voice'||txt==='Voz')el.textContent=t('voiceLabel');
    if(txt==='Integrations'||txt==='Integraciones')el.textContent=t('integrations');
    if(txt.includes('Team')||txt.includes('Equipo'))el.textContent=t('teamMembers');
    if(txt.includes('Key Sync')||txt.includes('Sincronizar'))el.textContent=t('keySyncDrive');
    if(txt.includes('Chat History')||txt.includes('Historial'))el.innerHTML=t('chatHistory');
  });
  const ask=document.getElementById('adminSaveKeys');if(ask)ask.textContent=t('saveKeys');
  const alo=document.getElementById('adminLogout');if(alo)alo.textContent=t('logOut');
  const acn=document.getElementById('adminCancel');if(acn)acn.textContent=t('close');

  // Board columns
  document.querySelectorAll('.board-col-title').forEach(el=>{
    const txt=el.textContent.trim().toLowerCase();
    if(txt==='to do'||txt==='por hacer')el.textContent=t('todo');
    if(txt==='in progress'||txt==='en progreso')el.textContent=t('inProgress');
    if(txt==='done'||txt==='hecho')el.textContent=t('done');
  });

  // Contractor
  const ec=document.getElementById('eventContractor');if(ec)ec.placeholder=t('contractor');
  const ed=document.getElementById('eventDesc');if(ed)ed.placeholder=t('service');
  const eab=document.getElementById('eventAddBtn');if(eab)eab.textContent=t('schedule');

  // Lang toggle button
  const ltb=document.getElementById('langToggle');if(ltb)ltb.textContent=lang.toUpperCase();
}

return{t,getLang,setLang,applyUI};
})();
