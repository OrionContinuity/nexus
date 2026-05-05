/* NEXUS Cleaning v11 — persistent state, 8AM rollover, who-did-what tracking */
(function(){

/* ─── Inline SVG icons ────────────────────────────────────────────
   The cleaning module shows check/uncheck state across hundreds of
   line items per shift. Previously rendered with `✓` / `○` glyphs
   which fall back to the user's emoji font on iOS (looks blocky)
   and a plain Times-italic ring on Android. SVG line art renders
   identically everywhere and inherits gold/text color via
   currentColor — section headers can use the gold version, item
   rows use the text version.                                    */
const CLEAN_ICONS = {
  check:  '<polyline points="20 6 9 17 4 12"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  close:  '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  pen:    '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
};
function csvg(key, size = '14px', stroke = '2') {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex-shrink:0">${CLEAN_ICONS[key] || ''}</svg>`;
}

let loc='suerte';
const stateCache={}; // Per-location state cache
const lastDone={};
// linkedCards[location+'__'+section] = card.id — populated by loadLinkedCards.
// Tracks open (non-archived) board cards that escalated from a cleaning
// section, so the section header can show "→ On board" instead of
// "→ Add to board" and prevent duplicate escalations.
const linkedCards={};
const NON_DAILY=['Bi-Semanal','Mensual','Semanal','Quincenal','Trimestral','Jardín','Jardin','Garden'];

// Cleaning date: before 8 AM = still yesterday's shift
function getCleaningDate(){
  const now=new Date();
  if(now.getHours()<8){now.setDate(now.getDate()-1);}
  // Use LOCAL date, not UTC (toISOString gives UTC which shifts the day)
  const y=now.getFullYear();
  const m=String(now.getMonth()+1).padStart(2,'0');
  const d=String(now.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+d;
}
let today=getCleaningDate();

const FREQUENCY={
  'Bi-Semanal':14,'Mensual':30,'Semanal':7,'Quincenal':15,
  'Trimestral':90,'Jardín':7,'Jardin':7,'Garden':7
};
function getFrequency(secName){
  for(const[k,v]of Object.entries(FREQUENCY)){if(secName.toLowerCase().includes(k.toLowerCase()))return v;}
  return 30;
}
function daysBetween(d1,d2){return Math.floor((new Date(d2)-new Date(d1))/(1000*60*60*24));}
function daysAgoText(days){
  if(days===0)return'Today';if(days===1)return'Yesterday';
  if(days<7)return days+'d ago';if(days<30)return Math.floor(days/7)+'w ago';
  return Math.floor(days/30)+'mo ago';
}
function getUserName(){return NX.currentUser?NX.currentUser.name:'Unknown';}

// Default checklist data
const DEFAULTS={suerte:[
  {sec:'Comedor',items:[['Barrer el piso.','Sweep Floors.'],['Trapear el piso.','Mop Floor.'],['Inspeccionar ventanas y repisas.','Inspect windows/ledges.'],['Limpiar las mesas.','Wipe Tables.'],['Limpiar todas las repisas.','Wipe Ledges.'],['Trapear área de la Barra.','Mop Bar.']]},
  {sec:'Baños',items:[['Limpiar Inodoro.','Clean Toilet.'],['Limpiar superficies metálicas.','Polish metal.'],['Barrer el piso.','Sweep.'],['Limpiar cristales y espejos.','Glass/Mirror.'],['Limpiar mostradores y lavabos.','Sink/Basin.'],['Limpiar azulejos detrás de inodoros.','Tile Behind Toilets.'],['Limpiar entrada y manijas.','Entrance/Handles.'],['Trapear el piso.','Mop.'],['Sanitizar cambiadores.','Sanitize changing tables.']]},
  {sec:'Exterior',items:[['Recoger basura en pasillos y estacionamiento.','Pickup trash walkways/lot.'],['Soplar aceras y áreas de comedor.','Blow outdoor dining.']]},
  {sec:'Cocina',items:[['Limpiar y pulir las 3 parrillas.','Clean 3 grills.'],['Limpiar atrás de parrilla.','Behind Grill.'],['Trapear piso.','Mop.'],['Limpiar rejilla de ventilación.','Hood vent.'],['Superficies metálicas.','Metal surfaces.'],['Cestas de drenaje.','Drain Baskets.'],['Paneles de madera.','Wood Panels.']]},
  {sec:'Bi-Semanal',items:[['Paneles de madera del salón.','Wood paneling lounge.'],['Paneles del bar.','Wood paneling bar.'],['Paneles enfrente de cocina.','Chefs counter.'],['Rieles para pies.','Foot rails.'],['Polvo de textiles.','Textile frames.'],['Ventanas del patio.','Patio windows.']]},
  {sec:'Mensual',items:[['Placas de rodadura y puertas.','Kickplates/Doors.'],['Ventilaciones.','Vents.'],['Polvo de luces.','Dust lights.'],['Marcas de trapeador.','Mop marks walls.'],['Telarañas.','Cobwebs.'],['Zócalos.','Baseboards.']]},
  {sec:'Jardín',items:[['Soplar hojas.','Blow leaves.'],['Limpiar Basurero.','Clean garbage.'],['Inspeccionar plantas.','Inspect plants.'],['Organizar bodega.','Organize Shed.']]}
],este:[
  {sec:'Comedor',items:[['Barrer el piso.','Sweep.'],['Trapear el piso.','Mop.'],['Inspeccionar ventanas.','Inspect windows.'],['Limpiar mesas.','Wipe Tables.'],['Limpiar repisas.','Wipe Ledges.'],['Trapear Barra.','Mop Bar.']]},
  {sec:'Baños',items:[['Limpiar Inodoro.','Toilet.'],['Superficies metálicas.','Metal.'],['Barrer.','Sweep.'],['Cristales y espejos.','Glass/Mirror.'],['Mostradores.','Sink.'],['Azulejos.','Tile.'],['Entrada del baño.','Entrance.'],['Trapear.','Mop.'],['Sanitizar cambiadores.','Changing tables.']]},
  {sec:'Exterior',items:[['Soplar áreas de comedor.','Blow outdoor dining.']]},
  {sec:'Cocina',items:[['Limpiar 2 parrillas.','2 grills.'],['Atrás de parrilla.','Behind Grill.'],['Trapear.','Mop.'],['Ventilación.','Hood vent.'],['Superficies metálicas.','Metal.'],['Cestas de drenaje.','Drain Baskets.']]},
  {sec:'Jardín',items:[['Soplar hojas.','Blow leaves.'],['Limpiar Basurero.','Garbage.'],['Inspeccionar plantas.','Inspect plants.']]}
],toti:[
  {sec:'Comedor',items:[['Barrer.','Sweep.'],['Trapear.','Mop.'],['Inspeccionar ventanas.','Windows.'],['Limpiar mesas.','Tables.'],['Limpiar repisas.','Ledges.']]},
  {sec:'Baños',items:[['Inodoro.','Toilet.'],['Superficies metálicas.','Metal.'],['Barrer.','Sweep.'],['Cristales y espejos.','Glass/Mirror.'],['Mostradores.','Sink.'],['Azulejos.','Tile.'],['Trapear.','Mop.']]},
  {sec:'Cocina',items:[['Parrillas.','Grills.'],['Atrás de parrilla.','Behind Grill.'],['Trapear.','Mop.'],['Superficies metálicas.','Metal.'],['Cestas de drenaje.','Drain Baskets.']]},
  {sec:'Jardín',items:[['Soplar hojas.','Blow leaves.'],['Limpiar Basurero.','Garbage.']]}
]};

// Custom tasks from localStorage (AI-added)
function getCustomTasks(){
  try{return JSON.parse(localStorage.getItem('nexus_custom_tasks')||'{}');}catch(e){return{};}
}
function saveCustomTasks(ct){localStorage.setItem('nexus_custom_tasks',JSON.stringify(ct));}

// Merge defaults + custom tasks (marks custom items)
function getData(location){
  const base=JSON.parse(JSON.stringify(DEFAULTS[location]||[]));
  // Mark all default items
  base.forEach(sec=>sec.items.forEach(item=>{item.push(false);})); // [es, en, isCustom]
  const custom=getCustomTasks()[location]||[];
  custom.forEach((ct,ci)=>{
    let sec=base.find(s=>s.sec===ct.section);
    if(!sec){sec={sec:ct.section,items:[]};base.push(sec);}
    sec.items.push([ct.es,ct.en,true,ci]); // [es, en, isCustom, customIndex]
  });
  return base;
}

// Add a custom task (called from AI chat)
function addTask(location,section,es,en){
  const ct=getCustomTasks();
  if(!ct[location])ct[location]=[];
  ct[location].push({section,es,en,added:new Date().toISOString()});
  saveCustomTasks(ct);
  if(loc===location)render();
  return true;
}

// Remove a custom task by matching text
function removeTask(location,text){
  const ct=getCustomTasks();
  if(!ct[location])return false;
  const before=ct[location].length;
  ct[location]=ct[location].filter(t=>
    !t.es.toLowerCase().includes(text.toLowerCase())&&
    !t.en.toLowerCase().includes(text.toLowerCase())
  );
  if(ct[location].length===before)return false;
  saveCustomTasks(ct);
  if(loc===location)render();
  return true;
}

async function init(){
  document.getElementById('cleanDate').textContent=today;
  document.querySelectorAll('.clean-tab').forEach(t=>{
    t.addEventListener('click',async()=>{
      document.querySelectorAll('.clean-tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');loc=t.dataset.cloc;
      try{await loadToday();}catch(e){}
      try{await loadHistory();}catch(e){}
      try{await loadLinkedCards();}catch(e){}
      populateSections();render();
    });
  });
  document.getElementById('cleanSubmit').addEventListener('click',submitDailyReport);
  const ab=document.getElementById('cleanAddBtn');if(ab)ab.addEventListener('click',addTaskUI);
  try{await loadToday();}catch(e){}
  try{await loadHistory();}catch(e){}
      try{await loadLinkedCards();}catch(e){}
  populateSections();render();
}

async function show(){
  // Check if editing a previous report
  if(NX.editingReport){
    today=NX.editingReport.date;
    // Show edit banner
    let banner=document.getElementById('cleanEditBanner');
    if(!banner){
      banner=document.createElement('div');banner.id='cleanEditBanner';
      banner.className='clean-edit-banner';
      const wrap=document.getElementById('cleanView');
      if(wrap)wrap.insertBefore(banner,wrap.firstChild);
    }
    banner.innerHTML=`<span>${csvg("pen","13px")} Editing report for <b>${today}</b></span><button id="cancelEditClean" class="clean-edit-cancel">✕ Cancel</button>`;
    banner.style.display='flex';
    document.getElementById('cancelEditClean')?.addEventListener('click',()=>{
      NX.editingReport=null;today=getCleaningDate();
      banner.style.display='none';
      show();
    });
  }else{
    today=getCleaningDate();
    const banner=document.getElementById('cleanEditBanner');
    if(banner)banner.style.display='none';
  }
  // Clear cached state for reload
  stateCache[loc]={};
  try{await loadToday();}catch(e){}
  try{await loadHistory();}catch(e){}
      try{await loadLinkedCards();}catch(e){}
  populateSections();render();
  // Update submit button text for edit mode
  const submitBtn=document.getElementById('cleanSubmit');
  if(submitBtn)submitBtn.textContent=NX.editingReport?'Update Report':'Submit Daily Report';
}

async function loadToday(){
  if(!stateCache[loc])stateCache[loc]={};
  if(!NX.sb||NX.paused)return;
  const{data}=await NX.sb.from('cleaning_logs').select('section,task_index,done').eq('log_date',today).eq('location',loc);
  if(data)data.forEach(c=>{stateCache[loc][loc+'_'+c.section+'_'+c.task_index]={done:c.done,by:''};});
}

function getState(key){try{return stateCache[loc]?.[key]?.done||false;}catch(e){return false;}}
function getStateBy(key){return'';}
function setState(key,done){
  if(!stateCache[loc])stateCache[loc]={};
  stateCache[loc][key]={done,by:done?getUserName():''};
}

async function loadHistory(){
  lastDone={};
  if(!NX.sb||NX.paused)return;
  const{data}=await NX.sb.from('cleaning_logs').select('section,task_index,log_date')
    .eq('location',loc).eq('done',true).order('log_date',{ascending:false}).limit(500);
  if(data){data.forEach(r=>{
    const key=r.section+'_'+r.task_index;
    if(!lastDone[key])lastDone[key]={date:r.log_date};
  });}
}

// ═══ CLEANING ↔ BOARD LINKAGE ════════════════════════════════════════
// Loads the set of OPEN (non-archived, not Done) board cards that were
// escalated from a cleaning section at the current location. Keyed by
// "location__section" so the section header can display:
//   → "On board" (link exists) — tap to jump to the card
//   → "Add to board" (no link) — tap to escalate
// Called at init/show + after escalating a new card.
async function loadLinkedCards(){
  Object.keys(linkedCards).forEach(k=>delete linkedCards[k]);
  if(!NX.sb||NX.paused)return;
  try{
    // We pull cards for this location only. board.js's "Done" detection
    // is column-name based (any list named done/closed/resolved/etc),
    // so we filter that out client-side after fetch.
    const{data}=await NX.sb.from('kanban_cards')
      .select('id,cleaning_link_location,cleaning_link_section,column_name,list_id,archived')
      .eq('cleaning_link_location',loc)
      .eq('archived',false);
    if(!data) return;
    data.forEach(c=>{
      const cn=(c.column_name||'').toLowerCase();
      if(/(done|closed|resolved|complete|archived?)/.test(cn)) return;
      if(c.cleaning_link_section){
        linkedCards[loc+'__'+c.cleaning_link_section]=c.id;
      }
    });
  }catch(e){
    console.warn('[cleaning] loadLinkedCards:',e);
  }
}

// Pick the first non-archived board + a list named report/todo/triage
// (or first list if none match). Same pattern as brain-chat.js — chat
// and cleaning both create cards without a board context, so they need
// to resolve one. Returns null if nothing found.
async function resolveBoardAndList(){
  try{
    const{data:bs}=await NX.sb.from('boards')
      .select('id').eq('archived',false).order('position').limit(1);
    if(!bs?.length)return null;
    const boardId=bs[0].id;
    const{data:ls}=await NX.sb.from('board_lists')
      .select('*').eq('board_id',boardId).order('position');
    const target=(ls||[]).find(l=>/report|todo|triage/i.test(l.name))||(ls||[])[0];
    if(!target)return null;
    return{boardId,listId:target.id};
  }catch(e){
    console.warn('[cleaning] resolveBoardAndList:',e);
    return null;
  }
}

// Escalate an overdue cleaning section to a board card. The card
// remembers (cleaning_link_location, cleaning_link_section) so when
// it's later marked Done in board.js, that move writes completion
// records to cleaning_logs for every task in this section — clearing
// the OVERDUE pill on this view. The card itself stays around with
// its photos/comments/cost as the system-of-record for the work.
async function escalateSectionToBoard(section){
  const sec=getData(loc).find(s=>s.sec===section);
  if(!sec){NX.toast&&NX.toast('Section not found','error');return;}
  // Don't double-escalate. Cheap re-check before write.
  if(linkedCards[loc+'__'+section]){
    NX.toast&&NX.toast('Already on the board','info');
    return;
  }
  const target=await resolveBoardAndList();
  if(!target){
    NX.toast&&NX.toast('No board found — open Board view first','warn');
    return;
  }
  // Compute due-date proposal: today if overdue, otherwise the day it
  // hits the frequency cliff. Manager can edit on the board.
  const freq=getFrequency(section);
  let oldestDays=null;
  sec.items.forEach((_,i)=>{
    const hist=lastDone[section+'_'+i];
    if(hist){const d=daysBetween(hist.date,today);if(oldestDays===null||d>oldestDays)oldestDays=d;}
    else oldestDays=999;
  });
  const isOverdue=(oldestDays==null||oldestDays>=freq);
  const dueDate=isOverdue?today
    :new Date(Date.now()+(freq-oldestDays)*86400000).toISOString().slice(0,10);
  // Description = bilingual checklist of the items in this section.
  // Gives the contractor a complete picture of what to do.
  const lang=NX.i18n?NX.i18n.getLang():'en';
  const itemLines=sec.items.map(it=>{
    const primary=lang==='es'?it[0]:it[1];
    const secondary=lang==='es'?it[1]:it[0];
    return`• ${primary} (${secondary})`;
  }).join('\n');
  const locTitle=loc.charAt(0).toUpperCase()+loc.slice(1);
  const cardRow={
    title:`${section} – ${locTitle}`,
    description:`Cleaning section escalated to board.\nFrequency: every ${freq} days.\nLast done: ${oldestDays===999?'never':daysAgoText(oldestDays)}.\n\nItems to complete:\n${itemLines}`,
    board_id:target.boardId,
    list_id:target.listId,
    column_name:'',
    position:999,
    priority:isOverdue?'high':'normal',
    location:loc,
    due_date:dueDate,
    cleaning_link_location:loc,
    cleaning_link_section:section,
    reported_by:NX.currentUser?.name||null,
    checklist:[], comments:[], labels:[], photo_urls:[],
    archived:false,
  };
  try{
    const{data:created,error}=await NX.sb.from('kanban_cards').insert(cardRow).select().single();
    if(error)throw error;
    linkedCards[loc+'__'+section]=created.id;
    if(NX.notifyCardCreated)NX.notifyCardCreated(created);
    NX.toast&&NX.toast(`${section} → on the board`,'success');
    render();
  }catch(e){
    console.error('[cleaning] escalateSection:',e);
    NX.toast&&NX.toast('Could not add to board','error');
  }
}

function populateSections(){
  const sel=document.getElementById('cleanTaskSec');if(!sel)return;
  sel.innerHTML='';
  getData(loc).forEach(s=>{const o=document.createElement('option');o.value=s.sec;o.textContent=s.sec;sel.appendChild(o);});
  const no=document.createElement('option');no.value='__new__';no.textContent='+ New Section';sel.appendChild(no);
}

function addTaskUI(){
  const es=document.getElementById('cleanTaskEs').value.trim();
  const en=document.getElementById('cleanTaskEn').value.trim();
  let sec=document.getElementById('cleanTaskSec').value;
  if(!es&&!en)return;
  if(sec==='__new__'){
    if(NX.composer?.modal){
      NX.composer.modal({
        title:'New section',
        subtitle:'Group cleaning tasks under a new heading',
        placeholder:'e.g. Patio, Storage, Walk-in',
        buttonLabel:'Create section',
        onSubmit:async(name)=>{
          if(!name)throw new Error('empty');
          addTask(loc,name,es||en,en||es);
          document.getElementById('cleanTaskEs').value='';
          document.getElementById('cleanTaskEn').value='';
          populateSections();
        },
      });
      return;
    }
    sec=prompt('Section name:');
    if(!sec)return;
  }
  addTask(loc,sec,es||en,en||es);
  document.getElementById('cleanTaskEs').value='';
  document.getElementById('cleanTaskEn').value='';
  populateSections();
}

function render(){
  const list=document.getElementById('cleanList');list.innerHTML='';
  const secs=getData(loc);
  const lang=NX.i18n?NX.i18n.getLang():'en';
  let dailyTotal=0,dailyDone=0;

  secs.forEach((sec,si)=>{
    const isDaily=!NON_DAILY.some(nd=>sec.sec.toLowerCase().includes(nd.toLowerCase()));
    let sectionDone=0;
    sec.items.forEach((_,i)=>{if(getState(loc+'_'+sec.sec+'_'+i))sectionDone++;});
    const isComplete=sectionDone===sec.items.length&&sec.items.length>0;

    // For non-daily sections: calculate status
    let secStatus='';
    let needsBoard=false;  // true → render "→ Add to board" pill
    let onBoard=false;     // true → render "→ On board" pill (link exists)
    if(!isDaily){
      const freq=getFrequency(sec.sec);
      // Find oldest "last done" among this section's tasks
      let oldestDays=null;
      sec.items.forEach((_,i)=>{
        const hist=lastDone[sec.sec+'_'+i];
        if(hist){const d=daysBetween(hist.date,today);if(oldestDays===null||d>oldestDays)oldestDays=d;}
        else oldestDays=999;
      });
      if(oldestDays===null||oldestDays===999){secStatus='<span class="clean-overdue">Never done</span>';needsBoard=true;}
      else if(oldestDays>freq){secStatus=`<span class="clean-overdue">OVERDUE ${oldestDays-freq}d</span>`;needsBoard=true;}
      else if(oldestDays>freq*0.8){secStatus=`<span class="clean-due-soon">Due soon · ${daysAgoText(oldestDays)}</span>`;needsBoard=true;}
      else{secStatus=`<span class="clean-on-track">${csvg("check","12px","2.25")} ${daysAgoText(oldestDays)} · every ${freq}d</span>`;}
      // If a linked card already exists, show "On board" instead of
      // "Add to board" (and the cleanup completes via that card).
      if(linkedCards[loc+'__'+sec.sec]){onBoard=true;needsBoard=false;}
    }

    const el=document.createElement('div');
    el.className='clean-sec'+(si>3?' collapsed':'')+(isComplete?' complete':'');
    const h=document.createElement('div');h.className='clean-sec-head';
    h.innerHTML=`<span class="clean-sec-check">${isComplete?csvg('check','13px','2.25'):csvg('circle','13px','1.75')}</span><span class="clean-sec-arrow">▼</span><span class="clean-sec-title">${sec.sec}</span>${secStatus}<span class="clean-sec-count">${sectionDone}/${sec.items.length}</span>`;

    // Check All button
    const caBtn=document.createElement('button');caBtn.className='clean-check-all';
    caBtn.innerHTML=isComplete?'Undo':('All '+csvg('check','12px','2.25'));
    caBtn.addEventListener('click',async(e)=>{
      e.stopPropagation();const newState=!isComplete;
      sec.items.forEach((_,i)=>{
        const k=loc+'_'+sec.sec+'_'+i;setState(k,newState);
      });
      render();
      // Save all to DB with await
      for(let i=0;i<sec.items.length;i++){
        try{await NX.sb.from('cleaning_logs').upsert({location:loc,log_date:today,task_index:i,section:sec.sec,done:newState,completed_at:newState?new Date().toISOString():null},{onConflict:'location,log_date,task_index,section'});}catch(e){console.error('Cleaning save error:',e);}
      }
    });

    h.appendChild(caBtn);

    // Cleaning ↔ Board linkage badge — appears on non-daily sections
    // that are overdue / due soon / never done. Clicking either:
    //   • escalates the section to a new board card, or
    //   • jumps to the existing linked card on the board
    // The badge is excluded from the collapse-toggle handler below.
    let linkBtn=null;
    if(needsBoard||onBoard){
      linkBtn=document.createElement('button');
      linkBtn.className='clean-link-board'+(onBoard?' is-on-board':'');
      linkBtn.textContent=onBoard?'→ On board':'→ Add to board';
      linkBtn.title=onBoard?'Tap to open the linked board card':'Add this section to the board for tracking';
      linkBtn.addEventListener('click',async(e)=>{
        e.stopPropagation();
        if(onBoard){
          // Jump to the board view; the user's already-linked card is there.
          if(NX.switchTo)NX.switchTo('board');
          return;
        }
        await escalateSectionToBoard(sec.sec);
      });
      h.appendChild(linkBtn);
    }

    h.addEventListener('click',(e)=>{
      if(e.target===caBtn)return;
      if(linkBtn&&e.target===linkBtn)return;
      el.classList.toggle('collapsed');
    });
    el.appendChild(h);

    const body=document.createElement('div');body.className='clean-sec-body';
    sec.items.forEach((item,i)=>{
      // PERCENTAGE: only count daily tasks
      if(isDaily)dailyTotal++;
      const k=loc+'_'+sec.sec+'_'+i;
      const d=getState(k);
      if(d&&isDaily)dailyDone++;

      const it=document.createElement('div');it.className='clean-item'+(d?' done':'')+(item[2]?' clean-item-custom':'');
      let lastInfo='';
      if(!isDaily){
        const hist=lastDone[sec.sec+'_'+i];
        if(hist){const daysAgo=daysBetween(hist.date,today);lastInfo=`<div class="ci-last">Last: ${daysAgoText(daysAgo)}</div>`;}
        else{lastInfo='<div class="ci-last ci-never">Never done</div>';}
      }
      it.innerHTML=`<div class=\"ci-box\">${d?csvg('check','12px','2.25'):''}</div><div><div class="ci-primary">${lang==='es'?item[0]:item[1]}</div><div class="ci-secondary">${lang==='es'?item[1]:item[0]}</div>${lastInfo}</div>`;
      // Delete button for custom tasks
      if(item[2]){
        const del=document.createElement('button');del.className='clean-item-del';del.innerHTML=csvg('close','12px','2');
        del.addEventListener('click',(e)=>{
          e.stopPropagation();
          const ct=getCustomTasks();
          if(ct[loc]){ct[loc].splice(item[3],1);saveCustomTasks(ct);render();}
        });
        it.appendChild(del);
      }
      it.onclick=async()=>{
        const newVal=!getState(k);setState(k,newVal);render();
        if(NX.syslog)NX.syslog('clean_'+(newVal?'checked':'unchecked'),item[1]+' ('+loc+'/'+sec.sec+')');
        const upsertData={location:loc,log_date:today,task_index:i,section:sec.sec,done:newVal,completed_at:newVal?new Date().toISOString():null};
        if(navigator.onLine){
          try{
            const{error}=await NX.sb.from('cleaning_logs').upsert(upsertData,{onConflict:'location,log_date,task_index,section'});
            if(error)console.error('Cleaning save error:',error);
          }catch(e){console.error('Cleaning save exception:',e);}
        }else if(NX.offlineQueue){
          NX.offlineQueue.add({type:'cleaning',data:upsertData});
        }
      };
      // Camera button — photo proof. Uses an SVG mask icon rather than
      // emoji because emoji rendering is platform-dependent (a small
      // detail that previously made the whole UI look childish on iOS,
      // where the system camera emoji is a glossy raster glyph that
      // fights every other line-art element in the app).
      // States are conveyed via a `data-state` attr on the button:
      //   idle    → camera icon
      //   pending → spinner (CSS animation)
      //   ok      → check
      //   err     → X
      const cam=document.createElement('button');
      cam.className='clean-cam';
      cam.setAttribute('data-state','idle');
      cam.title='Take photo';
      cam.addEventListener('click',async(e)=>{
        e.stopPropagation();
        const input=document.createElement('input');input.type='file';input.accept='image/*';input.capture='environment';
        input.addEventListener('change',async()=>{
          if(!input.files.length)return;
          const file=input.files[0];
          cam.setAttribute('data-state','pending');cam.disabled=true;
          try{
            const path=`cleaning/${loc}/${today}/${sec.sec}_${i}_${Date.now()}.jpg`;
            const{error}=await NX.sb.storage.from('nexus-files').upload(path,file,{contentType:file.type,upsert:true});
            if(!error){
              cam.setAttribute('data-state','ok');
              // Store photo ref in cleaning log
              await NX.sb.from('cleaning_logs').upsert({
                location:loc,log_date:today,task_index:i,section:sec.sec,
                done:getState(k),completed_at:new Date().toISOString(),
                photo_path:path
              },{onConflict:'location,log_date,task_index,section'});
              if(NX.toast)NX.toast('Photo saved ✓','success');
            }else{cam.setAttribute('data-state','err');if(NX.toast)NX.toast('Upload failed','error');}
          }catch(err){cam.setAttribute('data-state','err');if(NX.toast)NX.toast('Upload failed','error');}
          setTimeout(()=>{cam.setAttribute('data-state','idle');cam.disabled=false;},2000);
        });
        input.click();
      });
      it.appendChild(cam);
      body.appendChild(it);
    });

    el.appendChild(body);list.appendChild(el);
  });

  // Progress bar — ONLY daily tasks
  const pct=dailyTotal?Math.round(dailyDone/dailyTotal*100):0;
  document.getElementById('cleanFill').style.width=pct+'%';
  document.getElementById('cleanPct').textContent=pct+'%';
  document.getElementById('cleanConfirm').style.display='none';

  // Extras section
  renderExtras(list);
}

// ═══ EXTRAS — log work not on the checklist ═══
const COMMON_EXTRAS=[
  ['Limpiar paredes.','Clean walls.'],['Limpiar tubos de cobre.','Clean copper pipes.'],
  ['Lavado a presión.','Pressure wash.'],['Limpieza profunda de refrigeradores.','Deep clean fridges.'],
  ['Pulir latón/bronce.','Polish brass/bronze.'],['Limpiar trampas de grasa.','Clean grease traps.'],
  ['Limpiar ductos de ventilación.','Clean vent ducts.'],['Limpiar detrás de equipos.','Clean behind equipment.'],
  ['Pulir pisos.','Polish/buff floors.'],['Limpiar canaletas.','Clean gutters.'],
  ['Limpiar campana extractora.','Deep clean hood.'],['Descongelar congeladores.','Defrost freezers.']
];
function getExtrasToday(){try{return JSON.parse(localStorage.getItem('nexus_extras_'+loc+'_'+today)||'[]');}catch(e){return[];}}
function saveExtrasToday(ex){localStorage.setItem('nexus_extras_'+loc+'_'+today,JSON.stringify(ex));}

function renderExtras(list){
  const el=document.createElement('div');el.className='clean-sec';
  const extras=getExtrasToday();
  const h=document.createElement('div');h.className='clean-sec-head';
  h.innerHTML=`<span class="clean-sec-check" style="color:#ffb020">+</span><span class="clean-sec-arrow">▼</span><span class="clean-sec-title">Extras</span><span class="clean-on-track" style="margin-left:auto;margin-right:8px">${extras.length} logged</span>`;
  h.addEventListener('click',()=>el.classList.toggle('collapsed'));
  el.appendChild(h);
  const body=document.createElement('div');body.className='clean-sec-body';

  extras.forEach((ex,i)=>{
    const it=document.createElement('div');it.className='clean-item done clean-item-custom';
    it.innerHTML=`<div class=\"ci-box\">${csvg('check','12px','2.25')}</div><div><div class="ci-primary">${NX.i18n&&NX.i18n.getLang()==='es'?ex.es:ex.en}</div><div class="ci-secondary">${NX.i18n&&NX.i18n.getLang()==='es'?ex.en:ex.es}</div><div class="ci-last">${ex.time||''}</div></div>`;
    const del=document.createElement('button');del.className='clean-item-del';del.innerHTML=csvg('close','12px','2');
    del.addEventListener('click',(e)=>{e.stopPropagation();const ext=getExtrasToday();ext.splice(i,1);saveExtrasToday(ext);render();});
    it.appendChild(del);body.appendChild(it);

    // Auto-translate the primary text when the extra is free-form.
    // Built-in tasks ship with both Spanish + English filled in, but
    // user-added "Custom" extras often have only one language. If the
    // secondary line is empty or matches the primary (same language
    // typed twice), attach NX.tr.auto so the reader sees a translation
    // inline. quickDetect handles the "it's already in my language"
    // case silently — no badge, no noise.
    if (window.NX?.tr) {
      const primaryEl = it.querySelector('.ci-primary');
      const secondaryEl = it.querySelector('.ci-secondary');
      const sameOrEmpty = !secondaryEl?.textContent.trim()
        || secondaryEl.textContent.trim() === primaryEl.textContent.trim();
      if (primaryEl && sameOrEmpty) {
        try { NX.tr.auto(primaryEl); } catch(_) {}
      }
    }
  });

  const addRow=document.createElement('div');addRow.style.cssText='display:flex;gap:6px;padding:8px 0;flex-wrap:wrap;';
  const sel=document.createElement('select');sel.className='clean-add-select';sel.style.cssText='flex:1;min-width:140px';
  sel.innerHTML='<option value="">Quick add extra...</option>';
  COMMON_EXTRAS.forEach((ex,i)=>{sel.innerHTML+=`<option value="${i}">${ex[1]}</option>`;});
  sel.innerHTML+='<option value="custom">+ Custom...</option>';
  const addBtn=document.createElement('button');addBtn.className='clean-add-btn';addBtn.textContent='Log';
  addBtn.addEventListener('click',()=>{
    const v=sel.value;if(!v)return;
    const timeNow=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}).toLowerCase();
    if(v==='custom'){
      // One dialog, two fields — beats the sequential prompt() pair
      if(NX.composer?.modal){
        NX.composer.modal({
          title:'Custom cleaning task',
          subtitle:'Add an extra task done today',
          buttonLabel:'Log it',
          fields:[
            {name:'es',label:'Tarea (Español)',placeholder:'p.ej. Limpiar bajo la nevera',autofocus:true},
            {name:'en',label:'Task (English)',placeholder:'e.g. Clean under fridge'},
          ],
          onSubmit:async({es,en})=>{
            if(!es&&!en)throw new Error('empty');
            const ext=getExtrasToday();
            ext.push({es:es||en,en:en||es,time:timeNow});
            saveExtrasToday(ext);
            sel.value='';
            render();
          },
        });
        return;
      }
      // Fallback if composer.js didn't load
      const es=prompt('Tarea (español):');const en=prompt('Task (English):');
      if(!es&&!en)return;
      const ext=getExtrasToday();ext.push({es:es||en,en:en||es,time:timeNow});saveExtrasToday(ext);
    }else{const ex=COMMON_EXTRAS[parseInt(v)];const ext=getExtrasToday();ext.push({es:ex[0],en:ex[1],time:timeNow});saveExtrasToday(ext);}
    sel.value='';render();
  });
  addRow.appendChild(sel);addRow.appendChild(addBtn);body.appendChild(addRow);
  el.appendChild(body);list.appendChild(el);
}

// ═══ FULL REPORT — every task listed with done/missed ═══
function buildFullReport(location,locState){
  const secs=getData(location);
  let dailyTotal=0,dailyDone=0;const lines=[];
  secs.forEach(sec=>{
    const isDaily=!NON_DAILY.some(nd=>sec.sec.toLowerCase().includes(nd.toLowerCase()));
    let done=[],missed=[];
    sec.items.forEach((item,i)=>{
      if(isDaily)dailyTotal++;
      const s=locState?.[location+'_'+sec.sec+'_'+i];
      if(s&&s.done){if(isDaily)dailyDone++;done.push(item[1]);}
      else missed.push(item[1]);
    });
    lines.push(`${sec.sec} (${done.length}/${sec.items.length})`);
    if(missed.length)lines.push(`MISSED: ${missed.join(', ')}`);
  });
  const extras=[];
  try{const ex=JSON.parse(localStorage.getItem('nexus_extras_'+location+'_'+today)||'[]');ex.forEach(e=>extras.push(e.en));}catch(e){}
  const pct=dailyTotal?Math.round(dailyDone/dailyTotal*100):0;
  const locName=location.charAt(0).toUpperCase()+location.slice(1);
  let entry=`Cleaning Report — ${locName} — ${today}\nDaily: ${pct}% (${dailyDone}/${dailyTotal})\n---\n${lines.join('\n')}`;
  if(extras.length)entry+=`\n---\nEXTRAS: ${extras.join(', ')}`;
  return entry;
}

async function submitDailyReport(){
  const btn=document.getElementById('cleanSubmit'),confirm_el=document.getElementById('cleanConfirm');
  const isEditing=!!NX.editingReport;
  const reportDate=isEditing?NX.editingReport.date:today;

  btn.disabled=true;btn.textContent='Building report...';

  const parts=[];
  for(const location of Object.keys(DEFAULTS)){
    // PRIMARY: use stateCache (what the user actually sees on screen)
    // FALLBACK: query database if cache is empty for this location
    let locState=stateCache[location]||{};

    if(!Object.keys(locState).length){
      try{
        const{data}=await NX.sb.from('cleaning_logs').select('section,task_index,done').eq('log_date',reportDate).eq('location',location);
        if(data&&data.length){
          locState={};
          data.forEach(c=>{locState[location+'_'+c.section+'_'+c.task_index]={done:c.done,by:''};});
        }
      }catch(e){console.error('Failed to load cleaning data for',location,e);}
    }

    parts.push(buildFullReport(location,locState));
  }

  btn.textContent='Submitting...';
  const combined='Cleaning Report \u2014 '+reportDate+'\n===\n'+parts.join('\n===\n');

  if(isEditing){
    const{error}=await NX.sb.from('daily_logs').update({entry:combined}).eq('id',NX.editingReport.logId);
    if(!error){
      btn.textContent='\u2713 Updated';
      if(NX.toast)NX.toast('Report updated \u2713','success');
      NX.editingReport=null;today=getCleaningDate();
      const banner=document.getElementById('cleanEditBanner');if(banner)banner.style.display='none';
      setTimeout(()=>{document.querySelector('.nav-tab[data-view="log"]')?.click();},800);
    }else{btn.textContent='Error \u2014 try again';console.error('Update error:',error);}
  }else{
    // Check if a report for today already exists — update instead of duplicate
    let error;
    try{
      const{data:existing}=await NX.sb.from('daily_logs').select('id').ilike('entry','Cleaning Report%'+reportDate+'%').limit(1);
      if(existing&&existing.length){
        ({error}=await NX.sb.from('daily_logs').update({entry:combined}).eq('id',existing[0].id));
      }else{
        ({error}=await NX.sb.from('daily_logs').insert({entry:combined}));
      }
    }catch(e){
      error=e;
    }
    if(!error){
      btn.textContent='\u2713 Submitted';
      confirm_el.textContent='All 3 restaurants saved to log.';
      confirm_el.style.display='block';
      if(NX.toast)NX.toast('Cleaning report submitted \u2713','success');
      if(NX.syslog)NX.syslog('clean_report','Cleaning report submitted for '+reportDate);
      // Stage R: pulse the mini-galaxy — daily cleaning is the heartbeat
      // of the operation; the brain acknowledges.
      if (NX.homeGalaxyPulse) NX.homeGalaxyPulse();
    }else{btn.textContent='Error \u2014 try again';confirm_el.style.display='none';console.error('Submit error:',error);}
  }
  setTimeout(()=>{btn.disabled=false;btn.textContent='Submit Daily Report';},3000);
}

NX.cleaningAPI={addTask,removeTask,getLocations:()=>Object.keys(DEFAULTS)};

NX.modules.clean={init,show};
NX.cleaningTasks=DEFAULTS;
})();
