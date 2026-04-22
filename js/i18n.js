/* NEXUS i18n v4 — data-i18n attribute system
   Usage in HTML:
     data-i18n="key"       → textContent
     data-i18n-html="key"  → innerHTML
     data-i18n-ph="key"    → placeholder
     data-i18n-tip="key"   → data-tip (tooltips)
*/
const NEXUS_I18N=(function(){

const T={
en:{
  // ── PIN SCREEN ──
  enterPin:'Enter your PIN',
  welcome:'Welcome,',
  invalidPin:'Invalid PIN',
  clockIn:'Clock In',
  clockOut:'Clock Out',
  enterNexus:'Enter NEXUS →',
  notClockedIn:'NOT CLOCKED IN',
  clockedIn:'CLOCKED IN',

  // ── NAV ──
  cleaning:'Cleaning',
  log:'Log',
  board:'Board',
  cal:'Cal',
  ingest:'Ingest',

  // ── BRAIN ──
  searchNodes:'Search nodes...',
  askNexus:'Ask NEXUS...',
  nexusWelcome:"I'm <b>NEXUS</b>. Ask me anything.",
  noNodes:'No knowledge nodes yet',
  getStarted:'Get started:',
  tipIngest:'Open <b>Ingest</b> → connect Gmail or drop email files',
  tipRemember:'Chat: type <b>remember [name] - [details]</b> to add knowledge',
  tipLookup:'Chat: type <b>look up [topic]</b> to search the web',
  shared:'Shared',
  myBrain:'My Brain',
  all:'All',
  sortAZ:'A–Z',
  mostUsed:'Most Used',
  recent:'Recent',
  contractorSchedule:'CONTRACTOR SCHEDULE',
  contractor:'Contractor...',
  service:'Service...',
  schedule:'+ Schedule',
  editNotes:'✏ Edit Notes',
  addFilePhoto:'📎 Add File / Photo',
  noConnection:'No connection — check WiFi',

  // ── CLEANING ──
  shiftProgress:'SHIFT PROGRESS',
  submitReport:'Submit Daily Report',
  submitting:'Submitting...',
  submitted:'✓ Submitted',
  taskEs:'Tarea en español...',
  taskEn:'Task in English...',
  addTask:'+ Add',

  // ── LOG ──
  logPlaceholder:'Log a repair, observation, or note...',
  knowledgePlaceholder:'Add knowledge to the brain...',
  addBrain:'+ Brain',
  timeClock:'⏱ Time Clock',
  allTeam:'All Team',
  days7:'7 days',
  days14:'14 days',
  days30:'30 days',
  allTime:'All time',

  // ── CALENDAR ──
  today:'Today',
  sun:'Sun',mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',

  // ── BOARD ──
  todo:'To Do',
  inProgress:'In Progress',
  done:'Done',

  // ── INGEST STATS ──
  pending:'PENDING',
  knowledge:'KNOWLEDGE',
  archived:'ARCHIVED',
  tipPending:'Emails waiting for AI to read and extract knowledge from',
  tipKnowledge:'Total nodes in your brain — equipment, vendors, contractors, parts, procedures',
  tipArchived:'Total emails downloaded from Gmail and stored for processing',

  // ── PROCESSOR ──
  processor:'Processor',
  auto:'Auto',
  mode:'MODE',
  tipMode:'Process Queue: work through pending items. Pull+Process: fetch new Gmail then process. Re-scan: reset all and reprocess with current AI.',
  processQueue:'Process Queue',
  pullProcess:'Pull + Process',
  rescanAll:'Re-scan All',
  batch:'BATCH',
  tipBatch:'How many emails to process per cycle. Higher = faster but uses more API tokens.',
  every:'EVERY',
  tipEvery:'Time between processing cycles. 1m is aggressive, 10m is gentle on API usage.',
  extract:'EXTRACT',
  tipExtract:'PDFs: read PDF text. Images: use Vision AI to read photos/receipts. Parts: extract part numbers and vendors. Links: auto-connect related nodes.',
  runBatchNow:'▶ Run Batch Now',
  syncing:'● Syncing',
  paused:'⏸ Paused',

  // ── EMAIL & DOCS ──
  emailDocs:'Email & Documents',
  notConnected:'Not connected',
  connectGmail:'Connect Gmail',
  reconnect:'Reconnect',
  syncToBrain:'⚡ Sync to Brain',
  reIngest:'↻ Re-ingest',
  dropFiles:'Drop files or',
  browse:'browse',
  pasteText:'Paste Text',
  pastePlaceholder:'Paste email, notes, transcript, vendor info…',
  processText:'Process Text',

  // ── TOOLS ──
  toolsBackup:'Tools & Backup',
  buildLinks:'🔗 Build Links',
  privacyScan:'🔒 Privacy Scan',
  exportBackup:'⬇ Export Backup',
  importBackup:'⬆ Import Backup',
  autoLink:'Auto-link on import',
  activity:'Activity',
  clear:'Clear',

  // ── ADMIN ──
  admin:'ADMIN',
  apiKeys:'API Keys',
  aiModel:'AI Model',
  voice:'Voice',
  integrations:'Integrations',
  saveKeys:'Save Keys',
  keySyncDrive:'Key Sync (Google Drive)',
  connectDrive:'Connect Drive',
  backup:'Backup ↑',
  restore:'Restore ↓',
  teamMembers:'Team Members',
  name:'Name',
  pin:'PIN',
  role:'Role',
  location:'Location',
  staff:'Staff',
  manager:'Manager',
  chatHistory:'Chat History',
  refresh:'Refresh',
  clearAll:'Clear All',
  exportAllData:'⬇ Export All Data',
  nodesOnly:'⬇ Nodes Only',
  logOut:'Log Out',
  close:'Close',

  // ── SOURCES (node panel) ──
  sources:'SOURCES',
  showEmail:'Show email',
  hideEmail:'Hide email',
  connectedTo:'CONNECTED TO',
  mentionedIn:'MENTIONED IN',
  relatedDetails:'RELATED DETAILS',
},
es:{
  // ── PIN ──
  enterPin:'Ingrese su PIN',
  welcome:'Bienvenido,',
  invalidPin:'PIN inválido',
  clockIn:'Registrar Entrada',
  clockOut:'Registrar Salida',
  enterNexus:'Entrar a NEXUS →',
  notClockedIn:'SIN REGISTRAR',
  clockedIn:'REGISTRADO',

  // ── NAV ──
  cleaning:'Limpieza',
  log:'Registro',
  board:'Tablero',
  cal:'Cal',
  ingest:'Ingesta',

  // ── BRAIN ──
  searchNodes:'Buscar nodos...',
  askNexus:'Pregunta a NEXUS...',
  nexusWelcome:"Soy <b>NEXUS</b>. Pregúntame lo que sea.",
  noNodes:'No hay nodos de conocimiento',
  getStarted:'Comienza:',
  tipIngest:'Abre <b>Ingesta</b> → conecta Gmail o arrastra archivos',
  tipRemember:'Chat: escribe <b>remember [nombre] - [detalles]</b> para agregar',
  tipLookup:'Chat: escribe <b>look up [tema]</b> para buscar en la web',
  shared:'Compartido',
  myBrain:'Mi Cerebro',
  all:'Todo',
  sortAZ:'A–Z',
  mostUsed:'Más Usado',
  recent:'Reciente',
  contractorSchedule:'AGENDA DE CONTRATISTAS',
  contractor:'Contratista...',
  service:'Servicio...',
  schedule:'+ Agendar',
  editNotes:'✏ Editar Notas',
  addFilePhoto:'📎 Agregar Archivo / Foto',
  noConnection:'Sin conexión — revisa WiFi',

  // ── CLEANING ──
  shiftProgress:'PROGRESO DEL TURNO',
  submitReport:'Enviar Reporte Diario',
  submitting:'Enviando...',
  submitted:'✓ Enviado',
  taskEs:'Tarea en español...',
  taskEn:'Tarea en inglés...',
  addTask:'+ Agregar',

  // ── LOG ──
  logPlaceholder:'Registrar reparación, observación o nota...',
  knowledgePlaceholder:'Agregar conocimiento al cerebro...',
  addBrain:'+ Cerebro',
  timeClock:'⏱ Reloj de Tiempo',
  allTeam:'Todo el Equipo',
  days7:'7 días',
  days14:'14 días',
  days30:'30 días',
  allTime:'Todo',

  // ── CALENDAR ──
  today:'Hoy',
  sun:'Dom',mon:'Lun',tue:'Mar',wed:'Mié',thu:'Jue',fri:'Vie',sat:'Sáb',

  // ── BOARD ──
  todo:'Por Hacer',
  inProgress:'En Progreso',
  done:'Hecho',

  // ── INGEST STATS ──
  pending:'PENDIENTE',
  knowledge:'CONOCIMIENTO',
  archived:'ARCHIVADO',
  tipPending:'Correos esperando que la IA los lea y extraiga conocimiento',
  tipKnowledge:'Total de nodos en tu cerebro — equipo, proveedores, contratistas, partes, procedimientos',
  tipArchived:'Total de correos descargados de Gmail y almacenados para procesar',

  // ── PROCESSOR ──
  processor:'Procesador',
  auto:'Auto',
  mode:'MODO',
  tipMode:'Procesar Cola: trabaja los pendientes. Jalar+Procesar: busca nuevos Gmail y procesa. Re-escanear: reinicia todo y reprocesa con IA actual.',
  processQueue:'Procesar Cola',
  pullProcess:'Jalar + Procesar',
  rescanAll:'Re-escanear Todo',
  batch:'LOTE',
  tipBatch:'Cuántos correos procesar por ciclo. Mayor = más rápido pero usa más tokens de API.',
  every:'CADA',
  tipEvery:'Tiempo entre ciclos de procesamiento. 1m es agresivo, 10m es gentil con el uso de API.',
  extract:'EXTRAER',
  tipExtract:'PDFs: leer texto PDF. Imágenes: usar Vision AI para leer fotos/recibos. Partes: extraer números de parte y proveedores. Links: auto-conectar nodos relacionados.',
  runBatchNow:'▶ Ejecutar Ahora',
  syncing:'● Sincronizando',
  paused:'⏸ Pausado',

  // ── EMAIL & DOCS ──
  emailDocs:'Correo y Documentos',
  notConnected:'No conectado',
  connectGmail:'Conectar Gmail',
  reconnect:'Reconectar',
  syncToBrain:'⚡ Sincronizar al Cerebro',
  reIngest:'↻ Re-ingestar',
  dropFiles:'Arrastra archivos o',
  browse:'buscar',
  pasteText:'Pegar Texto',
  pastePlaceholder:'Pega correo, notas, transcripción, info de proveedor…',
  processText:'Procesar Texto',

  // ── TOOLS ──
  toolsBackup:'Herramientas y Respaldo',
  buildLinks:'🔗 Crear Enlaces',
  privacyScan:'🔒 Escaneo de Privacidad',
  exportBackup:'⬇ Exportar Respaldo',
  importBackup:'⬆ Importar Respaldo',
  autoLink:'Auto-enlazar al importar',
  activity:'Actividad',
  clear:'Limpiar',

  // ── ADMIN ──
  admin:'ADMIN',
  apiKeys:'Claves API',
  aiModel:'Modelo IA',
  voice:'Voz',
  integrations:'Integraciones',
  saveKeys:'Guardar Claves',
  keySyncDrive:'Sincronizar Claves (Google Drive)',
  connectDrive:'Conectar Drive',
  backup:'Respaldo ↑',
  restore:'Restaurar ↓',
  teamMembers:'Equipo',
  name:'Nombre',
  pin:'PIN',
  role:'Rol',
  location:'Ubicación',
  staff:'Personal',
  manager:'Gerente',
  chatHistory:'Historial de Chat',
  refresh:'Actualizar',
  clearAll:'Borrar Todo',
  exportAllData:'⬇ Exportar Todo',
  nodesOnly:'⬇ Solo Nodos',
  logOut:'Cerrar Sesión',
  close:'Cerrar',

  // ── SOURCES ──
  sources:'FUENTES',
  showEmail:'Ver correo',
  hideEmail:'Ocultar correo',
  connectedTo:'CONECTADO A',
  mentionedIn:'MENCIONADO EN',
  relatedDetails:'DETALLES RELACIONADOS',
}
};

let lang=localStorage.getItem('nexus_lang')||'en';

function getLang(){return lang;}

function setLang(newLang){
  lang=newLang;
  localStorage.setItem('nexus_lang',newLang);
  applyUI();
}

function t(key){return T[lang]?.[key]||T.en[key]||key;}

function applyUI(){
  // Text content
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key=el.dataset.i18n;
    const val=t(key);
    if(val)el.textContent=val;
  });
  // innerHTML (for bold text etc)
  document.querySelectorAll('[data-i18n-html]').forEach(el=>{
    const key=el.dataset.i18nHtml;
    const val=t(key);
    if(val)el.innerHTML=val;
  });
  // Placeholders
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>{
    const key=el.dataset.i18nPh;
    const val=t(key);
    if(val)el.placeholder=val;
  });
  // Tooltips (data-tip attribute)
  document.querySelectorAll('[data-i18n-tip]').forEach(el=>{
    const key=el.dataset.i18nTip;
    const val=t(key);
    if(val)el.dataset.tip=val;
  });
  // Language toggle button
  const ltb=document.getElementById('langToggle');
  if(ltb)ltb.textContent=lang.toUpperCase();
}

return{t,getLang,setLang,applyUI};
})();
