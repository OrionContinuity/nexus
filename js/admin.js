/* ═══════════════════════════════════════════
   NEXUS Admin/Ingest v7 — 3-LAYER DEDUP
   Layer 1: Track processed Gmail/Trello IDs
   Layer 2: Fuzzy name matching on insert
   Layer 3: Existing nodes fed to AI prompt
   ═══════════════════════════════════════════ */
(function(){
let gmailToken=null,gisLoaded=false,tokenClient=null;

// ═══ LAYER 1: Processed ID tracking ═══
// Stores IDs of already-processed emails/cards so re-runs skip them
let processedIds=new Set();
async function loadProcessedIds(){
  try{const{data}=await NX.sb.from('processed_ids').select('external_id');
    if(data)data.forEach(r=>processedIds.add(r.external_id));
  }catch(e){
    // Table might not exist yet — use localStorage fallback
    try{const s=localStorage.getItem('nexus_processed_ids');if(s)processedIds=new Set(JSON.parse(s));}catch(e2){}
  }
}
async function markProcessed(source,ids){
  ids.forEach(id=>processedIds.add(id));
  // Save to Supabase
  const rows=ids.map(id=>({source,external_id:id}));
  try{await NX.sb.from('processed_ids').insert(rows);}catch(e){}
  // Also save to localStorage as backup
  try{localStorage.setItem('nexus_processed_ids',JSON.stringify([...processedIds]));}catch(e){}
}

// ═══ LAYER 2: Fuzzy name matching ═══
function isFuzzyDuplicate(newName,existingNames){
  const nl=newName.toLowerCase().trim();
  if(nl.length<2)return true;
  for(const ex of existingNames){
    // Exact match
    if(nl===ex)return true;
    // One is substring of the other (catches "Tyler" vs "Tyler Maffi")
    if(nl.length>3&&ex.length>3){
      if(nl.includes(ex)||ex.includes(nl))return true;
    }
    // Very short names must be exact
    if(nl.length<=3||ex.length<=3)continue;
    // Same first word + similar length (catches "Parts Town" vs "Parts Town Inc")
    const nw=nl.split(/\s+/),ew=ex.split(/\s+/);
    if(nw[0]===ew[0]&&nw[0].length>3&&Math.abs(nl.length-ex.length)<6)return true;
  }
  return false;
}

// ═══ LAYER 3: Build existing node context for AI ═══
function getExistingNodeList(){
  const names=NX.nodes.map(n=>n.name).filter(Boolean);
  if(!names.length)return'';
  return`\n\nALREADY IN THE BRAIN (do NOT create duplicates of these):\n${names.join(', ')}`;
}

function log(msg,type){const el=document.getElementById('ingestLog');if(!el)return;const l=document.createElement('div');l.className='log-line log-'+(type||'info');l.innerHTML=`<span class="log-ts">${new Date().toLocaleTimeString()}</span> ${msg}`;el.appendChild(l);el.scrollTop=el.scrollHeight;if(type==='error')console.error('[NX]',msg);else console.log('[NX]',msg);}
function clearLog(){const el=document.getElementById('ingestLog');if(el)el.innerHTML='';}

async function init(){
  document.getElementById('ingestTextBtn').addEventListener('click',ingestText);
  document.getElementById('trelloBtn').addEventListener('click',trelloImport);
  document.getElementById('gmailConnectBtn').addEventListener('click',connectGmail);
  document.getElementById('gmailSyncBtn')?.addEventListener('click',syncEmails);
  document.getElementById('clearLogBtn')?.addEventListener('click',clearLog);
  document.getElementById('mailMonitorBtn')?.addEventListener('click',mailMonitor);
  document.getElementById('sensitiveBtn')?.addEventListener('click',scanSensitive);
  loadGoogleAuth();
  await loadProcessedIds();
  const s=localStorage.getItem('nexus_gmail_token');
  if(s){try{const p=JSON.parse(s);if(p.expiry>Date.now()){gmailToken=p.token;showGmailConnected();}else localStorage.removeItem('nexus_gmail_token');}catch(e){}}
  updateStats();
}

// ═══ GOOGLE AUTH ═══
function loadGoogleAuth(){const c=NX.getGoogleClientId();if(!c)return;if(!document.querySelector('script[src*="accounts.google.com/gsi/client"]')){const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=()=>initTC();document.head.appendChild(s);}else initTC();}
function initTC(){const c=NX.getGoogleClientId();if(!c||!window.google?.accounts?.oauth2)return;gisLoaded=true;tokenClient=google.accounts.oauth2.initTokenClient({client_id:c,scope:'https://www.googleapis.com/auth/gmail.readonly',callback:r=>{if(r.access_token){gmailToken=r.access_token;localStorage.setItem('nexus_gmail_token',JSON.stringify({token:r.access_token,expiry:Date.now()+55*60*1000}));showGmailConnected();log('Gmail connected ✓','success');}}});}
function connectGmail(){const c=NX.getGoogleClientId();if(!c){log('No Google Client ID. Open Admin ⚙.','error');return;}if(!gisLoaded){loadGoogleAuth();setTimeout(connectGmail,1000);return;}if(tokenClient)tokenClient.requestAccessToken();}
function showGmailConnected(){document.getElementById('gmailStatusText').textContent='✓ Connected';document.getElementById('gmailStatusText').style.color='var(--green)';document.getElementById('gmailConnectBtn').textContent='Reconnect';document.getElementById('gmailSyncControls').style.display='block';}

// ═══ GMAIL SYNC (with dedup layer 1) ═══
async function syncEmails(){if(!gmailToken){connectGmail();return;}const btn=document.getElementById('gmailSyncBtn'),pf=document.getElementById('gmailProgressFill'),pt=document.getElementById('gmailProgressText');document.getElementById('gmailProgress').style.display='flex';btn.disabled=true;btn.textContent='Syncing...';clearLog();log('Starting email sync...');
const dv=document.getElementById('gmailDays').value,fl=document.getElementById('gmailFilter').value.trim();let q='';if(dv!=='all'){const a=new Date();a.setDate(a.getDate()-parseInt(dv));q=`after:${a.getFullYear()}/${a.getMonth()+1}/${a.getDate()}`;}if(fl)q+=(q?' ':'')+fl;
try{let ids=[],npt=null;do{const u=new URL('https://www.googleapis.com/gmail/v1/users/me/messages');u.searchParams.set('maxResults','500');if(q)u.searchParams.set('q',q);if(npt)u.searchParams.set('pageToken',npt);const r=await fetch(u,{headers:{'Authorization':`Bearer ${gmailToken}`}});if(r.status===401){localStorage.removeItem('nexus_gmail_token');gmailToken=null;log('Token expired.','error');btn.disabled=false;btn.textContent='⚡ Sync';return;}const d=await r.json();if(d.messages)ids.push(...d.messages.map(m=>m.id));npt=d.nextPageToken;log(`${ids.length} IDs...`);}while(npt);
if(!ids.length){log('No emails found.','warn');btn.disabled=false;btn.textContent='⚡ Sync';return;}

// LAYER 1: Filter out already-processed emails
const newIds=ids.filter(id=>!processedIds.has(id));
const skipped=ids.length-newIds.length;
if(skipped)log(`Skipping ${skipped} already-processed emails`);
if(!newIds.length){log('All emails already processed. Nothing new.','success');btn.disabled=false;btn.textContent='⚡ Sync';pf.style.width='100%';return;}
log(`<b>${newIds.length} new emails</b> to process.`,'success');

let allEmails=[];
for(let i=0;i<newIds.length;i+=5){const b=newIds.slice(i,i+5);pf.style.width=Math.round(i/newIds.length*40)+'%';pt.textContent=`${i}/${newIds.length}`;
const fs=b.map(id=>fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,{headers:{'Authorization':`Bearer ${gmailToken}`}}).then(r=>r.json()).catch(()=>null));
const rs=await Promise.all(fs);
for(let idx=0;idx<rs.length;idx++){const m=rs[idx];if(!m||!m.payload)continue;
  const h=m.payload.headers||[],g=n=>(h.find(x=>x.name.toLowerCase()===n.toLowerCase())||{}).value||'';
  // Extract body text from MIME parts
  let bodyText='';
  function extractText(parts){if(!parts)return;for(const part of parts){
    if(part.mimeType==='text/plain'&&part.body?.data){try{bodyText+=atob(part.body.data.replace(/-/g,'+').replace(/_/g,'/'));}catch(e){}}
    if(part.parts)extractText(part.parts);}}
  if(m.payload.body?.data){try{bodyText=atob(m.payload.body.data.replace(/-/g,'+').replace(/_/g,'/'));}catch(e){}}
  if(!bodyText&&m.payload.parts)extractText(m.payload.parts);
  // Collect attachment info
  const attachments=[];
  function walkAttachments(parts){if(!parts)return;for(const part of parts){
    if(part.filename&&part.body?.attachmentId){attachments.push({filename:part.filename,mimeType:part.mimeType,attachmentId:part.body.attachmentId,messageId:b[idx]});}
    if(part.parts)walkAttachments(part.parts);}}
  if(m.payload.parts)walkAttachments(m.payload.parts);
  allEmails.push({id:b[idx],from:g('From'),to:g('To'),date:g('Date'),subject:g('Subject'),snippet:m.snippet||'',body:bodyText.slice(0,3000),attachmentCount:attachments.length,attachments});}
if(i+5<newIds.length)await sleep(200);}
log(`Pulled <b>${allEmails.length}</b> emails with full content. AI processing...`);

const AB=5;let tn=0,te=0;const tb=Math.ceil(allEmails.length/AB);
for(let i=0;i<allEmails.length;i+=AB){const bn=Math.floor(i/AB)+1;pf.style.width=(40+Math.round(i/allEmails.length*55))+'%';pt.textContent=`AI ${bn}/${tb}`;log(`AI batch ${bn}/${tb}...`);
const batch=allEmails.slice(i,i+AB);
const chunk=batch.map((e,idx)=>`[EMAIL #${i+idx+1}]\nFROM: ${e.from}\nDATE: ${e.date}\nSUBJECT: ${e.subject}\nATTACHMENTS: ${e.attachmentCount}\n---\n${e.body||e.snippet}`).join('\n\n========\n\n');
const sourceMap=batch.map((e,idx)=>({ref:i+idx+1,from:e.from,date:e.date,subject:e.subject,body:(e.body||e.snippet||'').slice(0,500)}));
const r=await aiProcessWithSources(chunk,sourceMap);if(r){const s=await saveExtracted(r);tn+=s;log(`Batch ${bn}: <b>${s} nodes</b>`,'success');
// Mark batch emails as processed
await markProcessed('gmail',batch.map(e=>e.id));
}else{te++;log(`Batch ${bn}: no data`,'warn');
// Still mark as processed to avoid re-trying bad emails
await markProcessed('gmail',batch.map(e=>e.id));}
if(i+AB<allEmails.length)await sleep(500);}
pf.style.width='100%';pt.textContent='Done!';log(`<b>Complete: ${tn} nodes</b> from ${allEmails.length} new emails (${skipped} skipped).`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}catch(e){log('FATAL: '+e.message,'error');}btn.disabled=false;btn.textContent='⚡ Sync Emails → Brain';}

// ═══ AI PROCESSING WITH SOURCES + LAYER 3 (existing nodes in prompt) ═══
async function aiProcessWithSources(text,sourceMap){
  const existing=getExistingNodeList(); // LAYER 3
  try{const a=await NX.askClaude(
    `You extract knowledge for restaurant operations (Suerte, Este, Bar Toti — Austin TX).
Each email is labeled [EMAIL #N]. For each node, include which email(s) it came from.

EXTRACT ONLY restaurant-relevant information:
✓ Equipment models, specs, warranties, repairs, maintenance
✓ Vendors & suppliers — contacts, orders, invoices, pricing
✓ Contractors — names, services, schedules, contact info
✓ Procedures, inspections, permits, licenses
✓ Parts orders, shipping, tracking numbers
✓ Projects, renovations, installations
✓ Food suppliers, menu items
✓ Staff restaurant roles and responsibilities

DO NOT EXTRACT — skip these entirely:
✗ Personal bonuses, salaries, raises, compensation
✗ Credit card or bank account numbers
✗ Personal medical or family information
✗ Marketing emails, newsletters, spam
✗ Social media notifications
✗ Personal purchases unrelated to restaurants

DO NOT create nodes that already exist — check list below.
RESPOND ONLY RAW JSON:
{"nodes":[{"name":"...","category":"equipment|contractors|vendors|procedure|projects|people|systems|parts|location","tags":["..."],"notes":"Include ALL details: specs, prices, phone numbers, model numbers, order numbers, tracking info","email_refs":[1,3]}],"cards":[{"title":"...","column_name":"todo"}]}${existing}`,
    [{role:'user',content:text.slice(0,14000)}],4096);
  let j=a.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=j.indexOf('{'),e=j.lastIndexOf('}');if(s===-1||e<=s){log('No JSON','warn');return null;}j=j.slice(s,e+1);
  try{const p=JSON.parse(j);if(!p.nodes||!Array.isArray(p.nodes))return null;
    p.nodes.forEach(n=>{
      if(n.email_refs&&Array.isArray(n.email_refs)&&sourceMap){
        n.source_emails=n.email_refs.map(ref=>{
          const src=sourceMap.find(s=>s.ref===ref);
          return src?{from:src.from,subject:src.subject,date:src.date,body:src.body||'',snippet:src.body?.slice(0,200)||''}:null;
        }).filter(Boolean);
      }else{n.source_emails=[];}
    });
    return p;}catch(pe){log('JSON parse: '+pe.message,'error');return null;}}catch(e){log('AI: '+e.message,'error');return null;}}

// Plain AI process (for paste/trello) — LAYER 3 included
async function aiProcess(text){
  const existing=getExistingNodeList(); // LAYER 3
  try{const a=await NX.askClaude(`Extract knowledge for restaurant ops (Suerte, Este, Bar Toti — Austin TX). Create nodes for every distinct entity.
DO NOT create nodes that already exist — check the list below.
Categories: equipment, contractors, vendors, procedure, projects, people, systems, parts, location
RESPOND ONLY RAW JSON:
{"nodes":[{"name":"...","category":"...","tags":["..."],"notes":"..."}],"cards":[{"title":"...","column_name":"todo"}]}${existing}`,[{role:'user',content:text.slice(0,14000)}],4096);
  let j=a.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=j.indexOf('{'),e=j.lastIndexOf('}');if(s===-1||e<=s)return null;j=j.slice(s,e+1);
  try{const p=JSON.parse(j);return(p.nodes&&Array.isArray(p.nodes))?p:null;}catch(e){log('JSON: '+e.message,'error');return null;}}catch(e){log('AI: '+e.message,'error');return null;}}

// ═══ SAVE EXTRACTED — LAYER 2 (fuzzy dedup) ═══
async function saveExtracted(r){if(!r||!r.nodes||!r.nodes.length)return 0;let c=0,er=0,dupes=0;
// Build existing name set from Supabase (not just memory)
let existingNames=new Set();NX.nodes.forEach(n=>{if(n.name)existingNames.add(n.name.toLowerCase());});
try{const{data}=await NX.sb.from('nodes').select('name');if(data)data.forEach(n=>{if(n.name)existingNames.add(n.name.toLowerCase());});}catch(e){}
const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
for(const n of r.nodes){const nm=(n.name||'').trim();if(!nm||nm.length<2)continue;
  // LAYER 2: Fuzzy duplicate check
  if(isFuzzyDuplicate(nm,existingNames)){dupes++;continue;}
  const row={name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'equipment',tags:Array.isArray(n.tags)?n.tags.filter(t=>typeof t==='string').slice(0,20):[],notes:(n.notes||'').slice(0,2000),links:[],access_count:1,source_emails:n.source_emails||[]};
  const{error}=await NX.sb.from('nodes').insert(row);if(error){er++;if(er<=3)log(`Insert "${nm}": ${error.message}`,'error');}else{existingNames.add(nm.toLowerCase());c++;}}
if(r.cards)for(const x of r.cards){if(!x.title)continue;const{error:ce}=await NX.sb.from('kanban_cards').insert({title:(x.title||'').slice(0,200),column_name:x.column_name||'todo'});if(ce)console.error('[NX] card:',ce.message);}
if(dupes)log(`${dupes} fuzzy duplicates skipped`);
if(er)log(`${er} inserts failed`,'error');return c;}

// ═══ MAIL MONITOR (enhanced: scrapes attachments + links to nodes) ═══
async function mailMonitor(){if(!gmailToken){log('Connect Gmail first.','error');return;}const btn=document.getElementById('mailMonitorBtn');btn.disabled=true;btn.textContent='Scanning...';clearLog();log('Scanning for orders, invoices & attachments...');
try{const after=new Date();after.setDate(after.getDate()-30);const dq=`after:${after.getFullYear()}/${after.getMonth()+1}/${after.getDate()}`;
const queries=[
  `${dq} (subject:order OR subject:shipped OR subject:tracking OR subject:invoice OR subject:receipt)`,
  `${dq} (subject:scheduled OR subject:appointment OR "coming by" OR "service call")`,
  `${dq} has:attachment (invoice OR receipt OR order OR confirmation OR statement)`
];
let allText=[],attachmentEmails=[];
for(const q of queries){const u=new URL('https://www.googleapis.com/gmail/v1/users/me/messages');u.searchParams.set('maxResults','50');u.searchParams.set('q',q);const r=await fetch(u,{headers:{'Authorization':`Bearer ${gmailToken}`}});const d=await r.json();if(!d.messages)continue;
const newMsgs=d.messages.filter(m=>!processedIds.has(m.id));
log(`${newMsgs.length} new of ${d.messages.length} for "${q.includes('attachment')?'attachments':q.includes('order')?'orders':'scheduling'}"`);

for(const m of newMsgs.slice(0,25)){try{
  // Fetch FULL message to get attachments
  const mr=await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,{headers:{'Authorization':`Bearer ${gmailToken}`}});
  const md=await mr.json();if(!md.payload)continue;
  const h=md.payload.headers||[],g=n=>(h.find(x=>x.name.toLowerCase()===n.toLowerCase())||{}).value||'';
  const emailInfo={id:m.id,from:g('From'),date:g('Date'),subject:g('Subject'),snippet:md.snippet||''};
  allText.push({...emailInfo,text:`FROM: ${emailInfo.from}\nDATE: ${emailInfo.date}\nSUBJECT: ${emailInfo.subject}\n${emailInfo.snippet}`});

  // Walk MIME parts to find attachments
  const attachments=[];
  function walkParts(parts){if(!parts)return;for(const part of parts){
    if(part.filename&&part.body&&part.body.attachmentId){
      const ext=(part.filename.split('.').pop()||'').toLowerCase();
      if(['pdf','png','jpg','jpeg','gif','webp','doc','docx','xlsx','csv'].includes(ext)){
        attachments.push({filename:part.filename,mimeType:part.mimeType,attachmentId:part.body.attachmentId,size:part.body.size||0});
      }
    }
    if(part.parts)walkParts(part.parts);
  }}
  if(md.payload.parts)walkParts(md.payload.parts);
  if(md.payload.filename&&md.payload.body?.attachmentId){
    attachments.push({filename:md.payload.filename,mimeType:md.payload.mimeType,attachmentId:md.payload.body.attachmentId,size:md.payload.body.size||0});
  }

  if(attachments.length){
    attachmentEmails.push({email:emailInfo,messageId:m.id,attachments});
    log(`📎 ${attachments.length} attachment(s) in "${emailInfo.subject?.slice(0,40)}"`);
  }
}catch(e){log(`Email fetch error: ${e.message}`,'error');}}await sleep(200);}

if(!allText.length&&!attachmentEmails.length){log('No new emails.','warn');btn.disabled=false;btn.textContent='Scan for Orders & Scheduling';return;}

// Process text content for nodes (same as before)
if(allText.length){
  log(`Processing ${allText.length} emails for nodes...`);
  const existing=getExistingNodeList();
  const answer=await NX.askClaude(`Extract from restaurant ops emails:
1. PARTS/ORDERS: order confirmations, shipping, invoices. Create vendor node + kanban card.
2. CONTRACTOR SCHEDULING: visits, appointments, service calls. Create an event.
3. For each node, identify which EXISTING node it relates to (vendor, equipment, contractor).
DO NOT create duplicates.
Return ONLY raw JSON:
{"nodes":[{"name":"...","category":"...","tags":["..."],"notes":"...","relates_to":"name of existing node if applicable"}],"cards":[{"title":"...","column_name":"in_progress"}],"events":[{"contractor_name":"...","description":"...","event_date":"YYYY-MM-DD","event_time":"HH:MM","location":"suerte|este|toti"}]}${existing}`,[{role:'user',content:allText.map(e=>e.text).join('\n\n---\n\n').slice(0,14000)}],4096);
  let json=answer.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=json.indexOf('{'),e=json.lastIndexOf('}');
  if(s!==-1&&e>s){json=json.slice(s,e+1);try{const p=JSON.parse(json);
    if(p.nodes)p.nodes.forEach(n=>{n.source_emails=[{from:allText[0]?.from||'',subject:'Mail Monitor',date:new Date().toISOString().split('T')[0]}];});
    if(p.nodes?.length){const saved=await saveExtracted(p);log(`<b>${saved} nodes</b> from emails`,'success');}
    if(p.events?.length){let ec=0;for(const ev of p.events){if(!ev.contractor_name||!ev.event_date)continue;try{await NX.sb.from('contractor_events').insert({contractor_name:ev.contractor_name,description:ev.description||'',event_date:ev.event_date,event_time:ev.event_time||null,location:ev.location||'suerte',status:'scheduled'});ec++;}catch(err){}}log(`<b>${ec} events</b> scheduled`,'success');}
  }catch(pe){log('Parse: '+pe.message,'error');}}
  await markProcessed('gmail',allText.map(e=>e.id));
}

// Process attachments — download, upload to Supabase Storage, link to nodes
if(attachmentEmails.length){
  log(`<b>Processing ${attachmentEmails.length} emails with attachments...</b>`);
  let uploaded=0,linked=0;

  for(const ae of attachmentEmails){
    for(const att of ae.attachments.slice(0,5)){// Max 5 attachments per email
      try{
        // Download attachment from Gmail
        log(`Downloading: ${att.filename}...`);
        const ar=await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${ae.messageId}/attachments/${att.attachmentId}`,{headers:{'Authorization':`Bearer ${gmailToken}`}});
        const ad=await ar.json();if(!ad.data)continue;

        // Convert Gmail's URL-safe base64 to standard base64
        const b64=ad.data.replace(/-/g,'+').replace(/_/g,'/');
        const binary=atob(b64);
        const bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        const blob=new Blob([bytes],{type:att.mimeType});

        // Upload to Supabase Storage
        const ts=Date.now();
        const safeName=att.filename.replace(/[^a-zA-Z0-9._-]/g,'_');
        const path=`${ts}_${safeName}`;
        log(`Uploading: ${safeName} (${Math.round(blob.size/1024)}KB)...`);
        const{data:uploadData,error:uploadErr}=await NX.sb.storage.from('nexus-files').upload(path,blob,{contentType:att.mimeType,upsert:true});
        if(uploadErr){log(`Upload failed: ${uploadErr.message}`,'error');continue;}

        // Get public URL
        const{data:urlData}=NX.sb.storage.from('nexus-files').getPublicUrl(path);
        const publicUrl=urlData?.publicUrl||'';
        if(!publicUrl){log('Could not get public URL','error');continue;}
        uploaded++;
        log(`✓ Uploaded: <b>${safeName}</b>`,'success');

        // Use AI to match this attachment to an existing node
        const matchPrompt=`Given this email:
FROM: ${ae.email.from}
SUBJECT: ${ae.email.subject}
DATE: ${ae.email.date}
ATTACHMENT: ${att.filename} (${att.mimeType})

Which of these existing nodes does this attachment belong to? Pick the BEST match.
Respond with ONLY the exact node name, nothing else. If no match, respond "NONE".

EXISTING NODES:
${NX.nodes.map(n=>n.name).join('\n')}`;
        const match=await NX.askClaude('You match email attachments to existing knowledge nodes for a restaurant ops system.',
          [{role:'user',content:matchPrompt}],100);
        const matchName=(match||'').trim();

        if(matchName&&matchName!=='NONE'){
          // Find the matching node and add attachment
          const matchNode=NX.nodes.find(n=>n.name.toLowerCase()===matchName.toLowerCase());
          if(matchNode){
            const existing=matchNode.attachments||[];
            existing.push({url:publicUrl,filename:att.filename,type:att.mimeType,from:ae.email.from,subject:ae.email.subject,date:ae.email.date,uploaded:new Date().toISOString()});
            const{error:updateErr}=await NX.sb.from('nodes').update({attachments:existing}).eq('id',matchNode.id);
            if(!updateErr){linked++;matchNode.attachments=existing;log(`📎 Linked <b>${safeName}</b> → <b>${matchNode.name}</b>`,'success');}
            else log(`Link failed: ${updateErr.message}`,'error');
          }else log(`Match "${matchName}" not found in nodes`,'warn');
        }else{
          // No match — save as unlinked attachment note in daily log
          await NX.sb.from('daily_logs').insert({entry:`Unlinked attachment: ${att.filename} from ${ae.email.from} (${ae.email.subject}). URL: ${publicUrl}`});
          log(`📎 ${safeName} saved (no node match)`,'warn');
        }
      }catch(e){log(`Attachment error: ${e.message}`,'error');}
      await sleep(300);
    }
    await markProcessed('gmail',[ae.messageId]);
  }
  log(`<b>Attachments: ${uploaded} uploaded, ${linked} linked to nodes</b>`,'success');
}

await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();
}catch(err){log('Error: '+err.message,'error');}btn.disabled=false;btn.textContent='Scan for Orders & Scheduling';}

// ═══ TRELLO (BATCHED + LAYER 1 dedup) ═══
async function trelloImport(){const tk=NX.getTrelloKey(),tt=NX.getTrelloToken();if(!tk||!tt){log('No Trello keys.','error');return;}const btn=document.getElementById('trelloBtn');btn.disabled=true;btn.textContent='Pulling...';clearLog();log('Connecting to Trello...');
try{const r=await fetch(`https://api.trello.com/1/members/me/boards?key=${tk}&token=${tt}`);if(!r.ok){log(`Trello: ${r.status}`,'error');btn.disabled=false;btn.textContent='Smart Trello Import';return;}const boards=await r.json();log(`<b>${boards.length} boards</b>`);let allCards=[];
for(const board of boards){log(`Board: ${board.name}...`);const cr=await fetch(`https://api.trello.com/1/boards/${board.id}/cards?key=${tk}&token=${tt}`);const cards=await cr.json();if(!Array.isArray(cards))continue;
cards.forEach(c=>{
  // LAYER 1: skip already-processed Trello cards
  if(processedIds.has('trello_'+c.id))return;
  allCards.push({trelloId:c.id,text:`[${board.name}] [${c.closed?'DONE':'OPEN'}] ${c.name}${c.desc?' | '+c.desc.slice(0,150):''}${c.due?' | Due:'+c.due.split('T')[0]:''}`});
});}
const skipped=0; // already filtered above
if(!allCards.length){log('All Trello cards already processed.','success');btn.disabled=false;btn.textContent='Smart Trello Import';return;}
log(`<b>${allCards.length} new cards</b>. Batching...`,'success');const B=40;let tn=0;
for(let i=0;i<allCards.length;i+=B){const bn=Math.floor(i/B)+1;const batch=allCards.slice(i,i+B);
log(`AI batch ${bn}/${Math.ceil(allCards.length/B)}...`);
const r2=await aiProcess('TRELLO:\n'+batch.map(c=>c.text).join('\n'));
if(r2){const s=await saveExtracted(r2);tn+=s;log(`Batch ${bn}: <b>${s} nodes</b>`,'success');}else log(`Batch ${bn}: no data`,'warn');
// Mark batch as processed
await markProcessed('trello',batch.map(c=>'trello_'+c.trelloId));
if(i+B<allCards.length)await sleep(500);}
log(`<b>Trello: ${tn} nodes</b>`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}catch(e){log('Error: '+e.message,'error');}btn.disabled=false;btn.textContent='Smart Trello Import';}

// ═══ PASTE ═══
async function ingestText(){const t=document.getElementById('ingestText').value.trim();if(!t)return;const b=document.getElementById('ingestTextBtn');b.disabled=true;b.textContent='...';clearLog();log('Processing ('+t.length+' chars)...');const r=await aiProcess(t);if(r){const s=await saveExtracted(r);log(`<b>${s} nodes</b>`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}else log('No data.','warn');b.disabled=false;b.textContent='Process';document.getElementById('ingestText').value='';}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function updateStats(){const el=document.getElementById('ingestStats');if(!el)return;const t=NX.nodes.length,c={};NX.nodes.forEach(n=>{c[n.category]=(c[n.category]||0)+1;});el.innerHTML=`<div class="stat-total">${t} nodes in brain · ${processedIds.size} items processed</div><div class="stat-chips">${Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="stat-chip">${k} <b>${v}</b></span>`).join('')}</div>`;}

// ═══ SENSITIVE DATA SCANNER — AI identifies and removes personal nodes ═══
async function scanSensitive(){
  const btn=document.getElementById('sensitiveBtn');if(!btn)return;
  btn.disabled=true;btn.textContent='Scanning...';clearLog();
  log('🔒 Scanning nodes for sensitive/personal data...');

  const allNodes=NX.nodes.filter(n=>!n.is_private);
  if(!allNodes.length){log('No nodes to scan.','warn');btn.disabled=false;btn.textContent='Scan & Remove Personal Data';return;}

  let flagged=[];
  const BATCH=50;
  for(let i=0;i<allNodes.length;i+=BATCH){
    const batch=allNodes.slice(i,i+BATCH);
    const nodeList=batch.map(n=>`[ID:${n.id}] ${n.name} (${n.category}): ${(n.notes||'').slice(0,200)}`).join('\n');
    log(`Scanning batch ${Math.floor(i/BATCH)+1}/${Math.ceil(allNodes.length/BATCH)}...`);

    try{
      const result=await NX.askClaude(
        `You are a data privacy scanner for a restaurant operations system (Suerte, Este, Bar Toti — Austin TX).
Identify nodes that contain PERSONAL or SENSITIVE information that should NOT be in an ops system. Flag these categories:
- Employee bonuses, salaries, pay rates, compensation
- Social security numbers, personal IDs
- Personal home addresses (business addresses are OK)
- Personal phone numbers of employees (vendor/contractor phones are OK)
- Medical/health information
- Bank account or financial account numbers
- Performance reviews or disciplinary notes
- Personal emails or private correspondence

Do NOT flag:
- Business contacts, vendor info, equipment specs, procedures, locations, parts, projects
- Contractor business phone numbers or business emails
- Restaurant addresses or business info

Return ONLY raw JSON: {"flagged":[{"id":"...","name":"...","reason":"brief reason"}]}
If nothing is sensitive, return: {"flagged":[]}`,
        [{role:'user',content:nodeList}],2000);

      let json=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
      const s=json.indexOf('{'),e=json.lastIndexOf('}');
      if(s!==-1&&e>s){json=json.slice(s,e+1);
        try{const parsed=JSON.parse(json);
          if(parsed.flagged&&parsed.flagged.length){
            flagged=flagged.concat(parsed.flagged);
            parsed.flagged.forEach(f=>log(`⚠️ <b>${f.name}</b> — ${f.reason}`,'warn'));
          }
        }catch(pe){}}
    }catch(e){log('Scan error: '+e.message,'error');}
    if(i+BATCH<allNodes.length)await sleep(300);
  }

  if(!flagged.length){
    log('✅ <b>No sensitive data found.</b> Your brain is clean.','success');
    btn.disabled=false;btn.textContent='Scan & Remove Personal Data';return;
  }

  log(`\n🔒 Found <b>${flagged.length} sensitive node(s)</b>. Review above.`,'warn');

  // Create confirm/delete buttons
  const confirmDiv=document.createElement('div');
  confirmDiv.style.cssText='display:flex;gap:8px;margin:12px 0;';
  const delBtn=document.createElement('button');
  delBtn.className='ingest-btn';delBtn.style.background='#c44';
  delBtn.textContent=`Delete ${flagged.length} Sensitive Node(s)`;
  delBtn.addEventListener('click',async()=>{
    delBtn.disabled=true;delBtn.textContent='Deleting...';
    let deleted=0;
    for(const f of flagged){
      try{
        const{error}=await NX.sb.from('nodes').delete().eq('id',f.id);
        if(!error){deleted++;log(`🗑 Deleted: ${f.name}`,'success');}
        else log(`Failed: ${f.name} — ${error.message}`,'error');
      }catch(e){log(`Error: ${e.message}`,'error');}
    }
    log(`<b>${deleted} sensitive nodes removed.</b>`,'success');
    await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();
    confirmDiv.remove();
  });
  const skipBtn=document.createElement('button');
  skipBtn.className='ingest-btn';skipBtn.textContent='Keep All';
  skipBtn.addEventListener('click',()=>{log('Skipped — no nodes deleted.');confirmDiv.remove();});
  confirmDiv.appendChild(delBtn);confirmDiv.appendChild(skipBtn);
  document.getElementById('ingestLog').appendChild(confirmDiv);

  btn.disabled=false;btn.textContent='Scan & Remove Personal Data';
}

NX.modules.ingest={init,show:()=>{updateStats();}};
})();
