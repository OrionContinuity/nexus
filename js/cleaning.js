/* NEXUS Cleaning v11 — persistent state, 8AM rollover, who-did-what tracking */
(function(){
let loc='suerte';
const stateCache={}; // Per-location state cache
const lastDone={};
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
      populateSections();render();
    });
  });
  document.getElementById('cleanSubmit').addEventListener('click',submitDailyReport);
  const ab=document.getElementById('cleanAddBtn');if(ab)ab.addEventListener('click',addTaskUI);
  try{await loadToday();}catch(e){}
  try{await loadHistory();}catch(e){}
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
    banner.innerHTML=`<span>✏ Editing report for <b>${today}</b></span><button id="cancelEditClean" class="clean-edit-cancel">✕ Cancel</button>`;
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
  if(sec==='__new__'){sec=prompt('Section name:');if(!sec)return;}
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
    if(!isDaily){
      const freq=getFrequency(sec.sec);
      // Find oldest "last done" among this section's tasks
      let oldestDays=null;
      sec.items.forEach((_,i)=>{
        const hist=lastDone[sec.sec+'_'+i];
        if(hist){const d=daysBetween(hist.date,today);if(oldestDays===null||d>oldestDays)oldestDays=d;}
        else oldestDays=999;
      });
      if(oldestDays===null||oldestDays===999){secStatus='<span class="clean-overdue">Never done</span>';}
      else if(oldestDays>freq){secStatus=`<span class="clean-overdue">OVERDUE ${oldestDays-freq}d</span>`;}
      else if(oldestDays>freq*0.8){secStatus=`<span class="clean-due-soon">Due soon · ${daysAgoText(oldestDays)}</span>`;}
      else{secStatus=`<span class="clean-on-track">✓ ${daysAgoText(oldestDays)} · every ${freq}d</span>`;}
    }

    const el=document.createElement('div');
    el.className='clean-sec'+(si>3?' collapsed':'')+(isComplete?' complete':'');
    const h=document.createElement('div');h.className='clean-sec-head';
    h.innerHTML=`<span class="clean-sec-check">${isComplete?'✓':'○'}</span><span class="clean-sec-arrow">▼</span><span class="clean-sec-title">${sec.sec}</span>${secStatus}<span class="clean-sec-count">${sectionDone}/${sec.items.length}</span>`;

    // Check All button
    const caBtn=document.createElement('button');caBtn.className='clean-check-all';
    caBtn.textContent=isComplete?'Undo':'All ✓';
    caBtn.addEventListener('click',(e)=>{
      e.stopPropagation();const newState=!isComplete;
      sec.items.forEach((_,i)=>{
        const k=loc+'_'+sec.sec+'_'+i;setState(k,newState);
        try{NX.sb.from('cleaning_logs').upsert({location:loc,log_date:today,task_index:i,section:sec.sec,done:newState,completed_at:newState?new Date().toISOString():null},{onConflict:'location,log_date,task_index,section'});}catch(e){}
      });render();
    });

    h.appendChild(caBtn);
    h.addEventListener('click',(e)=>{if(e.target===caBtn)return;el.classList.toggle('collapsed');});
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
      it.innerHTML=`<div class="ci-box">${d?'✓':''}</div><div><div class="ci-primary">${lang==='es'?item[0]:item[1]}</div><div class="ci-secondary">${lang==='es'?item[1]:item[0]}</div>${lastInfo}</div>`;
      // Delete button for custom tasks
      if(item[2]){
        const del=document.createElement('button');del.className='clean-item-del';del.textContent='✕';
        del.addEventListener('click',(e)=>{
          e.stopPropagation();
          const ct=getCustomTasks();
          if(ct[loc]){ct[loc].splice(item[3],1);saveCustomTasks(ct);render();}
        });
        it.appendChild(del);
      }
      it.onclick=()=>{
        const newVal=!getState(k);setState(k,newVal);render();
        const upsertData={location:loc,log_date:today,task_index:i,section:sec.sec,done:newVal,completed_at:newVal?new Date().toISOString():null};
        if(navigator.onLine){
          try{NX.sb.from('cleaning_logs').upsert(upsertData,{onConflict:'location,log_date,task_index,section'});}catch(e){}
        }else if(NX.offlineQueue){
          NX.offlineQueue.add({type:'cleaning',data:upsertData});
        }
      };
      // Camera button — photo proof
      const cam=document.createElement('button');cam.className='clean-cam';cam.textContent='📷';cam.title='Take photo';
      cam.addEventListener('click',async(e)=>{
        e.stopPropagation();
        const input=document.createElement('input');input.type='file';input.accept='image/*';input.capture='environment';
        input.addEventListener('change',async()=>{
          if(!input.files.length)return;
          const file=input.files[0];
          cam.textContent='⏳';cam.disabled=true;
          try{
            const path=`cleaning/${loc}/${today}/${sec.sec}_${i}_${Date.now()}.jpg`;
            const{error}=await NX.sb.storage.from('nexus-files').upload(path,file,{contentType:file.type,upsert:true});
            if(!error){
              cam.textContent='✅';
              // Store photo ref in cleaning log
              await NX.sb.from('cleaning_logs').upsert({
                location:loc,log_date:today,task_index:i,section:sec.sec,
                done:getState(k),completed_at:new Date().toISOString(),
                photo_path:path
              },{onConflict:'location,log_date,task_index,section'});
              if(NX.toast)NX.toast('Photo saved ✓','success');
            }else{cam.textContent='❌';if(NX.toast)NX.toast('Upload failed','error');}
          }catch(err){cam.textContent='❌';if(NX.toast)NX.toast('Upload failed','error');}
          setTimeout(()=>{cam.textContent='📷';cam.disabled=false;},2000);
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
    it.innerHTML=`<div class="ci-box" style="color:#39ff14">✓</div><div><div class="ci-primary">${NX.i18n&&NX.i18n.getLang()==='es'?ex.es:ex.en}</div><div class="ci-secondary">${NX.i18n&&NX.i18n.getLang()==='es'?ex.en:ex.es}</div><div class="ci-last">${ex.time||''}</div></div>`;
    const del=document.createElement('button');del.className='clean-item-del';del.textContent='✕';
    del.addEventListener('click',(e)=>{e.stopPropagation();const ext=getExtrasToday();ext.splice(i,1);saveExtrasToday(ext);render();});
    it.appendChild(del);body.appendChild(it);
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
    if(v==='custom'){const es=prompt('Tarea (español):');const en=prompt('Task (English):');if(!es&&!en)return;
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

  btn.disabled=true;btn.textContent='Loading all restaurants...';

  const parts=[];
  for(const location of Object.keys(DEFAULTS)){
    let locState={};
    try{
      const{data}=await NX.sb.from('cleaning_logs').select('section,task_index,done').eq('log_date',reportDate).eq('location',location);
      if(data)data.forEach(c=>{locState[location+'_'+c.section+'_'+c.task_index]={done:c.done,by:''};});
    }catch(e){}
    parts.push(buildFullReport(location,locState));
  }

  btn.textContent='Submitting...';
  const combined='Cleaning Report — '+reportDate+'\n===\n'+parts.join('\n===\n');

  if(isEditing){
    const{error}=await NX.sb.from('daily_logs').update({entry:combined}).eq('id',NX.editingReport.logId);
    if(!error){
      btn.textContent='✓ Updated';
      if(NX.toast)NX.toast('Report updated ✓','success');
      NX.editingReport=null;today=getCleaningDate();
      const banner=document.getElementById('cleanEditBanner');if(banner)banner.style.display='none';
      setTimeout(()=>{document.querySelector('.nav-tab[data-view="log"]')?.click();},800);
    }else{btn.textContent='Error — try again';}
  }else{
    // Check if a report for today already exists — update it instead of creating a duplicate
    const{data:existing}=await NX.sb.from('daily_logs').select('id').ilike('entry','Cleaning Report%'+reportDate+'%').limit(1);
    let error;
    if(existing&&existing.length){
      ({error}=await NX.sb.from('daily_logs').update({entry:combined}).eq('id',existing[0].id));
    }else{
      ({error}=await NX.sb.from('daily_logs').insert({entry:combined}));
    }
    if(!error){
      btn.textContent='✓ Submitted';
      confirm_el.textContent='All 3 restaurants saved to log.';
      confirm_el.style.display='block';
      if(NX.toast)NX.toast('Cleaning report submitted ✓','success');
    }else{btn.textContent='Error — try again';confirm_el.style.display='none';}
  }
  setTimeout(()=>{btn.disabled=false;btn.textContent='Submit Daily Report';},3000);
}

NX.cleaningAPI={addTask,removeTask,getLocations:()=>Object.keys(DEFAULTS)};

NX.modules.clean={init,show};
NX.cleaningTasks=DEFAULTS;
})();
