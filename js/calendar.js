/* NEXUS Calendar v3 — warm palette, contractor triage, full history */
(function(){
let currentDate=new Date();
let events={};

const COLORS={contractor:'#5b9bd5',cleaning:'#7eb87a',ticket:'#d4785c',card:'#c8a44e',log:'#a89580'};
const TYPE_ICONS={contractor:'🔧',cleaning:'✨',ticket:'⚠',card:'☑',log:'📝'};
const TYPE_LABELS={contractor:'Contractor',cleaning:'Cleaning',ticket:'Ticket',card:'Task',log:'Log'};

function fmtTime(t){if(!t)return '';try{const p=t.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);if(!p)return t;let h=parseInt(p[1]),m=p[2],ap=p[3];if(!ap){ap=h>=12?'PM':'AM';if(h>12)h-=12;if(h===0)h=12;}return h+':'+m+' '+ap.toUpperCase();}catch(e){return t;}}
function fmtDate(ds){try{const d=new Date(ds+'T12:00:00');const dd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];const mm=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return dd[d.getDay()]+', '+mm[d.getMonth()]+' '+d.getDate();}catch(e){return ds;}}

async function loadEvents(){
  events={};
  const year=currentDate.getFullYear(),month=currentDate.getMonth();
  const firstDay=year+'-'+String(month+1).padStart(2,'0')+'-01';
  const lastDay=new Date(year,month+1,0).toISOString().split('T')[0];

  // Contractors — all statuses except disregarded
  try{const{data}=await NX.sb.from('contractor_events').select('*').gte('event_date',firstDay).lte('event_date',lastDay).neq('status','disregarded');
    if(data)data.forEach(e=>{const d=e.event_date;if(!d)return;if(!events[d])events[d]=[];const st=e.status||'pending';
      events[d].push({type:'contractor',title:e.contractor_name||'Contractor',time:e.event_time?fmtTime(e.event_time):'',location:e.location||'',color:COLORS.contractor,detail:e.description||'',status:st,statusLabel:st==='accepted'?'✓ Confirmed':st==='dismissed'?'Noted':st==='pending'?'Pending':'',id:e.id});});}catch(e){}

  // Daily logs
  try{const{data}=await NX.sb.from('daily_logs').select('id,entry,created_at').gte('created_at',firstDay+'T00:00:00').lte('created_at',lastDay+'T23:59:59').limit(200);
    if(data)data.forEach(e=>{const d=(e.created_at||'').split('T')[0];if(!d)return;if(!events[d])events[d]=[];const entry=e.entry||'';const time=(e.created_at||'').split('T')[1]?.slice(0,5)||'';
      if(entry.includes('[DISREGARDED]')){events[d].push({type:'log',title:entry.replace('[DISREGARDED] ','').slice(0,60),time:fmtTime(time),color:'#9e8e7e',detail:entry,recoverable:true,logId:e.id});return;}
      if(entry.toLowerCase().includes('cleaning report'))events[d].push({type:'cleaning',title:'Cleaning Report',time:fmtTime(time),color:COLORS.cleaning,detail:entry.slice(0,200)});
      else if(entry.includes('[TICKET]'))events[d].push({type:'ticket',title:entry.replace('[TICKET]','').trim().slice(0,60),time:fmtTime(time),color:COLORS.ticket,detail:entry});
      else events[d].push({type:'log',title:entry.slice(0,60),time:fmtTime(time),color:COLORS.log,detail:entry});});}catch(e){}

  // Tickets
  try{const{data}=await NX.sb.from('tickets').select('*').gte('created_at',firstDay+'T00:00:00').lte('created_at',lastDay+'T23:59:59');
    if(data)data.forEach(e=>{const d=(e.created_at||'').split('T')[0];if(!d)return;if(!events[d])events[d]=[];const time=(e.created_at||'').split('T')[1]?.slice(0,5)||'';
      events[d].push({type:'ticket',title:e.title||'Issue',time:fmtTime(time),location:e.location||'',color:COLORS.ticket,detail:e.description||e.title||'',status:e.status||'open'});});}catch(e){}

  // Cards with due dates
  try{const{data}=await NX.sb.from('kanban_cards').select('*').not('due_date','is',null);
    if(data)data.forEach(e=>{const d=e.due_date;if(!d||d<firstDay||d>lastDay)return;if(!events[d])events[d]=[];
      events[d].push({type:'card',title:e.title||'Task',color:COLORS.card,detail:'Status: '+(e.column_name||'todo'),status:e.column_name||'todo'});});}catch(e){}
}

