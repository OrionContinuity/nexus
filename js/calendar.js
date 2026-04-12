/* NEXUS Calendar — unified view of all dated events */
(function(){
let currentDate=new Date();
let events={};

const COLORS={
  contractor:'#4a9eff',
  cleaning:'#39ff14',
  ticket:'#ff5533',
  card:'#c8a44e',
  log:'#8b7355'
};

async function loadEvents(){
  events={};
  const year=currentDate.getFullYear();
  const month=currentDate.getMonth();
  const firstDay=`${year}-${String(month+1).padStart(2,'0')}-01`;
  const lastDay=new Date(year,month+1,0).toISOString().split('T')[0];

  try{
    const{data}=await NX.sb.from('contractor_events').select('*')
      .gte('event_date',firstDay).lte('event_date',lastDay);
    if(data)data.forEach(e=>{
      const d=e.event_date;if(!d)return;
      if(!events[d])events[d]=[];
      events[d].push({type:'contractor',title:e.contractor_name||'Contractor',color:COLORS.contractor,
        detail:`${e.contractor_name||''}${e.event_time?' @ '+e.event_time:''}${e.location?' · '+e.location:''}${e.description?' — '+e.description:''}`});
    });
  }catch(e){console.log('Cal: no contractor_events');}

  try{
    const{data}=await NX.sb.from('daily_logs').select('id,entry,created_at')
      .gte('created_at',firstDay+'T00:00:00').lte('created_at',lastDay+'T23:59:59');
    if(data)data.forEach(e=>{
      const d=(e.created_at||'').split('T')[0];if(!d)return;
      if(!events[d])events[d]=[];
      const entry=e.entry||'';
      if(entry.toLowerCase().includes('cleaning report')){
        events[d].push({type:'cleaning',title:'Cleaning Report',color:COLORS.cleaning,detail:entry.slice(0,150)});
      }else if(entry.includes('[TICKET]')){
        events[d].push({type:'ticket',title:entry.slice(0,60),color:COLORS.ticket,detail:entry});
      }else{
        events[d].push({type:'log',title:entry.slice(0,60),color:COLORS.log,detail:entry});
      }
    });
  }catch(e){console.log('Cal: no daily_logs');}

  try{
    const{data}=await NX.sb.from('tickets').select('*')
      .gte('created_at',firstDay+'T00:00:00').lte('created_at',lastDay+'T23:59:59');
    if(data)data.forEach(e=>{
      const d=(e.created_at||'').split('T')[0];if(!d)return;
      if(!events[d])events[d]=[];
      events[d].push({type:'ticket',title:e.title||'Issue',color:COLORS.ticket,
        detail:`${e.title||''}${e.location?' @ '+e.location:''}${e.status?' — '+e.status:''}`});
    });
  }catch(e){console.log('Cal: no tickets');}

  try{
    const{data}=await NX.sb.from('kanban_cards').select('*').not('due_date','is',null);
    if(data)data.forEach(e=>{
      const d=e.due_date;if(!d||d<firstDay||d>lastDay)return;
      if(!events[d])events[d]=[];
      events[d].push({type:'card',title:e.title||'Task',color:COLORS.card,detail:`${e.title} (${e.column_name||'todo'})`});
    });
  }catch(e){console.log('Cal: no kanban_cards');}
}

function render(){
  try{
    const year=currentDate.getFullYear();
    const month=currentDate.getMonth();
    const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const titleEl=document.getElementById('calTitle');
    if(titleEl)titleEl.textContent=months[month]+' '+year;

    const grid=document.getElementById('calGrid');
    if(!grid)return;
    grid.innerHTML='';

    const firstDow=new Date(year,month,1).getDay();
    const daysInMonth=new Date(year,month+1,0).getDate();
    const today=new Date();
    const todayStr=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    for(let i=0;i<firstDow;i++){
      const cell=document.createElement('div');cell.className='cal-cell cal-empty';
      grid.appendChild(cell);
    }

    for(let d=1;d<=daysInMonth;d++){
      const dateStr=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cell=document.createElement('div');
      cell.className='cal-cell'+(dateStr===todayStr?' cal-today-cell':'');

      const num=document.createElement('div');num.className='cal-num';num.textContent=d;
      cell.appendChild(num);

      const dayEvents=events[dateStr]||[];
      if(dayEvents.length){
        const dots=document.createElement('div');dots.className='cal-dots';
        const types=new Set(dayEvents.map(e=>e.type));
        types.forEach(t=>{
          const dot=document.createElement('span');dot.className='cal-dot';
          dot.style.background=COLORS[t]||'#888';
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
        if(dayEvents.length>1){
          const badge=document.createElement('span');badge.className='cal-badge';
          badge.textContent=dayEvents.length;
          cell.appendChild(badge);
        }
      }

      cell.addEventListener('click',()=>{
        document.querySelectorAll('.cal-cell.selected').forEach(c=>c.classList.remove('selected'));
        cell.classList.add('selected');
        showDetail(dateStr,dayEvents);
      });
      grid.appendChild(cell);
    }
  }catch(e){console.error('Cal render error:',e);}
}

function showDetail(dateStr,dayEvents){
  const detail=document.getElementById('calDetail');
  if(!detail)return;
  document.querySelectorAll('.cal-cell.selected').forEach(c=>c.classList.remove('selected'));

  if(!dayEvents||!dayEvents.length){
    detail.innerHTML=`<div class="cal-detail-date">${dateStr}</div><div class="cal-detail-empty">No events</div>`;
    return;
  }
  detail.innerHTML=`<div class="cal-detail-date">${dateStr} · ${dayEvents.length} event${dayEvents.length>1?'s':''}</div>
    ${dayEvents.map((e,i)=>`
      <div class="cal-event" data-idx="${i}">
        <span class="cal-event-dot" style="background:${e.color}"></span>
        <div class="cal-event-body">
          <div class="cal-event-title">${e.title||''}</div>
          <div class="cal-event-expand">Details</div>
          <div class="cal-event-detail">${e.detail||''}</div>
        </div>
      </div>`).join('')}`;

  // Add expand/collapse click handlers
  detail.querySelectorAll('.cal-event').forEach(card=>{
    card.addEventListener('click',()=>card.classList.toggle('expanded'));
  });
}

async function init(){
  try{
    document.getElementById('calPrev')?.addEventListener('click',async()=>{
      currentDate.setMonth(currentDate.getMonth()-1);
      await loadEvents();render();
    });
    document.getElementById('calNext')?.addEventListener('click',async()=>{
      currentDate.setMonth(currentDate.getMonth()+1);
      await loadEvents();render();
    });
    document.getElementById('calToday')?.addEventListener('click',async()=>{
      currentDate=new Date();
      await loadEvents();render();
    });
    // Always render first, then load events
    render();
    await loadEvents();
    render();
  }catch(e){console.error('Cal init error:',e);render();}
}

async function show(){
  try{await loadEvents();}catch(e){}
  render();
}

NX.modules.cal={init,show};
})();
