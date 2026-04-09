/* ═══════════════════════════════════════════
   NEXUS — Admin/Ingest v5.1
   SOURCE CITATIONS: every node tagged with
   the email(s) it came from. Trello batched.
   Mail monitor. Live log.
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
function loadGoogleAuth(){const c=NX.getGoogleClientId();if(!c)return;if(!document.querySelector('script[src*="accounts.google.com/gsi/client"]')){const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=()=>initTC();document.head.appendChild(s);}else initTC();}
function initTC(){const c=NX.getGoogleClientId();if(!c||!window.google?.accounts?.oauth2)return;gisLoaded=true;tokenClient=google.accounts.oauth2.initTokenClient({client_id:c,scope:'https://www.googleapis.com/auth/gmail.readonly',callback:r=>{if(r.access_token){gmailToken=r.access_token;localStorage.setItem('nexus_gmail_token',JSON.stringify({token:r.access_token,expiry:Date.now()+55*60*1000}));showGmailConnected();log('Gmail connected ✓','success');}}});}
function connectGmail(){const c=NX.getGoogleClientId();if(!c){log('No Google Client ID. Open Admin ⚙.','error');return;}if(!gisLoaded){loadGoogleAuth();setTimeout(connectGmail,1000);return;}if(tokenClient)tokenClient.requestAccessToken();}
function showGmailConnected(){document.getElementById('gmailStatusText').textContent='✓ Connected';document.getElementById('gmailStatusText').style.color='var(--green)';document.getElementById('gmailConnectBtn').textContent='Reconnect';document.getElementById('gmailSyncControls').style.display='block';}

// ═══ GMAIL SYNC (with source tracking) ═══
async function syncEmails(){if(!gmailToken){connectGmail();return;}const btn=document.getElementById('gmailSyncBtn'),pf=document.getElementById('gmailProgressFill'),pt=document.getElementById('gmailProgressText');document.getElementById('gmailProgress').style.display='flex';btn.disabled=true;btn.textContent='Syncing...';clearLog();log('Starting email sync with source tracking...');
const dv=document.getElementById('gmailDays').value,fl=document.getElementById('gmailFilter').value.trim();let q='';if(dv!=='all'){const a=new Date();a.setDate(a.getDate()-parseInt(dv));q=`after:${a.getFullYear()}/${a.getMonth()+1}/${a.getDate()}`;}if(fl)q+=(q?' ':'')+fl;
try{let ids=[],npt=null;do{const u=new URL('https://www.googleapis.com/gmail/v1/users/me/messages');u.searchParams.set('maxResults','500');if(q)u.searchParams.set('q',q);if(npt)u.searchParams.set('pageToken',npt);const r=await fetch(u,{headers:{'Authorization':`Bearer ${gmailToken}`}});if(r.status===401){localStorage.removeItem('nexus_gmail_token');gmailToken=null;log('Token expired.','error');btn.disabled=false;btn.textContent='⚡ Sync';return;}const d=await r.json();if(d.messages)ids.push(...d.messages.map(m=>m.id));npt=d.nextPageToken;log(`${ids.length} IDs...`);}while(npt);
if(!ids.length){log('No emails found.','warn');btn.disabled=false;btn.textContent='⚡ Sync';return;}log(`<b>${ids.length} emails.</b> Pulling...`,'success');

// Pull emails WITH source metadata
let allEmails=[];
for(let i=0;i<ids.length;i+=10){const b=ids.slice(i,i+10);pf.style.width=Math.round(i/ids.length*40)+'%';pt.textContent=`${i}/${ids.length}`;
const fs=b.map(id=>fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,{headers:{'Authorization':`Bearer ${gmailToken}`}}).then(r=>r.json()).catch(()=>null));
const rs=await Promise.all(fs);rs.forEach(m=>{if(!m||!m.payload)return;const h=m.payload.headers||[],g=n=>(h.find(x=>x.name.toLowerCase()===n.toLowerCase())||{}).value||'';
allEmails.push({from:g('From'),to:g('To'),date:g('Date'),subject:g('Subject'),snippet:m.snippet||''});});
if(i+10<ids.length)await sleep(150);}
log(`Pulled <b>${allEmails.length}</b> emails. AI processing with source tracking...`);

// Process in batches — each email tagged so AI can reference it
const AB=12;let tn=0,te=0;const tb=Math.ceil(allEmails.length/AB);
for(let i=0;i<allEmails.length;i+=AB){const bn=Math.floor(i/AB)+1;pf.style.width=(40+Math.round(i/allEmails.length*55))+'%';pt.textContent=`AI ${bn}/${tb}`;log(`AI batch ${bn}/${tb}...`);
// Format emails with reference numbers
const chunk=allEmails.slice(i,i+AB).map((e,idx)=>`[EMAIL #${i+idx+1}] FROM: ${e.from} | DATE: ${e.date} | SUBJECT: ${e.subject}\n${e.snippet}`).join('\n\n');
const sourceMap=allEmails.slice(i,i+AB).map((e,idx)=>({ref:i+idx+1,from:e.from,date:e.date,subject:e.subject}));
const r=await aiProcessWithSources(chunk,sourceMap);if(r){const s=await saveExtracted(r);tn+=s;log(`Batch ${bn}: <b>${s} nodes</b> with sources`,'success');}else{te++;log(`Batch ${bn}: no data`,'warn');}
if(i+AB<allEmails.length)await sleep(500);}
pf.style.width='100%';pt.textContent='Done!';log(`<b>Complete: ${tn} nodes</b> from ${allEmails.length} emails.`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}catch(e){log('FATAL: '+e.message,'error');}btn.disabled=false;btn.textContent='⚡ Sync Emails → Brain';}

// ═══ AI PROCESSING WITH SOURCE REFERENCES ═══
async function aiProcessWithSources(text,sourceMap){
  try{const a=await NX.askClaude(
    `You extract knowledge for restaurant ops (Suerte, Este, Bar Toti — Austin TX).
Each email is labeled [EMAIL #N]. For each node you create, include which email(s) it came from.

Create nodes for: people, businesses, equipment, procedures, projects, parts orders, invoices, phone numbers, scheduling.

RESPOND WITH ONLY RAW JSON:
{"nodes":[{"name":"...","category":"...","tags":["..."],"notes":"...","email_refs":[1,3]}],"cards":[{"title":"...","column_name":"todo"}]}

email_refs = array of email numbers that this info came from. This is CRITICAL — every node MUST cite its source.`,
    [{role:'user',content:text.slice(0,14000)}],3000);
  let j=a.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=j.indexOf('{'),e=j.lastIndexOf('}');if(s===-1||e<=s){log('No JSON','warn');return null;}j=j.slice(s,e+1);
  try{const p=JSON.parse(j);if(!p.nodes||!Array.isArray(p.nodes))return null;
    // Attach full source email data to each node
    p.nodes.forEach(n=>{
      if(n.email_refs&&Array.isArray(n.email_refs)&&sourceMap){
        n.source_emails=n.email_refs.map(ref=>{
          const src=sourceMap.find(s=>s.ref===ref);
          return src?{from:src.from,subject:src.subject,date:src.date}:null;
        }).filter(Boolean);
      }else{n.source_emails=[];}
    });
    return p;}catch(pe){log('JSON parse: '+pe.message,'error');return null;}}catch(e){log('AI: '+e.message,'error');return null;}}

// Plain AI process (for paste/trello)
async function aiProcess(text){
  try{const a=await NX.askClaude(`Extract knowledge for restaurant ops (Suerte, Este, Bar Toti — Austin TX). Create nodes for every entity.
Categories: equipment, contractors, vendors, procedure, projects, people, systems, parts, location
RESPOND ONLY RAW JSON:
{"nodes":[{"name":"...","category":"...","tags":["..."],"notes":"..."}],"cards":[{"title":"...","column_name":"todo"}]}`,[{role:'user',content:text.slice(0,14000)}],3000);
  let j=a.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=j.indexOf('{'),e=j.lastIndexOf('}');if(s===-1||e<=s)return null;j=j.slice(s,e+1);
  try{const p=JSON.parse(j);return(p.nodes&&Array.isArray(p.nodes))?p:null;}catch(e){log('JSON: '+e.message,'error');return null;}}catch(e){log('AI: '+e.message,'error');return null;}}

// ═══ SAVE (with source_emails column) ═══
async function saveExtracted(r){if(!r||!r.nodes||!r.nodes.length)return 0;let c=0,er=0;
let ex=new Set(NX.nodes.map(n=>(n.name||'').toLowerCase()));try{const{data}=await NX.sb.from('nodes').select('name');if(data)data.forEach(n=>ex.add((n.name||'').toLowerCase()));}catch(e){}
const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
for(const n of r.nodes){const nm=(n.name||'').trim();if(!nm||nm.length<2||ex.has(nm.toLowerCase()))continue;
const row={name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'equipment',tags:Array.isArray(n.tags)?n.tags.filter(t=>typeof t==='string').slice(0,20):[],notes:(n.notes||'').slice(0,2000),links:[],access_count:1,source_emails:n.source_emails||[]};
const{error}=await NX.sb.from('nodes').insert(row);if(error){er++;if(er<=3)log(`Insert "${nm}": ${error.message}`,'error');}else{ex.add(nm.toLowerCase());c++;}}
if(r.cards)for(const x of r.cards){if(!x.title)continue;await NX.sb.from('kanban_cards').insert({title:(x.title||'').slice(0,200),column_name:x.column_name||'todo'}).catch(()=>{});}
if(er)log(`${er} inserts failed`,'error');return c;}

// ═══ MAIL MONITOR ═══
async function mailMonitor(){if(!gmailToken){log('Connect Gmail first.','error');return;}const btn=document.getElementById('mailMonitorBtn');btn.disabled=true;btn.textContent='Scanning...';clearLog();log('Scanning for orders & scheduling...');
try{const after=new Date();after.setDate(after.getDate()-30);const dq=`after:${after.getFullYear()}/${after.getMonth()+1}/${after.getDate()}`;
const queries=[`${dq} (subject:order OR subject:shipped OR subject:tracking OR subject:invoice)`,`${dq} (subject:scheduled OR subject:appointment OR "coming by" OR "service call")`];
let allText=[];for(const q of queries){const u=new URL('https://www.googleapis.com/gmail/v1/users/me/messages');u.searchParams.set('maxResults','50');u.searchParams.set('q',q);const r=await fetch(u,{headers:{'Authorization':`Bearer ${gmailToken}`}});const d=await r.json();if(!d.messages)continue;log(`${d.messages.length} emails for "${q.includes('order')?'orders':'scheduling'}"`);
for(const m of d.messages.slice(0,30)){try{const mr=await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,{headers:{'Authorization':`Bearer ${gmailToken}`}});const md=await mr.json();if(!md.payload)continue;const h=md.payload.headers||[],g=n=>(h.find(x=>x.name.toLowerCase()===n.toLowerCase())||{}).value||'';allText.push({text:`FROM: ${g('From')}\nDATE: ${g('Date')}\nSUBJECT: ${g('Subject')}\n${md.snippet||''}`,from:g('From'),date:g('Date'),subject:g('Subject')});}catch(e){}}await sleep(200);}
if(!allText.length){log('No order/scheduling emails.','warn');btn.disabled=false;btn.textContent='🔍 Scan';return;}log(`Processing ${allText.length} emails...`);
const answer=await NX.askClaude(`Extract from restaurant ops emails:
1. PARTS/ORDERS: order confirmations, shipping, invoices. Create vendor node + kanban card.
2. CONTRACTOR SCHEDULING: visits, appointments, service calls. Create an event.
For each node, note which email it's from.
Return ONLY raw JSON:
{"nodes":[{"name":"...","category":"...","tags":["..."],"notes":"Include order #, tracking, source email from/subject/date"}],"cards":[{"title":"...","column_name":"in_progress"}],"events":[{"contractor_name":"...","description":"...","event_date":"YYYY-MM-DD","event_time":"HH:MM","location":"suerte|este|toti"}]}`,[{role:'user',content:allText.map(e=>e.text).join('\n\n---\n\n').slice(0,14000)}],3000);
let json=answer.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=json.indexOf('{'),e=json.lastIndexOf('}');
if(s!==-1&&e>s){json=json.slice(s,e+1);try{const p=JSON.parse(json);
// Attach source info to nodes
if(p.nodes)p.nodes.forEach(n=>{n.source_emails=[{from:allText[0]?.from||'',subject:'Mail Monitor scan',date:new Date().toISOString().split('T')[0]}];});
if(p.nodes?.length){const saved=await saveExtracted(p);log(`<b>${saved} nodes</b> from orders/scheduling`,'success');}
if(p.events?.length){let ec=0;for(const ev of p.events){if(!ev.contractor_name||!ev.event_date)continue;try{await NX.sb.from('contractor_events').insert({contractor_name:ev.contractor_name,description:ev.description||'',event_date:ev.event_date,event_time:ev.event_time||null,location:ev.location||'suerte',status:'scheduled'});ec++;}catch(err){}}log(`<b>${ec} events</b> auto-scheduled`,'success');}
await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}catch(pe){log('Parse: '+pe.message,'error');}}else log('No JSON from AI.','warn');
}catch(err){log('Error: '+err.message,'error');}btn.disabled=false;btn.textContent='🔍 Scan for Orders & Scheduling';}

// ═══ TRELLO (BATCHED) ═══
async function trelloImport(){const tk=NX.getTrelloKey(),tt=NX.getTrelloToken();if(!tk||!tt){log('No Trello keys.','error');return;}const btn=document.getElementById('trelloBtn');btn.disabled=true;btn.textContent='Pulling...';clearLog();log('Connecting to Trello...');
try{const r=await fetch(`https://api.trello.com/1/members/me/boards?key=${tk}&token=${tt}`);if(!r.ok){log(`Trello: ${r.status}`,'error');btn.disabled=false;btn.textContent='🔄 Trello';return;}const boards=await r.json();log(`<b>${boards.length} boards</b>`);let allCards=[];
for(const board of boards){log(`Board: ${board.name}...`);const cr=await fetch(`https://api.trello.com/1/boards/${board.id}/cards?key=${tk}&token=${tt}`);const cards=await cr.json();if(!Array.isArray(cards))continue;cards.forEach(c=>{allCards.push(`[${board.name}] [${c.closed?'DONE':'OPEN'}] ${c.name}${c.desc?' | '+c.desc.slice(0,150):''}${c.due?' | Due:'+c.due.split('T')[0]:''}`);});}
log(`<b>${allCards.length} cards</b>. Batching...`,'success');const B=40;let tn=0;
for(let i=0;i<allCards.length;i+=B){const bn=Math.floor(i/B)+1;log(`AI batch ${bn}/${Math.ceil(allCards.length/B)}...`);const r2=await aiProcess('TRELLO:\n'+allCards.slice(i,i+B).join('\n'));if(r2){const s=await saveExtracted(r2);tn+=s;log(`Batch ${bn}: <b>${s} nodes</b>`,'success');}else log(`Batch ${bn}: no data`,'warn');if(i+B<allCards.length)await sleep(500);}
log(`<b>Trello: ${tn} nodes</b>`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}catch(e){log('Error: '+e.message,'error');}btn.disabled=false;btn.textContent='🔄 Smart Trello Import';}

// ═══ PASTE ═══
async function ingestText(){const t=document.getElementById('ingestText').value.trim();if(!t)return;const b=document.getElementById('ingestTextBtn');b.disabled=true;b.textContent='...';clearLog();log('Processing ('+t.length+' chars)...');const r=await aiProcess(t);if(r){const s=await saveExtracted(r);log(`<b>${s} nodes</b>`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}else log('No data.','warn');b.disabled=false;b.textContent='⚡ Process';document.getElementById('ingestText').value='';}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function updateStats(){const el=document.getElementById('ingestStats');if(!el)return;const t=NX.nodes.length,c={};NX.nodes.forEach(n=>{c[n.category]=(c[n.category]||0)+1;});el.innerHTML=`<div class="stat-total">${t} nodes in brain</div><div class="stat-chips">${Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="stat-chip">${k} <b>${v}</b></span>`).join('')}</div>`;}
NX.modules.ingest={init,show:()=>{updateStats();}};
})();
