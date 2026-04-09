/* NEXUS Cleaning v9 — bulletproof percentage, AI-editable tasks */
(function(){
let loc='suerte',state={};
const today=NX.today;
const NON_DAILY=['Bi-Semanal','Mensual','Semanal','Quincenal','Trimestral'];

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

// Merge defaults + custom tasks
function getData(location){
  const base=JSON.parse(JSON.stringify(DEFAULTS[location]||[]));
  const custom=getCustomTasks()[location]||[];
  custom.forEach(ct=>{
    let sec=base.find(s=>s.sec===ct.section);
    if(!sec){sec={sec:ct.section,items:[]};base.push(sec);}
    sec.items.push([ct.es,ct.en]);
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
      t.classList.add('active');loc=t.dataset.cloc;state={};
      try{const{data}=await NX.sb.from('cleaning_logs').select('*').eq('log_date',today).eq('location',loc);
        if(data)data.forEach(c=>{state[loc+'_'+c.section+'_'+c.task_index]=c.done;});}catch(e){}
      render();
    });
  });
  document.getElementById('cleanSubmit').addEventListener('click',submitDailyReport);
  try{const{data}=await NX.sb.from('cleaning_logs').select('*').eq('log_date',today).eq('location',loc);
    if(data)data.forEach(c=>{state[loc+'_'+c.section+'_'+c.task_index]=c.done;});}catch(e){}
  render();
}

function render(){
  const list=document.getElementById('cleanList');list.innerHTML='';
  const secs=getData(loc);
  let dailyTotal=0,dailyDone=0;

  secs.forEach((sec,si)=>{
    const isDaily=!NON_DAILY.some(nd=>sec.sec.toLowerCase().includes(nd.toLowerCase()));
    let sectionDone=0;

    sec.items.forEach((_,i)=>{if(state[loc+'_'+sec.sec+'_'+i])sectionDone++;});
    const isComplete=sectionDone===sec.items.length&&sec.items.length>0;

    const el=document.createElement('div');
    el.className='clean-sec'+(si>3?' collapsed':'')+(isComplete?' complete':'');
    const h=document.createElement('div');h.className='clean-sec-head';
    const dailyTag=isDaily?'':'<span style="font-size:9px;color:var(--faint);margin-left:6px">'+sec.sec.toUpperCase()+'</span>';
    h.innerHTML=`<span class="clean-sec-check">${isComplete?'✓':'○'}</span><span class="clean-sec-arrow">▼</span><span class="clean-sec-title">${sec.sec}${dailyTag}</span><span class="clean-sec-count">${sectionDone}/${sec.items.length}</span>`;

    // Check All button
    const caBtn=document.createElement('button');caBtn.className='clean-check-all';
    caBtn.textContent=isComplete?'Undo':'All ✓';
    caBtn.addEventListener('click',(e)=>{
      e.stopPropagation();const newState=!isComplete;
      sec.items.forEach((_,i)=>{
        const k=loc+'_'+sec.sec+'_'+i;state[k]=newState;
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
      const d=!!state[k];
      if(d&&isDaily)dailyDone++;

      const it=document.createElement('div');it.className='clean-item'+(d?' done':'');
      it.innerHTML=`<div class="ci-box">${d?'✓':''}</div><div><div class="ci-en">${item[0]}</div><div class="ci-es">${item[1]}</div></div>`;
      it.onclick=()=>{
        state[k]=!state[k];render();
        try{NX.sb.from('cleaning_logs').upsert({location:loc,log_date:today,task_index:i,section:sec.sec,done:state[k],completed_at:state[k]?new Date().toISOString():null},{onConflict:'location,log_date,task_index,section'});}catch(e){}
      };
      body.appendChild(it);
    });

    el.appendChild(body);list.appendChild(el);
  });

  // Progress bar — ONLY daily tasks
  const pct=dailyTotal?Math.round(dailyDone/dailyTotal*100):0;
  document.getElementById('cleanFill').style.width=pct+'%';
  document.getElementById('cleanPct').textContent=pct+'%';
  document.getElementById('cleanConfirm').style.display='none';
}

async function submitDailyReport(){
  const btn=document.getElementById('cleanSubmit'),confirm=document.getElementById('cleanConfirm');
  const secs=getData(loc);
  let dailyTotal=0,dailyDone=0;const bd=[];

  secs.forEach(sec=>{
    const isDaily=!NON_DAILY.some(nd=>sec.sec.toLowerCase().includes(nd.toLowerCase()));
    let sd=0;
    sec.items.forEach((_,i)=>{
      if(isDaily)dailyTotal++;
      if(state[loc+'_'+sec.sec+'_'+i]){if(isDaily)dailyDone++;sd++;}
    });
    bd.push(`${sec.sec}: ${sd}/${sec.items.length}`);
  });

  const pct=dailyTotal?Math.round(dailyDone/dailyTotal*100):0;
  const locName=loc.charAt(0).toUpperCase()+loc.slice(1);
  const entry=`Cleaning Report [${locName}]: ${pct}% Complete (${dailyDone}/${dailyTotal} daily tasks). ${bd.join(', ')}.`;

  btn.disabled=true;btn.textContent='Submitting...';
  const{error}=await NX.sb.from('daily_logs').insert({entry});
  if(!error){btn.textContent='✓ Submitted';confirm.textContent='Saved to daily log — view in Log tab';confirm.style.display='block';}
  else{btn.textContent='Error — try again';confirm.style.display='none';}
  setTimeout(()=>{btn.disabled=false;btn.textContent='Submit Daily Report';},3000);
}

// Expose for AI chat commands
NX.cleaningAPI={addTask,removeTask,getLocations:()=>Object.keys(DEFAULTS)};
NX.modules.clean={init,show:render};
})();
