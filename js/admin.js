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
  document.getElementById('reIngestBtn')?.addEventListener('click',reIngestArchived);
  // Email file upload
  const dropzone=document.getElementById('emailDropzone');
  const fileInput=document.getElementById('emailFileInput');
  if(dropzone){
    dropzone.addEventListener('dragover',e=>{e.preventDefault();dropzone.classList.add('dragover');});
    dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop',e=>{e.preventDefault();dropzone.classList.remove('dragover');processEmailFiles(e.dataTransfer.files);});
    dropzone.addEventListener('click',()=>fileInput?.click());
    fileInput?.addEventListener('change',()=>{if(fileInput.files.length)processEmailFiles(fileInput.files);});
  }
  document.getElementById('sensitiveBtn')?.addEventListener('click',scanSensitive);
  document.getElementById('relationshipBtn')?.addEventListener('click',()=>buildRelationships(false));
  document.getElementById('autoLinkToggle')?.addEventListener('change',(e)=>{localStorage.setItem('nexus_auto_link',e.target.checked?'on':'off');});
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

// ═══ GMAIL SYNC — OPTIMIZED ═══
const JUNK_PATTERNS=[/unsubscribe/i,/no-reply/i,/noreply/i,/newsletter/i,/marketing/i,/donotreply/i,/notification@/i,/updates@/i,/mailer-daemon/i,/postmaster/i];
const JUNK_SUBJECTS=[/out of office/i,/automatic reply/i,/auto-reply/i,/your password/i,/verify your email/i,/welcome to/i,/subscription/i,/your receipt from apple/i,/your order #/i,/track your package/i,/delivery notification/i];

function isJunkEmail(email){
  const from=(email.from||'').toLowerCase();
  const subj=(email.subject||'').toLowerCase();
  if(JUNK_PATTERNS.some(p=>p.test(from)))return true;
  if(JUNK_SUBJECTS.some(p=>p.test(subj)))return true;
  return false;
}

function cleanEmailBody(body){
  if(!body)return'';
  let t=body;
  // Strip HTML tags
  t=t.replace(/<[^>]+>/g,' ');
  // Strip quoted replies (lines starting with >)
  t=t.replace(/^>.*$/gm,'');
  // Strip email signatures (after -- or ___ or common patterns)
  const sigIdx=t.search(/\n--\s*\n|\n_{3,}\n|\nSent from my|\nGet Outlook|\nThis email is confidential/i);
  if(sigIdx>50)t=t.slice(0,sigIdx);
  // Strip excessive whitespace
  t=t.replace(/\n{3,}/g,'\n\n').replace(/[ \t]{3,}/g,' ').trim();
  // Strip common legal disclaimers
  t=t.replace(/CONFIDENTIALITY NOTICE[\s\S]{0,500}$/i,'').trim();
  t=t.replace(/This email and any attachments[\s\S]{0,300}$/i,'').trim();
  return t.slice(0,2500);
}

async function syncEmails(){if(!gmailToken){connectGmail();return;}const btn=document.getElementById('gmailSyncBtn'),pf=document.getElementById('gmailProgressFill'),pt=document.getElementById('gmailProgressText');document.getElementById('gmailProgress').style.display='flex';btn.disabled=true;btn.textContent='Syncing...';clearLog();log('Starting email sync...');
const dv=document.getElementById('gmailDays').value,fl=document.getElementById('gmailFilter').value.trim();let q='';if(dv!=='all'){const a=new Date();a.setDate(a.getDate()-parseInt(dv));q=`after:${a.getFullYear()}/${a.getMonth()+1}/${a.getDate()}`;}if(fl)q+=(q?' ':'')+fl;
try{let ids=[],npt=null;do{const u=new URL('https://www.googleapis.com/gmail/v1/users/me/messages');u.searchParams.set('maxResults','500');if(q)u.searchParams.set('q',q);if(npt)u.searchParams.set('pageToken',npt);const r=await fetch(u,{headers:{'Authorization':`Bearer ${gmailToken}`}});if(r.status===401){localStorage.removeItem('nexus_gmail_token');gmailToken=null;log('Token expired.','error');btn.disabled=false;btn.textContent='⚡ Sync';return;}const d=await r.json();if(d.messages)ids.push(...d.messages.map(m=>m.id));npt=d.nextPageToken;log(`${ids.length} IDs...`);}while(npt);
if(!ids.length){log('No emails found.','warn');btn.disabled=false;btn.textContent='⚡ Sync';return;}

// LAYER 1: Filter already-processed
const newIds=ids.filter(id=>!processedIds.has(id));
const skipped=ids.length-newIds.length;
if(skipped)log(`Skipping ${skipped} already-processed`);
if(!newIds.length){log('All processed. Nothing new.','success');btn.disabled=false;btn.textContent='⚡ Sync';pf.style.width='100%';return;}

// Cost estimate
const estTokens=newIds.length*800;const estCost=(estTokens/1000*0.003).toFixed(3);
log(`<b>${newIds.length} new emails</b> — est. ~${Math.round(estTokens/1000)}K tokens (~$${estCost})`,'success');

let allEmails=[];
for(let i=0;i<newIds.length;i+=5){const b=newIds.slice(i,i+5);pf.style.width=Math.round(i/newIds.length*35)+'%';pt.textContent=`Fetching ${i}/${newIds.length}`;
const fs=b.map(id=>fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,{headers:{'Authorization':`Bearer ${gmailToken}`}}).then(r=>r.json()).catch(()=>null));
const rs=await Promise.all(fs);
for(let idx=0;idx<rs.length;idx++){const m=rs[idx];if(!m||!m.payload)continue;
  const h=m.payload.headers||[],g=n=>(h.find(x=>x.name.toLowerCase()===n.toLowerCase())||{}).value||'';
  let bodyText='';
  function extractText(parts){if(!parts)return;for(const part of parts){
    if(part.mimeType==='text/plain'&&part.body?.data){try{bodyText+=atob(part.body.data.replace(/-/g,'+').replace(/_/g,'/'));}catch(e){}}
    if(part.parts)extractText(part.parts);}}
  if(m.payload.body?.data){try{bodyText=atob(m.payload.body.data.replace(/-/g,'+').replace(/_/g,'/'));}catch(e){}}
  if(!bodyText&&m.payload.parts)extractText(m.payload.parts);
  // Clean body
  bodyText=cleanEmailBody(bodyText);
  // Collect attachments
  const attachments=[];
  function walkAttachments(parts){if(!parts)return;for(const part of parts){
    if(part.filename&&part.body?.attachmentId){attachments.push({filename:part.filename,mimeType:part.mimeType,attachmentId:part.body.attachmentId,messageId:b[idx]});}
    if(part.parts)walkAttachments(part.parts);}}
  if(m.payload.parts)walkAttachments(m.payload.parts);
  const email={id:b[idx],from:g('From'),to:g('To'),date:g('Date'),subject:g('Subject'),snippet:m.snippet||'',body:bodyText,attachmentCount:attachments.length,attachments};
  // Pre-filter junk
  if(isJunkEmail(email)){log(`⏭ Skipped junk: ${email.subject.slice(0,50)}`);await markProcessed('gmail',[email.id]);continue;}
  allEmails.push(email);}
if(i+5<newIds.length)await sleep(150);}

const junkSkipped=newIds.length-allEmails.length-skipped;
if(junkSkipped>0)log(`Filtered ${junkSkipped} junk/newsletter emails`);
log(`<b>${allEmails.length}</b> relevant emails. AI processing...`);

// Download attachments from relevant emails
let attCount=0;
for(const email of allEmails){
  for(const att of email.attachments){
    try{
      const r=await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${att.messageId}/attachments/${att.attachmentId}`,{headers:{'Authorization':`Bearer ${gmailToken}`}});
      if(!r.ok)continue;const d=await r.json();if(!d.data)continue;
      const bytes=Uint8Array.from(atob(d.data.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      const blob=new Blob([bytes],{type:att.mimeType});
      const ts=Date.now();const safeName=(att.filename||'file').replace(/[^a-zA-Z0-9._-]/g,'_');
      const path=`email-attachments/${ts}_${safeName}`;
      const{error}=await NX.sb.storage.from('nexus-files').upload(path,blob,{contentType:att.mimeType,upsert:true});
      if(!error){const{data:urlData}=NX.sb.storage.from('nexus-files').getPublicUrl(path);att.url=urlData?.publicUrl||'';attCount++;}
    }catch(e){}
  }
}
if(attCount)log(`📎 Downloaded ${attCount} attachments`,'success');

// Save raw emails for future re-ingestion
let savedRaw=0;
for(const email of allEmails){
  try{
    await NX.sb.from('raw_emails').upsert({
      id:email.id,from_addr:email.from,to_addr:email.to,
      date:email.date,subject:email.subject,
      body:email.body,snippet:email.snippet,
      attachment_count:email.attachmentCount,
      attachments:email.attachments.filter(a=>a.url).map(a=>({url:a.url,filename:a.filename,type:a.mimeType}))
    },{onConflict:'id'});
    savedRaw++;
  }catch(e){}
}
log(`💾 ${savedRaw} emails archived for future use`);

// AI processing — bigger batches (8)
const AB=8;let tn=0,te=0;const tb=Math.ceil(allEmails.length/AB);
for(let i=0;i<allEmails.length;i+=AB){const bn=Math.floor(i/AB)+1;pf.style.width=(35+Math.round(i/allEmails.length*60))+'%';pt.textContent=`AI ${bn}/${tb}`;log(`AI batch ${bn}/${tb}...`);
const batch=allEmails.slice(i,i+AB);
const chunk=batch.map((e,idx)=>`[EMAIL #${i+idx+1}]\nFROM: ${e.from}\nDATE: ${e.date}\nSUBJECT: ${e.subject}\nATTACHMENTS: ${e.attachmentCount}${e.attachments.filter(a=>a.url).map(a=>` [${a.filename}]`).join('')}\n---\n${e.body||e.snippet}`).join('\n\n========\n\n');
const sourceMap=batch.map((e,idx)=>({ref:i+idx+1,from:e.from,date:e.date,subject:e.subject,body:(e.body||e.snippet||'').slice(0,500)}));
const r=await aiProcessWithSources(chunk,sourceMap);if(r){
  // Attach downloaded files to extracted nodes
  if(r.nodes){r.nodes.forEach(n=>{
    if(n.email_refs){n.email_refs.forEach(ref=>{
      const srcEmail=batch[ref-(i+1)];
      if(srcEmail&&srcEmail.attachments){
        n.attachments=(n.attachments||[]).concat(srcEmail.attachments.filter(a=>a.url).map(a=>({url:a.url,filename:a.filename,type:a.mimeType,from:srcEmail.from,date:srcEmail.date})));
      }
    });}
  });}
  const s=await saveExtracted(r);tn+=s;log(`Batch ${bn}: <b>${s} nodes</b>`,'success');
await markProcessed('gmail',batch.map(e=>e.id));
}else{te++;log(`Batch ${bn}: no data`,'warn');await markProcessed('gmail',batch.map(e=>e.id));}
if(i+AB<allEmails.length)await sleep(400);}
pf.style.width='100%';pt.textContent='Done!';log(`<b>Complete: ${tn} nodes</b> from ${allEmails.length} emails (${skipped} prev + ${junkSkipped} junk skipped).`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}catch(e){log('FATAL: '+e.message,'error');}btn.disabled=false;btn.textContent='⚡ Sync Emails → Brain';}

// ═══ EMAIL FILE UPLOAD — parse .eml, .mbox, .msg ═══
function parseEml(text){
  const headerEnd=text.indexOf('\n\n')||text.indexOf('\r\n\r\n');
  if(headerEnd===-1)return null;
  const headerBlock=text.slice(0,headerEnd);
  const body=text.slice(headerEnd+2).trim();
  const getH=(name)=>{const m=headerBlock.match(new RegExp('^'+name+':\\s*(.+)','mi'));return m?m[1].trim():'';};
  return{
    from:getH('From'),to:getH('To'),date:getH('Date'),
    subject:getH('Subject'),body:cleanEmailBody(body),
    id:'file_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)
  };
}

function extractField(text,field){
  const m=text.match(new RegExp(field+'[:\\s]+([^\\n]{3,80})','i'));
  return m?m[1].trim():'';
}

function parseMbox(text){
  const emails=[];
  // Split on lines starting with "From " (mbox separator)
  const parts=text.split(/^From\s+\S+.*$/m).filter(p=>p.trim());
  for(const part of parts){
    const email=parseEml(part.trim());
    if(email&&(email.from||email.subject))emails.push(email);
  }
  return emails;
}

async function processEmailFiles(files){
  const status=document.getElementById('emailFileStatus');
  if(!files||!files.length)return;
  clearLog();
  let allEmails=[];
  status.textContent='Reading files...';

  for(const file of files){
    try{
      const name=file.name.toLowerCase();
      if(name.endsWith('.mbox')){
        const text=await file.text();
        const parsed=parseMbox(text);
        log(`📂 ${file.name}: ${parsed.length} emails`);
        allEmails=allEmails.concat(parsed);
      }else if(name.endsWith('.eml')||name.endsWith('.txt')){
        const text=await file.text();
        const email=parseEml(text);
        if(email){log(`📧 ${file.name}: ${email.subject||'(no subject)'}`);allEmails.push(email);}
        else log(`⚠ Could not parse ${file.name}`,'warn');
      }else if(name.endsWith('.msg')){
        // Outlook .msg — extract readable text from binary
        const buffer=await file.arrayBuffer();
        const bytes=new Uint8Array(buffer);
        // Extract ASCII/UTF text chunks from binary
        let text='';
        let chunk='';
        for(let i=0;i<bytes.length;i++){
          const c=bytes[i];
          if(c>=32&&c<127){chunk+=String.fromCharCode(c);}
          else{if(chunk.length>20)text+=chunk+'\n';chunk='';}
        }
        if(chunk.length>20)text+=chunk;
        if(text.length>50){
          // Try to find email headers in extracted text
          const email=parseEml(text)||{
            from:extractField(text,'From')||file.name,
            to:extractField(text,'To')||'',
            date:extractField(text,'Date')||new Date().toISOString(),
            subject:extractField(text,'Subject')||file.name.replace('.msg',''),
            body:cleanEmailBody(text),
            id:'msg_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)
          };
          log(`📧 ${file.name} (Outlook): ${email.subject||'parsed'}`);
          allEmails.push(email);
        }else{
          log(`⚠ ${file.name}: couldn't extract text from .msg — try exporting as .eml from Outlook`,'warn');
        }
      }else{
        const text=await file.text();
        const email=parseEml(text);
        if(email&&email.from){allEmails.push(email);log(`📧 ${file.name}: parsed`);}
        else{
          // Treat as raw text to process
          allEmails.push({from:file.name,subject:file.name,body:cleanEmailBody(text),date:new Date().toISOString(),id:'file_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)});
          log(`📄 ${file.name}: imported as raw text`);
        }
      }
    }catch(e){log(`Error: ${file.name}: ${e.message}`,'error');}
  }

  if(!allEmails.length){status.textContent='No emails found in files.';return;}

  // Filter junk
  const relevant=allEmails.filter(e=>!isJunkEmail(e));
  if(relevant.length<allEmails.length)log(`Filtered ${allEmails.length-relevant.length} junk emails`);

  // Archive raw emails
  let archived=0;
  for(const e of relevant){
    try{await NX.sb.from('raw_emails').upsert({id:e.id,from_addr:e.from,to_addr:e.to,date:e.date,subject:e.subject,body:e.body,snippet:(e.body||'').slice(0,200),attachment_count:0,attachments:[]},{onConflict:'id'});archived++;}catch(err){}
  }
  log(`💾 ${archived} emails archived`);

  // Cost estimate
  const estTokens=relevant.length*800;
  log(`<b>${relevant.length} emails</b> to process — est. ~${Math.round(estTokens/1000)}K tokens (~$${(estTokens/1000*0.003).toFixed(3)})`);
  status.textContent=`Processing ${relevant.length} emails...`;

  // AI processing
  const AB=8;let tn=0;const tb=Math.ceil(relevant.length/AB);
  for(let i=0;i<relevant.length;i+=AB){
    const bn=Math.floor(i/AB)+1;log(`AI batch ${bn}/${tb}...`);
    const batch=relevant.slice(i,i+AB);
    const chunk=batch.map((e,idx)=>`[EMAIL #${i+idx+1}]\nFROM: ${e.from}\nDATE: ${e.date}\nSUBJECT: ${e.subject}\n---\n${e.body}`).join('\n\n========\n\n');
    const sourceMap=batch.map((e,idx)=>({ref:i+idx+1,from:e.from,date:e.date,subject:e.subject,body:(e.body||'').slice(0,500)}));
    const r=await aiProcessWithSources(chunk,sourceMap);
    if(r){const s=await saveExtracted(r);tn+=s;log(`Batch ${bn}: <b>${s} nodes</b>`,'success');}
    else log(`Batch ${bn}: no data`,'warn');
    if(i+AB<relevant.length)await sleep(400);
  }

  log(`<b>Complete: ${tn} nodes</b> from ${relevant.length} uploaded emails.`,'success');
  status.textContent=`✓ ${tn} nodes created`;status.style='color:#39ff14';
  await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();
}

// ═══ RE-INGEST — reprocess archived emails with improved AI ═══
async function reIngestArchived(){
  const btn=document.getElementById('reIngestBtn');
  btn.disabled=true;btn.textContent='Loading archive...';clearLog();
  try{
    const{data,error}=await NX.sb.from('raw_emails').select('*').order('date',{ascending:false});
    if(error||!data||!data.length){log(error?'Error: '+error.message:'No archived emails found.','warn');btn.disabled=false;btn.textContent='♻ Re-ingest';return;}
    log(`📬 <b>${data.length}</b> archived emails. Re-processing...`);
    const allEmails=data.map(e=>({id:e.id,from:e.from_addr,to:e.to_addr,date:e.date,subject:e.subject,body:e.body||'',snippet:e.snippet||'',attachmentCount:e.attachment_count||0,attachments:e.attachments||[]}));
    const estTokens=allEmails.length*800;log(`Est. ~${Math.round(estTokens/1000)}K tokens (~$${(estTokens/1000*0.003).toFixed(3)})`);
    const pf=document.getElementById('gmailProgressFill'),pt=document.getElementById('gmailProgressText');
    document.getElementById('gmailProgress').style.display='flex';
    const AB=8;let tn=0;const tb=Math.ceil(allEmails.length/AB);
    for(let i=0;i<allEmails.length;i+=AB){
      const bn=Math.floor(i/AB)+1;pf.style.width=Math.round(i/allEmails.length*100)+'%';pt.textContent=`AI ${bn}/${tb}`;log(`Batch ${bn}/${tb}...`);
      const batch=allEmails.slice(i,i+AB);
      const chunk=batch.map((e,idx)=>`[EMAIL #${i+idx+1}]\nFROM: ${e.from}\nDATE: ${e.date}\nSUBJECT: ${e.subject}\n---\n${e.body||e.snippet}`).join('\n\n========\n\n');
      const sourceMap=batch.map((e,idx)=>({ref:i+idx+1,from:e.from,date:e.date,subject:e.subject,body:(e.body||e.snippet||'').slice(0,500)}));
      const r=await aiProcessWithSources(chunk,sourceMap);
      if(r){const s=await saveExtracted(r);tn+=s;log(`Batch ${bn}: <b>${s} nodes</b>`,'success');}
      else log(`Batch ${bn}: no data`,'warn');
      if(i+AB<allEmails.length)await sleep(400);
    }
    pf.style.width='100%';pt.textContent='Done!';
    log(`<b>Re-ingest complete: ${tn} new nodes</b> from ${allEmails.length} archived emails.`,'success');
    await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();
  }catch(e){log('Error: '+e.message,'error');}
  btn.disabled=false;btn.textContent='♻ Re-ingest Archived Emails';
}

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
const createdNames=[];
// Build existing name set from Supabase (not just memory)
let existingNames=new Set();NX.nodes.forEach(n=>{if(n.name)existingNames.add(n.name.toLowerCase());});
try{const{data}=await NX.sb.from('nodes').select('name');if(data)data.forEach(n=>{if(n.name)existingNames.add(n.name.toLowerCase());});}catch(e){}
const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
for(const n of r.nodes){const nm=(n.name||'').trim();if(!nm||nm.length<2)continue;
  // LAYER 2: Fuzzy duplicate check
  if(isFuzzyDuplicate(nm,existingNames)){dupes++;continue;}
  const row={name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'equipment',tags:Array.isArray(n.tags)?n.tags.filter(t=>typeof t==='string').slice(0,20):[],notes:(n.notes||'').slice(0,2000),links:[],access_count:1,source_emails:n.source_emails||[]};
  const{error}=await NX.sb.from('nodes').insert(row);if(error){er++;if(er<=3)log(`Insert "${nm}": ${error.message}`,'error');}else{existingNames.add(nm.toLowerCase());createdNames.push(nm);c++;}}
if(r.cards)for(const x of r.cards){if(!x.title)continue;const{error:ce}=await NX.sb.from('kanban_cards').insert({title:(x.title||'').slice(0,200),column_name:x.column_name||'todo'});if(ce)console.error('[NX] card:',ce.message);}
if(dupes)log(`${dupes} fuzzy duplicates skipped`);
if(er)log(`${er} inserts failed`,'error');
// Auto-link new nodes
if(createdNames.length&&NX.autoLinkNewNodes){await NX.loadNodes();NX.autoLinkNewNodes(createdNames);}
return c;}

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

  // Load safe patterns — nodes user previously marked as OK
  const safePatterns=JSON.parse(localStorage.getItem('nexus_safe_patterns')||'[]');

  const allNodes=NX.nodes.filter(n=>!n.is_private);
  if(!allNodes.length){log('No nodes to scan.','warn');btn.disabled=false;btn.textContent='Scan & Remove Personal Data';return;}

  let flagged=[];
  const BATCH=50;
  for(let i=0;i<allNodes.length;i+=BATCH){
    const batch=allNodes.slice(i,i+BATCH);
    log(`Scanning batch ${Math.floor(i/BATCH)+1}/${Math.ceil(allNodes.length/BATCH)}...`);
    const nodeList=batch.map(n=>`[ID:${n.id}] ${n.name} (${n.category}): ${(n.notes||'').slice(0,200)}`).join('\n');

    // Tell AI about safe patterns so it skips them
    const safeNote=safePatterns.length?`\n\nPREVIOUSLY APPROVED (do NOT flag these):\n${safePatterns.join('\n')}`:'';

    try{
      const result=await NX.askClaude(
        `You are a data privacy scanner for restaurant ops (Suerte, Este, Bar Toti — Austin TX).
Flag nodes with PERSONAL/SENSITIVE info:
- Employee bonuses, salaries, pay rates, compensation
- Social security numbers, personal IDs
- Personal home addresses (business addresses are OK)
- Personal phone numbers of employees (vendor/contractor phones OK)
- Medical/health information
- Bank account or financial account numbers
- Performance reviews or disciplinary notes
- Personal emails or private correspondence
- Credit card numbers

Do NOT flag:
- Business contacts, vendor info, equipment specs, procedures, parts, projects
- Contractor business phones or emails
- Restaurant addresses or business info
- Staff names with restaurant roles only${safeNote}

For each flagged node, classify the sensitivity:
- "high" = SSN, bank accounts, credit cards — should definitely delete
- "medium" = salaries, bonuses, personal addresses — probably delete
- "low" = could be personal or business — needs review

Return ONLY JSON: {"flagged":[{"id":"...","name":"...","reason":"brief reason","severity":"high|medium|low","notes_excerpt":"the specific sensitive text found"}]}
If nothing sensitive: {"flagged":[]}`,
        [{role:'user',content:nodeList}],2000);

      let json=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
      const s=json.indexOf('{'),e=json.lastIndexOf('}');
      if(s!==-1&&e>s){json=json.slice(s,e+1);
        try{const parsed=JSON.parse(json);
          if(parsed.flagged&&parsed.flagged.length)flagged=flagged.concat(parsed.flagged);
        }catch(pe){}}
    }catch(e){log('Scan error: '+e.message,'error');}
    if(i+BATCH<allNodes.length)await sleep(300);
  }

  if(!flagged.length){
    log('✅ <b>No sensitive data found.</b> Your brain is clean.','success');
    btn.disabled=false;btn.textContent='Scan & Remove Personal Data';return;
  }

  log(`\n🔒 Found <b>${flagged.length} item(s)</b> to review.\n`,'warn');

  // Render per-node review cards
  const reviewDiv=document.createElement('div');reviewDiv.className='sensitive-review';
  let reviewed=0;

  for(const f of flagged){
    const node=NX.nodes.find(n=>String(n.id)===String(f.id));
    const card=document.createElement('div');card.className='sensitive-card';
    const sevColor=f.severity==='high'?'#ff5533':f.severity==='medium'?'#ffb020':'#5b8def';
    card.innerHTML=`
      <div class="sensitive-header">
        <span class="sensitive-severity" style="color:${sevColor}">${(f.severity||'medium').toUpperCase()}</span>
        <span class="sensitive-name">${f.name}</span>
      </div>
      <div class="sensitive-reason">${f.reason}</div>
      ${f.notes_excerpt?`<div class="sensitive-excerpt">"${f.notes_excerpt}"</div>`:''}
      ${node?`<div class="sensitive-full-notes">${(node.notes||'').slice(0,300)}</div>`:''}
      <div class="sensitive-actions"></div>`;

    const actions=card.querySelector('.sensitive-actions');

    // DELETE button
    const delBtn=document.createElement('button');delBtn.className='sensitive-btn sensitive-btn-del';
    delBtn.textContent='🗑 Delete';
    delBtn.addEventListener('click',async()=>{
      try{await NX.sb.from('nodes').delete().eq('id',f.id);
        NX.nodes=NX.nodes.filter(x=>String(x.id)!==String(f.id));
        card.style.opacity='0.3';card.style.pointerEvents='none';
        delBtn.textContent='Deleted';reviewed++;
        log(`🗑 Deleted: <b>${f.name}</b>`,'success');
        checkDone();
      }catch(e){delBtn.textContent='Error';}
    });

    // KEEP button — mark as safe for future scans
    const keepBtn=document.createElement('button');keepBtn.className='sensitive-btn sensitive-btn-keep';
    keepBtn.textContent='✓ Keep (not sensitive)';
    keepBtn.addEventListener('click',()=>{
      safePatterns.push(f.name+' — '+f.reason);
      localStorage.setItem('nexus_safe_patterns',JSON.stringify(safePatterns));
      card.style.opacity='0.3';card.style.pointerEvents='none';
      keepBtn.textContent='Marked safe';reviewed++;
      log(`✓ Kept: <b>${f.name}</b> (won't flag again)`,'success');
      checkDone();
    });

    // MAKE PRIVATE button — hide from non-admin users
    const privBtn=document.createElement('button');privBtn.className='sensitive-btn sensitive-btn-priv';
    privBtn.textContent='🔒 Make Private';
    privBtn.addEventListener('click',async()=>{
      try{await NX.sb.from('nodes').update({is_private:true}).eq('id',f.id);
        if(node)node.is_private=true;
        card.style.opacity='0.3';card.style.pointerEvents='none';
        privBtn.textContent='Made private';reviewed++;
        log(`🔒 Private: <b>${f.name}</b> (admin only)`,'success');
        checkDone();
      }catch(e){privBtn.textContent='Error';}
    });

    // EDIT button — let user redact the sensitive part
    const editBtn=document.createElement('button');editBtn.className='sensitive-btn sensitive-btn-edit';
    editBtn.textContent='✏ Edit Notes';
    editBtn.addEventListener('click',()=>{
      const current=node?node.notes||'':'';
      const newNotes=prompt('Edit notes (remove sensitive info):',current);
      if(newNotes!==null&&node){
        NX.sb.from('nodes').update({notes:newNotes}).eq('id',node.id);
        node.notes=newNotes;
        card.style.opacity='0.3';card.style.pointerEvents='none';
        editBtn.textContent='Updated';reviewed++;
        log(`✏ Edited: <b>${f.name}</b>`,'success');
        checkDone();
      }
    });

    actions.appendChild(delBtn);actions.appendChild(keepBtn);
    actions.appendChild(privBtn);actions.appendChild(editBtn);
    reviewDiv.appendChild(card);
  }

  function checkDone(){
    if(reviewed>=flagged.length){
      log(`\n<b>Review complete.</b> ${reviewed} items handled.`,'success');
      NX.loadNodes().then(()=>{if(NX.brain)NX.brain.init();updateStats();});
    }
  }

  document.getElementById('ingestLog').appendChild(reviewDiv);
  btn.disabled=false;btn.textContent='Scan & Remove Personal Data';
}

// ═══ AI RELATIONSHIP BUILDER — links related nodes ═══
async function buildRelationships(auto=false){
  const btn=document.getElementById('relationshipBtn');
  if(btn){btn.disabled=true;btn.textContent=auto?'Auto-linking...':'Analyzing...';}
  if(!auto)clearLog();
  log('🔗 AI scanning nodes for relationships...');

  const nodes=NX.nodes.filter(n=>!n.is_private);
  if(nodes.length<2){log('Need 2+ nodes.','warn');if(btn){btn.disabled=false;btn.textContent='Build Relationships';}return;}

  const BATCH=auto?30:60; // Smaller batches for auto mode
  let totalLinks=0;

  for(let i=0;i<nodes.length;i+=BATCH){
    const batch=nodes.slice(i,i+BATCH);
    const batchNum=Math.floor(i/BATCH)+1;
    const totalBatches=Math.ceil(nodes.length/BATCH);
    log(`Batch ${batchNum}/${totalBatches} (${batch.length} nodes)...`);

    const nodeList=batch.map(n=>`[${n.id}] ${n.name} (${n.category}): ${(n.notes||'').slice(0,100)}`).join('\n');

    try{
      const result=await NX.askClaude(
        `You analyze restaurant operations nodes and find relationships between them.
For each pair of related nodes, explain WHY they're connected.

Types of relationships to identify:
- Vendor supplies equipment/parts
- Contractor services equipment/location
- Person works at location
- Equipment is at location
- Parts belong to equipment
- Procedure involves equipment/location
- Project involves contractor/equipment/location

Return ONLY raw JSON:
{"links":[{"from_id":"...","to_id":"...","reason":"brief reason"}]}
Only include strong, clear relationships. Max 20 links per batch.`,
        [{role:'user',content:'Find relationships between these nodes:\n'+nodeList}],1500);

      let json=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
      const s=json.indexOf('{'),e=json.lastIndexOf('}');
      if(s!==-1&&e>s){json=json.slice(s,e+1);
        const parsed=JSON.parse(json);
        if(parsed.links&&parsed.links.length){
          let batchLinks=0;
          for(const link of parsed.links){
            const nodeA=NX.nodes.find(n=>String(n.id)===String(link.from_id));
            const nodeB=NX.nodes.find(n=>String(n.id)===String(link.to_id));
            if(!nodeA||!nodeB)continue;
            // Add bidirectional links (avoid duplicates)
            const aLinks=nodeA.links||[];const bLinks=nodeB.links||[];
            let changed=false;
            if(!aLinks.includes(nodeB.id)){aLinks.push(nodeB.id);changed=true;}
            if(!bLinks.includes(nodeA.id)){bLinks.push(nodeA.id);changed=true;}
            if(changed){
              await NX.sb.from('nodes').update({links:aLinks}).eq('id',nodeA.id);
              await NX.sb.from('nodes').update({links:bLinks}).eq('id',nodeB.id);
              nodeA.links=aLinks;nodeB.links=bLinks;
              batchLinks++;totalLinks++;
              if(!auto)log(`🔗 ${nodeA.name} ↔ ${nodeB.name} — ${link.reason}`,'success');
            }
          }
          if(auto&&batchLinks)log(`Batch ${batchNum}: ${batchLinks} links`,'success');
        }
      }
    }catch(e){log('Error: '+e.message,'error');}
    if(i+BATCH<nodes.length)await sleep(500);
  }

  log(`<b>Done: ${totalLinks} new relationships created.</b>`,'success');
  if(btn){btn.disabled=false;btn.textContent='Build Relationships';}
  await NX.loadNodes();if(NX.brain)NX.brain.init();
}

// Auto-link after ingestion (small batch — only new nodes)
async function autoLinkNewNodes(newNodeNames){
  if(!newNodeNames||!newNodeNames.length)return;
  const autoLink=localStorage.getItem('nexus_auto_link')!=='off';
  if(!autoLink)return;
  log('🔗 Auto-linking new nodes...');
  // Get the new nodes + a sample of existing ones for context
  const newNodes=NX.nodes.filter(n=>newNodeNames.includes(n.name));
  const existingSample=NX.nodes.filter(n=>!newNodeNames.includes(n.name)).slice(0,40);
  const combined=[...newNodes,...existingSample];
  const nodeList=combined.map(n=>`[${n.id}] ${n.name} (${n.category}): ${(n.notes||'').slice(0,80)}`).join('\n');
  try{
    const result=await NX.askClaude(
      'Find relationships between these restaurant ops nodes. The first few are NEW. Link them to existing ones where relevant. Return ONLY JSON: {"links":[{"from_id":"...","to_id":"...","reason":"..."}]} Max 15 links.',
      [{role:'user',content:nodeList}],1000);
    let json=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
    const s=json.indexOf('{'),e=json.lastIndexOf('}');
    if(s!==-1&&e>s){json=json.slice(s,e+1);const parsed=JSON.parse(json);
      if(parsed.links){let c=0;
        for(const link of parsed.links){
          const nA=NX.nodes.find(n=>String(n.id)===String(link.from_id));
          const nB=NX.nodes.find(n=>String(n.id)===String(link.to_id));
          if(!nA||!nB)continue;
          const aL=nA.links||[];const bL=nB.links||[];
          if(!aL.includes(nB.id)){aL.push(nB.id);await NX.sb.from('nodes').update({links:aL}).eq('id',nA.id);nA.links=aL;}
          if(!bL.includes(nA.id)){bL.push(nA.id);await NX.sb.from('nodes').update({links:bL}).eq('id',nB.id);nB.links=bL;}
          c++;
        }
        if(c)log(`🔗 Auto-linked: ${c} relationships`,'success');
      }
    }
  }catch(e){}
}

NX.buildRelationships=buildRelationships;
NX.autoLinkNewNodes=autoLinkNewNodes;

NX.modules.ingest={init,show:()=>{updateStats();const alt=document.getElementById('autoLinkToggle');if(alt)alt.checked=localStorage.getItem('nexus_auto_link')!=='off';}};
})();
