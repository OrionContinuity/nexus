/* NEXUS Activity Feed v10 — unified timeline across all systems */
(function(){
let feed=[],activeFilter='all';
const FILTERS=[
  {key:'all',label:'All',icon:'⚡'},
  {key:'log',label:'Logs',icon:'📋'},
  {key:'ticket',label:'Tickets',icon:'🔧'},
  {key:'task',label:'Tasks',icon:'☑'},
  {key:'clock',label:'Clock',icon:'⏱'},
  {key:'chat',label:'Chat',icon:'💬'},
  {key:'clean',label:'Clean',icon:'🧹'}
];
const TYPE_COLORS={log:'var(--accent)',ticket:'#ffb020',task:'var(--blue)',clock:'var(--green)',chat:'var(--purple)',clean:'#39ff14'};

async function init(){
  renderFilterBar();
  document.getElementById('logAdd').addEventListener('click',addLog);
  document.getElementById('logInput').addEventListener('keydown',e=>{if(e.key==='Enter')addLog();});
  document.getElementById('knowledgeBtn').addEventListener('click',addKnowledge);
  document.getElementById('knowledgeInput').addEventListener('keydown',e=>{if(e.key==='Enter')addKnowledge();});
  await loadAll();
}

function renderFilterBar(){
  const bar=document.getElementById('feedFilters');if(!bar)return;
  bar.innerHTML='';
  FILTERS.forEach(f=>{
    const btn=document.createElement('button');
    btn.className='feed-chip'+(activeFilter===f.key?' active':'');
    btn.textContent=f.icon+' '+f.label;
    btn.addEventListener('click',()=>{activeFilter=f.key;renderFilterBar();render();});
    bar.appendChild(btn);
  });
}

async function loadAll(){
  const now=new Date();
  const since=new Date(now.getTime()-30*86400000).toISOString();
  const results=await Promise.allSettled([
    NX.sb.from('daily_logs').select('*').gte('created_at',since).order('created_at',{ascending:false}).limit(100),
    NX.sb.from('tickets').select('*').order('created_at',{ascending:false}).limit(50),
    NX.sb.from('kanban_cards').select('*').order('created_at',{ascending:false}).limit(50),
    NX.sb.from('time_clock').select('*').gte('clock_in',since).order('clock_in',{ascending:false}).limit(100),
    NX.sb.from('chat_history').select('*').gte('created_at',since).order('created_at',{ascending:false}).limit(50),
    NX.sb.from('cleaning_logs').select('*').gte('created_at',since).order('created_at',{ascending:false}).limit(100)
  ]);

  feed=[];
  const get=i=>(results[i].status==='fulfilled'&&results[i].value.data)||[];

  // daily_logs — split cleaning reports from regular logs
  get(0).forEach(r=>{
    const entry=r.entry||'';
    const isCR=entry.startsWith('Cleaning Report')||entry.startsWith('[AUTO');
    feed.push({type:isCR?'clean':'log',ts:r.created_at,id:'dl-'+r.id,data:r,src:'daily_logs'});
  });

  // tickets
  get(1).forEach(r=>feed.push({type:'ticket',ts:r.created_at,id:'tk-'+r.id,data:r}));

  // kanban cards
  get(2).forEach(r=>feed.push({type:'task',ts:r.created_at,id:'kb-'+r.id,data:r}));

  // time clock
  get(3).forEach(r=>feed.push({type:'clock',ts:r.clock_in,id:'tc-'+r.id,data:r}));

  // chat history
  get(4).forEach(r=>feed.push({type:'chat',ts:r.created_at,id:'ch-'+r.id,data:r}));

  // cleaning_logs (individual completions) — skip dates covered by cleaning reports
  const crDates=new Set(feed.filter(f=>f.type==='clean'&&f.src==='daily_logs').map(f=>{
    const m=(f.data.entry||'').match(/\d{4}-\d{2}-\d{2}/);return m?m[0]:null;
  }).filter(Boolean));
  get(5).forEach(r=>{
    const d=r.date||r.created_at?.slice(0,10);
    if(!crDates.has(d))feed.push({type:'clean',ts:r.created_at,id:'cl-'+r.id,data:r,src:'cleaning_logs'});
  });

  feed.sort((a,b)=>new Date(b.ts)-new Date(a.ts));
  render();
}

function fmtTime(ts){
  if(!ts)return'';
  const d=new Date(ts),diff=Date.now()-d;
  if(diff<60000)return'just now';
  if(diff<3600000)return Math.floor(diff/60000)+'m ago';
  if(diff<86400000)return Math.floor(diff/3600000)+'h ago';
  const days=Math.floor(diff/86400000);
  if(days<7)return days+'d ago';
  return d.toLocaleDateString([],{month:'short',day:'numeric'});
}

function render(){
  const list=document.getElementById('logList');list.innerHTML='';
  const filtered=activeFilter==='all'?feed:feed.filter(f=>f.type===activeFilter);

  // Pin open tickets at top
  if(activeFilter==='all'||activeFilter==='ticket'){
    const open=feed.filter(f=>f.type==='ticket'&&f.data.status==='open');
    if(open.length){
      const sec=document.createElement('div');sec.className='feed-pinned';
      sec.innerHTML=`<div class="feed-pinned-title">🔧 OPEN TICKETS (${open.length})</div>`;
      open.forEach(item=>sec.appendChild(renderTicket(item.data,true)));
      list.appendChild(sec);
    }
  }

  if(!filtered.length){
    list.innerHTML='<div class="log-empty"><div style="font-size:20px;margin-bottom:8px;opacity:.3">⚡</div>No activity yet.<br><span style="font-size:11px;color:var(--faint)">Actions across all systems appear here.</span></div>';
    return;
  }

  // Group by day
  const days=new Map();
  filtered.forEach(item=>{
    if(item.type==='ticket'&&item.data.status==='open'&&(activeFilter==='all'||activeFilter==='ticket'))return;
    const dayKey=new Date(item.ts).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
    if(!days.has(dayKey))days.set(dayKey,[]);
    days.get(dayKey).push(item);
  });

  for(const[day,items]of days){
    const sec=document.createElement('div');sec.className='feed-day';
    sec.innerHTML=`<div class="feed-day-label">${day}</div>`;
    items.forEach(item=>{const el=renderItem(item);if(el)sec.appendChild(el);});
    if(sec.children.length>1)list.appendChild(sec);
  }
}

function renderItem(item){
  switch(item.type){
    case'log':return renderLog(item.data);
    case'ticket':return renderTicket(item.data,false);
    case'task':return renderTask(item.data);
    case'clock':return renderClock(item.data);
    case'chat':return renderChat(item.data);
    case'clean':return item.src==='daily_logs'?renderCleanReport(item.data):renderCleanTask(item.data);
    default:return null;
  }
}

function mkCard(type,inner,ts){
  const d=document.createElement('div');d.className='feed-item feed-'+type;
  d.innerHTML=`<div class="feed-bar" style="background:${TYPE_COLORS[type]||'var(--border)'}"></div>
    <div class="feed-body">
      <div class="feed-head"><span class="feed-badge feed-badge-${type}">${FILTERS.find(f=>f.key===type)?.icon||''}</span><span class="feed-ts">${fmtTime(ts)}</span></div>
      <div class="feed-content">${inner}</div>
    </div>`;
  return d;
}

function renderLog(r){
  const entry=r.entry||'',isTK=entry.includes('TICKET');
  const el=mkCard('log',`<div class="feed-text${isTK?' feed-text-tk':''}">${isTK?'🔧 ':''}${entry}</div>${r.user_name?`<div class="feed-who">${r.user_name}</div>`:''}`,r.created_at);
  addDel(el,r.id,'daily_logs');
  return el;
}

function renderTicket(r,pinned){
  const pc=r.priority==='urgent'?'#ff5533':r.priority==='low'?'#39ff14':'#ffb020';
  const d=document.createElement('div');d.className='feed-item feed-ticket'+(pinned?' feed-pinned-item':'');
  d.innerHTML=`<div class="feed-bar" style="background:${pc}"></div>
    <div class="feed-body">
      <div class="feed-head">
        <span class="feed-badge feed-badge-ticket">🔧</span>
        <span class="feed-pri" style="color:${pc}">${(r.priority||'normal').toUpperCase()}</span>
        <span class="feed-loc">${r.location||''}</span>
        <span class="feed-ts">${fmtTime(r.created_at)}</span>
      </div>
      <div class="feed-content">
        <div class="feed-text">${r.title||r.notes||''}</div>
        ${r.notes&&r.title?`<div class="feed-sub">${r.notes}</div>`:''}
        ${r.photo_url?`<img src="${r.photo_url}" class="feed-photo">`:''}
        ${r.ai_troubleshoot?`<details class="feed-ai-detail"><summary>AI Troubleshoot</summary><div class="feed-ai-body">${r.ai_troubleshoot}</div></details>`:''}
        <div class="feed-who">${r.reported_by||''} · ${r.status||'open'}</div>
      </div>
    </div>`;
  if(pinned&&r.status==='open'){
    const btn=document.createElement('button');btn.className='feed-close-btn';btn.textContent='✓ Close';
    btn.addEventListener('click',async()=>{
      await NX.sb.from('tickets').update({status:'closed'}).eq('id',r.id);
      btn.textContent='Closed';d.style.opacity='0.4';
      if(NX.checkTicketBadge)NX.checkTicketBadge();
    });
    d.querySelector('.feed-content').appendChild(btn);
  }
  return d;
}

function renderTask(r){
  const icon=r.column_name==='done'?'✅':r.column_name==='doing'?'🔄':'📌';
  const due=r.due_date?`<span class="feed-due${new Date(r.due_date)<new Date()?' feed-overdue':''}">Due ${new Date(r.due_date).toLocaleDateString([],{month:'short',day:'numeric'})}</span>`:'';
  return mkCard('task',`<div class="feed-text">${icon} ${r.title||''}</div><div class="feed-who">${(r.column_name||'todo').toUpperCase()} ${r.location?'· '+r.location:''} ${due}</div>`,r.created_at);
}

function renderClock(r){
  const hrs=r.hours?parseFloat(r.hours).toFixed(1)+'h':'active';
  return mkCard('clock',`<div class="feed-text">${r.clock_out?'🔴 Out':'🟢 In'} — ${r.user_name||'?'}</div><div class="feed-who">${r.location||''} · ${hrs}</div>`,r.clock_in);
}

function renderChat(r){
  return mkCard('chat',`<div class="feed-text feed-chat-q">${r.user_name||'?'}: ${(r.question||'').slice(0,120)}${(r.question||'').length>120?'…':''}</div><div class="feed-chat-a" onclick="this.classList.toggle('expanded')">${(r.answer||'').slice(0,200)}${(r.answer||'').length>200?'…':''}</div>`,r.created_at);
}

function renderCleanReport(r){
  const entry=r.entry||'',dateMatch=entry.match(/\d{4}-\d{2}-\d{2}/),isAuto=entry.includes('[AUTO');
  const pcts=[];for(const m of entry.matchAll(/(\w+)\s*.*?(\d+)%/g))pcts.push({name:m[1],pct:parseInt(m[2])});
  const d=document.createElement('div');d.className='feed-item feed-clean';
  d.innerHTML=`<div class="feed-bar" style="background:#39ff14"></div>
    <div class="feed-body">
      <div class="feed-head"><span class="feed-badge feed-badge-clean">🧹</span>${isAuto?'<span class="feed-auto">AUTO</span>':''}<span class="feed-ts">${fmtTime(r.created_at)}</span>
        <button class="feed-edit-btn" title="Edit">✏</button>
      </div>
      <div class="feed-content">
        <div class="feed-text">Cleaning Report ${dateMatch?dateMatch[0]:''}</div>
        <div class="feed-pcts">${pcts.map(p=>{const c=p.pct>=90?'#39ff14':p.pct>=70?'#ffb020':'#ff5533';return`<span class="feed-pct-chip" style="border-color:${c};color:${c}">${p.name} ${p.pct}%</span>`;}).join('')}</div>
        <details class="feed-raw-detail"><summary>Details</summary><pre class="feed-raw-pre">${entry}</pre></details>
      </div>
    </div>`;
  d.querySelector('.feed-edit-btn').addEventListener('click',e=>{
    e.stopPropagation();
    if(dateMatch)NX.editingReport={logId:r.id,date:dateMatch[1]};
    document.querySelector('.nav-tab[data-view="clean"]')?.click();
  });
  addDel(d,r.id,'daily_logs');
  return d;
}

function renderCleanTask(r){
  return mkCard('clean',`<div class="feed-text">✓ ${r.task||'Task completed'}</div><div class="feed-who">${r.completed_by||''} · ${r.location||''}</div>`,r.created_at);
}

function addDel(el,id,table){
  const btn=document.createElement('button');btn.className='log-del';btn.textContent='✕';
  btn.addEventListener('click',async e=>{e.stopPropagation();if(!confirm('Delete?'))return;await NX.sb.from(table).delete().eq('id',id);loadAll();});
  el.querySelector('.feed-body')?.appendChild(btn);
}

async function addLog(){
  const input=document.getElementById('logInput');if(!input.value.trim())return;
  await NX.sb.from('daily_logs').insert({entry:input.value.trim(),user_name:NX.user?.name||''});
  if(NX.toast)NX.toast('Logged ✓','success');input.value='';loadAll();
}

async function addKnowledge(){
  const inp=document.getElementById('knowledgeInput'),btn=document.getElementById('knowledgeBtn');
  const t=inp.value.trim();if(!t)return;btn.disabled=true;btn.textContent='Processing...';
  try{
    const answer=await NX.askClaude('Extract knowledge for restaurant ops (Suerte, Este, Bar Toti — Austin TX). Return ONLY raw JSON: {"nodes":[{"name":"...","category":"equipment|contractors|vendors|procedure|projects|people|systems|parts|location","tags":["..."],"notes":"..."}]}',[{role:'user',content:t}],1000);
    let json=answer.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
    const s=json.indexOf('{'),e=json.lastIndexOf('}');
    if(s!==-1&&e>s){json=json.slice(s,e+1);
      const parsed=JSON.parse(json);
      if(parsed.nodes&&parsed.nodes.length){let created=0;
        const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
        for(const n of parsed.nodes){const nm=(n.name||'').trim();if(!nm||nm.length<2)continue;
          const{error}=await NX.sb.from('nodes').insert({name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'equipment',tags:Array.isArray(n.tags)?n.tags.filter(x=>typeof x==='string').slice(0,20):[],notes:(n.notes||'').slice(0,2000),links:[],access_count:1,source_emails:[]});
          if(!error)created++;}
        inp.value='';btn.textContent=`✓ ${created} node${created!==1?'s':''} added`;
        if(NX.toast)NX.toast(`${created} node${created!==1?'s':''} added to brain ✓`,'success');
        await NX.loadNodes();if(NX.brain)NX.brain.init();
      }else btn.textContent='No knowledge found';
    }else btn.textContent='No data';
  }catch(e){btn.textContent='Error';}
  setTimeout(()=>{btn.disabled=false;btn.textContent='+ Brain';},2500);
}

NX.modules.log={init:()=>{init();if(NX.timeClock)NX.timeClock.setupLogFilters();},show:()=>{loadAll();if(NX.timeClock)NX.timeClock._reloadLog();}};
})();
