/* ═══════════════════════════════════════════
   NEXUS — Admin/Ingest v5
   Trello BATCHED (fixes JSON cutoff),
   Mail monitor (parts + contractor auto-schedule),
   Live activity log.
   ═══════════════════════════════════════════ */
(function(){
let gmailToken=null,gisLoaded=false,tokenClient=null;

function log(msg,type){const el=document.getElementById('ingestLog');if(!el)return;const l=document.createElement('div');l.className='log-line log-'+(type||'info');l.innerHTML=`<span class="log-ts">${new Date().toLocaleTimeString()}</span> ${msg}`;el.appendChild(l);el.scrollTop=el.scrollHeight;if(type==='error')console.error('[NX]',msg);else console.log('[NX]',msg);}
function clearLog(){const el=document.getElementById('ingestLog');if(el)el.innerHTML='';}

async function init(){
  document.getElementById('ingestTextBtn').addEventListener('click',ingestText);
  document.getElementById('trelloBtn').addEventListener('click',trelloImport);
  document.getElementById('gmailConnectBtn').addEventListener('click',connectGmail);
  document.getElementById('gmailSyncBtn')?.addEventListener('click',syncEmails);
  document.getElementById('clearLogBtn')?.addEventListener('click',clearLog);
  document.getElementById('mailMonitorBtn')?.addEventListener('click',mailMonitor);
  loadGoogleAuth();
  const s=localStorage.getItem('nexus_gmail_token');
  if(s){try{const p=JSON.parse(s);if(p.expiry>Date.now()){gmailToken=p.token;showGmailConnected();}else localStorage.removeItem('nexus_gmail_token');}catch(e){}}
  updateStats();
}

// ═══ GOOGLE AUTH ═══
function loadGoogleAuth(){const c=NX.getGoogleClientId();if(!c)return;if(!document.querySelector('script[src*="accounts.google.com/gsi/client"]')){const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=()=>initTokenClient();document.head.appendChild(s);}else initTokenClient();}
function initTokenClient(){const c=NX.getGoogleClientId();if(!c||!window.google?.accounts?.oauth2)return;gisLoaded=true;tokenClient=google.accounts.oauth2.initTokenClient({client_id:c,scope:'https://www.googleapis.com/auth/gmail.readonly',callback:r=>{if(r.access_token){gmailToken=r.access_token;localStorage.setItem('nexus_gmail_token',JSON.stringify({token:r.access_token,expiry:Date.now()+55*60*1000}));showGmailConnected();log('Gmail connected ✓','success');}}});}
function connectGmail(){const c=NX.getGoogleClientId();if(!c){log('No Google Client ID. Open Admin ⚙.','error');return;}if(!gisLoaded){loadGoogleAuth();setTimeout(connectGmail,1000);return;}if(tokenClient)tokenClient.requestAccessToken();}
function showGmailConnected(){document.getElementById('gmailStatusText').textContent='✓ Connected';document.getElementById('gmailStatusText').style.color='var(--green)';document.getElementById('gmailConnectBtn').textContent='Reconnect';document.getElementById('gmailSyncControls').style.display='block';}

// ═══ GMAIL SYNC ═══
async function syncEmails(){if(!gmailToken){connectGmail();return;}const btn=document.getElementById('gmailSyncBtn'),pf=document.getElementById('gmailProgressFill'),pt=document.getElementById('gmailProgressText');document.getElementById('gmailProgress').style.display='flex';btn.disabled=true;btn.textContent='Syncing...';clearLog();log('Starting email sync...');
const dv=document.getElementById('gmailDays').value,fl=document.getElementById('gmailFilter').value.trim();let q='';if(dv!=='all'){const a=new Date();a.setDate(a.getDate()-parseInt(dv));q=`after:${a.getFullYear()}/${a.getMonth()+1}/${a.getDate()}`;}if(fl)q+=(q?' ':'')+fl;
try{let ids=[],npt=null;do{const u=new URL('https://www.googleapis.com/gmail/v1/users/me/messages');u.searchParams.set('maxResults','500');if(q)u.searchParams.set('q',q);if(npt)u.searchParams.set('pageToken',npt);const r=await fetch(u,{headers:{'Authorization':`Bearer ${gmailToken}`}});if(r.status===401){localStorage.removeItem('nexus_gmail_token');gmailToken=null;log('Token expired.','error');btn.disabled=false;btn.textContent='⚡ Sync';return;}const d=await r.json();if(d.messages)ids.push(...d.messages.map(m=>m.id));npt=d.nextPageToken;log(`${ids.length} email IDs...`);}while(npt);
if(!ids.length){log('No emails found.','warn');btn.disabled=false;btn.textContent='⚡ Sync';return;}log(`<b>${ids.length} emails found.</b> Pulling...`,'success');
let all=[];for(let i=0;i<ids.length;i+=10){const b=ids.slice(i,i+10);pf.style.width=Math.round(i/ids.length*40)+'%';pt.textContent=`${i}/${ids.length}`;const fs=b.map(id=>fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,{headers:{'Authorization':`Bearer ${gmailToken}`}}).then(r=>r.json()).catch(()=>null));const rs=await Promise.all(fs);rs.forEach(m=>{if(!m||!m.payload)return;const h=m.payload.headers||[],g=n=>(h.find(x=>x.name.toLowerCase()===n.toLowerCase())||{}).value||'';all.push(`FROM: ${g('From')}\nTO: ${g('To')}\nDATE: ${g('Date')}\nSUBJECT: ${g('Subject')}\n${m.snippet||''}`);});if(i+10<ids.length)await sleep(150);}
log(`Pulled <b>${all.length}</b> emails. AI processing...`);
let tn=0,te=0;const AB=15,tb=Math.ceil(all.length/AB);for(let i=0;i<all.length;i+=AB){const bn=Math.floor(i/AB)+1;pf.style.width=(40+Math.round(i/all.length*55))+'%';pt.textContent=`AI ${bn}/${tb}`;log(`AI batch ${bn}/${tb}...`);const r=await aiProcess(all.slice(i,i+AB).join('\n\n---EMAIL---\n\n'));if(r){const s=await saveExtracted(r);tn+=s;log(`Batch ${bn}: <b>${s} nodes</b>`,'success');}else{te++;log(`Batch ${bn}: no data`,'warn');}if(i+AB<all.length)await sleep(500);}
pf.style.width='100%';pt.textContent='Done!';log(`<b>Complete: ${tn} new nodes</b> from ${all.length} emails.`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}catch(e){log('FATAL: '+e.message,'error');}btn.disabled=false;btn.textContent='⚡ Sync Emails → Brain';}

// ═══ MAIL MONITOR (parts orders + contractor scheduling) ═══
async function mailMonitor(){
  if(!gmailToken){log('Connect Gmail first.','error');return;}
  const btn=document.getElementById('mailMonitorBtn');
  btn.disabled=true;btn.textContent='Scanning...';clearLog();
  log('Scanning for parts orders and contractor scheduling...');

  try{
    // Search for order/shipping/invoice emails in last 30 days
    const after=new Date();after.setDate(after.getDate()-30);
    const dateQ=`after:${after.getFullYear()}/${after.getMonth()+1}/${after.getDate()}`;
    const queries=[
      `${dateQ} (subject:order OR subject:shipped OR subject:tracking OR subject:invoice OR subject:confirmation)`,
      `${dateQ} (subject:scheduled OR subject:appointment OR "coming by" OR "visit on" OR "service call")`
    ];

    let allText=[];
    for(const q of queries){
      const u=new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
      u.searchParams.set('maxResults','50');u.searchParams.set('q',q);
      const r=await fetch(u,{headers:{'Authorization':`Bearer ${gmailToken}`}});
      const d=await r.json();
      if(!d.messages){log(`Query "${q.slice(0,40)}..." → 0 results`);continue;}
      log(`Found ${d.messages.length} emails for "${q.includes('order')?'orders/shipping':'scheduling'}"`);
      for(const m of d.messages.slice(0,30)){
        try{const mr=await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,{headers:{'Authorization':`Bearer ${gmailToken}`}});const md=await mr.json();if(!md.payload)continue;const h=md.payload.headers||[],g=n=>(h.find(x=>x.name.toLowerCase()===n.toLowerCase())||{}).value||'';allText.push(`FROM: ${g('From')}\nDATE: ${g('Date')}\nSUBJECT: ${g('Subject')}\n${md.snippet||''}`);}catch(e){}
      }
      await sleep(200);
    }

    if(!allText.length){log('No order/scheduling emails found.','warn');btn.disabled=false;btn.textContent='🔍 Scan for Orders & Scheduling';return;}
    log(`Processing ${allText.length} emails through AI...`);

    // Process with a specialized prompt
    const answer=await NX.askClaude(
      `You extract two things from these restaurant operations emails:

1. PARTS/ORDERS: Any order confirmations, shipping notices, invoices, or parts purchases. Create a node for the vendor + a kanban card.
2. CONTRACTOR SCHEDULING: Any mentions of contractors coming by, scheduled visits, service calls, appointments. Create an event.

Return ONLY raw JSON:
{"nodes":[{"name":"...","category":"vendors|contractors|equipment","tags":["..."],"notes":"Order #, tracking, date, etc"}],"cards":[{"title":"...","column_name":"in_progress"}],"events":[{"contractor_name":"...","description":"...","event_date":"YYYY-MM-DD","event_time":"HH:MM","location":"suerte|este|toti"}]}`,
      [{role:'user',content:allText.join('\n\n---EMAIL---\n\n').slice(0,14000)}],3000);

    let json=answer.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
    const s=json.indexOf('{'),e=json.lastIndexOf('}');
    if(s===-1||e===-1){log('AI returned no valid JSON.','warn');btn.disabled=false;btn.textContent='🔍 Scan for Orders & Scheduling';return;}
    json=json.slice(s,e+1);
    try{
      const parsed=JSON.parse(json);
      // Save nodes
      if(parsed.nodes&&parsed.nodes.length){const saved=await saveExtracted(parsed);log(`<b>${saved} nodes</b> from orders/scheduling`,'success');}
      // Save events
      if(parsed.events&&parsed.events.length){let ec=0;for(const ev of parsed.events){if(!ev.contractor_name||!ev.event_date)continue;try{await NX.sb.from('contractor_events').insert({contractor_name:ev.contractor_name,description:ev.description||'',event_date:ev.event_date,event_time:ev.event_time||null,location:ev.location||'suerte',status:'scheduled'});ec++;}catch(err){log(`Event insert failed: ${err.message}`,'error');}}log(`<b>${ec} contractor events</b> auto-scheduled`,'success');}
      await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();
    }catch(pe){log('JSON parse failed: '+pe.message,'error');}
  }catch(err){log('Mail monitor error: '+err.message,'error');}
  btn.disabled=false;btn.textContent='🔍 Scan for Orders & Scheduling';
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

// ═══ AI PROCESSING ═══
async function aiProcess(text){
  try{const a=await NX.askClaude(`You extract knowledge for a restaurant ops system (Suerte, Este, Bar Toti — Austin TX). Create a node for each person, business, equipment, procedure, project, phone number, or invoice.
Categories: equipment, contractors, vendors, procedure, projects, people, systems, parts, location
RESPOND WITH ONLY RAW JSON:
{"nodes":[{"name":"...","category":"...","tags":["..."],"notes":"..."}],"cards":[{"title":"...","column_name":"todo"}]}`,[{role:'user',content:text.slice(0,14000)}],3000);
  let j=a.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=j.indexOf('{'),e=j.lastIndexOf('}');if(s===-1||e<=s){log('No JSON in AI response','warn');return null;}j=j.slice(s,e+1);
  try{const p=JSON.parse(j);if(p.nodes&&Array.isArray(p.nodes))return p;return null;}catch(pe){log('JSON parse: '+pe.message,'error');return null;}}catch(e){log('AI error: '+e.message,'error');return null;}}

// ═══ SAVE EXTRACTED ═══
async function saveExtracted(r){if(!r||!r.nodes||!r.nodes.length)return 0;let c=0,er=0;
let ex=new Set(NX.nodes.map(n=>(n.name||'').toLowerCase()));try{const{data}=await NX.sb.from('nodes').select('name');if(data)data.forEach(n=>ex.add((n.name||'').toLowerCase()));}catch(e){}
const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
for(const n of r.nodes){const nm=(n.name||'').trim();if(!nm||nm.length<2||ex.has(nm.toLowerCase()))continue;
const{error}=await NX.sb.from('nodes').insert({name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'equipment',tags:Array.isArray(n.tags)?n.tags.filter(t=>typeof t==='string').slice(0,20):[],notes:(n.notes||'').slice(0,2000),links:[],access_count:1});
if(error){er++;if(er<=3)log(`Insert failed "${nm}": ${error.message}`,'error');}else{ex.add(nm.toLowerCase());c++;}}
if(r.cards)for(const x of r.cards){if(!x.title)continue;const{error}=await NX.sb.from('kanban_cards').insert({title:(x.title||'').slice(0,200),column_name:x.column_name||'todo'});if(error)log(`Card failed: ${error.message}`,'error');}
if(er)log(`${er} inserts failed — check schema`,'error');return c;}

// ═══ TRELLO (BATCHED — fixes JSON cutoff) ═══
async function trelloImport(){const tk=NX.getTrelloKey(),tt=NX.getTrelloToken();if(!tk||!tt){log('No Trello keys. Open Admin ⚙.','error');return;}
const btn=document.getElementById('trelloBtn');btn.disabled=true;btn.textContent='Pulling...';clearLog();log('Connecting to Trello...');
try{const r=await fetch(`https://api.trello.com/1/members/me/boards?key=${tk}&token=${tt}`);if(!r.ok){log(`Trello API: ${r.status}`,'error');btn.disabled=false;btn.textContent='🔄 Trello';return;}
const boards=await r.json();log(`Found <b>${boards.length} boards</b>`);
let allCards=[];
for(const board of boards){log(`Board: ${board.name}...`);const cr=await fetch(`https://api.trello.com/1/boards/${board.id}/cards?key=${tk}&token=${tt}`);const cards=await cr.json();if(!Array.isArray(cards))continue;
cards.forEach(c=>{allCards.push(`[${board.name}] [${c.closed?'DONE':'OPEN'}] ${c.name}${c.desc?' | '+c.desc.slice(0,150):''}${c.due?' | Due:'+c.due.split('T')[0]:''}`);});}
log(`<b>${allCards.length} total cards</b>. Processing in batches...`,'success');

// BATCH cards through AI (40 at a time to avoid token cutoff)
const BATCH=40;let tn=0;const tb=Math.ceil(allCards.length/BATCH);
for(let i=0;i<allCards.length;i+=BATCH){const bn=Math.floor(i/BATCH)+1;log(`AI batch ${bn}/${tb}...`);
const chunk='TRELLO CARDS:\n'+allCards.slice(i,i+BATCH).join('\n');
const r2=await aiProcess(chunk);if(r2){const s=await saveExtracted(r2);tn+=s;log(`Batch ${bn}: <b>${s} nodes</b>`,'success');}else{log(`Batch ${bn}: no data`,'warn');}
if(i+BATCH<allCards.length)await sleep(500);}
log(`<b>Trello complete: ${tn} new nodes</b>`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}catch(e){log('Trello error: '+e.message,'error');}
btn.disabled=false;btn.textContent='🔄 Smart Trello Import';}

// ═══ PASTE TEXT ═══
async function ingestText(){const t=document.getElementById('ingestText').value.trim();if(!t)return;const b=document.getElementById('ingestTextBtn');b.disabled=true;b.textContent='...';clearLog();log('Processing text ('+t.length+' chars)...');const r=await aiProcess(t);if(r){log(`AI extracted ${r.nodes.length} nodes`);const s=await saveExtracted(r);log(`<b>${s} new nodes</b>`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}else log('No data extracted.','warn');b.disabled=false;b.textContent='⚡ Process';document.getElementById('ingestText').value='';}

// ═══ STATS ═══
function updateStats(){const el=document.getElementById('ingestStats');if(!el)return;const t=NX.nodes.length,c={};NX.nodes.forEach(n=>{c[n.category]=(c[n.category]||0)+1;});el.innerHTML=`<div class="stat-total">${t} total nodes</div><div class="stat-chips">${Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="stat-chip">${k} <b>${v}</b></span>`).join('')}</div>`;}

NX.modules.ingest={init,show:()=>{updateStats();}};
})();