function render(){
  try{const year=currentDate.getFullYear(),month=currentDate.getMonth();
    const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const titleEl=document.getElementById('calTitle');if(titleEl)titleEl.textContent=months[month]+' '+year;
    const grid=document.getElementById('calGrid');if(!grid)return;grid.innerHTML='';
    const firstDow=new Date(year,month,1).getDay(),daysInMonth=new Date(year,month+1,0).getDate();
    const today=new Date();const todayStr=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');

    for(let i=0;i<firstDow;i++){const cell=document.createElement('div');cell.className='cal-cell cal-empty';grid.appendChild(cell);}
    for(let d=1;d<=daysInMonth;d++){
      const dateStr=year+'-'+String(month+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      const cell=document.createElement('div');cell.className='cal-cell'+(dateStr===todayStr?' cal-today-cell':'');
      const num=document.createElement('div');num.className='cal-num';num.textContent=d;cell.appendChild(num);
      const dayEvents=events[dateStr]||[];
      if(dayEvents.length){const dots=document.createElement('div');dots.className='cal-dots';
        const types=new Set(dayEvents.map(e=>e.type));types.forEach(t=>{const dot=document.createElement('span');dot.className='cal-dot';dot.style.background=COLORS[t]||'#888';dots.appendChild(dot);});
        cell.appendChild(dots);if(dayEvents.length>1){const badge=document.createElement('span');badge.className='cal-badge';badge.textContent=dayEvents.length;cell.appendChild(badge);}}
      cell.addEventListener('click',()=>{document.querySelectorAll('.cal-cell.selected').forEach(c=>c.classList.remove('selected'));cell.classList.add('selected');showDetail(dateStr,dayEvents);});
      grid.appendChild(cell);}
  }catch(e){console.error('Cal render error:',e);}
}

function showDetail(dateStr,dayEvents){
  const detail=document.getElementById('calDetail');if(!detail)return;
  if(!dayEvents||!dayEvents.length){detail.innerHTML='<div class="cal-detail-date">'+fmtDate(dateStr)+'</div><div class="cal-detail-empty">Nothing scheduled</div>';return;}

  const order={contractor:0,ticket:1,card:2,cleaning:3,log:4};
  dayEvents.sort((a,b)=>(order[a.type]||5)-(order[b.type]||5));

  detail.innerHTML='<div class="cal-detail-date">'+fmtDate(dateStr)+' · '+dayEvents.length+' event'+(dayEvents.length>1?'s':'')+'</div>'+
    dayEvents.map((e,i)=>{
      const icon=TYPE_ICONS[e.type]||'•',label=TYPE_LABELS[e.type]||'Event';
      const meta=[];if(e.time)meta.push(e.time);if(e.location)meta.push(e.location);
      let statusBadge='';
      if(e.statusLabel){const sc=e.status==='accepted'?'cal-status-done':e.status==='dismissed'?'cal-status-noted':'cal-status-open';statusBadge='<span class="cal-event-status '+sc+'">'+e.statusLabel+'</span>';}
      else if(e.status){const sc=e.status==='open'||e.status==='todo'?'cal-status-open':e.status==='done'||e.status==='closed'?'cal-status-done':'';statusBadge='<span class="cal-event-status '+sc+'">'+e.status+'</span>';}
      const recoverBtn=e.recoverable?'<button class="cal-recover-btn" data-log-id="'+e.logId+'">↩ Restore</button>':'';
      return '<div class="cal-event '+(e.recoverable?'cal-event-faded':'')+'" data-type="'+e.type+'"><div class="cal-event-accent" style="background:'+e.color+'"></div><div class="cal-event-body"><div class="cal-event-header"><span class="cal-event-type">'+icon+' '+label+'</span>'+statusBadge+'</div><div class="cal-event-title">'+
        (e.title||'')+'</div>'+(meta.length?'<div class="cal-event-meta">'+meta.join(' · ')+'</div>':'')+(e.detail?'<div class="cal-event-detail">'+e.detail+'</div>':'')+recoverBtn+'</div></div>';}).join('');

  detail.querySelectorAll('.cal-event').forEach(card=>{card.addEventListener('click',ev=>{if(ev.target.closest('.cal-recover-btn'))return;card.classList.toggle('expanded');});});
  detail.querySelectorAll('.cal-recover-btn').forEach(btn=>{btn.addEventListener('click',async ev=>{ev.stopPropagation();if(NX.toast)NX.toast('Recovery: coming soon','info');});});
}

async function init(){
  try{document.getElementById('calPrev')?.addEventListener('click',async()=>{currentDate.setMonth(currentDate.getMonth()-1);await loadEvents();render();});
    document.getElementById('calNext')?.addEventListener('click',async()=>{currentDate.setMonth(currentDate.getMonth()+1);await loadEvents();render();});
    document.getElementById('calToday')?.addEventListener('click',async()=>{currentDate=new Date();await loadEvents();render();});
    render();await loadEvents();render();}catch(e){console.error('Cal init error:',e);render();}
}
async function show(){try{await loadEvents();}catch(e){}render();}
NX.modules.cal={init,show};
})();
